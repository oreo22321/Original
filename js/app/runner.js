// 実行パネル: 出力 / 問題 / ゲームツリー
import * as vfs from './vfs.js'
import { app, command, refreshFiles, runCommand } from './app.js'
import { getSettings, on, emit, isTouch } from './store.js'
import { h, icon, toast, copyText, haptic } from './ui.js'
import { forEachDiagnostic } from '../../vendor/codemirror.js'
import { LANG_LABELS } from '../editor/setup.js'

const MAX_DOM_LINES = 4000

export class Runner {
  constructor(root) {
    this.root = root
    this.luauWorker = null
    this.pyWorker = null
    this.running = null
    this.tab = 'output'
    this.lineCount = 0
    this.problemCount = { error: 0, warning: 0 }
    this.lastTree = null
    this.build()
    on('docchange', () => this.scheduleProblems())
    on('active', () => this.scheduleProblems())
  }

  build() {
    this.tabs = h('div', { class: 'panel-tabs', role: 'tablist' })
    this.actions = h('div', { class: 'panel-actions' })
    this.head = h('div', { class: 'panel-head' }, this.tabs, this.actions)
    this.outEl = h('div', { class: 'output', role: 'log', 'aria-live': 'polite' })
    this.stdinWrap = h('div', { class: 'stdin hidden' },
      h('label', { class: 'label' }, '標準入力 (input() / io.read に渡す値を 1 行ずつ入力)'),
      this.stdinEl = h('textarea', { class: 'input mono', rows: '3', placeholder: '例:\nたろう\n42', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }))
    this.outWrap = h('div', { class: 'panel-view out-view' }, this.stdinWrap, this.outEl)
    this.probEl = h('div', { class: 'panel-view problems hidden' })
    this.treeEl = h('div', { class: 'panel-view game-tree hidden' })
    this.root.append(this.head, this.outWrap, this.probEl, this.treeEl)
    this.renderTabs()
    this.placeholder()
  }

  renderTabs() {
    const t = (id, label, badge) => h('button', { class: 'panel-tab' + (this.tab === id ? ' active' : ''), role: 'tab', onclick: () => this.show(id) }, label, badge ? h('span', { class: 'badge ' + (badge.kind || '') }, badge.n) : null)
    this.tabs.innerHTML = ''
    const pc = this.problemCount
    this.tabs.append(
      t('output', '出力'),
      t('problems', '問題', pc.error + pc.warning ? { n: pc.error + pc.warning, kind: pc.error ? 'error' : 'warn' } : null),
      t('tree', 'ゲーム'),
    )
    this.actions.innerHTML = ''
    if (this.tab === 'output') {
      this.actions.append(
        h('button', { class: 'icon-btn' + (this.stdinWrap.classList.contains('hidden') ? '' : ' on'), title: '標準入力', 'aria-label': '標準入力', onclick: () => { this.stdinWrap.classList.toggle('hidden'); this.renderTabs() } }, icon('keyboard', 18)),
        h('button', { class: 'icon-btn', title: '出力をコピー', 'aria-label': '出力をコピー', onclick: () => copyText(this.outEl.innerText).then(() => toast('出力をコピーしました')) }, icon('copy', 18)),
        h('button', { class: 'icon-btn', title: 'クリア', 'aria-label': 'クリア', onclick: () => this.clear() }, icon('trash', 18)))
    }
    this.actions.append(h('button', { class: 'icon-btn', title: 'パネルを閉じる', 'aria-label': 'パネルを閉じる', onclick: () => runCommand('togglePanel', false) }, icon('close', 18)))
  }

  show(tab) {
    this.tab = tab
    this.outWrap.classList.toggle('hidden', tab !== 'output')
    this.probEl.classList.toggle('hidden', tab !== 'problems')
    this.treeEl.classList.toggle('hidden', tab !== 'tree')
    if (tab === 'problems') this.renderProblems()
    if (tab === 'tree') this.renderTree()
    this.renderTabs()
  }

  placeholder() {
    if (this.lineCount) return
    this.outEl.innerHTML = ''
    this.outEl.append(h('div', { class: 'out-hint' }, isTouch ? '▶ ボタンで実行すると、ここに結果が表示されます' : '▶ ボタン (⌘/Ctrl + Enter) で実行すると、ここに結果が表示されます'))
  }

