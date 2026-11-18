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
let shared = null      // { interrupt, ctl, buf, dctl, dbuf } 共有メモリ (input・停止・デバッガー)
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
      p.globals.set('__fc_dbg_src', DEBUGGER)
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
    if (r === 'timed-out' && shared.interrupt[0] === 2) { post({ type: 'inputDone' }); return null }
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
def __fc_run(path, src, dbg=None):
    g = {"__name__": "__main__", "__file__": __fc_project + "/" + path, "__builtins__": builtins}
    __fc_last["g"] = g
    __fc_last["err"] = None
    opt = json.loads(dbg) if dbg else None
    __fc_dbg["opt"] = opt
    d = None
    try:
        code = compile(src, __fc_project + "/" + path, "exec")
        # ブレークポイントがあるときだけデバッガーを付けて実行 (ないときは breakpoint() / 一時停止で途中から付ける)
        if opt and opt.get("bps"):
            d = __fc_dbg_start(opt)
            d.run(code, g)
        else:
            exec(code, g)
    except BaseException as e:
        __fc_last["err"] = __fc_error(e)
    finally:
        d = __fc_dbg["cur"]
        if d is not None:
            try:
                d.stop_trace()
            except Exception:
                pass
        __fc_dbg["cur"] = None
        __fc_dbg["opt"] = None
    return __fc_last["err"]

def __fc_eval_in(code, g, l=None):
    import ast
    try:
        tree = ast.parse(code, "<console>", "exec")
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body.pop().value)
            exec(compile(tree, "<console>", "exec"), g, l)
            v = eval(compile(last, "<console>", "eval"), g, l)
            return {"ok": True, "value": None if v is None else repr(v)}
        exec(compile(tree, "<console>", "exec"), g, l)
        return {"ok": True, "value": None}
    except BaseException as e:
        info = json.loads(__fc_error(e))
        return {"ok": False, "type": info["type"], "error": info["text"].strip()}

def __fc_eval(code, g):
    return json.dumps(__fc_eval_in(code, g))

# ---- デバッガー (はじめて使うときに読み込む) ----
__fc_dbg = {"cur": None, "loaded": False, "opt": None}
def __fc_dbg_start(opt):
    import signal
    if not __fc_dbg["loaded"]:
        exec(__fc_dbg_src, globals())
        __fc_dbg["loaded"] = True
    d = __FcDbg(opt.get("bps"), opt.get("watches"))
    __fc_dbg["cur"] = d
    signal.signal(signal.SIGUSR1, __fc_dbg_signal)
    return d

def __fc_dbg_attach(frame):
    # 実行の途中からデバッガーを付ける
    d = __fc_dbg["cur"] or __fc_dbg_start(__fc_dbg["opt"])
    if getattr(d, "botframe", None) is None:
        d.reset()
        f = frame
        while f is not None and not (f.f_code.co_filename.startswith(__fc_project + "/") and f.f_code.co_name == "<module>"):
            f = f.f_back
        d.botframe = f.f_back if f is not None else None
        d.skip_first = False
        d._set_stopinfo(d.botframe, None, -1)  # 止めずに走らせる (ブレークポイントだけで止まる)
    return d

def __fc_breakpointhook(*args, **kwargs):
    # breakpoint() を書いた行で止まる
    if __fc_dbg["opt"] is None:
        print("breakpoint(): この環境ではデバッガーを使えません (ページを再読み込みしてください)", file=sys.stderr)
        return
    frame = sys._getframe(1)
    d = __fc_dbg_attach(frame)
    d.reason = {"kind": "breakpoint"}
    d.pause_now(frame)
sys.breakpointhook = __fc_breakpointhook
`

self.__fc_image = b64 => { flush(true); post({ type: 'image', data: b64 }) }

// ---- デバッガーと画面のやりとり (止まっている間は共有メモリで指示を待つ) ----
const DEBUGGER = `import bdb, reprlib, inspect, types, sys, json, js, re as _re

# クラスの中では __ で始まる名前が変わってしまうので、別名で使う
_FC_PROJECT = __fc_project
_fc_eval_in = __fc_eval_in
def _dbg_post(text):
    js.__fc_dbg_post(text)
def _dbg_wait():
    return js.__fc_dbg_wait()

