// 開発の道具 (テストの実行・プロファイラー・Web アプリ・ノートブック) の Python 側のテスト:  node tests/devtools.test.mjs
// ワーカーの中身を Node でそのまま動かします (Pyodide は vendor/pyodide。ネットワークは使いません)
let pass = 0, fail = 0
const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`✗ ${name} ${info}`) } }
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '')

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
const outputText = () => strip(msgs.filter(m => m.type === 'output').flatMap(m => m.items).map(i => i.text).join(''))
const events = kind => msgs.filter(m => m.type === 'event' && m.kind === kind).map(m => JSON.parse(m.data))
let seq = 0
async function run(files, entry = 'main.py', extra = {}) {
  msgs.length = 0
  const id = ++seq
  send({ type: 'run', id, files, entry, ...extra })
  const done = await until(m => m.type === 'done' && m.id === id, 120000)
  await new Promise(r => setTimeout(r, 80))
  return { done, out: outputText() }
}
send({ type: 'init' })

// ---- テストの実行 (内蔵の pytest) ----
const testFiles = {
  'calc.py': 'def add(a, b):\n    return a + b\n\ndef div(a, b):\n    return a / b\n',
  'test_calc.py': [
    'import pytest',
    'from calc import add, div',
    '',
    'def test_add():',
    '    assert add(1, 2) == 3',
    '',
    'def test_add_wrong():',
    '    x = add(2, 2)',
    '    assert x == 5',
    '',
    '@pytest.mark.parametrize("a,b,want", [(1, 1, 2), (2, 3, 5), (0, 0, 1)])',
    'def test_param(a, b, want):',
    '    assert add(a, b) == want',
    '',
    'def test_raises():',
    '    with pytest.raises(ZeroDivisionError):',
    '        div(1, 0)',
    '',
    '@pytest.mark.skip(reason="あとで")',
    'def test_skip():',
    '    assert False',
    '',
    'def test_fixture(tmp_path, capsys):',
    '    p = tmp_path / "a.txt"',
    '    p.write_text("hi")',
    '    print("hello")',
    '    assert p.read_text() == "hi"',
    '    assert capsys.readouterr().out == "hello\\n"',
    '',
    '@pytest.fixture',
    'def nums():',
    '    yield [1, 2, 3]',
    '',
    'def test_user_fixture(nums):',
    '    assert sum(nums) == 6',
    '',
    'def test_lists():',
    '    assert [1, 2, 3] == [1, 9, 3]',
    '',
    'def test_approx():',
    '    assert 0.1 + 0.2 == pytest.approx(0.3)',
    '',
    'class TestGroup:',
    '    def test_in_class(self):',
    '        assert "a" in "abc"',
    '',
    'def test_call_explained():',
    '    assert add(2, 2) == 5',
    '',
  ].join('\n'),
  'test_unit.py': 'import unittest\n\nclass T(unittest.TestCase):\n    def test_ok(self):\n        self.assertEqual(1 + 1, 2)\n    def test_bad(self):\n        self.assertEqual("a", "b")\n',
}
let r = await run({ ...testFiles, '<tests>': 'import _fctest\nraise SystemExit(_fctest.main(["--fc-builtin"]))\n' }, '<tests>')
const res = events('tests').filter(e => e.phase === 'result')
const by = id => res.find(x => x.id === id) || {}
ok('tests: start event', events('tests')[0] && events('tests')[0].phase === 'start' && events('tests')[0].total === 15, JSON.stringify(events('tests')[0]))
ok('tests: pass', by('test_calc.py::test_add').outcome === 'passed')
ok('tests: assert explained', by('test_calc.py::test_add_wrong').outcome === 'failed' && /assert 4 == 5/.test(by('test_calc.py::test_add_wrong').message) && by('test_calc.py::test_add_wrong').at.line === 9, JSON.stringify(by('test_calc.py::test_add_wrong')))
ok('tests: parametrize', by('test_calc.py::test_param[1-1-2]').outcome === 'passed' && by('test_calc.py::test_param[0-0-1]').outcome === 'failed', res.map(x => x.id).join(','))
ok('tests: raises', by('test_calc.py::test_raises').outcome === 'passed')
ok('tests: skip', by('test_calc.py::test_skip').outcome === 'skipped' && by('test_calc.py::test_skip').message === 'あとで')
ok('tests: tmp_path + capsys', by('test_calc.py::test_fixture').outcome === 'passed', JSON.stringify(by('test_calc.py::test_fixture')))
ok('tests: user fixture', by('test_calc.py::test_user_fixture').outcome === 'passed', JSON.stringify(by('test_calc.py::test_user_fixture')))
ok('tests: list diff', /1 番目が違います: 2 != 9/.test(by('test_calc.py::test_lists').message), by('test_calc.py::test_lists').message)
ok('tests: approx', by('test_calc.py::test_approx').outcome === 'passed')
ok('tests: class', by('test_calc.py::TestGroup::test_in_class').outcome === 'passed')
ok('tests: call explained', /assert 4 == 5/.test(by('test_calc.py::test_call_explained').message) && /add\(2, 2\) の結果: 4/.test(by('test_calc.py::test_call_explained').message), by('test_calc.py::test_call_explained').message)
ok('tests: unittest', by('test_unit.py::T::test_ok').outcome === 'passed' && by('test_unit.py::T::test_bad').outcome === 'failed' && by('test_unit.py::T::test_bad').at.line === 7, JSON.stringify(by('test_unit.py::T::test_bad')))
const doneEv = events('tests').find(e => e.phase === 'done')
ok('tests: done counts', doneEv && doneEv.counts.passed === 9 && doneEv.counts.failed === 5 && doneEv.counts.skipped === 1, JSON.stringify(doneEv))
ok('tests: pytest-like output', /5 失敗, 9 成功, 1 スキップ/.test(r.out) && /test_calc\.py \.F\.\.F\.s\.\.F\.\.F/.test(r.out), r.out)
// 1 つだけ・-k・壊れたファイル
r = await run({ ...testFiles, '<tests>': 'import _fctest\nraise SystemExit(_fctest.main(["--fc-builtin", "test_calc.py::test_add"]))\n' }, '<tests>')
ok('tests: single id', events('tests').filter(e => e.phase === 'result').length === 1, JSON.stringify(events('tests')))
r = await run({ ...testFiles, '<tests>': 'import _fctest\nraise SystemExit(_fctest.main(["--fc-builtin", "-k", "param and not 0"]))\n' }, '<tests>')
ok('tests: -k expression', events('tests').filter(e => e.phase === 'result').length === 2, events('tests').filter(e => e.phase === 'result').map(e => e.id).join())
r = await run({ 'test_broken.py': 'def test_x(:\n    pass\n', '<tests>': 'import _fctest\nraise SystemExit(_fctest.main(["--fc-builtin"]))\n' }, '<tests>')
const br = events('tests').find(e => e.phase === 'result')
ok('tests: collection error', br && br.outcome === 'error' && /SyntaxError/.test(br.message) && br.at.line === 1, JSON.stringify(br))
r = await run({ 'test_fx.py': 'def test_missing(nothing_here):\n    pass\n', '<tests>': 'import _fctest\nraise SystemExit(_fctest.main(["--fc-builtin"]))\n' }, '<tests>')
const mf = events('tests').find(e => e.phase === 'result')
ok('tests: missing fixture', mf && mf.outcome === 'error' && /nothing_here/.test(mf.message), JSON.stringify(mf))

