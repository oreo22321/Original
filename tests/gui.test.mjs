// GUI エンジン (レイアウト計算・入力) のテスト:  node tests/gui.test.mjs
import { readFileSync } from 'node:fs'
import { createVM, formatError } from '../js/luau/vm.js'
import { installRoblox } from '../js/luau/roblox.js'
import { installExecutor } from '../js/luau/executor.js'
import { compileSelector, wrapLines } from '../js/luau/gui.js'

const api = JSON.parse(readFileSync(new URL('../data/roblox-api.json', import.meta.url), 'utf8'))

// スクリプトを実行し、終わったら (または ms 後に) 出力と GUI エンジンを返す
function run(src, { ms = 400, screen = [1000, 600], actions } = {}) {
  return new Promise(resolve => {
    const out = [], posts = []
    let vm, ctx
    const hooks = {
      output: (k, t) => out.push(k === 'print' ? t : `[${k}] ${t}`),
      onError: e => out.push('[error] ' + formatError(e)),
      onIdle: () => {},
      post: m => posts.push(m),
      touch: false, device: 'pc',
    }
    vm = createVM(hooks, { timeLimit: 3000 })
    ctx = { sched: vm.sched, hooks, api, fs: new Map(), fsFolders: new Set(), currentFile: 'main.lua', runContext: 'executor' }
    const rbx = installRoblox(vm.env, ctx)
    rbx.mountFiles({ 'main.lua': src }, 'P'); rbx.setScript('main.lua')
    installExecutor(vm.env, ctx, rbx)
    ctx.gui.setScreen(screen[0], screen[1])
    try { vm.run(src, 'main.lua') } catch (e) { out.push('[syntax] ' + formatError(e)) }
    setTimeout(async () => {
      if (actions) await actions(ctx.gui, out)
      setTimeout(() => { vm.sched.stop(); resolve({ out, posts, gui: ctx.gui }) }, 120)
    }, ms)
  })
}

let pass = 0, fail = 0
const eq = (name, got, want) => { if (got === want) pass++; else { fail++; console.log(`✕ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`) } }

const HEAD = `
local gui = Instance.new("ScreenGui")
gui.IgnoreGuiInset = true
gui.Parent = game:GetService("Players").LocalPlayer:WaitForChild("PlayerGui")
local function new(cls, props)
  local o = Instance.new(cls)
  for k, v in props do o[k] = v end
  return o
end
`

// ---- 1. 位置と大きさ (Scale / Offset / AnchorPoint / UIPadding / UIScale) ----
{
  const r = await run(HEAD + `
local f = new("Frame", { Size = UDim2.new(0.5, 0, 0, 100), Position = UDim2.fromScale(0.5, 0.5), AnchorPoint = Vector2.new(0.5, 0.5), Parent = gui })
print("f", f.AbsoluteSize.X, f.AbsoluteSize.Y, f.AbsolutePosition.X, f.AbsolutePosition.Y)
new("UIPadding", { PaddingLeft = UDim.new(0, 10), PaddingTop = UDim.new(0, 5), Parent = f })
local c = new("Frame", { Size = UDim2.fromScale(1, 1), Parent = f })
print("c", c.AbsoluteSize.X, c.AbsoluteSize.Y, c.AbsolutePosition.X)
local s = new("Frame", { Size = UDim2.fromOffset(100, 50), Parent = gui })
new("UIScale", { Scale = 2, Parent = s })
print("s", s.AbsoluteSize.X, s.AbsoluteSize.Y)
local d = Instance.new("Frame")
print("default size", d.Size.X.Offset, d.Size.Y.Offset)
`)
  // IgnoreGuiInset = true の ScreenGui では、AbsolutePosition.Y はトップバーの高さ (58) だけ上にずれる (Roblox と同じ)
  eq('scale/anchor', r.out[0], 'f 500 100 250 192')
  eq('padding', r.out[1], 'c 490 95 260')
  eq('UIScale', r.out[2], 's 200 100')
  eq('Instance.new Frame size is 0', r.out[3], 'default size 0 0')
}

