// Forge AI: コード生成
// 依頼文を「きっかけ (触れたら・クリック・キー・ボタン・チャット・時間ごと・参加したら)」と
// 「動作 (倒す・ダメージ・回復・速さ・ジャンプ・テレポート・色・消える・コイン・音・爆発 …)」に分けて組み立てます。
// どちらにも当てはまらない、まとまった仕組み (データ保存・ショップ・ラウンド・NPC・ESP など) は「レシピ」から作ります。
// 数値・秒数・キー・色・名前は依頼文から取り出して使います。生成したコードは必ず構文チェックを通します。
import { concepts as conceptsOf, slots as slotsOf, normalize, CONCEPTS } from './text.js'
import { checkSyntax } from '../luau/parser.js'

const T = n => '\t'.repeat(n)
const ind = (lines, n) => lines.map(l => (l ? T(n) + l : l))
const q = s => JSON.stringify(String(s))
const ident = (s, d) => {
  const t = String(s || '').replace(/[^\w]/g, '')
  return /^[A-Za-z_]/.test(t) ? t : d
}
const rgb = c => (c && c.rgb ? `Color3.fromRGB(${c.rgb.join(', ')})` : 'Color3.fromRGB(255, 80, 80)')

// ============================================================
// 値の取り出し
// ============================================================
function numberFor(sl, text, words, def, { allowSeconds = false } = {}) {
  const n = normalize(text)
  // 「ダメージ 30」「30 ダメージ」「速さを 50」のように、語の近くの数
  for (const w of words) {
    const at = n.indexOf(normalize(w))
    if (at < 0) continue
    let best = null
    for (const x of sl.numbers) {
      if (!allowSeconds && /^(秒|びょう|s|sec|分|ふん|回|かい)$/.test(x.unit)) continue
      if (/^(倍|ばい|%|パーセント)$/.test(x.unit)) continue
      const d = Math.abs(x.at - at)
      if (d < 14 && (!best || d < best.d)) best = { v: x.v, d }
    }
    if (best) return best.v
  }
  return def
}
const plainNumbers = sl => sl.numbers.filter(x => !/^(秒|びょう|s|sec|分|ふん|回|かい|倍|ばい|%|パーセント)$/.test(x.unit))

// ============================================================
// 動作
// ============================================================
// code(p, v): v = { humanoid, character, player, root, part } (使える変数の名前) → 行の配列
// side: 'server' (サーバーでないと他の人に反映されない) | 'any'
const ACTIONS = [
  {
    id: 'kill', c: ['kill'], title: '倒す', side: 'server', needs: 'humanoid',
    params: () => ({}),
    code: (p, v) => [`${v.humanoid}.Health = 0 -- 倒す`],
  },
  {
    id: 'damage', c: ['damage'], title: 'ダメージを与える', side: 'server', needs: 'humanoid',
    params: (sl, t) => ({ amount: numberFor(sl, t, ['ダメージ', 'damage', '減ら'], (plainNumbers(sl)[0] || {}).v || 20) }),
    code: (p, v) => [`${v.humanoid}:TakeDamage(${p.amount}) -- ${p.amount} ダメージ`],
  },
  {
    id: 'heal', c: ['heal'], title: '回復する', side: 'server', needs: 'humanoid',
    params: (sl, t) => ({ amount: numberFor(sl, t, ['回復', 'heal', 'ヒール'], (plainNumbers(sl)[0] || {}).v || 25) }),
    code: (p, v) => [`${v.humanoid}.Health = math.min(${v.humanoid}.MaxHealth, ${v.humanoid}.Health + ${p.amount}) -- ${p.amount} 回復`],
  },
  {
    id: 'speed', c: ['speed', 'sprint'], title: '歩く速さを変える', side: 'any', needs: 'humanoid',
    params: (sl, t, ctx) => {
      const m = sl.multiplier
      const v = numberFor(sl, t, ['速さ', '速度', 'スピード', 'speed', 'walkspeed'], (plainNumbers(sl)[0] || {}).v || null)
      const value = v || (m ? Math.round(16 * m) : ctx.mode === 'executor' ? 50 : 32)
      return { value, duration: sl.seconds, hold: /(押している間|押してる間|押したまま|ホールド|hold|離したら|はなしたら)/.test(normalize(t)) || ctx.concepts.has('sprint') }
    },
    code: (p, v) => p.duration && !p.hold
      ? [`local oldSpeed = ${v.humanoid}.WalkSpeed`, `${v.humanoid}.WalkSpeed = ${p.value} -- 速くする`, `task.delay(${p.duration}, function()`, `\tif ${v.humanoid}.Parent then ${v.humanoid}.WalkSpeed = oldSpeed end -- ${p.duration} 秒後に戻す`, 'end)']
      : [`${v.humanoid}.WalkSpeed = ${p.value} -- 歩く速さ (標準は 16)`],
    undo: (p, v) => [`${v.humanoid}.WalkSpeed = 16 -- 元の速さに戻す`],
  },
  {
    id: 'jump', c: ['jump'], title: 'ジャンプ力を変える', side: 'any', needs: 'humanoid',
    params: (sl, t, ctx) => ({ value: numberFor(sl, t, ['ジャンプ', 'jump', '跳'], (plainNumbers(sl)[0] || {}).v || (ctx.mode === 'executor' ? 100 : 80)), duration: sl.seconds }),
    code: (p, v) => [`${v.humanoid}.UseJumpPower = true`, `${v.humanoid}.JumpPower = ${p.value} -- ジャンプ力 (標準は 50)`].concat(p.duration ? [`task.delay(${p.duration}, function()`, `\tif ${v.humanoid}.Parent then ${v.humanoid}.JumpPower = 50 end`, 'end)'] : []),
    undo: (p, v) => [`${v.humanoid}.JumpPower = 50 -- 元に戻す`],
  },
  {
    id: 'fling', c: ['physics'], title: '上に吹き飛ばす', side: 'any', needs: 'root', match: /(吹き飛|ふきと|飛ばす|ノックバック|knockback|ジャンプ台|ジャンプパッド|jump ?pad|トランポリン|跳ね)/,
    params: (sl, t) => ({ power: numberFor(sl, t, ['力', '強さ', '高さ', 'power'], 100) }),
    code: (p, v) => [`${v.root}.AssemblyLinearVelocity = Vector3.new(0, ${p.power}, 0) -- 上に飛ばす`],
  },
  {
    id: 'teleport', c: ['teleport'], title: 'テレポートする', side: 'any', needs: 'character',
    params: sl => {
      const nums = plainNumbers(sl)
      return { target: sl.quoted[0] || null, pos: nums.length >= 3 ? nums.slice(0, 3).map(x => x.v) : null }
    },
    code: (p, v) => p.target
      ? [`local target = workspace:FindFirstChild(${q(p.target)}, true)`, 'if target then', `\t${v.character}:PivotTo(target.CFrame + Vector3.new(0, 4, 0)) -- ${p.target} の上へ`, 'end']
      : p.pos ? [`${v.character}:PivotTo(CFrame.new(${p.pos.join(', ')})) -- (${p.pos.join(', ')}) へ`]
        : ['local target = workspace:FindFirstChild("TeleportTarget") -- 行き先のパーツ (名前を TeleportTarget に)', 'if target then', `\t${v.character}:PivotTo(target.CFrame + Vector3.new(0, 4, 0))`, 'else', `\t${v.character}:PivotTo(CFrame.new(0, 50, 0))`, 'end'],
  },
  {
    id: 'color', c: ['color'], title: '色を変える', side: 'server', needs: 'part',
    params: sl => ({ color: sl.colors[0] || { rainbow: true } }),
    code: (p, v) => p.color.rainbow ? [`${v.part}.Color = Color3.fromHSV(math.random(), 0.8, 1) -- ランダムな色`] : [`${v.part}.Color = ${rgb(p.color)} -- ${p.color.name}`],
  },
  {
    id: 'disappear', c: ['disappear', 'destroy'], title: '消える', side: 'server', needs: 'part',
    params: (sl, t) => ({ respawn: /(戻|復活|再出現|また出|リスポーン)/.test(normalize(t)) || !!sl.seconds ? (sl.seconds || 3) : null, destroy: /(削除|壊|destroy)/.test(normalize(t)) }),
    code: (p, v) => p.destroy ? [`${v.part}:Destroy() -- 削除`]
      : [`${v.part}.Transparency = 1 -- 見えなくする`, `${v.part}.CanCollide = false`, `${v.part}.CanTouch = false`].concat(p.respawn ? [`task.delay(${p.respawn}, function() -- ${p.respawn} 秒後に戻す`, `\t${v.part}.Transparency = 0`, `\t${v.part}.CanCollide = true`, `\t${v.part}.CanTouch = true`, 'end)'] : []),
  },
  {
    id: 'coins', c: ['coin', 'points'], title: 'コインを増やす', side: 'server', needs: 'player', helper: 'coins',
    params: (sl, t, ctx) => ({ amount: numberFor(sl, t, ['コイン', 'coin', 'お金', 'ポイント', 'point', 'スコア'], (plainNumbers(sl)[0] || {}).v || 1), stat: ctx.concepts.has('points') && !ctx.concepts.has('coin') ? 'Points' : 'Coins' }),
    code: (p, v) => [`addStat(${v.player}, ${q(p.stat)}, ${p.amount}) -- ${p.stat} を ${p.amount} 増やす`],
  },
  {
    id: 'sound', c: ['sound'], title: '音を鳴らす', side: 'any', needs: null,
    params: sl => ({ id: (sl.numbers.find(x => x.v > 100000) || {}).v || 9118823100 }),
    code: (p, v) => [`local sound = Instance.new("Sound")`, `sound.SoundId = "rbxassetid://${p.id}" -- 鳴らしたい音の ID`, `sound.Parent = ${v.part || 'workspace'}`, 'sound:Play()', 'game:GetService("Debris"):AddItem(sound, 10)'],
  },
  {
    id: 'explode', c: ['explode'], title: '爆発させる', side: 'server', needs: null,
    params: (sl, t) => ({ radius: numberFor(sl, t, ['範囲', '半径', '大きさ', 'radius'], 8) }),
    code: (p, v) => ['local explosion = Instance.new("Explosion")', `explosion.Position = ${v.part ? v.part + '.Position' : v.root ? v.root + '.Position' : 'Vector3.new(0, 5, 0)'}`, `explosion.BlastRadius = ${p.radius}`, 'explosion.Parent = workspace'],
  },
  {
    id: 'message', c: ['message'], title: 'メッセージを表示する', side: 'any', needs: null,
    params: (sl, t) => ({ text: sl.quoted[0] || (/(ようこそ|welcome)/.test(normalize(t)) ? 'ようこそ!' : 'こんにちは!') }),
    code: (p, v, ctx) => ctx.side === 'client'
      ? ['pcall(function()', '\tgame:GetService("StarterGui"):SetCore("SendNotification", {', '\t\tTitle = "お知らせ",', `\t\tText = ${q(p.text)},`, '\t\tDuration = 5,', '\t})', 'end)']
      : [`print(${v.player ? `${v.player}.Name .. " さん: " .. ` : ''}${q(p.text)})`],
  },
  {
    id: 'spawnPart', c: ['spawnPart'], title: 'パーツを出す', side: 'server', needs: null,
    params: (sl, t) => ({ size: numberFor(sl, t, ['大きさ', 'サイズ', 'size'], 2), life: sl.seconds && sl.seconds > 1 ? Math.max(5, sl.seconds * 3) : 8, color: sl.colors[0] || null }),
    code: (p, v) => [
      'local newPart = Instance.new("Part")',
      `newPart.Size = Vector3.new(${p.size}, ${p.size}, ${p.size})`,
      `newPart.Position = ${v.root ? `${v.root}.Position + Vector3.new(0, 15, 0)` : 'Vector3.new(math.random(-40, 40), 60, math.random(-40, 40)) -- 空のランダムな位置'}`,
      p.color ? `newPart.Color = ${rgb(p.color)}` : 'newPart.Color = Color3.fromHSV(math.random(), 0.7, 1)',
      'newPart.Material = Enum.Material.SmoothPlastic',
      'newPart.Parent = workspace',
      `game:GetService("Debris"):AddItem(newPart, ${p.life}) -- ${p.life} 秒後に自動で消す`,
    ],
  },
  {
    id: 'light', c: ['light'], title: 'ライトを切り替える', side: 'server', needs: 'part',
    params: () => ({}),
    code: (p, v) => [`local light = ${v.part}:FindFirstChildOfClass("PointLight")`, 'if not light then', '\tlight = Instance.new("PointLight")', '\tlight.Range = 16', `\tlight.Parent = ${v.part}`, 'end', 'light.Enabled = not light.Enabled -- オン / オフ'],
  },
  {
    id: 'giveTool', c: ['tool', 'give'], title: 'ツールを渡す', side: 'server', needs: 'player', match: /(ツール|tool|剣|sword|武器|weapon|アイテム)/,
    params: sl => ({ name: sl.quoted[0] || 'Sword' }),
    code: (p, v) => [`local tool = game:GetService("ServerStorage"):FindFirstChild(${q(p.name)}) -- ServerStorage に置いたツール`, `if tool and not ${v.player}.Backpack:FindFirstChild(${q(p.name)}) then`, `\ttool:Clone().Parent = ${v.player}.Backpack`, 'end'],
  },
  {
    id: 'checkpoint', c: ['checkpoint'], title: 'チェックポイントにする', side: 'server', needs: 'player', triggers: ['touch'],
    params: () => ({}),
    code: (p, v) => [`${v.player}.RespawnLocation = ${v.part} -- 次はここから出現 (このパーツは SpawnLocation に)`],
  },
  {
    id: 'openDoor', c: ['door'], title: 'ドアを開ける', side: 'server', needs: 'part', defaultTrigger: 'prompt',
    params: (sl, t) => ({ seconds: sl.seconds || 3, mode: /(回転|開き戸|ひらく|swing)/.test(normalize(t)) ? 'swing' : 'slide' }),
    code: (p, v) => ['if doorOpen then return end', 'doorOpen = true', 'openTween:Play()', `task.wait(${p.seconds}) -- ${p.seconds} 秒後に閉じる`, 'closeTween:Play()', 'closeTween.Completed:Wait()', 'doorOpen = false'],
    setup: (p, v) => ['local TweenService = game:GetService("TweenService")', `local closedCFrame = ${v.part}.CFrame`, p.mode === 'swing' ? `local openCFrame = closedCFrame * CFrame.new(-${v.part}.Size.X / 2, 0, 0) * CFrame.Angles(0, math.rad(90), 0) * CFrame.new(${v.part}.Size.X / 2, 0, 0)` : `local openCFrame = closedCFrame + Vector3.new(0, ${v.part}.Size.Y + 0.5, 0) -- 上にスライド`, 'local info = TweenInfo.new(0.8, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)', `local openTween = TweenService:Create(${v.part}, info, { CFrame = openCFrame })`, `local closeTween = TweenService:Create(${v.part}, info, { CFrame = closedCFrame })`, 'local doorOpen = false', `${v.part}.Anchored = true`],
  },
]

