--[[
	Obsidian Hub — Obsidian UI Library を使った多機能ローカルスクリプト

	使い方:
	  エグゼキューターにこのファイルの中身を貼り付けて実行。
	  RightShift (または画面のボタン) でメニューの表示 / 非表示。

	機能:
	  [プレイヤー]  WalkSpeed / JumpPower / 無限ジャンプ / Fly (キー: F) / Noclip (キー: N)
	  [ビジュアル]  Fullbright / 霧を消す / 視野角 (FOV)
	  [その他]      Anti-AFK / 再参加 / リセット / 座標コピー
	  [UI設定]      メニューキー / テーマ / 設定の保存・自動読み込み / Unload

	リスポーンしても設定は自動で再適用されます。Unload すると全て元に戻ります。
]]

---------------------------------------------------------------------
-- サービス
---------------------------------------------------------------------
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local Lighting = game:GetService("Lighting")
local TeleportService = game:GetService("TeleportService")
local VirtualUser = game:GetService("VirtualUser")

local LocalPlayer = Players.LocalPlayer
local Camera = workspace.CurrentCamera

---------------------------------------------------------------------
-- Obsidian ライブラリ読み込み
---------------------------------------------------------------------
local repo = "https://raw.githubusercontent.com/deividcomsono/Obsidian/main/"
local Library = loadstring(game:HttpGet(repo .. "Library.lua"))()
local ThemeManager = loadstring(game:HttpGet(repo .. "addons/ThemeManager.lua"))()
local SaveManager = loadstring(game:HttpGet(repo .. "addons/SaveManager.lua"))()

local Options = Library.Options
local Toggles = Library.Toggles

Library.ForceCheckbox = false
Library.ShowToggleFrameInKeybinds = true

---------------------------------------------------------------------
-- 共通ユーティリティ
---------------------------------------------------------------------
local Connections = {} -- Unload 時にまとめて切断する

local function track(conn)
	table.insert(Connections, conn)
	return conn
end

local function getCharacter()
	return LocalPlayer.Character
end

local function getHumanoid()
	local char = getCharacter()
	return char and char:FindFirstChildOfClass("Humanoid")
end

local function getRoot()
	local char = getCharacter()
	return char and char:FindFirstChild("HumanoidRootPart")
end

-- 元の値 (リセット用)
local Defaults = {
	WalkSpeed = 16,
	JumpPower = 50,
	FOV = Camera.FieldOfView,
	Lighting = {
		Brightness = Lighting.Brightness,
		ClockTime = Lighting.ClockTime,
		FogEnd = Lighting.FogEnd,
		FogStart = Lighting.FogStart,
		GlobalShadows = Lighting.GlobalShadows,
		Ambient = Lighting.Ambient,
		OutdoorAmbient = Lighting.OutdoorAmbient,
	},
}

-- PlayerModule の操作入力 (PC / スマホ / コントローラー 全対応)
local Controls
pcall(function()
	local PlayerModule = require(LocalPlayer:WaitForChild("PlayerScripts"):WaitForChild("PlayerModule"))
	Controls = PlayerModule:GetControls()
end)

local function getMoveVector()
	if Controls then
		local ok, vec = pcall(function()
			return Controls:GetMoveVector()
		end)
		if ok and vec then
			return vec
		end
	end
	-- フォールバック: Humanoid.MoveDirection をカメラ基準に戻す
	local hum = getHumanoid()
	if hum then
		return Camera.CFrame:VectorToObjectSpace(hum.MoveDirection)
	end
	return Vector3.zero
end

---------------------------------------------------------------------
-- ウィンドウ / タブ
---------------------------------------------------------------------
local Window = Library:CreateWindow({
	Title = "Obsidian Hub",
	Footer = "v1.0  |  " .. LocalPlayer.Name,
	NotifySide = "Right",
	ShowCustomCursor = true,
})

local Tabs = {
	Player = Window:AddTab("プレイヤー", "user"),
	Visual = Window:AddTab("ビジュアル", "eye"),
	Misc = Window:AddTab("その他", "box"),
	Settings = Window:AddTab("UI設定", "settings"),
}

---------------------------------------------------------------------
-- [プレイヤー] 移動
---------------------------------------------------------------------
local MoveBox = Tabs.Player:AddLeftGroupbox("移動", "footprints")

MoveBox:AddToggle("WalkSpeedEnabled", {
	Text = "WalkSpeed を変更",
	Default = false,
})

