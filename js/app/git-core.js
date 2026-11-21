// ForgeCode の git: プロジェクトの変更を「コミット」として端末に記録します (本物の git と同じ考え方とコマンド)
// ・コミット・ステージ (index)・ブランチ・タグ・マージ (3-way)・revert・cherry-pick・stash・blame・.gitignore
// ・ファイルの中身は Git と同じ SHA-1 (blob) で記録するので、同じ中身は 1 つだけ保存します
// ・画面やターミナルとは切り離してあり、Node のテストでもそのまま動きます
//
// store: { get(key), put(key, value), del(key) }        記録の置き場所 (アプリでは IndexedDB)
//   'meta' … HEAD・ブランチ・タグ・index・stash など / 'c:<id>' … コミット / 'b:<id>' … ファイルの中身
// tree:  { list() → [path], read(path), write(path, content), remove(path) }   作業中のファイル
import { blobSha } from './github-core.js'

const enc = new TextEncoder()
export const isBinary = c => c instanceof Uint8Array
export const short = id => (id ? id.slice(0, 7) : '0000000')

async function sha1Text(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', enc.encode(s)))
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('')
}

export class GitError extends Error {}
const fail = msg => { throw new GitError(msg) }

// ============================================================
// 差分 (Myers のアルゴリズム)。同じ行の対応を返す
// ============================================================
export function diffOps(a, b) {
  // 前と後ろの同じ部分は先に除く (速くなる)
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf)
  const ops = []
  for (let i = 0; i < pre; i++) ops.push(['=', i, i])
  const mid = A.length + B.length > 200000 ? null : myers(A, B)
  if (mid) for (const [t, i, j] of mid) ops.push([t, i < 0 ? -1 : i + pre, j < 0 ? -1 : j + pre])
  else { for (let i = 0; i < A.length; i++) ops.push(['-', i + pre, -1]); for (let j = 0; j < B.length; j++) ops.push(['+', -1, j + pre]) }
  for (let k = 0; k < suf; k++) ops.push(['=', a.length - suf + k, b.length - suf + k])
  return ops
}
function myers(a, b) {
  const n = a.length, m = b.length
  if (!n) return b.map((_, j) => ['+', -1, j])
  if (!m) return a.map((_, i) => ['-', i, -1])
  const LIMIT = Math.min(n + m, 2000)   // 違いがこれより多いときは、まとめて置き換えとして扱う
  const off = LIMIT + 1
  const v = new Int32Array(2 * LIMIT + 3)
  const trace = []
  let found = -1
  for (let d = 0; d <= LIMIT && found < 0; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2))   // k の値は [k + d + 1] に
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) { x++; y++ }
      v[off + k] = x
      if (x >= n && y >= m) { found = d; break }
    }
  }
  if (found < 0) return null
  // 道をたどり直す
  const ops = []
  let x = n, y = m
  for (let d = found; d > 0; d--) {
    const vv = trace[d], at = k => vv[k + d + 1]
    const k = x - y
    const prevK = (k === -d || (k !== d && at(k - 1) < at(k + 1))) ? k + 1 : k - 1
    const px = at(prevK), py = px - prevK
    while (x > px && y > py) { x--; y--; ops.push(['=', x, y]) }
    if (x === px) { y--; ops.push(['+', -1, y]) } else { x--; ops.push(['-', x, -1]) }
  }
  while (x > 0 && y > 0) { x--; y--; ops.push(['=', x, y]) }
  return ops.reverse()
}

// 変わったところ (hunk): 元の [bs, be) を lines に置き換える
export function hunksOf(a, b) {
  const ops = diffOps(a, b)
  const out = []
  let cur = null, ai = 0
  for (const [t, i, j] of ops) {
    if (t === '=') { if (cur) { out.push(cur); cur = null } ai = i + 1; continue }
    if (!cur) cur = { bs: ai, be: ai, lines: [] }
    if (t === '-') { cur.be = i + 1; ai = i + 1 } else cur.lines.push(b[j])
  }
  if (cur) out.push(cur)
  return out
}

const splitLines = text => {
  if (text === '' || text === null || text === undefined) return { ls: [], nl: true }
  const ls = String(text).split('\n')
  const nl = ls.length > 1 && ls[ls.length - 1] === ''
  if (nl) ls.pop()
  return { ls, nl }
}

