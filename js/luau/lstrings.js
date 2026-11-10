// string ライブラリ (Lua パターン / string.format を含む)
import { LTable, LuaError, rtError, native, nativeGen, call, tostring, fmtNum, str2num, index, type, EMPTY } from './runtime.js'

// ---- 引数チェック ----
export function argError(n, fname, msg) {
  return rtError(`invalid argument #${n} to '${fname}' (${msg})`)
}
export function checkStr(A, i, fname) {
  const v = A[i]
  if (typeof v === 'string') return v
  if (typeof v === 'number') return fmtNum(v)
  throw argError(i + 1, fname, `string expected, got ${v === undefined ? 'no value' : type(v)}`)
}
export function checkNum(A, i, fname) {
  const v = A[i]
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const n = str2num(v); if (n !== undefined) return n }
  throw argError(i + 1, fname, `number expected, got ${v === undefined ? 'no value' : type(v)}`)
}
export function optNum(A, i, fname, def) {
  return A[i] === undefined ? def : checkNum(A, i, fname)
}
export function checkInt(A, i, fname) {
  return Math.trunc(checkNum(A, i, fname))
}
export function optInt(A, i, fname, def) {
  return A[i] === undefined ? def : checkInt(A, i, fname)
}
export function checkTable(A, i, fname) {
  const v = A[i]
  if (v instanceof LTable) return v
  throw argError(i + 1, fname, `table expected, got ${v === undefined ? 'no value' : type(v)}`)
}

function posrelat(pos, len) {
  if (pos >= 0) return pos
  if (-pos > len) return 0
  return len + pos + 1
}

// ---- Lua パターン ----
const CAP_UNFINISHED = -1
const CAP_POSITION = -2
const MAXCCALLS = 200
const SPECIALS = /[\^$*+?.()[\]%-]/

class MatchState {
  constructor(src, pat) {
    this.src = src
    this.pat = pat
    this.level = 0
    this.capture = []
    this.matchdepth = MAXCCALLS
  }
}

function classEnd(ms, p) {
  const pat = ms.pat
  if (p >= pat.length) throw rtError("malformed pattern (ends with '%')")
  const c = pat[p++]
  if (c === '%') {
    if (p >= pat.length) throw rtError("malformed pattern (ends with '%')")
    return p + 1
  }
  if (c === '[') {
    if (pat[p] === '^') p++
    do {
      if (p >= pat.length) throw rtError("malformed pattern (missing ']')")
      const cc = pat[p++]
      if (cc === '%' && p < pat.length) p++
    } while (pat[p] !== ']')
    return p + 1
  }
  return p
}

function matchClass(c, cl) {
  let res
  const lower = cl.toLowerCase()
  switch (lower) {
    case 'a': res = (c >= 65 && c <= 90) || (c >= 97 && c <= 122); break
    case 'c': res = c < 32 || c === 127; break
    case 'd': res = c >= 48 && c <= 57; break
    case 'g': res = c > 32 && c < 127; break
    case 'l': res = c >= 97 && c <= 122; break
    case 'p': res = (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126); break
    case 's': res = c === 32 || (c >= 9 && c <= 13); break
    case 'u': res = c >= 65 && c <= 90; break
    case 'w': res = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122); break
    case 'x': res = (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102); break
    default: return cl.charCodeAt(0) === c
  }
  if (cl !== lower) res = !res
  return res
}

function matchBracketClass(ms, c, p, ec) {
  const pat = ms.pat
  let sig = true
  if (pat[p + 1] === '^') { sig = false; p++ }
  while (++p < ec) {
    if (pat[p] === '%') {
      p++
      if (matchClass(c, pat[p])) return sig
    } else if (pat[p + 1] === '-' && p + 2 < ec) {
      p += 2
      if (pat.charCodeAt(p - 2) <= c && c <= pat.charCodeAt(p)) return sig
    } else if (pat.charCodeAt(p) === c) return sig
  }
  return !sig
}

function singleMatch(ms, s, p, ep) {
  if (s >= ms.src.length) return false
  const c = ms.src.charCodeAt(s)
  switch (ms.pat[p]) {
    case '.': return true
    case '%': return matchClass(c, ms.pat[p + 1])
    case '[': return matchBracketClass(ms, c, p, ep - 1)
    default: return ms.pat.charCodeAt(p) === c
  }
}

