// エラー・警告の表示 (Luau)
// ・構文エラー (どのブロックの end が足りないかまで特定)
// ・誤字: 定義されていない名前 / 存在しないメンバー・サービス・クラス・Enum に「もしかして」を提案
// ・全角文字やスマート引用符の混入
// ・Roblox でよくある間違い ('.' と ':' / 非推奨 API / サーバーとクライアントの取り違え / 待機のない無限ループ)
import { linter } from '../../vendor/codemirror.js'
import { parse } from '../luau/parser.js'
import { LuauSyntaxError } from '../luau/lexer.js'
import { LUAU_GLOBALS, LUAU_LIBS, ROBLOX_DATATYPES, LUAU_KEYWORDS } from '../data/luau-api.js'
import { EXECUTOR_GLOBALS, EXECUTOR_LIBS, DRAWING_KINDS, isExecutorOnly } from '../data/executor-api.js'
import * as db from './apidb.js'
import { resolveChain, parseChain, memberNamesOf, declPos, typeLabel, docText, intel, scanLoadstringUrls } from './luau-intel.js'
import { diagnoseBlocks, lightTokens, scanBlocks } from './blocks.js'
import { typeDiagnostics } from './typecheck.js'
import { nearest, typoLimit, editDistance, fixChar, fixCode, hasSuspect, describeChar, KEYWORD_FIXES } from './typo.js'

const STD_LIBS = new Set(['string', 'table', 'math', 'task', 'coroutine', 'os', 'utf8', 'bit32', 'buffer'])
const LIB_NAMES = new Set(Object.keys(LUAU_LIBS).concat(['bit32', 'utf8', 'buffer', 'io']))
const INSTANCE_METHODS = new Set(['GetService', 'FindFirstChild', 'WaitForChild', 'FindFirstChildOfClass', 'FindFirstChildWhichIsA', 'GetChildren', 'GetDescendants', 'Destroy', 'Clone', 'IsA', 'Connect', 'Disconnect', 'GetPropertyChangedSignal', 'SetAttribute', 'GetAttribute', 'FireServer', 'FireClient', 'FireAllClients', 'InvokeServer', 'Fire', 'Play', 'Stop', 'TakeDamage', 'MoveTo', 'GetPlayers', 'Kick', 'GetMouse', 'LoadAnimation', 'Create', 'GetAsync', 'SetAsync', 'UpdateAsync', 'JSONEncode', 'JSONDecode', 'HttpGet', 'ClearAllChildren', 'GetFullName', 'PivotTo', 'GetPivot', 'Raycast'])
const CLASS_ARG_METHODS = new Set(['IsA', 'FindFirstChildOfClass', 'FindFirstChildWhichIsA', 'FindFirstAncestorOfClass', 'FindFirstAncestorWhichIsA'])
const BASE_GLOBALS = ['Game', 'Workspace', 'Instance', 'Enum', 'self', 'arg', 'io', 'getfenv', 'setfenv', 'load', 'dofile', 'loadfile', 'stats', 'PluginManager', 'DebuggerManager', 'gcinfo', 'Delay', 'Spawn', 'Wait', 'Version', 'ElapsedTime']
// 他の言語の書き方をしてしまったとき
const FOREIGN = {
  null: 'nil', undefined: 'nil', None: 'nil', NULL: 'nil', True: 'true', False: 'false', TRUE: 'true', FALSE: 'false',
  console: 'print', println: 'print', printf: 'print', echo: 'print', len: '#', var: 'local', let: 'local', const: 'local', def: 'function', elif: 'elseif',
}
// 待機しないことが分かっている関数 (無限ループの検出用)
const NO_YIELD_ROOTS = new Set(['print', 'warn', 'tostring', 'tonumber', 'type', 'typeof', 'table', 'string', 'math', 'bit32', 'utf8', 'os', 'tick', 'time', 'Instance', 'Vector3', 'Vector2', 'CFrame', 'Color3', 'UDim2', 'UDim', 'rawget', 'rawset', 'rawequal', 'select', 'ipairs', 'pairs', 'next', 'setmetatable', 'getmetatable', 'buffer'])
const NO_YIELD_METHODS = new Set(['Clone', 'Destroy', 'FindFirstChild', 'FindFirstChildOfClass', 'FindFirstChildWhichIsA', 'GetChildren', 'GetDescendants', 'IsA', 'GetAttribute', 'SetAttribute', 'GetPlayers', 'GetFullName', 'format', 'sub', 'lower', 'upper', 'len', 'rep', 'find', 'match', 'gsub'])

