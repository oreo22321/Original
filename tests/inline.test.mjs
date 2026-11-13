// インライン候補 (ゴーストテキスト) のテスト:  node tests/inline.test.mjs
import { readFileSync } from 'node:fs'
import { EditorState, EditorSelection, indentUnit } from '../vendor/codemirror.js'
import { setRobloxApi } from '../js/editor/apidb.js'
import { intel } from '../js/editor/luau-intel.js'
import { luauLanguage } from '../js/editor/luau-lang.js'
import { luauLocalSuggest } from '../js/editor/inline.js'
setRobloxApi(JSON.parse(readFileSync(new URL('../data/roblox-api.json', import.meta.url), 'utf8')))

let pass = 0, fail = 0
function sug(doc, mode = 'studio') {
  const pos = doc.indexOf('|')
  const text = doc.replace('|', '')
  intel.executor = mode === 'executor'
  const state = EditorState.create({ doc: text, selection: EditorSelection.cursor(pos), extensions: [luauLanguage, indentUnit.of('\t')] })
  const r = luauLocalSuggest(state, pos, mode)
  return r ? r.text : null
}
const eq = (name, got, want) => { if (got === want) pass++; else { fail++; console.log(`✕ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`) } }

eq('service', sug('local Players = |'), 'game:GetService("Players")')
eq('service alias', sug('local UIS =|'), ' game:GetService("UserInputService")')
eq('player uses declared Players', sug('local Players = game:GetService("Players")\nlocal player = |'), 'Players.LocalPlayer')
eq('character adapts name', sug('local plr = game.Players.LocalPlayer\nlocal char = |'), 'plr.Character or plr.CharacterAdded:Wait()')
eq('GetService string', sug('game:GetService("Repl|")'), 'icatedStorage')
eq('Instance.new string', sug('Instance.new("TextB|'), 'utton")')
eq('then', sug('if x > 1|'), ' then')
eq('no then after operator', sug('if x >|'), null)
eq('do', sug('for i = 1, 10|'), ' do')
eq('while do', sug('while running |'), 'do')
eq('function parens', sug('local function update|'), '()')
eq('PlayerAdded params', sug('local Players = game:GetService("Players")\nPlayers.PlayerAdded:Connect(|)'), 'function(player)\n\t\nend')
eq('Touched params', sug('local part = Instance.new("Part")\npart.Touched:Connect(|'), 'function(hit)\n\t\nend)')
eq('InputBegan params', sug('game:GetService("UserInputService").InputBegan:Connect(|'), 'function(input, gameProcessed)\n\t\nend)')
eq('task.spawn', sug('task.spawn(|'), 'function()\n\t\nend)')
eq('task.delay', sug('task.delay(2, |'), 'function()\n\t\nend)')
eq('table.sort', sug('table.sort(list, |'), 'function(a, b)\n\treturn a < b\nend)')
eq('Vector3.new', sug('local v = Vector3.new(|'), '0, 0, 0)')
eq('Color3 with closing paren', sug('x.Color = Color3.fromRGB(|)'), '255, 255, 255')
eq('for players', sug('local Players = game:GetService("Players")\nfor _, player in |'), 'Players:GetPlayers() do')
eq('module return', sug('local Util = {}\nfunction Util.a() end\nreturn |'), 'Util')
eq('no suggestion in comment', sug('-- if x > 1|'), null)
eq('no suggestion in string', sug('print("if x > 1|'), null)
// エグゼキューター
eq('loadstring', sug('loadstring(|', 'executor'), 'game:HttpGet(""))()')
eq('loadstring studio', sug('loadstring(|'), null)
eq('request', sug('local res = request(|', 'executor'), '{\n\tUrl = "",\n\tMethod = "GET",\n})')
eq('hookmetamethod', sug('local old\nold = hookmetamethod(|', 'executor'), 'game, "__namecall", newcclosure(function(self, ...)\n\tlocal method = getnamecallmethod()\n\t\n\treturn old(self, ...)\nend))')
// ファイルから学ぶ
const gui = `local a = Instance.new("TextLabel")
a.Size = UDim2.fromOffset(200, 50)
a.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
a.TextColor3 = Color3.new(1, 1, 1)
a.Parent = gui

local b = Instance.new("TextLabel")
`
eq('analogy: after Instance.new', sug(gui + '|'), 'b.Size = UDim2.fromOffset(200, 50)')
eq('analogy: next property', sug(gui + 'b.Size = UDim2.fromOffset(10, 10)\n|'), 'b.BackgroundColor3 = Color3.fromRGB(30, 30, 30)')
eq('analogy: typed prefix', sug(gui + 'b.Size = UDim2.fromOffset(10, 10)\nb.Back|'), 'groundColor3 = Color3.fromRGB(30, 30, 30)')
eq('analogy: mismatch typed', sug(gui + 'b.Size = UDim2.fromOffset(10, 10)\nb.Text|'), null)
eq('line repeat', sug('humanoid.WalkSpeed = 16\nprint(1)\nhumanoid.Walk|'), 'Speed = 16')
eq('line repeat too short', sug('humanoid.WalkSpeed = 16\nprint(1)\nhum|'), null)

