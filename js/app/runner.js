// 実行パネル: 出力 / 問題 / ゲーム (GUI プレビュー・操作・オブジェクト一覧)
import * as vfs from './vfs.js'
import { app, command, refreshFiles, runCommand } from './app.js'
import { getSettings, getMode, on, emit, isTouch } from './store.js'
import { h, icon, toast, copyText, haptic, menu } from './ui.js'
import { forEachDiagnostic } from '../../vendor/codemirror.js'
import { scriptKindOf, KIND_LABELS, langOf } from '../editor/setup.js'
import { explainError } from './explain.js'
import { GuiStage, SCREENS } from './gui-preview.js'
import { DebugPanel, bpStore } from './debug-panel.js'
import { proxyTemplate, remoteFailBlock, remoteActions } from './remote-ui.js'

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
    // ゲーム画面 (実行のたびに作り直さず、差分だけ反映する)
    this.stage = new GuiStage({ onInput: m => this.sendInput(m), screen: this.screen })
    this.stage.onFull = () => { if (this.tab === 'game') this.renderGame() }
    this.stage.onVisible = on => { if (this.worker && this.running) this.worker.postMessage({ type: 'guiVisible', on }) }
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
    this.consoleEl = this.buildConsole()
    this.outWrap = h('div', { class: 'panel-view out-view' }, this.searchEl, this.outEl, this.consoleEl)
    this.probEl = h('div', { class: 'panel-view problems hidden' })
    this.gameEl = h('div', { class: 'panel-view game-view hidden' })
    this.debugEl = h('div', { class: 'panel-view debug-view hidden' })
    this.debug = new DebugPanel(this, this.debugEl)
    this.root.append(this.head, this.outWrap, this.probEl, this.debugEl, this.gameEl)
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
      t('debug', 'デバッグ', this.debug.paused ? { n: '⏸', kind: 'paused' } : bpStore.count() ? { n: bpStore.count(), kind: 'bp' } : null),
      t('game', 'ゲーム', g.gui || g.interact ? { n: '●', kind: this.waiting ? 'live' : 'dot' } : null),
    )
    this.actions.textContent = ''
    const btn = (ic, title, fn, on) => h('button', { class: 'icon-btn' + (on ? ' on' : ''), title, 'aria-label': title, onclick: fn }, icon(ic, 18))
    const narrow = document.body.dataset.layout === 'mobile'
    if (this.tab === 'output' && narrow) {
      // スマホ: 出力の操作は 1 つのメニューにまとめて、タブを広く使う
      this.actions.append(btn('more', '出力の操作', e => menu([
        { label: this.filter === 'all' ? 'エラーと警告だけ表示' : 'すべて表示', icon: 'filter', run: () => { this.filter = this.filter === 'all' ? 'issues' : 'all'; this.outEl.classList.toggle('only-issues', this.filter !== 'all'); this.renderTabs() } },
        { label: '出力を絞り込み', icon: 'search', run: () => { this.searchEl.classList.remove('hidden'); this.searchEl.focus() } },
        { label: '出力をコピー', icon: 'copy', run: () => copyText(this.outputText()).then(() => toast('出力をコピーしました', { icon: 'copy' })) },
        { label: 'クリア', icon: 'trash', run: () => this.clear() },
      ], e.currentTarget, { title: '出力' }), this.filter !== 'all'))
    } else if (this.tab === 'output') {
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
    this.debugEl.classList.toggle('hidden', tab !== 'debug')
    if (tab === 'debug') this.debug.render()
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
      // 大量の出力はアニメーションしない (速さ優先)
      if (items.length > 20) el.classList.add('no-anim')
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

  // 実行に渡すファイル一覧 (開いているファイルは編集中の内容)
  filesPayload() {
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
    return { files, wsFiles, wsFolders }
  }

  runOptions(kind, extra = {}) {
    const s = getSettings()
    const mode = getMode()
    const sc = SCREENS.find(x => x.id === this.screen) || SCREENS[0]
    // 選んだ画面 (スマホ / タブレット / PC) の端末として動かす
    return { timeLimit: s.timeLimit * 1000, maxRunTime: s.maxRunTime, executor: mode === 'executor', kind, touch: sc.id !== 'pc', device: sc.id, screen: [sc.w, sc.h], net: { proxy: proxyTemplate() }, ...extra }
  }

  async run({ selection = false, debug = false } = {}) {
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
    const { files, wsFiles, wsFolders } = this.filesPayload()
    if (!selection) files[path] = source
    // ブレークポイントがあれば自動でデバッグ実行
    const bps = bpStore.forRun()
    const useDebug = debug || (!selection && Object.keys(bps).length > 0)
    const w = this.ensureWorker()
    if (!w) { this.line('error', '実行エンジンを起動できませんでした。ページを再読み込みしてください'); return }
    this.game = { tree: null, gui: null, interact: null, drawings: null }
    this.stage.reset()
    this.stage.live = true
    this.waiting = false
    this.uiMode = false
    this.waitNoted = false
    this.sawGui = false
    this.holdScroll = false
    this.errors = 0
    this.errorEls = new Map()
    this.remoteShown = new Set()
    this.setRunning({ path, kind, debug: useDebug })
    this.t0 = performance.now()
    this.append([{ kind: 'meta', text: `${useDebug ? '🐞' : '▶'} ${path}${selection ? ' (選択範囲)' : ''} — ${KIND_LABELS[kind]}${useDebug ? ' (デバッグ)' : ''}` }])
    this.renderTabs()
    w.postMessage({
      type: 'run', source, path, chunkName: path, files, wsFiles, wsFolders, projectName: app.project.name,
      options: this.runOptions(kind, useDebug ? { debug: { breakpoints: bps, watches: this.debug.watches } } : {}),
    })
    w.postMessage({ type: 'guiVisible', on: !!this.stage.visible })
  }

  // ============================================================
  // コンソール: 式やコードをその場で実行 (実行後も同じ環境で続けられる)
  // ============================================================
  buildConsole() {
    const input = h('input', { class: 'console-input', placeholder: document.body.dataset.layout === 'mobile' ? '式やコードを入力 (例: 1 + 2)' : '式やコードを入力して Enter (例: 1 + 2, workspace:GetChildren())', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'コンソール' })
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
    return h('div', { class: 'console-row' }, h('span', { class: 'console-prompt' }, '›'), input,
      h('button', { class: 'icon-btn sm', title: '実行', 'aria-label': '実行', onclick: () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) }, icon('send', 16)))
  }

  evalConsole(code) {
    const w = this.ensureWorker()
    if (!w) return
    this.append([{ kind: 'input', text: code }])
    this.outEl.scrollTop = this.outEl.scrollHeight
    const kind = getMode() === 'executor' ? 'executor' : 'client'
    const init = app.project ? { path: 'コンソール', chunkName: 'コンソール', ...this.filesPayload(), projectName: app.project.name, options: this.runOptions(kind) } : null
    if (!this.running && init) { this.t0 = performance.now(); this.setRunning({ path: 'コンソール', kind, repl: true }) }
    w.postMessage({ type: 'eval', code, init })
  }

  debugValue(expr) { return this.debug.valueFor(expr) }

  setRunning(info) {
    this.running = info
    emit('running', info)
  }

  finished(reason) {
    this.debug.onFinished()
    if (this.running && this.running.repl) { this.waiting = false; this.setRunning(null); this.renderTabs(); return }
    const sec = ((performance.now() - this.t0) / 1000).toFixed(2)
    const msg = reason === 'stopped' ? `■ 停止しました (${sec} 秒)` : reason === 'error' ? `✕ エラーで終了 (${sec} 秒)` : reason === 'timeout' ? `■ 時間切れ (${sec} 秒)` : this.errors ? `✕ 終了 — エラー ${this.errors} 件 (${sec} 秒)` : `✓ 完了 (${sec} 秒)`
    this.append([{ kind: reason === 'error' || this.errors ? 'meta error' : 'meta', text: msg }])
    this.waiting = false
    this.stage.live = false
    this.stage.closeText(true)
    this.setRunning(null)
    this.renderTabs()
    if (this.tab === 'game') this.renderGame()
  }

  onMessage(m) {
    switch (m.type) {
      case 'output': this.append(m.items); break
      case 'error': this.showError(m); break
      case 'remoteFail': {
        // 外部スクリプトを取得できなかった: 中継・貼り付けのボタンを、続くエラー表示に入れる (URL ごとに 1 回)
        if (!this.remoteShown) this.remoteShown = new Set()
        if (this.remoteShown.has(m.url)) break
        this.remoteShown.add(m.url)
        const pending = { url: m.url, reason: m.reason }
        this.pendingRemote = pending
        // エラーにならなかった (pcall で包まれていた) ときは、別に案内を出す
        setTimeout(() => {
          if (this.pendingRemote !== pending) return
          this.pendingRemote = null
          if (!this.lineCount) this.outEl.textContent = ''
          this.outEl.append(remoteFailBlock(m.url, m.reason, { rerun: () => this.run() }))
          this.lineCount++
          this.last = null
        }, 600)
        break
      }
      case 'errorRepeat': {
        // 同じエラーの繰り返し: 回数だけ更新
        const el = this.errorEls && this.errorEls.get(m.text)
        if (el) {
          let b = el.querySelector('.oe-count')
          if (!b) { b = h('span', { class: 'oe-count', title: '同じエラーが繰り返し発生しています' }); el.querySelector('.oe-head').append(b) }
          b.textContent = '×' + m.n
        }
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
      case 'gui':
        this.stage.apply(m.patch)
        this.game.gui = this.stage.nodes.size > 0
        this.onGui()
        break
      case 'drawings':
        // Drawing (エグゼキューター) をゲーム画面に重ねて描く
        this.stage.setDrawings(m.list)
        this.game.drawings = m.list
        if (m.list.length) { this.game.gui = true; this.onGui() }
        break
      case 'guiAvail':
        // ゲーム画面が隠れている間に GUI ができた
        this.game.gui = true
        this.onGui()
        break
      case 'guiFocus':
        if (m.id !== null && this.tab !== 'game' && !this.stage.full) this.show('game')
        this.stage.focusText(m)
        break
      case 'interact':
        this.game.interact = m.interact
        if (this.tab === 'game') this.renderGame(true)
        break
      case 'uiMode':
        if (m.interact !== undefined) { this.game.interact = m.interact; if (this.tab === 'game') this.renderGame(true) }
        this.uiMode = true
        if (!this.waitNoted) { this.waitNoted = true; this.append([{ kind: 'meta', text: '🎮 GUI を表示しています — 「ゲーム」タブで操作できます (■ で終了)' }]) }
        break
      case 'waiting':
        this.applySnapshot(m)
        this.waiting = true
        if (!this.waitNoted) { this.waitNoted = true; this.append([{ kind: 'meta', text: '⏸ 操作を待っています — 「ゲーム」タブでボタンなどを試せます (■ で終了)' }]) }
        emit('running', this.running)
        this.onGui(true)
        this.renderTabs()
        break
      case 'resumed': this.waiting = false; emit('running', this.running); break
      case 'started':
        // コンソールから、終了した実行の環境を動かし直したとき
        if (m.repl && !this.running) { this.t0 = performance.now(); this.setRunning({ path: 'コンソール', kind: getMode() === 'executor' ? 'executor' : 'client', repl: true }) }
        break
      case 'paused': this.debug.onPaused(m); break
      case 'debugResumed': this.debug.onResumed(); break
      case 'expanded': this.debug.onExpanded(m); break
      case 'watchValues': this.debug.onWatchValues(m); break
      case 'evalDone': break
      case 'done':
        this.applySnapshot(m)
        if (this.running) this.finished(m.reason === 'idle' ? 'done' : m.reason)
        break
    }
  }

  applySnapshot(m) {
    if (m.gui) this.stage.apply(m.gui)
    if (m.drawings !== undefined) this.stage.setDrawings(m.drawings || [])
    Object.assign(this.game, { tree: m.tree, gui: this.stage.nodes.size > 0 || this.stage.drawList.length > 0, interact: m.interact, drawings: m.drawings })
  }

  onGui(force) {
    const has = !!(this.game.gui || this.game.interact)
    if (has && !this.sawGui) {
      this.sawGui = true
      this.renderTabs()
      // GUI ができたら、エラーがなければプレビューへ切り替える
      if (this.game.gui && !this.errors && this.tab === 'output') { this.show('game'); return }
    }
    if (this.tab === 'game' && force) this.renderGame(true)
  }

  showError(m) {
    this.errors++
    const s = getSettings()
    const kind = this.running ? this.running.kind : null
    const el = h('div', { class: 'out-error' })
    el.dataset.text = m.text
    if (!this.errorEls) this.errorEls = new Map()
    this.errorEls.set(m.text, el)
    const head = h('div', { class: 'oe-head' }, icon('close', 15))
    const msg = h('span', { class: 'oe-msg' })
    this.linkify(msg, m.text)
    head.append(msg)
    el.append(head)
    // 外部スクリプトを読み込めなかったエラー: 解決ボタンをすぐ下に
    if (this.pendingRemote && /HttpError|HttpGet|オフライン|時間切れ/.test(m.text)) {
      el.append(h('div', { class: 'oe-actions oe-remote' }, remoteActions(this.pendingRemote.url, this.pendingRemote.reason, { rerun: () => this.run() })))
      this.pendingRemote = null
    }
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
    this.debug.onFinished()
    this.resetWorker()
    if (!silent) this.finished('stopped')
    else { this.waiting = false; this.setRunning(null) }
  }

  sendInput(msg) {
    if (!this.running || !this.worker) {
      if (msg.phase !== 'move') toast('実行が終了しています。▶ でもう一度実行すると操作できます')
      return
    }
    if (msg.phase === 'down' || (!msg.phase && msg.kind !== 'text' && msg.kind !== 'wheel')) haptic(6)
    this.worker.postMessage({ type: 'input', ...msg })
  }

  setScreen(id) {
    this.screen = id
    try { localStorage.setItem('forgecode.screen', id) } catch {}
    this.stage.setScreen(id)
    const sc = SCREENS.find(x => x.id === id) || SCREENS[0]
    if (this.worker) this.worker.postMessage({ type: 'screen', w: sc.w, h: sc.h })
    this.renderGame()
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
    // ゲーム画面は使い回す (外してから中身を作り直す)
    if (this.stage.frame.parentElement === el) this.stage.frame.remove()
    el.textContent = ''
    if (!g.tree && !g.gui && !this.running) {
      el.append(h('div', { class: 'game-empty' },
        h('div', { class: 'ge-art' }, icon('gamepad', 30)),
        h('div', { class: 'ge-title' }, 'ゲーム画面'),
        h('div', { class: 'out-hint' }, 'スクリプトを実行すると、作った GUI がここに表示され、タップやドラッグで操作できます。ゲーム内のオブジェクト (Workspace・Players など) も確認できます'),
        getMode() === 'executor' ? h('button', { class: 'btn primary small', onclick: () => runCommand('uiGallery') }, icon('layers', 15), 'UI ライブラリで試す') : null))
      return
    }
    const live = !!this.running
    if (g.gui || live) {
      el.append(h('div', { class: 'game-head' },
        h('span', { class: 'game-title' }, 'ゲーム画面'),
        h('span', { class: 'game-state' + (live ? ' live' : '') }, live ? (isTouch ? 'タップ・ドラッグで操作できます' : 'クリック・ドラッグ・キー入力で操作できます') : '終了 (表示のみ)'),
        h('span', { class: 'sb-spacer' }),
        h('div', { class: 'seg' }, SCREENS.map(sc => h('button', { class: 'seg-btn' + (this.screen === sc.id ? ' on' : ''), title: `${sc.w} × ${sc.h}`, onclick: () => this.setScreen(sc.id) }, sc.label))),
        h('button', { class: 'icon-btn sm', title: '全画面で表示', 'aria-label': '全画面で表示', onclick: () => this.stage.toggleFull(true) }, icon('expand', 17))))
      if (!this.stage.full) this.stage.attach(el)
      else el.append(h('div', { class: 'out-hint' }, '全画面で表示中です'))
    }
    if (!g.gui && !live && getMode() === 'executor') {
      el.append(h('div', { class: 'game-tip' }, icon('layers', 16), h('span', null, 'GUI はありませんでした。UI ライブラリを使うと、すぐに操作できる画面を作れます'), h('button', { class: 'btn small', onclick: () => runCommand('uiGallery') }, '試す')))
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
