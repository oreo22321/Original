// Luau インタプリタの動作確認テスト:  node tests/luau-basic.test.mjs
import { createVM, formatError } from '../js/luau/vm.js'

function runLuau(src, { timeLimit = 5000 } = {}) {
  return new Promise(resolve => {
    const out = []
    const hooks = {
      output: (k, t) => out.push(k === 'print' ? t : `[${k}] ${t}`),
      onError: e => out.push('[error] ' + formatError(e)),
      onIdle: () => resolve(out),
    }
    const vm = createVM(hooks, { timeLimit })
    try { vm.run(src, 'test') } catch (e) { out.push('[syntax] ' + formatError(e) + ' @' + e.line); resolve(out) }
  })
}

const cases = [
  ['arith', `print(1 + 2, 10 / 2, 7 // 2, 7 % 3, 2 ^ 10, -5 % 3, 0.1 + 0.2)`, '3 5 3 1 1024 1 0.30000000000000004'],
  ['strings', `local s = "Hello" .. " " .. 42 print(s, #s, s:upper(), ("x"):rep(3, "-"))`, 'Hello 42 8 HELLO 42 x-x-x'],
  ['luau syntax', `local x: number = 10
x += 5
local t: {number} = {1, 2, 3}
local function add(a: number, b: number): number return a + b end
print(\`x={x} sum={add(1, 2)}\`, if x > 3 then "big" else "small")`, 'x=15 sum=3 big'],
  ['continue', `local r = {}
for i = 1, 6 do if i % 2 == 0 then continue end table.insert(r, i) end
local j = 0
repeat j += 1 if j == 2 then continue end local z = j until z ~= nil and z >= 4
print(table.concat(r, ","), j)`, '1,3,5 4'],
  ['closures', `local fs = {}
for i = 1, 3 do fs[i] = function() return i end end
print(fs[1](), fs[2](), fs[3]())`, '1 2 3'],
  ['varargs', `local function f(...) return select('#', ...), ... end
print(f(1, nil, 3))
local function g(...) local a, b = ... return a, b end
print(g("a", "b", "c"))`, '3 1 nil 3\na b'],
  ['metatables', `local V = {}
V.__index = V
V.__add = function(a, b) return V.new(a.x + b.x) end
V.__tostring = function(v) return "V(" .. v.x .. ")" end
function V.new(x) return setmetatable({x = x}, V) end
function V:double() return V.new(self.x * 2) end
print(tostring(V.new(1) + V.new(2)), V.new(5):double().x)`, 'V(3) 10'],
  ['pcall error', `local ok, e = pcall(function() error("boom") end)
print(ok, e)
local ok2, e2 = pcall(function() local t = nil; return t.x end)
print(ok2, e2)
print(pcall(error, {code = 1}))`, 'false test:1: boom\nfalse test:3: attempt to index nil with \'x\''],
  ['patterns', `print(string.find("hello world", "o w"), string.match("key=value", "(%w+)=(%w+)"))
print(("abc"):gsub("%w", "%0%0"), string.format("%5.2f|%d|%s|%x|%q", 3.14159, 42, "hi", 255, 'a"b'))
for w in string.gmatch("one two three", "%a+") do io = (io or "") .. w .. ";" end print(io)`, '5 key value\naabbcc  3.14|42|hi|ff|"a\\"b"\none;two;three;'],
  ['coroutines', `local co = coroutine.create(function(a, b)
  print("start", a, b)
  local c = coroutine.yield(a + b)
  print("got", c)
  return "done"
end)
print(coroutine.resume(co, 1, 2))
print(coroutine.resume(co, "x"))
print(coroutine.status(co), coroutine.resume(co))
local gen = coroutine.wrap(function() for i = 1, 3 do coroutine.yield(i) end end)
print(gen(), gen(), gen())`, 'start 1 2\ntrue 3\ngot x\ntrue done\ndead false cannot resume dead coroutine\n1 2 3'],
  ['task.wait', `local t0 = os.clock()
task.spawn(function() task.wait(0.05) print("spawned") end)
print("before")
local dt = task.wait(0.1)
print("after", dt >= 0.09)`, 'before\nspawned\nafter true'],
  ['table lib', `local t = {5, 2, 8, 1}
table.sort(t)
print(table.concat(t, " "))
table.sort(t, function(a, b) return a > b end)
print(table.concat(t, " "), table.find(t, 2), #t, table.unpack({1, 2, 3}))
local c = table.clone(t) table.clear(t) print(#t, #c)
local f = table.freeze({1}) print(pcall(function() f[1] = 2 end))`, '1 2 5 8\n8 5 2 1 3 4 1 2 3\n0 4\nfalse test:7: attempt to modify a readonly table'],
  ['generalized iteration', `local t = {a = 1}
local n = 0
for k, v in t do n += v end
for i, v in ipairs({10, 20}) do n += v end
for k, v in pairs({x = 5}) do n += v end
print(n)`, '36'],
  ['math', `print(math.clamp(15, 0, 10), math.round(2.5), math.sign(-3), math.floor(-0.5), math.max(1, 9, 3), math.huge, -math.huge)`, '10 3 -1 -1 9 inf -inf'],
  ['numbers', `print(1e15, 2^53, 1/3, 100, 0.5, tonumber("0x10"), tonumber("  12  "), tonumber("z", 36), tonumber("abc"))`, '1e+15 9.007199254740992e+15 0.3333333333333333 100 0.5 16 12 35 nil'],
  ['syntax error', `local x = = 1`, '[syntax]'],
  ['runtime line', `local a = 1
local b = nil
print(a + b)`, "[error] test:3: attempt to perform arithmetic (add) on number and nil"],
  ['loadstring', `local f = loadstring("return 1 + ...") print(f(41)) print(loadstring("x ="))`, '42\nnil'],
  ['bit32 & buffer', `print(bit32.band(0xFF, 0x0F), bit32.lshift(1, 4), bit32.bxor(5, 3))
local b = buffer.create(8) buffer.writeu32(b, 0, 123456) print(buffer.readu32(b, 0), buffer.len(b))`, '15 16 6\n123456 8'],
  ['utf8', `local s = "あいう" print(#s, utf8.len(s), utf8.char(72, 105))
for p, c in utf8.codes("aé") do io2 = (io2 or "") .. c .. "," end print(io2)`, '9 3 Hi\n97,233,'],
  ['string escapes', `print("tab\\tend", "\\65\\66", "\\x41", "\\u{3042}", [[long
string]])`, 'tab\tend AB A あ long\nstring'],
  ['infinite loop timeout', `while true do end`, '[error]'],
  ['os.date', `print(type(os.time()), os.date("%Y") == tostring(os.date("*t").year))`, 'number true'],
  ['typeof', `print(typeof(1), typeof("s"), typeof({}), typeof(print), typeof(nil), type(coroutine.create(print)))`, 'number string table function nil thread'],
  ['recursion', `local function fib(n) if n < 2 then return n end return fib(n-1) + fib(n-2) end print(fib(20))`, '6765'],
  ['and/or', `print(nil or "default", false and 1, 1 and 2, nil and nil or 3, not nil, not 0)`, 'default false 2 3 true false'],
  ['multiple assign', `local a, b = 1, 2 a, b = b, a print(a, b) local t = {} t.x, t.y = 1 print(t.x, t.y)`, '2 1\n1 nil'],
  ['string methods', `local s = "a,b,,c" local p = s:split(",") print(#p, p[3] == "", ("  trim  "):match("^%s*(.-)%s*$"))`, '4 true trim'],
  ['string.pack', `local s = string.pack(">i2 <I4 z d", -2, 7, "hi", 1.5) print(#s, string.unpack(">i2 <I4 z d", s)) print(string.packsize("i4 h"))`, '17 -2 7 hi 1.5 18\n6'],
  ['setfenv / getfenv', `local function f() return secret end
setfenv(f, { secret = 42 })
print(f(), secret, getfenv(f).secret, getfenv().print == print)
local g = loadstring("y = 5 return y")
local env = setmetatable({}, { __index = getfenv() })
setfenv(g, env) print(g(), env.y, y)`, '42 nil 42 true\n5 5 nil'],
  ['setfenv(1) affects running code', `local env = setmetatable({}, { __index = getfenv() })
setfenv(1, env)
x = 1
local function inner() return y end
y = 7
print(rawget(env, "x"), rawget(getfenv(0), "x"), inner(), pcall(string.pack, "i4", math.huge))`, '1 nil 7 false number has no integer representation'],
  ['unknown escape keeps utf-8', `print("\\あ" == "あ", #"\\あ")`, 'true 3'],
  ['unknown escape is the char', `print("a\\.b", "\\q")`, 'a.b q'],
]

let pass = 0, fail = 0
for (const [name, src, expect] of cases) {
  const out = (await runLuau(src, { timeLimit: 300 })).join('\n')
  const ok = out.startsWith(expect) || out === expect
  if (ok) pass++
  else { fail++; console.log(`✗ ${name}\n  expected: ${JSON.stringify(expect)}\n  got:      ${JSON.stringify(out)}`) }
}
console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
