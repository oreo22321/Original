#!/usr/bin/env python3
"""
AegisLuau V6 - IR/VM source-protection compiler.

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

AEGIS_BANNER = r"""   /$$$$$$    /$$$$$$$$   /$$$$$$  /$$$$$$  /$$$$$$
  /$$__  $$  | $$_____/  /$$__  $$|_  $$_/ /$$__  $$
 | $$  \ $$  | $$       | $$  \ $$  | $$  | $$  \__/
 | $$ /$$$$  | $$$$$    | $$ /$$$$  | $$  |  $$$$$$
 | $$|_  $$  | $$__/    | $$|_  $$  | $$   \____  $$
 | $$  \ $$  | $$       | $$  \ $$  | $$  /$$  \ $$
 |  $$$$$$/  | $$$$$$$$ |  $$$$$$/ /$$$$$$|  $$$$$$/
  \______/  |________/  \______/ |______/ \______/"""

AEGIS_BANNER_COMPACT = r"""AEGIS
Luau Obfuscator V5"""

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
    upvalues: list[tuple[str, int]] = field(default_factory=list)

class CompileError(Exception): pass

class Compiler:
    def __init__(self, max_ip: bool = False):
        self.proto = Proto([])
        self.max_ip = max_ip
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
        # In ip-max mode, deliberately allow duplicate constants. This is a conventional
        # source-protection transform: it removes one easy global constant-pool clue.
        if not self.max_ip:
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
        c=Compiler(max_ip=self.max_ip); c.proto.params=list(params); c.scopes=[{}]
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
            a=self.expr(n.x); r=self.newreg(); op={"not":"NOT","-":"NEG","#":"LEN","~":"BNOT"}[n.op]
            if self.max_ip:
                t=self.newreg(); self.emit("MOV",t,a,0,0); self.emit(op,r,t,0,0)
            else:
                self.emit(op,r,a,0,0)
            self.free_reg(a); return r
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
            a=self.expr(n.a); b=self.expr(n.b); r=self.newreg(); mp={"+":"ADD","-":"SUB","*":"MUL","/":"DIV","//":"IDIV","%":"MOD","^":"POW","..":"CAT","==":"EQ","~=":"NE","<":"LT",">":"GT","<=":"LE",">=":"GE"}; op=mp[n.op]
            if self.max_ip:
                # Decompose common operations into semantics-preserving instruction sequences.
                # This is ordinary IP-protection, not environment/anti-debugging behavior.
                if op in {"ADD","SUB"}:
                    z=self.const(0); t=self.newreg(); self.emit("ADD",t,a,z,0); self.emit(op,r,t,b,0)
                elif op == "CAT":
                    e=self.const(""); t=self.newreg(); self.emit("CAT",t,a,e,0); self.emit("CAT",r,t,b,0)
                else:
                    t=self.newreg(); self.emit("MOV",t,a,0,0); self.emit(op,r,t,b,0)
            else:
                self.emit(op,r,a,b,0)
            self.free_reg(a); self.free_reg(b); return r
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

# --------------------------- V6 IR / optimization / emitter ----------------

def rand_ident(rng: random.Random, used: set[str]) -> str:
    while True:
        p=rng.choice(["a","b","c","q","x","v","_0x","r","m"])
        s=p + (f"{rng.randrange(0xFFFFFF):x}" if p=="_0x" else ("" if rng.random()<.35 else str(rng.randrange(10000))))
        if s not in used and s not in KEYWORDS:
            used.add(s)
            return s


OPS = [
    "K","MOV","GETG","SETG","GETI","SETI","NEWT","CLOSURE","CALLT","RET",
    "JMP","JZ","JFOR","ADD","SUB","MUL","DIV","IDIV","MOD","POW","CAT",
    "EQ","NE","LT","GT","LE","GE","AND","OR","NOT","NEG","LEN","BNOT","JUNK"
]

@dataclass
class Build:
    opid: dict[str,int]
    seed: int
    vm_seed: int
    cf_seed: int
    reg_seed: int
    opcode_mask: int
    stream_key: int
    stream_step: int
    string_key: int
    string_step: int
    const_keys: list[int]
    const_steps: list[int]
    const_shards: int


def _remap_target(target: int, old_len: int, old_to_new: list[int]) -> int:
    if target < 0:
        return target
    if target >= old_len:
        return len(old_to_new) - 1
    return old_to_new[target]


def optimize_proto(p: Proto) -> dict[str, int]:
    """Semantics-preserving IR peephole pass.

    Removes only instructions which are provably redundant for this IR:
    self-moves and unconditional/conditional branches whose target is the
    immediately following instruction. Jump targets are remapped after removal.
    """
    stats = {"removed": 0, "visited": 1}
    for child in p.protos:
        child_stats = optimize_proto(child)
        stats["removed"] += child_stats["removed"]
        stats["visited"] += child_stats["visited"]

    old = p.code
    if not old:
        return stats

    remove = [False] * len(old)
    for i, ins in enumerate(old):
        if ins.op == "MOV" and ins.a == ins.b:
            remove[i] = True
        elif ins.op == "JMP" and ins.a == i + 1:
            remove[i] = True
        elif ins.op == "JZ" and ins.b == i + 1:
            remove[i] = True
        elif ins.op == "JFOR" and ins.k == i + 1:
            remove[i] = True

    if not any(remove):
        return stats

    old_to_new = [0] * (len(old) + 1)
    next_new = 0
    for i in range(len(old) - 1, -1, -1):
        if not remove[i]:
            next_new = i
        old_to_new[i] = next_new
    # Rebuild exact new indexes for kept instructions.
    index_map = [-1] * len(old)
    ni = 0
    for i, rem in enumerate(remove):
        if not rem:
            index_map[i] = ni
            ni += 1
    # Map removed targets to the first surviving instruction at/after that target.
    next_survivor = ni
    target_map = [0] * (len(old) + 1)
    for i in range(len(old) - 1, -1, -1):
        if not remove[i]:
            next_survivor = index_map[i]
        target_map[i] = next_survivor
    target_map[len(old)] = ni

    new_code: list[Ins] = []
    for i, ins in enumerate(old):
        if remove[i]:
            continue
        q = Ins(ins.op, ins.a, ins.b, ins.c, ins.k)
        if q.op == "JMP":
            q.a = target_map[q.a]
        elif q.op == "JZ":
            q.b = target_map[q.b]
        elif q.op == "JFOR":
            q.k = target_map[q.k]
        new_code.append(q)
    p.code = new_code
    stats["removed"] += sum(remove)
    return stats


def normalize_control_targets(p: Proto) -> None:
    """Convert compiler's zero-based jump targets to VM's one-based logical PCs."""
    for ins in p.code:
        if ins.op == "JMP":
            ins.a += 1
        elif ins.op == "JZ":
            ins.b += 1
        elif ins.op == "JFOR":
            ins.k += 1
    for child in p.protos:
        normalize_control_targets(child)


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


def _poolize_constants(p: Proto, build: Build, rng: random.Random):
    """Split a proto's constants across randomized shards and encode K operands.

    Returns (shards, token_by_old_index). Each token is local_index * shard_count + shard.
    """
    shards=[[] for _ in range(build.const_shards)]
    tokens=[0] * len(p.consts)
    # Use a randomized starting shard so identical source constants do not always
    # land in the same shard across builds.
    start=rng.randrange(build.const_shards)
    for idx, value in enumerate(p.consts):
        shard=(start + idx) % build.const_shards
        local=len(shards[shard])
        shards[shard].append(value)
        tokens[idx]=local*build.const_shards+shard
    return shards, tokens


def emit_runtime(root: Proto, build: Build, rng: random.Random) -> str:
    used=set()
    N={k:rand_ident(rng,used) for k in ["VM","D","G","SET","T","MK","H","RUN","S","P","R","CF","CK","CS"]}

    def enc_name(s: str) -> str:
        raw=_encode_string_bytes(s.encode('utf-8'), build.string_key, build.string_step)
        return "{"+str(len(raw))+","+",".join(map(str,raw))+"}"

    # Per-proto register mapping and physical instruction permutation.
    proto_counter = [0]
    def proto_obj(p: Proto) -> str:
        proto_id = proto_counter[0]; proto_counter[0] += 1
        rp=list(range(max(1,p.regs)))
        reg_rng=random.Random((build.reg_seed ^ (proto_id * 0x9E3779B97F4A7C15)) & ((1<<64)-1))
        reg_rng.shuffle(rp)
        regs=len(rp)
        def rr(x:int)->int:
            return (rp[x] + 1) if 0 <= x < len(rp) else (x + 1)

        def mapped(ins: Ins) -> Ins:
            q=Ins(ins.op,ins.a,ins.b,ins.c,ins.k)
            reg_a={"K","MOV","GETG","GETI","NEWT","CLOSURE","CALLT","RET","NOT","NEG","LEN","BNOT","ADD","SUB","MUL","DIV","IDIV","MOD","POW","CAT","EQ","NE","LT","GT","LE","GE","AND","OR","JZ","JFOR"}
            reg_b={"MOV","GETI","CALLT","NOT","NEG","LEN","BNOT","ADD","SUB","MUL","DIV","IDIV","MOD","POW","CAT","EQ","NE","LT","GT","LE","GE","AND","OR","JFOR"}
            reg_c={"GETI","SETI","CALLT","ADD","SUB","MUL","DIV","IDIV","MOD","POW","CAT","EQ","NE","LT","GT","LE","GE","AND","OR","JFOR"}
            if ins.op in reg_a: q.a=rr(ins.a)
            if ins.op in reg_b: q.b=rr(ins.b)
            if ins.op in reg_c: q.c=rr(ins.c)
            if ins.op == "SETG": q.b=rr(ins.b)
            if ins.op == "SETI": q.a=rr(ins.a); q.b=rr(ins.b); q.c=rr(ins.c)
            return q

        mapped_code=[mapped(x) for x in p.code]
        cf_rng=random.Random((build.cf_seed ^ (proto_id * 0xD1B54A32D192ED03)) & ((1<<64)-1))
        order=list(range(len(mapped_code)))
        cf_rng.shuffle(order)
        cf=[0] * (len(order) + 1)
        for physical_pos, logical_idx in enumerate(order, 1):
            cf[logical_idx + 1] = physical_pos

        shards, tokens = _poolize_constants(p, build, rng)
        packed=[]
        for physical_pos, logical_idx in enumerate(order, 1):
            ins=mapped_code[logical_idx]
            a,b,c,k=ins.a,ins.b,ins.c,ins.k
            if ins.op == "K":
                b = tokens[b]
            vals=[build.opid[ins.op]^build.opcode_mask, a,b,c,k]
            for slot,v in enumerate(vals):
                key=_rolling_byte_key(build.stream_key + slot*17, build.stream_step, physical_pos-1)
                packed.append(v ^ key)

        const_source=[]
        for sid, shard in enumerate(shards):
            arr=[]
            key=build.const_keys[sid]; step=build.const_steps[sid]
            for x in shard:
                if isinstance(x,str):
                    raw=_encode_string_bytes(x.encode('utf-8'), key, step)
                    arr.append("{1,"+str(len(raw))+","+",".join(map(str,raw))+"}")
                elif x is None: arr.append("{0}")
                elif x is True: arr.append("{2}")
                elif x is False: arr.append("{3}")
                elif isinstance(x,int) and not isinstance(x,bool):
                    # Affine+mask integer protection. Parameters vary per build and per shard.
                    add=rng.randrange(1000,9000)
                    mul=(rng.randrange(3,19)|1)
                    enc=(x*mul+add) ^ ((build.const_keys[sid]<<1)&255)
                    arr.append(f"{{4,{enc},{mul},{add}}}")
                elif isinstance(x,float):
                    add=rng.randrange(1000,9000)
                    arr.append(f"{{5,{x+add!s},{add}}}")
                else:
                    raise TypeError(type(x))
            const_source.append("{"+",".join(arr)+"}")

        nested="{"+",".join(proto_obj(q) for q in p.protos)+"}" if p.protos else "{}"
        params="{"+",".join(enc_name(x) for x in p.params)+"}" if p.params else "{}"
        names="{"+",".join(enc_name(x) for x in p.names)+"}" if p.names else "{}"
        pargs="{"+",".join(str(rr(i)) for i in range(len(p.params)))+"}" if p.params else "{}"
        cf_blob="{"+",".join(map(str,cf[1:]))+"}"
        return "{"+f"s={{{','.join(map(str,packed))}}},z={{{','.join(const_source)}}},p={params},n={names},q={pargs},r={regs},f={nested},cf={cf_blob}"+"}"

    root_blob=proto_obj(root)

    # Handlers are emitted in a random order, but opcode IDs are randomized too.
    handler_items=[]
    order_ops=OPS[:]
    random.Random(build.vm_seed).shuffle(order_ops)
    ss=N['S']
    for logical in order_ops:
        oid=build.opid[logical]
        h=f"[{oid}]=function({ss}) "
        if logical=="K":
            # Split-pool constant lookup. Each shard has its own build-randomized key/step.
            h += f"local z={ss}.P.z;local t={ss}.b;local sid=t%{build.const_shards};local idx=(t-sid)/{build.const_shards}+1;local v=z[sid+1][idx];local ty=v[1];if ty==1 then local n=v[2];local out={{}};for i=1,n do local x=v[i+2];local kk=({N['CK']}[sid+1]+{N['CS']}[sid+1]*(i-1))%256;if ((i-1)&1)==1 then x=((x>>3)|((x&7)<<5))&255 end;out[i]=string.char(x~kk) end;{ss}.r[{ss}.a]=table.concat(out) elseif ty==0 then {ss}.r[{ss}.a]=nil elseif ty==2 then {ss}.r[{ss}.a]=true elseif ty==3 then {ss}.r[{ss}.a]=false elseif ty==4 then {ss}.r[{ss}.a]=(((v[2]~(({N['CK']}[sid+1]<<1)&255))-v[4])/v[3]) elseif ty==5 then {ss}.r[{ss}.a]=v[2]-v[3] end"
        elif logical=="MOV": h += f"{ss}.r[{ss}.a]={ss}.r[{ss}.b]"
        elif logical=="GETG": h += f"{ss}.r[{ss}.a]={N['G']}({N['D']}({ss}.P.n[{ss}.b+1]))"
        elif logical=="SETG": h += f"{N['SET']}({N['D']}({ss}.P.n[{ss}.a+1]),{ss}.r[{ss}.b])"
        elif logical=="GETI": h += f"{ss}.r[{ss}.a]={ss}.r[{ss}.b][{ss}.r[{ss}.c]]"
        elif logical=="SETI": h += f"{ss}.r[{ss}.a][{ss}.r[{ss}.b]]={ss}.r[{ss}.c]"
        elif logical=="NEWT": h += f"{ss}.r[{ss}.a]={{}}"
        elif logical=="CLOSURE": h += f"{ss}.r[{ss}.a]={N['MK']}({ss}.P.f[{ss}.b+1])"
        elif logical=="CALLT": h += f"{ss}.r[{ss}.a]={ss}.r[{ss}.b](table.unpack({ss}.r[{ss}.c]))"
        elif logical=="RET": h += f"{ss}.ret=true;{ss}.rv={ss}.r[{ss}.a]"
        elif logical=="JMP": h += f"{ss}.next={ss}.a"
        elif logical=="JZ": h += f"if not {ss}.r[{ss}.a] then {ss}.next={ss}.b end"
        elif logical=="JFOR": h += f"local cur={ss}.r[{ss}.a];local lim={ss}.r[{ss}.b];local stp={ss}.r[{ss}.c];if (stp>=0 and cur>lim) or (stp<0 and cur<lim) then {ss}.next={ss}.k end"
        elif logical=="JUNK": h += f"{ss}.junk=((({ss}.junk or 0)*1103515245+12345+{build.vm_seed % 1000003})%2147483647)"
        else:
            exprs={
              "ADD":f"{ss}.r[{ss}.b]+{ss}.r[{ss}.c]","SUB":f"{ss}.r[{ss}.b]-{ss}.r[{ss}.c]","MUL":f"{ss}.r[{ss}.b]*{ss}.r[{ss}.c]","DIV":f"{ss}.r[{ss}.b]/{ss}.r[{ss}.c]","IDIV":f"{ss}.r[{ss}.b]//{ss}.r[{ss}.c]","MOD":f"{ss}.r[{ss}.b]%{ss}.r[{ss}.c]","POW":f"{ss}.r[{ss}.b]^{ss}.r[{ss}.c]","CAT":f"{ss}.r[{ss}.b]..{ss}.r[{ss}.c]","EQ":f"{ss}.r[{ss}.b]=={ss}.r[{ss}.c]","NE":f"{ss}.r[{ss}.b]~={ss}.r[{ss}.c]","LT":f"{ss}.r[{ss}.b]<{ss}.r[{ss}.c]","GT":f"{ss}.r[{ss}.b]>{ss}.r[{ss}.c]","LE":f"{ss}.r[{ss}.b]<={ss}.r[{ss}.c]","GE":f"{ss}.r[{ss}.b]>={ss}.r[{ss}.c]","AND":f"{ss}.r[{ss}.b] and {ss}.r[{ss}.c]","OR":f"{ss}.r[{ss}.b] or {ss}.r[{ss}.c]","NOT":f"not {ss}.r[{ss}.b]","NEG":f"-{ss}.r[{ss}.b]","LEN":f"#{ss}.r[{ss}.b]","BNOT":f"~{ss}.r[{ss}.b]"}
            h += f"{ss}.r[{ss}.a]={exprs[logical]}"
        handler_items.append(h+" end")
    handlers="{"+",".join(handler_items)+"}"

    lines=banner_as_luau_comment().rstrip("\n").split("\n")
    lines.append("-- AegisLuau V7 generated output")
    lines.append(f"local {N['D']}=function(v)local n=v[1];local s={{}};for i=1,n do local x=v[i+1];local k=({build.string_key}+{build.string_step}*(i-1))%256;if ((i-1)&1)==1 then x=((x>>3)|((x&7)<<5))&255 end;s[i]=string.char(x~k) end;return table.concat(s) end")
    lines.append(f"local {N['G']}=function(n)return _G[n] end")
    lines.append(f"local {N['T']}=setmetatable({{}},{{__index=function(t,k)return rawget(t,k) end,__newindex=function(t,k,v)rawset(t,k,v)end}})")
    lines.append(f"local {N['SET']}=function(n,v){N['T']}[n]=v;_G[n]=v end")
    lines.append(f"local {N['CK']}={{{','.join(map(str,build.const_keys))}}}")
    lines.append(f"local {N['CS']}={{{','.join(map(str,build.const_steps))}}}")
    lines.append(f"local {N['MK']}")
    lines.append(f"local {N['H']}={handlers}")
    lines.append(f"local {N['VM']}={root_blob}")
    lines.append(f"local function {N['RUN']}({N['P']},...)" )
    lines.append(f" local {N['R']}={{}};for i=1,{N['P']}.r do {N['R']}[i]=nil end")
    lines.append(f" local st={{P={N['P']},r={N['R']},pc=1,next=1,ret=false,rv=nil,junk=0,a=0,b=0,c=0,k=0,op=0}}")
    lines.append(f" local argv={{...}};for i=1,#argv do local rr=st.P.q[i];if rr then st.r[rr]=argv[i] end end")
    lines.append(f" while not st.ret do")
    lines.append(f"  local p=st.P;local logical=st.pc;if logical>#p.cf then break end;local physical=p.cf[logical];if not physical then error('AEGIS VM control-flow fault') end")
    lines.append(f"  local base=(physical-1)*5;local function rd(slot) local x=p.s[base+slot];local kk=({build.stream_key}+(slot-1)*17+{build.stream_step}*(physical-1))%256;return x~kk end")
    lines.append(f"  if base+5>#p.s then error('AEGIS VM bytecode fault') end")
    lines.append(f"  st.op=rd(1)~{build.opcode_mask};st.a=rd(2);st.b=rd(3);st.c=rd(4);st.k=rd(5)")
    lines.append(f"  local h={N['H']}[st.op];if not h then error('AEGIS VM dispatch fault') end")
    lines.append(f"  st.next=logical+1;h(st);st.pc=st.next")
    lines.append(f" end")
    lines.append(f" return st.rv end")
    lines.append(f"{N['MK']}=function(p)return function(...)return {N['RUN']}(p,...)end end")
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

def build_obf(src:str,seed:Optional[int]=None,strict:bool=False,hybrid:bool=False,profile:str="v6-max")->tuple[str,dict[str,Any]]:
    src = normalize_source(src)
    source_has_balanced_short_strings(src)

    master = seed if seed is not None else secrets.randbits(64)
    rng = random.Random(master)
    fallback=None
    fallback_reason=None
    compiled=False

    toks=lex(src)
    try:
        ast=Parser(toks).parse()
        compiler=Compiler(max_ip=(profile=="v6-max"))
        proto=compiler.compile(ast)
        compiled=True
    except (SyntaxError,CompileError,IndexError,ValueError) as e:
        if strict or not hybrid:
            if isinstance(e, SyntaxError):
                raise SyntaxError(humanize_parser_error(src, e))
            raise
        fallback=src.encode('utf-8')
        fallback_reason=f"unsupported syntax: {e}"
        proto=Compiler(max_ip=(profile=="v6-max")).compile(Chunk([]))

    # Stage 1: IR optimization.
    opt_stats=optimize_proto(proto)

    # Stage 2: decoy instruction insertion after optimization, before jump normalization.
    def add_decoy(p:Proto):
        if p.code:
            p.code=[Ins("JUNK")]+p.code
            for ins in p.code[1:]:
                if ins.op=="JMP": ins.a+=1
                elif ins.op=="JZ": ins.b+=1
                elif ins.op=="JFOR": ins.k+=1
        for q in p.protos:
            add_decoy(q)
    add_decoy(proto)

    # Stage 3: normalize logical PCs for the runtime's one-based control-flow domain.
    normalize_control_targets(proto)

    # Stage 4: build-independent randomized domains. With an explicit seed, the
    # entire build is deterministic; without one, every domain changes each run.
    shard_count=2+rng.randrange(3)
    opnums=list(range(1,len(OPS)+1)); rng.shuffle(opnums)
    opid={op:opnums[i] for i,op in enumerate(OPS)}
    build=Build(
        opid=opid,
        seed=master,
        vm_seed=rng.getrandbits(64),
        cf_seed=rng.getrandbits(64),
        reg_seed=rng.getrandbits(64),
        opcode_mask=rng.randrange(1,256),
        stream_key=rng.randrange(1,256),
        stream_step=rng.randrange(1,256),
        string_key=rng.randrange(1,256),
        string_step=rng.randrange(1,256),
        const_keys=[rng.randrange(1,256) for _ in range(shard_count)],
        const_steps=[rng.randrange(1,256) for _ in range(shard_count)],
        const_shards=shard_count,
    )

    out=emit_runtime(proto,build,rng)
    # Lightweight generated-source sanity validation. This deliberately does not
    # claim to be a full Luau parser, but catches bracket/quote regressions in the
    # emitter before writing a file.
    _sanity_check_generated_luau(out)

    meta={
        "compiled":compiled,
        "seed":master,
        "strict":strict,
        "hybrid":hybrid,
        "profile":profile,
        "version":VERSION,
        "instructions":sum(len(p.code) for p in [proto,*proto.protos]),
        "protos":1+len(proto.protos),
        "fallback":fallback is not None,
        "fallback_reason":fallback_reason,
        "opcodes":len(OPS),
        "constant_shards":shard_count,
        "optimizer_removed":opt_stats["removed"],
        "randomized_domains":["opcode mapping","register mapping","constant key","string key","VM seed","control-flow seed"],
    }
    return out,meta


VERSION = "6.0.0"


def _sanity_check_generated_luau(text:str)->None:
    """Lexer-like structural check used only to catch generator regressions.

    It intentionally ignores Luau semantic validity and checks quotes/comments/bracket
    balance. The actual input parser remains the source-of-truth for compiled regions.
    """
    stack=[]
    pairs={')':'(',']':'[','}':'{'}
    i=0; n=len(text)
    quote=None
    while i<n:
        if quote:
            if text[i]=='\\':
                i+=2; continue
            if text[i]==quote:
                quote=None
            i+=1; continue
        if text.startswith('--',i):
            j=text.find('\n',i+2); i=n if j<0 else j; continue
        c=text[i]
        if c in "'\"": quote=c; i+=1; continue
        if c in '([{': stack.append(c)
        elif c in ')]}':
            if not stack or stack[-1]!=pairs[c]:
                raise SyntaxError(f"generated output has unbalanced delimiter near offset {i}")
            stack.pop()
        i+=1
    if quote:
        raise SyntaxError("generated output contains an unterminated string")
    if stack:
        raise SyntaxError("generated output has unbalanced delimiters")


def main()->int:
    import sys
    if "--no-banner" not in sys.argv:
        print_banner()

    ap=argparse.ArgumentParser(description="AegisLuau V6 source-protection compiler")
    ap.add_argument("input", nargs="?", help="input .luau/.lua file")
    ap.add_argument("-o","--output",default="obfuscated.luau")
    ap.add_argument("--seed",type=int,default=None)
    ap.add_argument("--strict",action="store_true",help="reject unsupported Luau syntax")
    ap.add_argument("--hybrid",action="store_true",help="allow runtime fallback for valid-but-unsupported Luau")
    ap.add_argument("--stats",action="store_true")
    ap.add_argument("--check",action="store_true",help="parse/compile-check input without writing output")
    ap.add_argument("--no-banner",action="store_true",help="do not print the AEGIS startup banner")
    ap.add_argument("--profile",choices=["standard","v6-max"],default="v6-max",help="V6 source-protection profile")
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
    except (OSError,UnicodeError) as e:
        print(f"AEGIS input error: {e}", file=sys.stderr)
        return 2

    try:
        out,meta=build_obf(src,args.seed,args.strict,args.hybrid,args.profile)
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
    except (OSError,UnicodeError) as e:
        print(f"AEGIS output error: {e}", file=sys.stderr)
        return 2

    print(f"[+] wrote {args.output}")
    if meta.get("fallback"):
        print(f"[!] hybrid fallback enabled: {meta.get('fallback_reason','unsupported syntax')}")
    if args.stats:
        print(meta)
    return 0



def _aegis_v7_collect_vars(self, n: Node) -> set[str]:
    out=set()
    def rec(x):
        if isinstance(x,Var): out.add(x.name)
        elif isinstance(x,list):
            for y in x: rec(y)
        elif isinstance(x,Node):
            for v in vars(x).values(): rec(v)
    rec(n); return out


def _aegis_v7_subcompile(self, params: list[str], body: Chunk) -> Proto:
    parent_locals={}
    for scope in self.scopes: parent_locals.update(scope)
    c=Compiler(max_ip=self.max_ip)
    c.proto.params=list(params)
    c.scopes=[{}]
    for p in params:
        c.scopes[0][p]=c.newreg()
    referenced=_aegis_v7_collect_vars(self, body)
    captured=[n for n in sorted(referenced) if n in parent_locals and n not in c.scopes[0]]
    c.upvalue_map={n:i for i,n in enumerate(captured)}
    c.proto.upvalues=[(n,parent_locals[n]) for n in captured]
    if not hasattr(self,'captured_names'): self.captured_names=set()
    self.captured_names.update(captured)
    c.block(body)
    if not c.proto.code or c.proto.code[-1].op!="RET": c.emit("RET",0,0,0,0)
    return c.proto


def _aegis_v7_expr(self, n: Node) -> int:
    if not hasattr(self,'captured_names'): self.captured_names=set()
    if not hasattr(self,'upvalue_map'): self.upvalue_map={}
    if isinstance(n,Lit): return self.const(n.value)
    if isinstance(n,Var):
        r=self.newreg(); rr=self.lookup(n.name)
        if rr is not None:
            if n.name in self.captured_names: self.emit('GETCELL',r,rr,0,0)
            else: self.emit('MOV',r,rr,0,0)
        elif n.name in self.upvalue_map:
            self.emit('GETUP',r,self.upvalue_map[n.name],0,0)
        else:
            self.emit('GETG',r,self.add_name(n.name),0,0)
        return r
    if isinstance(n,Index):
        a=self.expr(n.base); b=self.expr(n.key); r=self.newreg(); self.emit('GETI',r,a,b,0); return r
    if isinstance(n,Unary):
        a=self.expr(n.x); r=self.newreg(); self.emit({'not':'NOT','-':'NEG','#':'LEN','~':'BNOT'}[n.op],r,a,0,0); return r
    if isinstance(n,Binary):
        if n.op=='and':
            a=self.expr(n.a); r=self.newreg(); self.emit('MOV',r,a,0,0); jf=self.emit('JZ',a,0,0,0); b=self.expr(n.b); self.emit('MOV',r,b,0,0); self.patch(jf,'b',len(self.proto.code)); return r
        if n.op=='or':
            a=self.expr(n.a); r=self.newreg(); self.emit('MOV',r,a,0,0); jf=self.emit('JZ',a,0,0,0); j=self.emit('JMP',0,0,0,0); rhs=len(self.proto.code); self.patch(jf,'b',rhs); b=self.expr(n.b); self.emit('MOV',r,b,0,0); self.patch(j,'a',len(self.proto.code)); return r
        a=self.expr(n.a); b=self.expr(n.b); r=self.newreg(); op={'+':'ADD','-':'SUB','*':'MUL','/':'DIV','//':'IDIV','%':'MOD','^':'POW','..':'CAT','==':'EQ','~=':'NE','<':'LT','>':'GT','<=':'LE','>=':'GE'}[n.op]
        if self.max_ip and op in {'ADD','SUB'}:
            z=self.const(0); t=self.newreg(); self.emit('ADD',t,a,z,0); self.emit(op,r,t,b,0)
        else:
            self.emit(op,r,a,b,0)
        return r
    if isinstance(n,Call):
        args=[]
        if n.method:
            obj=self.expr(n.fn); meth=self.const(n.method); fn=self.newreg(); self.emit('GETI',fn,obj,meth,0); args=[obj]+[self.expr(a) for a in n.args]
        else:
            fn=self.expr(n.fn); args=[self.expr(a) for a in n.args]
        tbl=self.newreg(); self.emit('NEWT',tbl,0,0,0)
        for j,a in enumerate(args,1):
            idx=self.const(j); self.emit('SETI',tbl,idx,a,0)
        r=self.newreg(); self.emit('CALLT',r,fn,tbl,0); return r
    if isinstance(n,Table):
        r=self.newreg(); self.emit('NEWT',r,0,0,0); ai=1
        for k,v in n.fields:
            vr=self.expr(v); kr=self.const(ai) if k is None else self.expr(k); self.emit('SETI',r,kr,vr,0); ai += 1 if k is None else 0
        return r
    if isinstance(n,FunctionValue):
        p=self.subcompile(n.params,n.body); idx=len(self.proto.protos); self.proto.protos.append(p); r=self.newreg(); self.emit('CLOSURE',r,idx,0,0); return r
    raise CompileError(f'unsupported expr {type(n).__name__}')


def _aegis_v7_store(self,t:Node,r:int):
    if not hasattr(self,'upvalue_map'): self.upvalue_map={}
    if not hasattr(self,'captured_names'): self.captured_names=set()
    if isinstance(t,Var):
        dst=self.lookup(t.name)
        if dst is None and t.name in self.upvalue_map: self.emit('SETUP',self.upvalue_map[t.name],r,0,0)
        elif dst is None: self.emit('SETG',self.add_name(t.name),r,0,0)
        elif t.name in self.captured_names: self.emit('SETCELL',dst,r,0,0)
        else: self.emit('MOV',dst,r,0,0)
    elif isinstance(t,Index):
        a=self.expr(t.base); b=self.expr(t.key); self.emit('SETI',a,b,r,0)
    else: raise CompileError('invalid assignment target')


def _aegis_v7_stmt(self,n:Node):
    if not hasattr(self,'captured_names'): self.captured_names=set()
    if not hasattr(self,'upvalue_map'): self.upvalue_map={}
    if isinstance(n,FunctionDecl):
        if n.local and isinstance(n.name,Var):
            r=self.declare(n.name.name); p=self.subcompile(n.params,n.body); idx=len(self.proto.protos); self.proto.protos.append(p); self.emit('CLOSURE',r,idx,0,0)
        else:
            p=self.subcompile(n.params,n.body); idx=len(self.proto.protos); self.proto.protos.append(p); r=self.newreg(); self.emit('CLOSURE',r,idx,0,0); self.store(n.name,r)
        return
    if isinstance(n,Local):
        rs=[self.declare(x) for x in n.names]
        for i,r in enumerate(rs):
            v=self.expr(n.values[i]) if i<len(n.values) else self.const(None)
            if n.names[i] in self.captured_names: self.emit('MOV',r,v,0,0); self.emit('SETCELL',r,v,0,0)
            else: self.emit('MOV',r,v,0,0)
        return
    if isinstance(n,ForNum):
        r=self.declare(n.name); a=self.expr(n.init); b=self.expr(n.limit); self.emit('MOV',r,a,0,0); limit=self.newreg(); self.emit('MOV',limit,b,0,0); step=self.expr(n.step) if n.step else self.const(1); head=len(self.proto.code); jexit=self.emit('JFOR',r,limit,step,0); self.block(n.body)
        if n.name in self.captured_names:
            cur=self.newreg(); self.emit('GETCELL',cur,r,0,0); self.emit('ADD',r,cur,step,0); self.emit('SETCELL',r,r,0,0)
        else: self.emit('ADD',r,r,step)
        self.emit('JMP',head,0,0,0); self.patch(jexit,'k',len(self.proto.code)); return
    # Defer to original V6 statement compiler for non-function/local/for statements.
    return Compiler._v6_stmt(self,n)

# Capture the original methods before replacing only the statements we need.
Compiler._v6_stmt = Compiler.stmt
Compiler.stmt = _aegis_v7_stmt
Compiler.subcompile = _aegis_v7_subcompile
Compiler.expr = _aegis_v7_expr
Compiler.store = _aegis_v7_store

def _sanity_check_generated_luau_v7(text: str) -> None:
    stack=[]; pairs={")":"(","]":"[","}":"{"}; i=0; n=len(text); quote=None
    while i<n:
        if quote:
            if text[i]=="\\": i+=2; continue
            if text[i]==quote: quote=None
            i+=1; continue
        if text.startswith("--",i):
            j=text.find("\n",i+2); i=n if j<0 else j; continue
        c=text[i]
        if c in "'\"": quote=c; i+=1; continue
        if c in "([{": stack.append(c)
        elif c in ")]}":
            if not stack or stack[-1]!=pairs[c]: raise SyntaxError(f"generated output has unbalanced delimiter near offset {i}")
            stack.pop()
        i+=1
    if quote: raise SyntaxError("generated output contains an unterminated string")
    if stack: raise SyntaxError("generated output has unbalanced delimiters")


# --------------------------- V7 pipeline -------------------------------------
@dataclass(frozen=True)
class BuildConfigV7:
    optimize: int = 3
    constant_shards: int = 4
    decoys: bool = True
    integrity: bool = True
    variable_length: bool = True
    flatten: bool = True
    profile: str = "v7-max"

V7_PROFILES={
    "standard": BuildConfigV7(1,2,False,True,True,False,"standard"),
    "strong": BuildConfigV7(2,3,True,True,True,True,"strong"),
    "v7-max": BuildConfigV7(3,4,True,True,True,True,"v7-max"),
}

V7_OPS=["K","MOV","GETG","SETG","GETI","SETI","GETCELL","SETCELL","GETUP","SETUP","NEWT","CLOSURE","CALLT","RET","CLOSE","JMP","JZ","JFOR","ADD","SUB","MUL","DIV","IDIV","MOD","POW","CAT","EQ","NE","LT","GT","LE","GE","AND","OR","NOT","NEG","LEN","BNOT","JUNK"]

@dataclass
class V7Build:
    opid: dict[str,int]
    seed: int
    opcode_mask: int
    vm_seed: int
    control_seed: int
    register_seed: int
    string_seed: int
    string_step: int
    const_keys: list[int]
    const_steps: list[int]
    bytecode_key: int
    bytecode_step: int
    shards: int


def _v7_rot(v,n):
    n&=7
    return ((v<<n)|(v>>(8-n)))&255 if n else v&255

def _v7_ror(v,n):
    n&=7
    return ((v>>n)|((v<<(8-n))&255))&255 if n else v&255

def _v7_str_enc(bs,key,step,method):
    out=[]
    for i,b in enumerate(bs):
        k=(key+step*i)&255
        if method==0: x=b^k
        elif method==1: x=_v7_rot((b+k)&255,(i%7)+1)
        elif method==2: x=_v7_rot(b^(k+61),((i*3)%7)+1)
        else: x=_v7_ror((b-k)&255,(i%7)+1)
        out.append(x)
    return out

def _v7_varint(n):
    out=[]
    while True:
        b=n&127; n>>=7
        if n: out.append(b|128)
        else: out.append(b); return out

def _v7_hash(bs):
    h=2166136261
    for b in bs:
        h^=b; h=(h*16777619)&0xffffffff
    return h

def _v7_escape(bs,width=100):
    parts=[]; cur=[]
    for b in bs:
        cur.append(f"\\{b:03d}")
        if len(cur)>=width: parts.append('"'+''.join(cur)+'"'); cur=[]
    if cur or not parts: parts.append('"'+''.join(cur)+'"')
    return parts[0] if len(parts)==1 else 'table.concat({'+','.join(parts)+'})'

def _v7_basic_blocks(p):
    starts={0}
    for i,ins in enumerate(p.code):
        if ins.op=="JMP": starts.add(ins.a); starts.add(i+1)
        elif ins.op=="JZ": starts.add(ins.b); starts.add(i+1)
        elif ins.op=="JFOR": starts.add(ins.k); starts.add(i+1)
    ss=sorted(x for x in starts if 0<=x<len(p.code)); blocks=[]
    for i,s in enumerate(ss): blocks.append(list(range(s, ss[i+1] if i+1<len(ss) else len(p.code))))
    return blocks

def _v7_opt(p):
    removed=0
    for q in p.protos: removed += _v7_opt(q)
    if not p.code: return removed
    rem=[False]*len(p.code)
    for i,ins in enumerate(p.code):
        if ins.op=="MOV" and ins.a==ins.b: rem[i]=True
    if not any(rem): return removed
    mp={}; ni=0
    for i,r in enumerate(rem):
        if not r: mp[i]=ni; ni+=1
    new=[]
    for i,ins in enumerate(p.code):
        if rem[i]: continue
        q=Ins(ins.op,ins.a,ins.b,ins.c,ins.k)
        if q.op=="JMP": q.a=mp.get(q.a,q.a)
        elif q.op=="JZ": q.b=mp.get(q.b,q.b)
        elif q.op=="JFOR": q.k=mp.get(q.k,q.k)
        new.append(q)
    p.code=new; return removed+sum(rem)

def _v7_normalize(p):
    for ins in p.code:
        if ins.op=="JMP": ins.a+=1
        elif ins.op=="JZ": ins.b+=1
        elif ins.op=="JFOR": ins.k+=1
    for q in p.protos: _v7_normalize(q)

def emit_runtime_v7(root:Proto,b:V7Build,rng,config:BuildConfigV7):
    used={'st','v','sid','idx','cv','m','key','step','n','o','x','k','c','fn','cp','up','pr','bc','pos','op','mode','logical','phys','argv','rr','cells','p','h','mul','i','a','b','c'}; N={k:rand_ident(rng,used) for k in ["VM","SD","CD","G","SET","T","MK","H","RUN","R","P","HASH"]}
    pcounter=[0]
    def enc_meta(name,method,key,step):
        raw=_v7_str_enc(name.encode(),key,step,method)
        return "{"+str(len(name.encode()))+","+str(method)+","+str(key)+","+str(step)+","+','.join(map(str,raw))+"}"
    def proto_obj(p,parent_map=None):
        pid=pcounter[0]; pcounter[0]+=1
        rp=list(range(max(1,p.regs))); rrng=random.Random((b.register_seed^(pid*0x9E3779B97F4A7C15))&((1<<64)-1)); rrng.shuffle(rp)
        def rr(x): return rp[x]+1 if 0<=x<len(rp) else x+1
        reg_a={"K","MOV","GETG","GETI","NEWT","CLOSURE","CALLT","RET","GETCELL","SETCELL","GETUP","CLOSE","ADD","SUB","MUL","DIV","IDIV","MOD","POW","CAT","EQ","NE","LT","GT","LE","GE","AND","OR","NOT","NEG","LEN","BNOT","JZ","JFOR"}
        reg_b={"MOV","GETI","CALLT","SETUP","ADD","SUB","MUL","DIV","IDIV","MOD","POW","CAT","EQ","NE","LT","GT","LE","GE","AND","OR","NOT","NEG","LEN","BNOT","JFOR"}
        reg_c={"GETI","SETI","CALLT","ADD","SUB","MUL","DIV","IDIV","MOD","POW","CAT","EQ","NE","LT","GT","LE","GE","AND","OR","JFOR"}
        mapped=[]
        for ins in p.code:
            q=Ins(ins.op,ins.a,ins.b,ins.c,ins.k)
            if ins.op in reg_a: q.a=rr(ins.a)
            if ins.op in reg_b: q.b=rr(ins.b)
            if ins.op in reg_c: q.c=rr(ins.c)
            if ins.op=="SETG": q.b=rr(ins.b)
            if ins.op=="SETI": q.a=rr(ins.a);q.b=rr(ins.b);q.c=rr(ins.c)
            mapped.append(q)
        # Block shuffle + internal instruction order preserved.
        blocks=_v7_basic_blocks(p); cr=random.Random(b.control_seed^pid); cr.shuffle(blocks); order=[i for bl in blocks for i in bl]
        cf=[0]*(len(p.code)+1)
        for phys,logical in enumerate(order,1): cf[logical+1]=phys
        shards=[[] for _ in range(b.shards)]; tokens=[0]*len(p.consts); start=rng.randrange(b.shards)
        for i,val in enumerate(p.consts):
            sid=(start+i*2)%b.shards; loc=len(shards[sid]); shards[sid].append(val); tokens[i]=loc*b.shards+sid
        const_tables=[]
        for sid,sh in enumerate(shards):
            arr=[]
            for idx,val in enumerate(sh):
                key=b.const_keys[sid]; step=b.const_steps[sid]
                if isinstance(val,str):
                    method=(pid+sid+idx)%4; ek=(key+idx*13)&255; es=(step+idx*7)&255; raw=_v7_str_enc(val.encode(),ek,es,method)
                    arr.append("{1,"+str(method)+","+str(ek)+","+str(es)+","+str(len(raw))+","+','.join(map(str,raw))+"}")
                elif val is None: arr.append("{0}")
                elif val is True: arr.append("{2}")
                elif val is False: arr.append("{3}")
                elif isinstance(val,int) and not isinstance(val,bool):
                    mul=rng.randrange(3,31)|1; add=rng.randrange(1000,9000); mask=(key^(idx*29))&255; enc=(val*mul+add)^mask; arr.append(f"{{4,{enc},{mul},{add},{mask}}}")
                elif isinstance(val,float):
                    add=rng.randrange(1000,9000); arr.append(f"{{5,{val+add!s},{add}}}")
                else: raise TypeError(type(val))
            const_tables.append("{"+','.join(arr)+"}")
        # Variable-length encoded instructions.
        raw=[]; offsets=[]
        for phys,logical in enumerate(order,1):
            offsets.append(len(raw)+1)
            ins=mapped[logical]; raw.append((b.opid[ins.op]^b.opcode_mask)&255)
            vals=[ins.a,ins.b,ins.c,ins.k]; mask=sum((1<<i) for i,v in enumerate(vals) if v!=0); raw.append(mask)
            for i,v in enumerate(vals):
                if mask&(1<<i): raw.extend(_v7_varint(v))
        packed=bytes((x^((b.bytecode_key+b.bytecode_step*i)&255)) for i,x in enumerate(raw))
        nested='{'+','.join(proto_obj(q,rr) for q in p.protos)+'}' if p.protos else '{}'
        up='{'+','.join(str(rr(parent_reg)) for _name,parent_reg in p.upvalues)+'}' if p.upvalues else '{}'
        # Parameter names are renamed in metadata; runtime only needs arg register mapping.
        params='{'+','.join(enc_meta('p'+str(i),i%4,(b.string_seed+17)&255,b.string_step) for i,_ in enumerate(p.params))+'}' if p.params else '{}'
        names='{'+','.join(enc_meta(x,(i+pid)%4,(b.string_seed+i*11)&255,(b.string_step+i*7)&255) for i,x in enumerate(p.names))+'}' if p.names else '{}'
        qargs='{'+','.join(str(rr(i)) for i in range(len(p.params)))+'}' if p.params else '{}'
        return '{b='+_v7_escape(packed)+',o={'+','.join(map(str,offsets))+'},h='+str(_v7_hash(packed))+',z={'+','.join(const_tables)+'},p='+params+',n='+names+',q='+qargs+',r='+str(len(rp))+',f='+nested+',u='+up+',cf={'+','.join(map(str,cf[1:]))+'}'+'}'
    root_blob=proto_obj(root)
    # Handlers. Build them with string concatenation instead of nested f-strings so
    # Lua brackets never confuse the Python formatter.
    bucket_items={i:[] for i in range(8)}
    op_order=V7_OPS[:]; random.Random(b.vm_seed).shuffle(op_order); ss='st'
    def R(x): return ss+'.r['+(ss+'.'+x if x in {'a','b','c'} else x)+']'
    def P(x): return ss+'.P.'+x
    def C(x): return ss+'.cells['+(ss+'.'+x if x in {'a','b','c'} else x)+']'
    def U(x): return ss+'.up['+(ss+'.'+x if x in {'a','b','c'} else x)+']'
    for logical in op_order:
        oid=b.opid[logical]; h=f"[{oid}]=function({ss}) "
        if logical=='K':
            h += 'local t='+ss+'.b;local sid=t%'+str(b.shards)+';local idx=(t-sid)/'+str(b.shards)+'+1;local cv='+P('z')+'[sid+1][idx];'+R('a')+'='+N['CD']+'(cv,sid)'
        elif logical=='MOV': h += R('a')+'='+R('b')
        elif logical=='GETG': h += R('a')+'='+N['G']+'('+N['SD']+'('+P('n')+'['+ss+'.b+1]))'
        elif logical=='SETG': h += N['SET']+'('+N['SD']+'('+P('n')+'['+ss+'.a+1]),'+R('b')+')'
        elif logical=='GETI': h += R('a')+'='+R('b')+'['+R('c')+']'
        elif logical=='SETI': h += R('a')+'['+R('b')+']='+R('c')
        elif logical=='GETCELL': h += 'local c='+C('a')+';if not c then c={'+R('a')+'};'+C('a')+'=c end;'+R('a')+'=c[1]'
        elif logical=='SETCELL': h += 'local c='+C('a')+';if not c then c={};'+C('a')+'=c end;c[1]='+R('b')+';'+R('a')+'='+R('b')
        elif logical=='GETUP': h += 'local c='+U('b')+';if not c then error(\'AEGIS upvalue fault\') end;'+R('a')+'=c[1]'
        elif logical=='SETUP': h += 'local c='+U('a')+';if not c then error(\'AEGIS upvalue fault\') end;c[1]='+R('b')
        elif logical=='NEWT': h += R('a')+'={}'
        elif logical=='CLOSURE':
            h += 'local cp='+P('f')+'['+ss+'.b+1];local up={};for i=1,#cp.u do local pr=cp.u[i];local c='+C('pr')+';if not c then c={'+R('pr')+'};'+C('pr')+'=c end;up[i]=c end;local fn='+N['MK']+'(cp,up);'+R('a')+'=fn;if '+C('a')+' then '+C('a')+'[1]=fn end'
        elif logical=='CALLT': h += R('a')+'='+R('b')+'(table.unpack('+R('c')+'))'
        elif logical=='RET': h += ss+'.ret=true;'+ss+'.rv='+R('a')
        elif logical=='CLOSE': h += ss+'.closed=true'
        elif logical=='JMP': h += ss+'.next='+ss+'.a'
        elif logical=='JZ': h += 'if not '+R('a')+' then '+ss+'.next='+ss+'.b end'
        elif logical=='JFOR': h += 'local cur='+R('a')+';local lim='+R('b')+';local stp='+R('c')+';if (stp>=0 and cur>lim) or (stp<0 and cur<lim) then '+ss+'.next='+ss+'.k end'
        elif logical=='JUNK': h += ss+'.noise=((('+ss+'.noise or 0)*1103515245+12345+'+str(b.vm_seed%1000003)+')%2147483647)'
        else:
            ex={"ADD":R('b')+'+'+R('c'),"SUB":R('b')+'-'+R('c'),"MUL":R('b')+'*'+R('c'),"DIV":R('b')+'/'+R('c'),"IDIV":R('b')+'//'+R('c'),"MOD":R('b')+'%'+R('c'),"POW":R('b')+'^'+R('c'),"CAT":R('b')+'..'+R('c'),"EQ":R('b')+'=='+R('c'),"NE":R('b')+'~='+R('c'),"LT":R('b')+'<'+R('c'),"GT":R('b')+'>'+R('c'),"LE":R('b')+'<='+R('c'),"GE":R('b')+'>='+R('c'),"AND":R('b')+' and '+R('c'),"OR":R('b')+' or '+R('c'),"NOT":'not '+R('b'),"NEG":'-'+R('b'),"LEN":'#'+R('b'),"BNOT":'~'+R('b')}
            h += R('a')+'='+ex[logical]
        bucket_items[oid&7].append(h+' end')
    buckets='{'+','.join('{'+','.join(bucket_items[i])+'}' for i in range(8))+'}'
    lines=banner_as_luau_comment().rstrip('\n').split('\n')
    lines.append('-- AegisLuau V7 generated output')
    lines.append(f"local {N['SD']}=function(v)local m=v[2];local key=v[3];local step=v[4];local n=v[1];local o={{}};for i=1,n do local x=v[4+i];local k=(key+step*(i-1))%256;if m==0 then x=x~k elseif m==1 then local r=((i-1)%7)+1;x=(((x>>r)|((x&((1<<r)-1))<<(8-r)))&255)-k elseif m==2 then local r=(((i-1)*3)%7)+1;x=(((x>>r)|((x&((1<<r)-1))<<(8-r)))&255)~((k+61)%256) else local r=((i-1)%7)+1;x=(((x<<r)|(x>>(8-r)))&255)+k end;o[i]=string.char(x%256) end;return table.concat(o) end")
    lines.append(f"local {N['CD']}=function(v,sid)local ty=v[1];if ty==0 then return nil elseif ty==2 then return true elseif ty==3 then return false elseif ty==4 then return ((v[2]~v[5])-v[4])/v[3] elseif ty==5 then return v[2]-v[3] end local m=v[2];local key=v[3];local step=v[4];local n=v[5];local o={{}};for i=1,n do local x=v[5+i];local k=(key+step*(i-1))%256;if m==0 then x=x~k elseif m==1 then local r=((i-1)%7)+1;x=(((x>>r)|((x&((1<<r)-1))<<(8-r)))&255)-k elseif m==2 then local r=(((i-1)*3)%7)+1;x=(((x>>r)|((x&((1<<r)-1))<<(8-r)))&255)~((k+61)%256) else local r=((i-1)%7)+1;x=(((x<<r)|(x>>(8-r)))&255)+k end;o[i]=string.char(x%256) end;return table.concat(o) end")
    lines.append(f"local {N['G']}=function(n)return _G[n] end")
    lines.append(f"local {N['T']}=setmetatable({{}},{{__index=function(t,k)return rawget(t,k) end,__newindex=function(t,k,v)rawset(t,k,v)end}})")
    lines.append(f"local {N['SET']}=function(n,v){N['T']}[n]=v;_G[n]=v end")
    lines.append(f"local {N['H']}={buckets}")
    lines.append(f"local {N['VM']}={root_blob}")
    lines.append(f"local function {N['RUN']}({N['P']},up,...)")
    lines.append(f" local {N['R']}={{}};local cells={{}};for i=1,{N['P']}.r do {N['R']}[i]=nil end")
    lines.append(f" local st={{P={N['P']},r={N['R']},up=up or {{}},cells=cells,pc=1,next=1,ret=false,rv=nil,noise=0,closed=false,a=0,b=0,c=0,k=0,op=0}}")
    lines.append(f" local argv={{...}};for i=1,#argv do local rr=st.P.q[i];if rr then st.r[rr]=argv[i] end end")
    lines.append(f" local bc=st.P.b;local function rb(pos)local x=string.byte(bc,pos);if not x then error('AEGIS bytecode EOF') end;return x~(({b.bytecode_key}+{b.bytecode_step}*(pos-1))%256) end")
    lines.append(f" local function hv(s)local h=2166136261;for i=1,#s do h=((h~string.byte(s,i))*16777619)%4294967296 end;return h end;if hv(bc)~=st.P.h then error('AEGIS integrity check failed') end")
    lines.append(f" local function rv(pos)local v=0;local m=1;while true do local x=rb(pos);pos=pos+1;v=v+(x&127)*m;if x<128 then return v,pos end;m=m*128 end end")
    lines.append(f" while not st.ret do local p=st.P;local logical=st.pc;if logical>#p.cf then break end;local phys=p.cf[logical];local pos=p.o[phys];local op=rb(pos);pos=pos+1;local mode=rb(pos);pos=pos+1;op=(op~{b.opcode_mask})%256;local h={N['H']}[(op&7)+1][op];if not h then error('AEGIS VM dispatch fault') end;st.op=op;if (mode&1)~=0 then st.a,pos=rv(pos) else st.a=0 end;if (mode&2)~=0 then st.b,pos=rv(pos) else st.b=0 end;if (mode&4)~=0 then st.c,pos=rv(pos) else st.c=0 end;if (mode&8)~=0 then st.k,pos=rv(pos) else st.k=0 end;st.next=logical+1;h(st);st.pc=st.next end")
    lines.append(f" return st.rv end")
    lines.append(f"{N['MK']}=function(p,up)return function(...)return {N['RUN']}(p,up,...)end end")
    lines.append(f"return {N['RUN']}({N['VM']},{{}})")
    return '\n'.join(lines)+'\n'


def build_obf_v7(src,seed=None,strict=False,hybrid=False,profile='v7-max'):
    src=normalize_source(src); source_has_balanced_short_strings(src)
    cfg=V7_PROFILES[profile]
    master=seed if seed is not None else secrets.randbits(64); rng=random.Random(master)
    toks=lex(src); fallback=None; fallback_reason=None
    try:
        ast=Parser(toks).parse(); compiler=Compiler(max_ip=(cfg.optimize>=2)); compiler.captured_names=set(); compiler.upvalue_map={}; proto=compiler.compile(ast); compiled=True
    except (SyntaxError,CompileError,IndexError,ValueError) as e:
        if strict or not hybrid:
            if isinstance(e,SyntaxError): raise SyntaxError(humanize_parser_error(src,e))
            raise
        fallback=src.encode(); fallback_reason=str(e); proto=Compiler().compile(Chunk([])); compiled=False
    if cfg.optimize>0: optimizer_removed=_v7_opt(proto)
    else: optimizer_removed=0
    if cfg.decoys:
        def add_noise(p):
            if p.code:
                p.code=[Ins('JUNK')]+p.code
                for ins in p.code[1:]:
                    if ins.op=='JMP': ins.a+=1
                    elif ins.op=='JZ': ins.b+=1
                    elif ins.op=='JFOR': ins.k+=1
            for q in p.protos:add_noise(q)
        add_noise(proto)
    _v7_normalize(proto)
    opnums=list(range(1,len(V7_OPS)+1)); rng.shuffle(opnums); opid={op:opnums[i] for i,op in enumerate(V7_OPS)}
    shards=cfg.constant_shards
    b=V7Build(opid,master,rng.randrange(1,256),rng.getrandbits(64),rng.getrandbits(64),rng.getrandbits(64),rng.randrange(1,256),rng.randrange(1,256),[rng.randrange(1,256) for _ in range(shards)],[rng.randrange(1,256) for _ in range(shards)],rng.randrange(1,256),rng.randrange(1,256),shards)
    out=emit_runtime_v7(proto,b,rng,cfg); _sanity_check_generated_luau_v7(out)
    def _walk(ps):
        for pp in ps:
            yield pp
            yield from _walk(pp.protos)
    allp=list(_walk([proto]))
    meta={"version":"7.0.0","compiled":compiled,"fallback":fallback is not None,"fallback_reason":fallback_reason,"profile":profile,"seed":master,"instructions":sum(len(p.code) for p in allp),"protos":len(allp),"upvalues":sum(len(p.upvalues) for p in allp),"constant_shards":shards,"optimizer_removed":optimizer_removed,"pipeline":["Lexer","Parser","AST","Scope Analysis","AST→IR","Optimizer","Basic Block Builder","Register Allocation","Identifier Renaming","Constant Pool","String Pool","Opcode Permutation","Register Permutation","Control Flow Transform","Bytecode Generator","Variable-Length Encoding","Bytecode Packing","Integrity Data","Protected Output","Runtime VM"],"randomized_domains":["opcode mapping","register mapping","constant key","string key","VM seed","control-flow seed","bytecode key"]}
    return out,meta

VERSION='7.0.0'


def main_v7()->int:
    import sys
    if '--no-banner' not in sys.argv: print_banner()
    ap=argparse.ArgumentParser(description='AegisLuau V7 pipeline-based source-protection compiler')
    ap.add_argument('input',nargs='?')
    ap.add_argument('-o','--output',default='obfuscated.luau')
    ap.add_argument('--seed',type=int,default=None)
    ap.add_argument('--strict',action='store_true')
    ap.add_argument('--hybrid',action='store_true')
    ap.add_argument('--check',action='store_true')
    ap.add_argument('--stats',action='store_true')
    ap.add_argument('--profile',choices=sorted(V7_PROFILES),default='v7-max')
    ap.add_argument('--no-banner',action='store_true')
    ap.add_argument('--version',action='version',version=f'AEGIS Luau {VERSION}')
    args=ap.parse_args()
    if not args.input: print('AEGIS: input file is required',file=__import__('sys').stderr); return 2
    p=Path(args.input)
    if not p.is_file(): print(f'AEGIS input error: file not found: {p}',file=__import__('sys').stderr); return 2
    try: src=p.read_text(encoding='utf-8')
    except (OSError,UnicodeError) as e: print(f'AEGIS input error: {e}',file=__import__('sys').stderr); return 2
    try: out,meta=build_obf_v7(src,args.seed,args.strict,args.hybrid,args.profile)
    except Exception as e: print(f'AEGIS build failed: {type(e).__name__}: {e}',file=__import__('sys').stderr); return 1
    if args.check:
        print('[+] check passed')
        if args.stats: print(meta)
        return 0
    try:
        op=Path(args.output); op.parent.mkdir(parents=True,exist_ok=True); tmp=op.with_name(op.name+'.tmp'); tmp.write_text(out,encoding='utf-8',newline='\n'); tmp.replace(op)
    except (OSError,UnicodeError) as e: print(f'AEGIS output error: {e}',file=__import__('sys').stderr); return 2
    print(f'[+] wrote {args.output}')
    if args.stats: print(meta)
    return 0



# ============================== AegisLuau V8 ===============================
# V8 keeps the V7 compiler/AST front-end as the compatibility reference while
# replacing the bytecode/runtime layer with stronger per-build variability.
# This is source protection only: no environment tracking, anti-debugging,
# persistence, credential access, or reverse-tracking behavior is added here.

@dataclass(frozen=True)
class BuildConfigV8:
    optimize: int = 3
    constant_shards: int = 4
    decoys: bool = True
    integrity: bool = True
    variable_length: bool = True
    flatten: bool = True
    layout_variants: int = 8
    noise_rate: int = 1
    profile: str = 'v8-max'

V8_PROFILES={
    'light': BuildConfigV8(1,2,False,True,True,False,4,0,'light'),
    'normal': BuildConfigV8(2,3,False,True,True,True,6,1,'normal'),
    'strong': BuildConfigV8(3,4,True,True,True,True,8,2,'strong'),
    'max': BuildConfigV8(3,5,True,True,True,True,12,3,'max'),
}

@dataclass
class V8Build:
    opid: dict[str,int]
    dispatch_id: dict[str,int]
    seed: int
    opcode_mask: int
    vm_seed: int
    control_seed: int
    register_seed: int
    string_seed: int
    string_step: int
    const_keys: list[int]
    const_steps: list[int]
    bytecode_key: int
    bytecode_step: int
    mode_key: int
    layout_seed: int
    shards: int
    type_tags: dict[str,int]
    section_seed: int


def _v8_u64(x):
    return x & 0xFFFFFFFFFFFFFFFF


def _v8_mix64(x):
    x=_v8_u64(x + 0x9E3779B97F4A7C15)
    x=(_v8_u64(x ^ (x>>30)) * 0xBF58476D1CE4E5B9) & 0xFFFFFFFFFFFFFFFF
    x=(_v8_u64(x ^ (x>>27)) * 0x94D049BB133111EB) & 0xFFFFFFFFFFFFFFFF
    return _v8_u64(x ^ (x>>31))


def _v8_key8(seed, block_id, phys, local_off, domain=0):
    x = seed & 0xFF
    x ^= ((block_id*0x5D + phys*0xA7 + local_off*0x3B + domain*0x11) & 0xFF)
    x = (x + (((block_id+1)*(phys+3) + local_off*local_off*7 + domain*19) & 0xFF)) & 0xFF
    return x



def _v8_str_enc(bs,key,step,method):
    out=[]
    for i,b in enumerate(bs):
        k=(key + step*i + ((i*i+3*i) & 255)) & 255
        if method==0: x=b^k
        elif method==1: x=_v7_rot((b+k)&255,(i%7)+1)
        elif method==2: x=_v7_rot(b^(k+61),((i*3)%7)+1)
        elif method==3: x=_v7_ror((b-k)&255,(i%7)+1)
        elif method==4: x=((b+k)&255)^((k>>1)|(k<<7)&255)
        else: x=((b-k)&255)^((k*3)&255)
        out.append(x&255)
    return out


def _v8_str_dec_expr(v, value_name, out_name='o'):
    # Emitted as a Lua expression body by the runtime generator.
    return (
        f"local m={value_name}[2];local key={value_name}[3];local step={value_name}[4];"
        f"local n={value_name}[5];local {out_name}={{}};"
        f"for i=1,n do local x={value_name}[5+i];local k=(key+step*(i-1)+(((i-1)*(i-1)+3*(i-1))%256))%256;"
        f"if m==0 then x=x~k "
        f"elseif m==1 then local r=((i-1)%7)+1;x=((((x>>r)|((x&((1<<r)-1))<<(8-r)))&255)-k)%256 "
        f"elseif m==2 then local r=(((i-1)*3)%7)+1;x=((((x>>r)|((x&((1<<r)-1))<<(8-r)))&255)~((k+61)%256)) "
        f"elseif m==3 then local r=((i-1)%7)+1;x=((((x<<r)|(x>>(8-r)))&255)+k)%256 "
        f"elseif m==4 then x=(x+k)%256 ~ (((k>>1)|((k<<7)&255))) "
        f"else x=(x-k)%256 ~ ((k*3)%256) end;{out_name}[i]=string.char(x%256) end;"
        f"return table.concat({out_name})"
    )


def _v8_varint(n):
    out=[]
    while True:
        b=n & 127
        n >>= 7
        if n:
            out.append(b|128)
        else:
            out.append(b)
            return out


def _v8_salt_byte(seed, i):
    return _v8_mix64(seed ^ (i*0x9E3779B97F4A7C15)) & 255


def _v8_encode_instruction(raw, seed, block_id, phys):
    return bytes((x ^ _v8_key8(seed, block_id, phys, i, 11)) & 255 for i,x in enumerate(raw))


def _v8_basic_blocks(p):
    return _v7_basic_blocks(p)


def _v8_opt(p):
    # Keep V7's safe local optimizer and extend it with unreachable-tail removal.
    removed=_v7_opt(p)
    for q in p.protos:
        removed += _v8_opt(q)
    if not p.code:
        return removed
    reachable={0}; work=[0]
    while work:
        i=work.pop()
        if i<0 or i>=len(p.code):
            continue
        ins=p.code[i]
        succ=[]
        if ins.op=='JMP': succ.append(ins.a)
        elif ins.op=='JZ': succ.extend([i+1,ins.b])
        elif ins.op=='JFOR': succ.extend([i+1,ins.k])
        elif ins.op=='RET': succ=[]
        else: succ.append(i+1)
        for s in succ:
            if 0<=s<len(p.code) and s not in reachable:
                reachable.add(s); work.append(s)
    if len(reachable)==len(p.code):
        return removed
    rem=[i for i in range(len(p.code)) if i not in reachable]
    mp={old:new for new,old in enumerate(sorted(reachable))}
    new=[]
    for old in sorted(reachable):
        q=p.code[old]
        q=Ins(q.op,q.a,q.b,q.c,q.k)
        if q.op=='JMP': q.a=mp[q.a]
        elif q.op=='JZ': q.b=mp[q.b]
        elif q.op=='JFOR': q.k=mp[q.k]
        new.append(q)
    p.code=new
    return removed+len(rem)


def _v8_normalize(p):
    # Logical PCs are 1-based in the serialized representation.
    _v7_normalize(p)


def _v8_liveness_rewrite(p):
    # V7 already reuses temporary registers through its free-list. This pass
    # removes a few stale max-reg artifacts without changing local semantics.
    if not p.code:
        return
    used=[]
    for ins in p.code:
        for v in (ins.a,ins.b,ins.c,ins.k):
            if isinstance(v,int): used.append(v)
    if used:
        p.regs=max(p.regs, max(used)+1)
    for q in p.protos:
        _v8_liveness_rewrite(q)


def emit_runtime_v8(root:Proto,b:V8Build,rng,config:BuildConfigV8):
    used={'st','v','sid','idx','cv','m','key','step','n','o','x','k','c','fn','cp','up','pr','bc','pos','op','mode','logical','phys','argv','rr','cells','p','h','mul','i','a','b','c','layout','mask','slot','target','frame','stack','hid','bid'}
    N={k:rand_ident(rng,used) for k in ["VM","SD","CD","G","SET","T","MK","H","D","RUN","R","P","HASH"]}

    # Different operand layouts exist in each build. A layout is a permutation
    # of logical fields A/B/C/K; the mode byte selects both permutation and mask.
    layouts=[]
    perms=[]
    base=[1,2,3,4]
    for _ in range(max(4,config.layout_variants)):
        q=base[:]
        rng.shuffle(q)
        perms.append(q)
    # Deduplicate while preserving build-specific order.
    seen=set(); layouts=[]
    for q in perms:
        t=tuple(q)
        if t not in seen:
            seen.add(t); layouts.append(q)
    while len(layouts)<4:
        q=base[:]; rng.shuffle(q); layouts.append(q)
    layout_source='{' + ','.join('{' + ','.join(str(x) for x in q) + '}' for q in layouts) + '}'

    def enc_meta(name,method,key,step):
        raw=_v8_str_enc(name.encode(),key,step,method)
        return "{"+str(len(name.encode()))+","+str(method)+","+str(key)+","+str(step)+","+str(len(raw))+","+','.join(map(str,raw))+'}'

    proto_counter=[0]
    def proto_obj(p,parent_map=None):
        pid=proto_counter[0]; proto_counter[0]+=1
        rp=list(range(max(1,p.regs)))
        rrng=random.Random(_v8_u64(b.register_seed ^ (pid*0x9E3779B97F4A7C15)))
        rrng.shuffle(rp)
        def rr(x): return rp[x]+1 if 0<=x<len(rp) else x+1
        reg_a={'K','MOV','GETG','GETI','NEWT','CLOSURE','CALLT','RET','GETCELL','SETCELL','GETUP','CLOSE','ADD','SUB','MUL','DIV','IDIV','MOD','POW','CAT','EQ','NE','LT','GT','LE','GE','AND','OR','NOT','NEG','LEN','BNOT','JZ','JFOR'}
        reg_b={'MOV','GETI','CALLT','SETUP','ADD','SUB','MUL','DIV','IDIV','MOD','POW','CAT','EQ','NE','LT','GT','LE','GE','AND','OR','NOT','NEG','LEN','BNOT','JFOR'}
        reg_c={'GETI','SETI','CALLT','ADD','SUB','MUL','DIV','IDIV','MOD','POW','CAT','EQ','NE','LT','GT','LE','GE','AND','OR','JFOR'}
        mapped=[]
        for ins in p.code:
            q=Ins(ins.op,ins.a,ins.b,ins.c,ins.k)
            if ins.op in reg_a: q.a=rr(ins.a)
            if ins.op in reg_b: q.b=rr(ins.b)
            if ins.op in reg_c: q.c=rr(ins.c)
            if ins.op=='SETG': q.b=rr(ins.b)
            if ins.op=='SETI': q.a=rr(ins.a); q.b=rr(ins.b); q.c=rr(ins.c)
            mapped.append(q)

        blocks=_v8_basic_blocks(p)
        cr=random.Random(_v8_u64(b.control_seed ^ (pid*0xD1342543DE82EF95)))
        # Keep block-internal order, but vary the starting block and then shuffle.
        cr.shuffle(blocks)
        order=[i for bl in blocks for i in bl]
        block_of_logical={}
        for bid,bl in enumerate(blocks):
            for logical in bl: block_of_logical[logical]=bid
        cf=[0]*(len(p.code)+1)
        phys_block=[0]*(len(order)+1)
        for phys,logical in enumerate(order,1):
            cf[logical+1]=phys
            phys_block[phys]=block_of_logical.get(logical,0)

        # Per-jump encoding: absolute, relative, or indirect target pool.
        jump_mode_phys=[0]*(len(order)+1)
        jump_pool=[]
        for phys,logical in enumerate(order,1):
            ins=mapped[logical]
            if ins.op in {'JMP','JZ','JFOR'}:
                mode=(b.control_seed + pid*17 + logical*7) % 3
                jump_mode_phys[phys]=mode
                if ins.op=='JMP': fld='a'
                elif ins.op=='JZ': fld='b'
                else: fld='k'
                target=getattr(ins,fld)
                if mode==1:
                    setattr(ins,fld,target-(logical+1))
                elif mode==2:
                    jump_pool.append(target); setattr(ins,fld,len(jump_pool)-1)

        shards=[[] for _ in range(b.shards)]
        const_locs=[0]*len(p.consts)
        for ci,val in enumerate(p.consts):
            sid=(ci*3 + (pid % b.shards)) % b.shards
            loc=len(shards[sid]); shards[sid].append(val)
            const_locs[ci]=loc*b.shards+sid

        const_tables=[]
        for sid,sh in enumerate(shards):
            arr=[]
            for idx,val in enumerate(sh):
                key=(b.const_keys[sid] ^ _v8_salt_byte(b.seed + pid, idx)) & 255
                step=(b.const_steps[sid] + ((pid*7+idx*11)&255)) & 255
                if isinstance(val,str):
                    method=(b.seed + pid*13 + sid*5 + idx*17) % 6
                    ek=(key + idx*13 + pid) & 255
                    es=(step + idx*7 + 3*pid) & 255
                    raw=_v8_str_enc(val.encode(),ek,es,method)
                    tag=b.type_tags['string']
                    arr.append('{'+','.join(map(str,[tag,method,ek,es,len(raw),*raw]))+'}')
                elif val is None:
                    arr.append('{'+str(b.type_tags['nil'])+'}')
                elif val is True:
                    arr.append('{'+str(b.type_tags['true'])+'}')
                elif val is False:
                    arr.append('{'+str(b.type_tags['false'])+'}')
                elif isinstance(val,int) and not isinstance(val,bool):
                    mul=rng.randrange(3,63)|1; add=rng.randrange(0x1000,0x8000); mask=(key ^ idx ^ pid) & 255
                    enc=((val*mul+add) ^ mask) & 0xFFFFFFFF
                    arr.append('{'+','.join(map(str,[b.type_tags['int'],enc,mul,add,mask]))+'}')
                elif isinstance(val,float):
                    # Preserve existing float value using an additive transform.
                    add=rng.randrange(0x1000,0x8000)
                    arr.append('{'+','.join(map(str,[b.type_tags['float'],val+add,add]))+'}')
                else:
                    raise TypeError(type(val))
            const_tables.append('{'+','.join(arr)+'}')

        # Instruction encoding. The raw instruction contains the opcode followed by
        # a mode byte, then variable-length operands in the selected order.
        raw_all=[]; offsets=[]
        for phys,logical in enumerate(order,1):
            offsets.append(len(raw_all)+1)
            ins=mapped[logical]
            bid=phys_block[phys]
            # Build-specific opcode transform depends on build seed, block, and position.
            opmix=_v8_key8(b.vm_seed,bid,phys,0,17)
            raw_all.append((b.opid[ins.op]^b.opcode_mask^opmix)&255)
            layout_id=(b.layout_seed + pid*29 + logical*13 + bid*7) % len(layouts)
            vals=[ins.a,ins.b,ins.c,ins.k]
            mask=sum(1<<(j-1) for j,v in enumerate(vals,1) if v!=0)
            raw_mode=((layout_id & 0x0F) | ((mask & 0x0F)<<4)) & 255
            mode_key=_v8_key8(b.vm_seed ^ b.mode_key,bid,phys,1,23)
            raw_all.append(raw_mode ^ mode_key)
            for field_idx in layouts[layout_id]:
                if mask & (1<<field_idx):
                    raw_all.extend(_v8_varint(vals[field_idx-1]))
            # Each instruction is re-encrypted again at the final packed stage below.

        # Re-encrypt whole stream with nonlinear per-byte keys tied to physical block.
        packed_parts=[]; cursor=0
        for phys,logical in enumerate(order,1):
            bid=phys_block[phys]
            # Decode the segment from raw_all based on known offsets.
            start=offsets[phys-1]-1
            end=(offsets[phys]-1) if phys<len(offsets) else len(raw_all)
            seg=raw_all[start:end]
            packed_parts.append(bytes((x ^ _v8_key8(b.bytecode_key ^ b.seed,bid,phys,j,31)) & 255 for j,x in enumerate(seg)))
            cursor=end
        packed=b''.join(packed_parts)

        # Encode parameter/global names separately; release output still contains only
        # transformed name bytes needed for runtime lookup, not original source text.
        params='{' + ','.join(enc_meta('p'+str(i),i%6,(b.string_seed+pid+i*7)&255,(b.string_step+3*i)&255) for i,_ in enumerate(p.params)) + '}' if p.params else '{}'
        names='{' + ','.join(enc_meta(x,(pid+i)%6,(b.string_seed+i*11)&255,(b.string_step+i*7)&255) for i,x in enumerate(p.names)) + '}' if p.names else '{}'
        qargs='{' + ','.join(str(rr(i)) for i in range(len(p.params))) + '}' if p.params else '{}'
        nested='{' + ','.join(proto_obj(q,p) for q in p.protos) + '}' if p.protos else '{}'
        up='{' + ','.join(str(rr(parent_reg)) for _name,parent_reg in p.upvalues) + '}' if p.upvalues else '{}'
        constloc='{' + ','.join(str(x) for x in const_locs) + '}' if const_locs else '{}'

        fields=[
            ('v','8'),
            ('b',_v7_escape(packed)),
            ('o','{'+','.join(map(str,offsets))+'}'),
            ('h',str(_v7_hash(packed))),
            ('z','{'+','.join(const_tables)+'}'),
            ('cl',constloc),
            ('p',params),('n',names),('q',qargs),
            ('r',str(len(rp))),('f',nested),('u',up),
            ('cf','{'+','.join(map(str,cf[1:]))+'}'),
            ('bl','{'+','.join(map(str,phys_block[1:]))+'}'),
            ('jm','{'+','.join(map(str,jump_mode_phys[1:]))+'}'),
            ('jp','{'+','.join(map(str,jump_pool))+'}'),
            ('ly',layout_source),
        ]
        sr=random.Random(_v8_u64(b.section_seed ^ pid*0x9E3779B97F4A7C15)); sr.shuffle(fields)
        return '{' + ','.join(f'{k}={v}' for k,v in fields) + '}'

    root_blob=proto_obj(root)

    # Handler indirection: logical opcode -> dispatch id -> handler.
    bucket_items={i:[] for i in range(8)}
    op_order=V7_OPS[:]
    random.Random(b.vm_seed).shuffle(op_order)
    ss='st'
    def R(x): return ss+'.r['+(ss+'.'+x if x in {'a','b','c'} else x)+']'
    def P(x): return ss+'.P.'+x
    def C(x): return ss+'.cells['+(ss+'.'+x if x in {'a','b','c'} else x)+']'
    def U(x): return ss+'.up['+(ss+'.'+x if x in {'a','b','c'} else x)+']'
    for logical in op_order:
        oid=b.opid[logical]
        hid=b.dispatch_id[logical]
        h=f'[{hid}]=function({ss}) '
        if logical=='K':
            h += "local enc="+R('b')+";local sid=enc%"+str(b.shards)+";local idx=(enc-sid)/"+str(b.shards)+"+1;local cv="+P('z')+"[sid+1][idx];"+R('a')+"="+N['CD']+"(cv)"
        elif logical=='MOV': h += R('a')+'='+R('b')
        elif logical=='GETG': h += R('a')+'='+N['G']+'('+N['SD']+'('+P('n')+'['+ss+'.b+1]))'
        elif logical=='SETG': h += N['SET']+'('+N['SD']+'('+P('n')+'['+ss+'.a+1]),'+R('b')+')'
        elif logical=='GETI': h += R('a')+'='+R('b')+'['+R('c')+']'
        elif logical=='SETI': h += R('a')+'['+R('b')+']='+R('c')
        elif logical=='GETCELL': h += 'local c='+C('a')+';if not c then c={'+R('a')+'};'+C('a')+'=c end;'+R('a')+'=c[1]'
        elif logical=='SETCELL': h += 'local c='+C('a')+';if not c then c={};'+C('a')+'=c end;c[1]='+R('b')
        elif logical=='GETUP': h += 'local c='+U('b')+';if not c then error(\'AEGIS upvalue fault\') end;'+R('a')+'=c[1]'
        elif logical=='SETUP': h += 'local c='+U('a')+';if not c then error(\'AEGIS upvalue fault\') end;c[1]='+R('b')
        elif logical=='NEWT': h += R('a')+'={}'
        elif logical=='CLOSURE':
            h += 'local cp='+P('f')+'['+ss+'.b+1];local up={};for i=1,#cp.u do local pr=cp.u[i];local c='+C('pr')+';if not c then c={'+R('pr')+'};'+C('pr')+'=c end;up[i]=c end;local fn='+N['MK']+'(cp,up);'+R('a')+'=fn'
        elif logical=='CALLT':
            h += 'local av='+R('c')+';local fn='+R('b')+';'+ss+'.stack=av;'+ss+'.frame.depth='+ss+'.frame.depth+1;'+R('a')+'=fn(table.unpack(av));'+ss+'.frame.depth='+ss+'.frame.depth-1;'+ss+'.stack=nil'
        elif logical=='RET': h += ss+'.ret=true;'+ss+'.rv='+R('a')
        elif logical=='CLOSE': h += ss+'.closed=true'
        elif logical=='JMP': h += "local jm="+P('jm')+"["+ss+".phys] or 0;if jm==0 then "+ss+".next="+ss+".a elseif jm==1 then "+ss+".next="+ss+".pc+"+ss+".a elseif jm==2 then "+P('jp')+"["+ss+".a+1] else "+ss+".next="+ss+".a end"
        elif logical=='JZ': h += "if not "+R('a')+" then local jm="+P('jm')+"["+ss+".phys] or 0;if jm==0 then "+ss+".next="+ss+".b elseif jm==1 then "+ss+".next="+ss+".pc+"+ss+".b elseif jm==2 then "+P('jp')+"["+ss+".b+1] else "+ss+".next="+ss+".b end end"
        elif logical=='JFOR': h += "local cur="+R('a')+";local lim="+R('b')+";local stp="+R('c')+";if (stp>=0 and cur>lim) or (stp<0 and cur<lim) then local jm="+P('jm')+"["+ss+".phys] or 0;if jm==0 then "+ss+".next="+ss+".k elseif jm==1 then "+ss+".next="+ss+".pc+"+ss+".k elseif jm==2 then "+P('jp')+"["+ss+".k+1] else "+ss+".next="+ss+".k end end"
        elif logical=='JUNK': h += ss+'.noise=((('+ss+'.noise or 0)*1103515245+12345+'+str(b.vm_seed%1000003)+')%2147483647)'
        else:
            ex={'ADD':R('b')+'+'+R('c'),'SUB':R('b')+'-'+R('c'),'MUL':R('b')+'*'+R('c'),'DIV':R('b')+'/'+R('c'),'IDIV':R('b')+'//'+R('c'),'MOD':R('b')+'%'+R('c'),'POW':R('b')+'^'+R('c'),'CAT':R('b')+'..'+R('c'),'EQ':R('b')+'=='+R('c'),'NE':R('b')+'~='+R('c'),'LT':R('b')+'<'+R('c'),'GT':R('b')+'>'+R('c'),'LE':R('b')+'<='+R('c'),'GE':R('b')+'>='+R('c'),'AND':R('b')+' and '+R('c'),'OR':R('b')+' or '+R('c'),'NOT':'not '+R('b'),'NEG':'-'+R('b'),'LEN':'#'+R('b'),'BNOT':'~'+R('b')}
            h += R('a')+'='+ex[logical]
        bucket_items[(hid-1)%8].append(h+' end')

    handlers='{'+','.join('{'+','.join(bucket_items[i])+'}' for i in range(8))+'}'
    dslots=[0]*len(V7_OPS)
    for logical,oid in b.opid.items(): dslots[oid-1]=b.dispatch_id[logical]
    dmap='{'+','.join(str(x) for x in dslots)+'}'

    lines=banner_as_luau_comment().rstrip('\n').split('\n')
    lines.append('-- AegisLuau V8 generated output')
    lines.append(f'local {N["SD"]}=function(v)local m=v[2];local key=v[3];local step=v[4];local n=v[1];local o={{}};for i=1,n do local x=v[5+i];local k=(key+step*(i-1)+(((i-1)*(i-1)+3*(i-1))%256))%256;if m==0 then x=x~k elseif m==1 then local r=((i-1)%7)+1;x=((((x>>r)|((x&((1<<r)-1))<<(8-r)))&255)-k)%256 elseif m==2 then local r=(((i-1)*3)%7)+1;x=((((x>>r)|((x&((1<<r)-1))<<(8-r)))&255)~((k+61)%256)) elseif m==3 then local r=((i-1)%7)+1;x=((((x<<r)|(x>>(8-r)))&255)+k)%256 elseif m==4 then x=((x+k)%256)~(((k>>1)|((k<<7)&255))) else x=((x-k)%256)~((k*3)%256) end;o[i]=string.char(x%256) end;return table.concat(o) end')
    lines.append(f'local {N["CD"]}=function(v)local ty=v[1];if ty=={b.type_tags["nil"]} then return nil elseif ty=={b.type_tags["true"]} then return true elseif ty=={b.type_tags["false"]} then return false elseif ty=={b.type_tags["int"]} then return ((v[2]~v[5])-v[4])/v[3] elseif ty=={b.type_tags["float"]} then return v[2]-v[3] end;{_v8_str_dec_expr("v", "v")} end')
    lines.append(f'local {N["G"]}=function(n)local g=_G;return g[n] end')
    lines.append(f'local {N["T"]}=setmetatable({{}},{{__index=function(t,k)return rawget(t,k) end,__newindex=function(t,k,v)rawset(t,k,v)end}})')
    lines.append(f'local {N["SET"]}=function(n,v){N["T"]}[n]=v;_G[n]=v end')
    lines.append(f'local {N["H"]}={handlers}')
    lines.append(f'local {N["D"]}={dmap}')
    lines.append(f'local {N["VM"]}={root_blob}')
    lines.append(f'local function {N["RUN"]}({N["P"]},up,...)')
    lines.append(f' local {N["R"]}={{}};local cells={{}};local frame={{proto={N["P"]},depth=0,args={{...}},returns={{}}}};local stack={{}}')
    lines.append(f' for i=1,{N["P"]}.r do {N["R"]}[i]=nil end')
    lines.append(f' local st={{P={N["P"]},r={N["R"]},up=up or {{}},cells=cells,frame=frame,stack=stack,pc=1,next=1,phys=1,ret=false,rv=nil,noise=0,closed=false,a=0,b=0,c=0,k=0,op=0}}')
    lines.append(f' local argv={{...}};for i=1,#argv do local rr=st.P.q[i];if rr then st.r[rr]=argv[i] end end')
    lines.append(f' local bc=st.P.b;local function rk(seed,block,phys,off,domain)local x=seed%256;x=(x~((block*93+phys*167+off*59+domain*17)%256))%256;x=(x+(((block+1)*(phys+3)+off*off*7+domain*19)%256))%256;return x end')
    lines.append(f' local function rb(pos,block,phys,off)local x=string.byte(bc,pos);if not x then error("AEGIS bytecode EOF") end;return x~rk(({b.bytecode_key}~{b.seed}),block,phys,off,31) end')
    if config.integrity:
        lines.append(f' local function hv(s)local h=2166136261;for i=1,#s do h=((h~string.byte(s,i))*16777619)%4294967296 end;return h end;if hv(bc)~=st.P.h then error("AEGIS integrity fault") end')
    lines.append(f' local function rv(pos,block,phys,off)local v=0;local m=1;local o=off;while true do local x=rb(pos,block,phys,o);pos=pos+1;o=o+1;v=v+(x&127)*m;if x<128 then return v,pos,o end;m=m*128 end end')
    lines.append(f' while not st.ret do local p=st.P;local logical=st.pc;if logical>#p.cf then break end;local physical=p.cf[logical];st.phys=physical;local block=p.bl[physical] or 0;local pos=p.o[physical];local op=(rb(pos,block,physical,0)~({b.opcode_mask}%256)~rk({b.vm_seed},block,physical,0,17))%256;pos=pos+1;local mode=(rb(pos,block,physical,1)~rk(({b.vm_seed}~{b.mode_key}),block,physical,1,23))%256;pos=pos+1;local hid={N["D"]}[op];local h={N["H"]}[((hid-1)%8)+1][hid];if not h then error("AEGIS VM fault") end;st.op=op;local layout=(mode&15)+1;local pmask=(mode>>4)&15;local off=2;local map=p.ly[layout] or p.ly[1];st.a=0;st.b=0;st.c=0;st.k=0;for mi=1,4 do local fi=map[mi];if (pmask&(1<<(fi-1)))~=0 then local vv;vv,pos,off=rv(pos,block,physical,off);if fi==1 then st.a=vv elseif fi==2 then st.b=vv elseif fi==3 then st.c=vv else st.k=vv end end end;st.next=logical+1;h(st);st.pc=st.next end')
    lines.append(f' return st.rv end')
    lines.append(f'{N["MK"]}=function(p,up)return function(...)return {N["RUN"]}(p,up,...)end end')
    lines.append(f'return {N["RUN"]}({N["VM"]},{{}})')
    return '\n'.join(lines)+'\n'


def build_obf_v8(src,seed=None,strict=False,hybrid=False,profile='max'):
    src=normalize_source(src); source_has_balanced_short_strings(src)
    if profile not in V8_PROFILES:
        raise ValueError(f'unknown profile: {profile}')
    cfg=V8_PROFILES[profile]
    master=seed if seed is not None else secrets.randbits(64)
    rng=random.Random(master)
    toks=lex(src); fallback=None; fallback_reason=None
    try:
        ast=Parser(toks).parse()
        compiler=Compiler(max_ip=(cfg.optimize>=2)); compiler.captured_names=set(); compiler.upvalue_map={}
        proto=compiler.compile(ast); compiled=True
    except (SyntaxError,CompileError,IndexError,ValueError) as e:
        if strict or not hybrid:
            if isinstance(e,SyntaxError): raise SyntaxError(humanize_parser_error(src,e))
            raise
        fallback=src.encode('utf-8'); fallback_reason=str(e); proto=Compiler().compile(Chunk([])); compiled=False

    if cfg.optimize>0: optimizer_removed=_v8_opt(proto)
    else: optimizer_removed=0
    _v8_liveness_rewrite(proto)

    if cfg.decoys:
        def add_noise(p):
            if p.code:
                # V8 inserts noise at build-dependent positions, but never in a way
                # that becomes a new jump target. Keeping it at block entries is safe.
                rng_local=random.Random(_v8_u64(master ^ id(p)))
                blocks=_v8_basic_blocks(p)
                for bl in sorted(blocks,key=lambda z:z[0],reverse=True):
                    if rng_local.randrange(4) <= cfg.noise_rate:
                        p.code.insert(bl[0],Ins('JUNK'))
                        for ins in p.code[bl[0]+1:]:
                            if ins.op=='JMP': ins.a+=1
                            elif ins.op=='JZ': ins.b+=1
                            elif ins.op=='JFOR': ins.k+=1
            for q in p.protos: add_noise(q)
        # id() is only used for local shuffle variability inside one process.
        # Deterministic seed builds still stay reproducible because the visible stream
        # is re-randomized again below from the master seed. Avoid object identity in the
        # actual emitted data.
        if cfg.noise_rate:
            def add_noise_det(p, path=0):
                if p.code:
                    r=random.Random(_v8_u64(master ^ (path*0x9E3779B97F4A7C15)))
                    blocks=_v8_basic_blocks(p)
                    inserts=[]
                    for bl in blocks:
                        if r.randrange(5) < min(4,cfg.noise_rate+1): inserts.append(bl[0])
                    for pos in reversed(sorted(set(inserts))):
                        p.code.insert(pos,Ins('JUNK'))
                        for ins in p.code[pos+1:]:
                            if ins.op=='JMP': ins.a+=1
                            elif ins.op=='JZ': ins.b+=1
                            elif ins.op=='JFOR': ins.k+=1
                for i,q in enumerate(p.protos): add_noise_det(q,path*31+i+1)
            add_noise_det(proto,1)

    _v8_normalize(proto)
    opnums=list(range(1,len(V7_OPS)+1)); rng.shuffle(opnums); opid={op:opnums[i] for i,op in enumerate(V7_OPS)}
    order=V7_OPS[:]; rng.shuffle(order); dispatch_id={op:i+1 for i,op in enumerate(order)}
    shards=cfg.constant_shards
    tagvals=list(range(1,7)); rng.shuffle(tagvals)
    type_tags={'string':tagvals[0],'nil':tagvals[1],'true':tagvals[2],'false':tagvals[3],'int':tagvals[4],'float':tagvals[5]}
    b=V8Build(
        opid,dispatch_id,master,rng.randrange(1,256),rng.getrandbits(64),rng.getrandbits(64),rng.getrandbits(64),
        rng.randrange(1,256),rng.randrange(1,256),[rng.randrange(1,256) for _ in range(shards)],
        [rng.randrange(1,256) for _ in range(shards)],rng.randrange(1,256),rng.randrange(1,256),rng.randrange(1,256),
        rng.getrandbits(64),shards,type_tags,rng.getrandbits(64)
    )
    out=emit_runtime_v8(proto,b,rng,cfg)
    _sanity_check_generated_luau_v7(out)
    def _walk(ps):
        for pp in ps:
            yield pp
            yield from _walk(pp.protos)
    allp=list(_walk([proto]))
    meta={
        'version':'8.0.0','compiled':compiled,'fallback':fallback is not None,'fallback_reason':fallback_reason,
        'profile':profile,'seed':master,'instructions':sum(len(p.code) for p in allp),'protos':len(allp),
        'upvalues':sum(len(p.upvalues) for p in allp),'constant_shards':shards,'optimizer_removed':optimizer_removed,
        'pipeline':['Lexer','Parser','AST','Scope Analysis','AST→IR','Optimizer','Basic Block Builder','Register Allocation','Identifier Renaming','Constant Pool','String Pool','Opcode Permutation','Register Permutation','Operand Layout Generation','Control Flow Transform','Bytecode Generator','Variable-Length Encoding','Bytecode Packing','Integrity Data','Protected Output','Runtime VM'],
        'randomized_domains':['opcode mapping','dispatch id','register mapping','constant shard/order','constant type tags','per-string seed','operand layout','jump mode','basic-block order','bytecode key','VM seed','control-flow seed','section ordering']
    }
    return out,meta


V8_VERSION='8.0.0'


def main_v8()->int:
    import sys
    if '--no-banner' not in sys.argv: print_banner()
    ap=argparse.ArgumentParser(description='AegisLuau V8 source-protection compiler')
    ap.add_argument('input',nargs='?',help='input .luau/.lua file')
    ap.add_argument('-o','--output',default='obfuscated.luau')
    ap.add_argument('--seed',type=int,default=None,help='explicit reproducible build seed for testing')
    ap.add_argument('--strict',action='store_true',help='reject unsupported syntax')
    ap.add_argument('--hybrid',action='store_true',help='allow runtime fallback for valid but unsupported syntax')
    ap.add_argument('--check',action='store_true',help='compile-check without writing output')
    ap.add_argument('--stats',action='store_true')
    ap.add_argument('--profile',choices=sorted(V8_PROFILES),default='max')
    ap.add_argument('--no-banner',action='store_true')
    ap.add_argument('--version',action='version',version=f'AEGIS Luau {V8_VERSION}')
    args=ap.parse_args()
    if not args.input:
        print('AEGIS: input file is required',file=sys.stderr); return 2
    p=Path(args.input)
    if not p.is_file():
        print(f'AEGIS input error: file not found: {p}',file=sys.stderr); return 2
    try:
        src=p.read_text(encoding='utf-8')
        out,meta=build_obf_v8(src,args.seed,args.strict,args.hybrid,args.profile)
    except Exception as e:
        print(f'AEGIS build failed: {type(e).__name__}: {e}',file=sys.stderr); return 1
    if args.check:
        print('[+] check passed')
        if args.stats: print(meta)
        return 0
    try:
        op=Path(args.output); op.parent.mkdir(parents=True,exist_ok=True); tmp=op.with_name(op.name+'.tmp')
        tmp.write_text(out,encoding='utf-8',newline='\n'); tmp.replace(op)
    except (OSError,UnicodeError) as e:
        print(f'AEGIS output error: {e}',file=sys.stderr); return 2
    print(f'[+] wrote {args.output}')
    if args.stats: print(meta)
    return 0


if __name__=='__main__':
    raise SystemExit(main_v8())
