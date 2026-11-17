"""ボタン・メニュー・入力フォーム と、注文の受付から受け渡しまでの流れ。

ボタンとメニューは DynamicItem (custom_id に商品 ID や注文番号を入れる) なので、
Bot を再起動しても以前に送ったパネルや承認ボタンがそのまま使えます。
"""
from __future__ import annotations

import functools
import io
import logging
import re
from typing import TYPE_CHECKING, Any, Callable, Coroutine, Sequence, TypeVar, cast

import discord
from discord import ui

from . import embeds
from .embeds import clip
from .store import PENDING, Order, Product, StoreError

if TYPE_CHECKING:
    from .client import VendingBot

log = logging.getLogger(__name__)

PANEL_PAGE_SIZE = 25
MAX_PANEL_MENUS = 5
FULLWIDTH_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")


def bot_of(interaction: discord.Interaction) -> VendingBot:
    return interaction.client  # type: ignore[return-value]


async def reply(interaction: discord.Interaction, content: str | None = None, **kwargs: Any) -> None:
    """応答済みかどうかに関係なく、本人にだけ見えるメッセージを送る"""
    kwargs.setdefault("ephemeral", True)
    if content is not None:
        kwargs["content"] = content
    if interaction.response.is_done():
        await interaction.followup.send(**kwargs)
    else:
        await interaction.response.send_message(**kwargs)


Handler = TypeVar("Handler", bound=Callable[..., Coroutine[Any, Any, None]])


def guarded(func: Handler) -> Handler:
    """コールバックの例外をログに残し、操作した人には理由 (StoreError) か汎用メッセージを返す"""

    @functools.wraps(func)
    async def wrapper(self: Any, interaction: discord.Interaction, *args: Any) -> None:
        try:
            await func(self, interaction, *args)
        except StoreError as error:
            await _safe_reply(interaction, f"⚠️ {error}")
        except Exception:
            log.exception("操作の処理中にエラー: %s", type(self).__name__)
            await _safe_reply(interaction, "⚠️ エラーが発生しました。しばらくしてからもう一度お試しください。")

    return cast(Handler, wrapper)


async def _safe_reply(interaction: discord.Interaction, content: str) -> None:
    try:
        await reply(interaction, content)
    except discord.HTTPException:
        pass


def parse_number(text: str) -> int | None:
    text = text.strip().translate(FULLWIDTH_DIGITS).replace(",", "")
    return int(text) if text.isascii() and text.isdigit() else None


def is_admin(interaction: discord.Interaction) -> bool:
    member = interaction.user
    if not isinstance(member, discord.Member) or interaction.guild_id is None:
        return False
    if member.guild_permissions.manage_guild:
        return True
    role_id = bot_of(interaction).store.get_settings(interaction.guild_id).admin_role_id
    return role_id is not None and member.get_role(role_id) is not None


async def require_admin(interaction: discord.Interaction) -> bool:
    if is_admin(interaction):
        return True
    await reply(interaction, "この操作は管理者 (サーバー管理権限か担当ロールを持つ人) だけができます。")
    return False


# ---------------------------------------------------------------- パネル

def panel_view(products: Sequence[Product]) -> ui.View:
    view = ui.View(timeout=None)
    if not products:
        view.add_item(
            PanelSelect(
                ui.Select(
                    custom_id="vend:panel:0",
                    placeholder="現在販売中の商品はありません",
                    options=[discord.SelectOption(label="準備中", value="none")],
                    disabled=True,
                )
            )
        )
        return view
    pages = [products[i : i + PANEL_PAGE_SIZE] for i in range(0, len(products), PANEL_PAGE_SIZE)]
    for index, page in enumerate(pages[:MAX_PANEL_MENUS]):
        placeholder = "🛒 商品を選んでください"
        if len(pages) > 1:
            first = index * PANEL_PAGE_SIZE + 1
            placeholder += f" ({first}〜{first + len(page) - 1})"
        options = [
            discord.SelectOption(
                label=clip(p.name, 100),
                value=str(p.id),
                description=clip(f"{embeds.yen(p.price)} ・ {embeds.stock_label(p)}", 100),
                emoji="❌" if p.sold_out else "🛍️",
            )
            for p in page
        ]
        view.add_item(PanelSelect(ui.Select(custom_id=f"vend:panel:{index}", placeholder=placeholder, options=options)))
    return view