  clear() {
    this.outEl.innerHTML = ''
    this.lineCount = 0
    this.placeholder()
  }

  line(kind, text, extra) {
    if (!this.lineCount) this.outEl.innerHTML = ''
    this.lineCount++
    const atBottom = this.outEl.scrollHeight - this.outEl.scrollTop - this.outEl.clientHeight < 40
    const el = h('div', { class: 'out-line ' + kind })
    if (extra && extra.time) el.append(h('span', { class: 'out-time' }, extra.time))
    // ファイル:行 をリンクに
    const parts = String(text).split(/((?:[\w./-]+\.(?:luau?|py)|main|test)(?::| line )\d+)/)
    for (const p of parts) {
      const m = /^([\w./-]+\.(?:luau?|py)|main|test)(?::| line )(\d+)$/.exec(p)
      if (m && app.files.some(f => f.path === m[1])) {
        el.append(h('a', { class: 'out-link', href: '#', onclick: e => { e.preventDefault(); app.editors.open(m[1], { line: Number(m[2]) }) } }, p))
      } else el.append(p)
    }
    this.outEl.append(el)
    while (this.outEl.childElementCount > MAX_DOM_LINES) this.outEl.firstElementChild.remove()
    if (atBottom) this.outEl.scrollTop = this.outEl.scrollHeight
    return el
  }

  // ============================================================
  // 実行
  // ============================================================
  async run() {
    const doc = app.editors.activeDoc()
    if (!doc) { toast('実行するファイルを開いてください'); return }
    if (this.running) this.stop(true)
    await app.editors.saveAll()
    const s = getSettings()
    runCommand('togglePanel', true)
    this.show('output')
    if (s.clearOnRun) this.clear()
    haptic(10)
    const path = doc.path
    const source = doc.state.doc.toString()
    const lang = doc.lang
    if (lang === 'luau') return this.runLuau(path, source)
    if (lang === 'python') return this.runPython(path, source)
    if (lang === 'javascript') return this.runJs(path, source)
    if (lang === 'html' || lang === 'markdown') { app.editors.togglePreview(true); return }
    toast(`${LANG_LABELS[lang] || lang} のファイルは実行できません`)
  }

  setRunning(info) {
    this.running = info
    emit('running', info)
  }

  started(label) {
    this.t0 = performance.now()
    this.line('meta', `▶ ${label}`)
  }

  finished(reason) {
    const sec = ((performance.now() - this.t0) / 1000).toFixed(2)
    const msg = reason === 'stopped' ? `■ 停止しました (${sec} 秒)` : reason === 'error' ? `✕ エラーで終了 (${sec} 秒)` : reason === 'timeout' ? `■ 時間切れ (${sec} 秒)` : `✓ 完了 (${sec} 秒)`
    this.line(reason === 'error' ? 'meta error' : 'meta', msg)
    this.setRunning(null)
  }

  async collectFiles() {
    const all = await vfs.readAll(app.project.id)
    const files = {}, wsFiles = {}, wsFolders = []
    for (const f of all) {
      if (f.path.startsWith('workspace/')) {
        const rel = f.path.slice('workspace/'.length)
        if (f.dir) wsFolders.push(rel)
        else wsFiles[rel] = f.content || ''
      }
      if (!f.dir && /\.(luau?|py|txt|json|csv|md)$/i.test(f.path)) files[f.path] = f.content || ''
    }
    return { files, wsFiles, wsFolders }
  }

  async runLuau(path, source) {
    const s = getSettings()
    const plain = /\.lua$/i.test(path) && s.luaRuntime === 'plain'
    const { files, wsFiles, wsFolders } = await this.collectFiles()
    files[path] = source
    if (!this.luauWorker) {
      this.luauWorker = new Worker(new URL('../workers/luau-worker.js', import.meta.url), { type: 'module' })
      this.luauWorker.onerror = e => { this.line('error', 'ワーカーの起動に失敗しました: ' + (e.message || 'このブラウザはモジュールワーカーに対応していない可能性があります')); this.finished('error') }
    }
    const w = this.luauWorker
    this.setRunning({ path, kind: 'luau' })
    this.started(`${path} を実行 (${plain ? '標準 Lua' : s.robloxApi ? 'Luau / Roblox サンドボックス' : 'Luau'})`)
    w.onmessage = e => this.onLuauMessage(e.data)
    w.postMessage({
      type: 'run', source, path, chunkName: path, files, wsFiles, wsFolders, projectName: app.project.name,
      mode: plain ? 'lua' : 'luau',
      options: { timeLimit: s.timeLimit * 1000, maxRunTime: s.maxRunTime, roblox: s.robloxApi && !plain, executor: s.executorApi && !plain, touch: isTouch },
    })
  }

