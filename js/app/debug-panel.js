// デバッグパネル: 一時停止中の変数・ウォッチ・呼び出し履歴・ブレークポイントの一覧
// と、エディタの上に浮かぶ操作ボタン (続行 / ステップ / 停止)
import { app, runCommand, command } from './app.js'
import { emit, on } from './store.js'
import { h, icon, toast, promptDialog, haptic, menu } from './ui.js'
import { toggleBreakpoint, setBreakpointList, debugLineEffect, breakpointsOf, bpEffect } from '../editor/breakpoints.js'

// ============================================================
// ブレークポイントの保存 (プロジェクトごと・localStorage)
// ============================================================
export const bpStore = {
  pid: null,
  map: new Map(), // path → [{ line, cond, log, off }]
  key() { return 'forgecode.bp.' + this.pid },
  load(pid) {
    this.pid = pid
    this.map = new Map()
    try {
      const raw = JSON.parse(localStorage.getItem(this.key()) || '{}')
      for (const [p, list] of Object.entries(raw)) if (Array.isArray(list) && list.length) this.map.set(p, list)
    } catch { /* 壊れていたら空から */ }
  },
  save() {
    if (!this.pid) return
    try { localStorage.setItem(this.key(), JSON.stringify(Object.fromEntries(this.map))) } catch {}
  },
  get(path) { return this.map.get(path) || [] },
  set(path, list) {
    const clean = list.map(b => ({ line: b.line, ...(b.cond ? { cond: b.cond } : {}), ...(b.log ? { log: b.log } : {}), ...(b.off ? { off: true } : {}) }))
    if (clean.length) this.map.set(path, clean); else this.map.delete(path)
    this.save()
    emit('breakpoints')
  },
  // 実行に渡す形 (無効にしたものと、もう無いファイルを除く)
  forRun() {
    const out = {}
    for (const [p, list] of this.map) {
      if (!app.files.some(f => f.path === p)) continue
      const on = list.filter(b => !b.off)
      if (on.length) out[p] = on
    }
    return out
  },
  count() { let n = 0; for (const l of this.map.values()) n += l.length; return n },
  renamed(from, to) {
    for (const [p, list] of [...this.map]) {
      if (p === from || p.startsWith(from + '/')) { this.map.delete(p); this.map.set(to + p.slice(from.length), list) }
    }
    this.save()
  },
}

on('project', p => bpStore.load(p.id))
on('renamed', ({ from, to }) => bpStore.renamed(from, to))

// ============================================================
// パネル
// ============================================================
const REASONS = { breakpoint: 'ブレークポイント', step: 'ステップ実行', pause: '一時停止', condError: '条件式のエラー' }
const WATCH_KEY = 'forgecode.watches'

export class DebugPanel {
  constructor(runner, el) {
    this.runner = runner
    this.el = el
    this.paused = null
    this.open = { locals: true, globals: false, watches: true, stack: true, bps: true }
    this.expanded = new Map() // 参照番号 → 子の一覧
    this.pending = new Map()
    this.reqSeed = 0
    try { this.watches = JSON.parse(localStorage.getItem(WATCH_KEY) || '[]') } catch { this.watches = [] }
    this.float = h('div', { class: 'debug-float hidden', role: 'toolbar', 'aria-label': 'デバッグ操作' })
    on('breakpoints', () => { if (this.visible()) this.render() })
    on('running', () => this.renderFloat())
  }

  visible() { return this.runner.tab === 'debug' && !this.el.classList.contains('hidden') }

  get debugging() { return !!(this.runner.running && this.runner.running.debug) }

  // ---- 実行エンジンからの通知 ----
  onPaused(info) {
    this.paused = info
    this.expanded = new Map()
    haptic(12)
    // 止まった行を開いて表示
    if (info.file && app.files.some(f => f.path === info.file)) {
      app.editors.open(info.file).then(() => {
        const v = app.editors.viewFor(info.file)
        if (!v) return
        app.editors.gotoLine(info.line)
        v.dispatch({ effects: debugLineEffect.of(info.line) })
      })
    }
    this.runner.renderTabs()
    if (this.runner.tab !== 'debug') this.runner.show('debug')
    else this.render()
    this.renderFloat()
    runCommand('togglePanel', true)
    emit('running', this.runner.running)
  }

