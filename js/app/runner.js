// 実行パネル: 出力 (コンソール・input・図) / 問題 / デバッグ — Python
import * as vfs from './vfs.js'
import { app, command, refreshFiles, runCommand } from './app.js'
import { getSettings, setSettings, on, emit, isTouch } from './store.js'
import { h, icon, toast, copyText, haptic, menu, modal } from './ui.js'
import { forEachDiagnostic } from '../../vendor/codemirror.js'
import { langOf } from '../editor/setup.js'
import { highlightPython } from '../editor/themes.js'
import { explainError } from './explain.js'
import { DebugPanel, bpStore } from './debug-panel.js'
import { TurtleView } from './turtle-view.js'
import { SurfaceView, SoundPlayer, handleRpc } from './surface.js'

const MAX_DOM_LINES = 3000
// 'File "main.py", line 3' / 'main.py:3' をタップで開けるリンクにする
const LINK_RE = /(File "[^"]+", line \d+|[\w./-]+\.py:\d+)/
const LINK_PARTS = /^(?:File "([^"]+)", line (\d+)|([\w./-]+\.py):(\d+))$/
const PROJECT_DIR = '/home/pyodide/project/'

// プログラムが出した HTML (pandas の表など) を、安全な部分 (表と文字の飾り) だけにする
const SAFE_TAGS = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'COLGROUP', 'COL', 'DIV', 'SPAN', 'P', 'B', 'I', 'STRONG', 'EM', 'BR', 'SMALL', 'CODE', 'PRE', 'SUB', 'SUP', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'HR'])
export function safeHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const copy = (node, out) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) out.append(n.textContent)
      else if (n.nodeType === 1 && SAFE_TAGS.has(n.tagName)) {
        const el = document.createElement(n.tagName.toLowerCase())
        for (const a of ['colspan', 'rowspan']) if (n.hasAttribute(a)) el.setAttribute(a, String(Math.min(1000, parseInt(n.getAttribute(a), 10) || 1)))
        copy(n, el)
        out.append(el)
      } else if (n.nodeType === 1 && !/^(SCRIPT|STYLE|TEMPLATE|IFRAME|OBJECT|EMBED|SVG|MATH|NOSCRIPT)$/.test(n.tagName)) copy(n, out)
    }
  }
  const frag = document.createDocumentFragment()
  copy(doc.body, frag)
  return frag
}

export class Runner {
  constructor(root) {
    this.root = root
    this.worker = null
    this.running = null
    this.tab = 'output'
    this.lineCount = 0
    this.last = null
    this.filter = 'all'
    this.query = ''
    this.problemCount = { error: 0, warning: 0 }
    this.problems = []
    this.taps = new Set()          // 実行結果を受け取る側 (AI エージェントの「実行」など)
    this.seq = 0
    this.evalWaits = new Map()
    this.pyStatus = ''
    this.full = false
    this.surfaces = new Map()
    this.sound = new SoundPlayer()
    this.build()
    // 実行画面 (全画面) は、ブラウザの「戻る」でも閉じられる
    addEventListener('popstate', () => { if (this.full) { this.pushed = false; this.exitFull() } })
    on('docchange', () => this.scheduleProblems())
    on('active', () => this.scheduleProblems(120))
    on('diagnostics', doc => { if (doc && doc.path === app.editors.active) this.scheduleProblems(60) })
    // ▶ を押してすぐ実行できるよう、手が空いたら Python を準備しておく
    setTimeout(() => this.ensureWorker(), 300)
  }

  build() {
    this.tabs = h('div', { class: 'panel-tabs', role: 'tablist' })
    this.actions = h('div', { class: 'panel-actions' })
    this.head = h('div', { class: 'panel-head' }, this.tabs, this.actions)
    this.outEl = h('div', { class: 'output', role: 'log', 'aria-live': 'polite' })
    this.searchEl = h('input', { class: 'input out-search hidden', placeholder: '出力を絞り込み', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
    this.searchEl.addEventListener('input', () => { this.query = this.searchEl.value.toLowerCase(); this.applyQuery() })
    this.consoleEl = this.buildConsole()
    this.outWrap = h('div', { class: 'panel-view out-view' }, this.searchEl, this.outEl, this.consoleEl)
    this.probEl = h('div', { class: 'panel-view problems hidden' })
    this.debugEl = h('div', { class: 'panel-view debug-view hidden' })
    this.debug = new DebugPanel(this, this.debugEl)
    // 全画面の実行画面の上部 (左上に小さな「戻る」)
    this.runTitle = h('span', { class: 'rh-file' })
    this.runState = h('span', { class: 'rh-state' })
    this.runActions = h('div', { class: 'rh-actions' })
    this.runHead = h('div', { class: 'run-head' },
      h('button', { class: 'rh-back', 'aria-label': '戻る', title: '戻る (Esc)', onclick: () => this.exitFull() }, icon('chevronLeft', 18), h('span', null, '戻る')),
      h('div', { class: 'rh-title' }, this.runTitle, this.runState),
      this.runActions)
    this.root.append(this.runHead, this.head, this.outWrap, this.probEl, this.debugEl)
    // 実行中に実行画面を閉じたとき、戻るためのボタン
    this.pill = h('button', { class: 'run-pill hidden', onclick: () => this.enterFull() }, h('span', { class: 'spinner' }), h('span', { class: 'rp-text' }, '実行中'), h('span', { class: 'rp-open' }, '画面を開く'))
    document.body.append(this.pill)
    document.addEventListener('keydown', e => {
      if (!this.full || e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('.modal-overlay, .menu-overlay, .sf-max')) return
      const t = e.target
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName) && t.value) return
      e.preventDefault()
      this.exitFull()
    })
    this.renderTabs()
    this.placeholder()
  }

