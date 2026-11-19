// pygame 互換版 (ForgeCode の Python に置く): ゲームを出力の画面で動かす
// ・Surface はワーカーの中のキャンバス。描く命令はためておき、display.flip() でまとめて描いて画面へ送る (pg-canvas.js)
// ・キー・マウス (タップ) は画面から届く操作を pygame のイベントに直す。音は画面側の Web Audio で鳴らす
// ・よく使う部分 (display / draw / event / key / mouse / time / font / image / transform / mixer / math / sprite / mask / Rect / Color) に対応
// ここの Python はクラスの中の __ 名が変わらないよう、js の __fc_ で始まる関数は _cv の別名で呼びます
const INIT = String.raw`"""pygame (ForgeCode 互換版)
ブラウザの中で動くように作り直した pygame です。ゲームの画面は出力に表示され、キー・タップで操作できます。
"""
import sys as _sys
from pygame.constants import *
from pygame.rect import Rect, FRect
from pygame.color import Color
from pygame.surface import Surface, SurfaceType
from pygame import constants, display, draw, event, key, mouse, time, font, image, transform, mixer, math, sprite, mask, gfxdraw, surfarray, joystick, cursors, scrap
from pygame.math import Vector2, Vector3
from pygame._base import error, init, quit, get_init, get_error, set_error, register_quit, get_sdl_version, encode_string, encode_file_path, BufferProxy, PixelArray

__version__ = "2.5.2"
IS_CE = True
ver = __version__
vernum = (2, 5, 2)
version = _sys.modules[__name__]
SDL = (2, 30, 0)
`

const BASE = String.raw`"""pygame の土台 (初期化・エラー・画面とのやりとり)"""
import json as _json
import js as _js
import _forgecode as _fc


class error(RuntimeError):
    pass


_state = {"init": False, "quit": [], "error": ""}
_ops = []


def _cv(name):
    return getattr(_js, "__fc_pg_" + name)


def _q(op):
    """描く命令をためる (多くなったら描く)"""
    _ops.append(op)
    if len(_ops) >= 4000:
        _flush()


def _flush():
    if _ops:
        s = _json.dumps(_ops, separators=(",", ":"))
        _ops.clear()
        _cv("exec")(s)


def init():
    if not _state["init"]:
        _state["init"] = True
        _fc.note("pygame", "pygame: ForgeCode の互換版で動いています (画面は出力に表示。キー・タップで操作、■ で終わります)")
    return (6, 0)


def quit():
    for fn in list(_state["quit"]):
        try:
            fn()
        except Exception:
            pass
    _flush()
    try:
        from pygame import display
        display.quit()
    except Exception:
        pass
    _state["init"] = False


def get_init():
    return _state["init"]


def get_error():
    return _state["error"]


def set_error(msg):
    _state["error"] = str(msg)


def register_quit(fn):
    _state["quit"].append(fn)


def get_sdl_version(linked=True):
    return (2, 30, 0)


def encode_string(obj=None, encoding="unicode_escape", errors="backslashreplace", etype=UnicodeEncodeError):
    if obj is None:
        return None
    return obj.encode(encoding, errors) if isinstance(obj, str) else bytes(obj)


def encode_file_path(obj=None, etype=UnicodeEncodeError):
    return encode_string(obj, "utf-8")


class BufferProxy:
    def __init__(self, *a, **k):
        raise error("BufferProxy はこの環境では使えません")


def PixelArray(surface):
    raise error("PixelArray はこの環境では使えません。get_at / set_at か pygame.surfarray を使ってください")


def _reset():
    _ops.clear()
    _state["quit"].clear()
    _state["init"] = False


def _reset_all():
    """実行のはじめに、前の実行の画面・キー・タイマーを忘れる"""
    import sys
    _reset()
    for name in ("display", "event", "key", "mouse", "time"):
        m = sys.modules.get("pygame." + name)
        if m is not None and hasattr(m, "_reset"):
            m._reset()
    try:
        _cv("reset")()
    except Exception:
        pass
`

const CONSTANTS = String.raw`"""pygame の定数"""
NOEVENT = 0
QUIT = 256
ACTIVEEVENT = 32768
VIDEORESIZE = 32769
VIDEOEXPOSE = 32770
KEYDOWN = 768
KEYUP = 769
TEXTEDITING = 770
TEXTINPUT = 771
KEYMAPCHANGED = 772
MOUSEMOTION = 1024
MOUSEBUTTONDOWN = 1025
MOUSEBUTTONUP = 1026
MOUSEWHEEL = 1027
JOYAXISMOTION = 1536
JOYBALLMOTION = 1537
JOYHATMOTION = 1538
JOYBUTTONDOWN = 1539
JOYBUTTONUP = 1540
JOYDEVICEADDED = 1541
JOYDEVICEREMOVED = 1542
CONTROLLERAXISMOTION = 1616
CONTROLLERBUTTONDOWN = 1617
CONTROLLERBUTTONUP = 1618
FINGERDOWN = 1792
FINGERUP = 1793
FINGERMOTION = 1794
DROPFILE = 4096
WINDOWSHOWN = 32771
WINDOWHIDDEN = 32772
WINDOWEXPOSED = 32773
WINDOWMOVED = 32774
WINDOWRESIZED = 32775
WINDOWSIZECHANGED = 32776
WINDOWMINIMIZED = 32777
WINDOWMAXIMIZED = 32778
WINDOWRESTORED = 32779
WINDOWENTER = 32780
WINDOWLEAVE = 32781
WINDOWFOCUSGAINED = 32782
WINDOWFOCUSLOST = 32783
WINDOWCLOSE = 32784
USEREVENT = 32866
NUMEVENTS = 65535
USEREVENT_DROPFILE = 4096

SWSURFACE = 0
HWSURFACE = 1
ASYNCBLIT = 4
ANYFORMAT = 268435456
HWPALETTE = 536870912
DOUBLEBUF = 1073741824
FULLSCREEN = -2147483648
OPENGL = 2
OPENGLBLIT = 10
RESIZABLE = 16
NOFRAME = 32
SCALED = 512
SHOWN = 0
HIDDEN = 128
SRCALPHA = 65536
SRCCOLORKEY = 4096
RLEACCEL = 16384
RLEACCELOK = 8192
PREALLOC = 16777216

BLEND_ADD = BLEND_RGB_ADD = 1
BLEND_SUB = BLEND_RGB_SUB = 2
BLEND_MULT = BLEND_RGB_MULT = 3
BLEND_MIN = BLEND_RGB_MIN = 4
BLEND_MAX = BLEND_RGB_MAX = 5
BLEND_RGBA_ADD = 6
BLEND_RGBA_SUB = 7
BLEND_RGBA_MULT = 8
BLEND_RGBA_MIN = 9
BLEND_RGBA_MAX = 10
BLEND_PREMULTIPLIED = 17
BLEND_ALPHA_SDL2 = 18

BUTTON_LEFT = 1
BUTTON_MIDDLE = 2
BUTTON_RIGHT = 3
BUTTON_WHEELUP = 4
BUTTON_WHEELDOWN = 5
BUTTON_X1 = 6
BUTTON_X2 = 7

KMOD_NONE = 0
KMOD_LSHIFT = 1
KMOD_RSHIFT = 2
KMOD_SHIFT = 3
KMOD_LCTRL = 64
KMOD_RCTRL = 128
KMOD_CTRL = 192
KMOD_LALT = 256
KMOD_RALT = 512
KMOD_ALT = 768
KMOD_LMETA = 1024
KMOD_RMETA = 2048
KMOD_META = 3072
KMOD_GUI = 3072
KMOD_NUM = 4096
KMOD_CAPS = 8192
KMOD_MODE = 16384

K_UNKNOWN = 0
K_BACKSPACE = 8
K_TAB = 9
K_CLEAR = 1073741980
K_RETURN = 13
K_PAUSE = 1073741896
K_ESCAPE = 27
K_SPACE = 32
K_EXCLAIM = 33
K_QUOTEDBL = 34
K_HASH = 35
K_DOLLAR = 36
K_PERCENT = 37
K_AMPERSAND = 38
K_QUOTE = 39
K_LEFTPAREN = 40
K_RIGHTPAREN = 41
K_ASTERISK = 42
K_PLUS = 43
K_COMMA = 44
K_MINUS = 45
K_PERIOD = 46
K_SLASH = 47
K_0 = 48
K_1 = 49
K_2 = 50
K_3 = 51
K_4 = 52
K_5 = 53
K_6 = 54
K_7 = 55
K_8 = 56
K_9 = 57
K_COLON = 58
K_SEMICOLON = 59
K_LESS = 60
K_EQUALS = 61
K_GREATER = 62
K_QUESTION = 63
K_AT = 64
K_LEFTBRACKET = 91
K_BACKSLASH = 92
K_RIGHTBRACKET = 93
K_CARET = 94
K_UNDERSCORE = 95
K_BACKQUOTE = 96
K_a = 97
K_b = 98
K_c = 99
K_d = 100
K_e = 101
K_f = 102
K_g = 103
K_h = 104
K_i = 105
K_j = 106
K_k = 107
K_l = 108
K_m = 109
K_n = 110
K_o = 111
K_p = 112
K_q = 113
K_r = 114
K_s = 115
K_t = 116
K_u = 117
K_v = 118
K_w = 119
K_x = 120
K_y = 121
K_z = 122
K_DELETE = 127
K_KP0 = K_KP_0 = 1073741922
K_KP1 = K_KP_1 = 1073741913
K_KP2 = K_KP_2 = 1073741914
K_KP3 = K_KP_3 = 1073741915
K_KP4 = K_KP_4 = 1073741916
K_KP5 = K_KP_5 = 1073741917
K_KP6 = K_KP_6 = 1073741918
K_KP7 = K_KP_7 = 1073741919
K_KP8 = K_KP_8 = 1073741920
K_KP9 = K_KP_9 = 1073741921
K_KP_PERIOD = 1073741923
K_KP_DIVIDE = 1073741908
K_KP_MULTIPLY = 1073741909
K_KP_MINUS = 1073741910
K_KP_PLUS = 1073741911
K_KP_ENTER = 1073741912
K_KP_EQUALS = 1073741927
K_UP = 1073741906
K_DOWN = 1073741905
K_RIGHT = 1073741903
K_LEFT = 1073741904
K_INSERT = 1073741897
K_HOME = 1073741898
K_END = 1073741901
K_PAGEUP = 1073741899
K_PAGEDOWN = 1073741902
K_F1 = 1073741882
K_F2 = 1073741883
K_F3 = 1073741884
K_F4 = 1073741885
K_F5 = 1073741886
K_F6 = 1073741887
K_F7 = 1073741888
K_F8 = 1073741889
K_F9 = 1073741890
K_F10 = 1073741891
K_F11 = 1073741892
K_F12 = 1073741893
K_F13 = 1073741928
K_F14 = 1073741929
K_F15 = 1073741930
K_NUMLOCK = K_NUMLOCKCLEAR = 1073741907
K_CAPSLOCK = 1073741881
K_SCROLLOCK = K_SCROLLLOCK = 1073741895
K_RSHIFT = 1073742053
K_LSHIFT = 1073742049
K_RCTRL = 1073742052
K_LCTRL = 1073742048
K_RALT = 1073742054
K_LALT = 1073742050
K_RMETA = K_RGUI = 1073742055
K_LMETA = K_LGUI = 1073742051
K_LSUPER = 1073742051
K_RSUPER = 1073742055
K_MODE = 1073742081
K_HELP = 1073741941
K_PRINT = K_PRINTSCREEN = 1073741894
K_SYSREQ = 1073741978
K_MENU = 1073741942
K_POWER = 1073741926
K_EURO = 1073741876
K_AC_BACK = 1073742094
`

const LOCALS = String.raw`"""from pygame.locals import * で使う定数"""
from pygame.constants import *
from pygame.rect import Rect, FRect
from pygame.color import Color
`

