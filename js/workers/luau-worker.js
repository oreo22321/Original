// Luau / Lua 実行用 Web Worker (モジュールワーカー)
import { createVM, formatError } from '../luau/vm.js'
import { installRoblox } from '../luau/roblox.js'
import { installExecutor } from '../luau/executor.js'
import { LuauSyntaxError, toBytes, fromBytes } from '../luau/lexer.js'
import { LuaError } from '../luau/runtime.js'

let apiPromise = null
function loadApi() {
  if (!apiPromise) {
    apiPromise = fetch(new URL('../../data/roblox-api.json', import.meta.url)).then(r => {
      if (!r.ok) throw new Error('Roblox API データの読み込みに失敗しました (' + r.status + ')')
      return r.json()
    })
  }
  return apiPromise
}

// ---- 出力のバッファリング (大量の print でも UI が固まらないように) ----
let buf = []
let lastFlush = 0
let lineCount = 0
const MAX_LINES = 20000
function flush() {
  if (buf.length) { self.postMessage({ type: 'output', items: buf }); buf = [] }
  lastFlush = performance.now()
}
function emit(kind, text) {
  if (lineCount >= MAX_LINES) {
    if (lineCount === MAX_LINES) { buf.push({ kind: 'warn', text: `出力が ${MAX_LINES} 行を超えたため、以降は省略します` }); lineCount++ }
    return
  }
  lineCount++
  buf.push({ kind, text })
  if (buf.length > 200 || performance.now() - lastFlush > 60) flush()
}
setInterval(flush, 80)

let currentVM = null
let finishTimer = null

function finish(reason) {
  if (!currentVM) return
  currentVM.sched.stop()
  flush()
  const vm = currentVM
  currentVM = null
  clearTimeout(finishTimer)
  self.postMessage({ type: 'done', reason, tree: vm.rbx ? snapshotTree(vm.rbx.game) : null, drawings: vm.exec ? snapshotDrawings(vm.exec.drawings) : null })
}

// エクスプローラー表示用に Instance ツリーを JSON 化
function snapshotTree(root, depth = 0) {
  const node = { n: root.name, c: root.ClassName }
  if (depth < 12 && root.children.length) {
    const kids = root.children.slice(0, 200)
    node.k = kids.map(ch => snapshotTree(ch, depth + 1))
    if (root.children.length > 200) node.more = root.children.length - 200
  }
  return node
}

function snapshotDrawings(set) {
  if (!set || !set.size) return null
  const out = []
  for (const d of set) {
    if (d.removed || !d.props.get('Visible')) continue
    const o = { kind: d.kind }
    for (const [k, v] of d.props) {
      if (typeof v === 'number' || typeof v === 'boolean') o[k] = v
      else if (typeof v === 'string') o[k] = fromBytes(v)
      else if (v && v.luaTypeName === 'Vector2') o[k] = [v.x, v.y]
      else if (v && v.luaTypeName === 'Color3') o[k] = [v.r, v.g, v.b]
    }
    out.push(o)
    if (out.length > 2000) break
  }
  return out
}

function errorPayload(e, chunk) {
  if (e instanceof LuauSyntaxError) return { text: `${chunk || 'main'}:${e.line}: 構文エラー: ${e.message}`, file: chunk, line: e.line, col: e.col, syntax: true }
  const text = formatError(e)
  const m = /^(.+?):(\d+): /.exec(text)
  return { text, traceback: e instanceof LuaError ? e.traceback : [], file: m ? m[1] : null, line: m ? Number(m[2]) : null }
}

async function run(msg) {
  const opts = msg.options || {}
  lineCount = 0
  buf = []
  const hooks = {
    output: (kind, text) => emit(kind, text),
    onError: e => { flush(); self.postMessage({ type: 'error', ...errorPayload(e) }) },
    onIdle: () => finish('idle'),
    post: m => { flush(); self.postMessage(m) },
    printSep: msg.mode === 'lua' ? '\t' : ' ',
    touch: !!opts.touch,
    chunkName: msg.chunkName,
  }
  const vm = createVM(hooks, { timeLimit: opts.timeLimit ?? 10000 })
  currentVM = vm
  const ctx = { sched: vm.sched, hooks, fs: new Map(), fsFolders: new Set(), currentFile: msg.path }
  for (const [p, c] of Object.entries(msg.wsFiles || {})) ctx.fs.set(p, toBytes(c))
  for (const f of msg.wsFolders || []) ctx.fsFolders.add(f)
  try {
    if (msg.mode !== 'lua' && opts.roblox !== false) {
      ctx.api = await loadApi()
      vm.rbx = installRoblox(vm.env, ctx)
      vm.rbx.mountFiles(msg.files || {}, msg.projectName)
      vm.rbx.setScript(msg.path)
      if (opts.executor !== false) vm.exec = installExecutor(vm.env, ctx, vm.rbx)
    }
  } catch (e) {
    emit('error', 'サンドボックスの初期化に失敗しました: ' + (e && e.message))
    finish('error')
    return
  }
  if (opts.maxRunTime > 0) {
    finishTimer = setTimeout(() => {
      emit('warn', `実行時間の上限 (${opts.maxRunTime} 秒) に達したため停止しました (設定で変更できます)`)
      finish('timeout')
    }, opts.maxRunTime * 1000)
  }
  self.postMessage({ type: 'started' })
  try {
    vm.run(msg.source, msg.chunkName)
  } catch (e) {
    flush()
    self.postMessage({ type: 'error', ...errorPayload(e, msg.chunkName) })
    finish('error')
  }
}

self.onmessage = e => {
  const msg = e.data
  if (msg.type === 'run') run(msg)
  else if (msg.type === 'stop') finish('stopped')
  else if (msg.type === 'check') {
    // 構文チェックのみ (メインスレッドの負荷軽減用)
    self.postMessage({ type: 'checked', id: msg.id })
  }
}
