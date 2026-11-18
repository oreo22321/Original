// AI の続きの提案 (ゴーストテキスト) — Tab で確定、Esc で消す
// ・入力が止まったら、内蔵の AI (Forge AI) に続きを頼んで薄い文字で出す
// ・AI キー (Alt + \) で、いつでも頼める
import { StateField, StateEffect, EditorView, Decoration, WidgetType, ViewPlugin, Prec, keymap, completionStatus, EditorSelection, Annotation } from '../../vendor/codemirror.js'

export const setGhost = StateEffect.define()
const ghostDismiss = Annotation.define()

class GhostWidget extends WidgetType {
  constructor(text) { super(); this.text = text }
  eq(o) { return o.text === this.text }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-ghost cm-ghost-ai'
    span.textContent = this.text
    span.setAttribute('aria-hidden', 'true')
    const accept = e => { e.preventDefault(); span.dispatchEvent(new CustomEvent('ghost-accept', { bubbles: true })) }
    span.addEventListener('mousedown', accept)
    span.addEventListener('touchend', accept)
    return span
  }
  ignoreEvent() { return false }
}

export const ghostField = StateField.define({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setGhost)) return e.value
    if (!value) return null
    if (tr.docChanged) {
      // 提案と同じ文字を打ったら、残りを出し続ける
      let next = null, touched = false
      tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
        touched = true
        const ins = inserted.toString()
        if (fromA === value.pos && toA === fromA && ins && value.text.startsWith(ins) && ins.length < value.text.length) next = { pos: toB, text: value.text.slice(ins.length) }
      })
      return touched ? next : value
    }
    if (tr.selection && tr.state.selection.main.head !== value.pos) return null
    return value
  },
  provide: f => EditorView.decorations.from(f, v => (v ? Decoration.set([Decoration.widget({ widget: new GhostWidget(v.text), side: 1 }).range(v.pos)]) : Decoration.none)),
})

export function hasGhost(state) { return !!state.field(ghostField, false) }

export async function requestAiGhost(view, aiProvider) {
  const state = view.state
  const sel = state.selection.main
  if (!sel.empty || !aiProvider) return false
  const pos = sel.head, docAt = state.doc
  let text = ''
  try { text = await aiProvider(state, pos, { manual: true }) } catch { return false }
  if (view.state.doc !== docAt || view.state.selection.main.head !== pos || !text || !text.trim()) return false
  view.dispatch({ effects: setGhost.of({ pos, text }) })
  return true
}

export function acceptGhost(view, partial = false) {
  const g = view.state.field(ghostField, false)
  if (!g) return false
  let text = g.text
  if (partial) { const m = /^(\s*\w+|\s*[^\w\s]+|\s+)/.exec(text); text = m ? m[0] : text }
  view.dispatch({
    changes: { from: g.pos, insert: text },
    selection: EditorSelection.cursor(g.pos + text.length),
    effects: setGhost.of(partial && text.length < g.text.length ? { pos: g.pos + text.length, text: g.text.slice(text.length) } : null),
    userEvent: 'input.complete',
    scrollIntoView: true,
  })
  return true
}

export function dismissGhost(view) {
  if (!view.state.field(ghostField, false)) return false
  view.dispatch({ effects: setGhost.of(null), annotations: ghostDismiss.of(true) })
  return true
}

// 入力が止まったら、AI に続きを頼む
export function aiGhost(getConfig) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view
      this.timer = 0
      this.onAccept = () => acceptGhost(view)
      view.dom.addEventListener('ghost-accept', this.onAccept)
    }
    update(u) {
      if (!u.docChanged) return
      const typed = u.transactions.some(tr => tr.isUserEvent('input.type'))
      clearTimeout(this.timer)
      if (!typed) return
      const c = getConfig()
      if (!c.enabled || !c.provider) return
      this.timer = setTimeout(async () => {
        const view = this.view
        if (completionStatus(view.state) === 'active' || hasGhost(view.state)) return
        const sel = view.state.selection.main
        if (!sel.empty) return
        // 行の途中 (カーソルの後ろに文字がある) は出さない
        const line = view.state.doc.lineAt(sel.head)
        if (view.state.doc.sliceString(sel.head, line.to).trim() && !/^[)\]}"']*\s*$/.test(view.state.doc.sliceString(sel.head, line.to))) return
        const pos = sel.head, docAt = view.state.doc
        let text = ''
        try { text = await c.provider(view.state, pos, { manual: false }) } catch { return }
        if (view.state.doc !== docAt || view.state.selection.main.head !== pos || !text || !text.trim()) return
        view.dispatch({ effects: setGhost.of({ pos, text }) })
      }, Math.max(300, c.delay || 700))
    }
    destroy() { clearTimeout(this.timer); this.view.dom.removeEventListener('ghost-accept', this.onAccept) }
  })
  const keys = Prec.high(keymap.of([
    { key: 'Tab', run: view => (completionStatus(view.state) === 'active' ? false : acceptGhost(view)) },
    { key: 'Mod-ArrowRight', run: view => acceptGhost(view, true) },
    { key: 'Escape', run: view => dismissGhost(view) },
  ]))
  return [ghostField, plugin, keys]
}
