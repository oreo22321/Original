// Forge AI: Python のコードを直す
// ・repairSyntax: 構文エラーを 1 つずつ直す (コロン忘れ・全角記号・括弧・字下げ・print 文・他の言語の書き方 など)
// ・fixAll: 構文 + 定義されていない名前 (打ち間違い・import 忘れ) + is と == など
// ・modernize: 古い書き方・よくない書き方を新しい書き方に (== None → is None、% → f-string など)
// ・formatCode: autopep8 で PEP 8 に整形
// Python の解析は pytools ワーカー (py(type, args) → Promise) で行います
import { fixFullwidth, similarNames, editDistance, STDLIB, ALIASES, TYPOS } from '../editor/pyfix.js'
import { applyEdits, blankStrings } from './pycode.js'

export async function lint(py, code) {
  try { return (await py('lint', { code, path: 'main.py' })) || [] } catch { return [] }
}
// 構文エラー (なければ null)
export async function syntaxError(py, code) {
  const list = await lint(py, code)
  return list.find(d => d.severity === 'error') || null
}

const lines = t => t.split('\n')
const setLine = (text, n, fn) => {
  const ls = lines(text)
  if (n < 1 || n > ls.length) return null
  const next = fn(ls[n - 1], ls, n - 1)
  if (next === null || next === undefined || next === ls[n - 1]) return null
  ls[n - 1] = next
  return ls.join('\n')
}
const indentOf = s => /^[ \t]*/.exec(s)[0]
const prevCode = (ls, i) => { for (let k = i - 1; k >= 0; k--) if (ls[k].trim() && !/^\s*#/.test(ls[k])) return k; return -1 }
const HEADER = /^\s*(if|elif|else|for|while|def|class|try|except|finally|with|async\s+def|async\s+for|async\s+with|match|case)\b/

// ============================================================
// 他の言語の書き方・よくある打ち間違い (Python を使わずに直せるもの)
// ============================================================
export function prefix(src) {
  const fixes = []
  let text = src
  // 全角記号・スマート引用符
  const fw = fixFullwidth(text).replace(/[​﻿]/g, '')
  if (fw !== text) { fixes.push({ line: 0, why: '全角の記号を半角に直しました' }); text = fw }
  const out = []
  const ls = lines(text)
  for (let i = 0; i < ls.length; i++) {
    let l = ls[i]
    const code = blankStrings(l)
    const before = l
    const why = []
    // 行末の ;
    if (/;\s*$/.test(code) && !/;\s*\S/.test(code.replace(/;\s*$/, ''))) { l = l.replace(/;(\s*)$/, '$1'); why.push('行末の ; を消しました') }
    // // コメント → #
    if (/^\s*\/\//.test(code)) { l = l.replace(/^(\s*)\/\/\s?/, '$1# '); why.push('// のコメントを # にしました') }
    // else if → elif
    if (/^\s*else\s+if\b/.test(code)) { l = l.replace(/^(\s*)else\s+if\b/, '$1elif'); why.push('else if を elif にしました') }
    // && || ! → and or not
    if (/&&|\|\|/.test(code)) { l = replaceInCode(l, /\s*&&\s*/g, ' and '); l = replaceInCode(l, /\s*\|\|\s*/g, ' or '); why.push('&& / || を and / or にしました') }
    if (/(^|[\s(])!(?!=)\s*[A-Za-z_(]/.test(blankStrings(l))) { l = replaceInCode(l, /(^|[\s(])!(?!=)\s*/g, '$1not '); why.push('! を not にしました') }
    // i++ / i--
    if (/^\s*[A-Za-z_][\w.]*(\+\+|--)\s*$/.test(code)) { l = l.replace(/^(\s*)([A-Za-z_][\w.]*)(\+\+|--)\s*$/, (m, ind, v, op) => `${ind}${v} ${op[0]}= 1`); why.push('++ / -- を += 1 / -= 1 にしました') }
    // { で始まるブロック: if (x) { → if x:
    if (HEADER.test(code) && /\)?\s*\{\s*$/.test(code)) {
      l = l.replace(/\s*\{\s*$/, '')
      const m = /^(\s*(?:if|elif|while)\s*)\((.*)\)\s*$/.exec(l)
      if (m && !/[()]/.test(m[2].replace(/\([^()]*\)/g, ''))) l = `${m[1].replace(/\s*$/, ' ')}${m[2]}`
      if (!/:\s*$/.test(l)) l += ':'
      why.push('{ } のブロックを : と字下げの書き方にしました')
    } else if (/^\s*\}\s*(else\s*\{?)?\s*$/.test(code)) {
      // 閉じ括弧だけの行
      const els = /else/.test(code)
      if (els) { l = indentOf(l) + 'else:'; why.push('} else { を else: にしました') } else { why.push('} だけの行を消しました'); out.push(null); continue }
    }
    // function → def
    if (/^\s*function\s+\w+\s*\(.*\)\s*\{?\s*:?\s*$/.test(code)) { l = l.replace(/^(\s*)function\s+/, '$1def ').replace(/\s*\{?\s*:?\s*$/, ':'); why.push('function を def にしました') }
    // print "x" (Python 2)
    if (/^\s*print\s+[^(=\s]/.test(code) && !/^\s*print\s*\(/.test(code)) { l = l.replace(/^(\s*)print\s+(.*?)\s*$/, '$1print($2)'); why.push('print を関数の形 print(…) にしました') }
    // Python 2 の書き方
    if (/\braw_input\s*\(/.test(code)) { l = replaceInCode(l, /\braw_input\s*\(/g, 'input('); why.push('raw_input を input にしました') }
    if (/\bxrange\s*\(/.test(code)) { l = replaceInCode(l, /\bxrange\s*\(/g, 'range('); why.push('xrange を range にしました') }
    if (/^\s*except\s+([\w.]+)\s*,\s*(\w+)\s*:/.test(code)) { l = l.replace(/^(\s*except\s+[\w.]+)\s*,\s*(\w+)\s*:/, '$1 as $2:'); why.push('except E, e を except E as e にしました') }
    if (/<>/.test(code)) { l = replaceInCode(l, /<>/g, '!='); why.push('<> を != にしました') }
    if (l !== before) for (const w of why) fixes.push({ line: i + 1, why: w })
    out.push(l)
  }
  const joined = out.filter(l => l !== null).join('\n')
  return { text: joined, fixes }
}
// 文字列・コメントの外だけ置き換える (re に g がなければ最初の 1 つだけ。rep の $1 などは元の行の文字)
export function replaceInCode(line, re, rep) {
  const mask = blankStrings(line)
  const once = !re.flags.includes('g')
  const g = new RegExp(re.source, (once ? re.flags + 'g' : re.flags) + (re.flags.includes('d') ? '' : 'd'))
  let out = '', last = 0, m
  while ((m = g.exec(mask))) {
    const groups = m.indices.map(ix => (ix ? line.slice(ix[0], ix[1]) : ''))
    out += line.slice(last, m.index) + rep.replace(/\$(\d)/g, (_, k) => groups[+k] ?? '')
    last = m.index + m[0].length
    if (!m[0].length) g.lastIndex++
    if (once) break
  }
  return out + line.slice(last)
}

// ============================================================
// 構文エラーを 1 つ直す (直せなければ null)
// ============================================================
function fixOne(text, err) {
  const msg = err.msg || ''
  const n = err.line || 1
  const ls = lines(text)
  const line = ls[n - 1] ?? ''
  let m
  if (/expected ':'/.test(msg)) {
    // 見出しの行の最後に :
    let k = n - 1
    if (!HEADER.test(ls[k] || '')) { const p = prevCode(ls, k + 1); if (p >= 0 && HEADER.test(ls[p])) k = p }
    const t = setLine(text, k + 1, l => { const c = /\s*(#.*)?$/.exec(l); return l.slice(0, c.index) + ':' + (c[1] ? '  ' + c[1] : '') })
    if (t) return { text: t, why: "行の最後に ':' を付けました", line: k + 1 }
  }
  if (/Missing parentheses in call to 'print'/.test(msg)) {
    const t = setLine(text, n, l => l.replace(/^(\s*)print\s+(.*?)\s*$/, '$1print($2)'))
    if (t) return { text: t, why: 'print を print(…) にしました', line: n }
  }
  if (/Maybe you meant '==' or ':=' instead of '='/.test(msg) || (/invalid syntax/.test(msg) && /^\s*(if|elif|while)\b[^=]*[^=!<>:]=[^=]/.test(line))) {
    const t = setLine(text, n, l => replaceInCode(l, /([^=!<>:])=(?!=)/, '$1=='))
    if (t) return { text: t, why: "比較の '=' を '==' にしました", line: n }
  }
  if (/^invalid character|^invalid non-printable character/.test(msg)) {
    const t = setLine(text, n, l => fixFullwidth(l).replace(/[​ ﻿　]/g, ' '))
    if (t) return { text: t, why: '使えない文字 (全角記号など) を直しました', line: n }
  }
  if (/^unexpected indent$/.test(msg)) {
    const p = prevCode(ls, n - 1)
    const ind = p >= 0 ? (/:\s*(#.*)?$/.test(ls[p]) ? indentOf(ls[p]) + '    ' : indentOf(ls[p])) : ''
    const t = setLine(text, n, l => ind + l.trimStart())
    if (t) return { text: t, why: '余分な字下げを直しました', line: n }
  }
  if (/^expected an indented block/.test(msg)) {
    const base = /on line (\d+)$/.exec(msg)
    const head = base ? Number(base[1]) : prevCode(ls, n - 1) + 1
    const ind = indentOf(ls[head - 1] || '') + '    '
    const cur = ls[n - 1]
    // 中身がない (ファイルの終わり・すぐに else などが続く) → pass を入れる。それ以外は、字下げを忘れた行を下げる
    if (cur === undefined || !cur.trim() || /^\s*(elif|else|except|finally|case)\b/.test(cur)) {
      ls.splice(head, 0, ind + 'pass')
      return { text: ls.join('\n'), why: `${head} 行目のブロックの中身が空なので pass を入れました`, line: head + 1 }
    }
    const t = setLine(text, n, l => ind + l.trimStart())
    if (t) return { text: t, why: `${head} 行目の次の行を字下げしました`, line: n }
  }
  if (/^unindent does not match|^inconsistent use of tabs/.test(msg)) {
    const fixed = text.replace(/^[ \t]+/gm, x => x.replace(/\t/g, '    '))
    if (fixed !== text) return { text: fixed, why: 'タブをスペース 4 つにそろえました', line: n }
    // 前の行のどれかの深さにそろえる
    const want = indentOf(line).length
    let best = ''
    for (let k = n - 2; k >= 0; k--) { const l = ls[k]; if (!l.trim()) continue; const d = indentOf(l); if (d.length <= want && d.length >= best.length) { best = d; if (d.length === want) break } if (d.length === 0) break }
    const t = setLine(text, n, l => best + l.trimStart())
    if (t) return { text: t, why: '字下げの深さを前の行にそろえました', line: n }
  }
  if ((m = /^'(\(|\[|\{)' was never closed$/.exec(msg))) {
    const close = { '(': ')', '[': ']', '{': '}' }[m[1]]
    const t = setLine(text, n, l => { const c = /\s*(:?)\s*(#.*)?$/.exec(l); return l.slice(0, c.index) + close + (c[1] || '') + (c[2] ? '  ' + c[2] : '') })
    if (t) return { text: t, why: `閉じていない '${m[1]}' に '${close}' を付けました`, line: n }
  }
  if ((m = /^unmatched '(\)|\]|\})'$/.exec(msg))) {
    const ch = m[1]
    const t = setLine(text, n, l => { const at = l.indexOf(ch, Math.max(0, (err.col || 1) - 1)); const pos = at >= 0 ? at : l.lastIndexOf(ch); return pos >= 0 ? l.slice(0, pos) + l.slice(pos + 1) : null })
    if (t) return { text: t, why: `余分な '${ch}' を消しました`, line: n }
  }
  if ((m = /^closing parenthesis '(.)' does not match opening parenthesis '(.)'/.exec(msg))) {
    const close = { '(': ')', '[': ']', '{': '}' }[m[2]]
    const t = setLine(text, n, l => { const at = l.indexOf(m[1], Math.max(0, (err.col || 1) - 1)); return at >= 0 ? l.slice(0, at) + close + l.slice(at + 1) : null })
    if (t) return { text: t, why: `閉じ括弧 '${m[1]}' を '${close}' にしました`, line: n }
  }
  if (/^unterminated string literal/.test(msg)) {
    const t = setLine(text, n, l => closeString(l, (err.col || 1) - 1))
    if (t) return { text: t, why: '閉じていない文字列に引用符を付けました', line: n }
  }
  if (/^unterminated triple-quoted string literal/.test(msg)) {
    const q = line.includes('"""') ? '"""' : "'''"
    return { text: text.replace(/\n*$/, '') + '\n' + q + '\n', why: `閉じていない ${q} を最後に付けました`, line: n }
  }
  if (/invalid syntax\. Perhaps you forgot a comma\?/.test(msg)) {
    // [1 2 3] / f(a b) → カンマを入れる (名前・数・文字列が空白で並んでいるところ)
    const t = setLine(text, n, l => replaceInCode(l, /([\w"')\]])\s+(?=[\w"'([])(?!(?:and|or|not|in|is|if|else|for|lambda)\b)/g, '$1, '))
    if (t && t !== text) return { text: t, why: 'カンマを補いました', line: n }
  }
  if (/^'(return|yield)' outside function$/.test(msg)) return null
  return null
}

// 閉じていない文字列を閉じる。print("abc) のように、行の最後の閉じ括弧が文字列の外のものなら、その手前で閉じる
function closeString(l, col) {
  let at = col >= 0 && /["']/.test(l[col] || '') ? col : -1
  if (at < 0) { const m = /(?:^|[^\w])[rbfuRBFU]{0,2}(["'])[^"']*$/.exec(l); if (!m) return null; at = m.index + m[0].indexOf(m[1]) }
  const q = l[at]
  const head = l.slice(0, at), body = l.slice(at + 1).replace(/\s*$/, '')
  let depth = 0
  for (const c of blankStrings(head)) { if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth-- }
  const tail = /[)\]}:,\s]*$/.exec(body)[0]
  const closers = (tail.match(/[)\]}]/g) || []).length
  if (depth > 0 && closers && closers <= depth && body.length > tail.length) {
    const cut = body.length - tail.length
    return head + q + body.slice(0, cut) + q + body.slice(cut)
  }
  return head + q + body + q
}

// ============================================================
// まとめて
// ============================================================
export async function repairSyntax(py, src, { maxSteps = 24 } = {}) {
  const pre = prefix(src)
  let text = pre.text
  const fixes = [...pre.fixes]
  let err = await syntaxError(py, text)
  for (let i = 0; err && i < maxSteps; i++) {
    const r = fixOne(text, err)
    if (!r || r.text === text) break
    const next = await syntaxError(py, r.text)
    // 同じ行で同じエラーが続くなら、それ以上は直さない
    if (next && next.line === err.line && next.msg === err.msg && i > 2) { text = r.text; fixes.push({ line: r.line, why: r.why }); err = next; break }
    text = r.text
    fixes.push({ line: r.line, why: r.why })
    err = next
  }
  return { text, fixes, ok: !err, error: err ? { line: err.line, message: err.msg } : null }
}

// 定義されていない名前 (打ち間違い・import 忘れ) と、is と == の間違い
export async function lintFixes(py, src) {
  let text = src
  const fixes = []
  for (let round = 0; round < 3; round++) {
    const list = await lint(py, text)
    if (list.some(d => d.severity === 'error')) break
    const imports = new Set()
    const edits = []
    const codeAll = text
    for (const d of list) {
      const name = (d.args || [])[0]
      if (d.kind === 'UndefinedName' && name) {
        const fix = { true: 'True', false: 'False', null: 'None', none: 'None', nil: 'None', TRUE: 'True', FALSE: 'False' }[name]
        const imp = ALIASES[name] || (STDLIB.has(name) ? `import ${name}` : null)
        if (fix) edits.push({ d, name, to: fix, why: `${name} を ${fix} にしました` })
        else if (imp) imports.add(imp)
        else {
          const best = bestName(name, codeAll)
          if (best) edits.push({ d, name, to: best, why: `${name} を ${best} にしました (打ち間違い)` })
        }
      } else if (d.kind === 'IsLiteral') {
        edits.push({ d, line: true, why: "数値・文字列との比較の 'is' を '==' にしました" })
      }
    }
    if (!edits.length && !imports.size) break
    const ls = lines(text)
    // 後ろから (同じ行の位置がずれないように)
    for (const e of edits.sort((a, b) => b.d.line - a.d.line || b.d.col - a.d.col)) {
      const i = e.d.line - 1
      if (e.line) { ls[i] = replaceInCode(ls[i], /\bis not\b/, '!='); ls[i] = replaceInCode(ls[i], /\bis\b/, '=='); fixes.push({ line: e.d.line, why: e.why }); continue }
      const l = ls[i]
      const at = l.slice((e.d.col || 1) - 1).search(new RegExp(`\\b${e.name}\\b`))
      if (at < 0) continue
      const pos = (e.d.col || 1) - 1 + at
      ls[i] = l.slice(0, pos) + e.to + l.slice(pos + e.name.length)
      fixes.push({ line: e.d.line, why: e.why })
    }
    text = ls.join('\n')
    if (imports.size) {
      const at = importPos(text)
      const all = [...imports]
      text = text.slice(0, at) + all.join('\n') + '\n' + text.slice(at)
      for (const imp of all) fixes.push({ line: 1, why: `${imp} を追加しました` })
    }
  }
  return { text, fixes }
}
// 打ち間違いの直し先 (よくある打ち間違い → 似た名前のうち、ほかより明らかに近いもの)
const KEYWORDS = /^(import|return|else|elif|while|class|def|for|in|if|from|pass|break|continue|lambda|with|try|except|finally|raise|global|yield)$/
function bestName(name, code) {
  const t = TYPOS[name]
  if (t && !KEYWORDS.test(t)) return t
  const cands = similarNames(name, code)
  if (!cands.length) return null
  if (cands.length === 1 || cands[0].toLowerCase() === name.toLowerCase()) return cands[0]
  const d0 = editDistance(name, cands[0], 4), d1 = editDistance(name, cands[1], 4)
  return d0 < d1 ? cands[0] : null
}
function importPos(text) {
  const ls = lines(text)
  let pos = 0, off = 0
  for (let i = 0; i < ls.length; i++) {
    const t = ls[i]
    if (/^\s*(import|from)\s/.test(t)) pos = off + t.length + 1
    else if (!(/^\s*(#|$)/.test(t) || (i === 0 && /^\s*("""|''')/.test(t)))) break
    off += t.length + 1
  }
  return Math.min(pos, text.length)
}

export async function fixAll(py, src) {
  const r = await repairSyntax(py, src)
  if (!r.ok) return r
  const l = await lintFixes(py, r.text)
  return { text: l.text, fixes: [...r.fixes, ...l.fixes], ok: true, error: null }
}

// ============================================================
// 新しい書き方に (動きは変えない)
// ============================================================
const MODERN_KINDS = { eq_none: 'None との比較を is / is not に', eq_bool: 'True / False との比較を、そのままの条件に', type_eq: 'type(x) == T を isinstance(x, T) に', len_zero: 'len(x) == 0 を not x に', open_encoding: 'open に encoding="utf-8" を付けました' }
export async function modernize(py, src) {
  const fixes = []
  let text = src
  // % と .format() の簡単なものを f-string に
  text = text.split('\n').map((l, i) => {
    const before = l
    l = l.replace(/(["'])((?:(?!\1)[^\\{}])*)\1\s*%\s*\(([^()]*)\)/g, (m, q, body, args) => {
      const parts = args.split(',').map(s => s.trim()).filter(Boolean)
      const holes = body.match(/%[sd]/g) || []
      if (holes.length !== parts.length || /%[^sd%]/.test(body)) return m
      let k = 0
      return 'f' + q + body.replace(/%[sd]/g, () => `{${parts[k++]}}`) + q
    }).replace(/(["'])((?:(?!\1)[^\\])*)\1\s*%\s*([A-Za-z_][\w.]*)\b(?!\s*[([])/g, (m, q, body, v) => {
      const holes = body.match(/%[sd]/g) || []
      if (holes.length !== 1 || /%[^sd%]/.test(body) || /[{}]/.test(body)) return m
      return 'f' + q + body.replace(/%[sd]/, `{${v}}`) + q
    }).replace(/(["'])((?:(?!\1)[^\\])*)\1\.format\(([^()]*)\)/g, (m, q, body, args) => {
      const parts = args.split(',').map(s => s.trim()).filter(Boolean)
      if (parts.some(p => /=/.test(p))) return m
      const holes = body.match(/\{\}/g) || []
      if (holes.length !== parts.length || /\{[^}]/.test(body)) return m
      let k = 0
      return 'f' + q + body.replace(/\{\}/g, () => `{${parts[k++]}}`) + q
    })
    l = concatToFstring(l)
    if (l !== before) fixes.push({ line: i + 1, why: '文字列の組み立てを f-string にしました' })
    return l
  }).join('\n')
  // ast で見つけたもの
  let rv
  try { rv = await py('review', { code: text }) } catch { rv = null }
  if (rv && rv.ok) {
    const edits = []
    for (const f of rv.findings) {
      if (!MODERN_KINDS[f.kind] || !f.edits) continue
      edits.push(...f.edits)
      fixes.push({ line: f.line, why: MODERN_KINDS[f.kind] })
    }
    if (edits.length) text = applyEdits(text, edits).text
  }
  // 壊れていないか
  if (await syntaxError(py, text)) return { text: src, fixes: [] }
  return { text, fixes }
}

// "Hello " + name + "!" → f"Hello {name}!" (文字列のリテラルを含む + だけの式。str(x) は {x} に)
const OPERAND = String.raw`(?:"(?:[^"\\{}\n]|\\.)*"|'(?:[^'\\{}\n]|\\.)*'|str\([A-Za-z_][\w.]*\)|[A-Za-z_][\w.]*(?:\[[^\[\]\n]*\])?)`
const CHAIN = new RegExp(String.raw`(^|[=(,:]\s*|\breturn\s+|^\s*)(${OPERAND}(?:\s*\+\s*${OPERAND})+)(?=\s*(?:[),\]]|#|$))`, 'g')
function concatToFstring(line) {
  const mask = blankStrings(line)
  return line.replace(CHAIN, (m, lead, chain, offset) => {
    const at = offset + lead.length
    if (mask[at] !== line[at]) return m
    const ops = []
    const re = new RegExp(OPERAND, 'y')
    let i = 0
    while (i < chain.length) {
      re.lastIndex = i
      const o = re.exec(chain)
      if (!o) return m
      ops.push(o[0])
      i = re.lastIndex
      const sep = /^\s*\+\s*/.exec(chain.slice(i))
      if (sep) i += sep[0].length
      else if (i < chain.length) return m
    }
    const lits = ops.filter(o => /^["']/.test(o))
    if (!lits.length || lits.length === ops.length || ops.length < 2) return m
    if (/^(True|False|None|and|or|not|in|is|if|else)$/.test(ops.find(o => !/^["']/.test(o)))) return m
    const inner = lits.map(o => o.slice(1, -1))
    const q = inner.some(t => t.includes('"')) ? (inner.some(t => t.includes("'")) ? null : "'") : '"'
    if (!q) return m
    const body = ops.map(o => (/^["']/.test(o) ? o.slice(1, -1).replace(/\\(["'])/g, (x, c) => (c === q ? x : c)) : `{${o.replace(/^str\((.*)\)$/, '$1')}}`)).join('')
    return lead + 'f' + q + body + q
  })
}

export async function formatCode(py, src, { aggressive = true } = {}) {
  try {
    const out = await py('format', { code: src, aggressive })
    return typeof out === 'string' ? out : src
  } catch { return src }
}

// レビューの直し方をまとめて適用
export function applyFindingEdits(text, findings) {
  const edits = findings.flatMap(f => f.edits || [])
  return edits.length ? applyEdits(text, edits).text : text
}
