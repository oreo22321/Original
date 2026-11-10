// 線形バイトコードVM 方式の難読化（Luraph 的・強化版）
//
// 現行 AST ツリー VM (vm-compile.js) の弱点を潰すため、スクリプトを
// 「ジャンプ付きの線形命令列（スタックマシン）」へコンパイルし、埋め込みの
// Lua 製 VM で実行する。if/while/for といった制御構造ノードは消え、制御は
// ジャンプ＝平坦化される。実演算は Lua に委譲するため、クロージャ・アップバリュー・
// 可変長引数・多値・メタテーブルの意味は保たれる。
//
// このファイルは「正当性優先の読みやすい版」。ハードニング（実行時キー依存ディスパッチ、
// 定数キースケジュール、単一ブロブ化、層多様化）は vm-harden 側で重ねる。
//
// 対応できない構文に当たると UnsupportedError を投げ、engine 側が従来方式へフォールバックする。

import { parse } from '../js/luau/parser.js'

export class UnsupportedError extends Error {
  constructor(msg) { super(msg); this.name = 'UnsupportedError' }
}

// ---- オペコード（名前→番号。番号はビルド毎にシャッフル可能） ----
const OPNAMES = [
  'PUSHC', 'PUSHNIL', 'PUSHTRUE', 'PUSHFALSE',
  'GETLOCAL', 'SETLOCAL', 'NEWLOCAL', 'NEWLOCALNIL',
  'GETUPVAL', 'SETUPVAL', 'GETGLOBAL', 'SETGLOBAL', 'CLOSURE',
  'VARARG1', 'VARARGALL',
  'INDEX', 'INDEXK', 'SETINDEX', 'SETINDEXK',
  'MARK', 'CALL', 'METHOD',
  'ADD', 'SUB', 'MUL', 'DIV', 'IDIV', 'MOD', 'POW', 'CONCAT',
  'EQ', 'NE', 'LT', 'LE', 'GT', 'GE', 'UNM', 'NOT', 'LEN', 'TOSTR',
  'JMP', 'CJMPF', 'JMPIFT', 'JMPIFF',
  'POP', 'DUP', 'DUP2', 'ADJUST', 'PACKADJUST',
  'NEWTABLE', 'SETARRAY', 'SETARRAYALL', 'SETFIELD', 'SETFIELDK', 'ENDTABLE',
  'FORTEST', 'FORADD', 'GFNEXT',
  'RET',
]
const BINOP = { '+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV', '//': 'IDIV', '%': 'MOD', '^': 'POW', '..': 'CONCAT', '==': 'EQ', '~=': 'NE', '<': 'LT', '<=': 'LE', '>': 'GT', '>=': 'GE' }

function shuffleOps(rnd) {
  const nums = OPNAMES.map((_, i) => i + 1)
  for (let i = nums.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [nums[i], nums[j]] = [nums[j], nums[i]] }
  const OP = {}
  OPNAMES.forEach((n, i) => OP[n] = nums[i])
  return OP
}

// ---------------------------------------------------------------------------
// コンパイラ
// ---------------------------------------------------------------------------
class FuncCtx {
  constructor(parent) {
    this.parent = parent
    this.code = []
    this.nslots = 0
    this.scopes = [new Map()]
    this.upvals = []            // {l:slot} or {u:idx}
    this.upvalMap = new Map()
    this.loops = []             // { brk, cont, isRepeat }
    this.np = 0
    this.va = 0
    this.labels = []
  }
  newSlot() { return ++this.nslots }
  pushScope() { this.scopes.push(new Map()) }
  popScope() { this.scopes.pop() }
  declare(name) { const s = this.newSlot(); this.scopes[this.scopes.length - 1].set(name, s); return s }
  findLocal(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) { const s = this.scopes[i].get(name); if (s) return s }
    return null
  }
  emit(op, ...args) { this.code.push([op, ...args]); return this.code.length - 1 }
  newLabel() { const l = { pc: 0 }; this.labels.push(l); return l }
  place(l) { l.pc = this.code.length + 1 } // 1-based pc
  resolveLabels() {
    for (const ins of this.code) {
      for (let i = 1; i < ins.length; i++) if (ins[i] && typeof ins[i] === 'object') ins[i] = ins[i].pc
    }
  }
}

class Compiler {
  constructor(rnd) {
    this.rnd = rnd || Math.random
    this.OP = shuffleOps(this.rnd)
    this.K = []
    this.kmap = new Map()
    this.funcs = []            // 出力 fd 配列
    this.gmap = new Map()
    this.gnames = []
    this.gWritten = new Set()
    this.fstack = []
  }
  cur() { return this.fstack[this.fstack.length - 1] }
  kConst(v) {
    const tag = (typeof v) + '\u0000' + String(v)
    if (this.kmap.has(tag)) return this.kmap.get(tag)
    this.K.push(v); const idx = this.K.length; this.kmap.set(tag, idx); return idx
  }
  gid(name) {
    if (this.gmap.has(name)) return this.gmap.get(name)
    this.gnames.push(name); const id = this.gnames.length; this.gmap.set(name, id); return id
  }

