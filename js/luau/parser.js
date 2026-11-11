// Luau 構文解析器 (Lua 5.1 + Luau 拡張: 型注釈, 複合代入, continue, 補間文字列, if 式, 属性)
import { Lexer, LuauSyntaxError } from './lexer.js'

const BINPRI = {
  '^': [10, 9],
  '*': [7, 7], '/': [7, 7], '//': [7, 7], '%': [7, 7],
  '+': [6, 6], '-': [6, 6],
  '..': [5, 4],
  '==': [3, 3], '~=': [3, 3], '<': [3, 3], '<=': [3, 3], '>': [3, 3], '>=': [3, 3],
  'and': [2, 2],
  'or': [1, 1],
}
const UNARY_PRI = 8
const COMPOUND = new Set(['+=', '-=', '*=', '/=', '//=', '%=', '^=', '..='])
const BLOCK_END = new Set(['end', 'else', 'elseif', 'until', 'eof'])
const TOKEN_NAMES = { eof: 'ファイルの終わり', name: '名前', number: '数値', string: '文字列', interp: '補間文字列' }

export class Parser {
  constructor(src, opts = {}) {
    this.src = src
    this.lx = opts.lexer || new Lexer(src)
    if (opts.comments) this.lx.comments = []
    this.tok = this.lx.next()
    this.peeked = null
    this.loopDepth = 0
    this.funcDepth = 0
    this.prevEnd = 0
    this.prevLine = 1
  }

  // ---- トークン操作 ----
  next() {
    this.prevEnd = this.tok.e
    this.prevLine = this.tok.line
    if (this.peeked) { this.tok = this.peeked; this.peeked = null }
    else this.tok = this.lx.next()
    return this.tok
  }
  peek() {
    if (!this.peeked) this.peeked = this.lx.next()
    return this.peeked
  }
  check(t) { return this.tok.t === t }
  accept(t) { if (this.tok.t === t) { this.next(); return true } return false }
  describe(tok) {
    if (tok.t === 'eof') return TOKEN_NAMES.eof
    if (tok.t === 'string') return '文字列'
    if (tok.t === 'interp') return '補間文字列'
    return `'${tok.v}'`
  }
  error(msg, tok = this.tok) {
    throw new LuauSyntaxError(msg, tok.line, tok.col, tok.s)
  }
  expect(t, what, openTok) {
    if (this.tok.t !== t) {
      let msg = `'${t}' が必要です${what ? ' (' + what + ')' : ''}。${this.describe(this.tok)} が見つかりました`
      if (openTok && openTok.line !== this.tok.line) msg += ` — ${openTok.line} 行目の '${openTok.v}' に対応する '${t}' がありません`
      this.error(msg)
    }
    return this.next()
  }
  expectName(what) {
    if (this.tok.t !== 'name') this.error(`${what || '名前'}が必要です。${this.describe(this.tok)} が見つかりました`)
    const t = this.tok
    this.next()
    return t
  }

  // ---- 入口 ----
  parseChunk() {
    this.funcDepth = 0
    const body = this.block()
    if (!this.check('eof')) this.error(`${this.describe(this.tok)} の位置で構文エラー (余分な '${this.tok.v}' があります)`)
    return { t: 'Chunk', body, comments: this.lx.comments }
  }

  block() {
    const stats = []
    while (!BLOCK_END.has(this.tok.t)) {
      if (this.check('return')) {
        stats.push(this.returnStat())
        break
      }
      const st = this.statement()
      if (st) stats.push(st)
    }
    return stats
  }

  returnStat() {
    const line = this.tok.line
    this.next()
    let values = []
    if (!BLOCK_END.has(this.tok.t) && !this.check(';')) values = this.exprList()
    this.accept(';')
    if (!BLOCK_END.has(this.tok.t)) this.error("'return' はブロックの最後に置く必要があります")
    return { t: 'Return', values, line }
  }

