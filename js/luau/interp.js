// Luau の構文木をそのまま実行するインタプリタ
// eval / new Function が使えない環境 (claude.ai の埋め込み表示など、CSP で禁止されている場合) 用。
// compiler.js が出力する JavaScript と同じ順序・同じ補助関数で動くので、結果やエラーの位置は同じになります。
// (速さはコンパイル版より遅くなります)
import { parse } from './parser.js'
import { LuauSyntaxError, toBytes } from './lexer.js'

const BRK = 1, CNT = 2 // 文の実行結果: undefined = 次へ / 1 = break / 2 = continue / 配列 = return
const ARITH = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '%': 'mod', '^': 'pow', '//': 'idiv', '..': 'concat' }
const CMP = { '==': 'eq', '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge' }
const isMulti = e => e.t === 'Call' || e.t === 'Method' || e.t === 'Vararg'

class Frame {
  constructor(p, n) { this.p = p; this.v = n ? new Array(n) : null }
}

// ============================================================
// 準備: 変数の位置 (何段外側の何番目か) を前もって決める
// ============================================================
class SScope {
  constructor(parent, frame) { this.parent = parent; this.frame = frame; this.vars = new Map(); this.list = []; this.n = 0 }
}
// ブロック直下で宣言されるローカル変数の数 (0 なら実行時にフレームを作らない)
function countDecls(stats) {
  let n = 0
  for (const st of stats) {
    if (st.t === 'Local') n += st.names.length
    else if (st.t === 'LocalFunction') n++
  }
  return n
}

class Prep {
  constructor(chunk, debug) { this.chunk = chunk; this.debug = debug; this.scope = null; this.fn = null; this.loops = 0 }
  err(msg, line) { throw new LuauSyntaxError(msg, line, 1, 0) }
  declare(name) {
    const s = this.scope
    const i = s.n++
    s.vars.set(name, i)
    s.list.push([name, i])
    return i
  }
  resolve(name) {
    let hops = 0
    for (let s = this.scope; s; s = s.parent) {
      if (s.vars.has(name)) return [hops, s.vars.get(name)]
      if (s.frame) hops++
    }
    return null
  }
  // デバッグ用: いま見えているローカル変数 [名前, 段数, 番号]
  visible() {
    const out = [], seen = new Set()
    let hops = 0
    for (let s = this.scope; s; s = s.parent) {
      for (let k = s.list.length - 1; k >= 0; k--) {
        const [n, i] = s.list[k]
        if (seen.has(n)) continue
        seen.add(n)
        out.push([n, hops, i])
      }
      if (s.frame) hops++
    }
    return out
  }
  block(stats, extra) {
    const n = countDecls(stats) + (extra || 0)
    const sc = new SScope(this.scope, n > 0)
    this.scope = sc
    return sc
  }
  close(sc, node) { node.$n = sc.n; node.$f = sc.frame; this.scope = sc.parent }