  renderTabs() {
    const t = (id, label, badge) => h('button', { class: 'panel-tab' + (this.tab === id ? ' active' : ''), role: 'tab', 'aria-selected': this.tab === id ? 'true' : 'false', onclick: () => this.show(id) }, label, badge ? h('span', { class: 'badge ' + (badge.kind || '') }, badge.n) : null)
    this.tabs.textContent = ''
    const pc = this.problemCount
    this.tabs.append(
      t('output', '出力', this.inputPending ? { n: '⌨', kind: 'live' } : null),
      t('problems', '問題', pc.error + pc.warning ? { n: pc.error + pc.warning, kind: pc.error ? 'error' : 'warn' } : null),
      t('debug', 'デバッグ', this.debug.paused ? { n: '⏸', kind: 'paused' } : bpStore.count() ? { n: bpStore.count(), kind: 'bp' } : null),
    )
    this.actions.textContent = ''
    const btn = (ic, title, fn, on) => h('button', { class: 'icon-btn' + (on ? ' on' : ''), title, 'aria-label': title, onclick: fn }, icon(ic, 18))
    const narrow = document.body.dataset.layout === 'mobile'
    if (this.tab === 'output' && narrow) {
      this.actions.append(btn('more', '出力の操作', e => menu([
        { label: this.filter === 'all' ? 'エラーと警告だけ表示' : 'すべて表示', icon: 'filter', run: () => { this.filter = this.filter === 'all' ? 'issues' : 'all'; this.outEl.classList.toggle('only-issues', this.filter !== 'all'); this.renderTabs() } },
        { label: '出力を絞り込み', icon: 'search', run: () => { this.searchEl.classList.remove('hidden'); this.searchEl.focus() } },
        { label: '出力をコピー', icon: 'copy', run: () => copyText(this.outputText()).then(() => toast('出力をコピーしました', { icon: 'copy' })) },
        { label: 'クリア', icon: 'trash', run: () => this.clear() },
        { label: 'Python を再起動', icon: 'refresh', run: () => this.restartPython() },
      ], e.currentTarget, { title: '出力' }), this.filter !== 'all'))
    } else if (this.tab === 'output') {
      this.actions.append(
        btn('filter', this.filter === 'all' ? 'エラーと警告だけ表示' : 'すべて表示', () => { this.filter = this.filter === 'all' ? 'issues' : 'all'; this.outEl.classList.toggle('only-issues', this.filter !== 'all'); this.renderTabs() }, this.filter !== 'all'),
        btn('search', '出力を絞り込み', () => { this.searchEl.classList.toggle('hidden'); if (this.searchEl.classList.contains('hidden')) { this.searchEl.value = ''; this.query = ''; this.applyQuery() } else this.searchEl.focus(); this.renderTabs() }, !this.searchEl.classList.contains('hidden')),
        btn('copy', '出力をコピー', () => copyText(this.outputText()).then(() => toast('出力をコピーしました', { icon: 'copy' }))),
        btn('refresh', 'Python を再起動 (変数をすべて消す)', () => this.restartPython()),
        btn('trash', 'クリア', () => this.clear()))
    }
    this.actions.append(btn('close', 'パネルを閉じる', () => runCommand('togglePanel', false)))
  }

  show(tab) {
    this.tab = tab
    this.outWrap.classList.toggle('hidden', tab !== 'output')
    this.probEl.classList.toggle('hidden', tab !== 'problems')
    this.debugEl.classList.toggle('hidden', tab !== 'debug')
    if (tab === 'debug') this.debug.render()
    if (tab === 'problems') this.renderProblems()
    this.renderTabs()
  }

  placeholder() {
    if (this.lineCount) return
    this.outEl.textContent = ''
    this.outEl.append(h('div', { class: 'out-hint' }, isTouch ? '▶ ボタンで実行すると、ここに結果が表示されます' : '▶ ボタン (⌘/Ctrl + Enter) で実行すると、ここに結果が表示されます'))
  }

  clear() {
    this.outEl.textContent = ''
    this.lineCount = 0
    this.last = null
    this.holdScroll = false
    this.inputRow = null
    if (this.turtle) { this.turtle.finish(); this.turtle = null }
    this.imgKeys = new Map()
    this.endSurfaces()
    this.surfaces = new Map()
    if (this.tk) { this.tk.destroyAll(); this.tk = null }
    this.placeholder()
  }

  outputText() {
    return [...this.outEl.querySelectorAll('.out-line, .out-error, .out-html')].map(el => el.dataset.text || el.innerText).join('\n')
  }

  applyQuery() {
    const q = this.query
    for (const el of this.outEl.children) el.classList.toggle('q-hide', !!q && !(el.dataset.text || el.textContent).toLowerCase().includes(q))
  }

  // ファイルの行をタップで開けるリンクにする
  linkify(el, text) {
    text = String(text)
    // 長い行や、ファイルの場所がない行はそのまま (正規表現が遅くならないように)
    if (text.length > 4000 || !(text.includes('.py') || text.includes('File "'))) { if (text) el.append(text); return }
    for (const p of text.split(LINK_RE)) {
      const m = LINK_PARTS.exec(p)
      let file = m && (m[1] || m[3])
      if (file && file.startsWith(PROJECT_DIR)) file = file.slice(PROJECT_DIR.length)
      if (m && app.files.some(f => f.path === file)) {
        el.append(h('a', { class: 'out-link', href: '#', onclick: e => { e.preventDefault(); this.exitFull(); app.editors.open(file, { line: Number(m[2] || m[4]) }) } }, p))
      } else if (p) el.append(p)
    }
  }

  makeLine(kind, text) {
    const el = h('div', { class: 'out-line ' + kind })
    el.dataset.text = text
    const body = h('span', { class: 'out-text' })
    // とても長い行は先頭だけ表示して、タップで全部 (コピーでは全部)
    const LONG = 20000
    if (text.length > LONG) {
      body.append(text.slice(0, LONG))
      const more = h('button', { class: 'btn small ghost out-more', onclick: () => { more.remove(); body.append(text.slice(LONG)) } }, `… 続きを表示 (${(text.length - LONG).toLocaleString()} 文字)`)
      body.append(more)
    } else if (kind === 'input' && text.length < 4000) { body.classList.add('hx'); body.append(highlightPython(text)) }
    else this.linkify(body, text)
    el.append(body)
    if (this.query && !text.toLowerCase().includes(this.query)) el.classList.add('q-hide')
    return el
  }

  // まとめて追加 (1 行ずつ DOM を触らない)
  append(items) {
    if (!items.length) return
    if (!this.lineCount) this.outEl.textContent = ''
    const out = this.outEl
    const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 60
    const group = getSettings().groupOutput
    const frag = document.createDocumentFragment()
    for (const it of items) {
      const kind = it.kind === 'error-text' ? 'stderr' : it.kind
      const last = this.last
      // 改行のない行 (input の案内・end="" の print) の続きは、同じ行につなげる (入力した文字も、案内の横に)
      if (last && last.partial && last.el.isConnected && (kind === 'input-echo' || kind === last.kind)) {
        const body = last.el.querySelector('.out-text')
        if (kind === 'input-echo') body.append(h('span', { class: 'out-echo' }, it.text))
        else this.linkify(body, it.text)
        last.text += it.text
        last.el.dataset.text = last.text
        last.partial = kind === 'input-echo' ? false : !!it.partial
        continue
      }
      if (group && last && last.kind === kind && last.text === it.text && !it.partial) {
        last.n++
        if (!last.badge) { last.badge = h('span', { class: 'out-count' }); last.el.append(last.badge) }
        last.badge.textContent = '×' + last.n
        continue
      }
      const el = this.makeLine(kind, it.text)
      if (items.length > 20) el.classList.add('no-anim')
      frag.append(el)
      this.lineCount++
      this.last = { kind, text: it.text, el, n: 1, badge: null, partial: !!it.partial }
    }
    // 入力欄があれば、その手前に入れる
    if (this.inputRow && this.inputRow.parentElement === out) out.insertBefore(frag, this.inputRow)
    else out.append(frag)
    let extra = out.childElementCount - MAX_DOM_LINES
    while (extra-- > 0) out.firstElementChild.remove()
    if (atBottom && !this.holdScroll) out.scrollTop = out.scrollHeight
  }

