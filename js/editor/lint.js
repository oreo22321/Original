// エラー・警告の表示 (Luau / Lua / Python)
import { linter } from '../../vendor/codemirror.js'
import { parse } from '../luau/parser.js'
import { LuauSyntaxError } from '../luau/lexer.js'
import { LUAU_GLOBALS, LUAU_LIBS, ROBLOX_DATATYPES } from '../data/luau-api.js'
import { EXECUTOR_GLOBALS } from '../data/executor-api.js'

const LIB_NAMES = new Set(Object.keys(LUAU_LIBS).concat(['bit32', 'utf8', 'buffer', 'io']))
const INSTANCE_METHODS = new Set(['GetService', 'FindFirstChild', 'WaitForChild', 'FindFirstChildOfClass', 'FindFirstChildWhichIsA', 'GetChildren', 'GetDescendants', 'Destroy', 'Clone', 'IsA', 'Connect', 'Disconnect', 'GetPropertyChangedSignal', 'SetAttribute', 'GetAttribute', 'FireServer', 'FireClient', 'FireAllClients', 'InvokeServer', 'Fire', 'Play', 'Stop', 'TakeDamage', 'MoveTo', 'GetPlayers', 'Kick', 'GetMouse', 'LoadAnimation', 'Create', 'GetAsync', 'SetAsync', 'UpdateAsync', 'JSONEncode', 'JSONDecode', 'HttpGet', 'ClearAllChildren', 'GetFullName', 'PivotTo', 'GetPivot', 'Raycast'])

function knownGlobals(opts) {
  const s = new Set(Object.keys(LUAU_GLOBALS))
  for (const k of LIB_NAMES) s.add(k)
  for (const k of Object.keys(ROBLOX_DATATYPES)) s.add(k)
  ;['Game', 'Workspace', 'Instance', 'Enum', 'self', 'arg', 'io', 'getfenv', 'setfenv', 'load', 'dofile', 'loadfile', 'stats', 'PluginManager', 'DebuggerManager', 'gcinfo', 'Delay', 'Spawn', 'Wait', 'Version', 'ElapsedTime'].forEach(n => s.add(n))
  if (opts.executor) {
    for (const k of Object.keys(EXECUTOR_GLOBALS)) s.add(k)
    ;['syn', 'fluxus', 'http', 'base64', 'base64_encode', 'base64_decode', 'getconstants', 'getupvalues', 'getupvalue', 'setupvalue', 'getinfo', 'Drawing', 'crypt', 'cache', 'WebSocket', 'consoleprint', 'consoleclear', 'toclipboard', 'setrbxclipboard', 'getsynasset', 'detour_function', 'make_writeable', 'isourclosure', 'getsimulationradius', 'setsimulationradius', 'sethiddenprop', 'gethiddenprop', 'isnetworkowner', 'queueonteleport', 'getexecutorname', 'getscripts', 'getcustomasset', 'rconsolename', 'gethwid', 'request', 'http_request', 'getgenv', 'getrenv', 'KRNL_LOADED', 'is_sirhurt_closure', 'pebc_execute', 'Krnl', 'secure_load', 'getidentity'].forEach(n => s.add(n))
  }
  return s
}

