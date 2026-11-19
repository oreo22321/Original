# 🎮 遊びコマンド

[← 目次に戻る](../README.md)

## /omikuji

- **トリガー**: `/omikuji`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `omikuji`
  - 説明: おみくじを引きます
  - オプション: なし

```
$nomention
$var[r;$randomText[🌟 大吉;😊 中吉;🙂 小吉;😌 吉;😐 末吉;😱 凶]]
$title[⛩️ $displayName のおみくじ]
$description[結果は…… **$var[r]**！]
$color[#FEE75C]
$footer[ラッキーアイテム: $randomText[おにぎり;スマホ;コーヒー;ゲーム機;傘;ヘッドホン]]
```

## /dice

- **トリガー**: `/dice`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `dice`
  - 説明: サイコロを振ります
  - オプション:
    - `sides`（型: Integer / 任意）: 面の数（省略で6）

```
$nomention
$var[s;6]
$if[$message[sides]!=]
  $var[s;$message[sides]]
$endif
$onlyIf[$var[s]>=2;❌ 面の数は2以上にしてください。]
$onlyIf[$var[s]<=1000;❌ 面の数は1000以下にしてください。]
🎲 $var[s]面のサイコロを振った！ 結果は **$random[1;$sum[$var[s];1]]**！
```

## /janken

- **トリガー**: `/janken`
- **スラッシュコマンド**: オン（グローバル）
  - 名前: `janken`
  - 説明: Botとじゃんけんをします
  - オプション: なし
- **メモ**: ボタンを押したときの処理は下の3つのコマンドで行います。

```
$nomention
$title[✊✌️✋ じゃんけん]
$description[出す手をボタンで選んでね！]
$color[#5865F2]
$addButton[no;jk_g;グー;primary;no;✊]
$addButton[no;jk_c;チョキ;success;no;✌️]
$addButton[no;jk_p;パー;danger;no;✋]
```

## じゃんけんボタン（グー）

- **トリガー**: `$onInteraction[jk_g]`
- **スラッシュコマンド**: オフ
- **メモ**: 3つとも同じコードです。違うのはトリガーだけ。スラッシュコマンドは「オフ」のまま。

```
$nomention
$var[me;$replaceText[$replaceText[$replaceText[$customID;jk_g;1];jk_c;2];jk_p;3]]
$var[bot;$random[1;4]]
$var[res;$calculate[($var[me]-$var[bot]+3)%3]]
$textSplit[グー✊,チョキ✌️,パー✋;,]
**$displayName** は **$splitText[$var[me]]**、Botは **$splitText[$var[bot]]**！
$if[$var[res]==2]
  🎉 あなたの勝ち！
$elseif[$var[res]==1]
  😢 あなたの負け…
$else
  🤝 あいこ！
$endif
```

## じゃんけんボタン（チョキ）

- **トリガー**: `$onInteraction[jk_c]`
- **スラッシュコマンド**: オフ
- **メモ**: 3つとも同じコードです。違うのはトリガーだけ。スラッシュコマンドは「オフ」のまま。

```
$nomention
$var[me;$replaceText[$replaceText[$replaceText[$customID;jk_g;1];jk_c;2];jk_p;3]]
$var[bot;$random[1;4]]
$var[res;$calculate[($var[me]-$var[bot]+3)%3]]
$textSplit[グー✊,チョキ✌️,パー✋;,]
**$displayName** は **$splitText[$var[me]]**、Botは **$splitText[$var[bot]]**！
$if[$var[res]==2]
  🎉 あなたの勝ち！
$elseif[$var[res]==1]
  😢 あなたの負け…
$else
  🤝 あいこ！
$endif
```

## じゃんけんボタン（パー）

- **トリガー**: `$onInteraction[jk_p]`
- **スラッシュコマンド**: オフ
- **メモ**: 3つとも同じコードです。違うのはトリガーだけ。スラッシュコマンドは「オフ」のまま。

```
$nomention
$var[me;$replaceText[$replaceText[$replaceText[$customID;jk_g;1];jk_c;2];jk_p;3]]
$var[bot;$random[1;4]]
$var[res;$calculate[($var[me]-$var[bot]+3)%3]]
$textSplit[グー✊,チョキ✌️,パー✋;,]
**$displayName** は **$splitText[$var[me]]**、Botは **$splitText[$var[bot]]**！
$if[$var[res]==2]
  🎉 あなたの勝ち！
$elseif[$var[res]==1]
  😢 あなたの負け…
$else
  🤝 あいこ！
$endif
```
