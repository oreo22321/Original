import{a as j,b as A,c as O,d as P,e as k}from"../chunks/chunk-BEPEHWSD.js";import{loadPyodide as J}from"../../vendor/pyodide/pyodide.mjs";var b="/home/pyodide/project",L="314.0.8",B=`https://cdn.jsdelivr.net/pyodide/v${L}/full/`,z="micropip-0.11.1-py3-none-any.whl",_=e=>self.postMessage(e),i=null,x=null,r=null,G=0,y=null,v=new Map,S=!1,W=e=>{let t=new URL(e,import.meta.url);return t.protocol==="file:"?decodeURIComponent(t.pathname):t.href},T=new Map,R=new Set,m=[],F=0,D=0,h=0,E=2e4,w={out:"",err:""},K={out:new TextDecoder,err:new TextDecoder};function p(e=!1){for(let t of["out","err"])w[t]&&(e||performance.now()-D>150)&&(M(t,w[t],!0),w[t]="");m.length&&(_({type:"output",items:m}),m=[]),F=performance.now()}function M(e,t,s=!1){if(h>=E){h===E&&(m.push({kind:"warn",text:`出力が ${E} 行を超えたため、以降は省略します`}),h++);return}h++,m.push({kind:e==="err"?"error-text":"",text:t,partial:s}),m.length>200&&p()}function C(e,t){let a=(w[e]+K[e].decode(t,{stream:!0})).split(`
`);w[e]=a.pop();for(let f of a)M(e,f);return D=performance.now(),m.length&&performance.now()-F>60&&(_({type:"output",items:m}),m=[],F=performance.now()),t.length}setInterval(()=>p(),80);async function I(){return i||(x||(x=(async()=>{_({type:"status",state:"loading",text:"Python を準備しています…"});let e=new URL("../../vendor/pyodide/",import.meta.url),t=e.protocol==="file:"?decodeURIComponent(e.pathname):e.href,s=await J({indexURL:t,lockFileURL:t+"pyodide-lock.json",packageBaseUrl:B,env:{HOME:"/home/pyodide",MPLBACKEND:"AGG",PYTHONUNBUFFERED:"1"}});s.setStdout({write:a=>C("out",a)}),s.setStderr({write:a=>C("err",a)}),s.setStdin({stdin:V,isatty:!0}),r&&s.setInterruptBuffer(r.interrupt),s.FS.mkdirTree(b);for(let[a,f]of Object.entries(A(O))){let o=j+"/"+a;s.FS.mkdirTree(o.slice(0,o.lastIndexOf("/"))),s.FS.writeFile(o,f)}return s.globals.set("__fc_dbg_src",Y),s.runPython(H),i=s,_({type:"status",state:"ready",text:`Python ${s.runPython("import sys; sys.version.split()[0]")}`}),s})().catch(e=>{throw x=null,e})),x)}function V(){if(p(!0),!r)throw new Error("この環境では input() を使えません。ページを再読み込みしてからもう一度試してください (初回は再読み込みが必要です)");for(Atomics.store(r.ctl,0,0),_({type:"input",password:S}),S=!1;;){let s=Atomics.wait(r.ctl,0,0,250);if(Atomics.load(r.ctl,0)!==0)break;if(s==="timed-out"&&r.interrupt[0]===2)return _({type:"inputDone"}),null}let e=Atomics.load(r.ctl,0),t=Atomics.load(r.ctl,1);return _({type:"inputDone"}),e===2?null:new TextDecoder().decode(r.buf.slice(0,t))+`
`}var H=`
import sys, os, traceback, builtins, json, base64, io
__fc_builtin_input = builtins.input
__fc_project = ${JSON.stringify(b)}
__fc_lib = ${JSON.stringify(j)}
if __fc_project not in sys.path:
    sys.path.insert(0, __fc_project)
if __fc_lib not in sys.path:
    sys.path.insert(1, __fc_lib)
import _forgecode

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
    # この道具自体の行 (とそのコード) は見せない
    out, skip = [], False
    for l in text.split("\\n"):
        if l.startswith('  File "'):
            skip = "<exec>" in l or "__fc_" in l or __fc_lib in l
            if skip:
                continue
        elif skip and l.startswith("    "):
            continue
        else:
            skip = False
        out.append(l)
    info["text"] = "\\n".join(out)
    return json.dumps(info)

def __fc_no_input(prompt=""):
    raise RuntimeError("この環境では input() を使えません。ページを再読み込みしてから、もう一度実行してください (はじめて開いたときは再読み込みが必要です)")

def __fc_show_figures():
    _forgecode.show_figures()

__fc_last = {"g": None, "err": None}
def __fc_run(path, src, dbg=None):
    g = {"__name__": "__main__", "__file__": __fc_project + "/" + path, "__builtins__": builtins}
    __fc_last["g"] = g
    __fc_last["err"] = None
    opt = json.loads(dbg) if dbg else None
    __fc_dbg["opt"] = opt
    d = None
    _forgecode.begin([path])
    try:
        code = compile(src, __fc_project + "/" + path, "exec")
        # ブレークポイントがあるときだけデバッガーを付けて実行 (ないときは breakpoint() / 一時停止で途中から付ける)
        if opt and opt.get("bps"):
            d = __fc_dbg_start(opt)
            d.run(code, g)
        else:
            exec(code, g)
    except BaseException as e:
        # turtle の画面を閉じた (bye) あとの Terminator は、ふつうの終わり
        if type(e).__name__ == "Terminator" and type(e).__module__ == "turtle":
            __fc_last["err"] = json.dumps({"type": "SystemExit", "message": "", "frames": [], "text": ""})
        else:
            __fc_last["err"] = __fc_error(e)
    finally:
        try:
            _forgecode.end()
        except BaseException:
            pass
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
    # 最後が式ならその値を返す。await もそのまま書ける (python -m asyncio と同じ)
    import ast, inspect
    flags = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT
    def run(c):
        r = eval(c, g, l)
        if c.co_flags & inspect.CO_COROUTINE:
            r = _forgecode.run_coro(r)
        return r
    try:
        tree = ast.parse(code, "<console>", "exec")
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body.pop().value)
        if tree.body:
            run(compile(tree, "<console>", "exec", flags=flags))
        if last is None:
            return {"ok": True, "value": None}
        v = run(compile(last, "<console>", "eval", flags=flags))
        if v is None:
            return {"ok": True, "value": None}
        mod = type(v).__module__ or ""
        if (mod.startswith("matplotlib") and hasattr(v, "savefig")) or (mod.startswith("PIL") and hasattr(v, "mode") and hasattr(v, "save")):
            _forgecode.display(v)
            return {"ok": True, "value": None}
        return {"ok": True, "value": repr(v), "html": _forgecode.rich(v)}
    except BaseException as e:
        info = json.loads(__fc_error(e))
        return {"ok": False, "type": info["type"], "error": info["text"].strip()}

def __fc_eval(code, g):
    _forgecode.begin()
    try:
        return json.dumps(__fc_eval_in(code, g))
    finally:
        _forgecode.end()

# ---- import しているライブラリ ----
def __fc_imports(files_json):
    # {"req": 必要なもの, "opt": try / except ImportError の中だけのもの} (トップの名前。プロジェクトのファイルは除く)
    import ast, re
    files = json.loads(files_json)
    local = set()
    for p in files:
        first = p.split("/")[0]
        local.add(first[:-3] if first.endswith(".py") else first)
    req, opt = set(), set()
    def catches_import(t):
        for h in t.handlers:
            if h.type is None:
                return True
            names = [h.type] if not isinstance(h.type, ast.Tuple) else h.type.elts
            for n in names:
                if isinstance(n, ast.Name) and n.id in ("ImportError", "ModuleNotFoundError", "Exception", "BaseException"):
                    return True
        return False
    def walk(node, optional):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.Import):
                for a in child.names:
                    (opt if optional else req).add(a.name.split(".")[0])
            elif isinstance(child, ast.ImportFrom):
                if child.level == 0 and child.module:
                    (opt if optional else req).add(child.module.split(".")[0])
            elif isinstance(child, ast.Try) or (hasattr(ast, "TryStar") and isinstance(child, ast.TryStar)):
                o = optional or catches_import(child)
                for st in child.body:
                    walk(ast.Module(body=[st], type_ignores=[]), o)
                for part in child.handlers + child.orelse + child.finalbody:
                    walk(ast.Module(body=[part] if not isinstance(part, ast.excepthandler) else part.body, type_ignores=[]), optional)
            elif isinstance(child, ast.If) and "TYPE_CHECKING" in ast.dump(child.test):
                continue
            else:
                walk(child, optional)
    for p, src in files.items():
        if not p.endswith(".py"):
            continue
        try:
            walk(ast.parse(src), False)
        except Exception:
            for m in re.finditer(r"^[ \\t]*(?:from[ \\t]+([A-Za-z_]\\w*)[\\w.]*[ \\t]+import\\b|import[ \\t]+([A-Za-z_]\\w*))", src, re.M):
                req.add(m.group(1) or m.group(2))
    opt -= req
    return json.dumps({"req": sorted(req - local), "opt": sorted(opt - local)})

def __fc_missing(names_json):
    # まだ使えない (入っていない) ライブラリ
    import importlib.util
    out = []
    for n in json.loads(names_json):
        if n in sys.stdlib_module_names or n in sys.builtin_module_names or n in sys.modules:
            continue
        try:
            if importlib.util.find_spec(n) is not None:
                continue
        except Exception:
            pass
        out.append(n)
    return json.dumps(out)

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
`;self.__fc_image=(e,t)=>{p(!0),_({type:"image",data:e,key:t||null})};self.__fc_svg=e=>{p(!0),_({type:"image",data:btoa(unescape(encodeURIComponent(String(e)))),mime:"image/svg+xml"})};self.__fc_html=(e,t)=>{p(!0),_({type:"html",html:String(e).slice(0,4e5),text:String(t||"")})};self.__fc_meta=e=>{p(!0),_({type:"output",items:[{kind:"meta",text:String(e)}]})};self.__fc_link=e=>{p(!0),_({type:"link",url:String(e)})};self.__fc_password=()=>{S=!0};self.__fc_turtle=e=>{p(!0),_({type:"turtle",ops:e})};self.__fc_sleep=e=>(p(!0),r?(Atomics.wait(r.interrupt,0,0,Math.max(0,e*1e3)),!0):!1);self.__fc_ev_ok=()=>!!(r&&r.ectl);self.__fc_ev_poll=()=>{if(!r||!r.ectl||Atomics.load(r.ectl,0)!==1)return"";let e=Atomics.load(r.ectl,1),t=new TextDecoder().decode(r.ebuf.slice(0,e));return Atomics.store(r.ectl,0,0),_({type:"evTaken"}),t};self.__fc_ev_wait=e=>(p(!0),!r||!r.ectl?!1:(r.interrupt[0]!==0||Atomics.wait(r.ectl,0,0,Math.max(1,e)),!0));var Y=`import bdb, reprlib, inspect, types, sys, json, js, re as _re

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
`;function U(){let e=Atomics.load(r.dctl,1),t=new TextDecoder().decode(r.dbuf.slice(0,e));return Atomics.store(r.dctl,0,0),t}self.__fc_dbg_post=e=>{p(!0),_(JSON.parse(e))};self.__fc_dbg_wait=()=>{for(p(!0);;){if(Atomics.wait(r.dctl,0,0,250),Atomics.load(r.dctl,0)===1)return U();if(r.interrupt[0]===2)return r.interrupt[0]=0,'{"type":"stop"}'}};self.__fc_dbg_poll=()=>r&&Atomics.load(r.dctl,0)===1?U():"";function Z(e){let t=i.FS;for(let s of v.keys())if(!(s in e))try{t.unlink(b+"/"+s)}catch{}v=new Map;for(let[s,a]of Object.entries(e)){let f=b+"/"+s;t.mkdirTree(f.slice(0,f.lastIndexOf("/"))),t.writeFile(f,a),v.set(s,a)}}function X(){let e=i.FS,t={},s=(a,f)=>{let o=[];try{o=e.readdir(a)}catch{return}for(let n of o){if(n==="."||n===".."||n==="__pycache__")continue;let l=a+"/"+n,d=f?f+"/"+n:n,c;try{c=e.stat(l)}catch{continue}if(e.isDir(c.mode))s(l,d);else if(c.size<2e6&&/\.(py|txt|csv|json|md|tsv|log|html|xml|ya?ml|ini|cfg|toml)$/i.test(n)){let g;try{g=e.readFile(l,{encoding:"utf8"})}catch{continue}v.get(d)!==g&&(t[d]=g)}}};s(b,"");for(let a of v.keys())try{e.stat(b+"/"+a)}catch{t[a]=null}return t}async function Q(e){let t=e.id;G=t,h=0;let s=performance.now();try{await I()}catch(c){p(!0),_({type:"done",id:t,ok:!1,reason:"load",error:"Python を読み込めませんでした: "+(c&&c.message||c)});return}r&&(r.interrupt[0]=0),Z(e.files||{});let a=e.files[e.entry]??"",f=Object.fromEntries(Object.entries(e.files).filter(([c])=>c.endsWith(".py")));await q(f,e.files["requirements.txt"]);let o=!0,n=null,l="done";try{i.globals.set("__fc_entry",e.entry),i.globals.set("__fc_src",a),i.globals.set("__fc_dbgopt",r&&e.debug?JSON.stringify(e.debug):null),i.runPython("import os; os.chdir(__fc_project)"),i.runPython(r?"builtins.input = __fc_builtin_input":"builtins.input = __fc_no_input"),r&&Atomics.store(r.dctl,0,0);let c=i.runPython("__fc_run(__fc_entry, __fc_src, __fc_dbgopt)");if(y)try{y.destroy()}catch{}y=i.runPython('__fc_last["g"]'),c&&(n=JSON.parse(c),n.type==="KeyboardInterrupt"?(l="stopped",n=null):n.type==="SystemExit"?(l="exit",n=null):(o=!1,l="error"));try{i.runPython("__fc_show_figures()")}catch{}}catch(c){o=!1,l="error",n={type:"Error",message:String(c&&c.message||c),text:String(c&&c.message||c),frames:[]}}p(!0);let d={};try{d=X()}catch{}_({type:"done",id:t,ok:o,reason:l,error:n,files:d,ms:Math.round(performance.now()-s)})}var u=(e,t)=>{p(!0),_({type:"output",items:[{kind:e,text:t}]})};async function q(e,t){let s={req:[],opt:[]};try{s=JSON.parse(i.globals.get("__fc_imports")(JSON.stringify(e)))}catch{}for(let n of s.req)k[n]&&u("warn",k[n]);let a=s.req.filter(n=>!k[n]);a.includes("zoneinfo")&&a.push("tzdata");try{let n=!1;await i.loadPackagesFromImports(a.map(l=>`import ${l}`).join(`
`),{messageCallback:l=>{/^Loading /.test(l)&&!n&&(n=!0,u("meta","ライブラリを読み込んでいます… (初回だけ時間がかかります)"))},errorCallback:l=>u("warn",l)})}catch(n){u("warn","ライブラリを読み込めませんでした (インターネットの接続を確認してください): "+(n&&n.message||n))}let f=[];for(let n of String(t||"").split(`
`)){let l=n.replace(/\s+#.*$|^#.*$/,"").trim();l&&!l.startsWith("-")&&!R.has(l)&&f.push(l)}let o=[];try{o=JSON.parse(i.globals.get("__fc_missing")(JSON.stringify(a)))}catch{}o=o.filter(n=>!T.has(n)),!(!f.length&&!o.length)&&await $([...f,...o.map(n=>P[n]||n)],{fromImports:o,reqs:f})}async function N(){if(!i.globals.get("__fc_has_micropip")){try{i.pyimport("micropip")}catch{await i.loadPackage(W("../../vendor/pywheels/"+z),{messageCallback:()=>{}})}i.pyimport("micropip"),i.globals.set("__fc_has_micropip",!0)}}async function $(e,{fromImports:t=[],reqs:s=[],quiet:a=!1}={}){if(!e.length)return[];a||u("meta",`PyPI からライブラリを入れています: ${e.join(", ")} …`);let f=[];try{await N(),i.globals.set("__fc_pip_names",i.toPy(e));let o=await i.runPythonAsync(`
import micropip, json
_r = []
for _n in __fc_pip_names:
    try:
        await micropip.install(_n)
        _r.append([_n, None])
    except Exception as _e:
        _r.append([_n, str(_e).split("\\n")[0][:300]])
json.dumps(_r)`);for(let[l,d]of JSON.parse(o)){let c=t.find(g=>(P[g]||g)===l);if(c&&T.set(c,d||"ok"),s.includes(l)&&!d&&R.add(l),d){f.push(l);let g=/Can't find a pure Python 3 wheel|No matching distribution|Can't fetch metadata|not found/i.test(d)?/pure Python/.test(d)?"ブラウザで動く形 (pure Python) が PyPI にないため":"PyPI に見つからないため":d;u("warn",`${l} を入れられませんでした (${g})`)}}let n=e.filter(l=>!f.includes(l));n.length&&!a&&u("meta",`入れました: ${n.join(", ")}`)}catch(o){for(let n of t)T.set(n,String(o&&o.message||o));return u("warn","PyPI からライブラリを入れられませんでした (インターネットの接続を確認してください): "+String(o&&o.message||o).split(`
`).slice(-1)[0]),e}return f}async function ee(e){let t=/^\s*[%!]?\s*(?:python3?\s+-m\s+)?pip3?\s+(\w+)\s*(.*)$/s.exec(e);if(!t)return null;let[,s,a]=t,f=a.split(/\s+/).filter(o=>o&&!o.startsWith("-"));if(s==="install"){if(!f.length)return{ok:!1,error:"入れるライブラリの名前を書いてください (例: pip install emoji)"};let o=await $(f);return o.length?{ok:!1,error:`入れられなかったもの: ${o.join(", ")}`}:{ok:!0,value:null}}if(s==="list"||s==="freeze"){await N();let o=await i.runPythonAsync(`import micropip
"\\n".join(sorted(f"{p.name}{'==' if ${s==="freeze"?"True":"False"} else ' '}{p.version}" for p in micropip.list().values()))`);return u("",String(o)),{ok:!0,value:null}}if(s==="uninstall")return await N(),i.globals.set("__fc_pip_names",i.toPy(f)),await i.runPythonAsync(`import micropip
micropip.uninstall(list(__fc_pip_names))`),u("meta",`外しました: ${f.join(", ")}`),{ok:!0,value:null};if(s==="show"){await N(),i.globals.set("__fc_pip_names",i.toPy(f));let o=await i.runPythonAsync(`import micropip
_l = micropip.list()
"\\n".join(f"Name: {_l[n].name}\\nVersion: {_l[n].version}\\nSource: {_l[n].source}" if n in _l else f"{n} は入っていません" for n in __fc_pip_names)`);return u("",String(o)),{ok:!0,value:null}}return{ok:!1,error:`pip ${s} はこの環境では使えません (install / list / show / uninstall が使えます)`}}async function te(e){try{await I()}catch(t){_({type:"evalResult",id:e.id,ok:!1,error:String(t.message||t)});return}r&&(r.interrupt[0]=0);try{let t=await ee(e.code).catch(a=>({ok:!1,error:String(a&&a.message||a).split(`
`).slice(-1)[0]}));if(t){_({type:"evalResult",id:e.id,...t});return}y||(y=i.runPython('{"__name__": "__main__", "__builtins__": __import__("builtins")}')),await q({"<console>.py":e.code}).catch(()=>{}),i.globals.set("__fc_g",y),i.globals.set("__fc_code",e.code);let s=JSON.parse(i.runPython("__fc_eval(__fc_code, __fc_g)"));p(!0);try{i.runPython("__fc_show_figures()")}catch{}s.ok?_({type:"evalResult",id:e.id,ok:!0,value:s.value,html:s.html||null}):_({type:"evalResult",id:e.id,ok:!1,error:s.type==="KeyboardInterrupt"?"停止しました":s.error})}catch(t){p(!0),_({type:"evalResult",id:e.id,ok:!1,error:String(t&&t.message||t)})}}self.onmessage=e=>{let t=e.data;t&&(t.type==="init"?(t.interrupt&&t.ctl&&t.buf&&t.dctl&&t.dbuf&&(r={interrupt:new Int32Array(t.interrupt),ctl:new Int32Array(t.ctl),buf:new Uint8Array(t.buf),dctl:new Int32Array(t.dctl),dbuf:new Uint8Array(t.dbuf)},t.ectl&&t.ebuf&&(r.ectl=new Int32Array(t.ectl),r.ebuf=new Uint8Array(t.ebuf))),I().catch(s=>_({type:"status",state:"error",text:"Python を読み込めませんでした: "+(s&&s.message||s)}))):t.type==="run"?Q(t):t.type==="eval"&&te(t))};
