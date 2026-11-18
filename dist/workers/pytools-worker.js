import{loadPyodide as c}from"../../vendor/pyodide/pyodide.mjs";var r=String.raw`
import ast as _ast, json as _json, builtins as _bi

class _Src:
    def __init__(self, code):
        self.code = code
        self.lines = code.split("\n")
    def ch(self, line, col):
        # バイト位置 → 文字位置
        if line is None or col is None:
            return col
        if line - 1 >= len(self.lines):
            return col
        return len(self.lines[line - 1].encode("utf-8")[:col].decode("utf-8", "ignore"))
    def seg(self, node, limit=120):
        try:
            s = _ast.get_source_segment(self.code, node) or ""
        except Exception:
            s = ""
        if not s:
            try:
                s = _ast.unparse(node)
            except Exception:
                s = ""
        s = " ".join(s.split())
        return s if len(s) <= limit else s[: limit - 1] + "…"
    def span(self, node):
        return {"line": node.lineno, "col": self.ch(node.lineno, node.col_offset),
                "endLine": getattr(node, "end_lineno", node.lineno), "endCol": self.ch(getattr(node, "end_lineno", node.lineno), getattr(node, "end_col_offset", node.col_offset))}

def _call_name(node):
    f = node.func if isinstance(node, _ast.Call) else node
    parts = []
    while isinstance(f, _ast.Attribute):
        parts.append(f.attr)
        f = f.value
    if isinstance(f, _ast.Name):
        parts.append(f.id)
    elif isinstance(f, _ast.Call):
        parts.append(_call_name(f) + "()")
    else:
        return ""
    return ".".join(reversed(parts))

def _const_type(v):
    return {bool: "bool", int: "int", float: "float", str: "str", bytes: "bytes", complex: "complex", type(None): "None"}.get(type(v), "")

def _value_info(src, v):
    d = {"src": src.seg(v)}
    if isinstance(v, _ast.Constant):
        d.update(kind="const", type=_const_type(v.value))
    elif isinstance(v, _ast.Call):
        d.update(kind="call", func=_call_name(v), nargs=len(v.args))
        if d["func"] in ("int", "float", "str") and v.args and isinstance(v.args[0], _ast.Call) and _call_name(v.args[0]) == "input":
            d.update(func="input", convert=d["func"])
    elif isinstance(v, (_ast.List, _ast.Tuple, _ast.Set)):
        d.update(kind={_ast.List: "list", _ast.Tuple: "tuple", _ast.Set: "set"}[type(v)], n=len(v.elts))
    elif isinstance(v, _ast.Dict):
        d.update(kind="dict", n=len(v.keys))
    elif isinstance(v, (_ast.ListComp, _ast.SetComp, _ast.DictComp, _ast.GeneratorExp)):
        d.update(kind="comp", of={_ast.ListComp: "list", _ast.SetComp: "set", _ast.DictComp: "dict", _ast.GeneratorExp: "gen"}[type(v)])
    elif isinstance(v, _ast.JoinedStr):
        d.update(kind="fstring")
    elif isinstance(v, _ast.BinOp):
        d.update(kind="binop", op=type(v.op).__name__)
    elif isinstance(v, _ast.BoolOp):
        d.update(kind="boolop")
    elif isinstance(v, _ast.Compare):
        d.update(kind="compare")
    elif isinstance(v, _ast.Name):
        d.update(kind="name", name=v.id)
    elif isinstance(v, _ast.Attribute):
        d.update(kind="attr")
    elif isinstance(v, _ast.Subscript):
        d.update(kind="subscript")
    elif isinstance(v, _ast.Lambda):
        d.update(kind="lambda")
    elif isinstance(v, _ast.IfExp):
        d.update(kind="ifexp")
    elif isinstance(v, _ast.UnaryOp):
        d.update(kind="unary")
    elif isinstance(v, _ast.Await):
        d.update(kind="await")
    else:
        d.update(kind="other")
    return d

def _args_info(src, a):
    out = []
    pos = a.posonlyargs + a.args
    defaults = [None] * (len(pos) - len(a.defaults)) + list(a.defaults)
    for p, dflt in zip(pos, defaults):
        out.append({"name": p.arg, "default": src.seg(dflt, 40) if dflt is not None else None, "ann": src.seg(p.annotation, 40) if p.annotation is not None else None})
    if a.vararg:
        out.append({"name": "*" + a.vararg.arg, "default": None, "ann": None})
    for p, dflt in zip(a.kwonlyargs, a.kw_defaults):
        out.append({"name": p.arg, "default": src.seg(dflt, 40) if dflt is not None else None, "ann": src.seg(p.annotation, 40) if p.annotation is not None else None, "kwonly": True})
    if a.kwarg:
        out.append({"name": "**" + a.kwarg.arg, "default": None, "ann": None})
    return out

def _describe_stmt(src, s, depth, out, cls=None):
    base = {"line": s.lineno, "end": getattr(s, "end_lineno", s.lineno), "depth": depth}
    def add(**kw):
        d = dict(base); d.update(kw); out.append(d); return d
    def body(stmts, dep, c=None):
        for x in stmts:
            if len(out) >= 400:
                return
            _describe_stmt(src, x, dep, out, c)
    if isinstance(s, (_ast.Import, _ast.ImportFrom)):
        if isinstance(s, _ast.Import):
            add(kind="import", modules=[a.name for a in s.names], aliases=[a.asname for a in s.names])
        else:
            add(kind="import", frm=s.module or "", names=[a.name for a in s.names], aliases=[a.asname for a in s.names])
    elif isinstance(s, (_ast.FunctionDef, _ast.AsyncFunctionDef)):
        calls = sorted({_call_name(n) for n in _ast.walk(s) if isinstance(n, _ast.Call)} - {""})
        rets = [n for n in _ast.walk(s) if isinstance(n, _ast.Return) and n.value is not None]
        add(kind="def", name=s.name, args=_args_info(src, s.args), doc=(_ast.get_docstring(s) or "").split("\n")[0][:120],
            returns=bool(rets), ret=[src.seg(r.value, 60) for r in rets[:3]], decorators=[src.seg(d, 40) for d in s.decorator_list], method=cls,
            async_=isinstance(s, _ast.AsyncFunctionDef), recursive=s.name in calls, calls=calls[:20],
            yields=any(isinstance(n, (_ast.Yield, _ast.YieldFrom)) for n in _ast.walk(s)), retAnn=src.seg(s.returns, 40) if s.returns is not None else None)
        body(s.body, depth + 1)
    elif isinstance(s, _ast.ClassDef):
        methods = [b.name for b in s.body if isinstance(b, (_ast.FunctionDef, _ast.AsyncFunctionDef))]
        attrs = sorted({t.attr for n in _ast.walk(s) if isinstance(n, (_ast.Assign, _ast.AnnAssign, _ast.AugAssign)) for t in (n.targets if isinstance(n, _ast.Assign) else [n.target]) if isinstance(t, _ast.Attribute) and isinstance(t.value, _ast.Name) and t.value.id == "self"})
        fields = [b.target.id for b in s.body if isinstance(b, _ast.AnnAssign) and isinstance(b.target, _ast.Name)]
        add(kind="class", name=s.name, bases=[src.seg(b, 40) for b in s.bases], doc=(_ast.get_docstring(s) or "").split("\n")[0][:120], methods=methods, attrs=attrs[:20], fields=fields[:20], decorators=[src.seg(d, 40) for d in s.decorator_list])
        body(s.body, depth + 1, s.name)
    elif isinstance(s, (_ast.Assign, _ast.AnnAssign)):
        targets = [src.seg(t, 60) for t in (s.targets if isinstance(s, _ast.Assign) else [s.target])]
        if s.value is None:
            add(kind="annassign", targets=targets, ann=src.seg(s.annotation, 40))
        else:
            add(kind="assign", targets=targets, value=_value_info(src, s.value), ann=src.seg(s.annotation, 40) if isinstance(s, _ast.AnnAssign) else None)
    elif isinstance(s, _ast.AugAssign):
        add(kind="augassign", target=src.seg(s.target, 60), op=type(s.op).__name__, value=_value_info(src, s.value))
    elif isinstance(s, (_ast.For, _ast.AsyncFor)):
        it = s.iter
        info = {"src": src.seg(it)}
        if isinstance(it, _ast.Call):
            fn = _call_name(it)
            info.update(func=fn, args=[src.seg(a, 40) for a in it.args])
        add(kind="for", target=src.seg(s.target, 40), iter=info, orelse=bool(s.orelse), hasBreak=any(isinstance(n, _ast.Break) for n in _ast.walk(s)))
        body(s.body, depth + 1)
        body(s.orelse, depth + 1)
    elif isinstance(s, _ast.While):
        always = isinstance(s.test, _ast.Constant) and bool(s.test.value)
        add(kind="while", test=src.seg(s.test), forever=always, hasBreak=any(isinstance(n, _ast.Break) for n in _ast.walk(s)))
        body(s.body, depth + 1)
        body(s.orelse, depth + 1)
    elif isinstance(s, _ast.If):
        # if __name__ == "__main__":
        main = isinstance(s.test, _ast.Compare) and isinstance(s.test.left, _ast.Name) and s.test.left.id == "__name__"
        elifs = 0
        cur = s
        while len(cur.orelse) == 1 and isinstance(cur.orelse[0], _ast.If):
            elifs += 1
            cur = cur.orelse[0]
        add(kind="if", test=src.seg(s.test), elifs=elifs, hasElse=bool(cur.orelse), main=main)
        body(s.body, depth + 1)
        cur = s
        while len(cur.orelse) == 1 and isinstance(cur.orelse[0], _ast.If):
            cur = cur.orelse[0]
            out.append({"line": cur.lineno, "end": cur.end_lineno, "depth": depth, "kind": "elif", "test": src.seg(cur.test)})
            body(cur.body, depth + 1)
        if cur.orelse:
            out.append({"line": cur.orelse[0].lineno - 1, "end": cur.orelse[-1].end_lineno, "depth": depth, "kind": "else"})
            body(cur.orelse, depth + 1)
    elif isinstance(s, (_ast.With, _ast.AsyncWith)):
        items = []
        for it in s.items:
            e = it.context_expr
            d = {"src": src.seg(e, 80), "as": src.seg(it.optional_vars, 30) if it.optional_vars is not None else None}
            if isinstance(e, _ast.Call) and _call_name(e) == "open":
                d["open"] = [src.seg(a, 40) for a in e.args]
            items.append(d)
        add(kind="with", items=items)
        body(s.body, depth + 1)
    elif isinstance(s, _ast.Try) or s.__class__.__name__ == "TryStar":
        handlers = [src.seg(h.type, 40) if h.type is not None else "" for h in s.handlers]
        add(kind="try", handlers=handlers, hasFinally=bool(s.finalbody), hasElse=bool(s.orelse))
        body(s.body, depth + 1)
        for h in s.handlers:
            out.append({"line": h.lineno, "end": h.end_lineno, "depth": depth, "kind": "except", "type": src.seg(h.type, 40) if h.type is not None else "", "name": h.name})
            body(h.body, depth + 1)
        body(s.orelse, depth + 1)
        body(s.finalbody, depth + 1)
    elif isinstance(s, _ast.Return):
        add(kind="return", value=_value_info(src, s.value) if s.value is not None else None)
    elif isinstance(s, _ast.Expr):
        v = s.value
        if isinstance(v, _ast.Constant) and isinstance(v.value, str):
            add(kind="docstring")
        elif isinstance(v, _ast.Call):
            add(kind="call", func=_call_name(v), args=[src.seg(a, 60) for a in v.args], kw=[k.arg for k in v.keywords if k.arg], src=src.seg(v))
        else:
            add(kind="expr", src=src.seg(v))
    elif isinstance(s, (_ast.Break, _ast.Continue, _ast.Pass)):
        add(kind=type(s).__name__.lower())
    elif isinstance(s, _ast.Raise):
        add(kind="raise", exc=src.seg(s.exc) if s.exc is not None else "")
    elif isinstance(s, (_ast.Global, _ast.Nonlocal)):
        add(kind=type(s).__name__.lower(), names=s.names)
    elif isinstance(s, _ast.Assert):
        add(kind="assert", test=src.seg(s.test))
    elif isinstance(s, _ast.Delete):
        add(kind="del", targets=[src.seg(t, 40) for t in s.targets])
    elif s.__class__.__name__ == "Match":
        add(kind="match", subject=src.seg(s.subject), cases=[src.seg(c.pattern, 30) for c in s.cases])
        for c in s.cases:
            body(c.body, depth + 1)
    else:
        add(kind="other", src=src.seg(s))

def __fca_describe(code):
    src = _Src(code)
    try:
        tree = _ast.parse(code)
    except SyntaxError as e:
        return _json.dumps({"ok": False, "error": {"line": e.lineno or 1, "msg": e.msg}})
    out = []
    for s in tree.body:
        if len(out) >= 400:
            break
        _describe_stmt(src, s, 0, out)
    names = set()
    feats = {}
    for n in _ast.walk(tree):
        if isinstance(n, _ast.Call):
            fn = _call_name(n)
            if fn == "input": feats["input"] = True
            elif fn == "print": feats["print"] = True
            elif fn == "open": feats["files"] = True
            elif fn.startswith("random."): feats["random"] = True
            elif fn.startswith(("plt.", "matplotlib")): feats["plot"] = True
            elif fn.startswith(("time.sleep",)): feats["sleep"] = True
        elif isinstance(n, (_ast.ListComp, _ast.DictComp, _ast.SetComp, _ast.GeneratorExp)):
            feats["comprehension"] = True
        elif isinstance(n, _ast.Try):
            feats["exceptions"] = True
        elif isinstance(n, _ast.ClassDef):
            feats["classes"] = True
        elif isinstance(n, (_ast.For, _ast.While)):
            feats["loops"] = True
        elif isinstance(n, _ast.Lambda):
            feats["lambda"] = True
    mods = []
    for n in _ast.walk(tree):
        if isinstance(n, _ast.Import):
            mods += [a.name for a in n.names]
        elif isinstance(n, _ast.ImportFrom) and n.module:
            mods.append(n.module)
    return _json.dumps({"ok": True, "stmts": out, "features": feats, "modules": sorted(set(mods)), "lines": len(src.lines)})

# ---- レビュー ----
_BUILTIN_NAMES = {"list", "dict", "str", "int", "float", "set", "tuple", "sum", "max", "min", "len", "input", "print", "id", "type", "range", "map", "filter", "sorted", "open", "file", "bool", "object", "any", "all", "next", "iter", "format", "hash", "abs", "round", "zip", "vars", "dir", "help", "compile", "exec", "eval"}

def _edit(src, node, text):
    d = src.span(node)
    d["text"] = text
    return d

def __fca_review(code):
    src = _Src(code)
    try:
        tree = _ast.parse(code)
    except SyntaxError as e:
        return _json.dumps({"ok": False, "error": {"line": e.lineno or 1, "msg": e.msg}})
    found = []
    def add(kind, node, sev="warning", edits=None, **kw):
        if len(found) >= 200:
            return
        d = {"kind": kind, "severity": sev, "line": node.lineno, "endLine": getattr(node, "end_lineno", node.lineno)}
        d.update(kw)
        if edits:
            d["edits"] = edits
        found.append(d)
    parents = {}
    for p in _ast.walk(tree):
        for c in _ast.iter_child_nodes(p):
            parents[c] = p
    def in_loop(n):
        while n in parents:
            n = parents[n]
            if isinstance(n, (_ast.For, _ast.While, _ast.AsyncFor)):
                return True
            if isinstance(n, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
                return False
        return False
    input_names = set()
    for n in _ast.walk(tree):
        if isinstance(n, _ast.Assign) and isinstance(n.value, _ast.Call) and _call_name(n.value) == "input":
            for t in n.targets:
                if isinstance(t, _ast.Name):
                    input_names.add(t.id)
    def num(n):
        return isinstance(n, _ast.Constant) and isinstance(n.value, (int, float)) and not isinstance(n.value, bool)
    for n in _ast.walk(tree):
        if isinstance(n, _ast.Compare):
            # == None / != None
            for op, right in zip(n.ops, n.comparators):
                if isinstance(op, (_ast.Eq, _ast.NotEq)) and isinstance(right, _ast.Constant) and right.value is None and len(n.ops) == 1:
                    new = _ast.Compare(left=n.left, ops=[_ast.Is() if isinstance(op, _ast.Eq) else _ast.IsNot()], comparators=[right])
                    add("eq_none", n, "info", [_edit(src, n, _ast.unparse(new))], code=src.seg(n))
                if isinstance(op, (_ast.Eq, _ast.NotEq)) and isinstance(right, _ast.Constant) and isinstance(right.value, bool) and len(n.ops) == 1:
                    want = right.value if isinstance(op, _ast.Eq) else not right.value
                    left = src.seg(n.left, 200)
                    add("eq_bool", n, "info", [_edit(src, n, left if want else "not " + left)], code=src.seg(n))
            # type(x) == T
            if len(n.ops) == 1 and isinstance(n.ops[0], _ast.Eq) and isinstance(n.left, _ast.Call) and _call_name(n.left) == "type" and len(n.left.args) == 1:
                add("type_eq", n, "info", [_edit(src, n, f"isinstance({src.seg(n.left.args[0], 200)}, {src.seg(n.comparators[0], 200)})")], code=src.seg(n))
            # len(x) == 0
            if len(n.ops) == 1 and isinstance(n.ops[0], _ast.Eq) and isinstance(n.left, _ast.Call) and _call_name(n.left) == "len" and len(n.left.args) == 1 and isinstance(n.comparators[0], _ast.Constant) and n.comparators[0].value == 0:
                add("len_zero", n, "info", [_edit(src, n, "not " + src.seg(n.left.args[0], 200))], code=src.seg(n))
            # input() の文字列と数値を比べる
            for a, b in [(n.left, n.comparators[0])] if len(n.comparators) == 1 else []:
                for x, y in ((a, b), (b, a)):
                    if isinstance(x, _ast.Name) and x.id in input_names and num(y) and isinstance(n.ops[0], (_ast.Lt, _ast.Gt, _ast.LtE, _ast.GtE, _ast.Eq)):
                        add("input_str", n, "warning", name=x.id)
        elif isinstance(n, _ast.BinOp):
            for x, y in ((n.left, n.right), (n.right, n.left)):
                if isinstance(x, _ast.Name) and x.id in input_names and num(y) and isinstance(n.op, (_ast.Add, _ast.Sub, _ast.Mult, _ast.Div, _ast.FloorDiv, _ast.Mod, _ast.Pow)):
                    add("input_str", n, "warning", name=x.id)
        elif isinstance(n, _ast.ExceptHandler):
            if n.type is None:
                line = src.lines[n.lineno - 1]
                col = line.index("except")
                add("bare_except", n, "warning", [{"line": n.lineno, "col": col, "endLine": n.lineno, "endCol": col + len("except"), "text": "except Exception"}])
            if len(n.body) == 1 and isinstance(n.body[0], _ast.Pass):
                add("except_pass", n, "warning")
        elif isinstance(n, (_ast.FunctionDef, _ast.AsyncFunctionDef)):
            a = n.args
            pos = a.posonlyargs + a.args
            for p, dflt in list(zip(pos[len(pos) - len(a.defaults):], a.defaults)) + [(p, d) for p, d in zip(a.kwonlyargs, a.kw_defaults) if d is not None]:
                if isinstance(dflt, (_ast.List, _ast.Dict, _ast.Set)) or (isinstance(dflt, _ast.Call) and _call_name(dflt) in ("list", "dict", "set")):
                    edits = [_edit(src, dflt, "None")]
                    first = n.body[0]
                    if isinstance(first, _ast.Expr) and isinstance(getattr(first, "value", None), _ast.Constant) and isinstance(first.value.value, str) and len(n.body) > 1:
                        first = n.body[1]
                    ind = src.lines[first.lineno - 1][: src.ch(first.lineno, first.col_offset)]
                    edits.append({"line": first.lineno, "col": 0, "endLine": first.lineno, "endCol": 0, "text": f"{ind}if {p.arg} is None:\n{ind}    {p.arg} = {src.seg(dflt, 200)}\n"})
                    add("mutable_default", dflt, "warning", edits, name=p.arg, func=n.name)
            size = (n.end_lineno or n.lineno) - n.lineno + 1
            if size > 60:
                add("long_function", n, "info", name=n.name, size=size)
            if n.name in _BUILTIN_NAMES:
                add("shadow_builtin", n, "warning", name=n.name)
        elif isinstance(n, (_ast.Assign, _ast.AugAssign, _ast.AnnAssign)):
            targets = n.targets if isinstance(n, _ast.Assign) else [n.target]
            for t in targets:
                if isinstance(t, _ast.Name) and t.id in _BUILTIN_NAMES and isinstance(n, _ast.Assign):
                    add("shadow_builtin", t, "warning", name=t.id)
            if isinstance(n, _ast.AugAssign) and isinstance(n.op, _ast.Add) and in_loop(n) and (isinstance(n.value, (_ast.JoinedStr,)) or (isinstance(n.value, _ast.Constant) and isinstance(n.value.value, str)) or (isinstance(n.value, _ast.BinOp) and any(isinstance(x, _ast.Constant) and isinstance(x.value, str) for x in (n.value.left, n.value.right)))):
                add("str_concat_loop", n, "info", name=src.seg(n.target, 30))
            if isinstance(n, _ast.Assign) and isinstance(n.value, _ast.Call) and _call_name(n.value) == "open" and not in_loop(n):
                add("open_no_with", n, "info")
        elif isinstance(n, _ast.Global):
            add("global", n, "info", names=n.names)
        elif isinstance(n, _ast.While):
            if isinstance(n.test, _ast.Constant) and n.test.value and not any(isinstance(x, (_ast.Break, _ast.Return, _ast.Raise)) for x in _ast.walk(n)) and not any(isinstance(x, _ast.Call) and _call_name(x) in ("sys.exit", "exit", "quit") for x in _ast.walk(n)):
                add("infinite_loop", n, "warning")
        elif isinstance(n, _ast.For):
            it = n.iter
            if isinstance(it, _ast.Call) and _call_name(it) == "range" and len(it.args) == 1 and isinstance(it.args[0], _ast.Call) and _call_name(it.args[0]) == "len" and len(it.args[0].args) == 1 and isinstance(n.target, _ast.Name):
                add("range_len", n, "info", name=n.target.id, seq=src.seg(it.args[0].args[0], 40))
        if isinstance(n, _ast.Call) and _call_name(n) == "open":
            mode = None
            if len(n.args) > 1 and isinstance(n.args[1], _ast.Constant):
                mode = n.args[1].value
            for k in n.keywords:
                if k.arg == "mode" and isinstance(k.value, _ast.Constant):
                    mode = k.value.value
            if not any(k.arg == "encoding" for k in n.keywords) and not (isinstance(mode, str) and "b" in mode) and n.args:
                end_line = n.end_lineno
                endc = src.ch(end_line, n.end_col_offset) - 1
                add("open_encoding", n, "info", [{"line": end_line, "col": endc, "endLine": end_line, "endCol": endc, "text": ', encoding="utf-8"'}])
    # 深い入れ子
    def depth_of(n, d=0):
        best = d
        for c in _ast.iter_child_nodes(n):
            if isinstance(c, (_ast.For, _ast.While, _ast.If, _ast.With, _ast.Try)):
                best = max(best, depth_of(c, d + 1))
            elif not isinstance(c, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
                best = max(best, depth_of(c, d))
        return best
    for n in _ast.walk(tree):
        if isinstance(n, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.Module)):
            dd = depth_of(n)
            if dd >= 5:
                add("deep_nesting", n if not isinstance(n, _ast.Module) else n.body[0], "info", depth=dd, name=getattr(n, "name", ""))
    found.sort(key=lambda d: d["line"])
    return _json.dumps({"ok": True, "findings": found})

# ---- 型ヒント ----
def _ann_of(node):
    if isinstance(node, _ast.Constant):
        t = _const_type(node.value)
        return None if t in ("", "None") else t
    if isinstance(node, _ast.JoinedStr):
        return "str"
    if isinstance(node, (_ast.List, _ast.ListComp)):
        return "list"
    if isinstance(node, (_ast.Dict, _ast.DictComp)):
        return "dict"
    if isinstance(node, (_ast.Set, _ast.SetComp)):
        return "set"
    if isinstance(node, _ast.Tuple):
        return "tuple"
    if isinstance(node, (_ast.Compare, _ast.BoolOp)) or (isinstance(node, _ast.UnaryOp) and isinstance(node.op, _ast.Not)):
        return "bool"
    if isinstance(node, _ast.Call):
        fn = _call_name(node)
        if fn in ("int", "float", "str", "bool", "list", "dict", "set", "tuple", "len", "input", "round", "sorted"):
            return {"len": "int", "input": "str", "round": "int" if len(node.args) < 2 else "float", "sorted": "list"}.get(fn, fn)
        if fn.endswith((".join", ".upper", ".lower", ".strip", ".replace", ".format")):
            return "str"
    if isinstance(node, _ast.BinOp) and isinstance(node.op, _ast.Div):
        return "float"
    return None

def __fca_typehints(code, line_from=1, line_to=10 ** 9):
    src = _Src(code)
    try:
        tree = _ast.parse(code)
    except SyntaxError as e:
        return _json.dumps({"ok": False, "error": {"line": e.lineno or 1, "msg": e.msg}})
    edits = []
    count = 0
    for n in _ast.walk(tree):
        if not isinstance(n, (_ast.FunctionDef, _ast.AsyncFunctionDef)) or not (line_from <= n.lineno <= line_to):
            continue
        a = n.args
        pos = a.posonlyargs + a.args
        defaults = [None] * (len(pos) - len(a.defaults)) + list(a.defaults)
        for p, dflt in list(zip(pos, defaults)) + list(zip(a.kwonlyargs, a.kw_defaults)):
            if p.annotation is not None or p.arg in ("self", "cls"):
                continue
            t = _ann_of(dflt) if dflt is not None else None
            if dflt is not None and isinstance(dflt, _ast.Constant) and dflt.value is None:
                t = None
            if t:
                e = src.span(p)
                d = src.span(dflt)
                if d["line"] == e["line"]:
                    # b=2 → b: int = 2 (型ヒントがあるときは = の前後に空白)
                    edits.append({"line": e["line"], "col": e["endCol"], "endLine": d["line"], "endCol": d["col"], "text": ": " + t + " = "})
                else:
                    edits.append({"line": e["line"], "col": e["endCol"], "endLine": e["line"], "endCol": e["endCol"], "text": ": " + t})
                count += 1
        if n.returns is None and n.name != "__init__":
            rets = [r for r in _ast.walk(n) if isinstance(r, _ast.Return)]
            # 入れ子の関数の return は除く
            inner = {r for f in _ast.walk(n) if f is not n and isinstance(f, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.Lambda)) for r in _ast.walk(f) if isinstance(r, _ast.Return)}
            rets = [r for r in rets if r not in inner]
            yields = any(isinstance(x, (_ast.Yield, _ast.YieldFrom)) for x in _ast.walk(n))
            t = None
            if yields:
                t = None
            elif not rets or all(r.value is None or (isinstance(r.value, _ast.Constant) and r.value.value is None) for r in rets):
                t = "None"
            else:
                kinds = {_ann_of(r.value) if r.value is not None else "None" for r in rets}
                if len(kinds) == 1 and None not in kinds:
                    t = kinds.pop()
                elif kinds == {"int", "float"}:
                    t = "float"
            if t:
                # ) の後ろ、: の前に入れる
                line = n.body[0].lineno if n.body else n.lineno
                head_end = None
                for i in range(n.lineno - 1, min(len(src.lines), line)):
                    text = src.lines[i]
                    stripped = text.split("#")[0].rstrip()
                    if stripped.endswith(":"):
                        head_end = (i + 1, len(stripped) - 1)
                        break
                if head_end:
                    edits.append({"line": head_end[0], "col": head_end[1], "endLine": head_end[0], "endCol": head_end[1], "text": " -> " + t})
                    count += 1
    return _json.dumps({"ok": True, "edits": edits, "count": count})
`;var l="/home/pyodide/project",f=["parso-0.8.6-py2.py3-none-any.whl","jedi-0.19.2-py2.py3-none-any.whl","pyflakes-4.1.0-py2.py3-none-any.whl","pycodestyle-2.15.0-py2.py3-none-any.whl","autopep8-2.3.2-py2.py3-none-any.whl"],d=s=>{let e=new URL(s,import.meta.url);return e.protocol==="file:"?decodeURIComponent(e.pathname):e.href};async function _(s){if(s.startsWith("/")&&typeof process<"u"&&process.versions&&process.versions.node){let n=await import("node:fs/promises");return new Uint8Array(await n.readFile(s))}let e=await fetch(s);if(!e.ok)throw new Error(`${s}: ${e.status}`);return new Uint8Array(await e.arrayBuffer())}var i=null,a=null;function p(){return a||(a=(async()=>{let s=d("../../vendor/pyodide/"),e=await c({indexURL:s,lockFileURL:s+"pyodide-lock.json",env:{HOME:"/home/pyodide"}});e.setStdout({batched:()=>{}}),e.setStderr({batched:()=>{}}),e.FS.mkdirTree(l),e.FS.mkdirTree("/tmp/wheels");for(let n of f)e.FS.writeFile("/tmp/wheels/"+n,await _(d("../../vendor/pywheels/"+n)));e.runPython(u),e.runPython(r),i=e;try{e.runPython("__fct_warm()")}catch{}return e})().catch(s=>{throw a=null,s})),a}var u=`
import sys, os, json, zipfile, site, importlib
PROJECT = ${JSON.stringify(l)}
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
`,t=(s,...e)=>{let n=i.globals.get(s);try{return n(...e)}finally{n.destroy()}};self.onmessage=async s=>{let e=s.data;if(!(!e||!e.id))try{if(await p(),e.files){let o=i.toPy(e.files);try{t("__fct_files",o)}finally{o.destroy()}}let n;switch(e.type){case"lint":n=JSON.parse(t("__fct_lint",e.code,e.path||"main.py"));break;case"complete":n=JSON.parse(t("__fct_complete",e.code,e.line,e.col,e.path||"main.py"));break;case"doc":n=JSON.parse(t("__fct_doc",e.code,e.line,e.col,e.path||"main.py",e.name));break;case"signature":n=JSON.parse(t("__fct_signature",e.code,e.line,e.col,e.path||"main.py"));break;case"help":n=JSON.parse(t("__fct_help",e.code,e.line,e.col,e.path||"main.py"));break;case"goto":n=JSON.parse(t("__fct_goto",e.code,e.line,e.col,e.path||"main.py"));break;case"refs":n=JSON.parse(t("__fct_refs",e.code,e.line,e.col,e.path||"main.py"));break;case"rename":n=JSON.parse(t("__fct_rename",e.code,e.line,e.col,e.path||"main.py",e.name));break;case"outline":n=JSON.parse(t("__fct_outline",e.code,e.path||"main.py"));break;case"format":n=t("__fct_format",e.code,e.aggressive?1:0);break;case"describe":n=JSON.parse(t("__fca_describe",e.code));break;case"review":n=JSON.parse(t("__fca_review",e.code));break;case"typehints":n=JSON.parse(t("__fca_typehints",e.code,e.from||1,e.to||1e9));break;case"warm":n=!0;break;default:throw new Error("unknown request: "+e.type)}self.postMessage({id:e.id,ok:!0,result:n})}catch(n){self.postMessage({id:e.id,ok:!1,error:String(n&&n.message||n).split(`
`).slice(-3).join(`
`)})}};