// unified diff (git diff と同じ形)。結果は [{ t: '@' | ' ' | '+' | '-' | '\\', s }]
const NNL = '\u0000'   // 最後の行に改行がない印
export function unifiedDiff(aText, bText, context = 3) {
  const A = splitLines(aText), B = splitLines(bText)
  const a = A.ls, b = B.ls
  if (!A.nl && a.length) a[a.length - 1] += NNL
  if (!B.nl && b.length) b[b.length - 1] += NNL
  const ops = diffOps(a, b)
  const out = []
  let i = 0
  while (i < ops.length) {
    while (i < ops.length && ops[i][0] === '=') i++
    if (i >= ops.length) break
    const start = Math.max(0, i - context)
    let end = i
    // 近くの変更はまとめる
    while (end < ops.length) {
      if (ops[end][0] !== '=') { end++; continue }
      let k = end
      while (k < ops.length && ops[k][0] === '=') k++
      if (k >= ops.length || k - end > context * 2) break
      end = k
    }
    const stop = Math.min(ops.length, end + context)
    const seg = ops.slice(start, stop)
    const as = countBefore(ops, start, 'a'), bs = countBefore(ops, start, 'b')
    const al = seg.filter(o => o[0] !== '+').length, bl = seg.filter(o => o[0] !== '-').length
    out.push({ t: '@', s: `@@ -${al ? as + 1 : as},${al} +${bl ? bs + 1 : bs},${bl} @@` })
    for (const [t, x, y] of seg) {
      const s = t === '+' ? b[y] : a[x]
      const cut = s.endsWith(NNL)
      out.push({ t: t === '=' ? ' ' : t, s: cut ? s.slice(0, -1) : s })
      if (cut) out.push({ t: '\\', s: ' No newline at end of file' })
    }
    i = stop
  }
  return out
}
function countBefore(ops, idx, side) {
  let n = 0
  for (let k = 0; k < idx; k++) if (side === 'a' ? ops[k][0] !== '+' : ops[k][0] !== '-') n++
  return n
}
export function diffStat(aText, bText) {
  let add = 0, del = 0
  for (const l of unifiedDiff(aText, bText, 0)) { if (l.t === '+') add++; else if (l.t === '-') del++ }
  return { add, del }
}

// ============================================================
// 3-way マージ (base から ours と theirs の両方が変えたとき)
// ============================================================
export function merge3(baseText, oursText, theirsText, { ours = 'HEAD', theirs = 'theirs' } = {}) {
  const base = baseText.split('\n'), o = oursText.split('\n'), t = theirsText.split('\n')
  const hs = [...hunksOf(base, o).map(h => ({ ...h, side: 'o' })), ...hunksOf(base, t).map(h => ({ ...h, side: 't' }))].sort((x, y) => x.bs - y.bs || x.be - y.be)
  const out = []
  let pos = 0, conflicts = 0, i = 0
  const touches = (g, h) => h.bs < g.end || (h.bs === g.end && (h.bs === h.be || g.empty)) || h.bs === g.start
  while (i < hs.length) {
    const g = { start: hs[i].bs, end: hs[i].be, empty: hs[i].bs === hs[i].be, items: [hs[i]] }
    i++
    while (i < hs.length && touches(g, hs[i])) { g.items.push(hs[i]); g.end = Math.max(g.end, hs[i].be); g.empty = g.empty || hs[i].bs === hs[i].be; i++ }
    out.push(...base.slice(pos, g.start))
    pos = g.end
    const sides = new Set(g.items.map(h => h.side))
    const build = side => {
      const r = []
      let p = g.start
      for (const h of g.items.filter(x => x.side === side)) { r.push(...base.slice(p, h.bs), ...h.lines); p = h.be }
      r.push(...base.slice(p, g.end))
      return r
    }
    if (sides.size === 1) { out.push(...build(g.items[0].side)); continue }
    const ov = build('o'), tv = build('t')
    if (ov.join('\n') === tv.join('\n')) { out.push(...ov); continue }
    conflicts++
    out.push(`<<<<<<< ${ours}`, ...ov, '=======', ...tv, `>>>>>>> ${theirs}`)
  }
  out.push(...base.slice(pos))
  return { text: out.join('\n'), conflicts }
}

// ============================================================
// .gitignore
// ============================================================
const DEFAULT_IGNORE = ['__pycache__/', '*.pyc', '.DS_Store', '.ipynb_checkpoints/']
function globToRe(p) {
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === '*') { if (p[i + 1] === '*') { re += '.*'; i++; if (p[i + 1] === '/') i++ } else re += '[^/]*' }
    else if (c === '?') re += '[^/]'
    else if (c === '[') { const j = p.indexOf(']', i); if (j > i) { re += p.slice(i, j + 1); i = j } else re += '\\[' }
    else re += c.replace(/[.+^${}()|\\]/g, '\\$&')
  }
  return re
}
export function ignoreMatcher(text) {
  const rules = []
  for (let line of [...DEFAULT_IGNORE, ...String(text || '').split('\n')]) {
    line = line.trim()
    if (!line || line.startsWith('#')) continue
    let neg = false
    if (line.startsWith('!')) { neg = true; line = line.slice(1) }
    const dirOnly = line.endsWith('/')
    if (dirOnly) line = line.slice(0, -1)
    const anchored = line.startsWith('/') || line.includes('/')
    if (line.startsWith('/')) line = line.slice(1)
    const body = globToRe(line)
    // dirOnly: そのフォルダの中のファイル / そうでなければ: その名前のファイルか、その名前のフォルダの中
    const re = new RegExp((anchored ? '^' : '(^|/)') + body + (dirOnly ? '/' : '(/|$)'))
    rules.push({ re, neg })
  }
  return path => {
    let ign = false
    for (const r of rules) if (r.re.test(path)) ign = !r.neg
    return ign
  }
}

