// AI がファイルを扱うための部品 (読み書き・置き換え・差分・変更の記録と取り消し・API 検索)
// ・AI の変更はすべて記録され、まとめて元に戻せます (エディタの「元に戻す」でも戻せます)
import { app, refreshFiles } from './app.js'
import { getSettings, getMode } from './store.js'
import * as vfs from './vfs.js'
import { lintLuau } from '../editor/lint.js'
import { scriptKindOf } from '../editor/setup.js'
import * as apidb from '../editor/apidb.js'
import { LUAU_GLOBALS, LUAU_LIBS, ROBLOX_DATATYPES } from '../data/luau-api.js'
import { EXECUTOR_GLOBALS, EXECUTOR_LIBS, DRAWING_PROPS } from '../data/executor-api.js'

// ============================================================
// ファイルの読み書き
// ============================================================
export const cleanPath = p => {
  const path = vfs.normPath(String(p || '').trim().replace(/^\.?\/+/, '').replace(/^\/+/, ''))
  // プロジェクトの外を指すような名前は受け付けない
  if (!path || path.split('/').some(seg => seg === '..' || /[\u0000-\u001f]/.test(seg))) throw new Error(`Invalid path: ${String(p).slice(0, 80)}`)
  if (path.length > 200) throw new Error('Path is too long.')
  return path
}
const MAX_WRITE = 1000000 // 1 回で書ける大きさ (文字数)
export const isFile = path => app.files.some(f => f.path === path && !f.dir)

export async function fileText(path) {
  const doc = app.editors && app.editors.docs.get(path)
  if (doc) return doc.state.doc.toString()
  if (app.contents.has(path)) return app.contents.get(path)
  return app.project ? vfs.readFile(app.project.id, path) : null
}

// old → next を 1 つの変更にする (前後の一致部分は触らない: カーソルや履歴が自然になる)
export function minimalChange(old, next) {
  let a = 0
  const max = Math.min(old.length, next.length)
  while (a < max && old.charCodeAt(a) === next.charCodeAt(a)) a++
  let b = 0
  while (b < max - a && old.charCodeAt(old.length - 1 - b) === next.charCodeAt(next.length - 1 - b)) b++
  return { from: a, to: old.length - b, insert: next.slice(a, next.length - b) }
}

// エディタの文書に変更を入れる (開いていなければ開く。元に戻せるよう通常の変更として)
export async function writeText(path, next, { focus = false } = {}) {
  let doc = app.editors.docs.get(path)
  if (!doc) doc = await app.editors.open(path, { activate: focus })
  else if (focus) app.editors.activate(path)
  if (!doc) throw new Error(`${path} を開けません`)
  const old = doc.state.doc.toString()
  if (old === next) return
  const spec = { changes: minimalChange(old, next), userEvent: 'ai.edit', scrollIntoView: true }
  const view = app.editors.viewFor(path)
  if (view) view.dispatch(spec)
  else { doc.state = doc.state.update(spec).state; doc.dirty = !doc.state.doc.eq(doc.savedDoc) }
  doc.dirty = !doc.state.doc.eq(doc.savedDoc)
  app.contents.set(path, next)
  await app.editors.save(path, { auto: true })
}

// 1 つずつ順番に (同じファイルへの編集が重ならないように)
let chain = Promise.resolve()
export const serial = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p }

