#!/usr/bin/env python3
"""
Luau multi-layer obfuscator.

Features:
  1. local/global identifier renaming (lexical scope approximation)
  2. function-name renaming
  3. string literal encoding + runtime reconstruction
  4. numeric literal arithmetic hiding
  5. flat table literal splitting into runtime table builder
  6. wrapper-level control-flow dispatch / opaque predicates
  7. junk code injection
  8. payload chunk splitting
  9. constant hiding
 10. runtime payload reconstruction / decoding
 11. VM-style loader for encoded operations
 12. instruction replacement in emitted helper expressions
 13. metatable-backed runtime lookup
 14. dynamic code generation through loadstring/load
 15. layered combination of the above

Notes:
- This is a source-to-source obfuscator, not a full Luau compiler.
- Identifier renaming is intentionally conservative and lexical.
- Table reconstruction targets simple flat array tables only.
- The generated output uses loadstring/load, so the target runtime must permit dynamic code loading.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import math
import random
import re
import secrets
import string
from dataclasses import dataclass
from typing import List, Optional, Tuple

KEYWORDS = {
    "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
    "if", "in", "local", "nil", "not", "or", "repeat", "return", "then", "true",
    "until", "while", "continue", "type", "export", "typeof", "self",
}

# Names that are especially likely to be API/property names rather than user locals.
# They are left untouched when they appear after '.' or ':'.
IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")

@dataclass
class Tok:
    kind: str
    text: str


def lex(src: str) -> List[Tok]:
    out: List[Tok] = []
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c.isspace():
            j = i + 1
            while j < n and src[j].isspace():
                j += 1
            out.append(Tok("ws", src[i:j]))
            i = j
            continue

        # Line and block comments.
        if src.startswith("--", i):
            if src.startswith("--[[", i):
                j = src.find("]]", i + 4)
                j = n if j == -1 else j + 2
            else:
                j = src.find("\n", i + 2)
                j = n if j == -1 else j
            out.append(Tok("comment", src[i:j]))
            i = j
            continue

        # Short strings.
        if c in ('"', "'"):
            quote = c
            j = i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                elif src[j] == quote:
                    j += 1
                    break
                else:
                    j += 1
            out.append(Tok("string", src[i:j]))
            i = j
            continue

        # Numeric literal, including scientific notation and hex-ish forms.
        m = re.match(r"(?:0[xX][0-9A-Fa-f]+(?:\.[0-9A-Fa-f]*)?|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)", src[i:])
        if m:
            s = m.group(0)
            out.append(Tok("number", s))
            i += len(s)
            continue

        m = IDENT_RE.match(src, i)
        if m:
            s = m.group(0)
            out.append(Tok("ident", s))
            i = m.end()
            continue

        # Operators/punctuation, longest first.
        matched = False
        for op in ("...", "::", "==", "~=", "<=", ">=", "//", "<<", ">>", "..", "+=", "-=", "*=", "/=", "%=", "^=", "&=", "|="):
            if src.startswith(op, i):
                out.append(Tok("sym", op))
                i += len(op)
                matched = True
                break
        if matched:
            continue
        out.append(Tok("sym", c))
        i += 1
    return out


def unescape_lua(s: str) -> str:
    # Minimal but useful Lua escape support.
    body = s[1:-1]
    def repl(m: re.Match[str]) -> str:
        x = m.group(1)
        mapping = {
            "a": "\a", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v",
            "\\": "\\", "\"": '"', "'": "'",
        }
        if x in mapping:
            return mapping[x]
        if re.fullmatch(r"\d{1,3}", x):
            try:
                return chr(int(x, 10))
            except ValueError:
                return x
        if x == "z":
            return ""
        return x
    return re.sub(r"\\(\d{1,3}|.)", repl, body)


def lua_quote_runtime(s: str) -> str:
    # Encode bytes so the source never contains the original literal.
    raw = s.encode("utf-8")
    nums = ",".join(str(b) for b in raw)
    return f"__STR({{{nums}}})"


def num_expr(text: str, rng: random.Random) -> str:
    try:
        if text.lower().startswith("0x"):
            value = int(text, 16)
        elif any(ch in text for ch in ".eE"):
            value = float(text)
        else:
            value = int(text)
    except Exception:
        return text
    k = rng.randint(3, 97)
    if isinstance(value, int):
        # A few semantically equivalent forms, including instruction replacement.
        mode = rng.randrange(4)
        if mode == 0:
            return f"(({value + k}) - {k})"
        if mode == 1:
            return f"(({value} * {k}) / {k})"
        if mode == 2:
            return f"(({value} ^ 1) + 0)"
        return f"(__N({value + k},{k}))"
    # Float arithmetic is kept simple to avoid surprising precision changes.
    return f"(({value!r} * 1.0) + 0.0)"


def rand_name(rng: random.Random, used: set[str]) -> str:
    prefixes = ["a", "b", "c", "x", "q", "v", "_0x", "lx", "tmp"]
    while True:
        p = rng.choice(prefixes)
        if p == "_0x":
            name = p + f"{rng.randrange(0x100000):x}"
        else:
            name = p + ("" if rng.random() < 0.4 else str(rng.randrange(1000)))
        if name not in used and name not in KEYWORDS:
            used.add(name)
            return name


def significant(tokens: List[Tok], idx: int, step: int = 1) -> Optional[int]:
    i = idx + step
    while 0 <= i < len(tokens) and tokens[i].kind in {"ws", "comment"}:
        i += step
    return i if 0 <= i < len(tokens) else None


def prev_sig(tokens: List[Tok], idx: int) -> Optional[int]:
    i = idx - 1
    while i >= 0 and tokens[i].kind in {"ws", "comment"}:
        i -= 1
    return i if i >= 0 else None


def next_sig(tokens: List[Tok], idx: int) -> Optional[int]:
    i = idx + 1
    while i < len(tokens) and tokens[i].kind in {"ws", "comment"}:
        i += 1
    return i if i < len(tokens) else None


def rename_identifiers(tokens: List[Tok], rng: random.Random) -> None:
    """Conservative lexical renaming.

    We collect declarations from local declarations, function declarations, and function params,
    then rename uses until a coarse block boundary. This is deliberately not a complete scope solver.
    """
    used = {t.text for t in tokens if t.kind == "ident"}
    mapping: dict[str, str] = {}
    decl_positions: set[int] = set()

    # Global function declarations are mapped consistently.
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t.kind == "ident" and t.text == "function":
            j = next_sig(tokens, i)
            if j is not None and tokens[j].kind == "ident":
                old = tokens[j].text
                if old not in KEYWORDS:
                    mapping.setdefault(old, rand_name(rng, used))
                    decl_positions.add(j)
            # params
            k = next_sig(tokens, j if j is not None else i)
            while k is not None and tokens[k].text != "(":
                k = next_sig(tokens, k)
            if k is not None:
                k = next_sig(tokens, k)
                while k is not None and tokens[k].text != ")":
                    if tokens[k].kind == "ident" and tokens[k].text not in KEYWORDS:
                        mapping.setdefault(tokens[k].text, rand_name(rng, used))
                        decl_positions.add(k)
                    k = next_sig(tokens, k)
            i += 1
            continue
        i += 1

    # locals and local function names.
    i = 0
    while i < len(tokens):
        if tokens[i].kind == "ident" and tokens[i].text == "local":
            j = next_sig(tokens, i)
            if j is not None and tokens[j].kind == "ident" and tokens[j].text == "function":
                k = next_sig(tokens, j)
                if k is not None and tokens[k].kind == "ident":
                    mapping.setdefault(tokens[k].text, rand_name(rng, used))
                    decl_positions.add(k)
            else:
                while j is not None:
                    if tokens[j].text in {"=", ";"}:
                        break
                    if tokens[j].kind == "ident" and tokens[j].text not in KEYWORDS:
                        mapping.setdefault(tokens[j].text, rand_name(rng, used))
                        decl_positions.add(j)
                    j = next_sig(tokens, j)
        i += 1

    # Replace. Skip properties and labels and any unknown globals.
    for i, t in enumerate(tokens):
        if t.kind != "ident" or i in decl_positions:
            continue
        if t.text not in mapping:
            continue
        p = prev_sig(tokens, i)
        if p is not None and tokens[p].text in {".", ":"}:
            continue
        t.text = mapping[t.text]

    for i in decl_positions:
        if tokens[i].text in mapping:
            tokens[i].text = mapping[tokens[i].text]


def hide_constants(tokens: List[Tok], rng: random.Random) -> None:
    for t in tokens:
        if t.kind == "string":
            try:
                t.text = lua_quote_runtime(unescape_lua(t.text))
                t.kind = "raw"
            except Exception:
                pass
        elif t.kind == "number":
            t.text = num_expr(t.text, rng)
            t.kind = "raw"


def split_flat_array_tables(tokens: List[Tok], rng: random.Random) -> List[Tok]:
    """Wrap simple flat array tables in __T({...}, {...}) while preserving expressions."""
    out: List[Tok] = []
    i = 0
    while i < len(tokens):
        if tokens[i].text != "{":
            out.append(tokens[i]); i += 1; continue
        # Find matching closing brace and assess whether the body is flat/simple.
        depth = 0
        j = i
        while j < len(tokens):
            if tokens[j].text == "{": depth += 1
            elif tokens[j].text == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        if j >= len(tokens):
            out.append(tokens[i]); i += 1; continue
        inner = tokens[i+1:j]
        bad_nested = any(t.text in {"{", "}"} for t in inner)
        has_keyed = any(t.text == "=" for t in inner)
        if bad_nested or has_keyed:
            out.extend(tokens[i:j+1]); i = j + 1; continue

        # Split at top-level commas into groups, then runtime concatenate the groups.
        parts: List[List[Tok]] = []
        cur: List[Tok] = []
        local_depth = 0
        for t in inner:
            if t.text in {"(", "["}: local_depth += 1
            elif t.text in {")", "]"}: local_depth = max(0, local_depth - 1)
            if t.text == "," and local_depth == 0:
                if any(x.kind not in {"ws", "comment"} for x in cur):
                    parts.append(cur); cur = []
                continue
            cur.append(t)
        if any(x.kind not in {"ws", "comment"} for x in cur):
            parts.append(cur)
        if len(parts) < 2:
            out.extend(tokens[i:j+1]); i = j + 1; continue

        # Alternate fragment order and let __T stitch them back.
        rng.shuffle(parts)
        out.append(Tok("raw", "__T({"))
        for pi, part in enumerate(parts):
            out.extend(part)
            if pi != len(parts) - 1:
                out.append(Tok("raw", ","))
        out.append(Tok("raw", "})"))
        i = j + 1
    return out


def compact(tokens: List[Tok]) -> str:
    return "".join(t.text for t in tokens)


def junk(rng: random.Random, prefix: str) -> str:
    a = rand_name(rng, set())
    b = rand_name(rng, {a})
    c = rand_name(rng, {a, b})
    return (
        f"local {prefix}{a} = (({rng.randint(10,99)} + {rng.randint(1,9)}) - {rng.randint(1,9)});"
        f"local {prefix}{b} = ({prefix}{a} * 0) + {rng.randint(0,1)};"
        f"if {prefix}{b} == -1 then {prefix}{c} = nil end;"
    )


def make_runtime(payload_b64: str, chunk_size: int, rng: random.Random, use_vm: bool = True) -> str:
    # Randomize helper names to avoid easy signatures.
    used: set[str] = set()
    P = rand_name(rng, used)
    D = rand_name(rng, used)
    J = rand_name(rng, used)
    N = rand_name(rng, used)
    T = rand_name(rng, used)
    L = rand_name(rng, used)
    E = rand_name(rng, used)
    M = rand_name(rng, used)
    V = rand_name(rng, used)

    chunks = [payload_b64[i:i+chunk_size] for i in range(0, len(payload_b64), chunk_size)]
    # Encode the chunk list as numeric byte arrays, so the visible output never exposes payload b64 directly.
    chunk_arrays = []
    for ch in chunks:
        arr = ",".join(str(ord(c)) for c in ch)
        chunk_arrays.append("{" + arr + "}")

    seed1 = rng.randrange(17, 251)
    seed2 = rng.randrange(17, 251)
    lines = []
    lines.append("-- generated by luau-obf")
    lines.append(f"local {P} = {{}}")
    lines.append(f"local {M} = setmetatable({{}}, {{ __index = function(_, k) return {P}[k] end, __newindex = function(_, k, v) {P}[k] = v end }})")
    lines.append(f"local {N} = function(x, k) return (x - k) end")
    lines.append(f"local {E} = function(t) local s = ''; for i=1,#t do s = s .. string.char(t[i]) end return s end")
    lines.append(f"local {T} = function(...) local o={{}}; local z={{...}}; local n=1; for i=1,#z do local q=z[i]; for j=1,#q do o[n]=q[j]; n=n+1 end end return o end")
    lines.append(f"local {D} = function(b)"
                 f" local x='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';"
                 f" local rev={{}}; for i=1,#x do rev[x:sub(i,i)]=i-1 end;"
                
                 f" local out={{}}; local n=0; local acc=0;"
                 f" for c in b:gmatch('.') do local v=rev[c]; if v then acc=acc*64+v; n=n+6; if n>=8 then n=n-8; out[#out+1]=string.char(math.floor(acc/(2^n))%256) end end end;"
                 f" return table.concat(out) end")
    lines.append(f"local {L} = loadstring or load")
    lines.append(f"local {J} = {M}")
    lines.append(f"local {V} = function(s) local f,err={L}(s); if not f then error(err) end; return f() end")
    lines.append(f"{P}.x = {seed1}")
    lines.append(f"{M}.y = {seed2}")

    # VM-style bytecode. op 1 = push chunk array, op 2 = decode, op 3 = run.
    if use_vm:
        lines.append(f"{P}.bc={{}}")
        for arr in chunk_arrays:
            lines.append(f"{P}.bc[#{P}.bc+1]={{1,{arr}}}")
            lines.append(f"{P}.bc[#{P}.bc+1]={{2}}")
        lines.append(f"{P}.bc[#{P}.bc+1]={{3}}")
        lines.append(f"{P}.st={{pc=1,buf={{}},raw=nil}}")
        lines.append(f"while true do")
        lines.append(f"  local ins={P}.bc[{P}.st.pc]; if not ins then break end")
        lines.append(f"  if ins[1]==1 then {P}.st.buf[#{P}.st.buf+1]={E}(ins[2])")
        lines.append(f"  elseif ins[1]==2 then {P}.st.raw=({D}(table.concat({P}.st.buf))); {P}.st.buf={{}}")
        lines.append(f"  elseif ins[1]==3 then {V}({P}.st.raw); break end")
        lines.append(f"  {P}.st.pc={P}.st.pc+1")
        lines.append(f"end")
    else:
        lines.append(f"{P}.c={{}}")
        for arr in chunk_arrays:
            lines.append(f"{P}.c[#{P}.c+1]={E}({arr})")
        lines.append(f"{P}.raw={D}(table.concat({P}.c))")
        lines.append(f"{V}({P}.raw)")

    return "\n".join(lines)


def opaque_wrap(code: str, rng: random.Random) -> str:
    used: set[str] = set()
    F = rand_name(rng, used)
    S = rand_name(rng, used)
    G = rand_name(rng, used)
    R = rand_name(rng, used)
    return (
        f"local function {F}()\n{code}\nend\n"
        f"local {S} = 0\n"
        f"local {G} = function() {S} = {S} + 1; return {S} end\n"
        f"local {R} = {{[1]=true,[2]=false}}\n"
        f"while true do\n"
        f"  local __k = {G}()\n"
        f"  if __k == 1 then {F}(); break elseif {R}[2] then break else {S} = {S} + 0 end\n"
        f"end"
    )


def obfuscate(src: str, seed: Optional[int] = None, chunk_size: int = 96, use_vm: bool = True) -> str:
    rng = random.Random(seed if seed is not None else secrets.randbits(64))
    tokens = lex(src)
    rename_identifiers(tokens, rng)
    hide_constants(tokens, rng)
    tokens = split_flat_array_tables(tokens, rng)
    transformed = compact(tokens)

    # Runtime support for source-level constant/table rewrites.
    transformed = (
        "local function __STR(t) local s=\"\"; for i=1,#t do s=s..string.char(t[i]) end; return s end\n"
        "local function __N(x,k) return x-k end\n"
        "local function __T(...) local o={}; local z={...}; local n=1; for i=1,#z do local q=z[i]; for j=1,#q do o[n]=q[j]; n=n+1 end end; return o end\n"
        + transformed
    )

    # Junk is injected around the payload before final base64 encoding. This is intentionally not inserted
    # into individual semantic blocks, so it cannot accidentally alter returns/breaks in arbitrary source.
    junk_prefix = rand_name(rng, set())
    transformed = junk(rng, junk_prefix) + "\n" + transformed
    transformed = "--[[layered]]\n" + transformed

    # Runtime decode of the payload uses base64. Add a second reversible XOR-ish layer over the bytes.
    raw = transformed.encode("utf-8")
    k = rng.randrange(17, 251)
    xored = bytes((b ^ k) for b in raw)
    payload_b64 = base64.b64encode(xored).decode("ascii")
    # make_runtime's decoder currently expects plain base64 -> bytes. Apply XOR in VM stage source by altering
    # the generated decoder afterwards.
    runtime = make_runtime(payload_b64, chunk_size, rng, use_vm=use_vm)
    # Inject XOR after base64 decode. Locate the decode helper's return line.
    marker = "return table.concat(out) end"
    xor_line = f"; for i=1,#out do out[i]=string.char(string.byte(out[i],1) ~ {k}) end; "
    runtime = runtime.replace(marker, xor_line + marker, 1)
    return opaque_wrap(runtime, rng)


def main() -> int:
    ap = argparse.ArgumentParser(description="Multi-layer Luau source obfuscator")
    ap.add_argument("input", help="input .lua/.luau file")
    ap.add_argument("-o", "--output", default="obfuscated.luau", help="output file")
    ap.add_argument("--seed", type=int, default=None, help="deterministic seed")
    ap.add_argument("--chunk-size", type=int, default=96)
    ap.add_argument("--no-vm", action="store_true", help="disable VM-style loader and use direct staged loader")
    args = ap.parse_args()
    with open(args.input, "r", encoding="utf-8") as f:
        src = f.read()
    out = obfuscate(src, seed=args.seed, chunk_size=max(16, args.chunk_size), use_vm=not args.no_vm)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"wrote {args.output}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