// ---- v8: 型から考える候補 ----
const H = `local Players = game:GetService("Players")
local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")
local screenGui = Instance.new("ScreenGui")
local frame = Instance.new("Frame")
local part = Instance.new("Part")
`
eq('gui color value', sug(H + 'frame.BackgroundColor3 = |'), 'Color3.fromRGB(30, 30, 30)')
eq('part size value', sug(H + 'part.Size = |'), 'Vector3.new(4, 1, 2)')
eq('gui size value', sug(H + 'frame.Size = |'), 'UDim2.new(0, 200, 0, 50)')
eq('ScreenGui parent', sug(H + 'screenGui.Parent = |'), 'playerGui')
eq('Frame parent', sug(H + 'frame.Parent = |'), 'screenGui')
eq('Part parent', sug(H + 'part.Parent = |'), 'workspace')
eq('UICorner parent', sug(H + 'local corner = Instance.new("UICorner")\ncorner.Parent = |'), 'frame')
eq('next property', sug(H + 'local label = Instance.new("TextLabel")\n|'), 'label.Size = UDim2.new(0, 200, 0, 50)')
eq('Parent comes last', sug(H + 'local p2 = Instance.new("Part")\np2.Size = Vector3.new(1, 1, 1)\np2.Position = Vector3.new(0, 5, 0)\np2.Anchored = true\np2.Color = Color3.new(1, 0, 0)\np2.Material = Enum.Material.Neon\n|'), 'p2.Parent = workspace')
eq('no suggestion after Parent', sug(H + 'local p3 = Instance.new("Part")\np3.Parent = workspace\n|'), null)
eq('Instance.new parent arg', sug(H + 'local b = Instance.new("TextButton", |'), 'frame)')
eq('tween args', sug(H + 'game:GetService("TweenService"):Create(|'), 'part, TweenInfo.new(0.5), {})')
eq('MoveTo arg', sug(H + 'local h = player.Character.Humanoid\nh:MoveTo(|'), 'Vector3.new(0, 0, 0))')
eq('tween goal value', sug(H + 'game:GetService("TweenService"):Create(frame, TweenInfo.new(1), { Size = |'), 'UDim2.new(0, 200, 0, 50)')
eq('asset id', sug(H + 'local s = Instance.new("Sound")\ns.SoundId = |'), '"rbxassetid://"')
eq('executor ScreenGui parent', sug('local g = Instance.new("ScreenGui")\ng.Parent = |', 'executor'), 'gethui and gethui() or game:GetService("CoreGui")')
eq('drawing props', sug('local box = Drawing.new("Square")\nbox.Size = Vector2.new(10, 10)\n|', 'executor'), 'box.Position = Vector2.new(100, 100)')
eq('hookfunction body', sug('local old\nold = hookfunction(|', 'executor'), ', newcclosure(function(...)\n\t\n\treturn old(...)\nend))')
eq('namecall hook', sug('local mt = getrawmetatable(game)\nlocal oldNc = mt.__namecall\nmt.__namecall = |', 'executor'), 'newcclosure(function(self, ...)\n\tlocal method = getnamecallmethod()\n\t\n\treturn oldNc(self, ...)\nend)')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
