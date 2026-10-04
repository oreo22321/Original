local repo = "https://raw.githubusercontent.com/deividcomsono/Obsidian/main/"
local Library = loadstring(game:HttpGet(repo .. "Library.lua"))()
local Options = Library.Options
local Toggles = Library.Toggles

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local me = Players.LocalPlayer

local Window = Library:CreateWindow({
    Title = "My Hub",
    Footer = "v1.0",
})

local Tabs = {
    Main = Window:AddTab("Main", "user"),
}

local Group = Tabs.Main:AddLeftGroupbox("Teleport")

local function getClosestPlayer(range)
    local myHrp = me.Character and me.Character:FindFirstChild("HumanoidRootPart")
    if not myHrp then return nil end

    local closest, closestDist = nil, range
    for _, plr in ipairs(Players:GetPlayers()) do
        if plr == me then continue end
        local char = plr.Character
        local hrp = char and char:FindFirstChild("HumanoidRootPart")
        local hum = char and char:FindFirstChildOfClass("Humanoid")
        if not hrp or not hum or hum.Health <= 0 then continue end

        local dist = (myHrp.Position - hrp.Position).Magnitude
        if dist < closestDist then
            closest, closestDist = plr, dist
        end
    end
    return closest
end

local function teleportToClosest()
    local myHrp = me.Character and me.Character:FindFirstChild("HumanoidRootPart")
    if not myHrp then return end

    local target = getClosestPlayer(Options.TpRange.Value)
    if target then
        myHrp.CFrame = target.Character.HumanoidRootPart.CFrame * CFrame.new(0, 0, 3)
    else
        Library:Notify("範囲内にプレイヤーがいません", 2)
    end
end

Group:AddSlider("TpRange", {
    Text = "範囲",
    Default = 50,
    Min = 10,
    Max = 500,
    Rounding = 0,
})

Group:AddButton({
    Text = "最寄りにテレポート",
    Func = teleportToClosest,
})

Group:AddToggle("TpFollow", {
    Text = "追尾する",
    Default = false,
})

local conn = RunService.Heartbeat:Connect(function()
    if Toggles.TpFollow.Value then
        teleportToClosest()
    end
end)

Library:OnUnload(function()
    conn:Disconnect()
end)