MoveBox:AddSlider("WalkSpeedValue", {
	Text = "WalkSpeed",
	Default = 16,
	Min = 0,
	Max = 250,
	Rounding = 0,
})

MoveBox:AddToggle("JumpPowerEnabled", {
	Text = "JumpPower を変更",
	Default = false,
})

MoveBox:AddSlider("JumpPowerValue", {
	Text = "JumpPower",
	Default = 50,
	Min = 0,
	Max = 500,
	Rounding = 0,
})

MoveBox:AddToggle("InfiniteJump", {
	Text = "無限ジャンプ",
	Tooltip = "空中でもジャンプできます",
	Default = false,
})

-- WalkSpeed / JumpPower を毎フレーム維持 (ゲーム側に上書きされても戻す)
track(RunService.Heartbeat:Connect(function()
	local hum = getHumanoid()
	if not hum then
		return
	end
	if Toggles.WalkSpeedEnabled.Value then
		hum.WalkSpeed = Options.WalkSpeedValue.Value
	end
	if Toggles.JumpPowerEnabled.Value then
		hum.UseJumpPower = true
		hum.JumpPower = Options.JumpPowerValue.Value
	end
end))

Toggles.WalkSpeedEnabled:OnChanged(function(on)
	local hum = getHumanoid()
	if hum and not on then
		hum.WalkSpeed = Defaults.WalkSpeed
	end
end)

Toggles.JumpPowerEnabled:OnChanged(function(on)
	local hum = getHumanoid()
	if hum and not on then
		hum.JumpPower = Defaults.JumpPower
	end
end)

track(UserInputService.JumpRequest:Connect(function()
	if not Toggles.InfiniteJump.Value then
		return
	end
	local hum = getHumanoid()
	if hum then
		hum:ChangeState(Enum.HumanoidStateType.Jumping)
	end
end))

---------------------------------------------------------------------
-- [プレイヤー] Fly / Noclip
---------------------------------------------------------------------
local FlyBox = Tabs.Player:AddRightGroupbox("Fly / Noclip", "plane")

FlyBox:AddToggle("Fly", {
	Text = "Fly",
	Tooltip = "カメラの向きに飛びます。Space で上昇、LeftCtrl で下降",
	Default = false,
}):AddKeyPicker("FlyKey", {
	Default = "F",
	SyncToggleState = true,
	Mode = "Toggle",
	Text = "Fly",
})

FlyBox:AddSlider("FlySpeed", {
	Text = "Fly 速度",
	Default = 60,
	Min = 10,
	Max = 300,
	Rounding = 0,
})

FlyBox:AddDivider()

FlyBox:AddToggle("Noclip", {
	Text = "Noclip",
	Tooltip = "壁をすり抜けます",
	Default = false,
}):AddKeyPicker("NoclipKey", {
	Default = "N",
	SyncToggleState = true,
	Mode = "Toggle",
	Text = "Noclip",
})

-- Fly 本体
local FlyAttachment, FlyVelocity, FlyGyro

local function stopFly()
	if FlyVelocity then FlyVelocity:Destroy() FlyVelocity = nil end
	if FlyGyro then FlyGyro:Destroy() FlyGyro = nil end
	if FlyAttachment then FlyAttachment:Destroy() FlyAttachment = nil end
	local hum = getHumanoid()
	if hum then
		hum.PlatformStand = false
	end
end

local function startFly()
	stopFly()
	local root, hum = getRoot(), getHumanoid()
	if not (root and hum) then
		return
	end

	FlyAttachment = Instance.new("Attachment")
	FlyAttachment.Name = "ObsidianFlyAttachment"
	FlyAttachment.Parent = root

	FlyVelocity = Instance.new("LinearVelocity")
	FlyVelocity.Attachment0 = FlyAttachment
	FlyVelocity.RelativeTo = Enum.ActuatorRelativeTo.World
	FlyVelocity.VelocityConstraintMode = Enum.VelocityConstraintMode.Vector
	FlyVelocity.MaxForce = math.huge
	FlyVelocity.VectorVelocity = Vector3.zero
	FlyVelocity.Parent = root

	FlyGyro = Instance.new("AlignOrientation")
	FlyGyro.Attachment0 = FlyAttachment
	FlyGyro.Mode = Enum.OrientationAlignmentMode.OneAttachment
	FlyGyro.RigidityEnabled = true
	FlyGyro.CFrame = Camera.CFrame
	FlyGyro.Parent = root

	hum.PlatformStand = true