// 動作の補助関数 (leaderstats がなければ作る)
const HELPERS = {
  coins: ['-- leaderstats (画面右上の表示) に値を足す。なければ作る', 'local function addStat(player, statName, amount)', '\tlocal leaderstats = player:FindFirstChild("leaderstats")', '\tif not leaderstats then', '\t\tleaderstats = Instance.new("Folder")', '\t\tleaderstats.Name = "leaderstats"', '\t\tleaderstats.Parent = player', '\tend', '\tlocal stat = leaderstats:FindFirstChild(statName)', '\tif not stat then', '\t\tstat = Instance.new("IntValue")', '\t\tstat.Name = statName', '\t\tstat.Parent = leaderstats', '\tend', '\tstat.Value += amount', 'end'],
}

// ============================================================
// きっかけ
// ============================================================
// build(actions, p) → { side, header: [], body: [...] }  body には {ACTIONS} を入れる
const TRIGGERS = {
  touch: {
    title: '触れたとき', side: 'server', place: 'パーツの中に Script として入れてください',
    vars: { part: 'part', character: 'character', humanoid: 'humanoid', player: 'player', root: 'root' },
    build: (inner, p) => ({
      header: ['local Players = game:GetService("Players")', '', 'local part = script.Parent', `local COOLDOWN = ${p.cooldown} -- 同じ人に連続で効かないようにする秒数`, 'local cooldowns = {}'],
      body: ['part.Touched:Connect(function(hit)', '\tlocal character = hit.Parent', '\tlocal humanoid = character and character:FindFirstChildOfClass("Humanoid")', '\tif not humanoid or humanoid.Health <= 0 or cooldowns[character] then', '\t\treturn', '\tend', '\tcooldowns[character] = true', '\tlocal player = Players:GetPlayerFromCharacter(character)', '\tlocal root = character:FindFirstChild("HumanoidRootPart")', '', ...ind(inner, 1), '', '\ttask.wait(COOLDOWN)', '\tcooldowns[character] = nil', 'end)'],
    }),
  },
  click: {
    title: 'クリックしたとき', side: 'server', place: 'パーツの中に Script として入れてください (ClickDetector は自動で作ります)',
    vars: { part: 'part', character: 'character', humanoid: 'humanoid', player: 'player', root: 'root' },
    build: inner => ({
      header: ['local part = script.Parent', 'local detector = part:FindFirstChildOfClass("ClickDetector") or Instance.new("ClickDetector")', 'detector.MaxActivationDistance = 32', 'detector.Parent = part'],
      body: ['detector.MouseClick:Connect(function(player)', '\tlocal character = player.Character', '\tlocal humanoid = character and character:FindFirstChildOfClass("Humanoid")', '\tlocal root = character and character:FindFirstChild("HumanoidRootPart")', '\tif not humanoid or not root then', '\t\treturn', '\tend', '', ...ind(inner, 1), 'end)'],
    }),
  },
  prompt: {
    title: '近づいて E キー (ProximityPrompt)', side: 'server', place: 'パーツの中に Script として入れてください (ProximityPrompt は自動で作ります)',
    vars: { part: 'part', character: 'character', humanoid: 'humanoid', player: 'player', root: 'root' },
    build: (inner, p) => ({
      header: ['local part = script.Parent', 'local prompt = part:FindFirstChildOfClass("ProximityPrompt") or Instance.new("ProximityPrompt")', `prompt.ActionText = ${q(p.actionText)}`, `prompt.KeyboardKeyCode = Enum.KeyCode.${p.key || 'E'}`, 'prompt.HoldDuration = 0', 'prompt.Parent = part'],
      body: ['prompt.Triggered:Connect(function(player)', '\tlocal character = player.Character', '\tlocal humanoid = character and character:FindFirstChildOfClass("Humanoid")', '\tlocal root = character and character:FindFirstChild("HumanoidRootPart")', '\tif not humanoid or not root then', '\t\treturn', '\tend', '', ...ind(inner, 1), 'end)'],
    }),
  },
  chat: {
    title: 'チャットのコマンド', side: 'server', place: 'ServerScriptService に Script として入れてください',
    vars: { character: 'character', humanoid: 'humanoid', player: 'player', root: 'root' },
    build: (inner, p) => ({
      header: ['local Players = game:GetService("Players")', `local COMMAND = ${q(p.command)} -- チャットにこう打つと実行`],
      body: ['Players.PlayerAdded:Connect(function(player)', '\tplayer.Chatted:Connect(function(message)', '\t\tif message:lower() ~= COMMAND then', '\t\t\treturn', '\t\tend', '\t\tlocal character = player.Character', '\t\tlocal humanoid = character and character:FindFirstChildOfClass("Humanoid")', '\t\tlocal root = character and character:FindFirstChild("HumanoidRootPart")', '\t\tif not humanoid or not root then', '\t\t\treturn', '\t\tend', '', ...ind(inner, 2), '\tend)', 'end)'],
    }),
  },
  timer: {
    title: '一定時間ごと', side: 'server', place: 'ServerScriptService に Script として入れてください',
    vars: { character: 'character', humanoid: 'humanoid', player: 'player', root: 'root' },
    build: (inner, p, acts) => {
      const perPlayer = acts.some(a => a.needs === 'humanoid' || a.needs === 'player' || a.needs === 'character' || a.needs === 'root')
      const partActs = acts.some(a => a.needs === 'part')
      return {
        header: ['local Players = game:GetService("Players")', `local INTERVAL = ${p.interval} -- 何秒ごとに実行するか`].concat(partActs ? ['local part = workspace:WaitForChild(' + q(p.partName) + ') -- 対象のパーツの名前'] : []),
        body: ['while true do', '\ttask.wait(INTERVAL)', ...(perPlayer ? ['\tfor _, player in Players:GetPlayers() do', '\t\tlocal character = player.Character', '\t\tlocal humanoid = character and character:FindFirstChildOfClass("Humanoid")', '\t\tlocal root = character and character:FindFirstChild("HumanoidRootPart")', '\t\tif humanoid and root and humanoid.Health > 0 then', ...ind(inner, 3), '\t\tend', '\tend'] : ind(inner, 1)), 'end'],
      }
    },
    varsFor: acts => (acts.some(a => a.needs === 'part') ? { part: 'part', character: 'character', humanoid: 'humanoid', player: 'player', root: 'root' } : null),
  },
  join: {
    title: '参加・出現したとき', side: 'server', place: 'ServerScriptService に Script として入れてください',
    vars: { character: 'character', humanoid: 'humanoid', player: 'player', root: 'root' },
    build: inner => ({
      header: ['local Players = game:GetService("Players")'],
      body: ['Players.PlayerAdded:Connect(function(player)', '\tplayer.CharacterAdded:Connect(function(character)', '\t\tlocal humanoid = character:WaitForChild("Humanoid")', '\t\tlocal root = character:WaitForChild("HumanoidRootPart")', '', ...ind(inner, 2), '\tend)', 'end)'],
    }),
  },
  key: {
    title: 'キーを押したとき', side: 'client', place: 'StarterPlayer → StarterPlayerScripts に LocalScript として入れてください',
    vars: { character: 'character', humanoid: 'humanoid', player: 'player', root: 'root' },
    build: (inner, p, acts, undo) => ({
      header: ['local Players = game:GetService("Players")', 'local UserInputService = game:GetService("UserInputService")', '', 'local player = Players.LocalPlayer', `local KEY = Enum.KeyCode.${p.key} -- 使うキー`],
      body: [
        'local function getCharacter()',
        '\tlocal character = player.Character',
        '\tlocal humanoid = character and character:FindFirstChildOfClass("Humanoid")',
        '\tlocal root = character and character:FindFirstChild("HumanoidRootPart")',
        '\treturn character, humanoid, root',
        'end',
        '',
        'UserInputService.InputBegan:Connect(function(input, gameProcessed)',
        '\tif gameProcessed or input.KeyCode ~= KEY then',
        '\t\treturn -- チャット入力中や、別のキーは無視',
        '\tend',
        '\tlocal character, humanoid, root = getCharacter()',
        '\tif not humanoid then',
        '\t\treturn',
        '\tend',
        ...ind(inner, 1),
        'end)',
      ].concat(undo ? ['', 'UserInputService.InputEnded:Connect(function(input)', '\tif input.KeyCode ~= KEY then', '\t\treturn', '\tend', '\tlocal character, humanoid, root = getCharacter()', '\tif not humanoid then', '\t\treturn', '\tend', ...ind(undo, 1), 'end)'] : []),
    }),
  },
  button: {
    title: '画面のボタンを押したとき', side: 'client', place: 'StarterGui または StarterPlayerScripts に LocalScript として入れてください (ボタンは自動で作ります)',
    vars: { character: 'character', humanoid: 'humanoid', player: 'player', root: 'root' },
    build: (inner, p, acts, undo) => ({
      header: ['local Players = game:GetService("Players")', '', 'local player = Players.LocalPlayer', ''].concat(p.executor ? ['local guiParent = (gethui and gethui()) or game:GetService("CoreGui")'] : ['local guiParent = player:WaitForChild("PlayerGui")'], [
        '',
        '-- ボタンを作る (スマホでも押しやすい大きさ)',
        'local gui = Instance.new("ScreenGui")',
        `gui.Name = ${q(p.guiName)}`,
        'gui.ResetOnSpawn = false',
        '',
        'local button = Instance.new("TextButton")',
        'button.AnchorPoint = Vector2.new(1, 1)',
        'button.Position = UDim2.new(1, -20, 1, -100)',
        'button.Size = UDim2.fromOffset(160, 52)',
        'button.BackgroundColor3 = Color3.fromRGB(40, 120, 255)',
        'button.TextColor3 = Color3.new(1, 1, 1)',
        'button.Font = Enum.Font.GothamBold',
        'button.TextSize = 18',
        `button.Text = ${q(p.label)}`,
        'button.Parent = gui',
        'Instance.new("UICorner").Parent = button',
        '',
        'gui.Parent = guiParent',
      ]),
      body: [
        'local function getCharacter()',
        '\tlocal character = player.Character',
        '\tlocal humanoid = character and character:FindFirstChildOfClass("Humanoid")',
        '\tlocal root = character and character:FindFirstChild("HumanoidRootPart")',
        '\treturn character, humanoid, root',
        'end',
        '',
      ].concat(undo ? ['local enabled = false', 'button.Activated:Connect(function()', '\tlocal character, humanoid, root = getCharacter()', '\tif not humanoid then', '\t\treturn', '\tend', '\tenabled = not enabled', '\tif enabled then', ...ind(inner, 2), `\t\tbutton.Text = ${q(p.label + ': ON')}`, '\telse', ...ind(undo, 2), `\t\tbutton.Text = ${q(p.label + ': OFF')}`, '\tend', 'end)'] : ['button.Activated:Connect(function()', '\tlocal character, humanoid, root = getCharacter()', '\tif not humanoid then', '\t\treturn', '\tend', ...ind(inner, 1), 'end)']),
    }),
  },
  start: {
    title: '参加したとき (その人の画面)', side: 'client', place: 'StarterPlayer → StarterPlayerScripts に LocalScript として入れてください',
    vars: { player: 'player' },
    build: inner => ({
      header: ['local Players = game:GetService("Players")', 'local player = Players.LocalPlayer'],
      body: ['task.wait(2) -- 画面の準備ができるまで少し待つ', ...inner],
    }),
  },
  now: {
    title: '実行したとき (自分のキャラクター)', side: 'client', place: 'エグゼキューターで実行してください',
    vars: { character: 'character', humanoid: 'humanoid', player: 'player', root: 'root' },
    build: (inner, p) => ({
      header: ['local Players = game:GetService("Players")', 'local player = Players.LocalPlayer'],
      body: ['local function apply(character)', '\tlocal humanoid = character:WaitForChild("Humanoid")', '\tlocal root = character:WaitForChild("HumanoidRootPart")', ...ind(inner, 1), 'end', '', 'if player.Character then', '\tapply(player.Character)', 'end', p.keep ? 'player.CharacterAdded:Connect(apply) -- 復活しても効くように' : ''].filter(l => l !== ''),
    }),
  },
}

