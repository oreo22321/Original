// エディタの追加機能: カラーピッカー / インデントガイド / 括弧の色分け / ホバー / 引数ヒント / ピンチズーム
import {
  ViewPlugin, Decoration, WidgetType, EditorView, RangeSetBuilder, syntaxTree, hoverTooltip, StateField, showTooltip, StateEffect,
} from '../../vendor/codemirror.js'

// ============================================================
// Color3 のカラーピッカー
// ============================================================
const COLOR_RE = /Color3\s*\.\s*(fromRGB|new|fromHex)\s*\(\s*([^()]*?)\s*\)|BrickColor\.new\(\s*["']([^"']+)["']\s*\)|(#[0-9a-fA-F]{6})\b/g
function parseColor(kind, args, hex) {
  if (hex) return hex
  if (kind === 'fromHex') {
    const m = /["']#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})["']/.exec(args)
    if (!m) return null
    const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
    return '#' + h
  }
  const nums = args.split(',').map(s => Number(s.trim()))
  if (nums.length !== 3 || nums.some(n => isNaN(n))) return null
  const v = kind === 'fromRGB' ? nums : nums.map(n => n * 255)
  return '#' + v.map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')
}

class ColorWidget extends WidgetType {
  constructor(color, from, to, kind) { super(); this.color = color; this.from = from; this.to = to; this.kind = kind }
  eq(o) { return o.color === this.color && o.from === this.from && o.to === this.to }
  toDOM(view) {
    const wrap = document.createElement('span')
    wrap.className = 'cm-color-swatch'
    wrap.style.backgroundColor = this.color
    wrap.title = 'タップして色を選ぶ'
    const input = document.createElement('input')
    input.type = 'color'
    input.value = this.color
    input.addEventListener('input', () => {
      const hex = input.value
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
      let text
      if (this.kind === 'fromRGB') text = `Color3.fromRGB(${r}, ${g}, ${b})`
      else if (this.kind === 'new') text = `Color3.new(${+(r / 255).toFixed(3)}, ${+(g / 255).toFixed(3)}, ${+(b / 255).toFixed(3)})`
      else if (this.kind === 'fromHex') text = `Color3.fromHex("#${hex.slice(1).toUpperCase()}")`
      else if (this.kind === 'hex') text = hex.toUpperCase()
      else return
      view.dispatch({ changes: { from: this.from, to: this.to, insert: text } })
    })
    wrap.append(input)
    return wrap
  }
  ignoreEvent() { return true }
}

export const colorSwatches = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view) }
  update(u) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view) }
  build(view) {
    const b = new RangeSetBuilder()
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to)
      COLOR_RE.lastIndex = 0
      let m
      while ((m = COLOR_RE.exec(text))) {
        if (m[3]) continue
        const color = parseColor(m[1], m[2] || '', m[4])
        if (!color) continue
        const start = from + m.index
        const kind = m[4] ? 'hex' : m[1]
        b.add(start, start, Decoration.widget({ widget: new ColorWidget(color, start, start + m[0].length, kind), side: -1 }))
      }
    }
    return b.finish()
  }
}, { decorations: v => v.decorations })

// ============================================================
// インデントガイド
// ============================================================
export const indentGuides = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view) }
  update(u) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view) }
  build(view) {
    const b = new RangeSetBuilder()
    const tab = view.state.tabSize
    const mark = Decoration.mark({ class: 'cm-indent-guide' })
    for (const { from, to } of view.visibleRanges) {
      let pos = from
      while (pos <= to) {
        const line = view.state.doc.lineAt(pos)
        const lead = /^[ \t]*/.exec(line.text)[0]
        if (lead.length && line.text.trim()) {
          let i = 0
          while (i < lead.length) {
            const start = i
            if (lead[i] === '\t') i++
            else { let n = 0; while (i < lead.length && lead[i] === ' ' && n < tab) { i++; n++ } }
            b.add(line.from + start, line.from + i, mark)
          }
        }
        pos = line.to + 1
      }
    }
    return b.finish()
  }
}, { decorations: v => v.decorations })

