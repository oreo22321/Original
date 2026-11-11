// 型推論 (補完) のテスト:  node tests/intel.test.mjs
import { readFileSync } from 'node:fs'
import { setRobloxApi } from '../js/editor/apidb.js'
import { resolveChain, parseChain, chainBefore, typeLabel } from '../js/editor/luau-intel.js'
setRobloxApi(JSON.parse(readFileSync(new URL('../data/roblox-api.json', import.meta.url), 'utf8')))

const doc = `
local Players = game:GetService("Players")
local player = Players.LocalPlayer
local char = player.Character or player.CharacterAdded:Wait()
local hum: Humanoid = char:WaitForChild("Humanoid")
local root = char:WaitForChild("HumanoidRootPart")
local part = Instance.new("Part")
local pos = part.Position
local TweenService = game:GetService("TweenService")
local tw = TweenService:Create(part, TweenInfo.new(1), {})
Players.PlayerAdded:Connect(function(plr)
  plr.
end)
for _, p in ipairs(Players:GetPlayers()) do
end
local v = Vector3.new(1, 2, 3)
local s = "hello"
part.Touched:Connect(function(hit)
end)
`
const cases = [
  ['Players', 'Players'], ['player', 'Player'], ['char', 'Model'], ['hum', 'Humanoid'], ['root', 'Part'], ['part', 'Part'],
  ['pos', 'Vector3'], ['tw', 'Tween'], ['plr', 'Player'], ['p', 'Player'], ['v', 'Vector3'], ['s', 'string'], ['hit', 'BasePart'],
  ['game.Workspace', 'Workspace'], ['workspace.CurrentCamera', 'Camera'], ['Enum.KeyCode', 'Enum.KeyCode'], ['part.Touched', 'RBXScriptSignal'],
  ['game:GetService("UserInputService")', 'UserInputService'], ['Vector3', 'Vector3'], ['math', 'math'], ['player.Character.Humanoid', 'Humanoid'],
  ['hum.Health', 'number'], ['part:Clone()', 'Part'], ['CFrame.new(1,2,3)', 'CFrame'], ['crypt', 'crypt'],
]
let fail = 0
for (const [expr, want] of cases) {
  const ty = resolveChain(parseChain(expr), { text: doc, pos: doc.length, index: 0 })
  const got = typeLabel(ty)
  if (got !== want) { fail++; console.log(`✗ ${expr}: expected ${want}, got ${got}`) }
}
// ---- 自作テーブル・モジュール・エグゼキューターの型 ----
import { intel, tableFields, memberNamesOf } from '../js/editor/luau-intel.js'
const doc2 = `
local Config = { Speed = 16, Name = "x", Nested = { a = 1 }, onHit = function(part, dmg) end }
function Config.reset(all) end
function Config:apply(target) end
Config.extra = true
local Util = require(script.Parent.Util)
local res = request({ Url = "https://example.com" })
local circle = Drawing.new("Circle")
local ws = WebSocket.connect("wss://example.com")
for _, conn in getconnections(game.Players.PlayerAdded) do
end
local function helper(a, b) end
local ref = cloneref(game:GetService("Players"))
local old
old = hookmetamethod(game, "__namecall", newcclosure(function(self, ...)
end))
`
intel.executor = true
intel.moduleSource = name => (name === 'Util' ? 'local Util = {}\nfunction Util.formatNumber(n) end\nUtil.VERSION = 2\nreturn Util\n' : null)
const ctx2 = { text: doc2, pos: doc2.length, index: 0 }
const names = expr => { const ty = resolveChain(parseChain(expr), ctx2); return (ty && ty.k === 'usertable' ? [...tableFields(ty.text, ty.name).keys()] : memberNamesOf(ty, '.') || []).join(',') }
const cases2 = [
  ['Config fields', names('Config'), 'Speed,Name,Nested,onHit,reset,apply,extra'],
  ['module fields', names('Util'), 'formatNumber,VERSION'],
  ['Config type', typeLabel(resolveChain(parseChain('Config'), ctx2)), 'Config'],
  ['Config.Speed', typeLabel(resolveChain(parseChain('Config.Speed'), ctx2)), 'number'],
  ['request result', typeLabel(resolveChain(parseChain('res'), ctx2)), 'Response'],
  ['res.Body', typeLabel(resolveChain(parseChain('res.Body'), ctx2)), 'string'],
  ['Drawing kind', typeLabel(resolveChain(parseChain('circle'), ctx2)), 'Drawing.Circle'],
  ['circle.Position', typeLabel(resolveChain(parseChain('circle.Position'), ctx2)), 'Vector2'],
  ['circle members', names('circle').includes('Radius') && !names('circle').includes('PointA') ? 'ok' : names('circle'), 'ok'],
  ['WebSocket', typeLabel(resolveChain(parseChain('ws'), ctx2)), 'WebSocket'],
  ['ws.OnMessage', typeLabel(resolveChain(parseChain('ws.OnMessage'), ctx2)), 'RBXScriptSignal'],
  ['connection loop var', typeLabel(resolveChain(parseChain('conn'), ctx2)), 'Connection'],
  ['cloneref keeps type', typeLabel(resolveChain(parseChain('ref'), ctx2)), 'Players'],
  ['hook self', typeLabel(resolveChain(parseChain('self'), ctx2)), 'Instance'],
  ['gethui()', typeLabel(resolveChain(parseChain('gethui()'), ctx2)), 'Instance'],
  ['getgenv()', typeLabel(resolveChain(parseChain('getgenv()'), ctx2)), 'getgenv()'],
]
for (const [name, got, want] of cases2) if (got !== want) { fail++; console.log(`✗ ${name}: expected ${want}, got ${got}`) }
intel.executor = true
const cb = chainBefore('  local x = game:GetService("Players").LocalPlayer.', 50)
if (cb !== 'game:GetService("Players").LocalPlayer') { fail++; console.log('✗ chainBefore', cb) }
console.log(`${cases.length + cases2.length + 1 - fail} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
