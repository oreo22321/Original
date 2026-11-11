// Luau 実行用 Web Worker (モジュールワーカー)
// ・起動直後に API データを読み込んでおく (warm) ので、▶ を押してすぐ実行が始まります
// ・GUI (ScreenGui) の内容を画面側へ送り、ボタンのタップなどの操作を受け取ります
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
let finishTimer = null
let guiTimer = null
let lastGui = ''
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
  waiting = false
  clearTimeout(finishTimer)
  clearInterval(guiTimer)
  self.postMessage({ type: 'done', reason, ...snapshot(vm) })
}

function snapshot(vm) {
  if (!vm.rbx) return { tree: null, gui: null, interact: null, drawings: null }
  let gui = null, interact = null
  try { gui = snapshotGui(vm.rbx); interact = snapshotInteract(vm.rbx) } catch { /* 表示用なので失敗しても実行結果には影響させない */ }
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

// ============================================================
// GUI のスナップショット (画面側で HTML として描画)
// ============================================================
const CLICK_EVENTS = ['Activated', 'MouseButton1Click', 'MouseButton1Down', 'MouseButton1Up']
const hasConn = (inst, names) => !!inst.signals && names.some(n => { const s = inst.signals.get(n); return s && s.conns.length > 0 })
const str = v => (typeof v === 'string' ? fromBytes(v) : v === undefined || v === null ? '' : String(v))
const col = c => (c && c.luaTypeName === 'Color3' ? [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)] : null)
const ud2 = u => (u && u.X ? [u.X.s, u.X.o, u.Y.s, u.Y.o] : null)
const ud = u => (u && typeof u.s === 'number' ? [u.s, u.o] : null)
const en = e => (e && e.luaTypeName === 'EnumItem' ? e.name : undefined)

function snapshotGui(rbx) {
  const roots = []
  let budget = 700
  const node = inst => {
    if (budget-- <= 0) return null
    const g = k => inst.getProp(k)
    const isObj = inst.info.isA.has('GuiObject')
    const n = { id: idOf(inst), c: inst.ClassName, n: str(inst.name) }
    if (isObj) {
      if (g('Visible') === false) n.v = 0
      n.p = ud2(g('Position')); n.s = ud2(g('Size'))
      const a = g('AnchorPoint'); if (a && (a.x || a.y)) n.a = [a.x, a.y]
      n.bg = col(g('BackgroundColor3')); n.bt = g('BackgroundTransparency') || 0
      const bs = g('BorderSizePixel'); if (bs) { n.bs = bs; n.bc = col(g('BorderColor3')) }
      const z = g('ZIndex'); if (z && z !== 1) n.z = z
      const lo = g('LayoutOrder'); if (lo) n.lo = lo
      const rot = g('Rotation'); if (rot) n.rot = rot
      if (g('ClipsDescendants')) n.clip = 1
      if (inst.info.isA.has('TextLabel') || inst.info.isA.has('TextButton') || inst.info.isA.has('TextBox')) {
        n.t = str(g('Text')); n.tc = col(g('TextColor3')); n.ts = g('TextSize') || 14
        if (g('TextScaled')) n.tsc = 1
        if (g('TextWrapped')) n.tw = 1
        const tt = g('TextTransparency'); if (tt) n.tt = tt
        n.tx = en(g('TextXAlignment')); n.ty = en(g('TextYAlignment'))
        const f = g('Font'); const fn = en(f); if (fn && /Bold|Black/.test(fn)) n.b = 1
        if (fn && /Code|Mono/.test(fn)) n.mono = 1
        if (inst.ClassName === 'TextBox') n.ph = str(g('PlaceholderText'))
      }
      if (inst.info.isA.has('ImageLabel') || inst.info.isA.has('ImageButton')) {
        n.img = str(g('Image')); const it = g('ImageTransparency'); if (it) n.it = it
        n.ic = col(g('ImageColor3'))
      }
      if (inst.ClassName === 'ScrollingFrame') { n.scroll = 1; n.canvas = ud2(g('CanvasSize')) }
      if (inst.info.isA.has('GuiButton') || inst.ClassName === 'TextBox') n.btn = hasConn(inst, CLICK_EVENTS) || inst.ClassName === 'TextBox' ? 1 : 2
    }
    const kids = []
    for (const ch of inst.children) {
      const cg = k => ch.getProp(k)
      switch (ch.ClassName) {
        case 'UICorner': n.cr = ud(cg('CornerRadius')) || [0, 8]; break
        case 'UIStroke': n.st = { c: col(cg('Color')) || [0, 0, 0], th: cg('Thickness') ?? 1, tr: cg('Transparency') || 0, border: en(cg('ApplyStrokeMode')) === 'Border' }; break
        case 'UIPadding': n.pad = [ud(cg('PaddingTop')), ud(cg('PaddingRight')), ud(cg('PaddingBottom')), ud(cg('PaddingLeft'))].map(x => x || [0, 0]); break
        case 'UIListLayout': n.list = { dir: en(cg('FillDirection')) || 'Vertical', pad: ud(cg('Padding')) || [0, 0], ha: en(cg('HorizontalAlignment')) || 'Left', va: en(cg('VerticalAlignment')) || 'Top' }; break
        case 'UIGridLayout': n.grid = { cell: ud2(cg('CellSize')) || [0, 100, 0, 100], pad: ud2(cg('CellPadding')) || [0, 5, 0, 5] }; break
        case 'UIScale': n.scale = cg('Scale') ?? 1; break
        case 'UIGradient': {
          const seq = cg('Color')
          const kp = seq && seq.keypoints
          if (kp && kp.length) n.grad = { a: col(kp[0].value || kp[0].Value), b: col(kp[kp.length - 1].value || kp[kp.length - 1].Value), rot: cg('Rotation') || 0 }
          break
        }
        default:
          if (ch.info.isA.has('GuiObject') || ch.info.isA.has('LayerCollector') || ch.ClassName === 'Folder') { const k = node(ch); if (k) kids.push(k) }
      }
    }
    if (kids.length) n.k = kids
    return n
  }
  for (const inst of rbx.allInstances) {
    if (inst.ClassName !== 'ScreenGui' || inst.destroyed) continue
    let p = inst.parent, ok = false
    while (p) { if (p.ClassName === 'PlayerGui' || p.ClassName === 'CoreGui' || p.ClassName === 'StarterGui') { ok = true; break } p = p.parent }
    if (!ok || inst.getProp('Enabled') === false) continue
    const r = node(inst)
    if (r) { r.order = inst.getProp('DisplayOrder') || 0; roots.push(r) }
  }
  return roots.length ? roots : null
}

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
  for (const inst of vm.rbx.allInstances) {
    if (inst.destroyed || !inst.signals) continue
    if ((inst.info.isA.has('GuiButton') && hasConn(inst, CLICK_EVENTS)) || (inst.ClassName === 'TextBox' && hasConn(inst, ['FocusLost']))) {
      // 表示中の ScreenGui の中にあるものだけ
      for (let p = inst.parent; p; p = p.parent) if (p.ClassName === 'PlayerGui' || p.ClassName === 'CoreGui') return true
    }
  }
  return !!snapshotInteract(vm.rbx)
}

