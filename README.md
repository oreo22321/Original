# ForgeCode — スマホ・iPad で使える Roblox 専用 Luau エディタ

スマホ・iPad・PC のブラウザで動く、**Roblox の Luau 専用**のコードエディタです。
インストール不要で、ホーム画面に追加すればアプリのように全画面・オフラインで使えます。

![アイコン](icons/icon-192.png)

## 2 つのモード

| モード | 用途 | 特徴 |
| --- | --- | --- |
| **Studio** | Roblox Studio に貼り付けるスクリプト | Roblox の API だけを補完。`〜.server.luau` は Script、`〜.client.luau` は LocalScript、それ以外は ModuleScript として扱い、サーバーとクライアントの取り違えを指摘します |
| **Executor** | エグゼキューター用のスクリプト | `getgenv`・`writefile`・`hookmetamethod`・`Drawing` など 180 以上の関数を補完し、模擬的に実行できます |

モードはプロジェクトごとに決まり、画面下の左端 (Studio / Executor) をタップするといつでも切り替えられます。

## できること

| 機能 | 内容 |
| --- | --- |
| 💡 補完 | **Roblox の全 API** (950 クラス・8000 メンバー・662 Enum)、Luau 標準ライブラリ、**エグゼキューター API (UNC / sUNC + 別名・syn・bit など)**。自分で作ったテーブルや、`require` したモジュールの中身も候補に出ます |
| 🧠 型を推論 | `local Players = game:GetService("Players")` → `Players.` で Players のメンバー。`PlayerAdded:Connect(function(player)` の `player` は Player 型。`request({...})` の戻り値や `Drawing.new("Circle")` のプロパティも分かります |
| 👻 インライン候補 | 薄い文字で続きを提案し、**Tab** (スマホはキーボードバーの **✓**) で確定。`PlayerAdded:Connect(` → `function(player) … end)` のように引数名まで入り、同じような行をくり返すと**次の行を予測**します |
| ✍️ 誤字対策 | `GetServise`・`"Playrs"`・`part.Tranparency`・`Enum.KeyCode.Sapce` などのスペルミスに**「もしかして」**を提案。`fucntion` → `function` などの打ち間違い、全角の `（）＝”` や全角スペース、iPhone が変換した `“ ”` は**自動で修正** (文字列・コメントの中はそのまま) |
| ⚠️ エラーチェック | 構文エラー (どの `if` / `function` の `end` が足りないかまで特定)、未定義の変数、`.` と `:` の間違い、非推奨 API、待機のない無限ループ、サーバーで `LocalPlayer` を使うなどの間違い |
| 🔧 ワンタップ修正 | 行の右に出る説明をタップ (PC は ⌘/Ctrl + `.`、スマホは 💡 キー) して直し方を選べます。「誤字をまとめて直す」も可能 |
| 🔁 字下げと end | `then` / `do` / `function()` の後で改行すると `end` を自動で追加。字下げは前の行を基準に決めるので、`Connect(function()` の中でもずれません |
| ▶ 実行 | ブラウザ内の Luau 互換エンジンで実行。Roblox API とエグゼキューター API を模擬し、エラーには**日本語の解説と直し方**を表示します |
| 🖥 GUI プレビュー | スクリプトが作った ScreenGui を「ゲーム」タブに表示。**ボタンをタップすると、接続した関数が実行されます**。ClickDetector・ProximityPrompt・Touched・キー入力も試せます |
| 📑 タブ・分割 | 複数ファイルをタブで開く、並べ替え、iPad / PC では左右分割 |
| 💾 保存 | 入力が止まるとすぐ自動保存。保存が終わる前にアプリが閉じられても、**下書きから復元**します。変更履歴、ZIP の書き出し / 読み込み、共有シートにも対応 |
| 🔍 検索 | ファイル内の検索・置換 (正規表現対応)、全ファイル検索・一括置換、ファイル名検索 (⌘P)、関数・変数へ移動 |
| 📱 スマホ向け | 記号・矢印・Tab のキーボードバー、選択モード、ピンチで文字サイズ変更、長押しメニュー、画面キーボードに合わせたレイアウト |
| ✨ AI (任意) | Claude API キーを設定すると、AI による続きの提案と、コードの説明・修正・作成をするチャットが使えます |

