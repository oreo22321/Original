# LINE bot (Messaging API / Webhook)
# LINE の bot は、LINE から届くメッセージを受け取る「公開 URL (Webhook)」が要ります。
# BotHost の「Web 公開」がその URL を作ります (この bot では最初からオンです)。
# 1. LINE Developers (https://developers.line.biz/) で Messaging API のチャネルを作る
# 2. 設定タブの「環境変数」に LINE_CHANNEL_SECRET と LINE_CHANNEL_ACCESS_TOKEN を入れる
# 3. 設定タブの「Web 公開」の URL の最後に /callback を付けたものを、LINE の「Webhook URL」に入れて「検証」
# 4. ▶ 起動 → LINE で bot を友だちに追加して話しかけてみてください (同じ言葉を返します)
import os

from flask import Flask, abort, request
from linebot.v3 import WebhookHandler
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.messaging import ApiClient, Configuration, MessagingApi, ReplyMessageRequest, TextMessage
from linebot.v3.webhooks import MessageEvent, TextMessageContent

secret = os.environ.get("LINE_CHANNEL_SECRET")
access_token = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN")
if not secret or not access_token:
    raise SystemExit("環境変数 LINE_CHANNEL_SECRET と LINE_CHANNEL_ACCESS_TOKEN を設定タブで追加してから起動してください。")

app = Flask(__name__)
handler = WebhookHandler(secret)
configuration = Configuration(access_token=access_token)


@app.get("/")
def index():
    return "LINE bot は動いています"


@app.post("/callback")
def callback():
    signature = request.headers.get("X-Line-Signature", "")
    try:
        handler.handle(request.get_data(as_text=True), signature)
    except InvalidSignatureError:
        abort(400)
    return "OK"


@handler.add(MessageEvent, message=TextMessageContent)
def on_message(event):
    with ApiClient(configuration) as client:
        MessagingApi(client).reply_message(ReplyMessageRequest(
            reply_token=event.reply_token,
            messages=[TextMessage(text=event.message.text)],
        ))


# BotHost が決めた番号 (環境変数 PORT) で待ち受けます
port = int(os.environ.get("PORT", "8080"))
print(f"LINE bot を起動しました (ポート {port})")
app.run(host="0.0.0.0", port=port)
