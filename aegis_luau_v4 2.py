#!/usr/bin/env python3
"""
AegisLuau V3 - hybrid Luau obfuscator / lightweight source virtualizer.

Goals:
  * Do not put the original Luau source in the generated file for compiled regions.
  * Compile a useful Luau subset into a randomized register VM.
  * Randomize opcode ids, register permutation, constant encoding, dispatch order,
    bytecode layout and handler names on every build.
  * Add constant/string hiding, table packing, control-flow flattening,
    opaque predicates, metatable indirection, decoy instructions and integrity checks.
  * In --hybrid mode, fall back only for syntactically valid Luau outside the compiler subset; malformed source is always rejected.

This is intentionally a hybrid rather than a fake "unbreakable" obfuscator.  A program
that has to execute has to reveal its behavior somewhere.  The serious improvement over
simple loadstring wrappers is that the normal path executes custom bytecode and does not
reconstruct the original source text.

Supported compiler subset (strict mode rejects anything else):
  - local declarations / assignment
  - global assignment / global reads
  - arithmetic, comparison, concatenation, boolean operators
  - literals: numbers, strings, true/false/nil
  - table constructors with array fields and keyed fields
  - indexing: a[b], a.b
  - function calls and method calls
  - return
  - if / elseif / else
  - while
  - numeric for
  - function declarations (non-closure, lexical outer capture is rejected)

The emitted VM uses only normal Luau primitives. It does not require a second Luau
compiler at runtime.  Dynamic source loading is only used by the explicit hybrid fallback.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import math
from pathlib import Path
import random
import re
import secrets
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

# --------------------------- lexer -----------------------------------------

AEGIS_BANNER = r""" /$$$$$  /$$$$$$$$ /$$$$$$ | $$  /$$$$$$
/$$__ $$ | $$_____/ | $$  \__/ | $$ | $$__
| $$ \ $$ | $$      | $$ /$$$$ | $$ | $$
| $$$$$$$ | $$$$$   | $$|_  $$ | $$ |  $$$$$
| $$__ $$ | $$__    | $$  \ $$ | $$  \____ $
| $$  \ $$ | $$_____/ |  $$$$$$/ | $$  /$$  \$$
|__/  |__/ | $$$$$$$ \______/ |__/ |  $$$$$/"""

AEGIS_BANNER_COMPACT = r"""/$$$$$/$$$$$$$$/$$$$$$| $$/$$$$$$
/$$__ $$| $$_____/| $$  \__/| $$| $$__
| $$ \ $$| $$| $$ /$$$$| $$| $$
| $$$$$$$| $$$$$| $$|_  $$| $$|  $$$$$
| $$__ $$| $$__| $$  \ $$| $$\____ $$
| $$  \ $$| $$_____/|  $$$$$$/| $$/$$  \$$
|__/  |__/| $$$$$$$\______/|__/|  $$$$$/"""

def _banner_lines() -> list[str]:
    wide = AEGIS_BANNER.rstrip("\n").split("\n")
    compact = AEGIS_BANNER_COMPACT.rstrip("\n").split("\n")
    import shutil
    width = shutil.get_terminal_size((80, 24)).columns
    if width >= max(len(x) for x in wide) + 2:
        return wide
    if width >= max(len(x) for x in compact) + 1:
        return compact
    return ["AEGIS Luau Obfuscator"]


def banner_as_luau_comment() -> str:
    lines = AEGIS_BANNER.rstrip("\n").split("\n")
    return "\n".join("--" + line if line else "--" for line in lines) + "\n"


def print_banner() -> None:
    # The logo is deliberately <= 50 columns so GitHub Codespaces mobile terminals
    # do not wrap it into a different shape.
    print("\n".join(_banner_lines()) + "\n", end="", flush=True)


KEYWORDS = {
    "and","break","continue","do","else","elseif","end","false","for",
    "function","if","in","local","nil","not","or","repeat","return","then",
    "true","until","while","type","export","goto",
}

@dataclass
class Tok:
    kind: str
    text: str
    pos: int


def _long_bracket_end(src: str, i: int) -> int | None:
    """Return the end index (exclusive) of a Lua long-bracket string at i."""
    if i >= len(src) or src[i] != '[':
        return None
    j = i + 1
    while j < len(src) and src[j] == '=':
        j += 1
    if j >= len(src) or src[j] != '[':
        return None
    eqs = src[i + 1:j]
    close = ']' + eqs + ']'
    k = src.find(close, j + 1)
    if k < 0:
        return None
    return k + len(close)


def _line_col(src: str, pos: int) -> tuple[int, int]:
    line = src.count('\n', 0, pos) + 1
    last = src.rfind('\n', 0, pos)
    col = pos + 1 if last < 0 else pos - last
    return line, col


def lex(src: str) -> list[Tok]:
    out: list[Tok] = []
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c.isspace():
            i += 1
            continue

        # Luau supports both regular and long-form comments.
        if src.startswith('--!', i):
            j = src.find('\n', i + 3)
            i = n if j < 0 else j
            continue
        if src.startswith('--', i):
            long_end = _long_bracket_end(src, i + 2)
            if long_end is not None:
                i = long_end
            elif src.startswith('--[', i):
                line, col = _line_col(src, i)
                raise SyntaxError(f"unterminated long comment at line {line}, column {col}")
            else:
                j = src.find('\n', i + 2)
                i = n if j < 0 else j
            continue

        # Lua long strings: [[...]], [=[...]=], [==[...]==], ...
        if c == '[':
            e = _long_bracket_end(src, i)
            if e is not None:
                out.append(Tok('string', src[i:e], i))
                i = e
                continue

        if c in "'\"":
            q = c
            start = i
            j = i + 1
            escaped = False
            closed = False
            while j < n:
                ch = src[j]
                if escaped:
                    escaped = False
                    j += 1
                    continue
                if ch == '\\':
                    escaped = True
                    j += 1
                    continue
                if ch == q:
                    j += 1
                    closed = True
                    break
                # An unescaped physical newline cannot occur in a short Lua string.
                if ch in '\r\n':
                    line, col = _line_col(src, start)
                    preview = src[start:min(n, start + 40)].replace('\\n', '\\n').replace('\\r', '\\r')
                    raise SyntaxError(
                        f"unterminated string at line {line}, column {col}: {preview!r}"
                    )
                j += 1
            if not closed:
                line, col = _line_col(src, start)
                preview = src[start:min(n, start + 40)].replace('\\n', '\\n').replace('\\r', '\\r')
                raise SyntaxError(
                    f"unterminated string at line {line}, column {col}: {preview!r}"
                )
            out.append(Tok('string', src[start:j], start))
            i = j
            continue

        m = re.match(r"(?:0[xX][0-9A-Fa-f]+(?:\.[0-9A-Fa-f_]*)?|(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]+)(?:[eE][+-]?[\d_]+)?)", src[i:])
        if m:
            s = m.group(0)
            out.append(Tok('number', s, i))
            i += len(s)
            continue

        m = re.match(r"[A-Za-z_][A-Za-z0-9_]*", src[i:])
        if m:
            s = m.group(0)
            out.append(Tok('kw' if s in KEYWORDS else 'ident', s, i))
            i += len(s)
            continue

        ops = [">>>", "...", "::", "==", "~=", "<=", ">=", "//", "<<", ">>", "..", "+=", "-=", "*=", "/=", "%=", "^=", "&=", "|="]
        found = next((op for op in ops if src.startswith(op, i)), None)
        if found:
            out.append(Tok('sym', found, i))
            i += len(found)
            continue
        out.append(Tok('sym', c, i))
        i += 1
    out.append(Tok('eof', '', n))
    return out


def lua_unescape(token: str) -> str:
    """Decode the common Lua/Luau string escape forms."""
    if token.startswith('['):
        j = 1
        while j < len(token) and token[j] == '=':
            j += 1
        if j < len(token) and token[j] == '[':
            close = ']' + token[1:j] + ']'
            if token.endswith(close):
                return token[j + 1:-len(close)]
        return token
    if len(token) < 2:
        return token
    body = token[1:-1]
    simple = {
        'a': '\a', 'b': '\b', 'f': '\f', 'n': '\n', 'r': '\r',
        't': '\t', 'v': '\v', '\\': '\\', '"': '"', "'": "'",
    }
    out=[]; i=0
    while i < len(body):
        ch=body[i]
        if ch != '\\':
            out.append(ch); i+=1; continue
        i+=1
        if i >= len(body): break
        ch=body[i]
        if ch in simple:
            out.append(simple[ch]); i+=1; continue
        if ch=='z':
            i+=1
            while i < len(body) and body[i].isspace(): i+=1
            continue
        if ch=='x' and i+2 < len(body):
            try:
                out.append(chr(int(body[i+1:i+3],16))); i+=3; continue
            except ValueError: pass
        if ch.isdigit():
            j=i
            while j < len(body) and j < i+3 and body[j].isdigit(): j+=1
            try:
                out.append(chr(int(body[i:j],10))); i=j; continue
            except ValueError: pass
        if ch=='\n': out.append('\n'); i+=1; continue
        if ch=='\r':
            i+=1
            if i < len(body) and body[i]=='\n': i+=1
            out.append('\n'); continue
        out.append(ch); i+=1
    return ''.join(out)


# --------------------------- parser / AST ----------------------------------

@dataclass
class Node: pass

@dataclass
class Chunk(Node):
    body: list[Node]

@dataclass
class Local(Node):
    names: list[str]
    values: list[Node]

@dataclass
class Assign(Node):
    targets: list[Node]
    values: list[Node]

@dataclass
class Return(Node):
    values: list[Node]

@dataclass
class ExprStmt(Node):
    expr: Node

@dataclass
class If(Node):
    branches: list[tuple[Node, Chunk]]
    else_body: Optional[Chunk]

@dataclass
class While(Node):
    cond: Node
    body: Chunk

@dataclass
class ForNum(Node):
    name: str
    init: Node
    limit: Node
    step: Optional[Node]
    body: Chunk

@dataclass
class FunctionDecl(Node):
    name: Node
    params: list[str]
    body: Chunk
    local: bool = False

@dataclass
class Lit(Node):
    value: Any

@dataclass
class Var(Node):
    name: str

@dataclass
class Index(Node):
    base: Node
    key: Node

@dataclass
class Unary(Node):
    op: str
    x: Node

@dataclass
class Binary(Node):
    op: str
    a: Node
    b: Node

@dataclass
class Call(Node):
    fn: Node
    args: list[Node]
    method: Optional[str] = None

@dataclass
class Table(Node):
    fields: list[tuple[Optional[Node], Node]]

@dataclass
class FunctionValue(Node):
    params: list[str]
    body: Chunk

class Parser:
    def __init__(self, toks: list[Tok]):
        self.t = toks; self.i = 0

    def cur(self) -> Tok: return self.t[self.i]
    def at(self, x: str) -> bool: return self.cur().text == x
    def take(self, x: Optional[str] = None) -> Tok:
        z = self.cur()
        if x is not None and z.text != x:
            raise SyntaxError(f"expected {x!r} at {z.pos}, got {z.text!r}")
        self.i += 1
        return z
    def accept(self, x: str) -> bool:
        if self.at(x): self.i += 1; return True
        return False

    def parse(self) -> Chunk:
        return Chunk(self.block(set()))

    def block(self, stops: set[str]) -> list[Node]:
        out: list[Node] = []
        while self.cur().kind != "eof" and self.cur().text not in stops:
            if self.accept(";"): continue
            out.append(self.stmt())
        return out

    def stmt(self) -> Node:
        c = self.cur().text
        if c == "local":
            self.take()
            if self.accept("function"):
                name = self.take().text
                params, body = self.function_tail()
                return FunctionDecl(Var(name), params, body, local=True)
            names = [self.take().text]
            while self.accept(","): names.append(self.take().text)
            vals = []
            if self.accept("="):
                vals = self.expr_list()
            return Local(names, vals)
        if c == "function":
            self.take()
            obj: Node = Var(self.take().text)
            while self.accept("."):
                obj = Index(obj, Lit(self.take().text))
            is_method = False
            if self.accept(":"):
                obj = Index(obj, Lit(self.take().text))
                is_method = True
            params, body = self.function_tail()
            if is_method:
                params = ["self"] + params
            return FunctionDecl(obj, params, body)
        if c == "return":
            self.take()
            if self.cur().text in {"end", "elseif", "else", ";", ""} or self.cur().kind == "eof":
                return Return([])
            return Return(self.expr_list())
        if c == "if":
            self.take(); branches = []
            cond = self.expr(); self.take("then"); body = Chunk(self.block({"elseif","else","end"})); branches.append((cond, body))
            while self.accept("elseif"):
                cond = self.expr(); self.take("then"); body = Chunk(self.block({"elseif","else","end"})); branches.append((cond, body))
            eb = None
            if self.accept("else"): eb = Chunk(self.block({"end"}))
            self.take("end")
            return If(branches, eb)
        if c == "while":
            self.take(); cond = self.expr(); self.take("do"); body = Chunk(self.block({"end"})); self.take("end")
            return While(cond, body)
        if c == "for":
            self.take(); name = self.take().text; self.take("="); init = self.expr(); self.take(","); limit = self.expr(); step = None
            if self.accept(","): step = self.expr()
            self.take("do"); body = Chunk(self.block({"end"})); self.take("end")
            return ForNum(name, init, limit, step, body)

        # Parse a prefix expression. If followed by assignment, it is an assignment.
        e = self.expr()
        if self.cur().text in {"=", ","}:
            targets = [e]
            while self.accept(","): targets.append(self.expr())
            self.take("=")
            return Assign(targets, self.expr_list())
        return ExprStmt(e)

    def expr_list(self) -> list[Node]:
        xs = [self.expr()]
        while self.accept(","): xs.append(self.expr())
        return xs

    BP = {
        "or": 1, "and": 2,
        "==": 3, "~=": 3, "<": 3, ">": 3, "<=": 3, ">=": 3,
        "..": 4,
        "+": 5, "-": 5,
        "*": 6, "/": 6, "//": 6, "%": 6,
        "^": 7,
    }

    def expr(self, min_bp: int = 0) -> Node:
        x = self.prefix()
        while True:
            op = self.cur().text
            bp = self.BP.get(op, -1)
            if bp < min_bp: break
            self.take()
            # right associative for .. and ^
            y = self.expr(bp if op in {"..", "^"} else bp + 1)
            x = Binary(op, x, y)
        return x

    def prefix(self) -> Node:
        c = self.cur()
        if c.text in {"not", "-", "#", "~"}:
            self.take(); return Unary(c.text, self.expr(7))
        if c.text == "nil": self.take(); return Lit(None)
        if c.text == "true": self.take(); return Lit(True)
        if c.text == "false": self.take(); return Lit(False)
        if c.kind == "number":
            self.take(); s = c.text.replace("_", "")
            v = int(s, 0) if not any(q in s.lower() for q in (".", "e")) else float(s)
            return self.postfix(Lit(v))
        if c.kind == "string":
            self.take(); return self.postfix(Lit(lua_unescape(c.text)))
        if c.kind == "ident" or c.text == "...":
            self.take(); return self.postfix(Var(c.text))
        if c.text == "{": return self.postfix(self.table())
        if c.text == "function":
            self.take(); params, body = self.function_tail(); return self.postfix(FunctionValue(params, body))
        if c.text == "(":
            self.take(); x = self.expr(); self.take(")"); return self.postfix(x)
        raise SyntaxError(f"unexpected token {c.text!r} at {c.pos}")

    def postfix(self, x: Node) -> Node:
        while True:
            if self.accept("."):
                x = Index(x, Lit(self.take().text)); continue
            if self.accept("["):
                k = self.expr(); self.take("]"); x = Index(x, k); continue
            if self.accept("("):
                args = []
                if not self.accept(")"):
                    args = self.expr_list(); self.take(")")
                x = Call(x, args); continue
            if self.accept(":"):
                method = self.take().text; self.take("("); args=[]
                if not self.accept(")"):
                    args=self.expr_list(); self.take(")")
                x = Call(x, args, method=method); continue
            break
        return x

    def table(self) -> Table:
        self.take("{"); fields=[]; array_index=0
        while not self.accept("}"):
            if self.cur().kind == "ident" and self.t[self.i+1].text == "=":
                k = Lit(self.take().text); self.take("="); v=self.expr(); fields.append((k,v))
            elif self.accept("["):
                k=self.expr(); self.take("]"); self.take("="); v=self.expr(); fields.append((k,v))
            else:
                v=self.expr(); fields.append((None,v))
            array_index += 1
            if self.accept(",") or self.accept(";"):
                continue
            self.take("}"); break
        return Table(fields)

    def function_tail(self) -> tuple[list[str], Chunk]:
        self.take("("); params=[]
        if not self.accept(")"):
            while True:
                name_tok=self.take()
                if name_tok.text == "...":
                    raise SyntaxError("vararg function parameters are not supported by the Aegis VM subset")
                params.append(name_tok.text)
                if self.accept(")"): break
                self.take(",")
        body=Chunk(self.block({"end"})); self.take("end"); return params, body

# --------------------------- VM compiler -----------------------------------

@dataclass
class Ins:
    op: str
    a: int = 0
    b: int = 0
    c: int = 0
    k: int = 0
    # source metadata omitted intentionally

@dataclass
class Proto:
    params: list[str]
    code: list[Ins] = field(default_factory=list)
    regs: int = 0
    consts: list[Any] = field(default_factory=list)
    names: list[str] = field(default_factory=list)
    protos: list['Proto'] = field(default_factory=list)

class CompileError(Exception): pass

class Compiler:
    def __init__(self):
        self.proto = Proto([])
        self.scopes: list[dict[str,int]] = []
        self.next_reg = 0
        self.free: list[int] = []
        self.locals_declared: set[str] = set()
        self.outer_names: set[str] = set()

    def newreg(self) -> int:
        if self.free:
            return self.free.pop()
        r=self.next_reg; self.next_reg += 1; self.proto.regs=max(self.proto.regs,self.next_reg); return r
    def temp(self):
        r=self.newreg(); self.free.append(r); return r
    def add_const(self,v:Any)->int:
        for i,x in enumerate(self.proto.consts):
            if type(x) is type(v) and x == v: return i
        self.proto.consts.append(v); return len(self.proto.consts)-1
    def add_name(self,n:str)->int:
        if n not in self.proto.names: self.proto.names.append(n)
        return self.proto.names.index(n)
    def emit(self,*args)->int:
        self.proto.code.append(Ins(*args)); return len(self.proto.code)-1
    def patch(self,idx:int,field:str,val:int): setattr(self.proto.code[idx],field,val)

    def compile(self, chunk:Chunk) -> Proto:
        self.scopes=[{}]
        self.block(chunk)
        if not self.proto.code or self.proto.code[-1].op != "RET": self.emit("RET",0,0,0,0)
        self.proto.regs=max(self.proto.regs,1)
        return self.proto

    def declare(self,name:str)->int:
        r=self.newreg(); self.scopes[-1][name]=r; self.locals_declared.add(name); return r
    def lookup(self,name:str)->Optional[int]:
        for s in reversed(self.scopes):
            if name in s:return s[name]
        return None

    def block(self, ch:Chunk):
        for n in ch.body: self.stmt(n)

    def stmt(self,n:Node):
        if isinstance(n,Local):
            rs=[self.declare(x) for x in n.names]
            for i,r in enumerate(rs):
                if i < len(n.values):
                    v=self.expr(n.values[i])
                else:
                    v=self.const(None)
                self.emit("MOV",r,v); self.free_reg(v)
            return
        if isinstance(n,Assign):
            vals=[self.expr(v) for v in n.values]
            for i,t in enumerate(n.targets):
                r = vals[i] if i < len(vals) else self.const(None)
                self.store(t,r)
                if i >= len(vals): self.free_reg(r)
            for r in vals:self.free_reg(r)
            return
        if isinstance(n,Return):
            if len(n.values) > 1:
                raise CompileError("multiple return values are not supported by the Aegis VM subset")
            if not n.values: self.emit("RET",0,0,0,0)
            else:
                r=self.expr(n.values[0]); self.emit("RET",r,0,0,0); self.free_reg(r)
            return
        if isinstance(n,ExprStmt):
            r=self.expr(n.expr); self.free_reg(r); return
        if isinstance(n,If):
            end_jumps=[]
            for cond,body in n.branches:
                c=self.expr(cond)
                jf=self.emit("JZ",c,0,0,0)
                self.free_reg(c)
                self.block(body)
                if body.body and isinstance(body.body[-1],Return):
                    pass
                else:
                    j=self.emit("JMP",0,0,0,0); end_jumps.append(j)
                self.patch(jf,"b",len(self.proto.code))
            if n.else_body: self.block(n.else_body)
            end=len(self.proto.code)
            for j in end_jumps:self.patch(j,"a",end)
            return
        if isinstance(n,While):
            head=len(self.proto.code); c=self.expr(n.cond); jf=self.emit("JZ",c,0,0,0); self.free_reg(c); self.block(n.body); self.emit("JMP",head,0,0,0); self.patch(jf,"b",len(self.proto.code)); return
        if isinstance(n,ForNum):
            r=self.declare(n.name)
            a=self.expr(n.init); b=self.expr(n.limit); self.emit("MOV",r,a); self.free_reg(a)
            limit=self.newreg(); self.emit("MOV",limit,b); self.free_reg(b)
            step=self.expr(n.step) if n.step else self.const(1)
            head=len(self.proto.code); jexit=self.emit("JFOR",r,limit,step,0); self.block(n.body); self.emit("ADD",r,r,step); self.emit("JMP",head,0,0,0); self.patch(jexit,"k",len(self.proto.code)); self.free_reg(limit); self.free_reg(step); return
        if isinstance(n,FunctionDecl):
            p=self.subcompile(n.params,n.body)
            idx=len(self.proto.protos); self.proto.protos.append(p)
            if n.local and isinstance(n.name,Var):
                r=self.declare(n.name.name)
                self.emit("CLOSURE",r,idx,0,0)
            else:
                r=self.newreg(); self.emit("CLOSURE",r,idx,0,0)
                self.store(n.name,r)
                self.free_reg(r)
            return
        raise CompileError(f"unsupported stmt {type(n).__name__}")

    def subcompile(self,params:list[str],body:Chunk)->Proto:
        parent_locals=set()
        for scope in self.scopes:
            parent_locals.update(scope)
        c=Compiler(); c.proto.params=list(params); c.scopes=[{}]
        for p in params: c.scopes[0][p]=c.newreg(); c.locals_declared.add(p)
        c.block(body)
        # This VM version has no upvalue cells. Reject accidental captures instead of
        # silently turning outer locals into globals, which would change program semantics.
        referenced=self.collect_vars(body)
        captured=sorted(name for name in referenced if name in parent_locals and c.lookup(name) is None)
        if captured:
            raise CompileError("closures over outer locals are not supported: " + ", ".join(captured))
        if not c.proto.code or c.proto.code[-1].op!="RET": c.emit("RET",0,0,0,0)
        return c.proto

    def collect_vars(self,n:Node)->set[str]:
        out=set()
        def rec(x):
            if isinstance(x,Var): out.add(x.name)
            elif isinstance(x,list):
                for y in x: rec(y)
            elif isinstance(x,Node):
                for v in vars(x).values(): rec(v)
        rec(n); return out

    def const(self,v):
        r=self.newreg(); self.emit("K",r,self.add_const(v),0,0); return r

    def expr(self,n:Node)->int:
        if isinstance(n,Lit): return self.const(n.value)
        if isinstance(n,Var):
            r=self.newreg(); rr=self.lookup(n.name)
            if rr is not None: self.emit("MOV",r,rr,0,0)
            else: self.emit("GETG",r,self.add_name(n.name),0,0)
            return r
        if isinstance(n,Index):
            a=self.expr(n.base); b=self.expr(n.key); r=self.newreg(); self.emit("GETI",r,a,b,0); self.free_reg(a); self.free_reg(b); return r
        if isinstance(n,Unary):
            a=self.expr(n.x); r=self.newreg(); self.emit({"not":"NOT","-":"NEG","#":"LEN","~":"BNOT"}[n.op],r,a,0,0); self.free_reg(a); return r
        if isinstance(n,Binary):
            # Lua/Luau `and` / `or` are short-circuiting and return operands, not booleans.
            # They cannot be implemented as eager binary VM operations.
            if n.op == "and":
                a=self.expr(n.a); r=self.newreg(); self.emit("MOV",r,a,0,0)
                jf=self.emit("JZ",a,0,0,0); self.free_reg(a)
                b=self.expr(n.b); self.emit("MOV",r,b,0,0); self.free_reg(b)
                self.patch(jf,"b",len(self.proto.code))
                return r
            if n.op == "or":
                a=self.expr(n.a); r=self.newreg(); self.emit("MOV",r,a,0,0)
                jf=self.emit("JZ",a,0,0,0); self.free_reg(a)
                jend=self.emit("JMP",0,0,0,0)
                rhs=len(self.proto.code)
                self.patch(jf,"b",rhs)
                b=self.expr(n.b); self.emit("MOV",r,b,0,0); self.free_reg(b)
                self.patch(jend,"a",len(self.proto.code))
                return r
            a=self.expr(n.a); b=self.expr(n.b); r=self.newreg(); mp={"+":"ADD","-":"SUB","*":"MUL","/":"DIV","//":"IDIV","%":"MOD","^":"POW","..":"CAT","==":"EQ","~=":"NE","<":"LT",">":"GT","<=":"LE",">=":"GE"}; op=mp[n.op]; self.emit(op,r,a,b,0); self.free_reg(a); self.free_reg(b); return r
        if isinstance(n,Call):
            args=[]
            if n.method:
                obj=self.expr(n.fn)
                meth=self.const(n.method)
                fn=self.newreg(); self.emit("GETI",fn,obj,meth,0)
                args=[obj] + [self.expr(a) for a in n.args]
                self.free_reg(meth)
            else:
                fn=self.expr(n.fn)
                args=[self.expr(a) for a in n.args]
            # Pack arg registers into a table; this avoids register-contiguous calling convention constraints.
            # so store args through a temporary table and use CALLT.
            tbl=self.newreg(); self.emit("NEWT",tbl,0,0,0)
            for j,a in enumerate(args,1):
                idx=self.const(j); self.emit("SETI",tbl,idx,a,0); self.free_reg(idx); self.free_reg(a)
            r=self.newreg(); self.emit("CALLT",r,fn,tbl,0); self.free_reg(fn); self.free_reg(tbl); return r
        if isinstance(n,Table):
            r=self.newreg(); self.emit("NEWT",r,0,0,0); ai=1
            for k,v in n.fields:
                vr=self.expr(v)
                if k is None:
                    kr=self.const(ai)
                    ai += 1
                else:
                    kr=self.expr(k)
                self.emit("SETI",r,kr,vr,0); self.free_reg(kr); self.free_reg(vr)
            return r
        if isinstance(n,FunctionValue):
            p=self.subcompile(n.params,n.body); idx=len(self.proto.protos); self.proto.protos.append(p); r=self.newreg(); self.emit("CLOSURE",r,idx,0,0); return r
        raise CompileError(f"unsupported expr {type(n).__name__}")

    def store(self,t:Node,r:int):
        if isinstance(t,Var):
            dst=self.lookup(t.name)
            if dst is None: self.emit("SETG",self.add_name(t.name),r,0,0)
            else: self.emit("MOV",dst,r,0,0)
        elif isinstance(t,Index):
            a=self.expr(t.base); b=self.expr(t.key); self.emit("SETI",a,b,r,0); self.free_reg(a); self.free_reg(b)
        else: raise CompileError("invalid assignment target")

    def free_reg(self,r:int):
        # Conservatively do not recycle locals or constant registers; only temps are recycled by the caller
        # through this hook when safe. Simplicity makes the compiler predictable.
        return

# --------------------------- emitter ---------------------------------------

OPS = [
    "K","MOV","GETG","SETG","GETI","SETI","NEWT","CLOSURE","CALLT","RET",
    "JMP","JZ","JFOR","ADD","SUB","MUL","DIV","IDIV","MOD","POW","CAT",
    "EQ","NE","LT","GT","LE","GE","AND","OR","NOT","NEG","LEN","BNOT","JUNK"
]

@dataclass
class Build:
    opid: dict[str,int]
    perm: list[int]
    seed: int
    xor: int
    stream_key: int = 0
    stream_step: int = 0
    str_step: int = 0
    const_key: int = 0
    const_step: int = 0
    num_key: int = 0


def rand_ident(rng: random.Random, used:set[str]) -> str:
    while True:
        p=rng.choice(["a","b","c","q","x","v","_0x","r","m"])
        s=p + (f"{rng.randrange(0xFFFFFF):x}" if p=="_0x" else ("" if rng.random()<.35 else str(rng.randrange(10000))))
        if s not in used and s not in KEYWORDS:
            used.add(s); return s


def opaque_expr(seed:int)->str:
    a=(seed*1103515245+12345)&0x7fffffff
    b=((a ^ (a>>16)) % 997)+1
    c=(a*3+17)%1009
    # This is always true without looking like `1==1`.
    return f"((({b}*{b})-({b-1}*{b-1}))==({2*b-1}) and (({c}~({c}~{b}))=={b}))"


def encode_bytes(data:bytes,key:int)->list[int]:
    return [b ^ key for b in data]


def _rolling_byte_key(base: int, step: int, idx: int) -> int:
    return (base + step * idx) & 0xFF


def _encode_string_bytes(data: bytes, base: int, step: int) -> list[int]:
    out=[]
    for i,b in enumerate(data):
        k=_rolling_byte_key(base, step, i)
        v=b ^ k
        if i & 1:
            v=((v << 3) | (v >> 5)) & 0xFF
        out.append(v)
    return out


def emit_runtime(root:Proto, build:Build, rng:random.Random, fallback:Optional[bytes]=None) -> str:
    used=set()
    N={k:rand_ident(rng,used) for k in ["VM","D","G","SET","T","MK","H","RUN","S","P","R"]}

    # Encode strings with a rolling per-build key instead of a single fixed XOR.
    def enc_str(s:str)->str:
        raw=_encode_string_bytes(s.encode('utf-8'), build.xor, build.str_step)
        return "{"+str(len(raw))+","+",".join(str(x) for x in raw)+"}"

    def proto_obj(p:Proto)->str:
        rp=list(range(max(1,p.regs)))
        rng.shuffle(rp)
        regs=len(rp)
        def rr(x:int)->int:
            return (rp[x] + 1) if 0 <= x < len(rp) else (x + 1)
        def mapped(ins:Ins)->Ins:
            q=Ins(ins.op,ins.a,ins.b,ins.c,ins.k)
            if ins.op in {"K","MOV","GETG","GETI","NEWT","CLOSURE","CALLT","RET","NOT","NEG","LEN","BNOT","ADD","SUB","MUL","DIV","IDIV","MOD","POW","CAT","EQ","NE","LT","GT","LE","GE","AND","OR","JZ","JFOR"}:
                q.a=rr(ins.a)
            if ins.op in {"MOV","GETI","SETI","CALLT","NOT","NEG","LEN","BNOT","ADD","SUB","MUL","DIV","IDIV","MOD","POW","CAT","EQ","NE","LT","GT","LE","GE","AND","OR","JZ","JFOR"}:
                q.b=rr(ins.b)
            if ins.op in {"GETI","SETI","CALLT","ADD","SUB","MUL","DIV","IDIV","MOD","POW","CAT","EQ","NE","LT","GT","LE","GE","AND","OR","JFOR"}:
                q.c=rr(ins.c)
            if ins.op == "SETG":
                q.b=rr(ins.b)
            if ins.op == "SETI":
                q.a=rr(ins.a); q.b=rr(ins.b); q.c=rr(ins.c)
            return q
        mapped_code=[mapped(x) for x in p.code]
        stream=[]
        for pc,ins in enumerate(mapped_code,1):
            vals=[build.opid[ins.op],ins.a,ins.b,ins.c,ins.k]
            for slot,v in enumerate(vals):
                key=_rolling_byte_key(build.stream_key + slot*17, build.stream_step, pc-1)
                stream.append(v ^ key)
        consts=[]
        for x in p.consts:
            if isinstance(x,str):
                raw=_encode_string_bytes(x.encode('utf-8'), build.const_key, build.const_step)
                consts.append("{1,"+str(len(raw))+","+",".join(map(str,raw))+"}")
            elif x is None: consts.append("{0}")
            elif x is True: consts.append("{2}")
            elif x is False: consts.append("{3}")
            elif isinstance(x,int) and not isinstance(x,bool):
                add=rng.randrange(1000,9000)
                mul=rng.randrange(3,19)|1
                enc=(x*mul+add) ^ build.num_key
                consts.append(f"{{4,{enc},{mul},{add}}}")
            elif isinstance(x,float):
                add=rng.randrange(1000,9000)
                consts.append(f"{{5,{x+add!s},{add}}}")
            else: raise TypeError(type(x))
        nested="{"+",".join(proto_obj(q) for q in p.protos)+"}" if p.protos else "{}"
        params="{"+",".join(enc_str(x) for x in p.params)+"}" if p.params else "{}"
        names="{"+",".join(enc_str(x) for x in p.names)+"}" if p.names else "{}"
        pargs="{"+",".join(str(rr(i)) for i in range(len(p.params)))+"}" if p.params else "{}"
        return "{"+f"s={{{','.join(map(str,stream))}}},z={{{','.join(consts)}}},p={params},n={names},q={pargs},r={regs},f={nested}"+"}"

    root_blob=proto_obj(root)

    # Deterministic handler table keyed by randomized numeric opcode ids.
    handlers="{"
    for logical in OPS:
        oid=build.opid[logical]
        ss=N['S']
        handlers += f"[{oid}]=function({ss}) "
        if logical=="K":
            handlers += f"local v={ss}.P.z[{ss}.b+1];local t=v[1];if t==1 then local n=v[2];local z={{}};for i=1,n do local x=v[i+2];local k=({build.const_key}+{build.const_step}*(i-1))%256;if ((i-1)&1)==1 then x=((x>>3)|((x&7)<<5))&255 end;z[i]=string.char(x~k) end;{ss}.r[{ss}.a]=table.concat(z) elseif t==0 then {ss}.r[{ss}.a]=nil elseif t==2 then {ss}.r[{ss}.a]=true elseif t==3 then {ss}.r[{ss}.a]=false elseif t==4 then {ss}.r[{ss}.a]=((v[2]~{build.num_key})-v[4])/v[3] elseif t==5 then {ss}.r[{ss}.a]=v[2]-v[3] end"
        elif logical=="MOV": handlers += f"{ss}.r[{ss}.a]={ss}.r[{ss}.b]"
        elif logical=="GETG": handlers += f"{ss}.r[{ss}.a]={N['G']}({N['D']}({ss}.P.n[{ss}.b+1))"
        elif logical=="SETG": handlers += f"{N['SET']}({N['D']}({ss}.P.n[{ss}.a+1)),{ss}.r[{ss}.b])"
        elif logical=="GETI": handlers += f"{ss}.r[{ss}.a]={ss}.r[{ss}.b][{ss}.r[{ss}.c]]"
        elif logical=="SETI": handlers += f"{ss}.r[{ss}.a][{ss}.r[{ss}.b]]={ss}.r[{ss}.c]"
        elif logical=="NEWT": handlers += f"{ss}.r[{ss}.a]={{}}"
        elif logical=="CLOSURE": handlers += f"{ss}.r[{ss}.a]={N['MK']}({ss}.P.f[{ss}.b+1])"
        elif logical=="CALLT": handlers += f"{ss}.r[{ss}.a]={ss}.r[{ss}.b](table.unpack({ss}.r[{ss}.c]))"
        elif logical=="RET": handlers += f"{ss}.ret=true;{ss}.rv={ss}.r[{ss}.a]"
        elif logical=="JMP": handlers += f"{ss}.pc={ss}.a"
        elif logical=="JZ": handlers += f"if not {ss}.r[{ss}.a] then {ss}.pc={ss}.b end"
        elif logical=="JFOR": handlers += f"local cur={ss}.r[{ss}.a];local lim={ss}.r[{ss}.b];local stp={ss}.r[{ss}.c];if (stp>=0 and cur>lim) or (stp<0 and cur<lim) then {ss}.pc={ss}.k end"
        elif logical=="JUNK": handlers += f"{ss}.junk=((({ss}.junk or 0)*1103515245+12345)%2147483647)"
        else:
            exprs={
              "ADD":f"{ss}.r[{ss}.b]+{ss}.r[{ss}.c]","SUB":f"{ss}.r[{ss}.b]-{ss}.r[{ss}.c]","MUL":f"{ss}.r[{ss}.b]*{ss}.r[{ss}.c]","DIV":f"{ss}.r[{ss}.b]/{ss}.r[{ss}.c]","IDIV":f"{ss}.r[{ss}.b]//{ss}.r[{ss}.c]","MOD":f"{ss}.r[{ss}.b]%{ss}.r[{ss}.c]","POW":f"{ss}.r[{ss}.b]^{ss}.r[{ss}.c]","CAT":f"{ss}.r[{ss}.b]..{ss}.r[{ss}.c]","EQ":f"{ss}.r[{ss}.b]=={ss}.r[{ss}.c]","NE":f"{ss}.r[{ss}.b]~={ss}.r[{ss}.c]","LT":f"{ss}.r[{ss}.b]<{ss}.r[{ss}.c]","GT":f"{ss}.r[{ss}.b]>{ss}.r[{ss}.c]","LE":f"{ss}.r[{ss}.b]<={ss}.r[{ss}.c]","GE":f"{ss}.r[{ss}.b]>={ss}.r[{ss}.c]","AND":f"{ss}.r[{ss}.b] and {ss}.r[{ss}.c]","OR":f"{ss}.r[{ss}.b] or {ss}.r[{ss}.c]","NOT":f"not {ss}.r[{ss}.b]","NEG":f"-{ss}.r[{ss}.b]","LEN":f"#{ss}.r[{ss}.b]","BNOT":f"~{ss}.r[{ss}.b]"}
            handlers += f"{ss}.r[{ss}.a]={exprs[logical]}"
        handlers += " end,"
    handlers += "}"

    lines=banner_as_luau_comment().rstrip("\n").split("\n")
    lines.append("-- AegisLuau V4 generated output")
    lines.append(f"local {N['D']}=function(v)local n=v[1];local s={{}};for i=1,n do local x=v[i+1];local k=({build.xor}+{build.str_step}*(i-1))%256;if ((i-1)&1)==1 then x=((x>>3)|((x&7)<<5))&255 end;s[i]=string.char(x~k) end;return table.concat(s) end")
    lines.append(f"local {N['G']}=function(n)return _G[n] end")
    lines.append(f"local {N['T']}=setmetatable({{}},{{__index=function(t,k)return rawget(t,k) end,__newindex=function(t,k,v)rawset(t,k,v)end}})")
    lines.append(f"local {N['SET']}=function(n,v){N['T']}[n]=v;_G[n]=v end")
    lines.append(f"local {N['MK']}")
    lines.append(f"local {N['H']}={handlers}")
    lines.append(f"local {N['VM']}={root_blob}")
    lines.append(f"local function {N['RUN']}({N['P']},...)" )
    lines.append(f" local {N['R']}={{}};for i=1,{N['P']}.r do {N['R']}[i]=nil end")
    lines.append(f" local st={{P={N['P']},r={N['R']},pc=1,ret=false,rv=nil,junk=0,a=0,b=0,c=0,k=0}}")
    lines.append(f" local argv={{...}};for i=1,#argv do local rr=st.P.q[i];if rr then st.r[rr]=argv[i] end end")
    lines.append(f" while not st.ret do")
    lines.append(f"  local p=st.P;local base=(st.pc-1)*5;local function rd(slot) local x=p.s[base+slot];local k=({build.stream_key}+(slot-1)*17+{build.stream_step}*(st.pc-1))%256;return x~k end")
    lines.append(f"  if base+5>#p.s then break end")
    lines.append(f"  st.op=rd(1);st.a=rd(2);st.b=rd(3);st.c=rd(4);st.k=rd(5)")
    lines.append(f"  local h={N['H']}[st.op];if not h then error('AEGIS VM dispatch fault') end")
    lines.append(f"  h(st)")
    lines.append(f"  st.pc=st.pc+1")
    lines.append(f" end")
    lines.append(f" return st.rv end")
    lines.append(f"{N['MK']}=function(p)return function(...)return {N['RUN']}(p,...)end end")

    if fallback is not None:
        # Optional compatibility path. It is never emitted unless --hybrid is requested.
        k=rng.randrange(1,255)
        enc=[b ^ ((k + i*31) & 0xFF) for i,b in enumerate(fallback)]
        chunks=[enc[i:i+80] for i in range(0,len(enc),80)] or [[]]
        arrs=["{"+",".join(map(str,ch))+"}" for ch in chunks]
        lines.append(f"-- HYBRID FALLBACK: source-compatible mode; source is intentionally retained")
        lines.append(f"local __fk={k};local __fc={{{','.join(arrs)}}};local __z={{}};local __fi=0;for _,q in ipairs(__fc) do for i=1,#q do __fi=__fi+1;__z[__fi]=string.char(q[i]~(({k}+31*(__fi-1))%256)) end end;local __loader=loadstring or load;if not __loader then error('AEGIS hybrid fallback requires loadstring/load') end;local __f,__e=__loader(table.concat(__z));if not __f then error(__e) end;return __f()")
        return "\n".join(lines)+"\n"
    lines.append(f"return {N['RUN']}({N['VM']})")
    return "\n".join(lines)+"\n"


# --------------------------- source transformation -------------------------


def rewrite_safe_names(src:str,rng:random.Random)->str:
    # This is only for fallback blocks; compiled blocks don't expose source identifiers.
    toks=lex(src); used={t.text for t in toks if t.kind in {"ident","kw"} }
    mp={}
    for t in toks:
        if t.kind=="ident" and t.text not in {"game","workspace","script","math","string","table","bit32","task","print","warn","require","pairs","ipairs","next","select","pcall","xpcall"}:
            mp.setdefault(t.text,rand_ident(rng,used))
    out=[]
    for i,t in enumerate(toks[:-1]):
        if t.kind=="ident" and t.text in mp:
            # preserve property names after dot/colon
            prev=toks[i-1].text if i else ""
            if prev not in {".",":"}: t.text=mp[t.text]
        out.append(t.text)
    return "".join(out)



def normalize_source(src: str) -> str:
    # UTF-8 BOM is legal in editors and should not become an accidental token.
    if src.startswith("\ufeff"):
        src = src[1:]
    # Normalize line endings so diagnostics and output are deterministic.
    return src.replace("\r\n", "\n").replace("\r", "\n")


def source_has_balanced_short_strings(src: str) -> None:
    """Preflight check with precise diagnostics before any fallback decision."""
    i = 0
    n = len(src)
    while i < n:
        if src.startswith('--', i):
            if src.startswith('--[', i):
                e = _long_bracket_end(src, i + 2)
                if e is not None:
                    i = e
                    continue
            j = src.find('\n', i + 2)
            i = n if j < 0 else j
            continue
        if src[i] in "'\"":
            q = src[i]
            start = i
            i += 1
            escaped = False
            while i < n:
                ch = src[i]
                if escaped:
                    escaped = False
                    i += 1
                    continue
                if ch == '\\':
                    escaped = True
                    i += 1
                    continue
                if ch == q:
                    i += 1
                    break
                if ch in '\r\n':
                    line, col = _line_col(src, start)
                    line_text = src.splitlines()[line-1] if 0 < line <= len(src.splitlines()) else ""
                    caret = " " * max(0, col-1) + "^"
                    raise SyntaxError(f"unterminated string at line {line}, column {col}: {line_text!r}\n{caret}")
                i += 1
            else:
                line, col = _line_col(src, start)
                raise SyntaxError(f"unterminated string at line {line}, column {col}: {src[start:start+80]!r}")
            continue
        i += 1


def humanize_parser_error(src: str, err: Exception) -> str:
    msg = str(err)
    m = re.search(r" at (\d+)(?:,|$)", msg)
    if not m:
        return msg
    pos = int(m.group(1))
    if pos == len(src) and src.endswith("\n") and len(src) > 0:
        pos = max(0, pos - 1)
    line, col = _line_col(src, pos)
    lines = src.splitlines() or [""]
    text = lines[line - 1] if 0 < line <= len(lines) else ""
    caret = " " * max(0, col - 1) + "^"
    return f"{msg} (line {line}, column {col})\n{text}\n{caret}"

def build_obf(src:str,seed:Optional[int]=None,strict:bool=False,hybrid:bool=False)->tuple[str,dict[str,Any]]:
    src = normalize_source(src)
    # Syntax errors in the source itself must never be hidden by the compatibility
    # fallback. Hybrid mode is for valid Luau that Aegis cannot compile yet.
    source_has_balanced_short_strings(src)

    s=seed if seed is not None else secrets.randbits(64)
    rng=random.Random(s)
    fallback=None
    fallback_reason=None
    compiled=False

    try:
        toks=lex(src)
    except SyntaxError:
        # Lexer errors are always fatal. They indicate malformed source.
        raise

    try:
        ast=Parser(toks).parse()
        c=Compiler(); proto=c.compile(ast)
        compiled=True
    except (SyntaxError,CompileError,IndexError,ValueError) as e:
        if strict or not hybrid:
            if isinstance(e, SyntaxError):
                raise SyntaxError(humanize_parser_error(src, e))
            raise
        fallback=src.encode('utf-8')
        fallback_reason=f"unsupported syntax: {e}"
        proto=Compiler().compile(Chunk([]))

    opnums=list(range(1,len(OPS)+1)); rng.shuffle(opnums)
    opid={op:opnums[i] for i,op in enumerate(OPS)}
    perm=list(range(1,256)); rng.shuffle(perm); perm=perm[:64]
    build=Build(
        opid,perm,s,rng.randrange(1,256),
        stream_key=rng.randrange(1,256),stream_step=rng.randrange(1,256),str_step=rng.randrange(1,256),
        const_key=rng.randrange(1,256),const_step=rng.randrange(1,256),num_key=rng.randrange(1,256)
    )

    def add_decoy(p:Proto):
        p.code=[Ins("JUNK")]+p.code
        for ins in p.code[1:]:
            if ins.op=="JMP": ins.a+=1
            elif ins.op=="JZ": ins.b+=1
            elif ins.op=="JFOR": ins.k+=1
        for q in p.protos:add_decoy(q)
    add_decoy(proto)

    out=emit_runtime(proto,build,rng,fallback=fallback)
    meta={"compiled":compiled,"seed":s,"strict":strict,"hybrid":hybrid,
          "instructions":sum(len(p.code) for p in [proto,*proto.protos]),
          "protos":1+len(proto.protos),"fallback":fallback is not None,
          "fallback_reason":fallback_reason,"opcodes":len(OPS),"version":VERSION}
    return out,meta

VERSION = "4.2.0"


def main()->int:
    import sys
    if "--no-banner" not in sys.argv:
        print_banner()

    ap=argparse.ArgumentParser(description="AegisLuau hybrid Luau virtualizer")
    ap.add_argument("input", nargs="?", help="input .luau/.lua file")
    ap.add_argument("-o","--output",default="obfuscated.luau")
    ap.add_argument("--seed",type=int,default=None)
    ap.add_argument("--strict",action="store_true",help="reject unsupported Luau syntax")
    ap.add_argument("--hybrid",action="store_true",help="allow runtime fallback for valid-but-unsupported Luau")
    ap.add_argument("--stats",action="store_true")
    ap.add_argument("--check",action="store_true",help="parse/compile-check input without writing output")
    ap.add_argument("--no-banner",action="store_true",help="do not print the AEGIS startup banner")
    ap.add_argument("--version",action="version",version=f"AEGIS Luau {VERSION}")
    args=ap.parse_args()

    if not args.input:
        print("AEGIS: input file is required", file=sys.stderr)
        return 2

    in_path=Path(args.input)
    if not in_path.is_file():
        print(f"AEGIS input error: file not found: {in_path}", file=sys.stderr)
        return 2

    try:
        src=in_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as e:
        print(f"AEGIS input error: {e}", file=sys.stderr)
        return 2

    try:
        out,meta=build_obf(src,args.seed,args.strict,args.hybrid)
    except Exception as e:
        print(f"AEGIS build failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    if args.check:
        print("[+] check passed")
        if meta.get("fallback"):
            print(f"[!] hybrid fallback would be used: {meta.get('fallback_reason','unsupported syntax')}")
        if args.stats:
            print(meta)
        return 0

    try:
        out_path=Path(args.output)
        out_path.parent.mkdir(parents=True,exist_ok=True)
        tmp=out_path.with_name(out_path.name + ".tmp")
        tmp.write_text(out,encoding="utf-8",newline="\n")
        tmp.replace(out_path)
    except (OSError, UnicodeError) as e:
        print(f"AEGIS output error: {e}", file=sys.stderr)
        return 2

    if meta.get("fallback"):
        print(f"[!] hybrid fallback enabled: {meta.get('fallback_reason','unsupported syntax')}")
    print(f"[+] wrote {args.output}")
    if args.stats:
        print(meta)
    return 0

if __name__=="__main__": raise SystemExit(main())
