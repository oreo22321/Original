// ブレークポイント (行番号の左の赤い点) と、デバッガーで止まっている行の表示
import { StateField, StateEffect, RangeSet, GutterMarker, gutter, EditorView, Decoration, hoverTooltip } from '../../vendor/codemirror.js'

class BpMarker extends GutterMarker {
  constructor(data) { super(); this.data = data || {} }
  eq(o) { return o.data.cond === this.data.cond && o.data.log === this.data.log && o.data.off === this.data.off }
  toDOM() {
    const el = document.createElement('div')
    const d = this.data
    el.className = 'cm-bp' + (d.log ? ' log' : d.cond ? ' cond' : '') + (d.off ? ' off' : '')
    el.title = d.log ? `ログポイント: ${d.log}` : d.cond ? `条件付き: ${d.cond}` : 'ブレークポイント (タップで解除)'
    return el
  }
}

class ArrowMarker extends GutterMarker {
  toDOM() { const el = document.createElement('div'); el.className = 'cm-debug-arrow'; return el }
}
const arrow = new ArrowMarker()

// { line, data } で 1 行の切り替え / { list } で全体を置き換え
export const bpEffect = StateEffect.define()

function build(doc, list) {
  const ranges = []
  for (const b of list) {
    if (b.line < 1 || b.line > doc.lines) continue
    ranges.push(new BpMarker(b).range(doc.line(b.line).from))
  }
  return RangeSet.of(ranges, true)
}

export const bpField = StateField.define({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(bpEffect)) continue
      if (e.value.list) set = build(tr.state.doc, e.value.list)
      else {
        const pos = tr.state.doc.line(e.value.line).from
        let had = false
        set.between(pos, pos, () => { had = true })
        set = set.update({ filter: from => from !== pos })
        if (e.value.data || !had) set = set.update({ add: [new BpMarker(e.value.data || {}).range(pos)] })
      }
    }
    return set
  },
})

// 行ごとのブレークポイント一覧 [{ line, cond, log, off }]
export function breakpointsOf(state) {
  const set = state.field(bpField, false)
  const out = []
  if (!set) return out
  const seen = new Set()
  set.between(0, state.doc.length, (from, to, m) => {
    const line = state.doc.lineAt(from).number
    if (seen.has(line)) return
    seen.add(line)
    out.push({ ...m.data, line })
  })
  return out
}

export function toggleBreakpoint(view, line, data) {
  view.dispatch({ effects: bpEffect.of({ line, data }) })
}

export function setBreakpointList(view, list) {
  view.dispatch({ effects: bpEffect.of({ list }) })
}

// ---- 止まっている行 ----
export const debugLineEffect = StateEffect.define() // 行番号 | null
const lineDeco = Decoration.line({ class: 'cm-debug-line' })
export const debugLineField = StateField.define({
  create: () => null,
  update(v, tr) {
    if (v !== null && tr.docChanged) v = tr.changes.mapPos(v)
    for (const e of tr.effects) if (e.is(debugLineEffect)) v = e.value === null || e.value > tr.state.doc.lines ? null : tr.state.doc.line(e.value).from
    return v
  },
  provide: f => EditorView.decorations.from(f, v => (v === null ? Decoration.none : Decoration.set([lineDeco.range(v)]))),
})

// onChange(list): ブレークポイントが変わったとき (行番号のずれも含む)
// onEdit(line, anchor): 赤い点の長押し・右クリック (条件・ログの編集)
export function breakpointGutter(onChange, initial, onEdit) {
  let timer = null
  let press = null, suppressUntil = 0
  const hasBp = (view, line) => { let had = false; const p = view.state.doc.line(line).from; view.state.field(bpField).between(p, p, () => { had = true }); return had }
  return [
    initial && initial.length ? bpField.init(state => build(state.doc, initial)) : bpField,
    debugLineField,
    gutter({
      class: 'cm-bp-gutter',
      renderEmptyElements: true,
      markers: v => {
        const set = v.state.field(bpField)
        const at = v.state.field(debugLineField)
        if (at === null) return set
        return set.update({ add: [arrow.range(at)], sort: true })
      },
      initialSpacer: () => arrow,
      domEventHandlers: {
        mousedown(view, line, e) {
          if (Date.now() < suppressUntil || e.button === 2) return true
          toggleBreakpoint(view, view.state.doc.lineAt(line.from).number)
          return true
        },
        contextmenu(view, line, e) {
          e.preventDefault()
          const n = view.state.doc.lineAt(line.from).number
          if (!hasBp(view, n)) toggleBreakpoint(view, n)
          if (onEdit) onEdit(n, e.target)
          return true
        },
        // 長押しで条件・ログの編集
        touchstart(view, line, e) {
          clearTimeout(press)
          const n = view.state.doc.lineAt(line.from).number
          const target = e.target
          press = setTimeout(() => {
            press = null
            suppressUntil = Date.now() + 900
            if (!hasBp(view, n)) toggleBreakpoint(view, n)
            if (onEdit) onEdit(n, target)
          }, 500)
          return false
        },
        touchmove() { clearTimeout(press); press = null; return false },
        touchend() { clearTimeout(press); press = null; return false },
      },
    }),
    EditorView.updateListener.of(u => {
      if (!onChange) return
      const changed = u.transactions.some(tr => tr.effects.some(e => e.is(bpEffect)))
      if (!changed && !(u.docChanged && u.state.field(bpField).size)) return
      clearTimeout(timer)
      timer = setTimeout(() => onChange(breakpointsOf(u.view.state)), changed ? 0 : 400)
    }),
  ]
}

// 止まっている間、変数にカーソルを合わせると値を表示
export function debugHover(getValue) {
  return hoverTooltip((view, pos) => {
    if (view.state.field(debugLineField, false) === null) return null
    const word = view.state.wordAt(pos)
    if (!word) return null
    // a.b.c のような参照もまとめて
    const line = view.state.doc.lineAt(pos)
    let from = word.from
    while (from > line.from) {
      const m = /([A-Za-z_]\w*)\s*[.:]\s*$/.exec(line.text.slice(0, from - line.from))
      if (!m) break
      from = line.from + m.index
    }
    const expr = view.state.sliceDoc(from, word.to).replace(/\s+/g, '')
    const v = getValue(expr)
    if (!v) return null
    return {
      pos: from, end: word.to, above: true,
      create() {
        const dom = document.createElement('div')
        dom.className = 'cm-debug-tip'
        const name = document.createElement('span')
        name.className = 'dt-name'
        name.textContent = expr + ' = '
        const val = document.createElement('span')
        val.className = 'dt-val t-' + (v.t || 'x')
        val.textContent = v.v
        dom.append(name, val)
        return { dom }
      },
    }
  }, { hoverTime: 250 })
}
