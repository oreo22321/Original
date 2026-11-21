# BotHost — bot を 24 時間動かしておくサービス

Discord などの bot のコードを置いて、ブラウザから **起動・停止・ログの確認・ファイルの編集** ができる、自分で持てる bot ホスティングです。外部のライブラリを使っていないので、Node.js があれば `node server.js` だけで動きます。

> **iPhone で `localhost` を開いても繋がりません。** `localhost` は「その端末自身」のことなので、iPhone で開くと iPhone の中を探しに行きます。BotHost はサーバー (24 時間動いているコンピューター) の上で動かすものなので、下の「スマホだけでサーバーに置く」で Render に置いて、Render がくれる `https://〜.onrender.com` の URL を開いてください。

## スマホだけでサーバーに置く (Render・無料)

PC はいりません。iPhone の Safari だけでできます。

### 1. バックアップ用の置き場所を作る (2 分)

Render の無料プランは、サーバーが再起動するとファイルが消えます。そこで BotHost は、アカウントや bot を **GitHub に自動でバックアップ** して、再起動のときに戻します。

1. GitHub で **新しいリポジトリ** を作る (名前は例えば `bothost-data`。**Private** にする。中身は空でよい)
2. GitHub の **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
   - Repository access: **Only select repositories** → さっきの `bothost-data` だけ
   - Permissions → Repository permissions → **Contents: Read and write**
   - 作ったトークン (`github_pat_…`) をコピーしておく

### 2. Render に置く (5 分)

