// エグゼキューター API の網羅テスト:  node tests/executor.test.mjs
// 補完データ (js/data/executor-api.js) に載っている関数が、サンドボックスにもすべて存在することを確認します。
import { readFileSync } from 'node:fs'
import { createVM, formatError } from '../js/luau/vm.js'
import { installRoblox } from '../js/luau/roblox.js'
import { installExecutor } from '../js/luau/executor.js'
import { EXECUTOR_GLOBALS, EXECUTOR_LIBS, EXECUTOR_GAME_METHODS } from '../js/data/executor-api.js'

const api = JSON.parse(readFileSync(new URL('../data/roblox-api.json', import.meta.url), 'utf8'))

function run(src) {
  return new Promise(resolve => {
    const out = []
    const posts = []
    const hooks = {
      output: (k, t) => out.push(k === 'print' ? t : `[${k}] ${t}`),
      onError: e => out.push('[error] ' + formatError(e)),
      onIdle: () => resolve({ out, posts }),
      post: m => posts.push(m),
    }
    const vm = createVM(hooks, { timeLimit: 2000 })
    const ctx = { sched: vm.sched, hooks, api, fs: new Map(), fsFolders: new Set(), currentFile: 'main.lua' }
    const rbx = installRoblox(vm.env, ctx)
    rbx.mountFiles({ 'main.lua': src }, 'P')
    rbx.setScript('main.lua')
    installExecutor(vm.env, ctx, rbx)
    try { vm.run(src, 'main.lua') } catch (e) { out.push('[syntax] ' + formatError(e)); resolve({ out, posts }) }
    setTimeout(() => resolve({ out, posts, timeout: true }), 4000)
  })
}

let pass = 0, fail = 0
const check = (name, got, want) => {
  if (got === want) pass++
  else { fail++; console.log(`✕ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`) }
}

// ---- 1. 補完データとサンドボックスの対応 ----
{
  const names = Object.keys(EXECUTOR_GLOBALS)
  const libs = Object.entries(EXECUTOR_LIBS).flatMap(([lib, m]) => Object.keys(m).map(k => `${lib}.${k}`))
  const src = `
local missing = {}
for _, n in ipairs({ ${names.map(n => JSON.stringify(n)).join(', ')} }) do
  if getgenv()[n] == nil then table.insert(missing, n) end
end
for _, n in ipairs({ ${libs.map(n => JSON.stringify(n)).join(', ')} }) do
  local lib, key = n:match("^(%w+)%.(.+)$")
  local t = getgenv()[lib]
  if type(t) ~= "table" or t[key] == nil then table.insert(missing, n) end
end
for _, n in ipairs({ ${Object.keys(EXECUTOR_GAME_METHODS).map(n => JSON.stringify(n)).join(', ')} }) do
  local ok = pcall(function() return game[n] end)
  if not ok then table.insert(missing, "game:" .. n) end
end
print(#missing == 0 and "ALL" or table.concat(missing, ", "))`
  const r = await run(src)
  check(`${names.length} globals + ${libs.length} lib members exist in sandbox`, r.out.join('|'), 'ALL')
}

// ---- 2. 動作 ----
const cases = [
  ['hook / restore', `
local function target() return "orig" end
local old = hookfunction(target, function() return "hooked" end)
print(target(), old(), isfunctionhooked(target))
restorefunction(target)
print(target(), isfunctionhooked(target))`, 'hooked orig true|orig false'],
  ['closures', `
local f = function() end
local c = newcclosure(f)
print(islclosure(f), iscclosure(c), islclosure(newlclosure(c)), isexecutorclosure(c), iscclosure(print))`, 'true true true true true'],
  ['namecall hook', `
local re = Instance.new("RemoteEvent")
local old
old = hookmetamethod(game, "__namecall", newcclosure(function(self, ...)
  if getnamecallmethod() == "FireServer" and self == re then
    print("blocked", ...)
    return
  end
  return old(self, ...)
end))
re:FireServer("a", 1)
print(game:GetService("Players").Name)`, 'blocked a 1|Players'],
  ['hooksignal', `
local ev = Instance.new("BindableEvent")
ev.Event:Connect(function(v) print("got", v) end)
hooksignal(ev.Event, function(info, v) print("hook", v) return v == 2 end)
ev:Fire(1) ev:Fire(2)
print(issignalhooked(ev.Event))
restoresignal(ev.Event)
ev:Fire(3)`, 'hook 1|hook 2|got 2|true|got 3'],
  ['connections', `
local ev = Instance.new("BindableEvent")
ev.Event:Connect(function(v) print("a", v) end)
local c = getconnections(ev.Event)[1]
print(#getconnections(ev.Event), type(c.Function), c.Enabled)
c:Fire("x")
c:Disable()
ev:Fire("y")
firesignal(ev.Event, "z")`, '1 function true|a x'],
  ['files', `
makefolder("cfg")
writefile("cfg/a.txt", "hello")
appendfile("cfg/a.txt", " world")
print(readfile("cfg/a.txt"), isfile("cfg/a.txt"), isfolder("cfg"), #listfiles("cfg"))
delfile("cfg/a.txt")
print(isfile("cfg/a.txt"), pcall(readfile, "nope.txt"))`, 'hello world true true 1|false false readfile: ファイル "nope.txt" がありません (workspace/nope.txt)'],
  ['bit / base64 / crypt', `
print(bit.band(12, 10), bit.bor(12, 10), bit.bxor(12, 10), bit.lshift(1, 4), bit.tohex(255, 4))
print(base64encode("hi"), base64decode("aGk="), crypt.base64encode("hi") == base64.encode("hi"))`, '8 14 6 16 00ff|aGk= hi true'],
  ['genv / misc', `
getgenv().Shared = 5
print(Shared, getrenv().Shared, isluau(), type(gethwid()), getthreadidentity())
local name, ver = identifyexecutor()
print(type(name), type(ver), checkcaller(), type(gethui()), compareinstances(game, cloneref(game)))
print(#getgc() >= 0, type(getsenv(script)), getfpscap())`, '5 nil true string 8|string string true userdata true|[info] [サンドボックス] getgc (スクリプトのグローバルから到達できる関数だけを返します) は模擬動作です (実際のエグゼキューターとは結果が異なります)|true table 60'],
  ['drawing', `
local c = Drawing.new("Circle")
c.Radius = 30 c.Visible = true c.Position = Vector2.new(10, 20)
print(c.Radius, isrenderobj(c), getrenderproperty(c, "Visible"), pcall(function() c.Nope = 1 end))
c:Remove()
print(pcall(Drawing.new, "Blob"))`, '30 true true false main.lua:4: Nope is not a valid member of Drawing.Circle|false Drawing.new: 不明な種類 "Blob" (Line, Text, Image, Circle, Square, Quad, Triangle)'],
  ['loadstring', `
local f, err = loadstring("return 1 + 1")
print(f(), err)
print(loadstring("return +"))`, null],
]
for (const [name, src, want] of cases) {
  const r = await run(src)
  const got = r.out.join('|')
  if (want === null) { if (/^2 nil\|nil /.test(got)) pass++; else { fail++; console.log('✕', name, got) } } else check(name, got, want)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
