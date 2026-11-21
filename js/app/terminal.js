// ターミナル (画面)
// ・プロジェクトのファイルをコマンドで扱うシェル (shell.js) と、Python の対話モード (>>>)
// ・python ファイル.py の出力・input()・エラーもここに出る (図やゲームの画面は実行画面に)
// ・入力欄は最後の行にずっと置いておく (スマホのキーボードが、コマンドのたびに閉じないように)
// ・色 (ANSI)・\r での書き換え (進み具合の表示)・Tab の補完・↑↓ の履歴・Ctrl+C / D / L・貼り付けた複数行
import { app, runCommand, writeProjectFile, deletePath, renamePath, refreshFiles } from './app.js'
import * as vfs from './vfs.js'
import { on, emit, isTouch } from './store.js'
import { h, icon, haptic } from './ui.js'
import { AnsiState, appendAnsi, stripAnsi } from './ansi.js'
import { Shell, C, showPath, strWidth } from './shell.js'
import { safeHtml } from './runner.js'

const MAX_LINES = 4000
const HIST = 'forgecode.term.history'
const PYHIST = 'forgecode.term.pyhistory'
const STATE = 'forgecode.term.state'
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d } catch { return d } }
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }

// スマホのキーボードにない記号・操作
const KEYS = [
  ['Tab', 'tab'], ['^C', 'ctrl-c'], ['↑', 'up'], ['↓', 'down'], ['←', 'left'], ['→', 'right'],
  ['|'], ['>'], ['-'], ['/'], ['~'], ['.'], ['*'], ['_'], ['"'], ["'"], ['$'], ['&'], [';'], ['='], [':'], ['('], [')'], ['['], [']'], ['{'], ['}'], ['#'], ['\\'],
  ['^D', 'ctrl-d'], ['^L', 'ctrl-l'],
]

export class Terminal {
  // index: 何番目のターミナルか (2 つ目からは、状態を別に残す)
  constructor({ onState, index = 0 } = {}) {
    this.onState = onState || (() => {})
    this.index = index
    this.stateKey = index ? `${STATE}.${index}` : STATE
    this.shellBuf = []        // 続きの行 (for … do の後など)
    this.ansi = new AnsiState()
    this.cur = null           // まだ終わっていない行 (改行のない出力)
    this.crPending = false
    this.mode = 'shell'       // shell | python
    this.busy = false
    this.pending = null       // プログラムの input() を待っている { resolve, password }
    this.typeahead = []       // 実行中に打った行・貼り付けた行
    this.replBuf = []
    this.history = load(HIST, [])
    this.pyHistory = load(PYHIST, [])
    this.hi = -1
    this.draft = ''
    const st = load(this.stateKey, {})
    const samePid = app.project && st.pid === app.project.id
    this.shell = new Shell(this.host(), { cwd: samePid ? st.cwd || '' : '', env: st.env || {}, aliases: st.aliases || {} })
    this.pid = app.project ? app.project.id : null
    this.build()
    this.restore(st, samePid)
    this.prompt()
    on('project', p => this.projectChanged(p))
    const save = () => this.saveState()
    addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', () => { if (document.hidden) save() })
  }

