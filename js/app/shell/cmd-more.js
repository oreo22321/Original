// ターミナルのコマンド (v15 で追加): awk・jq・sqlite3・bc・xxd / hexdump / od・tar / gzip / gunzip / zcat・
// md5sum / sha1sum / sha512sum・column・paste・comm・fold・tac・shuf・split・cmp・mktemp・ln・chmod・truncate・id・
// timeout・eval・command・jobs / fg / bg / wait
// (this はシェル。ctx は print / err / stdin / cols など)
import { isBin, bytesToContent } from '../bin.js'
import { C, getopts, inputs, lines, sleep, baseName, dirName } from './util.js'
import { runAwk } from './awk.js'

const enc = new TextEncoder(), dec = new TextDecoder()
const bytesOf = c => (c instanceof Uint8Array ? c : enc.encode(String(c ?? '')))
async function readAny(sh, f, ctx, name) {
  if (f === '-' || f === undefined) { const t = ctx.stdin; return t === null || t === undefined ? '' : t }
  const p = sh.resolve(f)
  if (!sh.isFile(p)) { ctx.err(`${name}: ${f}: ファイルがありません\n`); return null }
  return sh.host.read(p)
}
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('')

// ---- MD5 (crypto.subtle にないので、ここで計算) ----
function md5(bytes) {
  const K = new Uint32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0
  const len = bytes.length, total = (((len + 8) >> 6) + 1) << 6
  const buf = new Uint8Array(total)
  buf.set(bytes)
  buf[len] = 0x80
  const dv = new DataView(buf.buffer)
  dv.setUint32(total - 8, (len * 8) >>> 0, true)
  dv.setUint32(total - 4, Math.floor(len / 0x20000000), true)
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  const M = new Uint32Array(16)
  for (let off = 0; off < total; off += 64) {
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true)
    let A = a0, B = b0, Cc = c0, D = d0
    for (let i = 0; i < 64; i++) {
      let F, g
      if (i < 16) { F = (B & Cc) | (~B & D); g = i } else if (i < 32) { F = (D & B) | (~D & Cc); g = (5 * i + 1) % 16 } else if (i < 48) { F = B ^ Cc ^ D; g = (3 * i + 5) % 16 } else { F = Cc ^ (B | ~D); g = (7 * i) % 16 }
      F = (F + A + K[i] + M[g]) >>> 0
      A = D; D = Cc; Cc = B
      const sft = S[(i >> 4) * 4 + (i % 4)]
      B = (B + ((F << sft) | (F >>> (32 - sft)))) >>> 0
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + Cc) >>> 0; d0 = (d0 + D) >>> 0
  }
  const out = new Uint8Array(16), ov = new DataView(out.buffer)
  ;[a0, b0, c0, d0].forEach((v, i) => ov.setUint32(i * 4, v, true))
  return out
}
async function digest(algo, data) {
  if (algo === 'MD5') return hex(md5(bytesOf(data)))
  return hex(new Uint8Array(await crypto.subtle.digest(algo, bytesOf(data))))
}
async function sumCmd(sh, algo, name, args, ctx) {
  const { o, rest } = getopts(args, 'cbt')
  if (o.c) {
    let bad = 0
    for (const it of await inputs(sh, rest, ctx, name)) {
      if (!it) continue
      for (const l of lines(it.text)) {
        const m = /^([0-9a-f]+)\s+\*?(.+)$/.exec(l.trim())
        if (!m) continue
        const data = await readAny(sh, m[2], ctx, name)
        const ok = data !== null && (await digest(algo, data)) === m[1]
        if (!ok) bad++
        ctx.print(`${m[2]}: ${ok ? 'OK' : '失敗'}`)
      }
    }
    return bad ? 1 : 0
  }
  let status = 0
  for (const f of rest.length ? rest : ['-']) {
    const data = await readAny(sh, f, ctx, name)
    if (data === null) { status = 1; continue }
    ctx.print(`${await digest(algo, data)}  ${f}`)
  }
  return status
}