// ---- AST 走査: 未定義の変数・未使用のローカル・非推奨 API ----
function analyze(ast, src, opts) {
  const diags = []
  const known = knownGlobals(opts)
  const assignedGlobals = new Set()
  const unknownRefs = []
  const scopes = []
  const push = () => scopes.push(new Map())
  const pop = () => {
    const sc = scopes.pop()
    for (const v of sc.values()) {
      if (!v.used && !v.name.startsWith('_') && v.kind !== 'param' && opts.unused !== false && v.s !== undefined) {
        diags.push({ from: v.s, to: v.e, severity: 'hint', message: `'${v.name}' は使われていません`, markClass: 'cm-unused' })
      }
    }
  }
  const declare = (name, s, e, kind = 'local') => { scopes[scopes.length - 1].set(name, { name, s, e, used: false, kind }) }
  const lookup = name => { for (let i = scopes.length - 1; i >= 0; i--) { const v = scopes[i].get(name); if (v) return v } return null }
  const ref = node => {
    const v = lookup(node.name)
    if (v) v.used = true
    else if (!known.has(node.name)) unknownRefs.push(node)
  }

  const fix = (label, from, to, insert) => ({ name: label, apply(view) { view.dispatch({ changes: { from, to, insert } }) } })

  function expr(e) {
    if (!e) return
    switch (e.t) {
      case 'Name': ref(e); break
      case 'Index': expr(e.obj); if (!e.dot) expr(e.key); break
      case 'Call': {
        if (e.fn.t === 'Name' && !lookup(e.fn.name) && opts.roblox) {
          const n = e.fn.name
          if (n === 'wait' || n === 'spawn' || n === 'delay') {
            diags.push({ from: e.fn.s, to: e.fn.e, severity: 'info', message: `${n}() は非推奨です。task.${n}() を使うと正確で高速です`, actions: [fix(`task.${n} に置き換え`, e.fn.s, e.fn.e, 'task.' + n)] })
          }
        }
        if (e.fn.t === 'Index' && e.fn.dot && e.fn.obj.t === 'Name' && e.fn.obj.name === 'Instance' && e.fn.key.v === 'new' && e.args.length >= 2 && opts.roblox) {
          diags.push({ from: e.s, to: e.e, severity: 'info', message: 'Instance.new の第 2 引数 (Parent) は非推奨です。プロパティを設定した後に .Parent を設定するとパフォーマンスが良くなります' })
        }
        if (opts.roblox && e.fn.t === 'Index' && e.fn.dot && e.fn.keyS !== undefined && INSTANCE_METHODS.has(e.fn.key.v)) {
          const obj = e.fn.obj
          const objName = obj.t === 'Name' ? obj.name : null
          const isLib = objName && (LIB_NAMES.has(objName) || ROBLOX_DATATYPES[objName] || tableLocals.has(objName))
          // obj.Method(obj, ...) の形は正しい
          const passesSelf = objName && e.args[0] && e.args[0].t === 'Name' && e.args[0].name === objName
          if (!isLib && !passesSelf) {
            diags.push({ from: e.fn.keyS - 1, to: e.fn.keyS, severity: 'warning', message: `メソッドの呼び出しは '.' ではなく ':' を使います (${e.fn.key.v})`, actions: [fix("':' に置き換え", e.fn.keyS - 1, e.fn.keyS, ':')] })
          }
        }
        expr(e.fn); e.args.forEach(expr)
        break
      }
      case 'Method': {
        if (e.name === 'connect' && opts.roblox && e.keyS !== undefined) diags.push({ from: e.keyS, to: e.keyS + 7, severity: 'warning', message: ':connect は非推奨です。:Connect を使ってください', actions: [fix('Connect に置き換え', e.keyS, e.keyS + 7, 'Connect')] })
        expr(e.obj); e.args.forEach(expr)
        break
      }
      case 'Bin': expr(e.l); expr(e.r); break
      case 'Un': expr(e.e); break
      case 'Paren': case 'Cast': expr(e.e); break
      case 'Func': func(e); break
      case 'Table': for (const it of e.items) { if (it.k === 'expr') expr(it.key); expr(it.value) } break
      case 'IfExpr': for (const c of e.clauses) { expr(c.cond); expr(c.val) } expr(e.orelse); break
      case 'Interp': for (const p of e.parts) if (typeof p !== 'string') expr(p); break
    }
  }
  const tableLocals = new Set()

  function func(f, selfParam) {
    push()
    if (selfParam || f.isMethod) declare('self', undefined, undefined, 'param')
    for (const p of f.params) declare(p.name, p.s, p.e, 'param')
    block(f.body, false)
    pop()
  }

  function block(stats, newScope = true) {
    if (newScope) push()
    for (const st of stats) stat(st)
    if (newScope) pop()
  }

  function stat(st) {
    switch (st.t) {
      case 'Local':
        st.values.forEach(expr)
        st.names.forEach((n, i) => {
          declare(n.name, n.s, n.e)
          const v = st.values[i]
          if (v && (v.t === 'Table' || (v.t === 'Call' && v.fn.t === 'Name' && v.fn.name === 'require'))) tableLocals.add(n.name)
        })
        break
      case 'LocalFunction':
        declare(st.name.name, st.name.s, st.name.e, 'func')
        func(st.func)
        break
      case 'Function':
        if (st.target.t === 'Name') {
          const v = lookup(st.target.name)
          if (v) v.used = true
          else assignedGlobals.add(st.target.name)
        } else expr(st.target.obj || st.target)
        func(st.func, st.isMethod)
        break
      case 'Assign':
        st.values.forEach(expr)
        for (const t of st.targets) {
          if (t.t === 'Name') {
            const v = lookup(t.name)
            if (!v) assignedGlobals.add(t.name)
          } else expr(t)
        }
        break
      case 'Compound':
        expr(st.value)
        if (st.target.t === 'Name') ref(st.target); else expr(st.target)
        break
      case 'CallStat': expr(st.call); break
      case 'If':
        for (const c of st.clauses) { expr(c.cond); block(c.body) }
        if (st.orelse) block(st.orelse)
        break
      case 'While': expr(st.cond); block(st.body); break
      case 'Repeat':
        push()
        for (const s of st.body) stat(s)
        expr(st.cond)
        pop()
        break
      case 'NumFor':
        expr(st.start); expr(st.stop); expr(st.step)
        push(); declare(st.var.name, st.var.s, st.var.e, 'param'); block(st.body, false); pop()
        break
      case 'GenFor':
        st.exprs.forEach(expr)
        push(); st.vars.forEach(v => declare(v.name, v.s, v.e, 'param')); block(st.body, false); pop()
        break
      case 'Do': block(st.body); break
      case 'Return': st.values.forEach(expr); break
    }
  }

  push()
  block(ast.body, false)
  pop()
  if (opts.undefinedGlobals !== false) {
    for (const n of unknownRefs) {
      if (assignedGlobals.has(n.name)) continue
      diags.push({ from: n.s, to: n.e, severity: 'warning', message: `'${n.name}' は定義されていません (スペルミスか、宣言前の使用の可能性があります)` })
    }
  }
  return diags
}

