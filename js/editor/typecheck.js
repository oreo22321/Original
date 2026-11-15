// 型チェック: 実行する前に「型の間違い」を見つける
// ・プロパティへの代入 (part.Transparency = "0.5" / part.Anchored = 1 / part.BrickColor = Color3.new() など)
// ・読み取り専用のプロパティへの代入
// ・型注釈との食い違い (local x: number = "a")
// ・関数の引数 (task.wait("1") / Color3.new(255, 0, 0) / humanoid:TakeDamage("10") / 型注釈付きの自分の関数)
// ・文字列の + (他の言語の書き方)、boolean や nil の連結・計算、数値と文字列の比較
// 直し方はデータ (edits: 診断の開始位置からの相対位置) で返します。ワーカーでも使えるように関数は含めません
import * as db from './apidb.js'
import { nearest } from './typo.js'

const NUM = 'number', STR = 'string', BOOL = 'boolean', NIL = 'nil', TABLE = 'table', FUNC = 'function'
const PRIMS = new Set([NUM, STR, BOOL, NIL, TABLE, FUNC])
const DATATYPES = new Set(['Vector3', 'Vector2', 'CFrame', 'Color3', 'BrickColor', 'UDim', 'UDim2', 'TweenInfo', 'NumberRange', 'NumberSequence', 'ColorSequence', 'Rect', 'Ray', 'Font', 'PhysicalProperties', 'Region3', 'Axes', 'Faces', 'NumberSequenceKeypoint', 'ColorSequenceKeypoint'])
// 返り値の型が決まっている関数・コンストラクタ
const CTORS = {
  Vector3: { new: 'Vector3', zero: 'Vector3', one: 'Vector3', xAxis: 'Vector3', yAxis: 'Vector3', zAxis: 'Vector3', fromNormalId: 'Vector3', fromAxis: 'Vector3' },
  Vector2: { new: 'Vector2', zero: 'Vector2', one: 'Vector2' },
  CFrame: { new: 'CFrame', Angles: 'CFrame', fromEulerAnglesXYZ: 'CFrame', fromEulerAnglesYXZ: 'CFrame', fromOrientation: 'CFrame', lookAt: 'CFrame', fromAxisAngle: 'CFrame', fromMatrix: 'CFrame', identity: 'CFrame', lookAlong: 'CFrame' },
  Color3: { new: 'Color3', fromRGB: 'Color3', fromHSV: 'Color3', fromHex: 'Color3' },
  BrickColor: { new: 'BrickColor', random: 'BrickColor', Random: 'BrickColor', palette: 'BrickColor', White: 'BrickColor', Black: 'BrickColor', Red: 'BrickColor', Blue: 'BrickColor', Green: 'BrickColor', Yellow: 'BrickColor', Gray: 'BrickColor', DarkGray: 'BrickColor' },
  UDim: { new: 'UDim' },
  UDim2: { new: 'UDim2', fromScale: 'UDim2', fromOffset: 'UDim2' },
  TweenInfo: { new: 'TweenInfo' },
  NumberRange: { new: 'NumberRange' },
  NumberSequence: { new: 'NumberSequence' },
  ColorSequence: { new: 'ColorSequence' },
  Rect: { new: 'Rect' },
  Ray: { new: 'Ray' },
  Font: { new: 'Font', fromEnum: 'Font', fromName: 'Font', fromId: 'Font' },
  math: { floor: NUM, ceil: NUM, abs: NUM, sqrt: NUM, random: NUM, clamp: NUM, max: NUM, min: NUM, sin: NUM, cos: NUM, tan: NUM, rad: NUM, deg: NUM, round: NUM, pow: NUM, exp: NUM, log: NUM, fmod: NUM, sign: NUM, noise: NUM, lerp: NUM, atan2: NUM, atan: NUM, asin: NUM, acos: NUM },
  string: { format: STR, rep: STR, sub: STR, lower: STR, upper: STR, reverse: STR, gsub: STR, len: NUM, byte: NUM, char: STR },
  os: { time: NUM, clock: NUM, date: null },
  table: { concat: STR, insert: NIL, find: null },
}
const GLOBAL_RET = { tostring: STR, typeof: STR, type: STR, tick: NUM, time: NUM, select: null, next: null }
// よく使う関数の引数の型 (? は省略可)
const PARAMS = {
  'task.wait': ['number?'], 'wait': ['number?'], 'task.delay': ['number', 'function'],
  'Vector3.new': ['number?', 'number?', 'number?'], 'Vector2.new': ['number?', 'number?'],
  'Color3.new': ['number?', 'number?', 'number?'], 'Color3.fromRGB': ['number?', 'number?', 'number?'], 'Color3.fromHSV': ['number', 'number', 'number'], 'Color3.fromHex': ['string'],
  'UDim2.new': ['number?', 'number?', 'number?', 'number?'], 'UDim2.fromScale': ['number?', 'number?'], 'UDim2.fromOffset': ['number?', 'number?'], 'UDim.new': ['number?', 'number?'],
  'CFrame.Angles': ['number', 'number', 'number'], 'CFrame.fromEulerAnglesXYZ': ['number', 'number', 'number'],
  'Instance.new': ['string', 'Instance?'],
  'math.floor': ['number'], 'math.ceil': ['number'], 'math.abs': ['number'], 'math.sqrt': ['number'], 'math.clamp': ['number', 'number', 'number'], 'math.random': ['number?', 'number?'], 'math.round': ['number'], 'math.rad': ['number'], 'math.deg': ['number'],
  'string.rep': ['string', 'number', 'string?'], 'string.sub': ['string', 'number', 'number?'], 'string.upper': ['string'], 'string.lower': ['string'], 'string.len': ['string'],
  'NumberRange.new': ['number', 'number?'], 'TweenInfo.new': ['number?'],
}
const ARITH = new Set(['+', '-', '*', '/', '//', '%', '^'])
const CMP = new Set(['==', '~='])
const ORDER = new Set(['<', '>', '<=', '>='])

