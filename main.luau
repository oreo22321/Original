local Player = game:GetService("Players")
local LocalPlayer = Player.LocalPlayer
local Character = LocalPlayer.Character or LocalPlayer.CharacterAdded:Wait()
local Humanoid = Character:FindFirstChildOfClass("Humanoid")

local Library = loadstring(game:HttpGet("https://raw.githubusercontent.com/deividcomsono/Obsidian/main/Library.lua"))()

local Window = Library:CreateWindow({
    Title = "My UI",
    Footer = "v1.0",
    Center = true,
    AutoShow = true,
})

local Tab = Window:AddTab("Main", "Main")

local Groupbox = Tab:AddGroupbox({
    Side = "Left",
    Name = "Main"
})

local Toggle = Groupbox:AddToggle("WSToggle", {
    Text = "Enable",
    Default = false,
})

Toggle:OnChanged(function(Value)
    if Value then
        Humanoid.WalkSpeed = 50
        print("ON")
    else
        Humanoid.WalkSpeed = 16
        print("OFF")
    end
end)

