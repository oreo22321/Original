import{a as G,b as re,c as se,d as K,e as J}from"../chunks/chunk-U4B2QAZV.js";import{loadPyodide as ge}from"../../vendor/pyodide/pyodide.mjs";function ne(r){let t=new Map,a=new Map,c=1,h=typeof OffscreenCanvas=="function"?OffscreenCanvas:null,i=new Map,l=0,m=0,v=96,k=6e6,S=(s,n)=>{if(!h)throw new Error("この端末のブラウザでは pygame の画面を作れません (OffscreenCanvas に対応していません)");s=Math.max(1,s|0),n=Math.max(1,n|0);let e=i.get(s+"x"+n);if(e&&e.length){let o=e.pop();l--,m-=s*n;let _=o.getContext("2d");return _.setTransform(1,0,0,1,0,0),_.globalAlpha=1,_.globalCompositeOperation="source-over",_.clearRect(0,0,s,n),o}return new h(s,n)},q=s=>{let n=s.width*s.height;if(l>=v||m+n>k)return;let e=s.width+"x"+s.height;i.has(e)||i.set(e,[]),i.get(e).push(s),l++,m+=n},ee=(s,n,e)=>{let o=s.getContext("2d",{willReadFrequently:!1});o.imageSmoothingEnabled=!1;let _=c++;return t.set(_,{c:s,x:o,v:0,clip:null,w:n,h:e}),_};r.__fc_pg_new=(s,n,e)=>{let o=S(s,n),_=ee(o,s|0,n|0);if(!e){let p=t.get(_);p.x.fillStyle="#000",p.x.fillRect(0,0,o.width,o.height)}return _},r.__fc_pg_adopt=s=>ee(s,s.width,s.height),r.__fc_pg_size=s=>{let n=t.get(s);return n?[n.w,n.h]:[0,0]},r.__fc_pg_count=()=>t.size,r.__fc_pg_reset=()=>{t.clear(),a.clear(),i.clear(),l=0,m=0};let T=(s,n)=>{if(!s.clip){n();return}s.x.save(),s.x.beginPath(),s.x.rect(s.clip[0],s.clip[1],s.clip[2],s.clip[3]),s.x.clip();try{n()}finally{s.x.restore()}},O={1:"lighter",2:"difference",3:"multiply",4:"darken",5:"lighten",6:"lighter",7:"difference",8:"multiply",9:"darken",10:"lighten"};function de(s,n,e){let o=e.join(","),_=a.get(s);if(_&&_.v===n.v&&_.key===o)return _.c;_&&q(_.c);let p=S(n.c.width,n.c.height),u=p.getContext("2d"),d=n.x.getImageData(0,0,n.c.width,n.c.height),g=d.data,[x,N,P]=e;for(let I=0;I<g.length;I+=4)g[I]===x&&g[I+1]===N&&g[I+2]===P&&(g[I+3]=0);return u.putImageData(d,0,0),a.set(s,{v:n.v,key:o,c:p}),p}function ue(s){let n=t.get(s[1]);if(!n)return;let e=n.x;switch(s[0]){case"fill":{let[,,o,_,p,u]=s,d=_||[0,0,n.w,n.h];T(n,()=>{u&&O[u]?(e.save(),e.globalCompositeOperation=O[u],e.fillStyle=o,e.fillRect(d[0],d[1],d[2],d[3]),e.restore()):(p&&e.clearRect(d[0],d[1],d[2],d[3]),e.fillStyle=o,e.fillRect(d[0],d[1],d[2],d[3]))});break}case"rect":{let[,,o,_,p,u,d,g,x]=s;T(n,()=>{let N=x&&x.some(P=>P>0);g>0?(e.strokeStyle=o,e.lineWidth=g,N&&e.roundRect?(e.beginPath(),e.roundRect(_+g/2,p+g/2,Math.max(0,u-g),Math.max(0,d-g),[x[0],x[1],x[3],x[2]].map(P=>Math.max(0,P-g/2))),e.stroke()):e.strokeRect(_+g/2,p+g/2,Math.max(0,u-g),Math.max(0,d-g))):(e.fillStyle=o,N&&e.roundRect?(e.beginPath(),e.roundRect(_,p,u,d,[x[0],x[1],x[3],x[2]].map(P=>Math.max(0,P))),e.fill()):e.fillRect(_,p,u,d))});break}case"circle":{let[,,o,_,p,u,d]=s;T(n,()=>{e.beginPath(),d>0?(e.arc(_,p,Math.max(0,u-d/2),0,Math.PI*2),e.strokeStyle=o,e.lineWidth=d,e.stroke()):(e.arc(_,p,Math.max(0,u),0,Math.PI*2),e.fillStyle=o,e.fill())});break}case"ellipse":{let[,,o,_,p,u,d,g]=s;T(n,()=>{e.beginPath();let x=g>0?g/2:0;e.ellipse(_+u/2,p+d/2,Math.max(0,u/2-x),Math.max(0,d/2-x),0,0,Math.PI*2),g>0?(e.strokeStyle=o,e.lineWidth=g,e.stroke()):(e.fillStyle=o,e.fill())});break}case"arc":{let[,,o,_,p,u,d,g,x,N]=s;T(n,()=>{e.beginPath();let P=Math.max(1,N);e.ellipse(_+u/2,p+d/2,Math.max(0,u/2-P/2),Math.max(0,d/2-P/2),0,-g,-x,!0),e.strokeStyle=o,e.lineWidth=P,e.stroke()});break}case"line":{let[,,o,_,p,u,d,g]=s;T(n,()=>{e.beginPath(),e.moveTo(_+.5,p+.5),e.lineTo(u+.5,d+.5),e.strokeStyle=o,e.lineWidth=Math.max(1,g),e.lineCap=g>2?"butt":"square",e.stroke()});break}case"lines":case"poly":{let o=s[2],_=s[0]==="poly"?!0:s[3],p=s[0]==="poly"?s[3]:s[4],u=s[0]==="poly"?s[4]:s[5];if(p.length<4)break;T(n,()=>{e.beginPath();let d=s[0]==="poly"&&!(u>0)?0:.5;for(let g=0;g<p.length;g+=2)g?e.lineTo(p[g]+d,p[g+1]+d):e.moveTo(p[g]+d,p[g+1]+d);_&&e.closePath(),s[0]==="poly"&&!(u>0)?(e.fillStyle=o,e.fill()):(e.strokeStyle=o,e.lineWidth=Math.max(1,u),e.lineJoin="miter",e.stroke())});break}case"blit":{let[,,o,_,p,u,d,g,x,N,P,I]=s,W=t.get(o);if(!W||g<=0||x<=0)break;let me=P?de(o,W,P):W.c;T(n,()=>{let te=N>=0&&N<255||I&&O[I];te&&(e.save(),N>=0&&N<255&&(e.globalAlpha=N/255),I&&O[I]&&(e.globalCompositeOperation=O[I])),e.drawImage(me,u,d,g,x,_,p,g,x),te&&e.restore()});break}case"text":{let[,,o,_,p,u,d,g,x]=s;if(g&&(e.fillStyle=g,e.fillRect(0,0,n.w,n.h)),e.font=o,e.textBaseline="alphabetic",e.fillStyle=d,e.fillText(_,p,u),x){let N=e.measureText(_);e.fillRect(p,u+2,N.width,Math.max(1,Math.round(n.h/18)))}break}case"pix":{e.save(),e.clearRect(s[2],s[3],1,1),e.fillStyle=s[4],e.fillRect(s[2],s[3],1,1),e.restore();break}case"clip":n.clip=s[2]||null;return;case"copy":{let o=t.get(s[2]);o&&(e.clearRect(0,0,n.w,n.h),e.drawImage(o.c,0,0));break}case"scale":{let o=t.get(s[2]);if(!o)break;e.save(),e.imageSmoothingEnabled=!!s[3],s[3]&&(e.imageSmoothingQuality="high"),e.clearRect(0,0,n.w,n.h),e.drawImage(o.c,0,0,o.w,o.h,0,0,n.w,n.h),e.restore();break}case"rot":{let o=t.get(s[2]);if(!o)break;e.save(),e.imageSmoothingEnabled=!!s[5],e.clearRect(0,0,n.w,n.h),e.translate(n.w/2,n.h/2),e.rotate(-s[3]*Math.PI/180),e.scale(s[4],s[4]),e.drawImage(o.c,-o.w/2,-o.h/2),e.restore();break}case"flip":{let o=t.get(s[2]);if(!o)break;e.save(),e.clearRect(0,0,n.w,n.h),e.translate(s[3]?n.w:0,s[4]?n.h:0),e.scale(s[3]?-1:1,s[4]?-1:1),e.drawImage(o.c,0,0),e.restore();break}case"scroll":{let o=S(n.w,n.h);o.getContext("2d").drawImage(n.c,0,0),e.drawImage(o,s[2],s[3]),q(o);break}case"gray":{let o=t.get(s[2]);if(!o)break;let _=o.x.getImageData(0,0,o.w||1,o.h||1),p=_.data;for(let u=0;u<p.length;u+=4){let d=Math.round(.299*p[u]+.587*p[u+1]+.114*p[u+2]);p[u]=p[u+1]=p[u+2]=d}e.putImageData(_,0,0);break}case"free":{t.delete(s[1]);let o=a.get(s[1]);o&&q(o.c),a.delete(s[1]),q(n.c);return}}n.v++}r.__fc_pg_exec=s=>{let n=JSON.parse(s);for(let e of n)try{ue(e)}catch{}},r.__fc_pg_pixels=(s,n,e,o,_)=>{let p=t.get(s);return!p||o<=0||_<=0?new Uint8Array(0):new Uint8Array(p.x.getImageData(n,e,o,_).data.buffer)},r.__fc_pg_put=(s,n,e,o,_,p)=>{let u=t.get(s);if(!u)return;let d=n instanceof Uint8ClampedArray?n:new Uint8ClampedArray(n.buffer?n.buffer.slice(n.byteOffset,n.byteOffset+n.byteLength):n);u.x.putImageData(new ImageData(d,_,p),e,o),u.v++};let z=h?new h(1,1).getContext("2d"):null;r.__fc_pg_measure=(s,n)=>{if(!z)return[n.length*8,12,4];z.font=s;let e=z.measureText(n),o=e.fontBoundingBoxAscent!==void 0?e.fontBoundingBoxAscent:e.actualBoundingBoxAscent,_=e.fontBoundingBoxDescent!==void 0?e.fontBoundingBoxDescent:e.actualBoundingBoxDescent;return[e.width,o||0,_||0]},r.__fc_pg_font=(s,n)=>{try{if(typeof FontFace!="function"||!r.fonts)return!1;let e=n instanceof Uint8Array?n.slice():new Uint8Array(n),o=new FontFace(s,e.buffer);return r.fonts.add(o),o.load().catch(()=>{}),!0}catch{return!1}},r.__fc_pg_present=(s,n,e)=>{let o=t.get(s);o&&r.__fc_present(n,o.c,e)}}var M="/home/pyodide/project",he="314.0.8",ye=`https://cdn.jsdelivr.net/pyodide/v${he}/full/`,be="micropip-0.11.1-py3-none-any.whl",b=(r,t)=>t?self.postMessage(r,t):self.postMessage(r),y=null,L=null,f=null,we=0,C=null,D=new Map,V=!1,xe=r=>{let t=new URL(r,import.meta.url);return t.protocol==="file:"?decodeURIComponent(t.pathname):t.href},X=new Map,ae=new Set,E=[],Y=0,ie=0,R=0,H=2e4,B={out:"",err:""},ke={out:new TextDecoder,err:new TextDecoder};function w(r=!1){for(let t of["out","err"])B[t]&&(r||performance.now()-ie>150)&&(le(t,B[t],!0),B[t]="");E.length&&(b({type:"output",items:E}),E=[]),Y=performance.now()}function le(r,t,a=!1){if(R>=H){R===H&&(E.push({kind:"warn",text:`出力が ${H} 行を超えたため、以降は省略します`}),R++);return}R++,E.push({kind:r==="err"?"error-text":"",text:t,partial:a}),E.length>200&&w()}function oe(r,t){let c=(B[r]+ke[r].decode(t,{stream:!0})).split(`
`);B[r]=c.pop();for(let h of c)le(r,h);return ie=performance.now(),E.length&&performance.now()-Y>60&&(b({type:"output",items:E}),E=[],Y=performance.now()),t.length}setInterval(()=>w(),80);async function Q(){return y||(L||(L=(async()=>{b({type:"status",state:"loading",text:"Python を準備しています…"});let r=new URL("../../vendor/pyodide/",import.meta.url),t=r.protocol==="file:"?decodeURIComponent(r.pathname):r.href,a=await ge({indexURL:t,lockFileURL:t+"pyodide-lock.json",packageBaseUrl:ye,env:{HOME:"/home/pyodide",MPLBACKEND:"AGG",PYTHONUNBUFFERED:"1"}});a.setStdout({write:c=>oe("out",c)}),a.setStderr({write:c=>oe("err",c)}),a.setStdin({stdin:ve,isatty:!0}),f&&a.setInterruptBuffer(f.interrupt),a.FS.mkdirTree(M);for(let[c,h]of Object.entries(se())){let i=G+"/"+c;a.FS.mkdirTree(i.slice(0,i.lastIndexOf("/"))),a.FS.writeFile(i,h)}return a.globals.set("__fc_dbg_src",Ne),a.runPython(Se),y=a,b({type:"status",state:"ready",text:`Python ${a.runPython("import sys; sys.version.split()[0]")}`}),a})().catch(r=>{throw L=null,r})),L)}function ve(){if(w(!0),!f)throw new Error("この環境では input() を使えません。ページを再読み込みしてからもう一度試してください (初回は再読み込みが必要です)");for(Atomics.store(f.ctl,0,0),b({type:"input",password:V}),V=!1;;){let a=Atomics.wait(f.ctl,0,0,250);if(Atomics.load(f.ctl,0)!==0)break;if(a==="timed-out"&&f.interrupt[0]===2)return b({type:"inputDone"}),null}let r=Atomics.load(f.ctl,0),t=Atomics.load(f.ctl,1);return b({type:"inputDone"}),r===2?null:new TextDecoder().decode(f.buf.slice(0,t))+`
`}var Se=`
import sys, os, traceback, builtins, json, base64, io
__fc_builtin_input = builtins.input
__fc_project = ${JSON.stringify(M)}
__fc_lib = ${JSON.stringify(G)}
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
`;self.__fc_image=(r,t)=>{w(!0),b({type:"image",data:r,key:t||null})};self.__fc_svg=r=>{w(!0),b({type:"image",data:btoa(unescape(encodeURIComponent(String(r)))),mime:"image/svg+xml"})};self.__fc_html=(r,t)=>{w(!0),b({type:"html",html:String(r).slice(0,4e5),text:String(t||"")})};self.__fc_meta=r=>{w(!0),b({type:"output",items:[{kind:"meta",text:String(r)}]})};self.__fc_link=r=>{w(!0),b({type:"link",url:String(r)})};self.__fc_password=()=>{V=!0};self.__fc_turtle=r=>{w(!0),b({type:"turtle",ops:r})};self.__fc_sleep=r=>(w(!0),f?(Atomics.wait(f.interrupt,0,0,Math.max(0,r*1e3)),!0):!1);self.__fc_ev_ok=()=>!!(f&&f.ectl);self.__fc_ev_poll=()=>{if(!f||!f.ectl||Atomics.load(f.ectl,0)!==1)return"";let r=Atomics.load(f.ectl,1),t=new TextDecoder().decode(f.ebuf.slice(0,r));return Atomics.store(f.ectl,0,0),b({type:"evTaken"}),t};var U=0;function fe(){if(!f||!f.fack)return;let r=performance.now();for(;;){let t=Atomics.load(f.fack,0);if(U-t<=2||f.interrupt[0]!==0||performance.now()-r>150)return;Atomics.wait(f.fack,0,t,20)}}self.__fc_frame=(r,t,a,c,h,i)=>{w(!0);let l,m=c.getBuffer("u8");try{l=new Uint8ClampedArray(m.data)}finally{m.release()}U++,b({type:"frame",key:String(r),w:t,h:a,data:l,scale:Number(h)||1,title:String(i||""),seq:U},[l.buffer]),fe()};var Z=new Map;self.__fc_present=(r,t,a)=>{w(!0);let c=t.width,h=t.height,i=Z.get(r);(!i||i.width!==c||i.height!==h)&&(i=new OffscreenCanvas(c,h),Z.set(r,i)),i.getContext("2d").drawImage(t,0,0);let m=i.transferToImageBitmap();U++,b({type:"frame",key:String(r),w:c,h,bitmap:m,scale:1,title:String(a||""),seq:U,kind:"pg"},[m]),fe()};self.__fc_surface=r=>{w(!0),b({type:"surface",...JSON.parse(r)})};self.__fc_tk=r=>{w(!0),b({type:"tk",ops:r})};self.__fc_sound=(r,t)=>{let a=JSON.parse(r),c=null;t&&(c=t instanceof Uint8Array?t.slice():null),b({type:"sound",...a,data:c},c?[c.buffer]:void 0)};var j=null,F=null;self.__fc_rpc=(r,t,a)=>{if(w(!0),!f)throw new Error("この機能を使うには、ページを再読み込みしてください (はじめて開いたときは再読み込みが必要です)");j||(j=new Int32Array(new SharedArrayBuffer(16)));let c=1<<20;for(let h=0;h<3;h++){(!F||F.length<c)&&(F=new Uint8Array(new SharedArrayBuffer(c))),Atomics.store(j,0,0);let i=a?a.slice?a.slice():a:null;for(b({type:"rpc",op:String(r),args:JSON.parse(t||"{}"),data:i,ctl:j.buffer,buf:F.buffer});Atomics.wait(j,0,0,250),Atomics.load(j,0)===0;)if(f.interrupt[0]===2)return null;let l=Atomics.load(j,0),m=Atomics.load(j,1);if(l===3){c=m;continue}let v=F.slice(0,m);if(l===2)throw new Error(new TextDecoder().decode(v)||r+" に失敗しました");return{w:Atomics.load(j,2),h:Atomics.load(j,3),bytes:v,text:()=>new TextDecoder().decode(v)}}throw new Error(r+" の結果が大きすぎます")};self.__fc_image_canvas=r=>{let t=self.__fc_rpc("decode","{}",r);if(!t)return null;let a=new OffscreenCanvas(Math.max(1,t.w),Math.max(1,t.h));return a.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(t.bytes.buffer,0,t.w*t.h*4),t.w,t.h),0,0),a};self.__fc_ev_wait=r=>(w(!0),!f||!f.ectl?!1:(f.interrupt[0]!==0||Atomics.wait(f.ectl,0,0,Math.max(1,r)),!0));ne(self);var Ne=`import bdb, reprlib, inspect, types, sys, json, js, re as _re

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
`;function ce(){let r=Atomics.load(f.dctl,1),t=new TextDecoder().decode(f.dbuf.slice(0,r));return Atomics.store(f.dctl,0,0),t}self.__fc_dbg_post=r=>{w(!0),b(JSON.parse(r))};self.__fc_dbg_wait=()=>{for(w(!0);;){if(Atomics.wait(f.dctl,0,0,250),Atomics.load(f.dctl,0)===1)return ce();if(f.interrupt[0]===2)return f.interrupt[0]=0,'{"type":"stop"}'}};self.__fc_dbg_poll=()=>f&&Atomics.load(f.dctl,0)===1?ce():"";function Pe(r){let t=y.FS;for(let a of D.keys())if(!(a in r))try{t.unlink(M+"/"+a)}catch{}D=new Map;for(let[a,c]of Object.entries(r)){let h=M+"/"+a;t.mkdirTree(h.slice(0,h.lastIndexOf("/"))),t.writeFile(h,c),D.set(a,c)}}function Ie(){let r=y.FS,t={},a=(c,h)=>{let i=[];try{i=r.readdir(c)}catch{return}for(let l of i){if(l==="."||l===".."||l==="__pycache__")continue;let m=c+"/"+l,v=h?h+"/"+l:l,k;try{k=r.stat(m)}catch{continue}if(r.isDir(k.mode))a(m,v);else if(k.size<2e6&&/\.(py|txt|csv|json|md|tsv|log|html|xml|ya?ml|ini|cfg|toml)$/i.test(l)){let S;try{S=r.readFile(m,{encoding:"utf8"})}catch{continue}D.get(v)!==S&&(t[v]=S)}}};a(M,"");for(let c of D.keys())try{r.stat(M+"/"+c)}catch{t[c]=null}return t}async function Ae(r){let t=r.id;we=t,R=0;let a=performance.now();try{await Q()}catch(k){w(!0),b({type:"done",id:t,ok:!1,reason:"load",error:"Python を読み込めませんでした: "+(k&&k.message||k)});return}f&&(f.interrupt[0]=0),Z.clear(),Pe(r.files||{});let c=r.files[r.entry]??"",h=Object.fromEntries(Object.entries(r.files).filter(([k])=>k.endsWith(".py")));await _e(h,r.files["requirements.txt"]);let i=!0,l=null,m="done";try{y.globals.set("__fc_entry",r.entry),y.globals.set("__fc_src",c),y.globals.set("__fc_dbgopt",f&&r.debug?JSON.stringify(r.debug):null),y.runPython("import os; os.chdir(__fc_project)"),y.runPython(f?"builtins.input = __fc_builtin_input":"builtins.input = __fc_no_input"),f&&Atomics.store(f.dctl,0,0);let k=y.runPython("__fc_run(__fc_entry, __fc_src, __fc_dbgopt)");if(C)try{C.destroy()}catch{}C=y.runPython('__fc_last["g"]'),k&&(l=JSON.parse(k),l.type==="KeyboardInterrupt"?(m="stopped",l=null):l.type==="SystemExit"?(m="exit",l=null):(i=!1,m="error"));try{y.runPython("__fc_show_figures()")}catch{}}catch(k){i=!1,m="error";let S=String(k&&k.message||k);if(/fatal error|Aborted\(|out of memory|memory access out of bounds/i.test(S)){w(!0),b({type:"done",id:t,ok:!1,reason:"error",fatal:!0,error:{type:"MemoryError",message:"Python が止まりました (メモリが足りなくなった可能性があります)。Python を立ち上げ直します",text:S,frames:[]},files:{},ms:Math.round(performance.now()-a)});return}l={type:"Error",message:S,text:S,frames:[]}}w(!0);let v={};try{v=Ie()}catch{}b({type:"done",id:t,ok:i,reason:m,error:l,files:v,ms:Math.round(performance.now()-a)})}var A=(r,t)=>{w(!0),b({type:"output",items:[{kind:r,text:t}]})};async function _e(r,t){let a={req:[],opt:[]};try{a=JSON.parse(y.globals.get("__fc_imports")(JSON.stringify(r)))}catch{}for(let l of a.req)J[l]&&A("warn",J[l]);let c=a.req.filter(l=>!J[l]&&!re.has(l));c.includes("zoneinfo")&&c.push("tzdata");try{let l=!1;await y.loadPackagesFromImports(c.map(m=>`import ${m}`).join(`
`),{messageCallback:m=>{/^Loading /.test(m)&&!l&&(l=!0,A("meta","ライブラリを読み込んでいます… (初回だけ時間がかかります)"))},errorCallback:m=>A("warn",m)})}catch(l){A("warn","ライブラリを読み込めませんでした (インターネットの接続を確認してください): "+(l&&l.message||l))}let h=[];for(let l of String(t||"").split(`
`)){let m=l.replace(/\s+#.*$|^#.*$/,"").trim();m&&!m.startsWith("-")&&!ae.has(m)&&h.push(m)}let i=[];try{i=JSON.parse(y.globals.get("__fc_missing")(JSON.stringify(c)))}catch{}i=i.filter(l=>!X.has(l)),!(!h.length&&!i.length)&&await pe([...h,...i.map(l=>K[l]||l)],{fromImports:i,reqs:h})}async function $(){if(!y.globals.get("__fc_has_micropip")){try{y.pyimport("micropip")}catch{await y.loadPackage(xe("../../vendor/pywheels/"+be),{messageCallback:()=>{}})}y.pyimport("micropip"),y.globals.set("__fc_has_micropip",!0)}}async function pe(r,{fromImports:t=[],reqs:a=[],quiet:c=!1}={}){if(!r.length)return[];c||A("meta",`PyPI からライブラリを入れています: ${r.join(", ")} …`);let h=[];try{await $(),y.globals.set("__fc_pip_names",y.toPy(r));let i=await y.runPythonAsync(`
import micropip, json
_r = []
for _n in __fc_pip_names:
    try:
        await micropip.install(_n)
        _r.append([_n, None])
    except Exception as _e:
        _r.append([_n, str(_e).split("\\n")[0][:300]])
json.dumps(_r)`);for(let[m,v]of JSON.parse(i)){let k=t.find(S=>(K[S]||S)===m);if(k&&X.set(k,v||"ok"),a.includes(m)&&!v&&ae.add(m),v){h.push(m);let S=/Can't find a pure Python 3 wheel|No matching distribution|Can't fetch metadata|not found/i.test(v)?/pure Python/.test(v)?"ブラウザで動く形 (pure Python) が PyPI にないため":"PyPI に見つからないため":v;A("warn",`${m} を入れられませんでした (${S})`)}}let l=r.filter(m=>!h.includes(m));l.length&&!c&&A("meta",`入れました: ${l.join(", ")}`)}catch(i){for(let l of t)X.set(l,String(i&&i.message||i));return A("warn","PyPI からライブラリを入れられませんでした (インターネットの接続を確認してください): "+String(i&&i.message||i).split(`
`).slice(-1)[0]),r}return h}async function je(r){let t=/^\s*[%!]?\s*(?:python3?\s+-m\s+)?pip3?\s+(\w+)\s*(.*)$/s.exec(r);if(!t)return null;let[,a,c]=t,h=c.split(/\s+/).filter(i=>i&&!i.startsWith("-"));if(a==="install"){if(!h.length)return{ok:!1,error:"入れるライブラリの名前を書いてください (例: pip install emoji)"};let i=await pe(h);return i.length?{ok:!1,error:`入れられなかったもの: ${i.join(", ")}`}:{ok:!0,value:null}}if(a==="list"||a==="freeze"){await $();let i=await y.runPythonAsync(`import micropip
"\\n".join(sorted(f"{p.name}{'==' if ${a==="freeze"?"True":"False"} else ' '}{p.version}" for p in micropip.list().values()))`);return A("",String(i)),{ok:!0,value:null}}if(a==="uninstall")return await $(),y.globals.set("__fc_pip_names",y.toPy(h)),await y.runPythonAsync(`import micropip
micropip.uninstall(list(__fc_pip_names))`),A("meta",`外しました: ${h.join(", ")}`),{ok:!0,value:null};if(a==="show"){await $(),y.globals.set("__fc_pip_names",y.toPy(h));let i=await y.runPythonAsync(`import micropip
_l = micropip.list()
"\\n".join(f"Name: {_l[n].name}\\nVersion: {_l[n].version}\\nSource: {_l[n].source}" if n in _l else f"{n} は入っていません" for n in __fc_pip_names)`);return A("",String(i)),{ok:!0,value:null}}return{ok:!1,error:`pip ${a} はこの環境では使えません (install / list / show / uninstall が使えます)`}}async function Ee(r){try{await Q()}catch(t){b({type:"evalResult",id:r.id,ok:!1,error:String(t.message||t)});return}f&&(f.interrupt[0]=0);try{let t=await je(r.code).catch(c=>({ok:!1,error:String(c&&c.message||c).split(`
`).slice(-1)[0]}));if(t){b({type:"evalResult",id:r.id,...t});return}C||(C=y.runPython('{"__name__": "__main__", "__builtins__": __import__("builtins")}')),await _e({"<console>.py":r.code}).catch(()=>{}),y.globals.set("__fc_g",C),y.globals.set("__fc_code",r.code);let a=JSON.parse(y.runPython("__fc_eval(__fc_code, __fc_g)"));w(!0);try{y.runPython("__fc_show_figures()")}catch{}a.ok?b({type:"evalResult",id:r.id,ok:!0,value:a.value,html:a.html||null}):b({type:"evalResult",id:r.id,ok:!1,error:a.type==="KeyboardInterrupt"?"停止しました":a.error})}catch(t){w(!0),b({type:"evalResult",id:r.id,ok:!1,error:String(t&&t.message||t)})}}self.onmessage=r=>{let t=r.data;t&&(t.type==="init"?(t.interrupt&&t.ctl&&t.buf&&t.dctl&&t.dbuf&&(f={interrupt:new Int32Array(t.interrupt),ctl:new Int32Array(t.ctl),buf:new Uint8Array(t.buf),dctl:new Int32Array(t.dctl),dbuf:new Uint8Array(t.dbuf)},t.ectl&&t.ebuf&&(f.ectl=new Int32Array(t.ectl),f.ebuf=new Uint8Array(t.ebuf)),t.fack&&(f.fack=new Int32Array(t.fack))),Q().catch(a=>b({type:"status",state:"error",text:"Python を読み込めませんでした: "+(a&&a.message||a)}))):t.type==="run"?Ae(t):t.type==="eval"&&Ee(t))};
