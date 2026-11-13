// Claude エージェント (ForgeCode に組み込んだ Claude Code)
// ・プロジェクトのファイルを読む・探す・編集する・作る・実行して結果を確かめる、を Claude が自分で行います
// ・変更はすべて記録され、まとめて元に戻せます (エディタの「元に戻す」でも戻せます)
import { app, refreshFiles } from './app.js'
import { getSettings, getMode } from './store.js'
import * as vfs from './vfs.js'
import { ask, askJson, canUseTools, AiError } from './claude.js'
import { lintLuau } from '../editor/lint.js'
import { scriptKindOf } from '../editor/setup.js'
import * as apidb from '../editor/apidb.js'
import { LUAU_GLOBALS, LUAU_LIBS, ROBLOX_DATATYPES } from '../data/luau-api.js'
import { EXECUTOR_GLOBALS, EXECUTOR_LIBS, DRAWING_PROPS } from '../data/executor-api.js'
import { EditorSelection } from '../../vendor/codemirror.js'

// ============================================================
// ファイルの読み書き
// ============================================================
export const cleanPath = p => vfs.normPath(String(p || '').trim().replace(/^\.?\/+/, '').replace(/^\/+/, ''))
const isFile = path => app.files.some(f => f.path === path && !f.dir)

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
async function writeText(path, next, { focus = false } = {}) {
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
const serial = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p }

// ============================================================
// 文字列の置き換え (Claude が指定した old_text を探す)
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

