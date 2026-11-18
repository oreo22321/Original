import{loadPyodide as c}from"../../vendor/pyodide/pyodide.mjs";var p="/home/pyodide/project",l=["parso-0.8.6-py2.py3-none-any.whl","jedi-0.19.2-py2.py3-none-any.whl","pyflakes-4.1.0-py2.py3-none-any.whl","pycodestyle-2.15.0-py2.py3-none-any.whl","autopep8-2.3.2-py2.py3-none-any.whl"],a=o=>{let e=new URL(o,import.meta.url);return e.protocol==="file:"?decodeURIComponent(e.pathname):e.href};async function d(o){if(o.startsWith("/")&&typeof process<"u"&&process.versions&&process.versions.node){let t=await import("node:fs/promises");return new Uint8Array(await t.readFile(o))}let e=await fetch(o);if(!e.ok)throw new Error(`${o}: ${e.status}`);return new Uint8Array(await e.arrayBuffer())}var r=null,n=null;function f(){return n||(n=(async()=>{let o=a("../../vendor/pyodide/"),e=await c({indexURL:o,lockFileURL:o+"pyodide-lock.json",env:{HOME:"/home/pyodide"}});e.setStdout({batched:()=>{}}),e.setStderr({batched:()=>{}}),e.FS.mkdirTree(p),e.FS.mkdirTree("/tmp/wheels");for(let t of l)e.FS.writeFile("/tmp/wheels/"+t,await d(a("../../vendor/pywheels/"+t)));e.runPython(_),r=e;try{e.runPython("__fct_warm()")}catch{}return e})().catch(o=>{throw n=null,o})),n}var _=`
import sys, os, json, zipfile, site, importlib
PROJECT = ${JSON.stringify(p)}
_sp = site.getsitepackages()[0]
for _w in sorted(os.listdir("/tmp/wheels")):
    zipfile.ZipFile("/tmp/wheels/" + _w).extractall(_sp)
importlib.invalidate_caches()
if PROJECT not in sys.path:
    sys.path.insert(0, PROJECT)

def __fct_files(files):
    # プロジェクトのファイルを置く (jedi が他のファイルの中身も補完に使えるように)
    for path, text in files.items():
        full = os.path.join(PROJECT, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write(text)

def __fct_lint(code, path):
    out = []
    try:
        compile(code, path, "exec")
    except SyntaxError as e:
        out.append({"line": e.lineno or 1, "col": e.offset or 1, "endLine": getattr(e, "end_lineno", None), "endCol": getattr(e, "end_offset", None),
                    "msg": e.msg, "kind": type(e).__name__, "severity": "error", "text": (e.text or "").rstrip("\\n")})
        return json.dumps(out)
    except ValueError as e:
        out.append({"line": 1, "col": 1, "msg": str(e), "kind": "ValueError", "severity": "error"})
        return json.dumps(out)
    from pyflakes import api
    class R:
        def __init__(self): self.items = []
        def unexpectedError(self, f, msg): pass
        def syntaxError(self, f, msg, lineno, offset, text): pass
        def flake(self, m): self.items.append(m)
    r = R()
    api.check(code, path, r)
    for m in r.items:
        kind = type(m).__name__
        out.append({"line": m.lineno, "col": (m.col or 0) + 1, "kind": kind, "args": [str(a) for a in m.message_args], "msg": m.message % m.message_args})
    return json.dumps(out)

def __fct_script(code, path):
    import jedi
    return jedi.Script(code, path=os.path.join(PROJECT, path), project=jedi.Project(PROJECT))

def __fct_complete(code, line, col, path):
    out = []
    for c in __fct_script(code, path).complete(line, col)[:150]:
        out.append({"name": c.name, "type": c.type, "complete": c.complete, "desc": c.description})
    return json.dumps(out)

def __fct_doc(code, line, col, path, name):
    # 補完で選んでいる候補の説明
    for c in __fct_script(code, path).complete(line, col):
        if c.name == name:
            sig = ""
            try:
                sigs = c.get_signatures()
                if sigs:
                    sig = sigs[0].to_string()
            except Exception:
                pass
            return json.dumps({"sig": sig, "doc": c.docstring(raw=True)[:1500]})
    return json.dumps(None)

def __fct_signature(code, line, col, path):
    sigs = __fct_script(code, path).get_signatures(line, col)
    if not sigs:
        return json.dumps(None)
    s = sigs[0]
    return json.dumps({"name": s.name, "params": [p.to_string() for p in s.params], "index": s.index, "doc": s.docstring(raw=True)[:800]})

def __fct_help(code, line, col, path):
    sc = __fct_script(code, path)
    out = []
    for n in sc.help(line, col)[:2]:
        sig = ""
        try:
            sigs = n.get_signatures()
            if sigs:
                sig = sigs[0].to_string()
        except Exception:
            pass
        doc = n.docstring(raw=True)
        out.append({"name": n.name, "type": n.type, "sig": sig, "doc": doc[:1500], "module": n.module_name or ""})
    return json.dumps(out)

def __fct_goto(code, line, col, path):
    out = []
    for n in __fct_script(code, path).goto(line, col, follow_imports=True)[:5]:
        p = str(n.module_path) if n.module_path else ""
        rel = p[len(PROJECT) + 1:] if p.startswith(PROJECT + "/") else None
        out.append({"name": n.name, "file": rel, "line": n.line, "col": n.column, "builtin": n.in_builtin_module(), "module": n.module_name or ""})
    return json.dumps(out)

def __fct_format(code, aggressive):
    import autopep8
    return autopep8.fix_code(code, options={"aggressive": aggressive, "max_line_length": 120, "ignore": ["E501", "W6"]})

def __fct_warm():
    import jedi
    jedi.Script("import os\\nos.pa", path=os.path.join(PROJECT, "__warm__.py")).complete(2, 5)
`,s=(o,...e)=>{let t=r.globals.get(o);try{return t(...e)}finally{t.destroy()}};self.onmessage=async o=>{let e=o.data;if(!(!e||!e.id))try{if(await f(),e.files){let i=r.toPy(e.files);try{s("__fct_files",i)}finally{i.destroy()}}let t;switch(e.type){case"lint":t=JSON.parse(s("__fct_lint",e.code,e.path||"main.py"));break;case"complete":t=JSON.parse(s("__fct_complete",e.code,e.line,e.col,e.path||"main.py"));break;case"doc":t=JSON.parse(s("__fct_doc",e.code,e.line,e.col,e.path||"main.py",e.name));break;case"signature":t=JSON.parse(s("__fct_signature",e.code,e.line,e.col,e.path||"main.py"));break;case"help":t=JSON.parse(s("__fct_help",e.code,e.line,e.col,e.path||"main.py"));break;case"goto":t=JSON.parse(s("__fct_goto",e.code,e.line,e.col,e.path||"main.py"));break;case"format":t=s("__fct_format",e.code,e.aggressive?1:0);break;case"warm":t=!0;break;default:throw new Error("unknown request: "+e.type)}self.postMessage({id:e.id,ok:!0,result:t})}catch(t){self.postMessage({id:e.id,ok:!1,error:String(t&&t.message||t).split(`
`).slice(-3).join(`
`)})}};
