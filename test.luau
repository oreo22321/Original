local Player = game:GetService("Players")
local me = Player.LocalPlayer

local range = 50
local closestPlayer = nil
local closestDistance = range

local function found()
    for _, plr in ipairs(Player:GetPlayers()) do
        if plr ~= me then

            local char = plr.Character
            local hrp = char and char:FindFirstChild("HumanoidRootPart")
            if char and hrp then

                local myChar = me.Character
                local myHrp = myChar and myChar:FindFirstChild("HumanoidRootPart")
                if myChar and myHrp then

                    local distance = (myHrp.Position - hrp.Position).Magnitude
                    if distance <= range then
                        if distance < closestDistance then
                            closestDistance = distance
                            closestPlayer = plr
                        end
                    end

                    if closestPlayer then
                        myHrp.CFrame = hrp.CFrame
                    end
                end
            end
        end
    end
end

found()