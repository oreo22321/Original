// Python のデバッガー (ブレークポイント・ステップ・変数・ウォッチ・一時停止・breakpoint()) のテスト:  node tests/pydebug.test.mjs
import { Worker } from 'node:worker_threads'
let pass = 0, fail = 0
const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`✗ ${name} ${info}`) } }

const w = new Worker(new URL('./py-node-worker.mjs', import.meta.url))
const shared = { interrupt: new SharedArrayBuffer(4), ctl: new SharedArrayBuffer(8), buf: new SharedArrayBuffer(65536), dctl: new SharedArrayBuffer(8), dbuf: new SharedArrayBuffer(262144) }
const ib = new Int32Array(shared.interrupt), dctl = new Int32Array(shared.dctl), dbuf = new Uint8Array(shared.dbuf)
const msgs = []
let waiters = []
w.on('message', m => { if (process.env.DBG) console.log('  <', JSON.stringify(m).slice(0, 140)); msgs.push(m); for (const f of waiters.slice()) f() })
const until = (pred, ms = 60000) => new Promise((resolve, reject) => {
  const t0 = Date.now()
  const check = () => {
    const i = msgs.findIndex(pred)
    if (i >= 0) { waiters = waiters.filter(f => f !== check); const [m] = msgs.splice(i, 1); resolve(m) } else if (Date.now() - t0 > ms) { waiters = waiters.filter(f => f !== check); reject(new Error('timeout')) }
  }
  waiters.push(check)
  setTimeout(check, ms + 10)
  check()
})
// 画面 (runner.sendDebug) と同じ送り方
async function cmd(c, signal = false) {
  while (Atomics.load(dctl, 0) !== 0) await new Promise(r => setTimeout(r, 10))
  const bytes = new TextEncoder().encode(JSON.stringify(c))
  dbuf.set(bytes)
  Atomics.store(dctl, 1, bytes.length)
  Atomics.store(dctl, 0, 1)
  Atomics.notify(dctl, 0)
  if (signal && ib[0] === 0) ib[0] = 10
}
const out = () => msgs.filter(m => m.type === 'output').flatMap(m => m.items).map(i => i.text).join('\n')
let seq = 0
const run = (files, bps = {}, watches = [], entry = 'main.py') => { const id = ++seq; ib[0] = 0; w.postMessage({ type: 'run', id, files, entry, debug: { bps, watches } }); return id }

w.postMessage({ type: 'init', ...shared })
await until(m => m.type === 'status' && m.state === 'ready', 90000)

const main = `def add(a, b):
    total = a + b
    return total


items = [1, 2, 3]
info = {"name": "forge", "n": 2}
s = 0
for i in range(5):
    s = add(s, i)
print("done", s)
`
// 1. ブレークポイントで止まる・変数・ウォッチ・呼び出し履歴
let id = run({ 'main.py': main }, { 'main.py': [{ line: 2 }] }, ['a * 10'])
let p = await until(m => m.type === 'paused')
ok('stops at breakpoint', p.file === 'main.py' && p.line === 2 && p.reason.kind === 'breakpoint', JSON.stringify(p).slice(0, 300))
ok('locals', p.locals.some(v => v.name === 'a' && v.value.v === '0') && p.locals.some(v => v.name === 'b'), JSON.stringify(p.locals))
ok('globals (user only)', p.globals.some(v => v.name === 'items' && v.value.ref) && !p.globals.some(v => v.name.startsWith('__')), JSON.stringify(p.globals).slice(0, 300))
ok('stack', p.stack.length === 2 && p.stack[0].name === 'add()' && p.stack[1].line === 10, JSON.stringify(p.stack))
ok('watch value', p.watches[0] && p.watches[0].code === 'a * 10' && p.watches[0].value.v === '0', JSON.stringify(p.watches))
// 展開
const items = p.globals.find(v => v.name === 'items')
await cmd({ type: 'expand', id: 7, ref: items.value.ref })
let ex = await until(m => m.type === 'expanded')
ok('expand list', ex.id === 7 && ex.items.length === 3 && ex.items[2].name === '[2]' && ex.items[2].value.v === '3', JSON.stringify(ex))
// 止まっている間にコンソールで評価 (値の変更もできる)
await cmd({ type: 'eval', id: 50, code: 'a + 100' })
let ev = await until(m => m.type === 'evalResult' && m.id === 50)
ok('eval in paused frame', ev.ok && ev.value === '100', JSON.stringify(ev))
await until(m => m.type === 'paused') // 値の再表示
// ステップオーバー → 次の行
await cmd({ type: 'debug', action: 'over' })
await until(m => m.type === 'resumed')
p = await until(m => m.type === 'paused')
ok('step over', p.line === 3 && p.reason.kind === 'step' && p.locals.some(v => v.name === 'total'), JSON.stringify(p).slice(0, 200))
// ステップアウト → 呼び出し元
await cmd({ type: 'debug', action: 'out' })
p = await until(m => m.type === 'paused')
ok('step out to caller', p.line === 10 && p.locals[0] && /add の戻り値/.test(p.locals[0].name) && p.locals[0].value.v === '0', JSON.stringify(p).slice(0, 300))
await cmd({ type: 'debug', action: 'over' })
p = await until(m => m.type === 'paused')
ok('over after step out', p.line === 9, `line ${p.line}`)
// 条件付きに変更して続行
await cmd({ type: 'breakpoints', list: { 'main.py': [{ line: 2, cond: 'a == 6' }] } })
await cmd({ type: 'debug', action: 'continue' })
p = await until(m => m.type === 'paused')
ok('conditional breakpoint', p.line === 2 && p.locals.some(v => v.name === 'a' && v.value.v === '6'), JSON.stringify(p.locals))
await cmd({ type: 'debug', action: 'continue' })
let done = await until(m => m.type === 'done' && m.id === id)
ok('finishes after continue', done.ok && /done 10/.test(out()), out())
msgs.length = 0

