import{a as L,b as Z,c as Q,d as z,e as B}from"../chunks/chunk-GS7GOFRA.js";import{loadPyodide as ce}from"../../vendor/pyodide/pyodide.mjs";function X(r){let e=new Map,a=new Map,c=1,h=typeof OffscreenCanvas=="function"?OffscreenCanvas:null,o=(s,n)=>{if(!h)throw new Error("この端末のブラウザでは pygame の画面を作れません (OffscreenCanvas に対応していません)");return new h(Math.max(1,s|0),Math.max(1,n|0))},f=(s,n,t)=>{let i=s.getContext("2d",{willReadFrequently:!1});i.imageSmoothingEnabled=!1;let u=c++;return e.set(u,{c:s,x:i,v:0,clip:null,w:n,h:t}),u};r.__fc_pg_new=(s,n,t)=>{let i=o(s,n),u=f(i,s|0,n|0);if(!t){let _=e.get(u);_.x.fillStyle="#000",_.x.fillRect(0,0,i.width,i.height)}return u},r.__fc_pg_adopt=s=>f(s,s.width,s.height),r.__fc_pg_size=s=>{let n=e.get(s);return n?[n.w,n.h]:[0,0]},r.__fc_pg_count=()=>e.size,r.__fc_pg_reset=()=>{e.clear(),a.clear()};let p=(s,n)=>{if(!s.clip){n();return}s.x.save(),s.x.beginPath(),s.x.rect(s.clip[0],s.clip[1],s.clip[2],s.clip[3]),s.x.clip();try{n()}finally{s.x.restore()}},x={1:"lighter",2:"difference",3:"multiply",4:"darken",5:"lighten",6:"lighter",7:"difference",8:"multiply",9:"darken",10:"lighten"};function v(s,n,t){let i=t.join(","),u=a.get(s);if(u&&u.v===n.v&&u.key===i)return u.c;let _=o(n.c.width,n.c.height),m=_.getContext("2d"),d=n.x.getImageData(0,0,n.c.width,n.c.height),g=d.data,[k,N,P]=t;for(let I=0;I<g.length;I+=4)g[I]===k&&g[I+1]===N&&g[I+2]===P&&(g[I+3]=0);return m.putImageData(d,0,0),a.set(s,{v:n.v,key:i,c:_}),_}function S(s){let n=e.get(s[1]);if(!n)return;let t=n.x;switch(s[0]){case"fill":{let[,,i,u,_,m]=s,d=u||[0,0,n.w,n.h];p(n,()=>{m&&x[m]?(t.save(),t.globalCompositeOperation=x[m],t.fillStyle=i,t.fillRect(d[0],d[1],d[2],d[3]),t.restore()):(_&&t.clearRect(d[0],d[1],d[2],d[3]),t.fillStyle=i,t.fillRect(d[0],d[1],d[2],d[3]))});break}case"rect":{let[,,i,u,_,m,d,g,k]=s;p(n,()=>{let N=k&&k.some(P=>P>0);g>0?(t.strokeStyle=i,t.lineWidth=g,N&&t.roundRect?(t.beginPath(),t.roundRect(u+g/2,_+g/2,Math.max(0,m-g),Math.max(0,d-g),[k[0],k[1],k[3],k[2]].map(P=>Math.max(0,P-g/2))),t.stroke()):t.strokeRect(u+g/2,_+g/2,Math.max(0,m-g),Math.max(0,d-g))):(t.fillStyle=i,N&&t.roundRect?(t.beginPath(),t.roundRect(u,_,m,d,[k[0],k[1],k[3],k[2]].map(P=>Math.max(0,P))),t.fill()):t.fillRect(u,_,m,d))});break}case"circle":{let[,,i,u,_,m,d]=s;p(n,()=>{t.beginPath(),d>0?(t.arc(u,_,Math.max(0,m-d/2),0,Math.PI*2),t.strokeStyle=i,t.lineWidth=d,t.stroke()):(t.arc(u,_,Math.max(0,m),0,Math.PI*2),t.fillStyle=i,t.fill())});break}case"ellipse":{let[,,i,u,_,m,d,g]=s;p(n,()=>{t.beginPath();let k=g>0?g/2:0;t.ellipse(u+m/2,_+d/2,Math.max(0,m/2-k),Math.max(0,d/2-k),0,0,Math.PI*2),g>0?(t.strokeStyle=i,t.lineWidth=g,t.stroke()):(t.fillStyle=i,t.fill())});break}case"arc":{let[,,i,u,_,m,d,g,k,N]=s;p(n,()=>{t.beginPath();let P=Math.max(1,N);t.ellipse(u+m/2,_+d/2,Math.max(0,m/2-P/2),Math.max(0,d/2-P/2),0,-g,-k,!0),t.strokeStyle=i,t.lineWidth=P,t.stroke()});break}case"line":{let[,,i,u,_,m,d,g]=s;p(n,()=>{t.beginPath(),t.moveTo(u+.5,_+.5),t.lineTo(m+.5,d+.5),t.strokeStyle=i,t.lineWidth=Math.max(1,g),t.lineCap=g>2?"butt":"square",t.stroke()});break}case"lines":case"poly":{let i=s[2],u=s[0]==="poly"?!0:s[3],_=s[0]==="poly"?s[3]:s[4],m=s[0]==="poly"?s[4]:s[5];if(_.length<4)break;p(n,()=>{t.beginPath();let d=s[0]==="poly"&&!(m>0)?0:.5;for(let g=0;g<_.length;g+=2)g?t.lineTo(_[g]+d,_[g+1]+d):t.moveTo(_[g]+d,_[g+1]+d);u&&t.closePath(),s[0]==="poly"&&!(m>0)?(t.fillStyle=i,t.fill()):(t.strokeStyle=i,t.lineWidth=Math.max(1,m),t.lineJoin="miter",t.stroke())});break}case"blit":{let[,,i,u,_,m,d,g,k,N,P,I]=s,$=e.get(i);if(!$||g<=0||k<=0)break;let fe=P?v(i,$,P):$.c;p(n,()=>{let Y=N>=0&&N<255||I&&x[I];Y&&(t.save(),N>=0&&N<255&&(t.globalAlpha=N/255),I&&x[I]&&(t.globalCompositeOperation=x[I])),t.drawImage(fe,m,d,g,k,u,_,g,k),Y&&t.restore()});break}case"text":{let[,,i,u,_,m,d,g,k]=s;if(g&&(t.fillStyle=g,t.fillRect(0,0,n.w,n.h)),t.font=i,t.textBaseline="alphabetic",t.fillStyle=d,t.fillText(u,_,m),k){let N=t.measureText(u);t.fillRect(_,m+2,N.width,Math.max(1,Math.round(n.h/18)))}break}case"pix":{t.save(),t.clearRect(s[2],s[3],1,1),t.fillStyle=s[4],t.fillRect(s[2],s[3],1,1),t.restore();break}case"clip":n.clip=s[2]||null;return;case"copy":{let i=e.get(s[2]);i&&(t.clearRect(0,0,n.w,n.h),t.drawImage(i.c,0,0));break}case"scale":{let i=e.get(s[2]);if(!i)break;t.save(),t.imageSmoothingEnabled=!!s[3],s[3]&&(t.imageSmoothingQuality="high"),t.clearRect(0,0,n.w,n.h),t.drawImage(i.c,0,0,i.w,i.h,0,0,n.w,n.h),t.restore();break}case"rot":{let i=e.get(s[2]);if(!i)break;t.save(),t.imageSmoothingEnabled=!!s[5],t.clearRect(0,0,n.w,n.h),t.translate(n.w/2,n.h/2),t.rotate(-s[3]*Math.PI/180),t.scale(s[4],s[4]),t.drawImage(i.c,-i.w/2,-i.h/2),t.restore();break}case"flip":{let i=e.get(s[2]);if(!i)break;t.save(),t.clearRect(0,0,n.w,n.h),t.translate(s[3]?n.w:0,s[4]?n.h:0),t.scale(s[3]?-1:1,s[4]?-1:1),t.drawImage(i.c,0,0),t.restore();break}case"scroll":{let i=o(n.w,n.h);i.getContext("2d").drawImage(n.c,0,0),t.drawImage(i,s[2],s[3]);break}case"gray":{let i=e.get(s[2]);if(!i)break;let u=i.x.getImageData(0,0,i.w||1,i.h||1),_=u.data;for(let m=0;m<_.length;m+=4){let d=Math.round(.299*_[m]+.587*_[m+1]+.114*_[m+2]);_[m]=_[m+1]=_[m+2]=d}t.putImageData(u,0,0);break}case"free":e.delete(s[1]),a.delete(s[1]);return}n.v++}r.__fc_pg_exec=s=>{let n=JSON.parse(s);for(let t of n)try{S(t)}catch{}},r.__fc_pg_pixels=(s,n,t,i,u)=>{let _=e.get(s);return!_||i<=0||u<=0?new Uint8Array(0):new Uint8Array(_.x.getImageData(n,t,i,u).data.buffer)},r.__fc_pg_put=(s,n,t,i,u,_)=>{let m=e.get(s);if(!m)return;let d=n instanceof Uint8ClampedArray?n:new Uint8ClampedArray(n.buffer?n.buffer.slice(n.byteOffset,n.byteOffset+n.byteLength):n);m.x.putImageData(new ImageData(d,u,_),t,i),m.v++};let J=h?new h(1,1).getContext("2d"):null;r.__fc_pg_measure=(s,n)=>{if(!J)return[n.length*8,12,4];J.font=s;let t=J.measureText(n),i=t.fontBoundingBoxAscent!==void 0?t.fontBoundingBoxAscent:t.actualBoundingBoxAscent,u=t.fontBoundingBoxDescent!==void 0?t.fontBoundingBoxDescent:t.actualBoundingBoxDescent;return[t.width,i||0,u||0]},r.__fc_pg_font=(s,n)=>{try{if(typeof FontFace!="function"||!r.fonts)return!1;let t=n instanceof Uint8Array?n.slice():new Uint8Array(n),i=new FontFace(s,t.buffer);return r.fonts.add(i),i.load().catch(()=>{}),!0}catch{return!1}},r.__fc_pg_present=(s,n,t)=>{let i=e.get(s);i&&r.__fc_present(n,i.c,t)}}var C="/home/pyodide/project",_e="314.0.8",pe=`https://cdn.jsdelivr.net/pyodide/v${_e}/full/`,de="micropip-0.11.1-py3-none-any.whl",b=(r,e)=>e?self.postMessage(r,e):self.postMessage(r),y=null,U=null,l=null,ue=0,T=null,R=new Map,G=!1,me=r=>{let e=new URL(r,import.meta.url);return e.protocol==="file:"?decodeURIComponent(e.pathname):e.href},K=new Map,re=new Set,E=[],H=0,se=0,F=0,W=2e4,O={out:"",err:""},ge={out:new TextDecoder,err:new TextDecoder};function w(r=!1){for(let e of["out","err"])O[e]&&(r||performance.now()-se>150)&&(ne(e,O[e],!0),O[e]="");E.length&&(b({type:"output",items:E}),E=[]),H=performance.now()}function ne(r,e,a=!1){if(F>=W){F===W&&(E.push({kind:"warn",text:`出力が ${W} 行を超えたため、以降は省略します`}),F++);return}F++,E.push({kind:r==="err"?"error-text":"",text:e,partial:a}),E.length>200&&w()}function ee(r,e){let c=(O[r]+ge[r].decode(e,{stream:!0})).split(`
`);O[r]=c.pop();for(let h of c)ne(r,h);return se=performance.now(),E.length&&performance.now()-H>60&&(b({type:"output",items:E}),E=[],H=performance.now()),e.length}setInterval(()=>w(),80);async function V(){return y||(U||(U=(async()=>{b({type:"status",state:"loading",text:"Python を準備しています…"});let r=new URL("../../vendor/pyodide/",import.meta.url),e=r.protocol==="file:"?decodeURIComponent(r.pathname):r.href,a=await ce({indexURL:e,lockFileURL:e+"pyodide-lock.json",packageBaseUrl:pe,env:{HOME:"/home/pyodide",MPLBACKEND:"AGG",PYTHONUNBUFFERED:"1"}});a.setStdout({write:c=>ee("out",c)}),a.setStderr({write:c=>ee("err",c)}),a.setStdin({stdin:he,isatty:!0}),l&&a.setInterruptBuffer(l.interrupt),a.FS.mkdirTree(C);for(let[c,h]of Object.entries(Q())){let o=L+"/"+c;a.FS.mkdirTree(o.slice(0,o.lastIndexOf("/"))),a.FS.writeFile(o,h)}return a.globals.set("__fc_dbg_src",be),a.runPython(ye),y=a,b({type:"status",state:"ready",text:`Python ${a.runPython("import sys; sys.version.split()[0]")}`}),a})().catch(r=>{throw U=null,r})),U)}function he(){if(w(!0),!l)throw new Error("この環境では input() を使えません。ページを再読み込みしてからもう一度試してください (初回は再読み込みが必要です)");for(Atomics.store(l.ctl,0,0),b({type:"input",password:G}),G=!1;;){let a=Atomics.wait(l.ctl,0,0,250);if(Atomics.load(l.ctl,0)!==0)break;if(a==="timed-out"&&l.interrupt[0]===2)return b({type:"inputDone"}),null}let r=Atomics.load(l.ctl,0),e=Atomics.load(l.ctl,1);return b({type:"inputDone"}),r===2?null:new TextDecoder().decode(l.buf.slice(0,e))+`
`}var ye=`
import sys, os, traceback, builtins, json, base64, io
__fc_builtin_input = builtins.input
__fc_project = ${JSON.stringify(C)}
__fc_lib = ${JSON.stringify(L)}
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
`;self.__fc_image=(r,e)=>{w(!0),b({type:"image",data:r,key:e||null})};self.__fc_svg=r=>{w(!0),b({type:"image",data:btoa(unescape(encodeURIComponent(String(r)))),mime:"image/svg+xml"})};self.__fc_html=(r,e)=>{w(!0),b({type:"html",html:String(r).slice(0,4e5),text:String(e||"")})};self.__fc_meta=r=>{w(!0),b({type:"output",items:[{kind:"meta",text:String(r)}]})};self.__fc_link=r=>{w(!0),b({type:"link",url:String(r)})};self.__fc_password=()=>{G=!0};self.__fc_turtle=r=>{w(!0),b({type:"turtle",ops:r})};self.__fc_sleep=r=>(w(!0),l?(Atomics.wait(l.interrupt,0,0,Math.max(0,r*1e3)),!0):!1);self.__fc_ev_ok=()=>!!(l&&l.ectl);self.__fc_ev_poll=()=>{if(!l||!l.ectl||Atomics.load(l.ectl,0)!==1)return"";let r=Atomics.load(l.ectl,1),e=new TextDecoder().decode(l.ebuf.slice(0,r));return Atomics.store(l.ectl,0,0),b({type:"evTaken"}),e};var D=0;function ae(){if(!l||!l.fack)return;let r=performance.now();for(;;){let e=Atomics.load(l.fack,0);if(D-e<=2||l.interrupt[0]!==0||performance.now()-r>150)return;Atomics.wait(l.fack,0,e,20)}}self.__fc_frame=(r,e,a,c,h,o)=>{w(!0);let f,p=c.getBuffer("u8");try{f=new Uint8ClampedArray(p.data)}finally{p.release()}D++,b({type:"frame",key:String(r),w:e,h:a,data:f,scale:Number(h)||1,title:String(o||""),seq:D},[f.buffer]),ae()};var te=new Map;self.__fc_present=(r,e,a)=>{w(!0);let c=e.width,h=e.height,o=te.get(r);(!o||o.width!==c||o.height!==h)&&(o=new OffscreenCanvas(c,h),te.set(r,o)),o.getContext("2d").drawImage(e,0,0);let p=o.transferToImageBitmap();D++,b({type:"frame",key:String(r),w:c,h,bitmap:p,scale:1,title:String(a||""),seq:D,kind:"pg"},[p]),ae()};self.__fc_surface=r=>{w(!0),b({type:"surface",...JSON.parse(r)})};self.__fc_tk=r=>{w(!0),b({type:"tk",ops:r})};self.__fc_sound=(r,e)=>{let a=JSON.parse(r),c=null;e&&(c=e instanceof Uint8Array?e.slice():null),b({type:"sound",...a,data:c},c?[c.buffer]:void 0)};var j=null,M=null;self.__fc_rpc=(r,e,a)=>{if(w(!0),!l)throw new Error("この機能を使うには、ページを再読み込みしてください (はじめて開いたときは再読み込みが必要です)");j||(j=new Int32Array(new SharedArrayBuffer(16)));let c=1<<20;for(let h=0;h<3;h++){(!M||M.length<c)&&(M=new Uint8Array(new SharedArrayBuffer(c))),Atomics.store(j,0,0);let o=a?a.slice?a.slice():a:null;for(b({type:"rpc",op:String(r),args:JSON.parse(e||"{}"),data:o,ctl:j.buffer,buf:M.buffer});Atomics.wait(j,0,0,250),Atomics.load(j,0)===0;)if(l.interrupt[0]===2)return null;let f=Atomics.load(j,0),p=Atomics.load(j,1);if(f===3){c=p;continue}let x=M.slice(0,p);if(f===2)throw new Error(new TextDecoder().decode(x)||r+" に失敗しました");return{w:Atomics.load(j,2),h:Atomics.load(j,3),bytes:x,text:()=>new TextDecoder().decode(x)}}throw new Error(r+" の結果が大きすぎます")};self.__fc_image_canvas=r=>{let e=self.__fc_rpc("decode","{}",r);if(!e)return null;let a=new OffscreenCanvas(Math.max(1,e.w),Math.max(1,e.h));return a.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(e.bytes.buffer,0,e.w*e.h*4),e.w,e.h),0,0),a};self.__fc_ev_wait=r=>(w(!0),!l||!l.ectl?!1:(l.interrupt[0]!==0||Atomics.wait(l.ectl,0,0,Math.max(1,r)),!0));X(self);var be=`import bdb, reprlib, inspect, types, sys, json, js, re as _re

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
`;function ie(){let r=Atomics.load(l.dctl,1),e=new TextDecoder().decode(l.dbuf.slice(0,r));return Atomics.store(l.dctl,0,0),e}self.__fc_dbg_post=r=>{w(!0),b(JSON.parse(r))};self.__fc_dbg_wait=()=>{for(w(!0);;){if(Atomics.wait(l.dctl,0,0,250),Atomics.load(l.dctl,0)===1)return ie();if(l.interrupt[0]===2)return l.interrupt[0]=0,'{"type":"stop"}'}};self.__fc_dbg_poll=()=>l&&Atomics.load(l.dctl,0)===1?ie():"";function we(r){let e=y.FS;for(let a of R.keys())if(!(a in r))try{e.unlink(C+"/"+a)}catch{}R=new Map;for(let[a,c]of Object.entries(r)){let h=C+"/"+a;e.mkdirTree(h.slice(0,h.lastIndexOf("/"))),e.writeFile(h,c),R.set(a,c)}}function xe(){let r=y.FS,e={},a=(c,h)=>{let o=[];try{o=r.readdir(c)}catch{return}for(let f of o){if(f==="."||f===".."||f==="__pycache__")continue;let p=c+"/"+f,x=h?h+"/"+f:f,v;try{v=r.stat(p)}catch{continue}if(r.isDir(v.mode))a(p,x);else if(v.size<2e6&&/\.(py|txt|csv|json|md|tsv|log|html|xml|ya?ml|ini|cfg|toml)$/i.test(f)){let S;try{S=r.readFile(p,{encoding:"utf8"})}catch{continue}R.get(x)!==S&&(e[x]=S)}}};a(C,"");for(let c of R.keys())try{r.stat(C+"/"+c)}catch{e[c]=null}return e}async function ke(r){let e=r.id;ue=e,F=0;let a=performance.now();try{await V()}catch(v){w(!0),b({type:"done",id:e,ok:!1,reason:"load",error:"Python を読み込めませんでした: "+(v&&v.message||v)});return}l&&(l.interrupt[0]=0),we(r.files||{});let c=r.files[r.entry]??"",h=Object.fromEntries(Object.entries(r.files).filter(([v])=>v.endsWith(".py")));await oe(h,r.files["requirements.txt"]);let o=!0,f=null,p="done";try{y.globals.set("__fc_entry",r.entry),y.globals.set("__fc_src",c),y.globals.set("__fc_dbgopt",l&&r.debug?JSON.stringify(r.debug):null),y.runPython("import os; os.chdir(__fc_project)"),y.runPython(l?"builtins.input = __fc_builtin_input":"builtins.input = __fc_no_input"),l&&Atomics.store(l.dctl,0,0);let v=y.runPython("__fc_run(__fc_entry, __fc_src, __fc_dbgopt)");if(T)try{T.destroy()}catch{}T=y.runPython('__fc_last["g"]'),v&&(f=JSON.parse(v),f.type==="KeyboardInterrupt"?(p="stopped",f=null):f.type==="SystemExit"?(p="exit",f=null):(o=!1,p="error"));try{y.runPython("__fc_show_figures()")}catch{}}catch(v){o=!1,p="error";let S=String(v&&v.message||v);if(/fatal error|Aborted\(|out of memory|memory access out of bounds/i.test(S)){w(!0),b({type:"done",id:e,ok:!1,reason:"error",fatal:!0,error:{type:"MemoryError",message:"Python が止まりました (メモリが足りなくなった可能性があります)。Python を立ち上げ直します",text:S,frames:[]},files:{},ms:Math.round(performance.now()-a)});return}f={type:"Error",message:S,text:S,frames:[]}}w(!0);let x={};try{x=xe()}catch{}b({type:"done",id:e,ok:o,reason:p,error:f,files:x,ms:Math.round(performance.now()-a)})}var A=(r,e)=>{w(!0),b({type:"output",items:[{kind:r,text:e}]})};async function oe(r,e){let a={req:[],opt:[]};try{a=JSON.parse(y.globals.get("__fc_imports")(JSON.stringify(r)))}catch{}for(let f of a.req)B[f]&&A("warn",B[f]);let c=a.req.filter(f=>!B[f]&&!Z.has(f));c.includes("zoneinfo")&&c.push("tzdata");try{let f=!1;await y.loadPackagesFromImports(c.map(p=>`import ${p}`).join(`
`),{messageCallback:p=>{/^Loading /.test(p)&&!f&&(f=!0,A("meta","ライブラリを読み込んでいます… (初回だけ時間がかかります)"))},errorCallback:p=>A("warn",p)})}catch(f){A("warn","ライブラリを読み込めませんでした (インターネットの接続を確認してください): "+(f&&f.message||f))}let h=[];for(let f of String(e||"").split(`
`)){let p=f.replace(/\s+#.*$|^#.*$/,"").trim();p&&!p.startsWith("-")&&!re.has(p)&&h.push(p)}let o=[];try{o=JSON.parse(y.globals.get("__fc_missing")(JSON.stringify(c)))}catch{}o=o.filter(f=>!K.has(f)),!(!h.length&&!o.length)&&await le([...h,...o.map(f=>z[f]||f)],{fromImports:o,reqs:h})}async function q(){if(!y.globals.get("__fc_has_micropip")){try{y.pyimport("micropip")}catch{await y.loadPackage(me("../../vendor/pywheels/"+de),{messageCallback:()=>{}})}y.pyimport("micropip"),y.globals.set("__fc_has_micropip",!0)}}async function le(r,{fromImports:e=[],reqs:a=[],quiet:c=!1}={}){if(!r.length)return[];c||A("meta",`PyPI からライブラリを入れています: ${r.join(", ")} …`);let h=[];try{await q(),y.globals.set("__fc_pip_names",y.toPy(r));let o=await y.runPythonAsync(`
import micropip, json
_r = []
for _n in __fc_pip_names:
    try:
        await micropip.install(_n)
        _r.append([_n, None])
    except Exception as _e:
        _r.append([_n, str(_e).split("\\n")[0][:300]])
json.dumps(_r)`);for(let[p,x]of JSON.parse(o)){let v=e.find(S=>(z[S]||S)===p);if(v&&K.set(v,x||"ok"),a.includes(p)&&!x&&re.add(p),x){h.push(p);let S=/Can't find a pure Python 3 wheel|No matching distribution|Can't fetch metadata|not found/i.test(x)?/pure Python/.test(x)?"ブラウザで動く形 (pure Python) が PyPI にないため":"PyPI に見つからないため":x;A("warn",`${p} を入れられませんでした (${S})`)}}let f=r.filter(p=>!h.includes(p));f.length&&!c&&A("meta",`入れました: ${f.join(", ")}`)}catch(o){for(let f of e)K.set(f,String(o&&o.message||o));return A("warn","PyPI からライブラリを入れられませんでした (インターネットの接続を確認してください): "+String(o&&o.message||o).split(`
`).slice(-1)[0]),r}return h}async function ve(r){let e=/^\s*[%!]?\s*(?:python3?\s+-m\s+)?pip3?\s+(\w+)\s*(.*)$/s.exec(r);if(!e)return null;let[,a,c]=e,h=c.split(/\s+/).filter(o=>o&&!o.startsWith("-"));if(a==="install"){if(!h.length)return{ok:!1,error:"入れるライブラリの名前を書いてください (例: pip install emoji)"};let o=await le(h);return o.length?{ok:!1,error:`入れられなかったもの: ${o.join(", ")}`}:{ok:!0,value:null}}if(a==="list"||a==="freeze"){await q();let o=await y.runPythonAsync(`import micropip
"\\n".join(sorted(f"{p.name}{'==' if ${a==="freeze"?"True":"False"} else ' '}{p.version}" for p in micropip.list().values()))`);return A("",String(o)),{ok:!0,value:null}}if(a==="uninstall")return await q(),y.globals.set("__fc_pip_names",y.toPy(h)),await y.runPythonAsync(`import micropip
micropip.uninstall(list(__fc_pip_names))`),A("meta",`外しました: ${h.join(", ")}`),{ok:!0,value:null};if(a==="show"){await q(),y.globals.set("__fc_pip_names",y.toPy(h));let o=await y.runPythonAsync(`import micropip
_l = micropip.list()
"\\n".join(f"Name: {_l[n].name}\\nVersion: {_l[n].version}\\nSource: {_l[n].source}" if n in _l else f"{n} は入っていません" for n in __fc_pip_names)`);return A("",String(o)),{ok:!0,value:null}}return{ok:!1,error:`pip ${a} はこの環境では使えません (install / list / show / uninstall が使えます)`}}async function Se(r){try{await V()}catch(e){b({type:"evalResult",id:r.id,ok:!1,error:String(e.message||e)});return}l&&(l.interrupt[0]=0);try{let e=await ve(r.code).catch(c=>({ok:!1,error:String(c&&c.message||c).split(`
`).slice(-1)[0]}));if(e){b({type:"evalResult",id:r.id,...e});return}T||(T=y.runPython('{"__name__": "__main__", "__builtins__": __import__("builtins")}')),await oe({"<console>.py":r.code}).catch(()=>{}),y.globals.set("__fc_g",T),y.globals.set("__fc_code",r.code);let a=JSON.parse(y.runPython("__fc_eval(__fc_code, __fc_g)"));w(!0);try{y.runPython("__fc_show_figures()")}catch{}a.ok?b({type:"evalResult",id:r.id,ok:!0,value:a.value,html:a.html||null}):b({type:"evalResult",id:r.id,ok:!1,error:a.type==="KeyboardInterrupt"?"停止しました":a.error})}catch(e){w(!0),b({type:"evalResult",id:r.id,ok:!1,error:String(e&&e.message||e)})}}self.onmessage=r=>{let e=r.data;e&&(e.type==="init"?(e.interrupt&&e.ctl&&e.buf&&e.dctl&&e.dbuf&&(l={interrupt:new Int32Array(e.interrupt),ctl:new Int32Array(e.ctl),buf:new Uint8Array(e.buf),dctl:new Int32Array(e.dctl),dbuf:new Uint8Array(e.dbuf)},e.ectl&&e.ebuf&&(l.ectl=new Int32Array(e.ectl),l.ebuf=new Uint8Array(e.ebuf)),e.fack&&(l.fack=new Int32Array(e.fack))),V().catch(a=>b({type:"status",state:"error",text:"Python を読み込めませんでした: "+(a&&a.message||a)}))):e.type==="run"?ke(e):e.type==="eval"&&Se(e))};
