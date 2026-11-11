// 実行パネル: 出力 / 問題 / ゲーム (GUI プレビュー・操作・オブジェクト一覧)
import * as vfs from './vfs.js'
import { app, command, refreshFiles, runCommand } from './app.js'
import { getSettings, getMode, on, emit, isTouch } from './store.js'
import { h, icon, toast, copyText, haptic } from './ui.js'
import { forEachDiagnostic } from '../../vendor/codemirror.js'
import { scriptKindOf, KIND_LABELS, langOf } from '../editor/setup.js'
import { explainError } from './explain.js'
import { renderGui, SCREENS } from './gui-preview.js'

const MAX_DOM_LINES = 3000
const LINK_RE = /((?:[\w./ -]*[\w-]\.luau?)(?::| line )\d+)/

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
    this.game = { tree: null, gui: null, interact: null, drawings: null }
    this.screen = localStorage.getItem('forgecode.screen') || (isTouch ? 'phone' : 'pc')
    this.build()
    on('docchange', () => this.scheduleProblems())
    on('active', () => this.scheduleProblems(120))
    on('mode', () => this.scheduleProblems(600))
    // ▶ を押してすぐ実行できるよう、空いた時間にワーカーを起動しておく
    setTimeout(() => this.ensureWorker(), 1200)
  }

  build() {
    this.tabs = h('div', { class: 'panel-tabs', role: 'tablist' })
    this.actions = h('div', { class: 'panel-actions' })
    this.head = h('div', { class: 'panel-head' }, this.tabs, this.actions)
    this.outEl = h('div', { class: 'output', role: 'log', 'aria-live': 'polite' })
    this.searchEl = h('input', { class: 'input out-search hidden', placeholder: '出力を絞り込み', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
    this.searchEl.addEventListener('input', () => { this.query = this.searchEl.value.toLowerCase(); this.applyQuery() })
    this.outWrap = h('div', { class: 'panel-view out-view' }, this.searchEl, this.outEl)
    this.probEl = h('div', { class: 'panel-view problems hidden' })
    this.gameEl = h('div', { class: 'panel-view game-view hidden' })
    this.root.append(this.head, this.outWrap, this.probEl, this.gameEl)
    this.renderTabs()
    this.placeholder()
  }

  renderTabs() {
    const t = (id, label, badge) => h('button', { class: 'panel-tab' + (this.tab === id ? ' active' : ''), role: 'tab', 'aria-selected': this.tab === id ? 'true' : 'false', onclick: () => this.show(id) }, label, badge ? h('span', { class: 'badge ' + (badge.kind || '') }, badge.n) : null)
    this.tabs.textContent = ''
    const pc = this.problemCount
    const g = this.game
    this.tabs.append(
      t('output', '出力'),
      t('problems', '問題', pc.error + pc.warning ? { n: pc.error + pc.warning, kind: pc.error ? 'error' : 'warn' } : null),
      t('game', 'ゲーム', g.gui || g.interact ? { n: '●', kind: this.waiting ? 'live' : 'dot' } : null),
    )
    this.actions.textContent = ''
    const btn = (ic, title, fn, on) => h('button', { class: 'icon-btn' + (on ? ' on' : ''), title, 'aria-label': title, onclick: fn }, icon(ic, 18))
    if (this.tab === 'output') {
      this.actions.append(
        btn('filter', this.filter === 'all' ? 'エラーと警告だけ表示' : 'すべて表示', () => { this.filter = this.filter === 'all' ? 'issues' : 'all'; this.outEl.classList.toggle('only-issues', this.filter !== 'all'); this.renderTabs() }, this.filter !== 'all'),
        btn('search', '出力を絞り込み', () => { this.searchEl.classList.toggle('hidden'); if (this.searchEl.classList.contains('hidden')) { this.searchEl.value = ''; this.query = ''; this.applyQuery() } else this.searchEl.focus(); this.renderTabs() }, !this.searchEl.classList.contains('hidden')),
        btn('copy', '出力をコピー', () => copyText(this.outputText()).then(() => toast('出力をコピーしました', { icon: 'copy' }))),
        btn('trash', 'クリア', () => this.clear()))
    }
    this.actions.append(btn('close', 'パネルを閉じる', () => runCommand('togglePanel', false)))
  }

  show(tab) {
    this.tab = tab
    this.outWrap.classList.toggle('hidden', tab !== 'output')
    this.probEl.classList.toggle('hidden', tab !== 'problems')
    this.gameEl.classList.toggle('hidden', tab !== 'game')
    if (tab === 'problems') this.renderProblems()
    if (tab === 'game') this.renderGame()
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
    this.placeholder()
  }

  outputText() {
    return [...this.outEl.querySelectorAll('.out-line, .out-error')].map(el => el.dataset.text || el.innerText).join('\n')
  }

  applyQuery() {
    const q = this.query
    for (const el of this.outEl.children) el.classList.toggle('q-hide', !!q && !(el.dataset.text || el.textContent).toLowerCase().includes(q))
  }

  // ファイル:行 をタップで開けるリンクにする
  linkify(el, text) {
    const parts = String(text).split(LINK_RE)
    for (const p of parts) {
      const m = /^([\w./ -]*[\w-]\.luau?)(?::| line )(\d+)$/.exec(p)
      if (m && app.files.some(f => f.path === m[1])) {
        el.append(h('a', { class: 'out-link', href: '#', onclick: e => { e.preventDefault(); app.editors.open(m[1], { line: Number(m[2]) }) } }, p))
      } else if (p) el.append(p)
    }
  }

  makeLine(kind, text, t) {
    const el = h('div', { class: 'out-line ' + kind })
    el.dataset.text = text
    if (t !== undefined && getSettings().outputTime) el.append(h('span', { class: 'out-time' }, (t / 1000).toFixed(2)))
    const body = h('span', { class: 'out-text' })
    this.linkify(body, text)
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
      const last = this.last
      if (group && last && last.kind === it.kind && last.text === it.text) {
        last.n++
        if (!last.badge) { last.badge = h('span', { class: 'out-count' }); last.el.append(last.badge) }
        last.badge.textContent = '×' + last.n
        continue
      }
      const el = this.makeLine(it.kind, it.text, it.t)
      frag.append(el)
      this.lineCount++
      this.last = { kind: it.kind, text: it.text, el, n: 1, badge: null }
    }
    out.append(frag)
    let extra = out.childElementCount - MAX_DOM_LINES
    while (extra-- > 0) out.firstElementChild.remove()
    // エラーの解説を表示した後は、読んでいる位置を動かさない
    if (atBottom && !this.holdScroll) out.scrollTop = out.scrollHeight
  }

  line(kind, text) {
    this.append([{ kind, text }])
    return this.last ? this.last.el : null
  }

  // ============================================================
  // ワーカー
  // ============================================================
  ensureWorker() {
    if (this.worker) return this.worker
    let w
    try {
      w = new Worker(new URL('../workers/luau-worker.js', import.meta.url), { type: 'module' })
    } catch (e) {
      return null
    }
    w.onerror = e => {
      if (e.preventDefault) e.preventDefault()
      if (this.worker !== w) return
      this.worker = null
      if (this.running) { this.line('error', '実行エンジンでエラーが発生しました: ' + (e.message || 'このブラウザはモジュールワーカーに対応していない可能性があります')); this.finished('error') }
    }
    w.onmessage = e => { if (this.worker === w) this.onMessage(e.data) }
    w.postMessage({ type: 'warm' })
    this.worker = w
    return w
  }

  resetWorker() {
    if (this.worker) { try { this.worker.terminate() } catch {} this.worker = null }
    // 次の実行に備えて起動しておく
    setTimeout(() => this.ensureWorker(), 300)
  }

  // ============================================================
  // 実行
  // ============================================================
  runTarget() {
    const p = app.project
    return p && p.runTarget && app.files.some(f => f.path === p.runTarget && !f.dir) ? p.runTarget : null
  }

  async run({ selection = false } = {}) {
    const doc = app.editors.activeDoc()
    const s = getSettings()
    let path = null, source = null
    if (selection) {
      const v = app.editors.activeView()
      if (!v || !doc || doc.lang !== 'luau' || v.state.selection.main.empty) { toast('実行したい部分を選択してください'); return }
      path = doc.path
      // 行番号がずれないよう、選択より前は空行にする
      const sel = v.state.selection.main
      source = '\n'.repeat(v.state.doc.lineAt(sel.from).number - 1) + v.state.sliceDoc(sel.from, sel.to)
    } else {
      const target = this.runTarget()
      if (target) path = target
      else if (doc && doc.lang === 'luau') path = doc.path
      else if (doc && doc.lang === 'markdown') { app.editors.togglePreview(true); return }
      else {
        const main = app.files.find(f => !f.dir && /(^|\/)(main|init)[\w.]*\.luau?$/.test(f.path)) || app.files.find(f => !f.dir && langOf(f.path) === 'luau')
        if (!main) { toast('実行する Luau ファイル (.luau / .lua) がありません'); return }
        path = main.path
      }
      const open = app.editors.docs.get(path)
      source = open ? open.state.doc.toString() : app.contents.get(path)
      if (source === undefined) source = (await vfs.readFile(app.project.id, path)) || ''
    }
    if (this.running) this.stop(true)
    // 保存は裏で行い、実行は待たせない (開いているファイルは編集中の内容を使う)
    app.editors.saveAll().catch(() => {})
    runCommand('togglePanel', true)
    if (this.tab !== 'output') this.show('output')
    if (s.clearOnRun) this.clear()
    haptic(10)
    app.editors.clearRunErrors()
    const mode = getMode()
    const kind = scriptKindOf(path, mode)
    const files = {}, wsFiles = {}, wsFolders = []
    for (const f of app.files) {
      const content = app.editors.docs.has(f.path) ? app.editors.docs.get(f.path).state.doc.toString() : app.contents.get(f.path)
      if (f.path.startsWith('workspace/')) {
        const rel = f.path.slice('workspace/'.length)
        if (f.dir) wsFolders.push(rel)
        else wsFiles[rel] = content || ''
      }
      if (!f.dir && /\.(luau?|txt|json|csv|md)$/i.test(f.path)) files[f.path] = content || ''
    }
    if (!selection) files[path] = source
    const w = this.ensureWorker()
    if (!w) { this.line('error', '実行エンジンを起動できませんでした。ページを再読み込みしてください'); return }
    this.game = { tree: null, gui: null, interact: null, drawings: null }
    this.waiting = false
    this.waitNoted = false
    this.sawGui = false
    this.holdScroll = false
    this.errors = 0
    this.setRunning({ path, kind })
    this.t0 = performance.now()
    this.append([{ kind: 'meta', text: `▶ ${path}${selection ? ' (選択範囲)' : ''} — ${KIND_LABELS[kind]}` }])
    this.renderTabs()
    w.postMessage({
      type: 'run', source, path, chunkName: path, files, wsFiles, wsFolders, projectName: app.project.name,
      options: { timeLimit: s.timeLimit * 1000, maxRunTime: s.maxRunTime, executor: mode === 'executor', kind, touch: isTouch },
    })
  }

  setRunning(info) {
    this.running = info
    emit('running', info)
  }

  finished(reason) {
    const sec = ((performance.now() - this.t0) / 1000).toFixed(2)
    const msg = reason === 'stopped' ? `■ 停止しました (${sec} 秒)` : reason === 'error' ? `✕ エラーで終了 (${sec} 秒)` : reason === 'timeout' ? `■ 時間切れ (${sec} 秒)` : this.errors ? `✕ 終了 — エラー ${this.errors} 件 (${sec} 秒)` : `✓ 完了 (${sec} 秒)`
    this.append([{ kind: reason === 'error' || this.errors ? 'meta error' : 'meta', text: msg }])
    this.waiting = false
    this.setRunning(null)
    this.renderTabs()
    if (this.tab === 'game') this.renderGame()
  }

  onMessage(m) {
    switch (m.type) {
      case 'output': this.append(m.items); break
      case 'error': this.showError(m); break
      case 'fs': this.onFs(m); break
      case 'clipboard':
        copyText(m.text).then(ok => {
          if (ok) toast('setclipboard: クリップボードにコピーしました', { icon: 'copy' })
          else toast('setclipboard が呼ばれました', { action: { label: 'コピー', run: () => copyText(m.text) }, duration: 6000 })
        })
        break
      case 'clear': this.clear(); break
      case 'gui':
        this.game.gui = m.gui
        this.onGui()
        break
      case 'waiting':
        Object.assign(this.game, { tree: m.tree, gui: m.gui, interact: m.interact, drawings: m.drawings })
        this.waiting = true
        if (!this.waitNoted) { this.waitNoted = true; this.append([{ kind: 'meta', text: '⏸ 操作を待っています — 「ゲーム」タブでボタンなどを試せます (■ で終了)' }]) }
        emit('running', this.running)
        this.onGui(true)
        this.renderTabs()
        break
      case 'resumed': this.waiting = false; emit('running', this.running); break
      case 'done':
        Object.assign(this.game, { tree: m.tree, gui: m.gui, interact: m.interact, drawings: m.drawings })
        if (this.running) this.finished(m.reason === 'idle' ? 'done' : m.reason)
        break
    }
  }

  onGui(force) {
    const has = !!(this.game.gui || this.game.interact)
    if (has && !this.sawGui) {
      this.sawGui = true
      this.renderTabs()
      // GUI ができたら、エラーがなければプレビューへ切り替える
      if (this.game.gui && !this.errors && this.tab === 'output') { this.show('game'); return }
    }
    if (this.tab === 'game') this.renderGame(force)
  }

  showError(m) {
    this.errors++
    const s = getSettings()
    const kind = this.running ? this.running.kind : null
    const el = h('div', { class: 'out-error' })
    el.dataset.text = m.text
    const head = h('div', { class: 'oe-head' }, icon('close', 15))
    const msg = h('span', { class: 'oe-msg' })
    this.linkify(msg, m.text)
    head.append(msg)
    el.append(head)
    const ex = s.explainErrors && !m.syntax ? explainError(m.message || m.text, { kind, mode: getMode() }) : null
    if (ex) {
      el.append(h('div', { class: 'oe-why' }, icon('info', 14), h('span', null, ex.why)))
      if (ex.fixes.length) el.append(h('ul', { class: 'oe-fixes' }, ex.fixes.map(f => h('li', null, f))))
    }
    if (m.traceback && m.traceback.length > 1) {
      const tr = h('div', { class: 'oe-trace' }, '呼び出し元: ')
      this.linkify(tr, m.traceback.slice(0, 6).join(' ← '))
      el.append(tr)
    }
    const acts = h('div', { class: 'oe-actions' })
    if (m.file && m.line && app.files.some(f => f.path === m.file)) acts.append(h('button', { class: 'btn small', onclick: () => app.editors.open(m.file, { line: m.line }) }, `${m.line} 行目へ`))
    acts.append(h('button', { class: 'btn small ghost', onclick: () => copyText(m.text).then(() => toast('エラーをコピーしました', { icon: 'copy' })) }, 'コピー'))
    if (s.aiKey) acts.append(h('button', { class: 'btn small ghost', onclick: () => runCommand('aiAsk', `次のエラーの原因と直し方を教えてください:\n${m.text}`) }, icon('sparkle', 14), 'AI に聞く'))
    el.append(acts)
    if (!this.lineCount) this.outEl.textContent = ''
    const out = this.outEl
    out.append(el)
    this.lineCount++
    this.last = null
    if (m.line && m.file) app.editors.markRunError(m.file, m.line, m.message || m.text)
    if (this.tab !== 'output') this.show('output')
    // 最初のエラーは、メッセージの先頭が見える位置へ
    if (!this.holdScroll) { this.holdScroll = true; requestAnimationFrame(() => { out.scrollTop = Math.max(0, el.offsetTop - out.offsetTop - 6) }) }
  }

  async onFs(m) {
    const p = 'workspace/' + m.path
    const pid = app.project.id
    // まず手元の一覧を更新する (保存の完了を待たずに、すぐ次の実行で使えるように)
    const has = path => app.files.some(f => f.path === path)
    const addDirs = path => { const parts = path.split('/'); for (let i = 1; i < parts.length; i++) { const d = parts.slice(0, i).join('/'); if (!has(d)) app.files.push({ path: d, dir: true }) } }
    if (m.op === 'write') { addDirs(p); if (!has(p)) app.files.push({ path: p, dir: false }); app.contents.set(p, m.content) }
    else if (m.op === 'mkdir') { addDirs(p + '/x') }
    else if (m.op === 'delete' || m.op === 'rmdir') { app.files = app.files.filter(f => f.path !== p && !f.path.startsWith(p + '/')); for (const k of [...app.contents.keys()]) if (k === p || k.startsWith(p + '/')) app.contents.delete(k) }
    try {
      if (m.op === 'write') { await vfs.writeFile(pid, p, m.content); app.editors.externalChange(p, m.content) }
      else if (m.op === 'delete' || m.op === 'rmdir') { await vfs.remove(pid, p); app.editors.forceClose(p) }
      else if (m.op === 'mkdir') await vfs.mkdir(pid, p)
    } catch (e) {
      this.line('warn', `ファイルを保存できませんでした (${p}): ${e.message}`)
    }
    clearTimeout(this.fsTimer)
    this.fsTimer = setTimeout(() => refreshFiles(), 250)
  }

  stop(silent) {
    if (!this.running) return
    this.resetWorker()
    if (!silent) this.finished('stopped')
    else { this.waiting = false; this.setRunning(null) }
  }

  sendInput(msg) {
    if (!this.running || !this.worker) { toast('実行が終了しています。▶ でもう一度実行すると操作できます'); return }
    haptic(6)
    this.worker.postMessage({ type: 'input', ...msg })
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
    const fixable = sorted.filter(p => p.d.actions && p.d.actions.length && (p.d.source === '誤字' || p.d.source === '全角'))
    if (fixable.length > 1) el.append(h('div', { class: 'prob-bar' }, h('button', { class: 'btn small primary', onclick: () => runCommand('fixAllTypos') }, icon('wand', 14), `誤字をまとめて直す (${fixable.length})`)))
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

  // ============================================================
  // ゲーム: GUI プレビュー / 操作 / Drawing / オブジェクト一覧
  // ============================================================
  renderGame(soft) {
    const el = this.gameEl
    const g = this.game
    // 入力欄に入力中は作り直さない
    if (soft && el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return
    const scroll = el.scrollTop
    el.textContent = ''
    if (!g.tree && !g.gui && !this.running) {
      el.append(h('div', { class: 'out-hint' }, 'スクリプトを実行すると、作った GUI のプレビューや、ゲーム内のオブジェクト (Workspace・Players など) がここに表示されます'))
      return
    }
    const live = !!this.running
    if (g.gui) {
      el.append(h('div', { class: 'game-head' },
        h('span', { class: 'game-title' }, 'GUI プレビュー'),
        h('span', { class: 'game-state' + (live ? ' live' : '') }, live ? '● 実行中 — タップで操作できます' : '終了 (表示のみ)'),
        h('span', { class: 'sb-spacer' }),
        h('div', { class: 'seg' }, SCREENS.map(sc => h('button', { class: 'seg-btn' + (this.screen === sc.id ? ' on' : ''), title: `${sc.w} × ${sc.h}`, onclick: () => { this.screen = sc.id; localStorage.setItem('forgecode.screen', sc.id); this.renderGame() } }, sc.label)))))
      el.append(renderGui(g.gui, m => this.sendInput(m), this.screen))
    }
    if (g.interact && g.interact.length) {
      const box = h('div', { class: 'interact' }, h('div', { class: 'game-title' }, '操作できるもの'))
      for (const it of g.interact) {
        if (it.kind === 'keys') {
          const keys = ['W', 'A', 'S', 'D', 'Space', 'E', 'F', 'Q', 'R', 'LeftShift', 'One', 'Two']
          const custom = h('input', { class: 'input key-input', placeholder: 'キー名 (例: G)', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
          custom.addEventListener('keydown', e => { if (e.key === 'Enter' && custom.value.trim()) { this.sendInput({ kind: 'key', key: custom.value.trim().replace(/^[a-z]$/, c => c.toUpperCase()) }); custom.select() } })
          box.append(h('div', { class: 'it-row' }, h('span', { class: 'it-name' }, 'キー入力 (UserInputService)'),
            h('div', { class: 'key-row' }, keys.map(k => h('button', { class: 'key-btn', onclick: () => this.sendInput({ kind: 'key', key: k }) }, k === 'LeftShift' ? 'Shift' : k === 'One' ? '1' : k === 'Two' ? '2' : k)), custom)))
        } else {
          box.append(h('div', { class: 'it-row' }, h('span', { class: 'it-name', title: it.path }, it.path || it.name),
            h('button', { class: 'btn small', disabled: !live, onclick: () => this.sendInput({ kind: it.kind, id: it.id }) }, it.label)))
        }
      }
      el.append(box)
    }
    if (g.drawings && g.drawings.length) el.append(this.drawingPreview(g.drawings))
    if (g.tree) {
      el.append(h('div', { class: 'game-title tree-title' }, 'オブジェクト'))
      el.append(this.treeNode(g.tree, 0, true))
    } else if (live) el.append(h('div', { class: 'out-hint' }, '実行中…'))
    el.scrollTop = scroll
  }

  treeNode(n, depth, open) {
    const kids = n.k || []
    const row = h('div', { class: 'gt-row', style: { paddingLeft: 6 + depth * 14 + 'px' } },
      kids.length ? icon(open ? 'chevronDown' : 'chevronRight', 12, 'twisty') : h('span', { class: 'twisty-space' }),
      h('span', { class: 'gt-icon c-' + classGroup(n.c) }), h('span', { class: 'gt-name' }, n.n), n.n !== n.c ? h('span', { class: 'gt-class' }, n.c) : null)
    const box = h('div', null, row)
    if (kids.length) {
      const kidBox = h('div', { class: open ? '' : 'hidden' })
      let built = false
      const build = () => { if (built) return; built = true; for (const k of kids) kidBox.append(this.treeNode(k, depth + 1, false)); if (n.more) kidBox.append(h('div', { class: 'gt-more', style: { paddingLeft: 20 + depth * 14 + 'px' } }, `… 他 ${n.more} 個`)) }
      if (open) build()
      row.addEventListener('click', () => { build(); kidBox.classList.toggle('hidden'); row.querySelector('.twisty').replaceWith(icon(kidBox.classList.contains('hidden') ? 'chevronRight' : 'chevronDown', 12, 'twisty')) })
      box.append(kidBox)
    }
    return box
  }

  drawingPreview(list) {
    const W = 1920, H = 1080
    const canvas = h('canvas', { width: W, height: H, class: 'draw-canvas' })
    const g = canvas.getContext('2d')
    g.fillStyle = '#1b2433'
    g.fillRect(0, 0, W, H)
    const col = c => c ? `rgb(${c.map(v => Math.round(v * 255)).join(',')})` : '#fff'
    for (const d of [...list].sort((a, b) => (a.ZIndex || 0) - (b.ZIndex || 0))) {
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
    return h('div', { class: 'draw-wrap' }, h('div', { class: 'game-title' }, `Drawing のプレビュー (${list.length} 個・1920×1080)`), canvas)
  }
}

// オブジェクト一覧のアイコン色の分類
function classGroup(c) {
  if (/Script$/.test(c)) return 'script'
  if (/Gui$|Frame$|Label$|Button$|TextBox$|^UI/.test(c)) return 'gui'
  if (/Part$|^Model$|Union|Terrain|SpawnLocation/.test(c)) return 'part'
  if (/Value$/.test(c)) return 'value'
  if (/Remote|Bindable/.test(c)) return 'remote'
  if (/^Player|Humanoid|Backpack|^Tool$/.test(c)) return 'player'
  if (/Folder|Service$|Storage$|^Workspace$|^Lighting$|^Players$|^Teams$|^Chat$/.test(c)) return 'folder'
  return 'other'
}

command('run', '実行', () => app.runner.run(), { icon: 'play', key: '⌘Enter' })
command('runSelection', '選択範囲だけ実行', () => app.runner.run({ selection: true }), { icon: 'play' })
command('stop', '停止', () => app.runner.stop(), { icon: 'stop' })
command('clearOutput', '出力をクリア', () => app.runner.clear(), { icon: 'trash' })