class __FcDbg(bdb.Bdb):
    # ForgeCode のデバッガー (Python 3.14 の sys.monitoring で動くので、止めない行はほぼ普通の速さ)
    def __init__(self, bps, watches):
        super().__init__(backend="monitoring")
        self.watches = list(watches or [])
        self.reason = None
        self.refs = {}
        self.ref_seq = 0
        self.skip_first = True
        self.rep = reprlib.Repr(maxlevel=2, maxtuple=8, maxlist=8, maxarray=8, maxdict=6, maxset=8, maxfrozenset=8, maxdeque=8, maxstring=80, maxlong=60, maxother=100)
        self.set_bps(bps)

    # ---- ブレークポイント ----
    def set_bps(self, bps):
        self.bps = {}
        for path, lst in (bps or {}).items():
            self.bps[path] = {int(b["line"]): b for b in lst}
        self.breaks = {_FC_PROJECT + "/" + p: sorted(d) for p, d in self.bps.items() if d}

    def ours(self, frame):
        return frame.f_code.co_filename.startswith(_FC_PROJECT + "/")

    def rel(self, frame):
        return frame.f_code.co_filename[len(_FC_PROJECT) + 1:]

    def stop_here(self, frame):
        # 自分のファイルの中だけで止まる (ライブラリの中には入らない)
        return self.ours(frame) and super().stop_here(frame)

    def break_here(self, frame):
        if not self.ours(frame):
            return False
        bp = self.bps.get(self.rel(frame), {}).get(frame.f_lineno)
        if not bp:
            return False
        cond = (bp.get("cond") or "").strip()
        if cond:
            try:
                if not eval(cond, frame.f_globals, frame.f_locals):
                    return False
            except Exception as e:
                self.reason = {"kind": "condError", "error": f"{cond} → {type(e).__name__}: {e}"}
                return True
        log = (bp.get("log") or "").strip()
        if log:
            def sub(m):
                try:
                    return str(eval(m.group(1), frame.f_globals, frame.f_locals))
                except Exception as e:
                    return f"<{type(e).__name__}>"
            text = _re.sub(r"\\{([^{}]+)\\}", sub, log)
            _dbg_post(json.dumps({"type": "output", "items": [{"kind": "log", "text": f"{self.rel(frame)}:{frame.f_lineno}  {text}"}]}))
            return False
        self.reason = {"kind": "breakpoint"}
        return True

    # ---- 止まったとき ----
    def user_call(self, frame, arg):
        pass

    def user_return(self, frame, value):
        # 「外へ」: 呼び出し元の行で止まる (戻り値も表示)
        caller = frame.f_back
        if self.returnframe is frame and self.stopframe is caller and caller is not None and self.ours(caller):
            self.interaction(caller, {"kind": "step"}, ret=(frame.f_code.co_name, value))

    def user_exception(self, frame, info):
        pass

    def user_line(self, frame):
        if self.skip_first:
            # 実行を始めた直後: ブレークポイントがなければ走らせる
            self.skip_first = False
            if not self.break_here(frame):
                self.set_continue()
                return
        reason = self.reason or {"kind": "step"}
        self.reason = None
        self.interaction(frame, reason)

    def pause_now(self, frame):
        # 実行中に「一時停止」/ breakpoint(): 次の自分の行で止まる
        f = frame
        while f is not None:
            if self.ours(f):
                f.f_trace = self.trace_dispatch
                f.f_trace_lines = True
            f = f.f_back
        self.skip_first = False
        self.set_step()
        if sys.monitoring.get_tool(sys.monitoring.DEBUGGER_ID) is None:
            self.start_trace()
        self.monitoring_tracer.update_local_events(frame)
        self.restart_events()

    def retrace(self, frame):
        # ブレークポイントを増やしたとき (止めずに走っている途中)
        if not self.breaks:
            return
        f = frame
        while f is not None:
            if self.ours(f):
                f.f_trace = self.trace_dispatch
                f.f_trace_lines = True
            f = f.f_back
        if sys.monitoring.get_tool(sys.monitoring.DEBUGGER_ID) is None:
            self.start_trace()
        self.monitoring_tracer.update_local_events(frame)
        self.restart_events()

    # ---- 値の表示 ----
    def val(self, v):
        try:
            if v is None:
                return {"t": "nil", "v": "None"}
            if isinstance(v, bool):
                return {"t": "boolean", "v": repr(v)}
            if isinstance(v, (int, float, complex)):
                return {"t": "number", "v": self.rep.repr(v)}
            if isinstance(v, str):
                return {"t": "string", "v": self.rep.repr(v)}
            if isinstance(v, type):
                return {"t": "function", "v": f"<クラス {v.__name__}>", "ref": self.keep(v)}
            if inspect.isroutine(v):
                try:
                    sig = str(inspect.signature(v))
                except Exception:
                    sig = "(…)"
                return {"t": "function", "v": f"{getattr(v, '__name__', '関数')}{sig}"}
            if isinstance(v, types.ModuleType):
                return {"t": "function", "v": f"<モジュール {v.__name__}>"}
            text = self.rep.repr(v)
            n = ""
            if isinstance(v, (list, tuple, dict, set, frozenset)):
                n = f"{type(v).__name__} ({len(v)}) "
            elif not isinstance(v, (bytes, bytearray)):
                n = f"{type(v).__name__} "
                if text.startswith(type(v).__name__):
                    n = ""
            ref = self.keep(v) if self.has_children(v) else None
            out = {"t": "table", "v": (n + text)[:220]}
            if ref:
                out["ref"] = ref
            return out
        except Exception as e:
            return {"t": "error", "v": f"<表示できません: {type(e).__name__}>"}

    def keep(self, v):
        self.ref_seq += 1
        self.refs[self.ref_seq] = v
        return self.ref_seq

    def has_children(self, v):
        if isinstance(v, (str, bytes, bytearray, int, float, complex, bool)) or v is None:
            return False
        if isinstance(v, (list, tuple, dict, set, frozenset)):
            return len(v) > 0
        return bool(getattr(v, "__dict__", None)) or bool(getattr(type(v), "__slots__", None))

    def children(self, ref):
        v = self.refs.get(ref)
        items = []
        if v is None:
            return items
        try:
            if isinstance(v, dict):
                for k, x in list(v.items())[:300]:
                    items.append({"name": self.rep.repr(k), "value": self.val(x)})
            elif isinstance(v, (list, tuple)):
                for i, x in enumerate(v[:300]):
                    items.append({"name": f"[{i}]", "value": self.val(x)})
            elif isinstance(v, (set, frozenset)):
                for x in list(v)[:300]:
                    items.append({"name": "•", "value": self.val(x)})
            else:
                attrs = dict(getattr(v, "__dict__", None) or {})
                for s in getattr(type(v), "__slots__", ()) or ():
                    if hasattr(v, s):
                        attrs[s] = getattr(v, s)
                for k, x in list(attrs.items())[:300]:
                    if not (k.startswith("__") and k.endswith("__")):
                        items.append({"name": k, "value": self.val(x)})
        except Exception as e:
            items.append({"name": "(エラー)", "value": {"t": "error", "v": f"{type(e).__name__}: {e}"}})
        return items

    def var_list(self, d, glob=False):
        out = []
        for k, x in list(d.items()):
            if k.startswith("__") and k.endswith("__"):
                continue
            if glob and (isinstance(x, types.ModuleType) or k.startswith("_")):
                continue
            out.append({"name": k, "value": self.val(x)})
            if len(out) >= 300:
                break
        return out

    def eval_watches(self, frame):
        res = []
        for code in self.watches:
            try:
                res.append({"code": code, "value": self.val(eval(code, frame.f_globals, frame.f_locals))})
            except Exception as e:
                res.append({"code": code, "error": f"{type(e).__name__}: {e}"})
        return res

    def snapshot(self, frame, reason, ret=None):
        stack = []
        f = frame
        while f is not None:
            if self.ours(f):
                name = f.f_code.co_name
                stack.append({"name": "(モジュール)" if name == "<module>" else name + "()", "file": self.rel(f), "line": f.f_lineno})
            f = f.f_back
        module = frame.f_code.co_name == "<module>"
        local_vars = [] if module else self.var_list(frame.f_locals)
        if ret is not None:
            local_vars.insert(0, {"name": f"({ret[0]} の戻り値)", "value": self.val(ret[1])})
        return {"type": "paused", "file": self.rel(frame), "line": frame.f_lineno, "reason": reason,
                "locals": local_vars,
                "globals": self.var_list(frame.f_globals, glob=True),
                "stack": stack, "watches": self.eval_watches(frame)}

    def interaction(self, frame, reason, ret=None):
        self.refs = {}
        _dbg_post(json.dumps(self.snapshot(frame, reason, ret)))
        try:
            while True:
                cmd = json.loads(_dbg_wait())
                t = cmd.get("type")
                if t == "expand":
                    _dbg_post(json.dumps({"type": "expanded", "id": cmd.get("id"), "items": self.children(cmd.get("ref"))}))
                elif t == "watches":
                    self.watches = list(cmd.get("list") or [])
                    _dbg_post(json.dumps({"type": "watchValues", "watches": self.eval_watches(frame)}))
                elif t == "breakpoints":
                    self.set_bps(cmd.get("list"))
                elif t == "eval":
                    _dbg_post(json.dumps(dict(_fc_eval_in(cmd.get("code", ""), frame.f_globals, frame.f_locals), type="evalResult", id=cmd.get("id"))))
                    # 値を変えたかもしれないので、表示を更新
                    _dbg_post(json.dumps(self.snapshot(frame, reason, ret)))
                elif t == "stop":
                    raise KeyboardInterrupt
                elif t == "debug":
                    a = cmd.get("action")
                    if a == "continue":
                        self.set_continue()
                    elif a == "over":
                        self.set_next(frame)
                    elif a == "in":
                        self.set_step()
                    elif a == "out":
                        self.set_return(frame)
                    else:
                        continue
                    break
        finally:
            self.refs = {}
            _dbg_post(json.dumps({"type": "resumed"}))

