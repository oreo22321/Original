// Luau 標準ライブラリ + スケジューラ (task ライブラリ)
import {
  LTable, LFunc, LuaError, Coroutine, rt, native, nativeGen, call, callSync, tostring, fmtNum, str2num,
  type, typeOf, EMPTY, rtError, index, setindex, eq, lt, len, iterMarks, errValue, getMetatable, addressOf, T,
} from './runtime.js'
import { makeStringLib, checkStr, checkNum, optNum, checkInt, optInt, checkTable, argError, posrelat } from './lstrings.js'
import { loadChunk } from './compiler.js'
import { fromBytes, toBytes, utf8Encode, LuauSyntaxError } from './lexer.js'
import * as runtime from './runtime.js'

// ============================================================
// スケジューラ
// ============================================================
export class Scheduler {
  constructor(hooks) {
    this.hooks = hooks
    this.pending = 0
    this.deferred = []
    this.t0 = performance.now()
    this.timers = new Set()
    this.idleCallbacks = []
    this.frameSignals = new Set()
    this.frameTimer = null
    this.stopped = false
    this.running = 0
    this.paused = null      // デバッガーで一時停止中: { co, sig }
    this.held = []          // 一時停止中に動こうとしたスレッド (再開後に実行)
  }
  now() { return (performance.now() - this.t0) / 1000 }

  // コルーチンを再開。戻り値は coroutine.resume と同じ [ok, ...values]
  resume(co, args) {
    if (co.status === 'dead') return [false, 'cannot resume dead coroutine']
    if (co.status !== 'suspended') return [false, `cannot resume ${co.status === 'running' ? 'non-suspended' : co.status} coroutine`]
    const prev = rt.current
    if (prev) prev.status = 'normal'
    co.status = 'running'
    rt.current = co
    let r
    try {
      if (!co.gen) { co.gen = call(co.fn, args); r = co.gen.next() }
      else r = co.gen.next(args)
    } catch (e) {
      co.status = 'dead'
      if (e && e.halt) throw e
      return [false, errValue(e), e]
    } finally {
      rt.current = prev
      if (prev) prev.status = 'running'
    }
    if (r.done) { co.status = 'dead'; return [true, ...r.value] }
    co.status = 'suspended'
    const sig = r.value
    // デバッガーの一時停止は、呼び出し元へそのまま伝える
    if (sig && sig.kind === 'dbg') { const out = [true]; out.dbg = sig; return out }
    if (sig && sig.kind === 'park') {
      this.park(co, sig.setup, sig.counts !== false)
      return [true]
    }
    return [true, ...(sig && sig.values ? sig.values : EMPTY)]
  }

  // 新しいスレッドで実行 (エラーは出力へ)
  run(co, args) {
    if (this.stopped) return
    if (this.paused) { this.held.push([co, args]); return }
    const top = rt.current === null
    if (top) rt.sliceStart = Date.now()
    this.running++
    let r
    try {
      r = this.resume(co, args || EMPTY)
    } finally {
      this.running--
    }
    if (r.dbg) {
      if (r.dbg.follow || this.paused) this.held.push([co, EMPTY])
      else {
        this.paused = { co, sig: r.dbg }
        if (rt.debugger) rt.debugger.onPaused(co, r.dbg)
      }
      return
    }
    if (r[0] === false) this.hooks.onError(r[2] || new LuaError(r[1], 0), co)
    if (top) {
      this.flushDeferred()
      this.checkIdle()
    }
  }

  // デバッガー: 一時停止から再開
  continue() {
    const p = this.paused
    if (!p || this.stopped) return
    this.paused = null
    this.run(p.co, EMPTY)
    // 止まっている間に待たせていたスレッドを順に動かす (途中でまた止まったら残りは次の再開で)
    while (this.held.length && !this.paused && !this.stopped) {
      const [co, args] = this.held.shift()
      if (co.status === 'suspended' && !co.cancelled) this.run(co, args)
    }
    if (!this.paused) { this.flushDeferred(); this.checkIdle() }
  }

  spawn(f, args) {
    const co = f instanceof Coroutine ? f : new Coroutine(f)
    this.run(co, args)
    return co
  }

  defer(co, args) {
    this.deferred.push([co, args])
    if (rt.current === null && this.running === 0) {
      const id = setTimeout(() => { this.timers.delete(id); this.flushDeferred(); this.checkIdle() }, 0)
      this.timers.add(id)
    }
  }

  flushDeferred() {
    let guard = 0
    while (this.deferred.length && !this.stopped) {
      const [co, args] = this.deferred.shift()
      if (co.status === 'suspended' && !co.cancelled) {
        rt.sliceStart = Date.now()
        this.run(co, args)
      }
      if (++guard > 100000) break
    }
  }

  park(co, setup, counts) {
    if (counts) this.pending++
    let woken = false
    co.wake = null
    const wake = args => {
      if (woken) return
      woken = true
      if (counts) this.pending--
      co.wake = null
      if (this.stopped || co.status !== 'suspended' || co.cancelled) { this.checkIdle(); return }
      if (rt.current === null) this.run(co, args || EMPTY)
      else this.defer(co, args || EMPTY)
    }
    co.wake = wake
    co.unpark = () => { if (!woken) { woken = true; if (counts) this.pending-- } }
    setup(wake)
  }

  setTimer(sec, fn) {
    const id = setTimeout(() => { this.timers.delete(id); fn() }, Math.max(0, sec * 1000))
    this.timers.add(id)
    return id
  }

  // RunService の Heartbeat などフレーム毎のイベント
  addFrameSignal(sig) {
    this.frameSignals.add(sig)
    if (!this.frameTimer) {
      let last = performance.now()
      this.frameTimer = setInterval(() => {
        const now = performance.now()
        const dt = (now - last) / 1000
        last = now
        if (this.paused) { last = now; return }
        for (const s of [...this.frameSignals]) {
          if (!s.hasConnections()) { this.frameSignals.delete(s); continue }
          s.fireFrame(dt)
        }
        if (!this.frameSignals.size) { clearInterval(this.frameTimer); this.frameTimer = null; this.checkIdle() }
      }, 1000 / 60)
    }
  }

  isIdle() {
    return this.pending === 0 && this.deferred.length === 0 && !this.frameTimer && this.running === 0 && !this.paused && !this.held.length
  }

  checkIdle() {
    if (this.stopped) return
    if (this.isIdle()) {
      // 少し待ってから終了判定 (直後にイベントが来る場合)
      setTimeout(() => { if (this.isIdle() && !this.stopped) this.hooks.onIdle() }, 30)
    }
  }

