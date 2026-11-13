// 自動整形 (裏で見た目を整える)
//  ・編集した行からカーソルが離れたら、その行の空白 (演算子・カンマの前後、行末) を整える
//  ・入力が止まって少したち、構文エラーがなければ、ファイル全体の字下げ・空白・空行を整える
// どちらもカーソルのある行には触れません。整形は元に戻す (Ctrl+Z) の履歴に入れないので、
// 元に戻すと自分の入力だけが戻ります。整形した行は一瞬だけ色が付きます。
import { ViewPlugin, StateField, StateEffect, Decoration, EditorView, Transaction, completionStatus, hasNextSnippetField, indentUnit } from '../../vendor/codemirror.js'
import { formatLuau, formatLineSpacing, detectIndentUnit } from './format.js'
import { parse } from '../luau/parser.js'
import { ghostField } from './inline.js'
import { inStringOrComment } from './typo.js'

const IDLE_LIMIT = 200000 // これより大きいファイルは全体の自動整形をしない

// ---- 整形した行を一瞬だけ光らせる ----
const flash = StateEffect.define()
const unflash = StateEffect.define()
const flashMark = Decoration.line({ class: 'cm-fmt-flash' })
const flashField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(flash)) deco = Decoration.set(e.value.map(p => flashMark.range(p)), true)
      else if (e.is(unflash)) deco = Decoration.none
    }
    return deco
  },
  provide: f => EditorView.decorations.from(f),
})

const busy = view => view.composing || completionStatus(view.state) === 'active' || !!view.state.field(ghostField, false) || hasNextSnippetField(view.state)

// 行単位の差分 (整形は空白と空行しか変えないので、空でない行は 1 対 1 で対応する)
export function lineChanges(doc, next, cursorLine) {
  const oldL = doc.toString().split('\n')
  const newL = next.split('\n')
  const changes = []
  const lineStart = i => (i < doc.lines ? doc.line(i + 1).from : doc.length)
  let i = 0, j = 0
  const blank = s => !s.trim()
  while (i < oldL.length || j < newL.length) {
    let bi = i, bj = j
    while (bi < oldL.length && blank(oldL[bi])) bi++
    while (bj < newL.length && blank(newL[bj])) bj++
    // 空行のかたまり
    const oldRun = oldL.slice(i, bi), newRun = newL.slice(j, bj)
    if (oldRun.join('\n') !== newRun.join('\n')) {
      const covers = cursorLine >= i + 1 && cursorLine <= bi
      if (!covers && bi < oldL.length && bj < newL.length) changes.push({ from: lineStart(i), to: lineStart(bi), insert: newRun.map(l => l + '\n').join('') })
    }
    i = bi; j = bj
    if (i >= oldL.length || j >= newL.length) break
    // 空白以外が同じであることを確認 (違えば何もしない)
    if (oldL[i].replace(/\s+/g, '') !== newL[j].replace(/\s+/g, '')) return null
    if (oldL[i] !== newL[j] && i + 1 !== cursorLine) { const ln = doc.line(i + 1); changes.push({ from: ln.from, to: ln.to, insert: newL[j] }) }
    i++; j++
  }
  return changes
}

