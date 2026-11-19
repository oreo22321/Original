# 🛒 注文受付

[← 目次に戻る](../README.md)

## /order  ・  !order

- **トリガー**: `!order`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `order`
  - 説明: 代行を注文します（専用チャンネルが作られます）
  - オプション: なし
- **!で使う例**: `!order サービス名 | 内容 | 納期`
- **メモ**: スラッシュでは入力フォームが開きます。! では「|」で区切って書きます。スラッシュのオプションはありません。

```
$nomention
$if[$isSlash==true]
  $newModal[ord_form;ご注文フォーム]
  $addTextInput[svc;short;サービス・ゲーム名;1;100;yes;;例: ランク上げ（〇〇ゲーム）]
  $addTextInput[detail;paragraph;ご依頼の内容;1;1000;yes;;例: シルバーからゴールドまで]
  $addTextInput[deadline;short;希望の納期;0;100;no;;例: 今週末まで]
  $stop
$endif
$cooldown[2m;⏰ 少し待ってから、もう一度お試しください。]
$textSplit[$message;|]
$var[svc;$trimSpace[$splitText[1]]]
$var[detail;指定なし]
$var[dl;]
$if[$getTextSplitLength>=2]
  $var[detail;$trimSpace[$splitText[2]]]
$endif
$if[$getTextSplitLength>=3]
  $var[dl;$trimSpace[$splitText[3]]]
$endif
$onlyIf[$getServerVar[TicketCat]!=;❌ まだ初期設定が終わっていません。管理者に /setup をお願いしてください。]
$onlyIf[$var[svc]!=;❌ サービス名を入力してください。]
$var[open;$getUserVar[OpenTicket]]
$if[$var[open]!=]
  $if[$channelExists[$var[open]]==true]
    ❌ すでに注文チケットがあります → <#$var[open]>
    $stop
  $endif
$endif
$if[$var[dl]==]
  $var[dl;指定なし]
$endif
$var[no;$sum[$getServerVar[OrderNo];1]]
$setServerVar[OrderNo;$var[no]]
$createChannel[order-$var[no];text;$getServerVar[TicketCat]]
$var[ch;$channelID[order-$var[no]]]
$editChannelPerms[$var[ch];$botID;+readmessages;+sendmessages;+embedlinks;+readmessagehistory]
$editChannelPerms[$var[ch];$guildID;-readmessages]
$editChannelPerms[$var[ch];$authorID;+readmessages;+sendmessages;+readmessagehistory;+attachfiles]
$editChannelPerms[$var[ch];$getServerVar[StaffRole];+readmessages;+sendmessages;+readmessagehistory;+attachfiles]
$setChannelVar[Customer;$authorID;$var[ch]]
$setChannelVar[Service;$var[svc];$var[ch]]
$setUserVar[OpenTicket;$var[ch]]
$allowRoleMentions[$getServerVar[StaffRole]]
$channelSendMessage[$var[ch];<@$authorID> さん、ご注文ありがとうございます！ <@&$getServerVar[StaffRole]>
**🧾 注文 #$var[no]**
**サービス**: $var[svc]
**内容**: $var[detail]
**希望納期**: $var[dl]
スタッフが確認するまで少しお待ちください。
━━━━━━━━━━
スタッフ用: `/claim` 担当する ・ `/done` 完了 ・ `/close` チケットを閉じる]
✅ 注文チケットを作成しました → <#$var[ch]>
```

## 「注文する」ボタン

- **トリガー**: `$onInteraction[ord_open]`
- **スラッシュコマンド**: オフ
- **メモ**: パネルのボタンを押すと注文フォームを開きます。スラッシュコマンドはオフのまま。

```
$nomention
$newModal[ord_form;ご注文フォーム]
$addTextInput[svc;short;サービス・ゲーム名;1;100;yes;;例: ランク上げ（〇〇ゲーム）]
$addTextInput[detail;paragraph;ご依頼の内容;1;1000;yes;;例: シルバーからゴールドまで]
$addTextInput[deadline;short;希望の納期;0;100;no;;例: 今週末まで]
```

## 注文フォームの送信

