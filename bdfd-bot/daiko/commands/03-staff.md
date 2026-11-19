# 🧑‍💼 スタッフ用

[← 目次に戻る](../README.md)

## /claim  ・  !claim

- **トリガー**: `!claim`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `claim`
  - 説明: この注文の担当になります（スタッフ用）
  - オプション: なし
- **!で使う例**: `!claim`

```
$nomention
$onlyIf[$getChannelVar[Customer]!=;❌ このコマンドは注文チケットの中で使ってください。]
$onlyIf[$hasRole[$authorID;$getServerVar[StaffRole]]==true;❌ スタッフ専用のコマンドです。]
$onlyIf[$getChannelVar[Status]!=done;❌ この注文はもう完了しています。]
$setChannelVar[Staff;$authorID]
🙋 この注文は <@$authorID> が担当します！
<@$getChannelVar[Customer]> さん、よろしくお願いします。
```

## /done  ・  !done

- **トリガー**: `!done`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `done`
  - 説明: 注文を完了にして実績を投稿します（スタッフ用）
  - オプション: なし
- **!で使う例**: `!done`
- **メモ**: 実績チャンネルには注文者の名前を出さず、サービス名と担当者だけを載せます。

```
$nomention
$onlyIf[$getChannelVar[Customer]!=;❌ このコマンドは注文チケットの中で使ってください。]
$onlyIf[$hasRole[$authorID;$getServerVar[StaffRole]]==true;❌ スタッフ専用のコマンドです。]
$onlyIf[$getChannelVar[Status]!=done;❌ この注文はもう完了しています。]
$setChannelVar[Status;done]
$var[staff;$getChannelVar[Staff]]
$if[$var[staff]==]
  $var[staff;$authorID]
$endif
$var[n;$sum[$getServerVar[DoneCount];1]]
$setServerVar[DoneCount;$var[n]]
$sendEmbedMessage[$getServerVar[ResultCH];;✅ 代行完了 #$var[n];;**サービス**: $getChannelVar[Service]
**担当**: <@$var[staff]>;#57F287;;;ご利用ありがとうございました;;;;yes]
🎉 ご注文が完了しました！ <@$getChannelVar[Customer]> さん、ありがとうございました。
よければ `/review` で評価をお願いします（⭐1〜5）。
例: `!review 5 | とても早かったです`
```

## /close  ・  !close

- **トリガー**: `!close`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `close`
  - 説明: 注文チケットを閉じて削除します
  - オプション: なし
- **!で使う例**: `!close`
- **メモ**: チャンネルごと削除するため、返信は表示されません（正常です）。Botに「チャンネルの管理」権限が必要です。

```
$nomention
$onlyIf[$getChannelVar[Customer]!=;❌ このコマンドは注文チケットの中で使ってください。]
$onlyIf[$or[$hasRole[$authorID;$getServerVar[StaffRole]]==true;$authorID==$getChannelVar[Customer]]==true;❌ チケットを閉じられるのは、スタッフか注文した本人だけです。]
$setUserVar[OpenTicket;;$getChannelVar[Customer]]
$deleteChannels[$channelID]
```