const RECT = String.raw`"""pygame.Rect (長方形)"""


def _parse(args):
    if len(args) == 1:
        a = args[0]
        if isinstance(a, Rect):
            return a._x, a._y, a._w, a._h
        if hasattr(a, "rect") and not isinstance(a, (tuple, list)):
            r = a.rect() if callable(a.rect) else a.rect
            return _parse((r,))
        a = tuple(a)
        if len(a) == 4:
            return a[0], a[1], a[2], a[3]
        if len(a) == 2:
            return a[0][0], a[0][1], a[1][0], a[1][1]
    elif len(args) == 2:
        return args[0][0], args[0][1], args[1][0], args[1][1]
    elif len(args) == 4:
        return args
    raise TypeError("Argument must be rect style object")


class Rect:
    __slots__ = ("_x", "_y", "_w", "_h")
    _num = staticmethod(int)

    def __init__(self, *args):
        x, y, w, h = _parse(args)
        n = self._num
        self._x, self._y, self._w, self._h = n(x), n(y), n(w), n(h)

    # ---- 位置と大きさ ----
    def _get(name):
        return property(lambda s: getattr(s, name), lambda s, v: setattr(s, name, s._num(v)))

    x = left = _get("_x")
    y = top = _get("_y")
    w = width = _get("_w")
    h = height = _get("_h")
    del _get

    @property
    def right(self): return self._x + self._w
    @right.setter
    def right(self, v): self._x = self._num(v) - self._w
    @property
    def bottom(self): return self._y + self._h
    @bottom.setter
    def bottom(self, v): self._y = self._num(v) - self._h
    @property
    def centerx(self): return self._x + self._w // 2 if self._num is int else self._x + self._w / 2
    @centerx.setter
    def centerx(self, v): self._x = self._num(v) - (self._w // 2 if self._num is int else self._w / 2)
    @property
    def centery(self): return self._y + self._h // 2 if self._num is int else self._y + self._h / 2
    @centery.setter
    def centery(self, v): self._y = self._num(v) - (self._h // 2 if self._num is int else self._h / 2)
    @property
    def size(self): return (self._w, self._h)
    @size.setter
    def size(self, v): self._w, self._h = self._num(v[0]), self._num(v[1])
    @property
    def topleft(self): return (self._x, self._y)
    @topleft.setter
    def topleft(self, v): self.x, self.y = v[0], v[1]
    @property
    def topright(self): return (self.right, self._y)
    @topright.setter
    def topright(self, v): self.right, self.y = v[0], v[1]
    @property
    def bottomleft(self): return (self._x, self.bottom)
    @bottomleft.setter
    def bottomleft(self, v): self.x, self.bottom = v[0], v[1]
    @property
    def bottomright(self): return (self.right, self.bottom)
    @bottomright.setter
    def bottomright(self, v): self.right, self.bottom = v[0], v[1]
    @property
    def center(self): return (self.centerx, self.centery)
    @center.setter
    def center(self, v): self.centerx, self.centery = v[0], v[1]
    @property
    def midtop(self): return (self.centerx, self._y)
    @midtop.setter
    def midtop(self, v): self.centerx, self.y = v[0], v[1]
    @property
    def midbottom(self): return (self.centerx, self.bottom)
    @midbottom.setter
    def midbottom(self, v): self.centerx, self.bottom = v[0], v[1]
    @property
    def midleft(self): return (self._x, self.centery)
    @midleft.setter
    def midleft(self, v): self.x, self.centery = v[0], v[1]
    @property
    def midright(self): return (self.right, self.centery)
    @midright.setter
    def midright(self, v): self.right, self.centery = v[0], v[1]

    # ---- 作る・動かす ----
    def copy(self):
        return type(self)(self._x, self._y, self._w, self._h)

    def move(self, *v):
        dx, dy = v[0] if len(v) == 1 else v
        return type(self)(self._x + dx, self._y + dy, self._w, self._h)

    def move_ip(self, *v):
        dx, dy = v[0] if len(v) == 1 else v
        self._x = self._num(self._x + dx)
        self._y = self._num(self._y + dy)

    def inflate(self, *v):
        dx, dy = v[0] if len(v) == 1 else v
        if self._num is int:
            return type(self)(self._x - int(dx / 2), self._y - int(dy / 2), self._w + dx, self._h + dy)
        return type(self)(self._x - dx / 2, self._y - dy / 2, self._w + dx, self._h + dy)

    def inflate_ip(self, *v):
        r = self.inflate(*v)
        self._x, self._y, self._w, self._h = r._x, r._y, r._w, r._h

    def scale_by(self, x, y=None):
        y = x if y is None else y
        r = type(self)(0, 0, self._w * x, self._h * y)
        r.center = self.center
        return r

    def scale_by_ip(self, x, y=None):
        r = self.scale_by(x, y)
        self._x, self._y, self._w, self._h = r._x, r._y, r._w, r._h

    def update(self, *args):
        x, y, w, h = _parse(args)
        n = self._num
        self._x, self._y, self._w, self._h = n(x), n(y), n(w), n(h)

    def clamp(self, *a):
        o = type(self)(*a)
        r = self.copy()
        r.clamp_ip(o)
        return r

    def clamp_ip(self, *a):
        o = type(self)(*a)
        if self._w >= o._w:
            self.centerx = o.centerx
        elif self._x < o._x:
            self._x = o._x
        elif self.right > o.right:
            self.right = o.right
        if self._h >= o._h:
            self.centery = o.centery
        elif self._y < o._y:
            self._y = o._y
        elif self.bottom > o.bottom:
            self.bottom = o.bottom

    def clip(self, *a):
        o = type(self)(*a)
        x1, y1 = max(self._x, o._x), max(self._y, o._y)
        x2, y2 = min(self.right, o.right), min(self.bottom, o.bottom)
        if x2 <= x1 or y2 <= y1:
            return type(self)(self._x, self._y, 0, 0)
        return type(self)(x1, y1, x2 - x1, y2 - y1)

    def clipline(self, *args):
        if len(args) == 1:
            (x1, y1), (x2, y2) = args[0]
        elif len(args) == 2:
            (x1, y1), (x2, y2) = args
        else:
            x1, y1, x2, y2 = args
        # Liang-Barsky
        xmin, ymin, xmax, ymax = self._x, self._y, self.right - 1, self.bottom - 1
        dx, dy = x2 - x1, y2 - y1
        t0, t1 = 0.0, 1.0
        for p, q in ((-dx, x1 - xmin), (dx, xmax - x1), (-dy, y1 - ymin), (dy, ymax - y1)):
            if p == 0:
                if q < 0:
                    return ()
            else:
                t = q / p
                if p < 0:
                    if t > t1:
                        return ()
                    t0 = max(t0, t)
                else:
                    if t < t0:
                        return ()
                    t1 = min(t1, t)
        n = self._num
        return ((n(round(x1 + t0 * dx)), n(round(y1 + t0 * dy))), (n(round(x1 + t1 * dx)), n(round(y1 + t1 * dy))))

    def union(self, *a):
        o = type(self)(*a)
        x1, y1 = min(self._x, o._x), min(self._y, o._y)
        x2, y2 = max(self.right, o.right), max(self.bottom, o.bottom)
        return type(self)(x1, y1, x2 - x1, y2 - y1)

    def union_ip(self, *a):
        r = self.union(*a)
        self._x, self._y, self._w, self._h = r._x, r._y, r._w, r._h

    def unionall(self, rects):
        r = self.copy()
        for o in rects:
            r.union_ip(o)
        return r

    def unionall_ip(self, rects):
        r = self.unionall(rects)
        self._x, self._y, self._w, self._h = r._x, r._y, r._w, r._h

    def fit(self, *a):
        o = type(self)(*a)
        if self._w == 0 or self._h == 0:
            return type(self)(o.x, o.y, 0, 0)
        s = min(o._w / self._w, o._h / self._h)
        r = type(self)(0, 0, self._w * s, self._h * s)
        r.center = o.center
        return r

    def normalize(self):
        if self._w < 0:
            self._x += self._w
            self._w = -self._w
        if self._h < 0:
            self._y += self._h
            self._h = -self._h

    # ---- 当たり判定 ----
    def contains(self, *a):
        o = type(self)(*a)
        return self._x <= o._x and self._y <= o._y and o.right <= self.right and o.bottom <= self.bottom and self._w > 0 and self._h > 0

    def collidepoint(self, *p):
        x, y = p[0] if len(p) == 1 else p
        return self._x <= x < self._x + self._w and self._y <= y < self._y + self._h

    def colliderect(self, *a):
        o = a[0] if len(a) == 1 and isinstance(a[0], Rect) else type(self)(*a)
        return (self._x < o._x + o._w and o._x < self._x + self._w and self._y < o._y + o._h and o._y < self._y + self._h
                and self._w > 0 and self._h > 0 and o._w > 0 and o._h > 0)

    def collidelist(self, rects):
        for i, r in enumerate(rects):
            if self.colliderect(r):
                return i
        return -1

    def collidelistall(self, rects):
        return [i for i, r in enumerate(rects) if self.colliderect(r)]

    def collideobjects(self, objs, key=None):
        for o in objs:
            if self.colliderect(key(o) if key else o):
                return o
        return None

    def collideobjectsall(self, objs, key=None):
        return [o for o in objs if self.colliderect(key(o) if key else o)]

    def collidedict(self, d, values=False):
        for k, v in d.items():
            if self.colliderect(v if values else k):
                return (k, v)
        return None

    def collidedictall(self, d, values=False):
        return [(k, v) for k, v in d.items() if self.colliderect(v if values else k)]

    # ---- 数の並びとして ----
    def __iter__(self):
        return iter((self._x, self._y, self._w, self._h))

    def __len__(self):
        return 4

    def __getitem__(self, i):
        return (self._x, self._y, self._w, self._h)[i]

    def __setitem__(self, i, v):
        vals = [self._x, self._y, self._w, self._h]
        vals[i] = v
        self._x, self._y, self._w, self._h = (self._num(x) for x in vals)

    def __eq__(self, o):
        try:
            return tuple(self) == tuple(type(self)(o))
        except Exception:
            return NotImplemented

    def __ne__(self, o):
        r = self.__eq__(o)
        return r if r is NotImplemented else not r

    def __lt__(self, o):
        return tuple(self) < tuple(type(self)(o))

    def __bool__(self):
        return self._w != 0 and self._h != 0

    def __hash__(self):
        return hash((self._x, self._y, self._w, self._h))

    def __copy__(self):
        return self.copy()

    def __reduce__(self):
        return (type(self), (self._x, self._y, self._w, self._h))

    def __repr__(self):
        return "<%s(%s, %s, %s, %s)>" % (type(self).__name__, self._x, self._y, self._w, self._h)


class FRect(Rect):
    """小数の位置を持てる Rect"""
    __slots__ = ()
    _num = staticmethod(float)


RectType = Rect
`

const COLOR = String.raw`"""pygame.Color (色)"""
THECOLORS = {
    "aliceblue": (240, 248, 255), "antiquewhite": (250, 235, 215), "aqua": (0, 255, 255), "aquamarine": (127, 255, 212),
    "azure": (240, 255, 255), "beige": (245, 245, 220), "bisque": (255, 228, 196), "black": (0, 0, 0),
    "blanchedalmond": (255, 235, 205), "blue": (0, 0, 255), "blueviolet": (138, 43, 226), "brown": (165, 42, 42),
    "burlywood": (222, 184, 135), "cadetblue": (95, 158, 160), "chartreuse": (127, 255, 0), "chocolate": (210, 105, 30),
    "coral": (255, 127, 80), "cornflowerblue": (100, 149, 237), "cornsilk": (255, 248, 220), "crimson": (220, 20, 60),
    "cyan": (0, 255, 255), "darkblue": (0, 0, 139), "darkcyan": (0, 139, 139), "darkgoldenrod": (184, 134, 11),
    "darkgray": (169, 169, 169), "darkgreen": (0, 100, 0), "darkgrey": (169, 169, 169), "darkkhaki": (189, 183, 107),
    "darkmagenta": (139, 0, 139), "darkolivegreen": (85, 107, 47), "darkorange": (255, 140, 0), "darkorchid": (153, 50, 204),
    "darkred": (139, 0, 0), "darksalmon": (233, 150, 122), "darkseagreen": (143, 188, 143), "darkslateblue": (72, 61, 139),
    "darkslategray": (47, 79, 79), "darkslategrey": (47, 79, 79), "darkturquoise": (0, 206, 209), "darkviolet": (148, 0, 211),
    "deeppink": (255, 20, 147), "deepskyblue": (0, 191, 255), "dimgray": (105, 105, 105), "dimgrey": (105, 105, 105),
    "dodgerblue": (30, 144, 255), "firebrick": (178, 34, 34), "floralwhite": (255, 250, 240), "forestgreen": (34, 139, 34),
    "fuchsia": (255, 0, 255), "gainsboro": (220, 220, 220), "ghostwhite": (248, 248, 255), "gold": (255, 215, 0),
    "goldenrod": (218, 165, 32), "gray": (190, 190, 190), "grey": (190, 190, 190), "green": (0, 255, 0),
    "greenyellow": (173, 255, 47), "honeydew": (240, 255, 240), "hotpink": (255, 105, 180), "indianred": (205, 92, 92),
    "indigo": (75, 0, 130), "ivory": (255, 255, 240), "khaki": (240, 230, 140), "lavender": (230, 230, 250),
    "lavenderblush": (255, 240, 245), "lawngreen": (124, 252, 0), "lemonchiffon": (255, 250, 205), "lightblue": (173, 216, 230),
    "lightcoral": (240, 128, 128), "lightcyan": (224, 255, 255), "lightgoldenrodyellow": (250, 250, 210), "lightgray": (211, 211, 211),
    "lightgreen": (144, 238, 144), "lightgrey": (211, 211, 211), "lightpink": (255, 182, 193), "lightsalmon": (255, 160, 122),
    "lightseagreen": (32, 178, 170), "lightskyblue": (135, 206, 250), "lightslategray": (119, 136, 153), "lightslategrey": (119, 136, 153),
    "lightsteelblue": (176, 196, 222), "lightyellow": (255, 255, 224), "lime": (0, 255, 0), "limegreen": (50, 205, 50),
    "linen": (250, 240, 230), "magenta": (255, 0, 255), "maroon": (176, 48, 96), "mediumaquamarine": (102, 205, 170),
    "mediumblue": (0, 0, 205), "mediumorchid": (186, 85, 211), "mediumpurple": (147, 112, 219), "mediumseagreen": (60, 179, 113),
    "mediumslateblue": (123, 104, 238), "mediumspringgreen": (0, 250, 154), "mediumturquoise": (72, 209, 204), "mediumvioletred": (199, 21, 133),
    "midnightblue": (25, 25, 112), "mintcream": (245, 255, 250), "mistyrose": (255, 228, 225), "moccasin": (255, 228, 181),
    "navajowhite": (255, 222, 173), "navy": (0, 0, 128), "navyblue": (0, 0, 128), "oldlace": (253, 245, 230), "olive": (128, 128, 0),
    "olivedrab": (107, 142, 35), "orange": (255, 165, 0), "orangered": (255, 69, 0), "orchid": (218, 112, 214),
    "palegoldenrod": (238, 232, 170), "palegreen": (152, 251, 152), "paleturquoise": (175, 238, 238), "palevioletred": (219, 112, 147),
    "papayawhip": (255, 239, 213), "peachpuff": (255, 218, 185), "peru": (205, 133, 63), "pink": (255, 192, 203),
    "plum": (221, 160, 221), "powderblue": (176, 224, 230), "purple": (160, 32, 240), "rebeccapurple": (102, 51, 153),
    "red": (255, 0, 0), "rosybrown": (188, 143, 143), "royalblue": (65, 105, 225), "saddlebrown": (139, 69, 19),
    "salmon": (250, 128, 114), "sandybrown": (244, 164, 96), "seagreen": (46, 139, 87), "seashell": (255, 245, 238),
    "sienna": (160, 82, 45), "silver": (192, 192, 192), "skyblue": (135, 206, 235), "slateblue": (106, 90, 205),
    "slategray": (112, 128, 144), "slategrey": (112, 128, 144), "snow": (255, 250, 250), "springgreen": (0, 255, 127),
    "steelblue": (70, 130, 180), "tan": (210, 180, 140), "teal": (0, 128, 128), "thistle": (216, 191, 216),
    "tomato": (255, 99, 71), "turquoise": (64, 224, 208), "violet": (238, 130, 238), "wheat": (245, 222, 179),
    "white": (255, 255, 255), "whitesmoke": (245, 245, 245), "yellow": (255, 255, 0), "yellowgreen": (154, 205, 50),
    "darkgrey2": (64, 64, 64), "gray50": (127, 127, 127), "grey50": (127, 127, 127),
}
for _i in range(101):
    _v = int(round(_i * 2.55))
    THECOLORS.setdefault("gray%d" % _i, (_v, _v, _v))
    THECOLORS.setdefault("grey%d" % _i, (_v, _v, _v))


def _rgba(v):
    if isinstance(v, Color):
        return v.r, v.g, v.b, v.a
    if isinstance(v, str):
        s = v.strip().lower().replace(" ", "")
        if s.startswith("#") or s.startswith("0x"):
            h = s[1:] if s.startswith("#") else s[2:]
            if len(h) in (3, 4):
                h = "".join(c * 2 for c in h)
            if len(h) not in (6, 8):
                raise ValueError("invalid color argument")
            r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
            a = int(h[6:8], 16) if len(h) == 8 else 255
            return r, g, b, a
        if s in THECOLORS:
            return THECOLORS[s] + (255,)
        raise ValueError("invalid color name")
    if isinstance(v, int):
        return (v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255
    t = tuple(v)
    if len(t) == 3:
        return int(t[0]), int(t[1]), int(t[2]), 255
    if len(t) == 4:
        return int(t[0]), int(t[1]), int(t[2]), int(t[3])
    raise ValueError("invalid color argument")


class Color:
    __slots__ = ("r", "g", "b", "a")

    def __init__(self, *args):
        if len(args) == 1:
            r, g, b, a = _rgba(args[0])
        elif len(args) in (3, 4):
            r, g, b = args[0], args[1], args[2]
            a = args[3] if len(args) == 4 else 255
        else:
            raise ValueError("invalid color argument")
        for v in (r, g, b, a):
            if not 0 <= int(v) <= 255:
                raise ValueError("invalid color argument")
        self.r, self.g, self.b, self.a = int(r), int(g), int(b), int(a)

    def __iter__(self):
        return iter((self.r, self.g, self.b, self.a))

    def __len__(self):
        return 4

    def __getitem__(self, i):
        return (self.r, self.g, self.b, self.a)[i]

    def __setitem__(self, i, v):
        vals = [self.r, self.g, self.b, self.a]
        vals[i] = int(v)
        self.r, self.g, self.b, self.a = vals

    def __eq__(self, o):
        try:
            return tuple(self) == _rgba(o)
        except Exception:
            return NotImplemented

    def __hash__(self):
        return hash(tuple(self))

    def __repr__(self):
        return "Color(%d, %d, %d, %d)" % tuple(self)

    def __int__(self):
        return (self.r << 24) | (self.g << 16) | (self.b << 8) | self.a

    def __add__(self, o):
        o = Color(o)
        return Color(*(min(255, a + b) for a, b in zip(self, o)))

    def __sub__(self, o):
        o = Color(o)
        return Color(*(max(0, a - b) for a, b in zip(self, o)))

    def __mul__(self, o):
        o = Color(o)
        return Color(*(min(255, a * b) for a, b in zip(self, o)))

    def __invert__(self):
        return Color(255 - self.r, 255 - self.g, 255 - self.b, 255 - self.a)

    def copy(self):
        return Color(self.r, self.g, self.b, self.a)

    def normalize(self):
        return tuple(v / 255.0 for v in self)

    def lerp(self, color, t):
        o = Color(color)
        return Color(*(int(round(a + (b - a) * t)) for a, b in zip(self, o)))

    def grayscale(self):
        g = int(round(0.299 * self.r + 0.587 * self.g + 0.114 * self.b))
        return Color(g, g, g, self.a)

    def premul_alpha(self):
        return Color(self.r * self.a // 255, self.g * self.a // 255, self.b * self.a // 255, self.a)

    def update(self, *args):
        c = Color(*args)
        self.r, self.g, self.b, self.a = c.r, c.g, c.b, c.a

    def set_length(self, n):
        pass

    @property
    def hsva(self):
        import colorsys
        h, s, v = colorsys.rgb_to_hsv(self.r / 255, self.g / 255, self.b / 255)
        return (h * 360, s * 100, v * 100, self.a / 2.55)

    @hsva.setter
    def hsva(self, v):
        import colorsys
        r, g, b = colorsys.hsv_to_rgb((v[0] % 360) / 360, v[1] / 100, v[2] / 100)
        self.r, self.g, self.b = int(round(r * 255)), int(round(g * 255)), int(round(b * 255))
        if len(v) > 3:
            self.a = int(round(v[3] * 2.55))

    @property
    def hsla(self):
        import colorsys
        h, l, s = colorsys.rgb_to_hls(self.r / 255, self.g / 255, self.b / 255)
        return (h * 360, s * 100, l * 100, self.a / 2.55)

    @hsla.setter
    def hsla(self, v):
        import colorsys
        r, g, b = colorsys.hls_to_rgb((v[0] % 360) / 360, v[2] / 100, v[1] / 100)
        self.r, self.g, self.b = int(round(r * 255)), int(round(g * 255)), int(round(b * 255))
        if len(v) > 3:
            self.a = int(round(v[3] * 2.55))

    @property
    def cmy(self):
        return (1 - self.r / 255, 1 - self.g / 255, 1 - self.b / 255)

    @classmethod
    def from_hsva(cls, *v):
        c = cls(0, 0, 0)
        c.hsva = v
        return c

    @classmethod
    def from_hsla(cls, *v):
        c = cls(0, 0, 0)
        c.hsla = v
        return c


def css(c, alpha=True):
    """キャンバスで使う色の文字列"""
    r, g, b, a = _rgba(c)
    if not alpha or a >= 255:
        return "rgb(%d,%d,%d)" % (r, g, b)
    return "rgba(%d,%d,%d,%.4f)" % (r, g, b, a / 255.0)
`

