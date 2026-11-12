// end の自動挿入・自動削除 (Luau)
//  ・if ... then / for ... do / while ... do / function(...) を書き終えた時点で、次の行に end を追加
//  ・ブロックの開始語 (if / for / while / function …) を消したら、対になっていた end も消す
//  ・自動で入れた end の上に自分で end を書いたら、自動の方を取り除く (二重にならない)
// すべて入力と同じ 1 回の操作としてまとめるので、元に戻す (⌘Z) 1 回で戻せます。
import { StateField, StateEffect, EditorState, ViewPlugin, ChangeSet } from '../../vendor/codemirror.js'
import { completedHeader, orphanedClosers, scanBlocks } from './blocks.js'

// 自動で入れた end の位置 (その end を含むブロックを書いている間だけ覚えておく)
export const addAutoEnd = StateEffect.define({ map: (v, m) => ({ pos: m.mapPos(v.pos, 1), from: m.mapPos(v.from, -1) }) })

export const autoEndField = StateField.define({
  create: () => [],
  update(list, tr) {
    if (tr.docChanged && list.length) list = list.map(v => ({ pos: tr.changes.mapPos(v.pos, 1), from: tr.changes.mapPos(v.from, -1) }))
    for (const e of tr.effects) if (e.is(addAutoEnd)) list = [...list.filter(v => v.pos !== e.value.pos), e.value].slice(-8)
    if (!list.length) return list
    const doc = tr.newDoc
    const head = tr.newSelection.main.head
    return list.filter(v => {
      if (v.pos + 3 > doc.length || doc.sliceString(v.pos, v.pos + 3) !== 'end' || /\w/.test(doc.sliceString(v.pos + 3, v.pos + 4))) return false
      // カーソルがブロックの外へ出たら追跡をやめる
      return head >= v.from && head <= doc.lineAt(v.pos).to
    })
  },
})

const OPENER_NEAR = /(?:^|[^\w])(if|for|while|function|repeat|do)(?![\w])/
const isWordChar = c => /\w/.test(c || '')

function removedOpener(tr) {
  let hit = false
  const doc = tr.startState.doc
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (hit || toA <= fromA) return
    // 消した範囲を単語の境目まで広げて、開始語がまるごと含まれるか
    const a = Math.max(0, fromA - 12), b = Math.min(doc.length, toA + 12)
    const s = doc.sliceString(a, b)
    let l = fromA - a, r = toA - a
    while (l > 0 && isWordChar(s[l - 1])) l--
    while (r < s.length && isWordChar(s[r])) r++
    if (OPENER_NEAR.test(s.slice(l, r))) hit = true
  })
  return hit
}

// 入力のあと、手で書いた end と自動の end が二重になっていれば自動の方を消す
function consumeAutoEnd(tr, list) {
  const doc = tr.newDoc
  const head = tr.newSelection.main.head
  // end を打っている途中 (endTime など、続きを書くかもしれない) なら待つ
  if (isWordChar(doc.sliceString(head - 1, head))) return null
  let near = false
  tr.changes.iterChangedRanges((fA, tA, fromB, toB) => {
    if (near) return
    const a = Math.max(0, fromB - 5), b = Math.min(doc.length, toB + 5)
    if (/(?:^|[^\w])end(?![\w])/.test(doc.sliceString(a, b))) near = true
  })
  if (!near) return null
  const newText = doc.toString()
  const after = scanBlocks(newText)
  if (!after.extra.length) return null
  for (const v of [...list].reverse()) {
    const pos = tr.changes.mapPos(v.pos, 1)
    const line = doc.lineAt(pos)
    // 自分で書いた end の直後に入力しているとき、その end は対象外
    if (head >= line.from && head <= line.to) continue
    if (line.text.trim() !== 'end') continue
    const from = line.from > 0 ? line.from - 1 : 0
    const to = line.from > 0 ? line.to : Math.min(doc.length, line.to + 1)
    const res = newText.slice(0, from) + newText.slice(to)
    const chk = scanBlocks(res)
    if (chk.extra.length < after.extra.length && chk.unclosed.length <= after.unclosed.length) return { from, to }
  }
  return null
}