  func(node, isMethod) {
    const saveFn = this.fn, saveLoops = this.loops
    this.fn = node
    this.loops = 0
    const np = node.params.length + (isMethod || node.isMethod ? 1 : 0)
    const sc = new SScope(this.scope, true)
    this.scope = sc
    node.$self = !!(isMethod || node.isMethod)
    if (node.$self) this.declare('self')
    node.$params = node.params.map(p => this.declare(p.name))
    node.$np = np
    this.stats(node.body)
    node.$n = sc.n
    node.$top = node.isChunk ? sc.list.slice(0, 400) : null
    this.scope = sc.parent
    this.fn = saveFn
    this.loops = saveLoops
  }
  stats(stats) { for (const st of stats) this.stat(st) }
  stat(st) {
    if (this.debug && st.t !== 'TypeAlias') st.$vis = this.visible()
    switch (st.t) {
      case 'Local':
        for (const v of st.values) this.expr(v)
        st.$idx = st.names.map(b => this.declare(b.name))
        return
      case 'LocalFunction':
        st.$idx = this.declare(st.name.name)
        this.expr(st.func)
        return
      case 'Function':
        this.func(st.func, st.isMethod)
        this.target(st.target)
        return
      case 'Assign':
        for (const v of st.values) this.expr(v)
        for (const t of st.targets) this.target(t)
        return
      case 'Compound': this.expr(st.value); this.target(st.target); return
      case 'CallStat': this.expr(st.call); return
      case 'If':
        for (const c of st.clauses) { this.expr(c.cond); const sc = this.block(c.body); this.stats(c.body); this.close(sc, c) }
        if (st.orelse) { const sc = this.block(st.orelse); this.stats(st.orelse); st.$else = {}; this.close(sc, st.$else) }
        return
      case 'While': {
        this.expr(st.cond)
        this.loops++
        const sc = this.block(st.body)
        this.stats(st.body)
        this.close(sc, st)
        this.loops--
        return
      }
      case 'Repeat': {
        this.loops++
        const sc = this.block(st.body)
        this.stats(st.body)
        this.expr(st.cond)
        this.close(sc, st)
        this.loops--
        return
      }
      case 'NumFor': {
        this.expr(st.start); this.expr(st.stop); if (st.step) this.expr(st.step)
        this.loops++
        const sc = this.block(st.body, 1)
        st.$v = this.declare(st.var.name)
        this.stats(st.body)
        this.close(sc, st)
        this.loops--
        return
      }
      case 'GenFor': {
        for (const e of st.exprs) this.expr(e)
        this.loops++
        const sc = this.block(st.body, st.vars.length)
        st.$vars = st.vars.map(v => this.declare(v.name))
        this.stats(st.body)
        this.close(sc, st)
        this.loops--
        return
      }
      case 'Do': { const sc = this.block(st.body); this.stats(st.body); this.close(sc, st); return }
      case 'Return': for (const v of st.values) this.expr(v); return
      case 'Break': return
      case 'Continue': if (!this.loops) this.err("'continue' はループの中でしか使えません", st.line); return
      case 'TypeAlias': return
      default: this.err('未対応の文: ' + st.t, st.line)
    }
  }
  target(t) {
    if (t.t === 'Name') { t.$r = this.resolve(t.name); if (!t.$r) t.$g = toBytes(t.name); return }
    this.expr(t.obj)
    if (t.dot) t.$k = toBytes(t.key.v)
    else this.expr(t.key)
  }
  // 式: 呼び出しを含まないものは $p (yield しない速い経路で評価)
  expr(e) {
    let pure = true
    switch (e.t) {
      case 'Nil': case 'True': case 'False': case 'Number': case 'String': break
      case 'Vararg': if (!this.fn || !this.fn.isVararg) this.err("'...' は可変長引数の関数の中でしか使えません", e.line); break
      case 'Func': this.func(e); break
      case 'Table':
        for (const it of e.items) {
          if (it.k === 'named') it.$k = toBytes(it.key)
          else if (it.k === 'expr') pure = this.expr(it.key) && pure
          pure = this.expr(it.value) && pure
        }
        break
      case 'Bin':
        if (!ARITH[e.op] && !CMP[e.op] && e.op !== '~=' && e.op !== 'and' && e.op !== 'or') this.err('未対応の演算子: ' + e.op, e.line)
        pure = this.expr(e.l) & this.expr(e.r) ? true : false
        break
      case 'Un': pure = this.expr(e.e); break
      case 'Name': e.$r = this.resolve(e.name); if (!e.$r) e.$g = toBytes(e.name); break
      case 'Index':
        pure = this.expr(e.obj)
        if (e.dot) e.$k = toBytes(e.key.v)
        else pure = this.expr(e.key) && pure
        break
      case 'Call':
        this.expr(e.fn)
        for (const a of e.args) this.expr(a)
        e.$hint = e.fn.t === 'Name' ? (this.resolve(e.fn.name) ? 'local ' : 'global ') + `'${e.fn.name}'` : e.fn.t === 'Index' && e.fn.dot ? `field '${e.fn.key.v}'` : undefined
        pure = false
        break
      case 'Method':
        this.expr(e.obj)
        for (const a of e.args) this.expr(a)
        e.$m = toBytes(e.name)
        pure = false
        break
      case 'Paren': case 'Cast': pure = this.expr(e.e); break
      case 'IfExpr':
        for (const c of e.clauses) { pure = this.expr(c.cond) && pure; pure = this.expr(c.val) && pure }
        pure = this.expr(e.orelse) && pure
        break
      case 'Interp':
        for (const p of e.parts) if (typeof p !== 'string') pure = this.expr(p) && pure
        break
      default: this.err('未対応の式: ' + e.t, e.line)
    }
    e.$p = pure
    return pure
  }
}

