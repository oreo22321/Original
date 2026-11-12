// スコープ解析 (定義へ移動・参照・名前の変更) のテスト:  node tests/symbols.test.mjs
import { analyzeSymbols, refAt } from '../js/editor/symbols.js'

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) pass++
  else { fail++; console.log(`✕ ${name}\n   got:  ${g}\n   want: ${w}`) }
}
// src の中の「n 番目の name」の位置にある参照の、同じシンボルの参照位置を (行:列) で返す
function refsOf(src, name, nth = 0) {
  const an = analyzeSymbols(src)
  // 単語としての n 番目の出現
  const re = new RegExp(`(?<![\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'g')
  let m, idx = -1
  for (let i = 0; i <= nth; i++) { m = re.exec(src); if (!m) return null; idx = m.index }
  const r = refAt(an, idx)
  if (!r) return null
  return r.sym.refs.map(x => { const before = src.slice(0, x.s); const line = before.split('\n').length; return `${line}:${x.s - before.lastIndexOf('\n') - 1}${x.decl ? 'd' : ''}` })
}

const src1 = `local count = 0
local function add(n)
  count += n
  local count = "shadow"
  print(count)
end
add(count)`
eq('outer count refs', refsOf(src1, 'count', 0), ['1:6d', '3:2', '7:4'])
eq('shadow count refs', refsOf(src1, 'count', 2), ['4:8d', '5:8'])
eq('param', refsOf(src1, 'n', 0), ['2:19d', '3:11'])

const src2 = `for i = 1, 3 do print(i) end
for i, v in pairs({}) do print(i, v) end
x = 1
function go() return x end`
eq('for vars are separate', refsOf(src2, 'i', 0), ['1:4d', '1:22'])
eq('second for', refsOf(src2, 'i', 2), ['2:4d', '2:31'])
eq('global x', refsOf(src2, 'x', 0), ['3:0', '4:21'])

const src3 = `local Util = {}
function Util.greet(name)
  return "hi " .. name
end
function Util:shout(msg)
  return self.greet(msg)
end
return Util`
eq('module table refs', refsOf(src3, 'Util', 0), ['1:6d', '2:9', '5:9', '8:7'])
eq('param name', refsOf(src3, 'name', 0), ['2:20d', '3:18'])

const src4 = `local a = 1
repeat
  local b = a
until b > 0
local t = { a = a }
print(t.a)`
eq('repeat scope sees body local', refsOf(src4, 'b', 0), ['3:8d', '4:6'])
eq('table key not a ref', refsOf(src4, 'a', 0), ['1:6d', '3:12', '5:16'])

// 構文エラーは例外
let threw = false
try { analyzeSymbols('local = 1') } catch { threw = true }
eq('syntax error throws', threw, true)

console.log(`symbols: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
