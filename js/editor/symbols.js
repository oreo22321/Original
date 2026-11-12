// 変数・関数の「どこで宣言され、どこで使われているか」(スコープを考慮)
//  ・定義へ移動 / 参照を検索 / 名前の一括変更 / カーソル位置の変数を全部ハイライト
import { parse } from '../luau/parser.js'
import { ViewPlugin, Decoration, EditorView } from '../../vendor/codemirror.js'
import { docText } from './luau-intel.js'
import { scanBlocks } from './blocks.js'

// 解析結果: { refs: [{ s, e, sym, decl }] (位置順), symbols: [sym] }
//   sym: { name, kind: 'local' | 'param' | 'func' | 'for' | 'global' | 'self', decl: { s, e } | null, refs: [{ s, e, decl, write }] }
export function analyzeSymbols(src) {
  const ast = parse(src)
  const refs = []
  const symbols = []
  const globals = new Map()
  const scopes = []
  const push = () => scopes.push(new Map())
  const pop = () => scopes.pop()
  const add = (sym, node, decl, write = false) => {
    if (!node || node.s === undefined || node.e === undefined) return
    const r = { s: node.s, e: node.e, sym, decl, write: write || decl }
    sym.refs.push(r)
    refs.push(r)
  }
  const declare = (node, kind) => {
    const sym = { name: node.name, kind, decl: node.s !== undefined ? { s: node.s, e: node.e } : null, refs: [] }
    scopes[scopes.length - 1].set(node.name, sym)
    symbols.push(sym)
    add(sym, node, true)
    return sym
  }
  const lookup = name => { for (let i = scopes.length - 1; i >= 0; i--) { const v = scopes[i].get(name); if (v) return v } return null }
  const globalSym = name => {
    let g = globals.get(name)
    if (!g) { g = { name, kind: 'global', decl: null, refs: [], defs: [] }; globals.set(name, g); symbols.push(g) }
    return g
  }
  const ref = (node, write = false) => {
    const sym = lookup(node.name)
    if (sym) { add(sym, node, false, write); return }
    const g = globalSym(node.name)
    add(g, node, false, write)
    if (write && node.s !== undefined) { g.defs.push({ s: node.s, e: node.e }); if (!g.decl) g.decl = { s: node.s, e: node.e } }
  }

  function expr(e) {
    if (!e || typeof e !== 'object') return
    switch (e.t) {
      case 'Name': ref(e); break
      case 'Index': expr(e.obj); if (!e.dot) expr(e.key); break
      case 'Call': expr(e.fn); e.args.forEach(expr); break
      case 'Method': expr(e.obj); e.args.forEach(expr); break
      case 'Bin': expr(e.l); expr(e.r); break
      case 'Un': case 'Paren': case 'Cast': expr(e.e); break
      case 'Func': func(e); break
      case 'Table': for (const it of e.items) { if (it.k === 'expr') expr(it.key); expr(it.value) } break
      case 'IfExpr': for (const c of e.clauses) { expr(c.cond); expr(c.val) } expr(e.orelse); break
      case 'Interp': for (const p of e.parts) if (typeof p !== 'string') expr(p); break
    }
  }
  function func(f, selfParam) {
    push()
    if (selfParam || f.isMethod) scopes[scopes.length - 1].set('self', { name: 'self', kind: 'self', decl: null, refs: [] })
    for (const p of f.params) if (p.name) declare(p, 'param')
    for (const st of f.body) stat(st)
    pop()
  }
  function block(stats) { push(); for (const st of stats) stat(st); pop() }
  function stat(st) {
    switch (st.t) {
      case 'Local':
        st.values.forEach(expr)
        for (const n of st.names) declare(n, 'local')
        break
      case 'LocalFunction': declare(st.name, 'func'); func(st.func); break
      case 'Function':
        if (st.target.t === 'Name') ref(st.target, true)
        else expr(st.target.obj || st.target)
        func(st.func, st.isMethod)
        break
      case 'Assign':
        st.values.forEach(expr)
        for (const t of st.targets) { if (t.t === 'Name') ref(t, true); else expr(t) }
        break
      case 'Compound':
        expr(st.value)
        if (st.target.t === 'Name') ref(st.target, true); else expr(st.target)
        break
      case 'CallStat': expr(st.call); break
      case 'If': for (const c of st.clauses) { expr(c.cond); block(c.body) } if (st.orelse) block(st.orelse); break
      case 'While': expr(st.cond); block(st.body); break
      case 'Repeat': push(); for (const s of st.body) stat(s); expr(st.cond); pop(); break
      case 'NumFor': expr(st.start); expr(st.stop); expr(st.step); push(); declare(st.var, 'for'); for (const s of st.body) stat(s); pop(); break
      case 'GenFor': st.exprs.forEach(expr); push(); st.vars.forEach(v => declare(v, 'for')); for (const s of st.body) stat(s); pop(); break
      case 'Do': block(st.body); break
      case 'Return': st.values.forEach(expr); break
    }
  }
  push()
  for (const st of ast.body) stat(st)
  pop()
  refs.sort((a, b) => a.s - b.s)
  return { refs, symbols }
}