end

Toggles.Fly:OnChanged(function(on)
	if on then
		startFly()
	else
		stopFly()
	end
end)

track(RunService.RenderStepped:Connect(function()
	if not (Toggles.Fly.Value and FlyVelocity) then
		return
	end
	local camCF = Camera.CFrame
	local move = getMoveVector() -- x: 左右, z: 前後 (前が -z)
	local dir = camCF:VectorToWorldSpace(move)

	if UserInputService:IsKeyDown(Enum.KeyCode.Space) then
		dir += Vector3.yAxis
	end
	if UserInputService:IsKeyDown(Enum.KeyCode.LeftControl) then
		dir -= Vector3.yAxis
	end

	if dir.Magnitude > 0 then
		dir = dir.Unit
	end
	FlyVelocity.VectorVelocity = dir * Options.FlySpeed.Value
	FlyGyro.CFrame = CFrame.lookAt(Vector3.zero, camCF.LookVector)
end))

-- Noclip 本体
local NoclipOriginal = {} -- [BasePart] = 元の CanCollide

track(RunService.Stepped:Connect(function()
	if not Toggles.Noclip.Value then
		return
	end
	local char = getCharacter()
	if not char then
		return
	end
	for _, part in ipairs(char:GetDescendants()) do
		if part:IsA("BasePart") and part.CanCollide then
			if NoclipOriginal[part] == nil then
				NoclipOriginal[part] = true
			end
			part.CanCollide = false
		end
	end
end))

local function restoreNoclip()
	for part, original in pairs(NoclipOriginal) do
		if part.Parent then
			part.CanCollide = original
		end
	end
	table.clear(NoclipOriginal)
end

Toggles.Noclip:OnChanged(function(on)
	if not on then
		restoreNoclip()
	end
end)

---------------------------------------------------------------------
-- [ビジュアル]
---------------------------------------------------------------------
local LightBox = Tabs.Visual:AddLeftGroupbox("ライティング", "sun")

LightBox:AddToggle("Fullbright", {
	Text = "Fullbright",
	Tooltip = "暗い場所も明るく見えます",
	Default = false,
})

LightBox:AddToggle("NoFog", {
	Text = "霧を消す",
	Default = false,
})

local function restoreLighting()
	for prop, value in pairs(Defaults.Lighting) do
		Lighting[prop] = value
	end
end

track(RunService.RenderStepped:Connect(function()
	if Toggles.Fullbright.Value then
		Lighting.Brightness = 2
		Lighting.ClockTime = 14
		Lighting.GlobalShadows = false
		Lighting.Ambient = Color3.new(1, 1, 1)
		Lighting.OutdoorAmbient = Color3.new(1, 1, 1)
	end
	if Toggles.NoFog.Value then
		Lighting.FogStart = 0
		Lighting.FogEnd = 1e9
	end
end))

Toggles.Fullbright:OnChanged(function(on)
	if not on then
		Lighting.Brightness = Defaults.Lighting.Brightness
		Lighting.ClockTime = Defaults.Lighting.ClockTime
		Lighting.GlobalShadows = Defaults.Lighting.GlobalShadows
		Lighting.Ambient = Defaults.Lighting.Ambient
		Lighting.OutdoorAmbient = Defaults.Lighting.OutdoorAmbient
	end
end)

Toggles.NoFog:OnChanged(function(on)
	if not on then
		Lighting.FogStart = Defaults.Lighting.FogStart
		Lighting.FogEnd = Defaults.Lighting.FogEnd
	end
end)

local CamBox = Tabs.Visual:AddRightGroupbox("カメラ", "camera")

CamBox:AddToggle("FOVEnabled", {
	Text = "視野角を変更",
	Default = false,
})

CamBox:AddSlider("FOVValue", {
	Text = "視野角 (FOV)",
	Default = 70,
	Min = 30,
	Max = 120,
	Rounding = 0,
	Suffix = "°",
})

track(RunService.RenderStepped:Connect(function()
	if Toggles.FOVEnabled.Value then
		Camera.FieldOfView = Options.FOVValue.Value
	end
end))

Toggles.FOVEnabled:OnChanged(function(on)
	if not on then
		Camera.FieldOfView = Defaults.FOV
	end
end)

