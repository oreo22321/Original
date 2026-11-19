// Python のエディタ機能用の Web Worker (実行用とは別の Python)
// ・エラーチェック: 構文エラー (compile) + pyflakes (定義されていない名前・使っていない import など)
// ・補完・引数のヒント・説明・定義へ移動: jedi
// ・整形: autopep8
// 実行中のプログラムとは別のワーカーなので、プログラムが動いていても補完やチェックは止まりません
// ライブラリはアプリに同梱 (vendor/pywheels)。オフラインでも使えます
// ・import したライブラリ (numpy / pandas / PyPI のもの) は、中の .py / .pyi だけを取り出して補完に使います (読み込みはしないので軽い)
// ・実行前に分かる間違いのチェック: py-check.js / import の候補 (自動で import を足す)
import { loadPyodide } from '../../vendor/pyodide/pyodide.mjs'
import { ANALYSIS } from './py-analysis.js'
import { CHECK } from './py-check.js'
import { runtimeFiles, FC_LIB } from './py-runtime.js'
import { TURTLE } from './py-turtle.js'
import { PIP_NAMES, NO_PIP, PYODIDE_CDN } from './py-packages.js'

const PROJECT = '/home/pyodide/project'
const WHEELS = ['parso-0.8.6-py2.py3-none-any.whl', 'jedi-0.19.2-py2.py3-none-any.whl', 'pyflakes-4.1.0-py2.py3-none-any.whl', 'pycodestyle-2.15.0-py2.py3-none-any.whl', 'autopep8-2.3.2-py2.py3-none-any.whl']

