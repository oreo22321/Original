// Python 実行用 Web Worker (モジュールワーカー)
// ・Pyodide (WebAssembly 版の CPython) をアプリに同梱。ライブラリ (numpy など) は import したときに CDN から読み込みます
// ・出力は少しずつまとめて送り、input() は画面の入力欄で受け取ります (共有メモリが使えるとき)
// ・■ (停止) は KeyboardInterrupt で止めます (共有メモリが使えないときは、画面側がワーカーごと止めます)
// ・matplotlib の図は画像にして出力に表示します
// ・プロジェクトのファイルを /home/pyodide/project に置くので、自分のモジュールの import や open() が使えます
import { loadPyodide } from '../../vendor/pyodide/pyodide.mjs'

const PROJECT = '/home/pyodide/project'
const PYODIDE_VERSION = '314.0.8'
const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

let post = m => self.postMessage(m)
let py = null
let loading = null
let shared = null      // { interrupt: Int32Array, ctl: Int32Array, buf: Uint8Array } 共有メモリ (input と停止)
let runId = 0
let lastGlobals = null // 終わった実行の変数 (コンソールで続きを試せるように)
let snapshot = new Map()

// ---- 出力 (まとめて送る) ----
let out = []
let lastFlush = 0
let lastWrite = 0
let lines = 0
const MAX_LINES = 20000
const pending = { out: '', err: '' }
const dec = { out: new TextDecoder(), err: new TextDecoder() }
function flush(force = false) {
  for (const k of ['out', 'err']) {
    // 改行のない最後の行 (input の案内など) も、書き込みが少し止まったら出す
    if (pending[k] && (force || performance.now() - lastWrite > 150)) { push(k, pending[k], true); pending[k] = '' }
  }
  if (out.length) { post({ type: 'output', items: out }); out = [] }
  lastFlush = performance.now()
}
function push(kind, text, partial = false) {
  if (lines >= MAX_LINES) {
    if (lines === MAX_LINES) { out.push({ kind: 'warn', text: `出力が ${MAX_LINES} 行を超えたため、以降は省略します` }); lines++ }
    return
  }
  lines++
  out.push({ kind: kind === 'err' ? 'error-text' : '', text, partial })
  if (out.length > 200) flush()
}
function write(kind, bytes) {
  const s = pending[kind] + dec[kind].decode(bytes, { stream: true })
  const parts = s.split('\n')
  pending[kind] = parts.pop()
  for (const p of parts) push(kind, p)
  lastWrite = performance.now()
  if (out.length && performance.now() - lastFlush > 60) { post({ type: 'output', items: out }); out = []; lastFlush = performance.now() }
  return bytes.length
}
setInterval(() => flush(), 80)

// ---- 読み込み ----
async function ensure() {
  if (py) return py
  if (!loading) {
    loading = (async () => {
      post({ type: 'status', state: 'loading', text: 'Python を準備しています…' })
      const u = new URL('../../vendor/pyodide/', import.meta.url)
      const base = u.protocol === 'file:' ? decodeURIComponent(u.pathname) : u.href // Node (テスト) ではファイルのパス
      const p = await loadPyodide({ indexURL: base, lockFileURL: base + 'pyodide-lock.json', packageBaseUrl: CDN, env: { HOME: '/home/pyodide', MPLBACKEND: 'AGG', PYTHONUNBUFFERED: '1' } })
      p.setStdout({ write: b => write('out', b) })
      p.setStderr({ write: b => write('err', b) })
      p.setStdin({ stdin: readLine, isatty: true })
      if (shared) p.setInterruptBuffer(shared.interrupt)
      p.FS.mkdirTree(PROJECT)
      p.runPython(SETUP)
      py = p
      post({ type: 'status', state: 'ready', text: `Python ${p.runPython('import sys; sys.version.split()[0]')}` })
      return p
    })().catch(e => { loading = null; throw e })
  }
  return loading
}

// input(): 画面に入力欄を出して、入力されるまで待つ (共有メモリで待つので、このワーカーだけが止まる)
function readLine() {
  flush(true)
  if (!shared) throw new Error('この環境では input() を使えません。ページを再読み込みしてからもう一度試してください (初回は再読み込みが必要です)')
  Atomics.store(shared.ctl, 0, 0)
  post({ type: 'input' })
  // 停止されたら抜ける
  for (;;) {
    const r = Atomics.wait(shared.ctl, 0, 0, 250)
    if (Atomics.load(shared.ctl, 0) !== 0) break
    if (r === 'timed-out' && shared.interrupt[0] !== 0) { post({ type: 'inputDone' }); return null }
  }
  const state = Atomics.load(shared.ctl, 0)
  const len = Atomics.load(shared.ctl, 1)
  post({ type: 'inputDone' })
  if (state === 2) return null // EOF
  return new TextDecoder().decode(shared.buf.slice(0, len)) + '\n'
}

