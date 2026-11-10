// 仮想ファイルシステム (IndexedDB に保存)
// プロジェクト単位でファイルを管理します。IndexedDB が使えない場合は localStorage に保存します。
const DB_NAME = 'forgecode'
const DB_VERSION = 1
let dbPromise = null
let memory = null // フォールバック

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    let req
    try { req = indexedDB.open(DB_NAME, DB_VERSION) } catch { resolve(null); return }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('files')) {
        const fs = db.createObjectStore('files', { keyPath: ['pid', 'path'] })
        fs.createIndex('pid', 'pid')
      }
      if (!db.objectStoreNames.contains('history')) {
        const hs = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true })
        hs.createIndex('file', ['pid', 'path'])
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  }).then(db => {
    if (!db) initMemory()
    return db
  })
  return dbPromise
}

function initMemory() {
  if (memory) return
  try { memory = JSON.parse(localStorage.getItem('forgecode.fs.fallback') || 'null') } catch {}
  if (!memory) memory = { projects: {}, files: {}, history: [] }
}
function saveMemory() {
  try { localStorage.setItem('forgecode.fs.fallback', JSON.stringify(memory)) } catch {}
}

function tx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode)
    let result
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error || new Error('transaction aborted'))
    result = fn(t)
  })
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })

export function normPath(p) {
  return String(p).replace(/\\/g, '/').split('/').filter(x => x && x !== '.').join('/')
}
export const dirname = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
export const basename = p => p.slice(p.lastIndexOf('/') + 1)

// ---- プロジェクト ----
export async function listProjects() {
  const db = await openDB()
  if (!db) return Object.values(memory.projects).sort((a, b) => b.opened - a.opened)
  const all = await tx(db, ['projects'], 'readonly', t => reqP(t.objectStore('projects').getAll()))
  return (await all).sort((a, b) => (b.opened || 0) - (a.opened || 0))
}

export async function getProject(id) {
  const db = await openDB()
  if (!db) return memory.projects[id] || null
  return tx(db, ['projects'], 'readonly', t => reqP(t.objectStore('projects').get(id))).then(r => r)
}

export async function putProject(p) {
  const db = await openDB()
  if (!db) { memory.projects[p.id] = p; saveMemory(); return p }
  await tx(db, ['projects'], 'readwrite', t => { t.objectStore('projects').put(p) })
  return p
}

export async function createProject(name, files = {}) {
  const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const p = { id, name, created: Date.now(), opened: Date.now() }
  await putProject(p)
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('/')) await mkdir(id, path)
    else await writeFile(id, path, content)
  }
  return p
}

export async function deleteProject(id) {
  const db = await openDB()
  if (!db) {
    delete memory.projects[id]
    for (const k of Object.keys(memory.files)) if (k.startsWith(id + ':')) delete memory.files[k]
    memory.history = memory.history.filter(h => h.pid !== id)
    saveMemory()
    return
  }
  const files = await listFiles(id)
  await tx(db, ['projects', 'files', 'history'], 'readwrite', t => {
    t.objectStore('projects').delete(id)
    const fs = t.objectStore('files')
    for (const f of files) fs.delete([id, f.path])
    const idx = t.objectStore('history').index('file')
    for (const f of files) {
      const r = idx.openCursor(IDBKeyRange.only([id, f.path]))
      r.onsuccess = () => { const c = r.result; if (c) { c.delete(); c.continue() } }
    }
  })
}

// ---- ファイル ----
// 返り値: [{ path, dir: boolean, size, mtime }]
export async function listFiles(pid) {
  const db = await openDB()
  if (!db) {
    return Object.values(memory.files).filter(f => f.pid === pid).map(f => ({ path: f.path, dir: !!f.dir, size: (f.content || '').length, mtime: f.mtime }))
  }
  const all = await tx(db, ['files'], 'readonly', t => reqP(t.objectStore('files').index('pid').getAll(pid)))
  return (await all).map(f => ({ path: f.path, dir: !!f.dir, size: (f.content || '').length, mtime: f.mtime }))
}

