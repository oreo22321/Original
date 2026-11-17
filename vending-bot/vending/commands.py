"""スラッシュコマンド。管理用のコマンドは「サーバー管理」権限を持つ人にだけ表示されます。"""
from __future__ import annotations

from typing import Optional

import discord
from discord import app_commands

from . import embeds
from .embeds import clip
from .store import STATUSES, Product
from .ui import (
    HistoryView,
    PaymentModal,
    ProductModal,
    StockModal,
    add_stock_and_reply,
    bot_of,
    panel_view,
    reply,
    text_file,
)

ADMIN = discord.Permissions(manage_guild=True)
MAX_STOCK_FILE_BYTES = 2 * 1024 * 1024


async def product_autocomplete(interaction: discord.Interaction, current: str) -> list[app_commands.Choice[str]]:
    if interaction.guild_id is None:
        return []
    products = bot_of(interaction).store.list_products(interaction.guild_id)
    query = current.strip().casefold()
    if query:
        products = [p for p in products if query in p.name.casefold() or query == str(p.id)]
    return [
        app_commands.Choice(
            name=clip(f"{p.name} ({embeds.yen(p.price)} ・ {embeds.stock_label(p)})", 100), value=str(p.id)
        )
        for p in products[:25]
    ]


async def find_product(interaction: discord.Interaction, query: str) -> Product | None:
    assert interaction.guild_id is not None
    product = bot_of(interaction).store.find_product(interaction.guild_id, query)
    if product is None:
        await reply(interaction, "商品が見つかりません。候補の一覧から選んでください。")
    return product


class SetupGroup(app_commands.Group, name="setup", description="自販機の初期設定", guild_only=True, default_permissions=ADMIN):
    @app_commands.command(name="channel", description="注文が届くチャンネルと、承認できる担当ロールを設定します")
    @app_commands.describe(channel="注文の確認を行うチャンネル (購入者に見えない場所がおすすめ)", role="承認・却下できる担当ロール (省略するとサーバー管理権限を持つ人だけ)")
    async def channel(
        self, interaction: discord.Interaction, channel: discord.TextChannel, role: Optional[discord.Role] = None
    ) -> None:
        assert interaction.guild is not None
        store = bot_of(interaction).store
        settings = store.update_settings(
            interaction.guild.id, admin_channel_id=channel.id, admin_role_id=role.id if role else None
        )
        message = f"✅ 注文は {channel.mention} に届きます。"
        perms = channel.permissions_for(interaction.guild.me)
        missing = [
            label
            for ok, label in (
                (perms.view_channel, "チャンネルを見る"),
                (perms.send_messages, "メッセージを送信"),
                (perms.embed_links, "埋め込みリンク"),
            )
            if not ok
        ]
        if missing:
            message += f"\n⚠️ Bot にこのチャンネルの権限が足りません: {', '.join(missing)}"
        if not settings.payment_info:
            message += "\n次は `/setup payment` で購入者に表示する支払い方法を設定してください。"
        await reply(interaction, message, embed=embeds.settings_embed(settings))

    @app_commands.command(name="payment", description="購入者に表示する支払い方法を設定します")
    async def payment(self, interaction: discord.Interaction) -> None:
        assert interaction.guild_id is not None
        current = bot_of(interaction).store.get_settings(interaction.guild_id).payment_info
        await interaction.response.send_modal(PaymentModal(current))

    @app_commands.command(name="show", description="いまの設定を表示します")
    async def show(self, interaction: discord.Interaction) -> None:
        assert interaction.guild_id is not None
        settings = bot_of(interaction).store.get_settings(interaction.guild_id)
        await reply(interaction, embed=embeds.settings_embed(settings))


