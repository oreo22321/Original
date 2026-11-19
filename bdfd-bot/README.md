# BDFD Discord Bot

**Bot Designer For Discord（BDFD）** で作るDiscord Botです。同じリポジトリにある ForgeCode とは別物です。
**iPhoneだけで**（Safari と BDFDアプリ）設定できるようにまとめています。

- スラッシュコマンド形式（`/help` など）。**Message Content Intent は不要**
- **無料版で使える関数だけ**を使用（プレミアム専用関数なし）
- 2026年7月時点の公式Wikiで関数の構文を確認済み（BDScript 2）

> 🛒 **代行サービス鯖向けのBot（注文チケット・実績・発言代行、`!` コマンド）は [daiko/README.md](daiko/README.md) にあります。**

## 目次

| カテゴリ | コマンド | ファイル |
|---|---|---|
| 🔧 基本 | `/help` `/ping` `/userinfo` `/serverinfo` `/avatar` | [commands/01-basic.md](commands/01-basic.md) |
| 🛡️ 管理 | `/kick` `/ban` `/timeout` `/untimeout` `/clear` `/warn` `/warnings` `/setwelcome` | [commands/02-moderation.md](commands/02-moderation.md) |
| 🚪 入退室 | 入室メッセージ・退室メッセージ | [commands/03-welcome.md](commands/03-welcome.md) |
| 🎮 遊び | `/omikuji` `/dice` `/janken`（＋ボタン処理3つ） | [commands/04-fun.md](commands/04-fun.md) |
| 💰 経済 | `/balance` `/daily` `/work` `/pay` `/ranking` | [commands/05-economy.md](commands/05-economy.md) |

BDFD上のコマンドは合計26個です（無料版の上限は230個）。

---

## 手順1. Botを作る（Safari）

1. App Store で **「BDFD - Bot Designer」** をインストールします。
2. Safari で <https://discord.com/developers/applications> を開き、Discordにログインします。
   - 表示が崩れる場合は、アドレスバーの `ぁあ`（または `AA`）→「デスクトップ用Webサイトを表示」を選びます。
3. **New Application** をタップし、名前を入れて作成します。
4. 左上の `≡` メニューから **Bot** タブを開きます。
5. **Reset Token** をタップし、表示されたトークンをコピーします。
   > ⚠️ **トークンは絶対に誰にも見せないでください**（チャットやスクリーンショットに貼るのもダメです）。漏れるとBotを乗っ取られます。万一漏れたら、すぐ Reset Token で作り直してください。
6. 同じ Bot タブの **Privileged Gateway Intents** で **SERVER MEMBERS INTENT** をオンにして保存します（入退室メッセージに必要）。
   - MESSAGE CONTENT INTENT はこのBotでは不要です。

## 手順2. BDFDアプリに登録する

1. BDFDアプリを開き、**Discordアカウントでログイン**します（ログインしないと、後でBotにアクセスできなくなることがあります）。
2. **Create New Bot** をタップし、Botの名前と、さっきコピーしたトークンを入力します。
3. 利用規約に同意して **Create bot** をタップします。
4. Botの **Settings** タブ →「Go to gateway intents settings」を開き、
   **「Sync intents with Developer Portal settings」** をタップします。Server Members がオンになっていることを確認します。

## 手順3. サーバーに招待する

1. アプリの **Invite bot to server** をタップします。
2. **Edit invite link permissions** で次の権限をオンにします。
   - チャンネルを見る / メッセージを送信 / 埋め込みリンク / メッセージ履歴を読む
   - メンバーをキック / メンバーをBAN / メンバーをタイムアウト / メッセージの管理
3. スコープで **Slash commands（`applications.commands`）** が有効になっていることを確認します。
4. サーバーを選んで招待します。
5. **重要**: サーバー設定 → ロール で、**Botのロールをメンバーのロールより上**にドラッグします。
   これをしないと、キック・BAN・タイムアウトが失敗します。

## 手順4. 変数を作る

アプリの **Variables** タブ → **+ New variable** で、次の3つを作ります。

| 変数名 | 初期値 | 用途 |
|---|---|---|
| `Money` | `0` | 所持金（経済） |
| `Warns` | `0` | 警告回数 |
| `WelcomeCH` | （空のまま） | 入退室メッセージのチャンネル |

> 変数名は大文字・小文字を区別します。表のとおりに入力してください。

## 手順5. コマンドを作る

各コマンドについて、次の作業を繰り返します。

1. **Commands** タブ → **+ Command creator**
2. **Command Name**: 好きな名前（例: `help`）
3. **Command Trigger**: 各ファイルに書いてある「トリガー」（例: `/help`）
4. **コード欄** にコードを貼り付けて **保存**
5. スラッシュコマンドの場合は **Slash command trigger** を開き、
   - **Enable global slash command** をオン
   - 名前・説明を入力
   - オプションがあるものは **Options** の **Add** で追加（名前・型・必須/任意を表のとおりに）
   - 保存

> 💡 iPhoneでのコピー: GitHubでコマンドのファイルを開くと、コードの右上にコピーボタンがあります。
> 1行も欠けないようにコピーしてください。`]` が1つ足りないだけでエラーになります。

### 注意
- グローバルスラッシュコマンドの作成・変更は、**反映まで最大1時間ほどかかる**ことがあります。出てこない場合はDiscordアプリを完全に終了して開き直してください。
- `$onJoined[...]` / `$onLeave[...]` / `$onInteraction[...]` がトリガーのコマンドは、**スラッシュコマンドを使いません**（オフのまま）。トリガー欄にそのまま貼り付けます。
- 入退室メッセージは、一度 **`/setwelcome channel:#チャンネル`** を実行しないと動きません。

## 手順6. Botをオンラインにする

**Dashboard** タブで次のどちらかを行います。
- **+ Add free hosting time**（表示された数字を入力 → 30分。オフライン中のみ使えます）
- **広告を見る** → 140分

オンラインになったら、サーバーで `/help` を送って動作を確認します。

---

## うまく動かないとき

| 症状 | 確認すること |
|---|---|
| スラッシュコマンドが出ない | 最大1時間待つ / `applications.commands` 付きで招待したか / Discordを再起動 |
| 「アプリケーションが応答しませんでした」 | Botがオンラインか（Dashboardでホスティング残り時間を確認） |
| キック・BAN・タイムアウトが失敗する | Botのロールが相手より**上**にあるか / Botに権限があるか |
| 入室メッセージが出ない | `/setwelcome` を実行したか / Server Members Intent が Developer Portal とアプリの両方でオンか / そのチャンネルにBotの送信権限があるか |
| 変数のエラーが出る | Variables タブで `Money` `Warns` `WelcomeCH` を作ったか（つづり・大文字小文字） |
| ランキングが更新されない | ランキングは約5分間キャッシュされます（BDFDの仕様） |

## 参考
- BDFD公式Wiki: <https://wiki.botdesignerdiscord.com/>
- Wikiのソース（GitHub）: <https://github.com/NilPointer-Software/bdfd-wiki>
- Discord Developer Portal: <https://discord.com/developers/applications>
