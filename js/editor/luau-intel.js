// Luau の賢い補完・ホバー・シグネチャヘルプ
// テキストから変数の型を推論し (例: local Players = game:GetService("Players") → Players クラス)、
// Roblox API のメンバーを候補に出します。
import * as db from './apidb.js'
import { LUAU_GLOBALS, LUAU_LIBS, ROBLOX_DATATYPES, SERVICE_DOCS, LUAU_KEYWORDS, LUAU_TYPES } from '../data/luau-api.js'
import { EXECUTOR_GLOBALS, EXECUTOR_LIBS, DRAWING_PROPS, EXECUTOR_GAME_METHODS } from '../data/executor-api.js'
import { LUAU_SNIPPETS } from '../data/snippets.js'
import { snippet, snippetCompletion, syntaxTree } from '../../vendor/codemirror.js'

export const intel = { executor: true, roblox: true, snippets: true }

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
export function fromTypeName(t) {
  if (!t) return null
  t = t.trim().replace(/\?$/, '')
  if (t.startsWith('Enum.')) return { k: 'enumItem', enum: t.slice(5) }
  switch (t) {
    case 'string': case 'Content': case 'ContentId': return { k: 'string' }
    case 'number': case 'int': case 'int64': case 'float': case 'double': return { k: 'number' }
    case 'bool': case 'boolean': return { k: 'bool' }
    case 'Instances': case 'Objects': case '{Instance}': return { k: 'classArray', name: 'Instance' }
    case 'RBXScriptSignal': return { k: 'signal', params: [] }
    case 'RBXScriptConnection': return { k: 'conn' }
    case 'buffer': return { k: 'lib', name: 'buffer' }
  }
  const arr = /^\{(\w+)\}$/.exec(t)
  if (arr && db.isClass(arr[1])) return { k: 'classArray', name: arr[1] }
  if (db.isClass(t)) return { k: 'class', name: t }
  if (ROBLOX_DATATYPES[t]) return { k: 'dt', name: t }
  if (t === 'Drawing') return { k: 'drawing', name: 'Line' }
  return null
}

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
    default: return ty.k
  }
}

