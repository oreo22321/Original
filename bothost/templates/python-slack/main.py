# Slack bot (Bolt / Socket Mode: 公開する URL が要らない方法)
# 1. https://api.slack.com/apps で App を作る → 「Socket Mode」をオン → App-Level Token (xapp-…) を作る
# 2. 「OAuth & Permissions」で app_mentions:read と chat:write を足して、ワークスペースに入れる (xoxb-… のトークン)
# 3. 「Event Subscriptions」で app_mention を足す
# 4. 設定タブの「環境変数」に SLACK_BOT_TOKEN (xoxb-…) と SLACK_APP_TOKEN (xapp-…) を入れて ▶ 起動
# 5. チャンネルに bot を招待して、@bot こんにちは と送ってみてください
import os

from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

bot_token = os.environ.get("SLACK_BOT_TOKEN")
app_token = os.environ.get("SLACK_APP_TOKEN")
if not bot_token or not app_token:
    raise SystemExit("環境変数 SLACK_BOT_TOKEN と SLACK_APP_TOKEN を設定タブで追加してから起動してください。")

app = App(token=bot_token)


@app.event("app_mention")
def mention(event, say):
    say(f"<@{event['user']}> 呼びましたか？")


@app.message("ping")
def ping(message, say):
    say("pong 🏓")


print("Slack bot を起動しました")
SocketModeHandler(app, app_token).start()
