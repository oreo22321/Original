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
// ブラウザのキャンバスの代わり (pygame のテスト用: 命令を数えるだけ。画素はすべて 0)
const canvasCalls = []
class FakeCtx {
  constructor(c) { this.canvas = c; this.font = ''; this.fillStyle = '#000' }
  measureText(t) { return { width: String(t).length * 8, fontBoundingBoxAscent: 11, fontBoundingBoxDescent: 3 } }
  getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4) } }
}
for (const m of ['setTransform', 'fillRect', 'clearRect', 'strokeRect', 'drawImage', 'beginPath', 'arc', 'ellipse', 'fill', 'stroke', 'moveTo', 'lineTo', 'closePath', 'rect', 'roundRect', 'save', 'restore', 'translate', 'rotate', 'scale', 'fillText', 'putImageData', 'setLineDash', 'quadraticCurveTo', 'clip']) {
  FakeCtx.prototype[m] = function (...a) { canvasCalls.push([m, a.length]) }
}
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; this.ctx = new FakeCtx(this) } getContext() { return this.ctx } transferToImageBitmap() { return { close() {} } } }
globalThis.ImageData = class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h } }
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

// ---- matplotlib: 図は 1 つの場所で描き直す (偽の matplotlib で確かめる) ----
const FAKE_MPL = {
  'matplotlib/__init__.py': 'def use(x):\n    pass\n',
  'matplotlib/backend_bases.py': 'class FigureCanvasBase:\n    figure = None\n    def flush_events(self):\n        pass\n',
  'matplotlib/pyplot.py': `from matplotlib.backend_bases import FigureCanvasBase
_figs = {}
_cur = [None]
class _Canvas(FigureCanvasBase):
    def __init__(self, fig):
        self.figure = fig
        self.draws = 0
    def draw(self):
        self.draws += 1
    def buffer_rgba(self):
        w, h = int(4 * self.figure.dpi / 100), int(3 * self.figure.dpi / 100)
        return memoryview(bytearray(w * h * 4)).cast("B", (h, w, 4))
class Figure:
    def __init__(self, num):
        self.number = num
        self.dpi = 100
        self.canvas = _Canvas(self)
def figure(num=None):
    if num is None:
        num = max(_figs, default=0) + 1
    if num not in _figs:
        _figs[num] = Figure(num)
    _cur[0] = _figs[num]
    return _figs[num]
def gcf():
    return _cur[0] or figure()
def get_fignums():
    return sorted(_figs)
def close(x=None):
    _figs.clear()
    _cur[0] = None
def plot(*a, **k):
    gcf()
def clf():
    gcf()
def show(*a, **k):
    pass
def pause(t):
    pass
def draw():
    pass
`,
  'matplotlib/animation.py': `class Animation:
    def __init__(self, fig, event_source=None, blit=False):
        self._fig = fig
        self._blit = blit
        self.event_source = None
class FuncAnimation(Animation):
    def __init__(self, fig, func, frames=None, init_func=None, interval=200, repeat=True, **kw):
        self._func = func
        self._frames = frames
        self._interval = interval
        self._repeat = repeat
        self.calls = []
        Animation.__init__(self, fig)
    def new_frame_seq(self):
        return iter(range(self._frames))
    def _init_draw(self):
        pass
    def _draw_frame(self, fd):
        self.calls.append(fd)
        self._func(fd)
`,
}
r = await run(`import matplotlib.pyplot as plt, time
plt.plot([1, 2])
plt.show()
for i in range(4):
    plt.clf()
    plt.pause(0.01)
for i in range(3):
    plt.plot([i])
    plt.show()
    time.sleep(0.01)
for i in range(2):
    plt.plot([i])
    plt.show()
`, FAKE_MPL)
let frames = r.msgs.filter(m => m.type === 'frame')
const keys = frames.map(f => f.key)
ok('matplotlib frames are RGBA (no PNG)', r.done.ok && frames.length >= 9 && frames.every(f => f.data && f.data.length === f.w * f.h * 4) && frames[0].scale === 2 && frames[2].scale === 1.25, r.out + errText(r) + JSON.stringify(frames.map(f => [f.key, f.w, f.h])))
ok('plt.pause redraws in the same place', new Set(keys.slice(1, 5)).size === 1 && keys[1] !== keys[0], keys.join(','))
ok('plt.show in a loop with sleep updates one place, without sleep adds new ones', new Set(keys.slice(5, 8)).size === 1 && keys[8] !== keys[9], keys.join(','))
r = await run(`import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
fig = plt.figure()
seen = []
ani = FuncAnimation(fig, lambda i: seen.append(i), frames=5, interval=10, repeat=False)
plt.show()
print("frames", seen, ani.calls)
`, FAKE_MPL)
frames = r.msgs.filter(m => m.type === 'frame')
ok('FuncAnimation plays all frames in one place', r.done.ok && /frames \[0, 1, 2, 3, 4\]/.test(r.out) && frames.length >= 6 && new Set(frames.map(f => f.key)).size === 1, r.out + errText(r) + frames.length)