## はじめかた (GitHub Pages で無料公開)

1. GitHub のリポジトリ画面で **Settings → Pages** を開きます。
2. **Source** を「Deploy from a branch」、**Branch** を `main` / `/(root)` にして **Save** を押します。
3. 1〜2 分待つと、`https://<ユーザー名>.github.io/<リポジトリ名>/` (このリポジトリなら `https://oreo22321.github.io/Original/`) で使えるようになります。

ビルド作業は不要です。ファイルをそのまま置くだけで動きます。
既に開いたことがある端末では、起動時に「新しいバージョンがあります」と出たら **更新** を押すと最新版になります (設定 → 情報 → アプリを最新版に更新 でも可)。

### iPhone / iPad でアプリのように使う

1. Safari で上の URL を開きます。
2. 共有ボタン (□↑) → **ホーム画面に追加** を選びます。
3. ホーム画面のアイコンから開くと、全画面で使えます。一度開けばオフラインでも動きます。

### 自分のパソコンで試す

このフォルダで `python3 -m http.server 8000` を実行し、ブラウザで `http://localhost:8000` を開きます (ファイルを直接ダブルクリックで開くと動きません)。

## 使い方

- 左上の **☰** (iPad / PC では左端のアイコン) でファイル一覧を開き、ファイルをタップして開きます。
- **▶** で実行します。結果は下の「出力」、作った GUI は「ゲーム」タブに表示されます。エラーの `ファイル名:行` をタップするとその行へ移動します。
- ファイルやタブを **長押し** (PC は右クリック) すると、名前の変更・削除・複製・共有などのメニューが出ます。
- ファイルを長押し → **▶ で常にこのファイルを実行** を選ぶと、別のファイル (モジュールなど) を編集中でも、そのファイルを実行します。
- 右上の **コピー** ボタンでコード全体をコピーできます (Studio やエグゼキューターに貼り付けるときに便利)。Executor モードでは「loadstring の 1 行を作る」も使えます。
- 詳しい使い方はアプリ内の **使い方** (本のアイコン / ⋯ メニュー) で見られます。

### キーボードショートカット (iPad / PC)

| キー | 動作 |
| --- | --- |
| ⌘/Ctrl + S | 保存 |
| ⌘/Ctrl + Enter, F5 | 実行 |
| ⌘/Ctrl + . | この行のエラーを修正 |
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

ForgeCode には JavaScript で書かれた Luau 互換のエンジンが入っていて、ブラウザ内でそのまま実行できます。

- **Luau の文法**: 型注釈、`+=` などの複合代入、`continue`、補間文字列 `` `x = {x}` ``、if 式、汎用反復 (`for k, v in t do`) に対応。
- **標準ライブラリ**: `string` (Lua パターン・`string.format` を含む) / `table` / `math` / `os` / `coroutine` / `task` / `utf8` / `bit32` / `buffer` / `debug`
- **Roblox API (模擬)**: `game`, `workspace`, `script`, `Instance.new`, すべてのクラスのプロパティ・メソッド・イベント、`Vector3`, `CFrame`, `Color3`, `UDim2`, `TweenInfo`, `Enum` などのデータ型。
  - `Players.PlayerAdded` / `CharacterAdded` は実行後に自動で発火するので、サーバースクリプトの動作確認ができます。
  - `RunService.Heartbeat`, `TweenService` (実際に時間をかけて補間), `DataStoreService` (メモリ上に保存), `HttpService:JSONEncode/JSONDecode`, `RemoteEvent` (同じ実行内でサーバー ⇄ クライアントがつながります), `require` (プロジェクト内のモジュール) などは実際に動きます。
  - サーバースクリプト (`.server.luau`) では、本物と同じく `Players.LocalPlayer` が nil になります。
  - ボタンなどのイベントに関数を接続していると、実行は終了せず「操作待ち」になります。「ゲーム」タブで操作でき、■ で終了します。
  - 物理演算・3D の描画・本物のサーバー通信は行いません。実装されていないメソッドは「模擬動作です」と表示して既定値を返します。
