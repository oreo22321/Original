// サイドバーのビュー: 検索 / アウトライン + 履歴・ヘルプのダイアログ
import * as vfs from './vfs.js'
import { app, command, writeProjectFile, refreshFiles } from './app.js'
import { on } from './store.js'
import { h, icon, fileIcon, modal, toast, relTime, confirmDialog, escapeHtml } from './ui.js'
import { outlineSymbols } from './palette.js'
import { EditorState, EditorView, unifiedMergeView } from '../../vendor/codemirror.js'
import { editorTheme } from '../editor/themes.js'
import { getSettings } from './store.js'

// ============================================================
// ファイル内検索・置換
// ============================================================
export class SearchView {
  constructor(root) {
    this.root = root
    this.opts = { regex: false, caseSensitive: false, word: false }
    this.build()
  }
  build() {
    const opt = (key, label, title) => {
      const b = h('button', { class: 'opt-btn', title, 'aria-pressed': 'false', onclick: () => { this.opts[key] = !this.opts[key]; b.classList.toggle('on', this.opts[key]); this.search() } }, label)
      return b
    }
    this.q = h('input', { class: 'input', placeholder: '検索', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
    this.r = h('input', { class: 'input', placeholder: '置換', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
    this.include = h('input', { class: 'input small', placeholder: '対象 (例: *.lua, src/)', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
    this.results = h('div', { class: 'search-results' })
    this.summary = h('div', { class: 'search-summary' })
    let t = null
    this.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.search(), 250) })
    this.q.addEventListener('keydown', e => { if (e.key === 'Enter') this.search() })
    this.include.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.search(), 300) })
    this.root.append(
      h('div', { class: 'side-head' }, h('div', { class: 'side-title' }, '検索')),
      h('div', { class: 'search-form' },
        h('div', { class: 'input-row' }, this.q, opt('caseSensitive', 'Aa', '大文字と小文字を区別'), opt('word', 'ab', '単語単位'), opt('regex', '.*', '正規表現')),
        h('div', { class: 'input-row' }, this.r, h('button', { class: 'btn small', onclick: () => this.replaceAll() }, 'すべて置換')),
        this.include),
      this.summary, this.results)
  }
  focus() { setTimeout(() => this.q.focus(), 50) }
  regex() {
    const q = this.q.value
    if (!q) return null
    let src = this.opts.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (this.opts.word) src = `\\b${src}\\b`
    try { return new RegExp(src, 'g' + (this.opts.caseSensitive ? '' : 'i')) } catch { return null }
  }
  async search() {
    const re = this.regex()
    this.results.innerHTML = ''
    this.summary.textContent = ''
    if (!re || !app.project) return
    const filter = this.include.value.trim()
    const pats = filter ? filter.split(',').map(s => s.trim()).filter(Boolean).map(p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + (p.endsWith('/') ? '' : '$'))) : null
    const all = await vfs.readAll(app.project.id)
    let total = 0, nfiles = 0
    for (const f of all.sort((a, b) => a.path.localeCompare(b.path))) {
      if (f.dir) continue
      if (pats && !pats.some(p => p.test(f.path) || p.test(f.path.split('/').pop()) || f.path.startsWith(p.source.slice(1).replace(/\\/g, '')))) continue
      const doc = app.editors.docs.get(f.path)
      const text = doc ? doc.state.doc.toString() : (f.content || '')
      const lines = text.split('\n')
      const hits = []
      lines.forEach((line, i) => {
        re.lastIndex = 0
        let m
        while ((m = re.exec(line))) {
          hits.push({ line: i + 1, col: m.index, len: m[0].length || 1, text: line })
          if (!m[0].length) re.lastIndex++
          if (hits.length > 500) break
        }
      })
      if (!hits.length) continue
      nfiles++
      total += hits.length
      const group = h('div', { class: 'sr-group' })
      group.append(h('div', { class: 'sr-file' }, fileIcon(f.path), h('span', null, f.path), h('span', { class: 'badge' }, hits.length)))
      for (const hit of hits.slice(0, 100)) {
        const pre = hit.text.slice(Math.max(0, hit.col - 30), hit.col)
        const mid = hit.text.slice(hit.col, hit.col + hit.len)
        const post = hit.text.slice(hit.col + hit.len, hit.col + hit.len + 60)
        const row = h('button', { class: 'sr-hit', onclick: () => app.editors.open(f.path, { line: hit.line }).then(() => app.editors.gotoLine(hit.line, hit.col + 1)) },
          h('span', { class: 'sr-ln' }, hit.line))
        const txt = h('span', { class: 'sr-text' })
        txt.innerHTML = escapeHtml(pre.trimStart()) + '<mark>' + escapeHtml(mid) + '</mark>' + escapeHtml(post)
        row.append(txt)
        group.append(row)
      }
      this.results.append(group)
      if (total > 5000) break
    }
    this.summary.textContent = total ? `${nfiles} ファイル / ${total} 件` : '見つかりません'
  }
  async replaceAll() {
    const re = this.regex()
    if (!re) return
    const rep = this.r.value
    const all = await vfs.readAll(app.project.id)
    const targets = []
    for (const f of all) {
      if (f.dir) continue
      const doc = app.editors.docs.get(f.path)
      const text = doc ? doc.state.doc.toString() : (f.content || '')
      re.lastIndex = 0
      if (re.test(text)) targets.push({ f, text, doc })
    }
    if (!targets.length) return
    if (!(await confirmDialog('すべて置換', `${targets.length} 個のファイルで置換します。よろしいですか?`, { okLabel: '置換' }))) return
    for (const { f, text, doc } of targets) {
      re.lastIndex = 0
      const next = text.replace(re, rep)
      if (doc) app.editors.replaceAll(doc, next)
      else await writeProjectFile(f.path, next, { reload: false })
    }
    await app.editors.saveAll()
    await refreshFiles()
    toast('置換しました')
    this.search()
  }
}

