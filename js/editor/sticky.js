// スティッキースクロール (Python): 画面の上に、いま見ている場所を囲む def / class / if / for の行を固定表示
// Python は字下げでブロックが決まるので、字下げから囲んでいる行を求めます
import { ViewPlugin, EditorView } from '../../vendor/codemirror.js'

const HEADER = /^\s*(async\s+def|def|class|if|elif|else|for|while|with|try|except|finally|match|case)\b.*:\s*(#.*)?$/
const indentOf = (text, tab) => { let n = 0; for (const c of text) { if (c === ' ') n++; else if (c === '\t') n += tab - (n % tab); else break } return n }

const cache = new WeakMap()
// ブロックの一覧: { from: 見出しの行, to: ブロックの最後の行 }
export function pythonBlocks(state) {
  const doc = state.doc
  let list = cache.get(doc)
  if (list) return list
  list = []
  if (doc.length < 400000) {
    const tab = state.tabSize
    const stack = [] // { from, indent }
    let lastCode = 0
    for (let i = 1; i <= doc.lines; i++) {
      const text = doc.line(i).text
      if (!text.trim() || /^\s*#/.test(text)) continue
      const ind = indentOf(text, tab)
      while (stack.length && ind <= stack[stack.length - 1].indent) { const b = stack.pop(); if (lastCode > b.from) list.push({ from: b.from, to: lastCode }) }
      if (HEADER.test(text)) stack.push({ from: i, indent: ind })
      lastCode = i
    }
    while (stack.length) { const b = stack.pop(); if (lastCode > b.from) list.push({ from: b.from, to: lastCode }) }
    list.sort((a, b) => a.from - b.from)
  }
  cache.set(doc, list)
  return list
}

const KW = /\b(async|def|class|if|elif|else|for|in|while|with|as|try|except|finally|match|case|return|and|or|not|is|lambda)\b/g
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
      if (u.docChanged) { clearTimeout(this.timer); this.timer = setTimeout(() => this.onScroll(), u.state.doc.lines > 2000 ? 500 : 250) }
      else if (u.geometryChanged || u.viewportChanged) this.onScroll()
    }
    render() {
      const view = this.view
      const { state } = view
      const top = view.scrollDOM.scrollTop
      if (top < 4) { this.set([]); return }
      let topLine = state.doc.lineAt(view.lineBlockAtHeight(top + 1).from).number
      const blocks = pythonBlocks(state)
      let open = blocks.filter(b => b.from < topLine && b.to >= topLine)
      // 固定表示した行の分だけ下の行が隠れるので、その分も考える
      if (open.length) {
        const shown = Math.min(open.length, maxLines)
        topLine = state.doc.lineAt(view.lineBlockAtHeight(top + shown * view.defaultLineHeight).from).number
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
      if (!lines.length) return
      const view = this.view
      const gutter = view.dom.querySelector('.cm-gutters')
      const gw = gutter ? gutter.getBoundingClientRect().width : 0
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
