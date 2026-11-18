// Python のエディタ機能 (エラーチェック・補完・説明・定義・整形) のテスト:  node tests/pytools.test.mjs
let pass = 0, fail = 0
const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`✗ ${name} ${info}`) } }
const waits = new Map()
globalThis.self = globalThis
globalThis.postMessage = m => { const w = waits.get(m.id); if (w) { waits.delete(m.id); w(m) } }
await import('../js/workers/pytools-worker.js')
let seq = 0
const req = m => new Promise(resolve => { const id = ++seq; waits.set(id, resolve); globalThis.onmessage({ data: { ...m, id } }) })

const t0 = Date.now()
let r = await req({ type: 'lint', code: 'import os\nprint(x)\n', path: 'main.py' })
console.log(`  (ready in ${Date.now() - t0} ms)`)
ok('lint ok', r.ok, r.error)
ok('undefined name', r.result.some(d => d.kind === 'UndefinedName' && d.line === 2 && d.args[0] === 'x'), JSON.stringify(r.result))
ok('unused import', r.result.some(d => d.kind === 'UnusedImport' && d.line === 1), JSON.stringify(r.result))
r = await req({ type: 'lint', code: 'def f(:\n    pass\n' })
ok('syntax error', r.result.length === 1 && r.result[0].severity === 'error' && r.result[0].line === 1, JSON.stringify(r.result))
r = await req({ type: 'lint', code: 'if True:\nprint(1)\n' })
ok('indentation error', r.result[0] && r.result[0].kind === 'IndentationError' && r.result[0].line === 2, JSON.stringify(r.result))
r = await req({ type: 'lint', code: 'import math\nprint(math.pi)\n' })
ok('clean code', r.result.length === 0, JSON.stringify(r.result))

r = await req({ type: 'complete', code: 'import math\nmath.sq', line: 2, col: 7 })
ok('jedi completes module members', r.ok && r.result.some(c => c.name === 'sqrt' && c.complete === 'rt'), JSON.stringify(r).slice(0, 300))
r = await req({ type: 'complete', code: 'names = ["a"]\nnames.ap', line: 2, col: 8 })
ok('jedi infers list methods', r.result.some(c => c.name === 'append'), JSON.stringify(r.result).slice(0, 200))
r = await req({ type: 'complete', code: 'from helpers import \n', line: 1, col: 20, files: { 'helpers.py': 'def double(n):\n    """2 倍にする"""\n    return n * 2\n' } })
ok('completes from project files', r.result.some(c => c.name === 'double'), JSON.stringify(r.result).slice(0, 200))
r = await req({ type: 'signature', code: 'print(1, ', line: 1, col: 9 })
ok('signature help', r.result && r.result.name === 'print' && r.result.index === 0 && r.result.params.length >= 4, JSON.stringify(r.result).slice(0, 200))
r = await req({ type: 'help', code: 'import helpers\nhelpers.double(2)\n', line: 2, col: 10 })
ok('hover docs from project', r.result[0] && /2 倍/.test(r.result[0].doc) && /double\(n\)/.test(r.result[0].sig), JSON.stringify(r.result).slice(0, 300))
r = await req({ type: 'goto', code: 'import helpers\nhelpers.double(2)\n', line: 2, col: 10 })
ok('goto definition in project', r.result[0] && r.result[0].file === 'helpers.py' && r.result[0].line === 1, JSON.stringify(r.result))
r = await req({ type: 'doc', code: 'import math\nmath.sq', line: 2, col: 7, name: 'sqrt' })
ok('completion doc', r.result && /sqrt/.test(r.result.sig), JSON.stringify(r.result).slice(0, 200))

r = await req({ type: 'format', code: 'x=1+2\ndef f( a,b ):\n  return a+b\n' })
ok('format', r.ok && r.result === 'x = 1 + 2\n\n\ndef f(a, b):\n    return a + b\n', JSON.stringify(r.result))

console.log(`pytools: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
