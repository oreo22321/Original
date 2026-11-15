-- ForgeCode Live コネクター
-- Delta などのエグゼキューターで実行すると、ForgeCode とつながります。
--   ・ForgeCode の ▶ で、このゲームの中でスクリプトを実行
--   ・ゲームの出力・エラーを ForgeCode に表示 (ファイルの行へ移動・AI で直す)
--   ・ForgeCode のコンソールから、ゲームの中で式を評価
--   ・ゲームのオブジェクトを ForgeCode で一覧
-- 止めるとき: getgenv().ForgeCodeLive.stop()
-- 安全のため、コードを送れるのは鍵を持つ ForgeCode だけです (このスクリプトに鍵は入っていません)
local RELAY = "{{RELAY}}"
local ROOM = "{{ROOM}}"
local VERSION = 1

local env = (getgenv and getgenv()) or _G
if env.ForgeCodeLive and env.ForgeCodeLive.stop then
	pcall(env.ForgeCodeLive.stop)
end

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")

local httpRequest = (syn and syn.request) or (http and http.request) or http_request or request or (fluxus and fluxus.request)
if not httpRequest then
	error("ForgeCode Live: この実行環境は HTTP (request) に対応していません")
end

local alive = true
local outbox = {}
local runs = {}
local chunks = { console = true } -- このコネクターで実行したスクリプトの名前 (エラーの出どころの判定用)
local allLogs = false             -- ゲーム全体の出力も送るか (ForgeCode の設定)
local recent = {}                 -- print / warn で送ったばかりの文字列 (LogService と二重に送らない)
local base = RELAY .. "/r/" .. ROOM

