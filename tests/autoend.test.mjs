// end の自動挿入・自動削除のテスト:  node tests/autoend.test.mjs
import { EditorState, EditorSelection, Transaction, indentUnit, insertNewlineAndIndent, deleteCharBackward, history, undo, indentOnInput } from '../vendor/codemirror.js'
import { luauLanguage } from '../js/editor/luau-lang.js'
import { autoEndPairs } from '../js/editor/autoend.js'
import { autoEndCommand } from '../js/editor/inline.js'
import { completedHeader, orphanedClosers } from '../js/editor/blocks.js'

let pass = 0, fail = 0
const eq = (name, got, want) => { if (got === want) pass++; else { fail++; console.log(`✕ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`) } }

const cfg = { insert: true, remove: true }
function make(doc) {
  const pos = doc.indexOf('|')
  const text = doc.replace('|', '')
  return EditorState.create({ doc: text, selection: EditorSelection.cursor(pos < 0 ? 0 : pos), extensions: [luauLanguage, indentUnit.of('\t'), EditorState.tabSize.of(4), history(), indentOnInput(), autoEndPairs(() => cfg)] })
}
const show = st => { const p = st.selection.main.head; const t = st.doc.toString(); return t.slice(0, p) + '|' + t.slice(p) }
// コマンドを動かすための最小限の view (dispatch は Transaction と spec の両方を受け付ける)
function viewOf(st, set) {
  const view = { get state() { return st }, dispatch: (...a) => { st = a[0] instanceof Transaction ? a[0].state : st.update(...a).state; set(st) } }
  return view
}
// 1 文字ずつ入力する
function type(st, text) {
  for (const ch of text) {
    if (ch === '\n') {
      const view = viewOf(st, s => { st = s })
      if (!autoEndCommand(view)) insertNewlineAndIndent(view)
      continue
    }
    const sel = st.selection.main
    st = st.update({ changes: { from: sel.from, to: sel.to, insert: ch }, selection: EditorSelection.cursor(sel.from + 1), userEvent: 'input.type' }).state
  }
  return st
}
function backspace(st, n = 1) {
  for (let i = 0; i < n; i++) deleteCharBackward({ state: st, dispatch: tr => { st = tr.state } })
  return st
}
function delRange(st, from, to, userEvent = 'delete.selection') {
  return st.update({ changes: { from, to }, selection: EditorSelection.cursor(from), userEvent }).state
}

// ---- 見出しを書いた時点で end ----
eq('if then', show(type(make('|'), 'if x then')), 'if x then|\nend')
eq('for do', show(type(make('|'), 'for i = 1, 10 do')), 'for i = 1, 10 do|\nend')
eq('while do', show(type(make('|'), 'while true do')), 'while true do|\nend')
eq('generic for', show(type(make('|'), 'for _, v in pairs(t) do')), 'for _, v in pairs(t) do|\nend')
eq('function parens typed', show(type(make('|'), 'local function foo()')), 'local function foo()|\nend')
eq('indented', show(type(make('function a()\n\t|\nend'), 'if ok then')), 'function a()\n\tif ok then|\n\tend\nend')
eq('then then Enter', show(type(make('|'), 'if x then\nprint(1)')), 'if x then\n\tprint(1)|\nend')
eq('no end for incomplete cond', show(type(make('|'), 'if x == then')), 'if x == then|')
eq('no end for if then', show(type(make('|'), 'if then')), 'if then|')
eq('no end for in do (typing doors)', show(type(make('|'), 'for _, d in do')), 'for _, d in do|')
eq('no end while typing name do…', show(type(make('|'), 'done = true')), 'done = true|')
eq('no end in string', show(type(make('|'), 'print("if x then')), 'print("if x then|')
eq('no end in comment', show(type(make('|'), '-- if x then')), '-- if x then|')
eq('no end when already closed', show(type(make('|\nend'), 'if x then')), 'if x then|\nend')
eq('elseif no extra end', show(type(make('if a then\n\tx()\n|\nend'), 'elseif b then')), 'if a then\n\tx()\nelseif b then|\nend')
eq('one-liner keeps single end', show(type(make('|'), 'if x then return end ')), 'if x then return end |')
// 関数を引数に渡す (閉じ括弧は end の後ろへ)
{
  // ( を打つと ) が自動で入る (closeBrackets) 状態を再現
  let st = make('btn.Activated:Connect(function|)')
  st = st.update({ changes: { from: st.selection.main.head, insert: '()' }, selection: EditorSelection.cursor(st.selection.main.head + 1), userEvent: 'input.type' }).state
  eq('Connect(function()) closers moved', show(st), 'btn.Activated:Connect(function(|)\nend)')
}
// 既存の行を包む
eq('wrap indented body', show(type(make('|\n\tprint(1)\n\tprint(2)\nprint(3)'), 'if x then')), 'if x then|\n\tprint(1)\n\tprint(2)\nend\nprint(3)')

