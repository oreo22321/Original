// Luau 実行時コア: 値の表現、テーブル、関数呼び出し、演算子、エラー
// 値の表現:
//   nil → undefined, boolean → boolean, number → number, string → バイト文字列 (JS string)
//   table → LTable, function → LFunc, thread → Coroutine, userdata → luaIndex() を持つ JS オブジェクト
import { fromBytes } from './lexer.js'

export const EMPTY = Object.freeze([])

export class LuaError extends Error {
  constructor(value, level = 1) {
    super(typeof value === 'string' ? fromBytes(value) : 'error')
    this.value = value
    this.level = level
    this.positioned = level === 0
    this.traceback = []
  }
}

// 実行停止 (タイムアウト/停止ボタン) 用。pcall では捕捉されません
export class HaltSignal extends Error {
  constructor(reason) { super(reason); this.halt = true }
}

export function rtError(msg) { return new LuaError(msg, 1) }

// ---- テーブル ----
export class LTable {
  constructor() {
    this.hash = new Map()
    this.arr = [undefined]
    this.mt = null
    this.readonly = false
  }
  get(k) {
    if (typeof k === 'number' && k > 0 && k < this.arr.length && Math.floor(k) === k) return this.arr[k]
    return this.hash.get(k)
  }
  set(k, v) {
    if (typeof k === 'number') {
      const n = this.arr.length
      if (k > 0 && k <= n && Math.floor(k) === k) {
        if (k < n) {
          this.arr[k] = v
          if (v === undefined && k === n - 1) {
            let m = k - 1
            while (m > 0 && this.arr[m] === undefined) m--
            this.arr.length = m + 1
          }
          return
        }
        if (v === undefined) { this.hash.delete(k); return }
        this.arr.push(v)
        if (this.hash.size) {
          this.hash.delete(k)
          let j = k + 1
          while (this.hash.has(j)) { this.arr.push(this.hash.get(j)); this.hash.delete(j); j++ }
        }
        return
      }
      if (k !== k) throw rtError('table index is NaN')
    } else if (k === undefined) throw rtError('table index is nil')
    if (v === undefined) this.hash.delete(k)
    else this.hash.set(k, v)
  }
  length() { return this.arr.length - 1 }
  // next(k): 次の [key, value] または null
  next(k) {
    const arr = this.arr
    let i
    if (k === undefined) i = 1
    else if (typeof k === 'number' && k > 0 && k < arr.length && Math.floor(k) === k) i = k + 1
    else i = -1
    if (i > 0) {
      for (; i < arr.length; i++) if (arr[i] !== undefined) return [i, arr[i]]
      const it = this.hash.entries()
      const r = it.next()
      if (r.done) return null
      this._iterKey = r.value[0]; this._iter = it
      return r.value
    }
    // ハッシュ部: 直前の next の続きなら O(1)
    let it
    if (this._iter && this._iterKey === k) it = this._iter
    else {
      if (!this.hash.has(k)) throw rtError("invalid key to 'next'")
      it = this.hash.entries()
      for (;;) { const r = it.next(); if (r.done) return null; if (r.value[0] === k) break }
    }
    const r = it.next()
    if (r.done) { this._iter = null; return null }
    this._iterKey = r.value[0]; this._iter = it
    return r.value
  }
  static fromArray(items) {
    const t = new LTable()
    t.arr = [undefined, ...items]
    let m = t.arr.length - 1
    while (m > 0 && t.arr[m] === undefined) m--
    t.arr.length = m + 1
    return t
  }
  static fromObject(obj) {
    const t = new LTable()
    for (const k in obj) t.set(k, obj[k])
    return t
  }
}

// ---- 関数 ----
// g: Lua 関数 (generator, 引数配列を受け取り、戻り値配列を返す)
// n: ネイティブ関数 (同期)。戻り値: 配列=複数値 / それ以外=1つの値 (undefined は nil 1 個)
// gn: ネイティブ generator (yield できる)
export class LFunc {
  constructor(name, g, n, gn) {
    this.name = name
    this.g = g || null
    this.n = n || null
    this.gn = gn || null
  }
}
export const native = (name, fn) => new LFunc(name, null, fn, null)
export const nativeGen = (name, fn) => new LFunc(name, null, null, fn)

