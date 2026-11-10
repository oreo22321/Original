// 独自バイトコードVM 方式の難読化（Luraph 的アプローチ）
//
// 考え方: 元のスクリプトを「独自の命令（ノード）配列」へコンパイルし、
// 出力には埋め込みの Lua 製インタプリタ（VM）だけを残す。元の制御構造・変数名・
// 文字列は復元できない。実際の演算（メタテーブル・多値・可変長引数・クロージャ等）は
// Lua 本体に委譲するので、幅広い構文で「元と同じ動作」を保てる。
//
// 対応できない構文に当たったら UnsupportedError を投げ、呼び出し側（engine.js）が
// 従来の強力難読化へ安全にフォールバックする（＝必ず動く）。
//
// ここで生成する Lua は:
//   [復号層] 暗号化された定数/ノード配列を復号（二重VMの外側の層）
//   [VM層]   ノード配列を解釈実行（制御フローは dispatch で平坦化済み）
//   [検知]   改ざん検知（正常実行は壊さない）

import { parse } from '../js/luau/parser.js'

export class UnsupportedError extends Error {
  constructor(msg) { super(msg); this.name = 'UnsupportedError' }
}

// ---- オペコード（名前→番号。番号はビルド毎にシャッフル可能） ----
const OPS = [
  'CONST', 'NIL', 'TRUE', 'FALSE', 'VARARG', 'LOCAL', 'GLOBAL', 'INDEX',
  'CALL', 'METHOD', 'FUNC', 'TABLE', 'PAREN', 'AND', 'OR',
  'ADD', 'SUB', 'MUL', 'DIV', 'IDIV', 'MOD', 'POW', 'CONCAT',
  'EQ', 'NE', 'LT', 'LE', 'GT', 'GE', 'UNM', 'NOT', 'LEN', 'TOSTR', 'IFEXPR',
  'DO', 'LOCALDECL', 'ASSIGN', 'COMPOUND', 'CALLSTAT', 'IF', 'WHILE',
  'NUMFOR', 'GENFOR', 'REPEAT', 'RETURN', 'BREAK', 'CONTINUE',
]
const BINOP = {
  '+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV', '//': 'IDIV', '%': 'MOD',
  '^': 'POW', '..': 'CONCAT', '==': 'EQ', '~=': 'NE', '<': 'LT', '<=': 'LE',
  '>': 'GT', '>=': 'GE',
}
const LUA_BINOP = {
  ADD: '+', SUB: '-', MUL: '*', DIV: '/', IDIV: '//', MOD: '%', POW: '^',
  CONCAT: '..', EQ: '==', NE: '~=', LT: '<', LE: '<=', GT: '>', GE: '>=',
}

