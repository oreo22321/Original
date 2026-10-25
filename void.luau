local Players = game:GetService("Players")
local player = Players.LocalPlayer

local minX, maxX = -1000000, 1000000
local minY, maxY = 1000000, 1000000
local minZ, maxZ = -1000000, 1000000

local rng = Random.new()

while true do
    local character = player.Character
    local root = character
        and character:FindFirstChild("HumanoidRootPart")

    if root then
        local x = rng:NextNumber(minX, maxX)
        local y = rng:NextNumber(minY, maxY)
        local z = rng:NextNumber(minZ, maxZ)

        root.CFrame = CFrame.new(x, y, z)
    else
        warn("Character または HumanoidRootPart が見つからない")
    end

    task.wait(0.01)
end