  // ============================================================
  // 画面
  // ============================================================
  build() {
    this.screen = h('div', { class: 'term-screen', role: 'log', 'aria-live': 'polite' })
    this.promptEl = h('span', { class: 'term-prompt' })
    this.input = h('input', { class: 'term-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'send', 'aria-label': 'ターミナルの入力' })
    // 履歴からの提案 (薄い文字。→ で確定) と、Ctrl+R の検索
    this.ghost = h('span', { class: 'term-ghost', 'aria-hidden': 'true' })
    this.inputWrap = h('span', { class: 'term-input-wrap' }, this.input, this.ghost)
    this.inputLine = h('div', { class: 'tl term-in' }, this.promptEl, this.inputWrap)
    this.screen.append(this.inputLine)
    this.keys = h('div', { class: 'term-keys' }, KEYS.map(([label, act]) => this.keyButton(label, act)))
    this.el = h('div', { class: 'term', 'data-no-i18n': '' }, this.screen, this.keys)
    this.input.addEventListener('keydown', e => this.onKey(e))
    this.input.addEventListener('paste', e => this.onPaste(e))
    this.input.addEventListener('input', () => { if (this.atEnd()) this.scrollEnd(); if (this.search) this.searchUpdate(); else this.suggest() })
    this.input.addEventListener('scroll', () => this.suggest())
    this.input.addEventListener('blur', () => { if (!this.search) this.ghost.textContent = '' })
    this.ghost.addEventListener('pointerdown', e => { e.preventDefault(); this.acceptSuggestion() })
    // 文字を選んでいないときにタップしたら、入力欄へ
    this.screen.addEventListener('click', e => {
      if (e.target.closest('a, button, img, .term-html')) return
      const sel = getSelection && getSelection()
      if (sel && String(sel)) return
      this.focus()
    })
    // キーボードが出て画面が小さくなったときも、いちばん下 (入力欄) を見せ続ける
    this.stuck = true
    this.screen.addEventListener('scroll', () => { this.stuck = this.atEnd() }, { passive: true })
    new ResizeObserver(() => { this.charW = 0; if (this.stuck) this.scrollEnd() }).observe(this.screen)
    this.input.addEventListener('focus', () => setTimeout(() => this.scrollEnd(), 250))
  }

  keyButton(label, act) {
    const b = h('button', { class: 'tk-key' + (act ? ' fn' : ''), 'aria-label': label, tabindex: '-1' }, label)
    // フォーカスを入力欄に残す (キーボードが閉じないように)
    b.addEventListener('pointerdown', e => e.preventDefault())
    b.addEventListener('mousedown', e => e.preventDefault())
    b.addEventListener('click', e => {
      e.preventDefault()
      haptic(5)
      const inp = this.input
      if (!act) { this.insert(label); return }
      if (act === 'tab') this.tab()
      else if (act === 'ctrl-c') this.interrupt()
      else if (act === 'ctrl-d') this.eof()
      else if (act === 'ctrl-l') this.clear()
      else if (act === 'up') this.histMove(1)
      else if (act === 'down') this.histMove(-1)
      else if (act === 'right' && this.ghost.textContent && inp.selectionStart === inp.value.length) this.acceptSuggestion()
      else if (act === 'left' || act === 'right') {
        const p = Math.max(0, Math.min(inp.value.length, (inp.selectionStart ?? 0) + (act === 'left' ? -1 : 1)))
        inp.setSelectionRange(p, p)
      }
      if (document.activeElement !== inp) inp.focus({ preventScroll: true })
    })
    return b
  }

  focus() {
    this.input.focus({ preventScroll: true })
    this.scrollEnd()
  }
  atEnd() { const s = this.screen; return s.scrollHeight - s.scrollTop - s.clientHeight < 40 }
  scrollEnd() {
    if (this.scrollRaf) return
    this.scrollRaf = requestAnimationFrame(() => { this.scrollRaf = 0; this.screen.scrollTop = this.screen.scrollHeight })
  }
  // 1 行に入る文字数 (ls の列などに使う)
  cols() {
    if (!this.charW) {
      const probe = h('span', { class: 'term-probe' }, '0000000000')
      this.screen.append(probe)
      this.charW = probe.getBoundingClientRect().width / 10 || 7.5
      probe.remove()
    }
    return Math.max(20, Math.floor((this.screen.clientWidth - 20) / this.charW) || 80)
  }

  // ============================================================
  // 出力
  // ============================================================
  line() {
    if (!this.cur) { this.cur = h('div', { class: 'tl' }); this.screen.insertBefore(this.cur, this.inputLine) }
    return this.cur
  }
  endLine() {
    if (!this.cur) this.line()
    this.cur = null
    this.crPending = false
  }
  // 色の命令 (J: 画面を消す, K: 行を消す) — 消した後は新しい行に続ける
  ctl(cmd, params) {
    if (cmd === 'J' && (params === '2' || params === '3')) { this.clear(true); return this.line() }
    if (cmd === 'K') { if (this.cur) this.cur.replaceChildren(); return this.line() }
    return null
  }
  write(text, cls = '') {
    if (!text) return
    const stick = this.atEnd()
    const parts = String(text).split(/(\r\n|\n|\r)/)
    for (const p of parts) {
      if (p === '\n' || p === '\r\n') { this.endLine(); continue }
      if (p === '\r') { this.crPending = true; continue }
      if (!p) continue
      // \r の後の文字は、その行を書き直す (進み具合の表示など)
      if (this.crPending) { this.crPending = false; if (this.cur) this.cur.replaceChildren() }
      let target = this.line()
      if (cls) { const span = h('span', { class: cls }); target.append(span); target = span }
      appendAnsi(target, p, this.ansi, (cmd, params) => {
        const np = this.ctl(cmd, params)
        if (np && cls) { const span = h('span', { class: cls }); np.append(span); return span }
        return np
      })
    }
    this.trim()
    if (stick) this.scrollEnd()
  }
  // アプリからのお知らせ (薄い文字の 1 行)
  note(text) {
    if (this.cur) this.endLine()
    const el = h('div', { class: 'tl t-note' }, text)
    this.screen.insertBefore(el, this.inputLine)
    this.trim()
    this.scrollEnd()
    return el
  }
  trim() {
    const n = this.screen.childElementCount - 1
    if (n <= MAX_LINES) return
    let extra = n - MAX_LINES + 300
    while (extra-- > 0 && this.screen.firstElementChild !== this.inputLine) this.screen.firstElementChild.remove()
  }
  clear(keepInput = true) {
    while (this.screen.firstElementChild && this.screen.firstElementChild !== this.inputLine) this.screen.firstElementChild.remove()
    this.cur = null
    if (keepInput) this.focus()
  }
  // 画像・表・リンク (プログラムの display() / PIL の show() など)
  block(m) {
    if (this.cur) this.endLine()
    let el = null
    if (m.type === 'image') el = h('div', { class: 'tl term-media' }, h('img', { class: 'term-img', src: `data:${m.mime || 'image/png'};base64,${m.data}`, alt: '図' }))
    else if (m.type === 'html') { try { el = h('div', { class: 'tl term-html' }, safeHtml(m.html)) } catch { this.write((m.text || '') + '\n'); return } }
    else if (m.type === 'link') {
      let u = null
      try { u = new URL(m.url) } catch {}
      el = u && /^https?:$/.test(u.protocol) ? h('div', { class: 'tl' }, h('a', { href: u.href, target: '_blank', rel: 'noopener noreferrer' }, u.href)) : h('div', { class: 'tl' }, String(m.url))
    }
    if (!el) return
    this.screen.insertBefore(el, this.inputLine)
    this.trim()
    this.scrollEnd()
  }

  // ============================================================
  // 入力
  // ============================================================
  setPrompt(text) {
    this.promptEl.replaceChildren()
    appendAnsi(this.promptEl, text, new AnsiState())
  }
  prompt() {
    if (this.cur) this.endLine()
    // 実行中に打ちかけた文字は消さない
    const typed = this.input.value && this.input.value !== this.autoFill ? this.input.value : null
    let fill = ''
    if (this.mode === 'python') {
      const cont = this.replBuf.length > 0
      this.setPrompt(`${C.bold}\x1b[35m${cont ? '...' : '>>>'}${C.reset} `)
      fill = cont ? this.indent || '' : ''
    } else if (this.shellBuf.length) {
      this.setPrompt(`${C.gray}>${C.reset} `)
    } else {
      const fail = this.shell.status !== 0 && this.shell.status !== 130
      this.setPrompt(`${fail ? C.red + '✗ ' + C.reset : ''}${C.bgreen}forge${C.reset}:${C.bblue}${showPath(this.shell.cwd)}${C.reset}$ `)
    }
    this.autoFill = fill
    this.input.value = typed ?? fill
    this.ghost.textContent = ''
    this.input.type = 'text'
    this.inputLine.classList.remove('waiting')
    this.hi = -1
    this.scrollEnd()
    this.onState()
    this.nextTypeahead()
  }
  // 実行中に打った行・貼り付けた行を、順に送る
  nextTypeahead() {
    if (!this.typeahead.length || (this.busy && !this.pending)) return
    const line = this.typeahead.shift()
    setTimeout(() => { if (!this.busy || this.pending) { this.input.value = line; this.submit() } else this.typeahead.unshift(line) }, 0)
  }
  // 入力した行を、確定した行として残す
  commit(text, extra = '') {
    if (this.cur) this.endLine()
    const el = h('div', { class: 'tl' })
    el.append(...this.promptEl.childNodes)
    el.append(h('span', { class: 't-typed' }, text))
    if (extra) el.append(h('span', { class: 't-note' }, extra))
    this.screen.insertBefore(el, this.inputLine)
    this.promptEl.replaceChildren()
    this.trim()
    this.scrollEnd()
  }

  // プログラムの input(): いまの行 (案内の文字) の横で入力を受ける
  requestInput({ password = false } = {}) {
    return new Promise(resolve => {
      // 案内の文字 (改行のない出力) を入力欄の前へ
      this.promptEl.replaceChildren()
      if (this.cur) { this.promptEl.append(...this.cur.childNodes); this.cur.remove(); this.cur = null }
      this.pending = { resolve, password }
      this.input.type = password ? 'password' : 'text'
      this.input.value = ''
      this.input.placeholder = ''
      this.inputLine.classList.add('waiting')
      this.onState()
      this.scrollEnd()
      if (document.activeElement !== this.input && this.visible()) this.input.focus({ preventScroll: true })
      // 前もって打ってあった行があれば、それを使う
      this.nextTypeahead()
    })
  }
  cancelInput() {
    if (!this.pending) return
    const p = this.pending
    this.pending = null
    this.commit('')
    this.input.type = 'text'
    this.inputLine.classList.remove('waiting')
    p.resolve(null)
  }
  visible() { return !!this.el.offsetParent }

  submit() {
    const text = this.input.value
    this.input.value = ''
    this.hi = -1
    if (this.pending) {
      const p = this.pending
      this.pending = null
      this.commit(p.password ? '•'.repeat(Math.min(12, text.length)) : text)
      this.input.type = 'text'
      this.inputLine.classList.remove('waiting')
      p.resolve(text)
      return
    }
    if (this.busy) {
      // 実行中に打った行は、次に入力を求められたとき (または終わった後) に使う
      this.typeahead.push(text)
      this.note('⏎ ' + text).classList.add('t-queued')
      return
    }
    if (this.mode === 'python') { this.replLine(text); return }
    this.commit(text)
    // for … do / if … then の後などは、続きの行を待つ (> )
    if (text.trim() || this.shellBuf.length) {
      const all = [...this.shellBuf, text].join('\n')
      if (this.shell.isIncomplete(all)) { this.shellBuf.push(text); this.prompt(); return }
      this.shellBuf = []
      this.runLine(all)
      return
    }
    this.runLine(text)
  }

  onKey(e) {
    if (e.isComposing || e.keyCode === 229) return
    const k = e.key
    const ctrl = e.ctrlKey && !e.metaKey && !e.altKey
    if (this.search) {
      if (k === 'Enter' || k === 'ArrowRight' || k === 'Tab') { e.preventDefault(); this.searchEnd(true, k === 'Enter'); return }
      if (k === 'Escape' || (e.ctrlKey && (k === 'g' || k === 'c'))) { e.preventDefault(); this.searchEnd(false); return }
      if (e.ctrlKey && k.toLowerCase() === 'r') { e.preventDefault(); this.searchUpdate(true); return }
    }
    if (k === 'Enter') { e.preventDefault(); this.submit(); return }
    if (k === 'ArrowRight' && this.ghost.textContent && this.input.selectionStart === this.input.value.length) { e.preventDefault(); this.acceptSuggestion(); return }
    if (k === 'Tab') { e.preventDefault(); this.tab(); return }
    if (k === 'ArrowUp') { e.preventDefault(); this.histMove(1); return }
    if (k === 'ArrowDown') { e.preventDefault(); this.histMove(-1); return }
    if (!ctrl) return
    const inp = this.input
    const key = k.toLowerCase()
    if (key === 'c') {
      // 文字を選んでいるときはコピー
      if (String(getSelection && getSelection() || '') || inp.selectionStart !== inp.selectionEnd) return
      e.preventDefault(); this.interrupt()
    } else if (key === 'd') { e.preventDefault(); this.eof() }
    else if (key === 'l') { e.preventDefault(); this.clear() }
    else if (key === 'r') { e.preventDefault(); this.searchStart() }
    else if (key === 'u') { e.preventDefault(); inp.value = inp.value.slice(inp.selectionStart); inp.setSelectionRange(0, 0) }
    else if (key === 'k') { e.preventDefault(); inp.value = inp.value.slice(0, inp.selectionStart) }
    else if (key === 'a') { e.preventDefault(); inp.setSelectionRange(0, 0) }
    else if (key === 'e') { e.preventDefault(); inp.setSelectionRange(inp.value.length, inp.value.length) }
    else if (key === 'w') {
      e.preventDefault()
      const p = inp.selectionStart
      const before = inp.value.slice(0, p).replace(/\S+\s*$/, '')
      inp.value = before + inp.value.slice(p)
      inp.setSelectionRange(before.length, before.length)
    }
  }

  onPaste(e) {
    const text = e.clipboardData && e.clipboardData.getData('text')
    if (!text || !/[\r\n]/.test(text)) return
    e.preventDefault()
    const ls = text.replace(/\r\n?/g, '\n').split('\n')
    if (ls[ls.length - 1] === '') ls.pop()
    const inp = this.input
    const p = inp.selectionStart ?? inp.value.length
    inp.value = inp.value.slice(0, p) + ls.shift() + inp.value.slice(inp.selectionEnd ?? p)
    this.typeahead.push(...ls)
    this.submit()
  }

  insert(text) {
    const inp = this.input
    const a = inp.selectionStart ?? inp.value.length, b = inp.selectionEnd ?? a
    inp.value = inp.value.slice(0, a) + text + inp.value.slice(b)
    inp.setSelectionRange(a + text.length, a + text.length)
  }

  histMove(dir) {
    if (this.pending) return
    const list = this.mode === 'python' ? this.pyHistory : this.history
    if (!list.length) return
    if (this.hi === -1) this.draft = this.input.value
    this.hi = Math.max(-1, Math.min(list.length - 1, this.hi + dir))
    this.input.value = this.hi === -1 ? this.draft : list[list.length - 1 - this.hi]
    const n = this.input.value.length
    this.input.setSelectionRange(n, n)
  }
  addHistory(line, py = false) {
    if (!line.trim()) return
    const key = py ? PYHIST : HIST
    const list = (py ? this.pyHistory : this.history).filter(x => x !== line)
    list.push(line)
    if (list.length > 300) list.splice(0, list.length - 300)
    if (py) this.pyHistory = list; else this.history = list
    store(key, list)
  }

  // Tab: コマンド・ファイル名 (シェル) / 名前 (Python) を補う
  async tab() {
    const inp = this.input
    if (this.pending) return
    const pos = inp.selectionStart ?? inp.value.length
    const before = inp.value.slice(0, pos), after = inp.value.slice(pos)
    if (this.mode === 'python') {
      const m = /[\w.]*$/.exec(before)
      if (!m[0]) { this.insert('    '); return }
      const r = await app.runner.termEval(before, { ns: this.replNs === 'repl-new' ? 'repl' : this.replNs, complete: m[0] })
      const names = (r && r.names) || []
      this.applyCompletion(before, after, before.length - m[0].length, names.map(n => ({ text: n, label: n.slice(n.lastIndexOf('.', n.length - 2) + 1) })))
      return
    }
    const r = this.shell.complete(before)
    this.applyCompletion(before, after, r.start, r.items)
  }
  applyCompletion(before, after, start, items) {
    const inp = this.input
    if (!items.length) return
    const word = before.slice(start)
    let text
    if (items.length === 1) text = items[0].text
    else {
      // 共通する先頭を補い、進まなければ候補を表示
      let p = items[0].text
      for (const it of items) while (!it.text.startsWith(p)) p = p.slice(0, -1)
      if (p.length > word.length) text = p
      else {
        this.commit(inp.value)
        const names = items.map(i => i.label)
        const w = Math.max(...names.map(strWidth)) + 2
        const per = Math.max(1, Math.floor(this.cols() / w))
        const rows = []
        for (let k = 0; k < Math.min(names.length, 300); k += per) rows.push(names.slice(k, k + per).map(n => n + ' '.repeat(Math.max(0, w - strWidth(n)))).join('').trimEnd())
        this.write(rows.join('\n') + (names.length > 300 ? `\n… ほか ${names.length - 300} 件` : '') + '\n', 't-dim')
        this.prompt()
        inp.value = before + after
        inp.setSelectionRange(before.length, before.length)
        return
      }
    }
    inp.value = before.slice(0, start) + text + after
    const c = start + text.length
    inp.setSelectionRange(c, c)
  }

  // Ctrl+C: 動いているものを止める / 入力中の行を捨てる
  interrupt() {
    haptic(8)
    const r = app.runner
    if (this.busy || this.pending) {
      this.typeahead = []
      if (this.ac) this.ac.abort()
      if (r.running && r.running.term) r.stop()
      else if (r.evalBusy) r.interruptEval()
      if (this.pending) { const p = this.pending; this.pending = null; this.commit(this.input.value, '^C'); this.input.value = ''; this.inputLine.classList.remove('waiting'); p.resolve(null) }
      return
    }
    if (this.search) this.searchEnd(false)
    this.commit(this.input.value, '^C')
    this.input.value = ''
    this.shellBuf = []
    if (this.mode === 'python') { this.replBuf = []; this.write('KeyboardInterrupt\n', 't-err') }
    this.prompt()
  }

  // ---- 履歴からの提案 (fish のように薄い文字で。→ で確定) ----
  suggest() {
    const inp = this.input
    const v = inp.value
    let hint = ''
    if (!this.pending && !this.busy && v && inp.selectionStart === v.length && document.activeElement === inp) {
      const list = this.mode === 'python' ? this.pyHistory : this.history
      for (let k = list.length - 1; k >= 0; k--) if (list[k].length > v.length && list[k].startsWith(v)) { hint = list[k].slice(v.length); break }
    }
    this.ghost.textContent = hint
    if (hint) this.ghost.style.left = (this.textWidth(v) - inp.scrollLeft) + 'px'
  }
  acceptSuggestion() {
    if (!this.ghost.textContent) return
    this.input.value += this.ghost.textContent
    const n = this.input.value.length
    this.input.setSelectionRange(n, n)
    this.ghost.textContent = ''
    this.input.focus({ preventScroll: true })
  }
  textWidth(text) {
    if (!this.measure) this.measure = document.createElement('canvas').getContext('2d')
    const cs = getComputedStyle(this.input)
    this.measure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    return this.measure.measureText(text).width
  }

  // ---- Ctrl+R: 履歴を検索 ----
  searchStart() {
    if (this.pending || this.busy) return
    this.search = { draft: this.input.value, from: this.mode === 'python' ? this.pyHistory.length : this.history.length, hit: '' }
    this.savedPrompt = [...this.promptEl.childNodes]
    this.promptEl.replaceChildren(h('span', { class: 't-note' }, '(履歴を検索) '))
    this.input.value = ''
    this.inputLine.classList.add('searching')
    this.searchUpdate()
  }
  searchUpdate(older = false) {
    const s = this.search
    const q = this.input.value
    const list = this.mode === 'python' ? this.pyHistory : this.history
    const start = older ? s.from - 1 : list.length - 1
    s.hit = ''
    for (let k = start; k >= 0; k--) if (!q || list[k].includes(q)) { s.hit = list[k]; s.from = k; break }
    this.ghost.style.left = (this.textWidth(q) - this.input.scrollLeft) + 'px'
    this.ghost.textContent = s.hit ? `  → ${s.hit}` : q ? '  (見つかりません)' : ''
  }
  searchEnd(accept, run = false) {
    const s = this.search
    if (!s) return
    this.search = null
    this.inputLine.classList.remove('searching')
    this.promptEl.replaceChildren(...this.savedPrompt)
    this.ghost.textContent = ''
    this.input.value = accept && s.hit ? s.hit : s.draft
    if (accept && run && s.hit) this.submit()
  }
  // Ctrl+D: 入力の終わり / 対話モードを終える
  eof() {
    if (this.pending) {
      const p = this.pending
      this.pending = null
      this.commit(this.input.value, '^D')
      this.input.value = ''
      this.inputLine.classList.remove('waiting')
      p.resolve(null)
      return
    }
    if (this.input.value || this.busy) return
    if (this.mode === 'python') { this.commit('', 'exit()'); this.leaveRepl(); return }
  }

  // ============================================================
  // シェル
  // ============================================================
  async runLine(line) {
    this.addHistory(line.replace(/\n/g, '; '))
    if (!line.trim()) { this.prompt(); return }
    this.setBusy(true)
    this.ac = new AbortController()
    this.replWanted = null
    const io = {
      out: s => this.write(s),
      err: s => this.write(s, 't-err'),
      tty: true,
      cols: () => this.cols(),
      term: this.api(),
      signal: this.ac.signal,
    }
    try { await this.shell.run(line, io) } catch (e) { this.write(`forgesh: ${e && e.message || e}\n`, 't-err') }
    this.ac = null
    this.setBusy(false)
    this.saveStateSoon()
    if (this.replWanted) { this.enterRepl(this.replWanted); return }
    this.prompt()
  }
  setBusy(on) {
    this.busy = on
    this.el.classList.toggle('busy', on)
    this.input.placeholder = on ? '実行中 — ^C で止めます' : ''
    this.onState()
  }
  // シェルのコマンドから使う
  api() {
    return {
      startRepl: ({ ns }) => { this.replWanted = ns },
      clear: () => this.clear(),
      exit: () => { this.saveState(); setTimeout(() => app.runner.closeTerminal(), 50) },
      historyList: () => this.history.slice(),
      clearHistory: () => { this.history = []; store(HIST, []) },
      saveState: () => this.saveStateSoon(),
      readLine: ({ password = false } = {}) => this.requestInput({ password }),
    }
  }

  // アプリのファイル・Python とのつなぎ
  host() {
    const pid = () => (app.project ? app.project.id : null)
    return {
      files: () => app.files,
      read: async p => {
        const d = app.editors && app.editors.docs.get(p)
        if (d) return d.state.doc.toString()
        if (app.contents.has(p)) return app.contents.get(p)
        return pid() ? vfs.readFile(pid(), p) : null
      },
      write: (p, t) => writeProjectFile(p, t),
      mkdir: p => vfs.mkdir(pid(), p),
      remove: p => deletePath(p),
      rename: (a, b) => renamePath(a, b),
      changed: () => refreshFiles(),
      python: opts => this.runPython(opts),
      pip: (args, ctx) => this.runPip(args, ctx),
      pyVersion: () => (app.runner.pyStatus || 'Python 3.14'),
      open: async (p, line) => { app.runner.closeTerminal({ forEditor: true }); await app.editors.open(p, line ? { line } : {}) },
      runFile: async p => { await app.runner.run(p ? { path: p } : {}) },
      command: id => runCommand(id),
      fetch: (url, init) => fetch(url, init),
      storage: () => vfs.storageEstimate(),
      running: () => (app.runner.running ? { name: vfs.basename(app.runner.runPath || ''), ms: performance.now() - app.runner.t0 } : null),
      cloud: (sub, args, ctx) => this.cloud(sub, args, ctx),
      gitStore: () => (pid() ? vfs.gitStore(pid()) : null),
      githubPush: async message => { const g = await import('./github-sync.js'); if (!g.ghReady()) { g.settingsDialog(); return } await g.syncPush({ message }) },
      githubInfo: () => { try { const c = JSON.parse(localStorage.getItem('forgecode.github') || 'null'); return c && c.repo ? { repo: c.repo } : null } catch { return null } },
      gitChanged: () => emit('git'),
      preview: p => import('./preview.js').then(m => m.openPreview(p)),
    }
  }

  // cloud: クラウド (GitHub Actions) で動かしている様子・今すぐ実行・出力
  async cloud(sub, args, ctx) {
    const m = await import('./cloud.js')
    const { ghReady } = await import('./github-sync.js')
    if (sub === 'setup' || sub === 'open') { m.cloudDialog(); return 0 }
    if (!ghReady()) { ctx.err('cloud: 先に「GitHub と同期」を設定してください (cloud setup で設定の画面を開きます)\n'); return 1 }
    if (sub === 'run') { await m.cloudRunNow(); ctx.print('クラウドでの実行を頼みました (1〜2 分で動き始めます。cloud log で出力を見られます)'); return 0 }
    if (sub === 'stop') { await m.cloudDisable(); ctx.print('クラウドで動かすのをやめました'); return 0 }
    if (sub === 'pull') { const { syncPull } = await import('./github-sync.js'); await syncPull({ quiet: true }); ctx.print('結果のファイルを取り込みました'); return 0 }
    const { cfg, runs, result } = await m.cloudStatus()
    if (sub === 'log') { ctx.out(result.log ? result.log.replace(/\n?$/, '\n') : '(まだ出力はありません)\n'); return 0 }
    if (sub !== 'status') { ctx.err(`cloud: ${sub} は使えません (status / run / log / pull / setup / stop)\n`); return 1 }
    const { SCHEDULES } = await import('./cloud-core.js')
    const when = (SCHEDULES.find(x => x[0] === cfg.schedule) || [])[1] || cfg.schedule
    ctx.print(cfg.enabled ? `${C.bgreen}●${C.reset} クラウドで動かしています: ${cfg.entry} ・ ${when}${cfg.schedule === 'daily' ? ' ' + cfg.time : ''} ・ 1 回 ${cfg.timeout} 分まで` : `${C.gray}○ まだクラウドで動かしていません (cloud setup)${C.reset}`)
    const st = result.status
    if (st) ctx.print(`最後の実行: ${new Date(st.time).toLocaleString('ja-JP')} — ${{ ok: '完了', error: 'エラー', timeout: '時間切れ' }[st.state] || st.state} (${st.seconds} 秒)`)
    for (const r of runs) ctx.print(`  ${r.status === 'completed' ? (r.conclusion === 'success' ? C.green + '✓' : C.red + '✗') : C.yellow + '…'}${C.reset} ${new Date(r.at).toLocaleString('ja-JP')}  ${r.event === 'schedule' ? '時間になって' : r.event === 'workflow_dispatch' ? '今すぐ実行' : r.event}`)
    return 0
  }

  // python ファイル.py / -c / -m: 実行して、出力をここに (パイプの中なら次のコマンドへ)
  runPython(opts) {
    const r = app.runner
    if (r.running && !r.running.term) { opts.err('python: 別のプログラムが実行中です (実行画面の ■ で止めてから)\n'); return Promise.resolve(1) }
    return new Promise(resolve => {
      const stdinLines = opts.stdin !== null && opts.stdin !== undefined ? opts.stdin.split('\n') : null
      if (stdinLines && stdinLines[stdinLines.length - 1] === '') stdinLines.pop()
      const sink = this.sink(opts, code => resolve(code), stdinLines)
      const virtual = opts.entry.startsWith('<')
      r.run(virtual ? { source: opts.source, name: opts.entry, term: sink, argv: opts.argv, cwd: opts.cwd } : { path: opts.entry, term: sink, argv: opts.argv, cwd: opts.cwd })
        .then(() => { if (!r.running || r.sink !== sink) { if (!sink.finished) { sink.finished = true; resolve(1) } } })
        .catch(e => { opts.err(`python: ${e && e.message || e}\n`); resolve(1) })
    })
  }
  // 実行の出力・入力の受け口 (runner がここへ送る)
  sink(opts, finish, stdinLines = null) {
    const term = this
    const runner = app.runner
    return {
      finished: false,
      output(items) {
        // 続けて同じ種類の行は、まとめて 1 回で書く (速い)
        let buf = '', kind = null
        const flush = () => {
          if (!buf) return
          if (kind === 'warn') term.write(buf, 't-warn')
          else if (kind === 'err') opts.err(buf)
          else opts.out(buf)
          buf = ''
        }
        for (const it of items) {
          if (it.kind === 'meta' || it.kind === 'log') { flush(); if (it.partial) term.write(it.text, 't-note'); else term.note(it.text); continue }
          const k = it.kind === 'warn' ? 'warn' : it.kind === 'error-text' || it.kind === 'error' ? 'err' : 'out'
          if (k !== kind) { flush(); kind = k }
          buf += it.text + (it.partial ? '' : '\n')
        }
        flush()
      },
      input(password) {
        if (stdinLines) {
          const line = stdinLines.shift()
          runner.sendInput(line ?? '', line === undefined)
          return
        }
        term.requestInput({ password }).then(v => { if (runner.inputPending) runner.sendInput(v ?? '', v === null) })
      },
      inputDone() { term.cancelInput() },
      block(m) { term.block(m) },
      visual() { term.note('図・ゲームの画面は実行画面に出しています (「戻る」でターミナルに戻ります)') },
      note(text) { term.note(text) },
      done(m) {
        if (this.finished) return
        this.finished = true
        if (m.error) opts.err(String(m.error.text || `${m.error.type}: ${m.error.message}`).replace(/\n*$/, '\n'))
        else if (m.reason === 'stopped') { if (term.cur) term.endLine(); term.write('KeyboardInterrupt\n', 't-err') }
        const code = m.reason === 'stopped' ? 130 : (m.error || m.reason === 'error' || m.reason === 'load') ? 1 : 0
        if (term.cur) term.endLine()
        finish(code)
      },
    }
  }
  // pip install / list など (Python のワーカーで)
  async runPip(args, ctx) {
    const r = app.runner
    if (r.running && !r.running.term) { ctx.err('pip: 別のプログラムが実行中です\n'); return 1 }
    const res = await r.termEval('pip ' + args.map(a => (/[\s'"]/.test(a) ? JSON.stringify(a) : a)).join(' '), { ns: 'repl', sink: this.sink({ out: ctx.out, err: ctx.err }, () => {}) })
    if (!res.ok) { ctx.err((res.error || 'pip に失敗しました') + '\n'); return 1 }
    return 0
  }

  // ============================================================
  // Python の対話モード
  // ============================================================
  enterRepl(ns) {
    this.mode = 'python'
    this.replNs = ns
    this.replBuf = []
    this.indent = ''
    const v = app.runner.pyStatus ? app.runner.pyStatus.replace(/^Python\s*/, '') : '3.14'
    this.write(`Python ${v} (Pyodide) on ForgeCode\n`)
    this.write(`${C.gray}${ns === 'last' ? '実行した後の変数が使えます。' : ''}exit() か Ctrl+D で終わります。複数行は、空の行で確定します${C.reset}\n`)
    if (!app.runner.pyReady) this.note('Python を準備しています… (初回は少し時間がかかります)')
    this.prompt()
  }
  leaveRepl() {
    this.mode = 'shell'
    this.replBuf = []
    this.prompt()
  }
  async replLine(text) {
    if (!text.trim()) text = ''
    this.commit(text)
    this.addHistory(text, true)
    if (!text && !this.replBuf.length) { this.prompt(); return }
    this.replBuf.push(text)
    const code = this.replBuf.join('\n') + (text === '' ? '\n' : '')
    this.setBusy(true)
    const res = await app.runner.termEval(code, { ns: this.replNs, repl: true, sink: this.sink({ out: s => this.write(s), err: s => this.write(s, 't-err') }, () => {}) })
    this.setBusy(false)
    if (res.incomplete) {
      const lead = /^[ \t]*/.exec(text)[0]
      this.indent = /:\s*(#.*)?$/.test(text) ? lead + '    ' : lead
      this.prompt()
      return
    }
    this.replBuf = []
    this.indent = ''
    if (this.replNs === 'repl-new' && !res.busy) this.replNs = 'repl'
    if (this.cur) this.endLine()
    if (res.busy) this.write('Python は別のプログラムを実行中です (止めてから使ってください)\n', 't-err')
    else if (res.ok) { if (res.value !== null && res.value !== undefined) this.write(String(res.value) + '\n') }
    else if (res.etype === 'SystemExit') { this.leaveRepl(); return }
    else this.write(String(res.error || '').replace(/\n*$/, '\n'), 't-err')
    this.prompt()
  }

  // ============================================================
  // 状態を残す (アプリを閉じても、次に開いたとき続きから)
  // ============================================================
  saveStateSoon() { clearTimeout(this.saveT); this.saveT = setTimeout(() => this.saveState(), 800) }
  saveState() {
    const lines = []
    for (const el of this.screen.children) {
      if (el === this.inputLine) continue
      const t = el.classList.contains('term-media') ? '[図]' : el.textContent
      lines.push(t)
    }
    const builtin = new Set(['ll', 'la', 'l', 'py', 'python3', 'pip3', 'cls'])
    const aliases = Object.fromEntries(Object.entries(this.shell.aliases).filter(([k]) => !builtin.has(k)))
    const keep = ['USER', 'HOME', 'SHELL', 'LANG', 'TERM', 'PYTHON']
    const env = Object.fromEntries(Object.entries(this.shell.env).filter(([k]) => !keep.includes(k)))
    store(this.stateKey, { pid: app.project ? app.project.id : null, cwd: this.shell.cwd, env, aliases, lines: lines.slice(-200).map(l => l.slice(0, 2000)), t: Date.now() })
  }
  restore(st, samePid) {
    const lines = samePid && Array.isArray(st.lines) ? st.lines : []
    if (lines.length) {
      for (const l of lines) this.screen.insertBefore(h('div', { class: 'tl t-old' }, l), this.inputLine)
      this.note(`── ${st.t ? new Date(st.t).toLocaleString('ja-JP') : ''} までの続きです ──`)
    } else {
      this.write(`${C.bold}ForgeCode ターミナル${C.reset}  ${C.gray}~ はプロジェクト「${app.project ? app.project.name : ''}」の一番上です。help でコマンドの一覧、python で対話モード${C.reset}\n`)
    }
    if (samePid && st.cwd && !this.shell.isDir(st.cwd)) this.shell.cwd = ''
  }
  projectChanged(p) {
    if (!p) return
    if (this.pid === p.id) return
    this.pid = p.id
    this.shell.cwd = ''
    this.shell.oldCwd = ''
    if (this.mode === 'python') { this.mode = 'shell'; this.replBuf = [] }
    if (!this.busy && !this.pending) {
      this.commit(this.input.value)
      this.note(`プロジェクト「${p.name}」に切り替えました`)
      this.prompt()
    }
  }
  // Python を立ち上げ直した (変数が消えた)
  pythonRestarted(msg) {
    if (this.mode !== 'python' || this.busy) return
    this.commit(this.input.value)
    this.note(msg)
    this.replNs = 'repl-new'
    this.replBuf = []
    this.prompt()
  }
  // 画面の文字 (コピー用)
  text() {
    return [...this.screen.children].filter(el => el !== this.inputLine).map(el => stripAnsi(el.textContent)).join('\n')
  }
}