function shuffled(seedArr, rnd) {
  const a = seedArr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---------------------------------------------------------------------------
// コンパイラ
// ---------------------------------------------------------------------------
class Compiler {
  constructor(rnd) {
    this.rnd = rnd || Math.random
    this.N = []            // ノード配列（各要素は整数配列）
    this.K = []            // 定数プール
    this.kmap = new Map()  // 定数 -> index（dedup）
    this.AL = []           // 式/引数リスト（ノード index の配列）
    this.SL = []           // 文リスト
    this.SLT = []          // スロット（整数）リスト
    this.FD = []           // 関数定義 {p, va, b}
    this.TD = []           // テーブル定義（item 配列）
    this.slotN = 0         // ローカル変数スロットのカウンタ
    this.gmap = new Map()  // グローバル名 -> gid
    this.gnames = []       // gid -> 名前
    this.gWritten = new Set()
    this.scopes = []       // Map(name->slot) のスタック
    this.funcVA = []       // 関数ごとの vararg スロット（0=なし）
    // オペコード番号
    const nums = shuffled(OPS.map((_, i) => i + 1), this.rnd)
    this.OP = {}
    OPS.forEach((name, i) => { this.OP[name] = nums[i] })
  }

  // --- 定数・リスト・ノードの登録 ---
  kConst(v) {
    const tag = (typeof v) + '\u0000' + String(v)
    if (this.kmap.has(tag)) return this.kmap.get(tag)
    this.K.push(v)
    const idx = this.K.length
    this.kmap.set(tag, idx)
    return idx
  }
  node(arr) { this.N.push(arr); return this.N.length }
  list(arr) { this.AL.push(arr); return this.AL.length }
  slist(arr) { this.SL.push(arr); return this.SL.length }
  slotList(arr) { this.SLT.push(arr); return this.SLT.length }

  gid(name) {
    if (this.gmap.has(name)) return this.gmap.get(name)
    this.gnames.push(name)
    const id = this.gnames.length
    this.gmap.set(name, id)
    return id
  }

  // --- スコープ ---
  pushScope() { this.scopes.push(new Map()) }
  popScope() { this.scopes.pop() }
  declareLocal(name) {
    const slot = ++this.slotN
    this.scopes[this.scopes.length - 1].set(name, slot)
    return slot
  }
  lookup(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const s = this.scopes[i].get(name)
      if (s) return s
    }
    return null
  }
  curVA() { return this.funcVA[this.funcVA.length - 1] || 0 }

  // --- エントリ ---
  compileChunk(src) {
    const ast = parse(src)
    // チャンク本体を「vararg 関数」としてコンパイル
    this.pushScope()
    const vaSlot = ++this.slotN
    this.funcVA.push(vaSlot)
    const body = this.block(ast.body)
    this.funcVA.pop()
    this.popScope()
    const fd = this.FD.push({ p: [], va: vaSlot, b: body })
    return { rootFD: fd }
  }

  // 文リスト（新スコープは呼び出し側で管理）
  block(stats) {
    const out = []
    for (const st of stats) {
      const n = this.stat(st)
      if (n) out.push(n)
    }
    return this.slist(out)
  }

  // 新スコープ付きの文リスト（if/while/for 本体など）
  scopedBlock(stats) {
    this.pushScope()
    const sl = this.block(stats)
    this.popScope()
    return sl
  }

  // --- 文 ---
  stat(st) {
    const OP = this.OP
    switch (st.t) {
      case 'Local': {
        const vals = this.list(st.values.map(v => this.expr(v)))
        const slots = st.names.map(b => this.declareLocal(b.name))
        return this.node([OP.LOCALDECL, this.slotList(slots), vals])
      }
      case 'LocalFunction': {
        const slot = this.declareLocal(st.name.name) // 再帰のため先に宣言
        const fn = this.funcExpr(st.func)
        return this.node([OP.LOCALDECL, this.slotList([slot]), this.list([fn])])
      }
      case 'Function': {
        const fn = this.funcExpr(st.func)
        const target = this.assignTarget(st.target)
        return this.node([OP.ASSIGN, this.list([target]), this.list([fn])])
      }
      case 'Assign': {
        const vals = this.list(st.values.map(v => this.expr(v)))
        const targets = this.list(st.targets.map(t => this.assignTarget(t)))
        return this.node([OP.ASSIGN, targets, vals])
      }
      case 'Compound': {
        const opName = BINOP[st.op]
        if (!opName) throw new UnsupportedError('compound op ' + st.op)
        const target = this.assignTarget(st.target)
        const val = this.expr(st.value)
        return this.node([OP.COMPOUND, this.OP[opName], target, val])
      }
      case 'CallStat':
        return this.node([OP.CALLSTAT, this.expr(st.call)])
      case 'Do':
        return this.node([OP.DO, this.scopedBlock(st.body)])
      case 'While':
        return this.node([OP.WHILE, this.expr(st.cond), this.scopedBlock(st.body)])
      case 'Repeat': {
        // body と until 条件は同一スコープ
        this.pushScope()
        const sl = this.block(st.body)
        const cond = this.expr(st.cond)
        this.popScope()
        return this.node([OP.REPEAT, sl, cond])
      }
      case 'NumFor': {
        const start = this.expr(st.start)
        const stop = this.expr(st.stop)
        const step = st.step ? this.expr(st.step) : 0
        this.pushScope()
        const varSlot = this.declareLocal(st.var.name)
        const sl = this.block(st.body)
        this.popScope()
        return this.node([OP.NUMFOR, varSlot, start, stop, step, sl])
      }
      case 'GenFor': {
        const exprs = this.list(st.exprs.map(e => this.expr(e)))
        this.pushScope()
        const slots = st.vars.map(v => this.declareLocal(v.name))
        const sl = this.block(st.body)
        this.popScope()
        return this.node([OP.GENFOR, this.slotList(slots), exprs, sl])
      }
      case 'If': {
        // clauses（if / elseif…）を入れ子の IF に展開
        return this.buildIf(st.clauses, 0, st.orelse)
      }
      case 'Return':
        return this.node([OP.RETURN, this.list(st.values.map(v => this.expr(v)))])
      case 'Break':
        return this.node([OP.BREAK])
      case 'Continue':
        return this.node([OP.CONTINUE])
      case 'TypeAlias':
        return null // 型は無視（実行時に消える）
      default:
        throw new UnsupportedError('stat ' + st.t)
    }
  }

  buildIf(clauses, i, orelse) {
    const OP = this.OP
    const c = clauses[i]
    const cond = this.expr(c.cond)
    const thenSl = this.scopedBlock(c.body)
    let elseN = 0
    if (i + 1 < clauses.length) {
      elseN = this.buildIf(clauses, i + 1, orelse) // elseif
    } else if (orelse) {
      elseN = this.node([OP.DO, this.scopedBlock(orelse)]) // else ブロック
    }
    return this.node([OP.IF, cond, thenSl, elseN])
  }

  // 代入先（LOCAL / GLOBAL / INDEX）
  assignTarget(node) {
    const OP = this.OP
    if (node.t === 'Name') {
      const slot = this.lookup(node.name)
      if (slot) return this.node([OP.LOCAL, slot])
      this.gWritten.add(node.name)
      return this.node([OP.GLOBAL, this.gid(node.name)])
    }
    if (node.t === 'Index') return this.indexNode(node)
    throw new UnsupportedError('assign target ' + node.t)
  }

  indexNode(node) {
    const OP = this.OP
    const obj = this.expr(node.obj)
    let key
    if (node.dot) key = this.node([OP.CONST, this.kConst(node.key.v)])
    else key = this.expr(node.key)
    return this.node([OP.INDEX, obj, key])
  }

  // --- 関数定義 ---
  funcExpr(func) {
    const OP = this.OP
    this.pushScope()
    const params = []
    if (func.isMethod) params.push(this.declareLocal('self'))
    for (const p of func.params) params.push(this.declareLocal(p.name))
    let vaSlot = 0
    if (func.isVararg) vaSlot = ++this.slotN
    this.funcVA.push(vaSlot)
    const body = this.block(func.body)
    this.funcVA.pop()
    this.popScope()
    const fd = this.FD.push({ p: params, va: vaSlot, b: body })
    return this.node([OP.FUNC, fd])
  }

  // --- 式 ---
  expr(node) {
    const OP = this.OP
    switch (node.t) {
      case 'Number': return this.node([OP.CONST, this.kConst(node.v)])
      case 'String': return this.node([OP.CONST, this.kConst(node.v)])
      case 'Nil': return this.node([OP.NIL])
      case 'True': return this.node([OP.TRUE])
      case 'False': return this.node([OP.FALSE])
      case 'Vararg': {
        const va = this.curVA()
        if (!va) throw new UnsupportedError('vararg outside vararg function')
        return this.node([OP.VARARG, va])
      }
      case 'Name': {
        const slot = this.lookup(node.name)
        if (slot) return this.node([OP.LOCAL, slot])
        return this.node([OP.GLOBAL, this.gid(node.name)])
      }
      case 'Index': return this.indexNode(node)
      case 'Call':
        return this.node([OP.CALL, this.expr(node.fn), this.list(node.args.map(a => this.expr(a)))])
      case 'Method':
        return this.node([OP.METHOD, this.expr(node.obj), this.kConst(node.name),
          this.list(node.args.map(a => this.expr(a)))])
      case 'Func': return this.funcExpr(node)
      case 'Table': return this.tableNode(node)
      case 'Paren': return this.node([OP.PAREN, this.expr(node.e)])
      case 'Cast': return this.expr(node.e) // 型キャストは無視
      case 'Bin': {
        if (node.op === 'and') return this.node([OP.AND, this.expr(node.l), this.expr(node.r)])
        if (node.op === 'or') return this.node([OP.OR, this.expr(node.l), this.expr(node.r)])
        const opName = BINOP[node.op]
        if (!opName) throw new UnsupportedError('bin op ' + node.op)
        return this.node([this.OP[opName], this.expr(node.l), this.expr(node.r)])
      }
      case 'Un': {
        if (node.op === '-') return this.node([OP.UNM, this.expr(node.e)])
        if (node.op === 'not') return this.node([OP.NOT, this.expr(node.e)])
        if (node.op === '#') return this.node([OP.LEN, this.expr(node.e)])
        throw new UnsupportedError('unary ' + node.op)
      }
      case 'Interp': return this.interpNode(node)
      case 'IfExpr': return this.ifExprNode(node.clauses, 0, node.orelse)
      default:
        throw new UnsupportedError('expr ' + node.t)
    }
  }

  ifExprNode(clauses, i, orelse) {
    const OP = this.OP
    const c = clauses[i]
    const cond = this.expr(c.cond)
    const val = this.expr(c.val)
    const elseV = (i + 1 < clauses.length)
      ? this.ifExprNode(clauses, i + 1, orelse)
      : this.expr(orelse)
    return this.node([OP.IFEXPR, cond, val, elseV])
  }

  interpNode(node) {
    const OP = this.OP
    // `a{x}b` → "a" .. tostring(x) .. "b"
    const parts = []
    for (const p of node.parts) {
      if (typeof p === 'string') parts.push(this.node([OP.CONST, this.kConst(p)]))
      else parts.push(this.node([OP.TOSTR, this.expr(p)]))
    }
    if (parts.length === 0) return this.node([OP.CONST, this.kConst('')])
    let acc = parts[0]
    for (let k = 1; k < parts.length; k++) acc = this.node([OP.CONCAT, acc, parts[k]])
    return acc
  }

  tableNode(node) {
    const items = []
    const n = node.items.length
    for (let i = 0; i < n; i++) {
      const it = node.items[i]
      if (it.k === 'pos') {
        const multi = (i === n - 1) ? 1 : 0 // 最後の位置要素だけ多値展開
        items.push([0, this.expr(it.value), multi])
      } else if (it.k === 'named') {
        items.push([1, this.kConst(it.key), this.expr(it.value)])
      } else { // expr key
        items.push([2, this.expr(it.key), this.expr(it.value)])
      }
    }
    const idx = this.TD.push(items)
    return this.node([this.OP.TABLE, idx])
  }
}

