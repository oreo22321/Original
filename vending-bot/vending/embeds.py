"""Discord に表示する埋め込み (Embed) を組み立てます。"""
from __future__ import annotations

import io
from typing import Any, Sequence

import discord

from .store import CANCELLED, COMPLETED, PENDING, REJECTED, Order, Product, Sales, Settings

BRAND = discord.Color.from_rgb(88, 101, 242)

STATUS_LABELS = {
    PENDING: "⏳ 確認待ち",
    COMPLETED: "✅ 完了",
    REJECTED: "❌ 却下",
    CANCELLED: "🚫 キャンセル",
}
STATUS_COLORS = {
    PENDING: discord.Color.gold(),
    COMPLETED: discord.Color.green(),
    REJECTED: discord.Color.red(),
    CANCELLED: discord.Color.dark_grey(),
}

DEFAULT_PANEL_TITLE = "🛒 自販機"
DEFAULT_PANEL_DESCRIPTION = "下のメニューから商品を選ぶと、詳細と購入方法が表示されます。"


def yen(amount: int) -> str:
    return f"{amount:,}円"


def clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def stock_label(product: Product) -> str:
    if product.unlimited:
        return "無制限"
    if product.sold_out:
        return "売り切れ"
    return f"在庫 {product.stock} 個"


def timestamp(ts: int, style: str = "f") -> str:
    return f"<t:{ts}:{style}>"


def panel_embed(title: str, description: str, products: Sequence[Product]) -> discord.Embed:
    embed = discord.Embed(title=clip(title, 256), description=clip(description, 2000), color=BRAND)
    for product in products[:25]:
        name = ("❌ " if product.sold_out else "") + clip(product.name, 200)
        embed.add_field(name=name, value=f"💴 **{yen(product.price)}**\n📦 {stock_label(product)}", inline=True)
    if not products:
        embed.add_field(name="準備中", value="現在販売中の商品はありません。", inline=False)
    footer = "商品を選ぶと詳細と購入方法が表示されます"
    if len(products) > 25:
        footer = f"ほか {len(products) - 25} 件の商品もメニューから選べます"
    embed.set_footer(text=footer)
    return embed


def product_embed(product: Product, settings: Settings) -> discord.Embed:
    embed = discord.Embed(title=f"🛍️ {clip(product.name, 240)}", description=product.description or None, color=BRAND)
    embed.add_field(name="価格", value=yen(product.price))
    embed.add_field(name="在庫", value=stock_label(product))
    if product.role_id:
        embed.add_field(name="特典", value=f"購入すると <@&{product.role_id}> が付きます", inline=False)
    embed.add_field(
        name="お支払い方法",
        value=clip(settings.payment_info, 1024) if settings.payment_info else "管理者にお問い合わせください。",
        inline=False,
    )
    embed.add_field(
        name="購入の流れ",
        value=(
            "① 上のお支払い方法で代金を支払う\n"
            "② 「購入手続きへ」を押して、数量と支払いの確認情報を入力\n"
            "③ 管理者が支払いを確認すると、商品が DM で届きます"
        ),
        inline=False,
    )
    if product.sold_out:
        embed.set_footer(text="売り切れ中です。入荷までお待ちください。")
    return embed


def admin_order_embed(order: Order, notes: Sequence[str] = ()) -> discord.Embed:
    embed = discord.Embed(title=f"注文 #{order.id}", color=STATUS_COLORS[order.status])
    embed.add_field(name="状態", value=STATUS_LABELS[order.status])
    embed.add_field(name="購入者", value=f"<@{order.user_id}>\n`{order.user_id}`")
    embed.add_field(name="受付", value=timestamp(order.created_at))
    embed.add_field(name="商品", value=f"{clip(order.product_name, 200)} × {order.quantity}")
    amount = f"**{yen(order.total)}**"
    if order.quantity > 1:
        amount += f"\n({yen(order.unit_price)} × {order.quantity})"
    embed.add_field(name="金額", value=amount)
    if order.role_id:
        embed.add_field(name="付与ロール", value=f"<@&{order.role_id}>")
    embed.add_field(name="支払いの確認情報", value=clip(order.payment_note, 1024), inline=False)
    if order.status != PENDING and order.handled_by:
        embed.add_field(name="処理", value=f"<@{order.handled_by}> ・ {timestamp(order.updated_at, 'R')}", inline=False)
    if order.reason:
        embed.add_field(name="却下の理由", value=clip(order.reason, 1024), inline=False)
    if notes:
        embed.add_field(name="メモ", value=clip("\n".join(notes), 1024), inline=False)
    if order.status == PENDING:
        embed.set_footer(text="入金を確認してから「承認」を押してください。承認すると商品が購入者に送られます。")
    return embed


CUSTOMER_MESSAGES = {
    PENDING: "管理者が支払いを確認しています。確認が終わると商品が DM で届きます。",
    COMPLETED: "商品を DM でお送りしました。届いていない場合は `/history` から確認できます。",
    REJECTED: "この注文は却下されました。ご不明な点は管理者にお問い合わせください。",
    CANCELLED: "この注文はキャンセルされました。",
}


