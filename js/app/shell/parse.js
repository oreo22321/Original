// シェルの字句解析・構文解析・計算 ($(( )))・条件 ([ ])
import { ShellError } from './util.js'

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
  // ヒアドキュメント (<<EOF): 行の終わりで、次の行から「EOF」の行までを中身にする
  const docs = []
  const readDocs = () => {
    for (const d of docs) {
      let text = ''
      for (;;) {
        if (i >= n) throw new ShellError(`ヒアドキュメントの終わり (${d.delim}) がありません`, true)
        let j = line.indexOf('\n', i)
        if (j < 0) j = n
        let ln = line.slice(i, j)
        i = j + 1
        if (d.strip) ln = ln.replace(/^\t+/, '')
        if (ln === d.delim) break
        text += ln + '\n'
      }
      d.tok.heredoc.text = text
    }
    docs.length = 0
  }
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
      // ${a:-${b}} のように、中に ${ } があってもよい
      let depth = 1, j = i + 2
      for (; j < n && depth; j++) { if (line[j] === '{') depth++; else if (line[j] === '}') depth-- }
      if (depth) throw new ShellError('${ が閉じられていません')
      seg(quoted ? 'qvar' : 'var', line.slice(i + 2, j - 1))
      i = j
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
    if (c === '\n') { op(';'); i++; if (docs.length) readDocs(); continue }
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
    if (c === ';') { if (line[i + 1] === ';') { op(';;'); i += 2 } else { op(';'); i++ } continue }
    if (c === '<') {
      if (line.startsWith('<<<', i)) { op('<<<'); i += 3; continue }
      if (line[i + 1] === '<') {
        let j = i + 2, strip = false
        if (line[j] === '-') { strip = true; j++ }
        while (line[j] === ' ' || line[j] === '\t') j++
        const m = /^(['"])(.*?)\1|^([^\s;|&<>()]+)/.exec(line.slice(j))
        if (!m) throw new ShellError('<< の後に、終わりの印 (例: EOF) を書いてください')
        const delim = m[1] ? m[2] : m[3].replace(/\\/g, '')
        const quoted = !!m[1] || m[3].includes('\\')
        end()
        const tok = { op: '<<', heredoc: { text: '', expand: !quoted } }
        toks.push(tok)
        docs.push({ delim, strip, tok })
        i = j + m[0].length
        continue
      }
      op('<'); i++; continue
    }
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
  if (docs.length) throw new ShellError(`ヒアドキュメントの終わり (${docs[0].delim}) がありません`, true)
  return toks
}

// 構文: list = [{ pipe: [コマンド…], then: ';' | '&&' | '||' | '&' | null }]
// コマンド: { words, redirs, assigns } / { compound: { type: 'for' | 'while' | 'until' | 'if' | 'group' | 'func', … }, redirs }
export const REDIR = new Set(['>', '>>', '<', '2>', '2>>', '2>&1', '&>', '&>>', '<<', '<<<'])
export const KW = new Set(['for', 'in', 'do', 'done', 'while', 'until', 'if', 'then', 'elif', 'else', 'fi', '{', '}', 'function', 'case', 'esac'])
export const kwOf = t => (t && t.word && t.word.length === 1 && t.word[0].t === 'lit' && KW.has(t.word[0].v) ? t.word[0].v : null)
export const litOf = t => (t && t.word && t.word.length === 1 && t.word[0].t === 'lit' ? t.word[0].v : null)
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
      if (t.op === '<<') { out.push({ op: t.op, heredoc: t.heredoc }); continue }
      if (!toks[i] || !toks[i].word) throw new ShellError(t.op === '<<<' ? '<<< の後に文字を書いてください' : `${t.op} の後にファイル名がありません`)
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
      if (toks[i].op === ';;') { if (stops && stops.includes(';;')) return out; throw new ShellError(';; は case の中で使います') }
      const pipe = [command()]
      while (toks[i] && toks[i].op === '|') { i++; if (i >= toks.length) more('| の後のコマンド'); pipe.push(command()) }
      let then = null
      const t = toks[i]
      if (t && t.op && [';', '&&', '||', '&'].includes(t.op)) { then = t.op; i++ }
      else if (t && t.op === ';;' && stops && stops.includes(';;')) then = ';'
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
    // case 単語 in パターン|パターン) コマンド ;; … esac
    if (kw === 'case') {
      i++
      if (!toks[i] || !toks[i].word) more('case の後の単語')
      const subject = toks[i++].word
      while (toks[i] && toks[i].op === ';') i++
      if (i >= toks.length) more('in')
      if (kwOf(toks[i]) !== 'in') throw new ShellError('case の後は「case 単語 in」と書きます')
      i++
      const arms = []
      for (;;) {
        while (toks[i] && toks[i].op === ';') i++
        if (i >= toks.length) more('esac')
        if (kwOf(toks[i]) === 'esac') { i++; break }
        const pats = []
        for (;;) {
          const tk = toks[i]
          if (!tk || !tk.word) { if (!tk) more(')'); throw new ShellError('case のパターンの形が正しくありません (例: a|b) コマンド ;;)') }
          const w = tk.word.map(x => ({ ...x }))
          if (!pats.length && w[0].t === 'lit' && w[0].v.startsWith('(')) w[0].v = w[0].v.slice(1)
          i++
          const last = w[w.length - 1]
          if (last.t === 'lit' && last.v.endsWith(')')) { last.v = last.v.slice(0, -1); if (!last.v && w.length > 1) w.pop(); pats.push(w); break }
          pats.push(w)
          if (toks[i] && toks[i].op === '|') { i++; continue }
          if (litOf(toks[i]) === ')') { i++; break }
          throw new ShellError('case のパターンの後には ) が要ります')
        }
        const body = list([';;', 'esac'])
        arms.push({ pats, body })
        if (toks[i] && toks[i].op === ';;') { i++; continue }
        while (toks[i] && toks[i].op === ';') i++
        if (kwOf(toks[i]) === 'esac') { i++; break }
        if (i >= toks.length) more('esac')
      }
      return { compound: { type: 'case', subject, arms }, redirs: redirs() }
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
export function testExpr(args, sh) {
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