class PanelSelect(ui.DynamicItem[ui.Select], template=r"vend:panel:(?P<page>[0-9]+)"):
    @classmethod
    async def from_custom_id(
        cls, interaction: discord.Interaction, item: ui.Item[Any], match: re.Match[str], /
    ) -> PanelSelect:
        return cls(cast(ui.Select, item))

    @guarded
    async def callback(self, interaction: discord.Interaction) -> None:
        bot = bot_of(interaction)
        guild_id = interaction.guild_id
        value = self.item.values[0] if self.item.values else ""
        if guild_id is None or not value.isdigit():
            await reply(interaction, "この商品は選べません。")
            return
        # 選択したままの表示を戻し、在庫数も最新にする
        bot.panels.schedule(guild_id)
        product = bot.store.get_product(guild_id, int(value))
        if product is None:
            await reply(interaction, "この商品は販売を終了しました。")
            return
        settings = bot.store.get_settings(guild_id)
        await reply(interaction, embed=embeds.product_embed(product, settings), view=buy_view(product))


# ---------------------------------------------------------------- 購入

def buy_view(product: Product) -> ui.View:
    view = ui.View(timeout=None)
    view.add_item(BuyButton(product.id, disabled=product.sold_out))
    return view


class BuyButton(ui.DynamicItem[ui.Button], template=r"vend:buy:(?P<product>[0-9]+)"):
    def __init__(self, product_id: int, *, disabled: bool = False) -> None:
        super().__init__(
            ui.Button(
                label="購入手続きへ",
                emoji="🛒",
                style=discord.ButtonStyle.success,
                custom_id=f"vend:buy:{product_id}",
                disabled=disabled,
            )
        )
        self.product_id = product_id

    @classmethod
    async def from_custom_id(
        cls, interaction: discord.Interaction, item: ui.Item[Any], match: re.Match[str], /
    ) -> BuyButton:
        return cls(int(match["product"]))

    @guarded
    async def callback(self, interaction: discord.Interaction) -> None:
        bot = bot_of(interaction)
        guild_id = interaction.guild_id
        product = bot.store.get_product(guild_id, self.product_id) if guild_id else None
        if product is None:
            await reply(interaction, "この商品は販売を終了しました。")
            return
        if product.sold_out:
            await reply(interaction, "申し訳ありません、売り切れです。")
            return
        if bot.store.get_settings(product.guild_id).admin_channel_id is None:
            await reply(interaction, "まだ注文を受け付けていません (管理者が `/setup channel` を設定する必要があります)。")
            return
        await interaction.response.send_modal(PurchaseModal(product, bot.config.max_quantity))


class BaseModal(ui.Modal):
    def field(self, text: str, component: ui.TextInput, description: str | None = None) -> ui.TextInput:
        """見出し (と補足) つきの入力欄を追加する"""
        self.add_item(ui.Label(text=text, description=description, component=component))
        return component

    async def on_error(self, interaction: discord.Interaction, error: Exception) -> None:  # type: ignore[override]
        if isinstance(error, StoreError):
            await _safe_reply(interaction, f"⚠️ {error}")
            return
        log.exception("フォームの処理中にエラー: %s", type(self).__name__, exc_info=error)
        await _safe_reply(interaction, "⚠️ エラーが発生しました。しばらくしてからもう一度お試しください。")


