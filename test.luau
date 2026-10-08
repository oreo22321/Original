local Players = game:GetService("Players")

local player = Players.LocalPlayer

local function setupCharacter(character)
	local humanoid = character:WaitForChild("Humanoid")

	humanoid.WalkSpeed = 32
	humanoid.UseJumpPower = true
	humanoid.JumpPower = 80
end

if player.Character then
	setupCharacter(player.Character)
end

player.CharacterAdded:Connect(setupCharacter)