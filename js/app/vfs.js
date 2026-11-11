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
    req.onsuccess = () => {
      const db = req.result
      // 別のタブが新しい版を開いた / ブラウザが接続を閉じた → 次の操作で開き直す
      db.onversionchange = () => { try { db.close() } catch {} dbPromise = null }
      db.onclose = () => { dbPromise = null }
      resolve(db)
    }
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
    let t
    try { t = db.transaction(stores, mode) } catch (e) { dbPromise = null; reject(e); return }
    let result
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error || new Error('transaction aborted'))
    result = fn(t)
  })
}

// 一時的な失敗 (接続が閉じられた・ストレージが混雑) に備えて、少し待ってやり直す
async function retry(fn, times = 3) {
  let err
  for (let i = 0; i < times; i++) {
    try { return await fn() } catch (e) {
      err = e
      if (e && e.name === 'QuotaExceededError') break
      await new Promise(r => setTimeout(r, 120 * (i + 1)))
    }
  }
  if (err && err.name === 'QuotaExceededError') throw new Error('端末の空き容量が足りません。不要なプロジェクトを削除してください')
  throw err
}

// ---- フォルダの存在キャッシュ (保存のたびに親フォルダを調べ直さない) ----
const knownDirs = new Map()
const dirSet = pid => { let s = knownDirs.get(pid); if (!s) knownDirs.set(pid, s = new Set()); return s }

// ---- 下書き (保存が終わる前にアプリが閉じられても復元できるよう、localStorage に同期的に書く) ----
const DRAFT = 'forgecode.draft.'
export function putDraft(pid, path, content) {
  if (content.length > 400000) return false
  try { localStorage.setItem(DRAFT + pid + ':' + path, JSON.stringify({ t: Date.now(), c: content })); return true } catch { return false }
}
export function getDraft(pid, path) {
  try { const raw = localStorage.getItem(DRAFT + pid + ':' + path); return raw ? JSON.parse(raw) : null } catch { return null }
}
export function clearDraft(pid, path) {
  try { localStorage.removeItem(DRAFT + pid + ':' + path) } catch {}
}
export function clearDrafts(pid) {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(DRAFT + pid + ':')) localStorage.removeItem(k) } catch {}
}

// ---- 別のタブでの変更を知らせる ----
let channel = null
try { channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('forgecode.fs') : null } catch {}
export function onRemoteChange(fn) { if (channel) channel.onmessage = e => fn(e.data) }
const announce = (pid, path, op) => { try { if (channel) channel.postMessage({ pid, path, op }) } catch {} }
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

export async function createProject(name, files = {}, extra = {}) {
  const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const p = { id, name, created: Date.now(), opened: Date.now(), ...extra }
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
  knownDirs.delete(id)
  clearDrafts(id)
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
  const known = dirSet(pid)
  for (let i = 1; i < parts.length; i++) {
    const d = parts.slice(0, i).join('/')
    if (known.has(d)) continue
    if (!(await exists(pid, d))) await putRaw({ pid, path: d, dir: true, mtime: Date.now() })
    known.add(d)
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
  await retry(async () => {
    await ensureParents(pid, path)
    await putRaw({ pid, path, content: String(content ?? ''), mtime: Date.now() })
  })
  announce(pid, path, 'write')
}

// パスだけの一覧 (中身を読み込まないので速い)
export async function listPaths(pid) {
  const db = await openDB()
  if (!db) return Object.values(memory.files).filter(f => f.pid === pid).map(f => f.path)
  const keys = await tx(db, ['files'], 'readonly', t => reqP(t.objectStore('files').index('pid').getAllKeys(pid)))
  return (await keys).map(k => k[1])
}

export async function mkdir(pid, path) {
  path = normPath(path)
  if (!path) return
  await ensureParents(pid, path + '/x')
}

export async function remove(pid, path) {
  path = normPath(path)
  const targets = (await listPaths(pid)).filter(p => p === path || p.startsWith(path + '/'))
  knownDirs.delete(pid)
  for (const p of targets) clearDraft(pid, p)
  const db = await openDB()
  if (!db) { for (const p of targets) delete memory.files[pid + ':' + p]; saveMemory(); return targets }
  await tx(db, ['files'], 'readwrite', t => { const s = t.objectStore('files'); for (const p of targets) s.delete([pid, p]) })
  announce(pid, path, 'remove')
  return targets
}

export async function rename(pid, from, to) {
  from = normPath(from); to = normPath(to)
  if (from === to) return []
  if (await exists(pid, to)) throw new Error(`"${to}" は既に存在します`)
  const all = await readAll(pid)
  const moved = all.filter(f => f.path === from || f.path.startsWith(from + '/'))
  knownDirs.delete(pid)
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
