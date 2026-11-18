import{loadPyodide as N}from"../../vendor/pyodide/pyodide.mjs";var h="/home/pyodide/project",F="314.0.8",I=`https://cdn.jsdelivr.net/pyodide/v${F}/full/`,s=t=>self.postMessage(t),o=null,w=null,c=null,O=0,m=null,b=new Map,p=[],j=0,S=0,g=0,k=2e4,x={out:"",err:""},R={out:new TextDecoder,err:new TextDecoder};function u(t=!1){for(let e of["out","err"])x[e]&&(t||performance.now()-S>150)&&(E(e,x[e],!0),x[e]="");p.length&&(s({type:"output",items:p}),p=[]),j=performance.now()}function E(t,e,n=!1){if(g>=k){g===k&&(p.push({kind:"warn",text:`出力が ${k} 行を超えたため、以降は省略します`}),g++);return}g++,p.push({kind:t==="err"?"error-text":"",text:e,partial:n}),p.length>200&&u()}function P(t,e){let i=(x[t]+R[t].decode(e,{stream:!0})).split(`
`);x[t]=i.pop();for(let l of i)E(t,l);return S=performance.now(),p.length&&performance.now()-j>60&&(s({type:"output",items:p}),p=[],j=performance.now()),e.length}setInterval(()=>u(),80);async function v(){return o||(w||(w=(async()=>{s({type:"status",state:"loading",text:"Python を準備しています…"});let t=new URL("../../vendor/pyodide/",import.meta.url),e=t.protocol==="file:"?decodeURIComponent(t.pathname):t.href,n=await N({indexURL:e,lockFileURL:e+"pyodide-lock.json",packageBaseUrl:I,env:{HOME:"/home/pyodide",MPLBACKEND:"AGG",PYTHONUNBUFFERED:"1"}});return n.setStdout({write:i=>P("out",i)}),n.setStderr({write:i=>P("err",i)}),n.setStdin({stdin:A,isatty:!0}),c&&n.setInterruptBuffer(c.interrupt),n.FS.mkdirTree(h),n.runPython(D),o=n,s({type:"status",state:"ready",text:`Python ${n.runPython("import sys; sys.version.split()[0]")}`}),n})().catch(t=>{throw w=null,t})),w)}function A(){if(u(!0),!c)throw new Error("この環境では input() を使えません。ページを再読み込みしてからもう一度試してください (初回は再読み込みが必要です)");for(Atomics.store(c.ctl,0,0),s({type:"input"});;){let n=Atomics.wait(c.ctl,0,0,250);if(Atomics.load(c.ctl,0)!==0)break;if(n==="timed-out"&&c.interrupt[0]!==0)return s({type:"inputDone"}),null}let t=Atomics.load(c.ctl,0),e=Atomics.load(c.ctl,1);return s({type:"inputDone"}),t===2?null:new TextDecoder().decode(c.buf.slice(0,e))+`
`}var D=`
import sys, os, traceback, builtins, json, base64, io
__fc_builtin_input = builtins.input
__fc_project = ${JSON.stringify(h)}
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
`;self.__fc_image=t=>{u(!0),s({type:"image",data:t})};function T(t){let e=o.FS;for(let n of b.keys())if(!(n in t))try{e.unlink(h+"/"+n)}catch{}b=new Map;for(let[n,i]of Object.entries(t)){let l=h+"/"+n;e.mkdirTree(l.slice(0,l.lastIndexOf("/"))),e.writeFile(l,i),b.set(n,i)}}function U(){let t=o.FS,e={},n=(i,l)=>{let _=[];try{_=t.readdir(i)}catch{return}for(let a of _){if(a==="."||a===".."||a==="__pycache__")continue;let d=i+"/"+a,r=l?l+"/"+a:a,y;try{y=t.stat(d)}catch{continue}if(t.isDir(y.mode))n(d,r);else if(y.size<2e6&&/\.(py|txt|csv|json|md|tsv|log|html|xml|ya?ml|ini|cfg|toml)$/i.test(a)){let f;try{f=t.readFile(d,{encoding:"utf8"})}catch{continue}b.get(r)!==f&&(e[r]=f)}}};n(h,"");for(let i of b.keys())try{t.stat(h+"/"+i)}catch{e[i]=null}return e}async function B(t){let e=t.id;O=e,g=0;let n=performance.now();try{await v()}catch(r){u(!0),s({type:"done",id:e,ok:!1,reason:"load",error:"Python を読み込めませんでした: "+(r&&r.message||r)});return}c&&(c.interrupt[0]=0),T(t.files||{});let i=t.files[t.entry]??"";try{let r=Object.entries(t.files).filter(([f])=>f.endsWith(".py")).map(([,f])=>f).join(`
`),y=!1;await o.loadPackagesFromImports(r,{messageCallback:f=>{/^Loading /.test(f)&&!y&&(y=!0,u(!0),s({type:"output",items:[{kind:"meta",text:"ライブラリを読み込んでいます… (初回だけ時間がかかります)"}]}))},errorCallback:f=>s({type:"output",items:[{kind:"warn",text:f}]})}),/\bmatplotlib\b/.test(r)&&o.runPython("__fc_prepare_matplotlib()")}catch(r){s({type:"output",items:[{kind:"warn",text:"ライブラリを読み込めませんでした (インターネットの接続を確認してください): "+(r&&r.message||r)}]})}let l=!0,_=null,a="done";try{o.globals.set("__fc_entry",t.entry),o.globals.set("__fc_src",i),o.runPython("import os; os.chdir(__fc_project)"),o.runPython(c?"builtins.input = __fc_builtin_input":"builtins.input = __fc_no_input");let r=o.runPython("__fc_run(__fc_entry, __fc_src)");if(m)try{m.destroy()}catch{}m=o.runPython('__fc_last["g"]'),r&&(_=JSON.parse(r),_.type==="KeyboardInterrupt"?(a="stopped",_=null):_.type==="SystemExit"?(a="exit",_=null):(l=!1,a="error"));try{o.runPython("__fc_show_figures()")}catch{}}catch(r){l=!1,a="error",_={type:"Error",message:String(r&&r.message||r),text:String(r&&r.message||r),frames:[]}}u(!0);let d={};try{d=U()}catch{}s({type:"done",id:e,ok:l,reason:a,error:_,files:d,ms:Math.round(performance.now()-n)})}async function C(t){try{await v()}catch(e){s({type:"evalResult",id:t.id,ok:!1,error:String(e.message||e)});return}c&&(c.interrupt[0]=0);try{m||(m=o.runPython('{"__name__": "__main__", "__builtins__": __import__("builtins")}')),await o.loadPackagesFromImports(t.code).catch(()=>{}),o.globals.set("__fc_g",m),o.globals.set("__fc_code",t.code);let e=JSON.parse(o.runPython("__fc_eval(__fc_code, __fc_g)"));u(!0);try{o.runPython("__fc_show_figures()")}catch{}e.ok?s({type:"evalResult",id:t.id,ok:!0,value:e.value}):s({type:"evalResult",id:t.id,ok:!1,error:e.type==="KeyboardInterrupt"?"停止しました":e.error})}catch(e){u(!0),s({type:"evalResult",id:t.id,ok:!1,error:String(e&&e.message||e)})}}self.onmessage=t=>{let e=t.data;e&&(e.type==="init"?(e.interrupt&&e.ctl&&e.buf&&(c={interrupt:new Int32Array(e.interrupt),ctl:new Int32Array(e.ctl),buf:new Uint8Array(e.buf)}),v().catch(n=>s({type:"status",state:"error",text:"Python を読み込めませんでした: "+(n&&n.message||n)}))):e.type==="run"?B(e):e.type==="eval"&&C(e))};