// ---- プロファイラー ----
r = await run({ 'slow.py': 'def fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\n\ndef work():\n    s = 0\n    for i in range(20000):\n        s += i * i\n    return s\n\nprint(fib(16), work())\n', '<profile>': 'import _fcprof\n_fcprof.run_file("slow.py", ["slow.py"])\n' }, '<profile>')
const pe = events('profile')[0]
ok('profile: program output', /987 \d+/.test(r.out), r.out)
ok('profile: event', pe && pe.total > 0 && pe.functions.length > 0, JSON.stringify(pe || {}).slice(0, 300))
const fib = pe && pe.functions.find(f => f.name === 'fib')
ok('profile: fib counted', fib && fib.file === 'slow.py' && fib.line === 1 && fib.calls > 1000 && fib.prim === 1, JSON.stringify(fib))
ok('profile: lines', pe && pe.lines.some(l => l.file === 'slow.py' && l.line === 7 && l.hits >= 20000), JSON.stringify(pe && pe.lines.slice(0, 3)))
ok('profile: text table', /時間のかかった関数/.test(r.out) && /fib/.test(r.out), r.out.slice(-600))
r = await run({ 'bad.py': 'def f():\n    return 1 / 0\nf()\n', '<profile>': 'import _fcprof\n_fcprof.run_file("bad.py")\n' }, '<profile>')
ok('profile: error still reports', events('profile').length === 1 && /ZeroDivisionError/.test(r.out), r.out)