// ---- 2. UIListLayout / AutomaticSize / Folder / AbsoluteContentSize ----
{
  const r = await run(HEAD + `
local list = new("Frame", { Size = UDim2.fromOffset(200, 0), AutomaticSize = Enum.AutomaticSize.Y, Parent = gui })
local layout = new("UIListLayout", { Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder, Parent = list })
for i = 1, 3 do new("Frame", { Size = UDim2.new(1, 0, 0, 20), LayoutOrder = 4 - i, Name = "Item" .. i, Parent = list }) end
print("list", list.AbsoluteSize.Y, layout.AbsoluteContentSize.Y, list.Item1.AbsolutePosition.Y, list.Item3.AbsolutePosition.Y)
local hidden = new("Frame", { Size = UDim2.new(1, 0, 0, 20), Visible = false, Parent = list })
print("hidden ignored", list.AbsoluteSize.Y)
local folder = new("Folder", { Parent = gui })
local inFolder = new("Frame", { Size = UDim2.fromOffset(10, 10), Position = UDim2.fromScale(0.5, 0), Parent = folder })
print("folder", inFolder.AbsolutePosition.X)
local h = new("Frame", { Size = UDim2.fromOffset(0, 30), AutomaticSize = Enum.AutomaticSize.X, Parent = gui })
new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Parent = h })
new("Frame", { Size = UDim2.fromOffset(40, 10), Parent = h }); new("Frame", { Size = UDim2.fromOffset(60, 10), Parent = h })
print("horizontal auto", h.AbsoluteSize.X)
local sf = new("ScrollingFrame", { Size = UDim2.fromOffset(100, 100), Parent = gui })
local l2 = new("UIListLayout", { Parent = sf })
for i = 1, 10 do new("Frame", { Size = UDim2.new(1, 0, 0, 30), Parent = sf }) end
print("content now", l2.AbsoluteContentSize.Y)
`)
  eq('list auto size', r.out[0], 'list 68 68 -10 -58')
  eq('invisible items ignored', r.out[1], 'hidden ignored 68')
  eq('folder is transparent', r.out[2], 'folder 500')
  eq('horizontal AutomaticSize X', r.out[3], 'horizontal auto 100')
  eq('AbsoluteContentSize read right after changes', r.out[4], 'content now 300')
}

// ---- 3. ScrollingFrame / AbsoluteSize の変化通知 ----
{
  const r = await run(HEAD + `
local sf = new("ScrollingFrame", { Size = UDim2.fromOffset(100, 100), CanvasSize = UDim2.new(0, 0, 0, 0), AutomaticCanvasSize = Enum.AutomaticSize.Y, Parent = gui })
new("UIListLayout", { Parent = sf })
for i = 1, 5 do new("Frame", { Size = UDim2.new(1, 0, 0, 50), Parent = sf }) end
print("canvas", sf.AbsoluteCanvasSize.Y)
local f = new("Frame", { Size = UDim2.fromOffset(10, 10), Parent = gui })
local n = 0
f:GetPropertyChangedSignal("AbsoluteSize"):Connect(function() n += 1 end)
local _ = f.AbsoluteSize
f.Size = UDim2.fromOffset(30, 10)
task.wait(0.1)
print("changed", n, f.AbsoluteSize.X)
`, { ms: 500 })
  eq('AutomaticCanvasSize', r.out[0], 'canvas 250')
  eq('AbsoluteSize changed signal', r.out[1], 'changed 1 30')
}