  statement() {
    const tok = this.tok
    const line = tok.line
    switch (tok.t) {
      case ';': this.next(); return null
      case 'if': return this.ifStat()
      case 'while': {
        this.next()
        const cond = this.expr()
        const doTok = this.tok
        this.expect('do', 'while 文')
        this.loopDepth++
        const body = this.block()
        this.loopDepth--
        this.expect('end', 'while 文の終わり', tok)
        return { t: 'While', cond, body, line, endLine: this.prevLine, doTok }
      }
      case 'do': {
        this.next()
        const body = this.block()
        this.expect('end', 'do ブロックの終わり', tok)
        return { t: 'Do', body, line, endLine: this.prevLine }
      }
      case 'for': return this.forStat()
      case 'repeat': {
        this.next()
        this.loopDepth++
        const body = this.block()
        this.loopDepth--
        this.expect('until', 'repeat 文', tok)
        const cond = this.expr()
        return { t: 'Repeat', body, cond, line, endLine: this.prevLine }
      }
      case 'function': return this.functionStat([])
      case 'local': return this.localStat([])
      case 'break':
        if (this.loopDepth === 0) this.error("'break' はループの中でしか使えません")
        this.next()
        return { t: 'Break', line }
      case '@': {
        const attrs = this.attributes()
        if (this.check('function')) return this.functionStat(attrs)
        if (this.check('local')) return this.localStat(attrs)
        this.error("属性の後には 'function' か 'local function' が必要です")
      }
      case '::': this.error('goto ラベル (::name::) は Luau では使えません')
      case 'name': {
        const v = tok.v
        if (v === 'continue') {
          const nx = this.peek()
          if (!this.continuesExpr(nx)) {
            if (this.loopDepth === 0) this.error("'continue' はループの中でしか使えません")
            this.next()
            return { t: 'Continue', line }
          }
        } else if (v === 'type' || v === 'export') {
          const nx = this.peek()
          if (v === 'export' && nx.t === 'name' && nx.v === 'type') {
            this.next()
            return this.typeAlias(true)
          }
          if (v === 'type' && nx.t === 'name') return this.typeAlias(false)
          if (v === 'type' && nx.t === 'function') return this.typeFunction()
        } else if (v === 'goto') {
          const nx = this.peek()
          if (nx.t === 'name') this.error('goto 文は Luau では使えません (continue を使ってください)')
        }
        return this.exprStat()
      }
      default:
        return this.exprStat()
    }
  }

  continuesExpr(t) {
    return ['(', '.', ':', '[', '=', ',', 'string', '{', 'interp'].includes(t.t) || COMPOUND.has(t.t)
  }

  attributes() {
    const attrs = []
    while (this.check('@')) {
      this.next()
      attrs.push(this.expectName('属性名').v)
    }
    return attrs
  }

  typeAlias(exported) {
    const line = this.tok.line
    this.next() // 'type'
    const name = this.expectName('型名')
    if (this.check('<')) this.genericDecl()
    this.expect('=', '型の定義')
    const ts = this.tok.s
    this.parseType()
    return { t: 'TypeAlias', name: name.v, exported, line, typeText: this.src.slice(ts, this.prevEnd) }
  }

  typeFunction() {
    const line = this.tok.line
    this.next() // 'type'
    this.next() // 'function'
    const name = this.expectName('型関数名')
    const fn = this.funcBody(line, name.v, false)
    return { t: 'TypeAlias', name: name.v, exported: false, line, typeFunc: fn }
  }

  ifStat() {
    const ifTok = this.tok
    const line = ifTok.line
    const clauses = []
    this.next()
    let cond = this.expr()
    this.expect('then', 'if 文の条件の後')
    let body = this.block()
    clauses.push({ cond, body, line })
    let orelse = null
    for (;;) {
      if (this.check('elseif')) {
        const l = this.tok.line
        this.next()
        cond = this.expr()
        this.expect('then', 'elseif の条件の後')
        body = this.block()
        clauses.push({ cond, body, line: l })
      } else if (this.check('else')) {
        // 'else if' は入れ子の if として正しい文法 (end が 2 つ必要)。書き間違いの指摘はエディタ側で行います
        this.next()
        orelse = this.block()
        this.expect('end', 'if 文の終わり', ifTok)
        break
      } else {
        this.expect('end', 'if 文の終わり', ifTok)
        break
      }
    }
    return { t: 'If', clauses, orelse, line, endLine: this.prevLine }
  }