- **エグゼキューター API (模擬)**: 環境 (`getgenv`, `getrenv`, `getgc`, `filtergc` …)、クロージャ (`hookfunction`, `restorefunction`, `newcclosure` …)、メタテーブル (`hookmetamethod`, `getnamecallmethod`, `getrawmetatable`, `setreadonly` …)、シグナル (`getconnections`, `firesignal`, `hooksignal` …)、ファイル (`readfile` / `writefile` / `listfiles` … プロジェクトの `workspace/` フォルダに保存)、`request`, `game:HttpGet`, `crypt`, `Drawing` (実行後にプレビュー表示), `WebSocket`, `bit`, `cache`, `debug.*`, `syn.*` など。補完に出る関数はすべてサンドボックスにも存在します (`tests/executor.test.mjs` で確認)。
- 無限ループは 10 秒 (設定で変更可) で自動停止します。■ でいつでも止められます。

### AI (Claude) — 任意

設定 → **AI (Claude)** に Anthropic の API キーを入れると使えます。

- **AI チャット**: サイドバーの ✨ から、コードの説明・バグ探し・コメント追加・新しいコードの作成を頼めます。実行エラーの「AI に聞く」からも質問できます。
- **AI のインライン候補**: 入力が止まると AI が続きを提案します (オンにした場合のみ)。
- API キーはこの端末のブラウザにだけ保存され、Anthropic の API にのみ送信されます。利用料金は API キーの持ち主に請求されます。

## データの保存場所

ファイルはブラウザ内 (IndexedDB) に保存されます。保存が終わる前の内容は下書きとして別に残るので、アプリが突然閉じられても次に開いたときに復元されます。
ブラウザのデータを消去すると消えるため、大切なものは **設定 → データ → すべてのプロジェクトを ZIP で保存** でバックアップしてください。
iPhone / iPad では、ホーム画面に追加して使うとデータが消えにくくなります。

## 開発者向け

```
index.html, css/, js/        アプリ本体 (ビルド不要の ES モジュール)
  js/luau/                   Luau 互換エンジン (字句解析・構文解析・JS へのコンパイル・実行時ライブラリ・Roblox / エグゼキューター模擬)
  js/editor/                 エディタ機能
    luau-lang.js             色付けと字下げ
    blocks.js                ブロック構造の解析 (end の自動入力・過不足の診断・整形)
    luau-intel.js            型の推論と補完
    inline.js                インライン候補 (ゴーストテキスト)
    lint.js / typo.js        エラーチェック・誤字検出・自動修正
    errorlens.js             行の右に出るエラー表示
  js/app/                    画面 (ファイル一覧・タブ・実行パネル・GUI プレビュー・設定・初回案内など)
  js/workers/                実行用の Web Worker
  js/data/                   補完用の API データ (Luau・エグゼキューター・スニペット)
data/roblox-api.json         Roblox API ダンプ (変換済み)
vendor/                      同梱ライブラリ (CodeMirror 6, fflate, Anthropic SDK)。ライセンスは vendor/LICENSES.txt
sw.js                        オフライン用 Service Worker
tests/                       テスト
tools/                       ライブラリと API データを作り直すスクリプト
```

- テスト: `for f in tests/*.test.mjs; do node "$f" || break; done`
  - `luau-basic` (言語) / `roblox` (Roblox 模擬) / `executor` (エグゼキューター API の網羅) / `intel` (型推論) / `indent` (字下げ・end・整形) / `lint` (エラーチェック・誤字) / `inline` (インライン候補)
- Roblox API データの更新: `node tools/build-roblox-api.mjs` (最新の API ダンプを取得して `data/roblox-api.json` を作り直します)
- ライブラリの作り直し: `cd tools && npm install && npm run vendor`
- ファイルを変更したら `node tools/build-sw.mjs` で Service Worker のキャッシュ一覧を更新してください (更新しないと古いキャッシュが使われることがあります)。

Roblox は Roblox Corporation の商標です。ForgeCode は Roblox Corporation とは関係ありません。