  onLuauMessage(m) {
    switch (m.type) {
      case 'output':
        for (const it of m.items) this.line(it.kind, it.text)
        break
      case 'error': {
        this.line('error', m.text)
        if (m.traceback && m.traceback.length > 1) this.line('trace', 'スタック: ' + m.traceback.slice(0, 6).join(' ← '))
        if (m.line && m.file && app.editors.active === m.file) emit('runError', m)
        break
      }
      case 'fs': this.onFs(m); break
      case 'clipboard':
        copyText(m.text).then(ok => {
          if (ok) toast('setclipboard: クリップボードにコピーしました', { icon: 'copy' })
          else toast('setclipboard が呼ばれました', { action: { label: 'コピー', run: () => copyText(m.text) }, duration: 6000 })
        })
        break
      case 'clear': this.clear(); break
      case 'done':
        this.lastTree = m.tree
        this.lastDrawings = m.drawings
        this.finished(m.reason === 'idle' ? 'done' : m.reason)
        if (this.tab === 'tree') this.renderTree()
        break
    }
  }

  async onFs(m) {
    const p = 'workspace/' + m.path
    const pid = app.project.id
    if (m.op === 'write') { await vfs.writeFile(pid, p, m.content); app.editors.externalChange(p, m.content) }
    else if (m.op === 'delete' || m.op === 'rmdir') { await vfs.remove(pid, p); app.editors.forceClose(p) }
    else if (m.op === 'mkdir') await vfs.mkdir(pid, p)
    clearTimeout(this.fsTimer)
    this.fsTimer = setTimeout(() => refreshFiles(), 150)
  }