function norm(r) {
  return Array.isArray(r) ? r : [r]
}

// ---- コルーチン ----
let threadCounter = 0
export class Coroutine {
  constructor(fn) {
    this.fn = fn
    this.gen = null
    this.status = 'suspended'
    this.id = ++threadCounter
    this.cancelled = false
  }
}

// ---- 実行環境の共有状態 ----
export const rt = {
  current: null,          // 実行中の Coroutine
  scheduler: null,        // scheduler.js が設定
  stringMeta: null,       // string ライブラリ (文字列の __index)
  namecallHook: null,     // hookmetamethod(__namecall)
  indexHook: null,
  newindexHook: null,
  namecallMethod: null,
  inHook: 0,
  ops: 0,
  sliceStart: 0,
  timeLimit: 10000,
  halted: null,
  lastTraceback: null,
  syncDepth: 0,           // 同期実行 (メタメソッドなど) の深さ。この中ではデバッガーで止まれない
  debugger: null,         // デバッグ実行中は debug.js の Debugger
}

// チャンクの一番外側のローカル変数 (コンソール用): chunk 名 → 値の一覧を返す関数
export function topLocals(chunk, getter) {
  if (!rt.tops) rt.tops = new Map()
  rt.tops.set(chunk, getter)
}

export function checkTime() {
  if (rt.halted) throw new HaltSignal(rt.halted)
  if (rt.timeLimit > 0 && Date.now() - rt.sliceStart > rt.timeLimit) {
    throw new LuaError('Script timeout: exhausted allowed execution time (無限ループの可能性があります。ループ内に task.wait() を入れてください)', 0)
  }
}
export function chk() {
  if ((++rt.ops & 0x3ff) === 0) checkTime()
}

// ---- 型 ----
export function type(v) {
  switch (typeof v) {
    case 'undefined': return 'nil'
    case 'boolean': return 'boolean'
    case 'number': return 'number'
    case 'string': return 'string'
  }
  if (v instanceof LTable) return 'table'
  if (v instanceof LFunc) return 'function'
  if (v instanceof Coroutine) return 'thread'
  if (v && v.isBuffer) return 'buffer'
  if (v && v.isVector) return 'vector'
  return 'userdata'
}

export function typeOf(v) {
  if (v !== null && typeof v === 'object' && v.luaIndex && !(v instanceof LTable)) {
    if (v.luaTypeName) return v.luaTypeName
    if (v.mt instanceof LTable) {
      const t = v.mt.get('__type')
      if (typeof t === 'string') return t
    }
  }
  return type(v)
}

// 例外メッセージ向けの型名 (Roblox オブジェクトは型名を表示)
function tn(v) {
  const t = type(v)
  if (t === 'userdata') return typeOf(v)
  return t
}

// ---- アドレス表示 ----
const addrMap = new WeakMap()
let addrSeed = 0x1f3a2b40
export function addressOf(o) {
  let a = addrMap.get(o)
  if (!a) {
    addrSeed += 0x38 + ((addrSeed * 7) & 0xf8)
    a = '0x' + (0x20000000000 + addrSeed).toString(16).padStart(16, '0')
    addrMap.set(o, a)
  }
  return a
}

// ---- 数値 ⇔ 文字列 ----
export function fmtNum(n) {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return Object.is(n, -0) ? '-0' : String(n)
  if (n !== n) return 'nan'
  if (n === Infinity) return 'inf'
  if (n === -Infinity) return '-inf'
  const a = Math.abs(n)
  if (a >= 1e-4 && a < 1e15) return String(n)
  // 指数表記 (C の %g 風: 1e+15, 1.5e-07)
  const [mant, exp] = n.toExponential().split('e')
  const ex = parseInt(exp, 10)
  return mant + 'e' + (ex < 0 ? '-' : '+') + String(Math.abs(ex)).padStart(2, '0')
}