---------------------------------------------------------------------
-- [その他]
---------------------------------------------------------------------
local UtilBox = Tabs.Misc:AddLeftGroupbox("便利機能", "wrench")

UtilBox:AddToggle("AntiAFK", {
	Text = "Anti-AFK",
	Tooltip = "20分放置で切断されるのを防ぎます",
	Default = true,
})

track(LocalPlayer.Idled:Connect(function()
	if Toggles.AntiAFK.Value then
		VirtualUser:CaptureController()
		VirtualUser:ClickButton2(Vector2.zero)
	end
end))

UtilBox:AddButton({
	Text = "座標をコピー",
	Func = function()
		local root = getRoot()
		if not root then
			return Library:Notify("キャラクターが見つかりません", 3)
		end
		local p = root.Position
		local text = string.format("Vector3.new(%.2f, %.2f, %.2f)", p.X, p.Y, p.Z)
		if setclipboard then
			setclipboard(text)
			Library:Notify("コピーしました: " .. text, 3)
		else
			Library:Notify(text, 5)
		end
	end,
})

UtilBox:AddButton({
	Text = "リセット (自滅)",
	DoubleClick = true,
	Tooltip = "ダブルクリックで実行",
	Func = function()
		local hum = getHumanoid()
		if hum then
			hum.Health = 0
		end
	end,
})

local ServerBox = Tabs.Misc:AddRightGroupbox("サーバー", "server")

ServerBox:AddLabel("JobId: " .. string.sub(game.JobId, 1, 8) .. "…", true)

ServerBox:AddButton({
	Text = "同じサーバーに再参加",
	Func = function()
		Library:Notify("再参加しています…", 3)
		if #Players:GetPlayers() <= 1 then
			TeleportService:Teleport(game.PlaceId, LocalPlayer)
		else
			TeleportService:TeleportToPlaceInstance(game.PlaceId, game.JobId, LocalPlayer)
		end
	end,
})

---------------------------------------------------------------------
-- リスポーン対応
---------------------------------------------------------------------
track(LocalPlayer.CharacterAdded:Connect(function(char)
	char:WaitForChild("HumanoidRootPart", 10)
	char:WaitForChild("Humanoid", 10)
	table.clear(NoclipOriginal)
	if Toggles.Fly.Value then
		task.wait(0.1)
		startFly()
	end
end))

---------------------------------------------------------------------
-- [UI設定]
---------------------------------------------------------------------
local MenuBox = Tabs.Settings:AddLeftGroupbox("メニュー", "menu")

MenuBox:AddToggle("KeybindMenuOpen", {
	Text = "キーバインド一覧を表示",
	Default = Library.KeybindFrame.Visible,
	Callback = function(value)
		Library.KeybindFrame.Visible = value
	end,
})

MenuBox:AddToggle("ShowCustomCursor", {
	Text = "カスタムカーソル",
	Default = true,
	Callback = function(value)
		Library.ShowCustomCursor = value
	end,
})

MenuBox:AddDivider()
MenuBox:AddLabel("メニューキー"):AddKeyPicker("MenuKeybind", {
	Default = "RightShift",
	NoUI = true,
	Text = "メニューキー",
})

MenuBox:AddButton({
	Text = "Unload (全て元に戻す)",
	Func = function()
		Library:Unload()
	end,
})

Library.ToggleKeybind = Options.MenuKeybind

Library:OnUnload(function()
	for _, conn in ipairs(Connections) do
		conn:Disconnect()
	end
	table.clear(Connections)

	stopFly()
	restoreNoclip()
	restoreLighting()
	Camera.FieldOfView = Defaults.FOV

	local hum = getHumanoid()
	if hum then
		hum.WalkSpeed = Defaults.WalkSpeed
		hum.JumpPower = Defaults.JumpPower
	end
	print("[Obsidian Hub] Unloaded")
end)

ThemeManager:SetLibrary(Library)
SaveManager:SetLibrary(Library)
SaveManager:IgnoreThemeSettings()
SaveManager:SetIgnoreIndexes({ "MenuKeybind" })

ThemeManager:SetFolder("ObsidianHub")
SaveManager:SetFolder("ObsidianHub/" .. game.PlaceId)

SaveManager:BuildConfigSection(Tabs.Settings)
ThemeManager:ApplyToTab(Tabs.Settings)
SaveManager:LoadAutoloadConfig()

Library:Notify("Obsidian Hub を読み込みました (RightShift で開閉)", 5)
