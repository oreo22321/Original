// tkinter 互換版 (ForgeCode の Python に置く): ボタン・入力欄・キャンバスなどの画面 (GUI) を出力に表示する
// ・Python 側はウィジェットの木を持ち、作る・変える・並べる命令を画面 (js/app/tk-view.js) に送る
// ・クリック・入力・キー操作は画面から届き、command / bind / 変数 (StringVar など) に伝える
// ・pack / grid / place、after、mainloop / update、messagebox・simpledialog・filedialog・colorchooser、ttk、Canvas に対応
const CONSTANTS = String.raw`"""tkinter の定数"""
NO = FALSE = OFF = 0
YES = TRUE = ON = 1
N = "n"
S = "s"
W = "w"
E = "e"
NW = "nw"
SW = "sw"
NE = "ne"
SE = "se"
NS = "ns"
EW = "ew"
NSEW = "nsew"
CENTER = "center"
NONE = "none"
X = "x"
Y = "y"
BOTH = "both"
LEFT = "left"
TOP = "top"
RIGHT = "right"
BOTTOM = "bottom"
RAISED = "raised"
SUNKEN = "sunken"
FLAT = "flat"
RIDGE = "ridge"
GROOVE = "groove"
SOLID = "solid"
HORIZONTAL = "horizontal"
VERTICAL = "vertical"
NUMERIC = "numeric"
CHAR = "char"
WORD = "word"
BASELINE = "baseline"
INSIDE = "inside"
OUTSIDE = "outside"
SEL = "sel"
SEL_FIRST = "sel.first"
SEL_LAST = "sel.last"
END = "end"
INSERT = "insert"
CURRENT = "current"
ANCHOR = "anchor"
ALL = "all"
NORMAL = "normal"
DISABLED = "disabled"
ACTIVE = "active"
HIDDEN = "hidden"
CASCADE = "cascade"
CHECKBUTTON = "checkbutton"
COMMAND = "command"
RADIOBUTTON = "radiobutton"
SEPARATOR = "separator"
SINGLE = "single"
BROWSE = "browse"
MULTIPLE = "multiple"
EXTENDED = "extended"
DOTBOX = "dotbox"
UNDERLINE = "underline"
PIESLICE = "pieslice"
CHORD = "chord"
ARC = "arc"
FIRST = "first"
LAST = "last"
BUTT = "butt"
PROJECTING = "projecting"
ROUND = "round"
BEVEL = "bevel"
MITER = "miter"
MOVETO = "moveto"
SCROLL = "scroll"
UNITS = "units"
PAGES = "pages"
READABLE = 2
WRITABLE = 4
EXCEPTION = 8
`