// ============================================================
// アウトライン
// ============================================================
export class OutlineView {
  constructor(root) {
    this.root = root
    this.list = h('div', { class: 'outline-list' })
    this.root.append(h('div', { class: 'side-head' }, h('div', { class: 'side-title' }, 'アウトライン')), this.list)
    let t = null
    const sched = () => { clearTimeout(t); t = setTimeout(() => this.render(), 400) }
    on('active', sched)
    on('docchange', sched)
  }
  render() {
    this.list.innerHTML = ''
    const doc = app.editors && app.editors.activeDoc()
    if (!doc) { this.list.append(h('div', { class: 'tree-empty' }, 'ファイルを開いてください')); return }
    const syms = outlineSymbols(doc.state.doc.toString(), doc.lang)
    if (!syms.length) { this.list.append(h('div', { class: 'tree-empty' }, '関数や変数が見つかりません')); return }
    const KIND_ICON = { '関数': 'ƒ', 'メソッド': 'ƒ', 'サービス': '◆', '変数': 'x', '型': 'T', 'イベント': '⚡', '見出し': '#', 'クラス': 'C' }
    for (const s of syms) {
      this.list.append(h('button', { class: 'outline-item', style: { paddingLeft: 10 + s.depth * 14 + 'px' }, onclick: () => app.editors.gotoLine(s.line) },
        h('span', { class: 'ol-kind k-' + s.kind }, KIND_ICON[s.kind] || '•'), h('span', { class: 'ol-name' }, s.name), h('span', { class: 'ol-line' }, s.line)))
    }
  }
}