  // 名前解決: local / upval / global
  resolve(name) {
    const f = this.cur()
    const s = f.findLocal(name)
    if (s) return { kind: 'local', slot: s }
    const idx = this.resolveUpval(this.fstack.length - 1, name)
    if (idx != null) return { kind: 'upval', idx }
    return { kind: 'global', gid: this.gid(name) }
  }
  resolveUpval(fi, name) {
    if (fi <= 0) return null
    const f = this.fstack[fi]
    if (f.upvalMap.has(name)) return f.upvalMap.get(name)
    const parent = this.fstack[fi - 1]
    const pslot = parent.findLocal(name)
    if (pslot) {
      const idx = f.upvals.push({ l: pslot }) // 1-based
      f.upvalMap.set(name, idx); return idx
    }
    const pup = this.resolveUpval(fi - 1, name)
    if (pup != null) {
      const idx = f.upvals.push({ u: pup }) // 1-based
      f.upvalMap.set(name, idx); return idx
    }
    return null
  }

  compileChunk(src) {
    const ast = parse(src)
    const fi = this.compileFunction({ params: [], isVararg: true, isMethod: false, body: ast.body })
    return { rootFI: fi }
  }

  // func: {params:[{name}], isVararg, isMethod, body}
  compileFunction(func) {
    const parent = this.fstack.length ? this.cur() : null
    const f = new FuncCtx(parent)
    this.fstack.push(f)
    if (func.isMethod) f.declare('self')
    for (const p of func.params) f.declare(p.name)
    f.np = f.nslots
    f.va = func.isVararg ? 1 : 0
    for (const st of func.body) this.stat(st)
    // 末尾 return が無ければ return を補う
    const last = f.code[f.code.length - 1]
    f.emit(this.OP.MARK); f.emit(this.OP.RET)
    f.resolveLabels()
    const fd = { code: f.code, np: f.np, va: f.va, up: f.upvals }
    this.fstack.pop()
    const idx = this.funcs.push(fd)
    return idx
  }

  // ---- 文 ----
  stat(st) {
    const f = this.cur(); const OP = this.OP
    switch (st.t) {
      case 'Local': this.localDecl(st); break
      case 'LocalFunction': {
        // 再帰のため: セルを先に作る → クロージャがそのセルを捕捉 → クロージャを格納
        const slot = f.declare(st.name.name)
        f.emit(OP.NEWLOCALNIL, slot)
        this.closure(st.func)
        f.emit(OP.SETLOCAL, slot)
        break
      }
      case 'Function': {
        this.closure(st.func)
        this.assignTo(st.target)
        break
      }
      case 'Assign': this.assign(st); break
      case 'Compound': this.compound(st); break
      case 'CallStat': this.expr(st.call, false); f.emit(OP.POP); break
      case 'Do': f.pushScope(); for (const s of st.body) this.stat(s); f.popScope(); break
      case 'While': this.whileStat(st); break
      case 'Repeat': this.repeatStat(st); break
      case 'NumFor': this.numFor(st); break
      case 'GenFor': this.genFor(st); break
      case 'If': this.ifStat(st); break
      case 'Return': this.returnStat(st); break
      case 'Break': {
        const lp = f.loops[f.loops.length - 1]
        if (!lp) throw new UnsupportedError('break outside loop')
        f.emit(OP.JMP, lp.brk); break
      }
      case 'Continue': {
        const lp = f.loops[f.loops.length - 1]
        if (!lp) throw new UnsupportedError('continue outside loop')
        f.emit(OP.JMP, lp.cont); break
      }
      case 'TypeAlias': break
      default: throw new UnsupportedError('stat ' + st.t)
    }
  }

  localDecl(st) {
    const f = this.cur(); const OP = this.OP
    const n = st.names.length
    if (n === 1 && st.values.length <= 1) {
      if (st.values.length === 1) { this.expr(st.values[0], false); const slot = f.declare(st.names[0].name); f.emit(OP.NEWLOCAL, slot) }
      else { const slot = f.declare(st.names[0].name); f.emit(OP.NEWLOCALNIL, slot) }
      return
    }
    // 複数: 値リストを n 個に整えてから宣言（スタック上に n 値）
    this.evalListAdjust(st.values, n)
    const slots = st.names.map(b => f.declare(b.name))
    for (let i = n - 1; i >= 0; i--) f.emit(OP.NEWLOCAL, slots[i])
  }

  // 値リストを count 個に調整してスタックに積む（最後は多値展開）
  evalListAdjust(values, count) {
    const f = this.cur(); const OP = this.OP
    f.emit(OP.MARK)
    for (let i = 0; i < values.length; i++) {
      const isLast = i === values.length - 1
      this.expr(values[i], isLast) // 最後だけ多値
    }
    f.emit(OP.ADJUST, count)
  }