// ============================================================
// 文字列の置き換え (old_text を探す。字下げの違いは許す)
// ============================================================
function countOf(hay, needle) {
  if (!needle) return 0
  let n = 0, i = 0
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length }
  return n
}
// 行単位で、前後の空白の違いを無視して探す (字下げがタブ / スペースで違っても見つける)
function looseFind(text, oldText) {
  const lines = text.split('\n')
  const want = oldText.replace(/\n+$/, '').split('\n').map(l => l.trim())
  while (want.length && !want[0]) want.shift()
  while (want.length && !want[want.length - 1]) want.pop()
  if (!want.length) return null
  const hits = []
  for (let i = 0; i + want.length <= lines.length; i++) {
    let ok = true
    for (let j = 0; j < want.length; j++) if (lines[i + j].trim() !== want[j]) { ok = false; break }
    if (ok) hits.push(i)
  }
  if (hits.length !== 1) return { count: hits.length }
  const startLine = hits[0], endLine = hits[0] + want.length - 1
  let from = 0
  for (let i = 0; i < startLine; i++) from += lines[i].length + 1
  let to = from
  for (let i = startLine; i <= endLine; i++) to += lines[i].length + (i < endLine ? 1 : 0)
  return { count: 1, from, to }
}
// 新しいテキストの字下げを、置き換える場所の字下げに合わせる
function reindentLike(newText, origSlice) {
  const ind = s => (/^[ \t]*/.exec(s) || [''])[0]
  const firstOrig = origSlice.split('\n').find(l => l.trim()) || ''
  const firstNew = newText.split('\n').find(l => l.trim()) || ''
  const a = ind(firstOrig), b = ind(firstNew)
  if (a === b) return newText
  return newText.split('\n').map(l => (l.startsWith(b) ? a + l.slice(b.length) : l)).join('\n')
}
export function applyReplace(text, oldText, newText, all = false) {
  oldText = oldText == null ? '' : String(oldText)
  newText = newText == null ? '' : String(newText)
  if (!oldText) throw new Error('old_text is empty. To create or overwrite a whole file use write_file.')
  const n = countOf(text, oldText)
  if (n === 1 || (n > 1 && all)) {
    const at = text.indexOf(oldText)
    const next = all ? text.split(oldText).join(newText) : text.slice(0, at) + newText + text.slice(at + oldText.length)
    return { text: next, from: at, count: n }
  }
  if (n > 1) throw new Error(`old_text was found ${n} times. Include more surrounding lines so it is unique, or set replace_all.`)
  const loose = looseFind(text, oldText)
  if (loose && loose.count === 1) {
    const slice = text.slice(loose.from, loose.to)
    const repl = reindentLike(newText.replace(/\n+$/, ''), slice)
    return { text: text.slice(0, loose.from) + repl + text.slice(loose.to), from: loose.from, count: 1, loose: true }
  }
  if (loose && loose.count > 1) throw new Error(`old_text matched ${loose.count} places (ignoring indentation). Include more surrounding lines.`)
  throw new Error('old_text was not found in the file. Call read_file to see the current text and copy it exactly (without the line-number prefix).')
}