let knownCache = { executor: null, set: null }
function knownGlobals(executor) {
  if (knownCache.executor === executor) return knownCache.set
  const s = new Set(Object.keys(LUAU_GLOBALS))
  for (const k of LIB_NAMES) s.add(k)
  for (const k of Object.keys(ROBLOX_DATATYPES)) s.add(k)
  for (const n of BASE_GLOBALS) s.add(n)
  if (executor) {
    for (const k of Object.keys(EXECUTOR_GLOBALS)) s.add(k)
    for (const k of Object.keys(EXECUTOR_LIBS)) s.add(k)
    for (const n of ['KRNL_LOADED', 'is_sirhurt_closure', 'pebc_execute', 'Krnl', 'secure_load', 'getsynasset', 'syn_context_set', 'syn_context_get', 'OXYGEN_LOADED', 'IS_ELECTRON', 'Fluxus', 'PROTOSMASHER_LOADED', 'is_protosmasher_caller', 'get_calling_script', 'getmenv', 'getobjects', 'checkcaller', 'unlockmodulescript', 'setsimulationradius']) s.add(n)
  }
  knownCache = { executor, set: s }
  return s
}

// ---- 直し方 ----
// 直し方はデータで表します (ワーカーで調べた結果も、そのまま画面に渡せるように)。エディタで使うときに materialize で操作にします
//   { name, op: 'replace', text }      診断の範囲を text に置き換える
//   { name, op: 'string', text }       文字列リテラルの中身 (引用符の内側) を置き換える
//   { name, op: 'wrap', pre, post }    範囲を pre と post で囲む
//   { name, op: 'insertAtEnd', i }     範囲の後ろに i を入れる
//   { name, op: 'fixAllChars' }        ファイル全体の全角記号を直す
//   { name, op: 'blockMissing' | 'blockExtra' }  足りない end を足す / 余分な end を消す
//   { name, edits: [{ a, d, i }] }     範囲の始まりから a 文字目の d 文字を i に置き換える (複数可)
export function materialize(a) {
  if (!a || typeof a.apply === 'function') return a
  const run = (view, changes) => view.dispatch({ changes, userEvent: 'input.fix' })
  let apply
  switch (a.op) {
    case 'replace': apply = (view, from, to) => run(view, { from, to, insert: a.text }); break
    case 'string': apply = (view, from, to) => run(view, { from: from + 1, to: to - 1, insert: a.text }); break
    case 'wrap': apply = (view, from, to) => run(view, [{ from, insert: a.pre }, { from: to, insert: a.post }]); break
    case 'insertAtEnd': apply = (view, from, to) => run(view, { from: to, insert: a.i }); break
    case 'fixAllChars': apply = view => { const t = view.state.doc.toString(); const f = fixCode(t); if (f !== t) run(view, { from: 0, to: t.length, insert: f }) }; break
    case 'blockMissing': apply = view => { const d = diagnoseBlocks(view.state.doc.toString()).find(x => x.kind === 'missing'); if (d) run(view, { from: d.insertAt, insert: d.insertText }) }; break
    case 'blockExtra': apply = view => { const d = diagnoseBlocks(view.state.doc.toString()).find(x => x.kind === 'extra'); if (d) run(view, { from: d.removeFrom, to: d.removeTo }) }; break
    default:
      if (Array.isArray(a.edits)) apply = (view, from) => run(view, a.edits.map(e => ({ from: from + e.a, to: from + e.a + e.d, insert: e.i })))
      else return a
  }
  return { ...a, apply }
}
export const materializeDiags = diags => diags.map(d => (d.actions ? { ...d, actions: d.actions.map(materialize) } : d))
const replaceFix = (name, text) => ({ name, op: 'replace', text })
// 文字列リテラルの中身 (引用符の内側) を置き換える
const stringFix = (name, text) => ({ name, op: 'string', text })

// ============================================================
// 全角文字・スマート引用符など
// ============================================================
function scanChars(src) {
  const diags = []
  const fixAllAction = { name: 'ファイル全体の全角記号を直す', op: 'fixAllChars' }
  const toks = scanBlocks(src, true).tokens
  const add = (from, to) => {
    if (diags.length >= 40) return
    const text = src.slice(from, to)
    const fixed = [...text].map(fixChar).join('')
    if (fixed !== text) {
      diags.push({ from, to, severity: 'error', source: '全角', message: `${describeChar(text[0])} が入っています。半角の ${fixed.trim() ? `'${fixed}'` : 'スペース'} に直してください`, actions: [replaceFix('半角に直す', fixed), fixAllAction] })
    } else {
      diags.push({ from, to, severity: 'error', source: '全角', message: `コードの中に '${text.slice(0, 12)}' があります。文字として使うなら " " で囲み、メモならコメント (--) にしてください`, actions: [{ name: '" " で囲む', op: 'wrap', pre: '"', post: '"' }, { name: 'コメントにする', edits: [{ a: 0, d: 0, i: '-- ' }] }] })
    }
  }
  // 1) 記号として現れる全角・非 ASCII 文字 (連続はまとめる)
  let run = null
  for (const t of toks) {
    const ok = t.t !== 'str' && t.t !== 'comment' && t.e - t.s === 1 && src.charCodeAt(t.s) > 127
    if (ok && run && run.to === t.s && (fixChar(src[t.s]) === src[t.s]) === run.plain) { run.to = t.e; continue }
    if (run) { add(run.from, run.to); run = null }
    if (ok) run = { from: t.s, to: t.e, plain: fixChar(src[t.s]) === src[t.s] }
  }
  if (run) add(run.from, run.to)
  // 2) 空白として紛れ込む文字 (全角スペースなど) — 文字列・コメントの外だけ
  const re = /[ 　﻿]+/g
  let m, ti = 0
  while ((m = re.exec(src))) {
    while (ti < toks.length && toks[ti].e <= m.index) ti++
    const t = toks[ti]
    if (t && (t.t === 'str' || t.t === 'comment') && t.s <= m.index) continue
    add(m.index, m.index + m[0].length)
  }
  return diags
}

