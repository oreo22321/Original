// Forge AI (内蔵 AI) のテスト:  node tests/ai.test.mjs
// ことばの理解・構文の修復・レビュー・説明・コメント/型ヒント・生成・会話の振り分け・続きの提案 (Python)
import { detectIntents, concepts, slots, extractCode, Bm25 } from '../js/ai/text.js'
import { repairSyntax, fixAll, modernize, formatCode, replaceInCode } from '../js/ai/repair.js'
import { reviewCode, applyReviewFixes, autoFixable } from '../js/ai/review.js'
import { explainCode, addComments, addTypes } from '../js/ai/describe.js'
import { generateCode, RECIPES } from '../js/ai/generate.js'
import { respond, verifyLlmCode, searchKnowledge } from '../js/ai/engine.js'
import { completeLine, codeFromComment, setProjectCorpus, warmComplete } from '../js/ai/complete.js'
import { applyEdits } from '../js/ai/pycode.js'
import { explainError } from '../js/app/explain.js'

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else { fail++; console.log(`✗ ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`) }
}
const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`✗ ${name} ${info}`) } }

// ---- Python の解析 (pytools ワーカーを同じプロセスで動かす) ----
const waits = new Map()
globalThis.self = globalThis
globalThis.postMessage = m => { const w = waits.get(m.id); if (w) { waits.delete(m.id); w(m) } }
await import('../js/workers/pytools-worker.js')
let seq = 0
let projectFiles = {}
const py = (type, args = {}) => new Promise((resolve, reject) => {
  const id = ++seq
  waits.set(id, m => (m.ok ? resolve(m.result) : reject(new Error(m.error))))
  globalThis.onmessage({ data: { type, id, ...args, files: projectFiles } })
})

// ---- ことばの理解 ----
const top = t => (detectIntents(t)[0] || {}).id
eq('intent fix', top('このバグを直して'), 'fix')
eq('intent explain', top('このコードを説明して'), 'explain')
eq('intent comment (katakana)', top('コメントを追加して'), 'comment')
eq('intent format', top('整形して'), 'format')
eq('intent generate', top('数当てゲームを作って'), 'generate')
eq('intent question', top('リストの使い方を教えて'), 'question')
eq('intent help', top('何ができる?'), 'help')
eq('intent error', top("NameError: name 'x' is not defined"), 'error')
eq('intent types', top('型ヒントを付けて'), 'types')
ok('concepts', concepts('リストを並べ替えて合計する').size >= 2, JSON.stringify([...concepts('リストを並べ替えて合計する')]))
const sl = slots('1 から 100 まで 10 回くり返す')
ok('slots numbers', sl.numbers && sl.numbers.some(x => x.v === 100) && sl.times === 10, JSON.stringify(sl))
ok('extract fenced code', extractCode('これを見て\n```python\nprint(1)\n```') === 'print(1)')
ok('extract bare code', /def f/.test(extractCode('def f(x):\n    return x * 2\n') || ''))
ok('bm25', new Bm25([{ id: 'a', fields: [['りんご みかん', 1]] }, { id: 'b', fields: [['ぶどう', 1]] }]).search('みかん', 1)[0].id === 'a')

// ---- 構文の修復 ----
let r = await repairSyntax(py, 'def f(x)\n    return x\n')
eq('repair missing colon', r.text, 'def f(x):\n    return x\n')
r = await repairSyntax(py, 'if x = 1:\n    pass\n')
ok('repair = in if', /if x == 1:/.test(r.text), r.text)
r = await repairSyntax(py, 'print "hi"\n')
ok('repair python2 print', /print\("hi"\)/.test(r.text), r.text)
r = await repairSyntax(py, 'x = （1 + 2）\nprint（x）\n')
ok('repair fullwidth', r.text === 'x = (1 + 2)\nprint(x)\n', r.text)
r = await repairSyntax(py, 'for i in range(3):\nprint(i)\n')
ok('repair missing indent', r.text === 'for i in range(3):\n    print(i)\n', r.text)
r = await repairSyntax(py, 'print("abc)\n')
ok('repair unclosed string', /print\("abc"\)/.test(r.text), r.text)
r = await fixAll(py, 'nums = [1, 2]\nprnt(len(nums))\nprint(math.pi)\n')
ok('fix typo + import', r.ok && /^import math/m.test(r.text) && /\bprint\(len\(nums\)\)/.test(r.text), r.text)
r = await modernize(py, 'name = "A"\nprint("Hello " + name + "!")\n')
ok('modernize f-string', /f"Hello \{name\}!"/.test(r.text), r.text)
eq('format', await formatCode(py, 'x=1+2\ndef f( a,b ):\n  return a+b\n'), 'x = 1 + 2\n\n\ndef f(a, b):\n    return a + b\n')
eq('replaceInCode skips strings', replaceInCode('s = "a = b"; a = b', /(\w) = (\w)/, '$1 == $2'), 's = "a = b"; a == b')
eq('applyEdits', applyEdits('ab\ncd\n', [{ line: 2, col: 0, endLine: 2, endCol: 1, text: 'X' }]).text, 'ab\nXd\n')

