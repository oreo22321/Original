// Luau の賢い補完・ホバー・シグネチャヘルプ
// テキストから変数の型を推論し (例: local Players = game:GetService("Players") → Players クラス)、
// Roblox API のメンバーを候補に出します。
import * as db from './apidb.js'
import { LUAU_GLOBALS, LUAU_LIBS, ROBLOX_DATATYPES, RESULT_TYPES, SERVICE_DOCS, LUAU_KEYWORDS, LUAU_TYPES } from '../data/luau-api.js'
import { parseEntries } from '../data/luau-api.js'
import { EXECUTOR_GLOBALS, EXECUTOR_LIBS, DRAWING_PROPS, DRAWING_KINDS, EXECUTOR_GAME_METHODS, EXECUTOR_OBJECTS, EXECUTOR_POPULAR, REQUEST_OPTIONS, METAMETHODS, HASH_ALGORITHMS } from '../data/executor-api.js'
import { LUAU_SNIPPETS } from '../data/snippets.js'
import { snippet, snippetCompletion, syntaxTree } from '../../vendor/codemirror.js'
import { scanBlocks } from './blocks.js'
import { membersOfRef, indexRef, sigOf } from './extlib.js'
import { textIndex } from './luau-index.js'

// executor: エグゼキューター API を補完に含めるか (プロジェクトのモードで切り替え)
// moduleSource: require したモジュールのソースを返す関数 (アプリ側が設定。名前 → テキスト)
// extLib: loadstring で読み込むライブラリの API を返す関数 (URL → 解析結果。未取得なら null を返して取得を始める)
export const intel = { executor: true, roblox: true, snippets: true, moduleSource: null, extLib: null }

// データ型の定義 (戻り値だけの型も含む)
const DT = n => ROBLOX_DATATYPES[n] || RESULT_TYPES[n]
const DRAWING_ENTRIES = {}
for (const k of DRAWING_KINDS) DRAWING_ENTRIES[k] = parseEntries([...DRAWING_PROPS[k], ...DRAWING_PROPS.common])

// 文書全体のテキスト (同じ文書なら同じ文字列を返すので、宣言の検索結果を使い回せます)
let lastDoc = null, lastText = ''
export function docText(state) {
  if (state.doc !== lastDoc) { lastDoc = state.doc; lastText = state.doc.toString() }
  return lastText
}

const POPULAR = new Set(['Name', 'Parent', 'FindFirstChild', 'WaitForChild', 'GetChildren', 'GetDescendants', 'Destroy', 'Clone', 'IsA', 'FindFirstChildOfClass', 'Connect', 'Position', 'CFrame', 'Size', 'Anchored', 'Transparency', 'Color', 'Character', 'LocalPlayer', 'Humanoid', 'Health', 'WalkSpeed', 'JumpPower', 'Touched', 'PlayerAdded', 'Value', 'Text', 'Visible', 'GetService', 'GetPlayers', 'Create', 'Play', 'Heartbeat', 'InputBegan', 'Fire', 'FireServer', 'OnServerEvent', 'Activated', 'MouseButton1Click', 'SetAttribute', 'GetAttribute', 'Magnitude', 'LookVector', 'X', 'Y', 'Z'])

// よく使う子オブジェクト名 → クラス
const CHILD_HINTS = {
  Humanoid: 'Humanoid', HumanoidRootPart: 'Part', Head: 'Part', Torso: 'Part', UpperTorso: 'MeshPart', LowerTorso: 'MeshPart',
  'Left Arm': 'Part', 'Right Arm': 'Part', 'Left Leg': 'Part', 'Right Leg': 'Part', leaderstats: 'Folder', Backpack: 'Backpack',
  PlayerGui: 'PlayerGui', PlayerScripts: 'PlayerScripts', Animator: 'Animator', Terrain: 'Terrain', Camera: 'Camera', Baseplate: 'Part',
  RemoteEvent: 'RemoteEvent', RemoteFunction: 'RemoteFunction', Remotes: 'Folder', Events: 'Folder', Modules: 'Folder',
}
const CHILD_SUGGEST = {
  DataModel: null, // サービス一覧
  Players: ['LocalPlayer'],
  Player: ['Character', 'Backpack', 'PlayerGui', 'PlayerScripts', 'leaderstats', 'StarterGear'],
  Model: ['Humanoid', 'HumanoidRootPart', 'Head', 'UpperTorso', 'LowerTorso', 'PrimaryPart'],
  Workspace: ['Terrain', 'CurrentCamera', 'Baseplate', 'SpawnLocation'],
  Humanoid: ['Animator'],
}

// ============================================================
// 式のチェーン解析
// ============================================================
function matchClose(s, i) {
  const open = s[i], close = open === '(' ? ')' : open === '[' ? ']' : '}'
  let d = 0
  for (let j = i; j < s.length; j++) {
    const c = s[j]
    if (c === '"' || c === "'") { const q = c; j++; while (j < s.length && s[j] !== q) { if (s[j] === '\\') j++; j++ } continue }
    if (c === open) d++
    else if (c === close) { d--; if (d === 0) return j }
  }
  return s.length
}

// end の直前にある式 (a.b:c("x").d など) を取り出す
export function chainBefore(text, end) {
  let i = end - 1
  while (i >= 0) {
    const ch = text[i]
    if (ch === ')' || ch === ']') {
      let d = 0
      for (; i >= 0; i--) {
        const c = text[i]
        if (c === '"' || c === "'") { const q = c; i--; while (i >= 0 && text[i] !== q) i--; continue }
        if (c === ')' || c === ']') d++
        else if (c === '(' || c === '[') { d--; if (d === 0) break }
      }
      i--
      continue
    }
    if (/\w/.test(ch)) { i--; continue }
    if (ch === '.' || ch === ':') {
      if (text[i - 1] === '.' || text[i - 1] === ':') break
      i--
      continue
    }
    if (ch === '"' || ch === "'") {
      const q = ch
      i--
      while (i >= 0 && text[i] !== q) i--
      i--
      continue
    }
    break
  }
  return text.slice(i + 1, end)
}

export function parseChain(s) {
  let i = 0
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++ }
  const name = () => { const m = /^[A-Za-z_]\w*/.exec(s.slice(i)); if (m) { i += m[0].length; return m[0] } return null }
  ws()
  let root
  const n = name()
  if (n) root = { t: 'name', name: n }
  else if (s[i] === '"' || s[i] === "'") {
    const q = s[i]
    let j = i + 1
    while (j < s.length && s[j] !== q) { if (s[j] === '\\') j++; j++ }
    root = { t: 'string', value: s.slice(i + 1, j) }
    i = j + 1
  } else if (s[i] === '`') {
    const j = s.indexOf('`', i + 1)
    root = { t: 'string' }
    i = j < 0 ? s.length : j + 1
  } else if (s[i] === '(') {
    const j = matchClose(s, i)
    root = { t: 'paren', inner: s.slice(i + 1, j) }
    i = j + 1
  } else if (s[i] === '{') {
    const j = matchClose(s, i)
    root = { t: 'table' }
    i = j + 1
  } else if (/\d/.test(s[i] || '')) {
    root = { t: 'number' }
    i = s.length
  } else return null
  const steps = []
  for (;;) {
    ws()
    if (i >= s.length) break
    const c = s[i]
    if (c === '.' && s[i + 1] !== '.') {
      i++; ws()
      steps.push({ op: '.', name: name() || '' })
    } else if (c === ':' && s[i + 1] !== ':') {
      i++; ws()
      const st = { op: ':', name: name() || '', args: null }
      ws()
      if (s[i] === '(') { const j = matchClose(s, i); st.args = db.splitTop(s.slice(i + 1, j)).map(a => a.trim()); i = j + 1 }
      else if (s[i] === '"' || s[i] === "'") { const q = s[i]; const j = s.indexOf(q, i + 1); st.args = [s.slice(i, j + 1)]; i = j + 1 }
      steps.push(st)
    } else if (c === '(') {
      const j = matchClose(s, i)
      steps.push({ op: 'call', args: db.splitTop(s.slice(i + 1, j)).map(a => a.trim()) })
      i = j + 1
    } else if (c === '"' || c === "'") {
      const q = c; const j = s.indexOf(q, i + 1)
      steps.push({ op: 'call', args: [s.slice(i, j < 0 ? s.length : j + 1)] })
      i = j < 0 ? s.length : j + 1
    } else if (c === '[') {
      const j = matchClose(s, i)
      steps.push({ op: '[]', key: s.slice(i + 1, j) })
      i = j + 1
    } else break
  }
  return { root, steps, rest: s.slice(i) }
}

