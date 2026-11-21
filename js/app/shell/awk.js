// awk (ターミナル用の互換版): パターンと { 処理 } で、行ごと・列ごとに文字を処理する
// BEGIN / END・/正規表現/・比較・$1 $NF・NR NF FS OFS ORS・変数・連想配列・if / while / for / for (k in a)・
// print / printf・関数 (length substr index split sub gsub match sprintf toupper tolower int sqrt …)・自分の関数
// (アプリの安全のため eval を使わず、ここで読んで実行します)

class AwkError extends Error {}
const fail = m => { throw new AwkError(m) }

// ---- 字句 ----
const KEYWORDS = new Set(['BEGIN', 'END', 'function', 'func', 'if', 'else', 'while', 'for', 'do', 'break', 'continue', 'next', 'nextfile', 'exit', 'return', 'delete', 'in', 'print', 'printf', 'getline'])
function lex(src) {
  const toks = []
  let i = 0
  const n = src.length
  const prevIsValue = () => {
    const t = toks[toks.length - 1]
    if (!t) return false
    return t.type === 'num' || t.type === 'str' || t.type === 'name' || t.type === 'func' || t.type === 'builtin_var' || (t.type === 'op' && (t.v === ')' || t.v === ']' || t.v === '$' || t.v === '++' || t.v === '--'))
  }
  while (i < n) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; continue }
    if (c === '\n') { toks.push({ type: 'nl' }); i++; continue }
    if (c === '#') { while (i < n && src[i] !== '\n') i++; continue }
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] || ''))) {
      const m = /^(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?)/.exec(src.slice(i))
      if (m) { toks.push({ type: 'num', v: Number(m[0]) }); i += m[0].length; continue }
    }
    if (c === '"') {
      let j = i + 1, v = ''
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\') {
          const e = src[j + 1]
          v += { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', '/': '/', a: '\x07', b: '\b', f: '\f', v: '\v' }[e] ?? '\\' + e
          j += 2
        } else v += src[j++]
      }
      if (j >= n) fail('" が閉じられていません')
      toks.push({ type: 'str', v })
      i = j + 1
      continue
    }
    if (c === '/' && !prevIsValue()) {
      let j = i + 1, v = '', cls = false
      while (j < n && (src[j] !== '/' || cls)) {
        if (src[j] === '\\' && j + 1 < n) { v += src[j] + src[j + 1]; j += 2; continue }
        if (src[j] === '[') cls = true
        else if (src[j] === ']') cls = false
        if (src[j] === '\n') fail('/ が閉じられていません')
        v += src[j++]
      }
      if (j >= n) fail('/ が閉じられていません')
      toks.push({ type: 'regex', v })
      i = j + 1
      continue
    }
    const m = /^[A-Za-z_]\w*/.exec(src.slice(i))
    if (m) {
      const w = m[0]
      i += w.length
      if (KEYWORDS.has(w)) toks.push({ type: 'kw', v: w === 'func' ? 'function' : w })
      else if (src[i] === '(' && (BUILTINS[w] || true) && !/^(NR|NF|FNR|FS|OFS|ORS|RS|FILENAME|SUBSEP|RSTART|RLENGTH|CONVFMT|OFMT|ENVIRON|ARGC|ARGV)$/.test(w)) toks.push({ type: 'func', v: w })
      else toks.push({ type: 'name', v: w })
      continue
    }
    const ops = ['+=', '-=', '*=', '/=', '%=', '^=', '**=', '**', '==', '<=', '>=', '!=', '++', '--', '&&', '||', '>>', '!~', '|', '+', '-', '*', '/', '%', '^', '!', '>', '<', '~', '?', ':', '=', '(', ')', '{', '}', '[', ']', ';', ',', '$']
    const op = ops.find(o => src.startsWith(o, i))
    if (!op) fail(`「${c}」は使えない文字です`)
    toks.push({ type: 'op', v: op === '**' ? '^' : op === '**=' ? '^=' : op })
    i += op.length
  }
  toks.push({ type: 'eof' })
  return toks
}

