// アプリ全体の状態と共通操作
import * as vfs from './vfs.js'
import { getSettings, emit, saveSession, loadSession } from './store.js'
import { toast } from './ui.js'

export const app = {
  project: null,       // { id, name }
  files: [],           // [{ path, dir }]
  commands: new Map(), // id → { title, run, key, icon, category }
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
  if (!app.project) { app.files = []; emit('files'); return }
  app.files = (await vfs.listFiles(app.project.id)).sort((a, b) => a.path.localeCompare(b.path))
  emit('files')
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
  p.opened = Date.now()
  await vfs.putProject(p)
  app.project = p
  await refreshFiles()
  emit('project', p)
  const s = loadSession()
  const sess = s.byProject && s.byProject[id]
  let opened = false
  if (sess && sess.tabs && sess.tabs.length) {
    for (const t of sess.tabs) {
      if (app.files.some(f => f.path === t.path && !f.dir)) await app.editors.open(t.path, { activate: false, cursor: t.cursor, scroll: t.scroll })
    }
    if (sess.active && app.editors.has(sess.active)) { app.editors.activate(sess.active); opened = true }
    else if (app.editors.docs.size) { app.editors.activate([...app.editors.docs.keys()][0]); opened = true }
  }
  if (!opened && openMain) {
    const main = openMain === true ? app.files.find(f => !f.dir && /(^|\/)(main|init)\.(luau?|py)$/.test(f.path)) : { path: openMain }
    if (main) await app.editors.open(main.path)
  }
  persistSession()
  return true
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
  await refreshFiles()
  persistSession()
}

export async function renamePath(from, to) {
  const moved = await vfs.rename(app.project.id, from, to)
  for (const [a, b] of moved) app.editors.renamed(a, b)
  await refreshFiles()
  persistSession()
}

export async function writeProjectFile(path, content, { reload = true } = {}) {
  await vfs.writeFile(app.project.id, path, content)
  if (reload && app.editors) app.editors.externalChange(path, content)
}

export function isDirty() {
  return app.editors ? app.editors.anyDirty() : false
}

export function settings() { return getSettings() }