// Python 側の道具
const SETUP = `
import sys, os, traceback, builtins, json, base64, io
__fc_builtin_input = builtins.input
__fc_project = ${JSON.stringify(PROJECT)}
if __fc_project not in sys.path:
    sys.path.insert(0, __fc_project)

def __fc_frames(tb):
    out = []
    for fs in traceback.extract_tb(tb):
        fn = fs.filename
        if fn.startswith(__fc_project + "/"):
            out.append({"file": fn[len(__fc_project) + 1:], "line": fs.lineno, "name": fs.name, "code": fs.line or ""})
        elif fn.startswith("<") and fn != "<exec>":
            out.append({"file": fn, "line": fs.lineno, "name": fs.name, "code": fs.line or ""})
    return out

def __fc_error(e):
    tb = e.__traceback__
    frames = __fc_frames(tb)
    info = {"type": type(e).__name__, "message": str(e), "frames": frames}
    if isinstance(e, SyntaxError):
        fn = e.filename or ""
        if fn.startswith(__fc_project + "/"):
            fn = fn[len(__fc_project) + 1:]
        info.update({"file": fn, "line": e.lineno, "col": e.offset, "text": (e.text or "").rstrip("\\n"), "syntax": True})
    lines = traceback.format_exception(type(e), e, tb)
    text = "".join(lines).replace(__fc_project + "/", "")
    # この道具自体の行は見せない
    text = "\\n".join(l for l in text.split("\\n") if "<exec>" not in l and "__fc_" not in l)
    info["text"] = text
    return json.dumps(info)

def __fc_no_input(prompt=""):
    raise RuntimeError("この環境では input() を使えません。ページを再読み込みしてから、もう一度実行してください (はじめて開いたときは再読み込みが必要です)")

def __fc_show_figures():
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return
    import js
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")
        js.__fc_image(base64.b64encode(buf.getvalue()).decode())
    plt.close("all")

def __fc_prepare_matplotlib():
    try:
        import matplotlib
        matplotlib.use("agg")
        import matplotlib.pyplot as plt
        plt.show = lambda *a, **k: __fc_show_figures()
    except Exception:
        pass

__fc_last = {"g": None, "err": None}
def __fc_run(path, src):
    g = {"__name__": "__main__", "__file__": __fc_project + "/" + path, "__builtins__": builtins}
    __fc_last["g"] = g
    __fc_last["err"] = None
    try:
        code = compile(src, __fc_project + "/" + path, "exec")
        exec(code, g)
    except BaseException as e:
        __fc_last["err"] = __fc_error(e)
    return __fc_last["err"]

def __fc_eval(code, g):
    import ast
    try:
        tree = ast.parse(code, "<console>", "exec")
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body.pop().value)
            exec(compile(tree, "<console>", "exec"), g)
            v = eval(compile(last, "<console>", "eval"), g)
            return json.dumps({"ok": True, "value": None if v is None else repr(v)})
        exec(compile(tree, "<console>", "exec"), g)
        return json.dumps({"ok": True, "value": None})
    except BaseException as e:
        info = json.loads(__fc_error(e))
        return json.dumps({"ok": False, "type": info["type"], "error": info["text"].strip()})
`

self.__fc_image = b64 => { flush(true); post({ type: 'image', data: b64 }) }

// ---- プロジェクトのファイル ----
function writeProject(files) {
  const FS = py.FS
  // 前回の実行で置いたファイルのうち、もう無いものは消す
  for (const p of snapshot.keys()) if (!(p in files)) { try { FS.unlink(PROJECT + '/' + p) } catch {} }
  snapshot = new Map()
  for (const [path, content] of Object.entries(files)) {
    const full = PROJECT + '/' + path
    FS.mkdirTree(full.slice(0, full.lastIndexOf('/')))
    FS.writeFile(full, content)
    snapshot.set(path, content)
  }
}
// 実行で作られた・変わったファイル (画面のプロジェクトに反映する)
function changedFiles() {
  const FS = py.FS
  const out = {}
  const walk = (dir, rel) => {
    let names = []
    try { names = FS.readdir(dir) } catch { return }
    for (const n of names) {
      if (n === '.' || n === '..' || n === '__pycache__') continue
      const full = dir + '/' + n
      const r = rel ? rel + '/' + n : n
      let st
      try { st = FS.stat(full) } catch { continue }
      if (FS.isDir(st.mode)) walk(full, r)
      else if (st.size < 2_000_000 && /\.(py|txt|csv|json|md|tsv|log|html|xml|ya?ml|ini|cfg|toml)$/i.test(n)) {
        let text
        try { text = FS.readFile(full, { encoding: 'utf8' }) } catch { continue }
        if (snapshot.get(r) !== text) out[r] = text
      }
    }
  }
  walk(PROJECT, '')
  for (const p of snapshot.keys()) { try { FS.stat(PROJECT + '/' + p) } catch { out[p] = null } }
  return out
}

