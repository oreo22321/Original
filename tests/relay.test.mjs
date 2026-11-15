// 実機連携の中継サーバーのテスト:  node tests/relay.test.mjs
import { createRelay, roomOf } from '../relay/server.mjs'
import { roomOf as roomOfBrowser, sha256 } from '../js/app/sha256.js'
import { createHash, randomBytes } from 'node:crypto'

let pass = 0, fail = 0
const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`✗ ${name} ${info}`) } }

let relay = createRelay()
await new Promise(r => relay.server.listen(0, r))
let base = `http://127.0.0.1:${relay.server.address().port}`
const KEY = randomBytes(20).toString('hex')
const ROOM = roomOf(KEY)
const j = async (method, path, { key, body } = {}) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Forgecode-Key': key } : {}) }, body: body ? JSON.stringify(body) : undefined })
  let data = null
  const text = await r.text()
  try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data, headers: r.headers }
}

// 鍵 → 部屋: ブラウザとサーバーで同じ計算
ok('sha256 matches node', ['', 'abc', 'x'.repeat(64), 'あいう'].every(s => Buffer.from(sha256(s)).toString('hex') === createHash('sha256').update(s).digest('hex')))
ok('room derivation matches', [KEY, 'a'.repeat(40), randomBytes(30).toString('hex')].every(k => roomOf(k) === roomOfBrowser(k)))
ok('room format', /^[a-z2-7]{26}$/.test(ROOM), ROOM)