export function str2num(s, base) {
  s = s.trim()
  if (base !== undefined && base !== 10) {
    if (!s) return undefined
    let neg = false
    if (s[0] === '-') { neg = true; s = s.slice(1) }
    if (base === 16 && /^0x/i.test(s)) s = s.slice(2)
    let v = 0
    for (const ch of s.toLowerCase()) {
      const d = /[0-9]/.test(ch) ? ch.charCodeAt(0) - 48 : /[a-z]/.test(ch) ? ch.charCodeAt(0) - 87 : 99
      if (d >= base) return undefined
      v = v * base + d
    }
    return s ? (neg ? -v : v) : undefined
  }
  if (!s) return undefined
  if (/^[-+]?0x[0-9a-f]+$/i.test(s)) {
    const neg = s[0] === '-'
    const v = parseInt(s.replace(/^[-+]/, ''), 16)
    return neg ? -v : v
  }
  if (/^[-+]?0b[01]+$/i.test(s)) {
    const neg = s[0] === '-'
    const v = parseInt(s.replace(/^[-+]?0b/i, ''), 2)
    return neg ? -v : v
  }
  if (/^[-+]?(inf|nan)/i.test(s)) return undefined
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return Number(s)
  return undefined
}

function toNumArith(v) {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return str2num(v)
  return undefined
}

// ---- メタテーブル ----
export function getMetatable(v) {
  if (v instanceof LTable) return v.mt
  if (typeof v === 'string') return rt.stringMetaTable || null
  if (v !== null && typeof v === 'object' && v.mt instanceof LTable) return v.mt
  return null
}

// メタメソッド: LFunc または JS 関数を返す
function metamethod(v, ev) {
  if (v instanceof LTable) return v.mt ? v.mt.get(ev) : undefined
  if (v !== null && typeof v === 'object') {
    if (v.meta && v.meta[ev]) return v.meta[ev]
    if (v.mt instanceof LTable) return v.mt.get(ev)
  }
  return undefined
}

function callMeta(h, args) {
  if (typeof h === 'function') return h(...args)
  return callSync(h, args)[0]
}

// generator を同期的に最後まで実行 (メタメソッドや sort の比較関数など)
export function callSync(f, args) {
  const g = call(f, args)
  let r
  rt.syncDepth++
  try { r = g.next() } finally { rt.syncDepth-- }
  if (!r.done) {
    const sig = r.value
    if (sig && sig.kind === 'yield') throw rtError('attempt to yield across metamethod/C-call boundary')
    throw rtError('この場所では待機 (yield) できません (メタメソッドや比較関数の中など)')
  }
  return r.value
}

// ---- 呼び出し ----
export function* call(f, args, hint) {
  if (f instanceof LFunc) {
    if (f.g) return yield* f.g(args)
    if (f.n) return norm(f.n(args))
    return norm(yield* f.gn(args))
  }
  const h = metamethod(f, '__call')
  if (h !== undefined) {
    if (typeof h === 'function') return norm(h(f, ...args))
    return yield* call(h, [f, ...args])
  }
  throw rtError(`attempt to call a ${tn(f)} value${hint ? ' (' + hint + ')' : ''}`)
}

export function* callMethod(o, name, args) {
  if (rt.namecallHook && rt.inHook === 0 && o !== null && typeof o === 'object' && o.isInstance) {
    const prev = rt.namecallMethod
    rt.namecallMethod = name
    rt.inHook++
    try {
      return yield* call(rt.namecallHook, [o, ...args])
    } finally {
      rt.inHook--
      rt.namecallMethod = prev
    }
  }
  const f = index(o, name)
  if (f === undefined) {
    if (o === undefined) throw rtError(`attempt to index nil with '${fromBytes(name)}'`)
    throw rtError(`attempt to call missing method '${fromBytes(name)}' of ${tn(o)}`)
  }
  if (f instanceof LFunc && f.n) return norm(f.n([o, ...args]))
  return yield* call(f, [o, ...args], `method '${fromBytes(name)}'`)
}

// ---- インデックス ----
function keyDesc(k) {
  if (typeof k === 'string') return `'${fromBytes(k)}'`
  if (typeof k === 'number') return 'number'
  return tn(k)
}

