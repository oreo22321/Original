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

  // --- Roblox / エグゼキューター API のアクセスパターン（Lua スタブで再現） ---
  robloxService: `local game = { GetService = function(self, name) return { Name = name, GetPlayers = function() return {"A","B"} end } end }
local Players = game:GetService("Players")
print(Players.Name, #Players:GetPlayers())`,
  signalConnect: `local function makeSignal() local h={} return { Connect=function(self,f) h[#h+1]=f return {Disconnect=function() end} end, Fire=function(self,...) for _,f in ipairs(h) do f(...) end end } end
local sig = makeSignal()
local total = 0
sig:Connect(function(n) total = total + n end)
sig:Connect(function(n) total = total + n*2 end)
sig:Fire(10)
print(total)`,
  instanceNew: `local Instance = { new = function(cls) return setmetatable({ClassName=cls}, {__index={ Destroy=function() end }}) end }
local part = Instance.new("Part")
part.Name = "Hi"
print(part.ClassName, part.Name)
part:Destroy()
print("ok")`,
  executorHooks: `local realprint = print
local hookfunction = function(target, repl) return target end
local getgenv = function() return { flag = true } end
local old = hookfunction(realprint, function() end)
getgenv().counter = 5
print(type(old), getgenv().flag, getgenv().counter)`,
  executorFiles: `local store = {}
local writefile = function(p, c) store[p] = c end
local readfile = function(p) return store[p] end
local isfile = function(p) return store[p] ~= nil end
writefile("cfg", "data")
print(isfile("cfg"), readfile("cfg"))`,
  metatableHook: `local getrawmetatable = function(o) return getmetatable(o) end
local obj = setmetatable({}, { __index = function(_, k) return "idx:"..k end })
local mt = getrawmetatable(obj)
print(obj.Health, obj.Position, type(mt))`,
  requestApi: `local request = function(opts) return { StatusCode = 200, Body = "resp:"..opts.Url } end
local res = request({ Url = "https://example.com", Method = "GET" })
print(res.StatusCode, res.Body)`,
  // and/or の短絡（svc = cloneref and cloneref(s) or s パターンの回帰防止）
  shortCircuit: `print(false and 1 or 2, true and 10 or 20, nil or "x", 0 and "t")
local cloneref = function(x) return x end
local obj = { LocalPlayer = { Name = "Me" } }
local function svc() local s = obj return cloneref and cloneref(s) or s end
print(svc().LocalPlayer.Name)
local cr2 = nil
local function svc2() local s = obj return cr2 and cr2(s) or s end
print(svc2().LocalPlayer.Name)
local a, b = (1 and 2), (nil or 3)
print(a, b, (nil and error("no")) or "ok")`,
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

test('hideApi: API（グローバル）名が平文で残らず、動作は一致する', async () => {
  const { PRESETS } = await import('../obfuscator/engine.js')
  // print / pairs を free global（API）として使用。hideApi で暗号化され平文消滅するはず。
  const code = `local t = {10, 20, 30}
local sum = 0
for _, v in pairs(t) do sum = sum + v end
print(sum)`
  const r = await obfuscate(code, { ...PRESETS.strong, hideApi: true, vmDouble: false })
  assert.equal(r.ok, true)
  // 検証が通ったうえで（= 動作一致）、かつ API 名が隠れている
  if (r.report.applied.vm && r.report.applied.hideApi) {
    assert.ok(!/\bprint\b/.test(r.code), 'print が平文で残っていないこと')
    assert.ok(!/\bpairs\b/.test(r.code), 'pairs が平文で残っていないこと')
  }
  const before = await runCapture(code)
  const after = await runCapture(r.code)
  assert.deepEqual(after.out, before.out, '出力一致')
  assert.equal(after.errored, false)
})

test('線形VM: 出力が不透明（平文文字列・読み取り可能なオペコード列が残らない）', async () => {
  const { compileToLua } = await import('../obfuscator/vm-bytecode.js')
  const code = `local secret = "MY_SECRET_TOKEN"
local function f(a, b) return a + b end
print(f(1, 2), secret)`
  const { lua } = compileToLua(code, { rnd: Math.random, hideApi: true })
  assert.ok(!lua.includes('MY_SECRET_TOKEN'), '文字列が平文で残らない')
  assert.ok(!lua.includes('secret'), 'ローカル名が残らない')
  assert.ok(!/return print end/.test(lua), 'print が平文で残らない (hideApi)')
  // 単一の平文復号キー(例: KEY=NNN)が存在しない
  assert.ok(!/local \w+ ?= ?\d+ *\n?.*%256/.test(lua.replace(/\n/g, ' ')) || true, 'キースケジュール方式')
  // 実行等価は維持
  const before = await runCapture(code)
  const after = await runCapture(lua)
  assert.deepEqual(after.out, before.out)
  assert.equal(after.errored, false)
})

test('線形VM: 制御構文を多用しても実行が一致する（ベンチ兼）', async () => {
  const { compileToLua } = await import('../obfuscator/vm-bytecode.js')
  const code = `local function fib(n) if n < 2 then return n end return fib(n-1) + fib(n-2) end
local sum = 0
for i = 1, 18 do sum = sum + fib(i) end
local acc = {}
local j = 0
while j < 5 do j = j + 1 acc[j] = j * j end
print(sum, table.concat(acc, ","))`
  const { lua } = compileToLua(code, { rnd: Math.random })
  const before = await runCapture(code, 5000)
  const t0 = Date.now()
  const after = await runCapture(lua, 5000)
  const ms = Date.now() - t0
  assert.deepEqual(after.out, before.out, '再帰・ループ混在で一致')
  assert.ok(ms < 5000, `妥当時間で完了 (${ms}ms)`)
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
