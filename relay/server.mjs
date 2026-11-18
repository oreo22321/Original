// ForgeCode Live 中継サーバー (ForgeCode ⇄ エグゼキューター)
//   node relay/server.mjs          (PORT 環境変数で番号を変更。標準 8787)
// ・依存なし (Node.js 18 以上)。データは保存せず、メモリの中だけで中継します
// ・ブラウザ (ForgeCode) は外からの接続を待てないので、両方がこのサーバーに取りに来る「ロングポーリング」でつなぎます
// ・相手が一時的にいなくても (iPhone でアプリを切り替えたときなど)、しばらくの間は届いた依頼・出力を預かります
// ・部屋 (ROOM) は、ForgeCode の鍵から計算した ID (roomOf)。エグゼキューターへコードを送れるのは、その鍵を持つ ForgeCode だけです
//   (サーバーが再起動して部屋が消えても、他の人が同じ部屋を乗っ取ることはできません)
// ・エグゼキューターは、ForgeCode がまだ開いていなくても部屋で待てます (開いたら、そのままつながる)
// ・ForgeCode 本体 (このリポジトリ) も配信します。同じ場所から開くと、中継サーバーの設定なしで使えます
import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
const CONNECTOR = readFileSync(path.join(ROOT, 'live', 'connector.lua'), 'utf8')

// 鍵 → 部屋の ID (js/app/live.js と同じ計算)
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
export function roomOf(key) {
  const d = createHash('sha256').update('forgecode-room:' + String(key)).digest()
  let out = ''
  for (let i = 0; i < 26; i++) out += B32[d[i] & 31]
  return out
}