const SURFACE = String.raw`"""pygame.Surface (絵を描く板)"""
import math as _m
import pygame._base as _b
from pygame._base import _q, _flush, _cv, error
from pygame.constants import SRCALPHA
from pygame.rect import Rect
from pygame.color import Color, _rgba, css


def _xy(p):
    if isinstance(p, Rect):
        return p.x, p.y
    if hasattr(p, "x") and hasattr(p, "y") and not isinstance(p, (tuple, list)):
        return int(p.x), int(p.y)
    return int(p[0]), int(p[1])


class Surface:
    def __init__(self, size, flags=0, depth=0, masks=None, *, _sid=None):
        w, h = int(size[0]), int(size[1])
        if w < 0 or h < 0:
            raise error("Invalid resolution for Surface")
        self._w, self._h = w, h
        self._flags = flags
        self._alpha = bool(flags & SRCALPHA) or (depth == 32 and masks is not None)
        self._ck = None
        self._salpha = None
        self._clip = None
        self._display = False
        self._sid = _sid if _sid is not None else _cv("new")(w, h, self._alpha)

    def __del__(self):
        try:
            if not self._display:
                _q(["free", self._sid])
        except Exception:
            pass

    # ---- 大きさ ----
    def get_size(self):
        return (self._w, self._h)

    def get_width(self):
        return self._w

    def get_height(self):
        return self._h

    def get_rect(self, **kw):
        r = Rect(0, 0, self._w, self._h)
        for k, v in kw.items():
            setattr(r, k, v)
        return r

    def get_frect(self, **kw):
        from pygame.rect import FRect
        r = FRect(0, 0, self._w, self._h)
        for k, v in kw.items():
            setattr(r, k, v)
        return r

    def get_bounding_rect(self, min_alpha=1):
        data = self._pixels(0, 0, self._w, self._h)
        xs, ys = [], []
        w = self._w
        for i in range(3, len(data), 4):
            if data[i] >= min_alpha:
                p = i // 4
                xs.append(p % w)
                ys.append(p // w)
        if not xs:
            return Rect(0, 0, 0, 0)
        return Rect(min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1)

    # ---- 描く ----
    def _css(self, color):
        return css(color, self._alpha)

    def fill(self, color, rect=None, special_flags=0):
        r = Rect(rect) if rect is not None else Rect(0, 0, self._w, self._h)
        r = r.clip(Rect(0, 0, self._w, self._h))
        _q(["fill", self._sid, self._css(color), [r.x, r.y, r.w, r.h], True, special_flags])
        return r

    def blit(self, source, dest=(0, 0), area=None, special_flags=0):
        if not isinstance(source, Surface):
            raise TypeError("argument 1 must be pygame.surface.Surface, not %s" % type(source).__name__)
        dx, dy = _xy(dest)
        if area is not None:
            a = Rect(area).clip(Rect(0, 0, source._w, source._h))
            sx, sy, sw, sh = a.x, a.y, a.w, a.h
        else:
            sx, sy, sw, sh = 0, 0, source._w, source._h
        alpha = -1 if source._salpha is None else source._salpha
        ck = list(source._ck[:3]) if source._ck is not None else None
        _q(["blit", self._sid, source._sid, dx, dy, sx, sy, sw, sh, alpha, ck, special_flags])
        return Rect(dx, dy, sw, sh).clip(Rect(0, 0, self._w, self._h))

    def blits(self, blit_sequence, doreturn=1):
        out = []
        for item in blit_sequence:
            r = self.blit(*item)
            if doreturn:
                out.append(r)
        return out if doreturn else None

    def fblits(self, blit_sequence, special_flags=0):
        for src, dest in blit_sequence:
            self.blit(src, dest, None, special_flags)

    def copy(self):
        s = Surface((self._w, self._h), SRCALPHA if self._alpha else 0)
        _q(["copy", s._sid, self._sid])
        s._ck, s._salpha = self._ck, self._salpha
        return s

    def convert(self, *args):
        s = Surface((self._w, self._h), 0)
        _q(["blit", s._sid, self._sid, 0, 0, 0, 0, self._w, self._h, -1, None, 0])
        s._ck, s._salpha = self._ck, self._salpha
        return s

    def convert_alpha(self, *args):
        s = Surface((self._w, self._h), SRCALPHA)
        _q(["copy", s._sid, self._sid])
        s._ck, s._salpha = self._ck, self._salpha
        return s

    def subsurface(self, *rect):
        r = Rect(*rect)
        if not Rect(0, 0, self._w, self._h).contains(r):
            raise ValueError("subsurface rectangle outside surface area")
        s = Surface((r.w, r.h), SRCALPHA if self._alpha else 0)
        _q(["blit", s._sid, self._sid, 0, 0, r.x, r.y, r.w, r.h, -1, None, 0])
        s._parent = self
        s._offset = (r.x, r.y)
        return s

    def get_parent(self):
        return getattr(self, "_parent", None)

    def get_abs_parent(self):
        p = self
        while getattr(p, "_parent", None) is not None:
            p = p._parent
        return p

    def get_offset(self):
        return getattr(self, "_offset", (0, 0))

    def get_abs_offset(self):
        return self.get_offset()

    def scroll(self, dx=0, dy=0):
        _q(["scroll", self._sid, int(dx), int(dy)])

    # ---- 透明 ----
    def set_colorkey(self, color=None, flags=0):
        self._ck = None if color is None else _rgba(color)

    def get_colorkey(self):
        return None if self._ck is None else tuple(self._ck)

    def set_alpha(self, value=None, flags=0):
        self._salpha = None if value is None else max(0, min(255, int(value)))

    def get_alpha(self):
        if self._salpha is not None:
            return self._salpha
        return 255 if self._alpha else None

    # ---- 画素 ----
    def _pixels(self, x, y, w, h):
        _flush()
        return bytes(_cv("pixels")(self._sid, x, y, w, h).to_py())

    def get_at(self, pos):
        x, y = _xy(pos)
        if not (0 <= x < self._w and 0 <= y < self._h):
            raise IndexError("pixel index out of range")
        d = self._pixels(x, y, 1, 1)
        return Color(d[0], d[1], d[2], d[3] if self._alpha else 255)

    def set_at(self, pos, color):
        x, y = _xy(pos)
        if 0 <= x < self._w and 0 <= y < self._h:
            _q(["pix", self._sid, x, y, self._css(color)])

    def get_at_mapped(self, pos):
        return int(self.get_at(pos))

    def map_rgb(self, color):
        return int(Color(color))

    def unmap_rgb(self, mapped):
        return Color(mapped)

    def set_clip(self, rect=None):
        self._clip = None if rect is None else Rect(rect)
        _q(["clip", self._sid, None if rect is None else list(self._clip)])

    def get_clip(self):
        return self._clip.copy() if self._clip else Rect(0, 0, self._w, self._h)

    # ---- そのほか (形だけ) ----
    def lock(self):
        pass

    def unlock(self):
        pass

    def mustlock(self):
        return False

    def get_locked(self):
        return False

    def get_locks(self):
        return ()

    def get_flags(self):
        return self._flags | (SRCALPHA if self._alpha else 0)

    def get_bitsize(self):
        return 32

    def get_bytesize(self):
        return 4

    def get_pitch(self):
        return self._w * 4

    def get_masks(self):
        return (0xFF0000, 0xFF00, 0xFF, 0xFF000000 if self._alpha else 0)

    def get_shifts(self):
        return (16, 8, 0, 24 if self._alpha else 0)

    def get_losses(self):
        return (0, 0, 0, 0 if self._alpha else 8)

    def premul_alpha(self):
        return self.copy()

    def set_palette(self, *a):
        pass

    def get_palette(self):
        return None

    def __repr__(self):
        return "<Surface(%dx%dx32%s)>" % (self._w, self._h, " SW" if not self._alpha else " SRCALPHA")


SurfaceType = Surface


def _adopt(canvas, alpha=True):
    s = Surface.__new__(Surface)
    s._sid = _cv("adopt")(canvas)
    s._w, s._h = int(canvas.width), int(canvas.height)
    s._flags = SRCALPHA if alpha else 0
    s._alpha = alpha
    s._ck = None
    s._salpha = None
    s._clip = None
    s._display = False
    return s
`

const DISPLAY = String.raw`"""pygame.display (ゲームの画面)"""
import os as _os
import re as _re
import sys as _sys
import json as _json
import js as _js
import _forgecode as _fc
import pygame._base as _b
from pygame._base import _flush, _cv, error
from pygame.surface import Surface
from pygame.constants import SRCALPHA

_st = {"surf": None, "caption": "pygame", "key": None, "n": 0, "init": False, "sent_keys": False}


def init():
    _st["init"] = True


def quit():
    if _st["surf"] is not None:
        _js.__fc_surface(_json.dumps({"op": "close", "key": _st["key"]}))
    _st["surf"] = None
    _st["init"] = False


def get_init():
    return _st["init"]


def _used_keys():
    # プロジェクトの .py から、使っているキー (K_LEFT など) を探す (タッチの端末で、そのキーのボタンを出す)
    names = set()
    n = 0
    for root, dirs, files in _os.walk(_os.getcwd()):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d != "__pycache__"]
        for fn in files:
            if not fn.endswith(".py") or n > 60:
                continue
            n += 1
            try:
                with open(_os.path.join(root, fn), encoding="utf-8", errors="replace") as fh:
                    names.update(_re.findall(r"\bK_(?:[A-Z]+|[a-z0-9])\b", fh.read(200000)))
            except Exception:
                pass
    order = ["K_UP", "K_LEFT", "K_DOWN", "K_RIGHT", "K_w", "K_a", "K_s", "K_d", "K_SPACE", "K_RETURN", "K_ESCAPE"]
    return sorted(names, key=lambda n: (order.index(n) if n in order else 99, n))


def set_mode(size=(0, 0), flags=0, depth=0, display=0, vsync=0):
    _b.init()
    _st["init"] = True
    w, h = int(size[0]) or 800, int(size[1]) or 600
    w, h = max(1, min(4096, w)), max(1, min(4096, h))
    if _st["surf"] is None or _st["surf"].get_size() != (w, h):
        _st["n"] += 1
        _st["key"] = "pg-%d" % _st["n"]
        _st["surf"] = Surface((w, h), 0)
        _st["surf"]._display = True
    if not _st["sent_keys"]:
        _st["sent_keys"] = True
        _js.__fc_surface(_json.dumps({"op": "keys", "keys": _used_keys()}))
    flip()
    return _st["surf"]


def get_surface():
    return _st["surf"]


def flip():
    s = _st["surf"]
    if s is None:
        raise error("video system not initialized")
    _flush()
    _cv("present")(s._sid, _st["key"], _st["caption"])
    from pygame import event
    event._pump_soft()


def update(*rects):
    flip()


def set_caption(title, icontitle=None):
    _st["caption"] = str(title)
    if _st["key"]:
        _js.__fc_surface(_json.dumps({"op": "caption", "key": _st["key"], "title": _st["caption"]}))


def get_caption():
    return (_st["caption"], _st["caption"])


def set_icon(surface):
    pass


def get_window_size():
    s = _st["surf"]
    return s.get_size() if s else (0, 0)


def get_desktop_sizes():
    return [(1280, 800)]


def list_modes(depth=0, flags=0, display=0):
    return [(1920, 1080), (1280, 720), (1024, 768), (800, 600), (640, 480)]


def mode_ok(size, flags=0, depth=0, display=0):
    return 32


def get_num_displays():
    return 1


def get_active():
    return _st["surf"] is not None


def iconify():
    return False


def toggle_fullscreen():
    return 1


def set_allow_screensaver(value=True):
    pass


def get_allow_screensaver():
    return True


def set_gamma(*a):
    return False


def get_driver():
    return "forgecode"


def get_wm_info():
    return {}


def is_fullscreen():
    return False


def is_vsync():
    return True


def get_current_refresh_rate():
    return 60


def get_desktop_refresh_rates():
    return [60]


class _Info:
    def __init__(self):
        s = _st["surf"]
        self.hw = 0
        self.wm = 1
        self.video_mem = 0
        self.bitsize = 32
        self.bytesize = 4
        self.current_w, self.current_h = s.get_size() if s else (1280, 800)
        self.blit_hw = self.blit_hw_CC = self.blit_hw_A = self.blit_sw = self.blit_sw_CC = self.blit_sw_A = 0
        self.masks = (0xFF0000, 0xFF00, 0xFF, 0)
        self.shifts = (16, 8, 0, 0)
        self.losses = (0, 0, 0, 8)

    def __repr__(self):
        return "<VideoInfo(current_w = %d, current_h = %d)>" % (self.current_w, self.current_h)


def Info():
    return _Info()


def _reset():
    _st.update(surf=None, caption="pygame", key=None, init=False, sent_keys=False)
`