const TK = String.raw`"""tkinter (ForgeCode 互換版)
ブラウザの中で動くように作り直した tkinter です。ウィンドウは出力の中に表示され、ボタン・入力欄・キャンバスが使えます。
"""
import sys as _sys
import json as _json
import time as _time
import heapq as _heapq
import re as _re
import traceback as _tb
import js as _js
import _forgecode as _fc
from tkinter.constants import *

TkVersion = 8.6
TclVersion = 8.6
READABLE = 2
wantobjects = 1
_default_root = None
_support_default_root = True


class TclError(Exception):
    pass


_S = {"ops": [], "ids": 0, "wins": {}, "widgets": {}, "timers": [], "tseq": 0, "focus": None, "vars": 0, "all": {}, "imgs": 0, "menus": {}, "noted": False}


def _emit(op):
    if not _S["ops"]:
        _fc.on_finish(_flush)
    _S["ops"].append(op)
    if len(_S["ops"]) > 1500:
        _flush()


def _flush(force=True):
    # 画面へ送るのは、画面の更新 (1 秒に 60 回) より多くしない (細かい after・update のループで画面があふれないように)
    if _S["ops"]:
        now = _time.monotonic()
        if not force and now - _S.get("lf", 0.0) < 0.016:
            return
        _S["lf"] = now
        s = _json.dumps(_S["ops"], separators=(",", ":"), default=str)
        _S["ops"].clear()
        _js.__fc_tk(s)


def _nid():
    _S["ids"] += 1
    return _S["ids"]


def _reset_all():
    global _default_root
    _S.update(ops=[], wins={}, widgets={}, timers=[], tseq=0, focus=None, all={}, menus={}, noted=False)
    for k in ("radio_default", "tids", "quit", "clip", "cbs"):
        _S.pop(k, None)
    _default_root = None


def _get_root():
    global _default_root
    if _default_root is None or _default_root._destroyed:
        _default_root = Tk()
    return _default_root


def NoDefaultRoot():
    global _support_default_root
    _support_default_root = False


# ============================================================
# 色・文字
# ============================================================
_SYSCOL = {"systembuttonface": "#f0f0f0", "systemwindow": "#ffffff", "systembuttontext": "#000000", "systemwindowtext": "#000000",
           "systemhighlight": "#0078d7", "systemhighlighttext": "#ffffff", "systemtransparent": "transparent", "systemwindowbackgroundcolor": "#ececec"}


def _color(c):
    if c is None or c == "":
        return None
    c = str(c).strip()
    if c.startswith("#"):
        h = c[1:]
        if len(h) == 12:
            return "#" + h[0:2] + h[4:6] + h[8:10]
        if len(h) == 9:
            return "#" + h[0:2] + h[3:5] + h[6:8]
        return c
    k = c.lower().replace(" ", "")
    if k in _SYSCOL:
        return _SYSCOL[k]
    m = _re.match(r"^gr[ae]y(\d{1,3})$", k)
    if m:
        v = int(round(int(m.group(1)) * 2.55))
        return "#%02x%02x%02x" % (v, v, v)
    m = _re.match(r"^([a-z]+?)(\d)$", k)
    if m:
        return m.group(1)
    return k


def _font(f):
    """("Arial", 12, "bold") / "Arial 12 bold" / Font → CSS の font"""
    if f is None or f == "":
        return None
    if hasattr(f, "_css"):
        return f._css()
    if isinstance(f, str):
        if f.startswith("{"):
            m = _re.match(r"^\{([^}]*)\}\s*(.*)$", f)
            parts = [m.group(1)] + m.group(2).split() if m else f.split()
        else:
            parts = f.split()
        if len(parts) == 1 and parts[0] in _named_fonts:
            return _named_fonts[parts[0]]._css()
    else:
        parts = list(f)
    fam = str(parts[0]) if parts else "TkDefaultFont"
    size = 10
    if len(parts) > 1:
        try:
            size = int(parts[1])
        except (TypeError, ValueError):
            size = 10
    styles = " ".join(str(p) for p in parts[2:]).lower()
    px = -size if size < 0 else max(1, round(size * 1.333))
    return "%s%s%dpx %s" % ("italic " if "italic" in styles else "", "bold " if "bold" in styles else "", px, _family(fam))


def _family(f):
    k = f.lower().replace(" ", "")
    m = {"tkdefaultfont": "system-ui", "tktextfont": "system-ui", "tkfixedfont": "ui-monospace, Menlo, monospace", "courier": '"Courier New", monospace',
         "couriernew": '"Courier New", monospace', "helvetica": "Helvetica, Arial", "arial": "Arial, Helvetica", "times": '"Times New Roman", serif',
         "timesnewroman": '"Times New Roman", serif', "consolas": "Consolas, monospace", "monospace": "ui-monospace, monospace", "comicsansms": '"Comic Sans MS", cursive'}
    return (m.get(k) or '"%s"' % f.replace('"', "")) + ', system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif'


_named_fonts = {}


# ============================================================
# 変数 (StringVar など)
# ============================================================
class Variable:
    _default = ""

    def __init__(self, master=None, value=None, name=None):
        _S["vars"] += 1
        self._name = name or "PY_VAR%d" % (_S["vars"] - 1)
        self._value = self._default if value is None else value
        self._traces = []
        self._widgets = []

    def __str__(self):
        return self._name

    def __repr__(self):
        return "<tkinter.%s object %s>" % (type(self).__name__, self._name)

    def __eq__(self, other):
        return isinstance(other, Variable) and type(self) is type(other) and self._name == other._name

    def __hash__(self):
        return hash(self._name)

    def set(self, value):
        self._value = value
        for w in list(self._widgets):
            w._var_changed(self)
        self._fire("write")

    initialize = set

    def _ui_set(self, value, src=None):
        self._value = value
        for w in list(self._widgets):
            if w is not src:
                w._var_changed(self)
        self._fire("write")

    def get(self):
        return self._value

    def _fire(self, mode):
        for modes, cb, _id in list(self._traces):
            if mode in modes or (mode == "write" and "w" in modes) or (mode == "read" and "r" in modes):
                try:
                    cb(self._name, "", mode)
                except Exception:
                    _report()

    def trace_add(self, mode, callback):
        modes = (mode,) if isinstance(mode, str) else tuple(mode)
        cid = "%s_trace%d" % (self._name, len(self._traces))
        self._traces.append((modes, callback, cid))
        return cid

    def trace_remove(self, mode, cbname):
        self._traces = [t for t in self._traces if t[2] != cbname]

    def trace_info(self):
        return [(t[0], t[2]) for t in self._traces]

    def trace(self, mode, callback):
        return self.trace_add({"w": "write", "r": "read", "u": "unset"}.get(mode, mode), callback)

    trace_variable = trace

    def trace_vdelete(self, mode, cbname):
        self.trace_remove(mode, cbname)

    def trace_vinfo(self):
        return self.trace_info()


class StringVar(Variable):
    _default = ""

    def get(self):
        v = self._value
        return v if isinstance(v, str) else str(v)


class IntVar(Variable):
    _default = 0

    def set(self, value):
        Variable.set(self, int(value) if isinstance(value, bool) else value)

    def get(self):
        v = self._value
        try:
            return int(v)
        except (TypeError, ValueError):
            try:
                return int(float(v))
            except (TypeError, ValueError):
                raise TclError('expected floating-point number but got "%s"' % v)


class DoubleVar(Variable):
    _default = 0.0

    def get(self):
        try:
            return float(self._value)
        except (TypeError, ValueError):
            raise TclError('expected floating-point number but got "%s"' % self._value)


class BooleanVar(Variable):
    _default = False

    def get(self):
        v = self._value
        if isinstance(v, str):
            if v.lower() in ("1", "true", "yes", "on"):
                return True
            if v.lower() in ("0", "false", "no", "off", ""):
                return False
            raise TclError('expected boolean value but got "%s"' % v)
        return bool(v)


def getint(s):
    return int(s)


def getdouble(s):
    return float(s)


def getboolean(s):
    return BooleanVar(value=s).get()


def mainloop(n=0):
    _get_root().mainloop(n)


def _report():
    # Tk と同じく、コールバックのエラーは表示して続ける
    _sys.stderr.write("Exception in Tkinter callback\n")
    _tb.print_exc()


# ============================================================
# イベント
# ============================================================
class Event:
    def __init__(self, **kw):
        self.__dict__.update(serial=0, num="??", height="??", width="??", keycode="??", state=0, time=0, x=0, y=0, x_root=0, y_root=0,
                             char="", send_event=False, keysym="??", keysym_num=0, type="??", widget=None, delta=0)
        self.__dict__.update(kw)

    def __repr__(self):
        return "<%s event %s>" % (self.type, " ".join("%s=%r" % (k, v) for k, v in self.__dict__.items() if k in ("keysym", "char", "x", "y", "num", "delta") and v not in ("??", "")))


_MODS = {"Control": "Control", "Shift": "Shift", "Alt": "Alt", "Option": "Alt", "Mod1": "Alt", "Command": "Meta", "Meta": "Meta", "Lock": "Lock"}
_KINDS = {"KeyPress": "KeyPress", "Key": "KeyPress", "KeyRelease": "KeyRelease", "ButtonPress": "ButtonPress", "Button": "ButtonPress",
          "ButtonRelease": "ButtonRelease", "Motion": "Motion", "Enter": "Enter", "Leave": "Leave", "FocusIn": "FocusIn", "FocusOut": "FocusOut",
          "MouseWheel": "MouseWheel", "Configure": "Configure", "Destroy": "Destroy", "Map": "Map", "Unmap": "Unmap", "Visibility": "Visibility",
          "Expose": "Expose", "Activate": "Activate", "Deactivate": "Deactivate"}


def _parse_seq(seq):
    if seq.startswith("<<") and seq.endswith(">>"):
        return ("Virtual", seq[2:-2], frozenset(), 1)
    if not seq.startswith("<"):
        return ("KeyPress", seq, frozenset(), 1)
    mods, count, kind, detail = set(), 1, None, None
    for p in seq[1:-1].split("-"):
        if p in _MODS:
            mods.add(_MODS[p])
        elif p == "Double":
            count = 2
        elif p == "Triple":
            count = 3
        elif _re.match(r"^B\d$|^Button\d$", p):
            mods.add("B" + p[-1])
        elif p in _KINDS:
            kind = _KINDS[p]
        elif p.isdigit():
            detail = int(p)
            kind = kind or "ButtonPress"
        elif p:
            detail = p
            kind = kind or "KeyPress"
    return (kind or "KeyPress", detail, frozenset(mods), count)


def _cats(binds):
    c = set()
    for (kind, detail, mods, count) in binds:
        if kind in ("KeyPress", "KeyRelease"):
            c.add("key")
        elif kind in ("ButtonPress", "ButtonRelease"):
            c.add("mouse")
            if count > 1:
                c.add("dbl")
        elif kind == "Motion":
            c.add("drag" if any(m.startswith("B") for m in mods) else "move")
        elif kind in ("Enter", "Leave"):
            c.add("hover")
        elif kind == "MouseWheel":
            c.add("wheel")
        elif kind in ("FocusIn", "FocusOut"):
            c.add("focus")
        elif kind == "Configure":
            c.add("size")
    return sorted(c)


def _match(binds, kind, detail, mods, count):
    best, score = None, -1
    for key, funcs in binds.items():
        k, d, m, c = key
        if k != kind or c > count or not m <= mods:
            continue
        if d is not None and d != detail and not (kind.startswith("Key") and isinstance(d, str) and isinstance(detail, str) and d.lower() == detail.lower() and len(d) > 1):
            continue
        s = (2 if d is not None else 0) + len(m) + c
        if s > score:
            best, score = funcs, s
    return best


def _call_bound(funcs, ev):
    for f in list(funcs):
        try:
            if f(ev) == "break":
                return "break"
        except (SystemExit, KeyboardInterrupt):
            raise
        except Exception:
            _report()
    return None


def _dispatch(w, kind, detail, mods, count, ev):
    tags = [w]
    top = w._toplevel() if hasattr(w, "_toplevel") else None
    if top is not None and top is not w:
        tags.append(top)
    for t in tags:
        funcs = _match(t._binds, kind, detail, mods, count)
        if funcs and _call_bound(funcs, ev) == "break":
            return
    funcs = _match(_S["all"], kind, detail, mods, count)
    if funcs:
        _call_bound(funcs, ev)


def _handle(ev):
    t = ev.get("t")
    w = _S["widgets"].get(ev.get("id"))
    if t == "cmd":
        if w is not None and not w._destroyed:
            w._ui_command(ev)
    elif t == "var":
        if w is not None and not w._destroyed:
            w._ui_value(ev.get("v"), ev)
    elif t == "menu":
        fn = _S["menus"].get(ev.get("item"))
        if fn:
            fn()
    elif t == "close":
        win = _S["widgets"].get(ev.get("id"))
        if win is not None and not win._destroyed:
            win._on_close()
    elif t == "size":
        if w is not None:
            w._size = (int(ev.get("w", 0)), int(ev.get("h", 0)))
            e = Event(type="Configure", widget=w, width=w._size[0], height=w._size[1])
            _dispatch(w, "Configure", None, frozenset(), 1, e)
    elif t in ("key", "mouse"):
        target = w if w is not None and not w._destroyed else _S["widgets"].get(ev.get("win"))
        if target is None or target._destroyed:
            return
        mods = set()
        m = int(ev.get("m", 0))
        if m & 1:
            mods.add("Shift")
        if m & 2:
            mods.add("Control")
        if m & 4:
            mods.add("Alt")
        if m & 8:
            mods.add("Meta")
        bs = int(ev.get("bs", 0))
        for i, bit in ((1, 1), (2, 4), (3, 2)):
            if bs & bit:
                mods.add("B%d" % i)
        x, y = int(ev.get("x", 0)), int(ev.get("y", 0))
        if t == "key":
            kind = "KeyPress" if ev.get("k") == "kd" else "KeyRelease"
            ks = ev.get("ks", "")
            e = Event(type=kind, widget=target, keysym=ks, char=ev.get("ch", ""), keycode=int(ev.get("kc", 0)), keysym_num=int(ev.get("kc", 0)), state=m, x=x, y=y)
            _dispatch(target, kind, ks, frozenset(mods), 1, e)
        else:
            k = ev.get("k")
            b = int(ev.get("b", 1))
            kind = {"down": "ButtonPress", "dbl": "ButtonPress", "up": "ButtonRelease", "move": "Motion", "enter": "Enter", "leave": "Leave", "wheel": "MouseWheel"}.get(k)
            if kind is None:
                return
            e = Event(type=kind, widget=target, x=x, y=y, x_root=x, y_root=y, num=b if kind.startswith("Button") else "??", state=m, delta=int(ev.get("d", 0)) * 120)
            count = 2 if k == "dbl" else 1
            if isinstance(target, Canvas) and kind in ("ButtonPress", "ButtonRelease", "Motion", "Enter", "Leave"):
                target._item_event(kind, b, frozenset(mods), count, e)
            _dispatch(target, kind, b if kind.startswith("Button") else None, frozenset(mods), count, e)
    elif t == "virtual":
        if w is not None and not w._destroyed:
            w.event_generate("<<%s>>" % ev.get("name"))


def _process():
    for ev in _fc.take_events("tk"):
        try:
            _handle(ev)
        except (SystemExit, KeyboardInterrupt):
            raise
        except Exception:
            _report()
    _run_timers()


def _run_timers():
    now = _time.monotonic()
    tm = _S["timers"]
    while tm and tm[0][0] <= now:
        _, seq, fn, args = _heapq.heappop(tm)
        if fn is None:
            continue
        try:
            fn(*args)
        except (SystemExit, KeyboardInterrupt):
            raise
        except Exception:
            _report()
        now = _time.monotonic()


def _alive():
    return any(not w._destroyed for w in _S["wins"].values())


def _wait(until_fn):
    """until_fn() が真になるまで、画面の操作とタイマーを処理し続ける"""
    _flush()
    if not _fc.events_ok():
        while not until_fn():
            _process()
            _flush(False)
            if not _S["timers"]:
                _fc.note("tk-ev", "tkinter: ボタンやキーの操作を受け取るには、ページを再読み込みしてください (はじめて開いたときは再読み込みが必要です)")
                return
            _fc.sleep(max(0.0, min(0.05, _S["timers"][0][0] - _time.monotonic())))
        return
    while not until_fn():
        _process()
        _flush(False)
        if until_fn():
            break
        wait = 0.05
        if _S["timers"]:
            wait = max(0.0, min(wait, _S["timers"][0][0] - _time.monotonic()))
        if wait >= 0.016:
            _flush()
        if wait > 0:
            _fc.wait_events(int(wait * 1000) or 1)


# ============================================================
# 画面への配置 (pack / grid / place)
# ============================================================
class Pack:
    def pack_configure(self, cnf={}, **kw):
        kw = dict(cnf, **kw)
        if "in_" in kw:
            kw.pop("in_")
        self._geo = ("pack", kw)
        _emit(["geo", self._id, "pack", _geo_opts(kw)])

    pack = pack_configure

    def pack_forget(self):
        self._geo = None
        _emit(["forget", self._id])

    forget = pack_forget

    def pack_info(self):
        return dict(self._geo[1]) if self._geo and self._geo[0] == "pack" else {}

    info = pack_info

    def pack_propagate(self, flag=None):
        if flag is None:
            return self._opts.get("_propagate", True)
        self._opts["_propagate"] = bool(flag)
        _emit(["cfg", self._id, {"propagate": bool(flag)}])

    propagate = pack_propagate

    def pack_slaves(self):
        return [w for w in self.winfo_children() if w._geo and w._geo[0] == "pack"]

    slaves = pack_slaves


class Grid:
    def grid_configure(self, cnf={}, **kw):
        kw = dict(cnf, **kw)
        kw.pop("in_", None)
        old = self._geo[1] if self._geo and self._geo[0] == "grid" else {}
        if "row" not in kw and "row" not in old:
            kw["row"] = sum(1 for w in self.master.winfo_children() if w is not self and w._geo and w._geo[0] == "grid")
        merged = dict(old, **kw)
        self._geo = ("grid", merged)
        _emit(["geo", self._id, "grid", _geo_opts(merged)])

    grid = grid_configure

    def grid_forget(self):
        self._geo = None
        _emit(["forget", self._id])

    def grid_remove(self):
        self._geo_saved = self._geo
        self.grid_forget()

    def grid_info(self):
        return dict(self._geo[1]) if self._geo and self._geo[0] == "grid" else {}

    def grid_columnconfigure(self, index, cnf={}, **kw):
        kw = dict(cnf, **kw)
        for i in (index if isinstance(index, (list, tuple)) else [index]):
            self._cols[int(i) if str(i).isdigit() else 0] = dict(self._cols.get(i, {}), **kw)
        _emit(["gridcfg", self._id, {"cols": {str(k): v for k, v in self._cols.items()}, "rows": {str(k): v for k, v in self._rows.items()}}])

    columnconfigure = grid_columnconfigure

    def grid_rowconfigure(self, index, cnf={}, **kw):
        kw = dict(cnf, **kw)
        for i in (index if isinstance(index, (list, tuple)) else [index]):
            self._rows[int(i) if str(i).isdigit() else 0] = dict(self._rows.get(i, {}), **kw)
        _emit(["gridcfg", self._id, {"cols": {str(k): v for k, v in self._cols.items()}, "rows": {str(k): v for k, v in self._rows.items()}}])

    rowconfigure = grid_rowconfigure

    def grid_slaves(self, row=None, column=None):
        out = []
        for w in self.winfo_children():
            if w._geo and w._geo[0] == "grid":
                g = w._geo[1]
                if (row is None or g.get("row") == row) and (column is None or g.get("column", 0) == column):
                    out.append(w)
        return out

    def grid_size(self):
        cols = rows = 0
        for w in self.grid_slaves():
            g = w._geo[1]
            cols = max(cols, int(g.get("column", 0)) + int(g.get("columnspan", 1)))
            rows = max(rows, int(g.get("row", 0)) + int(g.get("rowspan", 1)))
        return (cols, rows)

    size = grid_size

    def grid_propagate(self, flag=None):
        return self.pack_propagate(flag)

    def grid_bbox(self, *a):
        return (0, 0, 0, 0)

    def grid_location(self, x, y):
        return (0, 0)

    def grid_anchor(self, anchor=None):
        pass


class Place:
    def place_configure(self, cnf={}, **kw):
        kw = dict(cnf, **kw)
        kw.pop("in_", None)
        old = self._geo[1] if self._geo and self._geo[0] == "place" else {}
        merged = dict(old, **kw)
        self._geo = ("place", merged)
        _emit(["geo", self._id, "place", _geo_opts(merged)])

    place = place_configure

    def place_forget(self):
        self._geo = None
        _emit(["forget", self._id])

    def place_info(self):
        return dict(self._geo[1]) if self._geo and self._geo[0] == "place" else {}

    def place_slaves(self):
        return [w for w in self.winfo_children() if w._geo and w._geo[0] == "place"]


def _pad(v):
    if isinstance(v, (tuple, list)):
        return [float(v[0]), float(v[1] if len(v) > 1 else v[0])]
    try:
        return [float(v), float(v)]
    except (TypeError, ValueError):
        return [0, 0]


def _geo_opts(kw):
    out = {}
    for k, v in kw.items():
        if k in ("padx", "pady", "ipadx", "ipady"):
            out[k] = _pad(v)
        elif k in ("row", "column", "rowspan", "columnspan"):
            try:
                out[k] = int(v)
            except (TypeError, ValueError):
                pass
        elif k in ("x", "y", "width", "height", "relx", "rely", "relwidth", "relheight"):
            try:
                out[k] = float(v)
            except (TypeError, ValueError):
                pass
        elif k == "expand":
            out[k] = bool(v) and str(v).lower() not in ("0", "false", "no")
        elif k in ("side", "fill", "anchor", "sticky"):
            out[k] = str(v).lower()
    return out


# ============================================================
# 共通 (Misc)
# ============================================================
_CB_OPTS = ("command", "validatecommand", "invalidcommand", "postcommand", "xscrollcommand", "yscrollcommand")


class Misc:
    _kind = "frame"
    _defaults = {}
    _destroyed = False

    # ---- タイマー ----
    def after(self, ms, func=None, *args):
        if func is None:
            _fc.sleep(max(0, int(ms)) / 1000.0)
            return None
        _S["tseq"] += 1
        tid = "after#%d" % _S["tseq"]
        _heapq.heappush(_S["timers"], (_time.monotonic() + max(0, int(ms)) / 1000.0, _S["tseq"], func, args))
        _S.setdefault("tids", {})[tid] = _S["tseq"]
        return tid

    def after_idle(self, func, *args):
        return self.after(0, func, *args)

    def after_cancel(self, id):
        seq = _S.get("tids", {}).pop(id, None)
        if seq is None:
            return
        _S["timers"] = [(t, s, (None if s == seq else f), a) for (t, s, f, a) in _S["timers"]]
        _heapq.heapify(_S["timers"])

    def after_info(self, id=None):
        return tuple(_S.get("tids", {}))

    # ---- 待つ ----
    def mainloop(self, n=0):
        if not _S["noted"]:
            _S["noted"] = True
        _wait(lambda: not _alive() or _S.get("quit"))
        _S["quit"] = False
        _flush()

    def quit(self):
        _S["quit"] = True

    def update(self):
        _process()
        _flush(False)

    def update_idletasks(self):
        _flush()

    def wait_window(self, window=None):
        w = window or self
        _wait(lambda: w._destroyed)

    def wait_variable(self, name):
        var = name
        start = var._value
        _wait(lambda: var._value != start or not _alive())

    waitvar = wait_variable

    def wait_visibility(self, window=None):
        pass

    # ---- 出来事 (bind) ----
    def bind(self, sequence=None, func=None, add=None):
        if sequence is None:
            return [s for s in self._bind_seqs]
        key = _parse_seq(sequence)
        if func is None:
            return self._binds.get(key)
        if add and str(add).startswith("+") or add is True:
            self._binds.setdefault(key, []).append(func)
        else:
            self._binds[key] = [func]
        self._bind_seqs.add(sequence)
        _emit(["bind", self._id, _cats(self._binds)])
        return "py%d" % id(func)

    def unbind(self, sequence, funcid=None):
        self._binds.pop(_parse_seq(sequence), None)
        self._bind_seqs.discard(sequence)
        _emit(["bind", self._id, _cats(self._binds)])

    def bind_all(self, sequence=None, func=None, add=None):
        key = _parse_seq(sequence)
        if add:
            _S["all"].setdefault(key, []).append(func)
        else:
            _S["all"][key] = [func]
        _emit(["bind", 0, _cats(_S["all"])])

    def unbind_all(self, sequence):
        _S["all"].pop(_parse_seq(sequence), None)
        _emit(["bind", 0, _cats(_S["all"])])

    def bind_class(self, className, sequence=None, func=None, add=None):
        return self.bind_all(sequence, func, add)

    def event_generate(self, sequence, **kw):
        kind, detail, mods, count = _parse_seq(sequence)
        e = Event(type=kind if kind != "Virtual" else "VirtualEvent", widget=self, **{k: v for k, v in kw.items() if k in ("x", "y", "keysym", "char", "delta")})
        _dispatch(self, kind, detail if kind != "Virtual" else detail, mods, count, e)

    def event_add(self, virtual, *sequences):
        pass

    def event_delete(self, virtual, *sequences):
        pass

    def event_info(self, virtual=None):
        return ()

    # ---- フォーカス ----
    def focus_set(self):
        _S["focus"] = self
        _emit(["focus", self._id])

    focus = focus_set
    focus_force = focus_set

    def focus_get(self):
        return _S["focus"]

    focus_displayof = focus_get
    focus_lastfor = focus_get

    def tk_focusNext(self):
        return None

    def tk_focusPrev(self):
        return None

    def grab_set(self):
        pass

    grab_set_global = grab_set

    def grab_release(self):
        pass

    def grab_current(self):
        return None

    def grab_status(self):
        return None

    # ---- 設定 ----
    def configure(self, cnf=None, **kw):
        if cnf is None and not kw:
            return {k: (k, k, k.capitalize(), None, v) for k, v in self._opts.items() if not k.startswith("_")}
        if isinstance(cnf, str) and not kw:
            v = self._opts.get(cnf)
            return (cnf, cnf, cnf.capitalize(), None, v)
        if cnf:
            kw = dict(cnf, **kw)
        self._set_opts(kw)

    config = configure

    def _set_opts(self, kw):
        kw = _norm_opts(kw)
        for k in ("variable", "textvariable", "listvariable"):
            if k in kw:
                old = self._opts.get(k)
                if isinstance(old, Variable) and self in old._widgets:
                    old._widgets.remove(self)
        self._opts.update(kw)
        self._bind_vars()
        ui = self._ui_opts(kw)
        if ui:
            _emit(["cfg", self._id, ui])

    def cget(self, key):
        key = _norm_key(key)
        if key in self._opts:
            v = self._opts[key]
            return v if not isinstance(v, (int, float)) or isinstance(v, bool) else v
        if key in ("text",):
            return ""
        if key in ("bg", "background"):
            return self._opts.get("bg", "#f0f0f0")
        return ""

    def __getitem__(self, key):
        return self.cget(key)

    def __setitem__(self, key, value):
        self.configure({key: value})

    def keys(self):
        return list(self._opts)

    # ---- 情報 ----
    def winfo_children(self):
        return [w for w in self.children.values() if not w._destroyed]

    def winfo_width(self):
        if self._size[0] > 1:
            return self._size[0]
        w = self._opts.get("width")
        return int(w) if isinstance(w, (int, float)) and w > 1 else 200

    def winfo_height(self):
        if self._size[1] > 1:
            return self._size[1]
        h = self._opts.get("height")
        return int(h) if isinstance(h, (int, float)) and h > 1 else 100

    winfo_reqwidth = winfo_width
    winfo_reqheight = winfo_height

    def winfo_screenwidth(self):
        return 1280

    def winfo_screenheight(self):
        return 800

    def winfo_x(self):
        return 0

    def winfo_y(self):
        return 0

    def winfo_rootx(self):
        return 0

    def winfo_rooty(self):
        return 0

    def winfo_pointerx(self):
        return 0

    def winfo_pointery(self):
        return 0

    def winfo_pointerxy(self):
        return (0, 0)

    def winfo_exists(self):
        return 0 if self._destroyed else 1

    def winfo_ismapped(self):
        return 0 if self._destroyed or (self._geo is None and self.master is not None) else 1

    def winfo_viewable(self):
        return self.winfo_ismapped()

    def winfo_toplevel(self):
        return self._toplevel()

    def winfo_class(self):
        return type(self).__name__

    def winfo_name(self):
        return self._name

    def winfo_parent(self):
        return str(self.master) if self.master else ""

    def winfo_id(self):
        return self._id

    def winfo_geometry(self):
        return "%dx%d+0+0" % (self.winfo_width(), self.winfo_height())

    def winfo_fpixels(self, n):
        return float(n)

    def winfo_pixels(self, n):
        return int(float(n))

    def winfo_rgb(self, color):
        c = _color(color) or "#000000"
        if c.startswith("#") and len(c) == 7:
            return tuple(int(c[i:i + 2], 16) * 257 for i in (1, 3, 5))
        return (0, 0, 0)

    def winfo_screen(self):
        return ":0"

    def winfo_manager(self):
        return self._geo[0] if self._geo else ""

    def nametowidget(self, name):
        name = str(name)
        for w in _S["widgets"].values():
            if str(w) == name:
                return w
        raise KeyError(name)

    _nametowidget = nametowidget

    def register(self, func, subst=None, needcleanup=1):
        name = "py_cb%d" % id(func)
        _S.setdefault("cbs", {})[name] = func
        return name

    _register = register

    def bell(self, displayof=0):
        try:
            _js.__fc_sound(_json.dumps({"op": "beep", "freq": 880, "ms": 120}), None)
        except Exception:
            pass

    def clipboard_clear(self):
        _S["clip"] = ""

    def clipboard_append(self, string):
        _S["clip"] = _S.get("clip", "") + str(string)

    def clipboard_get(self, **kw):
        return _S.get("clip", "")

    def selection_get(self, **kw):
        return _S.get("clip", "")

    def option_add(self, pattern, value, priority=None):
        pass

    def option_clear(self):
        pass

    def option_get(self, name, className):
        return ""

    def option_readfile(self, fileName, priority=None):
        pass

    def tk_setPalette(self, *args, **kw):
        pass

    def tk_strictMotif(self, boolean=None):
        return 0

    def image_names(self):
        return ()

    def image_types(self):
        return ("photo", "bitmap")

    def lift(self, aboveThis=None):
        _emit(["raise", self._id])

    tkraise = lift

    def lower(self, belowThis=None):
        _emit(["lower", self._id])

    def getvar(self, name="PY_VAR"):
        return ""

    def setvar(self, name="PY_VAR", value="1"):
        pass

    def getint(self, s):
        return int(s)

    def getdouble(self, s):
        return float(s)

    def getboolean(self, s):
        return getboolean(s)

    def __str__(self):
        return self._path

    def __repr__(self):
        return "<%s.%s object %s>" % (type(self).__module__, type(self).__name__, self._path)

    def _toplevel(self):
        w = self
        while w is not None and not isinstance(w, (Tk, Toplevel)):
            w = w.master
        return w

    @property
    def tk(self):
        return _TkApp(self)

    def destroy(self):
        if self._destroyed:
            return
        for c in list(self.children.values()):
            c.destroy()
        self._destroyed = True
        e = Event(type="Destroy", widget=self)
        f = _match(self._binds, "Destroy", None, frozenset(), 1)
        if f:
            _call_bound(f, e)
        _emit(["del", self._id])
        if self.master is not None:
            self.master.children.pop(self._name, None)
        _S["widgets"].pop(self._id, None)
        for k in ("variable", "textvariable", "listvariable"):
            v = self._opts.get(k)
            if isinstance(v, Variable) and self in v._widgets:
                v._widgets.remove(self)
        if _S["focus"] is self:
            _S["focus"] = None
        _flush()

    # ---- ウィジェットごとの値 (上書きする) ----
    def _var_changed(self, var):
        pass

    def _ui_value(self, v, ev):
        pass

    def _ui_command(self, ev):
        cmd = self._opts.get("command")
        if callable(cmd):
            try:
                cmd()
            except (SystemExit, KeyboardInterrupt):
                raise
            except Exception:
                _report()

    def _bind_vars(self):
        for k in ("variable", "textvariable", "listvariable"):
            v = self._opts.get(k)
            if isinstance(v, Variable) and self not in v._widgets:
                v._widgets.append(self)

    def _ui_opts(self, kw):
        out = {}
        for k, v in kw.items():
            if k in _CB_OPTS or k.startswith("_") or callable(v) and k != "image":
                continue
            if k in ("bg", "fg", "activebackground", "activeforeground", "selectcolor", "highlightbackground", "highlightcolor", "insertbackground",
                     "disabledforeground", "selectbackground", "selectforeground", "troughcolor", "readonlybackground", "disabledbackground"):
                out[k] = _color(v)
            elif k == "font":
                out[k] = _font(v)
            elif k == "image":
                out[k] = getattr(v, "_iid", None) if v else None
            elif k == "menu":
                out[k] = getattr(v, "_id", None) if v else None
                if v is not None and hasattr(v, "_push"):
                    v._push()
            elif k in ("textvariable", "variable", "listvariable"):
                if isinstance(v, Variable):
                    out["value"] = self._value_for_ui(v)
            elif isinstance(v, (str, int, float, bool)) or v is None:
                out[k] = v
            elif isinstance(v, (list, tuple)):
                out[k] = [str(x) if not isinstance(x, (int, float)) else x for x in v]
            else:
                out[k] = str(v)
        return out

    def _value_for_ui(self, var):
        try:
            return var.get()
        except Exception:
            return var._value


class _TkApp:
    """root.tk.call(...) など (よく使われるものだけ)"""

    def __init__(self, w):
        self.w = w

    def call(self, *args):
        if args and args[0] == "wm" and len(args) > 1 and args[1] == "attributes":
            return ""
        if args and args[0] == "tk" and len(args) > 2 and args[1] == "scaling":
            return 1.0
        return ""

    def eval(self, s):
        return ""

    def getvar(self, name):
        return ""

    def setvar(self, name, value):
        pass

    def splitlist(self, s):
        return tuple(str(s).split()) if isinstance(s, str) else tuple(s)

    def createcommand(self, name, func):
        pass

    def globalsetvar(self, *a):
        pass

    def globalgetvar(self, *a):
        return ""

    def getboolean(self, s):
        return getboolean(s)

    def getint(self, s):
        return int(s)

    def getdouble(self, s):
        return float(s)


_ALIASES = {"background": "bg", "foreground": "fg", "borderwidth": "bd"}


def _norm_key(k):
    k = k.rstrip("_") if k in ("from_",) else k
    return _ALIASES.get(k, k)


def _norm_opts(kw):
    out = {}
    for k, v in kw.items():
        if k == "from_":
            k = "from"
        out[_ALIASES.get(k, k)] = v
    return out


# ============================================================
# ウィンドウ (Tk / Toplevel)
# ============================================================
class Wm:
    def wm_title(self, string=None):
        if string is None:
            return self._title
        self._title = str(string)
        _emit(["title", self._id, self._title])

    title = wm_title

    def wm_geometry(self, newGeometry=None):
        if newGeometry is None:
            return "%dx%d+0+0" % (self.winfo_width(), self.winfo_height())
        m = _re.match(r"^\s*(?:(\d+)x(\d+))?", str(newGeometry))
        if m and m.group(1):
            w, h = int(m.group(1)), int(m.group(2))
            self._opts["width"], self._opts["height"] = w, h
            _emit(["geom", self._id, w, h])
        return ""

    geometry = wm_geometry

    def wm_resizable(self, width=None, height=None):
        return (1, 1)

    resizable = wm_resizable

    def wm_minsize(self, width=None, height=None):
        if width is not None:
            _emit(["minsize", self._id, int(width), int(height or 0)])

    minsize = wm_minsize

    def wm_maxsize(self, width=None, height=None):
        pass

    maxsize = wm_maxsize

    def wm_protocol(self, name=None, func=None):
        if name == "WM_DELETE_WINDOW":
            if func is None:
                return self._on_delete
            self._on_delete = func
        return ""

    protocol = wm_protocol

    def wm_iconbitmap(self, bitmap=None, default=None):
        pass

    iconbitmap = wm_iconbitmap

    def wm_iconphoto(self, default=False, *args):
        pass

    iconphoto = wm_iconphoto

    def wm_iconname(self, newName=None):
        pass

    iconname = wm_iconname

    def wm_attributes(self, *args, **kw):
        if kw.get("fullscreen") or (len(args) >= 2 and args[0] == "-fullscreen" and args[1]):
            _emit(["full", self._id, True])
        return ""

    attributes = wm_attributes

    def wm_state(self, newstate=None):
        if newstate is None:
            return "withdrawn" if self._hidden else "normal"
        if newstate in ("withdrawn", "iconic"):
            self.withdraw()
        else:
            self.deiconify()

    state = wm_state

    def wm_withdraw(self):
        self._hidden = True
        _emit(["show", self._id, False])

    withdraw = wm_withdraw

    def wm_deiconify(self):
        self._hidden = False
        _emit(["show", self._id, True])

    deiconify = wm_deiconify

    def wm_iconify(self):
        self.withdraw()

    iconify = wm_iconify

    def wm_overrideredirect(self, boolean=None):
        return False

    overrideredirect = wm_overrideredirect

    def wm_transient(self, master=None):
        pass

    transient = wm_transient

    def wm_frame(self):
        return str(self._id)

    def wm_aspect(self, *a):
        pass

    aspect = wm_aspect

    def wm_positionfrom(self, who=None):
        pass

    def wm_sizefrom(self, who=None):
        pass

    def wm_group(self, pathName=None):
        pass

    def wm_focusmodel(self, model=None):
        pass

    def wm_client(self, name=None):
        pass

    def wm_command(self, value=None):
        pass

    def _on_close(self):
        if self._on_delete is not None:
            try:
                self._on_delete()
            except (SystemExit, KeyboardInterrupt):
                raise
            except Exception:
                _report()
        else:
            self.destroy()


class Tk(Misc, Wm):
    def __init__(self, screenName=None, baseName=None, className="Tk", useTk=True, sync=False, use=None):
        global _default_root
        self._id = _nid()
        self.master = None
        self.children = {}
        self._name = ""
        self._path = "."
        self._opts = {"bg": "#f0f0f0"}
        self._binds = {}
        self._bind_seqs = set()
        self._geo = ("root", {})
        self._size = (0, 0)
        self._title = className if className != "Tk" else "tk"
        self._hidden = False
        self._on_delete = None
        self._cols, self._rows = {}, {}
        self._destroyed = False
        _S["widgets"][self._id] = self
        _S["wins"][self._id] = self
        if _default_root is None or _default_root._destroyed:
            _default_root = self
        _fc.note("tk", "tkinter: ForgeCode の互換版で動いています (ウィンドウは出力に表示されます。× か ■ で終わります)")
        _emit(["win", self._id, None, {"title": self._title, "bg": "#f0f0f0"}])

    def destroy(self):
        global _default_root
        Misc.destroy(self)
        if _default_root is self:
            _default_root = None

    def report_callback_exception(self, exc, val, tb):
        _report()

    def loadtk(self):
        pass

    def readprofile(self, baseName, className):
        pass


Tcl = Tk


# ============================================================
# ウィジェット
# ============================================================
class BaseWidget(Misc):
    def __init__(self, master=None, cnf={}, **kw):
        if master is None:
            master = _get_root()
        kw = _norm_opts(dict(cnf, **kw))
        self.master = master
        self._id = _nid()
        self.children = {}
        name = kw.pop("name", None)
        cls = type(self).__name__.lower()
        if name is None:
            n = sum(1 for c in master.children if c.startswith("!" + cls)) + 1
            name = "!" + cls + (str(n) if n > 1 else "")
        self._name = name
        self._path = (master._path.rstrip(".") + "." + name) if master._path != "." else "." + name
        master.children[name] = self
        self._opts = dict(self._defaults)
        self._opts.update(kw)
        self._binds = {}
        self._bind_seqs = set()
        self._geo = None
        self._size = (0, 0)
        self._cols, self._rows = {}, {}
        self._destroyed = False
        _S["widgets"][self._id] = self
        self._bind_vars()
        self._init()
        _emit(["new", self._id, master._id, self._kind, self._ui_opts(self._opts)])
        self._after_create()

    def _init(self):
        pass

    def _after_create(self):
        pass


class Widget(BaseWidget, Pack, Grid, Place):
    pass


class Toplevel(BaseWidget, Wm):
    _kind = "toplevel"

    def __init__(self, master=None, cnf={}, **kw):
        if master is None:
            master = _get_root()
        kw = _norm_opts(dict(cnf, **kw))
        self.master = master
        self._id = _nid()
        self.children = {}
        n = sum(1 for c in master.children if c.startswith("!toplevel")) + 1
        self._name = kw.pop("name", "!toplevel" + (str(n) if n > 1 else ""))
        self._path = "." + self._name
        master.children[self._name] = self
        self._opts = {"bg": "#f0f0f0"}
        self._opts.update(kw)
        self._binds = {}
        self._bind_seqs = set()
        self._geo = ("root", {})
        self._size = (0, 0)
        self._title = "tk"
        self._hidden = False
        self._on_delete = None
        self._cols, self._rows = {}, {}
        self._destroyed = False
        _S["widgets"][self._id] = self
        _S["wins"][self._id] = self
        _emit(["win", self._id, master._toplevel()._id if master._toplevel() else None, {"title": self._title, **self._ui_opts(self._opts)}])


class Frame(Widget):
    _kind = "frame"


class LabelFrame(Widget):
    _kind = "labelframe"


class Label(Widget):
    _kind = "label"

    def _var_changed(self, var):
        _emit(["cfg", self._id, {"text": str(self._value_for_ui(var))}])

    def _ui_opts(self, kw):
        out = Misc._ui_opts(self, kw)
        if "value" in out:
            out["text"] = str(out.pop("value"))
        return out


class Message(Label):
    _kind = "message"


class Button(Widget):
    _kind = "button"

    def invoke(self):
        self._ui_command({})

    def flash(self):
        pass

    def _var_changed(self, var):
        _emit(["cfg", self._id, {"text": str(self._value_for_ui(var))}])

    def _ui_opts(self, kw):
        out = Misc._ui_opts(self, kw)
        if "value" in out:
            out["text"] = str(out.pop("value"))
        return out


def _idx_entry(text, index, insert=None):
    if index in (END, "end"):
        return len(text)
    if index in (INSERT, "insert"):
        return len(text) if insert is None else insert
    if index in ("anchor", "sel.first", "sel.last"):
        return len(text) if index == "sel.last" else 0
    try:
        return max(0, min(len(text), int(index)))
    except (TypeError, ValueError):
        raise TclError('bad entry index "%s"' % index)


class Entry(Widget):
    _kind = "entry"
    _defaults = {"width": 20}

    def _init(self):
        v = self._opts.get("textvariable")
        self._text = str(v.get()) if isinstance(v, Variable) else ""

    def get(self):
        return self._text

    def insert(self, index, string):
        i = _idx_entry(self._text, index)
        self._set_text(self._text[:i] + str(string) + self._text[i:])

    def delete(self, first, last=None):
        i = _idx_entry(self._text, first)
        j = i + 1 if last is None else _idx_entry(self._text, last)
        self._set_text(self._text[:i] + self._text[j:])

    def _set_text(self, t):
        self._text = t
        _emit(["val", self._id, t])
        v = self._opts.get("textvariable")
        if isinstance(v, Variable):
            v._ui_set(t, self)

    def _var_changed(self, var):
        self._text = str(self._value_for_ui(var))
        _emit(["val", self._id, self._text])

    def _ui_value(self, v, ev):
        self._text = str(v)
        var = self._opts.get("textvariable")
        if isinstance(var, Variable):
            var._ui_set(self._text, self)

    def _ui_command(self, ev):
        pass

    def icursor(self, index):
        pass

    def index(self, index):
        return _idx_entry(self._text, index)

    def select_range(self, start, end):
        _emit(["select", self._id])

    selection_range = select_range

    def select_clear(self):
        pass

    selection_clear = select_clear

    def select_present(self):
        return False

    selection_present = select_present

    def select_from(self, index):
        pass

    def select_to(self, index):
        pass

    def select_adjust(self, index):
        pass

    def xview(self, *args):
        pass

    xview_moveto = xview
    xview_scroll = xview

    def scan_mark(self, x):
        pass

    def scan_dragto(self, x):
        pass

    def validate(self):
        return True


class Spinbox(Entry):
    _kind = "spinbox"
    _defaults = {"width": 20, "from": 0, "to": 0, "increment": 1}

    def _init(self):
        v = self._opts.get("textvariable")
        vals = self._opts.get("values")
        if isinstance(v, Variable):
            self._text = str(v.get())
        elif vals:
            self._text = str(list(vals)[0] if not isinstance(vals, str) else vals.split()[0])
        else:
            f = self._opts.get("from", 0)
            self._text = str(int(f) if float(f).is_integer() else f)

    def _ui_command(self, ev):
        Misc._ui_command(self, ev)

    def invoke(self, element):
        pass

    def identify(self, x, y):
        return ""


class Text(Widget):
    _kind = "text"
    _defaults = {"width": 80, "height": 24}

    def _init(self):
        self._text = ""
        self._marks = {"insert": 0}
        self._tags = {}

    def _index(self, index):
        t = self._text
        s = str(index).strip()
        m = _re.match(r"^(\S+?)\s*([+-].*)?$", s) if s not in ("end", END) else None
        base, mod = (s, "") if m is None else (m.group(1), m.group(2) or "")
        lines = t.split("\n")
        if base in ("end",):
            pos = len(t) + 1  # Tk の文章は最後に改行があるので、end はその後ろ
        elif base in ("insert", "current"):
            pos = self._marks.get("insert", len(t))
        elif base in ("sel.first", "sel.last", "anchor"):
            pos = 0
        elif base in self._marks:
            pos = self._marks[base]
        else:
            mm = _re.match(r"^(\d+)\.(\d+|end)$", base)
            if not mm:
                mm2 = _re.match(r"^@(\d+),(\d+)$", base)
                if mm2:
                    return len(t)
                raise TclError('bad text index "%s"' % index)
            ln = max(1, int(mm.group(1)))
            if ln > len(lines):
                pos = len(t)
            else:
                start = sum(len(l) + 1 for l in lines[:ln - 1])
                col = len(lines[ln - 1]) if mm.group(2) == "end" else min(int(mm.group(2)), len(lines[ln - 1]))
                pos = start + col
        for part in _re.findall(r"([+-])\s*(\d+)\s*(c|chars?|l|lines?|indices)|(linestart|lineend|wordstart|wordend)", mod):
            sign, n, unit, word = part
            if word == "linestart":
                pos = t.rfind("\n", 0, pos) + 1
            elif word == "lineend":
                e = t.find("\n", pos)
                pos = len(t) if e < 0 else e
            elif word in ("wordstart", "wordend"):
                pass
            elif unit.startswith("l"):
                ln, col = self._lc(pos)
                ln = ln + int(n) if sign == "+" else ln - int(n)
                pos = self._index("%d.%d" % (max(1, ln), col))
            else:
                pos = pos + int(n) if sign == "+" else pos - int(n)
        return max(0, min(len(t), pos))

    def _lc(self, pos):
        before = self._text[:pos]
        return before.count("\n") + 1, pos - (before.rfind("\n") + 1)

    def index(self, index):
        ln, col = self._lc(self._index(index))
        if str(index) == "end":
            return "%d.0" % (ln + 1)
        return "%d.%d" % (ln, col)

    def get(self, index1, index2=None):
        i = self._index(index1)
        if index2 is None:
            return (self._text + "\n")[i:i + 1]
        e2 = str(index2)
        j = len(self._text) + 1 if e2 == "end" else self._index(index2)
        return (self._text + "\n")[i:j]

    def insert(self, index, chars, *args):
        i = self._index(index)
        self._text = self._text[:i] + str(chars) + self._text[i:]
        self._marks["insert"] = i + len(str(chars))
        self._sync(args[0] if args else None, i, i + len(str(chars)))

    def delete(self, index1, index2=None):
        i = self._index(index1)
        j = i + 1 if index2 is None else (len(self._text) if str(index2) == "end" else self._index(index2))
        self._text = self._text[:i] + self._text[j:]
        self._sync()

    def replace(self, index1, index2, chars, *args):
        self.delete(index1, index2)
        self.insert(index1, chars, *args)

    def _sync(self, tag=None, a=0, b=0):
        op = ["val", self._id, self._text]
        _emit(op)
        if tag:
            for t in (tag if isinstance(tag, (list, tuple)) else [tag]):
                self._tags.setdefault(t, {"ranges": []})["ranges"].append((a, b))
            self._send_tags()

    def _send_tags(self):
        out = []
        for name, info in self._tags.items():
            o = info.get("opts", {})
            style = {"fg": _color(o.get("foreground") or o.get("fg")), "bg": _color(o.get("background") or o.get("bg")), "font": _font(o.get("font")),
                     "underline": bool(o.get("underline")), "strike": bool(o.get("overstrike"))}
            for a, b in info.get("ranges", []):
                out.append([a, b, style])
        _emit(["tags", self._id, out])

    def _ui_value(self, v, ev):
        self._text = str(v)
        self._marks["insert"] = int(ev.get("c", len(self._text))) if isinstance(ev, dict) else len(self._text)
        for info in self._tags.values():
            info["ranges"] = []
        e = Event(type="Virtual", widget=self)
        _dispatch(self, "Virtual", "Modified", frozenset(), 1, e)

    def see(self, index):
        _emit(["see", self._id, self._index(index)])

    def mark_set(self, name, index):
        self._marks[name] = self._index(index)

    def mark_unset(self, *names):
        for n in names:
            self._marks.pop(n, None)

    def mark_names(self):
        return tuple(self._marks)

    def mark_gravity(self, name, direction=None):
        return "right"

    def tag_configure(self, tagName, cnf=None, **kw):
        info = self._tags.setdefault(tagName, {"ranges": []})
        info.setdefault("opts", {}).update(dict(cnf or {}, **kw))
        self._send_tags()

    tag_config = tag_configure

    def tag_add(self, tagName, index1, *args):
        a = self._index(index1)
        b = self._index(args[0]) if args else a + 1
        self._tags.setdefault(tagName, {"ranges": []})["ranges"].append((a, b))
        self._send_tags()

    def tag_remove(self, tagName, index1, index2=None):
        if tagName in self._tags:
            self._tags[tagName]["ranges"] = []
            self._send_tags()

    def tag_delete(self, *tagNames):
        for t in tagNames:
            self._tags.pop(t, None)
        self._send_tags()

    def tag_names(self, index=None):
        return tuple(self._tags)

    def tag_ranges(self, tagName):
        out = []
        for a, b in self._tags.get(tagName, {}).get("ranges", []):
            out += [self.index("1.0+%dc" % a), self.index("1.0+%dc" % b)]
        return tuple(out)

    def tag_bind(self, tagName, sequence, func, add=None):
        return self.bind(sequence, func, add)

    def tag_raise(self, tagName, aboveThis=None):
        pass

    def tag_lower(self, tagName, belowThis=None):
        pass

    def tag_nextrange(self, tagName, index1, index2=None):
        r = self._tags.get(tagName, {}).get("ranges", [])
        return (self.index("1.0+%dc" % r[0][0]), self.index("1.0+%dc" % r[0][1])) if r else ()

    def search(self, pattern, index, stopindex=None, forwards=None, backwards=None, exact=None, regexp=None, nocase=None, count=None, elide=None):
        start = self._index(index)
        t = self._text
        if regexp:
            m = _re.compile(pattern, _re.I if nocase else 0).search(t, start)
            pos = m.start() if m else -1
        else:
            pos = (t.lower().find(pattern.lower(), start) if nocase else t.find(pattern, start))
        return "" if pos < 0 else self.index("1.0+%dc" % pos)

    def edit_modified(self, arg=None):
        return False

    def edit_undo(self):
        pass

    def edit_redo(self):
        pass

    def edit_reset(self):
        pass

    def edit_separator(self):
        pass

    def window_create(self, index, **kw):
        pass

    def image_create(self, index, **kw):
        pass

    def xview(self, *args):
        pass

    def yview(self, *args):
        pass

    yview_moveto = yview
    yview_scroll = yview
    xview_moveto = xview
    xview_scroll = xview

    def count(self, index1, index2, *args):
        return (abs(self._index(index2) - self._index(index1)),)

    def dlineinfo(self, index):
        return None

    def bbox(self, index):
        return None


class Checkbutton(Widget):
    _kind = "checkbutton"

    def _init(self):
        if not isinstance(self._opts.get("variable"), Variable):
            v = IntVar(value=0)
            self._opts["variable"] = v
            v._widgets.append(self)

    def _on(self):
        return self._opts.get("onvalue", 1)

    def _off(self):
        return self._opts.get("offvalue", 0)

    def _ui_opts(self, kw):
        out = Misc._ui_opts(self, kw)
        var = self._opts.get("variable")
        if isinstance(var, Variable):
            out["checked"] = str(var._value) == str(self._on()) or (var._value is True and self._on() == 1)
            out.pop("value", None)
        return out

    def _var_changed(self, var):
        _emit(["cfg", self._id, {"checked": str(var._value) == str(self._on()) or (var._value is True and self._on() == 1)}])

    def _ui_value(self, v, ev):
        var = self._opts["variable"]
        val = self._on() if v else self._off()
        if isinstance(var, BooleanVar):
            val = bool(v)
        var._ui_set(val, self)

    def select(self):
        self._opts["variable"].set(self._on())

    def deselect(self):
        self._opts["variable"].set(self._off())

    def toggle(self):
        v = self._opts["variable"]
        v.set(self._off() if str(v._value) == str(self._on()) else self._on())

    def invoke(self):
        self.toggle()
        self._ui_command({})

    def flash(self):
        pass


class Radiobutton(Widget):
    _kind = "radiobutton"

    def _init(self):
        if not isinstance(self._opts.get("variable"), Variable):
            v = _S.setdefault("radio_default", StringVar(value=""))
            self._opts["variable"] = v
            v._widgets.append(self)

    def _ui_opts(self, kw):
        out = Misc._ui_opts(self, kw)
        var = self._opts.get("variable")
        if isinstance(var, Variable):
            out["checked"] = str(var._value) == str(self._opts.get("value", ""))
            out["group"] = var._name
            out["rvalue"] = str(self._opts.get("value", ""))
            out.pop("value", None)
        return out

    def _var_changed(self, var):
        _emit(["cfg", self._id, {"checked": str(var._value) == str(self._opts.get("value", ""))}])

    def _ui_value(self, v, ev):
        if v:
            var = self._opts["variable"]
            val = self._opts.get("value", "")
            var._ui_set(val, self)

    def select(self):
        self._opts["variable"].set(self._opts.get("value", ""))

    def deselect(self):
        self._opts["variable"].set("")

    def invoke(self):
        self.select()
        self._ui_command({})

    def flash(self):
        pass


class Scale(Widget):
    _kind = "scale"
    _defaults = {"from": 0, "to": 100, "orient": "vertical", "resolution": 1}

    def _init(self):
        var = self._opts.get("variable")
        self._val = float(var.get()) if isinstance(var, Variable) else float(self._opts.get("from", 0))

    def _ui_opts(self, kw):
        out = Misc._ui_opts(self, kw)
        if "value" in out:
            out["value"] = float(out["value"])
        elif "from" in kw or "_init" not in kw:
            out["value"] = self._val
        return out

    def get(self):
        r = float(self._opts.get("resolution", 1) or 1)
        return int(round(self._val)) if r >= 1 and float(r).is_integer() else self._val

    def set(self, value):
        self._val = float(value)
        _emit(["val", self._id, self._val])
        var = self._opts.get("variable")
        if isinstance(var, Variable):
            var._ui_set(self.get(), self)

    def _var_changed(self, var):
        try:
            self._val = float(var.get())
        except Exception:
            return
        _emit(["val", self._id, self._val])

    def _ui_value(self, v, ev):
        self._val = float(v)
        var = self._opts.get("variable")
        if isinstance(var, Variable):
            var._ui_set(self.get() if not isinstance(var, DoubleVar) else self._val, self)
        cmd = self._opts.get("command")
        if callable(cmd):
            try:
                cmd(str(self.get()))
            except (SystemExit, KeyboardInterrupt):
                raise
            except Exception:
                _report()

    def _ui_command(self, ev):
        pass

    def coords(self, value=None):
        return (0, 0)

    def identify(self, x, y):
        return ""


class Listbox(Widget):
    _kind = "listbox"
    _defaults = {"height": 10, "selectmode": "browse"}

    def _init(self):
        var = self._opts.get("listvariable")
        self._items = list(var.get()) if isinstance(var, Variable) and isinstance(var.get(), (list, tuple)) else []
        self._sel = []

    def _ui_opts(self, kw):
        out = Misc._ui_opts(self, kw)
        out.pop("value", None)
        out["items"] = [str(x) for x in self._items]
        return out

    def _push(self):
        _emit(["items", self._id, [str(x) for x in self._items], self._sel])

    def _var_changed(self, var):
        v = var.get()
        self._items = list(v) if isinstance(v, (list, tuple)) else str(v).split()
        self._push()

    def _i(self, index):
        if index in (END, "end"):
            return len(self._items)
        if index in ("active", "anchor"):
            return self._sel[0] if self._sel else 0
        if isinstance(index, str) and index.startswith("@"):
            return 0
        return int(index)

    def insert(self, index, *elements):
        i = self._i(index)
        self._items[i:i] = list(elements)
        self._push()

    def delete(self, first, last=None):
        i = self._i(first)
        j = i + 1 if last is None else self._i(last) + (0 if last in (END, "end") else 1)
        del self._items[i:j]
        self._sel = [s for s in self._sel if s < len(self._items)]
        self._push()

    def get(self, first, last=None):
        i = self._i(first)
        if last is None:
            return self._items[i] if 0 <= i < len(self._items) else ""
        j = self._i(last) + (0 if last in (END, "end") else 1)
        return tuple(self._items[i:j])

    def size(self):
        return len(self._items)

    def curselection(self):
        return tuple(self._sel)

    def selection_set(self, first, last=None):
        i = self._i(first)
        j = i if last is None else self._i(last) - (1 if last in (END, "end") else 0)
        for k in range(i, j + 1):
            if k not in self._sel and 0 <= k < len(self._items):
                self._sel.append(k)
        self._sel.sort()
        _emit(["sel", self._id, self._sel])

    select_set = selection_set

    def selection_clear(self, first, last=None):
        self._sel = []
        _emit(["sel", self._id, self._sel])

    select_clear = selection_clear

    def selection_includes(self, index):
        return self._i(index) in self._sel

    select_includes = selection_includes

    def selection_anchor(self, index):
        pass

    select_anchor = selection_anchor

    def activate(self, index):
        pass

    def see(self, index):
        pass

    def index(self, index):
        return self._i(index)

    def nearest(self, y):
        return 0

    def itemconfigure(self, index, cnf=None, **kw):
        pass

    itemconfig = itemconfigure

    def itemcget(self, index, option):
        return ""

    def xview(self, *args):
        pass

    def yview(self, *args):
        pass

    def _ui_value(self, v, ev):
        self._sel = [int(x) for x in (v or [])]
        e = Event(type="Virtual", widget=self)
        _dispatch(self, "Virtual", "ListboxSelect", frozenset(), 1, e)


class Scrollbar(Widget):
    _kind = "scrollbar"

    def set(self, first, last):
        pass

    def get(self):
        return (0.0, 1.0)

    def activate(self, index=None):
        pass

    def delta(self, deltax, deltay):
        return 0.0

    def fraction(self, x, y):
        return 0.0

    def identify(self, x, y):
        return ""


class Menu(Widget):
    _kind = "menu"

    def _init(self):
        self._entries = []

    def _push(self):
        _emit(["menuitems", self._id, [self._entry_ui(e) for e in self._entries]])

    def _entry_ui(self, e):
        out = {"type": e["type"], "label": str(e.get("label", "")), "accel": str(e.get("accelerator", "")), "state": e.get("state", "normal")}
        if e["type"] == "cascade" and e.get("menu") is not None:
            out["menu"] = e["menu"]._id
            e["menu"]._push()
        if e["type"] in ("command", "checkbutton", "radiobutton"):
            out["item"] = e["item"]
        if e["type"] == "checkbutton":
            v = e.get("variable")
            out["checked"] = bool(v and str(v._value) == str(e.get("onvalue", 1)))
        if e["type"] == "radiobutton":
            v = e.get("variable")
            out["checked"] = bool(v and str(v._value) == str(e.get("value", e.get("label"))))
        return out

    def add(self, itemType, cnf={}, **kw):
        e = dict(cnf, **kw)
        e["type"] = itemType
        _S["ids"] += 1
        e["item"] = _S["ids"]
        menu = self

        def run(e=e):
            if e["type"] == "checkbutton":
                v = e.setdefault("variable", IntVar(value=0))
                v.set(e.get("offvalue", 0) if str(v._value) == str(e.get("onvalue", 1)) else e.get("onvalue", 1))
                menu._push()
            elif e["type"] == "radiobutton" and e.get("variable") is not None:
                e["variable"].set(e.get("value", e.get("label")))
                menu._push()
            cmd = e.get("command")
            if callable(cmd):
                try:
                    cmd()
                except (SystemExit, KeyboardInterrupt):
                    raise
                except Exception:
                    _report()
        _S["menus"][e["item"]] = run
        self._entries.append(e)
        self._push()

    def add_command(self, cnf={}, **kw):
        self.add("command", cnf, **kw)

    def add_cascade(self, cnf={}, **kw):
        self.add("cascade", cnf, **kw)

    def add_checkbutton(self, cnf={}, **kw):
        self.add("checkbutton", cnf, **kw)

    def add_radiobutton(self, cnf={}, **kw):
        self.add("radiobutton", cnf, **kw)

    def add_separator(self, cnf={}, **kw):
        self.add("separator", cnf, **kw)

    def insert(self, index, itemType, cnf={}, **kw):
        self.add(itemType, cnf, **kw)
        e = self._entries.pop()
        self._entries.insert(self._mi(index), e)
        self._push()

    def insert_command(self, index, cnf={}, **kw):
        self.insert(index, "command", cnf, **kw)

    def insert_separator(self, index, cnf={}, **kw):
        self.insert(index, "separator", cnf, **kw)

    def insert_cascade(self, index, cnf={}, **kw):
        self.insert(index, "cascade", cnf, **kw)

    def _mi(self, index):
        if index in (END, "end", "last"):
            return len(self._entries)
        if isinstance(index, int):
            return index
        for i, e in enumerate(self._entries):
            if e.get("label") == index:
                return i
        try:
            return int(index)
        except (TypeError, ValueError):
            return len(self._entries)

    def delete(self, index1, index2=None):
        i = self._mi(index1)
        j = i + 1 if index2 is None else self._mi(index2) + 1
        del self._entries[i:j]
        self._push()

    def entryconfigure(self, index, cnf=None, **kw):
        i = self._mi(index)
        if 0 <= i < len(self._entries):
            self._entries[i].update(dict(cnf or {}, **kw))
            self._push()

    entryconfig = entryconfigure

    def entrycget(self, index, option):
        i = self._mi(index)
        return self._entries[i].get(option, "") if 0 <= i < len(self._entries) else ""

    def index(self, index):
        return self._mi(index)

    def invoke(self, index):
        i = self._mi(index)
        if 0 <= i < len(self._entries):
            fn = _S["menus"].get(self._entries[i]["item"])
            if fn:
                fn()

    def post(self, x, y):
        _emit(["popup", self._id, int(x), int(y)])

    def tk_popup(self, x, y, entry=""):
        self.post(x, y)

    def unpost(self):
        pass

    def type(self, index):
        i = self._mi(index)
        return self._entries[i]["type"] if 0 <= i < len(self._entries) else ""


class Menubutton(Widget):
    _kind = "menubutton"


class OptionMenu(Menubutton):
    _kind = "optionmenu"

    def __init__(self, master, variable, value, *values, **kwargs):
        self._var = variable
        self._values = [value] + list(values)
        self._cmd = kwargs.pop("command", None)
        Widget.__init__(self, master, textvariable=variable, **kwargs)

    def _ui_opts(self, kw):
        out = Misc._ui_opts(self, kw)
        out["values"] = [str(v) for v in getattr(self, "_values", [])]
        return out

    def _var_changed(self, var):
        _emit(["val", self._id, str(var.get())])

    def _ui_value(self, v, ev):
        self._var._ui_set(v, self)
        if callable(self._cmd):
            try:
                self._cmd(v)
            except (SystemExit, KeyboardInterrupt):
                raise
            except Exception:
                _report()

    def __getitem__(self, name):
        if name == "menu":
            return _OptMenu(self)
        return Widget.__getitem__(self, name)


class _OptMenu:
    def __init__(self, om):
        self.om = om

    def delete(self, first, last=None):
        self.om._values = []
        _emit(["cfg", self.om._id, {"values": []}])

    def add_command(self, label=None, command=None, **kw):
        self.om._values.append(label)
        _emit(["cfg", self.om._id, {"values": [str(v) for v in self.om._values]}])


class PanedWindow(Widget):
    _kind = "frame"

    def add(self, child, **kw):
        child.pack(side=LEFT if str(self._opts.get("orient", "horizontal")).startswith("h") else TOP, fill=BOTH, expand=True)

    def panes(self):
        return self.winfo_children()


# ============================================================
# キャンバス
# ============================================================
def _flat(args):
    out = []
    for a in args:
        if isinstance(a, (list, tuple)):
            out.extend(_flat(a))
        else:
            out.append(float(a))
    return out


class Canvas(Widget):
    _kind = "canvas"
    _defaults = {"width": 378, "height": 265, "bg": "#ffffff"}

    def _init(self):
        self._items = {}
        self._order = []
        self._next = 0
        self._ibinds = {}
        self._hover = None

    # ---- 作る ----
    def _create(self, kind, args, kw):
        coords = _flat(args)
        self._next += 1
        i = self._next
        tags = kw.pop("tags", kw.pop("tag", ()))
        if isinstance(tags, str):
            tags = tags.split()
        self._items[i] = {"type": kind, "coords": coords, "opts": dict(kw), "tags": list(tags)}
        self._order.append(i)
        _emit(["cv", self._id, "new", i, kind, coords, self._item_ui(kind, kw)])
        return i

    def _item_ui(self, kind, kw):
        out = {}
        for k, v in kw.items():
            if k in ("fill", "outline", "activefill", "activeoutline", "disabledfill"):
                out[k] = _color(v) if v != "" else ""
            elif k == "font":
                out[k] = _font(v)
            elif k == "image":
                out[k] = getattr(v, "_iid", None)
            elif k == "window":
                out[k] = getattr(v, "_id", None)
            elif k == "dash":
                out[k] = list(v) if isinstance(v, (list, tuple)) else [int(x) for x in str(v).split()] if str(v).strip() and str(v)[0].isdigit() else [4, 4]
            elif isinstance(v, (str, int, float, bool)) or v is None:
                out[k] = v
        return out

    def create_line(self, *args, **kw):
        return self._create("line", args, kw)

    def create_rectangle(self, *args, **kw):
        return self._create("rectangle", args, kw)

    def create_oval(self, *args, **kw):
        return self._create("oval", args, kw)

    def create_polygon(self, *args, **kw):
        kw.setdefault("fill", "black")
        return self._create("polygon", args, kw)

    def create_arc(self, *args, **kw):
        return self._create("arc", args, kw)

    def create_text(self, *args, **kw):
        kw.setdefault("fill", "black")
        if "text" in kw:
            kw["text"] = str(kw["text"])
        return self._create("text", args, kw)

    def create_image(self, *args, **kw):
        return self._create("image", args, kw)

    def create_bitmap(self, *args, **kw):
        return self._create("text", args, {"text": ""})

    def create_window(self, *args, **kw):
        return self._create("window", args, kw)

    # ---- 探す ----
    def _find(self, tagOrId):
        if tagOrId in (ALL, "all"):
            return list(self._order)
        if isinstance(tagOrId, int) or (isinstance(tagOrId, str) and tagOrId.isdigit()):
            i = int(tagOrId)
            return [i] if i in self._items else []
        if tagOrId == "current":
            return [self._hover] if self._hover in self._items else []
        return [i for i in self._order if tagOrId in self._items[i]["tags"]]

    def find_withtag(self, tagOrId):
        return tuple(self._find(tagOrId))

    def find_all(self):
        return tuple(self._order)

    def _bbox_of(self, i):
        it = self._items[i]
        c = it["coords"]
        if not c:
            return None
        if it["type"] == "text":
            text = str(it["opts"].get("text", ""))
            size = 13
            f = it["opts"].get("font")
            if f:
                m = _re.search(r"(\d+)px", _font(f) or "")
                size = int(m.group(1)) if m else 13
            lines = text.split("\n")
            w = max((len(l) for l in lines), default=0) * size * 0.6
            h = len(lines) * size * 1.25
            anchor = str(it["opts"].get("anchor", "center"))
            x, y = c[0], c[1]
            x0 = x - w / 2 if "w" not in anchor and "e" not in anchor else (x if "w" in anchor else x - w)
            y0 = y - h / 2 if "n" not in anchor and "s" not in anchor else (y if "n" in anchor else y - h)
            return (x0, y0, x0 + w, y0 + h)
        if it["type"] in ("image", "window"):
            img = it["opts"].get("image")
            w, h = (img.width(), img.height()) if img is not None and hasattr(img, "width") else (20, 20)
            anchor = str(it["opts"].get("anchor", "center"))
            x, y = c[0], c[1]
            x0 = x - w / 2 if "w" not in anchor and "e" not in anchor else (x if "w" in anchor else x - w)
            y0 = y - h / 2 if "n" not in anchor and "s" not in anchor else (y if "n" in anchor else y - h)
            return (x0, y0, x0 + w, y0 + h)
        xs, ys = c[0::2], c[1::2]
        pad = float(it["opts"].get("width", 1) or 1) / 2
        return (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)

    def bbox(self, *args):
        boxes = [self._bbox_of(i) for a in args for i in self._find(a)]
        boxes = [b for b in boxes if b]
        if not boxes:
            return None
        return (int(min(b[0] for b in boxes)), int(min(b[1] for b in boxes)), int(round(max(b[2] for b in boxes))), int(round(max(b[3] for b in boxes))))

    def find_overlapping(self, x1, y1, x2, y2):
        out = []
        for i in self._order:
            b = self._bbox_of(i)
            if b and b[0] <= x2 and x1 <= b[2] and b[1] <= y2 and y1 <= b[3] and self._items[i]["opts"].get("state") != "hidden":
                out.append(i)
        return tuple(out)

    def find_enclosed(self, x1, y1, x2, y2):
        out = []
        for i in self._order:
            b = self._bbox_of(i)
            if b and x1 <= b[0] and b[2] <= x2 and y1 <= b[1] and b[3] <= y2:
                out.append(i)
        return tuple(out)

    def find_closest(self, x, y, halo=None, start=None):
        best, bd = None, None
        for i in reversed(self._order):
            b = self._bbox_of(i)
            if not b:
                continue
            dx = max(b[0] - x, 0, x - b[2])
            dy = max(b[1] - y, 0, y - b[3])
            d = dx * dx + dy * dy
            if bd is None or d < bd:
                best, bd = i, d
        return (best,) if best is not None else ()

    def find_above(self, tagOrId):
        ids = self._find(tagOrId)
        if not ids:
            return ()
        k = self._order.index(ids[-1])
        return (self._order[k + 1],) if k + 1 < len(self._order) else ()

    def find_below(self, tagOrId):
        ids = self._find(tagOrId)
        if not ids:
            return ()
        k = self._order.index(ids[0])
        return (self._order[k - 1],) if k > 0 else ()

    def _hit(self, x, y):
        for i in reversed(self._order):
            it = self._items[i]
            if it["opts"].get("state") == "hidden":
                continue
            b = self._bbox_of(i)
            if b and b[0] <= x <= b[2] and b[1] <= y <= b[3]:
                if it["type"] == "line" and len(it["coords"]) >= 4:
                    c = it["coords"]
                    w = max(3.0, float(it["opts"].get("width", 1) or 1))
                    for k in range(0, len(c) - 2, 2):
                        if _seg_dist(x, y, c[k], c[k + 1], c[k + 2], c[k + 3]) <= w:
                            return i
                    continue
                return i
        return None

    # ---- 変える ----
    def coords(self, tagOrId, *args):
        ids = self._find(tagOrId)
        if not args:
            return [float(v) for v in self._items[ids[0]]["coords"]] if ids else []
        c = _flat(args)
        for i in ids[:1]:
            self._items[i]["coords"] = c
            _emit(["cv", self._id, "xy", i, c])

    def move(self, tagOrId, xAmount, yAmount):
        dx, dy = float(xAmount), float(yAmount)
        for i in self._find(tagOrId):
            c = self._items[i]["coords"]
            self._items[i]["coords"] = [v + (dx if k % 2 == 0 else dy) for k, v in enumerate(c)]
            _emit(["cv", self._id, "xy", i, self._items[i]["coords"]])

    def moveto(self, tagOrId, x="", y=""):
        b = self.bbox(tagOrId)
        if not b:
            return
        dx = float(x) - b[0] if x != "" else 0
        dy = float(y) - b[1] if y != "" else 0
        self.move(tagOrId, dx, dy)

    def delete(self, *args):
        gone = []
        for a in args:
            for i in self._find(a):
                if i in self._items:
                    del self._items[i]
                    self._order.remove(i)
                    gone.append(i)
        if gone:
            _emit(["cv", self._id, "del", gone])

    def itemconfigure(self, tagOrId, cnf=None, **kw):
        kw = dict(cnf or {}, **kw)
        ids = self._find(tagOrId)
        if not kw:
            return {k: (k, "", "", "", v) for k, v in self._items[ids[0]]["opts"].items()} if ids else {}
        if "text" in kw:
            kw["text"] = str(kw["text"])
        tags = kw.pop("tags", None)
        for i in ids:
            self._items[i]["opts"].update(kw)
            if tags is not None:
                self._items[i]["tags"] = tags.split() if isinstance(tags, str) else list(tags)
            _emit(["cv", self._id, "cfg", i, self._item_ui(self._items[i]["type"], kw)])

    itemconfig = itemconfigure

    def itemcget(self, tagOrId, option):
        ids = self._find(tagOrId)
        return self._items[ids[0]]["opts"].get(option, "") if ids else ""

    def type(self, tagOrId):
        ids = self._find(tagOrId)
        return self._items[ids[0]]["type"] if ids else None

    def gettags(self, tagOrId):
        ids = self._find(tagOrId)
        return tuple(self._items[ids[0]]["tags"]) if ids else ()

    def addtag_withtag(self, newtag, tagOrId):
        for i in self._find(tagOrId):
            if newtag not in self._items[i]["tags"]:
                self._items[i]["tags"].append(newtag)

    def addtag_all(self, newtag):
        self.addtag_withtag(newtag, "all")

    def addtag_overlapping(self, newtag, x1, y1, x2, y2):
        for i in self.find_overlapping(x1, y1, x2, y2):
            self.addtag_withtag(newtag, i)

    def addtag_closest(self, newtag, x, y, halo=None, start=None):
        for i in self.find_closest(x, y):
            self.addtag_withtag(newtag, i)

    def dtag(self, tagOrId, tagToDelete=None):
        for i in self._find(tagOrId):
            t = tagToDelete or tagOrId
            if t in self._items[i]["tags"]:
                self._items[i]["tags"].remove(t)

    def tag_raise(self, tagOrId, aboveThis=None):
        ids = self._find(tagOrId)
        for i in ids:
            self._order.remove(i)
        if aboveThis is None:
            self._order.extend(ids)
        else:
            a = self._find(aboveThis)
            k = self._order.index(a[-1]) + 1 if a else len(self._order)
            self._order[k:k] = ids
        _emit(["cv", self._id, "order", list(self._order)])

    lift = tag_raise
    tkraise = tag_raise

    def tag_lower(self, tagOrId, belowThis=None):
        ids = self._find(tagOrId)
        for i in ids:
            self._order.remove(i)
        if belowThis is None:
            self._order[0:0] = ids
        else:
            b = self._find(belowThis)
            k = self._order.index(b[0]) if b else 0
            self._order[k:k] = ids
        _emit(["cv", self._id, "order", list(self._order)])

    lower = tag_lower

    def tag_bind(self, tagOrId, sequence=None, func=None, add=None):
        key = _parse_seq(sequence)
        tb = self._ibinds.setdefault(str(tagOrId), {})
        if add:
            tb.setdefault(key, []).append(func)
        else:
            tb[key] = [func]
        cats = set(_cats(self._binds))
        for b in self._ibinds.values():
            cats |= set(_cats(b))
        cats.add("move")
        _emit(["bind", self._id, sorted(cats)])

    def tag_unbind(self, tagOrId, sequence, funcid=None):
        self._ibinds.get(str(tagOrId), {}).pop(_parse_seq(sequence), None)

    def _item_event(self, kind, b, mods, count, e):
        if not self._ibinds:
            return
        hit = self._hit(e.x, e.y)
        if kind == "Motion" and hit != self._hover:
            old, self._hover = self._hover, hit
            if old is not None and old in self._items:
                self._fire_item(old, "Leave", None, frozenset(), 1, e)
            if hit is not None:
                self._fire_item(hit, "Enter", None, frozenset(), 1, e)
        if hit is None:
            return
        self._hover = hit
        self._fire_item(hit, kind, b if kind.startswith("Button") else None, mods, count, e)

    def _fire_item(self, i, kind, detail, mods, count, e):
        keys = [str(i)] + list(self._items.get(i, {}).get("tags", [])) + ["all"]
        for k in keys:
            binds = self._ibinds.get(k)
            if binds:
                f = _match(binds, kind, detail, mods, count)
                if f:
                    _call_bound(f, e)

    def canvasx(self, screenx, gridspacing=None):
        return float(screenx)

    def canvasy(self, screeny, gridspacing=None):
        return float(screeny)

    def xview(self, *args):
        pass

    def yview(self, *args):
        pass

    xview_moveto = xview
    yview_moveto = yview
    xview_scroll = xview
    yview_scroll = yview

    def scan_mark(self, x, y):
        pass

    def scan_dragto(self, x, y, gain=10):
        pass

    def postscript(self, cnf={}, **kw):
        return ""

    def select_clear(self):
        pass

    def focus(self, *args):
        return ""

    def icursor(self, *args):
        pass

    def index(self, tagOrId, index):
        return 0

    def dchars(self, tagOrId, first, last=None):
        pass

    def scale(self, tagOrId, xOrigin, yOrigin, xScale, yScale):
        xo, yo, xs, ys = float(xOrigin), float(yOrigin), float(xScale), float(yScale)
        for i in self._find(tagOrId):
            c = self._items[i]["coords"]
            self._items[i]["coords"] = [(xo + (v - xo) * xs) if k % 2 == 0 else (yo + (v - yo) * ys) for k, v in enumerate(c)]
            _emit(["cv", self._id, "xy", i, self._items[i]["coords"]])


def _seg_dist(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return ((px - x1) ** 2 + (py - y1) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    return ((px - x1 - t * dx) ** 2 + (py - y1 - t * dy) ** 2) ** 0.5


# ============================================================
# 画像
# ============================================================
class Image:
    def __init__(self, imgtype="photo", name=None, cnf={}, master=None, **kw):
        _S["imgs"] += 1
        self._iid = name or "pyimage%d" % _S["imgs"]
        self.name = self._iid
        self._w = self._h = 0
        kw = dict(cnf, **kw)
        data = None
        f = kw.get("file")
        if f:
            with open(f, "rb") as fh:
                data = fh.read()
        elif kw.get("data"):
            d = kw["data"]
            if isinstance(d, str):
                import base64
                try:
                    data = base64.b64decode(d)
                except Exception:
                    data = d.encode()
            else:
                data = bytes(d)
        if data:
            r = _fc.rpc("imgreg", {"id": self._iid}, data)
            self._w, self._h = int(r.w), int(r.h)
        else:
            self._w = int(kw.get("width", 0) or 0)
            self._h = int(kw.get("height", 0) or 0)
            _fc.rpc("imgreg", {"id": self._iid, "w": self._w, "h": self._h})

    def __str__(self):
        return self._iid

    def width(self):
        return self._w

    def height(self):
        return self._h

    def type(self):
        return "photo"

    def configure(self, **kw):
        pass

    config = configure

    def cget(self, key):
        return ""

    def __getitem__(self, key):
        return ""


class PhotoImage(Image):
    def __init__(self, name=None, cnf={}, master=None, **kw):
        Image.__init__(self, "photo", name, cnf, master, **kw)

    def blank(self):
        _emit(["img", "blank", self._iid])

    def copy(self):
        p = PhotoImage(width=self._w, height=self._h)
        _emit(["img", "copy", p._iid, self._iid, 1, 1])
        return p

    def zoom(self, x, y=""):
        y = x if y == "" else y
        p = PhotoImage(width=self._w * int(x), height=self._h * int(y))
        _emit(["img", "copy", p._iid, self._iid, int(x), int(y)])
        return p

    def subsample(self, x, y=""):
        y = x if y == "" else y
        p = PhotoImage(width=max(1, self._w // int(x)), height=max(1, self._h // int(y)))
        _emit(["img", "copy", p._iid, self._iid, 1 / int(x), 1 / int(y)])
        return p

    def put(self, data, to=None):
        if isinstance(data, str):
            color = _color(data.strip("{} ")) if not data.strip().startswith("{") or len(data.split()) == 1 else _color(data.strip("{} ").split()[0])
            if to is None:
                to = (0, 0, self._w, self._h)
            to = list(to)
            if len(to) == 2:
                to = [to[0], to[1], to[0] + 1, to[1] + 1]
            _emit(["img", "put", self._iid, color, to])
        else:
            rows = list(data)
            for y, row in enumerate(rows):
                cols = row.split() if isinstance(row, str) else list(row)
                for x, c in enumerate(cols):
                    _emit(["img", "put", self._iid, _color(str(c).strip("{}")), [x, y, x + 1, y + 1]])

    def get(self, x, y):
        return (0, 0, 0)

    def write(self, filename, format=None, from_coords=None):
        pass

    def transparency_get(self, x, y):
        return False

    def transparency_set(self, x, y, boolean):
        pass


class BitmapImage(Image):
    def __init__(self, name=None, cnf={}, master=None, **kw):
        _S["imgs"] += 1
        self._iid = name or "pyimage%d" % _S["imgs"]
        self.name = self._iid
        self._w = self._h = 16


def image_names():
    return ()


def image_types():
    return ("photo", "bitmap")


# ============================================================
# よく使う別名
# ============================================================
class Studbutton(Button):
    pass


class Tributton(Button):
    pass


class CallWrapper:
    def __init__(self, func, subst, widget):
        self.func = func

    def __call__(self, *args):
        return self.func(*args)


def _test():
    root = Tk()
    Label(root, text="This is Tcl/Tk version %s" % TclVersion).pack()
    Button(root, text="Click me!").pack()
    Button(root, text="QUIT", command=root.destroy).pack()
    root.mainloop()


__all__ = [n for n in dir() if not n.startswith("_") and n not in ("TYPE_CHECKING",)]
`