class ProductGroup(app_commands.Group, name="product", description="商品の管理", guild_only=True, default_permissions=ADMIN):
    @app_commands.command(name="add", description="商品を追加します (入力フォームが開きます)")
    @app_commands.describe(role="購入した人に付けるロール (省略可)")
    async def add(self, interaction: discord.Interaction, role: Optional[discord.Role] = None) -> None:
        await interaction.response.send_modal(ProductModal(role_id=role.id if role else None))

    @app_commands.command(name="edit", description="商品の名前・価格・説明を変更します")
    @app_commands.describe(product="変更する商品")
    @app_commands.autocomplete(product=product_autocomplete)
    async def edit(self, interaction: discord.Interaction, product: str) -> None:
        found = await find_product(interaction, product)
        if found:
            await interaction.response.send_modal(ProductModal(product=found))

    @app_commands.command(name="role", description="購入した人に付けるロールを設定します (role を省略すると解除)")
    @app_commands.describe(product="設定する商品", role="付けるロール (省略すると解除)")
    @app_commands.autocomplete(product=product_autocomplete)
    async def role(
        self, interaction: discord.Interaction, product: str, role: Optional[discord.Role] = None
    ) -> None:
        found = await find_product(interaction, product)
        if found is None:
            return
        assert interaction.guild is not None
        updated = bot_of(interaction).store.set_product_role(interaction.guild.id, found.id, role.id if role else None)
        if role is None:
            await reply(interaction, f"✅ 「{updated.name}」のロール付与を解除しました。")
            return
        message = f"✅ 「{updated.name}」を購入した人に {role.mention} を付けます。"
        me = interaction.guild.me
        if not me.guild_permissions.manage_roles:
            message += "\n⚠️ Bot に「ロールの管理」権限がありません。"
        elif role >= me.top_role:
            message += "\n⚠️ Bot のロールをこのロールより上に移動してください (サーバー設定 → ロール)。"
        await reply(interaction, message)

    @app_commands.command(name="remove", description="商品の販売を終了します (売れ残りの在庫はファイルで返します)")
    @app_commands.describe(product="販売を終了する商品")
    @app_commands.autocomplete(product=product_autocomplete)
    async def remove(self, interaction: discord.Interaction, product: str) -> None:
        found = await find_product(interaction, product)
        if found is None:
            return
        bot = bot_of(interaction)
        leftover = bot.store.remove_product(found.guild_id, found.id)
        message = f"🗑️ 「{found.name}」の販売を終了しました。確認待ちの注文はそのまま承認・却下できます。"
        if leftover:
            message += f"\n売れ残りの在庫 {len(leftover)} 個を添付します。"
            await reply(interaction, message, file=text_file(leftover, f"stock-{found.id}.txt"))
        else:
            await reply(interaction, message)
        bot.panels.schedule(found.guild_id)

    @app_commands.command(name="list", description="商品の一覧を表示します")
    async def list_(self, interaction: discord.Interaction) -> None:
        assert interaction.guild_id is not None
        await reply(interaction, embed=embeds.products_embed(bot_of(interaction).store.list_products(interaction.guild_id)))


class StockGroup(app_commands.Group, name="stock", description="在庫の管理", guild_only=True, default_permissions=ADMIN):
    @app_commands.command(name="add", description="在庫を追加します (1 行 = 1 個。file に .txt を添付するとまとめて追加)")
    @app_commands.describe(product="在庫を追加する商品", file="1 行に 1 個ずつ書いたテキストファイル (省略すると入力フォーム)")
    @app_commands.autocomplete(product=product_autocomplete)
    async def add(
        self, interaction: discord.Interaction, product: str, file: Optional[discord.Attachment] = None
    ) -> None:
        found = await find_product(interaction, product)
        if found is None:
            return
        if found.unlimited:
            await reply(interaction, "この商品は「全員に同じものを渡す」設定なので在庫は不要です。")
            return
        if file is None:
            await interaction.response.send_modal(StockModal(found))
            return
        if file.size > MAX_STOCK_FILE_BYTES:
            await reply(interaction, "ファイルが大きすぎます (2MB まで)。")
            return
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            text = (await file.read()).decode("utf-8-sig")
        except UnicodeDecodeError:
            await reply(interaction, "文字コードが UTF-8 のテキストファイルを添付してください。")
            return
        await add_stock_and_reply(interaction, found.guild_id, found.id, text.splitlines())

    @app_commands.command(name="export", description="残っている在庫をファイルで受け取ります (在庫はそのまま)")
    @app_commands.describe(product="在庫を確認する商品")
    @app_commands.autocomplete(product=product_autocomplete)
    async def export(self, interaction: discord.Interaction, product: str) -> None:
        found = await find_product(interaction, product)
        if found is None:
            return
        lines = bot_of(interaction).store.available_stock(found.guild_id, found.id)
        if not lines:
            await reply(interaction, f"「{found.name}」の在庫はありません。")
            return
        await reply(interaction, f"📦 「{found.name}」の在庫 {len(lines)} 個", file=text_file(lines, f"stock-{found.id}.txt"))

    @app_commands.command(name="clear", description="残っている在庫をすべて取り出します (ファイルで返します)")
    @app_commands.describe(product="在庫を取り出す商品")
    @app_commands.autocomplete(product=product_autocomplete)
    async def clear(self, interaction: discord.Interaction, product: str) -> None:
        found = await find_product(interaction, product)
        if found is None:
            return
        bot = bot_of(interaction)
        lines = bot.store.clear_stock(found.guild_id, found.id)
        if not lines:
            await reply(interaction, f"「{found.name}」の在庫はありません。")
            return
        await reply(
            interaction,
            f"🧹 「{found.name}」の在庫 {len(lines)} 個を取り出しました。",
            file=text_file(lines, f"stock-{found.id}.txt"),
        )
        bot.panels.schedule(found.guild_id)


