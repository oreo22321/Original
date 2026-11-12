// アプリ全体の状態と共通操作
import * as vfs from './vfs.js'
import { getSettings, emit, saveSession, loadSession, setMode } from './store.js'
import { toast } from './ui.js'

export const app = {
  project: null,       // { id, name, kind: 'studio' | 'executor', runTarget? }
  files: [],           // [{ path, dir, size, mtime }]
  contents: new Map(), // path → 内容 (補完の require 解決や、実行時にディスクを読まないためのキャッシュ)
  commands: new Map(), // id → { title, run, key, icon }
  editors: null,       // EditorManager
  wb: null,            // Workbench
  runner: null,
}

export function command(id, title, run, opts = {}) {
  app.commands.set(id, { id, title, run, ...opts })
}
export function runCommand(id, ...args) {
  const c = app.commands.get(id)
  if (c) return c.run(...args)
}

export async function refreshFiles() {
  if (!app.project) { app.files = []; app.contents = new Map(); emit('files'); return }
  const all = await vfs.readAll(app.project.id)
  const contents = new Map()
  for (const f of all) if (!f.dir) contents.set(f.path, f.content || '')
  app.contents = contents
  app.files = all.map(f => ({ path: f.path, dir: !!f.dir, size: (f.content || '').length, mtime: f.mtime })).sort((a, b) => a.path.localeCompare(b.path))
  emit('files')
}

// 既存プロジェクトの種類を中身から推測 (以前のバージョンで作ったプロジェクト用)
const EXEC_HINT = /\b(getgenv|writefile|readfile|isfile|hookfunction|hookmetamethod|identifyexecutor|gethui|setclipboard|getrawmetatable|queue_on_teleport|firesignal|getconnections)\s*\(|loadstring\s*\(\s*game:HttpGet|\bDrawing\.new\b|\bsyn\./
function inferKind() {
  if (app.files.some(f => f.path === 'workspace' || f.path.startsWith('workspace/'))) return 'executor'
  for (const [path, src] of app.contents) if (/\.luau?$/i.test(path) && EXEC_HINT.test(src)) return 'executor'
  return 'studio'
}

export function persistSession() {
  if (!app.project || !app.editors) return
  const s = loadSession()
  s.project = app.project.id
  s.byProject = s.byProject || {}
  s.byProject[app.project.id] = app.editors.sessionData()
  saveSession(s)
}

export async function openProject(id, { openMain } = {}) {
  const p = await vfs.getProject(id)
  if (!p) return false
  if (app.editors) await app.editors.closeAll({ force: false, silent: true })
  if (app.runner && app.runner.running) app.runner.stop(true)
  p.opened = Date.now()
  app.project = p
  await refreshFiles()
  if (p.kind !== 'studio' && p.kind !== 'executor') p.kind = inferKind()
  await vfs.putProject(p)
  setMode(p.kind)
  emit('project', p)
  const s = loadSession()
  const sess = s.byProject && s.byProject[id]
  let opened = false
  if (sess && sess.tabs && sess.tabs.length) {
    for (const t of sess.tabs) {
      if (app.contents.has(t.path)) await app.editors.open(t.path, { activate: false, cursor: t.cursor, scroll: t.scroll })
    }
    if (sess.active && app.editors.has(sess.active)) { app.editors.activate(sess.active); opened = true }
    else if (app.editors.docs.size) { app.editors.activate([...app.editors.docs.keys()][0]); opened = true }
  }
  if (!opened && openMain) {
    const main = openMain === true ? app.files.find(f => !f.dir && /(^|\/)(main|init)[\w.]*\.luau?$/.test(f.path)) || app.files.find(f => !f.dir && /\.luau?$/.test(f.path)) : { path: openMain }
    if (main) await app.editors.open(main.path)
  }
  persistSession()
  return true
}

// プロジェクトのモード (Studio / Executor) を切り替える
export async function setProjectKind(kind) {
  if (!app.project || app.project.kind === kind) return
  app.project.kind = kind === 'executor' ? 'executor' : 'studio'
  await vfs.putProject(app.project)
  setMode(app.project.kind)
  emit('project', app.project)
}

// ▶ で実行するファイルを固定 / 解除
export async function setRunTarget(path) {
  if (!app.project) return
  app.project.runTarget = path || null
  await vfs.putProject(app.project)
  emit('project', app.project)
}

export async function newFile(path, content = '') {
  if (!app.project) return
  path = vfs.normPath(path)
  if (await vfs.exists(app.project.id, path)) { toast(`"${path}" は既に存在します`, { kind: 'error' }); return false }
  await vfs.writeFile(app.project.id, path, content)
  await refreshFiles()
  await app.editors.open(path)
  return true
}

export async function newFolder(path) {
  if (!app.project) return
  path = vfs.normPath(path)
  if (await vfs.exists(app.project.id, path)) { toast(`"${path}" は既に存在します`, { kind: 'error' }); return false }
  await vfs.mkdir(app.project.id, path)
  await refreshFiles()
  return true
}

export async function deletePath(path) {
  const removed = await vfs.remove(app.project.id, path)
  for (const p of removed) app.editors.forceClose(p)
  if (app.project.runTarget && removed.includes(app.project.runTarget)) await setRunTarget(null)
  await refreshFiles()
  persistSession()
}

export async function renamePath(from, to) {
  const moved = await vfs.rename(app.project.id, from, to)
  for (const [a, b] of moved) {
    emit('renamed', { from: a, to: b })
    app.editors.renamed(a, b)
    if (app.project.runTarget === a) await setRunTarget(b)
  }
  await refreshFiles()
  persistSession()
}

export async function writeProjectFile(path, content, { reload = true } = {}) {
  await vfs.writeFile(app.project.id, path, content)
  app.contents.set(path, content)
  if (reload && app.editors) app.editors.externalChange(path, content)
}

export function isDirty() {
  return app.editors ? app.editors.anyDirty() : false
}

export function settings() { return getSettings() }