export function index(o, k) {
  if (o instanceof LTable) {
    const v = o.get(k)
    if (v !== undefined || o.mt === null) return v
    const h = o.mt.get('__index')
    if (h === undefined) return undefined
    if (h instanceof LFunc) return callSync(h, [o, k])[0]
    return index(h, k)
  }
  if (typeof o === 'string') {
    if (rt.stringMeta) return rt.stringMeta.get(k)
    return undefined
  }
  if (o !== null && typeof o === 'object' && o.luaIndex) {
    if (rt.indexHook && rt.inHook === 0 && o.isInstance) {
      rt.inHook++
      try { return callSync(rt.indexHook, [o, k])[0] } finally { rt.inHook-- }
    }
    return o.luaIndex(k)
  }
  throw rtError(`attempt to index ${tn(o)} with ${keyDesc(k)}`)
}

export function setindex(o, k, v) {
  if (o instanceof LTable) {
    if (o.readonly) throw rtError('attempt to modify a readonly table')
    if (o.mt === null) { o.set(k, v); return }
    if (o.get(k) !== undefined) { o.set(k, v); return }
    const h = o.mt.get('__newindex')
    if (h === undefined) { o.set(k, v); return }
    if (h instanceof LFunc) { callSync(h, [o, k, v]); return }
    setindex(h, k, v)
    return
  }
  if (o !== null && typeof o === 'object' && o.luaNewIndex) {
    if (rt.newindexHook && rt.inHook === 0 && o.isInstance) {
      rt.inHook++
      try { callSync(rt.newindexHook, [o, k, v]); return } finally { rt.inHook-- }
    }
    o.luaNewIndex(k, v)
    return
  }
  throw rtError(`attempt to index ${tn(o)} with ${keyDesc(k)}`)
}

export function rawget(t, k) { return t.get(k) }
export function rawset(t, k, v) { t.set(k, v) }

// ---- 真偽 ----
export const T = v => v !== undefined && v !== false

// ---- 算術 ----
const ARITH_NAME = { __add: 'add', __sub: 'sub', __mul: 'mul', __div: 'div', __mod: 'mod', __pow: 'pow', __unm: 'unm', __idiv: 'idiv' }
function arith(ev, a, b, op) {
  const na = toNumArith(a), nb = toNumArith(b)
  if (na !== undefined && nb !== undefined) return op(na, nb)
  let h = metamethod(a, ev)
  if (h === undefined) h = metamethod(b, ev)
  if (h !== undefined) return callMeta(h, [a, b])
  throw rtError(`attempt to perform arithmetic (${ARITH_NAME[ev]}) on ${tn(a)}${ev === '__unm' ? '' : ' and ' + tn(b)}`)
}
const fadd = (a, b) => a + b, fsub = (a, b) => a - b, fmul = (a, b) => a * b, fdiv = (a, b) => a / b
const fmod = (a, b) => {
  if (b === Infinity) return a >= 0 ? a : (a === -Infinity ? NaN : b)
  if (b === -Infinity) return a <= 0 ? a : b
  const r = a - Math.floor(a / b) * b
  return r
}
const fpow = (a, b) => Math.pow(a, b)
const fidiv = (a, b) => Math.floor(a / b)
export const add = (a, b) => (typeof a === 'number' && typeof b === 'number') ? a + b : arith('__add', a, b, fadd)
export const sub = (a, b) => (typeof a === 'number' && typeof b === 'number') ? a - b : arith('__sub', a, b, fsub)
export const mul = (a, b) => (typeof a === 'number' && typeof b === 'number') ? a * b : arith('__mul', a, b, fmul)
export const div = (a, b) => (typeof a === 'number' && typeof b === 'number') ? a / b : arith('__div', a, b, fdiv)
export const mod = (a, b) => (typeof a === 'number' && typeof b === 'number') ? fmod(a, b) : arith('__mod', a, b, fmod)
export const pow = (a, b) => (typeof a === 'number' && typeof b === 'number') ? Math.pow(a, b) : arith('__pow', a, b, fpow)
export const idiv = (a, b) => (typeof a === 'number' && typeof b === 'number') ? Math.floor(a / b) : arith('__idiv', a, b, fidiv)
export const unm = a => typeof a === 'number' ? -a : arith('__unm', a, a, x => -x)

