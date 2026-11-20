// ForgeCode のターミナル: シェル (コマンドの解釈と実行)
// ・bash に近い書き方: パイプ (|)・リダイレクト (> >> < 2> 2>&1 &>)・&& || ;・"…" '…'・$変数・$(コマンド)・* ? [..]・~
// ・ファイルはプロジェクトのファイルです (~ と / はプロジェクトの一番上)
// ・python / pip はアプリの Python (Pyodide) で動きます
// ・画面 (terminal.js) とは切り離してあるので、Node のテストでもそのまま動きます (host を差し替える)
//
// host: {
//   files() → [{ path, dir, size, mtime }]         プロジェクトのファイル (パスは一番上から)
//   read(path) → 中身 | null / write(path, text) / mkdir(path) / remove(path) / rename(from, to) / changed()
//   python({ entry, source, argv, cwd, stdin, out, err, tty, signal, input }) → 終了コード
//   pip(args, ctx) → 終了コード / pyVersion() / open(path, line) / runFile(path) / fetch(url, init)
//   storage() → { usage, quota } / project() → 名前 / command(id) (アプリのコマンド)
// }
import { isBin, kindOf, humanSize, bytesToContent } from './bin.js'
export const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m',
  magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m', bred: '\x1b[1;31m', bgreen: '\x1b[1;32m', bblue: '\x1b[1;34m', byellow: '\x1b[1;33m',
}
const PY_ROOT = '/home/pyodide/project'
// incomplete: 続きの行が要る (for … do の後・閉じていない引用符など)
export class ShellError extends Error { constructor(msg, incomplete = false) { super(msg); this.incomplete = incomplete } }
class Flow { constructor(kind, code = 0) { this.kind = kind; this.code = code } }   // break / continue / return / exit

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
const baseName = p => p.slice(p.lastIndexOf('/') + 1)
const dirName = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

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
function globRe(pat, flags = '') {
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
const hasGlob = pat => /(^|[^\\])[*?[]/.test(pat)
const unescapeGlob = pat => pat.replace(/\\(.)/g, '$1')

// ============================================================
// 字句解析: 単語 (部品の並び) と記号 (| || && ; > >> < 2> 2>> 2>&1 &> &)
// 部品: lit (引用符の外・* が使える) / q (引用符の中) / var / qvar / sub / qsub
// ============================================================
export function lex(line) {
  const toks = []
  let word = null
  let i = 0
  const n = line.length
  const seg = (t, v) => {
    if (!word) word = []
    const last = word[word.length - 1]
    if ((t === 'lit' || t === 'q') && last && last.t === t) last.v += v
    else word.push({ t, v })
  }
  const end = () => { if (word) { toks.push({ word }); word = null } }
  const op = v => { end(); toks.push({ op: v }) }
  // $NAME / ${NAME} / $? / $(…)
  const dollar = quoted => {
    const c = line[i + 1]
    if (c === '(') {
      let depth = 1, j = i + 2, q = null
      for (; j < n && depth; j++) {
        const d = line[j]
        if (q) { if (d === q) q = null; else if (d === '\\' && q === '"') j++; continue }
        if (d === '"' || d === "'") q = d
        else if (d === '(') depth++
        else if (d === ')') depth--
      }
      if (depth) throw new ShellError('$( が閉じられていません', true)
      const inner = line.slice(i + 2, j - 1)
      // $(( 式 )) は計算
      if (inner.startsWith('(') && inner.endsWith(')')) seg('arith', inner.slice(1, -1))
      else seg(quoted ? 'qsub' : 'sub', inner)
      i = j
      return
    }
    if (c === '{') {
      const j = line.indexOf('}', i + 2)
      if (j < 0) throw new ShellError('${ が閉じられていません')
      seg(quoted ? 'qvar' : 'var', line.slice(i + 2, j))
      i = j + 1
      return
    }
    const m = /^(\?|\$|#|@|\*|[0-9]|[A-Za-z_]\w*)/.exec(line.slice(i + 1))
    if (!m) { seg(quoted ? 'q' : 'lit', '$'); i++; return }
    seg(quoted ? 'qvar' : 'var', m[1])
    i += 1 + m[1].length
  }
  while (i < n) {
    const c = line[i]
    if (c === ' ' || c === '\t' || c === '\r') { end(); i++; continue }
    // 改行は ; と同じ (スクリプト・複数行)
    if (c === '\n') { op(';'); i++; continue }
    if (c === '#' && !word) { while (i < n && line[i] !== '\n') i++; continue }
    if (c === '\\') {
      if (line[i + 1] === '\n') { i += 2; continue }   // 行の続き
      if (i + 1 < n) seg('q', line[i + 1])
      i += 2
      continue
    }
    if (c === "'") {
      const j = line.indexOf("'", i + 1)
      if (j < 0) throw new ShellError("' が閉じられていません", true)
      seg('q', line.slice(i + 1, j))
      i = j + 1
      continue
    }
    if (c === '"') {
      i++
      if (!word) word = []
      word.push({ t: 'q', v: '' })
      while (i < n && line[i] !== '"') {
        const d = line[i]
        if (d === '\\' && i + 1 < n && '"\\$`\n'.includes(line[i + 1])) { seg('q', line[i + 1]); i += 2 }
        else if (d === '$') dollar(true)
        else if (d === '`') {
          const j = line.indexOf('`', i + 1)
          if (j < 0) throw new ShellError('` が閉じられていません', true)
          seg('qsub', line.slice(i + 1, j)); i = j + 1
        } else { seg('q', d); i++ }
      }
      if (i >= n) throw new ShellError('" が閉じられていません', true)
      i++
      continue
    }
    if (c === '$') { dollar(false); continue }
    if (c === '`') {
      const j = line.indexOf('`', i + 1)
      if (j < 0) throw new ShellError('` が閉じられていません', true)
      seg('sub', line.slice(i + 1, j)); i = j + 1
      continue
    }
    if (c === '|') { if (line[i + 1] === '|') { op('||'); i += 2 } else { op('|'); i++ } continue }
    if (c === '&') {
      if (line[i + 1] === '&') { op('&&'); i += 2 }
      else if (line[i + 1] === '>') { if (line[i + 2] === '>') { op('&>>'); i += 3 } else { op('&>'); i += 2 } }
      else { op('&'); i++ }
      continue
    }
    if (c === ';') { op(';'); i++; continue }
    if (c === '<') { op('<'); i++; continue }
    if (c === '>') { if (line[i + 1] === '>') { op('>>'); i += 2 } else { op('>'); i++ } continue }
    // 2> 2>> 2>&1 1>
    if ((c === '2' || c === '1') && !word && line[i + 1] === '>') {
      if (c === '2' && line.startsWith('>&1', i + 1)) { op('2>&1'); i += 4; continue }
      if (line[i + 2] === '>') { op(c === '2' ? '2>>' : '>>'); i += 3 } else { op(c === '2' ? '2>' : '>'); i += 2 }
      continue
    }
    seg('lit', c)
    i++
  }
  end()
  return toks
}

// 構文: list = [{ pipe: [コマンド…], then: ';' | '&&' | '||' | '&' | null }]
// コマンド: { words, redirs, assigns } / { compound: { type: 'for' | 'while' | 'until' | 'if' | 'group' | 'func', … }, redirs }
const REDIR = new Set(['>', '>>', '<', '2>', '2>>', '2>&1', '&>', '&>>'])
const KW = new Set(['for', 'in', 'do', 'done', 'while', 'until', 'if', 'then', 'elif', 'else', 'fi', '{', '}', 'function'])
const kwOf = t => (t && t.word && t.word.length === 1 && t.word[0].t === 'lit' && KW.has(t.word[0].v) ? t.word[0].v : null)
const litOf = t => (t && t.word && t.word.length === 1 && t.word[0].t === 'lit' ? t.word[0].v : null)
export function parse(toks) {
  let i = 0
  const more = what => { throw new ShellError(`${what} がありません`, true) }
  const expect = kw => {
    while (toks[i] && toks[i].op === ';') i++
    if (i >= toks.length) more(kw)
    if (kwOf(toks[i]) !== kw) throw new ShellError(`${kw} が必要です (${litOf(toks[i]) || toks[i].op || ''} の前)`)
    i++
  }
  const redirs = () => {
    const out = []
    while (toks[i] && toks[i].op && REDIR.has(toks[i].op)) {
      const t = toks[i++]
      if (t.op === '2>&1') { out.push({ op: t.op }); continue }
      if (!toks[i] || !toks[i].word) throw new ShellError(`${t.op} の後にファイル名がありません`)
      out.push({ op: t.op, word: toks[i++].word })
    }
    return out
  }
  function list(stops) {
    const out = []
    for (;;) {
      while (toks[i] && (toks[i].op === ';' || toks[i].op === '&')) i++
      if (i >= toks.length) { if (stops) more(stops.join(' / ')); return out }
      const kw = kwOf(toks[i])
      if (stops && kw && stops.includes(kw)) return out
      const pipe = [command()]
      while (toks[i] && toks[i].op === '|') { i++; if (i >= toks.length) more('| の後のコマンド'); pipe.push(command()) }
      let then = null
      const t = toks[i]
      if (t && t.op && [';', '&&', '||', '&'].includes(t.op)) { then = t.op; i++ }
      else if (t && t.op) throw new ShellError(`${t.op} の使い方が正しくありません`)
      if ((then === '&&' || then === '||') && i >= toks.length) more(`${then} の後のコマンド`)
      out.push({ pipe, then })
    }
  }
  function command() {
    const t = toks[i]
    const kw = kwOf(t)
    if (kw === 'for') {
      i++
      const name = litOf(toks[i])
      if (!name || !/^[A-Za-z_]\w*$/.test(name)) throw new ShellError('for の後に変数の名前を書いてください (例: for f in *.py; do …; done)')
      i++
      let items = null
      if (kwOf(toks[i]) === 'in') { i++; items = []; while (toks[i] && toks[i].word && kwOf(toks[i]) !== 'do') items.push(toks[i++].word) }
      expect('do')
      const body = list(['done'])
      expect('done')
      return { compound: { type: 'for', name, items, body }, redirs: redirs() }
    }
    if (kw === 'while' || kw === 'until') {
      i++
      const cond = list(['do'])
      expect('do')
      const body = list(['done'])
      expect('done')
      return { compound: { type: kw, cond, body }, redirs: redirs() }
    }
    if (kw === 'if') {
      i++
      const branches = []
      let otherwise = null
      for (;;) {
        const cond = list(['then'])
        expect('then')
        const body = list(['elif', 'else', 'fi'])
        branches.push({ cond, body })
        while (toks[i] && toks[i].op === ';') i++
        const k = kwOf(toks[i])
        if (k === 'elif') { i++; continue }
        if (k === 'else') { i++; otherwise = list(['fi']) }
        expect('fi')
        break
      }
      return { compound: { type: 'if', branches, otherwise }, redirs: redirs() }
    }
    if (kw === '{') {
      i++
      const body = list(['}'])
      expect('}')
      return { compound: { type: 'group', body }, redirs: redirs() }
    }
    // 関数: name() { … } / function name { … }
    const lit = litOf(t)
    let fname = null
    if (kw === 'function') { i++; fname = litOf(toks[i]); i++; if (litOf(toks[i]) === '()') i++ }
    else if (lit && /^[A-Za-z_][\w-]*\(\)$/.test(lit)) { fname = lit.slice(0, -2); i++ }
    else if (lit && /^[A-Za-z_][\w-]*$/.test(lit) && litOf(toks[i + 1]) === '()') { fname = lit; i += 2 }
    if (fname) {
      while (toks[i] && toks[i].op === ';') i++
      if (i >= toks.length) more('関数の中身 { … }')
      if (kwOf(toks[i]) !== '{') throw new ShellError('関数の中身は { … } で書いてください')
      i++
      const body = list(['}'])
      expect('}')
      return { compound: { type: 'func', name: fname, body }, redirs: [] }
    }
    if (kw && kw !== 'in') throw new ShellError(`${kw} の使い方が正しくありません`)
    // ふつうのコマンド
    const cmd = { words: [], redirs: [], assigns: [] }
    while (i < toks.length) {
      const tk = toks[i]
      if (tk.op) {
        if (!REDIR.has(tk.op)) break
        cmd.redirs.push(...redirs())
        continue
      }
      const first = tk.word[0]
      const m = !cmd.words.length && first.t === 'lit' && /^([A-Za-z_]\w*)=/.exec(first.v)
      if (m) cmd.assigns.push({ name: m[1], word: [{ t: 'q', v: first.v.slice(m[0].length) }, ...tk.word.slice(1)] })
      else cmd.words.push(tk.word)
      i++
    }
    if (!cmd.words.length && !cmd.redirs.length && !cmd.assigns.length) throw new ShellError(toks[i] ? `${toks[i].op} の前にコマンドがありません` : 'コマンドがありません')
    return cmd
  }
  return list(null)
}

// $(( 式 )) の計算 (整数。変数の名前は値に)
export function arith(expr, getVar) {
  const toks = String(expr).match(/\d+|[A-Za-z_]\w*|\*\*|<=|>=|==|!=|&&|\|\||<<|>>|[-+*/%()<>!~^&|?:]/g) || []
  let i = 0
  const peek = () => toks[i]
  const num = v => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n }
  const bool = v => (v ? 1 : 0)
  const LEVELS = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']]
  const apply = (op, a, b) => {
    switch (op) {
      case '||': return bool(a || b); case '&&': return bool(a && b)
      case '|': return a | b; case '^': return a ^ b; case '&': return a & b
      case '==': return bool(a === b); case '!=': return bool(a !== b)
      case '<': return bool(a < b); case '<=': return bool(a <= b); case '>': return bool(a > b); case '>=': return bool(a >= b)
      case '<<': return a << b; case '>>': return a >> b
      case '+': return a + b; case '-': return a - b; case '*': return a * b
      case '/': if (!b) throw new ShellError('0 で割ろうとしました'); return Math.trunc(a / b)
      case '%': if (!b) throw new ShellError('0 で割ろうとしました'); return a % b
    }
    return 0
  }
  function level(k) {
    if (k === LEVELS.length) return power()
    let a = level(k + 1)
    while (LEVELS[k].includes(peek())) { const op = toks[i++]; a = apply(op, a, level(k + 1)) }
    return a
  }
  function power() { const a = unary(); if (peek() === '**') { i++; return a ** power() } return a }
  function unary() {
    const t = peek()
    if (t === '-') { i++; return -unary() }
    if (t === '+') { i++; return unary() }
    if (t === '!') { i++; return bool(!unary()) }
    if (t === '~') { i++; return ~unary() }
    if (t === '(') { i++; const v = ternary(); if (toks[i++] !== ')') throw new ShellError(') がありません'); return v }
    i++
    if (t === undefined) throw new ShellError('式が途中で終わっています')
    if (/^\d+$/.test(t)) return num(t)
    if (/^[A-Za-z_]\w*$/.test(t)) return num(getVar(t))
    throw new ShellError(`${t} は計算に使えません`)
  }
  function ternary() {
    const c = level(0)
    if (peek() === '?') { i++; const a = ternary(); if (toks[i++] !== ':') throw new ShellError(': がありません'); const b = ternary(); return c ? a : b }
    return c
  }
  const v = ternary()
  if (i < toks.length) throw new ShellError(`${toks[i]} の使い方が正しくありません`)
  return v
}

// [ 条件 ] / test 条件
function testExpr(args, sh) {
  let i = 0
  const fileTest = (op, f) => {
    const p = sh.resolve(f)
    const st = sh.stat(p)
    if (op === '-e') return !!st
    if (op === '-f') return !!st && !st.dir
    if (op === '-d') return !!st && st.dir
    if (op === '-s') return !!st && !st.dir && st.size > 0
    return !!st
  }
  function prim() {
    const a = args[i]
    if (a === '!') { i++; return !prim() }
    if (a === '(') { i++; const v = or(); if (args[i] === ')') i++; return v }
    if (/^-[efdsrwx]$/.test(a) && i + 1 < args.length) { i += 2; return fileTest(a, args[i - 1]) }
    if (a === '-z' && i + 1 < args.length) { i += 2; return args[i - 1] === '' }
    if (a === '-n' && i + 1 < args.length) { i += 2; return args[i - 1] !== '' }
    const op = args[i + 1]
    if (op !== undefined && /^(=|==|!=|<|>|-eq|-ne|-lt|-le|-gt|-ge)$/.test(op) && i + 2 < args.length) {
      const b = args[i + 2]
      i += 3
      const x = parseInt(a, 10) || 0, y = parseInt(b, 10) || 0
      switch (op) {
        case '=': case '==': return a === b
        case '!=': return a !== b
        case '<': return a < b
        case '>': return a > b
        case '-eq': return x === y
        case '-ne': return x !== y
        case '-lt': return x < y
        case '-le': return x <= y
        case '-gt': return x > y
        case '-ge': return x >= y
      }
    }
    i++
    return a !== undefined && a !== ''
  }
  function and() { let v = prim(); while (args[i] === '-a' || args[i] === '&&') { i++; const w = prim(); v = v && w } return v }
  function or() { let v = and(); while (args[i] === '-o' || args[i] === '||') { i++; const w = and(); v = v || w } return v }
  if (!args.length) return false
  return or()
}

// 標準入力 (パイプ・< ファイル)。read は 1 行ずつ、ほかのコマンドは残りすべてを読む
class Stream {
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
function getopts(args, flags = '', vals = '', { num = null } = {}) {
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

const HELP = [
  ['ファイル', [
    ['ls [-la] [場所]', 'ファイルの一覧 (-l 詳しく, -a 隠しファイルも, -R 中のフォルダも)'],
    ['cd [フォルダ]', 'フォルダを移動 (cd .. で上へ, cd - で前の場所, cd だけで一番上)'],
    ['pwd', 'いまいるフォルダ'],
    ['tree [-L 深さ]', 'フォルダの中身を木の形で'],
    ['cat [-n] ファイル', 'ファイルの中身を表示'],
    ['head / tail [-n 行数]', '最初 / 最後の何行かを表示'],
    ['touch ファイル', '空のファイルを作る'],
    ['mkdir [-p] フォルダ', 'フォルダを作る'],
    ['cp [-r] 元 先', 'コピー'],
    ['mv 元 先', '移動・名前の変更'],
    ['rm [-rf] ファイル', '削除 (-r でフォルダも)'],
    ['find [場所] [-name "*.py"] [-type f|d]', 'ファイルを探す'],
    ['grep [-rinvcl] 文字 [ファイル]', 'ファイルの中から探す (-r フォルダの中も, -i 大小を区別しない, -n 行番号)'],
    ['wc [-lwc] ファイル', '行数・単語数・文字数'],
    ['du / df', '使っている容量'],
    ['open ファイル', 'エディタで開く (code / nano / vim も同じ)'],
    ['diff A B', '2 つのファイルの違い'],
  ]],
  ['Python', [
    ['python ファイル.py [引数]', 'Python で実行 (sys.argv に引数が入ります)'],
    ['python', '対話モード (>>> に 1 行ずつ。exit() か Ctrl+D で終わり)'],
    ['python -c "コード"', 'その場でコードを実行'],
    ['python -m モジュール', 'モジュールを実行 (例: python -m this, python -m timeit "1+1")'],
    ['python -i ファイル.py', '実行した後、その変数で対話モード'],
    ['pip install 名前', 'PyPI からライブラリを入れる (pip list / show / uninstall / install -r requirements.txt)'],
    ['run [ファイル]', '実行画面 (▶ と同じ) で実行'],
  ]],
  ['文字の加工', [
    ['echo [-n] [-e] 文字', '文字を表示'],
    ['printf 書式 値…', '書式つきで表示'],
    ['sort [-rnu] / uniq [-c]', '並べ替え / 重なりを除く'],
    ['cut -d , -f 1 / tr a-z A-Z', '列を取り出す / 文字を置き換える'],
    ['sed "s/前/後/g" [-i] ファイル', '置き換え (-i でファイルを書き換え)'],
    ['tee [-a] ファイル', '表示しながらファイルにも書く'],
    ['seq 1 10', '数の並び'],
  ]],
  ['スクリプト', [
    ['for f in *.py; do echo $f; done', 'くり返し (while 条件; do …; done も)'],
    ['if [ -f a.txt ]; then …; else …; fi', '条件 ([ ] で -f ファイル・-d フォルダ・= 文字・-lt 数 など)'],
    ['名前() { echo $1; }', '関数 ($1 $2 … $@ が引数)'],
    ['sh ファイル.sh / ./ファイル.sh', 'シェルスクリプトを実行 (source で今のシェルで)'],
    ['read 変数', '1 行読む (while read line; do …; done < ファイル)'],
    ['echo $((1 + 2 * 3))', '計算'],
  ]],
  ['クラウド (24 時間)', [
    ['cloud', 'クラウド (GitHub) で動かしている様子'],
    ['cloud run / cloud log', '今すぐ実行 / 最後の出力'],
    ['cloud setup / cloud stop', '設定の画面 / やめる'],
  ]],
  ['そのほか', [
    ['xargs / watch -n 秒 コマンド', '引数にして実行 / くり返し表示'],
    ['zip -r a.zip フォルダ / unzip a.zip', 'ZIP を作る / 開く'],
    ['base64 / sha256sum / file', '変換 / ハッシュ / 種類'],
    ['clear', '画面を消す (Ctrl+L)'],
    ['history', 'これまでのコマンド (↑↓ で呼び出し)'],
    ['date / sleep 秒 / time コマンド', '日時 / 待つ / かかった時間'],
    ['curl URL [-o ファイル] / wget URL', 'インターネットから読み込む (相手が許可している場合)'],
    ['env / export 名前=値 / alias 名前="コマンド"', '変数・別名'],
    ['uptime / free / ps / kill', '動いている時間・メモリ・実行中のプログラム・止める'],
    ['git push / git pull', 'GitHub と同期 (設定 → 保存 → GitHub と同期)'],
    ['exit', 'ターミナルを閉じる'],
  ]],
]

// ============================================================
// シェル
// ============================================================
export class Shell {
  constructor(host, { cwd = '', env = {}, aliases = {} } = {}) {
    this.host = host
    this.cwd = cwd
    this.oldCwd = cwd
    this.status = 0
    this.started = Date.now()
    this.env = { USER: 'forge', HOME: '~', SHELL: 'forgesh', LANG: 'ja_JP.UTF-8', TERM: 'xterm-256color', PYTHON: 'python3', ...env }
    this.aliases = { ll: 'ls -l', la: 'ls -a', l: 'ls', py: 'python', python3: 'python', pip3: 'pip', cls: 'clear', ...aliases }
    this.idxCache = null
    this.ov = new Map()
    this.funcs = {}      // 関数
    this.args = []       // 関数・スクリプトの引数 ($1 …)
    this.locals = []     // local で作った変数
    this.loops = 0
    this.scriptName = null
  }

  // ---- ファイルの一覧 (コマンドごとに 1 度だけ作る) ----
  // 変えたファイルは、アプリの一覧に反映されるまで ov (上書き) で覚えておく (mkdir x && cd x がすぐ使えるように)
  index() {
    if (this.idxCache) return this.idxCache
    const map = new Map()
    map.set('', { dir: true, size: 0, mtime: 0 })
    const addParents = (path, mtime) => {
      let p = path
      while (p.includes('/')) { p = dirName(p); if (!map.has(p)) map.set(p, { dir: true, size: 0, mtime }) }
    }
    for (const f of this.host.files()) {
      map.set(f.path, { dir: !!f.dir, size: f.size || 0, mtime: f.mtime || 0 })
      addParents(f.path, f.mtime || 0)
    }
    for (const [p, info] of this.ov) {
      if (info) { map.set(p, info); addParents(p, info.mtime) }
      else map.delete(p)
    }
    this.idxCache = map
    return map
  }
  touchIndex() { this.idxCache = null; this.dirty = true }
  async fsWrite(p, text) {
    await this.host.write(p, text)
    this.ov.set(p, { dir: false, size: text.length, mtime: Date.now() })
    this.touchIndex()
  }
  async fsMkdir(p) {
    await this.host.mkdir(p)
    let q = ''
    for (const part of p.split('/')) { q = q ? q + '/' + part : part; if (!this.isDir(q)) this.ov.set(q, { dir: true, size: 0, mtime: Date.now() }) }
    this.touchIndex()
  }
  async fsRemove(p) {
    const gone = [...this.index().keys()].filter(k => k === p || k.startsWith(p + '/'))
    await this.host.remove(p)
    for (const k of gone) this.ov.set(k, null)
    this.touchIndex()
  }
  async fsRename(a, b) {
    const moved = [...this.index().entries()].filter(([k]) => k === a || k.startsWith(a + '/'))
    await this.host.rename(a, b)
    for (const [k] of moved) this.ov.set(k, null)
    for (const [k, info] of moved) this.ov.set(b + k.slice(a.length), { ...info, mtime: Date.now() })
    this.touchIndex()
  }
  // 変えたことをアプリに知らせて、一覧を読み直してもらう
  async sync() {
    if (!this.dirty) return
    this.dirty = false
    try { await this.host.changed() } catch {}
    this.ov.clear()
    this.idxCache = null
  }
  stat(p) { return this.index().get(p) || null }
  isDir(p) { const s = this.stat(p); return !!(s && s.dir) }
  isFile(p) { const s = this.stat(p); return !!(s && !s.dir) }
  children(dir, all = false) {
    const out = []
    const pre = dir ? dir + '/' : ''
    for (const [p, s] of this.index()) {
      if (!p || !p.startsWith(pre)) continue
      const rest = p.slice(pre.length)
      if (!rest || rest.includes('/')) continue
      if (!all && rest.startsWith('.')) continue
      out.push({ name: rest, path: p, ...s })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  }
  resolve(p) { return resolvePath(this.cwd, p) }
  async readText(p) {
    const path = this.resolve(p)
    if (!this.isFile(path)) return null
    const t = await this.host.read(path)
    if (isBin(t)) throw new ShellError(`${p}: バイナリファイルです (画像・データベースなど)`)
    return t
  }
  async writeText(p, text) {
    const path = this.resolve(p)
    if (!path) throw new ShellError('ファイル名がありません')
    if (this.isDir(path)) throw new ShellError(`${p}: フォルダです`)
    const parent = dirName(path)
    if (parent && !this.isDir(parent)) throw new ShellError(`${p}: フォルダ ${showPath(parent)} がありません`)
    await this.fsWrite(path, text)
  }

  // ワイルドカードを、プロジェクトのファイルに当てはめる
  glob(pat) {
    const abs = pat.startsWith('/') || pat.startsWith('~')
    const prefix = pat.startsWith('~/') ? '~/' : pat.startsWith('/') ? '/' : ''
    const body = pat.slice(prefix.length || (pat === '~' ? 1 : 0))
    const parts = body.split('/').filter(Boolean)
    let cur = [[abs ? '' : this.cwd, '']]   // [実際のパス, 表示]
    for (let k = 0; k < parts.length; k++) {
      const part = parts[k]
      const next = []
      for (const [real, shown] of cur) {
        if (!hasGlob(part)) {
          const lit = unescapeGlob(part)
          const p = resolvePath(real, lit)
          if (this.stat(p) || lit === '..' || lit === '.') next.push([p, shown + lit + (k < parts.length - 1 ? '/' : '')])
          continue
        }
        const re = globRe(part)
        for (const ch of this.children(real, part.startsWith('.'))) {
          if (re.test(ch.name) && (k === parts.length - 1 || ch.dir)) next.push([ch.path, shown + ch.name + (k < parts.length - 1 ? '/' : '')])
        }
      }
      cur = next
      if (!cur.length) return []
    }
    return cur.map(([, shown]) => prefix + shown).sort()
  }

  // ---- 単語の展開 ($変数・$(…)・$(( 式 ))・ワイルドカード) ----
  async expand(word, io) {
    let text = '', pat = '', split = false
    for (const s of word) {
      if (s.t === 'lit') { text += s.v; pat += s.v }
      else if (s.t === 'q') { text += s.v; pat += s.v.replace(/[*?[\]\\]/g, '\\$&') }
      else {
        let v
        if (s.t === 'var' || s.t === 'qvar') v = this.varValue(s.v)
        else if (s.t === 'arith') v = String(arith(await this.expandText(s.v, io), n => this.varValue(n)))
        else v = await this.capture(s.v, io)
        text += v
        pat += v.replace(/[*?[\]\\]/g, '\\$&')
        if (s.t === 'var' || s.t === 'sub') split = true
      }
    }
    if (split) return text.split(/\s+/).filter(Boolean)
    if (hasGlob(pat)) {
      const hits = this.glob(pat)
      if (hits.length) return hits
      return [unescapeGlob(pat)]
    }
    return [text]
  }
  // $(( )) の中の $変数
  async expandText(src, io) {
    return String(src).replace(/\$\{?([A-Za-z_]\w*|[0-9#?])\}?/g, (m, n) => this.varValue(n))
  }
  varValue(name) {
    const args = this.args[this.args.length - 1] || []
    if (name === '?') return String(this.status)
    if (name === '$') return '1'
    if (name === '#') return String(args.length)
    if (name === '@' || name === '*') return args.join(' ')
    if (name === 'PWD') return showPath(this.cwd)
    if (name === 'OLDPWD') return showPath(this.oldCwd)
    if (name === 'RANDOM') return String(Math.floor(Math.random() * 32768))
    if (name === '0') return this.scriptName || 'forgesh'
    if (/^\d$/.test(name)) return args[Number(name) - 1] ?? ''
    for (let k = this.locals.length - 1; k >= 0; k--) if (name in this.locals[k]) return this.locals[k][name]
    return this.env[name] ?? ''
  }
  setVar(name, value) {
    for (let k = this.locals.length - 1; k >= 0; k--) if (name in this.locals[k]) { this.locals[k][name] = value; return }
    this.env[name] = value
  }
  async capture(cmd, io) {
    const buf = []
    await this.run(cmd, { ...io, out: s => buf.push(s), tty: false })
    return buf.join('').replace(/\n+$/, '')
  }
  // 続きの行が要るか (for … do の後・閉じていない引用符など)
  isIncomplete(text) {
    try { parse(lex(text)); return false } catch (e) { return !!(e && e.incomplete) }
  }

  // ---- 実行 ----
  async run(line, io) {
    this.idxCache = null
    if (!this.args.length) this.loops = 0
    let list
    try {
      list = parse(lex(line))
    } catch (e) {
      io.err(`forgesh: ${e.message}\n`)
      this.status = 2
      return 2
    }
    try {
      return await this.runList(list, io)
    } catch (e) {
      if (e instanceof Flow) { this.status = e.code; return e.code }   // スクリプトの外での break / return
      throw e
    }
  }
  async runList(list, io) {
    let status = this.status
    for (let k = 0; k < list.length; k++) {
      const prev = k ? list[k - 1].then : null
      if (prev === '&&' && status !== 0) continue
      if (prev === '||' && status === 0) continue
      status = await this.runPipe(list[k].pipe, io)
      this.status = status
      if (io.signal && io.signal.aborted) { this.status = 130; return 130 }
    }
    this.status = status
    return status
  }
  // 繰り返しの途中で画面を止めない・Ctrl+C で止める
  async tick(io) {
    if (io.signal && io.signal.aborted) throw Object.assign(new Error('止めました'), { name: 'AbortError' })
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    if (now - (this.lastYield || 0) > 30) { this.lastYield = now; await new Promise(r => setTimeout(r, 0)) }
    if (++this.loops > 1000000) throw new ShellError('繰り返しが多すぎるので止めました (100 万回)')
  }
  // for / while / if / { } / 関数
  async runCompound(node, io) {
    switch (node.type) {
      case 'func':
        this.funcs[node.name] = node.body
        return 0
      case 'group':
        return this.runList(node.body, io)
      case 'if': {
        for (const b of node.branches) {
          if ((await this.runList(b.cond, io)) === 0) return this.runList(b.body, io)
        }
        return node.otherwise ? this.runList(node.otherwise, io) : 0
      }
      case 'for': {
        let items = []
        if (node.items === null) items = [...(this.args[this.args.length - 1] || [])]
        else for (const w of node.items) items.push(...await this.expand(w, io))
        let status = 0
        for (const v of items) {
          await this.tick(io)
          this.setVar(node.name, v)
          try { status = await this.runList(node.body, io) } catch (e) {
            if (e instanceof Flow && e.kind === 'break') break
            if (e instanceof Flow && e.kind === 'continue') continue
            throw e
          }
        }
        return status
      }
      case 'while': case 'until': {
        let status = 0
        for (;;) {
          await this.tick(io)
          const c = await this.runList(node.cond, io)
          if ((c === 0) !== (node.type === 'while')) break
          try { status = await this.runList(node.body, io) } catch (e) {
            if (e instanceof Flow && e.kind === 'break') break
            if (e instanceof Flow && e.kind === 'continue') continue
            throw e
          }
        }
        return status
      }
    }
    return 0
  }

  // 別名 (alias) を置き換える。同じ名前の別名を何度も展開しない (alias ls='ls -F' など)
  aliasWords(words) {
    const seen = new Set()
    for (let k = 0; k < 8; k++) {
      const w = words[0]
      const name = w && w.length === 1 && w[0].t === 'lit' ? w[0].v : null
      if (!name || seen.has(name) || !(name in this.aliases)) break
      seen.add(name)
      let toks
      try { toks = lex(this.aliases[name]) } catch { break }
      if (toks.some(t => t.op)) break
      words = [...toks.map(t => t.word), ...words.slice(1)]
    }
    return words
  }

  async runPipe(cmds, io) {
    let input = io.stdin || null, status = 0
    for (let k = 0; k < cmds.length; k++) {
      const cmd = cmds[k]
      const last = k === cmds.length - 1
      const outBuf = last ? null : []
      let stdin = input
      let out = last ? io.out : s => outBuf.push(String(s))
      let err = io.err
      let tty = last && io.tty !== false
      const files = []
      let bad = false
      for (const r of cmd.redirs) {
        if (r.op === '2>&1') { err = out; continue }
        let target
        try { target = (await this.expand(r.word, io))[0] || '' } catch (e) { io.err(`forgesh: ${e.message}\n`); bad = true; break }
        if (r.op === '<') {
          let t = null
          try { t = await this.readText(target) } catch (e) { io.err(`forgesh: ${e.message}\n`); bad = true; break }
          if (t === null) { io.err(`forgesh: ${target}: ファイルがありません\n`); bad = true; break }
          stdin = new Stream(t)
          continue
        }
        const f = { name: target, append: r.op.endsWith('>>'), buf: [] }
        files.push(f)
        const w = s => f.buf.push(String(s))
        if (r.op === '>' || r.op === '>>') { out = w; tty = false }
        else if (r.op === '2>' || r.op === '2>>') err = w
        else { out = w; err = w; tty = false }
      }
      if (bad) { status = 1; input = null; continue }
      const sub = { ...io, out, err, tty, stdin }
      if (cmd.compound) status = await this.runCompound(cmd.compound, sub)
      else {
        const argv = []
        try {
          for (const w of this.aliasWords(cmd.words)) argv.push(...await this.expand(w, io))
          for (const a of cmd.assigns) this.setVar(a.name, (await this.expand(a.word, io)).join(' '))
        } catch (e) { io.err(`forgesh: ${e.message}\n`); return 1 }
        if (!argv.length) status = 0
        else {
          const ctx = { out, err, tty, piped: !last, signal: io.signal, io: sub, cols: io.cols ? io.cols() : 80, stdinStream: stdin }
          // 標準入力は、読んだときに初めて取り出す (read で 1 行ずつ読む while ループのため)
          Object.defineProperty(ctx, 'stdin', { get: () => (stdin ? stdin.readAll() : null), configurable: true })
          status = await this.exec(argv, ctx)
        }
      }
      for (const f of files) {
        try {
          const before = f.append ? (await this.readText(f.name)) || '' : ''
          await this.writeText(f.name, before + f.buf.join(''))
        } catch (e) { io.err(`forgesh: ${e.message}\n`); status = 1 }
      }
      await this.sync()
      input = outBuf ? new Stream(outBuf.join('')) : null
      if (io.signal && io.signal.aborted) return 130
    }
    return status
  }

  // 関数・スクリプトを呼ぶ (引数は $1 $2 … $@)
  async callBody(body, args, io, { name = null, subshell = false } = {}) {
    if (this.args.length > 200) throw new ShellError('呼び出しが深すぎます (関数が自分を呼び続けていませんか?)')
    const saved = subshell ? { cwd: this.cwd, env: { ...this.env } } : null
    const savedName = this.scriptName
    this.args.push(args)
    this.locals.push({})
    if (name) this.scriptName = name
    try { return await this.runList(body, io) } catch (e) {
      if (e instanceof Flow && (e.kind === 'return' || (e.kind === 'exit' && name))) return e.code
      throw e
    } finally {
      this.args.pop()
      this.locals.pop()
      this.scriptName = savedName
      if (saved) { this.cwd = saved.cwd; this.env = saved.env }
    }
  }
  async runScript(path, args, ctx, { subshell = true } = {}) {
    const text = await this.readText(path)
    if (text === null) { ctx.err(`${path}: ファイルがありません\n`); return 127 }
    let list
    try { list = parse(lex(text)) } catch (e) { ctx.err(`${path}: ${e.message}\n`); return 2 }
    return this.callBody(list, args, { ...ctx.io, out: ctx.out, err: ctx.err, stdin: ctx.stdinStream }, { name: path, subshell })
  }

  async exec(argv, ctx) {
    const name = argv[0]
    ctx.sh = this
    ctx.term = ctx.io.term || null
    ctx.print = s => ctx.out(s + '\n')
    // 関数
    if (this.funcs[name]) return this.callBody(this.funcs[name], argv.slice(1), { ...ctx.io, out: ctx.out, err: ctx.err, stdin: ctx.stdinStream })
    // ./script.sh・sub/x.py のようにファイルを指したとき
    if (name.includes('/') && !COMMANDS[name]) {
      const p = this.resolve(name)
      if (this.isFile(p)) {
        if (/\.pyw?$/.test(name)) return COMMANDS.python.call(this, argv, ctx)
        return this.runScript(name, argv.slice(1), ctx)
      }
    }
    const fn = COMMANDS[name]
    if (!fn) {
      const hint = this.isFile(this.resolve(name)) && /\.pyw?$/.test(name) ? ` (実行するなら: python ${name})`
        : this.isFile(this.resolve(name)) && /\.sh$/.test(name) ? ` (実行するなら: sh ${name} か ./${name})`
          : /^(apt|apt-get|brew|sudo|npm|node|yarn|java|gcc|make|docker|ssh|top|htop)$/.test(name) ? ' (このターミナルでは使えません)' : ''
      ctx.err(`${name}: コマンドが見つかりません${hint}\n`)
      if (!hint) ctx.err(`${C.gray}使えるコマンドは help で表示します${C.reset}\n`)
      return 127
    }
    try {
      const r = await fn.call(this, argv.slice(1), ctx)
      return typeof r === 'number' ? r : 0
    } catch (e) {
      if (e instanceof Flow) throw e
      if (e && e.name === 'AbortError') return 130
      ctx.err(`${name}: ${e && e.message || e}\n`)
      return 1
    } finally {
      await this.sync()
    }
  }

  // 入力の補完 (Tab): [候補, 置き換える範囲の始まり]
  complete(line) {
    const m = /(?:^|[\s|;&<>])([^\s|;&<>]*)$/.exec(line)
    const word = m ? m[1] : ''
    const start = line.length - word.length
    const before = line.slice(0, start)
    const first = !/\S/.test(before.replace(/.*[|;&]\s*/s, ''))
    if (first && !word.includes('/')) {
      const names = [...new Set([...Object.keys(COMMANDS), ...Object.keys(this.aliases)])].filter(n => n.startsWith(word) && !n.startsWith('_')).sort()
      return { items: names.map(n => ({ text: n + ' ', label: n })), start }
    }
    const cmd = (/(?:^|[|;&])\s*(\S+)[^|;&]*$/.exec(before) || [])[1] || ''
    const dirOnly = cmd === 'cd' || cmd === 'rmdir'
    const pyFirst = cmd === 'python' || cmd === 'py' || cmd === 'python3' || cmd === 'run'
    const slash = word.lastIndexOf('/')
    const dirPart = slash >= 0 ? word.slice(0, slash + 1) : ''
    const namePart = slash >= 0 ? word.slice(slash + 1) : word
    const dir = resolvePath(this.cwd, dirPart || '.')
    if (!this.isDir(dir)) return { items: [], start }
    const quote = s => s.replace(/([\s'"\\$`&|;<>()*?[\]])/g, '\\$1')
    let items = this.children(dir, namePart.startsWith('.'))
      .filter(c => c.name.startsWith(namePart) && (!dirOnly || c.dir))
      .map(c => ({ text: dirPart + quote(c.name) + (c.dir ? '/' : ' '), label: c.name + (c.dir ? '/' : ''), dir: c.dir, py: /\.pyw?$/.test(c.name) }))
    if (pyFirst) items = items.sort((a, b) => (b.py || b.dir) - (a.py || a.dir))
    return { items, start }
  }
}

// ============================================================
// 表示の道具
// ============================================================
function columns(names, width, colorOf = () => '') {
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
const human = n => (n < 1024 ? n + 'B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + 'K' : (n / 1048576).toFixed(1) + 'M')
const pad2 = n => String(n).padStart(2, '0')
function shortDate(t) {
  if (!t) return '            '
  const d = new Date(t)
  return `${pad2(d.getMonth() + 1)}月${pad2(d.getDate())}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
function nameColor(e) {
  if (e.dir) return C.bblue
  if (/\.(zip|gz|tar|whl)$/i.test(e.name)) return C.red
  if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(e.name)) return C.magenta
  return ''
}
function lines(text) {
  if (!text) return []
  const ls = text.split('\n')
  if (ls[ls.length - 1] === '') ls.pop()
  return ls
}
function escapes(s) {
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
async function inputs(sh, files, ctx, name) {
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
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) { reject(Object.assign(new Error('止めました'), { name: 'AbortError' })); return }
  const t = setTimeout(resolve, ms)
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('止めました'), { name: 'AbortError' })) }, { once: true })
})
function strftime(fmt, d) {
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
function fmtDuration(ms) {
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60
  return (d ? `${d} 日 ` : '') + `${h}:${pad2(m)}:${pad2(s % 60)}`
}
// sed の置き換え文字 (\1 & → $1 $&)
function sedRepl(rep) {
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
function expandSet(s) {
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
function bre(src) {
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
function parseSubst(s) {
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
function diffLines(a, b) {
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
const COMMANDS = {
  async help(args, ctx) {
    if (args[0]) {
      const name = this.aliases[args[0]] && !COMMANDS[args[0]] ? this.aliases[args[0]].split(' ')[0] : args[0]
      for (const [, rows] of HELP) for (const [u, d] of rows) if (u.split(/[\s/]+/).includes(name)) { ctx.print(`${C.bold}${u}${C.reset}\n  ${d}`); return 0 }
      ctx.err(`help: ${args[0]} の説明はありません\n`)
      return 1
    }
    ctx.print(`${C.bold}ForgeCode ターミナル${C.reset} ${C.gray}— ~ はプロジェクトの一番上です。Tab で補完、↑↓ で前のコマンド、Ctrl+C で止める${C.reset}`)
    for (const [title, rows] of HELP) {
      ctx.print(`\n${C.byellow}${title}${C.reset}`)
      const w = Math.min(34, Math.max(...rows.map(r => strWidth(r[0]))))
      for (const [u, d] of rows) {
        if (ctx.cols < 60) ctx.print(`  ${C.cyan}${u}${C.reset}\n      ${C.gray}${d}${C.reset}`)
        else ctx.print(`  ${C.cyan}${u}${C.reset}${' '.repeat(Math.max(1, w - strWidth(u) + 2))}${C.gray}${d}${C.reset}`)
      }
    }
    ctx.print(`\n${C.gray}パイプ (|)・リダイレクト (> >> <)・&& || ;・$変数・$(コマンド)・* ? も使えます${C.reset}`)
    return 0
  },
  man(args, ctx) { return COMMANDS.help.call(this, args, ctx) },

  // ---- 場所 ----
  pwd(args, ctx) { ctx.print(showPath(this.cwd)); return 0 },
  cd(args, ctx) {
    let target = args[0]
    if (target === '-') { target = '/' + this.oldCwd; ctx.print(showPath(this.oldCwd)) }
    const p = target === undefined ? '' : this.resolve(target)
    if (!this.isDir(p)) {
      ctx.err(this.isFile(p) ? `cd: ${target}: フォルダではありません\n` : `cd: ${target}: そのフォルダはありません\n`)
      return 1
    }
    this.oldCwd = this.cwd
    this.cwd = p
    return 0
  },

  // ---- 一覧 ----
  ls(args, ctx) {
    const { o, rest } = getopts(args, 'laAhR1Ft')
    const all = o.a || o.A
    let status = 0
    const files = [], dirs = []
    for (const t of rest.length ? rest : ['.']) {
      const p = this.resolve(t)
      const st = this.stat(p)
      if (!st) { ctx.err(`ls: '${t}' はありません\n`); status = 2; continue }
      if (st.dir) dirs.push([t, p]); else files.push({ name: t, path: p, ...st })
    }
    const show = entries => {
      if (o.t) entries = [...entries].sort((a, b) => b.mtime - a.mtime)
      if (o.l) {
        const sizes = entries.map(e => (e.dir ? '-' : o.h ? human(e.size) : String(e.size)))
        const sw = Math.max(1, ...sizes.map(s => s.length))
        if (entries.length) ctx.print(`${C.gray}合計 ${entries.length}${C.reset}`)
        entries.forEach((e, k) => {
          const col = ctx.tty ? nameColor(e) : ''
          ctx.print(`${e.dir ? 'd' : '-'}rw-r--r--  ${sizes[k].padStart(sw)}  ${shortDate(e.mtime)}  ${col}${e.name}${col ? C.reset : ''}${o.F && e.dir ? '/' : ''}`)
        })
        return
      }
      const names = entries.map(e => e.name + (o.F && e.dir ? '/' : ''))
      if (!ctx.tty || o['1']) { if (names.length) ctx.out(names.join('\n') + '\n'); return }
      ctx.out(columns(names, ctx.cols, k => nameColor(entries[k])))
    }
    if (files.length) show(files)
    const walk = (t, p, head) => {
      if (head) ctx.print(`${t}:`)
      const kids = this.children(p, all)
      show(kids)
      if (o.R) for (const k of kids) if (k.dir) { ctx.print(''); walk(t.replace(/\/$/, '') + '/' + k.name, k.path, true) }
    }
    dirs.forEach(([t, p], k) => {
      if (k || files.length) ctx.print('')
      walk(t, p, files.length > 0 || dirs.length > 1 || o.R)
    })
    return status
  },
  dir(args, ctx) { return COMMANDS.ls.call(this, args, ctx) },
  tree(args, ctx) {
    const { o, rest } = getopts(args, 'ad', 'L')
    const max = o.L ? Number(o.L) : Infinity
    const start = rest[0] || '.'
    const root = this.resolve(start)
    if (!this.isDir(root)) { ctx.err(`tree: ${start}: フォルダがありません\n`); return 1 }
    let nd = 0, nf = 0
    ctx.print(`${ctx.tty ? C.bblue : ''}${start}${ctx.tty ? C.reset : ''}`)
    const walk = (p, prefix, depth) => {
      if (depth > max) return
      const kids = this.children(p, o.a).filter(k => !o.d || k.dir)
      kids.forEach((k, idx) => {
        const lastOne = idx === kids.length - 1
        const col = ctx.tty ? nameColor(k) : ''
        ctx.print(`${prefix}${lastOne ? '└── ' : '├── '}${col}${k.name}${col ? C.reset : ''}`)
        if (k.dir) { nd++; walk(k.path, prefix + (lastOne ? '    ' : '│   '), depth + 1) } else nf++
      })
    }
    walk(root, '', 1)
    ctx.print(`\n${nd} 個のフォルダ, ${nf} 個のファイル`)
    return 0
  },
  find(args, ctx) {
    const starts = []
    let k = 0
    while (k < args.length && !args[k].startsWith('-')) starts.push(args[k++])
    if (!starts.length) starts.push('.')
    let name = null, type = null, maxdepth = Infinity, mindepth = 0
    for (; k < args.length; k++) {
      const a = args[k]
      if (a === '-name' || a === '-iname') name = globRe(args[++k] || '*', a === '-iname' ? 'i' : '')
      else if (a === '-type') type = args[++k]
      else if (a === '-maxdepth') maxdepth = Number(args[++k])
      else if (a === '-mindepth') mindepth = Number(args[++k])
      else if (a === '-print') continue
      else { ctx.err(`find: ${a} は使えません (-name / -iname / -type / -maxdepth が使えます)\n`); return 1 }
    }
    let status = 0
    for (const s of starts) {
      const root = this.resolve(s)
      const st = this.stat(root)
      if (!st) { ctx.err(`find: '${s}' はありません\n`); status = 1; continue }
      const base = s.replace(/\/+$/, '') || s
      const visit = (p, shown, isDir, depth) => {
        const okType = !type || (type === 'd' ? isDir : !isDir)
        const okName = !name || name.test(baseName(shown))
        if (depth >= mindepth && okType && okName) ctx.print(shown)
        if (isDir && depth < maxdepth) for (const c of this.children(p, true)) visit(c.path, shown + '/' + c.name, c.dir, depth + 1)
      }
      visit(root, base, st.dir, 0)
    }
    return status
  },

  // ---- 中身 ----
  async cat(args, ctx) {
    const { o, rest } = getopts(args, 'nAbs')
    let status = 0, num = 0
    for (const it of await inputs(this, rest, ctx, 'cat')) {
      if (!it) { status = 1; continue }
      if (o.n || o.b) {
        const ls = it.text.split('\n')
        const tailNl = it.text.endsWith('\n')
        if (tailNl) ls.pop()
        ctx.out(ls.map(l => (o.b && !l ? '' : String(++num).padStart(6) + '\t') + l).join('\n') + (tailNl ? '\n' : ''))
      } else ctx.out(it.text)
    }
    return status
  },
  more(args, ctx) { return COMMANDS.cat.call(this, args, ctx) },
  less(args, ctx) { return COMMANDS.cat.call(this, args, ctx) },
  async head(args, ctx) {
    const { o, rest } = getopts(args, 'qv', 'nc', { num: 'n' })
    const n = Number(o.n || 10)
    const list = await inputs(this, rest, ctx, 'head')
    let status = 0
    list.forEach((it, k) => {
      if (!it) { status = 1; return }
      if (list.length > 1 && !o.q) ctx.print(`${k ? '\n' : ''}==> ${it.name} <==`)
      if (o.c) { ctx.out(it.text.slice(0, Number(o.c))); return }
      const ls = lines(it.text)
      const pick = n < 0 ? ls.slice(0, n) : ls.slice(0, n)
      if (pick.length) ctx.out(pick.join('\n') + '\n')
    })
    return status
  },
  async tail(args, ctx) {
    const { o, rest } = getopts(args, 'qvf', 'nc', { num: 'n' })
    const spec = String(o.n || 10)
    const list = await inputs(this, rest, ctx, 'tail')
    let status = 0
    list.forEach((it, k) => {
      if (!it) { status = 1; return }
      if (list.length > 1 && !o.q) ctx.print(`${k ? '\n' : ''}==> ${it.name} <==`)
      if (o.c) { ctx.out(it.text.slice(-Number(o.c))); return }
      const ls = lines(it.text)
      const pick = spec.startsWith('+') ? ls.slice(Number(spec.slice(1)) - 1) : ls.slice(Math.max(0, ls.length - Number(spec)))
      if (pick.length) ctx.out(pick.join('\n') + '\n')
    })
    return status
  },
  async wc(args, ctx) {
    const { o, rest } = getopts(args, 'lwcm')
    const all = !o.l && !o.w && !o.c && !o.m
    const rows = []
    let status = 0
    for (const it of await inputs(this, rest, ctx, 'wc')) {
      if (!it) { status = 1; continue }
      rows.push([(it.text.match(/\n/g) || []).length, (it.text.match(/\S+/g) || []).length, o.m ? [...it.text].length : new TextEncoder().encode(it.text).length, it.name === '-' ? '' : it.name])
    }
    if (rows.length > 1) rows.push([rows.reduce((a, r) => a + r[0], 0), rows.reduce((a, r) => a + r[1], 0), rows.reduce((a, r) => a + r[2], 0), '合計'])
    const w = Math.max(...rows.flatMap(r => [r[0], r[1], r[2]]).map(x => String(x).length), rest.length ? 3 : 1)
    for (const r of rows) {
      const cols = []
      if (all || o.l) cols.push(String(r[0]).padStart(w))
      if (all || o.w) cols.push(String(r[1]).padStart(w))
      if (all || o.c || o.m) cols.push(String(r[2]).padStart(w))
      ctx.print((rows.length === 1 && !rest.length && cols.length === 1 ? cols[0].trim() : cols.join(' ')) + (r[3] ? ' ' + r[3] : ''))
    }
    return status
  },
  async grep(args, ctx) {
    const { o, rest } = getopts(args, 'inrRvclLwxEFoHhqs', 'em')
    let pat = o.e
    if (pat === undefined) pat = rest.shift()
    if (pat === undefined) { ctx.err('grep: 探す文字を書いてください (例: grep print main.py)\n'); return 2 }
    let re
    try {
      const src = o.F ? pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : (o.E ? pat : bre(pat)).replace(/\\([<>])/g, '\\b')
      re = new RegExp(o.x ? `^(?:${src})$` : o.w ? `\\b(?:${src})\\b` : src, 'g' + (o.i ? 'i' : ''))
    } catch (e) { ctx.err(`grep: 正規表現が正しくありません: ${e.message}\n`); return 2 }
    const recursive = o.r || o.R
    let targets = rest
    if (!targets.length && recursive) targets = ['.']
    const list = []
    if (!targets.length) list.push({ name: '(標準入力)', text: ctx.stdin ?? '' })
    for (const t of targets) {
      const p = this.resolve(t)
      if (this.isDir(p)) {
        if (!recursive) { if (!o.s) ctx.err(`grep: ${t}: フォルダです (中も探すなら -r)\n`); continue }
        const walk = (dir, shown) => {
          for (const c of this.children(dir, false)) {
            const sp = shown === '.' ? c.name : shown.replace(/\/$/, '') + '/' + c.name
            if (c.dir) walk(c.path, sp)
            else list.push({ path: c.path, name: sp })
          }
        }
        walk(p, t)
      } else if (this.isFile(p)) list.push({ path: p, name: t })
      else if (!o.s) ctx.err(`grep: ${t}: ファイルがありません\n`)
    }
    const showName = o.H || (!o.h && (list.length > 1 || recursive))
    const color = ctx.tty
    const max = o.m ? Number(o.m) : Infinity
    let found = false
    for (const it of list) {
      const text = it.text ?? (await this.host.read(it.path)) ?? ''
      if (typeof text !== 'string' || text.includes('\0')) continue
      let count = 0
      const ls = lines(text)
      for (let k = 0; k < ls.length && count < max; k++) {
        const l = ls[k]
        re.lastIndex = 0
        const hit = re.test(l)
        if (hit === !!o.v) continue
        count++
        found = true
        if (o.q || o.l || o.L || o.c) continue
        const pre = (showName ? (color ? C.magenta + it.name + C.cyan + ':' + C.reset : it.name + ':') : '') + (o.n ? (color ? C.green + (k + 1) + C.cyan + ':' + C.reset : (k + 1) + ':') : '')
        if (o.o && !o.v) {
          re.lastIndex = 0
          let m
          while ((m = re.exec(l))) { if (!m[0]) { re.lastIndex++; continue } ctx.print(pre + (color ? C.bred + m[0] + C.reset : m[0])) }
          continue
        }
        re.lastIndex = 0
        ctx.print(pre + (color && !o.v ? l.replace(re, m => (m ? C.bred + m + C.reset : m)) : l))
      }
      if (o.c) ctx.print((showName ? (color ? C.magenta + it.name + C.cyan + ':' + C.reset : it.name + ':') : '') + count)
      if (o.l && count) ctx.print(color ? C.magenta + it.name + C.reset : it.name)
      if (o.L && !count) ctx.print(it.name)
      if (o.q && found) return 0
    }
    return found ? 0 : 1
  },

  // ---- 作る・消す・動かす ----
  async touch(args, ctx) {
    if (!args.length) { ctx.err('touch: ファイル名を書いてください\n'); return 1 }
    let status = 0
    for (const a of args.filter(x => !x.startsWith('-'))) {
      const p = this.resolve(a)
      if (this.isDir(p)) continue
      try { await this.writeText(a, this.isFile(p) ? (await this.host.read(p)) ?? '' : '') } catch (e) { ctx.err(`touch: ${e.message}\n`); status = 1 }
    }
    return status
  },
  async mkdir(args, ctx) {
    const { o, rest } = getopts(args, 'pv')
    if (!rest.length) { ctx.err('mkdir: フォルダ名を書いてください\n'); return 1 }
    let status = 0
    for (const a of rest) {
      const p = this.resolve(a)
      if (!p) continue
      if (this.stat(p)) { if (!o.p) { ctx.err(`mkdir: ${a}: もうあります\n`); status = 1 } continue }
      if (!o.p && dirName(p) && !this.isDir(dirName(p))) { ctx.err(`mkdir: ${a}: 上のフォルダがありません (-p を付けるとまとめて作ります)\n`); status = 1; continue }
      await this.fsMkdir(p)
      if (o.v) ctx.print(`フォルダを作りました: ${a}`)
    }
    return status
  },
  async rm(args, ctx) {
    const { o, rest } = getopts(args, 'rRfidv')
    if (!rest.length) { if (!o.f) { ctx.err('rm: 消すファイルを書いてください\n'); return 1 } return 0 }
    let status = 0
    for (const a of rest) {
      const p = this.resolve(a)
      if (!p) { ctx.err('rm: プロジェクト全体は消せません (プロジェクトの削除はプロジェクト一覧から)\n'); status = 1; continue }
      const st = this.stat(p)
      if (!st) { if (!o.f) { ctx.err(`rm: ${a}: ありません\n`); status = 1 } continue }
      if (st.dir && !(o.r || o.R) && !(o.d && !this.children(p, true).length)) { ctx.err(`rm: ${a}: フォルダです (中身ごと消すなら rm -r)\n`); status = 1; continue }
      await this.fsRemove(p)
      if (o.v) ctx.print(`削除しました: ${a}`)
    }
    return status
  },
  async rmdir(args, ctx) {
    let status = 0
    for (const a of args.filter(x => !x.startsWith('-'))) {
      const p = this.resolve(a)
      if (!this.isDir(p) || !p) { ctx.err(`rmdir: ${a}: フォルダではありません\n`); status = 1; continue }
      if (this.children(p, true).length) { ctx.err(`rmdir: ${a}: 空ではありません\n`); status = 1; continue }
      await this.fsRemove(p)
    }
    return status
  },
  async cp(args, ctx) {
    const { o, rest } = getopts(args, 'rRvfn')
    if (rest.length < 2) { ctx.err('cp: コピー元とコピー先を書いてください (例: cp a.py b.py)\n'); return 1 }
    const dest = rest.pop()
    const dp = this.resolve(dest)
    const intoDir = this.isDir(dp)
    if (rest.length > 1 && !intoDir) { ctx.err(`cp: ${dest}: フォルダではありません\n`); return 1 }
    let status = 0
    for (const s of rest) {
      const sp = this.resolve(s)
      const st = this.stat(sp)
      if (!st) { ctx.err(`cp: ${s}: ありません\n`); status = 1; continue }
      const target = intoDir ? (dp ? dp + '/' : '') + baseName(sp) : dp
      if (target === sp || target.startsWith(sp + '/')) { ctx.err(`cp: ${s}: 自分自身の中にはコピーできません\n`); status = 1; continue }
      if (o.n && this.stat(target)) continue
      if (st.dir) {
        if (!(o.r || o.R)) { ctx.err(`cp: ${s}: フォルダです (フォルダごとなら cp -r)\n`); status = 1; continue }
        const all = [...this.index().entries()].filter(([p]) => p.startsWith(sp + '/'))
        await this.fsMkdir(target)
        for (const [p, info] of all) {
          const np = target + p.slice(sp.length)
          if (info.dir) await this.fsMkdir(np)
          else await this.fsWrite(np, (await this.host.read(p)) ?? '')
        }
      } else {
        if (this.isDir(target)) { ctx.err(`cp: ${dest}: フォルダがあります\n`); status = 1; continue }
        await this.fsWrite(target, (await this.host.read(sp)) ?? '')
      }
      if (o.v) ctx.print(`'${s}' → '${showPath(target)}'`)
    }
    return status
  },
  async mv(args, ctx) {
    const { o, rest } = getopts(args, 'vfin')
    if (rest.length < 2) { ctx.err('mv: 移動元と移動先を書いてください (例: mv a.py b.py)\n'); return 1 }
    const dest = rest.pop()
    const dp = this.resolve(dest)
    const intoDir = this.isDir(dp)
    if (rest.length > 1 && !intoDir) { ctx.err(`mv: ${dest}: フォルダではありません\n`); return 1 }
    let status = 0
    for (const s of rest) {
      const sp = this.resolve(s)
      if (!sp || !this.stat(sp)) { ctx.err(`mv: ${s}: ありません\n`); status = 1; continue }
      const target = intoDir ? (dp ? dp + '/' : '') + baseName(sp) : dp
      if (target === sp) continue
      if (target.startsWith(sp + '/')) { ctx.err(`mv: ${s}: 自分自身の中には移動できません\n`); status = 1; continue }
      if (this.stat(target)) {
        if (o.n) continue
        if (this.isDir(target)) { ctx.err(`mv: ${showPath(target)}: もうあります\n`); status = 1; continue }
        await this.fsRemove(target)
      }
      const parent = dirName(target)
      if (parent && !this.isDir(parent)) { ctx.err(`mv: ${dest}: フォルダ ${showPath(parent)} がありません\n`); status = 1; continue }
      await this.fsRename(sp, target)
      if (o.v) ctx.print(`'${s}' → '${showPath(target)}'`)
    }
    return status
  },

  // ---- 文字 ----
  echo(args, ctx) {
    let nl = true, esc = false
    while (args.length && /^-[neE]+$/.test(args[0])) { const a = args.shift(); if (a.includes('n')) nl = false; if (a.includes('e')) esc = true; if (a.includes('E')) esc = false }
    const s = args.join(' ')
    ctx.out((esc ? escapes(s) : s) + (nl ? '\n' : ''))
    return 0
  },
  printf(args, ctx) {
    if (!args.length) { ctx.err('printf: 書式を書いてください (例: printf "%s さん\\n" 太郎)\n'); return 1 }
    const fmt = escapes(args[0])
    const vals = args.slice(1)
    let k = 0, out = ''
    do {
      out += fmt.replace(/%([-+0 #]*)(\d*)(?:\.(\d+))?([sdifxXoc%])/g, (m, flags, width, prec, c) => {
        if (c === '%') return '%'
        const v = vals[k++] ?? ''
        let s
        if (c === 's') s = prec ? String(v).slice(0, Number(prec)) : String(v)
        else if (c === 'd' || c === 'i') s = String(Math.trunc(Number(v) || 0))
        else if (c === 'f') s = (Number(v) || 0).toFixed(prec ? Number(prec) : 6)
        else if (c === 'x') s = (Number(v) || 0).toString(16)
        else if (c === 'X') s = (Number(v) || 0).toString(16).toUpperCase()
        else if (c === 'o') s = (Number(v) || 0).toString(8)
        else s = String(v)[0] || ''
        if (flags.includes('+') && /[dif]/.test(c) && Number(v) >= 0) s = '+' + s
        const w = Number(width || 0)
        if (s.length < w) s = flags.includes('-') ? s.padEnd(w) : s.padStart(w, flags.includes('0') && /[difxXo]/.test(c) ? '0' : ' ')
        return s
      })
    } while (k < vals.length && /%[^%]/.test(fmt))
    ctx.out(out)
    return 0
  },
  async sort(args, ctx) {
    const { o, rest } = getopts(args, 'rnufbV', 'kt')
    const all = []
    let status = 0
    for (const it of await inputs(this, rest, ctx, 'sort')) { if (!it) { status = 1; continue } all.push(...lines(it.text)) }
    const key = l => {
      if (!o.k) return l
      const f = l.split(o.t !== undefined ? o.t : /\s+/)
      return f[Number(String(o.k).split(',')[0]) - 1] ?? ''
    }
    const cmp = o.n ? (a, b) => (parseFloat(key(a)) || 0) - (parseFloat(key(b)) || 0) : o.f ? (a, b) => key(a).toLowerCase().localeCompare(key(b).toLowerCase()) : (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)
    let out = all.sort(cmp)
    if (o.r) out.reverse()
    if (o.u) out = out.filter((l, k) => !k || cmp(l, out[k - 1]) !== 0)
    if (out.length) ctx.out(out.join('\n') + '\n')
    return status
  },
  async uniq(args, ctx) {
    const { o, rest } = getopts(args, 'cdui')
    const it = (await inputs(this, rest.slice(0, 1), ctx, 'uniq'))[0]
    if (!it) return 1
    const groups = []
    for (const l of lines(it.text)) {
      const last = groups[groups.length - 1]
      if (last && (o.i ? last[0].toLowerCase() === l.toLowerCase() : last[0] === l)) last[1]++
      else groups.push([l, 1])
    }
    const out = groups.filter(([, n]) => (o.d ? n > 1 : o.u ? n === 1 : true)).map(([l, n]) => (o.c ? String(n).padStart(7) + ' ' + l : l))
    if (out.length) ctx.out(out.join('\n') + '\n')
    return 0
  },
  async cut(args, ctx) {
    const { o, rest } = getopts(args, 's', 'dfc')
    const pick = spec => {
      const set = []
      for (const part of String(spec).split(',')) {
        const m = /^(\d*)-(\d*)$/.exec(part)
        if (m) set.push([m[1] ? Number(m[1]) : 1, m[2] ? Number(m[2]) : Infinity])
        else set.push([Number(part), Number(part)])
      }
      return k => set.some(([a, b]) => k >= a && k <= b)
    }
    if (!o.f && !o.c) { ctx.err('cut: -f (列) か -c (文字の位置) を書いてください (例: cut -d , -f 1)\n'); return 1 }
    const it = (await inputs(this, rest, ctx, 'cut'))[0]
    if (!it) return 1
    const d = o.d === undefined ? '\t' : o.d
    const out = []
    for (const l of lines(it.text)) {
      if (o.c) { const sel = pick(o.c); out.push([...l].filter((_, k) => sel(k + 1)).join('')); continue }
      if (!l.includes(d)) { if (!o.s) out.push(l); continue }
      const sel = pick(o.f)
      out.push(l.split(d).filter((_, k) => sel(k + 1)).join(d))
    }
    if (out.length) ctx.out(out.join('\n') + '\n')
    return 0
  },
  tr(args, ctx) {
    const { o, rest } = getopts(args, 'ds')
    const a = expandSet(rest[0] || ''), b = expandSet(rest[1] || '')
    const text = ctx.stdin ?? ''
    let out = ''
    for (const ch of text) {
      const k = a.indexOf(ch)
      if (k < 0) { out += ch; continue }
      if (o.d) continue
      out += b ? b[Math.min(k, b.length - 1)] : ch
    }
    if (o.s && b) out = out.replace(new RegExp(`([${b.replace(/[\]\\^-]/g, '\\$&')}])\\1+`, 'g'), '$1')
    ctx.out(out)
    return 0
  },
  async sed(args, ctx) {
    const { o, rest } = getopts(args, 'inE', 'e')
    const script = o.e ?? rest.shift()
    if (!script) { ctx.err('sed: 置き換えを書いてください (例: sed "s/old/new/g" file.py)\n'); return 1 }
    const cmds = []
    for (const part of script.split(/;(?=\s*(?:s|\d|\/|\$))/)) {
      const s = part.trim()
      let m
      const sub = parseSubst(s)
      if (sub) {
        let re
        try { re = new RegExp(o.E ? sub.re : bre(sub.re), (sub.flags.includes('g') ? 'g' : '') + (sub.flags.includes('i') ? 'i' : '')) } catch (e) { ctx.err(`sed: 正規表現が正しくありません: ${e.message}\n`); return 1 }
        cmds.push({ kind: 's', re, rep: sedRepl(sub.rep), print: sub.flags.includes('p') })
      } else if ((m = /^(\d+|\$)?(?:,(\d+|\$))?([dp])$/.exec(s))) cmds.push({ kind: m[3], from: m[1], to: m[2] })
      else if ((m = /^\/(.*)\/([dp])$/.exec(s))) cmds.push({ kind: m[2], re: new RegExp(m[1]) })
      else { ctx.err(`sed: ${s} は使えません (s/前/後/g・数字d・/文字/d が使えます)\n`); return 1 }
    }
    const apply = text => {
      const ls = text.split('\n')
      const tailNl = text.endsWith('\n')
      if (tailNl) ls.pop()
      const out = []
      ls.forEach((l, k) => {
        const n = k + 1
        let del = false, printed = false
        const inRange = c => {
          if (c.re) return c.re.test(l)
          const last = ls.length
          const a = c.from === '$' ? last : c.from ? Number(c.from) : null
          const b = c.to === '$' ? last : c.to ? Number(c.to) : a
          return a === null ? true : n >= a && n <= b
        }
        for (const c of cmds) {
          if (c.kind === 's') { const nl = l.replace(c.re, c.rep); if (nl !== l && c.print) printed = true; l = nl }
          else if (c.kind === 'd' && inRange(c)) { del = true; break }
          else if (c.kind === 'p' && inRange(c)) out.push(l)
        }
        if (printed && o.n) out.push(l)
        if (!del && !o.n) out.push(l)
      })
      return out.join('\n') + (tailNl && out.length ? '\n' : '')
    }
    if (o.i) {
      if (!rest.length) { ctx.err('sed -i: 書き換えるファイルを書いてください\n'); return 1 }
      for (const f of rest) {
        const t = await this.readText(f)
        if (t === null) { ctx.err(`sed: ${f}: ファイルがありません\n`); return 1 }
        await this.writeText(f, apply(t))
      }
      return 0
    }
    let status = 0
    for (const it of await inputs(this, rest, ctx, 'sed')) { if (!it) { status = 1; continue } ctx.out(apply(it.text)) }
    return status
  },
  async tee(args, ctx) {
    const { o, rest } = getopts(args, 'a')
    const text = ctx.stdin ?? ''
    for (const f of rest) {
      const before = o.a ? (await this.readText(f)) || '' : ''
      await this.writeText(f, before + text)
    }
    ctx.out(text)
    return 0
  },
  seq(args, ctx) {
    const nums = args.filter(a => !/^-[a-z]/.test(a)).map(Number)
    if (!nums.length || nums.some(isNaN)) { ctx.err('seq: 数を書いてください (例: seq 1 10)\n'); return 1 }
    const [first, step, last] = nums.length === 1 ? [1, 1, nums[0]] : nums.length === 2 ? [nums[0], 1, nums[1]] : nums
    if (!step) { ctx.err('seq: 増やす数が 0 です\n'); return 1 }
    const out = []
    for (let x = first; step > 0 ? x <= last : x >= last; x += step) { out.push(String(Math.round(x * 1e10) / 1e10)); if (out.length > 1e6) break }
    if (out.length) ctx.out(out.join('\n') + '\n')
    return 0
  },
  async diff(args, ctx) {
    const { rest } = getopts(args, 'uq')
    if (rest.length !== 2) { ctx.err('diff: 2 つのファイルを書いてください (例: diff a.py b.py)\n'); return 2 }
    const [a, b] = await Promise.all(rest.map(f => this.readText(f)))
    if (a === null || b === null) { ctx.err(`diff: ${a === null ? rest[0] : rest[1]}: ファイルがありません\n`); return 2 }
    if (a === b) return 0
    const ops = diffLines(lines(a), lines(b))
    if (!ops) { ctx.print(`ファイル ${rest[0]} と ${rest[1]} は違います (大きすぎて差分を出せません)`); return 1 }
    const col = ctx.tty
    ctx.print(`${col ? C.bold : ''}--- ${rest[0]}\n+++ ${rest[1]}${col ? C.reset : ''}`)
    // 変わったところと前後 3 行だけ
    const keep = new Set()
    ops.forEach((op, k) => { if (op[0] !== ' ') for (let d = -3; d <= 3; d++) keep.add(k + d) })
    let lastK = -2
    ops.forEach((op, k) => {
      if (!keep.has(k)) return
      if (k !== lastK + 1) ctx.print(`${col ? C.cyan : ''}@@ ${op[2] + 1} 行目付近 @@${col ? C.reset : ''}`)
      lastK = k
      const c = op[0] === '-' ? C.red : op[0] === '+' ? C.green : ''
      ctx.print((col && c ? c : '') + op[0] + op[1] + (col && c ? C.reset : ''))
    })
    return 1
  },

  // ---- 変数・別名 ----
  env(args, ctx) {
    for (const [k, v] of Object.entries({ ...this.env, PWD: showPath(this.cwd) }).sort()) ctx.print(`${k}=${v}`)
    return 0
  },
  printenv(args, ctx) {
    if (!args.length) return COMMANDS.env.call(this, args, ctx)
    let status = 0
    for (const a of args) { const v = this.varValue(a); if (v === '' && !(a in this.env)) status = 1; else ctx.print(v) }
    return status
  },
  export(args, ctx) {
    if (!args.length) { for (const [k, v] of Object.entries(this.env).sort()) ctx.print(`export ${k}="${v}"`); return 0 }
    for (const a of args) { const m = /^([A-Za-z_]\w*)=(.*)$/s.exec(a); if (m) this.env[m[1]] = m[2]; else if (!(a in this.env)) this.env[a] = '' }
    return 0
  },
  set(args, ctx) { return COMMANDS.env.call(this, args, ctx) },
  unset(args) { for (const a of args) delete this.env[a]; return 0 },
  alias(args, ctx) {
    if (!args.length) { for (const [k, v] of Object.entries(this.aliases).sort()) ctx.print(`alias ${k}='${v}'`); return 0 }
    let status = 0
    for (const a of args) {
      const m = /^([^=\s]+)=(.*)$/s.exec(a)
      if (m) this.aliases[m[1]] = m[2]
      else if (a in this.aliases) ctx.print(`alias ${a}='${this.aliases[a]}'`)
      else { ctx.err(`alias: ${a}: ありません\n`); status = 1 }
    }
    if (ctx.term && ctx.term.saveState) ctx.term.saveState()
    return status
  },
  unalias(args) { for (const a of args) delete this.aliases[a]; return 0 },
  which(args, ctx) {
    let status = 0
    for (const a of args) {
      if (a in this.aliases) ctx.print(`${a}: 別名 (${this.aliases[a]})`)
      else if (COMMANDS[a]) ctx.print(a === 'python' || a === 'pip' ? `/usr/bin/${a}` : `${a}: 組み込みコマンド`)
      else { ctx.err(`${a} は見つかりません\n`); status = 1 }
    }
    return status
  },
  type(args, ctx) { return COMMANDS.which.call(this, args, ctx) },

  // ---- 情報 ----
  date(args, ctx) {
    const d = new Date()
    const fmt = args.find(a => a.startsWith('+'))
    if (fmt) { ctx.print(strftime(fmt.slice(1), d)); return 0 }
    if (args.includes('-I') || args.includes('--iso-8601')) { ctx.print(strftime('%F', d)); return 0 }
    ctx.print(strftime('%Y年 %m月 %d日 %A %T %Z', d))
    return 0
  },
  cal(args, ctx) {
    const d = new Date()
    const y = d.getFullYear(), m = d.getMonth()
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate()
    ctx.print(`      ${y}年 ${m + 1}月`)
    ctx.print('日 月 火 水 木 金 土')
    let row = '   '.repeat(first)
    for (let k = 1; k <= days; k++) {
      const cell = String(k).padStart(2)
      row += (k === d.getDate() && ctx.tty ? `\x1b[7m${cell}\x1b[27m` : cell) + ' '
      if ((first + k) % 7 === 0) { ctx.print(row.trimEnd()); row = '' }
    }
    if (row.trim()) ctx.print(row.trimEnd())
    return 0
  },
  async sleep(args, ctx) {
    const sec = args.reduce((a, s) => { const m = /^(\d*\.?\d+)([smhd]?)$/.exec(s); return a + (m ? Number(m[1]) * ({ '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]]) : NaN) }, 0)
    if (!args.length || isNaN(sec)) { ctx.err('sleep: 秒数を書いてください (例: sleep 2)\n'); return 1 }
    await sleep(sec * 1000, ctx.signal)
    return 0
  },
  async time(args, ctx) {
    const t0 = performance.now()
    const st = args.length ? await this.exec(args, ctx) : 0
    const s = (performance.now() - t0) / 1000
    ctx.err(`\nreal\t${Math.floor(s / 60)}m${(s % 60).toFixed(3)}s\n`)
    return st
  },
  true() { return 0 },
  false() { return 1 },
  ':'() { return 0 },
  whoami(args, ctx) { ctx.print(this.env.USER || 'forge'); return 0 },
  hostname(args, ctx) { ctx.print('forgecode'); return 0 },
  uname(args, ctx) {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'node'
    const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Web'
    ctx.print(args.some(a => /a/.test(a)) ? `ForgeCode forgecode ${this.host.pyVersion ? this.host.pyVersion() : 'Python 3'} (Pyodide / WebAssembly) ${os}` : 'ForgeCode')
    return 0
  },
  uptime(args, ctx) {
    const up = typeof performance !== 'undefined' ? performance.now() : Date.now() - this.started
    const run = this.host.running ? this.host.running() : null
    ctx.print(`${strftime('%T', new Date())}  アプリの起動から ${fmtDuration(up)}${run ? `  ・  ${run.name} を実行中 ${fmtDuration(run.ms)}` : ''}`)
    return 0
  },
  async free(args, ctx) {
    const pm = typeof performance !== 'undefined' && performance.memory
    const dm = typeof navigator !== 'undefined' && navigator.deviceMemory
    if (pm) ctx.print(`このページ: 使用 ${human(pm.usedJSHeapSize)} / 確保 ${human(pm.totalJSHeapSize)} / 上限 ${human(pm.jsHeapSizeLimit)}`)
    if (dm) ctx.print(`端末のメモリ: 約 ${dm} GB`)
    if (!pm && !dm) ctx.print('このブラウザではメモリの量を調べられません')
    return 0
  },
  async df(args, ctx) {
    const e = this.host.storage ? await this.host.storage() : null
    if (!e) { ctx.print('容量を調べられません'); return 1 }
    ctx.print(`使用 ${human(e.usage || 0)} / 上限 約 ${human(e.quota || 0)} (${((e.usage || 0) / Math.max(1, e.quota || 1) * 100).toFixed(1)}%)`)
    return 0
  },
  du(args, ctx) {
    const { o, rest } = getopts(args, 'shac')
    const fmt = n => (o.h ? human(n) : String(Math.ceil(n / 1024)))
    for (const t of rest.length ? rest : ['.']) {
      const p = this.resolve(t)
      if (!this.stat(p)) { ctx.err(`du: ${t}: ありません\n`); continue }
      const sizeOf = q => { let n = 0; for (const [path, s] of this.index()) if (!s.dir && (path === q || path.startsWith(q ? q + '/' : ''))) n += s.size; return n }
      if (!o.s) {
        for (const c of this.children(p, true)) if (c.dir || o.a) ctx.print(`${fmt(sizeOf(c.path))}\t${t === '.' ? '' : t.replace(/\/$/, '') + '/'}${c.name}`)
      }
      ctx.print(`${fmt(sizeOf(p))}\t${t}`)
    }
    return 0
  },
  stat(args, ctx) {
    let status = 0
    for (const a of args) {
      const p = this.resolve(a)
      const s = this.stat(p)
      if (!s) { ctx.err(`stat: ${a}: ありません\n`); status = 1; continue }
      ctx.print(`  名前: ${showPath(p)}\n  種類: ${s.dir ? 'フォルダ' : 'ファイル'}\n大きさ: ${s.dir ? '-' : s.size + ' 文字'}\n  更新: ${s.mtime ? new Date(s.mtime).toLocaleString('ja-JP') : '-'}`)
    }
    return status
  },
  async file(args, ctx) {
    let status = 0
    for (const a of args) {
      const p = this.resolve(a)
      if (this.isDir(p)) { ctx.print(`${a}: フォルダ`); continue }
      if (!this.isFile(p)) { ctx.err(`file: ${a}: ありません\n`); status = 1; continue }
      const c = await this.host.read(p)
      ctx.print(`${a}: ${kindOf(a, c)}${isBin(c) ? ` (${humanSize(c.length)})` : `, ${(c.match(/\n/g) || []).length} 行`}`)
    }
    return status
  },
  basename(args, ctx) { if (!args[0]) return 1; let b = baseName(args[0].replace(/\/+$/, '')); if (args[1] && b.endsWith(args[1])) b = b.slice(0, -args[1].length); ctx.print(b); return 0 },
  dirname(args, ctx) { if (!args[0]) return 1; ctx.print(dirName(args[0].replace(/\/+$/, '')) || '.'); return 0 },
  realpath(args, ctx) { for (const a of args) ctx.print(PY_ROOT + (this.resolve(a) ? '/' + this.resolve(a) : '')); return 0 },
  history(args, ctx) {
    if (!ctx.term) return 0
    if (args[0] === '-c') { ctx.term.clearHistory(); return 0 }
    const h = ctx.term.historyList()
    const n = args[0] ? Number(args[0]) : h.length
    h.slice(-n).forEach((l, k) => ctx.print(`${String(h.length - Math.min(n, h.length) + k + 1).padStart(5)}  ${l}`))
    return 0
  },
  clear(args, ctx) { if (ctx.term) ctx.term.clear(); return 0 },
  reset(args, ctx) { if (ctx.term) ctx.term.clear(); return 0 },
  exit(args, ctx) {
    const code = Number(args[0]) || 0
    if (this.args.length) throw new Flow('exit', code)   // スクリプトの中: スクリプトだけ終える
    if (ctx.term) ctx.term.exit()
    return code
  },
  logout(args, ctx) { return COMMANDS.exit.call(this, args, ctx) },

  // ---- アプリ ----
  async open(args, ctx) {
    if (!args.length) { ctx.err('open: 開くファイルを書いてください\n'); return 1 }
    let status = 0
    for (const a of args.filter(x => !x.startsWith('-') && !x.startsWith('+'))) {
      const m = /^(.*?):(\d+)$/.exec(a)
      const name = m && !this.stat(this.resolve(a)) ? m[1] : a
      const p = this.resolve(name)
      if (this.isDir(p)) { ctx.err(`open: ${a}: フォルダです\n`); status = 1; continue }
      if (!this.isFile(p)) { await this.writeText(name, ''); ctx.print(`新しいファイルを作りました: ${name}`) }
      await this.host.open(p, m ? Number(m[2]) : 0)
    }
    return status
  },
  code(args, ctx) { return COMMANDS.open.call(this, args, ctx) },
  edit(args, ctx) { return COMMANDS.open.call(this, args, ctx) },
  nano(args, ctx) { return COMMANDS.open.call(this, args, ctx) },
  vim(args, ctx) { return COMMANDS.open.call(this, args, ctx) },
  vi(args, ctx) { return COMMANDS.open.call(this, args, ctx) },
  async run(args, ctx) {
    const f = args[0]
    if (f && !this.isFile(this.resolve(f))) { ctx.err(`run: ${f}: ファイルがありません\n`); return 1 }
    await this.host.runFile(f ? this.resolve(f) : null)
    return 0
  },
  async git(args, ctx) {
    const sub = args[0]
    if (sub === 'push' || sub === 'commit') { ctx.print('GitHub に保存します…'); await this.host.command('githubPush'); return 0 }
    if (sub === 'pull' || sub === 'fetch' || sub === 'clone') { ctx.print('GitHub から取り込みます…'); await this.host.command('githubPull'); return 0 }
    ctx.print('このアプリの git は「GitHub と同期」につながっています:\n  git push  … GitHub に保存\n  git pull  … GitHub から取り込む\n設定は 設定 → 保存 → GitHub と同期 から')
    return sub ? 1 : 0
  },
  ps(args, ctx) {
    const run = this.host.running ? this.host.running() : null
    ctx.print('  PID   時間  コマンド')
    ctx.print(`    1   ${fmtDuration((typeof performance !== 'undefined' ? performance.now() : 0))}  forgesh`)
    if (run) ctx.print(`    2   ${fmtDuration(run.ms)}  python ${run.name}`)
    return 0
  },
  async kill(args, ctx) {
    const run = this.host.running ? this.host.running() : null
    if (!run) { ctx.err('kill: 実行中のプログラムはありません\n'); return 1 }
    await this.host.command('stop')
    ctx.print(`止めました: ${run.name}`)
    return 0
  },
  async curl(args, ctx) {
    const { o, rest } = getopts(args, 'sSLfIiOkv', 'oXdHA')
    const url = rest[0]
    if (!url) { ctx.err('curl: URL を書いてください (例: curl https://example.com/data.csv -o data.csv)\n'); return 2 }
    if (!/^https?:\/\//.test(url)) { ctx.err('curl: http:// か https:// で始まる URL を書いてください\n'); return 3 }
    const init = { method: o.X || (o.d !== undefined ? 'POST' : o.I ? 'HEAD' : 'GET'), headers: {} }
    if (o.H) { const m = /^([^:]+):\s*(.*)$/.exec(o.H); if (m) init.headers[m[1]] = m[2] }
    if (o.d !== undefined) { init.body = o.d; if (!init.headers['Content-Type']) init.headers['Content-Type'] = 'application/x-www-form-urlencoded' }
    let res
    try { res = await this.host.fetch(url, { ...init, signal: ctx.signal }) } catch (e) {
      if (e && e.name === 'AbortError') throw e
      ctx.err(`curl: 読み込めませんでした (${e && e.message || e})。相手のサーバーがブラウザからの読み込み (CORS) を許可していないと、読み込めません\n`)
      return 7
    }
    if (o.I || o.i) { ctx.print(`HTTP ${res.status} ${res.statusText}`); res.headers.forEach((v, k) => ctx.print(`${k}: ${v}`)); if (o.I) return 0; ctx.print('') }
    if (o.f && !res.ok) { ctx.err(`curl: HTTP ${res.status}\n`); return 22 }
    const text = await res.text()
    const name = o.O ? baseName(new URL(url).pathname) || 'index.html' : o.o
    if (name) { await this.writeText(name, text); if (!o.s) ctx.err(`保存しました: ${name} (${human(text.length)})\n`) }
    else ctx.out(text)
    return 0
  },
  async wget(args, ctx) {
    const { o, rest } = getopts(args, 'qc', 'O')
    const url = rest[0]
    if (!url) { ctx.err('wget: URL を書いてください\n'); return 1 }
    let name = o.O
    if (!name) { try { name = baseName(new URL(url).pathname) || 'index.html' } catch { name = 'index.html' } }
    if (name === '-') return COMMANDS.curl.call(this, ['-s', url], ctx)
    return COMMANDS.curl.call(this, [url, '-o', name, ...(o.q ? ['-s'] : [])], ctx)
  },

  // ---- スクリプト・制御 ----
  test(args) { return testExpr(args, this) ? 0 : 1 },
  '['(args, ctx) {
    if (args[args.length - 1] !== ']') { ctx.err('[: ] がありません\n'); return 2 }
    return testExpr(args.slice(0, -1), this) ? 0 : 1
  },
  '[['(args, ctx) {
    if (args[args.length - 1] !== ']]') { ctx.err('[[: ]] がありません\n'); return 2 }
    return testExpr(args.slice(0, -1), this) ? 0 : 1
  },
  async read(args, ctx) {
    const { o, rest } = getopts(args, 'rs', 'pn')
    let line
    if (ctx.stdinStream) line = ctx.stdinStream.readLine()
    else if (ctx.term && ctx.term.readLine) { if (o.p) ctx.out(o.p); line = await ctx.term.readLine({ password: !!o.s }) }
    else line = null
    if (line === null || line === undefined) return 1
    if (!o.r) line = line.replace(/\\(.)/g, '$1')
    const names = rest.length ? rest : ['REPLY']
    const parts = line.trim().split(/\s+/)
    names.forEach((n, k) => this.setVar(n, k === names.length - 1 ? parts.slice(k).join(' ') : parts[k] ?? ''))
    return 0
  },
  break() { throw new Flow('break') },
  continue() { throw new Flow('continue') },
  return(args) { throw new Flow('return', Number(args[0]) || 0) },
  local(args) {
    const scope = this.locals[this.locals.length - 1]
    for (const a of args) { const m = /^([A-Za-z_]\w*)(?:=(.*))?$/s.exec(a); if (m) { if (scope) scope[m[1]] = m[2] ?? ''; else this.env[m[1]] = m[2] ?? '' } }
    return 0
  },
  shift(args) {
    const top = this.args[this.args.length - 1]
    if (top) top.splice(0, Number(args[0]) || 1)
    return 0
  },
  expr(args, ctx) {
    const v = arith(args.join(' '), n => this.varValue(n))
    ctx.print(String(v))
    return v === 0 ? 1 : 0
  },
  let(args) {
    let v = 0
    for (const a of args) {
      const m = /^([A-Za-z_]\w*)\s*([-+*/%]?)=(.*)$/s.exec(a)
      if (m) { const cur = Number(this.varValue(m[1])) || 0; const val = arith(m[3], n => this.varValue(n)); v = m[2] ? arith(`${cur} ${m[2]} ${val}`, () => 0) : val; this.setVar(m[1], String(v)) }
      else v = arith(a, n => this.varValue(n))
    }
    return v === 0 ? 1 : 0
  },
  async source(args, ctx) {
    if (!args[0]) { ctx.err('source: ファイル名を書いてください\n'); return 2 }
    return this.runScript(args[0], args.slice(1), ctx, { subshell: false })
  },
  '.'(args, ctx) { return COMMANDS.source.call(this, args, ctx) },
  async sh(args, ctx) {
    if (args[0] === '-c') {
      const saved = { cwd: this.cwd, env: { ...this.env } }
      try { return await this.run(args[1] || '', { ...ctx.io, out: ctx.out, err: ctx.err, stdin: ctx.stdinStream }) } finally { this.cwd = saved.cwd; this.env = saved.env }
    }
    if (!args[0]) { ctx.err('sh: スクリプトのファイル名を書いてください (例: sh run.sh)\n'); return 2 }
    return this.runScript(args[0], args.slice(1), ctx)
  },
  bash(args, ctx) { return COMMANDS.sh.call(this, args, ctx) },
  // ---- 便利なコマンド ----
  async xargs(args, ctx) {
    // オプションは、実行するコマンドの前だけ
    const o = {}
    let k0 = 0
    for (; k0 < args.length && args[k0].startsWith('-'); k0++) {
      const a = args[k0]
      if (a === '-n' || a === '-I') o[a[1]] = args[++k0]
      else if (/^-n\d+$/.test(a)) o.n = a.slice(2)
      else for (const f of a.slice(1)) o[f] = true
    }
    const rest = args.slice(k0)
    const cmd = rest.length ? rest : ['echo']
    const text = ctx.stdin ?? ''
    if (o.I !== undefined) {
      let status = 0
      for (const line of lines(text)) {
        if (!line && o.r) continue
        const argv = cmd.map(a => a.split(o.I).join(line))
        if (o.t) ctx.err(argv.join(' ') + '\n')
        status = await this.exec(argv, { ...ctx }) || status
      }
      return status
    }
    const items = text.split(o['0'] ? '\0' : /\s+/).filter(Boolean)
    if (!items.length && o.r) return 0
    const n = o.n ? Math.max(1, Number(o.n)) : items.length || 1
    let status = 0
    for (let k = 0; k < Math.max(items.length, 1); k += n) {
      const argv = [...cmd, ...items.slice(k, k + n)]
      if (o.t) ctx.err(argv.join(' ') + '\n')
      status = await this.exec(argv, { ...ctx }) || status
    }
    return status
  },
  async watch(args, ctx) {
    const { o, rest } = getopts(args, 't', 'n')
    if (!rest.length) { ctx.err('watch: 繰り返すコマンドを書いてください (例: watch -n 5 ls -l)\n'); return 1 }
    const sec = Math.max(0.5, Number(o.n) || 2)
    const line = rest.join(' ')
    for (;;) {
      if (ctx.term) ctx.term.clear()
      if (!o.t) ctx.print(`${C.gray}${sec} 秒ごと: ${line}    ${strftime('%T', new Date())}  (Ctrl+C で止める)${C.reset}\n`)
      await this.run(line, { ...ctx.io, out: ctx.out, err: ctx.err })
      await sleep(sec * 1000, ctx.signal)
    }
  },
  async zip(args, ctx) {
    const { o, rest } = getopts(args, 'rq')
    if (rest.length < 2) { ctx.err('zip: 作る ZIP と入れるファイルを書いてください (例: zip -r out.zip src)\n'); return 1 }
    const [name, ...srcs] = rest
    const { zipSync } = await import('../../vendor/fflate.js')
    const obj = {}
    for (const sname of srcs) {
      const p = this.resolve(sname)
      const st = this.stat(p)
      if (!st) { ctx.err(`zip: ${sname}: ありません\n`); continue }
      const add = async (path, rel) => { const c = await this.host.read(path); obj[rel] = isBin(c) ? c : new TextEncoder().encode(c ?? '') }
      if (st.dir) {
        if (!o.r) { ctx.err(`zip: ${sname}: フォルダです (-r を付けてください)\n`); continue }
        for (const [k, info] of this.index()) if (!info.dir && k.startsWith(p ? p + '/' : '')) await add(k, (sname.replace(/\/+$/, '') + '/' + k.slice(p ? p.length + 1 : 0)).replace(/^\.\//, ''))
      } else await add(p, baseName(p))
      if (!o.q) ctx.print(`  追加: ${sname}`)
    }
    await this.fsWrite(this.resolve(name), zipSync(obj, { level: 6 }))
    return 0
  },
  async unzip(args, ctx) {
    const { o, rest } = getopts(args, 'lqo', 'd')
    const name = rest[0]
    if (!name) { ctx.err('unzip: ZIP のファイル名を書いてください\n'); return 1 }
    const data = this.isFile(this.resolve(name)) ? await this.host.read(this.resolve(name)) : null
    if (!isBin(data)) { ctx.err(`unzip: ${name}: ZIP ファイルがありません\n`); return 1 }
    const { unzipSync } = await import('../../vendor/fflate.js')
    let entries
    try { entries = unzipSync(data) } catch { ctx.err(`unzip: ${name}: ZIP として読めません\n`); return 1 }
    const dest = o.d ? this.resolve(o.d) : this.cwd
    for (const [rel, bytes] of Object.entries(entries)) {
      if (rel.endsWith('/') || rel.startsWith('__MACOSX') || rel.split('/').includes('..')) continue
      if (o.l) { ctx.print(`${String(bytes.length).padStart(9)}  ${rel}`); continue }
      const target = resolvePath(dest, rel)
      if (dirName(target) && !this.isDir(dirName(target))) await this.fsMkdir(dirName(target))
      await this.fsWrite(target, bytesToContent(bytes, rel))
      if (!o.q) ctx.print(`  展開: ${rel}`)
    }
    return 0
  },
  async base64(args, ctx) {
    const { o, rest } = getopts(args, 'dw', '')
    let data
    if (rest[0]) { const p = this.resolve(rest[0]); data = this.isFile(p) ? await this.host.read(p) : null; if (data === null) { ctx.err(`base64: ${rest[0]}: ありません\n`); return 1 } } else data = ctx.stdin ?? ''
    if (o.d) {
      const bin = atob(String(data).replace(/\s+/g, ''))
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
      ctx.out(new TextDecoder().decode(bytes))
      return 0
    }
    const bytes = isBin(data) ? data : new TextEncoder().encode(data)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    ctx.print(btoa(bin).replace(/(.{76})/g, '$1\n').replace(/\n$/, ''))
    return 0
  },
  async sha256sum(args, ctx) {
    const list = args.length ? args : ['-']
    for (const f of list) {
      let data
      if (f === '-') data = ctx.stdin ?? ''
      else { const p = this.resolve(f); data = this.isFile(p) ? await this.host.read(p) : null; if (data === null) { ctx.err(`sha256sum: ${f}: ありません\n`); continue } }
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', isBin(data) ? data : new TextEncoder().encode(data)))
      ctx.print(`${[...d].map(b => b.toString(16).padStart(2, '0')).join('')}  ${f}`)
    }
    return 0
  },
  async nl(args, ctx) {
    const it = (await inputs(this, args.filter(a => !a.startsWith('-')), ctx, 'nl'))[0]
    if (!it) return 1
    let n = 0
    ctx.out(lines(it.text).map(l => (l.trim() ? String(++n).padStart(6) + '\t' + l : '')).join('\n') + '\n')
    return 0
  },
  async rev(args, ctx) {
    const it = (await inputs(this, args, ctx, 'rev'))[0]
    if (!it) return 1
    ctx.out(lines(it.text).map(l => [...l].reverse().join('')).join('\n') + '\n')
    return 0
  },
  async yes(args, ctx) {
    const text = (args.join(' ') || 'y') + '\n'
    for (let k = 0; k < 10000; k++) { ctx.out(text); if (k % 200 === 0) await this.tick(ctx.io) }
    return 0
  },
  async cloud(args, ctx) {
    if (!this.host.cloud) { ctx.err('cloud: この環境では使えません\n'); return 1 }
    return this.host.cloud(args[0] || 'status', args.slice(1), ctx)
  },

  // ---- Python ----
  async python(args, ctx) {
    const argv = [...args]
    let stdinText = ctx.stdin   // パイプ・< の中身 (1 度だけ読む)
    let mode = null, payload = null, interactive = false
    while (argv.length && argv[0].startsWith('-') && argv[0] !== '-') {
      const a = argv.shift()
      if (a === '-c') { mode = 'c'; payload = argv.shift(); break }
      if (a === '-m') { mode = 'm'; payload = argv.shift(); break }
      if (a === '-V' || a === '--version') { ctx.print(this.host.pyVersion ? this.host.pyVersion() : 'Python 3.14'); return 0 }
      if (a === '-h' || a === '--help') { return COMMANDS.help.call(this, ['python'], ctx) }
      if (a === '-i') { interactive = true; continue }
      if (/^-[uBOEsSIq]+$/.test(a)) continue
      if (a === '-X' || a === '-W') { argv.shift(); continue }
      ctx.err(`python: ${a} は使えないオプションです\n`)
      return 2
    }
    if ((mode === 'c' || mode === 'm') && payload === undefined) { ctx.err(`python: ${mode === 'c' ? '-c の後にコード' : '-m の後にモジュール名'}を書いてください\n`); return 2 }
    if (mode === 'm' && payload === 'pip') return COMMANDS.pip.call(this, argv, ctx)
    let entry = null, source = null, sysArgv
    if (mode === 'c') { source = payload; entry = '<string>'; sysArgv = ['-c', ...argv] }
    else if (mode === 'm') {
      source = `import runpy\nrunpy.run_module(${JSON.stringify(payload)}, run_name="__main__", alter_sys=True)\n`
      entry = '<module>'
      sysArgv = [payload, ...argv]
    } else if (argv.length && argv[0] !== '-') {
      const file = argv[0]
      const p = this.resolve(file)
      if (this.isDir(p)) {
        if (!this.isFile(p ? p + '/__main__.py' : '__main__.py')) { ctx.err(`python: ${file}: __main__.py がありません\n`); return 2 }
        entry = (p ? p + '/' : '') + '__main__.py'
      } else if (!this.isFile(p)) { ctx.err(`python: '${file}' を開けません: ファイルがありません\n`); return 2 }
      else entry = p
      sysArgv = [file, ...argv.slice(1)]
    } else if (stdinText !== null && stdinText !== undefined && !interactive) {
      // echo 'print(1)' | python
      source = stdinText
      entry = '<stdin>'
      sysArgv = ['-', ...argv.slice(1)]
      stdinText = ''
    } else {
      if (!ctx.term) { ctx.err('python: 対話モードはターミナルで使えます\n'); return 1 }
      ctx.term.startRepl({ ns: 'repl-new' })
      return 0
    }
    const code = await this.host.python({ entry, source, argv: sysArgv, cwd: this.cwd, stdin: stdinText, out: ctx.out, err: ctx.err, tty: ctx.tty, signal: ctx.signal, term: ctx.term })
    if (interactive && ctx.term) ctx.term.startRepl({ ns: 'last' })
    return code
  },
  async pip(args, ctx) {
    const sub = args[0]
    if (!sub || sub === 'help' || sub === '-h' || sub === '--help') {
      ctx.print('pip install 名前 … PyPI からライブラリを入れる (pure Python のもの)\npip install -r requirements.txt\npip list / pip freeze / pip show 名前 / pip uninstall 名前')
      return 0
    }
    if (sub === '--version' || sub === '-V') { ctx.print('pip (micropip) — ForgeCode'); return 0 }
    let rest = args.slice(1)
    if (sub === 'install') {
      const names = []
      for (let k = 0; k < rest.length; k++) {
        const a = rest[k]
        if (a === '-r' || a === '--requirement') {
          const f = rest[++k]
          const t = f ? await this.readText(f) : null
          if (t === null) { ctx.err(`pip: ${f || ''}: ファイルがありません\n`); return 1 }
          for (const l of t.split('\n')) { const r = l.replace(/\s+#.*$|^#.*$/, '').trim(); if (r && !r.startsWith('-')) names.push(r) }
        } else if (!a.startsWith('-')) names.push(a)
      }
      if (!names.length) { ctx.err('pip: 入れるライブラリの名前を書いてください (例: pip install emoji)\n'); return 1 }
      rest = names
    } else rest = rest.filter(a => !a.startsWith('-'))
    return this.host.pip([sub, ...rest], ctx)
  },
}
COMMANDS.py = COMMANDS.python
export const COMMAND_NAMES = Object.keys(COMMANDS)
