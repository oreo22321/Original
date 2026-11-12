// コードの移動と名前の変更: 定義へ移動 (F12) / 参照を検索 (⇧F12) / 名前の変更 (F2)
import { EditorSelection, EditorView, copyLineDown, moveLineUp, moveLineDown, selectNextOccurrence } from '../../vendor/codemirror.js'
import { app, command, runCommand } from './app.js'
import { h, icon, toast, modal, promptDialog, menu, haptic } from './ui.js'
import { symbolsOf, refAt, identAt } from '../editor/symbols.js'
import { langOf } from '../editor/setup.js'

const KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while', 'continue', 'self'])
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function current() {
  const view = app.editors.activeView()
  const doc = app.editors.activeDoc()
  if (!view || !doc || doc.lang !== 'luau') return null
  const pos = view.state.selection.main.head
  const id = identAt(view.state, pos) || identAt(view.state, Math.max(0, pos - 1))
  return { view, doc, pos, id }
}

// プロジェクトの Luau ファイル (開いているものは編集中の内容)
function luauFiles() {
  const out = []
  for (const f of app.files) {
    if (f.dir || langOf(f.path) !== 'luau') continue
    const d = app.editors.docs.get(f.path)
    out.push({ path: f.path, text: d ? d.state.doc.toString() : app.contents.get(f.path) || '' })
  }
  return out
}

// 文字列とコメントを同じ長さの空白に置き換える (位置を保ったまま検索するため)
function blankStrings(text) {
  return text.replace(/--\[(=*)\[[\s\S]*?\]\1\]|--[^\n]*|\[(=*)\[[\s\S]*?\]\2\]|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, m => m.replace(/[^\n]/g, ' '))
}

function lineInfo(text, pos) {
  const ls = text.lastIndexOf('\n', pos - 1) + 1
  let le = text.indexOf('\n', pos)
  if (le < 0) le = text.length
  return { line: text.slice(0, ls).split('\n').length, col: pos - ls, text: text.slice(ls, le) }
}

// 正規表現の一致 (グループ 1 の位置) をファイル横断で集める
function searchAll(re, files, group = 1) {
  const out = []
  for (const f of files) {
    const clean = blankStrings(f.text)
    re.lastIndex = 0
    let m
    while ((m = re.exec(clean))) {
      const off = m.index + m[0].indexOf(m[group])
      const li = lineInfo(f.text, off)
      out.push({ path: f.path, from: off, to: off + m[group].length, line: li.line, col: li.col, preview: li.text })
      if (out.length > 400) return out
      if (m[0].length === 0) re.lastIndex++
    }
  }
  return out
}