function postGui(force) {
  const vm = currentVM
  if (!vm || !vm.rbx) return
  let gui = null
  try { gui = snapshotGui(vm.rbx) } catch { return }
  const json = gui ? JSON.stringify(gui) : ''
  if (!force && json === lastGui) return
  lastGui = json
  self.postMessage({ type: 'gui', gui })
}

// ---- 画面からの操作 ----
function handleInput(m) {
  const vm = currentVM
  if (!vm || !vm.rbx) return
  const rbx = vm.rbx
  const inst = m.id ? byId.get(m.id) : null
  const player = rbx.player
  const keyInput = (key, state) => {
    const io = rbx.newInstance('InputObject')
    const item = rbx.enums.item('KeyCode', key) || rbx.enums.item('KeyCode', 'Unknown')
    io.props.set('KeyCode', item)
    io.props.set('UserInputType', rbx.enums.item('UserInputType', 'Keyboard'))
    io.props.set('UserInputState', rbx.enums.item('UserInputState', state))
    return io
  }
  try {
    switch (m.kind) {
      case 'gui': {
        if (!inst || inst.destroyed) break
        const io = rbx.newInstance('InputObject')
        io.props.set('UserInputType', rbx.enums.item('UserInputType', 'MouseButton1'))
        inst.fire('MouseButton1Down', [0, 0]); inst.fire('MouseButton1Up', [0, 0]); inst.fire('MouseButton1Click', []); inst.fire('Activated', [io, 1])
        break
      }
      case 'text': {
        if (!inst || inst.destroyed) break
        inst.luaNewIndex('Text', toBytes(String(m.text ?? '')))
        inst.fire('FocusLost', [true])
        break
      }
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
      case 'key': {
        const uis = rbx.getService('UserInputService')
        if (m.key === 'Space') uis.fire('JumpRequest', [])
        uis.fire('InputBegan', [keyInput(m.key, 'Begin'), false])
        vm.sched.setTimer(0.08, () => { uis.fire('InputEnded', [keyInput(m.key, 'End'), false]); vm.sched.checkIdle() })
        break
      }
    }
  } catch (e) {
    flush()
    self.postMessage({ type: 'error', ...errorPayload(e) })
  }
  if (waiting) { waiting = false; self.postMessage({ type: 'resumed' }) }
  vm.sched.checkIdle()
  setTimeout(() => postGui(false), 30)
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
  lastGui = ''
  waiting = false
  ids = new Map(); byId = new Map(); idSeed = 0
  let vm = null
  const hooks = {
    // 終了後に遅れて届いた出力 (通信の応答など) は捨てる
    output: (kind, text) => { if (currentVM === vm) emit(kind, text) },
    onError: e => { if (currentVM !== vm) return; flush(); self.postMessage({ type: 'error', ...errorPayload(e) }) },
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
    chunkName: msg.chunkName,
  }
  vm = createVM(hooks, { timeLimit: opts.timeLimit ?? 10000 })
  currentVM = vm
  const ctx = { sched: vm.sched, hooks, fs: new Map(), fsFolders: new Set(), currentFile: msg.path, runContext: opts.kind || 'module' }
  for (const [p, c] of Object.entries(msg.wsFiles || {})) ctx.fs.set(p, toBytes(c))
  for (const f of msg.wsFolders || []) ctx.fsFolders.add(f)
  try {
    ctx.api = await loadApi()
    if (currentVM !== vm) return
    vm.rbx = installRoblox(vm.env, ctx)
    vm.rbx.mountFiles(msg.files || {}, msg.projectName)
    vm.rbx.setScript(msg.path)
    if (opts.executor) vm.exec = installExecutor(vm.env, ctx, vm.rbx)
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
  guiTimer = setInterval(() => postGui(false), 250)
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
  else if (msg.type === 'input') handleInput(msg)
  else if (msg.type === 'warm') loadApi().then(() => self.postMessage({ type: 'warm' }), () => {})
}