function lintOpts(path) {
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

// ============================================================
// ツール (Claude が呼ぶ、このページの関数)
// ============================================================
const MAX_TOOL = 28000
const clip = s => (s.length > MAX_TOOL ? s.slice(0, MAX_TOOL) + '\n… (truncated)' : s)

export function makeTools(session) {
  const step = (icon, text, extra) => session.onStep({ icon, text, ...extra })
  const record = async path => { if (!session.changes.has(path)) session.changes.set(path, { before: isFile(path) ? await fileText(path) : null }) }
  return [
    {
      name: 'list_files',
      description: 'List every file and folder in the open project with its size in characters. Returns plain text, one path per line.',
      execute: () => {
        step('folder', 'ファイル一覧を確認')
        return app.files.map(f => (f.dir ? f.path + '/' : `${f.path} (${(app.contents.get(f.path) || '').length} chars)`)).join('\n') || '(empty project)'
      },
    },
    {
      name: 'read_file',
      description: 'Read a project file. Returns its lines prefixed with line numbers ("12| code"); the prefix is not part of the file. Use start_line/end_line for a part of a long file.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } }, required: ['path'] },
      execute: async input => {
        const path = cleanPath(input.path)
        const text = await fileText(path)
        if (text === null || text === undefined) throw new Error(`${path} does not exist. Existing files: ${app.files.filter(f => !f.dir).map(f => f.path).join(', ')}`)
        const total = text.split('\n').length
        let s = Number(input.start_line) || 1, e = Number(input.end_line) || total
        if (e - s > 700) e = s + 700
        step('file', `${path} を読む${s > 1 || e < total ? ` (${s}〜${Math.min(e, total)} 行)` : ''}`)
        let body = numbered(text, s, e)
        if (body.length > MAX_TOOL) { body = body.slice(0, MAX_TOOL); body = body.slice(0, body.lastIndexOf('\n')) }
        const shown = body.split('\n').length
        const last = s + shown - 1
        return `${path} (${total} lines)\n${body}${last < total ? `\n… (lines ${last + 1}-${total} not shown; call read_file with start_line=${last + 1})` : ''}`
      },
    },
    {
      name: 'search_files',
      description: 'Search all project files for text (case-insensitive) or a JavaScript regular expression. Returns "path:line: text" for up to 80 matches.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, regex: { type: 'boolean' } }, required: ['query'] },
      execute: async input => {
        const q = String(input.query || '')
        step('search', `「${q}」を検索`)
        let re
        try { re = input.regex ? new RegExp(q, 'i') : null } catch (e) { throw new Error('Invalid regex: ' + e.message) }
        const low = q.toLowerCase()
        const out = []
        for (const f of app.files) {
          if (f.dir) continue
          const text = await fileText(f.path)
          if (!text || text.length > 2000000) continue
          const lines = text.split('\n')
          for (let i = 0; i < lines.length && out.length < 80; i++) {
            const l = lines[i]
            if (re ? re.test(l) : l.toLowerCase().includes(low)) out.push(`${f.path}:${i + 1}: ${l.trim().slice(0, 200)}`)
          }
        }
        return out.length ? out.join('\n') : 'No matches.'
      },
    },
    {
      name: 'edit_file',
      description: 'Edit a file by replacing old_text with new_text. old_text must match the current file exactly once (copy it from read_file without the line-number prefix, include enough lines to be unique). Returns the edited region with line numbers and any syntax problems found.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['path', 'old_text', 'new_text'] },
      execute: input => serial(async () => {
        const path = cleanPath(input.path)
        const text = await fileText(path)
        if (text === null || text === undefined) throw new Error(`${path} does not exist. Use write_file to create it.`)
        const r = applyReplace(text, input.old_text, input.new_text, !!input.replace_all)
        await record(path)
        step('edit', `${path} を編集`, { path })
        await writeText(path, r.text, { focus: session.focusEdits && session.changes.size === 1 })
        const startLine = lineAt(r.text, r.from)
        const endLine = startLine + String(input.new_text || '').split('\n').length - 1
        const probs = problemsOf(path, r.text, { max: 8, warnings: false })
        return `OK: edited ${path}${r.count > 1 ? ` (${r.count} places)` : ''}${r.loose ? ' (matched ignoring indentation)' : ''}.\n${numbered(r.text, startLine - 2, endLine + 2)}${probs.length ? '\nProblems now in file:\n' + problemsText(probs) : ''}`
      }),
    },
    {
      name: 'write_file',
      description: 'Create a new file or replace a whole file with content. Folders are created automatically. Prefer edit_file for small changes to existing files. Returns OK and any syntax problems.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      execute: input => serial(async () => {
        const path = cleanPath(input.path)
        if (!path || path.endsWith('/')) throw new Error('Invalid path.')
        if (app.files.some(f => f.path === path && f.dir)) throw new Error(`${path} is a folder.`)
        const content = input.content == null ? '' : String(input.content)
        const existed = isFile(path)
        await record(path)
        step(existed ? 'edit' : 'newFile', existed ? `${path} を書き換え` : `${path} を作成`, { path })
        if (!existed) {
          await vfs.writeFile(app.project.id, path, content)
          app.contents.set(path, content)
          await refreshFiles()
          await app.editors.open(path, { activate: !!session.focusEdits && session.changes.size === 1 })
        } else await writeText(path, content, { focus: session.focusEdits && session.changes.size === 1 })
        const probs = problemsOf(path, content, { max: 8, warnings: false })
        return `OK: ${existed ? 'replaced' : 'created'} ${path} (${content.split('\n').length} lines).${probs.length ? '\nProblems:\n' + problemsText(probs) : ''}`
      }),
    },
    {
      name: 'get_problems',
      description: "Run the editor's checker (syntax errors, undefined variables, typos, wrong API usage) on a Luau file. Returns one problem per line, or 'No problems.'",
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      execute: async input => {
        const path = cleanPath(input.path)
        const text = await fileText(path)
        if (text === null || text === undefined) throw new Error(`${path} does not exist.`)
        step('check', `${path} をチェック`)
        const list = problemsOf(path, text, { max: 40 })
        return list.length ? problemsText(list) : 'No problems.'
      },
    },
    {
      name: 'run_code',
      description: "Run a Luau file in ForgeCode's built-in Roblox emulator (simplified: LocalPlayer, Workspace, GUI preview, Drawing, executor functions; real servers and most HTTP are unavailable). Returns printed output, runtime errors with file:line, and a text description of the visible GUI/Drawing objects with their screen positions after `seconds` (default 3, max 10).",
      inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'File to run. Default: the project main file.' }, seconds: { type: 'number' } } },
      execute: async (input, ctx) => {
        if (!app.runner) throw new Error('Runner unavailable.')
        let path = input.path ? cleanPath(input.path) : null
        if (path && !isFile(path)) throw new Error(`${path} does not exist.`)
        const sec = Math.max(1, Math.min(10, Number(input.seconds) || 3))
        step('play', `${path || '実行ファイル'} を実行 (${sec} 秒)`)
        const r = await app.runner.runAndCollect({ path, seconds: sec, signal: ctx && ctx.signal })
        session.ran = true
        if (!r.started) return 'Could not start the run.'
        const out = r.output.filter(o => o.kind !== 'meta').slice(-60).map(o => `[${o.kind}] ${o.text}`)
        const how = { idle: 'finished normally', done: 'finished normally', error: 'stopped by an error', timeout: 'stopped: time limit (possible infinite loop)', stopped: 'stopped' }
        const parts = [`Run: ${r.done ? how[r.done] || r.done : r.stillRunning ? `still running after ${sec}s (left running so the user can see it)` : 'stopped'}`]
        parts.push(out.length ? 'Output (last lines):\n' + out.join('\n') : 'Output: (nothing printed)')
        if (r.errors.length) parts.push('Errors:\n' + r.errors.slice(0, 8).map(e => `- ${e.text}${e.traceback && e.traceback.length > 1 ? '\n  traceback: ' + e.traceback.slice(0, 5).join(' <- ') : ''}`).join('\n'))
        else parts.push('Errors: none')
        if (r.screen) {
          if (r.screen.gui) parts.push('Screen GUI:\n' + r.screen.gui)
          if (r.screen.drawings) parts.push('Drawing objects:\n' + r.screen.drawings)
          if (r.screen.workspace) parts.push('Workspace children:\n' + r.screen.workspace)
        }
        session.onStep({ icon: r.errors.length ? 'close' : 'check', text: r.errors.length ? `エラー ${r.errors.length} 件` : '実行できました', kind: r.errors.length ? 'err' : 'ok' })
        return clip(parts.join('\n\n'))
      },
    },
    {
      name: 'lookup_api',
      description: 'Look up Roblox / Luau / executor API from the bundled API data: a class ("TweenService"), a member ("Humanoid.WalkSpeed"), an enum ("Enum.KeyCode"), a library ("string", "crypt"), a datatype ("CFrame") or an executor function ("hookmetamethod", "Drawing"). Returns signatures and short notes.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      execute: input => {
        step('book', `API を調べる: ${String(input.query || '').slice(0, 40)}`)
        return clip(lookupApi(input.query))
      },
    },
  ]
}

