// シェルの道具: 色・パス・文字の幅・ワイルドカード・標準入力・オプション・表示の道具
import { humanSize, isBin } from '../bin.js'

export const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m',
  magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m', bred: '\x1b[1;31m', bgreen: '\x1b[1;32m', bblue: '\x1b[1;34m', byellow: '\x1b[1;33m',
}
export const PY_ROOT = '/home/pyodide/project'
// incomplete: 続きの行が要る (for … do の後・閉じていない引用符など)
export class ShellError extends Error { constructor(msg, incomplete = false) { super(msg); this.incomplete = incomplete } }
export class Flow { constructor(kind, code = 0) { this.kind = kind; this.code = code } }   // break / continue / return / exit

// ============================================================
// パス
// ============================================================
export function resolvePath(cwd, p) {
  let s = String(p ?? '')
  if (s === PY_ROOT || s.startsWith(PY_ROOT + '/')) s = '/' + s.slice(PY_ROOT.length + 1)
  let parts
  if (s === '~' || s.startsWith('~/')) parts = s.slice(1).split('/')
  else if (s.startsWith('/')) parts = s.split('/')
  else parts = (cwd ? cwd + '/' + s : s).split('/')
  const out = []
  for (const x of parts) {
    if (!x || x === '.') continue
    if (x === '..') out.pop()
    else out.push(x)
  }
  return out.join('/')
}
export const showPath = p => (p ? '~/' + p : '~')
export const baseName = p => p.slice(p.lastIndexOf('/') + 1)
export const dirName = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

// 全角の文字は 2 文字分の幅
export function strWidth(s) {
  let w = 0
  for (const ch of s) {
    const c = ch.codePointAt(0)
    w += (c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd))) ? 2 : 1
  }
  return w
}

// ワイルドカード (* ? [..]) → 正規表現 (\ で始まる文字はそのまま)
export function globRe(pat, flags = '') {
  let src = ''
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i]
    if (c === '\\' && i + 1 < pat.length) { src += pat[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue }
    if (c === '*') src += '[^/]*'
    else if (c === '?') src += '[^/]'
    else if (c === '[') {
      const j = pat.indexOf(']', i + 2)
      if (j < 0) { src += '\\['; continue }
      let cls = pat.slice(i + 1, j)
      if (cls[0] === '!') cls = '^' + cls.slice(1)
      src += '[' + cls.replace(/\\/g, '\\\\') + ']'
      i = j
    } else src += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + src + '$', flags)
}
// case のパターン・${x#pat} 用: * は / も含めて何にでも当てはまる (anchored: 全体と比べる)
export function patRe(pat, anchored = true) {
  const re = globRe(pat).source.slice(1, -1).replace(/\[\^\/\]\*/g, '.*').replace(/\[\^\/\]/g, '.')
  return new RegExp(anchored ? '^(?:' + re + ')$' : re, 's')
}
// {a,b,c} と {1..5} {a..e} {01..10} {1..10..2} (引用符の外だけ)
export function braceExpand(word) {
  for (let k = 0; k < word.length; k++) {
    const s = word[k]
    if (s.t !== 'lit' || !s.v.includes('{')) continue
    const g = findBrace(s.v)
    if (!g) continue
    const out = []
    for (const alt of g.alts) out.push(...braceExpand([...word.slice(0, k), { t: 'lit', v: s.v.slice(0, g.start) + alt + s.v.slice(g.end + 1) }, ...word.slice(k + 1)]))
    return out
  }
  return [word]
}
function findBrace(v) {
  for (let i = 0; i < v.length; i++) {
    if (v[i] !== '{' || (i > 0 && v[i - 1] === '$')) continue
    let depth = 0, last = i + 1
    const parts = []
    for (let j = i; j < v.length; j++) {
      if (v[j] === '{') depth++
      else if (v[j] === ',' && depth === 1) { parts.push(v.slice(last, j)); last = j + 1 }
      else if (v[j] === '}') {
        depth--
        if (depth) continue
        parts.push(v.slice(last, j))
        if (parts.length > 1) return { start: i, end: j, alts: parts }
        const m = /^(-?\d+|[a-zA-Z])\.\.(-?\d+|[a-zA-Z])(?:\.\.(-?\d+))?$/.exec(parts[0])
        if (m) {
          const step = Math.abs(Number(m[3] || 1)) || 1
          const alts = []
          if (/\d/.test(m[1]) && /\d/.test(m[2])) {
            const a = Number(m[1]), b = Number(m[2])
            const pad = (/^-?0\d/.test(m[1]) || /^-?0\d/.test(m[2])) ? Math.max(m[1].replace('-', '').length, m[2].replace('-', '').length) : 0
            for (let x = a; a <= b ? x <= b : x >= b; x += a <= b ? step : -step) { alts.push(pad ? (x < 0 ? '-' : '') + String(Math.abs(x)).padStart(pad, '0') : String(x)); if (alts.length > 10000) break }
          } else if (!/\d/.test(m[1]) && !/\d/.test(m[2])) {
            const a = m[1].charCodeAt(0), b = m[2].charCodeAt(0)
            for (let x = a; a <= b ? x <= b : x >= b; x += a <= b ? step : -step) alts.push(String.fromCharCode(x))
          } else break
          return { start: i, end: j, alts }
        }
        break
      }
    }
  }
  return null
}
export const hasGlob = pat => /(^|[^\\])[*?[]/.test(pat)
export const unescapeGlob = pat => pat.replace(/\\(.)/g, '$1')
// 標準入力 (パイプ・< ファイル)。read は 1 行ずつ、ほかのコマンドは残りすべてを読む
export class Stream {
  constructor(text) { this.text = text ?? '' }
  readLine() {
    if (!this.text) return null
    const k = this.text.indexOf('\n')
    const line = k < 0 ? this.text : this.text.slice(0, k)
    this.text = k < 0 ? '' : this.text.slice(k + 1)
    return line
  }
  readAll() { const t = this.text; this.text = ''; return t }
}

// オプションの読み取り: spec = 'lah' (フラグ) / vals = 'n' (値を取るもの)。-n5 / -n 5 / -la / -- に対応
export function getopts(args, flags = '', vals = '', { num = null } = {}) {
  const o = {}, rest = []
  let only = false
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (only || a === '-' || !a.startsWith('-') || a.length < 2) { rest.push(a); continue }
    if (a === '--') { only = true; continue }
    if (a.startsWith('--')) { o[a.slice(2)] = true; continue }
    if (num && /^-\d+$/.test(a)) { o[num] = a.slice(1); continue }
    for (let j = 1; j < a.length; j++) {
      const f = a[j]
      if (vals.includes(f)) { o[f] = a.slice(j + 1) || args[++k] || ''; break }
      if (flags.includes(f)) o[f] = true
      else throw new ShellError(`-${f} は使えないオプションです`)
    }
  }
  return { o, rest }
}