const strArg = a => { const m = a && /^["'](.*)["']$/.exec(a.trim()); return m ? m[1] : null }

// ============================================================
// 型
// ============================================================
export function fromTypeName(t, text) {
  if (!t) return null
  t = t.trim().replace(/\?$/, '').replace(/^\((.*)\)$/, '$1').trim()
  if (t.startsWith('Enum.')) return { k: 'enumItem', enum: t.slice(5) }
  // A | B → A (nil との組み合わせ T | nil もここで)
  if (/\|/.test(t) && !/[({]/.test(t)) { const first = t.split('|').map(s => s.trim()).find(s => s && s !== 'nil'); return first ? fromTypeName(first, text) : null }
  switch (t) {
    case 'string': case 'Content': case 'ContentId': return { k: 'string' }
    case 'number': case 'int': case 'int64': case 'float': case 'double': return { k: 'number' }
    case 'bool': case 'boolean': return { k: 'bool' }
    case 'Instances': case 'Objects': case '{Instance}': return { k: 'classArray', name: 'Instance' }
    case 'RBXScriptSignal': return { k: 'signal', params: [] }
    case 'RBXScriptConnection': return { k: 'conn' }
    case 'buffer': return { k: 'lib', name: 'buffer' }
  }
  // {Player} / { Player } / {[string]: Player} (反復したときの値の型)
  const arr = /^\{\s*(?:\[\s*\w+\s*\]\s*:\s*)?(\w+)\s*\}$/.exec(t)
  if (arr && db.isClass(arr[1])) return { k: 'classArray', name: arr[1] }
  if (db.isClass(t)) return { k: 'class', name: t }
  if (ROBLOX_DATATYPES[t] || RESULT_TYPES[t]) return { k: 'dt', name: t }
  if (t === 'Drawing') return { k: 'drawing', name: 'Line' }
  if (t === 'Vector2' || t === 'Color3') return { k: 'dt', name: t }
  if (/^\{/.test(t)) return typedTable(t, text, null)
  // type Name = { ... } で定義した型
  if (text && /^[A-Za-z_]\w*$/.test(t)) return aliasType(t, text)
  return null
}

// ---- type 定義 (type Foo = { name: string, part: BasePart }) ----
const aliasCache = { text: null, map: new Map() }
function aliasType(name, text, depth = 0) {
  if (aliasCache.text !== text) { aliasCache.text = text; aliasCache.map = new Map() }
  if (aliasCache.map.has(name)) return aliasCache.map.get(name)
  aliasCache.map.set(name, null)
  let ty = null
  const s = textIndex(text).typeBody(name)
  if (s !== null && depth < 4) {
    const body = text.slice(s, s + 4000).trimStart()
    if (body.startsWith('{')) ty = typedTable(body.slice(0, matchClose(body, 0) + 1), text, name)
    else {
      const m = /^([A-Za-z_][\w.]*)/.exec(body)
      if (m) ty = fromTypeName(m[1], m[1] === name ? null : text)
    }
  }
  aliasCache.map.set(name, ty)
  return ty
}
function typedTable(src, text, name) {
  const inner = src.trim().slice(1, -1)
  const fields = new Map()
  for (const part of db.splitTop(inner.replace(/;/g, ','))) {
    const m = /^\s*([A-Za-z_]\w*)\s*:\s*([\s\S]+?)\s*$/.exec(part)
    if (m) fields.set(m[1], m[2])
  }
  if (!fields.size) {
    const el = /^\s*(?:\[\s*\w+\s*\]\s*:\s*)?([A-Za-z_]\w*)\s*$/.exec(inner)
    if (el && db.isClass(el[1])) return { k: 'classArray', name: el[1] }
    return null
  }
  return { k: 'typed', name: name || 'table', fields, text }
}
// 関数型 "(a: number) -> Player" の戻り値
const fnTypeRet = t => { const i = t.lastIndexOf('->'); return i >= 0 ? t.slice(i + 2).trim() : null }
const typedEntry = (name, t) => (/->/.test(t) ? { kind: 'function', sig: t.replace(/\s*->\s*([^)]*)$/, ': $1').replace(/\(\s*self\s*(?::\s*[^,)]*)?\s*,?\s*/, '('), doc: '型定義のメソッド' } : { kind: 'value', type: t, doc: '型定義のフィールド' })

export function typeLabel(ty) {
  if (!ty) return 'any'
  switch (ty.k) {
    case 'class': return ty.name
    case 'classArray': return `{${ty.name}}`
    case 'dt': return ty.name
    case 'dtlib': return ty.name
    case 'lib': return ty.name
    case 'enumRoot': return 'Enums'
    case 'enum': return 'Enum.' + ty.name
    case 'enumItem': return 'Enum.' + ty.enum
    case 'signal': return 'RBXScriptSignal'
    case 'conn': return 'RBXScriptConnection'
    case 'drawing': return 'Drawing.' + ty.name
    case 'execobj': return ty.name
    case 'execArray': return `{${ty.name}}`
    case 'usertable': return ty.module || ty.name
    case 'ext': return ty.lib
    case 'typed': return ty.name
    case 'shared': return ty.name === 'genv' ? 'getgenv()' : ty.name
    case 'bool': return 'boolean'
    default: return ty.k
  }
}

// ============================================================
// 宣言の検索 (索引から。スコープを考慮し、書きかけのコードでも動作)
// ============================================================
function findDecl(text, name, before) {
  return textIndex(text).find(name, before)
}
// lint 用: pos から見える name の宣言位置 (なければ -1)
export function declPos(text, name, before) {
  const d = findDecl(text, name, before)
  return d ? d.pos : -1
}
const lineEndAt = (text, p) => { const i = text.indexOf('\n', p); return i < 0 ? text.length : i }

// ---- 自分で書いた関数の戻り値の型 (戻り値の型注釈、なければ return の式から) ----
const retCache = { text: null, map: new Map() }
export function fnReturnType(text, fnPos, depth = 0) {
  if (fnPos === undefined || fnPos === null || depth > 7 || !text) return null
  if (retCache.text !== text) { retCache.text = text; retCache.map = new Map() }
  if (retCache.map.has(fnPos)) return retCache.map.get(fnPos)
  retCache.map.set(fnPos, null) // 再帰の防止
  const ix = textIndex(text)
  let ty = null
  const b = ix.blockAt(fnPos)
  if (b && b.headerEnd !== undefined) {
    const m = /^\s*:\s*(\{[^}\n]*\}|[A-Za-z_][\w.]*(?:<[^>\n]*>)?\??)/.exec(text.slice(b.headerEnd, b.headerEnd + 200))
    if (m) ty = fromTypeName(m[1], text)
  }
  if (!ty) {
    for (const rp of ix.returnsOf(fnPos)) {
      let e = text.slice(rp, lineEndAt(text, rp)).replace(/--.*$/, '').trim()
      e = e.replace(/;?\s*\b(?:end|else|elseif)\b[\s\S]*$/, '').replace(/;\s*$/, '').trim()
      if (!e) continue
      ty = exprType(e, { text, pos: rp, index: 0 }, depth + 1)
      if (ty) break
    }
  }
  retCache.map.set(fnPos, ty)
  return ty
}

// ---- if x:IsA("BasePart") then ... の中では x は BasePart ----
function narrowed(text, name, pos) {
  const ix = textIndex(text)
  if (!ix.hasIsA || !/^[A-Za-z_]\w*$/.test(name)) return null
  const isA = new RegExp(`(?:^|[^\\w.:])(not\\s+)?${name}\\s*:\\s*IsA\\s*\\(\\s*["'](\\w+)["']\\s*\\)|(?:^|[^\\w.:])${name}\\s*\\.\\s*ClassName\\s*==\\s*["'](\\w+)["']`)
  for (const b of ix.enclosing(pos, 12, 400)) {
    if (b.kind !== 'if' || b.headerEnd === undefined || pos < b.headerEnd) continue
    if (b.mids && b.mids.some(m => m > b.headerEnd && m < pos)) continue
    const cond = text.slice(b.s, b.headerEnd)
    if (/\bor\b/.test(cond)) continue
    const m = isA.exec(cond)
    const cls = m && !m[1] ? m[2] || m[3] : null
    if (cls && db.isClass(cls)) return { k: 'class', name: cls }
  }
  // ガード節: if not x:IsA("Part") then return end の後ろ
  const scope = ix.enclosing(pos, 1, 400)[0]
  const from = Math.max(scope ? scope.s : 0, pos - 20000)
  const seg = text.slice(from, pos)
  if (!seg.includes('IsA')) return null
  const gre = new RegExp(`\\bif\\s+not\\s+${name}\\s*:\\s*IsA\\s*\\(\\s*["'](\\w+)["']\\s*\\)\\s*then\\s+(?:return|continue|break)\\b`, 'g')
  let g, last = null
  while ((g = gre.exec(seg))) last = g
  return last && db.isClass(last[1]) ? { k: 'class', name: last[1] } : null
}

// ============================================================
// テーブルの中身 (local M = { a = 1 } / function M.foo() / M.bar = ...)
// ============================================================
const fieldCache = { text: '', byName: new Map() }
const DEF_DOC = 'このファイルで定義'
// テーブルリテラルの中身: Map(キー → 項目)。base はテキスト内での body の開始位置
function keysOfTableLiteral(body, base = 0) {
  // 関数の本体や入れ子のテーブルの中は数えない
  const out = new Map()
  const { tokens } = scanBlocks(body)
  let depth = 0, block = 0, prev = null
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.t === '(' || t.t === '{' || t.t === '[') depth++
    else if (t.t === ')' || t.t === '}' || t.t === ']') depth--
    if (t.role === 'open') block++
    else if (t.role === 'close') block--
    else if (depth === 0 && block === 0 && t.t === 'name' && (!prev || prev.t === ',' || prev.t === ';') && tokens[i + 1] && tokens[i + 1].t === '=') {
      const nx = tokens[i + 2]
      let sig = null
      if (nx && nx.t === 'function') { const m = /^function\s*(\([^)]*\))/.exec(body.slice(nx.s)); sig = m ? m[1] : '()' }
      if (sig) out.set(body.slice(t.s, t.e), { kind: 'function', sig, doc: DEF_DOC, fnPos: base + nx.s })
      else {
        // 値の式 (次の , まで)
        let d = 0, b2 = 0, j = i + 2
        for (; j < tokens.length; j++) {
          const u = tokens[j]
          if (u.t === '(' || u.t === '{' || u.t === '[') d++
          else if (u.t === ')' || u.t === '}' || u.t === ']') { if (d === 0) break; d-- }
          if (u.role === 'open') b2++
          else if (u.role === 'close') b2--
          else if (d === 0 && b2 === 0 && (u.t === ',' || u.t === ';')) break
        }
        const exprEnd = j < tokens.length ? tokens[j].s : body.length
        const expr = nx ? body.slice(nx.s, Math.min(exprEnd, nx.s + 600)).trim() : ''
        out.set(body.slice(t.s, t.e), { kind: 'value', type: valueKind(body, nx), doc: DEF_DOC, expr, pos: base + (nx ? nx.s : t.s) })
      }
    }
    prev = t
  }
  return out
}
function valueKind(text, tok) {
  if (!tok) return 'any'
  if (tok.t === 'str') return 'string'
  if (tok.t === 'num') return 'number'
  if (tok.t === 'true' || tok.t === 'false') return 'boolean'
  if (tok.t === '{') return 'table'
  return 'any'
}
const exprKind = e => (/^["'`]|^\[=*\[/.test(e) ? 'string' : /^-?\.?\d/.test(e) ? 'number' : /^(true|false)\b/.test(e) ? 'boolean' : /^\{/.test(e) ? 'table' : 'any')
// 返り値: Map(フィールド名 → { kind, sig?, type?, doc, colon?, fnPos?, expr?, pos? })
export function tableFields(text, name) {
  if (fieldCache.text !== text) { fieldCache.text = text; fieldCache.byName = new Map() }
  let fields = fieldCache.byName.get(name)
  if (fields) return fields
  fields = new Map()
  const esc = name.replace(/[$.]/g, '\\$&')
  let re = new RegExp(`(?:^|[^.\\w])${esc}\\s*=\\s*(?:setmetatable\\s*\\(\\s*)?\\{`, 'g')
  let m
  while ((m = re.exec(text))) {
    const start = text.indexOf('{', m.index + m[0].length - 1)
    const end = matchClose(text, start)
    for (const [k, v] of keysOfTableLiteral(text.slice(start + 1, end), start + 1)) fields.set(k, v)
  }
  re = new RegExp(`\\bfunction\\s+${esc}\\s*([.:])\\s*([A-Za-z_]\\w*)\\s*(?:<[^>]*>)?\\s*(\\([^)]*\\))`, 'g')
  while ((m = re.exec(text))) fields.set(m[2], { kind: 'function', sig: m[3], doc: DEF_DOC, colon: m[1] === ':', fnPos: m.index })
  re = new RegExp(`(?:^|[^.\\w])${esc}\\s*\\.\\s*([A-Za-z_]\\w*)\\s*=(?!=)\\s*(function\\s*(\\([^)]*\\)))?`, 'g')
  while ((m = re.exec(text))) {
    if (fields.has(m[1]) && !m[2]) continue
    if (m[2]) fields.set(m[1], { kind: 'function', sig: m[3], doc: DEF_DOC, fnPos: m.index + m[0].lastIndexOf('function') })
    else { const vs = m.index + m[0].length; const expr = text.slice(vs, lineEndAt(text, vs)).trim(); fields.set(m[1], { kind: 'value', type: exprKind(expr), doc: DEF_DOC, expr, pos: vs }) }
  }
  // クラスのメソッドの中の self.X = ... (インスタンスのフィールド)
  for (const sa of textIndex(text).selfAssigns(name)) {
    if (fields.has(sa.field)) continue
    if (/^function\b/.test(sa.expr)) { const fm = /^function\s*(\([^)]*\))/.exec(sa.expr); fields.set(sa.field, { kind: 'function', sig: fm ? fm[1] : '()', doc: 'self のフィールド', fnPos: text.indexOf('function', sa.pos) }) }
    else fields.set(sa.field, { kind: 'value', type: exprKind(sa.expr), doc: 'self のフィールド', expr: sa.expr, pos: sa.pos })
  }
  fieldCache.byName.set(name, fields)
  return fields
}
// getgenv().X = ... / _G.X = ... で作った共有の値
function sharedFields(text, root) {
  const key = '\u0000' + root
  if (fieldCache.text !== text) { fieldCache.text = text; fieldCache.byName = new Map() }
  let fields = fieldCache.byName.get(key)
  if (fields) return fields
  fields = new Map()
  const head = root === 'genv' ? 'getgenv\\s*\\(\\s*\\)' : root
  const re = new RegExp(`${head}\\s*(?:\\.\\s*([A-Za-z_]\\w*)|\\[\\s*["']([A-Za-z_]\\w*)["']\\s*\\])\\s*=(?!=)\\s*(function\\s*(\\([^)]*\\)))?`, 'g')
  let m
  while ((m = re.exec(text))) fields.set(m[1] || m[2], m[3] ? { kind: 'function', sig: m[4], doc: 'このファイルで定義' } : { kind: 'value', type: 'any', doc: 'このファイルで定義' })
  fieldCache.byName.set(key, fields)
  return fields
}
// require したモジュールが返すテーブル
function moduleType(expr) {
  if (!intel.moduleSource) return null
  const m = /\brequire\s*\(?\s*([^)\n]+)\)?/.exec(expr)
  if (!m) return null
  const spec = m[1].trim()
  const sm = /^["']([^"']+)["']$/.exec(spec)
  const name = sm ? sm[1].replace(/\\/g, '/').split('/').pop().replace(/\.luau?$/, '') : (/([A-Za-z_]\w*)\s*$/.exec(spec.replace(/\)\s*$/, '').replace(/:WaitForChild\(\s*["'](\w+)["']\s*$/, '.$1')) || [])[1]
  if (!name) return null
  const src = intel.moduleSource(name)
  if (!src) return null
  const rm = /\breturn\s+([A-Za-z_]\w*)\s*$/.exec(src.replace(/\s+$/, ''))
  if (rm) return { k: 'usertable', name: rm[1], text: src, module: name }
  return null
}

// ============================================================
// 外部ライブラリ: loadstring(game:HttpGet(URL))()
// ============================================================
const LOADSTRING_RE = /^loadstring\s*\(\s*game\s*[:.]\s*HttpGet(?:Async)?\s*\(\s*(?:game\s*,\s*)?([\s\S]+?)\s*(?:,\s*(?:true|false)\s*)?\)\s*(?:,\s*[^()]*)?\)\s*\(\s*\)\s*$/
// 文字列の式 ("a" .. b .. "c") を、ローカル変数の値もたどって 1 つの文字列にする
export function resolveStringExpr(expr, ctx, depth = 0) {
  if (!expr || depth > 6) return null
  const parts = []
  let cur = '', q = null, d = 0
  const e = expr.trim()
  for (let i = 0; i < e.length; i++) {
    const c = e[i]
    if (q) { cur += c; if (c === '\\') { cur += e[++i] || ''; continue } if (c === q) q = null; continue }
    if (c === '"' || c === "'") { q = c; cur += c; continue }
    if (c === '(') d++
    else if (c === ')') d--
    if (d === 0 && c === '.' && e[i + 1] === '.') { parts.push(cur); cur = ''; i++; continue }
    cur += c
  }
  parts.push(cur)
  let out = ''
  for (let p of parts) {
    p = p.trim()
    while (/^\(([\s\S]*)\)$/.test(p)) p = p.slice(1, -1).trim()
    let m
    if ((m = /^"((?:[^"\\]|\\.)*)"$/.exec(p)) || (m = /^'((?:[^'\\]|\\.)*)'$/.exec(p))) out += m[1].replace(/\\(.)/g, '$1')
    else if ((m = /^\[(=*)\[([\s\S]*)\]\1\]$/.exec(p))) out += m[2]
    else if (/^[A-Za-z_]\w*$/.test(p) && ctx.text) {
      const decl = findDecl(ctx.text, p, ctx.pos)
      if (!decl || !decl.expr) return null
      const v = resolveStringExpr(decl.expr, { ...ctx, pos: decl.pos }, depth + 1)
      if (v === null) return null
      out += v
    } else return null
  }
  return out
}
export function loadstringUrl(expr, ctx) {
  const m = LOADSTRING_RE.exec(expr.trim())
  if (!m) return null
  const url = resolveStringExpr(m[1], ctx)
  return url && /^https?:\/\//.test(url) ? url : null
}
function loadstringType(e, ctx, depth) {
  if (!intel.extLib) return null
  const url = loadstringUrl(e, ctx)
  if (!url) return null
  const api = intel.extLib(url)
  if (!api || api.root === null || api.root === undefined) return null
  void depth
  return { k: 'ext', api, ref: api.root, lib: api.lib || 'ライブラリ' }
}
// このテキストの中の loadstring の URL (補完用に先に取得しておく)
export function scanLoadstringUrls(text) {
  const out = new Set()
  const re = /loadstring\s*\(\s*game\s*[:.]\s*HttpGet(?:Async)?\s*\(/g
  let m
  while ((m = re.exec(text)) && out.size < 12) {
    const open = text.indexOf('(', m.index)
    const close = matchClose(text, open)
    let end = close + 1
    const tail = /^\s*\(\s*\)/.exec(text.slice(end))
    if (!tail) continue
    end += tail[0].length
    const url = loadstringUrl(text.slice(m.index, end), { text, pos: m.index })
    if (url) out.add(url)
  }
  return [...out]
}
const baseOfKind = k => (k === 'string' ? { k: 'string' } : k === 'number' ? { k: 'number' } : k === 'boolean' ? { k: 'bool' } : null)
function extEntry(m, ty) {
  const doc = [m.doc, `📚 ${ty.lib}`].filter(Boolean).join('\n')
  return m.k === 'fn' ? { kind: 'function', sig: sigOf(m), doc } : { kind: 'value', type: m.ty === 'table' ? 'table' : m.ty, doc }
}
function extStep(ty, st) {
  const m = membersOfRef(ty.api, ty.ref).get(st.name)
  if (!m) {
    if (st.op !== '.') return null
    const ir = indexRef(ty.api, ty.ref)
    return ir ? { ...ty, ref: ir } : null
  }
  if (m.k === 'fn') {
    if (st.op === ':') return m.ret !== undefined ? { ...ty, ref: m.ret } : baseOfKind(m.rt)
    return { k: 'func', entry: { src: 'data', e: extEntry(m, ty) }, ext: { ty, m } }
  }
  if (m.ref !== undefined) return { ...ty, ref: m.ref }
  return baseOfKind(m.ty)
}

// 式テキストの型
function exprType(expr, ctx, depth) {
  if (!expr || depth > 8) return null
  let e = expr.replace(/--.*$/, '').trim()
  // 複数代入の index 番目
  if (ctx.index > 0) {
    const parts = db.splitTop(e)
    if (parts.length === 1) {
      // local a, b = f() → f が返す 2 番目の値
      const chain = parseChain(parts[0].trim())
      const ty = chain && resolveChain(chain, { ...ctx, index: 0, tuple: true }, depth + 1)
      return ty && ty.k === 'tuple' ? ty.items[ctx.index] || null : null
    }
    e = (parts[ctx.index] || '').trim()
    ctx = { ...ctx, index: 0 }
  } else {
    e = db.splitTop(e)[0] || e
  }
  // a or b → a (a が nil のこともあるので、a が分からなければ b)、a and b → b
  const orParts = splitKeyword(e, 'or')
  if (orParts.length > 1) {
    for (const part of orParts) { const t = exprType(part, ctx, depth + 1); if (t) return t }
    return null
  }
  const andParts = splitKeyword(e, 'and')
  if (andParts.length > 1) e = andParts[andParts.length - 1]
  e = e.trim()
  // x :: Type (型のキャスト)
  const cast = /^([\s\S]+?)\s*::\s*([\w.{}<>?\[\]: ]+)$/.exec(e)
  if (cast) { const t = fromTypeName(cast[2], ctx.text); if (t) return t; e = cast[1] }
  if (/^not\b/.test(e) || /^(true|false)\b/.test(e)) return { k: 'bool' }
  if (/^["'`]/.test(e) || /^\[=*\[/.test(e)) return { k: 'string' }
  if (/^#/.test(e) || /^-?\.?\d/.test(e)) return { k: 'number' }
  // setmetatable({}, Class) → Class のインスタンス
  let sm
  if ((sm = /^setmetatable\s*\(/.exec(e))) {
    const open = e.indexOf('(')
    const args = db.splitTop(e.slice(open + 1, matchClose(e, open))).map(a => a.trim())
    const cls = args[1] && /^[A-Za-z_][\w.]*$/.test(args[1]) ? args[1] : null
    if (cls && ctx.text && tableFields(ctx.text, cls).size) return { k: 'usertable', name: cls, text: ctx.text }
    return { k: 'table' }
  }
  if (/^\{/.test(e)) {
    // 配列 { a, b } の要素の型 (Instance なら {Instance} として反復できる)
    const close = matchClose(e, 0)
    const inner = e.slice(1, close).trim()
    if (inner && !/^[A-Za-z_]\w*\s*=[^=]|^\[/.test(inner)) {
      const first = db.splitTop(inner)[0]
      const t = first && exprType(first, ctx, depth + 1)
      if (t && t.k === 'class') return { k: 'classArray', name: t.name }
    }
    return { k: 'table' }
  }
  if (/^function\b/.test(e)) return { k: 'func' }
  if (/^require\b/.test(e)) return moduleType(e)
  if (/^loadstring\b/.test(e)) { const t = loadstringType(e, ctx, depth); if (t) return t }
  // if a then b else c (if 式) → b の型
  const ifm = /^if\b[\s\S]*?\bthen\b([\s\S]*?)\belse\b/.exec(e)
  if (ifm) return exprType(ifm[1], ctx, depth + 1)
  const chain = parseChain(e)
  if (!chain) return null
  const ty = resolveChain(chain, ctx, depth + 1)
  const rest = chain.rest.trim()
  if (ty && rest) {
    // 算術: Vector3 + Vector3 → Vector3、数値 → number、.. → string
    if (/^\.\./.test(rest)) return { k: 'string' }
    if (/^[+\-*/%^]/.test(rest)) return ty.k === 'dt' || ty.k === 'number' ? ty : null
    if (/^(==|~=|<=|>=|<|>)/.test(rest)) return { k: 'bool' }
  }
  return ty
}

function splitKeyword(s, kw) {
  const out = []
  let d = 0, last = 0
  const re = new RegExp(`\\b${kw}\\b`, 'g')
  let inStr = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) { if (c === inStr && s[i - 1] !== '\\') inStr = null; continue }
    if (c === '"' || c === "'") { inStr = c; continue }
    if ('([{'.includes(c)) d++
    else if (')]}'.includes(c)) d--
    else if (d === 0 && s.startsWith(kw, i) && !/\w/.test(s[i - 1] || '') && !/\w/.test(s[i + kw.length] || '')) {
      out.push(s.slice(last, i)); last = i + kw.length; i += kw.length - 1
    }
  }
  out.push(s.slice(last))
  void re
  return out
}

function nameType(name, ctx, depth) {
  // ローカル変数・グローバル代入
  if (ctx.text) {
    const d = findDecl(ctx.text, name, ctx.pos)
    if (d) {
      const t = declType(d, name, ctx, depth)
      // if x:IsA("Part") then の中などでは型を絞り込む
      if ((!t || t.k === 'class') && d.kind !== 'func') { const n = narrowed(ctx.text, name, ctx.pos); if (n) return n }
      if (t !== undefined) return t
    } else if (/^[a-z]/i.test(name)) {
      const n = narrowed(ctx.text, name, ctx.pos)
      if (n) return n
    }
  }
  switch (name) {
    case 'game': case 'Game': return { k: 'class', name: 'DataModel' }
    case 'workspace': case 'Workspace': return { k: 'class', name: 'Workspace' }
    case 'script': return { k: 'class', name: 'Script' }
    case 'Enum': return { k: 'enumRoot' }
    case 'plugin': return { k: 'class', name: 'Plugin' }
  }
  if (LUAU_LIBS[name]) return { k: 'lib', name }
  if (intel.executor && EXECUTOR_LIBS[name]) return { k: 'lib', name }
  if (ROBLOX_DATATYPES[name]) return { k: 'dtlib', name }
  if (name === '_G' || name === 'shared') return { k: 'shared', name }
  return null
}

const userFnEntry = (sig, doc = 'このファイルで定義した関数') => ({ src: 'data', e: { kind: 'function', sig: sig || '()', doc } })
// 宣言から型を求める (undefined: 分からないのでグローバルとして調べ続ける)
function declType(d, name, ctx, depth) {
  if (d.anno) { const t = fromTypeName(d.anno.trim(), ctx.text); if (t) return t }
  if (d.kind === 'local' || d.kind === 'assign') {
    const part = d.index > 0 ? (db.splitTop(d.expr || '')[d.index] || '') : (d.expr || '')
    if (/^\s*function\b/.test(part) && d.index === 0) {
      const fnPos = ctx.text.indexOf('function', d.at)
      const pm = /^\s*function\s*(\([^)]*\))/.exec(part)
      return { k: 'func', entry: userFnEntry(pm ? pm[1] : '()'), user: true, fnPos: fnPos >= 0 ? fnPos : undefined, text: ctx.text }
    }
    const t = exprType(d.expr, { ...ctx, pos: d.pos, index: d.index || 0 }, depth)
    if (t && t.k === 'table') return { k: 'usertable', name, text: ctx.text }
    if (t) return t
    if (tableFields(ctx.text, name).size) return { k: 'usertable', name, text: ctx.text }
    return undefined
  }
  if (d.kind === 'forin') {
    if (d.index === 0) {
      // for i, v in ipairs(...) / for _, x in t → 数値 (キー)。pairs(dict) は文字列のこともある
      return /^\s*ipairs\b/.test(d.expr) || !/^\s*pairs\b/.test(d.expr) ? { k: 'number' } : null
    }
    const m = /^\s*i?pairs\s*\(([\s\S]*)\)\s*$/.exec(d.expr)
    const it = exprType(m ? m[1] : d.expr, { ...ctx, pos: d.pos, index: 0 }, depth)
    if (it && it.k === 'classArray') return { k: 'class', name: it.name }
    if (it && it.k === 'execArray') return { k: 'execobj', name: it.name }
    return null
  }
  if (d.kind === 'fornum') return { k: 'number' }
  if (d.kind === 'param') {
    if (d.signalExpr) {
      const sig = exprType(d.signalExpr, { ...ctx, pos: d.pos, index: 0 }, depth)
      if (sig && sig.k === 'signal' && sig.params[d.index]) return fromTypeName(sig.params[d.index])
    }
    if (d.hookArg === 0) return { k: 'class', name: 'Instance' }
    if (d.self) return { k: 'usertable', name: d.self, text: ctx.text }
    return null
  }
  if (d.kind === 'func') return { k: 'func', entry: userFnEntry(d.params), user: true, fnPos: d.fnPos, text: ctx.text }
  return undefined
}

function memberEntryOf(ty, name, op) {
  if (!ty) return null
  switch (ty.k) {
    case 'class': {
      const m = db.member(ty.name, name)
      if (m) return { src: 'api', m }
      if (ty.name === 'DataModel' && intel.executor && EXECUTOR_GAME_METHODS[name]) return { src: 'data', e: EXECUTOR_GAME_METHODS[name] }
      return null
    }
    case 'dtlib': return DT(ty.name).ctor[name] ? { src: 'data', e: DT(ty.name).ctor[name] } : null
    case 'dt': {
      const d = DT(ty.name)
      const e = op === ':' ? d.methods[name] : (d.props[name] || d.methods[name])
      return e ? { src: 'data', e } : null
    }
    case 'lib': {
      const e = (LUAU_LIBS[ty.name] && LUAU_LIBS[ty.name][name]) || (intel.executor && EXECUTOR_LIBS[ty.name] && EXECUTOR_LIBS[ty.name][name])
      return e ? { src: 'data', e } : null
    }
    case 'string': return LUAU_LIBS.string[name] ? { src: 'data', e: LUAU_LIBS.string[name] } : null
    case 'signal': return ROBLOX_DATATYPES.RBXScriptSignal.methods[name] ? { src: 'data', e: ROBLOX_DATATYPES.RBXScriptSignal.methods[name] } : null
    case 'conn': { const d = ROBLOX_DATATYPES.RBXScriptConnection; const e = d.methods[name] || d.props[name]; return e ? { src: 'data', e } : null }
    case 'enumItem': { const d = ROBLOX_DATATYPES.EnumItem; const e = d.props[name] || d.methods[name]; return e ? { src: 'data', e } : null }
    case 'enum': { const e = ROBLOX_DATATYPES.Enum.methods[name]; return e ? { src: 'data', e } : null }
    case 'usertable': { const e = userFields(ty).get(name); return e ? { src: 'data', e } : null }
    case 'typed': { const t = ty.fields.get(name); return t ? { src: 'data', e: typedEntry(name, t) } : null }
    case 'shared': { const e = sharedFields(ty.text || '', ty.name).get(name); return e ? { src: 'data', e } : null }
    case 'execobj': { const e = EXECUTOR_OBJECTS[ty.name][name]; return e ? { src: 'data', e } : null }
    case 'drawing': { const e = (DRAWING_ENTRIES[ty.name] || DRAWING_ENTRIES.Line)[name]; return e ? { src: 'data', e } : null }
    case 'ext': { const m = membersOfRef(ty.api, ty.ref).get(name); return m ? { src: 'data', e: extEntry(m, ty), ext: m } : null }
  }
  return null
}

// 型 ty が name というメンバーを持つか。判断できない型は null (lint の誤字検出用)
export function memberNamesOf(ty, op) {
  if (!ty) return null
  switch (ty.k) {
    case 'class': {
      const names = [...db.classMembers(ty.name).keys()]
      if (ty.name === 'DataModel') names.push(...Object.keys(EXECUTOR_GAME_METHODS), ...db.serviceNames())
      return names
    }
    case 'dtlib': return Object.keys(DT(ty.name).ctor)
    case 'dt': { const d = DT(ty.name); return op === ':' ? Object.keys(d.methods) : [...Object.keys(d.props), ...Object.keys(d.methods)] }
    case 'lib': return [...Object.keys(LUAU_LIBS[ty.name] || {}), ...Object.keys(EXECUTOR_LIBS[ty.name] || {})]
    case 'string': return op === ':' ? Object.keys(LUAU_LIBS.string) : null
    case 'signal': return Object.keys(ROBLOX_DATATYPES.RBXScriptSignal.methods)
    case 'conn': return [...Object.keys(ROBLOX_DATATYPES.RBXScriptConnection.methods), ...Object.keys(ROBLOX_DATATYPES.RBXScriptConnection.props)]
    case 'enumRoot': return db.enumNames()
    case 'enum': return [...(db.enumItems(ty.name) || []).map(i => i[0]), ...Object.keys(ROBLOX_DATATYPES.Enum.methods)]
    case 'enumItem': return [...Object.keys(ROBLOX_DATATYPES.EnumItem.props), ...Object.keys(ROBLOX_DATATYPES.EnumItem.methods)]
    case 'execobj': return Object.keys(EXECUTOR_OBJECTS[ty.name])
    case 'drawing': return Object.keys(DRAWING_ENTRIES[ty.name] || DRAWING_ENTRIES.Line)
  }
  return null
}

// 自作テーブルのフィールド (クラスなら self.X のフィールド、入れ子のテーブルリテラルも)
export function userFields(ty) {
  const base = tableFields(ty.text, ty.name)
  if (ty.litPos === undefined) return base
  const key = '\u0001' + ty.litPos
  if (fieldCache.text === ty.text && fieldCache.byName.has(key)) return fieldCache.byName.get(key)
  const close = matchClose(ty.text, ty.litPos)
  const merged = new Map([...keysOfTableLiteral(ty.text.slice(ty.litPos + 1, close), ty.litPos + 1), ...base])
  if (fieldCache.text === ty.text) fieldCache.byName.set(key, merged)
  return merged
}
// 値のフィールドの型 (式があれば推論)
function fieldValueType(e, name, text, depth) {
  if (e.expr && depth < 7) {
    if (/^\{/.test(e.expr) && e.pos !== undefined && text[e.pos] === '{') return { k: 'usertable', name, text, litPos: e.pos }
    const t = exprType(e.expr, { text, pos: e.pos !== undefined ? e.pos : text.length, index: 0 }, depth + 1)
    if (t && t.k === 'table') return { k: 'usertable', name, text }
    if (t) return t
  }
  return e.type === 'string' ? { k: 'string' } : e.type === 'number' ? { k: 'number' } : e.type === 'boolean' ? { k: 'bool' } : e.type === 'table' ? { k: 'usertable', name, text } : null
}

// 複数の値を返す関数 (local pos, onScreen = camera:WorldToViewportPoint(p))
const TUPLE_RETURNS = {
  WorldToViewportPoint: ['Vector3', 'bool'], WorldToScreenPoint: ['Vector3', 'bool'], GetBoundingBox: ['CFrame', 'Vector3'],
  FindPartOnRay: ['BasePart', 'Vector3', 'Vector3', 'Enum.Material'], FindPartOnRayWithIgnoreList: ['BasePart', 'Vector3', 'Vector3', 'Enum.Material'], FindPartOnRayWithWhitelist: ['BasePart', 'Vector3', 'Vector3', 'Enum.Material'],
  GetUserThumbnailAsync: ['string', 'bool'], GetAsync: ['any', 'DataStoreKeyInfo'], GetSortedAsync: ['DataStorePages'], GetMouseLocation: ['Vector2'],
}

function stepType(ty, st, ctx, depth) {
  if (!ty) return null
  if (ty.k === 'ext') {
    if (st.op === '.' || st.op === ':') return extStep(ty, st)
    if (st.op === '[]') { const ir = indexRef(ty.api, ty.ref); return ir ? { ...ty, ref: ir } : null }
    return null
  }
  if (st.op === 'call' && ty.k === 'func' && ty.ext) {
    const m = ty.ext.m
    return m.ret !== undefined ? { ...ty.ext.ty, ref: m.ret } : baseOfKind(m.rt)
  }
  if (st.op === '.') {
    const name = st.name
    switch (ty.k) {
      case 'class': {
        const m = db.member(ty.name, name)
        if (m) {
          if (m.kind === 'p') {
            if (name === 'LocalPlayer') return { k: 'class', name: 'Player' }
            if (name === 'Character') return { k: 'class', name: 'Model' }
            if (name === 'CurrentCamera') return { k: 'class', name: 'Camera' }
            return fromTypeName(m.type)
          }
          if (m.kind === 'e') return { k: 'signal', params: db.paramsOf(m.type).map(p => p.type) }
          if (m.kind === 'f') return { k: 'func', entry: { src: 'api', m } }
          return null
        }
        if (ty.name === 'DataModel' && db.isService(name)) return { k: 'class', name }
        if (CHILD_HINTS[name]) return { k: 'class', name: CHILD_HINTS[name] }
        if (db.isClass(name) && !db.isService(name)) return { k: 'class', name }
        return { k: 'class', name: 'Instance' }
      }
      case 'dtlib': {
        const e = DT(ty.name).ctor[name]
        if (!e) return null
        if (e.kind === 'value') return fromTypeName(e.type)
        return { k: 'func', entry: { src: 'data', e } }
      }
      case 'dt': {
        const e = DT(ty.name).props[name]
        return e ? fromTypeName(e.type) : null
      }
      case 'lib': {
        const e = (LUAU_LIBS[ty.name] && LUAU_LIBS[ty.name][name]) || (EXECUTOR_LIBS[ty.name] && EXECUTOR_LIBS[ty.name][name])
        if (!e) return null
        if (e.kind === 'value') return fromTypeName(e.type)
        return { k: 'func', entry: { src: 'data', e }, lib: ty.name, name }
      }
      case 'enumRoot': return db.enumItems(name) ? { k: 'enum', name } : null
      case 'enum': return { k: 'enumItem', enum: ty.name }
      case 'enumItem': return name === 'Name' ? { k: 'string' } : name === 'Value' ? { k: 'number' } : null
      case 'drawing': { const e = (DRAWING_ENTRIES[ty.name] || DRAWING_ENTRIES.Line)[name]; return e && e.kind === 'value' ? fromTypeName(e.type) : e ? { k: 'func', entry: { src: 'data', e } } : null }
      case 'execobj': {
        const e = EXECUTOR_OBJECTS[ty.name][name]
        if (!e) return null
        if (e.kind === 'function') return { k: 'func', entry: { src: 'data', e } }
        if (e.type === 'RBXScriptSignal') return { k: 'signal', params: name === 'OnMessage' ? ['string'] : [] }
        return fromTypeName(e.type)
      }
      case 'usertable': case 'shared': {
        const e = (ty.k === 'shared' ? sharedFields(ty.text || ctx.text || '', ty.name) : userFields(ty)).get(name)
        if (!e) return null
        const text = ty.text || ctx.text
        if (e.kind === 'function') return { k: 'func', entry: { src: 'data', e }, user: true, fnPos: e.fnPos, text }
        return fieldValueType(e, `${ty.name}.${name}`, text, depth)
      }
      case 'typed': {
        const t = ty.fields.get(name)
        if (!t) return null
        if (/->/.test(t)) return { k: 'func', entry: { src: 'data', e: typedEntry(name, t) }, typedRet: fnTypeRet(t), text: ty.text }
        return fromTypeName(t, ty.text)
      }
    }
    return null
  }
  if (st.op === ':') {
    const name = st.name, a0 = st.args ? strArg(st.args[0]) : null
    switch (ty.k) {
      case 'class': {
        switch (name) {
          case 'GetService': case 'FindService': case 'service': return a0 ? { k: 'class', name: a0 } : null
          case 'WaitForChild': case 'FindFirstChild': case 'FindFirstDescendant': case 'FindFirstAncestor':
            if (a0 && CHILD_HINTS[a0]) return { k: 'class', name: CHILD_HINTS[a0] }
            if (a0 && db.isClass(a0) && !db.isService(a0)) return { k: 'class', name: a0 }
            return { k: 'class', name: 'Instance' }
          case 'FindFirstChildOfClass': case 'FindFirstChildWhichIsA': case 'FindFirstAncestorOfClass': case 'FindFirstAncestorWhichIsA':
            return a0 ? { k: 'class', name: a0 } : { k: 'class', name: 'Instance' }
          case 'Clone': return ty
          case 'GetChildren': case 'GetDescendants': return { k: 'classArray', name: 'Instance' }
          case 'GetPlayers': return { k: 'classArray', name: 'Player' }
          case 'GetPropertyChangedSignal': case 'GetAttributeChangedSignal': return { k: 'signal', params: [] }
          case 'GetMouse': return { k: 'class', name: db.isClass('PlayerMouse') ? 'PlayerMouse' : 'Mouse' }
          case 'LoadAnimation': return { k: 'class', name: 'AnimationTrack' }
          case 'GetDataStore': return { k: 'class', name: 'DataStore' }
          case 'GetOrderedDataStore': return { k: 'class', name: 'OrderedDataStore' }
          case 'Create': if (ty.name === 'TweenService') return { k: 'class', name: 'Tween' }; break
          case 'HttpGet': case 'HttpGetAsync': case 'JSONEncode': case 'GetAsync': return name === 'GetAsync' && ty.name !== 'HttpService' ? null : { k: 'string' }
          case 'GetPivot': return { k: 'dt', name: 'CFrame' }
        }
        const m = db.member(ty.name, name)
        if (m && m.kind === 'f' && TUPLE_RETURNS[name]) return { k: 'tuple', items: TUPLE_RETURNS[name].map(t => fromTypeName(t)) }
        if (m && m.kind === 'f') return fromTypeName(db.returnType(m.type))
        return null
      }
      case 'signal':
        if (name === 'Connect' || name === 'Once' || name === 'ConnectParallel' || name === 'connect') return { k: 'conn' }
        if (name === 'Wait') return ty.params[0] ? fromTypeName(ty.params[0]) : null
        return null
      case 'dt': {
        const e = DT(ty.name).methods[name]
        return e ? fromTypeName(db.returnType(e.sig)) : null
      }
      case 'string': {
        const e = LUAU_LIBS.string[name]
        if (!e) return null
        const r = db.returnType(e.sig)
        return r && /string/.test(r) && !/\(/.test(r) ? { k: 'string' } : r === 'number' ? { k: 'number' } : null
      }
      case 'enum': return name === 'GetEnumItems' ? null : { k: 'enumItem', enum: ty.name }
      case 'usertable': {
        const e = userFields(ty).get(name)
        return e && e.kind === 'function' ? fnReturnType(ty.text || ctx.text, e.fnPos, depth + 1) : null
      }
      case 'typed': {
        const t = ty.fields.get(name)
        const r = t && fnTypeRet(t)
        return r ? fromTypeName(r, ty.text) : null
      }
    }
    return null
  }
  if (st.op === 'call') {
    if (ty.k === 'func' && ty.typedRet) return fromTypeName(ty.typedRet, ty.text)
    if (ty.k === 'func' && ty.user) return fnReturnType(ty.text || ctx.text, ty.fnPos, depth + 1)
    if (ty.k === 'func') {
      const e = ty.entry
      if (ty.lib === 'Instance' || (e.src === 'data' && ty.name === 'new' && ty.lib === undefined)) { /* below */ }
      const a0 = strArg(st.args[0])
      if (e.src === 'data' && e.e.sig && /^\(className: string/.test(e.e.sig) && a0) return { k: 'class', name: a0 }
      if (ty.lib === 'Drawing' && ty.name === 'new') return { k: 'drawing', name: DRAWING_KINDS.includes(a0) ? a0 : 'Line' }
      if (ty.gname === 'getrawmetatable' || ty.gname === 'getmetatable') return { k: 'execobj', name: 'Metatable' }
      if (e.src === 'data' && e.e.sig) {
        const ret = db.returnType(e.e.sig)
        if (ret && /^\{Success: boolean/.test(ret)) return { k: 'execobj', name: 'Response' }
        if (ret === '{Connection}') return { k: 'execArray', name: 'Connection' }
        if (ret === 'WebSocket') return { k: 'execobj', name: 'WebSocket' }
        // cloneref(x) は x と同じ型
        if (ty.gname === 'cloneref' && st.args[0]) return exprType(st.args[0], { ...ctx, index: 0 }, depth + 1) || { k: 'class', name: 'Instance' }
        if (ty.gname === 'getgenv' || ty.gname === 'getrenv') return { k: 'shared', name: ty.gname === 'getgenv' ? 'genv' : 'renv', text: ctx.text }
        if ((ty.lib === 'syn' || ty.lib === 'http' || ty.lib === 'fluxus') && ty.name === 'request') return { k: 'execobj', name: 'Response' }
        return fromTypeName(ret)
      }
      if (e.src === 'api') return fromTypeName(db.returnType(e.m.type))
    }
    return null
  }
  if (st.op === '[]') {
    if (ty.k === 'classArray') return { k: 'class', name: ty.name }
    if (ty.k === 'execArray') return { k: 'execobj', name: ty.name }
    return null
  }
  return null
}

export function resolveChain(chain, ctx, depth = 0) {
  if (!chain || !chain.root) return null
  let ty
  const r = chain.root
  if (r.t === 'name') {
    ty = nameType(r.name, ctx, depth)
    // グローバル関数呼び出し (typeof(x) など)
    if (!ty && chain.steps[0] && chain.steps[0].op === 'call') {
      const g = LUAU_GLOBALS[r.name] || (intel.executor && EXECUTOR_GLOBALS[r.name])
      if (g && g.sig) ty = { k: 'func', entry: { src: 'data', e: g }, gname: g.alias || r.name }
    }
    if (ty && ty.k === 'shared') ty = { ...ty, text: ctx.text }
  } else if (r.t === 'string') ty = { k: 'string' }
  else if (r.t === 'paren') ty = exprType(r.inner, { ...ctx, index: 0 }, depth + 1)
  else if (r.t === 'table') ty = { k: 'table' }
  else if (r.t === 'number') ty = { k: 'number' }
  for (const st of chain.steps) {
    if (ty && ty.k === 'tuple') ty = ty.items[0]
    if (!ty) return null
    ty = stepType(ty, st, ctx, depth)
    if (!ty) return null
  }
  if (ty && ty.k === 'tuple' && !ctx.tuple) return ty.items[0] || null
  return ty
}

// ============================================================
// 補完
// ============================================================
function apiInfo(m, cls) {
  return () => {
    const el = document.createElement('div')
    el.className = 'cm-api-info'
    const sig = document.createElement('div')
    sig.className = 'sig'
    sig.textContent = m.kind === 'p' ? `${m.name}: ${db.prettyType(m.type)}` : m.kind === 'e' ? `${m.name}: RBXScriptSignal${db.prettyType(m.type)}` : `${m.name}${db.prettyType(m.type)}`
    el.append(sig)
    const meta = document.createElement('div')
    meta.className = 'meta'
    const tags = []
    tags.push(({ p: 'プロパティ', f: 'メソッド', e: 'イベント', c: 'コールバック' })[m.kind])
    if (m.owner && m.owner !== cls) tags.push(m.owner + ' から継承')
    if (m.flags.includes('r')) tags.push('読み取り専用')
    if (m.flags.includes('y')) tags.push('待機あり (Yields)')
    if (m.flags.includes('d')) tags.push('⚠ 非推奨')
    if (m.flags.includes('s')) tags.push('🔒 権限が必要')
    meta.textContent = tags.join(' ・ ')
    el.append(meta)
    return el
  }
}
function dataInfo(name, e, prefix = '') {
  return () => {
    const el = document.createElement('div')
    el.className = 'cm-api-info'
    const sig = document.createElement('div')
    sig.className = 'sig'
    sig.textContent = prefix + name + (e.kind === 'function' ? e.sig : ': ' + e.type)
    el.append(sig)
    if (e.doc) { const d = document.createElement('div'); d.className = 'doc'; d.textContent = e.doc; el.append(d) }
    if (e.group) { const d = document.createElement('div'); d.className = 'meta'; d.textContent = 'エグゼキューター: ' + e.group; el.append(d) }
    return el
  }
}

function fnApply(name, hasParams) {
  return snippet(hasParams ? `${name}(\${})` : `${name}()\${}`)
}

// このファイルでよく使っているメンバーほど上に (使用回数の対数)
const useBoost = (ix, name) => { if (!ix) return 0; const n = ix.memberUse(name); return n ? Math.min(7, 1.5 + Math.log2(1 + n) * 1.6) : 0 }

function apiMemberItems(cls, op, ix = null) {
  const out = []
  for (const m of db.classMembers(cls).values()) {
    if (op === ':' && m.kind !== 'f') continue
    if (op === '.' && m.kind === 'f') continue
    const dep = m.flags.includes('d')
    const hidden = m.flags.includes('s') || (m.flags.includes('h') && !POPULAR.has(m.name))
    const boost = (POPULAR.has(m.name) ? 20 : 0) + (m.owner === cls ? 5 : 0) - (dep ? 60 : 0) - (hidden ? 30 : 0) - (m.owner === 'Instance' && !POPULAR.has(m.name) ? 3 : 0) + useBoost(ix, m.name)
    if (m.kind === 'f') {
      out.push({ label: m.name, type: 'method', detail: db.prettyType(m.type), info: apiInfo(m, cls), apply: fnApply(m.name, db.paramsOf(m.type).length > 0), boost, section: dep ? undefined : undefined, deprecated: dep })
    } else if (m.kind === 'e') {
      out.push({ label: m.name, type: 'event', detail: 'イベント' + db.prettyType(m.type), info: apiInfo(m, cls), boost })
      const params = db.paramsOf(m.type).map(p => p.name).join(', ')
      out.push({ label: `${m.name}:Connect`, type: 'event', detail: '→ 関数を接続', info: apiInfo(m, cls), boost: boost - 1, apply: snippet(`${m.name}:Connect(function(${params})\n\t\${}\nend)`), deprecated: dep })
    } else {
      out.push({ label: m.name, type: 'property', detail: db.prettyType(m.type), info: apiInfo(m, cls), boost, deprecated: dep })
    }
  }
  if (cls === 'DataModel' && intel.executor && op === ':') {
    for (const [name, e] of Object.entries(EXECUTOR_GAME_METHODS)) out.push({ label: name, type: 'method', detail: e.sig, info: dataInfo(name, e), apply: fnApply(name, true), boost: name === 'HttpGet' ? 15 : 0 })
  }
  if (op === '.') {
    const hints = CHILD_SUGGEST[cls] !== undefined ? CHILD_SUGGEST[cls] : null
    if (cls === 'DataModel') {
      const common = ['Players', 'Workspace', 'ReplicatedStorage', 'ServerStorage', 'ServerScriptService', 'StarterGui', 'StarterPack', 'StarterPlayer', 'Lighting', 'SoundService', 'Teams', 'CoreGui']
      for (const s of common) out.push({ label: s, type: 'class', detail: 'サービス', info: SERVICE_DOCS[s] || '', boost: 10 })
    } else if (hints) {
      for (const h of hints) if (!out.some(o => o.label === h)) out.push({ label: h, type: 'variable', detail: '子オブジェクト (よく使う名前)', boost: 2 })
    }
    // このファイルに出てくるオブジェクトの名前 (Name = "Coins" / WaitForChild("Coins") など)
    if (ix && (cls === 'Workspace' || (cls !== 'DataModel' && !db.isService(cls)))) {
      const have = new Set(out.map(o => o.label))
      for (const n of harvest(ix.text).names) if (/^[A-Za-z_]\w*$/.test(n) && !have.has(n)) out.push({ label: n, type: 'variable', detail: '子オブジェクト (このファイルで使用)', boost: 1 })
    }
  }
  return out
}

function dataItems(entries, op, prefix = '') {
  const out = []
  for (const [name, e] of Object.entries(entries)) {
    if (op === ':' && e.kind !== 'function') continue
    if (e.kind === 'function') out.push({ label: name, type: op === ':' ? 'method' : 'function', detail: e.sig, info: dataInfo(name, e, prefix), apply: fnApply(name, !/^\(\)/.test(e.sig)) })
    else out.push({ label: name, type: /^[A-Z]/.test(e.type) && !/^[A-Z][a-z]/.test(name) ? 'constant' : 'property', detail: e.type, info: dataInfo(name, e, prefix) })
  }
  return out
}

function membersFor(ty, op, ix = null) {
  if (!ty) return null
  switch (ty.k) {
    case 'class': return apiMemberItems(ty.name, op, ix)
    case 'dtlib': return op === '.' ? dataItems(DT(ty.name).ctor, op, ty.name + '.') : null
    case 'dt': {
      const d = DT(ty.name)
      return op === ':' ? dataItems(d.methods, op) : dataItems(d.props, op)
    }
    case 'lib': {
      const base = LUAU_LIBS[ty.name] || {}
      const ex = intel.executor && EXECUTOR_LIBS[ty.name] ? EXECUTOR_LIBS[ty.name] : {}
      return op === '.' ? dataItems({ ...base, ...ex }, op, ty.name + '.') : null
    }
    case 'string': return op === ':' ? dataItems(LUAU_LIBS.string, ':') : null
    case 'enumRoot': return op === '.' ? db.enumNames().map(n => ({ label: n, type: 'enum', detail: 'Enum' })) : op === ':' ? [{ label: 'GetEnums', type: 'method', apply: fnApply('GetEnums', false) }] : null
    case 'enum': {
      const items = db.enumItems(ty.name) || []
      if (op === ':') return dataItems(ROBLOX_DATATYPES.Enum.methods, ':')
      return items.map(([n, v], i) => ({ label: n, type: 'enum', detail: `= ${v}`, boost: -i * 0.01 }))
    }
    case 'enumItem': return op === '.' ? dataItems(ROBLOX_DATATYPES.EnumItem.props, '.') : dataItems(ROBLOX_DATATYPES.EnumItem.methods, ':')
    case 'signal': return op === ':' ? dataItems(ROBLOX_DATATYPES.RBXScriptSignal.methods, ':').map(i => i.label === 'Connect' ? { ...i, boost: 10, apply: snippet('Connect(function(${})\n\t${}\nend)') } : i) : null
    case 'conn': return op === ':' ? dataItems(ROBLOX_DATATYPES.RBXScriptConnection.methods, ':') : dataItems(ROBLOX_DATATYPES.RBXScriptConnection.props, '.')
    case 'drawing': return dataItems(DRAWING_ENTRIES[ty.name] || DRAWING_ENTRIES.Line, op === ':' ? ':' : '.', `Drawing.${ty.name}.`)
    case 'execobj': return dataItems(EXECUTOR_OBJECTS[ty.name], op, ty.name + '.')
    case 'usertable': {
      const fields = userFields(ty)
      if (!fields.size) return null
      const obj = {}
      for (const [k, e] of fields) if ((op === '.' || e.kind === 'function') && k !== '__index') obj[k] = e
      return dataItems(obj, op, (ty.module || ty.name) + op).map(i => ({ ...i, boost: 3 + (/^_/.test(i.label) ? -6 : 0) }))
    }
    case 'typed': {
      const obj = {}
      for (const [k, t] of ty.fields) { const e = typedEntry(k, t); if (op === '.' || e.kind === 'function') obj[k] = e }
      return dataItems(obj, op, ty.name + op).map(i => ({ ...i, boost: 3 }))
    }
    case 'ext': {
      const out = []
      for (const [name, m] of membersOfRef(ty.api, ty.ref)) {
        if (op === ':' && m.k !== 'fn') continue
        const e = extEntry(m, ty)
        const boost = 6 + (/^(Add|Create|Make|New|Set|On|Get|Toggle|Notify)/.test(name) ? 3 : 0) - (/^_/.test(name) ? 8 : 0)
        if (m.k === 'fn') out.push({ label: name, type: op === ':' ? 'method' : 'function', detail: e.sig, info: dataInfo(name, e, ty.lib + op), apply: fnApply(name, m.params.length > (op === ':' && !m.method ? 1 : 0) || !!m.va), boost })
        else out.push({ label: name, type: m.ty === 'table' ? 'namespace' : 'property', detail: m.ty, info: dataInfo(name, e, ty.lib + op), boost: boost - 1 })
      }
      return out.length ? out : null
    }
    case 'shared': {
      const fields = sharedFields(ty.text || '', ty.name)
      const obj = {}
      for (const [k, e] of fields) obj[k] = e
      return op === '.' ? dataItems(obj, op, ty.name === 'genv' ? 'getgenv().' : ty.name + '.') : null
    }
  }
  return null
}

let globalItemsCache = null
let globalItemsKey = ''
function globalItems() {
  const key = `${intel.executor}|${intel.roblox}|${intel.snippets}|${db.apiReady()}`
  if (globalItemsCache && key === globalItemsKey) return globalItemsCache
  const out = []
  for (const kw of LUAU_KEYWORDS) out.push({ label: kw, type: 'keyword', boost: -2 })
  for (const [name, e] of Object.entries(LUAU_GLOBALS)) {
    if (!intel.roblox && ['game', 'workspace', 'script', 'plugin', 'Enum', 'shared', 'settings', 'UserSettings', 'version', 'printidentity', 'tick', 'time', 'elapsedTime', 'wait', 'spawn', 'delay', 'warn', 'typeof'].includes(name)) continue
    const dep = /非推奨/.test(e.doc)
    out.push(e.kind === 'function'
      ? { label: name, type: 'function', detail: e.sig, info: dataInfo(name, e), apply: fnApply(name, !/^\(\)/.test(e.sig)), boost: (['print', 'game', 'workspace', 'local', 'pairs', 'ipairs'].includes(name) ? 5 : 0) - (dep ? 30 : 0) }
      : { label: name, type: 'variable', detail: e.type, info: dataInfo(name, e), boost: ['game', 'workspace', 'script', 'Enum'].includes(name) ? 8 : 0 })
  }
  for (const lib of Object.keys(LUAU_LIBS)) out.push({ label: lib, type: 'namespace', detail: 'ライブラリ', boost: lib === 'task' || lib === 'math' || lib === 'string' || lib === 'table' ? 3 : 0 })
  if (intel.roblox) {
    for (const dt of Object.keys(ROBLOX_DATATYPES)) {
      if (['RBXScriptSignal', 'RBXScriptConnection', 'EnumItem', 'Enum'].includes(dt)) continue
      out.push({ label: dt, type: 'class', detail: 'データ型', boost: ['Instance', 'Vector3', 'CFrame', 'Color3', 'UDim2'].includes(dt) ? 4 : 0 })
    }
  }
  if (intel.executor) {
    for (const [name, e] of Object.entries(EXECUTOR_GLOBALS)) {
      if (out.some(o => o.label === name)) continue
      out.push(e.kind === 'function'
        ? { label: name, type: 'function', detail: e.sig, info: dataInfo(name, e), apply: fnApply(name, !/^\(\)/.test(e.sig)), boost: EXECUTOR_POPULAR.has(name) ? 4 : e.alias ? -12 : -1 }
        : { label: name, type: 'namespace', detail: e.type, info: dataInfo(name, e), boost: EXECUTOR_POPULAR.has(name) ? 4 : -1 })
    }
  }
  if (intel.snippets) {
    for (const s of LUAU_SNIPPETS) {
      if (!intel.executor && /エグゼキューター/.test(s.detail)) continue
      out.push(snippetCompletion(s.body, { label: s.label, detail: s.detail, type: 'snippet', boost: -1 }))
    }
  }
  globalItemsCache = out
  globalItemsKey = key
  return out
}

let wordsDoc = null, wordsList = []
function docWords(state, exclude, skip) {
  if (state.doc !== wordsDoc) {
    // 入力のたびに全文を走査しないよう、文書が同じ間は使い回す (入力中の単語は exclude で除外)
    const text = docText(state).slice(0, 300000)
    const words = new Set()
    const re = /[A-Za-z_][\w]{2,}/g
    let m
    while ((m = re.exec(text))) words.add(m[0])
    for (const kw of LUAU_KEYWORDS) words.delete(kw)
    wordsDoc = state.doc
    wordsList = [...words]
  }
  const out = []
  for (const w of wordsList) if (w !== exclude && !(skip && skip.has(w))) out.push({ label: w, type: 'text', boost: -5 })
  return out
}

function inCommentOrString(state, pos) {
  const tree = syntaxTree(state)
  const node = tree.resolveInner(pos, -1)
  const name = node.name || ''
  return /comment/i.test(name) ? 'comment' : /string/i.test(name) ? 'string' : null
}

// ---- このファイルから集める名前 (文字列の引数の候補) ----
const harvestCache = { text: null, v: null }
function harvest(text) {
  if (harvestCache.text === text) return harvestCache.v
  const src = text.length > 400000 ? text.slice(0, 400000) : text
  const v = { names: new Set(), attrs: new Set(), tags: new Set(), steps: new Set(), actions: new Set() }
  const scan = (re, set) => { let m; re.lastIndex = 0; while ((m = re.exec(src)) && set.size < 300) set.add(m[1] || m[2] || m[3]) }
  scan(/\.Name\s*=\s*["']([^"'\n]{1,60})["']|[{,]\s*Name\s*=\s*["']([^"'\n]{1,60})["']|(?:WaitForChild|FindFirstChild|FindFirstAncestor|FindFirstDescendant)\s*\(\s*["']([^"'\n]{1,60})["']/g, v.names)
  scan(/(?:Get|Set)Attribute(?:ChangedSignal)?\s*\(\s*["']([^"'\n]{1,60})["']/g, v.attrs)
  scan(/(?:GetTagged|AddTag|HasTag|RemoveTag|GetInstanceAddedSignal|GetInstanceRemovedSignal)\s*\(\s*["']([^"'\n]{1,60})["']/g, v.tags)
  scan(/(?:BindToRenderStep|UnbindFromRenderStep)\s*\(\s*["']([^"'\n]{1,60})["']/g, v.steps)
  scan(/(?:BindAction|UnbindAction|BindActionAtPriority)\s*\(\s*["']([^"'\n]{1,60})["']/g, v.actions)
  harvestCache.text = text
  harvestCache.v = v
  return v
}

const STRING_ARG_FNS = {
  GetService: 'service', FindService: 'service', new: 'creatable', IsA: 'class', FindFirstChildOfClass: 'class', FindFirstChildWhichIsA: 'class',
  FindFirstAncestorOfClass: 'class', FindFirstAncestorWhichIsA: 'class', GetPropertyChangedSignal: 'prop', WaitForChild: 'child', FindFirstChild: 'child',
  FindFirstAncestor: 'child', FindFirstDescendant: 'child', GetAttribute: 'attr', SetAttribute: 'attr', GetAttributeChangedSignal: 'attr',
  SetCore: 'core', GetCore: 'core', GetTagged: 'tag', AddTag: 'tag', HasTag: 'tag', RemoveTag: 'tag', GetInstanceAddedSignal: 'tag', GetInstanceRemovedSignal: 'tag',
  BindToRenderStep: 'step', UnbindFromRenderStep: 'step', BindAction: 'action', UnbindAction: 'action', BindActionAtPriority: 'action',
}
const CORE_NAMES = [['SendNotification', '通知を表示 (Title, Text, Duration)'], ['ChatMakeSystemMessage', 'チャットにシステムメッセージ'], ['ResetButtonCallback', 'リセットボタンの動作 (false で無効)'], ['TopbarEnabled', '上部バーの表示'], ['DevConsoleVisible', '開発者コンソールの表示'], ['PromptSendFriendRequest', 'フレンド申請の画面'], ['PromptBlockPlayer', 'ブロックの画面'], ['ChatActive', 'チャットの表示'], ['PointsNotificationsActive', 'ポイント通知'], ['BadgesNotificationsActive', 'バッジ通知'], ['AvatarContextMenuEnabled', 'アバターメニュー']]

// ---- 期待される型 (代入・比較・引数・テーブルのキー) ----
// 返り値: { type: API の型名 (例 "Enum.Material" / "Vector3" / "Instance"), prop?, cls?, src }
export function expectedTypeAt(state, pos, ctx) {
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  let m
  // obj.Prop = | / obj.Prop == |
  if ((m = /\.\s*([A-Za-z_]\w*)\s*(==|~=|=)\s*$/.exec(before))) {
    const objText = chainBefore(before, m.index)
    if (objText) {
      const parent = resolveChain(parseChain(objText), ctx)
      if (parent && parent.k === 'class') {
        const mem = db.member(parent.name, m[1])
        if (mem && mem.kind === 'p') return { type: mem.type, prop: m[1], cls: parent.name, src: m[2] === '=' ? 'assign' : 'compare', obj: objText }
      } else if (parent && parent.k === 'drawing') {
        const e = (DRAWING_ENTRIES[parent.name] || DRAWING_ENTRIES.Line)[m[1]]
        if (e && e.kind === 'value') return { type: e.type, prop: m[1], src: 'assign', obj: objText }
      } else if (parent && parent.k === 'typed') {
        const t = parent.fields.get(m[1])
        if (t) return { type: t, prop: m[1], src: 'assign', obj: objText }
      }
    }
    return null
  }
  // local x: T = |
  if ((m = /^\s*local\s+[A-Za-z_]\w*\s*:\s*([\w.<>{}?]+)\s*=\s*$/.exec(before))) return { type: m[1], src: 'assign' }
  // TweenService:Create(obj, info, { Key = | })
  if ((m = /(?:^|[{,;])\s*([A-Za-z_]\w*)\s*=\s*$/.exec(before))) {
    const keyPos = line.from + m.index + m[0].indexOf(m[1])
    const goal = tweenTarget(ctx.text, keyPos, ctx)
    if (goal) { const mem = db.member(goal, m[1]); if (mem && mem.kind === 'p') return { type: mem.type, prop: m[1], cls: goal, src: 'assign' } }
    return null
  }
  // 関数の引数
  if (/[(,]\s*$/.test(before)) {
    const sig = signatureAt(state, pos)
    const p = sig && sig.params[sig.active]
    if (p && p.type && p.type !== 'any') return { type: p.type, src: 'arg', param: p.name, callee: sig.label }
  }
  return null
}

// テーブルが TweenService:Create の 3 番目の引数なら、目標オブジェクトのクラス名
function tweenTarget(text, pos, ctx) {
  const tc = tableArgAt(text, pos)
  if (!tc || tc.arg !== 2 || !/:\s*Create$/.test(tc.callee)) return null
  const chain = parseChain(tc.callee)
  const parent = chain && resolveChain({ root: chain.root, steps: chain.steps.slice(0, -1) }, ctx)
  if (!parent || parent.k !== 'class' || parent.name !== 'TweenService') return null
  const target = tc.args[0]
  const ty = target && exprType(target, { ...ctx, pos: tc.open, index: 0 }, 0)
  return ty && ty.k === 'class' ? ty.name : null
}

const ph = (i, v) => `\${${i}:${String(v).replace(/[{}\\$]/g, '')}}`
// 型ごとの「値の作り方」
const DT_SNIPPETS = {
  Vector3: [['Vector3.new', `Vector3.new(${ph(1, 0)}, ${ph(2, 0)}, ${ph(3, 0)})`], ['Vector3.zero', 'Vector3.zero'], ['Vector3.one', 'Vector3.one']],
  Vector2: [['Vector2.new', `Vector2.new(${ph(1, 0)}, ${ph(2, 0)})`], ['Vector2.zero', 'Vector2.zero']],
  CFrame: [['CFrame.new', `CFrame.new(${ph(1, 0)}, ${ph(2, 0)}, ${ph(3, 0)})`], ['CFrame.lookAt', `CFrame.lookAt(${ph(1, 'from')}, ${ph(2, 'to')})`], ['CFrame.Angles', `CFrame.Angles(${ph(1, 0)}, ${ph(2, 'math.rad(90)')}, ${ph(3, 0)})`], ['CFrame.identity', 'CFrame.identity']],
  Color3: [['Color3.fromRGB', `Color3.fromRGB(${ph(1, 255)}, ${ph(2, 255)}, ${ph(3, 255)})`], ['Color3.new', `Color3.new(${ph(1, 1)}, ${ph(2, 1)}, ${ph(3, 1)})`], ['Color3.fromHex', `Color3.fromHex("${ph(1, '#ffffff')}")`], ['Color3.fromHSV', `Color3.fromHSV(${ph(1, 0)}, ${ph(2, 1)}, ${ph(3, 1)})`]],
  UDim2: [['UDim2.new', `UDim2.new(${ph(1, 0)}, ${ph(2, 100)}, ${ph(3, 0)}, ${ph(4, 50)})`], ['UDim2.fromScale', `UDim2.fromScale(${ph(1, 1)}, ${ph(2, 1)})`], ['UDim2.fromOffset', `UDim2.fromOffset(${ph(1, 100)}, ${ph(2, 50)})`]],
  UDim: [['UDim.new', `UDim.new(${ph(1, 0)}, ${ph(2, 8)})`]],
  BrickColor: [['BrickColor.new', `BrickColor.new("${ph(1, 'Bright red')}")`], ['BrickColor.random', 'BrickColor.random()']],
  NumberRange: [['NumberRange.new', `NumberRange.new(${ph(1, 0)}, ${ph(2, 1)})`]],
  NumberSequence: [['NumberSequence.new', `NumberSequence.new(${ph(1, 0)})`]],
  ColorSequence: [['ColorSequence.new', `ColorSequence.new(${ph(1, 'Color3.fromRGB(255, 255, 255)')})`]],
  TweenInfo: [['TweenInfo.new', `TweenInfo.new(${ph(1, 0.5)}, Enum.EasingStyle.${ph(2, 'Quad')}, Enum.EasingDirection.${ph(3, 'Out')})`]],
  Font: [['Font.fromEnum', `Font.fromEnum(Enum.Font.${ph(1, 'Gotham')})`], ['Font.new', `Font.new("rbxasset://fonts/families/${ph(1, 'GothamSSm')}.json")`]],
  Rect: [['Rect.new', `Rect.new(${ph(1, 0)}, ${ph(2, 0)}, ${ph(3, 0)}, ${ph(4, 0)})`]],
  PhysicalProperties: [['PhysicalProperties.new', `PhysicalProperties.new(${ph(1, 0.7)}, ${ph(2, 0.3)}, ${ph(3, 0.5)})`]],
  RaycastParams: [['RaycastParams.new', 'RaycastParams.new()']],
  OverlapParams: [['OverlapParams.new', 'OverlapParams.new()']],
  Content: [['"rbxassetid://"', `"rbxassetid://${ph(1, '')}"`]],
  ContentId: [['"rbxassetid://"', `"rbxassetid://${ph(1, '')}"`]],
}
const POPULAR_ENUM = {
  KeyCode: ['E', 'F', 'Q', 'R', 'LeftShift', 'Space', 'LeftControl', 'One', 'Two', 'W', 'A', 'S', 'D', 'Return', 'Tab'],
  Material: ['SmoothPlastic', 'Plastic', 'Neon', 'Glass', 'Wood', 'Metal', 'ForceField', 'Concrete', 'Grass'],
  Font: ['Gotham', 'GothamBold', 'GothamMedium', 'SourceSans', 'SourceSansBold', 'Arial', 'Ubuntu', 'Code'],
  UserInputType: ['MouseButton1', 'MouseButton2', 'Touch', 'Keyboard', 'MouseMovement', 'Gamepad1'],
  EasingStyle: ['Quad', 'Linear', 'Sine', 'Back', 'Quint', 'Exponential', 'Elastic', 'Bounce'],
  EasingDirection: ['Out', 'In', 'InOut'],
  HumanoidStateType: ['Jumping', 'Freefall', 'Running', 'Dead', 'Physics', 'GettingUp'],
  SortOrder: ['LayoutOrder', 'Name'],
  FillDirection: ['Vertical', 'Horizontal'],
  HorizontalAlignment: ['Center', 'Left', 'Right'],
  VerticalAlignment: ['Center', 'Top', 'Bottom'],
  TextXAlignment: ['Left', 'Center', 'Right'],
  ZIndexBehavior: ['Sibling', 'Global'],
  RaycastFilterType: ['Exclude', 'Include'],
  PartType: ['Block', 'Ball', 'Cylinder'],
  CoreGuiType: ['All', 'Backpack', 'PlayerList', 'Chat', 'Health', 'EmotesMenu'],
}
const typeMatches = (ty, want) => {
  if (!ty) return false
  if (ty.k === 'class') return want === 'Instance' || db.isA(ty.name, want)
  if (ty.k === 'dt') return ty.name === want
  if (ty.k === 'number') return want === 'number' || want === 'float' || want === 'int' || want === 'double' || want === 'int64'
  if (ty.k === 'string') return want === 'string'
  if (ty.k === 'bool') return want === 'bool' || want === 'boolean'
  if (ty.k === 'enumItem') return want === 'Enum.' + ty.enum
  return false
}
// 期待される型に合う候補 (Enum の項目・値の作り方・型の合う変数)
export function expectedItems(exp, ctx, budgetMs = 4) {
  const T = exp.type.replace(/\?$/, '').trim()
  const out = []
  if (T.startsWith('Enum.')) {
    const en = T.slice(5)
    const pop = POPULAR_ENUM[en] || []
    ;(db.enumItems(en) || []).forEach(([n, v], i) => {
      const pi = pop.indexOf(n)
      out.push({ label: `Enum.${en}.${n}`, type: 'enum', detail: `= ${v}`, boost: 40 - Math.min(i, 400) * 0.002 + (pi >= 0 ? 3 - pi * 0.1 : 0) })
    })
  } else if (T === 'bool' || T === 'boolean') {
    out.push({ label: 'true', type: 'keyword', detail: 'boolean', boost: 40 }, { label: 'false', type: 'keyword', detail: 'boolean', boost: 39 })
  } else if (DT_SNIPPETS[T]) {
    DT_SNIPPETS[T].forEach(([label, body], i) => out.push(snippetCompletion(body, { label, type: 'function', detail: `→ ${T}`, boost: 36 - i * 0.5 })))
  }
  // 型の合う変数 (近くで宣言したものほど上)
  if (ctx.text && (db.isClass(T) || ROBLOX_DATATYPES[T] || /^(number|string|bool|boolean|float|int|double)$/.test(T) || T.startsWith('Enum.'))) {
    const t0 = performance.now()
    const vis = textIndex(ctx.text).visible(ctx.pos, 120)
    for (let i = 0; i < vis.length && i < 80; i++) {
      if (performance.now() - t0 > budgetMs) break
      const d = vis[i]
      let ty = null
      try { ty = nameType(d.name, ctx, 0) } catch { ty = null }
      if (typeMatches(ty, T)) out.push({ label: d.name, type: 'variable', detail: typeLabel(ty), boost: 38 - i * 0.05 })
    }
    if (T === 'Instance' && exp.prop === 'Parent') {
      out.push({ label: 'workspace', type: 'variable', detail: 'Workspace', boost: 30 }, { label: 'script', type: 'variable', detail: 'Script', boost: 25 })
    }
  }
  return out
}

// ---- スコープの中で見えるローカル変数・引数・関数 (型付き) ----
const KIND_LABEL = { local: 'ローカル変数', param: '引数', forin: 'ループ変数', fornum: 'ループ変数', func: '関数', assign: 'グローバル変数' }
function localItems(ctx, wordFrom, argPos) {
  const out = []
  const vis = textIndex(ctx.text).visible(ctx.pos, 300)
  const t0 = performance.now()
  for (let i = 0; i < vis.length; i++) {
    const d = vis[i]
    if (d.at === wordFrom) continue // いま書いている宣言そのもの
    let type = d.kind === 'func' ? 'function' : 'variable'
    let detail = KIND_LABEL[d.kind] || 'ローカル変数'
    let hasParams = d.kind === 'func' ? !/^\(\s*\)/.test(d.params || '()') : null
    if (i < 30 && performance.now() - t0 < 3) {
      let ty = null
      try { ty = nameType(d.name, ctx, 0) } catch { ty = null }
      if (ty && ty.k === 'func') {
        type = 'function'
        const sig = ty.entry && ty.entry.e ? ty.entry.e.sig : ty.entry && ty.entry.m ? ty.entry.m.type : '()'
        const ret = ty.user && ty.fnPos !== undefined ? fnReturnType(ty.text || ctx.text, ty.fnPos) : null
        detail = (sig || '()') + (ret ? ': ' + typeLabel(ret) : '')
        hasParams = !/^\(\s*\)/.test(sig || '()')
      } else if (ty) detail = typeLabel(ty) + ` (${KIND_LABEL[d.kind] || 'ローカル変数'})`
    }
    const boost = 7 - Math.min(5, i * 0.2) + (d.kind === 'param' || d.kind === 'forin' ? 0.5 : 0)
    out.push({ label: d.name, type, detail, boost, apply: type === 'function' && !argPos ? fnApply(d.name, hasParams !== false) : undefined })
  }
  return out
}

export function luauCompletionSource(context) {
  const { state, pos } = context
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  const where = inCommentOrString(state, pos)
  const ctx = { text: docText(state), pos, index: 0 }

  // エグゼキューター: 文字列で指定する引数
  if (intel.executor) {
    let em
    if ((em = /\bDrawing\s*\.\s*new\s*\(\s*["'](\w*)$/.exec(before))) return { from: pos - em[1].length, options: DRAWING_KINDS.map(k => ({ label: k, type: 'class', detail: 'Drawing の種類' })), validFor: /^\w*$/ }
    if ((em = /\bhookmetamethod\s*\([^()]*,\s*["'](\w*)$/.exec(before))) return { from: pos - em[1].length, options: METAMETHODS.map((k, i) => ({ label: k, type: 'constant', detail: 'メタメソッド', boost: -i })), validFor: /^\w*$/ }
    if ((em = /\bcrypt\s*\.\s*hash\s*\([^()]*,\s*["']([\w-]*)$/.exec(before))) return { from: pos - em[1].length, options: HASH_ALGORITHMS.map(k => ({ label: k, type: 'constant', detail: 'ハッシュ方式' })), validFor: /^[\w-]*$/ }
    if ((em = /\bMethod\s*=\s*["'](\w*)$/.exec(before))) return { from: pos - em[1].length, options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map(k => ({ label: k, type: 'constant', detail: 'HTTP メソッド' })), validFor: /^\w*$/ }
    if (!where && (em = /(?:^|[{,;]\s*)([A-Za-z_]\w*)?$/.exec(before)) && (em[1] || context.explicit || /[{,]\s*$/.test(before))) {
      // request({ | }) のキー
      const head = ctx.text.slice(Math.max(0, pos - 400), pos - (em[1] ? em[1].length : 0))
      const open = head.lastIndexOf('{')
      if (open >= 0 && !head.slice(open).includes('}') && /\b(?:request|http_request|syn\.request|http\.request|fluxus\.request)\s*\(\s*$/.test(head.slice(0, open))) {
        const typed = em[1] || ''
        return { from: pos - typed.length, options: Object.entries(REQUEST_OPTIONS).map(([k, e], i) => ({ label: k, type: 'property', detail: e.type, info: e.doc, apply: k + ' = ', boost: 10 - i })), validFor: /^\w*$/ }
      }
    }
  }

  // 関数に渡すテーブルのキー: Groupbox:AddToggle("x", { Te| }) / TweenService:Create(p, info, { Pos| })
  if (!where) {
    const km = /(?:^\s*|[{,;]\s*)([A-Za-z_]\w*)?$/.exec(before)
    if (km) {
      const typed = km[1] || ''
      const keys = (intel.extLib && extTableKeys(ctx.text, pos - typed.length, ctx)) || apiTableKeys(ctx.text, pos - typed.length, ctx)
      if (keys) return { from: pos - typed.length, options: keys, validFor: /^\w*$/ }
    }
  }

  // 文字列引数: GetService("|") など
  const sm = /([\w.:"()[\]]*?)\b(\w+)\s*\(\s*["']([\w .-]*)$/.exec(before)
  if (sm && STRING_ARG_FNS[sm[2]]) {
    const kind = STRING_ARG_FNS[sm[2]]
    const typedStr = sm[3]
    const from = pos - typedStr.length
    let options = []
    const fromFile = (set, detail) => [...set].filter(n => n !== typedStr).map(n => ({ label: n, type: 'text', detail, boost: 5 }))
    if (kind === 'service') options = db.serviceNames().map(n => ({ label: n, type: 'class', detail: 'サービス', info: SERVICE_DOCS[n] || '', boost: SERVICE_DOCS[n] ? 10 : 0 }))
    else if (kind === 'creatable') {
      if (!/Instance\s*\.\s*new\s*\(\s*["'][\w ]*$/.test(before)) return null
      const common = ['Part', 'Model', 'Folder', 'ScreenGui', 'Frame', 'TextLabel', 'TextButton', 'ImageLabel', 'TextBox', 'RemoteEvent', 'RemoteFunction', 'BindableEvent', 'IntValue', 'StringValue', 'BoolValue', 'NumberValue', 'ObjectValue', 'Sound', 'PointLight', 'Attachment', 'Weld', 'WeldConstraint', 'Highlight', 'BillboardGui', 'SurfaceGui', 'UICorner', 'UIStroke', 'UIListLayout', 'UIGridLayout', 'UIPadding', 'Tool', 'ProximityPrompt', 'ClickDetector', 'Animation', 'ParticleEmitter', 'Beam', 'Trail', 'MeshPart', 'UnionOperation', 'Decal', 'Texture', 'SpecialMesh', 'BodyVelocity', 'LinearVelocity', 'AlignPosition', 'VectorForce', 'Humanoid']
      options = db.creatableClasses().map(n => ({ label: n, type: 'class', detail: db.isDeprecatedClass(n) ? '⚠ 非推奨' : 'クラス', boost: common.includes(n) ? 10 - common.indexOf(n) * 0.1 : db.isDeprecatedClass(n) ? -20 : 0 }))
    } else if (kind === 'class') options = db.allClasses().map(n => ({ label: n, type: 'class', boost: ['BasePart', 'Part', 'Model', 'Humanoid', 'Player', 'GuiObject', 'TextButton', 'Folder', 'Script', 'LocalScript', 'ModuleScript'].includes(n) ? 5 : 0 }))
    else if (kind === 'attr') options = fromFile(harvest(ctx.text).attrs, '属性 (このファイルで使用)')
    else if (kind === 'tag') options = fromFile(harvest(ctx.text).tags, 'タグ (このファイルで使用)')
    else if (kind === 'step') options = fromFile(harvest(ctx.text).steps, '名前 (このファイルで使用)')
    else if (kind === 'action') options = fromFile(harvest(ctx.text).actions, '名前 (このファイルで使用)')
    else if (kind === 'core') options = CORE_NAMES.map(([n, d], i) => ({ label: n, type: 'constant', detail: d, boost: 10 - i * 0.1 }))
    else if (kind === 'prop' || kind === 'child') {
      const nameStart = before.length - sm[0].length + sm[1].length
      const objChain = chainBefore(before, nameStart - 1)
      const ty = resolveChain(parseChain(objChain), ctx)
      if (kind === 'prop' && ty && ty.k === 'class') options = [...db.classMembers(ty.name).values()].filter(m => m.kind === 'p').map(m => ({ label: m.name, type: 'property', detail: db.prettyType(m.type), boost: POPULAR.has(m.name) ? 5 : 0 }))
      if (kind === 'child') {
        const hints = ty && ty.k === 'class' ? (ty.name === 'DataModel' ? db.serviceNames() : (CHILD_SUGGEST[ty.name] || Object.keys(CHILD_HINTS))) : Object.keys(CHILD_HINTS)
        options = [...fromFile(harvest(ctx.text).names, '子オブジェクト (このファイルで使用)'), ...hints.map(h => ({ label: h, type: 'variable', detail: '子オブジェクト' }))]
        const seen = new Set()
        options = options.filter(o => !seen.has(o.label) && seen.add(o.label))
      }
    }
    if (!options.length) return null
    return { from, options, validFor: /^[\w .-]*$/ }
  }
  if (where) return null

  // メンバー: a.b / a:b
  const mm = /(^|[^.])([.:])\s*([A-Za-z_]\w*)?$/.exec(before)
  if (mm && !/\d$/.test(before.slice(0, before.length - mm[0].length + mm[1].length))) {
    const op = mm[2]
    const typed = mm[3] || ''
    const chainEnd = before.length - mm[0].length + mm[1].length
    const chainText = chainBefore(before, chainEnd)
    if (chainText) {
      // 型注釈 "local x: " の場合は型名
      if (op === ':' && /\blocal\s+[\w\s,]*$/.test(before.slice(0, chainEnd)) || op === ':' && /\bfunction\b[^)]*\([^)]*$/.test(before) || op === ':' && /\)\s*$/.test(before.slice(0, chainEnd)) && /\bfunction\b/.test(before)) {
        const userTypes = typeNames(ctx.text)
        return { from: pos - typed.length, options: [...userTypes.map(n => ({ label: n, type: 'type', detail: 'このファイルの型', boost: 5 })), ...LUAU_TYPES.map(tn => ({ label: tn, type: 'type' })), ...(intel.roblox ? ['Players', 'Workspace', 'Tool', 'ScreenGui', 'Frame', 'TextLabel', 'TextButton', 'RemoteEvent', 'RemoteFunction', 'Sound', 'Animation', 'AnimationTrack', 'Camera', 'TweenService', 'UserInputService', 'RunService'].map(n => ({ label: n, type: 'class' })) : [])], validFor: /^\w*$/ }
      }
      const chain = parseChain(chainText)
      const ty = resolveChain(chain, ctx)
      let options = membersFor(ty, op, textIndex(ctx.text))
      if (!options) {
        if (!typed && !context.explicit && op === ':') return null
        // 型不明: Instance と仮定 / 単語補完
        options = op === ':' && intel.roblox ? apiMemberItems('Instance', ':') : docWords(state, typed)
      }
      return { from: pos - typed.length, options, validFor: /^\w*$/ }
    }
  }

  // 識別子
  const word = context.matchBefore(/[A-Za-z_]\w*/)
  const from = word ? word.from : pos
  const typed = word ? word.text : ''
  const head = before.slice(0, before.length - typed.length)
  // 期待される型 (x.Material = | / :ChangeState(| / { Position = | })
  let exp = null
  if (/(?:[=(,{]|==|~=)\s*$/.test(head) && !/^\s*(?:local\s+[\w\s,]*|for\s+[\w\s,]*)$/.test(head.replace(/=\s*$/, '')) && !/\bfunction\s*[\w.:]*\s*\([^)]*$/.test(head)) {
    try { exp = expectedTypeAt(state, from, { ...ctx, pos: from }) } catch { exp = null }
  }
  const expOpts = exp ? expectedItems(exp, { ...ctx, pos: from }) : []
  if (!typed && !context.explicit) {
    // 何も入力していないときは、Enum など候補がはっきりしている場合だけ開く
    if (exp && expOpts.length && (exp.type.startsWith('Enum.') || exp.type.replace(/\?$/, '') === 'bool')) return { from, options: expOpts, validFor: /^[\w.]*$/ }
    return null
  }
  const argPos = /[(,]\s*$/.test(head)
  const locals = localItems(ctx, from, argPos)
  const skip = new Set([...locals.map(l => l.label), ...expOpts.map(o => o.label)])
  const globals = globalItems().filter(g => !skip.has(g.label))
  return { from, options: [...expOpts, ...locals, ...globals, ...docWords(state, typed, skip)], validFor: /^\w*$/ }
}

// このファイルの type 定義の名前
function typeNames(text) {
  const out = []
  const re = /^[ \t]*(?:export\s+)?type\s+([A-Za-z_]\w*)/gm
  let m
  while ((m = re.exec(text)) && out.length < 100) out.push(m[1])
  return out
}

// 位置 pos が「関数呼び出しに渡しているテーブル」の中なら、その呼び出しと何番目の引数か
export function tableArgAt(text, pos) {
  const start = Math.max(0, pos - 4000)
  let d = 0, i
  for (i = pos - 1; i >= start; i--) {
    const c = text[i]
    if (c === '"' || c === "'") { const q = c; i--; while (i >= start && text[i] !== q) i--; continue }
    if (c === '}' || c === ')' || c === ']') d++
    else if (c === '{' || c === '(' || c === '[') { if (d === 0) break; d-- }
  }
  if (i < start || text[i] !== '{') return null
  const open = i
  let j = open - 1
  while (j >= start && /\s/.test(text[j])) j--
  if (text[j] !== '(' && text[j] !== ',') return null
  // 呼び出しの ( を探し、その前までの引数の数を数える
  let commas = 0
  d = 0
  for (j = open - 1; j >= start; j--) {
    const c = text[j]
    if (c === '"' || c === "'") { const q = c; j--; while (j >= start && text[j] !== q) j--; continue }
    if (c === '}' || c === ')' || c === ']') d++
    else if (c === '{' || c === '[') { if (d === 0) return null; d-- }
    else if (c === '(') { if (d === 0) break; d-- }
    else if (c === ',' && d === 0) commas++
  }
  if (j < start) return null
  const callee = chainBefore(text, j)
  if (!callee) return null
  const present = new Set()
  const inner = text.slice(open + 1, pos)
  const re = /(?:^|[{,;\n])\s*([A-Za-z_]\w*)\s*=/g
  let m
  while ((m = re.exec(inner))) present.add(m[1])
  const args = db.splitTop(text.slice(j + 1, open)).map(a => a.trim())
  return { callee, arg: commas, present, open, callOpen: j, args }
}
// 外部ライブラリの関数の引数 (テーブル) に書けるキー
export function extCallOptions(callee, arg, ctx) {
  const chain = parseChain(callee)
  if (!chain || !chain.steps.length) return null
  const last = chain.steps[chain.steps.length - 1]
  if (last.op !== '.' && last.op !== ':') return null
  const parent = resolveChain({ root: chain.root, steps: chain.steps.slice(0, -1) }, ctx)
  if (!parent || parent.k !== 'ext') return null
  const m = membersOfRef(parent.api, parent.ref).get(last.name)
  if (!m || m.k !== 'fn') return null
  const idx = arg + (last.op === ':' && !m.method ? 1 : 0) - (last.op === '.' && m.method ? 1 : 0)
  const o = (m.opts || []).find(x => x[0] === idx)
  return { m, opts: o ? o[1] : null, parent, name: last.name }
}
function extTableKeys(text, pos, ctx) {
  const tc = tableArgAt(text, pos)
  if (!tc) return null
  const r = extCallOptions(tc.callee, tc.arg, { ...ctx, pos: tc.open })
  if (!r || !r.opts) return null
  return r.opts.filter(o => !tc.present.has(o[0])).map(([k, kind, def, fnParams], i) => {
    const fn = kind === 'function' || /Callback$/.test(k)
    const apply = fn ? snippet(`${k} = function(${(fnParams && fnParams.filter(x => x !== 'self').join(', ')) || 'Value'})\n\t\${}\nend,`)
      : kind === 'string' || (def && def.startsWith('"')) ? snippet(`${k} = "${ph(1, def && def !== '""' ? def.slice(1, -1) : k)}",`)
      : (() => { const v = def && def !== 'function' ? def : kind === 'boolean' ? 'false' : kind === 'number' ? '0' : kind === 'table' ? '{}' : 'nil'; return /[{}$\\]/.test(v) ? `${k} = ${v},` : snippet(`${k} = ${ph(1, v)},`) })()
    return { label: k, type: fn ? 'function' : 'property', detail: def ? `= ${def === 'function' ? 'function' : def}` : kind, info: `${r.parent.lib} の ${r.name} に渡す設定`, apply, boost: 20 - i * 0.1 }
  })
}

// Roblox API の関数に渡すテーブルのキー
const TWEENABLE = new Set(['float', 'double', 'int', 'int64', 'number', 'Vector3', 'Vector2', 'CFrame', 'Color3', 'UDim2', 'UDim', 'Rect', 'NumberRange'])
const TWEEN_POPULAR = ['Position', 'Size', 'CFrame', 'Transparency', 'BackgroundTransparency', 'BackgroundColor3', 'Color', 'TextTransparency', 'TextColor3', 'ImageTransparency', 'Rotation', 'AnchorPoint']
const NOTIFY_KEYS = [['Title', 'string', '"タイトル"'], ['Text', 'string', '"本文"'], ['Duration', 'number', '5'], ['Icon', 'string', '"rbxassetid://"'], ['Button1', 'string', '"OK"'], ['Button2', 'string', '"キャンセル"'], ['Callback', 'BindableFunction', null]]
const REQUEST_ASYNC_KEYS = [['Url', 'string', '"https://"'], ['Method', 'string', '"GET"'], ['Headers', 'table', '{}'], ['Body', 'string', '""'], ['Compress', 'Enum', 'Enum.HttpCompression.None']]
function apiTableKeys(text, pos, ctx) {
  const tc = tableArgAt(text, pos)
  if (!tc) return null
  const fill = (rows, info) => rows.filter(r => !tc.present.has(r[0])).map(([k, kind, def], i) => ({ label: k, type: 'property', detail: kind, info, apply: def ? snippet(`${k} = ${/^"/.test(def) ? `"${ph(1, def.slice(1, -1))}"` : ph(1, def)},`) : `${k} = `, boost: 20 - i * 0.1 }))
  // TweenService:Create(obj, info, { ... }) → obj のアニメーションできるプロパティ
  if (tc.arg === 2 && /:\s*Create$/.test(tc.callee)) {
    const cls = tweenTarget(text, pos, ctx)
    if (!cls) return null
    const out = []
    for (const m of db.classMembers(cls).values()) {
      if (m.kind !== 'p' || m.flags.includes('r') || m.flags.includes('d') || m.flags.includes('h') || !TWEENABLE.has(m.type) || tc.present.has(m.name)) continue
      const pi = TWEEN_POPULAR.indexOf(m.name)
      out.push({ label: m.name, type: 'property', detail: db.prettyType(m.type), info: `${cls} のプロパティ (Tween で変化させる目標値)`, apply: `${m.name} = `, boost: pi >= 0 ? 20 - pi * 0.1 : 0 })
    }
    return out.length ? out : null
  }
  // StarterGui:SetCore("SendNotification", { ... })
  if (tc.arg === 1 && /:\s*SetCore$/.test(tc.callee) && /^["']SendNotification["']$/.test(tc.args[0] || '')) return fill(NOTIFY_KEYS, 'SendNotification の設定')
  if (tc.arg === 0 && /:\s*RequestAsync$/.test(tc.callee)) return fill(REQUEST_ASYNC_KEYS, 'HttpService:RequestAsync の設定')
  return null
}

// ============================================================
// ホバー / シグネチャ
// ============================================================
export function describeAt(state, pos) {
  const w = state.wordAt(pos)
  if (!w) return null
  const line = state.doc.lineAt(w.from)
  const name = state.sliceDoc(w.from, w.to)
  const before = line.text.slice(0, w.from - line.from)
  const ctx = { text: docText(state), pos: w.from, index: 0 }
  const opm = /([.:])\s*$/.exec(before)
  let title = '', doc = '', meta = ''
  if (opm && !/\.\.\s*$/.test(before)) {
    const chainText = chainBefore(before, before.length - opm[0].length)
    const ty = resolveChain(parseChain(chainText), ctx)
    const ent = memberEntryOf(ty, name, opm[1])
    if (ent && ent.src === 'api') {
      const m = ent.m
      title = m.kind === 'p' ? `(プロパティ) ${m.owner}.${m.name}: ${db.prettyType(m.type)}` : m.kind === 'e' ? `(イベント) ${m.owner}.${m.name}${db.prettyType(m.type)}` : `(メソッド) ${m.owner}:${m.name}${db.prettyType(m.type)}`
      const tags = []
      if (m.flags.includes('r')) tags.push('読み取り専用')
      if (m.flags.includes('y')) tags.push('待機あり (Yields)')
      if (m.flags.includes('d')) tags.push('⚠ 非推奨')
      if (m.flags.includes('s')) tags.push('🔒 権限が必要 (通常のスクリプトでは使えない場合があります)')
      meta = tags.join(' ・ ')
      doc = SERVICE_DOCS[m.name] || ''
    } else if (ent && ent.src === 'data') {
      const e = ent.e
      let tail = e.kind === 'function' ? e.sig : ': ' + e.type
      if (ty && ty.k === 'usertable') {
        if (e.kind === 'function' && e.fnPos !== undefined) { const r = fnReturnType(ty.text || ctx.text, e.fnPos); if (r) tail += ': ' + typeLabel(r) }
        else if (e.kind === 'value') { const vt = stepType(ty, { op: '.', name }, ctx, 0); if (vt) tail = ': ' + typeLabel(vt) }
      }
      title = `${typeLabel(ty)}${opm[1]}${name}${tail}`
      doc = e.doc
    } else if (ty && ty.k === 'enum') {
      const items = db.enumItems(ty.name) || []
      const it = items.find(i => i[0] === name)
      if (it) title = `Enum.${ty.name}.${name} = ${it[1]}`
    } else if (ty && ty.k === 'enumRoot' && db.enumItems(name)) {
      title = `Enum.${name}`
      doc = `${db.enumItems(name).length} 個の項目: ` + db.enumItems(name).slice(0, 12).map(i => i[0]).join(', ') + (db.enumItems(name).length > 12 ? ' …' : '')
    } else if (ty && ty.k === 'class' && db.isService(name)) {
      title = `(サービス) ${name}`; doc = SERVICE_DOCS[name] || ''
    } else return null
  } else {
    const d = findDecl(ctx.text, name, w.from + 1)
    const g = LUAU_GLOBALS[name] || (intel.executor && EXECUTOR_GLOBALS[name])
    if (d && d.pos <= w.from) {
      const ty = nameType(name, ctx, 0)
      const ret = ty && ty.k === 'func' && ty.user ? fnReturnType(ty.text || ctx.text, ty.fnPos) : null
      const sigText = ty && ty.k === 'func' && ty.entry && ty.entry.e ? ty.entry.e.sig : d.params || '()'
      title = d.kind === 'func' || (ty && ty.k === 'func') ? `(関数) ${name}${sigText}${ret ? ': ' + typeLabel(ret) : ''}` : `(${d.kind === 'param' ? '引数' : d.kind === 'assign' ? 'グローバル' : d.kind === 'forin' || d.kind === 'fornum' ? 'ループ変数' : 'ローカル'}) ${name}${ty ? ': ' + typeLabel(ty) : ''}`
      if (ty && ty.k === 'usertable') { const n = userFields(ty).size; if (n) meta = `フィールド ${n} 個`; }
      if (ty && ty.k === 'class') doc = SERVICE_DOCS[ty.name] || ''
    } else if (g) {
      title = name + (g.kind === 'function' ? g.sig : ': ' + g.type)
      doc = g.doc
      if (g.group) meta = 'エグゼキューター API: ' + g.group
    } else if (LUAU_LIBS[name]) {
      title = `(ライブラリ) ${name}`
      doc = Object.keys(LUAU_LIBS[name]).slice(0, 14).join(', ') + ' …'
    } else if (ROBLOX_DATATYPES[name]) {
      title = `(データ型) ${name}`
      doc = Object.entries(ROBLOX_DATATYPES[name].ctor).map(([k, e]) => `${name}.${k}${e.kind === 'function' ? e.sig : ''}`).slice(0, 4).join('\n')
    } else if (KEYWORD_DOCS[name]) {
      title = name; doc = KEYWORD_DOCS[name]
    } else return null
  }
  return { from: w.from, to: w.to, title, doc, meta }
}

const KEYWORD_DOCS = {
  local: 'ローカル変数を宣言します (このブロックの中だけで有効)',
  ['function']: '関数を定義します。end で閉じます',
  ['if']: '条件分岐。if 条件 then ... elseif ... else ... end',
  ['for']: 'ループ。for i = 1, 10 do ... end / for k, v in pairs(t) do ... end',
  ['while']: '条件が真の間くり返します。while 条件 do ... end',
  ['repeat']: 'repeat ... until 条件 (条件が真になるまでくり返す)',
  ['return']: '関数から値を返します',
  ['break']: 'ループを抜けます',
  ['continue']: 'ループの次の周回へ進みます (Luau)',
  ['nil']: '値がないことを表します',
  ['then']: 'if / elseif の条件の後に書きます',
  ['do']: 'for / while の後、またはブロックの開始',
  ['end']: 'ブロックの終わり',
  ['and']: '論理積。a and b (a が偽なら a、そうでなければ b)',
  ['or']: '論理和。a or b (a が真なら a、そうでなければ b)。既定値の指定によく使います',
  ['not']: '論理否定',
  ['type']: '型の定義 (Luau)。type Name = {...}',
  ['export']: 'モジュールの外に型を公開 (Luau)',
}

// カーソル位置の関数呼び出しのシグネチャ
export function signatureAt(state, pos) {
  const start = Math.max(0, pos - 2000)
  const text = state.doc.sliceString(start, pos)
  let depth = 0, commas = 0, i
  for (i = text.length - 1; i >= 0; i--) {
    const c = text[i]
    if (c === '"' || c === "'") {
      const q = c
      i--
      while (i >= 0 && text[i] !== q) i--
      continue
    }
    if (c === ')' || c === ']' || c === '}') depth++
    else if (c === '[' || c === '{') { if (depth === 0) return null; depth-- }
    else if (c === '(') {
      if (depth === 0) break
      depth--
    } else if (c === ',' && depth === 0) commas++
    else if (c === '\n' && /\b(then|do|end)\s*$/.test(text.slice(0, i))) return null
  }
  if (i < 0) return null
  const callee = chainBefore(text, i)
  if (!callee || /^(function|if|while|and|or|not|return|local)$/.test(callee)) return null
  const chain = parseChain(callee)
  if (!chain) return null
  const ctx = { text: docText(state), pos, index: 0 }
  let sig = null, label = callee, doc = ''
  const last = chain.steps[chain.steps.length - 1]
  if (!last) {
    // 自分で定義した関数を優先
    const d = chain.root.t === 'name' ? findDecl(ctx.text, chain.root.name, pos) : null
    const g = LUAU_GLOBALS[chain.root.name] || (intel.executor && EXECUTOR_GLOBALS[chain.root.name])
    if (d && d.kind === 'func' && d.params) { sig = d.params; doc = 'このファイルで定義した関数' }
    else if (d && (d.kind === 'local' || d.kind === 'assign') && /^\s*function\s*\(/.test(d.expr || '')) { sig = /^\s*function\s*(\([^)]*\))/.exec(d.expr)[1]; doc = 'このファイルで定義した関数' }
    else if (g && g.sig && !d) { sig = g.sig; doc = g.doc }
  } else if (last.op === '.' || last.op === ':') {
    const parent = resolveChain({ root: chain.root, steps: chain.steps.slice(0, -1) }, ctx)
    const ent = memberEntryOf(parent, last.name, last.op)
    if (ent && ent.src === 'api' && (ent.m.kind === 'f' || ent.m.kind === 'c')) { sig = ent.m.type; label = `${typeLabel(parent)}${last.op}${last.name}` }
    else if (ent && ent.src === 'data' && ent.e.sig) { sig = ent.e.sig; doc = ent.e.doc; label = `${typeLabel(parent)}${last.op}${last.name}` }
  }
  if (!sig) return null
  const params = db.paramsOf(sig)
  return { label, params, active: Math.min(commas, Math.max(0, params.length - 1)), ret: db.returnType(sig), doc, pos: start + i }
}

export { db }
