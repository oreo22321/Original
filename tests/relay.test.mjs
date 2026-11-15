// 実機連携の中継サーバーのテスト:  node tests/relay.test.mjs
import { createRelay } from '../relay/server.mjs'

let pass = 0, fail = 0
const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`✗ ${name} ${info}`) } }

const { server } = createRelay()
await new Promise(r => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`
const ROOM = 'a'.repeat(8) + Math.random().toString(36).slice(2).replace(/[^a-z0-9]/g, '').padEnd(24, 'x')
const KEY = 'k'.repeat(40)
const j = async (method, path, { key, body } = {}) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Forgecode-Key': key } : {}) }, body: body ? JSON.stringify(body) : undefined })
  let data = null
  const text = await r.text()
  try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data, headers: r.headers }
}

// 部屋を開く前は、エグゼキューターはつながれない
ok('exec before open → 404', (await j('GET', `/r/${ROOM}/recv?as=exec`)).status === 404)
let c = await fetch(`${base}/c/${ROOM}`).then(r => r.text())
ok('connector for unknown room is an error script', /^error\(/.test(c))
ok('open without key → 400', (await j('POST', `/r/${ROOM}/open`)).status === 400)
let r = await j('POST', `/r/${ROOM}/open`, { key: KEY })
ok('open', r.status === 200 && r.data.ok)
ok('cors header', r.headers.get('access-control-allow-origin') === '*')
ok('open with another key → 403', (await j('POST', `/r/${ROOM}/open`, { key: 'z'.repeat(40) })).status === 403)

// コネクター: 中継の URL と部屋が埋め込まれ、鍵は入っていない
c = await fetch(`${base}/c/${ROOM}`).then(r => r.text())
ok('connector filled', c.includes(`local ROOM = "${ROOM}"`) && /local RELAY = "http:\/\/127\.0\.0\.1:\d+"/.test(c) && !c.includes(KEY))

// エディタ → エグゼキューター
ok('editor send without key → 403', (await j('POST', `/r/${ROOM}/send?as=editor`, { body: { msgs: [{ t: 'run' }] } })).status === 403)
r = await j('POST', `/r/${ROOM}/send?as=editor`, { key: KEY, body: { msgs: [{ t: 'run', id: 1, code: 'print(1)' }] } })
ok('editor send', r.status === 200)
r = await j('GET', `/r/${ROOM}/recv?as=exec&after=-1`)
ok('exec receives run', r.status === 200 && r.data.msgs.length === 1 && r.data.msgs[0].m.code === 'print(1)' && typeof r.data.msgs[0].age === 'number', JSON.stringify(r.data))
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
// 何もなければ wait 秒で空が返る
const t1 = Date.now()
r = await j('GET', `/r/${ROOM}/recv?as=exec&after=${r.data.seq}&wait=1`)
ok('long poll timeout', r.data.msgs.length === 0 && Date.now() - t1 >= 900)

// 不正な入力
ok('bad room id', (await j('GET', '/r/AB/recv?as=exec')).status === 404)
ok('bad side', (await j('GET', `/r/${ROOM}/recv?as=x`)).status === 400)
ok('health', (await j('GET', '/health')).data.ok === true)
const big = await fetch(`${base}/r/${ROOM}/send?as=exec`, { method: 'POST', body: 'x'.repeat(3 * 1024 * 1024) }).then(r => r.status).catch(() => 'reset')
ok('too large body rejected', big !== 200, String(big))

server.close()
console.log(`relay: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
