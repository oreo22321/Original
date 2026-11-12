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
  ['pos', 'Vector3'], ['tw', 'Tween'], ['plr', 'Player', 'plr.\n'], ['p', 'Player', 'GetPlayers()) do\n'], ['v', 'Vector3'], ['s', 'string'], ['hit', 'BasePart', 'function(hit)\n'],
  ['game.Workspace', 'Workspace'], ['workspace.CurrentCamera', 'Camera'], ['Enum.KeyCode', 'Enum.KeyCode'], ['part.Touched', 'RBXScriptSignal'],
  ['game:GetService("UserInputService")', 'UserInputService'], ['Vector3', 'Vector3'], ['math', 'math'], ['player.Character.Humanoid', 'Humanoid'],
  ['hum.Health', 'number'], ['part:Clone()', 'Part'], ['CFrame.new(1,2,3)', 'CFrame'], ['crypt', 'crypt'],
]
let fail = 0
for (const [expr, want, at] of cases) {
  // 引数・ループ変数はスコープの中で調べる
  const pos = at ? doc.indexOf(at) + at.length : doc.length
  const ty = resolveChain(parseChain(expr), { text: doc, pos, index: 0 })
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
  ['connection loop var', typeLabel(resolveChain(parseChain('conn'), { ...ctx2, pos: doc2.indexOf('PlayerAdded) do') + 16 })), 'Connection'],
  ['cloneref keeps type', typeLabel(resolveChain(parseChain('ref'), ctx2)), 'Players'],
  ['hook self', typeLabel(resolveChain(parseChain('self'), { ...ctx2, pos: doc2.indexOf('function(self, ...)') + 20 })), 'Instance'],
  ['conn out of scope', typeLabel(resolveChain(parseChain('conn'), ctx2)), 'any'],
  ['gethui()', typeLabel(resolveChain(parseChain('gethui()'), ctx2)), 'Instance'],
  ['getgenv()', typeLabel(resolveChain(parseChain('getgenv()'), ctx2)), 'getgenv()'],
]
for (const [name, got, want] of cases2) if (got !== want) { fail++; console.log(`✗ ${name}: expected ${want}, got ${got}`) }
// ---- v8: スコープ・戻り値・クラス・型定義・IsA・タプル ----
const doc3 = `
local function make()
  local Instance = "shadow"
end
local p = Instance.new("Part")
local function getChar()
  return game.Players.LocalPlayer.Character
end
local function getHum(): Humanoid
  return nil
end
local Gun = {}
Gun.__index = Gun
function Gun.new(tool)
  local self = setmetatable({}, Gun)
  self.Handle = Instance.new("Part")
  self.Ammo = 30
  self.Owner = game.Players.LocalPlayer
  return self
end
function Gun:GetOwner()
  return self.Owner
end
function Gun:Fire()
  @SELF@
end
local g = Gun.new()
type Settings = { speed: number, target: BasePart, getPlayer: (self: Settings) -> Player }
local cfg: Settings = {}
local Config = { Colors = { Main = Color3.new(1, 0, 0) }, Part = workspace.Baseplate }
local parts = { Instance.new("Part"), Instance.new("Part") }
for _, x in parts do
  @PARTS@
end
for _, obj in workspace:GetDescendants() do
  if obj:IsA("BasePart") and obj.Anchored then
    @ISA@
  else
    @ELSE@
  end
  if not obj:IsA("Model") then continue end
  @GUARD@
end
local camera = workspace.CurrentCamera
local screenPos, onScreen = camera:WorldToViewportPoint(p.Position)
local hit = workspace:Raycast(Vector3.new(), Vector3.new(0, -10, 0))
local t = if true then Vector3.new() else nil
local m = make() or workspace
local tbl = { Instance = 1,
  Name = "x" }
`
const q3 = (e, mk) => typeLabel(resolveChain(parseChain(e), { text: doc3, pos: mk ? doc3.indexOf(mk) : doc3.length, index: 0 }))
const cases3 = [
  ['shadowed global stays global', 'p', 'Part'], ['function return', 'getChar()', 'Model'], ['return annotation', 'getHum()', 'Humanoid'],
  ['class instance', 'g', 'Gun'], ['self field', 'g.Handle', 'Part'], ['self number field', 'g.Ammo', 'number'], ['method return', 'g:GetOwner()', 'Player'],
  ['self in method', 'self.Owner', 'Player', '@SELF@'], ['type alias field', 'cfg.target', 'BasePart'], ['type alias method', 'cfg:getPlayer()', 'Player'],
  ['nested table literal', 'Config.Colors.Main', 'Color3'], ['array element', 'x', 'Part', '@PARTS@'], ['IsA narrowing', 'obj', 'BasePart', '@ISA@'],
  ['no narrowing in else', 'obj', 'Instance', '@ELSE@'], ['guard clause', 'obj', 'Model', '@GUARD@'], ['tuple 1st', 'screenPos', 'Vector3'], ['tuple 2nd', 'onScreen', 'boolean'],
  ['raycast result', 'hit.Instance', 'BasePart'], ['if expression', 't', 'Vector3'], ['or fallback', 'm', 'Workspace'], ['table field is not a global', 'Instance', 'Instance'],
]
for (const [name, e, want, mk] of cases3) { const got = q3(e, mk); if (got !== want) { fail++; console.log(`✗ ${name}: ${e} expected ${want}, got ${got}`) } }