// ============================================================
// 構文エラー
// ============================================================
function blockDiags(src) {
  return diagnoseBlocks(src).map(b => b.kind === 'missing'
    ? { from: b.from, to: b.to, severity: 'error', source: '構文', message: b.message, actions: [{ name: `'${b.insertText.trim().split(' ')[0]}' を追加`, op: 'blockMissing' }] }
    : { from: b.from, to: b.to, severity: 'error', source: '構文', message: b.message, actions: [{ name: '削除', op: 'blockExtra' }] })
}

function syntaxDiags(src, e) {
  const out = blockDiags(src)
  const from = Math.min(Math.max(0, e.pos ?? 0), src.length)
  let to = from
  while (to < src.length && /[\w]/.test(src[to])) to++
  if (to === from) to = Math.min(src.length, from + 1)
  let message = e.message
  const actions = []
  const two = src.slice(from, from + 2)
  const lineStart = src.lastIndexOf('\n', from - 1) + 1
  let lineEnd = src.indexOf('\n', from)
  if (lineEnd < 0) lineEnd = src.length
  const line = src.slice(lineStart, lineEnd)
  let range = { from, to }
  if (two === '!=') { range = { from, to: from + 2 }; actions.push(replaceFix("'~=' に直す", '~=')) }
  else if (two === '&&') { range = { from, to: from + 2 }; actions.push(replaceFix("'and' に直す", 'and')) }
  else if (two === '||') { range = { from, to: from + 2 }; actions.push(replaceFix("'or' に直す", 'or')) }
  else if (src[from] === '!') { range = { from, to: from + 1 }; actions.push(replaceFix("'not' に直す", 'not ')) }
  else if (/文字列が閉じられていません/.test(message)) {
    const q = src[from]
    range = { from, to: lineEnd }
    if (q === '"' || q === "'") actions.push({ name: `行末に ${q} を追加`, op: 'insertAtEnd', i: q })
  } else if (/^'(then|do)' が必要です/.test(message)) {
    const kw = /^'(then|do)'/.exec(message)[1]
    // 条件の中の '=' は比較の書き間違い
    if (src[from] === '=' && src[from + 1] !== '=') { message = `比較には '==' を使います ('=' は代入です)`; range = { from, to: from + 1 }; actions.push(replaceFix("'==' に直す", '==')) }
    else if (src[from] === ':' && /^\s*(if|elseif|while|for)\b/.test(line)) { message = `Luau では ':' ではなく '${kw}' を書きます`; range = { from, to: from + 1 }; actions.push(replaceFix(`'${kw}' に直す`, ' ' + kw)) }
    else if (src[from] === '{') { message = `Luau では '{' ではなく '${kw}' でブロックを始め、'end' で閉じます`; range = { from, to: from + 1 }; actions.push(replaceFix(`'${kw}' に直す`, kw)) }
    else {
      // 条件の行の終わりに then / do を足す
      const prevEnd = src.slice(0, from).replace(/\s+$/, '').length
      range = { from: Math.max(0, prevEnd - 1), to: prevEnd }
      actions.push({ name: `'${kw}' を追加`, op: 'insertAtEnd', i: ' ' + kw })
    }
  } else if (/^\s*(\/\/|#\s|\/\*)/.test(line) && from <= lineStart + line.search(/\S/) + 2) {
    message = 'Luau のコメントは -- で始めます'
    const at = lineStart + line.search(/\S/)
    range = { from: at, to: at + (line.trim().startsWith('#') ? 1 : 2) }
    actions.push(replaceFix("'--' に直す", '--'))
  } else if (/'end' が必要です|ファイルが終わりました/.test(message) && out.some(d => /対応する/.test(d.message))) {
    message = null // ブロックの診断のほうが正確
  } else if (/余分な '(end|until)'/.test(message) && out.some(d => /余分な/.test(d.message))) message = null
  // 行内のキーワードの打ち間違い (fucntion foo() など)
  const typoDiags = []
  const prevLineStart = src.lastIndexOf('\n', lineStart - 2) + 1
  for (const t of lightTokens(src.slice(prevLineStart, lineEnd))) {
    if (t.t !== 'name') continue
    const w = src.slice(prevLineStart + t.s, prevLineStart + t.e)
    const fix = Object.prototype.hasOwnProperty.call(KEYWORD_FIXES, w) ? KEYWORD_FIXES[w] : (w.length >= 4 && !LUAU_GLOBALS[w] ? nearest(w, LUAU_KEYWORDS, w.length >= 6 ? 2 : 1) : null)
    if (fix && LUAU_KEYWORDS.includes(fix) && new RegExp(`\\b${w}\\b`, 'g').exec(src.slice(0, prevLineStart)) === null) {
      typoDiags.push({ from: prevLineStart + t.s, to: prevLineStart + t.e, severity: 'error', source: '誤字', message: `'${w}' は '${fix}' の打ち間違いではありませんか?`, actions: [replaceFix(`'${fix}' に直す`, fix)] })
    }
  }
  if (typoDiags.length) { out.push(...typoDiags); if (message && !actions.length) message = null }
  // else if (同じ行) は end が 2 つ必要
  if (/'end' が必要です/.test(e.message)) {
    const m = /\belse[ \t]+if\b/.exec(src)
    if (m) out.push({ from: m.index, to: m.index + m[0].length, severity: 'warning', source: '構文', message: "'else if' は入れ子の if になるため end が 2 つ必要です。'elseif' と続けて書けば 1 つで済みます", actions: [replaceFix("'elseif' に直す", 'elseif')] })
  }
  if (message) out.push({ ...range, severity: 'error', message, source: '構文', actions: actions.length ? actions : undefined })
  return out
}

// ============================================================
// AST 走査
// ============================================================
function analyze(ast, src, opts) {
  const diags = []
  const known = knownGlobals(!!opts.executor)
  const assignedGlobals = new Set()
  const declared = new Set()
  const unknownRefs = []
  const scopes = []
  const typos = opts.typos !== false && db.apiReady()
  const unit = /^\t/m.test(src) ? '\t' : '    '
  let budget = 2500 // 型推論の回数の上限 (大きなファイルで重くならないように)
  const push = () => scopes.push(new Map())
  const pop = () => {
    const sc = scopes.pop()
    for (const v of sc.values()) {
      if (!v.used && !v.name.startsWith('_') && v.kind !== 'param' && opts.unused !== false && v.s !== undefined) {
        diags.push({ from: v.s, to: v.e, severity: 'hint', message: `'${v.name}' は使われていません`, markClass: 'cm-unused' })
      }
    }
  }
  const declare = (name, s, e, kind = 'local') => { scopes[scopes.length - 1].set(name, { name, s, e, used: false, kind }); declared.add(name) }
  const lookup = name => { for (let i = scopes.length - 1; i >= 0; i--) { const v = scopes[i].get(name); if (v) return v } return null }
  const ref = node => {
    const v = lookup(node.name)
    if (v) v.used = true
    else if (!known.has(node.name)) unknownRefs.push(node)
  }
  const strVal = a => (a && a.t === 'String' && typeof a.v === 'string' ? a.v : null)
  const hasRange = a => a && a.s !== undefined && a.e !== undefined && src[a.s] !== '[' && a.e - a.s === a.v.length + 2

  // ---- 型の解決 (同じ式・同じ宣言なら結果を使い回す) ----
  const typeCache = new Map()
  function typeOfText(text, pos) {
    const root = /^[A-Za-z_]\w*/.exec(text)
    if (!root) return null
    const key = text + '@' + declPos(src, root[0], pos + 1)
    if (typeCache.has(key)) return typeCache.get(key)
    let ty = null
    if (budget-- > 0) { try { ty = resolveChain(parseChain(text), { text: src, pos, index: 0 }) } catch { ty = null } }
    typeCache.set(key, ty)
    return ty
  }
  const objTextOf = e => (e.s !== undefined && e.keyS !== undefined ? src.slice(e.s, e.keyS).replace(/\s*[.:]\s*$/, '') : null)

  // 型ごとのメンバー一覧と「もしかして」の結果を使い回す (大きなファイルで同じ型・同じ名前が何度も出るため)
  const memberCache = new Map()
  const suggCache = new Map()
  function membersOf(ty, op) {
    const k = ty.k + '|' + (ty.name || '') + '|' + op
    let m = memberCache.get(k)
    if (m === undefined) {
      const names = memberNamesOf(ty, op)
      m = names ? { k, names, set: new Set(names) } : null
      memberCache.set(k, m)
    }
    return m
  }
  function checkMember(e, op) {
    const key = op === ':' ? e.name : e.key.v
    if (!typos || typeof key !== 'string' || key.length < 3 || e.keyS === undefined) return null
    const objText = objTextOf(e)
    if (!objText || objText.length > 160 || objText.includes('\n')) return null
    const ty = typeOfText(objText, e.s)
    if (!ty) return null
    const mem = membersOf(ty, op)
    if (!mem || mem.set.has(key)) return ty
    const names = mem.names
    const from = e.keyS, to = e.keyS + key.length
    const closed = ty.k === 'enumRoot' || ty.k === 'enum' || ty.k === 'dtlib' || (ty.k === 'lib' && STD_LIBS.has(ty.name))
    // Instance の '.' は子オブジェクトの名前かもしれないので、よく似た名前があるときだけ指摘する
    const sk = mem.k + '|' + key
    let sugg = suggCache.get(sk)
    if (sugg === undefined) {
      sugg = closed ? nearest(key, names, Math.max(1, typoLimit(key.length))) : nearest(key, names)
      suggCache.set(sk, sugg)
    }
    if (!sugg && !closed) return ty
    const label = typeLabel(ty)
    const what = ty.k === 'lib' ? `${label} ライブラリ` : label
    diags.push({
      from, to, severity: closed || op === ':' ? 'warning' : sugg && sugg.toLowerCase() === key.toLowerCase() ? 'warning' : 'info', source: '誤字',
      message: sugg ? `'${key}' は ${what} にありません。もしかして '${sugg}'?` : `'${key}' は ${what} にありません`,
      actions: sugg ? [replaceFix(`'${sugg}' に直す`, sugg)] : undefined,
    })
    return ty
  }

  function checkStringArg(node, list, what, extra) {
    const v = strVal(node)
    if (v === null || !typos || !v || /[^\w ]/.test(v) || list.includes(v)) return false
    const sugg = nearest(v, list)
    const d = { from: node.s ?? 0, to: node.e ?? 0, severity: 'warning', source: '誤字', message: sugg ? `"${v}" という${what}はありません。もしかして "${sugg}"?` : `"${v}" という${what}はありません${extra || ''}` }
    if (node.s === undefined) return false
    if (sugg && hasRange(node)) d.actions = [stringFix(`"${sugg}" に直す`, sugg)]
    diags.push(d)
    return true
  }

  // 待機もせず抜けもしないループ本体か
  function neverYields(body) {
    let pure = true
    const visit = n => {
      if (!pure || !n || typeof n !== 'object') return
      if (Array.isArray(n)) { for (const x of n) visit(x); return }
      switch (n.t) {
        case 'Break': case 'Return': pure = false; return
        case 'Func': return
        case 'Call': {
          let root = n.fn
          while (root && (root.t === 'Index' || root.t === 'Paren')) root = root.obj || root.e
          if (!(root && root.t === 'Name' && NO_YIELD_ROOTS.has(root.name) && !lookup(root.name)) || (n.fn.t === 'Index' && n.fn.key && (n.fn.key.v === 'wait' || n.fn.key.v === 'delay'))) { pure = false; return }
          break
        }
        case 'Method': if (!NO_YIELD_METHODS.has(n.name)) { pure = false; return } break
      }
      for (const k in n) if (k !== 't' && typeof n[k] === 'object') visit(n[k])
    }
    visit(body)
    return pure
  }

  function expr(e) {
    if (!e) return
    switch (e.t) {
      case 'Name': ref(e); break
      case 'Index':
        expr(e.obj)
        if (!e.dot) { expr(e.key); break }
        checkMember(e, '.')
        if (opts.scriptKind === 'server' && e.key.v === 'LocalPlayer' && e.keyS !== undefined) diags.push({ from: e.keyS, to: e.keyS + 11, severity: 'warning', message: 'サーバースクリプトでは LocalPlayer は nil です。PlayerAdded などでプレイヤーを受け取ってください' })
        else if (opts.scriptKind === 'server' && (e.key.v === 'OnClientEvent' || e.key.v === 'OnClientInvoke') && e.keyS !== undefined) diags.push({ from: e.keyS, to: e.keyS + e.key.v.length, severity: 'warning', message: `${e.key.v} はクライアント (LocalScript) 用です。サーバーでは ${e.key.v.replace('Client', 'Server')} を使います` })
        else if (opts.scriptKind === 'client' && (e.key.v === 'OnServerEvent' || e.key.v === 'OnServerInvoke') && e.keyS !== undefined) diags.push({ from: e.keyS, to: e.keyS + e.key.v.length, severity: 'warning', message: `${e.key.v} はサーバー (Script) 用です。クライアントでは ${e.key.v.replace('Server', 'Client')} を使います` })
        break
      case 'Call': {
        const fn = e.fn
        if (fn.t === 'Name' && !lookup(fn.name)) {
          const n = fn.name
          if (n === 'wait' || n === 'spawn' || n === 'delay') {
            diags.push({ from: fn.s, to: fn.e, severity: 'info', message: `${n}() は非推奨です。task.${n}() を使うと正確で高速です`, actions: [replaceFix(`task.${n} に置き換え`, 'task.' + n)] })
          }
        }
        if (fn.t === 'Index' && fn.dot && fn.obj.t === 'Name' && !lookup(fn.obj.name)) {
          const lib = fn.obj.name, key = fn.key.v
          if (lib === 'Instance' && key === 'new') {
            if (e.args.length >= 2) diags.push({ from: e.s, to: e.e, severity: 'info', message: 'Instance.new の第 2 引数 (Parent) は非推奨です。プロパティを設定した後に .Parent を設定すると速くなります' })
            const v = strVal(e.args[0])
            if (v !== null && typos && db.isClass(v) && !db.creatableClasses().includes(v)) {
              if (e.args[0].s !== undefined) diags.push({ from: e.args[0].s, to: e.args[0].e, severity: 'warning', message: db.isService(v) ? `"${v}" はサービスです。game:GetService("${v}") で取得します` : `"${v}" は Instance.new では作成できないクラスです` })
            } else checkStringArg(e.args[0], db.creatableClasses(), 'クラス')
          } else if (lib === 'Drawing' && key === 'new' && opts.executor) checkStringArg(e.args[0], DRAWING_KINDS, ' Drawing の種類', ' (Line, Text, Image, Circle, Square, Quad, Triangle)')
        }
        if (fn.t === 'Index' && fn.dot && fn.keyS !== undefined) {
          const obj = fn.obj
          const objName = obj.t === 'Name' ? obj.name : null
          const isLib = objName && (LIB_NAMES.has(objName) || ROBLOX_DATATYPES[objName] || tableLocals.has(objName) || EXECUTOR_LIBS[objName])
          // obj.Method(obj, ...) の形は正しい
          const passesSelf = objName && e.args[0] && e.args[0].t === 'Name' && e.args[0].name === objName
          if (!isLib && !passesSelf) {
            let isMethod = INSTANCE_METHODS.has(fn.key.v)
            if (!isMethod && typos) {
              const t = objTextOf(fn)
              const ty = t && t.length < 160 && !t.includes('\n') ? typeOfText(t, fn.s) : null
              const m = ty && ty.k === 'class' ? db.member(ty.name, fn.key.v) : null
              isMethod = !!(m && m.kind === 'f')
            }
            if (isMethod) diags.push({ from: fn.keyS - 1, to: fn.keyS, severity: 'warning', message: `メソッドの呼び出しは '.' ではなく ':' を使います (${fn.key.v})`, actions: [replaceFix("':' に置き換え", ':')] })
          }
        }
        expr(fn); e.args.forEach(expr)
        break
      }
      case 'Method': {
        const name = e.name
        expr(e.obj); e.args.forEach(expr)
        if (e.keyS === undefined) break
        if (name === 'connect') { diags.push({ from: e.keyS, to: e.keyS + 7, severity: 'warning', message: ':connect は非推奨です。:Connect を使ってください', actions: [replaceFix('Connect に置き換え', 'Connect')] }); break }
        // ライブラリ・データ型の関数を ':' で呼んでいる
        if (e.obj.t === 'Name' && !lookup(e.obj.name) && (STD_LIBS.has(e.obj.name) || (ROBLOX_DATATYPES[e.obj.name] && ROBLOX_DATATYPES[e.obj.name].ctor[name]))) {
          diags.push({ from: e.keyS - 1, to: e.keyS, severity: 'warning', message: `${e.obj.name} の関数は ':' ではなく '.' で呼びます (${e.obj.name}.${name})`, actions: [replaceFix("'.' に置き換え", '.')] })
          break
        }
        const ty = checkMember(e, ':')
        // メソッド名自体が打ち間違い (GetServise) でも、サービス名は確認する
        if (name === 'GetService' || name === 'FindService' || (name.length > 8 && editDistance(name, 'GetService', 2) <= 2)) {
          const bad = checkStringArg(e.args[0], db.serviceNames(), 'サービス')
          const v = strVal(e.args[0])
          if (!bad && opts.scriptKind === 'client' && (v === 'DataStoreService' || v === 'ServerStorage' || v === 'ServerScriptService' || v === 'MessagingService') && e.args[0].s !== undefined) {
            diags.push({ from: e.args[0].s, to: e.args[0].e, severity: 'warning', message: `${v} はサーバー専用です。LocalScript からは使えません (RemoteEvent でサーバーに頼みます)` })
          }
        } else if (CLASS_ARG_METHODS.has(name)) checkStringArg(e.args[0], db.allClasses(), 'クラス')
        else if (name === 'GetPropertyChangedSignal' && ty && ty.k === 'class' && ty.name !== 'Instance') {
          checkStringArg(e.args[0], [...db.classMembers(ty.name).values()].filter(m => m.kind === 'p').map(m => m.name), `プロパティ (${ty.name})`)
        } else if (opts.scriptKind === 'server' && (name === 'FireServer' || name === 'InvokeServer')) {
          diags.push({ from: e.keyS, to: e.keyS + name.length, severity: 'warning', message: `${name} はクライアントからサーバーへ送るときに使います。サーバースクリプトでは ${name === 'FireServer' ? 'FireClient / FireAllClients' : 'InvokeClient'} を使います` })
        } else if (opts.scriptKind === 'client' && (name === 'FireClient' || name === 'FireAllClients' || name === 'InvokeClient')) {
          diags.push({ from: e.keyS, to: e.keyS + name.length, severity: 'warning', message: `${name} はサーバーからクライアントへ送るときに使います。LocalScript では ${name === 'InvokeClient' ? 'InvokeServer' : 'FireServer'} を使います` })
        } else if (name === 'Remove' && ty && ty.k === 'class' && e.args.length === 0) {
          diags.push({ from: e.keyS, to: e.keyS + 6, severity: 'info', message: ':Remove() は非推奨です。:Destroy() を使ってください', actions: [replaceFix('Destroy に置き換え', 'Destroy')] })
        }
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
          if (v && (v.t === 'Table' || (v.t === 'Call' && v.fn.t === 'Name' && (v.fn.name === 'require' || v.fn.name === 'setmetatable' || v.fn.name === 'loadstring')))) tableLocals.add(n.name)
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
      case 'While':
        expr(st.cond)
        if (st.cond && st.cond.t === 'True' && st.doTok && neverYields(st.body)) {
          const lineStart = src.lastIndexOf('\n', st.doTok.s) + 1
          const ind = /^[ \t]*/.exec(src.slice(lineStart))[0]
          const at = st.doTok.e
          diags.push({ from: st.doTok.s - 0, to: st.doTok.e, severity: 'warning', message: 'この while true ループには待機 (task.wait など) がないため、実行するとフリーズします', actions: [{ name: 'task.wait() を追加', edits: [{ a: at - st.doTok.s, d: 0, i: '\n' + ind + unit + 'task.wait()' }] }] })
        }
        block(st.body)
        break
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
  // 型チェック (型の間違い)。直し方はデータで返るので、エディタで使える形にする
  if (opts.types !== false && db.apiReady()) {
    const classOf = n => {
      const end = typeof n.e === 'number' ? n.e : null
      if (end === null) return null
      const t = src.slice(n.s, end)
      if (!t || t.length > 160 || t.includes('\n')) return null
      const ty = typeOfText(t, n.s)
      return ty && ty.k === 'class' ? ty.name : null
    }
    for (const d of typeDiagnostics(ast, { src, classOf })) diags.push(d)
  }
  if (opts.undefinedGlobals !== false) {
    let candidates = null
    for (const n of unknownRefs) {
      if (assignedGlobals.has(n.name)) continue
      const name = n.name
      let message, actions
      if (Object.prototype.hasOwnProperty.call(FOREIGN, name)) {
        const fix = FOREIGN[name]
        message = fix === '#' ? `Luau には len() がありません。長さは #テーブル または #文字列 で調べます` : `'${name}' は Luau にはありません。'${fix}' を使います`
        if (fix !== '#') actions = [replaceFix(`'${fix}' に直す`, fix)]
      } else if (!opts.executor && isExecutorOnly(name)) {
        message = `'${name}' はエグゼキューター専用の関数です。Roblox Studio のスクリプトでは使えません (画面下の「Studio」をタップして Executor モードに切り替えると補完・実行できます)`
      } else {
        if (!candidates) candidates = [...known, ...declared, ...assignedGlobals]
        const sugg = opts.typos !== false ? nearest(name, candidates) : null
        message = sugg ? `'${name}' は定義されていません。もしかして '${sugg}'?` : `'${name}' は定義されていません (スペルミスか、宣言前の使用の可能性があります)`
        if (sugg) actions = [replaceFix(`'${sugg}' に直す`, sugg)]
      }
      diags.push({ from: n.s, to: n.e, severity: 'warning', message, actions, source: actions ? '誤字' : undefined })
    }
  }
  return diags
}

// エディタ用: 直し方を操作にした診断
export function lintLuau(src, opts = {}) { return materializeDiags(lintLuauData(src, opts)) }

// 直し方をデータのまま返す (ワーカーで使う)
export function lintLuauData(src, opts = {}) {
  const chars = hasSuspect(src) || /[^\x00-\x7f]/.test(src) ? scanChars(src) : []
  let ast, text = src
  try {
    ast = parse(src)
  } catch (e) {
    if (!(e instanceof LuauSyntaxError)) return chars
    // 全角記号が原因なら、半角に直したものとして残りのチェックを続ける (文字数が変わらない場合のみ: 位置がずれないように)
    const fixed = chars.length ? fixCode(src) : src
    if (fixed !== src && fixed.length === src.length) {
      try { ast = parse(fixed); text = fixed } catch (e2) {
        if (!(e2 instanceof LuauSyntaxError)) return chars
        return [...chars, ...syntaxDiags(fixed, e2)].sort((a, b) => a.from - b.from)
      }
    } else {
      const syn = syntaxDiags(src, e).filter(d => !hasSuspect(d.message) && !chars.some(c => d.from >= c.from && d.from <= c.to))
      return [...chars, ...syn].sort((a, b) => a.from - b.from)
    }
  }
  try {
    return [...chars, ...analyze(ast, text, opts)].sort((a, b) => a.from - b.from)
  } catch {
    return chars
  }
}

// ============================================================
// エディタへの組み込み
// ・ある程度大きなファイルは、裏のスレッド (ワーカー) で調べる。調べている間も入力は止まらない
// ・ワーカーを使えないときや応答がないときは、手が空いたときにこの画面で調べる
// ・調べている間に内容が変わったら、その回の結果は捨てられる (CodeMirror が古い結果を使わない)
// ============================================================
const WORKER_MIN = 3000      // これより小さいファイルはその場で調べる (すぐ結果が出る)
const BIG_DOC = 60000        // ワーカーがないとき: これより大きいファイルは手が空いてから
const idleOnce = () => new Promise(r => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 1500 }) : setTimeout(r, 30)))

let lintWorker = null, workerBroken = false, reqSeq = 0
const waits = new Map()
const extSent = new Map() // url → 送った解析結果 (同じものは送り直さない)
function getWorker() {
  if (workerBroken || typeof Worker === 'undefined') return null
  if (lintWorker) return lintWorker
  try {
    lintWorker = new Worker(new URL('../workers/lint-worker.js', import.meta.url), { type: 'module' })
  } catch { workerBroken = true; return null }
  lintWorker.onmessage = e => {
    const m = e.data
    const w = waits.get(m.id)
    if (!w) return
    waits.delete(m.id)
    clearTimeout(w.timer)
    if (m.type === 'result') w.resolve(m.diags)
    else w.reject(new Error(m.message || 'lint worker error'))
  }
  lintWorker.onerror = e => {
    if (e && e.preventDefault) e.preventDefault()
    workerBroken = true
    for (const w of waits.values()) { clearTimeout(w.timer); w.reject(new Error('lint worker failed')) }
    waits.clear()
    try { lintWorker.terminate() } catch {}
    lintWorker = null
  }
  return lintWorker
}
// require で読み込んでいるモジュールの中身 (型を調べるため)
function moduleSources(text) {
  const out = {}
  if (!intel.moduleSource || !/\brequire\b/.test(text)) return out
  const re = /\brequire\s*\(?\s*([^)\n]+)\)?/g
  let m, n = 0
  while ((m = re.exec(text)) && n < 40) {
    const spec = m[1].trim()
    const sm = /^["']([^"']+)["']$/.exec(spec)
    const name = sm ? sm[1].replace(/\\/g, '/').split('/').pop().replace(/\.luau?$/, '') : (/([A-Za-z_]\w*)\s*$/.exec(spec.replace(/\)\s*$/, '').replace(/:WaitForChild\(\s*["'](\w+)["']\s*$/, '.$1')) || [])[1]
    if (!name || Object.prototype.hasOwnProperty.call(out, name)) continue
    n++
    try { out[name] = intel.moduleSource(name) } catch { out[name] = null }
  }
  return out
}
// loadstring で読み込む外部ライブラリの解析結果
function extApis(text) {
  const out = {}
  if (!intel.extLib || !/loadstring/.test(text)) return out
  for (const url of scanLoadstringUrls(text)) {
    const api = intel.extLib(url)
    if (api && extSent.get(url) !== api) { out[url] = api; extSent.set(url, api) }
  }
  return out
}
function lintInWorker(text, opts) {
  const w = getWorker()
  if (!w) return null
  const id = ++reqSeq
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waits.delete(id); reject(new Error('timeout')) }, 15000)
    waits.set(id, { resolve, reject, timer })
    try {
      w.postMessage({ type: 'lint', id, text, opts, executor: !!intel.executor, modules: moduleSources(text), ext: extApis(text) })
    } catch (e) { clearTimeout(timer); waits.delete(id); extSent.clear(); reject(e) }
  })
}

export function makeLinter(getOpts) {
  return linter(async view => {
    const opts = getOpts()
    if (!opts.enabled) return []
    const doc = view.state.doc
    if (doc.length > 400000) return []
    const text = docText(view.state)
    if (doc.length >= WORKER_MIN && !workerBroken) {
      try {
        const p = lintInWorker(text, opts)
        if (p) return materializeDiags(await p)
      } catch { /* ワーカーが使えない: この画面で調べる */ }
      if (view.state.doc !== doc) return []
    }
    if (doc.length > BIG_DOC) {
      await new Promise(r => setTimeout(r, Math.min(1400, doc.length / 200)))
      if (view.state.doc !== doc) return []
      await idleOnce()
      if (view.state.doc !== doc) return []
    }
    return lintLuau(text, opts)
  }, { delay: 420 })
}
