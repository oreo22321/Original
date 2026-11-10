// Roblox API データベース (data/roblox-api.json) の読み込みと検索
let api = null
let loading = null
const memberCache = new Map()
let serviceList = null, creatableList = null, classList = null

export function loadRobloxApi(url = 'data/roblox-api.json') {
  if (!loading) {
    loading = fetch(url).then(r => {
      if (!r.ok) throw new Error('API データの読み込みに失敗しました: ' + r.status)
      return r.json()
    }).then(d => {
      api = d
      memberCache.clear()
      serviceList = creatableList = classList = null
      return d
    }).catch(e => { loading = null; throw e })
  }
  return loading
}

export function setRobloxApi(d) { api = d; memberCache.clear(); serviceList = creatableList = classList = null; loading = Promise.resolve(d) }
export const apiReady = () => !!api
export const apiVersion = () => api ? api.v : '?'

export function isClass(name) { return !!(api && api.c[name]) }
export function classInfo(name) { return api && api.c[name] }

export function superChain(name) {
  const out = []
  let c = name
  while (api && c && api.c[c]) { out.push(c); c = api.c[c].s }
  return out
}

export function isA(cls, base) { return superChain(cls).includes(base) }

// クラスの全メンバー (継承を含む)。Map(name → {kind, name, type, flags, owner})
export function classMembers(name) {
  if (!api || !api.c[name]) return new Map()
  let m = memberCache.get(name)
  if (m) return m
  const info = api.c[name]
  m = new Map(info.s ? classMembers(info.s) : undefined)
  for (const row of info.m) m.set(row[1], { kind: row[0], name: row[1], type: row[2], flags: row[3] || '', owner: name })
  memberCache.set(name, m)
  return m
}

export function member(cls, name) { return classMembers(cls).get(name) }

export function serviceNames() {
  if (!api) return []
  if (!serviceList) serviceList = Object.keys(api.c).filter(k => (api.c[k].t || '').includes('S')).sort()
  return serviceList
}
export function isService(name) { return !!(api && api.c[name] && (api.c[name].t || '').includes('S')) }

export function creatableClasses() {
  if (!api) return []
  if (!creatableList) creatableList = Object.keys(api.c).filter(k => !/[NS]/.test(api.c[k].t || '')).sort()
  return creatableList
}
export function allClasses() {
  if (!api) return []
  if (!classList) classList = Object.keys(api.c).sort()
  return classList
}
export function isDeprecatedClass(name) { return !!(api && api.c[name] && (api.c[name].t || '').includes('D')) }

export function enumNames() { return api ? Object.keys(api.e).sort() : [] }
export function enumItems(name) { return api && api.e[name] ? api.e[name] : null }

// "(a: T, b: U): R" → 戻り値の型
export function returnType(sig) {
  const i = sig.lastIndexOf('): ')
  return i >= 0 ? sig.slice(i + 3) : null
}
// "(a: T, b: U)" → [{name, type}]
export function paramsOf(sig) {
  const close = findClose(sig)
  const inner = sig.slice(1, close)
  if (!inner.trim()) return []
  return splitTop(inner).map(p => {
    const i = p.indexOf(':')
    return i >= 0 ? { name: p.slice(0, i).trim(), type: p.slice(i + 1).trim() } : { name: p.trim(), type: 'any' }
  })
}
function findClose(s) {
  let d = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') d++
    else if (s[i] === ')') { d--; if (d === 0) return i }
  }
  return s.length
}
export function splitTop(s) {
  const out = []
  let d = 0, cur = ''
  for (const ch of s) {
    if (ch === '(' || ch === '{' || ch === '[' || ch === '<') d++
    else if (ch === ')' || ch === '}' || ch === ']' || ch === '>') d--
    if (ch === ',' && d === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

// 表示用に API の型名を Luau 風に
export function prettyType(t) {
  if (!t) return 'any'
  return t.replace(/\bnull\b/g, '()').replace(/\bbool\b/g, 'boolean').replace(/\b(int|int64|float|double)\b/g, 'number')
    .replace(/\bInstances\b/g, '{Instance}').replace(/\bObjects\b/g, '{Instance}').replace(/\bDictionary\b/g, '{[string]: any}').replace(/\bArray\b/g, '{any}').replace(/\bTuple\b/g, '...any')
}
