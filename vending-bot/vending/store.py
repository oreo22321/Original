"""商品・在庫・注文・パネルを SQLite に保存します。

在庫は 1 行 = 1 個 (シリアルコードやリンクなど)。注文すると在庫に注文番号が付いて「予約」になり、
承認で「販売済み」、却下・キャンセルで元の在庫に戻ります。処理は一つのトランザクションで行うので、
同時に注文が入っても同じ在庫が二重に売れることはありません。
"""
from __future__ import annotations

import sqlite3
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    guild_id         INTEGER PRIMARY KEY,
    admin_channel_id INTEGER,
    admin_role_id    INTEGER,
    payment_info     TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS products (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id          INTEGER NOT NULL,
    name              TEXT    NOT NULL,
    price             INTEGER NOT NULL,
    description       TEXT    NOT NULL DEFAULT '',
    unlimited_content TEXT,
    role_id           INTEGER,
    active            INTEGER NOT NULL DEFAULT 1,
    created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS products_guild ON products (guild_id, active);
CREATE TABLE IF NOT EXISTS orders (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id         INTEGER NOT NULL,
    user_id          INTEGER NOT NULL,
    product_id       INTEGER NOT NULL REFERENCES products (id),
    product_name     TEXT    NOT NULL,
    quantity         INTEGER NOT NULL,
    unit_price       INTEGER NOT NULL,
    total            INTEGER NOT NULL,
    payment_note     TEXT    NOT NULL,
    role_id          INTEGER,
    status           TEXT    NOT NULL,
    reason           TEXT,
    delivered        TEXT,
    handled_by       INTEGER,
    admin_channel_id INTEGER,
    admin_message_id INTEGER,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_guild ON orders (guild_id, status);
CREATE INDEX IF NOT EXISTS orders_user ON orders (guild_id, user_id);
CREATE TABLE IF NOT EXISTS stock (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products (id),
    content    TEXT    NOT NULL,
    order_id   INTEGER REFERENCES orders (id),
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stock_available ON stock (product_id, order_id);
CREATE TABLE IF NOT EXISTS panels (
    message_id  INTEGER PRIMARY KEY,
    guild_id    INTEGER NOT NULL,
    channel_id  INTEGER NOT NULL,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL
);
"""

PENDING = "pending"
COMPLETED = "completed"
REJECTED = "rejected"
CANCELLED = "cancelled"
STATUSES = (PENDING, COMPLETED, REJECTED, CANCELLED)


class StoreError(Exception):
    """そのまま利用者に見せてよい理由つきのエラー"""


@dataclass(frozen=True)
class Settings:
    guild_id: int
    admin_channel_id: int | None
    admin_role_id: int | None
    payment_info: str


@dataclass(frozen=True)
class Product:
    id: int
    guild_id: int
    name: str
    price: int
    description: str
    unlimited_content: str | None
    role_id: int | None
    active: bool
    stock: int | None  # None = 無制限

    @property
    def unlimited(self) -> bool:
        return self.unlimited_content is not None

    @property
    def sold_out(self) -> bool:
        return self.stock is not None and self.stock <= 0


@dataclass(frozen=True)
class Order:
    id: int
    guild_id: int
    user_id: int
    product_id: int
    product_name: str
    quantity: int
    unit_price: int
    total: int
    payment_note: str
    role_id: int | None
    status: str
    reason: str | None
    delivered: str | None
    handled_by: int | None
    admin_channel_id: int | None
    admin_message_id: int | None
    created_at: int
    updated_at: int


@dataclass(frozen=True)
class Panel:
    message_id: int
    guild_id: int
    channel_id: int
    title: str
    description: str


@dataclass(frozen=True)
class Sales:
    orders: int
    items: int
    revenue: int
    pending: int
    top: list[tuple[str, int, int]]  # (商品名, 個数, 売上)


def _now() -> int:
    return int(time.time())


class Store:
    def __init__(self, path: str | Path = ":memory:") -> None:
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        # isolation_level=None: トランザクションは _tx() で明示的に張る
        self.db = sqlite3.connect(str(path), isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.execute("PRAGMA journal_mode = WAL")
        self.db.executescript(SCHEMA)

    def close(self) -> None:
        self.db.close()

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Connection]:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield self.db
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        self.db.execute("COMMIT")

    # ---------- 設定 ----------
    def get_settings(self, guild_id: int) -> Settings:
        row = self.db.execute("SELECT * FROM settings WHERE guild_id = ?", (guild_id,)).fetchone()
        if row is None:
            return Settings(guild_id, None, None, "")
        return Settings(row["guild_id"], row["admin_channel_id"], row["admin_role_id"], row["payment_info"])

    def update_settings(self, guild_id: int, **fields: object) -> Settings:
        allowed = {"admin_channel_id", "admin_role_id", "payment_info"}
        unknown = set(fields) - allowed
        if unknown:
            raise ValueError(f"unknown settings: {unknown}")
        with self._tx() as db:
            db.execute("INSERT OR IGNORE INTO settings (guild_id) VALUES (?)", (guild_id,))
            for key, value in fields.items():
                db.execute(f"UPDATE settings SET {key} = ? WHERE guild_id = ?", (value, guild_id))
        return self.get_settings(guild_id)

    # ---------- 商品 ----------
    _PRODUCT_SELECT = """
        SELECT p.*,
               (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.order_id IS NULL) AS stock_count
        FROM products p
    """

    @staticmethod
    def _product(row: sqlite3.Row) -> Product:
        unlimited = row["unlimited_content"]
        return Product(
            id=row["id"],
            guild_id=row["guild_id"],
            name=row["name"],
            price=row["price"],
            description=row["description"],
            unlimited_content=unlimited,
            role_id=row["role_id"],
            active=bool(row["active"]),
            stock=None if unlimited is not None else row["stock_count"],
        )

    @staticmethod
    def _validate_product(name: str, price: int, unlimited_content: str | None) -> tuple[str, str | None]:
        name = name.strip()
        if not name:
            raise StoreError("商品名を入力してください。")
        if len(name) > 100:
            raise StoreError("商品名は 100 文字以内にしてください。")
        if price < 0:
            raise StoreError("価格は 0 以上にしてください。")
        if unlimited_content is not None:
            unlimited_content = unlimited_content.strip() or None
        return name, unlimited_content

    def add_product(
        self,
        guild_id: int,
        name: str,
        price: int,
        description: str = "",
        unlimited_content: str | None = None,
        role_id: int | None = None,
    ) -> Product:
        name, unlimited_content = self._validate_product(name, price, unlimited_content)
        with self._tx() as db:
            cur = db.execute(
                "INSERT INTO products (guild_id, name, price, description, unlimited_content, role_id, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (guild_id, name, price, description.strip(), unlimited_content, role_id, _now()),
            )
            product_id = cur.lastrowid
            assert product_id is not None
        product = self.get_product(guild_id, product_id)
        assert product is not None
        return product

    def update_product(
        self,
        guild_id: int,
        product_id: int,
        *,
        name: str,
        price: int,
        description: str,
        unlimited_content: str | None,
    ) -> Product:
        name, unlimited_content = self._validate_product(name, price, unlimited_content)
        current = self.get_product(guild_id, product_id)
        if current is None:
            raise StoreError("商品が見つかりません。")
        if unlimited_content is not None and not current.unlimited and (current.stock or 0) > 0:
            raise StoreError("在庫が残っている商品は無制限配布にできません。先に `/stock clear` で在庫を取り出してください。")
        with self._tx() as db:
            db.execute(
                "UPDATE products SET name = ?, price = ?, description = ?, unlimited_content = ? WHERE id = ?",
                (name, price, description.strip(), unlimited_content, product_id),
            )
        updated = self.get_product(guild_id, product_id)
        assert updated is not None
        return updated

    def set_product_role(self, guild_id: int, product_id: int, role_id: int | None) -> Product:
        if self.get_product(guild_id, product_id) is None:
            raise StoreError("商品が見つかりません。")
        with self._tx() as db:
            db.execute("UPDATE products SET role_id = ? WHERE id = ?", (role_id, product_id))
        product = self.get_product(guild_id, product_id)
        assert product is not None
        return product

    def remove_product(self, guild_id: int, product_id: int) -> list[str]:
        """販売を終了し、売れ残りの在庫を取り出して返す (確認待ちの注文の分はそのまま)"""
        if self.get_product(guild_id, product_id) is None:
            raise StoreError("商品が見つかりません。")
        with self._tx() as db:
            leftover = self._take_available(db, product_id)
            db.execute("UPDATE products SET active = 0 WHERE id = ?", (product_id,))
        return leftover

    def get_product(self, guild_id: int, product_id: int, include_inactive: bool = False) -> Product | None:
        sql = self._PRODUCT_SELECT + " WHERE p.id = ? AND p.guild_id = ?"
        if not include_inactive:
            sql += " AND p.active = 1"
        row = self.db.execute(sql, (product_id, guild_id)).fetchone()
        return self._product(row) if row else None

    def list_products(self, guild_id: int) -> list[Product]:
        rows = self.db.execute(
            self._PRODUCT_SELECT + " WHERE p.guild_id = ? AND p.active = 1 ORDER BY p.id", (guild_id,)
        ).fetchall()
        return [self._product(r) for r in rows]

    def find_product(self, guild_id: int, query: str) -> Product | None:
        """オートコンプリートの値 (ID) か、商品名の完全一致で探す"""
        query = query.strip()
        if query.isdigit():
            product = self.get_product(guild_id, int(query))
            if product:
                return product
        folded = query.casefold()
        for product in self.list_products(guild_id):
            if product.name.casefold() == folded:
                return product
        return None

    # ---------- 在庫 ----------
    def add_stock(self, guild_id: int, product_id: int, lines: Iterable[str]) -> int:
        product = self.get_product(guild_id, product_id)
        if product is None:
            raise StoreError("商品が見つかりません。")
        if product.unlimited:
            raise StoreError("無制限配布の商品には在庫を追加できません。")
        items = [line.strip() for line in lines]
        items = [item for item in items if item]
        if not items:
            raise StoreError("追加する在庫がありません (1 行に 1 個ずつ書いてください)。")
        now = _now()
        with self._tx() as db:
            db.executemany(
                "INSERT INTO stock (product_id, content, created_at) VALUES (?, ?, ?)",
                [(product_id, item, now) for item in items],
            )
        return len(items)

    def available_stock(self, guild_id: int, product_id: int) -> list[str]:
        if self.get_product(guild_id, product_id, include_inactive=True) is None:
            raise StoreError("商品が見つかりません。")
        rows = self.db.execute(
            "SELECT content FROM stock WHERE product_id = ? AND order_id IS NULL ORDER BY id", (product_id,)
        ).fetchall()
        return [r["content"] for r in rows]

    def clear_stock(self, guild_id: int, product_id: int) -> list[str]:
        if self.get_product(guild_id, product_id, include_inactive=True) is None:
            raise StoreError("商品が見つかりません。")
        with self._tx() as db:
            return self._take_available(db, product_id)

    @staticmethod
    def _take_available(db: sqlite3.Connection, product_id: int) -> list[str]:
        rows = db.execute(
            "SELECT id, content FROM stock WHERE product_id = ? AND order_id IS NULL ORDER BY id", (product_id,)
        ).fetchall()
        db.execute("DELETE FROM stock WHERE product_id = ? AND order_id IS NULL", (product_id,))
        return [r["content"] for r in rows]

    # ---------- 注文 ----------
    @staticmethod
    def _order(row: sqlite3.Row) -> Order:
        return Order(**{key: row[key] for key in row.keys()})

    def create_order(
        self,
        guild_id: int,
        user_id: int,
        product_id: int,
        quantity: int,
        payment_note: str,
        *,
        max_quantity: int = 50,
        max_pending: int = 3,
    ) -> Order:
        payment_note = payment_note.strip()
        if not payment_note:
            raise StoreError("お支払いの確認情報を入力してください。")
        if quantity < 1:
            raise StoreError("数量は 1 以上にしてください。")
        if quantity > max_quantity:
            raise StoreError(f"一度に注文できるのは {max_quantity} 個までです。")
        now = _now()
        with self._tx() as db:
            product = self.get_product(guild_id, product_id)
            if product is None:
                raise StoreError("この商品は販売を終了しました。")
            if product.unlimited and quantity != 1:
                raise StoreError("この商品は 1 回の注文につき 1 個です。")
            pending = db.execute(
                "SELECT COUNT(*) FROM orders WHERE guild_id = ? AND user_id = ? AND status = ?",
                (guild_id, user_id, PENDING),
            ).fetchone()[0]
            if pending >= max_pending:
                raise StoreError(f"確認待ちの注文が {pending} 件あります。処理が終わってから注文してください。")
            stock_ids: list[int] = []
            if not product.unlimited:
                stock_ids = [
                    r["id"]
                    for r in db.execute(
                        "SELECT id FROM stock WHERE product_id = ? AND order_id IS NULL ORDER BY id LIMIT ?",
                        (product_id, quantity),
                    )
                ]
                if len(stock_ids) < quantity:
                    if not stock_ids:
                        raise StoreError("申し訳ありません、売り切れです。")
                    raise StoreError(f"在庫が足りません (残り {len(stock_ids)} 個)。")
            cur = db.execute(
                "INSERT INTO orders (guild_id, user_id, product_id, product_name, quantity, unit_price, total,"
                " payment_note, role_id, status, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    guild_id,
                    user_id,
                    product_id,
                    product.name,
                    quantity,
                    product.price,
                    product.price * quantity,
                    payment_note,
                    product.role_id,
                    PENDING,
                    now,
                    now,
                ),
            )
            order_id = cur.lastrowid
            assert order_id is not None
            db.executemany("UPDATE stock SET order_id = ? WHERE id = ?", [(order_id, sid) for sid in stock_ids])
        order = self.get_order(guild_id, order_id)
        assert order is not None
        return order

    def set_order_message(self, order_id: int, channel_id: int, message_id: int) -> None:
        with self._tx() as db:
            db.execute(
                "UPDATE orders SET admin_channel_id = ?, admin_message_id = ? WHERE id = ?",
                (channel_id, message_id, order_id),
            )

    def get_order(self, guild_id: int, order_id: int) -> Order | None:
        row = self.db.execute("SELECT * FROM orders WHERE id = ? AND guild_id = ?", (order_id, guild_id)).fetchone()
        return self._order(row) if row else None

    def list_orders(
        self, guild_id: int, *, status: str | None = None, user_id: int | None = None, limit: int = 25
    ) -> list[Order]:
        sql = "SELECT * FROM orders WHERE guild_id = ?"
        args: list[object] = [guild_id]
        if status is not None:
            sql += " AND status = ?"
            args.append(status)
        if user_id is not None:
            sql += " AND user_id = ?"
            args.append(user_id)
        sql += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
        return [self._order(r) for r in self.db.execute(sql, args).fetchall()]

    def _pending_order(self, db: sqlite3.Connection, guild_id: int, order_id: int) -> Order:
        row = db.execute("SELECT * FROM orders WHERE id = ? AND guild_id = ?", (order_id, guild_id)).fetchone()
        if row is None:
            raise StoreError("注文が見つかりません。")
        order = self._order(row)
        if order.status != PENDING:
            raise StoreError(f"注文 #{order.id} はすでに処理済みです。")
        return order

    def approve_order(self, guild_id: int, order_id: int, admin_id: int) -> Order:
        with self._tx() as db:
            order = self._pending_order(db, guild_id, order_id)
            items = [
                r["content"]
                for r in db.execute("SELECT content FROM stock WHERE order_id = ? ORDER BY id", (order_id,))
            ]
            if not items:
                product = db.execute(
                    "SELECT unlimited_content FROM products WHERE id = ?", (order.product_id,)
                ).fetchone()
                content = product["unlimited_content"] if product else None
                if content is None:
                    raise StoreError("お渡しする在庫が見つかりません。")
                items = [content]
            db.execute(
                "UPDATE orders SET status = ?, delivered = ?, handled_by = ?, updated_at = ? WHERE id = ?",
                (COMPLETED, "\n".join(items), admin_id, _now(), order_id),
            )
        approved = self.get_order(guild_id, order_id)
        assert approved is not None
        return approved

    def reject_order(self, guild_id: int, order_id: int, admin_id: int, reason: str = "") -> Order:
        return self._close_order(guild_id, order_id, REJECTED, admin_id, reason.strip() or None)

    def cancel_order(self, guild_id: int, order_id: int, user_id: int | None) -> Order:
        """user_id が None ならシステムによる取り消し (本人確認をしない)"""
        if user_id is not None:
            order = self.get_order(guild_id, order_id)
            if order is None or order.user_id != user_id:
                raise StoreError("注文が見つかりません。")
        return self._close_order(guild_id, order_id, CANCELLED, user_id, None)

    def _close_order(
        self, guild_id: int, order_id: int, status: str, actor_id: int | None, reason: str | None
    ) -> Order:
        with self._tx() as db:
            self._pending_order(db, guild_id, order_id)
            db.execute("UPDATE stock SET order_id = NULL WHERE order_id = ?", (order_id,))
            db.execute(
                "UPDATE orders SET status = ?, reason = ?, handled_by = ?, updated_at = ? WHERE id = ?",
                (status, reason, actor_id, _now(), order_id),
            )
        closed = self.get_order(guild_id, order_id)
        assert closed is not None
        return closed

    def sales(self, guild_id: int) -> Sales:
        total = self.db.execute(
            "SELECT COUNT(*), COALESCE(SUM(quantity), 0), COALESCE(SUM(total), 0) FROM orders"
            " WHERE guild_id = ? AND status = ?",
            (guild_id, COMPLETED),
        ).fetchone()
        pending = self.db.execute(
            "SELECT COUNT(*) FROM orders WHERE guild_id = ? AND status = ?", (guild_id, PENDING)
        ).fetchone()[0]
        top = self.db.execute(
            "SELECT product_name, SUM(quantity) AS items, SUM(total) AS revenue FROM orders"
            " WHERE guild_id = ? AND status = ? GROUP BY product_id ORDER BY revenue DESC LIMIT 10",
            (guild_id, COMPLETED),
        ).fetchall()
        return Sales(
            orders=total[0],
            items=total[1],
            revenue=total[2],
            pending=pending,
            top=[(r["product_name"], r["items"], r["revenue"]) for r in top],
        )

    # ---------- パネル ----------
    def add_panel(self, message_id: int, guild_id: int, channel_id: int, title: str, description: str) -> Panel:
        with self._tx() as db:
            db.execute(
                "INSERT OR REPLACE INTO panels (message_id, guild_id, channel_id, title, description)"
                " VALUES (?, ?, ?, ?, ?)",
                (message_id, guild_id, channel_id, title, description),
            )
        return Panel(message_id, guild_id, channel_id, title, description)

    def get_panel(self, message_id: int) -> Panel | None:
        row = self.db.execute("SELECT * FROM panels WHERE message_id = ?", (message_id,)).fetchone()
        return Panel(**dict(row)) if row else None

    def list_panels(self, guild_id: int) -> list[Panel]:
        rows = self.db.execute("SELECT * FROM panels WHERE guild_id = ? ORDER BY message_id", (guild_id,)).fetchall()
        return [Panel(**dict(r)) for r in rows]

    def remove_panel(self, message_id: int) -> None:
        with self._tx() as db:
            db.execute("DELETE FROM panels WHERE message_id = ?", (message_id,))