// ---- レビュー ----
const buggy = 'def add(item, items=[]):\n    items.append(item)\n    return items\n\n\nx = None\nif x == None:\n    print("none")\ntry:\n    n = int("a")\nexcept:\n    pass\n'
let rv = await reviewCode(py, buggy)
ok('review ok', rv.ok, JSON.stringify(rv).slice(0, 200))
const ids = rv.findings.map(f => f.id)
for (const k of ['mutable_default', 'eq_none', 'bare_except']) ok('review finds ' + k, ids.includes(k), JSON.stringify(ids))
const fixed = applyReviewFixes(buggy, autoFixable(rv.findings))
ok('review fixes', /items=None/.test(fixed) && /if items is None:\n\s+items = \[\]/.test(fixed) && /x is None/.test(fixed) && /except Exception:/.test(fixed), fixed)
rv = await reviewCode(py, 'def f(:\n')
ok('review syntax error', !rv.ok && rv.error && rv.error.line === 1, JSON.stringify(rv))

// ---- 説明・コメント・型ヒント ----
const prog = 'import random\n\n\ndef roll(sides=6):\n    return random.randint(1, sides)\n\n\nfor i in range(3):\n    print(roll())\n'
let ex = await explainCode(py, prog)
ok('explain ok', ex.ok && /random/.test(ex.markdown) && /roll/.test(ex.markdown) && /3 回/.test(ex.markdown), ex.markdown)
let cm = await addComments(py, prog)
ok('comments', cm.ok && cm.count >= 2 && /^# /m.test(cm.text) && cm.text.split('\n').filter(l => !/^\s*#/.test(l)).join('\n') === prog.split('\n').filter(l => !/^\s*#/.test(l)).join('\n') && !/ $/m.test(cm.text), cm.text)
let ty = await addTypes(py, 'def area(w, h=1.0, name="x"):\n    return w * h\n\n\ndef ok():\n    return True\n')
ok('types', ty.ok && /h: float = 1\.0/.test(ty.text) && /name: str = "x"/.test(ty.text) && /def ok\(\) -> bool:/.test(ty.text), ty.text)

// ---- 生成 ----
let g = generateCode('数当てゲームを作って')
ok('generate guess game', g && /random/.test(g.files[0].code) && /input\(/.test(g.files[0].code), g && g.title)
g = generateCode('1 から 50 まで足すプログラム')
ok('generate sum with slot', g && /51|50/.test(g.files[0].code), g && g.files[0].code)
let bad = []
for (const rec of RECIPES) {
  const gen = generateCode(rec.example || rec.title || '')
  if (!gen) continue
  for (const f of gen.files) if (await py('lint', { code: f.code, path: f.name }).then(l => l.some(d => d.severity === 'error'))) bad.push(rec.id + ':' + f.name)
}
ok('every recipe parses', !bad.length, bad.join(', '))

// ---- エラーの説明 ----
ok('explain NameError', /作られて/.test((explainError("Traceback (most recent call last):\n  File \"main.py\", line 2\nNameError: name 'x' is not defined") || {}).why || ''))
ok('explain TypeError object', !!explainError({ type: 'TypeError', message: 'can only concatenate str (not "int") to str' }))

// ---- 知識 ----
ok('knowledge list', (searchKnowledge('リストの使い方')[0] || {}).ref && /リスト/.test(searchKnowledge('リストの使い方')[0].ref.t))
ok('knowledge dict', /辞書/.test(searchKnowledge('辞書とは')[0].ref.t))

// ---- 会話 (アプリの代わりの host) ----
function makeHost(files, activePath, sel = null) {
  const fs = new Map(Object.entries(files))
  let active = activePath
  const writes = []
  const host = {
    hasProject: true,
    files: () => [...fs.keys()].map(path => ({ path })),
    active: () => (active ? { path: active, text: fs.get(active), from: sel ? sel[0] : 0, to: sel ? sel[1] : 0 } : null),
    read: p => fs.get(p),
    write: async (p, t) => { fs.set(p, t); writes.push(p) },
    create: async (p, t, o = {}) => { fs.set(p, t); writes.push(p); if (o.focus) active = p },
    py: (type, args) => { projectFiles = Object.fromEntries(fs); return py(type, args) },
    lastErrors: () => [],
    run: null,
    undoLast: null,
    llm: null,
  }
  return { host, fs, writes }
}
const say = async (h, text, memory = {}) => respond({ text, host: h.host, memory })

let h = makeHost({ 'main.py': 'def f(x)\n    return x\nprnt(f(1))\n' }, 'main.py')
let a = await say(h, '直して')
ok('chat fix', a.changed && h.fs.get('main.py') === 'def f(x):\n    return x\nprint(f(1))\n' && /直しました/.test(a.text), a.text + '\n' + h.fs.get('main.py'))

h = makeHost({ 'main.py': 'x=1\ndef f( a ):\n  return a\n' }, 'main.py')
a = await say(h, '整形して')
ok('chat format', a.changed && h.fs.get('main.py') === 'x = 1\n\n\ndef f(a):\n    return a\n', h.fs.get('main.py'))

h = makeHost({ 'main.py': prog }, 'main.py')
a = await say(h, '説明して')
ok('chat explain', /roll/.test(a.text) && !a.changed, a.text)
a = await say(h, 'コメントを追加して')
ok('chat comments', a.changed && /# /.test(h.fs.get('main.py')), a.text)

h = makeHost({ 'main.py': buggy }, 'main.py')
a = await say(h, 'レビューして')
ok('chat review', /バグになりそう/.test(a.text) && a.chips.includes('直して'), a.text)
a = await say(h, '直して')
ok('chat fix applies review fixes', /except Exception:/.test(h.fs.get('main.py')) && /items=None/.test(h.fs.get('main.py')), h.fs.get('main.py'))

// 選択範囲だけ (字下げされたブロック)
const nested = 'def main():\n    x=1\n    if x==1 :\n        print( x )\n\n\nmain()\n'
h = makeHost({ 'main.py': nested }, 'main.py', [nested.indexOf('    x=1'), nested.indexOf('main()\n', 20)])
a = await say(h, '整形して')
ok('chat format selection', h.fs.get('main.py') === 'def main():\n    x = 1\n    if x == 1:\n        print(x)\n\n\nmain()\n', JSON.stringify(h.fs.get('main.py')))

h = makeHost({ 'main.py': '' }, 'main.py')
const mem = {}
a = await say(h, '数当てゲームを作って', mem)
ok('chat generate into empty file', a.changed && /random/.test(h.fs.get('main.py')) && h.writes[0] === 'main.py', a.text)
ok('memory lastGen', mem.lastGen && mem.lastGen.files[0] === 'main.py')

h = makeHost({ 'main.py': 'print(1)\n' }, 'main.py')
a = await say(h, '1 から 100 まで足すプログラムを作って', mem)
ok('chat generate new file', a.changed && h.writes[0] !== 'main.py' && /sum|total|合計/.test(h.fs.get(h.writes[0])), a.text)

a = await say(h, 'for 文の使い方を教えて')
ok('chat question', /for/.test(a.text) && /range/.test(a.text), a.text)
a = await say(h, "NameError: name 'cnt' is not defined")
ok('chat error explain', /cnt/.test(a.text) && /作られて/.test(a.text), a.text)
a = await say(h, 'enumerate とは')
ok('chat python help', /enumerate/.test(a.text), a.text)
a = await say(h, '何ができる?')
ok('chat help', /Forge AI/.test(a.text))
a = await say(h, '```python\nfor i in range(3)\n    print(i)\n```\nこれを直して')
ok('chat pasted fix', /for i in range\(3\):/.test(a.text), a.text)

h = makeHost({ 'main.py': 'def area(w, h=2):\n    return w * h\n' }, 'main.py')
a = await say(h, '型ヒントを付けて')
ok('chat types', a.changed && /h: int = 2/.test(h.fs.get('main.py')), h.fs.get('main.py'))

h = makeHost({ 'main.py': 'from helpers import double\nprint(double(2))\n', 'helpers.py': 'def double(n):\n    return n * 2\n' }, 'main.py')
a = await say(h, 'double を twice に名前を変えて')
ok('chat rename across files', /def twice/.test(h.fs.get('helpers.py')) && /import twice/.test(h.fs.get('main.py')), a.text)

// ---- LLM の答えの検証 ----
const v = await verifyLlmCode(py, 'こうします:\n```python\nfor i in range(3)\n    print(i)\n```')
ok('verify llm code', /range\(3\):/.test(v.text) && v.notes.length === 1, JSON.stringify(v))

// ---- 続きの提案 (n-gram) ----
await warmComplete()
await setProjectCorpus([{ path: 'a.py', text: 'for name in names:\n    print(name)\n' }])
const c = completeLine('for name in na')
ok('complete line', c && /mes/.test(c), JSON.stringify(c))
const cc = await codeFromComment('# 1 から 10 まで表示する\n')
ok('code from comment', cc && /range\(1, 11\)/.test(cc.code), JSON.stringify(cc))

// ---- 端末内 AI に任せる仕事 (偽のモデルで、答えの検証を確かめる) ----
const { aiCheck, aiFixError, aiComplete, refineCode, fixWindow } = await import('../js/ai/assist.js')
const fakeGen = answers => async (messages, opts) => { fakeGen.last = { messages, opts }; return typeof answers === 'function' ? answers(messages, opts) : answers.shift() }
let found = await aiCheck(py, 'age = input("年齢: ")\nif age >= 20:\n    print("大人")\nprint(totl)\n', { gen: fakeGen(['L2: input() は文字列なので数と比べられません => if int(age) >= 20:\nL3: print が変です => print(undefined_name)\nL9: 存在しない行 => x']) })
ok('aiCheck keeps a verified fix', found.length === 1 && found[0].line === 2 && found[0].fix && found[0].fix.text === 'if int(age) >= 20:', JSON.stringify(found))
ok('aiCheck asks with numbered lines and the check priority', /1\| age = input/.test(fakeGen.last.messages[1].content) && fakeGen.last.opts.kind === 'check', JSON.stringify(fakeGen.last.opts))
found = await aiCheck(py, 'x = 1\nprint(x)\n', { gen: fakeGen(['NONE']) })
ok('aiCheck NONE', found.length === 0)
found = await aiCheck(py, 'def f(\n', { gen: fakeGen(['L1: x => y']) })
ok('aiCheck skips code with syntax errors', found.length === 0)
const prog2 = 'def total(items):\n    s = 0\n    for i in range(len(items) + 1):\n        s += items[i]\n    return s\n\nprint(total([1, 2, 3]))\n'
eq('fixWindow covers the function', fixWindow(prog2.split('\n'), 4), { start: 1, end: 5 })
let fx = await aiFixError(py, { code: prog2, path: 'main.py', error: { type: 'IndexError', message: 'list index out of range', text: 'Traceback...\nIndexError: list index out of range', line: 4 }, gen: fakeGen(['```python\ndef total(items):\n    s = 0\n    for i in range(len(items)):\n        s += items[i]\n    return s\n```\nrange の終わりを 1 つ減らしました。']) })
ok('aiFixError returns a checked patch', fx && fx.start === 1 && fx.end === 5 && /range\(len\(items\)\):/.test(fx.after) && /print\(total/.test(fx.code) && /range/.test(fx.why), JSON.stringify(fx))
fx = await aiFixError(py, { code: prog2, path: 'main.py', error: { type: 'IndexError', message: 'x', text: 'IndexError', line: 4 }, gen: fakeGen(['```python\ndef total(items:\n```', '```python\ndef total(items):\n    return sum(itemz)\n```']) })
ok('aiFixError rejects broken or undefined answers', fx === null)
const badCode = 'nums = [1, 2]\nprint(sum(numz))\n'
const rf = await refineCode(py, badCode, { gen: fakeGen(['```python\nnums = [1, 2]\nprint(sum(nums))\n```']), run: async () => ({ started: true, errors: [] }) })
ok('refineCode fixes undefined names and runs', rf.code === 'nums = [1, 2]\nprint(sum(nums))' && rf.notes.some(n => /実行/.test(n)), JSON.stringify(rf))
const { generate: realGen, complete: realComplete } = await import('../js/ai/llm.js')
ok('llm functions refuse without a model', await realGen([]).then(() => false, e => /読み込まれていません/.test(e.message)) && await realComplete('a', 'b').then(() => false, () => true))

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