  async runPython(path, source) {
    const s = getSettings()
    const { files } = await this.collectFiles()
    files[path] = source
    const first = !this.pyWorker
    if (!this.pyWorker) {
      this.pyWorker = new Worker(new URL('../workers/python-worker.js', import.meta.url))
      this.pyWorker.onerror = e => { this.line('error', 'Python の起動に失敗しました: ' + (e.message || '')); this.finished('error') }
    }
    const w = this.pyWorker
    this.setRunning({ path, kind: 'python' })
    this.started(`${path} を実行 (Python)`)
    if (first) this.loadingLine = this.line('meta', 'Python を読み込み中… (初回は数十秒かかることがあります)')
    if (/\binput\s*\(/.test(source) && !this.stdinEl.value.trim()) {
      this.stdinWrap.classList.remove('hidden')
      this.line('warn', 'input() を使っています。上の「標準入力」欄に値を 1 行ずつ入れてから実行すると、その値が使われます')
    }
    w.onmessage = e => {
      const m = e.data
      if (m.type === 'ready' && this.loadingLine) { this.loadingLine.textContent = `Python ${m.version} の準備ができました`; this.loadingLine = null }
      else if (m.type === 'output') for (const it of m.items) this.line(it.kind, it.text)
      else if (m.type === 'error') this.line('error', m.text)
      else if (m.type === 'status') this.line('meta', m.text)
      else if (m.type === 'fs') { vfs.writeFile(app.project.id, m.path, m.content).then(() => { app.editors.externalChange(m.path, m.content); refreshFiles() }) }
      else if (m.type === 'done') this.finished(m.reason)
    }
    w.postMessage({ type: 'run', source, path, files, stdin: this.stdinEl.value, indexURL: s.pyodideUrl })
  }

  runJs(path, source) {
    this.setRunning({ path, kind: 'js' })
    this.started(`${path} を実行 (JavaScript)`)
    const wrapper = `
      const send = (kind, args) => postMessage({ type: 'output', kind, text: args.map(a => { try { return typeof a === 'string' ? a : JSON.stringify(a, null, 2) } catch { return String(a) } }).join(' ') })
      console.log = (...a) => send('print', a); console.info = (...a) => send('info', a); console.warn = (...a) => send('warn', a); console.error = (...a) => send('error', a)
      self.onmessage = async () => {
        try { await (async () => { ${source}\n })() } catch (e) { postMessage({ type: 'output', kind: 'error', text: String(e && e.stack || e) }) }
        postMessage({ type: 'done' })
      }`
    const url = URL.createObjectURL(new Blob([wrapper], { type: 'text/javascript' }))
    let w
    try { w = new Worker(url) } catch (e) { this.line('error', String(e)); this.finished('error'); return }
    this.jsWorker = w
    w.onerror = e => { this.line('error', e.message || '構文エラー'); e.preventDefault(); w.terminate(); this.finished('error') }
    w.onmessage = e => {
      if (e.data.type === 'output') this.line(e.data.kind, e.data.text)
      else if (e.data.type === 'done') { setTimeout(() => { if (this.running && this.running.kind === 'js') { w.terminate(); this.finished('done') } }, 50) }
    }
    w.postMessage('run')
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  stop(silent) {
    if (!this.running) return
    const kind = this.running.kind
    if (kind === 'luau' && this.luauWorker) { this.luauWorker.terminate(); this.luauWorker = null }
    if (kind === 'python' && this.pyWorker) { this.pyWorker.terminate(); this.pyWorker = null }
    if (kind === 'js' && this.jsWorker) { this.jsWorker.terminate(); this.jsWorker = null }
    if (!silent) this.finished('stopped')
    else this.setRunning(null)
  }

  // ============================================================
  // 問題パネル
  // ============================================================
  scheduleProblems() {
    clearTimeout(this.probTimer)
    this.probTimer = setTimeout(() => this.collectProblems(), 900)
  }

  collectProblems() {
    const view = app.editors.activeView()
    const list = []
    if (view) forEachDiagnostic(view.state, (d, from, to) => list.push({ ...d, from, to }))
    this.problems = list
    const count = { error: 0, warning: 0 }
    for (const d of list) if (d.severity === 'error') count.error++; else if (d.severity === 'warning') count.warning++
    const changed = count.error !== this.problemCount.error || count.warning !== this.problemCount.warning
    this.problemCount = count
    if (changed) { this.renderTabs(); emit('problems', count) }
    if (this.tab === 'problems') this.renderProblems()
  }

  renderProblems() {
    const el = this.probEl
    el.innerHTML = ''
    const view = app.editors.activeView()
    const list = (this.problems || []).filter(d => d.severity !== 'hint')
    if (!view || !list.length) { el.append(h('div', { class: 'out-hint' }, '問題は見つかりませんでした 🎉')); return }
    const order = { error: 0, warning: 1, info: 2 }
    list.sort((a, b) => order[a.severity] - order[b.severity] || a.from - b.from)
    for (const d of list) {
      const line = view.state.doc.lineAt(Math.min(d.from, view.state.doc.length))
      el.append(h('button', { class: 'problem ' + d.severity, onclick: () => app.editors.gotoLine(line.number, d.from - line.from + 1) },
        icon(d.severity === 'error' ? 'close' : d.severity === 'warning' ? 'alert' : 'info', 16),
        h('span', { class: 'p-msg' }, d.message),
        h('span', { class: 'p-loc' }, `${line.number} 行目`)))
    }
  }

  // ============================================================
  // ゲームツリー (実行後の Instance 構造)
  // ============================================================
  renderTree() {
    const el = this.treeEl
    el.innerHTML = ''
    if (!this.lastTree) { el.append(h('div', { class: 'out-hint' }, 'Luau スクリプトを実行すると、ゲーム内のオブジェクト (Workspace や Players など) の構造がここに表示されます')); return }
    if (this.lastDrawings && this.lastDrawings.length) el.append(this.drawingPreview(this.lastDrawings))
    const CLASS_ICON = { Workspace: '🌐', Players: '👥', Player: '🙂', Model: '🧩', Part: '🟫', MeshPart: '🔷', SpawnLocation: '🟩', Folder: '📁', Script: '📜', LocalScript: '📃', ModuleScript: '📦', Humanoid: '🧍', ScreenGui: '🖥️', Frame: '▭', TextLabel: '🔤', TextButton: '🔘', ImageLabel: '🖼️', Camera: '🎥', Terrain: '⛰️', Lighting: '💡', IntValue: '🔢', NumberValue: '🔢', StringValue: '🔤', BoolValue: '☑️', RemoteEvent: '📡', RemoteFunction: '📡', BindableEvent: '🔔', Sound: '🔊', ReplicatedStorage: '🗄️', ServerStorage: '🗄️', ServerScriptService: '⚙️', StarterGui: '🖥️', StarterPack: '🎒', Backpack: '🎒', PlayerGui: '🖥️', Tool: '🔧', UICorner: '◜', Attachment: '📍' }
    const node = (n, depth, open) => {
      const kids = n.k || []
      const row = h('div', { class: 'gt-row', style: { paddingLeft: 6 + depth * 14 + 'px' } },
        kids.length ? icon(open ? 'chevronDown' : 'chevronRight', 12, 'twisty') : h('span', { class: 'twisty-space' }),
        h('span', { class: 'gt-icon' }, CLASS_ICON[n.c] || '◽'), h('span', { class: 'gt-name' }, n.n), n.n !== n.c ? h('span', { class: 'gt-class' }, n.c) : null)
      const box = h('div', null, row)
      const kidBox = h('div', { class: open ? '' : 'hidden' })
      if (kids.length) {
        let built = false
        const build = () => { if (built) return; built = true; for (const k of kids) kidBox.append(node(k, depth + 1, false)); if (n.more) kidBox.append(h('div', { class: 'gt-more', style: { paddingLeft: 20 + depth * 14 + 'px' } }, `… 他 ${n.more} 個`)) }
        if (open) build()
        row.addEventListener('click', () => { build(); kidBox.classList.toggle('hidden'); row.querySelector('.twisty').replaceWith(icon(kidBox.classList.contains('hidden') ? 'chevronRight' : 'chevronDown', 12, 'twisty')) })
        box.append(kidBox)
      }
      return box
    }
    el.append(node(this.lastTree, 0, true))
  }

  drawingPreview(list) {
    const W = 1920, H = 1080
    const canvas = h('canvas', { width: W, height: H, class: 'draw-canvas' })
    const g = canvas.getContext('2d')
    g.fillStyle = '#1b2433'
    g.fillRect(0, 0, W, H)
    const col = c => c ? `rgb(${c.map(v => Math.round(v * 255)).join(',')})` : '#fff'
    for (const d of list.sort((a, b) => (a.ZIndex || 0) - (b.ZIndex || 0))) {
      g.globalAlpha = d.Transparency ?? 1
      g.strokeStyle = g.fillStyle = col(d.Color)
      g.lineWidth = d.Thickness || 1
      if (d.kind === 'Line' && d.From && d.To) { g.beginPath(); g.moveTo(...d.From); g.lineTo(...d.To); g.stroke() }
      else if (d.kind === 'Circle' && d.Position) { g.beginPath(); g.arc(d.Position[0], d.Position[1], d.Radius || 10, 0, Math.PI * 2); d.Filled ? g.fill() : g.stroke() }
      else if (d.kind === 'Square' && d.Position && d.Size) { d.Filled ? g.fillRect(...d.Position, ...d.Size) : g.strokeRect(...d.Position, ...d.Size) }
      else if (d.kind === 'Text' && d.Position) { g.font = `${d.Size || 16}px sans-serif`; g.textAlign = d.Center ? 'center' : 'left'; g.fillText(d.Text || '', d.Position[0], d.Position[1] + (d.Size || 16)) }
      else if ((d.kind === 'Triangle' || d.kind === 'Quad') && d.PointA) {
        g.beginPath(); g.moveTo(...d.PointA); g.lineTo(...d.PointB); g.lineTo(...d.PointC); if (d.PointD) g.lineTo(...d.PointD); g.closePath(); d.Filled ? g.fill() : g.stroke()
      }
    }
    return h('div', { class: 'draw-wrap' }, h('div', { class: 'label' }, `Drawing のプレビュー (${list.length} 個)`), canvas)
  }
}

command('run', '実行', () => app.runner.run(), { icon: 'play', key: '⌘Enter' })
command('stop', '停止', () => app.runner.stop(), { icon: 'stop' })
