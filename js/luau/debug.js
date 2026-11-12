// デバッガー: ブレークポイント・ステップ実行・変数の確認
// コンパイラがデバッグ実行用に、各文の前へ次のコードを入れます:
//   if ($D.a && $D.h(行) && $D.q(行, ローカル変数を返す関数)) yield $D.sig
// 止まるときは yield で実行を中断し、スケジューラーが「一時停止」として扱います。
import { rt, LTable, LFunc, Coroutine, tostring, fmtNum, callSync, T } from './runtime.js'
import { fromBytes, toBytes } from './lexer.js'
import { loadChunk } from './compiler.js'
import * as runtime from './runtime.js'

const MAX_STR = 400

export class Debugger {
  // post(msg): 画面へ送る / output(kind, text): 出力へ
  constructor({ env, output, onPaused }) {
    this.env = env
    this.output = output
    this.onPausedCb = onPaused
    this.handles = new Map()   // chunk 名 → コンパイル済みコードが参照するハンドル
    this.bps = new Map()       // chunk 名 → Map(行 → { cond, log, hits })
    this.mode = null           // null | 'in' | 'over' | 'out' | 'pause'
    this.stepCo = null
    this.stepDepth = 0
    this.sig = null
    this.refs = new Map()      // 変数表示: 参照番号 → 値 (展開用)
    this.refSeed = 0
    this.watches = []
    this.evalEnv = null
    this.condCache = new Map()
    this.pausedInfo = null
  }

  // ---- コンパイル済みコードとのつなぎ ----
  handle(chunk) {
    let h = this.handles.get(chunk)
    if (h) return h
    const dbg = this
    h = {
      a: false,
      chunk,
      bp: this.bps.get(chunk) || new Map(),
      // 止まるかどうかの速い判定 (変数はまだ集めない)
      h(line) {
        if (rt.syncDepth > 0) return false
        if (rt.scheduler && rt.scheduler.paused) return true
        if (this.bp.has(line)) return true
        const m = dbg.mode
        if (!m) return false
        if (m === 'in' || m === 'pause') return true
        const co = rt.current
        if (co !== dbg.stepCo) return false
        const d = co && co.ds ? co.ds.length : 0
        return m === 'over' ? d <= dbg.stepDepth : d < dbg.stepDepth
      },
      // 条件付きブレークポイント・ログポイントを評価し、止まるなら dbg.sig を用意して true
      q(line, vars) { return dbg.decide(this, line, vars) },
      // 関数の入口・出口 (呼び出し履歴)
      e(name, getLine) {
        const co = rt.current
        if (!co) return null
        const fr = { name, chunk, line: getLine }
        ;(co.ds || (co.ds = [])).push(fr)
        return fr
      },
      x(fr) {
        const co = rt.current
        if (!fr || !co || !co.ds) return
        const i = co.ds.lastIndexOf(fr)
        if (i >= 0) co.ds.length = i
      },
      sig: null,
    }
    Object.defineProperty(h, 'sig', { get: () => dbg.sig })
    this.handles.set(chunk, h)
    this.refreshFlags()
    return h
  }

  refreshFlags() {
    for (const [chunk, h] of this.handles) {
      h.bp = this.bps.get(chunk) || new Map()
      h.a = !!this.mode || h.bp.size > 0 || !!(rt.scheduler && rt.scheduler.paused)
    }
  }

  // list: { chunk: [{ line, cond?, log? }] }
  setBreakpoints(list) {
    this.bps = new Map()
    for (const [chunk, arr] of Object.entries(list || {})) {
      const m = new Map()
      for (const b of arr) m.set(b.line, { cond: b.cond || '', log: b.log || '', hits: 0 })
      if (m.size) this.bps.set(chunk, m)
    }
    this.refreshFlags()
  }

  decide(handle, line, vars) {
    const sched = rt.scheduler
    // 別のスレッドが一時停止中: このスレッドも次の文で待たせる
    if (sched && sched.paused) { this.sig = { kind: 'dbg', follow: true }; return true }
    const bp = handle.bp.get(line)
    let reason = null
    if (bp) {
      bp.hits++
      if (bp.log) {
        // ログポイント: 止まらずに出力だけ ( {式} を値に置き換え )
        const text = bp.log.replace(/\{([^{}]+)\}/g, (_, ex) => { const r = this.evalIn(ex, vars); return r.ok ? r.values.map(v => fromBytes(tostring(v))).join(', ') : '<' + r.error + '>' })
        this.output('log', `${handle.chunk}:${line}: ${text}`)
      } else if (bp.cond) {
        const r = this.evalIn(bp.cond, vars)
        if (!r.ok) reason = { kind: 'condError', error: r.error }
        else if (T(r.values[0])) reason = { kind: 'breakpoint', cond: bp.cond }
      } else reason = { kind: 'breakpoint' }
    }
    if (!reason) {
      const m = this.mode
      if (m === 'pause') reason = { kind: 'pause' }
      else if (m === 'in' || m === 'over' || m === 'out') {
        const co = rt.current
        const d = co && co.ds ? co.ds.length : 0
        if (m === 'in' || (co === this.stepCo && (m === 'over' ? d <= this.stepDepth : d < this.stepDepth))) reason = { kind: 'step' }
      }
    }
    if (!reason) return false
    this.sig = { kind: 'dbg', chunk: handle.chunk, line, vars, reason }
    return true
  }

