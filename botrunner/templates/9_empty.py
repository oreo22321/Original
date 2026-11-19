# title: 空のファイル
# desc: 自分で一から書く (ほかで書いたコードを貼り付けるときも)
import os

import discord

client = discord.Client(intents=discord.Intents.default())


@client.event
async def on_ready():
    print(f"ログインしました: {client.user}")


client.run(os.environ["DISCORD_TOKEN"])
