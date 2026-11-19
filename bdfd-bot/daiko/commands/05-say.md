# 📢 発言代行

[← 目次に戻る](../README.md)

## /say  ・  !say

- **トリガー**: `!say`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `say`
  - 説明: Botが代わりに発言します
  - オプション:
    - `text`（型: Text / 必須）: 発言する文章
- **!で使う例**: `!say こんにちは`
- **メモ**: ! で使うと、元のコマンドは消えてBotの発言だけが残ります。/ では「〇〇がコマンドを使用」の表示が出ないように別送信しています。

```
$nomention
$onlyPerms[managemessages;❌ このコマンドには「メッセージの管理」権限が必要です。]
$if[$isSlash==true]
  $var[t;$message[text]]
$else
  $deletecommand
  $var[t;$message]
$endif
$onlyIf[$var[t]!=;❌ 発言する文章を入れてください。例: `!say こんにちは`]
$if[$isSlash==true]
  $channelSendMessage[$channelID;$var[t]]
  $ephemeral
  ✅ 送信しました。
$else
  $var[t]
$endif
```

## /embed  ・  !embed

- **トリガー**: `!embed`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `embed`
  - 説明: Botが埋め込みメッセージを送ります
  - オプション:
    - `title`（型: Text / 必須）: タイトル
    - `text`（型: Text / 必須）: 本文
    - `color`（型: Text / 任意）: 色（例: #ff8800）
- **!で使う例**: `!embed タイトル | 本文 | #ff8800`

```
$nomention
$onlyPerms[managemessages;❌ このコマンドには「メッセージの管理」権限が必要です。]
$if[$isSlash==true]
  $var[ti;$message[title]]
  $var[de;$message[text]]
  $var[co;$message[color]]
$else
  $deletecommand
  $textSplit[$message;|]
  $var[ti;$trimSpace[$splitText[1]]]
  $var[de;]
  $var[co;]
  $if[$getTextSplitLength>=2]
    $var[de;$trimSpace[$splitText[2]]]
  $endif
  $if[$getTextSplitLength>=3]
    $var[co;$trimSpace[$splitText[3]]]
  $endif
$endif
$onlyIf[$var[ti]!=;❌ 使い方: `!embed タイトル | 本文 | #色(省略可)`]
$if[$isValidHex[$var[co]]==false]
  $var[co;#5865F2]
$endif
$sendEmbedMessage[$channelID;;$var[ti];;$var[de];$var[co]]
$if[$isSlash==true]
  $ephemeral
  ✅ 送信しました。
$endif
```

## /send  ・  !send

- **トリガー**: `!send`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `send`
  - 説明: 指定したチャンネルにBotが発言します
  - オプション:
    - `channel`（型: Channel / 必須）: 送信先のチャンネル
    - `text`（型: Text / 必須）: 発言する文章
- **!で使う例**: `!send #チャンネル | 文章`
- **メモ**: このサーバーのチャンネルにだけ送れます。

```
$nomention
$onlyPerms[managemessages;❌ このコマンドには「メッセージの管理」権限が必要です。]
$if[$isSlash==true]
  $var[ch;$findChannel[$message[channel]]]
  $var[t;$message[text]]
$else
  $textSplit[$message;|]
  $var[ch;$findChannel[$trimSpace[$splitText[1]]]]
  $var[t;]
  $if[$getTextSplitLength>=2]
    $var[t;$trimSpace[$splitText[2]]]
  $endif
$endif
$onlyIf[$var[ch]!=;❌ チャンネルが見つかりません。使い方: `!send #チャンネル | 文章`]
$onlyIf[$var[t]!=;❌ 発言する文章を入れてください。]
$channelSendMessage[$var[ch];$var[t]]
$if[$isSlash==true]
  $ephemeral
$endif
✅ <#$var[ch]> に送信しました。
```