1. [Render](https://render.com) に GitHub でサインアップ
2. 下のボタンを押す (このリポジトリの `render.yaml` が読み込まれます)

   [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/oreo22321/Original)

   ※ ボタンは `main` ブランチを使います。BotHost の変更が `main` に入ってから押してください。
3. 聞かれた値を入れる
   - `BOTHOST_BACKUP_REPO`: `あなたの GitHub の名前/bothost-data`
   - `BOTHOST_BACKUP_TOKEN`: 1 でコピーしたトークン
4. **Apply** → 数分待つと `https://bothost-xxxx.onrender.com` のような URL ができます
5. その URL を開いて、**最初のアカウントを作る** (最初の人が管理者になり、ほかの人は登録できません)

Safari の共有ボタン →「ホーム画面に追加」で、アプリのように開けます。

### 無料プランについて

- 無料プランは、外からのアクセスが 15 分ないと止まります。BotHost は **bot を動かしている間、10 分ごとに自分にアクセスして止まらないように** します (`RENDER_EXTERNAL_URL` を見て自動でオン)。
- それでも Render の都合でサーバーが再起動することがあります。そのときは **GitHub のバックアップから戻して、動いていた bot を自動でまた起動** します。ライブラリは起動のときに入れ直すので、再起動の直後は少し時間がかかります。
- 無料プランはメモリが少ない (512 MB) ので、動かす bot は 1〜2 個にしてください。
- 無料プランの細かい条件は変わることがあります。[Render の説明](https://render.com/docs/free) も見てください。

## できること

**いろいろなファイル・いろいろな bot (4.0)**
- **ファイルを入れるだけで動く**: 起動方法をファイルから自動で見つけます (Procfile・.replit・package.json・start.bat・main.py・.exe・.jar など)。候補から選んだり、自分で決めたりもできます
- 動かせるもの:
  - **Python**・**Node.js**・**TypeScript** (tsx)・**Bun**
  - **Java** (.jar)・**.NET** (C# の .dll。Windows 用にビルドした .exe も .NET で直接)
  - **Windows の .exe** (Wine・64 ビット)・**Windows のバッチ** (.bat / .cmd)
  - **シェル** (.sh)・**Ruby**・**PHP**・**Lua**・**Perl**・**Linux 用の実行ファイル** (Go・Rust などでビルドしたもの)
- **.bat は小さな cmd で動かします**: echo・set (/a /p)・if・for (/l /f)・goto・call・setlocal・timeout・ping で待つ書き方・start・pause など。`py -3`・`python`・`pip`・`venv\Scripts\python.exe` も、このサーバーのものに置き換えます。Shift_JIS で保存したファイルも読めます
- ライブラリを自動で入れる: requirements.txt・pyproject.toml・package.json (npm / yarn / pnpm / bun)・Gemfile・composer.json。TypeScript などのビルド (`npm run build`) も、ファイルが変わったときだけ
- **音楽 bot**: ffmpeg を使いそうな bot には、起動の前に ffmpeg を自動で入れます (libopus も入っています)
- **Web 公開 (Webhook)**: bot が環境変数 `PORT` で待ち受けると、`https://(サイト)/w/(秘密の文字)/` で開けます。LINE bot の Webhook や「keep alive」のページに。bot のページは別のサイトとして扱うので、BotHost のログインには触れません (WebSocket も通ります)
- テンプレートを追加: Discord (Python / Node.js、スラッシュコマンド)・**Telegram**・**Slack**・**LINE**・**Twitch**・Web サーバー・Windows のバッチ
- ファイル: 画像・音声・動画のプレビュー、.exe・.jar などの説明と「このファイルで起動」、1 ファイルのダウンロード、**100 MB までのファイル** (ストリームで送るのでメモリを使いすぎない)、日本語の Windows の ZIP (Shift_JIS の名前)、Windows の改行 (CRLF) をそのまま保存、20 くらいの言語の色分け
- **大きなファイルもバックアップ**: 256 KB 以上のファイルは別に暗号化して置き、変わっていなければ送り直しません (前は 5 MB を超えるファイルが入っていませんでした)
- bot ごとのタイムゾーン (例: 日本時間)

**24 時間稼働・安全 (3.0)**
- **サイトを閉じても止まりません**: bot はサーバーで動き続けます。Render の無料プランでも、数分ごとに自分にアクセスして眠らないようにします (bot がいないときも)。状態はダッシュボードと管理画面に出ます
- **bot ごとに別のユーザーで動かす**: サーバーが root のとき (Docker・Render)、bot はそれぞれ別のユーザーで動き、サーバーの秘密 (環境変数・鍵)・データ・ほかの bot のファイルを読めません
- **バックアップを暗号化** (AES-256-GCM, `BOTHOST_SECRET_KEY`): GitHub に置くファイルは鍵がないと読めません。古い暗号化なしのバックアップも読めます
- **ログインの情報はハッシュで保存**: データやバックアップが漏れても、ログインには使えません。パスワードを変えるとほかの端末は切れます。同じユーザー名への総当たりも止めます
- **ライブラリのインストールが速い**: Python は uv (pip の約 5 倍速い)、Node.js は package-lock.json があれば npm ci
- サーバーが起動したら、bot を少しずつずらして起動 (メモリ不足を防ぐ)。変更は数秒後にバックアップ
- 画面: ダッシュボード (稼働状況・24 時間稼働・バックアップ)、一覧から起動/停止、サイドバー (PC)・下のタブ (スマホ)、ライト/ダーク、ホーム画面に追加できるアイコン

**bot**
- テンプレートから作る: Discord bot (Python / discord.py)・**スラッシュコマンド** (Python)・Discord bot (Node.js / discord.js)・空の Python・空の Node.js
- **ZIP で読み込み・書き出し** (自分のコードをまとめて入れる / バックアップ)。ファイルのドラッグ & ドロップも
- 起動・停止・再起動。状態 (動作中 / 準備中 / 再起動待ち / エラーで停止) と、再起動までの秒数

**コンソール**
- bot の出力がリアルタイムに流れる (100ms ごとにまとめて送るので、たくさん出しても重くならない)
- **色付きの出力 (ANSI)** をそのまま色で表示
- **絞り込み**・**エラーだけ表示**・ダウンロード・消去
- ログはファイルにも保存するので、**サーバーを再起動しても残る**
- `input()` 用に標準入力を送れる

**ファイル**
- フォルダーの**ツリー**、編集、新規作成、アップロード、名前の変更、削除
- エディタ: **色分け (Python / JavaScript / JSON)**、行番号、Tab / Shift+Tab (複数行もまとめて)、自動の字下げ、Ctrl/⌘+S で保存

**Discord**
- トークンを入れて「確認」すると、**正しいかを調べて、bot の名前・アイコン・参加サーバー数を表示し、サーバーへの招待リンクを作る**
- MESSAGE CONTENT INTENT がオフなら教える
- トークンに `Bot ` や空白が付いていても直す

**安定して動かす**
- 落ちたら **自動で再起動** (2 秒・4 秒・8 秒…と待つ。5 分で 5 回落ちたらあきらめる)
- **落ちたら Discord に通知** (Webhook。同じ bot は 10 分に 1 回まで、あきらめたときは必ず)
- **決めた時間ごとに再起動** (6 時間・12 時間・1 日…。メモリが少しずつ増える bot 向け)
- メモリの上限を超えたら止める。CPU・メモリ・稼働時間と、**メモリのグラフ**
- ライブラリ (`requirements.txt` / `package.json`) は起動の前に自動で入れる。中身が変わったときだけ。**入れ直し**ボタンも
- サーバーが再起動したら、動かしていた bot をまた起動。サーバーが突然落ちて取り残された bot のプロセスは、次の起動で片付ける

**管理 (最初に登録した人)**
- サーバーの状態 (動いている bot・メモリ・保存容量)
- 新しい登録を受け付けるかの切り替え、ユーザーの削除
- バックアップの状態と「今すぐバックアップ」

## 自分のパソコンや VPS で動かす

```sh
cd bothost
node server.js
# → http://localhost:3000 (同じパソコンのブラウザで開く)
```

Docker で:

```sh
docker build -t bothost bothost
docker run -d --name bothost -p 3000:3000 -v bothost-data:/data --restart unless-stopped bothost
```

## 設定 (環境変数)

| 名前 | 既定 | 内容 |
| --- | --- | --- |
| `PORT` | `3000` | 待ち受けるポート |
| `HOST` | `0.0.0.0` | 待ち受けるアドレス |
| `BOTHOST_DATA` | `./data` | データ (アカウント・bot のファイル・ログ) を置く場所 |
| `BOTHOST_MODE` | `process` | `process`: そのまま動かす / `docker`: bot ごとにコンテナで動かす |
| `BOTHOST_REGISTRATION` | `first-only` | `first-only`: 最初の 1 人 (管理者) のあとは、管理画面で許可するまで登録できない / `open`: 誰でも登録できる |
| `BOTHOST_MAX_BOTS` | `5` | 1 人が作れる bot の数 (管理者は無制限) |
| `BOTHOST_MAX_DISK_MB` | `500` | bot のファイル全体の上限 |
| `BOTHOST_SECURE_COOKIE` | なし | `1` にするとクッキーに Secure を付ける (HTTPS で公開するとき) |
| `BOTHOST_TRUST_PROXY` | なし | `1` にするとリバースプロキシの `X-Forwarded-For` を信じる (Render では自動) |
| `BOTHOST_PYTHON` | `python3` | process モードで使う Python |
| `BOTHOST_BACKUP_REPO` | なし | バックアップ先の GitHub リポジトリ (`名前/リポジトリ`) |
| `BOTHOST_BACKUP_SSH_KEY` | なし | そのリポジトリのデプロイキー (書き込み可) の秘密鍵。base64 か PEM |
| `BOTHOST_BACKUP_TOKEN` | なし | 代わりに、そのリポジトリに書けるトークン (Contents: Read and write) |
| `BOTHOST_BACKUP_BRANCH` | 既定のブランチ | バックアップを置くブランチ |
| `BOTHOST_BACKUP_FILE` | `bothost-backup.json.gz` | バックアップのファイル名 |
| `BOTHOST_KEEP_AWAKE_URL` | `RENDER_EXTERNAL_URL` | bot を動かしている間、10 分ごとにアクセスする自分の URL |
| `BOTHOST_KEEP_AWAKE` | なし | `0` にすると上をオフ |
| `BOTHOST_KEEP_AWAKE_MINUTES` | `5` | 眠らせないためにアクセスする間隔 (1〜14 分) |
| `BOTHOST_SECRET_KEY` | なし | バックアップを暗号化する鍵 (どんな文字列でも)。**なくすとバックアップを読めません** |
| `BOTHOST_ISOLATE` | root なら自動 | `0` にすると、bot をユーザーごとに分けない |
| `BOTHOST_MAX_UPLOAD_MB` | `100` | 1 つのファイル・ZIP の大きさの上限 |
| `BOTHOST_DOCKER_IMAGE` | なし | docker モードで、どの bot にも使うイメージ (.exe・.bat も動かすなら BotHost のイメージを指定) |

## GitHub にバックアップ

置き方は 2 つあります。どちらも `BOTHOST_BACKUP_REPO` (例: `あなたの名前/bothost-data`。**必ず Private**) と一緒に使います。

- **デプロイキー (おすすめ)**: `BOTHOST_BACKUP_SSH_KEY` に SSH の秘密鍵 (base64 か PEM) を入れ、その公開鍵をリポジトリの **Settings → Deploy keys → Add deploy key** に **「Allow write access」にチェックして** 登録します。鍵はそのリポジトリにしか使えません。git で push し、いつも最新の 1 つだけを置くので、リポジトリが大きくなりません。
- **トークン**: `BOTHOST_BACKUP_TOKEN` に Fine-grained token (そのリポジトリの Contents: Read and write) を入れます。

どちらでも:

- 変更があれば **数秒後**、**最初のアカウントを作ったとき**、**サーバーを止めるとき** に、アカウント・bot の設定・bot のファイルを 1 つのファイル (gzip した JSON) にして GitHub に保存します。ライブラリのフォルダー (`.deps`・`node_modules`・`.wine` など) とログは入れません。
- デプロイキーのときは、256 KB 以上のファイルを `blobs/` に分けて置きます (95 MB まで)。中身が同じなら同じものになるので、変わったファイルだけが送られます。トークンのときは 1 つのファイルに入れます (1 ファイル 20 MB まで)。
- 起動したときに **データがなければ** (新しいサーバー・ファイルが消えた) GitHub から戻します。データがあるときは上書きしません。
- 起動のときに GitHub から **戻せなかった** (ネットワークなど) ときは、何度か試し、それでもだめなら **古いバックアップを空のデータで上書きしないように保存を止めます**。管理画面の「今すぐバックアップ」で再開できます。
- 状態は管理画面と `/api/health` (`backup.ok`) で見られます。

## 安全のために (大事)

- **`process` モード** は bot がサーバーと同じマシン・同じユーザーでそのまま動きます。手軽ですが、bot のコードはサーバーの中のファイルを読めます。**自分と信頼できる人だけで使う** ときに使ってください (そのため、既定では最初の 1 人しか登録できません)。
- **知らない人にも使わせる** なら `BOTHOST_MODE=docker` にしてください。bot ごとに Docker コンテナで動かし、メモリ・CPU・プロセス数に上限を付け、権限を落とし (`--cap-drop ALL`)、bot のフォルダーだけを見せます。サーバーに Docker が必要です (Render の無料プランでは使えません)。
- 公開するときは HTTPS の後ろに置き、`BOTHOST_SECURE_COOKIE=1` にしてください (Render の設定では入っています)。
- 環境変数・Webhook の URL は画面にも API にも返しません。ファイルの API はフォルダーの外 (`../`・絶対パス・外を指すシンボリックリンク・ZIP の中の `../`) を扱いません。変更する API には `X-BotHost: 1` ヘッダーが必須です (CSRF 対策)。

## テスト

```sh
cd bothost
npm test                                   # Docker が使えれば docker モード、root ならユーザーの分離も確かめます
node test/smoke.js http://localhost:3000   # 動いているサーバーを外から一通り触る (--net で PyPI・npm・Discord も)
node test/smoke-runtimes.js http://localhost:3000   # .bat・.exe・.jar・.NET・TypeScript・Ruby・PHP・Lua・シェル・Web 公開を本当に動かす (--net で Bun・ffmpeg も)
```

- `test/v4.test.js`: 起動方法の見つけ方 (Procfile・.replit・package.json・start.bat・.exe・fat jar など)、本物の Windows の .exe (64 / 32 ビット)・.jar・.NET の見分け方、小さな cmd (if・for・goto・call・set /a /p・遅延展開・パイプ・Shift_JIS・仮想環境の書き方)、日本語の名前の ZIP、大きなファイルのアップロードとダウンロード、Web 公開 (cookie を渡さない・別のサイト扱い・WebSocket)、テンプレート

- `test/server.test.js` `test/features.test.js`: 実際にサーバーを立てて、登録と管理者、ほかの人の bot が見えないこと、フォルダーの外への拒否、起動 → ログ → 標準入力 → 停止、自動の再起動とあきらめ、Discord のトークン確認と招待リンク (偽物の Discord で)、落ちたときの通知、ZIP、GitHub へのバックアップと復元 (偽物の GitHub で)、ログの保存と間引き、取り残されたプロセスの片付けなど
- `test/docker.test.js`: docker モードで、bot がコンテナで動くこと・フォルダーの外が見えないこと・システムのファイルが書けないこと・メモリの上限で止まること・残ったコンテナの片付け
- GitHub Actions の `bothost-real`: 本物の Dockerfile をビルドしてコンテナで動かし、PyPI から discord.py・npm から discord.js を入れて動かす、本物の Discord API でトークンを見分ける、コンテナを止めて動かすと bot が再開する、空のサーバーが本物の GitHub のバックアップから戻る、render.yaml が Render の公式スキーマに合う、を確かめます

## つくり

```
render.yaml            Render に置くための設定 (リポジトリの一番上)
bothost/
├── server.js          HTTP サーバー・API・リアルタイム配信 (Server-Sent Events)
├── lib/
│   ├── runner.js      bot のプロセス管理 (インストール・起動・停止・自動再起動・ログ・使用量)
│   ├── launch.js      起動方法 (ファイルから自動で見つける・.exe / .jar / .bat などを動かすコマンドに)
│   ├── cmd.js         Windows のバッチ (.bat) を動かす小さな cmd
│   ├── tools.js       使うときだけ入れる道具 (ffmpeg・Bun。ハッシュを確かめる)
│   ├── files.js       bot のファイル操作 (フォルダーの外に出ない)
│   ├── zip.js         ZIP の読み書き
│   ├── backup.js      GitHub へのバックアップと復元
│   ├── discord.js     トークンの確認・招待リンク・Webhook の通知
│   ├── auth.js        パスワード・セッション
│   └── store.js       データの保存 (JSON。1 つ前の版も残す)
├── public/            画面 (HTML / CSS / JS。フレームワークなし)
├── templates/         新しい bot のひな形
├── test/              テスト
└── Dockerfile
```

### API

すべて JSON。変更する操作 (GET 以外) には `X-BotHost: 1` ヘッダーが必要です。

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | `/api/health` | 動いているか (ログイン不要) |
| POST | `/api/register` `/api/login` `/api/logout` | アカウント |
| GET | `/api/bots` | 自分の bot の一覧 |
| POST | `/api/bots` | 作る (`{ name, template }`) |
| GET / PATCH / DELETE | `/api/bots/:id` | 見る (起動方法 `launch` つき) / 設定を変える (`name` `startCommand` `commandMode` (`auto` / `manual`) `buildCommand` `timezone` `web` (`{ enabled, regenerate }`) `autoRestart` `memoryLimitMB` `cpuLimit` `restartEveryHours` `notifyWebhook` `env`) / 削除 |
| POST | `/api/bots/:id/start` `stop` `restart` `reinstall` | 起動・停止・再起動・ライブラリの入れ直し |
| POST | `/api/bots/:id/stdin` | 標準入力に送る (`{ text }`) |
| GET | `/api/bots/:id/events` | ログ・状態・使用量のリアルタイム配信 (SSE) |
| GET / DELETE | `/api/bots/:id/logs.txt` `/api/bots/:id/logs` | ログのダウンロード / 消去 |
| POST | `/api/bots/:id/discord-check` `notify-test` | トークンの確認 / テスト通知 |
| GET | `/api/bots/:id/files` | ファイルの一覧 |
| GET / PUT / DELETE | `/api/bots/:id/file?path=` | ファイルを読む (`&download=1` で保存) / 書く (本文がそのまま中身) / 消す |
| GET | `/api/bots/:id/fileinfo?path=` | ファイルの説明 (Windows の .exe など) と、そのファイルで起動するときのコマンド |
| * | `/w/(秘密の文字)/…` | Web 公開: bot が `PORT` で待ち受けているものに渡す (ログイン不要) |
| POST | `/api/bots/:id/rename` | 名前を変える (`{ from, to }`) |
| GET / POST | `/api/bots/:id/export` `/api/bots/:id/import?replace=1` | ZIP で書き出す / 読み込む |
| GET / PATCH / DELETE / POST | `/api/admin` `/api/admin/settings` `/api/admin/users/:id` `/api/admin/backup` | 管理者 |