const DRAW = String.raw`"""pygame.draw (図形を描く)"""
import math as _m
from pygame._base import _q
from pygame.rect import Rect


def _pt(p):
    return float(p[0]), float(p[1])


def _bound(surface, x1, y1, x2, y2):
    r = Rect(int(_m.floor(x1)), int(_m.floor(y1)), int(_m.ceil(x2 - x1)) + 1, int(_m.ceil(y2 - y1)) + 1)
    return r.clip(Rect(0, 0, surface._w, surface._h)) if r.colliderect(Rect(0, 0, surface._w, surface._h)) else Rect(r.x, r.y, 0, 0)


def rect(surface, color, rect, width=0, border_radius=0, border_top_left_radius=-1, border_top_right_radius=-1, border_bottom_left_radius=-1, border_bottom_right_radius=-1):
    r = Rect(rect)
    r.normalize()
    if width < 0:
        return Rect(r.x, r.y, 0, 0)
    rads = [border_top_left_radius, border_top_right_radius, border_bottom_left_radius, border_bottom_right_radius]
    rads = [border_radius if v < 0 else v for v in rads]
    limit = min(r.w, r.h) / 2
    rads = [max(0, min(limit, v)) for v in rads]
    _q(["rect", surface._sid, surface._css(color), r.x, r.y, r.w, r.h, width, rads if any(rads) else None])
    return r.clip(Rect(0, 0, surface._w, surface._h))


def circle(surface, color, center, radius, width=0, draw_top_right=None, draw_top_left=None, draw_bottom_left=None, draw_bottom_right=None):
    cx, cy = _pt(center)
    if radius < 1 or width < 0:
        return Rect(int(cx), int(cy), 0, 0)
    _q(["circle", surface._sid, surface._css(color), cx, cy, float(radius), width])
    return _bound(surface, cx - radius, cy - radius, cx + radius - 1, cy + radius - 1)


def ellipse(surface, color, rect, width=0):
    r = Rect(rect)
    r.normalize()
    _q(["ellipse", surface._sid, surface._css(color), r.x, r.y, r.w, r.h, width])
    return r.clip(Rect(0, 0, surface._w, surface._h))


def arc(surface, color, rect, start_angle, stop_angle, width=1):
    r = Rect(rect)
    r.normalize()
    _q(["arc", surface._sid, surface._css(color), r.x, r.y, r.w, r.h, float(start_angle), float(stop_angle), width])
    return r.clip(Rect(0, 0, surface._w, surface._h))


def line(surface, color, start_pos, end_pos, width=1):
    x1, y1 = _pt(start_pos)
    x2, y2 = _pt(end_pos)
    if width < 1:
        return Rect(int(x1), int(y1), 0, 0)
    _q(["line", surface._sid, surface._css(color), x1, y1, x2, y2, width])
    return _bound(surface, min(x1, x2) - width // 2, min(y1, y2) - width // 2, max(x1, x2) + width // 2, max(y1, y2) + width // 2)


def lines(surface, color, closed, points, width=1):
    pts = [_pt(p) for p in points]
    if len(pts) < 2:
        raise ValueError("points argument must contain 2 or more points")
    flat = [v for p in pts for v in p]
    _q(["lines", surface._sid, surface._css(color), bool(closed), flat, width])
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return _bound(surface, min(xs), min(ys), max(xs), max(ys))


def aaline(surface, color, start_pos, end_pos, blend=1):
    return line(surface, color, start_pos, end_pos, 1)


def aalines(surface, color, closed, points, blend=1):
    return lines(surface, color, closed, points, 1)


def polygon(surface, color, points, width=0):
    pts = [_pt(p) for p in points]
    if len(pts) < 3:
        raise ValueError("points argument must contain more than 2 points")
    flat = [v for p in pts for v in p]
    _q(["poly", surface._sid, surface._css(color), flat, width])
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return _bound(surface, min(xs), min(ys), max(xs), max(ys))
`

const GFXDRAW = String.raw`"""pygame.gfxdraw (よく使うものだけ)"""
from pygame import draw as _d
from pygame.rect import Rect


def pixel(surface, x, y, color):
    surface.set_at((x, y), color)


def hline(surface, x1, x2, y, color):
    _d.line(surface, color, (x1, y), (x2, y))


def vline(surface, x, y1, y2, color):
    _d.line(surface, color, (x, y1), (x, y2))


def line(surface, x1, y1, x2, y2, color):
    _d.line(surface, color, (x1, y1), (x2, y2))


def rectangle(surface, rect, color):
    _d.rect(surface, color, rect, 1)


def box(surface, rect, color):
    _d.rect(surface, color, rect)


def circle(surface, x, y, r, color):
    _d.circle(surface, color, (x, y), r, 1)


def aacircle(surface, x, y, r, color):
    _d.circle(surface, color, (x, y), r, 1)


def filled_circle(surface, x, y, r, color):
    _d.circle(surface, color, (x, y), r)


def ellipse(surface, x, y, rx, ry, color):
    _d.ellipse(surface, color, (x - rx, y - ry, rx * 2, ry * 2), 1)


def aaellipse(surface, x, y, rx, ry, color):
    ellipse(surface, x, y, rx, ry, color)


def filled_ellipse(surface, x, y, rx, ry, color):
    _d.ellipse(surface, color, (x - rx, y - ry, rx * 2, ry * 2))


def arc(surface, x, y, r, start, end, color):
    import math
    _d.arc(surface, color, (x - r, y - r, r * 2, r * 2), math.radians(-end), math.radians(-start), 1)


def pie(surface, x, y, r, start, end, color):
    arc(surface, x, y, r, start, end, color)


def trigon(surface, x1, y1, x2, y2, x3, y3, color):
    _d.polygon(surface, color, [(x1, y1), (x2, y2), (x3, y3)], 1)


def aatrigon(surface, x1, y1, x2, y2, x3, y3, color):
    trigon(surface, x1, y1, x2, y2, x3, y3, color)


def filled_trigon(surface, x1, y1, x2, y2, x3, y3, color):
    _d.polygon(surface, color, [(x1, y1), (x2, y2), (x3, y3)])


def polygon(surface, points, color):
    _d.polygon(surface, color, points, 1)


def aapolygon(surface, points, color):
    polygon(surface, points, color)


def filled_polygon(surface, points, color):
    _d.polygon(surface, color, points)


def textured_polygon(surface, points, texture, tx, ty):
    _d.polygon(surface, (128, 128, 128), points)


def bezier(surface, points, steps, color):
    pts = []
    n = len(points) - 1
    from math import comb
    for i in range(steps + 1):
        t = i / steps
        x = sum(comb(n, k) * (1 - t) ** (n - k) * t ** k * points[k][0] for k in range(n + 1))
        y = sum(comb(n, k) * (1 - t) ** (n - k) * t ** k * points[k][1] for k in range(n + 1))
        pts.append((x, y))
    _d.lines(surface, color, False, pts)
`

const EVENT = String.raw`"""pygame.event (キー・マウスなどの出来事)"""
import time as _t
import heapq as _hq
import _forgecode as _fc
from pygame.constants import *
from pygame import _keys

_queue = []
_st = {"blocked": set(), "allowed": None, "grab": False, "custom": USEREVENT, "timers": [], "seq": 0, "last_pump": 0.0}
_NAMES = {NOEVENT: "NoEvent", QUIT: "Quit", KEYDOWN: "KeyDown", KEYUP: "KeyUp", TEXTINPUT: "TextInput", MOUSEMOTION: "MouseMotion",
          MOUSEBUTTONDOWN: "MouseButtonDown", MOUSEBUTTONUP: "MouseButtonUp", MOUSEWHEEL: "MouseWheel", USEREVENT: "UserEvent",
          ACTIVEEVENT: "ActiveEvent", VIDEORESIZE: "VideoResize", VIDEOEXPOSE: "VideoExpose", WINDOWCLOSE: "WindowClose",
          FINGERDOWN: "FingerDown", FINGERUP: "FingerUp", FINGERMOTION: "FingerMotion"}


class Event:
    def __init__(self, type, dict=None, **kwargs):
        self.__dict__.update(dict or {})
        self.__dict__.update(kwargs)
        self.__dict__["type"] = int(type)

    @property
    def dict(self):
        return {k: v for k, v in self.__dict__.items() if k != "type"}

    def __eq__(self, o):
        return isinstance(o, Event) and self.__dict__ == o.__dict__

    def __bool__(self):
        return self.type != NOEVENT

    def __repr__(self):
        return "<Event(%d-%s %s)>" % (self.type, event_name(self.type), self.dict)


EventType = Event


def event_name(type):
    if type in _NAMES:
        return _NAMES[type]
    if USEREVENT <= type < NUMEVENTS:
        return "UserEvent"
    return "Unknown"


def custom_type():
    _st["custom"] += 1
    return _st["custom"]


def _ok(t):
    if t in _st["blocked"]:
        return False
    return _st["allowed"] is None or t in _st["allowed"]


def _add(ev):
    if _ok(ev.type):
        _queue.append(ev)
        if len(_queue) > 4096:
            del _queue[:1024]


def _timers():
    now = _t.monotonic()
    tm = _st["timers"]
    while tm and tm[0][0] <= now:
        due, seq, ev, ms, loops = _hq.heappop(tm)
        _add(Event(ev.type, ev.dict) if isinstance(ev, Event) else Event(ev))
        if loops != 1:
            _hq.heappush(tm, (max(due + ms / 1000.0, now), seq, ev, ms, loops - 1 if loops > 1 else 0))


def pump():
    from pygame import mouse
    for e in _fc.take_events("pg"):
        t = e.get("t")
        if t in ("kd", "ku"):
            k = _keys.from_browser(e.get("k", ""), e.get("c", ""))
            mods = _keys.mods_from(e.get("m", 0))
            _keys.MOD[0] = mods
            if t == "kd":
                if e.get("r") and not _keys.REPEAT[0]:
                    continue
                _keys.PRESSED.add(k)
                _keys.JUST_DOWN.add(k)
                uni = e.get("k", "") if len(e.get("k", "")) == 1 else {"Enter": "\r", "Tab": "\t", "Backspace": "\b", "Escape": "\x1b"}.get(e.get("k", ""), "")
                _add(Event(KEYDOWN, key=k, mod=mods, unicode=uni, scancode=_keys.scancode(k), window=None))
                if len(e.get("k", "")) == 1 and not (mods & (KMOD_CTRL | KMOD_META)):
                    _add(Event(TEXTINPUT, text=e.get("k"), window=None))
            else:
                _keys.PRESSED.discard(k)
                _keys.JUST_UP.add(k)
                _add(Event(KEYUP, key=k, mod=mods, unicode="", scancode=_keys.scancode(k), window=None))
        elif t in ("md", "mu"):
            pos = (int(e.get("x", 0)), int(e.get("y", 0)))
            b = int(e.get("b", 1))
            mouse._st["pos"] = pos
            if t == "md":
                mouse._st["buttons"].add(b)
                mouse._st["just_down"].add(b)
                _add(Event(MOUSEBUTTONDOWN, pos=pos, button=b, touch=False, window=None))
            else:
                mouse._st["buttons"].discard(b)
                mouse._st["just_up"].add(b)
                _add(Event(MOUSEBUTTONUP, pos=pos, button=b, touch=False, window=None))
        elif t == "mm":
            pos = (int(e.get("x", 0)), int(e.get("y", 0)))
            old = mouse._st["pos"]
            rel = (pos[0] - old[0], pos[1] - old[1])
            mouse._st["pos"] = pos
            mouse._st["rel"] = (mouse._st["rel"][0] + rel[0], mouse._st["rel"][1] + rel[1])
            bs = int(e.get("bs", 0))
            _add(Event(MOUSEMOTION, pos=pos, rel=rel, buttons=(bs & 1 and 1 or 0, bs & 4 and 1 or 0, bs & 2 and 1 or 0), touch=False, window=None))
        elif t == "mw":
            _add(Event(MOUSEWHEEL, x=int(e.get("dx", 0)), y=int(e.get("dy", 0)), flipped=False, precise_x=float(e.get("dx", 0)), precise_y=float(e.get("dy", 0)), touch=False, window=None))
            b = 4 if e.get("dy", 0) > 0 else 5
            _add(Event(MOUSEBUTTONDOWN, pos=mouse._st["pos"], button=b, touch=False, window=None))
            _add(Event(MOUSEBUTTONUP, pos=mouse._st["pos"], button=b, touch=False, window=None))
        elif t == "quit":
            _add(Event(QUIT))
            _add(Event(WINDOWCLOSE, window=None))
    _timers()
    _st["last_pump"] = _t.monotonic()


def _pump_soft():
    # flip() のついで (イベントを読まないゲームでも、キーの状態とタイマーが進むように)
    pump()


def get(eventtype=None, pump=True, exclude=None):
    if pump:
        globals()["pump"]()
    if eventtype is None and exclude is None:
        out = list(_queue)
        _queue.clear()
        return out
    types = _types(eventtype) if eventtype is not None else None
    ex = _types(exclude) if exclude is not None else set()
    out, keep = [], []
    for e in _queue:
        if (types is None or e.type in types) and e.type not in ex:
            out.append(e)
        else:
            keep.append(e)
    _queue[:] = keep
    return out


def _types(t):
    if isinstance(t, int):
        return {t}
    return set(t)


def poll():
    globals()["pump"]()
    return _queue.pop(0) if _queue else Event(NOEVENT)


def wait(timeout=0):
    end = _t.monotonic() + timeout / 1000.0 if timeout else None
    from pygame import display
    while True:
        globals()["pump"]()
        if _queue:
            return _queue.pop(0)
        if end is not None and _t.monotonic() >= end:
            return Event(NOEVENT)
        wait_ms = 50
        if _st["timers"]:
            wait_ms = max(1, min(wait_ms, int((_st["timers"][0][0] - _t.monotonic()) * 1000)))
        if not _fc.events_ok():
            _fc.sleep(wait_ms / 1000.0)
        else:
            _fc.wait_events(wait_ms)


def peek(eventtype=None, pump=True):
    if pump:
        globals()["pump"]()
    if eventtype is None:
        return bool(_queue)
    types = _types(eventtype)
    return any(e.type in types for e in _queue)


def clear(eventtype=None, pump=True):
    if pump:
        globals()["pump"]()
    if eventtype is None:
        _queue.clear()
    else:
        types = _types(eventtype)
        _queue[:] = [e for e in _queue if e.type not in types]


def post(ev):
    if _ok(ev.type):
        _queue.append(ev)
        return True
    return False


def set_blocked(t):
    if t is None:
        _st["blocked"] = set()
        _st["allowed"] = None
        return
    _st["blocked"] |= _types(t)


def set_allowed(t):
    if t is None:
        _st["blocked"] = set()
        _st["allowed"] = None
        return
    if _st["allowed"] is None:
        _st["allowed"] = None
    _st["blocked"] -= _types(t)


def get_blocked(t):
    return bool(_types(t) & _st["blocked"])


def set_grab(on):
    _st["grab"] = bool(on)


def get_grab():
    return _st["grab"]


def set_keyboard_grab(on):
    pass


def get_keyboard_grab():
    return False


def _set_timer(ev, millis, loops=0):
    _st["timers"] = [t for t in _st["timers"] if not (t[2] == ev or (isinstance(t[2], Event) and isinstance(ev, int) and t[2].type == ev))]
    _hq.heapify(_st["timers"])
    if millis > 0:
        _st["seq"] += 1
        _hq.heappush(_st["timers"], (_t.monotonic() + millis / 1000.0, _st["seq"], ev, millis, loops))


def _reset():
    _queue.clear()
    _st.update(blocked=set(), allowed=None, grab=False, custom=USEREVENT, timers=[], seq=0, last_pump=0.0)
`