// ============================================================
// 依頼文 (Claude は会話を覚えていないので、毎回まとめて送ります)
// ============================================================
const MODE_TEXT = {
  executor: 'Executor mode: client-side Roblox executor scripts (a LocalScript-like context with UNC executor APIs: getgenv, Drawing, hookmetamethod, hookfunction, writefile/readfile, request, gethui, getconnections, firesignal, etc.).',
  studio: 'Studio mode: Roblox Studio scripts (Script / LocalScript / ModuleScript by file name: *.server.lua, *.client.lua, otherwise by location). Use only official Roblox APIs.',
}

export function rulesTurn({ tools }) {
  return `You are Claude, the coding agent built into ForgeCode — a code editor for Roblox Luau that people use on phones and tablets. You work like Claude Code inside this app${tools ? ': you can read, search, edit, create and run the project files with the tools provided' : ''}.

${tools ? `How to work:
- Questions or explanations: answer directly. Read files first when the answer depends on them.
- Changes: read the relevant file (read_file shows line numbers), then make small precise edits with edit_file (old_text copied exactly, unique). Use write_file only for new files or complete rewrites.
- After changing Luau code, verify: run_code (it returns output, errors and a description of the GUI on screen) and fix what fails. Do not loop on the same failure more than twice; explain instead.
- Keep the user's style (indentation, naming). Do not touch unrelated code. Do not create extra files unless asked.
- The emulator is simplified: remote HTTP, real servers and other players mostly do not exist. If a feature cannot be tested there, say so instead of hacking around it.
` : `You cannot edit files directly here. Show complete, ready-to-paste code in \`\`\`lua blocks (the user can insert or replace with one tap).
`}
Luau / Roblox guidance: use task.wait/task.spawn/task.delay, game:GetService, :Connect, set properties before Parent, prefer UDim2.fromScale/fromOffset, check for nil (FindFirstChild / WaitForChild with timeout), clean up connections. Make GUI that fits phone screens (scale-based sizes, UIListLayout/UIPadding/UICorner where suitable).

