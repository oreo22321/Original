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
    <li><b>補完</b>: <code>game:GetService("</code> でサービス名、<code>part.</code> でプロパティ、<code>:</code> でメソッド。自分で作ったテーブルや、<code>require</code> したモジュールの中身も候補に出ます。</li>
    <li><b>インライン候補</b>: 薄い文字の続きは <b>Tab</b> (スマホはキーボードの上の <b>✓</b>) で確定。<code>PlayerAdded:Connect(</code> では引数名 (player) まで入り、同じような行をくり返すと次の行を予測します。</li>
    <li><b>end の自動入力</b>: <code>then</code> / <code>do</code> / <code>function()</code> の後で改行すると <code>end</code> が入ります。</li>
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
  <h3>実行</h3>
  <ul>
    <li>ブラウザ内の Luau 互換エンジンで実行します。<code>game</code>・<code>workspace</code>・<code>Instance.new</code>・<code>task.wait</code>・<code>TweenService</code>・<code>DataStoreService</code>・<code>RemoteEvent</code> など Roblox の API を模擬的に使えます (物理演算や 3D の描画は行いません)。</li>
    <li><b>GUI プレビュー</b>: スクリプトが作った ScreenGui を「ゲーム」タブに表示します。ボタンをタップすると、接続した関数が実行されます。</li>
    <li><b>操作できるもの</b>: ClickDetector・ProximityPrompt・Touched・キー入力に関数を接続していると、「ゲーム」タブから試せます。</li>
    <li>ファイルを長押し → <b>▶ で常にこのファイルを実行</b> を選ぶと、別のファイルを編集中でもそのファイルを実行します。</li>
    <li>無限ループは自動で止まります。<b>■</b> でいつでも停止できます。</li>
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
  <p>ForgeCode 5 は、<b>Roblox の Luau 専用</b>に作り直しました。</p>
  <ul>
    <li><b>Studio / Executor の 2 モード</b> — プロジェクトごとに切り替え (画面下の左端)。Python などの対応は終了しました。</li>
    <li><b>字下げと end の位置を修正</b> — for / while や <code>Connect(function()</code> の中で、改行位置がずれる問題を直しました。</li>
    <li><b>誤字対策</b> — スペルミスに「もしかして」を提案。全角記号や打ち間違いは自動で修正します。</li>
    <li><b>エラーの直し方</b> — 行の右の説明をタップして修正。実行エラーには日本語の解説が付きます。</li>
    <li><b>GUI プレビュー</b> — 作った画面を「ゲーム」タブに表示し、ボタンをタップして試せます。</li>
    <li><b>賢くなった候補</b> — イベントの引数名、自作テーブルやモジュールの中身、次に書く行の予測。</li>
    <li><b>エグゼキューター API を拡充</b> — 180 以上の関数を補完・模擬実行。</li>
    <li><b>より安全な自動保存</b> — 保存前にアプリが閉じても、下書きから復元します。</li>
    <li><b>速くなりました</b> — 読み込むデータを 3 割減らし、▶ を押してすぐ実行が始まります。</li>
  </ul>`
  modal({ title: '新しくなりました', body, actions: [{ label: '使い方を見る', run: () => { setTimeout(showHelp, 200) } }, { label: 'OK', primary: true }] })
}

command('history', 'ファイルの履歴を表示', p => showHistory(typeof p === 'string' ? p : undefined), { icon: 'history' })
command('help', '使い方を表示', () => showHelp(), { icon: 'book' })
command('whatsNew', '新機能を表示', () => showWhatsNew(), { icon: 'sparkle' })
