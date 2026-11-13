// Forge AI (内蔵 AI) のテスト:  node tests/ai.test.mjs
// ことばの理解・構文の修復・レビュー・説明・コメント/型注釈・生成・会話の振り分け・続きの提案
import { readFileSync } from 'node:fs'
import { setRobloxApi } from '../js/editor/apidb.js'
import { detectIntents, concepts, slots, extractCode, Bm25 } from '../js/ai/text.js'
import { repairSyntax, fixAll, modernize } from '../js/ai/repair.js'
import { reviewCode, applyReviewFixes } from '../js/ai/review.js'
import { explainCode, addComments, addTypes } from '../js/ai/describe.js'
import { generateCode } from '../js/ai/generate.js'
import { respond, hoistServices, verifyLlmCode, searchKnowledge } from '../js/ai/engine.js'
import { completeLine, codeFromComment, setProjectCorpus } from '../js/ai/complete.js'
import { checkSyntax } from '../js/luau/parser.js'
import { lintLuau } from '../js/editor/lint.js'

setRobloxApi(JSON.parse(readFileSync(new URL('../data/roblox-api.json', import.meta.url), 'utf8')))

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else { fail++; console.log(`✗ ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`) }
}
const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`✗ ${name} ${info}`) } }

// ---- ことばの理解 ----
const top = t => (detectIntents(t)[0] || {}).id
eq('intent fix', top('このバグを直して'), 'fix')
eq('intent explain', top('このコードを説明して'), 'explain')
eq('intent comment (katakana)', top('コメントを追加して'), 'comment')
eq('intent format', top('整形して'), 'format')
eq('intent generate', top('触れたら死ぬブロックを作って'), 'generate')
eq('intent question', top('RemoteEventの使い方を教えて'), 'question')
eq('intent help', top('何ができる?'), 'help')
eq('intent error', top("attempt to index nil with 'Humanoid'"), 'error')
ok('concepts touch+kill', ['touch', 'kill'].every(c => concepts('触れたら死ぬ').has(c)))
ok('concepts speed', concepts('速く歩くようにしたい').has('speed'))
const sl = slots('E キーを押したら 30 ダメージ、3 秒後に戻す。色は赤')
eq('slots key', sl.keys, ['E'])
eq('slots seconds', sl.seconds, 3)
eq('slots color', sl.colors[0].name, '赤')
eq('slots kanji number', slots('五秒ごと').seconds, 5)
eq('extract fenced code', extractCode('これ見て\n```lua\nprint(1)\n```'), 'print(1)')
const bm = new Bm25([{ id: 'a', fields: [['トゥイーン tween なめらか', 1]] }, { id: 'b', fields: [['データストア 保存', 1]] }])
eq('bm25', bm.search('データを保存したい')[0].id, 'b')

// ---- 構文の修復 ----
const fixed = src => { const r = repairSyntax(src); return r.ok ? r.text : 'FAIL: ' + (r.error && r.error.message) }
eq('repair !=', fixed('if x != 2 then print(x) end'), 'if x ~= 2 then print(x) end')
eq('repair &&', fixed('if a && b then end'), 'if a and b then end')
eq('repair braces', fixed('if x == 1 {\n  print("a")\n} else {\n  print("b")\n}'), 'if x == 1 then\n  print("a")\nelse\n  print("b")\nend')
eq('repair missing end', fixed('local function f()\n\tprint(1)\n\nf()'), 'local function f()\n\tprint(1)\nend\n\nf()')
eq('repair missing do', fixed('for i = 1, 3\n\tprint(i)\nend'), 'for i = 1, 3 do\n\tprint(i)\nend')
eq('repair = in condition', fixed('if x = 1 then end'), 'if x == 1 then end')
eq('repair connect paren', fixed('x.Touched:Connect(function(hit)\n\tprint(hit)\nend'), 'x.Touched:Connect(function(hit)\n\tprint(hit)\nend)')
eq('repair js style', fixed('// c\nlet x = 5\nx++'), '-- c\nlocal x = 5\nx += 1')
eq('repair table comma', fixed('local t = {\n\ta = 1\n\tb = 2\n}'), 'local t = {\n\ta = 1,\n\tb = 2\n}')
eq('repair keyword typo', fixed('fucntion foo()\nend'), 'function foo()\nend')
eq('repair string', fixed('print("hello)\nprint(1)'), 'print("hello")\nprint(1)')
eq('repair extra end', fixed('while true do\n\ttask.wait()\nend\nend'), 'while true do\n\ttask.wait()\nend\n')
eq('repair else if', fixed('if a then\n\tprint(1)\nelse if b then\n\tprint(2)\nend'), 'if a then\n\tprint(1)\nelseif b then\n\tprint(2)\nend')
eq('repair python def', fixed('def foo():\n  print(1)'), 'local function foo()\n  print(1)\nend')
eq('repair fullwidth', fixed('local x = （1 + 2）'), 'local x = (1 + 2)')
eq('repair already ok', repairSyntax('print(1)').fixes.length, 0)
const fa = fixAll('local hum = workspace.Humanoid\nhum.WalkSped = 50\nwhile true do\n\tprint(1)\nend', { typos: true, undefinedGlobals: true })
ok('fixAll typo', /WalkSpeed = 50/.test(fa.text), fa.text)
ok('fixAll add wait', /task\.wait\(\)/.test(fa.text), fa.text)
const mo = modernize('local p = game.Players.LocalPlayer\nlocal w = game.Workspace\nwait(1)\nlocal part = Instance.new("Part", workspace)\npart.Anchored = true\nx = x + 1\n', {})
ok('modernize services', /game:GetService\("Players"\)/.test(mo.text) && /local w = workspace/.test(mo.text))
ok('modernize task.wait', /task\.wait\(1\)/.test(mo.text))
ok('modernize parent last', /local part = Instance\.new\("Part"\)\npart\.Anchored = true\npart\.Parent = workspace/.test(mo.text), mo.text)
ok('modernize compound', /x \+= 1/.test(mo.text))
ok('modernize keeps syntax', !checkSyntax(mo.text))

