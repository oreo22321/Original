// コード整形
//  formatLuau: 字下げ・空白 (演算子やカンマの前後)・空行を整えます
//  formatLineSpacing: 1 行の中の空白だけを整えます (入力中の自動整形用)
//  reindentLuau: 字下げだけを直します
// 文字列・コメントの中は変えません。整形の前後で字句 (トークン) の並びが変わらないことを確かめ、
// 変わってしまう場合は字下げだけの整形に戻します (コードの意味は絶対に変えない)。
import { Lexer } from '../luau/lexer.js'
import { scanBlocks, makeLineInfo, lightTokens } from './blocks.js'

const BR_OPEN = new Set(['(', '{', '['])
const BR_CLOSE = new Set([')', '}', ']'])
const VALUE = new Set(['name', 'num', 'str', 'true', 'false', 'nil', '...'])
const KW = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'for', 'function', 'if', 'in', 'local', 'not', 'or', 'repeat', 'return', 'then', 'until', 'while'])
const BINARY = new Set(['=', '==', '~=', '<=', '>=', '<', '>', '+', '-', '*', '/', '//', '%', '^', '..', '+=', '-=', '*=', '/=', '//=', '%=', '^=', '..=', '->', '::', '|', '&'])
// この後に来る - は単項演算子 (-x)
const BEFORE_UNARY = new Set(['(', '[', '{', ',', ';', '=', '==', '~=', '<=', '>=', '<', '>', '+', '-', '*', '/', '//', '%', '^', '..', '+=', '-=', '*=', '/=', '//=', '%=', '^=', '..=', 'return', 'and', 'or', 'not', 'then', 'else', 'elseif', 'do', 'in', 'until', 'if', 'while', '#', '::', '->'])
// 行末にあると、次の行は式の続き (継続行)
const CONT_END = new Set(['=', 'and', 'or', '..', '+', '-', '*', '/', '//', '%', '^', '==', '~=', '<', '>', '<=', '>=', 'not', '+=', '-=', '*=', '/=', '..='])
// 行頭にあると、前の行の式の続き
const CONT_START = new Set(['and', 'or', '..', '+', '-', '*', '/', '//', '%', '^', '==', '~=', '<', '>', '<=', '>=', '.', ':'])
const OPENS = new Set(['then', 'do', 'repeat', 'else', '{', '(', '['])
const CLOSES = new Set(['end', 'until', 'else', 'elseif', '}', ')', ']'])

// トークンに印を付ける: 単項演算子 / メソッド呼び出しの : / 型の行
function annotate(text, tokens, lineOf) {
  let prevCode = null
  const typeLines = new Set()
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    t.text = text.slice(t.s, t.e)
    t.line = lineOf(t.s)
    if (t.t === 'comment') continue
    if (t.t === '-') t.unary = !prevCode || BEFORE_UNARY.has(prevCode.t)
    else if (t.t === '#') t.unary = true
    prevCode = t
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.t === ':') {
      const a = tokens[i + 1], b = tokens[i + 2]
      t.method = !!(a && a.t === 'name' && a.line === t.line && b && b.line === t.line && (b.t === '(' || b.t === 'str' || b.t === '{'))
      if (!t.method) typeLines.add(t.line)
    } else if (t.t === '->' || t.t === '::') typeLines.add(t.line)
    else if (t.t === 'name' && (t.text === 'type' || t.text === 'export') && (i === 0 || tokens[i - 1].line !== t.line) && tokens[i + 1] && tokens[i + 1].t === 'name') typeLines.add(t.line)
  }
  return typeLines
}