// ---- pygame (ForgeCode の互換版) ----
canvasCalls.length = 0
r = await run(`import pygame, sys
pygame.init()
screen = pygame.display.set_mode((320, 240))
pygame.display.set_caption("テスト")
clock = pygame.time.Clock()
font = pygame.font.SysFont(None, 24)
player = pygame.Rect(10, 20, 30, 40)
player.center = (100, 100)
print("rect", player, player.colliderect(pygame.Rect(90, 90, 5, 5)), player.collidepoint(200, 200))
v = pygame.math.Vector2(3, 4)
print("vec", v.length(), (v + (1, 1)).xy, v.normalize().x)
c = pygame.Color("red")
print("color", tuple(c), pygame.Color("#00ff0080").a)
class Ball(pygame.sprite.Sprite):
    def __init__(self, x):
        super().__init__()
        self.image = pygame.Surface((10, 10), pygame.SRCALPHA)
        pygame.draw.circle(self.image, (255, 0, 0), (5, 5), 5)
        self.rect = self.image.get_rect(topleft=(x, 0))
    def update(self):
        self.rect.y += 2
g = pygame.sprite.Group(Ball(0), Ball(50))
for frame in range(3):
    for e in pygame.event.get():
        if e.type == pygame.QUIT:
            sys.exit()
    keys = pygame.key.get_pressed()
    screen.fill((0, 0, 30))
    pygame.draw.rect(screen, (0, 200, 0), player, border_radius=4)
    pygame.draw.line(screen, "white", (0, 0), (100, 100), 3)
    g.update()
    g.draw(screen)
    text = font.render("Score: %d" % frame, True, (255, 255, 255))
    screen.blit(text, (5, 5))
    pygame.display.flip()
    clock.tick(60)
hits = pygame.sprite.spritecollide(Ball(0), g, False)
print("hits", len(hits), keys[pygame.K_LEFT], text.get_size())
img = pygame.transform.rotate(pygame.Surface((20, 10)), 90)
print("rot", img.get_size(), pygame.transform.scale(img, (40, 80)).get_width())
pygame.quit()
`)
frames = r.msgs.filter(m => m.type === 'frame' && m.kind === 'pg')
ok('pygame runs (Rect / Vector2 / Color / sprites / font)', r.done.ok && /rect <Rect\(85, 80, 30, 40\)> True False/.test(r.out) && /vec 5\.0 \[4, 5\] 0\.6/.test(r.out) && /color \(255, 0, 0, 255\) 128/.test(r.out) && /hits 1 False \(\d+, 14\)/.test(r.out) && /rot \(10, 20\) 40/.test(r.out), r.out + errText(r))
ok('pygame frames reach the screen', frames.length >= 4 && frames.every(f => f.bitmap && f.w === 320 && f.h === 240) && frames[0].key === frames[frames.length - 1].key, JSON.stringify(frames.map(f => [f.key, f.w, f.title])))
ok('pygame draws through the canvas', canvasCalls.some(c => c[0] === 'fillText') && canvasCalls.some(c => c[0] === 'arc') && canvasCalls.filter(c => c[0] === 'drawImage').length >= 6, JSON.stringify(canvasCalls.slice(0, 12)))
ok('pygame tells the screen which keys the game uses', r.msgs.some(m => m.type === 'surface' && m.op === 'keys' && m.keys.includes('K_LEFT')) && r.msgs.some(m => m.type === 'surface' && m.op === 'caption' && m.title === 'テスト'), JSON.stringify(r.msgs.filter(m => m.type === 'surface')))
r = await run('import pygame\nfrom pygame.locals import *\nprint(K_SPACE, QUIT, pygame.KEYDOWN, pygame.event.Event(pygame.USEREVENT, a=1).a, pygame.Rect((1, 2), (3, 4)).bottomright)\n')
ok('pygame.locals', r.done.ok && /32 256 768 1 \(4, 6\)/.test(r.out), r.out + errText(r))

