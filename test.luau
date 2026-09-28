local repo = "https://raw.githubusercontent.com/mstudio45/LinoriaLib/main/"
local Library = loadstring(game:HttpGet(repo .. "Library.lua"))()
local ThemeManager = loadstring(game:HttpGet(repo .. "addons/ThemeManager.lua"))()
local SaveManager = loadstring(game:HttpGet(repo .. "addons/SaveManager.lua"))()

local Options = Library.Options
local Toggles = Library.Toggles

local Player = game:GetService("Players")
local player = Player.LocalPlayer
local character = player.Character or player.CharacterAdded:Wait()
local humanoid = character:WaitForChild("Humanoid")

speedEnabled = false
speedValue = 16

local function WS()
    if speedEnabled then
        humanoid.WalkSpeed = speedValue
    else
        humanoid.WalkSpeed = 16
    end
end

local Window = Library:CreateWindow({
    Title = "TEST.luau",
	Center = true,
	AutoShow = true,
	Resizable = true,
	ShowCustomCursor = true,
	UnlockMouseWhileOpen = true,
	NotifySide = "Left",
	TabPadding = 8,
	MenuFadeTime = 0.2
})

local Tabs = {
    Main = Window:AddTab("Main"),
    ["UI Settings"] = Window:AddTab("UI Settings")
}

local CharacterGroup = Tabs.Main:AddLeftGroupbox("Character")

CharacterGroup:AddToggle("SpeedToggle", {
    Text = "on/off",
    Default = false,
    Tooltip = "Toggle Speed",

    Callback = function(Value)
        speedEnabled = Value
        WS()
    end
})

CharacterGroup:AddSlider("SpeedSlider", {
    Text = "Speed Value",
    Default = 16,
    Min = 16,
    Max = 200,
    Suffix = " studs/s",

    Callback = function(Value)
        speedValue = Value
        WS()
    end
})