Reply in Japanese (the user is Japanese; many are beginners). Be concise and practical. ${tools ? 'At the end, summarize what you changed as a short bullet list (file and what). Do not paste whole files you already wrote with tools.' : ''}`
}

export function contextBlock({ includeFile = true, extra = '' } = {}) {
  const p = app.project
  if (!p) return '<context>No project is open.</context>'
  const mode = getMode()
  const lines = [`Project "${p.name}" — ${MODE_TEXT[mode] || MODE_TEXT.studio}`]
  const files = app.files.filter(f => !f.dir)
  lines.push('Files:\n' + (files.slice(0, 200).map(f => `- ${f.path} (${(app.contents.get(f.path) || '').length} chars)${f.path === app.editors.active ? ' [active]' : ''}${p.runTarget === f.path ? ' [run target]' : ''}`).join('\n') || '(none)'))
  const doc = app.editors.activeDoc()
  const view = app.editors.activeView()
  if (doc) {
    const st = view && app.editors.viewFor(doc.path) === view ? view.state : doc.state
    const sel = st.selection.main
    const text = st.doc.toString()
    const curLine = st.doc.lineAt(sel.head).number
    let info = `Active file: ${doc.path}, cursor at line ${curLine}`
    if (!sel.empty) {
      const a = st.doc.lineAt(sel.from).number, b = st.doc.lineAt(sel.to).number
      info += `\nSelected text (lines ${a}-${b}):\n<selection>\n${st.sliceDoc(sel.from, sel.to).slice(0, 20000)}\n</selection>`
    }
    lines.push(info)
    const probs = problemsOf(doc.path, text, { max: 12 })
    if (probs.length) lines.push('Problems the editor shows in the active file:\n' + problemsText(probs))
    if (includeFile) {
      const total = st.doc.lines
      const body = text.length <= 60000 ? numbered(text) : numbered(text, Math.max(1, curLine - 300), Math.min(total, curLine + 300)) + `\n… (file has ${total} lines; use read_file for the rest)`
      lines.push(`<active_file path="${doc.path}" lines="${total}">\n${body}\n</active_file>`)
    }
  }
  if (app.runner) {
    const errs = [...document.querySelectorAll('.out-error')].slice(-3).map(e => e.dataset.text).filter(Boolean)
    if (errs.length) lines.push('Latest run errors in the console:\n' + errs.map(e => '- ' + e).join('\n'))
  }
  if (extra) lines.push(extra)
  return `<context>\n${lines.join('\n\n')}\n</context>`
}

// ============================================================
// エージェントの実行
// ============================================================
// history: [{ role, content }] (これまでの会話。文脈は含めない)
export async function runAgent({ history = [], text, images, tier = 'default', onText, onStep = () => {}, signal, focusEdits = false }) {
  const tools = canUseTools()
  const session = { changes: new Map(), onStep, focusEdits, ran: false }
  const turns = [{ role: 'user', content: rulesTurn({ tools }) }]
  // 古い会話から削る (合計 140 KB 程度まで)
  let budget = 140000
  const hist = []
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i]
    budget -= t.content.length
    if (budget < 0) break
    hist.unshift(t)
  }
  while (hist.length && hist[0].role !== 'user') hist.shift()
  if (hist.length) turns.push({ role: 'assistant', content: '了解しました。' }, ...hist)
  const ctx = contextBlock({ includeFile: getSettings().aiIncludeFile !== false })
  const imgNote = images && images.length ? `\n(${images.length} image(s) attached by the user.)` : ''
  turns.push({ role: 'user', content: `${ctx}\n\n<request>\n${text}${imgNote}\n</request>` })
  let result
  try {
    result = await ask(turns, { tier, onText, signal, tools: tools ? makeTools(session) : undefined, images })
  } catch (e) {
    e.changes = finishChanges(session)
    throw e
  }
  return { text: result.text, truncated: result.truncated, changes: await finishChangesAsync(session), ran: session.ran }
}

function finishChanges(session) {
  const out = []
  for (const [path, c] of session.changes) out.push({ path, before: c.before })
  return out
}
async function finishChangesAsync(session) {
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

// ============================================================
// 1 回で終わる小さな修正 (エラーの修正・選択範囲の書き換え)
// ============================================================
export async function quickEdit({ path, instruction, focusLine, signal, tier = 'default' }) {
  const text = await fileText(path)
  if (text === null || text === undefined) throw new AiError('invalid_request', 'ファイルが見つかりません')
  const total = text.split('\n').length
  const big = text.length > 60000
  const s = big ? Math.max(1, (focusLine || 1) - 250) : 1, e = big ? Math.min(total, (focusLine || 1) + 250) : total
  const mode = getMode()
  const prompt = `You are the quick-fix engine of ForgeCode, a Roblox Luau editor. ${MODE_TEXT[mode] || ''}
Task: ${instruction}

File ${path} (${total} lines${big ? `, showing lines ${s}-${e}` : ''}). Each line starts with its number and "| " — that prefix is NOT part of the file:
${numbered(text, s, e)}

Reply with only a JSON object: {"edits":[{"old_text":"exact text from the file (no line-number prefix), unique","new_text":"replacement"}],"summary":"one short sentence in Japanese"}
Keep edits minimal and keep the existing indentation style. If nothing should change, return {"edits":[],"summary":"..."}.`
  const res = await askJson(prompt, { tier, signal, cache: false })
  const edits = res && Array.isArray(res.edits) ? res.edits : []
  let next = text
  let firstFrom = -1
  for (const ed of edits) {
    const r = applyReplace(next, ed.old_text, ed.new_text)
    if (firstFrom < 0 || r.from < firstFrom) firstFrom = r.from
    next = r.text
  }
  return { before: text, after: next, summary: res && typeof res.summary === 'string' ? res.summary : '', count: edits.length, at: firstFrom }
}

// quickEdit の結果を文書に入れる (1 回の「元に戻す」で戻せる)
export async function applyQuick(path, r) {
  if (r.after === r.before) return false
  await writeText(path, r.after, { focus: true })
  const view = app.editors.viewFor(path)
  if (view && r.at >= 0) view.dispatch({ selection: EditorSelection.cursor(Math.min(r.at, view.state.doc.length)), scrollIntoView: true })
  return true
}