// ============================================================
// 表示用
// ============================================================
export function numbered(text, start = 1, end = Infinity) {
  const lines = text.split('\n')
  const s = Math.max(1, start), e = Math.min(lines.length, end)
  const w = String(e).length
  const out = []
  for (let i = s; i <= e; i++) out.push(String(i).padStart(w, ' ') + '| ' + lines[i - 1])
  return out.join('\n')
}
const lineAt = (text, pos) => { let n = 1; for (let i = 0; i < pos && i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n }

export function lintOpts(path) {
  const s = getSettings()
  const mode = getMode()
  return { enabled: true, executor: mode === 'executor', undefinedGlobals: s.lintUndefined, unused: false, typos: s.lintTypos, scriptKind: scriptKindOf(path, mode) }
}
export function problemsOf(path, text, { max = 30, warnings = true } = {}) {
  if (!/\.luau?$/i.test(path)) return []
  let diags = []
  try { diags = lintLuau(text, lintOpts(path)) } catch { return [] }
  return diags.filter(d => d.severity === 'error' || (warnings && d.severity === 'warning')).slice(0, max)
    .map(d => ({ line: lineAt(text, d.from), severity: d.severity, message: d.message }))
}
const problemsText = list => list.map(p => `line ${p.line} (${p.severity}): ${p.message}`).join('\n')

// 差分 (行単位)。前後の一致を除いた中央部分だけ比べる
export function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n')
  let s = 0
  while (s < A.length && s < B.length && A[s] === B[s]) s++
  let e = 0
  while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++
  const a2 = A.slice(s, A.length - e), b2 = B.slice(s, B.length - e)
  const ops = []
  if (a2.length * b2.length <= 250000) {
    // LCS
    const n = a2.length, m = b2.length
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a2[i] === b2[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    let i = 0, j = 0
    while (i < n || j < m) {
      if (i < n && j < m && a2[i] === b2[j]) { ops.push({ t: ' ', s: a2[i], a: s + i + 1, b: s + j + 1 }); i++; j++ }
      else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) { ops.push({ t: '-', s: a2[i], a: s + i + 1 }); i++ }
      else { ops.push({ t: '+', s: b2[j], b: s + j + 1 }); j++ }
    }
  } else {
    a2.forEach((l, i) => ops.push({ t: '-', s: l, a: s + i + 1 }))
    b2.forEach((l, j) => ops.push({ t: '+', s: l, b: s + j + 1 }))
  }
  const added = ops.filter(o => o.t === '+').length, removed = ops.filter(o => o.t === '-').length
  // 前後 2 行の文脈
  const ctx = []
  for (let k = Math.max(0, s - 2); k < s; k++) ctx.push({ t: ' ', s: A[k], a: k + 1, b: k + 1 })
  const tail = []
  for (let k = 0; k < Math.min(2, e); k++) { const ai = A.length - e + k, bi = B.length - e + k; tail.push({ t: ' ', s: A[ai], a: ai + 1, b: bi + 1 }) }
  return { ops: [...ctx, ...ops, ...tail], added, removed }
}