const KEYS = String.raw`"""ブラウザのキー → pygame のキー"""
from pygame.constants import *

PRESSED = set()
JUST_DOWN = set()
JUST_UP = set()
MOD = [0]
REPEAT = [0, 0]

_CODE = {
    "ArrowUp": K_UP, "ArrowDown": K_DOWN, "ArrowLeft": K_LEFT, "ArrowRight": K_RIGHT, "Space": K_SPACE, "Enter": K_RETURN,
    "NumpadEnter": K_KP_ENTER, "Escape": K_ESCAPE, "Backspace": K_BACKSPACE, "Tab": K_TAB, "Delete": K_DELETE, "Insert": K_INSERT,
    "Home": K_HOME, "End": K_END, "PageUp": K_PAGEUP, "PageDown": K_PAGEDOWN, "ShiftLeft": K_LSHIFT, "ShiftRight": K_RSHIFT,
    "ControlLeft": K_LCTRL, "ControlRight": K_RCTRL, "AltLeft": K_LALT, "AltRight": K_RALT, "MetaLeft": K_LMETA, "MetaRight": K_RMETA,
    "CapsLock": K_CAPSLOCK, "Minus": K_MINUS, "Equal": K_EQUALS, "BracketLeft": K_LEFTBRACKET, "BracketRight": K_RIGHTBRACKET,
    "Backslash": K_BACKSLASH, "Semicolon": K_SEMICOLON, "Quote": K_QUOTE, "Backquote": K_BACKQUOTE, "Comma": K_COMMA,
    "Period": K_PERIOD, "Slash": K_SLASH, "NumpadAdd": K_KP_PLUS, "NumpadSubtract": K_KP_MINUS, "NumpadMultiply": K_KP_MULTIPLY,
    "NumpadDivide": K_KP_DIVIDE, "NumpadDecimal": K_KP_PERIOD, "Pause": K_PAUSE, "PrintScreen": K_PRINT, "ScrollLock": K_SCROLLOCK,
    "NumLock": K_NUMLOCK, "ContextMenu": K_MENU,
}
for _i in range(10):
    _CODE["Digit%d" % _i] = 48 + _i
    _CODE["Numpad%d" % _i] = [K_KP0, K_KP1, K_KP2, K_KP3, K_KP4, K_KP5, K_KP6, K_KP7, K_KP8, K_KP9][_i]
for _i in range(26):
    _CODE["Key" + chr(65 + _i)] = 97 + _i
for _i in range(1, 16):
    _CODE["F%d" % _i] = (K_F1 + _i - 1) if _i <= 12 else (K_F13 + _i - 13)
_KEY = {"ArrowUp": K_UP, "ArrowDown": K_DOWN, "ArrowLeft": K_LEFT, "ArrowRight": K_RIGHT, " ": K_SPACE, "Enter": K_RETURN,
        "Escape": K_ESCAPE, "Backspace": K_BACKSPACE, "Tab": K_TAB, "Shift": K_LSHIFT, "Control": K_LCTRL, "Alt": K_LALT, "Meta": K_LMETA}


def from_browser(key, code):
    if code in _CODE:
        return _CODE[code]
    if key in _KEY:
        return _KEY[key]
    if len(key) == 1:
        c = key.lower()
        return ord(c)
    return K_UNKNOWN


def mods_from(m):
    r = 0
    if m & 1:
        r |= KMOD_LSHIFT
    if m & 2:
        r |= KMOD_LCTRL
    if m & 4:
        r |= KMOD_LALT
    if m & 8:
        r |= KMOD_LMETA
    return r


def scancode(k):
    if k >= 1073741824:
        return k - 1073741824
    if 97 <= k <= 122:
        return k - 93
    if 49 <= k <= 57:
        return k - 19
    return {48: 39, 13: 40, 27: 41, 8: 42, 9: 43, 32: 44}.get(k, 0)


NAMES = {}
for _n, _v in list(globals().items()):
    if _n.startswith("K_") and isinstance(_v, int):
        NAMES.setdefault(_v, _n[2:].lower())
NAMES.update({K_UP: "up", K_DOWN: "down", K_LEFT: "left", K_RIGHT: "right", K_SPACE: "space", K_RETURN: "return", K_ESCAPE: "escape",
              K_LSHIFT: "left shift", K_RSHIFT: "right shift", K_LCTRL: "left ctrl", K_RCTRL: "right ctrl"})
`

const KEY = String.raw`"""pygame.key (キーボード)"""
from pygame.constants import *
from pygame import _keys


class ScancodeWrapper(tuple):
    """get_pressed() の結果: pressed[pygame.K_LEFT] のように使う"""

    def __new__(cls, pressed):
        obj = super().__new__(cls, [False] * 512)
        obj._pressed = frozenset(pressed)
        return obj

    def __getitem__(self, k):
        if isinstance(k, slice):
            return tuple(self._has(i) for i in range(512)[k])
        return self._has(k)

    def _has(self, k):
        return k in self._pressed or (0 <= k < 512 and (k + 1073741824) in self._pressed)

    def __iter__(self):
        return (self._has(i) for i in range(512))


def get_pressed():
    from pygame import event
    event.pump()
    return ScancodeWrapper(_keys.PRESSED)


def get_just_pressed():
    from pygame import event
    event.pump()
    out = ScancodeWrapper(_keys.JUST_DOWN)
    _keys.JUST_DOWN.clear()
    return out


def get_just_released():
    from pygame import event
    event.pump()
    out = ScancodeWrapper(_keys.JUST_UP)
    _keys.JUST_UP.clear()
    return out


def get_mods():
    return _keys.MOD[0]


def set_mods(m):
    _keys.MOD[0] = m


def get_focused():
    return True


def set_repeat(delay=0, interval=0):
    _keys.REPEAT[0], _keys.REPEAT[1] = delay, interval


def get_repeat():
    return (_keys.REPEAT[0], _keys.REPEAT[1])


def name(key, use_compat=True):
    return _keys.NAMES.get(key, "")


def key_code(name):
    n = name.lower().replace(" ", "")
    for k, v in _keys.NAMES.items():
        if v.replace(" ", "") == n:
            return k
    raise ValueError("unknown key name")


def start_text_input():
    pass


def stop_text_input():
    pass


def set_text_input_rect(rect):
    pass


def _reset():
    _keys.PRESSED.clear()
    _keys.JUST_DOWN.clear()
    _keys.JUST_UP.clear()
    _keys.MOD[0] = 0
    _keys.REPEAT[0] = _keys.REPEAT[1] = 0
`

const MOUSE = String.raw`"""pygame.mouse (マウス・タップ)"""
_st = {"pos": (0, 0), "rel": (0, 0), "buttons": set(), "just_down": set(), "just_up": set(), "visible": True, "focused": True}


def get_pos(desktop=False):
    from pygame import event
    event.pump()
    return _st["pos"]


def get_rel():
    from pygame import event
    event.pump()
    r = _st["rel"]
    _st["rel"] = (0, 0)
    return r


def get_pressed(num_buttons=3, desktop=False):
    from pygame import event
    event.pump()
    b = _st["buttons"]
    out = (1 in b, 2 in b, 3 in b)
    if num_buttons == 5:
        out = out + (6 in b, 7 in b)
    return out


def get_just_pressed():
    from pygame import event
    event.pump()
    b = _st["just_down"]
    out = (1 in b, 2 in b, 3 in b, 6 in b, 7 in b)
    b.clear()
    return out


def get_just_released():
    from pygame import event
    event.pump()
    b = _st["just_up"]
    out = (1 in b, 2 in b, 3 in b, 6 in b, 7 in b)
    b.clear()
    return out


def set_pos(*pos):
    p = pos[0] if len(pos) == 1 else pos
    _st["pos"] = (int(p[0]), int(p[1]))


def set_visible(v):
    old = _st["visible"]
    _st["visible"] = bool(v)
    return old


def get_visible():
    return _st["visible"]


def get_focused():
    return True


def set_cursor(*a, **k):
    pass


def get_cursor():
    return None


def set_system_cursor(*a):
    pass


def _reset():
    _st.update(pos=(0, 0), rel=(0, 0), buttons=set(), just_down=set(), just_up=set(), visible=True)
`

const TIME = String.raw`"""pygame.time (時間)"""
import time as _t
import _forgecode as _fc

_start = [_t.monotonic()]


def get_ticks():
    return int((_t.monotonic() - _start[0]) * 1000)


def wait(milliseconds):
    t0 = _t.monotonic()
    _fc.sleep(max(0, milliseconds) / 1000.0)
    return int((_t.monotonic() - t0) * 1000)


delay = wait


def set_timer(event, millis, loops=0):
    from pygame import event as _ev
    _ev._set_timer(event, int(millis), int(loops))


class Clock:
    def __init__(self):
        self._last = _t.monotonic()
        self._time = 0
        self._raw = 0
        self._ticks = []

    def tick(self, framerate=0):
        now = _t.monotonic()
        self._raw = int((now - self._last) * 1000)
        if framerate and framerate > 0:
            target = self._last + 1.0 / framerate
            if target > now:
                _fc.sleep(target - now)
                now = _t.monotonic()
        else:
            _fc.sleep(0)
        self._time = int((now - self._last) * 1000)
        self._last = now
        self._ticks.append(now)
        if len(self._ticks) > 30:
            del self._ticks[0]
        return self._time

    tick_busy_loop = tick

    def get_time(self):
        return self._time

    def get_rawtime(self):
        return self._raw

    def get_fps(self):
        if len(self._ticks) < 2:
            return 0.0
        span = self._ticks[-1] - self._ticks[0]
        return (len(self._ticks) - 1) / span if span > 0 else 0.0

    def __repr__(self):
        return "<Clock(fps=%.2f)>" % self.get_fps()


def _reset():
    _start[0] = _t.monotonic()
`

const FONT = String.raw`"""pygame.font (文字)"""
import os as _os
import math as _m
import pygame._base as _b
from pygame._base import _q, _cv, error
from pygame.surface import Surface
from pygame.constants import SRCALPHA
from pygame.color import css

_UI = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif'
_FAMILIES = {
    "arial": "Arial, Helvetica", "helvetica": "Helvetica, Arial", "freesans": "Helvetica, Arial", "freesansbold": "Helvetica, Arial",
    "timesnewroman": '"Times New Roman", Times, serif', "times": "Times, serif", "georgia": "Georgia, serif", "serif": "serif",
    "couriernew": '"Courier New", Courier, monospace', "courier": "Courier, monospace", "consolas": "Consolas, monospace", "monospace": "ui-monospace, Menlo, monospace",
    "comicsansms": '"Comic Sans MS", "Comic Sans", cursive', "comicsans": '"Comic Sans MS", cursive', "impact": "Impact, sans-serif",
    "verdana": "Verdana, sans-serif", "tahoma": "Tahoma, sans-serif", "trebuchetms": '"Trebuchet MS", sans-serif', "segoeui": '"Segoe UI", sans-serif',
    "meiryo": "Meiryo", "msgothic": '"MS Gothic", monospace', "yugothic": '"Yu Gothic"', "hiraginosans": '"Hiragino Sans"', "notosansjp": '"Noto Sans JP"',
}
_init = [False]
_loaded = {}


def init():
    _init[0] = True


def quit():
    _init[0] = False


def get_init():
    return _init[0]


def get_default_font():
    return "freesansbold.ttf"


def get_fonts():
    return sorted(_FAMILIES)


def match_font(name, bold=False, italic=False):
    return None


def _family(name):
    if not name:
        return "Helvetica, Arial, " + _UI
    out = []
    for n in str(name).split(","):
        k = n.strip().lower().replace(" ", "").replace("_", "")
        out.append(_FAMILIES.get(k) or '"%s"' % n.strip().replace('"', ""))
    return ", ".join(out) + ", " + _UI


class Font:
    def __init__(self, file=None, size=20):
        size = int(size) if size else 12
        self._bold = False
        self._italic = False
        self._underline = False
        self._strike = False
        self._align = 0
        self.point_size = size
        if file is None or (isinstance(file, str) and _os.path.basename(file).lower().startswith("freesans")):
            self._px = max(1, int(round(size * 0.6875)))
            self._family = "Helvetica, Arial, " + _UI
            self._bold = file is None or "bold" in str(file).lower()
            self._default_bold = self._bold
        else:
            self._px = max(1, size)
            self._family = self._load(file)
            self._default_bold = False
        self._metrics_cache = {}

    def _load(self, file):
        path = getattr(file, "name", file)
        name = "fcfont%d" % (len(_loaded) + 1)
        try:
            if hasattr(file, "read"):
                data = file.read()
            else:
                with open(file, "rb") as f:
                    data = f.read()
        except OSError:
            raise FileNotFoundError("No file '%s' found in working directory '%s'." % (path, _os.getcwd()))
        key = str(path)
        if key in _loaded:
            return _loaded[key]
        from pyodide.ffi import to_js
        ok = _cv("font")(name, to_js(data))
        fam = ('"%s", ' % name if ok else "") + _UI
        _loaded[key] = fam
        return fam

    def _css(self):
        return "%s%s%dpx %s" % ("italic " if self._italic else "", "bold " if self._bold else "", self._px, self._family)

    def _measure(self, text):
        k = (self._css(), text)
        m = self._metrics_cache.get(k)
        if m is None:
            r = _cv("measure")(self._css(), text)
            m = (float(r[0]), float(r[1]), float(r[2]))
            if len(self._metrics_cache) > 512:
                self._metrics_cache.clear()
            self._metrics_cache[k] = m
        return m

    def render(self, text, antialias=True, color=(255, 255, 255), background=None, wraplength=0):
        if text is None:
            text = ""
        if isinstance(text, bytes):
            text = text.decode("utf-8", "replace")
        text = str(text)
        lines = text.split("\n") if ("\n" in text or wraplength) else [text]
        if wraplength:
            lines = self._wrap(lines, wraplength)
        if len(lines) > 1:
            surfs = [self.render(l, antialias, color, background) for l in lines]
            w = max(s.get_width() for s in surfs)
            h = self.get_linesize() * len(surfs)
            out = Surface((max(1, w), max(1, h)), 0 if background is not None else SRCALPHA)
            if background is not None:
                out.fill(background)
            for i, s in enumerate(surfs):
                out.blit(s, (0, i * self.get_linesize()))
            return out
        width, asc, desc = self._measure(text)
        w = max(1, int(_m.ceil(width)))
        h = max(1, int(_m.ceil(asc + desc)))
        s = Surface((w if text else 1, h), 0 if background is not None else SRCALPHA)
        _q(["text", s._sid, self._css(), text, 0, asc, css(color), css(background) if background is not None else None, self._underline])
        return s

    def _wrap(self, lines, maxw):
        out = []
        for line in lines:
            cur = ""
            for ch in line:
                if self._measure(cur + ch)[0] > maxw and cur:
                    out.append(cur)
                    cur = ch
                else:
                    cur += ch
            out.append(cur)
        return out

    def size(self, text):
        width, asc, desc = self._measure(str(text))
        return (int(_m.ceil(width)), int(_m.ceil(asc + desc)))

    def get_linesize(self):
        w, a, d = self._measure("Mg")
        return int(_m.ceil((a + d) * 1.05))

    def get_height(self):
        w, a, d = self._measure("Mg")
        return int(_m.ceil(a + d))

    def get_ascent(self):
        return int(_m.ceil(self._measure("Mg")[1]))

    def get_descent(self):
        return -int(_m.ceil(self._measure("Mg")[2]))

    def get_point_size(self):
        return self.point_size

    def set_point_size(self, size):
        self.point_size = int(size)
        self._px = int(size)

    def metrics(self, text):
        out = []
        for ch in str(text):
            w = self._measure(ch)[0]
            out.append((0, int(w), 0, self.get_ascent(), int(round(w))))
        return out

    def set_bold(self, v):
        self._bold = bool(v)

    def get_bold(self):
        return self._bold

    def set_italic(self, v):
        self._italic = bool(v)

    def get_italic(self):
        return self._italic

    def set_underline(self, v):
        self._underline = bool(v)

    def get_underline(self):
        return self._underline

    def set_strikethrough(self, v):
        self._strike = bool(v)

    def get_strikethrough(self):
        return self._strike

    bold = property(get_bold, set_bold)
    italic = property(get_italic, set_italic)
    underline = property(get_underline, set_underline)
    strikethrough = property(get_strikethrough, set_strikethrough)

    @property
    def name(self):
        return self._family.split(",")[0].strip('"')

    @property
    def style_name(self):
        return "Bold" if self._bold else "Regular"

    def set_script(self, s):
        pass

    def set_direction(self, d):
        pass


FontType = Font


def SysFont(name, size, bold=False, italic=False, constructor=None):
    f = Font.__new__(Font)
    Font.__init__(f, None, size)
    f._px = max(1, int(size))
    f._family = _family(name)
    f._bold = bool(bold)
    f._italic = bool(italic)
    return f
`

