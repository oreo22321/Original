// スニペット (${1:名前} はタブで移動できる入力欄)
export const LUAU_SNIPPETS = [
  { label: 'function', detail: '関数', body: 'function ${1:name}(${2})\n\t${3}\nend' },
  { label: 'local function', detail: 'ローカル関数', body: 'local function ${1:name}(${2})\n\t${3}\nend' },
  { label: 'if', detail: 'if 文', body: 'if ${1:condition} then\n\t${2}\nend' },
  { label: 'ifelse', detail: 'if ... else', body: 'if ${1:condition} then\n\t${2}\nelse\n\t${3}\nend' },
  { label: 'elseif', detail: 'elseif 節', body: 'elseif ${1:condition} then\n\t${2}' },
  { label: 'for', detail: '数値 for ループ', body: 'for ${1:i} = ${2:1}, ${3:10} do\n\t${4}\nend' },
  { label: 'fori', detail: 'ipairs ループ', body: 'for ${1:i}, ${2:v} in ipairs(${3:t}) do\n\t${4}\nend' },
  { label: 'forp', detail: 'pairs ループ', body: 'for ${1:k}, ${2:v} in pairs(${3:t}) do\n\t${4}\nend' },
  { label: 'forin', detail: '汎用反復 (Luau)', body: 'for ${1:k}, ${2:v} in ${3:t} do\n\t${4}\nend' },
  { label: 'while', detail: 'while ループ', body: 'while ${1:true} do\n\t${2}\nend' },
  { label: 'whilewait', detail: 'task.wait 付き無限ループ', body: 'while true do\n\t${1}\n\ttask.wait(${2:1})\nend' },
  { label: 'repeat', detail: 'repeat ... until', body: 'repeat\n\t${1}\nuntil ${2:condition}' },
  { label: 'pcall', detail: 'エラーを捕まえる', body: 'local ok, err = pcall(function()\n\t${1}\nend)\nif not ok then\n\twarn(err)\nend' },
  { label: 'getservice', detail: 'サービスの取得', body: 'local ${1:Players} = game:GetService("${1:Players}")' },
  { label: 'connect', detail: 'イベントに接続', body: '${1:event}:Connect(function(${2})\n\t${3}\nend)' },
  { label: 'playeradded', detail: 'PlayerAdded', body: 'game:GetService("Players").PlayerAdded:Connect(function(player)\n\t${1}\nend)' },
  { label: 'characteradded', detail: 'CharacterAdded', body: 'player.CharacterAdded:Connect(function(character)\n\tlocal humanoid = character:WaitForChild("Humanoid")\n\t${1}\nend)' },
  { label: 'leaderstats', detail: 'リーダーボードの作成', body: 'game:GetService("Players").PlayerAdded:Connect(function(player)\n\tlocal leaderstats = Instance.new("Folder")\n\tleaderstats.Name = "leaderstats"\n\tleaderstats.Parent = player\n\n\tlocal ${1:Coins} = Instance.new("IntValue")\n\t${1:Coins}.Name = "${1:Coins}"\n\t${1:Coins}.Value = ${2:0}\n\t${1:Coins}.Parent = leaderstats\nend)' },
  { label: 'touched', detail: 'パーツに触れたとき', body: '${1:part}.Touched:Connect(function(hit)\n\tlocal humanoid = hit.Parent:FindFirstChildOfClass("Humanoid")\n\tif humanoid then\n\t\t${2}\n\tend\nend)' },
  { label: 'tween', detail: 'TweenService でアニメーション', body: 'local TweenService = game:GetService("TweenService")\nlocal tween = TweenService:Create(${1:part}, TweenInfo.new(${2:1}, Enum.EasingStyle.${3:Quad}), {${4:Transparency = 1}})\ntween:Play()' },
  { label: 'inputbegan', detail: 'キー入力', body: 'game:GetService("UserInputService").InputBegan:Connect(function(input, gameProcessed)\n\tif gameProcessed then return end\n\tif input.KeyCode == Enum.KeyCode.${1:E} then\n\t\t${2}\n\tend\nend)' },
  { label: 'heartbeat', detail: '毎フレーム実行', body: 'game:GetService("RunService").Heartbeat:Connect(function(dt)\n\t${1}\nend)' },
  { label: 'remoteevent', detail: 'RemoteEvent (サーバー側)', body: 'local ${1:remote} = game:GetService("ReplicatedStorage"):WaitForChild("${2:RemoteEvent}")\n${1:remote}.OnServerEvent:Connect(function(player, ${3:...})\n\t${4}\nend)' },
  { label: 'module', detail: 'ModuleScript の雛形', body: 'local ${1:Module} = {}\n\nfunction ${1:Module}.${2:new}()\n\t${3}\nend\n\nreturn ${1:Module}' },
  { label: 'class', detail: 'クラス (メタテーブル)', body: 'local ${1:Class} = {}\n${1:Class}.__index = ${1:Class}\n\nfunction ${1:Class}.new(${2})\n\tlocal self = setmetatable({}, ${1:Class})\n\t${3}\n\treturn self\nend\n\nfunction ${1:Class}:${4:method}()\n\t${5}\nend\n\nreturn ${1:Class}' },
  { label: 'instance', detail: 'Instance.new', body: 'local ${1:part} = Instance.new("${2:Part}")\n${1:part}.Name = "${3:${2:Part}}"\n${1:part}.Parent = ${4:workspace}' },
  { label: 'localplayer', detail: 'ローカルプレイヤーとキャラクター', body: 'local player = game:GetService("Players").LocalPlayer\nlocal character = player.Character or player.CharacterAdded:Wait()\nlocal humanoid = character:WaitForChild("Humanoid")' },
  { label: 'screengui', detail: 'GUI の作成', body: 'local gui = Instance.new("ScreenGui")\ngui.Name = "${1:MyGui}"\ngui.ResetOnSpawn = false\ngui.Parent = game:GetService("Players").LocalPlayer:WaitForChild("PlayerGui")\n\nlocal button = Instance.new("TextButton")\nbutton.Size = UDim2.fromOffset(200, 50)\nbutton.Position = UDim2.fromScale(0.5, 0.5)\nbutton.AnchorPoint = Vector2.new(0.5, 0.5)\nbutton.Text = "${2:Click}"\nbutton.Parent = gui\nbutton.Activated:Connect(function()\n\t${3}\nend)' },
  { label: 'datastore', detail: 'DataStore の保存/読み込み', body: 'local DataStoreService = game:GetService("DataStoreService")\nlocal store = DataStoreService:GetDataStore("${1:PlayerData}")\n\nlocal ok, data = pcall(function()\n\treturn store:GetAsync(${2:key})\nend)\nif ok then\n\t${3}\nelse\n\twarn("読み込み失敗:", data)\nend' },
  { label: 'typedef', detail: '型の定義', body: 'type ${1:Name} = {\n\t${2:field}: ${3:number},\n}' },
  { label: 'loadstring', detail: 'URL のスクリプトを実行 (エグゼキューター)', body: 'loadstring(game:HttpGet("${1:https://raw.githubusercontent.com/user/repo/main/script.lua}"))()' },
  { label: 'writefile', detail: '設定の保存 (エグゼキューター)', body: 'local HttpService = game:GetService("HttpService")\nlocal FILE = "${1:config.json}"\n\nlocal function save(data)\n\twritefile(FILE, HttpService:JSONEncode(data))\nend\n\nlocal function load()\n\tif isfile(FILE) then\n\t\treturn HttpService:JSONDecode(readfile(FILE))\n\tend\n\treturn {}\nend' },
  { label: 'hookmetamethod', detail: '__namecall フック (エグゼキューター)', body: 'local old\nold = hookmetamethod(game, "__namecall", newcclosure(function(self, ...)\n\tlocal method = getnamecallmethod()\n\t${1}\n\treturn old(self, ...)\nend))' },
  { label: 'genvguard', detail: '二重実行の防止 (エグゼキューター)', body: 'if getgenv().${1:MyScript}Loaded then\n\twarn("${1:MyScript} は既に読み込まれています")\n\treturn\nend\ngetgenv().${1:MyScript}Loaded = true\n${2}' },
  { label: 'gethui', detail: 'GUI を作る (エグゼキューター)', body: 'local gui = Instance.new("ScreenGui")\ngui.Name = "${1:MyGui}"\ngui.ResetOnSpawn = false\ngui.Parent = gethui()\n\nlocal frame = Instance.new("Frame")\nframe.Size = UDim2.fromOffset(${2:240}, ${3:160})\nframe.Position = UDim2.fromScale(0.5, 0.5)\nframe.AnchorPoint = Vector2.new(0.5, 0.5)\nframe.BackgroundColor3 = Color3.fromRGB(24, 26, 32)\nframe.Parent = gui\n${4}' },
  { label: 'request', detail: 'HTTP リクエスト (エグゼキューター)', body: 'local response = request({\n\tUrl = "${1:https://example.com/api}",\n\tMethod = "${2:GET}",\n})\nif response.Success then\n\tprint(response.Body)\nelse\n\twarn("失敗:", response.StatusCode)\nend' },
  { label: 'requestjson', detail: 'JSON を POST (エグゼキューター)', body: 'local HttpService = game:GetService("HttpService")\nlocal response = request({\n\tUrl = "${1:https://example.com/api}",\n\tMethod = "POST",\n\tHeaders = { ["Content-Type"] = "application/json" },\n\tBody = HttpService:JSONEncode({ ${2:key} = ${3:"value"} }),\n})\nprint(response.StatusCode, response.Body)' },
  { label: 'unccheck', detail: '関数が使えるか確認 (エグゼキューター)', body: 'for _, name in { ${1:"writefile", "readfile", "request"} } do\n\tif not getgenv()[name] then\n\t\twarn(`このエグゼキューターは {name} に対応していません`)\n\t\treturn\n\tend\nend' },
  { label: 'drawingtext', detail: 'Drawing で文字を表示 (エグゼキューター)', body: 'local label = Drawing.new("Text")\nlabel.Text = "${1:Hello}"\nlabel.Size = ${2:20}\nlabel.Color = Color3.fromRGB(255, 255, 255)\nlabel.Outline = true\nlabel.Position = Vector2.new(${3:20}, ${4:20})\nlabel.Visible = true' },
  { label: 'drawingline', detail: 'Drawing で線を描く (エグゼキューター)', body: 'local line = Drawing.new("Line")\nline.From = Vector2.new(${1:0}, ${2:0})\nline.To = Vector2.new(${3:200}, ${4:200})\nline.Color = Color3.fromRGB(255, 255, 255)\nline.Thickness = ${5:2}\nline.Visible = true' },
  { label: 'queueteleport', detail: 'テレポート後も実行 (エグゼキューター)', body: 'queue_on_teleport([[\n\tloadstring(game:HttpGet("${1:https://example.com/script.lua}"))()\n]])' },
  { label: 'getconnections', detail: 'シグナルの接続を調べる (エグゼキューター)', body: 'for _, connection in getconnections(${1:signal}) do\n\t${2:connection:Disable()}\nend' },
  { label: 'hookfunction', detail: '関数をフック (エグゼキューター)', body: 'local old\nold = hookfunction(${1:target}, newcclosure(function(...)\n\t${2}\n\treturn old(...)\nend))' },
  { label: 'keytoggle', detail: 'キーで GUI の表示を切り替え', body: 'game:GetService("UserInputService").InputBegan:Connect(function(input, gameProcessed)\n\tif gameProcessed then return end\n\tif input.KeyCode == Enum.KeyCode.${1:RightShift} then\n\t\t${2:gui}.Enabled = not ${2:gui}.Enabled\n\tend\nend)' },
  { label: 'draggable', detail: 'GUI をドラッグで動かせるようにする', body: 'local UserInputService = game:GetService("UserInputService")\nlocal dragging, dragStart, startPos\n${1:frame}.InputBegan:Connect(function(input)\n\tif input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then\n\t\tdragging = true\n\t\tdragStart = input.Position\n\t\tstartPos = ${1:frame}.Position\n\tend\nend)\nUserInputService.InputChanged:Connect(function(input)\n\tif dragging and (input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch) then\n\t\tlocal delta = input.Position - dragStart\n\t\t${1:frame}.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset + delta.X, startPos.Y.Scale, startPos.Y.Offset + delta.Y)\n\tend\nend)\nUserInputService.InputEnded:Connect(function(input)\n\tif input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then\n\t\tdragging = false\n\tend\nend)' },
  { label: 'notify', detail: '通知を表示', body: 'game:GetService("StarterGui"):SetCore("SendNotification", {\n\tTitle = "${1:タイトル}",\n\tText = "${2:メッセージ}",\n\tDuration = ${3:5},\n})' },
]

