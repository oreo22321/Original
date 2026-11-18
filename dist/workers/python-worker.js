import{loadPyodide as T}from"../../vendor/pyodide/pyodide.mjs";var b="/home/pyodide/project",S="314.0.8",R=`https://cdn.jsdelivr.net/pyodide/v${S}/full/`,a=t=>self.postMessage(t),o=null,x=null,r=null,I=0,g=null,h=new Map,d=[],w=0,E=0,y=0,k=2e4,v={out:"",err:""},A={out:new TextDecoder,err:new TextDecoder};function c(t=!1){for(let e of["out","err"])v[e]&&(t||performance.now()-E>150)&&(F(e,v[e],!0),v[e]="");d.length&&(a({type:"output",items:d}),d=[]),w=performance.now()}function F(t,e,s=!1){if(y>=k){y===k&&(d.push({kind:"warn",text:`出力が ${k} 行を超えたため、以降は省略します`}),y++);return}y++,d.push({kind:t==="err"?"error-text":"",text:e,partial:s}),d.length>200&&c()}function j(t,e){let f=(v[t]+A[t].decode(e,{stream:!0})).split(`
`);v[t]=f.pop();for(let l of f)F(t,l);return E=performance.now(),d.length&&performance.now()-w>60&&(a({type:"output",items:d}),d=[],w=performance.now()),e.length}setInterval(()=>c(),80);async function N(){return o||(x||(x=(async()=>{a({type:"status",state:"loading",text:"Python を準備しています…"});let t=new URL("../../vendor/pyodide/",import.meta.url),e=t.protocol==="file:"?decodeURIComponent(t.pathname):t.href,s=await T({indexURL:e,lockFileURL:e+"pyodide-lock.json",packageBaseUrl:R,env:{HOME:"/home/pyodide",MPLBACKEND:"AGG",PYTHONUNBUFFERED:"1"}});return s.setStdout({write:f=>j("out",f)}),s.setStderr({write:f=>j("err",f)}),s.setStdin({stdin:D,isatty:!0}),r&&s.setInterruptBuffer(r.interrupt),s.FS.mkdirTree(b),s.globals.set("__fc_dbg_src",C),s.runPython(O),o=s,a({type:"status",state:"ready",text:`Python ${s.runPython("import sys; sys.version.split()[0]")}`}),s})().catch(t=>{throw x=null,t})),x)}function D(){if(c(!0),!r)throw new Error("この環境では input() を使えません。ページを再読み込みしてからもう一度試してください (初回は再読み込みが必要です)");for(Atomics.store(r.ctl,0,0),a({type:"input"});;){let s=Atomics.wait(r.ctl,0,0,250);if(Atomics.load(r.ctl,0)!==0)break;if(s==="timed-out"&&r.interrupt[0]===2)return a({type:"inputDone"}),null}let t=Atomics.load(r.ctl,0),e=Atomics.load(r.ctl,1);return a({type:"inputDone"}),t===2?null:new TextDecoder().decode(r.buf.slice(0,e))+`
`}var O=`
import sys, os, traceback, builtins, json, base64, io
__fc_builtin_input = builtins.input
__fc_project = ${JSON.stringify(b)}
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
`;self.__fc_image=t=>{c(!0),a({type:"image",data:t})};var C=`import bdb, reprlib, inspect, types, sys, json, js, re as _re

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
`;function P(){let t=Atomics.load(r.dctl,1),e=new TextDecoder().decode(r.dbuf.slice(0,t));return Atomics.store(r.dctl,0,0),e}self.__fc_dbg_post=t=>{c(!0),a(JSON.parse(t))};self.__fc_dbg_wait=()=>{for(c(!0);;){if(Atomics.wait(r.dctl,0,0,250),Atomics.load(r.dctl,0)===1)return P();if(r.interrupt[0]===2)return r.interrupt[0]=0,'{"type":"stop"}'}};self.__fc_dbg_poll=()=>r&&Atomics.load(r.dctl,0)===1?P():"";function U(t){let e=o.FS;for(let s of h.keys())if(!(s in t))try{e.unlink(b+"/"+s)}catch{}h=new Map;for(let[s,f]of Object.entries(t)){let l=b+"/"+s;e.mkdirTree(l.slice(0,l.lastIndexOf("/"))),e.writeFile(l,f),h.set(s,f)}}function B(){let t=o.FS,e={},s=(f,l)=>{let p=[];try{p=t.readdir(f)}catch{return}for(let i of p){if(i==="."||i===".."||i==="__pycache__")continue;let u=f+"/"+i,n=l?l+"/"+i:i,m;try{m=t.stat(u)}catch{continue}if(t.isDir(m.mode))s(u,n);else if(m.size<2e6&&/\.(py|txt|csv|json|md|tsv|log|html|xml|ya?ml|ini|cfg|toml)$/i.test(i)){let _;try{_=t.readFile(u,{encoding:"utf8"})}catch{continue}h.get(n)!==_&&(e[n]=_)}}};s(b,"");for(let f of h.keys())try{t.stat(b+"/"+f)}catch{e[f]=null}return e}async function J(t){let e=t.id;I=e,y=0;let s=performance.now();try{await N()}catch(n){c(!0),a({type:"done",id:e,ok:!1,reason:"load",error:"Python を読み込めませんでした: "+(n&&n.message||n)});return}r&&(r.interrupt[0]=0),U(t.files||{});let f=t.files[t.entry]??"";try{let n=Object.entries(t.files).filter(([_])=>_.endsWith(".py")).map(([,_])=>_).join(`
`),m=!1;await o.loadPackagesFromImports(n,{messageCallback:_=>{/^Loading /.test(_)&&!m&&(m=!0,c(!0),a({type:"output",items:[{kind:"meta",text:"ライブラリを読み込んでいます… (初回だけ時間がかかります)"}]}))},errorCallback:_=>a({type:"output",items:[{kind:"warn",text:_}]})}),/\bmatplotlib\b/.test(n)&&o.runPython("__fc_prepare_matplotlib()")}catch(n){a({type:"output",items:[{kind:"warn",text:"ライブラリを読み込めませんでした (インターネットの接続を確認してください): "+(n&&n.message||n)}]})}let l=!0,p=null,i="done";try{o.globals.set("__fc_entry",t.entry),o.globals.set("__fc_src",f),o.globals.set("__fc_dbgopt",r&&t.debug?JSON.stringify(t.debug):null),o.runPython("import os; os.chdir(__fc_project)"),o.runPython(r?"builtins.input = __fc_builtin_input":"builtins.input = __fc_no_input"),r&&Atomics.store(r.dctl,0,0);let n=o.runPython("__fc_run(__fc_entry, __fc_src, __fc_dbgopt)");if(g)try{g.destroy()}catch{}g=o.runPython('__fc_last["g"]'),n&&(p=JSON.parse(n),p.type==="KeyboardInterrupt"?(i="stopped",p=null):p.type==="SystemExit"?(i="exit",p=null):(l=!1,i="error"));try{o.runPython("__fc_show_figures()")}catch{}}catch(n){l=!1,i="error",p={type:"Error",message:String(n&&n.message||n),text:String(n&&n.message||n),frames:[]}}c(!0);let u={};try{u=B()}catch{}a({type:"done",id:e,ok:l,reason:i,error:p,files:u,ms:Math.round(performance.now()-s)})}async function G(t){try{await N()}catch(e){a({type:"evalResult",id:t.id,ok:!1,error:String(e.message||e)});return}r&&(r.interrupt[0]=0);try{g||(g=o.runPython('{"__name__": "__main__", "__builtins__": __import__("builtins")}')),await o.loadPackagesFromImports(t.code).catch(()=>{}),o.globals.set("__fc_g",g),o.globals.set("__fc_code",t.code);let e=JSON.parse(o.runPython("__fc_eval(__fc_code, __fc_g)"));c(!0);try{o.runPython("__fc_show_figures()")}catch{}e.ok?a({type:"evalResult",id:t.id,ok:!0,value:e.value}):a({type:"evalResult",id:t.id,ok:!1,error:e.type==="KeyboardInterrupt"?"停止しました":e.error})}catch(e){c(!0),a({type:"evalResult",id:t.id,ok:!1,error:String(e&&e.message||e)})}}self.onmessage=t=>{let e=t.data;e&&(e.type==="init"?(e.interrupt&&e.ctl&&e.buf&&e.dctl&&e.dbuf&&(r={interrupt:new Int32Array(e.interrupt),ctl:new Int32Array(e.ctl),buf:new Uint8Array(e.buf),dctl:new Int32Array(e.dctl),dbuf:new Uint8Array(e.dbuf)}),N().catch(s=>a({type:"status",state:"error",text:"Python を読み込めませんでした: "+(s&&s.message||s)}))):e.type==="run"?J(e):e.type==="eval"&&G(e))};