const IMAGE = String.raw`"""pygame.image (画像の読み込み・保存)"""
import os as _os
import io as _io
import zlib as _zlib
import struct as _struct
import js as _js
from pygame._base import _cv, _flush, error
from pygame.surface import Surface, _adopt
from pygame.constants import SRCALPHA


def get_extended():
    return True


def get_sdl_image_version(linked=True):
    return (2, 8, 0)


def load(file, namehint=""):
    if hasattr(file, "read"):
        data = file.read()
    else:
        path = _os.fspath(file)
        if not _os.path.exists(path):
            raise FileNotFoundError("No file '%s' found in working directory '%s'." % (path, _os.getcwd()))
        with open(path, "rb") as f:
            data = f.read()
    if not data:
        raise error("Unsupported image format")
    from pyodide.ffi import to_js
    try:
        c = _js.__fc_image_canvas(to_js(data))
    except Exception as e:
        raise error("画像を読み込めませんでした: %s" % (str(e).split("\n")[-1]))
    if c is None:
        raise KeyboardInterrupt
    return _adopt(c, True)


load_basic = load
load_extended = load


def _png(w, h, rgba):
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]

    def chunk(t, d):
        c = t + d
        return _struct.pack(">I", len(d)) + c + _struct.pack(">I", _zlib.crc32(c) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", _struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", _zlib.compress(bytes(raw), 6)) + chunk(b"IEND", b""))


def save(surface, file, namehint=""):
    w, h = surface.get_size()
    data = _png(w, h, surface._pixels(0, 0, w, h))
    if hasattr(file, "write"):
        file.write(data)
    else:
        with open(file, "wb") as f:
            f.write(data)


save_extended = save


def tobytes(surface, format="RGBA", flipped=False, pitch=-1):
    w, h = surface.get_size()
    d = surface._pixels(0, 0, w, h)
    if format == "RGB":
        d = bytes(b for i, b in enumerate(d) if i % 4 != 3)
    if flipped:
        n = len(d) // h
        d = b"".join(d[y * n:(y + 1) * n] for y in range(h - 1, -1, -1))
    return d


tostring = tobytes


def frombytes(data, size, format="RGBA", flipped=False, pitch=-1):
    w, h = int(size[0]), int(size[1])
    data = bytes(data)
    if format == "RGB":
        out = bytearray(w * h * 4)
        out[0::4], out[1::4], out[2::4] = data[0::3], data[1::3], data[2::3]
        out[3::4] = b"\xff" * (w * h)
        data = bytes(out)
    if flipped:
        n = w * 4
        data = b"".join(data[y * n:(y + 1) * n] for y in range(h - 1, -1, -1))
    s = Surface((w, h), SRCALPHA)
    _flush()
    from pyodide.ffi import to_js
    _cv("put")(s._sid, to_js(data), 0, 0, w, h)
    return s


fromstring = frombytes


def frombuffer(data, size, format="RGBA", pitch=-1):
    return frombytes(data, size, format)
`

const TRANSFORM = String.raw`"""pygame.transform (拡大・回転・反転)"""
import math as _m
from pygame._base import _q
from pygame.surface import Surface
from pygame.constants import SRCALPHA


def _new(src, w, h, alpha=None):
    s = Surface((max(0, int(w)), max(0, int(h))), SRCALPHA if (src._alpha if alpha is None else alpha) else 0)
    s._ck = src._ck
    s._salpha = src._salpha
    return s


def scale(surface, size, dest_surface=None):
    w, h = int(size[0]), int(size[1])
    s = dest_surface or _new(surface, w, h)
    _q(["scale", s._sid, surface._sid, False])
    return s


def scale_by(surface, factor, dest_surface=None):
    fx, fy = (factor, factor) if isinstance(factor, (int, float)) else factor
    return scale(surface, (surface._w * fx, surface._h * fy), dest_surface)


def smoothscale(surface, size, dest_surface=None):
    w, h = int(size[0]), int(size[1])
    s = dest_surface or _new(surface, w, h)
    _q(["scale", s._sid, surface._sid, True])
    return s


def smoothscale_by(surface, factor, dest_surface=None):
    fx, fy = (factor, factor) if isinstance(factor, (int, float)) else factor
    return smoothscale(surface, (surface._w * fx, surface._h * fy), dest_surface)


def scale2x(surface, dest_surface=None):
    return scale(surface, (surface._w * 2, surface._h * 2), dest_surface)


def _rot(surface, angle, zoom, smooth):
    a = _m.radians(angle)
    c, s = abs(_m.cos(a)), abs(_m.sin(a))
    w = surface._w * zoom
    h = surface._h * zoom
    nw, nh = int(_m.ceil(w * c + h * s - 1e-9)), int(_m.ceil(w * s + h * c - 1e-9))
    out = _new(surface, nw, nh, True)
    _q(["rot", out._sid, surface._sid, float(angle), float(zoom), bool(smooth)])
    return out


def rotate(surface, angle):
    return _rot(surface, angle, 1.0, False)


def rotozoom(surface, angle, scale):
    return _rot(surface, angle, scale, True)


def flip(surface, flip_x, flip_y):
    s = _new(surface, surface._w, surface._h)
    _q(["flip", s._sid, surface._sid, bool(flip_x), bool(flip_y)])
    return s


def grayscale(surface, dest_surface=None):
    s = dest_surface or _new(surface, surface._w, surface._h)
    _q(["gray", s._sid, surface._sid])
    return s


def chop(surface, rect):
    from pygame.rect import Rect
    r = Rect(rect)
    w = surface._w - r.w
    h = surface._h - r.h
    out = _new(surface, max(0, w), max(0, h))
    parts = [(0, 0, r.x, r.y, 0, 0), (r.right, 0, surface._w - r.right, r.y, r.x, 0),
             (0, r.bottom, r.x, surface._h - r.bottom, 0, r.y), (r.right, r.bottom, surface._w - r.right, surface._h - r.bottom, r.x, r.y)]
    for sx, sy, sw, sh, dx, dy in parts:
        if sw > 0 and sh > 0:
            _q(["blit", out._sid, surface._sid, dx, dy, sx, sy, sw, sh, -1, None, 0])
    return out


def laplacian(surface, dest_surface=None):
    return surface.copy()


def average_color(surface, rect=None, consider_alpha=False):
    from pygame.rect import Rect
    r = Rect(rect) if rect else surface.get_rect()
    d = surface._pixels(r.x, r.y, r.w, r.h)
    n = max(1, len(d) // 4)
    return tuple(sum(d[i::4]) // n for i in range(4))


def threshold(*a, **k):
    return 0
`

const MIXER = String.raw`"""pygame.mixer (音): 画面側の Web Audio で鳴らします"""
import os as _os
import json as _json
import js as _js
from pygame._base import error

_st = {"init": False, "n": 0, "num_channels": 8}


def _send(m, data=None):
    from pyodide.ffi import to_js
    _js.__fc_sound(_json.dumps(m), to_js(data) if data is not None else None)


def init(frequency=44100, size=-16, channels=2, buffer=512, devicename=None, allowedchanges=5):
    _st["init"] = True


def pre_init(*a, **k):
    pass


def quit():
    stop()
    _st["init"] = False


def get_init():
    return (44100, -16, 2) if _st["init"] else None


def stop():
    _send({"op": "stopall"})


def pause():
    _send({"op": "pause"})


def unpause():
    _send({"op": "unpause"})


def fadeout(time):
    stop()


def set_num_channels(count):
    _st["num_channels"] = int(count)


def get_num_channels():
    return _st["num_channels"]


def set_reserved(count):
    return count


def get_busy():
    return False


def find_channel(force=False):
    return Channel(0)


def get_sdl_mixer_version(linked=True):
    return (2, 8, 0)


def _read(file):
    if hasattr(file, "read"):
        return file.read()
    path = _os.fspath(file)
    if not _os.path.exists(path):
        raise FileNotFoundError("No file '%s' found in working directory '%s'." % (path, _os.getcwd()))
    with open(path, "rb") as f:
        return f.read()


class Sound:
    def __init__(self, file=None, buffer=None, array=None):
        _st["n"] += 1
        self._id = "s%d" % _st["n"]
        self._vol = 1.0
        self._sent = False
        if buffer is not None:
            self._data = bytes(buffer)
        elif file is not None:
            self._data = file if isinstance(file, (bytes, bytearray)) else _read(file)
        else:
            self._data = b""

    def play(self, loops=0, maxtime=0, fade_ms=0):
        data = None if self._sent else self._data
        self._sent = True
        _send({"op": "play", "id": self._id, "loops": int(loops), "maxtime": int(maxtime), "volume": self._vol}, data)
        return Channel(0)

    def stop(self):
        _send({"op": "stop", "id": self._id})

    def fadeout(self, time):
        self.stop()

    def set_volume(self, value):
        self._vol = max(0.0, min(1.0, float(value)))
        _send({"op": "volume", "id": self._id, "volume": self._vol})

    def get_volume(self):
        return self._vol

    def get_num_channels(self):
        return 0

    def get_length(self):
        return 0.0

    def get_raw(self):
        return self._data


SoundType = Sound


class Channel:
    def __init__(self, id=0):
        self.id = id
        self._vol = 1.0

    def play(self, sound, loops=0, maxtime=0, fade_ms=0):
        sound.play(loops, maxtime, fade_ms)

    def stop(self):
        pass

    def pause(self):
        pass

    def unpause(self):
        pass

    def fadeout(self, time):
        pass

    def set_volume(self, value, right=None):
        self._vol = value

    def get_volume(self):
        return self._vol

    def get_busy(self):
        return False

    def get_sound(self):
        return None

    def queue(self, sound):
        sound.play()

    def get_queue(self):
        return None

    def set_endevent(self, type=None):
        pass

    def get_endevent(self):
        return 0


ChannelType = Channel


class _Music:
    def __init__(self):
        self._snd = None
        self._vol = 1.0
        self._playing = False
        self._paused = False

    def load(self, filename, namehint=""):
        self._snd = Sound(filename)
        self._snd._id = "music"

    def unload(self):
        self.stop()
        self._snd = None

    def play(self, loops=0, start=0.0, fade_ms=0):
        if self._snd is None:
            raise error("music not loaded")
        self._snd._vol = self._vol
        self._snd.play(loops)
        self._playing = True

    def rewind(self):
        if self._playing:
            self.play()

    def stop(self):
        if self._snd:
            self._snd.stop()
        self._playing = False

    def pause(self):
        self._paused = True
        _send({"op": "stop", "id": "music"})

    def unpause(self):
        if self._paused and self._snd:
            self._paused = False
            self._snd.play(-1)

    def fadeout(self, time):
        self.stop()

    def set_volume(self, volume):
        self._vol = max(0.0, min(1.0, float(volume)))
        _send({"op": "volume", "id": "music", "volume": self._vol})

    def get_volume(self):
        return self._vol

    def get_busy(self):
        return self._playing and not self._paused

    def set_pos(self, pos):
        pass

    def get_pos(self):
        return -1

    def queue(self, filename, namehint="", loops=0):
        pass

    def set_endevent(self, type=None):
        pass

    def get_endevent(self):
        return 0


music = _Music()
`

