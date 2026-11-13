// Roblox 環境のサンドボックス (Instance / Signal / 各種サービス)
// API ダンプ (data/roblox-api.json) を元に、全クラス・全メンバーを「模擬的に」使えるようにします。
import { LTable, LFunc, LuaError, Coroutine, rt, native, nativeGen, call, callSync, rtError, tostring, fmtNum, typeOf, T, EMPTY, index } from './runtime.js'
import { fromBytes, toBytes, LuauSyntaxError } from './lexer.js'
import { V3, V2, CF, C3, UD, UD2, BC, is, makeEnums, installDatatypes, IDR, nearestBrick, makeRaycastResult } from './rbx-types.js'
import { makeSpatial, project, unproject } from './spatial.js'
import { loadChunk } from './compiler.js'
import * as runtime from './runtime.js'
import { awaitSignal, waitSignal } from './stdlib.js'
import { installGui } from './gui.js'
import { fetchText, fetchOther, shortUrl } from './remote.js'

const str = v => fromBytes(String(v))

export function installRoblox(G, ctx) {
  const { api, sched, hooks } = ctx
  const enums = makeEnums(api.e)
  installDatatypes(G, enums)
  const warned = new Set()
  const sandboxNote = (key, msg) => {
    if (warned.has(key)) return
    warned.add(key)
    hooks.output('info', msg)
  }

  // ============================================================
  // Signal (RBXScriptSignal / RBXScriptConnection)
  // ============================================================
  const connProto = {
    luaTypeName: 'RBXScriptConnection', meta: {},
    luaIndex(k) {
      if (k === 'Connected') return this.connected
      if (k === 'Disconnect' || k === 'disconnect') return disconnectFn
      throw rtError(`${str(k)} is not a valid member of RBXScriptConnection`)
    },
    luaNewIndex(k) { throw rtError(`${str(k)} cannot be assigned to`) },
    luaToString() { return 'Connection' },
    disconnect() {
      this.connected = false
      const i = this.signal.conns.indexOf(this)
      if (i >= 0) this.signal.conns.splice(i, 1)
    },
  }
  const disconnectFn = native('Disconnect', A => { A[0].disconnect(); return EMPTY })
  const connectFn = (once) => native(once ? 'Once' : 'Connect', A => {
    const sig = A[0], f = A[1]
    if (!(f instanceof LFunc)) throw rtError(`Attempt to connect failed: Passed value is not a function`)
    const c = Object.create(connProto)
    c.signal = sig; c.fn = f; c.connected = true; c.once = once; c.enabled = true
    sig.conns.push(c)
    if (sig.onConnect) sig.onConnect()
    return c
  })
  const sigConnect = connectFn(false), sigOnce = connectFn(true)
  const sigWait = nativeGen('Wait', function* (A) {
    const sig = A[0]
    if (!sig || !sig.waiting) throw rtError("Expected ':' not '.' calling member function Wait")
    // RenderStepped:Wait() などフレームのイベントは、待っている間もフレームを進める
    if (sig.onConnect) sig.onConnect()
    const r = yield { kind: 'park', counts: false, setup: wake => sig.waiting.push(wake) }
    return r || EMPTY
  })
  const signalProto = {
    luaTypeName: 'RBXScriptSignal', meta: {},
    luaIndex(k) {
      switch (k) {
        case 'Connect': case 'connect': case 'ConnectParallel': return sigConnect
        case 'Once': return sigOnce
        case 'Wait': case 'wait': return sigWait
      }
      throw rtError(`${str(k)} is not a valid member of RBXScriptSignal`)
    },
    luaNewIndex(k) { throw rtError(`${str(k)} cannot be assigned to`) },
    luaToString() { return 'Signal ' + this.name },
    hasConnections() { return this.conns.length > 0 || this.waiting.length > 0 },
    fire(args) {
      for (const c of this.conns.slice()) {
        if (!c.connected || !c.enabled) continue
        if (c.once) c.disconnect()
        sched.spawn(c.fn, args)
      }
      const w = this.waiting
      if (w.length) {
        this.waiting = []
        for (const wake of w) wake(args)
      }
    },
    fireFrame(dt) {
      if (this.name === 'Stepped') this.fire([sched.now(), dt])
      else this.fire([dt])
    },
  }
  function makeSignal(name, frame) {
    const s = Object.create(signalProto)
    s.name = name; s.conns = []; s.waiting = []
    if (frame) s.onConnect = () => sched.addFrameSignal(s)
    return s
  }
  ctx.makeSignal = makeSignal

  // ============================================================
  // クラス情報
  // ============================================================
  const IMPL = {}      // className → { methods: {name: LFunc}, props: {name: {get, set}}, init(inst) }
  const DEFAULTS = {}  // className → { prop: () => value }
  const classCache = new Map()
  function classInfo(name) {
    let info = classCache.get(name)
    if (info) return info
    const raw = api.c[name]
    if (!raw) return null
    const parent = raw.s ? classInfo(raw.s) : null
    const members = new Map(parent ? parent.members : undefined)
    for (const m of raw.m) members.set(m[1], { kind: m[0], name: m[1], type: m[2], flags: m[3] || '', owner: name })
    const isA = new Set(parent ? parent.isA : undefined)
    isA.add(name)
    const methods = new Map(parent ? parent.methods : undefined)
    const props = new Map(parent ? parent.props : undefined)
    const defaults = new Map(parent ? parent.defaults : undefined)
    const inits = parent ? parent.inits.slice() : []
    const impl = IMPL[name]
    if (impl) {
      for (const [k, f] of Object.entries(impl.methods || {})) methods.set(k, f)
      for (const [k, f] of Object.entries(impl.props || {})) props.set(k, f)
      if (impl.init) inits.push(impl.init)
    }
    for (const [k, f] of Object.entries(DEFAULTS[name] || {})) defaults.set(k, f)
    info = { name, raw, parent, members, isA, methods, props, defaults, inits, tags: raw.t || '', stubCache: new Map() }
    classCache.set(name, info)
    return info
  }

  // 型ごとの既定値
  function typeDefault(type) {
    if (!type) return undefined
    if (type.startsWith('Enum.')) return enums.firstItem(type.slice(5))
    switch (type) {
      case 'bool': return false
      case 'int': case 'int64': case 'float': case 'double': case 'number': return 0
      case 'string': case 'Content': case 'ContentId': case 'BinaryString': case 'ProtectedString': return ''
      case 'Vector3': return V3(0, 0, 0)
      case 'Vector2': return V2(0, 0)
      case 'CFrame': return CF(0, 0, 0)
      case 'Color3': return C3(0, 0, 0)
      case 'BrickColor': return BC(194)
      case 'UDim': return UD(0, 0)
      case 'UDim2': return UD2(0, 0, 0, 0)
      case 'Array': case 'Dictionary': case 'Objects': case 'Instances': case 'Map': return new LTable()
    }
    return undefined
  }

  function returnDefault(sig) {
    const i = sig.lastIndexOf('): ')
    const t = i >= 0 ? sig.slice(i + 3) : 'null'
    if (t === 'null' || t === 'Tuple' || t === 'void') return EMPTY
    const d = typeDefault(t)
    return [d]
  }

  // ============================================================
  // Instance
  // ============================================================
  const allInstances = new Set()
  let gui = null // GUI エンジン (後で設定)
  let debugIdSeed = 1000
  class Instance {
    constructor(info) {
      this.info = info
      this.ClassName = info.name
      this.props = new Map()
      this.children = []
      this.parent = undefined
      this.attrs = new Map()
      this.tags = new Set()
      this.signals = null
      this.propSignals = null
      this.attrSignals = null
      this.childWaiters = null
      this.destroyed = false
      this.parentLocked = false
      this.debugId = ++debugIdSeed
      allInstances.add(this)
    }
    get name() { const n = this.props.get('Name'); return n === undefined ? this.ClassName : n }
    luaToString() { return this.name }
    signal(name) {
      if (!this.signals) this.signals = new Map()
      let s = this.signals.get(name)
      if (!s) {
        s = makeSignal(name, this.info.frameSignals && this.info.frameSignals.has(name))
        this.signals.set(name, s)
        if (name === 'Changed' && gui && gui.isGuiInfo(this.info)) gui.noteWatch(this, 'AbsoluteSize')
      }
      return s
    }
    fire(name, args) {
      const s = this.signals && this.signals.get(name)
      if (s) s.fire(args)
    }
    getProp(k, m) {
      if (this.props.has(k)) return this.props.get(k)
      const d = this.info.defaults.get(k)
      if (d) { const v = d(this); this.props.set(k, v); return v }
      if (m) {
        // Instance 型のプロパティ (workspace.Terrain など) は同名の子を返す
        if (m.type && api.c[m.type]) return this.findChild(k)
        return typeDefault(m.type)
      }
      return undefined
    }
    luaIndex(k) {
      if (k === 'Parent') return this.parent
      const info = this.info
      const pi = info.props.get(k)
      if (pi && pi.get) return pi.get(this)
      const m = info.members.get(k)
      if (m) {
        switch (m.kind) {
          case 'p': return this.getProp(k, m)
          case 'f': return this.method(k, m)
          case 'e': return this.signal(k)
          case 'c': return this.props.get(k)
        }
      }
      const f = info.methods.get(k)
      if (f) return f
      if (this.props.has(k)) return this.props.get(k)
      const child = this.findChild(k)
      if (child) return child
      if (info.fallback) { const v = info.fallback(this, k); if (v !== undefined) return v }
      throw rtError(`${str(k)} is not a valid member of ${this.ClassName} "${this.fullName()}"`)
    }
    method(k, m) {
      const f = this.info.methods.get(k)
      if (f) return f
      let stub = this.info.stubCache.get(k)
      if (!stub) {
        const cls = this.ClassName, sig = m.type
        const ret = returnDefault(sig)
        stub = native(k, () => {
          sandboxNote(cls + ':' + k, `[サンドボックス] ${cls}:${k}() は模擬動作です (実際の処理は行われません)`)
          return ret === EMPTY ? EMPTY : [ret[0] instanceof LTable ? new LTable() : ret[0]]
        })
        this.info.stubCache.set(k, stub)
      }
      return stub
    }
    luaNewIndex(k, v) {
      if (k === 'Parent') { this.setParent(v); return }
      const info = this.info
      const m = info.members.get(k)
      const pi = info.props.get(k)
      if (!m && !pi) throw rtError(`${str(k)} is not a valid member of ${this.ClassName} "${this.fullName()}"`)
      if (m && (m.kind === 'f' || m.kind === 'e')) throw rtError(`${str(k)} is not a valid member of ${this.ClassName} "${this.fullName()}" (関数やイベントには代入できません)`)
      if (m && m.kind === 'c') { this.props.set(k, v); return }
      if (m && m.flags.includes('r') && !(pi && pi.set)) throw rtError(`Unable to assign property ${str(k)}. Property is read only`)
      if (m) v = coerce(m.type, v, k)
      const old = pi && pi.get ? pi.get(this) : this.props.get(k)
      if (pi && pi.set) pi.set(this, v)
      else this.props.set(k, v)
      if (old !== v) this.changed(k)
    }
    changed(k) {
      if (gui && gui.isGuiInfo(this.info)) gui.touch(this, k)
      if (this.signals) {
        const s = this.signals.get('Changed')
        if (s) s.fire(this.info.isA.has('ValueBase') && k === 'Value' ? [this.props.get('Value')] : [k])
      }
      const ps = this.propSignals && this.propSignals.get(k)
      if (ps) ps.fire(EMPTY)
    }
    findChild(name, recursive) {
      for (const c of this.children) if (c.name === name) return c
      if (recursive) for (const c of this.children) { const r = c.findChild(name, true); if (r) return r }
      return undefined
    }
    isDescendantOf(o) {
      for (let p = this.parent; p; p = p.parent) if (p === o) return true
      return false
    }
    fullName() {
      const parts = []
      let p = this
      while (p) {
        if (p.ClassName === 'DataModel') break
        parts.unshift(p.name)
        p = p.parent
      }
      return parts.join('.')
    }
    descendants(out = []) {
      for (const c of this.children) { out.push(c); c.descendants(out) }
      return out
    }
    setParent(v, force) {
      if (v !== undefined && !(v && v.isInstance)) throw rtError(`invalid argument #3 (Instance expected, got ${typeOf(v)})`)
      if (this.parentLocked && !force) throw rtError(`The Parent property of ${this.name} is locked, current parent: NULL, new parent ${v ? v.name : 'NULL'}`)
      if (v === this) throw rtError(`Attempt to set ${this.fullName()} as its own parent`)
      if (v && v.isDescendantOf(this)) throw rtError(`Attempt to set parent of ${this.fullName()} to ${v.fullName()} would result in circular reference`)
      if (this.info.tags.includes('S') && !force && this.parent) throw rtError(`The Parent property of ${this.name} is locked`)
      const old = this.parent
      if (old === v) return
      if (gui && (gui.isGuiInfo(this.info) || this.ClassName === 'Folder' || (v && gui.isGuiInfo(v.info)) || (old && gui.isGuiInfo(old.info)))) gui.touch(this)
      if (old) {
        const descs = [this, ...this.descendants()]
        for (let a = old; a; a = a.parent) for (const d of descs) a.fire('DescendantRemoving', [d])
        const i = old.children.indexOf(this)
        if (i >= 0) old.children.splice(i, 1)
        old.fire('ChildRemoved', [this])
      }
      this.parent = v
      if (v) {
        v.children.push(this)
        v.fire('ChildAdded', [this])
        const descs = [this, ...this.descendants()]
        for (let a = v; a; a = a.parent) {
          if (a.signals && a.signals.get('DescendantAdded')) for (const d of descs) a.fire('DescendantAdded', [d])
        }
        if (v.childWaiters) {
          for (const w of v.childWaiters.slice()) if (w.name === this.name) { v.childWaiters.splice(v.childWaiters.indexOf(w), 1); w.wake([this]) }
        }
      }
      this.fire('AncestryChanged', [this, v])
      for (const d of this.descendants()) d.fire('AncestryChanged', [this, v])
      this.changed('Parent')
    }
    destroy() {
      if (this.destroyed) return
      this.fire('Destroying', EMPTY)
      for (const c of this.children.slice()) c.destroy()
      this.setParent(undefined, true)
      this.parentLocked = true
      this.destroyed = true
      if (this.signals) for (const s of this.signals.values()) { for (const c of s.conns.slice()) c.disconnect() }
      allInstances.delete(this)
    }
    clone() {
      if (this.props.get('Archivable') === false) return undefined
      const c = new Instance(this.info)
      for (const [k, v] of this.props) c.props.set(k, v instanceof LTable ? v : v)
      for (const [k, v] of this.attrs) c.attrs.set(k, v)
      for (const t of this.tags) c.tags.add(t)
      if (this.source !== undefined) { c.source = this.source; c.filePath = this.filePath }
      for (const ch of this.children) {
        const cc = ch.clone()
        if (cc) { cc.parent = c; c.children.push(cc) }
      }
      // PrimaryPart などのオブジェクト参照を複製先に付け替え
      const mapRef = (orig, copy) => {
        for (const [k, v] of copy.props) {
          if (v && v.isInstance && v.isDescendantOf(this)) {
            const path = []
            for (let p = v; p !== this; p = p.parent) path.unshift(p.parent.children.indexOf(p))
            let t = c
            for (const i of path) t = t.children[i]
            copy.props.set(k, t)
          }
        }
        orig.children.forEach((ch, i) => copy.children[i] && mapRef(ch, copy.children[i]))
      }
      mapRef(this, c)
      return c
    }
  }
  Instance.prototype.isInstance = true
  Instance.prototype.luaTypeName = 'Instance'
  Instance.prototype.meta = {}
  ctx.Instance = Instance

  function coerce(type, v, k) {
    if (!type) return v
    const bad = expect => rtError(`invalid argument #3 to '${str(k)}' (${expect} expected, got ${v === undefined ? 'nil' : typeOf(v)})`)
    switch (type) {
      case 'bool': if (typeof v !== 'boolean') throw bad('boolean'); return v
      case 'int': case 'int64': case 'float': case 'double':
        if (typeof v === 'number') return type.startsWith('int') ? Math.trunc(v) : v
        if (typeof v === 'string' && !isNaN(Number(v))) return Number(v)
        throw bad('number')
      case 'string': case 'Content': case 'ContentId':
        if (typeof v === 'string') return v
        if (typeof v === 'number') return fmtNum(v)
        throw bad('string')
    }
    if (type.startsWith('Enum.')) {
      const en = enums.enumTypes.get(type.slice(5))
      if (!en) return v
      if (v && v.luaTypeName === 'EnumItem') {
        if (v.enumType !== en) throw rtError(`invalid argument #3 (${type} expected, got Enum.${v.enumType.name})`)
        return v
      }
      if (typeof v === 'number') { for (const it of en.items.values()) if (it.value === v) return it }
      if (typeof v === 'string') { const it = en.items.get(v); if (it) return it }
      throw rtError(`Invalid value for enum ${type.slice(5)}`)
    }
    if (['Vector3', 'Vector2', 'CFrame', 'Color3', 'UDim2', 'UDim', 'BrickColor', 'NumberRange', 'NumberSequence', 'ColorSequence', 'Rect', 'Font', 'TweenInfo'].includes(type)) {
      if (v === undefined || typeOf(v) !== type) throw bad(type)
      return v
    }
    if (classInfo(type)) {
      if (v !== undefined && !(v && v.isInstance)) throw bad(type)
      return v
    }
    return v
  }

  function newInstance(className, parent, props) {
    const info = classInfo(className)
    if (!info) throw rtError(`Unable to create an Instance of type "${className}"`)
    const inst = new Instance(info)
    for (const init of info.inits) init(inst)
    if (props) for (const [k, v] of Object.entries(props)) inst.props.set(k, v)
    if (parent) inst.setParent(parent, true)
    return inst
  }
  ctx.newInstance = newInstance

  // ============================================================
  // Instance の共通メソッド
  // ============================================================
  const M = (name, fn) => native(name, fn)
  const MG = (name, fn) => nativeGen(name, fn)
  const chkInst = (A, fname) => {
    if (!(A[0] && A[0].isInstance)) throw rtError(`Expected ':' not '.' calling member function ${fname}`)
    return A[0]
  }
  const instanceMethods = {
    FindFirstChild: M('FindFirstChild', A => [chkInst(A, 'FindFirstChild').findChild(A[1], T(A[2]))]),
    FindFirstChildOfClass: M('FindFirstChildOfClass', A => [chkInst(A, 'FindFirstChildOfClass').children.find(c => c.ClassName === A[1])]),
    FindFirstChildWhichIsA: M('FindFirstChildWhichIsA', A => {
      const self = chkInst(A, 'FindFirstChildWhichIsA')
      const list = T(A[2]) ? self.descendants() : self.children
      return [list.find(c => c.info.isA.has(A[1]))]
    }),
    FindFirstAncestor: M('FindFirstAncestor', A => { for (let p = chkInst(A, 'FindFirstAncestor').parent; p; p = p.parent) if (p.name === A[1]) return p; return [undefined] }),
    FindFirstAncestorOfClass: M('FindFirstAncestorOfClass', A => { for (let p = chkInst(A, 'FindFirstAncestorOfClass').parent; p; p = p.parent) if (p.ClassName === A[1]) return p; return [undefined] }),
    FindFirstAncestorWhichIsA: M('FindFirstAncestorWhichIsA', A => { for (let p = chkInst(A, 'FindFirstAncestorWhichIsA').parent; p; p = p.parent) if (p.info.isA.has(A[1])) return p; return [undefined] }),
    FindFirstDescendant: M('FindFirstDescendant', A => [chkInst(A, 'FindFirstDescendant').descendants().find(d => d.name === A[1])]),
    GetChildren: M('GetChildren', A => LTable.fromArray(chkInst(A, 'GetChildren').children.slice())),
    getChildren: M('getChildren', A => LTable.fromArray(chkInst(A, 'getChildren').children.slice())),
    children: M('children', A => LTable.fromArray(chkInst(A, 'children').children.slice())),
    GetDescendants: M('GetDescendants', A => LTable.fromArray(chkInst(A, 'GetDescendants').descendants())),
    IsA: M('IsA', A => chkInst(A, 'IsA').info.isA.has(A[1])),
    isA: M('isA', A => chkInst(A, 'isA').info.isA.has(A[1])),
    IsDescendantOf: M('IsDescendantOf', A => chkInst(A, 'IsDescendantOf').isDescendantOf(A[1])),
    IsAncestorOf: M('IsAncestorOf', A => !!(A[1] && A[1].isInstance && A[1].isDescendantOf(chkInst(A, 'IsAncestorOf')))),
    GetFullName: M('GetFullName', A => chkInst(A, 'GetFullName').fullName()),
    Clone: M('Clone', A => [chkInst(A, 'Clone').clone()]),
    clone: M('clone', A => [chkInst(A, 'clone').clone()]),
    Destroy: M('Destroy', A => { chkInst(A, 'Destroy').destroy(); return EMPTY }),
    destroy: M('destroy', A => { chkInst(A, 'destroy').destroy(); return EMPTY }),
    Remove: M('Remove', A => { chkInst(A, 'Remove').setParent(undefined); return EMPTY }),
    remove: M('remove', A => { chkInst(A, 'remove').setParent(undefined); return EMPTY }),
    ClearAllChildren: M('ClearAllChildren', A => { for (const c of chkInst(A, 'ClearAllChildren').children.slice()) c.destroy(); return EMPTY }),
    GetAttribute: M('GetAttribute', A => [chkInst(A, 'GetAttribute').attrs.get(A[1])]),
    GetAttributes: M('GetAttributes', A => { const t = new LTable(); for (const [k, v] of chkInst(A, 'GetAttributes').attrs) t.set(k, v); return t }),
    SetAttribute: M('SetAttribute', A => {
      const self = chkInst(A, 'SetAttribute'), k = A[1], v = A[2]
      if (typeof k !== 'string') throw rtError('Attribute name must be a string')
      if (v !== undefined && !(['boolean', 'number', 'string'].includes(typeof v) || ['Vector3', 'Vector2', 'Color3', 'CFrame', 'UDim', 'UDim2', 'BrickColor', 'NumberRange', 'NumberSequence', 'ColorSequence', 'Rect', 'Font', 'EnumItem'].includes(typeOf(v)))) {
        throw rtError(`${typeOf(v)} is not a supported attribute type`)
      }
      const old = self.attrs.get(k)
      if (v === undefined) self.attrs.delete(k); else self.attrs.set(k, v)
      if (old !== v) {
        self.fire('AttributeChanged', [k])
        const s = self.attrSignals && self.attrSignals.get(k)
        if (s) s.fire(EMPTY)
      }
      return EMPTY
    }),
    GetAttributeChangedSignal: M('GetAttributeChangedSignal', A => {
      const self = chkInst(A, 'GetAttributeChangedSignal')
      if (!self.attrSignals) self.attrSignals = new Map()
      let s = self.attrSignals.get(A[1])
      if (!s) { s = makeSignal('AttributeChanged'); self.attrSignals.set(A[1], s) }
      return s
    }),
    GetPropertyChangedSignal: M('GetPropertyChangedSignal', A => {
      const self = chkInst(A, 'GetPropertyChangedSignal')
      const m = self.info.members.get(A[1])
      if (!(m && m.kind === 'p') && A[1] !== 'Parent' && !self.info.props.has(A[1])) throw rtError(`${str(A[1])} is not a valid property name.`)
      if (!self.propSignals) self.propSignals = new Map()
      let s = self.propSignals.get(A[1])
      if (!s) { s = makeSignal('Changed'); self.propSignals.set(A[1], s); if (gui) gui.noteWatch(self, A[1]) }
      return s
    }),
    AddTag: M('AddTag', A => { tagAdd(chkInst(A, 'AddTag'), A[1]); return EMPTY }),
    RemoveTag: M('RemoveTag', A => { tagRemove(chkInst(A, 'RemoveTag'), A[1]); return EMPTY }),
    HasTag: M('HasTag', A => chkInst(A, 'HasTag').tags.has(A[1])),
    GetTags: M('GetTags', A => LTable.fromArray([...chkInst(A, 'GetTags').tags])),
    GetDebugId: M('GetDebugId', A => '0_' + chkInst(A, 'GetDebugId').debugId),
    GetActor: M('GetActor', () => [undefined]),
    IsPropertyModified: M('IsPropertyModified', A => chkInst(A, 'IsPropertyModified').props.has(A[1])),
    ResetPropertyToDefault: M('ResetPropertyToDefault', A => { chkInst(A, 'ResetPropertyToDefault').props.delete(A[1]); return EMPTY }),
    WaitForChild: MG('WaitForChild', function* (A) {
      const self = chkInst(A, 'WaitForChild'), name = A[1]
      if (typeof name !== 'string') throw rtError("Argument 1 missing or nil")
      const c = self.findChild(name)
      if (c) return [c]
      const timeout = typeof A[2] === 'number' ? A[2] : undefined
      const r = yield {
        kind: 'park', counts: timeout !== undefined,
        setup: wake => {
          if (!self.childWaiters) self.childWaiters = []
          const w = { name, wake }
          self.childWaiters.push(w)
          if (timeout !== undefined) {
            sched.setTimer(timeout, () => {
              const i = self.childWaiters.indexOf(w)
              if (i >= 0) { self.childWaiters.splice(i, 1); wake([undefined]) }
            })
          } else {
            sched.setTimer(5, () => {
              if (self.childWaiters.includes(w)) hooks.output('warn', `Infinite yield possible on '${self.fullName()}:WaitForChild("${str(name)}")'`)
            })
          }
        },
      }
      return r || [undefined]
    }),
  }
  IMPL.Instance = {
    methods: instanceMethods,
    props: {
      Name: { get: i => i.name, set: (i, v) => i.props.set('Name', v) },
      ClassName: { get: i => i.ClassName },
    },
  }

  // ---- CollectionService のタグ管理 ----
  const tagged = new Map()
  const tagSignals = new Map()
  const tagSignal = (tag, kind) => {
    const key = kind + ':' + tag
    let s = tagSignals.get(key)
    if (!s) { s = makeSignal(kind === 'a' ? 'InstanceAdded' : 'InstanceRemoved'); tagSignals.set(key, s) }
    return s
  }
  function tagAdd(inst, tag) {
    if (inst.tags.has(tag)) return
    inst.tags.add(tag)
    if (!tagged.has(tag)) tagged.set(tag, new Set())
    tagged.get(tag).add(inst)
    const s = tagSignals.get('a:' + tag)
    if (s) s.fire([inst])
  }
  function tagRemove(inst, tag) {
    if (!inst.tags.delete(tag)) return
    const set = tagged.get(tag)
    if (set) set.delete(inst)
    const s = tagSignals.get('r:' + tag)
    if (s) s.fire([inst])
  }

  // ============================================================
  // クラス別の既定値と実装
  // ============================================================
  const rgb = (r, g, b) => C3(r / 255, g / 255, b / 255)
  const D = (cls, defs) => { DEFAULTS[cls] = { ...(DEFAULTS[cls] || {}), ...defs } }
  D('Instance', { Archivable: () => true })
  D('BasePart', {
    Size: () => V3(4, 1, 2), Color: () => rgb(163, 162, 165), BrickColor: () => BC(194), Transparency: () => 0, Reflectance: () => 0,
    Anchored: () => false, CanCollide: () => true, CanTouch: () => true, CanQuery: () => true, Locked: () => false, CastShadow: () => true,
    Material: () => enums.item('Material', 'Plastic'), Massless: () => false, CollisionGroup: () => 'Default',
  })
  D('Part', { Shape: () => enums.item('PartType', 'Block') })
  D('SpawnLocation', { Size: () => V3(12, 1, 12), Anchored: () => true, Duration: () => 10, Enabled: () => true })
  D('Humanoid', {
    Health: () => 100, MaxHealth: () => 100, WalkSpeed: () => 16, JumpPower: () => 50, JumpHeight: () => 7.2, UseJumpPower: () => true,
    HipHeight: () => 2, AutoRotate: () => true, DisplayName: () => '', RigType: () => enums.item('HumanoidRigType', 'R15'),
    DisplayDistanceType: () => enums.item('HumanoidDisplayDistanceType', 'Viewer'), HealthDisplayDistance: () => 100, NameDisplayDistance: () => 100,
    MoveDirection: () => V3(0, 0, 0), FloorMaterial: () => enums.item('Material', 'Plastic'), BreakJointsOnDeath: () => true, RequiresNeck: () => true,
  })
  D('GuiObject', {
    // Instance.new で作ったときの既定値 (Studio で挿入したときとは違い、大きさは 0)
    Visible: () => true, Size: () => UD2(0, 0, 0, 0), Position: () => UD2(0, 0, 0, 0), AnchorPoint: () => V2(0, 0),
    BackgroundColor3: () => rgb(163, 162, 165), BackgroundTransparency: () => 0, BorderColor3: () => rgb(27, 42, 53), BorderSizePixel: () => 1,
    ZIndex: () => 1, LayoutOrder: () => 0, Rotation: () => 0, Active: () => false, ClipsDescendants: () => false,
  })
  const textDefaults = {
    Text: i => i.ClassName === 'TextLabel' ? 'Label' : i.ClassName === 'TextButton' ? 'Button' : '', TextColor3: () => rgb(27, 42, 53), TextSize: () => 14, TextScaled: () => false,
    TextWrapped: () => false, TextTransparency: () => 0, RichText: () => false, Font: () => enums.item('Font', 'Legacy'),
    TextXAlignment: () => enums.item('TextXAlignment', 'Center'), TextYAlignment: () => enums.item('TextYAlignment', 'Center'),
  }
  D('TextLabel', { ...textDefaults })
  D('TextButton', { ...textDefaults, AutoButtonColor: () => true })
  D('TextBox', { ...textDefaults, PlaceholderText: () => '', ClearTextOnFocus: () => true })
  D('LayerCollector', { Enabled: () => true, ResetOnSpawn: () => true })
  D('ScreenGui', { DisplayOrder: () => 0, IgnoreGuiInset: () => false })
  D('Sound', { Volume: () => 0.5, PlaybackSpeed: () => 1, Looped: () => false, Playing: () => false, TimeLength: () => 0, SoundId: () => '' })
  D('Workspace', { Gravity: () => 196.2, FallenPartsDestroyHeight: () => -500, StreamingEnabled: () => false })
  D('Lighting', { ClockTime: () => 14, TimeOfDay: () => '14:00:00', Brightness: () => 2, Ambient: () => rgb(70, 70, 70), OutdoorAmbient: () => rgb(128, 128, 128), GlobalShadows: () => true, FogEnd: () => 100000, GeographicLatitude: () => 0 })
  D('Camera', { FieldOfView: () => 70, ViewportSize: () => V2(1920, 1080), CFrame: () => CF(0, 10, 20), CameraType: () => enums.item('CameraType', 'Custom') })
  D('Players', { MaxPlayers: () => 50, RespawnTime: () => 5, CharacterAutoLoads: () => true })
  D('Player', { DisplayName: () => 'Player1', UserId: () => 1, AccountAge: () => 365, MembershipType: () => enums.item('MembershipType', 'None'), CameraMaxZoomDistance: () => 128, CameraMinZoomDistance: () => 0.5, Neutral: () => true, TeamColor: () => BC(1) })
  D('Model', { WorldPivot: () => CF(0, 0, 0) })
  D('StringValue', { Value: () => '' })
  D('Script', { Enabled: () => true, Disabled: () => false })
  D('LocalScript', { Enabled: () => true, Disabled: () => false })
  D('HttpService', { HttpEnabled: () => true })
  D('Tween', { PlaybackState: () => enums.item('PlaybackState', 'Begin') })
  D('DataModel', { PlaceId: () => 0, GameId: () => 0, JobId: () => '', CreatorId: () => 0, PlaceVersion: () => 0, CreatorType: () => enums.item('CreatorType', 'User') })
  D('PointLight', { Brightness: () => 1, Range: () => 8, Color: () => rgb(255, 255, 255), Enabled: () => true })
  D('Attachment', {})

  // BasePart: Position / Orientation と CFrame の同期
  const deg = Math.PI / 180
  IMPL.BasePart = {
    props: {
      Position: {
        get: i => { const c = i.getProp('CFrame'); return c ? V3(c.x, c.y, c.z) : V3(0, 0, 0) },
        set: (i, v) => { const c = i.getProp('CFrame') || CF(0, 0, 0); i.props.set('CFrame', CF(v.x, v.y, v.z, c.r)); i.changed('CFrame') },
      },
      Orientation: {
        get: i => {
          const c = i.getProp('CFrame') || CF(0, 0, 0)
          const r = c.r
          const a = Math.asin(Math.max(-1, Math.min(1, -r[5]))), b = Math.atan2(r[2], r[8]), cc = Math.atan2(r[3], r[4])
          return V3(a / deg, b / deg, cc / deg)
        },
        set: (i, v) => {
          const c = i.getProp('CFrame') || CF(0, 0, 0)
          const ang = index(index(G, 'CFrame'), 'fromOrientation')
          const rot = callSync(ang, [v.x * deg, v.y * deg, v.z * deg])[0]
          i.props.set('CFrame', CF(c.x, c.y, c.z, rot.r)); i.changed('CFrame')
        },
      },
      BrickColor: { get: i => i.getProp('BrickColor'), set: (i, v) => { i.props.set('BrickColor', v); i.props.set('Color', C3(v.r / 255, v.g / 255, v.b / 255)); i.changed('Color') } },
      Color: { get: i => i.getProp('Color'), set: (i, v) => { i.props.set('Color', v); i.props.set('BrickColor', nearestBrick(v.r * 255, v.g * 255, v.b * 255)) } },
    },
    methods: {
      GetMass: M('GetMass', A => { const s = A[0].getProp('Size'); return s.x * s.y * s.z * 0.7 }),
      GetTouchingParts: M('GetTouchingParts', A => spatial.GetTouchingParts(A)),
      GetConnectedParts: M('GetConnectedParts', () => new LTable()),
      GetRootPart: M('GetRootPart', A => A[0]),
      CanCollideWith: M('CanCollideWith', () => true),
      ApplyImpulse: M('ApplyImpulse', () => EMPTY),
      ApplyAngularImpulse: M('ApplyAngularImpulse', () => EMPTY),
      SetNetworkOwner: M('SetNetworkOwner', () => EMPTY),
      GetNetworkOwner: M('GetNetworkOwner', () => [undefined]),
      BreakJoints: M('BreakJoints', () => EMPTY),
      GetVelocityAtPosition: M('GetVelocityAtPosition', () => V3(0, 0, 0)),
    },
    init: i => { i.props.set('CFrame', CF(0, 0, 0)) },
  }
  const pivotOf = m => {
    const pp = m.props.get('PrimaryPart')
    if (pp) return pp.getProp('CFrame')
    const firstPart = m.descendants().find(d => d.info.isA.has('BasePart'))
    return firstPart ? firstPart.getProp('CFrame') : m.getProp('WorldPivot')
  }
  const moveModel = (m, target) => {
    const cur = pivotOf(m)
    const mul = index(cur, 'Inverse')
    const inv = callSync(mul, [cur])[0]
    const delta = cfMulRaw(target, inv)
    for (const d of m.descendants()) if (d.info.isA.has('BasePart')) d.props.set('CFrame', cfMulRaw(delta, d.getProp('CFrame')))
    m.props.set('WorldPivot', target)
  }
  const cfMulRaw = (a, b) => a.meta.__mul(a, b)
  IMPL.PVInstance = {
    methods: {
      GetPivot: M('GetPivot', A => A[0].info.isA.has('BasePart') ? A[0].getProp('CFrame') : pivotOf(A[0])),
      PivotTo: M('PivotTo', A => {
        if (A[0].info.isA.has('BasePart')) { A[0].props.set('CFrame', A[1]); A[0].changed('CFrame') } else moveModel(A[0], A[1])
        return EMPTY
      }),
    },
  }
  IMPL.Model = {
    methods: {
      MoveTo: M('MoveTo', A => { const c = pivotOf(A[0]); moveModel(A[0], CF(A[1].x, A[1].y, A[1].z, c.r)); return EMPTY }),
      SetPrimaryPartCFrame: M('SetPrimaryPartCFrame', A => { moveModel(A[0], A[1]); return EMPTY }),
      GetPrimaryPartCFrame: M('GetPrimaryPartCFrame', A => pivotOf(A[0])),
      GetBoundingBox: M('GetBoundingBox', A => [pivotOf(A[0]), V3(4, 5, 2)]),
      GetExtentsSize: M('GetExtentsSize', () => V3(4, 5, 2)),
      GetScale: M('GetScale', () => 1),
      ScaleTo: M('ScaleTo', () => EMPTY),
      BreakJoints: M('BreakJoints', () => EMPTY),
      MakeJoints: M('MakeJoints', () => EMPTY),
    },
  }

  // Humanoid
  IMPL.Humanoid = {
    props: {
      Health: {
        get: i => i.getProp('Health'),
        set: (i, v) => {
          const max = i.getProp('MaxHealth')
          const old = i.getProp('Health')
          const nv = Math.max(0, Math.min(max, v))
          i.props.set('Health', nv)
          if (nv !== old) i.fire('HealthChanged', [nv])
          if (nv <= 0 && old > 0) {
            i.fire('Died', EMPTY)
            i.props.set('__state', enums.item('HumanoidStateType', 'Dead'))
          }
        },
      },
    },
    methods: {
      TakeDamage: M('TakeDamage', A => {
        const h = A[0]
        const ff = h.parent && h.parent.children.find(c => c.ClassName === 'ForceField')
        if (!ff) h.luaNewIndex('Health', h.getProp('Health') - (A[1] || 0))
        return EMPTY
      }),
      MoveTo: M('MoveTo', A => {
        const h = A[0]
        sched.setTimer(0.5, () => h.fire('MoveToFinished', [true]))
        return EMPTY
      }),
      Move: M('Move', () => EMPTY),
      ChangeState: M('ChangeState', A => {
        const old = A[0].props.get('__state') || enums.item('HumanoidStateType', 'Running')
        A[0].props.set('__state', A[1])
        A[0].fire('StateChanged', [old, A[1]])
        if (A[1] && A[1].name === 'Jumping') A[0].fire('Jumping', [true])
        return EMPTY
      }),
      GetState: M('GetState', A => A[0].props.get('__state') || enums.item('HumanoidStateType', 'Running')),
      SetStateEnabled: M('SetStateEnabled', () => EMPTY),
      GetStateEnabled: M('GetStateEnabled', () => true),
      EquipTool: M('EquipTool', A => { if (A[1]) A[1].setParent(A[0].parent); return EMPTY }),
      UnequipTools: M('UnequipTools', () => EMPTY),
      LoadAnimation: M('LoadAnimation', A => makeAnimTrack(A[1])),
      GetPlayingAnimationTracks: M('GetPlayingAnimationTracks', () => new LTable()),
      ApplyDescription: M('ApplyDescription', () => EMPTY),
      GetAppliedDescription: M('GetAppliedDescription', () => newInstance('HumanoidDescription')),
      AddAccessory: M('AddAccessory', A => { if (A[1]) A[1].setParent(A[0].parent); return EMPTY }),
      GetAccessories: M('GetAccessories', A => LTable.fromArray(A[0].parent ? A[0].parent.children.filter(c => c.ClassName === 'Accessory') : [])),
      RemoveAccessories: M('RemoveAccessories', () => EMPTY),
      BuildRigFromAttachments: M('BuildRigFromAttachments', () => EMPTY),
      GetLimb: M('GetLimb', () => enums.item('Limb', 'Unknown')),
      GetMoveVelocity: M('GetMoveVelocity', () => V3(0, 0, 0)),
    },
  }
  function makeAnimTrack(anim) {
    const t = newInstance('AnimationTrack')
    t.props.set('Animation', anim)
    t.props.set('Length', 1)
    t.props.set('IsPlaying', false)
    t.props.set('Looped', false)
    t.props.set('Speed', 1)
    return t
  }
  IMPL.Animator = { methods: { LoadAnimation: M('LoadAnimation', A => makeAnimTrack(A[1])), GetPlayingAnimationTracks: M('GetPlayingAnimationTracks', () => new LTable()) } }
  IMPL.AnimationTrack = {
    methods: {
      Play: M('Play', A => { const t = A[0]; t.props.set('IsPlaying', true); if (!t.props.get('Looped')) sched.setTimer(t.props.get('Length') || 1, () => { t.props.set('IsPlaying', false); t.fire('Stopped', EMPTY) }); return EMPTY }),
      Stop: M('Stop', A => { A[0].props.set('IsPlaying', false); A[0].fire('Stopped', EMPTY); return EMPTY }),
      AdjustSpeed: M('AdjustSpeed', A => { A[0].props.set('Speed', A[1] ?? 1); return EMPTY }),
      AdjustWeight: M('AdjustWeight', () => EMPTY),
      GetMarkerReachedSignal: M('GetMarkerReachedSignal', A => A[0].signal('Marker:' + A[1])),
      GetTimeOfKeyframe: M('GetTimeOfKeyframe', () => 0),
    },
  }

  // 値オブジェクト
  for (const [cls, def] of [['IntValue', () => 0], ['NumberValue', () => 0], ['BoolValue', () => false], ['Vector3Value', () => V3(0, 0, 0)], ['CFrameValue', () => CF(0, 0, 0)], ['Color3Value', () => C3(0, 0, 0)], ['BrickColorValue', () => BC(194)]]) {
    D(cls, { Value: def })
  }

  // BindableEvent / RemoteEvent など
  IMPL.BindableEvent = { methods: { Fire: M('Fire', A => { A[0].signal('Event').fire(A.slice(1)); return EMPTY }) } }
  IMPL.BindableFunction = {
    methods: {
      Invoke: MG('Invoke', function* (A) {
        const f = A[0].props.get('OnInvoke')
        if (!(f instanceof LFunc)) {
          const r = yield { kind: 'park', counts: false, setup: () => {} }
          return r
        }
        return yield* call(f, A.slice(1))
      }),
    },
  }
  const localPlayer = () => players && players.props.get('LocalPlayer')
  IMPL.RemoteEvent = {
    methods: {
      FireServer: M('FireServer', A => { A[0].signal('OnServerEvent').fire([localPlayer(), ...A.slice(1)]); return EMPTY }),
      FireClient: M('FireClient', A => { if (!(A[1] && A[1].ClassName === 'Player')) throw rtError('FireClient: player argument must be a Player object'); A[0].signal('OnClientEvent').fire(A.slice(2)); return EMPTY }),
      FireAllClients: M('FireAllClients', A => { A[0].signal('OnClientEvent').fire(A.slice(1)); return EMPTY }),
    },
  }
  IMPL.UnreliableRemoteEvent = IMPL.RemoteEvent
  IMPL.RemoteFunction = {
    methods: {
      InvokeServer: MG('InvokeServer', function* (A) {
        const f = A[0].props.get('OnServerInvoke')
        if (!(f instanceof LFunc)) { yield { kind: 'park', counts: false, setup: () => {} }; return EMPTY }
        return yield* call(f, [localPlayer(), ...A.slice(1)])
      }),
      InvokeClient: MG('InvokeClient', function* (A) {
        const f = A[0].props.get('OnClientInvoke')
        if (!(f instanceof LFunc)) { yield { kind: 'park', counts: false, setup: () => {} }; return EMPTY }
        return yield* call(f, A.slice(2))
      }),
    },
  }

  // ClickDetector / ProximityPrompt / Sound / Tool
  IMPL.Sound = {
    methods: {
      Play: M('Play', A => { A[0].props.set('Playing', true); A[0].props.set('IsPlaying', true); A[0].fire('Played', [A[0].getProp('SoundId')]); return EMPTY }),
      Stop: M('Stop', A => { A[0].props.set('Playing', false); A[0].props.set('IsPlaying', false); A[0].fire('Stopped', [A[0].getProp('SoundId')]); return EMPTY }),
      Pause: M('Pause', A => { A[0].props.set('Playing', false); A[0].fire('Paused', [A[0].getProp('SoundId')]); return EMPTY }),
      Resume: M('Resume', A => { A[0].props.set('Playing', true); A[0].fire('Resumed', [A[0].getProp('SoundId')]); return EMPTY }),
    },
  }

  // ============================================================
  // サービス
  // ============================================================
  let game, workspace, players
  const services = new Map()
  function getService(name, create = true) {
    let s = services.get(name)
    if (s) return s
    const info = classInfo(name)
    if (!info || !info.tags.includes('S')) return undefined
    if (!create) return undefined
    s = newInstance(name)
    services.set(name, s)
    if (game && s !== game) s.setParent(game, true)
    return s
  }
  IMPL.ServiceProvider = {
    methods: {
      GetService: M('GetService', A => {
        const name = A[1]
        if (typeof name !== 'string') throw rtError('Argument 1 missing or nil')
        const s = getService(name)
        if (!s) throw rtError(`'${str(name)}' is not a valid Service name`)
        return s
      }),
      FindService: M('FindService', A => [services.get(A[1])]),
      service: M('service', A => [getService(A[1])]),
      getService: M('getService', A => [getService(A[1])]),
    },
  }
  IMPL.DataModel = {
    props: {
      Workspace: { get: () => workspace },
      workspace: { get: () => workspace },
      lighting: { get: () => services.get('Lighting') },
    },
    methods: {
      IsLoaded: M('IsLoaded', () => true),
      BindToClose: M('BindToClose', () => EMPTY),
      GetObjects: M('GetObjects', () => new LTable()),
      Shutdown: M('Shutdown', () => { hooks.output('info', '[サンドボックス] game:Shutdown() が呼ばれました'); return EMPTY }),
      GetJobsInfo: M('GetJobsInfo', () => new LTable()),
    },
  }

  // RunService
  IMPL.RunService = {
    methods: {
      // エグゼキューターは本物のゲーム内で動くので false
      IsStudio: M('IsStudio', () => ctx.runContext !== 'executor'),
      // スクリプトの種類に合わせる (ModuleScript はどちらからも呼ばれうるので両方 true)
      IsClient: M('IsClient', () => ctx.runContext !== 'server'),
      IsServer: M('IsServer', () => ctx.runContext !== 'client' && ctx.runContext !== 'executor'),
      IsRunning: M('IsRunning', () => true),
      IsRunMode: M('IsRunMode', () => true),
      IsEdit: M('IsEdit', () => false),
      BindToRenderStep: M('BindToRenderStep', A => {
        const rs = A[0], name = A[1], fn = A[3]
        const sig = rs.signal('RenderStepped')
        const c = callSync(sigConnect, [sig, fn])[0]
        if (!rs.renderBinds) rs.renderBinds = new Map()
        rs.renderBinds.set(name, c)
        return EMPTY
      }),
      UnbindFromRenderStep: M('UnbindFromRenderStep', A => {
        const c = A[0].renderBinds && A[0].renderBinds.get(A[1])
        if (c) { c.disconnect(); A[0].renderBinds.delete(A[1]) }
        return EMPTY
      }),
    },
  }

  // TweenService
  const EASE = {
    Linear: t => t,
    Sine: t => 1 - Math.cos(t * Math.PI / 2),
    Quad: t => t * t,
    Cubic: t => t * t * t,
    Quart: t => t ** 4,
    Quint: t => t ** 5,
    Exponential: t => t === 0 ? 0 : Math.pow(2, 10 * (t - 1)),
    Circular: t => 1 - Math.sqrt(1 - t * t),
    Back: t => t * t * (2.70158 * t - 1.70158),
    Elastic: t => t === 0 || t === 1 ? t : -Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.075) * 2 * Math.PI / 0.3),
    Bounce: t => 1 - bounceOut(1 - t),
  }
  function bounceOut(t) {
    if (t < 1 / 2.75) return 7.5625 * t * t
    if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75
    if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375
    return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375
  }
  function ease(style, dir, t) {
    const f = EASE[style] || EASE.Quad
    if (dir === 'In') return f(t)
    if (dir === 'Out') return 1 - f(1 - t)
    return t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2
  }
  function lerpValue(a, b, t) {
    if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t
    const ty = typeOf(a)
    if (ty !== typeOf(b)) return t >= 1 ? b : a
    switch (ty) {
      case 'Vector3': return V3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)
      case 'Vector2': return V2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
      case 'Color3': return C3(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t)
      case 'UDim2': return UD2(a.X.s + (b.X.s - a.X.s) * t, a.X.o + (b.X.o - a.X.o) * t, a.Y.s + (b.Y.s - a.Y.s) * t, a.Y.o + (b.Y.o - a.Y.o) * t)
      case 'UDim': return UD(a.s + (b.s - a.s) * t, a.o + (b.o - a.o) * t)
      case 'CFrame': return callSync(index(a, 'Lerp'), [a, b, t])[0]
    }
    return t >= 1 ? b : a
  }
  IMPL.TweenService = {
    methods: {
      Create: M('Create', A => {
        const inst = A[1], info = A[2], goals = A[3]
        if (!(inst && inst.isInstance)) throw rtError('TweenService:Create no instance provided')
        if (!(goals instanceof LTable)) throw rtError('TweenService:Create property table expected')
        const tw = newInstance('Tween')
        tw.props.set('Instance', inst)
        tw.props.set('TweenInfo', info)
        tw.goals = goals
        return tw
      }),
      GetValue: M('GetValue', A => ease(A[2] ? A[2].name : 'Quad', A[3] ? A[3].name : 'Out', Math.max(0, Math.min(1, A[1])))),
      SmoothDamp: M('SmoothDamp', A => [A[2], A[3]]),
    },
  }
  IMPL.Tween = {
    methods: {
      Play: M('Play', A => {
        const tw = A[0]
        if (tw.running) return EMPTY
        const inst = tw.props.get('Instance'), info = tw.props.get('TweenInfo')
        // 一時停止していた場合は続きから
        if (tw.resume) { tw.running = true; tw.props.set('PlaybackState', enums.item('PlaybackState', 'Playing')); sched.addFrameSignal(tw.resume); return EMPTY }
        const time = info ? info.Time : 1
        const style = info ? info.EasingStyle.name : 'Quad', dir = info ? info.EasingDirection.name : 'Out'
        const repeatCount = info ? info.RepeatCount : 0, reverses = info ? info.Reverses : false, delay = info ? info.DelayTime : 0
        const starts = [], ends = []
        let k
        for (;;) { const r = tw.goals.next(k); if (!r) break; k = r[0]; starts.push([r[0], inst.luaIndex(r[0])]); ends.push(r[1]) }
        // 同じプロパティを動かしている別の Tween は取り消す (Roblox と同じ)
        const owners = inst.tweenOwners || (inst.tweenOwners = new Map())
        for (const [key] of starts) {
          const o = owners.get(key)
          if (o && o !== tw && o.running) cancelTween(o)
          owners.set(key, tw)
        }
        tw.props.set('PlaybackState', enums.item('PlaybackState', 'Playing'))
        let elapsed = -delay, cycle = 0
        const frame = {
          hasConnections: () => tw.running,
          fireFrame: dt => {
            if (!tw.running || inst.destroyed) { tw.running = false; return }
            elapsed += dt
            if (elapsed < 0) return
            const total = time * (reverses ? 2 : 1)
            let p = time <= 0 ? 1 : Math.min(elapsed, total) / time
            if (reverses && p > 1) p = 2 - p
            const e = ease(style, dir, Math.max(0, Math.min(1, p)))
            starts.forEach(([key, a], i) => { try { inst.luaNewIndex(key, lerpValue(a, ends[i], e)) } catch {} })
            if (elapsed >= total) {
              if (repeatCount < 0 || cycle < repeatCount) { cycle++; elapsed = 0; return }
              tw.running = false
              tw.resume = null
              for (const [key] of starts) if (owners.get(key) === tw) owners.delete(key)
              tw.props.set('PlaybackState', enums.item('PlaybackState', 'Completed'))
              tw.fire('Completed', [enums.item('PlaybackState', 'Completed')])
            }
          },
        }
        tw.frame = frame
        tw.running = true
        sched.addFrameSignal(frame)
        return EMPTY
      }),
      Cancel: M('Cancel', A => { cancelTween(A[0]); return EMPTY }),
      Pause: M('Pause', A => {
        const tw = A[0]
        if (!tw.running) return EMPTY
        tw.running = false
        tw.resume = tw.frame
        tw.props.set('PlaybackState', enums.item('PlaybackState', 'Paused'))
        return EMPTY
      }),
    },
  }
  function cancelTween(tw) {
    const was = tw.running || tw.resume
    tw.running = false
    tw.resume = null
    tw.props.set('PlaybackState', enums.item('PlaybackState', 'Cancelled'))
    if (was) tw.fire('Completed', [enums.item('PlaybackState', 'Cancelled')])
  }

  // HttpService
  function toJson(v, depth = 0) {
    if (depth > 100) throw rtError('Cannot encode recursive table')
    if (v === undefined) return null
    if (typeof v === 'string') return fromBytes(v)
    if (typeof v === 'number') { if (!isFinite(v)) throw rtError("Can't convert to JSON"); return v }
    if (typeof v === 'boolean') return v
    if (v instanceof LTable) {
      const n = v.length()
      if (v.hash.size === 0) { const a = []; for (let i = 1; i <= n; i++) a.push(toJson(v.get(i), depth + 1)); return a }
      const o = {}
      for (let i = 1; i <= n; i++) o[String(i)] = toJson(v.get(i), depth + 1)
      for (const [k, val] of v.hash) o[typeof k === 'string' ? fromBytes(k) : fmtNum(k)] = toJson(val, depth + 1)
      return o
    }
    if (v && v.luaTypeName === 'EnumItem') return v.value
    throw rtError(`Cannot encode ${typeOf(v)} to JSON`)
  }
  function fromJson(j) {
    if (j === null) return undefined
    if (typeof j === 'string') return toBytes(j)
    if (Array.isArray(j)) return LTable.fromArray(j.map(fromJson))
    if (typeof j === 'object') { const t = new LTable(); for (const [k, v] of Object.entries(j)) t.set(toBytes(k), fromJson(v)); return t }
    return j
  }
  ctx.toJson = toJson
  ctx.fromJson = fromJson
  // 外部への通信 (取得した中身はキャッシュされ、オフラインでも使えます。remote.js を参照)
  const netLogged = new Set()
  async function httpFetch(url, opts = {}) {
    const u = fromBytes(String(url))
    const method = String(opts.method || 'GET').toUpperCase()
    const plain = method === 'GET' && opts.body === undefined && !(opts.headers && Object.keys(opts.headers).length)
    const proxy = ctx.net && ctx.net.proxy
    // AI が実行するときは外部へ通信しない (取得済みのスクリプトだけ使える)
    const agent = !!(ctx.net && ctx.net.agent)
    if (agent && !plain) return { ok: false, status: 0, statusText: 'blocked', body: '', headers: null, error: true, reason: 'agent', url: u }
    const r = plain ? await fetchText(u, { proxy, cacheOnly: agent }) : await fetchOther(u, { method, body: opts.body, headers: opts.headers })
    return { ok: r.ok, status: r.status, statusText: r.statusText, body: toBytes(r.text || ''), headers: r.headers, error: r.status === 0, reason: r.error, from: r.from, url: r.url }
  }
  ctx.httpFetch = httpFetch
  const netError = (r, what) => {
    const short = shortUrl(r.url)
    if (hooks.post) hooks.post({ type: 'remoteFail', url: r.url, reason: r.reason })
    if (r.reason === 'agent') return rtError(`${what}: AI が実行するときは、安全のため外部と通信しません (${short})。一度取得したスクリプトはキャッシュから使えます`)
    if (r.reason === 'offline') return rtError(`${what}: オフラインのため ${short} を取得できません (一度取得した URL は、オフラインでもキャッシュから使えます)`)
    if (r.reason === 'timeout') return rtError(`${what}: ${short} の取得が時間切れになりました`)
    return rtError(`HttpError: ${short} を読み込めません (ブラウザの制限 CORS で、直接は取得できないサイトです)`)
  }
  const logNet = r => {
    if (netLogged.has(r.url)) return
    netLogged.add(r.url)
    const kb = r.body.length / 1024
    const from = r.from === 'cache' ? ' · キャッシュ' : r.from === 'manual' ? ' · 登録した中身' : r.from === 'proxy' ? ' · 中継' : ''
    hooks.output('net', `↓ ${shortUrl(r.url)} (${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB${from})`)
  }
  ctx.netError = netError
  ctx.logNet = logNet
  const httpGet = function* (url) {
    if (typeof url !== 'string') throw rtError('Argument 1 missing or nil')
    const [r] = yield awaitSignal(httpFetch(url))
    if (r.error) throw netError(r, 'HttpGet')
    if (!r.ok) throw rtError(`HTTP ${r.status} (${r.statusText}): ${shortUrl(r.url)}`)
    logNet(r)
    return [r.body]
  }
  ctx.httpGet = httpGet
  IMPL.HttpService = {
    methods: {
      JSONEncode: M('JSONEncode', A => toBytes(JSON.stringify(toJson(A[1])))),
      JSONDecode: M('JSONDecode', A => {
        try { return [fromJson(JSON.parse(fromBytes(A[1])))] } catch { throw rtError("Can't parse JSON") }
      }),
      GenerateGUID: M('GenerateGUID', A => {
        const g = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16) }).toUpperCase()
        return A[1] === false ? g : '{' + g + '}'
      }),
      UrlEncode: M('UrlEncode', A => toBytes(encodeURIComponent(fromBytes(A[1] || '')))),
      GetAsync: MG('GetAsync', function* (A) { return yield* httpGet(A[1]) }),
      PostAsync: MG('PostAsync', function* (A) {
        const [r] = yield awaitSignal(httpFetch(A[1], { method: 'POST', body: fromBytes(A[2] || ''), headers: { 'Content-Type': 'application/json' } }))
        if (r.error || !r.ok) throw rtError(`HTTP ${r.status} (${r.statusText})`)
        return [r.body]
      }),
      RequestAsync: MG('RequestAsync', function* (A) {
        const o = A[1]
        const url = index(o, 'Url'), method = index(o, 'Method') || 'GET', body = index(o, 'Body')
        const headers = {}
        const h = index(o, 'Headers')
        if (h instanceof LTable) for (const [k, v] of h.hash) headers[fromBytes(k)] = fromBytes(String(v))
        const [r] = yield awaitSignal(httpFetch(url, { method: fromBytes(method), body: body === undefined ? undefined : fromBytes(body), headers }))
        const hdrs = new LTable()
        if (r.headers) r.headers.forEach((v, k) => hdrs.set(toBytes(k), toBytes(v)))
        return LTable.fromObject({ Success: r.ok, StatusCode: r.status, StatusMessage: toBytes(r.statusText || ''), Headers: hdrs, Body: r.body })
      }),
      GetSecret: M('GetSecret', () => { throw rtError('サンドボックスでは Secrets は使えません') }),
    },
  }

  // DataStoreService (メモリ上で動作)
  const stores = new Map()
  const deepCopy = v => v instanceof LTable ? fromJson(toJson(v)) : v
  function getStore(name, ordered) {
    const key = (ordered ? 'o:' : 'd:') + name
    if (!stores.has(key)) stores.set(key, new Map())
    return stores.get(key)
  }
  const dsDelay = { kind: 'park', setup: wake => sched.setTimer(0.02, () => wake()) }
  const dataStoreMethods = {
    GetAsync: MG('GetAsync', function* (A) { yield dsDelay; return [deepCopy(A[0].store.get(A[1]))] }),
    SetAsync: MG('SetAsync', function* (A) { yield dsDelay; A[0].store.set(A[1], deepCopy(A[2])); return EMPTY }),
    UpdateAsync: MG('UpdateAsync', function* (A) {
      yield dsDelay
      const r = yield* call(A[2], [deepCopy(A[0].store.get(A[1]))])
      if (r[0] !== undefined) A[0].store.set(A[1], deepCopy(r[0]))
      return [r[0]]
    }),
    RemoveAsync: MG('RemoveAsync', function* (A) { yield dsDelay; const v = A[0].store.get(A[1]); A[0].store.delete(A[1]); return [v] }),
    IncrementAsync: MG('IncrementAsync', function* (A) { yield dsDelay; const v = (A[0].store.get(A[1]) || 0) + (A[2] ?? 1); A[0].store.set(A[1], v); return v }),
    GetSortedAsync: M('GetSortedAsync', A => {
      const asc = T(A[1]), size = A[2] || 50
      const entries = [...A[0].store.entries()].sort((a, b) => asc ? a[1] - b[1] : b[1] - a[1]).slice(0, size)
      const pages = newInstance('DataStorePages')
      pages.props.set('IsFinished', true)
      pages.page = LTable.fromArray(entries.map(([k, v]) => LTable.fromObject({ key: k, value: v })))
      return pages
    }),
    ListKeysAsync: M('ListKeysAsync', A => {
      const pages = newInstance('DataStoreKeyPages')
      pages.props.set('IsFinished', true)
      pages.page = LTable.fromArray([...A[0].store.keys()].map(k => LTable.fromObject({ KeyName: k })))
      return pages
    }),
  }
  IMPL.GlobalDataStore = { methods: dataStoreMethods }
  IMPL.Pages = {
    methods: {
      GetCurrentPage: M('GetCurrentPage', A => A[0].page || new LTable()),
      AdvanceToNextPageAsync: M('AdvanceToNextPageAsync', A => { A[0].page = new LTable(); return EMPTY }),
    },
  }
  IMPL.DataStoreService = {
    methods: {
      GetDataStore: M('GetDataStore', A => { const d = newInstance('DataStore'); d.props.set('Name', A[1] || 'DataStore'); d.store = getStore(fromBytes(A[1] || '') + ':' + fromBytes(A[2] || 'global')); return d }),
      GetGlobalDataStore: M('GetGlobalDataStore', () => { const d = newInstance('GlobalDataStore'); d.store = getStore('__global'); return d }),
      GetOrderedDataStore: M('GetOrderedDataStore', A => { const d = newInstance('OrderedDataStore'); d.props.set('Name', A[1] || 'OrderedDataStore'); d.store = getStore(fromBytes(A[1] || ''), true); return d }),
      GetRequestBudgetForRequestType: M('GetRequestBudgetForRequestType', () => 100),
    },
  }

  // MessagingService
  const topics = new Map()
  IMPL.MessagingService = {
    methods: {
      PublishAsync: M('PublishAsync', A => {
        const subs = topics.get(A[1]) || []
        const msg = LTable.fromObject({ Data: A[2], Sent: Date.now() / 1000 })
        for (const fn of subs) sched.spawn(fn, [msg])
        return EMPTY
      }),
      SubscribeAsync: M('SubscribeAsync', A => {
        if (!topics.has(A[1])) topics.set(A[1], [])
        topics.get(A[1]).push(A[2])
        const conn = Object.create(connProto)
        conn.signal = { conns: [] }; conn.connected = true
        return conn
      }),
    },
  }

  // CollectionService
  IMPL.CollectionService = {
    methods: {
      AddTag: M('AddTag', A => { tagAdd(A[1], A[2]); return EMPTY }),
      RemoveTag: M('RemoveTag', A => { tagRemove(A[1], A[2]); return EMPTY }),
      HasTag: M('HasTag', A => !!(A[1] && A[1].tags && A[1].tags.has(A[2]))),
      GetTags: M('GetTags', A => LTable.fromArray([...(A[1].tags || [])])),
      GetTagged: M('GetTagged', A => LTable.fromArray([...(tagged.get(A[1]) || [])])),
      GetAllTags: M('GetAllTags', () => LTable.fromArray([...tagged.keys()])),
      GetInstanceAddedSignal: M('GetInstanceAddedSignal', A => tagSignal(A[1], 'a')),
      GetInstanceRemovedSignal: M('GetInstanceRemovedSignal', A => tagSignal(A[1], 'r')),
    },
  }

  // Debris
  IMPL.Debris = {
    methods: {
      AddItem: M('AddItem', A => { const inst = A[1]; sched.setTimer(A[2] ?? 10, () => { if (inst && !inst.destroyed) inst.destroy() }); return EMPTY }),
      addItem: M('addItem', A => { const inst = A[1]; sched.setTimer(A[2] ?? 10, () => { if (inst && !inst.destroyed) inst.destroy() }); return EMPTY }),
    },
  }

  // Lighting
  IMPL.Lighting = {
    methods: {
      GetMinutesAfterMidnight: M('GetMinutesAfterMidnight', A => A[0].getProp('ClockTime') * 60),
      SetMinutesAfterMidnight: M('SetMinutesAfterMidnight', A => { A[0].props.set('ClockTime', (A[1] / 60) % 24); A[0].changed('ClockTime'); return EMPTY }),
      GetSunDirection: M('GetSunDirection', () => V3(0.5, 0.7, 0.5)),
      GetMoonDirection: M('GetMoonDirection', () => V3(-0.5, -0.7, -0.5)),
    },
  }

  // Players / Player
  IMPL.Players = {
    methods: {
      GetPlayers: M('GetPlayers', A => LTable.fromArray(A[0].children.filter(c => c.ClassName === 'Player'))),
      getPlayers: M('getPlayers', A => LTable.fromArray(A[0].children.filter(c => c.ClassName === 'Player'))),
      GetPlayerFromCharacter: M('GetPlayerFromCharacter', A => [A[0].children.find(p => p.ClassName === 'Player' && p.props.get('Character') === A[1])]),
      playerFromCharacter: M('playerFromCharacter', A => [A[0].children.find(p => p.ClassName === 'Player' && p.props.get('Character') === A[1])]),
      GetPlayerByUserId: M('GetPlayerByUserId', A => [A[0].children.find(p => p.ClassName === 'Player' && p.getProp('UserId') === A[1])]),
      GetNameFromUserIdAsync: M('GetNameFromUserIdAsync', A => A[1] === 1 ? 'Player1' : 'Player' + A[1]),
      GetUserIdFromNameAsync: M('GetUserIdFromNameAsync', () => 1),
      GetUserThumbnailAsync: M('GetUserThumbnailAsync', A => [`rbxthumb://type=AvatarHeadShot&id=${A[1]}&w=150&h=150`, true]),
      GetFriendsAsync: M('GetFriendsAsync', () => { const p = newInstance('FriendPages'); p.props.set('IsFinished', true); p.page = new LTable(); return p }),
      GetHumanoidDescriptionFromUserId: M('GetHumanoidDescriptionFromUserId', () => newInstance('HumanoidDescription')),
      GetHumanoidDescriptionFromUserIdAsync: M('GetHumanoidDescriptionFromUserIdAsync', () => newInstance('HumanoidDescription')),
      Chat: M('Chat', A => { hooks.output('print', `[チャット] Player1: ${str(A[1])}`); return EMPTY }),
    },
    props: {
      LocalPlayer: { get: i => {
        // 本物の Roblox と同じく、サーバースクリプトでは nil
        if (ctx.runContext === 'server') {
          if (!ctx.warnedLocalPlayer) { ctx.warnedLocalPlayer = true; hooks.output('warn', 'サーバースクリプト (.server.luau) では Players.LocalPlayer は nil です。PlayerAdded などでプレイヤーを受け取ってください') }
          return undefined
        }
        return i.props.get('LocalPlayer')
      } },
      NumPlayers: { get: i => i.children.filter(c => c.ClassName === 'Player').length },
    },
  }
  // マウス: Hit / Target / UnitRay はカメラから画面の点を通るレイで計算
  const mouseRay = m => {
    const cam = workspace && workspace.props.get('CurrentCamera')
    if (!cam) return null
    return { cam, ...unproject(cam, m.props.get('X') || 0, m.props.get('Y') || 0, 1000, 58) }
  }
  const mouseCast = m => {
    const r = mouseRay(m)
    if (!r) return null
    const tf = m.props.get('TargetFilter')
    const hit = spatial.castRay(r.o, r.d, tf && tf.info ? [tf] : [])
    return { r, hit }
  }
  const MOUSE_IMPL = {
    props: {
      Hit: { get: m => { const c = mouseCast(m); if (!c) return m.props.get('Hit'); const p = c.hit ? c.hit.pos : V3(c.r.o.x + c.r.d.x, c.r.o.y + c.r.d.y, c.r.o.z + c.r.d.z); return CF(p.x, p.y, p.z, c.r.cam.getProp('CFrame').r) } },
      Target: { get: m => { const c = mouseCast(m); return c && c.hit ? c.hit.part : undefined } },
      UnitRay: { get: m => { const r = mouseRay(m); const o = r ? r.o : V3(0, 10, 20), d = r ? V3(r.d.x / 1000, r.d.y / 1000, r.d.z / 1000) : V3(0, 0, -1); return callSync(index(index(G, 'Ray'), 'new'), [o, d])[0] } },
      Origin: { get: m => { const cam = workspace && workspace.props.get('CurrentCamera'); return cam ? cam.getProp('CFrame') : m.props.get('Origin') } },
    },
  }
  IMPL.PlayerMouse = MOUSE_IMPL
  IMPL.Mouse = MOUSE_IMPL
  IMPL.Player = {
    methods: {
      Kick: M('Kick', A => { hooks.output('warn', `[キック] ${A[0].name} がゲームから退出させられました${A[1] ? ': ' + str(A[1]) : ''}`); return EMPTY }),
      GetMouse: M('GetMouse', A => {
        if (!A[0].mouse) {
          const m = newInstance(classInfo('PlayerMouse') ? 'PlayerMouse' : 'Mouse')
          const sc = gui ? gui.screen : { w: 1280, h: 720 }
          m.props.set('Hit', CF(0, 0, -50)); m.props.set('X', Math.round(sc.w / 2)); m.props.set('Y', Math.round(sc.h / 2))
          m.props.set('ViewSizeX', sc.w); m.props.set('ViewSizeY', sc.h); m.props.set('Origin', CF(0, 10, 20))
          m.props.set('Icon', ''); m.props.set('TargetFilter', undefined)
          A[0].mouse = m
        }
        return A[0].mouse
      }),
      IsInGroup: M('IsInGroup', () => false),
      GetRankInGroup: M('GetRankInGroup', () => 0),
      GetRoleInGroup: M('GetRoleInGroup', () => 'Guest'),
      IsFriendsWith: M('IsFriendsWith', () => false),
      HasAppearanceLoaded: M('HasAppearanceLoaded', () => true),
      LoadCharacter: M('LoadCharacter', A => { spawnCharacter(A[0]); return EMPTY }),
      DistanceFromCharacter: M('DistanceFromCharacter', A => {
        const ch = A[0].props.get('Character'), hrp = ch && ch.findChild('HumanoidRootPart')
        if (!hrp) return 0
        const c = hrp.getProp('CFrame'), p = A[1]
        return Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z)
      }),
      GetJoinData: M('GetJoinData', () => new LTable()),
      GetNetworkPing: M('GetNetworkPing', () => 0.05),
      GetFriendsOnline: M('GetFriendsOnline', () => new LTable()),
      ClearCharacterAppearance: M('ClearCharacterAppearance', () => EMPTY),
    },
    props: { Character: { get: i => i.props.get('Character'), set: (i, v) => i.props.set('Character', v) } },
  }
  // レイキャスト・範囲内のパーツ (パーツの位置と大きさから計算)
  const spatial = makeSpatial({ getWorkspace: () => workspace, enums, makeResult: makeRaycastResult })
  const one = v => (Array.isArray(v) ? v : [v])
  const SP = name => M(name, A => one(spatial[name](A)))
  IMPL.Workspace = {
    methods: {
      Raycast: SP('Raycast'),
      Spherecast: SP('Spherecast'),
      Blockcast: SP('Blockcast'),
      Shapecast: M('Shapecast', () => [undefined]),
      FindPartOnRay: SP('FindPartOnRay'),
      FindPartOnRayWithIgnoreList: SP('FindPartOnRayWithIgnoreList'),
      FindPartOnRayWithWhitelist: SP('FindPartOnRayWithWhitelist'),
      GetPartBoundsInBox: SP('GetPartBoundsInBox'),
      GetPartBoundsInRadius: SP('GetPartBoundsInRadius'),
      GetPartsInPart: SP('GetPartsInPart'),
      FindPartsInRegion3: SP('FindPartsInRegion3'),
      GetServerTimeNow: M('GetServerTimeNow', () => Date.now() / 1000),
      GetRealPhysicsFPS: M('GetRealPhysicsFPS', () => 60),
    },
    props: {
      CurrentCamera: { get: i => i.props.get('CurrentCamera'), set: (i, v) => i.props.set('CurrentCamera', v) },
      DistributedGameTime: { get: () => sched.now() },
    },
  }
  IMPL.Camera = {
    methods: {
      // 3D の位置 → 画面の位置 (カメラの CFrame・視野角・画面の大きさから計算)
      WorldToScreenPoint: M('WorldToScreenPoint', A => project(A[0], A[1] || V3(0, 0, 0), 58)),
      WorldToViewportPoint: M('WorldToViewportPoint', A => project(A[0], A[1] || V3(0, 0, 0), 0)),
      ScreenPointToRay: M('ScreenPointToRay', A => { const r = unproject(A[0], A[1] || 0, A[2] || 0, A[3] || 1, 58); return callSync(index(index(G, 'Ray'), 'new'), [r.o, r.d]) }),
      ViewportPointToRay: M('ViewportPointToRay', A => { const r = unproject(A[0], A[1] || 0, A[2] || 0, A[3] || 1, 0); return callSync(index(index(G, 'Ray'), 'new'), [r.o, r.d]) }),
      GetPartsObscuringTarget: M('GetPartsObscuringTarget', () => new LTable()),
    },
  }
  IMPL.UserInputService = {
    methods: {
      IsKeyDown: M('IsKeyDown', () => false),
      IsMouseButtonPressed: M('IsMouseButtonPressed', () => false),
      GetKeysPressed: M('GetKeysPressed', () => new LTable()),
      GetMouseLocation: M('GetMouseLocation', () => V2(960, 540)),
      GetMouseDelta: M('GetMouseDelta', () => V2(0, 0)),
      GetLastInputType: M('GetLastInputType', () => enums.item('UserInputType', hooks.touch ? 'Touch' : 'Keyboard')),
      GetFocusedTextBox: M('GetFocusedTextBox', () => [undefined]),
      GetGamepadConnected: M('GetGamepadConnected', () => false),
      GetConnectedGamepads: M('GetConnectedGamepads', () => new LTable()),
      GetStringForKeyCode: M('GetStringForKeyCode', A => A[1] ? A[1].name : ''),
      GetPlatform: M('GetPlatform', () => enums.item('Platform', hooks.touch ? (hooks.device === 'tablet' ? 'IOS' : 'Android') : 'Windows') || enums.item('Platform', 'Windows')),
      GetDeviceType: M('GetDeviceType', () => enums.item('DeviceType', hooks.device === 'phone' ? 'Phone' : hooks.device === 'tablet' ? 'Tablet' : 'Desktop') || EMPTY),
    },
  }
  D('UserInputService', {
    TouchEnabled: () => !!hooks.touch, KeyboardEnabled: () => !hooks.touch, MouseEnabled: () => !hooks.touch, GamepadEnabled: () => false,
    MouseBehavior: () => enums.item('MouseBehavior', 'Default'), MouseIconEnabled: () => true,
  })
  IMPL.ContextActionService = {
    methods: {
      BindAction: M('BindAction', A => { (A[0].binds || (A[0].binds = new Map())).set(A[1], A[2]); return EMPTY }),
      BindActionAtPriority: M('BindActionAtPriority', A => { (A[0].binds || (A[0].binds = new Map())).set(A[1], A[2]); return EMPTY }),
      UnbindAction: M('UnbindAction', A => { if (A[0].binds) A[0].binds.delete(A[1]); return EMPTY }),
      UnbindAllActions: M('UnbindAllActions', A => { if (A[0].binds) A[0].binds.clear(); return EMPTY }),
      SetTitle: M('SetTitle', () => EMPTY), SetImage: M('SetImage', () => EMPTY), SetPosition: M('SetPosition', () => EMPTY),
      GetButton: M('GetButton', () => [undefined]),
    },
  }
  IMPL.StarterGui = {
    methods: {
      SetCore: M('SetCore', A => {
        if (A[1] === 'SendNotification' && A[2] instanceof LTable) {
          hooks.output('info', `[通知] ${str(A[2].get('Title') || '')}: ${str(A[2].get('Text') || '')}`)
        } else if (A[1] === 'ChatMakeSystemMessage' && A[2] instanceof LTable) {
          hooks.output('print', `[システム] ${str(A[2].get('Text') || '')}`)
        }
        return EMPTY
      }),
      GetCore: M('GetCore', () => [undefined]),
      SetCoreGuiEnabled: M('SetCoreGuiEnabled', () => EMPTY),
      GetCoreGuiEnabled: M('GetCoreGuiEnabled', () => true),
    },
  }
  IMPL.MarketplaceService = {
    methods: {
      PromptPurchase: M('PromptPurchase', A => { hooks.output('info', `[購入] アセット ${A[2]} の購入画面 (模擬)`); return EMPTY }),
      PromptProductPurchase: M('PromptProductPurchase', A => { hooks.output('info', `[購入] 開発者製品 ${A[2]} の購入画面 (模擬)`); return EMPTY }),
      PromptGamePassPurchase: M('PromptGamePassPurchase', A => { hooks.output('info', `[購入] ゲームパス ${A[2]} の購入画面 (模擬)`); return EMPTY }),
      UserOwnsGamePassAsync: M('UserOwnsGamePassAsync', () => false),
      PlayerOwnsAsset: M('PlayerOwnsAsset', () => false),
      GetProductInfo: M('GetProductInfo', A => LTable.fromObject({ Name: 'Product ' + A[1], Description: '', PriceInRobux: 0, AssetId: A[1], IsForSale: true })),
    },
  }
  IMPL.TeleportService = {
    methods: {
      Teleport: M('Teleport', A => { hooks.output('info', `[テレポート] PlaceId ${A[1]} へ移動 (サンドボックスでは何もしません)`); return EMPTY }),
      TeleportAsync: M('TeleportAsync', A => { hooks.output('info', `[テレポート] PlaceId ${A[1]} へ移動 (模擬)`); return EMPTY }),
      TeleportToPlaceInstance: M('TeleportToPlaceInstance', A => { hooks.output('info', `[テレポート] PlaceId ${A[1]} (サーバー ${str(A[2] || '')}) へ移動 (模擬)`); return EMPTY }),
      GetLocalPlayerTeleportData: M('GetLocalPlayerTeleportData', () => [undefined]),
    },
  }
  IMPL.PathfindingService = {
    methods: {
      CreatePath: M('CreatePath', () => newInstance('Path')),
      ComputeRawPathAsync: M('ComputeRawPathAsync', () => newInstance('Path')),
    },
  }
  IMPL.Path = {
    methods: {
      ComputeAsync: M('ComputeAsync', A => { A[0].wp = [A[1], A[2]]; A[0].props.set('Status', enums.item('PathStatus', 'Success')); return EMPTY }),
      GetWaypoints: M('GetWaypoints', A => {
        const ctor = index(index(G, 'PathWaypoint'), 'new')
        return LTable.fromArray((A[0].wp || []).map(p => callSync(ctor, [p])[0]))
      }),
      CheckOcclusionAsync: M('CheckOcclusionAsync', () => -1),
    },
  }
  IMPL.TextService = {
    methods: {
      GetTextSize: M('GetTextSize', A => V2(fromBytes(A[1] || '').length * (A[2] || 14) * 0.5, A[2] || 14)),
      FilterStringAsync: M('FilterStringAsync', A => {
        const r = newInstance('TextFilterResult')
        r.text = A[1]
        return r
      }),
    },
  }
  IMPL.TextFilterResult = {
    methods: {
      GetNonChatStringForBroadcastAsync: M('GetNonChatStringForBroadcastAsync', A => A[0].text),
      GetNonChatStringForUserAsync: M('GetNonChatStringForUserAsync', A => A[0].text),
      GetChatForUserAsync: M('GetChatForUserAsync', A => A[0].text),
    },
  }
  IMPL.TextChannel = {
    methods: {
      SendAsync: M('SendAsync', A => { hooks.output('print', `[チャット] Player1: ${str(A[1])}`); return EMPTY }),
      DisplaySystemMessage: M('DisplaySystemMessage', A => { hooks.output('print', `[システム] ${str(A[1])}`); return EMPTY }),
    },
  }
  IMPL.Chat = {
    methods: { Chat: M('Chat', A => { hooks.output('print', `[チャット] ${A[1] && A[1].name}: ${str(A[2] || '')}`); return EMPTY }) },
  }
  IMPL.Teams = { methods: { GetTeams: M('GetTeams', A => LTable.fromArray(A[0].children.filter(c => c.ClassName === 'Team'))) } }
  IMPL.Team = { methods: { GetPlayers: M('GetPlayers', A => LTable.fromArray(players.children.filter(p => p.ClassName === 'Player' && p.props.get('Team') === A[0]))) } }
  IMPL.BadgeService = { methods: { AwardBadge: M('AwardBadge', A => { hooks.output('info', `[バッジ] バッジ ${A[2]} を授与 (模擬)`); return true }), UserHasBadgeAsync: M('UserHasBadgeAsync', () => false) } }
  IMPL.GroupService = { methods: { GetGroupInfoAsync: M('GetGroupInfoAsync', A => LTable.fromObject({ Name: 'Group ' + A[1], Id: A[1] })), GetGroupsAsync: M('GetGroupsAsync', () => new LTable()) } }
  IMPL.LocalizationService = { methods: { GetCountryRegionForPlayerAsync: M('GetCountryRegionForPlayerAsync', () => 'JP') } }
  D('LocalizationService', { RobloxLocaleId: () => 'ja-jp', SystemLocaleId: () => 'ja-jp' })
  IMPL.SoundService = { methods: { PlayLocalSound: M('PlayLocalSound', () => EMPTY) } }
  // Stats (パフォーマンス表示を作るスクリプト向け: それらしい値を返す)
  IMPL.StatsItem = {
    methods: {
      GetValue: M('GetValue', A => (typeof A[0].statValue === 'function' ? A[0].statValue() : 0)),
      GetValueString: M('GetValueString', A => { const v = typeof A[0].statValue === 'function' ? A[0].statValue() : 0; return toBytes(`${Math.round(v * 100) / 100}`) }),
    },
  }
  IMPL.Stats = {
    methods: {
      GetTotalMemoryUsageMb: M('GetTotalMemoryUsageMb', () => 420 + Math.round(Math.random() * 20)),
      GetMemoryUsageMbForTag: M('GetMemoryUsageMbForTag', () => 32),
    },
    init(st) {
      const item = (parent, name, fn) => { const i = newInstance('StatsItem', undefined, { Name: name }); i.statValue = fn; i.setParent(parent, true); return i }
      const net = item(st, 'Network', () => 0)
      const ssi = item(net, 'ServerStatsItem', () => 0)
      item(ssi, 'Data Ping', () => 45 + Math.random() * 10)
      item(ssi, 'Data Send Kbps', () => 2 + Math.random())
      item(ssi, 'Data Receive Kbps', () => 8 + Math.random() * 2)
      const perf = item(st, 'PerformanceStats', () => 0)
      item(perf, 'Ping', () => 45 + Math.random() * 10)
      item(perf, 'CPU', () => 6 + Math.random())
      item(perf, 'Memory', () => 420)
      const ws = item(st, 'Workspace', () => 0)
      item(ws, 'FPS', () => 60)
      item(ws, 'Heartbeat', () => 60)
    },
  }
  D('Stats', { FrameTime: () => 1 / 60, HeartbeatTimeMs: () => 1.2, InstanceCount: () => allInstances.size, DataReceiveKbps: () => 8, DataSendKbps: () => 2, PhysicsStepTimeMs: () => 0.5 })
  IMPL.GuiService = { methods: { GetGuiInset: M('GetGuiInset', () => [V2(0, 58), V2(0, 0)]), IsTenFootInterface: M('IsTenFootInterface', () => false) } }
  IMPL.ProximityPrompt = { methods: { InputHoldBegin: M('InputHoldBegin', () => EMPTY), InputHoldEnd: M('InputHoldEnd', A => { A[0].fire('Triggered', [localPlayer()]); return EMPTY }) } }
  IMPL.ModuleScript = {}

  // GUI エンジン (レイアウト計算・入力・描画データ)
  gui = installGui({ IMPL, D, enums, sched, hooks, ctx, newInstance, getService, localPlayer, G, camera: () => workspace && workspace.props.get('CurrentCamera') })
  ctx.gui = gui

  // ============================================================
  // ゲームツリーの構築
  // ============================================================
  game = newInstance('DataModel')
  game.props.set('Name', 'Game')
  services.set('DataModel', game)
  // DataModel の存在しない子名にサービス名が来たら自動作成
  classInfo('DataModel').fallback = (inst, k) => {
    const s = getService(k)
    return s
  }
  workspace = getService('Workspace')
  workspace.props.set('Name', 'Workspace')
  for (const s of ['Players', 'Lighting', 'ReplicatedFirst', 'ReplicatedStorage', 'ServerScriptService', 'ServerStorage', 'StarterGui', 'StarterPack', 'StarterPlayer', 'Teams', 'SoundService', 'Chat', 'TextChatService', 'LocalizationService', 'TestService', 'RunService', 'UserInputService', 'TweenService', 'HttpService', 'CoreGui']) {
    getService(s)
  }
  players = services.get('Players')
  const sp = services.get('StarterPlayer')
  newInstance('StarterPlayerScripts', sp)
  newInstance('StarterCharacterScripts', sp)
  const tcs = services.get('TextChatService')
  const channels = newInstance('Folder', tcs, { Name: 'TextChannels' })
  newInstance('TextChannel', channels, { Name: 'RBXGeneral' })
  newInstance('TextChannel', channels, { Name: 'RBXSystem' })
  const terrain = newInstance('Terrain', workspace, { Name: 'Terrain' })
  void terrain
  const camera = newInstance('Camera', workspace, { Name: 'Camera' })
  workspace.props.set('CurrentCamera', camera)
  const baseplate = newInstance('Part', workspace, { Name: 'Baseplate', Size: V3(2048, 16, 2048), Anchored: true, Color: rgb(91, 93, 105), Locked: true })
  baseplate.props.set('CFrame', CF(0, -8, 0))
  const spawn = newInstance('SpawnLocation', workspace, { Name: 'SpawnLocation' })
  spawn.props.set('CFrame', CF(0, 0.5, 0))

  // ローカルプレイヤーとキャラクター
  const player = newInstance('Player', undefined, { Name: 'Player1' })
  newInstance('Backpack', player, { Name: 'Backpack' })
  const pgui = newInstance('PlayerGui', player, { Name: 'PlayerGui' })
  void pgui
  const pscripts = newInstance('PlayerScripts', player, { Name: 'PlayerScripts' })
  void pscripts
  newInstance('StarterGear', player, { Name: 'StarterGear' })
  player.setParent(players, true)
  players.props.set('LocalPlayer', player)

  function spawnCharacter(plr) {
    const old = plr.props.get('Character')
    if (old) old.destroy()
    const ch = newInstance('Model', undefined, { Name: plr.name })
    const part = (name, size, y) => {
      const p = newInstance(name === 'HumanoidRootPart' ? 'Part' : 'MeshPart', ch, { Name: name, Size: size, Color: rgb(234, 184, 146) })
      p.props.set('CFrame', CF(0, y, 0))
      return p
    }
    const hrp = part('HumanoidRootPart', V3(2, 2, 1), 3)
    hrp.props.set('Transparency', 1)
    const head = part('Head', V3(1.2, 1.2, 1.2), 4.5)
    newInstance('Decal', head, { Name: 'face' })
    part('UpperTorso', V3(2, 1.6, 1), 3.2)
    part('LowerTorso', V3(2, 0.4, 1), 2.2)
    for (const s of ['Left', 'Right']) {
      part(s + 'UpperArm', V3(1, 1.2, 1), 3.4); part(s + 'LowerArm', V3(1, 1.2, 1), 2.4); part(s + 'Hand', V3(1, 0.3, 1), 1.8)
      part(s + 'UpperLeg', V3(1, 1.2, 1), 1.6); part(s + 'LowerLeg', V3(1, 1.2, 1), 0.8); part(s + 'Foot', V3(1, 0.3, 1), 0.2)
    }
    const hum = newInstance('Humanoid', ch, { Name: 'Humanoid', DisplayName: plr.getProp('DisplayName') })
    newInstance('Animator', hum, { Name: 'Animator' })
    newInstance('HumanoidDescription', hum, { Name: 'HumanoidDescription' })
    ch.props.set('PrimaryPart', hrp)
    ch.setParent(workspace, true)
    plr.props.set('Character', ch)
    return ch
  }
  const character = spawnCharacter(player)
  void character

  // 開始後に PlayerAdded / CharacterAdded を発火 (サーバースクリプトの動作確認用)
  sched.pending++
  sched.setTimer(0.15, () => {
    sched.pending--
    players.fire('PlayerAdded', [player])
    sched.pending++
    sched.setTimer(0.1, () => {
      sched.pending--
      const ch = player.props.get('Character')
      if (ch) player.fire('CharacterAdded', [ch])
      sched.checkIdle()
    })
    sched.checkIdle()
  })

  // RunService のフレームイベント
  classInfo('RunService').frameSignals = new Set(['Heartbeat', 'RenderStepped', 'Stepped', 'PreRender', 'PreAnimation', 'PreSimulation', 'PostSimulation'])

  // ============================================================
  // グローバル
  // ============================================================
  G.set('game', game)
  G.set('Game', game)
  G.set('workspace', workspace)
  G.set('Workspace', workspace)
  G.set('shared', new LTable())
  const instanceLib = new LTable()
  instanceLib.set('new', native('Instance.new', A => {
    const cls = A[0]
    if (typeof cls !== 'string') throw rtError('invalid argument #1 to \'new\' (string expected)')
    const info = classInfo(cls)
    if (!info || info.tags.includes('N') || info.tags.includes('S')) throw rtError(`Unable to create an Instance of type "${str(cls)}"`)
    const inst = newInstance(cls)
    if (A[1] !== undefined) inst.setParent(A[1])
    return inst
  }))
  instanceLib.set('fromExisting', native('Instance.fromExisting', A => {
    const c = A[0].clone()
    for (const ch of c.children.slice()) ch.destroy()
    return c
  }))
  instanceLib.readonly = true
  G.set('Instance', instanceLib)
  G.set('settings', native('settings', () => getService('GlobalSettings') || newInstance('GlobalSettings')))
  G.set('UserSettings', native('UserSettings', () => newInstance('UserSettings')))
  G.set('version', native('version', () => api.v))
  G.set('printidentity', native('printidentity', A => { hooks.output('print', `${A[0] ? str(A[0]) + ' ' : 'Current identity is '}2`); return EMPTY }))
  G.set('stats', native('stats', () => getService('Stats')))
  G.set('ypcall', G.get('pcall'))
  G.set('PluginManager', native('PluginManager', () => [undefined]))
  G.set('plugin', undefined)

  // ============================================================
  // プロジェクトのファイルを ModuleScript として配置 + require
  // ============================================================
  const fileInst = new Map()
  const moduleCache = new Map()
  function mountFiles(files, projectName) {
    const root = newInstance('Folder', undefined, { Name: projectName || 'Project' })
    const folders = new Map([['', root]])
    const getFolder = dir => {
      if (folders.has(dir)) return folders.get(dir)
      const i = dir.lastIndexOf('/')
      const parent = getFolder(i < 0 ? '' : dir.slice(0, i))
      const f = newInstance('Folder', parent, { Name: dir.slice(i + 1) })
      folders.set(dir, f)
      return f
    }
    for (const [path, source] of Object.entries(files)) {
      if (!/\.(lua|luau)$/i.test(path)) continue
      const i = path.lastIndexOf('/')
      const dir = i < 0 ? '' : path.slice(0, i)
      const base = path.slice(i + 1)
      let cls = 'ModuleScript'
      let name = base.replace(/\.(lua|luau)$/i, '')
      if (/\.server$/i.test(name)) { cls = 'Script'; name = name.replace(/\.server$/i, '') }
      else if (/\.client$/i.test(name)) { cls = 'LocalScript'; name = name.replace(/\.client$/i, '') }
      const inst = newInstance(cls, getFolder(dir), { Name: name })
      inst.source = source
      inst.filePath = path
      inst.props.set('Source', toBytes(source))
      fileInst.set(path, inst)
    }
    root.setParent(services.get('ReplicatedStorage'), true)
    return root
  }
  function resolvePath(spec, fromPath) {
    const s = fromBytes(spec)
    const baseDir = fromPath && fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : ''
    let parts = (s.startsWith('./') || s.startsWith('../') ? (baseDir ? baseDir.split('/') : []) : []).concat(s.split('/'))
    const out = []
    for (const p of parts) {
      if (p === '.' || p === '') continue
      if (p === '..') out.pop()
      else out.push(p)
    }
    const p = out.join('/')
    for (const cand of [p, p + '.luau', p + '.lua', p + '/init.luau', p + '/init.lua']) if (fileInst.has(cand)) return fileInst.get(cand)
    return null
  }
  const requireFn = nativeGen('require', function* (A) {
    let target = A[0]
    if (typeof target === 'number') throw rtError('サンドボックスではアセット ID (数値) の require は使えません。モジュールのファイルを開いて直接実行してください')
    if (typeof target === 'string') {
      const r = resolvePath(target, ctx.currentFile)
      if (!r) throw rtError(`モジュール "${str(target)}" が見つかりません (プロジェクト内の .lua / .luau ファイルを指定してください)`)
      target = r
    }
    if (!(target && target.isInstance)) throw rtError('Attempted to call require with invalid argument(s).')
    if (target.ClassName !== 'ModuleScript') throw rtError('Attempted to call require with a non-ModuleScript')
    const cached = moduleCache.get(target)
    if (cached) {
      if (cached.loading) throw rtError('Requested module was required recursively')
      return [cached.value]
    }
    const src = target.source !== undefined ? target.source : fromBytes(target.props.get('Source') || '')
    const entry = { loading: true }
    moduleCache.set(target, entry)
    let f
    try {
      f = loadChunk(src, target.filePath || target.fullName(), G, runtime)
    } catch (e) {
      moduleCache.delete(target)
      if (e instanceof LuauSyntaxError) throw new LuaError(`${target.filePath || target.fullName()}:${e.line}: ${e.message}`, 0)
      throw e
    }
    const prevFile = ctx.currentFile
    ctx.currentFile = target.filePath
    let r
    try {
      r = yield* call(f, [])
    } catch (e) {
      moduleCache.delete(target)
      throw e
    } finally {
      ctx.currentFile = prevFile
    }
    if (r.length !== 1) { moduleCache.delete(target); throw rtError('Module code did not return exactly one value') }
    entry.loading = false
    entry.value = r[0]
    return [r[0]]
  })
  G.set('require', requireFn)

  return {
    game, workspace, players, player, enums, classInfo, newInstance, getService, allInstances, makeSignal,
    mountFiles, fileInst, tagged, Instance,
    setScript(path) {
      const inst = fileInst.get(path)
      ctx.currentFile = path
      G.set('script', inst)
      return inst
    },
  }
}

void waitSignal; void Coroutine; void tostring; void IDR