  forStat() {
    const forTok = this.tok
    const line = forTok.line
    this.next()
    const first = this.binding()
    if (this.check('=')) {
      this.next()
      const start = this.expr()
      this.expect(',', 'for 文の範囲')
      const stop = this.expr()
      let step = null
      if (this.accept(',')) step = this.expr()
      this.expect('do', 'for 文')
      this.loopDepth++
      const body = this.block()
      this.loopDepth--
      this.expect('end', 'for 文の終わり', forTok)
      return { t: 'NumFor', var: first, start, stop, step, body, line, endLine: this.prevLine }
    }
    const vars = [first]
    while (this.accept(',')) vars.push(this.binding())
    if (!this.check('in')) this.error(`for 文には '=' か 'in' が必要です。${this.describe(this.tok)} が見つかりました`)
    this.next()
    const exprs = this.exprList()
    this.expect('do', 'for 文')
    this.loopDepth++
    const body = this.block()
    this.loopDepth--
    this.expect('end', 'for 文の終わり', forTok)
    return { t: 'GenFor', vars, exprs, body, line, endLine: this.prevLine }
  }

  // 名前 [: 型]
  binding() {
    const n = this.expectName('変数名')
    const b = { name: n.v, line: n.line, s: n.s, e: n.e, type: null }
    if (this.accept(':')) {
      const ts = this.tok.s
      this.parseType()
      b.type = this.src.slice(ts, this.prevEnd)
    }
    return b
  }

  functionStat(attrs) {
    const fnTok = this.tok
    const line = fnTok.line
    this.next()
    const n = this.expectName('関数名')
    let target = { t: 'Name', name: n.v, line: n.line, s: n.s, e: n.e }
    let nameStr = n.v
    let isMethod = false
    while (this.check('.') || this.check(':')) {
      const sep = this.tok.t
      this.next()
      const k = this.expectName('関数名')
      nameStr += sep + k.v
      target = { t: 'Index', obj: target, key: { t: 'String', v: k.v }, dot: true, line: k.line, s: n.s, e: k.e, keyS: k.s }
      if (sep === ':') { isMethod = true; break }
    }
    const func = this.funcBody(line, nameStr, isMethod)
    func.attrs = attrs
    func.nameS = n.s
    return { t: 'Function', target, func, isMethod, name: nameStr, line }
  }

  localStat(attrs) {
    const line = this.tok.line
    this.next()
    if (this.check('function')) {
      this.next()
      const n = this.expectName('関数名')
      const func = this.funcBody(line, n.v, false)
      func.attrs = attrs
      return { t: 'LocalFunction', name: { name: n.v, line: n.line, s: n.s, e: n.e }, func, line }
    }
    if (attrs.length) this.error("属性は 'local function' にのみ付けられます")
    const names = []
    do {
      const b = this.binding()
      // Lua 5.4 の <const> / <close>
      if (this.check('<')) {
        const nx = this.peek()
        if (nx.t === 'name' && (nx.v === 'const' || nx.v === 'close')) {
          this.next(); this.next()
          this.expect('>', '属性')
          b.attrib = nx.v
        }
      }
      names.push(b)
    } while (this.accept(','))
    let values = []
    if (this.accept('=')) values = this.exprList()
    return { t: 'Local', names, values, line }
  }

  funcBody(line, name, isMethod) {
    let generics = null
    if (this.check('<')) generics = this.genericDecl()
    const openTok = this.tok
    this.expect('(', '関数の引数リスト')
    const params = []
    let isVararg = false
    let varargType = null
    if (!this.check(')')) {
      do {
        if (this.check('...')) {
          this.next()
          isVararg = true
          if (this.accept(':')) {
            const ts = this.tok.s
            if (this.check('...')) this.next()
            this.parseType()
            varargType = this.src.slice(ts, this.prevEnd)
          }
          break
        }
        params.push(this.binding())
      } while (this.accept(','))
    }
    this.expect(')', '関数の引数リスト', openTok)
    let returnType = null
    if (this.accept(':')) {
      const ts = this.tok.s
      this.parseReturnType()
      returnType = this.src.slice(ts, this.prevEnd)
    }
    const saveLoop = this.loopDepth
    this.loopDepth = 0
    this.funcDepth++
    const bodyStart = this.tok.s
    const body = this.block()
    this.funcDepth--
    this.loopDepth = saveLoop
    const endTok = this.tok
    if (!this.check('end')) {
      this.error(`'end' が必要です (${line} 行目の function の終わり)。${this.describe(this.tok)} が見つかりました`)
    }
    this.next()
    return { t: 'Func', params, isVararg, varargType, body, name, isMethod, line, endLine: endTok.line, generics, returnType, bodyStart, end: endTok.e }
  }