// ---- 構文 ----
function parse(src) {
  const toks = lex(src)
  let p = 0
  const peek = (k = 0) => toks[p + k]
  const is = (type, v) => { const t = toks[p]; return t.type === type && (v === undefined || t.v === v) }
  const isOp = v => is('op', v)
  const eat = (type, v) => { if (!is(type, v)) fail(`${v || type} が必要です (${toks[p].v ?? toks[p].type} の前)`); return toks[p++] }
  const skipNl = () => { while (is('nl')) p++ }
  const skipTerm = () => { while (is('nl') || isOp(';')) p++ }

  const program = { begin: [], end: [], rules: [], funcs: {} }
  skipTerm()
  while (!is('eof')) {
    if (is('kw', 'BEGIN')) { p++; skipNl(); program.begin.push(block()) }
    else if (is('kw', 'END')) { p++; skipNl(); program.end.push(block()) }
    else if (is('kw', 'function')) {
      p++
      const name = toks[p].v; p++
      eat('op', '(')
      const params = []
      while (!isOp(')')) { params.push(eat('name').v); if (isOp(',')) { p++; skipNl() } }
      p++
      skipNl()
      program.funcs[name] = { params, body: block() }
    } else {
      let pattern = null, pattern2 = null
      if (!isOp('{')) {
        pattern = expr()
        if (isOp(',')) { p++; skipNl(); pattern2 = expr() }
      }
      const action = isOp('{') ? block() : null
      program.rules.push({ pattern, pattern2, action, inRange: false })
    }
    skipTerm()
  }
  return program

  function block() {
    eat('op', '{')
    const body = []
    skipTerm()
    while (!isOp('}')) { body.push(statement()); skipTerm() }
    p++
    return { type: 'block', body }
  }
  function simpleOrBlock() { skipNl(); if (isOp('{')) return block(); return statement() }
  function statement() {
    if (isOp('{')) return block()
    if (isOp(';')) { p++; return { type: 'block', body: [] } }
    const t = peek()
    if (t.type === 'kw') {
      switch (t.v) {
        case 'if': {
          p++; eat('op', '('); const cond = expr(); eat('op', ')')
          const then = simpleOrBlock()
          let k = p
          while (toks[k].type === 'nl' || (toks[k].type === 'op' && toks[k].v === ';')) k++
          let otherwise = null
          if (toks[k].type === 'kw' && toks[k].v === 'else') { p = k + 1; otherwise = simpleOrBlock() }
          return { type: 'if', cond, then, otherwise }
        }
        case 'while': { p++; eat('op', '('); const cond = expr(); eat('op', ')'); if (isOp(';')) { p++; return { type: 'while', cond, body: { type: 'block', body: [] } } } return { type: 'while', cond, body: simpleOrBlock() } }
        case 'do': { p++; const body = simpleOrBlock(); skipTerm(); eat('kw', 'while'); eat('op', '('); const cond = expr(); eat('op', ')'); return { type: 'do', body, cond } }
        case 'for': {
          p++; eat('op', '(')
          if (is('name') && peek(1).type === 'kw' && peek(1).v === 'in' && !(peek(2).type === 'op' && peek(2).v === '(')) {
            const v = eat('name').v; p++
            const arr = eat('name').v
            eat('op', ')')
            return { type: 'forin', v, arr, body: simpleOrBlock() }
          }
          const init = isOp(';') ? null : simpleStatement(); eat('op', ';'); skipNl()
          const cond = isOp(';') ? null : expr(); eat('op', ';'); skipNl()
          const step = isOp(')') ? null : simpleStatement(); eat('op', ')')
          if (isOp(';')) { p++; return { type: 'for', init, cond, step, body: { type: 'block', body: [] } } }
          return { type: 'for', init, cond, step, body: simpleOrBlock() }
        }
        case 'break': p++; return { type: 'break' }
        case 'continue': p++; return { type: 'continue' }
        case 'next': p++; return { type: 'next' }
        case 'nextfile': p++; return { type: 'next' }
        case 'exit': { p++; const v = endOfStmt() ? null : expr(); return { type: 'exit', v } }
        case 'return': { p++; const v = endOfStmt() ? null : expr(); return { type: 'return', v } }
      }
    }
    return simpleStatement()
  }
  function endOfStmt() { return is('nl') || isOp(';') || isOp('}') || is('eof') }
  function simpleStatement() {
    const t = peek()
    if (t.type === 'kw' && (t.v === 'print' || t.v === 'printf')) {
      p++
      let args = []
      const paren = isOp('(') && (() => { let d = 0, k = p; for (; k < toks.length; k++) { if (toks[k].type === 'op' && toks[k].v === '(') d++; else if (toks[k].type === 'op' && toks[k].v === ')') { d--; if (!d) break } } const nx = toks[k + 1]; return nx && (nx.type === 'nl' || nx.type === 'eof' || (nx.type === 'op' && [';', '}', '>', '>>', '|'].includes(nx.v))) })()
      if (paren) { p++; if (!isOp(')')) { args.push(expr(true)); while (isOp(',')) { p++; skipNl(); args.push(expr(true)) } } eat('op', ')') }
      else if (!endOfStmt() && !isOp('>') && !isOp('>>') && !isOp('|')) { args.push(expr(false)); while (isOp(',')) { p++; skipNl(); args.push(expr(false)) } }
      let redir = null
      if (isOp('>') || isOp('>>') || isOp('|')) { const op = toks[p++].v; redir = { op, target: concatExpr(false) } }
      return { type: t.v, args, redir }
    }
    if (t.type === 'kw' && t.v === 'delete') {
      p++
      const name = eat('name').v
      if (isOp('[')) { p++; const idx = exprList(); eat('op', ']'); return { type: 'delete', name, idx } }
      return { type: 'delete', name, idx: null }
    }
    return { type: 'expr', e: expr() }
  }
  function exprList() { const out = [expr(true)]; while (isOp(',')) { p++; out.push(expr(true)) } return out }

  // 式 (優先順位の低い順)
  function expr(allowGt = true) { return ternary(allowGt) }
  function ternary(g) {
    const c = or(g)
    if (isOp('?')) { p++; skipNl(); const a = ternary(g); skipNl(); eat('op', ':'); skipNl(); const b = ternary(g); return { type: 'cond', c, a, b } }
    if (['=', '+=', '-=', '*=', '/=', '%=', '^='].some(isOp) && (c.type === 'var' || c.type === 'index' || c.type === 'field')) {
      const op = toks[p++].v; skipNl()
      return { type: 'assign', op, target: c, v: ternary(g) }
    }
    return c
  }
  function or(g) { let l = and(g); while (isOp('||')) { p++; skipNl(); l = { type: 'or', l, r: and(g) } } return l }
  function and(g) { let l = inExpr(g); while (isOp('&&')) { p++; skipNl(); l = { type: 'and', l, r: inExpr(g) } } return l }
  function inExpr(g) {
    let l = match(g)
    while (is('kw', 'in')) { p++; l = { type: 'in', key: [l], arr: eat('name').v } }
    return l
  }
  function match(g) {
    let l = compare(g)
    while (isOp('~') || isOp('!~')) { const op = toks[p++].v; l = { type: 'match', neg: op === '!~', l, r: compare(g) } }
    return l
  }
  function compare(g) {
    let l = concatExpr(g)
    const ops = ['<', '<=', '==', '!=', '>=', ...(g ? ['>'] : [])]
    while (ops.some(isOp)) { const op = toks[p++].v; l = { type: 'cmp', op, l, r: concatExpr(g) } }
    return l
  }
  function startsValue() {
    const t = peek()
    if (t.type === 'num' || t.type === 'str' || t.type === 'regex' || t.type === 'name' || t.type === 'func') return true
    if (t.type === 'op' && ['$', '!', '(', '-', '+', '++', '--'].includes(t.v)) return t.v !== '-' && t.v !== '+' ? true : false
    return false
  }
  function concatExpr(g) {
    let l = additive()
    while (startsValue() && !is('kw', 'in')) l = { type: 'concat', l, r: additive() }
    return l
  }
  function additive() { let l = mult(); while (isOp('+') || isOp('-')) { const op = toks[p++].v; l = { type: 'bin', op, l, r: mult() } } return l }
  function mult() { let l = unary(); while (isOp('*') || isOp('/') || isOp('%')) { const op = toks[p++].v; l = { type: 'bin', op, l, r: unary() } } return l }
  function unary() {
    if (isOp('!')) { p++; return { type: 'not', e: unary() } }
    if (isOp('-')) { p++; return { type: 'neg', e: unary() } }
    if (isOp('+')) { p++; return { type: 'pos', e: unary() } }
    return power()
  }
  function power() {
    const b = postfix()
    if (isOp('^')) { p++; return { type: 'bin', op: '^', l: b, r: unaryPow() } }
    return b
  }
  function unaryPow() { if (isOp('-')) { p++; return { type: 'neg', e: unaryPow() } } return power() }
  function postfix() {
    if (isOp('++') || isOp('--')) { const op = toks[p++].v; return { type: 'incr', op, pre: true, target: postfix() } }
    let e = primary()
    if ((isOp('++') || isOp('--')) && (e.type === 'var' || e.type === 'index' || e.type === 'field')) { const op = toks[p++].v; e = { type: 'incr', op, pre: false, target: e } }
    return e
  }
  function primary() {
    const t = toks[p]
    if (t.type === 'num') { p++; return { type: 'num', v: t.v } }
    if (t.type === 'str') { p++; return { type: 'str', v: t.v } }
    if (t.type === 'regex') { p++; return { type: 'regex', v: t.v } }
    if (t.type === 'op' && t.v === '$') { p++; return { type: 'field', e: postfixNoIncr() } }
    if (t.type === 'op' && t.v === '(') {
      p++
      const e = expr(true)
      if (isOp(',')) { const list = [e]; while (isOp(',')) { p++; list.push(expr(true)) } eat('op', ')'); if (is('kw', 'in')) { p++; return { type: 'in', key: list, arr: eat('name').v } } return { type: 'group', e: list[0] } }
      eat('op', ')')
      return { type: 'group', e }
    }
    if (t.type === 'func') {
      p++; eat('op', '(')
      const args = []
      skipNl()
      if (!isOp(')')) { args.push(expr(true)); while (isOp(',')) { p++; skipNl(); args.push(expr(true)) } }
      eat('op', ')')
      return { type: 'call', name: t.v, args }
    }
    if (t.type === 'name') {
      p++
      if (t.v === 'length' && !isOp('(')) return { type: 'call', name: 'length', args: [] }
      if (isOp('[')) { p++; const idx = exprList(); eat('op', ']'); return { type: 'index', name: t.v, idx } }
      return { type: 'var', name: t.v }
    }
    if (t.type === 'kw' && t.v === 'getline') { p++; return { type: 'getline', target: is('name') ? { type: 'var', name: toks[p++].v } : null } }
    fail(`「${t.v ?? t.type}」の使い方が正しくありません`)
  }
  function postfixNoIncr() {
    if (isOp('-')) { p++; return { type: 'neg', e: postfixNoIncr() } }
    if (isOp('++') || isOp('--')) { const op = toks[p++].v; return { type: 'incr', op, pre: true, target: primary() } }
    return primary()
  }
}

