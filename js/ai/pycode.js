// Forge AI: Python のコードを扱う小さな道具 (位置の変換・まとめて書き換え・字句の分割)
export const lineOf = (text, pos) => { let n = 1; for (let i = 0; i < pos && i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n }
export const fence = (code, lang = 'python') => '```' + lang + '\n' + String(code).replace(/\n+$/, '') + '\n```'
export const isPy = p => /\.(pyw?|pyi)$/i.test(p || '')

// 行・文字の位置 (行は 1 から、文字は 0 から) → 文字列の中の位置
export function offsetAt(text, line, col) {
  let off = 0, l = 1
  while (l < line) {
    const nl = text.indexOf('\n', off)
    if (nl < 0) return text.length
    off = nl + 1
    l++
  }
  const end = text.indexOf('\n', off)
  return Math.min(off + col, end < 0 ? text.length : end)
}

// まとめて書き換え ([{ line, col, endLine, endCol, text }])。後ろから順に (位置がずれないように)。重なるものは捨てる
export function applyEdits(text, edits) {
  const list = edits.map(e => ({ from: offsetAt(text, e.line, e.col), to: offsetAt(text, e.endLine ?? e.line, e.endCol ?? e.col), text: e.text }))
    .sort((a, b) => b.from - a.from || b.to - a.to)
  let out = text, last = Infinity, n = 0
  for (const e of list) {
    if (e.to > last) continue
    out = out.slice(0, e.from) + e.text + out.slice(e.to)
    last = e.from
    n++
  }
  return { text: out, count: n }
}

// 文字列とコメントを同じ長さの空白にする (位置を保ったまま、コードの部分だけを正規表現で探すため)
export function blankStrings(text) {
  let out = '', i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '#') { const e = text.indexOf('\n', i); const end = e < 0 ? n : e; out += ' '.repeat(end - i); i = end; continue }
    if (c === '"' || c === "'") {
      // 接頭辞 (f / r / b) はそのまま
      const q = text.startsWith(c.repeat(3), i) ? c.repeat(3) : c
      let j = i + q.length
      while (j < n) {
        if (text[j] === '\\') { j += 2; continue }
        if (text.startsWith(q, j)) { j += q.length; break }
        if (text[j] === '\n' && q.length === 1) break
        j++
      }
      const s = text.slice(i, Math.min(j, n))
      out += q + s.slice(q.length, Math.max(q.length, s.length - (s.endsWith(q) && s.length >= 2 * q.length ? q.length : 0))).replace(/[^\n]/g, ' ') + (s.endsWith(q) && s.length >= 2 * q.length ? q : '')
      i = Math.min(j, n)
      continue
    }
    out += c
    i++
  }
  return out
}

// 字句 (続きの提案の学習に使う): 名前・数・文字列・記号。コメントは捨てる
const OPS = ['**=', '//=', '>>=', '<<=', '...', '->', ':=', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '//', '<<', '>>']
export function pyTokens(text) {
  const out = []
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '\n') { out.push({ t: 'nl', s: i, e: i + 1 }); i++; continue }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\\') { i++; continue }
    if (c === '#') { while (i < n && text[i] !== '\n') i++; continue }
    const pre = /^[rRbBfFuU]{0,2}(?=["'])/.exec(text.slice(i, i + 3))
    if (c === '"' || c === "'" || (pre && pre[0])) {
      const start = i
      i += pre ? pre[0].length : 0
      const qc = text[i]
      const q = text.startsWith(qc.repeat(3), i) ? qc.repeat(3) : qc
      i += q.length
      while (i < n) {
        if (text[i] === '\\') { i += 2; continue }
        if (text.startsWith(q, i)) { i += q.length; break }
        if (text[i] === '\n' && q.length === 1) break
        i++
      }
      out.push({ t: 'str', s: start, e: Math.min(i, n) })
      continue
    }
    if (/[A-Za-z_À-￿]/.test(c)) {
      const s = i
      while (i < n && /[\wÀ-￿]/.test(text[i])) i++
      out.push({ t: 'name', s, e: i })
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] || ''))) {
      const m = /^(0[xob][0-9a-f_]+|[0-9_]*\.?[0-9_]+(e[+-]?[0-9]+)?j?)/i.exec(text.slice(i))
      const len = m && m[0].length ? m[0].length : 1
      out.push({ t: 'num', s: i, e: i + len })
      i += len
      continue
    }
    const op = OPS.find(o => text.startsWith(o, i))
    const len = op ? op.length : 1
    out.push({ t: 'op', s: i, e: i + len })
    i += len
  }
  return out
}

// 文中のコード (```python … ``` か、コードらしい行が多い文)
export function extractCode(text) {
  const f = /```(?:python|py|python3)?\s*\n([\s\S]*?)```/i.exec(text)
  if (f) return f[1].replace(/\n$/, '')
  const lines = String(text).split('\n')
  const codeish = lines.filter(l => /^\s*(def |class |import |from \S+ import|if .*:\s*$|elif .*:|else:|for .* in .*:|while .*:|try:|except|return\b|print\(|#|[\w.]+\(.*\)\s*$|[\w.\[\], ]+\s*[+\-*/]?=\s*.+)/.test(l))
  if (lines.length >= 3 && codeish.length >= Math.max(2, lines.length * 0.6)) return text.trim()
  return null
}
