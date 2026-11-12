// 外部ライブラリ (loadstring(game:HttpGet(url))()) の API を、ソースから読み取る
//  ・返すテーブル (Library) と、そのメソッドが返すもの (Window → Tab → Groupbox …) を追いかけます
//  ・引数のテーブルに書けるキー (Text = / Default = / Callback = …) を、関数の中での使われ方や
//    テンプレート (Library:Validate(Info, Templates.Toggle) など) から集めます
//  ・関数の直前のコメントを説明として使います
// 結果は JSON にできる形 (shapes の配列) なので、そのまま保存・再利用できます。
import { parse } from '../luau/parser.js'
import { fromBytes } from '../luau/lexer.js'

const MAX_SHAPES = 4000

export function analyzeLibrary(src) {
  const ast = parse(src, { comments: true })
  const shapes = []          // { f: Map(name → member), idx: Set, inh: Set }
  const newShape = () => { if (shapes.length >= MAX_SHAPES) return null; const s = { id: shapes.length, f: new Map(), idx: new Set(), inh: new Set() }; shapes.push(s); return s }
  // ---- 説明コメント (行番号 → テキスト) ----
  const docByEnd = new Map()
  for (const c of ast.comments || []) {
    const text = c.text
    const end = c.line + (text.match(/\n/g) || []).length
    const clean = text.replace(/^--\[(=*)\[([\s\S]*?)\]\1\]$/, '$2').replace(/^---?\s?/, '').replace(/^\s*\/\/\s*/, '').trim()
    if (clean && !/^[-=*#/\\|]+$/.test(clean)) docByEnd.set(end, (docByEnd.has(end) ? docByEnd.get(end) + '\n' : '') + clean)
  }
  const docAt = line => {
    const parts = []
    for (let l = line - 1; docByEnd.has(l) && parts.length < 6; l--) parts.unshift(docByEnd.get(l))
    const d = parts.join('\n').trim()
    return d ? d.slice(0, 400) : ''
  }

  // ---- 値 ----
  // { s: shape } | { fn: desc } | { p: 'string'|'number'|'boolean', v } | { param: i, fn: desc } | null
  const memberOf = (sh, key, seen = new Set()) => {
    if (!sh || seen.has(sh)) return null
    seen.add(sh)
    if (sh.f.has(key)) return sh.f.get(key)
    for (const id of sh.inh) { const m = memberOf(shapes[id], key, seen); if (m) return m }
    return null
  }
  const setMember = (sh, key, val, line) => {
    if (!sh || typeof key !== 'string' || !/^[A-Za-z_]\w*$/.test(key)) return
    const old = sh.f.get(key)
    // 既にわかっている値を「不明」で上書きしない
    if (old && old.val && !val) return
    if (old && old.val && old.val.fn && val && !val.fn) return
    sh.f.set(key, { val, line })
  }
  const link = (t, mt) => {
    if (!t || !t.s || !mt || !mt.s) return
    const idx = memberOf(mt.s, '__index')
    const base = idx && idx.val && idx.val.s ? idx.val.s : mt.s
    if (base !== t.s) t.s.inh.add(base.id)
  }

  // ---- スコープ ----
  const globals = new Map()
  const lookup = (scope, name) => {
    for (let s = scope; s; s = s.up) if (s.vars.has(name)) return s.vars.get(name)
    return globals.has(name) ? globals.get(name) : null
  }
  const assignName = (scope, name, val) => {
    for (let s = scope; s; s = s.up) {
      if (s.vars.has(name)) {
        const cur = s.vars.get(name)
        // 引数を上書きしても「引数」として扱い続ける (Info = Info or {} など)
        if (cur && cur.param !== undefined && (!val || !val.s)) return
        if (!val && cur) return
        s.vars.set(name, val)
        return
      }
    }
    if (val || !globals.has(name)) globals.set(name, val)
  }
  const child = up => ({ vars: new Map(), up })

  // ---- 関数 ----
  const keyOf = k => (k && k.t === 'String' ? fromBytes(k.v) : null)
  function funcDesc(fnode, scope, selfVal) {
    const desc = { params: fnode.params.map(p => p.name), method: !!fnode.isMethod, vararg: !!fnode.isVararg, line: fnode.line, doc: docAt(fnode.line), ret: null, rets: null, opts: new Map(), tpl: new Map(), types: fnode.params.map(p => p.type) }
    const sc = child(scope)
    fnode.params.forEach((p, i) => sc.vars.set(p.name, { param: i, fn: desc }))
    if (fnode.isMethod) sc.vars.set('self', selfVal || null)
    const save = depth
    depth = 0
    desc.depth = 0
    try { walk(fnode.body, sc, desc) } finally { depth = save }
    return desc
  }
  const noteKey = (pv, key, val) => {
    if (!pv || pv.param === undefined || !key) return
    let keys = pv.fn.opts.get(pv.param)
    if (!keys) pv.fn.opts.set(pv.param, keys = new Map())
    if (!keys.has(key)) keys.set(key, val || null)
    else if (val && !keys.get(key)) keys.set(key, val)
  }

  // ---- 式の評価 ----
  function ev(e, scope, fn) {
    if (!e) return null
    switch (e.t) {
      case 'String': return { p: 'string', v: fromBytes(e.v) }
      case 'Number': return { p: 'number', v: e.v }
      case 'True': return { p: 'boolean', v: true }
      case 'False': return { p: 'boolean', v: false }
      case 'Interp': return { p: 'string' }
      case 'Paren': case 'Cast': return ev(e.e, scope, fn)
      case 'Name': return lookup(scope, e.name)
      case 'Func': return { fn: funcDesc(e, scope, null) }
      case 'Table': {
        const sh = newShape()
        if (!sh) return null
        for (const it of e.items) {
          const key = it.k === 'named' ? it.key : it.k === 'expr' ? keyOf(it.key) : null
          const val = ev(it.value, scope, fn)
          if (key) setMember(sh, key, val, it.line || e.line)
        }
        return { s: sh }
      }
      case 'Bin': {
        if (e.op === 'or') return ev(e.l, scope, fn) || ev(e.r, scope, fn)
        if (e.op === 'and') { ev(e.l, scope, fn); return ev(e.r, scope, fn) }
        ev(e.l, scope, fn); ev(e.r, scope, fn)
        if (e.op === '..') return { p: 'string' }
        if (['==', '~=', '<', '>', '<=', '>='].includes(e.op)) return { p: 'boolean' }
        return { p: 'number' }
      }
      case 'Un': { ev(e.e, scope, fn); return e.op === 'not' ? { p: 'boolean' } : e.op === '#' || e.op === '-' ? { p: 'number' } : null }
      case 'IfExpr': { let r = null; for (const c of e.clauses) { const v = ev(c.val, scope, fn); r = r || v } return ev(e.orelse, scope, fn) || r }
      case 'Index': {
        const o = ev(e.obj, scope, fn)
        const key = keyOf(e.key)
        if (!key) ev(e.key, scope, fn)
        if (o && o.param !== undefined && key) { noteKey(o, key, null); return null }
        if (o && o.s && key) { const m = memberOf(o.s, key); return m ? m.val : null }
        if (o && o.s && !key && o.s.idx.size) return { s: shapes[[...o.s.idx][0]] }
        return null
      }
      case 'Call': {
        const args = e.args.map(a => ev(a, scope, fn))
        if (e.fn.t === 'Name' && e.fn.name === 'setmetatable') { link(args[0], args[1]); return args[0] }
        if (e.fn.t === 'Name' && (e.fn.name === 'rawset') && args[0] && args[0].s) { const k = keyOf(e.args[1]); if (k) setMember(args[0].s, k, args[2], e.line); return args[0] }
        noteTemplate(args, e.fn.t === 'Name' ? e.fn.name : e.fn.t === 'Index' ? keyOf(e.fn.key) : null)
        const f = ev(e.fn, scope, fn)
        return f && f.fn ? f.fn.ret : null
      }
      case 'Method': {
        const o = ev(e.obj, scope, fn)
        const args = e.args.map(a => ev(a, scope, fn))
        noteTemplate(args, e.name)
        if (o && o.s) { const m = memberOf(o.s, e.name); if (m && m.val && m.val.fn) return m.val.fn.ret }
        return null
      }
    }
    return null
  }
  // Library:Validate(Info, Templates.Toggle) / Validate(Info, Defaults) のように、引数とテーブルを一緒に渡す呼び出し
  const TEMPLATE_FN = /valid|default|merge|template|deepcopy|^fill|^apply|^extend|^assign|^normali|^override/i
  function noteTemplate(args, name) {
    if (!name || !TEMPLATE_FN.test(name)) return
    const pi = args.findIndex(a => a && a.param !== undefined)
    if (pi < 0) return
    const tpl = args.find((a, i) => i !== pi && a && a.s)
    if (tpl) args[pi].fn.tpl.set(args[pi].param, tpl.s.id)
  }

  // ---- 文 ----
  let depth = 0 // 関数の中での入れ子の深さ (一番外側の return を優先する)
  function walk(block, scope, fn, nested) {
    if (!block) return
    if (nested) depth++
    try {
      for (const st of block) {
        try { stat(st, scope, fn) } catch { /* 解析できない文は飛ばす */ }
      }
    } finally { if (nested) depth-- }
  }
  function stat(st, scope, fn) {
    switch (st.t) {
      case 'Local': {
        const vals = st.values.map(v => ev(v, scope, fn))
        st.names.forEach((n, i) => scope.vars.set(n.name, vals[i] || null))
        break
      }
      case 'LocalFunction': {
        const holder = { fn: null }
        scope.vars.set(st.name.name, holder)
        holder.fn = funcDesc(st.func, scope, null)
        break
      }
      case 'Function': {
        const tg = st.target
        if (tg.t === 'Name') {
          const holder = { fn: null }
          assignName(scope, tg.name, holder)
          holder.fn = funcDesc(st.func, scope, null)
          break
        }
        const obj = ev(tg.obj, scope, fn)
        const key = keyOf(tg.key)
        const holder = { fn: null }
        if (obj && obj.s && key) setMember(obj.s, key, holder, st.line)
        holder.fn = funcDesc(st.func, scope, obj && obj.s ? obj : null)
        if (obj && obj.s && key) setMember(obj.s, key, holder, st.line)
        break
      }
      case 'Assign': {
        const vals = st.values.map(v => ev(v, scope, fn))
        st.targets.forEach((tg, i) => {
          const val = vals[i] || null
          if (tg.t === 'Name') { assignName(scope, tg.name, val); return }
          if (tg.t !== 'Index') return
          const obj = ev(tg.obj, scope, fn)
          const key = keyOf(tg.key)
          if (obj && obj.param !== undefined && key) { noteKey(obj, key, val); return }
          if (!obj || !obj.s) return
          if (key) setMember(obj.s, key, val, st.line)
          else if (val && val.s && obj.s !== val.s) obj.s.idx.add(val.s.id)
        })
        break
      }
      case 'CallStat': ev(st.call, scope, fn); break
      case 'Return': {
        const v = st.values.length ? ev(st.values[0], scope, fn) : null
        if (fn && v && (v.s || v.fn || v.p)) {
          const top = depth === fn.depth
          if (!fn.ret || (!fn.ret.s && v.s) || (top && !fn.retTop && (v.s || !fn.ret.s))) { fn.ret = v; if (top) fn.retTop = true }
        }
        if (!fn) rootVal = rootVal || v
        break
      }
      case 'Do': walk(st.body, child(scope), fn, true); break
      case 'While': ev(st.cond, scope, fn); walk(st.body, child(scope), fn, true); break
      case 'Repeat': walk(st.body, child(scope), fn, true); break
      case 'If':
        for (const c of st.clauses) { ev(c.cond, scope, fn); walk(c.body, child(scope), fn, true) }
        if (st.orelse) walk(st.orelse, child(scope), fn, true)
        break
      case 'NumFor': { const sc = child(scope); sc.vars.set(st.var.name, { p: 'number' }); walk(st.body, sc, fn, true); break }
      case 'GenFor': {
        const sc = child(scope)
        // for k, v in pairs(Base) do T[k] = v end → T は Base のメンバーを持つ
        let src = null
        const ex = st.exprs[0]
        if (ex) {
          if (ex.t === 'Call' && ex.fn.t === 'Name' && (ex.fn.name === 'pairs' || ex.fn.name === 'next' || ex.fn.name === 'ipairs')) src = ev(ex.args[0], scope, fn)
          else if (ex.t === 'Name' && ex.name === 'next' && st.exprs[1]) src = ev(st.exprs[1], scope, fn)
          else src = ev(ex, scope, fn)
        }
        st.vars.forEach(v => sc.vars.set(v.name, null))
        if (src && src.s && st.vars.length >= 2 && st.body.length <= 3) {
          const [kv, vv] = st.vars
          for (const b of st.body) {
            if (b.t === 'Assign' && b.targets[0] && b.targets[0].t === 'Index' && b.targets[0].key.t === 'Name' && b.targets[0].key.name === kv.name && b.values[0] && b.values[0].t === 'Name' && b.values[0].name === vv.name) {
              const tgt = ev(b.targets[0].obj, scope, fn)
              if (tgt && tgt.s && tgt.s !== src.s) tgt.s.inh.add(src.s.id)
            }
          }
        }
        walk(st.body, sc, fn, true)
        break
      }
    }
  }

  let rootVal = null
  walk(ast.body, child(null), null)
  return serialize(shapes, rootVal)
}

// ---- JSON にする ----
function serialize(shapes, rootVal) {
  const used = new Map()   // 元の id → 新しい id (ルートから届くものだけ残す)
  const out = []
  const queue = []
  const take = sh => {
    if (!sh) return null
    if (used.has(sh.id)) return used.get(sh.id)
    const nid = out.length
    used.set(sh.id, nid)
    out.push(null)
    queue.push([sh, nid])
    return nid
  }
  const kindOf = v => (!v || v.param !== undefined ? 'any' : v.s ? 'table' : v.fn ? 'function' : v.p || 'any')
  const fmtDefault = v => {
    if (!v || v.param !== undefined) return null
    if (v.p === 'string') return v.v !== undefined ? JSON.stringify(String(v.v).slice(0, 60)) : '""'
    if (v.p === 'number') return v.v !== undefined ? String(v.v) : '0'
    if (v.p === 'boolean') return v.v !== undefined ? String(v.v) : 'false'
    if (v.fn) return 'function'
    if (v.s) return '{}'
    return null
  }
  const optsOf = (desc, i) => {
    const keys = new Map()
    const tplId = desc.tpl.get(i)
    if (tplId !== undefined) {
      const t = shapes[tplId]
      for (const [k, m] of t.f) keys.set(k, { kind: kindOf(m.val), def: fmtDefault(m.val), fnParams: m.val && m.val.fn && m.val.param === undefined ? m.val.fn.params : null })
    }
    const used = desc.opts.get(i)
    if (used) for (const [k, v] of used) if (!keys.has(k)) keys.set(k, { kind: kindOf(v), def: null, fnParams: v && v.fn && v.param === undefined ? v.fn.params : null })
    return keys.size ? [...keys].slice(0, 40).map(([k, v]) => [k, v.kind, v.def, v.fnParams ? v.fnParams.slice(0, 4) : null]) : null
  }
  const root = rootVal && rootVal.s ? take(rootVal.s) : null
  let guard = 0
  while (queue.length && guard++ < 20000) {
    const [sh, nid] = queue.shift()
    const members = {}
    const collect = (s, seen) => {
      if (seen.has(s.id)) return
      seen.add(s.id)
      for (const [k, m] of s.f) {
        if (members[k] || k.startsWith('__')) continue
        const v = m.val
        if (v && v.fn) {
          const d = v.fn
          const params = d.method ? d.params : d.params
          const opts = []
          d.params.forEach((p, i) => { const o = optsOf(d, i); if (o) opts.push([i, o]) })
          members[k] = { k: 'fn', params, method: d.method, va: d.vararg || undefined, doc: d.doc || undefined, ret: d.ret && d.ret.s ? take(d.ret.s) : undefined, rt: d.ret && !d.ret.s ? kindOf(d.ret) : undefined, opts: opts.length ? opts : undefined, types: d.types.some(Boolean) ? d.types : undefined }
        } else {
          members[k] = { k: 'val', ty: kindOf(v), ref: v && v.s ? take(v.s) : undefined, def: fmtDefault(v) || undefined }
        }
      }
      for (const id of s.inh) collect(shapes[id], seen)
    }
    collect(sh, new Set())
    const idx = [...sh.idx].map(id => take(shapes[id]))
    out[nid] = { m: members, idx: idx.length ? idx : undefined }
  }
  return { v: 1, root, shapes: out }
}

// ============================================================
// 使う側 (補完) のための関数
// ============================================================
// ref: 数値 (shape の番号) か、その配列 (どれか、の意味)
export function membersOfRef(api, ref) {
  const ids = Array.isArray(ref) ? ref : [ref]
  const out = new Map()
  for (const id of ids) {
    const sh = api.shapes[id]
    if (!sh) continue
    for (const [k, m] of Object.entries(sh.m)) if (!out.has(k)) out.set(k, m)
  }
  return out
}
// 名前のない添字 (Options[Idx] = Toggle など) で入っているもの
export function indexRef(api, ref) {
  const ids = Array.isArray(ref) ? ref : [ref]
  const out = []
  for (const id of ids) { const sh = api.shapes[id]; if (sh && sh.idx) out.push(...sh.idx) }
  return out.length ? [...new Set(out)] : null
}
// 関数の表示用シグネチャ (self は除く)
export function sigOf(m) {
  if (m.k !== 'fn') return ''
  const ps = m.params.filter((p, i) => !(i === 0 && !m.method && p === 'self'))
  const opts = new Map(m.opts || [])
  const parts = ps.map((p, i) => {
    const o = opts.get(m.params.indexOf(p))
    void i
    return o ? `${p}: { ${o.slice(0, 4).map(x => x[0]).join(', ')}${o.length > 4 ? ', …' : ''} }` : p
  })
  if (m.va) parts.push('...')
  return `(${parts.join(', ')})`
}

// 呼び出しの引数の雛形 (ゴーストテキスト用)
// キー名から値の種類を推測する
export function guessKind(k) {
  if (/^(callback|func|function|onchanged|changed|onclick|on[A-Z]\w*)$/i.test(k) || /Callback$/.test(k)) return 'function'
  if (/^(name|title|text|desc|description|subtitle|sub|content|subcontent|placeholder|icon|image|flag|tooltip|footer|author|folder|configfolder|filename|key|note|theme|suffix|prefix|valuename|tag)$/i.test(k)) return 'string'
  if (/^(min|max|increment|step|rounding|default|value|duration|time|delay|size|width|height|amount|decimals)$/i.test(k)) return k.toLowerCase() === 'default' || k.toLowerCase() === 'value' ? 'any' : 'number'
  if (/^(enabled|visible|disabled|locked|multi|compact|risky|allownull|hideMaximize|save|toggled|state|current|currentvalue|numeric|finished|cleartextonfocus|savekey|remember|transparent|resizable|center|autoshow)$/i.test(k)) return 'boolean'
  if (/^(values|options|list|items|choices|keys)$/i.test(k)) return 'list'
  return 'any'
}
// 引数テーブルのキーの並べ方 (大事なものを先に、細かい設定は後ろへ)
const KEY_ORDER = [/^(Title|Name|Text)$/, /^(Desc|Description|SubTitle|Subtitle|Content|Info)$/, /^(Default|CurrentValue|Value|Values|Options|Multi)$/, /^(Min|Max|Increment|Rounding|Step|Suffix|ValueName)$/, /^(Placeholder|PlaceholderText|Numeric|Finished)$/, /^(Icon|Image|Flag|Tooltip)$/]
const KEY_SKIP = /^(Changed|Risky|Disabled|Visible|DisabledTooltip|Parent|Theme|Library|Window|Tab|Holder|Container|Ext|Class|Type|IgnoreConfig|Addons|Variant|Callbacks|LockedReason|Locked|Hidden|Tooltip|Order|LayoutOrder|ConfigSettings|KeySettings|KeySystem|Discord|Settings|Position|Size|AnchorPoint|MinSize|MaxSize|Prefix|Suffix|DisabledValues|SpecialType|ExcludeLocalPlayer|ReturnInstanceInstead|Snapping|SnapDistance|AlwaysOnTop|MobileButtonsSide|NotifySide|Font|CornerRadius|BackgroundImage|Searchable|FormatDisplayValue|EmptyOnChange)$/
function keyRank(k) {
  if (/Callback$|^Callback$/.test(k)) return 100
  for (let i = 0; i < KEY_ORDER.length; i++) if (KEY_ORDER[i].test(k)) return i
  return 50
}

export function argTemplate(m, indent, unit) {
  if (m.k !== 'fn') return null
  const start = !m.method && m.params[0] === 'self' ? 1 : 0
  const opts = new Map(m.opts || [])
  const parts = []
  let cursor = -1
  let text = ''
  for (let i = start; i < m.params.length; i++) {
    const p = m.params[i]
    const o = opts.get(i)
    let piece
    if (o) {
      const lines = []
      const keys = o.filter(x => !KEY_SKIP.test(x[0])).sort((a, b) => keyRank(a[0]) - keyRank(b[0]))
      for (const [k, kind0, def, fnParams] of keys) {
        const kind = kind0 === 'any' ? guessKind(k) : kind0
        const isCb = kind === 'function' || /Callback$/.test(k)
        if (!isCb && lines.length >= 6) continue
        let v
        if (isCb) v = `function(${fnParams && fnParams.filter(x => x !== 'self').length ? fnParams.filter(x => x !== 'self').join(', ') : 'Value'})\n${indent}${unit}${unit}\n${indent}${unit}end`
        else if (def === '""') v = /^(Text|Title|Name|Placeholder|Default)$/.test(k) ? `"${k}"` : null
        else if (def && def !== 'function' && def !== '{}') v = /^"No /.test(def) ? `"${k}"` : def
        else v = kind === 'string' ? `"${k}"` : kind === 'number' ? '0' : kind === 'boolean' ? 'false' : kind === 'list' ? '{ "A", "B" }' : null
        if (v === null) continue
        lines.push(`${indent}${unit}${k} = ${v},`)
      }
      piece = lines.length ? `{\n${lines.join('\n')}\n${indent}}` : '{}'
    } else if (/^(callback|func|fn|cb|f|onclick|onchanged)$/i.test(p) || /callback$/i.test(p)) {
      piece = `function()\n${indent}${unit}\n${indent}end`
    } else if (/^(idx|index|id|flag|key|name|title|text|tabname|secname|text1|desc|description|info|content|subtitle|placeholder|theme|label|\w*(name|text|title|info|inf|tip))$/i.test(p)) {
      piece = `"${p}"`
    } else if (/^(min|max|default|value|amount|num|maxvalue|minvalue)/i.test(p)) piece = '0'
    else break // 分からない引数から後ろは省略 (省略できる引数のことが多い)
    parts.push(piece)
  }
  if (!parts.length && m.va) parts.push('"Name"')
  text = parts.join(', ')
  const q = text.indexOf('"')
  if (q >= 0) cursor = q + 1
  return { text, cursor: cursor >= 0 ? cursor : undefined }
}