// ---- tar (ustar) ----
function tarPack(entries) {
  const blocks = []
  const field = (h, off, len, s) => { const b = enc.encode(s); h.set(b.subarray(0, len), off) }
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0'
  for (const e of entries) {
    const h = new Uint8Array(512)
    let name = e.path + (e.dir ? '/' : ''), prefix = ''
    if (enc.encode(name).length > 100) { const k = name.lastIndexOf('/', name.length - 2); prefix = name.slice(0, k); name = name.slice(k + 1) }
    field(h, 0, 100, name)
    field(h, 100, 8, oct(e.dir ? 0o755 : 0o644, 8))
    field(h, 108, 8, oct(0, 8)); field(h, 116, 8, oct(0, 8))
    field(h, 124, 12, oct(e.dir ? 0 : e.data.length, 12))
    field(h, 136, 12, oct(Math.floor((e.mtime || Date.now()) / 1000), 12))
    field(h, 148, 8, '        ')
    h[156] = e.dir ? 53 : 48
    field(h, 257, 6, 'ustar\0'); field(h, 263, 2, '00')
    field(h, 265, 32, 'forge'); field(h, 297, 32, 'forge')
    field(h, 345, 155, prefix)
    let sum = 0
    for (const x of h) sum += x
    field(h, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ')
    blocks.push(h)
    if (!e.dir) { blocks.push(e.data); const pad = (512 - (e.data.length % 512)) % 512; if (pad) blocks.push(new Uint8Array(pad)) }
  }
  blocks.push(new Uint8Array(1024))
  const total = blocks.reduce((n, b) => n + b.length, 0)
  const out = new Uint8Array(total)
  let k = 0
  for (const b of blocks) { out.set(b, k); k += b.length }
  return out
}
function tarUnpack(buf) {
  const out = []
  let off = 0
  const str = (o, l) => dec.decode(buf.subarray(o, o + l)).replace(/\0[\s\S]*$/, '')
  while (off + 512 <= buf.length) {
    if (buf.subarray(off, off + 512).every(b => b === 0)) break
    const name = str(off, 100), prefix = str(off + 345, 155)
    const size = parseInt(str(off + 124, 12).trim() || '0', 8) || 0
    const type = String.fromCharCode(buf[off + 156] || 48)
    const path = (prefix ? prefix + '/' : '') + name
    off += 512
    if (type === '5') out.push({ path: path.replace(/\/$/, ''), dir: true })
    else if (type === '0' || type === '\0' || type === '7') out.push({ path, data: buf.slice(off, off + size) })
    off += Math.ceil(size / 512) * 512
  }
  return out
}

// ---- bc (計算機) ----
function bcEval(src, state) {
  const out = []
  for (let stmt of String(src).split(/[;\n]/)) {
    stmt = stmt.replace(/\/\*.*?\*\/|#.*$/g, '').trim()
    if (!stmt) continue
    if (stmt === 'quit') break
    const m = /^([a-z_]\w*)\s*(=|\+=|-=|\*=|\/=|%=|\^=)\s*(.+)$/.exec(stmt)
    if (m) {
      const v = bcExpr(m[3], state)
      const cur = state.vars[m[1]] ?? (m[1] === 'scale' ? state.scale : 0)
      const nv = m[2] === '=' ? v : m[2] === '+=' ? cur + v : m[2] === '-=' ? cur - v : m[2] === '*=' ? cur * v : m[2] === '/=' ? cur / v : m[2] === '%=' ? cur % v : Math.pow(cur, v)
      if (m[1] === 'scale') state.scale = Math.max(0, Math.trunc(nv)); else state.vars[m[1]] = nv
      continue
    }
    out.push(bcFormat(bcExpr(stmt, state), state.scale))
  }
  return out
}
function bcFormat(v, scale) {
  if (!isFinite(v)) return String(v)
  const t = scale && !Number.isInteger(v) ? v.toFixed(scale) : String(Math.trunc(v))
  return t.replace(/^(-?)0\./, '$1.')
}
function bcExpr(src, state) {
  const toks = String(src).match(/\d+\.?\d*|\.\d+|[a-z_]\w*|\*\*|[-+*/%^()<>=!]=?|&&|\|\||,/g) || []
  let i = 0
  const peek = () => toks[i]
  const trunc = v => (state.scale ? Math.trunc(v * 10 ** state.scale) / 10 ** state.scale : Math.trunc(v))
  const prim = () => {
    const t = toks[i++]
    if (t === undefined) throw new Error('式が途中で終わっています')
    if (t === '(') { const v = or(); if (toks[i++] !== ')') throw new Error(') がありません'); return v }
    if (t === '-') return -unaryPow()
    if (t === '+') return unaryPow()
    if (t === '!') return unaryPow() ? 0 : 1
    if (/^[\d.]/.test(t)) return Number(t)
    if (toks[i] === '(') {
      i++
      const args = []
      if (toks[i] !== ')') { args.push(or()); while (toks[i] === ',') { i++; args.push(or()) } }
      if (toks[i++] !== ')') throw new Error(') がありません')
      const f = { sqrt: Math.sqrt, s: Math.sin, c: Math.cos, a: Math.atan, l: Math.log, e: Math.exp, length: x => String(Math.trunc(Math.abs(x))).length, abs: Math.abs }[t]
      if (!f) throw new Error(`${t}() は使えません (-l で s c a l e sqrt)`)
      return f(...args)
    }
    if (t === 'scale') return state.scale
    if (t === 'pi') return Math.PI
    return state.vars[t] ?? 0
  }
  const unaryPow = () => { const b = prim(); if (peek() === '^' || peek() === '**') { i++; return Math.pow(b, unaryPow()) } return b }
  const mul = () => { let v = unaryPow(); while (['*', '/', '%'].includes(peek())) { const o = toks[i++]; const r = unaryPow(); if ((o === '/' || o === '%') && r === 0) throw new Error('0 で割りました'); v = o === '*' ? v * r : o === '/' ? trunc(v / r) : v % r } return v }
  const add = () => { let v = mul(); while (peek() === '+' || peek() === '-') { const o = toks[i++]; v = o === '+' ? v + mul() : v - mul() } return v }
  const cmp = () => { let v = add(); while (['<', '<=', '>', '>=', '==', '!='].includes(peek())) { const o = toks[i++]; const r = add(); v = { '<': v < r, '<=': v <= r, '>': v > r, '>=': v >= r, '==': v === r, '!=': v !== r }[o] ? 1 : 0 } return v }
  const and = () => { let v = cmp(); while (peek() === '&&') { i++; const r = cmp(); v = v && r ? 1 : 0 } return v }
  const or = () => { let v = and(); while (peek() === '||') { i++; const r = and(); v = v || r ? 1 : 0 } return v }
  const v = or()
  if (i < toks.length) throw new Error(`「${toks[i]}」の使い方が正しくありません`)
  return v
}

// ---- jq (よく使う書き方だけ) ----
function jqRun(filter, input) {
  const toks = filter.match(/\.\.|\.[A-Za-z_]\w*\??|\.\[|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?|[A-Za-z_]\w*|==|!=|<=|>=|\/\/|\?\/\/|[|,.\[\]{}():<>+\-*/%?]|\$[A-Za-z_]\w*/g) || []
  let i = 0
  const peek = () => toks[i]
  const want = t => { if (toks[i] !== t) throw new Error(`${t} が必要です (${toks[i] ?? '終わり'} の前)`); i++ }
  // 解析して「入力 → 出力の配列」の関数を作る
  const pipe = () => { let f = comma(); while (peek() === '|') { i++; const g = comma(), a = f; f = x => a(x).flatMap(g) } return f }
  const comma = () => { let f = alt(); while (peek() === ',') { i++; const g = alt(), a = f; f = x => [...a(x), ...g(x)] } return f }
  const alt = () => { let f = or(); while (peek() === '//') { i++; const g = or(), a = f; f = x => { const r = a(x).filter(v => v !== null && v !== false); return r.length ? r : g(x) } } return f }
  const or = () => { let f = and(); while (peek() === 'or') { i++; const g = and(), a = f; f = x => a(x).flatMap(l => g(x).map(r => truthy(l) || truthy(r))) } return f }
  const and = () => { let f = cmp(); while (peek() === 'and') { i++; const g = cmp(), a = f; f = x => a(x).flatMap(l => g(x).map(r => truthy(l) && truthy(r))) } return f }
  const truthy = v => v !== null && v !== false
  const cmpv = (a, b) => JSON.stringify(a) === JSON.stringify(b) ? 0 : (typeof a === typeof b ? (a < b ? -1 : 1) : (order(a) - order(b)))
  const order = v => (v === null ? 0 : v === false ? 1 : v === true ? 2 : typeof v === 'number' ? 3 : typeof v === 'string' ? 4 : Array.isArray(v) ? 5 : 6)
  const cmp = () => {
    let f = sum()
    while (['==', '!=', '<', '<=', '>', '>='].includes(peek())) {
      const o = toks[i++], g = sum(), a = f
      f = x => a(x).flatMap(l => g(x).map(r => { const c = cmpv(l, r); return { '==': c === 0, '!=': c !== 0, '<': c < 0, '<=': c <= 0, '>': c > 0, '>=': c >= 0 }[o] }))
    }
    return f
  }
  const sum = () => { let f = prod(); while (peek() === '+' || peek() === '-') { const o = toks[i++], g = prod(), a = f; f = x => a(x).flatMap(l => g(x).map(r => (o === '+' ? (l === null ? r : r === null ? l : Array.isArray(l) ? [...l, ...r] : typeof l === 'object' ? { ...l, ...r } : l + r) : Array.isArray(l) ? l.filter(v => !r.some(w => JSON.stringify(w) === JSON.stringify(v))) : l - r))) } return f }
  const prod = () => { let f = post(); while (['*', '/', '%'].includes(peek())) { const o = toks[i++], g = post(), a = f; f = x => a(x).flatMap(l => g(x).map(r => (o === '*' ? l * r : o === '/' ? (typeof l === 'string' ? l.split(r) : l / r) : l % r))) } return f }
  const post = () => {
    let f = term()
    for (;;) {
      const t = peek()
      if (t && t.startsWith('.') && t.length > 1 && t !== '..' && t !== '.[') { i++; const key = t.slice(1).replace(/\?$/, ''); const a = f; f = x => a(x).map(v => (v === null ? null : v[key] ?? null)); continue }
      if (t === '[' || t === '.[') {
        i++
        if (peek() === ']') { i++; const a = f; f = x => a(x).flatMap(v => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : [])); continue }
        const idx = pipe()
        let end = null
        if (peek() === ':') { i++; end = peek() === ']' ? null : pipe() }
        want(']')
        const a = f
        f = x => a(x).flatMap(v => idx(x).map(k => {
          if (end !== null || toks[i - 2] === ':') { const e = end ? end(x)[0] : undefined; return Array.isArray(v) || typeof v === 'string' ? v.slice(k ?? 0, e) : null }
          if (v === null) return null
          if (typeof k === 'number') return Array.isArray(v) ? (v[k < 0 ? v.length + k : k] ?? null) : null
          return v[k] ?? null
        }))
        continue
      }
      if (t === '?') { i++; const a = f; f = x => { try { return a(x) } catch { return [] } }; continue }
      return f
    }
  }
  const BUILTIN = {
    length: v => (v === null ? 0 : typeof v === 'string' || Array.isArray(v) ? v.length : typeof v === 'object' ? Object.keys(v).length : Math.abs(v)),
    keys: v => (Array.isArray(v) ? v.map((_, k) => k) : Object.keys(v).sort()), keys_unsorted: v => Object.keys(v), values: v => v,
    type: v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v), not: v => !truthy(v), add: v => (v.length ? v.reduce((a, b) => (Array.isArray(a) ? [...a, ...b] : typeof a === 'object' && a ? { ...a, ...b } : a + b)) : null),
    sort: v => [...v].sort(cmpv), reverse: v => [...v].reverse(), unique: v => [...new Map(v.map(x => [JSON.stringify(x), x])).values()].sort(cmpv), first: v => v[0] ?? null, last: v => v[v.length - 1] ?? null,
    min: v => (v.length ? [...v].sort(cmpv)[0] : null), max: v => (v.length ? [...v].sort(cmpv)[v.length - 1] : null), flatten: v => v.flat(Infinity), tostring: v => (typeof v === 'string' ? v : JSON.stringify(v)), tonumber: v => Number(v),
    to_entries: v => Object.entries(v).map(([key, value]) => ({ key, value })), from_entries: v => Object.fromEntries(v.map(e => [e.key ?? e.name ?? e.k, e.value ?? e.v])), ascii_downcase: v => v.toLowerCase(), ascii_upcase: v => v.toUpperCase(),
    floor: Math.floor, ceil: Math.ceil, round: Math.round, sqrt: Math.sqrt, empty: () => undefined, tojson: v => JSON.stringify(v), fromjson: v => JSON.parse(v), env: () => ({}), now: () => Date.now() / 1000, any: v => v.some(truthy), all: v => v.every(truthy),
  }
  const term = () => {
    const t = toks[i++]
    if (t === undefined) throw new Error('式が途中で終わっています')
    if (t === '.') { if (peek() === '[' ) return x => [x]; return x => [x] }
    if (t === '..') return x => { const out = []; const walk = v => { out.push(v); if (v && typeof v === 'object') for (const c of Object.values(v)) walk(c) }; walk(x); return out }
    if (t === '.[') { i--; toks[i] = '['; return x => [x] }
    if (t.startsWith('.') && t.length > 1) { const key = t.slice(1).replace(/\?$/, ''); return x => [x === null ? null : x[key] ?? null] }
    if (t.startsWith('"')) { const s = JSON.parse(t); return () => [s] }
    if (/^-?\d/.test(t)) { const n = Number(t); return () => [n] }
    if (t === 'null' || t === 'true' || t === 'false') { const v = JSON.parse(t); return () => [v] }
    if (t === '(') { const f = pipe(); want(')'); return f }
    if (t === '[') { if (peek() === ']') { i++; return () => [[]] } const f = pipe(); want(']'); return x => [f(x)] }
    if (t === '{') {
      const parts = []
      while (peek() !== '}') {
        let k = toks[i++]
        let kf
        if (k === '(') { kf = pipe(); want(')') } else { const key = k.startsWith('"') ? JSON.parse(k) : k.replace(/^\$/, ''); kf = () => [key] }
        let vf
        if (peek() === ':') { i++; vf = alt() } else { const key = k.startsWith('"') ? JSON.parse(k) : k; vf = x => [x === null ? null : x[key] ?? null] }
        parts.push([kf, vf])
        if (peek() === ',') i++
      }
      i++
      return x => {
        let outs = [{}]
        for (const [kf, vf] of parts) { const next = []; for (const o of outs) for (const k of kf(x)) for (const v of vf(x)) next.push({ ...o, [k]: v }); outs = next }
        return outs
      }
    }
    if (t === 'if') {
      const c = pipe(); want('then'); const a = pipe()
      const elifs = []
      while (peek() === 'elif') { i++; const c2 = pipe(); want('then'); elifs.push([c2, pipe()]) }
      let b = x => [x]
      if (peek() === 'else') { i++; b = pipe() }
      want('end')
      return x => c(x).flatMap(v => { if (truthy(v)) return a(x); for (const [c2, f2] of elifs) if (c2(x).some(truthy)) return f2(x); return b(x) })
    }
    if (t === 'select') { want('('); const f = pipe(); want(')'); return x => (f(x).some(truthy) ? [x] : []) }
    if (t === 'map') { want('('); const f = pipe(); want(')'); return x => [(Array.isArray(x) ? x : Object.values(x)).flatMap(f)] }
    if (t === 'map_values') { want('('); const f = pipe(); want(')'); return x => [Array.isArray(x) ? x.map(v => f(v)[0]) : Object.fromEntries(Object.entries(x).map(([k, v]) => [k, f(v)[0]]))] }
    if (t === 'sort_by' || t === 'group_by' || t === 'unique_by' || t === 'min_by' || t === 'max_by') {
      want('('); const f = pipe(); want(')')
      return x => {
        const arr = [...x].map(v => [f(v), v]).sort((a, b) => cmpv(a[0], b[0]))
        if (t === 'sort_by') return [arr.map(p => p[1])]
        if (t === 'min_by') return [arr.length ? arr[0][1] : null]
        if (t === 'max_by') return [arr.length ? arr[arr.length - 1][1] : null]
        const groups = []
        for (const [k, v] of arr) { const last = groups[groups.length - 1]; if (last && JSON.stringify(last.k) === JSON.stringify(k)) last.v.push(v); else groups.push({ k, v: [v] }) }
        return [t === 'group_by' ? groups.map(g => g.v) : groups.map(g => g.v[0])]
      }
    }
    if (t === 'has') { want('('); const f = pipe(); want(')'); return x => f(x).map(k => (Array.isArray(x) ? k < x.length : Object.prototype.hasOwnProperty.call(x, k))) }
    if (t === 'contains' || t === 'startswith' || t === 'endswith' || t === 'split' || t === 'join' || t === 'test' || t === 'ltrimstr' || t === 'rtrimstr') {
      want('('); const f = pipe(); want(')')
      return x => f(x).map(a => ({
        contains: () => (typeof x === 'string' ? x.includes(a) : JSON.stringify(x).includes(JSON.stringify(a).replace(/^[[{]|[\]}]$/g, ''))), startswith: () => x.startsWith(a), endswith: () => x.endsWith(a),
        split: () => x.split(a), join: () => x.map(v => (v === null ? '' : String(v))).join(a), test: () => new RegExp(a).test(x), ltrimstr: () => (x.startsWith(a) ? x.slice(a.length) : x), rtrimstr: () => (x.endsWith(a) ? x.slice(0, -a.length) : x),
      })[t]())
    }
    if (t === 'range') { want('('); const a = pipe(); let b = null; if (peek() === ';') { i++; b = pipe() } want(')'); return x => { const from = b ? a(x)[0] : 0, to = b ? b(x)[0] : a(x)[0]; const out = []; for (let k = from; k < to; k++) out.push(k); return out } }
    if (BUILTIN[t]) return x => { const v = BUILTIN[t](x); return v === undefined ? [] : [v] }
    throw new Error(`「${t}」は使えません`)
  }
  const f = pipe()
  if (i < toks.length) throw new Error(`「${toks[i]}」の使い方が正しくありません`)
  return f(input)
}

export default {
  // ---- awk ----
  async awk(args, ctx) {
    const vars = {}
    let fs = null, prog = null
    const files = []
    for (let k = 0; k < args.length; k++) {
      const a = args[k]
      if (a === '-F') fs = args[++k]
      else if (a.startsWith('-F')) fs = a.slice(2)
      else if (a === '-v') { const m = /^([A-Za-z_]\w*)=([\s\S]*)$/.exec(args[++k] || ''); if (m) vars[m[1]] = m[2] }
      else if (a === '-f') { const t = await readAny(this, args[++k], ctx, 'awk'); if (t === null) return 2; prog = String(t) }
      else if (prog === null) prog = a
      else if (/^[A-Za-z_]\w*=/.test(a)) { const m = /^([A-Za-z_]\w*)=([\s\S]*)$/.exec(a); vars[m[1]] = m[2] }
      else files.push(a)
    }
    if (prog === null) { ctx.err('使い方: awk \'{ print $1 }\' [ファイル]   (-F 区切り, -v 名前=値)\n'); return 2 }
    if (fs === 't' || fs === '\\t') fs = '\t'
    const ins = await inputs(this, files, ctx, 'awk')
    if (ins.some(x => !x)) return 2
    const outFiles = {}
    let code
    try {
      code = await runAwk(prog, { vars, fs, inputs: ins, out: s => ctx.out(s), err: s => ctx.err(s), files: outFiles, signal: ctx.signal })
    } catch (e) { if (e.name === 'AbortError') throw e; ctx.err(`awk: ${e.message}\n`); return 2 }
    for (const [name, f] of Object.entries(outFiles)) {
      const p = this.resolve(name)
      const before = f.append ? (await this.readText(name)) || '' : ''
      await this.writeText(name, before + f.buf.join(''))
      void p
    }
    return code
  },
  gawk(args, ctx) { return this.callCmd('awk', args, ctx) },

  // ---- jq ----
  async jq(args, ctx) {
    const { o, rest } = getopts(args, 'rcnsSje', '', { num: null })
    const filter = rest[0] ?? '.'
    const texts = []
    for (const it of await inputs(this, rest.slice(1), ctx, 'jq')) if (it) texts.push(it.text)
    const values = []
    if (o.n) values.push(null)
    else {
      for (const t of texts) {
        const s = String(t).trim()
        if (!s) continue
        try { values.push(JSON.parse(s)) } catch {
          // 1 行に 1 つずつの JSON
          try { for (const l of s.split('\n').filter(x => x.trim())) values.push(JSON.parse(l)) } catch (e) { ctx.err(`jq: JSON を読めません: ${e.message}\n`); return 2 }
        }
      }
    }
    const all = o.s ? [values] : values
    let status = 0
    for (const v of all) {
      let res
      try { res = jqRun(filter, v) } catch (e) { ctx.err(`jq: ${e.message}\n`); return 3 }
      for (const r of res) {
        if (o.e && (r === null || r === false)) status = 1
        if (o.r && typeof r === 'string') ctx.out(r + (o.j ? '' : '\n'))
        else ctx.out(JSON.stringify(r, o.S ? Object.keys(r || {}).sort() : null, o.c ? 0 : 2).replace(/\n$/, '') + (o.j ? '' : '\n'))
      }
    }
    return status
  },

  // ---- sqlite3 (Python の sqlite3 で) ----
  async sqlite3(args, ctx) {
    let mode = 'list', header = false
    const plain = []
    for (const a of args) {
      if (a === '-header' || a === '--header') header = true
      else if (a === '-noheader') header = false
      else if (['-column', '-csv', '-json', '-box', '-table', '-line', '-list', '-markdown'].includes(a)) { mode = a.slice(1); if (mode !== 'list' && mode !== 'csv') header = true }
      else if (a.startsWith('-')) {}
      else plain.push(a)
    }
    const db = plain[0] ? this.resolve(plain[0]) : ':memory:'
    const runSql = async sql => {
      const src = `import sqlite3, json, sys, csv, io
_db = ${JSON.stringify(db)}
_con = sqlite3.connect(_db if _db == ":memory:" else "/home/pyodide/project/" + _db)
_mode, _hdr = ${JSON.stringify(mode)}, ${header ? 'True' : 'False'}
def _show(cur):
    if cur.description is None:
        return
    cols = [d[0] for d in cur.description]
    raw = cur.fetchall()
    rows = [["" if v is None else str(v) for v in r] for r in raw]
    if _mode == "json":
        print(json.dumps([dict(zip(cols, r)) for r in raw], ensure_ascii=False, default=str))
    elif _mode == "csv":
        w = csv.writer(sys.stdout, lineterminator="\\n")
        if _hdr: w.writerow(cols)
        w.writerows(rows)
    elif _mode == "line":
        for r in rows:
            for c, v in zip(cols, r): print(c.rjust(max(map(len, cols))), "=", v)
            print()
    elif _mode in ("column", "box", "table", "markdown"):
        ws = [max([len(c)] + [len(r[i]) for r in rows]) for i, c in enumerate(cols)]
        line = lambda cells: (" | " if _mode != "column" else "  ").join(v.ljust(ws[i]) for i, v in enumerate(cells)) if _mode != "column" else "  ".join(v.ljust(ws[i]) for i, v in enumerate(cells)).rstrip()
        if _mode in ("box", "table"):
            sep = "+-" + "-+-".join("-" * w for w in ws) + "-+"
            print(sep); print("| " + line(cols) + " |"); print(sep)
            for r in rows: print("| " + line(r) + " |")
            print(sep)
        elif _mode == "markdown":
            print("| " + line(cols) + " |"); print("|" + "|".join("-" * (w + 2) for w in ws) + "|")
            for r in rows: print("| " + line(r) + " |")
        else:
            if _hdr:
                print(line(cols)); print("  ".join("-" * w for w in ws))
            for r in rows: print(line(r))
    else:
        if _hdr: print("|".join(cols))
        for r in rows: print("|".join(r))
_sql = ${JSON.stringify(sql)}
try:
    _cur = _con.cursor()
    _parts, _buf = [], ""
    for _ch in _sql:
        _buf += _ch
        if _ch == ";" and sqlite3.complete_statement(_buf):
            _parts.append(_buf); _buf = ""
    if _buf.strip(): _parts.append(_buf)
    for _p in _parts:
        if not _p.strip(): continue
        _cur.execute(_p)
        _show(_cur)
    _con.commit()
except sqlite3.Error as _e:
    print("Error:", _e, file=sys.stderr)
    raise SystemExit(1)
finally:
    _con.close()
`
      return this.host.python({ entry: '<sqlite3>', source: src, argv: ['sqlite3'], cwd: this.cwd, stdin: null, out: ctx.out, err: ctx.err, tty: false, signal: ctx.signal, term: ctx.term })
    }
    const sql = plain.slice(1).join(' ') || (ctx.stdinStream ? ctx.stdin : '')
    if (sql && sql.trim()) return runSql(sql)
    if (!ctx.term || !ctx.term.readLine) { ctx.err('使い方: sqlite3 ファイル.db "SELECT …"\n'); return 1 }
    // 対話モード
    ctx.print(`SQLite (Python の sqlite3) — ${db === ':memory:' ? 'メモリの中' : plain[0]}\n.tables / .schema / .mode column|list|csv|json|box / .headers on|off / .quit`)
    let buf = ''
    for (;;) {
      ctx.out(buf ? '   ...> ' : 'sqlite> ')
      const line = await ctx.term.readLine({})
      if (line === null || line === undefined) break
      const t = line.trim()
      if (!buf && t.startsWith('.')) {
        const [cmd, arg] = t.split(/\s+/)
        if (cmd === '.quit' || cmd === '.exit' || cmd === '.q') break
        if (cmd === '.tables') await runSql("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
        else if (cmd === '.schema') await runSql(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL${arg ? ` AND name = '${arg.replace(/'/g, "''")}'` : ''};`)
        else if (cmd === '.mode') { mode = arg || 'list'; if (mode !== 'list' && mode !== 'csv') header = true }
        else if (cmd === '.headers' || cmd === '.header') header = arg === 'on'
        else ctx.err(`${cmd} は使えません\n`)
        continue
      }
      buf += line + '\n'
      if (/;\s*$/.test(buf)) { await runSql(buf); buf = '' }
    }
    return 0
  },

  // ---- bc ----
  async bc(args, ctx) {
    const { o, rest } = getopts(args, 'lqs')
    const state = { scale: o.l ? 20 : 0, vars: {} }
    let src = ''
    for (const it of await inputs(this, rest, ctx, 'bc')) if (it) src += it.text + '\n'
    if (!src.trim()) {
      if (!ctx.term || !ctx.term.readLine) return 0
      for (;;) {
        const line = await ctx.term.readLine({})
        if (line === null || line === undefined || line.trim() === 'quit') break
        try { for (const l of bcEval(line, state)) ctx.print(l) } catch (e) { ctx.err(`bc: ${e.message}\n`) }
      }
      return 0
    }
    try { for (const l of bcEval(src, state)) ctx.print(l) } catch (e) { ctx.err(`bc: ${e.message}\n`); return 1 }
    return 0
  },

  // ---- バイナリを見る ----
  async xxd(args, ctx) {
    const { o, rest } = getopts(args, 'pur', 'lcs')
    const data = bytesOf(await readAny(this, rest[0], ctx, 'xxd'))
    if (o.r) {
      const hexs = String(dec.decode(data)).split('\n').map(l => (o.p ? l : l.replace(/^[0-9a-f]+:\s*/i, '').replace(/\s\s.*$/, ''))).join('').replace(/[^0-9a-f]/gi, '')
      const out = new Uint8Array(hexs.length / 2)
      for (let k = 0; k < out.length; k++) out[k] = parseInt(hexs.substr(k * 2, 2), 16)
      ctx.out(dec.decode(out))
      return 0
    }
    const cols = Number(o.c) || (o.p ? 30 : 16)
    const limit = o.l ? Number(o.l) : Infinity
    const start = Number(o.s) || 0
    const view = data.subarray(start, Math.min(data.length, start + limit))
    if (o.p) { for (let k = 0; k < view.length; k += cols) ctx.print(hex(view.subarray(k, k + cols))); return 0 }
    for (let k = 0; k < view.length; k += cols) {
      const row = view.subarray(k, k + cols)
      let h = ''
      for (let j = 0; j < cols; j++) { h += j < row.length ? row[j].toString(16).padStart(2, '0') : '  '; if (j % 2) h += ' ' }
      ctx.print(`${C.gray}${(start + k).toString(16).padStart(8, '0')}:${C.reset} ${o.u ? h.toUpperCase() : h} ${[...row].map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')}`)
    }
    return 0
  },
  async hexdump(args, ctx) {
    const { rest } = getopts(args, 'Cvx')
    const data = bytesOf(await readAny(this, rest[0], ctx, 'hexdump'))
    for (let k = 0; k < data.length; k += 16) {
      const row = data.subarray(k, k + 16)
      const a = [...row.subarray(0, 8)].map(b => b.toString(16).padStart(2, '0')).join(' ')
      const b = [...row.subarray(8)].map(x => x.toString(16).padStart(2, '0')).join(' ')
      ctx.print(`${k.toString(16).padStart(8, '0')}  ${a.padEnd(23)}  ${b.padEnd(23)}  |${[...row].map(x => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join('')}|`)
    }
    ctx.print(data.length.toString(16).padStart(8, '0'))
    return 0
  },
  async od(args, ctx) {
    const { o, rest } = getopts(args, 'cxbdv', 'A')
    const data = bytesOf(await readAny(this, rest[0], ctx, 'od'))
    for (let k = 0; k < data.length; k += 16) {
      const row = [...data.subarray(k, k + 16)]
      const cells = o.c ? row.map(b => (b === 10 ? '\\n' : b === 9 ? '\\t' : b === 0 ? '\\0' : b >= 32 && b < 127 ? String.fromCharCode(b) : b.toString(8).padStart(3, '0')).padStart(4)) : o.x ? row.map(b => b.toString(16).padStart(2, '0').padStart(3)) : row.map(b => b.toString(8).padStart(3, '0').padStart(4))
      ctx.print(`${k.toString(8).padStart(7, '0')} ${cells.join('')}`)
    }
    ctx.print(data.length.toString(8).padStart(7, '0'))
    return 0
  },

  // ---- 圧縮 ----
  async gzip(args, ctx) {
    const { o, rest } = getopts(args, 'dckfv123456789')
    if (o.d) return this.callCmd('gunzip', args.filter(a => a !== '-d'), ctx)
    const { gzipSync } = await import('../../../vendor/fflate.js')
    if (!rest.length) { ctx.out(dec.decode(gzipSync(bytesOf(ctx.stdin ?? '')))); return 0 }
    for (const f of rest) {
      const p = this.resolve(f)
      const data = await readAny(this, f, ctx, 'gzip')
      if (data === null) return 1
      const gz = gzipSync(bytesOf(data))
      await this.fsWrite(p + '.gz', gz)
      if (!o.k && !o.c) await this.fsRemove(p)
      if (o.v) ctx.print(`${f}: ${Math.round(100 - (gz.length / Math.max(1, bytesOf(data).length)) * 100)}% → ${f}.gz`)
    }
    return 0
  },
  async gunzip(args, ctx) {
    const { o, rest } = getopts(args, 'ckfv')
    const { gunzipSync } = await import('../../../vendor/fflate.js')
    for (const f of rest) {
      const p = this.resolve(f)
      const data = await readAny(this, f, ctx, 'gunzip')
      if (data === null) return 1
      let out
      try { out = gunzipSync(bytesOf(data)) } catch (e) { ctx.err(`gunzip: ${f}: gzip の形ではありません\n`); return 1 }
      if (o.c) { ctx.out(dec.decode(out)); continue }
      await this.fsWrite(p.replace(/\.(gz|tgz)$/, m => (m === '.tgz' ? '.tar' : '')), bytesToContent(out))
      if (!o.k) await this.fsRemove(p)
    }
    return 0
  },
  async zcat(args, ctx) { return this.callCmd('gunzip', ['-c', ...args], ctx) },
  async tar(args, ctx) {
    // tar -czf a.tgz dir / tar -xzf a.tgz / tar -tf a.tar (- なしの「czf」も)
    let a = [...args]
    if (a[0] && !a[0].startsWith('-') && /^[ctxzvfC]+$/.test(a[0])) a[0] = '-' + a[0]
    let mode = null, gz = false, file = null, verbose = false, dir = ''
    const items = []
    for (let k = 0; k < a.length; k++) {
      const x = a[k]
      if (x.startsWith('-') && x.length > 1 && !x.startsWith('--')) {
        for (let j = 1; j < x.length; j++) {
          const f = x[j]
          if (f === 'c' || f === 'x' || f === 't') mode = f
          else if (f === 'z') gz = true
          else if (f === 'v') verbose = true
          else if (f === 'f') { file = x.slice(j + 1) || a[++k]; break }
          else if (f === 'C') { dir = a[++k]; break }
        }
      } else if (x === '--gzip') gz = true
      else items.push(x)
    }
    if (!mode || !file) { ctx.err('使い方: tar -czf まとめ.tgz フォルダ / tar -xzf まとめ.tgz / tar -tf まとめ.tar\n'); return 2 }
    const { gzipSync, gunzipSync } = await import('../../../vendor/fflate.js')
    if (mode === 'c') {
      const entries = []
      const add = p => {
        if (this.isDir(p)) { if (p) entries.push({ path: p, dir: true }); for (const c of this.children(p, true)) add(p ? p + '/' + c.name : c.name); return }
        entries.push({ path: p })
      }
      for (const it of items) { const p = this.resolve(it); if (!this.stat(p)) { ctx.err(`tar: ${it}: ありません\n`); return 2 } add(p) }
      for (const e of entries) { if (!e.dir) e.data = bytesOf(await this.host.read(e.path)); if (verbose) ctx.print(e.path + (e.dir ? '/' : '')) }
      let buf = tarPack(entries)
      if (gz || /\.(tgz|tar\.gz)$/.test(file)) buf = gzipSync(buf)
      await this.fsWrite(this.resolve(file), buf)
      return 0
    }
    let data = await readAny(this, file, ctx, 'tar')
    if (data === null) return 2
    data = bytesOf(data)
    if (gz || (data[0] === 0x1f && data[1] === 0x8b)) { try { data = gunzipSync(data) } catch { ctx.err('tar: gzip を戻せません\n'); return 2 } }
    const entries = tarUnpack(data)
    if (mode === 't') { for (const e of entries) ctx.print(e.path + (e.dir ? '/' : '')); return 0 }
    const base = dir ? this.resolve(dir) : this.cwd
    for (const e of entries) {
      if (e.path.split('/').includes('..')) continue
      const p = base ? base + '/' + e.path : e.path
      if (e.dir) { await this.fsMkdir(p); continue }
      const d = dirName(p)
      if (d && !this.isDir(d)) await this.fsMkdir(d)
      await this.fsWrite(p, bytesToContent(e.data))
      if (verbose) ctx.print(e.path)
    }
    return 0
  },

  // ---- ハッシュ ----
  md5sum(args, ctx) { return sumCmd(this, 'MD5', 'md5sum', args, ctx) },
  sha1sum(args, ctx) { return sumCmd(this, 'SHA-1', 'sha1sum', args, ctx) },
  sha384sum(args, ctx) { return sumCmd(this, 'SHA-384', 'sha384sum', args, ctx) },
  sha512sum(args, ctx) { return sumCmd(this, 'SHA-512', 'sha512sum', args, ctx) },

  // ---- 文字の処理 ----
  async column(args, ctx) {
    const { o, rest } = getopts(args, 'tn', 'sox')
    const it = (await inputs(this, rest, ctx, 'column'))[0]
    if (!it) return 1
    const ls = lines(it.text).filter(l => l.length)
    if (!o.t) {
      const w = Math.max(0, ...ls.map(l => l.length)) + 2
      const per = Math.max(1, Math.floor(ctx.cols / Math.max(1, w)))
      const rows = Math.ceil(ls.length / per)
      for (let r = 0; r < rows; r++) { let line = ''; for (let c = 0; c < per; c++) { const v = ls[c * rows + r]; if (v !== undefined) line += v.padEnd(w) } ctx.print(line.trimEnd()) }
      return 0
    }
    const sep = o.s ? new RegExp('[' + o.s.replace(/[\]\\^-]/g, '\\$&') + ']+') : /\s+/
    const table = ls.map(l => l.split(sep))
    const ws = []
    for (const r of table) r.forEach((c, i) => { ws[i] = Math.max(ws[i] || 0, c.length) })
    for (const r of table) ctx.print(r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(ws[i]))).join(o.o ?? '  ').trimEnd())
    return 0
  },
  async paste(args, ctx) {
    const { o, rest } = getopts(args, 's', 'd')
    const d = (o.d ?? '\t').replace(/\\t/g, '\t').replace(/\\n/g, '\n')
    const cols = []
    for (const it of await inputs(this, rest.length ? rest : ['-'], ctx, 'paste')) { if (!it) return 1; cols.push(lines(it.text)) }
    if (o.s) { for (const c of cols) ctx.print(c.join(d)); return 0 }
    const n = Math.max(0, ...cols.map(c => c.length))
    for (let i = 0; i < n; i++) ctx.print(cols.map(c => c[i] ?? '').join(d))
    return 0
  },
  async comm(args, ctx) {
    const { o, rest } = getopts(args, '123')
    if (rest.length < 2) { ctx.err('使い方: comm ファイル1 ファイル2 (並べ替えたもの)\n'); return 1 }
    const [a, b] = await inputs(this, rest, ctx, 'comm')
    if (!a || !b) return 1
    const A = lines(a.text), B = lines(b.text)
    let i = 0, j = 0
    const col = (k, s) => { if (o[k]) return; const pad = ['1', '2', '3'].slice(0, k - 1).filter(x => !o[x]).length; ctx.print('\t'.repeat(pad) + s) }
    while (i < A.length || j < B.length) {
      if (j >= B.length || (i < A.length && A[i] < B[j])) col(1, A[i++])
      else if (i >= A.length || B[j] < A[i]) col(2, B[j++])
      else { col(3, A[i]); i++; j++ }
    }
    return 0
  },
  async fold(args, ctx) {
    const { o, rest } = getopts(args, 's', 'w', { num: 'w' })
    const w = Number(o.w) || 80
    for (const it of await inputs(this, rest, ctx, 'fold')) {
      if (!it) continue
      for (const l of lines(it.text)) {
        let s = l
        while (s.length > w) {
          let cut = w
          if (o.s) { const k = s.lastIndexOf(' ', w); if (k > 0) cut = k + 1 }
          ctx.print(s.slice(0, cut)); s = s.slice(cut)
        }
        ctx.print(s)
      }
    }
    return 0
  },
  async tac(args, ctx) {
    for (const it of await inputs(this, args, ctx, 'tac')) if (it) for (const l of lines(it.text).reverse()) ctx.print(l)
    return 0
  },
  async shuf(args, ctx) {
    const { o, rest } = getopts(args, 'e', 'ni')
    let items
    if (o.e) items = rest
    else if (o.i) { const [a, b] = o.i.split('-').map(Number); items = []; for (let k = a; k <= b; k++) items.push(String(k)) }
    else { const it = (await inputs(this, rest, ctx, 'shuf'))[0]; if (!it) return 1; items = lines(it.text) }
    for (let k = items.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [items[k], items[j]] = [items[j], items[k]] }
    for (const x of items.slice(0, o.n ? Number(o.n) : undefined)) ctx.print(x)
    return 0
  },
  async split(args, ctx) {
    const { o, rest } = getopts(args, 'd', 'lba', { num: 'l' })
    const it = (await inputs(this, rest.slice(0, 1), ctx, 'split'))[0]
    if (!it) return 1
    const prefix = rest[1] || 'x'
    const n = Number(o.l) || 1000
    const ls = lines(it.text)
    const name = k => prefix + (o.d ? String(k).padStart(Number(o.a) || 2, '0') : String.fromCharCode(97 + Math.floor(k / 26)) + String.fromCharCode(97 + (k % 26)))
    let k = 0
    for (let i = 0; i < ls.length; i += n) await this.fsWrite(this.resolve(name(k++)), ls.slice(i, i + n).join('\n') + '\n')
    return 0
  },
  async cmp(args, ctx) {
    const { o, rest } = getopts(args, 's')
    const a = bytesOf(await readAny(this, rest[0], ctx, 'cmp')), b = bytesOf(await readAny(this, rest[1], ctx, 'cmp'))
    const n = Math.min(a.length, b.length)
    for (let k = 0; k < n; k++) if (a[k] !== b[k]) { if (!o.s) ctx.print(`${rest[0]} ${rest[1]} 違い: ${k + 1} バイト目`); return 1 }
    if (a.length !== b.length) { if (!o.s) ctx.print(`cmp: ${a.length < b.length ? rest[0] : rest[1]} の終わり (EOF)`); return 1 }
    return 0
  },

  // ---- ファイル ----
  async mktemp(args, ctx) {
    const { o, rest } = getopts(args, 'dqu', 'p')
    const tpl = rest[0] || 'tmp.XXXXXXXX'
    const name = tpl.replace(/X{3,}$/, m => Array.from({ length: m.length }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join(''))
    const p = this.resolve((o.p ? o.p + '/' : '') + name)
    if (o.d) await this.fsMkdir(p); else await this.fsWrite(p, '')
    ctx.print(p)
    return 0
  },
  async ln(args, ctx) {
    // 本当のリンクは作れないので、コピーを作る
    const { rest } = getopts(args, 'sfnv')
    if (rest.length < 2) { ctx.err('使い方: ln -s 元 先\n'); return 1 }
    ctx.err(`${C.gray}ln: このアプリではリンクを作れないため、コピーを作ります${C.reset}\n`)
    return this.callCmd('cp', ['-r', ...rest], ctx)
  },
  chmod(args, ctx) { return 0 },
  chown(args, ctx) { return 0 },
  async truncate(args, ctx) {
    const { o, rest } = getopts(args, 'c', 's')
    const size = Number(o.s || 0)
    for (const f of rest) {
      const p = this.resolve(f)
      const t = this.isFile(p) ? await this.host.read(p) : ''
      const b = bytesOf(t ?? '')
      const out = new Uint8Array(size)
      out.set(b.subarray(0, size))
      await this.fsWrite(p, isBin(t) ? out : dec.decode(out))
    }
    return 0
  },
  id(args, ctx) { ctx.print('uid=1000(forge) gid=1000(forge) groups=1000(forge)'); return 0 },

  // ---- 実行の道具 ----
  async eval(args, ctx) { return this.run(args.join(' '), ctx.io) },
  async command(args, ctx) {
    if (args[0] === '-v' || args[0] === '-V') return this.callCmd('which', args.slice(1), ctx)
    if (!args.length) return 0
    return this.exec(args, ctx)
  },
  async builtin(args, ctx) { return args.length ? this.exec(args, ctx) : 0 },
  async timeout(args, ctx) {
    const { rest } = getopts(args, 'vf', 'sk')
    const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(rest[0] || '')
    if (!m || rest.length < 2) { ctx.err('使い方: timeout 秒 コマンド …\n'); return 125 }
    const ms = Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[m[2] || 's']) * 1000
    const ac = new AbortController()
    const onAbort = () => ac.abort()
    if (ctx.signal) ctx.signal.addEventListener('abort', onAbort, { once: true })
    let timedOut = false
    const t = setTimeout(() => { timedOut = true; ac.abort(); if (this.host.running && this.host.running()) this.host.command('stop') }, ms)
    try {
      const code = await this.exec(rest.slice(1), { ...ctx, signal: ac.signal })
      return timedOut ? 124 : code
    } catch (e) { if (timedOut) return 124; throw e } finally { clearTimeout(t); if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort) }
  },

  // ---- ジョブ (コマンド & で裏で動かしたもの) ----
  jobs(args, ctx) {
    for (const j of this.jobs || []) ctx.print(`[${j.id}]${j === (this.jobs || [])[this.jobs.length - 1] ? '+' : ' '}  ${j.done ? (j.status === 0 ? '終了    ' : `終了(${j.status})`) : '実行中  '}  ${j.text}`)
    return 0
  },
  async fg(args, ctx) {
    const j = this.findJob(args[0])
    if (!j) { ctx.err('fg: そのジョブはありません\n'); return 1 }
    ctx.print(j.text)
    const onAbort = () => j.ac.abort()
    if (ctx.signal) ctx.signal.addEventListener('abort', onAbort, { once: true })
    try { await j.promise } finally { if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort) }
    j.reported = true
    this.jobs = (this.jobs || []).filter(x => x !== j)
    return j.status ?? 0
  },
  bg(args, ctx) { const j = this.findJob(args[0]); if (!j) { ctx.err('bg: そのジョブはありません\n'); return 1 } ctx.print(`[${j.id}] ${j.text} &`); return 0 },
  async wait(args, ctx) {
    const list = args.length ? args.map(a => this.findJob(a)).filter(Boolean) : [...(this.jobs || [])]
    let status = 0
    for (const j of list) { await j.promise; status = j.status ?? 0 }
    this.reportJobs(ctx.io || ctx)
    return status
  },
}