export function createRelay({ log = () => {}, serve = true } = {}) {
  const MAX_BODY = 2 * 1024 * 1024      // 1 回に送れる大きさ
  const MSG_TTL = 15 * 60 * 1000        // 届いた依頼・出力を預かる時間
  const ROOM_TTL = 12 * 60 * 60 * 1000  // 使われていない部屋を消すまでの時間
  const MAX_QUEUE = 3000
  const MAX_ROOMS = 2000
  const MAX_WAIT = 25
  const PENDING_TTL = 2 * 60 * 60 * 1000 // ForgeCode がまだ来ていない部屋 (エグゼキューターだけが待っている) を消すまでの時間
  const rooms = new Map()
  const ROOM_RE = /^[a-z2-7]{26}$/

  // 送りすぎの防止 (IP ごと)
  const buckets = new Map()
  function allow(ip) {
    const now = Date.now()
    let b = buckets.get(ip)
    if (!b) { b = { tokens: 120, at: now }; buckets.set(ip, b) }
    b.tokens = Math.min(120, b.tokens + (now - b.at) / 1000 * 25)
    b.at = now
    if (b.tokens < 1) return false
    b.tokens -= 1
    return true
  }

  // 部屋を作る (IP ごとに作れる数を制限: 部屋を大量に作って埋める嫌がらせ対策)
  const created = new Map()
  const newQueue = () => ({ seq: 0, items: [], waiters: new Set(), cursor: 0 })
  function ensureRoom(id, ip, byEditor) {
    let room = rooms.get(id)
    if (room) { if (byEditor) room.owned = true; return room }
    if (rooms.size >= MAX_ROOMS) return null
    const c = created.get(ip) || { n: 0, at: Date.now() }
    if (Date.now() - c.at > 3600000) { c.n = 0; c.at = Date.now() }
    if (c.n >= 60) return null
    c.n++
    created.set(ip, c)
    room = { gen: randomBytes(6).toString('hex'), owned: !!byEditor, touched: Date.now(), seen: {}, q: { editor: newQueue(), exec: newQueue() } }
    rooms.set(id, room)
    log(`room ${id.slice(0, 6)}… (${byEditor ? 'editor' : 'exec'})`)
    return room
  }
  function prune(q) {
    const cut = Date.now() - MSG_TTL
    while (q.items.length && (q.items[0].t < cut || q.items.length > MAX_QUEUE)) q.items.shift()
  }
  // 鍵がこの部屋のものか (部屋の ID は鍵から計算するので、サーバーは鍵を覚えておく必要がない)
  const keyOk = (id, key) => typeof key === 'string' && key.length >= 32 && key.length <= 200 && roomOf(key) === id

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Forgecode-Key',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
  }
  function send(res, status, body, type = 'application/json; charset=utf-8') {
    if (res.writableEnded) return
    res.writeHead(status, { ...headers, 'Content-Type': type })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy() } else chunks.push(c) })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }

  // 部屋の中で、相手の情報 (最後に来た時刻)
  const peerInfo = (room, as) => {
    const other = as === 'editor' ? 'exec' : 'editor'
    const seen = room.seen[other]
    return { online: !!seen && Date.now() - seen < 40000, seenAgo: seen ? Date.now() - seen : null }
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x')
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
    if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return }
    if (url.pathname === '/health') { send(res, 200, { ok: true, service: 'forgecode-live', v: 2, rooms: rooms.size }); return }

    const api = /^\/(c|r)\//.test(url.pathname)
    if (!api) {
      // ForgeCode 本体を配信 (同じ場所から開けば、中継サーバーの設定なしで使える)
      if (serveStatic(req, res, url)) return
      if (url.pathname === '/') { send(res, 200, { ok: true, service: 'forgecode-live', v: 2, rooms: rooms.size }); return }
      send(res, 404, { error: 'not found' })
      return
    }
    if (!allow(ip)) { send(res, 429, { error: 'too many requests' }); return }

    // エグゼキューターに貼る 1 行で読み込むスクリプト (ForgeCode がまだ開いていなくても渡す。開いたらつながる)
    let m = /^\/c\/([a-z0-9]+)$/.exec(url.pathname)
    if (m && req.method === 'GET') {
      const relayUrl = `${req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')}://${req.headers['x-forwarded-host'] || req.headers.host}`
      if (!ROOM_RE.test(m[1])) { send(res, 200, 'error("ForgeCode Live: 接続コードが古いか、正しくありません。ForgeCode の「実機」で新しい 1 行をコピーしてください")', 'text/plain; charset=utf-8'); return }
      send(res, 200, CONNECTOR.replace('{{RELAY}}', relayUrl.replace(/[^\w.:/-]/g, '')).replace('{{ROOM}}', m[1]), 'text/plain; charset=utf-8')
      return
    }

    m = /^\/r\/([a-z0-9]+)\/(open|send|recv)$/.exec(url.pathname)
    if (!m) { send(res, 404, { error: 'not found' }); return }
    const [, id, op] = m
    if (!ROOM_RE.test(id)) { send(res, 400, { error: 'bad room' }); return }
    const key = req.headers['x-forgecode-key']

    if (op === 'open') {
      if (req.method !== 'POST') { send(res, 405, { error: 'method' }); return }
      if (!keyOk(id, key)) { send(res, 403, { error: 'key does not match room' }); return }
      const room = ensureRoom(id, ip, true)
      if (!room) { send(res, 503, { error: 'busy' }); return }
      room.touched = Date.now()
      room.seen.editor = Date.now()
      send(res, 200, { ok: true, gen: room.gen, peer: peerInfo(room, 'editor') })
      return
    }

    const as = url.searchParams.get('as')
    if (as !== 'editor' && as !== 'exec') { send(res, 400, { error: 'as' }); return }
    if (as === 'editor' && !keyOk(id, key)) { send(res, 403, { error: 'key' }); return }
    const room = ensureRoom(id, ip, as === 'editor')
    if (!room) { send(res, 503, { error: 'busy' }); return }
    room.touched = Date.now()
    room.seen[as] = Date.now()

    if (op === 'send') {
      if (req.method !== 'POST') { send(res, 405, { error: 'method' }); return }
      let body
      try { body = JSON.parse(await readBody(req)) } catch { send(res, 400, { error: 'bad body' }); return }
      const msgs = Array.isArray(body && body.msgs) ? body.msgs.slice(0, 1000) : []
      // 相手の受け箱へ
      const q = room.q[as === 'editor' ? 'exec' : 'editor']
      const t = Date.now()
      for (const msg of msgs) q.items.push({ seq: ++q.seq, t, m: msg })
      prune(q)
      for (const w of q.waiters) w()
      q.waiters.clear()
      send(res, 200, { ok: true, gen: room.gen, peer: peerInfo(room, as) })
      return
    }

    // recv: 自分の受け箱から、after より後のものを返す (なければ wait 秒まで待つ)
    const q = room.q[as]
    let after = Number(url.searchParams.get('after'))
    if (!Number.isFinite(after)) after = -1
    // 部屋が作り直された (サーバーの再起動など) ときは、知っている位置は使えない
    const gen = url.searchParams.get('gen')
    if (gen && gen !== room.gen) after = -1
    // after = -1: 前回どこまで受け取ったかをサーバーが覚えている位置から (つなぎ直しても、同じ依頼を 2 回実行しない)
    if (after < 0 || after > q.seq) after = q.cursor
    else q.cursor = Math.max(q.cursor, after)
    const wait = Math.max(0, Math.min(MAX_WAIT, Number(url.searchParams.get('wait')) || 0))
    const reply = () => {
      prune(q)
      const now = Date.now()
      const items = q.items.filter(x => x.seq > after).slice(0, 500).map(x => ({ seq: x.seq, age: now - x.t, m: x.m }))
      const seq = items.length ? items[items.length - 1].seq : Math.max(after, 0)
      send(res, 200, { seq, gen: room.gen, msgs: items, peer: peerInfo(room, as) })
    }
    if (q.items.some(x => x.seq > after) || !wait) { reply(); return }
    let done = false
    const finish = () => { if (done) return; done = true; clearTimeout(timer); q.waiters.delete(finish); room.seen[as] = Date.now(); reply() }
    const timer = setTimeout(finish, wait * 1000)
    q.waiters.add(finish)
    req.on('close', () => { if (!done) { done = true; clearTimeout(timer); q.waiters.delete(finish) } })
  }

  // ---- ForgeCode 本体の配信 ----
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.lua': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.wasm': 'application/wasm' }
  const PUBLIC = /^\/(?:index\.html|404\.html|sw\.js|boot\.js|manifest\.webmanifest|(?:css|js|dist|vendor|data|icons|live)\/[\w./-]+)$/
  const fileCache = new Map()
  function serveStatic(req, res, url) {
    if (!serve || (req.method !== 'GET' && req.method !== 'HEAD')) return false
    let p = decodeURIComponent(url.pathname)
    if (p === '/') p = '/index.html'
    if (!PUBLIC.test(p) || p.includes('..')) return false
    const file = path.join(ROOT, p)
    if (!file.startsWith(ROOT + path.sep)) return false
    const type = TYPES[path.extname(file)]
    if (!type) return false
    let body = fileCache.get(file)
    if (!body) {
      try { if (!statSync(file).isFile()) return false; body = readFileSync(file) } catch { return false }
      // 同じ場所に中継サーバーがあることを ForgeCode に知らせる (設定なしで実機連携を使える)
      if (p === '/index.html') body = Buffer.from(body.toString('utf8').replace('<meta name="forgecode-relay" content="">', '<meta name="forgecode-relay" content="same">'))
      if (fileCache.size < 400) fileCache.set(file, body)
    }
    // アプリ本体は Service Worker がまとめて管理するので、index.html と sw.js は毎回確認させる
    const cache = /\/(index\.html|sw\.js)$/.test(p) ? 'no-cache' : 'public, max-age=300'
    const extra = type.startsWith('text/html') ? { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" } : {}
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Length': body.length, ...extra })
    res.end(req.method === 'HEAD' ? undefined : body)
    return true
  }

  // 古い部屋の掃除
  const sweeper = setInterval(() => {
    const now = Date.now()
    for (const [id, room] of rooms) if (now - room.touched > (room.owned ? ROOM_TTL : PENDING_TTL)) rooms.delete(id)
    for (const [ip, b] of buckets) if (now - b.at > 60000) buckets.delete(ip)
    for (const [ip, c] of created) if (now - c.at > 3600000) created.delete(ip)
  }, 60000)
  sweeper.unref && sweeper.unref()

  const server = http.createServer((req, res) => {
    handle(req, res).catch(e => { log('error ' + e.message); send(res, 500, { error: 'server error' }) })
  })
  server.keepAliveTimeout = 30000
  server.headersTimeout = 35000
  return { server, rooms }
}

// 直接実行したとき
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT) || 8787
  const { server } = createRelay({ log: s => console.log(new Date().toISOString(), s) })
  server.listen(port, () => console.log(`ForgeCode Live relay: http://localhost:${port}`))
}