class PurchaseModal(BaseModal):
    def __init__(self, product: Product, max_quantity: int) -> None:
        super().__init__(title=clip(f"購入: {product.name}", 45), timeout=900)
        self.product_id = product.id
        self.quantity: ui.TextInput | None = None
        if not product.unlimited:
            limit = max(1, min(max_quantity, product.stock or 1))
            self.quantity = self.field(
                "数量",
                ui.TextInput(default="1", min_length=1, max_length=5),
                f"1〜{limit} 個 ・ 1 個 {embeds.yen(product.price)}",
            )
        self.note = self.field(
            "お支払いの確認情報",
            ui.TextInput(style=discord.TextStyle.paragraph, placeholder="例: 11/17 12:30 振込 ヤマダタロウ", max_length=500),
            "支払った日時・名義・取引 ID など、管理者が支払いを確認できる情報",
        )

    async def on_submit(self, interaction: discord.Interaction) -> None:  # type: ignore[override]
        quantity = 1
        if self.quantity is not None:
            parsed = parse_number(self.quantity.value)
            if parsed is None:
                await reply(interaction, "数量は数字で入力してください。")
                return
            quantity = parsed
        await place_order(interaction, self.product_id, quantity, self.note.value)


async def place_order(interaction: discord.Interaction, product_id: int, quantity: int, note: str) -> None:
    bot = bot_of(interaction)
    guild_id = interaction.guild_id
    if guild_id is None:
        await reply(interaction, "サーバーの中で注文してください。")
        return
    await interaction.response.defer(ephemeral=True, thinking=True)
    settings = bot.store.get_settings(guild_id)
    channel = await bot.resolve_channel(settings.admin_channel_id)
    if channel is None:
        await reply(interaction, "注文の確認チャンネルが見つかりません。お手数ですが管理者に連絡してください。")
        return
    order = bot.store.create_order(
        guild_id,
        interaction.user.id,
        product_id,
        quantity,
        note,
        max_quantity=bot.config.max_quantity,
        max_pending=bot.config.max_pending,
    )
    content = f"<@&{settings.admin_role_id}> 新しい注文です" if settings.admin_role_id else "🛎️ 新しい注文です"
    try:
        message = await channel.send(
            content,
            embed=embeds.admin_order_embed(order),
            view=admin_view(order.id),
            allowed_mentions=discord.AllowedMentions(everyone=False, users=False, roles=True),
        )
    except discord.HTTPException:
        log.exception("注文 #%s を確認チャンネルに送れませんでした", order.id)
        bot.store.cancel_order(guild_id, order.id, None)
        await reply(interaction, "注文の確認チャンネルに送信できませんでした。お手数ですが管理者に連絡してください。")
        return
    bot.store.set_order_message(order.id, message.channel.id, message.id)
    await reply(interaction, embed=embeds.customer_order_embed(order), view=cancel_view(order.id))
    bot.panels.schedule(guild_id)


# ---------------------------------------------------------------- 管理者の承認・却下

def admin_view(order_id: int) -> ui.View:
    view = ui.View(timeout=None)
    view.add_item(ApproveButton(order_id))
    view.add_item(RejectButton(order_id))
    return view


class ApproveButton(ui.DynamicItem[ui.Button], template=r"vend:approve:(?P<order>[0-9]+)"):
    def __init__(self, order_id: int) -> None:
        super().__init__(
            ui.Button(
                label="承認して商品を送る",
                emoji="✅",
                style=discord.ButtonStyle.success,
                custom_id=f"vend:approve:{order_id}",
            )
        )
        self.order_id = order_id

    @classmethod
    async def from_custom_id(
        cls, interaction: discord.Interaction, item: ui.Item[Any], match: re.Match[str], /
    ) -> ApproveButton:
        return cls(int(match["order"]))

    async def interaction_check(self, interaction: discord.Interaction) -> bool:  # type: ignore[override]
        return await require_admin(interaction)

    @guarded
    async def callback(self, interaction: discord.Interaction) -> None:
        bot = bot_of(interaction)
        guild = interaction.guild
        assert guild is not None
        await interaction.response.defer()
        try:
            order = bot.store.approve_order(guild.id, self.order_id, interaction.user.id)
        except StoreError as error:
            await reply(interaction, f"⚠️ {error}")
            current = bot.store.get_order(guild.id, self.order_id)
            if current and current.status != PENDING:
                await interaction.edit_original_response(embed=embeds.admin_order_embed(current), view=None)
            return
        notes = await deliver(bot, guild, order)
        await interaction.edit_original_response(embed=embeds.admin_order_embed(order, notes), view=None)


