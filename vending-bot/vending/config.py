"""環境変数 (と .env ファイル) から設定を読み込みます。"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Config:
    token: str
    database_path: Path
    sync_guild_id: int | None
    max_quantity: int
    max_pending: int


def load_env_file(path: Path) -> None:
    """KEY=VALUE 形式の .env を読み込む。すでに設定されている環境変数は上書きしない"""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().removeprefix("export ").strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        os.environ.setdefault(key, value)


def _int(name: str, default: int | None) -> int | None:
    value = os.environ.get(name, "").strip()
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        raise SystemExit(f"{name} は数字で指定してください (いまの値: {value!r})") from None


def load_config(base_dir: Path) -> Config:
    load_env_file(base_dir / ".env")
    token = os.environ.get("DISCORD_TOKEN", "").strip()
    if not token:
        raise SystemExit("DISCORD_TOKEN が設定されていません。.env.example を .env にコピーして Bot のトークンを書いてください。")
    db_path = Path(os.environ.get("DATABASE_PATH", "") or base_dir / "data" / "vending.db")
    if not db_path.is_absolute():
        db_path = base_dir / db_path
    return Config(
        token=token,
        database_path=db_path,
        sync_guild_id=_int("SYNC_GUILD_ID", None),
        max_quantity=_int("MAX_QUANTITY", 50) or 50,
        max_pending=_int("MAX_PENDING_ORDERS", 3) or 3,
    )