// ============================================================
// 実行
// ============================================================
export function makeInterpreter(H, chunk, D) {
  const { T, chk, EMPTY } = H
  const NOF = {}

  const frameAt = (F, hops) => { while (hops-- > 0) F = F.p; return F }
  const getName = (e, F, cx) => (e.$r ? frameAt(F, e.$r[0]).v[e.$r[1]] : H.index(cx.F.env || cx.Ep, e.$g))

  function makeFunc(node, F, Ep) {
    const name = node.name || 'anonymous'
    const g = function* (A) { return yield* invoke(node, F, this || NOF, A, Ep, name) }
    const f = H.fn(g, name)
    f.envD = Ep
    return f
  }

  function* invoke(node, Fcap, self, A, Ep, name) {
    const F = new Frame(Fcap, node.$n)
    const cx = { L: node.line, F: self, Ep, va: EMPTY }
    const ps = node.$params
    let k = 0
    if (node.$self) F.v[0] = A[k++]
    for (let i = 0; i < ps.length; i++) F.v[ps[i]] = A[k++]
    if (node.isVararg) cx.va = A.length > node.$np ? A.slice(node.$np) : EMPTY
    if (node.$top) H.topLocals(chunk, () => node.$top.map(([n, i]) => [n, F.v[i]]))
    let fr = null
    if (D) fr = D.e(name, () => cx.L)
    try {
      const r = yield* stats(node.body, F, cx)
      return Array.isArray(r) ? r : EMPTY
    } catch (e) {
      throw H.annot(e, cx.L, chunk, name)
    } finally { if (D) D.x(fr) }
  }

  // ---- 文 ----
  function* stats(list, F, cx) {
    for (let i = 0; i < list.length; i++) {
      const st = list[i]
      if (st.t === 'TypeAlias') continue
      cx.L = st.line
      if (D && D.a && D.h(st.line) && D.q(st.line, debugVars(st, F))) yield D.sig
      const r = yield* stat(st, F, cx)
      if (r !== undefined) return r
    }
    return undefined
  }
  function debugVars(st, F) {
    const vis = st.$vis || []
    return () => vis.map(([n, hops, i]) => { const fr = frameAt(F, hops); return [n, fr.v ? fr.v[i] : undefined] })
  }
  const blockFrame = (node, F) => (node.$f ? new Frame(F, node.$n) : F)

  function* stat(st, F, cx) {
    switch (st.t) {
      case 'Local': {
        const vals = st.values, n = st.$idx.length
        if (!vals.length) { for (const i of st.$idx) F.v[i] = undefined; return }
        if (n === 1 && vals.length === 1) { F.v[st.$idx[0]] = yield* single(vals[0], F, cx); return }
        if (vals.length >= n) {
          const tmp = []
          for (let i = 0; i < vals.length; i++) { const v = yield* single(vals[i], F, cx); if (i < n) tmp.push(v) }
          for (let i = 0; i < n; i++) F.v[st.$idx[i]] = tmp[i]
          return
        }
        const arr = yield* explist(vals, F, cx)
        for (let i = 0; i < n; i++) F.v[st.$idx[i]] = arr[i]
        return
      }
      case 'LocalFunction': F.v[st.$idx] = makeFunc(st.func, F, cx.F.env || cx.Ep); return
      case 'Function': yield* assignTo(st.target, makeFunc(st.func, F, cx.F.env || cx.Ep), F, cx, true); return
      case 'Assign': {
        const { targets, values } = st
        if (targets.length === 1 && values.length === 1) {
          const t = targets[0]
          if (t.t === 'Name') { yield* assignTo(t, yield* single(values[0], F, cx), F, cx, true); return }
          const o = yield* single(t.obj, F, cx)
          const k = t.dot ? t.$k : yield* single(t.key, F, cx)
          H.setindex(o, k, yield* single(values[0], F, cx))
          return
        }
        let tmps
        if (values.length >= targets.length) {
          tmps = []
          for (let i = 0; i < values.length; i++) { const v = yield* single(values[i], F, cx); if (i < targets.length) tmps.push(v) }
        } else tmps = yield* explist(values, F, cx)
        for (let i = 0; i < targets.length; i++) yield* assignTo(targets[i], tmps[i], F, cx, true)
        return
      }
      case 'Compound': {
        const op = H[ARITH[st.op]]
        const tg = st.target
        if (tg.t !== 'Name') {
          const o = yield* single(tg.obj, F, cx)
          const k = tg.dot ? tg.$k : yield* single(tg.key, F, cx)
          const v = yield* single(st.value, F, cx)
          H.setindex(o, k, op(H.index(o, k), v))
          return
        }
        const val = yield* single(st.value, F, cx)
        {
          if (tg.$r) { const fr = frameAt(F, tg.$r[0]); fr.v[tg.$r[1]] = op(fr.v[tg.$r[1]], val); return }
          const g = cx.F.env || cx.Ep
          H.setindex(g, tg.$g, op(H.index(g, tg.$g), val))
          return
        }
      }
      case 'CallStat': yield* callExpr(st.call, F, cx); return
      case 'If': {
        const cl = st.clauses
        for (let i = 0; i < cl.length; i++) {
          const c = cl[i]
          if (i) cx.L = c.line
          if (yield* cond(c.cond, F, cx)) return yield* stats(c.body, blockFrame(c, F), cx)
        }
        if (st.orelse) return yield* stats(st.orelse, blockFrame(st.$else, F), cx)
        return
      }
      case 'While':
        while (yield* cond(st.cond, F, cx)) {
          chk()
          const r = yield* stats(st.body, blockFrame(st, F), cx)
          if (r === BRK) break
          if (r !== undefined && r !== CNT) return r
        }
        return
      case 'Repeat':
        for (;;) {
          chk()
          const BF = blockFrame(st, F)
          const r = yield* stats(st.body, BF, cx)
          if (r === BRK) break
          if (r !== undefined && r !== CNT) return r
          cx.L = st.line
          if (yield* cond(st.cond, BF, cx)) break
        }
        return
      case 'NumFor': {
        const a = H.forNum(yield* single(st.start, F, cx), 'initial value')
        const b = H.forNum(yield* single(st.stop, F, cx), 'limit')
        let c = 1
        if (st.step) {
          if (st.step.t === 'Number') c = st.step.v
          else if (st.step.t === 'Un' && st.step.op === '-' && st.step.e.t === 'Number') c = -st.step.e.v
          else c = H.forNum(yield* single(st.step, F, cx), 'step')
        }
        if (c === 0) throw H.rtError("'for' step is zero")
        for (let i = a; c > 0 ? i <= b : i >= b; i += c) {
          chk()
          const BF = new Frame(F, st.$n)
          BF.v[st.$v] = i
          const r = yield* stats(st.body, BF, cx)
          if (r === BRK) break
          if (r !== undefined && r !== CNT) return r
        }
        return
      }
      case 'GenFor': {
        const it = H.iter(yield* explist(st.exprs, F, cx))
        const vars = st.$vars
        for (;;) {
          chk()
          const r0 = it.f ? it.step() : yield* it.g()
          if (r0 === null) break
          const BF = new Frame(F, st.$n)
          for (let i = 0; i < vars.length; i++) BF.v[vars[i]] = r0[i]
          const r = yield* stats(st.body, BF, cx)
          if (r === BRK) break
          if (r !== undefined && r !== CNT) return r
        }
        return
      }
      case 'Do': return yield* stats(st.body, blockFrame(st, F), cx)
      case 'Return': return st.values.length ? yield* explist(st.values, F, cx) : EMPTY
      case 'Break': return BRK
      case 'Continue': return CNT
    }
  }

  function* assignTo(t, v, F, cx) {
    if (t.t === 'Name') {
      if (t.$r) { frameAt(F, t.$r[0]).v[t.$r[1]] = v; return }
      H.setindex(cx.F.env || cx.Ep, t.$g, v)
      return
    }
    const o = yield* single(t.obj, F, cx)
    const k = t.dot ? t.$k : yield* single(t.key, F, cx)
    H.setindex(o, k, v)
  }

  // ---- 式 ----
  function* cond(e, F, cx) { return T(e.$p ? pure(e, F, cx) : yield* single(e, F, cx)) }

  function* explist(list, F, cx) {
    if (!list.length) return EMPTY
    const last = list[list.length - 1]
    if (list.length === 1 && isMulti(last)) return yield* multi(last, F, cx)
    const out = []
    for (let i = 0; i < list.length; i++) {
      const x = list[i]
      if (i === list.length - 1 && isMulti(x)) { const m = yield* multi(x, F, cx); for (const v of m) out.push(v) }
      else out.push(x.$p ? pure(x, F, cx) : yield* single(x, F, cx))
    }
    return out
  }
  function* multi(e, F, cx) {
    if (e.t === 'Vararg') return cx.va
    return yield* callExpr(e, F, cx)
  }
  function* callExpr(e, F, cx) {
    if (e.t === 'Method') {
      cx.L = e.line
      const o = yield* single(e.obj, F, cx)
      const args = yield* explist(e.args, F, cx)
      return yield* H.callMethod(o, e.$m, args)
    }
    cx.L = e.line
    const f = yield* single(e.fn, F, cx)
    const args = yield* explist(e.args, F, cx)
    return yield* H.call(f, args, e.$hint)
  }

  function* single(e, F, cx) {
    if (e.$p) return pure(e, F, cx)
    switch (e.t) {
      case 'Call': case 'Method': return (yield* callExpr(e, F, cx))[0]
      case 'Paren': case 'Cast': return yield* single(e.e, F, cx)
      case 'Index': {
        const o = yield* single(e.obj, F, cx)
        return H.index(o, e.dot ? e.$k : yield* single(e.key, F, cx))
      }
      case 'Bin': {
        const op = e.op
        if (op === 'and') { const l = yield* single(e.l, F, cx); return T(l) ? yield* single(e.r, F, cx) : l }
        if (op === 'or') { const l = yield* single(e.l, F, cx); return T(l) ? l : yield* single(e.r, F, cx) }
        const l = yield* single(e.l, F, cx), r = yield* single(e.r, F, cx)
        return binop(op, l, r)
      }
      case 'Un': {
        const v = yield* single(e.e, F, cx)
        return e.op === '-' ? H.unm(v) : e.op === 'not' ? !T(v) : H.len(v)
      }
      case 'Table': {
        const pos = [], pairs = []
        const items = e.items
        for (let i = 0; i < items.length; i++) {
          const it = items[i]
          if (it.k === 'pos') {
            if (i === items.length - 1 && isMulti(it.value)) { const m = yield* multi(it.value, F, cx); for (const v of m) pos.push(v) }
            else pos.push(yield* single(it.value, F, cx))
          }
        }
        for (const it of items) {
          if (it.k === 'named') pairs.push(it.$k, yield* single(it.value, F, cx))
          else if (it.k === 'expr') { const k = yield* single(it.key, F, cx); pairs.push(k, yield* single(it.value, F, cx)) }
        }
        return mkTable(pos, pairs, items)
      }
      case 'IfExpr':
        for (const c of e.clauses) if (yield* cond(c.cond, F, cx)) return yield* single(c.val, F, cx)
        return yield* single(e.orelse, F, cx)
      case 'Interp': {
        const parts = []
        for (const p of e.parts) parts.push(typeof p === 'string' ? p : yield* single(p, F, cx))
        return H.interp(parts)
      }
    }
    return pure(e, F, cx)
  }

  const mkTable = (pos, pairs, items) => (!items.length ? H.tbl() : !pairs.length ? H.tbl(pos) : H.tbl(pos.length ? pos : null, pairs))
  function binop(op, l, r) {
    const a = ARITH[op]
    if (a) return H[a](l, r)
    const c = CMP[op]
    if (c) return H[c](l, r)
    return !H.eq(l, r) // ~=
  }

  // 呼び出しを含まない式 (yield しない)
  function pure(e, F, cx) {
    switch (e.t) {
      case 'Nil': return undefined
      case 'True': return true
      case 'False': return false
      case 'Number': case 'String': return e.v
      case 'Vararg': return cx.va[0]
      case 'Func': return makeFunc(e, F, cx.F.env || cx.Ep)
      case 'Name': return getName(e, F, cx)
      case 'Index': { const o = pure(e.obj, F, cx); return H.index(o, e.dot ? e.$k : pure(e.key, F, cx)) }
      case 'Paren': case 'Cast': return pure(e.e, F, cx)
      case 'Bin': {
        const op = e.op
        if (op === 'and') { const l = pure(e.l, F, cx); return T(l) ? pure(e.r, F, cx) : l }
        if (op === 'or') { const l = pure(e.l, F, cx); return T(l) ? l : pure(e.r, F, cx) }
        return binop(op, pure(e.l, F, cx), pure(e.r, F, cx))
      }
      case 'Un': {
        if (e.op === '-' && e.e.t === 'Number') return -e.e.v
        const v = pure(e.e, F, cx)
        return e.op === '-' ? H.unm(v) : e.op === 'not' ? !T(v) : H.len(v)
      }
      case 'Table': {
        const pos = [], pairs = []
        const items = e.items
        for (let i = 0; i < items.length; i++) {
          const it = items[i]
          if (it.k !== 'pos') continue
          if (i === items.length - 1 && it.value.t === 'Vararg') { for (const v of cx.va) pos.push(v) }
          else pos.push(pure(it.value, F, cx))
        }
        for (const it of items) {
          if (it.k === 'named') pairs.push(it.$k, pure(it.value, F, cx))
          else if (it.k === 'expr') { const k = pure(it.key, F, cx); pairs.push(k, pure(it.value, F, cx)) }
        }
        return mkTable(pos, pairs, items)
      }
      case 'IfExpr':
        for (const c of e.clauses) if (T(pure(c.cond, F, cx))) return pure(c.val, F, cx)
        return pure(e.orelse, F, cx)
      case 'Interp': return H.interp(e.parts.map(p => (typeof p === 'string' ? p : pure(p, F, cx))))
    }
    throw H.rtError('internal: unexpected expression ' + e.t)
  }

  return { makeFunc }
}

// ソースを読み込み LFunc を返す (compiler.js の loadChunk と同じ形)
export function loadChunkInterp(src, chunkname, env, helpers, dbgHandle) {
  const ast = parse(src)
  const main = { t: 'Func', params: [], isVararg: true, body: ast.body, name: null, line: 1, isChunk: true }
  new Prep(chunkname, !!dbgHandle).func(main)
  const { makeFunc } = makeInterpreter(helpers, chunkname, dbgHandle || null)
  const f = makeFunc(main, null, env)
  f.name = chunkname
  return f
}