// 同じ行で隣り合う 2 つのトークンの間の空白
function gapBetween(P, C, orig, typeLine) {
  const keep = orig.length ? ' ' : ''
  if (C.t === 'comment') return orig.length && /^ +$/.test(orig) ? orig : ' '
  if (P.t === 'comment') return keep
  if (typeLine && (P.t === '<' || P.t === '>' || C.t === '<' || C.t === '>')) return keep
  if (C.t === ',' || C.t === ';') return ''
  if (P.t === ',' || P.t === ';') return ' '
  if (P.t === '[') return C.text[0] === '[' || C.text[0] === '=' ? ' ' : ''
  if (P.t === '(') return ''
  if (C.t === ']' && P.t === 'str' && P.text.endsWith(']')) return ' '
  if (C.t === ')' || C.t === ']') return ''
  if (P.t === '{') return C.t === '}' ? '' : ' '
  if (C.t === '}') return ' '
  if (C.t === '?') return ''
  if (P.t === '@') return ''
  if (P.t === '.' || C.t === '.') return ''
  if (C.t === ':') return ''
  if (P.t === ':') return P.method ? '' : ' '
  if (C.t === '(') {
    if (P.t === 'function') return ''
    if (KW.has(P.t)) return ' '
    if (P.t === 'str') return keep
    if (VALUE.has(P.t) || P.t === ')' || P.t === ']' || P.t === '}' || P.t === '>') return ''
    if (P.unary || P.t === '#') return ''
    return ' '
  }
  if (C.t === '[') return VALUE.has(P.t) && P.t !== 'num' || P.t === ')' || P.t === ']' ? '' : ' '
  if (C.t === '{') return P.t === 'name' || P.t === ')' || P.t === 'str' ? keep : ' '
  if (P.unary || P.t === '#') return P.t === '-' && C.t === '-' ? ' ' : ''
  if (C.unary || C.t === '#') return ' '
  if (BINARY.has(P.t) || BINARY.has(C.t)) return ' '
  if (C.t === 'str' && (P.t === 'name' || P.t === ')')) return keep
  if (KW.has(P.t) || KW.has(C.t)) return ' '
  if (VALUE.has(P.t) && VALUE.has(C.t)) return ' '
  if (P.t === ')' || P.t === ']' || P.t === '}') return ' '
  return keep
}

// 字句の並びが同じか (整形でコードの意味が変わっていないことの確認)
function sameTokens(a, b) {
  const ta = lightTokens(a, true), tb = lightTokens(b, true)
  if (ta.length !== tb.length) return false
  for (let i = 0; i < ta.length; i++) {
    const x = a.slice(ta[i].s, ta[i].e), y = b.slice(tb[i].s, tb[i].e)
    if (x !== y) return false
  }
  return true
}

// 入力途中のコードでも止まらないように、寛容なスキャナでブロック構造を調べて整形します。
// opts.finalNewline: 最後に改行を 1 つ付ける (既定 true)
export function formatLuau(src, unit = '\t', opts = {}) {
  const text = src.replace(/\r\n?/g, '\n')
  if (!text.trim()) return ''
  let out
  try { out = formatTokens(text, unit) } catch { out = null }
  if (out === null || !sameTokens(text, out)) out = reindentLuau(text, unit).replace(/[ \t]+$/gm, '')
  out = out.replace(/\n*$/, '')
  return opts.finalNewline === false ? out : out + '\n'
}

