# 💰 経済コマンド

[← 目次に戻る](../README.md)

## /balance

- **トリガー**: `/balance`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `balance`
  - 説明: 所持金を確認します
  - オプション:
    - `user`（型: User / 任意）: 対象のユーザー

```
$nomention
$var[id;$authorID]
$if[$message[user]!=]
  $var[id;$message[user]]
$endif
$title[💰 $displayName[$var[id]] の所持金]
$description[**$numberSeparator[$getUserVar[Money;$var[id]]]** コイン]
$color[#FEE75C]
```

## /daily

- **トリガー**: `/daily`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `daily`
  - 説明: 1日1回ボーナスを受け取ります
  - オプション: なし
- **メモ**: $cooldown は必ず $nomention のすぐ下に置きます（BDScript 2 では上にある処理は必ず実行されるため）。

```
$nomention
$cooldown[1d;⏰ 今日のボーナスは受け取り済みです！ 次は <t:$sum[$getTimestamp;$getCooldown[normal]]:R> に受け取れます。]
$var[get;$random[100;501]]
$var[total;$sum[$getUserVar[Money];$var[get]]]
$setUserVar[Money;$var[total]]
🎁 デイリーボーナス **$var[get]コイン** をゲット！
所持金: **$numberSeparator[$var[total]]** コイン
```

## /work

- **トリガー**: `/work`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `work`
  - 説明: 働いてコインを稼ぎます（1時間に1回）
  - オプション: なし

```
$nomention
$cooldown[1h;😪 まだ疲れています… <t:$sum[$getTimestamp;$getCooldown[normal]]:R> にまた働けます。]
$var[get;$random[50;201]]
$var[job;$randomText[コンビニでバイトした;プログラムを書いた;ラーメン屋で皿洗いをした;荷物を配達した;動画を編集した]]
$var[total;$sum[$getUserVar[Money];$var[get]]]
$setUserVar[Money;$var[total]]
💼 $var[job]！ **$var[get]コイン** を稼いだ！
所持金: **$numberSeparator[$var[total]]** コイン
```

## /pay

- **トリガー**: `/pay`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `pay`
  - 説明: 他の人にコインを送ります
  - オプション:
    - `user`（型: User / 必須）: 対象のユーザー
    - `amount`（型: Integer / 必須）: 送る金額

```
$nomention
$onlyIf[$message[user]!=$authorID;❌ 自分自身には送れません。]
$onlyIf[$isBot[$message[user]]==false;❌ Botには送れません。]
$onlyIf[$message[amount]>=1;❌ 1コイン以上を指定してください。]
$onlyIf[$getUserVar[Money]>=$message[amount];❌ 所持金が足りません。（所持金: $getUserVar[Money] コイン）]
$setUserVar[Money;$sub[$getUserVar[Money];$message[amount]]]
$setUserVar[Money;$sum[$getUserVar[Money;$message[user]];$message[amount]];$message[user]]
💸 <@$message[user]> に **$numberSeparator[$message[amount]]コイン** を送りました！
```

## /ranking

- **トリガー**: `/ranking`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `ranking`
  - 説明: 所持金ランキングを表示します
  - オプション: なし
- **メモ**: ランキングは約5分ごとに更新されます（BDFDの仕様）。

```
$nomention
$title[🏆 所持金ランキング]
$userLeaderboard[Money;desc]
$color[#FEE75C]
$footer[あなたの順位: $getLeaderboardPosition[user;Money;desc]位]
```
