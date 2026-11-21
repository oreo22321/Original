import{c as le,d as fe}from"../chunks/chunk-OCXOK7H2.js";import{a as H,b as ce,c as _e,d as Y,e as W}from"../chunks/chunk-FZCGVVQG.js";import{loadPyodide as Pe}from"../../vendor/pyodide/pyodide.mjs";function pe(e){let t=new Map,i=new Map,l=1,a=typeof OffscreenCanvas=="function"?OffscreenCanvas:null,f=new Map,d=0,m=0,x=96,P=6e6,S=(n,s)=>{if(!a)throw new Error("この端末のブラウザでは pygame の画面を作れません (OffscreenCanvas に対応していません)");n=Math.max(1,n|0),s=Math.max(1,s|0);let r=f.get(n+"x"+s);if(r&&r.length){let o=r.pop();d--,m-=n*s;let p=o.getContext("2d");return p.setTransform(1,0,0,1,0,0),p.globalAlpha=1,p.globalCompositeOperation="source-over",p.clearRect(0,0,n,s),o}return new a(n,s)},k=n=>{let s=n.width*n.height;if(d>=x||m+s>P)return;let r=n.width+"x"+n.height;f.has(r)||f.set(r,[]),f.get(r).push(n),d++,m+=s},N=(n,s,r)=>{let o=n.getContext("2d",{willReadFrequently:!1});o.imageSmoothingEnabled=!1;let p=l++;return t.set(p,{c:n,x:o,v:0,clip:null,w:s,h:r}),p};e.__fc_pg_new=(n,s,r)=>{let o=S(n,s),p=N(o,n|0,s|0);if(!r){let u=t.get(p);u.x.fillStyle="#000",u.x.fillRect(0,0,o.width,o.height)}return p},e.__fc_pg_adopt=n=>N(n,n.width,n.height),e.__fc_pg_size=n=>{let s=t.get(n);return s?[s.w,s.h]:[0,0]},e.__fc_pg_count=()=>t.size,e.__fc_pg_reset=()=>{t.clear(),i.clear(),f.clear(),d=0,m=0};let F=(n,s)=>{if(!n.clip){s();return}n.x.save(),n.x.beginPath(),n.x.rect(n.clip[0],n.clip[1],n.clip[2],n.clip[3]),n.x.clip();try{s()}finally{n.x.restore()}},J={1:"lighter",2:"difference",3:"multiply",4:"darken",5:"lighten",6:"lighter",7:"difference",8:"multiply",9:"darken",10:"lighten"};function ke(n,s,r){let o=r.join(","),p=i.get(n);if(p&&p.v===s.v&&p.key===o)return p.c;p&&k(p.c);let u=S(s.c.width,s.c.height),h=u.getContext("2d"),g=s.x.getImageData(0,0,s.c.width,s.c.height),y=g.data,[v,A,E]=r;for(let I=0;I<y.length;I+=4)y[I]===v&&y[I+1]===A&&y[I+2]===E&&(y[I+3]=0);return h.putImageData(g,0,0),i.set(n,{v:s.v,key:o,c:u}),u}function Se(n){let s=t.get(n[1]);if(!s)return;let r=s.x;switch(n[0]){case"fill":{let[,,o,p,u,h]=n,g=p||[0,0,s.w,s.h];F(s,()=>{h&&J[h]?(r.save(),r.globalCompositeOperation=J[h],r.fillStyle=o,r.fillRect(g[0],g[1],g[2],g[3]),r.restore()):(u&&r.clearRect(g[0],g[1],g[2],g[3]),r.fillStyle=o,r.fillRect(g[0],g[1],g[2],g[3]))});break}case"rect":{let[,,o,p,u,h,g,y,v]=n;F(s,()=>{let A=v&&v.some(E=>E>0);y>0?(r.strokeStyle=o,r.lineWidth=y,A&&r.roundRect?(r.beginPath(),r.roundRect(p+y/2,u+y/2,Math.max(0,h-y),Math.max(0,g-y),[v[0],v[1],v[3],v[2]].map(E=>Math.max(0,E-y/2))),r.stroke()):r.strokeRect(p+y/2,u+y/2,Math.max(0,h-y),Math.max(0,g-y))):(r.fillStyle=o,A&&r.roundRect?(r.beginPath(),r.roundRect(p,u,h,g,[v[0],v[1],v[3],v[2]].map(E=>Math.max(0,E))),r.fill()):r.fillRect(p,u,h,g))});break}case"circle":{let[,,o,p,u,h,g]=n;F(s,()=>{r.beginPath(),g>0?(r.arc(p,u,Math.max(0,h-g/2),0,Math.PI*2),r.strokeStyle=o,r.lineWidth=g,r.stroke()):(r.arc(p,u,Math.max(0,h),0,Math.PI*2),r.fillStyle=o,r.fill())});break}case"ellipse":{let[,,o,p,u,h,g,y]=n;F(s,()=>{r.beginPath();let v=y>0?y/2:0;r.ellipse(p+h/2,u+g/2,Math.max(0,h/2-v),Math.max(0,g/2-v),0,0,Math.PI*2),y>0?(r.strokeStyle=o,r.lineWidth=y,r.stroke()):(r.fillStyle=o,r.fill())});break}case"arc":{let[,,o,p,u,h,g,y,v,A]=n;F(s,()=>{r.beginPath();let E=Math.max(1,A);r.ellipse(p+h/2,u+g/2,Math.max(0,h/2-E/2),Math.max(0,g/2-E/2),0,-y,-v,!0),r.strokeStyle=o,r.lineWidth=E,r.stroke()});break}case"line":{let[,,o,p,u,h,g,y]=n;F(s,()=>{r.beginPath(),r.moveTo(p+.5,u+.5),r.lineTo(h+.5,g+.5),r.strokeStyle=o,r.lineWidth=Math.max(1,y),r.lineCap=y>2?"butt":"square",r.stroke()});break}case"lines":case"poly":{let o=n[2],p=n[0]==="poly"?!0:n[3],u=n[0]==="poly"?n[3]:n[4],h=n[0]==="poly"?n[4]:n[5];if(u.length<4)break;F(s,()=>{r.beginPath();let g=n[0]==="poly"&&!(h>0)?0:.5;for(let y=0;y<u.length;y+=2)y?r.lineTo(u[y]+g,u[y+1]+g):r.moveTo(u[y]+g,u[y+1]+g);p&&r.closePath(),n[0]==="poly"&&!(h>0)?(r.fillStyle=o,r.fill()):(r.strokeStyle=o,r.lineWidth=Math.max(1,h),r.lineJoin="miter",r.stroke())});break}case"blit":{let[,,o,p,u,h,g,y,v,A,E,I]=n,K=t.get(o);if(!K||y<=0||v<=0)break;let Ne=E?ke(o,K,E):K.c;F(s,()=>{let ae=A>=0&&A<255||I&&J[I];ae&&(r.save(),A>=0&&A<255&&(r.globalAlpha=A/255),I&&J[I]&&(r.globalCompositeOperation=J[I])),r.drawImage(Ne,h,g,y,v,p,u,y,v),ae&&r.restore()});break}case"text":{let[,,o,p,u,h,g,y,v]=n;if(y&&(r.fillStyle=y,r.fillRect(0,0,s.w,s.h)),r.font=o,r.textBaseline="alphabetic",r.fillStyle=g,r.fillText(p,u,h),v){let A=r.measureText(p);r.fillRect(u,h+2,A.width,Math.max(1,Math.round(s.h/18)))}break}case"pix":{r.save(),r.clearRect(n[2],n[3],1,1),r.fillStyle=n[4],r.fillRect(n[2],n[3],1,1),r.restore();break}case"clip":s.clip=n[2]||null;return;case"copy":{let o=t.get(n[2]);o&&(r.clearRect(0,0,s.w,s.h),r.drawImage(o.c,0,0));break}case"scale":{let o=t.get(n[2]);if(!o)break;r.save(),r.imageSmoothingEnabled=!!n[3],n[3]&&(r.imageSmoothingQuality="high"),r.clearRect(0,0,s.w,s.h),r.drawImage(o.c,0,0,o.w,o.h,0,0,s.w,s.h),r.restore();break}case"rot":{let o=t.get(n[2]);if(!o)break;r.save(),r.imageSmoothingEnabled=!!n[5],r.clearRect(0,0,s.w,s.h),r.translate(s.w/2,s.h/2),r.rotate(-n[3]*Math.PI/180),r.scale(n[4],n[4]),r.drawImage(o.c,-o.w/2,-o.h/2),r.restore();break}case"flip":{let o=t.get(n[2]);if(!o)break;r.save(),r.clearRect(0,0,s.w,s.h),r.translate(n[3]?s.w:0,n[4]?s.h:0),r.scale(n[3]?-1:1,n[4]?-1:1),r.drawImage(o.c,0,0),r.restore();break}case"scroll":{let o=S(s.w,s.h);o.getContext("2d").drawImage(s.c,0,0),r.drawImage(o,n[2],n[3]),k(o);break}case"gray":{let o=t.get(n[2]);if(!o)break;let p=o.x.getImageData(0,0,o.w||1,o.h||1),u=p.data;for(let h=0;h<u.length;h+=4){let g=Math.round(.299*u[h]+.587*u[h+1]+.114*u[h+2]);u[h]=u[h+1]=u[h+2]=g}r.putImageData(p,0,0);break}case"free":{t.delete(n[1]);let o=i.get(n[1]);o&&k(o.c),i.delete(n[1]),k(s.c);return}}s.v++}e.__fc_pg_exec=n=>{let s=JSON.parse(n);for(let r of s)try{Se(r)}catch{}},e.__fc_pg_pixels=(n,s,r,o,p)=>{let u=t.get(n);return!u||o<=0||p<=0?new Uint8Array(0):new Uint8Array(u.x.getImageData(s,r,o,p).data.buffer)},e.__fc_pg_put=(n,s,r,o,p,u)=>{let h=t.get(n);if(!h)return;let g=s instanceof Uint8ClampedArray?s:new Uint8ClampedArray(s.buffer?s.buffer.slice(s.byteOffset,s.byteOffset+s.byteLength):s);h.x.putImageData(new ImageData(g,p,u),r,o),h.v++};let X=a?new a(1,1).getContext("2d"):null;e.__fc_pg_measure=(n,s)=>{if(!X)return[s.length*8,12,4];X.font=n;let r=X.measureText(s),o=r.fontBoundingBoxAscent!==void 0?r.fontBoundingBoxAscent:r.actualBoundingBoxAscent,p=r.fontBoundingBoxDescent!==void 0?r.fontBoundingBoxDescent:r.actualBoundingBoxDescent;return[r.width,o||0,p||0]},e.__fc_pg_font=(n,s)=>{try{if(typeof FontFace!="function"||!e.fonts)return!1;let r=s instanceof Uint8Array?s.slice():new Uint8Array(s),o=new FontFace(n,r.buffer);return e.fonts.add(o),o.load().catch(()=>{}),!0}catch{return!1}},e.__fc_pg_present=(n,s,r)=>{let o=t.get(n);o&&e.__fc_present(s,o.c,r)}}var q="/home/pyodide/project",Ae="314.0.8",Ee=`https://cdn.jsdelivr.net/pyodide/v${Ae}/full/`,Ie="micropip-0.11.1-py3-none-any.whl",b=(e,t)=>t?self.postMessage(e,t):self.postMessage(e),_=null,G=null,c=null,je=0,U=null,L=null,D=new Map,Z=!1,Te=e=>{let t=new URL(e,import.meta.url);return t.protocol==="file:"?decodeURIComponent(t.pathname):t.href},Q=new Map,me=new Set,C=[],ee=0,ge=0,se=2e4,Ce=2,M=se,te=0,B=0,Fe=65536,O={out:"",err:""},Me={out:new TextDecoder,err:new TextDecoder};function oe(){M=se,te=performance.now(),B=0,R=[]}var R=[];function he(){if(!B)return;let e=B-R.length;e>0&&C.push({kind:"warn",text:`… 出力がとても多いため ${e.toLocaleString()} 行を省略しました`});for(let t of R)C.push(t);M-=R.length,R=[],B=0}function w(e=!1){for(let t of["out","err"])O[t]&&(e||performance.now()-ge>150)&&(re(t,O[t],!0),O[t]="");B&&(e||M>200)&&he(),C.length&&(b({type:"output",items:C}),C=[]),ee=performance.now()}function re(e,t,i=!1){let l=performance.now();M=Math.min(se,M+(l-te)*Ce),te=l;let a={kind:e==="err"?"error-text":"",text:t,partial:i};if(M<1||B&&M<200){B++,R.push(a),R.length>100&&R.shift();return}M--,B&&he(),C.push(a),C.length>200&&w()}function de(e,t){let l=(O[e]+Me[e].decode(t,{stream:!0})).split(`
`);O[e]=l.pop();for(let a of l)re(e,a);return O[e].length>Fe&&(re(e,O[e],!0),O[e]=""),ge=performance.now(),C.length&&performance.now()-ee>60&&(b({type:"output",items:C}),C=[],ee=performance.now()),t.length}setInterval(()=>w(),80);async function ie(){return _||(G||(G=(async()=>{b({type:"status",state:"loading",text:"Python を準備しています…"});let e=new URL("../../vendor/pyodide/",import.meta.url),t=e.protocol==="file:"?decodeURIComponent(e.pathname):e.href,i=await Pe({indexURL:t,lockFileURL:t+"pyodide-lock.json",packageBaseUrl:Ee,env:{HOME:"/home/pyodide",MPLBACKEND:"AGG",PYTHONUNBUFFERED:"1"}});i.setStdout({write:l=>de("out",l)}),i.setStderr({write:l=>de("err",l)}),i.setStdin({stdin:Oe,isatty:!0}),c&&i.setInterruptBuffer(c.interrupt),i.FS.mkdirTree(q);for(let[l,a]of Object.entries(_e())){let f=H+"/"+l;i.FS.mkdirTree(f.slice(0,f.lastIndexOf("/"))),i.FS.writeFile(f,a)}return i.globals.set("__fc_dbg_src",De),i.runPython(Re),_=i,b({type:"status",state:"ready",text:`Python ${i.runPython("import sys; sys.version.split()[0]")}`}),i})().catch(e=>{throw G=null,e})),G)}function Oe(){if(w(!0),!c)throw new Error("この環境では input() を使えません。ページを再読み込みしてからもう一度試してください (初回は再読み込みが必要です)");for(Atomics.store(c.ctl,0,0),b({type:"input",password:Z}),Z=!1;;){let i=Atomics.wait(c.ctl,0,0,250);if(Atomics.load(c.ctl,0)!==0)break;if(i==="timed-out"&&c.interrupt[0]===2)return b({type:"inputDone"}),null}let e=Atomics.load(c.ctl,0),t=Atomics.load(c.ctl,1);return b({type:"inputDone"}),e===2?null:new TextDecoder().decode(c.buf.slice(0,t))+`
`}var Re=`
import sys, os, traceback, builtins, json, base64, io
__fc_builtin_input = builtins.input
__fc_project = ${JSON.stringify(q)}
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
`;self.__fc_image=(e,t)=>{w(!0),b({type:"image",data:e,key:t||null})};self.__fc_svg=e=>{w(!0),b({type:"image",data:btoa(unescape(encodeURIComponent(String(e)))),mime:"image/svg+xml"})};self.__fc_html=(e,t)=>{w(!0),b({type:"html",html:String(e).slice(0,4e5),text:String(t||"")})};self.__fc_event=(e,t)=>{w(!0),b({type:"event",kind:String(e),data:String(t)})};self.__fc_meta=e=>{w(!0),b({type:"output",items:[{kind:"meta",text:String(e)}]})};self.__fc_link=e=>{w(!0),b({type:"link",url:String(e)})};self.__fc_password=()=>{Z=!0};self.__fc_turtle=e=>{w(!0),b({type:"turtle",ops:e})};self.__fc_sleep=e=>(w(!0),c?(Atomics.wait(c.interrupt,0,0,Math.max(0,e*1e3)),!0):!1);self.__fc_ev_ok=()=>!!(c&&c.ectl);self.__fc_ev_poll=()=>{if(!c||!c.ectl||Atomics.load(c.ectl,0)!==1)return"";let e=Atomics.load(c.ectl,1),t=new TextDecoder().decode(c.ebuf.slice(0,e));return Atomics.store(c.ectl,0,0),b({type:"evTaken"}),t};var z=0;function ye(){if(!c||!c.fack)return;let e=performance.now();for(;;){let t=Atomics.load(c.fack,0);if(z-t<=2||c.interrupt[0]!==0||performance.now()-e>150)return;Atomics.wait(c.fack,0,t,20)}}self.__fc_frame=(e,t,i,l,a,f)=>{w(!0);let d,m=l.getBuffer("u8");try{d=new Uint8ClampedArray(m.data)}finally{m.release()}z++,b({type:"frame",key:String(e),w:t,h:i,data:d,scale:Number(a)||1,title:String(f||""),seq:z},[d.buffer]),ye()};var ne=new Map;self.__fc_present=(e,t,i)=>{w(!0);let l=t.width,a=t.height,f=ne.get(e);(!f||f.width!==l||f.height!==a)&&(f=new OffscreenCanvas(l,a),ne.set(e,f)),f.getContext("2d").drawImage(t,0,0);let m=f.transferToImageBitmap();z++,b({type:"frame",key:String(e),w:l,h:a,bitmap:m,scale:1,title:String(i||""),seq:z,kind:"pg"},[m]),ye()};self.__fc_surface=e=>{w(!0),b({type:"surface",...JSON.parse(e)})};self.__fc_tk=e=>{w(!0),b({type:"tk",ops:e})};self.__fc_sound=(e,t)=>{let i=JSON.parse(e),l=null;t&&(l=t instanceof Uint8Array?t.slice():null),b({type:"sound",...i,data:l},l?[l.buffer]:void 0)};var T=null,$=null;self.__fc_rpc=(e,t,i)=>{if(w(!0),!c)throw new Error("この機能を使うには、ページを再読み込みしてください (はじめて開いたときは再読み込みが必要です)");T||(T=new Int32Array(new SharedArrayBuffer(16)));let l=1<<20;for(let a=0;a<3;a++){(!$||$.length<l)&&($=new Uint8Array(new SharedArrayBuffer(l))),Atomics.store(T,0,0);let f=i?i.slice?i.slice():i:null;for(b({type:"rpc",op:String(e),args:JSON.parse(t||"{}"),data:f,ctl:T.buffer,buf:$.buffer});Atomics.wait(T,0,0,250),Atomics.load(T,0)===0;)if(c.interrupt[0]===2)return null;let d=Atomics.load(T,0),m=Atomics.load(T,1);if(d===3){l=m;continue}let x=$.slice(0,m);if(d===2)throw new Error(new TextDecoder().decode(x)||e+" に失敗しました");return{w:Atomics.load(T,2),h:Atomics.load(T,3),bytes:x,text:()=>new TextDecoder().decode(x)}}throw new Error(e+" の結果が大きすぎます")};self.__fc_image_canvas=e=>{let t=self.__fc_rpc("decode","{}",e);if(!t)return null;let i=new OffscreenCanvas(Math.max(1,t.w),Math.max(1,t.h));return i.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(t.bytes.buffer,0,t.w*t.h*4),t.w,t.h),0,0),i};self.__fc_ev_wait=e=>(w(!0),!c||!c.ectl?!1:(c.interrupt[0]!==0||Atomics.wait(c.ectl,0,0,Math.max(1,e)),!0));pe(self);var De=`import bdb, reprlib, inspect, types, sys, json, js, re as _re

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
`;function be(){let e=Atomics.load(c.dctl,1),t=new TextDecoder().decode(c.dbuf.slice(0,e));return Atomics.store(c.dctl,0,0),t}self.__fc_dbg_post=e=>{w(!0),b(JSON.parse(e))};self.__fc_dbg_wait=()=>{for(w(!0);;){if(Atomics.wait(c.dctl,0,0,250),Atomics.load(c.dctl,0)===1)return be();if(c.interrupt[0]===2)return c.interrupt[0]=0,'{"type":"stop"}'}};self.__fc_dbg_poll=()=>c&&Atomics.load(c.dctl,0)===1?be():"";function Be(e,t=null){let i=_.FS,l=t?new Set(t):null;for(let a of[...D.keys()])if(!(a in e||l&&l.has(a))){try{i.unlink(q+"/"+a)}catch{}D.delete(a)}for(let[a,f]of Object.entries(e)){let d=q+"/"+a;i.mkdirTree(d.slice(0,d.lastIndexOf("/"))),i.writeFile(d,f),D.set(a,f)}}var Ue=2e6,qe=2e7;function we(){let e=_.FS,t={},i=0,l=(a,f)=>{let d=[];try{d=e.readdir(a)}catch{return}for(let m of d){if(m==="."||m===".."||m==="__pycache__"||/\.pyc$/.test(m))continue;let x=a+"/"+m,P=f?f+"/"+m:m,S;try{S=e.stat(x)}catch{continue}if(e.isDir(S.mode)){l(x,P);continue}if(S.size>qe||i>6e7)continue;let k;try{k=e.readFile(x)}catch{continue}let N=le(k,m);typeof N=="string"&&N.length>Ue||D.has(P)&&fe(D.get(P),N)||(t[P]=typeof N=="string"?N:N.slice(),i+=S.size)}};l(q,"");for(let a of D.keys())try{e.stat(q+"/"+a)}catch{t[a]=null}return t}async function Je(e){let t=e.id;je=t,oe();let i=performance.now();try{await ie()}catch(k){w(!0),b({type:"done",id:t,ok:!1,reason:"load",error:"Python を読み込めませんでした: "+(k&&k.message||k)});return}c&&(c.interrupt[0]=0),ne.clear();let l=String(e.entry).startsWith("<"),a={...e.files||{}};l&&delete a[e.entry],Be(a,Array.isArray(e.keep)?e.keep:null);let f=e.files[e.entry]??D.get(e.entry)??"",d=Object.fromEntries([...D].filter(([k,N])=>k.endsWith(".py")&&typeof N=="string"));l&&(d["__fc_entry__.py"]=f),await xe(d,e.files["requirements.txt"]);let m=!0,x=null,P="done";try{_.globals.set("__fc_entry",e.entry),_.globals.set("__fc_src",f),_.globals.set("__fc_dbgopt",c&&e.debug?JSON.stringify(e.debug):null),_.globals.set("__fc_argv",Array.isArray(e.argv)&&e.argv.length?JSON.stringify(e.argv.map(String)):null),_.globals.set("__fc_cwd",e.cwd?String(e.cwd):null),_.runPython("__fc_chdir(__fc_cwd)"),_.runPython(c?"builtins.input = __fc_builtin_input":"builtins.input = __fc_no_input"),c&&Atomics.store(c.dctl,0,0);let k=_.runPython("__fc_run(__fc_entry, __fc_src, __fc_dbgopt, __fc_argv)");if(U)try{U.destroy()}catch{}U=_.runPython('__fc_last["g"]'),k&&(x=JSON.parse(k),x.type==="KeyboardInterrupt"?(P="stopped",x=null):x.type==="SystemExit"?(P="exit",x=null):(m=!1,P="error"));try{_.runPython("__fc_show_figures()")}catch{}}catch(k){m=!1,P="error";let N=String(k&&k.message||k);if(/fatal error|Aborted\(|out of memory|memory access out of bounds/i.test(N)){w(!0),b({type:"done",id:t,ok:!1,reason:"error",fatal:!0,error:{type:"MemoryError",message:"Python が止まりました (メモリが足りなくなった可能性があります)。Python を立ち上げ直します",text:N,frames:[]},files:{},ms:Math.round(performance.now()-i)});return}x={type:"Error",message:N,text:N,frames:[]}}w(!0);let S={};try{S=we()}catch{}b({type:"done",id:t,ok:m,reason:P,error:x,files:S,ms:Math.round(performance.now()-i)})}function Le(e){let t=(i,l)=>b({type:"webResult",id:e.id,head:{status:i,headers:[["Content-Type","text/plain; charset=utf-8"]]},body:new TextEncoder().encode(l)});if(!_){t(503,"Python の準備ができていません");return}try{oe(),c&&(c.interrupt[0]=0),_.FS.writeFile("/tmp/fcweb_req",e.body?new Uint8Array(e.body):new Uint8Array(0)),_.globals.set("__fc_web_req",JSON.stringify(e.req));let i=JSON.parse(_.runPython(`import _fcweb
_fcweb.handle(__fc_web_req)`)),l=_.FS.readFile("/tmp/fcweb_body");w(!0),b({type:"webResult",id:e.id,head:i,body:l},[l.buffer]);let a={};try{a=we()}catch{}Object.keys(a).length&&b({type:"webFiles",files:a})}catch(i){w(!0),t(500,String(i&&i.message||i))}}var j=(e,t)=>{w(!0),b({type:"output",items:[{kind:e,text:t}]})};async function xe(e,t){let i={req:[],opt:[]};try{i=JSON.parse(_.globals.get("__fc_imports")(JSON.stringify(e)))}catch{}for(let d of i.req)W[d]&&j("warn",W[d]);let l=i.req.filter(d=>!W[d]&&!ce.has(d));l.includes("zoneinfo")&&l.push("tzdata");try{let d=!1;await _.loadPackagesFromImports(l.map(m=>`import ${m}`).join(`
`),{messageCallback:m=>{/^Loading /.test(m)&&!d&&(d=!0,j("meta","ライブラリを読み込んでいます… (初回だけ時間がかかります)"))},errorCallback:m=>j("warn",m)})}catch(d){j("warn","ライブラリを読み込めませんでした (インターネットの接続を確認してください): "+(d&&d.message||d))}let a=[];for(let d of String(t||"").split(`
`)){let m=d.replace(/\s+#.*$|^#.*$/,"").trim();m&&!m.startsWith("-")&&!me.has(m)&&a.push(m)}let f=[];try{f=JSON.parse(_.globals.get("__fc_missing")(JSON.stringify(l)))}catch{}f=f.filter(d=>!Q.has(d)),!(!a.length&&!f.length)&&await ve([...a,...f.map(d=>Y[d]||d)],{fromImports:f,reqs:a})}async function V(){if(!_.globals.get("__fc_has_micropip")){try{_.pyimport("micropip")}catch{await _.loadPackage(Te("../../vendor/pywheels/"+Ie),{messageCallback:()=>{}})}_.pyimport("micropip"),_.globals.set("__fc_has_micropip",!0)}}async function ve(e,{fromImports:t=[],reqs:i=[],quiet:l=!1}={}){if(!e.length)return[];l||j("meta",`PyPI からライブラリを入れています: ${e.join(", ")} …`);let a=[];try{await V(),_.globals.set("__fc_pip_names",_.toPy(e));let f=await _.runPythonAsync(`
import micropip, json
_r = []
for _n in __fc_pip_names:
    try:
        await micropip.install(_n)
        _r.append([_n, None])
    except Exception as _e:
        _r.append([_n, str(_e).split("\\n")[0][:300]])
json.dumps(_r)`);for(let[m,x]of JSON.parse(f)){let P=t.find(S=>(Y[S]||S)===m);if(P&&Q.set(P,x||"ok"),i.includes(m)&&!x&&me.add(m),x){a.push(m);let S=/Can't find a pure Python 3 wheel|No matching distribution|Can't fetch metadata|not found/i.test(x)?/pure Python/.test(x)?"ブラウザで動く形 (pure Python) が PyPI にないため":"PyPI に見つからないため":x;j("warn",`${m} を入れられませんでした (${S})`)}}let d=e.filter(m=>!a.includes(m));d.length&&!l&&j("meta",`入れました: ${d.join(", ")}`)}catch(f){for(let d of t)Q.set(d,String(f&&f.message||f));return j("warn","PyPI からライブラリを入れられませんでした (インターネットの接続を確認してください): "+String(f&&f.message||f).split(`
`).slice(-1)[0]),e}return a}async function $e(e){let t=/^\s*[%!]?\s*(?:python3?\s+-m\s+)?pip3?\s+(\w+)\s*(.*)$/s.exec(e);if(!t)return null;let[,i,l]=t,a=l.split(/\s+/).filter(f=>f&&!f.startsWith("-"));if(i==="install"){if(!a.length)return{ok:!1,error:"入れるライブラリの名前を書いてください (例: pip install emoji)"};let f=await ve(a);return f.length?{ok:!1,error:`入れられなかったもの: ${f.join(", ")}`}:{ok:!0,value:null}}if(i==="list"||i==="freeze"){await V();let f=await _.runPythonAsync(`import micropip
"\\n".join(sorted(f"{p.name}{'==' if ${i==="freeze"?"True":"False"} else ' '}{p.version}" for p in micropip.list().values()))`);return j("",String(f)),{ok:!0,value:null}}if(i==="uninstall")return await V(),_.globals.set("__fc_pip_names",_.toPy(a)),await _.runPythonAsync(`import micropip
micropip.uninstall(list(__fc_pip_names))`),j("meta",`外しました: ${a.join(", ")}`),{ok:!0,value:null};if(i==="show"){await V(),_.globals.set("__fc_pip_names",_.toPy(a));let f=await _.runPythonAsync(`import micropip
_l = micropip.list()
"\\n".join(f"Name: {_l[n].name}\\nVersion: {_l[n].version}\\nSource: {_l[n].source}" if n in _l else f"{n} は入っていません" for n in __fc_pip_names)`);return j("",String(f)),{ok:!0,value:null}}return{ok:!1,error:`pip ${i} はこの環境では使えません (install / list / show / uninstall が使えます)`}}function ue(e){if(e==="repl-new"||e==="repl"&&!L){if(L)try{L.destroy()}catch{}L=_.runPython("__fc_new_ns()")}return e==="repl"||e==="repl-new"?L:(U||(U=_.runPython("__fc_new_ns()")),U)}async function ze(e){try{await ie()}catch(t){b({type:"evalResult",id:e.id,ok:!1,error:String(t.message||t)});return}c&&(c.interrupt[0]=0),oe();try{if(typeof e.complete=="string"){_.globals.set("__fc_g",ue(e.ns)),_.globals.set("__fc_code",e.complete),_.globals.set("__fc_line",String(e.code||"")),b({type:"evalResult",id:e.id,ok:!0,names:JSON.parse(_.runPython("__fc_repl_names(__fc_code, __fc_g, __fc_line)"))});return}if(e.repl&&(_.globals.set("__fc_code",e.code),!_.runPython("__fc_repl_complete(__fc_code)"))){b({type:"evalResult",id:e.id,ok:!0,incomplete:!0});return}let t=await $e(e.code).catch(a=>({ok:!1,error:String(a&&a.message||a).split(`
`).slice(-1)[0]}));if(t){w(!0),b({type:"evalResult",id:e.id,...t});return}let i=ue(e.ns);await xe({"<console>.py":e.code}).catch(()=>{}),_.globals.set("__fc_g",i),_.globals.set("__fc_code",e.code);let l=JSON.parse(_.runPython("__fc_eval(__fc_code, __fc_g)"));w(!0);try{_.runPython("__fc_show_figures()")}catch{}l.ok?b({type:"evalResult",id:e.id,ok:!0,value:l.value,html:l.html||null}):b({type:"evalResult",id:e.id,ok:!1,etype:l.type,error:l.type==="KeyboardInterrupt"?"停止しました":l.error})}catch(t){w(!0),b({type:"evalResult",id:e.id,ok:!1,error:String(t&&t.message||t)})}}self.onmessage=e=>{let t=e.data;t&&(t.type==="init"?(t.interrupt&&t.ctl&&t.buf&&t.dctl&&t.dbuf&&(c={interrupt:new Int32Array(t.interrupt),ctl:new Int32Array(t.ctl),buf:new Uint8Array(t.buf),dctl:new Int32Array(t.dctl),dbuf:new Uint8Array(t.dbuf)},t.ectl&&t.ebuf&&(c.ectl=new Int32Array(t.ectl),c.ebuf=new Uint8Array(t.ebuf)),t.fack&&(c.fack=new Int32Array(t.fack))),ie().catch(i=>b({type:"status",state:"error",text:"Python を読み込めませんでした: "+(i&&i.message||i)}))):t.type==="run"?Je(t):t.type==="eval"?ze(t):t.type==="ping"?b({type:"pong",id:t.id,ready:!!_}):t.type==="web"&&Le(t))};