const TRIGGER_CONCEPTS = [['touch', 'touch'], ['click', 'click'], ['prompt', 'prompt'], ['button', 'button'], ['key', 'key'], ['chat', 'chat'], ['timer', 'timer'], ['join', 'join'], ['join', 'spawnEv']]

// ============================================================
// レシピ (まとまった仕組み)
// ============================================================
// score(ctx): 当てはまり具合 (0 で対象外)。build(ctx) → { files: [{ name, code }], title, summary }
const RECIPES = []
const R = r => RECIPES.push(r)
const has = (ctx, ...ids) => ids.filter(id => ctx.concepts.has(id)).length

R({
  id: 'datastore', title: 'データの保存 (leaderstats + DataStore)', mode: 'studio',
  score: ctx => (has(ctx, 'datastore') ? 3 : 0) + (has(ctx, 'datastore') && has(ctx, 'leaderstats', 'coin', 'points') ? 2 : 0),
  build: ctx => {
    const stat = ctx.concepts.has('points') && !ctx.concepts.has('coin') ? 'Points' : 'Coins'
    return {
      files: [{ name: 'PlayerData.server.lua', code: `-- プレイヤーのデータ (${stat}) を保存・読み込みします
-- ServerScriptService に Script として入れてください
-- Studio で試すには「ゲーム設定 → セキュリティ → API サービスへの Studio アクセスを有効にする」をオンに
local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")

local store = DataStoreService:GetDataStore("PlayerData_v1")
local DEFAULT = { ${stat} = 0 }

local function keyOf(player)
	return "Player_" .. player.UserId
end

local function load(player)
	local ok, data = pcall(function()
		return store:GetAsync(keyOf(player))
	end)
	if not ok then
		warn("読み込みに失敗しました:", data)
		return table.clone(DEFAULT), false
	end
	return data or table.clone(DEFAULT), true
end

local function save(player)
	local leaderstats = player:FindFirstChild("leaderstats")
	if not leaderstats or not player:GetAttribute("DataLoaded") then
		return -- 読み込めていないデータで上書きしない
	end
	local data = { ${stat} = leaderstats.${stat}.Value }
	local ok, err = pcall(function()
		store:SetAsync(keyOf(player), data)
	end)
	if not ok then
		warn("保存に失敗しました:", err)
	end
end

Players.PlayerAdded:Connect(function(player)
	local data, loaded = load(player)

	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"

	local stat = Instance.new("IntValue")
	stat.Name = "${stat}"
	stat.Value = data.${stat} or 0
	stat.Parent = leaderstats

	leaderstats.Parent = player
	player:SetAttribute("DataLoaded", loaded)
end)

Players.PlayerRemoving:Connect(save)

-- サーバーが閉じるときも全員分を保存
game:BindToClose(function()
	for _, player in Players:GetPlayers() do
		save(player)
	end
end)

-- 自動保存 (5 分ごと)
task.spawn(function()
	while true do
		task.wait(300)
		for _, player in Players:GetPlayers() do
			save(player)
		end
	end
end)
` }],
      summary: [`参加したときに ${stat} を読み込み、退出・サーバー終了・5 分ごとに保存します`, '読み込みに失敗したときは、データを上書きしないようにしています (データ消失の防止)', `${stat} を増やすには、サーバーのスクリプトで \`player.leaderstats.${stat}.Value += 1\``],
    }
  },
})
R({
  id: 'leaderstats', title: 'リーダーボード (leaderstats)', mode: 'studio',
  score: ctx => (has(ctx, 'leaderstats') ? 3 : 0) + (has(ctx, 'leaderstats') && has(ctx, 'coin', 'points') ? 1 : 0) - (has(ctx, 'datastore') ? 3 : 0) - (has(ctx, 'touch', 'click', 'prompt', 'timer', 'chat') ? 2 : 0),
  build: ctx => {
    const names = []
    if (ctx.concepts.has('coin')) names.push('Coins')
    if (ctx.concepts.has('points') || !names.length) names.push(/キル|kill/i.test(ctx.text) ? 'Kills' : 'Points')
    return {
      files: [{ name: 'Leaderstats.server.lua', code: `-- 画面右上のリーダーボードに ${names.join('・')} を表示します
-- ServerScriptService に Script として入れてください
local Players = game:GetService("Players")

Players.PlayerAdded:Connect(function(player)
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats" -- この名前でないと表示されません
${names.map(n => `
	local ${n.toLowerCase()} = Instance.new("IntValue")
	${n.toLowerCase()}.Name = "${n}"
	${n.toLowerCase()}.Value = 0
	${n.toLowerCase()}.Parent = leaderstats
`).join('')}
	leaderstats.Parent = player
end)
` }],
      summary: [`参加したプレイヤーに ${names.join('・')} の表示を作ります`, `値を変えるにはサーバーで \`player.leaderstats.${names[0]}.Value += 1\``, '保存もしたいときは「データを保存して」と頼んでください'],
    }
  },
})
R({
  id: 'platform', title: '往復する床 (動く足場)', mode: 'studio',
  score: ctx => has(ctx, 'platform') * 3,
  build: ctx => {
    const dist = numberFor(ctx.slots, ctx.text, ['距離', 'スタッド', 'stud'], 20)
    const sec = ctx.slots.seconds || 3
    const vertical = /(上下|縦|エレベーター|elevator|リフト)/.test(normalize(ctx.text))
    return {
      files: [{ name: 'MovingPlatform.server.lua', code: `-- 往復する床 (${vertical ? '上下' : '左右'}に ${dist} スタッド、片道 ${sec} 秒)
-- 動かしたいパーツの中に Script として入れてください
local TweenService = game:GetService("TweenService")

local platform = script.Parent
platform.Anchored = true

local DISTANCE = ${dist}
local TIME = ${sec}

local startCFrame = platform.CFrame
local goal = startCFrame + ${vertical ? 'Vector3.new(0, DISTANCE, 0)' : 'startCFrame.RightVector * DISTANCE'}
local info = TweenInfo.new(TIME, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true) -- -1: ずっと, true: 往復

TweenService:Create(platform, info, { CFrame = goal }):Play()
` }],
      summary: [`パーツが ${vertical ? '上下' : '左右'}に ${dist} スタッド、片道 ${sec} 秒で往復します`, '乗ったプレイヤーも一緒に運ばれます (Anchored + CFrame のトゥイーン)', '距離と時間はスクリプトの先頭の DISTANCE / TIME で変えられます'],
    }
  },
})
R({
  id: 'spin', title: '回転するパーツ', mode: 'studio',
  score: ctx => (has(ctx, 'spin') ? 3 : 0) - (has(ctx, 'touch', 'click', 'key', 'button') ? 1 : 0),
  build: ctx => {
    const deg = numberFor(ctx.slots, ctx.text, ['度', '速さ', 'スピード', 'speed'], 90)
    return {
      files: [{ name: 'Spinner.server.lua', code: `-- パーツを回転させます (1 秒に ${deg} 度)
-- 回したいパーツの中に Script として入れてください
local RunService = game:GetService("RunService")

local part = script.Parent
part.Anchored = true

local SPEED = math.rad(${deg}) -- 1 秒あたりの回転 (度 → ラジアン)

RunService.Heartbeat:Connect(function(dt)
	part.CFrame *= CFrame.Angles(0, SPEED * dt, 0)
end)
` }],
      summary: [`パーツを 1 秒に ${deg} 度、Y 軸 (縦の軸) で回します`, 'フレームの時間 (dt) を掛けているので、端末の速さに関係なく同じ速さで回ります'],
    }
  },
})
R({
  id: 'daynight', title: '昼と夜のサイクル', mode: 'studio',
  score: ctx => has(ctx, 'daynight') * 3,
  build: ctx => {
    const min = ctx.slots.seconds ? Math.max(1, Math.round(ctx.slots.seconds / 60)) : 10
    return {
      files: [{ name: 'DayNight.server.lua', code: `-- 昼と夜のサイクル (1 日 = ${min} 分)
-- ServerScriptService に Script として入れてください
local Lighting = game:GetService("Lighting")
local RunService = game:GetService("RunService")

local DAY_MINUTES = ${min} -- 現実の何分でゲームの 1 日が過ぎるか

RunService.Heartbeat:Connect(function(dt)
	Lighting.ClockTime = (Lighting.ClockTime + dt * 24 / (DAY_MINUTES * 60)) % 24
end)
` }],
      summary: [`ゲームの 1 日が ${min} 分で過ぎるように、Lighting.ClockTime を進めます`, '長さは DAY_MINUTES で変えられます'],
    }
  },
})
R({
  id: 'round', title: 'ラウンド (待ち時間 → ゲーム → 結果) とタイマー表示', mode: 'studio',
  score: ctx => has(ctx, 'round') * 3 + (has(ctx, 'round') && has(ctx, 'countdown') ? 1 : 0),
  build: ctx => {
    const play = ctx.slots.seconds || 60
    return {
      files: [
        { name: 'RoundSystem.server.lua', code: `-- ラウンドの進行 (待ち時間 → ゲーム → 結果) をくり返します
-- ServerScriptService に Script として入れてください
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local INTERMISSION = 15 -- 待ち時間 (秒)
local ROUND_TIME = ${play} -- 1 ラウンドの長さ (秒)
local MIN_PLAYERS = 1

-- 画面に表示する文字 (クライアントが読みます)
local status = Instance.new("StringValue")
status.Name = "RoundStatus"
status.Parent = ReplicatedStorage

local function countdown(seconds, format)
	for t = seconds, 1, -1 do
		status.Value = string.format(format, t)
		task.wait(1)
	end
end

while true do
	-- 人数がそろうまで待つ
	while #Players:GetPlayers() < MIN_PLAYERS do
		status.Value = "プレイヤーを待っています…"
		task.wait(1)
	end

	countdown(INTERMISSION, "次のラウンドまで %d 秒")

	-- ここでマップの準備やテレポートをします
	local alive = {}
	for _, player in Players:GetPlayers() do
		if player.Character then
			alive[player] = true
		end
	end

	countdown(ROUND_TIME, "残り %d 秒")

	status.Value = "ラウンド終了!"
	task.wait(3)
end
` },
        { name: 'RoundTimer.client.lua', code: `-- サーバーの RoundStatus を画面の上に表示します
-- StarterPlayerScripts に LocalScript として入れてください
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local status = ReplicatedStorage:WaitForChild("RoundStatus")

local gui = Instance.new("ScreenGui")
gui.Name = "RoundTimer"
gui.ResetOnSpawn = false

local label = Instance.new("TextLabel")
label.AnchorPoint = Vector2.new(0.5, 0)
label.Position = UDim2.new(0.5, 0, 0, 12)
label.Size = UDim2.new(0.6, 0, 0, 44)
label.BackgroundColor3 = Color3.fromRGB(20, 20, 28)
label.BackgroundTransparency = 0.3
label.TextColor3 = Color3.new(1, 1, 1)
label.Font = Enum.Font.GothamBold
label.TextScaled = true
label.Parent = gui
Instance.new("UICorner").Parent = label

gui.Parent = player:WaitForChild("PlayerGui")

local function update()
	label.Text = status.Value
end
status.Changed:Connect(update)
update()
` },
      ],
      summary: ['サーバーが「待ち時間 → ラウンド → 結果」をくり返し、状況を ReplicatedStorage の RoundStatus に書きます', `クライアントがそれを画面の上に表示します (ラウンドは ${play} 秒)`, 'ラウンドの中身 (マップ・テレポート・勝敗) は「ここでマップの準備」の場所に足してください'],
    }
  },
})
R({
  id: 'countdown', title: 'カウントダウンタイマーの表示', mode: 'any',
  score: ctx => (has(ctx, 'countdown') ? 2.5 : 0) - (has(ctx, 'round') ? 3 : 0),
  build: ctx => {
    const sec = ctx.slots.seconds || 60
    const exec = ctx.mode === 'executor'
    return {
      files: [{ name: exec ? 'Countdown.lua' : 'Countdown.client.lua', code: `-- 画面の上に ${sec} 秒のカウントダウンを表示します
${exec ? '' : '-- StarterPlayerScripts に LocalScript として入れてください\n'}local Players = game:GetService("Players")
local player = Players.LocalPlayer

local SECONDS = ${sec}

local gui = Instance.new("ScreenGui")
gui.Name = "Countdown"
gui.ResetOnSpawn = false

local label = Instance.new("TextLabel")
label.AnchorPoint = Vector2.new(0.5, 0)
label.Position = UDim2.new(0.5, 0, 0, 16)
label.Size = UDim2.fromOffset(200, 56)
label.BackgroundColor3 = Color3.fromRGB(20, 20, 28)
label.TextColor3 = Color3.new(1, 1, 1)
label.Font = Enum.Font.GothamBold
label.TextScaled = true
label.Parent = gui
Instance.new("UICorner").Parent = label

gui.Parent = ${exec ? '(gethui and gethui()) or game:GetService("CoreGui")' : 'player:WaitForChild("PlayerGui")'}

for t = SECONDS, 0, -1 do
	label.Text = string.format("%02d:%02d", t // 60, t % 60)
	if t <= 10 then
		label.TextColor3 = Color3.fromRGB(255, 90, 90) -- 残り 10 秒で赤に
	end
	task.wait(1)
end

label.Text = "時間切れ!"
task.wait(3)
gui:Destroy()
` }],
      summary: [`画面の上に ${sec} 秒のカウントダウンを「分:秒」で表示します`, '残り 10 秒で赤くなり、0 になると「時間切れ!」と出て消えます'],
    }
  },
})
R({
  id: 'npc', title: '追いかけてくる NPC', mode: 'studio',
  score: ctx => has(ctx, 'npc') * 3,
  build: ctx => {
    const range = numberFor(ctx.slots, ctx.text, ['範囲', '距離', 'スタッド'], 60)
    const attack = ctx.concepts.has('damage') || ctx.concepts.has('kill') || /(敵|ゾンビ|zombie|enemy|モンスター|攻撃)/.test(normalize(ctx.text))
    const dmg = numberFor(ctx.slots, ctx.text, ['ダメージ', 'damage'], 10)
    return {
      files: [{ name: 'ChaseNPC.server.lua', code: `-- いちばん近いプレイヤーを追いかける NPC${attack ? ' (触れるとダメージ)' : ''}
-- NPC のモデル (Humanoid と HumanoidRootPart があるもの) の中に Script として入れてください
local Players = game:GetService("Players")
local PathfindingService = game:GetService("PathfindingService")

local npc = script.Parent
local humanoid = npc:WaitForChild("Humanoid")
local root = npc:WaitForChild("HumanoidRootPart")

local RANGE = ${range} -- この距離より近いプレイヤーを追う
${attack ? `local DAMAGE = ${dmg}
local ATTACK_COOLDOWN = 1
` : ''}
local function nearestCharacter()
	local best, bestDist = nil, RANGE
	for _, player in Players:GetPlayers() do
		local character = player.Character
		local hum = character and character:FindFirstChildOfClass("Humanoid")
		local hrp = character and character:FindFirstChild("HumanoidRootPart")
		if hum and hrp and hum.Health > 0 then
			local dist = (hrp.Position - root.Position).Magnitude
			if dist < bestDist then
				best, bestDist = character, dist
			end
		end
	end
	return best, bestDist
end

local function moveToward(target)
	local path = PathfindingService:CreatePath({ AgentCanJump = true })
	local ok = pcall(function()
		path:ComputeAsync(root.Position, target.Position)
	end)
	if ok and path.Status == Enum.PathStatus.Success then
		local waypoints = path:GetWaypoints()
		-- 少しずつ進んで、相手が動いたら計算し直す
		for i = 2, math.min(#waypoints, 4) do
			local wp = waypoints[i]
			if wp.Action == Enum.PathWaypointAction.Jump then
				humanoid.Jump = true
			end
			humanoid:MoveTo(wp.Position)
			humanoid.MoveToFinished:Wait()
		end
	else
		humanoid:MoveTo(target.Position) -- 道が見つからないときはまっすぐ
	end
end
${attack ? `
local lastHit = {}
root.Touched:Connect(function(hit)
	local character = hit.Parent
	local hum = character and character:FindFirstChildOfClass("Humanoid")
	if not hum or character == npc then
		return
	end
	local now = os.clock()
	if lastHit[character] and now - lastHit[character] < ATTACK_COOLDOWN then
		return
	end
	lastHit[character] = now
	hum:TakeDamage(DAMAGE)
end)
` : ''}
while humanoid.Health > 0 do
	local target = nearestCharacter()
	if target then
		moveToward(target.HumanoidRootPart)
	else
		task.wait(0.5)
	end
end
` }],
      summary: [`${range} スタッド以内でいちばん近いプレイヤーを、経路探索 (PathfindingService) で障害物を避けながら追いかけます`].concat(attack ? [`触れたプレイヤーに ${dmg} ダメージ (1 秒に 1 回まで)`] : []).concat(['NPC には Humanoid と HumanoidRootPart が必要です (ツールボックスの「Rig」などで作れます)']),
    }
  },
})
R({
  id: 'shop', title: 'ショップ (UI + サーバーでの購入処理)', mode: 'studio',
  score: ctx => has(ctx, 'shop') * 3,
  build: () => ({
    files: [
      { name: 'ShopServer.server.lua', code: `-- ショップの購入処理 (値段はサーバーが決めるので、改造されても安全)
-- ServerScriptService に Script として入れてください
-- ServerStorage に、売りたいツール (Sword など) を置いてください
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local PRICES = {
	Sword = 50,
	Shield = 80,
	Potion = 20,
}

local buyRemote = Instance.new("RemoteEvent")
buyRemote.Name = "BuyItem"
buyRemote.Parent = ReplicatedStorage

Players.PlayerAdded:Connect(function(player)
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"
	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Value = 100 -- 最初の所持金
	coins.Parent = leaderstats
	leaderstats.Parent = player
end)

local lastBuy = {}
buyRemote.OnServerEvent:Connect(function(player, itemName)
	if typeof(itemName) ~= "string" then
		return
	end
	local price = PRICES[itemName]
	if not price then
		return -- 売っていないもの
	end
	local now = os.clock()
	if lastBuy[player] and now - lastBuy[player] < 0.5 then
		return -- 連打の防止
	end
	lastBuy[player] = now

	local coins = player.leaderstats.Coins
	if coins.Value < price then
		return
	end
	local item = ServerStorage:FindFirstChild(itemName)
	coins.Value -= price
	if item then
		item:Clone().Parent = player.Backpack
	end
end)

Players.PlayerRemoving:Connect(function(player)
	lastBuy[player] = nil
end)
` },
      { name: 'ShopUI.client.lua', code: `-- ショップの画面 (右下のボタンで開く / 閉じる)
-- StarterPlayerScripts に LocalScript として入れてください
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local player = Players.LocalPlayer
local buyRemote = ReplicatedStorage:WaitForChild("BuyItem")

local ITEMS = {
	{ name = "Sword", label = "剣", price = 50 },
	{ name = "Shield", label = "盾", price = 80 },
	{ name = "Potion", label = "回復薬", price = 20 },
}

local gui = Instance.new("ScreenGui")
gui.Name = "Shop"
gui.ResetOnSpawn = false

-- 開くボタン
local openButton = Instance.new("TextButton")
openButton.AnchorPoint = Vector2.new(1, 1)
openButton.Position = UDim2.new(1, -16, 1, -96)
openButton.Size = UDim2.fromOffset(120, 48)
openButton.BackgroundColor3 = Color3.fromRGB(255, 170, 40)
openButton.Text = "ショップ"
openButton.Font = Enum.Font.GothamBold
openButton.TextSize = 18
openButton.Parent = gui
Instance.new("UICorner").Parent = openButton

-- ショップの窓
local frame = Instance.new("Frame")
frame.AnchorPoint = Vector2.new(0.5, 0.5)
frame.Position = UDim2.fromScale(0.5, 0.5)
frame.Size = UDim2.fromScale(0.8, 0.6)
frame.BackgroundColor3 = Color3.fromRGB(28, 28, 36)
frame.Visible = false
frame.Parent = gui
Instance.new("UICorner").Parent = frame
local limit = Instance.new("UISizeConstraint")
limit.MaxSize = Vector2.new(420, 360)
limit.Parent = frame

local title = Instance.new("TextLabel")
title.Size = UDim2.new(1, -56, 0, 44)
title.Position = UDim2.fromOffset(16, 6)
title.BackgroundTransparency = 1
title.Text = "ショップ"
title.TextXAlignment = Enum.TextXAlignment.Left
title.TextColor3 = Color3.new(1, 1, 1)
title.Font = Enum.Font.GothamBold
title.TextSize = 22
title.Parent = frame

local closeButton = Instance.new("TextButton")
closeButton.AnchorPoint = Vector2.new(1, 0)
closeButton.Position = UDim2.new(1, -8, 0, 8)
closeButton.Size = UDim2.fromOffset(36, 36)
closeButton.BackgroundColor3 = Color3.fromRGB(200, 60, 60)
closeButton.Text = "X"
closeButton.TextColor3 = Color3.new(1, 1, 1)
closeButton.Font = Enum.Font.GothamBold
closeButton.TextSize = 18
closeButton.Parent = frame
Instance.new("UICorner").Parent = closeButton

local list = Instance.new("ScrollingFrame")
list.Position = UDim2.fromOffset(12, 56)
list.Size = UDim2.new(1, -24, 1, -68)
list.BackgroundTransparency = 1
list.ScrollBarThickness = 4
list.AutomaticCanvasSize = Enum.AutomaticSize.Y
list.CanvasSize = UDim2.new()
list.Parent = frame
local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 8)
layout.Parent = list

for _, item in ITEMS do
	local row = Instance.new("Frame")
	row.Size = UDim2.new(1, 0, 0, 52)
	row.BackgroundColor3 = Color3.fromRGB(44, 44, 56)
	row.Parent = list
	Instance.new("UICorner").Parent = row

	local name = Instance.new("TextLabel")
	name.Size = UDim2.new(0.6, 0, 1, 0)
	name.Position = UDim2.fromOffset(12, 0)
	name.BackgroundTransparency = 1
	name.Text = item.label .. "  (" .. item.price .. " コイン)"
	name.TextXAlignment = Enum.TextXAlignment.Left
	name.TextColor3 = Color3.new(1, 1, 1)
	name.Font = Enum.Font.Gotham
	name.TextSize = 16
	name.Parent = row

	local buy = Instance.new("TextButton")
	buy.AnchorPoint = Vector2.new(1, 0.5)
	buy.Position = UDim2.new(1, -8, 0.5, 0)
	buy.Size = UDim2.fromOffset(84, 38)
	buy.BackgroundColor3 = Color3.fromRGB(60, 170, 90)
	buy.Text = "購入"
	buy.TextColor3 = Color3.new(1, 1, 1)
	buy.Font = Enum.Font.GothamBold
	buy.TextSize = 16
	buy.Parent = row
	Instance.new("UICorner").Parent = buy

	buy.Activated:Connect(function()
		buyRemote:FireServer(item.name) -- 「買いたい」だけを送る (値段はサーバーが確認)
	end)
end

gui.Parent = player:WaitForChild("PlayerGui")

local function setOpen(open)
	frame.Visible = true
	frame.Size = open and UDim2.fromScale(0.7, 0.5) or UDim2.fromScale(0.8, 0.6)
	local tween = TweenService:Create(frame, TweenInfo.new(0.15), { Size = open and UDim2.fromScale(0.8, 0.6) or UDim2.fromScale(0.7, 0.5) })
	tween:Play()
	if not open then
		tween.Completed:Wait()
		frame.Visible = false
	end
end

openButton.Activated:Connect(function()
	setOpen(not frame.Visible)
end)
closeButton.Activated:Connect(function()
	setOpen(false)
end)
` },
    ],
    summary: ['右下の「ショップ」ボタンで開く画面と、サーバー側の購入処理を作りました', 'クライアントは「買いたい」だけを送り、値段と所持金はサーバーが確かめます (改造対策)', '品物は ShopServer の PRICES と ShopUI の ITEMS に足してください。ツールは ServerStorage に同じ名前で置きます'],
  }),
})
R({
  id: 'remote', title: 'RemoteEvent (クライアント → サーバー) のひな形', mode: 'studio',
  score: ctx => (has(ctx, 'remote') ? 2.5 : 0) - (has(ctx, 'shop') ? 3 : 0),
  build: ctx => {
    const name = ident(ctx.slots.quoted[0], 'MyRemote')
    return {
      files: [
        { name: `${name}.server.lua`, code: `-- RemoteEvent のサーバー側 (クライアントから届いたお願いを処理)
-- ServerScriptService に Script として入れてください
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local remote = Instance.new("RemoteEvent")
remote.Name = "${name}"
remote.Parent = ReplicatedStorage

local lastCall = {}
remote.OnServerEvent:Connect(function(player, action, value)
	-- 最初の引数は、送ってきたプレイヤー (自動で付きます)
	if typeof(action) ~= "string" then
		return -- 値を確かめる (改造されたクライアントは何でも送れるため)
	end
	local now = os.clock()
	if lastCall[player] and now - lastCall[player] < 0.2 then
		return -- 連打の防止
	end
	lastCall[player] = now

	print(player.Name, "から:", action, value)
	-- 返事をしたいとき
	remote:FireClient(player, "ok", action)
end)
` },
        { name: `${name}.client.lua`, code: `-- RemoteEvent のクライアント側 (サーバーにお願いを送る)
-- StarterPlayerScripts に LocalScript として入れてください
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local remote = ReplicatedStorage:WaitForChild("${name}")

-- サーバーからの返事
remote.OnClientEvent:Connect(function(status, action)
	print("サーバーの返事:", status, action)
end)

-- サーバーに送る (player は付けなくてよい)
remote:FireServer("hello", 123)
` },
      ],
      summary: ['サーバー側で RemoteEvent を作り、クライアントから FireServer で送ったものを OnServerEvent で受け取ります', 'サーバーでは届いた値を必ず確かめ、連打も防いでいます', 'サーバーから返事を送るときは FireClient → クライアントの OnClientEvent'],
    }
  },
})
R({
  id: 'module', title: 'ModuleScript (クラス) のひな形', mode: 'any',
  score: ctx => has(ctx, 'module') * 2.5,
  build: ctx => {
    const name = ident(ctx.slots.quoted[0] || (ctx.slots.identifiers.find(x => /^[A-Z][a-z]\w+$/.test(x) && x !== 'ModuleScript')), 'MyClass')
    return {
      files: [{ name: `${name}.lua`, code: `-- ${name} クラス (ModuleScript)
-- 使い方:
--   local ${name} = require(path.to.${name})
--   local obj = ${name}.new("名前")
--   obj:greet()
local ${name} = {}
${name}.__index = ${name}

export type ${name} = typeof(setmetatable({} :: {
	name: string,
	level: number,
}, ${name}))

function ${name}.new(name: string): ${name}
	local self = setmetatable({}, ${name})
	self.name = name
	self.level = 1
	return self
end

function ${name}:levelUp(amount: number?)
	self.level += amount or 1
end

function ${name}:greet()
	print(\`{self.name} (Lv.{self.level}) です\`)
end

return ${name}
` }],
      summary: [`${name}.new で作り、:greet() などのメソッドを持つクラスです`, 'メタテーブル (__index) でメソッドを共有しているので、たくさん作っても軽いです', '型 (export type) 付きなので補完も効きます'],
    }
  },
})
R({
  id: 'doubleJump', title: '二段ジャンプ', mode: 'any',
  score: ctx => has(ctx, 'doubleJump') * 4,
  build: ctx => {
    const exec = ctx.mode === 'executor'
    const power = numberFor(ctx.slots, ctx.text, ['力', '高さ', 'power'], 50)
    return {
      files: [{ name: exec ? 'DoubleJump.lua' : 'DoubleJump.client.lua', code: `-- 二段ジャンプ (空中でもう一度ジャンプできる)
${exec ? '' : '-- StarterCharacterScripts に LocalScript として入れてください\n'}local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")

local player = Players.LocalPlayer
local POWER = ${power} -- 2 回目のジャンプの強さ

local canDouble = false
local usedDouble = false

local function setup(character)
	local humanoid = character:WaitForChild("Humanoid")
	local root = character:WaitForChild("HumanoidRootPart")
	humanoid.StateChanged:Connect(function(_, new)
		if new == Enum.HumanoidStateType.Landed then
			canDouble, usedDouble = false, false
		elseif new == Enum.HumanoidStateType.Freefall then
			canDouble = true
		end
	end)
end

UserInputService.JumpRequest:Connect(function()
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if humanoid and root and canDouble and not usedDouble then
		usedDouble = true
		root.AssemblyLinearVelocity = Vector3.new(root.AssemblyLinearVelocity.X, POWER, root.AssemblyLinearVelocity.Z)
	end
end)

if player.Character then
	setup(player.Character)
end
player.CharacterAdded:Connect(setup)
` }],
      summary: ['空中でジャンプボタンを押すと、もう 1 回だけ上に飛びます (スマホのジャンプボタンでも動きます)', '着地すると回数がリセットされます', `強さは POWER (${power}) で変えられます`],
    }
  },
})
R({
  id: 'sword', title: '剣 (ツール)', mode: 'studio',
  score: ctx => (has(ctx, 'tool') && /(剣|sword|武器|weapon|攻撃)/.test(normalize(ctx.text)) ? 3.5 : 0),
  build: ctx => {
    const dmg = numberFor(ctx.slots, ctx.text, ['ダメージ', 'damage'], 25)
    return {
      files: [{ name: 'Sword.server.lua', code: `-- 剣: 振ったときに当たった相手に ${dmg} ダメージ
-- Tool (中に Handle という名前のパーツ) の中に Script として入れ、Tool を StarterPack に置いてください
local Players = game:GetService("Players")

local tool = script.Parent
local handle = tool:WaitForChild("Handle")

local DAMAGE = ${dmg}
local SWING_TIME = 0.4
local COOLDOWN = 0.6

local swinging = false
local lastSwing = 0
local hitThisSwing = {}

tool.Activated:Connect(function()
	local now = os.clock()
	if now - lastSwing < COOLDOWN then
		return
	end
	lastSwing = now
	swinging = true
	table.clear(hitThisSwing)
	task.wait(SWING_TIME)
	swinging = false
end)

handle.Touched:Connect(function(hit)
	if not swinging then
		return
	end
	local character = hit.Parent
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not humanoid or character == tool.Parent or hitThisSwing[humanoid] then
		return -- 自分自身と、同じ振りで 2 回目は当てない
	end
	hitThisSwing[humanoid] = true
	humanoid:TakeDamage(DAMAGE)
end)
` }],
      summary: [`ツールを使う (クリック / タップ) と ${SWING_TEXT}、その間に触れた相手に ${dmg} ダメージ`, '1 回の振りで同じ相手には 1 回だけ当たり、連打もできないようにしています', 'Tool の中に Handle という名前のパーツが必要です'],
    }
  },
})
const SWING_TEXT = '0.4 秒間「振っている」状態になり'
R({
  id: 'gui', title: '開閉できる GUI メニュー', mode: 'any',
  score: ctx => (has(ctx, 'gui') ? 2 : 0) + (has(ctx, 'gui') && has(ctx, 'button') ? 0.5 : 0) - (has(ctx, 'shop') ? 3 : 0) - (ACTIONS.some(a => a.c.some(c => ctx.concepts.has(c))) ? 1.5 : 0),
  build: ctx => {
    const exec = ctx.mode === 'executor'
    const title = ctx.slots.quoted[0] || 'メニュー'
    return {
      files: [{ name: exec ? 'Menu.lua' : 'Menu.client.lua', code: `-- 開閉できるメニュー (ドラッグで動かせる)
${exec ? '' : '-- StarterPlayerScripts に LocalScript として入れてください\n'}local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")

local player = Players.LocalPlayer
${exec ? `if getgenv().MyMenu then
	getgenv().MyMenu:Destroy() -- 前回のメニューを消す (二重実行の防止)
end
` : ''}
local gui = Instance.new("ScreenGui")
gui.Name = "Menu"
gui.ResetOnSpawn = false
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling

local window = Instance.new("Frame")
window.AnchorPoint = Vector2.new(0.5, 0.5)
window.Position = UDim2.fromScale(0.5, 0.5)
window.Size = UDim2.fromOffset(300, 220)
window.BackgroundColor3 = Color3.fromRGB(26, 26, 34)
window.Parent = gui
Instance.new("UICorner").Parent = window
local stroke = Instance.new("UIStroke")
stroke.Color = Color3.fromRGB(80, 80, 110)
stroke.Parent = window

local titleBar = Instance.new("TextLabel")
titleBar.Size = UDim2.new(1, 0, 0, 40)
titleBar.BackgroundTransparency = 1
titleBar.Text = "  " .. ${q(title)}
titleBar.TextXAlignment = Enum.TextXAlignment.Left
titleBar.TextColor3 = Color3.new(1, 1, 1)
titleBar.Font = Enum.Font.GothamBold
titleBar.TextSize = 18
titleBar.Parent = window

local closeButton = Instance.new("TextButton")
closeButton.AnchorPoint = Vector2.new(1, 0)
closeButton.Position = UDim2.new(1, -6, 0, 6)
closeButton.Size = UDim2.fromOffset(28, 28)
closeButton.BackgroundColor3 = Color3.fromRGB(200, 60, 60)
closeButton.Text = "-"
closeButton.TextColor3 = Color3.new(1, 1, 1)
closeButton.Font = Enum.Font.GothamBold
closeButton.TextSize = 18
closeButton.Parent = window
Instance.new("UICorner").Parent = closeButton

local content = Instance.new("Frame")
content.Position = UDim2.fromOffset(12, 46)
content.Size = UDim2.new(1, -24, 1, -58)
content.BackgroundTransparency = 1
content.Parent = window
local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 8)
layout.Parent = content

-- ボタンを追加する関数: addButton("名前", function() ... end)
local function addButton(text, onClick)
	local button = Instance.new("TextButton")
	button.Size = UDim2.new(1, 0, 0, 40)
	button.BackgroundColor3 = Color3.fromRGB(50, 90, 200)
	button.Text = text
	button.TextColor3 = Color3.new(1, 1, 1)
	button.Font = Enum.Font.Gotham
	button.TextSize = 16
	button.Parent = content
	Instance.new("UICorner").Parent = button
	button.Activated:Connect(function()
		onClick(button)
	end)
	return button
end

addButton("あいさつ", function()
	print("こんにちは、" .. player.Name)
end)

local fast = false
addButton("速く歩く: OFF", function(button)
	local humanoid = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	if not humanoid then
		return
	end
	fast = not fast
	humanoid.WalkSpeed = fast and 32 or 16
	button.Text = fast and "速く歩く: ON" or "速く歩く: OFF"
end)

-- 最小化 / 元に戻す
local minimized = false
closeButton.Activated:Connect(function()
	minimized = not minimized
	content.Visible = not minimized
	closeButton.Text = minimized and "+" or "-"
	TweenService:Create(window, TweenInfo.new(0.2), { Size = minimized and UDim2.fromOffset(300, 40) or UDim2.fromOffset(300, 220) }):Play()
end)

-- タイトルをドラッグして動かす (マウス・タッチ)
local dragging, dragStart, startPos
titleBar.InputBegan:Connect(function(input)
	if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
		dragging, dragStart, startPos = true, input.Position, window.Position
	end
end)
UserInputService.InputChanged:Connect(function(input)
	if dragging and (input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch) then
		local delta = input.Position - dragStart
		window.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset + delta.X, startPos.Y.Scale, startPos.Y.Offset + delta.Y)
	end
end)
UserInputService.InputEnded:Connect(function(input)
	if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
		dragging = false
	end
end)

gui.Parent = ${exec ? '(gethui and gethui()) or game:GetService("CoreGui")' : 'player:WaitForChild("PlayerGui")'}
${exec ? 'getgenv().MyMenu = gui\n' : ''}` }],
      summary: [`「${title}」という、ドラッグで動かせて最小化できるメニューを作りました`, 'addButton("名前", function() ... end) でボタンを増やせます (例として「あいさつ」「速く歩く」)', 'スマホのタッチでもドラッグできます'],
    }
  },
})
// ---- エグゼキューター向け ----
R({
  id: 'esp', title: 'ESP (プレイヤーの強調表示と名前)', mode: 'executor',
  score: ctx => has(ctx, 'esp') * 3 + (has(ctx, 'esp') && has(ctx, 'drawing') ? 1 : 0),
  build: ctx => {
    const color = ctx.slots.colors[0]
    return {
      files: [{ name: 'ESP.lua', code: `-- ESP: 他のプレイヤーを壁越しに強調表示し、名前と距離を表示します
-- もう一度実行すると前回の表示を消してから作り直します
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera
local COLOR = ${color ? rgb(color) : 'Color3.fromRGB(255, 70, 70)'}

if getgenv().ESP then
	getgenv().ESP.stop()
end

local items = {} -- [player] = { highlight, label }
local connections = {}

local function add(other)
	if other == player then
		return
	end
	local highlight = Instance.new("Highlight")
	highlight.FillColor = COLOR
	highlight.FillTransparency = 0.6
	highlight.OutlineColor = Color3.new(1, 1, 1)
	highlight.DepthMode = Enum.HighlightDepthMode.AlwaysOnTop

	local label = Drawing.new("Text")
	label.Size = 16
	label.Center = true
	label.Outline = true
	label.Color = Color3.new(1, 1, 1)
	label.Visible = false

	items[other] = { highlight = highlight, label = label }
end

local function remove(other)
	local item = items[other]
	if item then
		item.highlight:Destroy()
		item.label:Remove()
		items[other] = nil
	end
end

for _, other in Players:GetPlayers() do
	add(other)
end
table.insert(connections, Players.PlayerAdded:Connect(add))
table.insert(connections, Players.PlayerRemoving:Connect(remove))

table.insert(connections, RunService.RenderStepped:Connect(function()
	local myRoot = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
	for other, item in items do
		local character = other.Character
		local root = character and character:FindFirstChild("HumanoidRootPart")
		item.highlight.Adornee = character
		item.highlight.Parent = character and (gethui and gethui() or game:GetService("CoreGui")) or nil
		if root then
			local pos, onScreen = camera:WorldToViewportPoint(root.Position + Vector3.new(0, 3, 0))
			item.label.Visible = onScreen
			if onScreen then
				local dist = myRoot and math.floor((root.Position - myRoot.Position).Magnitude) or 0
				item.label.Text = string.format("%s [%dm]", other.DisplayName, dist)
				item.label.Position = Vector2.new(pos.X, pos.Y)
			end
		else
			item.label.Visible = false
		end
	end
end))

getgenv().ESP = {
	stop = function()
		for _, c in connections do
			c:Disconnect()
		end
		for other in items do
			remove(other)
		end
	end,
}
print("ESP をオンにしました (getgenv().ESP.stop() で止まります)")
` }],
      summary: ['他のプレイヤーを Highlight で壁越しに強調し、Drawing の文字で名前と距離を表示します', 'もう一度実行すると前回のものを消してから作り直し、getgenv().ESP.stop() で止められます', '使うのは自分のゲームや練習場所だけにしてください (公開ゲームでは利用規約違反になります)'],
    }
  },
})
R({
  id: 'infJump', title: '無限ジャンプ', mode: 'executor',
  score: ctx => has(ctx, 'infJump') * 4,
  build: () => ({
    files: [{ name: 'InfiniteJump.lua', code: `-- 空中でも何度でもジャンプできるようにします (もう一度実行するとオフ)
local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local player = Players.LocalPlayer

if getgenv().InfJump then
	getgenv().InfJump:Disconnect()
	getgenv().InfJump = nil
	print("無限ジャンプ: OFF")
	return
end

getgenv().InfJump = UserInputService.JumpRequest:Connect(function()
	local humanoid = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid:ChangeState(Enum.HumanoidStateType.Jumping)
	end
end)
print("無限ジャンプ: ON")
` }],
    summary: ['ジャンプボタン (スペース / スマホのボタン) を押すたびに、空中でもジャンプします', 'もう一度実行するとオフになります'],
  }),
})
R({
  id: 'fly', title: '飛行 (フライ)', mode: 'executor',
  score: ctx => has(ctx, 'fly') * 3.5,
  build: ctx => {
    const speed = numberFor(ctx.slots, ctx.text, ['速さ', 'スピード', 'speed'], 60)
    const key = ctx.slots.keys[0] || 'F'
    return {
      files: [{ name: 'Fly.lua', code: `-- ${key} キーで飛行のオン / オフ。移動はいつもの操作 (スマホはスティック)、上下はカメラの向き
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera
local SPEED = ${speed}
local KEY = Enum.KeyCode.${key}

local flying = false
local velocity, gyro

local function stop()
	flying = false
	if velocity then velocity:Destroy() end
	if gyro then gyro:Destroy() end
	local humanoid = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid.PlatformStand = false
	end
end

local function start()
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not root or not humanoid then
		return
	end
	flying = true
	humanoid.PlatformStand = true
	local attachment = root:FindFirstChild("FlyAttachment") or Instance.new("Attachment")
	attachment.Name = "FlyAttachment"
	attachment.Parent = root
	velocity = Instance.new("LinearVelocity")
	velocity.Attachment0 = attachment
	velocity.MaxForce = math.huge
	velocity.VectorVelocity = Vector3.zero
	velocity.Parent = root
	gyro = Instance.new("AlignOrientation")
	gyro.Mode = Enum.OrientationAlignmentMode.OneAttachment
	gyro.Attachment0 = attachment
	gyro.RigidityEnabled = true
	gyro.Parent = root
end

RunService.RenderStepped:Connect(function()
	if not flying or not velocity then
		return
	end
	local humanoid = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	local move = humanoid and humanoid.MoveDirection or Vector3.zero
	local look = camera.CFrame.LookVector
	-- 前に進むときはカメラの向き (上下も) に合わせる
	local forward = move.Magnitude > 0 and (look * move:Dot(Vector3.new(look.X, 0, look.Z).Unit) + (move - Vector3.new(look.X, 0, look.Z).Unit * move:Dot(Vector3.new(look.X, 0, look.Z).Unit))) or Vector3.zero
	velocity.VectorVelocity = forward.Magnitude > 0 and forward.Unit * SPEED or Vector3.zero
	gyro.CFrame = camera.CFrame
end)

UserInputService.InputBegan:Connect(function(input, gameProcessed)
	if gameProcessed or input.KeyCode ~= KEY then
		return
	end
	if flying then stop() else start() end
end)

player.CharacterAdded:Connect(stop)
print("${key} キーで飛行のオン / オフ")
` }],
      summary: [`${key} キーで飛行を切り替えます。移動はいつもの操作で、カメラを向けた方向へ飛びます`, `速さは SPEED (${speed}) で変えられます`, '使うのは自分のゲームや練習場所だけにしてください'],
    }
  },
})
R({
  id: 'noclip', title: '壁抜け (ノークリップ)', mode: 'executor',
  score: ctx => has(ctx, 'noclip') * 4,
  build: ctx => {
    const key = ctx.slots.keys[0] || 'N'
    return {
      files: [{ name: 'Noclip.lua', code: `-- ${key} キーで壁抜けのオン / オフ (自分のキャラクターの当たり判定を消します)
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local player = Players.LocalPlayer
local KEY = Enum.KeyCode.${key}
local enabled = false

RunService.Stepped:Connect(function()
	if not enabled or not player.Character then
		return
	end
	for _, part in player.Character:GetDescendants() do
		if part:IsA("BasePart") then
			part.CanCollide = false
		end
	end
end)

UserInputService.InputBegan:Connect(function(input, gameProcessed)
	if gameProcessed or input.KeyCode ~= KEY then
		return
	end
	enabled = not enabled
	print("壁抜け:", enabled and "ON" or "OFF")
end)
` }],
      summary: [`${key} キーで、自分のキャラクターの当たり判定を毎フレーム消して壁をすり抜けます`, 'オフにすると次のフレームから元に戻ります'],
    }
  },
})