  // スケジューラーから: 一時停止した
  onPaused(co, sig) {
    this.mode = null
    this.stepCo = null
    this.refs = new Map()
    this.refSeed = 0
    this.refreshFlags()
    let locals = []
    try { locals = sig.vars ? sig.vars() : [] } catch { locals = [] }
    // 内側の変数が優先 (同じ名前の外側の変数は隠れている)
    const seenNames = new Set()
    locals = locals.filter(([n]) => !seenNames.has(n) && seenNames.add(n)).reverse() // 宣言した順に
    // 呼び出し履歴 (内側から)
    const stack = []
    const ds = co.ds || []
    for (let i = ds.length - 1; i >= 0 && stack.length < 40; i--) {
      const fr = ds[i]
      let line = 0
      try { line = fr.line() } catch { line = 0 }
      const name = i === 0 && co.isMain ? '(メイン)' : fr.name === 'anonymous' ? '(無名関数)' : fromBytes(String(fr.name))
      stack.push({ name, file: fr.chunk, line: i === ds.length - 1 ? sig.line : line })
    }
    if (!stack.length) stack.push({ name: '(メイン)', file: sig.chunk, line: sig.line })
    this.pausedInfo = { co, sig, locals }
    const info = {
      file: sig.chunk,
      line: sig.line,
      reason: sig.reason,
      locals: locals.filter(([n]) => n !== '...').map(([n, v]) => ({ name: n, value: this.ser(v) })),
      globals: this.userGlobals(),
      stack,
      watches: this.watches.map(w => this.watchValue(w)),
    }
    this.onPausedCb(info)
  }

  // 画面から: 続行・ステップ
  resume(action) {
    const sched = rt.scheduler
    const p = sched && sched.paused
    if (!p) return false
    const co = p.co
    const d = co && co.ds ? co.ds.length : 0
    this.mode = action === 'continue' ? null : action
    this.stepCo = co
    this.stepDepth = d
    this.pausedInfo = null
    this.refreshFlags()
    // 再開後は通常の判定へ戻す (refreshFlags は paused を見るので、continue の後に再計算)
    sched.continue()
    this.refreshFlags()
    return true
  }

  requestPause() {
    this.mode = 'pause'
    this.refreshFlags()
  }

  // ---- 値の表示 ----
  ref(v) {
    const id = ++this.refSeed
    this.refs.set(id, v)
    return id
  }

  ser(v) {
    switch (typeof v) {
      case 'undefined': return { t: 'nil', v: 'nil' }
      case 'boolean': return { t: 'boolean', v: String(v) }
      case 'number': return { t: 'number', v: fmtNum(v) }
      case 'string': {
        const s = fromBytes(v)
        return { t: 'string', v: JSON.stringify(s.length > MAX_STR ? s.slice(0, MAX_STR) + '…' : s) }
      }
    }
    if (v instanceof LTable) {
      let n = 0
      for (let k = v.next(undefined); k && n < 1000; k = v.next(k[0])) n++
      const len = v.length()
      const label = n === 0 ? '{}' : len && len === n ? `{…} 配列 ${len} 個` : `{…} ${n >= 1000 ? '1000+' : n} 個`
      return { t: 'table', v: label, ref: n ? this.ref(v) : 0 }
    }
    if (v instanceof LFunc) return { t: 'function', v: `function ${fromBytes(String(v.name || ''))}`.trim() }
    if (v instanceof Coroutine) return { t: 'thread', v: `thread (${v.status})` }
    if (Array.isArray(v)) return { t: 'table', v: `… ${v.length} 個`, ref: v.length ? this.ref(LTableFrom(v)) : 0 }
    let text
    try { text = fromBytes(tostring(v)) } catch { text = '(userdata)' }
    const kind = v && v.luaTypeName ? v.luaTypeName : v && v.ClassName ? 'Instance' : 'userdata'
    const canOpen = !!(v && (v.children || v.props))
    return { t: kind, v: v && v.ClassName ? `${text} (${v.ClassName})` : text, ref: canOpen ? this.ref(v) : 0 }
  }