// ============================================================
// リポジトリ
// ============================================================
export class GitRepo {
  constructor(store, tree, { now = () => Date.now() } = {}) {
    this.store = store
    this.tree = tree
    this.now = now
    this.hashCache = new Map()   // path → { content, id }
    this.meta = null
  }

  // ---- 記録の読み書き ----
  async exists() { return !!(await this.store.get('meta')) }
  async load() {
    const m = await this.store.get('meta')
    if (!m) fail('git のリポジトリではありません (git init で作れます)')
    this.meta = m
    return m
  }
  async save() { await this.store.put('meta', this.meta) }
  async init(branch = 'main') {
    if (await this.exists()) return false
    this.meta = { head: branch, detached: null, branches: {}, tags: {}, index: {}, stash: [], user: null, merge: null, created: this.now() }
    await this.save()
    return true
  }
  async putBlob(content) {
    const id = await blobSha(content)
    if (!(await this.store.get('b:' + id))) await this.store.put('b:' + id, content)
    return id
  }
  async blob(id) { if (!id) return null; const v = await this.store.get('b:' + id); return v === undefined ? null : v }
  async commitObj(id) {
    if (!id) return null
    const c = await this.store.get('c:' + id)
    if (!c) fail(`コミット ${short(id)} が見つかりません`)
    return c
  }
  headId() { const m = this.meta; return m.detached || m.branches[m.head] || null }
  async treeOf(id) { return id ? { ...(await this.commitObj(id)).tree } : {} }
  user() { return this.meta.user || { name: 'ForgeCode', email: '' } }

  // ---- 作業中のファイル ----
  async ignore() {
    let text = ''
    try { const t = await this.tree.read('.gitignore'); if (typeof t === 'string') text = t } catch {}
    return ignoreMatcher(text)
  }
  async hashWork(path) {
    const content = await this.tree.read(path)
    if (content === null || content === undefined) return null
    const c = this.hashCache.get(path)
    if (c && (c.content === content || (isBinary(content) && isBinary(c.content) && sameBytes(c.content, content)))) return c.id
    const id = await blobSha(content)
    this.hashCache.set(path, { content, id })
    return id
  }
  // 作業中のファイル → { path: id } (無視するファイルは、記録しているものだけ)
  async workTree() {
    const ign = await this.ignore()
    const idx = this.meta.index
    const out = {}
    for (const p of this.tree.list()) {
      if (!(p in idx) && ign(p)) continue
      const id = await this.hashWork(p)
      if (id) out[p] = id
    }
    return out
  }

  // ---- 状態 ----
  async status() {
    await this.load()
    const head = await this.treeOf(this.headId())
    const idx = this.meta.index
    const work = await this.workTree()
    const conflicts = new Set((this.meta.merge && this.meta.merge.conflicts) || [])
    const staged = changes(head, idx)
    const unstaged = []
    for (const p of Object.keys(idx).sort()) {
      if (!(p in work)) unstaged.push({ path: p, kind: 'D' })
      else if (work[p] !== idx[p]) unstaged.push({ path: p, kind: 'M' })
    }
    const untracked = Object.keys(work).filter(p => !(p in idx)).sort()
    return { branch: this.meta.detached ? null : this.meta.head, detached: this.meta.detached, head: this.headId(), staged, unstaged, untracked, conflicts: [...conflicts], merge: this.meta.merge, clean: !staged.length && !unstaged.length && !untracked.length }
  }