// ============================================================
// 組み立て
// ============================================================
function pickActions(ctx) {
  const n = normalize(ctx.text)
  const found = []
  for (const a of ACTIONS) {
    const hit = (a.match && a.match.test(n)) || (!a.match && a.c.some(c => ctx.concepts.has(c)))
    if (!hit) continue
    // 出てきた順に並べる
    let at = Infinity
    for (const c of a.c) {
      for (const f of (CONCEPT_FORMS[c] || [])) { const i = n.indexOf(f); if (i >= 0 && i < at) at = i }
    }
    found.push({ a, at })
  }
  // 重なるものの整理
  let list = found.sort((x, y) => x.at - y.at).map(x => x.a)
  if (list.some(a => a.id === 'kill')) list = list.filter(a => a.id !== 'damage' && a.id !== 'heal')
  if (list.some(a => a.id === 'checkpoint')) list = list.filter(a => a.id !== 'teleport')
  if (list.some(a => a.id === 'giveTool') && !/(あげ|渡|もらえ|give|付与)/.test(n)) list = list.filter(a => a.id !== 'giveTool')
  if (list.some(a => a.id === 'fling') && list.some(a => a.id === 'jump')) list = list.filter(a => a.id !== 'jump')
  if (list.some(a => a.id === 'spawnPart') && list.some(a => a.id === 'disappear') && !/(消え|消す)/.test(n)) list = list.filter(a => a.id !== 'disappear')
  return list.slice(0, 4)
}
const CONCEPT_FORMS = Object.fromEntries(Object.entries(CONCEPTS).map(([k, v]) => [k, v.map(normalize)]))