  stop() {
    this.stopped = true
    for (const id of this.timers) clearTimeout(id)
    this.timers.clear()
    if (this.frameTimer) clearInterval(this.frameTimer)
  }
}

// 待機用の yield シグナル
export function waitSignal(sched, sec) {
  return { kind: 'park', setup: wake => sched.setTimer(sec, () => wake()) }
}
export function awaitSignal(promise) {
  return { kind: 'park', setup: wake => promise.then(v => wake(Array.isArray(v) ? v : [v]), e => wake([undefined, String(e && e.message || e)])) }
}

// ============================================================
// 標準ライブラリ
// ============================================================
export function createStdlib(env, hooks, sched) {
  const G = env
  const def = (t, name, fn) => t.set(name, native(name, fn))
  const defg = (t, name, fn) => t.set(name, nativeGen(name, fn))
  const out = (kind, A) => hooks.output(kind, A.map(v => fromBytes(tostring(v))).join(hooks.printSep ?? ' '))

  // ---- 文字列 ----
  const stringLib = makeStringLib()
  rt.stringMeta = stringLib
  const smt = new LTable()
  smt.set('__index', stringLib)
  rt.stringMetaTable = smt

  // ---- 基本関数 ----
  def(G, 'print', A => { out('print', A); return EMPTY })
  def(G, 'warn', A => { out('warn', A); return EMPTY })
  def(G, 'error', A => {
    const level = A[1] === undefined ? 1 : checkInt(A, 1, 'error')
    throw new LuaError(A[0], typeof A[0] === 'string' ? level : 0)
  })
  def(G, 'assert', A => {
    if (A.length === 0) throw argError(1, 'assert', 'value expected')
    if (T(A[0])) return A
    const msg = A.length > 1 ? A[1] : 'assertion failed!'
    throw new LuaError(msg, typeof msg === 'string' ? 1 : 0)
  })
  defg(G, 'pcall', function* (A) {
    if (A.length === 0) throw argError(1, 'pcall', 'value expected')
    try {
      const r = yield* call(A[0], A.slice(1))
      return [true, ...r]
    } catch (e) {
      if (e && e.halt) throw e
      return [false, errValue(e)]
    }
  })
  defg(G, 'xpcall', function* (A) {
    try {
      const r = yield* call(A[0], A.slice(2))
      return [true, ...r]
    } catch (e) {
      if (e && e.halt) throw e
      rt.lastTraceback = e && e.traceback
      try {
        const h = yield* call(A[1], [errValue(e)])
        return [false, ...h]
      } finally {
        rt.lastTraceback = null
      }
    }
  })
  def(G, 'select', A => {
    const n = A[0]
    if (n === '#') return A.length - 1
    let i = checkInt(A, 0, 'select')
    if (i < 0) i = A.length - 1 + i + 1
    else if (i === 0) throw argError(1, 'select', 'index out of range')
    if (i < 1) throw argError(1, 'select', 'index out of range')
    return A.slice(i)
  })
  def(G, 'type', A => {
    if (A.length === 0) throw argError(1, 'type', 'value expected')
    return type(A[0])
  })
  def(G, 'typeof', A => {
    if (A.length === 0) throw argError(1, 'typeof', 'value expected')
    return typeOf(A[0])
  })
  def(G, 'tostring', A => {
    if (A.length === 0) throw argError(1, 'tostring', 'value expected')
    return tostring(A[0])
  })
  def(G, 'tonumber', A => {
    const v = A[0]
    if (A[1] === undefined) {
      if (typeof v === 'number') return v
      if (typeof v === 'string') return [str2num(v)]
      return [undefined]
    }
    const base = checkInt(A, 1, 'tonumber')
    if (base < 2 || base > 36) throw argError(2, 'tonumber', 'base out of range')
    const r = str2num(checkStr(A, 0, 'tonumber'), base)
    return [r]
  })
  const nextFn = native('next', A => {
    const t = checkTable(A, 0, 'next')
    const r = t.next(A[1])
    return r === null ? [undefined] : r
  })
  iterMarks.next = nextFn
  G.set('next', nextFn)
  def(G, 'pairs', A => {
    const t = A[0]
    if (!(t instanceof LTable)) {
      if (t && t.luaIterate) return [t]
      throw argError(1, 'pairs', `table expected, got ${A.length ? type(t) : 'no value'}`)
    }
    return [nextFn, t, undefined]
  })
  const ipairsIter = native('ipairs_iter', A => {
    const i = A[1] + 1
    const v = index(A[0], i)
    return v === undefined ? [undefined] : [i, v]
  })
  iterMarks.ipairsIter = ipairsIter
  def(G, 'ipairs', A => {
    if (!(A[0] instanceof LTable)) throw argError(1, 'ipairs', `table expected, got ${A.length ? type(A[0]) : 'no value'}`)
    return [ipairsIter, A[0], 0]
  })
  def(G, 'rawget', A => checkTable(A, 0, 'rawget').get(A[1]))
  def(G, 'rawset', A => {
    const t = checkTable(A, 0, 'rawset')
    if (t.readonly) throw rtError('attempt to modify a readonly table')
    t.set(A[1], A[2])
    return t
  })
  def(G, 'rawequal', A => A[0] === A[1])
  def(G, 'rawlen', A => {
    if (typeof A[0] === 'string') return A[0].length
    return checkTable(A, 0, 'rawlen').length()
  })
  def(G, 'setmetatable', A => {
    const t = checkTable(A, 0, 'setmetatable')
    const mt = A[1]
    if (mt !== undefined && !(mt instanceof LTable)) throw argError(2, 'setmetatable', 'nil or table expected')
    if (t.mt && t.mt.get('__metatable') !== undefined) throw rtError('cannot change a protected metatable')
    if (t.readonly) throw rtError('attempt to modify a readonly table')
    t.mt = mt || null
    return t
  })
  def(G, 'getmetatable', A => {
    const mt = getMetatable(A[0])
    if (!mt) return [undefined]
    const p = mt.get('__metatable')
    return p !== undefined ? p : mt
  })
  const unpack = A => {
    const t = A[0]
    const i = optInt(A, 1, 'unpack', 1)
    const j = A[2] === undefined ? len(t) : checkInt(A, 2, 'unpack')
    if (j - i >= 8000) throw rtError('too many results to unpack')
    const outv = []
    for (let k = i; k <= j; k++) outv.push(t instanceof LTable ? t.get(k) : index(t, k))
    return outv
  }
  def(G, 'unpack', unpack)

  // ---- loadstring / require ----
  const compile = (src, chunk) => {
    try {
      return [loadChunk(src, chunk, env, runtime)]
    } catch (e) {
      if (e instanceof LuauSyntaxError) return [undefined, `${chunk}:${e.line}: ${toBytes(e.message)}`]
      throw e
    }
  }
  def(G, 'loadstring', A => {
    const src = checkStr(A, 0, 'loadstring')
    const chunk = A[1] === undefined ? '[string "' + fromBytes(src).split('\n')[0].slice(0, 40) + '"]' : fromBytes(checkStr(A, 1, 'loadstring')).replace(/^[=@]/, '')
    return compile(fromBytes(src), chunk)
  })
  def(G, 'load', A => {
    let src = A[0]
    if (src instanceof LFunc) {
      let s = ''
      for (;;) {
        const piece = callSync(src, [])[0]
        if (piece === undefined || piece === '') break
        s += piece
      }
      src = s
    }
    if (typeof src !== 'string') throw argError(1, 'load', 'string expected')
    const chunk = A[1] === undefined ? '=(load)' : fromBytes(A[1])
    return compile(fromBytes(src), chunk.replace(/^[=@]/, ''))
  })

  // ---- 時間 ----
  def(G, 'tick', () => Date.now() / 1000)
  def(G, 'time', () => sched.now())
  def(G, 'elapsedTime', () => sched.now())
  def(G, 'gcinfo', () => Math.round(estimateMemory() / 1024))
  def(G, 'collectgarbage', A => {
    const opt = A[0] === undefined ? 'collect' : A[0]
    if (opt === 'count') return estimateMemory() / 1024
    if (opt === 'collect' || opt === 'step') return 0
    throw argError(1, 'collectgarbage', `invalid option '${fromBytes(String(opt))}'`)
  })
  def(G, 'newproxy', A => {
    const u = { luaIndex: () => { throw rtError('attempt to index userdata') }, mt: null }
    u.luaNewIndex = () => { throw rtError('attempt to index userdata') }
    u.luaIndex = k => {
      if (u.mt) {
        const h = u.mt.get('__index')
        if (h instanceof LFunc) return callSync(h, [u, k])[0]
        if (h instanceof LTable) return index(h, k)
      }
      throw rtError(`attempt to index userdata with '${fromBytes(String(k))}'`)
    }
    u.luaNewIndex = (k, v) => {
      if (u.mt) {
        const h = u.mt.get('__newindex')
        if (h instanceof LFunc) { callSync(h, [u, k, v]); return }
        if (h instanceof LTable) { setindex(h, k, v); return }
      }
      throw rtError('attempt to index userdata')
    }
    u.luaTypeName = 'userdata'
    if (T(A[0])) u.mt = new LTable()
    return u
  })
  def(G, 'getfenv', () => env)
  def(G, 'setfenv', A => A[0])
  G.set('_G', G)
  G.set('_VERSION', 'Luau')

  // ---- coroutine ----
  const co = new LTable()
  def(co, 'create', A => {
    if (!(A[0] instanceof LFunc)) throw argError(1, 'create', 'function expected')
    return new Coroutine(A[0])
  })
  const checkCo = (A, fname) => {
    if (!(A[0] instanceof Coroutine)) throw argError(1, fname, `thread expected, got ${A.length ? type(A[0]) : 'no value'}`)
    return A[0]
  }
  defg(co, 'resume', function* (A) {
    const c = checkCo(A, 'resume')
    let r = sched.resume(c, A.slice(1))
    // 中のコルーチンがデバッガーで止まった → 外側も一緒に止まり、再開したら中を続ける
    while (r.dbg) { yield r.dbg; r = sched.resume(c, EMPTY) }
    return r[0] === false ? [false, r[1]] : r
  })
  defg(co, 'yield', function* (A) {
    if (!rt.current) throw rtError('attempt to yield from outside a coroutine')
    const r = yield { kind: 'yield', values: A }
    return r || EMPTY
  })
  def(co, 'status', A => checkCo(A, 'status').status)
  def(co, 'running', () => rt.current ? [rt.current, rt.current.isMain === true] : [undefined, true])
  def(co, 'isyieldable', () => !!rt.current)
  def(co, 'wrap', A => {
    if (!(A[0] instanceof LFunc)) throw argError(1, 'wrap', 'function expected')
    const c = new Coroutine(A[0])
    return nativeGen('wrap', function* (B) {
      let r = sched.resume(c, B)
      while (r.dbg) { yield r.dbg; r = sched.resume(c, EMPTY) }
      if (r[0] === false) {
        const e = r[2] instanceof LuaError ? r[2] : new LuaError(r[1], 0)
        e.positioned = true
        throw e
      }
      return r.slice(1)
    })
  })
  def(co, 'close', A => {
    const c = checkCo(A, 'close')
    if (c.status === 'running' || c.status === 'normal') throw rtError(`cannot close a ${c.status} coroutine`)
    c.status = 'dead'
    if (c.unpark) c.unpark()
    return true
  })
  G.set('coroutine', co)

  // ---- task ----
  const task = new LTable()
  const toThread = (f, fname) => {
    if (f instanceof Coroutine) return f
    if (f instanceof LFunc) return new Coroutine(f)
    throw argError(1, fname, 'function or thread expected')
  }
  defg(task, 'wait', function* (A) {
    const t = Math.max(optNum(A, 0, 'wait', 0), 0)
    const start = sched.now()
    yield waitSignal(sched, Math.max(t, 1 / 240))
    return sched.now() - start
  })
  def(task, 'spawn', A => {
    const th = toThread(A[0], 'spawn')
    sched.spawn(th, A.slice(1))
    return th
  })
  def(task, 'defer', A => {
    const th = toThread(A[0], 'defer')
    sched.defer(th, A.slice(1))
    return th
  })
  def(task, 'delay', A => {
    const t = Math.max(optNum(A, 0, 'delay', 0), 0)
    const th = toThread(A[1], 'delay')
    const args = A.slice(2)
    sched.pending++
    sched.setTimer(t, () => {
      sched.pending--
      if (th.status === 'suspended' && !th.cancelled) sched.run(th, args)
      else sched.checkIdle()
    })
    return th
  })
  def(task, 'cancel', A => {
    const th = A[0]
    if (!(th instanceof Coroutine)) throw argError(1, 'cancel', 'thread expected')
    th.cancelled = true
    if (th.unpark) th.unpark()
    if (th.status === 'suspended') th.status = 'dead'
  })
  def(task, 'synchronize', () => {})
  def(task, 'desynchronize', () => {})
  G.set('task', task)
  // 旧 API (非推奨)
  defg(G, 'wait', function* (A) {
    const t = Math.max(optNum(A, 0, 'wait', 0.03), 0.03)
    const start = sched.now()
    yield waitSignal(sched, t)
    return [sched.now() - start, sched.now()]
  })
  def(G, 'spawn', A => { sched.defer(toThread(A[0], 'spawn'), EMPTY) })
  def(G, 'delay', A => {
    const t = optNum(A, 0, 'delay', 0)
    const th = toThread(A[1], 'delay')
    sched.pending++
    sched.setTimer(t, () => { sched.pending--; sched.run(th, [t, sched.now()]) })
  })

  // ---- table ----
  const tableLib = new LTable()
  const checkWritable = (t) => { if (t.readonly) throw rtError('attempt to modify a readonly table') }
  def(tableLib, 'insert', A => {
    const t = checkTable(A, 0, 'insert')
    checkWritable(t)
    const n = t.length()
    if (A.length === 2) { t.set(n + 1, A[1]); return }
    if (A.length !== 3) throw rtError("wrong number of arguments to 'insert'")
    const pos = checkInt(A, 1, 'insert')
    if (pos < 1 || pos > n + 1) throw argError(2, 'insert', 'position out of bounds')
    if (pos === n + 1) { t.set(pos, A[2]); return }
    // 配列部の高速パス
    if (t.arr.length === n + 1) { t.arr.splice(pos, 0, A[2]); if (A[2] === undefined) { /* 穴 */ } return }
    for (let i = n; i >= pos; i--) t.set(i + 1, t.get(i))
    t.set(pos, A[2])
  })
  def(tableLib, 'remove', A => {
    const t = checkTable(A, 0, 'remove')
    checkWritable(t)
    const n = t.length()
    let pos = A[1] === undefined ? n : checkInt(A, 1, 'remove')
    if (A[1] !== undefined && n + 1 === pos) { const v = t.get(pos); t.set(pos, undefined); return [v] }
    if (n === 0 && A[1] === undefined) return [undefined]
    if (n === 0 && (pos === 0 || pos === n)) return [t.get(pos)]
    if (pos < 1 || pos > n + 1) throw argError(2, 'remove', 'position out of bounds')
    const v = t.get(pos)
    if (t.arr.length === n + 1 && pos <= n) {
      t.arr.splice(pos, 1)
      let m = t.arr.length - 1
      while (m > 0 && t.arr[m] === undefined) m--
      t.arr.length = m + 1
      return [v]
    }
    for (let i = pos; i < n; i++) t.set(i, t.get(i + 1))
    t.set(n, undefined)
    return [v]
  })
  def(tableLib, 'concat', A => {
    const t = checkTable(A, 0, 'concat')
    const sep = A[1] === undefined ? '' : checkStr(A, 1, 'concat')
    const i = optInt(A, 2, 'concat', 1)
    const j = A[3] === undefined ? t.length() : checkInt(A, 3, 'concat')
    const parts = []
    for (let k = i; k <= j; k++) {
      const v = t.get(k)
      if (typeof v === 'string') parts.push(v)
      else if (typeof v === 'number') parts.push(fmtNum(v))
      else throw rtError(`invalid value (at index ${k}) in table for 'concat'`)
    }
    return parts.join(sep)
  })
  defg(tableLib, 'sort', function* (A) {
    const t = checkTable(A, 0, 'sort')
    checkWritable(t)
    const cmp = A[1]
    if (cmp !== undefined && !(cmp instanceof LFunc)) throw argError(2, 'sort', 'function expected')
    const n = t.length()
    const items = []
    for (let i = 1; i <= n; i++) items.push(t.get(i))
    const less = cmp
      ? function* (a, b) { const r = yield* call(cmp, [a, b]); return T(r[0]) }
      : function* (a, b) { return lt(a, b) }
    // マージソート (比較関数が yield しても良いように generator で実装)
    const buf = new Array(n)
    function* sort(lo, hi) {
      if (hi - lo < 2) return
      if (hi - lo <= 12) {
        for (let i = lo + 1; i < hi; i++) {
          const x = items[i]
          let j = i - 1
          while (j >= lo && (yield* less(x, items[j]))) { items[j + 1] = items[j]; j-- }
          items[j + 1] = x
        }
        return
      }
      const mid = (lo + hi) >> 1
      yield* sort(lo, mid)
      yield* sort(mid, hi)
      let i = lo, j = mid, k = lo
      while (i < mid && j < hi) {
        if (yield* less(items[j], items[i])) buf[k++] = items[j++]
        else buf[k++] = items[i++]
      }
      while (i < mid) buf[k++] = items[i++]
      while (j < hi) buf[k++] = items[j++]
      for (let x = lo; x < hi; x++) items[x] = buf[x]
    }
    yield* sort(0, n)
    for (let i = 0; i < n; i++) t.set(i + 1, items[i])
    return EMPTY
  })
  def(tableLib, 'unpack', unpack)
  def(tableLib, 'pack', A => {
    const t = LTable.fromArray(A)
    t.set('n', A.length)
    return t
  })
  def(tableLib, 'find', A => {
    const t = checkTable(A, 0, 'find')
    const init = optInt(A, 2, 'find', 1)
    if (init < 1) throw argError(3, 'find', 'index out of range')
    for (let i = init; ; i++) {
      const v = t.get(i)
      if (v === undefined) return [undefined]
      if (v === A[1]) return i
    }
  })
  def(tableLib, 'clear', A => {
    const t = checkTable(A, 0, 'clear')
    checkWritable(t)
    t.arr = [undefined]
    t.hash.clear()
  })
  def(tableLib, 'create', A => {
    const n = checkInt(A, 0, 'create')
    if (n < 0) throw argError(1, 'create', 'size out of range')
    const t = new LTable()
    if (A[1] !== undefined) t.arr = [undefined, ...new Array(n).fill(A[1])]
    return t
  })
  def(tableLib, 'freeze', A => { const t = checkTable(A, 0, 'freeze'); t.readonly = true; return t })
  def(tableLib, 'isfrozen', A => checkTable(A, 0, 'isfrozen').readonly)
  def(tableLib, 'clone', A => {
    const t = checkTable(A, 0, 'clone')
    const c = new LTable()
    c.arr = t.arr.slice()
    c.hash = new Map(t.hash)
    c.mt = t.mt
    return c
  })
  def(tableLib, 'move', A => {
    const a1 = checkTable(A, 0, 'move')
    const f = checkInt(A, 1, 'move'), e = checkInt(A, 2, 'move'), tpos = checkInt(A, 3, 'move')
    const a2 = A[4] === undefined ? a1 : checkTable(A, 4, 'move')
    if (e >= f) {
      if (tpos > e || tpos <= f || a1 !== a2) for (let i = 0; i <= e - f; i++) a2.set(tpos + i, a1.get(f + i))
      else for (let i = e - f; i >= 0; i--) a2.set(tpos + i, a1.get(f + i))
    }
    return a2
  })
  def(tableLib, 'maxn', A => {
    const t = checkTable(A, 0, 'maxn')
    let m = t.length()
    for (const k of t.hash.keys()) if (typeof k === 'number' && k > m) m = k
    return m
  })
  def(tableLib, 'getn', A => checkTable(A, 0, 'getn').length())
  defg(tableLib, 'foreach', function* (A) {
    const t = checkTable(A, 0, 'foreach')
    let k
    for (;;) {
      const r = t.next(k)
      if (!r) return EMPTY
      k = r[0]
      const v = yield* call(A[1], r)
      if (v[0] !== undefined) return [v[0]]
    }
  })
  defg(tableLib, 'foreachi', function* (A) {
    const t = checkTable(A, 0, 'foreachi')
    const n = t.length()
    for (let i = 1; i <= n; i++) {
      const v = yield* call(A[1], [i, t.get(i)])
      if (v[0] !== undefined) return [v[0]]
    }
    return EMPTY
  })
  G.set('table', tableLib)
  G.set('string', stringLib)

  // ---- math ----
  const M = new LTable()
  const m1 = (name, f) => def(M, name, A => f(checkNum(A, 0, name)))
  m1('abs', Math.abs); m1('ceil', Math.ceil); m1('floor', Math.floor); m1('sqrt', Math.sqrt)
  m1('sin', Math.sin); m1('cos', Math.cos); m1('tan', Math.tan); m1('asin', Math.asin); m1('acos', Math.acos)
  m1('sinh', Math.sinh); m1('cosh', Math.cosh); m1('tanh', Math.tanh); m1('exp', Math.exp); m1('log10', Math.log10)
  m1('deg', x => x * 180 / Math.PI); m1('rad', x => x * Math.PI / 180)
  m1('sign', x => x > 0 ? 1 : x < 0 ? -1 : 0)
  m1('round', x => x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5))
  m1('isnan', x => x !== x); m1('isinf', x => x === Infinity || x === -Infinity); m1('isfinite', x => isFinite(x))
  def(M, 'atan', A => A[1] === undefined ? Math.atan(checkNum(A, 0, 'atan')) : Math.atan2(checkNum(A, 0, 'atan'), checkNum(A, 1, 'atan')))
  def(M, 'atan2', A => Math.atan2(checkNum(A, 0, 'atan2'), checkNum(A, 1, 'atan2')))
  def(M, 'log', A => {
    const x = checkNum(A, 0, 'log')
    if (A[1] === undefined) return Math.log(x)
    const b = checkNum(A, 1, 'log')
    if (b === 2) return Math.log2(x)
    if (b === 10) return Math.log10(x)
    return Math.log(x) / Math.log(b)
  })
  def(M, 'pow', A => Math.pow(checkNum(A, 0, 'pow'), checkNum(A, 1, 'pow')))
  def(M, 'fmod', A => {
    const a = checkNum(A, 0, 'fmod'), b = checkNum(A, 1, 'fmod')
    return a % b
  })
  def(M, 'modf', A => {
    const x = checkNum(A, 0, 'modf')
    const ip = x >= 0 ? Math.floor(x) : Math.ceil(x)
    return [ip, isFinite(x) ? x - ip : 0]
  })
  def(M, 'frexp', A => {
    let x = checkNum(A, 0, 'frexp')
    if (x === 0 || !isFinite(x)) return [x, 0]
    let e = Math.max(-1023, Math.floor(Math.log2(Math.abs(x))) + 1)
    let m = x * Math.pow(2, -e)
    while (Math.abs(m) < 0.5) { m *= 2; e-- }
    while (Math.abs(m) >= 1) { m /= 2; e++ }
    return [m, e]
  })
  def(M, 'ldexp', A => checkNum(A, 0, 'ldexp') * Math.pow(2, checkInt(A, 1, 'ldexp')))
  def(M, 'max', A => {
    let m = checkNum(A, 0, 'max')
    for (let i = 1; i < A.length; i++) { const v = checkNum(A, i, 'max'); if (v > m || m !== m) m = v }
    return m
  })
  def(M, 'min', A => {
    let m = checkNum(A, 0, 'min')
    for (let i = 1; i < A.length; i++) { const v = checkNum(A, i, 'min'); if (v < m || m !== m) m = v }
    return m
  })
  def(M, 'clamp', A => {
    const x = checkNum(A, 0, 'clamp'), lo = checkNum(A, 1, 'clamp'), hi = checkNum(A, 2, 'clamp')
    if (lo > hi) throw argError(3, 'clamp', 'max must be greater than or equal to min')
    return x < lo ? lo : x > hi ? hi : x
  })
  def(M, 'lerp', A => {
    const a = checkNum(A, 0, 'lerp'), b = checkNum(A, 1, 'lerp'), t = checkNum(A, 2, 'lerp')
    return t === 1 ? b : a + (b - a) * t
  })
  def(M, 'map', A => {
    const x = checkNum(A, 0, 'map'), i0 = checkNum(A, 1, 'map'), i1 = checkNum(A, 2, 'map')
    const o0 = checkNum(A, 3, 'map'), o1 = checkNum(A, 4, 'map')
    return o0 + (x - i0) * (o1 - o0) / (i1 - i0)
  })
  M.set('huge', Infinity)
  M.set('pi', Math.PI)
  // 乱数 (xorshift128+ 風)
  let seed = [0x9e3779b9 ^ Date.now(), 0x243f6a88, 0x85a308d3, 0x13198a2e]
  const rnd = () => {
    let [a, b, c, d] = seed
    const t = b << 9
    let r = a * 5; r = ((r << 7) | (r >>> 25)) * 9
    c ^= a; d ^= b; b ^= c; a ^= d; c ^= t; d = (d << 11) | (d >>> 21)
    seed = [a, b, c, d]
    return (r >>> 0) / 4294967296
  }
  def(M, 'random', A => {
    if (A.length === 0) return rnd()
    let lo = 1, hi
    if (A.length === 1) hi = checkInt(A, 0, 'random')
    else { lo = checkInt(A, 0, 'random'); hi = checkInt(A, 1, 'random') }
    if (lo > hi) throw argError(A.length === 1 ? 1 : 2, 'random', 'interval is empty')
    return lo + Math.floor(rnd() * (hi - lo + 1))
  })
  def(M, 'randomseed', A => {
    const s = Math.trunc(optNum(A, 0, 'randomseed', 0))
    seed = [s ^ 0x9e3779b9, (s * 16807) | 0, 0x85a308d3 ^ s, 0x13198a2e]
    for (let i = 0; i < 16; i++) rnd()
  })
  def(M, 'noise', A => perlin(optNum(A, 0, 'noise', 0), optNum(A, 1, 'noise', 0), optNum(A, 2, 'noise', 0)))
  G.set('math', M)

  // ---- os ----
  const os = new LTable()
  def(os, 'time', A => {
    if (A[0] instanceof LTable) {
      const t = A[0]
      const get = (k, d) => { const v = t.get(k); if (v === undefined) { if (d === undefined) throw rtError(`field '${k}' missing in date table`); return d } return v }
      const d = new Date(get('year'), get('month') - 1, get('day'), get('hour', 12), get('min', 0), get('sec', 0))
      return Math.floor(d.getTime() / 1000)
    }
    return Math.floor(Date.now() / 1000)
  })
  def(os, 'clock', () => sched.now())
  def(os, 'difftime', A => checkNum(A, 0, 'difftime') - optNum(A, 1, 'difftime', 0))
  def(os, 'date', A => {
    let fmt = A[0] === undefined ? '%c' : checkStr(A, 0, 'date')
    const time = A[1] === undefined ? Date.now() / 1000 : checkNum(A, 1, 'date')
    let utc = false
    if (fmt[0] === '!') { utc = true; fmt = fmt.slice(1) }
    const d = new Date(time * 1000)
    const g = utc
      ? { Y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), H: d.getUTCHours(), M: d.getUTCMinutes(), S: d.getUTCSeconds(), w: d.getUTCDay() }
      : { Y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), H: d.getHours(), M: d.getMinutes(), S: d.getSeconds(), w: d.getDay() }
    const start = utc ? Date.UTC(g.Y, 0, 1) : new Date(g.Y, 0, 1).getTime()
    const yday = Math.floor((d.getTime() - start) / 86400000) + 1
    if (fmt.startsWith('*t')) {
      return LTable.fromObject({ year: g.Y, month: g.m + 1, day: g.d, hour: g.H, min: g.M, sec: g.S, wday: g.w + 1, yday, isdst: false })
    }
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    const p2 = n => String(n).padStart(2, '0')
    const conv = {
      a: () => DAYS[g.w].slice(0, 3), A: () => DAYS[g.w], b: () => MONTHS[g.m].slice(0, 3), B: () => MONTHS[g.m],
      c: () => `${DAYS[g.w].slice(0, 3)} ${MONTHS[g.m].slice(0, 3)} ${p2(g.d)} ${p2(g.H)}:${p2(g.M)}:${p2(g.S)} ${g.Y}`,
      d: () => p2(g.d), H: () => p2(g.H), I: () => p2(((g.H + 11) % 12) + 1), j: () => String(yday).padStart(3, '0'),
      m: () => p2(g.m + 1), M: () => p2(g.M), p: () => g.H < 12 ? 'AM' : 'PM', S: () => p2(g.S), w: () => String(g.w),
      x: () => `${p2(g.m + 1)}/${p2(g.d)}/${p2(g.Y % 100)}`, X: () => `${p2(g.H)}:${p2(g.M)}:${p2(g.S)}`,
      y: () => p2(g.Y % 100), Y: () => String(g.Y), '%': () => '%',
    }
    return fmt.replace(/%(.)/g, (m, c) => {
      if (!conv[c]) throw argError(1, 'date', `invalid conversion specifier '%${c}'`)
      return conv[c]()
    })
  })
  def(os, 'getenv', () => [undefined])
  G.set('os', os)

  // ---- utf8 ----
  const utf8 = new LTable()
  utf8.set('charpattern', '[\x00-\x7F\xC2-\xFD][\x80-\xBF]*')
  def(utf8, 'char', A => A.map((_, i) => utf8Encode(checkInt(A, i, 'char'))).join(''))
  const decodeAt = (s, i) => {
    const c = s.charCodeAt(i)
    if (c < 0x80) return [c, 1]
    let n, cp
    if (c >= 0xf0 && c < 0xf8) { n = 4; cp = c & 7 } else if (c >= 0xe0) { n = 3; cp = c & 15 } else if (c >= 0xc0) { n = 2; cp = c & 31 } else return null
    if (i + n > s.length) return null
    for (let k = 1; k < n; k++) {
      const d = s.charCodeAt(i + k)
      if ((d & 0xc0) !== 0x80) return null
      cp = (cp << 6) | (d & 63)
    }
    return [cp, n]
  }
  def(utf8, 'codepoint', A => {
    const s = checkStr(A, 0, 'codepoint')
    const i = posrelat(optInt(A, 1, 'codepoint', 1), s.length)
    const j = posrelat(A[2] === undefined ? i : checkInt(A, 2, 'codepoint'), s.length)
    const outv = []
    for (let p = i - 1; p < j;) {
      const r = decodeAt(s, p)
      if (!r) throw rtError('invalid UTF-8 code')
      outv.push(r[0])
      p += r[1]
    }
    return outv
  })
  def(utf8, 'len', A => {
    const s = checkStr(A, 0, 'len')
    let i = posrelat(optInt(A, 1, 'len', 1), s.length) - 1
    const j = posrelat(optInt(A, 2, 'len', -1), s.length)
    let n = 0
    while (i < j) {
      const r = decodeAt(s, i)
      if (!r) return [undefined, i + 1]
      i += r[1]
      n++
    }
    return n
  })
  def(utf8, 'offset', A => {
    const s = checkStr(A, 0, 'offset')
    const n = checkInt(A, 1, 'offset')
    let i = posrelat(optInt(A, 2, 'offset', n >= 0 ? 1 : s.length + 1), s.length) - 1
    const cont = p => p < s.length && (s.charCodeAt(p) & 0xc0) === 0x80
    let k = n
    if (k === 0) { while (i > 0 && cont(i)) i--; return i + 1 }
    if (cont(i)) throw rtError('initial position is a continuation byte')
    if (k < 0) {
      while (k < 0 && i > 0) { do { i-- } while (i > 0 && cont(i)); k++ }
    } else {
      k--
      while (k > 0 && i < s.length) { do { i++ } while (cont(i)); k-- }
    }
    return k === 0 ? i + 1 : [undefined]
  })
  const codesIter = native('codes_iter', A => {
    const s = A[0]
    let i = A[1]
    if (i > 0) { const r = decodeAt(s, i - 1); i += r ? r[1] : 1 } else i = 1
    if (i > s.length) return [undefined]
    const r = decodeAt(s, i - 1)
    if (!r) throw rtError('invalid UTF-8 code')
    return [i, r[0]]
  })
  def(utf8, 'codes', A => [codesIter, checkStr(A, 0, 'codes'), 0])
  def(utf8, 'graphemes', A => {
    const s = checkStr(A, 0, 'graphemes')
    let p = 0
    return native('graphemes_iter', () => {
      if (p >= s.length) return [undefined]
      const r = decodeAt(s, p) || [0, 1]
      const st = p + 1
      p += r[1]
      return [st, p]
    })
  })
  def(utf8, 'nfcnormalize', A => toBytes(fromBytes(checkStr(A, 0, 'nfcnormalize')).normalize('NFC')))
  def(utf8, 'nfdnormalize', A => toBytes(fromBytes(checkStr(A, 0, 'nfdnormalize')).normalize('NFD')))
  G.set('utf8', utf8)

  // ---- bit32 ----
  const bit = new LTable()
  const u32 = (A, i, f) => checkNum(A, i, f) >>> 0
  def(bit, 'band', A => A.reduce((acc, _, i) => (acc & u32(A, i, 'band')) >>> 0, 0xffffffff))
  def(bit, 'bor', A => A.reduce((acc, _, i) => (acc | u32(A, i, 'bor')) >>> 0, 0))
  def(bit, 'bxor', A => A.reduce((acc, _, i) => (acc ^ u32(A, i, 'bxor')) >>> 0, 0))
  def(bit, 'btest', A => A.reduce((acc, _, i) => (acc & u32(A, i, 'btest')) >>> 0, 0xffffffff) !== 0)
  def(bit, 'bnot', A => (~u32(A, 0, 'bnot')) >>> 0)
  def(bit, 'lshift', A => { const n = checkInt(A, 1, 'lshift'); return n >= 32 || n <= -32 ? 0 : n >= 0 ? (u32(A, 0, 'lshift') << n) >>> 0 : u32(A, 0, 'lshift') >>> -n })
  def(bit, 'rshift', A => { const n = checkInt(A, 1, 'rshift'); return n >= 32 || n <= -32 ? 0 : n >= 0 ? u32(A, 0, 'rshift') >>> n : (u32(A, 0, 'rshift') << -n) >>> 0 })
  def(bit, 'arshift', A => { const n = checkInt(A, 1, 'arshift'); const x = u32(A, 0, 'arshift') | 0; return n >= 32 ? (x < 0 ? 0xffffffff : 0) : (x >> n) >>> 0 })
  def(bit, 'lrotate', A => { const x = u32(A, 0, 'lrotate'); const n = ((checkInt(A, 1, 'lrotate') % 32) + 32) % 32; return ((x << n) | (x >>> (32 - n))) >>> 0 })
  def(bit, 'rrotate', A => { const x = u32(A, 0, 'rrotate'); const n = ((checkInt(A, 1, 'rrotate') % 32) + 32) % 32; return ((x >>> n) | (x << (32 - n))) >>> 0 })
  def(bit, 'extract', A => { const x = u32(A, 0, 'extract'); const f = checkInt(A, 1, 'extract'); const w = optInt(A, 2, 'extract', 1); if (f < 0 || w <= 0 || f + w > 32) throw rtError('trying to access non-existent bits'); return w === 32 ? x : (x >>> f) & ((1 << w) - 1) >>> 0 })
  def(bit, 'replace', A => { const x = u32(A, 0, 'replace'); const v = u32(A, 1, 'replace'); const f = checkInt(A, 2, 'replace'); const w = optInt(A, 3, 'replace', 1); if (f < 0 || w <= 0 || f + w > 32) throw rtError('trying to access non-existent bits'); const mask = (w === 32 ? 0xffffffff : ((1 << w) - 1)) << f; return ((x & ~mask) | ((v << f) & mask)) >>> 0 })
  def(bit, 'countlz', A => Math.clz32(u32(A, 0, 'countlz')))
  def(bit, 'countrz', A => { const x = u32(A, 0, 'countrz'); if (x === 0) return 32; let n = 0; while (!((x >>> n) & 1)) n++; return n })
  def(bit, 'byteswap', A => { const x = u32(A, 0, 'byteswap'); return (((x & 0xff) << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | (x >>> 24)) >>> 0 })
  G.set('bit32', bit)

  // ---- buffer ----
  G.set('buffer', makeBufferLib(def, defg))

  // ---- debug ----
  const dbg = new LTable()
  def(dbg, 'traceback', A => {
    let msg = A[0]
    if (msg instanceof Coroutine) msg = A[1]
    if (msg !== undefined && typeof msg !== 'string' && typeof msg !== 'number') return msg
    const tb = rt.lastTraceback && rt.lastTraceback.length ? rt.lastTraceback : [hooks.chunkName + ':?']
    return (msg !== undefined ? tostring(msg) + '\n' : '') + 'stack traceback:\n' + tb.join('\n')
  })
  def(dbg, 'info', A => {
    let f = A[0]
    let opts = A[1]
    if (f instanceof Coroutine) { f = A[1]; opts = A[2] }
    opts = typeof opts === 'string' ? opts : 'sl'
    const outv = []
    for (const o of opts) {
      if (o === 's') outv.push(f instanceof LFunc && f.n ? '[C]' : hooks.chunkName)
      else if (o === 'l') outv.push(f instanceof LFunc ? -1 : 0)
      else if (o === 'n') outv.push(f instanceof LFunc ? f.name || '' : '')
      else if (o === 'a') outv.push(0, f instanceof LFunc && !f.g)
      else if (o === 'f') outv.push(f instanceof LFunc ? f : undefined)
    }
    return outv
  })
  def(dbg, 'profilebegin', () => {})
  def(dbg, 'profileend', () => {})
  def(dbg, 'setmemorycategory', () => {})
  def(dbg, 'resetmemorycategory', () => {})
  def(dbg, 'getmetatable', A => getMetatable(A[0]) || [undefined])
  def(dbg, 'setmetatable', A => { if (A[0] instanceof LTable) A[0].mt = A[1] || null; return A[0] })
  G.set('debug', dbg)

  void eq; void addressOf
  return { stringLib, nextFn, ipairsIter, compile }
}