function formatTokens(text, unit) {
  const { tokens, blocks } = scanBlocks(text, true)
  if (!tokens.length) return text
  const info = makeLineInfo(text)
  const typeLines = annotate(text, tokens, info.lineOf)
  // function の引数リストの ) (この行の後ろの空行は消す)
  const headerEnds = new Set()
  for (const b of blocks) if (b.kind === 'function' && b.headerEnd !== undefined) headerEnds.add(b.headerEnd)
  const opens = t => OPENS.has(t.t) || headerEnds.has(t.e)
  const parts = []
  const stack = []
  let prev = null, lastCode = null, lastCodePrevLine = null
  let lineLevel = 0, prevLineLevel = 0, prevLineCont = false
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (!prev || text.slice(prev.e, t.s).includes('\n')) {
      // ---- 新しい行 ----
      let blanks = 0
      if (prev) {
        const gap = text.slice(prev.e, t.s)
        let nl = 0
        for (let k = 0; k < gap.length; k++) if (gap.charCodeAt(k) === 10) nl++
        const lead = prev.t === 'comment' && lastCode && lastCode.line === prev.line ? lastCode : prev
        blanks = nl > 1 && !opens(lead) && !CLOSES.has(t.t) ? 1 : 0
      }
      const top = stack.length ? stack[stack.length - 1] + 1 : 0
      let level = top
      let cont = false
      if (stack.length && (t.role === 'close' || t.role === 'mid' || BR_CLOSE.has(t.t))) level = stack[stack.length - 1]
      else if (prev && t.t !== 'comment' && lastCodePrevLine && (CONT_END.has(lastCodePrevLine.t) || CONT_START.has(t.t))) {
        cont = true
        level = Math.max(top, prevLineCont ? prevLineLevel : prevLineLevel + 1)
      }
      if (prev) parts.push('\n'.repeat(1 + blanks))
      parts.push(unit.repeat(level))
      prevLineLevel = level
      prevLineCont = cont
      lineLevel = level
    } else {
      parts.push(gapBetween(prev, t, text.slice(prev.e, t.s), typeLines.has(t.line)))
    }
    parts.push(t.text)
    if (t.role === 'open' || BR_OPEN.has(t.t)) stack.push(lineLevel)
    else if (t.role === 'close' || BR_CLOSE.has(t.t)) stack.pop()
    prev = t
    // 複数行にまたがるトークン (長い文字列・コメント) の後ろは、その終わりの行が基準
    if (t.text.includes('\n')) t.line = info.lineOf(t.e - 1)
    if (t.t !== 'comment') {
      lastCode = t
      // 次のトークンが別の行なら、これが「前の行の最後のコード」
      const nx = tokens[i + 1]
      if (!nx || nx.line !== t.line || nx.t === 'comment') lastCodePrevLine = t
    }
  }
  return parts.join('')
}

// 1 行の中の空白だけを整えます (字下げ・行末以外は変えない)。文字列やコメントが行をまたぐ場合はそのまま
export function formatLineSpacing(line) {
  const indent = /^[ \t]*/.exec(line)[0]
  const body = line.slice(indent.length).replace(/[ \t]+$/, '')
  if (!body) return indent ? '' : line
  const tokens = lightTokens(body, true)
  if (!tokens.length) return indent + body
  const last = tokens[tokens.length - 1]
  const ltext = body.slice(last.s, last.e)
  // 閉じていない文字列・長いコメントで終わる行はさわらない
  if ((last.t === 'str' && !closedString(ltext)) || (last.t === 'comment' && /^--\[=*\[/.test(ltext) && !/\]=*\]$/.test(ltext))) return line.replace(/[ \t]+$/, '')
  const typeLines = annotate(body, tokens, () => 0)
  let out = tokens[0].text
  for (let i = 1; i < tokens.length; i++) out += gapBetween(tokens[i - 1], tokens[i], body.slice(tokens[i - 1].e, tokens[i].s), typeLines.has(0)) + tokens[i].text
  if (!sameTokens(body, out)) return indent + body
  return indent + out
}
function closedString(s) {
  const q = s[0]
  if (q === '"' || q === "'" || q === '`') {
    if (s.length < 2 || s[s.length - 1] !== q) return false
    let bs = 0
    for (let i = s.length - 2; i >= 0 && s[i] === '\\'; i--) bs++
    return bs % 2 === 0
  }
  const m = /^\[(=*)\[/.exec(s)
  return m ? s.length >= m[0].length + m[1].length + 2 && s.endsWith(']' + m[1] + ']') : true
}

// ファイルの字下げの単位 (タブ / スペース n 個) を推定。分からなければ null
export function detectIndentUnit(text) {
  let tabs = 0, spaces = 0
  const widths = new Map()
  const re = /^([ \t]+)\S/gm
  let m, n = 0
  while ((m = re.exec(text)) && n < 2000) {
    n++
    const ws = m[1]
    if (ws[0] === '\t') tabs++
    else { spaces++; const w = ws.length; if (w <= 8) widths.set(w, (widths.get(w) || 0) + 1) }
  }
  if (!tabs && !spaces) return null
  if (tabs >= spaces) return '\t'
  // いちばん小さいよく使われる幅 (2 / 4)
  let best = 4
  for (const w of [2, 3, 4, 8]) if ((widths.get(w) || 0) > 0) { best = w; break }
  return ' '.repeat(best)
}

// 字下げだけを直す (以前の整形と同じ)
export function reindentLuau(src, unit = '\t') {
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