// ============================================================
// ローカル履歴
// ============================================================
export async function showHistory(path) {
  path = path || app.editors.active
  if (!path) return
  const list = await vfs.getHistory(app.project.id, path)
  const body = h('div', { class: 'history' })
  const m = modal({ title: `履歴: ${path.split('/').pop()}`, body, wide: true })
  if (!list.length) { body.append(h('div', { class: 'tree-empty' }, 'まだ履歴がありません。保存するたびに自動で記録されます。')); return }
  const listEl = h('div', { class: 'history-list' })
  const diffEl = h('div', { class: 'history-diff' })
  body.append(listEl, diffEl)
  const current = () => { const d = app.editors.docs.get(path); return d ? d.state.doc.toString() : null }
  let view = null
  const select = async (rec, row) => {
    listEl.querySelectorAll('.history-item').forEach(r => r.classList.remove('active'))
    row.classList.add('active')
    diffEl.innerHTML = ''
    const cur = current() ?? (await vfs.readFile(app.project.id, path)) ?? ''
    const s = getSettings()
    if (view) view.destroy()
    view = new EditorView({
      parent: diffEl,
      state: EditorState.create({
        doc: cur,
        extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false), editorTheme(s.theme, s.fontFamily, Math.max(11, s.fontSize - 2), 1.45), unifiedMergeView({ original: rec.content, mergeControls: false, highlightChanges: true, gutter: true })],
      }),
    })
    diffEl.prepend(h('div', { class: 'history-actions' },
      h('span', { class: 'label' }, '赤 = この版 / 緑 = 現在'),
      h('button', { class: 'btn small primary', onclick: async () => {
        if (!(await confirmDialog('この版に戻す', `${new Date(rec.time).toLocaleString('ja-JP')} の内容に戻しますか? (現在の内容も履歴に残ります)`, { okLabel: '戻す' }))) return
        await vfs.addHistory(app.project.id, path, cur)
        const doc = app.editors.docs.get(path)
        if (doc) { app.editors.replaceAll(doc, rec.content); await app.editors.save(path) }
        else await writeProjectFile(path, rec.content)
        toast('復元しました')
        m.close()
      } }, icon('history', 16), 'この版に戻す')))
  }
  list.forEach((rec, i) => {
    const row = h('button', { class: 'history-item', onclick: () => select(rec, row) }, h('span', null, new Date(rec.time).toLocaleString('ja-JP')), h('span', { class: 'pr-meta' }, relTime(rec.time) + ' ・ ' + rec.content.split('\n').length + ' 行'))
    listEl.append(row)
    if (i === 0) setTimeout(() => select(rec, row), 0)
  })
}

