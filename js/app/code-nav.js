// コードの移動と名前の変更 (Python: jedi) — 定義へ移動 (F12) / 参照を検索 (⇧F12) / 名前の変更 (F2)
import { EditorSelection, EditorView, copyLineDown, moveLineUp, moveLineDown, selectNextOccurrence } from '../../vendor/codemirror.js'
import { app, command, runCommand } from './app.js'
import * as vfs from './vfs.js'
import { h, icon, toast, modal, promptDialog, menu, haptic } from './ui.js'
import { pythonGoto, pythonRefs, pythonRename, pythonFilesChanged } from '../editor/python.js'

const KEYWORDS = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'match', 'case'])

function current() {
  const view = app.editors.activeView()
  const doc = app.editors.activeDoc()
  if (!view || !doc || doc.lang !== 'python') return null
  const head = view.state.selection.main.head
  const word = view.state.wordAt(head) || view.state.wordAt(Math.max(0, head - 1))
  if (!word) return { view, doc, pos: head, name: null }
  return { view, doc, pos: word.from, name: view.state.sliceDoc(word.from, word.to), word }
}

function lineOf(text, line) { return (text.split('\n')[line - 1] || '') }
// jedi の位置 (行・0 始まりの列) を、ファイルの中の位置に
async function textOf(path) {
  const d = app.editors.docs.get(path)
  if (d) return d.state.doc.toString()
  const c = app.contents.has(path) ? app.contents.get(path) : await vfs.readFile(app.project.id, path)
  return typeof c === 'string' ? c : ''
}
function offsetOf(text, line, col) {
  let off = 0
  const lines = text.split('\n')
  for (let i = 0; i < line - 1 && i < lines.length; i++) off += lines[i].length + 1
  return off + col
}

