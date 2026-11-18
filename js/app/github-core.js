// GitHub 同期の中身 (画面に触らない部分。テストでも使います)
// ・GitHub の Git Data API で、プロジェクトのファイルを 1 回の同期につき 1 つのコミットにまとめて保存します
// ・前回同期したときの各ファイルの版 (blob の SHA) を覚えておき、3 者 (この端末・GitHub・前回) を比べて
//   どちらの変更か判断します。両方で変わっていたら「衝突」として、勝手に上書きしません
const DEFAULT_API = 'https://api.github.com'

export class GitHubError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

// UTF-8 の文字列 ⇄ base64
const enc = new TextEncoder()
const dec = new TextDecoder()
export function toBase64(text) {
  const bytes = enc.encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
export function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return dec.decode(bytes)
}

// Git の blob の SHA-1 (内容が同じなら GitHub と同じ値になる)
export async function blobSha(text) {
  const body = enc.encode(text)
  const head = enc.encode(`blob ${body.length}\0`)
  const all = new Uint8Array(head.length + body.length)
  all.set(head)
  all.set(body, head.length)
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', all))
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('')
}

export class GitHubClient {
  constructor({ token, repo, branch = '', api = DEFAULT_API }) {
    const m = /^([\w.-]+)\/([\w.-]+)$/.exec(String(repo || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, ''))
    if (!m) throw new GitHubError('リポジトリは「ユーザー名/リポジトリ名」の形で指定してください')
    this.owner = m[1]
    this.name = m[2]
    this.token = String(token || '').trim()
    this.branch = branch
    this.api = String(api || DEFAULT_API).replace(/\/+$/, '')
  }
  async req(method, path, body) {
    const url = path.startsWith('http') ? path : `${this.api}/repos/${this.owner}/${this.name}${path}`
    let r
    try {
      r = await fetch(url, {
        method,
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      })
    } catch {
      throw new GitHubError('GitHub に接続できません (インターネットの接続を確認してください)', 0)
    }
    if (r.status === 204) return null
    let data = null
    try { data = await r.json() } catch {}
    if (!r.ok) {
      const msg = data && data.message ? data.message : `HTTP ${r.status}`
      if (r.status === 401) throw new GitHubError('トークンが正しくないか、期限が切れています', 401)
      if (r.status === 403 && /rate limit/i.test(msg)) throw new GitHubError('GitHub の利用回数の上限に達しました。しばらく待ってからもう一度試してください', 403)
      if (r.status === 403) throw new GitHubError('このトークンでは書き込めません (リポジトリの Contents を Read and write にしてください)', 403)
      if (r.status === 404 && /^\/?$|^$/.test(path)) throw new GitHubError('リポジトリが見つかりません (名前と、トークンで選んだリポジトリを確認してください)', 404)
      throw new GitHubError(msg, r.status)
    }
    return data
  }
  async info() { return this.req('GET', '') }
  async defaultBranch() {
    if (!this.branch) this.branch = (await this.info()).default_branch || 'main'
    return this.branch
  }
  // いまの先頭のコミット (空のリポジトリなら null)
  async head() {
    const branch = await this.defaultBranch()
    try {
      const ref = await this.req('GET', `/git/ref/heads/${encodeURIComponent(branch)}`)
      const commit = await this.req('GET', `/git/commits/${ref.object.sha}`)
      return { sha: ref.object.sha, tree: commit.tree.sha }
    } catch (e) {
      if (e.status === 404 || e.status === 409) return null
      throw e
    }
  }
  // 空のリポジトリに最初のコミットを作る (Git Data API は空のリポジトリでは使えないため)
  async init() {
    await this.req('PUT', '/contents/README.md', { message: 'ForgeCode: 同期を開始', content: toBase64('# ForgeCode のプロジェクト\n\nForgeCode (スマホ・iPad の Python エディタ) から同期したファイルです。\n') })
  }
  // フォルダの中のファイル: 相対パス → blob の SHA
  async listDir(treeSha, dir) {
    const t = await this.req('GET', `/git/trees/${treeSha}?recursive=1`)
    const prefix = dir ? dir.replace(/\/+$/, '') + '/' : ''
    const out = new Map()
    for (const e of t.tree || []) if (e.type === 'blob' && e.path.startsWith(prefix)) out.set(e.path.slice(prefix.length), e.sha)
    return { files: out, truncated: !!t.truncated }
  }
  async readBlob(sha) {
    const b = await this.req('GET', `/git/blobs/${sha}`)
    return b.encoding === 'base64' ? fromBase64(b.content) : String(b.content || '')
  }
  // ファイルの変更を 1 つのコミットにして、ブランチを進める (他の誰かが先に進めていたら失敗: 422)
  async commit(head, entries, message) {
    const tree = await this.req('POST', '/git/trees', { base_tree: head.tree, tree: entries })
    const c = await this.req('POST', '/git/commits', { message, tree: tree.sha, parents: [head.sha] })
    await this.req('PATCH', `/git/refs/heads/${encodeURIComponent(this.branch)}`, { sha: c.sha, force: false })
    return c.sha
  }
}

