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

// ターミナル: python main.py a b → sys.argv
msgs.length = 0
send({ type: 'run', id: ++seq, files: { 'main.py': 'import sys\nprint(sys.argv)\n' }, entry: 'main.py', argv: ['main.py', 'a', 'b c'] })
let d = await until(m => m.type === 'done' && m.id === seq)
await new Promise(r => setTimeout(r, 100))
ok('argv from terminal', d.ok && /\['main\.py', 'a', 'b c'\]/.test(outputText()), outputText())

// ターミナル: python -c (ファイルに書かない) / cd したフォルダで実行 / サブフォルダのスクリプトの import
msgs.length = 0
send({ type: 'run', id: ++seq, files: { 'main.py': 'x = 1\n', '<string>': 'import os, sys\nprint(os.getcwd(), sys.argv)\nprint(sorted(p for p in os.listdir("/home/pyodide/project") if not p.startswith("_")))' }, entry: '<string>', argv: ['-c', 'z'], cwd: 'sub' })
d = await until(m => m.type === 'done' && m.id === seq)
await new Promise(r => setTimeout(r, 100))
ok('python -c is not written as a file', d.ok && /'main\.py'/.test(outputText()) && !/<string>/.test(outputText().split('\n')[1] || '') && /\['-c', 'z'\]/.test(outputText()), outputText() + JSON.stringify(d.error))
msgs.length = 0
send({ type: 'run', id: ++seq, files: { 'sub/a.py': 'import b\nimport os\nprint(b.V, os.path.basename(os.getcwd()))\n', 'sub/b.py': 'V = "from b"\n', 'sub/data.txt': 'x' }, entry: 'sub/a.py', argv: ['a.py'], cwd: 'sub' })
d = await until(m => m.type === 'done' && m.id === seq)
await new Promise(r => setTimeout(r, 100))
ok('script folder is importable and cwd follows the terminal', d.ok && /from b sub/.test(outputText()), outputText() + JSON.stringify(d.error))
msgs.length = 0
send({ type: 'run', id: ++seq, files: { 'main.py': '' , '<string>': '1/0' }, entry: '<string>', argv: ['-c'] })
d = await until(m => m.type === 'done' && m.id === seq)
ok('python -c error points at <string>', !d.ok && /File "<string>", line 1/.test(d.error.text), d.error && d.error.text)

// ターミナルの python (対話モード): 続きが要るか・自分の変数・Tab の補完・exit()
send({ type: 'eval', id: 200, code: 'zz = 41', ns: 'repl-new', repl: true })
ev = await until(m => m.type === 'evalResult' && m.id === 200)
ok('repl statement', ev.ok && !ev.incomplete, JSON.stringify(ev))
send({ type: 'eval', id: 201, code: 'for i in range(2):', ns: 'repl', repl: true })
ev = await until(m => m.type === 'evalResult' && m.id === 201)
ok('repl needs more lines', ev.ok && ev.incomplete === true, JSON.stringify(ev))
send({ type: 'eval', id: 202, code: 'for i in range(2):\n    zz += 1\n', ns: 'repl', repl: true })
ev = await until(m => m.type === 'evalResult' && m.id === 202)
ok('repl block runs after blank line', ev.ok && !ev.incomplete, JSON.stringify(ev))
send({ type: 'eval', id: 203, code: 'zz', ns: 'repl', repl: true })
ev = await until(m => m.type === 'evalResult' && m.id === 203)
ok('repl keeps its own variables', ev.ok && ev.value === '43', JSON.stringify(ev))
send({ type: 'eval', id: 204, code: 'total', ns: 'repl', repl: true })
ev = await until(m => m.type === 'evalResult' && m.id === 204)
ok('repl is separate from the last run', !ev.ok && /NameError/.test(ev.error), JSON.stringify(ev))
send({ type: 'eval', id: 205, complete: 'zz.bit', ns: 'repl' })
ev = await until(m => m.type === 'evalResult' && m.id === 205)
ok('repl tab completion', ev.ok && ev.names.some(n => n.startsWith('zz.bit_length')), JSON.stringify(ev))
send({ type: 'eval', id: 206, code: 'x = (1,', ns: 'repl', repl: true })
ev = await until(m => m.type === 'evalResult' && m.id === 206)
ok('repl open bracket is incomplete', ev.incomplete === true, JSON.stringify(ev))
send({ type: 'eval', id: 207, code: 'exit()', ns: 'repl', repl: true })
ev = await until(m => m.type === 'evalResult' && m.id === 207)
ok('repl exit() reports SystemExit', !ev.ok && ev.etype === 'SystemExit', JSON.stringify(ev))
send({ type: 'ping', id: 7 })
ev = await until(m => m.type === 'pong' && m.id === 7)
ok('ping', ev.ready === true)

// 長く動かしても出力が止まらない (とても多い出力は省略して知らせる)
r = await run({ 'main.py': 'for i in range(30000):\n    print(i)\nprint("end")\n' })
const outItems = msgs.filter(m => m.type === 'output').flatMap(m => m.items)
ok('huge output is summarized, not cut off', /省略しました/.test(r.out) && outItems[outItems.length - 1].text === 'end' && outItems.length < 30000, outItems.length + ' ' + outItems.slice(-3).map(i => i.text).join('|'))

// input() は共有メモリがないときは、分かるエラーになる
r = await run({ 'main.py': 'name = input("名前: ")\n' })
ok('input without shared memory explains', !r.done.ok && /input\(\)/.test(r.done.error.text), r.done.error && r.done.error.text)

console.log(`python: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
