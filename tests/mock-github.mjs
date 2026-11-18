// テスト用の GitHub (Git Data API の一部) の偽物。メモリの中だけで動きます
// tests/github.test.mjs とブラウザでの確認 (tests/e2e) で使います
import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'

const sha1 = s => createHash('sha1').update(s).digest('hex')
const blobSha = text => { const b = Buffer.from(text, 'utf8'); return sha1(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])) }

export function createMockGitHub({ owner = 'me', repo = 'proj', branch = 'main', token = 'tok' } = {}) {
  const blobs = new Map()   // sha → text
  const trees = new Map()   // sha → Map(path → blob sha)
  const commits = new Map() // sha → { tree, parents, message }
  const refs = new Map()    // branch → commit sha (空のリポジトリは何もない)
  const stats = { commits: 0, requests: 0 }
  const putBlob = text => { const s = blobSha(text); blobs.set(s, text); return s }
  const newTree = map => { const s = randomBytes(20).toString('hex'); trees.set(s, map); return s }
  const newCommit = (tree, parents, message) => { const s = randomBytes(20).toString('hex'); commits.set(s, { tree, parents, message }); stats.commits++; return s }

  // テストから直接いじる (他の人が GitHub で編集したことにする)
  function remoteEdit(changes, message = 'edit on github') {
    const head = refs.get(branch)
    const base = head ? new Map(trees.get(commits.get(head).tree)) : new Map()
    for (const [p, text] of Object.entries(changes)) { if (text === null) base.delete(p); else base.set(p, putBlob(text)) }
    refs.set(branch, newCommit(newTree(base), head ? [head] : [], message))
  }
  function remoteFiles() {
    const head = refs.get(branch)
    if (!head) return {}
    const out = {}
    for (const [p, s] of trees.get(commits.get(head).tree)) out[p] = blobs.get(s)
    return out
  }

  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-GitHub-Api-Version', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS' }
  const send = (res, status, body) => { res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)) }
  const server = http.createServer((req, res) => {
    stats.requests++
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return }
    if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { message: 'Bad credentials' })
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null
      const url = new URL(req.url, 'http://x')
      const m = new RegExp(`^/repos/${owner}/${repo}(.*)$`).exec(url.pathname)
      if (!m) return send(res, 404, { message: 'Not Found' })
      const p = m[1]
      let mm
      if (p === '' && req.method === 'GET') return send(res, 200, { default_branch: branch, full_name: `${owner}/${repo}` })
      if ((mm = /^\/git\/ref\/heads\/(.+)$/.exec(p)) && req.method === 'GET') {
        if (!refs.size) return send(res, 409, { message: 'Git Repository is empty.' })
        const sha = refs.get(decodeURIComponent(mm[1]))
        return sha ? send(res, 200, { object: { sha } }) : send(res, 404, { message: 'Not Found' })
      }
      if ((mm = /^\/git\/commits\/(\w+)$/.exec(p)) && req.method === 'GET') {
        const c = commits.get(mm[1])
        return c ? send(res, 200, { sha: mm[1], tree: { sha: c.tree }, message: c.message }) : send(res, 404, { message: 'Not Found' })
      }
      if ((mm = /^\/git\/trees\/(\w+)$/.exec(p)) && req.method === 'GET') {
        const t = trees.get(mm[1])
        if (!t) return send(res, 404, { message: 'Not Found' })
        return send(res, 200, { sha: mm[1], truncated: false, tree: [...t].map(([path, sha]) => ({ path, sha, type: 'blob', mode: '100644' })) })
      }
      if ((mm = /^\/git\/blobs\/(\w+)$/.exec(p)) && req.method === 'GET') {
        const t = blobs.get(mm[1])
        return t === undefined ? send(res, 404, { message: 'Not Found' }) : send(res, 200, { sha: mm[1], encoding: 'base64', content: Buffer.from(t, 'utf8').toString('base64') })
      }
      if (p === '/git/trees' && req.method === 'POST') {
        const base = body.base_tree ? new Map(trees.get(body.base_tree)) : new Map()
        for (const e of body.tree) {
          if (e.sha === null) base.delete(e.path)
          else if (typeof e.content === 'string') base.set(e.path, putBlob(e.content))
          else if (e.sha) base.set(e.path, e.sha)
        }
        return send(res, 201, { sha: newTree(base) })
      }
      if (p === '/git/commits' && req.method === 'POST') return send(res, 201, { sha: newCommit(body.tree, body.parents, body.message) })
      if ((mm = /^\/git\/refs\/heads\/(.+)$/.exec(p)) && req.method === 'PATCH') {
        const b = decodeURIComponent(mm[1])
        const cur = refs.get(b)
        const c = commits.get(body.sha)
        if (!c) return send(res, 422, { message: 'Object does not exist' })
        if (!body.force && cur && !c.parents.includes(cur)) return send(res, 422, { message: 'Update is not a fast forward' })
        refs.set(b, body.sha)
        return send(res, 200, { object: { sha: body.sha } })
      }
      if ((mm = /^\/contents\/(.+)$/.exec(p)) && req.method === 'PUT') {
        remoteEdit({ [decodeURIComponent(mm[1])]: Buffer.from(body.content, 'base64').toString('utf8') }, body.message)
        return send(res, 201, { commit: { sha: refs.get(branch) } })
      }
      send(res, 404, { message: 'Not Found' })
    })
  })
  return { server, remoteEdit, remoteFiles, stats, owner, repo, token }
}

// 直接実行したとき (ブラウザでの確認用): node tests/mock-github.mjs 8788
if (process.argv[1] && process.argv[1].endsWith('mock-github.mjs')) {
  const port = Number(process.argv[2]) || 8788
  const gh = createMockGitHub()
  gh.server.listen(port, () => console.log(`mock GitHub: http://localhost:${port} (repo me/proj, token "tok")`))
}