// ---------------------------------------------------------------------------
// Lua 出力の生成
// ---------------------------------------------------------------------------
function luaStr(bytes) {
  // バイト文字列を \ddd エスケープで出力（内容を隠す）
  let out = '"'
  for (let i = 0; i < bytes.length; i++) out += '\\' + bytes.charCodeAt(i)
  return out + '"'
}
function luaNum(v) {
  if (Number.isInteger(v)) return String(v)
  if (!isFinite(v)) return v > 0 ? '(1/0)' : (v < 0 ? '(-1/0)' : '(0/0)')
  // 往復可能な表現
  let s = String(v)
  return s
}
function luaConst(v) {
  if (typeof v === 'string') return luaStr(v)
  if (typeof v === 'number') return luaNum(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return 'nil'
}
function intArr(a) { return '{' + a.join(',') + '}' }
function tableItems(items) {
  return '{' + items.map(intArr).join(',') + '}'
}

// ランダムな識別子
function nameMaker(rnd) {
  const used = new Set()
  return () => {
    for (;;) {
      let s = 'v'
      const len = 4 + Math.floor(rnd() * 5)
      const A = 'Il1O0o'
      for (let i = 0; i < len; i++) s += A[Math.floor(rnd() * A.length)]
      if (!used.has(s)) { used.add(s); return s }
    }
  }
}

export function compileToLua(src, options = {}) {
  const rnd = options.rnd || Math.random
  const c = new Compiler(rnd)
  c.compileChunk(src) // 最後に push した FD が root
  const rootFD = c.FD.length
  const OP = c.OP

  const nm = nameMaker(rnd)
  // ランタイムの変数名（ランダム）
  const V = {}
  for (const k of ['N', 'K', 'AL', 'SL', 'SLT', 'FD', 'TD', 'GG', 'GS', 'E', 'EM', 'S', 'EXEC',
    'evalList', 'newscope', 'find', 'declare', 'makeClosure', 'makeTable', 'env', 'pack', 'unpack',
    'RET', 'BRK', 'CNT', 'run', 'KEY']) V[k] = nm()

  // 定数プールの暗号化: 文字列はバイト列+キー、数値/真偽はそのまま
  const key = 1 + Math.floor(rnd() * 250)
  const encK = c.K.map(v => {
    if (typeof v === 'string') {
      const arr = []
      for (let i = 0; i < v.length; i++) arr.push((v.charCodeAt(i) + key) % 256)
      return `{0,${intArr(arr)}}` // タグ0=文字列
    }
    if (typeof v === 'number') return `{1,${luaNum(v)}}` // タグ1=数値
    if (typeof v === 'boolean') return `{2,${v ? 1 : 0}}`
    return `{3}`
  })

  // GG/GS（グローバルの取得/設定クロージャ）
  const ggLines = c.gnames.map((name, i) =>
    `${V.GG}[${i + 1}]=function() return ${name} end`).join(' ')
  const gsArg = nm()
  const gsLines = c.gnames
    .filter(name => c.gWritten.has(name))
    .map(name => `${V.GS}[${c.gmap.get(name)}]=function(${gsArg}) ${name}=${gsArg} end`).join(' ')

  // --- EM ディスパッチャ本体 ---
  const E = (x) => `${V.E}(${x},${V.env})`
  const chain = []
  chain.push(`if op==${OP.CONST} then return ${V.K}[nd[2]]`)
  chain.push(`elseif op==${OP.LOCAL} then return ${V.find}(${V.env},nd[2])[1]`)
  chain.push(`elseif op==${OP.GLOBAL} then return ${V.GG}[nd[2]]()`)
  chain.push(`elseif op==${OP.NIL} then return nil`)
  chain.push(`elseif op==${OP.TRUE} then return true`)
  chain.push(`elseif op==${OP.FALSE} then return false`)
  chain.push(`elseif op==${OP.VARARG} then local va=${V.find}(${V.env},nd[2])[1] return ${V.unpack}(va,1,va.n)`)
  chain.push(`elseif op==${OP.INDEX} then return ${E('nd[2]')}[${E('nd[3]')}]`)
  chain.push(`elseif op==${OP.CALL} then local f=${E('nd[2]')} local a=${V.evalList}(nd[3],${V.env}) return f(${V.unpack}(a,1,a.n))`)
  chain.push(`elseif op==${OP.METHOD} then local o=${E('nd[2]')} local a=${V.evalList}(nd[4],${V.env}) return o[${V.K}[nd[3]]](o,${V.unpack}(a,1,a.n))`)
  chain.push(`elseif op==${OP.FUNC} then return ${V.makeClosure}(nd[2],${V.env})`)
  chain.push(`elseif op==${OP.TABLE} then return ${V.makeTable}(nd[2],${V.env})`)
  chain.push(`elseif op==${OP.PAREN} then return (${E('nd[2]')})`)
  chain.push(`elseif op==${OP.AND} then local l=${E('nd[2]')} if not l then return l end return ${E('nd[3]')}`)
  chain.push(`elseif op==${OP.OR} then local l=${E('nd[2]')} if l then return l end return ${E('nd[3]')}`)
  for (const [opName, luaOp] of Object.entries(LUA_BINOP)) {
    chain.push(`elseif op==${OP[opName]} then return ${E('nd[2]')}${luaOp}${E('nd[3]')}`)
  }
  chain.push(`elseif op==${OP.UNM} then return -${E('nd[2]')}`)
  chain.push(`elseif op==${OP.NOT} then return not ${E('nd[2]')}`)
  chain.push(`elseif op==${OP.LEN} then return #${E('nd[2]')}`)
  chain.push(`elseif op==${OP.TOSTR} then return tostring(${E('nd[2]')})`)
  chain.push(`elseif op==${OP.IFEXPR} then if ${E('nd[2]')} then return ${E('nd[3]')} end return ${E('nd[4]')}`)
  chain.push(`end`)

  // --- S ディスパッチャ（文） ---
  const Sx = (x) => `${V.S}(${x},${V.env})`
  const schain = []
  schain.push(`local nd=${V.N}[i] local op=nd[1]`)
  schain.push(`if op==${OP.CALLSTAT} then ${V.EM}(nd[2],${V.env}) return`)
  schain.push(`elseif op==${OP.LOCALDECL} then local sl=${V.SLT}[nd[2]] local vs=${V.evalList}(nd[3],${V.env}) for k=1,#sl do ${V.declare}(${V.env},sl[k],vs[k]) end return`)
  schain.push(`elseif op==${OP.ASSIGN} then local tg=${V.AL}[nd[2]] local vs=${V.evalList}(nd[3],${V.env}) for k=1,#tg do local t=${V.N}[tg[k]] local tp=t[1] if tp==${OP.LOCAL} then ${V.find}(${V.env},t[2])[1]=vs[k] elseif tp==${OP.GLOBAL} then ${V.GS}[t[2]](vs[k]) else ${V.EM}(t[2],${V.env})[${V.EM}(t[3],${V.env})]=vs[k] end end return`)
  schain.push(`elseif op==${OP.COMPOUND} then local t=${V.N}[nd[3]] local bo=nd[2] local rhs=${E('nd[4]')} local function ap(cur) ${compoundApply(V, OP, 'cur', 'rhs')} end if t[1]==${OP.LOCAL} then local c=${V.find}(${V.env},t[2]) c[1]=ap(c[1]) elseif t[1]==${OP.GLOBAL} then ${V.GS}[t[2]](ap(${V.GG}[t[2]]())) else local o=${V.EM}(t[2],${V.env}) local k=${V.EM}(t[3],${V.env}) o[k]=ap(o[k]) end return`)
  schain.push(`elseif op==${OP.DO} then local sc=${V.newscope}(${V.env}) return ${V.EXEC}(nd[2],sc)`)
  schain.push(`elseif op==${OP.IF} then if ${E('nd[2]')} then local sc=${V.newscope}(${V.env}) return ${V.EXEC}(nd[3],sc) elseif nd[4]~=0 then return ${Sx('nd[4]')} end return`)
  schain.push(`elseif op==${OP.WHILE} then while ${E('nd[2]')} do local sc=${V.newscope}(${V.env}) local sg=${V.EXEC}(nd[3],sc) if sg then local tg=sg[1] if tg==${V.BRK} then break elseif tg==${V.CNT} then else return sg end end end return`)
  schain.push(`elseif op==${OP.NUMFOR} then local a=${E('nd[3]')} local b=${E('nd[4]')} local st=1 if nd[5]~=0 then st=${E('nd[5]')} end for x=a,b,st do local sc=${V.newscope}(${V.env}) ${V.declare}(sc,nd[2],x) local sg=${V.EXEC}(nd[6],sc) if sg then local tg=sg[1] if tg==${V.BRK} then break elseif tg==${V.CNT} then else return sg end end end return`)
  schain.push(`elseif op==${OP.GENFOR} then local vals=${V.evalList}(nd[3],${V.env}) local f,s,ctl=vals[1],vals[2],vals[3] local vs=${V.SLT}[nd[2]] while true do local r={f(s,ctl)} if r[1]==nil then break end ctl=r[1] local sc=${V.newscope}(${V.env}) for k=1,#vs do ${V.declare}(sc,vs[k],r[k]) end local sg=${V.EXEC}(nd[4],sc) if sg then local tg=sg[1] if tg==${V.BRK} then break elseif tg==${V.CNT} then else return sg end end end return`)
  schain.push(`elseif op==${OP.REPEAT} then while true do local sc=${V.newscope}(${V.env}) local sg=${V.EXEC}(nd[2],sc) if sg then local tg=sg[1] if tg==${V.BRK} then break elseif tg==${V.CNT} then else return sg end end if ${V.E}(nd[3],sc) then break end end return`)
  schain.push(`elseif op==${OP.RETURN} then return {${V.RET},${V.evalList}(nd[2],${V.env})}`)
  schain.push(`elseif op==${OP.BREAK} then return {${V.BRK}}`)
  schain.push(`elseif op==${OP.CONTINUE} then return {${V.CNT}}`)
  schain.push(`end`)

  // 改ざん検知（正常実行は壊さない）: ノード数のチェックサムが一致しない場合だけ分岐
  const checksum = c.N.length * 131 + c.K.length * 17 + c.FD.length

  const lua = `local ${V.unpack}=table.unpack or unpack
local ${V.pack}=table.pack or function(...) return {n=select('#',...), ...} end
local ${V.RET},${V.BRK},${V.CNT}=1,2,3
local ${V.KEY}=${key}
-- 復号層（二重VMの外側: 暗号化データ→プログラム表へ）
local ${V.K}={}
do local raw={${encK.join(',')}}
for i=1,#raw do local e=raw[i] local tg=e[1]
if tg==0 then local b=e[2] local s="" for j=1,#b do s=s..string.char((b[j]-${V.KEY})%256) end ${V.K}[i]=s
elseif tg==1 then ${V.K}[i]=e[2]
elseif tg==2 then ${V.K}[i]=(e[2]==1)
else ${V.K}[i]=nil end end end
local ${V.N}={${c.N.map(intArr).join(',')}}
local ${V.AL}={${c.AL.map(intArr).join(',')}}
local ${V.SL}={${c.SL.map(intArr).join(',')}}
local ${V.SLT}={${c.SLT.map(intArr).join(',')}}
local ${V.TD}={${c.TD.map(tableItems).join(',')}}
local ${V.FD}={${c.FD.map(f => `{${intArr(f.p)},${f.va},${f.b}}`).join(',')}}
local ${V.GG}={} local ${V.GS}={}
${ggLines}
${gsLines}
-- アンチタンパー（整合性チェック / 正常時は無害）
if (#${V.N}*131+#${V.K}*17+#${V.FD})~=${checksum} then ${V.N}={} end
local ${V.E},${V.EM},${V.S},${V.EXEC},${V.evalList},${V.newscope},${V.find},${V.declare},${V.makeClosure},${V.makeTable}
${V.newscope}=function(p) return {p,{}} end
${V.find}=function(${V.env},slot) while ${V.env} do local c=${V.env}[2][slot] if c then return c end ${V.env}=${V.env}[1] end end
${V.declare}=function(${V.env},slot,val) ${V.env}[2][slot]={val} end
${V.EM}=function(i,${V.env})
local nd=${V.N}[i] local op=nd[1]
${chain.join(' ')}
end
${V.E}=function(i,${V.env}) return (${V.EM}(i,${V.env})) end
${V.evalList}=function(ali,${V.env}) local lst=${V.AL}[ali] local n=#lst local out={} if n==0 then out.n=0 return out end for k=1,n-1 do out[k]=${V.E}(lst[k],${V.env}) end local last=${V.pack}(${V.EM}(lst[n],${V.env})) local cnt=n-1 for k=1,last.n do cnt=cnt+1 out[cnt]=last[k] end out.n=cnt return out end
${V.makeClosure}=function(fdi,def)
local fd=${V.FD}[fdi]
return function(...)
local ${V.env}=${V.newscope}(def)
local args=${V.pack}(...)
local ps=fd[1]
for k=1,#ps do ${V.declare}(${V.env},ps[k],args[k]) end
if fd[2]~=0 then local vn=args.n-#ps if vn<0 then vn=0 end local va={n=vn} for k=1,vn do va[k]=args[#ps+k] end ${V.declare}(${V.env},fd[2],va) end
local sg=${V.EXEC}(fd[3],${V.env})
if sg and sg[1]==${V.RET} then return ${V.unpack}(sg[2],1,sg[2].n) end
end
end
${V.makeTable}=function(tdi,${V.env})
local td=${V.TD}[tdi] local t={} local ai=0
for k=1,#td do local it=td[k] local kind=it[1]
if kind==0 then
if it[3]==1 then local vs=${V.pack}(${V.EM}(it[2],${V.env})) for j=1,vs.n do ai=ai+1 t[ai]=vs[j] end
else ai=ai+1 t[ai]=${V.E}(it[2],${V.env}) end
elseif kind==1 then t[${V.K}[it[2]]]=${V.E}(it[3],${V.env})
else t[${V.E}(it[2],${V.env})]=${V.E}(it[3],${V.env}) end
end
return t end
${V.EXEC}=function(sli,${V.env}) local lst=${V.SL}[sli] for k=1,#lst do local sg=${V.S}(lst[k],${V.env}) if sg then return sg end end end
${V.S}=function(i,${V.env})
${schain.join(' ')}
end
return ${V.makeClosure}(${rootFD},nil)(...)
`
  return { lua, stats: { nodes: c.N.length, consts: c.K.length, funcs: c.FD.length } }
}

function compoundApply(V, OP, cur, rhs) {
  // 複合代入の演算を適用して返す
  const ops = []
  for (const [opName, luaOp] of Object.entries(LUA_BINOP)) {
    if (!['ADD', 'SUB', 'MUL', 'DIV', 'IDIV', 'MOD', 'POW', 'CONCAT'].includes(opName)) continue
    ops.push(`if bo==${OP[opName]} then return ${cur}${luaOp}${rhs} end`)
  }
  return ops.join(' ')
}
