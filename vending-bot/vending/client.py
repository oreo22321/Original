"""Bot 本体。コマンドとボタンを登録し、パネルの自動更新を受け持ちます。"""
from __future__ import annotations

import asyncio
import logging

import discord
from discord import app_commands

from . import embeds
from .commands import register_commands
from .config import Config
from .store import Store, StoreError
from .ui import DYNAMIC_ITEMS, panel_view, reply

log = logging.getLogger(__name__)


class PanelRefresher:
    """商品・在庫が変わったら、そのサーバーのパネルを作り直す。

    続けて変更があっても少し待ってからまとめて 1 回だけ更新します (Discord の送信制限を避けるため)。
    """

    def __init__(self, bot: VendingBot, delay: float = 1.5) -> None:
        self.bot = bot
        self.delay = delay
        self._pending: dict[int, asyncio.Task[None]] = {}

    def schedule(self, guild_id: int) -> None:
        if guild_id in self._pending:
            return
        self._pending[guild_id] = asyncio.create_task(self._run(guild_id))

    async def _run(self, guild_id: int) -> None:
        try:
            await asyncio.sleep(self.delay)
        finally:
            self._pending.pop(guild_id, None)
        try:
            await self.refresh(guild_id)
        except Exception:
            log.exception("パネルの更新に失敗しました (サーバー %s)", guild_id)

    async def refresh(self, guild_id: int) -> None:
        store = self.bot.store
        products = store.list_products(guild_id)
        for panel in store.list_panels(guild_id):
            channel = await self.bot.resolve_channel(panel.channel_id)
            if channel is None or not hasattr(channel, "get_partial_message"):
                store.remove_panel(panel.message_id)
                continue
            message = channel.get_partial_message(panel.message_id)  # type: ignore[union-attr]
            try:
                await message.edit(
                    embed=embeds.panel_embed(panel.title, panel.description, products), view=panel_view(products)
                )
            except discord.NotFound:
                log.info("削除されたパネルを登録から外しました (メッセージ %s)", panel.message_id)
                store.remove_panel(panel.message_id)
            except discord.HTTPException:
                log.warning("パネルを更新できませんでした (メッセージ %s)", panel.message_id)


class VendingBot(discord.Client):
    def __init__(self, config: Config, store: Store) -> None:
        super().__init__(intents=discord.Intents.default())
        self.config = config
        self.store = store
        self.tree = app_commands.CommandTree(self)
        self.tree.on_error = self.on_app_command_error  # type: ignore[method-assign]
        register_commands(self.tree)
        self.panels = PanelRefresher(self)

    async def setup_hook(self) -> None:
        self.add_dynamic_items(*DYNAMIC_ITEMS)
        if self.config.sync_guild_id:
            guild = discord.Object(self.config.sync_guild_id)
            self.tree.copy_global_to(guild=guild)
            synced = await self.tree.sync(guild=guild)
            log.info("コマンドをサーバー %s に登録しました (%d 個)", self.config.sync_guild_id, len(synced))
        else:
            synced = await self.tree.sync()
            log.info("コマンドを登録しました (%d 個)", len(synced))

    async def on_ready(self) -> None:
        log.info("ログインしました: %s (%d サーバー)", self.user, len(self.guilds))
        # 止まっている間に変わった在庫などをパネルに反映する
        for guild in self.guilds:
            self.panels.schedule(guild.id)

    async def resolve_channel(self, channel_id: int | None) -> discord.abc.Messageable | None:
        if channel_id is None:
            return None
        channel = self.get_channel(channel_id)
        if channel is None:
            try:
                channel = await self.fetch_channel(channel_id)
            except discord.HTTPException:
                return None
        return channel if isinstance(channel, discord.abc.Messageable) else None

    async def on_app_command_error(
        self, interaction: discord.Interaction, error: app_commands.AppCommandError
    ) -> None:
        original = getattr(error, "original", error)
        if isinstance(original, StoreError):
            message = f"⚠️ {original}"
        elif isinstance(error, app_commands.MissingPermissions):
            message = "このコマンドを使う権限がありません。"
        elif isinstance(error, app_commands.NoPrivateMessage):
            message = "このコマンドはサーバーの中で使ってください。"
        else:
            log.exception("コマンドの処理中にエラー", exc_info=error)
            message = "⚠️ エラーが発生しました。しばらくしてからもう一度お試しください。"
        try:
            await reply(interaction, message)
        except discord.HTTPException:
            pass

    async def close(self) -> None:
        await super().close()
        self.store.close()