def customer_order_embed(order: Order) -> discord.Embed:
    embed = discord.Embed(
        title=f"注文 #{order.id}",
        description=CUSTOMER_MESSAGES[order.status],
        color=STATUS_COLORS[order.status],
    )
    embed.add_field(name="状態", value=STATUS_LABELS[order.status])
    embed.add_field(name="商品", value=f"{clip(order.product_name, 200)} × {order.quantity}")
    embed.add_field(name="金額", value=yen(order.total))
    if order.reason:
        embed.add_field(name="理由", value=clip(order.reason, 1024), inline=False)
    embed.add_field(name="受付", value=timestamp(order.created_at), inline=False)
    return embed


def _all_links(lines: Sequence[str]) -> bool:
    return bool(lines) and all(line.startswith(("https://", "http://")) and " " not in line for line in lines)


def delivery_payload(order: Order, guild_name: str = "") -> dict[str, Any]:
    """購入者に商品を渡すメッセージ (send や followup.send にそのまま渡せる引数)"""
    items = order.delivered or ""
    embed = discord.Embed(title="🎁 ご購入ありがとうございます", color=discord.Color.green())
    embed.add_field(name="注文", value=f"#{order.id}")
    embed.add_field(name="商品", value=f"{clip(order.product_name, 200)} × {order.quantity}")
    embed.add_field(name="金額", value=yen(order.total))
    if guild_name:
        embed.set_footer(text=clip(guild_name, 100))
    payload: dict[str, Any] = {"embed": embed}
    lines = items.splitlines()
    if len(items) <= 3800 and "```" not in items:
        # リンクだけならタップで開けるようにそのまま、それ以外はコピーしやすいコードブロックで
        embed.description = items if _all_links(lines) else f"```\n{items}\n```"
    else:
        embed.description = "商品は添付ファイルに入っています。"
        payload["file"] = discord.File(io.BytesIO(items.encode("utf-8")), filename=f"order-{order.id}.txt")
    return payload


def products_embed(products: Sequence[Product]) -> discord.Embed:
    embed = discord.Embed(title="📋 商品一覧", color=BRAND)
    if not products:
        embed.description = "商品はまだありません。`/product add` で追加できます。"
        return embed
    lines = []
    for p in products:
        line = f"`#{p.id}` **{clip(p.name, 80)}** — {yen(p.price)} ・ {stock_label(p)}"
        if p.role_id:
            line += f" ・ 🏷️ <@&{p.role_id}>"
        lines.append(line)
    embed.description = clip("\n".join(lines), 4000)
    return embed


def orders_embed(orders: Sequence[Order], title: str) -> discord.Embed:
    embed = discord.Embed(title=title, color=BRAND)
    if not orders:
        embed.description = "該当する注文はありません。"
        return embed
    lines = []
    for o in orders:
        line = (
            f"`#{o.id}` {timestamp(o.created_at, 'd')} <@{o.user_id}> "
            f"{clip(o.product_name, 40)} × {o.quantity} — {yen(o.total)} ・ {STATUS_LABELS[o.status]}"
        )
        if o.admin_channel_id and o.admin_message_id:
            line += f" [→](https://discord.com/channels/{o.guild_id}/{o.admin_channel_id}/{o.admin_message_id})"
        lines.append(line)
    embed.description = clip("\n".join(lines), 4000)
    return embed


def history_embed(orders: Sequence[Order]) -> discord.Embed:
    embed = discord.Embed(title="🧾 購入履歴", color=BRAND)
    if not orders:
        embed.description = "まだ注文はありません。"
        return embed
    lines = [
        f"`#{o.id}` {timestamp(o.created_at, 'd')} {clip(o.product_name, 60)} × {o.quantity}"
        f" — {yen(o.total)} ・ {STATUS_LABELS[o.status]}"
        for o in orders
    ]
    embed.description = clip("\n".join(lines), 4000)
    embed.set_footer(text="下のメニューから注文を選ぶと、受け取った商品の確認やキャンセルができます")
    return embed


def sales_embed(sales: Sales) -> discord.Embed:
    embed = discord.Embed(title="📈 売上", color=BRAND)
    embed.add_field(name="売上金額", value=yen(sales.revenue))
    embed.add_field(name="完了した注文", value=f"{sales.orders} 件 ({sales.items} 個)")
    embed.add_field(name="確認待ち", value=f"{sales.pending} 件")
    if sales.top:
        embed.add_field(
            name="商品別",
            value=clip("\n".join(f"{clip(n, 60)} — {i} 個 ・ {yen(r)}" for n, i, r in sales.top), 1024),
            inline=False,
        )
    return embed


def settings_embed(settings: Settings) -> discord.Embed:
    embed = discord.Embed(title="⚙️ 自販機の設定", color=BRAND)
    embed.add_field(
        name="注文の確認チャンネル",
        value=f"<#{settings.admin_channel_id}>" if settings.admin_channel_id else "未設定 (`/setup channel`)",
    )
    embed.add_field(
        name="担当ロール",
        value=f"<@&{settings.admin_role_id}>" if settings.admin_role_id else "なし (サーバー管理権限を持つ人)",
    )
    embed.add_field(
        name="支払い方法",
        value=clip(settings.payment_info, 1024) if settings.payment_info else "未設定 (`/setup payment`)",
        inline=False,
    )
    return embed
