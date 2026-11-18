// AI がファイルを扱うための部品 (読み書き・差分・変更の記録と取り消し)
// ・AI の変更はすべて記録され、まとめて元に戻せます (エディタの「元に戻す」でも戻せます)
import { app, refreshFiles } from './app.js'
import * as vfs from './vfs.js'

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
// 変更の記録
// ============================================================
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
