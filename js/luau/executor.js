// エグゼキューター API (UNC 準拠) のサンドボックス実装
// ファイル関数 (readfile 等) はプロジェクト内の「workspace/」フォルダに読み書きします。
import { LTable, LFunc, LuaError, Coroutine, rt, native, nativeGen, call, callSync, rtError, tostring, typeOf, type, T, EMPTY, index, setindex, getMetatable } from './runtime.js'
import { fromBytes, toBytes } from './lexer.js'
import { V2, C3 } from './rbx-types.js'
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
  def('identifyexecutor', () => ['ForgeCode Sandbox', '4.0'], 'getexecutorname')
  def('getthreadidentity', () => ctx.identity ?? 8, 'getidentity', 'getthreadcontext')
  def('setthreadidentity', A => { ctx.identity = A[0]; return EMPTY }, 'setidentity', 'setthreadcontext')
  def('checkcaller', () => true)
  def('isrbxactive', () => true, 'isgameactive')
  def('setfpscap', A => { ctx.fpscap = A[0]; return EMPTY })
  def('getfpscap', () => ctx.fpscap || 60)
  def('gethui', () => rbx.getService('CoreGui'))
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
  })
  def('sethiddenproperty', A => { A[0].props.set(A[1], A[2]); return true })
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
  def('islclosure', A => A[0] instanceof LFunc && !!A[0].g && !A[0].isCClosure)
  def('isexecutorclosure', A => A[0] instanceof LFunc && !!A[0].g, 'checkclosure', 'isourclosure')
  def('clonefunction', A => {
    const f = A[0]
    const c = new LFunc(f.name, f.g, f.n, f.gn)
    c.isCClosure = f.isCClosure
    return c
  })
  def('hookfunction', A => {
    const target = A[0], hook = A[1]
    if (!(target instanceof LFunc) || !(hook instanceof LFunc)) throw rtError('hookfunction: function expected')
    const orig = new LFunc(target.name, target.g, target.n, target.gn)
    target.g = hook.g; target.n = hook.n; target.gn = hook.gn
    return orig
  }, 'replaceclosure', 'detour_function')
  def('restorefunction', () => EMPTY)
  def('isfunctionhooked', () => false)

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
  def('makereadonly', A => { if (A[0] instanceof LTable) A[0].readonly = true; return EMPTY })
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

  // ---- Drawing (プレビュー用に描画命令を記録) ----
  const drawings = new Set()
  const DRAW_DEFAULTS = {
    Line: { From: () => V2(0, 0), To: () => V2(0, 0), Thickness: () => 1 },
    Text: { Text: () => '', Size: () => 16, Center: () => false, Outline: () => false, OutlineColor: () => C3(0, 0, 0), Position: () => V2(0, 0), Font: () => 0, TextBounds: () => V2(0, 0) },
    Image: { Data: () => '', Size: () => V2(0, 0), Position: () => V2(0, 0), Rounding: () => 0 },
    Circle: { NumSides: () => 32, Radius: () => 10, Position: () => V2(0, 0), Thickness: () => 1, Filled: () => false },
    Square: { Size: () => V2(0, 0), Position: () => V2(0, 0), Thickness: () => 1, Filled: () => false },
    Quad: { PointA: () => V2(0, 0), PointB: () => V2(0, 0), PointC: () => V2(0, 0), PointD: () => V2(0, 0), Thickness: () => 1, Filled: () => false },
    Triangle: { PointA: () => V2(0, 0), PointB: () => V2(0, 0), PointC: () => V2(0, 0), Thickness: () => 1, Filled: () => false },
  }
  const drawRemove = native('Remove', A => { drawings.delete(A[0]); A[0].removed = true; return EMPTY })
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
        if (props.has(k)) return props.get(k)
        throw rtError(`${str(k)} is not a valid member of Drawing.${kind}`)
      },
      luaNewIndex(k, v) {
        if (!props.has(k)) throw rtError(`${str(k)} is not a valid member of Drawing.${kind}`)
        props.set(k, v)
      },
      luaToString() { return 'Drawing.' + kind },
    }
    drawings.add(d)
    return d
  }))
  drawLib.set('Fonts', LTable.fromObject({ UI: 0, System: 1, Plex: 2, Monospace: 3 }))
  drawLib.set('clear', native('Drawing.clear', () => { drawings.clear(); return EMPTY }))
  G.set('Drawing', drawLib)
  def('cleardrawcache', () => { for (const d of drawings) d.removed = true; drawings.clear(); return EMPTY })
  def('isrenderobj', A => !!(A[0] && A[0].luaTypeName === 'Drawing'))
  def('getrenderproperty', A => A[0].luaIndex(A[1]))
  def('setrenderproperty', A => { A[0].luaNewIndex(A[1], A[2]); return EMPTY })
  ctx.drawings = drawings

  void type; void typeOf; void setindex
  return { drawings }
}