// ---- 4. 入力: クリック → Activated / InputBegan / ドラッグ / TextBox ----
{
  const r = await run(HEAD + `
local b = new("TextButton", { Size = UDim2.fromOffset(100, 40), Position = UDim2.fromOffset(10, 10), Text = "OK", Parent = gui })
b.Activated:Connect(function() print("activated") end)
b.MouseButton1Click:Connect(function() print("click") end)
local bar = new("Frame", { Size = UDim2.fromOffset(200, 20), Position = UDim2.fromOffset(10, 100), Parent = gui })
local Mouse = game.Players.LocalPlayer:GetMouse()
bar.InputBegan:Connect(function(input)
  if input.UserInputType ~= Enum.UserInputType.MouseButton1 then return end
  print("began", input.UserInputState.Name)
  while input.UserInputState ~= Enum.UserInputState.End do task.wait() end
  print("drag end at", Mouse.X)
end)
local box = new("TextBox", { Size = UDim2.fromOffset(100, 30), Position = UDim2.fromOffset(10, 200), Text = "", Parent = gui })
box.FocusLost:Connect(function(enter) print("focuslost", enter, box.Text) end)
game:GetService("UserInputService").InputBegan:Connect(function(input, gp)
  if input.KeyCode == Enum.KeyCode.F then print("key F", gp) end
end)
`, {
    ms: 300,
    actions: async (gui) => {
      const wait = ms => new Promise(r => setTimeout(r, ms))
      gui.input({ kind: 'pointer', phase: 'down', x: 30, y: 20, pointer: 'mouse', button: 0 })
      gui.input({ kind: 'pointer', phase: 'up', x: 30, y: 20, pointer: 'mouse', button: 0 })
      await wait(50)
      gui.input({ kind: 'pointer', phase: 'down', x: 20, y: 110, pointer: 'mouse', button: 0 })
      await wait(40)
      gui.input({ kind: 'pointer', phase: 'move', x: 120, y: 110, pointer: 'mouse' })
      await wait(40)
      gui.input({ kind: 'pointer', phase: 'up', x: 150, y: 110, pointer: 'mouse', button: 0 })
      await wait(60)
      gui.input({ kind: 'pointer', phase: 'down', x: 20, y: 210, pointer: 'touch' })
      gui.input({ kind: 'pointer', phase: 'up', x: 20, y: 210, pointer: 'touch' })
      await wait(30)
      const id = [...gui.byId.entries()].find(([, n]) => n.ClassName === 'TextBox')[0]
      gui.input({ kind: 'text', id, text: 'hello', done: true, enter: true })
      gui.input({ kind: 'key', key: 'F', down: true })
      gui.input({ kind: 'key', key: 'F', down: false })
      await wait(30)
    },
  })
  const o = r.out.join(' | ')
  eq('click fires Activated + MouseButton1Click', /activated/.test(o) && /click/.test(o), true)
  eq('drag: InputBegan then End with live Mouse.X', /began Begin/.test(o) && /drag end at 150/.test(o), true)
  eq('TextBox focus/text/FocusLost', /focuslost true hello/.test(o), true)
  eq('keyboard InputBegan', /key F false/.test(o), true)
  eq('focus overlay requested', r.posts.some(p => p.type === 'guiFocus' && p.id), true)
}

// ---- 5. 描画データ (差分) ----
{
  const r = await run(HEAD + `
local f = new("Frame", { Size = UDim2.fromOffset(100, 50), BackgroundColor3 = Color3.fromRGB(255, 0, 0), Parent = gui })
new("UICorner", { CornerRadius = UDim.new(0, 6), Parent = f })
new("TextLabel", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Text = "<b>Hi</b>", RichText = true, Parent = f })
task.wait(0.15)
f.Position = UDim2.fromOffset(20, 0)
`, { ms: 450 })
  const patches = r.posts.filter(p => p.type === 'gui').map(p => p.patch)
  const first = patches[0]
  eq('first patch is full', !!(first && first.full), true)
  const frame = first && first.set.find(([, p]) => p.bg === 'rgba(255,0,0,1)')
  eq('frame color + radius', frame && frame[1].r, 6)
  eq('rich text sent', !!(first && first.set.find(([, p]) => p.rich && p.t === '<b>Hi</b>')), true)
  const later = patches.slice(1).flatMap(p => p.set)
  eq('later patch only has moved nodes', later.length > 0 && later.every(([, p]) => p.x === 20), true)
}

// ---- 6. QueryDescendants / 折り返し ----
{
  const r = await run(HEAD + `
local a = new("Frame", { Name = "A", Parent = gui })
local b = new("TextLabel", { Name = "B", Parent = a })
local c = new("ImageButton", { Name = "C", Parent = a })
print(#gui:QueryDescendants("TextLabel, ImageButton"), #gui:QueryDescendants("GuiObject:not(Frame)"), #gui:QueryDescendants("#A > TextLabel"))
`)
  eq('QueryDescendants selectors', r.out[0], '2 2 1')
  const lines = wrapLines('hello world foo bar', 10, { kind: 'sans', weight: 400, key: 't' }, 40, true)
  eq('wrap splits long text', lines.length > 1, true)
  eq('compileSelector class', compileSelector('Frame')({ info: { isA: new Set(['Frame']) } }), true)
}

console.log(`gui: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
