# 🚪 入退室コマンド

[← 目次に戻る](../README.md)

## 入室メッセージ

- **トリガー**: `$onJoined[$getServerVar[WelcomeCH]]`
- **スラッシュコマンド**: オフ
- **メモ**: スラッシュコマンドは「オフ」のまま。トリガー欄に左の文字をそのまま入力します。Server Members Intent が必要です。

```
$nomention
$title[🎉 ようこそ！]
$description[<@$authorID> さん、**$serverName[$guildID]** へようこそ！
あなたは **$membersCount人目** のメンバーです。]
$thumbnail[$authorAvatar]
$color[#57F287]
$addTimestamp
```

## 退室メッセージ

- **トリガー**: `$onLeave[$getServerVar[WelcomeCH]]`
- **スラッシュコマンド**: オフ
- **メモ**: スラッシュコマンドは「オフ」のまま。Server Members Intent が必要です。

```
$nomention
$title[👋 またね]
$description[**$username** さんがサーバーを退出しました。
現在のメンバー数: **$membersCount人**]
$thumbnail[$authorAvatar]
$color[#ED4245]
$addTimestamp
```
