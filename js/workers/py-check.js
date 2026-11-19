// 実行する前に見つけられる間違いのチェック (pytools ワーカーの Python で動かします。pyflakes の続き)
// ・モジュールにない名前 (math.squareroot / from math import squareroot / import ramdom)
// ・引数の数・名前の間違い (自分の関数・クラス、組み込み関数、標準ライブラリの関数)
// ・input() の結果 (文字列) を数として使っている (age + 1 / age > 18)
// ・文字列・リスト・辞書にないメソッド (name.uppercase() / nums.push(3))
// ・None を返すメソッドの結果を使っている (x = nums.sort()) / 結果を使っていない文字列のメソッド (s.upper())
// 位置は 1 から数える行と、1 から数える「文字」の列 (ast はバイト単位なので直します)
export const CHECK = String.raw`
import ast as _cast, sys as _csys, json as _cjson, difflib as _cdiff, inspect as _cinsp, importlib as _cimp, builtins as _cbi

_C_SKIP_MODULES = {"antigravity", "this", "idlelib", "turtledemo", "tkinter", "test", "lib2to3", "ensurepip", "venv",
                   "pydoc_data", "__hello__", "__phello__", "_tkinter", "curses", "readline", "dbm", "pty", "tty", "termios"}
_c_mod_cache = {}
_C_JS_NAMES = {"push": "append", "length": "len(…)", "size": "len(…)", "toUpperCase": "upper", "toLowerCase": "lower",
               "trim": "strip", "indexOf": "index", "includes": "in", "contains": "in", "forEach": "for 文", "charAt": "[番号]",
               "substring": "[開始:終わり]", "toString": "str(…)", "add": "append", "len": "len(…)", "concat": "+"}
_C_TYPE_JA = {"str": "文字列 (str)", "list": "リスト (list)", "dict": "辞書 (dict)", "set": "集合 (set)", "int": "整数 (int)", "float": "小数 (float)", "tuple": "タプル (tuple)"}
_C_TYPES = {"str": str, "list": list, "dict": dict, "set": set, "int": int, "float": float, "tuple": tuple}
_C_NONE_METHODS = {"list": {"sort", "append", "extend", "reverse", "insert", "remove", "clear"}, "dict": {"update", "clear"}, "set": {"add", "update", "discard", "clear", "remove"}}
_C_STR_NEW = {"replace", "upper", "lower", "strip", "lstrip", "rstrip", "title", "capitalize", "swapcase", "zfill", "center", "ljust", "rjust", "casefold", "removeprefix", "removesuffix"}


def _c_module(name):
    if name in _c_mod_cache:
        return _c_mod_cache[name]
    m = None
    top = name.split(".")[0]
    if top not in _C_SKIP_MODULES and (top in _csys.stdlib_module_names or top in ("turtle", "multiprocessing", "webbrowser")):
        try:
            m = _cimp.import_module(name)
        except BaseException:
            m = None
    _c_mod_cache[name] = m
    return m


def _c_has(mod, attr):
    if hasattr(mod, attr) or hasattr(mod, "__getattr__"):
        return True
    try:
        import importlib.util
        return importlib.util.find_spec(mod.__name__ + "." + attr) is not None
    except Exception:
        return False


def _c_similar(name, names):
    names = [n for n in names if not n.startswith("_")]
    m = _cdiff.get_close_matches(name, names, n=1, cutoff=0.6)
    if not m:
        low = {n.lower(): n for n in names}
        if name.lower() in low:
            return low[name.lower()]
    return m[0] if m else None


class _CSrc:
    def __init__(self, code):
        self.lines = code.split("\n")

    def ch(self, line, col):
        if line is None or col is None or line - 1 >= len(self.lines):
            return col or 0
        return len(self.lines[line - 1].encode("utf-8")[:col].decode("utf-8", "ignore"))

    def span(self, node, end_node=None):
        e = end_node or node
        return {"line": node.lineno, "col": self.ch(node.lineno, node.col_offset) + 1,
                "endLine": e.end_lineno, "endCol": self.ch(e.end_lineno, e.end_col_offset) + 1}

    def attr_span(self, node):
        # a.b の b の部分
        line = node.end_lineno
        end = self.ch(line, node.end_col_offset)
        return {"line": line, "col": end - len(node.attr) + 1, "endLine": line, "endCol": end + 1}


def _c_kind(v, shadowed):
    if isinstance(v, _cast.Constant):
        x = v.value
        if isinstance(x, bool):
            return "bool"
        for k in ("str", "int", "float"):
            if type(x) is _C_TYPES[k]:
                return k
        return "other"
    if isinstance(v, _cast.JoinedStr):
        return "str"
    if isinstance(v, (_cast.List, _cast.ListComp)):
        return "list"
    if isinstance(v, (_cast.Dict, _cast.DictComp)):
        return "dict"
    if isinstance(v, (_cast.Set, _cast.SetComp)):
        return "set"
    if isinstance(v, _cast.Tuple):
        return "tuple"
    if isinstance(v, _cast.Call) and isinstance(v.func, _cast.Name) and v.func.id not in shadowed:
        f = v.func.id
        if f == "input":
            return "input"
        if f in ("str", "list", "dict", "set", "int", "float", "tuple") and not v.keywords:
            return f
        if f == "len":
            return "int"
    return "unknown"


_C_SCOPES = (_cast.FunctionDef, _cast.AsyncFunctionDef, _cast.Lambda, _cast.ClassDef)


class _CScope:
    def __init__(self, node, parent):
        self.node = node
        self.parent = parent
        self.kinds = {}      # 名前 → 値の種類の集合

    def bind(self, name, kind):
        self.kinds.setdefault(name, set()).add(kind)

    def kind(self, name):
        s = self
        while s is not None:
            # メソッドの中からは、クラスの中の名前は見えない
            if s is not self and isinstance(s.node, _cast.ClassDef):
                s = s.parent
                continue
            if name in s.kinds:
                ks = s.kinds[name]
                if len(ks) == 1:
                    return next(iter(ks))
                if ks <= {"str", "input"}:
                    return "str"
                return "unknown"
            s = s.parent
        return None


def _c_targets(t):
    if isinstance(t, _cast.Name):
        yield t.id
    elif isinstance(t, (_cast.Tuple, _cast.List)):
        for e in t.elts:
            yield from _c_targets(e)
    elif isinstance(t, _cast.Starred):
        yield from _c_targets(t.value)


class _CBinder(_cast.NodeVisitor):
    # スコープ (モジュール・関数) ごとに、名前に入る値の種類を集める
    def __init__(self, shadowed):
        self.shadowed = shadowed
        self.scopes = {}
        self.cur = None
        self.unknown_everywhere = set()

    def scope(self, node):
        s = _CScope(node, self.cur)
        self.scopes[node] = s
        prev, self.cur = self.cur, s
        return prev

    def visit_Module(self, node):
        self.scope(node)
        self.generic_visit(node)

    def _func(self, node):
        if not isinstance(node, _cast.Lambda):
            self.cur.bind(node.name, "def")
            for d in node.decorator_list:
                self.visit(d)
        prev = self.scope(node)
        a = node.args
        for arg in a.posonlyargs + a.args + a.kwonlyargs + ([a.vararg] if a.vararg else []) + ([a.kwarg] if a.kwarg else []):
            self.cur.bind(arg.arg, "unknown")
        body = node.body if isinstance(node.body, list) else [node.body]
        for st in body:
            self.visit(st)
        self.cur = prev

    visit_FunctionDef = visit_AsyncFunctionDef = visit_Lambda = _func

    def visit_ClassDef(self, node):
        self.cur.bind(node.name, "class")
        for n in node.bases + node.decorator_list + [k.value for k in node.keywords]:
            self.visit(n)
        prev = self.scope(node)
        for st in node.body:
            self.visit(st)
        self.cur = prev

    def visit_Assign(self, node):
        self.visit(node.value)
        k = _c_kind(node.value, self.shadowed)
        for t in node.targets:
            if isinstance(t, _cast.Name):
                self.cur.bind(t.id, k)
            else:
                for n in _c_targets(t):
                    self.cur.bind(n, "unknown")
                self.visit(t)

    def visit_AnnAssign(self, node):
        if node.value is not None:
            self.visit(node.value)
            for n in _c_targets(node.target):
                self.cur.bind(n, _c_kind(node.value, self.shadowed) if isinstance(node.target, _cast.Name) else "unknown")

    def visit_AugAssign(self, node):
        self.visit(node.value)
        for n in _c_targets(node.target):
            prev = self.cur.kind(n)
            vk = _c_kind(node.value, self.shadowed)
            same = prev in ("str", "input") and vk in ("str", "input") or prev == vk and prev in ("list", "int", "float")
            self.cur.bind(n, prev if same else "unknown")

    def visit_NamedExpr(self, node):
        self.visit(node.value)
        self.cur.bind(node.target.id, _c_kind(node.value, self.shadowed))

    def _unknown(self, target):
        for n in _c_targets(target):
            self.cur.bind(n, "unknown")

    def visit_For(self, node):
        self._unknown(node.target)
        self.generic_visit(node)

    visit_AsyncFor = visit_For

    def visit_With(self, node):
        for it in node.items:
            if it.optional_vars is not None:
                self._unknown(it.optional_vars)
        self.generic_visit(node)

    visit_AsyncWith = visit_With

    def visit_ExceptHandler(self, node):
        if node.name:
            self.cur.bind(node.name, "unknown")
        self.generic_visit(node)

    def visit_Import(self, node):
        for a in node.names:
            self.cur.bind((a.asname or a.name).split(".")[0], "module:" + (a.name if a.asname else a.name.split(".")[0]))

    def visit_ImportFrom(self, node):
        for a in node.names:
            self.cur.bind(a.asname or a.name, "unknown")

    def visit_Global(self, node):
        for n in node.names:
            self.unknown_everywhere.add(n)

    visit_Nonlocal = visit_Global

    def visit_Delete(self, node):
        for t in node.targets:
            self._unknown(t)

    def _comp(self, node):
        for g in node.generators:
            for n in _c_targets(g.target):
                self.unknown_everywhere.add(n)
        self.generic_visit(node)

    visit_ListComp = visit_SetComp = visit_DictComp = visit_GeneratorExp = _comp

    def visit_MatchAs(self, node):
        if node.name:
            self.unknown_everywhere.add(node.name)
        self.generic_visit(node)

    def visit_MatchStar(self, node):
        if node.name:
            self.unknown_everywhere.add(node.name)

    def visit_MatchMapping(self, node):
        if node.rest:
            self.unknown_everywhere.add(node.rest)
        self.generic_visit(node)


def _c_local_sig(fn, drop_self=False):
    P = _cinsp.Parameter
    a = fn.args
    params = []
    pos = a.posonlyargs + a.args
    defaults = [None] * (len(pos) - len(a.defaults)) + list(a.defaults)
    for i, arg in enumerate(pos):
        kind = P.POSITIONAL_ONLY if i < len(a.posonlyargs) else P.POSITIONAL_OR_KEYWORD
        params.append(P(arg.arg, kind, default=None if defaults[i] is not None else P.empty))
    if a.vararg:
        params.append(P(a.vararg.arg, P.VAR_POSITIONAL))
    for arg, d in zip(a.kwonlyargs, a.kw_defaults):
        params.append(P(arg.arg, P.KEYWORD_ONLY, default=None if d is not None else P.empty))
    if a.kwarg:
        params.append(P(a.kwarg.arg, P.VAR_KEYWORD))
    if drop_self and params and params[0].kind in (P.POSITIONAL_ONLY, P.POSITIONAL_OR_KEYWORD):
        params = params[1:]
    return _cinsp.Signature(params)


def _c_bind_msg(name, sig, call):
    try:
        sig.bind(*([None] * len(call.args)), **{k.arg: None for k in call.keywords})
        return None
    except TypeError as e:
        m = str(e)
    import re as _re
    r = _re.match(r"missing a required (?:positional |keyword-only )?argument: '(\w+)'", m)
    if r:
        return "%s() に渡す引数 '%s' が足りません" % (name, r.group(1))
    if m.startswith("too many positional arguments"):
        n = sum(1 for p in sig.parameters.values() if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD))
        return "%s() に渡す引数が多すぎます (受け取れるのは %d 個、渡しているのは %d 個)" % (name, n, len(call.args))
    r = _re.match(r"got an unexpected keyword argument '(\w+)'", m)
    if r:
        cands = [p for p in sig.parameters if sig.parameters[p].kind != sig.parameters[p].VAR_KEYWORD]
        sim = _c_similar(r.group(1), cands)
        return "%s() に '%s' という名前の引数はありません%s" % (name, r.group(1), (" (もしかして '%s'?)" % sim) if sim else "")
    r = _re.match(r"multiple values for argument '(\w+)'", m)
    if r:
        return "%s() の引数 '%s' を 2 回渡しています" % (name, r.group(1))
    return None


def __fct_check(code):
    try:
        tree = _cast.parse(code)
    except Exception:
        return []
    src = _CSrc(code)
    out = []

    def add(node_span, msg, severity="warning", fix=None):
        d = dict(node_span)
        d.update({"kind": "Check", "msg": msg, "severity": severity})
        if fix:
            d["fix"] = fix
        out.append(d)

    # どこかで代入・定義している名前 (組み込みの名前を上書きしているか)
    assigned = set()
    for n in _cast.walk(tree):
        if isinstance(n, _cast.Name) and isinstance(n.ctx, (_cast.Store, _cast.Del)):
            assigned.add(n.id)
        elif isinstance(n, (_cast.FunctionDef, _cast.AsyncFunctionDef, _cast.ClassDef)):
            assigned.add(n.name)
        elif isinstance(n, _cast.arg):
            assigned.add(n.arg)
        elif isinstance(n, (_cast.Import, _cast.ImportFrom)):
            for a in n.names:
                assigned.add((a.asname or a.name).split(".")[0])
    binder = _CBinder(assigned)
    binder.visit(tree)
    everywhere = binder.unknown_everywhere

    # トップレベルの関数・クラス (1 回だけ定義されているもの)
    defs = {}
    counts = {}
    for st in tree.body:
        if isinstance(st, (_cast.FunctionDef, _cast.AsyncFunctionDef, _cast.ClassDef)):
            counts[st.name] = counts.get(st.name, 0) + 1
            defs[st.name] = st
    module_scope = binder.scopes[tree]
    for name in list(defs):
        if counts[name] > 1 or len(module_scope.kinds.get(name, ())) > 1 or name in everywhere:
            defs.pop(name)

    # ---- import ----
    for st in _cast.walk(tree):
        if isinstance(st, _cast.Import):
            for a in st.names:
                top = a.name.split(".")[0]
                if top in _csys.stdlib_module_names or top in _csys.builtin_module_names:
                    continue
                try:
                    import importlib.util
                    if importlib.util.find_spec(top) is not None:
                        continue
                except Exception:
                    pass
                sim = _cdiff.get_close_matches(top, [m for m in _csys.stdlib_module_names if not m.startswith("_")], n=1, cutoff=0.8)
                if sim and len(top) >= 4 and sim[0] != top:
                    add(src.span(st), "'%s' というモジュールはありません (もしかして '%s'?)" % (top, sim[0]),
                        fix={"line": st.lineno, "old": top, "text": sim[0], "label": "'%s' に直す" % sim[0]})
        elif isinstance(st, _cast.ImportFrom) and st.level == 0 and st.module:
            mod = _c_module(st.module)
            if mod is None:
                continue
            for a in st.names:
                if a.name != "*" and not _c_has(mod, a.name):
                    sim = _c_similar(a.name, dir(mod))
                    add(src.span(st), "%s に '%s' はありません%s" % (st.module, a.name, (" (もしかして '%s'?)" % sim) if sim else ""),
                        fix={"line": st.lineno, "old": a.name, "text": sim, "label": "'%s' に直す" % sim} if sim else None)

    def scope_of(stack):
        for node in reversed(stack):
            if node in binder.scopes:
                return binder.scopes[node]
        return module_scope

    def kind_of(name, stack):
        if name in everywhere:
            return None
        return scope_of(stack).kind(name)

    def expr_kind(e, stack):
        if isinstance(e, _cast.Name):
            k = kind_of(e.id, stack)
            return k if k in ("str", "input", "list", "dict", "set", "int", "float", "tuple") else None
        k = _c_kind(e, assigned)
        return k if k in ("str", "input", "list", "dict", "set", "int", "float", "tuple") else None

    def is_num(e, stack):
        return expr_kind(e, stack) in ("int", "float")

    def input_fix(name, stack):
        # 代入している input(...) を int(input(...)) にする
        sc = scope_of(stack)
        for node in _cast.walk(sc.node):
            if isinstance(node, _cast.Assign) and any(isinstance(t, _cast.Name) and t.id == name for t in node.targets) and isinstance(node.value, _cast.Call):
                v = node.value
                if v.lineno == v.end_lineno:
                    seg = _cast.get_source_segment(code, v)
                    if seg:
                        return {"line": v.lineno, "old": seg, "text": "int(%s)" % seg, "label": "int(input(…)) にする (数に変換)"}
        return None

    def visit(node, stack):
        # ---- 文字列と数 ----
        if isinstance(node, _cast.BinOp) and isinstance(node.op, (_cast.Add, _cast.Sub, _cast.Div, _cast.FloorDiv, _cast.Pow)):
            for a, b in ((node.left, node.right), (node.right, node.left)):
                ka = expr_kind(a, stack)
                if ka in ("str", "input") and is_num(b, stack) and (isinstance(a, _cast.Name) or isinstance(node.op, _cast.Add)):
                    if ka == "input" and isinstance(a, _cast.Name):
                        add(src.span(node), "'%s' は input() の結果なので文字列 (str) です。数として計算するなら int(%s) で変換します" % (a.id, a.id),
                            fix=input_fix(a.id, stack))
                    else:
                        add(src.span(node), "文字列 (str) と数は %s できません (str(…) か int(…) で型をそろえます)" % ("足し算" if isinstance(node.op, _cast.Add) else "計算"))
                    break
        elif isinstance(node, _cast.Compare):
            items = [node.left] + node.comparators
            for i, op in enumerate(node.ops):
                if isinstance(op, (_cast.Lt, _cast.Gt, _cast.LtE, _cast.GtE)):
                    for a, b in ((items[i], items[i + 1]), (items[i + 1], items[i])):
                        if expr_kind(a, stack) == "input" and isinstance(a, _cast.Name) and is_num(b, stack):
                            add(src.span(node), "'%s' は input() の結果なので文字列 (str) です。数と大きさを比べるなら int(%s) で変換します" % (a.id, a.id),
                                fix=input_fix(a.id, stack))
                            break
        elif isinstance(node, _cast.AugAssign) and isinstance(node.target, _cast.Name) and isinstance(node.op, (_cast.Add, _cast.Sub)):
            if kind_of(node.target.id, stack) == "input" and is_num(node.value, stack):
                add(src.span(node), "'%s' は input() の結果なので文字列 (str) です。数として計算するなら int(%s) で変換します" % (node.target.id, node.target.id),
                    fix=input_fix(node.target.id, stack))

        # ---- モジュール・文字列・リストなどの属性 ----
        if isinstance(node, _cast.Attribute) and isinstance(node.ctx, _cast.Load):
            recv = node.value
            if isinstance(recv, _cast.Name):
                k = kind_of(recv.id, stack)
                if k and k.startswith("module:"):
                    mod = _c_module(k[7:])
                    if mod is not None and not _c_has(mod, node.attr):
                        sim = _c_similar(node.attr, dir(mod))
                        add(src.attr_span(node), "モジュール '%s' に '%s' はありません%s" % (recv.id, node.attr, (" (もしかして '%s'?)" % sim) if sim else ""),
                            fix={"span": True, "text": sim, "label": "'%s' に直す" % sim} if sim else None)
            tk = expr_kind(recv, stack)
            if tk == "input":
                tk = "str"
            if tk in _C_TYPES and not hasattr(_C_TYPES[tk], node.attr):
                hint = _C_JS_NAMES.get(node.attr)
                sim = _c_similar(node.attr, dir(_C_TYPES[tk]))
                extra = (" (もしかして '%s'?)" % hint) if hint else (" (もしかして '%s'?)" % sim) if sim else ""
                fixable = sim if not hint else (hint if hint.isidentifier() else None)
                add(src.attr_span(node), "%s に '%s' はありません%s" % (_C_TYPE_JA[tk], node.attr, extra),
                    fix={"span": True, "text": fixable, "label": "'%s' に直す" % fixable} if fixable else None)

        # ---- None を返すメソッド ----
        if isinstance(node, (_cast.Assign, _cast.AnnAssign)) and isinstance(node.value, _cast.Call) and isinstance(node.value.func, _cast.Attribute):
            f = node.value.func
            tk = expr_kind(f.value, stack)
            if tk in _C_NONE_METHODS and f.attr in _C_NONE_METHODS[tk]:
                tip = " (並べ替えた新しいリストがほしいときは sorted(…) を使います)" if f.attr == "sort" else ""
                add(src.span(node.value), "%s() はリストなどを直接変えて None を返すので、結果を代入すると None になります%s" % (f.attr, tip))
        if isinstance(node, _cast.Expr) and isinstance(node.value, _cast.Call) and isinstance(node.value.func, _cast.Attribute):
            f = node.value.func
            if isinstance(f.value, _cast.Name) and f.attr in _C_STR_NEW and expr_kind(f.value, stack) in ("str", "input"):
                add(src.span(node.value), "文字列は変わらないので、%s() の結果を使っていません (%s = %s.%s(…) のように代入します)" % (f.attr, f.value.id, f.value.id, f.attr),
                    "info", fix={"line": node.lineno, "old": _cast.get_source_segment(code, node.value) or "", "text": "%s = %s" % (f.value.id, _cast.get_source_segment(code, node.value) or ""), "label": "結果を %s に代入する" % f.value.id})

        # ---- 引数の数・名前 ----
        if isinstance(node, _cast.Call) and not any(isinstance(a, _cast.Starred) for a in node.args) and not any(k.arg is None for k in node.keywords):
            fn = node.func
            sig = name = None
            if isinstance(fn, _cast.Name):
                name = fn.id
                d = defs.get(name)
                if d is not None and kind_of(name, stack) in ("def", "class") and not getattr(d, "decorator_list", None):
                    if isinstance(d, _cast.ClassDef):
                        if not d.bases and not d.keywords:
                            methods = {s.name: s for s in d.body if isinstance(s, (_cast.FunctionDef, _cast.AsyncFunctionDef))}
                            if "__new__" not in methods and not any(isinstance(s, (_cast.Assign, _cast.AnnAssign)) and "__init__" in _cast.dump(s) for s in d.body):
                                init = methods.get("__init__")
                                if init is None:
                                    sig = _cinsp.Signature([])
                                elif not init.decorator_list:
                                    sig = _c_local_sig(init, drop_self=True)
                    else:
                        sig = _c_local_sig(d)
                elif name not in assigned and hasattr(_cbi, name) and name not in ("print", "super", "type", "object", "range", "dict", "max", "min", "iter", "next", "getattr", "vars", "dir", "zip", "map", "filter", "open", "int", "str", "bytes", "slice"):
                    try:
                        sig = _cinsp.signature(getattr(_cbi, name))
                    except (TypeError, ValueError):
                        sig = None
            elif isinstance(fn, _cast.Attribute) and isinstance(fn.value, _cast.Name):
                k = kind_of(fn.value.id, stack)
                if k and k.startswith("module:"):
                    mod = _c_module(k[7:])
                    obj = getattr(mod, fn.attr, None) if mod is not None else None
                    if obj is not None and (_cinsp.isbuiltin(obj) or _cinsp.isfunction(obj)):
                        try:
                            sig = _cinsp.signature(obj)
                            name = "%s.%s" % (fn.value.id, fn.attr)
                        except (TypeError, ValueError):
                            sig = None
            if sig is not None:
                msg = _c_bind_msg(name, sig, node)
                if msg:
                    add(src.span(node), msg)

        if isinstance(node, _C_SCOPES):
            stack = stack + [node]
        for child in _cast.iter_child_nodes(node):
            visit(child, stack)

    visit(tree, [tree])
    # 同じ場所の重複は 1 つに
    seen, res = set(), []
    for d in out:
        key = (d["line"], d["col"], d["msg"])
        if key not in seen:
            seen.add(key)
            res.append(d)
    return res[:60]
`