  assign(st) {
    const f = this.cur(); const OP = this.OP
    if (st.targets.length === 1 && st.values.length === 1) {
      this.assignSingle(st.targets[0], st.values[0]); return
    }
    const n = st.targets.length
    this.evalListAdjust(st.values, n) // スタックに n 値（target1..n の順）
    // 一時スロットへ退避
    const tmp = []
    for (let i = 0; i < n; i++) tmp.push(f.newSlot())
    for (let i = n - 1; i >= 0; i--) f.emit(OP.NEWLOCAL, tmp[i])
    for (let i = 0; i < n; i++) {
      f.emit(OP.GETLOCAL, tmp[i])
      this.assignTo(st.targets[i])
    }
  }
  assignSingle(target, value) {
    const f = this.cur(); const OP = this.OP
    if (target.t === 'Index') {
      this.expr(target.obj, false)
      if (target.dot) { this.expr(value, false); f.emit(OP.SETINDEXK, this.kConst(target.key.v)) }
      else { this.expr(target.key, false); this.expr(value, false); f.emit(OP.SETINDEX) }
      return
    }
    this.expr(value, false)
    this.assignTo(target)
  }
  // スタック最上位の値を target へ格納
  assignTo(target) {
    const f = this.cur(); const OP = this.OP
    if (target.t === 'Name') {
      const r = this.resolve(target.name)
      if (r.kind === 'local') f.emit(OP.SETLOCAL, r.slot)
      else if (r.kind === 'upval') f.emit(OP.SETUPVAL, r.idx)
      else { this.gWritten.add(target.name); f.emit(OP.SETGLOBAL, this.gid(target.name)) }
      return
    }
    if (target.t === 'Index') {
      // 値はスタック top。obj,key を評価してから SETINDEX する必要があるため並べ替え。
      // スタック: [.., val] -> obj,key を積むと [.., val, obj, key] になり順序が合わない。
      // 一時スロットに val を退避して処理する。
      const tmp = f.newSlot()
      f.emit(OP.NEWLOCAL, tmp)
      this.expr(target.obj, false)
      if (target.dot) { f.emit(OP.GETLOCAL, tmp); f.emit(OP.SETINDEXK, this.kConst(target.key.v)) }
      else { this.expr(target.key, false); f.emit(OP.GETLOCAL, tmp); f.emit(OP.SETINDEX) }
      return
    }
    throw new UnsupportedError('assign target ' + target.t)
  }

  compound(st) {
    const f = this.cur(); const OP = this.OP
    const opName = BINOP[st.op.slice(0, -1)] || BINOP[st.op]
    const binName = BINOP[st.op] // e.g. '+='? no
    const sym = st.op.replace('=', '')
    const bop = BINOP[sym]
    if (!bop) throw new UnsupportedError('compound ' + st.op)
    const t = st.target
    if (t.t === 'Name') {
      const r = this.resolve(t.name)
      // get
      if (r.kind === 'local') f.emit(OP.GETLOCAL, r.slot)
      else if (r.kind === 'upval') f.emit(OP.GETUPVAL, r.idx)
      else f.emit(OP.GETGLOBAL, this.gid(t.name))
      this.expr(st.value, false)
      f.emit(OP[bop])
      if (r.kind === 'local') f.emit(OP.SETLOCAL, r.slot)
      else if (r.kind === 'upval') f.emit(OP.SETUPVAL, r.idx)
      else { this.gWritten.add(t.name); f.emit(OP.SETGLOBAL, this.gid(t.name)) }
      return
    }
    if (t.t === 'Index') {
      this.expr(t.obj, false)
      if (t.dot) {
        f.emit(OP.DUP) // obj, obj
        f.emit(OP.INDEXK, this.kConst(t.key.v)) // obj, cur
        this.expr(st.value, false) // obj, cur, val
        f.emit(OP[bop]) // obj, new
        f.emit(OP.SETINDEXK, this.kConst(t.key.v))
      } else {
        this.expr(t.key, false) // obj, key
        f.emit(OP.DUP2) // obj, key, obj, key
        f.emit(OP.INDEX) // obj, key, cur
        this.expr(st.value, false) // obj, key, cur, val
        f.emit(OP[bop]) // obj, key, new
        f.emit(OP.SETINDEX)
      }
      return
    }
    throw new UnsupportedError('compound target')
  }

