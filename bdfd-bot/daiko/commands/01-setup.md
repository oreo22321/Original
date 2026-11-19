# ⚙️ 初期設定

[← 目次に戻る](../README.md)

## !help

- **トリガー**: `!help`
- **使い方**: `!help`

```
$nomention
$title[📖 コマンド一覧]
$color[#5865F2]
$addField[⚙️ 管理者;`!setup` 初期設定 ・ `!panel` 注文パネルを置く;no]
$addField[🛒 注文;`!order` 注文する ・ `!menu` 料金表;no]
$addField[🧑‍💼 スタッフ;`!claim` 担当する ・ `!done` 完了 ・ `!close` 閉じる;no]
$addField[⭐ 実績;`!review` 評価する ・ `!stats` 実績数;no]
$addField[📢 発言代行;`!say` 発言 ・ `!embed` 埋め込み ・ `!send` 別チャンネルへ;no]
$footer[文章を区切るときは | を使います　例: !order ランク上げ | 内容 | 納期]
```

## !setup

- **トリガー**: `!setup`
- **使い方**: `!setup @スタッフ カテゴリID #実績`
- **メモ**: カテゴリIDは、Discordの設定 → 詳細設定 →「開発者モード」をオンにして、カテゴリを長押し →「IDをコピー」で取れます。

```
$nomention
$onlyPerms[manageserver;❌ このコマンドには「サーバー管理」権限が必要です。]
$argsCheck[>3;❌ 使い方: `!setup @スタッフ カテゴリID #実績チャンネル`]
$var[r;$findRole[$message[1]]]
$var[c;$findChannel[$message[2]]]
$var[l;$findChannel[$message[3]]]
$onlyIf[$var[r]!=;❌ スタッフロールが見つかりません。@ロール で指定してください。]
$onlyIf[$var[c]!=;❌ カテゴリが見つかりません。カテゴリのIDを入れてください。]
$onlyIf[$channelType[$var[c]]==category;❌ 2つ目にはチャンネルではなく「カテゴリ」のIDを入れてください。]
$onlyIf[$var[l]!=;❌ 実績チャンネルが見つかりません。#チャンネル で指定してください。]
$setServerVar[StaffRole;$var[r]]
$setServerVar[TicketCat;$var[c]]
$setServerVar[ResultCH;$var[l]]
$title[⚙️ 設定を保存しました]
$addField[スタッフロール;<@&$var[r]>;no]
$addField[チケットのカテゴリ;$channelName[$var[c]];no]
$addField[実績チャンネル;<#$var[l]>;no]
$color[#57F287]
```

## !panel

- **トリガー**: `!panel`
- **使い方**: `!panel`
- **メモ**: 注文用のチャンネル（例: #ご注文はこちら）で1回だけ実行します。

```
$nomention
$onlyPerms[manageserver;❌ このコマンドには「サーバー管理」権限が必要です。]
$deletecommand
$title[🛒 代行のご注文はこちら]
$description[下の **「注文する」** ボタンを押して、フォームに内容を書いて送信してください。
あなた専用のチャンネルが作られ、スタッフが対応します。

💰 料金は **「料金表」** ボタンで確認できます。]
$color[#5865F2]
$footer[$serverName[$guildID]]
$addButton[no;ord_open;注文する;success;no;🛒]
$addButton[no;ord_menu;料金表;secondary;no;💰]
```
