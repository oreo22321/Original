// テストの実行 (_fctest): pytest が使えれば pytest で、なければ同じ書き方で動く内蔵の実行役で
// ・test_*.py / *_test.py の test 関数・Test クラス・unittest.TestCase
// ・assert の失敗は「assert 3 == 4」のように値を見せる / フィクスチャ (tmp_path・capsys・monkeypatch・自作の @pytest.fixture)
// ・pytest.raises / approx / mark.parametrize / skip / skipif / xfail
// ・結果は画面 (テストの一覧) に 1 つずつ送り、出力にも pytest と同じ形で出す
// (python-worker の Python に置くファイル。py-runtime.js の runtimeFiles で集めます)

export const FCTEST = String.raw`"""ForgeCode のテスト実行 (pytest と同じ書き方)"""
import sys, os, io, re, ast, json, time, types, inspect, linecache, traceback, importlib.util, contextlib, tempfile, shutil, unittest

PROJECT = "/home/pyodide/project"
_last_failed = set()


def _event(data):
    try:
        import js
        js.__fc_event("tests", json.dumps(data, ensure_ascii=False, default=str))
    except Exception:
        pass


def _rel(path):
    try:
        p = os.path.relpath(os.path.abspath(path), PROJECT)
    except ValueError:
        return path
    return p.replace(os.sep, "/")


def _is_test_file(name):
    return name.endswith(".py") and (name.startswith("test_") or name.endswith("_test.py"))


def find_files(paths):
    out = []
    targets = paths or ["."]
    for t in targets:
        full = os.path.join(PROJECT, t) if not os.path.isabs(t) else t
        if os.path.isfile(full):
            out.append(full)
            continue
        for root, dirs, files in os.walk(full):
            dirs[:] = sorted(d for d in dirs if not d.startswith(".") and d not in ("__pycache__", "venv", ".venv", "node_modules", "site-packages"))
            for f in sorted(files):
                if _is_test_file(f):
                    out.append(os.path.join(root, f))
    seen, res = set(), []
    for f in out:
        if f not in seen:
            seen.add(f)
            res.append(f)
    return res


# ============================================================
# pytest が無いときの pytest (よく使うものだけ)
# ============================================================
class Skipped(Exception):
    pass


class XFailed(Exception):
    pass


class Failed(AssertionError):
    pass


class _Mark:
    def __init__(self, name, args=(), kwargs=None):
        self.name, self.args, self.kwargs = name, args, kwargs or {}

    def __call__(self, *args, **kwargs):
        if len(args) == 1 and callable(args[0]) and not kwargs and self.name not in ("parametrize", "skipif"):
            return self._apply(args[0])
        return _MarkApply(_Mark(self.name, args, kwargs))

    def _apply(self, fn):
        marks = list(getattr(fn, "pytestmark", []))
        marks.append(self)
        try:
            fn.pytestmark = marks
        except Exception:
            pass
        return fn


class _MarkApply:
    def __init__(self, mark):
        self.mark = mark

    def __call__(self, fn):
        return self.mark._apply(fn)


class _MarkGen:
    def __getattr__(self, name):
        return _Mark(name)


class _Raises:
    def __init__(self, exc, match=None):
        self.expected, self.match, self.value, self.type = exc, match, None, None

    def __enter__(self):
        return self

    def __exit__(self, et, ev, tb):
        if et is None:
            names = self.expected.__name__ if isinstance(self.expected, type) else ", ".join(e.__name__ for e in self.expected)
            raise Failed("DID NOT RAISE " + names)
        if not issubclass(et, self.expected):
            return False
        self.value, self.type = ev, et
        if self.match and not re.search(self.match, str(ev)):
            raise Failed("例外のメッセージ %r が %r に当てはまりません" % (str(ev), self.match))
        return True


def _raises(exc, *args, match=None, **kwargs):
    r = _Raises(exc, match)
    if args:
        with r:
            args[0](*args[1:], **kwargs)
        return r
    return r


class _Approx:
    def __init__(self, expected, rel=None, abs=None):
        self.expected, self.rel, self.abs = expected, rel, abs

    def _close(self, a, b):
        tol = max(self.rel if self.rel is not None else 1e-6 * builtin_abs(b), self.abs if self.abs is not None else 1e-12)
        return builtin_abs(a - b) <= tol

    def __eq__(self, other):
        e = self.expected
        try:
            if isinstance(e, dict):
                return isinstance(other, dict) and e.keys() == other.keys() and all(self._close(other[k], e[k]) for k in e)
            if isinstance(e, (list, tuple)):
                return len(e) == len(other) and all(self._close(a, b) for a, b in zip(other, e))
            return self._close(other, e)
        except TypeError:
            return False

    def __repr__(self):
        return "approx(%r)" % (self.expected,)


builtin_abs = abs


def _fixture(fn=None, *, scope="function", autouse=False, params=None, name=None):
    def deco(f):
        f._fc_fixture = {"scope": scope, "autouse": autouse, "name": name or f.__name__}
        return f
    return deco(fn) if fn is not None else deco


def _skip(reason=""):
    raise Skipped(reason)


def _fail(reason=""):
    raise Failed(reason)


def _xfail(reason=""):
    raise XFailed(reason)


def _importorskip(name, minversion=None):
    try:
        return importlib.import_module(name)
    except ImportError:
        raise Skipped("%s を import できません" % name)


def make_pytest_shim():
    m = types.ModuleType("pytest")
    m.__doc__ = "ForgeCode の簡易 pytest (本物の pytest が使えないとき)"
    m.raises, m.approx, m.fixture, m.mark = _raises, _Approx, _fixture, _MarkGen()
    m.skip, m.fail, m.xfail, m.importorskip = _skip, _fail, _xfail, _importorskip
    m.skip.Exception = Skipped
    m.param = lambda *values, id=None, marks=(): values if len(values) != 1 else values[0]
    m.warns = lambda *a, **k: contextlib.nullcontext()
    m.deprecated_call = lambda *a, **k: contextlib.nullcontext()
    m.main = lambda args=None: main(list(args or []))
    m._fc_shim = True
    return m


# ---- 用意されているフィクスチャ ----
class _Capsys:
    def __init__(self):
        self.out, self.err = io.StringIO(), io.StringIO()
        self._saved = (sys.stdout, sys.stderr)
        sys.stdout, sys.stderr = self.out, self.err

    def readouterr(self):
        o, e = self.out.getvalue(), self.err.getvalue()
        self.out.seek(0); self.out.truncate()
        self.err.seek(0); self.err.truncate()
        return types.SimpleNamespace(out=o, err=e)

    def close(self):
        sys.stdout, sys.stderr = self._saved


class _MonkeyPatch:
    _missing = object()

    def __init__(self):
        self._undo = []

    def setattr(self, target, name, value=_missing, raising=True):
        if value is self._missing and isinstance(target, str):
            mod, _, attr = target.rpartition(".")
            target, value, name = importlib.import_module(mod), name, attr
        old = getattr(target, name, self._missing)
        if old is self._missing and raising:
            raise AttributeError(name)
        self._undo.append(lambda: delattr(target, name) if old is self._missing else setattr(target, name, old))
        setattr(target, name, value)

    def delattr(self, target, name, raising=True):
        if not hasattr(target, name):
            if raising:
                raise AttributeError(name)
            return
        old = getattr(target, name)
        self._undo.append(lambda: setattr(target, name, old))
        delattr(target, name)

    def setitem(self, d, key, value):
        old = d.get(key, self._missing) if hasattr(d, "get") else self._missing
        self._undo.append(lambda: d.pop(key, None) if old is self._missing else d.__setitem__(key, old))
        d[key] = value

    def delitem(self, d, key, raising=True):
        if key not in d:
            if raising:
                raise KeyError(key)
            return
        old = d[key]
        self._undo.append(lambda: d.__setitem__(key, old))
        del d[key]

    def setenv(self, name, value, prepend=None):
        self.setitem(os.environ, name, str(value))

    def delenv(self, name, raising=True):
        self.delitem(os.environ, name, raising)

    def chdir(self, path):
        old = os.getcwd()
        self._undo.append(lambda: os.chdir(old))
        os.chdir(path)

    def syspath_prepend(self, path):
        sys.path.insert(0, str(path))
        self._undo.append(lambda: sys.path.remove(str(path)) if str(path) in sys.path else None)

    def undo(self):
        while self._undo:
            try:
                self._undo.pop()()
            except Exception:
                pass


def _builtin_fixture(name, finalizers):
    if name in ("tmp_path", "tmpdir"):
        import pathlib
        d = tempfile.mkdtemp(prefix="fctest_")
        finalizers.append(lambda: shutil.rmtree(d, ignore_errors=True))
        return pathlib.Path(d) if name == "tmp_path" else d
    if name in ("capsys", "capfd"):
        c = _Capsys()
        finalizers.append(c.close)
        return c
    if name == "monkeypatch":
        m = _MonkeyPatch()
        finalizers.append(m.undo)
        return m
    if name == "request":
        return types.SimpleNamespace(param=None, node=None, config=None)
    raise LookupError(name)


# ============================================================
# 集める
# ============================================================
class Item:
    def __init__(self, file, name, fn, line, cls=None, params=None, case=None):
        self.file, self.name, self.fn, self.line, self.cls, self.params, self.case = file, name, fn, line, cls, params or {}, case
        self.id = file + "::" + (cls.__name__ + "::" if cls is not None else "") + name


def _marks(obj):
    return list(getattr(obj, "pytestmark", []) or [])


def _param_sets(fn):
    sets = [({}, "")]
    for m in reversed([m for m in _marks(fn) if m.name == "parametrize"]):
        names, values = m.args[0], m.args[1]
        names = [n.strip() for n in names.split(",")] if isinstance(names, str) else list(names)
        ids = m.kwargs.get("ids")
        nxt = []
        for base, bid in sets:
            for k, v in enumerate(values):
                vals = (v,) if len(names) == 1 else tuple(v)
                pid = ids[k] if isinstance(ids, (list, tuple)) and k < len(ids) else "-".join(_short_repr(x) for x in vals)
                d = dict(base)
                d.update(zip(names, vals))
                nxt.append((d, (bid + "-" if bid else "") + str(pid)))
        sets = nxt
    return sets


def _short_repr(v):
    if isinstance(v, (int, float, bool)) or v is None:
        return str(v)
    if isinstance(v, str) and len(v) <= 20 and v.isidentifier():
        return v
    return type(v).__name__ + str(abs(hash(repr(v))) % 1000)


def _line_of(fn):
    try:
        return inspect.getsourcelines(fn)[1]
    except Exception:
        try:
            return fn.__code__.co_firstlineno
        except Exception:
            return 1


def load_module(path):
    name = "fctest_" + re.sub(r"\W", "_", _rel(path)[:-3])
    d = os.path.dirname(path)
    if d not in sys.path:
        sys.path.insert(0, d)
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def collect_module(path, mod):
    rel = _rel(path)
    items = []
    for name, obj in list(vars(mod).items()):
        if inspect.isclass(obj) and getattr(obj, "__module__", None) == mod.__name__:
            if issubclass(obj, unittest.TestCase):
                for mname in unittest.TestLoader().getTestCaseNames(obj):
                    items.append(Item(rel, mname, getattr(obj, mname), _line_of(getattr(obj, mname)), cls=obj, case=True))
            elif name.startswith("Test") and "__init__" not in vars(obj):
                for mname, m in vars(obj).items():
                    if mname.startswith("test") and callable(m):
                        for params, pid in _param_sets(m):
                            items.append(Item(rel, mname + ("[%s]" % pid if pid else ""), m, _line_of(m), cls=obj, params=params))
        elif name.startswith("test") and inspect.isfunction(obj) and obj.__module__ == mod.__name__:
            for params, pid in _param_sets(obj):
                items.append(Item(rel, name + ("[%s]" % pid if pid else ""), obj, _line_of(obj), params=params))
    items.sort(key=lambda it: it.line)
    return items


# ============================================================
# assert の失敗を分かりやすく (式の両側の値を見せる)
# ============================================================
# 呼び直すと結果が変わりそうなメソッド (pop など) があるときは、値を出さない
_UNSAFE_METHODS = {"pop", "popitem", "append", "extend", "insert", "remove", "clear", "update", "add", "discard", "setdefault", "write", "writelines", "send", "read", "readline", "readlines", "next", "close", "put", "get_nowait", "put_nowait", "seek", "sort", "reverse", "delete", "save", "commit", "execute", "input", "print", "random", "randint", "choice", "shuffle", "time", "now"}


_UNSAFE_FUNCS = {"input", "print", "next", "open", "exec", "eval", "setattr", "delattr", "__import__", "exit", "quit"}


def _safe(node):
    for n in ast.walk(node):
        if isinstance(n, ast.Call):
            f = n.func
            if isinstance(f, ast.Attribute):
                if f.attr in _UNSAFE_METHODS:
                    return False
            elif isinstance(f, ast.Name):
                if f.id in _UNSAFE_FUNCS:
                    return False
            else:
                return False
        if isinstance(n, (ast.NamedExpr, ast.Await, ast.Yield, ast.YieldFrom, ast.Lambda)):
            return False
    return True


def _r(v):
    s = repr(v)
    return s if len(s) <= 240 else s[:237] + "..."


def explain_assert(tb):
    frame, lineno = None, None
    for f, ln in traceback.walk_tb(tb):
        frame, lineno = f, ln
    if frame is None:
        return None
    fname = frame.f_code.co_filename
    try:
        tree = ast.parse("".join(linecache.getlines(fname)))
    except Exception:
        return None
    node = None
    for n in ast.walk(tree):
        if isinstance(n, ast.Assert) and n.lineno <= lineno <= getattr(n, "end_lineno", n.lineno):
            node = n
    if node is None:
        return None
    src = ast.get_source_segment("".join(linecache.getlines(fname)), node) or ""
    t = node.test
    env_g, env_l = frame.f_globals, frame.f_locals
    ev = lambda e: eval(compile(ast.Expression(e), fname, "eval"), env_g, env_l)
    lines = [src]
    try:
        if isinstance(t, ast.Compare) and len(t.ops) == 1 and _safe(t):
            left, right = ev(t.left), ev(t.comparators[0])
            op = {ast.Eq: "==", ast.NotEq: "!=", ast.Lt: "<", ast.LtE: "<=", ast.Gt: ">", ast.GtE: ">=", ast.In: "in", ast.NotIn: "not in", ast.Is: "is", ast.IsNot: "is not"}.get(type(t.ops[0]), "?")
            lines.append("assert %s %s %s" % (_r(left), op, _r(right)))
            for side, val in ((t.left, left), (t.comparators[0], right)):
                if isinstance(side, ast.Call):
                    lines.append("  %s の結果: %s" % (ast.unparse(side), _r(val)))
            if op == "==" and isinstance(left, (list, tuple)) and isinstance(right, (list, tuple)):
                for k, (a, b) in enumerate(zip(left, right)):
                    if a != b:
                        lines.append("  %d 番目が違います: %s != %s" % (k, _r(a), _r(b)))
                        break
                else:
                    if len(left) != len(right):
                        lines.append("  長さが違います: %d != %d" % (len(left), len(right)))
            elif op == "==" and isinstance(left, dict) and isinstance(right, dict):
                diff = [k for k in set(left) | set(right) if left.get(k, object()) != right.get(k, object())]
                for k in sorted(diff, key=repr)[:5]:
                    lines.append("  [%r]: %s != %s" % (k, _r(left.get(k, "(なし)")), _r(right.get(k, "(なし)"))))
            elif op == "==" and isinstance(left, str) and isinstance(right, str) and len(left) > 20:
                k = next((i for i, (a, b) in enumerate(zip(left, right)) if a != b), min(len(left), len(right)))
                lines.append("  %d 文字目から違います: %r と %r" % (k, left[k:k + 20], right[k:k + 20]))
        elif _safe(t):
            v = ev(t)
            lines.append("assert %s" % _r(v))
    except Exception:
        pass
    return "\n".join(lines)


def failure_text(e, tb):
    frames = [f for f in traceback.extract_tb(tb) if os.path.abspath(f.filename).startswith(PROJECT)]
    loc = frames[-1] if frames else None
    head = ""
    if isinstance(e, AssertionError) and not isinstance(e, Failed):
        head = explain_assert(tb) or ""
        if str(e):
            head = (head + "\n" if head else "") + "AssertionError: " + str(e)
        elif not head:
            head = "AssertionError"
    else:
        head = "%s: %s" % (type(e).__name__, e) if str(e) else type(e).__name__
    trace = "".join(traceback.format_list(frames)) if frames else ""
    return head, trace, (_rel(loc.filename), loc.lineno) if loc else (None, None)


# ============================================================
# 実行 (内蔵)
# ============================================================
class Runner:
    def __init__(self, verbose=False, stop_first=False):
        self.verbose, self.stop_first = verbose, stop_first
        self.results = []
        self.session_cache = {}

    def fixtures_for(self, mod, conftests):
        table = {}
        for src in conftests + [mod]:
            for v in vars(src).values():
                info = getattr(v, "_fc_fixture", None)
                if info:
                    table[info["name"]] = (v, info)
        # 本物の pytest の @pytest.fixture (shim を使わず本物を import していたとき)
        return table

    def resolve(self, name, table, item, finalizers, cache, stack=()):
        if name in cache:
            return cache[name]
        if name in item.params:
            return item.params[name]
        if name in table:
            fn, info = table[name]
            if info["scope"] in ("module", "session", "package") and name in self.session_cache:
                return self.session_cache[name]
            if name in stack:
                raise RuntimeError("フィクスチャ %s が自分自身を使っています" % name)
            kwargs = {p: self.resolve(p, table, item, finalizers, cache, stack + (name,)) for p in inspect.signature(fn).parameters if p not in ("self",)}
            val = fn(**kwargs)
            if inspect.isgenerator(val):
                gen = val
                val = next(gen)
                def fin(g=gen):
                    try:
                        next(g)
                    except StopIteration:
                        pass
                (finalizers if info["scope"] == "function" else self.session_finalizers).append(fin)
            if info["scope"] != "function":
                self.session_cache[name] = val
            cache[name] = val
            return val
        return _builtin_fixture(name, finalizers)

    def run_item(self, item, mod, table):
        t0 = time.perf_counter()
        marks = _marks(item.fn) + (_marks(item.cls) if item.cls is not None else []) + _marks(mod)
        res = {"id": item.id, "file": item.file, "name": item.name, "cls": item.cls.__name__ if item.cls is not None else None, "line": item.line}
        for m in marks:
            if m.name == "skip" or (m.name == "skipif" and m.args and m.args[0]):
                res.update(outcome="skipped", message=str(m.kwargs.get("reason") or (m.args[0] if m.name == "skip" and m.args else "") or "skip"))
                return self.finish(res, t0)
        xfail = next((m for m in marks if m.name == "xfail" and (not m.args or m.args[0])), None)
        if item.case:
            return self.run_case(item, res, t0)
        finalizers, cache = [], {}
        stage = "setup"
        try:
            for name, (fn, info) in table.items():
                if info["autouse"]:
                    self.resolve(name, table, item, finalizers, cache)
            inst = item.cls() if item.cls is not None else None
            fn = getattr(inst, item.fn.__name__) if inst is not None else item.fn
            if inst is not None and hasattr(inst, "setup_method"):
                inst.setup_method(fn)
            params = [p for p in inspect.signature(fn).parameters]
            kwargs = {p: self.resolve(p, table, item, finalizers, cache) for p in params}
            stage = "call"
            r = fn(**kwargs)
            if inspect.iscoroutine(r):
                import asyncio
                asyncio.run(r)
            if inst is not None and hasattr(inst, "teardown_method"):
                inst.teardown_method(fn)
            if xfail:
                res.update(outcome="xpassed", message="失敗するはずが通りました")
            else:
                res.update(outcome="passed")
        except Skipped as e:
            res.update(outcome="skipped", message=str(e) or "skip")
        except XFailed as e:
            res.update(outcome="xfailed", message=str(e))
        except KeyboardInterrupt:
            raise
        except BaseException as e:
            if isinstance(e, SystemExit) and stage == "setup":
                raise
            if xfail and stage == "call":
                res.update(outcome="xfailed", message=str(xfail.kwargs.get("reason") or "予想どおり失敗"))
            else:
                head, trace, (f, ln) = failure_text(e, e.__traceback__)
                if isinstance(e, LookupError) and stage == "setup" and str(e).strip("'") in [p for p in inspect.signature(item.fn).parameters]:
                    head = "フィクスチャ '%s' が見つかりません" % str(e).strip("'")
                res.update(outcome="failed" if stage == "call" else "error", message=head, detail=trace, at={"file": f, "line": ln} if f else None)
        finally:
            for fin in reversed(finalizers):
                try:
                    fin()
                except Exception:
                    pass
        return self.finish(res, t0)

    def run_case(self, item, res, t0):
        result = unittest.TestResult()
        case = item.cls(item.name)
        case.run(result)
        if result.skipped:
            res.update(outcome="skipped", message=result.skipped[0][1])
        elif result.expectedFailures:
            res.update(outcome="xfailed", message="")
        elif result.unexpectedSuccesses:
            res.update(outcome="xpassed", message="")
        elif result.failures or result.errors:
            kind, (c, text) = ("failed", result.failures[0]) if result.failures else ("error", result.errors[0])
            last = [l for l in text.strip().split("\n") if l.strip()]
            m = re.findall(r'File "([^"]+)", line (\d+)', text)
            at = None
            for f, ln in m:
                if os.path.abspath(f).startswith(PROJECT):
                    at = {"file": _rel(f), "line": int(ln)}
            res.update(outcome="failed" if kind == "failed" else "error", message=last[-1] if last else kind, detail=text, at=at)
        else:
            res.update(outcome="passed")
        return self.finish(res, t0)

    def finish(self, res, t0):
        res["ms"] = round((time.perf_counter() - t0) * 1000, 2)
        self.results.append(res)
        _event(dict(phase="result", **res))
        return res


SYMBOL = {"passed": ".", "failed": "F", "error": "E", "skipped": "s", "xfailed": "x", "xpassed": "X"}
COLOR = {"passed": "32", "failed": "31", "error": "31", "skipped": "33", "xfailed": "33", "xpassed": "33"}


def _match_k(expr, text):
    if not expr:
        return True
    words = re.findall(r"\(|\)|\band\b|\bor\b|\bnot\b|[^\s()]+", expr)
    py = []
    for w in words:
        if w in ("and", "or", "not", "(", ")"):
            py.append(w)
        else:
            py.append(repr(w.lower()) + " in _t")
    try:
        return bool(eval(" ".join(py), {"_t": text.lower()}))
    except Exception:
        return expr.lower() in text.lower()


def parse_args(args):
    o = {"paths": [], "k": None, "x": False, "v": False, "q": False, "lf": False, "ids": [], "real": None}
    i = 0
    while i < len(args):
        a = args[i]
        if a == "-k":
            i += 1
            o["k"] = args[i] if i < len(args) else None
        elif a.startswith("-k") and len(a) > 2:
            o["k"] = a[2:]
        elif a in ("-x", "--exitfirst"):
            o["x"] = True
        elif a in ("-v", "--verbose", "-vv"):
            o["v"] = True
        elif a in ("-q", "--quiet"):
            o["q"] = True
        elif a in ("--lf", "--last-failed"):
            o["lf"] = True
        elif a == "--fc-builtin":
            o["real"] = False
        elif a == "--fc-ids":
            i += 1
            o["ids"] = json.loads(args[i])
        elif a.startswith("-"):
            pass
        else:
            if "::" in a:
                o["ids"].append(a)
                o["paths"].append(a.split("::")[0])
            else:
                o["paths"].append(a)
        i += 1
    return o


def _write(s):
    sys.stdout.write(s)
    try:
        sys.stdout.flush()
    except Exception:
        pass


def run_builtin(o):
    global _last_failed
    t0 = time.perf_counter()
    shim_added = False
    if "pytest" not in sys.modules:
        sys.modules["pytest"] = make_pytest_shim()
        shim_added = True
    runner = Runner(verbose=o["v"], stop_first=o["x"])
    runner.session_finalizers = []
    files = find_files(o["paths"] or ([i.split("::")[0] for i in o["ids"]] if o["ids"] else []))
    # conftest.py (フィクスチャの置き場所)
    conftests = []
    cpath = os.path.join(PROJECT, "conftest.py")
    if os.path.isfile(cpath):
        try:
            conftests.append(load_module(cpath))
        except Exception as e:
            _write("conftest.py を読み込めませんでした: %s\n" % e)
    plan = []
    errors = []
    for f in files:
        rel = _rel(f)
        try:
            mod = load_module(f)
        except KeyboardInterrupt:
            raise
        except BaseException as e:
            head, trace, (ff, ln) = failure_text(e, e.__traceback__)
            if isinstance(e, SyntaxError):
                ff, ln = rel, e.lineno
                head = "SyntaxError: %s (%s 行目)" % (e.msg, e.lineno)
            errors.append({"id": rel, "file": rel, "name": rel, "cls": None, "line": ln or 1, "outcome": "error", "message": "読み込めませんでした: " + head, "detail": trace, "at": {"file": ff, "line": ln} if ff else None, "ms": 0})
            continue
        items = collect_module(f, mod)
        if o["ids"]:
            want = set(o["ids"])
            items = [it for it in items if it.id in want or it.id.split("[")[0] in want or any(it.id.startswith(w + "::") for w in want)]
        if o["k"]:
            items = [it for it in items if _match_k(o["k"], it.id)]
        if o["lf"] and _last_failed:
            items = [it for it in items if it.id in _last_failed]
        plan.append((rel, mod, items))
    total = sum(len(p[2]) for p in plan)
    _event({"phase": "start", "total": total, "runner": "builtin", "files": [_rel(f) for f in files]})
    _write("\x1b[1m===== テスト %d 個 (%d ファイル) =====\x1b[0m\n" % (total, len(files)))
    for e in errors:
        runner.results.append(e)
        _event(dict(phase="result", **e))
        _write("\x1b[31mE\x1b[0m %s %s\n" % (e["file"], e["message"]))
    stop = False
    for rel, mod, items in plan:
        if stop:
            break
        if not items:
            continue
        table = runner.fixtures_for(mod, conftests)
        if not o["v"]:
            _write(rel + " ")
        for it in items:
            r = runner.run_item(it, mod, table)
            if o["v"]:
                _write("%s \x1b[%sm%s\x1b[0m\n" % (it.id, COLOR[r["outcome"]], r["outcome"].upper()))
            else:
                _write("\x1b[%sm%s\x1b[0m" % (COLOR[r["outcome"]], SYMBOL[r["outcome"]]))
            if o["x"] and r["outcome"] in ("failed", "error"):
                stop = True
                break
        if not o["v"]:
            _write("\n")
    for fin in reversed(runner.session_finalizers):
        try:
            fin()
        except Exception:
            pass
    if shim_added and getattr(sys.modules.get("pytest"), "_fc_shim", False):
        del sys.modules["pytest"]
    return finish_report(runner.results, time.perf_counter() - t0, "builtin")


def finish_report(results, secs, kind):
    global _last_failed
    bad = [r for r in results if r["outcome"] in ("failed", "error")]
    _last_failed = set(r["id"] for r in bad)
    if bad:
        _write("\n\x1b[1m===== 失敗したテスト =====\x1b[0m\n")
        for r in bad:
            _write("\x1b[31m\x1b[1m%s\x1b[0m%s\n" % (r["id"], " (準備で失敗)" if r["outcome"] == "error" else ""))
            if r.get("detail") and kind == "builtin":
                _write("\x1b[90m%s\x1b[0m" % r["detail"])
            _write("\x1b[31m%s\x1b[0m\n\n" % (r.get("message") or ""))
    counts = {}
    for r in results:
        counts[r["outcome"]] = counts.get(r["outcome"], 0) + 1
    names = [("failed", "失敗"), ("error", "エラー"), ("passed", "成功"), ("skipped", "スキップ"), ("xfailed", "予想どおり失敗"), ("xpassed", "予想外に成功")]
    parts = ["%d %s" % (counts[k], j) for k, j in names if counts.get(k)]
    color = "31" if bad else "32" if results else "33"
    _write("\x1b[%sm===== %s (%.2f 秒) =====\x1b[0m\n" % (color, ", ".join(parts) or "テストが見つかりません", secs))
    _event({"phase": "done", "counts": counts, "seconds": round(secs, 3), "runner": kind})
    return 1 if bad else (5 if not results else 0)


# ============================================================
# 本物の pytest (あれば)
# ============================================================
def run_real(o, args):
    import pytest
    collected = []
    t0 = time.perf_counter()

    class Plugin:
        def pytest_collection_finish(self, session):
            _event({"phase": "start", "total": len(session.items), "runner": "pytest"})

        def pytest_runtest_logreport(self, report):
            if report.when != "call" and not (report.failed or report.skipped):
                return
            if report.when == "teardown" and not report.failed:
                return
            fspath, line, _ = report.location
            parts = report.nodeid.split("::")
            outcome = report.outcome
            if hasattr(report, "wasxfail"):
                outcome = "xfailed" if report.skipped else "xpassed"
            elif report.failed and report.when != "call":
                outcome = "error"
            msg = ""
            detail = ""
            at = None
            if report.failed:
                lr = report.longrepr
                try:
                    msg = lr.reprcrash.message
                    at = {"file": _rel(os.path.join(str(session_root[0]), lr.reprcrash.path)) if not os.path.isabs(lr.reprcrash.path) else _rel(lr.reprcrash.path), "line": lr.reprcrash.lineno}
                except Exception:
                    msg = str(lr).strip().split("\n")[-1]
                detail = str(lr)
            elif report.skipped:
                try:
                    msg = report.longrepr[2]
                except Exception:
                    msg = ""
            r = {"id": report.nodeid, "file": parts[0], "name": parts[-1], "cls": parts[1] if len(parts) > 2 else None, "line": (line or 0) + 1, "outcome": outcome, "message": msg, "detail": detail, "at": at, "ms": round(report.duration * 1000, 2)}
            collected.append(r)
            _event(dict(phase="result", **r))

    session_root = [PROJECT]
    pa = [a for a in args if not a.startswith("--fc-")]
    if o["ids"] and not any("::" in a for a in pa):
        pa += o["ids"]
    pa = ["-p", "no:cacheprovider", "--color=yes", "-o", "console_output_style=classic"] + pa
    code = pytest.main(pa, plugins=[Plugin()])
    counts = {}
    for r in collected:
        counts[r["outcome"]] = counts.get(r["outcome"], 0) + 1
    _event({"phase": "done", "counts": counts, "seconds": round(time.perf_counter() - t0, 3), "runner": "pytest"})
    return int(code)


def main(args=None):
    args = list(sys.argv[1:] if args is None else args)
    o = parse_args(args)
    os.chdir(PROJECT) if os.getcwd() == "/" else None
    use_real = o["real"]
    if use_real is None:
        mod = sys.modules.get("pytest")
        use_real = mod is not None and not getattr(mod, "_fc_shim", False)
        if not use_real:
            use_real = importlib.util.find_spec("pytest") is not None
    code = 0
    try:
        code = run_real(o, args) if use_real else run_builtin(o)
    except KeyboardInterrupt:
        _write("\n\x1b[33m止めました\x1b[0m\n")
        _event({"phase": "done", "counts": {}, "stopped": True})
        code = 2
    return code
`
