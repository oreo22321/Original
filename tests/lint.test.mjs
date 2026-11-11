// エラーチェック・誤字検出のテスト:  node tests/lint.test.mjs
import { readFileSync } from 'node:fs'
import { setRobloxApi } from '../js/editor/apidb.js'
import { intel } from '../js/editor/luau-intel.js'
import { lintLuau } from '../js/editor/lint.js'
import { fixCode, inStringOrComment, nearest, editDistance } from '../js/editor/typo.js'
setRobloxApi(JSON.parse(readFileSync(new URL('../data/roblox-api.json', import.meta.url), 'utf8')))

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`✕ ${name}${detail ? '\n   ' + detail : ''}`) } }
const lint = (src, opts = {}) => { intel.executor = !!opts.executor; return lintLuau(src, { typos: true, ...opts }).filter(d => d.severity !== 'hint') }
const msgs = (src, opts) => lint(src, opts).map(d => d.message)
// 修正アクションを適用した結果
function applyFix(src, opts, index = 0, action = 0) {
  const d = lint(src, opts)[index]
  let out = src
  const view = { state: { doc: { toString: () => src } }, dispatch(tr) { const ch = [].concat(tr.changes).sort((a, b) => b.from - a.from); for (const c of ch) out = out.slice(0, c.from) + (c.insert || '') + out.slice(c.to ?? c.from) } }
  d.actions[action].apply(view, d.from, d.to)
  return out
}
const has = (name, src, re, opts) => { const m = msgs(src, opts); ok(name, m.some(x => re.test(x)), JSON.stringify(m)) }
const clean = (name, src, opts) => { const m = msgs(src, opts); ok(name, m.length === 0, JSON.stringify(m)) }

// ---- 問題のないコードに警告を出さない ----
clean('clean studio', `
local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")
local Util = require(script.Parent.Util)
local part = Instance.new("Part")
part.Anchored = true
part.Position = Vector3.new(0, 10, 0)
part.Parent = workspace
part.Touched:Connect(function(hit)
	local hum = hit.Parent:FindFirstChildOfClass("Humanoid")
	if hum then hum:TakeDamage(10) end
end)
Players.PlayerAdded:Connect(function(player)
	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	stats.Parent = player
	print(player.Name, player.UserId, Util)
end)
local x = if part.Anchored then 1 else 2
for i = 1, 10 do print(i, x, string.format("%d", i), math.floor(i / 2)) end
while true do task.wait(1) end
TweenService:Create(part, TweenInfo.new(1), { Transparency = 1 }):Play()
print(workspace.Baseplate, workspace.MyCustomFolder.Thing, Enum.KeyCode.Space, Enum.Material.Neon)
`)
clean('clean executor', `
local old
old = hookmetamethod(game, "__namecall", newcclosure(function(self, ...)
	if not checkcaller() and getnamecallmethod() == "Kick" then return end
	return old(self, ...)
end))
if not isfolder("cfg") then makefolder("cfg") end
writefile("cfg/a.json", game:GetService("HttpService"):JSONEncode({ a = 1 }))
local res = request({ Url = "https://example.com", Method = "GET" })
print(res.StatusCode, res.Body, identifyexecutor(), getgenv().Foo, syn.request, bit.band(1, 2))
local c = Drawing.new("Circle")
c.Radius = 5 c.Visible = true c.Position = Vector2.new(1, 2)
loadstring(game:HttpGet("https://example.com/x.lua"))()
for _, conn in getconnections(game.Players.PlayerAdded) do conn:Disable() end
`, { executor: true })
clean('else if (valid nested if)', 'local a, b = 1, 2\nif a then print(1) else if b then print(2) end end')

