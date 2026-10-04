local repo = "https://raw.githubusercontent.com/deividcomsono/Obsidian/main/"
local Library = loadstring(game:HttpGet(repo .. "Library.lua"))()
local Options = Library.Options
local Toggles = Library.Toggles

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local me = Players.LocalPlayer

local ThrowHitRemote = ReplicatedStorage:WaitForChild("Remotes"):WaitForChild("ThrowHit")

local Window = Library:CreateWindow({
    Title = "My Hub",
    Footer = "v1.0",
})

local Tabs = {
    Combat = Window:AddTab("Combat", "zap"),
    Player = Window:AddTab("Player", "user"),
}

local CombatGroup = Tabs.Combat:AddLeftGroupbox("Knife Kill")
local PlayerLeft  = Tabs.Player:AddLeftGroupbox("Movement")

CombatGroup:AddToggle("TeleportKill", {
    Text    = "Knife kill",
    Default = false,
})

CombatGroup:AddSlider("TeleportKillRange", {
    Text     = "Knife range",
    Default  = 150,
    Min      = 50,
    Max      = 500,
    Rounding = 0,
})

task.spawn(function()
    while true do
        task.wait(0.1)
        if not Toggles.TeleportKill.Value then continue end

        local myChar = me.Character
        local myRoot = myChar and myChar:FindFirstChild("HumanoidRootPart")
        if not myRoot then continue end

        for _, player in ipairs(Players:GetPlayers()) do
            if player == me then continue end

            local char = player.Character
            if not char then continue end

            local targetHead = char:FindFirstChild("Head")
            local targetRoot = char:FindFirstChild("HumanoidRootPart")
            local hum = char:FindFirstChildOfClass("Humanoid")
            if not targetHead or not targetRoot or not hum or hum.Health <= 0 then continue end

            local dist = (targetRoot.Position - myRoot.Position).Magnitude
            if dist > Options.TeleportKillRange.Value then continue end

            local targetPos = targetHead.Position + Vector3.new(0, 20, 0)
            pcall(function()
                ThrowHitRemote:FireServer(targetHead, targetPos)
            end)
        end
    end
end)