// ---- buffer ライブラリ ----
class LBuffer {
  constructor(size) {
    this.bytes = new Uint8Array(size)
    this.view = new DataView(this.bytes.buffer)
    this.isBuffer = true
  }
  luaToString() { return 'buffer: ' + addressOf(this) }
}

function makeBufferLib(def) {
  const B = new LTable()
  const chk = (A, fname) => {
    if (!(A[0] instanceof LBuffer)) throw argError(1, fname, `buffer expected, got ${A.length ? type(A[0]) : 'no value'}`)
    return A[0]
  }
  const bounds = (b, off, size) => {
    if (off < 0 || off + size > b.bytes.length || !Number.isInteger(off)) throw rtError('buffer access out of bounds')
  }
  def(B, 'create', A => {
    const n = checkInt(A, 0, 'create')
    if (n < 0 || n > 1024 * 1024 * 1024) throw argError(1, 'create', 'size out of range')
    return new LBuffer(n)
  })
  def(B, 'fromstring', A => {
    const s = checkStr(A, 0, 'fromstring')
    const b = new LBuffer(s.length)
    for (let i = 0; i < s.length; i++) b.bytes[i] = s.charCodeAt(i)
    return b
  })
  def(B, 'tostring', A => {
    const b = chk(A, 'tostring')
    let s = ''
    for (let i = 0; i < b.bytes.length; i += 8192) s += String.fromCharCode.apply(null, b.bytes.subarray(i, i + 8192))
    return s
  })
  def(B, 'len', A => chk(A, 'len').bytes.length)
  const rw = [
    ['i8', 1, 'Int8'], ['u8', 1, 'Uint8'], ['i16', 2, 'Int16'], ['u16', 2, 'Uint16'],
    ['i32', 4, 'Int32'], ['u32', 4, 'Uint32'], ['f32', 4, 'Float32'], ['f64', 8, 'Float64'],
  ]
  for (const [n, size, dv] of rw) {
    def(B, 'read' + n, A => {
      const b = chk(A, 'read' + n), off = checkInt(A, 1, 'read' + n)
      bounds(b, off, size)
      return b.view['get' + dv](off, true)
    })
    def(B, 'write' + n, A => {
      const b = chk(A, 'write' + n), off = checkInt(A, 1, 'write' + n)
      bounds(b, off, size)
      const v = checkNum(A, 2, 'write' + n)
      b.view['set' + dv](off, dv.startsWith('Float') ? v : Math.trunc(v), true)
    })
  }
  def(B, 'readstring', A => {
    const b = chk(A, 'readstring'), off = checkInt(A, 1, 'readstring'), n = checkInt(A, 2, 'readstring')
    bounds(b, off, n)
    return String.fromCharCode.apply(null, b.bytes.subarray(off, off + n))
  })
  def(B, 'writestring', A => {
    const b = chk(A, 'writestring'), off = checkInt(A, 1, 'writestring'), s = checkStr(A, 2, 'writestring')
    const n = A[3] === undefined ? s.length : checkInt(A, 3, 'writestring')
    bounds(b, off, n)
    for (let i = 0; i < n; i++) b.bytes[off + i] = s.charCodeAt(i)
  })
  def(B, 'copy', A => {
    const t = chk(A, 'copy'), toff = checkInt(A, 1, 'copy')
    if (!(A[2] instanceof LBuffer)) throw argError(3, 'copy', 'buffer expected')
    const s = A[2]
    const soff = optInt(A, 3, 'copy', 0)
    const n = A[4] === undefined ? s.bytes.length - soff : checkInt(A, 4, 'copy')
    bounds(s, soff, n); bounds(t, toff, n)
    t.bytes.set(s.bytes.slice(soff, soff + n), toff)
  })
  def(B, 'fill', A => {
    const b = chk(A, 'fill'), off = checkInt(A, 1, 'fill'), v = checkInt(A, 2, 'fill') & 255
    const n = A[3] === undefined ? b.bytes.length - off : checkInt(A, 3, 'fill')
    bounds(b, off, n)
    b.bytes.fill(v, off, off + n)
  })
  def(B, 'readbits', A => {
    const b = chk(A, 'readbits'), off = checkInt(A, 1, 'readbits'), n = checkInt(A, 2, 'readbits')
    if (n < 0 || n > 32) throw argError(3, 'readbits', 'bit count is out of range of [0; 32]')
    if (off < 0 || off + n > b.bytes.length * 8) throw rtError('buffer access out of bounds')
    let v = 0
    for (let i = 0; i < n; i++) {
      const bitPos = off + i
      if ((b.bytes[bitPos >> 3] >> (bitPos & 7)) & 1) v += 2 ** i
    }
    return v
  })
  def(B, 'writebits', A => {
    const b = chk(A, 'writebits'), off = checkInt(A, 1, 'writebits'), n = checkInt(A, 2, 'writebits')
    let v = checkNum(A, 3, 'writebits') >>> 0
    if (n < 0 || n > 32) throw argError(3, 'writebits', 'bit count is out of range of [0; 32]')
    if (off < 0 || off + n > b.bytes.length * 8) throw rtError('buffer access out of bounds')
    for (let i = 0; i < n; i++) {
      const bitPos = off + i
      if ((v >>> i) & 1) b.bytes[bitPos >> 3] |= 1 << (bitPos & 7)
      else b.bytes[bitPos >> 3] &= ~(1 << (bitPos & 7))
    }
  })
  return B
}