const isEnum = t => typeof t === 'string' && t.startsWith('Enum:')
const isInst = t => typeof t === 'string' && t.startsWith('Instance:')
const instClass = t => t.slice(9)
// 表示用の型の名前
export function typeName(t) {
  if (!t) return '?'
  if (isEnum(t)) return `Enum.${t.slice(5)}`
  if (isInst(t)) return instClass(t)
  return t
}

// API の型 → この型の表し方
function fromApiType(s) {
  if (!s) return null
  if (s === 'bool') return BOOL
  if (/^(float|double|int|int64|number)$/.test(s)) return NUM
  if (/^(string|Content|ProtectedString|BinaryString|ContentId)$/.test(s)) return STR
  if (s.startsWith('Enum.')) return 'Enum:' + s.slice(5)
  if (DATATYPES.has(s)) return s
  if (db.isClass(s)) return 'Instance:' + s
  return null
}

// 型注釈 (number / string? / Part / Vector3 | nil など) → 許す型の一覧。分からない型は null
function fromAnnotation(text) {
  if (!text) return null
  let s = text.trim()
  const out = new Set()
  if (s.endsWith('?')) { out.add(NIL); s = s.slice(0, -1).trim() }
  for (let part of s.split('|')) {
    part = part.trim()
    if (part.endsWith('?')) { out.add(NIL); part = part.slice(0, -1).trim() }
    if (part === 'number' || part === 'string' || part === 'boolean' || part === 'nil') out.add(part)
    else if (DATATYPES.has(part)) out.add(part)
    else if (/^Enum\.\w+$/.test(part)) out.add('Enum:' + part.slice(5))
    else if (db.isClass(part)) out.add('Instance:' + part)
    else return null // テーブル型・関数型・自分で定義した型などは調べない
  }
  return out.size ? out : null
}

