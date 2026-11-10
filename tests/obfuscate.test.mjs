// 難読化エンジンの動作確認:  node --test tests/obfuscate.test.mjs
// 難読化の前後で、同梱 Luau VM の出力列が完全に一致する（＝エラーなく同じ動作）ことを確認する。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { obfuscate, buildOnce, runCapture } from '../obfuscator/engine.js'
import { checkSyntax } from '../js/luau/parser.js'

// 純粋に完走する（Roblox 非依存の）サンプル集
const SAMPLES = {
  arith: `print(1 + 2, 10 / 2, 7 // 2, 7 % 3, 2 ^ 10, -5 % 3)`,
  strings: `local s = "Hello" .. " " .. 42
print(s, #s, s:upper(), ("x"):rep(3, "-"))
print"sugar-call"`,
  luau: `local x: number = 10
x += 5
local t: {number} = {1, 2, 3}
local function add(a: number, b: number): number return a + b end
print(\`x={x} sum={add(1, 2)}\`, if x > 3 then "big" else "small")`,
  continueLoop: `local r = {}
for i = 1, 6 do if i % 2 == 0 then continue end table.insert(r, i) end
print(table.concat(r, ","))`,
  closures: `local fs = {}
for i = 1, 3 do fs[i] = function() return i end end
print(fs[1](), fs[2](), fs[3]())`,
  shadow: `local x = 1
do local x = x + 10 print(x) end
print(x)
local function f(x) local y = x * 2 return y end
print(f(x))`,
  varargs: `local function f(...) return select('#', ...), ... end
print(f(1, nil, 3))`,
  methods: `local V = {}
V.__index = V
function V.new(n) return setmetatable({ n = n }, V) end
function V:get() return self.n end
local a = V.new(5)
print(a:get(), a.n)`,
  tables: `local cfg = { name = "app", nums = { 1, 2, 3 }, [ "k" .. 1 ] = true }
print(cfg.name, cfg.nums[2], cfg["k1"])`,
  globalsRead: `local sum = 0
for i = 1, 5 do sum = sum + i end
print(sum, math.floor(3.7), string.format("%d!", sum), type(sum))`,
  repeatLoop: `local i = 0
repeat local step = 1 i = i + step until i >= 3
print(i)`,
  nested: `local function outer(a)
  local function inner(b) return a + b end
  return inner(10)
end
print(outer(5))`,
}

const PRESETS_TO_TEST = ['light', 'normal', 'strong', 'max']

for (const [name, code] of Object.entries(SAMPLES)) {
  for (const preset of PRESETS_TO_TEST) {
    test(`${name} / ${preset}: 難読化後も同じ出力でエラーなく動く`, async () => {
      const { PRESETS } = await import('../obfuscator/engine.js')
      const result = await obfuscate(code, PRESETS[preset])
      assert.equal(result.ok, true, '難読化に成功すること')
      assert.equal(checkSyntax(result.code), null, '出力が構文的に正しいこと')

      const before = await runCapture(code)
      const after = await runCapture(result.code)
      assert.equal(before.errored, false, '元コードがエラーなく動くこと')
      assert.equal(after.errored, false, '難読化後もエラーなく動くこと')
      assert.deepEqual(after.out, before.out, '出力列が完全一致すること')

      // 検証可能なサンプルは「実行検証済み」になっているはず
      assert.equal(result.report.verified, true, '実行検証で一致が確認されること')
    })
  }
}

test('strong: ローカル変数名が実際に変わり、文字列が平文で残らない', async () => {
  const { PRESETS } = await import('../obfuscator/engine.js')
  const code = `local secretValue = "TopSecretString"
local function greetUser(userName) return "Hello " .. userName end
print(greetUser(secretValue))`
  const { code: out } = await obfuscate(code, PRESETS.strong)
  assert.ok(!out.includes('secretValue'), 'ローカル変数名が消えていること')
  assert.ok(!out.includes('greetUser'), '関数名が消えていること')
  assert.ok(!out.includes('TopSecretString'), '文字列が平文で残っていないこと')
  assert.ok(!out.includes('Hello '), '文字列が平文で残っていないこと')
})

test('空入力・構文エラー入力は安全に失敗を返す', async () => {
  const empty = await obfuscate('   ')
  assert.equal(empty.ok, false)
  const bad = await obfuscate('local x = ')
  assert.equal(bad.ok, false)
  assert.ok(/構文エラー/.test(bad.error))
})

test('buildOnce は決定的でなくとも常に構文的に正しい出力を返す', async () => {
  for (const code of Object.values(SAMPLES)) {
    const out = buildOnce(code, { rename: true, hoist: true, numbers: true, strings: true, junk: true, wrap: true, minify: true })
    assert.equal(checkSyntax(out), null, `構文OK: ${code.slice(0, 20)}...`)
  }
})
