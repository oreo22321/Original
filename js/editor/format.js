// コード整形 (Luau / Lua のインデント再計算)
import { Lexer, LuauSyntaxError } from '../luau/lexer.js'

const OPENERS = new Set(['function', 'then', 'do', 'repeat', '(', '{', '['])
const CLOSERS = new Set(['end', 'until', ')', '}', ']'])

export function formatLuau(src, unit = '\t') {
  const lx = new Lexer(src)
  lx.comments = []
  const tokens = []
  try {
    for (;;) {
      const t = lx.next()
      if (t.t === 'eof') break
      tokens.push(t)
    }
  } catch (e) {
    if (e instanceof LuauSyntaxError) throw new Error(`${e.line} 行目: ${e.message} (整形できません)`)
    throw e
  }
  const lines = src.split('\n')
  const lineStarts = [0]
  for (let i = 0; i < lines.length; i++) lineStarts.push(lineStarts[i] + lines[i].length + 1)
  const lineOf = pos => {
    let lo = 0, hi = lines.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1 }
    return lo
  }
  // 複数行の文字列・コメントの内側の行はそのまま
  const verbatim = new Set()
  const markSpan = (s, e) => { const a = lineOf(s), b = lineOf(Math.max(s, e - 1)); for (let l = a + 1; l <= b; l++) verbatim.add(l) }
  for (const t of tokens) if ((t.t === 'string' || t.t === 'interp') && t.e - t.s > 0) markSpan(t.s, t.e)
  for (const c of lx.comments) markSpan(c.s, c.e)

  const byLine = new Map()
  for (const t of tokens) {
    const l = lineOf(t.s)
    if (!byLine.has(l)) byLine.set(l, [])
    byLine.get(l).push(t)
  }
  const stack = []
  let pendingLoop = 0
  const out = []
  for (let l = 0; l < lines.length; l++) {
    const raw = lines[l]
    const toks = byLine.get(l) || []
    if (verbatim.has(l)) { out.push(raw); continue }
    const body = raw.trim()
    let level = stack.length ? stack[stack.length - 1] + 1 : 0
    const first = toks[0]
    if (first && (CLOSERS.has(first.t) || first.t === 'else' || first.t === 'elseif') && stack.length && first.s >= lineStarts[l] + raw.indexOf(body)) {
      level = stack[stack.length - 1]
    }
    if (!toks.length && body.startsWith('--')) {
      // コメントだけの行
    }
    for (const t of toks) {
      const v = t.t
      if (v === 'while' || v === 'for') pendingLoop++
      else if (v === 'do' && pendingLoop > 0) { pendingLoop--; stack.push(level) }
      else if (v === 'else') { stack.pop(); stack.push(level) }
      else if (v === 'elseif') stack.pop()
      else if (OPENERS.has(v)) stack.push(level)
      else if (CLOSERS.has(v)) stack.pop()
    }
    out.push(body ? unit.repeat(Math.max(0, level)) + body : '')
  }
  return out.join('\n')
}

// 末尾の空白を削除し、最後に改行を 1 つ
export function tidy(src) {
  return src.split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n*$/, '\n')
}

// Luau の簡易圧縮 (コメント・余分な空白を除去)
export function minifyLuau(src) {
  const lx = new Lexer(src)
  let out = ''
  let prev = null
  let prevLine = 0
  for (;;) {
    const t = lx.next()
    if (t.t === 'eof') break
    const text = src.slice(t.s, t.e)
    // 改行は残す (文の区切りが曖昧になるのを防ぐ)
    if (prev && t.line !== prevLine) { out += '\n'; prev = null }
    prevLine = lx.line
    if (prev && /[\w]$/.test(prev) && /^[\w]/.test(text)) out += ' '
    else if (prev && ((prev.endsWith('-') && text.startsWith('-')) || (prev.endsWith('.') && /^[.\d]/.test(text)) || (prev.endsWith('[') && text.startsWith('[')))) out += ' '
    out += text
    prev = text
  }
  return out
}