const local = rel => {
  const u = new URL(rel, import.meta.url)
  return u.protocol === 'file:' ? decodeURIComponent(u.pathname) : u.href
}
async function bytes(url) {
  if (url.startsWith('/') && typeof process !== 'undefined' && process.versions && process.versions.node) {
    const fs = await import('node:fs/promises')
    return new Uint8Array(await fs.readFile(url))
  }
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

let py = null, ready = null
function ensure() {
  if (!ready) {
    ready = (async () => {
      const base = local('../../vendor/pyodide/')
      const p = await loadPyodide({ indexURL: base, lockFileURL: base + 'pyodide-lock.json', env: { HOME: '/home/pyodide' } })
      p.setStdout({ batched: () => {} })
      p.setStderr({ batched: () => {} })
      p.FS.mkdirTree(PROJECT)
      p.FS.mkdirTree('/tmp/wheels')
      for (const w of WHEELS) p.FS.writeFile('/tmp/wheels/' + w, await bytes(local('../../vendor/pywheels/' + w)))
      // 実行用と同じ turtle などを置く (補完・チェックで使う)
      for (const [rel, src] of Object.entries(runtimeFiles(TURTLE))) {
        const full = FC_LIB + '/' + rel
        p.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')))
        p.FS.writeFile(full, src)
      }
      p.runPython(TOOLS)
      p.runPython(ANALYSIS)
      p.runPython(CHECK)
      py = p
      // jedi の初回は遅いので、先に一度動かしておく
      try { p.runPython('__fct_warm()') } catch {}
      return p
    })().catch(e => { ready = null; throw e })
  }
  return ready
}

const TOOLS = `
import sys, os, json, zipfile, site, importlib, builtins
PROJECT = ${JSON.stringify(PROJECT)}
_sp = site.getsitepackages()[0]
for _w in sorted(os.listdir("/tmp/wheels")):
    zipfile.ZipFile("/tmp/wheels/" + _w).extractall(_sp)
importlib.invalidate_caches()
if PROJECT not in sys.path:
    sys.path.insert(0, PROJECT)
if ${JSON.stringify(FC_LIB)} not in sys.path:
    sys.path.insert(1, ${JSON.stringify(FC_LIB)})
sys.dont_write_bytecode = True
# 実行する環境にある組み込みの関数 (display) を、チェックと補完でも知っておく
def display(*objs, **kwargs):
    """表 (pandas)・画像 (PIL・matplotlib の図) などを、出力に見やすく表示します"""
builtins.display = display

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
    try:
        out.extend(__fct_check(code))
    except Exception:
        pass
    return json.dumps(out)

# ---- ライブラリ (補完用に .py / .pyi だけ取り出す) ----
def __fct_need(names_json):
    import importlib.util
    out = []
    for n in json.loads(names_json):
        if n in sys.stdlib_module_names or n in sys.builtin_module_names:
            continue
        try:
            if importlib.util.find_spec(n) is not None:
                continue
        except Exception:
            pass
        out.append(n)
    return json.dumps(out)

def __fct_extract(path):
    n = 0
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            name = info.filename
            if not name.endswith((".py", ".pyi", "/py.typed")) or ".dist-info/" in name or ".data/" in name:
                continue
            if "/tests/" in name or "/testing/" in name or "/_tests/" in name:
                continue
            z.extract(info, _sp)
            n += 1
    os.remove(path)
    importlib.invalidate_caches()
    return n

# ---- import の候補 (まだ import していない名前を補完すると、import を足す) ----
_FCT_POPULAR = {
    "math": None, "random": ["randint", "choice", "shuffle", "random", "sample", "uniform", "randrange", "choices", "seed"],
    "time": ["sleep", "perf_counter"], "datetime": ["datetime", "date", "timedelta", "timezone"],
    "collections": ["Counter", "defaultdict", "deque", "namedtuple", "OrderedDict", "ChainMap"],
    "itertools": None, "functools": ["reduce", "lru_cache", "partial", "cache", "wraps", "cached_property"],
    "pathlib": ["Path"], "dataclasses": ["dataclass", "field", "asdict"],
    "typing": ["Any", "Optional", "Union", "Callable", "Iterable", "Iterator", "TypedDict", "Protocol", "Literal", "NamedTuple", "Generator", "Sequence", "Mapping"],
    "statistics": ["mean", "median", "mode", "stdev", "variance", "pstdev"], "copy": ["deepcopy"], "pprint": ["pprint"],
    "string": ["ascii_letters", "ascii_lowercase", "ascii_uppercase", "digits", "punctuation"],
    "heapq": ["heappush", "heappop", "heapify", "nlargest", "nsmallest"], "bisect": ["bisect_left", "bisect_right", "insort"],
    "fractions": ["Fraction"], "decimal": ["Decimal"], "enum": ["Enum", "IntEnum", "auto", "Flag"], "abc": ["ABC", "abstractmethod"],
    "contextlib": ["contextmanager", "suppress"], "operator": ["itemgetter", "attrgetter"], "uuid": ["uuid4"],
    "textwrap": ["dedent", "wrap", "fill"], "glob": ["glob"], "shutil": ["copyfile", "rmtree"], "csv": ["DictReader", "DictWriter"],
}
_fct_names = {}
def _fct_index():
    if _fct_names:
        return _fct_names
    for mod, names in _FCT_POPULAR.items():
        try:
            m = importlib.import_module(mod)
        except Exception:
            continue
        for n in (names or [x for x in dir(m) if not x.startswith("_")]):
            _fct_names.setdefault(n, mod)
    return _fct_names

def __fct_autoimport(code, line, col, have):
    import re
    lines = code.split("\\n")
    text = lines[line - 1][:col] if 0 < line <= len(lines) else ""
    m = re.search(r"(?<![\\w.])([A-Za-z_]\\w*)$", text)
    if not m or len(m.group(1)) < 2 or re.match(r"\\s*(import|from)\\b", text) or re.search(r"\\bdef\\s+\\w*$|\\bclass\\s+\\w*$", text):
        return []
    pre = m.group(1)
    have = set(have)
    imported = set(re.findall(r"^\\s*import\\s+([\\w.]+)", code, re.M)) | set(re.findall(r"^\\s*from\\s+[\\w.]+\\s+import\\s+.*?\\b%s\\w*" % re.escape(pre), code, re.M))
    out = []
    for mod in sorted(sys.stdlib_module_names):
        if mod.startswith(pre) and not mod.startswith("_") and mod not in have and mod not in imported and mod not in ("antigravity", "this", "idlelib", "turtledemo", "tkinter", "test", "lib2to3"):
            out.append({"name": mod, "type": "module", "desc": "import " + mod, "auto": "import " + mod})
    mods = set(o["name"] for o in out)
    for n, mod in sorted(_fct_index().items()):
        if n.startswith(pre) and n not in have and n not in mods and len(out) < 30:
            stmt = "from %s import %s" % (mod, n)
            if not re.search(r"^\\s*from\\s+%s\\s+import\\s+.*\\b%s\\b" % (re.escape(mod), re.escape(n)), code, re.M):
                out.append({"name": n, "type": "function", "desc": stmt, "auto": stmt})
    return out[:30]

def __fct_script(code, path):
    import jedi
    return jedi.Script(code, path=os.path.join(PROJECT, path), project=jedi.Project(PROJECT))

def __fct_complete(code, line, col, path):
    out = []
    for c in __fct_script(code, path).complete(line, col)[:150]:
        out.append({"name": c.name, "type": c.type, "complete": c.complete, "desc": c.description})
    try:
        out.extend(__fct_autoimport(code, line, col, [c["name"] for c in out]))
    except Exception:
        pass
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

def __fct_rel(n):
    p = str(n.module_path) if n.module_path else ""
    return p[len(PROJECT) + 1:] if p.startswith(PROJECT + "/") else None

def __fct_refs(code, line, col, path):
    # 参照 (プロジェクトのファイルの中だけ)
    out = []
    for n in __fct_script(code, path).get_references(line, col, include_builtins=False)[:400]:
        rel = __fct_rel(n)
        if rel is None:
            continue
        out.append({"name": n.name, "file": rel, "line": n.line, "col": n.column, "decl": n.is_definition(), "code": (n.get_line_code() or "").rstrip("\\n")})
    return json.dumps(out)

def __fct_rename(code, line, col, path, new_name):
    # 名前の変更: 変わるファイルと、その新しい中身
    import jedi
    try:
        ref = __fct_script(code, path).rename(line, col, new_name=new_name)
    except jedi.RefactoringError as e:
        return json.dumps({"error": str(e)})
    files = {}
    for p, ch in ref.get_changed_files().items():
        sp = str(p)
        rel = sp[len(PROJECT) + 1:] if sp.startswith(PROJECT + "/") else None
        if rel is None:
            return json.dumps({"error": "プロジェクトの外のファイル (" + sp + ") が変わるため、変更できません"})
        files[rel] = ch.get_new_code()
    return json.dumps({"files": files})

def __fct_outline(code, path):
    # ファイルの中の関数・クラス (アウトライン)
    import jedi
    out = []
    def walk(names, depth):
        for n in names:
            if n.type not in ("function", "class"):
                continue
            out.append({"name": n.name, "type": n.type, "line": n.line, "col": n.column, "depth": depth, "desc": n.description})
            if depth < 3:
                try:
                    walk(n.defined_names(), depth + 1)
                except Exception:
                    pass
    walk(__fct_script(code, path).get_names(all_scopes=False, definitions=True), 0)
    return json.dumps(out)

def __fct_format(code, aggressive):
    import autopep8
    return autopep8.fix_code(code, options={"aggressive": aggressive, "max_line_length": 120, "ignore": ["E501", "W6"]})

def __fct_warm():
    import jedi
    jedi.Script("import os\\nos.pa", path=os.path.join(PROJECT, "__warm__.py")).complete(2, 5)
    try:
        _fct_index()
        __fct_check("import math\\nx = input()\\nprint(math.sqrt(4), x)")
    except Exception:
        pass
`

const call = (fn, ...args) => {
  const f = py.globals.get(fn)
  try { return f(...args) } finally { f.destroy() }
}

// ---- import したライブラリを補完で使えるように (中の .py / .pyi だけ取り出す) ----
let lock = null
const tried = new Set(), doneDist = new Set()
let pkgQueue = Promise.resolve()
let pkgPending = 0
function importsOf(code) {
  const out = new Set()
  for (const m of code.matchAll(/^[ \t]*(?:from[ \t]+([A-Za-z_]\w*)|import[ \t]+([A-Za-z_][\w.]*(?:[ \t]*(?:as[ \t]+\w+[ \t]*)?,[ \t]*[A-Za-z_][\w.]*)*))/gm)) {
    if (m[1]) out.add(m[1])
    else for (const part of m[2].split(',')) out.add(part.trim().split(/[ \t.]/)[0])
  }
  return [...out].filter(Boolean)
}
function ensurePackages(code) {
  const names = importsOf(code).filter(n => !tried.has(n) && !NO_PIP[n])
  if (!names.length) return
  for (const n of names) tried.add(n)
  pkgPending++
  pkgQueue = pkgQueue.then(() => fetchPackages(names)).catch(() => {}).finally(() => { pkgPending-- })
}
async function extractUrl(url) {
  const data = await bytes(url)
  const path = '/tmp/pkg-' + Math.random().toString(36).slice(2) + '.whl'
  py.FS.writeFile(path, data)
  call('__fct_extract', path)
}
async function fetchPackages(names) {
  const need = JSON.parse(call('__fct_need', JSON.stringify(names)))
  if (!need.length) return
  if (!lock) lock = JSON.parse(new TextDecoder().decode(await bytes(local('../../vendor/pyodide/pyodide-lock.json'))))
  const byImport = new Map()
  for (const [k, p] of Object.entries(lock.packages)) for (const i of p.imports || []) byImport.set(i, k)
  const dists = new Set(), pypi = []
  const add = k => { if (dists.has(k) || !lock.packages[k]) return; dists.add(k); for (const d of lock.packages[k].depends || []) add(d) }
  for (const n of need) { const k = byImport.get(n); if (k) add(k); else pypi.push(PIP_NAMES[n] || n) }
  for (const k of dists) {
    const p = lock.packages[k]
    if (doneDist.has(k) || (p.package_type && p.package_type !== 'package')) continue
    doneDist.add(k)
    try { await extractUrl(PYODIDE_CDN + p.file_name) } catch {}
  }
  for (const d of pypi) {
    if (doneDist.has(d)) continue
    doneDist.add(d)
    try {
      const r = await fetch(`https://pypi.org/pypi/${encodeURIComponent(d)}/json`)
      if (!r.ok) continue
      const j = await r.json()
      const f = (j.urls || []).find(u => u.packagetype === 'bdist_wheel' && /-none-any\.whl$/.test(u.filename))
      if (f) await extractUrl(f.url)
    } catch {}
  }
}

self.onmessage = async e => {
  const m = e.data
  if (!m || !m.id) return
  try {
    await ensure()
    if (m.files) { const f = py.toPy(m.files); try { call('__fct_files', f) } finally { f.destroy() } }
    let result
    switch (m.type) {
      case 'lint': result = JSON.parse(call('__fct_lint', m.code, m.path || 'main.py')); ensurePackages(m.code); break
      case 'packages': ensurePackages(m.code || ''); await pkgQueue; result = true; break
      case 'complete': result = JSON.parse(call('__fct_complete', m.code, m.line, m.col, m.path || 'main.py')); break
      case 'doc': result = JSON.parse(call('__fct_doc', m.code, m.line, m.col, m.path || 'main.py', m.name)); break
      case 'signature': result = JSON.parse(call('__fct_signature', m.code, m.line, m.col, m.path || 'main.py')); break
      case 'help': result = JSON.parse(call('__fct_help', m.code, m.line, m.col, m.path || 'main.py')); break
      case 'goto': result = JSON.parse(call('__fct_goto', m.code, m.line, m.col, m.path || 'main.py')); break
      case 'refs': result = JSON.parse(call('__fct_refs', m.code, m.line, m.col, m.path || 'main.py')); break
      case 'rename': result = JSON.parse(call('__fct_rename', m.code, m.line, m.col, m.path || 'main.py', m.name)); break
      case 'outline': result = JSON.parse(call('__fct_outline', m.code, m.path || 'main.py')); break
      case 'format': result = call('__fct_format', m.code, m.aggressive ? 1 : 0); break
      case 'describe': result = JSON.parse(call('__fca_describe', m.code)); break
      case 'review': result = JSON.parse(call('__fca_review', m.code)); break
      case 'typehints': result = JSON.parse(call('__fca_typehints', m.code, m.from || 1, m.to || 1e9)); break
      case 'warm': result = true; break
      default: throw new Error('unknown request: ' + m.type)
    }
    self.postMessage({ id: m.id, ok: true, result })
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err).split('\n').slice(-3).join('\n') })
  }
}