function matchBalance(ms, s, p) {
  if (p + 1 >= ms.pat.length) throw rtError("malformed pattern (missing arguments to '%b')")
  if (s >= ms.src.length || ms.src[s] !== ms.pat[p]) return -1
  const b = ms.pat[p], e = ms.pat[p + 1]
  let cont = 1
  while (++s < ms.src.length) {
    const ch = ms.src[s]
    if (ch === e) { if (--cont === 0) return s + 1 }
    else if (ch === b) cont++
  }
  return -1
}

function maxExpand(ms, s, p, ep) {
  let i = 0
  while (singleMatch(ms, s + i, p, ep)) i++
  while (i >= 0) {
    const res = doMatch(ms, s + i, ep + 1)
    if (res !== -1) return res
    i--
  }
  return -1
}

function minExpand(ms, s, p, ep) {
  for (;;) {
    const res = doMatch(ms, s, ep + 1)
    if (res !== -1) return res
    if (singleMatch(ms, s, p, ep)) s++
    else return -1
  }
}

function startCapture(ms, s, p, what) {
  ms.capture[ms.level] = { init: s, len: what }
  ms.level++
  const res = doMatch(ms, s, p)
  if (res === -1) ms.level--
  return res
}

function endCapture(ms, s, p) {
  let l = -1
  for (let i = ms.level - 1; i >= 0; i--) if (ms.capture[i].len === CAP_UNFINISHED) { l = i; break }
  if (l < 0) throw rtError('invalid pattern capture')
  ms.capture[l].len = s - ms.capture[l].init
  const res = doMatch(ms, s, p)
  if (res === -1) ms.capture[l].len = CAP_UNFINISHED
  return res
}

function matchCapture(ms, s, l) {
  l = l - 49 // '1'
  if (l < 0 || l >= ms.level || ms.capture[l].len === CAP_UNFINISHED) throw rtError(`invalid capture index %${l + 1}`)
  const { init, len } = ms.capture[l]
  if (ms.src.length - s >= len && ms.src.substr(init, len) === ms.src.substr(s, len)) return s + len
  return -1
}

function doMatch(ms, s, p) {
  if (ms.matchdepth-- === 0) throw rtError('pattern too complex')
  const pat = ms.pat
  try {
    for (;;) {
      if (p >= pat.length) return s
      const pc = pat[p]
      if (pc === '(') {
        if (pat[p + 1] === ')') return startCapture(ms, s, p + 2, CAP_POSITION)
        return startCapture(ms, s, p + 1, CAP_UNFINISHED)
      }
      if (pc === ')') return endCapture(ms, s, p + 1)
      if (pc === '$' && p + 1 === pat.length) return s === ms.src.length ? s : -1
      if (pc === '%') {
        const nc = pat[p + 1]
        if (nc === 'b') {
          s = matchBalance(ms, s, p + 2)
          if (s !== -1) { p += 4; continue }
          return -1
        }
        if (nc === 'f') {
          p += 2
          if (pat[p] !== '[') throw rtError("missing '[' after '%f' in pattern")
          const ep = classEnd(ms, p)
          const prev = s === 0 ? 0 : ms.src.charCodeAt(s - 1)
          const cur = s < ms.src.length ? ms.src.charCodeAt(s) : 0
          if (!matchBracketClass(ms, prev, p, ep - 1) && matchBracketClass(ms, cur, p, ep - 1)) { p = ep; continue }
          return -1
        }
        if (nc >= '0' && nc <= '9') {
          s = matchCapture(ms, s, pat.charCodeAt(p + 1))
          if (s !== -1) { p += 2; continue }
          return -1
        }
      }
      // 既定: クラス + 任意の量指定子
      const ep = classEnd(ms, p)
      const epc = pat[ep]
      if (!singleMatch(ms, s, p, ep)) {
        if (epc === '*' || epc === '?' || epc === '-') { p = ep + 1; continue }
        return -1
      }
      switch (epc) {
        case '?': {
          const res = doMatch(ms, s + 1, ep + 1)
          if (res !== -1) return res
          p = ep + 1
          continue
        }
        case '+': return maxExpand(ms, s + 1, p, ep)
        case '*': return maxExpand(ms, s, p, ep)
        case '-': return minExpand(ms, s, p, ep)
        default: s++; p = ep; continue
      }
    }
  } finally {
    ms.matchdepth++
  }
}

function getCapture(ms, i, s, e) {
  if (i >= ms.level) {
    if (i === 0) return ms.src.slice(s, e)
    throw rtError(`invalid capture index %${i + 1}`)
  }
  const { init, len } = ms.capture[i]
  if (len === CAP_UNFINISHED) throw rtError('unfinished capture')
  if (len === CAP_POSITION) return init + 1
  return ms.src.substr(init, len)
}

