-- ForgeCode Live コネクター
-- Delta などのエグゼキューターで実行すると、ForgeCode とつながります。
--   ・ForgeCode の ▶ で、このゲームの中でスクリプトを実行 (require でプロジェクトの他のファイルも使えます)
--   ・ゲームの出力・エラーを ForgeCode に表示 (ファイルの行へ移動・AI で直す)
--   ・ブレークポイントで止めて、変数を見ながら 1 行ずつ進める (デバッグ)
--   ・もう一度実行する前に、前回の実行で作ったもの (イベントの接続・オブジェクト・スレッド) を片付ける
--   ・ForgeCode のコンソールから、ゲームの中で式を評価
--   ・ゲームのオブジェクトとプロパティを ForgeCode で一覧・変更
-- ・ForgeCode が閉じていても待ち続け、開いたら自動でつながります。テレポートしてもつながったまま
-- 止めるとき: getgenv().ForgeCodeLive.stop()
-- 安全のため、コードを送れるのは鍵を持つ ForgeCode だけです (このスクリプトに鍵は入っていません)
local RELAY = "{{RELAY}}"
local ROOM = "{{ROOM}}"
local VERSION = 3

local env = (getgenv and getgenv()) or _G
if env.ForgeCodeLive and env.ForgeCodeLive.stop then
	pcall(env.ForgeCodeLive.stop)
end

-- 自動実行 (autoexec) はゲームの読み込みより先に動くので、読み込みを待つ
pcall(function()
	if not game:IsLoaded() then
		game.Loaded:Wait()
	end
end)

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")

local httpRequest = (syn and syn.request) or (http and http.request) or http_request or request or (fluxus and fluxus.request)
if not httpRequest then
	warn("ForgeCode Live: この実行環境は HTTP (request) に対応していないため、つなげません")
	return
end

local alive = true
local outbox = {}
local wake = false              -- 送るものができた (送信を急ぐ)
local runs = {}                 -- 実行 ID → 実行の状態
local chunks = { console = true } -- このコネクターで実行したスクリプトの名前 (エラーの出どころの判定用)
local allLogs = false           -- ゲーム全体の出力も送るか (ForgeCode の設定)
local recent = {}               -- print / warn で送ったばかりの文字列 (LogService と二重に送らない)
local base = RELAY .. "/r/" .. ROOM
local oneLiner = 'task.spawn(function() for _ = 1, 60 do local ok, s = pcall(function() return game:HttpGet("' .. RELAY .. '/c/' .. ROOM .. '") end) if ok and s and #s > 0 then return loadstring(s)() end task.wait(5) end end)'

local function push(m)
	if #outbox < 1500 then
		outbox[#outbox + 1] = m
	end
	wake = true
end

-- 出力が多すぎるとき (ループでの print など): 1 秒に 200 行まで送り、残りは数だけ知らせる
local logCount, logWindow, dropped = 0, os.clock(), 0
local function pushLog(kind, text, run)
	local now = os.clock()
	if now - logWindow >= 1 then
		if dropped > 0 then
			push({ t = "log", kind = "MessageInfo", text = "(出力が多すぎるため " .. dropped .. " 行を省略しました)" })
			dropped = 0
		end
		logWindow = now
		logCount = 0
	end
	logCount += 1
	if logCount > 200 then
		dropped += 1
		return
	end
	push({ t = "log", kind = kind, text = text, run = run })
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
		if #v > 300 then
			v = v:sub(1, 300) .. "…"
		end
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
	elseif ty == "Vector3" or ty == "CFrame" or ty == "Color3" or ty == "UDim2" or ty == "Vector2" or ty == "UDim" then
		return ty .. "(" .. tostring(v) .. ")"
	end
	return tostring(v)
end

-- 値をそのまま書ける Luau の式に (プロパティの変更用)
local function literal(v)
	local ty = typeof(v)
	local r = function(x)
		return math.floor(x * 1000 + 0.5) / 1000
	end
	if ty == "string" then
		return string.format("%q", v)
	elseif ty == "number" or ty == "boolean" or ty == "nil" then
		return tostring(v)
	elseif ty == "Vector3" then
		return string.format("Vector3.new(%s, %s, %s)", r(v.X), r(v.Y), r(v.Z))
	elseif ty == "Vector2" then
		return string.format("Vector2.new(%s, %s)", r(v.X), r(v.Y))
	elseif ty == "Color3" then
		return string.format("Color3.fromRGB(%d, %d, %d)", math.floor(v.R * 255 + 0.5), math.floor(v.G * 255 + 0.5), math.floor(v.B * 255 + 0.5))
	elseif ty == "UDim2" then
		return string.format("UDim2.new(%s, %s, %s, %s)", r(v.X.Scale), v.X.Offset, r(v.Y.Scale), v.Y.Offset)
	elseif ty == "UDim" then
		return string.format("UDim.new(%s, %s)", r(v.Scale), v.Offset)
	elseif ty == "CFrame" then
		return "CFrame.new(" .. table.concat({ v:GetComponents() }, ", ") .. ")"
	elseif ty == "EnumItem" then
		return tostring(v)
	elseif ty == "BrickColor" then
		return string.format("BrickColor.new(%q)", v.Name)
	end
	return nil
end

-- デバッガーで調べられる値 (テーブルとオブジェクトは中を開ける)
local refs, refSeq = {}, 0
local function val(v)
	local ty = typeof(v)
	local out = { t = ty == "nil" and "nil" or ty, v = show(v) }
	if (ty == "table" and next(v) ~= nil) or ty == "Instance" then
		refSeq += 1
		refs[refSeq] = v
		out.ref = refSeq
	end
	return out
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
			pushLog(k, text)
		end
	end)
