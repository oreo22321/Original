// Luau 実行環境のエントリポイント
import { LTable, Coroutine, rt, LuaError } from './runtime.js'
import * as runtime from './runtime.js'
import { Scheduler, createStdlib } from './stdlib.js'
import { loadChunk } from './compiler.js'
import { LuauSyntaxError, fromBytes } from './lexer.js'

// hooks: { output(kind, text), onError(err), onIdle(), printSep, chunkName }
export function createVM(hooks, opts = {}) {
  const env = new LTable()
  const sched = new Scheduler(hooks)
  rt.scheduler = sched
  rt.timeLimit = opts.timeLimit ?? 10000
  rt.current = null
  rt.namecallHook = rt.indexHook = rt.newindexHook = null
  rt.debugger = null
  rt.syncDepth = 0
  rt.tops = new Map()
  const std = createStdlib(env, hooks, sched)

  const vm = {
    env, sched, std, runtime, hooks,
    compile(src, chunkname) {
      return loadChunk(src, chunkname, env, runtime)
    },
    // スクリプトを実行。構文エラーは例外 (LuauSyntaxError)
    run(src, chunkname = 'main') {
      hooks.chunkName = chunkname
      const f = vm.compile(src, chunkname)
      const co = new Coroutine(f)
      co.isMain = true
      sched.run(co, [])
      return co
    },
  }
  return vm
}

export function formatError(e) {
  if (e instanceof LuauSyntaxError) return e.message
  if (e instanceof LuaError) {
    const v = e.value
    let msg
    if (typeof v === 'string') msg = fromBytes(v)
    else if (v === undefined) msg = 'nil'
    else {
      try { msg = fromBytes(runtime.tostring(v)) } catch { msg = '(error object)' }
    }
    return msg
  }
  return String(e && e.message || e)
}

export { LTable, LuaError, LuauSyntaxError }
