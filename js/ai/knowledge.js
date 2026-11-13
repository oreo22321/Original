// Forge AI: 知識ベース (Luau / Roblox / エグゼキューター / ForgeCode の使い方)
// 1 項目 = { id, t: 見出し, k: 検索用の言い方, b: 本文 (Markdown), c: コード例, mode: 'executor' | 'app' | undefined }
// 本文は初心者向けに短く。詳しい API は補完データ (apidb / luau-api) から別に引きます。

export const KNOWLEDGE = [
  // ============================================================
  // Luau の基本
  // ============================================================
  { id: 'variables', t: '変数 (local とグローバル)', k: '変数 local ローカル グローバル global スコープ 宣言 代入 variable',
    b: `値に名前を付けて覚えておくのが変数です。**必ず \`local\` を付けて宣言**しましょう。\`local\` を付けないとグローバル変数になり、別の場所で同じ名前を使ったときに思わぬバグになります (速度も少し遅くなります)。
- \`local\` 変数は、宣言したブロック (\`do\`〜\`end\`、関数、if、for の中) の中だけで使えます
- 値を入れていない変数は \`nil\` です
- 名前は英字・数字・\`_\` (数字から始めない)。大文字と小文字は区別されます`,
    c: `local coins = 0          -- 数値
local playerName = "Taro" -- 文字列
local isAlive = true      -- 真偽値

coins = coins + 10  -- 代入 (coins += 10 とも書けます)
print(playerName, coins)` },
  { id: 'types-basic', t: '値の種類 (nil・数値・文字列・真偽値・テーブル・関数)', k: '型 種類 nil boolean number string table function type typeof データ型 真偽',
    b: `Luau の値の種類は \`nil\`・\`boolean\` (true/false)・\`number\`・\`string\`・\`table\`・\`function\` などです。Roblox ではさらに \`Instance\`・\`Vector3\`・\`CFrame\`・\`Color3\` などがあります。
- 種類を調べるには \`type(x)\`、Roblox の種類まで知りたいときは \`typeof(x)\` を使います
- 条件式で「偽」になるのは **\`nil\` と \`false\` だけ** です (0 や "" は真)`,
    c: `print(type(10))              --> number
print(typeof(Vector3.new()))  --> Vector3
if 0 then print("0 は真です") end` },
  { id: 'if', t: 'if 文 (条件分岐)', k: 'if 文 条件 分岐 elseif else もし 比較 == ~= and or not 演算子 等しい 等しくない',
    b: `\`if 条件 then ... end\` で、条件が真のときだけ実行します。
- 比較: \`==\` (等しい)・\`~=\` (等しくない。**\`!=\` ではありません**)・\`<\` \`>\` \`<=\` \`>=\`
- 組み合わせ: \`and\`・\`or\`・\`not\` (\`&&\` \`||\` \`!\` は使えません)
- \`else if\` と分けて書くと入れ子になり \`end\` が 2 つ必要です。**\`elseif\`** と続けて書きましょう
- 1 行で値を選ぶなら if 式: \`local label = if hp > 0 then "生存" else "ダウン"\``,
    c: `local hp = 30
if hp <= 0 then
	print("やられた")
elseif hp < 50 then
	print("ピンチ!")
else
	print("元気")
end` },
  { id: 'for-num', t: 'for 文 (回数を決めた繰り返し)', k: 'for 文 繰り返し ループ 回数 カウント 数値 for i = 1 増やす 逆順 step',
    b: `\`for i = 開始, 終わり, 増分 do ... end\` で決まった回数だけ繰り返します (増分は省略すると 1)。
- \`for i = 10, 1, -1 do\` で逆順
- ループの変数 \`i\` は \`for\` の中だけで使えます
- 途中で抜けるには \`break\`、その回だけ飛ばすには \`continue\``,
    c: `for i = 1, 5 do
	print(i .. " 回目")
end

for i = 10, 0, -2 do
	print(i) -- 10, 8, 6, 4, 2, 0
end` },
  { id: 'for-in', t: 'for in (テーブルを順番に見る) / pairs と ipairs', k: 'for in pairs ipairs 巡回 テーブル 配列 全部 一つずつ 要素 キー 値 GetChildren 順番 違い',
    b: `テーブルの中身を 1 つずつ取り出すときは \`for キー, 値 in テーブル do\` を使います。
- **\`ipairs(t)\`**: 配列 (1, 2, 3 … と番号が続く部分) を **順番に** 見ます。途中に \`nil\` があるとそこで止まります
- **\`pairs(t)\`**: 辞書を含む **すべての** キーを見ます (順番は決まっていません)
- Luau では \`for k, v in t do\` とだけ書いても使えます
- \`for _, child in workspace:GetChildren() do\` のように Instance の子を順に見るのもよく使います`,
    c: `local fruits = { "りんご", "みかん", "ぶどう" }
for i, name in ipairs(fruits) do
	print(i, name)
end

local prices = { apple = 100, orange = 80 }
for name, price in pairs(prices) do
	print(name, price)
end` },
  { id: 'while', t: 'while / repeat (条件で繰り返す)・break・continue', k: 'while repeat until 繰り返し ループ 無限ループ break continue 止める 抜ける while true フリーズ',
    b: `\`while 条件 do ... end\` は条件が真の間、\`repeat ... until 条件\` は条件が真になるまで繰り返します。
- **\`while true do\` の中には必ず \`task.wait()\` を入れてください**。待機がないとゲームが固まります (Script timeout)
- 一定時間ごとの処理なら \`task.wait(秒)\`、毎フレームの処理なら \`RunService.Heartbeat:Connect\` のほうが向いています
- \`break\` でループを抜け、\`continue\` でその回だけ飛ばします`,
    c: `local count = 0
while count < 3 do
	count += 1
	print("count:", count)
	task.wait(1)
end

while true do
	print("1 秒ごと")
	task.wait(1) -- これがないと固まります
end` },
  { id: 'functions', t: '関数 (function)・引数・戻り値', k: '関数 function 引数 戻り値 return 呼び出す 定義 無名関数 可変長 ... 複数の値',
    b: `処理に名前を付けてまとめたものが関数です。\`local function 名前(引数) ... end\` で作り、\`名前(値)\` で呼び出します。
- \`return\` で値を返します。\`return a, b\` のように **複数の値** も返せます
- 名前のない関数 (\`function(...) end\`) は、イベントの \`:Connect\` などにそのまま渡せます
- 引数の数は自由: \`...\` で可変長、足りない引数は \`nil\` になります`,
    c: `local function add(a, b)
	return a + b
end
print(add(2, 3)) --> 5

local function minMax(list)
	return math.min(table.unpack(list)), math.max(table.unpack(list))
end
local lo, hi = minMax({ 4, 9, 1 })` },
  { id: 'tables', t: 'テーブル (配列)', k: 'テーブル table 配列 リスト array 追加 削除 table.insert table.remove table.sort table.find table.concat 長さ # 要素数 並べ替え 検索',
    b: `テーブルは値をまとめて入れる入れ物です。番号 (1 から始まります) で並べたものを配列と呼びます。
- 長さ: \`#t\`
- 末尾に追加: \`table.insert(t, v)\`、位置を指定: \`table.insert(t, 1, v)\`
- 削除: \`table.remove(t, i)\` (後ろが詰まります)
- 検索: \`table.find(t, v)\` (見つかった番号か nil)
- 並べ替え: \`table.sort(t)\` / \`table.sort(t, function(a, b) return a > b end)\`
- 文字列にまとめる: \`table.concat(t, ", ")\`
- ループ中に \`table.remove\` するときは **後ろから** 回します`,
    c: `local items = { "剣", "盾" }
table.insert(items, "ポーション")
print(#items)                       --> 3
print(table.find(items, "盾"))       --> 2
table.remove(items, 1)
print(table.concat(items, ", "))    --> 盾, ポーション` },
  { id: 'dictionaries', t: 'テーブル (辞書・連想配列)', k: '辞書 dictionary 連想配列 キー 値 key value 名前で 取り出す 削除 数える 存在 チェック',
    b: `キー (名前) と値の組で覚えるテーブルを辞書と呼びます。
- 読み書き: \`t.name\` または \`t["name"]\` (キーに空白や記号があるときは後者)
- 削除: \`t.key = nil\`
- 存在チェック: \`if t.key ~= nil then\`
- 辞書の \`#t\` は 0 になります。数えるときは \`pairs\` で回して数えます`,
    c: `local player = { name = "Taro", level = 5 }
player.level += 1
player["best score"] = 1200
player.name = nil -- 削除

local count = 0
for _ in pairs(player) do count += 1 end
print(count)` },
  { id: 'strings', t: '文字列の操作 (連結・format・補間・検索・置換・分割)', k: '文字列 string 連結 .. 結合 format 補間 tostring tonumber sub find match gsub split upper lower len 置換 分割 部分 大文字 小文字 数字に変換',
    b: `よく使う文字列の操作です。
- 連結: \`"Lv." .. level\` (数値も自動で文字になります)
- 補間: 文字列をバッククォート記号で囲むと、\`{}\` の中に式を書けます (下の例)
- 書式: \`string.format("%d 点 (%.1f%%)", score, rate)\`
- 部分: \`s:sub(1, 3)\`、長さ: \`#s\`、大文字: \`s:upper()\`
- 検索: \`s:find("abc", 1, true)\` (true で記号もそのまま探す)、パターン: \`s:match("%d+")\`
- 置換: \`s:gsub("古い", "新しい")\`、分割: \`s:split(",")\`
- 変換: \`tostring(10)\`、\`tonumber("42")\` (数字でなければ nil)`,
    c: `local name, score = "Taro", 95
print(name .. " さんは " .. score .. " 点")
print(\`{name} さんは {score} 点\`)
print(string.format("%s: %03d", name, 7))   --> Taro: 007
for _, word in ("a,b,c"):split(",") do print(word) end` },
  { id: 'math', t: '数値と計算 (math・乱数)', k: '数値 計算 math 乱数 ランダム random 四捨五入 切り捨て 切り上げ floor ceil round clamp abs min max 割り算 余り % 累乗 pi huge',
    b: `四則演算は \`+ - * /\`、切り捨て除算は \`//\`、余りは \`%\`、累乗は \`^\` です。
- 切り捨て \`math.floor(x)\`・切り上げ \`math.ceil(x)\`・四捨五入 \`math.round(x)\`
- 範囲に収める \`math.clamp(x, 最小, 最大)\`
- 乱数: \`math.random(1, 6)\` (整数)、\`math.random()\` (0〜1)。毎回違う系列が欲しいなら \`Random.new()\`
- 無限大 \`math.huge\`、円周率 \`math.pi\``,
    c: `local dice = math.random(1, 6)
local rng = Random.new()
local x = rng:NextNumber(-10, 10)
print(math.clamp(150, 0, 100)) --> 100
print(7 // 2, 7 % 2)            --> 3  1` },
  { id: 'task', t: 'task ライブラリ (wait・spawn・delay・defer)', k: 'task.wait wait 待つ 待機 秒 遅延 task.spawn spawn task.delay delay task.defer task.cancel 非推奨 何秒後 同時に',
    b: `待機や並行処理には **\`task\` ライブラリ** を使います。古い \`wait()\`・\`spawn()\`・\`delay()\` は非推奨です (遅く、時間も不正確)。
- \`task.wait(秒)\`: 待つ (省略すると 1 フレーム)。実際に待った秒数を返します
- \`task.spawn(関数, ...)\`: 別の流れとしてすぐ実行 (待機があっても呼び出し元は止まらない)
- \`task.delay(秒, 関数, ...)\`: 何秒か後に実行
- \`task.defer(関数)\`: 今の処理が終わった直後に実行
- \`task.cancel(スレッド)\`: spawn / delay したものを止める`,
    c: `task.delay(3, function()
	print("3 秒後")
end)

task.spawn(function()
	while true do
		print("並行して動きます")
		task.wait(1)
	end
end)
print("すぐに次へ進みます")` },
  { id: 'coroutine', t: 'コルーチン (coroutine)', k: 'coroutine コルーチン yield resume wrap create 中断 再開 スレッド',
    b: `コルーチンは途中で止めて (\`coroutine.yield\`)、あとで続きから再開 (\`coroutine.resume\`) できる関数です。Roblox で「並行して動かしたい」だけなら \`task.spawn\` のほうが簡単です。
- \`coroutine.wrap(f)\` は、呼ぶたびに続きを実行する関数を返します
- \`coroutine.status(co)\` で状態 ("suspended" / "running" / "dead") を調べます`,
    c: `local counter = coroutine.wrap(function()
	for i = 1, 3 do
		coroutine.yield(i)
	end
end)
print(counter(), counter(), counter()) --> 1 2 3` },
  { id: 'pcall', t: 'エラー処理 (pcall・error・assert)', k: 'pcall xpcall error assert エラー処理 例外 try catch 失敗 安全に 保護',
    b: `失敗するかもしれない処理 (データストア・HTTP・他人の作ったコード) は \`pcall\` で包みます。エラーが起きてもスクリプトは止まらず、成功したかどうかが返ります。
- **\`pcall(関数)\` には関数を渡します**。\`pcall(store:GetAsync(key))\` と書くとその場で実行されてしまい、守られません
- 自分でエラーを出す: \`error("メッセージ")\`、条件チェック: \`assert(x, "x がありません")\`
- \`xpcall(f, debug.traceback)\` でエラーの場所 (トレースバック) も取れます`,
    c: `local ok, result = pcall(function()
	return store:GetAsync("key")
end)
if ok then
	print("成功:", result)
else
	warn("失敗:", result)
end` },
  { id: 'metatables', t: 'メタテーブルとクラス (オブジェクト指向)', k: 'メタテーブル metatable setmetatable __index __newindex __call __tostring クラス class oop オブジェクト指向 new self コンストラクタ 継承',
    b: `メタテーブルを使うと、テーブルに「見つからないキーはここを探す (\`__index\`)」などの動きを追加できます。これを使ってクラスを作るのが Luau の定番です。
- \`:\` で定義・呼び出した関数には自動で \`self\` (そのオブジェクト) が渡されます
- 継承は \`setmetatable(Child, { __index = Parent })\``,
    c: `local Dog = {}
Dog.__index = Dog

function Dog.new(name)
	local self = setmetatable({}, Dog)
	self.name = name
	return self
end

function Dog:bark()
	print(self.name .. ": ワン!")
end

local pochi = Dog.new("ポチ")
pochi:bark()` },
  { id: 'modules', t: 'ModuleScript と require', k: 'modulescript モジュール require 共有 return テーブル 分割 使い回し ライブラリ',
    b: `ModuleScript は、関数や値をまとめて **他のスクリプトから使い回す** ためのスクリプトです。最後に \`return\` したもの (普通はテーブル) が、\`require\` した側に渡されます。
- 1 回目の \`require\` だけが実行され、2 回目以降は同じ結果が返ります (共有されます)
- サーバーとクライアントの両方で使うなら ReplicatedStorage に置きます
- ForgeCode では \`require(script.Parent.Utils)\` のように、プロジェクト内のファイルを読み込めます`,
    c: `-- ReplicatedStorage/Utils (ModuleScript)
local Utils = {}

function Utils.formatTime(sec)
	return string.format("%02d:%02d", sec // 60, sec % 60)
end

return Utils

-- 使う側
local Utils = require(game.ReplicatedStorage.Utils)
print(Utils.formatTime(125)) --> 02:05` },
  { id: 'type-annotations', t: '型注釈 (--!strict)', k: '型注釈 型 type annotation strict --!strict nonstrict number string 型チェック export type',
    b: `Luau では変数や引数に型を書けます (\`local x: number = 5\`)。書かなくても動きますが、補完が賢くなり、間違いに早く気づけます。
- 引数と戻り値: \`function add(a: number, b: number): number\`
- 省略できる値: \`string?\` (string か nil)
- 自分の型: \`type Item = { name: string, price: number }\`
- ファイルの先頭に \`--!strict\` と書くと、厳しくチェックします (Roblox Studio)`,
    c: `--!strict
type Item = { name: string, price: number }

local function total(items: { Item }): number
	local sum = 0
	for _, item in items do
		sum += item.price
	end
	return sum
end` },
  { id: 'luau-extras', t: 'Luau の便利な書き方 (+=・if 式・continue・補間)', k: 'luau 複合代入 += -= if式 continue 補間文字列 バッククォート 便利 新機能',
    b: `Luau には Lua 5.1 にない便利な書き方があります。
- 複合代入: \`x += 1\`、\`s ..= "!"\`
- if 式: \`local c = if ok then "緑" else "赤"\`
- \`continue\`: ループのその回を飛ばす
- 文字列補間: バッククォートで囲んだ文字列の \`{}\` に式 (下の例)
- 汎用ループ: \`for k, v in t do\` (pairs を省略可)`,
    c: `for i = 1, 10 do
	if i % 2 == 0 then continue end
	print(\`{i} は奇数\`)
end` },
  { id: 'scope-closure', t: 'スコープとクロージャ', k: 'スコープ scope クロージャ closure アップバリュー upvalue ブロック 見える範囲 関数の中 外側の変数',
    b: `\`local\` 変数は宣言したブロックの中だけで見えます。関数は、作られた場所の外側の変数を覚えたまま使えます (クロージャ)。これを使うと、ボタンごとに別々のカウンターを持たせるような処理が簡単に書けます。`,
    c: `local function makeCounter()
	local n = 0
	return function()
		n += 1
		return n
	end
end
local a = makeCounter()
print(a(), a()) --> 1 2` },
  { id: 'comments', t: 'コメントの書き方', k: 'コメント comment -- --[[ ]] メモ 無効化 説明',
    b: `\`--\` から行末まではコメント (実行されないメモ) です。複数行は \`--[[ ... ]]\` で囲みます。\`//\` や \`#\` は Luau ではコメントになりません。`,
    c: `-- 1 行のコメント
local speed = 16 -- 行の途中からも書けます
--[[
	複数行の
	コメント
]]` },

  // ============================================================
  // Roblox の基本
  // ============================================================
  { id: 'script-types', t: 'Script・LocalScript・ModuleScript の違いと置き場所', k: 'script localscript modulescript 違い 置き場所 サーバー クライアント serverscriptservice starterplayerscripts startergui startercharacterscripts どこに置く 動かない',
    b: `- **Script** (サーバー): ServerScriptService や Workspace に置きます。全員に共通の処理 (データ保存・ダメージ判定・お金の管理)
- **LocalScript** (クライアント): StarterPlayerScripts・StarterGui・StarterCharacterScripts・ツールの中に置きます。その人の画面・入力・カメラ
- **ModuleScript**: \`require\` で読み込む部品
- LocalScript を Workspace に置いても動きません。サーバーでは \`LocalPlayer\` は nil です
- ForgeCode では、ファイル名を \`xxx.server.lua\` / \`xxx.client.lua\` にすると種類が分かります`,
    c: `-- サーバー (Script) からクライアントの処理を頼むときは RemoteEvent を使います
local RunService = game:GetService("RunService")
print(RunService:IsServer() and "サーバー" or "クライアント")` },
  { id: 'services', t: 'サービスの取得 (GetService) とよく使うサービス', k: 'getservice サービス service players workspace replicatedstorage serverstorage serverscriptservice tweenservice userinputservice runservice datastoreservice lighting debris httpservice 一覧',
    b: `Roblox の機能は「サービス」に分かれていて、\`game:GetService("名前")\` で取り出します (\`game.Players\` より確実です)。スクリプトの先頭でまとめて取得しておくのが定番です。
- **Players**: プレイヤー / **Workspace** (\`workspace\`): 3D の世界 / **ReplicatedStorage**: 両側で共有
- **ServerStorage**・**ServerScriptService**: サーバー専用 / **TweenService**: なめらかな動き
- **UserInputService**: キー・マウス・タッチ / **RunService**: 毎フレームの処理
- **DataStoreService**: データ保存 / **Debris**: 時間で自動削除 / **Lighting**: 明るさ・時刻`,
    c: `local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")` },
  { id: 'players', t: 'プレイヤーの取得 (PlayerAdded・LocalPlayer)', k: 'プレイヤー player players playeradded playerremoving localplayer 参加 退出 全員 getplayers 自分 入ってきた',
    b: `- サーバー: \`Players.PlayerAdded:Connect(function(player) ... end)\` で参加した人を受け取ります。退出は \`PlayerRemoving\`
- クライアント: 自分は \`Players.LocalPlayer\`
- 今いる全員: \`Players:GetPlayers()\`
- キャラクターから人を探す: \`Players:GetPlayerFromCharacter(character)\``,
    c: `local Players = game:GetService("Players")

Players.PlayerAdded:Connect(function(player)
	print(player.Name .. " さんが参加しました")
end)

Players.PlayerRemoving:Connect(function(player)
	print(player.Name .. " さんが退出しました")
end)` },
  { id: 'character', t: 'キャラクターと Humanoid (体力・速さ・ジャンプ)', k: 'キャラクター character humanoid ヒューマノイド characteradded 体力 health maxhealth walkspeed 速さ jumppower jumpheight ジャンプ力 died 死 humanoidrootpart リスポーン',
    b: `プレイヤーの体は \`player.Character\` (モデル) で、その中の **Humanoid** が体力や移動を管理します。
- 体力: \`Humanoid.Health\` / \`MaxHealth\`、ダメージ: \`Humanoid:TakeDamage(10)\`
- 歩く速さ: \`WalkSpeed\` (標準 16)、ジャンプ: \`JumpPower\` (標準 50。\`UseJumpPower\` が false なら \`JumpHeight\`)
- 位置: \`character.HumanoidRootPart\` (または \`character:PivotTo(cframe)\` で移動)
- キャラクターはリスポーンのたびに作り直されるので、\`CharacterAdded\` で毎回受け取ります
- クライアントでは \`player.Character or player.CharacterAdded:Wait()\``,
    c: `local Players = game:GetService("Players")

Players.PlayerAdded:Connect(function(player)
	player.CharacterAdded:Connect(function(character)
		local humanoid = character:WaitForChild("Humanoid")
		humanoid.WalkSpeed = 24
		humanoid.Died:Connect(function()
			print(player.Name .. " がやられました")
		end)
	end)
end)` },
  { id: 'touched', t: 'Touched (触れたとき) とデバウンス', k: 'touched 触れた 触る 当たった 当たり判定 debounce デバウンス 連続 何回も クールダウン hit hit.parent getplayerfromcharacter touchended',
    b: `パーツに何かが触れると \`part.Touched\` が発生します。引数は **触れたパーツ** (手や足) なので、\`hit.Parent\` がキャラクターかどうかを確かめます。
- 触れている間は何回も発生するので、**デバウンス** (クールダウン) で連続実行を防ぎます
- 人ごとに管理したいときは、テーブルに「処理中のプレイヤー」を記録します
- Humanoid は \`FindFirstChildOfClass("Humanoid")\` で探すと確実です`,
    c: `local part = script.Parent
local cooldown = {}

part.Touched:Connect(function(hit)
	local humanoid = hit.Parent:FindFirstChildOfClass("Humanoid")
	if not humanoid or cooldown[humanoid] then return end
	cooldown[humanoid] = true
	humanoid:TakeDamage(20)
	task.wait(1)
	cooldown[humanoid] = nil
end)` },
  { id: 'clickdetector', t: 'ClickDetector (パーツをクリック)', k: 'clickdetector クリック click mouseclick パーツをクリック タップ 押す maxactivationdistance',
    b: `パーツの中に **ClickDetector** を入れると、クリック (スマホではタップ) で \`MouseClick\` が発生します。引数はクリックした **プレイヤー** です。届く距離は \`MaxActivationDistance\` で変えられます。`,
    c: `local part = script.Parent
local detector = part:FindFirstChildOfClass("ClickDetector") or Instance.new("ClickDetector")
detector.Parent = part

detector.MouseClick:Connect(function(player)
	part.Color = Color3.fromRGB(math.random(255), math.random(255), math.random(255))
	print(player.Name .. " がクリックしました")
end)` },
  { id: 'proximityprompt', t: 'ProximityPrompt (近づいて E キー)', k: 'proximityprompt プロンプト 近づく e キー 長押し holdduration triggered actiontext 調べる 開ける',
    b: `**ProximityPrompt** をパーツに入れると、近づいたときに「E で開ける」のような表示が出ます (スマホではボタン)。\`Triggered\` の引数は押したプレイヤーです。
- 表示: \`ActionText\` (動作)・\`ObjectText\` (物の名前)
- 長押し: \`HoldDuration\` (秒)、届く距離: \`MaxActivationDistance\``,
    c: `local prompt = Instance.new("ProximityPrompt")
prompt.ActionText = "開ける"
prompt.ObjectText = "宝箱"
prompt.HoldDuration = 0.5
prompt.Parent = script.Parent

prompt.Triggered:Connect(function(player)
	print(player.Name .. " が宝箱を開けた")
end)` },
  { id: 'instance-new', t: 'Instance.new (オブジェクトを作る)・Clone・Destroy', k: 'instance.new インスタンス 作る 生成 parent 親 clone 複製 destroy 削除 消す debris additem 自動で消す new part',
    b: `\`Instance.new("クラス名")\` で新しいオブジェクトを作ります。**プロパティを全部設定してから最後に \`Parent\` を設定** すると速く、ちらつきもありません (\`Instance.new("Part", parent)\` は非推奨)。
- 複製: \`obj:Clone()\` (Parent は nil なので設定が必要)
- 削除: \`obj:Destroy()\` (\`:Remove()\` は非推奨)
- 時間で自動削除: \`Debris:AddItem(obj, 秒)\``,
    c: `local Debris = game:GetService("Debris")

local part = Instance.new("Part")
part.Size = Vector3.new(4, 1, 4)
part.Position = Vector3.new(0, 10, 0)
part.Color = Color3.fromRGB(255, 80, 80)
part.Anchored = true
part.Parent = workspace -- 最後に

Debris:AddItem(part, 5) -- 5 秒後に消える` },
  { id: 'findfirstchild', t: 'FindFirstChild と WaitForChild (Infinite yield の対策)', k: 'findfirstchild waitforchild 子 探す 見つからない nil infinite yield possible 待つ タイムアウト getchildren getdescendants findfirstchildofclass',
    b: `- \`obj:FindFirstChild("名前")\`: すぐ探して、なければ **nil** を返します。使う前に \`if x then\` で確かめます
- \`obj:WaitForChild("名前")\`: 出てくるまで **待ちます**。クライアントで、サーバーから届くもの (GUI・キャラクターの部品・ReplicatedStorage の中身) を待つときに使います
- 「Infinite yield possible」は、WaitForChild が 5 秒以上待っている警告です。名前の打ち間違いか、置き場所の違いを疑ってください。\`WaitForChild("名前", 10)\` で待つ時間を決められます
- クラスで探す: \`FindFirstChildOfClass("Humanoid")\``,
    c: `local tool = player.Backpack:FindFirstChild("Sword")
if tool then
	tool.Parent = player.Character
end

local remote = game.ReplicatedStorage:WaitForChild("BuyItem", 10)
if not remote then warn("BuyItem が見つかりません") end` },
  { id: 'events', t: 'イベント (Connect・Disconnect・Once・Wait)', k: 'イベント event connect disconnect once wait signal シグナル 接続 解除 メモリリーク 重い 繰り返し接続 getpropertychangedsignal changed',
    b: `Roblox の多くの出来事はイベントで受け取ります: \`イベント:Connect(関数)\`。
- 接続を止める: \`local conn = ...:Connect(f)\` → \`conn:Disconnect()\`
- 1 回だけ: \`:Once(f)\`、来るまで待つ: \`:Wait()\`
- プロパティの変化: \`obj:GetPropertyChangedSignal("Health"):Connect(f)\`
- **イベントの中で別のイベントに接続し続けると、接続が増え続けて重くなります** (メモリリーク)。不要になったら Disconnect してください`,
    c: `local humanoid = character:WaitForChild("Humanoid")
local conn
conn = humanoid:GetPropertyChangedSignal("Health"):Connect(function()
	print("体力:", humanoid.Health)
	if humanoid.Health <= 0 then
		conn:Disconnect()
	end
end)` },
  { id: 'tweenservice', t: 'TweenService (なめらかに動かす)', k: 'tweenservice tween トゥイーン なめらか アニメーション 動かす tweeninfo easingstyle easingdirection completed 開く ドア フェード 透明度 サイズ 移動',
    b: `TweenService を使うと、位置・大きさ・色・透明度などを **なめらかに変化** させられます。
1. \`TweenInfo.new(秒, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)\` で動き方を決める
2. \`TweenService:Create(対象, info, { 目標のプロパティ })\` で作る
3. \`:Play()\` で再生。終わったら \`Completed\` が発生します
- 繰り返し: \`TweenInfo.new(1, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true)\` (-1 で無限、true で往復)
- GUI にも使えます (\`Position\`・\`Size\`・\`BackgroundTransparency\`)`,
    c: `local TweenService = game:GetService("TweenService")
local part = script.Parent

local info = TweenInfo.new(2, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
local tween = TweenService:Create(part, info, {
	Position = part.Position + Vector3.new(0, 10, 0),
	Transparency = 0.5,
})
tween:Play()
tween.Completed:Wait()
print("終わり")` },
  { id: 'remoteevent', t: 'RemoteEvent (クライアントとサーバーの通信)', k: 'remoteevent リモート 通信 fireserver onserverevent fireclient fireallclients onclientevent サーバーに送る クライアントに送る 送信 引数 player 最初の引数',
    b: `クライアント (LocalScript) とサーバー (Script) は別々に動いているので、やり取りには **RemoteEvent** を使います (ReplicatedStorage に置きます)。
- クライアント → サーバー: \`remote:FireServer(値)\` → サーバーで \`remote.OnServerEvent:Connect(function(player, 値) ... end)\`
- **サーバー側の最初の引数は、送ってきたプレイヤー** (自動で付きます)。クライアントから player を送る必要はありません
- サーバー → クライアント: \`remote:FireClient(player, 値)\` / 全員に \`FireAllClients(値)\` → \`OnClientEvent\`
- **クライアントから来た値は信用しない**: 値段・ダメージ量・距離などはサーバーで確かめます`,
    c: `-- サーバー (Script)
local remote = Instance.new("RemoteEvent")
remote.Name = "BuyItem"
remote.Parent = game.ReplicatedStorage

remote.OnServerEvent:Connect(function(player, itemName)
	if typeof(itemName) ~= "string" then return end -- 値を確かめる
	print(player.Name .. " が " .. itemName .. " を買おうとしています")
end)

-- クライアント (LocalScript)
local remote = game.ReplicatedStorage:WaitForChild("BuyItem")
remote:FireServer("Sword")` },
  { id: 'remotefunction', t: 'RemoteFunction (返事が必要な通信)', k: 'remotefunction invokeserver onserverinvoke invokeclient 返事 戻り値 問い合わせ',
    b: `返事が欲しいときは **RemoteFunction** を使います: クライアントの \`remote:InvokeServer(値)\` が、サーバーの \`OnServerInvoke\` の戻り値を受け取ります。
- \`OnServerInvoke\` は \`remote.OnServerInvoke = function(player, ...) return 結果 end\` のように **代入** で設定します (Connect ではありません)
- サーバーから \`InvokeClient\` を使うのは危険です (クライアントが返事をしないとサーバーが止まります)。RemoteEvent を使いましょう`,
    c: `-- サーバー
local getCoins = Instance.new("RemoteFunction")
getCoins.Name = "GetCoins"
getCoins.Parent = game.ReplicatedStorage
getCoins.OnServerInvoke = function(player)
	return player.leaderstats.Coins.Value
end

-- クライアント
local coins = game.ReplicatedStorage:WaitForChild("GetCoins"):InvokeServer()
print("所持コイン:", coins)` },
  { id: 'bindable', t: 'BindableEvent (同じ側のスクリプト同士の通知)', k: 'bindableevent bindablefunction 同じサーバー スクリプト間 通知 自作イベント fire event',
    b: `同じ側 (サーバー同士・クライアント同士) のスクリプトに知らせたいときは **BindableEvent** を使います: \`bindable:Fire(値)\` → \`bindable.Event:Connect(function(値) end)\`。ModuleScript の中で自作のイベントを作るのにも便利です。`,
    c: `local roundEnded = Instance.new("BindableEvent")
roundEnded.Event:Connect(function(winner)
	print("勝者:", winner)
end)
roundEnded:Fire("Taro")` },
  { id: 'datastore', t: 'DataStore (データの保存と読み込み)', k: 'datastore データストア データを保存 保存 セーブ ロード 読み込み getasync setasync updateasync データ 残す 次回 bindtoclose playerremoving 消える api services',
    b: `ゲームを抜けてもデータを残すには **DataStoreService** を使います (サーバー専用)。
- 読み込み: \`store:GetAsync(キー)\`、保存: \`store:SetAsync(キー, 値)\` (前の値を元に変えるなら \`UpdateAsync\`)
- **必ず \`pcall\` で包みます** (通信なので失敗することがあります)
- キーは \`"Player_" .. player.UserId\` のように UserId を使います (名前は変えられるため)
- 退出時 (\`PlayerRemoving\`) とサーバー終了時 (\`game:BindToClose\`) に保存します
- Studio で試すには、ゲーム設定で「API サービスへの Studio アクセス」をオンにします`,
    c: `local DataStoreService = game:GetService("DataStoreService")
local store = DataStoreService:GetDataStore("PlayerData")

local function load(player)
	local ok, data = pcall(function()
		return store:GetAsync("Player_" .. player.UserId)
	end)
	return ok and data or { coins = 0 }
end

local function save(player, data)
	local ok, err = pcall(function()
		store:SetAsync("Player_" .. player.UserId, data)
	end)
	if not ok then warn("保存に失敗:", err) end
end` },
  { id: 'leaderstats', t: 'leaderstats (画面右上のスコア表示)', k: 'leaderstats リーダーボード スコア 表示 ポイント コイン intvalue numbervalue ランキング 右上',
    b: `プレイヤーの中に **"leaderstats"** という名前の Folder を作り、その中に \`IntValue\` などを入れると、画面右上のリーダーボードに表示されます (名前は正確に \`leaderstats\`)。値は \`.Value\` で読み書きします (サーバーで変えてください)。`,
    c: `local Players = game:GetService("Players")

Players.PlayerAdded:Connect(function(player)
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"
	leaderstats.Parent = player

	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Value = 0
	coins.Parent = leaderstats
end)` },
  { id: 'userinput', t: 'UserInputService (キー・マウス・タッチの入力)', k: 'userinputservice 入力 キー キーボード inputbegan inputended keycode iskeydown gameprocessedevent マウス クリック タッチ shift ダッシュ スマホ',
    b: `キーやマウスの入力はクライアント (LocalScript) の **UserInputService** で受け取ります。
- \`InputBegan\` (押した)・\`InputEnded\` (離した)
- **2 つ目の引数 \`gameProcessed\` が true のときは無視** します (チャット入力中など)
- キー: \`input.KeyCode == Enum.KeyCode.E\`、マウス: \`input.UserInputType == Enum.UserInputType.MouseButton1\`
- 押しているか: \`UserInputService:IsKeyDown(Enum.KeyCode.LeftShift)\`
- スマホにはキーボードがないので、ボタン (GUI や ContextActionService) も用意しましょう`,
    c: `local UserInputService = game:GetService("UserInputService")

UserInputService.InputBegan:Connect(function(input, gameProcessed)
	if gameProcessed then return end
	if input.KeyCode == Enum.KeyCode.E then
		print("E を押しました")
	end
end)` },
  { id: 'contextaction', t: 'ContextActionService (スマホのボタンも作れる入力)', k: 'contextactionservice bindaction unbindaction スマホ ボタン モバイル タッチボタン createtouchbutton',
    b: `\`ContextActionService:BindAction(名前, 関数, スマホ用ボタンを作るか, キー...)\` で、キーとスマホのボタンを一度に用意できます。関数は \`(actionName, inputState, input)\` を受け取り、\`inputState == Enum.UserInputState.Begin\` で押した瞬間を判定します。`,
    c: `local ContextActionService = game:GetService("ContextActionService")

local function onDash(actionName, inputState)
	if inputState == Enum.UserInputState.Begin then
		print("ダッシュ!")
	end
	return Enum.ContextActionResult.Pass
end

ContextActionService:BindAction("Dash", onDash, true, Enum.KeyCode.Q)
ContextActionService:SetTitle("Dash", "ダッシュ")` },
  { id: 'runservice', t: 'RunService (毎フレームの処理)', k: 'runservice heartbeat renderstepped stepped 毎フレーム フレーム deltatime dt isserver isclient bindtorenderstep 滑らか',
    b: `毎フレーム実行したい処理は **RunService** のイベントを使います。引数は前のフレームからの秒数 (dt) です。
- \`Heartbeat\`: 物理の後 (サーバー・クライアント両方)。多くの処理はこれ
- \`RenderStepped\`: 描画の前 (**クライアント専用**)。カメラや見た目の追従に
- 重い処理 (GetService・FindFirstChild・Instance.new) を毎フレーム書かないようにします
- \`RunService:IsServer()\` / \`IsClient()\` でどちらで動いているか分かります`,
    c: `local RunService = game:GetService("RunService")
local part = workspace:WaitForChild("Spinner")

RunService.Heartbeat:Connect(function(dt)
	part.CFrame *= CFrame.Angles(0, math.rad(90) * dt, 0) -- 1 秒に 90 度
end)` },
  { id: 'cframe', t: 'CFrame (位置と向き)', k: 'cframe 位置 向き 回転 angles lookat lookvector rightvector 向ける pivotto テレポート 掛け算 * math.rad 座標',
    b: `**CFrame** は位置と向きをまとめたものです。
- 作る: \`CFrame.new(x, y, z)\`、向きを付ける: \`CFrame.lookAt(位置, 見る先)\`
- 回転: \`cf * CFrame.Angles(0, math.rad(90), 0)\` (角度はラジアン。度は \`math.rad\` で変換)
- 前方向: \`cf.LookVector\`、位置だけ: \`cf.Position\`
- モデル (キャラクターなど) を動かすなら \`model:PivotTo(cf)\``,
    c: `local part = workspace.Part
part.CFrame = CFrame.new(0, 5, 0) * CFrame.Angles(0, math.rad(45), 0)

-- 3 スタッド前に移動
part.CFrame = part.CFrame + part.CFrame.LookVector * 3

-- キャラクターを移動
character:PivotTo(CFrame.new(0, 10, 0))` },
  { id: 'vector3', t: 'Vector3 (座標・距離・方向)', k: 'vector3 座標 位置 距離 magnitude unit 方向 ベクトル 足し算 差 position size 近い 遠い',
    b: `\`Vector3.new(x, y, z)\` は 3D の座標や大きさです。
- 2 点の距離: \`(a - b).Magnitude\`
- 方向 (長さ 1): \`(b - a).Unit\`
- 足し算・引き算・掛け算ができます: \`pos + Vector3.new(0, 5, 0)\`, \`dir * 10\`
- よく使う値: \`Vector3.zero\`、\`Vector3.yAxis\``,
    c: `local a = workspace.PartA.Position
local b = workspace.PartB.Position
local distance = (a - b).Magnitude
if distance < 10 then
	print("近い!", math.floor(distance))
end` },
  { id: 'raycast', t: 'Raycast (光線を飛ばして当たりを調べる)', k: 'raycast レイキャスト レイ raycastparams filterdescendantsinstances 当たり 地面 視線 銃 弾 当たった場所 normal',
    b: `\`workspace:Raycast(始点, 方向 × 長さ, params)\` で、まっすぐ線を伸ばして最初に当たったものを調べます。結果は \`nil\` (何もない) か、\`Instance\`・\`Position\`・\`Normal\`・\`Material\` を持つ結果です。
- 自分のキャラクターを除くには \`RaycastParams\` の \`FilterDescendantsInstances\` と \`FilterType = Enum.RaycastFilterType.Exclude\``,
    c: `local params = RaycastParams.new()
params.FilterDescendantsInstances = { character }
params.FilterType = Enum.RaycastFilterType.Exclude

local origin = character.HumanoidRootPart.Position
local result = workspace:Raycast(origin, Vector3.new(0, -50, 0), params)
if result then
	print("地面:", result.Instance.Name, result.Position)
end` },
  { id: 'gui-basics', t: 'GUI の基本 (ScreenGui・Frame・TextLabel・UDim2)', k: 'gui ui 画面 screengui frame textlabel textbutton imagelabel udim2 scale offset 位置 大きさ anchorpoint zindex resetonspawn スマホ対応 playergui startergui 作り方',
    b: `画面の UI は **ScreenGui** の中に Frame・TextLabel・TextButton などを入れて作ります (クライアントの \`player.PlayerGui\`、または StarterGui に置きます)。
- 位置と大きさは **UDim2**: \`UDim2.new(割合X, ピクセルX, 割合Y, ピクセルY)\`
- **スマホでも崩れないように割合 (Scale) を中心に**: \`UDim2.fromScale(0.5, 0.3)\`
- 中央に置く: \`AnchorPoint = Vector2.new(0.5, 0.5)\` + \`Position = UDim2.fromScale(0.5, 0.5)\`
- 文字の大きさを自動: \`TextScaled = true\`
- 死んでも消えないように: \`ScreenGui.ResetOnSpawn = false\`
- 角を丸く \`UICorner\`、枠線 \`UIStroke\`、並べる \`UIListLayout\`、余白 \`UIPadding\`、比率を保つ \`UIAspectRatioConstraint\``,
    c: `local player = game:GetService("Players").LocalPlayer
local gui = Instance.new("ScreenGui")
gui.ResetOnSpawn = false

local frame = Instance.new("Frame")
frame.AnchorPoint = Vector2.new(0.5, 0.5)
frame.Position = UDim2.fromScale(0.5, 0.5)
frame.Size = UDim2.fromScale(0.4, 0.3)
frame.BackgroundColor3 = Color3.fromRGB(30, 30, 40)
frame.Parent = gui
Instance.new("UICorner").Parent = frame

local title = Instance.new("TextLabel")
title.Size = UDim2.fromScale(1, 0.3)
title.BackgroundTransparency = 1
title.Text = "こんにちは"
title.TextScaled = true
title.TextColor3 = Color3.new(1, 1, 1)
title.Parent = frame

gui.Parent = player:WaitForChild("PlayerGui")` },
  { id: 'gui-button', t: 'ボタンが押されたとき (Activated・MouseButton1Click)', k: 'ボタン button textbutton imagebutton 押した クリック activated mousebutton1click タップ 反応しない 開く 閉じる トグル',
    b: `TextButton / ImageButton が押されたら \`button.Activated\` (マウス・タッチ・コントローラーすべてに対応) で受け取ります。\`MouseButton1Click\` でも動きますが、スマホも考えるなら \`Activated\` がおすすめです。
- ボタンの処理は LocalScript で書きます。サーバーの処理が必要なら RemoteEvent で頼みます
- 反応しないときは: 上に透明な Frame が重なっていないか (\`ZIndex\`)、\`Active\` / \`Visible\`、LocalScript の置き場所を確認`,
    c: `local button = script.Parent
local frame = button.Parent:WaitForChild("Menu")

button.Activated:Connect(function()
	frame.Visible = not frame.Visible -- 開く / 閉じる
end)` },
  { id: 'sound', t: 'サウンド (効果音・BGM)', k: 'サウンド sound 音 効果音 bgm 音楽 soundid play stop volume looped 鳴らす soundservice playlocalsound',
    b: `\`Sound\` を作って \`SoundId = "rbxassetid://番号"\` を設定し、\`:Play()\` で鳴らします。
- 音量 \`Volume\` (0〜10)、繰り返し \`Looped = true\`、高さ \`PlaybackSpeed\`
- パーツに入れると、その場所から音が聞こえます (近いほど大きい)。画面全体なら SoundService や PlayerGui に
- 鳴り終わり: \`sound.Ended\``,
    c: `local sound = Instance.new("Sound")
sound.SoundId = "rbxassetid://9118823100" -- 使いたい音の ID
sound.Volume = 0.8
sound.Parent = workspace
sound:Play()` },
  { id: 'animation', t: 'アニメーションの再生 (Animator)', k: 'アニメーション animation animator loadanimation animationtrack play stop エモート ダンス 動き モーション animationid',
    b: `キャラクターのアニメーションは、Humanoid の中の **Animator** で読み込んで再生します。
1. \`Animation\` を作り \`AnimationId = "rbxassetid://番号"\`
2. \`animator:LoadAnimation(anim)\` で AnimationTrack を作る
3. \`track:Play()\` / \`track:Stop()\`
- 自分で作ったアニメーション (または公開されたもの) の ID が必要です`,
    c: `local humanoid = character:WaitForChild("Humanoid")
local animator = humanoid:WaitForChild("Animator")

local anim = Instance.new("Animation")
anim.AnimationId = "rbxassetid://507771019" -- ダンスの例
local track = animator:LoadAnimation(anim)
track.Looped = true
track:Play()` },
  { id: 'camera', t: 'カメラの操作', k: 'カメラ camera currentcamera cameratype scriptable fieldofview 視点 視野 カットシーン 追従 shake 揺れ',
    b: `カメラはクライアントの \`workspace.CurrentCamera\` です。
- 自分で動かすには \`camera.CameraType = Enum.CameraType.Scriptable\` にしてから \`camera.CFrame\` を設定 (戻すときは \`Custom\`)
- 視野角: \`FieldOfView\` (標準 70)
- カメラの向き: \`camera.CFrame.LookVector\``,
    c: `local camera = workspace.CurrentCamera
camera.CameraType = Enum.CameraType.Scriptable
camera.CFrame = CFrame.lookAt(Vector3.new(0, 30, 30), Vector3.zero)
task.wait(3)
camera.CameraType = Enum.CameraType.Custom -- 元に戻す` },
  { id: 'lighting', t: 'Lighting (時刻・明るさ・霧)', k: 'lighting 照明 明るさ 時刻 clocktime timeofday 昼 夜 brightness 霧 fog ambient 空 sky',
    b: `**Lighting** で世界の明るさや時間を変えます。
- 時刻: \`Lighting.ClockTime = 14\` (0〜24)
- 明るさ \`Brightness\`、周りの色 \`Ambient\`、霧 \`FogEnd\` / \`FogColor\`
- エフェクト (ColorCorrection・Bloom・Atmosphere) を Lighting に入れると画面全体に効きます`,
    c: `local Lighting = game:GetService("Lighting")
Lighting.ClockTime = 20 -- 夜
Lighting.Brightness = 1
Lighting.FogEnd = 300` },
  { id: 'attributes', t: '属性 (Attribute)', k: '属性 attribute setattribute getattribute getattributechangedsignal 値を持たせる データ 付ける',
    b: `Instance に自由な値を付けられるのが属性です: \`obj:SetAttribute("Damage", 20)\` / \`obj:GetAttribute("Damage")\`。値が変わったら \`obj:GetAttributeChangedSignal("Damage")\` で分かります。IntValue などを作らなくても設定値を持たせられて便利です。`,
    c: `local part = script.Parent
part:SetAttribute("Damage", 25)

part.Touched:Connect(function(hit)
	local humanoid = hit.Parent:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid:TakeDamage(part:GetAttribute("Damage") or 10)
	end
end)` },
  { id: 'collectionservice', t: 'CollectionService (タグでまとめて処理)', k: 'collectionservice タグ tag addtag hastag gettagged getinstanceaddedsignal まとめて 同じ処理 たくさんのパーツ',
    b: `同じ処理をたくさんのパーツにしたいときは、**タグ** を付けて CollectionService でまとめて扱うと、パーツごとにスクリプトを入れずに済みます。
- タグを付ける: \`CollectionService:AddTag(part, "Lava")\` (Studio のタグエディタでも可)
- 全部取り出す: \`CollectionService:GetTagged("Lava")\`
- あとから増えたもの: \`GetInstanceAddedSignal("Lava")\``,
    c: `local CollectionService = game:GetService("CollectionService")

local function setupLava(part)
	part.Touched:Connect(function(hit)
		local humanoid = hit.Parent:FindFirstChildOfClass("Humanoid")
		if humanoid then humanoid.Health = 0 end
	end)
end

for _, part in CollectionService:GetTagged("Lava") do
	setupLava(part)
end
CollectionService:GetInstanceAddedSignal("Lava"):Connect(setupLava)` },
  { id: 'teams', t: 'チーム (Teams)', k: 'チーム team teams チーム分け teamcolor autoassignable 赤チーム 青チーム',
    b: `**Teams** サービスの中に \`Team\` を作ると、チームが使えます。プレイヤーのチームは \`player.Team = team\` で変えます。\`TeamColor\` が同じ SpawnLocation から出現させることもできます。`,
    c: `local Teams = game:GetService("Teams")
local red = Instance.new("Team")
red.Name = "赤チーム"
red.TeamColor = BrickColor.new("Really red")
red.AutoAssignable = true
red.Parent = Teams` },
  { id: 'marketplace', t: 'ゲームパス・課金アイテム (MarketplaceService)', k: 'marketplaceservice ゲームパス gamepass 課金 robux devproduct プロダクト 購入 userownsgamepassasync promptgamepasspurchase processreceipt',
    b: `- ゲームパスを持っているか: \`MarketplaceService:UserOwnsGamePassAsync(player.UserId, パスID)\` (pcall で包む)
- 購入画面を出す: \`PromptGamePassPurchase(player, パスID)\` / \`PromptProductPurchase(player, 商品ID)\`
- 何度でも買える商品 (Developer Product) は、サーバーで \`ProcessReceipt\` を設定して付与し、\`Enum.ProductPurchaseDecision.PurchaseGranted\` を返します`,
    c: `local MarketplaceService = game:GetService("MarketplaceService")
local VIP_PASS = 0 -- ゲームパスの ID

local function hasVip(player)
	local ok, owns = pcall(function()
		return MarketplaceService:UserOwnsGamePassAsync(player.UserId, VIP_PASS)
	end)
	return ok and owns
end` },
  { id: 'badges', t: 'バッジを渡す (BadgeService)', k: 'badgeservice バッジ badge awardbadge 実績 獲得 userhasbadgeasync',
    b: `サーバーで \`BadgeService:AwardBadge(player.UserId, バッジID)\` を呼ぶとバッジを渡せます (pcall で包みます)。持っているかは \`UserHasBadgeAsync\` で調べます。`,
    c: `local BadgeService = game:GetService("BadgeService")
local BADGE_ID = 0

local function award(player)
	pcall(function()
		if not BadgeService:UserHasBadgeAsync(player.UserId, BADGE_ID) then
			BadgeService:AwardBadge(player.UserId, BADGE_ID)
		end
	end)
end` },
  { id: 'pathfinding', t: '経路探索 (PathfindingService) で NPC を動かす', k: 'pathfindingservice 経路 pathfinding npc 追いかける ついてくる 敵 ゾンビ moveto computeasync waypoints 歩かせる movetofinished',
    b: `NPC を障害物を避けて歩かせるには **PathfindingService** で道を計算し、\`Humanoid:MoveTo(地点)\` で順に歩かせます。
1. \`local path = PathfindingService:CreatePath()\`
2. \`path:ComputeAsync(始点, 終点)\` (pcall で)
3. \`path:GetWaypoints()\` の点に順に \`MoveTo\` → \`MoveToFinished:Wait()\`
- 単純に近づくだけなら \`humanoid:MoveTo(target.Position)\` だけでも動きます`,
    c: `local PathfindingService = game:GetService("PathfindingService")

local function walkTo(humanoid, rootPart, goal)
	local path = PathfindingService:CreatePath()
	local ok = pcall(function() path:ComputeAsync(rootPart.Position, goal) end)
	if not ok or path.Status ~= Enum.PathStatus.Success then return end
	for _, wp in path:GetWaypoints() do
		if wp.Action == Enum.PathWaypointAction.Jump then humanoid.Jump = true end
		humanoid:MoveTo(wp.Position)
		humanoid.MoveToFinished:Wait()
	end
end` },
  { id: 'physics', t: '物理 (Anchored・CanCollide・速度・吹き飛ばし)', k: '物理 physics anchored 固定 cancollide すり抜け 当たり 速度 velocity assemblylinearvelocity applyimpulse 吹き飛ばす ノックバック 重力 gravity 落ちる massless',
    b: `- \`Anchored = true\`: 固定 (落ちない・押されない)
- \`CanCollide = false\`: すり抜ける (Touched は発生します)。\`CanTouch = false\` で Touched も止まります
- 速度: \`part.AssemblyLinearVelocity = Vector3.new(0, 50, 0)\`
- 押す: \`part:ApplyImpulse(力)\` (重さに比例)
- 重力: \`workspace.Gravity\` (標準 196.2)
- 吹き飛ばし (ノックバック): キャラクターの HumanoidRootPart の速度を変えます`,
    c: `-- 触れた人を上に吹き飛ばす
script.Parent.Touched:Connect(function(hit)
	local root = hit.Parent:FindFirstChild("HumanoidRootPart")
	if root then
		root.AssemblyLinearVelocity = Vector3.new(0, 80, 0)
	end
end)` },
  { id: 'parts', t: 'パーツのプロパティ (大きさ・色・素材・透明度)', k: 'パーツ part プロパティ size position color brickcolor material transparency 透明 素材 neon shape 形 球 大きさ 色を変える reflectance',
    b: `パーツのよく使うプロパティです。
- 大きさ \`Size = Vector3.new(4, 1, 2)\`、位置 \`Position\` / \`CFrame\`
- 色 \`Color = Color3.fromRGB(255, 0, 0)\` (または \`BrickColor = BrickColor.new("Bright red")\`)
- 素材 \`Material = Enum.Material.Neon\`、透明度 \`Transparency = 0.5\` (1 で見えない)
- 形 \`Shape = Enum.PartType.Ball\`
- 固定 \`Anchored\`、当たり \`CanCollide\``,
    c: `local part = Instance.new("Part")
part.Shape = Enum.PartType.Ball
part.Size = Vector3.new(3, 3, 3)
part.Material = Enum.Material.Neon
part.Color = Color3.fromRGB(0, 200, 255)
part.Anchored = true
part.Position = Vector3.new(0, 5, 0)
part.Parent = workspace` },
  { id: 'chat-commands', t: 'チャットコマンド (Player.Chatted)', k: 'チャット chat chatted コマンド command /speed 管理者 admin textchatservice メッセージ 送信',
    b: `サーバーで \`player.Chatted:Connect(function(message) ... end)\` を使うと、チャットの文を受け取れます。\`/speed 50\` のようなコマンドは \`message:split(" ")\` で分けて処理します。管理者だけに許可するなら \`player.UserId\` を確かめてください。`,
    c: `local Players = game:GetService("Players")

Players.PlayerAdded:Connect(function(player)
	player.Chatted:Connect(function(message)
		local args = message:split(" ")
		if args[1] == "/speed" then
			local humanoid = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
			local value = tonumber(args[2])
			if humanoid and value then
				humanoid.WalkSpeed = math.clamp(value, 0, 100)
			end
		end
	end)
end)` },
  { id: 'notifications', t: '通知を出す (SetCore SendNotification)', k: '通知 notification sendnotification setcore 右下 お知らせ メッセージ表示 startergui',
    b: `クライアントで \`StarterGui:SetCore("SendNotification", { Title = "題名", Text = "本文", Duration = 5 })\` を呼ぶと、右下に通知が出ます。読み込み直後は失敗することがあるので \`pcall\` で包みます。`,
    c: `local StarterGui = game:GetService("StarterGui")
pcall(function()
	StarterGui:SetCore("SendNotification", {
		Title = "ようこそ",
		Text = "ゲームへようこそ!",
		Duration = 5,
	})
end)` },
  { id: 'security', t: 'チート対策の基本 (クライアントを信用しない)', k: 'セキュリティ 安全 チート対策 exploit 不正 改造 信用しない 検証 filteringenabled サーバー権限 remote 悪用 レート制限 連打',
    b: `クライアント (LocalScript) は改造されることがあります。**大事なこと (お金・体力・アイテム・当たり判定) はサーバーで決めます**。
- RemoteEvent で届いた値は必ず確かめる (型 \`typeof\`・範囲・距離・持っているか)
- 「〜円もらう」のように **結果** を送らせず、「〜を買いたい」のように **お願い** を送らせ、サーバーで計算する
- 連打対策: プレイヤーごとに最後の時刻を記録して間隔を制限
- クライアントでの変更 (WalkSpeed など) は、サーバーには伝わりません`,
    c: `local lastBuy = {}
remote.OnServerEvent:Connect(function(player, itemName)
	local now = os.clock()
	if lastBuy[player] and now - lastBuy[player] < 0.5 then return end -- 連打を防ぐ
	lastBuy[player] = now
	local price = PRICES[itemName] -- 値段はサーバーが決める
	if not price then return end
	local coins = player.leaderstats.Coins
	if coins.Value >= price then
		coins.Value -= price
	end
end)` },
  { id: 'performance', t: '動作を軽くするコツ (パフォーマンス)', k: 'パフォーマンス 軽く 重い ラグ 最適化 速く カクカク fps メモリ リーク 毎フレーム キャッシュ debris streamingenabled',
    b: `- サービスやよく使う Instance は **最初に 1 回だけ** 取得して変数に入れる (ループや毎フレームの中で GetService・FindFirstChild・WaitForChild しない)
- \`while true do ... wait() end\` で見張るより、**イベント** (Changed・Touched など) を使う
- 不要になった接続は \`:Disconnect()\`、オブジェクトは \`:Destroy()\` (または \`Debris\`)
- 毎フレーム Instance.new しない (使い回す: オブジェクトプール)
- 文字列をループで \`..\` し続けず、テーブルに入れて \`table.concat\`
- たくさんのパーツは Anchored にして、見た目だけなら CanCollide / CanTouch / CanQuery をオフに`,
    c: `-- よくない例: 毎フレーム探している
RunService.Heartbeat:Connect(function()
	local part = workspace:FindFirstChild("Target")
end)

-- よい例: 最初に 1 回だけ
local part = workspace:WaitForChild("Target")
RunService.Heartbeat:Connect(function(dt)
	part.CFrame *= CFrame.Angles(0, dt, 0)
end)` },
  { id: 'httpservice', t: 'HttpService (JSON と HTTP)', k: 'httpservice json jsonencode jsondecode http getasync requestasync url web api 通信 httpenabled generateguid',
    b: `- テーブル ↔ 文字列: \`HttpService:JSONEncode(t)\` / \`JSONDecode(s)\`
- Web への通信はサーバーだけ: \`HttpService:GetAsync(url)\` (ゲーム設定で HTTP リクエストを許可)。pcall で包みます
- 一意な ID: \`HttpService:GenerateGUID(false)\``,
    c: `local HttpService = game:GetService("HttpService")
local json = HttpService:JSONEncode({ name = "Taro", level = 5 })
print(json)
local data = HttpService:JSONDecode(json)
print(data.level)` },
  { id: 'time', t: '時間を測る (os.clock・os.time・tick)', k: '時間 時刻 os.time os.clock tick 経過 測る ストップウォッチ datetime 日付 タイムスタンプ 何秒かかった',
    b: `- 経過時間を測る: \`os.clock()\` (高精度。差を取って使う)
- 現在の日時 (秒): \`os.time()\`、日付の文字列: \`os.date("%Y/%m/%d %H:%M")\`
- \`tick()\` は古い書き方です (\`os.clock\` / \`os.time\` を使いましょう)
- 日付を扱うなら \`DateTime.now()\``,
    c: `local start = os.clock()
for i = 1, 1e6 do end
print(string.format("%.3f 秒", os.clock() - start))
print(os.date("%Y/%m/%d"))` },
  { id: 'spatial', t: '範囲の中のパーツを探す (GetPartBoundsInBox・OverlapParams)', k: '範囲 範囲内 近くのパーツ 当たり判定 getpartboundsinbox getpartboundsinradius getpartsinpart overlapparams ヒットボックス 爆発 範囲攻撃',
    b: `決まった範囲の中にあるパーツは、\`workspace:GetPartBoundsInRadius(中心, 半径, params)\` や \`GetPartBoundsInBox(cframe, size, params)\` で探せます。範囲攻撃やヒットボックスに便利です (Touched より確実)。`,
    c: `local params = OverlapParams.new()
params.FilterDescendantsInstances = { character }
params.FilterType = Enum.RaycastFilterType.Exclude

local hit = {}
for _, part in workspace:GetPartBoundsInRadius(center, 10, params) do
	local humanoid = part.Parent:FindFirstChildOfClass("Humanoid")
	if humanoid and not hit[humanoid] then
		hit[humanoid] = true
		humanoid:TakeDamage(30)
	end
end` },
  { id: 'tools', t: 'ツール (剣・武器) の作り方', k: 'ツール tool 剣 sword 武器 weapon activated equipped unequipped handle requireshandle 振る 攻撃 backpack 持つ',
    b: `**Tool** を StarterPack に置くと、持ち物に入ります。持っている部分のパーツは **Handle** という名前にします (なしにするなら \`RequiresHandle = false\`)。
- 使ったとき: \`tool.Activated\`、持ったとき: \`Equipped\`、しまったとき: \`Unequipped\`
- ダメージなどの判定は **サーバー** (ツールの中の Script) で行います`,
    c: `local tool = script.Parent
local handle = tool:WaitForChild("Handle")
local canHit = false

tool.Activated:Connect(function()
	canHit = true
	task.wait(0.4)
	canHit = false
end)

handle.Touched:Connect(function(hit)
	if not canHit then return end
	local humanoid = hit.Parent:FindFirstChildOfClass("Humanoid")
	if humanoid and hit.Parent ~= tool.Parent then
		canHit = false
		humanoid:TakeDamage(25)
	end
end)` },
  { id: 'spawnlocation', t: 'スポーン地点とチェックポイント', k: 'スポーン spawnlocation チェックポイント checkpoint リスポーン 復活 出現 位置 respawnlocation セーブポイント 中間地点',
    b: `**SpawnLocation** の上に出現します。チェックポイントは、触れたときに \`player.RespawnLocation = spawnLocation\` を設定すると、次はそこから出現します。`,
    c: `local checkpoint = script.Parent -- SpawnLocation
checkpoint.Touched:Connect(function(hit)
	local player = game.Players:GetPlayerFromCharacter(hit.Parent)
	if player then
		player.RespawnLocation = checkpoint
	end
end)` },

  // ============================================================
  // エグゼキューター
  // ============================================================
  { id: 'executor-basics', mode: 'executor', t: 'エグゼキュータースクリプトの基本', k: 'エグゼキューター executor exploit getgenv identifyexecutor 二重実行 グローバル 共有 クライアント localplayer 実行環境',
    b: `エグゼキュータースクリプトは、自分の Roblox クライアントで動く **LocalScript のようなもの** です。サーバーの処理は変えられず、自分の画面・キャラクター・入力だけを操作できます。
- \`getgenv()\`: 別々に実行したスクリプトの間で共有されるグローバル。二重実行の防止によく使います
- \`identifyexecutor()\`: 実行環境の名前
- ForgeCode の Executor モードでは、これらの関数を模したサンドボックスで動作確認できます
- 公開ゲームでの使用は Roblox の利用規約に反し、アカウントが処分されることがあります。自分のゲームや練習用の場所で試しましょう`,
    c: `if getgenv().MyScriptLoaded then
	warn("すでに実行中です")
	return
end
getgenv().MyScriptLoaded = true
print("実行環境:", identifyexecutor())` },
  { id: 'drawing', mode: 'executor', t: 'Drawing ライブラリ (画面に直接描く)', k: 'drawing ドローイング 描画 line text circle square visible color thickness worldtoviewportpoint 画面座標 線 円 四角 文字',
    b: `\`Drawing.new("種類")\` で、画面の上に線・文字・円・四角を直接描けます (GUI より軽く、ゲームの UI の上に出ます)。
- 種類: \`Line\`・\`Text\`・\`Circle\`・\`Square\`・\`Image\`・\`Quad\`・\`Triangle\`
- 共通: \`Visible\`・\`Color\`・\`Transparency\`・\`ZIndex\`、消すときは \`:Remove()\`
- 3D の位置を画面の座標にするには \`camera:WorldToViewportPoint(pos)\` (2 つ目の戻り値で画面内かどうか)`,
    c: `local text = Drawing.new("Text")
text.Text = "Hello"
text.Size = 20
text.Position = Vector2.new(100, 100)
text.Color = Color3.new(1, 1, 1)
text.Outline = true
text.Visible = true` },
  { id: 'files-executor', mode: 'executor', t: 'ファイルの保存 (writefile・readfile)', k: 'writefile readfile isfile makefolder isfolder listfiles delfile appendfile 設定 保存 config 読み込み workspace フォルダ',
    b: `エグゼキューターの workspace フォルダにファイルを保存できます。設定の保存によく使います。
- \`writefile(パス, 文字列)\`・\`readfile(パス)\`・\`isfile(パス)\`
- \`makefolder(パス)\`・\`isfolder(パス)\`・\`listfiles(パス)\`
- テーブルを保存するなら \`HttpService:JSONEncode\` で文字列にします`,
    c: `local HttpService = game:GetService("HttpService")
local FILE = "MyScript/config.json"

if not isfolder("MyScript") then makefolder("MyScript") end
writefile(FILE, HttpService:JSONEncode({ speed = 24 }))
local config = HttpService:JSONDecode(readfile(FILE))
print(config.speed)` },
  { id: 'loadstring', mode: 'executor', t: 'loadstring と HttpGet (UI ライブラリの読み込み)', k: 'loadstring httpget game:httpget ui ライブラリ ライブラリ 読み込み rayfield orion fluent obsidian url リモートスクリプト',
    b: `\`loadstring(game:HttpGet(URL))()\` は、URL から取ってきたコードを **そのまま実行** します。UI ライブラリ (Rayfield・Orion・Fluent・Obsidian など) の読み込みによく使われます。
- **中身を確かめていない URL を実行するのは危険** です (アカウント情報などを抜かれる可能性があります)。信頼できる公式の URL だけにしましょう
- ForgeCode では、一度取得したソースは保存され、補完やゴーストテキストにも使われます`,
    c: `local ok, Library = pcall(function()
	return loadstring(game:HttpGet("https://example.com/library.lua"))()
end)
if not ok then
	warn("読み込みに失敗:", Library)
end` },
  { id: 'gethui', mode: 'executor', t: 'gethui と GUI の置き場所', k: 'gethui coregui gui 置き場所 隠す protect_gui syn.protect_gui playergui 検出',
    b: `エグゼキューターで作った GUI は \`gethui()\` (対応していなければ \`game:GetService("CoreGui")\` や PlayerGui) に入れるのが一般的です。リスポーンで消えないよう \`ResetOnSpawn = false\` にします。`,
    c: `local gui = Instance.new("ScreenGui")
gui.Name = "MyMenu"
gui.ResetOnSpawn = false
gui.Parent = (gethui and gethui()) or game:GetService("CoreGui")` },
  { id: 'request-executor', mode: 'executor', t: 'request (HTTP 通信)', k: 'request http_request syn.request http 通信 post get webhook api body headers',
    b: `\`request({ Url = ..., Method = "GET" | "POST", Headers = {...}, Body = ... })\` で HTTP 通信します。戻り値は \`StatusCode\`・\`Body\` などを持つテーブルです。**アカウント情報や他人のデータを送らない** でください。`,
    c: `local res = request({
	Url = "https://httpbin.org/get",
	Method = "GET",
})
print(res.StatusCode, res.Body)` },

  // ============================================================
  // ForgeCode の使い方
  // ============================================================
  { id: 'app-run', mode: 'app', t: 'ForgeCode: コードを実行する', k: '実行 run ▶ 動かす 試す 出力 コンソール print 停止 止める 実行ファイル エミュレーター',
    b: `画面上部の **▶ (実行)** で、開いているプロジェクトを実行します。\`print\` の結果やエラーは **出力** に表示され、エラーの行をタップするとその場所へ移動します。
- ■ で停止。無限ループは時間制限で自動的に止まります
- どのファイルから実行するかは、ファイルのメニューの「実行ファイルにする」で変えられます
- Roblox の世界 (Players・Workspace・GUI・Drawing) は簡易的に再現されています。実際のサーバーや他のプレイヤーはいません`,
    c: '' },
  { id: 'app-debug', mode: 'app', t: 'ForgeCode: デバッガー (ブレークポイント・ステップ実行)', k: 'デバッグ debug ブレークポイント breakpoint ステップ 一時停止 変数 中身 確認 行番号',
    b: `行番号の左をタップすると **ブレークポイント** (赤い点) を置けます。デバッグ実行するとそこで止まり、変数の中身を確認したり、1 行ずつ進めたり (ステップ実行) できます。`,
    c: '' },
  { id: 'app-projects', mode: 'app', t: 'ForgeCode: プロジェクトとファイル (ZIP で保存・読み込み)', k: 'プロジェクト ファイル 保存 zip バックアップ 読み込み 新規 フォルダ 削除 名前変更 エクスポート インポート 消えた',
    b: `プロジェクトは端末のブラウザの中に自動で保存されます。**ブラウザのデータを消すと消えてしまう** ので、ときどき「ファイル → ⋯ → プロジェクトを ZIP で保存」で控えを取ってください。ZIP は「ZIP を読み込む」で戻せます。`,
    c: '' },
  { id: 'app-modes', mode: 'app', t: 'ForgeCode: Studio モードと Executor モード', k: 'モード studio executor 切り替え 補完 エラー エグゼキューター用 roblox studio 用',
    b: `画面下の **Studio / Executor** で切り替えます。
- **Studio**: Roblox Studio 用のスクリプト (Script / LocalScript / ModuleScript)。公式 API だけを補完・チェックします
- **Executor**: エグゼキューター用のスクリプト。getgenv・Drawing・writefile などの補完と模擬実行ができます`,
    c: '' },
  { id: 'app-gui-preview', mode: 'app', t: 'ForgeCode: GUI のプレビュー', k: 'gui プレビュー preview 見た目 確認 画面 ui 表示 スマホサイズ',
    b: `GUI を作るスクリプトを実行すると、**プレビュー** に画面の見た目が表示されます。ボタンをタップして動きも確かめられます。端末のサイズを切り替えて、スマホでも崩れないか確認しましょう。`,
    c: '' },
  { id: 'app-shortcuts', mode: 'app', t: 'ForgeCode: 便利な操作 (キーボードバー・コマンド・検索)', k: 'ショートカット キーボード キーボードバー コマンドパレット 検索 置換 補完 tab 定義へ移動 名前の変更 一括 折りたたみ 設定',
    b: `- 画面下の **キーボードバー** で、記号やタブ・矢印を 1 タップで入力できます
- **コマンドパレット** (⌘/Ctrl + Shift + P) からすべての操作を探せます
- 補完の候補は Tab / Enter で確定、薄い文字の提案 (ゴーストテキスト) は Tab で確定
- 変数を長押し (または F2) で名前を一括変更、F12 で定義へ移動
- ⌘/Ctrl + F で検索・置換、⌘/Ctrl + Shift + F でファイル全体の整形`,
    c: '' },
  { id: 'app-ai', mode: 'app', t: 'ForgeCode: AI (Forge AI) でできること', k: 'ai forge ai アシスタント できること 使い方 機能 チャット 頼む 内蔵 ネット不要 オフライン llm 高性能モード',
    b: `**Forge AI** はアプリに内蔵された AI です。インターネットにつながっていなくても、すぐに答えます。
- **エラー検知と修正**: 構文エラー (end の不足・\`!=\` などの他の言語の書き方) を自動で直し、打ち間違い・非推奨 API・よくあるバグも修正
- **整形・整理**: 字下げをそろえ、古い書き方 (wait・spawn・:connect) を新しい書き方に
- **説明**: コードが何をしているかを日本語で説明 (選択した行だけでも)
- **コード生成**: 「触れたら死ぬブロック」「E キーでドアが開く」「ショップの UI」などを日本語で頼むと作成
- **質問**: Luau・Roblox の使い方や API を回答
- **コメント・型注釈の追加**、**動作を軽くする提案**、**実行して確かめる**
- 設定 → AI で **高性能モード (端末内 LLM)** をオンにすると、決まった型に当てはまらない自由な依頼にも答えられます (初回にモデルのダウンロードが必要)`,
    c: '' },
]

// 見出しで引けるように
export const KNOWLEDGE_BY_ID = new Map(KNOWLEDGE.map(e => [e.id, e]))
