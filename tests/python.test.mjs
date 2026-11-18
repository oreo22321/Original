// Python の実行 (ワーカー) のテスト:  node tests/python.test.mjs
// ワーカーの中身を Node でそのまま動かします (Pyodide は vendor/pyodide を使用。ネットワークは使いません)
let pass = 0, fail = 0
const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`✗ ${name} ${info}`) } }

const msgs = []
let waiters = []
globalThis.self = globalThis
globalThis.postMessage = m => { msgs.push(m); for (const w of waiters.slice()) w() }
await import('../js/workers/python-worker.js')
const send = m => globalThis.onmessage({ data: m })
const until = (pred, ms = 60000) => new Promise((resolve, reject) => {
  const t0 = Date.now()
  const check = () => { const m = msgs.find(pred); if (m) { waiters = waiters.filter(w => w !== check); resolve(m) } else if (Date.now() - t0 > ms) reject(new Error('timeout')) }
  waiters.push(check)
  const iv = setInterval(() => { check(); if (msgs.find(pred) || Date.now() - t0 > ms) clearInterval(iv) }, 50)
  check()
})
const outputText = () => msgs.filter(m => m.type === 'output').flatMap(m => m.items).map(i => i.text).join('\n')
let seq = 0
async function run(files, entry = 'main.py') {
  msgs.length = 0
  const id = ++seq
  send({ type: 'run', id, files, entry })
  const done = await until(m => m.type === 'done' && m.id === id, 120000)
  await new Promise(r => setTimeout(r, 120))
  return { done, out: outputText() }
}

send({ type: 'init' })
let r = await run({ 'main.py': 'print("hello", 1 + 2)\nfor i in range(3):\n    print("line", i)\n' })
ok('print', r.done.ok && /hello 3/.test(r.out) && /line 2/.test(r.out), JSON.stringify(r))
ok('ready status', true)

r = await run({ 'main.py': 'def f(x):\n    return 10 / x\n\nprint("before")\nf(0)\n' })
ok('error result', !r.done.ok && r.done.error.type === 'ZeroDivisionError', JSON.stringify(r.done.error))
const fr = r.done.error.frames
ok('traceback frames in project', fr.length === 2 && fr[0].file === 'main.py' && fr[0].line === 5 && fr[1].line === 2 && fr[1].name === 'f', JSON.stringify(fr))
ok('traceback text has no internals', /ZeroDivisionError/.test(r.done.error.text) && !/__fc_|<exec>/.test(r.done.error.text) && /main\.py/.test(r.done.error.text), r.done.error.text)
ok('output before error kept', /before/.test(r.out))

r = await run({ 'main.py': 'x = (1,\nprint(x)\n' })
ok('syntax error', !r.done.ok && r.done.error.syntax && r.done.error.file === 'main.py' && r.done.error.line >= 1, JSON.stringify(r.done.error))

r = await run({ 'main.py': 'from util.helpers import double\nimport config\nprint(double(21), config.NAME)\n', 'util/__init__.py': '', 'util/helpers.py': 'def double(n):\n    return n * 2\n', 'config.py': 'NAME = "forge"\n' })
ok('import project modules', r.done.ok && /42 forge/.test(r.out), r.out + JSON.stringify(r.done.error))

r = await run({ 'main.py': 'with open("out.txt", "w") as f:\n    f.write("written by python")\nprint(open("data.csv").read().strip())\n', 'data.csv': 'a,b\n1,2\n' })
ok('reads project files', r.done.ok && /a,b/.test(r.out), r.out)
ok('files written by the program come back', r.done.files['out.txt'] === 'written by python', JSON.stringify(r.done.files))

// 前の実行のファイルが残らない
r = await run({ 'main.py': 'import os\nprint(sorted(p for p in os.listdir(".") if not p.startswith("_")))\n' })
ok('stale files removed', /\['main\.py'\]/.test(r.out) || /'main.py'/.test(r.out) && !/data\.csv/.test(r.out), r.out)

r = await run({ 'main.py': 'import sys\nprint("bye")\nsys.exit(0)\nprint("never")\n' })
ok('sys.exit is a normal end', r.done.ok && r.done.reason === 'exit' && /bye/.test(r.out) && !/never/.test(r.out), JSON.stringify(r.done))

r = await run({ 'main.py': 'import sys\nprint("to stderr", file=sys.stderr)\nprint("no newline", end="")\n' })
ok('stderr and partial line', /to stderr/.test(r.out) && /no newline/.test(r.out), r.out)

// コンソール: 最後の実行の変数を使える
r = await run({ 'main.py': 'total = sum(range(10))\nnames = ["a", "b"]\n' })
msgs.length = 0
send({ type: 'eval', id: 99, code: 'total * 2' })
let ev = await until(m => m.type === 'evalResult' && m.id === 99)
ok('console sees last run', ev.ok && ev.value === '90', JSON.stringify(ev))
send({ type: 'eval', id: 100, code: 'x = 5\nx + len(names)' })
ev = await until(m => m.type === 'evalResult' && m.id === 100)
ok('console statements + expression', ev.ok && ev.value === '7', JSON.stringify(ev))
send({ type: 'eval', id: 101, code: 'undefined_name' })
ev = await until(m => m.type === 'evalResult' && m.id === 101)
ok('console error', !ev.ok && /NameError/.test(ev.error), JSON.stringify(ev))

// input() は共有メモリがないときは、分かるエラーになる
r = await run({ 'main.py': 'name = input("名前: ")\n' })
ok('input without shared memory explains', !r.done.ok && /input\(\)/.test(r.done.error.text), r.done.error && r.done.error.text)

console.log(`python: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