// 2. ログポイント (止めずに出力)
id = run({ 'main.py': main }, { 'main.py': [{ line: 3, log: 'total={total}' }] })
done = await until(m => m.type === 'done' && m.id === id)
ok('log point', done.ok && /main\.py:3 {2}total=0/.test(out()) && /total=10/.test(out()) && !msgs.some(m => m.type === 'paused'), out())
msgs.length = 0

// 3. ステップイン・止まっている間にブレークポイントを変える
id = run({ 'main.py': main }, { 'main.py': [{ line: 10 }] })
p = await until(m => m.type === 'paused')
ok('module level stop', p.line === 10 && p.locals.length === 0 && p.stack.length === 1, JSON.stringify(p).slice(0, 200))
await cmd({ type: 'debug', action: 'in' })
p = await until(m => m.type === 'paused')
ok('step into function', p.line === 2 && p.stack[0].name === 'add()', JSON.stringify(p.stack))
await cmd({ type: 'breakpoints', list: { 'main.py': [{ line: 11 }] } })
await cmd({ type: 'debug', action: 'continue' })
p = await until(m => m.type === 'paused')
ok('breakpoint changed while paused', p.line === 11 && p.globals.some(v => v.name === 's' && v.value.v === '10'), `line ${p.line}`)
// 停止
await cmd({ type: 'stop' })
done = await until(m => m.type === 'done' && m.id === id)
ok('stop while paused', done.reason === 'stopped', JSON.stringify(done))
msgs.length = 0

// 4. 実行中に一時停止 (ブレークポイントなし)
const loop = 'import time\nn = 0\nwhile True:\n    n += 1\n    if n % 1000 == 0:\n        time.sleep(0.001)\n'
id = run({ 'main.py': loop })
await new Promise(r => setTimeout(r, 600))
await cmd({ type: 'debug', action: 'pause' }, true)
p = await until(m => m.type === 'paused', 10000)
ok('pause while running', p.file === 'main.py' && p.reason.kind === 'pause' && p.globals.some(v => v.name === 'n'), JSON.stringify(p).slice(0, 200))
ib[0] = 2
done = await until(m => m.type === 'done' && m.id === id, 10000)
ok('stop (interrupt) while paused', done.reason === 'stopped', JSON.stringify(done))
msgs.length = 0

// 5. 実行中にブレークポイントを追加
const loop2 = 'import time\nn = 0\nwhile n < 100000000:\n    n += 1\n    if n % 1000 == 0:\n        time.sleep(0.001)\nprint("end")\n'
id = run({ 'main.py': loop2 })
await new Promise(r => setTimeout(r, 500))
await cmd({ type: 'breakpoints', list: { 'main.py': [{ line: 4 }] } }, true)
p = await until(m => m.type === 'paused', 10000)
ok('breakpoint added while running', p.line === 4 && p.reason.kind === 'breakpoint', JSON.stringify(p).slice(0, 200))
await cmd({ type: 'stop' })
done = await until(m => m.type === 'done' && m.id === id, 10000)
ok('stopped', done.reason === 'stopped')
msgs.length = 0

// 6. breakpoint() で止まる
id = run({ 'main.py': 'x = 41\nbreakpoint()\nx += 1\nprint("x", x)\n' })
p = await until(m => m.type === 'paused')
ok('breakpoint() builtin', p.line === 3 && p.globals.some(v => v.name === 'x' && v.value.v === '41'), JSON.stringify(p).slice(0, 200))
await cmd({ type: 'debug', action: 'continue' })
done = await until(m => m.type === 'done' && m.id === id)
ok('continues after breakpoint()', done.ok && /x 42/.test(out()), out())
msgs.length = 0

// 7. 速さ: ブレークポイントがある関数でも、止めない行は速い
const hot = 'import time\ndef f(n):\n    s = 0\n    for i in range(n):\n        s += i * i\n    return s\nt = time.time()\nr = f(1000000)\nprint("ms", int((time.time() - t) * 1000))\n'
id = run({ 'main.py': hot }, { 'main.py': [{ line: 6, cond: 'False' }] })
done = await until(m => m.type === 'done' && m.id === id)
const ms = Number((/ms (\d+)/.exec(out()) || [])[1])
ok('fast with breakpoints', done.ok && ms < 1500, `${ms} ms`)
console.log(`  (1,000,000 回のループ: ${ms} ms)`)

await w.terminate()
console.log(`pydebug: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