// 3 者を比べる: local / remote = 今の SHA (無ければ undefined)、base = 前回同期したときの SHA
function compare(local, remote, base) {
  if (local === remote) return 'same'
  if (base !== undefined && remote === base) return 'local'     // この端末だけ変わった
  if (base !== undefined && local === base) return 'remote'     // GitHub だけ変わった
  if (base === undefined && remote === undefined) return 'local' // 新しく作った
  if (base === undefined && local === undefined) return 'remote' // GitHub にだけある
  return 'conflict'
}

const safeEntries = files => Object.entries(files).filter(([p]) => p && !p.startsWith('/') && !p.split('/').includes('..'))

// この端末の変更を GitHub へ
// files: { 相対パス: 内容 } / state: { commit, files: { 相対パス: SHA } } / force: 衝突したらこの端末の内容で上書き (配列ならそのファイルだけ)
export async function pushProject(client, { dir, files, state = null, message = 'ForgeCode から同期', force = false }) {
  const base = (state && state.files) || {}
  for (let attempt = 0; attempt < 3; attempt++) {
    let head = await client.head()
    if (!head) { await client.init(); head = await client.head() }
    if (!head) throw new GitHubError('リポジトリを準備できませんでした')
    const { files: remote } = await client.listDir(head.tree, dir)
    const local = new Map()
    for (const [p, text] of safeEntries(files)) local.set(p, await blobSha(text))
    // この端末のプロジェクトが空 (読み込みに失敗したときなど) なら、GitHub のファイルを消さない
    if (!local.size && remote.size) return { pushed: 0, conflicts: [], remoteNewer: [...remote.keys()], skipped: 'empty', state: state || { commit: head.sha, files: {} } }
    const paths = new Set([...local.keys(), ...remote.keys()])
    const entries = [], conflicts = [], remoteNewer = []
    const next = {}
    for (const p of paths) {
      const L = local.get(p), R = remote.get(p), B = base[p]
      let kind = compare(L, R, B)
      if (kind === 'conflict' && (force === true || (Array.isArray(force) && force.includes(p)))) kind = 'local'
      const full = `${dir.replace(/\/+$/, '')}/${p}`
      if (kind === 'same') { if (L !== undefined) next[p] = L }
      else if (kind === 'local') {
        if (L === undefined) entries.push({ path: full, mode: '100644', type: 'blob', sha: null })
        else { entries.push({ path: full, mode: '100644', type: 'blob', content: files[p] }); next[p] = L }
      } else if (kind === 'remote') { remoteNewer.push(p); if (B !== undefined) next[p] = B }
      else { conflicts.push(p); if (B !== undefined) next[p] = B }
    }
    if (!entries.length) return { pushed: 0, conflicts, remoteNewer, state: { commit: head.sha, files: next } }
    try {
      const sha = await client.commit(head, entries, message)
      return { pushed: entries.length, conflicts, remoteNewer, state: { commit: sha, files: next } }
    } catch (e) {
      if (e.status === 422 || e.status === 409) continue // 先に誰かが進めた: 最初からやり直す
      throw e
    }
  }
  throw new GitHubError('GitHub 側の変更と重なったため、同期できませんでした。もう一度試してください')
}

// GitHub の変更をこの端末へ (返すのは変更: { 相対パス: 新しい内容 | null (削除) })
export async function pullProject(client, { dir, files, state = null, force = false }) {
  const base = (state && state.files) || {}
  const head = await client.head()
  if (!head) return { changes: {}, conflicts: [], localNewer: [], state: state || { commit: null, files: {} } }
  const { files: remote } = await client.listDir(head.tree, dir)
  const local = new Map()
  for (const [p, text] of safeEntries(files)) local.set(p, await blobSha(text))
  const paths = new Set([...local.keys(), ...remote.keys()])
  const changes = {}, conflicts = [], localNewer = []
  const next = {}
  for (const p of paths) {
    if (p.split('/').includes('..')) continue
    const L = local.get(p), R = remote.get(p), B = base[p]
    let kind = compare(L, R, B)
    if (kind === 'conflict' && (force === true || (Array.isArray(force) && force.includes(p)))) kind = 'remote'
    if (kind === 'same') { if (L !== undefined) next[p] = L }
    else if (kind === 'remote') {
      if (R === undefined) changes[p] = null
      else { changes[p] = await client.readBlob(R); next[p] = R }
    } else if (kind === 'local') { localNewer.push(p); if (B !== undefined) next[p] = B }
    else { conflicts.push(p); if (B !== undefined) next[p] = B }
  }
  return { changes, conflicts, localNewer, state: { commit: head.sha, files: next } }
}

// GitHub にあるプロジェクトのフォルダの一覧 (dir の直下)
export async function listRemoteProjects(client, dir) {
  const head = await client.head()
  if (!head) return []
  const { files } = await client.listDir(head.tree, dir)
  const names = new Set()
  for (const p of files.keys()) { const i = p.indexOf('/'); if (i > 0) names.add(p.slice(0, i)) }
  return [...names].sort()
}
