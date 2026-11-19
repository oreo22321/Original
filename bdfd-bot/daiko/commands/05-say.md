# 📢 発言代行

[← 目次に戻る](../README.md)

## !say

- **トリガー**: `!say`
- **使い方**: `!say こんにちは`
- **メモ**: 元のコマンドは消えて、Botの発言だけが残ります。

```
$nomention
$onlyPerms[managemessages;❌ このコマンドには「メッセージの管理」権限が必要です。]
$argsCheck[>1;❌ 発言する文章を入れてください。例: `!say こんにちは`]
$deletecommand
$message
```

## !embed

- **トリガー**: `!embed`
- **使い方**: `!embed タイトル | 本文 | #ff8800`
- **メモ**: 色は省略できます（省略すると青紫）。

```
$nomention
$onlyPerms[managemessages;❌ このコマンドには「メッセージの管理」権限が必要です。]
$argsCheck[>1;❌ 使い方: `!embed タイトル | 本文 | #色(省略可)`]
$deletecommand
$textSplit[$message;|]
$var[co;#5865F2]
$title[$trimSpace[$splitText[1]]]
$if[$getTextSplitLength>=2]
  $description[$trimSpace[$splitText[2]]]
$endif
$if[$getTextSplitLength>=3]
  $if[$isValidHex[$trimSpace[$splitText[3]]]==true]
    $var[co;$trimSpace[$splitText[3]]]
  $endif
$endif
$color[$var[co]]
```

## !send

- **トリガー**: `!send`
- **使い方**: `!send #チャンネル | 文章`
- **メモ**: このサーバーのチャンネルにだけ送れます。「送信しました」は5秒後に消えます。

```
$nomention
$onlyPerms[managemessages;❌ このコマンドには「メッセージの管理」権限が必要です。]
$textSplit[$message;|]
$onlyIf[$getTextSplitLength>=2;❌ 使い方: `!send #チャンネル | 文章`]
$var[ch;$findChannel[$trimSpace[$splitText[1]]]]
$var[t;$trimSpace[$splitText[2]]]
$onlyIf[$var[ch]!=;❌ チャンネルが見つかりません。#チャンネル で指定してください。]
$onlyIf[$var[t]!=;❌ 発言する文章を入れてください。]
$channelSendMessage[$var[ch];$var[t]]
$deletecommand
✅ <#$var[ch]> に送信しました。
$deleteIn[5s]
```