  // 参照番号の中身 (テーブルの要素・Instance のプロパティと子)
  expand(id) {
    const v = this.refs.get(id)
    if (v === undefined) return []
    const out = []
    if (v instanceof LTable) {
      for (let k = v.next(undefined); k && out.length < 300; k = v.next(k[0])) {
        const key = typeof k[0] === 'string' ? (/^[A-Za-z_]\w*$/.test(fromBytes(k[0])) ? fromBytes(k[0]) : `[${JSON.stringify(fromBytes(k[0]))}]`) : `[${fromBytes(tostring(k[0]))}]`
        out.push({ name: key, value: this.ser(k[1]) })
      }
      const mt = v.mt
      if (mt) out.push({ name: '<metatable>', value: this.ser(mt) })
      return out
    }
    if (v && v.props) {
      for (const k of ['Name', 'ClassName', 'Parent']) {
        try { out.push({ name: k, value: this.ser(v.luaIndex(toBytes(k))) }) } catch {}
      }
      for (const [k, val] of v.props) if (k !== 'Name' && k !== 'Parent' && out.length < 80) out.push({ name: k, value: this.ser(val) })
      if (v.children && v.children.length) {
        for (const ch of v.children.slice(0, 100)) out.push({ name: fromBytes(String(ch.name)), value: this.ser(ch) })
      }
    }
    return out
  }

  // スクリプトが作ったグローバル変数 (最初からあるものを除く)
  markBuiltins() {
    this.builtins = new Set()
    for (let k = this.env.next(undefined); k; k = this.env.next(k[0])) this.builtins.add(k[0])
  }
  userGlobals() {
    const out = []
    if (!this.builtins) return out
    for (let k = this.env.next(undefined); k && out.length < 200; k = this.env.next(k[0])) {
      if (this.builtins.has(k[0]) || typeof k[0] !== 'string') continue
      out.push({ name: fromBytes(k[0]), value: this.ser(k[1]) })
    }
    return out
  }

  // ---- 式の評価 (ウォッチ・条件・コンソール) ----
  // vars: ローカル変数を返す関数 (なければグローバルだけ)
  evalIn(code, vars) {
    try {
      let env = this.evalEnv
      if (!env) {
        env = this.evalEnv = new LTable()
        const mt = new LTable()
        mt.set(toBytes('__index'), this.env)
        mt.set(toBytes('__newindex'), this.env)
        env.mt = mt
      }
      env.hash.clear(); env.arr = [undefined]
      const list = typeof vars === 'function' ? vars() : vars || []
      for (const [n, v] of list) if (n !== '...' && v !== undefined) env.set(toBytes(n), v)
      let f = this.condCache.get(code)
      if (!f) {
        const save = rt.debugger
        rt.debugger = null // 評価用のコードにはデバッグ用の文を入れない
        try {
          try { f = loadChunk('return ' + code, '=式', env, runtime) } catch { f = loadChunk(code, '=式', env, runtime) }
        } finally { rt.debugger = save }
        if (this.condCache.size > 200) this.condCache.clear()
        this.condCache.set(code, f)
      }
      const values = callSync(f, [])
      return { ok: true, values }
    } catch (e) {
      const msg = e && e.value !== undefined ? fromBytes(String(e.value)) : String(e && e.message || e)
      return { ok: false, error: msg.replace(/^=式:\d+: /, '') }
    }
  }

  // 一時停止中の場所で評価 (止まっていなければグローバルで)
  evaluate(code) {
    const p = this.pausedInfo
    const r = this.evalIn(code, p ? p.locals : null)
    if (!r.ok) return { ok: false, error: r.error }
    return { ok: true, values: r.values.map(v => this.ser(v)) }
  }

  watchValue(code) {
    const r = this.evaluate(code)
    return { code, ...(r.ok ? { value: r.values[0] || { t: 'nil', v: 'nil' } } : { error: r.error }) }
  }
}

// REPL・ウォッチ用の読みやすい表示 ( {1, 2, a = 3} など )
export function inspect(v, depth = 0, seen = new Set()) {
  if (typeof v === 'string') { const s = fromBytes(v); return depth ? JSON.stringify(s) : s }
  if (!(v instanceof LTable)) { try { return fromBytes(tostring(v)) } catch { return '(?)' } }
  if (seen.has(v)) return '{…循環}'
  if (depth >= 3) return '{…}'
  seen.add(v)
  const parts = []
  const len = v.length()
  for (let i = 1; i <= len && parts.length < 50; i++) parts.push(inspect(v.get(i), depth + 1, seen))
  let n = 0
  for (let k = v.next(undefined); k; k = v.next(k[0])) {
    if (typeof k[0] === 'number' && Number.isInteger(k[0]) && k[0] >= 1 && k[0] <= len) continue
    if (parts.length >= 50) { n++; continue }
    const key = typeof k[0] === 'string' && /^[A-Za-z_]\w*$/.test(k[0]) ? k[0] : `[${inspect(k[0], depth + 1, seen)}]`
    parts.push(`${key} = ${inspect(k[1], depth + 1, seen)}`)
  }
  seen.delete(v)
  if (n) parts.push(`… 他 ${n} 個`)
  return parts.length ? `{${parts.join(', ')}}` : '{}'
}

function LTableFrom(arr) {
  const t = new LTable()
  arr.forEach((v, i) => t.set(i + 1, v))
  return t
}

