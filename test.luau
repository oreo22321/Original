local minX, maxX = -1000000, 100000
local minY, maxY = -5000000, 5000000
local minZ, maxZ = -1000000, 1000000

local rng = Random.new()

while true do
    local x = rng:NextNumber(minX, maxX)
    local y = rng:NextNumber(minY, maxY)
    local z = rng:NextNumber(minZ, maxZ)

    local character = game.Players.LocalPlayer.Character
    local root = character and character:FindFirstChild("HumanoidRootPart")

    if root then
        root.CFrame = CFrame.new(x, y, z)
    end

    task.wait(0.01)
end