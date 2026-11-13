# ForgeCode — スマホ・iPad で使える Roblox 専用 Luau エディタ

スマホ・iPad・PC のブラウザで動く、**Roblox の Luau 専用**のコードエディタです。
インストール不要で、ホーム画面に追加すればアプリのように全画面・オフラインで使えます。
**Claude を内蔵**しており、[Claude 版](https://claude.ai/artifact/A8AyqZNprnumvcP85pG6mJ) で開けば API キーなしで、Claude がファイルを読み・編集し・実行して確かめながらコードを書きます。

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
| 🧠 型を推論 | `local Players = game:GetService("Players")` → `Players.` で Players のメンバー。`PlayerAdded:Connect(function(player)` の `player` は Player 型。**スコープを正しく見分け**、自分で作った**関数の戻り値**・**クラス** (`setmetatable` と `self.X`)・**`type` 定義**・`if x:IsA("Part") then` での**絞り込み**・`camera:WorldToViewportPoint` のような複数の戻り値まで推論します |
| 🎯 場面に合う候補 | `part.Material = ` で Enum の一覧、`humanoid:ChangeState(` で引数の Enum、`frame.Size = UD` で `UDim2.new(...)`、`TweenService:Create(part, info, {` でアニメーションできるプロパティ、`GetAttribute("` で使った属性名。見えている変数は**型付きで近いものから**並び、よく使うメンバーほど上に出ます |
| 👻 インライン候補 | 薄い文字で続きを提案し、**Tab** (スマホはキーボードバーの **✓**) で確定。`PlayerAdded:Connect(` → `function(player) … end)` のように引数名まで入り、`frame.Parent = ` では親にふさわしい変数、`Instance.new("TextLabel")` の次の行では**次に設定するプロパティ**、`mt.__namecall = ` ではフックのひな形を提案。同じような行をくり返すと**次の行を予測**します |
| 🧹 自動整形 | 書き終えた行の空白 (`x=1+2` → `x = 1 + 2`) を整え、入力が止まったときにエラーがなければファイル全体の字下げ・空行も**裏で自動で直します**。カーソルの行には触れず、整形の前後で字句が同じことを確認するのでコードの意味は変わりません |
| ✍️ 誤字対策 | `GetServise`・`"Playrs"`・`part.Tranparency`・`Enum.KeyCode.Sapce` などのスペルミスに**「もしかして」**を提案。`fucntion` → `function` などの打ち間違い、全角の `（）＝”` や全角スペース、iPhone が変換した `“ ”` は**自動で修正** (文字列・コメントの中はそのまま) |
| ⚠️ エラーチェック | 構文エラー (どの `if` / `function` の `end` が足りないかまで特定)、未定義の変数、`.` と `:` の間違い、非推奨 API、待機のない無限ループ、サーバーで `LocalPlayer` を使うなどの間違い |
| 🔧 ワンタップ修正 | 行の右に出る説明をタップ (PC は ⌘/Ctrl + `.`、スマホは 💡 キー) して直し方を選べます。「誤字をまとめて直す」も可能 |
| 🔁 字下げと end | `if ... then` / `for ... do` / `function()` を**書いた時点で `end` を自動で追加**、`if` や `function` を消すと**対の `end` も自動で削除**。自分で `end` を書いても二重になりません。字下げは前の行を基準に決めるので、`Connect(function()` の中でもずれません |
| ▶ 実行 | ブラウザ内の Luau 互換エンジンで実行。Roblox API とエグゼキューター API を模擬し、エラーには**日本語の解説と直し方**を表示します |
| 🐞 デバッガー | 行番号の左をタップして**ブレークポイント**。止まった場所の変数・テーブルの中身・呼び出し履歴を確認し、**ステップ実行** (次の行へ / 関数の中へ / 外へ)。条件付きブレークポイント、ログポイント、ウォッチ式にも対応 |
| ⌨️ コンソール | 出力の下の欄で、式やコードをその場で実行。実行後もスクリプトの変数や作ったオブジェクトを調べられます |
| 🧭 コードの移動 | **定義へ移動** (F12)、**参照を検索** (⇧F12)、スコープを考慮した**名前の一括変更** (F2)、同じ変数のハイライト、**スティッキースクロール** |
| 🎮 ゲーム画面 | スクリプトが作った ScreenGui を、**Roblox と同じ規則で大きさ・位置を計算**して表示 (UIListLayout / UIGridLayout / UIPadding / UIScale / AutomaticSize / ScrollingFrame / UIFlexItem / UICorner / UIStroke / UIGradient / リッチテキスト)。**タップ・ドラッグ・スクロール・文字入力・キー入力**がそのままスクリプトに届きます (スライダーやウィンドウの移動も可)。スマホ / タブレット / PC の画面に切り替え、全画面表示 (スマホは自動で横向き) にも対応 |
| 📦 loadstring | `loadstring(game:HttpGet(URL))()` をそのまま実行。**Obsidian・LinoriaLib・Orion・Kavo・WindUI などの UI ライブラリが実際に表示・操作できます**。取得した中身は端末に保存され、オフラインでも動きます。CORS で読めないサイトは「中継」か「中身を登録」で対応 |
| 📚 ライブラリの補完 | loadstring の行があると、裏でライブラリのソースを読み取り、補完・ゴーストテキスト・ヒントに追加。`local Window = ` → `Library:CreateWindow({...})`、`Groupbox:AddToggle(` → `Text` / `Default` / `Callback` の雛形、`Toggles.MyToggle:` → `OnChanged` など |
| 📑 タブ・分割 | 複数ファイルをタブで開く、並べ替え、iPad / PC では左右分割 |
| 💾 保存 | 入力が止まるとすぐ自動保存。保存が終わる前にアプリが閉じられても、**下書きから復元**します。変更履歴、ZIP の書き出し / 読み込み、共有シートにも対応 |
| 🔍 検索 | ファイル内の検索・置換 (正規表現対応)、全ファイル検索・一括置換、ファイル名検索 (⌘P)、関数・変数へ移動 |
| 📱 スマホ向け | 記号・矢印・Tab のキーボードバー、選択モード、ピンチで文字サイズ変更、長押しメニュー、画面キーボードに合わせたレイアウト |
| ✨ Claude 内蔵 | 「Claude」パネルで頼むと、Claude が**ファイルを読み・編集・作成し、実行して出力・エラー・画面の GUI を確かめながら**仕上げます (Claude Code のような使い方)。変更は差分で確認でき、まとめて元に戻せます。UI のスクリーンショットも添付できます |
| ✨ エディタの AI | ✨ キー (Alt + `\`) で Claude が続きを提案、範囲を選んで ✨ (⌘/Ctrl + I) で説明・バグ修正・整理・コメント・型注釈・指示して書き換え。エラーのメニューと実行エラーに「Claude で直す」。ローカルの補完はこれまでどおり即時に出ます |

## Claude 版 (API キー不要)

[https://claude.ai/artifact/A8AyqZNprnumvcP85pG6mJ](https://claude.ai/artifact/A8AyqZNprnumvcP85pG6mJ) は、claude.ai 上で動く ForgeCode です。

- 開いた人の **claude.ai アカウント**で Claude が動きます。API キーは要らず、料金もかかりません (Claude の利用枠を使います)。最初の 1 回だけ、Claude を使ってよいかの確認が出ます。
- 中身は GitHub Pages 版と同じアプリです (`node tools/build-artifact.mjs <出力フォルダ>` で公開用ファイルを作ります)。claude.ai の制限 (ダウンロード・eval・ワーカーなど) に合わせて自動で動き方を切り替えます: ダウンロードは claude.ai の保存確認を通し、eval が使えない場合は構文木を直接実行するエンジン (`js/luau/interp.js`) で実行します。
- 保存場所は GitHub Pages 版と別です。プロジェクトは **ZIP で保存 → ZIP を読み込む** で移せます。
- GitHub Pages 版でも、設定で Anthropic の API キーを入れれば同じ Claude 機能を使えます (従量課金)。

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
| ⌘/Ctrl + Enter, F5 | 実行 (デバッガーで止まっているときは F5 で続行) |
| F9 | ブレークポイントの切り替え |
| F10 / F11 / Shift + F11 | ステップオーバー / ステップイン / ステップアウト |
| Shift + F5 | 停止 |
| F12 / Shift + F12 | 定義へ移動 / 参照を検索 |
| F2 | 名前を変更 (すべての場所) |
| ⌘/Ctrl + . | この行のエラーを修正 |
| ⌘/Ctrl + P | ファイルを開く (`>` でコマンド、`:` で行、`@` で関数へ移動) |
| ⌘/Ctrl + Shift + P | コマンドパレット |
| ⌘/Ctrl + F / Shift + F | 検索・置換 / 全ファイル検索 |
| ⌘/Ctrl + / | コメント切り替え |
| ⌘/Ctrl + D | 同じ単語を追加選択 (マルチカーソル) |
| Alt + ↑ / ↓ | 行を移動 |
| Shift + Alt + ↓ | 行を複製 |
| Shift + Alt + F | 整形 |
| ⌘/Ctrl + B / J | サイドバー / パネルの表示切り替え |
| Tab / ⌘/Ctrl + → | インライン候補を確定 / 1 単語だけ確定 |

## 実行環境について

ForgeCode には JavaScript で書かれた Luau 互換のエンジンが入っていて、ブラウザ内でそのまま実行できます。

- **Luau の文法**: 型注釈、`+=` などの複合代入、`continue`、補間文字列 `` `x = {x}` ``、if 式、汎用反復 (`for k, v in t do`) に対応。`getfenv` / `setfenv` (関数ごとの環境)、`string.pack` / `unpack` も使えます。
- **標準ライブラリ**: `string` (Lua パターン・`string.format` を含む) / `table` / `math` / `os` / `coroutine` / `task` / `utf8` / `bit32` / `buffer` / `debug`
- **Roblox API (模擬)**: `game`, `workspace`, `script`, `Instance.new`, すべてのクラスのプロパティ・メソッド・イベント、`Vector3`, `CFrame`, `Color3`, `UDim2`, `TweenInfo`, `Enum` などのデータ型。
  - `Players.PlayerAdded` / `CharacterAdded` は実行後に自動で発火するので、サーバースクリプトの動作確認ができます。
  - `RunService.Heartbeat`, `TweenService` (実際に時間をかけて補間), `DataStoreService` (メモリ上に保存), `HttpService:JSONEncode/JSONDecode`, `RemoteEvent` (同じ実行内でサーバー ⇄ クライアントがつながります), `require` (プロジェクト内のモジュール) などは実際に動きます。
  - サーバースクリプト (`.server.luau`) では、本物と同じく `Players.LocalPlayer` が nil になります。
  - ボタンなどのイベントに関数を接続していると、実行は終了せず「操作待ち」になります。「ゲーム」タブで操作でき、■ で終了します。
  - GUI は `AbsoluteSize` / `AbsolutePosition` / `TextBounds` / `AbsoluteContentSize` が実際の値になり、変化すると `GetPropertyChangedSignal` も発火します。`UserInputService.InputBegan/InputChanged/InputEnded`、`Mouse.X/Y`、`GetMouseLocation`、`IsMouseButtonPressed`、`TextBox:CaptureFocus` なども画面の操作と連動します。
  - `game:GetObjects` (Roblox のアセット) は読み込めないため、空の Model を返します (Rayfield のように UI をアセットから読み込むライブラリは表示できません)。
  - `workspace:Raycast` / `Spherecast` / `GetPartBoundsInBox` / `GetPartBoundsInRadius` / `GetPartsInPart` / `GetTouchingParts`、`Camera:WorldToViewportPoint` / `ViewportPointToRay`、`mouse.Hit` / `mouse.Target` は、パーツの位置・大きさとカメラから実際に計算します。
  - 物理演算・3D の描画・本物のサーバー通信は行いません。実装されていないメソッドは「模擬動作です」と表示して既定値を返します。
- **エグゼキューター API (模擬)**: 環境 (`getgenv`, `getrenv`, `getgc`, `filtergc` …)、クロージャ (`hookfunction`, `restorefunction`, `newcclosure` …)、メタテーブル (`hookmetamethod`, `getnamecallmethod`, `getrawmetatable`, `setreadonly` …)、シグナル (`getconnections`, `firesignal`, `hooksignal` …)、ファイル (`readfile` / `writefile` / `listfiles` … プロジェクトの `workspace/` フォルダに保存)、`request`, `game:HttpGet`, `crypt`, `Drawing` (ゲーム画面にリアルタイムで重ねて表示), `WebSocket`, `bit`, `cache`, `debug.*`, `syn.*` など。補完に出る関数はすべてサンドボックスにも存在します (`tests/executor.test.mjs` で確認)。
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
    debug.js                 デバッガー (ブレークポイント・ステップ実行・変数の表示・式の評価)
    gui.js                   GUI エンジン (レイアウト計算・入力の再現・画面への差分送信)
    remote.js                外部スクリプトの取得 (URL の正規化・キャッシュ・中継)
    spatial.js               レイキャスト・範囲内のパーツ・カメラの投影
    interp.js                構文木を直接実行するエンジン (eval が使えない環境用。コンパイル版と同じ結果)
  js/editor/                 エディタ機能
    luau-lang.js             色付けと字下げ
    blocks.js                ブロック構造の解析 (end の自動入力・過不足の診断・整形)
    autoend.js               入力・削除に合わせた end の自動挿入・自動削除
    symbols.js               スコープ解析 (定義・参照・名前の変更・ハイライト・スティッキースクロール)
    breakpoints.js           ブレークポイントと停止行の表示
    luau-index.js            文書の索引 (スコープ付きの宣言・ブロック・return・self のフィールド。大きなファイルは差分だけ解析)
    luau-intel.js            型の推論と補完 (期待される型・ローカル変数・文字列の引数)
    format.js / autoformat.js  整形 (空白・字下げ・空行) と、入力中の自動整形
    extlib.js                loadstring で読み込むライブラリのソース解析 (補完・ゴーストテキスト用)
    inline.js                インライン候補 (ゴーストテキスト)
    ai.js                    Claude による続きの提案 (手動 / 自動)
    lint.js / typo.js        エラーチェック・誤字検出・自動修正
    errorlens.js             行の右に出るエラー表示
  js/app/                    画面 (ファイル一覧・タブ・実行パネル・ゲーム画面・設定・初回案内など)
    gui-preview.js           ゲーム画面 (差分の描画・タップ / ドラッグ / キー入力・全画面)
    extlibs.js / remote-ui.js  ライブラリの裏読み込み、外部スクリプトの管理・UI ライブラリのギャラリー
    claude.js                Claude との接続 (claude.ai の sample 機能 = API キー不要 / API キー)
    agent.js                 Claude エージェントのツール (読む・探す・編集・作成・実行・チェック・API 検索・元に戻す)
    ai-panel.js / ai-actions.js  Claude パネル、エディタから頼む操作 (提案・修正・選択範囲の書き換え)
  js/workers/                実行用の Web Worker
  js/data/                   補完用の API データ (Luau・エグゼキューター・スニペット)
data/roblox-api.json         Roblox API ダンプ (変換済み)
vendor/                      同梱ライブラリ (CodeMirror 6, fflate, Anthropic SDK)。ライセンスは vendor/LICENSES.txt
sw.js                        オフライン用 Service Worker
tests/                       テスト
tools/                       ライブラリと API データを作り直すスクリプト
```

- テスト: `for f in tests/*.test.mjs; do node "$f" || break; done`
  - eval を使わないエンジンでも確認: `node --import ./tests/force-interp.mjs tests/luau-basic.test.mjs` (roblox / executor / gui / debug / extlib も同様)
  - `agent` (Claude エージェントの置き換え・差分・API 検索) / `luau-basic` (言語) / `roblox` (Roblox 模擬) / `executor` (エグゼキューター API の網羅) / `gui` (GUI のレイアウト・入力・描画データ) / `extlib` (ライブラリの解析と補完) / `intel` (型推論と補完の候補) / `format` (整形) / `indent` (字下げ・end) / `lint` (エラーチェック・誤字) / `inline` (インライン候補) / `autoend` / `debug` / `symbols`
- Roblox API データの更新: `node tools/build-roblox-api.mjs` (最新の API ダンプを取得して `data/roblox-api.json` を作り直します)
- ライブラリの作り直し: `cd tools && npm install && npm run vendor`
- Claude 版の公開用ファイル: `node tools/build-artifact.mjs <出力フォルダ>` (中の `files.json` が公開するファイルの一覧)
- ファイルを変更したら `node tools/build-sw.mjs` で Service Worker のキャッシュ一覧を更新してください (更新しないと古いキャッシュが使われることがあります)。

Roblox は Roblox Corporation の商標です。ForgeCode は Roblox Corporation とは関係ありません。