export function autoEndPairs(getConfig) {
  const filter = EditorState.transactionFilter.of(tr => {
    if (!tr.docChanged) return tr
    // 入力 (1 文字・改行・補完の確定)。貼り付け・ドロップ・変換中・自動修正は対象外
    const typed = tr.isUserEvent('input') && !tr.isUserEvent('input.paste') && !tr.isUserEvent('input.drop') && !tr.isUserEvent('input.type.compose') && !tr.isUserEvent('input.fix') && !tr.isUserEvent('input.format') && !tr.isUserEvent('input.autoend') && !tr.isUserEvent('input.rename')
    const deleted = tr.isUserEvent('delete') && !tr.isUserEvent('delete.cut')
    if (!typed && !deleted) return tr
    const cfg = getConfig()
    if (!cfg.insert && !cfg.remove) return tr
    const sel = tr.newSelection
    if (sel.ranges.length > 1) return tr
    try {
      // 1. ブロックの開始語を消した → 対の end も消す
      if (cfg.remove && removedOpener(tr)) {
        const ranges = orphanedClosers(tr.startState.doc.toString(), tr.newDoc.toString(), tr.changes)
        if (ranges.length) return [tr, { changes: ranges, sequential: true }]
      }
      if (!typed || !cfg.insert) return tr
      // 2. 見出しを書き終えた → end を追加
      const head = sel.main.head
      if (sel.main.empty) {
        const line = tr.newDoc.lineAt(head)
        const before = line.text.slice(0, head - line.from)
        // function は ( か ) を入力したときだけ (引数を書いている間は調べない)
        let paren = false, multi = false
        tr.changes.iterChanges((fA, tA, fB, tB, ins) => { const t = ins.toString(); if (/[()]/.test(t)) paren = true; if (t.includes('\n')) multi = true })
        // 複数行をまとめて入力 (貼り付けに近い) したときは入れない
        if (!multi && (/(?:^|[^\w])(then|do)$/.test(before) || (paren && /\bfunction\b/.test(before)))) {
          const hd = completedHeader(tr.newDoc.toString(), head, tr.startState.tabSize)
          if (hd) {
            const cs = ChangeSet.of(hd.changes, tr.newDoc.length)
            const pos = cs.mapPos(hd.at, -1) + hd.offset
            // (効果は位置が確定した後の別の段に置く)
            return [tr, { changes: hd.changes, sequential: true }, { effects: addAutoEnd.of({ pos, from: line.from }), sequential: true }]
          }
        }
      }
      // 3. 自分で end を書いた → 自動で入れた end を取り除く
      const list = tr.startState.field(autoEndField, false)
      if (list && list.length) {
        const r = consumeAutoEnd(tr, list)
        if (r) return [tr, { changes: r, sequential: true }]
      }
    } catch (e) {
      // 補助機能なので、失敗しても入力そのものは通す
    }
    return tr
  })

  // 日本語入力 (変換) で then / do を確定したとき
  const compose = ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view
      this.onEnd = () => setTimeout(() => this.check(), 0)
      view.contentDOM.addEventListener('compositionend', this.onEnd)
    }
    check() {
      const view = this.view
      if (view.composing || !getConfig().insert) return
      const { state } = view
      const sel = state.selection.main
      if (!sel.empty || state.selection.ranges.length > 1) return
      const line = state.doc.lineAt(sel.head)
      const before = line.text.slice(0, sel.head - line.from)
      if (!/(?:^|[^\w])(then|do)$/.test(before) && !/\bfunction\b/.test(before)) return
      const hd = completedHeader(state.doc.toString(), sel.head, state.tabSize)
      if (!hd) return
      const cs = state.changes(hd.changes)
      view.dispatch({ changes: cs, effects: addAutoEnd.of({ pos: cs.mapPos(hd.at, -1) + hd.offset, from: line.from }), userEvent: 'input.autoend' })
    }
    destroy() { this.view.contentDOM.removeEventListener('compositionend', this.onEnd) }
  })

  return [autoEndField, filter, compose]
}