// ============================================================
// ヘルプ
// ============================================================
export function showHelp() {
  const body = h('div', { class: 'help' })
  body.innerHTML = `
  <h3>はじめかた</h3>
  <ol>
    <li>左上の <b>☰</b> (iPad / PC では左端のアイコン) でファイル一覧を開き、ファイルをタップして開きます。</li>
    <li>コードを書くと自動で保存されます。保存の状態は画面下のバーに表示されます。</li>
    <li><b>▶</b> を押すと実行します。結果は下の「出力」、作った GUI は「ゲーム」タブに表示されます。</li>
  </ol>
  <h3>2 つのモード</h3>
  <ul>
    <li><b>Studio</b>: Roblox Studio に貼り付けるスクリプト用。ファイル名で種類が決まります — <code>〜.server.luau</code> は Script、<code>〜.client.luau</code> は LocalScript、それ以外は ModuleScript。</li>
    <li><b>Executor</b>: エグゼキューター用。<code>getgenv</code>・<code>writefile</code>・<code>hookmetamethod</code>・<code>Drawing</code> などを補完し、模擬的に実行できます。ファイル関数の保存先は <code>workspace</code> フォルダです。</li>
    <li>切り替えは、画面下の左端 (Studio / Executor) をタップします。プロジェクトごとに記憶されます。</li>
  </ul>
  <h3>入力を助ける機能</h3>
  <ul>
    <li><b>補完</b>: <code>game:GetService("</code> でサービス名、<code>part.</code> でプロパティ、<code>:</code> でメソッド。自分で作ったテーブル・クラス (<code>setmetatable</code>)・関数の戻り値・<code>type</code> 定義・<code>require</code> したモジュールの中身も、型を推論して候補に出します。<code>if x:IsA("BasePart") then</code> の中では <code>x</code> を BasePart として扱います。</li>
    <li><b>その場面に合う候補</b>: <code>part.Material = </code> で Enum の一覧、<code>humanoid:ChangeState(</code> で引数の Enum、<code>frame.Size = UD</code> で <code>UDim2.new(...)</code>、<code>TweenService:Create(part, info, {</code> でアニメーションできるプロパティ、<code>GetAttribute("</code> でこのファイルで使った属性名が出ます。見えている変数は型と一緒に、近くで宣言したものほど上に並びます。</li>
    <li><b>インライン候補</b>: 薄い文字の続きは <b>Tab</b> (スマホはキーボードの上の <b>✓</b>) で確定。<code>PlayerAdded:Connect(</code> では引数名 (player) まで入り、<code>frame.Parent = </code> では親にふさわしい変数 (ScreenGui など)、<code>Instance.new("TextLabel")</code> の次の行では次に設定するプロパティを提案します。同じような行をくり返すと次の行を予測します。</li>
    <li><b>自動整形</b>: 書き終えた行の空白 (<code>x=1+2</code> → <code>x = 1 + 2</code>、カンマの後など) を整え、入力が止まったときにエラーがなければファイル全体の字下げ・空行も直します。カーソルのある行には触れず、<kbd>⌘Z</kbd> は自分の入力だけを戻します。設定 → エディタ でオフにできます。</li>
    <li><b>end の自動入力・自動削除</b>: <code>if ... then</code> / <code>for ... do</code> / <code>function()</code> を書いた時点で、次の行に <code>end</code> が入ります。自分で <code>end</code> を書いても二重になりません。<code>if</code> や <code>function</code> を消すと、対になっていた <code>end</code> も一緒に消えます (<kbd>⌘Z</kbd> 1 回で元に戻せます)。</li>
    <li><b>スティッキースクロール</b>: 長いコードをスクロールすると、いま見ている <code>function</code> / <code>if</code> の行が画面の上に固定されます (タップでその行へ)。</li>
    <li><b>引数ヒント</b>: 関数の <code>(</code> の中で、引数の名前と型が表示されます (自分で作った関数も対象)。</li>
    <li><b>色の選択</b>: <code>Color3.fromRGB(...)</code> の左の四角をタップすると色を選べます。</li>
  </ul>
  <h3>誤字・エラー対策</h3>
  <ul>
    <li><b>もしかして</b>: <code>GetServise</code>・<code>"Playrs"</code>・<code>part.Tranparency</code> のようなスペルミスを見つけて、正しい名前を提案します。</li>
    <li><b>直し方を選ぶ</b>: 行の右に出る赤・黄色の説明をタップ (PC は <kbd>⌘/Ctrl + .</kbd>、スマホは 💡 キー) すると、ワンタップで修正できます。</li>
    <li><b>自動修正</b>: <code>fucntion</code> → <code>function</code> などの打ち間違い、全角の <code>（）＝”</code> や全角スペース、iPhone が勝手に変える <code>“ ”</code> を自動で直します (文字列とコメントの中はそのまま)。</li>
    <li><b>end の過不足</b>: どの <code>if</code> / <code>function</code> の <code>end</code> が足りないかを指摘し、正しい位置に追加できます。</li>
    <li><b>実行エラーの解説</b>: <code>attempt to index nil</code> などのエラーに、日本語で原因と直し方を表示します。</li>
  </ul>
  <h3>コードの移動・名前の変更</h3>
  <ul>
    <li><b>定義へ移動</b> (<kbd>F12</kbd>): 変数・関数の宣言へジャンプします。モジュールの関数 (<code>Util.format</code>) は他のファイルからも探します。</li>
    <li><b>参照を検索</b> (<kbd>⇧F12</kbd>): その変数・関数を使っている場所を一覧表示します。</li>
    <li><b>名前を変更</b> (<kbd>F2</kbd>): 変数の名前をすべての場所で一度に変えます。同じ名前の別の変数 (内側の local など) は変わりません。</li>
    <li>カーソルを置いた変数は、使われている場所がすべてハイライトされます (代入している場所は黄色)。</li>
    <li>スマホでは、キーボードの上のバーの ◎ (コード操作) から使えます。</li>
  </ul>
  <h3>デバッガー (止めて調べる)</h3>
  <ul>
    <li>行番号の左をタップすると赤い点 (<b>ブレークポイント</b>) が付きます (<kbd>F9</kbd>)。▶ で実行すると、その行の手前で止まります。</li>
    <li>止まっている間は「デバッグ」タブで<b>変数の値</b>・<b>呼び出し履歴</b>を確認できます。テーブルや Instance はタップで中身を開けます。エディタで変数にカーソルを合わせても値が見えます。</li>
    <li><b>ステップ</b> (<kbd>F10</kbd>) で 1 行ずつ、<b>中へ</b> (<kbd>F11</kbd>) で関数の中へ、<b>外へ</b> (<kbd>⇧F11</kbd>) で呼び出し元へ進みます。<b>続行</b> (<kbd>F5</kbd>) で次のブレークポイントまで。</li>
    <li>赤い点を長押しすると、<b>条件付き</b> (例: <code>i == 10</code> のときだけ止まる) や<b>ログポイント</b> (止めずに <code>{変数}</code> の値を出力) にできます。</li>
    <li><b>ウォッチ</b>: 式を登録すると、止まるたびにその値を表示します。</li>
  </ul>
  <h3>コンソール</h3>
  <ul>
    <li>「出力」の一番下の欄に式やコードを入力して Enter で、その場で実行できます (例: <code>1 + 2</code>、<code>workspace:GetChildren()</code>)。</li>
    <li>実行が終わった後も同じ環境が残るので、スクリプトの変数や作ったオブジェクトを調べられます。デバッガーで止まっている間は、その場所の変数を使えます。</li>
  </ul>
  <h3>実行</h3>
  <ul>
    <li>ブラウザ内の Luau 互換エンジンで実行します。<code>game</code>・<code>workspace</code>・<code>Instance.new</code>・<code>task.wait</code>・<code>TweenService</code>・<code>DataStoreService</code>・<code>RemoteEvent</code> など Roblox の API を模擬的に使えます (物理演算や 3D の描画は行いません)。</li>
    <li><b>ゲーム画面</b>: スクリプトが作った ScreenGui を、Roblox と同じ規則で大きさ・位置を計算して「ゲーム」タブに表示します (UIListLayout・UIPadding・AutomaticSize・ScrollingFrame・UIScale など)。タップ・ドラッグ (スライダーやウィンドウの移動)・スクロール・文字入力・キー入力がそのままスクリプトに届きます。右上の ⛶ で全画面 (スマホは自動で横向き)。</li>
    <li><b>スマホ / タブレット / PC</b>: ゲーム画面の大きさと、端末の種類 (TouchEnabled など) を切り替えられます。</li>
    <li><b>操作できるもの</b>: ClickDetector・ProximityPrompt・Touched・キー入力に関数を接続していると、「ゲーム」タブから試せます。</li>
    <li><b>レイキャスト・カメラ</b>: <code>workspace:Raycast</code>・<code>GetPartBoundsInRadius</code> などは、パーツの位置と大きさから実際に計算します。<code>camera:WorldToViewportPoint</code> や <code>mouse.Hit</code> もカメラの向きから計算します。</li>
    <li><b>Drawing</b> (Executor): <code>Drawing.new</code> で描いた線・四角・円・文字は、ゲーム画面に重ねてリアルタイムに表示されます (ESP などの確認に)。</li>
    <li>ファイルを長押し → <b>▶ で常にこのファイルを実行</b> を選ぶと、別のファイルを編集中でもそのファイルを実行します。</li>
    <li>無限ループは自動で止まります。<b>■</b> でいつでも停止できます。</li>
  </ul>
  <h3>loadstring と UI ライブラリ</h3>
  <ul>
    <li><code>loadstring(game:HttpGet("URL"))()</code> はそのまま実行できます。Obsidian・LinoriaLib・Orion・Kavo・WindUI などの UI ライブラリも、実際に表示して操作できます。</li>
    <li>読み込んだスクリプトはこの端末に保存され、<b>オフラインでも</b>同じように動きます (設定 → 実行 → 取得した外部スクリプト)。</li>
    <li>エディタに loadstring の行があると、裏でライブラリの中身を読み取り、<b>補完・ゴーストテキスト・ヒント</b>に使います。<code>local Window = </code> と打つと <code>Library:CreateWindow({...})</code> を提案し、<code>Groupbox:AddToggle(</code> では設定項目 (Text・Default・Callback など) の雛形が出ます。</li>
    <li>ブラウザの制限 (CORS) で直接読み込めないサイトは、エラーの下の「中継を使って再実行」か「中身を登録」で使えます。GitHub の URL (<code>github.com/…/blob/…</code>) は自動で読み込める形に直します。</li>
    <li>「…」メニューの <b>UI ライブラリで GUI を作る</b> から、すぐ動くサンプルを作れます。</li>
  </ul>
  <h3>スマホでの操作</h3>
  <ul>
    <li>キーボードの上のバーで、記号・矢印・Tab・元に戻すが入力できます。「選択」をオンにすると矢印で範囲選択できます。</li>
    <li>2 本指でピンチすると文字の大きさを変えられます。</li>
    <li>ファイルやタブを長押しするとメニューが出ます。</li>
    <li>ホーム画面に追加すると、アプリのように全画面で使えます (オフラインでも動作します)。</li>
  </ul>
  <h3>キーボードショートカット (iPad / PC)</h3>
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
    <tr><td><kbd>⌘/Ctrl + B</kbd> / <kbd>⌘/Ctrl + J</kbd></td><td>サイドバー / パネルの表示切り替え</td></tr>
    <tr><td><kbd>Tab</kbd> / <kbd>⌘/Ctrl + →</kbd></td><td>インライン候補を確定 / 1 単語だけ確定</td></tr>
  </table>`
  modal({ title: '使い方', body, wide: true })
}