@app_commands.command(name="panel", description="このチャンネルに自販機のパネルを設置します")
@app_commands.describe(title="パネルの見出し", description="パネルの説明文")
@app_commands.guild_only()
@app_commands.default_permissions(manage_guild=True)
async def panel_command(
    interaction: discord.Interaction,
    title: Optional[app_commands.Range[str, 1, 200]] = None,
    description: Optional[app_commands.Range[str, 1, 1000]] = None,
) -> None:
    assert interaction.guild_id is not None
    channel = interaction.channel
    if not isinstance(channel, discord.abc.Messageable):
        await reply(interaction, "このチャンネルには設置できません。")
        return
    bot = bot_of(interaction)
    title = title or embeds.DEFAULT_PANEL_TITLE
    description = description or embeds.DEFAULT_PANEL_DESCRIPTION
    products = bot.store.list_products(interaction.guild_id)
    try:
        message = await channel.send(embed=embeds.panel_embed(title, description, products), view=panel_view(products))
    except discord.HTTPException:
        await reply(interaction, "パネルを送れませんでした。Bot にこのチャンネルでメッセージを送る権限があるか確認してください。")
        return
    bot.store.add_panel(message.id, interaction.guild_id, message.channel.id, title, description)
    hint = ""
    if bot.store.get_settings(interaction.guild_id).admin_channel_id is None:
        hint = "\n⚠️ まだ `/setup channel` が設定されていないため、注文を受け付けられません。"
    await reply(interaction, f"✅ パネルを設置しました。商品や在庫を変えると自動で更新されます。{hint}")


@app_commands.command(name="orders", description="注文の一覧を表示します")
@app_commands.describe(status="表示する注文の状態")
@app_commands.choices(
    status=[app_commands.Choice(name=embeds.STATUS_LABELS[s], value=s) for s in STATUSES]
    + [app_commands.Choice(name="すべて", value="all")]
)
@app_commands.guild_only()
@app_commands.default_permissions(manage_guild=True)
async def orders_command(interaction: discord.Interaction, status: Optional[str] = None) -> None:
    assert interaction.guild_id is not None
    status = status or "pending"
    orders = bot_of(interaction).store.list_orders(
        interaction.guild_id, status=None if status == "all" else status, limit=30
    )
    title = "🧾 注文 (すべて)" if status == "all" else f"🧾 注文 ({embeds.STATUS_LABELS[status]})"
    await reply(interaction, embed=embeds.orders_embed(orders, title))


@app_commands.command(name="sales", description="売上を表示します")
@app_commands.guild_only()
@app_commands.default_permissions(manage_guild=True)
async def sales_command(interaction: discord.Interaction) -> None:
    assert interaction.guild_id is not None
    await reply(interaction, embed=embeds.sales_embed(bot_of(interaction).store.sales(interaction.guild_id)))


@app_commands.command(name="history", description="自分の購入履歴を表示します (受け取った商品の確認・キャンセル)")
@app_commands.guild_only()
async def history_command(interaction: discord.Interaction) -> None:
    assert interaction.guild_id is not None
    orders = bot_of(interaction).store.list_orders(interaction.guild_id, user_id=interaction.user.id, limit=25)
    view = HistoryView(interaction.user.id, orders) if orders else discord.utils.MISSING
    await reply(interaction, embed=embeds.history_embed(orders), view=view)


def register_commands(tree: app_commands.CommandTree) -> None:
    for group in (SetupGroup(), ProductGroup(), StockGroup()):
        tree.add_command(group)
    commands: tuple[app_commands.Command, ...] = (panel_command, orders_command, sales_command, history_command)
    for command in commands:
        tree.add_command(command)