function captures(ms, s, e, wholeIfNone) {
  const n = ms.level === 0 && wholeIfNone ? 1 : ms.level
  const out = []
  for (let i = 0; i < n; i++) out.push(getCapture(ms, i, s, e))
  return out
}

function strFind(A, find) {
  const fname = find ? 'find' : 'match'
  const s = checkStr(A, 0, fname), p = checkStr(A, 1, fname)
  let init = posrelat(optInt(A, 2, fname, 1), s.length)
  if (init < 1) init = 1
  if (init > s.length + 1) return [undefined]
  if (find && (A[3] !== undefined && A[3] !== false || !SPECIALS.test(p))) {
    const idx = s.indexOf(p, init - 1)
    if (idx < 0) return [undefined]
    return [idx + 1, idx + p.length]
  }
  const anchor = p[0] === '^'
  const pp = anchor ? p.slice(1) : p
  let s1 = init - 1
  do {
    const ms = new MatchState(s, pp)
    const e = doMatch(ms, s1, 0)
    if (e !== -1) {
      if (find) return [s1 + 1, e, ...captures(ms, s1, e, false)]
      return captures(ms, s1, e, true)
    }
    s1++
  } while (s1 <= s.length && !anchor)
  return [undefined]
}

function gmatch(A) {
  const s = checkStr(A, 0, 'gmatch'), p = checkStr(A, 1, 'gmatch')
  let pos = 0
  const anchor = p[0] === '^'
  const pp = anchor ? p.slice(1) : p
  let done = false
  return native('gmatch_iter', () => {
    if (done) return undefined
    for (let src = pos; src <= s.length; src++) {
      const ms = new MatchState(s, pp)
      const e = doMatch(ms, src, 0)
      if (e !== -1) {
        pos = e === src ? e + 1 : e
        if (anchor) done = true
        return captures(ms, src, e, true)
      }
      if (anchor) break
    }
    done = true
    return undefined
  })
}

function* gsub(A) {
  const src = checkStr(A, 0, 'gsub'), p = checkStr(A, 1, 'gsub')
  const repl = A[2]
  const tr = type(repl)
  const maxN = A[3] === undefined ? Infinity : checkInt(A, 3, 'gsub')
  if (!(tr === 'number' || tr === 'string' || tr === 'table' || tr === 'function')) {
    throw argError(3, 'gsub', `string/function/table expected, got ${repl === undefined ? 'nil' : tr}`)
  }
  const anchor = p[0] === '^'
  const pp = anchor ? p.slice(1) : p
  let s = 0, n = 0
  let out = ''
  while (n < maxN) {
    const ms = new MatchState(src, pp)
    const e = doMatch(ms, s, 0)
    if (e !== -1) {
      n++
      // 置換値
      const whole = src.slice(s, e)
      let val
      if (tr === 'string' || tr === 'number') {
        const r = tr === 'number' ? fmtNum(repl) : repl
        let res = ''
        for (let i = 0; i < r.length; i++) {
          const ch = r[i]
          if (ch !== '%') { res += ch; continue }
          i++
          const d = r[i]
          if (d === '%') res += '%'
          else if (d >= '0' && d <= '9') {
            const v = d === '0' ? whole : getCapture(ms, d.charCodeAt(0) - 49, s, e)
            res += typeof v === 'number' ? fmtNum(v) : v
          } else throw rtError("invalid use of '%' in replacement string")
        }
        val = res
      } else {
        const cap = getCapture(ms, 0, s, e)
        if (tr === 'table') val = index(repl, cap)
        else val = (yield* call(repl, captures(ms, s, e, true)))[0]
        if (val === undefined || val === false) val = whole
        else if (typeof val === 'number') val = fmtNum(val)
        else if (typeof val !== 'string') throw rtError(`invalid replacement value (a ${type(val)})`)
      }
      out += val
    }
    if (e !== -1 && e > s) s = e
    else if (s < src.length) out += src[s++]
    else break
    if (anchor) break
  }
  out += src.slice(s)
  return [out, n]
}

// ---- string.format ----
function padStr(s, width, left, zero) {
  if (s.length >= width) return s
  if (left) return s + ' '.repeat(width - s.length)
  if (zero) {
    const sign = /^[-+ ]/.test(s) ? s[0] : ''
    const body = sign ? s.slice(1) : s
    return sign + '0'.repeat(width - s.length) + body
  }
  return ' '.repeat(width - s.length) + s
}