function pickTrigger(ctx, actions) {
  const n = normalize(ctx.text)
  let best = null, at = Infinity
  for (const [tid, cid] of TRIGGER_CONCEPTS) {
    if (!ctx.concepts.has(cid)) continue
    let i = Infinity
    for (const f of (CONCEPT_FORMS[cid] || [])) { const k = n.indexOf(f); if (k >= 0 && k < i) i = k }
    // ボタン + キー (「E キーを押したら」) はキー、GUI のボタンは button
    if (tid === 'button' && ctx.slots.keys.length && !/(画面|gui|ui)/.test(n)) continue
    if (tid === 'key' && !ctx.slots.keys.length && /(ボタン|button)/.test(n)) continue
    if (i < at) { at = i; best = tid }
  }
  if (best === 'key' && (ctx.concepts.has('prompt') || actions.some(a => a.id === 'openDoor')) && ctx.mode !== 'executor') best = 'prompt'
  // 参加したときのメッセージは、その人の画面に出す (LocalScript)
  if ((best === 'join' || (!best && ctx.concepts.has('join'))) && ctx.mode !== 'executor' && actions.length && actions.every(a => a.id === 'message' || a.id === 'sound')) best = 'start'
  if (!best && ctx.slots.keys.length && /(押|press)/.test(n)) best = 'key'
  if (!best) best = (actions.find(a => a.defaultTrigger) || {}).defaultTrigger || null
  if (!best && actions.some(a => a.triggers)) best = actions.find(a => a.triggers).triggers[0]
  if (!best) {
    if (ctx.mode === 'executor') best = 'now'
    else if (actions.every(a => a.needs === 'part' || a.needs === null)) best = 'touch'
    // 「キルブロック」「溶岩の床」のように、パーツが主役なら触れたとき
    else if (ctx.concepts.has('part') || /(brick|block|lava|pad|ブロック|パッド|床|溶岩)/.test(normalize(ctx.text))) best = 'touch'
    else best = 'join'
  }
  // エグゼキューターではサーバーのきっかけは使えない
  if (ctx.mode === 'executor' && TRIGGERS[best].side === 'server') best = ctx.slots.keys.length ? 'key' : best === 'timer' ? 'now' : 'button'
  return best
}