const TTK = String.raw`"""tkinter.ttk (ForgeCode 互換版)"""
import tkinter as _tk
from tkinter import (Widget, Frame as _F, LabelFrame as _LF, Label as _L, Button as _B, Entry as _E, Checkbutton as _C, Radiobutton as _R,
                     Scale as _S, Scrollbar as _SB, Spinbox as _SP, Menubutton as _MB, OptionMenu as _OM, PanedWindow as _PW, Misc, Variable,
                     StringVar, _emit, _dispatch, Event, _report)
from tkinter.constants import *

__all__ = ["Button", "Checkbutton", "Combobox", "Entry", "Frame", "Label", "Labelframe", "LabelFrame", "Menubutton", "Notebook", "Panedwindow",
           "PanedWindow", "Progressbar", "Radiobutton", "Scale", "Scrollbar", "Separator", "Sizegrip", "Spinbox", "Style", "Treeview",
           "LabeledScale", "OptionMenu", "tclobjs_to_py", "setup_master"]


class _TtkMixin:
    _ttk = True

    def state(self, statespec=None):
        if statespec is None:
            return ("disabled",) if self._opts.get("state") == "disabled" else ()
        spec = list(statespec) if not isinstance(statespec, str) else statespec.split()
        if "disabled" in spec:
            self.configure(state="disabled")
        elif "!disabled" in spec:
            self.configure(state="normal")
        if "readonly" in spec:
            self.configure(state="readonly")
        return ()

    def instate(self, statespec, callback=None, *args, **kw):
        spec = list(statespec) if not isinstance(statespec, str) else statespec.split()
        dis = self._opts.get("state") == "disabled"
        ok = all((s == "disabled" and dis) or (s == "!disabled" and not dis) for s in spec if s in ("disabled", "!disabled"))
        if ok and callback:
            return callback(*args, **kw)
        return ok

    def identify(self, x, y):
        return ""


def _ttk_opts(kw):
    kw = dict(kw)
    kw.pop("style", None)
    kw.pop("bootstyle", None)
    return kw


def _mk(base, kind=None):
    class W(_TtkMixin, base):
        def __init__(self, master=None, **kw):
            base.__init__(self, master, **_ttk_opts(kw))
    W.__name__ = base.__name__
    if kind:
        W._kind = kind
    return W


Frame = _mk(_F)
Label = _mk(_L)
Button = _mk(_B)
Entry = _mk(_E)
Checkbutton = _mk(_C)
Radiobutton = _mk(_R)
Scrollbar = _mk(_SB)
Spinbox = _mk(_SP)
Menubutton = _mk(_MB)
LabelFrame = Labelframe = _mk(_LF)
PanedWindow = Panedwindow = _mk(_PW)


class Scale(_TtkMixin, _S):
    _defaults = {"from": 0, "to": 100, "orient": "horizontal", "resolution": 0}

    def __init__(self, master=None, **kw):
        _S.__init__(self, master, **_ttk_opts(kw))

    def get(self, x=None, y=None):
        return self._val


class Combobox(_TtkMixin, _E):
    _kind = "combobox"

    def __init__(self, master=None, **kw):
        _E.__init__(self, master, **_ttk_opts(kw))

    def _ui_opts(self, kw):
        out = Misc._ui_opts(self, kw)
        if "values" in kw:
            v = kw["values"]
            out["values"] = [str(x) for x in (v.split() if isinstance(v, str) else v)]
        return out

    def current(self, newindex=None):
        vals = self._opts.get("values") or ()
        vals = list(vals.split() if isinstance(vals, str) else vals)
        if newindex is None:
            return vals.index(self._text) if self._text in vals else -1
        self.set(vals[int(newindex)])

    def set(self, value):
        self._set_text(str(value))

    def _ui_value(self, v, ev):
        _E._ui_value(self, v, ev)
        if ev.get("sel"):
            e = Event(type="Virtual", widget=self)
            _dispatch(self, "Virtual", "ComboboxSelected", frozenset(), 1, e)


class Progressbar(_TtkMixin, Widget):
    _kind = "progressbar"
    _defaults = {"maximum": 100, "value": 0, "mode": "determinate", "orient": "horizontal", "length": 100}

    def _init(self):
        var = self._opts.get("variable")
        self._val = float(var.get()) if isinstance(var, Variable) else float(self._opts.get("value", 0))

    def _ui_opts(self, kw):
        out = Misc._ui_opts(self, kw)
        out["value"] = self._val if not isinstance(self._opts.get("variable"), Variable) else float(self._opts["variable"].get())
        return out

    def _var_changed(self, var):
        self._val = float(var.get())
        _emit(["cfg", self._id, {"value": self._val}])

    def __setitem__(self, key, value):
        if key == "value":
            self._val = float(value)
        Widget.__setitem__(self, key, value)

    def configure(self, cnf=None, **kw):
        if "value" in kw:
            self._val = float(kw["value"])
        return Widget.configure(self, cnf, **kw)

    config = configure

    def cget(self, key):
        if key == "value":
            return self._val
        return Widget.cget(self, key)

    def step(self, amount=1.0):
        m = float(self._opts.get("maximum", 100))
        self._val = (self._val + amount) % m if m else 0
        _emit(["cfg", self._id, {"value": self._val}])

    def start(self, interval=None):
        _emit(["cfg", self._id, {"running": True}])

    def stop(self):
        _emit(["cfg", self._id, {"running": False}])


class Separator(_TtkMixin, Widget):
    _kind = "separator"


class Sizegrip(_TtkMixin, Widget):
    _kind = "frame"


class Notebook(_TtkMixin, Widget):
    _kind = "notebook"

    def _init(self):
        self._tabs = []
        self._cur = 0

    def _push(self):
        _emit(["tabs", self._id, [[c._id, str(o.get("text", ""))] for c, o in self._tabs], self._cur])

    def add(self, child, **kw):
        for i, (c, o) in enumerate(self._tabs):
            if c is child:
                o.update(kw)
                self._push()
                return
        self._tabs.append((child, dict(kw)))
        _emit(["geo", child._id, "tab", {}])
        child._geo = ("tab", {})
        self._push()

    def insert(self, pos, child, **kw):
        self.add(child, **kw)
        t = self._tabs.pop()
        self._tabs.insert(self.index(pos) if pos != "end" else len(self._tabs), t)
        self._push()

    def forget(self, tab_id):
        i = self.index(tab_id)
        self._tabs.pop(i)
        self._cur = min(self._cur, max(0, len(self._tabs) - 1))
        self._push()

    def hide(self, tab_id):
        self.forget(tab_id)

    def index(self, tab_id):
        if tab_id in ("end", END):
            return len(self._tabs)
        if tab_id == "current":
            return self._cur
        if isinstance(tab_id, int):
            return tab_id
        for i, (c, o) in enumerate(self._tabs):
            if c is tab_id or str(c) == str(tab_id):
                return i
        raise _tk.TclError("Tab not found")

    def select(self, tab_id=None):
        if tab_id is None:
            return str(self._tabs[self._cur][0]) if self._tabs else ""
        self._cur = self.index(tab_id)
        self._push()

    def tab(self, tab_id, option=None, **kw):
        i = self.index(tab_id)
        c, o = self._tabs[i]
        if kw:
            o.update(kw)
            self._push()
            return None
        if option:
            return o.get(option, "")
        return dict(o)

    def tabs(self):
        return tuple(str(c) for c, o in self._tabs)

    def enable_traversal(self):
        pass

    def _ui_value(self, v, ev):
        self._cur = int(v)
        e = Event(type="Virtual", widget=self)
        _dispatch(self, "Virtual", "NotebookTabChanged", frozenset(), 1, e)


class Treeview(_TtkMixin, Widget):
    _kind = "treeview"

    def _init(self):
        self._rows = {}
        self._kids = {"": []}
        self._n = 0
        self._sel = []
        cols = self._opts.get("columns", ())
        self._columns = list(cols.split() if isinstance(cols, str) else cols)
        self._heads = {}

    def _ui_opts(self, kw):
        out = Misc._ui_opts(self, kw)
        out["columns"] = [str(c) for c in getattr(self, "_columns", [])]
        return out

    def _push(self):
        rows = []

        def walk(parent, depth):
            for iid in self._kids.get(parent, []):
                r = self._rows[iid]
                rows.append([iid, depth, str(r.get("text", "")), [str(v) for v in r.get("values", ())], bool(self._kids.get(iid))])
                if r.get("open", True):
                    walk(iid, depth + 1)
        walk("", 0)
        show = self._opts.get("show", "tree headings")
        heads = [[str(c), str(self._heads.get(c, {}).get("text", c))] for c in ["#0"] + self._columns]
        _emit(["tree", self._id, {"rows": rows, "heads": heads, "show": str(show), "sel": self._sel}])

    def insert(self, parent, index, iid=None, **kw):
        if iid is None:
            self._n += 1
            iid = "I%03X" % self._n
        self._rows[iid] = dict(kw)
        self._kids.setdefault(iid, [])
        kids = self._kids.setdefault(parent, [])
        pos = len(kids) if index in ("end", END) else int(index)
        kids.insert(pos, iid)
        self._rows[iid]["_parent"] = parent
        self._push()
        return iid

    def delete(self, *items):
        for iid in items:
            if iid in self._rows:
                p = self._rows[iid].get("_parent", "")
                if iid in self._kids.get(p, []):
                    self._kids[p].remove(iid)
                for k in list(self._kids.get(iid, [])):
                    self.delete(k)
                self._rows.pop(iid, None)
                self._kids.pop(iid, None)
        self._sel = [s for s in self._sel if s in self._rows]
        self._push()

    def detach(self, *items):
        self.delete(*items)

    def get_children(self, item=None):
        return tuple(self._kids.get(item or "", []))

    def set_children(self, item, *newchildren):
        self._kids[item] = list(newchildren)
        self._push()

    def item(self, item, option=None, **kw):
        r = self._rows[item]
        if kw:
            r.update(kw)
            self._push()
            return None
        d = {"text": r.get("text", ""), "image": "", "values": list(r.get("values", ())) or "", "open": r.get("open", False), "tags": r.get("tags", "")}
        return d[option] if option else d

    def set(self, item, column=None, value=None):
        r = self._rows[item]
        vals = list(r.get("values", ()))
        if column is None:
            return {c: (vals[i] if i < len(vals) else "") for i, c in enumerate(self._columns)}
        ci = self._columns.index(column) if column in self._columns else int(str(column).lstrip("#")) - 1
        if value is None:
            return vals[ci] if ci < len(vals) else ""
        while len(vals) <= ci:
            vals.append("")
        vals[ci] = value
        r["values"] = vals
        self._push()

    def heading(self, column, option=None, **kw):
        h = self._heads.setdefault(column, {})
        if kw:
            h.update(kw)
            self._push()
            return None
        return h.get(option, "") if option else dict(h)

    def column(self, column, option=None, **kw):
        return {} if option is None else ""

    def selection(self, *a):
        return tuple(self._sel)

    def selection_set(self, *items):
        items = items[0] if len(items) == 1 and isinstance(items[0], (list, tuple)) else items
        self._sel = [i for i in items if i in self._rows]
        self._push()

    def selection_add(self, *items):
        self.selection_set(*(list(self._sel) + list(items)))

    def selection_remove(self, *items):
        self._sel = [s for s in self._sel if s not in items]
        self._push()

    def focus(self, item=None):
        if item is None:
            return self._sel[0] if self._sel else ""
        self._sel = [item]
        self._push()

    def parent(self, item):
        return self._rows.get(item, {}).get("_parent", "")

    def index(self, item):
        p = self.parent(item)
        return self._kids.get(p, []).index(item)

    def exists(self, item):
        return item in self._rows

    def see(self, item):
        pass

    def move(self, item, parent, index):
        old = self.parent(item)
        if item in self._kids.get(old, []):
            self._kids[old].remove(item)
        kids = self._kids.setdefault(parent, [])
        kids.insert(len(kids) if index in ("end", END) else int(index), item)
        self._rows[item]["_parent"] = parent
        self._push()

    reattach = move

    def next(self, item):
        kids = self._kids.get(self.parent(item), [])
        i = kids.index(item)
        return kids[i + 1] if i + 1 < len(kids) else ""

    def prev(self, item):
        kids = self._kids.get(self.parent(item), [])
        i = kids.index(item)
        return kids[i - 1] if i > 0 else ""

    def tag_configure(self, tagname, option=None, **kw):
        pass

    def tag_bind(self, tagname, sequence=None, callback=None):
        self.bind(sequence, callback)

    def identify_row(self, y):
        return self._sel[0] if self._sel else ""

    def identify_column(self, x):
        return "#0"

    def bbox(self, item, column=None):
        return ""

    def xview(self, *a):
        pass

    def yview(self, *a):
        pass

    def _ui_value(self, v, ev):
        self._sel = [x for x in (v or []) if x in self._rows]
        e = Event(type="Virtual", widget=self)
        _dispatch(self, "Virtual", "TreeviewSelect", frozenset(), 1, e)


class OptionMenu(_TtkMixin, _OM):
    def __init__(self, master, variable, default=None, *values, **kw):
        kw.pop("style", None)
        vals = list(values) or ([default] if default is not None else [])
        if default is not None:
            variable.set(default)
        _OM.__init__(self, master, variable, *(vals or [""]), **kw)


class LabeledScale(Frame):
    def __init__(self, master=None, variable=None, from_=0, to=10, **kw):
        Frame.__init__(self, master)
        self.scale = Scale(self, variable=variable, from_=from_, to=to)
        self.scale.pack(fill="x")
        self.label = Label(self)
        self.label.pack()


class Style:
    def __init__(self, master=None):
        pass

    def configure(self, style, query_opt=None, **kw):
        return {}

    def map(self, style, query_opt=None, **kw):
        return {}

    def lookup(self, style, option, state=None, default=None):
        return default or ""

    def layout(self, style, layoutspec=None):
        return []

    def element_create(self, *a, **k):
        pass

    def element_names(self):
        return ()

    def element_options(self, name):
        return ()

    def theme_create(self, *a, **k):
        pass

    def theme_settings(self, *a, **k):
        pass

    def theme_names(self):
        return ("clam", "alt", "default", "classic")

    def theme_use(self, themename=None):
        return "clam" if themename is None else None


def tclobjs_to_py(adict):
    return adict


def setup_master(master=None):
    return master or _tk._get_root()
`