// エグゼキューターは、ForgeCode より先に来ても待てる
ok('exec before editor → waits (200)', (await j('GET', `/r/${ROOM}/recv?as=exec`)).status === 200)
let c = await fetch(`${base}/c/${ROOM}`).then(r => r.text())
ok('connector served before editor opens', c.includes(`local ROOM = "${ROOM}"`) && /local RELAY = "http:\/\/127\.0\.0\.1:\d+"/.test(c) && !c.includes(KEY))
ok('connector for invalid room is an error script', /^error\(/.test(await fetch(`${base}/c/abc`).then(r => r.text())))
ok('connector keeps retrying (no give-up on 404)', !/StatusCode == 404 or res.StatusCode == 403/.test(c) && /queue_on_teleport/.test(c))

// 鍵が部屋に合わないと、ForgeCode としては入れない (部屋の乗っ取り防止)
ok('open without key → 403', (await j('POST', `/r/${ROOM}/open`)).status === 403)
ok('open with another key → 403', (await j('POST', `/r/${ROOM}/open`, { key: randomBytes(20).toString('hex') })).status === 403)
let r = await j('POST', `/r/${ROOM}/open`, { key: KEY })
ok('open', r.status === 200 && r.data.ok && typeof r.data.gen === 'string')
ok('cors header', r.headers.get('access-control-allow-origin') === '*')
ok('peer seen (exec polled earlier)', r.data.peer.online === true)
const gen = r.data.gen

// エディタ → エグゼキューター
ok('editor send without key → 403', (await j('POST', `/r/${ROOM}/send?as=editor`, { body: { msgs: [{ t: 'run' }] } })).status === 403)
ok('editor send with wrong key → 403', (await j('POST', `/r/${ROOM}/send?as=editor`, { key: 'f'.repeat(40), body: { msgs: [{ t: 'run' }] } })).status === 403)
r = await j('POST', `/r/${ROOM}/send?as=editor`, { key: KEY, body: { msgs: [{ t: 'run', id: 1, code: 'print(1)' }] } })
ok('editor send', r.status === 200)
r = await j('GET', `/r/${ROOM}/recv?as=exec&after=-1`)
ok('exec receives run', r.status === 200 && r.data.msgs.length === 1 && r.data.msgs[0].m.code === 'print(1)' && typeof r.data.msgs[0].age === 'number' && r.data.gen === gen, JSON.stringify(r.data))
const seq1 = r.data.seq
// 受け取った位置を伝えたら、つなぎ直しても同じ依頼は来ない
await j('GET', `/r/${ROOM}/recv?as=exec&after=${seq1}`)
r = await j('GET', `/r/${ROOM}/recv?as=exec&after=-1`)
ok('reconnect does not repeat', r.data.msgs.length === 0, JSON.stringify(r.data))
ok('exec cannot read editor inbox without key', (await j('GET', `/r/${ROOM}/recv?as=editor`)).status === 403)

// エグゼキューター → エディタ (相手の状態も分かる)
await j('POST', `/r/${ROOM}/send?as=exec`, { body: { msgs: [{ t: 'hello', executor: 'Delta' }, { t: 'log', kind: 'MessageOutput', text: 'hi' }] } })
r = await j('GET', `/r/${ROOM}/recv?as=editor&after=-1`, { key: KEY })
ok('editor receives logs', r.data.msgs.length === 2 && r.data.msgs[0].m.executor === 'Delta')
ok('peer online', r.data.peer.online === true)

// ロングポーリング: 待っている間に届いたら、すぐに返る
const t0 = Date.now()
const waiting = j('GET', `/r/${ROOM}/recv?as=exec&after=${seq1}&wait=10`)
setTimeout(() => j('POST', `/r/${ROOM}/send?as=editor`, { key: KEY, body: { msgs: [{ t: 'eval', id: 2, code: '1+1' }] } }), 300)
r = await waiting
ok('long poll wakes', r.data.msgs.length === 1 && r.data.msgs[0].m.t === 'eval' && Date.now() - t0 < 3000, `${Date.now() - t0}ms`)
const execSeq = r.data.seq
// 何もなければ wait 秒で空が返る
const t1 = Date.now()
r = await j('GET', `/r/${ROOM}/recv?as=exec&after=${execSeq}&wait=1`)
ok('long poll timeout', r.data.msgs.length === 0 && Date.now() - t1 >= 900)

// サーバーが再起動して部屋が消えても: 同じ鍵でそのまま使え、古い位置 (after) は自動で読み直す
relay.server.close()
relay = createRelay()
await new Promise(res => relay.server.listen(0, res))
base = `http://127.0.0.1:${relay.server.address().port}`
r = await j('GET', `/r/${ROOM}/recv?as=exec&after=${execSeq}&gen=${gen}`)
ok('after restart: exec waits in new room', r.status === 200 && r.data.gen !== gen)
const gen2 = r.data.gen
ok('after restart: someone else cannot claim the room', (await j('POST', `/r/${ROOM}/open`, { key: randomBytes(20).toString('hex') })).status === 403)
ok('after restart: owner reopens', (await j('POST', `/r/${ROOM}/open`, { key: KEY })).status === 200)
await j('POST', `/r/${ROOM}/send?as=editor`, { key: KEY, body: { msgs: [{ t: 'run', id: 9, code: 'print(9)' }] } })
// 古い after (再起動前の番号) のままでも、gen が違えば最初から受け取れる
r = await j('GET', `/r/${ROOM}/recv?as=exec&after=${execSeq + 50}&gen=${gen}`)
ok('stale cursor is reset by gen', r.data.msgs.length === 1 && r.data.msgs[0].m.id === 9 && r.data.gen === gen2, JSON.stringify(r.data))

// ForgeCode 本体の配信 (同じ場所から開けば、設定なしで使える)
const idx = await fetch(base + '/')
const idxText = await idx.text()
ok('serves index.html', idx.status === 200 && /text\/html/.test(idx.headers.get('content-type')) && /ForgeCode/.test(idxText))
ok('index marks same-origin relay', idxText.includes('<meta name="forgecode-relay" content="same">'))
const js = await fetch(base + '/js/app/main.js')
ok('serves js with type', js.status === 200 && /javascript/.test(js.headers.get('content-type')))
ok('no traversal', (await fetch(base + '/js/../relay/server.mjs')).status === 404 && (await fetch(base + '/%2e%2e/etc/passwd')).status === 404)
ok('no private files', (await fetch(base + '/relay/server.mjs')).status === 404 && (await fetch(base + '/.git/config')).status === 404 && (await fetch(base + '/tools/package.json')).status === 404)
ok('health', (await j('GET', '/health')).data.service === 'forgecode-live')

// 不正な入力
ok('bad room id', (await j('GET', '/r/AB/recv?as=exec')).status === 404)
ok('bad side', (await j('GET', `/r/${ROOM}/recv?as=x`)).status === 400)
const big = await fetch(`${base}/r/${ROOM}/send?as=exec`, { method: 'POST', body: 'x'.repeat(3 * 1024 * 1024) }).then(r => r.status).catch(() => 'reset')
ok('too large body rejected', big !== 200, String(big))

relay.server.close()
console.log(`relay: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
