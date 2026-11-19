# BotRunner — 自分の Discord bot を 24 時間・無料で動かす

有料のホスティングを使わずに、自分の Discord bot (Python / discord.py) を 24 時間動かすためのアプリです。
iPhone のホーム画面に置いて、bot の作成・起動・停止・コードの編集・ログの確認ができます。**アプリを閉じても bot は止まりません。**

```
 iPhone (BotRunner アプリ)  ──操作──▶  サーバー (BotRunner 本体)  ──24 時間接続──▶  Discord
   閉じても OK                         bot はここで動き続ける
```

## できること

- **bot をいくつでも**: 1 つのサーバーで何個でも動かせます (それぞれ別のプログラムとして動きます)
- **24 時間動かす**: 落ちたら自動で再起動 (続けて落ちるときは間隔をあけます)。サーバーが再起動しても、動かしていた bot は自動で動きます
- **スマホでコード編集**: 字下げの自動入力・記号キー・iPhone が勝手に変える “ ” の自動修正・文法チェック付き。「保存して再起動」ですぐ反映
- **ログをリアルタイムで**: `print` やエラーがその場で流れてきます
- **エラーを日本語で**: トークンの間違い、Intent の設定忘れ、パッケージの入れ忘れ、文法エラー、ネットにつながらないなどを見分けて直し方を表示します
- **トークンの確認と招待リンク**: トークンを貼ると Discord に問い合わせて確かめ、自分のサーバーに招待するボタンを作ります
- **パッケージ**: bot ごとに必要なライブラリを書いておくと、自動で入ります
- **ひな形**: スラッシュコマンド / メッセージへの返事 / コマンド + 定期実行 + データ保存

## どこで動かす?

bot を 24 時間動かすには、つけっぱなしのマシンが 1 台いります。どれも無料です。

| 場所 | おすすめ度 | メモ |
| --- | --- | --- |
| **Oracle Cloud の Always Free** | ◎ | PC なしで 24 時間・ずっと無料。登録に本人確認用のクレジットカードが要ります (請求はされません) |
| 家の PC (Windows / Mac / Linux) | ○ | つけっぱなしにする必要があります。スリープしない設定に |
| Raspberry Pi | ○ | 電気代が安い。Raspberry Pi OS で `install.sh` が使えます |
| 使っていない Android スマホ | △ | Termux アプリで動きます。充電しっぱなしで |

> iPhone 単体では動かせません。iPhone はアプリを閉じるとプログラムを止めてしまうためです。iPhone は「操作するリモコン」として使います。

## はじめかた

### 1. サーバーに入れる

**Oracle Cloud / Linux / Raspberry Pi / Mac** (ターミナルで):

```bash
git clone https://github.com/oreo22321/Original.git
cd Original/botrunner
bash install.sh
```

ライブラリが入り、マシンの起動時に自動で動くように設定されます。最後に **初回の設定コード (6 桁)** が表示されるので、メモしておいてください。

