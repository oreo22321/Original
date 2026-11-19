# 🔧 基本コマンド

[← 目次に戻る](../README.md)

## /help

- **トリガー**: `/help`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `help`
  - 説明: コマンド一覧を表示します
  - オプション: なし

```
$nomention
$title[📖 コマンド一覧]
$color[#5865F2]
$addField[🔧 基本;`/help` `/ping` `/userinfo` `/serverinfo` `/avatar`;no]
$addField[🛡️ 管理;`/kick` `/ban` `/timeout` `/untimeout` `/clear` `/warn` `/warnings` `/setwelcome`;no]
$addField[🎮 遊び;`/omikuji` `/dice` `/janken`;no]
$addField[💰 経済;`/balance` `/daily` `/work` `/pay` `/ranking`;no]
$footer[$username[$botID]]
$addTimestamp
```

## /ping

- **トリガー**: `/ping`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `ping`
  - 説明: Botの応答速度を表示します
  - オプション: なし

```
$nomention
🏓 Pong! 応答速度: **$ping ms**
```

## /userinfo

- **トリガー**: `/userinfo`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `userinfo`
  - 説明: ユーザーの情報を表示します
  - オプション:
    - `user`（型: User / 任意）: 対象のユーザー
- **メモ**: user を省略すると自分の情報を表示します。

```
$nomention
$var[id;$authorID]
$if[$message[user]!=]
  $var[id;$message[user]]
$endif
$title[👤 $displayName[$var[id]] の情報]
$thumbnail[$userAvatar[$var[id]]]
$color[#5865F2]
$addField[ユーザー名;$username[$var[id]];yes]
$addField[ID;$var[id];yes]
$addField[Bot?;$replaceText[$replaceText[$isBot[$var[id]];true;はい];false;いいえ];yes]
$addField[アカウント作成日;$creationDate[$var[id];2006/01/02];yes]
$addField[サーバー参加日;$userJoined[$var[id];2006/01/02];yes]
```

## /serverinfo

- **トリガー**: `/serverinfo`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `serverinfo`
  - 説明: サーバーの情報を表示します
  - オプション: なし

```
$nomention
$title[🏠 $serverName[$guildID]]
$if[$serverIcon!=]
  $thumbnail[$serverIcon]
$endif
$color[#57F287]
$addField[オーナー;<@$serverOwner>;yes]
$addField[メンバー数;$membersCount 人;yes]
$addField[作成日;$creationDate[$guildID;2006/01/02];yes]
$addField[チャンネル数;$channelCount;yes]
$addField[ロール数;$roleCount;yes]
$addField[ブースト;Lv.$boostLevel（$boostCount 回）;yes]
$footer[サーバーID: $guildID]
```

## /avatar

- **トリガー**: `/avatar`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `avatar`
  - 説明: アイコン画像を大きく表示します
  - オプション:
    - `user`（型: User / 任意）: 対象のユーザー

```
$nomention
$var[id;$authorID]
$if[$message[user]!=]
  $var[id;$message[user]]
$endif
$title[🖼️ $displayName[$var[id]] のアイコン]
$image[$userAvatar[$var[id]]]
$color[#5865F2]
$addButton[no;$userAvatar[$var[id]];ブラウザで開く;link]
```
