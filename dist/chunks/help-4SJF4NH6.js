import{a as c,g as l}from"./chunk-3B4WXQCL.js";function t(e){let d=c("div",{class:"help"});d.innerHTML=`
  <h3 id="help-start">はじめかた</h3>
  <ol>
    <li>左上の <b>☰</b> (iPad / PC では左端のアイコン) でファイル一覧を開き、<code>main.py</code> などのファイルをタップして開きます。</li>
    <li>コードを書くと自動で保存されます。保存の状態は画面下のバーに表示されます。</li>
    <li><b>▶</b> を押すと実行します。画面全体が実行画面になり、<code>print</code> の結果・エラー・グラフ・ゲームの画面が表示されます。左上の <b>‹ 戻る</b> (スマホは左端から右へスワイプ、PC は Esc) でコードに戻れます。</li>
  </ol>
  <h3 id="help-run">実行 (Python 3.14)</h3>
  <ul>
    <li>本物の Python (CPython 3.14 を WebAssembly にした Pyodide) が、端末の中で動きます。サーバーには送りません。</li>
    <li><b>input()</b>: 入力を待つと、出力の下に入力欄が出ます。Enter で送ります。「終わり」で入力の終わり (EOF) を送ります。</li>
    <li><b>■</b> でいつでも止められます (<code>KeyboardInterrupt</code> になります)。無限ループも止まります。設定 → 実行 → 最大実行時間 で、自動で止める時間も決められます。</li>
    <li><b>いくつものファイル</b>: 同じプロジェクトの <code>.py</code> は <code>import</code> できます (フォルダは <code>__init__.py</code> を置くとパッケージに)。</li>
    <li><b>ファイルの読み書き</b>: <code>open("data.csv")</code> でプロジェクトのファイルを読めます。プログラムが書いたファイルは、終わったあとファイル一覧に入ります。</li>
    <li><b>グラフ・アニメーション</b>: matplotlib の <code>plt.show()</code> で図が出ます。<code>plt.pause()</code>・<code>FuncAnimation</code>・<code>plt.ion()</code>・ループの中の <code>plt.show()</code> は、同じ 1 枚の図がなめらかに動きます (動いている図は画面の上に留まります)。</li>
    <li><b>実行画面</b>: 実行中は上に「停止」、終わると「もう一度」。設定 → 実行 → 実行結果の表示 で、全画面ではなく下のパネルに出すこともできます。実行中にコードへ戻ったときは、右下のボタンで実行画面に戻れます。</li>
    <li>ファイルを長押し → <b>▶ で常にこのファイルを実行</b> を選ぶと、別のファイルを編集中でもそのファイルを実行します。範囲を選んで「選択範囲を実行」もできます。</li>
  </ul>
  <h3 id="help-notebook">ノートブック</h3>
  <ul>
    <li>「その他」→「新しいノートブック」、または <code>.ipynb</code> のファイルを開きます。Jupyter・VS Code・Google Colab のノートブックも開けます。</li>
    <li>セルに Python を書いて <b>▶</b> か <kbd>Shift + Enter</kbd> (実行して次へ)・<kbd>Ctrl/⌘ + Enter</kbd> (その場で実行)・<kbd>Alt + Enter</kbd> (実行して下に追加)。</li>
    <li>変数はセルをまたいで残ります。「…」→「カーネルを再起動」で消せます。最後の式の値・<code>print</code>・表 (pandas)・図 (matplotlib)・エラーを、セルの下に出します。</li>
    <li>Markdown のセルは見出し・文章のメモに。ダブルタップで書き直せます。「…」→「Python のファイルに書き出す」で <code>.py</code> にもできます。</li>
  </ul>
  <h3 id="help-web">Web アプリ・Web ページ</h3>
  <ul>
    <li><b>Python の Web アプリ</b>: Flask (<code>app.run()</code>)・FastAPI (<code>uvicorn.run(app)</code>)・Bottle・<code>wsgiref</code>・<code>http.server</code> を ▶ で実行すると、ポートを開く代わりに<b>アプリの中のブラウザ (プレビュー)</b> で動きます。リンク・フォーム・<code>fetch</code> もそのまま届き、通信の記録は出力に出ます。</li>
    <li><b>HTML・CSS・JavaScript</b>: <code>.html</code> を開いて ▶ (または上の地球のアイコン) で表示します。<code>console.log</code> とエラーは、プレビューの「コンソール」に出ます。</li>
    <li>ターミナルでは <code>flask run</code>・<code>python -m http.server</code>・<code>preview ファイル.html</code>。Flask は初回だけインターネットから読み込みます。</li>
  </ul>
  <h3 id="help-tests">テスト</h3>
  <ul>
    <li><code>test_</code> で始まるファイル (例: <code>test_main.py</code>) に、<code>test</code> で始まる関数を書きます: <code>def test_add(): assert add(1, 2) == 3</code></li>
    <li>左の<b>テスト</b>で ▶ (すべて・ファイルごと・1 つだけ)。✓ ✗ と時間、失敗した行と値 (<code>assert 4 == 5</code>) を出し、タップでその行へ移動します。ファイルを開いて「… のテストを作る」でひな形も作れます。</li>
    <li>pytest と同じ書き方: フィクスチャ (<code>tmp_path</code>・<code>capsys</code>・<code>monkeypatch</code>・<code>@pytest.fixture</code>)・<code>@pytest.mark.parametrize</code>・<code>skip</code>・<code>xfail</code>・<code>pytest.raises</code>・<code>pytest.approx</code>・<code>unittest.TestCase</code>。ターミナルでは <code>pytest -k 名前 -x -v</code>。</li>
  </ul>
  <h3 id="help-git">git (変更の記録)</h3>
  <ul>
    <li>左の<b>ソース管理</b>で「記録をはじめる」。変更したファイルが一覧に出るので、メッセージを書いて <b>コミット</b> します (ステージしていなければ、すべてをコミット)。</li>
    <li>ファイルをタップすると違い (差分)、履歴のコミットをタップすると中身。「この変更を取り消す (revert)」「ここからブランチ」「この時点に戻す」が使えます。ブランチの切り替え・作成・マージは上のブランチ名から。</li>
    <li>ターミナルでも同じ記録を <code>git</code> で使えます: <code>status</code>・<code>add</code>・<code>commit -m</code>・<code>log --oneline</code>・<code>diff</code>・<code>show</code>・<code>branch</code>・<code>switch -c</code>・<code>merge</code>・<code>restore</code>・<code>reset --hard</code>・<code>revert</code>・<code>cherry-pick</code>・<code>stash</code>・<code>tag</code>・<code>blame</code>。<code>.gitignore</code> も使えます。</li>
    <li>記録はこの端末に保存されます。<code>git push</code> / <code>git pull</code> は「GitHub と同期」につながり、最後のコミットのメッセージで保存します。</li>
  </ul>
  <h3 id="help-profile">時間を計って実行</h3>
  <ul>
    <li>「その他」→「時間を計って実行 (プロファイル)」。実行が終わると、時間のかかった<b>関数</b> (回数・その中だけの時間・合計) と<b>行</b> (回数・時間の目安) を表で出します。タップでその場所へ移動します。</li>
    <li>ターミナルでは <code>profile ファイル.py</code> か <code>python -m cProfile ファイル.py</code>。</li>
  </ul>
  <h3 id="help-terminal">ターミナル</h3>
  <ul>
    <li><b>開き方</b>: 上のバーの <b>&gt;_</b> (PC・タブレットは下のパネルの「ターミナル」タブ)、または <kbd>Ctrl + \`</kbd>。ファイル一覧の「…」→「ターミナルで開く」でも開けます。スマホでは画面いっぱいに開き、左上の「‹ 戻る」で戻ります。</li>
    <li><b>ファイル</b>: <code>ls</code>・<code>cd</code>・<code>pwd</code>・<code>tree</code>・<code>cat</code>・<code>head</code>・<code>tail</code>・<code>touch</code>・<code>mkdir</code>・<code>cp</code>・<code>mv</code>・<code>rm</code>・<code>find</code>・<code>grep</code>・<code>wc</code>・<code>diff</code> などが使えます。<code>~</code> と <code>/</code> はプロジェクトの一番上です。作ったファイルはすぐファイル一覧に出ます。</li>
    <li><b>Python</b>: <code>python main.py 引数</code> で実行 (<code>sys.argv</code> に引数が入り、<code>input()</code> もターミナルで答えます)。<code>python</code> だけで対話モード (<code>&gt;&gt;&gt;</code>)、<code>python -c "コード"</code>、<code>python -m モジュール</code>、<code>pip install 名前</code> も使えます。図やゲームの画面は実行画面に出ます。</li>
    <li><b>つなぐ</b>: パイプ (<code>|</code>)・リダイレクト (<code>&gt;</code> <code>&gt;&gt;</code> <code>&lt;</code>)・<code>&amp;&amp;</code> <code>||</code> <code>;</code>・<code>$変数</code>・<code>$(コマンド)</code>・<code>*.py</code> が使えます。例: <code>python main.py | grep 合計 &gt; result.txt</code></li>
    <li><b>操作</b>: <b>Tab</b> で補完、<b>↑↓</b> で前のコマンド、<b>Ctrl+C</b> で止める、<b>Ctrl+L</b> で画面を消す、<b>Ctrl+D</b> で入力の終わり。スマホでは画面の下のボタンで Tab・^C・矢印・記号を入力できます。<code>help</code> でコマンドの一覧を表示します。</li>
    <li><b>スクリプト</b>: <code>for f in *.py; do echo $f; done</code>・<code>while</code>・<code>if [ -f a.txt ]; then … fi</code>・関数 <code>名前() { … }</code>・<code>$((1 + 2))</code>・<code>read</code> が使えます。<code>sh run.sh</code> や <code>./run.sh</code> でシェルスクリプトも動きます。<code>do</code> や <code>then</code> の後で Enter を押すと、続きの行 (<code>&gt;</code>) を入力できます。</li>
    <li><b>便利に</b>: 前に打ったコマンドの続きが薄い文字で出たら <b>→</b> で確定。<kbd>Ctrl + R</kbd> で履歴を検索。上のメニュー (PC はパネルの <b>+</b>) から<b>ターミナルを増やせ</b>ます (別々の場所で作業できます)。<code>xargs</code>・<code>watch</code>・<code>zip</code>/<code>unzip</code>・<code>base64</code>・<code>sha256sum</code>・<code>file</code> も使えます。</li>
    <li>閉じても、次に開いたときに前の続き (いた場所・最後の画面) から始まります。</li>
    <li><b>データの加工</b>: <code>awk</code> (列ごとの処理・集計)・<code>jq</code> (JSON)・<code>sqlite3</code> (データベース)・<code>bc</code> (計算機)・<code>column -t</code>・<code>paste</code>・<code>comm</code>・<code>fold</code>・<code>tac</code>・<code>shuf</code>・<code>split</code>。</li>
    <li><b>ファイル</b>: <code>tar -czf</code> / <code>-xzf</code>・<code>gzip</code>・<code>gunzip</code>・<code>zcat</code>・<code>xxd</code>・<code>hexdump -C</code>・<code>od</code>・<code>md5sum</code>・<code>sha1sum</code>・<code>sha512sum</code>・<code>mktemp</code>・<code>truncate</code>・<code>cmp</code>。</li>
    <li><b>書き方</b>: <code>case $x in a*) … ;; esac</code>・ヒアドキュメント <code>cat &lt;&lt;EOF</code>・<code>&lt;&lt;&lt; "文字"</code>・<code>\${x:-既定}</code> <code>\${#x}</code> <code>\${x%.py}</code> <code>\${x/a/b}</code>・<code>{1..10}</code> <code>{a,b}</code>・<code>コマンド &amp;</code> と <code>jobs</code> / <code>fg</code> / <code>wait</code> / <code>kill %1</code>・<code>eval</code>・<code>timeout</code>。</li>
  </ul>
  <h3 id="help-always">24 時間動かす</h3>
  <ul>
    <li><b>クラウドで動かす (アプリを閉じても・電源を切っても)</b>: 「その他」→「クラウドで動かす」(ターミナルでは <code>cloud setup</code>) から、GitHub のサーバーでプログラムを動かせます。5 分ごと・1 時間ごと・毎日 決まった時刻 などを選べ、スマホの電源を切っていても動きます。プログラムが書いたファイル (記録・データ) は GitHub に保存され、次の実行はその続きから。「結果を取り込む」(<code>cloud pull</code>) でアプリに入り、<code>cloud log</code> で最後の出力を見られます。<br>使うには「GitHub と同期」を設定し、トークンに <b>Workflows</b> と <b>Actions</b> の「Read and write」を足してください。公開リポジトリは無料・使い放題、非公開リポジトリは無料で月 2,000 分までです。<code>input()</code> にはプロジェクトの <code>input.txt</code> の中身が入ります (画面のある turtle・pygame・tkinter はクラウドでは表示できません)。</li>
    <li><b>画面を消さない</b>: 実行中は画面が自動で消えないようにします (設定 → 24 時間動かす で「いつも」にもできます)。電源につないでおくと安心です。</li>
    <li><b>ずっと動かす</b>: 設定 (または実行画面の「…」) の「エラーで止まったら自動で再実行」をオンにすると、エラーで止まったプログラムを少し待って自動で実行し直します。実行画面の上に、続けて動いている時間と再実行の回数が出ます。</li>
    <li><b>止まらない出力</b>: 実行時間に上限はなく (最大実行時間が 0 のとき)、出力がとても多くても止まりません (古い出力から省きます)。</li>
    <li><b>見守り</b>: 長い間アプリが裏にあった後は Python が応えるか確かめ、応えなければ立ち上げ直します。何も動いていないまま 20 分以上裏にあると、Python を休ませてメモリを空けます (戻るとすぐ準備し直します)。</li>
    <li>アプリが裏に回っている間や画面が消えている間は、端末 (特に iPhone・iPad) がプログラムを止めることがあります。ずっと動かすときは、アプリを開いたままにしてください。</li>
  </ul>
  <h3 id="help-packages">使えるライブラリ</h3>
  <ul>
    <li><b>標準ライブラリ</b>: <code>random</code>・<code>math</code>・<code>datetime</code>・<code>json</code>・<code>csv</code>・<code>re</code>・<code>collections</code>・<code>itertools</code>・<code>pathlib</code>・<code>dataclasses</code> など、ほぼすべて使えます (オフラインでも)。</li>
    <li><b>追加のライブラリ</b>: <code>numpy</code>・<code>pandas</code>・<code>matplotlib</code>・<code>scipy</code>・<code>sympy</code>・<code>scikit-learn</code>・<code>pillow</code>・<code>beautifulsoup4</code>・<code>requests</code> など、Pyodide が用意しているものは <code>import</code> するだけで使えます。はじめて使うときだけインターネットから読み込み (数 MB〜)、あとは端末に保存されます。</li>
    <li><b>PyPI のライブラリ</b>: それ以外も、<code>import</code> すると PyPI から自動で入ります (pure Python のもの。例: <code>emoji</code>・<code>tabulate</code>・<code>faker</code>)。<code>requirements.txt</code> があれば、実行の前にまとめて入れます。コンソールで <code>pip install 名前</code>・<code>pip list</code> も使えます。</li>
    <li><b>turtle</b>: タートルグラフィックスは出力にキャンバスで表示されます。<code>onkey</code>・<code>onclick</code>・<code>ontimer</code> でゲームも作れます (スマホでは使うキーのボタンが出ます)。</li>
    <li><b>asyncio・スレッド</b>: <code>asyncio.run()</code> が使えます。<code>threading</code>・<code>concurrent.futures</code>・<code>multiprocessing</code> は同時には動かず、順番に実行されます (結果は同じになります)。</li>
    <li><b>インターネット</b>: <code>urllib.request</code>・<code>requests</code> で読み込めます (相手のサーバーがブラウザからの読み込みを許可している (CORS) とき)。<code>webbrowser.open()</code> は出力にリンクを出します。</li>
    <li><b>表示</b>: <code>display(df)</code> で pandas の表を見やすく、PIL の画像は <code>img.show()</code> で表示します。<code>plt.pause()</code> で動くグラフも描けます。</li>
    <li><b>tkinter</b>: ボタン・入力欄・リスト・キャンバスなどのウィンドウが出力の中に表示され、タップ・入力・キー操作が使えます (<code>pack</code>・<code>grid</code>・<code>place</code>・<code>after</code>・<code>bind</code>・<code>ttk</code>・<code>messagebox</code>・<code>simpledialog</code>・<code>filedialog</code> など)。</li>
    <li><b>pygame</b>: ゲームの画面が出力に出て、キーボード・タップで遊べます (スマホでは、プログラムが使うキーのボタンが出ます)。図形・文字・画像 (<code>pygame.image.load</code>)・スプライト・当たり判定・音 (<code>pygame.mixer</code>) に対応。</li>
    <li><b>音</b>: <code>pygame.mixer</code>・<code>winsound.Beep</code>・<code>playsound</code> で音が鳴ります。</li>
    <li><b>画像・Excel・データベースのファイル</b>: <code>plt.savefig("a.png")</code>・<code>img.save()</code>・<code>openpyxl</code> の <code>wb.save()</code>・<code>sqlite3</code> のデータベース・<code>pickle</code> など、プログラムが書いたバイナリのファイルもプロジェクトに入り、次の実行でも使えます。端末から読み込んだ写真なども <code>open("photo.jpg", "rb")</code> や PIL で読めます。ファイル一覧でタップすると画像はそのまま表示します。</li>
    <li><b>os.system・subprocess</b>: <code>os.system("cls")</code> / <code>clear</code> で画面を消し、<code>pause</code>・<code>echo</code>・<code>python ほかのファイル.py</code> (<code>subprocess.run(["python", "x.py"])</code>) なども使えます。<code>print("\\033[2J")</code> でも画面を消せます。<code>msvcrt.getch()</code> は入力欄で 1 文字受け取ります。</li>
    <li>使えないもの: ほかのプログラム (<code>git</code> など) の起動、本当に同時に動くスレッド、<code>socket</code> での直接の通信、パソコンの操作 (<code>pyautogui</code> など)、PyQt などほかの GUI。</li>
  </ul>
  <h3 id="help-console">コンソール</h3>
  <ul>
    <li>「出力」の一番下の欄に Python の式やコードを入れて Enter で、その場で実行できます (例: <code>1 + 2</code>、<code>len(names)</code>)。</li>
    <li>実行が終わった後も変数が残るので、結果を調べられます。デバッガーで止まっている間は、その場所の変数を使えます。</li>
  </ul>
  <h3 id="help-input">入力を助ける機能</h3>
  <ul>
    <li><b>補完</b>: 変数・関数・モジュールの中身 (<code>math.</code>・<code>"abc".</code>・自分のクラスのメソッド・ほかのファイルの関数) を、型を推論して候補に出します (jedi)。</li>
    <li><b>引数ヒント・説明</b>: 関数の <code>(</code> の中で引数の名前を表示します。名前を長押し (PC はマウスを乗せる) と説明 (docstring) が出ます。</li>
    <li><b>続きの提案</b>: 薄い文字の続きは <b>Tab</b> (スマホはキーボードの上の <b>✓</b>) で確定。<code># 1 から 100 まで足す</code> のようなコメントの次の行で AI キー (<kbd>Alt + \\</kbd>) を押すと、コードを組み立てます。</li>
    <li><b>整形</b> (<kbd>Shift + Alt + F</kbd>): PEP 8 に合わせて、空白・字下げ・空行をそろえます (autopep8)。設定 → 保存 で、保存のたびに整形することもできます。</li>
    <li><b>自動で import</b>: まだ import していない <code>random</code> や <code>sqrt</code> なども候補に出て、選ぶとファイルの先頭に import を足します。</li>
    <li><b>実行前のチェック</b>: 実行しなくても分かる間違いに下線を引きます — <code>input()</code> の結果 (文字列) を数として使っている・<code>math.squareroot</code> のようにないもの・引数の数や名前の間違い・<code>nums.push()</code> のような他の言語の書き方・<code>x = nums.sort()</code> など。多くはワンタップで直せます。</li>
    <li><b>字下げ</b>: <code>:</code> の後で改行すると自動で字下げします。スペース 4 つが基本です。</li>
    <li><b>スティッキースクロール</b>: 長いコードをスクロールすると、いま見ている <code>def</code> / <code>class</code> / <code>for</code> の行が上に固定されます (タップでその行へ)。</li>
  </ul>
  <h3 id="help-errors">誤字・エラー対策</h3>
  <ul>
    <li><b>エラーチェック</b>: 構文エラーと、定義されていない名前・使っていない import などを、書いている間に日本語で知らせます (pyflakes)。</li>
    <li><b>もしかして</b>: <code>prnt</code> → <code>print</code>、<code>lenght</code> → <code>length</code> のような打ち間違いに、正しい名前を提案します。</li>
    <li><b>直し方を選ぶ</b>: 行の右に出る説明をタップ (PC は <kbd>⌘/Ctrl + .</kbd>、スマホは修正キー) すると、ワンタップで直せます (<code>:</code> の付け忘れ・import 忘れ・字下げ など)。</li>
    <li><b>自動修正</b>: 全角の <code>（）：＝”</code> や全角スペース、iPhone が変える <code>“ ”</code>、よくある打ち間違いを、入力した時点で直します (文字列とコメントの中はそのまま)。設定でオフにできます。</li>
    <li><b>実行エラーの解説</b>: <code>NameError</code>・<code>TypeError</code>・<code>IndexError</code> などに、日本語で原因と直し方を表示します。エラーの「AI で直す」で、そのまま直せます。</li>
  </ul>
  <h3 id="help-nav">コードの移動・名前の変更</h3>
  <ul>
    <li><b>定義へ移動</b> (<kbd>F12</kbd>): 変数・関数・クラスの定義へジャンプします (ほかのファイルも)。</li>
    <li><b>参照を検索</b> (<kbd>⇧F12</kbd>): その名前を使っている場所を、プロジェクト全体から一覧表示します。</li>
    <li><b>名前を変更</b> (<kbd>F2</kbd>): 変数・関数の名前を、使っているすべての場所 (ほかのファイルも) で一度に変えます。</li>
    <li><b>アウトライン</b>: ファイルの関数・クラスの一覧から移動できます。</li>
    <li>スマホでは、キーボードの上のバーの ◎ (コード操作) から使えます。</li>
  </ul>
  <h3 id="help-debug">デバッガー (止めて調べる)</h3>
  <ul>
    <li>行番号の左をタップすると赤い点 (<b>ブレークポイント</b>) が付きます (<kbd>F9</kbd>)。▶ で実行すると、その行の手前で止まります。コードに <code>breakpoint()</code> と書いても止まります。</li>
    <li>止まっている間は「デバッグ」タブで<b>変数の値</b>・<b>呼び出し履歴</b>を確認できます。リスト・辞書・オブジェクトはタップで中身を開けます。</li>
    <li><b>ステップ</b> (<kbd>F10</kbd>) で 1 行ずつ、<b>中へ</b> (<kbd>F11</kbd>) で関数の中へ、<b>外へ</b> (<kbd>⇧F11</kbd>) で呼び出し元へ進みます。<b>続行</b> (<kbd>F5</kbd>) で次のブレークポイントまで。実行中に <b>一時停止</b> もできます。</li>
    <li>赤い点を長押しすると、<b>条件付き</b> (例: <code>i == 10</code> のときだけ止まる) や<b>ログポイント</b> (止めずに <code>{変数}</code> の値を出力) にできます。</li>
    <li><b>ウォッチ</b>: 式を登録すると、止まるたびにその値を表示します。</li>
  </ul>
  <h3 id="help-ai">AI (Forge AI)</h3>
  <ul>
    <li><b>AI パネル</b> (サイドバーの星形のアイコン): アプリに内蔵された AI です。インターネットも API キーも要らず、すぐに答えます。</li>
    <li><b>直す</b>: 「直して」— 構文エラー (<code>:</code> 忘れ・字下げ・括弧・全角記号・他の言語の書き方)・打ち間違い・import 忘れ・<code>== None</code> や何でも受ける <code>except:</code> などのよくあるバグを直します。</li>
    <li><b>整える</b>: 「整形して」「整理して」(f-string などの新しい書き方へ)、「最適化して」。</li>
    <li><b>説明する</b>: 「説明して」でファイルの概要と流れを日本語で。範囲を選ぶと 1 行ずつ。「コメントを追加して」「型ヒントを付けて」もできます。</li>
    <li><b>作る</b>: 「数当てゲームを作って」「CSV を読んでグラフにして」「1 から 100 まで足すプログラム」のように日本語で頼むと、コードを作ります。</li>
    <li><b>答える</b>: 「リストと辞書の違いは?」「for 文の使い方」「enumerate とは」「TypeError って何?」のような質問に、例のコード付きで答えます。</li>
    <li><b>変更の取り消し</b>: AI が変えたファイルは「差分」で確認、「すべて元に戻す」で取り消せます。</li>
    <li><b>高性能モード</b>: 設定 → AI で端末内の言語モデル (Qwen2.5-Coder) をオンにすると、決まった型に当てはまらない自由な依頼にも答えます (WebGPU が使える端末のみ)。</li>
  </ul>
  <h3 id="help-mobile">スマホでの操作</h3>
  <ul>
    <li>キーボードの上のバーで、記号・矢印・Tab・元に戻すが入力できます。「選択」をオンにすると矢印で範囲選択できます。</li>
    <li>2 本指でピンチすると文字の大きさを変えられます。</li>
    <li>ファイルやタブを長押しするとメニューが出ます。</li>
    <li>ホーム画面に追加すると、アプリのように全画面で使えます (オフラインでも動作します)。</li>
  </ul>
  <h3 id="help-keys">キーボードショートカット (iPad / PC)</h3>
  <table>
    <tr><td><kbd>⌘/Ctrl + S</kbd></td><td>保存</td></tr>
    <tr><td><kbd>⌘/Ctrl + Enter</kbd> / <kbd>F5</kbd></td><td>実行</td></tr>
    <tr><td><kbd>⌘/Ctrl + .</kbd></td><td>この行のエラーを修正</td></tr>
    <tr><td><kbd>⌘/Ctrl + P</kbd></td><td>ファイルを開く</td></tr>
    <tr><td><kbd>⌘/Ctrl + Shift + P</kbd></td><td>コマンドパレット</td></tr>
    <tr><td><kbd>⌘/Ctrl + F</kbd></td><td>検索・置換</td></tr>
    <tr><td><kbd>⌘/Ctrl + Shift + F</kbd></td><td>全ファイルから検索</td></tr>
    <tr><td><kbd>⌘/Ctrl + /</kbd></td><td>コメント切り替え</td></tr>
    <tr><td><kbd>⌘/Ctrl + D</kbd></td><td>同じ単語を追加選択 (マルチカーソル)</td></tr>
    <tr><td><kbd>Alt + ↑/↓</kbd></td><td>行を移動</td></tr>
    <tr><td><kbd>Shift + Alt + F</kbd></td><td>整形</td></tr>
    <tr><td><kbd>F9</kbd> / <kbd>F10</kbd> / <kbd>F11</kbd></td><td>ブレークポイント / ステップ / 中へ</td></tr>
    <tr><td><kbd>⌘/Ctrl + B</kbd> / <kbd>⌘/Ctrl + J</kbd></td><td>サイドバー / パネルの表示切り替え</td></tr>
    <tr><td><kbd>Ctrl + \`</kbd></td><td>ターミナル</td></tr>
    <tr><td><kbd>Tab</kbd> / <kbd>⌘/Ctrl + →</kbd></td><td>インライン候補を確定 / 1 単語だけ確定</td></tr>
  </table>`;let i=c("div",{class:"help-toc"},[...d.querySelectorAll("h3[id]")].map(o=>c("button",{class:"chip",onclick:()=>o.scrollIntoView({block:"start",behavior:"smooth"})},o.textContent.replace(/\s*\(.*\)$/,""))));if(d.prepend(i),l({title:"使い方",body:d,wide:!0}),typeof e=="string"){let o=d.querySelector("#help-"+e.replace(/[^\w-]/g,""));o&&setTimeout(()=>o.scrollIntoView({block:"start"}),60)}}function r(){let e=c("div",{class:"help whats-new"});e.innerHTML=`
  <p>ForgeCode 15 — <b>開発の道具がそろいました</b></p>
  <ul>
    <li><b>ノートブック (.ipynb)</b> — 「その他」→「新しいノートブック」。セルごとに書いて ▶ (Shift + Enter) で実行し、結果・表・図をセルの下に出します。変数は次のセルでも使えます。Jupyter・Google Colab と同じ形で保存します。</li>
    <li><b>Web アプリ</b> — Flask・FastAPI・<code>http.server</code>・<code>wsgiref</code> の <code>app.run()</code> を、アプリの中のブラウザ (プレビュー) で動かします。HTML・CSS・JavaScript のファイルも ▶ でそのまま表示 (コンソール付き)。</li>
    <li><b>テスト</b> — 左の「テスト」で <code>test_*.py</code> を一覧にして実行。✓ ✗ と、失敗した行・<code>assert 4 == 5</code> のような値を表示します。pytest と同じ書き方 (フィクスチャ・<code>parametrize</code>・<code>raises</code>)。ターミナルでは <code>pytest</code>。</li>
    <li><b>git</b> — 左の「ソース管理」で、変更の一覧・コミット・履歴・差分・ブランチ・マージ・前の版に戻す。ターミナルでも <code>git status</code> / <code>commit</code> / <code>log</code> / <code>diff</code> / <code>branch</code> / <code>stash</code> など。</li>
    <li><b>時間を計って実行</b> — 「その他」→「時間を計って実行」で、時間のかかった関数・行を表で表示 (タップでその場所へ)。</li>
    <li><b>ターミナル</b> — <code>awk</code>・<code>jq</code>・<code>sqlite3</code>・<code>bc</code>・<code>tar</code>・<code>gzip</code>・<code>xxd</code>・<code>md5sum</code>・<code>column</code> など 30 以上のコマンドと、<code>case</code>・ヒアドキュメント (<code>&lt;&lt;EOF</code>)・<code>\${x:-既定}</code>・<code>{1..10}</code>・<code>&amp;</code> (裏で動かす) に対応。</li>
    <li><b>速く・いつも最新</b> — 2 回目からは Python の準備が約 3 倍速く (準備の終わった状態を保存)。新しい版は、何も動いていないときに自動で切り替わります (「その他」の一番下に版を表示)。</li>
  </ul>
  <p>ForgeCode 14.1 — <b>アプリを閉じても動く</b>・ターミナルの進化</p>
  <ul>
    <li><b>クラウドで動かす</b> — GitHub のサーバーで、5 分ごと〜毎日 決まった時刻にプログラムを動かします。アプリを閉じても、スマホの電源を切っても動き続け、結果のファイルと出力は GitHub に残ります (「その他」→「クラウドで動かす」・ターミナルの <code>cloud</code>)。</li>
    <li><b>ターミナル</b> — <code>for</code>・<code>while</code>・<code>if</code>・関数・<code>$((計算))</code>・<code>read</code>、シェルスクリプト (<code>sh run.sh</code>・<code>./run.sh</code>)、続きの行 (<code>&gt;</code>)、履歴からの提案 (→ で確定)・<kbd>Ctrl + R</kbd> の検索、ターミナルを増やす、<code>xargs</code>・<code>watch</code>・<code>zip</code>・<code>unzip</code>・<code>base64</code>・<code>sha256sum</code>・<code>file</code>。</li>
    <li><b>Python</b> — 画像・Excel・SQLite・pickle などバイナリのファイルを保存して次の実行で使える (画像はタップで表示)。<code>os.system("cls")</code>・<code>subprocess.run(["python", "x.py"])</code>・<code>msvcrt.getch()</code>・<code>print("\\033[2J")</code> での画面の消去。</li>
    <li><b>速く</b> — 実行のたびに、変わったファイルだけを Python に渡します (大きな画像やデータがあっても、すぐ始まります)。ターミナルの出力をまとめて描きます。</li>
  </ul>
  <p>ForgeCode 14 — <b>ターミナル</b>と<b>24 時間動かす</b>機能</p>
  <ul>
    <li><b>ターミナル</b> — <code>ls</code>・<code>cd</code>・<code>cat</code>・<code>grep</code>・<code>mkdir</code>・<code>cp</code>・<code>mv</code>・<code>rm</code> などでプロジェクトのファイルを扱えます。<code>python main.py 引数</code>・<code>python</code> (対話モード)・<code>python -c</code>・<code>pip install</code> も。パイプ・リダイレクト・Tab の補完・↑↓ の履歴・色付きの出力に対応。上のバーの <b>&gt;_</b> か <kbd>Ctrl + \`</kbd> で開きます。</li>
    <li><b>24 時間動かす</b> — 実行中は画面を消さない・エラーで止まったら自動で再実行 (設定)・何時間でも止まらない出力・長く裏にあった後の Python の見守り。実行画面と下のバーに経過時間を表示します。</li>
    <li><b>整理</b> — 「その他」メニューを「編集・実行・コード・アプリ」に分け、コマンドパレットは「すべての機能」として種類ごとに表示 (最近使ったものが上に)。設定は分類の見出しから移動でき、使い方には目次を付けました。</li>
    <li><b>出力の色</b> — <code>print("\\033[31m赤\\033[0m")</code> や colorama・rich の色、<code>\\r</code> で書き換える進み具合の表示 (tqdm など) が、そのまま見えます。</li>
    <li><b>速く・軽く</b> — ターミナルは開いたときに読み込み、PC ではパネルを最大化できます。<code>python サブフォルダ/x.py</code> で同じフォルダのモジュールを import できるようにしました。</li>
  </ul>
  <p>ForgeCode 13.0.1 — <b>落ちにくく</b>しました。</p>
  <ul>
    <li>iPhone・iPad では、端末内 AI モデルを起動のたびに自動で読み込まないようにしました (Python と合わせるとメモリが足りず、アプリが落ちることがありました)。AI パネルで頼んだとき・設定の「いま読み込む」で読み込みます。</li>
    <li>アプリが止まったときは次の起動で理由の見当を知らせ、起動してすぐ止まるのが続いたときは「安全モード」(先読みをしない) で起動します。AI モデルを使っている間に止まったときは、自動での読み込みをやめます。</li>
    <li>メモリの節約: pygame のキャンバスの使い回し、グラフのアニメーションを軽く、とても大きな画像は縮めて読み込む、実行ごとに画像・音・ゲーム画面の入れ物を手放す。</li>
    <li>tkinter の細かい <code>after</code>・<code>update()</code> のループで、画面への命令があふれないようにしました。</li>
  </ul>
  <p>ForgeCode 13 — <b>大型アップデート</b></p>
  <ul>
    <li><b>全画面の実行画面</b> — ▶ で画面いっぱいに結果を表示。左上の「‹ 戻る」(スマホは左端からスワイプ) でコードに戻れます。</li>
    <li><b>グラフ・絵が 1 枚でなめらかに動く</b> — <code>plt.pause()</code>・<code>FuncAnimation</code>・ループの中の <code>plt.show()</code> も、画像を何枚も並べず同じ場所で描き直します (画面の速さに合わせて最大 60 fps)。</li>
    <li><b>pygame と tkinter</b> — ゲームの画面やボタンのあるウィンドウが出力に表示され、キー・タップで操作できます。<code>messagebox</code> などのダイアログ、<code>pygame.mixer</code> の音も。テンプレートにも追加しました。</li>
    <li><b>VS Code と同じ色</b> — Dark Modern / Light Modern の配色で、変数・関数・クラス・モジュール・定数を色分けします (括弧の色分けも同じ)。AI の答えやコンソールのコードも同じ色です。</li>
    <li><b>AI に任せる</b> — 端末内の AI モデルをダウンロードすると、書くのが止まったときに AI がバグを探して知らせ、実行エラーには確かめた直し方 (「直して実行」) を出し、続きも AI が書きます。作ったコードは構文チェックと試し実行で確かめてから出します。最高性能 (7B) のモデルも選べます。</li>
    <li><b>速く・安定して</b> — 図が多いときのメモリの節約、大きなファイルでも軽い色分け、Python が止まったときの自動の立ち直り。</li>
  </ul>
  <p>ForgeCode 12.1 — <b>Python がもっとそのまま動く</b>ようになりました。</p>
  <ul>
    <li><b>turtle</b> — タートルグラフィックスが出力に描かれます。キー操作・タップ・タイマーでゲームも作れます。</li>
    <li><b>PyPI から自動で</b> — Pyodide にないライブラリも、<code>import</code> すると PyPI から入ります。<code>requirements.txt</code>・コンソールの <code>pip install</code> にも対応。</li>
    <li><b>asyncio・スレッド・time.sleep</b> — <code>asyncio.run()</code> が動き、スレッドやプロセスは順番に実行されます。<code>time.sleep()</code> の途中でも ■ で止まり、出力もすぐ出ます。</li>
    <li><b>通信と表示</b> — <code>urllib</code>・<code>requests</code> での読み込み、pandas の表・PIL の画像・<code>plt.pause()</code> の表示。</li>
    <li><b>補完がライブラリにも</b> — numpy・pandas や PyPI のライブラリの中身も候補に出ます。まだ import していない名前は、選ぶと import を足します。</li>
    <li><b>実行前のチェック</b> — <code>input()</code> を数として使う・ないメソッド・引数の数の間違いなどを、実行する前に教えます。</li>
    <li><b>速く</b> — Python の準備が早くなり、とても長い出力もすぐ表示します。一度読んだライブラリは端末に保存して、次からすぐ (オフラインでも) 使えます。</li>
  </ul>
  <p>ForgeCode 12 — <b>Python のエディタ</b>になりました。</p>
  <ul>
    <li><b>本物の Python 3.14</b> — 端末の中で CPython が動きます。<code>input()</code>・■ で停止・いくつものファイルの <code>import</code>・ファイルの読み書きに対応。</li>
    <li><b>ライブラリ</b> — numpy・pandas・matplotlib などは <code>import</code> するだけで使えます。<code>plt.show()</code> のグラフは出力に表示されます。</li>
    <li><b>賢い補完とチェック</b> — jedi による補完・引数ヒント・説明、pyflakes によるエラーチェック (日本語・ワンタップで修正)、autopep8 による整形。</li>
    <li><b>定義へ移動・参照・名前の変更</b> — ほかのファイルもまとめて扱います。</li>
    <li><b>デバッガー</b> — ブレークポイント (条件付き・ログ)・ステップ・一時停止・変数とウォッチ・<code>breakpoint()</code>。止まった場所でコンソールも使えます。</li>
    <li><b>Forge AI も Python に</b> — 直す・説明・コメント・型ヒント・レビュー・コード生成・質問への回答。</li>
    <li>これまでの Luau / Roblox のプロジェクトはそのまま残ります (ファイルの編集・保存はできますが、実行はできません)。</li>
  </ul>`,l({title:"新しくなりました",body:e,actions:[{label:"使い方を見る",run:()=>{setTimeout(t,200)}},{label:"OK",primary:!0}]})}export{t as showHelp,r as showWhatsNew};