async function jump(target) {
  haptic(6)
  await app.editors.open(target.path)
  const v = app.editors.viewFor(target.path)
  if (!v) return
  const pos = Math.min(target.from, v.state.doc.length)
  v.dispatch({ selection: EditorSelection.range(pos, Math.min(target.to ?? pos, v.state.doc.length)), effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
  v.focus()
}

function needName(c) {
  if (!c) { toast('Python のファイルで使えます', { duration: 1500 }); return true }
  if (!c.name || !/^[A-Za-z_]\w*$/.test(c.name)) { toast('変数名や関数名の上にカーソルを置いてください', { duration: 1800 }); return true }
  if (KEYWORDS.has(c.name)) { toast(`'${c.name}' はキーワードです`, { duration: 1500 }); return true }
  return false
}

// ---- 定義へ移動 ----
export async function gotoDefinition() {
  const c = current()
  if (needName(c)) return
  const { view, doc, pos, name } = c
  let list
  try { list = await pythonGoto(view.state, pos, doc.path) } catch { toast('準備中です。少し待ってからもう一度お試しください', { duration: 2000 }); return }
  const here = (list || []).filter(x => x.line)
  const inProject = here.filter(x => x.file)
  if (!inProject.length) {
    const b = here[0]
    toast(b && (b.builtin || b.module) ? `'${name}' は ${b.module && b.module !== 'builtins' ? b.module + ' の' : '組み込みの'}機能です (長押し・ホバーで説明を見られます)` : `'${name}' の定義は見つかりませんでした`, { duration: 2600 })
    return
  }
  const t = inProject[0]
  const text = await textOf(t.file)
  const from = offsetOf(text, t.line, t.col)
  if (t.file === doc.path && from === pos) { toast('ここが定義です', { duration: 1200 }); return }
  jump({ path: t.file, from, to: from + t.name.length })
}

// ---- 参照を検索 ----
export async function findReferences() {
  const c = current()
  if (needName(c)) return
  const { view, doc, pos, name } = c
  let list
  try { list = await pythonRefs(view.state, pos, doc.path) } catch { toast('準備中です。少し待ってからもう一度お試しください', { duration: 2000 }); return }
  const texts = new Map()
  const out = []
  for (const r of list || []) {
    if (!texts.has(r.file)) texts.set(r.file, await textOf(r.file))
    const text = texts.get(r.file)
    const from = offsetOf(text, r.line, r.col)
    out.push({ path: r.file, from, to: from + r.name.length, line: r.line, col: r.col, preview: lineOf(text, r.line), decl: r.decl })
  }
  showResults(`'${name}' の参照 (${out.length})`, out)
}

function showResults(title, list) {
  if (!list.length) { toast('見つかりませんでした', { duration: 1500 }); return }
  const body = h('div', { class: 'refs' })
  let m
  const byFile = new Map()
  for (const r of list) { if (!byFile.has(r.path)) byFile.set(r.path, []); byFile.get(r.path).push(r) }
  for (const [path, items] of byFile) {
    body.append(h('div', { class: 'refs-file' }, icon('file', 14), h('span', null, path), h('span', { class: 'badge' }, items.length)))
    for (const r of items) {
      const pre = r.preview || r.text || ''
      const lead = pre.length - pre.trimStart().length
      const a = Math.max(0, r.col - lead)
      const t = pre.trim()
      const hit = h('span', { class: 'refs-hit' }, t.slice(a, a + (r.to - r.from)))
      body.append(h('button', { class: 'refs-row' + (r.decl ? ' decl' : r.write ? ' write' : ''), onclick: () => { m.close(); jump(r) } },
        h('span', { class: 'refs-line' }, r.line),
        h('span', { class: 'refs-code' }, t.slice(0, a), hit, t.slice(a + (r.to - r.from))),
        r.decl ? h('span', { class: 'refs-tag' }, '宣言') : r.write ? h('span', { class: 'refs-tag w' }, '代入') : null))
    }
  }
  m = modal({ title, body, wide: true, cls: 'refs-modal' })
}

// ---- 名前の変更 (ほかのファイルで使っている場所もまとめて) ----
export async function renameSymbol() {
  const c = current()
  if (needName(c)) return
  const { view, doc, pos, name } = c
  if (name === 'self') { toast('self の名前は変更できません', { duration: 1500 }); return }
  const next = await promptDialog(`'${name}' の名前を変更`, { value: name, okLabel: '変更', label: '使っている場所をすべて変更します (ほかのファイルも)' })
  if (!next || next === name) return
  if (!/^[A-Za-z_]\w*$/.test(next) || KEYWORDS.has(next)) { toast(`'${next}' は名前に使えません`, { kind: 'error' }); return }
  let res
  try { res = await pythonRename(view.state, pos, doc.path, next) } catch (e) { toast('名前を変更できませんでした: ' + e.message, { kind: 'error' }); return }
  if (!res || res.error || !res.files) { toast('名前を変更できませんでした' + (res && res.error ? ': ' + res.error : ''), { kind: 'error', duration: 3500 }); return }
  const paths = Object.keys(res.files)
  let count = 0
  for (const path of paths) {
    const text = res.files[path]
    const d = app.editors.docs.get(path)
    const before = d ? d.state.doc.toString() : await textOf(path)
    count += (before.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length - (text.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length
    if (d) {
      const v = app.editors.viewFor(path)
      // 変わった行だけ置き換える (カーソルの位置を保つ)
      const a = before.split('\n'), b = text.split('\n')
      const changes = []
      let off = 0
      for (let i = 0; i < a.length; i++) {
        if (i < b.length && a[i] !== b[i]) changes.push({ from: off, to: off + a[i].length, insert: b[i] })
        off += a[i].length + 1
      }
      if (a.length !== b.length) changes.splice(0, changes.length, { from: 0, to: before.length, insert: text })
      if (v) v.dispatch({ changes, userEvent: 'input.rename', scrollIntoView: true })
      else app.editors.replaceAll(d, text)
    } else {
      await vfs.writeFile(app.project.id, path, text)
      app.contents.set(path, text)
    }
  }
  pythonFilesChanged()
  view.focus()
  toast(`${Math.max(count, 1)} か所を '${next}' に変更しました${paths.length > 1 ? ` (${paths.length} ファイル)` : ''}`, { icon: 'rename', duration: 2800, action: paths.length === 1 ? { label: '元に戻す', run: () => runCommand('undo') } : undefined })
}

// ---- スマホ用: コード操作のメニュー ----
export function codeMenu(anchor) {
  const c = current()
  const name = c && c.id ? c.id.name : null
  menu([
    { label: name ? `'${name}' の定義へ移動` : '定義へ移動', icon: 'target', run: gotoDefinition },
    { label: '参照を検索', icon: 'refs', run: findReferences },
    { label: '名前を変更 (すべての場所)', icon: 'rename', run: renameSymbol },
    '-',
    { label: 'ブレークポイントの切り替え', icon: 'bug', run: () => runCommand('toggleBreakpoint') },
    { label: '行を複製', icon: 'copy', run: () => runCommand('copyLineDown') },
    { label: '行を上へ移動', icon: 'arrowUp', run: () => runCommand('moveLineUp') },
    { label: '行を下へ移動', icon: 'arrowDown', run: () => runCommand('moveLineDown') },
    { label: 'ドキュメントを整形', icon: 'format', run: () => runCommand('format') },
  ], anchor, { title: 'コード操作' })
}

const onView = f => () => { const v = app.editors.activeView(); if (v) { f(v); v.focus() } }
command('copyLineDown', '行を下に複製', onView(copyLineDown), { icon: 'copy', key: '⇧⌥↓' })
command('moveLineUp', '行を上へ移動', onView(moveLineUp), { icon: 'arrowUp', key: '⌥↑' })
command('moveLineDown', '行を下へ移動', onView(moveLineDown), { icon: 'arrowDown', key: '⌥↓' })
command('selectNextOccurrence', '同じ単語を追加で選択 (マルチカーソル)', onView(selectNextOccurrence), { key: '⌘D' })
command('gotoDefinition', '定義へ移動', gotoDefinition, { icon: 'target', key: 'F12' })
command('findReferences', '参照を検索', findReferences, { icon: 'refs', key: '⇧F12' })
command('renameSymbol', '名前を変更 (すべての場所)', renameSymbol, { icon: 'rename', key: 'F2' })
command('codeMenu', 'コード操作メニュー', a => codeMenu(a), { icon: 'target' })
