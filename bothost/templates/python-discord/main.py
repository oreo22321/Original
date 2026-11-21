# Discord bot (discord.py)
# 1. 設定タブの「環境変数」に DISCORD_TOKEN を追加 (Discord Developer Portal の Bot → Reset Token で取得)
# 2. Developer Portal の Bot → Privileged Gateway Intents で「MESSAGE CONTENT INTENT」をオン
# 3. ▶ 起動 を押して、サーバーで !ping と送ってみてください
import os

import discord
from discord.ext import commands

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)


@bot.event
async def on_ready():
    print(f"ログインしました: {bot.user} (ID: {bot.user.id})")
    print(f"参加しているサーバー: {len(bot.guilds)} 個")


@bot.command()
async def ping(ctx):
    """応答の速さを返します"""
    await ctx.send(f"Pong! {round(bot.latency * 1000)}ms")


@bot.command()
async def hello(ctx):
    await ctx.send(f"こんにちは、{ctx.author.display_name} さん！")


token = os.environ.get("DISCORD_TOKEN")
if not token:
    raise SystemExit("環境変数 DISCORD_TOKEN がありません。設定タブで追加してから起動してください。")

bot.run(token)