function expFix(s) {
  // JS の 1.5e+7 → C の 1.5e+07
  return s.replace(/e([+-])(\d)$/, 'e$10$2')
}

function fmtG(x, prec, alt, upper) {
  if (!isFinite(x)) return x !== x ? 'nan' : (x > 0 ? 'inf' : '-inf')
  if (prec === 0) prec = 1
  if (x === 0) {
    let r = alt ? (0).toFixed(prec - 1) : '0'
    if (Object.is(x, -0)) r = '-' + r
    return r
  }
  const exp = Math.floor(Math.log10(Math.abs(x)))
  let r
  // 丸めで桁が変わる場合を考慮
  const e2 = Number(x.toExponential(prec - 1).split('e')[1])
  if (e2 < -4 || e2 >= prec) {
    r = x.toExponential(prec - 1)
    if (!alt) r = r.replace(/\.?0+e/, 'e')
    r = expFix(r)
  } else {
    r = x.toFixed(Math.max(0, prec - 1 - e2))
    if (!alt && r.includes('.')) r = r.replace(/\.?0+$/, '')
  }
  void exp
  return upper ? r.toUpperCase() : r
}

function toUInt64Str(n, radix) {
  let v = BigInt(Math.trunc(n))
  if (v < 0n) v += 1n << 64n
  return v.toString(radix)
}

export function format(A) {
  const fmt = checkStr(A, 0, 'format')
  let out = ''
  let arg = 1
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i]
    if (c !== '%') { out += c; continue }
    i++
    if (fmt[i] === '%') { out += '%'; continue }
    const m = /^([-+ #0]*)(\d*)(?:\.(\d*))?([a-zA-Z*])/.exec(fmt.slice(i))
    if (!m) throw rtError(`invalid option '%${fmt[i] || ''}' to 'format'`)
    i += m[0].length - 1
    const flags = m[1], width = m[2] ? parseInt(m[2], 10) : 0
    const prec = m[3] !== undefined ? (m[3] === '' ? 0 : parseInt(m[3], 10)) : undefined
    const conv = m[4]
    const left = flags.includes('-'), zero = flags.includes('0') && !left
    const plus = flags.includes('+'), space = flags.includes(' '), alt = flags.includes('#')
    const signed = (s, neg) => (neg ? '-' : plus ? '+' : space ? ' ' : '') + s
    const argIdx = arg++
    if (argIdx >= A.length && conv !== '%') throw argError(argIdx + 1, 'format', 'no value')
    let s
    switch (conv) {
      case 'd': case 'i': {
        const n = Math.trunc(checkNum(A, argIdx, 'format'))
        s = String(Math.abs(n))
        if (prec !== undefined) s = s.padStart(prec, '0')
        s = signed(s, n < 0)
        out += padStr(s, width, left, zero && prec === undefined)
        break
      }
      case 'u': out += padStr(toUInt64Str(checkNum(A, argIdx, 'format'), 10), width, left, zero); break
      case 'c': out += padStr(String.fromCharCode(checkInt(A, argIdx, 'format') & 255), width, left, false); break
      case 'x': case 'X': case 'o': {
        let r = toUInt64Str(checkNum(A, argIdx, 'format'), conv === 'o' ? 8 : 16)
        if (prec !== undefined) r = r.padStart(prec, '0')
        if (alt && r !== '0') r = (conv === 'o' ? '0' : conv === 'x' ? '0x' : '0X') + r
        if (conv === 'X') r = r.toUpperCase()
        out += padStr(r, width, left, zero)
        break
      }
      case 'e': case 'E': {
        const x = checkNum(A, argIdx, 'format')
        let r = isFinite(x) ? expFix(Math.abs(x).toExponential(prec === undefined ? 6 : prec)) : (x !== x ? 'nan' : 'inf')
        if (alt && prec === 0) r = r.replace('e', '.e')
        r = signed(r, x < 0 || Object.is(x, -0))
        out += padStr(conv === 'E' ? r.toUpperCase() : r, width, left, zero && isFinite(x))
        break
      }
      case 'f': case 'F': {
        const x = checkNum(A, argIdx, 'format')
        let r = isFinite(x) ? Math.abs(x).toFixed(Math.min(prec === undefined ? 6 : prec, 100)) : (x !== x ? 'nan' : 'inf')
        if (alt && prec === 0) r += '.'
        r = signed(r, x < 0 || Object.is(x, -0))
        out += padStr(r, width, left, zero && isFinite(x))
        break
      }
      case 'g': case 'G': {
        const x = checkNum(A, argIdx, 'format')
        let r = fmtG(Math.abs(x), prec === undefined ? 6 : prec, alt, conv === 'G')
        r = signed(r, x < 0 || Object.is(x, -0))
        out += padStr(r, width, left, zero && isFinite(x))
        break
      }
      case 'a': case 'A': {
        const x = checkNum(A, argIdx, 'format')
        out += padStr(fmtNum(x), width, left, false)
        break
      }
      case 'q': {
        const v = A[argIdx]
        if (typeof v === 'number') { out += Number.isInteger(v) ? String(v) : (isFinite(v) ? v.toString() : (v !== v ? '(0/0)' : v > 0 ? 'math.huge' : '-math.huge')); break }
        const str = checkStr(A, argIdx, 'format')
        let r = '"'
        for (let k = 0; k < str.length; k++) {
          const ch = str[k], code = str.charCodeAt(k)
          if (ch === '"' || ch === '\\') r += '\\' + ch
          else if (ch === '\n') r += '\\n'
          else if (ch === '\r') r += '\\r'
          else if (ch === '\0') r += '\\0'
          else if (code < 32 || code === 127) r += '\\' + code
          else r += ch
        }
        out += r + '"'
        break
      }
      case 's': {
        let r = tostring(A[argIdx])
        if (prec !== undefined) r = r.slice(0, prec)
        out += padStr(r, width, left, false)
        break
      }
      case '*': out += tostring(A[argIdx]); break
      default:
        throw rtError(`invalid option '%${conv}' to 'format'`)
    }
  }
  return out
}

