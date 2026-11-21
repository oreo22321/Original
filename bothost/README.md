# BotHost — bot を 24 時間動かしておくサービス

Discord などの bot のコードを置いて、ブラウザから **起動・停止・ログの確認・ファイルの編集** ができる、自分で動かせる bot ホスティングです。外部のライブラリは使っていないので、Node.js があれば `node server.js` だけで動きます。

## できること

- **アカウント**: 登録・ログイン (パスワードは scrypt で保存)。最初に登録した人が管理者になります
- **bot を作る**: テンプレートから選ぶだけ
  - Discord bot (Python / discord.py) — `!ping` `!hello` に返事
  - Discord bot (Node.js / discord.js) — 同じ
  - 空の Python / 空の Node.js — Discord 以外の bot や定期処理も
- **起動・停止・再起動**、状態 (動作中 / 準備中 / 再起動待ち / エラーで停止) の表示
- **コンソール**: bot の出力 (stdout / stderr) がリアルタイムに流れる。`input()` 用に標準入力も送れる。ログの保存・消去
- **ファイル**: 一覧・編集 (行番号・Tab・自動の字下げ・Ctrl/⌘+S で保存)・新規作成・アップロード・名前の変更・削除
- **環境変数**: `DISCORD_TOKEN` などのトークンを、コードに書かずに渡せる。保存した値は画面にも API にも出しません
- **ライブラリの自動インストール**: `requirements.txt` (pip) / `package.json` (npm) があれば起動の前に入れます。中身が変わったときだけ入れ直すので 2 回目からは速い
- **落ちたら自動で再起動**: 2 秒・4 秒・8 秒…と待ってから再起動。5 分で 5 回落ちたらあきらめて「エラーで停止」に
- **使用量**: CPU・メモリ・稼働時間。メモリの上限を超えたら止めます
- **サーバーを再起動しても**、動かしていた bot は自動でまた動きます
- スマホでも使えます (ライト / ダークモード)

## 動かし方

```sh
cd bothost
node server.js
# → http://localhost:3000 を開いて、アカウントを作る
```

Discord bot を動かすまで:

1. 「＋ 新しい bot」→「Discord bot (Python)」か「Discord bot (Node.js)」を選ぶ
2. [Discord Developer Portal](https://discord.com/developers/applications) でアプリを作り、**Bot → Reset Token** でトークンをコピー
3. 同じページの **Privileged Gateway Intents → MESSAGE CONTENT INTENT** をオン
4. **OAuth2 → URL Generator** で `bot` にチェックして、出た URL から自分のサーバーに招待
5. BotHost の **設定 → 環境変数** に `DISCORD_TOKEN` = トークン を入れて保存
6. **▶ 起動**。コンソールに「ログインしました」と出たら、Discord で `!ping` と送る

## 設定 (環境変数)

| 名前 | 既定 | 内容 |
| --- | --- | --- |
| `PORT` | `3000` | 待ち受けるポート |
| `HOST` | `0.0.0.0` | 待ち受けるアドレス |
| `BOTHOST_DATA` | `./data` | データ (アカウント・bot のファイル) を置く場所 |
| `BOTHOST_MODE` | `process` | `process`: そのまま動かす / `docker`: bot ごとにコンテナで動かす |
| `BOTHOST_REGISTRATION` | `open` | `first-only` にすると、最初の 1 人 (管理者) のあとは登録できなくなる |
| `BOTHOST_MAX_BOTS` | `5` | 1 人が作れる bot の数 (管理者は無制限) |
| `BOTHOST_MAX_DISK_MB` | `500` | bot のファイル全体の上限 |
| `BOTHOST_SECURE_COOKIE` | なし | `1` にするとクッキーに Secure を付ける (HTTPS で公開するとき) |
| `BOTHOST_PYTHON` | `python3` | process モードで使う Python |

## 安全のために (大事)

- **`process` モード** は bot がサーバーと同じマシン・同じユーザーでそのまま動きます。手軽ですが、bot のコードはサーバーの中のファイルを読めます。**自分と信頼できる人だけで使う** ときに使ってください (`BOTHOST_REGISTRATION=first-only` がおすすめ)。
- **知らない人にも使わせる** なら `BOTHOST_MODE=docker` にしてください。bot ごとに Docker コンテナで動かし、メモリ・CPU・プロセス数に上限を付け、権限を落とし (`--cap-drop ALL`)、bot のフォルダーだけを見せます。サーバーに Docker が必要で、`python:3.12-slim` / `node:22-slim` のイメージを使います。
- 公開するときは HTTPS (Caddy や nginx などのリバースプロキシ) の後ろに置き、`BOTHOST_SECURE_COOKIE=1` にしてください。
- ファイルの API はフォルダーの外 (`../`・絶対パス・外を指すシンボリックリンク) を扱いません。変更する API には `X-BotHost: 1` ヘッダーが必須です (CSRF 対策)。

## サーバーに置く

VPS などで:

```sh
docker build -t bothost bothost
docker run -d --name bothost -p 3000:3000 -v bothost-data:/data --restart unless-stopped bothost
```

(このコンテナは `process` モードです。`docker` モードにするには、ホストの Docker を使えるようにしたうえで、データの場所をホストと同じパスにしてください。)

## テスト

```sh
cd bothost
npm test
```

登録・ログイン・ほかの人の bot が見えないこと・ファイルの読み書きとフォルダーの外への拒否・環境変数を返さないこと・起動 → ログ (SSE) → 標準入力 → 使用量 → 停止・自動の再起動とあきらめ・ライブラリのインストール (2 回目はしない)・サーバー再起動後の再開・削除、を実際にサーバーを立てて確かめます。

## つくり

```
bothost/
├── server.js          HTTP サーバー・API・ログのリアルタイム配信 (Server-Sent Events)
├── lib/
│   ├── runner.js      bot のプロセス管理 (インストール・起動・停止・自動再起動・使用量)
│   ├── files.js       bot のファイル操作 (フォルダーの外に出ない)
│   ├── auth.js        パスワード・セッション
│   └── store.js       データの保存 (JSON)
├── public/            画面 (HTML / CSS / JS。フレームワークなし)
├── templates/         新しい bot のひな形
└── test/              テスト
```

### API

すべて JSON。変更する操作 (GET 以外) には `X-BotHost: 1` ヘッダーが必要です。

| メソッド | パス | 内容 |
| --- | --- | --- |
| POST | `/api/register` `/api/login` `/api/logout` | アカウント |
| GET | `/api/bots` | 自分の bot の一覧 |
| POST | `/api/bots` | 作る (`{ name, template }`) |
| GET / PATCH / DELETE | `/api/bots/:id` | 見る / 設定を変える (`name` `startCommand` `autoRestart` `memoryLimitMB` `cpuLimit` `env`) / 削除 |
| POST | `/api/bots/:id/start` `stop` `restart` | 起動・停止・再起動 |
| POST | `/api/bots/:id/stdin` | 標準入力に送る (`{ text }`) |
| GET | `/api/bots/:id/events` | ログ・状態・使用量のリアルタイム配信 (SSE) |
| GET | `/api/bots/:id/files` | ファイルの一覧 |
| GET / PUT / DELETE | `/api/bots/:id/file?path=` | ファイルを読む / 書く (本文がそのまま中身) / 消す |
| POST | `/api/bots/:id/rename` | 名前を変える (`{ from, to }`) |