export async function readFile(pid, path) {
  path = normPath(path)
  const db = await openDB()
  if (!db) { const f = memory.files[pid + ':' + path]; return f && !f.dir ? f.content : null }
  const f = await tx(db, ['files'], 'readonly', t => reqP(t.objectStore('files').get([pid, path])))
  const r = await f
  return r && !r.dir ? r.content : null
}

export async function readAll(pid) {
  const db = await openDB()
  if (!db) return Object.values(memory.files).filter(f => f.pid === pid)
  return tx(db, ['files'], 'readonly', t => reqP(t.objectStore('files').index('pid').getAll(pid))).then(r => r)
}

export async function exists(pid, path) {
  path = normPath(path)
  const db = await openDB()
  if (!db) return !!memory.files[pid + ':' + path]
  const f = await tx(db, ['files'], 'readonly', t => reqP(t.objectStore('files').get([pid, path])))
  return !!(await f)
}

async function ensureParents(pid, path) {
  const parts = path.split('/')
  for (let i = 1; i < parts.length; i++) {
    const d = parts.slice(0, i).join('/')
    if (!(await exists(pid, d))) await putRaw({ pid, path: d, dir: true, mtime: Date.now() })
  }
}

async function putRaw(rec) {
  const db = await openDB()
  if (!db) { memory.files[rec.pid + ':' + rec.path] = rec; saveMemory(); return }
  await tx(db, ['files'], 'readwrite', t => { t.objectStore('files').put(rec) })
}

export async function writeFile(pid, path, content) {
  path = normPath(path)
  if (!path) throw new Error('ファイル名が空です')
  await ensureParents(pid, path)
  await putRaw({ pid, path, content: String(content ?? ''), mtime: Date.now() })
}

export async function mkdir(pid, path) {
  path = normPath(path)
  if (!path) return
  await ensureParents(pid, path + '/x')
}

export async function remove(pid, path) {
  path = normPath(path)
  const files = await listFiles(pid)
  const targets = files.filter(f => f.path === path || f.path.startsWith(path + '/')).map(f => f.path)
  const db = await openDB()
  if (!db) { for (const p of targets) delete memory.files[pid + ':' + p]; saveMemory(); return targets }
  await tx(db, ['files'], 'readwrite', t => { const s = t.objectStore('files'); for (const p of targets) s.delete([pid, p]) })
  return targets
}

export async function rename(pid, from, to) {
  from = normPath(from); to = normPath(to)
  if (from === to) return []
  if (await exists(pid, to)) throw new Error(`"${to}" は既に存在します`)
  const all = await readAll(pid)
  const moved = all.filter(f => f.path === from || f.path.startsWith(from + '/'))
  await ensureParents(pid, to)
  for (const f of moved) {
    const np = to + f.path.slice(from.length)
    await putRaw({ ...f, path: np, mtime: Date.now() })
  }
  await remove(pid, from)
  return moved.map(f => [f.path, to + f.path.slice(from.length)])
}

// ---- ローカル履歴 ----
const MAX_HISTORY = 40
export async function addHistory(pid, path, content) {
  const db = await openDB()
  const rec = { pid, path, time: Date.now(), content }
  if (!db) {
    const list = memory.history.filter(h => h.pid === pid && h.path === path)
    if (list.length && list[list.length - 1].content === content) return
    memory.history.push(rec)
    const mine = memory.history.filter(h => h.pid === pid && h.path === path)
    if (mine.length > MAX_HISTORY) memory.history.splice(memory.history.indexOf(mine[0]), 1)
    saveMemory()
    return
  }
  const list = await getHistory(pid, path)
  if (list.length && list[0].content === content) return
  await tx(db, ['history'], 'readwrite', t => {
    const s = t.objectStore('history')
    s.add(rec)
    for (const old of list.slice(MAX_HISTORY - 1)) s.delete(old.id)
  })
}

export async function getHistory(pid, path) {
  const db = await openDB()
  if (!db) return memory.history.filter(h => h.pid === pid && h.path === path).sort((a, b) => b.time - a.time)
  const r = await tx(db, ['history'], 'readonly', t => reqP(t.objectStore('history').index('file').getAll([pid, path])))
  return (await r).sort((a, b) => b.time - a.time)
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate()
  } catch {}
  return null
}

export async function requestPersist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist() } catch {}
  return false
}