  whileStat(st) {
    const f = this.cur(); const OP = this.OP
    const top = f.newLabel(), end = f.newLabel()
    f.place(top)
    this.expr(st.cond, false); f.emit(OP.CJMPF, end)
    f.loops.push({ brk: end, cont: top })
    f.pushScope(); for (const s of st.body) this.stat(s); f.popScope()
    f.loops.pop()
    f.emit(OP.JMP, top); f.place(end)
  }
  repeatStat(st) {
    const f = this.cur(); const OP = this.OP
    const top = f.newLabel(), cond = f.newLabel(), end = f.newLabel()
    f.place(top)
    f.loops.push({ brk: end, cont: cond })
    f.pushScope()
    for (const s of st.body) this.stat(s)
    f.place(cond)
    this.expr(st.cond, false) // until cond （body スコープ内）
    f.popScope()
    f.loops.pop()
    f.emit(OP.CJMPF, top) // cond が偽ならループ継続
    f.place(end)
  }
  numFor(st) {
    const f = this.cur(); const OP = this.OP
    const idx = f.newSlot(), lim = f.newSlot(), step = f.newSlot()
    this.expr(st.start, false); f.emit(OP.NEWLOCAL, idx)
    this.expr(st.stop, false); f.emit(OP.NEWLOCAL, lim)
    if (st.step) this.expr(st.step, false); else { f.emit(OP.PUSHC, this.kConst(1)) }
    f.emit(OP.NEWLOCAL, step)
    const top = f.newLabel(), cont = f.newLabel(), end = f.newLabel()
    f.place(top)
    f.emit(OP.FORTEST, idx, lim, step, end) // 継続なら idx をスタックに積む／停止なら end へ
    f.pushScope()
    const v = f.declare(st.var.name)
    f.emit(OP.NEWLOCAL, v)
    f.loops.push({ brk: end, cont })
    for (const s of st.body) this.stat(s)
    f.loops.pop()
    f.popScope()
    f.place(cont)
    f.emit(OP.FORADD, idx, step)
    f.emit(OP.JMP, top)
    f.place(end)
  }
  genFor(st) {
    const f = this.cur(); const OP = this.OP
    const fs = f.newSlot(), ss = f.newSlot(), cs = f.newSlot()
    this.evalListAdjust(st.exprs, 3)
    f.emit(OP.NEWLOCAL, cs); f.emit(OP.NEWLOCAL, ss); f.emit(OP.NEWLOCAL, fs)
    const top = f.newLabel(), end = f.newLabel()
    const nvars = st.vars.length
    f.place(top)
    f.emit(OP.GFNEXT, fs, ss, cs, end, nvars) // 結果を順にスタックへ（停止なら end）
    f.pushScope()
    const vslots = st.vars.map(v => f.declare(v.name))
    for (let i = nvars - 1; i >= 0; i--) f.emit(OP.NEWLOCAL, vslots[i])
    f.loops.push({ brk: end, cont: top })
    for (const s of st.body) this.stat(s)
    f.loops.pop()
    f.popScope()
    f.emit(OP.JMP, top)
    f.place(end)
  }
  ifStat(st) {
    const f = this.cur(); const OP = this.OP
    const end = f.newLabel()
    for (let c = 0; c < st.clauses.length; c++) {
      const clause = st.clauses[c]
      const next = f.newLabel()
      this.expr(clause.cond, false); f.emit(OP.CJMPF, next)
      f.pushScope(); for (const s of clause.body) this.stat(s); f.popScope()
      f.emit(OP.JMP, end)
      f.place(next)
    }
    if (st.orelse) { f.pushScope(); for (const s of st.orelse) this.stat(s); f.popScope() }
    f.place(end)
  }
  returnStat(st) {
    const f = this.cur(); const OP = this.OP
    f.emit(OP.MARK)
    for (let i = 0; i < st.values.length; i++) this.expr(st.values[i], i === st.values.length - 1)
    f.emit(OP.RET)
  }

