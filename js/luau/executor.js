// エグゼキューター API (UNC 準拠) のサンドボックス実装
// ファイル関数 (readfile 等) はプロジェクト内の「workspace/」フォルダに読み書きします。
import { LTable, LFunc, LuaError, Coroutine, rt, native, nativeGen, call, callSync, rtError, tostring, typeOf, type, T, EMPTY, index, setindex, getMetatable } from './runtime.js'
import { fromBytes, toBytes } from './lexer.js'
import { V2, C3 } from './rbx-types.js'
import { textWidth, fontKind } from './gui.js'
import { awaitSignal } from './stdlib.js'

const str = v => fromBytes(String(v))

export function installExecutor(G, ctx, rbx) {
  const { hooks, sched } = ctx
  const def = (name, fn, ...aliases) => {
    const f = native(name, fn)
    G.set(name, f)
    for (const a of aliases) G.set(a, f)
    return f
  }
  const defg = (name, fn, ...aliases) => {
    const f = nativeGen(name, fn)
    G.set(name, f)
    for (const a of aliases) G.set(a, f)
    return f
  }
  const lib = name => { let t = G.get(name); if (!(t instanceof LTable)) { t = new LTable(); G.set(name, t) } return t }
  const note = (key, msg) => {
    if (ctx.noted?.has(key)) return
    ;(ctx.noted || (ctx.noted = new Set())).add(key)
    hooks.output('info', msg)
  }

  // ---- 環境 ----
  const renv = new LTable()
  for (const [k, v] of G.hash) renv.set(k, v)
  def('getgenv', () => G)
  def('getrenv', () => renv)
  def('getsenv', () => G)
  def('getreg', () => new LTable())
  def('getgc', () => new LTable())
  def('getinstances', () => LTable.fromArray([...rbx.allInstances]))
  def('getnilinstances', () => LTable.fromArray([...rbx.allInstances].filter(i => !i.parent && i !== rbx.game)))
  def('getscripts', () => LTable.fromArray([...rbx.allInstances].filter(i => i.info.isA.has('LuaSourceContainer'))))
  def('getrunningscripts', () => LTable.fromArray([G.get('script')].filter(Boolean)))
  def('getloadedmodules', () => new LTable())
  def('getcallingscript', () => [G.get('script')])
  def('getscriptclosure', () => native('closure', () => EMPTY), 'getscriptfunction')
  def('getscripthash', A => {
    const s = A[0] && A[0].source !== undefined ? A[0].source : ''
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
    return h.toString(16).padStart(8, '0').repeat(6)
  })
  def('getscriptbytecode', () => '\x1bLuaQ (サンドボックスではバイトコードは取得できません)', 'dumpstring')
  def('identifyexecutor', () => ['ForgeCode Sandbox', '5.0'], 'getexecutorname', 'whatexecutor')
  def('getthreadidentity', () => ctx.identity ?? 8, 'getidentity', 'getthreadcontext')
  def('setthreadidentity', A => { ctx.identity = A[0]; return EMPTY }, 'setidentity', 'setthreadcontext')
  def('checkcaller', () => true)
  def('isrbxactive', () => true, 'isgameactive', 'iswindowactive')
  def('setfpscap', A => { ctx.fpscap = A[0]; return EMPTY })
  def('getfpscap', () => ctx.fpscap || 60)
  def('gethui', () => rbx.getService('CoreGui'), 'get_hidden_gui', 'gethiddengui')
  def('cloneref', A => A[0])
  def('compareinstances', A => A[0] === A[1])
  def('queue_on_teleport', A => { ctx.teleportQueue = A[0]; return EMPTY }, 'queueonteleport')
  def('messagebox', A => { hooks.output('info', `[メッセージボックス] ${str(A[1] || '')}: ${str(A[0] || '')}`); return 1 })
  def('setclipboard', A => {
    hooks.post({ type: 'clipboard', text: fromBytes(tostring(A[0])) })
    return EMPTY
  }, 'toclipboard', 'setrbxclipboard')
  def('getclipboard', () => '')
  def('lz4compress', A => A[0])
  def('lz4decompress', A => A[0])
  def('getcustomasset', A => 'rbxasset://forgecode/' + str(A[0] || ''), 'getsynasset')
  def('gethiddenproperty', A => {
    const inst = A[0]
    if (!(inst && inst.isInstance)) throw rtError('gethiddenproperty: Instance expected')
    return [inst.props.get(A[1]), true]
  }, 'gethiddenprop')
  def('sethiddenproperty', A => {
    if (!(A[0] && A[0].isInstance)) throw rtError('sethiddenproperty: Instance expected')
    A[0].props.set(A[1], A[2]); return true
  }, 'sethiddenprop')
  def('isscriptable', A => {
    const m = A[0] && A[0].info && A[0].info.members.get(A[1])
    return !!m
  })
  def('setscriptable', () => true)
  def('getcallbackvalue', A => [A[0].props.get(A[1])])

  // ---- クロージャ ----
  def('newcclosure', A => {
    const f = A[0]
    if (!(f instanceof LFunc)) throw rtError('newcclosure: function expected')
    const c = nativeGen(f.name, function* (B) { return yield* call(f, B) })
    c.isCClosure = true
    return c
  })
  def('iscclosure', A => A[0] instanceof LFunc && (!A[0].g || A[0].isCClosure === true))
  def('islclosure', A => A[0] instanceof LFunc && ((!!A[0].g && !A[0].isCClosure) || A[0].forceLua === true))
  def('isexecutorclosure', A => A[0] instanceof LFunc && (!!A[0].g || A[0].isCClosure === true || A[0].forceLua === true), 'checkclosure', 'isourclosure', 'is_synapse_function')
  def('clonefunction', A => {
    const f = A[0]
    const c = new LFunc(f.name, f.g, f.n, f.gn)
    c.isCClosure = f.isCClosure
    return c
  })
  const hooked = new Map() // 関数 → 元の実装
  def('hookfunction', A => {
    const target = A[0], hook = A[1]
    if (!(target instanceof LFunc) || !(hook instanceof LFunc)) throw rtError('hookfunction: function expected')
    const orig = new LFunc(target.name, target.g, target.n, target.gn)
    orig.isCClosure = target.isCClosure
    if (!hooked.has(target)) hooked.set(target, { g: target.g, n: target.n, gn: target.gn })
    target.g = hook.g; target.n = hook.n; target.gn = hook.gn
    return orig
  }, 'replaceclosure', 'detour_function', 'hookfunc')
  def('restorefunction', A => {
    const o = hooked.get(A[0])
    if (!o) throw rtError('restorefunction: この関数はフックされていません')
    A[0].g = o.g; A[0].n = o.n; A[0].gn = o.gn
    hooked.delete(A[0])
    return EMPTY
  })
  def('isfunctionhooked', A => hooked.has(A[0]))
  def('newlclosure', A => {
    const f = A[0]
    if (!(f instanceof LFunc)) throw rtError('newlclosure: function expected')
    const c = nativeGen(f.name, function* (B) { return yield* call(f, B) })
    c.isCClosure = false
    c.forceLua = true
    return c
  })

  // ---- メタテーブル ----
  // Instance 共通のメタテーブル (__index / __newindex / __namecall)
  const instMeta = new LTable()
  const origIndex = native('__index', A => A[0].luaIndex(A[1]))
  const origNewIndex = native('__newindex', A => { A[0].luaNewIndex(A[1], A[2]); return EMPTY })
  const origNamecall = nativeGen('__namecall', function* (A) {
    const self = A[0]
    const method = rt.namecallMethod
    if (!method) throw rtError('__namecall: メソッド名がありません')
    const f = self.luaIndex(method)
    return yield* call(f, A)
  })
  instMeta.set('__index', origIndex)
  instMeta.set('__newindex', origNewIndex)
  instMeta.set('__namecall', origNamecall)
  instMeta.set('__tostring', native('__tostring', A => A[0].luaToString()))
  instMeta.set('__metatable', 'The metatable is locked')
  instMeta.readonly = true
  const syncHooks = () => {
    const ni = instMeta.get('__namecall'), ix = instMeta.get('__index'), nx = instMeta.get('__newindex')
    rt.namecallHook = ni !== origNamecall ? ni : null
    rt.indexHook = ix !== origIndex ? ix : null
    rt.newindexHook = nx !== origNewIndex ? nx : null
  }
  const watchMeta = () => {
    // setreadonly(mt, false) 後に mt.__namecall = ... と書き換えた場合も反映
    const origSet = instMeta.set.bind(instMeta)
    instMeta.set = (k, v) => { origSet(k, v); syncHooks() }
  }
  watchMeta()
  def('getrawmetatable', A => {
    const v = A[0]
    if (v && v.isInstance) return instMeta
    if (v instanceof LTable) return [v.mt || undefined]
    return [getMetatable(v) || undefined]
  })
  def('setrawmetatable', A => {
    if (A[0] instanceof LTable) A[0].mt = A[1] || null
    return A[0]
  })
  def('setreadonly', A => { if (A[0] instanceof LTable) A[0].readonly = T(A[1]); return EMPTY })
  def('isreadonly', A => A[0] instanceof LTable && A[0].readonly)
  def('makereadonly', A => { if (A[0] instanceof LTable) A[0].readonly = true; return EMPTY }, 'make_readonly')
  def('makewriteable', A => { if (A[0] instanceof LTable) A[0].readonly = false; return EMPTY }, 'make_writeable')
  def('hookmetamethod', A => {
    const obj = A[0], mm = A[1], hook = A[2]
    if (!(hook instanceof LFunc)) throw rtError('hookmetamethod: function expected')
    const mt = obj && obj.isInstance ? instMeta : obj instanceof LTable ? obj.mt : null
    if (!mt) throw rtError('hookmetamethod: metatable がありません')
    const old = mt.get(mm)
    const ro = mt.readonly
    mt.readonly = false
    mt.set(mm, hook)
    mt.readonly = ro
    if (mt === instMeta) syncHooks()
    return [old]
  })
  def('getnamecallmethod', () => [rt.namecallMethod || undefined])
  def('setnamecallmethod', A => { rt.namecallMethod = A[0]; return EMPTY })

  // ---- シグナル ----
  def('getconnections', A => {
    const sig = A[0]
    if (!sig || sig.luaTypeName !== 'RBXScriptSignal') throw rtError('getconnections: RBXScriptSignal expected')
    return LTable.fromArray(sig.conns.map(c => makeConnInfo(c)))
  })
  function makeConnInfo(c) {
    const t = new LTable()
    t.set('Function', c.fn)
    t.set('Enabled', c.enabled)
    t.set('ForeignState', false)
    t.set('LuaConnection', true)
    t.set('Thread', undefined)
    t.set('Fire', native('Fire', B => { sched.spawn(c.fn, B.slice(1)); return EMPTY }))
    t.set('Defer', native('Defer', B => { sched.defer(new Coroutine(c.fn), B.slice(1)); return EMPTY }))
    t.set('Disconnect', native('Disconnect', () => { c.disconnect(); return EMPTY }))
    t.set('Disable', native('Disable', () => { c.enabled = false; t.set('Enabled', false); return EMPTY }))
    t.set('Enable', native('Enable', () => { c.enabled = true; t.set('Enabled', true); return EMPTY }))
    return t
  }
  def('firesignal', A => { const sig = A[0]; if (sig && sig.fire) sig.fire(A.slice(1)); return EMPTY })
  def('replicatesignal', A => { const sig = A[0]; if (sig && sig.fire) sig.fire(A.slice(1)); return EMPTY })
  def('fireclickdetector', A => {
    const cd = A[0]
    if (!(cd && cd.isInstance)) throw rtError('fireclickdetector: ClickDetector expected')
    cd.fire(A[2] === 'RightMouseClick' ? 'RightMouseClick' : 'MouseClick', [rbx.player])
    return EMPTY
  })
  def('fireproximityprompt', A => {
    const pp = A[0]
    if (!(pp && pp.isInstance)) throw rtError('fireproximityprompt: ProximityPrompt expected')
    pp.fire('PromptButtonHoldBegan', [rbx.player])
    pp.fire('Triggered', [rbx.player])
    pp.fire('TriggerEnded', [rbx.player])
    return EMPTY
  })
  def('firetouchtransmitter', A => callSync(G.get('firetouchinterest'), A))
  def('firetouchinterest', A => {
    const a = A[0], b = A[1], toggle = A[2]
    const ending = toggle === 1 || toggle === true
    if (a && a.isInstance) a.fire(ending ? 'TouchEnded' : 'Touched', [b])
    if (b && b.isInstance) b.fire(ending ? 'TouchEnded' : 'Touched', [a])
    return EMPTY
  })

  // ---- 入力 (模擬) ----
  for (const n of ['mouse1click', 'mouse1press', 'mouse1release', 'mouse2click', 'mouse2press', 'mouse2release', 'mousemoveabs', 'mousemoverel', 'mousescroll', 'keypress', 'keyrelease', 'keyclick']) {
    def(n, () => { note('input', `[サンドボックス] ${n} などの入力操作関数は模擬動作です`); return EMPTY })
  }

  // ---- HTTP ----
  const requestFn = function* (A) {
    const o = A[0]
    if (!(o instanceof LTable)) throw rtError('request: table expected')
    const url = index(o, 'Url'), method = index(o, 'Method') || 'GET', body = index(o, 'Body')
    const headers = {}
    const h = index(o, 'Headers')
    if (h instanceof LTable) for (const [k, v] of h.hash) headers[fromBytes(k)] = fromBytes(String(v))
    const [r] = yield awaitSignal(ctx.httpFetch(url, { method: fromBytes(method), body: body === undefined ? undefined : fromBytes(body), headers }))
    const hdrs = new LTable()
    if (r.headers) r.headers.forEach((v, k) => hdrs.set(toBytes(k), toBytes(v)))
    return LTable.fromObject({ Success: r.ok, StatusCode: r.status, StatusMessage: toBytes(r.statusText || ''), Headers: hdrs, Body: r.body })
  }
  const req = defg('request', requestFn, 'http_request')
  const http = lib('http'); http.set('request', req)
  const syn = lib('syn'); syn.set('request', req)
  syn.set('protect_gui', native('protect_gui', () => EMPTY))
  syn.set('unprotect_gui', native('unprotect_gui', () => EMPTY))
  syn.set('queue_on_teleport', G.get('queue_on_teleport'))
  syn.set('set_thread_identity', G.get('setthreadidentity'))
  syn.set('get_thread_identity', G.get('getthreadidentity'))
  const fluxus = lib('fluxus'); fluxus.set('request', req)
  // game:HttpGet / HttpGetAsync / HttpPost
  const httpGetMethod = nativeGen('HttpGet', function* (A) { return yield* ctx.httpGet(A[1]) })
  const dm = rbx.classInfo('DataModel')
  dm.methods.set('HttpGet', httpGetMethod)
  dm.methods.set('HttpGetAsync', httpGetMethod)
  dm.methods.set('HttpPost', nativeGen('HttpPost', function* (A) {
    const [r] = yield awaitSignal(ctx.httpFetch(A[1], { method: 'POST', body: fromBytes(A[2] || ''), headers: { 'Content-Type': fromBytes(A[3] || 'application/json') } }))
    return [r.body]
  }))
  dm.methods.set('HttpPostAsync', dm.methods.get('HttpPost'))

  // ---- ファイルシステム (プロジェクトの workspace/ フォルダ) ----
  const FS = ctx.fs // Map: path(workspace/ からの相対) → string(バイト列)
  const folders = ctx.fsFolders // Set
  const norm = p => {
    const s = fromBytes(String(p)).replace(/\\/g, '/').replace(/^\.?\//, '')
    if (s.split('/').includes('..')) throw rtError('ファイルパスに ".." は使えません')
    return s.replace(/\/+$/, '')
  }
  const ensureParents = p => {
    const parts = p.split('/')
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'))
  }
  const persist = (op, path, content) => hooks.post({ type: 'fs', op, path, content: content === undefined ? undefined : content })
  def('readfile', A => {
    const p = norm(A[0])
    if (!FS.has(p)) throw rtError(`readfile: ファイル "${p}" がありません (workspace/${p})`)
    return FS.get(p)
  })
  def('writefile', A => {
    const p = norm(A[0])
    const data = typeof A[1] === 'string' ? A[1] : tostring(A[1])
    if (folders.has(p)) throw rtError(`writefile: "${p}" はフォルダです`)
    ensureParents(p)
    FS.set(p, data)
    persist('write', p, data)
    return EMPTY
  })
  def('appendfile', A => {
    const p = norm(A[0])
    const data = (FS.get(p) || '') + (typeof A[1] === 'string' ? A[1] : tostring(A[1]))
    ensureParents(p)
    FS.set(p, data)
    persist('write', p, data)
    return EMPTY
  })
  def('isfile', A => FS.has(norm(A[0])))
  def('isfolder', A => folders.has(norm(A[0])))
  def('makefolder', A => { const p = norm(A[0]); ensureParents(p + '/x'); folders.add(p); persist('mkdir', p); return EMPTY })
  def('delfile', A => {
    const p = norm(A[0])
    if (!FS.has(p)) throw rtError(`delfile: ファイル "${p}" がありません`)
    FS.delete(p); persist('delete', p)
    return EMPTY
  })
  def('delfolder', A => {
    const p = norm(A[0])
    for (const k of [...FS.keys()]) if (k.startsWith(p + '/')) FS.delete(k)
    for (const f of [...folders]) if (f === p || f.startsWith(p + '/')) folders.delete(f)
    persist('rmdir', p)
    return EMPTY
  })
  def('listfiles', A => {
    const p = A[0] === undefined ? '' : norm(A[0])
    const prefix = p ? p + '/' : ''
    const out = new Set()
    for (const k of [...FS.keys(), ...folders]) {
      if (!k.startsWith(prefix) || k === p) continue
      const rest = k.slice(prefix.length)
      out.add(prefix + rest.split('/')[0])
    }
    return LTable.fromArray([...out].sort())
  })
  def('loadfile', A => {
    const p = norm(A[0])
    if (!FS.has(p)) return [undefined, `ファイル "${p}" がありません`]
    return callSync(G.get('loadstring'), [FS.get(p), '@' + p])
  })
  defg('dofile', function* (A) {
    const p = norm(A[0])
    if (!FS.has(p)) throw rtError(`dofile: ファイル "${p}" がありません`)
    const [f, err] = callSync(G.get('loadstring'), [FS.get(p), '@' + p])
    if (!f) throw new LuaError(err, 0)
    return yield* call(f, [])
  })

  // ---- crypt ----
  const crypt = lib('crypt')
  const b64enc = s => btoa(s)
  const b64dec = s => { try { return atob(fromBytes(s).replace(/\s/g, '')) } catch { throw rtError('base64decode: 不正な base64 文字列です') } }
  const fcrypt = (name, fn) => crypt.set(name, native('crypt.' + name, fn))
  fcrypt('base64encode', A => b64enc(A[0] || ''))
  fcrypt('base64decode', A => b64dec(A[0] || ''))
  fcrypt('base64_encode', A => b64enc(A[0] || ''))
  fcrypt('base64_decode', A => b64dec(A[0] || ''))
  const b64 = lib('base64')
  b64.set('encode', crypt.get('base64encode'))
  b64.set('decode', crypt.get('base64decode'))
  G.set('base64_encode', crypt.get('base64encode'))
  G.set('base64_decode', crypt.get('base64decode'))
  fcrypt('generatebytes', A => {
    const n = A[0] || 16
    let s = ''
    for (let i = 0; i < n; i++) s += String.fromCharCode(Math.floor(Math.random() * 256))
    return b64enc(s)
  })
  fcrypt('generatekey', () => {
    let s = ''
    for (let i = 0; i < 32; i++) s += String.fromCharCode(Math.floor(Math.random() * 256))
    return b64enc(s)
  })
  crypt.set('hash', nativeGen('crypt.hash', function* (A) {
    const data = A[0] || ''
    const algo = fromBytes(A[1] || 'sha256').toLowerCase().replace(/^sha(\d)/, 'sha-$1').replace('sha-3-', 'sha3-')
    const name = { 'sha-1': 'SHA-1', 'sha-256': 'SHA-256', 'sha-384': 'SHA-384', 'sha-512': 'SHA-512' }[algo] || 'SHA-256'
    const bytes = new Uint8Array(data.length)
    for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i)
    const [hex] = yield awaitSignal(crypto.subtle.digest(name, bytes).then(buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')))
    return hex
  }))
  fcrypt('encrypt', A => { note('crypt', '[サンドボックス] crypt.encrypt / decrypt は模擬動作です (XOR)'); return [b64enc(xor(A[0] || '', A[1] || 'k')), A[2] || ''] })
  fcrypt('decrypt', A => xor(b64dec(A[0] || ''), A[1] || 'k'))
  function xor(s, k) {
    let o = ''
    for (let i = 0; i < s.length; i++) o += String.fromCharCode(s.charCodeAt(i) ^ k.charCodeAt(i % k.length))
    return o
  }

  // ---- debug ライブラリ拡張 ----
  const dbg = lib('debug')
  const fdbg = (name, fn) => dbg.set(name, native('debug.' + name, fn))
  fdbg('getinfo', A => {
    const f = A[0] instanceof LFunc ? A[0] : undefined
    return LTable.fromObject({
      source: '=' + (ctx.currentFile || 'main'), short_src: ctx.currentFile || 'main', func: f, what: f && f.g ? 'Lua' : 'C',
      currentline: -1, name: f ? f.name || '' : '', nups: 0, numparams: 0, is_vararg: 1,
    })
  })
  fdbg('getconstants', () => new LTable())
  fdbg('getconstant', () => [undefined])
  fdbg('setconstant', () => EMPTY)
  fdbg('getupvalues', () => new LTable())
  fdbg('getupvalue', () => [undefined])
  fdbg('setupvalue', () => EMPTY)
  fdbg('getprotos', () => new LTable())
  fdbg('getproto', () => [undefined])
  fdbg('getstack', () => new LTable())
  fdbg('setstack', () => EMPTY)
  fdbg('getregistry', () => new LTable())
  G.set('getconstants', dbg.get('getconstants'))
  G.set('getupvalues', dbg.get('getupvalues'))
  G.set('getupvalue', dbg.get('getupvalue'))
  G.set('setupvalue', dbg.get('setupvalue'))
  G.set('getinfo', dbg.get('getinfo'))

  // ---- cache ----
  const cache = lib('cache')
  cache.set('invalidate', native('cache.invalidate', () => EMPTY))
  cache.set('iscached', native('cache.iscached', () => true))
  cache.set('replace', native('cache.replace', () => EMPTY))

  // ---- rconsole ----
  def('rconsoleprint', A => { hooks.output('print', str(tostring(A[0])).replace(/@@\w+@@/g, '')); return EMPTY }, 'consoleprint')
  def('rconsoleinfo', A => { hooks.output('info', str(tostring(A[0]))); return EMPTY })
  def('rconsolewarn', A => { hooks.output('warn', str(tostring(A[0]))); return EMPTY })
  def('rconsoleerr', A => { hooks.output('error', str(tostring(A[0]))); return EMPTY })
  def('rconsoleclear', () => { hooks.post({ type: 'clear' }); return EMPTY }, 'consoleclear')
  def('rconsolename', () => EMPTY, 'rconsolesettitle', 'consolesettitle')
  def('rconsolecreate', () => EMPTY, 'consolecreate')
  def('rconsoledestroy', () => EMPTY, 'consoledestroy')
  def('rconsoleinput', () => '', 'consoleinput')

  // ---- WebSocket (実際に接続) ----
  const wsLib = new LTable()
  wsLib.set('connect', nativeGen('WebSocket.connect', function* (A) {
    const url = fromBytes(A[0] || '')
    if (typeof WebSocket === 'undefined') throw rtError('WebSocket はこの環境で使えません')
    if (ctx.net && ctx.net.agent) throw rtError('WebSocket: Claude が実行するときは、安全のため外部と通信しません')
    const ws = new WebSocket(url)
    const onMessage = ctx.makeSignal('OnMessage'), onClose = ctx.makeSignal('OnClose')
    const [ok, err] = yield {
      kind: 'park', setup: wake => {
        ws.onopen = () => wake([true])
        ws.onerror = () => wake([false, 'WebSocket の接続に失敗しました'])
      },
    }
    if (!ok) throw rtError(err)
    ws.onmessage = e => { onMessage.fire([toBytes(String(e.data))]); sched.checkIdle() }
    ws.onclose = () => { onClose.fire(EMPTY); sched.pending--; sched.checkIdle() }
    sched.pending++
    const methods = {
      Send: native('Send', B => { ws.send(fromBytes(B[1] || '')); return EMPTY }),
      Close: native('Close', () => { ws.close(); return EMPTY }),
    }
    return {
      luaTypeName: 'WebSocket', meta: {},
      luaIndex(k) {
        if (k === 'OnMessage') return onMessage
        if (k === 'OnClose') return onClose
        if (methods[k]) return methods[k]
        throw rtError(`${str(k)} is not a valid member of WebSocket`)
      },
      luaNewIndex() { throw rtError('WebSocket cannot be assigned to') },
      luaToString() { return 'WebSocket' },
    }
  }))
  G.set('WebSocket', wsLib)

  // ---- Drawing (ゲーム画面に重ねて描く。変更があれば版を進め、ワーカーが差分を送る) ----
  const drawings = new Set()
  let drawVer = 0
  const DRAW_FONTS = ['Gotham', 'Arial', 'SourceSans', 'Code']
  const DRAW_DEFAULTS = {
    Line: { From: () => V2(0, 0), To: () => V2(0, 0), Thickness: () => 1 },
    Text: { Text: () => '', Size: () => 16, Center: () => false, Outline: () => false, OutlineColor: () => C3(0, 0, 0), Position: () => V2(0, 0), Font: () => 0, TextBounds: () => V2(0, 0) },
    Image: { Data: () => '', Size: () => V2(0, 0), Position: () => V2(0, 0), Rounding: () => 0 },
    Circle: { NumSides: () => 32, Radius: () => 10, Position: () => V2(0, 0), Thickness: () => 1, Filled: () => false },
    Square: { Size: () => V2(0, 0), Position: () => V2(0, 0), Thickness: () => 1, Filled: () => false },
    Quad: { PointA: () => V2(0, 0), PointB: () => V2(0, 0), PointC: () => V2(0, 0), PointD: () => V2(0, 0), Thickness: () => 1, Filled: () => false },
    Triangle: { PointA: () => V2(0, 0), PointB: () => V2(0, 0), PointC: () => V2(0, 0), Thickness: () => 1, Filled: () => false },
  }
  const drawRemove = native('Remove', A => { if (drawings.delete(A[0])) drawVer++; A[0].removed = true; return EMPTY })
  const drawLib = new LTable()
  drawLib.set('new', native('Drawing.new', A => {
    const kind = fromBytes(A[0] || '')
    const defs = DRAW_DEFAULTS[kind]
    if (!defs) throw rtError(`Drawing.new: 不明な種類 "${kind}" (Line, Text, Image, Circle, Square, Quad, Triangle)`)
    const props = new Map([['Visible', false], ['ZIndex', 1], ['Transparency', 1], ['Color', C3(1, 1, 1)]])
    for (const [k, f] of Object.entries(defs)) props.set(k, f())
    const d = {
      luaTypeName: 'Drawing', meta: {}, kind, props, removed: false,
      luaIndex(k) {
        if (k === 'Remove' || k === 'Destroy') return drawRemove
        if (k === '__OBJECT_EXISTS') return !this.removed
        // 文字の大きさ (中央寄せの計算などに使われる)
        if (k === 'TextBounds' && kind === 'Text') {
          const size = props.get('Size') || 16
          const lines = fromBytes(props.get('Text') || '').split('\n')
          const fam = DRAW_FONTS[props.get('Font') | 0] || 'Gotham'
          const font = { kind: fontKind(fam), weight: 400, italic: false, key: 'draw-' + fam }
          return V2(Math.max(0, ...lines.map(l => textWidth(l, size, font))), lines.length * size)
        }
        if (props.has(k)) return props.get(k)
        throw rtError(`${str(k)} is not a valid member of Drawing.${kind}`)
      },
      luaNewIndex(k, v) {
        if (!props.has(k)) throw rtError(`${str(k)} is not a valid member of Drawing.${kind}`)
        if (k === 'TextBounds') throw rtError('TextBounds is read-only')
        if (props.get(k) !== v) { props.set(k, v); drawVer++ }
      },
      luaToString() { return 'Drawing.' + kind },
    }
    drawings.add(d)
    drawVer++
    return d
  }))
  drawLib.set('Fonts', LTable.fromObject({ UI: 0, System: 1, Plex: 2, Monospace: 3 }))
  drawLib.set('clear', native('Drawing.clear', () => { drawings.clear(); drawVer++; return EMPTY }))
  G.set('Drawing', drawLib)
  def('cleardrawcache', () => { for (const d of drawings) d.removed = true; drawings.clear(); drawVer++; return EMPTY })
  def('isrenderobj', A => !!(A[0] && A[0].luaTypeName === 'Drawing'))
  def('getrenderproperty', A => A[0].luaIndex(A[1]))
  def('setrenderproperty', A => { A[0].luaNewIndex(A[1], A[2]); return EMPTY })
  ctx.drawings = drawings

  // ============================================================
  // 追加の UNC / sUNC 関数と拡張ライブラリ
  // ============================================================
  const mock = (key, what) => note(key, `[サンドボックス] ${what} は模擬動作です (実際のエグゼキューターとは結果が異なります)`)
  const allFunctions = () => {
    // スクリプトが定義した関数を環境から集める (getgc / filtergc の模擬)
    const out = [], seen = new Set()
    const visit = (t, d) => {
      if (d > 3 || seen.has(t)) return
      seen.add(t)
      for (const v of t.hash.values()) {
        if (v instanceof LFunc && v.g && !seen.has(v)) { seen.add(v); out.push(v) }
        else if (v instanceof LTable) visit(v, d + 1)
      }
      for (const v of t.arr) {
        if (v instanceof LFunc && v.g && !seen.has(v)) { seen.add(v); out.push(v) }
        else if (v instanceof LTable) visit(v, d + 1)
      }
    }
    visit(G, 0)
    return out
  }
  def('getgc', A => {
    mock('getgc', 'getgc (スクリプトのグローバルから到達できる関数だけを返します)')
    const fns = allFunctions()
    if (T(A[0])) { const tables = []; for (const v of G.hash.values()) if (v instanceof LTable && v !== G) tables.push(v); return LTable.fromArray([...fns, ...tables]) }
    return LTable.fromArray(fns)
  })
  def('filtergc', A => {
    mock('getgc', 'filtergc (スクリプトのグローバルから到達できる関数だけを探します)')
    const kind = fromBytes(A[0] || 'function')
    const opts = A[1] instanceof LTable ? A[1] : new LTable()
    const name = opts.get('Name')
    let list = kind === 'table' ? [...G.hash.values()].filter(v => v instanceof LTable && v !== G) : allFunctions()
    if (typeof name === 'string') list = list.filter(f => f instanceof LFunc && f.name === fromBytes(name))
    const keys = opts.get('Keys')
    if (keys instanceof LTable) list = list.filter(t => t instanceof LTable && keys.arr.every(k => t.get(k) !== undefined))
    if (T(A[2])) return [list[0]]
    return LTable.fromArray(list)
  })
  def('getsenv', A => {
    if (A[0] !== undefined && !(A[0] && A[0].isInstance)) throw rtError('getsenv: LocalScript / ModuleScript expected')
    return G
  })
  def('decompile', A => {
    const sc = A[0]
    if (sc && sc.isInstance && sc.source !== undefined) return toBytes('-- Decompiled with ForgeCode Sandbox\n' + sc.source)
    return toBytes('-- サンドボックスではプロジェクト内のスクリプトだけ decompile できます')
  })
  def('getfunctionhash', A => {
    if (!(A[0] instanceof LFunc)) throw rtError('getfunctionhash: function expected')
    return callSync(G.get('getscripthash'), [{ source: String(A[0].name || 'f') }])
  })
  def('clear_teleport_queue', () => { ctx.teleportQueue = undefined; return EMPTY }, 'clearteleportqueue')
  def('gethwid', () => 'FORGECODE-SANDBOX-0000-0000')
  def('isluau', () => true)
  def('getcallstack', () => new LTable())
  def('saveinstance', () => { hooks.output('info', '[サンドボックス] saveinstance: 実際のエグゼキューターでは workspace フォルダに .rbxl が保存されます'); return EMPTY })
  defg('getobjects', function* (A) {
    const id = A[1] !== undefined ? fromBytes(String(A[1])) : fromBytes(String(A[0] || ''))
    note('getobjects:' + id, `[サンドボックス] GetObjects("${id}"): Roblox のアセット (モデル・UI) はブラウザから読み込めないため、空の Model を返します。Rayfield のように UI をアセットから読み込むライブラリは、プレビューでは表示できません`)
    return LTable.fromArray([rbx.newInstance('Model', undefined, { Name: 'Asset' })])
  })
  dm.methods.set('GetObjects', G.get('getobjects'))
  def('gethiddenproperties', A => {
    if (!(A[0] && A[0].isInstance)) throw rtError('gethiddenproperties: Instance expected')
    return new LTable()
  })
  def('getproperties', A => {
    const inst = A[0]
    if (!(inst && inst.isInstance)) throw rtError('getproperties: Instance expected')
    const t = new LTable()
    for (const [k, v] of inst.props) t.set(k, v)
    t.set('Name', inst.name); t.set('ClassName', inst.ClassName)
    return t
  })
  def('getspecialinfo', A => {
    if (!(A[0] && A[0].isInstance)) throw rtError('getspecialinfo: Instance expected')
    return new LTable()
  })
  def('isnetworkowner', A => {
    if (!(A[0] && A[0].isInstance)) throw rtError('isnetworkowner: BasePart expected')
    return true
  })
  def('getsimulationradius', () => ctx.simRadius ?? 1000)
  def('setsimulationradius', A => { ctx.simRadius = A[0]; return EMPTY })
  // シグナルのフック
  const sigHooks = new Map()
  def('hooksignal', A => {
    const sig = A[0], cb = A[1]
    if (!sig || sig.luaTypeName !== 'RBXScriptSignal') throw rtError('hooksignal: RBXScriptSignal expected')
    if (!(cb instanceof LFunc)) throw rtError('hooksignal: function expected')
    if (!sigHooks.has(sig)) {
      const origFire = sig.fire.bind(sig)
      sigHooks.set(sig, { origFire, cb })
      sig.fire = args => {
        const h = sigHooks.get(sig)
        if (!h) return origFire(args)
        // フックが true を返したら元の接続も呼ぶ
        let pass = false
        try { const r = callSync(h.cb, [new LTable(), ...args]); pass = T(r[0]) } catch (e) { hooks.onError(e) }
        if (pass) origFire(args)
      }
    } else sigHooks.get(sig).cb = cb
    return EMPTY
  })
  def('restoresignal', A => {
    const h = sigHooks.get(A[0])
    if (h) { A[0].fire = h.origFire; sigHooks.delete(A[0]) }
    return EMPTY
  })
  def('issignalhooked', A => sigHooks.has(A[0]))
  def('iskeydown', () => false)
  G.set('base64encode', crypt.get('base64encode'))
  G.set('base64decode', crypt.get('base64decode'))
  // Actor (並列) 系
  def('getactors', () => LTable.fromArray([...rbx.allInstances].filter(i => i.ClassName === 'Actor')))
  def('getactorthreads', () => new LTable())
  def('isparallel', () => false)
  const runCode = function* (A, at) {
    const [f, err] = callSync(G.get('loadstring'), [A[at], '@actor'])
    if (!f) throw new LuaError(err, 0)
    return yield* call(f, A.slice(at + 1))
  }
  defg('run_on_actor', function* (A) { mock('actor', 'run_on_actor / run_on_thread (同じスレッドで実行します)'); return yield* runCode(A, 1) })
  defg('run_on_thread', function* (A) { mock('actor', 'run_on_actor / run_on_thread (同じスレッドで実行します)'); return yield* runCode(A, 1) })
  const channels = new Map()
  def('create_comm_channel', () => {
    const id = channels.size + 1
    const ev = rbx.newInstance('BindableEvent', undefined, { Name: 'CommChannel' + id })
    channels.set(id, ev)
    return [id, ev]
  })
  def('get_comm_channel', A => [channels.get(A[0])])
  // bit ライブラリ (bit32 と同じ実装を別名で)
  const bit32 = G.get('bit32'), bit = lib('bit')
  if (bit32 instanceof LTable) {
    for (const [k, v] of bit32.hash) bit.set(k, v)
    const to32 = n => (Number(n) | 0)
    bit.set('tobit', native('bit.tobit', A => to32(A[0])))
    bit.set('tohex', native('bit.tohex', A => ((Number(A[0]) >>> 0).toString(16).padStart(Math.abs(A[1] ?? 8), '0')).slice(-Math.abs(A[1] ?? 8))))
    bit.set('bswap', native('bit.bswap', A => { const n = Number(A[0]) >>> 0; return (((n & 0xff) << 24) | ((n & 0xff00) << 8) | ((n >>> 8) & 0xff00) | (n >>> 24)) >>> 0 }))
    if (bit32.get('lrotate')) { bit.set('rol', bit32.get('lrotate')); bit.set('ror', bit32.get('rrotate')) }
  }
  // debug の保護なしメタテーブル
  dbg.set('getmetatable', G.get('getrawmetatable'))
  dbg.set('setmetatable', G.get('setrawmetatable'))
  for (const n of ['getconstant', 'setconstant', 'getprotos', 'getproto', 'getstack', 'setstack']) G.set(n, dbg.get(n))
  for (const n of ['getconstants', 'getupvalues', 'getprotos']) {
    const orig = dbg.get(n)
    const f = native('debug.' + n, A => { mock('debug', 'debug.getconstants / getupvalues / getprotos (空のテーブルを返します)'); return orig.n ? orig.n(A) : new LTable() })
    dbg.set(n, f); G.set(n, f)
  }
  // syn / fluxus の互換関数
  syn.set('is_cached', cache.get('iscached'))
  syn.set('cache_invalidate', cache.get('invalidate'))
  syn.set('cache_replace', cache.get('replace'))
  syn.set('is_beta', native('is_beta', () => false))
  syn.set('write_clipboard', G.get('setclipboard'))
  syn.set('crypt', crypt)
  syn.set('websocket', wsLib)
  syn.set('secure_call', nativeGen('secure_call', function* (A) { return yield* call(A[0], A.slice(2)) }))
  fluxus.set('queue_on_teleport', G.get('queue_on_teleport'))
  fluxus.set('set_thread_identity', G.get('setthreadidentity'))

  void type; void typeOf; void setindex
  return { drawings, drawVersion: () => drawVer }
}