// ---- Web アプリ (WSGI・http.server) ----
async function webReq(req, body = null) {
  msgs.length = 0
  const id = 'w' + (++seq)
  send({ type: 'web', id, req: { method: 'GET', path: '/', query: '', headers: [], prefix: '/app/__preview__', ...req }, body })
  const m = await until(x => x.type === 'webResult' && x.id === id, 30000)
  return { status: m.head.status, headers: Object.fromEntries(m.head.headers.map(([k, v]) => [k.toLowerCase(), v])), text: new TextDecoder().decode(m.body) }
}
r = await run({ 'app.py': [
  'from wsgiref.simple_server import make_server',
  'import json',
  'def app(environ, start_response):',
  '    path = environ["PATH_INFO"]',
  '    if path == "/api":',
  '        n = int(environ["wsgi.input"].read(int(environ["CONTENT_LENGTH"] or 0)) or 0)',
  '        start_response("200 OK", [("Content-Type", "application/json")])',
  '        return [json.dumps({"double": n * 2, "method": environ["REQUEST_METHOD"]}).encode()]',
  '    if path == "/boom":',
  '        raise ValueError("こわれた")',
  '    start_response("200 OK", [("Content-Type", "text/html; charset=utf-8")])',
  '    return [("<h1>こんにちは %s</h1>" % environ["SCRIPT_NAME"]).encode()]',
  'with make_server("", 8000, app) as srv:',
  '    srv.serve_forever()',
  'print("after serve")',
].join('\n') }, 'app.py')
ok('web: serve event', events('web').some(e => e.phase === 'serve' && e.kind === 'wsgi'), JSON.stringify(events('web')))
ok('web: program continues', /プレビューで動かしています/.test(r.out) && /after serve/.test(r.out), r.out)
let w = await webReq({ path: '/' })
ok('web: wsgi page', w.status === 200 && /こんにちは \/app\/__preview__/.test(w.text) && /text\/html/.test(w.headers['content-type']), JSON.stringify(w))
w = await webReq({ path: '/api', method: 'POST', headers: [['Content-Type', 'text/plain']] }, new TextEncoder().encode('21'))
ok('web: wsgi post body', w.status === 200 && JSON.parse(w.text).double === 42 && JSON.parse(w.text).method === 'POST', w.text)
w = await webReq({ path: '/boom' })
ok('web: error page', w.status === 500 && /ValueError/.test(w.text) && /app\.py/.test(w.text), w.text.slice(0, 300))
ok('web: request log', /GET \/boom/.test(outputText()), outputText())
r = await run({ 'srv.py': [
  'from http.server import HTTPServer, BaseHTTPRequestHandler',
  'class H(BaseHTTPRequestHandler):',
  '    def do_GET(self):',
  '        self.send_response(200)',
  '        self.send_header("Content-Type", "text/plain; charset=utf-8")',
  '        self.end_headers()',
  '        self.wfile.write(("path=" + self.path).encode())',
  'HTTPServer(("", 8080), H).serve_forever()',
].join('\n') }, 'srv.py')
w = await webReq({ path: '/hello', query: 'a=1' })
ok('web: http.server handler', w.status === 200 && w.text === 'path=/hello?a=1', JSON.stringify(w))

console.log(`\ndevtools: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