// ---- tkinter (ForgeCode の互換版) ----
r = await run(`import tkinter as tk
from tkinter import ttk, messagebox
root = tk.Tk()
root.title("計算")
root.geometry("300x200")
name = tk.StringVar(value="Py")
count = tk.IntVar()
tk.Label(root, text="名前", font=("Arial", 14, "bold"), fg="navy").pack(pady=4)
e = tk.Entry(root, textvariable=name)
e.pack(fill="x", padx=8)
out = tk.Label(root, textvariable=count)
out.pack()
def inc():
    count.set(count.get() + 1)
b = tk.Button(root, text="+1", command=inc, bg="light blue")
b.pack(side="left")
b.invoke(); b.invoke()
frm = ttk.Frame(root)
frm.pack()
for r_ in range(2):
    for c_ in range(2):
        ttk.Button(frm, text=f"{r_}{c_}").grid(row=r_, column=c_, sticky="ew")
cv = tk.Canvas(root, width=200, height=100, bg="black")
cv.pack()
ball = cv.create_oval(10, 10, 30, 30, fill="red", tags="ball")
cv.move("ball", 5, 0)
print("coords", cv.coords(ball), cv.bbox(ball), cv.find_overlapping(0, 0, 20, 20))
print("vars", name.get(), count.get(), e.get())
e.delete(0, tk.END); e.insert(0, "abc")
print("entry", name.get(), e.get())
lb = tk.Listbox(root)
for x in ["a", "b", "c"]:
    lb.insert(tk.END, x)
lb.selection_set(1)
print("list", lb.size(), lb.get(1), lb.curselection())
t = tk.Text(root, height=3)
t.insert("1.0", "hello\\nworld")
print("text", repr(t.get("1.0", "end")), t.get("2.0", "2.end"), t.index("end-1c"))
root.after(10, root.destroy)
root.mainloop()
print("closed")
`)
const tkops = r.msgs.filter(m => m.type === 'tk').flatMap(m => JSON.parse(m.ops))
ok('tkinter runs (vars / entry / canvas / listbox / text)', r.done.ok && /coords \[15\.0, 10\.0, 35\.0, 30\.0\]/.test(r.out) && /vars Py 2 Py/.test(r.out) && /entry abc abc/.test(r.out) && /list 3 b \(1,\)/.test(r.out) && /text 'hello\\nworld\\n' world 2\.5/.test(r.out) && /closed/.test(r.out), r.out + errText(r))
ok('tkinter sends widgets to the screen', tkops.some(o => o[0] === 'win' && o[3].title === 'tk') && tkops.some(o => o[0] === 'title' && o[2] === '計算') && tkops.some(o => o[0] === 'new' && o[3] === 'label' && o[4].font && /bold 19px/.test(o[4].font) && o[4].fg === 'navy') && tkops.some(o => o[0] === 'new' && o[3] === 'button' && o[4].bg === 'lightblue') && tkops.some(o => o[0] === 'geo' && o[2] === 'grid' && o[3].sticky === 'ew') && tkops.some(o => o[0] === 'cv' && o[2] === 'new' && o[4] === 'oval') && tkops.some(o => o[0] === 'cfg' && o[2].text === '2') && tkops.some(o => o[0] === 'del'), JSON.stringify(tkops.slice(0, 8)))
r = await run('import tkinter as tk\nroot = tk.Tk()\ndef bad():\n    1 / 0\nb = tk.Button(root, text="x", command=bad)\nb.invoke()\nprint("still running")\n')
ok('tkinter callback errors are printed and the program goes on', r.done.ok && /still running/.test(r.out) && /Exception in Tkinter callback/.test(r.out) && /ZeroDivisionError/.test(r.out), r.out + errText(r))

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