// ---- 実行 ----
const BUILTINS = { length: 1, substr: 1, index: 1, split: 1, sub: 1, gsub: 1, match: 1, sprintf: 1, toupper: 1, tolower: 1, int: 1, sqrt: 1, exp: 1, log: 1, sin: 1, cos: 1, atan2: 1, rand: 1, srand: 1, system: 1, close: 1, fflush: 1 }
class Next {}
class Exit { constructor(code) { this.code = code } }
class Break {}
class Continue {}
class Return { constructor(v) { this.v = v } }

const isNumStr = s => /^\s*[-+]?(\d+\.?\d*([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?|0[xX][0-9a-fA-F]+)\s*$/.test(s)
const num = v => (typeof v === 'number' ? v : typeof v === 'boolean' ? +v : (() => { const m = /^\s*[-+]?(\d+\.?\d*([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?)/.exec(String(v ?? '')); return m ? Number(m[0]) : 0 })())
function fmtNum(n, fmt = '%.6g') {
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return String(n)
  if (!isFinite(n)) return n > 0 ? 'inf' : n < 0 ? '-inf' : 'nan'
  return sprintf(fmt, [n])
}
const str = v => (typeof v === 'number' ? fmtNum(v) : String(v ?? ''))

export function sprintf(fmt, args) {
  let k = 0
  return String(fmt).replace(/%([-+ #0]*)(\*|\d+)?(?:\.(\*|\d+))?([diouxXeEfgGcs%])/g, (m, flags, w, prec, conv) => {
    if (conv === '%') return '%'
    if (w === '*') w = num(args[k++])
    if (prec === '*') prec = num(args[k++])
    const a = args[k++]
    let s
    switch (conv) {
      case 'd': case 'i': { const n = Math.trunc(num(a)); s = String(Math.abs(n)); if (prec !== undefined) s = s.padStart(Number(prec), '0'); s = (n < 0 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '') + s; break }
      case 'o': s = Math.trunc(num(a)).toString(8); break
      case 'u': s = String(Math.trunc(Math.abs(num(a)))); break
      case 'x': s = Math.trunc(num(a)).toString(16); break
      case 'X': s = Math.trunc(num(a)).toString(16).toUpperCase(); break
      case 'e': case 'E': { const n = num(a); s = n.toExponential(prec === undefined ? 6 : Number(prec)).replace(/e([+-])(\d)$/, 'e$10$2'); if (conv === 'E') s = s.toUpperCase(); if (n >= 0 && flags.includes('+')) s = '+' + s; break }
      case 'f': { const n = num(a); s = n.toFixed(prec === undefined ? 6 : Number(prec)); if (n >= 0 && flags.includes('+')) s = '+' + s; break }
      case 'g': case 'G': {
        const n = num(a), P = prec === undefined ? 6 : Number(prec) || 1
        if (n === 0) s = '0'
        else {
          const e = Math.floor(Math.log10(Math.abs(n)))
          s = e < -4 || e >= P ? n.toExponential(P - 1).replace(/e([+-])(\d)$/, 'e$10$2') : n.toFixed(Math.max(0, P - 1 - e))
          if (!flags.includes('#')) s = s.replace(/\.?0+(?=e|$)/, '').replace(/\.(?=e)/, '')
        }
        if (conv === 'G') s = s.toUpperCase()
        break
      }
      case 'c': s = typeof a === 'number' ? String.fromCharCode(a) : str(a).charAt(0); break
      default: s = str(a); if (prec !== undefined) s = s.slice(0, Number(prec))
    }
    if (w !== undefined && s.length < Number(w)) s = flags.includes('-') ? s.padEnd(Number(w)) : flags.includes('0') && /[diouxXeEfgG]/.test(conv) ? (s[0] === '-' || s[0] === '+' ? s[0] + s.slice(1).padStart(Number(w) - 1, '0') : s.padStart(Number(w), '0')) : s.padStart(Number(w))
    return s
  })
}

// awk の正規表現 → JavaScript
const reCache = new Map()
function toRe(src, flags = '') {
  const key = src + '\u0000' + flags
  let re = reCache.get(key)
  if (!re) {
    const js = String(src).replace(/\[\[:(alpha|digit|alnum|space|upper|lower|punct|xdigit|blank):\]\]/g, (m, c) => ({ alpha: '[A-Za-z]', digit: '[0-9]', alnum: '[A-Za-z0-9]', space: '\\s', upper: '[A-Z]', lower: '[a-z]', punct: '[!-/:-@[-`{-~]', xdigit: '[0-9A-Fa-f]', blank: '[ \\t]' })[c]).replace(/\[:(alpha|digit|alnum|space|upper|lower|punct|xdigit|blank):\]/g, (m, c) => ({ alpha: 'A-Za-z', digit: '0-9', alnum: 'A-Za-z0-9', space: '\\s', upper: 'A-Z', lower: 'a-z', punct: '!-/:-@[-`{-~', xdigit: '0-9A-Fa-f', blank: ' \\t' })[c])
    try { re = new RegExp(js, flags) } catch (e) { fail(`正規表現 /${src}/ が正しくありません`) }
    reCache.set(key, re)
  }
  re.lastIndex = 0
  return re
}

export async function runAwk(source, { vars = {}, fs = null, inputs, out, err = () => {}, files = {}, signal = null, system = null }) {
  const prog = parse(source)
  const G = Object.create(null)
  const arrays = Object.create(null)
  Object.assign(G, { FS: fs ?? ' ', OFS: ' ', ORS: '\n', RS: '\n', NR: 0, NF: 0, FNR: 0, FILENAME: '', SUBSEP: '\x1c', RSTART: 0, RLENGTH: -1, CONVFMT: '%.6g', OFMT: '%.6g' })
  for (const [k, v] of Object.entries(vars)) G[k] = isNumStr(v) ? v : v
  arrays.ENVIRON = Object.create(null)
  let fields = ['']
  let record = ''
  let nfDirty = false
  const outFiles = new Map()
  let steps = 0

  const splitRecord = () => {
    const fsv = str(G.FS)
    let parts
    if (record === '') parts = []
    else if (fsv === ' ') parts = record.trim().split(/[ \t\n]+/)
    else if (fsv.length === 1 && fsv !== '\\') parts = record.split(fsv)
    else parts = record.split(toRe(fsv))
    fields = [record, ...parts]
    G.NF = parts.length
  }
  const rebuild = () => { record = fields.slice(1, Number(G.NF) + 1).map(str).join(str(G.OFS)); fields[0] = record }
  const getField = i => {
    i = Math.trunc(num(i))
    if (i < 0) fail('負の番号の列 ($-1) は使えません')
    if (i === 0) return record
    const v = fields[i]
    return v === undefined ? '' : v
  }
  const setField = (i, v) => {
    i = Math.trunc(num(i))
    if (i === 0) { record = str(v); splitRecord(); return }
    while (fields.length <= i) fields.push('')
    fields[i] = v
    if (i > G.NF) G.NF = i
    rebuild()
  }
  const arr = name => { let a = arrays[name]; if (!a) { a = arrays[name] = Object.create(null); if (name in G) delete G[name] } return a }
  const key = (idx, env) => idx.map(e => str(ev(e, env))).join(str(G.SUBSEP))

  const getVar = (name, env) => {
    if (env && name in env) return env[name]
    if (name === 'NF') return G.NF
    return name in G ? G[name] : ''
  }
  const setVar = (name, v, env) => {
    if (env && name in env) { env[name] = v; return v }
    if (name === 'NF') { G.NF = Math.trunc(num(v)); fields.length = Math.min(fields.length, G.NF + 1); while (fields.length <= G.NF) fields.push(''); rebuild(); return v }
    G[name] = v
    return v
  }
  const truthy = v => (typeof v === 'number' ? v !== 0 : v instanceof Strnum ? num(v.s) !== 0 : v !== '')
  const lvalueGet = (t, env) => (t.type === 'var' ? getVar(t.name, env) : t.type === 'field' ? getField(ev(t.e, env)) : (() => { const a = env && env[t.name] && typeof env[t.name] === 'object' ? env[t.name] : arr(t.name); const k = key(t.idx, env); return k in a ? a[k] : (a[k] = '') })())
  const lvalueSet = (t, v, env) => {
    if (t.type === 'var') return setVar(t.name, v, env)
    if (t.type === 'field') { setField(ev(t.e, env), v); return v }
    const a = env && env[t.name] && typeof env[t.name] === 'object' ? env[t.name] : arr(t.name)
    a[key(t.idx, env)] = v
    return v
  }
  // 入力から来た数らしい文字は、比べるときに数として扱う
  class Strnum { constructor(s) { this.s = s } toString() { return this.s } }
  const val = v => (v instanceof Strnum ? v.s : v)
  const cmpVals = (a, b) => {
    const an = typeof a === 'number' || (a instanceof Strnum && isNumStr(a.s)) || (typeof a === 'string' && false)
    const bn = typeof b === 'number' || (b instanceof Strnum && isNumStr(b.s))
    if (an && bn) { const x = num(val(a)), y = num(val(b)); return x < y ? -1 : x > y ? 1 : 0 }
    const x = str(val(a)), y = str(val(b))
    return x < y ? -1 : x > y ? 1 : 0
  }
  const fieldVal = v => (typeof v === 'string' && isNumStr(v) ? new Strnum(v) : v)

  function ev(e, env) {
    switch (e.type) {
      case 'num': return e.v
      case 'str': return e.v
      case 'regex': return toRe(e.v).test(record) ? 1 : 0
      case 'group': return ev(e.e, env)
      case 'var': { const v = getVar(e.name, env); return typeof v === 'string' && (e.name === 'NR' || e.name === 'NF') ? num(v) : fieldVal(v) }
      case 'field': return fieldVal(getField(num(val(ev(e.e, env)))))
      case 'index': { const v = lvalueGet(e, env); return fieldVal(v) }
      case 'assign': {
        let v = e.op === '=' ? ev(e.v, env) : val(ev(e.v, env))
        if (e.op !== '=') { const cur = num(val(lvalueGet(e.target, env))); const r = num(v); v = e.op === '+=' ? cur + r : e.op === '-=' ? cur - r : e.op === '*=' ? cur * r : e.op === '/=' ? (r === 0 ? fail('0 で割りました') : cur / r) : e.op === '%=' ? cur % r : Math.pow(cur, r) }
        return lvalueSet(e.target, v, env)
      }
      case 'cond': return truthy(ev(e.c, env)) ? ev(e.a, env) : ev(e.b, env)
      case 'or': return truthy(ev(e.l, env)) || truthy(ev(e.r, env)) ? 1 : 0
      case 'and': return truthy(ev(e.l, env)) && truthy(ev(e.r, env)) ? 1 : 0
      case 'in': { const a = env && env[e.arr] && typeof env[e.arr] === 'object' ? env[e.arr] : arr(e.arr); return key(e.key, env) in a ? 1 : 0 }
      case 'match': { const r = e.r.type === 'regex' ? toRe(e.r.v) : toRe(str(val(ev(e.r, env)))); const m = r.test(str(val(ev(e.l, env)))); return (e.neg ? !m : m) ? 1 : 0 }
      case 'cmp': {
        const c = cmpVals(ev(e.l, env), ev(e.r, env))
        return ({ '<': c < 0, '<=': c <= 0, '==': c === 0, '!=': c !== 0, '>=': c >= 0, '>': c > 0 })[e.op] ? 1 : 0
      }
      case 'concat': return str(val(ev(e.l, env))) + str(val(ev(e.r, env)))
      case 'bin': {
        const a = num(val(ev(e.l, env))), b = num(val(ev(e.r, env)))
        switch (e.op) {
          case '+': return a + b
          case '-': return a - b
          case '*': return a * b
          case '/': if (b === 0) fail('0 で割りました'); return a / b
          case '%': if (b === 0) fail('0 で割りました'); return a % b
          case '^': return Math.pow(a, b)
        }
        break
      }
      case 'not': return truthy(ev(e.e, env)) ? 0 : 1
      case 'neg': return -num(val(ev(e.e, env)))
      case 'pos': return num(val(ev(e.e, env)))
      case 'incr': {
        const cur = num(val(lvalueGet(e.target, env)))
        const nv = e.op === '++' ? cur + 1 : cur - 1
        lvalueSet(e.target, nv, env)
        return e.pre ? nv : cur
      }
      case 'call': return call(e, env)
      case 'getline': return 0
    }
    fail('計算できない式です')
  }

  function call(e, env) {
    const a = i => (e.args[i] ? val(ev(e.args[i], env)) : undefined)
    switch (e.name) {
      case 'length': {
        if (!e.args.length) return record.length
        const x = e.args[0]
        if (x.type === 'var' && (arrays[x.name] || (env && env[x.name] && typeof env[x.name] === 'object'))) return Object.keys(env && env[x.name] && typeof env[x.name] === 'object' ? env[x.name] : arrays[x.name]).length
        return str(a(0)).length
      }
      case 'substr': {
        const s = str(a(0))
        let m = Math.round(num(a(1)))
        let n = e.args.length > 2 ? Math.round(num(a(2))) : Infinity
        if (m < 1) { n += m - 1; m = 1 }
        if (n <= 0) return ''
        return s.substr(m - 1, n === Infinity ? undefined : n)
      }
      case 'index': return str(a(0)).indexOf(str(a(1))) + 1
      case 'split': {
        const s = str(a(0))
        const target = e.args[1]
        const t = env && env[target.name] && typeof env[target.name] === 'object' ? env[target.name] : arr(target.name)
        for (const k of Object.keys(t)) delete t[k]
        const sep = e.args.length > 2 ? (e.args[2].type === 'regex' ? e.args[2].v : str(a(2))) : str(G.FS)
        const parts = s === '' ? [] : sep === ' ' ? s.trim().split(/[ \t\n]+/) : sep.length === 1 && !e.args[2]?.type?.startsWith('regex') ? s.split(sep) : s.split(toRe(sep))
        parts.forEach((v, i) => { t[String(i + 1)] = v })
        return parts.length
      }
      case 'sub': case 'gsub': {
        const re = e.args[0].type === 'regex' ? toRe(e.args[0].v, e.name === 'gsub' ? 'g' : '') : toRe(str(a(0)), e.name === 'gsub' ? 'g' : '')
        const repl = str(a(1))
        const target = e.args[2] || { type: 'field', e: { type: 'num', v: 0 } }
        const cur = str(val(lvalueGet(target, env)))
        let count = 0
        const res = cur.replace(re, m => { count++; return repl.replace(/\\\\&|\\&|&/g, x => (x === '&' ? m : x === '\\&' ? '&' : '\\')) })
        if (count) lvalueSet(target, res, env)
        return count
      }
      case 'match': {
        const re = e.args[1].type === 'regex' ? toRe(e.args[1].v) : toRe(str(a(1)))
        const m = re.exec(str(a(0)))
        G.RSTART = m ? m.index + 1 : 0
        G.RLENGTH = m ? m[0].length : -1
        if (m && e.args[2]) { const t = arr(e.args[2].name); for (const k of Object.keys(t)) delete t[k]; m.forEach((v, i) => { t[String(i)] = v ?? '' }) }
        return G.RSTART
      }
      case 'sprintf': return sprintf(str(a(0)), e.args.slice(1).map(x => val(ev(x, env))))
      case 'toupper': return str(a(0)).toUpperCase()
      case 'tolower': return str(a(0)).toLowerCase()
      case 'int': return Math.trunc(num(a(0)))
      case 'sqrt': return Math.sqrt(num(a(0)))
      case 'exp': return Math.exp(num(a(0)))
      case 'log': return Math.log(num(a(0)))
      case 'sin': return Math.sin(num(a(0)))
      case 'cos': return Math.cos(num(a(0)))
      case 'atan2': return Math.atan2(num(a(0)), num(a(1)))
      case 'rand': return Math.random()
      case 'srand': return 0
      case 'close': case 'fflush': return 0
      case 'system': { if (system) system(str(a(0))); return 0 }
    }
    const f = prog.funcs[e.name]
    if (!f) fail(`関数 ${e.name} がありません`)
    const local = Object.create(null)
    f.params.forEach((p, i) => {
      const arg = e.args[i]
      if (arg && arg.type === 'var' && (arrays[arg.name] || (env && env[arg.name] && typeof env[arg.name] === 'object'))) local[p] = env && env[arg.name] && typeof env[arg.name] === 'object' ? env[arg.name] : arrays[arg.name]
      else local[p] = arg ? val(ev(arg, env)) : ''
    })
    // 配列として使われる引数は、空の配列を用意
    try { exec(f.body, local) } catch (x) { if (x instanceof Return) return x.v; throw x }
    return ''
  }

  function emit(text, redir, env) {
    if (!redir) { out(text); return }
    const name = str(val(ev(redir.target, env)))
    if (redir.op === '|') { if (system) system(name, text); return }
    if (name === '/dev/stderr') { err(text); return }
    if (name === '/dev/stdout' || name === '-') { out(text); return }
    let f = outFiles.get(name)
    if (!f) { f = { append: redir.op === '>>', buf: [] }; outFiles.set(name, f) }
    f.buf.push(text)
  }

  function exec(s, env) {
    if (++steps % 5000 === 0 && signal && signal.aborted) throw Object.assign(new Error('止めました'), { name: 'AbortError' })
    switch (s.type) {
      case 'block': for (const x of s.body) exec(x, env); return
      case 'expr': ev(s.e, env); return
      case 'print': {
        const parts = s.args.length ? s.args.map(a => { const v = val(ev(a, env)); return typeof v === 'number' ? fmtNum(v, str(G.OFMT)) : str(v) }) : [record]
        emit(parts.join(str(G.OFS)) + str(G.ORS), s.redir, env)
        return
      }
      case 'printf': {
        if (!s.args.length) fail('printf の後に書式を書いてください')
        emit(sprintf(str(val(ev(s.args[0], env))), s.args.slice(1).map(a => val(ev(a, env)))), s.redir, env)
        return
      }
      case 'if': if (truthy(ev(s.cond, env))) exec(s.then, env); else if (s.otherwise) exec(s.otherwise, env); return
      case 'while': while (truthy(ev(s.cond, env))) { try { exec(s.body, env) } catch (x) { if (x instanceof Break) break; if (x instanceof Continue) continue; throw x } } return
      case 'do': do { try { exec(s.body, env) } catch (x) { if (x instanceof Break) break; if (x instanceof Continue) continue; throw x } } while (truthy(ev(s.cond, env))); return
      case 'for':
        for (s.init && exec(s.init, env); s.cond ? truthy(ev(s.cond, env)) : true; s.step && exec(s.step, env)) {
          try { exec(s.body, env) } catch (x) { if (x instanceof Break) break; if (x instanceof Continue) continue; throw x }
        }
        return
      case 'forin': {
        const a = env && env[s.arr] && typeof env[s.arr] === 'object' ? env[s.arr] : arr(s.arr)
        for (const k of Object.keys(a)) {
          if (!(k in a)) continue
          if (env && s.v in env) env[s.v] = k; else G[s.v] = k
          try { exec(s.body, env) } catch (x) { if (x instanceof Break) break; if (x instanceof Continue) continue; throw x }
        }
        return
      }
      case 'delete': { const a = env && env[s.name] && typeof env[s.name] === 'object' ? env[s.name] : arr(s.name); if (s.idx) delete a[key(s.idx, env)]; else for (const k of Object.keys(a)) delete a[k]; return }
      case 'break': throw new Break()
      case 'continue': throw new Continue()
      case 'next': throw new Next()
      case 'exit': throw new Exit(s.v ? Math.trunc(num(val(ev(s.v, env)))) : 0)
      case 'return': throw new Return(s.v ? val(ev(s.v, env)) : '')
    }
  }

  let code = 0
  try {
    try { for (const b of prog.begin) exec(b, null) } catch (x) { if (x instanceof Exit) { code = x.code; throw x } throw x }
    if (prog.rules.length || prog.end.length) {
      for (const input of inputs) {
        G.FILENAME = input.name === '-' ? '' : input.name
        G.FNR = 0
        const text = input.text
        const recs = text === '' ? [] : str(G.RS) === '' ? text.split(/\n\n+/).filter(Boolean) : text.replace(/\n$/, '').split(str(G.RS) === '\n' ? '\n' : toRe(str(G.RS)))
        for (const r of recs) {
          if (signal && signal.aborted) throw Object.assign(new Error('止めました'), { name: 'AbortError' })
          G.NR = num(G.NR) + 1
          G.FNR = num(G.FNR) + 1
          record = r
          splitRecord()
          try {
            for (const rule of prog.rules) {
              let hit
              if (rule.pattern2) {
                if (rule.inRange) { hit = true; if (truthy(ev(rule.pattern2, null))) rule.inRange = false }
                else if (truthy(ev(rule.pattern, null))) { hit = true; rule.inRange = !truthy(ev(rule.pattern2, null)) }
              } else hit = !rule.pattern || truthy(ev(rule.pattern, null))
              if (!hit) continue
              if (rule.action) exec(rule.action, null)
              else out(record + str(G.ORS))
            }
          } catch (x) { if (x instanceof Next) continue; throw x }
        }
      }
    }
    for (const b of prog.end) exec(b, null)
  } catch (x) {
    if (x instanceof Exit) {
      code = x.code
      try { for (const b of prog.end) exec(b, null) } catch (y) { if (!(y instanceof Exit)) throw y }
    } else if (x instanceof AwkError) { err(`awk: ${x.message}\n`); return 2 }
    else throw x
  }
  for (const [name, f] of outFiles) files[name] = f
  void nfDirty
  return code
}

export { AwkError, parse as parseAwk }