// ---- v8: 補完の候補 (期待される型・ローカル変数・文字列・テーブルのキー) ----
const { EditorState, CompletionContext } = await import('../vendor/codemirror.js')
const { luauLanguage } = await import('../js/editor/luau-lang.js')
const { luauCompletionSource } = await import('../js/editor/luau-intel.js')
const head4 = `local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")
local player = Players.LocalPlayer
local humanoid = player.Character:WaitForChild("Humanoid")
local part = Instance.new("Part")
part.Name = "Coin"
part:SetAttribute("Value", 10)
local frame = Instance.new("Frame")
local function getRoot()
  return player.Character:WaitForChild("HumanoidRootPart")
end
`
const top = (t, n = 3) => {
  const doc = head4 + t.replace('|', '')
  const pos = head4.length + t.indexOf('|')
  const state = EditorState.create({ doc, extensions: [luauLanguage] })
  const r = luauCompletionSource(new CompletionContext(state, pos, false))
  // CodeMirror と同じく、入力済みの文字で絞り込んでから順位を見る
  const typed = r ? doc.slice(r.from, pos).toLowerCase() : ''
  return r ? [...r.options].filter(o => o.label.toLowerCase().startsWith(typed)).sort((a, b) => (b.boost || 0) - (a.boost || 0)).slice(0, n).map(o => o.label).join(',') : 'null'
}
const cases4 = [
  ['enum after property =', top('part.Material = |', 1), 'Enum.Material.SmoothPlastic'],
  ['enum argument', top('humanoid:ChangeState(|', 1), 'Enum.HumanoidStateType.Jumping'],
  ['boolean property', top('part.Anchored = |', 2), 'true,false'],
  ['constructor for UDim2', top('frame.Size = UD|', 1), 'UDim2.new'],
  ['tween goal keys', top('TweenService:Create(part, TweenInfo.new(1), { |', 2), 'Size,CFrame'],
  ['attribute names', top('part:GetAttribute("|', 1), 'Value'],
  ['child names from file', top('workspace:WaitForChild("C|', 9).includes('Coin') ? 'ok' : 'no', 'ok'],
  ['local function first', top('getR|', 1), 'getRoot'],
  ['own decl not listed', top('local x = x|', 40).split(',').includes('x') ? 'listed' : 'ok', 'ok'],
  ['notification keys', top('game:GetService("StarterGui"):SetCore("SendNotification", { |', 1), 'Title'],
  ['inferred member type', top('getRoot().|', 40).includes('Anchored') ? 'ok' : 'no', 'ok'],
]
for (const [name, got, want] of cases4) if (got !== want) { fail++; console.log(`✗ ${name}: expected ${want}, got ${got}`) }

intel.executor = true
const cb = chainBefore('  local x = game:GetService("Players").LocalPlayer.', 50)
if (cb !== 'game:GetService("Players").LocalPlayer') { fail++; console.log('✗ chainBefore', cb) }
console.log(`${cases.length + cases2.length + cases3.length + cases4.length + 1 - fail} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