// ---- 誤字: グローバル ----
has('global typo', 'pirnt("hi")', /もしかして 'print'/)
ok('global typo fix', applyFix('pirnt("hi")') === 'print("hi")')
has('local typo', 'local player = 1\nprint(playr)', /もしかして 'player'/)
has('case typo', 'local Players = game:GetService("Players")\nprint(players)', /もしかして 'Players'/)
has('foreign null', 'local x = null\nprint(x)', /'nil' を使います/)
has('executor fn in studio', 'writefile("a", "b")', /エグゼキューター専用/)
clean('executor fn in executor', 'writefile("a", "b")', { executor: true })
has('executor typo', 'hookfuntion(print, print)', /もしかして 'hookfunction'/, { executor: true })
// ---- 誤字: メンバー ----
has('service typo', 'local P = game:GetService("Playrs")\nprint(P)', /もしかして "Players"/)
ok('service typo fix', applyFix('local P = game:GetService("Playrs")\nprint(P)') === 'local P = game:GetService("Players")\nprint(P)')
has('method typo', 'local P = game:GetServise("Players")\nprint(P)', /もしかして 'GetService'/)
has('property case', 'local part = Instance.new("Part")\npart.position = Vector3.new()', /もしかして 'Position'/)
has('property typo', 'local part = Instance.new("Part")\npart.Tranparency = 1', /もしかして 'Transparency'/)
has('player member typo', 'local plr = game:GetService("Players").LocalPlayer\nprint(plr.Charater)', /もしかして 'Character'/)
has('event param member typo', 'game:GetService("Players").PlayerAdded:Connect(function(player)\n\tprint(player.UserID)\nend)', /もしかして 'UserId'/)
has('class typo', 'local p = Instance.new("Prat")\nprint(p)', /もしかして "Part"/)
has('service in Instance.new', 'local p = Instance.new("Players")\nprint(p)', /サービスです/)
has('enum typo', 'print(Enum.KeyCode.Sapce)', /もしかして 'Space'/)
has('enum name typo', 'print(Enum.KeyCod.Space)', /もしかして 'KeyCode'/)
has('lib typo', 'print(string.fromat("%d", 1))', /もしかして 'format'/)
has('lib unknown', 'print(math.cube(2))', /math ライブラリ にありません/)
has('task typo', 'task.wiat(1)', /もしかして 'wait'/)
has('datatype ctor typo', 'local v = Vector3.nwe(1, 2, 3)\nprint(v)', /もしかして 'new'/)
has('IsA class typo', 'local p = Instance.new("Part")\nprint(p:IsA("BasePrat"))', /もしかして "BasePart"/)
has('drawing kind typo', 'local d = Drawing.new("Sqare")\nprint(d)', /もしかして "Square"/, { executor: true })
has('drawing prop typo', 'local d = Drawing.new("Circle")\nd.Raduis = 4', /もしかして 'Radius'/, { executor: true })
// ---- '.' と ':' ----
has('dot method', 'local p = Instance.new("Part")\np.Destroy()', /':' を使います/)
has('dot method typed', 'local h = Instance.new("Humanoid")\nh.ChangeState(1)', /':' を使います/)
has('colon lib', 'local s = string:format("%d", 1)\nprint(s)', /'\.' で呼びます/)
// ---- 文脈 ----
has('LocalPlayer on server', 'print(game.Players.LocalPlayer)', /サーバースクリプトでは LocalPlayer は nil/, { scriptKind: 'server' })
has('FireServer on server', 'local r = Instance.new("RemoteEvent")\nr:FireServer()', /FireClient/, { scriptKind: 'server' })
has('DataStore on client', 'local d = game:GetService("DataStoreService")\nprint(d)', /サーバー専用/, { scriptKind: 'client' })
has('infinite loop', 'local n = 0\nwhile true do\n\tn = n + 1\n\tprint(n)\nend', /フリーズします/)
ok('infinite loop fix', applyFix('local n = 0\nwhile true do\n\tn = n + 1\nend') === 'local n = 0\nwhile true do\n\ttask.wait()\n\tn = n + 1\nend')
clean('loop with break', 'local n = 0\nwhile true do\n\tn = n + 1\n\tif n > 5 then break end\nend')
clean('loop calling user fn', 'local function step() end\nwhile true do\n\tstep()\nend')
has('deprecated wait', 'wait(1)', /task\.wait/)
// ---- 構文エラー ----
has('missing end', 'function f()\n\tif x then\n\t\tprint(1)\n\tprint(2)\nend', /2 行目の 'if' に対応する 'end'/)
ok('missing end fix', applyFix('function f()\n\tif true then\n\t\tprint(1)\n\tprint(2)\nend') === 'function f()\n\tif true then\n\t\tprint(1)\n\tend\n\tprint(2)\nend', applyFix('function f()\n\tif true then\n\t\tprint(1)\n\tprint(2)\nend'))
has('extra end', 'print(1)\nend', /余分な 'end'/)
ok('extra end fix', applyFix('print(1)\nend\nprint(2)') === 'print(1)\nprint(2)')
has('!=', 'if a != b then end', /~=/)
ok('!= fix', applyFix('if a != b then end') === 'if a ~= b then end')
has('= in condition', 'local a = 1\nif a = 1 then end', /比較には '=='/)
ok('= fix', applyFix('local a = 1\nif a = 1 then end') === 'local a = 1\nif a == 1 then end')
has('missing then', 'local a = 1\nif a == 1\n\tprint(a)\nend', /'then' が必要/)
ok('missing then fix', applyFix('local a = 1\nif a == 1\n\tprint(a)\nend') === 'local a = 1\nif a == 1 then\n\tprint(a)\nend', applyFix('local a = 1\nif a == 1\n\tprint(a)\nend'))
has('python colon', 'local a = 1\nif a == 1:\n\tprint(a)\nend', /':' ではなく 'then'/)
has('keyword typo', 'local fucntion foo()\nend', /'function' の打ち間違い/)
has('keyword typo 2', 'locla x = 1', /'local' の打ち間違い/)
has('unterminated string', 'print("hello)', /文字列が閉じられていません/)
has('slash comment', '// comment\nprint(1)', /コメントは --/)
has('else if hint', 'local a, b\nif a then\n\tprint(1)\nelse if b then\n\tprint(2)\nend', /elseif/)
// ---- 全角 ----
has('fullwidth paren', 'print（"hi"）', /全角の （/)
ok('fullwidth fix', applyFix('print（"hi"）') === 'print("hi"）')
ok('fullwidth fix all', applyFix('print（"hi"）', {}, 0, 1) === 'print("hi")')
has('fullwidth space', 'local x = 1\n　print(x)', /全角スペース/)
has('smart quotes', 'print(“hi”)', /スマート引用符/)
has('japanese in code', 'local x = 1\nこんにちは\nprint(x)', /コードの中に/)
{
  const m = msgs('local P = game:GetServise("Players")\nprint（P）')
  ok('fullwidth + typo together', m.length === 3 && m.some(x => /GetService/.test(x)), JSON.stringify(m))
}
clean('japanese in string/comment', 'print("こんにちは　世界（テスト）") -- コメント（全角）\nlocal s = [[\n　全角\n]]\nprint(s)')
// ---- typo.js ----
ok('fixCode keeps strings', fixCode('print（“a”，"全角（）"）　-- （コメント）') === 'print("a","全角（）") -- （コメント）', fixCode('print（“a”，"全角（）"）　-- （コメント）'))
ok('inStringOrComment 1', inStringOrComment('print("abc', 10) === true)
ok('inStringOrComment 2', inStringOrComment('print("abc")', 12) === false)
ok('inStringOrComment 3', inStringOrComment('x = 1 -- note', 13) === true)
ok('inStringOrComment 4', inStringOrComment('local s = [[\nabc', 16) === true)
ok('inStringOrComment 5', inStringOrComment('local s = [[\nabc]]\nx', 20) === false)
ok('distance transposition', editDistance('pirnt', 'print') === 1)
ok('nearest short names strict', nearest('fo', ['for', 'foo']) === null)
ok('nearest exact → null', nearest('print', ['print', 'pint']) === null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