// opts: () => { enabled }、onFormatted(lines, undo): 全体の整形をしたとき (行数と元に戻す関数)
export function autoFormat(getOpts, onFormatted) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view
      this.dirty = []         // 編集した位置 (変更に合わせてずらす)
      this.lineTimer = 0
      this.idleTimer = 0
      this.flashTimer = 0
      this.suppress = false   // 「元に戻す」の後は、次に編集するまで全体の整形をしない
    }
    update(u) {
      if (!getOpts().enabled) { this.dirty = []; return }
      if (u.docChanged) {
        if (this.dirty.length) this.dirty = this.dirty.map(p => u.changes.mapPos(p, 1))
        const user = u.transactions.some(tr => tr.docChanged && (tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('move')) && !tr.isUserEvent('input.format') && !tr.isUserEvent('input.paste'))
        const pasted = u.transactions.some(tr => tr.isUserEvent('input.paste'))
        if (user || pasted) {
          this.suppress = false
          if (user) u.changes.iterChangedRanges((fa, ta, fb, tb) => { this.dirty.push(fb); if (tb > fb) this.dirty.push(tb) })
          if (this.dirty.length > 60) this.dirty = this.dirty.slice(-60)
          this.scheduleIdle()
        }
      }
      if ((u.docChanged || u.selectionSet) && this.dirty.length) {
        clearTimeout(this.lineTimer)
        this.lineTimer = setTimeout(() => this.formatLeftLines(), 160)
      }
    }
    // カーソルが離れた (編集済みの) 行の空白を整える
    formatLeftLines() {
      const view = this.view
      if (!this.dirty.length || !getOpts().enabled) return
      if (busy(view)) { this.lineTimer = setTimeout(() => this.formatLeftLines(), 400); return }
      const { state } = view
      const doc = state.doc
      const cur = doc.lineAt(state.selection.main.head).number
      const keep = [], seen = new Set(), changes = []
      let text = null
      for (const p of this.dirty) {
        const line = doc.lineAt(Math.min(p, doc.length))
        if (line.number === cur) { keep.push(p); continue }
        if (seen.has(line.number)) continue
        seen.add(line.number)
        if (line.length > 3000 || !line.text.trim()) continue
        text = text || state.sliceDoc(0)
        if (inStringOrComment(text, line.from)) continue
        const f = formatLineSpacing(line.text)
        if (f !== line.text) changes.push({ from: line.from, to: line.to, insert: f })
      }
      this.dirty = keep
      if (changes.length) this.apply(changes, false)
    }
    scheduleIdle() {
      clearTimeout(this.idleTimer)
      this.idleTimer = setTimeout(() => this.formatIdle(), 1600)
    }
    // 入力が止まったら全体を整える (構文エラーがないときだけ)
    formatIdle() {
      const view = this.view
      if (!getOpts().enabled || this.suppress) return
      if (busy(view) || (typeof document !== 'undefined' && document.hidden)) { this.scheduleIdle(); return }
      const { state } = view
      const text = state.sliceDoc(0)
      if (text.length > IDLE_LIMIT || !text.trim()) return
      try { parse(text) } catch { return }
      const unit = detectIndentUnit(text) || state.facet(indentUnit)
      let next
      try { next = formatLuau(text, unit, { finalNewline: /\n$/.test(text) }) } catch { return }
      if (next === text) return
      const cursorLine = state.doc.lineAt(state.selection.main.head).number
      const changes = lineChanges(state.doc, next, cursorLine)
      if (!changes || !changes.length) return
      this.apply(changes, true)
    }
    apply(changes, whole) {
      const view = this.view
      const before = view.state.doc
      const spec = { changes, annotations: Transaction.addToHistory.of(false), userEvent: 'format.auto' }
      const tr = view.state.update(spec)
      // 光らせる行 (変更後の位置)
      const lines = new Set()
      for (const c of changes) { const p = tr.changes.mapPos(c.from, 1); if (p <= tr.newDoc.length) lines.add(tr.newDoc.lineAt(p).from) }
      view.dispatch({ ...spec, effects: flash.of([...lines].sort((a, b) => a - b)) })
      clearTimeout(this.flashTimer)
      this.flashTimer = setTimeout(() => { if (this.view.state.field(flashField, false) !== Decoration.none) this.view.dispatch({ effects: unflash.of(null) }) }, 900)
      if (whole && onFormatted && lines.size >= 3) {
        const after = view.state.doc
        const inverse = tr.changes.invert(before)
        onFormatted(lines.size, () => {
          // まだ他の編集をしていなければ、整形前に戻す
          if (this.view.state.doc !== after) return false
          this.suppress = true
          this.view.dispatch({ changes: inverse, annotations: Transaction.addToHistory.of(false), userEvent: 'format.auto' })
          return true
        })
      }
    }
    destroy() { clearTimeout(this.lineTimer); clearTimeout(this.idleTimer); clearTimeout(this.flashTimer) }
  })
  return [flashField, plugin]
}
