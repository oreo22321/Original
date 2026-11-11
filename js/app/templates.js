// 新規プロジェクトのテンプレート
// kind: 'studio' (Roblox Studio 用) / 'executor' (エグゼキューター用)
export const TEMPLATES = {
  studio: {
    name: 'Roblox ゲーム',
    desc: 'サーバー / クライアント / モジュールの基本構成',
    icon: 'cube', kind: 'studio',
    main: 'src/server/main.server.luau',
    files: {
      'src/server/main.server.luau': `--!strict
-- サーバースクリプト: プレイヤーが参加したらコインを配ります
-- ▶ ボタンで実行すると、Roblox を模したサンドボックスで動作を確認できます

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Util = require(script.Parent.Parent.shared.Util)

local START_COINS = 100

Players.PlayerAdded:Connect(function(player: Player)
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"
	leaderstats.Parent = player

	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Value = START_COINS
	coins.Parent = leaderstats

	print(\`{player.Name} が参加しました。コイン: {Util.formatNumber(coins.Value)}\`)

	player.CharacterAdded:Connect(function(character)
		local humanoid = character:WaitForChild("Humanoid") :: Humanoid
		humanoid.WalkSpeed = 20
		print("キャラクターが出現しました。WalkSpeed =", humanoid.WalkSpeed)
	end)
end)

-- 3 秒ごとにコインを増やす
task.spawn(function()
	for i = 1, 3 do
		task.wait(1)
		for _, player in Players:GetPlayers() do
			local coins = player:FindFirstChild("leaderstats") and player.leaderstats:FindFirstChild("Coins")
			if coins then
				coins.Value += 10
				print(\`[{i}] {player.Name} のコイン → {coins.Value}\`)
			end
		end
	end
end)
`,
      'src/client/main.client.luau': `-- クライアントスクリプト: 画面にボタンを表示します
local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

local gui = Instance.new("ScreenGui")
gui.Name = "MainGui"
gui.ResetOnSpawn = false

local button = Instance.new("TextButton")
button.Size = UDim2.fromOffset(200, 60)
button.Position = UDim2.fromScale(0.5, 0.8)
button.AnchorPoint = Vector2.new(0.5, 0.5)
button.BackgroundColor3 = Color3.fromRGB(0, 170, 255)
button.TextColor3 = Color3.fromRGB(255, 255, 255)
button.Text = "クリック!"
button.TextScaled = true
button.Parent = gui

local corner = Instance.new("UICorner")
corner.CornerRadius = UDim.new(0, 12)
corner.Parent = button

gui.Parent = playerGui

local clicks = 0
button.Activated:Connect(function()
	clicks += 1
	button.Text = \`{clicks} 回クリック\`
	TweenService:Create(button, TweenInfo.new(0.15), { Size = UDim2.fromOffset(220, 66) }):Play()
end)

print("GUI を作成しました:", gui:GetFullName())
`,
      'src/shared/Util.luau': `-- 共有モジュール: サーバーとクライアントの両方から require できます
local Util = {}

-- 1234567 → "1,234,567"
function Util.formatNumber(n: number): string
	local s = tostring(math.floor(n))
	local formatted = s:reverse():gsub("(%d%d%d)", "%1,"):reverse()
	return (formatted:gsub("^,", ""))
end

function Util.lerp(a: number, b: number, t: number): number
	return a + (b - a) * t
end

return Util
`,
      'README.md': `# Roblox ゲーム

- \`src/server\` … サーバースクリプト (\`.server.luau\`)
- \`src/client\` … クライアントスクリプト (\`.client.luau\`)
- \`src/shared\` … 共有モジュール

ファイルを開いて ▶ を押すと、Roblox の動作を模したサンドボックスで実行できます。
クライアントスクリプトを実行すると、下の「ゲーム」タブに GUI が表示され、ボタンをタップして試せます。
完成したらコードをコピーして Roblox Studio に貼り付けてください。
`,
    },
  },
  studioEmpty: {
    name: '空の Studio プロジェクト',
    desc: 'サーバースクリプト 1 つから始めます',
    icon: 'file', kind: 'studio',
    main: 'main.server.luau',
    files: { 'main.server.luau': '-- サーバースクリプト\nlocal Players = game:GetService("Players")\n\n' },
  },
  executor: {
    name: 'エグゼキュータースクリプト',
    desc: '設定の保存・二重実行の防止など、基本のひな形',
    icon: 'bolt', kind: 'executor',
    main: 'main.lua',
    files: {
      'main.lua': `-- エグゼキューター用スクリプトの例
-- ▶ で実行すると、エグゼキューター API (getgenv, writefile など) を模したサンドボックスで動作確認できます
-- 完成したら上部の「コピー」ボタンでコピーして、エグゼキューターに貼り付けてください

local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local player = Players.LocalPlayer

print("実行環境:", identifyexecutor())

-- 設定の保存と読み込み (workspace フォルダに保存されます)
local CONFIG_FILE = "MyScript/config.json"

local function loadConfig()
	if isfile(CONFIG_FILE) then
		return HttpService:JSONDecode(readfile(CONFIG_FILE))
	end
	return { walkSpeed = 16, runs = 0 }
end

local function saveConfig(config)
	if not isfolder("MyScript") then
		makefolder("MyScript")
	end
	writefile(CONFIG_FILE, HttpService:JSONEncode(config))
end

local config = loadConfig()
config.runs += 1
saveConfig(config)
print(\`このスクリプトの実行回数: {config.runs}\`)

-- 二重実行の防止
if getgenv().MyScriptLoaded then
	warn("既に読み込まれています")
	return
end
getgenv().MyScriptLoaded = true

-- キャラクターの速度を変更
local character = player.Character or player.CharacterAdded:Wait()
local humanoid = character:WaitForChild("Humanoid")
humanoid.WalkSpeed = config.walkSpeed
print("WalkSpeed:", humanoid.WalkSpeed)

-- 通知
game:GetService("StarterGui"):SetCore("SendNotification", {
	Title = "MyScript",
	Text = "読み込みが完了しました",
	Duration = 5,
})
`,
      'workspace/': '',
      'README.md': `# エグゼキュータースクリプト

- \`workspace/\` フォルダは、\`readfile\` / \`writefile\` などのファイル関数の保存先です。
- エディタ上部の「コピー」でスクリプト全体をコピーできます。
`,
    },
  },
  executorGui: {
    name: 'GUI 付きスクリプト',
    desc: 'ウィンドウとボタンを表示するひな形 (プレビューで操作できます)',
    icon: 'window', kind: 'executor',
    main: 'main.lua',
    files: {
      'main.lua': `-- GUI 付きエグゼキュータースクリプトのひな形
-- ▶ で実行すると、下の「ゲーム」タブに GUI が表示されます。ボタンをタップして動作を確認できます

local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local player = Players.LocalPlayer

-- 二重実行の防止: 前回の GUI が残っていたら消す
if getgenv().MyHub then
	getgenv().MyHub:Destroy()
end

-- ---- 設定の保存と読み込み (workspace フォルダ) ----
local CONFIG_FILE = "MyHub/config.json"
local config = { clicks = 0, notify = true }

if isfile(CONFIG_FILE) then
	local ok, data = pcall(function()
		return HttpService:JSONDecode(readfile(CONFIG_FILE))
	end)
	if ok and type(data) == "table" then
		for key, value in pairs(data) do
			config[key] = value
		end
	end
end

local function saveConfig()
	if not isfolder("MyHub") then
		makefolder("MyHub")
	end
	writefile(CONFIG_FILE, HttpService:JSONEncode(config))
end

-- ---- GUI を作る ----
local function create(className, props)
	local inst = Instance.new(className)
	for key, value in pairs(props) do
		inst[key] = value
	end
	return inst
end

local gui = create("ScreenGui", { Name = "MyHub", ResetOnSpawn = false, Parent = gethui() })
getgenv().MyHub = gui

local window = create("Frame", {
	Size = UDim2.fromOffset(260, 230),
	Position = UDim2.fromScale(0.5, 0.5),
	AnchorPoint = Vector2.new(0.5, 0.5),
	BackgroundColor3 = Color3.fromRGB(24, 26, 32),
	Parent = gui,
})
create("UICorner", { CornerRadius = UDim.new(0, 12), Parent = window })
create("UIStroke", { Color = Color3.fromRGB(70, 76, 92), Thickness = 1, Parent = window })

create("TextLabel", {
	Size = UDim2.new(1, 0, 0, 40),
	BackgroundTransparency = 1,
	Text = "My Hub",
	TextColor3 = Color3.fromRGB(255, 255, 255),
	TextSize = 18,
	Font = Enum.Font.GothamBold,
	Parent = window,
})

local list = create("Frame", {
	Size = UDim2.new(1, -24, 1, -52),
	Position = UDim2.fromOffset(12, 44),
	BackgroundTransparency = 1,
	Parent = window,
})
create("UIListLayout", { Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder, Parent = list })

local function addButton(text, onClick)
	local button = create("TextButton", {
		Size = UDim2.new(1, 0, 0, 36),
		BackgroundColor3 = Color3.fromRGB(45, 110, 240),
		Text = text,
		TextColor3 = Color3.fromRGB(255, 255, 255),
		TextSize = 15,
		Font = Enum.Font.Gotham,
		AutoButtonColor = true,
		Parent = list,
	})
	create("UICorner", { CornerRadius = UDim.new(0, 8), Parent = button })
	button.Activated:Connect(function()
		onClick(button)
	end)
	return button
end

-- ---- ボタンの動作 ----
addButton(\`クリック回数: {config.clicks}\`, function(button)
	config.clicks += 1
	button.Text = \`クリック回数: {config.clicks}\`
	saveConfig()
end)

addButton("通知: " .. (config.notify and "オン" or "オフ"), function(button)
	config.notify = not config.notify
	button.Text = "通知: " .. (config.notify and "オン" or "オフ")
	saveConfig()
end)

addButton("自分の位置をコピー", function()
	local character = player.Character or player.CharacterAdded:Wait()
	local root = character:WaitForChild("HumanoidRootPart")
	setclipboard(tostring(root.Position))
	if config.notify then
		game:GetService("StarterGui"):SetCore("SendNotification", { Title = "My Hub", Text = "位置をコピーしました", Duration = 3 })
	end
end)

addButton("閉じる", function()
	gui:Destroy()
	getgenv().MyHub = nil
	print("GUI を閉じました")
end)

print("読み込み完了:", identifyexecutor())
`,
      'workspace/': '',
    },
  },
  executorEmpty: {
    name: '空のスクリプト',
    desc: '何もない状態から書き始めます',
    icon: 'file', kind: 'executor',
    main: 'main.lua',
    files: { 'main.lua': '', 'workspace/': '' },
  },
}

// 「新しいファイル」の種類 (モードごと)
export const NEW_FILE_TEMPLATES = {
  studio: {
    'Script (サーバー)': { ext: '.server.luau', stem: 'Script', content: 'local Players = game:GetService("Players")\n\n' },
    'LocalScript (クライアント)': { ext: '.client.luau', stem: 'LocalScript', content: 'local Players = game:GetService("Players")\nlocal player = Players.LocalPlayer\n\n' },
    'ModuleScript': { ext: '.luau', stem: 'Module', content: 'local Module = {}\n\n\n\nreturn Module\n' },
    'JSON': { ext: '.json', stem: 'data', content: '{\n  \n}\n' },
    'メモ': { ext: '.md', stem: 'README', content: '# タイトル\n' },
  },
  executor: {
    'スクリプト': { ext: '.lua', stem: 'script', content: '' },
    'モジュール': { ext: '.lua', stem: 'module', content: 'local Module = {}\n\n\n\nreturn Module\n' },
    'JSON': { ext: '.json', stem: 'config', content: '{\n  \n}\n' },
    'テキスト': { ext: '.txt', stem: 'note', content: '' },
    'メモ': { ext: '.md', stem: 'README', content: '# タイトル\n' },
  },
}