// ============================================================
// API を調べる (補完用のデータをそのまま使う)
// ============================================================
const fmtEntry = (name, e) => (e ? `${name}${e.kind === 'function' ? e.sig : ': ' + (e.type || 'any')}${e.doc ? ' — ' + e.doc : ''}` : name)
export function lookupApi(query) {
  const q = String(query || '').trim().replace(/^game:GetService\(["'](\w+)["']\)/, '$1')
  if (!q) return 'Empty query.'
  const out = []
  const m = /^([\w]+)(?:[.:]([\w]+))?(?:[.:]([\w]+))?$/.exec(q)
  if (!m) return 'Use a name like "TweenService", "Humanoid.WalkSpeed", "Enum.KeyCode", "string.format", "Drawing" or "getgenv".'
  const [, a, b, c] = m
  if (a === 'Enum') {
    if (!b) return 'Enums: ' + apidb.enumNames().slice(0, 300).join(', ')
    const items = apidb.enumItems(b)
    return items ? `Enum.${b}: ${items.map(it => (Array.isArray(it) ? it[0] : it)).join(', ')}` : `Enum.${b} not found.`
  }
  if (b && apidb.isClass(a)) {
    const mem = apidb.member(a, b)
    if (mem) return `${mem.owner}${mem.kind === 'f' ? ':' : '.'}${mem.name} — ${{ p: 'property', f: 'method', e: 'event', c: 'callback' }[mem.kind] || mem.kind} ${mem.type || ''}${mem.flags.includes('r') ? ' (read-only)' : ''}${mem.flags.includes('d') ? ' (deprecated)' : ''}`
    out.push(`${a}.${b} not found. Members of ${a}:`)
  }
  if (apidb.isClass(a)) {
    const info = apidb.classInfo(a)
    if (!out.length) out.push(`class ${a}${info.s ? ' : ' + apidb.superChain(a).slice(1).join(' < ') : ''}${apidb.isService(a) ? ' (service: game:GetService("' + a + '"))' : ''}${apidb.isDeprecatedClass(a) ? ' (deprecated)' : ''}`)
    const groups = { Properties: [], Methods: [], Events: [], Callbacks: [] }
    const GK = { p: 'Properties', f: 'Methods', e: 'Events', c: 'Callbacks' }
    const inherited = new Map()
    for (const mem of apidb.classMembers(a).values()) {
      if (mem.flags.includes('d') || mem.flags.includes('h')) continue
      // Instance / Object の共通メンバーは名前だけ (長くなりすぎないように)
      if (mem.owner !== a) { if (!inherited.has(mem.owner)) inherited.set(mem.owner, []); inherited.get(mem.owner).push(mem.name); if (mem.owner === 'Instance' || mem.owner === 'Object') continue }
      const g = groups[GK[mem.kind] || 'Properties']
      g.push(mem.kind === 'p' ? `${mem.name}: ${mem.type || '?'}${mem.flags.includes('r') ? ' (read-only)' : ''}` : `${mem.name}${mem.type || ''}`)
    }
    for (const [k, list] of Object.entries(groups)) if (list.length) out.push(`${k}: ${list.slice(0, 120).join(', ')}${list.length > 120 ? ' …' : ''}`)
    if (inherited.has('Instance')) out.push('Also has the usual Instance members (Name, Parent, FindFirstChild, WaitForChild, GetChildren, Destroy, Clone, GetAttribute, ...).')
    return out.join('\n')
  }
  const lib = LUAU_LIBS[a] || EXECUTOR_LIBS[a]
  if (lib) {
    if (b) return lib[b] ? fmtEntry(`${a}.${b}`, lib[b]) : `${a}.${b} not found. ${a}: ${Object.keys(lib).join(', ')}`
    return Object.entries(lib).map(([k, e]) => fmtEntry(`${a}.${k}`, e)).join('\n')
  }
  const dt = ROBLOX_DATATYPES[a]
  if (dt) {
    const parts = []
    for (const [k, e] of Object.entries(dt.ctor || {})) parts.push(fmtEntry(`${a}.${k}`, e))
    for (const [k, e] of Object.entries(dt.props || {})) parts.push(fmtEntry(`(${a}).${k}`, e))
    for (const [k, e] of Object.entries(dt.methods || {})) parts.push(fmtEntry(`(${a}):${k}`, e))
    return parts.join('\n')
  }
  if (a === 'Drawing') return ['Drawing.new(kind: "Line"|"Text"|"Image"|"Circle"|"Square"|"Quad"|"Triangle")', ...Object.entries(DRAWING_PROPS).map(([k, v]) => `${k}: ${v.join('; ')}`)].join('\n')
  if (EXECUTOR_GLOBALS[a]) return fmtEntry(a, EXECUTOR_GLOBALS[a]) + ' (executor API)'
  if (LUAU_GLOBALS[a]) return fmtEntry(a, LUAU_GLOBALS[a])
  // 似た名前
  const low = a.toLowerCase()
  const cands = [...apidb.allClasses(), ...Object.keys(EXECUTOR_GLOBALS), ...Object.keys(LUAU_GLOBALS), ...Object.keys(ROBLOX_DATATYPES)].filter(n => n.toLowerCase().includes(low)).slice(0, 30)
  return cands.length ? `"${q}" not found. Similar: ${cands.join(', ')}` : `"${q}" not found in the API data.`
}

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
export const byteLen = s => (encoder ? encoder.encode(s).length : s.length * 3)
export async function finishChanges(session) {
  const out = []
  for (const [path, c] of session.changes) {
    const after = await fileText(path)
    if (after !== c.before) out.push({ path, before: c.before, after })
  }
  return out
}

// 変更を元に戻す (エージェントが作ったファイルは削除)
export async function revertChanges(changes) {
  for (const c of changes) {
    if (c.before === null) {
      if (isFile(c.path)) { const removed = await vfs.remove(app.project.id, c.path); for (const p of removed) app.editors.forceClose(p) }
    } else if (isFile(c.path) || app.editors.docs.has(c.path)) await writeText(c.path, c.before)
    else { await vfs.writeFile(app.project.id, c.path, c.before); app.contents.set(c.path, c.before) }
  }
  await refreshFiles()
}