// ---- 比較 ----
export function eq(a, b) {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (a instanceof LTable && b instanceof LTable) {
    let h = metamethod(a, '__eq')
    if (h === undefined) h = metamethod(b, '__eq')
    if (h === undefined) return false
    return T(callMeta(h, [a, b]))
  }
  if (a.luaIndex && b.luaIndex && a.meta && a.meta.__eq && a.meta === b.meta) return !!a.meta.__eq(a, b)
  return false
}

function cmpError(a, b, op) {
  return rtError(`attempt to compare ${tn(a)} ${op} ${tn(b)}`)
}
export function lt(a, b) {
  const ta = typeof a, tb = typeof b
  if (ta === 'number' && tb === 'number') return a < b
  if (ta === 'string' && tb === 'string') return a < b
  let h = metamethod(a, '__lt')
  if (h === undefined) h = metamethod(b, '__lt')
  if (h !== undefined && type(a) === type(b)) return T(callMeta(h, [a, b]))
  throw cmpError(a, b, '<')
}
export function le(a, b) {
  const ta = typeof a, tb = typeof b
  if (ta === 'number' && tb === 'number') return a <= b
  if (ta === 'string' && tb === 'string') return a <= b
  let h = metamethod(a, '__le')
  if (h === undefined) h = metamethod(b, '__le')
  if (h !== undefined && type(a) === type(b)) return T(callMeta(h, [a, b]))
  throw cmpError(a, b, '<=')
}
export const gt = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return a > b
  try { return lt(b, a) } catch (e) { if (e instanceof LuaError) throw cmpError(a, b, '>'); throw e }
}
export const ge = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return a >= b
  try { return le(b, a) } catch (e) { if (e instanceof LuaError) throw cmpError(a, b, '>='); throw e }
}

// ---- 文字列結合・長さ ----
export function concat(a, b) {
  const ta = typeof a, tb = typeof b
  if ((ta === 'string' || ta === 'number') && (tb === 'string' || tb === 'number')) {
    return (ta === 'number' ? fmtNum(a) : a) + (tb === 'number' ? fmtNum(b) : b)
  }
  let h = metamethod(a, '__concat')
  if (h === undefined) h = metamethod(b, '__concat')
  if (h !== undefined) return callMeta(h, [a, b])
  throw rtError(`attempt to concatenate ${tn(a)} with ${tn(b)}`)
}

export function len(a) {
  if (typeof a === 'string') return a.length
  if (a instanceof LTable) {
    if (a.mt) {
      const h = a.mt.get('__len')
      if (h !== undefined) return callMeta(h, [a])
    }
    return a.length()
  }
  const h = metamethod(a, '__len')
  if (h !== undefined) return callMeta(h, [a])
  throw rtError(`attempt to get length of a ${tn(a)} value`)
}

// ---- tostring ----
export function tostring(v) {
  switch (typeof v) {
    case 'undefined': return 'nil'
    case 'boolean': return v ? 'true' : 'false'
    case 'number': return fmtNum(v)
    case 'string': return v
  }
  const h = metamethod(v, '__tostring')
  if (h !== undefined) {
    const r = callMeta(h, [v])
    if (typeof r !== 'string') {
      if (typeof r === 'number') return fmtNum(r)
      throw rtError("'__tostring' must return a string")
    }
    return r
  }
  if (v instanceof LTable) {
    const name = v.mt && v.mt.get('__name')
    return (typeof name === 'string' ? name : 'table') + ': ' + addressOf(v)
  }
  if (v instanceof LFunc) return 'function: ' + addressOf(v)
  if (v instanceof Coroutine) return 'thread: ' + addressOf(v)
  if (v && v.luaToString) return v.luaToString()
  return 'userdata: ' + addressOf(v)
}

// 補間文字列
export function interp(parts) {
  let s = ''
  for (const p of parts) s += typeof p === 'string' ? p : tostring(p)
  return s
}