// ---- 実行 ----
async function run(m) {
  const id = m.id
  runId = id
  lines = 0
  const t0 = performance.now()
  try { await ensure() } catch (e) {
    flush(true)
    post({ type: 'done', id, ok: false, reason: 'load', error: 'Python を読み込めませんでした: ' + (e && e.message || e) })
    return
  }
  if (shared) shared.interrupt[0] = 0
  writeProject(m.files || {})
  const src = m.files[m.entry] ?? ''
  // import しているライブラリを先に読み込む (numpy / pandas / matplotlib など)
  try {
    const all = Object.entries(m.files).filter(([p]) => p.endsWith('.py')).map(([, s]) => s).join('\n')
    let announced = false
    await py.loadPackagesFromImports(all, {
      messageCallback: msg => { if (/^Loading /.test(msg) && !announced) { announced = true; flush(true); post({ type: 'output', items: [{ kind: 'meta', text: 'ライブラリを読み込んでいます… (初回だけ時間がかかります)' }] }) } },
      errorCallback: msg => post({ type: 'output', items: [{ kind: 'warn', text: msg }] }),
    })
    if (/\bmatplotlib\b/.test(all)) py.runPython('__fc_prepare_matplotlib()')
  } catch (e) {
    post({ type: 'output', items: [{ kind: 'warn', text: 'ライブラリを読み込めませんでした (インターネットの接続を確認してください): ' + (e && e.message || e) }] })
  }
  let ok = true, error = null, reason = 'done'
  try {
    py.globals.set('__fc_entry', m.entry)
    py.globals.set('__fc_src', src)
    py.runPython('import os; os.chdir(__fc_project)')
    // 共有メモリがない (画面を待てない) ときは、input() を分かるエラーにする
    py.runPython(shared ? 'builtins.input = __fc_builtin_input' : 'builtins.input = __fc_no_input')
    const errJson = py.runPython('__fc_run(__fc_entry, __fc_src)')
    if (lastGlobals) { try { lastGlobals.destroy() } catch {} }
    lastGlobals = py.runPython('__fc_last["g"]')
    if (errJson) {
      error = JSON.parse(errJson)
      if (error.type === 'KeyboardInterrupt') { reason = 'stopped'; error = null }
      else if (error.type === 'SystemExit') { reason = 'exit'; error = null }
      else { ok = false; reason = 'error' }
    }
    try { py.runPython('__fc_show_figures()') } catch {}
  } catch (e) {
    ok = false
    reason = 'error'
    error = { type: 'Error', message: String(e && e.message || e), text: String(e && e.message || e), frames: [] }
  }
  flush(true)
  let files = {}
  try { files = changedFiles() } catch {}
  post({ type: 'done', id, ok, reason, error, files, ms: Math.round(performance.now() - t0) })
}

// コンソール: 最後の実行の続きで、式や文を実行
async function evalCode(m) {
  try { await ensure() } catch (e) { post({ type: 'evalResult', id: m.id, ok: false, error: String(e.message || e) }); return }
  if (shared) shared.interrupt[0] = 0
  try {
    if (!lastGlobals) lastGlobals = py.runPython('{"__name__": "__main__", "__builtins__": __import__("builtins")}')
    await py.loadPackagesFromImports(m.code).catch(() => {})
    py.globals.set('__fc_g', lastGlobals)
    py.globals.set('__fc_code', m.code)
    const r = JSON.parse(py.runPython('__fc_eval(__fc_code, __fc_g)'))
    flush(true)
    try { py.runPython('__fc_show_figures()') } catch {}
    if (r.ok) post({ type: 'evalResult', id: m.id, ok: true, value: r.value })
    else post({ type: 'evalResult', id: m.id, ok: false, error: r.type === 'KeyboardInterrupt' ? '停止しました' : r.error })
  } catch (e) {
    flush(true)
    post({ type: 'evalResult', id: m.id, ok: false, error: String(e && e.message || e) })
  }
}

self.onmessage = e => {
  const m = e.data
  if (!m) return
  if (m.type === 'init') {
    if (m.interrupt && m.ctl && m.buf) shared = { interrupt: new Int32Array(m.interrupt), ctl: new Int32Array(m.ctl), buf: new Uint8Array(m.buf) }
    ensure().catch(err => post({ type: 'status', state: 'error', text: 'Python を読み込めませんでした: ' + (err && err.message || err) }))
  } else if (m.type === 'run') run(m)
  else if (m.type === 'eval') evalCode(m)
}
