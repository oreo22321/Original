# title: スラッシュコマンド (おすすめ)
# desc: /ping や /dice などのコマンドに答える bot。特別な設定なしで動きます
import os
import random

import discord
from discord import app_commands

intents = discord.Intents.default()
client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)


@client.event
async def on_ready():
    # コマンドを Discord に登録します (反映まで数分かかることがあります)
    await tree.sync()
    print(f"ログインしました: {client.user}")


@tree.command(name="ping", description="bot が生きているか確かめます")
async def ping(interaction: discord.Interaction):
    await interaction.response.send_message(f"Pong! ({round(client.latency * 1000)} ms)")


@tree.command(name="hello", description="あいさつします")
async def hello(interaction: discord.Interaction):
    await interaction.response.send_message(f"こんにちは、{interaction.user.display_name} さん!")


@tree.command(name="dice", description="サイコロを振ります")
@app_commands.describe(sides="何面のサイコロにするか")
async def dice(interaction: discord.Interaction, sides: int = 6):
    await interaction.response.send_message(f"🎲 {random.randint(1, max(2, sides))}")


# トークンは BotRunner の設定に入れたものが自動で渡されます (コードに書かないでください)
client.run(os.environ["DISCORD_TOKEN"])