// 値の型 want に、型 got の値を入れてよいか (分からないときは true)
function assignable(want, got) {
  if (!want || !got) return true
  if (want === got) return true
  if (want === NUM) return got === NUM
  if (want === STR) return got === STR || got === NUM // 数値は文字列に自動で変わる
  if (want === BOOL) return got === BOOL
  if (isEnum(want)) return got === NUM || got === STR || got === want
  if (isInst(want)) {
    if (got === NIL) return true
    if (isInst(got)) { const g = instClass(got), w = instClass(want); return !db.isClass(g) || !db.isClass(w) || db.isA(g, w) || db.isA(w, g) }
    return !(PRIMS.has(got) || DATATYPES.has(got) || isEnum(got))
  }
  if (DATATYPES.has(want)) return !(PRIMS.has(got) || DATATYPES.has(got) || isEnum(got) || isInst(got))
  return true
}

const isNumericString = v => typeof v === 'string' && /^\s*-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(v)
const endOf = n => (n.e2 !== undefined ? n.e2 : typeof n.e === 'number' ? n.e : undefined)
const hasRange = n => n && typeof n.s === 'number' && endOf(n) !== undefined
const repl = (name, len, text) => ({ name, edits: [{ a: 0, d: len, i: text }] })
const wrap = (name, len, pre, post) => ({ name, edits: [{ a: 0, d: 0, i: pre }, { a: len, d: 0, i: post }] })