  // ---- 式 ----  multi: 末尾多値を許すか
  expr(node, multi) {
    const f = this.cur(); const OP = this.OP
    switch (node.t) {
      case 'Number': f.emit(OP.PUSHC, this.kConst(node.v)); break
      case 'String': f.emit(OP.PUSHC, this.kConst(node.v)); break
      case 'Nil': f.emit(OP.PUSHNIL); break
      case 'True': f.emit(OP.PUSHTRUE); break
      case 'False': f.emit(OP.PUSHFALSE); break
      case 'Vararg': f.emit(multi ? OP.VARARGALL : OP.VARARG1); break
      case 'Name': {
        const r = this.resolve(node.name)
        if (r.kind === 'local') f.emit(OP.GETLOCAL, r.slot)
        else if (r.kind === 'upval') f.emit(OP.GETUPVAL, r.idx)
        else f.emit(OP.GETGLOBAL, this.gid(node.name))
        break
      }
      case 'Index':
        this.expr(node.obj, false)
        if (node.dot) f.emit(OP.INDEXK, this.kConst(node.key.v))
        else { this.expr(node.key, false); f.emit(OP.INDEX) }
        break
      case 'Call':
        f.emit(OP.MARK)
        this.expr(node.fn, false)
        for (let i = 0; i < node.args.length; i++) this.expr(node.args[i], i === node.args.length - 1)
        f.emit(OP.CALL, multi ? 1 : 0)
        break
      case 'Method':
        f.emit(OP.MARK)
        this.expr(node.obj, false)
        for (let i = 0; i < node.args.length; i++) this.expr(node.args[i], i === node.args.length - 1)
        f.emit(OP.METHOD, this.kConst(node.name), multi ? 1 : 0)
        break
      case 'Func': this.closure(node); break
      case 'Table': this.table(node); break
      case 'Paren': this.expr(node.e, false); break
      case 'Cast': this.expr(node.e, multi); break
      case 'Bin': this.bin(node); break
      case 'Un':
        this.expr(node.e, false)
        if (node.op === '-') f.emit(OP.UNM)
        else if (node.op === 'not') f.emit(OP.NOT)
        else if (node.op === '#') f.emit(OP.LEN)
        else throw new UnsupportedError('unary ' + node.op)
        break
      case 'Interp': this.interp(node); break
      case 'IfExpr': this.ifExpr(node); break
      default: throw new UnsupportedError('expr ' + node.t)
    }
  }
  bin(node) {
    const f = this.cur(); const OP = this.OP
    if (node.op === 'and') {
      const end = f.newLabel()
      this.expr(node.l, false); f.emit(OP.DUP); f.emit(OP.JMPIFF, end); f.emit(OP.POP); this.expr(node.r, false); f.place(end); return
    }
    if (node.op === 'or') {
      const end = f.newLabel()
      this.expr(node.l, false); f.emit(OP.DUP); f.emit(OP.JMPIFT, end); f.emit(OP.POP); this.expr(node.r, false); f.place(end); return
    }
    const b = BINOP[node.op]; if (!b) throw new UnsupportedError('bin ' + node.op)
    this.expr(node.l, false); this.expr(node.r, false); f.emit(OP[b])
  }
  ifExpr(node) {
    const f = this.cur(); const OP = this.OP
    const end = f.newLabel()
    const compileChain = (i) => {
      const c = node.clauses[i]
      const next = f.newLabel()
      this.expr(c.cond, false); f.emit(OP.CJMPF, next)
      this.expr(c.val, false); f.emit(OP.JMP, end)
      f.place(next)
      if (i + 1 < node.clauses.length) compileChain(i + 1)
      else this.expr(node.orelse, false)
    }
    compileChain(0)
    f.place(end)
  }
  interp(node) {
    const f = this.cur(); const OP = this.OP
    const parts = node.parts
    if (parts.length === 0) { f.emit(OP.PUSHC, this.kConst('')); return }
    let first = true
    for (const p of parts) {
      if (typeof p === 'string') f.emit(OP.PUSHC, this.kConst(p))
      else { this.expr(p, false); f.emit(OP.TOSTR) }
      if (!first) f.emit(OP.CONCAT)
      first = false
    }
  }
  table(node) {
    const f = this.cur(); const OP = this.OP
    f.emit(OP.MARK)
    f.emit(OP.NEWTABLE)
    let arrIdx = 0
    const items = node.items
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.k === 'pos') {
        const isLast = i === items.length - 1
        if (isLast) { this.expr(it.value, true); f.emit(OP.SETARRAYALL, arrIdx + 1) }
        else { this.expr(it.value, false); arrIdx++; f.emit(OP.SETARRAY, arrIdx) }
      } else if (it.k === 'named') {
        this.expr(it.value, false); f.emit(OP.SETFIELDK, this.kConst(it.key))
      } else {
        this.expr(it.key, false); this.expr(it.value, false); f.emit(OP.SETFIELD)
      }
    }
    f.emit(OP.ENDTABLE)
  }
  closure(func) {
    const f = this.cur(); const OP = this.OP
    const fi = this.compileFunction({ params: func.params, isVararg: func.isVararg, isMethod: func.isMethod, body: func.body })
    f.emit(OP.CLOSURE, fi)
  }
}

// ---------------------------------------------------------------------------
// Lua 出力
// ---------------------------------------------------------------------------
function luaStr(bytes) { let o = '"'; for (let i = 0; i < bytes.length; i++) o += '\\' + bytes.charCodeAt(i); return o + '"' }
function luaNum(v) { if (Number.isInteger(v)) return String(v); if (!isFinite(v)) return v > 0 ? '(1/0)' : (v < 0 ? '(-1/0)' : '(0/0)'); return String(v) }
function luaConst(v) { if (typeof v === 'string') return luaStr(v); if (typeof v === 'number') return luaNum(v); if (typeof v === 'boolean') return v ? 'true' : 'false'; return 'nil' }
function arr(a) { return '{' + a.join(',') + '}' }
function nameMaker(rnd) { const used = new Set(); return () => { for (;;) { let s = 'v'; const len = 4 + ((rnd() * 5) | 0); const A = 'Il1O0o'; for (let i = 0; i < len; i++) s += A[(rnd() * A.length) | 0]; if (!used.has(s)) { used.add(s); return s } } } }