def __fc_dbg_signal(sig, frame):
    # 画面からの指示 (実行中): 一時停止 / ブレークポイントの変更 / ウォッチの変更
    d = __fc_dbg["cur"]
    while True:
        s = js.__fc_dbg_poll()
        if not s:
            break
        cmd = json.loads(s)
        t = cmd.get("type")
        if d is None:
            # ブレークポイントなしで走っている途中: 必要になったらデバッガーを付ける
            if __fc_dbg["opt"] is None or not ((t == "debug" and cmd.get("action") == "pause") or (t == "breakpoints" and cmd.get("list"))):
                continue
            d = __fc_dbg_attach(frame)
        if t == "breakpoints":
            d.set_bps(cmd.get("list"))
            d.retrace(frame)
        elif t == "watches":
            d.watches = list(cmd.get("list") or [])
        elif t == "debug" and cmd.get("action") == "pause":
            d.reason = {"kind": "pause"}
            d.pause_now(frame)
`
function takeCmd() {
  const len = Atomics.load(shared.dctl, 1)
  const text = new TextDecoder().decode(shared.dbuf.slice(0, len))
  Atomics.store(shared.dctl, 0, 0)
  return text
}
self.__fc_dbg_post = text => { flush(true); post(JSON.parse(text)) }
self.__fc_dbg_wait = () => {
  flush(true)
  for (;;) {
    Atomics.wait(shared.dctl, 0, 0, 250)
    if (Atomics.load(shared.dctl, 0) === 1) return takeCmd()
    if (shared.interrupt[0] === 2) { shared.interrupt[0] = 0; return '{"type":"stop"}' }
  }
}
self.__fc_dbg_poll = () => (shared && Atomics.load(shared.dctl, 0) === 1 ? takeCmd() : '')

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
    py.globals.set('__fc_dbgopt', shared && m.debug ? JSON.stringify(m.debug) : null)
    py.runPython('import os; os.chdir(__fc_project)')
    // 共有メモリがない (画面を待てない) ときは、input() を分かるエラーにする
    py.runPython(shared ? 'builtins.input = __fc_builtin_input' : 'builtins.input = __fc_no_input')
    if (shared) { Atomics.store(shared.dctl, 0, 0) }
    const errJson = py.runPython('__fc_run(__fc_entry, __fc_src, __fc_dbgopt)')
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
    if (m.interrupt && m.ctl && m.buf && m.dctl && m.dbuf) shared = { interrupt: new Int32Array(m.interrupt), ctl: new Int32Array(m.ctl), buf: new Uint8Array(m.buf), dctl: new Int32Array(m.dctl), dbuf: new Uint8Array(m.dbuf) }
    ensure().catch(err => post({ type: 'status', state: 'error', text: 'Python を読み込めませんでした: ' + (err && err.message || err) }))
  } else if (m.type === 'run') run(m)
  else if (m.type === 'eval') evalCode(m)
}