// ============================================================
// UI ライブラリのひな形 (エグゼキューター)。URL は公式の配布元
// 実行すると、ライブラリの中身を自動で取得して補完にも使います
// ============================================================
export const UI_LIBRARIES = [
  {
    id: 'obsidian', name: 'Obsidian', desc: 'Linoria 系のモダンな UI。タブ・グループ・トグル・スライダーなど',
    body: 'local repo = "https://raw.githubusercontent.com/deividcomsono/Obsidian/main/"\nlocal Library = loadstring(game:HttpGet(repo .. "Library.lua"))()\n\nlocal Window = Library:CreateWindow({\n\tTitle = "${1:My Script}",\n\tFooter = "v1.0",\n\tCenter = true,\n\tAutoShow = true,\n})\nlocal Tab = Window:AddTab("Main", "user")\nlocal Group = Tab:AddLeftGroupbox("${2:Main}")\n\nGroup:AddToggle("MyToggle", {\n\tText = "Toggle",\n\tDefault = false,\n\tCallback = function(Value)\n\t\tprint("Toggle:", Value)\n\tend,\n})\nGroup:AddSlider("MySlider", {\n\tText = "Speed",\n\tDefault = 16,\n\tMin = 0,\n\tMax = 100,\n\tRounding = 0,\n\tCallback = function(Value)\n\t\tprint("Speed:", Value)\n\tend,\n})\nGroup:AddButton("Button", function()\n\tprint("Clicked")\nend)\n${0}',
  },
  {
    id: 'linoria', name: 'LinoriaLib', desc: '定番のシンプルな UI',
    body: 'local repo = "https://raw.githubusercontent.com/violin-suzutsuki/LinoriaLib/main/"\nlocal Library = loadstring(game:HttpGet(repo .. "Library.lua"))()\n\nlocal Window = Library:CreateWindow({\n\tTitle = "${1:My Script}",\n\tCenter = true,\n\tAutoShow = true,\n})\nlocal Tab = Window:AddTab("Main")\nlocal Group = Tab:AddLeftGroupbox("${2:Main}")\n\nGroup:AddToggle("MyToggle", {\n\tText = "Toggle",\n\tDefault = false,\n})\nToggles.MyToggle:OnChanged(function()\n\tprint("Toggle:", Toggles.MyToggle.Value)\nend)\nGroup:AddButton("Button", function()\n\tprint("Clicked")\nend)\n${0}',
  },
  {
    id: 'orion', name: 'Orion', desc: '丸みのあるダークな UI',
    body: 'local OrionLib = loadstring(game:HttpGet("https://raw.githubusercontent.com/jensonhirst/Orion/main/source"))()\n\nlocal Window = OrionLib:MakeWindow({ Name = "${1:My Script}", SaveConfig = false, IntroEnabled = false })\nlocal Tab = Window:MakeTab({ Name = "Main", PremiumOnly = false })\n\nTab:AddToggle({\n\tName = "Toggle",\n\tDefault = false,\n\tCallback = function(Value)\n\t\tprint("Toggle:", Value)\n\tend,\n})\nTab:AddButton({\n\tName = "Button",\n\tCallback = function()\n\t\tprint("Clicked")\n\tend,\n})\n${0}\nOrionLib:Init()',
  },
  {
    id: 'kavo', name: 'Kavo', desc: 'テーマを選べる古典的な UI',
    body: 'local Library = loadstring(game:HttpGet("https://raw.githubusercontent.com/xHeptc/Kavo-UI-Library/main/source.lua"))()\n\nlocal Window = Library.CreateLib("${1:My Script}", "DarkTheme")\nlocal Tab = Window:NewTab("Main")\nlocal Section = Tab:NewSection("${2:Main}")\n\nSection:NewToggle("Toggle", "説明", function(state)\n\tprint("Toggle:", state)\nend)\nSection:NewButton("Button", "説明", function()\n\tprint("Clicked")\nend)\n${0}',
  },
  {
    id: 'windui', name: 'WindUI', desc: 'アイコン付きのモダンな UI',
    body: 'local WindUI = loadstring(game:HttpGet("https://raw.githubusercontent.com/Footagesus/WindUI/main/dist/main.lua"))()\n\nlocal Window = WindUI:CreateWindow({\n\tTitle = "${1:My Script}",\n\tIcon = "door-open",\n\tAuthor = "me",\n\tFolder = "MyScript",\n})\nlocal Tab = Window:Tab({ Title = "Main", Icon = "bird" })\nWindow:SelectTab(1)\n\nTab:Toggle({\n\tTitle = "Toggle",\n\tDefault = false,\n\tCallback = function(state)\n\t\tprint("Toggle:", state)\n\tend,\n})\nTab:Button({\n\tTitle = "Button",\n\tCallback = function()\n\t\tprint("Clicked")\n\tend,\n})\n${0}',
  },
  {
    id: 'rayfield', name: 'Rayfield', desc: '人気の UI (外観は Roblox のアセットから読み込むため、ここでは表示されません)',
    body: 'local Rayfield = loadstring(game:HttpGet("https://raw.githubusercontent.com/SiriusSoftwareLtd/Rayfield/main/source.lua"))()\n\nlocal Window = Rayfield:CreateWindow({\n\tName = "${1:My Script}",\n\tLoadingTitle = "Loading",\n\tConfigurationSaving = { Enabled = false },\n})\nlocal Tab = Window:CreateTab("Main", 4483362458)\n\nTab:CreateToggle({\n\tName = "Toggle",\n\tCurrentValue = false,\n\tFlag = "Toggle1",\n\tCallback = function(Value)\n\t\tprint("Toggle:", Value)\n\tend,\n})\nTab:CreateButton({\n\tName = "Button",\n\tCallback = function()\n\t\tprint("Clicked")\n\tend,\n})\n${0}',
  },
]
for (const l of UI_LIBRARIES) LUAU_SNIPPETS.push({ label: 'ui-' + l.id, detail: `${l.name} の UI (エグゼキューター)`, body: l.body })