  genericDecl() {
    this.expect('<')
    const names = []
    if (!this.check('>')) {
      do {
        const n = this.expectName('型パラメータ')
        names.push(n.v)
        this.accept('...')
        if (this.accept('=')) {
          if (this.check('(')) this.parseTypePackOrFunction()
          else this.parseType()
        }
      } while (this.accept(','))
    }
    this.expect('>', '型パラメータ')
    return names
  }

  // ---- 式 ----
  exprList() {
    const list = [this.expr()]
    while (this.accept(',')) list.push(this.expr())
    return list
  }

  expr(limit = 0) {
    let left
    const t = this.tok
    if (t.t === 'not' || t.t === '-' || t.t === '#') {
      this.next()
      const e = this.expr(UNARY_PRI)
      left = { t: 'Un', op: t.t, e, line: t.line }
    } else {
      left = this.simpleExpr()
    }
    for (;;) {
      const op = this.tok.t
      const pri = BINPRI[op]
      if (!pri || pri[0] <= limit) break
      const opTok = this.tok
      this.next()
      const right = this.expr(pri[1])
      left = { t: 'Bin', op, l: left, r: right, line: opTok.line }
    }
    return left
  }

  simpleExpr() {
    const t = this.tok
    let e
    switch (t.t) {
      case 'number': this.next(); e = { t: 'Number', v: t.v, line: t.line }; break
      case 'string': this.next(); e = { t: 'String', v: t.v, line: t.line, s: t.s, e: t.e }; break
      case 'interp': this.next(); e = this.interp(t); break
      case 'nil': this.next(); e = { t: 'Nil', line: t.line }; break
      case 'true': this.next(); e = { t: 'True', line: t.line }; break
      case 'false': this.next(); e = { t: 'False', line: t.line }; break
      case '...':
        this.next()
        e = { t: 'Vararg', line: t.line }
        break
      case 'function': this.next(); e = this.funcBody(t.line, null, false); break
      case '@': {
        const attrs = this.attributes()
        if (!this.check('function')) this.error("属性の後には 'function' が必要です")
        this.next()
        e = this.funcBody(t.line, null, false)
        e.attrs = attrs
        break
      }
      case '{': e = this.table(); break
      case 'if': e = this.ifExpr(); break
      default: e = this.suffixedExpr()
    }
    if (this.check('::')) {
      this.next()
      const ts = this.tok.s
      this.parseType()
      e = { t: 'Cast', e, type: this.src.slice(ts, this.prevEnd), line: t.line }
    }
    return e
  }

  interp(tok) {
    const parts = []
    for (const p of tok.v) {
      if (typeof p === 'string') { if (p) parts.push(p); continue }
      const lx = new Lexer(this.src, p.s, p.e, p.line, p.lineStart)
      const sub = new Parser(this.src, { lexer: lx })
      sub.loopDepth = this.loopDepth
      const e = sub.expr()
      if (!sub.check('eof')) sub.error('補間文字列の {} の中の式が正しくありません')
      parts.push(e)
    }
    return { t: 'Interp', parts, line: tok.line }
  }

  ifExpr() {
    const line = this.tok.line
    this.next()
    const clauses = []
    const cond = this.expr()
    this.expect('then', 'if 式')
    const val = this.expr()
    clauses.push({ cond, val })
    for (;;) {
      if (this.accept('elseif')) {
        const c = this.expr()
        this.expect('then', 'if 式')
        clauses.push({ cond: c, val: this.expr() })
      } else {
        if (!this.check('else')) this.error("if 式には 'else' が必要です")
        this.next()
        const orelse = this.expr()
        return { t: 'IfExpr', clauses, orelse, line }
      }
    }
  }

