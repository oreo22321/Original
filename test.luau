local LocalPlayer = game.Players.LocalPlayer

game:GetService("ReplicatedStorage").MenuToys.SpawnToyRemoteFunction:InvokeServer(table.unpack({
    [1] = "BallBasketball",
    [2] = CFrame.new(LocalPlayer.Character.HumanoidRootPart.Position),
    [3] = Vector3.new(0, -146, 0),
}))