// ============================================================
// 宣言の検索 (正規表現ベース: 書きかけのコードでも動作)
// ============================================================
function findDecl(text, name, before) {
  const src = text.slice(0, before)
  let best = null
  const consider = d => { if (!best || d.pos >= best.pos) best = d }
  const esc = name.replace(/[$]/g, '\\$')
  let re = new RegExp(`\\blocal\\s+((?:[A-Za-z_]\\w*\\s*(?::\\s*[^,=\\n]+?)?\\s*,\\s*)*?)\\b${esc}\\b\\s*(?::\\s*([^=\\n]+?))?\\s*(?:,[^=\\n]*)?(?:=\\s*([^\\n]*))?$`, 'gm')
  let m
  while ((m = re.exec(src))) {
    const idx = m[1] ? m[1].split(',').filter(x => x.trim()).length : 0
    consider({ pos: m.index, kind: 'local', anno: m[2], expr: m[3], index: idx })
  }
  re = new RegExp(`\\blocal\\s+function\\s+${esc}\\b`, 'g')
  while ((m = re.exec(src))) consider({ pos: m.index, kind: 'func' })
  re = new RegExp(`\\bfor\\s+([\\w\\s,]*?\\b${esc}\\b[\\w\\s,]*?)\\s+in\\s+([^\\n]*?)\\s+do\\b`, 'g')
  while ((m = re.exec(src))) {
    const vars = m[1].split(',').map(v => v.trim())
    consider({ pos: m.index, kind: 'forin', index: vars.indexOf(name), expr: m[2] })
  }
  re = /\bfunction\b\s*([\w.:]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g
  while ((m = re.exec(src))) {
    const params = m[2].split(',').map(p => p.trim())
    const idx = params.findIndex(p => p.split(':')[0].trim() === name)
    if (idx < 0) continue
    const p = params[idx]
    const anno = p.includes(':') ? p.slice(p.indexOf(':') + 1).trim() : null
    let signalExpr = null
    if (!m[1]) {
      const pre = src.slice(Math.max(0, m.index - 300), m.index)
      const cm = /([\w.:"'()[\]]+?)\s*:\s*(?:Connect|Once|ConnectParallel|connect)\s*\(\s*$/.exec(pre)
      if (cm) signalExpr = cm[1]
    }
    consider({ pos: m.index, kind: 'param', index: idx, anno, signalExpr, method: m[1] && m[1].includes(':') && name === 'self' })
  }
  re = new RegExp(`^\\s*${esc}\\s*=\\s*([^=\\n][^\\n]*)$`, 'gm')
  while ((m = re.exec(src))) consider({ pos: m.index, kind: 'assign', expr: m[1] })
  return best
}

// 式テキストの型
function exprType(expr, ctx, depth) {
  if (!expr || depth > 8) return null
  let e = expr.replace(/--.*$/, '').trim()
  // 複数代入の index 番目
  if (ctx.index > 0) {
    const parts = db.splitTop(e)
    e = (parts[ctx.index] || '').trim()
    ctx = { ...ctx, index: 0 }
  } else {
    e = db.splitTop(e)[0] || e
  }
  // a or b → a、a and b → b
  const orParts = splitKeyword(e, 'or')
  if (orParts.length > 1) e = orParts[0]
  const andParts = splitKeyword(e, 'and')
  if (andParts.length > 1) e = andParts[andParts.length - 1]
  e = e.trim().replace(/::.*$/, '')
  if (/^["'`]/.test(e)) return { k: 'string' }
  if (/^\d/.test(e)) return { k: 'number' }
  if (/^(true|false)\b/.test(e)) return { k: 'bool' }
  if (/^\{/.test(e)) return { k: 'table' }
  if (/^function\b/.test(e)) return { k: 'func' }
  const chain = parseChain(e)
  if (!chain) return null
  const ty = resolveChain(chain, ctx, depth + 1)
  if (ty && chain.rest.trim() && /^[+\-*/]/.test(chain.rest.trim()) && ty.k !== 'dt' && ty.k !== 'number') return null
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
      if (d.anno) { const t = fromTypeName(d.anno.trim()); if (t) return t }
      if (d.kind === 'local' || d.kind === 'assign') {
        const t = exprType(d.expr, { ...ctx, pos: d.pos, index: d.index || 0 }, depth)
        if (t) return t
      }
      if (d.kind === 'forin' && d.index >= 1) {
        const m = /^\s*i?pairs\s*\(([\s\S]*)\)\s*$/.exec(d.expr)
        const it = exprType(m ? m[1] : d.expr, { ...ctx, pos: d.pos, index: 0 }, depth)
        if (it && it.k === 'classArray') return { k: 'class', name: it.name }
      }
      if (d.kind === 'param' && d.signalExpr) {
        const sig = exprType(d.signalExpr, { ...ctx, pos: d.pos, index: 0 }, depth)
        if (sig && sig.k === 'signal' && sig.params[d.index]) return fromTypeName(sig.params[d.index])
      }
      if (d.kind === 'param' || d.kind === 'func') return null
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
  return null
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
    case 'dtlib': return ROBLOX_DATATYPES[ty.name].ctor[name] ? { src: 'data', e: ROBLOX_DATATYPES[ty.name].ctor[name] } : null
    case 'dt': {
      const d = ROBLOX_DATATYPES[ty.name]
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
  }
  return null
}

function stepType(ty, st, ctx, depth) {
  if (!ty) return null
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
        const e = ROBLOX_DATATYPES[ty.name].ctor[name]
        if (!e) return null
        if (e.kind === 'value') return fromTypeName(e.type)
        return { k: 'func', entry: { src: 'data', e } }
      }
      case 'dt': {
        const e = ROBLOX_DATATYPES[ty.name].props[name]
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
      case 'drawing': return null
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
        if (m && m.kind === 'f') return fromTypeName(db.returnType(m.type))
        return null
      }
      case 'signal':
        if (name === 'Connect' || name === 'Once' || name === 'ConnectParallel' || name === 'connect') return { k: 'conn' }
        if (name === 'Wait') return ty.params[0] ? fromTypeName(ty.params[0]) : null
        return null
      case 'dt': {
        const e = ROBLOX_DATATYPES[ty.name].methods[name]
        return e ? fromTypeName(db.returnType(e.sig)) : null
      }
      case 'string': {
        const e = LUAU_LIBS.string[name]
        if (!e) return null
        const r = db.returnType(e.sig)
        return r && /string/.test(r) && !/\(/.test(r) ? { k: 'string' } : r === 'number' ? { k: 'number' } : null
      }
      case 'enum': return name === 'GetEnumItems' ? null : { k: 'enumItem', enum: ty.name }
    }
    return null
  }
  if (st.op === 'call') {
    if (ty.k === 'func') {
      const e = ty.entry
      if (ty.lib === 'Instance' || (e.src === 'data' && ty.name === 'new' && ty.lib === undefined)) { /* below */ }
      const a0 = strArg(st.args[0])
      if (e.src === 'data' && e.e.sig && /^\(className: string/.test(e.e.sig) && a0) return { k: 'class', name: a0 }
      if (e.src === 'data' && e.e.sig) return fromTypeName(db.returnType(e.e.sig))
      if (e.src === 'api') return fromTypeName(db.returnType(e.m.type))
    }
    return null
  }
  if (st.op === '[]') {
    if (ty.k === 'classArray') return { k: 'class', name: ty.name }
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
      if (g && g.sig) ty = { k: 'func', entry: { src: 'data', e: g } }
    }
  } else if (r.t === 'string') ty = { k: 'string' }
  else if (r.t === 'paren') ty = exprType(r.inner, { ...ctx, index: 0 }, depth + 1)
  else if (r.t === 'table') ty = { k: 'table' }
  else if (r.t === 'number') ty = { k: 'number' }
  for (const st of chain.steps) {
    ty = stepType(ty, st, ctx, depth)
    if (!ty) return null
  }
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

function apiMemberItems(cls, op) {
  const out = []
  for (const m of db.classMembers(cls).values()) {
    if (op === ':' && m.kind !== 'f') continue
    if (op === '.' && m.kind === 'f') continue
    const dep = m.flags.includes('d')
    const hidden = m.flags.includes('s') || (m.flags.includes('h') && !POPULAR.has(m.name))
    const boost = (POPULAR.has(m.name) ? 20 : 0) + (m.owner === cls ? 5 : 0) - (dep ? 60 : 0) - (hidden ? 30 : 0) - (m.owner === 'Instance' && !POPULAR.has(m.name) ? 3 : 0)
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

function membersFor(ty, op) {
  if (!ty) return null
  switch (ty.k) {
    case 'class': return apiMemberItems(ty.name, op)
    case 'dtlib': return op === '.' ? dataItems(ROBLOX_DATATYPES[ty.name].ctor, op, ty.name + '.') : null
    case 'dt': {
      const d = ROBLOX_DATATYPES[ty.name]
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
    case 'drawing': {
      const props = [...DRAWING_PROPS.common, ...Object.values(DRAWING_PROPS).flat()]
      return [...new Set(props)].map(p => { const [n, t] = p.split(': '); return { label: n.replace('()', ''), type: t ? 'property' : 'method', detail: t || '' } })
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
        ? { label: name, type: 'function', detail: e.sig, info: dataInfo(name, e), apply: fnApply(name, !/^\(\)/.test(e.sig)), boost: -1 }
        : { label: name, type: 'namespace', detail: e.type, info: dataInfo(name, e), boost: -1 })
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

function docWords(state, exclude) {
  const text = state.doc.sliceString(0, Math.min(state.doc.length, 300000))
  const words = new Set()
  const re = /[A-Za-z_][\w]{2,}/g
  let m
  while ((m = re.exec(text))) words.add(m[0])
  words.delete(exclude)
  const kw = new Set(LUAU_KEYWORDS)
  return [...words].filter(w => !kw.has(w)).map(w => ({ label: w, type: 'text', boost: -5 }))
}

function inCommentOrString(state, pos) {
  const tree = syntaxTree(state)
  const node = tree.resolveInner(pos, -1)
  const name = node.name || ''
  return /comment/i.test(name) ? 'comment' : /string/i.test(name) ? 'string' : null
}

const STRING_ARG_FNS = {
  GetService: 'service', FindService: 'service', new: 'creatable', IsA: 'class', FindFirstChildOfClass: 'class', FindFirstChildWhichIsA: 'class',
  FindFirstAncestorOfClass: 'class', FindFirstAncestorWhichIsA: 'class', GetPropertyChangedSignal: 'prop', WaitForChild: 'child', FindFirstChild: 'child',
}

export function luauCompletionSource(context) {
  const { state, pos } = context
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  const where = inCommentOrString(state, pos)
  const ctx = { text: state.doc.sliceString(0, pos), pos, index: 0 }

  // 文字列引数: GetService("|") など
  const sm = /([\w.:"()[\]]*?)\b(\w+)\s*\(\s*["']([\w ]*)$/.exec(before)
  if (sm && STRING_ARG_FNS[sm[2]]) {
    const kind = STRING_ARG_FNS[sm[2]]
    const from = pos - sm[3].length
    let options = []
    if (kind === 'service') options = db.serviceNames().map(n => ({ label: n, type: 'class', detail: 'サービス', info: SERVICE_DOCS[n] || '', boost: SERVICE_DOCS[n] ? 10 : 0 }))
    else if (kind === 'creatable') {
      if (!/Instance\s*\.\s*new\s*\(\s*["'][\w ]*$/.test(before)) return null
      const common = ['Part', 'Model', 'Folder', 'ScreenGui', 'Frame', 'TextLabel', 'TextButton', 'ImageLabel', 'TextBox', 'RemoteEvent', 'RemoteFunction', 'BindableEvent', 'IntValue', 'StringValue', 'BoolValue', 'NumberValue', 'ObjectValue', 'Sound', 'PointLight', 'Attachment', 'Weld', 'WeldConstraint', 'Highlight', 'BillboardGui', 'SurfaceGui', 'UICorner', 'UIStroke', 'UIListLayout', 'UIGridLayout', 'UIPadding', 'Tool', 'ProximityPrompt', 'ClickDetector', 'Animation', 'ParticleEmitter', 'Beam', 'Trail', 'MeshPart', 'UnionOperation', 'Decal', 'Texture', 'SpecialMesh', 'BodyVelocity', 'LinearVelocity', 'AlignPosition', 'VectorForce', 'Humanoid']
      options = db.creatableClasses().map(n => ({ label: n, type: 'class', detail: db.isDeprecatedClass(n) ? '⚠ 非推奨' : 'クラス', boost: common.includes(n) ? 10 - common.indexOf(n) * 0.1 : db.isDeprecatedClass(n) ? -20 : 0 }))
    } else if (kind === 'class') options = db.allClasses().map(n => ({ label: n, type: 'class', boost: ['BasePart', 'Part', 'Model', 'Humanoid', 'Player', 'GuiObject', 'TextButton', 'Folder', 'Script', 'LocalScript', 'ModuleScript'].includes(n) ? 5 : 0 }))
    else if (kind === 'prop' || kind === 'child') {
      const nameStart = before.length - sm[0].length + sm[1].length
      const objChain = chainBefore(before, nameStart - 1)
      const ty = resolveChain(parseChain(objChain), ctx)
      if (kind === 'prop' && ty && ty.k === 'class') options = [...db.classMembers(ty.name).values()].filter(m => m.kind === 'p').map(m => ({ label: m.name, type: 'property', detail: db.prettyType(m.type) }))
      if (kind === 'child' && ty && ty.k === 'class') {
        const hints = ty.name === 'DataModel' ? db.serviceNames() : (CHILD_SUGGEST[ty.name] || Object.keys(CHILD_HINTS))
        options = hints.map(h => ({ label: h, type: 'variable', detail: '子オブジェクト' }))
      }
      if (kind === 'child' && !options.length) options = Object.keys(CHILD_HINTS).map(h => ({ label: h, type: 'variable', detail: '子オブジェクト' }))
    }
    if (!options.length) return null
    return { from, options, validFor: /^[\w ]*$/ }
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
      if (op === ':' && /\blocal\s+[\w\s,]*$/.test(before.slice(0, chainEnd)) || op === ':' && /\bfunction\b[^)]*\([^)]*$/.test(before)) {
        const types = [...LUAU_TYPES, ...(intel.roblox ? db.creatableClasses().slice(0, 0) : [])]
        return { from: pos - typed.length, options: types.map(tn => ({ label: tn, type: 'type' })).concat(intel.roblox ? ['Player', 'Players', 'Workspace', 'Model', 'BasePart', 'Humanoid', 'Tool', 'ScreenGui', 'Frame', 'TextLabel', 'TextButton', 'RemoteEvent'].map(n => ({ label: n, type: 'class' })) : []), validFor: /^\w*$/ }
      }
      const chain = parseChain(chainText)
      const ty = resolveChain(chain, ctx)
      let options = membersFor(ty, op)
      if (!options) {
        if (!typed && !context.explicit && op === ':' ) return null
        // 型不明: Instance と仮定 / 単語補完
        options = op === ':' && intel.roblox ? apiMemberItems('Instance', ':') : docWords(state, typed)
      }
      return { from: pos - typed.length, options, validFor: /^\w*$/ }
    }
  }

  // 識別子
  const word = context.matchBefore(/[A-Za-z_]\w*/)
  if (!word && !context.explicit) return null
  if (word && word.from === word.to && !context.explicit) return null
  const from = word ? word.from : pos
  const typed = word ? word.text : ''
  return { from, options: [...globalItems(), ...docWords(state, typed)], validFor: /^\w*$/ }
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
  const ctx = { text: state.doc.sliceString(0, w.from), pos: w.from, index: 0 }
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
      title = `${typeLabel(ty)}${opm[1]}${name}${e.kind === 'function' ? e.sig : ': ' + e.type}`
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
    const d = findDecl(state.doc.sliceString(0, w.from + name.length + 1), name, w.from + 1)
    const g = LUAU_GLOBALS[name] || (intel.executor && EXECUTOR_GLOBALS[name])
    if (d && d.pos < w.from) {
      const ty = nameType(name, { ...ctx, text: state.doc.sliceString(0, w.from), pos: w.from }, 0)
      title = `(${d.kind === 'param' ? '引数' : d.kind === 'func' ? '関数' : d.kind === 'assign' ? 'グローバル' : 'ローカル'}) ${name}${ty ? ': ' + typeLabel(ty) : ''}`
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
  const ctx = { text: state.doc.sliceString(0, pos), pos, index: 0 }
  let sig = null, label = callee, doc = ''
  const last = chain.steps[chain.steps.length - 1]
  if (!last) {
    const g = LUAU_GLOBALS[chain.root.name] || (intel.executor && EXECUTOR_GLOBALS[chain.root.name])
    if (g && g.sig) { sig = g.sig; doc = g.doc }
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