// ---- テーブルコンストラクタ ----
export function tbl(arr, pairs) {
  const t = arr ? LTable.fromArray(arr) : new LTable()
  if (pairs) {
    for (let i = 0; i < pairs.length; i += 2) {
      const k = pairs[i]
      if (k === undefined) throw rtError('table index is nil')
      if (pairs[i + 1] !== undefined) t.set(k, pairs[i + 1])
    }
  }
  return t
}

// ---- 汎用 for のイテレータ ----
class TableIter {
  constructor(t) { this.t = t; this.i = 1; this.it = null; this.f = true }
  step() {
    const arr = this.t.arr
    while (this.i < arr.length) {
      const i = this.i++
      if (arr[i] !== undefined) return [i, arr[i]]
    }
    if (!this.it) this.it = this.t.hash.entries()
    for (;;) {
      const r = this.it.next()
      if (r.done) return null
      // 反復中に nil にされたキーは飛ばす
      if (this.t.hash.has(r.value[0])) return r.value
    }
  }
}
class IpairsIter {
  constructor(t) { this.t = t; this.i = 0; this.f = true; this.raw = !(t instanceof LTable) || t.mt === null }
  step() {
    const i = ++this.i
    const v = this.raw ? this.t.get(i) : index(this.t, i)
    return v === undefined ? null : [i, v]
  }
}
class GenericIter {
  constructor(fn, s, ctl) { this.fn = fn; this.s = s; this.ctl = ctl; this.f = false }
  *g() {
    const r = yield* call(this.fn, [this.s, this.ctl], 'for iterator')
    if (r[0] === undefined) return null
    this.ctl = r[0]
    return r
  }
}
export const iterMarks = { next: null, ipairsIter: null }

export function iter(vals) {
  let fn = vals[0]
  const s = vals[1], ctl = vals[2]
  if (fn === iterMarks.next && s instanceof LTable && ctl === undefined) return new TableIter(s)
  if (fn === iterMarks.ipairsIter && ctl === 0) return new IpairsIter(s)
  if (fn instanceof LTable) {
    // Luau の汎用反復 (for k, v in t do)
    const h = fn.mt ? fn.mt.get('__iter') : undefined
    if (h !== undefined) {
      const r = callSync(h, [fn])
      return iter(r)
    }
    if (!fn.mt || fn.mt.get('__call') === undefined) return new TableIter(fn)
  }
  if (fn !== null && typeof fn === 'object' && fn.luaIterate) return fn.luaIterate()
  if (fn === undefined) throw rtError('attempt to iterate over a nil value')
  if (!(fn instanceof LFunc) && metamethod(fn, '__call') === undefined) throw rtError(`attempt to iterate over a ${tn(fn)} value`)
  return new GenericIter(fn, s, ctl)
}

// for 数値ループの検査
export function forNum(v, what) {
  if (typeof v === 'number') return v
  const n = typeof v === 'string' ? str2num(v) : undefined
  if (n === undefined) throw rtError(`invalid 'for' ${what} (number expected, got ${tn(v)})`)
  return n
}

// ---- 関数オブジェクト生成 ----
export function fn(g, name) {
  return new LFunc(name, g)
}

// ---- エラー位置の付与 ----
export function annot(e, line, chunk, fname) {
  if (e instanceof LuaError) {
    if (!e.positioned) {
      if (e.level <= 1) {
        if (typeof e.value === 'string') {
          e.value = `${chunk}:${line}: ${e.value}`
          e.message = fromBytes(e.value)
        }
        e.positioned = true
      } else e.level--
    }
    if (e.traceback.length < 30) e.traceback.push(`${chunk}:${line}${fname ? ' function ' + fname : ''}`)
    return e
  }
  if (e && e.halt) return e
  if (e instanceof RangeError && /call stack|recursion/i.test(e.message)) {
    const le = new LuaError(`${chunk}:${line}: stack overflow (再帰が深すぎます)`, 0)
    le.traceback.push(`${chunk}:${line}`)
    return le
  }
  const le = new LuaError(`${chunk}:${line}: 内部エラー: ${e && e.message}`, 0)
  le.jsError = e
  return le
}

export function errValue(e) {
  if (e instanceof LuaError) return e.value
  if (e && e.halt) throw e
  return 'internal error: ' + (e && e.message)
}
