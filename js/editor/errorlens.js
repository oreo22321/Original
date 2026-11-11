// エラーレンズ: エラー・警告の内容を、その行の右側に表示します。
// スマホではマウスを乗せる操作ができないため、タップすると内容と「修正」ボタンを表示します。
import { StateField, StateEffect, EditorView, Decoration, WidgetType, setDiagnosticsEffect } from '../../vendor/codemirror.js'

const RANK = { error: 3, warning: 2, info: 1, hint: 0 }

class LensWidget extends WidgetType {
  constructor(diags) { super(); this.diags = diags }
  eq(o) {
    if (o.diags.length !== this.diags.length) return false
    for (let i = 0; i < this.diags.length; i++) if (o.diags[i].message !== this.diags[i].message || o.diags[i].severity !== this.diags[i].severity) return false
    return true
  }
  toDOM() {
    const d = this.diags[0]
    const el = document.createElement('span')
    el.className = 'cm-lens cm-lens-' + d.severity
    el.textContent = (d.severity === 'error' ? '✕ ' : d.severity === 'warning' ? '⚠ ' : 'ⓘ ') + d.message.split('\n')[0] + (this.diags.length > 1 ? `  (+${this.diags.length - 1})` : '')
    el.setAttribute('role', 'button')
    el.title = this.diags.map(x => x.message).join('\n')
    el.diags = this.diags
    return el
  }
  ignoreEvent() { return false }
}

function build(state, diags) {
  const byLine = new Map()
  for (const d of diags) {
    if (d.severity === 'hint' || d.from > state.doc.length) continue
    const line = state.doc.lineAt(d.from)
    let list = byLine.get(line.number)
    if (!list) byLine.set(line.number, list = { to: line.to, items: [] })
    list.items.push(d)
  }
  const ranges = []
  for (const { to, items } of [...byLine.values()].sort((a, b) => a.to - b.to)) {
    items.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.from - b.from)
    ranges.push(Decoration.widget({ widget: new LensWidget(items), side: 2 }).range(to))
  }
  return Decoration.set(ranges)
}

export function errorLens(onTap) {
  const field = StateField.define({
    create: () => Decoration.none,
    update(deco, tr) {
      for (const e of tr.effects) if (e.is(setDiagnosticsEffect)) return build(tr.state, e.value)
      return tr.docChanged ? deco.map(tr.changes) : deco
    },
    provide: f => EditorView.decorations.from(f),
  })
  return [
    field,
    EditorView.domEventHandlers({
      mousedown(e, view) {
        const el = e.target instanceof Element ? e.target.closest('.cm-lens') : null
        if (!el || !el.diags) return false
        e.preventDefault()
        if (onTap) onTap(view, el.diags, el)
        return true
      },
    }),
  ]
}

// ---- 実行時エラーの行を目立たせる (編集すると消えます) ----
export const setRunError = StateEffect.define() // { line, message } | null

class RunErrorWidget extends WidgetType {
  constructor(message) { super(); this.message = message }
  eq(o) { return o.message === this.message }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-lens cm-lens-error cm-lens-run'
    el.textContent = '▶ 実行エラー: ' + this.message.split('\n')[0]
    el.title = this.message
    return el
  }
}

export const runErrorMarks = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setRunError)) continue
      if (!e.value) return Decoration.none
      const line = tr.state.doc.line(Math.max(1, Math.min(tr.state.doc.lines, e.value.line)))
      return Decoration.set([
        Decoration.line({ class: 'cm-run-error' }).range(line.from),
        Decoration.widget({ widget: new RunErrorWidget(e.value.message), side: 3 }).range(line.to),
      ])
    }
    return tr.docChanged ? Decoration.none : deco
  },
  provide: f => EditorView.decorations.from(f),
})
