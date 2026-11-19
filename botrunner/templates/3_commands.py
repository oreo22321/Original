# title: コマンド + 定期実行 + データ保存
# desc: !メモ のようなコマンド、1 時間ごとの処理、ファイルへの保存の例。MESSAGE CONTENT INTENT が必要です
import json
import os
from pathlib import Path

import discord
from discord.ext import commands, tasks

intents = discord.Intents.default()
intents.message_content = True  # Developer Portal で MESSAGE CONTENT INTENT をオンに
bot = commands.Bot(command_prefix="!", intents=intents)

# bot のフォルダにファイルを書くと、再起動しても残ります
DATA = Path("memo.json")


def load() -> dict:
    return json.loads(DATA.read_text("utf-8")) if DATA.exists() else {}


def save(data: dict):
    DATA.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")


@bot.event
async def on_ready():
    print(f"ログインしました: {bot.user}")
    if not hourly.is_running():
        hourly.start()


@bot.command(name="メモ")
async def memo(ctx: commands.Context, *, text: str = ""):
    """!メモ 内容 で保存、!メモ だけで一覧"""
    data = load()
    items = data.setdefault(str(ctx.author.id), [])
    if text:
        items.append(text)
        save(data)
        await ctx.send(f"メモしました ({len(items)} 件目)")
    elif items:
        await ctx.send("\n".join(f"{i}. {t}" for i, t in enumerate(items, 1)))
    else:
        await ctx.send("メモはまだありません。`!メモ 牛乳を買う` のように書いてください")


@tasks.loop(hours=1)
async def hourly():
    # 1 時間ごとに動きます。通知したいチャンネルの ID を入れると、そこに送れます
    print("1 時間ごとの処理を実行しました")
    # channel = bot.get_channel(123456789012345678)
    # await channel.send("定期のお知らせです")


bot.run(os.environ["DISCORD_TOKEN"])
