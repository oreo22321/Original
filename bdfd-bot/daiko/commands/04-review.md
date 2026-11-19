# ⭐ 実績・レビュー

[← 目次に戻る](../README.md)

## !review

- **トリガー**: `!review`
- **使い方**: `!review 5 | とても早かったです`

```
$nomention
$onlyIf[$getChannelVar[Customer]==$authorID;❌ このコマンドは、注文した本人がチケットの中で使えます。]
$onlyIf[$getChannelVar[Status]==done;❌ 注文が完了してから評価できます。]
$onlyIf[$getChannelVar[Rated]!=yes;❌ この注文はもう評価済みです。]
$textSplit[$message;|]
$var[st;$trimSpace[$splitText[1]]]
$var[cm;（コメントなし）]
$if[$getTextSplitLength>=2]
  $var[cm;$trimSpace[$splitText[2]]]
$endif
$onlyIf[$isInteger[$var[st]]==true;❌ 評価は1〜5の数字で入力してください。例: `!review 5 | とても早かったです`]
$onlyIf[$var[st]>=1;❌ 評価は1〜5で入力してください。]
$onlyIf[$var[st]<=5;❌ 評価は1〜5で入力してください。]
$setChannelVar[Rated;yes]
$sendEmbedMessage[$getServerVar[ResultCH];;$repeatMessage[$var[st];⭐] レビュー;;**サービス**: $getChannelVar[Service]
**コメント**: $var[cm];#FEE75C;;;$username さんより;;;;yes]
🙏 評価ありがとうございました！ 実績チャンネルに投稿しました。
```

## !stats

- **トリガー**: `!stats`
- **使い方**: `!stats`

```
$nomention
$title[📊 代行実績]
$addField[受け付けた注文;$getServerVar[OrderNo] 件;yes]
$addField[完了した注文;$getServerVar[DoneCount] 件;yes]
$color[#57F287]
$footer[$serverName[$guildID]]
```
