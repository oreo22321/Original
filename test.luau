local repo = "https://raw.githubusercontent.com/mstudio45/LinoriaLib/main/"
local Library = loadstring(game:HttpGet(repo .. "Library.lua"))()
local ThemeManager = loadstring(game:HttpGet(repo .. "addons/ThemeManager.lua"))()
local SaveManager = loadstring(game:HttpGet(repo .. "addons/SaveManager.lua"))()

local Options = Library.Options
local Toggles = Library.Toggles

local Players = game:GetService("Players")
local me = Players.LocalPlayer

local tpspamEnabled = false


local function getPlayer()
    local closestPlayer = nil
    local closestDistance = math.huge

    local myChar = Players.LocalPlayer.Character
    if not myChar then return end
    local myHrp = myChar:FindFirstChild("HumanoidRootPart")
    if not myHrp then return end
        for _, plr in ipairs(Players:GetPlayers()) do
            if plr ~= me then
                local Char = plr.Character
                local Hrp = Char and Char:FindFirstChild("HumanoidRootPart")
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

local function tpPlayer()
    local myChar = Players.LocalPlayer.Character
    if not myChar then return end
    local myHrp = myChar:FindFirstChild("HumanoidRootPart")
    if not myHrp then return end

    local target = getPlayer()
    if target then
        local targetChar = target.Character
        if not targetChar then return end
        local targetHrp = targetChar and targetChar:FindFirstChild("HumanoidRootPart")
        if not targetHrp then return end
            myHrp.CFrame = targetHrp.CFrame * CFrame.new(0, 0, 5)
        end
    end

local function tpspam()
    if not tpspamEnabled then return end
    tpspamEnabled = true

    task.spawn(function()
        while tpspamEnabled do
            tpPlayer()
            task.wait(0.05)
        end
    end)
end

local function stopTPspam()
    tpspamEnabled = false
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
    end,

    Visible = true,
    Disabled = false,
 })

 MainGroup:AddToggle("tpspamToggle", {
    Text = "tpspam",
    Default = false,
    Disabled = false,
    Visible = true,

    Callback = function(Value)
        if Value then
            tpspam()
        else
            stopTPspam()
        end
    end
 })