end)

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
	pushLog("MessageOutput", text)
	print(...)
end
local function liveWarn(...)
	local text = join(...)
	recent[text] = os.clock()
	pushLog("MessageWarning", text)
	warn(...)
end

-- ============================================================
-- 実行の状態 (片付け・モジュール・デバッグ)
-- ============================================================
local function cleanup(run)
	for _, c in ipairs(run.conns) do
		pcall(function()
			c:Disconnect()
		end)
	end
	for _, th in ipairs(run.threads) do
		if th ~= coroutine.running() then
			pcall(task.cancel, th)
		end
	end
	for i = #run.insts, 1, -1 do
		pcall(function()
			run.insts[i]:Destroy()
		end)
	end
	run.conns, run.threads, run.insts = {}, {}, {}
end

-- プロジェクトのファイルを、Roblox と同じようなフォルダの木にする (script.Parent.Util のような require のため)
local proxies = setmetatable({}, { __mode = "k" })
local function proxyOf(node, real)
	if node.proxy then
		return node.proxy
	end
	local p = {}
	node.proxy = p
	proxies[p] = node
	setmetatable(p, {
		__index = function(_, k)
			if k == "Name" then
				return node.name
			elseif k == "ClassName" then
				return node.class
			elseif k == "Parent" then
				return node.parent and proxyOf(node.parent) or nil
			elseif k == "FindFirstChild" or k == "WaitForChild" or k == "FindFirstChildOfClass" then
				return function(_, name)
					local c = node.children[name]
					if c then
						return proxyOf(c)
					end
					if real then
						return real[k](real, name)
					end
					return nil
				end
			elseif k == "GetChildren" then
				return function()
					local out = {}
					for _, c in pairs(node.children) do
						out[#out + 1] = proxyOf(c)
					end
					return out
				end
			elseif k == "IsA" then
				return function(_, c)
					return c == node.class or c == "Instance" or (c == "LuaSourceContainer" and node.class ~= "Folder")
				end
			elseif k == "GetFullName" then
				return function()
					return node.path or node.name
				end
			end
			local c = node.children[k]
			if c then
				return proxyOf(c)
			end
			if real then
				local v = real[k]
				if type(v) == "function" then
					return function(self, ...)
						if self == p then
							self = real
						end
						return v(self, ...)
					end
				end
				return v
			end
			return nil
		end,
		__tostring = function()
			return node.name
		end,
	})
	return p
end
local function buildTree(modules)
	local root = { name = "Project", class = "Folder", children = {} }
	local byPath = {}
	for path in pairs(modules) do
		local cur = root
		local parts = string.split(path, "/")
		for i = 1, #parts - 1 do
			local name = parts[i]
			local nx = cur.children[name]
			if not nx then
				nx = { name = name, class = "Folder", children = {}, parent = cur }
				cur.children[name] = nx
			end
			cur = nx
		end
		local file = parts[#parts]
		local name = file:gsub("%.luau?$", "")
		local class = "ModuleScript"
		if name:match("%.server$") then
			class, name = "Script", name:gsub("%.server$", "")
		elseif name:match("%.client$") then
			class, name = "LocalScript", name:gsub("%.client$", "")
		end
		local node = { name = name, class = class, children = {}, parent = cur, path = path }
		if name == "init" and cur ~= root then
			cur.path, cur.class = path, class
			byPath[path] = cur
		else
			cur.children[name] = node
			byPath[path] = node
		end
	end
	return byPath
end
local function resolvePath(from, spec)
	local baseDir = from and from:match("^(.*)/[^/]*$") or ""
	local parts = {}
	if spec:sub(1, 2) == "./" or spec:sub(1, 3) == "../" then
		for p in baseDir:gmatch("[^/]+") do
			parts[#parts + 1] = p
		end
	end
	for p in spec:gmatch("[^/]+") do
		if p == ".." then
			table.remove(parts)
		elseif p ~= "." then
			parts[#parts + 1] = p
		end
	end
	return table.concat(parts, "/")
end

local MISSING = {}
local compile -- 下で定義
local function loadModule(run, path)
	local cached = run.cache[path]
	if cached ~= nil then
		return cached == MISSING and nil or cached
	end
	if run.loading[path] then
		error("Requested module was required recursively: " .. path, 2)
	end
	run.loading[path] = true
	local fn, err = compile(run, path, run.modules[path])
	if not fn then
		run.loading[path] = nil
		error(err, 0)
	end
	local res = table.pack(fn())
	run.loading[path] = nil
	if res.n ~= 1 then
		error("Module code did not return exactly one value: " .. path, 2)
	end
	run.cache[path] = res[1] == nil and MISSING or res[1]
	return res[1]
end
local function makeRequire(run, from)
	return function(target)
		if type(target) == "string" then
			local p = resolvePath(from, target)
			for _, cand in ipairs({ p, p .. ".luau", p .. ".lua", p .. "/init.luau", p .. "/init.lua" }) do
				if run.modules[cand] then
					return loadModule(run, cand)
				end
			end
			error('モジュール "' .. target .. '" が見つかりません', 2)
		end
		local node = type(target) == "table" and proxies[target]
		if node then
			if node.class ~= "ModuleScript" or not node.path then
				error("Attempted to call require with a non-ModuleScript", 2)
			end
			return loadModule(run, node.path)
		end
		return require(target)
	end
end

-- デバッグ: ブレークポイントの行・1 行ずつ進める
local function dbgTable(run, path)
	return setmetatable({}, {
		__index = function(_, line)
			if run.stopped then
				return false
			end
			if run.stepping then
				return true
			end
			local b = run.bps[path]
			return b ~= nil and b[line] == true
		end,
	})
end
local function bpFn(run, path)
	return function(line, ...)
		if run.stopped then
			return
		end
		local n = select("#", ...)
		local vars, locals = {}, {}
		refs, refSeq = {}, 0
		for i = 1, n, 2 do
			local name, v = select(i, ...), select(i + 1, ...)
			locals[name] = v
			vars[#vars + 1] = { name = name, value = val(v) }
		end
		local reason = run.stepping and "step" or "breakpoint"
		run.stepping = false
		run.paused = { path = path, line = line, locals = locals }
		push({ t = "paused", run = run.id, file = path, line = line, locals = vars, reason = reason })
		while run.paused and alive and not run.stopped do
			task.wait(0.05)
		end
		push({ t = "resumed", run = run.id })
	end
end

-- スクリプトに渡す道具 (1 行目の先頭で受け取る)
local function ctxFor(run, path)
	local c = {
		print = livePrint,
		warn = liveWarn,
		T = function(x)
			if run.conns then
				run.conns[#run.conns + 1] = x
			end
			return x
		end,
		TI = function(x)
			if run.insts then
				run.insts[#run.insts + 1] = x
			end
			return x
		end,
		TT = function(x)
			if run.threads then
				run.threads[#run.threads + 1] = x
			end
			return x
		end,
	}
	c.DB = dbgTable(run, path)
	c.BP = bpFn(run, path)
	if run.tree then
		c.require = makeRequire(run, path)
		local node = run.tree[path]
		if node then
			c.script = proxyOf(node, run.realScript)
		end
	end
	return c
end
local function prelude(run, path)
	return "local __C = ((getgenv and getgenv()) or _G).ForgeCodeLive.ctx("
		.. run.id
		.. ", "
		.. string.format("%q", path)
		.. "); local print, warn, require, script, __T, __TI, __TT, __DB, __BP = __C.print, __C.warn, __C.require or require, __C.script or script, __C.T, __C.TI, __C.TT, __C.DB, __C.BP; "
end
compile = function(run, path, code)
	chunks[path] = true
	local fn, err = loadstring(prelude(run, path) .. code, "=" .. path)
	if not fn then
		-- 先頭に足した行のせいで読めない (1 行目が特殊な) とき: 道具は環境に置く
		local fn2, err2 = loadstring(code, "=" .. path)
		if not fn2 then
			return nil, err2 or err
		end
		local c = ctxFor(run, path)
		pcall(setfenv, fn2, setmetatable({ print = c.print, warn = c.warn, require = c.require, script = c.script, __T = c.T, __TI = c.TI, __TT = c.TT, __DB = c.DB, __BP = c.BP }, { __index = getfenv(0) }))
		return fn2
	end
	return fn
end

local function stopRun(run, clean)
	run.stopped = true
	run.paused = nil
	if run.thread then
		pcall(task.cancel, run.thread)
	end
	if clean then
		cleanup(run)
	end
	runs[run.id] = nil
end

local function runCode(m)
	if m.age and m.age > 300000 then
		push({ t = "result", id = m.id, ok = false, skipped = true, error = "5 分以上前の実行の依頼だったので、実行しませんでした" })
		return
	end
	local chunk = tostring(m.chunk or "ForgeCode")
	-- 同じファイルの前回の実行を片付ける (イベントの接続・作ったオブジェクト・スレッド)
	if m.cleanup ~= false then
		for _, r in pairs(runs) do
			if r.chunk == chunk then
				stopRun(r, true)
			end
		end
	end
	local run = { id = m.id, chunk = chunk, conns = {}, insts = {}, threads = {}, cache = {}, loading = {}, modules = m.modules or {}, bps = {} }
	if m.modules and next(m.modules) then
		run.modules[chunk] = run.modules[chunk] or m.code
		run.tree = buildTree(run.modules)
		run.realScript = rawget(getfenv(0), "script")
	end
	for path, lines in pairs(m.bps or {}) do
		local set = {}
		for _, l in ipairs(lines) do
			set[l] = true
		end
		run.bps[path] = set
	end
	runs[m.id] = run
	local fn, err = compile(run, chunk, m.code)
	if not fn then
		runs[m.id] = nil
		push({ t = "result", id = m.id, ok = false, syntax = true, error = tostring(err) })
		return
	end
	push({ t = "started", id = m.id })
	run.thread = task.spawn(function()
		local ok, res = xpcall(fn, function(e)
			return tostring(e) .. "\n" .. debug.traceback()
		end)
		run.thread = nil
		if run.stopped then
			return
		end
		push({ t = "result", id = m.id, ok = ok, error = (not ok) and tostring(res) or nil })
	end)
end

local function evalCode(m)
	task.spawn(function()
		local run = runs[0] or { id = 0, chunk = "console", conns = {}, insts = {}, threads = {}, cache = {}, loading = {}, modules = {}, bps = {} }
		runs[0] = run
		local fn = loadstring(prelude(run, "console") .. "return " .. m.code, "=console")
		if not fn then
			local err
			fn, err = loadstring(prelude(run, "console") .. m.code, "=console")
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

-- オブジェクトの場所: { { n = 名前, i = 何番目の子か }, ... } (同じ名前があっても取り違えない)
local function resolveObj(path)
	local obj = game
	for _, step in ipairs(path or {}) do
		if not obj then
			return nil
		end
		local name = type(step) == "table" and step.n or step
		local idx = type(step) == "table" and step.i or nil
		local found = nil
		if idx then
			local ok, kids = pcall(function()
				return obj:GetChildren()
			end)
			local c = ok and kids[idx]
			if c and c.Name == name then
				found = c
			end
		end
		obj = found or obj:FindFirstChild(name)
	end
	return obj
end

local function children(m)
	local obj = resolveObj(m.path)
	if not obj then
		push({ t = "tree", id = m.id, ok = false, error = "見つかりません (消えたか、名前が変わった可能性があります)" })
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
			list[#list + 1] = { name = c.Name, class = c.ClassName, n = n, i = i }
		end
	end)
	table.sort(list, function(a, b)
		return a.name:lower() < b.name:lower()
	end)
	push({ t = "tree", id = m.id, ok = ok, items = list })
end

local function props(m)
	local obj = resolveObj(m.path)
	if not obj then
		push({ t = "props", id = m.id, ok = false, error = "見つかりません" })
		return
	end
	local out = {}
	for _, name in ipairs(m.names or {}) do
		local ok, v = pcall(function()
			return obj[name]
		end)
		if ok then
			out[#out + 1] = { name = name, t = typeof(v), v = show(v), edit = literal(v) }
		end
	end
	push({ t = "props", id = m.id, ok = true, items = out })
end

local function setProp(m)
	local obj = resolveObj(m.path)
	if not obj then
		push({ t = "setProp", id = m.id, ok = false, error = "見つかりません" })
		return
	end
	local fn, err = loadstring("return " .. tostring(m.expr))
	if not fn then
		push({ t = "setProp", id = m.id, ok = false, error = "式が正しくありません: " .. tostring(err) })
		return
	end
	local ok, res = pcall(function()
		local v = fn()
		obj[m.name] = v
		return obj[m.name]
	end)
	if ok then
		push({ t = "setProp", id = m.id, ok = true, v = show(res), edit = literal(res), ty = typeof(res) })
	else
		push({ t = "setProp", id = m.id, ok = false, error = tostring(res) })
	end
end

local function expand(m)
	local v = refs[m.ref]
	local items = {}
	if typeof(v) == "Instance" then
		pcall(function()
			for i, c in ipairs(v:GetChildren()) do
				if i > 100 then
					break
				end
				items[#items + 1] = { name = c.Name, value = val(c) }
			end
		end)
	elseif type(v) == "table" then
		local n = 0
		for k, x in pairs(v) do
			n += 1
			if n > 100 then
				break
			end
			items[#items + 1] = { name = type(k) == "string" and k or "[" .. tostring(k) .. "]", value = val(x) }
		end
	end
	push({ t = "expanded", id = m.id, items = items })
end

local function watch(m)
	local run = runs[m.run]
	local out = {}
	for _, expr in ipairs(m.exprs or {}) do
		local entry = { code = expr }
		local fn, err = loadstring("return " .. expr)
		if not fn then
			entry.error = tostring(err)
		else
			if run and run.paused then
				pcall(setfenv, fn, setmetatable({}, {
					__index = function(_, k)
						local v = run.paused.locals[k]
						if v ~= nil then
							return v
						end
						return getfenv(0)[k]
					end,
				}))
			end
			local ok, v = pcall(fn)
			if ok then
				entry.value = val(v)
			else
				entry.error = tostring(v)
			end
		end
		out[#out + 1] = entry
	end
	push({ t = "watchValues", id = m.id, watches = out })
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
		features = {
			teleport = (queue_on_teleport or queueonteleport or (syn and syn.queue_on_teleport)) ~= nil,
			setfenv = setfenv ~= nil,
		},
	})
end

local function handle(item)
	local m = item.m
	if type(m) ~= "table" then
		return
	end
	m.age = item.age
	local t = m.t
	if t == "run" then
		runCode(m)
	elseif t == "eval" then
		evalCode(m)
	elseif t == "tree" then
		children(m)
	elseif t == "props" then
		props(m)
	elseif t == "setProp" then
		setProp(m)
	elseif t == "expand" then
		expand(m)
	elseif t == "watch" then
		watch(m)
	elseif t == "dbg" then
		local run = runs[m.run]
		if run then
			if m.cmd == "continue" then
				run.stepping = false
				run.paused = nil
			elseif m.cmd == "step" then
				run.stepping = true
				run.paused = nil
			elseif m.cmd == "pause" then
				run.stepping = true
			end
		end
	elseif t == "dbgBps" then
		for _, run in pairs(runs) do
			if run.id ~= 0 then
				run.bps = {}
				for path, lines in pairs(m.bps or {}) do
					local set = {}
					for _, l in ipairs(lines) do
						set[l] = true
					end
					run.bps[path] = set
				end
			end
		end
	elseif t == "stop" then
		for _, run in pairs(runs) do
			if run.id ~= 0 then
				stopRun(run, m.cleanup ~= false)
			end
		end
		push({ t = "stopped" })
	elseif t == "config" then
		allLogs = m.allLogs == true
	elseif t == "ping" then
		push({ t = "pong", id = m.id })
	elseif t == "who" then
		hello()
	end
end

-- 送信 (まとめて送る。送るものができたらすぐに)
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
			wake = false
			local batch = outbox
			outbox = {}
			local ok, res = pcall(httpRequest, {
				Url = base .. "/send?as=exec",
				Method = "POST",
				Headers = { ["Content-Type"] = "application/json" },
				Body = encode({ msgs = batch }),
			})
			if not ok or not res or res.StatusCode ~= 200 then
				-- 送れなかった: 順番どおりに戻して、少し待ってから送り直す (多すぎるときは古いものを捨てる)
				for i = 1, #outbox do
					batch[#batch + 1] = outbox[i]
				end
				outbox = batch
				while #outbox > 1500 do
					table.remove(outbox, 1)
				end
				task.wait(2)
			end
		end
		-- 送るものがあればすぐ、なければ少し待つ
		local t0 = os.clock()
		repeat
			task.wait(0.03)
		until wake or not alive or os.clock() - t0 > 0.25
	end
end)

-- ForgeCode がつながったことを知らせる (アプリの切り替えのたびに出ないよう、10 分に 1 回まで)
local lastNotice = -1e9
local editorOnline = false
local function onPeer(peer)
	local online = type(peer) == "table" and peer.online == true
	if online and not editorOnline and os.clock() - lastNotice > 600 then
		lastNotice = os.clock()
		pcall(function()
			game:GetService("StarterGui"):SetCore("SendNotification", { Title = "ForgeCode", Text = "ForgeCode とつながりました", Duration = 4 })
		end)
	end
	editorOnline = online
end

-- 受信 (ForgeCode からの依頼を待つ)。ForgeCode が閉じていても待ち続け、切れても自動でつなぎ直す
task.spawn(function()
	local after = -1
	local gen = ""
	local fails = 0
	while alive do
		local ok, res = pcall(httpRequest, {
			Url = base .. "/recv?as=exec&wait=20&after=" .. after .. "&gen=" .. gen,
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
				if type(data.gen) == "string" and data.gen ~= gen then
					-- 中継サーバーが再起動した: もう一度名乗る
					if gen ~= "" then
						hello()
					end
					gen = data.gen
				end
				after = data.seq or after
				onPeer(data.peer)
				for _, item in ipairs(data.msgs or {}) do
					local okh, err = pcall(handle, item)
					if not okh then
						push({ t = "log", kind = "MessageError", text = "ForgeCode Live: " .. tostring(err) })
					end
				end
			end
		else
			-- 中継サーバーが止まっている・起動中 (無料のサーバーは 1 分ほどかかる) など: 少し待ってやり直す
			fails += 1
			task.wait(math.min(30, 2 + fails * 2))
		end
	end
end)

-- テレポートしても、移動先でまたつながるように
pcall(function()
	local queue = queue_on_teleport or queueonteleport or (syn and syn.queue_on_teleport) or (fluxus and fluxus.queue_on_teleport)
	if queue then
		queue(oneLiner)
	end
end)

env.ForgeCodeLive = {
	version = VERSION,
	print = livePrint,
	warn = liveWarn,
	ctx = function(id, path)
		local run = runs[id]
		if not run then
			run = { id = id, chunk = path, conns = {}, insts = {}, threads = {}, cache = {}, loading = {}, modules = {}, bps = {} }
		end
		return ctxFor(run, path)
	end,
	stop = function()
		alive = false
		if logConn then
			pcall(function()
				logConn:Disconnect()
			end)
		end
		for _, run in pairs(runs) do
			stopRun(run, false)
		end
	end,
}

hello()
print("ForgeCode Live: 開始しました (ForgeCode を開くと自動でつながります)")