local function push(m)
	if #outbox < 800 then
		outbox[#outbox + 1] = m
	end
end

local function encode(t)
	local ok, s = pcall(function()
		return HttpService:JSONEncode(t)
	end)
	return ok and s or "{}"
end

-- 値を表示用の文字列に
local function show(v, depth)
	depth = depth or 0
	local ty = typeof(v)
	if ty == "Instance" then
		local ok, full = pcall(function()
			return v:GetFullName()
		end)
		return (ok and full or tostring(v)) .. "  (" .. v.ClassName .. ")"
	elseif ty == "string" then
		return string.format("%q", v)
	elseif ty == "table" then
		if depth > 1 then
			return "{…}"
		end
		local parts, n = {}, 0
		for k, val in pairs(v) do
			n += 1
			if n > 12 then
				parts[#parts + 1] = "…"
				break
			end
			parts[#parts + 1] = (type(k) == "string" and k or "[" .. tostring(k) .. "]") .. " = " .. show(val, depth + 1)
		end
		return "{ " .. table.concat(parts, ", ") .. " }"
	elseif ty == "Vector3" or ty == "CFrame" or ty == "Color3" or ty == "UDim2" or ty == "Vector2" then
		return ty .. "(" .. tostring(v) .. ")"
	end
	return tostring(v)
end

-- 出力: 実行したスクリプトの print / warn は直接送る。
-- LogService からは、イベントの中などで起きたエラー (このコネクターで実行したもの) と、設定でオンにしたときはゲーム全体の出力を送る
local function mentionsChunk(text)
	for name in pairs(chunks) do
		if string.find(text, name, 1, true) then
			return true
		end
	end
	return false
end
local logConn
local hasLog = pcall(function()
	logConn = game:GetService("LogService").MessageOut:Connect(function(text, kind)
		text = tostring(text)
		local k = tostring(kind and kind.Name or kind)
		local t = recent[text]
		if t and os.clock() - t < 3 then
			return
		end
		if allLogs or ((k == "MessageError" or k == "MessageWarning") and mentionsChunk(text)) then
			push({ t = "log", kind = k, text = text })
		end
	end)
end)

-- 実行するスクリプトの print / warn を横取りして送る (元の print / warn も呼ぶ)
-- スクリプトの 1 行目の先頭に「local print, warn = …;」を足します (同じ行に足すので、行番号はずれません)
local function join(...)
	local n = select("#", ...)
	local parts = {}
	for i = 1, n do
		parts[i] = tostring((select(i, ...)))
	end
	return table.concat(parts, " ")
end
local function livePrint(...)
	local text = join(...)
	recent[text] = os.clock()
	push({ t = "log", kind = "MessageOutput", text = text })
	print(...)
end
local function liveWarn(...)
	local text = join(...)
	recent[text] = os.clock()
	push({ t = "log", kind = "MessageWarning", text = text })
	warn(...)
end
local PRELUDE = "local __fcl = ((getgenv and getgenv()) or _G).ForgeCodeLive; local print, warn = __fcl and __fcl.print or print, __fcl and __fcl.warn or warn; "

local function runCode(m)
	if m.age and m.age > 300000 then
		push({ t = "result", id = m.id, ok = false, skipped = true, error = "5 分以上前の実行の依頼だったので、実行しませんでした" })
		return
	end
	local chunk = tostring(m.chunk or "ForgeCode")
	chunks[chunk] = true
	local fn, err = loadstring(PRELUDE .. m.code, "=" .. chunk)
	if not fn then
		-- 先頭に足した行のせいで読めない場合 (1 行目が特殊なとき) は、そのまま
		fn, err = loadstring(m.code, "=" .. chunk)
	end
	if not fn then
		push({ t = "result", id = m.id, ok = false, syntax = true, error = tostring(err) })
		return
	end
	push({ t = "started", id = m.id })
	runs[m.id] = task.spawn(function()
		local ok, res = xpcall(fn, function(e)
			return tostring(e) .. "\n" .. debug.traceback()
		end)
		runs[m.id] = nil
		push({ t = "result", id = m.id, ok = ok, error = (not ok) and tostring(res) or nil })
	end)
end

local function evalCode(m)
	task.spawn(function()
		local fn = loadstring(PRELUDE .. "return " .. m.code, "=console")
		if not fn then
			local err
			fn, err = loadstring(PRELUDE .. m.code, "=console")
			if not fn then
				push({ t = "evalResult", id = m.id, ok = false, error = tostring(err) })
				return
			end
		end
		local res = table.pack(pcall(fn))
		if res[1] then
			local values = {}
			for i = 2, res.n do
				values[#values + 1] = show(res[i])
			end
			push({ t = "evalResult", id = m.id, ok = true, values = values })
		else
			push({ t = "evalResult", id = m.id, ok = false, error = tostring(res[2]) })
		end
	end)
end

local function children(m)
	local obj = game
	for _, name in ipairs(m.path or {}) do
		obj = obj and obj:FindFirstChild(name)
	end
	if not obj then
		push({ t = "tree", id = m.id, ok = false, error = "見つかりません" })
		return
	end
	local list = {}
	local ok = pcall(function()
		for i, c in ipairs(obj:GetChildren()) do
			if i > 400 then
				break
			end
			local n = 0
			pcall(function()
				n = #c:GetChildren()
			end)
			list[#list + 1] = { name = c.Name, class = c.ClassName, n = n }
		end
	end)
	table.sort(list, function(a, b)
		return a.name:lower() < b.name:lower()
	end)
	push({ t = "tree", id = m.id, ok = ok, items = list })
end

local function handle(item)
	local m = item.m
	if type(m) ~= "table" then
		return
	end
	m.age = item.age
	if m.t == "run" then
		runCode(m)
	elseif m.t == "eval" then
		evalCode(m)
	elseif m.t == "tree" then
		children(m)
	elseif m.t == "stop" then
		for id, th in pairs(runs) do
			pcall(task.cancel, th)
			runs[id] = nil
		end
		push({ t = "stopped" })
	elseif m.t == "config" then
		allLogs = m.allLogs == true
	elseif m.t == "ping" then
		push({ t = "pong" })
	end
end

local function hello()
	local gameName = ""
	pcall(function()
		gameName = game:GetService("MarketplaceService"):GetProductInfo(game.PlaceId).Name
	end)
	local executor = "?"
	pcall(function()
		executor = (identifyexecutor and identifyexecutor()) or (getexecutorname and getexecutorname()) or "?"
	end)
	push({
		t = "hello",
		v = VERSION,
		executor = tostring(executor),
		placeId = game.PlaceId,
		game = gameName,
		player = Players.LocalPlayer and Players.LocalPlayer.Name or "",
		logs = hasLog,
	})
end

-- 送信 (まとめて送る)
task.spawn(function()
	local lastClean = os.clock()
	while alive do
		if os.clock() - lastClean > 10 then
			lastClean = os.clock()
			for text, t in pairs(recent) do
				if lastClean - t > 5 then
					recent[text] = nil
				end
			end
		end
		if #outbox > 0 then
			local batch = outbox
			outbox = {}
			local ok = pcall(httpRequest, {
				Url = base .. "/send?as=exec",
				Method = "POST",
				Headers = { ["Content-Type"] = "application/json" },
				Body = encode({ msgs = batch }),
			})
			if not ok then
				task.wait(1)
			end
		end
		task.wait(0.25)
	end
end)

-- 受信 (ForgeCode からの依頼を待つ)
task.spawn(function()
	local after = -1
	local fails = 0
	while alive do
		local ok, res = pcall(httpRequest, {
			Url = base .. "/recv?as=exec&wait=20&after=" .. after,
			Method = "GET",
		})
		if not alive then
			break
		end
		if ok and res and res.StatusCode == 200 then
			fails = 0
			local okj, data = pcall(function()
				return HttpService:JSONDecode(res.Body)
			end)
			if okj and type(data) == "table" then
				after = data.seq or after
				for _, item in ipairs(data.msgs or {}) do
					local okh, err = pcall(handle, item)
					if not okh then
						push({ t = "log", kind = "MessageError", text = "ForgeCode Live: " .. tostring(err) })
					end
				end
			end
		elseif ok and res and (res.StatusCode == 404 or res.StatusCode == 403) then
			warn("ForgeCode Live: 接続コードが無効になりました。ForgeCode で新しい 1 行をコピーしてください")
			alive = false
			break
		else
			fails += 1
			task.wait(math.min(10, fails * 1.5))
		end
	end
end)

env.ForgeCodeLive = {
	version = VERSION,
	print = livePrint,
	warn = liveWarn,
	stop = function()
		alive = false
		if logConn then
			pcall(function()
				logConn:Disconnect()
			end)
		end
		for _, th in pairs(runs) do
			pcall(task.cancel, th)
		end
	end,
}

hello()
pcall(function()
	game:GetService("StarterGui"):SetCore("SendNotification", { Title = "ForgeCode", Text = "ForgeCode とつながりました", Duration = 4 })
end)
print("ForgeCode Live: 接続しました")