// ctx: { src, classOf(node) → クラス名 | null }
export function typeDiagnostics(ast, ctx) {
  const { src } = ctx
  if (/^\s*--!nocheck\b/.test(src)) return []
  const diags = []
  const scopes = [new Map()]
  const fnSigs = new Map() // 型注釈付きの自分の関数: 名前 → { params: [Set|null], scope }
  const lookup = name => { for (let i = scopes.length - 1; i >= 0; i--) { const v = scopes[i].get(name); if (v) return v } return null }
  const declare = (name, info) => scopes[scopes.length - 1].set(name, info)
  const add = (node, message, severity = 'warning', actions) => {
    if (!hasRange(node) || diags.length > 200) return
    diags.push({ from: node.s, to: endOf(node), severity, source: '型', message, actions })
  }
  const text = n => (hasRange(n) ? src.slice(n.s, endOf(n)) : '')

  // ---- 式の型 ----
  function typeOf(e) {
    if (!e) return null
    switch (e.t) {
      case 'Number': return NUM
      case 'String': case 'Interp': return STR
      case 'True': case 'False': return BOOL
      case 'Nil': return NIL
      case 'Table': return TABLE
      case 'Func': return FUNC
      case 'Paren': return typeOf(e.e)
      case 'Cast': { const a = fromAnnotation(e.type); return a && a.size === 1 ? [...a][0] : null }
      case 'Un': return e.op === 'not' ? BOOL : e.op === '#' ? NUM : (typeOf(e.e) === NUM ? NUM : null)
      case 'Bin': {
        if (e.op === '..') return STR
        if (CMP.has(e.op) || ORDER.has(e.op)) return BOOL
        if (ARITH.has(e.op)) {
          const l = typeOf(e.l), r = typeOf(e.r)
          if (l === NUM && r === NUM) return NUM
          if (DATATYPES.has(l)) return l
          if (DATATYPES.has(r) && e.op === '*') return r
          return null
        }
        if (e.op === 'and' || e.op === 'or') { const l = typeOf(e.l), r = typeOf(e.r); return l && l === r ? l : null }
        return null
      }
      case 'Name': { const v = lookup(e.name); return v ? v.type : null }
      case 'Index': {
        // Enum.Material.Plastic
        if (e.dot && e.obj.t === 'Index' && e.obj.dot && e.obj.obj.t === 'Name' && e.obj.obj.name === 'Enum' && !lookup('Enum')) return 'Enum:' + e.obj.key.v
        if (e.dot && e.obj.t === 'Name' && !lookup(e.obj.name) && CTORS[e.obj.name] && /^(zero|one|xAxis|yAxis|zAxis|identity)$/.test(e.key.v)) return CTORS[e.obj.name][e.key.v] || null
        // 型の分かるオブジェクトのプロパティ
        if (e.dot && typeof e.key.v === 'string') {
          const cls = classOfNode(e.obj)
          const m = cls ? db.member(cls, e.key.v) : null
          if (m && m.kind === 'p') return fromApiType(m.type)
        }
        return null
      }
      case 'Call': {
        const fn = e.fn
        if (fn.t === 'Name' && !lookup(fn.name) && Object.prototype.hasOwnProperty.call(GLOBAL_RET, fn.name)) return GLOBAL_RET[fn.name]
        if (fn.t === 'Index' && fn.dot && fn.obj.t === 'Name' && !lookup(fn.obj.name)) {
          const lib = fn.obj.name, key = fn.key.v
          if (lib === 'Instance' && key === 'new' && e.args[0] && e.args[0].t === 'String' && db.isClass(e.args[0].v)) return 'Instance:' + e.args[0].v
          if (CTORS[lib] && Object.prototype.hasOwnProperty.call(CTORS[lib], key)) return CTORS[lib][key]
        }
        return null
      }
      case 'Method': {
        if (e.name === 'GetService' && e.args[0] && e.args[0].t === 'String' && db.isService(e.args[0].v)) return 'Instance:' + e.args[0].v
        if ((e.name === 'Clone') && isInst(typeOf(e.obj))) return typeOf(e.obj)
        return null
      }
    }
    return null
  }
  // オブジェクトのクラス (自分で推論 → だめならエディタの型推論)
  function classOfNode(n) {
    const t = typeOf0(n)
    if (isInst(t)) return instClass(t)
    if (n && (n.t === 'Name' || n.t === 'Index' || n.t === 'Method' || n.t === 'Call') && hasRange(n) && ctx.classOf) {
      try { return ctx.classOf(n) } catch { return null }
    }
    return null
  }
  // classOfNode → typeOf → classOfNode の無限の呼び合いを避ける
  let depth = 0
  function typeOf0(n) { if (depth > 6) return null; depth++; try { return typeOf(n) } finally { depth-- } }

  // ---- 代入: プロパティ ----
  function checkPropAssign(target, value) {
    if (target.t !== 'Index' || !target.dot || typeof target.key.v !== 'string') return
    const cls = classOfNode(target.obj)
    if (!cls) return
    const m = db.member(cls, target.key.v)
    if (!m || m.kind !== 'p') return
    const prop = target.key.v
    const keyNode = target.keyS !== undefined ? { s: target.keyS, e: target.keyS + prop.length } : target
    if (/r/.test(m.flags || '')) { add(keyNode, `'${prop}' は読み取り専用のプロパティです (${cls})。代入できません`); return }
    const want = fromApiType(m.type)
    const got = typeOf(value)
    if (!want || !got) return
    if (got === NIL && (want === NUM || want === BOOL || DATATYPES.has(want) || isEnum(want))) {
      add(value, `'${prop}' (${typeName(want)}) に nil は代入できません`)
      return
    }
    if (assignable(want, got)) {
      // Enum に文字列: 項目名が正しいか
      if (isEnum(want) && got === STR && value.t === 'String') {
        const items = (db.enumItems(want.slice(5)) || []).map(i => i[0])
        if (items.length && !items.includes(value.v)) {
          const near = items.find(i => i.toLowerCase() === String(value.v).toLowerCase()) || nearest(String(value.v), items)
          add(value, `"${value.v}" は Enum.${want.slice(5)} にありません${near ? `。もしかして ${near}?` : ''}`, 'warning', near ? [repl(`Enum.${want.slice(5)}.${near} にする`, endOf(value) - value.s, `Enum.${want.slice(5)}.${near}`)] : undefined)
        }
      }
      return
    }
    const len = endOf(value) - value.s
    const actions = []
    const t = text(value)
    if (want === NUM && value.t === 'String' && isNumericString(value.v)) actions.push(repl(`数値 ${value.v.trim()} にする`, len, value.v.trim()))
    else if (want === BOOL && value.t === 'String' && /^(true|false)$/i.test(value.v)) actions.push(repl(`${value.v.toLowerCase()} にする`, len, value.v.toLowerCase()))
    else if (want === BOOL && value.t === 'Number' && (value.v === 0 || value.v === 1)) actions.push(repl(`${value.v ? 'true' : 'false'} にする`, len, value.v ? 'true' : 'false'))
    else if (want === 'BrickColor' && got === 'Color3') actions.push(wrap('BrickColor.new(…) で包む', len, 'BrickColor.new(', ')'))
    else if (want === 'Color3' && got === 'BrickColor') actions.push(repl('.Color を付ける', len, t + '.Color'))
    else if (want === 'CFrame' && got === 'Vector3') actions.push(wrap('CFrame.new(…) で包む', len, 'CFrame.new(', ')'))
    else if (want === 'Vector3' && got === 'CFrame') actions.push(repl('.Position を付ける', len, t + '.Position'))
    else if (isInst(want) && value.t === 'String' && /^workspace$/i.test(value.v)) actions.push(repl('workspace にする', len, 'workspace'))
    else if (isInst(want) && value.t === 'String' && db.isService(value.v)) actions.push(repl(`game:GetService("${value.v}") にする`, len, `game:GetService("${value.v}")`))
    const hint = want === NUM && value.t === 'String' ? ' (" " を外すと数値になります)' : ''
    add(value, `'${prop}' は ${typeName(want)} ですが、${typeName(got)} を代入しています${hint}`, 'warning', actions.length ? actions : undefined)
  }

  // ---- 代入: 型注釈付きの変数 ----
  function checkAnnotated(node, allowed, value, label) {
    if (!allowed || !value) return
    const got = typeOf(value)
    if (!got) return
    for (const w of allowed) if (assignable(w, got)) return
    const len = endOf(value) !== undefined && hasRange(value) ? endOf(value) - value.s : 0
    const want = [...allowed].map(typeName).join(' | ')
    const actions = []
    if (allowed.has(NUM) && value.t === 'String' && isNumericString(value.v)) actions.push(repl(`数値 ${value.v.trim()} にする`, len, value.v.trim()))
    if (allowed.has(STR) && (got === BOOL || got === NIL) && len) actions.push(wrap('tostring(…) で包む', len, 'tostring(', ')'))
    add(value, `${label} は ${want} 型ですが、${typeName(got)} を入れています`, 'warning', actions.length ? actions : undefined)
  }

  // ---- 関数の引数 ----
  function checkArgs(fullName, args, params, callNode) {
    for (let i = 0; i < args.length && i < params.length; i++) {
      const p = params[i]
      if (!p) continue
      const a = args[i]
      const got = typeOf(a)
      if (!got) continue
      let allowed = p
      if (typeof p === 'string') {
        allowed = new Set()
        const opt = p.endsWith('?')
        const base = opt ? p.slice(0, -1) : p
        if (opt) allowed.add(NIL)
        if (base === 'number' || base === 'string' || base === 'boolean' || base === 'function') allowed.add(base)
        else if (base === 'Instance') allowed.add('Instance:Instance')
        else allowed = null
      }
      if (!allowed) continue
      let ok = false
      for (const w of allowed) if (w === FUNC ? got === FUNC : assignable(w, got)) { ok = true; break }
      if (ok) continue
      const len = hasRange(a) ? endOf(a) - a.s : 0
      const actions = []
      if (allowed.has(NUM) && a.t === 'String' && isNumericString(a.v)) actions.push(repl(`数値 ${a.v.trim()} にする`, len, a.v.trim()))
      add(a, `${fullName} の ${i + 1} 番目の引数は ${[...allowed].filter(x => x !== NIL).map(typeName).join(' | ')} ですが、${typeName(got)} を渡しています`, 'warning', actions.length ? actions : undefined)
    }
    // 色の範囲: Color3.new は 0〜1、Color3.fromRGB は 0〜255
    if (fullName === 'Color3.new' && args.some(a => a.t === 'Number' && a.v > 1) && args.every(a => a.t !== 'Number' || a.v <= 255) && hasRange(callNode)) {
      const fnLen = 'Color3.new'.length
      add(callNode, 'Color3.new は 0〜1 の値で指定します。0〜255 で指定するなら Color3.fromRGB を使います', 'warning', [repl('Color3.fromRGB にする', fnLen, 'Color3.fromRGB')])
    } else if (fullName === 'Color3.fromRGB' && args.some(a => a.t === 'Number' && (a.v > 255 || a.v < 0))) {
      const bad = args.find(a => a.t === 'Number' && (a.v > 255 || a.v < 0))
      add(bad, 'Color3.fromRGB の値は 0〜255 です')
    }
  }
  function checkCall(e) {
    const fn = e.fn
    if (fn.t === 'Name') {
      const v = lookup(fn.name)
      if (v && v.type && v.type !== FUNC && v.type !== TABLE && PRIMS.has(v.type)) { add(fn, `'${fn.name}' は ${typeName(v.type)} なので、関数として呼び出せません`); return }
      if (v && v.sig) { checkArgs(`${fn.name}()`, e.args, v.sig, e); return }
      if (!v && PARAMS[fn.name]) checkArgs(`${fn.name}()`, e.args, PARAMS[fn.name], e)
      return
    }
    if (fn.t === 'Index' && fn.dot && fn.obj.t === 'Name' && !lookup(fn.obj.name)) {
      const full = `${fn.obj.name}.${fn.key.v}`
      if (PARAMS[full]) checkArgs(full, e.args, PARAMS[full], e)
    }
  }
  function checkMethod(e) {
    const cls = classOfNode(e.obj)
    if (!cls) return
    const m = db.member(cls, e.name)
    if (!m || m.kind !== 'f' || !m.type) return
    let ps
    try { ps = db.paramsOf(m.type) } catch { return }
    if (!ps || !ps.length) return
    const params = ps.map(p => {
      const ty = String(p.type || '').trim()
      const opt = ty.endsWith('?') || /=/.test(p.name || '')
      const base = fromApiType(ty.replace(/\?$/, ''))
      if (!base || !(base === NUM || base === STR || base === BOOL)) return null
      const s = new Set([base])
      if (opt) s.add(NIL)
      return s
    })
    checkArgs(`${cls}:${e.name}`, e.args, params, e)
  }

  // ---- 計算・連結・比較 ----
  function checkBin(e) {
    const l = typeOf(e.l), r = typeOf(e.r)
    if (e.op === '+' && (l === STR || r === STR) && !(e.l.t === 'String' && isNumericString(e.l.v)) && !(e.r.t === 'String' && isNumericString(e.r.v)) && (e.l.t === 'String' || e.r.t === 'String' || e.l.t === 'Interp' || e.r.t === 'Interp')) {
      add(e, '文字列をつなぐときは + ではなく .. を使います', 'warning', e.opS !== undefined ? [{ name: "'..' に置き換え", edits: [{ a: e.opS - e.s, d: 1, i: '..' }] }] : undefined)
      return
    }
    if (e.op === '..') {
      for (const side of [e.l, e.r]) {
        const t = typeOf(side)
        if (t === BOOL || t === NIL || t === TABLE || isInst(t)) {
          const len = hasRange(side) ? endOf(side) - side.s : 0
          add(side, `${typeName(t)} は .. でつなげません。tostring(…) で文字列にします`, 'warning', len ? [wrap('tostring(…) で包む', len, 'tostring(', ')')] : undefined)
        }
      }
      return
    }
    if (ARITH.has(e.op)) {
      for (const side of [e.l, e.r]) {
        const t = typeOf(side)
        if (t === BOOL || t === NIL || t === TABLE || t === FUNC || isInst(t)) add(side, `${typeName(t)} は計算 (${e.op}) に使えません`)
        else if (t === STR && side.t === 'String' && !isNumericString(side.v) && e.op !== '+') add(side, `文字列 "${side.v}" は計算 (${e.op}) に使えません`)
      }
      return
    }
    if (CMP.has(e.op) && l && r && l !== r && PRIMS.has(l) && PRIMS.has(r) && l !== NIL && r !== NIL && !(l === TABLE || r === TABLE)) {
      add(e, `${typeName(l)} と ${typeName(r)} を比べているので、結果はいつも ${e.op === '==' ? 'false' : 'true'} です`, 'info')
    }
    if (ORDER.has(e.op) && ((l === NUM && r === STR) || (l === STR && r === NUM)) && (e.l.t === 'String' || e.r.t === 'String')) {
      add(e, '数値と文字列は大小を比べられません (実行するとエラーになります)。tonumber(…) で数値にします')
    }
  }

  // ---- 走査 ----
  function expr(e) {
    if (!e || typeof e !== 'object') return
    switch (e.t) {
      case 'Call': checkCall(e); expr(e.fn); e.args.forEach(expr); return
      case 'Method': checkMethod(e); expr(e.obj); e.args.forEach(expr); return
      case 'Bin': checkBin(e); expr(e.l); expr(e.r); return
      case 'Un': expr(e.e); return
      case 'Paren': case 'Cast': expr(e.e); return
      case 'Index': expr(e.obj); if (!e.dot) expr(e.key); return
      case 'Func': func(e); return
      case 'Table': for (const it of e.items) { if (it.k === 'expr') expr(it.key); expr(it.value) } return
      case 'IfExpr': for (const c of e.clauses) { expr(c.cond); expr(c.val) } expr(e.orelse); return
      case 'Interp': for (const p of e.parts) if (typeof p !== 'string') expr(p); return
    }
  }
  function func(f) {
    scopes.push(new Map())
    for (const p of f.params || []) {
      const allowed = fromAnnotation(p.type)
      declare(p.name, { type: allowed && allowed.size === 1 ? [...allowed][0] : null, allowed })
    }
    block(f.body)
    scopes.pop()
  }
  function block(stats) { for (const st of stats || []) stat(st) }
  function scoped(stats) { scopes.push(new Map()); block(stats); scopes.pop() }
  function stat(st) {
    switch (st.t) {
      case 'Local': {
        st.values.forEach(expr)
        st.names.forEach((n, i) => {
          const v = st.values[i]
          const allowed = fromAnnotation(n.type)
          if (allowed) checkAnnotated(n, allowed, v, `'${n.name}'`)
          const inferred = i < st.values.length && !(i === st.values.length - 1 && st.values.length < st.names.length) ? typeOf(v) : (i >= st.values.length ? NIL : null)
          declare(n.name, { type: allowed && allowed.size === 1 ? [...allowed][0] : (allowed ? null : (inferred === NIL ? null : inferred)), allowed })
        })
        return
      }
      case 'LocalFunction': {
        const sig = (st.func.params || []).map(p => fromAnnotation(p.type))
        declare(st.name.name, { type: FUNC, sig: sig.some(Boolean) ? sig : null })
        func(st.func)
        return
      }
      case 'Function': expr(st.target.obj || null); func(st.func); return
      case 'Assign':
        st.values.forEach(expr)
        st.targets.forEach((t, i) => {
          const v = st.values[i]
          if (t.t === 'Name') {
            const info = lookup(t.name)
            if (info && info.allowed && v) checkAnnotated(t, info.allowed, v, `'${t.name}'`)
            else if (info && !info.allowed) info.type = v && i < st.values.length ? (typeOf(v) === info.type ? info.type : null) : null
          } else {
            expr(t)
            if (v && st.targets.length === st.values.length) checkPropAssign(t, v)
          }
        })
        return
      case 'Compound': expr(st.value); expr(st.target); return
      case 'CallStat': expr(st.call); return
      case 'If': for (const c of st.clauses) { expr(c.cond); scoped(c.body) } if (st.orelse) scoped(st.orelse); return
      case 'While': expr(st.cond); scoped(st.body); return
      case 'Repeat': scopes.push(new Map()); block(st.body); expr(st.cond); scopes.pop(); return
      case 'NumFor': expr(st.start); expr(st.stop); expr(st.step); scopes.push(new Map()); declare(st.var.name, { type: NUM }); block(st.body); scopes.pop(); return
      case 'GenFor': st.exprs.forEach(expr); scopes.push(new Map()); st.vars.forEach(v => declare(v.name, { type: null })); block(st.body); scopes.pop(); return
      case 'Do': scoped(st.body); return
      case 'Return': st.values.forEach(expr); return
    }
  }
  try { block(ast.body) } catch { /* 型チェックの失敗でエラーチェック全体を止めない */ }
  return diags
}
