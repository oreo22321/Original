# ⭐ 実績・レビュー

[← 目次に戻る](../README.md)

## /review  ・  !review

- **トリガー**: `!review`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `review`
  - 説明: 完了した注文を評価します（注文者用）
  - オプション:
    - `rating`（型: Integer / 必須）: 評価（1〜5）
    - `comment`（型: Text / 任意）: ひとこと
- **!で使う例**: `!review 5 | とても早かったです`

```
$nomention
$onlyIf[$getChannelVar[Customer]==$authorID;❌ このコマンドは、注文した本人がチケットの中で使えます。]
$onlyIf[$getChannelVar[Status]==done;❌ 注文が完了してから評価できます。]
$onlyIf[$getChannelVar[Rated]!=yes;❌ この注文はもう評価済みです。]
$if[$isSlash==true]
  $var[st;$message[rating]]
  $var[cm;$message[comment]]
$else
  $textSplit[$message;|]
  $var[st;$trimSpace[$splitText[1]]]
  $var[cm;]
  $if[$getTextSplitLength>=2]
    $var[cm;$trimSpace[$splitText[2]]]
  $endif
$endif
$onlyIf[$isInteger[$var[st]]==true;❌ 評価は1〜5の数字で入力してください。例: `!review 5 | とても早かったです`]
$onlyIf[$var[st]>=1;❌ 評価は1〜5で入力してください。]
$onlyIf[$var[st]<=5;❌ 評価は1〜5で入力してください。]
$if[$var[cm]==]
  $var[cm;（コメントなし）]
$endif
$setChannelVar[Rated;yes]
$sendEmbedMessage[$getServerVar[ResultCH];;$repeatMessage[$var[st];⭐] レビュー;;**サービス**: $getChannelVar[Service]
**コメント**: $var[cm];#FEE75C;;;$username さんより;;;;yes]
🙏 評価ありがとうございました！ 実績チャンネルに投稿しました。
```

## /stats  ・  !stats

- **トリガー**: `!stats`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `stats`
  - 説明: これまでの注文数・完了数を表示します
  - オプション: なし
- **!で使う例**: `!stats`

```
$nomention
$title[📊 代行実績]
$addField[受け付けた注文;$getServerVar[OrderNo] 件;yes]
$addField[完了した注文;$getServerVar[DoneCount] 件;yes]
$color[#57F287]
$footer[$serverName[$guildID]]
```