  line(kind, text) {
    this.append([{ kind, text }])
    return this.last ? this.last.el : null
  }

  // ============================================================
  // Python (ワーカー)
  // ============================================================
  ensureWorker() {
    if (this.worker) return this.worker
    let w
    try { w = new Worker(new URL('../workers/python-worker.js', import.meta.url), { type: 'module' }) } catch (e) {
      this.line('error', 'Python を起動できませんでした: ' + (e && e.message || e))
      return null
    }
    // 共有メモリ (input() と停止に使う)。使えない環境では、停止はワーカーごと止める
    if (self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined') {
      this.shared = { interrupt: new SharedArrayBuffer(4), ctl: new SharedArrayBuffer(8), buf: new SharedArrayBuffer(64 * 1024), dctl: new SharedArrayBuffer(8), dbuf: new SharedArrayBuffer(256 * 1024), ectl: new SharedArrayBuffer(8), ebuf: new SharedArrayBuffer(64 * 1024), fack: new SharedArrayBuffer(8) }
    } else this.shared = null
    w.onmessage = e => { if (this.worker === w) this.onMessage(e.data) }
    w.onerror = e => {
      if (e && e.preventDefault) e.preventDefault()
      if (this.worker !== w) return
      this.worker = null
      if (this.running) { this.line('error', 'Python でエラーが発生しました: ' + (e.message || '')); this.finished('error') }
    }
    w.postMessage({ type: 'init', ...(this.shared || {}) })
    this.worker = w
    return w
  }

  resetWorker() {
    if (this.worker) { try { this.worker.terminate() } catch {} this.worker = null }
    this.inputPending = false
    this.removeInput()
    setTimeout(() => this.ensureWorker(), 300)
  }

  restartPython() {
    if (this.running) this.stop(true)
    this.resetWorker()
    this.line('meta', 'Python を再起動しました (変数をすべて消しました)')
  }

  runTarget() {
    const p = app.project
    return p && p.runTarget && app.files.some(f => f.path === p.runTarget && !f.dir) ? p.runTarget : null
  }

  // 実行に渡すファイル (開いているファイルは編集中の内容)
  filesPayload() {
    const files = {}
    for (const f of app.files) {
      if (f.dir) continue
      const content = app.editors.docs.has(f.path) ? app.editors.docs.get(f.path).state.doc.toString() : app.contents.get(f.path)
      if (content !== undefined && content !== null && content.length < 2_000_000) files[f.path] = content
    }
    return files
  }

  async run({ selection = false, path: forcePath = null, agent = false, debug = false, source: forceSource = null } = {}) {
    const doc = app.editors.activeDoc()
    const s = getSettings()
    let path = null, source = null
    this.scratchId = 0
    if (forceSource !== null) {
      // AI が作ったコードを試す (プロジェクトのファイルは変えない)
      path = '_forge_ai_check.py'
      source = forceSource
    } else if (selection) {
      const v = app.editors.activeView()
      if (!v || !doc || doc.lang !== 'python' || v.state.selection.main.empty) { toast('実行したい部分を選択してください'); return }
      path = doc.path
      // 行番号がずれないよう、選択より前は空行にする
      const sel = v.state.selection.main
      const fromLine = v.state.doc.lineAt(sel.from)
      const text = v.state.sliceDoc(fromLine.from, sel.to)
      // 選択の字下げをそろえる
      const ind = Math.min(...text.split('\n').filter(l => l.trim()).map(l => /^[ \t]*/.exec(l)[0].length))
      source = '\n'.repeat(fromLine.number - 1) + text.split('\n').map(l => l.slice(Math.min(ind, /^[ \t]*/.exec(l)[0].length))).join('\n')
    } else {
      const target = forcePath && app.files.some(f => f.path === forcePath && !f.dir) ? forcePath : this.runTarget()
      if (target) path = target
      else if (doc && doc.lang === 'python') path = doc.path
      else if (doc && doc.lang === 'markdown') { app.editors.togglePreview(true); return }
      else {
        const main = app.files.find(f => !f.dir && /(^|\/)main\.py$/.test(f.path)) || app.files.find(f => !f.dir && langOf(f.path) === 'python')
        if (!main) { toast('実行する Python のファイル (.py) がありません'); return }
        path = main.path
      }
      const open = app.editors.docs.get(path)
      source = open ? open.state.doc.toString() : app.contents.get(path)
      if (source === undefined) source = (await vfs.readFile(app.project.id, path)) || ''
    }
    if (this.running) this.stop(true)
    app.editors.saveAll().catch(() => {})
    if (!agent) {
      if (this.useFull(debug)) this.enterFull()
      else runCommand('togglePanel', true)
      if (this.tab !== 'output') this.show('output')
    }
    if (s.clearOnRun) this.clear()
    haptic(10)
    app.editors.clearRunErrors()
    const files = this.filesPayload()
    files[path] = source
    const w = this.ensureWorker()
    if (!w) return
    this.errors = 0
    this.holdScroll = false
    if (this.turtle) this.turtle.flushAll()
    this.turtle = null
    this.imgKeys = new Map()
    this.endSurfaces()
    this.surfaces = new Map()
    this.tk = null
    this.sound.stopAll()
    this.runPath = path
    this.runSelection = !!selection
    this.lastReason = null
    this.eq = []
    if (this.shared) Atomics.store(new Int32Array(this.shared.ectl), 0, 0)
    const id = ++this.seq
    this.runId = id
    if (forceSource !== null) this.scratchId = id
    // ブレークポイントがあれば、そこで止まる (なくても ⏸ や breakpoint() で途中から止められる)
    const bps = agent ? {} : bpStore.forRun()
    const hasBps = Object.keys(bps).length > 0
    this.dq = []
    if (this.shared) Atomics.store(new Int32Array(this.shared.dctl), 0, 0)
    if ((debug || hasBps) && !this.shared) this.append([{ kind: 'warn', text: 'デバッガーを使うには、ページを再読み込みしてください (はじめて開いたときは再読み込みが必要です)' }])
    this.setRunning({ path, id, debug: !!this.shared && (debug || hasBps) })
    this.t0 = performance.now()
    this.startWatchdog(id)
    this.append([{ kind: 'meta', text: `実行: ${path}${selection ? ' (選択範囲)' : ''}` }])
    if (!this.pyReady) this.append([{ kind: 'meta', text: 'Python を準備しています… (初回は少し時間がかかります)' }])
    this.renderTabs()
    if (this.shared) new Int32Array(this.shared.interrupt)[0] = 0
    w.postMessage({ type: 'run', id, files, entry: path, debug: this.shared ? { bps, watches: this.debug.watches } : null })
  }