class RejectButton(ui.DynamicItem[ui.Button], template=r"vend:reject:(?P<order>[0-9]+)"):
    def __init__(self, order_id: int) -> None:
        super().__init__(
            ui.Button(
                label="却下",
                emoji="✖️",
                style=discord.ButtonStyle.danger,
                custom_id=f"vend:reject:{order_id}",
            )
        )
        self.order_id = order_id

    @classmethod
    async def from_custom_id(
        cls, interaction: discord.Interaction, item: ui.Item[Any], match: re.Match[str], /
    ) -> RejectButton:
        return cls(int(match["order"]))

    async def interaction_check(self, interaction: discord.Interaction) -> bool:  # type: ignore[override]
        return await require_admin(interaction)

    @guarded
    async def callback(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_modal(RejectModal(self.order_id))


class RejectModal(BaseModal):
    def __init__(self, order_id: int) -> None:
        super().__init__(title=f"注文 #{order_id} を却下", timeout=900)
        self.order_id = order_id
        self.reason = self.field(
            "理由 (省略可)",
            ui.TextInput(
                style=discord.TextStyle.paragraph,
                placeholder="例: 入金が確認できませんでした",
                required=False,
                max_length=500,
            ),
            "購入者に DM で送られます。却下すると予約していた在庫は販売中に戻ります",
        )

    async def on_submit(self, interaction: discord.Interaction) -> None:  # type: ignore[override]
        bot = bot_of(interaction)
        guild_id = interaction.guild_id
        assert guild_id is not None
        await interaction.response.defer()
        order = bot.store.reject_order(guild_id, self.order_id, interaction.user.id, self.reason.value)
        notes = []
        if await send_dm(bot, order.user_id, embed=embeds.customer_order_embed(order)):
            notes.append("📨 購入者に却下を通知しました。")
        else:
            notes.append("⚠️ 購入者に DM で通知できませんでした。")
        await interaction.edit_original_response(embed=embeds.admin_order_embed(order, notes), view=None)
        bot.panels.schedule(guild_id)


async def send_dm(bot: VendingBot, user_id: int, **kwargs: Any) -> bool:
    try:
        user = bot.get_user(user_id) or await bot.fetch_user(user_id)
        await user.send(**kwargs)
        return True
    except discord.HTTPException:
        return False


async def deliver(bot: VendingBot, guild: discord.Guild, order: Order) -> list[str]:
    """承認した注文の商品を DM で送り、ロールを付ける。結果を管理者向けのメモで返す"""
    notes = []
    if await send_dm(bot, order.user_id, **embeds.delivery_payload(order, guild.name)):
        notes.append("📨 購入者に DM で商品を送りました。")
    else:
        notes.append("⚠️ DM を送れませんでした (DM を閉じている可能性)。購入者は `/history` から受け取れます。")
    if order.role_id:
        role = guild.get_role(order.role_id)
        if role is None:
            notes.append("⚠️ 付与するロールが見つかりません。")
        else:
            try:
                member = guild.get_member(order.user_id) or await guild.fetch_member(order.user_id)
                await member.add_roles(role, reason=f"自販機: 注文 #{order.id}")
                notes.append(f"🏷️ {role.mention} を付与しました。")
            except discord.NotFound:
                notes.append("⚠️ 購入者がサーバーにいないため、ロールを付与できませんでした。")
            except discord.HTTPException:
                notes.append(
                    "⚠️ ロールを付与できませんでした。Bot に「ロールの管理」権限があり、"
                    "Bot のロールが付与するロールより上にあるか確認してください。"
                )
    return notes


async def update_admin_message(bot: VendingBot, order: Order, notes: Sequence[str] = ()) -> None:
    if not (order.admin_channel_id and order.admin_message_id):
        return
    channel = await bot.resolve_channel(order.admin_channel_id)
    if channel is None or not hasattr(channel, "get_partial_message"):
        return
    try:
        await channel.get_partial_message(order.admin_message_id).edit(  # type: ignore[union-attr]
            embed=embeds.admin_order_embed(order, notes), view=None
        )
    except discord.HTTPException:
        log.warning("注文 #%s の確認メッセージを更新できませんでした", order.id)


# ---------------------------------------------------------------- 購入者のキャンセル・履歴

def cancel_view(order_id: int) -> ui.View:
    view = ui.View(timeout=None)
    view.add_item(CancelButton(order_id))
    return view


class CancelButton(ui.DynamicItem[ui.Button], template=r"vend:cancel:(?P<order>[0-9]+)"):
    def __init__(self, order_id: int) -> None:
        super().__init__(
            ui.Button(
                label="注文をキャンセル",
                emoji="🚫",
                style=discord.ButtonStyle.secondary,
                custom_id=f"vend:cancel:{order_id}",
            )
        )
        self.order_id = order_id

    @classmethod
    async def from_custom_id(
        cls, interaction: discord.Interaction, item: ui.Item[Any], match: re.Match[str], /
    ) -> CancelButton:
        return cls(int(match["order"]))

    @guarded
    async def callback(self, interaction: discord.Interaction) -> None:
        bot = bot_of(interaction)
        guild_id = interaction.guild_id
        assert guild_id is not None
        order = bot.store.cancel_order(guild_id, self.order_id, interaction.user.id)
        await interaction.response.edit_message(embed=embeds.customer_order_embed(order), view=None)
        await update_admin_message(bot, order, ["🚫 購入者がキャンセルしました。"])
        bot.panels.schedule(guild_id)


class HistoryView(ui.View):
    def __init__(self, user_id: int, orders: Sequence[Order]) -> None:
        super().__init__(timeout=300)
        self.user_id = user_id
        select: ui.Select = ui.Select(
            placeholder="注文を選んで詳細を表示",
            options=[
                discord.SelectOption(
                    label=clip(f"#{o.id} {o.product_name} × {o.quantity}", 100),
                    value=str(o.id),
                    description=clip(f"{embeds.yen(o.total)} ・ {embeds.STATUS_LABELS[o.status]}", 100),
                )
                for o in orders[:25]
            ],
        )
        select.callback = self.show  # type: ignore[method-assign, assignment]
        self.select = select
        self.add_item(select)

    async def interaction_check(self, interaction: discord.Interaction) -> bool:  # type: ignore[override]
        return interaction.user.id == self.user_id

    @guarded
    async def show(self, interaction: discord.Interaction) -> None:
        bot = bot_of(interaction)
        guild = interaction.guild
        assert guild is not None
        order = bot.store.get_order(guild.id, int(self.select.values[0]))
        if order is None or order.user_id != interaction.user.id:
            await reply(interaction, "注文が見つかりません。")
        elif order.delivered is not None:
            await reply(interaction, **embeds.delivery_payload(order, guild.name))
        elif order.status == PENDING:
            await reply(interaction, embed=embeds.customer_order_embed(order), view=cancel_view(order.id))
        else:
            await reply(interaction, embed=embeds.customer_order_embed(order))


# ---------------------------------------------------------------- 管理用フォーム

class ProductModal(BaseModal):
    def __init__(self, *, product: Product | None = None, role_id: int | None = None) -> None:
        super().__init__(title="商品を編集" if product else "商品を追加", timeout=900)
        self.product_id = product.id if product else None
        self.role_id = role_id
        self.name = self.field("商品名", ui.TextInput(max_length=100, default=product.name if product else None))
        self.price = self.field(
            "価格 (円)",
            ui.TextInput(max_length=10, placeholder="例: 500", default=str(product.price) if product else None),
        )
        self.description = self.field(
            "説明 (省略可)",
            ui.TextInput(
                style=discord.TextStyle.paragraph,
                required=False,
                max_length=1000,
                default=product.description if product else None,
            ),
        )
        self.unlimited = self.field(
            "全員に同じものを渡す (省略可)",
            ui.TextInput(
                style=discord.TextStyle.paragraph,
                required=False,
                max_length=1500,
                placeholder="例: ダウンロードリンク",
                default=product.unlimited_content if product else None,
            ),
            "書くと在庫なしで全員にこの内容を渡します。空欄なら /stock add で 1 行 = 1 個の在庫制",
        )

    async def on_submit(self, interaction: discord.Interaction) -> None:  # type: ignore[override]
        bot = bot_of(interaction)
        guild_id = interaction.guild_id
        assert guild_id is not None
        price = parse_number(self.price.value)
        if price is None:
            await reply(interaction, "価格は数字で入力してください (例: 500)。")
            return
        unlimited = self.unlimited.value.strip() or None
        if self.product_id is None:
            product = bot.store.add_product(
                guild_id, self.name.value, price, self.description.value, unlimited, self.role_id
            )
            message = f"✅ 商品「{product.name}」を追加しました。"
        else:
            product = bot.store.update_product(
                guild_id,
                self.product_id,
                name=self.name.value,
                price=price,
                description=self.description.value,
                unlimited_content=unlimited,
            )
            message = f"✅ 商品「{product.name}」を更新しました。"
        if not product.unlimited and product.sold_out:
            message += "\n`/stock add` で在庫を追加すると販売できます。"
        await reply(interaction, message, embed=embeds.product_embed(product, bot.store.get_settings(guild_id)))
        bot.panels.schedule(guild_id)


class StockModal(BaseModal):
    def __init__(self, product: Product) -> None:
        super().__init__(title=clip(f"在庫を追加: {product.name}", 45), timeout=900)
        self.product_id = product.id
        self.items = self.field(
            "在庫 (1 行に 1 個)",
            ui.TextInput(style=discord.TextStyle.paragraph, max_length=4000, placeholder="AAAA-1111\nBBBB-2222"),
            "コードやリンクなど。大量にあるときは /stock add の file に .txt を添付",
        )

    async def on_submit(self, interaction: discord.Interaction) -> None:  # type: ignore[override]
        guild_id = interaction.guild_id
        assert guild_id is not None
        await add_stock_and_reply(interaction, guild_id, self.product_id, self.items.value.splitlines())


async def add_stock_and_reply(
    interaction: discord.Interaction, guild_id: int, product_id: int, lines: Sequence[str]
) -> None:
    bot = bot_of(interaction)
    count = bot.store.add_stock(guild_id, product_id, lines)
    product = bot.store.get_product(guild_id, product_id)
    total = product.stock if product else "?"
    name = product.name if product else f"#{product_id}"
    await reply(interaction, f"📦 「{name}」に在庫を {count} 個追加しました (在庫 {total} 個)。")
    bot.panels.schedule(guild_id)


class PaymentModal(BaseModal):
    def __init__(self, current: str) -> None:
        super().__init__(title="支払い方法の設定", timeout=900)
        self.info = self.field(
            "購入者に表示する支払い方法",
            ui.TextInput(
                style=discord.TextStyle.paragraph,
                required=False,
                max_length=1000,
                placeholder="例: 〇〇銀行 〇〇支店 普通 1234567 (カ)〇〇",
                default=current or None,
            ),
            "振込先や送金先など。購入者は支払い後に「購入手続きへ」から確認情報を送ります",
        )

    async def on_submit(self, interaction: discord.Interaction) -> None:  # type: ignore[override]
        bot = bot_of(interaction)
        guild_id = interaction.guild_id
        assert guild_id is not None
        settings = bot.store.update_settings(guild_id, payment_info=self.info.value.strip())
        await reply(interaction, "✅ 支払い方法を保存しました。", embed=embeds.settings_embed(settings))


def text_file(lines: Sequence[str], filename: str) -> discord.File:
    return discord.File(io.BytesIO("\n".join(lines).encode("utf-8")), filename=filename)


DYNAMIC_ITEMS = (PanelSelect, BuyButton, ApproveButton, RejectButton, CancelButton)
