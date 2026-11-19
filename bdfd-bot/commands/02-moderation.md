# 🛡️ 管理コマンド

[← 目次に戻る](../README.md)

## /kick

- **トリガー**: `/kick`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `kick`
  - 説明: メンバーをキックします
  - オプション:
    - `user`（型: User / 必須）: 対象のユーザー
    - `reason`（型: Text / 任意）: 理由

```
$nomention
$onlyPerms[kick;❌ このコマンドには「メンバーをキック」権限が必要です。]
$onlyBotPerms[kick;❌ Botに「メンバーをキック」権限がありません。]
$onlyIf[$message[user]!=$authorID;❌ 自分自身はキックできません。]
$onlyIf[$message[user]!=$botID;❌ Bot自身はキックできません。]
$var[reason;$message[reason]]
$if[$var[reason]==]
  $var[reason;理由なし]
$endif
$try
  $kick[$message[user];$var[reason]]
$catch
  ❌ キックできませんでした。Botのロールが相手のロールより上にあるか確認してください。
  $stop
$endtry
👢 <@$message[user]> をキックしました。
理由: $var[reason]
```

## /ban

- **トリガー**: `/ban`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `ban`
  - 説明: メンバーをBANします
  - オプション:
    - `user`（型: User / 必須）: 対象のユーザー
    - `reason`（型: Text / 任意）: 理由

```
$nomention
$onlyPerms[ban;❌ このコマンドには「メンバーをBAN」権限が必要です。]
$onlyBotPerms[ban;❌ Botに「メンバーをBAN」権限がありません。]
$onlyIf[$message[user]!=$authorID;❌ 自分自身はBANできません。]
$onlyIf[$message[user]!=$botID;❌ Bot自身はBANできません。]
$var[reason;$message[reason]]
$if[$var[reason]==]
  $var[reason;理由なし]
$endif
$try
  $banID[$var[reason];$message[user]]
$catch
  ❌ BANできませんでした。Botのロールが相手のロールより上にあるか確認してください。
  $stop
$endtry
🔨 <@$message[user]> をBANしました。
理由: $var[reason]
```

## /timeout

- **トリガー**: `/timeout`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `timeout`
  - 説明: メンバーをタイムアウトします
  - オプション:
    - `user`（型: User / 必須）: 対象のユーザー
    - `minutes`（型: Integer / 必須）: 時間（分）1〜40320

```
$nomention
$onlyPerms[moderatemembers;❌ このコマンドには「メンバーをタイムアウト」権限が必要です。]
$onlyBotPerms[moderatemembers;❌ Botに「メンバーをタイムアウト」権限がありません。]
$onlyIf[$message[user]!=$authorID;❌ 自分自身はタイムアウトできません。]
$onlyIf[$message[user]!=$botID;❌ Bot自身はタイムアウトできません。]
$onlyIf[$message[minutes]>=1;❌ 時間は1分以上で指定してください。]
$onlyIf[$message[minutes]<=40320;❌ 時間は最大40320分（28日）までです。]
$try
  $timeout[$message[minutes]m;$message[user]]
$catch
  ❌ タイムアウトできませんでした。Botのロールが相手のロールより上にあるか確認してください。
  $stop
$endtry
⏳ <@$message[user]> を **$message[minutes]分間** タイムアウトしました。
```

## /untimeout

- **トリガー**: `/untimeout`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `untimeout`
  - 説明: タイムアウトを解除します
  - オプション:
    - `user`（型: User / 必須）: 対象のユーザー

```
$nomention
$onlyPerms[moderatemembers;❌ このコマンドには「メンバーをタイムアウト」権限が必要です。]
$onlyBotPerms[moderatemembers;❌ Botに「メンバーをタイムアウト」権限がありません。]
$try
  $untimeout[$message[user]]
$catch
  ❌ タイムアウトを解除できませんでした。
  $stop
$endtry
✅ <@$message[user]> のタイムアウトを解除しました。
```

## /clear

- **トリガー**: `/clear`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `clear`
  - 説明: メッセージをまとめて削除します
  - オプション:
    - `amount`（型: Integer / 必須）: 削除する件数（1〜100）
- **メモ**: ピン留めメッセージは消しません。2週間より古いメッセージはDiscordの仕様で一括削除できません。

```
$nomention
$ephemeral
$onlyPerms[managemessages;❌ このコマンドには「メッセージの管理」権限が必要です。]
$onlyBotPerms[managemessages;❌ Botに「メッセージの管理」権限がありません。]
$onlyIf[$message[amount]>=1;❌ 1以上の数を指定してください。]
$onlyIf[$message[amount]<=100;❌ 一度に削除できるのは100件までです。]
$clear[$message[amount];;no]
🧹 **$message[amount]件** のメッセージを削除しました。
```

## /warn

- **トリガー**: `/warn`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `warn`
  - 説明: メンバーに警告を与えます
  - オプション:
    - `user`（型: User / 必須）: 対象のユーザー
    - `reason`（型: Text / 任意）: 理由
- **メモ**: 変数 Warns が必要です。

```
$nomention
$onlyPerms[moderatemembers;❌ このコマンドには「メンバーをタイムアウト」権限が必要です。]
$onlyIf[$message[user]!=$authorID;❌ 自分自身には警告できません。]
$onlyIf[$isBot[$message[user]]==false;❌ Botには警告できません。]
$var[reason;$message[reason]]
$if[$var[reason]==]
  $var[reason;理由なし]
$endif
$var[count;$sum[$getUserVar[Warns;$message[user]];1]]
$setUserVar[Warns;$var[count];$message[user]]
⚠️ <@$message[user]> に警告しました。（累計 **$var[count]回**）
理由: $var[reason]
```

## /warnings

- **トリガー**: `/warnings`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `warnings`
  - 説明: 警告回数を確認します
  - オプション:
    - `user`（型: User / 任意）: 対象のユーザー

```
$nomention
$var[id;$authorID]
$if[$message[user]!=]
  $var[id;$message[user]]
$endif
📋 **$displayName[$var[id]]** の警告回数: **$getUserVar[Warns;$var[id]]回**
```

## /setwelcome

- **トリガー**: `/setwelcome`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `setwelcome`
  - 説明: 入退室メッセージのチャンネルを設定します
  - オプション:
    - `channel`（型: Channel / 任意）: 送信先（省略するとオフ）
- **メモ**: 変数 WelcomeCH が必要です。

```
$nomention
$onlyPerms[manageserver;❌ このコマンドには「サーバー管理」権限が必要です。]
$if[$message[channel]==]
  $setServerVar[WelcomeCH;]
  ✅ 入退室メッセージをオフにしました。
  $stop
$endif
$setServerVar[WelcomeCH;$message[channel]]
✅ 入退室メッセージの送信先を <#$message[channel]> に設定しました。
```
