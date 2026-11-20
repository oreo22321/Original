import{a as l,b as v,c as b,d as w,e as N,f as x}from"../chunks/chunk-A6S7RETE.js";import{loadPyodide as F}from"../../vendor/pyodide/pyodide.mjs";var C=String.raw`
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
`;var S=String.raw`
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
`;var D="/home/pyodide/project",P=["parso-0.8.6-py2.py3-none-any.whl","jedi-0.19.2-py2.py3-none-any.whl","pyflakes-4.1.0-py2.py3-none-any.whl","pycodestyle-2.15.0-py2.py3-none-any.whl","autopep8-2.3.2-py2.py3-none-any.whl"],p=s=>{let e=new URL(s,import.meta.url);return e.protocol==="file:"?decodeURIComponent(e.pathname):e.href};async function m(s){if(s.startsWith("/")&&typeof process<"u"&&process.versions&&process.versions.node){let n=await import("node:fs/promises");return new Uint8Array(await n.readFile(s))}let e=await fetch(s);if(!e.ok)throw new Error(`${s}: ${e.status}`);return new Uint8Array(await e.arrayBuffer())}var _=null,c=null;function j(){return c||(c=(async()=>{let s=p("../../vendor/pyodide/"),e=await F({indexURL:s,lockFileURL:s+"pyodide-lock.json",env:{HOME:"/home/pyodide"}});e.setStdout({batched:()=>{}}),e.setStderr({batched:()=>{}}),e.FS.mkdirTree(D),e.FS.mkdirTree("/tmp/wheels");for(let n of P)e.FS.writeFile("/tmp/wheels/"+n,await m(p("../../vendor/pywheels/"+n)));for(let[n,o]of Object.entries(b())){let r=l+"/"+n;e.FS.mkdirTree(r.slice(0,r.lastIndexOf("/"))),e.FS.writeFile(r,o)}e.runPython(L),e.runPython(C),e.runPython(S),_=e;try{e.runPython("__fct_warm()")}catch{}return e})().catch(s=>{throw c=null,s})),c}var L=`
import sys, os, json, zipfile, site, importlib, builtins
PROJECT = ${JSON.stringify(D)}
_sp = site.getsitepackages()[0]
for _w in sorted(os.listdir("/tmp/wheels")):
    zipfile.ZipFile("/tmp/wheels/" + _w).extractall(_sp)
importlib.invalidate_caches()
if PROJECT not in sys.path:
    sys.path.insert(0, PROJECT)
if ${JSON.stringify(l)} not in sys.path:
    sys.path.insert(1, ${JSON.stringify(l)})
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
`,i=(s,...e)=>{let n=_.globals.get(s);try{return n(...e)}finally{n.destroy()}},d=null,E=new Set,f=new Set,u=Promise.resolve(),A=0;function I(s){let e=new Set;for(let n of s.matchAll(/^[ \t]*(?:from[ \t]+([A-Za-z_]\w*)|import[ \t]+([A-Za-z_][\w.]*(?:[ \t]*(?:as[ \t]+\w+[ \t]*)?,[ \t]*[A-Za-z_][\w.]*)*))/gm))if(n[1])e.add(n[1]);else for(let o of n[2].split(","))e.add(o.trim().split(/[ \t.]/)[0]);return[...e].filter(Boolean)}function O(s){let e=I(s).filter(n=>!E.has(n)&&!N[n]&&!v.has(n));if(e.length){for(let n of e)E.add(n);A++,u=u.then(()=>R(e)).catch(()=>{}).finally(()=>{A--})}}async function T(s){let e=await m(s),n="/tmp/pkg-"+Math.random().toString(36).slice(2)+".whl";_.FS.writeFile(n,e),i("__fct_extract",n)}async function R(s){let e=JSON.parse(i("__fct_need",JSON.stringify(s)));if(!e.length)return;d||(d=JSON.parse(new TextDecoder().decode(await m(p("../../vendor/pyodide/pyodide-lock.json")))));let n=new Map;for(let[t,a]of Object.entries(d.packages))for(let h of a.imports||[])n.set(h,t);let o=new Set,r=[],g=t=>{if(!(o.has(t)||!d.packages[t])){o.add(t);for(let a of d.packages[t].depends||[])g(a)}};for(let t of e){let a=n.get(t);a?g(a):r.push(w[t]||t)}for(let t of o){let a=d.packages[t];if(!(f.has(t)||a.package_type&&a.package_type!=="package")){f.add(t);try{await T(x+a.file_name)}catch{}}}for(let t of r)if(!f.has(t)){f.add(t);try{let a=await fetch(`https://pypi.org/pypi/${encodeURIComponent(t)}/json`);if(!a.ok)continue;let y=((await a.json()).urls||[]).find(k=>k.packagetype==="bdist_wheel"&&/-none-any\.whl$/.test(k.filename));y&&await T(y.url)}catch{}}}self.onmessage=async s=>{let e=s.data;if(!(!e||!e.id))try{if(await j(),e.files){let o=_.toPy(e.files);try{i("__fct_files",o)}finally{o.destroy()}}let n;switch(e.type){case"lint":n=JSON.parse(i("__fct_lint",e.code,e.path||"main.py")),O(e.code);break;case"packages":O(e.code||""),await u,n=!0;break;case"complete":n=JSON.parse(i("__fct_complete",e.code,e.line,e.col,e.path||"main.py"));break;case"doc":n=JSON.parse(i("__fct_doc",e.code,e.line,e.col,e.path||"main.py",e.name));break;case"signature":n=JSON.parse(i("__fct_signature",e.code,e.line,e.col,e.path||"main.py"));break;case"help":n=JSON.parse(i("__fct_help",e.code,e.line,e.col,e.path||"main.py"));break;case"goto":n=JSON.parse(i("__fct_goto",e.code,e.line,e.col,e.path||"main.py"));break;case"refs":n=JSON.parse(i("__fct_refs",e.code,e.line,e.col,e.path||"main.py"));break;case"rename":n=JSON.parse(i("__fct_rename",e.code,e.line,e.col,e.path||"main.py",e.name));break;case"outline":n=JSON.parse(i("__fct_outline",e.code,e.path||"main.py"));break;case"format":n=i("__fct_format",e.code,e.aggressive?1:0);break;case"describe":n=JSON.parse(i("__fca_describe",e.code));break;case"review":n=JSON.parse(i("__fca_review",e.code));break;case"typehints":n=JSON.parse(i("__fca_typehints",e.code,e.from||1,e.to||1e9));break;case"warm":n=!0;break;default:throw new Error("unknown request: "+e.type)}self.postMessage({id:e.id,ok:!0,result:n})}catch(n){self.postMessage({id:e.id,ok:!1,error:String(n&&n.message||n).split(`
`).slice(-3).join(`
`)})}};
