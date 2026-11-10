# ForgeCode — スマホ・iPad で使えるコードエディタ

**Luau (Roblox) / Lua / Python** に対応した、スマホ・iPad・PC のブラウザで動くコードエディタです。
インストール不要で、ホーム画面に追加すればアプリのように全画面・オフラインで使えます。

![アイコン](icons/icon-192.png)

> 🔒 **おまけ: Luau 難読化ツール** — 同じリポジトリの `obfuscator/` に、Luau / Lua を
> **独自バイトコードVM**へ変換して強力に難読化するサイトが入っています。公開後は
> `https://oreo22321.github.io/Original/obfuscator/` で使えます。詳しくは
> [難読化ツールについて](#難読化ツールについて) を参照してください。

## できること

| 機能 | 内容 |
| --- | --- |
| 🎨 シンタックスハイライト | Luau / Lua / Python / JavaScript / JSON / HTML / CSS / Markdown。テーマ 10 種類 (Roblox Studio 風もあり) |
| 💡 補完 | **Roblox の全 API** (950 クラス・8000 メンバー・662 Enum)、Luau 標準ライブラリ、**エグゼキューター API (UNC)**、Python の組み込み関数と主要モジュール |
| 🧠 型を推論する補完 | `local Players = game:GetService("Players")` → `Players.` で Players のメンバーが出る。`PlayerAdded:Connect(function(player)` の `player` は Player 型、`Touched` の `hit` は BasePart 型として補完 |
| 👻 インライン候補 | 薄い文字で続きを提案し、**Tab** (スマホはキーボードバーの **✓**) で確定。例: `local Players = ` → `game:GetService("Players")`、`:Connect(` → `function() … end)` |
| ✨ AI 候補・チャット | Claude API キーを設定すると、AI による続きの提案と、コードの説明・修正・作成をするチャットが使えます (任意) |
| 🔁 end の自動入力 | `then` / `do` / `function()` の後で改行すると `end` を自動で追加 |
| ⚠️ エラーチェック | 文法エラー、定義されていない変数、使われていない変数、非推奨 API (`wait()` → `task.wait()` など)、`.` と `:` の間違い。ワンタップで修正 |
| ▶ 実行 | **Luau / Lua** はブラウザ内の Luau 互換エンジンで実行 (Roblox API とエグゼキューター API を模擬)、**Python** は Pyodide、**JavaScript** も実行可能。HTML / Markdown はプレビュー |
| 📑 タブ・分割 | 複数ファイルをタブで開く、並べ替え、iPad / PC では左右分割 |
| 💾 保存 | 端末内 (IndexedDB) に自動保存、変更履歴から復元、ZIP で書き出し / 読み込み、共有シートから「ファイルに保存」 |
| 🔍 検索 | ファイル内の検索・置換 (正規表現対応)、全ファイル検索・一括置換、ファイル名検索 (⌘P)、関数・変数へ移動 |
| 📱 スマホ向け | 記号・矢印・Tab のキーボードバー、選択モード、ピンチで文字サイズ変更、長押しメニュー、画面キーボードに合わせたレイアウト |
| ⌨️ iPad / PC 向け | VS Code と同じショートカット、コマンドパレット (⌘⇧P)、サイドバー・パネルのサイズ変更 |
| 🎨 カラーピッカー | `Color3.fromRGB(…)` の横の四角をタップすると色を選べる |
| ⚙️ かんたん設定 | 「Roblox 開発」「エグゼキューター」「Python 学習」などワンタップで設定。初回起動時は 3 ステップの案内付き |

## はじめかた (いちばん簡単な方法: GitHub Pages で無料公開)

1. このブランチを `main` にマージします (プルリクエストを作って Merge)。
2. GitHub のリポジトリ画面で **Settings → Pages** を開きます。
3. **Source** を「Deploy from a branch」、**Branch** を `main` / `/(root)` にして **Save** を押します。
4. 1〜2 分待つと、`https://<ユーザー名>.github.io/<リポジトリ名>/` (このリポジトリなら `https://oreo22321.github.io/Original/`) で使えるようになります。

ビルド作業は一切不要です。ファイルをそのまま置くだけで動きます。

### iPhone / iPad でアプリのように使う

1. Safari で上の URL を開きます。
2. 共有ボタン (□↑) → **ホーム画面に追加** を選びます。
3. ホーム画面のアイコンから開くと、全画面で使えます。一度開けばオフラインでも動きます (Python は初回のみインターネットが必要)。

### ほかの公開方法

- **Render**: リポジトリに `render.yaml` が入っています。Render で **New + → Blueprint** を選び、このリポジトリを接続して **Apply** を押すだけです (静的サイト・無料)。
- **自分のパソコンで試す**: このフォルダで `python3 -m http.server 8000` を実行し、ブラウザで `http://localhost:8000` を開きます (ファイルを直接ダブルクリックで開くと動きません)。

## 使い方

- 左上の **☰** (iPad / PC では左端のアイコン) でファイル一覧を開き、ファイルをタップして開きます。
- **▶ 実行** で実行し、結果は下の「出力」パネルに表示されます。エラーの `ファイル名:行` をタップするとその行へ移動します。
- ファイルやタブを **長押し** (PC は右クリック) すると、名前の変更・削除・複製・共有などのメニューが出ます。
- 右上の **コピー** ボタンでコード全体をコピーできます (エグゼキューターに貼り付けるときに便利)。
- 詳しい使い方はアプリ内の **使い方** (本のアイコン / ⋯ メニュー) で見られます。

### キーボードショートカット (iPad / PC)

| キー | 動作 |
| --- | --- |
| ⌘/Ctrl + S | 保存 |
| ⌘/Ctrl + Enter, F5 | 実行 |
| ⌘/Ctrl + P | ファイルを開く (`>` でコマンド、`:` で行、`@` で関数へ移動) |
| ⌘/Ctrl + Shift + P | コマンドパレット |
| ⌘/Ctrl + F / Shift + F | 検索・置換 / 全ファイル検索 |
| ⌘/Ctrl + / | コメント切り替え |
| ⌘/Ctrl + D | 同じ単語を追加選択 (マルチカーソル) |
| Alt + ↑ / ↓ | 行を移動 |
| Shift + Alt + F | 整形 |
| ⌘/Ctrl + B / J | サイドバー / パネルの表示切り替え |
| Tab / ⌘/Ctrl + → | インライン候補を確定 / 1 単語だけ確定 |

## 実行環境について

### Luau / Lua (Roblox サンドボックス)

ForgeCode には JavaScript で書かれた Luau 互換のエンジンが入っていて、ブラウザ内でそのまま実行できます。

- **Luau の文法**: 型注釈、`+=` などの複合代入、`continue`、補間文字列 `` `x = {x}` ``、if 式、汎用反復 (`for k, v in t do`) に対応。
- **標準ライブラリ**: `string` (Lua パターン・`string.format` を含む) / `table` / `math` / `os` / `coroutine` / `task` / `utf8` / `bit32` / `buffer` / `debug`
- **Roblox API (模擬)**: `game`, `workspace`, `script`, `Instance.new`, すべてのクラスのプロパティ・メソッド・イベント、`Vector3`, `CFrame`, `Color3`, `UDim2`, `TweenInfo`, `Enum` などのデータ型。
  - `Players.PlayerAdded` / `CharacterAdded` は実行後に自動で発火するので、サーバースクリプトの動作確認ができます。
  - `RunService.Heartbeat`, `TweenService` (実際に時間をかけて補間), `DataStoreService` (メモリ上に保存), `HttpService:JSONEncode/JSONDecode`, `RemoteEvent` (同じ実行内でサーバー ⇄ クライアントがつながります), `require` (プロジェクト内のモジュール) などは実際に動きます。
  - 物理演算・描画・本物のサーバー通信は行いません。実装されていないメソッドは「模擬動作です」と表示して既定値を返します。
  - 実行後は「ゲーム」タブで、作成されたオブジェクトのツリーを確認できます。
- **エグゼキューター API (模擬)**: `getgenv`, `getrenv`, `hookfunction`, `hookmetamethod`, `getnamecallmethod`, `getrawmetatable`, `setreadonly`, `newcclosure`, `getconnections`, `firesignal`, `fireclickdetector`, `readfile` / `writefile` / `listfiles` などのファイル関数 (プロジェクトの `workspace/` フォルダに保存)、`request`, `game:HttpGet`, `crypt`, `Drawing` (実行後にプレビュー表示), `WebSocket`, `setclipboard`, `identifyexecutor` など。
- `.lua` ファイルは、設定で「標準 Lua (Roblox API なし)」として実行することもできます。
- 無限ループは 10 秒 (設定で変更可) で自動停止します。■ 停止ボタンでいつでも止められます。

### Python

[Pyodide](https://pyodide.org/) (ブラウザ版の Python 3) を使います。初回の実行時に数十 MB をダウンロードするので少し時間がかかります (以降はキャッシュされます)。
`input()` に渡す値は、出力パネルの ⌨ ボタンで開く「標準入力」欄に 1 行ずつ書いておきます。プロジェクト内の別の `.py` ファイルを `import` でき、`open()` で書いたファイルはプロジェクトに保存されます。

### AI (Claude) — 任意

設定 → **AI (Claude)** に Anthropic の API キーを入れると使えます。

- **AI チャット**: サイドバーの ✨ から、コードの説明・バグ探し・コメント追加・新しいコードの作成を頼めます。回答のコードは「挿入」「選択範囲と置換」ボタンでエディタに入れられます。
- **AI のインライン候補**: 入力が止まると AI が続きを提案します (オンにした場合のみ)。
- API キーはこの端末のブラウザにだけ保存され、Anthropic の API にのみ送信されます。利用料金は API キーの持ち主に請求されます。

## データの保存場所

ファイルはブラウザ内 (IndexedDB) に保存されます。ブラウザのデータを消去すると消えるため、大切なものは **設定 → データ → すべてのプロジェクトを ZIP で保存** でバックアップしてください。
iPhone / iPad では、ホーム画面に追加して使うとデータが消えにくくなります。

## 開発者向け

```
index.html, css/, js/        アプリ本体 (ビルド不要の ES モジュール)
  js/luau/                   Luau 互換エンジン (字句解析・構文解析・JS へのコンパイル・実行時ライブラリ・Roblox / エグゼキューター模擬)
  js/editor/                 エディタ機能 (ハイライト・補完・インライン候補・エラーチェック・整形・AI)
  js/app/                    画面 (ファイル一覧・タブ・パネル・設定・初回案内など)
  js/workers/                実行用の Web Worker (Luau / Python)
  js/data/                   補完用の API データ (Luau・エグゼキューター・Python・スニペット)
data/roblox-api.json         Roblox API ダンプ (変換済み)
vendor/                      同梱ライブラリ (CodeMirror 6, fflate, Anthropic SDK)。ライセンスは vendor/LICENSES.txt
sw.js                        オフライン用 Service Worker
tests/                       テスト (node tests/luau-basic.test.mjs など)
tools/                       ライブラリと API データを作り直すスクリプト
```

- テスト: `node tests/luau-basic.test.mjs && node tests/roblox.test.mjs && node tests/intel.test.mjs`
- Roblox API データの更新: `node tools/build-roblox-api.mjs` (最新の API ダンプを取得して `data/roblox-api.json` を作り直します)
- ライブラリの作り直し: `cd tools && npm install && npm run vendor`
- ファイルを変更したら `node tools/build-sw.mjs` で Service Worker のキャッシュ一覧を更新してください (更新しないと古いキャッシュが使われることがあります)。

## 難読化ツールについて

`obfuscator/` フォルダは、**Luau / Lua のソースコードを強力に難読化する独立したサイト**です。
GitHub Pages で公開すると `https://oreo22321.github.io/Original/obfuscator/` から誰でも使えます
（エディタ本体はトップ、難読化ツールは `/obfuscator/`）。サーバー不要・ビルド不要で、
**処理はすべて端末のブラウザ内だけ**で行われ、コードが外部に送信されることはありません。

### 難読化の方式

- **独自バイトコードVM**: スクリプトを独自の命令（ノード）配列へコンパイルし、出力には
  埋め込みの Lua 製インタプリタ（VM）だけを残します。元の制御構造・変数名・文字列は復元できません。
  実際の演算（メタテーブル・多値・可変長引数・クロージャ等）は Lua 本体に委譲するので、
  幅広い構文で正しく動きます。
- **制御フロー平坦化**: VM の dispatch ループにより、if 文やループが命令番号による巨大な
  状態機械に置き換わります。
- **二重VM＋暗号化**: 定数プールを暗号化し、復号層 → VM の二層構造にします（「最強」プリセット
  では VM 自体をさらに VM で包みます）。
- **改ざん検知（アンチタンパー）**: 整合性チェックを埋め込みます（正常な実行は壊しません）。
- 従来方式（スコープ対応の**変数名リネーム**、**グローバル間接化**、**文字列暗号化**、
  **数値難読化**、**ジャンクコード**、**ミニファイ**）も選べます。

### 「ちゃんと動く」保証

難読化後は、同梱の Luau 実行エンジンで**元コードと難読化後コードの両方を実行して出力が一致するか
自動検証**します。もし一致しない・対応できない構文があれば、**強い変換から自動で外して**（VM →
従来方式へフォールバック）、検証を通った構成だけを返します。Roblox API など実機が必要で
ブラウザ内では実行できないコードは、構文チェックのみで保証し、画面にその旨を表示します。

### 使い方

1. `obfuscator/` を含むこのブランチを公開（GitHub Pages など）。
2. ページを開き、コードを貼り付けて強さ（軽い / 標準 / 強力(VM) / 最強(二重VM)）を選び、
   「難読化する」を押します。
3. 「コピー」または「.lua でダウンロード」で保存します。

自作コードの保護・学習用途向けです。他人のコードの無断改変や不正利用には使わないでください。

テスト: `node --test tests/obfuscate.test.mjs`（難読化前後で実行結果が一致することを確認します）。

---

Roblox は Roblox Corporation の商標です。ForgeCode は Roblox Corporation とは関係ありません。