// ============================================================
// 表示の道具
// ============================================================
export function columns(names, width, colorOf = () => '') {
  if (!names.length) return ''
  const ws = names.map(strWidth)
  const gap = 2
  let rows = names.length, cols = 1, colW = []
  for (let c = Math.min(names.length, Math.max(1, Math.floor(width / 3))); c >= 1; c--) {
    const r = Math.ceil(names.length / c)
    const cw = []
    for (let x = 0; x < c; x++) cw.push(Math.max(0, ...ws.slice(x * r, x * r + r)))
    if (cw.reduce((a, b) => a + b, 0) + gap * (c - 1) <= width) { rows = r; cols = c; colW = cw; break }
  }
  if (cols === 1) return names.map((n, k) => colorOf(k) + n + (colorOf(k) ? C.reset : '')).join('\n') + '\n'
  let out = ''
  for (let y = 0; y < rows; y++) {
    const line = []
    for (let x = 0; x < cols; x++) {
      const k = x * rows + y
      if (k >= names.length) continue
      const pad = x < cols - 1 && (x + 1) * rows + y < names.length ? ' '.repeat(colW[x] - ws[k] + gap) : ''
      const col = colorOf(k)
      line.push(col + names[k] + (col ? C.reset : '') + pad)
    }
    out += line.join('') + '\n'
  }
  return out
}
export const human = n => (n < 1024 ? n + 'B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + 'K' : (n / 1048576).toFixed(1) + 'M')
export const pad2 = n => String(n).padStart(2, '0')
export function shortDate(t) {
  if (!t) return '            '
  const d = new Date(t)
  return `${pad2(d.getMonth() + 1)}月${pad2(d.getDate())}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
export function nameColor(e) {
  if (e.dir) return C.bblue
  if (/\.(zip|gz|tar|whl)$/i.test(e.name)) return C.red
  if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(e.name)) return C.magenta
  return ''
}
export function lines(text) {
  if (!text) return []
  const ls = text.split('\n')
  if (ls[ls.length - 1] === '') ls.pop()
  return ls
}
export function escapes(s) {
  return s.replace(/\\(n|t|r|e|0?33|\\|a|b|v|f|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/g, (m, c) => {
    if (c === 'n') return '\n'
    if (c === 't') return '\t'
    if (c === 'r') return '\r'
    if (c === 'e' || c === '033' || c === '33') return '\x1b'
    if (c === '\\') return '\\'
    if (c === 'a') return '\x07'
    if (c === 'b') return '\b'
    if (c === 'v') return '\v'
    if (c === 'f') return '\f'
    if (c[0] === 'x' || c[0] === 'u') return String.fromCharCode(parseInt(c.slice(1), 16))
    return m
  })
}
// 入力 (ファイルか、パイプの中身) を順に
export async function inputs(sh, files, ctx, name) {
  const out = []
  if (!files.length) { out.push({ name: '-', text: ctx.stdin ?? '' }); return out }
  for (const f of files) {
    if (f === '-') { out.push({ name: '-', text: ctx.stdin ?? '' }); continue }
    const p = sh.resolve(f)
    if (sh.isDir(p)) { ctx.err(`${name}: ${f}: フォルダです\n`); out.push(null); continue }
    const t = sh.isFile(p) ? await sh.host.read(p) : null
    if (t === null) { ctx.err(`${name}: ${f}: ファイルがありません\n`); out.push(null); continue }
    if (isBin(t)) { ctx.err(`${name}: ${f}: バイナリファイルです (${humanSize(t.length)})\n`); out.push(null); continue }
    out.push({ name: f, text: t })
  }
  return out
}
export const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) { reject(Object.assign(new Error('止めました'), { name: 'AbortError' })); return }
  const t = setTimeout(resolve, ms)
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('止めました'), { name: 'AbortError' })) }, { once: true })
})
export function strftime(fmt, d) {
  const W = ['日', '月', '火', '水', '木', '金', '土']
  const map = {
    Y: d.getFullYear(), y: pad2(d.getFullYear() % 100), m: pad2(d.getMonth() + 1), d: pad2(d.getDate()), e: String(d.getDate()).padStart(2, ' '),
    H: pad2(d.getHours()), M: pad2(d.getMinutes()), S: pad2(d.getSeconds()), s: Math.floor(d.getTime() / 1000),
    A: W[d.getDay()] + '曜日', a: W[d.getDay()], B: (d.getMonth() + 1) + '月', b: (d.getMonth() + 1) + '月', j: String(Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5)).padStart(3, '0'),
    F: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, T: `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`,
    Z: (() => { try { return Intl.DateTimeFormat('en', { timeZoneName: 'short' }).formatToParts(d).find(p => p.type === 'timeZoneName').value } catch { return '' } })(),
    n: '\n', t: '\t', '%': '%',
  }
  return fmt.replace(/%([a-zA-Z%])/g, (m, c) => (c in map ? String(map[c]) : m))
}
export function fmtDuration(ms) {
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60
  return (d ? `${d} 日 ` : '') + `${h}:${pad2(m)}:${pad2(s % 60)}`
}
// sed の置き換え文字 (\1 & → $1 $&)
export function sedRepl(rep) {
  let out = ''
  for (let i = 0; i < rep.length; i++) {
    const c = rep[i]
    if (c === '\\' && i + 1 < rep.length) {
      const d = rep[++i]
      out += /\d/.test(d) ? '$' + d : d === 'n' ? '\n' : d === 't' ? '\t' : d === '&' ? '&' : d
    } else if (c === '&') out += '$&'
    else if (c === '$') out += '$$'
    else out += c
  }
  return out
}
export function expandSet(s) {
  s = escapes(s)
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i + 1] === '-' && i + 2 < s.length) {
      for (let c = s.charCodeAt(i); c <= s.charCodeAt(i + 2); c++) out += String.fromCharCode(c)
      i += 2
    } else out += s[i]
  }
  return out
}
// grep / sed のふつうの書き方 (BRE): ( ) { } | + ? はそのままの文字、\( \) などがグループ (-E のときは JavaScript と同じ)
export function bre(src) {
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '\\' && i + 1 < src.length) {
      const d = src[++i]
      out += '(){}|+?'.includes(d) ? d : '\\' + d
    } else out += '(){}|+?'.includes(c) ? '\\' + c : c
  }
  return out
}
// s/前/後/フラグ (区切りの文字は自由。\/ は区切りではない)
export function parseSubst(s) {
  if (s[0] !== 's' || s.length < 2) return null
  const d = s[1]
  const parts = []
  let cur = ''
  for (let i = 2; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) {
      if (s[i + 1] === d) cur += d
      else cur += c + s[i + 1]
      i++
      continue
    }
    if (c === d) {
      parts.push(cur)
      cur = ''
      if (parts.length === 2) { const flags = s.slice(i + 1); return /^[gip0-9]*$/.test(flags) ? { re: parts[0], rep: parts[1], flags } : null }
      continue
    }
    cur += c
  }
  return null
}
// 行の差分 (最長共通部分列)
export function diffLines(a, b) {
  const n = a.length, m = b.length
  if (n * m > 4_000_000) return null
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const ops = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push([' ', a[i], i, j]); i++; j++ }
    else if (L[i + 1][j] >= L[i][j + 1]) { ops.push(['-', a[i], i, j]); i++ }
    else { ops.push(['+', b[j], i, j]); j++ }
  }
  while (i < n) { ops.push(['-', a[i], i, j]); i++ }
  while (j < m) { ops.push(['+', b[j], i, j]); j++ }
  return ops
}

// ============================================================
// コマンド
// ============================================================