export function lintLuau(src, opts = {}) {
  let ast
  try {
    ast = parse(src)
  } catch (e) {
    if (e instanceof LuauSyntaxError) {
      const from = Math.min(Math.max(0, e.pos ?? 0), src.length)
      let to = from
      while (to < src.length && /[\w]/.test(src[to])) to++
      if (to === from) to = Math.min(src.length, from + 1)
      return [{ from, to, severity: 'error', message: e.message, source: '構文' }]
    }
    return []
  }
  try {
    return analyze(ast, src, opts)
  } catch {
    return []
  }
}

// ---- Python (簡易チェック) ----
export function lintPython(src) {
  const diags = []
  const stack = []
  const lines = src.split('\n')
  let offset = 0
  let inTriple = null
  let indentStyle = null
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln]
    let code = ''
    let i = 0
    let inStr = null
    while (i < line.length) {
      const c = line[i]
      if (inTriple) {
        if (line.startsWith(inTriple, i)) { i += 3; inTriple = null; continue }
        i++
        continue
      }
      if (inStr) {
        if (c === '\\') { i += 2; continue }
        if (c === inStr) inStr = null
        i++
        code += ' '
        continue
      }
      if (c === '#') break
      if ((c === '"' || c === "'") && line.startsWith(c.repeat(3), i)) { inTriple = c.repeat(3); i += 3; code += ' '; continue }
      if (c === '"' || c === "'") { inStr = c; i++; code += ' '; continue }
      if ('([{'.includes(c)) stack.push({ c, pos: offset + i })
      else if (')]}'.includes(c)) {
        const open = stack.pop()
        const want = { ')': '(', ']': '[', '}': '{' }[c]
        if (!open || open.c !== want) diags.push({ from: offset + i, to: offset + i + 1, severity: 'error', message: `対応する '${want}' がない '${c}' です` })
      }
      code += c
      i++
    }
    const lead = /^[ \t]*/.exec(line)[0]
    if (line.trim() && lead) {
      const style = lead.includes('\t') ? (lead.includes(' ') ? 'mixed' : 'tab') : 'space'
      if (style === 'mixed' || (indentStyle && style !== indentStyle)) diags.push({ from: offset, to: offset + lead.length, severity: 'warning', message: 'インデントにタブとスペースが混在しています' })
      else if (!indentStyle) indentStyle = style
    }
    if (!stack.length && !inTriple) {
      const t = code.trim()
      const m = /^(if|elif|else|for|while|def|class|try|except|finally|with|async\s+def|async\s+for|async\s+with|match|case)\b/.exec(t)
      if (m && !t.endsWith(':') && !t.endsWith('\\') && !(m[1] === 'match' && !/^match\s+\S/.test(t)) && !(m[1] === 'case' && !/^case\s+\S/.test(t))) {
        if (!(m[1] === 'else' && /\bif\b/.test(t) === false && t !== 'else' && /[=(]/.test(t))) {
          diags.push({ from: offset + line.length, to: offset + line.length, severity: 'error', message: `行末に ':' が必要です (${m[1]})` })
        }
      }
      if (/^print\s+["'\w]/.test(t) && !/^print\s*\(/.test(t)) diags.push({ from: offset, to: offset + line.length, severity: 'error', message: 'Python 3 では print(...) と括弧が必要です' })
    }
    offset += line.length + 1
  }
  for (const o of stack) diags.push({ from: o.pos, to: o.pos + 1, severity: 'error', message: `'${o.c}' が閉じられていません` })
  if (inTriple) diags.push({ from: src.length, to: src.length, severity: 'error', message: '三重引用符の文字列が閉じられていません' })
  return diags
}

export function makeLinter(getLang, getOpts) {
  return linter(view => {
    const lang = getLang()
    const opts = getOpts()
    if (!opts.enabled) return []
    const src = view.state.doc.toString()
    if (src.length > 400000) return []
    if (lang === 'luau' || lang === 'lua') return lintLuau(src, { ...opts, roblox: opts.roblox && lang === 'luau' || opts.roblox && opts.robloxForLua })
    if (lang === 'python') return lintPython(src)
    return []
  }, { delay: 500 })
}
