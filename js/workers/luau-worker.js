// Luau 実行用 Web Worker (モジュールワーカー)
// ・起動直後に API データを読み込んでおく (warm) ので、▶ を押してすぐ実行が始まります
// ・GUI (ScreenGui) の内容を画面側へ送り、ボタンのタップなどの操作を受け取ります
import { createVM, formatError } from '../luau/vm.js'
import { installRoblox } from '../luau/roblox.js'
import { installExecutor } from '../luau/executor.js'
import { LuauSyntaxError, toBytes, fromBytes } from '../luau/lexer.js'
import { LuaError, rt, call, nativeGen, Coroutine, LTable } from '../luau/runtime.js'
import * as runtimeNs from '../luau/runtime.js'
import { loadChunk } from '../luau/compiler.js'
import { Debugger, inspect } from '../luau/debug.js'

let apiPromise = null
function loadApi() {
  if (!apiPromise) {
    apiPromise = fetch(new URL('../../data/roblox-api.json', import.meta.url)).then(r => {
      if (!r.ok) throw new Error('Roblox API データの読み込みに失敗しました (' + r.status + ')')
      return r.json()
    }).catch(e => { apiPromise = null; throw e })
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
  buf.push(currentVM ? { kind, text, t: Math.round(currentVM.sched.now() * 1000) } : { kind, text })
  if (buf.length > 200 || performance.now() - lastFlush > 60) flush()
}
setInterval(flush, 80)

let currentVM = null
let lastVM = null       // 終了した実行 (コンソールで続きの式を評価できるように残す)
let finishTimer = null
let deadline = 0        // 実行時間の上限 (デバッガーで止まっている間は延長)
let remainOnPause = 0
let uiTimer = null
let drawTimer = null
let drawSent = -1       // 最後に送った Drawing の版
let drawAvail = false   // ゲーム画面が隠れている間に Drawing ができたことを知らせたか
let interactKey = ''    // 最後に送った「操作できるもの」
let uiTick = 0
let uiMode = false        // 操作できる GUI を表示中 (実行時間の上限を数えない)
let guiShown = true       // 画面側でゲーム画面が見えているか
let waiting = false
let ids = new Map(), byId = new Map(), idSeed = 0
const idOf = inst => {
  let id = ids.get(inst)
  if (!id) { id = ++idSeed; ids.set(inst, id); byId.set(id, inst) }
  return id
}

function finish(reason) {
  if (!currentVM) return
  currentVM.sched.stop()
  flush()
  const vm = currentVM
  currentVM = null
  lastVM = vm
  waiting = false
  uiMode = false
  clearTimeout(finishTimer)
  clearInterval(uiTimer)
  clearInterval(drawTimer)
  if (vm.debugger && rt.debugger === vm.debugger) vm.debugger.mode = null
  self.postMessage({ type: 'done', reason, ...snapshot(vm) })
}

function armDeadline(ms) {
  clearTimeout(finishTimer)
  if (!(ms > 0)) return
  deadline = performance.now() + ms
  finishTimer = setTimeout(() => {
    emit('warn', `実行時間の上限に達したため停止しました (設定で変更できます)`)
    finish('timeout')
  }, ms)
}

function snapshot(vm) {
  if (!vm.rbx) return { tree: null, gui: null, interact: null, drawings: null }
  let gui = null, interact = null
  // 表示用なので失敗しても実行結果には影響させない
  try { gui = vm.gui ? vm.gui.snapshot() : null } catch {}
  try { interact = snapshotInteract(vm.rbx) } catch {}
  return { tree: snapshotTree(vm.rbx.game), gui, interact, drawings: vm.exec ? snapshotDrawings(vm.exec.drawings) : null }
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

// Drawing を画面に送る (変更があったときだけ、最大 25 回/秒。ゲーム画面が隠れている間は送らない)
function sendDrawings() {
  const vm = currentVM
  if (!vm || !vm.exec || vm.sched.paused) return
  if (!guiShown) {
    // 隠れている間は中身を送らず、「表示するものがある」ことだけ知らせる (画面側がゲームタブを開く)
    if (!drawAvail) for (const d of vm.exec.drawings) if (!d.removed && d.props.get('Visible')) { drawAvail = true; self.postMessage({ type: 'guiAvail' }); break }
    return
  }
  const v = vm.exec.drawVersion()
  if (v === drawSent) return
  drawSent = v
  try { self.postMessage({ type: 'drawings', list: snapshotDrawings(vm.exec.drawings) || [] }) } catch {}
}

const vec = v => (v && v.luaTypeName === 'Vector2' ? [v.x, v.y] : null)
function snapshotDrawings(set) {
  if (!set || !set.size) return null
  const out = []
  for (const d of set) {
    if (d.removed || !d.props.get('Visible')) continue
    const o = { kind: d.kind }
    if (d.kind === 'Image') { out.push({ kind: 'Image', Position: vec(d.props.get('Position')), Size: vec(d.props.get('Size')), Transparency: d.props.get('Transparency'), ZIndex: d.props.get('ZIndex') }); continue }
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

const hasConn = (inst, names) => !!inst.signals && names.some(n => { const s = inst.signals.get(n); return s && s.conns.length > 0 })
const str = v => (typeof v === 'string' ? fromBytes(v) : v === undefined || v === null ? '' : String(v))

// ============================================================
// 操作できるもの (クリック・接触・キー入力などに関数が接続されているオブジェクト)
// ============================================================
function snapshotInteract(rbx) {
  const out = []
  const add = (inst, kind, label) => { if (out.length < 60) out.push({ id: idOf(inst), kind, label, name: str(inst.name), path: fullPath(inst) }) }
  for (const inst of rbx.allInstances) {
    if (inst.destroyed || !inst.signals) continue
    const c = inst.ClassName
    if (c === 'ClickDetector' && hasConn(inst, ['MouseClick', 'RightMouseClick'])) add(inst, 'click', 'クリック')
    else if (c === 'ProximityPrompt' && hasConn(inst, ['Triggered', 'PromptButtonHoldBegan', 'PromptButtonHoldEnded', 'TriggerEnded'])) add(inst, 'prompt', '発動')
    else if (c === 'Tool' && hasConn(inst, ['Activated', 'Equipped'])) add(inst, 'tool', '使う')
    else if (inst.info.isA.has('BasePart') && hasConn(inst, ['Touched'])) add(inst, 'touch', '触れる')
    else if (c === 'UserInputService' && hasConn(inst, ['InputBegan', 'InputEnded', 'JumpRequest'])) add(inst, 'keys', 'キー入力')
    else if (c === 'Humanoid' && hasConn(inst, ['Died', 'HealthChanged'])) add(inst, 'kill', '倒す (Health = 0)')
    else if ((c === 'PlayerMouse' || c === 'Mouse') && hasConn(inst, ['Button1Down', 'Button1Up', 'KeyDown'])) add(inst, 'mouse', 'クリック')
  }
  return out.length ? out : null
}
function fullPath(inst) {
  const parts = []
  for (let p = inst; p && p.ClassName !== 'DataModel' && parts.length < 6; p = p.parent) parts.unshift(str(p.name))
  return parts.join('.')
}
function hasInteractive(vm) {
  if (!vm.rbx) return false
  try { if (vm.gui && vm.gui.interactive()) return true } catch {}
  return !!snapshotInteract(vm.rbx)
}

// 「操作できるもの」が前回と変わっていれば返す (同じなら undefined)
function interactNow(vm) {
  let it = null
  try { it = snapshotInteract(vm.rbx) } catch {}
  const key = JSON.stringify(it)
  if (key === interactKey) return undefined
  interactKey = key
  return it
}

// 操作できる GUI が表示されている間は、実行時間の上限を数えない (GUI が消えたら数え直す)
let maxRunMs = 0
function checkUi() {
  const vm = currentVM
  if (!vm || !vm.gui || vm.sched.paused) return
  let on = false
  try { on = vm.gui.interactive() } catch {}
  // Drawing (ESP など) を表示している間も、見ている画面なので時間切れにしない
  if (!on && vm.exec && guiShown) { for (const d of vm.exec.drawings) if (!d.removed && d.props.get('Visible')) { on = true; break } }
  if (on && !uiMode) {
    uiMode = true
    clearTimeout(finishTimer)
    uiTick = 0
    self.postMessage({ type: 'uiMode', interact: interactNow(vm) })
  } else if (on && uiMode && ++uiTick % 5 === 0) {
    // 実行中も「操作できるもの」(キー入力のボタンなど) を最新にする
    const it = interactNow(vm)
    if (it !== undefined) self.postMessage({ type: 'interact', interact: it })
  } else if (!on && uiMode) {
    uiMode = false
    if (maxRunMs > 0 && !waiting) armDeadline(maxRunMs)
  }
}

// ---- 画面からの操作 ----
function handleInput(m) {
  const vm = currentVM
  if (!vm || !vm.rbx) return
  const rbx = vm.rbx
  const inst = m.id ? byId.get(m.id) : null
  const player = rbx.player
  try {
    switch (m.kind) {
      // ゲーム画面の操作 (GUI エンジンが InputObject として再現)
      case 'pointer': case 'wheel': case 'text': vm.gui.input(m); break
      case 'key':
        if (m.down === undefined) {
          // 「操作できるもの」のキーボタン: 押して離す
          vm.gui.input({ kind: 'key', key: m.key, down: true })
          vm.sched.setTimer(0.08, () => { try { vm.gui.input({ kind: 'key', key: m.key, down: false }) } catch (e) { reportError(e) } vm.sched.checkIdle() })
        } else vm.gui.input(m)
        break
      case 'click': if (inst) inst.fire('MouseClick', [player]); break
      case 'prompt': if (inst) { inst.fire('PromptButtonHoldBegan', [player]); inst.fire('Triggered', [player]); inst.fire('TriggerEnded', [player]) } break
      case 'tool': if (inst) { inst.fire('Equipped', [player.getProp('Character')]); inst.fire('Activated', []) } break
      case 'touch': {
        const ch = player.getProp('Character')
        const part = ch && (ch.findChild('HumanoidRootPart') || ch.children[0])
        if (inst && part) inst.fire('Touched', [part])
        break
      }
      case 'kill': if (inst) inst.luaNewIndex('Health', 0); break
      case 'mouse': if (inst) { inst.fire('Button1Down', []); inst.fire('Button1Up', []) } break
    }
  } catch (e) {
    reportError(e)
  }
  if (waiting && m.phase !== 'move') { waiting = false; self.postMessage({ type: 'resumed' }) }
  vm.sched.checkIdle()
}
function reportError(e) {
  flush()
  postError(errorPayload(e))
}

// 同じエラーが繰り返されたとき (毎フレームのイベントなど) は 1 つにまとめて回数だけ送る
let errSeen = new Map()
function postError(payload) {
  const key = payload.text
  const seen = errSeen.get(key)
  if (!seen) {
    // 種類が多すぎるときは、まとめずにそのまま送る (捨てない)
    if (errSeen.size > 200) { self.postMessage({ type: 'error', ...payload }); return }
    errSeen.set(key, { n: 1, t: null })
    self.postMessage({ type: 'error', ...payload })
    return
  }
  seen.n++
  if (!seen.t) seen.t = setTimeout(() => { seen.t = null; self.postMessage({ type: 'errorRepeat', text: key, n: seen.n }) }, 400)
}

function errorPayload(e, chunk) {
  if (e instanceof LuauSyntaxError) return { text: `${chunk || 'main'}:${e.line}: 構文エラー: ${e.message}`, file: chunk, line: e.line, col: e.col, syntax: true, message: e.message }
  const text = formatError(e)
  const m = /^(.+?):(\d+): ([\s\S]*)$/.exec(text)
  return { text, traceback: e instanceof LuaError ? e.traceback : [], file: m ? m[1] : null, line: m ? Number(m[2]) : null, message: m ? m[3] : text }
}

async function run(msg) {
  const opts = msg.options || {}
  if (currentVM) finish('stopped')
  lineCount = 0
  buf = []
  waiting = false
  uiMode = false
  for (const v of errSeen.values()) clearTimeout(v.t)
  errSeen = new Map()
  ids = new Map(); byId = new Map(); idSeed = 0
  let vm = null
  const hooks = {
    // 終了後に遅れて届いた出力 (通信の応答など) は捨てる
    output: (kind, text) => { if (currentVM === vm) emit(kind, text) },
    onError: e => { if (currentVM !== vm) return; flush(); postError(errorPayload(e)) },
    onIdle: () => {
      if (currentVM !== vm) return
      // ボタンなどに関数が接続されていれば、操作を待ち続ける (■ 停止で終了)
      if (opts.interactive !== false && hasInteractive(vm)) {
        if (!waiting) {
          waiting = true
          flush()
          clearTimeout(finishTimer)
          self.postMessage({ type: 'waiting', ...snapshot(vm) })
        }
        return
      }
      finish('idle')
    },
    post: m => { if (currentVM !== vm) return; flush(); self.postMessage(m) },
    printSep: ' ',
    touch: !!opts.touch,
    device: opts.device || (opts.touch ? 'phone' : 'pc'),
    chunkName: msg.chunkName,
  }
  vm = createVM(hooks, { timeLimit: opts.timeLimit ?? 10000 })
  currentVM = vm
  if (opts.debug) {
    const dbg = new Debugger({
      env: vm.env,
      output: (kind, text) => { if (currentVM === vm) emit(kind, text) },
      onPaused: info => {
        if (currentVM !== vm) return
        flush()
        // 止まっている間は実行時間の上限を数えない
        if (deadline) { remainOnPause = Math.max(1000, deadline - performance.now()); clearTimeout(finishTimer) }
        self.postMessage({ type: 'paused', ...info })
      },
    })
    dbg.watches = opts.debug.watches || []
    dbg.setBreakpoints(opts.debug.breakpoints || {})
    vm.debugger = dbg
    rt.debugger = dbg
  }
  const ctx = { sched: vm.sched, hooks, fs: new Map(), fsFolders: new Set(), currentFile: msg.path, runContext: opts.kind || 'module', net: opts.net || {} }
  for (const [p, c] of Object.entries(msg.wsFiles || {})) ctx.fs.set(p, toBytes(c))
  for (const f of msg.wsFolders || []) ctx.fsFolders.add(f)
  try {
    ctx.api = await loadApi()
    if (currentVM !== vm) return
    vm.rbx = installRoblox(vm.env, ctx)
    vm.gui = ctx.gui
    if (opts.screen) vm.gui.setScreen(opts.screen[0], opts.screen[1])
    vm.gui.setVisible(guiShown)
    vm.rbx.mountFiles(msg.files || {}, msg.projectName)
    vm.rbx.setScript(msg.path)
    if (opts.executor) vm.exec = installExecutor(vm.env, ctx, vm.rbx)
    if (vm.debugger) vm.debugger.markBuiltins()
  } catch (e) {
    emit('error', 'サンドボックスの初期化に失敗しました: ' + (e && e.message))
    finish('error')
    return
  }
  deadline = 0
  maxRunMs = opts.maxRunTime > 0 ? opts.maxRunTime * 1000 : 0
  if (maxRunMs) armDeadline(maxRunMs)
  uiTimer = setInterval(checkUi, 400)
  drawSent = -1
  drawAvail = false
  interactKey = ''
  if (vm.exec) drawTimer = setInterval(sendDrawings, 40)
  self.postMessage({ type: 'started', debug: !!vm.debugger })
  try {
    if (msg.repl) startRepl(vm, msg.source)
    else { vm.mainChunk = msg.chunkName; vm.run(msg.source, msg.chunkName) }
  } catch (e) {
    flush()
    self.postMessage({ type: 'error', ...errorPayload(e, msg.chunkName) })
    finish('error')
  }
}

// ============================================================
// デバッガーの操作
// ============================================================
function debugCommand(m) {
  const vm = currentVM
  const dbg = vm && vm.debugger
  if (!dbg) return
  if (m.action === 'pause') { dbg.requestPause(); return }
  if (!vm.sched.paused) return
  self.postMessage({ type: 'debugResumed' })
  if (remainOnPause) { armDeadline(remainOnPause); remainOnPause = 0 }
  try { dbg.resume(m.action) } catch (e) { flush(); self.postMessage({ type: 'error', ...errorPayload(e) }) }
}

// ============================================================
// コンソール (式・コードをその場で実行)
//  ・デバッガーで止まっているとき: その場所の変数を使って評価 (待機はできません)
//  ・実行中 / 実行後: 同じ環境 (グローバル変数・作ったオブジェクト) で新しいスレッドとして実行
// ============================================================
function display(values) {
  return values.map(v => inspect(v, 1)).join(', ')
}

// コンソールの環境: スクリプトの一番外側の local 変数も読めるようにする (書き込みはグローバルへ)
function replEnv(vm) {
  const env = new LTable()
  const mt = new LTable()
  mt.set(toBytes('__index'), vm.env)
  mt.set(toBytes('__newindex'), vm.env)
  env.mt = mt
  const get = vm.mainChunk && rt.tops && rt.tops.get(vm.mainChunk)
  if (get) { try { for (const [n, v] of get()) if (v !== undefined) env.set(toBytes(n), v) } catch {} }
  return env
}

function compileRepl(vm, code) {
  const save = rt.debugger
  rt.debugger = null
  const env = replEnv(vm)
  try {
    try { return loadChunk('return ' + code, 'コンソール', env, runtimeNs) } catch { return loadChunk(code, 'コンソール', env, runtimeNs) }
  } finally { rt.debugger = save }
}

function startRepl(vm, code) {
  const f = compileRepl(vm, code)
  const wrapper = nativeGen('console', function* () {
    const r = yield* call(f, [])
    if (r && r.length) vm.hooks.output('result', display(r))
    return []
  })
  vm.sched.spawn(new Coroutine(wrapper), [])
}

function evaluate(m) {
  // デバッガーで一時停止中
  const vm = currentVM
  if (vm && vm.debugger && vm.sched.paused) {
    const save = vm.debugger.condCache
    vm.debugger.condCache = new Map() // 毎回の入力は使い捨て
    const r = vm.debugger.evalIn(m.code, vm.debugger.pausedInfo ? vm.debugger.pausedInfo.locals : null)
    vm.debugger.condCache = save
    if (r.ok) { if (r.values.length) emit('result', display(r.values)) } else emit('error', r.error)
    flush()
    self.postMessage({ type: 'evalDone', id: m.id })
    return
  }
  try {
    if (vm) {
      startRepl(vm, m.code)
      if (waiting) { waiting = false; self.postMessage({ type: 'resumed' }) }
      vm.sched.checkIdle()
    } else if (lastVM) {
      // 終了した実行の環境を再び動かす
      const old = lastVM
      currentVM = old
      lastVM = null
      old.sched.stopped = false
      rt.scheduler = old.sched
      rt.debugger = null
      rt.halted = null
      uiTimer = setInterval(checkUi, 400)
      clearInterval(drawTimer)
      drawSent = -1
      if (old.exec) drawTimer = setInterval(sendDrawings, 40)
      if (old.gui) old.gui.full()
      self.postMessage({ type: 'started', repl: true })
      startRepl(old, m.code)
      old.sched.checkIdle()
    } else {
      // まだ何も実行していない: 新しい環境を作って実行
      run({ ...m.init, source: m.code, repl: true })
      return
    }
  } catch (e) {
    flush()
    self.postMessage({ type: 'error', ...errorPayload(e, 'コンソール') })
    if (currentVM && !currentVM.sched.running) currentVM.sched.checkIdle()
  }
  flush()
  self.postMessage({ type: 'evalDone', id: m.id })
}

self.onmessage = e => {
  const msg = e.data
  if (msg.type === 'run') run(msg)
  else if (msg.type === 'stop') finish('stopped')
  else if (msg.type === 'input') handleInput(msg)
  else if (msg.type === 'guiVisible') { guiShown = !!msg.on; drawSent = -1; const vm = currentVM; if (vm && vm.gui) vm.gui.setVisible(guiShown) }
  else if (msg.type === 'screen') {
    const vm = currentVM || lastVM
    if (vm && vm.gui) {
      vm.gui.setScreen(msg.w, msg.h)
      // 終了後も、最後の画面を新しい大きさで描き直す
      if (currentVM) vm.gui.full()
      else { try { self.postMessage({ type: 'gui', patch: vm.gui.snapshot() }) } catch {} }
    }
  }
  else if (msg.type === 'warm') loadApi().then(() => self.postMessage({ type: 'warm' }), () => {})
  else if (msg.type === 'debug') debugCommand(msg)
  else if (msg.type === 'breakpoints') { const d = currentVM && currentVM.debugger; if (d) d.setBreakpoints(msg.list) }
  else if (msg.type === 'watches') {
    const d = currentVM && currentVM.debugger
    if (d) { d.watches = msg.list || []; if (currentVM.sched.paused) self.postMessage({ type: 'watchValues', watches: d.watches.map(w => d.watchValue(w)) }) }
  }
  else if (msg.type === 'expand') {
    const d = currentVM && currentVM.debugger
    self.postMessage({ type: 'expanded', id: msg.id, items: d ? d.expand(msg.ref) : [] })
  }
  else if (msg.type === 'eval') evaluate(msg)
}
