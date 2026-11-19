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

// 参照・名前の変更・アウトライン
const main = 'from helpers import double\n\n\ndef twice(v):\n    return double(v)\n\n\nprint(twice(2), double(3))\n'
r = await req({ type: 'refs', code: main, line: 8, col: 17, path: 'main.py' })
ok('references across files', r.ok && r.result.some(x => x.file === 'helpers.py' && x.decl) && r.result.filter(x => x.file === 'main.py').length === 3, JSON.stringify(r).slice(0, 400))
r = await req({ type: 'rename', code: main, line: 4, col: 4, path: 'main.py', name: 'two_times' })
ok('rename in file', r.ok && r.result.files && /def two_times\(v\)/.test(r.result.files['main.py']) && /print\(two_times\(2\)/.test(r.result.files['main.py']), JSON.stringify(r).slice(0, 400))
r = await req({ type: 'rename', code: main, line: 8, col: 17, path: 'main.py', name: 'double_it' })
ok('rename across files', r.ok && r.result.files && /def double_it/.test(r.result.files['helpers.py'] || '') && /import double_it/.test(r.result.files['main.py'] || ''), JSON.stringify(r).slice(0, 400))
r = await req({ type: 'outline', code: 'class A:\n    def f(self):\n        pass\n\n\ndef g():\n    pass\n', path: 'main.py' })
ok('outline', r.ok && r.result.map(x => x.name + x.depth).join(',') === 'A0,f1,g0', JSON.stringify(r).slice(0, 300))

// ---- 実行する前に分かる間違い (py-check.js) ----
const checks = async code => (await req({ type: 'lint', code })).result.filter(d => d.kind === 'Check')
let c = await checks('import math\nprint(math.squareroot(2))\nfrom math import sqroot\nimport ramdom\nimport turtle\nturtle.forwad(100)\n')
ok('check: module attribute', c.some(d => d.line === 2 && /squareroot/.test(d.msg) && d.col === 12 && d.endCol === 22), JSON.stringify(c))
ok('check: from-import name with fix', c.some(d => d.line === 3 && d.fix && d.fix.old === 'sqroot' && d.fix.text === 'sqrt'), JSON.stringify(c))
ok('check: module name typo', c.some(d => d.line === 4 && /random/.test(d.msg)), JSON.stringify(c))
ok('check: turtle attribute (our turtle)', c.some(d => d.line === 6 && d.fix && d.fix.text === 'forward'), JSON.stringify(c))
c = await checks('age = input("年齢: ")\nprint(age + 1)\nif age >= 20:\n    print("大人")\nname = "abc"\nprint(name.uppercase())\nnums = [3, 1]\nnums.push(2)\nx = nums.sort()\nname.upper()\nprint(len(nums, 2))\n')
ok('check: input() used as a number (with int() fix)', c.some(d => d.line === 2 && /input\(\)/.test(d.msg) && d.fix && d.fix.text === 'int(input("年齢: "))') && c.some(d => d.line === 3 && /比べる/.test(d.msg)), JSON.stringify(c))
ok('check: str / list methods', c.some(d => d.line === 6 && d.fix && d.fix.text === 'upper') && c.some(d => d.line === 8 && d.fix && d.fix.text === 'append'), JSON.stringify(c))
ok('check: None-returning method and unused str result', c.some(d => d.line === 9 && /None/.test(d.msg)) && c.some(d => d.line === 10 && d.severity === 'info'), JSON.stringify(c))
ok('check: builtin arity', c.some(d => d.line === 11 && /len\(\)/.test(d.msg)), JSON.stringify(c))
c = await checks('def greet(name, greeting="hi"):\n    return greeting + name\ngreet()\ngreet("a", "b", "c")\ngreet("a", greting="x")\nclass P:\n    def __init__(self, x):\n        self.x = x\nP()\nimport math\nmath.sqrt(1, 2)\n')
ok('check: call arity / keywords (own functions, classes, stdlib)', [3, 4, 5, 9, 11].every(n => c.some(d => d.line === n)) && c.some(d => /greeting/.test(d.msg)), JSON.stringify(c))
c = await checks(`import os, sys, json, random
def f(items, *args, **kw):
    s = ""
    for i in items:
        s += str(i)
    return s
class A:
    name = "x"
    def m(self):
        name = 5
        return name + 1
v = input()
v = int(v)
print(v + 1)
t = "x"
t = t * 3
w = [x for x in "abc"]
print(t.upper(), os.path.join("a", "b"), sys.argv, json.dumps({}), random.randint(1, 2), [s.upper() for s in w], f([1]))
display(1)
`)
ok('check: no false positives on normal code', c.length === 0, JSON.stringify(c))
r = await req({ type: 'lint', code: 'display(1)\n' })
ok('display() is a known builtin', r.result.length === 0, JSON.stringify(r.result))

// ---- import の候補 ----
r = await req({ type: 'complete', code: 'x = sqr', line: 1, col: 7 })
ok('auto-import candidate (from math import sqrt)', r.result.some(c => c.name === 'sqrt' && c.auto === 'from math import sqrt'), JSON.stringify(r.result).slice(0, 300))
r = await req({ type: 'complete', code: 'rand', line: 1, col: 4 })
ok('auto-import module candidate', r.result.some(c => c.name === 'random' && c.auto === 'import random') && r.result.filter(c => c.name === 'random').length === 1, JSON.stringify(r.result).slice(0, 300))
r = await req({ type: 'complete', code: 'import random\nrand', line: 2, col: 4 })
ok('no auto-import for names already imported', !r.result.some(c => c.auto === 'import random'), JSON.stringify(r.result).slice(0, 300))
r = await req({ type: 'complete', code: 'import turtle\nturtle.forw', line: 2, col: 11 })
ok('turtle completion', r.result.some(c => c.name === 'forward'), JSON.stringify(r.result).slice(0, 200))

console.log(`pytools: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
