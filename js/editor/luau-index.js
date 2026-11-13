// 文書の索引 (補完・型推論の土台)
//  ・ブロック (function / if / for ...) と、その終わりの位置
//  ・すべての宣言 (local / 引数 / for の変数 / 関数 / グローバル代入) と、それが見える範囲 (スコープ)
//  ・関数ごとの return の位置 (戻り値の型の推論用)
//  ・self.X = ... の代入 (クラスのフィールド)
//  ・メンバー (.X / :X) の使用回数 (よく使うものを候補の上位に)
//  ・type 定義
// 1 回の字句走査で作るので、入力のたびに作り直しても軽く済みます。
// 大きなファイルは、前回の索引の位置をずらして使い回し (変更した部分だけ無効)、入力が止まったときに作り直します。
import { scanBlocks } from './blocks.js'

const SYNC_LIMIT = 150000   // これ以下のテキストは常にその場で作る
const KEEP = 4              // 覚えておく索引の数 (開いているファイル + require したモジュール)

const exact = []            // [{ text, ix }]
let live = null             // 大きなファイル用: 位置をずらして使い回している索引 { base, text, view }
let rebuildTimer = 0

const lineEndOf = (text, p) => { const i = text.indexOf('\n', p); return i < 0 ? text.length : i }

function build(text) {
  const { tokens, blocks } = scanBlocks(text)
  const decls = new Map()
  const list = []
  const returns = new Map()
  const selfAssigns = []
  const memberUse = new Map()
  const types = new Map()
  const add = d => { let a = decls.get(d.name); if (!a) decls.set(d.name, a = []); a.push(d); list.push(d) }
  const stack = []
  const braces = [] // { の位置ごとに、そのときのブロックの深さ (テーブルの中の a = 1 を代入と区別する)
  let bi = 0
  const n = tokens.length
  const src = t => text.slice(t.s, t.e)
  const scopeEnd = (depth = 0) => (stack.length > depth ? stack[stack.length - 1 - depth].end : Infinity)
  const ownerNow = () => { for (let k = stack.length - 1; k >= 0; k--) if (stack[k].owner) return stack[k].owner; return null }
  // 型注釈 (: T) を読み飛ばして、終わりのトークン位置を返す
  const skipType = (j, stopAt) => {
    let d = 0
    const le = lineEndOf(text, tokens[j - 1] ? tokens[j - 1].e : 0)
    for (; j < n; j++) {
      const tt = tokens[j].t
      if (tokens[j].s > le && d === 0) break
      if (d === 0 && stopAt.has(tt)) break
      if (tt === '(' || tt === '{' || tt === '[' || tt === '<') d++
      else if (tt === ')' || tt === '}' || tt === ']' || tt === '>') { if (d === 0) break; d-- }
    }
    return j
  }
  const STOP_LOCAL = new Set([',', '='])
  const STOP_PARAM = new Set([','])
  const STOP_FOR = new Set([',', 'in', '=', 'do'])
  // 代入の右辺: 行の残り (空なら次の行)
  const exprFrom = s => {
    let e = text.slice(s, lineEndOf(text, s)).trim()
    if (!e) { const ns = lineEndOf(text, s) + 1; if (ns < text.length) e = text.slice(ns, lineEndOf(text, ns)).trim() }
    return e
  }
  const firstOnLine = i => i === 0 || text.slice(tokens[i - 1].e, tokens[i].s).includes('\n') || tokens[i - 1].t === ';'

  for (let i = 0; i < n; i++) {
    const tok = tokens[i]
    const t = tok.t
    if (tok.role === 'open') {
      const b = blocks[bi++]
      if (b) { b.end = b.close ? b.close.e : Infinity; b.mids = null; stack.push(b) }
    } else if (tok.role === 'close') {
      if (stack.length && stack[stack.length - 1].close && stack[stack.length - 1].close.s === tok.s) stack.pop()
    } else if (tok.role === 'mid') {
      for (let k = stack.length - 1; k >= 0; k--) if (stack[k].kind === 'if') { (stack[k].mids || (stack[k].mids = [])).push(tok.s); break }
    }

    switch (t) {
      case '{': braces.push(stack.length); break
      case '}': braces.pop(); break
      case 'local': {
        const nx = tokens[i + 1]
        if (!nx || nx.t === 'function') break
        let j = i + 1, idx = 0
        const names = []
        while (j < n && tokens[j].t === 'name') {
          const nameTok = tokens[j]
          let anno = null
          j++
          // 属性 <const> / <close>
          if (tokens[j] && tokens[j].t === '<' && tokens[j + 2] && tokens[j + 2].t === '>') j += 3
          if (tokens[j] && tokens[j].t === ':') {
            const as = tokens[j].e
            j = skipType(j + 1, STOP_LOCAL)
            anno = text.slice(as, j < n ? tokens[j].s : text.length).trim() || null
          }
          names.push({ tok: nameTok, anno, idx: idx++ })
          if (tokens[j] && tokens[j].t === ',') { j++; continue }
          break
        }
        const expr = tokens[j] && tokens[j].t === '=' ? exprFrom(tokens[j].e) : undefined
        const end = scopeEnd()
        for (const nm of names) add({ name: src(nm.tok), kind: 'local', pos: tok.s, at: nm.tok.s, end, anno: nm.anno, expr, index: nm.idx })
        break
      }
      case 'function': {
        const b = tok.role === 'open' ? stack[stack.length - 1] : null
        let j = i + 1, nameText = ''
        while (j < n && (tokens[j].t === 'name' || tokens[j].t === '.' || tokens[j].t === ':') && !(tokens[j].t === 'name' && nameText && !/[.:]$/.test(nameText))) { nameText += src(tokens[j]); j++ }
        if (tokens[j] && tokens[j].t === '<') { let d = 0; for (; j < n; j++) { if (tokens[j].t === '<') d++; else if (tokens[j].t === '>' && --d === 0) { j++; break } } }
        const open = tokens[j] && tokens[j].t === '(' ? j : -1
        const fnEnd = b ? b.end : Infinity
        const sep = Math.max(nameText.lastIndexOf('.'), nameText.lastIndexOf(':'))
        if (b) b.owner = sep > 0 ? nameText.slice(0, sep) : null
        const headEnd = b && b.headerEnd !== undefined ? b.headerEnd : lineEndOf(text, tok.s)
        const params = open >= 0 ? text.slice(tokens[open].s, headEnd) : '()'
        const prev = tokens[i - 1]
        if (nameText && sep < 0) {
          if (prev && prev.t === 'local') add({ name: nameText, kind: 'func', pos: prev.s, at: tokens[i + 1].s, end: scopeEnd(b ? 1 : 0), fnPos: tok.s, params })
          else add({ name: nameText, kind: 'func', pos: tok.s, at: tokens[i + 1].s, end: Infinity, fnPos: tok.s, params, global: true })
        }
        if (nameText.includes(':')) add({ name: 'self', kind: 'param', pos: tok.s, end: fnEnd, index: -1, self: nameText.slice(0, nameText.indexOf(':')) })
        if (open < 0) break
        // 引数
        let signalExpr = null, hookPre = false
        if (!nameText) {
          const pre = text.slice(Math.max(0, tok.s - 300), tok.s)
          const cm = /([\w.:"'()[\]]+?)\s*:\s*(?:Connect|Once|ConnectParallel|connect)\s*\(\s*$/.exec(pre)
          if (cm) signalExpr = cm[1]
          else if (/hookmetamethod\s*\([^()]*,\s*["']__(?:namecall|index|newindex)["']\s*,\s*(?:newcclosure\s*\(\s*)?$/.test(pre)) hookPre = true
        }
        let k = open + 1, idx = 0
        while (k < n && tokens[k].t !== ')') {
          const pt = tokens[k]
          if (pt.t === 'name' || pt.t === '...') {
            let anno = null
            k++
            if (tokens[k] && tokens[k].t === ':') {
              const as = tokens[k].e
              k = skipType(k + 1, STOP_PARAM)
              anno = text.slice(as, k < n ? tokens[k].s : text.length).trim() || null
            }
            if (pt.t === 'name') add({ name: src(pt), kind: 'param', pos: tok.s, at: pt.s, end: fnEnd, index: idx, anno, signalExpr, hookArg: hookPre ? idx : -1 })
            idx++
            if (tokens[k] && tokens[k].t === ',') k++
            continue
          }
          break
        }
        break
      }
      case 'for': {
        const b = tok.role === 'open' ? stack[stack.length - 1] : null
        let j = i + 1
        const names = []
        while (j < n && tokens[j].t === 'name') {
          names.push(tokens[j]); j++
          if (tokens[j] && tokens[j].t === ':') j = skipType(j + 1, STOP_FOR)
          if (tokens[j] && tokens[j].t === ',') { j++; continue }
          break
        }
        const kw = tokens[j]
        const end = b ? b.end : scopeEnd()
        if (kw && kw.t === '=' && names[0]) add({ name: src(names[0]), kind: 'fornum', pos: tok.s, at: names[0].s, end })
        else if (kw && kw.t === 'in') {
          let k = j + 1
          const stopAt = b && b.headerEnd !== undefined ? b.headerEnd : -1
          for (; k < n && k < j + 400; k++) if (tokens[k].t === 'do' && (stopAt < 0 || tokens[k].e === stopAt)) break
          const expr = text.slice(kw.e, k < n && tokens[k].t === 'do' ? tokens[k].s : lineEndOf(text, kw.e)).trim()
          names.forEach((nt, index) => add({ name: src(nt), kind: 'forin', pos: tok.s, at: nt.s, end, index, expr }))
        }
        break
      }
      case 'return': {
        let key = -1
        for (let k = stack.length - 1; k >= 0; k--) if (stack[k].kind === 'function') { key = stack[k].s; break }
        let a = returns.get(key)
        if (!a) returns.set(key, a = [])
        if (a.length < 8) a.push(tok.e)
        break
      }
      case 'name': {
        const prev = tokens[i - 1]
        if (prev && (prev.t === '.' || prev.t === ':')) {
          const name = src(tok)
          memberUse.set(name, (memberUse.get(name) || 0) + 1)
          break
        }
        const nx = tokens[i + 1]
        if (!nx) break
        const name = src(tok)
        if (name === 'self' && nx.t === '.' && tokens[i + 2] && tokens[i + 2].t === 'name' && tokens[i + 3] && tokens[i + 3].t === '=') {
          selfAssigns.push({ field: src(tokens[i + 2]), pos: tok.s, owner: ownerNow(), expr: exprFrom(tokens[i + 3].e) })
          break
        }
        if (nx.t === '=' && firstOnLine(i) && !(braces.length && braces[braces.length - 1] === stack.length)) { add({ name, kind: 'assign', pos: tok.s, at: tok.s, end: Infinity, expr: exprFrom(nx.e) }); break }
        // type Name = ... / export type Name<T> = ...
        if (name === 'type' && nx.t === 'name' && (firstOnLine(i) || (tokens[i - 1] && src(tokens[i - 1]) === 'export'))) {
          let j = i + 2
          if (tokens[j] && tokens[j].t === '<') { let d = 0; for (; j < n; j++) { if (tokens[j].t === '<') d++; else if (tokens[j].t === '>' && --d === 0) { j++; break } } }
          if (tokens[j] && tokens[j].t === '=') types.set(src(nx), tokens[j].e)
        }
        break
      }
    }
  }
  list.sort((a, b) => a.pos - b.pos || a.at - b.at)
  for (const a of decls.values()) a.sort((x, y) => x.pos - y.pos || x.at - y.at)
  return { text, blocks, decls, list, returns, selfAssigns, memberUse, types, hasIsA: /IsA|ClassName/.test(text) }
}

// ---- 索引のビュー: 位置の変換 (使い回しのとき) を隠して、新しいテキストの位置で答えます ----
function makeView(ix, text, map) {
  // map: null (そのまま) | { p, oldTail, delta, newTail } 旧テキストの [p, oldTail) が変更された範囲
  const toNew = map ? (pos => (pos === Infinity ? Infinity : pos < map.p ? pos : pos >= map.oldTail ? pos + map.delta : null)) : (pos => pos)
  const toOld = map ? (pos => (pos === Infinity ? Infinity : pos < map.p ? pos : pos >= map.newTail ? pos - map.delta : map.p)) : (pos => pos)
  const mapDecl = d => {
    if (!map) return d
    const pos = toNew(d.pos), at = toNew(d.at)
    if (pos === null || at === null) return null
    let end = toNew(d.end)
    if (end === null) end = map.newTail
    return { ...d, pos, at, end, fnPos: d.fnPos !== undefined ? toNew(d.fnPos) : undefined }
  }
  const declCache = new Map()
  // local x = | の右辺では x はまだ見えない (同じ行の初期化式の中)
  const inOwnInit = (d, pos) => d.kind === 'local' && d.expr !== undefined && pos > d.at && !text.slice(d.at, pos).includes('\n')
  // 変更した範囲 (行単位) だけを解析した宣言。位置をずらした索引には入っていないので、ここから補う
  let patch = null
  const getPatch = () => {
    if (patch || !map) return patch
    patch = { decls: new Map(), list: [] }
    const rs = text.lastIndexOf('\n', Math.max(0, map.p - 1)) + 1
    let re = text.indexOf('\n', map.newTail)
    if (re < 0) re = text.length
    if (re - rs > 60000) return patch
    let sub
    try { sub = build(text.slice(rs, re)) } catch { return patch }
    // 範囲の外に続くスコープは、それを囲むブロックの終わりまで
    const outer = view.enclosing(rs, 1)[0]
    const outerEnd = outer ? outer.end : Infinity
    for (const d0 of sub.list) {
      const d = { ...d0, pos: d0.pos + rs, at: d0.at + rs, end: d0.end === Infinity ? (d0.global || d0.kind === 'assign' ? Infinity : outerEnd) : d0.end + rs, fnPos: d0.fnPos !== undefined ? d0.fnPos + rs : undefined }
      let a = patch.decls.get(d.name)
      if (!a) patch.decls.set(d.name, a = [])
      a.push(d)
      patch.list.push(d)
    }
    return patch
  }
  const view = {
    text,
    exact: !map,
    decls(name) {
      let a = declCache.get(name)
      if (!a) {
        a = (ix.decls.get(name) || []).map(mapDecl).filter(Boolean)
        const pa = map && getPatch().decls.get(name)
        if (pa) a = [...a, ...pa].sort((x, y) => x.pos - y.pos || x.at - y.at)
        declCache.set(name, a)
      }
      return a
    },
    // pos で見える name の宣言 (いちばん内側・最後のもの)
    find(name, before) {
      const a = view.decls(name)
      for (let i = a.length - 1; i >= 0; i--) {
        const d = a[i]
        if (d.pos < before && d.end >= before && !inOwnInit(d, before)) return d
      }
      return null
    },
    // pos で見えるすべての宣言 (同じ名前は内側のものだけ)
    visible(pos, limit = 400) {
      const old = toOld(pos)
      const seen = new Set()
      const out = []
      const list = ix.list
      let lo = 0, hi = list.length
      while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].pos < old) lo = mid + 1; else hi = mid }
      for (let i = lo - 1; i >= 0 && out.length < limit; i--) {
        const d = list[i]
        if (d.end < old || seen.has(d.name)) continue
        if (d.kind === 'param' && d.index < 0) continue
        const m = mapDecl(d)
        if (!m || inOwnInit(m, pos)) continue
        seen.add(d.name)
        out.push(m)
      }
      if (map) {
        // 変更範囲の宣言 (近いものを優先して先頭へ)
        const extra = getPatch().list.filter(d => d.pos < pos && d.end >= pos && !(d.kind === 'param' && d.index < 0) && !inOwnInit(d, pos)).reverse()
        const names = new Set(extra.map(d => d.name))
        const seen2 = new Set()
        const head = []
        for (const d of extra) if (!seen2.has(d.name)) { seen2.add(d.name); head.push(d) }
        return [...head, ...out.filter(d => !names.has(d.name))]
      }
      return out
    },
    // pos を含むブロック (内側から)
    enclosing(pos, max = 24, maxSeen = 3000) {
      const old = toOld(pos)
      const blocks = ix.blocks
      let lo = 0, hi = blocks.length
      while (lo < hi) { const mid = (lo + hi) >> 1; if (blocks[mid].s < old) lo = mid + 1; else hi = mid }
      const out = []
      for (let i = lo - 1, seen = 0; i >= 0 && out.length < max && seen < maxSeen; i--, seen++) {
        const b = blocks[i]
        if (b.end > old) out.push(map ? { ...b, s: toNew(b.s), headerEnd: b.headerEnd !== undefined ? toNew(b.headerEnd) : undefined, end: (toNew(b.end) !== null ? toNew(b.end) : map.newTail), mids: b.mids ? b.mids.map(toNew).filter(x => x !== null) : null } : b)
      }
      return out.filter(b => b.s !== null)
    },
    blockAt(s) {
      const old = toOld(s)
      const blocks = ix.blocks
      let lo = 0, hi = blocks.length - 1
      while (lo <= hi) { const mid = (lo + hi) >> 1; const v = blocks[mid].s; if (v === old) { const b = blocks[mid]; return map ? { ...b, s, headerEnd: b.headerEnd !== undefined ? toNew(b.headerEnd) : undefined, end: (toNew(b.end) !== null ? toNew(b.end) : map.newTail) } : b } if (v < old) lo = mid + 1; else hi = mid - 1 }
      return null
    },
    returnsOf(fnPos) {
      const a = ix.returns.get(fnPos === -1 ? -1 : toOld(fnPos)) || []
      return map ? a.map(toNew).filter(x => x !== null) : a
    },
    selfAssigns(owner) {
      const out = []
      for (const s of ix.selfAssigns) if (s.owner === owner) { const pos = toNew(s.pos); if (pos !== null) out.push(map ? { ...s, pos } : s) }
      return out
    },
    memberUse: name => ix.memberUse.get(name) || 0,
    typeBody(name) {
      const s = ix.types.get(name)
      if (s === undefined) return null
      const p = toNew(s)
      return p === null ? null : p
    },
    hasIsA: ix.hasIsA,
  }
  return view
}

// a と b の共通の先頭・末尾の長さ
function commonEnds(a, b) {
  const min = Math.min(a.length, b.length)
  let p = 0, step = 2048
  while (p < min) {
    const s = Math.min(step, min - p)
    if (a.substr(p, s) === b.substr(p, s)) { p += s; if (step < 65536) step *= 2 }
    else if (s > 16) step = s >> 2
    else { while (p < min && a.charCodeAt(p) === b.charCodeAt(p)) p++; break }
  }
  let q = 0
  step = 2048
  const maxQ = min - p
  while (q < maxQ) {
    const s = Math.min(step, maxQ - q)
    if (a.substr(a.length - q - s, s) === b.substr(b.length - q - s, s)) { q += s; if (step < 65536) step *= 2 }
    else if (s > 16) step = s >> 2
    else { while (q < maxQ && a.charCodeAt(a.length - 1 - q) === b.charCodeAt(b.length - 1 - q)) q++; break }
  }
  return { p, q }
}

function remember(text, ix) {
  exact.unshift({ text, ix })
  if (exact.length > KEEP) exact.length = KEEP
}

// テキストの索引 (ビュー) を返します
export function textIndex(text) {
  for (let i = 0; i < exact.length; i++) {
    const c = exact[i]
    if (c.text === text) { if (i) { exact.splice(i, 1); exact.unshift(c) } return c.view || (c.view = makeView(c.ix, text, null)) }
  }
  if (live && live.text === text) return live.view
  if (text.length > SYNC_LIMIT) {
    // 大きいファイル: 似たテキストの索引があれば位置をずらして使い回す
    const base = (live && live.base) || null
    const cand = base && Math.abs(base.text.length - text.length) < 20000 ? base : exact.find(c => Math.abs(c.text.length - text.length) < 20000)
    if (cand) {
      const { p, q } = commonEnds(cand.text, text)
      if (p + q >= cand.text.length * 0.9) {
        const map = { p, oldTail: cand.text.length - q, delta: text.length - cand.text.length, newTail: text.length - q }
        live = { base: cand, text, view: makeView(cand.ix, text, map) }
        scheduleRebuild()
        return live.view
      }
    }
  }
  let ix
  try { ix = build(text) } catch { ix = build('') }
  const entry = { text, ix, view: null }
  remember(text, ix)
  entry.view = makeView(ix, text, null)
  exact[0].view = entry.view
  if (live && text.length > SYNC_LIMIT) live = { base: exact[0], text, view: entry.view }
  return entry.view
}

function scheduleRebuild() {
  // 入力が続いていても一定間隔で作り直す (debounce ではなく throttle)
  if (rebuildTimer) return
  rebuildTimer = setTimeout(() => {
    rebuildTimer = 0
    if (!live || live.view.exact) return
    const text = live.text
    let ix
    try { ix = build(text) } catch { return }
    remember(text, ix)
    exact[0].view = makeView(ix, text, null)
    live = { base: exact[0], text, view: exact[0].view }
  }, 450)
}

// テスト用
export function _resetIndex() { exact.length = 0; live = null; clearTimeout(rebuildTimer); rebuildTimer = 0 }
