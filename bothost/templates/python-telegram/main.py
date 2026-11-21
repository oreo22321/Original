# Telegram bot (python-telegram-bot)
# 1. Telegram で @BotFather に /newbot と送って bot を作り、トークンをもらう
# 2. 設定タブの「環境変数」に TELEGRAM_TOKEN を入れる
# 3. ▶ 起動 → 作った bot に /start と送ってみてください
import os
import random

from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("こんにちは！ /dice でサイコロを振ります。ほかの言葉はそのまま返します。")


async def dice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(f"🎲 {random.randint(1, 6)}")


async def echo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(update.message.text)


token = os.environ.get("TELEGRAM_TOKEN")
if not token:
    raise SystemExit("環境変数 TELEGRAM_TOKEN がありません。設定タブで追加してから起動してください。")

app = Application.builder().token(token).build()
app.add_handler(CommandHandler("start", start))
app.add_handler(CommandHandler("dice", dice))
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, echo))
print("Telegram bot を起動しました")
app.run_polling()