  // ============================================================
  // 入力 (input()) — 出力の下に入力欄を出す
  // ============================================================
  showInput(password = false) {
    this.removeInput()
    this.inputPending = true
    const field = h('input', { class: 'input out-input-field', type: password ? 'password' : 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'send', 'aria-label': password ? 'パスワードの入力' : 'プログラムへの入力' })
    const send = (eof = false) => {
      if (!this.shared || !this.inputPending) return
      const ctl = new Int32Array(this.shared.ctl)
      const bytes = new TextEncoder().encode(field.value)
      const buf = new Uint8Array(this.shared.buf)
      const n = Math.min(bytes.length, buf.length)
      buf.set(bytes.subarray(0, n))
      Atomics.store(ctl, 1, n)
      Atomics.store(ctl, 0, eof ? 2 : 1)
      Atomics.notify(ctl, 0)
      if (!eof) this.append([{ kind: 'input-echo', text: password ? '•'.repeat(Math.min(12, field.value.length)) : field.value }])
      this.inputPending = false
      this.removeInput()
      this.renderTabs()
    }
    field.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send() } })
    this.inputRow = h('div', { class: 'out-input' }, icon('keyboard', 15), field,
      h('button', { class: 'btn small primary', onclick: () => send() }, '送る'),
      h('button', { class: 'btn small ghost', title: '入力を終える (EOF)', onclick: () => send(true) }, '終わり'))
    this.outEl.append(this.inputRow)
    this.outEl.scrollTop = this.outEl.scrollHeight
    if (this.useFull()) this.enterFull()
    else runCommand('togglePanel', true)
    if (this.tab !== 'output') this.show('output')
    this.renderTabs()
    this.updateRunHead()
    setTimeout(() => field.focus(), 30)
  }
  removeInput() {
    if (this.inputRow) { this.inputRow.remove(); this.inputRow = null }
  }

  // ============================================================
  // コンソール: 最後に実行したプログラムの続きで、式や文を試す
  // ============================================================
  buildConsole() {
    const input = h('input', { class: 'console-input', placeholder: document.body.dataset.layout === 'mobile' ? '式やコードを入力 (例: 1 + 2)' : 'Python の式やコードを入力して Enter (例: 1 + 2, len(names))', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'コンソール' })
    this.history = (() => { try { return JSON.parse(localStorage.getItem('forgecode.consoleHistory') || '[]') } catch { return [] } })()
    let hi = -1
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        const code = input.value.trim()
        if (!code) return
        input.value = ''
        hi = -1
        this.history = [code, ...this.history.filter(x => x !== code)].slice(0, 50)
        try { localStorage.setItem('forgecode.consoleHistory', JSON.stringify(this.history)) } catch {}
        this.evalConsole(code)
      } else if (e.key === 'ArrowUp' && this.history.length) {
        e.preventDefault(); hi = Math.min(this.history.length - 1, hi + 1); input.value = this.history[hi]
      } else if (e.key === 'ArrowDown') {
        e.preventDefault(); hi = Math.max(-1, hi - 1); input.value = hi < 0 ? '' : this.history[hi]
      }
    })
    this.consoleInput = input
    return h('div', { class: 'console-row' }, h('span', { class: 'console-prompt' }, '>>>'), input,
      h('button', { class: 'icon-btn sm', title: '実行', 'aria-label': '実行', onclick: () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) }, icon('send', 16)))
  }

  evalConsole(code) {
    const w = this.ensureWorker()
    if (!w) return
    this.append([{ kind: 'input', text: code }])
    this.outEl.scrollTop = this.outEl.scrollHeight
    const id = ++this.seq
    // 一時停止中は、止まっている場所の変数で実行する
    if (this.debug.paused && this.sendDebug({ type: 'eval', id, code })) return
    if (this.running) { this.append([{ kind: 'warn', text: '実行中はコンソールを使えません (⏸ で一時停止すると、その場所の変数で試せます)' }]); return }
    w.postMessage({ type: 'eval', id, code })
  }

  debugValue(expr) { return this.debug.valueFor(expr) }

  // デバッガーへの指示 (共有メモリで渡す。走っている途中ならシグナルで知らせる)
  sendDebug(cmd) {
    if (!this.shared || !this.running) return false
    this.dq = this.dq || []
    this.dq.push(cmd)
    this.pumpDebug()
    return true
  }
  pumpDebug() {
    clearTimeout(this.dqTimer)
    if (!this.shared || !this.running) { this.dq = []; return }
    const ctl = new Int32Array(this.shared.dctl)
    while (this.dq.length && Atomics.load(ctl, 0) === 0) {
      const bytes = new TextEncoder().encode(JSON.stringify(this.dq.shift()))
      const buf = new Uint8Array(this.shared.dbuf)
      if (bytes.length > buf.length) continue
      buf.set(bytes)
      Atomics.store(ctl, 1, bytes.length)
      Atomics.store(ctl, 0, 1)
      Atomics.notify(ctl, 0)
      if (!this.debug.paused) { const ib = new Int32Array(this.shared.interrupt); if (ib[0] === 0) { ib[0] = 10; Atomics.notify(ib, 0) } }
    }
    if (this.dq.length) this.dqTimer = setTimeout(() => this.pumpDebug(), 30)
  }

  setRunning(info) {
    this.running = info
    if (!info) clearInterval(this.watchdog)
    emit('running', info)
    this.updateRunHead()
  }

  // 最大実行時間 (設定)。入力待ち・一時停止の間は数えない
  startWatchdog(id) {
    clearInterval(this.watchdog)
    let used = 0, last = performance.now()
    this.watchdog = setInterval(() => {
      const now = performance.now()
      const limit = getSettings().maxRunTime
      if (!this.running || this.runId !== id) { clearInterval(this.watchdog); return }
      if (!this.inputPending && !this.debug.paused) used += now - last
      last = now
      if (limit > 0 && used > limit * 1000) {
        clearInterval(this.watchdog)
        this.append([{ kind: 'warn', text: `最大実行時間 (${limit} 秒) を超えたので止めました (設定の「最大実行時間」で変えられます)` }])
        this.stop()
      }
    }, 250)
  }

  finished(reason, ms) {
    this.debug.onFinished()
    if (this.turtle) { this.turtle.finish(); this.turtle.el.classList.remove('sf-sticky') }
    this.endSurfaces()
    this.sound.stopAll()
    this.lastReason = reason
    this.lastSec = ((ms !== undefined ? ms : performance.now() - this.t0) / 1000)
    this.eq = []
    this.inputPending = false
    this.removeInput()
    const sec = ((ms !== undefined ? ms : performance.now() - this.t0) / 1000).toFixed(2)
    const msg = reason === 'stopped' ? `■ 停止しました (${sec} 秒)` : reason === 'error' ? `✕ エラーで終了 (${sec} 秒)` : reason === 'load' ? '✕ Python を読み込めませんでした' : `✓ 完了 (${sec} 秒)`
    this.append([{ kind: reason === 'error' || reason === 'load' ? 'meta error' : 'meta', text: msg }])
    this.setRunning(null)
    this.renderTabs()
    this.updateRunHead()
  }

  onMessage(m) {
    if (this.taps.size) for (const t of this.taps) { try { t(m) } catch {} }
    switch (m.type) {
      case 'status':
        if (m.state === 'ready') { this.pyReady = true; this.pyStatus = m.text; emit('python', m) }
        else if (m.state === 'error') { this.line('error', m.text) }
        break
      case 'output': this.append(m.items); break
      case 'paused':
        if (!this.running) break
        if (!this.running.debug) this.running.debug = true
        this.debug.onPaused(m)
        break
      case 'resumed': if (this.debug.paused) this.debug.onResumed(); break
      case 'expanded': this.debug.onExpanded(m); break
      case 'watchValues': this.debug.onWatchValues(m); break
      case 'input': this.showInput(!!m.password); break
      case 'inputDone': if (this.inputPending) { this.inputPending = false; this.removeInput(); this.renderTabs() } break
      case 'image': this.showImage(m.data, m.key, m.mime); break
      case 'html': this.showHtml(m.html, m.text); break
      case 'link': this.showLink(m.url); break
      case 'turtle': this.showTurtle(m.ops); break
      case 'frame': this.showFrame(m); break
      case 'surface': this.onSurface(m); break
      case 'rpc': handleRpc(m); break
      case 'sound': this.sound.handle(m); break
      case 'tk': this.showTk(m.ops); break
      case 'evTaken': this.pumpEvents(); break
      case 'evalResult':
        if (m.ok) { if (m.html) this.showHtml(m.html, m.value); else if (m.value !== null && m.value !== undefined) this.append([{ kind: 'result', text: m.value }]) }
        else this.append([{ kind: 'error', text: m.error }])
        break
      case 'done':
        if (m.id !== this.runId) break
        if (m.id !== this.scratchId) this.applyFiles(m.files)
        if (m.error) this.showError(m.error)
        else if (m.reason === 'load') this.line('error', m.error || 'Python を読み込めませんでした')
        if (this.running) this.finished(m.reason === 'exit' ? 'done' : m.reason, m.ms)
        break
    }
  }

  // プログラムが作った・変えたファイルを、プロジェクトに反映する
  async applyFiles(files) {
    if (!files || !app.project) return
    const entries = Object.entries(files)
    if (!entries.length) return
    const names = []
    for (const [path, text] of entries) {
      const d = app.editors.docs.get(path)
      if (d && d.dirty) continue // 編集中のファイルは上書きしない
      try {
        if (text === null) { await vfs.remove(app.project.id, path); continue }
        await vfs.writeFile(app.project.id, path, text)
        app.contents.set(path, text)
        if (app.editors.has(path)) app.editors.externalChange(path, text)
        names.push(path)
      } catch {}
    }
    await refreshFiles()
    if (names.length) this.line('meta', `プログラムが書いたファイル: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` ほか ${names.length - 5} 個` : ''}`)
  }

  // 出力に、行ではないもの (図・表・turtle の画面) を入れる
  appendBlock(el) {
    if (!this.lineCount) this.outEl.textContent = ''
    const out = this.outEl
    const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 80
    if (this.inputRow && this.inputRow.parentElement === out) out.insertBefore(el, this.inputRow)
    else out.append(el)
    this.lineCount++
    this.last = null
    if (atBottom && !this.holdScroll) out.scrollTop = out.scrollHeight
  }

  showImage(b64, key = null, mime = 'image/png') {
    const src = `data:${mime || 'image/png'};base64,` + b64
    // plt.pause() で描き直した図は、同じ場所で差し替える
    const prev = key && this.imgKeys && this.imgKeys.get(key)
    if (prev && prev.isConnected) { prev.src = src; return }
    const img = h('img', { class: 'out-image', src, alt: '図', onclick: () => modal({ title: '図', wide: true, body: h('img', { class: 'out-image-full', src: img.src, alt: '図' }), actions: [{ label: '保存', run: () => { const a = h('a', { href: img.src, download: mime === 'image/svg+xml' ? 'figure.svg' : 'figure.png' }); a.click(); return false } }, { label: '閉じる', primary: true, value: null }] }) })
    if (key) { if (!this.imgKeys) this.imgKeys = new Map(); this.imgKeys.set(key, img) }
    this.appendBlock(h('div', { class: 'out-figure' }, img))
    img.addEventListener('load', () => { if (!this.holdScroll) this.outEl.scrollTop = this.outEl.scrollHeight })
  }

  // pandas の表など (安全な HTML だけ)
  showHtml(html, text = '') {
    let frag
    try { frag = safeHtml(html) } catch { this.append([{ kind: 'result', text: text || html }]); return }
    const el = h('div', { class: 'out-html' }, frag)
    el.dataset.text = text || el.textContent
    this.appendBlock(el)
  }

  showLink(url) {
    let u
    try { u = new URL(url) } catch {}
    if (!u || !/^https?:$/.test(u.protocol)) { this.append([{ kind: 'meta', text: 'webbrowser: ' + url }]); return }
    const el = h('div', { class: 'out-line meta out-weblink' }, icon('link', 14), h('a', { href: u.href, target: '_blank', rel: 'noopener noreferrer' }, u.href))
    el.dataset.text = u.href
    this.appendBlock(el)
  }

  // turtle: 実行ごとに 1 つの画面
  showTurtle(json) {
    let ops
    try { ops = JSON.parse(json) } catch { return }
    if (!this.turtle) {
      this.turtle = new TurtleView(ev => this.sendEvent(ev))
      this.turtle.live = !!this.running
      this.appendBlock(this.turtle.el)
      // 絵は出力の上に留めて、あとの出力 (print) はその下に流す
      if (this.running) this.pin(this.turtle.el)
    }
    this.turtle.push(ops)
  }

  // turtle のキー操作・クリック → 共有メモリ → Python
  sendEvent(ev) {
    if (!this.shared || !this.running) return
    this.eq = this.eq || []
    if (this.eq.length < 200) this.eq.push(ev)
    this.pumpEvents()
  }
  pumpEvents() {
    clearTimeout(this.eqTimer)
    if (!this.shared || !this.running || !this.eq || !this.eq.length) return
    const ctl = new Int32Array(this.shared.ectl)
    if (Atomics.load(ctl, 0) === 0) {
      const bytes = new TextEncoder().encode(JSON.stringify(this.eq.splice(0)))
      const buf = new Uint8Array(this.shared.ebuf)
      if (bytes.length <= buf.length) {
        buf.set(bytes)
        Atomics.store(ctl, 1, bytes.length)
        Atomics.store(ctl, 0, 1)
        Atomics.notify(ctl, 0)
      }
    } else this.eqTimer = setTimeout(() => this.pumpEvents(), 40)
  }

  // ============================================================
  // 図・ゲームの画面 (1 つのキャンバスで描き直す)
  // ============================================================
  showFrame(m) {
    let sv = this.surfaces.get(m.key)
    if (!sv || !sv.el.isConnected) {
      sv = new SurfaceView({ key: m.key, kind: m.kind || 'fig', onEvent: ev => this.sendEvent(ev), ack: seq => this.ackFrame(seq) })
      sv.live = !!this.running
      this.surfaces.set(m.key, sv)
      this.appendBlock(sv.el)
      if (sv.kind === 'pg' && this.running) this.pin(sv.el)
      if (sv.kind === 'pg' && this.pgKeys) sv.setKeys(this.pgKeys)
    } else if (sv.frames === 1 && this.running) this.pin(sv.el) // 2 枚目が来た = 動いている図
    sv.frame(m)
  }
  ackFrame(seq) {
    if (!this.shared || !this.shared.fack) return
    const a = new Int32Array(this.shared.fack)
    if (seq > Atomics.load(a, 0)) { Atomics.store(a, 0, seq); Atomics.notify(a, 0) }
  }
  // 動いている絵は、出力の上に留める (print はその下に流れる)
  pin(el) {
    for (const x of this.outEl.querySelectorAll('.sf-sticky')) if (x !== el) x.classList.remove('sf-sticky')
    el.classList.add('sf-sticky')
  }
  onSurface(m) {
    if (m.op === 'keys') {
      this.pgKeys = m.keys || []
      for (const sv of this.surfaces.values()) if (sv.kind === 'pg') sv.setKeys(this.pgKeys)
    } else if (m.op === 'close') {
      const sv = this.surfaces.get(m.key)
      if (sv) sv.finish()
    } else if (m.op === 'caption') {
      const sv = this.surfaces.get(m.key)
      if (sv) sv.title = m.title
      if (this.full) this.runTitle.textContent = m.title || this.runTitle.textContent
    }
  }
  endSurfaces() {
    this.pgKeys = null
    for (const sv of this.surfaces.values()) sv.finish()
    if (this.tk) this.tk.finish()
  }
  // tkinter の画面
  async showTk(ops) {
    if (!this.tk || !this.tk.el.isConnected) {
      const { TkView } = await import('./tk-view.js')
      if (!this.tk || !this.tk.el.isConnected) {
        this.tk = new TkView(ev => this.sendEvent(ev))
        this.tk.live = !!this.running
        this.appendBlock(this.tk.el)
      }
    }
    this.tk.push(ops)
  }

  // ============================================================
  // 全画面の実行画面
  // ============================================================
  useFull(debug = false) {
    const mode = getSettings().runView || 'full'
    if (mode !== 'full' || debug || (this.debug && this.debug.paused)) return false
    return !(this.running && this.running.debug)
  }
  enterFull() {
    if (this.full) { this.updateRunHead(); return }
    this.full = true
    this.wasPanelOpen = !!(app.wb && app.wb.panelOpen)
    this.root.classList.add('run-full')
    document.body.classList.add('run-full-open')
    if (this.tab !== 'output') this.show('output')
    this.updateRunHead()
    try { history.pushState({ fcRun: 1 }, ''); this.pushed = true } catch {}
    requestAnimationFrame(() => { this.root.classList.add('run-full-in') })
  }
  exitFull() {
    if (!this.full) return
    this.full = false
    this.root.classList.remove('run-full', 'run-full-in')
    document.body.classList.remove('run-full-open')
    for (const sv of this.surfaces.values()) sv.toggleMax(false)
    if (app.wb) { app.wb.panelOpen = false; app.wb.togglePanel(this.wasPanelOpen && document.body.dataset.layout !== 'mobile') }
    if (this.pushed) { this.pushed = false; try { if (history.state && history.state.fcRun) history.back() } catch {} }
    this.updateRunHead()
    const v = app.editors && app.editors.activeView()
    if (v && document.body.dataset.layout !== 'mobile') setTimeout(() => v.focus(), 60)
  }
  updateRunHead() {
    if (!this.runHead) return
    const running = this.running
    this.pill.classList.toggle('hidden', !running || this.full || (getSettings().runView || 'full') !== 'full')
    const pt = this.pill.querySelector('.rp-text')
    if (pt) pt.textContent = this.inputPending ? '入力待ち' : '実行中'
    if (!this.full) return
    if (this.consoleInput) this.consoleInput.placeholder = innerWidth < 600 ? '式やコードを入力 (例: 1 + 2)' : 'Python の式やコードを入力して Enter (例: 1 + 2, len(names))'
    this.runTitle.textContent = this.runPath ? vfs.basename(this.runPath) + (this.runSelection ? ' (選択範囲)' : '') : '実行'
    this.runState.className = 'rh-state'
    this.runState.textContent = ''
    if (running) {
      this.runState.classList.add(this.inputPending ? 'wait' : 'run')
      this.runState.append(h('span', { class: 'spinner' }), this.inputPending ? '入力待ち' : '実行中')
    } else if (this.lastReason) {
      const r = this.lastReason
      this.runState.classList.add(r === 'error' || r === 'load' ? 'err' : r === 'stopped' ? 'stop' : 'ok')
      this.runState.append(r === 'error' || r === 'load' ? '✕ エラー' : r === 'stopped' ? '■ 停止' : '✓ 完了', h('span', { class: 'rh-sec' }, ` ${(this.lastSec || 0).toFixed(2)} 秒`))
    }
    this.runActions.textContent = ''
    const btn = (ic, title, fn, cls = '') => h('button', { class: 'icon-btn ' + cls, title, 'aria-label': title, onclick: fn }, icon(ic, 18))
    if (running) this.runActions.append(h('button', { class: 'run-btn stop', title: '停止', 'aria-label': '停止', onclick: () => runCommand('stop') }, icon('stop', 16), h('span', null, '停止')))
    else this.runActions.append(h('button', { class: 'run-btn', title: 'もう一度実行', 'aria-label': 'もう一度実行', onclick: () => this.rerun() }, icon('refresh', 16), h('span', null, 'もう一度')))
    this.runActions.append(btn('more', 'その他', e => menu([
      { label: '出力をコピー', icon: 'copy', run: () => copyText(this.outputText()).then(() => toast('出力をコピーしました', { icon: 'copy' })) },
      { label: 'クリア', icon: 'trash', run: () => this.clear(), disabled: !!running },
      { label: 'エラーと警告だけ表示', icon: 'filter', checked: this.filter !== 'all', run: () => { this.filter = this.filter === 'all' ? 'issues' : 'all'; this.outEl.classList.toggle('only-issues', this.filter !== 'all'); this.renderTabs() } },
      { label: 'Python を再起動', icon: 'refresh', run: () => this.restartPython() },
      '-',
      { label: '実行結果を下のパネルに出す (全画面にしない)', icon: 'terminal', run: () => { setSettings({ runView: 'panel' }); this.exitFull(); runCommand('togglePanel', true); toast('実行結果は下のパネルに出します (設定 → 実行 で戻せます)') } },
    ], e.currentTarget, { title: '実行' })))
  }
  rerun() {
    const p = this.runPath
    if (this.runSelection) { this.exitFull(); return }
    this.run(p ? { path: p } : {})
  }

  showError(err) {
    this.errors++
    const s = getSettings()
    // いちばん内側 (最後) のプロジェクト内の場所
    const frames = (err.frames || []).filter(f => app.files.some(x => x.path === f.file))
    const at = err.syntax && err.file ? { file: err.file, line: err.line } : frames.length ? frames[frames.length - 1] : null
    const title = `${err.type}: ${err.message}`
    const el = h('div', { class: 'out-error' })
    el.dataset.text = err.text || title
    const head = h('div', { class: 'oe-head' }, icon('close', 15))
    const msg = h('span', { class: 'oe-msg' })
    this.linkify(msg, at ? `${title}  (${at.file}:${at.line})` : title)
    head.append(msg)
    el.append(head)
    if (err.syntax && err.text && err.text.includes('^')) {
      el.append(h('pre', { class: 'oe-code' }, err.text.split('\n').slice(-4).join('\n')))
    }
    const ex = s.explainErrors ? explainError(err) : null
    if (ex) {
      el.append(h('div', { class: 'oe-why' }, icon('info', 14), h('span', null, ex.why)))
      if (ex.fixes.length) el.append(h('ul', { class: 'oe-fixes' }, ex.fixes.map(f => h('li', null, f))))
    }
    if (frames.length > 1 || (err.frames || []).length > frames.length) {
      const tb = h('details', { class: 'oe-trace' }, h('summary', null, `トレースバック (${(err.frames || []).length})`))
      const pre = h('div', { class: 'oe-tb' })
      for (const f of err.frames || []) {
        const row = h('div', { class: 'oe-frame' })
        this.linkify(row, `File "${f.file}", line ${f.line}, in ${f.name}`)
        if (f.code) row.append(h('div', { class: 'oe-frame-code' }, f.code))
        pre.append(row)
      }
      tb.append(pre)
      el.append(tb)
    }
    const acts = h('div', { class: 'oe-actions' })
    if (at) acts.append(h('button', { class: 'btn small', onclick: () => { this.exitFull(); app.editors.open(at.file, { line: at.line }) } }, `${at.line} 行目へ`))
    acts.append(h('button', { class: 'btn small ghost', onclick: () => copyText(err.text || title).then(() => toast('エラーをコピーしました', { icon: 'copy' })) }, 'コピー'))
    acts.append(h('button', { class: 'btn small ai-fix', onclick: () => { this.exitFull(); runCommand('aiFixRunError', err.text || title) } }, icon('sparkle', 14), 'AI で直す'))
    el.append(acts)
    if (!this.lineCount) this.outEl.textContent = ''
    const out = this.outEl
    if (this.inputRow && this.inputRow.parentElement === out) out.insertBefore(el, this.inputRow)
    else out.append(el)
    this.lineCount++
    this.last = null
    if (at) app.editors.markRunError(at.file, at.line, title)
    if (at) this.aiFixFor(err, el, at)
    if (this.tab !== 'output') this.show('output')
    if (!this.holdScroll) { this.holdScroll = true; requestAnimationFrame(() => { out.scrollTop = Math.max(0, el.offsetTop - out.offsetTop - 6) }) }
  }

  // 端末内 AI に任せる設定なら、エラーの直し方を AI に考えてもらい、確かめた直し方だけ出す
  async aiFixFor(err, el, at) {
    let mod
    try { mod = await import('./ai-assist.js') } catch { return }
    if (!mod.assistOn()) return
    const doc = app.editors.docs.get(at.file)
    const code = doc ? doc.state.doc.toString() : app.contents.get(at.file)
    if (!code) return
    const label = h('span', null, 'AI が直し方を考えています…')
    const box = h('div', { class: 'oe-ai' }, h('div', { class: 'oe-ai-head' }, icon('sparkle', 14), label, h('span', { class: 'spinner' })))
    const acts = el.querySelector('.oe-actions')
    el.insertBefore(box, acts)
    let r = null
    try { r = await mod.suggestFix({ code, path: at.file, error: { ...err, line: at.line } }) } catch {}
    if (!r) { label.textContent = 'AI の直し方は見つかりませんでした'; box.querySelector('.spinner')?.remove(); box.classList.add('none-found'); setTimeout(() => box.remove(), 4000); return }
    box.replaceChildren(h('div', { class: 'oe-ai-head' }, icon('sparkle', 14), h('span', null, `AI の直し方 (${r.start === r.end ? r.start + ' 行目' : r.start + '〜' + r.end + ' 行目'})`)))
    // 変わった行だけを見せる
    const a = r.before.split('\n'), b = r.after.split('\n')
    let p = 0
    while (p < a.length && p < b.length && a[p] === b[p]) p++
    let q = 0
    while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++
    const diff = h('div', { class: 'oe-ai-diff hx' })
    for (const l of a.slice(p, a.length - q)) diff.append(h('div', { class: 'del' }, h('span', { class: 'mk' }, '−'), highlightPython(l)))
    for (const l of b.slice(p, b.length - q)) diff.append(h('div', { class: 'add' }, h('span', { class: 'mk' }, '+'), highlightPython(l)))
    box.append(diff)
    if (r.why) box.append(h('div', { class: 'oe-ai-why' }, r.why))
    const apply = async andRun => {
      this.exitFull()
      await app.editors.open(at.file, { line: r.start })
      const v = app.editors.activeView()
      if (!v) return
      const st = v.state
      if (r.end > st.doc.lines) return
      const from = st.doc.line(r.start).from, to = st.doc.line(r.end).to
      if (st.doc.sliceString(from, to) !== r.before) { toast('コードが変わったので、この直し方は使えません', { icon: 'alert' }); return }
      v.dispatch({ changes: { from, to, insert: r.after }, userEvent: 'input.ai', scrollIntoView: true })
      box.remove()
      toast('AI の直し方を適用しました', { icon: 'sparkle' })
      if (andRun) setTimeout(() => this.run(), 150)
    }
    box.append(h('div', { class: 'oe-ai-acts' },
      h('button', { class: 'btn small primary', onclick: () => apply(true) }, icon('play', 13), '直して実行'),
      h('button', { class: 'btn small', onclick: () => apply(false) }, '直すだけ'),
      h('button', { class: 'btn small ghost', onclick: () => box.remove() }, '閉じる')))
  }

  // 実行して、出力・エラーをまとめて返す (AI エージェント用)
  async runAndCollect({ path, seconds = 6, signal, source = null } = {}) {
    const rec = { output: [], errors: [], done: null }
    const tap = m => {
      if (m.type === 'output') { for (const it of m.items) if (rec.output.length < 400) rec.output.push(it) }
      else if (m.type === 'done') { rec.done = m.reason || 'done'; if (m.error) rec.errors.push({ text: m.error.text || `${m.error.type}: ${m.error.message}`, file: m.error.file, line: m.error.line }) }
    }
    this.taps.add(tap)
    try {
      await this.run({ path, agent: true, source })
      if (!this.running) return { ...rec, started: false }
      const until = performance.now() + Math.max(0.5, Math.min(30, seconds)) * 1000
      await new Promise(resolve => {
        const iv = setInterval(() => {
          if (rec.done || !this.running || performance.now() > until || (signal && signal.aborted)) { clearInterval(iv); resolve() }
        }, 80)
      })
      const still = !!this.running
      if (still) this.stop()
      return { ...rec, started: true, stillRunning: still }
    } finally { this.taps.delete(tap) }
  }

  // 止める: KeyboardInterrupt を送り、止まらなければワーカーごと止める
  stop(silent) {
    if (!this.running) return
    const info = this.running
    if (this.shared) {
      const ib = new Int32Array(this.shared.interrupt)
      ib[0] = 2
      Atomics.notify(ib, 0)   // time.sleep で待っている途中でも、すぐ止まる
      Atomics.notify(new Int32Array(this.shared.ectl), 0)
      // input() で待っている途中なら、待つのをやめさせる
      if (this.inputPending) { const ctl = new Int32Array(this.shared.ctl); Atomics.store(ctl, 0, 2); Atomics.notify(ctl, 0) }
      setTimeout(() => {
        if (this.running !== info) return
        this.resetWorker()
        if (!silent) this.finished('stopped'); else this.setRunning(null)
      }, 1500)
      return
    }
    this.resetWorker()
    if (!silent) this.finished('stopped')
    else this.setRunning(null)
  }

  // ============================================================
  // 問題パネル
  // ============================================================
  scheduleProblems(delay = 700) {
    clearTimeout(this.probTimer)
    this.probTimer = setTimeout(() => this.collectProblems(), delay)
  }

  collectProblems() {
    const view = app.editors.activeView()
    const list = []
    if (view) forEachDiagnostic(view.state, (d, from, to) => { if (d.severity !== 'hint') list.push({ d, from, to }) })
    this.problems = list
    const count = { error: 0, warning: 0 }
    for (const { d } of list) if (d.severity === 'error') count.error++; else if (d.severity === 'warning') count.warning++
    const changed = count.error !== this.problemCount.error || count.warning !== this.problemCount.warning
    this.problemCount = count
    if (changed) { this.renderTabs(); emit('problems', count) }
    if (this.tab === 'problems' && app.wb && app.wb.panelOpen) this.renderProblems()
  }

  renderProblems() {
    const el = this.probEl
    el.textContent = ''
    const view = app.editors.activeView()
    const list = this.problems || []
    if (!view || !list.length) { el.append(h('div', { class: 'out-hint' }, '問題は見つかりませんでした')); return }
    const order = { error: 0, warning: 1, info: 2 }
    const sorted = [...list].sort((a, b) => order[a.d.severity] - order[b.d.severity] || a.from - b.from)
    for (const { d, from, to } of sorted) {
      const line = view.state.doc.lineAt(Math.min(from, view.state.doc.length))
      const row = h('div', { class: 'problem ' + d.severity },
        h('button', { class: 'p-main', onclick: () => app.editors.gotoLine(line.number, from - line.from + 1) },
          icon(d.severity === 'error' ? 'close' : d.severity === 'warning' ? 'alert' : 'info', 16),
          h('span', { class: 'p-msg' }, d.message),
          h('span', { class: 'p-loc' }, `${line.number} 行`)))
      if (d.actions && d.actions.length) {
        row.append(h('div', { class: 'p-fixes' }, d.actions.slice(0, 2).map(a => h('button', { class: 'btn small', onclick: () => { const v = app.editors.activeView(); if (v) { a.apply(v, from, to); v.focus(); this.scheduleProblems(500) } } }, a.name))))
      }
      el.append(row)
    }
  }
}

command('run', '実行', () => app.runner.run(), { icon: 'play' })
command('runSelection', '選択範囲だけ実行', () => app.runner.run({ selection: true }), { icon: 'play' })
command('stop', '停止', () => app.runner.stop(), { icon: 'stop' })
command('restartPython', 'Python を再起動 (変数をすべて消す)', () => app.runner.restartPython(), { icon: 'refresh' })
command('clearOutput', '出力をクリア', () => app.runner.clear(), { icon: 'trash' })
command('openRunScreen', '実行画面を開く', () => { if (getSettings().runView === 'panel') runCommand('togglePanel', true); else app.runner.enterFull() }, { icon: 'terminal' })