// ============================================================
// 括弧の色分け (レインボー)
// ============================================================
const BRACKET_NODES = new Set(['(', ')', '[', ']', '{', '}', 'paren', 'brace', 'squareBracket'])
export const rainbowBrackets = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view) }
  update(u) { if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = this.build(u.view) }
  build(view) {
    const b = new RangeSetBuilder()
    const { state } = view
    const tree = syntaxTree(state)
    const end = view.viewport.to
    const start = view.viewport.from
    if (end > 300000) return b.finish()
    let depth = 0
    const marks = [0, 1, 2].map(i => Decoration.mark({ class: 'cm-rb' + i }))
    tree.iterate({
      from: 0, to: end,
      enter(node) {
        if (!BRACKET_NODES.has(node.name)) return
        for (let p = node.from; p < node.to; p++) {
          const ch = state.doc.sliceString(p, p + 1)
          if ('([{'.includes(ch)) {
            if (p >= start) b.add(p, p + 1, marks[depth % 3])
            depth++
          } else if (')]}'.includes(ch)) {
            depth = Math.max(0, depth - 1)
            if (p >= start) b.add(p, p + 1, marks[depth % 3])
          }
        }
      },
    })
    return b.finish()
  }
}, { decorations: v => v.decorations })

// ============================================================
// ホバー (ドキュメント表示)
// ============================================================
export function docTooltipDom(info) {
  const el = document.createElement('div')
  el.className = 'cm-doc-tooltip'
  const t = document.createElement('div')
  t.className = 'sig'
  t.textContent = info.title
  el.append(t)
  if (info.doc) { const d = document.createElement('div'); d.className = 'doc'; d.textContent = info.doc; el.append(d) }
  if (info.meta) { const d = document.createElement('div'); d.className = 'meta'; d.textContent = info.meta; el.append(d) }
  return el
}

export function makeHover(describe) {
  return hoverTooltip((view, pos) => {
    const info = describe(view.state, pos)
    if (!info) return null
    return { pos: info.from, end: info.to, above: true, create: () => ({ dom: docTooltipDom(info) }) }
  }, { hoverTime: 350 })
}

// ============================================================
// 引数ヒント (シグネチャヘルプ)
// ============================================================
export const toggleSignature = StateEffect.define()
export function signatureHelp(getSig, enabled) {
  return StateField.define({
    create: () => null,
    update(value, tr) {
      if (!enabled()) return null
      if (!tr.docChanged && !tr.selection) return value
      const sel = tr.state.selection.main
      if (!sel.empty) return null
      const sig = getSig(tr.state, sel.head)
      if (!sig) return null
      return { pos: sel.head, sig }
    },
    provide: f => showTooltip.compute([f], state => {
      const v = state.field(f)
      if (!v) return null
      return {
        pos: v.pos, above: true, strictSide: false, arrow: false,
        create: () => {
          const dom = document.createElement('div')
          dom.className = 'cm-sig-help'
          const { sig } = v
          const name = document.createElement('span')
          name.textContent = sig.label + '('
          dom.append(name)
          sig.params.forEach((p, i) => {
            const s = document.createElement('span')
            s.textContent = p.name + (p.type && p.type !== 'any' ? ': ' + p.type : '')
            if (i === sig.active) s.className = 'active'
            dom.append(s)
            if (i < sig.params.length - 1) dom.append(document.createTextNode(', '))
          })
          dom.append(document.createTextNode(')' + (sig.ret && sig.ret !== 'null' ? ': ' + sig.ret : '')))
          if (sig.doc) { const d = document.createElement('div'); d.className = 'doc'; d.textContent = sig.doc; dom.append(d) }
          return { dom }
        },
      }
    }),
  })
}

// ============================================================
// ピンチで文字サイズ変更
// ============================================================
export function pinchZoom(onScale) {
  let startDist = 0, startSize = 0, active = false
  const dist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
  return EditorView.domEventHandlers({
    touchstart(e) {
      if (e.touches.length === 2) { active = true; startDist = dist(e); startSize = onScale(null) }
    },
    touchmove(e) {
      if (active && e.touches.length === 2) {
        const ratio = dist(e) / startDist
        onScale(Math.round(Math.max(9, Math.min(32, startSize * ratio))))
        e.preventDefault()
      }
    },
    touchend(e) { if (e.touches.length < 2) active = false },
  })
}