export function compileToLua(src, options = {}) {
  const rnd = options.rnd || Math.random
  const hideApi = !!options.hideApi
  const c = new Compiler(rnd)
  const { rootFI } = c.compileChunk(src)
  const OP = c.OP

  // API 名の隠蔽: 読み取り専用グローバル名を暗号化定数にし、実行時に環境から解決
  const nameKi = new Map()
  if (hideApi) for (const n of c.gnames) if (!c.gWritten.has(n)) nameKi.set(n, c.kConst(n))
  const nm = nameMaker(rnd)
  // この版はトップレベルのヘルパ名を固定（ディスパッチ本文と一致させる）。難読化は別段で。
  const V = { FN: 'FN', K: 'K', GG: 'GG', GS: 'GS', mk: 'mk', unpack: 'unpack', pack: 'pack' }

  // --- H1: 命令ストリームの pc 依存エンコード（静的抽出を封じる） ---
  // 各命令の op と operand を、その命令の pc から決まる鍵で加算符号化する。
  // 静的には {op,operand} が読めず、正規表現での抽出・オペコード対応表の復元を阻む。
  const P = 2147483647
  const rc = () => 1 + Math.floor(rnd() * (P - 2))
  const A1 = rc(), S1 = rc(), A2 = rc(), S2 = rc()
  const key1 = (pc) => (pc * A1 + S1) % P
  const key2 = (pc) => (pc * A2 + S2) % P
  for (const fd of c.funcs) {
    fd.code = fd.code.map((ins, j) => {
      const pc = j + 1
      const out = [ins[0] + key1(pc)]
      for (let k = 1; k < ins.length; k++) out.push(ins[k] + key2(pc))
      return out
    })
  }

  // 関数定義（符号化済みコード）
  const fnLua = '{' + c.funcs.map(fd => {
    const code = '{' + fd.code.map(arr).join(',') + '}'
    const up = '{' + fd.up.map(u => u.l != null ? `{0,${u.l}}` : `{1,${u.u}}`).join(',') + '}'
    return `{${code},${fd.np},${fd.va},${up}}`
  }).join(',') + '}'

  // --- H2: 文字列定数の暗号化（単一平文キーを廃止。FN ブロブのチェックサムで鍵付け＝改ざん検知） ---
  // seed は実行時に FN の全整数和から導出。FN を改ざんすると鍵が変わり復号が壊れる。
  const S3 = rc()
  let chk = 0
  for (const fd of c.funcs) for (const ins of fd.code) for (const x of ins) chk = (chk + x) % 1000003
  const seed = (chk + S3) % 1000003
  const byteKey = (ki, j) => (seed + ki * 131 + j * 17) % 256
  const kLua = '{' + c.K.map((v, idx) => {
    const ki = idx + 1
    if (typeof v === 'string') {
      const enc = []
      for (let j = 0; j < v.length; j++) enc.push((v.charCodeAt(j) + byteKey(ki, j + 1)) % 256)
      return `{0,${arr(enc)}}`
    }
    if (typeof v === 'number') return `{1,${luaNum(v)}}`
    if (typeof v === 'boolean') return `{2,${v ? 1 : 0}}`
    return `{3}`
  }).join(',') + '}'

  // GG/GS （hideApi 時、読み取り専用グローバルは ENV 経由で名前解決）
  const V_ENV = nm()
  const gg = c.gnames.map((n, i) => {
    if (hideApi && nameKi.has(n)) return `${V.GG}[${i + 1}]=function() return ${V_ENV}(${V.K}[${nameKi.get(n)}]) end`
    return `${V.GG}[${i + 1}]=function() return ${n} end`
  }).join(' ')
  const gsArg = nm()
  const gs = c.gnames.filter(n => c.gWritten.has(n)).map(n => `${V.GS}[${c.gmap.get(n)}]=function(${gsArg}) ${n}=${gsArg} end`).join(' ')
  const envBlock = hideApi ? `local ${V_ENV}
do local src={}
local function ad(fn,...) if fn then local ok,v=pcall(fn,...) if ok and type(v)=="table" then src[#src+1]=v end end end
ad(getgenv) ad(getrenv) ad(getfenv,1) if _G then src[#src+1]=_G end
${V_ENV}=function(n) for i=1,#src do local v=src[i][n] if v~=nil then return v end end end
end` : ''

  // ディスパッチ本体
  const disp = dispatch(OP)

  const decOps = disp.replace(/ins\[([2-9])\]/g, '(ins[$1]-K2)')

  const lua = `local ${V.unpack}=table.unpack or unpack
local ${V.pack}=table.pack or function(...) return {n=select('#',...),...} end
local ${V.FN}=${fnLua}
-- 定数復号: FN の整数和(チェックサム)から鍵を導出（改ざんで復号が壊れる）
local ${V.K}
do
local chk=0
for i=1,#${V.FN} do local cd=${V.FN}[i][1] for a=1,#cd do local w=cd[a] for b=1,#w do chk=(chk+w[b])%1000003 end end end
local seed=(chk+${S3})%1000003
local raw=${kLua}
${V.K}={}
for i=1,#raw do local e=raw[i] local tg=e[1]
if tg==0 then local by=e[2] local s="" for j=1,#by do s=s..string.char((by[j]-(seed+i*131+j*17))%256) end ${V.K}[i]=s
elseif tg==1 then ${V.K}[i]=e[2]
elseif tg==2 then ${V.K}[i]=(e[2]==1)
else ${V.K}[i]=nil end end
end
local ${V.GG}={} local ${V.GS}={}
${envBlock}
${gg}
${gs}
local ${V.mk}
${V.mk}=function(fi,U)
local fd=${V.FN}[fi]
local C=fd[1] local np=fd[2] local hasva=fd[3]
return function(...)
local cells={} local S={} local sp=0 local marks={} local mt=0
local a=${V.pack}(...)
for i=1,np do cells[i]={a[i]} end
local va
if hasva==1 then local vn=a.n-np if vn<0 then vn=0 end va={n=vn} for i=1,vn do va[i]=a[np+i] end end
local pc=1
while true do
local ins=C[pc]
local K1=(pc*${A1}+${S1})%${P} local K2=(pc*${A2}+${S2})%${P}
local op=ins[1]-K1
${decOps}
end
end
end
return ${V.mk}(${rootFI},nil)(...)
`
  return { lua, stats: { funcs: c.funcs.length, consts: c.K.length } }
}

