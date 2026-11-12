// Roblox サンドボックスの動作確認:  node tests/roblox.test.mjs
import { readFileSync } from 'node:fs'
import { createVM, formatError } from '../js/luau/vm.js'
import { installRoblox } from '../js/luau/roblox.js'
import { installExecutor } from '../js/luau/executor.js'

const api = JSON.parse(readFileSync(new URL('../data/roblox-api.json', import.meta.url), 'utf8'))

function runRbx(src, files = {}) {
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
    rbx.mountFiles({ 'main.lua': src, ...files }, 'MyProject')
    rbx.setScript('main.lua')
    installExecutor(vm.env, ctx, rbx)
    try { vm.run(src, 'main.lua') } catch (e) { out.push('[syntax] ' + formatError(e)); resolve({ out, posts }) }
    setTimeout(() => resolve({ out, posts, timeout: true }), 4000)
  })
}

const cases = [
  ['services & instances', `
local Players = game:GetService("Players")
local part = Instance.new("Part")
part.Name = "MyPart"
part.Size = Vector3.new(2, 3, 4)
part.Position = Vector3.new(0, 10, 0)
part.BrickColor = BrickColor.new("Bright red")
part.Anchored = true
part.Parent = workspace
print(part:GetFullName(), part.Size, part.Position.Y, part.Anchored, part:IsA("BasePart"), typeof(part))
print(workspace:FindFirstChild("MyPart") == part, workspace.MyPart.Name, Players.LocalPlayer.Name)
print(#workspace:GetChildren() > 2, game.Workspace == workspace, part.Color)`,
  'Workspace.MyPart 2, 3, 4 10 true true Instance\ntrue MyPart Player1\ntrue true 0.7686274509803922, 0.1568627450980392, 0.10980392156862745'],
  ['events', `
local ev = Instance.new("BindableEvent")
ev.Event:Connect(function(a, b) print("fired", a, b) end)
ev:Fire(1, "two")
local v = Instance.new("IntValue")
v.Changed:Connect(function(new) print("changed", new) end)
v.Value = 5
local p = Instance.new("Part")
p:GetPropertyChangedSignal("Transparency"):Connect(function() print("transp", p.Transparency) end)
p.Transparency = 0.5`, 'fired 1 two\nchanged 5\ntransp 0.5'],
  ['PlayerAdded fires', `
game.Players.PlayerAdded:Connect(function(plr)
  local ls = Instance.new("Folder")
  ls.Name = "leaderstats"
  ls.Parent = plr
  local coins = Instance.new("IntValue", ls)
  coins.Name = "Coins"
  coins.Value = 10
  print("joined", plr.Name, plr.leaderstats.Coins.Value)
end)`, 'joined Player1 10'],
  ['WaitForChild', `
task.delay(0.05, function() local f = Instance.new("Folder") f.Name = "Late" f.Parent = workspace end)
local late = workspace:WaitForChild("Late")
print("got", late.Name)
print(workspace:WaitForChild("Nope", 0.05))`, 'got Late\nnil'],
  ['errors', `
local ok, e = pcall(function() return workspace.DoesNotExist end)
print(e)
local ok2, e2 = pcall(function() local p = Instance.new("Part") p.Anchored = "yes" end)
print(e2)
print(pcall(Instance.new, "NotAClass"))`,
  'main.lua:2: DoesNotExist is not a valid member of Workspace "Workspace"\nmain.lua:4: invalid argument #3 to \'Anchored\' (boolean expected, got string)\nfalse Unable to create an Instance of type "NotAClass"'],
  ['datatypes', `
local cf = CFrame.new(0, 5, 0) * CFrame.Angles(0, math.rad(90), 0)
local p = cf * Vector3.new(0, 0, -10)
print(math.round(p.X), math.round(p.Y), math.round(p.Z))
print(Color3.fromRGB(255, 128, 0):ToHex(), UDim2.new(0.5, 10, 1, 0), Vector3.new(3, 4, 0).Magnitude)
print(Enum.KeyCode.E, Enum.KeyCode.E.Value, Enum.Material.Neon.Name, typeof(Enum.KeyCode.E))
local t = TweenInfo.new(1, Enum.EasingStyle.Linear)
print(t.Time, t.EasingStyle)`, '-10 5 -0\nff8000 {0.5, 10}, {1, 0} 5\nEnum.KeyCode.E 101 Neon EnumItem\n1 Enum.EasingStyle.Linear'],
  ['tween', `
local TweenService = game:GetService("TweenService")
local part = Instance.new("Part", workspace)
local tw = TweenService:Create(part, TweenInfo.new(0.1, Enum.EasingStyle.Linear), {Transparency = 1})
tw.Completed:Connect(function(state) print("done", part.Transparency, state) end)
tw:Play()`, 'done 1 Enum.PlaybackState.Completed'],
  ['HttpService JSON', `
local H = game:GetService("HttpService")
local s = H:JSONEncode({a = 1, list = {1, 2, 3}, name = "日本"})
local t = H:JSONDecode(s)
print(t.a, #t.list, t.name, #H:GenerateGUID(false))`, '1 3 日本 36'],
  ['DataStore', `
local DSS = game:GetService("DataStoreService")
local store = DSS:GetDataStore("Coins")
store:SetAsync("player_1", 100)
print(store:GetAsync("player_1"))
store:UpdateAsync("player_1", function(old) return (old or 0) + 50 end)
print(store:GetAsync("player_1"), store:IncrementAsync("x", 3))`, '100\n150 3'],
  ['require module', `
local util = require(script.Parent.util)
print(util.add(2, 3))
local util2 = require("./util")
print(util == util2)`, '5\ntrue', { 'util.lua': 'local M = {}\nfunction M.add(a, b) return a + b end\nreturn M' }],
  ['RemoteEvent loopback', `
local re = Instance.new("RemoteEvent", game.ReplicatedStorage)
re.OnServerEvent:Connect(function(player, msg) print("server got", player.Name, msg) end)
re:FireServer("hello")`, 'server got Player1 hello'],
  ['executor fs', `
writefile("config.json", '{"x":1}')
print(isfile("config.json"), readfile("config.json"))
makefolder("data")
writefile("data/a.txt", "A")
print(#listfiles("data"), isfolder("data"), identifyexecutor())
appendfile("data/a.txt", "B") print(readfile("data/a.txt"))`, 'true {"x":1}\n1 true ForgeCode Sandbox 5.0\nAB'],
  ['hookfunction & namecall', `
local function greet() return "hi" end
local old = hookfunction(greet, function() return "hooked" end)
print(greet(), old())
local oldNC
oldNC = hookmetamethod(game, "__namecall", function(self, ...)
  local m = getnamecallmethod()
  if m == "GetService" then print("intercepted", ...) end
  return oldNC(self, ...)
end)
local rs = game:GetService("ReplicatedStorage")
print(rs.Name)
print(getgenv() == _G, typeof(Drawing.new("Line")))`, 'hooked hi\nintercepted ReplicatedStorage\nReplicatedStorage\ntrue Drawing'],
  ['character', `
local plr = game.Players.LocalPlayer
local char = plr.Character or plr.CharacterAdded:Wait()
local hum = char:WaitForChild("Humanoid")
hum.Died:Connect(function() print("died") end)
hum:TakeDamage(30) print(hum.Health)
hum.Health = 0
print(char.HumanoidRootPart.Position.Y, char.PrimaryPart.Name)`, '70\ndied\n3 HumanoidRootPart'],
  ['heartbeat', `
local RS = game:GetService("RunService")
local n = 0
local c
c = RS.Heartbeat:Connect(function(dt) n += 1 if n == 3 then c:Disconnect() print("frames", n, dt > 0) end end)`, 'frames 3 true'],
  ['stub api', `
local MS = game:GetService("MarketplaceService")
print(MS:UserOwnsGamePassAsync(1, 123))
local SS = game:GetService("SocialService")
print(SS:CanSendGameInviteAsync(game.Players.LocalPlayer))`, 'false\n[info] [サンドボックス] SocialService:CanSendGameInviteAsync() は模擬動作です (実際の処理は行われません)\nfalse'],
  ['clone/destroy', `
local m = Instance.new("Model")
local p = Instance.new("Part", m) p.Name = "Root"
m.PrimaryPart = p
local c = m:Clone()
print(workspace.Terrain.ClassName, workspace.CurrentCamera.ClassName)
print(c.PrimaryPart == c.Root, c.PrimaryPart ~= p)
p:Destroy()
print(p.Parent, #m:GetChildren(), pcall(function() p.Parent = workspace end))`, 'Terrain Camera\ntrue true\nnil 0 false main.lua:9: The Parent property of Root is locked, current parent: NULL, new parent Workspace'],
  ['legacy enums & lenient datatypes', `print(Enum.KeyCode.Unknown.Value, Enum.Font.GothamSemibold ~= nil, UDim2.new(1, 0, 1, false).Y.Offset, Vector3.new(nil, "2").Y)`, '0 true 0 2'],
  ['tween override', `local f = Instance.new("Frame")
local ts = game:GetService("TweenService")
local a = ts:Create(f, TweenInfo.new(0.2), { BackgroundTransparency = 1 })
local b = ts:Create(f, TweenInfo.new(0.05), { BackgroundTransparency = 0.5 })
local stateA
a.Completed:Connect(function(s) stateA = s.Name end)
a:Play() task.wait(0.03) b:Play() task.wait(0.3)
print(stateA, f.BackgroundTransparency)`, 'Cancelled 0.5'],
  ['stats', `local st = game:GetService("Stats") print(type(st.Network.ServerStatsItem["Data Ping"]:GetValue()), typeof(st:GetTotalMemoryUsageMb()))`, 'number number'],
]

let pass = 0, fail = 0
for (const [name, src, expect, files] of cases) {
  const { out, timeout } = await runRbx(src, files)
  const got = out.join('\n')
  if (got === expect) pass++
  else { fail++; console.log(`✗ ${name}${timeout ? ' (timeout)' : ''}\n  expected: ${JSON.stringify(expect)}\n  got:      ${JSON.stringify(got)}`) }
}
console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
