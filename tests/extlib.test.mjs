// 外部ライブラリ (loadstring) の解析・補完・ゴーストテキスト、URL の正規化のテスト:  node tests/extlib.test.mjs
import { readFileSync } from 'node:fs'
import { EditorState, EditorSelection, indentUnit, CompletionContext } from '../vendor/codemirror.js'
import { setRobloxApi } from '../js/editor/apidb.js'
import { intel, luauCompletionSource, describeAt, scanLoadstringUrls, resolveStringExpr } from '../js/editor/luau-intel.js'
import { luauLanguage } from '../js/editor/luau-lang.js'
import { luauLocalSuggest } from '../js/editor/inline.js'
import { analyzeLibrary, membersOfRef } from '../js/editor/extlib.js'
import { normalizeUrl, shortUrl } from '../js/luau/remote.js'
setRobloxApi(JSON.parse(readFileSync(new URL('../data/roblox-api.json', import.meta.url), 'utf8')))

let pass = 0, fail = 0
const eq = (name, got, want) => { if (got === want) pass++; else { fail++; console.log(`✕ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`) } }

// 小さな UI ライブラリ (よくある書き方をまとめたもの)
const LIB = `
local Library = { Flags = {}, Options = {} }
local Templates = { Toggle = { Text = "Toggle", Default = false, Callback = function(Value) end } }
local function Validate(Info, Template) return Info end

local Elements = {}
-- トグルを追加します
function Elements:AddToggle(Idx, Info)
  Info = Validate(Info, Templates.Toggle)
  local Toggle = { Value = Info.Default }
  function Toggle:SetValue(v) self.Value = v end
  function Toggle:OnChanged(fn) end
  Library.Options[Idx] = Toggle
  return Toggle
end
function Elements:AddButton(Text, Callback) end

-- ウィンドウを作ります
function Library:CreateWindow(Config)
  Config.Title = Config.Title or "Window"
  local Window = {}
  function Window:AddTab(Name)
    local Tab = {}
    function Tab:AddGroupbox(Name)
      local Groupbox = {}
      for k, v in pairs(Elements) do Groupbox[k] = v end
      return Groupbox
    end
    return Tab
  end
  return Window
end
return Library
`
const api = analyzeLibrary(LIB)
api.lib = 'TestLib'
const root = membersOfRef(api, api.root)
eq('root members', [...root.keys()].sort().join(','), 'CreateWindow,Flags,Options')
const cw = root.get('CreateWindow')
eq('CreateWindow doc', cw.doc, 'ウィンドウを作ります')
eq('CreateWindow opts from usage', cw.opts && cw.opts[0][1].map(x => x[0]).join(','), 'Title')
const win = membersOfRef(api, cw.ret)
const tab = membersOfRef(api, win.get('AddTab').ret)
const gb = membersOfRef(api, tab.get('AddGroupbox').ret)
eq('inherited via pairs copy', [...gb.keys()].sort().join(','), 'AddButton,AddToggle')
const tg = gb.get('AddToggle')
eq('template keys', tg.opts.find(o => o[0] === 1)[1].map(x => x[0]).join(','), 'Text,Default,Callback')
eq('template callback params', tg.opts.find(o => o[0] === 1)[1].find(x => x[0] === 'Callback')[3].join(','), 'Value')

// ---- エディタとの連携 ----
const URL_ = 'https://raw.githubusercontent.com/me/TestLib/main/Library.lua'
intel.executor = true
intel.extLib = u => (normalizeUrl(u) === URL_ ? api : null)
const HEAD = 'local repo = "https://raw.githubusercontent.com/me/TestLib/main/"\nlocal Library = loadstring(game:HttpGet(repo .. "Library.lua"))()\n'
const st = doc => { const pos = doc.indexOf('|'); return [EditorState.create({ doc: doc.replace('|', ''), selection: EditorSelection.cursor(pos), extensions: [luauLanguage, indentUnit.of('\t')] }), pos] }
const ghost = doc => { const [s, p] = st(doc); const r = luauLocalSuggest(s, p, 'executor'); return r && r.text }
const comp = doc => { const [s, p] = st(doc); const r = luauCompletionSource(new CompletionContext(s, p, true)); return r ? r.options.map(o => o.label) : [] }

eq('scan urls', scanLoadstringUrls(HEAD).join(), URL_)
eq('resolve concat', resolveStringExpr('repo .. "x.lua"', { text: HEAD, pos: HEAD.length }), 'https://raw.githubusercontent.com/me/TestLib/main/x.lua')
eq('ghost: local Window =', ghost(HEAD + 'local Window = |'), 'Library:CreateWindow({\n\tTitle = "Title",\n})')
eq('ghost: local Tab =', ghost(HEAD + 'local Window = Library:CreateWindow({})\nlocal Tab = |'), 'Window:AddTab("Name")')
eq('ghost: method args', ghost(HEAD + 'local W = Library:CreateWindow({})\nlocal T = W:AddTab("a")\nlocal G = T:AddGroupbox("g")\nG:AddToggle(|'), '"Idx", {\n\tText = "Toggle",\n\tDefault = false,\n\tCallback = function(Value)\n\t\t\n\tend,\n})')
eq('completion: methods', comp(HEAD + 'local W = Library:CreateWindow({})\nW:|').includes('AddTab'), true)
eq('completion: table keys', comp(HEAD + 'local W = Library:CreateWindow({})\nlocal T = W:AddTab("a")\nlocal G = T:AddGroupbox("g")\nG:AddToggle("x", {\n\tText = "a",\n\t|').join(','), 'Default,Callback')
eq('completion: Options[Idx] members', comp(HEAD + 'local Options = Library.Options\nOptions.MyToggle:|').includes('SetValue'), true)
{
  const [s] = st(HEAD + 'local W = Library:CreateWindow({})\nW:AddTab("x")|')
  const pos = s.doc.toString().indexOf('AddTab') + 2
  const d = describeAt(s, pos)
  eq('hover shows library', d && d.title, 'TestLib:AddTab(Name)')
}

// ---- URL ----
eq('github blob → raw', normalizeUrl('https://github.com/a/b/blob/main/x.lua'), 'https://raw.githubusercontent.com/a/b/main/x.lua')
eq('pastebin → raw', normalizeUrl('https://pastebin.com/AbCd1234'), 'https://pastebin.com/raw/AbCd1234')
eq('gist → raw', normalizeUrl('https://gist.github.com/me/0123abcd'), 'https://gist.githubusercontent.com/me/0123abcd/raw')
eq('short url', shortUrl('https://raw.githubusercontent.com/deividcomsono/Obsidian/refs/heads/main/Library.lua'), 'deividcomsono/Obsidian/Library.lua')

// ---- 解析できないソースでも落ちない ----
let threw = false
try { analyzeLibrary('local x = (function() return {} end)()\nreturn setmetatable({}, { __index = x })') } catch { threw = true }
eq('odd source does not throw', threw, false)

console.log(`extlib: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