**Windows**: Python を [python.org](https://www.python.org/downloads/) から入れ (「Add python.exe to PATH」にチェック)、`botrunner` フォルダの **start.bat** をダブルクリックします。PC の起動時に自動で動かすには、`Win + R` → `shell:startup` で開いたフォルダに start.bat のショートカットを入れます。

**Android (Termux)**: F-Droid から Termux を入れ、`pkg install git` のあと上と同じコマンドを実行します。

> リポジトリが非公開のときは、`git clone` でユーザー名と、パスワードの代わりに GitHub のトークンを聞かれます。

<details>
<summary>Oracle Cloud で無料のサーバーを作る手順</summary>

1. [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/) で無料アカウントを作ります (ホームリージョンは Japan East (Tokyo) など近い場所に)
2. メニュー → コンピュート → インスタンス → **インスタンスの作成**
   - イメージ: **Ubuntu**
   - シェイプ: 「Always Free 対象」と書かれたもの (`VM.Standard.E2.1.Micro` か `VM.Standard.A1.Flex`)
   - SSH キー: 「秘密キーを保存」でダウンロード
3. 作成できたら、インスタンスの画面の右上 **Cloud Shell** (ブラウザ内のターミナル) か、手元のターミナルから接続します:
   `ssh -i ダウンロードした鍵 ubuntu@パブリックIP`
4. `sudo apt update && sudo apt install -y git` のあと、上の「1. サーバーに入れる」のコマンドを実行します

ポートを外に公開する設定 (セキュリティ・リスト) は **しなくて大丈夫** です。次の Tailscale でつなぎます。
</details>

### 2. iPhone からつなぐ (Tailscale・無料)

サーバーをインターネットにそのまま公開すると危ないので、自分の端末どうしだけを安全につなぐ **Tailscale** を使います。

1. サーバーで:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```
   表示された URL を開いてログインします (Google / Apple / GitHub アカウントで OK)
2. iPhone に App Store から **Tailscale** を入れ、同じアカウントでログインして接続をオンにします
3. `tailscale ip -4` で表示されるアドレスを使って、Safari で `http://100.x.x.x:8765` を開きます
4. 初回の設定コードと、新しいパスワードを入れます
5. 共有ボタン (□↑) → **ホーム画面に追加** で、アプリとして使えます

> 家の PC で動かしていて、iPhone が同じ Wi-Fi にいるときだけ使うなら、Tailscale なしで、サーバーを起動したときに表示される `http://192.168.x.x:8765` でも開けます。

### 3. bot を作る

1. アプリで **＋ はじめての bot を作る** → 名前とひな形を選んで作成
2. [Discord Developer Portal](https://discord.com/developers/applications) で **New Application** → 左の **Bot** → **Reset Token** でトークンをコピー
3. アプリの「設定」にトークンを貼って **保存** (Discord に確認して、bot の名前が出れば OK)
4. **Discord のサーバーに招待する** を押して、自分のサーバーに追加
5. **▶ 起動**。ログに `ログインしました: ○○` と出れば動いています

メッセージを読む bot (ひな形の「メッセージに反応する」など) は、Developer Portal の Bot ページで **MESSAGE CONTENT INTENT** をオンにしてください。

## bot の書き方のきまり

- トークンは `os.environ["DISCORD_TOKEN"]` で受け取ります (コードにトークンを書かないでください)
- `print()` した内容とエラーは「ログ」に出ます
- 作業フォルダは bot ごとの専用フォルダです。`open("data.json", "w")` のように書いたファイルは、再起動しても残ります
- discord.py 以外のライブラリは「設定 → パッケージ」に 1 行ずつ書きます (例: `aiohttp`、`requests`)
- 自分でプログラムを終わらせた (終了コード 0) ときは、自動で再起動しません

ForgeCode (このリポジトリの Python エディタ) で書いて、コードを貼り付けて使うこともできます。

## 更新・管理

```bash
cd Original && git pull
sudo systemctl restart botrunner     # Linux の場合 (Mac はログインし直すか launchctl で再読み込み)
```

| やりたいこと | コマンド (Linux) |
| --- | --- |
| 状態を見る | `sudo systemctl status botrunner` |
| サーバー自体のログ | `journalctl -u botrunner -f` |
| 止める / 動かす | `sudo systemctl stop botrunner` / `start` |
| パスワードを忘れた | `cd Original/botrunner && .venv/bin/python server.py --set-password` |

bot のコード・トークン・ログは `botrunner/data/` に入っています。このフォルダをコピーすればバックアップになります (GitHub には上がりません)。

## 安全のために

- 管理画面は、パスワードを知っている人なら **サーバーで好きなプログラムを動かせます**。パスワードは長めにし、サーバーのポート (8765) をインターネットに直接公開しないでください (Tailscale を使う)
- パスワードを決めるまでは、サーバーに表示された 6 桁の設定コードがないと設定できません
- ログインの失敗が続くと、しばらく受け付けなくなります
- トークンはサーバーの `data/` にだけ保存し、画面には送り返しません

## うまくいかないとき

| 表示 | 直し方 |
| --- | --- |
| トークンが正しくありません | Developer Portal → Bot → Reset Token で作り直して貼り直す |
| 特権 Intent が許可されていません | Developer Portal → Bot → Privileged Gateway Intents で必要なものをオン |
| パッケージ「○○」が入っていません | 設定 → パッケージ に名前を書いて保存 |
| Discord に接続できません | サーバーのネット接続を確認 (つながれば自動で再開) |
| スラッシュコマンドが出てこない | 反映に数分かかることがあります。Discord を再起動してみる |
| アプリが「サーバーに接続できません」 | サーバーが動いているか、Tailscale がオンかを確認 |

## 開発者向け

```
server.py           本体 (aiohttp)。管理画面の配信・API・bot の起動と見張り
static/             画面 (HTML / CSS / JavaScript。ビルド不要)
templates/          新しい bot のひな形 (# title: / # desc: の行が一覧に出ます)
install.sh          Linux / Mac / Termux 用インストーラー
start.bat           Windows 用
tests/              テスト:  python -m unittest discover -s botrunner/tests
```