const MATH = String.raw`"""pygame.math (ベクトル)"""
import math as _m


def _num(v):
    s = repr(float(v))
    return s[:-2] if s.endswith(".0") else s


def clamp(value, min_value, max_value):
    return max(min_value, min(max_value, value))


def lerp(a, b, value, do_clamp=True):
    if do_clamp:
        value = clamp(value, 0.0, 1.0)
    return a + (b - a) * value


def invlerp(a, b, value):
    return (value - a) / (b - a)


def remap(i_min, i_max, o_min, o_max, value):
    return lerp(o_min, o_max, invlerp(i_min, i_max, value), False)


def smoothstep(a, b, x):
    t = clamp((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


class _Vec:
    __slots__ = ()
    _n = 2
    epsilon = 1e-6

    def _vals(self, o):
        if isinstance(o, (int, float)):
            return (float(o),) * self._n
        t = tuple(o)
        if len(t) != self._n:
            raise ValueError("Vector must have %d elements" % self._n)
        return tuple(float(v) for v in t)

    def __len__(self):
        return self._n

    def __iter__(self):
        return iter(self._t())

    def __getitem__(self, i):
        return self._t()[i]

    def __setitem__(self, i, v):
        vals = list(self._t())
        vals[i] = float(v)
        self._set(vals)

    def __eq__(self, o):
        try:
            return all(abs(a - b) <= self.epsilon for a, b in zip(self._t(), self._vals(o)))
        except Exception:
            return False

    def __ne__(self, o):
        return not self.__eq__(o)

    def __hash__(self):
        raise TypeError("unhashable type: '%s'" % type(self).__name__)

    def __bool__(self):
        return any(self._t())

    def __neg__(self):
        return type(self)(*(-v for v in self._t()))

    def __pos__(self):
        return type(self)(*self._t())

    def __abs__(self):
        return self.length()

    def __add__(self, o):
        return type(self)(*(a + b for a, b in zip(self._t(), self._vals(o))))

    __radd__ = __add__

    def __sub__(self, o):
        return type(self)(*(a - b for a, b in zip(self._t(), self._vals(o))))

    def __rsub__(self, o):
        return type(self)(*(b - a for a, b in zip(self._t(), self._vals(o))))

    def __mul__(self, o):
        if isinstance(o, (int, float)):
            return type(self)(*(a * o for a in self._t()))
        return sum(a * b for a, b in zip(self._t(), self._vals(o)))

    __rmul__ = __mul__

    def __truediv__(self, o):
        return type(self)(*(a / o for a in self._t()))

    def __floordiv__(self, o):
        return type(self)(*(a // o for a in self._t()))

    def __mod__(self, o):
        return type(self)(*(a % b for a, b in zip(self._t(), self._vals(o))))

    def __iadd__(self, o):
        self._set([a + b for a, b in zip(self._t(), self._vals(o))])
        return self

    def __isub__(self, o):
        self._set([a - b for a, b in zip(self._t(), self._vals(o))])
        return self

    def __imul__(self, o):
        self._set([a * o for a in self._t()])
        return self

    def __itruediv__(self, o):
        self._set([a / o for a in self._t()])
        return self

    def __round__(self, n=None):
        return type(self)(*(round(a, n) if n is not None else round(a) for a in self._t()))

    def __copy__(self):
        return self.copy()

    def __reduce__(self):
        return (type(self), self._t())

    def copy(self):
        return type(self)(*self._t())

    def dot(self, o):
        return sum(a * b for a, b in zip(self._t(), self._vals(o)))

    def length(self):
        return _m.sqrt(sum(a * a for a in self._t()))

    magnitude = length

    def length_squared(self):
        return sum(a * a for a in self._t())

    magnitude_squared = length_squared

    def normalize(self):
        l = self.length()
        if l == 0:
            raise ValueError("Can't normalize Vector of length zero")
        return type(self)(*(a / l for a in self._t()))

    def normalize_ip(self):
        self._set(list(self.normalize()))

    def is_normalized(self):
        return abs(self.length() - 1) <= self.epsilon

    def scale_to_length(self, value):
        l = self.length()
        if l == 0:
            raise ValueError("Cannot scale a vector with zero length")
        self._set([a * value / l for a in self._t()])

    def distance_to(self, o):
        return _m.sqrt(sum((a - b) ** 2 for a, b in zip(self._t(), self._vals(o))))

    def distance_squared_to(self, o):
        return sum((a - b) ** 2 for a, b in zip(self._t(), self._vals(o)))

    def lerp(self, o, t):
        if not 0 <= t <= 1:
            raise ValueError("Argument 2 must be in range [0, 1]")
        return type(self)(*(a + (b - a) * t for a, b in zip(self._t(), self._vals(o))))

    def move_towards(self, target, max_distance):
        t = type(self)(*self._vals(target))
        d = t - self
        l = d.length()
        if l <= max_distance or l == 0:
            return t
        return self + d * (max_distance / l)

    def move_towards_ip(self, target, max_distance):
        self._set(list(self.move_towards(target, max_distance)))

    def reflect(self, normal):
        n = type(self)(*self._vals(normal)).normalize()
        return self - n * (2 * self.dot(n))

    def reflect_ip(self, normal):
        self._set(list(self.reflect(normal)))

    def project(self, o):
        v = type(self)(*self._vals(o))
        l2 = v.length_squared()
        if l2 == 0:
            raise ValueError("Cannot project onto a vector with zero length")
        return v * (self.dot(v) / l2)

    def clamp_magnitude(self, *a):
        lo, hi = (0, a[0]) if len(a) == 1 else a
        l = self.length()
        if l == 0:
            return self.copy()
        c = clamp(l, lo, hi)
        return self * (c / l)

    def clamp_magnitude_ip(self, *a):
        self._set(list(self.clamp_magnitude(*a)))

    def elementwise(self):
        return _Elementwise(self)

    def update(self, *args):
        if len(args) == 1 and not isinstance(args[0], (int, float)):
            self._set(list(self._vals(args[0])))
        elif len(args) == 1:
            self._set([float(args[0])] * self._n)
        elif args:
            self._set([float(v) for v in args])
        else:
            self._set([0.0] * self._n)


class _Elementwise:
    def __init__(self, v):
        self.v = v

    def _op(self, o, f):
        vals = self.v._vals(o)
        return type(self.v)(*(f(a, b) for a, b in zip(self.v, vals)))

    def __mul__(self, o):
        return self._op(o, lambda a, b: a * b)

    def __truediv__(self, o):
        return self._op(o, lambda a, b: a / b)

    def __add__(self, o):
        return self._op(o, lambda a, b: a + b)

    def __sub__(self, o):
        return self._op(o, lambda a, b: a - b)

    def __pow__(self, o):
        return self._op(o, lambda a, b: a ** b)

    def __abs__(self):
        return type(self.v)(*(abs(a) for a in self.v))


class Vector2(_Vec):
    __slots__ = ("x", "y")
    _n = 2

    def __init__(self, x=0.0, y=None):
        if y is None:
            if isinstance(x, (int, float)):
                self.x = self.y = float(x)
            elif isinstance(x, str):
                v = [float(s) for s in x.strip("<>Vector2() ").split(",")]
                self.x, self.y = v
            else:
                t = tuple(x)
                self.x, self.y = float(t[0]), float(t[1])
        else:
            self.x, self.y = float(x), float(y)

    def _t(self):
        return (self.x, self.y)

    def _set(self, v):
        self.x, self.y = float(v[0]), float(v[1])

    def __repr__(self):
        return "Vector2(%s, %s)" % (_num(self.x), _num(self.y))

    def __str__(self):
        return "[%s, %s]" % (_num(self.x), _num(self.y))

    @property
    def xy(self):
        return Vector2(self.x, self.y)

    @xy.setter
    def xy(self, v):
        self.x, self.y = float(v[0]), float(v[1])

    @property
    def yx(self):
        return Vector2(self.y, self.x)

    def cross(self, o):
        ox, oy = self._vals(o)
        return self.x * oy - self.y * ox

    def angle_to(self, o):
        ox, oy = self._vals(o)
        return _m.degrees(_m.atan2(oy, ox) - _m.atan2(self.y, self.x))

    def rotate_rad(self, a):
        c, s = _m.cos(a), _m.sin(a)
        return Vector2(self.x * c - self.y * s, self.x * s + self.y * c)

    def rotate(self, angle):
        return self.rotate_rad(_m.radians(angle))

    def rotate_ip(self, angle):
        self._set(list(self.rotate(angle)))

    def rotate_rad_ip(self, a):
        self._set(list(self.rotate_rad(a)))

    def as_polar(self):
        return (self.length(), _m.degrees(_m.atan2(self.y, self.x)))

    def from_polar(self, polar):
        r, a = polar
        self.x, self.y = r * _m.cos(_m.radians(a)), r * _m.sin(_m.radians(a))

    @classmethod
    def from_polar_new(cls, polar):
        v = cls()
        v.from_polar(polar)
        return v

    def slerp(self, o, t):
        return self.lerp(o, max(0.0, min(1.0, abs(t))))


class Vector3(_Vec):
    __slots__ = ("x", "y", "z")
    _n = 3

    def __init__(self, x=0.0, y=None, z=None):
        if y is None:
            if isinstance(x, (int, float)):
                self.x = self.y = self.z = float(x)
            else:
                t = tuple(x)
                self.x, self.y, self.z = float(t[0]), float(t[1]), float(t[2])
        else:
            self.x, self.y, self.z = float(x), float(y), float(z or 0.0)

    def _t(self):
        return (self.x, self.y, self.z)

    def _set(self, v):
        self.x, self.y, self.z = float(v[0]), float(v[1]), float(v[2])

    def __repr__(self):
        return "Vector3(%s, %s, %s)" % (_num(self.x), _num(self.y), _num(self.z))

    def __str__(self):
        return "[%s, %s, %s]" % (_num(self.x), _num(self.y), _num(self.z))

    @property
    def xy(self):
        return Vector2(self.x, self.y)

    @property
    def xyz(self):
        return Vector3(self.x, self.y, self.z)

    def cross(self, o):
        ox, oy, oz = self._vals(o)
        return Vector3(self.y * oz - self.z * oy, self.z * ox - self.x * oz, self.x * oy - self.y * ox)

    def angle_to(self, o):
        v = Vector3(*self._vals(o))
        d = self.length() * v.length()
        if d == 0:
            return 0.0
        return _m.degrees(_m.acos(max(-1.0, min(1.0, self.dot(v) / d))))

    def _rot(self, axis, a):
        k = Vector3(*axis).normalize()
        c, s = _m.cos(a), _m.sin(a)
        return self * c + k.cross(self) * s + k * (k.dot(self) * (1 - c))

    def rotate(self, angle, axis):
        return self._rot(axis, _m.radians(angle))

    def rotate_ip(self, angle, axis):
        self._set(list(self.rotate(angle, axis)))

    def rotate_rad(self, a, axis):
        return self._rot(axis, a)

    def rotate_x(self, angle):
        return self.rotate(angle, (1, 0, 0))

    def rotate_y(self, angle):
        return self.rotate(angle, (0, 1, 0))

    def rotate_z(self, angle):
        return self.rotate(angle, (0, 0, 1))

    def as_spherical(self):
        r = self.length()
        if r == 0:
            return (0.0, 0.0, 0.0)
        return (r, _m.degrees(_m.acos(self.z / r)), _m.degrees(_m.atan2(self.y, self.x)))

    def from_spherical(self, s):
        r, t, p = s
        t, p = _m.radians(t), _m.radians(p)
        self.x, self.y, self.z = r * _m.sin(t) * _m.cos(p), r * _m.sin(t) * _m.sin(p), r * _m.cos(t)
`

const SPRITE = String.raw`"""pygame.sprite (スプライトとグループ)"""
import math as _m
from pygame.rect import Rect


class Sprite:
    def __init__(self, *groups):
        self.__g = {}
        if groups:
            self.add(*groups)

    @property
    def _g(self):
        try:
            return self.__g
        except AttributeError:
            self.__g = {}
            return self.__g

    def add(self, *groups):
        for g in groups:
            if hasattr(g, "_spritegroup"):
                if g not in self._g:
                    g.add_internal(self)
                    self.add_internal(g)
            else:
                self.add(*g)

    def remove(self, *groups):
        for g in groups:
            if hasattr(g, "_spritegroup"):
                if g in self._g:
                    g.remove_internal(self)
                    self.remove_internal(g)
            else:
                self.remove(*g)

    def add_internal(self, group):
        self._g[group] = 0

    def remove_internal(self, group):
        self._g.pop(group, None)

    def update(self, *args, **kwargs):
        pass

    def kill(self):
        for g in list(self._g):
            g.remove_internal(self)
        self._g.clear()

    def groups(self):
        return list(self._g)

    def alive(self):
        return bool(self._g)

    @property
    def layer(self):
        return getattr(self, "_layer", 0)

    @layer.setter
    def layer(self, v):
        if not self.alive():
            self._layer = v
        else:
            raise AttributeError("Can't set layer directly after adding to group")

    def __repr__(self):
        return "<%s Sprite(in %d groups)>" % (type(self).__name__, len(self._g))


class DirtySprite(Sprite):
    def __init__(self, *groups):
        self.dirty = 1
        self.blendmode = 0
        self._visible = 1
        self._layer = getattr(self, "_layer", 0)
        self.source_rect = None
        super().__init__(*groups)

    @property
    def visible(self):
        return self._visible

    @visible.setter
    def visible(self, v):
        self._visible = v
        if self.dirty < 2:
            self.dirty = 1


class WeakSprite(Sprite):
    pass


class WeakDirtySprite(DirtySprite):
    pass


class AbstractGroup:
    _spritegroup = True

    def __init__(self):
        self.spritedict = {}
        self.lostsprites = []

    def sprites(self):
        return list(self.spritedict)

    def add_internal(self, sprite, layer=None):
        self.spritedict[sprite] = None

    def remove_internal(self, sprite):
        r = self.spritedict.pop(sprite, None)
        if r:
            self.lostsprites.append(r)

    def has_internal(self, sprite):
        return sprite in self.spritedict

    def copy(self):
        return self.__class__(self.sprites())

    def __iter__(self):
        return iter(self.sprites())

    def __contains__(self, sprite):
        return self.has(sprite)

    def add(self, *sprites):
        for s in sprites:
            if isinstance(s, Sprite):
                if not self.has_internal(s):
                    self.add_internal(s)
                    s.add_internal(self)
            else:
                try:
                    self.add(*s)
                except TypeError:
                    if hasattr(s, "_spritegroup"):
                        for sp in s.sprites():
                            if not self.has_internal(sp):
                                self.add_internal(sp)
                                sp.add_internal(self)
                    elif not self.has_internal(s):
                        self.add_internal(s)
                        s.add_internal(self)

    def remove(self, *sprites):
        for s in sprites:
            if isinstance(s, Sprite):
                if self.has_internal(s):
                    self.remove_internal(s)
                    s.remove_internal(self)
            elif hasattr(s, "_spritegroup"):
                for sp in s.sprites():
                    if self.has_internal(sp):
                        self.remove_internal(sp)
                        sp.remove_internal(self)
            else:
                self.remove(*s)

    def has(self, *sprites):
        if not sprites:
            return False
        for s in sprites:
            if isinstance(s, Sprite):
                if not self.has_internal(s):
                    return False
            elif hasattr(s, "_spritegroup"):
                if not all(self.has_internal(x) for x in s.sprites()):
                    return False
            elif not self.has(*s):
                return False
        return True

    def update(self, *args, **kwargs):
        for s in self.sprites():
            s.update(*args, **kwargs)

    def draw(self, surface, bgsurf=None, special_flags=0):
        sprites = self.sprites()
        for s in sprites:
            self.spritedict[s] = surface.blit(s.image, s.rect, None, special_flags)
        self.lostsprites = []
        return [r for r in self.spritedict.values() if r]

    def clear(self, surface, bgd):
        if callable(bgd):
            for r in self.lostsprites:
                bgd(surface, r)
            for r in self.spritedict.values():
                if r:
                    bgd(surface, r)
        else:
            for r in self.lostsprites:
                surface.blit(bgd, r, r)
            for r in self.spritedict.values():
                if r:
                    surface.blit(bgd, r, r)

    def empty(self):
        for s in self.sprites():
            self.remove_internal(s)
            s.remove_internal(self)

    def __bool__(self):
        return bool(self.spritedict)

    def __len__(self):
        return len(self.spritedict)

    def __repr__(self):
        return "<%s(%d sprites)>" % (type(self).__name__, len(self))


class Group(AbstractGroup):
    def __init__(self, *sprites):
        super().__init__()
        self.add(*sprites)


RenderPlain = Group
RenderClear = Group


class RenderUpdates(Group):
    def draw(self, surface, bgsurf=None, special_flags=0):
        dirty = list(self.lostsprites)
        self.lostsprites = []
        for s in self.sprites():
            old = self.spritedict[s]
            new = surface.blit(s.image, s.rect, None, special_flags)
            dirty.append(new.union(old) if old and old.colliderect(new) else new)
            if old and not old.colliderect(new):
                dirty.append(old)
            self.spritedict[s] = new
        return dirty


class OrderedUpdates(RenderUpdates):
    def __init__(self, *sprites):
        self._order = []
        super().__init__(*sprites)

    def sprites(self):
        return list(self._order)

    def add_internal(self, sprite, layer=None):
        super().add_internal(sprite)
        self._order.append(sprite)

    def remove_internal(self, sprite):
        super().remove_internal(sprite)
        self._order.remove(sprite)


class LayeredUpdates(AbstractGroup):
    _init_rect = Rect(0, 0, 0, 0)

    def __init__(self, *sprites, **kwargs):
        self._layers = {}
        self._order = []
        self._default_layer = kwargs.get("default_layer", 0)
        super().__init__()
        self.add(*sprites, **kwargs)

    def add_internal(self, sprite, layer=None):
        self.spritedict[sprite] = self._init_rect
        if layer is None:
            layer = getattr(sprite, "_layer", self._default_layer)
        self._layers[sprite] = layer
        i = len(self._order)
        while i > 0 and self._layers[self._order[i - 1]] > layer:
            i -= 1
        self._order.insert(i, sprite)

    def add(self, *sprites, **kwargs):
        layer = kwargs.get("layer")
        for s in sprites:
            if isinstance(s, Sprite):
                if not self.has_internal(s):
                    self.add_internal(s, layer)
                    s.add_internal(self)
            else:
                self.add(*s, **kwargs)

    def remove_internal(self, sprite):
        self._order.remove(sprite)
        self._layers.pop(sprite, None)
        super().remove_internal(sprite)

    def sprites(self):
        return list(self._order)

    def draw(self, surface, bgsurf=None, special_flags=0):
        out = []
        for s in self._order:
            r = surface.blit(s.image, s.rect, None, special_flags)
            self.spritedict[s] = r
            out.append(r)
        return out

    def get_sprites_at(self, pos):
        return [s for s in self._order if s.rect.collidepoint(pos)]

    def get_sprite(self, idx):
        return self._order[idx]

    def remove_sprites_of_layer(self, layer):
        out = self.get_sprites_from_layer(layer)
        self.remove(*out)
        return out

    def layers(self):
        return sorted(set(self._layers.values()))

    def change_layer(self, sprite, new_layer):
        self.remove_internal(sprite)
        self.add_internal(sprite, new_layer)
        sprite._layer = new_layer

    def get_layer_of_sprite(self, sprite):
        return self._layers.get(sprite, self._default_layer)

    def get_top_layer(self):
        return self._layers[self._order[-1]] if self._order else 0

    def get_bottom_layer(self):
        return self._layers[self._order[0]] if self._order else 0

    def move_to_front(self, sprite):
        self.change_layer(sprite, self.get_top_layer())

    def move_to_back(self, sprite):
        self.change_layer(sprite, self.get_bottom_layer() - 1)

    def get_top_sprite(self):
        return self._order[-1]

    def get_sprites_from_layer(self, layer):
        return [s for s in self._order if self._layers[s] == layer]

    def switch_layer(self, a, b):
        for s in self.get_sprites_from_layer(a):
            self.change_layer(s, b)


LayeredDirty = LayeredUpdates


class GroupSingle(AbstractGroup):
    def __init__(self, sprite=None):
        super().__init__()
        self.__sprite = None
        if sprite is not None:
            self.add(sprite)

    def copy(self):
        return GroupSingle(self.__sprite)

    def sprites(self):
        return [self.__sprite] if self.__sprite is not None else []

    def add_internal(self, sprite, layer=None):
        if self.__sprite is not None:
            self.__sprite.remove_internal(self)
            self.remove_internal(self.__sprite)
        self.__sprite = sprite
        self.spritedict[sprite] = None

    def remove_internal(self, sprite):
        if sprite is self.__sprite:
            self.__sprite = None
        self.spritedict.pop(sprite, None)

    def has_internal(self, sprite):
        return self.__sprite is sprite

    def __bool__(self):
        return self.__sprite is not None

    @property
    def sprite(self):
        return self.__sprite

    @sprite.setter
    def sprite(self, s):
        if s is None:
            self.empty()
        else:
            self.add(s)


def collide_rect(left, right):
    return left.rect.colliderect(right.rect)


class collide_rect_ratio:
    def __init__(self, ratio):
        self.ratio = ratio

    def __call__(self, left, right):
        l = left.rect.inflate(left.rect.w * self.ratio - left.rect.w, left.rect.h * self.ratio - left.rect.h)
        r = right.rect.inflate(right.rect.w * self.ratio - right.rect.w, right.rect.h * self.ratio - right.rect.h)
        return l.colliderect(r)


def _radius(s, ratio=1.0):
    r = getattr(s, "radius", None)
    if r is None:
        r = 0.5 * _m.hypot(s.rect.w, s.rect.h)
    return r * ratio


def collide_circle(left, right):
    dx = left.rect.centerx - right.rect.centerx
    dy = left.rect.centery - right.rect.centery
    return dx * dx + dy * dy <= (_radius(left) + _radius(right)) ** 2


class collide_circle_ratio:
    def __init__(self, ratio):
        self.ratio = ratio

    def __call__(self, left, right):
        dx = left.rect.centerx - right.rect.centerx
        dy = left.rect.centery - right.rect.centery
        return dx * dx + dy * dy <= (_radius(left, self.ratio) + _radius(right, self.ratio)) ** 2


def collide_mask(left, right):
    from pygame import mask as _mask
    xo = right.rect.x - left.rect.x
    yo = right.rect.y - left.rect.y
    lm = getattr(left, "mask", None) or _mask.from_surface(left.image)
    rm = getattr(right, "mask", None) or _mask.from_surface(right.image)
    return lm.overlap(rm, (xo, yo))


def spritecollide(sprite, group, dokill, collided=None):
    test = collided or collide_rect
    if dokill:
        hit = []
        for s in group.sprites():
            if test(sprite, s):
                s.kill()
                hit.append(s)
        return hit
    if collided is None:
        r = sprite.rect
        return [s for s in group if r.colliderect(s.rect)]
    return [s for s in group if test(sprite, s)]


def groupcollide(groupa, groupb, dokilla, dokillb, collided=None):
    out = {}
    for s in groupa.sprites():
        c = spritecollide(s, groupb, dokillb, collided)
        if c:
            out[s] = c
            if dokilla:
                s.kill()
    return out


def spritecollideany(sprite, group, collided=None):
    test = collided or collide_rect
    for s in group:
        if test(sprite, s):
            return s
    return None
`