  onResumed() {
    this.paused = null
    this.clearLine()
    this.render()
    this.renderFloat()
    this.runner.renderTabs()
    emit('running', this.runner.running)
  }

  onFinished() {
    this.paused = null
    this.clearLine()
    this.renderFloat()
    if (this.visible()) this.render()
  }

  clearLine() {
    for (const v of app.editors.views) if (v) v.dispatch({ effects: debugLineEffect.of(null) })
  }

  send(action) {
    if (!this.runner.worker || !this.runner.running) return
    haptic(6)
    if (action !== 'pause' && !this.paused) return
    this.runner.worker.postMessage({ type: 'debug', action })
  }

  // ---- 値の表示 ----
  valueFor(expr) {
    const p = this.paused
    if (!p) return null
    const parts = expr.split(/[.:]/)
    const root = p.locals.find(v => v.name === parts[0]) || p.globals.find(v => v.name === parts[0])
    if (!root) return null
    if (parts.length === 1) return root.value
    // a.b.c: 展開済みのものだけたどる
    let cur = root.value
    for (const key of parts.slice(1)) {
      const kids = cur.ref && this.expanded.get(cur.ref)
      const hit = kids && kids.find(k => k.name === key)
      if (!hit) return null
      cur = hit.value
    }
    return cur
  }

  expand(ref) {
    return new Promise(resolve => {
      if (!this.runner.worker) return resolve([])
      const id = ++this.reqSeed
      this.pending.set(id, resolve)
      this.runner.worker.postMessage({ type: 'expand', id, ref })
    })
  }
  onExpanded(m) {
    const r = this.pending.get(m.id)
    if (r) { this.pending.delete(m.id); r(m.items) }
  }