  // ---- ステージ ----
  matcher(specs) {
    const list = (specs && specs.length ? specs : ['.']).map(s => String(s).replace(/^\.\/+/, '').replace(/\/+$/, ''))
    const res = list.map(s => (s === '.' || s === '' || s === '*' ? null : /[*?[]/.test(s) ? new RegExp('^' + globToRe(s) + '(/|$)') : s))
    return p => res.some(r => r === null || (r instanceof RegExp ? r.test(p) : p === r || p.startsWith(r + '/')))
  }
  async add(specs, { all = false } = {}) {
    await this.load()
    const m = this.matcher(all ? [] : specs)
    const work = await this.workTree()
    const idx = this.meta.index
    let n = 0
    const matched = new Set()
    for (const [p, id] of Object.entries(work)) {
      if (!m(p)) continue
      matched.add(p)
      if (idx[p] !== id) { await this.putBlobFromWork(p, id); idx[p] = id; n++ }
    }
    for (const p of Object.keys(idx)) if (m(p) && !(p in work)) { delete idx[p]; matched.add(p); n++ }
    if (this.meta.merge && this.meta.merge.conflicts) this.meta.merge.conflicts = this.meta.merge.conflicts.filter(p => !m(p))
    await this.save()
    if (!all && specs && specs.length && !matched.size) {
      const bad = specs.filter(s => s !== '.' && !Object.keys(work).some(this.matcher([s])) && !Object.keys(idx).some(this.matcher([s])))
      if (bad.length) fail(`pathspec '${bad[0]}' に当てはまるファイルがありません`)
    }
    return n
  }
  async putBlobFromWork(path, id) {
    if (await this.store.get('b:' + id)) return
    const content = await this.tree.read(path)
    await this.store.put('b:' + id, content)
  }
  async unstage(specs) {
    await this.load()
    const m = this.matcher(specs)
    const head = await this.treeOf(this.headId())
    const idx = this.meta.index
    for (const p of new Set([...Object.keys(idx), ...Object.keys(head)])) {
      if (!m(p)) continue
      if (p in head) idx[p] = head[p]; else delete idx[p]
    }
    await this.save()
  }
  async rmCached(specs) {
    await this.load()
    const m = this.matcher(specs)
    let n = 0
    for (const p of Object.keys(this.meta.index)) if (m(p)) { delete this.meta.index[p]; n++ }
    await this.save()
    return n
  }
  // 作業中のファイルを、index (または指定のコミット) の中身に戻す
  async restore(specs, { source = null } = {}) {
    await this.load()
    const m = this.matcher(specs)
    const from = source ? await this.treeOf(await this.resolve(source)) : this.meta.index
    const work = await this.workTree()
    const done = []
    for (const p of new Set([...Object.keys(from), ...(source ? [] : Object.keys(work).filter(x => x in this.meta.index))])) {
      if (!m(p)) continue
      if (p in from) { if (work[p] !== from[p]) { await this.tree.write(p, await this.blob(from[p])); done.push(p) } }
      else if (p in work && source) { await this.tree.remove(p); done.push(p) }
    }
    return done
  }

  // ---- コミット ----
  async makeCommit({ tree, parents, message, time = this.now() }) {
    const author = this.user()
    const body = JSON.stringify({ tree: Object.keys(tree).sort().map(p => [p, tree[p]]), parents, message, author, time })
    const id = await sha1Text(body)
    await this.store.put('c:' + id, { id, tree, parents, message, author, time })
    return id
  }
  async setHead(id) {
    if (this.meta.detached) this.meta.detached = id
    else this.meta.branches[this.meta.head] = id
  }
  async commit(message, { all = false, amend = false, allowEmpty = false } = {}) {
    await this.load()
    message = String(message || '').trim()
    if (!message) fail('コミットのメッセージがありません (git commit -m "メッセージ")')
    if (all) {
      const work = await this.workTree()
      for (const p of Object.keys(this.meta.index)) {
        if (!(p in work)) delete this.meta.index[p]
        else if (work[p] !== this.meta.index[p]) { await this.putBlobFromWork(p, work[p]); this.meta.index[p] = work[p] }
      }
    }
    if (this.meta.merge && this.meta.merge.conflicts && this.meta.merge.conflicts.length) fail(`まだ解決していない衝突があります: ${this.meta.merge.conflicts.join(', ')}\n直したら git add してください`)
    const headId = this.headId()
    const head = headId ? await this.commitObj(headId) : null
    let parents = head ? [headId] : []
    if (amend) { if (!head) fail('まだコミットがないので --amend は使えません'); parents = head.parents }
    if (this.meta.merge && this.meta.merge.id && !this.meta.merge.single) parents = [headId, this.meta.merge.id]
    const tree = { ...this.meta.index }
    const same = head && sameTree(head.tree, tree)
    if (((same && !amend) || (!head && !Object.keys(tree).length)) && !allowEmpty && !this.meta.merge) fail('コミットする変更がありません (git add でステージしてください)')
    const id = await this.makeCommit({ tree, parents, message })
    await this.setHead(id)
    this.meta.merge = null
    await this.save()
    return { id, ...changeCount(head ? head.tree : {}, tree) }
  }

  // ---- 名前からコミットへ (HEAD・HEAD~2・HEAD^・ブランチ・タグ・短い id・stash@{0}) ----
  async resolve(rev) {
    await (this.meta ? Promise.resolve() : this.load())
    rev = String(rev || 'HEAD').trim()
    const st = /^stash@\{(\d+)\}$/.exec(rev)
    if (st) { const s = this.meta.stash[Number(st[1])]; if (!s) fail(`${rev} はありません`); return s.id }
    const m = /^(.*?)((?:[~^]\d*)*)$/.exec(rev)
    let base = m[1] || 'HEAD', sfx = m[2]
    let id
    if (base === 'HEAD' || base === '@') id = this.headId()
    else if (base in this.meta.branches) id = this.meta.branches[base]
    else if (base in this.meta.tags) id = this.meta.tags[base]
    else if (/^[0-9a-f]{4,40}$/.test(base)) {
      const all = await this.allCommits()
      const hit = all.filter(c => c.id.startsWith(base))
      if (hit.length > 1) fail(`${base} に当てはまるコミットが複数あります`)
      id = hit[0] && hit[0].id
    }
    if (!id) fail(base === 'HEAD' ? 'まだコミットがありません' : `'${rev}' というブランチ・タグ・コミットはありません`)
    for (const [, op, num] of sfx.matchAll(/([~^])(\d*)/g)) {
      const n = num === '' ? 1 : Number(num)
      if (op === '~') for (let k = 0; k < n; k++) { const c = await this.commitObj(id); id = c.parents[0]; if (!id) fail(`${rev}: それより前のコミットはありません`) }
      else { const c = await this.commitObj(id); id = n === 0 ? id : c.parents[n - 1]; if (!id) fail(`${rev}: その親はありません`) }
    }
    return id
  }
  async allCommits() {
    const starts = [...Object.values(this.meta.branches), ...Object.values(this.meta.tags), ...this.meta.stash.map(s => s.id), this.meta.detached].filter(Boolean)
    return this.walk(starts)
  }
  // starts からたどれるコミット (新しい順)
  async walk(starts, { limit = Infinity, firstParent = false } = {}) {
    const seen = new Set(), list = []
    const stack = [...starts]
    while (stack.length) {
      const id = stack.pop()
      if (!id || seen.has(id)) continue
      seen.add(id)
      const c = await this.commitObj(id)
      list.push(c)
      for (const p of firstParent ? c.parents.slice(0, 1) : c.parents) stack.push(p)
    }
    list.sort((a, b) => b.time - a.time)
    return list.slice(0, limit)
  }
  async log({ rev = 'HEAD', n = Infinity, path = null, all = false } = {}) {
    await this.load()
    const starts = all ? (await this.allCommits()).map(c => c.id) : [await this.resolve(rev)]
    let list = await this.walk(starts)
    if (path) {
      const m = this.matcher([path])
      const out = []
      for (const c of list) {
        const parent = c.parents[0] ? await this.commitObj(c.parents[0]) : null
        if (changes(parent ? parent.tree : {}, c.tree).some(x => m(x.path))) out.push(c)
      }
      list = out
    }
    return list.slice(0, n)
  }
  async refsByCommit() {
    const map = new Map()
    const add = (id, name) => { if (!id) return; if (!map.has(id)) map.set(id, []); map.get(id).push(name) }
    const head = this.headId()
    for (const [b, id] of Object.entries(this.meta.branches)) add(id, b === this.meta.head && !this.meta.detached ? `HEAD -> ${b}` : b)
    if (this.meta.detached) add(head, 'HEAD')
    for (const [t, id] of Object.entries(this.meta.tags)) add(id, `tag: ${t}`)
    return map
  }

  // ---- 差分 ----
  // 2 つの { path: id } の違い
  async diff({ from = 'INDEX', to = 'WORK', paths = null } = {}) {
    await this.load()
    const side = async s => (s === null ? {} : s === 'WORK' ? await this.workTreeTracked() : s === 'INDEX' ? { ...this.meta.index } : s === 'HEAD' && !this.headId() ? {} : await this.treeOf(await this.resolve(s)))
    const a = await side(from), b = await side(to)
    const m = paths && paths.length ? this.matcher(paths) : () => true
    const list = changes(a, b).filter(x => m(x.path))
    const read = async (s, p, id) => (s === 'WORK' ? await this.tree.read(p) : await this.blob(id))
    for (const x of list) {
      x.a = x.kind === 'A' ? null : await read(from, x.path, a[x.path])
      x.b = x.kind === 'D' ? null : await read(to, x.path, b[x.path])
      x.binary = isBinary(x.a) || isBinary(x.b)
      Object.assign(x, x.binary ? { add: 0, del: 0 } : diffStat(x.a ?? '', x.b ?? ''))
    }
    return list
  }
  // 記録しているファイルだけの作業中の状態 (git diff は追跡していないファイルを出さない)
  async workTreeTracked() {
    const work = await this.workTree()
    const out = {}
    for (const p of Object.keys(this.meta.index)) if (p in work) out[p] = work[p]
    return out
  }
  async show(rev = 'HEAD') {
    await this.load()
    const id = await this.resolve(rev)
    const c = await this.commitObj(id)
    const files = await this.diff({ from: c.parents[0] || null, to: id })
    return { commit: c, files }
  }

  // ---- ブランチ・タグ ----
  async branches() {
    await this.load()
    return Object.keys(this.meta.branches).sort().map(name => ({ name, id: this.meta.branches[name], current: !this.meta.detached && name === this.meta.head }))
  }
  checkName(name) {
    if (!name || /[\s~^:?*[\\]|\.\.|^[-/]|\/$|\.lock$|@\{/.test(name)) fail(`'${name}' はブランチの名前に使えません`)
  }
  async createBranch(name, rev = 'HEAD') {
    await this.load()
    this.checkName(name)
    if (name in this.meta.branches) fail(`ブランチ '${name}' はもうあります`)
    const id = this.headId() || rev !== 'HEAD' ? await this.resolve(rev) : null
    if (!id) fail('まだコミットがないので、ブランチを作れません (先に git commit)')
    this.meta.branches[name] = id
    await this.save()
    return id
  }
  async deleteBranch(name, { force = false } = {}) {
    await this.load()
    if (!(name in this.meta.branches)) fail(`ブランチ '${name}' はありません`)
    if (name === this.meta.head && !this.meta.detached) fail(`いま使っているブランチ '${name}' は消せません`)
    const id = this.meta.branches[name]
    if (!force && this.headId()) {
      const reach = new Set((await this.walk([this.headId()])).map(c => c.id))
      if (!reach.has(id)) fail(`ブランチ '${name}' はまだマージしていません (消すなら -D)`)
    }
    delete this.meta.branches[name]
    await this.save()
    return id
  }
  async renameBranch(from, to) {
    await this.load()
    if (!to) { to = from; from = this.meta.head }
    this.checkName(to)
    if (!(from in this.meta.branches) && !(from === this.meta.head && !this.headId())) fail(`ブランチ '${from}' はありません`)
    if (to in this.meta.branches) fail(`ブランチ '${to}' はもうあります`)
    if (from in this.meta.branches) { this.meta.branches[to] = this.meta.branches[from]; delete this.meta.branches[from] }
    if (this.meta.head === from) this.meta.head = to
    await this.save()
  }
  async tags() { await this.load(); return Object.keys(this.meta.tags).sort().map(name => ({ name, id: this.meta.tags[name] })) }
  async createTag(name, rev = 'HEAD', { force = false } = {}) {
    await this.load()
    this.checkName(name)
    if (name in this.meta.tags && !force) fail(`タグ '${name}' はもうあります`)
    this.meta.tags[name] = await this.resolve(rev)
    await this.save()
  }
  async deleteTag(name) {
    await this.load()
    if (!(name in this.meta.tags)) fail(`タグ '${name}' はありません`)
    delete this.meta.tags[name]
    await this.save()
  }

  // ---- 作業中のファイルを、別のコミットの状態にする ----
  // 変えていて、切り替えると消えてしまうファイルがあれば止める
  async moveTo(targetTree, { force = false } = {}) {
    const head = await this.treeOf(this.headId())
    const idx = this.meta.index
    const work = await this.workTree()
    const touched = changes(head, targetTree).map(x => x.path)
    if (!force) {
      const lost = touched.filter(p => (idx[p] !== head[p]) || (p in idx ? work[p] !== idx[p] : (p in work && work[p] !== targetTree[p])))
      if (lost.length) fail(`次のファイルの変更が消えてしまうので、切り替えられません:\n  ${lost.join('\n  ')}\n先にコミットするか、git stash で取っておいてください`)
    }
    const paths = force ? new Set([...Object.keys(head), ...Object.keys(idx), ...Object.keys(targetTree)]) : new Set(touched)
    for (const p of paths) {
      if (p in targetTree) { if (work[p] !== targetTree[p]) await this.tree.write(p, await this.blob(targetTree[p])) }
      else if (p in work && (p in head || p in idx)) await this.tree.remove(p)
    }
    // 切り替えに関係ないファイルの変更 (ステージしたものも) は、そのまま持っていく
    const next = force ? { ...targetTree } : { ...idx }
    if (!force) for (const p of touched) { if (p in targetTree) next[p] = targetTree[p]; else delete next[p] }
    this.meta.index = next
  }
  async checkout(target, { create = false, force = false, detach = false } = {}) {
    await this.load()
    if (this.meta.merge) fail('マージの途中です (git merge --abort でやめるか、git commit で終わらせてください)')
    if (create) {
      this.checkName(target)
      if (target in this.meta.branches) fail(`ブランチ '${target}' はもうあります`)
      const id = this.headId()
      if (id) this.meta.branches[target] = id
      this.meta.head = target
      this.meta.detached = null
      await this.save()
      return { branch: target, created: true }
    }
    if (target in this.meta.branches && !detach) {
      const id = this.meta.branches[target]
      await this.moveTo(await this.treeOf(id), { force })
      this.meta.head = target
      this.meta.detached = null
      await this.save()
      return { branch: target }
    }
    const id = await this.resolve(target)
    await this.moveTo(await this.treeOf(id), { force })
    this.meta.detached = id
    await this.save()
    return { detached: id }
  }
  async reset(rev = 'HEAD', mode = 'mixed') {
    await this.load()
    const id = await this.resolve(rev)
    const tree = await this.treeOf(id)
    if (mode === 'hard') {
      const work = await this.workTree()
      const head = await this.treeOf(this.headId())
      for (const p of new Set([...Object.keys(head), ...Object.keys(this.meta.index), ...Object.keys(tree)])) {
        if (p in tree) { if (work[p] !== tree[p]) await this.tree.write(p, await this.blob(tree[p])) }
        else if (p in work) await this.tree.remove(p)
      }
    }
    if (mode !== 'soft') this.meta.index = { ...tree }
    await this.setHead(id)
    this.meta.merge = null
    await this.save()
    return id
  }

  // ---- 3-way マージ (merge・revert・cherry-pick・stash pop) ----
  async threeWay(baseTree, oursTree, theirsTree, labels) {
    const work = await this.workTree()
    const idx = this.meta.index
    const conflicts = [], writes = []
    const result = { ...oursTree }
    for (const p of new Set([...Object.keys(baseTree), ...Object.keys(oursTree), ...Object.keys(theirsTree)])) {
      const b = baseTree[p], o = oursTree[p], t = theirsTree[p]
      if (o === t || b === t) continue
      if (b === o) {
        // 相手だけが変えた: 相手のものにする (作業中に変えていたら止める)
        if ((p in idx ? work[p] !== idx[p] : p in work) || idx[p] !== o) fail(`${p} を変えているので、先にコミットするか git stash してください`)
        if (t === undefined) { delete result[p]; writes.push([p, null]) } else { result[p] = t; writes.push([p, await this.blob(t)]) }
        continue
      }
      if ((p in idx ? work[p] !== idx[p] : p in work) || idx[p] !== o) fail(`${p} を変えているので、先にコミットするか git stash してください`)
      // 両方が変えた
      const [bc, oc, tc] = [await this.blob(b), await this.blob(o), await this.blob(t)]
      if (oc === null || tc === null || isBinary(bc) || isBinary(oc) || isBinary(tc)) {
        conflicts.push(p)
        if (oc === null && tc !== null) writes.push([p, tc])
        continue
      }
      const r = merge3(bc ?? '', oc, tc, labels)
      writes.push([p, r.text])
      if (r.conflicts) conflicts.push(p)
      else result[p] = await this.putBlob(r.text)
    }
    for (const [p, c] of writes) { if (c === null) await this.tree.remove(p); else await this.tree.write(p, c) }
    return { tree: result, conflicts }
  }
  async mergeBase(a, b) {
    const as = new Set((await this.walk([a])).map(c => c.id))
    for (const c of await this.walk([b])) if (as.has(c.id)) return c.id
    return null
  }
  async merge(rev, { noFF = false, message = null } = {}) {
    await this.load()
    if (this.meta.merge) fail('マージの途中です (git merge --abort でやめるか、直して git commit)')
    const head = this.headId()
    const other = await this.resolve(rev)
    if (!head) fail('まだコミットがありません')
    if (other === head) return { upToDate: true }
    const base = await this.mergeBase(head, other)
    if (base === other) return { upToDate: true }
    if (base === head && !noFF) {
      await this.moveTo(await this.treeOf(other))
      await this.setHead(other)
      await this.save()
      return { fastForward: true, id: other, from: head }
    }
    const r = await this.threeWay(await this.treeOf(base), await this.treeOf(head), await this.treeOf(other), { ours: 'HEAD', theirs: rev })
    const msg = message || `Merge ${rev in this.meta.branches ? `branch '${rev}'` : rev}${this.meta.detached ? '' : ` into ${this.meta.head}`}`
    if (r.conflicts.length) {
      for (const [p, id] of Object.entries(r.tree)) if (!r.conflicts.includes(p)) this.meta.index[p] = id
      for (const p of Object.keys(this.meta.index)) if (!(p in r.tree) && !r.conflicts.includes(p)) delete this.meta.index[p]
      this.meta.merge = { id: other, message: msg, conflicts: r.conflicts, kind: 'merge' }
      await this.save()
      return { conflicts: r.conflicts }
    }
    this.meta.index = r.tree
    this.meta.merge = { id: other, message: msg, conflicts: [] }
    await this.save()
    const c = await this.commit(msg, { allowEmpty: true })
    return { id: c.id, merged: true }
  }
  async abortMerge() {
    await this.load()
    if (!this.meta.merge) fail('マージの途中ではありません')
    await this.reset('HEAD', 'hard')
  }
  // ほかのコミットの変更を当てる (cherry-pick) / 取り消す (revert)
  async pick(rev, { revert = false } = {}) {
    await this.load()
    const id = await this.resolve(rev)
    const c = await this.commitObj(id)
    if (c.parents.length > 1) fail('マージのコミットには使えません')
    const parent = await this.treeOf(c.parents[0] || null)
    const head = await this.treeOf(this.headId())
    const [base, theirs] = revert ? [c.tree, parent] : [parent, c.tree]
    const r = await this.threeWay(base, head, theirs, { ours: 'HEAD', theirs: `${short(id)} (${firstLine(c.message)})` })
    const message = revert ? `Revert "${firstLine(c.message)}"\n\nThis reverts commit ${id}.` : c.message
    if (r.conflicts.length) {
      for (const [p, x] of Object.entries(r.tree)) if (!r.conflicts.includes(p)) this.meta.index[p] = x
      this.meta.merge = { id: null, message, conflicts: r.conflicts, kind: revert ? 'revert' : 'cherry-pick' }
      // revert / cherry-pick のコミットは親を 1 つにする
      this.meta.merge.single = true
      await this.save()
      return { conflicts: r.conflicts }
    }
    if (sameTree(head, r.tree)) fail('当てる変更がありません (もう同じ状態です)')
    this.meta.index = r.tree
    await this.save()
    return { id: (await this.commit(message)).id }
  }

  // ---- stash ----
  async stash(message = '', { untracked = false } = {}) {
    await this.load()
    const headId = this.headId()
    if (!headId) fail('まだコミットがないので stash は使えません')
    const head = await this.treeOf(headId)
    const work = await this.workTree()
    const tree = {}
    for (const p of Object.keys(this.meta.index)) if (p in work) tree[p] = work[p]
    if (untracked) for (const p of Object.keys(work)) if (!(p in this.meta.index)) tree[p] = work[p]
    if (sameTree(head, tree) && sameTree(head, this.meta.index)) return null
    for (const [p, id] of Object.entries(tree)) await this.putBlobFromWork(p, id)
    const label = message || `WIP on ${this.meta.detached ? short(headId) : this.meta.head}: ${short(headId)} ${firstLine((await this.commitObj(headId)).message)}`
    const id = await this.makeCommit({ tree, parents: [headId], message: label })
    this.meta.stash.unshift({ id, message: label, base: headId, index: { ...this.meta.index }, untracked })
    // 作業中のファイルを HEAD に戻す (stash に入れた追跡していないファイルは消す)
    for (const p of new Set([...Object.keys(tree), ...Object.keys(head)])) {
      if (p in head) { if (work[p] !== head[p]) await this.tree.write(p, await this.blob(head[p])) }
      else if (p in work) await this.tree.remove(p)
    }
    this.meta.index = { ...head }
    await this.save()
    return { id, message: label }
  }
  async stashApply(n = 0, { pop = false } = {}) {
    await this.load()
    const s = this.meta.stash[n]
    if (!s) fail(n ? `stash@{${n}} はありません` : 'stash はありません')
    const c = await this.commitObj(s.id)
    const base = await this.treeOf(s.base)
    const head = await this.treeOf(this.headId())
    const r = await this.threeWay(base, head, c.tree, { ours: 'Updated upstream', theirs: 'Stashed changes' })
    // index は HEAD のまま (変更は作業中のファイルに戻す)。新しいファイルは追跡する
    for (const p of Object.keys(c.tree)) if (!(p in head) && !(p in base) && p in s.index) this.meta.index[p] = c.tree[p]
    if (!r.conflicts.length && pop) this.meta.stash.splice(n, 1)
    await this.save()
    return { conflicts: r.conflicts, dropped: !r.conflicts.length && pop }
  }
  async stashDrop(n = 0) {
    await this.load()
    if (!this.meta.stash[n]) fail(`stash@{${n}} はありません`)
    const [s] = this.meta.stash.splice(n, 1)
    await this.save()
    return s
  }
  async stashList() { await this.load(); return this.meta.stash }

  // ---- blame (行ごとに、最後に変えたコミット) ----
  async blame(path, rev = 'HEAD') {
    await this.load()
    let id = await this.resolve(rev)
    let c = await this.commitObj(id)
    if (!(path in c.tree)) fail(`${path} は ${rev} にありません`)
    const text = await this.blob(c.tree[path])
    if (isBinary(text)) fail(`${path} はバイナリのファイルです`)
    const lines = splitLines(text).ls
    const who = new Array(lines.length).fill(null)
    let map = lines.map((_, i) => i)     // いまのコミットの行 → 最初のファイルの行
    let cur = lines
    while (true) {
      const pid = c.parents[0]
      const pc = pid ? await this.commitObj(pid) : null
      const ptext = pc && path in pc.tree ? await this.blob(pc.tree[path]) : null
      if (ptext === null || isBinary(ptext)) { for (const k of map) if (k !== null && !who[k]) who[k] = c; break }
      const plines = splitLines(ptext).ls
      const next = new Array(plines.length).fill(null)
      for (const [t, i, j] of diffOps(plines, cur)) {
        if (t === '=') next[i] = map[j]
        else if (t === '+' && map[j] !== null && !who[map[j]]) who[map[j]] = c
      }
      map = next
      cur = plines
      c = pc
      if (!map.some(k => k !== null && !who[k])) break
    }
    return lines.map((s, i) => ({ line: s, commit: who[i] }))
  }

  // ---- 設定 ----
  async setUser(patch) { await this.load(); this.meta.user = { ...this.user(), ...patch }; await this.save() }
  async files(rev = null) { await this.load(); return Object.keys(rev ? await this.treeOf(await this.resolve(rev)) : this.meta.index).sort() }
  async fileAt(rev, path) { await this.load(); const t = await this.treeOf(await this.resolve(rev)); return path in t ? this.blob(t[path]) : null }
}

// ---- 道具 ----
function sameBytes(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true }
export function sameTree(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b)
  return ka.length === kb.length && ka.every(k => a[k] === b[k])
}
export function changes(a, b) {
  const out = []
  for (const p of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(p in a)) out.push({ path: p, kind: 'A' })
    else if (!(p in b)) out.push({ path: p, kind: 'D' })
    else if (a[p] !== b[p]) out.push({ path: p, kind: 'M' })
  }
  return out.sort((x, y) => (x.path < y.path ? -1 : 1))
}
function changeCount(a, b) {
  const ch = changes(a, b)
  return { files: ch.length, added: ch.filter(x => x.kind === 'A').length, deleted: ch.filter(x => x.kind === 'D').length }
}
export const firstLine = m => String(m || '').split('\n')[0]

// メモリの記録 (テストと、IndexedDB が使えないとき)
export function memoryStore() {
  const m = new Map()
  return { get: async k => m.get(k), put: async (k, v) => { m.set(k, v) }, del: async k => { m.delete(k) }, map: m }
}
