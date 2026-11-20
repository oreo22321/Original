# ForgeCode — スマホ・iPad で使える Python エディタ

ForgeCode は、iPhone・iPad・PC のブラウザで動く Python エディタです。インストールは要りません。
本物の Python (CPython 3.14 を WebAssembly にした [Pyodide](https://pyodide.org/)) が端末の中で動くので、書いたコードをその場で実行できます。コードはサーバーに送りません。

- **書く**: 補完 (jedi。numpy・pandas などライブラリの中身も)・自動で import・引数のヒント・説明・エラーチェック (pyflakes + 実行前のチェック)・ワンタップの修正・整形 (autopep8)・打ち間違いの自動修正
- **動かす**: 全画面の実行画面で `print` / `input()` / ■ で停止 / いくつものファイルの `import` / ファイルの読み書き / matplotlib のグラフとアニメーション (1 枚でなめらかに) / pygame のゲーム / tkinter のウィンドウ / turtle / asyncio / PyPI のライブラリ (自動でインストール)
- **調べる**: ブレークポイント・ステップ実行・変数とウォッチ・コンソール
- **ターミナル**: `ls`・`cd`・`cat`・`grep`・`mkdir`・`cp`・`mv`・`rm` などでファイルを扱い、`python main.py 引数`・`python` (対話モード)・`pip install` が使えます (パイプ・リダイレクト・Tab の補完・色付きの出力)
- **24 時間動かす**: 実行中は画面を消さない・エラーで止まったら自動で再実行・何時間でも止まらない出力・Python の見守り
- **頼む**: 内蔵の AI (Forge AI) が、直す・説明する・コメントや型ヒントを付ける・コードを作る・質問に答える。端末内の AI モデルをダウンロードすると、エラー検知・実行エラーの修正・続きの提案も AI が行います
- **見やすい**: VS Code と同じ配色 (Dark Modern / Light Modern) で、変数・関数・クラス・モジュール・定数を色分け

## できること

### エディタ

- **補完**: 変数・関数・クラス・モジュールの中身 (`math.`・`"abc".`・自分のクラスのメソッド・ほかのファイルの関数) を、型を推論して候補に出します (jedi)。
- **引数のヒント・説明**: `(` の中で引数を表示。名前を長押し (PC はマウスを乗せる) で docstring を表示します。
- **ライブラリの補完**: `import` した numpy・pandas・PyPI のライブラリも、中身 (`np.arange`・`df.groupby` など) を候補に出します (ライブラリの .py / .pyi だけを取り出して使うので軽い)。
- **自動で import**: まだ import していない `random` や `sqrt` も候補に出て、選ぶとファイルの先頭に `import random` / `from math import sqrt` を足します。
- **エラーチェック**: 構文エラーと、定義されていない名前・使っていない import などを、書いている間に日本語で表示します (pyflakes)。「もしかして `print`?」のように近い名前も提案します。
- **実行前のチェック**: 実行しなくても分かる間違いを教えます — `input()` の結果 (文字列) を数として使っている (`age + 1`・`age > 18`)、`math.squareroot` のようにモジュールにない名前、`import ramdom`、引数の数や名前の間違い (自分の関数・クラス・組み込み・標準ライブラリ)、`nums.push()` `name.uppercase()` のようなないメソッド、`x = nums.sort()` (None になる)、結果を使っていない `s.upper()`。多くはワンタップで直せます。
- **ワンタップの修正**: `:` の付け忘れ・import 忘れ・字下げ・全角記号・打ち間違い・`is` と `==` など。行の右の説明をタップ (PC は ⌘/Ctrl + .) すると直し方を選べます。
- **自動修正**: 全角の `（）：＝”` や全角スペース、iPhone が変える `“ ”`、`pirnt` → `print` のような打ち間違いを、入力した時点で直します (文字列とコメントの中はそのまま。設定でオフにできます)。
- **整形**: PEP 8 に合わせて空白・字下げ・空行をそろえます (Shift + Alt + F、保存時に整形も可)。
- **定義へ移動・参照を検索・名前の変更**: ほかのファイルもまとめて扱います (F12 / Shift + F12 / F2)。
- **色分け**: VS Code の Dark Modern / Light Modern (と Dark+ / Light+) と同じ色。Python 拡張 (Pylance) と同じように、変数・関数・クラス・モジュール・定数・属性・組み込みを見分けて色を付け、括弧も深さで色分けします。AI の答えやコンソールのコードも同じ色です。
- **その他**: アウトライン、スティッキースクロール、同じ単語の強調、マルチカーソル、全ファイル検索・置換、ファイルの履歴、ZIP の読み込み・保存、GitHub と同期。

### 実行

- ▶ で実行すると、画面全体が実行画面になります (左上の「‹ 戻る」、スマホは左端からスワイプ、PC は Esc でコードへ。設定で下のパネルに出すこともできます)。エラーには日本語の原因と直し方が付き、`ファイル名:行` をタップするとその行へ移動します。
- **input()**: 入力を待つと、出力の下に入力欄が出ます。
- **停止**: ■ でいつでも止められます (`KeyboardInterrupt`)。設定 → 実行 で最大実行時間も決められます。
- **いくつものファイル**: 同じプロジェクトの `.py` は `import` できます。`open("data.csv")` でプロジェクトのファイルを読め、プログラムが書いたファイルはファイル一覧に入ります。
- **ライブラリ**: 標準ライブラリはほぼすべて (オフラインでも)。numpy・pandas・matplotlib・scipy・sympy・scikit-learn・pillow・beautifulsoup4・requests など Pyodide が用意しているものは `import` するだけで使えます (はじめて使うときだけインターネットから読み込み、あとは端末に保存)。`plt.show()` の図は出力に表示されます。`plt.pause()`・`FuncAnimation`・`plt.ion()`・ループの中の `plt.show()` は、画像を何枚も並べず 1 枚の図を同じ場所で描き直します (Agg の画素をそのまま送るので速く、画面の速さに合わせて動きます)。
- **PyPI のライブラリ**: Pyodide にないものも、`import` すると PyPI から自動で入ります (micropip。pure Python のもの)。`requirements.txt` があれば実行の前にまとめて入れます。コンソールでは `pip install 名前`・`pip list`・`pip show`・`pip uninstall` が使えます。
- **turtle**: タートルグラフィックスを出力のキャンバスに描きます (本物と同じ速さのアニメーション・塗りつぶし・文字・スタンプ・形)。`onkey` / `onkeypress` / `onclick` / `ontimer` / `mainloop` でゲームも作れ、スマホでは使うキーのボタンが出ます。描いた絵は画像で保存できます。
- **asyncio**: `asyncio.run()`・`gather`・`get_event_loop().run_until_complete()` が動きます (ブラウザの特別な仕組みがなくても)。コンソールでは `await` をそのまま書けます。
- **スレッド・プロセス**: `threading`・`concurrent.futures`・`multiprocessing` は、同時には動かせないため順番に実行します (結果は同じ)。
- **time.sleep**: 待つ前に出力をすぐ表示し、待っている途中でも ■ で止まります。
- **インターネット**: `urllib.request`・`requests` で読み込めます (相手が CORS を許可しているとき)。`webbrowser.open()` は出力にリンクを出します。
- **表示**: `display(df)` で pandas の表を表として、PIL の `img.show()` で画像を表示します。`getpass.getpass()` は伏せ字の入力欄になります。
- **コンソール**: 出力の一番下の欄で、式やコードをその場で試せます。実行が終わった後の変数も使えます。pandas の表は表で表示します。
- **pygame**: ゲームの画面を出力に表示します (互換版。`display`・`draw`・`event`・`key`・`mouse`・`time`・`font`・`image`・`transform`・`mixer`・`math`・`sprite`・`mask`・`Rect`・`Color`)。描画はワーカーの中のキャンバス (OffscreenCanvas) で行い、1 枚の画像にして送るので 60 fps で動きます。キーボード・タップで操作でき、スマホではプログラムが使うキーのボタンが出ます。
- **tkinter**: ウィンドウを出力の中に表示します (互換版。`Label`・`Button`・`Entry`・`Text`・`Checkbutton`・`Radiobutton`・`Scale`・`Listbox`・`Spinbox`・`Canvas`・`Menu`・`ttk` (`Combobox`・`Notebook`・`Treeview`・`Progressbar` など)・`pack` / `grid` / `place`・`StringVar` など・`after`・`bind`・`messagebox`・`simpledialog`・`filedialog`・`colorchooser`・`PhotoImage`)。
- **音**: `pygame.mixer`・`winsound`・`playsound` は Web Audio で鳴らします。
- 使えないもの: `subprocess`、本当に同時に動くスレッド、`socket` での直接の通信、パソコンの操作、PyQt などほかの GUI。

### ターミナル

- 上のバーの **>_** (PC・タブレットは下のパネルの「ターミナル」タブ) か **Ctrl + \`** で開きます。スマホでは全画面で開き、左上の「‹ 戻る」で戻ります。ファイル一覧の「…」→「ターミナルで開く / ターミナルで実行」からも。
- **ファイルの操作**: `ls` `cd` `pwd` `tree` `cat` `head` `tail` `touch` `mkdir` `cp` `mv` `rm` `rmdir` `find` `grep` `wc` `sort` `uniq` `cut` `tr` `sed` `tee` `diff` `du` `df` `stat` など。`~` と `/` はプロジェクトの一番上で、作ったファイルはすぐファイル一覧に出ます。
- **Python**: `python ファイル.py 引数` (`sys.argv`・`input()` に対応、図やゲームは実行画面に)、`python` (対話モード `>>>`。複数行・Tab で名前の補完・`exit()`)、`python -c "コード"`、`python -m モジュール`、`python -i ファイル.py`、`pip install 名前` / `pip install -r requirements.txt` / `pip list`。
- **シェルの書き方**: パイプ `|`、リダイレクト `>` `>>` `<` `2>` `2>&1`、`&&` `||` `;`、`"…"` `'…'`、`$変数`・`$(コマンド)`、`*` `?` `[…]`、`alias`・`export`。例: `python main.py | grep 合計 > result.txt`
- **操作**: Tab で補完、↑↓ で履歴、Ctrl+C で止める、Ctrl+L で画面を消す、Ctrl+D で入力の終わり。貼り付けた複数行は順に実行します。スマホでは画面の下に Tab・^C・矢印・記号のボタンが出ます。
- 色 (ANSI) と `\r` での書き換え (進み具合の表示) に対応 (色は VS Code のターミナルと同じ)。閉じても、次に開いたときに続きから始まります。
- そのほか: `curl` / `wget` (相手が CORS を許可しているとき)、`date` `sleep` `time` `seq` `printf` `echo -e` `uptime` `free` `ps` `kill` `open` (エディタで開く)・`git push` / `git pull` (GitHub と同期)・`help`。

### 24 時間動かす

- **画面を消さない**: 実行中は画面が自動で消えないようにします (Screen Wake Lock。設定で「いつも」「使わない」も選べます)。
- **ずっと動かす**: 設定 (または実行画面の「…」) で「エラーで止まったら自動で再実行」をオンにすると、止まったプログラムを 3 秒後に実行し直します (すぐ止まるのが続くと最大 60 秒まで間を延ばします)。実行画面に続けて動いている時間と再実行の回数、下のバーに経過時間を出します。
- **止まらない出力**: 行数の上限をなくし、とても多いときだけ省いて知らせます (最後の 100 行は残します)。画面に残すのは新しい 3000 行 (ターミナルは 4000 行) なので、何時間動かしてもメモリが増え続けません。
- **見守り**: 長い間アプリが裏にあった後は Python が応えるか確かめて、応えなければ立ち上げ直します。何も動いていないまま 20 分以上裏にあると、Python を休ませてメモリを空けます (iPhone などはメモリを多く使うページから閉じるため)。データを自動で消されないよう、ブラウザにも頼みます。
- アプリが裏に回っている間や画面が消えている間は、端末 (特に iPhone・iPad) がプログラムを止めることがあります。

### デバッガー

- 行番号の左をタップするとブレークポイント (F9)。▶ で実行すると、その行の手前で止まります。コードに `breakpoint()` と書いても止まります。
- 止まっている間は、変数 (リスト・辞書・オブジェクトはタップで中身を開ける)・呼び出し履歴・ウォッチ式を確認できます。
- ステップ (F10)・中へ (F11)・外へ (Shift + F11)・続行 (F5)・実行中の一時停止。
- 赤い点を長押しすると、条件付きブレークポイント (`i == 10` のときだけ止まる) やログポイント (止めずに `{変数}` の値を出力) にできます。
- 止まっている場所の変数で、コンソールから式を評価できます。
- しくみ: Python 3.12 からの `sys.monitoring` を使う `bdb` (`backend="monitoring"`) で、ブレークポイントがあっても速く動きます。画面との受け渡しは SharedArrayBuffer で行います。

## Forge AI (内蔵 AI)

アプリに入っている AI です。インターネットも API キーも要らず、コードを外に送りません。

- **直す**: 「直して」— 構文エラー (`:` 忘れ・字下げ・括弧・閉じていない文字列・全角記号・他の言語の書き方)、打ち間違い、import 忘れ、`== None`・何でも受ける `except:`・変更できる既定値 (`def f(x=[])`) などのよくあるバグ。実行エラーの「AI で直す」からも。
- **整える**: 「整形して」「整理して」(`"a" + name` → f-string など新しい書き方に)、「最適化して」。
- **説明する**: 「説明して」でファイルの概要と流れを日本語で。範囲を選ぶと 1 行ずつ。「コメントを追加して」「型ヒントを付けて」(既定値と return から推測)。
- **確かめる**: 「レビューして」— バグになりそうなところ・遅くなる書き方・読みやすさを指摘し、自動で直せるものは「直して」で直します。
- **作る**: 「数当てゲームを作って」「CSV を読んでグラフにして」「1 から 100 まで足すプログラム」など。「10 回にして」のような手直しもできます。
- **答える**: 「リストと辞書の違いは?」「for 文の使い方」「enumerate とは」「TypeError って何?」に、例のコード付きで答えます。
- **続きの提案**: 入力が止まると、プロジェクトと内蔵サンプルから学んだ続きを薄い文字で出します (Tab で確定)。`# 1 から 10 まで表示する` のようなコメントの次の行で AI キー (Alt + \\) を押すと、コードを組み立てます。
- **高性能モード (任意)**: 設定 → AI で端末内の言語モデル (Qwen2.5-Coder 0.5B / 1.5B / 3B / 7B、WebGPU) を使うと、決まった型に当てはまらない依頼にも答えます。作ったコードは構文・未定義の名前を確かめて AI 自身に直させ、動かせるものは試しに実行してから表示します。
- **AI に任せる (高性能モードのとき)**: 書くのが止まると AI がファイルを読んでバグを探し、波線 (AI) で知らせます (直し方は構文と名前を確かめてから)。実行エラーには、エラーの行のまわりを AI が直した案 (差分・説明・「直して実行」) を出します。続きの提案も、前後のコードを見て AI が書きます (FIM)。モデルは順番待ちで動き、チャット > 実行エラー > 続き > 裏のチェック の順に優先します。
- AI が変えたファイルは「差分」で確認でき、「すべて元に戻す」で取り消せます。

しくみ: ことばの理解 (日本語の正規化・意図・概念) → 処理の選択 → Python の解析 (pytools ワーカーの ast / pyflakes / jedi / autopep8) で直し方を決め、結果を必ず構文チェックしてから書き込みます。

## はじめかた (GitHub Pages で無料公開)

1. GitHub のリポジトリ画面で **Settings → Pages** を開きます。
2. **Source** を「Deploy from a branch」、**Branch** を `main` / `/(root)` にして **Save** を押します。
3. 1〜2 分待つと、`https://<ユーザー名>.github.io/<リポジトリ名>/` (このリポジトリなら `https://oreo22321.github.io/Original/`) で使えるようになります。

ビルド作業は不要です。ファイルをそのまま置くだけで動きます (サーバーは要りません)。
`input()`・■ での停止・デバッガーに必要なヘッダー (cross-origin isolation) は、GitHub Pages では付けられないため、Service Worker (`sw.js`) が付けます。はじめて開いたときに 1 回だけ自動で再読み込みされます。

既に開いたことがある端末では、起動時に「新しいバージョンがあります」と出たら **更新** を押すと最新版になります (設定 → 情報 → アプリを最新版に更新 でも可)。

### iPhone / iPad でアプリのように使う

1. Safari で上の URL を開きます。
2. 共有ボタン (□↑) → **ホーム画面に追加** を選びます。
3. ホーム画面のアイコンから開くと、全画面で使えます。一度開けばオフラインでも動きます (追加のライブラリは、一度使ったものだけ)。

### 自分のパソコンで試す

このフォルダで `node tools/serve.mjs` を実行し、ブラウザで `http://localhost:8080` を開きます (必要なヘッダーを付けて配信します)。
ファイルを直接ダブルクリックで開くと動きません。

## 使い方

- 左上の **☰** (iPad / PC では左端のアイコン) でファイル一覧を開き、ファイルをタップして開きます。
- **▶** で実行します。ファイルを長押し → **▶ で常にこのファイルを実行** を選ぶと、別のファイル (モジュールなど) を編集中でも、そのファイルを実行します。範囲を選んで「選択範囲を実行」もできます。
- ファイルやタブを **長押し** (PC は右クリック) すると、名前の変更・削除・複製・共有などのメニューが出ます。
- 画面下の **Python 3.14** をタップすると、Python の再起動や使えるライブラリの一覧があります。
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

## GitHub と同期 (自動バックアップ)

設定 → GitHub と同期 で、プロジェクトを GitHub のリポジトリに自動で保存できます。

1. GitHub で保存用のリポジトリを作る (非公開でも可)
2. Settings → Developer settings → Fine-grained tokens で、そのリポジトリだけ・Contents を「Read and write」にしたトークンを作る
3. ForgeCode にトークンとリポジトリ名を入れて「保存して確認」

- 保存すると少し後に、1 回につき 1 コミットで保存します。プロジェクトを開いたとき・アプリに戻ったときに GitHub 側の変更を取り込みます
- 同じファイルを両方で変更していたら「衝突」として知らせ、どちらを残すか選べます (残さなかった方はこの端末の履歴から戻せます)
- 「GitHub から開く」で、別の端末で作ったプロジェクトを開けます
- トークンはこの端末にだけ保存します

## データの保存場所

ファイルはブラウザ内 (IndexedDB) に保存されます。保存が終わる前の内容は下書きとして別に残るので、アプリが突然閉じられても次に開いたときに復元されます。
ブラウザのデータを消去すると消えるため、大切なものは **設定 → データ → すべてのプロジェクトを ZIP で保存** でバックアップしてください。
iPhone / iPad では、ホーム画面に追加して使うとデータが消えにくくなります。

以前のバージョン (Luau 版) で作ったプロジェクトもそのまま残り、ファイルの編集・保存・ZIP での書き出しができます (実行はできません)。

## 開発者向け

```
index.html, boot.js          入口 (boot.js が dist/app/main.js を読みます。index.html?src で開くと js/ のソースのまま動きます)
dist/                        配信用にまとめて圧縮したファイル (node tools/build.mjs で作ります。直接編集しない)
css/, js/                    アプリ本体のソース (ES モジュール)
  js/editor/                 エディタ機能
    setup.js                 CodeMirror の組み立て (言語・テーマ・設定ごとの機能)
    python.js                Python の補完・引数のヒント・説明・エラーチェックと直し方・整形・定義へ移動・自動修正
    pyfix.js                 全角記号・打ち間違い・似た名前 (エディタと AI で共通)
    sticky.js                スティッキースクロール (字下げからブロックを判定)
    breakpoints.js           ブレークポイントと停止行の表示
    ghost.js / ai.js         インライン候補 (ゴーストテキスト) と AI による続きの提案
    errorlens.js             行の右に出るエラー表示
    themes.js                テーマ (VS Code の Dark Modern / Light Modern と同じ色)・エディタの外のコードの色付け
    semantic.js              意味による色分け (変数・関数・クラス・モジュール・定数。Pylance と同じ考え方)
  js/app/                    画面 (ファイル一覧・タブ・実行パネル・デバッグ・設定・初回案内など)
    runner.js                実行 (Python ワーカーとの受け渡し・input()・停止・図・表・リンク・コンソール・自動の再実行)・ターミナルの表示
    terminal.js              ターミナルの画面 (入力・履歴・Tab の補完・Python の対話モード・実行の出力と input())
    shell.js                 ターミナルのシェル (字句・構文・展開・パイプ・リダイレクト・コマンド)。画面から切り離してあり、Node でテストできます
    ansi.js                  ANSI の色 (VS Code のターミナルと同じ色) を画面の飾りに
    keep-alive.js            24 時間動かすための見張り (画面を消さない・Python の見守りと休ませる・データを消えにくく)
    help.js                  使い方・新しくなったところ (開いたときに読み込む)
    turtle-view.js           turtle の画面 (キャンバスに描く・アニメーション・キー操作とタップを Python へ)
    surface.js               図・ゲームの画面 (1 枚のキャンバスで描き直す)・画像の読み込み・プログラムのダイアログ・音
    tk-view.js               tkinter のウィンドウ (ウィジェット・pack / grid / place・キャンバス・操作を Python へ)
    ai-assist.js             端末内 AI に任せる仕事 (エラー検知の波線・実行エラーの直し方・続きの提案・起動後の読み込み)
    debug-panel.js           デバッガーの画面 (変数・ウォッチ・呼び出し履歴・ブレークポイント)
    code-nav.js              定義へ移動・参照・名前の変更
    explain.js               実行エラーの日本語の説明
    ai-host.js               Forge AI とアプリの窓口 (ファイルの読み書き・実行・Python の解析・変更の記録)
    agent.js                 AI がファイルを扱う部品 (書き込み・差分・変更の取り消し)
    ai-panel.js / ai-actions.js  AI パネル、エディタから頼む操作 (提案・修正・選択範囲)
    github-core.js / github-sync.js  GitHub との同期 (Git Data API・3 者比較・衝突) と、その画面
    i18n.js / i18n-en.js     表示の言語 (英語の辞書)
  js/ai/                     Forge AI (内蔵 AI)
    text.js                  ことばの理解 (正規化・意図・概念・値の取り出し・BM25)
    knowledge.js             知識ベース (Python・ライブラリ・エラー・アプリの使い方)
    pycode.js                Python のコードの小さな道具 (位置・編集・字句)
    repair.js                構文の自動修復・打ち間違いと import 忘れの修正・新しい書き方・整形
    review.js                コードレビュー (バグ・性能・読みやすさ)
    describe.js              日本語での説明・コメント・型ヒント
    generate.js              コード生成 (レシピ)
    complete.js              続きの提案 (n-gram)・コメントからコード
    engine.js                依頼の振り分けと返事の組み立て
    llm.js                   高性能モード (端末内 LLM・WebLLM)・優先度つきの順番待ち・FIM の続き
    assist.js                AI のエラー検知・実行エラーの修正・続きの提案・作ったコードの見直し (答えは必ず確かめる)
  js/workers/                Web Worker
    python-worker.js         実行用の Python (Pyodide)・デバッガー (bdb + sys.monitoring)・PyPI からのインストール (micropip)
    py-runtime.js            ふつうの Python との違いを埋める道具 (time.sleep・スレッド・asyncio・urllib・display・multiprocessing・webbrowser)
    py-turtle.js             ブラウザ用の turtle (描く命令を画面へ送る・キー操作やタイマーを受け取る)
    py-pygame.js / pg-canvas.js  pygame の互換版 (Python 側) と、ワーカーの中のキャンバスで描く部分
    py-tkinter.js            tkinter の互換版 (ウィジェットの木・命令を画面へ送る・操作を受け取る)
    py-lib.js                Python に置く道具のまとめ (実行用と補完用で同じもの)
    py-packages.js           import 名と PyPI の名前の対応・ブラウザでは使えないもの
    pytools-worker.js        エディタ用の Python (jedi・pyflakes・autopep8)。ライブラリの .py / .pyi を取り出して補完に使う・import の候補
    py-check.js              実行前のチェック (モジュールにない名前・引数の数・input() と数・ないメソッド など)
    py-analysis.js           ast による解析 (説明・レビュー・型ヒント用。pytools ワーカーで動きます)
    llm-worker.js            端末内 LLM
vendor/                      同梱ライブラリ (CodeMirror 6, fflate, WebLLM, Pyodide, jedi などの wheel)。ライセンスは vendor/LICENSES.txt
sw.js                        オフライン用 Service Worker (cross-origin isolation のヘッダーも付けます)
tests/                       テスト
tools/                       ビルド・ローカルサーバー・ライブラリを作り直すスクリプト
```

- テスト: `node tests/run-all.mjs` (すべてのユニットテスト。Python のワーカーも Node の中で動かします)
  - `shell` (ターミナルのシェル) / `python` (実行・ターミナルの対話モード) / `runtime` (asyncio・スレッド・turtle・urllib など。`NET=1` で PyPI からのインストールも) / `pydebug` (デバッガー) / `pytools` (補完・チェック・整形・参照・名前の変更) / `ai` (Forge AI) / `github` (GitHub 同期。偽の GitHub `tests/mock-github.mjs` を相手に)
  - ブラウザでの通し確認: `node tests/e2e/run.mjs` (`cd tools && npm ci && npx playwright install chromium` が必要)
  - GitHub Actions (`.github/workflows/test.yml`) が、main へのプッシュとプルリクエストのたびに、ユニットテスト・配信用ファイルが最新か・ブラウザでの通し確認を行います
- **ファイルを変更したら `node tools/build.mjs`** を実行してください (dist/ のまとめ直し・index.html の先読み・Service Worker のキャッシュ一覧を更新します。CI は dist/ が最新でないと失敗します)
- 開発中は `node tools/serve.mjs` で配信し、`http://localhost:8080/?src` で開くと、まとめ直さずにソースのまま確認できます
- ライブラリの作り直し: `cd tools && npm install && npm run vendor` (端末内 LLM は `node vendor-webllm.mjs`。更新したら `js/ai/llm.js` の wasm のハッシュも更新)