// ---- ライブラリ本体 ----
export function makeStringLib() {
  const S = new LTable()
  const def = (name, fn) => S.set(name, native(name, fn))
  def('len', A => checkStr(A, 0, 'len').length)
  def('sub', A => {
    const s = checkStr(A, 0, 'sub')
    const l = s.length
    let i = posrelat(optInt(A, 1, 'sub', 1), l)
    let j = posrelat(optInt(A, 2, 'sub', -1), l)
    if (i < 1) i = 1
    if (j > l) j = l
    return i > j ? '' : s.slice(i - 1, j)
  })
  def('upper', A => checkStr(A, 0, 'upper').replace(/[a-z]/g, c => c.toUpperCase()))
  def('lower', A => checkStr(A, 0, 'lower').replace(/[A-Z]/g, c => c.toLowerCase()))
  def('rep', A => {
    const s = checkStr(A, 0, 'rep')
    const n = checkInt(A, 1, 'rep')
    const sep = A[2] === undefined ? '' : checkStr(A, 2, 'rep')
    if (n <= 0) return ''
    if ((s.length + sep.length) * n > 64 * 1024 * 1024) throw rtError('resulting string too large')
    if (!sep) return s.repeat(n)
    return Array(n).fill(s).join(sep)
  })
  def('reverse', A => checkStr(A, 0, 'reverse').split('').reverse().join(''))
  def('byte', A => {
    const s = checkStr(A, 0, 'byte')
    const l = s.length
    let i = posrelat(optInt(A, 1, 'byte', 1), l)
    let j = posrelat(A[2] === undefined ? i : checkInt(A, 2, 'byte'), l)
    if (i < 1) i = 1
    if (j > l) j = l
    const out = []
    for (let k = i; k <= j; k++) out.push(s.charCodeAt(k - 1))
    return out
  })
  def('char', A => {
    let s = ''
    for (let i = 0; i < A.length; i++) {
      const c = checkInt(A, i, 'char')
      if (c < 0 || c > 255) throw argError(i + 1, 'char', 'value out of range')
      s += String.fromCharCode(c)
    }
    return s
  })
  def('format', format)
  def('find', A => strFind(A, true))
  def('match', A => strFind(A, false))
  def('gmatch', gmatch)
  S.set('gsub', nativeGen('gsub', gsub))
  def('split', A => {
    const s = checkStr(A, 0, 'split')
    const sep = A[1] === undefined ? ',' : checkStr(A, 1, 'split')
    const parts = sep === '' ? s.split('') : s.split(sep)
    return LTable.fromArray(parts)
  })
  def('pack', () => { throw rtError('string.pack はこのサンドボックスでは未対応です') })
  def('unpack', () => { throw rtError('string.unpack はこのサンドボックスでは未対応です') })
  def('packsize', () => { throw rtError('string.packsize はこのサンドボックスでは未対応です') })
  return S
}

export { posrelat, LuaError, EMPTY }
