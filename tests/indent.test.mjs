// インデントと end 自動入力のテスト:  node tests/indent.test.mjs
import { EditorState, EditorSelection, indentUnit, getIndentation, insertNewlineAndIndent, indentOnInput } from '../vendor/codemirror.js'
import { luauLanguage } from '../js/editor/luau-lang.js'
import { autoEndCommand } from '../js/editor/inline.js'
import { scanBlocks, diagnoseBlocks } from '../js/editor/blocks.js'
import { formatLuau } from '../js/editor/format.js'

let pass = 0, fail = 0
const eq = (name, got, want) => {
  if (got === want) pass++
  else { fail++; console.log(`✕ ${name}\n--- got ---\n${got}\n--- want ---\n${want}\n`) }
}

function mk(doc, unit = '    ') {
  const pos = doc.indexOf('|')
  const text = doc.replace('|', '')
  return EditorState.create({
    doc: text, selection: EditorSelection.cursor(pos < 0 ? text.length : pos),
    extensions: [luauLanguage, indentUnit.of(unit), EditorState.tabSize.of(4), indentOnInput()],
  })
}
// Enter を押した結果 (カーソルは | で表示)
function enter(doc, unit) {
  let state = mk(doc, unit)
  const view = { get state() { return state }, dispatch(...specs) { state = state.update(...specs).state } }
  if (!autoEndCommand(view)) insertNewlineAndIndent({ state, dispatch: tr => { state = tr.state } })
  const h = state.selection.main.head
  return state.doc.sliceString(0, h) + '|' + state.doc.sliceString(h)
}
// 1 文字ずつ入力した結果 (indentOnInput の確認)
function type(doc, chars) {
  let state = mk(doc)
  for (const ch of chars) {
    const h = state.selection.main.head
    state = state.update({ changes: { from: h, insert: ch }, selection: EditorSelection.cursor(h + 1), userEvent: 'input.type' }).state
  }
  return state.doc.toString()
}

// ---- 基本 ----
eq('if then', enter('if x then|'), 'if x then\n    |\nend')
eq('for do', enter('for i = 1, 10 do|'), 'for i = 1, 10 do\n    |\nend')
eq('while do', enter('while true do|'), 'while true do\n    |\nend')
eq('function', enter('local function foo(a, b)|'), 'local function foo(a, b)\n    |\nend')
eq('typed function', enter('local function foo(a: number, cb: (number) -> ()): string|'), 'local function foo(a: number, cb: (number) -> ()): string\n    |\nend')
eq('repeat', enter('repeat|'), 'repeat\n    |\nuntil ')
eq('connect', enter('ev:Connect(function(player)|)'), 'ev:Connect(function(player)\n    |\nend)')
eq('tabs', enter('\tif x then|', '\t'), '\tif x then\n\t\t|\n\tend')