  setWatches(list) {
    this.watches = list
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(list)) } catch {}
    if (this.runner.worker && this.runner.running && this.runner.running.debug) this.runner.worker.postMessage({ type: 'watches', list })
    else this.render()
  }
  onWatchValues(m) {
    if (this.paused) { this.paused.watches = m.watches; this.render() }
  }

  // ---- 描画 ----
  renderFloat() {
    const f = this.float
    if (!f.isConnected && app.editors) app.editors.root.append(f)
    const show = this.debugging
    f.classList.toggle('hidden', !show)
    if (!show) return
    f.textContent = ''
    const b = (ic, title, action, cls = '') => h('button', { class: 'df-btn ' + cls, title, 'aria-label': title, onclick: () => this.send(action) }, icon(ic, 18))
    if (this.paused) {
      f.append(
        b('debugContinue', '続行 (F5)', 'continue', 'go'),
        b('stepOver', 'ステップオーバー (F10): 次の行へ', 'over'),
        b('stepInto', 'ステップイン (F11): 関数の中へ', 'in'),
        b('stepOut', 'ステップアウト (⇧F11): 関数の外へ', 'out'))
    } else f.append(b('pause', '一時停止', 'pause'))
    f.append(h('button', { class: 'df-btn stop', title: '停止 (⇧F5)', 'aria-label': '停止', onclick: () => runCommand('stop') }, icon('stop', 16)))
    f.classList.toggle('is-paused', !!this.paused)
  }

  render() {
    const el = this.el
    const scroll = el.scrollTop
    el.textContent = ''
    const p = this.paused
    // 状態と操作
    const bar = h('div', { class: 'dbg-bar' })
    if (p) {
      bar.append(h('div', { class: 'dbg-state paused' }, icon('pause', 14), h('span', null, `${p.file.split('/').pop()} の ${p.line} 行目で停止中`), h('span', { class: 'dbg-reason' }, REASONS[p.reason && p.reason.kind] || '')))
      if (p.reason && p.reason.kind === 'condError') bar.append(h('div', { class: 'dbg-warn' }, `条件式「${p.reason.error}」`))
    } else if (this.debugging) bar.append(h('div', { class: 'dbg-state running' }, h('span', { class: 'pulse' }), 'デバッグ実行中 — ブレークポイントで止まります'))
    else bar.append(h('div', { class: 'dbg-state' }, icon('bug', 14), 'デバッグしていません'))
    const btns = h('div', { class: 'dbg-btns' })
    const b = (ic, label, fn, cls = '', disabled = false) => h('button', { class: 'btn small ' + cls, disabled, onclick: fn }, icon(ic, 15), label)
    if (p) {
      btns.append(
        b('debugContinue', '続行', () => this.send('continue'), 'primary'),
        b('stepOver', 'ステップ', () => this.send('over')),
        b('stepInto', '中へ', () => this.send('in')),
        b('stepOut', '外へ', () => this.send('out')),
        b('stop', '停止', () => runCommand('stop'), 'danger'))
    } else if (this.debugging) btns.append(b('pause', '一時停止', () => this.send('pause')), b('stop', '停止', () => runCommand('stop'), 'danger'))
    else btns.append(b('bug', 'デバッグ実行', () => runCommand('debugRun'), 'primary'))
    bar.append(btns)
    el.append(bar)

    if (p) {
      el.append(this.section('locals', `変数 (${p.locals.length})`, () => this.varList(p.locals, 'ローカル変数はありません')))
      el.append(this.section('globals', `グローバル (${p.globals.length})`, () => this.varList(p.globals, 'スクリプトが作ったグローバル変数はありません')))
    }
    el.append(this.section('watches', `ウォッチ (${this.watches.length})`, () => this.watchList(), h('button', { class: 'icon-btn sm', title: '式を追加', 'aria-label': '式を追加', onclick: e => { e.stopPropagation(); this.addWatch() } }, icon('plus', 16))))
    if (p) el.append(this.section('stack', '呼び出し履歴', () => h('div', { class: 'dbg-list' }, p.stack.map((f, i) => h('button', { class: 'dbg-frame' + (i === 0 ? ' top' : ''), onclick: () => { if (app.files.some(x => x.path === f.file)) app.editors.open(f.file, { line: f.line }) } }, h('span', { class: 'fr-name' }, f.name), h('span', { class: 'fr-loc' }, `${f.file}:${f.line}`))))))
    const total = bpStore.count()
    el.append(this.section('bps', `ブレークポイント (${total})`, () => this.bpList(), total ? h('button', { class: 'icon-btn sm', title: 'すべて削除', 'aria-label': 'すべて削除', onclick: e => { e.stopPropagation(); this.clearAll() } }, icon('trash', 15)) : null))
    if (!p && !this.debugging && !total) {
      el.append(h('div', { class: 'out-hint dbg-hint' },
        h('b', null, '使い方'), h('br'),
        '1. 止めたい行の行番号の左をタップすると赤い点 (ブレークポイント) が付きます', h('br'),
        '2. ▶ で実行すると、その行の手前で止まります', h('br'),
        '3. 変数の値を確認しながら「ステップ」で 1 行ずつ進められます', h('br'),
        '赤い点を長押しすると、条件付き (例: i == 10) やログ出力 (止めずに値を表示) にできます'))
    }
    el.scrollTop = scroll
  }

  section(id, title, body, extra) {
    const open = this.open[id]
    const head = h('div', { class: 'dbg-sec-head', role: 'button', tabindex: '0', onclick: () => { this.open[id] = !this.open[id]; this.render() } },
      icon(open ? 'chevronDown' : 'chevronRight', 14), h('span', null, title), h('span', { class: 'sb-spacer' }), extra || null)
    return h('div', { class: 'dbg-sec' }, head, open ? body() : null)
  }

  varList(list, empty) {
    if (!list.length) return h('div', { class: 'dbg-empty' }, empty)
    const box = h('div', { class: 'dbg-list' })
    for (const v of list) box.append(this.varRow(v.name, v.value, 0))
    return box
  }

  varRow(name, value, depth) {
    const wrap = h('div', { class: 'dbg-var-wrap' })
    const canOpen = !!value.ref
    const isOpen = canOpen && this.expanded.has(value.ref)
    const row = h('div', { class: 'dbg-var' + (canOpen ? ' can-open' : ''), style: { paddingLeft: 8 + depth * 14 + 'px' } },
      canOpen ? icon(isOpen ? 'chevronDown' : 'chevronRight', 12, 'twisty') : h('span', { class: 'twisty-space' }),
      h('span', { class: 'v-name' }, name), h('span', { class: 'v-eq' }, '='), h('span', { class: 'v-val t-' + value.t }, value.v))
    if (canOpen) {
      row.addEventListener('click', async () => {
        if (this.expanded.has(value.ref)) { this.expanded.delete(value.ref); this.render(); return }
        const items = await this.expand(value.ref)
        this.expanded.set(value.ref, items)
        this.render()
      })
    }
    wrap.append(row)
    if (isOpen) {
      const kids = this.expanded.get(value.ref)
      if (!kids.length) wrap.append(h('div', { class: 'dbg-empty', style: { paddingLeft: 28 + depth * 14 + 'px' } }, '(空)'))
      for (const k of kids) wrap.append(this.varRow(k.name, k.value, depth + 1))
    }
    return wrap
  }

  watchList() {
    const box = h('div', { class: 'dbg-list' })
    if (!this.watches.length) box.append(h('div', { class: 'dbg-empty' }, '＋ で式を追加すると、止まるたびに値を表示します (例: player.Name, #list)'))
    const vals = this.paused ? this.paused.watches || [] : []
    this.watches.forEach((w, i) => {
      const r = vals.find(x => x.code === w)
      const val = !this.paused ? h('span', { class: 'v-val muted' }, '—') : r && r.error ? h('span', { class: 'v-val t-error' }, r.error) : r ? h('span', { class: 'v-val t-' + r.value.t }, r.value.v) : h('span', { class: 'v-val muted' }, '…')
      box.append(h('div', { class: 'dbg-var watch' },
        h('span', { class: 'v-name' }, w), h('span', { class: 'v-eq' }, '='), val, h('span', { class: 'sb-spacer' }),
        h('button', { class: 'icon-btn sm', title: '削除', 'aria-label': '削除', onclick: () => this.setWatches(this.watches.filter((_, j) => j !== i)) }, icon('close', 14))))
    })
    return box
  }

  async addWatch() {
    const code = await promptDialog('ウォッチ式を追加', { placeholder: '例: player.Health / #items / x * 2', okLabel: '追加' })
    if (code && code.trim()) this.setWatches([...this.watches, code.trim()])
  }

  bpList() {
    const box = h('div', { class: 'dbg-list' })
    const entries = [...bpStore.map].sort((a, b) => a[0].localeCompare(b[0]))
    if (!entries.length) box.append(h('div', { class: 'dbg-empty' }, '行番号の左をタップすると追加できます (F9)'))
    for (const [path, list] of entries) {
      for (const bp of [...list].sort((a, b) => a.line - b.line)) {
        const desc = bp.log ? `ログ: ${bp.log}` : bp.cond ? `条件: ${bp.cond}` : ''
        const row = h('div', { class: 'dbg-bp' + (bp.off ? ' off' : '') },
          h('button', { class: 'bp-dot' + (bp.log ? ' log' : bp.cond ? ' cond' : ''), title: bp.off ? '有効にする' : '一時的に無効にする', 'aria-label': '有効・無効の切り替え', onclick: () => this.updateBp(path, bp.line, { ...bp, off: !bp.off }) }),
          h('button', { class: 'bp-loc', onclick: () => app.editors.open(path, { line: bp.line }) }, h('span', null, `${path}:${bp.line}`), desc ? h('span', { class: 'bp-desc' }, desc) : null),
          h('button', { class: 'icon-btn sm', title: '条件・ログを編集', 'aria-label': '条件・ログを編集', onclick: e => this.editBp(path, bp.line, e.currentTarget) }, icon('edit', 14)),
          h('button', { class: 'icon-btn sm', title: '削除', 'aria-label': '削除', onclick: () => this.updateBp(path, bp.line, null) }, icon('close', 14)))
        box.append(row)
      }
    }
    return box
  }

  // 1 つのブレークポイントを変更 (data = null で削除)
  updateBp(path, line, data) {
    const v = app.editors.viewFor(path)
    if (v) {
      // 開いているファイル: エディタの状態を変える (保存は onBreakpoints から)
      const has = breakpointsOf(v.state).some(b => b.line === line)
      if (data || has) toggleBreakpoint(v, line, data || undefined)
    } else {
      const list = bpStore.get(path).filter(b => b.line !== line)
      if (data) list.push({ ...data, line })
      bpStore.set(path, list)
      // 閉じているタブの状態にも反映 (次に表示したときに古い点が出ないように)
      const doc = app.editors.docs.get(path)
      if (doc) doc.state = doc.state.update({ effects: bpEffect.of({ list }) }).state
    }
    this.syncRun()
    this.render()
  }

  async editBp(path, line, anchor) {
    const bp = bpStore.get(path).find(b => b.line === line) || { line }
    menu([
      { label: '条件を設定 (例: i == 10)', icon: 'filter', run: async () => {
        const cond = await promptDialog(`${path}:${line} の条件`, { value: bp.cond || '', placeholder: '例: i == 10 / player.Name == "Alex"', label: 'この式が true のときだけ止まります (空にすると常に止まる)' })
        if (cond !== null) this.updateBp(path, line, { cond: cond.trim(), log: '' })
      } },
      { label: 'ログポイントにする', icon: 'terminal', run: async () => {
        const log = await promptDialog(`${path}:${line} のログ`, { value: bp.log || '', placeholder: '例: i = {i}, 体力 = {hum.Health}', label: '止めずに出力へ表示します。{ } の中は式として評価されます' })
        if (log !== null) this.updateBp(path, line, { log: log.trim(), cond: '' })
      } },
      bp.cond || bp.log ? { label: '普通のブレークポイントに戻す', icon: 'bug', run: () => this.updateBp(path, line, {}) } : null,
      { label: bp.off ? '有効にする' : '無効にする', run: () => this.updateBp(path, line, { ...bp, off: !bp.off }) },
      { label: '削除', icon: 'trash', run: () => this.updateBp(path, line, null) },
    ].filter(Boolean), anchor, { title: `${path}:${line}` })
  }

  clearAll() {
    for (const path of [...bpStore.map.keys()]) {
      const v = app.editors.viewFor(path)
      if (v) setBreakpointList(v, [])
      bpStore.set(path, [])
    }
    // 開いているが表示していないタブの状態も消す
    for (const doc of app.editors.docs.values()) if (!app.editors.viewFor(doc.path)) doc.state = doc.state.update({ effects: bpEffect.of({ list: [] }) }).state
    this.syncRun()
    this.render()
    toast('ブレークポイントをすべて削除しました')
  }

  // 実行中なら、ブレークポイントの変更を実行エンジンへ
  syncRun() {
    if (this.runner.worker && this.debugging) this.runner.worker.postMessage({ type: 'breakpoints', list: bpStore.forRun() })
  }
}