// ---- メモリ使用量の概算 (performance.memory があれば使用) ----
function estimateMemory() {
  try {
    if (typeof performance !== 'undefined' && performance.memory) return performance.memory.usedJSHeapSize
  } catch {}
  return 4 * 1024 * 1024
}

// ---- Perlin ノイズ (math.noise) ----
const PERM = (() => {
  const p = [151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180]
  return p.concat(p)
})()
function perlin(x, y, z) {
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10)
  const lerp = (t, a, b) => a + t * (b - a)
  const grad = (h, x, y, z) => {
    h &= 15
    const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z)
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v)
  }
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z)
  const u = fade(x), v = fade(y), w = fade(z)
  const P = PERM
  const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, Bq = P[X + 1] + Y, BA = P[Bq] + Z, BB = P[Bq + 1] + Z
  return lerp(w, lerp(v, lerp(u, grad(P[AA], x, y, z), grad(P[BA], x - 1, y, z)), lerp(u, grad(P[AB], x, y - 1, z), grad(P[BB], x - 1, y - 1, z))),
    lerp(v, lerp(u, grad(P[AA + 1], x, y, z - 1), grad(P[BA + 1], x - 1, y, z - 1)), lerp(u, grad(P[AB + 1], x, y - 1, z - 1), grad(P[BB + 1], x - 1, y - 1, z - 1))))
}
