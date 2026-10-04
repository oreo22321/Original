local Player = game:GetService("Players")
local me = Player.LocalPlayer

local range = 50

local function tp()
    for _, plr in ipairs(Player:GetPlayers()) do
        if plr ~= me then

            local tg = plr.Character
            local hrp = tg.FindFirstChild("HumanoidRootPart")

            if tg and hrp then

            local char = plr.Character
            local hrp = char.FindFirstChild("HumanoidRootPart")

            if char and hrp then

                local distance = (me.Character.HumanoidRootPart.Position - hrp.Position).Magnitude

                if distance <= range then
                    print(plr.Name .. " found plr")
                end
            end
        end
    end
end