  primaryExpr() {
    const t = this.tok
    if (t.t === 'name') {
      this.next()
      return { t: 'Name', name: t.v, line: t.line, s: t.s, e: t.e }
    }
    if (t.t === '(') {
      this.next()
      const e = this.expr()
      this.expect(')', '括弧', t)
      return { t: 'Paren', e, line: t.line }
    }
    if (t.t === 'eof') this.error('式が必要ですが、ファイルが終わりました')
    if (t.t === 'end' || t.t === 'then' || t.t === 'do' || t.t === 'else' || t.t === 'elseif' || t.t === 'until') {
      this.error(`式が必要ですが '${t.v}' が見つかりました`)
    }
    this.error(`式が必要です。${this.describe(t)} が見つかりました`)
  }

  suffixedExpr() {
    let e = this.primaryExpr()
    const startS = e.s
    for (;;) {
      const t = this.tok
      switch (t.t) {
        case '.': {
          this.next()
          const k = this.expectName("'.' の後のフィールド名")
          e = { t: 'Index', obj: e, key: { t: 'String', v: k.v }, dot: true, line: k.line, s: startS, e: k.e, keyS: k.s }
          break
        }
        case '[': {
          this.next()
          const k = this.expr()
          this.expect(']', 'インデックス', t)
          e = { t: 'Index', obj: e, key: k, line: t.line, s: startS, e: this.prevEnd }
          break
        }
        case ':': {
          this.next()
          const k = this.expectName("':' の後のメソッド名")
          const args = this.callArgs()
          e = { t: 'Method', obj: e, name: k.v, args, line: k.line, s: startS, e: this.prevEnd, keyS: k.s }
          break
        }
        case '(': case 'string': case '{': case 'interp': {
          const args = this.callArgs()
          e = { t: 'Call', fn: e, args, line: t.line, s: startS, e: this.prevEnd }
          break
        }
        default:
          return e
      }
    }
  }

  callArgs() {
    const t = this.tok
    if (t.t === 'string') { this.next(); return [{ t: 'String', v: t.v, line: t.line }] }
    if (t.t === 'interp') { this.next(); return [this.interp(t)] }
    if (t.t === '{') return [this.table()]
    if (t.t !== '(') this.error(`関数の引数が必要です。${this.describe(t)} が見つかりました`)
    this.next()
    if (this.accept(')')) return []
    const args = this.exprList()
    this.expect(')', '関数呼び出しの引数', t)
    return args
  }

  table() {
    const open = this.tok
    const line = open.line
    this.expect('{')
    const items = []
    while (!this.check('}')) {
      if (this.check('[')) {
        this.next()
        const key = this.expr()
        this.expect(']', 'テーブルのキー')
        this.expect('=', 'テーブルのフィールド')
        items.push({ k: 'expr', key, value: this.expr() })
      } else if (this.check('name') && this.peek().t === '=') {
        const n = this.tok
        this.next(); this.next()
        items.push({ k: 'named', key: n.v, value: this.expr(), line: n.line, s: n.s })
      } else {
        items.push({ k: 'pos', value: this.expr() })
      }
      if (!this.accept(',') && !this.accept(';')) break
    }
    this.expect('}', 'テーブルの終わり', open)
    return { t: 'Table', items, line }
  }

  exprStat() {
    const line = this.tok.line
    const e = this.suffixedExpr()
    if (this.check('=') || this.check(',')) {
      const targets = [e]
      while (this.accept(',')) targets.push(this.suffixedExpr())
      for (const tg of targets) {
        if (tg.t !== 'Name' && tg.t !== 'Index') this.error('この式には代入できません')
      }
      this.expect('=', '代入')
      const values = this.exprList()
      return { t: 'Assign', targets, values, line }
    }
    if (COMPOUND.has(this.tok.t)) {
      const op = this.tok.t.slice(0, -1)
      if (e.t !== 'Name' && e.t !== 'Index') this.error('この式には代入できません')
      this.next()
      const value = this.expr()
      return { t: 'Compound', op, target: e, value, line }
    }
    if (e.t !== 'Call' && e.t !== 'Method') {
      if (this.check('name') || this.check('number') || this.check('string')) {
        this.error(`構文エラー: ${this.describe(this.tok)} の前に演算子や '=' がありません`)
      }
      if (e.t === 'Name' && this.check('eof')) this.error(`'${e.name}' は文として不完全です (代入か関数呼び出しが必要です)`)
      this.error('構文エラー: 式は文として使えません (代入か関数呼び出しにしてください)')
    }
    return { t: 'CallStat', call: e, line }
  }