export function refAt(an, pos) {
  const refs = an.refs
  let lo = 0, hi = refs.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const r = refs[mid]
    if (pos < r.s) hi = mid - 1
    else if (pos > r.e) lo = mid + 1
    else return r
  }
  return null
}

// 文書ごとに解析結果を覚えておく (構文エラーの間は、最後に成功した結果は使わない)
const cache = new WeakMap()
export function symbolsOf(state) {
  const doc = state.doc
  if (cache.has(doc)) return cache.get(doc)
  let an = null
  if (doc.length < 400000) { try { an = analyzeSymbols(docText(state)) } catch { an = null } }
  cache.set(doc, an)
  return an
}

// カーソル位置の識別子: { name, from, to, member: '.' | ':' | null }
export function identAt(state, pos) {
  const line = state.doc.lineAt(pos)
  const text = line.text
  let a = pos - line.from, b = a
  while (a > 0 && /[\w]/.test(text[a - 1])) a--
  while (b < text.length && /[\w]/.test(text[b])) b++
  if (a === b || /^\d/.test(text.slice(a, b))) return null
  const before = text.slice(0, a).replace(/\s+$/, '')
  const member = /[.:]$/.test(before) && !/\.\.$/.test(before) ? before.slice(-1) : null
  return { name: text.slice(a, b), from: line.from + a, to: line.from + b, member }
}

// ---- カーソル位置の変数をハイライト ----
const hlRead = Decoration.mark({ class: 'cm-sym-hl' })
const hlWrite = Decoration.mark({ class: 'cm-sym-hl write' })
export const symbolHighlight = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = Decoration.none; this.timer = null; this.schedule(view) }
  update(u) {
    if (u.docChanged) this.decorations = this.decorations.map(u.changes)
    if (u.docChanged || u.selectionSet) this.schedule(u.view)
  }
  schedule(view) {
    clearTimeout(this.timer)
    const big = view.state.doc.lines > 2000
    this.timer = setTimeout(() => {
      const deco = this.compute(view)
      if (deco !== this.decorations) { this.decorations = deco; view.dispatch({ effects: [] }) }
    }, big ? 450 : 180)
  }
  compute(view) {
    const { state } = view
    const sel = state.selection.main
    if (!sel.empty || state.doc.length > 200000) return Decoration.none
    // 識別子の上にいなければ解析しない
    const ch = state.sliceDoc(Math.max(0, sel.head - 1), sel.head + 1)
    if (!/\w/.test(ch)) return this.decorations.size ? Decoration.none : this.decorations
    const an = symbolsOf(state)
    if (!an) return Decoration.none
    const r = refAt(an, sel.head)
    if (!r || r.sym.refs.length < 2 || r.sym.refs.length > 500) return Decoration.none
    return Decoration.set(r.sym.refs.map(x => (x.write ? hlWrite : hlRead).range(x.s, x.e)), true)
  }
  destroy() { clearTimeout(this.timer) }
}, { decorations: v => v.decorations })

// ============================================================
// スティッキースクロール: 画面の上に、いま見ている場所を囲む function / if / for の行を固定表示
// ============================================================
const blockCache = new WeakMap()
function blocksOf(state) {
  const doc = state.doc
  let b = blockCache.get(doc)
  if (!b) {
    b = doc.length > 400000 ? [] : scanBlocks(docText(state)).blocks.map(x => ({ from: doc.lineAt(x.s).number, to: x.close ? doc.lineAt(x.close.s).number : doc.lines + 1 })).filter(x => x.to > x.from)
    blockCache.set(doc, b)
  }
  return b
}

