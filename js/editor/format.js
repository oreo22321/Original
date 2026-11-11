// コード整形 (Luau のインデント再計算)
import { Lexer } from '../luau/lexer.js'
import { scanBlocks, makeLineInfo } from './blocks.js'

const BR_OPEN = new Set(['(', '{', '['])
const BR_CLOSE = new Set([')', '}', ']'])

// 入力途中のコードでも止まらないように、寛容なスキャナでブロック構造を調べて字下げし直します。
// (if 式 `local x = if a then b else c` は end を持たないブロックとして扱いません)
export function formatLuau(src, unit = '\t') {
  const { tokens } = scanBlocks(src, true)
  const info = makeLineInfo(src)
  const lines = src.split('\n')
  // 複数行の文字列・コメントの内側の行はそのまま
  const verbatim = new Set()
  const byLine = new Map()
  for (const t of tokens) {
    const a = info.lineOf(t.s)
    if (t.t === 'str' || t.t === 'comment') {
      const b = info.lineOf(Math.max(t.s, t.e - 1))
      for (let l = a + 1; l <= b; l++) verbatim.add(l)
      if (t.t === 'comment') continue
    }
    let list = byLine.get(a)
    if (!list) byLine.set(a, list = [])
    list.push(t)
  }
  const stack = []
  const out = []
  for (let l = 0; l < lines.length; l++) {
    const raw = lines[l]
    if (verbatim.has(l)) {
      out.push(raw)
      // 文字列の閉じと同じ行にあるトークンも数える
    } else {
      const body = raw.trim()
      const toks = byLine.get(l) || []
      let level = stack.length ? stack[stack.length - 1] + 1 : 0
      const first = toks[0]
      if (first && stack.length && (first.role === 'close' || first.role === 'mid' || BR_CLOSE.has(first.t))) level = stack[stack.length - 1]
      out.push(body ? unit.repeat(level) + body : '')
      for (const t of toks) {
        if (t.role === 'open' || BR_OPEN.has(t.t)) stack.push(level)
        else if (t.role === 'close' || BR_CLOSE.has(t.t)) stack.pop()
      }
      continue
    }
    const level = stack.length ? stack[stack.length - 1] + 1 : 0
    for (const t of byLine.get(l) || []) {
      if (t.role === 'open' || BR_OPEN.has(t.t)) stack.push(level)
      else if (t.role === 'close' || BR_CLOSE.has(t.t)) stack.pop()
    }
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