// ---- ループの中での改行 (以前は字下げが消えていた) ----
eq('line inside for', enter('for i = 1, 10 do\n    print(i)|\nend'), 'for i = 1, 10 do\n    print(i)\n    |\nend')
eq('line inside while in function', enter('local function f()\n    while true do\n        task.wait()|\n    end\nend'), 'local function f()\n    while true do\n        task.wait()\n        |\n    end\nend')
eq('after loop end', enter('local function f()\n    for i = 1, 3 do\n    end|\nend'), 'local function f()\n    for i = 1, 3 do\n    end\n    |\nend')
// ---- Connect(function() の中 (以前は 2 段下がっていた) ----
eq('line inside connect', enter('ev:Connect(function(p)\n    print(p)|\nend)'), 'ev:Connect(function(p)\n    print(p)\n    |\nend)')
eq('task.spawn nested', enter('task.spawn(function()\n    while true do\n        x()|\n    end\nend)'), 'task.spawn(function()\n    while true do\n        x()\n        |\n    end\nend)')
// ---- テーブル ----
eq('table', enter('local t = {|}'), 'local t = {\n    |\n}')
eq('table line', enter('local t = {\n    a = 1,|\n}'), 'local t = {\n    a = 1,\n    |\n}')
eq('call table', enter('foo({\n    a = 1,|\n})'), 'foo({\n    a = 1,\n    |\n})')
eq('nested table', enter('local t = {\n    b = {|}\n}'), 'local t = {\n    b = {\n        |\n    }\n}')
// ---- else / elseif ----
eq('else', enter('if a then\n    x()\nelse|\nend'), 'if a then\n    x()\nelse\n    |\nend')
eq('elseif', enter('if a then\n    x()\nelseif b then|\nend'), 'if a then\n    x()\nelseif b then\n    |\nend')
// ---- 既に閉じているブロックでは end を増やさない ----
eq('closed if', enter('if x then|\n    foo()\nend'), 'if x then\n    |\n    foo()\nend')
eq('closed nested', enter('function f()\n    if x then|\n        foo()\n    end\nend'), 'function f()\n    if x then\n        |\n        foo()\n    end\nend')
// ---- 外側が未完成でも正しく判定 ----
eq('new if before outer end', enter('function f()\n    foo()\n    if x then|\nend'), 'function f()\n    foo()\n    if x then\n        |\n    end\nend')
eq('closed if, outer unclosed', enter('function f()\n    if x then|\n    end\n'), 'function f()\n    if x then\n        |\n    end\n')
eq('flat style', enter('function f()\nif x then|\nend'), 'function f()\nif x then\n    |\nend\nend')
// ---- if 式は end 不要 ----
eq('if expr then', enter('local x = if a then|'), 'local x = if a then\n    |')
eq('if expr does not confuse balance', enter('local y = if a then 1 else 2\nif y then|'), 'local y = if a then 1 else 2\nif y then\n    |\nend')
// ---- 後ろにコードがある ----
eq('trailing code', enter('if x then| print(1)'), 'if x then\n    |print(1)\nend')
eq('explode closed on line', enter('foo(function()| end)'), 'foo(function()\n    |\nend)')
// ---- 文字列・コメント内のキーワードは無視 ----
eq('keyword in string', enter('print("if then")|'), 'print("if then")\n|')
eq('comment after then', enter('if x then -- do it|'), 'if x then -- do it\n    |\nend')
eq('long string keeps indent', enter('local s = [[\n  if then|\n]]'), 'local s = [[\n  if then\n  |\n]]')
// ---- 入力中の字下げ戻し ----
eq('type end', type('if x then\n    foo()\n    |', 'end'), 'if x then\n    foo()\nend')
eq('type endTime keeps indent', type('if x then\n    foo()\n    |', 'endTime'), 'if x then\n    foo()\n    endTime')
eq('type else', type('if x then\n    foo()\n    |', 'else'), 'if x then\n    foo()\nelse')
eq('type elseif', type('if x then\n    foo()\n    |', 'elseif'), 'if x then\n    foo()\nelseif')
eq('type nested end', type('function f()\n    if x then\n        foo()\n        |', 'end'), 'function f()\n    if x then\n        foo()\n    end')
eq('type end)', type('ev:Connect(function()\n    foo()\n    |', 'end)'), 'ev:Connect(function()\n    foo()\nend)')
eq('type }', type('local t = {\n    a = 1,\n    |', '}'), 'local t = {\n    a = 1,\n}')
// ---- 行ごとの字下げ計算 ----
{
  const src = 'local M = {}\nfunction M.new(x: number): any\nlocal self = setmetatable({}, M)\nfor k: string, v: number in pairs({}) do\nprint(k, v)\nend\nif x > 1 then\nreturn 1\nelseif x < 0 then\nreturn -1\nelse\nreturn 0\nend\nend\nreturn M'
  const want = [0, 0, 4, 4, 8, 4, 4, 8, 4, 8, 4, 8, 4, 0, 0]
  // 上から順に字下げを適用しながら確認
  let state = mk(src)
  const got = []
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    const ind = getIndentation(state, line.from)
    got.push(ind)
    const cur = /^\s*/.exec(line.text)[0]
    state = state.update({ changes: { from: line.from, to: line.from + cur.length, insert: ' '.repeat(ind) } }).state
  }
  eq('reindent sequence', got.join(','), want.join(','))
}
// ---- ブロック診断 ----
{
  const d = diagnoseBlocks('function f()\n    if x then\n        foo()\n    bar()\nend\n')
  eq('missing end culprit', d.length + ':' + (d[0] && d[0].message), "1:2 行目の 'if' に対応する 'end' がありません")
  const fixed = 'function f()\n    if x then\n        foo()\n    bar()\nend\n'
  eq('missing end fix', fixed.slice(0, d[0].insertAt) + d[0].insertText + fixed.slice(d[0].insertAt), 'function f()\n    if x then\n        foo()\n    end\n    bar()\nend\n')
  const e = diagnoseBlocks('if x then\nend\nend\n')
  eq('extra end', e.length + ':' + e[0].kind, '1:extra')
  eq('balanced', diagnoseBlocks('local x = if a then 1 else 2\nfor i = 1, 2 do end\nrepeat until true\n').length, 0)
  eq('scan kinds', scanBlocks('while x do for i=1,2 do end end do end').blocks.map(b => b.kind).join(','), 'while,for,do')
}

// ---- 整形 ----
{
  const messy = 'local M = {}\n   function M.go(p)\nlocal v = if p then 1 else 2\n  for i = 1, v do\n print(i)\n      end\nev:Connect(function(x)\nif x then\nreturn {\na = 1,\nb = { 2 },\n}\nelse\nreturn nil\nend\nend)\nlocal s = [[\n  keep\n    this]]\nrepeat\nv -= 1\nuntil v < 0\nend\nreturn M'
  const want = 'local M = {}\nfunction M.go(p)\n    local v = if p then 1 else 2\n    for i = 1, v do\n        print(i)\n    end\n    ev:Connect(function(x)\n        if x then\n            return {\n                a = 1,\n                b = { 2 },\n            }\n        else\n            return nil\n        end\n    end)\n    local s = [[\n  keep\n    this]]\n    repeat\n        v -= 1\n    until v < 0\nend\nreturn M'
  eq('format', formatLuau(messy, '    '), want)
  eq('format idempotent', formatLuau(want, '    '), want)
  eq('format broken code does not throw', formatLuau('if x then\nlocal s = "a\nend', '\t'), 'if x then\n\tlocal s = "a\nend')
  eq('format else after if-expr', formatLuau('if c then\nx = if a then 1 else 2\nelse if d then\ny()\nend\nend', ' '), 'if c then\n x = if a then 1 else 2\nelse if d then\n y()\nend\nend')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