// ---- コマンド ----
command('toggleBreakpoint', 'ブレークポイントの切り替え', () => {
  const v = app.editors.activeView()
  const doc = app.editors.activeDoc()
  if (!v || !doc || doc.lang !== 'luau') return
  toggleBreakpoint(v, v.state.doc.lineAt(v.state.selection.main.head).number)
  haptic(8)
}, { icon: 'bug', key: 'F9' })
command('debugRun', 'デバッグ実行', () => app.runner.run({ debug: true }), { icon: 'bug' })
command('debugContinue', 'デバッグ: 続行', () => app.runner.debug.send('continue'), { icon: 'debugContinue', key: 'F5' })
command('debugStepOver', 'デバッグ: ステップオーバー', () => app.runner.debug.send('over'), { icon: 'stepOver', key: 'F10' })
command('debugStepInto', 'デバッグ: ステップイン', () => app.runner.debug.send('in'), { icon: 'stepInto', key: 'F11' })
command('debugStepOut', 'デバッグ: ステップアウト', () => app.runner.debug.send('out'), { icon: 'stepOut', key: '⇧F11' })
command('debugPause', 'デバッグ: 一時停止', () => app.runner.debug.send('pause'), { icon: 'pause' })
command('clearBreakpoints', 'ブレークポイントをすべて削除', () => app.runner.debug.clearAll(), { icon: 'trash' })
command('showDebug', 'デバッグパネルを表示', () => { runCommand('togglePanel', true); app.runner.show('debug') }, { icon: 'bug' })
