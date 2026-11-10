// 新規プロジェクトのテンプレート
export const TEMPLATES = {
  roblox: {
    name: 'Roblox ゲーム',
    desc: 'サーバー / クライアント / モジュールの基本構成 (Luau)',
    icon: '🎮',
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
完成したらコードをコピーして Roblox Studio に貼り付けてください。
`,
    },
  },
  executor: {
    name: 'エグゼキュータースクリプト',
    desc: 'getgenv / writefile などのエグゼキューター API を使う Luau',
    icon: '⚡',
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
  python: {
    name: 'Python',
    desc: 'Python 3 (ブラウザ内で実行)',
    icon: '🐍',
    main: 'main.py',
    files: {
      'main.py': `# Python のサンプル
# ▶ で実行します (初回は Python 本体の読み込みに少し時間がかかります)
from utils import greet, fizzbuzz

name = input("名前を入力してください: ")
print(greet(name))

for line in fizzbuzz(15):
    print(line)

scores = {"国語": 82, "数学": 95, "英語": 77}
average = sum(scores.values()) / len(scores)
print(f"平均点: {average:.1f}")
best = max(scores, key=scores.get)
print(f"最高点の科目: {best} ({scores[best]} 点)")
`,
      'utils.py': `def greet(name: str) -> str:
    """あいさつ文を返します"""
    if not name:
        name = "ゲスト"
    return f"こんにちは、{name} さん!"


def fizzbuzz(n: int) -> list[str]:
    result = []
    for i in range(1, n + 1):
        if i % 15 == 0:
            result.append("FizzBuzz")
        elif i % 3 == 0:
            result.append("Fizz")
        elif i % 5 == 0:
            result.append("Buzz")
        else:
            result.append(str(i))
    return result
`,
    },
  },
  lua: {
    name: 'Lua の練習',
    desc: 'Lua / Luau の基本文法をひと通り試せます',
    icon: '🌙',
    main: 'main.lua',
    files: {
      'main.lua': `-- Lua / Luau の基本
-- ▶ を押すと下のパネルに結果が表示されます

-- 変数と型
local name = "Lua"
local version = 5.1
local isFun = true
print(name, version, isFun, type(name))

-- テーブル (配列)
local fruits = { "りんご", "バナナ", "みかん" }
table.insert(fruits, "ぶどう")
for i, fruit in ipairs(fruits) do
	print(i, fruit)
end

-- テーブル (辞書)
local player = { name = "Alex", level = 5, hp = 100 }
for key, value in pairs(player) do
	print(key, "=", value)
end

-- 関数
local function add(a, b)
	return a + b
end
print("1 + 2 =", add(1, 2))

-- Luau の便利な書き方
local count = 0
count += 1
print(\`count は {count} です\`)
local label = if count > 0 then "正" else "0 以下"
print(label)

-- エラー処理
local ok, err = pcall(function()
	error("わざとエラー")
end)
print("pcall:", ok, err)
`,
    },
  },
  empty: {
    name: '空のプロジェクト',
    desc: '何もない状態から始めます',
    icon: '📄',
    main: 'main.lua',
    files: { 'main.lua': '' },
  },
}

export const NEW_FILE_TEMPLATES = {
  'Script (サーバー)': { ext: '.server.luau', content: 'local Players = game:GetService("Players")\n\n' },
  'LocalScript (クライアント)': { ext: '.client.luau', content: 'local Players = game:GetService("Players")\nlocal player = Players.LocalPlayer\n\n' },
  'ModuleScript': { ext: '.luau', content: 'local module = {}\n\n\n\nreturn module\n' },
  'Lua': { ext: '.lua', content: '' },
  'Python': { ext: '.py', content: '' },
  'Markdown': { ext: '.md', content: '# タイトル\n' },
  'JSON': { ext: '.json', content: '{\n  \n}\n' },
  'テキスト': { ext: '.txt', content: '' },
}