  // ---- 型 (実行時には無視。表示用にソース文字列のみ保持) ----
  parseReturnType() {
    if (this.check('(')) return this.parseTypePackOrFunction()
    if (this.check('...')) { this.next(); return this.parseType() }
    return this.parseType()
  }

  parseTypePackOrFunction() {
    // '(' typelist ')' ['->' rettype]
    const open = this.tok
    this.expect('(')
    let count = 0
    if (!this.check(')')) {
      do {
        if (this.check('...')) { this.next(); this.parseType(); count++; continue }
        if (this.check('name') && this.peek().t === ':') { this.next(); this.next() }
        this.parseType()
        count++
      } while (this.accept(','))
    }
    this.expect(')', '型', open)
    if (this.accept('->')) this.parseReturnType()
    return count
  }

  parseType() {
    if (this.check('|') || this.check('&')) this.next()
    this.parseTypeSuffixed()
    while (this.check('|') || this.check('&')) {
      this.next()
      this.parseTypeSuffixed()
    }
  }

  parseTypeSuffixed() {
    this.parseSimpleType()
    while (this.check('?')) this.next()
  }

  parseSimpleType() {
    const t = this.tok
    switch (t.t) {
      case 'nil': case 'true': case 'false': case 'string': this.next(); return
      case 'name': {
        if (t.v === 'typeof' && this.peek().t === '(') {
          this.next()
          const open = this.tok
          this.next()
          this.expr()
          this.expect(')', 'typeof', open)
          return
        }
        this.next()
        if (this.check('.')) { this.next(); this.expectName('型名') }
        if (this.check('<')) this.typeArgs()
        return
      }
      case '{': return this.tableType()
      case '<': this.genericDecl(); this.parseTypePackOrFunction(); return
      case '(': this.parseTypePackOrFunction(); return
      case '...': this.next(); this.parseType(); return
      case 'function': this.error("型の中で 'function' は使えません。'(引数) -> 戻り値' の形で書きます")
      default:
        this.error(`型が必要です。${this.describe(t)} が見つかりました`)
    }
  }

  typeArgs() {
    this.expect('<')
    if (!this.check('>')) {
      do {
        if (this.check('(')) this.parseTypePackOrFunction()
        else if (this.check('...')) { this.next(); this.parseType() }
        else this.parseType()
      } while (this.accept(','))
    }
    if (this.check('>=')) { // `Array<number>= {}` のような書き方
      this.tok = { ...this.tok, t: '=', v: '=', s: this.tok.s + 1, col: this.tok.col + 1 }
      return
    }
    this.expect('>', '型引数')
  }

  tableType() {
    const open = this.tok
    this.expect('{')
    if (this.accept('}')) return
    // 配列型 {T}
    const isProp = (this.check('name') && (this.peek().t === ':' || this.peek().t === 'name')) || this.check('[')
    if (!isProp) {
      this.parseType()
      this.expect('}', 'テーブル型', open)
      return
    }
    while (!this.check('}')) {
      if (this.check('name') && (this.tok.v === 'read' || this.tok.v === 'write') && (this.peek().t === 'name' || this.peek().t === '[')) this.next()
      if (this.check('[')) {
        const b = this.tok
        this.next()
        this.parseType()
        this.expect(']', 'テーブル型のキー', b)
      } else {
        this.expectName('フィールド名')
      }
      this.expect(':', 'テーブル型のフィールド')
      this.parseType()
      if (!this.accept(',') && !this.accept(';')) break
    }
    this.expect('}', 'テーブル型', open)
  }
}

export function parse(src, opts) {
  return new Parser(src, opts).parseChunk()
}

// 構文チェックのみ。成功なら null、失敗なら { message, line, col, pos }
export function checkSyntax(src) {
  try {
    parse(src)
    return null
  } catch (e) {
    if (e instanceof LuauSyntaxError) return { message: e.message, line: e.line, col: e.col, pos: e.pos }
    throw e
  }
}
