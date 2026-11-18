import{a as p,d as A,e as N,i as L}from"./chunk-L52IZ56K.js";import{h as U}from"./chunk-M4YAIX4P.js";var Y=e=>"	".repeat(e),y=(e,t)=>e.map(a=>a&&Y(t)+a),m=e=>JSON.stringify(String(e)),k=(e,t)=>{let a=String(e||"").replace(/[^\w]/g,"");return/^[A-Za-z_]/.test(a)?a:t},D=e=>e&&e.rgb?`Color3.fromRGB(${e.rgb.join(", ")})`:"Color3.fromRGB(255, 80, 80)";function h(e,t,a,o,{allowSeconds:n=!1}={}){let r=p(t);for(let d of a){let u=r.indexOf(p(d));if(u<0)continue;let f=null;for(let i of e.numbers){if(!n&&/^(秒|びょう|s|sec|分|ふん|回|かい)$/.test(i.unit)||/^(倍|ばい|%|パーセント)$/.test(i.unit))continue;let S=Math.abs(i.at-u);S<14&&(!f||S<f.d)&&(f={v:i.v,d:S})}if(f)return f.v}return o}var b=e=>e.numbers.filter(t=>!/^(秒|びょう|s|sec|分|ふん|回|かい|倍|ばい|%|パーセント)$/.test(t.unit)),H=[{id:"kill",c:["kill"],title:"倒す",side:"server",needs:"humanoid",params:()=>({}),code:(e,t)=>[`${t.humanoid}.Health = 0 -- 倒す`]},{id:"damage",c:["damage"],title:"ダメージを与える",side:"server",needs:"humanoid",params:(e,t)=>({amount:h(e,t,["ダメージ","damage","減ら"],(b(e)[0]||{}).v||20)}),code:(e,t)=>[`${t.humanoid}:TakeDamage(${e.amount}) -- ${e.amount} ダメージ`]},{id:"heal",c:["heal"],title:"回復する",side:"server",needs:"humanoid",params:(e,t)=>({amount:h(e,t,["回復","heal","ヒール"],(b(e)[0]||{}).v||25)}),code:(e,t)=>[`${t.humanoid}.Health = math.min(${t.humanoid}.MaxHealth, ${t.humanoid}.Health + ${e.amount}) -- ${e.amount} 回復`]},{id:"speed",c:["speed","sprint"],title:"歩く速さを変える",side:"any",needs:"humanoid",params:(e,t,a)=>{let o=e.multiplier;return{value:h(e,t,["速さ","速度","スピード","speed","walkspeed"],(b(e)[0]||{}).v||null)||(o?Math.round(16*o):a.mode==="executor"?50:32),duration:e.seconds,hold:/(押している間|押してる間|押したまま|ホールド|hold|離したら|はなしたら)/.test(p(t))||a.concepts.has("sprint")}},code:(e,t)=>e.duration&&!e.hold?[`local oldSpeed = ${t.humanoid}.WalkSpeed`,`${t.humanoid}.WalkSpeed = ${e.value} -- 速くする`,`task.delay(${e.duration}, function()`,`	if ${t.humanoid}.Parent then ${t.humanoid}.WalkSpeed = oldSpeed end -- ${e.duration} 秒後に戻す`,"end)"]:[`${t.humanoid}.WalkSpeed = ${e.value} -- 歩く速さ (標準は 16)`],undo:(e,t)=>[`${t.humanoid}.WalkSpeed = 16 -- 元の速さに戻す`]},{id:"jump",c:["jump"],title:"ジャンプ力を変える",side:"any",needs:"humanoid",params:(e,t,a)=>({value:h(e,t,["ジャンプ","jump","跳"],(b(e)[0]||{}).v||(a.mode==="executor"?100:80)),duration:e.seconds}),code:(e,t)=>[`${t.humanoid}.UseJumpPower = true`,`${t.humanoid}.JumpPower = ${e.value} -- ジャンプ力 (標準は 50)`].concat(e.duration?[`task.delay(${e.duration}, function()`,`	if ${t.humanoid}.Parent then ${t.humanoid}.JumpPower = 50 end`,"end)"]:[]),undo:(e,t)=>[`${t.humanoid}.JumpPower = 50 -- 元に戻す`]},{id:"fling",c:["physics"],title:"上に吹き飛ばす",side:"any",needs:"root",match:/(吹き飛|ふきと|飛ばす|ノックバック|knockback|ジャンプ台|ジャンプパッド|jump ?pad|トランポリン|跳ね)/,params:(e,t)=>({power:h(e,t,["力","強さ","高さ","power"],100)}),code:(e,t)=>[`${t.root}.AssemblyLinearVelocity = Vector3.new(0, ${e.power}, 0) -- 上に飛ばす`]},{id:"teleport",c:["teleport"],title:"テレポートする",side:"any",needs:"character",params:e=>{let t=b(e);return{target:e.quoted[0]||null,pos:t.length>=3?t.slice(0,3).map(a=>a.v):null}},code:(e,t)=>e.target?[`local target = workspace:FindFirstChild(${m(e.target)}, true)`,"if target then",`	${t.character}:PivotTo(target.CFrame + Vector3.new(0, 4, 0)) -- ${e.target} の上へ`,"end"]:e.pos?[`${t.character}:PivotTo(CFrame.new(${e.pos.join(", ")})) -- (${e.pos.join(", ")}) へ`]:['local target = workspace:FindFirstChild("TeleportTarget") -- 行き先のパーツ (名前を TeleportTarget に)',"if target then",`	${t.character}:PivotTo(target.CFrame + Vector3.new(0, 4, 0))`,"else",`	${t.character}:PivotTo(CFrame.new(0, 50, 0))`,"end"]},{id:"color",c:["color"],title:"色を変える",side:"server",needs:"part",params:e=>({color:e.colors[0]||{rainbow:!0}}),code:(e,t)=>e.color.rainbow?[`${t.part}.Color = Color3.fromHSV(math.random(), 0.8, 1) -- ランダムな色`]:[`${t.part}.Color = ${D(e.color)} -- ${e.color.name}`]},{id:"disappear",c:["disappear","destroy"],title:"消える",side:"server",needs:"part",params:(e,t)=>({respawn:/(戻|復活|再出現|また出|リスポーン)/.test(p(t))||e.seconds?e.seconds||3:null,destroy:/(削除|壊|destroy)/.test(p(t))}),code:(e,t)=>e.destroy?[`${t.part}:Destroy() -- 削除`]:[`${t.part}.Transparency = 1 -- 見えなくする`,`${t.part}.CanCollide = false`,`${t.part}.CanTouch = false`].concat(e.respawn?[`task.delay(${e.respawn}, function() -- ${e.respawn} 秒後に戻す`,`	${t.part}.Transparency = 0`,`	${t.part}.CanCollide = true`,`	${t.part}.CanTouch = true`,"end)"]:[])},{id:"coins",c:["coin","points"],title:"コインを増やす",side:"server",needs:"player",helper:"coins",params:(e,t,a)=>({amount:h(e,t,["コイン","coin","お金","ポイント","point","スコア"],(b(e)[0]||{}).v||1),stat:a.concepts.has("points")&&!a.concepts.has("coin")?"Points":"Coins"}),code:(e,t)=>[`addStat(${t.player}, ${m(e.stat)}, ${e.amount}) -- ${e.stat} を ${e.amount} 増やす`]},{id:"sound",c:["sound"],title:"音を鳴らす",side:"any",needs:null,params:e=>({id:(e.numbers.find(t=>t.v>1e5)||{}).v||9118823100}),code:(e,t)=>['local sound = Instance.new("Sound")',`sound.SoundId = "rbxassetid://${e.id}" -- 鳴らしたい音の ID`,`sound.Parent = ${t.part||"workspace"}`,"sound:Play()",'game:GetService("Debris"):AddItem(sound, 10)']},{id:"explode",c:["explode"],title:"爆発させる",side:"server",needs:null,params:(e,t)=>({radius:h(e,t,["範囲","半径","大きさ","radius"],8)}),code:(e,t)=>['local explosion = Instance.new("Explosion")',`explosion.Position = ${t.part?t.part+".Position":t.root?t.root+".Position":"Vector3.new(0, 5, 0)"}`,`explosion.BlastRadius = ${e.radius}`,"explosion.Parent = workspace"]},{id:"message",c:["message"],title:"メッセージを表示する",side:"any",needs:null,params:(e,t)=>({text:e.quoted[0]||(/(ようこそ|welcome)/.test(p(t))?"ようこそ!":"こんにちは!")}),code:(e,t,a)=>a.side==="client"?["pcall(function()",'	game:GetService("StarterGui"):SetCore("SendNotification", {','		Title = "お知らせ",',`		Text = ${m(e.text)},`,"		Duration = 5,","	})","end)"]:[`print(${t.player?`${t.player}.Name .. " さん: " .. `:""}${m(e.text)})`]},{id:"spawnPart",c:["spawnPart"],title:"パーツを出す",side:"server",needs:null,params:(e,t)=>({size:h(e,t,["大きさ","サイズ","size"],2),life:e.seconds&&e.seconds>1?Math.max(5,e.seconds*3):8,color:e.colors[0]||null}),code:(e,t)=>['local newPart = Instance.new("Part")',`newPart.Size = Vector3.new(${e.size}, ${e.size}, ${e.size})`,`newPart.Position = ${t.root?`${t.root}.Position + Vector3.new(0, 15, 0)`:"Vector3.new(math.random(-40, 40), 60, math.random(-40, 40)) -- 空のランダムな位置"}`,e.color?`newPart.Color = ${D(e.color)}`:"newPart.Color = Color3.fromHSV(math.random(), 0.7, 1)","newPart.Material = Enum.Material.SmoothPlastic","newPart.Parent = workspace",`game:GetService("Debris"):AddItem(newPart, ${e.life}) -- ${e.life} 秒後に自動で消す`]},{id:"light",c:["light"],title:"ライトを切り替える",side:"server",needs:"part",params:()=>({}),code:(e,t)=>[`local light = ${t.part}:FindFirstChildOfClass("PointLight")`,"if not light then",'	light = Instance.new("PointLight")',"	light.Range = 16",`	light.Parent = ${t.part}`,"end","light.Enabled = not light.Enabled -- オン / オフ"]},{id:"giveTool",c:["tool","give"],title:"ツールを渡す",side:"server",needs:"player",match:/(ツール|tool|剣|sword|武器|weapon|アイテム)/,params:e=>({name:e.quoted[0]||"Sword"}),code:(e,t)=>[`local tool = game:GetService("ServerStorage"):FindFirstChild(${m(e.name)}) -- ServerStorage に置いたツール`,`if tool and not ${t.player}.Backpack:FindFirstChild(${m(e.name)}) then`,`	tool:Clone().Parent = ${t.player}.Backpack`,"end"]},{id:"checkpoint",c:["checkpoint"],title:"チェックポイントにする",side:"server",needs:"player",triggers:["touch"],params:()=>({}),code:(e,t)=>[`${t.player}.RespawnLocation = ${t.part} -- 次はここから出現 (このパーツは SpawnLocation に)`]},{id:"openDoor",c:["door"],title:"ドアを開ける",side:"server",needs:"part",defaultTrigger:"prompt",params:(e,t)=>({seconds:e.seconds||3,mode:/(回転|開き戸|ひらく|swing)/.test(p(t))?"swing":"slide"}),code:(e,t)=>["if doorOpen then return end","doorOpen = true","openTween:Play()",`task.wait(${e.seconds}) -- ${e.seconds} 秒後に閉じる`,"closeTween:Play()","closeTween.Completed:Wait()","doorOpen = false"],setup:(e,t)=>['local TweenService = game:GetService("TweenService")',`local closedCFrame = ${t.part}.CFrame`,e.mode==="swing"?`local openCFrame = closedCFrame * CFrame.new(-${t.part}.Size.X / 2, 0, 0) * CFrame.Angles(0, math.rad(90), 0) * CFrame.new(${t.part}.Size.X / 2, 0, 0)`:`local openCFrame = closedCFrame + Vector3.new(0, ${t.part}.Size.Y + 0.5, 0) -- 上にスライド`,"local info = TweenInfo.new(0.8, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)",`local openTween = TweenService:Create(${t.part}, info, { CFrame = openCFrame })`,`local closeTween = TweenService:Create(${t.part}, info, { CFrame = closedCFrame })`,"local doorOpen = false",`${t.part}.Anchored = true`]}],M={coins:["-- leaderstats (画面右上の表示) に値を足す。なければ作る","local function addStat(player, statName, amount)",'	local leaderstats = player:FindFirstChild("leaderstats")',"	if not leaderstats then",'		leaderstats = Instance.new("Folder")','		leaderstats.Name = "leaderstats"',"		leaderstats.Parent = player","	end","	local stat = leaderstats:FindFirstChild(statName)","	if not stat then",'		stat = Instance.new("IntValue")',"		stat.Name = statName","		stat.Parent = leaderstats","	end","	stat.Value += amount","end"]},x={touch:{title:"触れたとき",side:"server",place:"パーツの中に Script として入れてください",vars:{part:"part",character:"character",humanoid:"humanoid",player:"player",root:"root"},build:(e,t)=>({header:['local Players = game:GetService("Players")',"","local part = script.Parent",`local COOLDOWN = ${t.cooldown} -- 同じ人に連続で効かないようにする秒数`,"local cooldowns = {}"],body:["part.Touched:Connect(function(hit)","	local character = hit.Parent",'	local humanoid = character and character:FindFirstChildOfClass("Humanoid")',"	if not humanoid or humanoid.Health <= 0 or cooldowns[character] then","		return","	end","	cooldowns[character] = true","	local player = Players:GetPlayerFromCharacter(character)",'	local root = character:FindFirstChild("HumanoidRootPart")',"",...y(e,1),"","	task.wait(COOLDOWN)","	cooldowns[character] = nil","end)"]})},click:{title:"クリックしたとき",side:"server",place:"パーツの中に Script として入れてください (ClickDetector は自動で作ります)",vars:{part:"part",character:"character",humanoid:"humanoid",player:"player",root:"root"},build:e=>({header:["local part = script.Parent",'local detector = part:FindFirstChildOfClass("ClickDetector") or Instance.new("ClickDetector")',"detector.MaxActivationDistance = 32","detector.Parent = part"],body:["detector.MouseClick:Connect(function(player)","	local character = player.Character",'	local humanoid = character and character:FindFirstChildOfClass("Humanoid")','	local root = character and character:FindFirstChild("HumanoidRootPart")',"	if not humanoid or not root then","		return","	end","",...y(e,1),"end)"]})},prompt:{title:"近づいて E キー (ProximityPrompt)",side:"server",place:"パーツの中に Script として入れてください (ProximityPrompt は自動で作ります)",vars:{part:"part",character:"character",humanoid:"humanoid",player:"player",root:"root"},build:(e,t)=>({header:["local part = script.Parent",'local prompt = part:FindFirstChildOfClass("ProximityPrompt") or Instance.new("ProximityPrompt")',`prompt.ActionText = ${m(t.actionText)}`,`prompt.KeyboardKeyCode = Enum.KeyCode.${t.key||"E"}`,"prompt.HoldDuration = 0","prompt.Parent = part"],body:["prompt.Triggered:Connect(function(player)","	local character = player.Character",'	local humanoid = character and character:FindFirstChildOfClass("Humanoid")','	local root = character and character:FindFirstChild("HumanoidRootPart")',"	if not humanoid or not root then","		return","	end","",...y(e,1),"end)"]})},chat:{title:"チャットのコマンド",side:"server",place:"ServerScriptService に Script として入れてください",vars:{character:"character",humanoid:"humanoid",player:"player",root:"root"},build:(e,t)=>({header:['local Players = game:GetService("Players")',`local COMMAND = ${m(t.command)} -- チャットにこう打つと実行`],body:["Players.PlayerAdded:Connect(function(player)","	player.Chatted:Connect(function(message)","		if message:lower() ~= COMMAND then","			return","		end","		local character = player.Character",'		local humanoid = character and character:FindFirstChildOfClass("Humanoid")','		local root = character and character:FindFirstChild("HumanoidRootPart")',"		if not humanoid or not root then","			return","		end","",...y(e,2),"	end)","end)"]})},timer:{title:"一定時間ごと",side:"server",place:"ServerScriptService に Script として入れてください",vars:{character:"character",humanoid:"humanoid",player:"player",root:"root"},build:(e,t,a)=>{let o=a.some(r=>r.needs==="humanoid"||r.needs==="player"||r.needs==="character"||r.needs==="root"),n=a.some(r=>r.needs==="part");return{header:['local Players = game:GetService("Players")',`local INTERVAL = ${t.interval} -- 何秒ごとに実行するか`].concat(n?["local part = workspace:WaitForChild("+m(t.partName)+") -- 対象のパーツの名前"]:[]),body:["while true do","	task.wait(INTERVAL)",...o?["	for _, player in Players:GetPlayers() do","		local character = player.Character",'		local humanoid = character and character:FindFirstChildOfClass("Humanoid")','		local root = character and character:FindFirstChild("HumanoidRootPart")',"		if humanoid and root and humanoid.Health > 0 then",...y(e,3),"		end","	end"]:y(e,1),"end"]}},varsFor:e=>e.some(t=>t.needs==="part")?{part:"part",character:"character",humanoid:"humanoid",player:"player",root:"root"}:null},join:{title:"参加・出現したとき",side:"server",place:"ServerScriptService に Script として入れてください",vars:{character:"character",humanoid:"humanoid",player:"player",root:"root"},build:e=>({header:['local Players = game:GetService("Players")'],body:["Players.PlayerAdded:Connect(function(player)","	player.CharacterAdded:Connect(function(character)",'		local humanoid = character:WaitForChild("Humanoid")','		local root = character:WaitForChild("HumanoidRootPart")',"",...y(e,2),"	end)","end)"]})},key:{title:"キーを押したとき",side:"client",place:"StarterPlayer → StarterPlayerScripts に LocalScript として入れてください",vars:{character:"character",humanoid:"humanoid",player:"player",root:"root"},build:(e,t,a,o)=>({header:['local Players = game:GetService("Players")','local UserInputService = game:GetService("UserInputService")',"","local player = Players.LocalPlayer",`local KEY = Enum.KeyCode.${t.key} -- 使うキー`],body:["local function getCharacter()","	local character = player.Character",'	local humanoid = character and character:FindFirstChildOfClass("Humanoid")','	local root = character and character:FindFirstChild("HumanoidRootPart")',"	return character, humanoid, root","end","","UserInputService.InputBegan:Connect(function(input, gameProcessed)","	if gameProcessed or input.KeyCode ~= KEY then","		return -- チャット入力中や、別のキーは無視","	end","	local character, humanoid, root = getCharacter()","	if not humanoid then","		return","	end",...y(e,1),"end)"].concat(o?["","UserInputService.InputEnded:Connect(function(input)","	if input.KeyCode ~= KEY then","		return","	end","	local character, humanoid, root = getCharacter()","	if not humanoid then","		return","	end",...y(o,1),"end)"]:[])})},button:{title:"画面のボタンを押したとき",side:"client",place:"StarterGui または StarterPlayerScripts に LocalScript として入れてください (ボタンは自動で作ります)",vars:{character:"character",humanoid:"humanoid",player:"player",root:"root"},build:(e,t,a,o)=>({header:['local Players = game:GetService("Players")',"","local player = Players.LocalPlayer",""].concat(t.executor?['local guiParent = (gethui and gethui()) or game:GetService("CoreGui")']:['local guiParent = player:WaitForChild("PlayerGui")'],["","-- ボタンを作る (スマホでも押しやすい大きさ)",'local gui = Instance.new("ScreenGui")',`gui.Name = ${m(t.guiName)}`,"gui.ResetOnSpawn = false","",'local button = Instance.new("TextButton")',"button.AnchorPoint = Vector2.new(1, 1)","button.Position = UDim2.new(1, -20, 1, -100)","button.Size = UDim2.fromOffset(160, 52)","button.BackgroundColor3 = Color3.fromRGB(40, 120, 255)","button.TextColor3 = Color3.new(1, 1, 1)","button.Font = Enum.Font.GothamBold","button.TextSize = 18",`button.Text = ${m(t.label)}`,"button.Parent = gui",'Instance.new("UICorner").Parent = button',"","gui.Parent = guiParent"]),body:["local function getCharacter()","	local character = player.Character",'	local humanoid = character and character:FindFirstChildOfClass("Humanoid")','	local root = character and character:FindFirstChild("HumanoidRootPart")',"	return character, humanoid, root","end",""].concat(o?["local enabled = false","button.Activated:Connect(function()","	local character, humanoid, root = getCharacter()","	if not humanoid then","		return","	end","	enabled = not enabled","	if enabled then",...y(e,2),`		button.Text = ${m(t.label+": ON")}`,"	else",...y(o,2),`		button.Text = ${m(t.label+": OFF")}`,"	end","end)"]:["button.Activated:Connect(function()","	local character, humanoid, root = getCharacter()","	if not humanoid then","		return","	end",...y(e,1),"end)"])})},start:{title:"参加したとき (その人の画面)",side:"client",place:"StarterPlayer → StarterPlayerScripts に LocalScript として入れてください",vars:{player:"player"},build:e=>({header:['local Players = game:GetService("Players")',"local player = Players.LocalPlayer"],body:["task.wait(2) -- 画面の準備ができるまで少し待つ",...e]})},now:{title:"実行したとき (自分のキャラクター)",side:"client",place:"エグゼキューターで実行してください",vars:{character:"character",humanoid:"humanoid",player:"player",root:"root"},build:(e,t)=>({header:['local Players = game:GetService("Players")',"local player = Players.LocalPlayer"],body:["local function apply(character)",'	local humanoid = character:WaitForChild("Humanoid")','	local root = character:WaitForChild("HumanoidRootPart")',...y(e,1),"end","","if player.Character then","	apply(player.Character)","end",t.keep?"player.CharacterAdded:Connect(apply) -- 復活しても効くように":""].filter(a=>a!=="")})}},z=[["touch","touch"],["click","click"],["prompt","prompt"],["button","button"],["key","key"],["chat","chat"],["timer","timer"],["join","join"],["join","spawnEv"]],W=[],s=e=>W.push(e),c=(e,...t)=>t.filter(a=>e.concepts.has(a)).length;s({id:"datastore",title:"データの保存 (leaderstats + DataStore)",mode:"studio",score:e=>(c(e,"datastore")?3:0)+(c(e,"datastore")&&c(e,"leaderstats","coin","points")?2:0),build:e=>{let t=e.concepts.has("points")&&!e.concepts.has("coin")?"Points":"Coins";return{files:[{name:"PlayerData.server.lua",code:`-- プレイヤーのデータ (${t}) を保存・読み込みします
-- ServerScriptService に Script として入れてください
-- Studio で試すには「ゲーム設定 → セキュリティ → API サービスへの Studio アクセスを有効にする」をオンに
local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")

local store = DataStoreService:GetDataStore("PlayerData_v1")
local DEFAULT = { ${t} = 0 }

local function keyOf(player)
	return "Player_" .. player.UserId
end

local function load(player)
	local ok, data = pcall(function()
		return store:GetAsync(keyOf(player))
	end)
	if not ok then
		warn("読み込みに失敗しました:", data)
		return table.clone(DEFAULT), false
	end
	return data or table.clone(DEFAULT), true
end

local function save(player)
	local leaderstats = player:FindFirstChild("leaderstats")
	if not leaderstats or not player:GetAttribute("DataLoaded") then
		return -- 読み込めていないデータで上書きしない
	end
	local data = { ${t} = leaderstats.${t}.Value }
	local ok, err = pcall(function()
		store:SetAsync(keyOf(player), data)
	end)
	if not ok then
		warn("保存に失敗しました:", err)
	end
end

Players.PlayerAdded:Connect(function(player)
	local data, loaded = load(player)

	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"

	local stat = Instance.new("IntValue")
	stat.Name = "${t}"
	stat.Value = data.${t} or 0
	stat.Parent = leaderstats

	leaderstats.Parent = player
	player:SetAttribute("DataLoaded", loaded)
end)

Players.PlayerRemoving:Connect(save)

-- サーバーが閉じるときも全員分を保存
game:BindToClose(function()
	for _, player in Players:GetPlayers() do
		save(player)
	end
end)

-- 自動保存 (5 分ごと)
task.spawn(function()
	while true do
		task.wait(300)
		for _, player in Players:GetPlayers() do
			save(player)
		end
	end
end)
`}],summary:[`参加したときに ${t} を読み込み、退出・サーバー終了・5 分ごとに保存します`,"読み込みに失敗したときは、データを上書きしないようにしています (データ消失の防止)",`${t} を増やすには、サーバーのスクリプトで \`player.leaderstats.${t}.Value += 1\``]}}});s({id:"leaderstats",title:"リーダーボード (leaderstats)",mode:"studio",score:e=>(c(e,"leaderstats")?3:0)+(c(e,"leaderstats")&&c(e,"coin","points")?1:0)-(c(e,"datastore")?3:0)-(c(e,"touch","click","prompt","timer","chat")?2:0),build:e=>{let t=[];return e.concepts.has("coin")&&t.push("Coins"),(e.concepts.has("points")||!t.length)&&t.push(/キル|kill/i.test(e.text)?"Kills":"Points"),{files:[{name:"Leaderstats.server.lua",code:`-- 画面右上のリーダーボードに ${t.join("・")} を表示します
-- ServerScriptService に Script として入れてください
local Players = game:GetService("Players")

Players.PlayerAdded:Connect(function(player)
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats" -- この名前でないと表示されません
${t.map(a=>`
	local ${a.toLowerCase()} = Instance.new("IntValue")
	${a.toLowerCase()}.Name = "${a}"
	${a.toLowerCase()}.Value = 0
	${a.toLowerCase()}.Parent = leaderstats
`).join("")}
	leaderstats.Parent = player
end)
`}],summary:[`参加したプレイヤーに ${t.join("・")} の表示を作ります`,`値を変えるにはサーバーで \`player.leaderstats.${t[0]}.Value += 1\``,"保存もしたいときは「データを保存して」と頼んでください"]}}});s({id:"platform",title:"往復する床 (動く足場)",mode:"studio",score:e=>c(e,"platform")*3,build:e=>{let t=h(e.slots,e.text,["距離","スタッド","stud"],20),a=e.slots.seconds||3,o=/(上下|縦|エレベーター|elevator|リフト)/.test(p(e.text));return{files:[{name:"MovingPlatform.server.lua",code:`-- 往復する床 (${o?"上下":"左右"}に ${t} スタッド、片道 ${a} 秒)
-- 動かしたいパーツの中に Script として入れてください
local TweenService = game:GetService("TweenService")

local platform = script.Parent
platform.Anchored = true

local DISTANCE = ${t}
local TIME = ${a}

local startCFrame = platform.CFrame
local goal = startCFrame + ${o?"Vector3.new(0, DISTANCE, 0)":"startCFrame.RightVector * DISTANCE"}
local info = TweenInfo.new(TIME, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true) -- -1: ずっと, true: 往復

TweenService:Create(platform, info, { CFrame = goal }):Play()
`}],summary:[`パーツが ${o?"上下":"左右"}に ${t} スタッド、片道 ${a} 秒で往復します`,"乗ったプレイヤーも一緒に運ばれます (Anchored + CFrame のトゥイーン)","距離と時間はスクリプトの先頭の DISTANCE / TIME で変えられます"]}}});s({id:"spin",title:"回転するパーツ",mode:"studio",score:e=>(c(e,"spin")?3:0)-(c(e,"touch","click","key","button")?1:0),build:e=>{let t=h(e.slots,e.text,["度","速さ","スピード","speed"],90);return{files:[{name:"Spinner.server.lua",code:`-- パーツを回転させます (1 秒に ${t} 度)
-- 回したいパーツの中に Script として入れてください
local RunService = game:GetService("RunService")

local part = script.Parent
part.Anchored = true

local SPEED = math.rad(${t}) -- 1 秒あたりの回転 (度 → ラジアン)

RunService.Heartbeat:Connect(function(dt)
	part.CFrame *= CFrame.Angles(0, SPEED * dt, 0)
end)
`}],summary:[`パーツを 1 秒に ${t} 度、Y 軸 (縦の軸) で回します`,"フレームの時間 (dt) を掛けているので、端末の速さに関係なく同じ速さで回ります"]}}});s({id:"daynight",title:"昼と夜のサイクル",mode:"studio",score:e=>c(e,"daynight")*3,build:e=>{let t=e.slots.seconds?Math.max(1,Math.round(e.slots.seconds/60)):10;return{files:[{name:"DayNight.server.lua",code:`-- 昼と夜のサイクル (1 日 = ${t} 分)
-- ServerScriptService に Script として入れてください
local Lighting = game:GetService("Lighting")
local RunService = game:GetService("RunService")

local DAY_MINUTES = ${t} -- 現実の何分でゲームの 1 日が過ぎるか

RunService.Heartbeat:Connect(function(dt)
	Lighting.ClockTime = (Lighting.ClockTime + dt * 24 / (DAY_MINUTES * 60)) % 24
end)
`}],summary:[`ゲームの 1 日が ${t} 分で過ぎるように、Lighting.ClockTime を進めます`,"長さは DAY_MINUTES で変えられます"]}}});s({id:"round",title:"ラウンド (待ち時間 → ゲーム → 結果) とタイマー表示",mode:"studio",score:e=>c(e,"round")*3+(c(e,"round")&&c(e,"countdown")?1:0),build:e=>{let t=e.slots.seconds||60;return{files:[{name:"RoundSystem.server.lua",code:`-- ラウンドの進行 (待ち時間 → ゲーム → 結果) をくり返します
-- ServerScriptService に Script として入れてください
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local INTERMISSION = 15 -- 待ち時間 (秒)
local ROUND_TIME = ${t} -- 1 ラウンドの長さ (秒)
local MIN_PLAYERS = 1

-- 画面に表示する文字 (クライアントが読みます)
local status = Instance.new("StringValue")
status.Name = "RoundStatus"
status.Parent = ReplicatedStorage

local function countdown(seconds, format)
	for t = seconds, 1, -1 do
		status.Value = string.format(format, t)
		task.wait(1)
	end
end

while true do
	-- 人数がそろうまで待つ
	while #Players:GetPlayers() < MIN_PLAYERS do
		status.Value = "プレイヤーを待っています…"
		task.wait(1)
	end

	countdown(INTERMISSION, "次のラウンドまで %d 秒")

	-- ここでマップの準備やテレポートをします
	local alive = {}
	for _, player in Players:GetPlayers() do
		if player.Character then
			alive[player] = true
		end
	end

	countdown(ROUND_TIME, "残り %d 秒")

	status.Value = "ラウンド終了!"
	task.wait(3)
end
`},{name:"RoundTimer.client.lua",code:`-- サーバーの RoundStatus を画面の上に表示します
-- StarterPlayerScripts に LocalScript として入れてください
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local status = ReplicatedStorage:WaitForChild("RoundStatus")

local gui = Instance.new("ScreenGui")
gui.Name = "RoundTimer"
gui.ResetOnSpawn = false

local label = Instance.new("TextLabel")
label.AnchorPoint = Vector2.new(0.5, 0)
label.Position = UDim2.new(0.5, 0, 0, 12)
label.Size = UDim2.new(0.6, 0, 0, 44)
label.BackgroundColor3 = Color3.fromRGB(20, 20, 28)
label.BackgroundTransparency = 0.3
label.TextColor3 = Color3.new(1, 1, 1)
label.Font = Enum.Font.GothamBold
label.TextScaled = true
label.Parent = gui
Instance.new("UICorner").Parent = label

gui.Parent = player:WaitForChild("PlayerGui")

local function update()
	label.Text = status.Value
end
status.Changed:Connect(update)
update()
`}],summary:["サーバーが「待ち時間 → ラウンド → 結果」をくり返し、状況を ReplicatedStorage の RoundStatus に書きます",`クライアントがそれを画面の上に表示します (ラウンドは ${t} 秒)`,"ラウンドの中身 (マップ・テレポート・勝敗) は「ここでマップの準備」の場所に足してください"]}}});s({id:"countdown",title:"カウントダウンタイマーの表示",mode:"any",score:e=>(c(e,"countdown")?2.5:0)-(c(e,"round")?3:0),build:e=>{let t=e.slots.seconds||60,a=e.mode==="executor";return{files:[{name:a?"Countdown.lua":"Countdown.client.lua",code:`-- 画面の上に ${t} 秒のカウントダウンを表示します
${a?"":`-- StarterPlayerScripts に LocalScript として入れてください
`}local Players = game:GetService("Players")
local player = Players.LocalPlayer

local SECONDS = ${t}

local gui = Instance.new("ScreenGui")
gui.Name = "Countdown"
gui.ResetOnSpawn = false

local label = Instance.new("TextLabel")
label.AnchorPoint = Vector2.new(0.5, 0)
label.Position = UDim2.new(0.5, 0, 0, 16)
label.Size = UDim2.fromOffset(200, 56)
label.BackgroundColor3 = Color3.fromRGB(20, 20, 28)
label.TextColor3 = Color3.new(1, 1, 1)
label.Font = Enum.Font.GothamBold
label.TextScaled = true
label.Parent = gui
Instance.new("UICorner").Parent = label

gui.Parent = ${a?'(gethui and gethui()) or game:GetService("CoreGui")':'player:WaitForChild("PlayerGui")'}

for t = SECONDS, 0, -1 do
	label.Text = string.format("%02d:%02d", t // 60, t % 60)
	if t <= 10 then
		label.TextColor3 = Color3.fromRGB(255, 90, 90) -- 残り 10 秒で赤に
	end
	task.wait(1)
end

label.Text = "時間切れ!"
task.wait(3)
gui:Destroy()
`}],summary:[`画面の上に ${t} 秒のカウントダウンを「分:秒」で表示します`,"残り 10 秒で赤くなり、0 になると「時間切れ!」と出て消えます"]}}});s({id:"npc",title:"追いかけてくる NPC",mode:"studio",score:e=>c(e,"npc")*3,build:e=>{let t=h(e.slots,e.text,["範囲","距離","スタッド"],60),a=e.concepts.has("damage")||e.concepts.has("kill")||/(敵|ゾンビ|zombie|enemy|モンスター|攻撃)/.test(p(e.text)),o=h(e.slots,e.text,["ダメージ","damage"],10);return{files:[{name:"ChaseNPC.server.lua",code:`-- いちばん近いプレイヤーを追いかける NPC${a?" (触れるとダメージ)":""}
-- NPC のモデル (Humanoid と HumanoidRootPart があるもの) の中に Script として入れてください
local Players = game:GetService("Players")
local PathfindingService = game:GetService("PathfindingService")

local npc = script.Parent
local humanoid = npc:WaitForChild("Humanoid")
local root = npc:WaitForChild("HumanoidRootPart")

local RANGE = ${t} -- この距離より近いプレイヤーを追う
${a?`local DAMAGE = ${o}
local ATTACK_COOLDOWN = 1
`:""}
local function nearestCharacter()
	local best, bestDist = nil, RANGE
	for _, player in Players:GetPlayers() do
		local character = player.Character
		local hum = character and character:FindFirstChildOfClass("Humanoid")
		local hrp = character and character:FindFirstChild("HumanoidRootPart")
		if hum and hrp and hum.Health > 0 then
			local dist = (hrp.Position - root.Position).Magnitude
			if dist < bestDist then
				best, bestDist = character, dist
			end
		end
	end
	return best, bestDist
end

local function moveToward(target)
	local path = PathfindingService:CreatePath({ AgentCanJump = true })
	local ok = pcall(function()
		path:ComputeAsync(root.Position, target.Position)
	end)
	if ok and path.Status == Enum.PathStatus.Success then
		local waypoints = path:GetWaypoints()
		-- 少しずつ進んで、相手が動いたら計算し直す
		for i = 2, math.min(#waypoints, 4) do
			local wp = waypoints[i]
			if wp.Action == Enum.PathWaypointAction.Jump then
				humanoid.Jump = true
			end
			humanoid:MoveTo(wp.Position)
			humanoid.MoveToFinished:Wait()
		end
	else
		humanoid:MoveTo(target.Position) -- 道が見つからないときはまっすぐ
	end
end
${a?`
local lastHit = {}
root.Touched:Connect(function(hit)
	local character = hit.Parent
	local hum = character and character:FindFirstChildOfClass("Humanoid")
	if not hum or character == npc then
		return
	end
	local now = os.clock()
	if lastHit[character] and now - lastHit[character] < ATTACK_COOLDOWN then
		return
	end
	lastHit[character] = now
	hum:TakeDamage(DAMAGE)
end)
`:""}
while humanoid.Health > 0 do
	local target = nearestCharacter()
	if target then
		moveToward(target.HumanoidRootPart)
	else
		task.wait(0.5)
	end
end
`}],summary:[`${t} スタッド以内でいちばん近いプレイヤーを、経路探索 (PathfindingService) で障害物を避けながら追いかけます`].concat(a?[`触れたプレイヤーに ${o} ダメージ (1 秒に 1 回まで)`]:[]).concat(["NPC には Humanoid と HumanoidRootPart が必要です (ツールボックスの「Rig」などで作れます)"])}}});s({id:"shop",title:"ショップ (UI + サーバーでの購入処理)",mode:"studio",score:e=>c(e,"shop")*3,build:()=>({files:[{name:"ShopServer.server.lua",code:`-- ショップの購入処理 (値段はサーバーが決めるので、改造されても安全)
-- ServerScriptService に Script として入れてください
-- ServerStorage に、売りたいツール (Sword など) を置いてください
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local PRICES = {
	Sword = 50,
	Shield = 80,
	Potion = 20,
}

local buyRemote = Instance.new("RemoteEvent")
buyRemote.Name = "BuyItem"
buyRemote.Parent = ReplicatedStorage

Players.PlayerAdded:Connect(function(player)
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"
	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Value = 100 -- 最初の所持金
	coins.Parent = leaderstats
	leaderstats.Parent = player
end)

local lastBuy = {}
buyRemote.OnServerEvent:Connect(function(player, itemName)
	if typeof(itemName) ~= "string" then
		return
	end
	local price = PRICES[itemName]
	if not price then
		return -- 売っていないもの
	end
	local now = os.clock()
	if lastBuy[player] and now - lastBuy[player] < 0.5 then
		return -- 連打の防止
	end
	lastBuy[player] = now

	local coins = player.leaderstats.Coins
	if coins.Value < price then
		return
	end
	local item = ServerStorage:FindFirstChild(itemName)
	coins.Value -= price
	if item then
		item:Clone().Parent = player.Backpack
	end
end)

Players.PlayerRemoving:Connect(function(player)
	lastBuy[player] = nil
end)
`},{name:"ShopUI.client.lua",code:`-- ショップの画面 (右下のボタンで開く / 閉じる)
-- StarterPlayerScripts に LocalScript として入れてください
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local player = Players.LocalPlayer
local buyRemote = ReplicatedStorage:WaitForChild("BuyItem")

local ITEMS = {
	{ name = "Sword", label = "剣", price = 50 },
	{ name = "Shield", label = "盾", price = 80 },
	{ name = "Potion", label = "回復薬", price = 20 },
}

local gui = Instance.new("ScreenGui")
gui.Name = "Shop"
gui.ResetOnSpawn = false

-- 開くボタン
local openButton = Instance.new("TextButton")
openButton.AnchorPoint = Vector2.new(1, 1)
openButton.Position = UDim2.new(1, -16, 1, -96)
openButton.Size = UDim2.fromOffset(120, 48)
openButton.BackgroundColor3 = Color3.fromRGB(255, 170, 40)
openButton.Text = "ショップ"
openButton.Font = Enum.Font.GothamBold
openButton.TextSize = 18
openButton.Parent = gui
Instance.new("UICorner").Parent = openButton

-- ショップの窓
local frame = Instance.new("Frame")
frame.AnchorPoint = Vector2.new(0.5, 0.5)
frame.Position = UDim2.fromScale(0.5, 0.5)
frame.Size = UDim2.fromScale(0.8, 0.6)
frame.BackgroundColor3 = Color3.fromRGB(28, 28, 36)
frame.Visible = false
frame.Parent = gui
Instance.new("UICorner").Parent = frame
local limit = Instance.new("UISizeConstraint")
limit.MaxSize = Vector2.new(420, 360)
limit.Parent = frame

local title = Instance.new("TextLabel")
title.Size = UDim2.new(1, -56, 0, 44)
title.Position = UDim2.fromOffset(16, 6)
title.BackgroundTransparency = 1
title.Text = "ショップ"
title.TextXAlignment = Enum.TextXAlignment.Left
title.TextColor3 = Color3.new(1, 1, 1)
title.Font = Enum.Font.GothamBold
title.TextSize = 22
title.Parent = frame

local closeButton = Instance.new("TextButton")
closeButton.AnchorPoint = Vector2.new(1, 0)
closeButton.Position = UDim2.new(1, -8, 0, 8)
closeButton.Size = UDim2.fromOffset(36, 36)
closeButton.BackgroundColor3 = Color3.fromRGB(200, 60, 60)
closeButton.Text = "X"
closeButton.TextColor3 = Color3.new(1, 1, 1)
closeButton.Font = Enum.Font.GothamBold
closeButton.TextSize = 18
closeButton.Parent = frame
Instance.new("UICorner").Parent = closeButton

local list = Instance.new("ScrollingFrame")
list.Position = UDim2.fromOffset(12, 56)
list.Size = UDim2.new(1, -24, 1, -68)
list.BackgroundTransparency = 1
list.ScrollBarThickness = 4
list.AutomaticCanvasSize = Enum.AutomaticSize.Y
list.CanvasSize = UDim2.new()
list.Parent = frame
local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 8)
layout.Parent = list

for _, item in ITEMS do
	local row = Instance.new("Frame")
	row.Size = UDim2.new(1, 0, 0, 52)
	row.BackgroundColor3 = Color3.fromRGB(44, 44, 56)
	row.Parent = list
	Instance.new("UICorner").Parent = row

	local name = Instance.new("TextLabel")
	name.Size = UDim2.new(0.6, 0, 1, 0)
	name.Position = UDim2.fromOffset(12, 0)
	name.BackgroundTransparency = 1
	name.Text = item.label .. "  (" .. item.price .. " コイン)"
	name.TextXAlignment = Enum.TextXAlignment.Left
	name.TextColor3 = Color3.new(1, 1, 1)
	name.Font = Enum.Font.Gotham
	name.TextSize = 16
	name.Parent = row

	local buy = Instance.new("TextButton")
	buy.AnchorPoint = Vector2.new(1, 0.5)
	buy.Position = UDim2.new(1, -8, 0.5, 0)
	buy.Size = UDim2.fromOffset(84, 38)
	buy.BackgroundColor3 = Color3.fromRGB(60, 170, 90)
	buy.Text = "購入"
	buy.TextColor3 = Color3.new(1, 1, 1)
	buy.Font = Enum.Font.GothamBold
	buy.TextSize = 16
	buy.Parent = row
	Instance.new("UICorner").Parent = buy

	buy.Activated:Connect(function()
		buyRemote:FireServer(item.name) -- 「買いたい」だけを送る (値段はサーバーが確認)
	end)
end

gui.Parent = player:WaitForChild("PlayerGui")

local function setOpen(open)
	frame.Visible = true
	frame.Size = open and UDim2.fromScale(0.7, 0.5) or UDim2.fromScale(0.8, 0.6)
	local tween = TweenService:Create(frame, TweenInfo.new(0.15), { Size = open and UDim2.fromScale(0.8, 0.6) or UDim2.fromScale(0.7, 0.5) })
	tween:Play()
	if not open then
		tween.Completed:Wait()
		frame.Visible = false
	end
end

openButton.Activated:Connect(function()
	setOpen(not frame.Visible)
end)
closeButton.Activated:Connect(function()
	setOpen(false)
end)
`}],summary:["右下の「ショップ」ボタンで開く画面と、サーバー側の購入処理を作りました","クライアントは「買いたい」だけを送り、値段と所持金はサーバーが確かめます (改造対策)","品物は ShopServer の PRICES と ShopUI の ITEMS に足してください。ツールは ServerStorage に同じ名前で置きます"]})});s({id:"remote",title:"RemoteEvent (クライアント → サーバー) のひな形",mode:"studio",score:e=>(c(e,"remote")?2.5:0)-(c(e,"shop")?3:0),build:e=>{let t=k(e.slots.quoted[0],"MyRemote");return{files:[{name:`${t}.server.lua`,code:`-- RemoteEvent のサーバー側 (クライアントから届いたお願いを処理)
-- ServerScriptService に Script として入れてください
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local remote = Instance.new("RemoteEvent")
remote.Name = "${t}"
remote.Parent = ReplicatedStorage

local lastCall = {}
remote.OnServerEvent:Connect(function(player, action, value)
	-- 最初の引数は、送ってきたプレイヤー (自動で付きます)
	if typeof(action) ~= "string" then
		return -- 値を確かめる (改造されたクライアントは何でも送れるため)
	end
	local now = os.clock()
	if lastCall[player] and now - lastCall[player] < 0.2 then
		return -- 連打の防止
	end
	lastCall[player] = now

	print(player.Name, "から:", action, value)
	-- 返事をしたいとき
	remote:FireClient(player, "ok", action)
end)
`},{name:`${t}.client.lua`,code:`-- RemoteEvent のクライアント側 (サーバーにお願いを送る)
-- StarterPlayerScripts に LocalScript として入れてください
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local remote = ReplicatedStorage:WaitForChild("${t}")

-- サーバーからの返事
remote.OnClientEvent:Connect(function(status, action)
	print("サーバーの返事:", status, action)
end)

-- サーバーに送る (player は付けなくてよい)
remote:FireServer("hello", 123)
`}],summary:["サーバー側で RemoteEvent を作り、クライアントから FireServer で送ったものを OnServerEvent で受け取ります","サーバーでは届いた値を必ず確かめ、連打も防いでいます","サーバーから返事を送るときは FireClient → クライアントの OnClientEvent"]}}});s({id:"module",title:"ModuleScript (クラス) のひな形",mode:"any",score:e=>c(e,"module")*2.5,build:e=>{let t=k(e.slots.quoted[0]||e.slots.identifiers.find(a=>/^[A-Z][a-z]\w+$/.test(a)&&a!=="ModuleScript"),"MyClass");return{files:[{name:`${t}.lua`,code:`-- ${t} クラス (ModuleScript)
-- 使い方:
--   local ${t} = require(path.to.${t})
--   local obj = ${t}.new("名前")
--   obj:greet()
local ${t} = {}
${t}.__index = ${t}

export type ${t} = typeof(setmetatable({} :: {
	name: string,
	level: number,
}, ${t}))

function ${t}.new(name: string): ${t}
	local self = setmetatable({}, ${t})
	self.name = name
	self.level = 1
	return self
end

function ${t}:levelUp(amount: number?)
	self.level += amount or 1
end

function ${t}:greet()
	print(\`{self.name} (Lv.{self.level}) です\`)
end

return ${t}
`}],summary:[`${t}.new で作り、:greet() などのメソッドを持つクラスです`,"メタテーブル (__index) でメソッドを共有しているので、たくさん作っても軽いです","型 (export type) 付きなので補完も効きます"]}}});s({id:"doubleJump",title:"二段ジャンプ",mode:"any",score:e=>c(e,"doubleJump")*4,build:e=>{let t=e.mode==="executor",a=h(e.slots,e.text,["力","高さ","power"],50);return{files:[{name:t?"DoubleJump.lua":"DoubleJump.client.lua",code:`-- 二段ジャンプ (空中でもう一度ジャンプできる)
${t?"":`-- StarterCharacterScripts に LocalScript として入れてください
`}local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")

local player = Players.LocalPlayer
local POWER = ${a} -- 2 回目のジャンプの強さ

local canDouble = false
local usedDouble = false

local function setup(character)
	local humanoid = character:WaitForChild("Humanoid")
	local root = character:WaitForChild("HumanoidRootPart")
	humanoid.StateChanged:Connect(function(_, new)
		if new == Enum.HumanoidStateType.Landed then
			canDouble, usedDouble = false, false
		elseif new == Enum.HumanoidStateType.Freefall then
			canDouble = true
		end
	end)
end

UserInputService.JumpRequest:Connect(function()
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if humanoid and root and canDouble and not usedDouble then
		usedDouble = true
		root.AssemblyLinearVelocity = Vector3.new(root.AssemblyLinearVelocity.X, POWER, root.AssemblyLinearVelocity.Z)
	end
end)

if player.Character then
	setup(player.Character)
end
player.CharacterAdded:Connect(setup)
`}],summary:["空中でジャンプボタンを押すと、もう 1 回だけ上に飛びます (スマホのジャンプボタンでも動きます)","着地すると回数がリセットされます",`強さは POWER (${a}) で変えられます`]}}});s({id:"sword",title:"剣 (ツール)",mode:"studio",score:e=>c(e,"tool")&&/(剣|sword|武器|weapon|攻撃)/.test(p(e.text))?3.5:0,build:e=>{let t=h(e.slots,e.text,["ダメージ","damage"],25);return{files:[{name:"Sword.server.lua",code:`-- 剣: 振ったときに当たった相手に ${t} ダメージ
-- Tool (中に Handle という名前のパーツ) の中に Script として入れ、Tool を StarterPack に置いてください
local Players = game:GetService("Players")

local tool = script.Parent
local handle = tool:WaitForChild("Handle")

local DAMAGE = ${t}
local SWING_TIME = 0.4
local COOLDOWN = 0.6

local swinging = false
local lastSwing = 0
local hitThisSwing = {}

tool.Activated:Connect(function()
	local now = os.clock()
	if now - lastSwing < COOLDOWN then
		return
	end
	lastSwing = now
	swinging = true
	table.clear(hitThisSwing)
	task.wait(SWING_TIME)
	swinging = false
end)

handle.Touched:Connect(function(hit)
	if not swinging then
		return
	end
	local character = hit.Parent
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not humanoid or character == tool.Parent or hitThisSwing[humanoid] then
		return -- 自分自身と、同じ振りで 2 回目は当てない
	end
	hitThisSwing[humanoid] = true
	humanoid:TakeDamage(DAMAGE)
end)
`}],summary:[`ツールを使う (クリック / タップ) と ${X}、その間に触れた相手に ${t} ダメージ`,"1 回の振りで同じ相手には 1 回だけ当たり、連打もできないようにしています","Tool の中に Handle という名前のパーツが必要です"]}}});var X="0.4 秒間「振っている」状態になり";s({id:"gui",title:"開閉できる GUI メニュー",mode:"any",score:e=>(c(e,"gui")?2:0)+(c(e,"gui")&&c(e,"button")?.5:0)-(c(e,"shop")?3:0)-(H.some(t=>t.c.some(a=>e.concepts.has(a)))?1.5:0),build:e=>{let t=e.mode==="executor",a=e.slots.quoted[0]||"メニュー";return{files:[{name:t?"Menu.lua":"Menu.client.lua",code:`-- 開閉できるメニュー (ドラッグで動かせる)
${t?"":`-- StarterPlayerScripts に LocalScript として入れてください
`}local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")

local player = Players.LocalPlayer
${t?`if getgenv().MyMenu then
	getgenv().MyMenu:Destroy() -- 前回のメニューを消す (二重実行の防止)
end
`:""}
local gui = Instance.new("ScreenGui")
gui.Name = "Menu"
gui.ResetOnSpawn = false
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling

local window = Instance.new("Frame")
window.AnchorPoint = Vector2.new(0.5, 0.5)
window.Position = UDim2.fromScale(0.5, 0.5)
window.Size = UDim2.fromOffset(300, 220)
window.BackgroundColor3 = Color3.fromRGB(26, 26, 34)
window.Parent = gui
Instance.new("UICorner").Parent = window
local stroke = Instance.new("UIStroke")
stroke.Color = Color3.fromRGB(80, 80, 110)
stroke.Parent = window

local titleBar = Instance.new("TextLabel")
titleBar.Size = UDim2.new(1, 0, 0, 40)
titleBar.BackgroundTransparency = 1
titleBar.Text = "  " .. ${m(a)}
titleBar.TextXAlignment = Enum.TextXAlignment.Left
titleBar.TextColor3 = Color3.new(1, 1, 1)
titleBar.Font = Enum.Font.GothamBold
titleBar.TextSize = 18
titleBar.Parent = window

local closeButton = Instance.new("TextButton")
closeButton.AnchorPoint = Vector2.new(1, 0)
closeButton.Position = UDim2.new(1, -6, 0, 6)
closeButton.Size = UDim2.fromOffset(28, 28)
closeButton.BackgroundColor3 = Color3.fromRGB(200, 60, 60)
closeButton.Text = "-"
closeButton.TextColor3 = Color3.new(1, 1, 1)
closeButton.Font = Enum.Font.GothamBold
closeButton.TextSize = 18
closeButton.Parent = window
Instance.new("UICorner").Parent = closeButton

local content = Instance.new("Frame")
content.Position = UDim2.fromOffset(12, 46)
content.Size = UDim2.new(1, -24, 1, -58)
content.BackgroundTransparency = 1
content.Parent = window
local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 8)
layout.Parent = content

-- ボタンを追加する関数: addButton("名前", function() ... end)
local function addButton(text, onClick)
	local button = Instance.new("TextButton")
	button.Size = UDim2.new(1, 0, 0, 40)
	button.BackgroundColor3 = Color3.fromRGB(50, 90, 200)
	button.Text = text
	button.TextColor3 = Color3.new(1, 1, 1)
	button.Font = Enum.Font.Gotham
	button.TextSize = 16
	button.Parent = content
	Instance.new("UICorner").Parent = button
	button.Activated:Connect(function()
		onClick(button)
	end)
	return button
end

addButton("あいさつ", function()
	print("こんにちは、" .. player.Name)
end)

local fast = false
addButton("速く歩く: OFF", function(button)
	local humanoid = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	if not humanoid then
		return
	end
	fast = not fast
	humanoid.WalkSpeed = fast and 32 or 16
	button.Text = fast and "速く歩く: ON" or "速く歩く: OFF"
end)

-- 最小化 / 元に戻す
local minimized = false
closeButton.Activated:Connect(function()
	minimized = not minimized
	content.Visible = not minimized
	closeButton.Text = minimized and "+" or "-"
	TweenService:Create(window, TweenInfo.new(0.2), { Size = minimized and UDim2.fromOffset(300, 40) or UDim2.fromOffset(300, 220) }):Play()
end)

-- タイトルをドラッグして動かす (マウス・タッチ)
local dragging, dragStart, startPos
titleBar.InputBegan:Connect(function(input)
	if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
		dragging, dragStart, startPos = true, input.Position, window.Position
	end
end)
UserInputService.InputChanged:Connect(function(input)
	if dragging and (input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch) then
		local delta = input.Position - dragStart
		window.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset + delta.X, startPos.Y.Scale, startPos.Y.Offset + delta.Y)
	end
end)
UserInputService.InputEnded:Connect(function(input)
	if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
		dragging = false
	end
end)

gui.Parent = ${t?'(gethui and gethui()) or game:GetService("CoreGui")':'player:WaitForChild("PlayerGui")'}
${t?`getgenv().MyMenu = gui
`:""}`}],summary:[`「${a}」という、ドラッグで動かせて最小化できるメニューを作りました`,'addButton("名前", function() ... end) でボタンを増やせます (例として「あいさつ」「速く歩く」)',"スマホのタッチでもドラッグできます"]}}});s({id:"esp",title:"ESP (プレイヤーの強調表示と名前)",mode:"executor",score:e=>c(e,"esp")*3+(c(e,"esp")&&c(e,"drawing")?1:0),build:e=>{let t=e.slots.colors[0];return{files:[{name:"ESP.lua",code:`-- ESP: 他のプレイヤーを壁越しに強調表示し、名前と距離を表示します
-- もう一度実行すると前回の表示を消してから作り直します
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera
local COLOR = ${t?D(t):"Color3.fromRGB(255, 70, 70)"}

if getgenv().ESP then
	getgenv().ESP.stop()
end

local items = {} -- [player] = { highlight, label }
local connections = {}

local function add(other)
	if other == player then
		return
	end
	local highlight = Instance.new("Highlight")
	highlight.FillColor = COLOR
	highlight.FillTransparency = 0.6
	highlight.OutlineColor = Color3.new(1, 1, 1)
	highlight.DepthMode = Enum.HighlightDepthMode.AlwaysOnTop

	local label = Drawing.new("Text")
	label.Size = 16
	label.Center = true
	label.Outline = true
	label.Color = Color3.new(1, 1, 1)
	label.Visible = false

	items[other] = { highlight = highlight, label = label }
end

local function remove(other)
	local item = items[other]
	if item then
		item.highlight:Destroy()
		item.label:Remove()
		items[other] = nil
	end
end

for _, other in Players:GetPlayers() do
	add(other)
end
table.insert(connections, Players.PlayerAdded:Connect(add))
table.insert(connections, Players.PlayerRemoving:Connect(remove))

table.insert(connections, RunService.RenderStepped:Connect(function()
	local myRoot = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
	for other, item in items do
		local character = other.Character
		local root = character and character:FindFirstChild("HumanoidRootPart")
		item.highlight.Adornee = character
		item.highlight.Parent = character and (gethui and gethui() or game:GetService("CoreGui")) or nil
		if root then
			local pos, onScreen = camera:WorldToViewportPoint(root.Position + Vector3.new(0, 3, 0))
			item.label.Visible = onScreen
			if onScreen then
				local dist = myRoot and math.floor((root.Position - myRoot.Position).Magnitude) or 0
				item.label.Text = string.format("%s [%dm]", other.DisplayName, dist)
				item.label.Position = Vector2.new(pos.X, pos.Y)
			end
		else
			item.label.Visible = false
		end
	end
end))

getgenv().ESP = {
	stop = function()
		for _, c in connections do
			c:Disconnect()
		end
		for other in items do
			remove(other)
		end
	end,
}
print("ESP をオンにしました (getgenv().ESP.stop() で止まります)")
`}],summary:["他のプレイヤーを Highlight で壁越しに強調し、Drawing の文字で名前と距離を表示します","もう一度実行すると前回のものを消してから作り直し、getgenv().ESP.stop() で止められます","使うのは自分のゲームや練習場所だけにしてください (公開ゲームでは利用規約違反になります)"]}}});s({id:"infJump",title:"無限ジャンプ",mode:"executor",score:e=>c(e,"infJump")*4,build:()=>({files:[{name:"InfiniteJump.lua",code:`-- 空中でも何度でもジャンプできるようにします (もう一度実行するとオフ)
local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local player = Players.LocalPlayer

if getgenv().InfJump then
	getgenv().InfJump:Disconnect()
	getgenv().InfJump = nil
	print("無限ジャンプ: OFF")
	return
end

getgenv().InfJump = UserInputService.JumpRequest:Connect(function()
	local humanoid = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid:ChangeState(Enum.HumanoidStateType.Jumping)
	end
end)
print("無限ジャンプ: ON")
`}],summary:["ジャンプボタン (スペース / スマホのボタン) を押すたびに、空中でもジャンプします","もう一度実行するとオフになります"]})});s({id:"fly",title:"飛行 (フライ)",mode:"executor",score:e=>c(e,"fly")*3.5,build:e=>{let t=h(e.slots,e.text,["速さ","スピード","speed"],60),a=e.slots.keys[0]||"F";return{files:[{name:"Fly.lua",code:`-- ${a} キーで飛行のオン / オフ。移動はいつもの操作 (スマホはスティック)、上下はカメラの向き
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera
local SPEED = ${t}
local KEY = Enum.KeyCode.${a}

local flying = false
local velocity, gyro

local function stop()
	flying = false
	if velocity then velocity:Destroy() end
	if gyro then gyro:Destroy() end
	local humanoid = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid.PlatformStand = false
	end
end

local function start()
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not root or not humanoid then
		return
	end
	flying = true
	humanoid.PlatformStand = true
	local attachment = root:FindFirstChild("FlyAttachment") or Instance.new("Attachment")
	attachment.Name = "FlyAttachment"
	attachment.Parent = root
	velocity = Instance.new("LinearVelocity")
	velocity.Attachment0 = attachment
	velocity.MaxForce = math.huge
	velocity.VectorVelocity = Vector3.zero
	velocity.Parent = root
	gyro = Instance.new("AlignOrientation")
	gyro.Mode = Enum.OrientationAlignmentMode.OneAttachment
	gyro.Attachment0 = attachment
	gyro.RigidityEnabled = true
	gyro.Parent = root
end

RunService.RenderStepped:Connect(function()
	if not flying or not velocity then
		return
	end
	local humanoid = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	local move = humanoid and humanoid.MoveDirection or Vector3.zero
	local look = camera.CFrame.LookVector
	-- 前に進むときはカメラの向き (上下も) に合わせる
	local forward = move.Magnitude > 0 and (look * move:Dot(Vector3.new(look.X, 0, look.Z).Unit) + (move - Vector3.new(look.X, 0, look.Z).Unit * move:Dot(Vector3.new(look.X, 0, look.Z).Unit))) or Vector3.zero
	velocity.VectorVelocity = forward.Magnitude > 0 and forward.Unit * SPEED or Vector3.zero
	gyro.CFrame = camera.CFrame
end)

UserInputService.InputBegan:Connect(function(input, gameProcessed)
	if gameProcessed or input.KeyCode ~= KEY then
		return
	end
	if flying then stop() else start() end
end)

player.CharacterAdded:Connect(stop)
print("${a} キーで飛行のオン / オフ")
`}],summary:[`${a} キーで飛行を切り替えます。移動はいつもの操作で、カメラを向けた方向へ飛びます`,`速さは SPEED (${t}) で変えられます`,"使うのは自分のゲームや練習場所だけにしてください"]}}});s({id:"noclip",title:"壁抜け (ノークリップ)",mode:"executor",score:e=>c(e,"noclip")*4,build:e=>{let t=e.slots.keys[0]||"N";return{files:[{name:"Noclip.lua",code:`-- ${t} キーで壁抜けのオン / オフ (自分のキャラクターの当たり判定を消します)
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local player = Players.LocalPlayer
local KEY = Enum.KeyCode.${t}
local enabled = false

RunService.Stepped:Connect(function()
	if not enabled or not player.Character then
		return
	end
	for _, part in player.Character:GetDescendants() do
		if part:IsA("BasePart") then
			part.CanCollide = false
		end
	end
end)

UserInputService.InputBegan:Connect(function(input, gameProcessed)
	if gameProcessed or input.KeyCode ~= KEY then
		return
	end
	enabled = not enabled
	print("壁抜け:", enabled and "ON" or "OFF")
end)
`}],summary:[`${t} キーで、自分のキャラクターの当たり判定を毎フレーム消して壁をすり抜けます`,"オフにすると次のフレームから元に戻ります"]}}});function q(e){let t=p(e.text),a=[];for(let n of H){if(!(n.match&&n.match.test(t)||!n.match&&n.c.some(u=>e.concepts.has(u))))continue;let d=1/0;for(let u of n.c)for(let f of j[u]||[]){let i=t.indexOf(f);i>=0&&i<d&&(d=i)}a.push({a:n,at:d})}let o=a.sort((n,r)=>n.at-r.at).map(n=>n.a);return o.some(n=>n.id==="kill")&&(o=o.filter(n=>n.id!=="damage"&&n.id!=="heal")),o.some(n=>n.id==="checkpoint")&&(o=o.filter(n=>n.id!=="teleport")),o.some(n=>n.id==="giveTool")&&!/(あげ|渡|もらえ|give|付与)/.test(t)&&(o=o.filter(n=>n.id!=="giveTool")),o.some(n=>n.id==="fling")&&o.some(n=>n.id==="jump")&&(o=o.filter(n=>n.id!=="jump")),o.some(n=>n.id==="spawnPart")&&o.some(n=>n.id==="disappear")&&!/(消え|消す)/.test(t)&&(o=o.filter(n=>n.id!=="disappear")),o.slice(0,4)}var j=Object.fromEntries(Object.entries(A).map(([e,t])=>[e,t.map(p)]));function Z(e,t){let a=p(e.text),o=null,n=1/0;for(let[r,d]of z){if(!e.concepts.has(d))continue;let u=1/0;for(let f of j[d]||[]){let i=a.indexOf(f);i>=0&&i<u&&(u=i)}r==="button"&&e.slots.keys.length&&!/(画面|gui|ui)/.test(a)||r==="key"&&!e.slots.keys.length&&/(ボタン|button)/.test(a)||u<n&&(n=u,o=r)}return o==="key"&&(e.concepts.has("prompt")||t.some(r=>r.id==="openDoor"))&&e.mode!=="executor"&&(o="prompt"),(o==="join"||!o&&e.concepts.has("join"))&&e.mode!=="executor"&&t.length&&t.every(r=>r.id==="message"||r.id==="sound")&&(o="start"),!o&&e.slots.keys.length&&/(押|press)/.test(a)&&(o="key"),o||(o=(t.find(r=>r.defaultTrigger)||{}).defaultTrigger||null),!o&&t.some(r=>r.triggers)&&(o=t.find(r=>r.triggers).triggers[0]),o||(e.mode==="executor"?o="now":t.every(r=>r.needs==="part"||r.needs===null)||e.concepts.has("part")||/(brick|block|lava|pad|ブロック|パッド|床|溶岩)/.test(p(e.text))?o="touch":o="join"),e.mode==="executor"&&x[o].side==="server"&&(o=e.slots.keys.length?"key":o==="timer"?"now":"button"),o}function oe(e,{mode:t="studio",concepts:a,slots:o}={}){a=a||N(e),o=o||L(e);let n={text:e,mode:t,concepts:a,slots:o},r=W.filter(i=>i.mode==="any"||i.mode===t||i.mode==="studio"&&t!=="executor").map(i=>({r:i,s:i.score(n)})).filter(i=>i.s>0).sort((i,S)=>S.s-i.s),d=q(n),u=z.some(([,i])=>a.has(i))||o.keys.length>0;if(!(d.length&&(!r.length||u&&r[0].s<3.5||r[0].s<2.5))&&r.length){let i=r[0].r.build(n);return V({...i,title:r[0].r.title,spec:{kind:"recipe",id:r[0].r.id},alternatives:r.slice(1,3).map(S=>S.r.title)})}return d.length?V(Q(n,d)):null}function Q(e,t){let a=Z(e,t),o=x[a],n=e.mode==="executor",r={cooldown:1,key:e.slots.keys[0]||(t.some(l=>l.id==="speed")&&a==="key"?"LeftShift":"E"),interval:e.slots.seconds||5,command:"/"+(t[0].id==="speed"?"speed":t[0].id==="teleport"?"tp":t[0].id),actionText:t[0].title.replace(/する$|る$/,"")||"使う",label:t[0].title,guiName:t[0].id+"Button",partName:e.slots.quoted[0]||"Part",executor:n,keep:!0};a==="touch"&&t.some(l=>l.id==="kill")&&(r.cooldown=.5),a==="touch"&&t.some(l=>l.id==="disappear"&&!l.params(e.slots,e.text,e).respawn)&&(r.cooldown=.2);let d=o.varsFor&&o.varsFor(t)||o.vars,u=o.side,f=u==="client"&&!n&&t.some(l=>l.side==="server"),i=t.map(l=>l.params(e.slots,e.text,e)),S=[],C=[],E=new Set,R=[];t.forEach((l,g)=>{if(l.needs&&!d[l.needs])if(l.needs==="part")C.some(v=>v.startsWith("local targetPart"))||C.push(`local targetPart = workspace:WaitForChild(${m(e.slots.quoted[0]||"TargetPart")}) -- 対象のパーツの名前`);else{R.push(l);return}let w={...d,part:d.part||"targetPart"};l.setup&&C.push(...l.setup(i[g],w)),l.helper&&E.add(l.helper),S.push(...l.code(i[g],w,{side:u}))});let T=t.find(l=>l.undo),O=a==="key"&&t.some((l,g)=>l.id==="speed"&&i[g].hold),_=a==="button"&&!!T&&/(切り替|オンオフ|on\/?off|トグル|toggle|押すたび)/.test(p(e.text)),J=(O||_)&&T?T.undo(i[t.indexOf(T)],d):null,G=[],I=`${t.map(l=>l.title).join("・")} (${o.title.replace(/ \(.*\)$/,"")})`;if(f){let l=k(t[0].id.replace(/^./,$=>$.toUpperCase())+"Request","ActionRequest"),g={character:"character",humanoid:"humanoid",player:"player",root:"root",part:"targetPart"},w=[];t.forEach(($,B)=>{$.setup&&C.push(...$.setup(i[B],g)),w.push(...$.code(i[B],g,{side:"server"}))});let v=[`-- ${I} (サーバー側)`,"-- ServerScriptService に Script として入れてください",'local Players = game:GetService("Players")','local ReplicatedStorage = game:GetService("ReplicatedStorage")',"",'local remote = Instance.new("RemoteEvent")',`remote.Name = ${m(l)}`,"remote.Parent = ReplicatedStorage",...C.length?["",...C]:[],...[...E].flatMap($=>["",...M[$]]),"","local lastUse = {}","remote.OnServerEvent:Connect(function(player)","	-- 連打の防止 (クライアントは改造されることがあるので、サーバーで制限)","	local now = os.clock()","	if lastUse[player] and now - lastUse[player] < 1 then","		return","	end","	lastUse[player] = now","	local character = player.Character",'	local humanoid = character and character:FindFirstChildOfClass("Humanoid")','	local root = character and character:FindFirstChild("HumanoidRootPart")',"	if not humanoid or not root then","		return","	end",...y(w,1),"end)",""],F=o.build(["remote:FireServer() -- サーバーに頼む"],r,t,null),K=[`-- ${I} (クライアント側)`,`-- ${o.place}`,...F.header.slice(0,1),'local ReplicatedStorage = game:GetService("ReplicatedStorage")',...F.header.slice(1),`local remote = ReplicatedStorage:WaitForChild(${m(l)})`,"",...F.body,""];G.push({name:`${l}.server.lua`,code:v.join(`
`)},{name:`${l}.client.lua`,code:K.join(`
`)})}else{let l=o.build(S,r,t,J),g=[`-- ${I}`,`-- ${o.place}`,...l.header,...C.length?["",...C]:[],...[...E].flatMap(v=>["",...M[v]]),"",...l.body,""],w=k(t.map(v=>v.id.replace(/^./,F=>F.toUpperCase())).join("")+({touch:"Part",key:"Key",button:"Button",click:"Click",prompt:"Prompt",chat:"Command",timer:"Loop",join:"OnSpawn",start:"OnJoin"}[a]||""),"Script");G.push({name:n?`${w}.lua`:`${w}.${u==="client"?"client":"server"}.lua`,code:g.join(`
`)})}let P=[`${o.title}: ${t.map((l,g)=>ee(l,i[g])).join("。")}`];return P.push(f?"キー / ボタンはクライアント、体力やコインの変更はサーバーで行うように、RemoteEvent でつないでいます (サーバー側で連打も防いでいます)":`置き場所: ${o.place}`),a==="touch"&&P.push(`同じ人には ${r.cooldown} 秒に 1 回だけ効きます (COOLDOWN で変更)`),a==="key"&&P.push(`キーは ${r.key}${O?" (押している間だけ効きます)":""}。KEY で変えられます。スマホにはキーがないので、ボタンにしたいときは「ボタンで」と頼んでください`),a==="chat"&&P.push(`チャットに ${r.command} と打つと実行します`),a==="timer"&&P.push(`${r.interval} 秒ごとに実行します (INTERVAL で変更)`),a==="join"&&n===!1&&P.push("出現するたび (リスポーン後も) に効きます"),R.length&&P.push(`「${R.map(l=>l.title).join("・")}」はこのきっかけでは使えないため省きました`),{files:G,title:I,summary:P,spec:{kind:"compose",trigger:a,actions:t.map(l=>l.id),params:i}}}function ee(e,t){switch(e.id){case"damage":return`${t.amount} ダメージを与えます`;case"heal":return`体力を ${t.amount} 回復します`;case"speed":return`歩く速さを ${t.value} にします${t.duration&&!t.hold?` (${t.duration} 秒間)`:""}`;case"jump":return`ジャンプ力を ${t.value} にします${t.duration?` (${t.duration} 秒間)`:""}`;case"fling":return`上に ${t.power} の速さで飛ばします`;case"teleport":return t.target?`「${t.target}」へテレポートします`:t.pos?`(${t.pos.join(", ")}) へテレポートします`:"「TeleportTarget」という名前のパーツへテレポートします";case"color":return t.color.rainbow?"ランダムな色に変えます":`${t.color.name}に変えます`;case"disappear":return t.destroy?"パーツを削除します":`パーツを消します${t.respawn?` (${t.respawn} 秒後に戻ります)`:""}`;case"coins":return`${t.stat} を ${t.amount} 増やします (leaderstats がなければ作ります)`;case"openDoor":return`ドアを${t.mode==="swing"?"回転させて":"上にスライドして"}開け、${t.seconds} 秒後に閉じます`;case"giveTool":return`ServerStorage の「${t.name}」を渡します`;default:return/する$/.test(e.title)?e.title.replace(/する$/,"します"):e.title.replace(/る$/,"ます")}}function V(e){if(!e)return null;for(let t of e.files){let a=U(t.code);a&&(t.error=`${a.line} 行目: ${a.message}`)}return e}var ne={studio:["触れたら死ぬブロック","クリックすると色が変わるパーツ","E キーでドアが開く","Shift を押している間だけ速く走る","触れるとコインが 10 増えて消える","3 秒ごとにパーツが降ってくる","データを保存するリーダーボード","ショップの UI","追いかけてくる敵","往復する床","昼と夜のサイクル","ラウンドとタイマー","二段ジャンプ","剣のツール","/speed で速くなるチャットコマンド"],executor:["スピードを 50 にする","ボタンで速く歩くのを切り替える","ESP","無限ジャンプ","F キーで飛ぶ","壁抜け","ドラッグできるメニュー","G キーでテレポート"]};export{H as a,x as b,W as c,oe as d,ne as e};
