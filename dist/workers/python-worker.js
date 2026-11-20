import{c as ae,d as le}from"../chunks/chunk-OCXOK7H2.js";import{a as H,b as fe,c as ce,d as Y,e as W}from"../chunks/chunk-A6S7RETE.js";import{loadPyodide as Ne}from"../../vendor/pyodide/pyodide.mjs";function _e(e){let r=new Map,i=new Map,f=1,a=typeof OffscreenCanvas=="function"?OffscreenCanvas:null,l=new Map,p=0,m=0,x=96,P=6e6,S=(n,s)=>{if(!a)throw new Error("この端末のブラウザでは pygame の画面を作れません (OffscreenCanvas に対応していません)");n=Math.max(1,n|0),s=Math.max(1,s|0);let t=l.get(n+"x"+s);if(t&&t.length){let o=t.pop();p--,m-=n*s;let _=o.getContext("2d");return _.setTransform(1,0,0,1,0,0),_.globalAlpha=1,_.globalCompositeOperation="source-over",_.clearRect(0,0,n,s),o}return new a(n,s)},k=n=>{let s=n.width*n.height;if(p>=x||m+s>P)return;let t=n.width+"x"+n.height;l.has(t)||l.set(t,[]),l.get(t).push(n),p++,m+=s},N=(n,s,t)=>{let o=n.getContext("2d",{willReadFrequently:!1});o.imageSmoothingEnabled=!1;let _=f++;return r.set(_,{c:n,x:o,v:0,clip:null,w:s,h:t}),_};e.__fc_pg_new=(n,s,t)=>{let o=S(n,s),_=N(o,n|0,s|0);if(!t){let d=r.get(_);d.x.fillStyle="#000",d.x.fillRect(0,0,o.width,o.height)}return _},e.__fc_pg_adopt=n=>N(n,n.width,n.height),e.__fc_pg_size=n=>{let s=r.get(n);return s?[s.w,s.h]:[0,0]},e.__fc_pg_count=()=>r.size,e.__fc_pg_reset=()=>{r.clear(),i.clear(),l.clear(),p=0,m=0};let M=(n,s)=>{if(!n.clip){s();return}n.x.save(),n.x.beginPath(),n.x.rect(n.clip[0],n.clip[1],n.clip[2],n.clip[3]),n.x.clip();try{s()}finally{n.x.restore()}},q={1:"lighter",2:"difference",3:"multiply",4:"darken",5:"lighten",6:"lighter",7:"difference",8:"multiply",9:"darken",10:"lighten"};function ve(n,s,t){let o=t.join(","),_=i.get(n);if(_&&_.v===s.v&&_.key===o)return _.c;_&&k(_.c);let d=S(s.c.width,s.c.height),h=d.getContext("2d"),g=s.x.getImageData(0,0,s.c.width,s.c.height),y=g.data,[v,A,I]=t;for(let E=0;E<y.length;E+=4)y[E]===v&&y[E+1]===A&&y[E+2]===I&&(y[E+3]=0);return h.putImageData(g,0,0),i.set(n,{v:s.v,key:o,c:d}),d}function ke(n){let s=r.get(n[1]);if(!s)return;let t=s.x;switch(n[0]){case"fill":{let[,,o,_,d,h]=n,g=_||[0,0,s.w,s.h];M(s,()=>{h&&q[h]?(t.save(),t.globalCompositeOperation=q[h],t.fillStyle=o,t.fillRect(g[0],g[1],g[2],g[3]),t.restore()):(d&&t.clearRect(g[0],g[1],g[2],g[3]),t.fillStyle=o,t.fillRect(g[0],g[1],g[2],g[3]))});break}case"rect":{let[,,o,_,d,h,g,y,v]=n;M(s,()=>{let A=v&&v.some(I=>I>0);y>0?(t.strokeStyle=o,t.lineWidth=y,A&&t.roundRect?(t.beginPath(),t.roundRect(_+y/2,d+y/2,Math.max(0,h-y),Math.max(0,g-y),[v[0],v[1],v[3],v[2]].map(I=>Math.max(0,I-y/2))),t.stroke()):t.strokeRect(_+y/2,d+y/2,Math.max(0,h-y),Math.max(0,g-y))):(t.fillStyle=o,A&&t.roundRect?(t.beginPath(),t.roundRect(_,d,h,g,[v[0],v[1],v[3],v[2]].map(I=>Math.max(0,I))),t.fill()):t.fillRect(_,d,h,g))});break}case"circle":{let[,,o,_,d,h,g]=n;M(s,()=>{t.beginPath(),g>0?(t.arc(_,d,Math.max(0,h-g/2),0,Math.PI*2),t.strokeStyle=o,t.lineWidth=g,t.stroke()):(t.arc(_,d,Math.max(0,h),0,Math.PI*2),t.fillStyle=o,t.fill())});break}case"ellipse":{let[,,o,_,d,h,g,y]=n;M(s,()=>{t.beginPath();let v=y>0?y/2:0;t.ellipse(_+h/2,d+g/2,Math.max(0,h/2-v),Math.max(0,g/2-v),0,0,Math.PI*2),y>0?(t.strokeStyle=o,t.lineWidth=y,t.stroke()):(t.fillStyle=o,t.fill())});break}case"arc":{let[,,o,_,d,h,g,y,v,A]=n;M(s,()=>{t.beginPath();let I=Math.max(1,A);t.ellipse(_+h/2,d+g/2,Math.max(0,h/2-I/2),Math.max(0,g/2-I/2),0,-y,-v,!0),t.strokeStyle=o,t.lineWidth=I,t.stroke()});break}case"line":{let[,,o,_,d,h,g,y]=n;M(s,()=>{t.beginPath(),t.moveTo(_+.5,d+.5),t.lineTo(h+.5,g+.5),t.strokeStyle=o,t.lineWidth=Math.max(1,y),t.lineCap=y>2?"butt":"square",t.stroke()});break}case"lines":case"poly":{let o=n[2],_=n[0]==="poly"?!0:n[3],d=n[0]==="poly"?n[3]:n[4],h=n[0]==="poly"?n[4]:n[5];if(d.length<4)break;M(s,()=>{t.beginPath();let g=n[0]==="poly"&&!(h>0)?0:.5;for(let y=0;y<d.length;y+=2)y?t.lineTo(d[y]+g,d[y+1]+g):t.moveTo(d[y]+g,d[y+1]+g);_&&t.closePath(),n[0]==="poly"&&!(h>0)?(t.fillStyle=o,t.fill()):(t.strokeStyle=o,t.lineWidth=Math.max(1,h),t.lineJoin="miter",t.stroke())});break}case"blit":{let[,,o,_,d,h,g,y,v,A,I,E]=n,K=r.get(o);if(!K||y<=0||v<=0)break;let Se=I?ve(o,K,I):K.c;M(s,()=>{let ie=A>=0&&A<255||E&&q[E];ie&&(t.save(),A>=0&&A<255&&(t.globalAlpha=A/255),E&&q[E]&&(t.globalCompositeOperation=q[E])),t.drawImage(Se,h,g,y,v,_,d,y,v),ie&&t.restore()});break}case"text":{let[,,o,_,d,h,g,y,v]=n;if(y&&(t.fillStyle=y,t.fillRect(0,0,s.w,s.h)),t.font=o,t.textBaseline="alphabetic",t.fillStyle=g,t.fillText(_,d,h),v){let A=t.measureText(_);t.fillRect(d,h+2,A.width,Math.max(1,Math.round(s.h/18)))}break}case"pix":{t.save(),t.clearRect(n[2],n[3],1,1),t.fillStyle=n[4],t.fillRect(n[2],n[3],1,1),t.restore();break}case"clip":s.clip=n[2]||null;return;case"copy":{let o=r.get(n[2]);o&&(t.clearRect(0,0,s.w,s.h),t.drawImage(o.c,0,0));break}case"scale":{let o=r.get(n[2]);if(!o)break;t.save(),t.imageSmoothingEnabled=!!n[3],n[3]&&(t.imageSmoothingQuality="high"),t.clearRect(0,0,s.w,s.h),t.drawImage(o.c,0,0,o.w,o.h,0,0,s.w,s.h),t.restore();break}case"rot":{let o=r.get(n[2]);if(!o)break;t.save(),t.imageSmoothingEnabled=!!n[5],t.clearRect(0,0,s.w,s.h),t.translate(s.w/2,s.h/2),t.rotate(-n[3]*Math.PI/180),t.scale(n[4],n[4]),t.drawImage(o.c,-o.w/2,-o.h/2),t.restore();break}case"flip":{let o=r.get(n[2]);if(!o)break;t.save(),t.clearRect(0,0,s.w,s.h),t.translate(n[3]?s.w:0,n[4]?s.h:0),t.scale(n[3]?-1:1,n[4]?-1:1),t.drawImage(o.c,0,0),t.restore();break}case"scroll":{let o=S(s.w,s.h);o.getContext("2d").drawImage(s.c,0,0),t.drawImage(o,n[2],n[3]),k(o);break}case"gray":{let o=r.get(n[2]);if(!o)break;let _=o.x.getImageData(0,0,o.w||1,o.h||1),d=_.data;for(let h=0;h<d.length;h+=4){let g=Math.round(.299*d[h]+.587*d[h+1]+.114*d[h+2]);d[h]=d[h+1]=d[h+2]=g}t.putImageData(_,0,0);break}case"free":{r.delete(n[1]);let o=i.get(n[1]);o&&k(o.c),i.delete(n[1]),k(s.c);return}}s.v++}e.__fc_pg_exec=n=>{let s=JSON.parse(n);for(let t of s)try{ke(t)}catch{}},e.__fc_pg_pixels=(n,s,t,o,_)=>{let d=r.get(n);return!d||o<=0||_<=0?new Uint8Array(0):new Uint8Array(d.x.getImageData(s,t,o,_).data.buffer)},e.__fc_pg_put=(n,s,t,o,_,d)=>{let h=r.get(n);if(!h)return;let g=s instanceof Uint8ClampedArray?s:new Uint8ClampedArray(s.buffer?s.buffer.slice(s.byteOffset,s.byteOffset+s.byteLength):s);h.x.putImageData(new ImageData(g,_,d),t,o),h.v++};let X=a?new a(1,1).getContext("2d"):null;e.__fc_pg_measure=(n,s)=>{if(!X)return[s.length*8,12,4];X.font=n;let t=X.measureText(s),o=t.fontBoundingBoxAscent!==void 0?t.fontBoundingBoxAscent:t.actualBoundingBoxAscent,_=t.fontBoundingBoxDescent!==void 0?t.fontBoundingBoxDescent:t.actualBoundingBoxDescent;return[t.width,o||0,_||0]},e.__fc_pg_font=(n,s)=>{try{if(typeof FontFace!="function"||!e.fonts)return!1;let t=s instanceof Uint8Array?s.slice():new Uint8Array(s),o=new FontFace(n,t.buffer);return e.fonts.add(o),o.load().catch(()=>{}),!0}catch{return!1}},e.__fc_pg_present=(n,s,t)=>{let o=r.get(n);o&&e.__fc_present(s,o.c,t)}}var J="/home/pyodide/project",Pe="314.0.8",Ae=`https://cdn.jsdelivr.net/pyodide/v${Pe}/full/`,Ie="micropip-0.11.1-py3-none-any.whl",b=(e,r)=>r?self.postMessage(e,r):self.postMessage(e),u=null,G=null,c=null,Ee=0,U=null,L=null,D=new Map,Z=!1,je=e=>{let r=new URL(e,import.meta.url);return r.protocol==="file:"?decodeURIComponent(r.pathname):r.href},Q=new Map,ue=new Set,C=[],ee=0,me=0,se=2e4,Te=2,R=se,te=0,B=0,Ce=65536,O={out:"",err:""},Me={out:new TextDecoder,err:new TextDecoder};function ge(){R=se,te=performance.now(),B=0,F=[]}var F=[];function he(){if(!B)return;let e=B-F.length;e>0&&C.push({kind:"warn",text:`… 出力がとても多いため ${e.toLocaleString()} 行を省略しました`});for(let r of F)C.push(r);R-=F.length,F=[],B=0}function w(e=!1){for(let r of["out","err"])O[r]&&(e||performance.now()-me>150)&&(re(r,O[r],!0),O[r]="");B&&(e||R>200)&&he(),C.length&&(b({type:"output",items:C}),C=[]),ee=performance.now()}function re(e,r,i=!1){let f=performance.now();R=Math.min(se,R+(f-te)*Te),te=f;let a={kind:e==="err"?"error-text":"",text:r,partial:i};if(R<1||B&&R<200){B++,F.push(a),F.length>100&&F.shift();return}R--,B&&he(),C.push(a),C.length>200&&w()}function pe(e,r){let f=(O[e]+Me[e].decode(r,{stream:!0})).split(`
`);O[e]=f.pop();for(let a of f)re(e,a);return O[e].length>Ce&&(re(e,O[e],!0),O[e]=""),me=performance.now(),C.length&&performance.now()-ee>60&&(b({type:"output",items:C}),C=[],ee=performance.now()),r.length}setInterval(()=>w(),80);async function oe(){return u||(G||(G=(async()=>{b({type:"status",state:"loading",text:"Python を準備しています…"});let e=new URL("../../vendor/pyodide/",import.meta.url),r=e.protocol==="file:"?decodeURIComponent(e.pathname):e.href,i=await Ne({indexURL:r,lockFileURL:r+"pyodide-lock.json",packageBaseUrl:Ae,env:{HOME:"/home/pyodide",MPLBACKEND:"AGG",PYTHONUNBUFFERED:"1"}});i.setStdout({write:f=>pe("out",f)}),i.setStderr({write:f=>pe("err",f)}),i.setStdin({stdin:Re,isatty:!0}),c&&i.setInterruptBuffer(c.interrupt),i.FS.mkdirTree(J);for(let[f,a]of Object.entries(ce())){let l=H+"/"+f;i.FS.mkdirTree(l.slice(0,l.lastIndexOf("/"))),i.FS.writeFile(l,a)}return i.globals.set("__fc_dbg_src",Fe),i.runPython(Oe),u=i,b({type:"status",state:"ready",text:`Python ${i.runPython("import sys; sys.version.split()[0]")}`}),i})().catch(e=>{throw G=null,e})),G)}function Re(){if(w(!0),!c)throw new Error("この環境では input() を使えません。ページを再読み込みしてからもう一度試してください (初回は再読み込みが必要です)");for(Atomics.store(c.ctl,0,0),b({type:"input",password:Z}),Z=!1;;){let i=Atomics.wait(c.ctl,0,0,250);if(Atomics.load(c.ctl,0)!==0)break;if(i==="timed-out"&&c.interrupt[0]===2)return b({type:"inputDone"}),null}let e=Atomics.load(c.ctl,0),r=Atomics.load(c.ctl,1);return b({type:"inputDone"}),e===2?null:new TextDecoder().decode(c.buf.slice(0,r))+`
`}var Oe=`
import sys, os, traceback, builtins, json, base64, io
__fc_builtin_input = builtins.input
__fc_project = ${JSON.stringify(J)}
__fc_lib = ${JSON.stringify(H)}
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
def __fc_chdir(cwd):
    d = os.path.join(__fc_project, cwd) if cwd else __fc_project
    os.chdir(d if os.path.isdir(d) else __fc_project)

def __fc_run(path, src, dbg=None, argv=None):
    # path が <string> / <module> / <stdin> のときは、ファイルではないコード (ターミナルの python -c / -m)
    virtual = path.startswith("<")
    fn = path if virtual else __fc_project + "/" + path
    g = {"__name__": "__main__", "__builtins__": builtins}
    if not virtual:
        g["__file__"] = fn
    # スクリプトのあるフォルダ (python sub/x.py なら sub) を import の場所の先頭に (ふつうの Python と同じ)
    here = os.getcwd() if virtual else os.path.dirname(fn)
    added = None
    if here != __fc_project and here not in sys.path:
        sys.path.insert(0, here)
        added = here
    __fc_last["g"] = g
    __fc_last["err"] = None
    opt = json.loads(dbg) if dbg else None
    __fc_dbg["opt"] = opt
    d = None
    _forgecode.begin(json.loads(argv) if argv else [path])
    try:
        code = compile(src, fn, "exec")
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
        if added is not None:
            try:
                sys.path.remove(added)
            except ValueError:
                pass
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

# ---- ターミナルの python (対話モード) ----
def __fc_repl_complete(code):
    # 続きが要るか (if の後など)。書き間違いは「完結」として実行し、エラーを見せる
    import codeop
    try:
        return codeop.compile_command(code, "<stdin>", "single") is not None
    except (SyntaxError, ValueError, OverflowError):
        return True

def __fc_repl_names(text, g, line=""):
    # Tab で名前を補う (import / from の後はモジュールの名前)
    import rlcompleter, re
    m = re.match(r"s*(?:import|from)s+([w.]*)$", line or "")
    if m and "." not in m.group(1):
        import pkgutil
        names = set(sys.builtin_module_names) | set(sys.stdlib_module_names)
        try:
            names |= {mi.name for mi in pkgutil.iter_modules()}
        except Exception:
            pass
        return json.dumps(sorted(n for n in names if n.startswith(text) and not n.startswith("_"))[:200])
    c = rlcompleter.Completer(g)
    out = []
    for i in range(200):
        try:
            m = c.complete(text, i)
        except Exception:
            break
        if m is None:
            break
        out.append(m)
    return json.dumps(out)

def __fc_new_ns():
    return {"__name__": "__main__", "__builtins__": builtins}

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
`;self.__fc_image=(e,r)=>{w(!0),b({type:"image",data:e,key:r||null})};self.__fc_svg=e=>{w(!0),b({type:"image",data:btoa(unescape(encodeURIComponent(String(e)))),mime:"image/svg+xml"})};self.__fc_html=(e,r)=>{w(!0),b({type:"html",html:String(e).slice(0,4e5),text:String(r||"")})};self.__fc_meta=e=>{w(!0),b({type:"output",items:[{kind:"meta",text:String(e)}]})};self.__fc_link=e=>{w(!0),b({type:"link",url:String(e)})};self.__fc_password=()=>{Z=!0};self.__fc_turtle=e=>{w(!0),b({type:"turtle",ops:e})};self.__fc_sleep=e=>(w(!0),c?(Atomics.wait(c.interrupt,0,0,Math.max(0,e*1e3)),!0):!1);self.__fc_ev_ok=()=>!!(c&&c.ectl);self.__fc_ev_poll=()=>{if(!c||!c.ectl||Atomics.load(c.ectl,0)!==1)return"";let e=Atomics.load(c.ectl,1),r=new TextDecoder().decode(c.ebuf.slice(0,e));return Atomics.store(c.ectl,0,0),b({type:"evTaken"}),r};var z=0;function ye(){if(!c||!c.fack)return;let e=performance.now();for(;;){let r=Atomics.load(c.fack,0);if(z-r<=2||c.interrupt[0]!==0||performance.now()-e>150)return;Atomics.wait(c.fack,0,r,20)}}self.__fc_frame=(e,r,i,f,a,l)=>{w(!0);let p,m=f.getBuffer("u8");try{p=new Uint8ClampedArray(m.data)}finally{m.release()}z++,b({type:"frame",key:String(e),w:r,h:i,data:p,scale:Number(a)||1,title:String(l||""),seq:z},[p.buffer]),ye()};var ne=new Map;self.__fc_present=(e,r,i)=>{w(!0);let f=r.width,a=r.height,l=ne.get(e);(!l||l.width!==f||l.height!==a)&&(l=new OffscreenCanvas(f,a),ne.set(e,l)),l.getContext("2d").drawImage(r,0,0);let m=l.transferToImageBitmap();z++,b({type:"frame",key:String(e),w:f,h:a,bitmap:m,scale:1,title:String(i||""),seq:z,kind:"pg"},[m]),ye()};self.__fc_surface=e=>{w(!0),b({type:"surface",...JSON.parse(e)})};self.__fc_tk=e=>{w(!0),b({type:"tk",ops:e})};self.__fc_sound=(e,r)=>{let i=JSON.parse(e),f=null;r&&(f=r instanceof Uint8Array?r.slice():null),b({type:"sound",...i,data:f},f?[f.buffer]:void 0)};var T=null,$=null;self.__fc_rpc=(e,r,i)=>{if(w(!0),!c)throw new Error("この機能を使うには、ページを再読み込みしてください (はじめて開いたときは再読み込みが必要です)");T||(T=new Int32Array(new SharedArrayBuffer(16)));let f=1<<20;for(let a=0;a<3;a++){(!$||$.length<f)&&($=new Uint8Array(new SharedArrayBuffer(f))),Atomics.store(T,0,0);let l=i?i.slice?i.slice():i:null;for(b({type:"rpc",op:String(e),args:JSON.parse(r||"{}"),data:l,ctl:T.buffer,buf:$.buffer});Atomics.wait(T,0,0,250),Atomics.load(T,0)===0;)if(c.interrupt[0]===2)return null;let p=Atomics.load(T,0),m=Atomics.load(T,1);if(p===3){f=m;continue}let x=$.slice(0,m);if(p===2)throw new Error(new TextDecoder().decode(x)||e+" に失敗しました");return{w:Atomics.load(T,2),h:Atomics.load(T,3),bytes:x,text:()=>new TextDecoder().decode(x)}}throw new Error(e+" の結果が大きすぎます")};self.__fc_image_canvas=e=>{let r=self.__fc_rpc("decode","{}",e);if(!r)return null;let i=new OffscreenCanvas(Math.max(1,r.w),Math.max(1,r.h));return i.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(r.bytes.buffer,0,r.w*r.h*4),r.w,r.h),0,0),i};self.__fc_ev_wait=e=>(w(!0),!c||!c.ectl?!1:(c.interrupt[0]!==0||Atomics.wait(c.ectl,0,0,Math.max(1,e)),!0));_e(self);var Fe=`import bdb, reprlib, inspect, types, sys, json, js, re as _re

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
`;function be(){let e=Atomics.load(c.dctl,1),r=new TextDecoder().decode(c.dbuf.slice(0,e));return Atomics.store(c.dctl,0,0),r}self.__fc_dbg_post=e=>{w(!0),b(JSON.parse(e))};self.__fc_dbg_wait=()=>{for(w(!0);;){if(Atomics.wait(c.dctl,0,0,250),Atomics.load(c.dctl,0)===1)return be();if(c.interrupt[0]===2)return c.interrupt[0]=0,'{"type":"stop"}'}};self.__fc_dbg_poll=()=>c&&Atomics.load(c.dctl,0)===1?be():"";function De(e,r=null){let i=u.FS,f=r?new Set(r):null;for(let a of[...D.keys()])if(!(a in e||f&&f.has(a))){try{i.unlink(J+"/"+a)}catch{}D.delete(a)}for(let[a,l]of Object.entries(e)){let p=J+"/"+a;i.mkdirTree(p.slice(0,p.lastIndexOf("/"))),i.writeFile(p,l),D.set(a,l)}}var Be=2e6,Ue=2e7;function Je(){let e=u.FS,r={},i=0,f=(a,l)=>{let p=[];try{p=e.readdir(a)}catch{return}for(let m of p){if(m==="."||m===".."||m==="__pycache__"||/\.pyc$/.test(m))continue;let x=a+"/"+m,P=l?l+"/"+m:m,S;try{S=e.stat(x)}catch{continue}if(e.isDir(S.mode)){f(x,P);continue}if(S.size>Ue||i>6e7)continue;let k;try{k=e.readFile(x)}catch{continue}let N=ae(k,m);typeof N=="string"&&N.length>Be||D.has(P)&&le(D.get(P),N)||(r[P]=typeof N=="string"?N:N.slice(),i+=S.size)}};f(J,"");for(let a of D.keys())try{e.stat(J+"/"+a)}catch{r[a]=null}return r}async function qe(e){let r=e.id;Ee=r,ge();let i=performance.now();try{await oe()}catch(k){w(!0),b({type:"done",id:r,ok:!1,reason:"load",error:"Python を読み込めませんでした: "+(k&&k.message||k)});return}c&&(c.interrupt[0]=0),ne.clear();let f=String(e.entry).startsWith("<"),a={...e.files||{}};f&&delete a[e.entry],De(a,Array.isArray(e.keep)?e.keep:null);let l=e.files[e.entry]??D.get(e.entry)??"",p=Object.fromEntries([...D].filter(([k,N])=>k.endsWith(".py")&&typeof N=="string"));f&&(p["__fc_entry__.py"]=l),await we(p,e.files["requirements.txt"]);let m=!0,x=null,P="done";try{u.globals.set("__fc_entry",e.entry),u.globals.set("__fc_src",l),u.globals.set("__fc_dbgopt",c&&e.debug?JSON.stringify(e.debug):null),u.globals.set("__fc_argv",Array.isArray(e.argv)&&e.argv.length?JSON.stringify(e.argv.map(String)):null),u.globals.set("__fc_cwd",e.cwd?String(e.cwd):null),u.runPython("__fc_chdir(__fc_cwd)"),u.runPython(c?"builtins.input = __fc_builtin_input":"builtins.input = __fc_no_input"),c&&Atomics.store(c.dctl,0,0);let k=u.runPython("__fc_run(__fc_entry, __fc_src, __fc_dbgopt, __fc_argv)");if(U)try{U.destroy()}catch{}U=u.runPython('__fc_last["g"]'),k&&(x=JSON.parse(k),x.type==="KeyboardInterrupt"?(P="stopped",x=null):x.type==="SystemExit"?(P="exit",x=null):(m=!1,P="error"));try{u.runPython("__fc_show_figures()")}catch{}}catch(k){m=!1,P="error";let N=String(k&&k.message||k);if(/fatal error|Aborted\(|out of memory|memory access out of bounds/i.test(N)){w(!0),b({type:"done",id:r,ok:!1,reason:"error",fatal:!0,error:{type:"MemoryError",message:"Python が止まりました (メモリが足りなくなった可能性があります)。Python を立ち上げ直します",text:N,frames:[]},files:{},ms:Math.round(performance.now()-i)});return}x={type:"Error",message:N,text:N,frames:[]}}w(!0);let S={};try{S=Je()}catch{}b({type:"done",id:r,ok:m,reason:P,error:x,files:S,ms:Math.round(performance.now()-i)})}var j=(e,r)=>{w(!0),b({type:"output",items:[{kind:e,text:r}]})};async function we(e,r){let i={req:[],opt:[]};try{i=JSON.parse(u.globals.get("__fc_imports")(JSON.stringify(e)))}catch{}for(let p of i.req)W[p]&&j("warn",W[p]);let f=i.req.filter(p=>!W[p]&&!fe.has(p));f.includes("zoneinfo")&&f.push("tzdata");try{let p=!1;await u.loadPackagesFromImports(f.map(m=>`import ${m}`).join(`
`),{messageCallback:m=>{/^Loading /.test(m)&&!p&&(p=!0,j("meta","ライブラリを読み込んでいます… (初回だけ時間がかかります)"))},errorCallback:m=>j("warn",m)})}catch(p){j("warn","ライブラリを読み込めませんでした (インターネットの接続を確認してください): "+(p&&p.message||p))}let a=[];for(let p of String(r||"").split(`
`)){let m=p.replace(/\s+#.*$|^#.*$/,"").trim();m&&!m.startsWith("-")&&!ue.has(m)&&a.push(m)}let l=[];try{l=JSON.parse(u.globals.get("__fc_missing")(JSON.stringify(f)))}catch{}l=l.filter(p=>!Q.has(p)),!(!a.length&&!l.length)&&await xe([...a,...l.map(p=>Y[p]||p)],{fromImports:l,reqs:a})}async function V(){if(!u.globals.get("__fc_has_micropip")){try{u.pyimport("micropip")}catch{await u.loadPackage(je("../../vendor/pywheels/"+Ie),{messageCallback:()=>{}})}u.pyimport("micropip"),u.globals.set("__fc_has_micropip",!0)}}async function xe(e,{fromImports:r=[],reqs:i=[],quiet:f=!1}={}){if(!e.length)return[];f||j("meta",`PyPI からライブラリを入れています: ${e.join(", ")} …`);let a=[];try{await V(),u.globals.set("__fc_pip_names",u.toPy(e));let l=await u.runPythonAsync(`
import micropip, json
_r = []
for _n in __fc_pip_names:
    try:
        await micropip.install(_n)
        _r.append([_n, None])
    except Exception as _e:
        _r.append([_n, str(_e).split("\\n")[0][:300]])
json.dumps(_r)`);for(let[m,x]of JSON.parse(l)){let P=r.find(S=>(Y[S]||S)===m);if(P&&Q.set(P,x||"ok"),i.includes(m)&&!x&&ue.add(m),x){a.push(m);let S=/Can't find a pure Python 3 wheel|No matching distribution|Can't fetch metadata|not found/i.test(x)?/pure Python/.test(x)?"ブラウザで動く形 (pure Python) が PyPI にないため":"PyPI に見つからないため":x;j("warn",`${m} を入れられませんでした (${S})`)}}let p=e.filter(m=>!a.includes(m));p.length&&!f&&j("meta",`入れました: ${p.join(", ")}`)}catch(l){for(let p of r)Q.set(p,String(l&&l.message||l));return j("warn","PyPI からライブラリを入れられませんでした (インターネットの接続を確認してください): "+String(l&&l.message||l).split(`
`).slice(-1)[0]),e}return a}async function Le(e){let r=/^\s*[%!]?\s*(?:python3?\s+-m\s+)?pip3?\s+(\w+)\s*(.*)$/s.exec(e);if(!r)return null;let[,i,f]=r,a=f.split(/\s+/).filter(l=>l&&!l.startsWith("-"));if(i==="install"){if(!a.length)return{ok:!1,error:"入れるライブラリの名前を書いてください (例: pip install emoji)"};let l=await xe(a);return l.length?{ok:!1,error:`入れられなかったもの: ${l.join(", ")}`}:{ok:!0,value:null}}if(i==="list"||i==="freeze"){await V();let l=await u.runPythonAsync(`import micropip
"\\n".join(sorted(f"{p.name}{'==' if ${i==="freeze"?"True":"False"} else ' '}{p.version}" for p in micropip.list().values()))`);return j("",String(l)),{ok:!0,value:null}}if(i==="uninstall")return await V(),u.globals.set("__fc_pip_names",u.toPy(a)),await u.runPythonAsync(`import micropip
micropip.uninstall(list(__fc_pip_names))`),j("meta",`外しました: ${a.join(", ")}`),{ok:!0,value:null};if(i==="show"){await V(),u.globals.set("__fc_pip_names",u.toPy(a));let l=await u.runPythonAsync(`import micropip
_l = micropip.list()
"\\n".join(f"Name: {_l[n].name}\\nVersion: {_l[n].version}\\nSource: {_l[n].source}" if n in _l else f"{n} は入っていません" for n in __fc_pip_names)`);return j("",String(l)),{ok:!0,value:null}}return{ok:!1,error:`pip ${i} はこの環境では使えません (install / list / show / uninstall が使えます)`}}function de(e){if(e==="repl-new"||e==="repl"&&!L){if(L)try{L.destroy()}catch{}L=u.runPython("__fc_new_ns()")}return e==="repl"||e==="repl-new"?L:(U||(U=u.runPython("__fc_new_ns()")),U)}async function $e(e){try{await oe()}catch(r){b({type:"evalResult",id:e.id,ok:!1,error:String(r.message||r)});return}c&&(c.interrupt[0]=0),ge();try{if(typeof e.complete=="string"){u.globals.set("__fc_g",de(e.ns)),u.globals.set("__fc_code",e.complete),u.globals.set("__fc_line",String(e.code||"")),b({type:"evalResult",id:e.id,ok:!0,names:JSON.parse(u.runPython("__fc_repl_names(__fc_code, __fc_g, __fc_line)"))});return}if(e.repl&&(u.globals.set("__fc_code",e.code),!u.runPython("__fc_repl_complete(__fc_code)"))){b({type:"evalResult",id:e.id,ok:!0,incomplete:!0});return}let r=await Le(e.code).catch(a=>({ok:!1,error:String(a&&a.message||a).split(`
`).slice(-1)[0]}));if(r){w(!0),b({type:"evalResult",id:e.id,...r});return}let i=de(e.ns);await we({"<console>.py":e.code}).catch(()=>{}),u.globals.set("__fc_g",i),u.globals.set("__fc_code",e.code);let f=JSON.parse(u.runPython("__fc_eval(__fc_code, __fc_g)"));w(!0);try{u.runPython("__fc_show_figures()")}catch{}f.ok?b({type:"evalResult",id:e.id,ok:!0,value:f.value,html:f.html||null}):b({type:"evalResult",id:e.id,ok:!1,etype:f.type,error:f.type==="KeyboardInterrupt"?"停止しました":f.error})}catch(r){w(!0),b({type:"evalResult",id:e.id,ok:!1,error:String(r&&r.message||r)})}}self.onmessage=e=>{let r=e.data;r&&(r.type==="init"?(r.interrupt&&r.ctl&&r.buf&&r.dctl&&r.dbuf&&(c={interrupt:new Int32Array(r.interrupt),ctl:new Int32Array(r.ctl),buf:new Uint8Array(r.buf),dctl:new Int32Array(r.dctl),dbuf:new Uint8Array(r.dbuf)},r.ectl&&r.ebuf&&(c.ectl=new Int32Array(r.ectl),c.ebuf=new Uint8Array(r.ebuf)),r.fack&&(c.fack=new Int32Array(r.fack))),oe().catch(i=>b({type:"status",state:"error",text:"Python を読み込めませんでした: "+(i&&i.message||i)}))):r.type==="run"?qe(r):r.type==="eval"?$e(r):r.type==="ping"&&b({type:"pong",id:r.id,ready:!!u}))};
