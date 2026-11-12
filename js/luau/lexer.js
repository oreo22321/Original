// Luau / Lua 字句解析器
// 文字列リテラルの値は「バイト文字列」(各文字コード 0-255, UTF-8 バイト列) として返します。

export class LuauSyntaxError extends Error {
  constructor(message, line, col, pos) {
    super(message)
    this.name = 'LuauSyntaxError'
    this.line = line
    this.col = col
    this.pos = pos
  }
}

export const KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if',
  'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
])

// UTF-16 文字列 → UTF-8 バイト文字列
export function toBytes(str) {
  let out = ''
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c < 0x80) { out += str[i]; continue }
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++ }
    }
    out += utf8Encode(c)
  }
  return out
}

export function utf8Encode(c) {
  if (c < 0x80) return String.fromCharCode(c)
  if (c < 0x800) return String.fromCharCode(0xc0 | (c >> 6), 0x80 | (c & 63))
  if (c < 0x10000) return String.fromCharCode(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  return String.fromCharCode(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
}

// UTF-8 バイト文字列 → UTF-16 文字列 (不正なバイトは � に)
export function fromBytes(bytes) {
  if (!/[\x80-\xff]/.test(bytes)) return bytes
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new TextDecoder('utf-8').decode(arr)
}

const isDigit = c => c >= 48 && c <= 57
const isHex = c => isDigit(c) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70)
const isAlpha = c => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c >= 0x80

// 3 文字 → 2 文字 → 1 文字の順で記号を照合
const SYM3 = new Set(['...', '//=', '..='])
const SYM2 = new Set(['==', '~=', '<=', '>=', '//', '..', '::', '->', '+=', '-=', '*=', '/=', '%=', '^='])
const SYM1 = new Set('+-*/%^#<>=(){}[];:,.?|&@'.split(''))

export class Lexer {
  constructor(src, start = 0, end = src.length, line = 1, lineStart = 0) {
    this.src = src
    this.pos = start
    this.end = end
    this.line = line
    this.lineStart = lineStart
    this.comments = null // 配列を入れるとコメントを収集
  }

  error(msg, pos = this.pos) {
    throw new LuauSyntaxError(msg, this.line, pos - this.lineStart + 1, pos)
  }

  newline(i) { this.line++; this.lineStart = i + 1 }

  // 長括弧 [==[ の開始を判定し、レベル (= の数) を返す。違えば -1
  longBracketLevel(i) {
    const s = this.src
    if (s.charCodeAt(i) !== 91) return -1
    let j = i + 1, level = 0
    while (s.charCodeAt(j) === 61) { level++; j++ }
    return s.charCodeAt(j) === 91 ? level : -1
  }

  readLong(i, level, what) {
    const s = this.src
    const startLine = this.line
    let j = i + level + 2
    if (s[j] === '\r') j++
    if (s[j] === '\n') { this.newline(j); j++ }
    const close = ']' + '='.repeat(level) + ']'
    const k = s.indexOf(close, j)
    if (k < 0 || k >= this.end) {
      this.line = startLine
      this.error(`${what}が閉じられていません (${startLine} 行目で開始)`, i)
    }
    for (let x = j; x < k; x++) if (s.charCodeAt(x) === 10) this.newline(x)
    return { text: s.slice(j, k), next: k + close.length }
  }

  skipSpace() {
    const s = this.src
    let i = this.pos
    for (;;) {
      if (i >= this.end) break
      const c = s.charCodeAt(i)
      if (c === 10) { this.newline(i); i++; continue }
      if (c === 32 || c === 9 || c === 13 || c === 11 || c === 12) { i++; continue }
      if (c === 45 && s.charCodeAt(i + 1) === 45) {
        const cstart = i
        const startLine = this.line
        i += 2
        const lvl = this.longBracketLevel(i)
        if (lvl >= 0) {
          const r = this.readLong(i, lvl, 'コメント')
          i = r.next
        } else {
          while (i < this.end && s.charCodeAt(i) !== 10) i++
        }
        if (this.comments) this.comments.push({ s: cstart, e: i, line: startLine, text: s.slice(cstart, i) })
        continue
      }
      break
    }
    this.pos = i
  }

  // 次のトークンを返す: { t: type, v: value, line, col, s, e }
  next() {
    this.skipSpace()
    const s = this.src
    const i = this.pos
    const line = this.line, col = i - this.lineStart + 1
    if (i >= this.end) return { t: 'eof', v: '<eof>', line, col, s: i, e: i }
    const c = s.charCodeAt(i)
    const tok = (t, v, e) => { this.pos = e; return { t, v, line, col, s: i, e } }

    if (isAlpha(c)) {
      let j = i + 1
      while (j < this.end) {
        const d = s.charCodeAt(j)
        if (isAlpha(d) || isDigit(d)) j++
        else break
      }
      const word = s.slice(i, j)
      return tok(KEYWORDS.has(word) ? word : 'name', word, j)
    }
    if (isDigit(c) || (c === 46 && isDigit(s.charCodeAt(i + 1)))) return this.readNumber(i, line, col)
    if (c === 34 || c === 39) return this.readString(i, c, line, col)
    if (c === 96) return this.readInterp(i, line, col)
    if (c === 91) {
      const lvl = this.longBracketLevel(i)
      if (lvl >= 0) {
        const r = this.readLong(i, lvl, '文字列')
        this.pos = r.next
        return { t: 'string', v: toBytes(r.text), line, col, s: i, e: r.next }
      }
    }
    const three = s.substr(i, 3)
    if (SYM3.has(three)) return tok(three, three, i + 3)
    const two = s.substr(i, 2)
    if (SYM2.has(two)) return tok(two, two, i + 2)
    if (two === '!=') this.error("'!=' は使えません。Luau では '~=' を使います")
    if (two === '&&') this.error("'&&' は使えません。Luau では 'and' を使います")
    if (two === '||') this.error("'||' は使えません。Luau では 'or' を使います")
    const one = s[i]
    if (SYM1.has(one)) return tok(one, one, i + 1)
    if (one === '!') this.error("'!' は使えません。Luau では 'not' を使います")
    this.error(`予期しない文字 '${one}'`)
  }

  readNumber(i, line, col) {
    const s = this.src
    let j = i
    let value
    if (s[j] === '0' && (s[j + 1] === 'x' || s[j + 1] === 'X')) {
      j += 2
      const st = j
      while (j < this.end && (isHex(s.charCodeAt(j)) || s[j] === '_')) j++
      const digits = s.slice(st, j).replace(/_/g, '')
      if (!digits) this.error('不正な16進数', i)
      value = digits.length > 13 ? Number(BigInt('0x' + digits) & ((1n << 64n) - 1n)) : parseInt(digits, 16)
    } else if (s[j] === '0' && (s[j + 1] === 'b' || s[j + 1] === 'B')) {
      j += 2
      const st = j
      while (j < this.end && (s[j] === '0' || s[j] === '1' || s[j] === '_')) j++
      const digits = s.slice(st, j).replace(/_/g, '')
      if (!digits) this.error('不正な2進数', i)
      value = parseInt(digits, 2)
    } else {
      while (j < this.end && (isDigit(s.charCodeAt(j)) || s[j] === '_')) j++
      if (s[j] === '.') { j++; while (j < this.end && (isDigit(s.charCodeAt(j)) || s[j] === '_')) j++ }
      if (s[j] === 'e' || s[j] === 'E') {
        j++
        if (s[j] === '+' || s[j] === '-') j++
        if (!isDigit(s.charCodeAt(j))) this.error('不正な数値 (指数部)', i)
        while (j < this.end && isDigit(s.charCodeAt(j))) j++
      }
      value = Number(s.slice(i, j).replace(/_/g, ''))
    }
    if (j < this.end && isAlpha(s.charCodeAt(j))) this.error(`不正な数値 '${s.slice(i, j + 1)}'`, i)
    this.pos = j
    return { t: 'number', v: value, line, col, s: i, e: j }
  }

  // エスケープシーケンスを処理 (i は '\\' の次の位置)。[バイト文字列, 次の位置]
  readEscape(i) {
    const s = this.src
    const c = s[i]
    switch (c) {
      case 'n': return ['\n', i + 1]
      case 't': return ['\t', i + 1]
      case 'r': return ['\r', i + 1]
      case 'a': return ['\x07', i + 1]
      case 'b': return ['\b', i + 1]
      case 'f': return ['\f', i + 1]
      case 'v': return ['\v', i + 1]
      case '\\': return ['\\', i + 1]
      case '"': return ['"', i + 1]
      case "'": return ["'", i + 1]
      case '`': return ['`', i + 1]
      case '{': return ['{', i + 1]
      case '}': return ['}', i + 1]
      case '\n': this.newline(i); return ['\n', i + 1]
      case '\r': if (s[i + 1] === '\n') { this.newline(i + 1); return ['\n', i + 2] } return ['\n', i + 1]
      case 'x': {
        const h = s.substr(i + 1, 2)
        if (!/^[0-9a-fA-F]{2}$/.test(h)) this.error('不正なエスケープ \\x', i)
        return [String.fromCharCode(parseInt(h, 16)), i + 3]
      }
      case 'z': {
        let j = i + 1
        while (j < this.end && /\s/.test(s[j])) { if (s[j] === '\n') this.newline(j); j++ }
        return ['', j]
      }
      case 'u': {
        if (s[i + 1] !== '{') this.error('不正なエスケープ \\u (\\u{XXXX} の形式で書きます)', i)
        const k = s.indexOf('}', i + 2)
        const h = s.slice(i + 2, k)
        if (k < 0 || !/^[0-9a-fA-F]+$/.test(h)) this.error('不正なエスケープ \\u', i)
        return [utf8Encode(parseInt(h, 16)), k + 1]
      }
      default:
        if (/[0-9]/.test(c)) {
          let j = i, n = ''
          while (j < i + 3 && /[0-9]/.test(s[j])) n += s[j++]
          const v = parseInt(n, 10)
          if (v > 255) this.error('エスケープの値が大きすぎます', i)
          return [String.fromCharCode(v), j]
        }
        // 本物の Luau と同じく、知らないエスケープ ("\." など) はその文字として扱う
        {
          // 文字コード単位ではなく 1 文字 (サロゲートペアも) を、UTF-8 のバイト列として扱う
          const ch = String.fromCodePoint(s.codePointAt(i))
          if (this.warnings) this.warnings.push({ message: `不明なエスケープ '\\${ch}' (「${ch}」として扱われます)`, pos: i - 1 })
          return [toBytes(ch), i + ch.length]
        }
    }
  }

  readString(i, q, line, col) {
    const s = this.src
    let j = i + 1
    let out = ''
    let chunkStart = j
    for (;;) {
      if (j >= this.end) this.error('文字列が閉じられていません', i)
      const c = s.charCodeAt(j)
      if (c === q) break
      if (c === 10) this.error('文字列が閉じられていません (行末に達しました)', i)
      if (c === 92) {
        out += toBytes(s.slice(chunkStart, j))
        const [str, nj] = this.readEscape(j + 1)
        out += str
        j = nj
        chunkStart = j
        continue
      }
      j++
    }
    out += toBytes(s.slice(chunkStart, j))
    this.pos = j + 1
    return { t: 'string', v: out, line, col, s: i, e: j + 1 }
  }

  // `...{expr}...` を読み取る。parts: 文字列 or {s, e, line, lineStart} (式のソース範囲)
  readInterp(i, line, col) {
    const s = this.src
    let j = i + 1
    const parts = []
    let out = ''
    let chunkStart = j
    for (;;) {
      if (j >= this.end) this.error('補間文字列 (`) が閉じられていません', i)
      const c = s.charCodeAt(j)
      if (c === 96) break
      if (c === 10) this.error('補間文字列 (`) が閉じられていません (行末に達しました)', i)
      if (c === 92) {
        out += toBytes(s.slice(chunkStart, j))
        const [str, nj] = this.readEscape(j + 1)
        out += str
        j = nj
        chunkStart = j
        continue
      }
      if (c === 123) {
        out += toBytes(s.slice(chunkStart, j))
        parts.push(out); out = ''
        // 対応する } を探す (入れ子の {} と文字列を考慮)
        const exprStart = j + 1
        const exprLine = this.line, exprLineStart = this.lineStart
        let depth = 0, k = exprStart
        for (;;) {
          if (k >= this.end) this.error('補間文字列の { が閉じられていません', j)
          const d = s[k]
          if (d === '{') depth++
          else if (d === '}') { if (depth === 0) break; depth-- }
          else if (d === '"' || d === "'") {
            const q2 = d; k++
            while (k < this.end && s[k] !== q2 && s[k] !== '\n') { if (s[k] === '\\') k++; k++ }
          } else if (d === '`') {
            k++
            while (k < this.end && s[k] !== '`' && s[k] !== '\n') { if (s[k] === '\\') k++; k++ }
          } else if (d === '\n') this.newline(k)
          k++
        }
        if (k === exprStart) this.error('補間文字列の {} が空です', j)
        parts.push({ s: exprStart, e: k, line: exprLine, lineStart: exprLineStart })
        j = k + 1
        chunkStart = j
        continue
      }
      j++
    }
    out += toBytes(s.slice(chunkStart, j))
    parts.push(out)
    this.pos = j + 1
    return { t: 'interp', v: parts, line, col, s: i, e: j + 1 }
  }
}

// トークン列を一度に作る (ハイライトや整形用)
export function tokenize(src, withComments = false) {
  const lx = new Lexer(src)
  if (withComments) lx.comments = []
  const out = []
  for (;;) {
    const t = lx.next()
    out.push(t)
    if (t.t === 'eof') break
  }
  return { tokens: out, comments: lx.comments }
}