export function generateCode(text, { mode = 'studio', concepts, slots } = {}) {
  concepts = concepts || conceptsOf(text)
  slots = slots || slotsOf(text)
  const ctx = { text, mode, concepts, slots }
  // 1) レシピ
  const scored = RECIPES.filter(r => r.mode === 'any' || r.mode === mode || (r.mode === 'studio' && mode !== 'executor')).map(r => ({ r, s: r.score(ctx) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s)
  const actions = pickActions(ctx)
  const triggerExplicit = TRIGGER_CONCEPTS.some(([, c]) => concepts.has(c)) || slots.keys.length > 0
  // 動作 + きっかけの組み立てを優先するか (例:「触れたらダメージ」はレシピより組み立て)
  const useCompose = actions.length && (!scored.length || (triggerExplicit && scored[0].s < 3.5) || scored[0].s < 2.5)
  if (!useCompose && scored.length) {
    const out = scored[0].r.build(ctx)
    return finish({ ...out, title: scored[0].r.title, spec: { kind: 'recipe', id: scored[0].r.id }, alternatives: scored.slice(1, 3).map(x => x.r.title) })
  }
  if (!actions.length) return null
  return finish(compose(ctx, actions))
}

function compose(ctx, actions) {
  const trigger = pickTrigger(ctx, actions)
  const tr = TRIGGERS[trigger]
  const exec = ctx.mode === 'executor'
  const p = {
    cooldown: 1, key: ctx.slots.keys[0] || (actions.some(a => a.id === 'speed') && trigger === 'key' ? 'LeftShift' : 'E'),
    interval: ctx.slots.seconds || 5, command: '/' + (actions[0].id === 'speed' ? 'speed' : actions[0].id === 'teleport' ? 'tp' : actions[0].id),
    actionText: actions[0].title.replace(/する$|る$/, '') || '使う', label: actions[0].title, guiName: actions[0].id + 'Button', partName: ctx.slots.quoted[0] || 'Part', executor: exec, keep: true,
  }
  if (trigger === 'touch' && actions.some(a => a.id === 'kill')) p.cooldown = 0.5
  if (trigger === 'touch' && actions.some(a => a.id === 'disappear' && !a.params(ctx.slots, ctx.text, ctx).respawn)) p.cooldown = 0.2
  const vars = (tr.varsFor && tr.varsFor(actions)) || tr.vars
  const side = tr.side
  // サーバーでしか効かない動作をクライアントから → RemoteEvent で頼む
  const needServer = side === 'client' && !exec && actions.some(a => a.side === 'server')
  const params = actions.map(a => a.params(ctx.slots, ctx.text, ctx))
  const inner = []
  const setup = []
  const helpers = new Set()
  const missing = []
  actions.forEach((a, i) => {
    if (a.needs && !vars[a.needs]) {
      if (a.needs === 'part') {
        // パーツがないきっかけ (キー・ボタン・参加) では、名前で探す
        if (!setup.some(l => l.startsWith('local targetPart'))) setup.push(`local targetPart = workspace:WaitForChild(${q(ctx.slots.quoted[0] || 'TargetPart')}) -- 対象のパーツの名前`)
      } else { missing.push(a); return }
    }
    const v = { ...vars, part: vars.part || 'targetPart' }
    if (a.setup) setup.push(...a.setup(params[i], v))
    if (a.helper) helpers.add(a.helper)
    inner.push(...a.code(params[i], v, { side }))
  })
  const undoAct = actions.find(a => a.undo)
  const hold = trigger === 'key' && actions.some((a, i) => a.id === 'speed' && params[i].hold)
  const toggle = trigger === 'button' && !!undoAct && /(切り替|オンオフ|on\/?off|トグル|toggle|押すたび)/.test(normalize(ctx.text))
  const undo = (hold || toggle) && undoAct ? undoAct.undo(params[actions.indexOf(undoAct)], vars) : null
  const files = []
  const title = `${actions.map(a => a.title).join('・')} (${tr.title.replace(/ \(.*\)$/, '')})`
  if (needServer) {
    // クライアント: キー / ボタンで RemoteEvent を送る。サーバー: 受け取って動作
    const remote = ident(actions[0].id.replace(/^./, c => c.toUpperCase()) + 'Request', 'ActionRequest')
    const sv = { character: 'character', humanoid: 'humanoid', player: 'player', root: 'root', part: 'targetPart' }
    const sInner = []
    actions.forEach((a, i) => { if (a.setup) setup.push(...a.setup(params[i], sv)); sInner.push(...a.code(params[i], sv, { side: 'server' })) })
    const server = [
      `-- ${title} (サーバー側)`,
      '-- ServerScriptService に Script として入れてください',
      'local Players = game:GetService("Players")',
      'local ReplicatedStorage = game:GetService("ReplicatedStorage")',
      '',
      'local remote = Instance.new("RemoteEvent")',
      `remote.Name = ${q(remote)}`,
      'remote.Parent = ReplicatedStorage',
      ...(setup.length ? ['', ...setup] : []),
      ...[...helpers].flatMap(hk => ['', ...HELPERS[hk]]),
      '',
      'local lastUse = {}',
      'remote.OnServerEvent:Connect(function(player)',
      '\t-- 連打の防止 (クライアントは改造されることがあるので、サーバーで制限)',
      '\tlocal now = os.clock()',
      '\tif lastUse[player] and now - lastUse[player] < 1 then',
      '\t\treturn',
      '\tend',
      '\tlastUse[player] = now',
      '\tlocal character = player.Character',
      '\tlocal humanoid = character and character:FindFirstChildOfClass("Humanoid")',
      '\tlocal root = character and character:FindFirstChild("HumanoidRootPart")',
      '\tif not humanoid or not root then',
      '\t\treturn',
      '\tend',
      ...ind(sInner, 1),
      'end)',
      '',
    ]
    const cl = tr.build([`remote:FireServer() -- サーバーに頼む`], p, actions, null)
    const client = [`-- ${title} (クライアント側)`, `-- ${tr.place}`, ...cl.header.slice(0, 1), 'local ReplicatedStorage = game:GetService("ReplicatedStorage")', ...cl.header.slice(1), `local remote = ReplicatedStorage:WaitForChild(${q(remote)})`, '', ...cl.body, '']
    files.push({ name: `${remote}.server.lua`, code: server.join('\n') }, { name: `${remote}.client.lua`, code: client.join('\n') })
  } else {
    const built = tr.build(inner, p, actions, undo)
    const lines = [`-- ${title}`, `-- ${tr.place}`, ...built.header, ...(setup.length ? ['', ...setup] : []), ...[...helpers].flatMap(hk => ['', ...HELPERS[hk]]), '', ...built.body, '']
    const base = ident(actions.map(a => a.id.replace(/^./, c => c.toUpperCase())).join('') + ({ touch: 'Part', key: 'Key', button: 'Button', click: 'Click', prompt: 'Prompt', chat: 'Command', timer: 'Loop', join: 'OnSpawn', start: 'OnJoin' }[trigger] || ''), 'Script')
    files.push({ name: exec ? `${base}.lua` : `${base}.${side === 'client' ? 'client' : 'server'}.lua`, code: lines.join('\n') })
  }
  const summary = [`${tr.title}: ${actions.map((a, i) => describeParams(a, params[i])).join('。')}`]
  summary.push(needServer ? 'キー / ボタンはクライアント、体力やコインの変更はサーバーで行うように、RemoteEvent でつないでいます (サーバー側で連打も防いでいます)' : `置き場所: ${tr.place}`)
  if (trigger === 'touch') summary.push(`同じ人には ${p.cooldown} 秒に 1 回だけ効きます (COOLDOWN で変更)`)
  if (trigger === 'key') summary.push(`キーは ${p.key}${hold ? ' (押している間だけ効きます)' : ''}。KEY で変えられます。スマホにはキーがないので、ボタンにしたいときは「ボタンで」と頼んでください`)
  if (trigger === 'chat') summary.push(`チャットに ${p.command} と打つと実行します`)
  if (trigger === 'timer') summary.push(`${p.interval} 秒ごとに実行します (INTERVAL で変更)`)
  if (trigger === 'join' && exec === false) summary.push('出現するたび (リスポーン後も) に効きます')
  if (missing.length) summary.push(`「${missing.map(a => a.title).join('・')}」はこのきっかけでは使えないため省きました`)
  return { files, title, summary, spec: { kind: 'compose', trigger, actions: actions.map(a => a.id), params } }
}

function describeParams(a, p) {
  switch (a.id) {
    case 'damage': return `${p.amount} ダメージを与えます`
    case 'heal': return `体力を ${p.amount} 回復します`
    case 'speed': return `歩く速さを ${p.value} にします${p.duration && !p.hold ? ` (${p.duration} 秒間)` : ''}`
    case 'jump': return `ジャンプ力を ${p.value} にします${p.duration ? ` (${p.duration} 秒間)` : ''}`
    case 'fling': return `上に ${p.power} の速さで飛ばします`
    case 'teleport': return p.target ? `「${p.target}」へテレポートします` : p.pos ? `(${p.pos.join(', ')}) へテレポートします` : '「TeleportTarget」という名前のパーツへテレポートします'
    case 'color': return p.color.rainbow ? 'ランダムな色に変えます' : `${p.color.name}に変えます`
    case 'disappear': return p.destroy ? 'パーツを削除します' : `パーツを消します${p.respawn ? ` (${p.respawn} 秒後に戻ります)` : ''}`
    case 'coins': return `${p.stat} を ${p.amount} 増やします (leaderstats がなければ作ります)`
    case 'openDoor': return `ドアを${p.mode === 'swing' ? '回転させて' : '上にスライドして'}開け、${p.seconds} 秒後に閉じます`
    case 'giveTool': return `ServerStorage の「${p.name}」を渡します`
    default: return /する$/.test(a.title) ? a.title.replace(/する$/, 'します') : a.title.replace(/る$/, 'ます')
  }
}

function finish(out) {
  if (!out) return null
  // 構文チェック (生成したコードが壊れていないか)
  for (const f of out.files) {
    const err = checkSyntax(f.code)
    if (err) f.error = `${err.line} 行目: ${err.message}`
  }
  return out
}

// 「作れるもの」の例
export const EXAMPLES = {
  studio: ['触れたら死ぬブロック', 'クリックすると色が変わるパーツ', 'E キーでドアが開く', 'Shift を押している間だけ速く走る', '触れるとコインが 10 増えて消える', '3 秒ごとにパーツが降ってくる', 'データを保存するリーダーボード', 'ショップの UI', '追いかけてくる敵', '往復する床', '昼と夜のサイクル', 'ラウンドとタイマー', '二段ジャンプ', '剣のツール', '/speed で速くなるチャットコマンド'],
  executor: ['スピードを 50 にする', 'ボタンで速く歩くのを切り替える', 'ESP', '無限ジャンプ', 'F キーで飛ぶ', '壁抜け', 'ドラッグできるメニュー', 'G キーでテレポート'],
}
export { ACTIONS, TRIGGERS, RECIPES }