// バージョンアップ後に 1 度だけ表示する変更点
export function showWhatsNew() {
  const body = h('div', { class: 'help whats-new' })
  body.innerHTML = `
  <p>ForgeCode 8 の新しい機能です。</p>
  <ul>
    <li><b>賢くなった補完</b> — 変数のスコープを正しく見分け、自分で作った関数の戻り値・クラス (<code>setmetatable</code> と <code>self.X</code>)・<code>type</code> 定義・<code>IsA</code> での絞り込みまで型を推論します。大きなファイルでも速さはそのままです。</li>
    <li><b>その場面に合う候補</b> — <code>part.Material = </code> で Enum の一覧、<code>humanoid:ChangeState(</code> で引数の Enum、<code>TweenService:Create(part, info, {</code> でアニメーションできるプロパティ、<code>GetAttribute("</code> で使った属性名。変数は型付きで、近いものから並びます。</li>
    <li><b>ゴーストテキストの強化</b> — <code>frame.Parent = </code> で親にふさわしい ScreenGui / Frame、<code>Instance.new("TextLabel")</code> の次の行で次に設定するプロパティ、<code>mt.__namecall = </code> でフックのひな形、<code>Drawing.new</code> の設定などを提案します。</li>
    <li><b>自動整形</b> — 書き終えた行の空白を整え、入力が止まるとファイル全体の字下げ・空行も裏で直します (エラーがないときだけ。カーソルの行には触れません)。整形した行は一瞬光ります。</li>
    <li><b>実行の強化</b> — <code>Raycast</code>・範囲内のパーツ・<code>WorldToViewportPoint</code>・<code>mouse.Hit</code> を実際に計算。<code>Drawing</code> はゲーム画面にリアルタイムで重ねて表示します。</li>
  </ul>
  <p>ForgeCode 7 の機能:</p>
  <ul>
    <li><b>loadstring がそのまま動く</b> — <code>loadstring(game:HttpGet(URL))()</code> で読み込む Obsidian・LinoriaLib・Orion・Kavo・WindUI などの UI ライブラリを、実際に表示してタップ・ドラッグで操作できます。</li>
    <li><b>本物に近いゲーム画面</b> — GUI の大きさ・位置を Roblox と同じ規則で計算します (UIListLayout・AutomaticSize・ScrollingFrame・UIScale など)。スライダーのドラッグ、文字入力、スクロール、キー入力にも対応。全画面表示もできます。</li>
    <li><b>ライブラリの補完</b> — loadstring の行を書くと、裏でライブラリを読み取って補完に追加します。<code>local Window = </code> → <code>Library:CreateWindow({...})</code>、<code>AddToggle(</code> → 設定項目の雛形、のようにゴーストテキストでも提案します。</li>
    <li><b>オフラインでも実行</b> — 一度読み込んだ外部スクリプトは端末に保存されます。読み込めないサイトは「中継」か「中身を登録」で使えます。</li>
    <li><b>UI ライブラリのサンプル</b> — 「…」メニュー → UI ライブラリで GUI を作る。</li>
    <li><b>実行エンジンの強化</b> — <code>setfenv</code> / <code>getfenv</code>、<code>string.pack</code>、古い Enum 名、TweenService の上書き、Stats、同じエラーのまとめ表示など。</li>
  </ul>`
  modal({ title: '新しくなりました', body, actions: [{ label: '使い方を見る', run: () => { setTimeout(showHelp, 200) } }, { label: 'OK', primary: true }] })
}

command('history', 'ファイルの履歴を表示', p => showHistory(typeof p === 'string' ? p : undefined), { icon: 'history' })
command('help', '使い方を表示', () => showHelp(), { icon: 'book' })
command('whatsNew', '新機能を表示', () => showWhatsNew(), { icon: 'sparkle' })
