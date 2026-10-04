local LocaPlayer = game.Players.LocalPlayer
local Humanoid = LocaPlayer.Character:WaitForChild("Humanoid")

if Humanoid then
    print("get humanoid!")
else
    print("not found humanoid!")
end
