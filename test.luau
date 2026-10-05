local repo = "https://raw.githubusercontent.com/mstudio45/LinoriaLib/main/"
local Library = loadstring(game:HttpGet(repo .. "Library.lua"))()
local ThemeManager = loadstring(game:HttpGet(repo .. "addons/ThemeManager.lua"))()
local SaveManager = loadstring(game:HttpGet(repo .. "addons/SaveManager.lua"))()

local Options = Library.Options
local Toggles = Library.Toggles

local me = Players.LocalPlayer
local Players = game:GetService("Players")

local tp = false
local closestPlayer = nil
local closestDistance = math.huge

local function getPlayer()
    local myChar = Players.LocalPlayer.Character
    local myHrp = myChar:FindFirstChild("HumanoidRootPart")
    if myChar and myHrp then
        for _, plr in ipairs(Players:GetPlayers()) do
            if plr ~= me then
                local Char = plr.Character
                local Hrp = Char:FindFirstChildOfClass("HumanoidRootPart")
                if Char and Hrp then
                    local distance = (myHrp.Position - Hrp.Position).Magnitude
                    if distance < closestDistance then
                        closestDistance = distance
                        closestPlayer = plr
                    end
                end
            end
        end

        return closestPlayer
    end
end

local function tpPlayer()
    local myChar = Players.LocalPlayer.Character
    local myHrp = myChar:FindFirstChild("HumanoidRootPart")
    if not myChar or not myHrp then return end

    local target = getPlayer()
    if target then
        local targetChar = target.Character
        local targetHrp = targetChar:FindFirstChild("HumanoidRootPart")
        if targetHrp then
            myHrp.CFrame = targetHrp.CFrame
        end
    end
end

local Window = Library:CreateWindow({
    Title = "skal",
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
local MainGroup = Tabs.Main:AddLeftGroupbox("Main")

 local tpButton =MainGroup:AddButton({
    Text = "Teleport",
    Func = function()
        tpPlayer()
    end

    Visible = true,
    Disabled = false,
 })