// ---- レビュー ----
const rv = reviewCode(`local ok, d = pcall(store:GetAsync("k"))
script.Parent.Touched:Connect(onTouch())
remote.OnServerEvent:Connect(function(amount) print(amount) end)
if player.leaderstats.Coins >= 10 then end
script.Parent.Touched:Connect(function(hit)
	hit.Parent.Humanoid:TakeDamage(10)
end)
local t = {1, 2}
for i = 1, #t do table.remove(t, i) end
`)
const has = re => rv.some(f => re.test(f.message))
ok('review pcall', has(/pcall\(store:GetAsync/))
ok('review connect call', has(/onTouch を今すぐ呼び出して/))
ok('review onserverevent', has(/最初の引数は、送ってきたプレイヤー/))
ok('review .Value', has(/\.Value を付けます/))
ok('review debounce', has(/デバウンス/))
ok('review hit.Parent.Humanoid', has(/hit\.Parent\.Humanoid/))
ok('review table.remove', has(/table\.remove/))
const rf = applyReviewFixes('local ok, d = pcall(store:GetAsync("k"))\nif p.leaderstats.Coins >= 1 then end', reviewCode('local ok, d = pcall(store:GetAsync("k"))\nif p.leaderstats.Coins >= 1 then end'))
ok('review fixes applied', /pcall\(function\(\)\n\treturn store:GetAsync\("k"\)\nend\)/.test(rf) && /Coins\.Value >= 1/.test(rf), rf)
ok('review fixes parse', !checkSyntax(rf))

// ---- 説明・コメント・型 ----
const sample = `local Players = game:GetService("Players")
local part = script.Parent
local function onTouched(hit)
	local humanoid = hit.Parent:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid:TakeDamage(20)
	end
end
part.Touched:Connect(onTouched)
Players.PlayerAdded:Connect(function(player)
	print(player.Name)
end)
local function add(a, b)
	return a + b
end
`
const ex = explainCode(sample, { path: 'Damage.server.lua' })
ok('explain ok', ex.ok && /Script \(サーバー\)/.test(ex.markdown) && /何かが触れた/.test(ex.markdown) && /ダメージを与える/.test(ex.markdown), ex.markdown)
const exSel = explainCode(sample, { from: sample.indexOf('local function onTouched'), to: sample.indexOf('part.Touched') })
ok('explain selection lines', /\*\*4 行目\*\*/.test(exSel.markdown) && /20 ダメージ/.test(exSel.markdown), exSel.markdown)
ok('explain syntax error', !explainCode('if then').ok)
const cm = addComments(sample)
ok('comments added', cm.count >= 3 && !checkSyntax(cm.text) && /-- 触れたとき/.test(cm.text), cm.text)
const ty = addTypes(sample)
ok('types', /onTouched\(hit: BasePart\)/.test(ty.text) && /function\(player: Player\)/.test(ty.text) && /add\(a: number, b: number\): number/.test(ty.text), ty.text)
ok('types parse', !checkSyntax(ty.text))

// ---- 生成 ----
const gens = [
  ['触れたら死ぬブロックを作って', 'studio', o => o.spec.trigger === 'touch' && o.spec.actions.includes('kill')],
  ['クリックすると色が赤に変わるパーツ', 'studio', o => o.spec.trigger === 'click' && /255, 60, 60/.test(o.files[0].code)],
  ['Eキーでドアが開く', 'studio', o => o.spec.trigger === 'prompt' && o.spec.actions.includes('openDoor')],
  ['Shiftを押している間だけ速く走る', 'studio', o => o.spec.trigger === 'key' && /LeftShift/.test(o.files[0].code) && /InputEnded/.test(o.files[0].code)],
  ['触れるとコインが10増えて消える', 'studio', o => /addStat\(player, "Coins", 10\)/.test(o.files[0].code)],
  ['Eキーを押したら30ダメージ', 'studio', o => o.files.length === 2 && /FireServer/.test(o.files.map(f => f.code).join(''))],
  ['データを保存するリーダーボード', 'studio', o => o.spec.id === 'datastore'],
  ['ショップのUIを作って', 'studio', o => o.spec.id === 'shop' && o.files.length === 2],
  ['追いかけてくる敵', 'studio', o => o.spec.id === 'npc'],
  ['ボタンを押すとスピードが2倍', 'studio', o => /WalkSpeed = 32/.test(o.files[0].code)],
  ['スピードを100にして', 'executor', o => /WalkSpeed = 100/.test(o.files[0].code) && !/server/.test(o.files[0].name)],
  ['ESPを作って', 'executor', o => o.spec.id === 'esp'],
  ['参加したらようこそと表示', 'studio', o => o.spec.trigger === 'start'],
  ['3秒ごとにパーツが降ってくる', 'studio', o => o.spec.trigger === 'timer' && /INTERVAL = 3/.test(o.files[0].code)],
]
for (const [req, mode, check] of gens) {
  const o = generateCode(req, { mode })
  ok('gen: ' + req, o && check(o), o ? o.title + ' ' + JSON.stringify(o.spec) : 'null')
  if (o) for (const f of o.files) ok('gen parses: ' + req + ' ' + f.name, !f.error && !checkSyntax(f.code), f.error)
}
eq('gen unknown', generateCode('量子コンピューターのシミュレーター', { mode: 'studio' }), null)
// 生成したコードはエディタのチェックでもエラーなし
for (const req of ['触れたらダメージ', 'ショップのUIを作って', 'Fキーで飛ぶ', '壁抜け', '無限ジャンプ', 'ドラッグできるメニュー']) {
  const o = generateCode(req, { mode: /飛ぶ|壁抜け|無限|メニュー/.test(req) ? 'executor' : 'studio' })
  if (!o) { ok('gen ' + req, false); continue }
  for (const f of o.files) {
    const errs = lintLuau(f.code, { executor: /\.lua$/.test(f.name) && !/server|client/.test(f.name), typos: true, undefinedGlobals: true }).filter(d => d.severity === 'error')
    ok('gen lint clean: ' + f.name, !errs.length, errs.map(e => e.message).join(' / '))
  }
}

// ---- 会話の振り分け (エンジン) ----
const files = new Map([['main.lua', 'local x = 1\nif x != 2 then\n\tprint(x)\nend\n']])
let active = 'main.lua'
const host = {
  mode: 'studio', hasProject: true,
  files: () => [...files.keys()].map(path => ({ path })),
  active: () => ({ path: active, text: files.get(active), from: 0, to: 0 }),
  read: async p => files.get(p),
  write: async (p, t) => { files.set(p, t) },
  create: async (p, t) => { files.set(p, t) },
  lintOpts: () => ({ typos: true, undefinedGlobals: true, unused: false }),
  problems: (p, t) => lintLuau(t, { typos: true }).map(d => ({ line: t.slice(0, d.from).split('\n').length, severity: d.severity, message: d.message })),
  lastErrors: () => [],
  llm: null,
}
const memory = {}
const ask = async t => respond({ text: t, host, memory })
let r = await ask('直して')
ok('engine fix', /~= 2/.test(files.get('main.lua')) && /直しました/.test(r.text), r.text)
r = await ask('説明して')
ok('engine explain', /### 概要/.test(r.text))
r = await ask('触れたら20ダメージを与えるブロックを作って')
ok('engine generate file', files.has('DamagePart.server.lua') && /TakeDamage\(20\)/.test(files.get('DamagePart.server.lua')), [...files.keys()].join())
r = await ask('ダメージを50にして')
ok('engine follow-up', /TakeDamage\(50\)/.test(files.get('DamagePart.server.lua')) && !files.has('DamagePart2.server.lua'), r.text.slice(0, 200))
r = await ask('TweenServiceとは')
ok('engine question api', /TweenService/.test(r.text) && /なめらか/.test(r.text))
r = await ask('こんにちは')
ok('engine greet', /Forge AI/.test(r.text))
r = await ask('```lua\nif a != b then print(1) end\n```\nこれ直して')
ok('engine pasted fix', /~=/.test(r.text))
r = await ask('ほげふがぴよ')
ok('engine unknown', /理解できませんでした/.test(r.text))
active = 'DamagePart.server.lua'
r = await ask('コメントを追加して')
ok('engine comments', /コメントを追加しました/.test(r.text) && !checkSyntax(files.get(active)), r.text)
eq('knowledge search', searchKnowledge('データを保存する方法', 'studio')[0].id, 'datastore')

// ---- 高性能モード (端末内 LLM) の呼び出し: 模擬モデルで確認 ----
const llmCalls = []
host.llm = { ready: () => true, generate: async (messages, opts) => { llmCalls.push(messages); if (opts.onText) opts.onText('…'); return 'こう書きます:\n```lua\nif a != b then\n\twait(1)\nend\n```' } }
r = await ask('量子コンピューターのシミュレーターを作って')
ok('llm used for unknown generate', llmCalls.length === 1 && /~=/.test(r.text) && /task\.wait\(1\)/.test(r.text) && /チェック/.test(r.text), r.text)
ok('llm gets system rules + context', llmCalls[0][0].role === 'system' && /Luau/.test(llmCalls[0][0].content) && /Request:/.test(llmCalls[0][llmCalls[0].length - 1].content))
r = await ask('ほげふがぴよ')
ok('llm used for unknown chat', llmCalls.length === 2)
r = await ask('触れたら死ぬブロックを作って')
ok('llm not used when built-in can answer', llmCalls.length === 2)
host.llm = { ready: () => true, generate: async () => { throw new Error('GPU lost') } }
r = await ask('ほげふがぴよ')
ok('llm failure falls back', /理解できませんでした/.test(r.text) && /GPU lost/.test(r.text), r.text)
host.llm = null

// ---- 最適化・LLM の検証 ----
const hs = hoistServices('local function f()\n\tlocal p = game:GetService("Players")\n\treturn p\nend\nwhile true do\n\tgame:GetService("RunService").Heartbeat:Wait()\nend\n')
ok('hoist services', hs.count === 2 && /^local Players = game:GetService\("Players"\)/m.test(hs.text) && /RunService\.Heartbeat/.test(hs.text) && !checkSyntax(hs.text), hs.text)
const v = verifyLlmCode('こうします\n```lua\nif x != 1 then\nwait(1)\nend\n```', {})
ok('verify llm code', /~= 1/.test(v.text) && /task\.wait\(1\)/.test(v.text) && v.notes.length > 0, v.text)

// ---- 続きの提案 ----
setProjectCorpus(['local myRemote = game.ReplicatedStorage:WaitForChild("MyRemote")\nmyRemote:FireServer("hello")\nmyRemote:FireServer("hello")\n'])
eq('complete service', completeLine('local Players = game:Get'), 'Service(')
eq('complete localplayer', completeLine('local player = Players.Loc'), 'alPlayer')
eq('complete character', completeLine('local character = player.Character or '), 'player.CharacterAdded:Wait()')
eq('complete project word', completeLine('myRemote:Fi'), 'reServer("hello")')
eq('complete nothing in comment', completeLine('-- local x = game:Get'), '')
eq('complete no = in if', /=/.test(completeLine('if not humanoid ').replace(/[~=<>]=/g, '')), false)
const cc = codeFromComment('-- 触れたら死ぬ\n', 'studio')
ok('comment to code', cc && /Health = 0/.test(cc.code) && !checkSyntax(cc.code), cc && cc.code)
eq('comment to code: not a request', codeFromComment('-- hello\n', 'studio'), null)

console.log(`ai: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