- **トリガー**: `$onInteraction[ord_form]`
- **スラッシュコマンド**: オフ
- **メモ**: フォームが送信されたら、専用チャンネルを作ります。スラッシュコマンドはオフのまま。

```
$nomention
$ephemeral
$cooldown[2m;⏰ 少し待ってから、もう一度お試しください。]
$var[svc;$input[svc]]
$var[detail;$input[detail]]
$var[dl;$input[deadline]]
$onlyIf[$getServerVar[TicketCat]!=;❌ まだ初期設定が終わっていません。管理者に /setup をお願いしてください。]
$onlyIf[$var[svc]!=;❌ サービス名を入力してください。]
$var[open;$getUserVar[OpenTicket]]
$if[$var[open]!=]
  $if[$channelExists[$var[open]]==true]
    ❌ すでに注文チケットがあります → <#$var[open]>
    $stop
  $endif
$endif
$if[$var[dl]==]
  $var[dl;指定なし]
$endif
$var[no;$sum[$getServerVar[OrderNo];1]]
$setServerVar[OrderNo;$var[no]]
$createChannel[order-$var[no];text;$getServerVar[TicketCat]]
$var[ch;$channelID[order-$var[no]]]
$editChannelPerms[$var[ch];$botID;+readmessages;+sendmessages;+embedlinks;+readmessagehistory]
$editChannelPerms[$var[ch];$guildID;-readmessages]
$editChannelPerms[$var[ch];$authorID;+readmessages;+sendmessages;+readmessagehistory;+attachfiles]
$editChannelPerms[$var[ch];$getServerVar[StaffRole];+readmessages;+sendmessages;+readmessagehistory;+attachfiles]
$setChannelVar[Customer;$authorID;$var[ch]]
$setChannelVar[Service;$var[svc];$var[ch]]
$setUserVar[OpenTicket;$var[ch]]
$allowRoleMentions[$getServerVar[StaffRole]]
$channelSendMessage[$var[ch];<@$authorID> さん、ご注文ありがとうございます！ <@&$getServerVar[StaffRole]>
**🧾 注文 #$var[no]**
**サービス**: $var[svc]
**内容**: $var[detail]
**希望納期**: $var[dl]
スタッフが確認するまで少しお待ちください。
━━━━━━━━━━
スタッフ用: `/claim` 担当する ・ `/done` 完了 ・ `/close` チケットを閉じる]
✅ 注文チケットを作成しました → <#$var[ch]>
```

## /menu  ・  !menu

- **トリガー**: `!menu`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `menu`
  - 説明: 料金表を表示します
  - オプション: なし
- **!で使う例**: `!menu`
- **メモ**: 料金は見本です。自分のサービスに合わせて書き換えてください。

```
$nomention
$title[💰 料金表]
$description[※ 下の内容は見本です。このコードを編集して、自分のサービスと価格に書き換えてください。]
$addField[🎮 ランク上げ;ブロンズ → シルバー：500円
シルバー → ゴールド：800円;no]
$addField[📅 デイリー・イベント周回;1日分：300円
1週間分：1,800円;no]
$addField[🏆 実績・称号の解除;1個：200円〜;no]
$addField[💳 お支払い方法;PayPay・Amazonギフト券 など;no]
$color[#FEE75C]
$footer[ご注文は「注文する」ボタンから]
```

## 「料金表」ボタン

- **トリガー**: `$onInteraction[ord_menu]`
- **スラッシュコマンド**: オフ
- **メモ**: /menu と同じ内容を、押した人にだけ表示します。料金を変えたら両方とも直してください。スラッシュはオフのまま。

```
$nomention
$ephemeral
$title[💰 料金表]
$description[※ 下の内容は見本です。このコードを編集して、自分のサービスと価格に書き換えてください。]
$addField[🎮 ランク上げ;ブロンズ → シルバー：500円
シルバー → ゴールド：800円;no]
$addField[📅 デイリー・イベント周回;1日分：300円
1週間分：1,800円;no]
$addField[🏆 実績・称号の解除;1個：200円〜;no]
$addField[💳 お支払い方法;PayPay・Amazonギフト券 など;no]
$color[#FEE75C]
$footer[ご注文は「注文する」ボタンから]
```