function memberDefs(name, files) {
  const n = esc(name)
  const re = new RegExp(`function\\s+[\\w.]+[.:](${n})\\s*\\(|[\\w\\]\\)]\\s*\\.\\s*(${n})\\s*=(?!=)|^[ \\t]*(${n})\\s*=(?!=)\\s*function\\b|[{,][ \\t]*(${n})\\s*=(?!=)`, 'gm')
  const out = []
  for (const g of [1, 2, 3, 4]) out.push(...searchAll(re, files, g).filter(x => x.to > x.from))
  return dedupe(out)
}
function globalDefs(name, files) {
  const n = esc(name)
  const re = new RegExp(`^[ \\t]*(?:function[ \\t]+(${n})[ \\t]*\\(|(${n})[ \\t]*=(?!=))`, 'gm')
  return dedupe([...searchAll(re, files, 1), ...searchAll(re, files, 2)])
}
function dedupe(list) {
  const seen = new Set()
  return list.filter(x => { const k = x.path + ':' + x.from; if (seen.has(k)) return false; seen.add(k); return true }).sort((a, b) => a.path.localeCompare(b.path) || a.from - b.from)
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

// ---- 定義へ移動 ----
export async function gotoDefinition() {
  const c = current()
  if (!c || !c.id) { toast('変数名や関数名の上にカーソルを置いてください', { duration: 1800 }); return }
  const { view, doc, id } = c
  if (KEYWORDS.has(id.name) && !id.member) { toast(`'${id.name}' はキーワードです`, { duration: 1500 }); return }
  if (!id.member) {
    const an = symbolsOf(view.state)
    const r = an && refAt(an, id.from)
    if (r && r.sym.kind !== 'global') {
      if (!r.sym.decl) { toast(`'${id.name}' はメソッドの self です`, { duration: 1500 }); return }
      if (r.decl) { toast('ここが定義です', { duration: 1200 }); return }
      return jump({ path: doc.path, from: r.sym.decl.s, to: r.sym.decl.e })
    }
    // グローバル: このファイル → 他のファイルの順で探す
    const here = globalDefs(id.name, [{ path: doc.path, text: view.state.doc.toString() }]).filter(x => x.from !== id.from)
    if (here.length) return jump(here[0])
    const others = globalDefs(id.name, luauFiles().filter(f => f.path !== doc.path))
    if (others.length === 1) return jump(others[0])
    if (others.length > 1) return showResults(`'${id.name}' の定義`, others)
    toast(`'${id.name}' の定義は見つかりませんでした (Roblox / Luau の組み込みの可能性があります)`, { duration: 2500 })
    return
  }
  // a.b / a:b のメンバー
  const files = luauFiles()
  const mine = files.find(f => f.path === doc.path)
  const sorted = mine ? [mine, ...files.filter(f => f !== mine)] : files
  const defs = memberDefs(id.name, sorted).filter(x => !(x.path === doc.path && x.from === id.from))
  if (defs.length === 1) return jump(defs[0])
  if (defs.length > 1) return showResults(`'${id.name}' の定義`, defs)
  toast(`'${id.name}' の定義は見つかりませんでした (Roblox の API の可能性があります。ホバーで説明を見られます)`, { duration: 2600 })
}

// ---- 参照を検索 ----
export function findReferences() {
  const c = current()
  if (!c || !c.id || (KEYWORDS.has(c.id.name) && !c.id.member)) { toast('変数名や関数名の上にカーソルを置いてください', { duration: 1800 }); return }
  const { view, doc, id } = c
  if (!id.member) {
    const an = symbolsOf(view.state)
    const r = an && refAt(an, id.from)
    if (r && r.sym.kind !== 'global') {
      const text = view.state.doc.toString()
      return showResults(`'${id.name}' の参照 (${r.sym.refs.length})`, r.sym.refs.map(x => ({ path: doc.path, from: x.s, to: x.e, ...lineInfo(text, x.s), decl: x.decl, write: x.write })))
    }
    // グローバル: すべてのファイルから (メンバーアクセス a.name は除く)
    const re = new RegExp(`(?<![\\w.:])(${esc(id.name)})(?!\\w)`, 'g')
    const list = searchAll(re, luauFiles())
    return showResults(`'${id.name}' の参照 (${list.length})`, list)
  }
  const re = new RegExp(`[.:]\\s*(${esc(id.name)})(?!\\w)|[{,][ \\t]*(${esc(id.name)})\\s*=(?!=)`, 'g')
  const files = luauFiles()
  const list = dedupe([...searchAll(re, files, 1), ...searchAll(re, files, 2)])
  showResults(`'.${id.name}' の参照 (${list.length})`, list)
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

// ---- 名前の変更 ----
export async function renameSymbol() {
  const c = current()
  if (!c || !c.id || (KEYWORDS.has(c.id.name) && !c.id.member)) { toast('変数名や関数名の上にカーソルを置いてください', { duration: 1800 }); return }
  const { view, doc, id } = c
  if (id.member) { toast('メンバー (a.b の b) の名前は「検索・置換」で変更してください', { duration: 2500 }); return }
  const an = symbolsOf(view.state)
  if (!an) { toast('構文エラーを直してから名前を変更してください', { kind: 'error', duration: 2200 }); return }
  const r = refAt(an, id.from)
  if (!r) return
  if (r.sym.kind === 'self') { toast('self の名前は変更できません', { duration: 1500 }); return }
  const isGlobal = r.sym.kind === 'global'
  const name = await promptDialog(`'${id.name}' の名前を変更`, {
    value: id.name, okLabel: '変更',
    label: isGlobal ? `このファイルの ${r.sym.refs.length} か所を変更します (グローバル変数)` : `${r.sym.refs.length} か所を変更します (同じ名前の別の変数はそのまま)`,
  })
  if (!name || name === id.name) return
  if (!/^[A-Za-z_]\w*$/.test(name) || KEYWORDS.has(name)) { toast(`'${name}' は名前に使えません`, { kind: 'error' }); return }
  // 新しい名前が、使う場所で別の変数を隠してしまわないか (簡易チェック)
  const clash = an.symbols.some(s => s !== r.sym && s.name === name && s.kind !== 'global')
  const changes = r.sym.refs.map(x => ({ from: x.s, to: x.e, insert: name }))
  view.dispatch({ changes, userEvent: 'input.rename', scrollIntoView: true })
  view.focus()
  toast(`${changes.length} か所を '${name}' に変更しました${clash ? ' (同じ名前の変数が他にもあります。動作を確認してください)' : ''}`, { icon: 'rename', duration: clash ? 4500 : 2500, action: { label: '元に戻す', run: () => runCommand('undo') } })
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
