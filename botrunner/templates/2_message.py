# title: メッセージに反応する
# desc: 「おはよう」などの発言に返事をする bot。Developer Portal で MESSAGE CONTENT INTENT をオンにする必要があります
import os

import discord

intents = discord.Intents.default()
# メッセージの中身を読むための設定です。
# Developer Portal → Bot → Privileged Gateway Intents → MESSAGE CONTENT INTENT をオンにしてください
intents.message_content = True
client = discord.Client(intents=intents)

# 言葉と返事の組み合わせ。自由に増やせます
REPLIES = {
    "おはよう": "おはようございます! ☀️",
    "おやすみ": "おやすみなさい 🌙",
    "ありがとう": "どういたしまして!",
}


@client.event
async def on_ready():
    print(f"ログインしました: {client.user}")


@client.event
async def on_message(message: discord.Message):
    if message.author.bot:  # bot 同士で返事をし合わないように
        return
    for word, reply in REPLIES.items():
        if word in message.content:
            await message.channel.send(reply)
            return
    if client.user in message.mentions:
        await message.reply("呼びましたか?")


client.run(os.environ["DISCORD_TOKEN"])