const MASK = String.raw`"""pygame.mask (画素単位の当たり判定)"""
from pygame.rect import Rect


class Mask:
    def __init__(self, size, fill=False):
        self._w, self._h = int(size[0]), int(size[1])
        full = (1 << self._w) - 1
        self._rows = [full if fill else 0 for _ in range(self._h)]

    def get_size(self):
        return (self._w, self._h)

    def get_rect(self, **kw):
        r = Rect(0, 0, self._w, self._h)
        for k, v in kw.items():
            setattr(r, k, v)
        return r

    def get_at(self, pos):
        x, y = pos
        if not (0 <= x < self._w and 0 <= y < self._h):
            raise IndexError("x or y out of range")
        return (self._rows[y] >> x) & 1

    def set_at(self, pos, value=1):
        x, y = pos
        if value:
            self._rows[y] |= 1 << x
        else:
            self._rows[y] &= ~(1 << x)

    def _shifted(self, other, ox, oy):
        for y in range(max(0, oy), min(self._h, oy + other._h)):
            r = other._rows[y - oy]
            yield y, (r << ox) if ox >= 0 else (r >> -ox)

    def overlap(self, other, offset):
        ox, oy = int(offset[0]), int(offset[1])
        lim = (1 << self._w) - 1
        for y, r in self._shifted(other, ox, oy):
            both = self._rows[y] & r & lim
            if both:
                return ((both & -both).bit_length() - 1, y)
        return None

    def overlap_area(self, other, offset):
        ox, oy = int(offset[0]), int(offset[1])
        lim = (1 << self._w) - 1
        return sum(bin(self._rows[y] & r & lim).count("1") for y, r in self._shifted(other, ox, oy))

    def overlap_mask(self, other, offset):
        out = Mask((self._w, self._h))
        ox, oy = int(offset[0]), int(offset[1])
        lim = (1 << self._w) - 1
        for y, r in self._shifted(other, ox, oy):
            out._rows[y] = self._rows[y] & r & lim
        return out

    def fill(self):
        full = (1 << self._w) - 1
        self._rows = [full] * self._h

    def clear(self):
        self._rows = [0] * self._h

    def invert(self):
        full = (1 << self._w) - 1
        self._rows = [~r & full for r in self._rows]

    def count(self):
        return sum(bin(r).count("1") for r in self._rows)

    def centroid(self):
        sx = sy = n = 0
        for y, r in enumerate(self._rows):
            x = 0
            while r:
                if r & 1:
                    sx += x
                    sy += y
                    n += 1
                r >>= 1
                x += 1
        return (sx // n, sy // n) if n else (0, 0)

    def get_bounding_rects(self):
        ys = [y for y, r in enumerate(self._rows) if r]
        if not ys:
            return []
        allr = 0
        for r in self._rows:
            allr |= r
        x0 = (allr & -allr).bit_length() - 1
        x1 = allr.bit_length()
        return [Rect(x0, ys[0], x1 - x0, ys[-1] - ys[0] + 1)]

    def copy(self):
        m = Mask((self._w, self._h))
        m._rows = list(self._rows)
        return m

    def outline(self, every=1):
        pts = []
        for y, r in enumerate(self._rows):
            if r:
                pts.append(((r & -r).bit_length() - 1, y))
        for y in range(self._h - 1, -1, -1):
            r = self._rows[y]
            if r:
                pts.append((r.bit_length() - 1, y))
        return pts[::every]

    def to_surface(self, surface=None, setsurface=None, unsetsurface=None, setcolor=(255, 255, 255, 255), unsetcolor=(0, 0, 0, 255), dest=(0, 0)):
        from pygame.surface import Surface
        from pygame.constants import SRCALPHA
        s = surface or Surface((self._w, self._h), SRCALPHA)
        for y, r in enumerate(self._rows):
            for x in range(self._w):
                s.set_at((x + dest[0], y + dest[1]), setcolor if (r >> x) & 1 else unsetcolor)
        return s

    def scale(self, size):
        w, h = int(size[0]), int(size[1])
        m = Mask((w, h))
        for y in range(h):
            sy = y * self._h // max(1, h)
            row = 0
            src = self._rows[sy] if self._h else 0
            for x in range(w):
                if (src >> (x * self._w // max(1, w))) & 1:
                    row |= 1 << x
            m._rows[y] = row
        return m


MaskType = Mask


def from_surface(surface, threshold=127):
    w, h = surface.get_size()
    m = Mask((w, h))
    if w == 0 or h == 0:
        return m
    d = surface._pixels(0, 0, w, h)
    ck = surface._ck
    use_alpha = surface._alpha and ck is None
    for y in range(h):
        row = 0
        base = y * w * 4
        for x in range(w):
            i = base + x * 4
            if use_alpha:
                on = d[i + 3] > threshold
            elif ck is not None:
                on = not (d[i] == ck[0] and d[i + 1] == ck[1] and d[i + 2] == ck[2])
            else:
                on = True
            if on:
                row |= 1 << x
        m._rows[y] = row
    return m


def from_threshold(surface, color, threshold=(0, 0, 0, 255), othersurface=None, palette_colors=1):
    w, h = surface.get_size()
    m = Mask((w, h))
    d = surface._pixels(0, 0, w, h)
    c = tuple(color)
    t = tuple(threshold)
    for y in range(h):
        row = 0
        for x in range(w):
            i = (y * w + x) * 4
            if all(abs(d[i + k] - c[k]) < max(1, t[k]) for k in range(3)):
                row |= 1 << x
        m._rows[y] = row
    return m
`

const SURFARRAY = String.raw`"""pygame.surfarray (numpy の配列とのやりとり)"""
from pygame._base import _cv, _flush
from pygame.surface import Surface


def _np():
    import numpy
    return numpy


def array3d(surface):
    np = _np()
    w, h = surface.get_size()
    d = np.frombuffer(surface._pixels(0, 0, w, h), dtype=np.uint8).reshape(h, w, 4)
    return d[:, :, :3].transpose(1, 0, 2).copy()


pixels3d = array3d


def array_alpha(surface):
    np = _np()
    w, h = surface.get_size()
    d = np.frombuffer(surface._pixels(0, 0, w, h), dtype=np.uint8).reshape(h, w, 4)
    return d[:, :, 3].T.copy()


pixels_alpha = array_alpha


def array2d(surface):
    np = _np()
    a = array3d(surface).astype(np.uint32)
    return (a[:, :, 0] << 16) | (a[:, :, 1] << 8) | a[:, :, 2]


pixels2d = array2d


def blit_array(surface, array):
    np = _np()
    a = np.asarray(array)
    if a.ndim == 2:
        a = np.stack([(a >> 16) & 255, (a >> 8) & 255, a & 255], axis=-1)
    w, h = a.shape[0], a.shape[1]
    rgba = np.empty((h, w, 4), dtype=np.uint8)
    rgba[:, :, :3] = a.transpose(1, 0, 2)[:, :, :3]
    rgba[:, :, 3] = 255
    _flush()
    from pyodide.ffi import to_js
    _cv("put")(surface._sid, to_js(rgba.tobytes()), 0, 0, w, h)


def make_surface(array):
    np = _np()
    a = np.asarray(array)
    s = Surface((a.shape[0], a.shape[1]))
    blit_array(s, a)
    return s


def get_arraytype():
    return "numpy"


def get_arraytypes():
    return ("numpy",)


def use_arraytype(t):
    pass
`

const MISC = {
  'pygame/joystick.py': String.raw`"""pygame.joystick (この環境ではつながりません)"""


def init():
    pass


def quit():
    pass


def get_init():
    return True


def get_count():
    return 0


class Joystick:
    def __init__(self, i):
        raise IndexError("joystick index out of range")


JoystickType = Joystick
`,
  'pygame/cursors.py': String.raw`"""pygame.cursors (形だけ)"""
arrow = diamond = broken_x = tri_left = tri_right = ball = None


class Cursor:
    def __init__(self, *a):
        self.data = a


def compile(strings, black="X", white=".", xor="o"):
    return ((), ())


def load_xbm(cursorfile, maskfile):
    return None
`,
  'pygame/scrap.py': String.raw`"""pygame.scrap (形だけ)"""


def init():
    pass


def get_init():
    return True


def get_text():
    return ""


def put_text(text):
    pass


def get(t):
    return None


def put(t, data):
    pass


def get_types():
    return []


def contains(t):
    return False


def lost():
    return False


def set_mode(m):
    pass
`,
  'pygame/freetype.py': String.raw`"""pygame.freetype (pygame.font で代わりに描きます)"""
from pygame import font as _font
from pygame.rect import Rect

STYLE_NORMAL = 0
STYLE_STRONG = 1
STYLE_OBLIQUE = 2
STYLE_UNDERLINE = 4
STYLE_WIDE = 8
STYLE_DEFAULT = 255


def init(cache_size=64, resolution=72):
    pass


def quit():
    pass


def get_init():
    return True


def was_init():
    return True


def get_default_font():
    return "freesansbold.ttf"


class Font:
    def __init__(self, file=None, size=0, font_index=0, resolution=0, ucs4=False):
        self.size = size or 12
        self._file = file
        self.fgcolor = (0, 0, 0, 255)
        self.bgcolor = None
        self.strong = False
        self.oblique = False
        self.underline = False

    def _f(self, size=None):
        f = _font.SysFont(None, size or self.size) if self._file is None else _font.Font(self._file, size or self.size)
        f.set_bold(self.strong)
        f.set_italic(self.oblique)
        f.set_underline(self.underline)
        return f

    def render(self, text, fgcolor=None, bgcolor=None, style=0, rotation=0, size=0):
        s = self._f(size).render(text, True, fgcolor or self.fgcolor, bgcolor or self.bgcolor)
        return s, s.get_rect()

    def render_to(self, surf, dest, text, fgcolor=None, bgcolor=None, style=0, rotation=0, size=0):
        s, r = self.render(text, fgcolor, bgcolor, style, rotation, size)
        r.topleft = (dest[0], dest[1]) if not isinstance(dest, Rect) else dest.topleft
        surf.blit(s, r)
        return r

    def get_rect(self, text, style=0, rotation=0, size=0):
        w, h = self._f(size).size(text)
        return Rect(0, 0, w, h)

    def get_sized_height(self, size=0):
        return self._f(size).get_height()


SysFont = lambda name, size, bold=False, italic=False: Font(None, size)
`,
}

export function pygameFiles() {
  return {
    'pygame/__init__.py': INIT,
    'pygame/_base.py': BASE,
    'pygame/constants.py': CONSTANTS,
    'pygame/locals.py': LOCALS,
    'pygame/rect.py': RECT,
    'pygame/color.py': COLOR,
    'pygame/surface.py': SURFACE,
    'pygame/display.py': DISPLAY,
    'pygame/draw.py': DRAW,
    'pygame/gfxdraw.py': GFXDRAW,
    'pygame/event.py': EVENT,
    'pygame/_keys.py': KEYS,
    'pygame/key.py': KEY,
    'pygame/mouse.py': MOUSE,
    'pygame/time.py': TIME,
    'pygame/font.py': FONT,
    'pygame/image.py': IMAGE,
    'pygame/transform.py': TRANSFORM,
    'pygame/mixer.py': MIXER,
    'pygame/math.py': MATH,
    'pygame/sprite.py': SPRITE,
    'pygame/mask.py': MASK,
    'pygame/surfarray.py': SURFARRAY,
    ...MISC,
  }
}
