# Discord bot (スラッシュコマンド / discord.py)
# スラッシュコマンドは「MESSAGE CONTENT INTENT」が要らないので、設定が少なくて済みます。
# 1. 設定タブの「Discord」に DISCORD_TOKEN を入れて「確認」→ 出た招待リンクでサーバーに入れる
# 2. ▶ 起動 → Discord で / と打つと、/ping /dice /say が出ます
#    (はじめは表示されるまで少しかかることがあります。出ないときは Discord を再起動してください)
import os
import random

import discord
from discord import app_commands


class MyBot(discord.Client):
    def __init__(self):
        super().__init__(intents=discord.Intents.default())
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        synced = await self.tree.sync()
        print(f"スラッシュコマンドを {len(synced)} 個登録しました")


bot = MyBot()


@bot.event
async def on_ready():
    print(f"ログインしました: {bot.user} (ID: {bot.user.id})")
    print(f"参加しているサーバー: {len(bot.guilds)} 個")


@bot.tree.command(description="応答の速さを返します")
async def ping(interaction: discord.Interaction):
    await interaction.response.send_message(f"Pong! {round(bot.latency * 1000)}ms")


@bot.tree.command(description="サイコロを振ります")
@app_commands.describe(faces="面の数 (ふつうは 6)")
async def dice(interaction: discord.Interaction, faces: app_commands.Range[int, 2, 1000] = 6):
    await interaction.response.send_message(f"🎲 {random.randint(1, faces)} (1〜{faces})")


@bot.tree.command(description="代わりに言います")
@app_commands.describe(text="言わせたいこと")
async def say(interaction: discord.Interaction, text: str):
    await interaction.response.send_message(text, allowed_mentions=discord.AllowedMentions.none())


token = os.environ.get("DISCORD_TOKEN")
if not token:
    raise SystemExit("環境変数 DISCORD_TOKEN がありません。設定タブで追加してから起動してください。")

bot.run(token)