const DIALOGS = {
  'tkinter/messagebox.py': String.raw`"""tkinter.messagebox (画面にダイアログを出します)"""
import _forgecode as _fc

ERROR = "error"
INFO = "info"
QUESTION = "question"
WARNING = "warning"
ABORTRETRYIGNORE = "abortretryignore"
OK = "ok"
OKCANCEL = "okcancel"
RETRYCANCEL = "retrycancel"
YESNO = "yesno"
YESNOCANCEL = "yesnocancel"
ABORT = "abort"
RETRY = "retry"
IGNORE = "ignore"
CANCEL = "cancel"
YES = "yes"
NO = "no"


def _show(kind, title, message, icon, **options):
    import json
    try:
        import tkinter
        tkinter._flush()
    except Exception:
        pass
    detail = options.get("detail")
    msg = str(message or "") + ("\n\n" + str(detail) if detail else "")
    r = _fc.rpc("dialog", {"kind": options.get("type", kind), "title": title or "", "message": msg, "icon": options.get("icon", icon)})
    return json.loads(r.text())


def showinfo(title=None, message=None, **options):
    return _show("info", title, message, "info", **options)


def showwarning(title=None, message=None, **options):
    return _show("warning", title, message, "warning", **options)


def showerror(title=None, message=None, **options):
    return _show("error", title, message, "error", **options)


def askquestion(title=None, message=None, **options):
    return _show("yesno", title, message, "question", **options)


def askokcancel(title=None, message=None, **options):
    return _show("okcancel", title, message, "question", **options) == "ok"


def askyesno(title=None, message=None, **options):
    return _show("yesno", title, message, "question", **options) == "yes"


def askyesnocancel(title=None, message=None, **options):
    r = _show("yesnocancel", title, message, "question", **options)
    return None if r == "cancel" else r == "yes"


def askretrycancel(title=None, message=None, **options):
    return _show("retrycancel", title, message, "warning", **options) == "retry"


class Message:
    def __init__(self, master=None, **options):
        self.options = options

    def show(self, **options):
        o = dict(self.options, **options)
        return _show(o.get("type", "info"), o.get("title"), o.get("message"), o.get("icon", "info"))
`,
  'tkinter/simpledialog.py': String.raw`"""tkinter.simpledialog (文字や数を入れてもらう)"""
import json as _json
import _forgecode as _fc


def _ask(kind, title, prompt, **kw):
    try:
        import tkinter
        tkinter._flush()
    except Exception:
        pass
    r = _fc.rpc("dialog", {"kind": kind, "title": title or "", "message": prompt or "", "initial": kw.get("initialvalue"),
                           "min": kw.get("minvalue"), "max": kw.get("maxvalue"), "show": kw.get("show")})
    return _json.loads(r.text())


def askstring(title, prompt, **kw):
    return _ask("string", title, prompt, **kw)


def askinteger(title, prompt, **kw):
    return _ask("integer", title, prompt, **kw)


def askfloat(title, prompt, **kw):
    return _ask("float", title, prompt, **kw)


class Dialog:
    def __init__(self, parent, title=None):
        self.parent = parent
        self.result = None
        import tkinter
        self.top = tkinter.Toplevel(parent)
        if title:
            self.top.title(title)
        body = tkinter.Frame(self.top)
        self.initial_focus = self.body(body)
        body.pack(padx=5, pady=5)
        self.buttonbox()
        self.top.wait_window(self.top)

    def body(self, master):
        return None

    def buttonbox(self):
        import tkinter
        box = tkinter.Frame(self.top)
        tkinter.Button(box, text="OK", width=10, command=self.ok).pack(side="left", padx=5, pady=5)
        tkinter.Button(box, text="Cancel", width=10, command=self.cancel).pack(side="left", padx=5, pady=5)
        box.pack()

    def ok(self, event=None):
        if not self.validate():
            return
        self.apply()
        self.cancel()

    def cancel(self, event=None):
        self.top.destroy()

    def validate(self):
        return 1

    def apply(self):
        pass

    def destroy(self):
        self.top.destroy()
`,
  'tkinter/filedialog.py': String.raw`"""tkinter.filedialog (プロジェクトのファイルから選ぶ)"""
import os as _os
import json as _json
import _forgecode as _fc


def _files():
    out = []
    for root, dirs, files in _os.walk("."):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d != "__pycache__"]
        for f in files:
            out.append(_os.path.relpath(_os.path.join(root, f), "."))
    return sorted(out)[:500]


def _match(name, filetypes):
    if not filetypes:
        return True
    import fnmatch
    for ft in filetypes:
        pats = ft[1] if isinstance(ft, (tuple, list)) and len(ft) > 1 else ft
        for p in (pats.split() if isinstance(pats, str) else pats):
            if p in ("*", "*.*") or fnmatch.fnmatch(name.lower(), p.lower()):
                return True
    return False


def askopenfilename(**options):
    files = [f for f in _files() if _match(f, options.get("filetypes"))]
    r = _fc.rpc("dialog", {"kind": "file", "title": options.get("title") or "ファイルを開く", "message": "", "files": files})
    v = _json.loads(r.text())
    return _os.path.abspath(v) if v else ""


def askopenfilenames(**options):
    f = askopenfilename(**options)
    return (f,) if f else ()


def askopenfile(mode="r", **options):
    f = askopenfilename(**options)
    return open(f, mode) if f else None


def askopenfiles(mode="r", **options):
    f = askopenfile(mode, **options)
    return [f] if f else []


def asksaveasfilename(**options):
    init = options.get("initialfile") or ("untitled" + (options.get("defaultextension") or ".txt"))
    r = _fc.rpc("dialog", {"kind": "string", "title": options.get("title") or "名前を付けて保存", "message": "保存するファイルの名前", "initial": init})
    v = _json.loads(r.text())
    if not v:
        return ""
    ext = options.get("defaultextension")
    if ext and "." not in _os.path.basename(v):
        v += ext
    return _os.path.abspath(v)


def asksaveasfile(mode="w", **options):
    f = asksaveasfilename(**options)
    return open(f, mode) if f else None


def askdirectory(**options):
    return _os.getcwd()


class FileDialog:
    def __init__(self, master, title=None):
        self.title = title

    def go(self, dir_or_file=".", pattern="*", default="", key=None):
        return askopenfilename(title=self.title)


LoadFileDialog = SaveFileDialog = FileDialog
Open = SaveAs = Directory = FileDialog
`,
  'tkinter/colorchooser.py': String.raw`"""tkinter.colorchooser (色を選ぶ)"""
import json as _json
import _forgecode as _fc


def askcolor(color=None, **options):
    init = color if isinstance(color, str) and color.startswith("#") else None
    if isinstance(color, (tuple, list)):
        init = "#%02x%02x%02x" % tuple(int(c) for c in color[:3])
    r = _fc.rpc("dialog", {"kind": "color", "title": options.get("title") or "色を選ぶ", "message": "", "initial": init})
    v = _json.loads(r.text())
    if not v:
        return (None, None)
    return ((int(v[1:3], 16), int(v[3:5], 16), int(v[5:7], 16)), v)


class Chooser:
    def __init__(self, master=None, **options):
        self.options = options

    def show(self, color=None, **options):
        return askcolor(color, **dict(self.options, **options))
`,
  'tkinter/font.py': String.raw`"""tkinter.font"""
import tkinter as _tk

NORMAL = "normal"
ROMAN = "roman"
BOLD = "bold"
ITALIC = "italic"


class Font:
    _n = 0

    def __init__(self, root=None, font=None, name=None, exists=False, **options):
        Font._n += 1
        self.name = name or "font%d" % Font._n
        self._o = {"family": "TkDefaultFont", "size": 10, "weight": "normal", "slant": "roman", "underline": 0, "overstrike": 0}
        if font is not None:
            parts = list(font) if not isinstance(font, str) else font.split()
            if parts:
                self._o["family"] = parts[0]
            if len(parts) > 1:
                self._o["size"] = int(parts[1])
            for p in parts[2:]:
                if p in ("bold",):
                    self._o["weight"] = "bold"
                if p in ("italic",):
                    self._o["slant"] = "italic"
        self._o.update(options)
        _tk._named_fonts[self.name] = self

    def _css(self):
        size = int(self._o.get("size", 10))
        px = -size if size < 0 else max(1, round(size * 1.333))
        return "%s%s%dpx %s" % ("italic " if self._o.get("slant") == "italic" else "", "bold " if self._o.get("weight") == "bold" else "", px, _tk._family(str(self._o.get("family"))))

    def __str__(self):
        return self.name

    def actual(self, option=None, displayof=None):
        return self._o.get(option) if option else dict(self._o)

    def cget(self, option):
        return self._o.get(option)

    def configure(self, **options):
        if not options:
            return dict(self._o)
        self._o.update(options)

    config = configure

    def copy(self):
        return Font(**self._o)

    def measure(self, text, displayof=None):
        size = abs(int(self._o.get("size", 10))) * 1.333
        return int(sum(size * (1.0 if ord(c) > 0x2E80 else 0.55) for c in str(text)))

    def metrics(self, *options, **kw):
        size = abs(int(self._o.get("size", 10))) * 1.333
        m = {"ascent": int(size * 0.8), "descent": int(size * 0.25), "linespace": int(size * 1.2), "fixed": 0}
        return m[options[0]] if options else m

    def __getitem__(self, key):
        return self._o.get(key)

    def __setitem__(self, key, value):
        self._o[key] = value


def families(root=None, displayof=None):
    return ("Arial", "Courier New", "Helvetica", "Times New Roman", "Verdana", "Hiragino Sans", "Noto Sans JP", "Meiryo")


def names(root=None):
    return tuple(_tk._named_fonts)


def nametofont(name, root=None):
    if name in _tk._named_fonts:
        return _tk._named_fonts[name]
    return Font(name=name, family="TkDefaultFont", size=10)
`,
  'tkinter/scrolledtext.py': String.raw`"""tkinter.scrolledtext"""
from tkinter import Text, Frame, Scrollbar

__all__ = ["ScrolledText"]


class ScrolledText(Text):
    def __init__(self, master=None, **kw):
        Text.__init__(self, master, **kw)
        self.frame = self
        self.vbar = None
`,
  'tkinter/commondialog.py': String.raw`"""tkinter.commondialog"""


class Dialog:
    command = None

    def __init__(self, master=None, **options):
        self.master = master
        self.options = options

    def show(self, **options):
        return None
`,
  'tkinter/dnd.py': String.raw`"""tkinter.dnd (この環境では使えません)"""


def dnd_start(source, event):
    return None
`,
  'tkinter/__main__.py': String.raw`import tkinter
tkinter._test()
`,
  '_tkinter.py': String.raw`"""_tkinter (ForgeCode の tkinter 互換版が使います)"""
TK_VERSION = "8.6"
TCL_VERSION = "8.6"
READABLE = 2
WRITABLE = 4
EXCEPTION = 8


class TclError(Exception):
    pass


def create(*a, **k):
    raise TclError("この環境では Tcl は使えません")
`,
}

export function tkinterFiles() {
  return {
    'tkinter/__init__.py': TK,
    'tkinter/constants.py': CONSTANTS,
    'tkinter/ttk.py': TTK,
    ...DIALOGS,
  }
}