// ディスパッチ（この版は if/elseif。ハードニング版で実行時キー・テーブル化する）
function dispatch(OP) {
  const L = []
  const bin = { ADD: '+', SUB: '-', MUL: '*', DIV: '/', IDIV: '//', MOD: '%', POW: '^', CONCAT: '..', EQ: '==', NE: '~=', LT: '<', LE: '<=', GT: '>', GE: '>=' }
  let first = true
  const C = (opName, body) => { L.push(`${first ? 'if' : 'elseif'} op==${OP[opName]} then ${body}`); first = false }
  C('PUSHC', 'sp=sp+1 S[sp]=K2(ins[2]) pc=pc+1'.replace('K2(ins[2])', '__K[ins[2]]'))
  // 上の置換は使わず直接書く
  L.length = 0; first = true
  const K = '__K'
  // 再定義（__K を直接使う）
  C('PUSHC', `sp=sp+1 S[sp]=${K}[ins[2]] pc=pc+1`)
  C('PUSHNIL', 'sp=sp+1 S[sp]=nil pc=pc+1')
  C('PUSHTRUE', 'sp=sp+1 S[sp]=true pc=pc+1')
  C('PUSHFALSE', 'sp=sp+1 S[sp]=false pc=pc+1')
  C('GETLOCAL', 'sp=sp+1 S[sp]=cells[ins[2]][1] pc=pc+1')
  C('SETLOCAL', 'cells[ins[2]][1]=S[sp] sp=sp-1 pc=pc+1')
  C('NEWLOCAL', 'cells[ins[2]]={S[sp]} sp=sp-1 pc=pc+1')
  C('NEWLOCALNIL', 'cells[ins[2]]={} pc=pc+1')
  C('GETUPVAL', 'sp=sp+1 S[sp]=U[ins[2]][1] pc=pc+1')
  C('SETUPVAL', 'U[ins[2]][1]=S[sp] sp=sp-1 pc=pc+1')
  C('GETGLOBAL', 'sp=sp+1 S[sp]=__GG[ins[2]]() pc=pc+1')
  C('SETGLOBAL', '__GS[ins[2]](S[sp]) sp=sp-1 pc=pc+1')
  C('CLOSURE', 'local nf=fd[1] local cfd=__FN[ins[2]] local ud=cfd[4] local nu={} for i=1,#ud do local d=ud[i] if d[1]==0 then nu[i]=cells[d[2]] else nu[i]=U[d[2]] end end sp=sp+1 S[sp]=__mk(ins[2],nu) pc=pc+1')
  C('VARARG1', 'sp=sp+1 S[sp]=va and va[1] or nil pc=pc+1')
  C('VARARGALL', 'if va then for i=1,va.n do sp=sp+1 S[sp]=va[i] end end pc=pc+1')
  C('INDEX', 'local k=S[sp] local o=S[sp-1] sp=sp-1 S[sp]=o[k] pc=pc+1')
  C('INDEXK', 'S[sp]=S[sp][' + K + '[ins[2]]] pc=pc+1')
  C('SETINDEX', 'local v=S[sp] local k=S[sp-1] local o=S[sp-2] sp=sp-3 o[k]=v pc=pc+1')
  C('SETINDEXK', 'local v=S[sp] local o=S[sp-1] sp=sp-2 o[' + K + '[ins[2]]]=v pc=pc+1')
  C('MARK', 'mt=mt+1 marks[mt]=sp pc=pc+1')
  C('CALL', 'local base=marks[mt] mt=mt-1 local f=S[base+1] local n=sp-base-1 local ar={} for i=1,n do ar[i]=S[base+1+i] end sp=base if ins[2]==1 then local r=__pack(f(__unpack(ar,1,n))) for i=1,r.n do sp=sp+1 S[sp]=r[i] end else sp=sp+1 S[sp]=f(__unpack(ar,1,n)) end pc=pc+1')
  C('METHOD', 'local base=marks[mt] mt=mt-1 local o=S[base+1] local m=o[' + K + '[ins[2]]] local n=sp-base-1 local ar={} for i=1,n do ar[i]=S[base+1+i] end sp=base if ins[3]==1 then local r=__pack(m(o,__unpack(ar,1,n))) for i=1,r.n do sp=sp+1 S[sp]=r[i] end else sp=sp+1 S[sp]=m(o,__unpack(ar,1,n)) end pc=pc+1')
  for (const [op, sym] of Object.entries(bin)) C(op, `local b=S[sp] local a=S[sp-1] sp=sp-1 S[sp]=a${sym}b pc=pc+1`)
  C('UNM', 'S[sp]=-S[sp] pc=pc+1')
  C('NOT', 'S[sp]=not S[sp] pc=pc+1')
  C('LEN', 'S[sp]=#S[sp] pc=pc+1')
  C('TOSTR', 'S[sp]=tostring(S[sp]) pc=pc+1')
  C('JMP', 'pc=ins[2]')
  C('CJMPF', 'local v=S[sp] sp=sp-1 if not v then pc=ins[2] else pc=pc+1 end')
  C('JMPIFT', 'if S[sp] then pc=ins[2] else pc=pc+1 end')
  C('JMPIFF', 'if not S[sp] then pc=ins[2] else pc=pc+1 end')
  C('POP', 'sp=sp-1 pc=pc+1')
  C('DUP', 'sp=sp+1 S[sp]=S[sp-1] pc=pc+1')
  C('DUP2', 'S[sp+1]=S[sp-1] S[sp+2]=S[sp] sp=sp+2 pc=pc+1')
  C('ADJUST', 'local base=marks[mt] mt=mt-1 local want=ins[2] local have=sp-base if have>want then sp=base+want else for i=have+1,want do sp=sp+1 S[sp]=nil end end pc=pc+1')
  C('NEWTABLE', 'sp=sp+1 S[sp]={} pc=pc+1')
  C('SETARRAY', 'local base=marks[mt] local v=S[sp] sp=sp-1 S[base+1][ins[2]]=v pc=pc+1')
  C('SETARRAYALL', 'local base=marks[mt] local st=ins[2] local t=S[base+1] local j=st for i=base+2,sp do t[j]=S[i] j=j+1 end sp=base+1 pc=pc+1')
  C('SETFIELD', 'local base=marks[mt] local v=S[sp] local k=S[sp-1] sp=sp-2 S[base+1][k]=v pc=pc+1')
  C('SETFIELDK', 'local base=marks[mt] local v=S[sp] sp=sp-1 S[base+1][' + K + '[ins[2]]]=v pc=pc+1')
  C('ENDTABLE', 'local base=marks[mt] mt=mt-1 local t=S[base+1] sp=base+1 S[sp]=t pc=pc+1')
  C('FORTEST', 'local i=cells[ins[2]][1] local lim=cells[ins[3]][1] local stp=cells[ins[4]][1] local go if stp>0 then go=i<=lim else go=i>=lim end if go then sp=sp+1 S[sp]=i pc=pc+1 else pc=ins[5] end')
  C('FORADD', 'cells[ins[2]][1]=cells[ins[2]][1]+cells[ins[3]][1] pc=pc+1')
  C('GFNEXT', 'local f=cells[ins[2]][1] local s=cells[ins[3]][1] local ctl=cells[ins[4]][1] local r=__pack(f(s,ctl)) if r[1]==nil then pc=ins[5] else cells[ins[4]][1]=r[1] local nv=ins[6] for i=1,nv do sp=sp+1 S[sp]=r[i] end pc=pc+1 end')
  C('RET', 'local base=marks[mt] mt=mt-1 local n=sp-base local r={} for i=1,n do r[i]=S[base+i] end return __unpack(r,1,n)')
  L.push('end')
  return L.join('\n')
    .replace(/__K/g, 'K').replace(/__GG/g, 'GG').replace(/__GS/g, 'GS')
    .replace(/__FN/g, 'FN').replace(/__mk/g, 'mk').replace(/__pack/g, 'pack').replace(/__unpack/g, 'unpack')
}
