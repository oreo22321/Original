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
const cb = chainBefore('  local x = game:GetService("Players").LocalPlayer.', 50)
if (cb !== 'game:GetService("Players").LocalPlayer') { fail++; console.log('✗ chainBefore', cb) }
console.log(`${cases.length + 1 - fail} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