const KW = /\b(local|function|if|then|else|elseif|for|in|do|while|repeat|until|return|end|and|or|not)\b/g
function paintLine(el, text) {
  el.textContent = ''
  let last = 0
  text.replace(KW, (m, _w, i) => {
    if (i > last) el.append(text.slice(last, i))
    const k = document.createElement('span')
    k.className = 'st-kw'
    k.textContent = m
    el.append(k)
    last = i + m.length
    return m
  })
  if (last < text.length) el.append(text.slice(last))
}

export function stickyScroll(maxLines = 3) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view
      this.dom = document.createElement('div')
      this.dom.className = 'cm-sticky'
      this.dom.setAttribute('aria-hidden', 'true')
      view.dom.append(this.dom)
      this.key = ''
      this.onScroll = () => { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.render() }) }
      view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })
      this.render()
    }
    update(u) {
      // 入力中は解析しない (少し落ち着いてから更新)
      if (u.docChanged) { clearTimeout(this.timer); this.timer = setTimeout(() => this.onScroll(), u.state.doc.lines > 2000 ? 500 : 250) }
      else if (u.geometryChanged || u.viewportChanged) this.onScroll()
    }
    render() {
      const view = this.view
      const { state } = view
      const top = view.scrollDOM.scrollTop
      if (top < 4) { this.set([]); return }
      const block = view.lineBlockAtHeight(top + 1)
      let topLine = state.doc.lineAt(block.from).number
      const blocks = blocksOf(state)
      // いちばん上に見えている行を囲むブロック (外側から)
      let open = blocks.filter(b => b.from < topLine && b.to >= topLine)
      // 固定表示した行の分だけ下の行が隠れるので、その分も考慮
      if (open.length) {
        const shown = Math.min(open.length, maxLines)
        const lh = view.defaultLineHeight
        const block2 = view.lineBlockAtHeight(top + shown * lh)
        topLine = state.doc.lineAt(block2.from).number
        open = blocks.filter(b => b.from < topLine && b.to >= topLine)
      }
      this.set(open.slice(-maxLines).map(b => b.from))
    }
    set(lines) {
      const key = lines.join(',') + '|' + this.view.state.doc.length
      if (key === this.key) return
      this.key = key
      const dom = this.dom
      dom.textContent = ''
      dom.classList.toggle('show', lines.length > 0)
      const view = this.view
      const gutter = view.dom.querySelector('.cm-gutters')
      const gw = gutter ? gutter.getBoundingClientRect().width : 0
      // エディタの行と同じ文字の大きさ・行の高さにそろえる
      const cs = getComputedStyle(view.contentDOM)
      dom.style.fontSize = cs.fontSize
      dom.style.fontFamily = cs.fontFamily
      dom.style.lineHeight = view.defaultLineHeight + 'px'
      dom.style.top = view.scrollDOM.offsetTop + 'px'
      const lineEl = view.contentDOM.querySelector('.cm-line')
      const padL = lineEl ? getComputedStyle(lineEl).paddingLeft : '6px'
      for (const n of lines) {
        const line = view.state.doc.line(n)
        const row = document.createElement('div')
        row.className = 'cm-sticky-line'
        const num = document.createElement('span')
        num.className = 'st-num'
        num.style.width = gw + 'px'
        num.textContent = String(n)
        const code = document.createElement('span')
        code.className = 'st-code'
        code.style.paddingLeft = padL
        code.style.tabSize = String(view.state.tabSize)
        paintLine(code, line.text.slice(0, 300))
        row.append(num, code)
        row.addEventListener('mousedown', e => {
          e.preventDefault()
          view.dispatch({ selection: { anchor: line.from + (/^\s*/.exec(line.text)[0].length) }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 4 }) })
          view.focus()
        })
        dom.append(row)
      }
    }
    destroy() { clearTimeout(this.timer); cancelAnimationFrame(this.raf); this.view.scrollDOM.removeEventListener('scroll', this.onScroll); this.dom.remove() }
  })
}

