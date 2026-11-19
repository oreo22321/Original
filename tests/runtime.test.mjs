// ふつうの Python との違いを埋める道具のテスト:  node tests/runtime.test.mjs   (NET=1 で PyPI からのインストールも)
// asyncio・スレッド・multiprocessing・time.sleep・urllib (偽の XMLHttpRequest)・webbrowser・display・turtle・コンソールの await
let pass = 0, fail = 0
const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`✗ ${name} ${info}`) } }

const msgs = []
globalThis.self = globalThis
globalThis.postMessage = m => { msgs.push(m) }
// ブラウザの通信の代わり: 送られた内容をそのまま JSON で返す (URL に 404 があれば 404)
globalThis.XMLHttpRequest = class {
  open(method, url) { this.method = method; this.url = url; this.h = {} }
  setRequestHeader(k, v) { this.h[k] = v }
  send(body) {
    this.status = this.url.includes('404') ? 404 : 200
    this.statusText = this.status === 200 ? 'OK' : 'Not Found'
    this.responseURL = this.url
    this.response = new TextEncoder().encode(JSON.stringify({ method: this.method, url: this.url, headers: this.h, body: body ? new TextDecoder().decode(body) : null })).buffer
  }
  getAllResponseHeaders() { return 'content-type: application/json\r\nx-test: 1\r\n' }
}
await import('../js/workers/python-worker.js')
const send = m => globalThis.onmessage({ data: m })
const until = (pred, ms = 120000) => new Promise((resolve, reject) => {
  const t0 = Date.now()
  const iv = setInterval(() => { const m = msgs.find(pred); if (m) { clearInterval(iv); resolve(m) } else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout')) } }, 20)
})
let seq = 0
async function run(code, extra = {}) {
  msgs.length = 0
  const id = ++seq
  send({ type: 'run', id, files: { 'main.py': code, ...extra }, entry: 'main.py' })
  const done = await until(m => m.type === 'done' && m.id === id)
  await new Promise(r => setTimeout(r, 60))
  const items = msgs.filter(m => m.type === 'output').flatMap(m => m.items)
  return { done, out: items.filter(i => !i.kind || i.kind === 'error-text').map(i => i.text).join('\n'), meta: items.filter(i => i.kind === 'meta' || i.kind === 'warn').map(i => i.text).join('\n'), msgs: msgs.slice() }
}
const errText = r => r.done.error ? r.done.error.text : ''

send({ type: 'init' })

// ---- asyncio (ブラウザの特別な仕組みがなくても動く) ----
let r = await run(`import asyncio
async def work(i):
    await asyncio.sleep(0.02 * i)
    return i * 2
async def main():
    print("gather", await asyncio.gather(*(work(i) for i in range(3))))
    t = asyncio.create_task(work(1))
    print("task", await t)
    print("wait_for", await asyncio.wait_for(work(1), 1))
asyncio.run(main())
loop = asyncio.get_event_loop()
print("ruc", loop.run_until_complete(work(2)))
async def agen():
    for i in range(2):
        yield i
async def m2():
    return [x async for x in agen()]
print("agen", asyncio.run(m2()))
`)
ok('asyncio.run / gather / create_task', r.done.ok && /gather \[0, 2, 4\]/.test(r.out) && /task 2/.test(r.out) && /wait_for 2/.test(r.out), r.out + errText(r))
ok('get_event_loop().run_until_complete', /ruc 4/.test(r.out) && /agen \[0, 1\]/.test(r.out), r.out)
r = await run('import asyncio\nasync def main():\n    raise ValueError("boom")\nasyncio.run(main())\n')
ok('asyncio error has the user line', !r.done.ok && r.done.error.type === 'ValueError' && r.done.error.frames.some(f => f.file === 'main.py' && f.line === 3), JSON.stringify(r.done.error && r.done.error.frames))

// ---- スレッド・プロセス: 順番に実行 ----
r = await run(`import threading
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, as_completed
out = []
def work(n):
    out.append((threading.current_thread().name, n))
ts = [threading.Thread(target=work, args=(i,), name=f"T{i}") for i in range(3)]
for t in ts: t.start()
for t in ts: t.join()
print(out, [t.is_alive() for t in ts], threading.current_thread().name)
with ThreadPoolExecutor(max_workers=4) as ex:
    print("map", list(ex.map(lambda x: x * x, range(4))))
    fs = [ex.submit(pow, 2, i) for i in range(3)]
    print("submit", sorted(f.result() for f in as_completed(fs)))
with ProcessPoolExecutor() as ex:
    print("ppe", list(ex.map(abs, [-1, -2])))
class W(threading.Thread):
    def run(self): print("subclass run")
W().start()
threading.Timer(0.05, lambda: print("timer fired")).start()
`)
ok('threads run in order with their names', r.done.ok && /\[\('T0', 0\), \('T1', 1\), \('T2', 2\)\] \[False, False, False\] MainThread/.test(r.out), r.out + errText(r))
ok('executors', /map \[0, 1, 4, 9\]/.test(r.out) && /submit \[1, 2, 4\]/.test(r.out) && /ppe \[1, 2\]/.test(r.out) && /subclass run/.test(r.out) && /timer fired/.test(r.out), r.out)
ok('thread notice once', (r.meta.match(/スレッドを同時に動かせない/g) || []).length === 1, r.meta)
r = await run('import threading\ndef bad():\n    1 / 0\nt = threading.Thread(target=bad)\nt.start(); t.join()\nprint("after")\n')
ok('thread exception is reported and the program goes on', r.done.ok && /Exception in thread/.test(r.out) && /ZeroDivisionError/.test(r.out) && /after/.test(r.out) && !/_forgecode/.test(r.out), r.out)
r = await run(`import multiprocessing as mp
from multiprocessing import Pool, Process, Queue, Value
def sq(x): return x * x
def f(q, v):
    q.put("hi")
    v.value += 1
if __name__ == "__main__":
    with Pool(4) as p:
        print(p.map(sq, range(4)), p.apply_async(sq, (7,)).get(), p.starmap(pow, [(2, 3)]))
    q, v = Queue(), Value("i", 0)
    pr = Process(target=f, args=(q, v))
    pr.start(); pr.join()
    print(q.get(), v.value, pr.exitcode, mp.cpu_count() >= 1)
`)
ok('multiprocessing', r.done.ok && /\[0, 1, 4, 9\] 49 \[8\]/.test(r.out) && /hi 1 0 True/.test(r.out), r.out + errText(r))

// ---- time.sleep ----
r = await run('import time\nt = time.time()\nprint("a", end="")\ntime.sleep(0.2)\nprint("b")\nprint(round(time.time() - t, 1))\ntry:\n    time.sleep(-1)\nexcept ValueError as e:\n    print("VE", e)\n')
ok('time.sleep waits and validates', r.done.ok && /^ab$/m.test(r.out.replace(/\n(?=b)/, '')) && /0\.2/.test(r.out) && /VE sleep length must be non-negative/.test(r.out), r.out)

// ---- urllib (ブラウザの通信) ----
r = await run(`import urllib.request, urllib.error, json
with urllib.request.urlopen("https://api.example.com/x?a=1") as f:
    print(f.status, f.headers["content-type"], json.loads(f.read())["url"])
req = urllib.request.Request("https://api.example.com/p", data=b"hello", headers={"X-A": "1"}, method="POST")
d = json.loads(urllib.request.urlopen(req).read())
print(d["method"], d["body"], d["headers"].get("X-a"))
try:
    urllib.request.urlopen("https://api.example.com/404")
except urllib.error.HTTPError as e:
    print("HTTPError", e.code)
`)
ok('urllib GET', r.done.ok && /200 application\/json https:\/\/api\.example\.com\/x\?a=1/.test(r.out), r.out + errText(r))
ok('urllib POST + headers', /POST hello 1/.test(r.out), r.out)
ok('urllib HTTPError', /HTTPError 404/.test(r.out), r.out)

// ---- sys.argv / webbrowser / display / モジュールの読み直し ----
r = await run('import sys, webbrowser\nprint(sys.argv)\nwebbrowser.open("https://example.com")\nclass T:\n    def _repr_html_(self):\n        return "<table><tr><td>1</td></tr></table>"\ndisplay(T(), {"a": 1})\n')
ok('sys.argv', /\['main\.py'\]/.test(r.out), r.out)
ok('webbrowser.open shows a link', r.msgs.some(m => m.type === 'link' && m.url === 'https://example.com'), JSON.stringify(r.msgs.filter(m => m.type !== 'output')))
ok('display() sends html and plain repr', r.msgs.some(m => m.type === 'html' && /<table>/.test(m.html)) && /\{'a': 1\}/.test(r.out), r.out)
await run('import helper\nprint(helper.V)\n', { 'helper.py': 'V = 1\n' })
r = await run('import helper\nprint(helper.V)\n', { 'helper.py': 'V = 2\n' })
ok('edited project modules are reloaded', /^2$/m.test(r.out), r.out)
r = await run('import tkinter\n')
ok('tkinter explains', !r.done.ok && /tkinter/.test(r.meta) && /turtle/.test(r.meta), r.meta)

// ---- turtle ----
r = await run(`import turtle
t = turtle.Turtle()
t.speed(0)
t.color("red", "yellow")
t.begin_fill()
for i in range(5):
    t.forward(100)
    t.right(144)
t.end_fill()
t.penup(); t.goto(-50, -80); t.write("Star", font=("Arial", 16, "bold"))
t.circle(30)
print(t.position(), round(t.heading()), t.pencolor(), t.isdown())
turtle.done()
`)
const ops = r.msgs.filter(m => m.type === 'turtle').flatMap(m => JSON.parse(m.ops))
ok('turtle runs', r.done.ok && /\(-50\.00,-80\.00\) 0 red False/.test(r.out), r.out + errText(r))
ok('turtle ops', ops[0][0] === 'nt' && ops.some(o => o[0] === 'ef' && o[2].length === 6 && o[3] === 'yellow') && ops.some(o => o[0] === 'tx' && o[4] === 'Star') && ops.filter(o => o[0] === 'm').length > 20, JSON.stringify(ops.slice(0, 5)))
const t0 = Date.now()
r = await run('from turtle import *\nshape("turtle")\nspeed(10)\nfor c in ["red", "green"]:\n    color(c)\n    forward(90)\n    left(90)\nprint(pos(), heading())\n')
const ms = Date.now() - t0
ok('turtle animates at the given speed (Python waits)', r.done.ok && ms > 120 && /\(90\.00,90\.00\) 180\.0/.test(r.out), `${ms}ms ${r.out}${errText(r)}`)
r = await run('import turtle\nturtle.pencolor("notacolor")\n')
ok('turtle bad color', !r.done.ok && r.done.error.type === 'TurtleGraphicsError', JSON.stringify(r.done.error))
r = await run('import turtle\nturtle.colormode(255)\nturtle.pencolor(255, 0, 0)\nprint(turtle.pencolor())\nwn = turtle.Screen()\nwn.onkey(lambda: None, "Up")\nwn.listen()\nturtle.done()\nprint("ended")\n')
ok('turtle colormode 255 and done() without shared memory', r.done.ok && /\(255, 0, 0\)/.test(r.out) && /ended/.test(r.out) && /再読み込み/.test(r.meta), r.out + r.meta + errText(r))
r = await run('import turtle\nturtle.bye()\nturtle.forward(10)\nprint("never")\n')
ok('turtle.bye ends quietly', r.done.ok && r.done.reason === 'exit' && !/never/.test(r.out), JSON.stringify(r.done))

// ---- コンソール: await と表 ----
msgs.length = 0
send({ type: 'eval', id: 900, code: 'import asyncio\nawait asyncio.sleep(0.01)\n1 + 1' })
let ev = await until(m => m.type === 'evalResult' && m.id === 900)
ok('console top-level await', ev.ok && ev.value === '2', JSON.stringify(ev))
send({ type: 'eval', id: 901, code: 'class T:\n    def _repr_html_(self): return "<b>x</b>"\nT()' })
ev = await until(m => m.type === 'evalResult' && m.id === 901)
ok('console rich html value', ev.ok && ev.html === '<b>x</b>', JSON.stringify(ev))
send({ type: 'eval', id: 902, code: 'pip frobnicate' })
ev = await until(m => m.type === 'evalResult' && m.id === 902)
ok('console pip unknown command', !ev.ok && /install/.test(ev.error), JSON.stringify(ev))

// ---- PyPI から (ネットワークを使うので NET=1 のときだけ) ----
if (process.env.NET) {
  r = await run('import emoji\nprint(emoji.emojize(":thumbs_up:"))\n')
  ok('PyPI auto install on import', r.done.ok && /👍/.test(r.out) && /入れました: emoji/.test(r.meta), r.out + r.meta + errText(r))
  r = await run('import nonexistent_pkg_xyz_123\n')
  ok('PyPI missing package explains', !r.done.ok && /入れられませんでした/.test(r.meta), r.meta)
}

console.log(`runtime: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
