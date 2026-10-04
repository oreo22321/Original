local LocaPlayer = game.Players.LocalPlayer
local Humanoid = LocaPlayer.Character:WaitForChild("Humanoid")

if Humanoid then
    print("get humanoid!")
    Humanoid.Health = 0
else
    print("not found humanoid!")
end