// ---- 自分で end を書いたら自動の end を吸収 ----
{
  let st = type(make('|'), 'if x then\nprint(1)\nend\n')
  eq('typed end consumes auto end', st.doc.toString(), 'if x then\n\tprint(1)\nend\n')
  st = type(make('|'), 'if x then\nprint(1)\nendTime = 1')
  eq('endTime does not consume', st.doc.toString(), 'if x then\n\tprint(1)\n\tendTime = 1\nend')
}

// ---- 開始語を消したら end も消す ----
{
  let st = make('if x then\n\tprint(1)\nend|')
  st = make('i|f x then\n\tprint(1)\nend')
  st = st.update({ selection: EditorSelection.cursor(2) }).state
  st = backspace(st)
  eq('backspace if removes end', st.doc.toString(), 'i x then\n\tprint(1)')
}
{
  const src = 'local function f()\n\tif x then\n\t\tprint(1)\n\tend\n\tprint(2)\nend'
  let st = make(src)
  const from = src.indexOf('\tif'), to = src.indexOf('\t\tprint(1)')
  st = delRange(st, from, to)
  eq('delete if line inside function', st.doc.toString(), 'local function f()\n\t\tprint(1)\n\tprint(2)\nend')
}
{
  const src = 'btn.MouseButton1Click:Connect(function()\n\tprint(1)\nend)\nprint(2)'
  let st = make(src)
  st = delRange(st, 0, src.indexOf('\n'))
  eq('delete Connect line removes end)', st.doc.toString(), '\n\tprint(1)\nprint(2)')
}
{
  const src = 'for i = 1, 3 do\n\tprint(i)\nend'
  let st = make(src)
  st = delRange(st, 0, 3, 'input.type')
  eq('replace for (typing) removes end', st.doc.toString(), ' i = 1, 3 do\n\tprint(i)')
  st = undo({ state: st, dispatch: tr => { st = tr.state } }) ? st : st
}
{
  // cut (移動のため) では消さない
  const src = 'if x then\n\tprint(1)\nend'
  const st = delRange(make(src), 0, 2, 'delete.cut')
  eq('cut keeps end', st.doc.toString(), ' x then\n\tprint(1)\nend')
}
{
  // then だけを消しても end は残す (書き直し中)
  const src = 'if x then\n\tprint(1)\nend'
  const st = delRange(make(src), 5, 9, 'delete.backward')
  eq('deleting then keeps end', st.doc.toString(), 'if x \n\tprint(1)\nend')
}
{
  // 元に戻すで両方戻る
  const src = 'while true do\n\ttask.wait()\nend'
  let st = make(src)
  st = delRange(st, 0, 5, 'delete.selection')
  eq('delete while', st.doc.toString(), ' true do\n\ttask.wait()')
  undo({ state: st, dispatch: tr => { st = tr.state } })
  eq('undo restores both', st.doc.toString(), src)
}
{
  // 入れ子: 外側の end は残す
  const src = 'for i = 1, 3 do\n\tif i == 2 then\n\t\tprint(i)\n\tend\nend'
  let st = make(src)
  const a = src.indexOf('\tif'), b = src.indexOf('\n', a) + 1
  st = delRange(st, a, b)
  eq('nested delete keeps outer end', st.doc.toString(), 'for i = 1, 3 do\n\t\tprint(i)\nend')
}

{
  // else の後の改行で、閉じていない if に end
  let st = make('if a then\n\tx()\nelse|')
  autoEndCommand(viewOf(st, s => { st = s }))
  eq('Enter after else adds end', show(st), 'if a then\n\tx()\nelse\n\t|\nend')
}
{
  // function を消すと end) もまとめて消える (Connect の行ごと)
  const src = 'local function go()\n\tprint(1)\nend\ngo()'
  let st = delRange(make(src), 6, 15)
  eq('delete function keyword', st.doc.toString(), 'local go()\n\tprint(1)\ngo()')
}
{
  // repeat を消すと until の行も消える
  const src = 'repeat\n\tn += 1\nuntil n > 3\nprint(n)'
  let st = delRange(make(src), 0, 6)
  eq('delete repeat removes until', st.doc.toString(), '\n\tn += 1\nprint(n)')
}
{
  // 設定オフでは何もしない
  cfg.insert = false; cfg.remove = false
  eq('insert off', show(type(make('|'), 'if x then')), 'if x then|')
  const st = delRange(make('if x then\nend'), 0, 2)
  eq('remove off', st.doc.toString(), ' x then\nend')
  cfg.insert = true; cfg.remove = true
}
{
  // Enter で入れた end も、手で end を書けば吸収される
  let st = make('for i = 1, 3 do|')
  cfg.insert = false
  st = type(st, '\n')
  cfg.insert = true
  st = type(st, 'print(i)\nend\n')
  eq('Enter auto end consumed', st.doc.toString().split('end').length - 1, 1)
}

// ---- 純粋関数 ----
eq('completedHeader none mid-line', completedHeader('if x then print(1)', 9), null)
eq('orphaned none', orphanedClosers('a b', 'a', { iterChanges: f => f(1, 3, 1, 1), mapPos: p => p }).length, 0)

console.log(`autoend: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
