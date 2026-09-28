local repo = "https://raw.githubusercontent.com/mstudio45/LinoriaLib/main/"
local Library = loadstring(game:HttpGet(repo .. "Library.lua"))()
local ThemeManager = loadstring(game:HttpGet(repo .. "addons/ThemeManager.lua"))()
local SaveManager = loadstring(game:HttpGet(repo .. "addons/SaveManager.lua"))()

local Options = Library.Options
local Toggles = Library.Toggles

local Player = game:GetService("Players")
local player = Player.LocalPlayer
local UserInputService = game:GetService("UserInputService")
local RunService = game:GetService("RunService")

speedEnabled = false
speedValue = 16
jumpEnabled = false
jumpValue = 50
infjp = false
noclip = false


local function gethumanoid()
    local character = player.Character or player.CharacterAdded:Wait()
    return character:WaitForChild("Humanoid")
end

local function WS()
    local humanoid = gethumanoid()
    if speedEnabled then
        humanoid.WalkSpeed = speedValue
    else
        humanoid.WalkSpeed = 16
    end
end

local function JP()
    local humanoid = gethumanoid()
    if jumpEnabled then
        humanoid.JumpPower = jumpValue
    else
        humanoid.JumpPower = 50
    end
end

local function INFJP()
    local humanoid = gethumanoid()
    if humanoid:GetStateEnabled(Enum.HumanoidStateType.Jumping) then
        humanoid:ChangeState(Enum.HumanoidStateType.Jumping)
    end
end

UserInputService.JumpRequest:Connect(function()
    if infjp then
        INFJP()
    end
end)

local function Noclip()
    local character = player.Character
    if not character then
        return
    end

    for _, part in ipairs(character:GetDescendants()) do
        if part:IsA("BasePart") then
            part.CanCollide = false
        end
    end
end

RunService.Stepped:Connect(function()
    if noclip then
        Noclip()
    end
end)




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
    Rounding = 0,
    Compact = false,
    Visible = true,
    Suffix = " studs/s",

    Callback = function(Value)
        speedValue = Value
        WS()
    end
})

CharacterGroup:AddToggle("JumpToggle", {
    Text = "on/off",
    Default = false,
    Tooltip = "Toggle Jump Power",

    Callback = function(Value)
        jumpEnabled = Value
        JP()
    end
})

CharacterGroup:AddSlider("JumpSlider", {
    Text = "Jump Value",
    Default = 50,
    Min = 50,
    Max = 200,
    Rounding = 0,
    Compact = false,
    Visible = true,
    Suffix = " units",

    Callback = function(Value)
        jumpValue = Value
        JP()
    end
})

CharacterGroup:AddToggle("InfJumpToggle", {
    Text = "Infinite Jump",
    Default = false,
    Tooltip = "Enable Infinite Jump",

    Callback = function(Value)
        infjp = Value
    end
})

CharacterGroup:AddToggle("NoclipToggle", {
    Text = "Noclip",
    Default = false,
    Tooltip = "Enable Noclip",

    Callback = function(Value)
        noclip = Value
    end
})

