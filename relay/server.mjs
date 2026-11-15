// ForgeCode Live 中継サーバー (ForgeCode ⇄ エグゼキューター)
//   node relay/server.mjs          (PORT 環境変数で番号を変更。標準 8787)
// ・依存なし (Node.js 18 以上)。データは保存せず、メモリの中だけで中継します
// ・ブラウザ (ForgeCode) は外からの接続を待てないので、両方がこのサーバーに取りに来る「ロングポーリング」でつなぎます
// ・相手が一時的にいなくても (iPhone でアプリを切り替えたときなど)、しばらくの間は届いた依頼・出力を預かります
// ・部屋 (ROOM) は推測できない長い ID。エグゼキューターへコードを送れるのは、部屋を開いた ForgeCode の鍵を持つ側だけです
import http from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const CONNECTOR = readFileSync(path.join(here, '..', 'live', 'connector.lua'), 'utf8')

export function createRelay({ log = () => {} } = {}) {
  const MAX_BODY = 2 * 1024 * 1024      // 1 回に送れる大きさ
  const MSG_TTL = 15 * 60 * 1000        // 届いた依頼・出力を預かる時間
  const ROOM_TTL = 12 * 60 * 60 * 1000  // 使われていない部屋を消すまでの時間
  const MAX_QUEUE = 3000
  const MAX_ROOMS = 2000
  const MAX_WAIT = 25
  const rooms = new Map()
  const ROOM_RE = /^[a-z0-9]{20,64}$/
  const hash = s => createHash('sha256').update(String(s)).digest()

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

  const newQueue = () => ({ seq: 0, items: [], waiters: new Set(), cursor: 0 })
  function getRoom(id) { return ROOM_RE.test(id) ? rooms.get(id) : null }
  function prune(q) {
    const cut = Date.now() - MSG_TTL
    while (q.items.length && (q.items[0].t < cut || q.items.length > MAX_QUEUE)) q.items.shift()
  }
  function keyOk(room, key) {
    if (!key) return false
    const a = hash(key), b = room.keyHash
    return a.length === b.length && timingSafeEqual(a, b)
  }

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
    if (url.pathname === '/' || url.pathname === '/health') { send(res, 200, { ok: true, service: 'forgecode-live', rooms: rooms.size }); return }
    if (!allow(ip)) { send(res, 429, { error: 'too many requests' }); return }

    // エグゼキューターに貼る 1 行で読み込むスクリプト
    let m = /^\/c\/([a-z0-9]+)$/.exec(url.pathname)
    if (m && req.method === 'GET') {
      const room = getRoom(m[1])
      const relayUrl = `${req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')}://${req.headers['x-forwarded-host'] || req.headers.host}`
      if (!room) { send(res, 200, 'error("ForgeCode Live: 接続コードが無効です。ForgeCode の「実機」で新しい 1 行をコピーしてください")', 'text/plain; charset=utf-8'); return }
      send(res, 200, CONNECTOR.replace('{{RELAY}}', relayUrl.replace(/"/g, '')).replace('{{ROOM}}', m[1]), 'text/plain; charset=utf-8')
      return
    }

    m = /^\/r\/([a-z0-9]+)\/(open|send|recv)$/.exec(url.pathname)
    if (!m) { send(res, 404, { error: 'not found' }); return }
    const [, id, op] = m
    if (!ROOM_RE.test(id)) { send(res, 400, { error: 'bad room' }); return }
    const key = req.headers['x-forgecode-key']

    if (op === 'open') {
      if (req.method !== 'POST') { send(res, 405, { error: 'method' }); return }
      if (!key || String(key).length < 32) { send(res, 400, { error: 'key required' }); return }
      let room = rooms.get(id)
      if (room && !keyOk(room, key)) { send(res, 403, { error: 'room is owned by another editor' }); return }
      if (!room) {
        if (rooms.size >= MAX_ROOMS) { send(res, 503, { error: 'busy' }); return }
        room = { keyHash: hash(key), touched: Date.now(), seen: {}, q: { editor: newQueue(), exec: newQueue() } }
        rooms.set(id, room)
        log(`open ${id.slice(0, 6)}…`)
      }
      room.touched = Date.now()
      send(res, 200, { ok: true, peer: peerInfo(room, 'editor') })
      return
    }

    const as = url.searchParams.get('as')
    if (as !== 'editor' && as !== 'exec') { send(res, 400, { error: 'as' }); return }
    const room = rooms.get(id)
    if (!room) { send(res, 404, { error: 'no room' }); return }
    if (as === 'editor' && !keyOk(room, key)) { send(res, 403, { error: 'key' }); return }
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
      send(res, 200, { ok: true, peer: peerInfo(room, as) })
      return
    }

    // recv: 自分の受け箱から、after より後のものを返す (なければ wait 秒まで待つ)
    const q = room.q[as]
    let after = Number(url.searchParams.get('after'))
    if (!Number.isFinite(after)) after = -1
    // after = -1: 前回どこまで受け取ったかをサーバーが覚えている位置から (つなぎ直しても、同じ依頼を 2 回実行しない)
    if (after < 0) after = q.cursor
    else q.cursor = Math.max(q.cursor, Math.min(after, q.seq))
    const wait = Math.max(0, Math.min(MAX_WAIT, Number(url.searchParams.get('wait')) || 0))
    const reply = () => {
      prune(q)
      const now = Date.now()
      const items = q.items.filter(x => x.seq > after).slice(0, 500).map(x => ({ seq: x.seq, age: now - x.t, m: x.m }))
      const seq = items.length ? items[items.length - 1].seq : Math.max(after, 0)
      send(res, 200, { seq, msgs: items, peer: peerInfo(room, as) })
    }
    if (q.items.some(x => x.seq > after) || !wait) { reply(); return }
    let done = false
    const finish = () => { if (done) return; done = true; clearTimeout(timer); q.waiters.delete(finish); room.seen[as] = Date.now(); reply() }
    const timer = setTimeout(finish, wait * 1000)
    q.waiters.add(finish)
    req.on('close', () => { if (!done) { done = true; clearTimeout(timer); q.waiters.delete(finish) } })
  }

  // 古い部屋の掃除
  const sweeper = setInterval(() => {
    const now = Date.now()
    for (const [id, room] of rooms) if (now - room.touched > ROOM_TTL) rooms.delete(id)
    for (const [ip, b] of buckets) if (now - b.at > 60000) buckets.delete(ip)
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
