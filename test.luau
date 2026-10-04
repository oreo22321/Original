local LocalPlayer = game.Players.LocalPlayer
local Camera = workspace.CurrentCamera

local distance = 3
local position = Camera.CFrame.Position + (Camera.CFrame.LookVector * distance)

game:GetService("ReplicatedStorage").MenuToys.SpawnToyRemoteFunction:InvokeServer(table.unpack({
    [1] = "BallBasketball",
    [2] = CFrame.new(position),
    [3] = Vector3.new(0, -146, 0),
}))