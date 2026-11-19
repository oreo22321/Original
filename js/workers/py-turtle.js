// turtle (タートルグラフィックス) をブラウザ用に作り直したもの (python-worker の Python に置きます)
// 描く命令を画面 (出力パネルのキャンバス) に送り、画面の動きに合わせて Python も待つので、本物の turtle と同じ速さで描けます
// キー操作・クリック・ontimer も使えます (共有メモリが使えるとき)
// 画面へ送る命令: m 移動 / h 向き / ps ペンなどの状態 / nt 新しいタートル / bf ef 塗りつぶし / dot 点 / tx 文字
//                st cst スタンプ / cl そのタートルの絵を消す / clr 全部消す / bg 背景 / sz 大きさ / title / keys / shape
export const TURTLE = String.raw`"""ForgeCode の turtle (タートルグラフィックス)

ブラウザ用に作り直したもので、ふつうの turtle とほぼ同じように使えます。
描いた絵は出力パネルに表示されます。キー操作 (onkey)・クリック (onclick)・タイマー (ontimer) も使えます。
"""
import math as _math
import json as _json
import time as _time
import heapq as _heapq
import js as _js
import _forgecode as _fc

_CSS = set("""aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood
cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen
darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray
darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia
gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender
lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink
lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta
maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise
mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red
rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow
springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen""".split())
_TK = {"navyblue": "navy", "violetred": "#d02090", "lightgoldenrod": "#eedd82", "transparent": "transparent", "": "transparent"}

_SHAPES = {
    "arrow": ((-10, 0), (10, 0), (0, 10)),
    "turtle": ((0, 16), (-2, 14), (-1, 10), (-4, 7), (-7, 9), (-9, 8), (-6, 5), (-7, 1), (-5, -3), (-8, -6), (-6, -8),
               (-4, -5), (0, -7), (4, -5), (6, -8), (8, -6), (5, -3), (7, 1), (6, 5), (9, 8), (7, 9), (4, 7), (1, 10), (2, 14)),
    "circle": tuple((10 * _math.cos(_math.radians(a * 18)), 10 * _math.sin(_math.radians(a * 18))) for a in range(20)),
    "square": ((10, -10), (10, 10), (-10, 10), (-10, -10)),
    "triangle": ((10, -5.77), (0, 11.55), (-10, -5.77)),
    "classic": ((0, 0), (-5, -9), (0, -7), (5, -9)),
    "blank": (),
}
_PPS = [0, 110, 160, 230, 320, 430, 560, 740, 980, 1300, 1800]  # 速さ 1〜10 の 1 秒あたりの画素
_SPEEDS = {"fastest": 0, "fast": 10, "normal": 6, "slow": 3, "slowest": 1}


class TurtleGraphicsError(Exception):
    """turtle の使い方が正しくないとき"""


class Terminator(Exception):
    """画面を閉じた (bye) あとで、描こうとしたとき"""


class Vec2D(tuple):
    """2 次元ベクトル (タートルの位置)"""

    def __new__(cls, x, y):
        return tuple.__new__(cls, (x, y))

    def __add__(self, other):
        return Vec2D(self[0] + other[0], self[1] + other[1])

    def __mul__(self, other):
        if isinstance(other, Vec2D):
            return self[0] * other[0] + self[1] * other[1]
        return Vec2D(self[0] * other, self[1] * other)

    def __rmul__(self, other):
        if isinstance(other, (int, float)):
            return Vec2D(self[0] * other, self[1] * other)
        return NotImplemented

    def __sub__(self, other):
        return Vec2D(self[0] - other[0], self[1] - other[1])

    def __neg__(self):
        return Vec2D(-self[0], -self[1])

    def __abs__(self):
        return _math.hypot(*self)

    def rotate(self, angle):
        perp = Vec2D(-self[1], self[0])
        angle = _math.radians(angle)
        c, s = _math.cos(angle), _math.sin(angle)
        return Vec2D(self[0] * c + perp[0] * s, self[1] * c + perp[1] * s)

    def __getnewargs__(self):
        return (self[0], self[1])

    def __repr__(self):
        return "(%.2f,%.2f)" % self


class Shape:
    """タートルの形 (polygon / compound)"""

    def __init__(self, type_, data=None):
        self._type = type_
        if type_ == "polygon":
            data = tuple(tuple(p) for p in data or ())
        elif type_ == "compound":
            data = []
        elif type_ == "image":
            raise TurtleGraphicsError("この環境では画像の形 (gif) は使えません")
        else:
            raise TurtleGraphicsError("There is no shape type %s" % type_)
        self._data = data

    def addcomponent(self, poly, fill, outline=None):
        if self._type != "compound":
            raise TurtleGraphicsError("Cannot add component to %s Shape" % self._type)
        self._data.append((tuple(tuple(p) for p in poly), fill, outline))


# ============================================================
# 画面への命令
# ============================================================
_ops = []
_state = {"pending": 0.0, "last_update": 0.0, "dispatching": False}


# js の __ で始まる名前は、クラスの中で書くと名前が変わってしまうので、ここで包む
def _ev_poll():
    return _js.__fc_ev_poll()


def _ev_ok():
    return _js.__fc_ev_ok()


def _ev_wait(ms):
    return _js.__fc_ev_wait(ms)


def _reset_all():
    # 実行のはじめに、前の実行のタートルと画面を忘れる
    _ops.clear()
    _state.update(pending=0.0, last_update=0.0, dispatching=False)
    _Screen._inst = None
    Turtle._pen = None
    Turtle._ids = 0


def _emit(op):
    if not _ops:
        _fc.on_finish(_flush)
    _ops.append(op)
    if len(_ops) >= 600:
        _flush()


def _flush():
    if _ops:
        _js.__fc_turtle(_json.dumps(_ops, separators=(",", ":")))
        _ops.clear()


def _anim(ms):
    # 画面の動きに合わせて待つ (待つ間に、たまったキー操作なども処理する)
    _state["pending"] += ms
    if _state["pending"] >= 24:
        wait = _state["pending"]
        _state["pending"] = 0.0
        _flush()
        _fc.sleep(wait / 1000.0)
        _screen()._process_events()


def _color_out(c):
    # 画面 (キャンバス) で使う色の文字列
    if isinstance(c, str):
        return c
    r, g, b = c
    return "#%02x%02x%02x" % (int(round(r * 255)), int(round(g * 255)), int(round(b * 255)))


class _Screen:
    """タートルを描く画面 (Screen() で取り出します)"""

    _inst = None

    def __init__(self):
        self._init_state()

    def _init_state(self):
        self._turtles = []
        self._mode = "standard"
        self._colormode = 1.0
        self._bg = "white"
        self._w, self._h = 640, 480
        self._world = None
        self._tracer = 1
        self._delay = 10
        self._shapes = dict((k, ("polygon", v)) for k, v in _SHAPES.items())
        self._keys = {}
        self._keypress = {}
        self._clicks = {}
        self._timers = []
        self._seq = 0
        self._closed = False
        self._title = "Python Turtle Graphics"
        self._bound_sent = None

    # ---- 色 ----
    def _colorstr(self, args):
        if len(args) == 1:
            args = args[0]
        if isinstance(args, str):
            s = args.strip()
            if s.startswith("#"):
                if len(s) in (4, 7, 13) and all(ch in "0123456789abcdefABCDEF" for ch in s[1:]):
                    if len(s) == 13:
                        s = "#" + s[1:3] + s[5:7] + s[9:11]
                    return s
                raise TurtleGraphicsError("bad color string: %s" % args)
            k = s.lower().replace(" ", "")
            if k in _CSS or k == "transparent":
                return k
            if k in _TK:
                return _TK[k]
            for g in ("grey", "gray"):
                if k.startswith(g) and k[len(g):].isdigit() and 0 <= int(k[len(g):]) <= 100:
                    v = round(int(k[len(g):]) * 2.55)
                    return "#%02x%02x%02x" % (v, v, v)
            if k[-1:] in "1234" and k[:-1] in _CSS:
                return k[:-1]
            raise TurtleGraphicsError("bad color string: %s" % args)
        try:
            r, g, b = args
        except (TypeError, ValueError):
            raise TurtleGraphicsError("bad color arguments: %s" % str(args))
        if self._colormode == 1.0:
            vals = [float(r), float(g), float(b)]
        else:
            vals = [float(r) / 255, float(g) / 255, float(b) / 255]
        if not all(0.0 <= v <= 1.0 for v in vals):
            raise TurtleGraphicsError("bad color sequence: %s" % str(args))
        return tuple(vals)

    def _color_user(self, c):
        if isinstance(c, str):
            return c
        if self._colormode == 1.0:
            return tuple(c)
        return tuple(int(round(v * 255)) for v in c)

    # ---- 座標 ----
    def _to_px(self, x, y):
        if self._world:
            llx, lly, urx, ury = self._world
            return ((x - (llx + urx) / 2.0) * self._w / (urx - llx), (y - (lly + ury) / 2.0) * self._h / (ury - lly))
        return x, y

    def _from_px(self, px, py):
        if self._world:
            llx, lly, urx, ury = self._world
            return (px * (urx - llx) / self._w + (llx + urx) / 2.0, py * (ury - lly) / self._h + (lly + ury) / 2.0)
        return px, py

    def _scale(self):
        if self._world:
            llx, lly, urx, ury = self._world
            return self._w / (urx - llx), self._h / (ury - lly)
        return 1.0, 1.0

    def _check(self):
        if self._closed:
            raise Terminator()

    # ---- 画面の設定 ----
    def bgcolor(self, *args):
        """背景の色を変える / 調べる"""
        if not args:
            return self._color_user(self._bg) if not isinstance(self._bg, str) else self._bg
        c = self._colorstr(args)
        self._bg = c
        _emit(["bg", _color_out(c)])

    def bgpic(self, picname=None):
        """背景の画像 (この環境では使えません)"""
        if picname is None:
            return "nopic"
        _fc.note("bgpic", "turtle: この環境では背景の画像 (bgpic) は使えません")

    def setup(self, width=0.5, height=0.75, startx=None, starty=None):
        """画面の大きさを決める"""
        w = int(width * 1280) if isinstance(width, float) and width <= 1 else int(width)
        h = int(height * 720) if isinstance(height, float) and height <= 1 else int(height)
        self._w, self._h = max(50, min(w, 2000)), max(50, min(h, 2000))
        _emit(["sz", self._w, self._h])

    def screensize(self, canvwidth=None, canvheight=None, bg=None):
        """キャンバスの大きさ"""
        if canvwidth is None and canvheight is None and bg is None:
            return self._w, self._h
        if canvwidth:
            self._w = int(canvwidth)
        if canvheight:
            self._h = int(canvheight)
        _emit(["sz", self._w, self._h])
        if bg is not None:
            self.bgcolor(bg)

    def window_width(self):
        return self._w

    def window_height(self):
        return self._h

    def title(self, titlestring):
        """画面の題名"""
        self._title = str(titlestring)
        _emit(["title", self._title])

    def mode(self, mode=None):
        """'standard' (右が 0°・左回り) / 'logo' (上が 0°・右回り) / 'world'"""
        if mode is None:
            return self._mode
        mode = mode.lower()
        if mode not in ("standard", "logo", "world"):
            raise TurtleGraphicsError("No turtle-graphics-mode %s" % mode)
        self._mode = mode
        if mode in ("standard", "logo"):
            self._world = None
        self.reset()

    def setworldcoordinates(self, llx, lly, urx, ury):
        """座標の範囲 (左下と右上) を決める"""
        if self._mode != "world":
            self._mode = "world"
        if urx == llx or ury == lly:
            raise TurtleGraphicsError("bad world coordinates")
        self._world = (float(llx), float(lly), float(urx), float(ury))
        for t in self._turtles:
            t._sync()

    def colormode(self, cmode=None):
        """色の数値の範囲: 1.0 (0〜1) か 255 (0〜255)"""
        if cmode is None:
            return self._colormode
        if cmode == 1.0:
            self._colormode = 1.0
        elif cmode == 255:
            self._colormode = 255
        else:
            raise TurtleGraphicsError("bad colormode: %s" % cmode)

    def tracer(self, n=None, delay=None):
        """tracer(0) で描く様子を見せずに速く描く (update() で表示)"""
        if n is None:
            return self._tracer
        self._tracer = int(n)
        if delay is not None:
            self._delay = int(delay)

    def delay(self, delay=None):
        if delay is None:
            return self._delay
        self._delay = int(delay)

    def update(self):
        """描いたものを画面に出す (キー操作なども処理します)"""
        self._check()
        now = _time.monotonic()
        gap = now - _state["last_update"]
        _flush()
        # 速すぎるループで画面が追いつかなくならないよう、1 秒に 60 回までにする
        if gap < 1 / 60.0:
            _fc.sleep(1 / 60.0 - gap)
        _state["last_update"] = _time.monotonic()
        self._process_events()

    def turtles(self):
        return list(self._turtles)

    def getshapes(self):
        return sorted(self._shapes)

    def register_shape(self, name, shape=None):
        """形を登録する (点の並び (タプル) か Shape)"""
        if shape is None:
            _fc.note("gifshape", "turtle: この環境では画像の形 (gif) は使えません")
            return
        if isinstance(shape, Shape):
            data = (shape._type, shape._data)
        else:
            data = ("polygon", tuple(tuple(p) for p in shape))
        self._shapes[name] = data
        self._send_shape(name)

    addshape = register_shape

    def _send_shape(self, name):
        kind, data = self._shapes[name]
        if kind == "polygon":
            _emit(["shape", name, [[list(p) for p in data], None, None]])
        else:
            _emit(["shape", name, [[[list(p) for p in poly], _color_out(self._colorstr((fill,))) if fill else None, _color_out(self._colorstr((ol,))) if ol else None] for poly, fill, ol in data]])

    def getcanvas(self):
        raise TurtleGraphicsError("この環境では getcanvas() は使えません")

    def clear(self):
        """すべての絵とタートルを消して、最初の状態に戻す"""
        _emit(["clr"])
        self._init_state()
        Turtle._pen = None

    clearscreen = clear

    def reset(self):
        """すべてのタートルを最初の状態に戻す"""
        for t in list(self._turtles):
            t.reset()

    resetscreen = reset

    # ---- 入力 ----
    def textinput(self, title, prompt):
        """文字を入力してもらう"""
        self._check()
        _flush()
        try:
            return input("%s: %s " % (title, prompt) if title else prompt)
        except EOFError:
            return None

    def numinput(self, title, prompt, default=None, minval=None, maxval=None):
        """数を入力してもらう"""
        while True:
            s = self.textinput(title, prompt + ("" if default is None else " (%s)" % default))
            if s is None:
                return None
            if s.strip() == "" and default is not None:
                return float(default)
            try:
                v = float(s)
            except ValueError:
                print("数を入力してください")
                continue
            if minval is not None and v < minval:
                print("%s 以上にしてください" % minval)
                continue
            if maxval is not None and v > maxval:
                print("%s 以下にしてください" % maxval)
                continue
            return v

    # ---- イベント ----
    def _send_bindings(self):
        keys = sorted(set((k if k else "*") for k in list(self._keys) + list(self._keypress)))
        state = (tuple(keys), bool(self._clicks) or any(t._clicks for t in self._turtles))
        if state != self._bound_sent:
            self._bound_sent = state
            _emit(["keys", list(state[0]), state[1]])

    def onkey(self, fun, key):
        """キーを離したときに fun() を呼ぶ (例: onkey(up, "Up"))"""
        if fun is None:
            self._keys.pop(key, None)
        else:
            self._keys[key] = fun
        self._send_bindings()

    onkeyrelease = onkey

    def onkeypress(self, fun, key=None):
        """キーを押したときに fun() を呼ぶ (押し続けると何度も呼びます)"""
        if fun is None:
            self._keypress.pop(key, None)
        else:
            self._keypress[key] = fun
        self._send_bindings()

    def listen(self, xdummy=None, ydummy=None):
        """キー操作を受け付ける"""
        self._send_bindings()

    def onclick(self, fun, btn=1, add=None):
        """画面をクリック (タップ) したときに fun(x, y) を呼ぶ"""
        if fun is None:
            self._clicks.pop(btn, None)
        else:
            self._clicks[btn] = fun
        self._send_bindings()

    onscreenclick = onclick

    def ontimer(self, fun, t=0):
        """t ミリ秒後に fun() を呼ぶ"""
        self._seq += 1
        _heapq.heappush(self._timers, (_time.monotonic() + max(0, t) / 1000.0, self._seq, fun))

    def _dispatch(self, ev):
        k = ev.get("t")
        if k in ("kd", "ku"):
            key = ev.get("k")
            table = self._keypress if k == "kd" else self._keys
            fn = table.get(key) or (table.get(None) if k == "kd" else None)
            if fn:
                fn()
        elif k in ("c", "r", "d"):
            x, y = self._from_px(ev.get("x", 0), ev.get("y", 0))
            btn = ev.get("b", 1)
            if k == "c":
                for t in reversed(self._turtles):
                    fn = t._clicks.get(btn)
                    if fn and t._hit(x, y):
                        fn(x, y)
                        return
                fn = self._clicks.get(btn)
                if fn:
                    fn(x, y)
            else:
                for t in reversed(self._turtles):
                    fn = (t._releases if k == "r" else t._drags).get(btn)
                    if fn and (k == "r" or t._hit(x, y, 30)):
                        fn(x, y)

    def _run_timers(self):
        now = _time.monotonic()
        while self._timers and self._timers[0][0] <= now:
            _, _, fn = _heapq.heappop(self._timers)
            fn()

    def _process_events(self):
        if _state["dispatching"]:
            return
        _state["dispatching"] = True
        try:
            self._run_timers()
            while True:
                s = _ev_poll()
                if not s:
                    break
                for ev in _json.loads(s):
                    self._dispatch(ev)
        finally:
            _state["dispatching"] = False

    def _has_handlers(self):
        return bool(self._keys or self._keypress or self._clicks or self._timers or any(t._clicks or t._releases or t._drags for t in self._turtles))

    def mainloop(self):
        """キー操作・クリック・タイマーを待ち続ける (■ で終わります)"""
        _flush()
        if self._closed or not self._has_handlers():
            return
        if not _ev_ok():
            if self._keys or self._keypress or self._clicks:
                _fc.note("turtle-ev", "turtle: キー操作やクリックを使うには、ページを再読み込みしてください (はじめて開いたときは再読み込みが必要です)")
            while self._timers and not self._closed:
                _fc.sleep(max(0.0, self._timers[0][0] - _time.monotonic()))
                self._run_timers()
                _flush()
            return
        if self._keys or self._keypress or self._clicks:
            _fc.note("turtle-loop", "turtle: キー操作・クリックを待っています (■ で終わります)")
        while not self._closed:
            self._process_events()
            _flush()
            if not self._has_handlers():
                break
            wait = 0.05
            if self._timers:
                wait = max(0.0, min(wait, self._timers[0][0] - _time.monotonic()))
            if wait > 0:
                _ev_wait(int(wait * 1000) or 1)

    done = mainloop

    def exitonclick(self):
        """クリック (タップ) するまで待って終わる"""
        def _bye(x, y):
            self.bye()
        self.onclick(_bye)
        _fc.note("turtle-exit", "turtle: 絵をタップ (クリック) すると終わります")
        self.mainloop()

    def bye(self):
        """画面を閉じる (turtle の処理を終わる)"""
        _flush()
        self._closed = True


def Screen():
    """タートルの画面 (いつも同じものを返します)"""
    if _Screen._inst is None:
        _Screen._inst = _Screen()
    return _Screen._inst


_screen = Screen
TurtleScreen = _Screen


class Turtle:
    """タートル (ペンを持って動く亀)"""

    _pen = None
    _ids = 0

    def __init__(self, shape="classic", undobuffersize=1000, visible=True):
        scr = _screen()
        scr._check()
        Turtle._ids += 1
        self._id = Turtle._ids
        self.screen = scr
        self._shape = shape if shape in scr._shapes else "classic"
        self._x = self._y = 0.0
        self._h = 0.0                  # 向き (右が 0°、左回り)
        self._down = True
        self._pensize = 1
        self._pencolor = "black"
        self._fillcolor = "black"
        self._visible = bool(visible)
        self._speed = 3
        self._stretch = (1.0, 1.0, 1)
        self._tilt = 0.0
        self._fullcircle = 360.0
        self._filling = False
        self._fillpath = []
        self._polyrec = None
        self._poly = None
        self._stamps = []
        self._stamp_seq = 0
        self._clicks, self._releases, self._drags = {}, {}, {}
        scr._turtles.append(self)
        if scr._shapes[self._shape][0] != "polygon" or self._shape not in _SHAPES:
            scr._send_shape(self._shape)
        _emit(["nt", self._id, self._pen_state()])

    # ---- 内部 ----
    def _pen_state(self):
        return {"pc": _color_out(self._pencolor), "fc": _color_out(self._fillcolor), "w": self._pensize, "down": self._down,
                "vis": self._visible, "shape": self._shape, "st": list(self._stretch), "tilt": self._tilt,
                "x": self._px()[0], "y": self._px()[1], "h": self._screen_angle()}

    def _sync(self):
        _emit(["ps", self._id, self._pen_state()])

    def _px(self):
        px, py = self.screen._to_px(self._x, self._y)
        return round(px, 2), round(py, 2)

    def _screen_angle(self):
        sx, sy = self.screen._scale()
        a = _math.radians(self._h)
        return round(_math.degrees(_math.atan2(_math.sin(a) * sy, _math.cos(a) * sx)), 3)

    def _anim_on(self):
        return self._speed != 0 and self.screen._tracer != 0 and self.screen._delay != 0

    def _go_to(self, x, y, draw=None):
        self.screen._check()
        ox, oy = self._px()
        self._x, self._y = float(x), float(y)
        if self._filling:
            self._fillpath.append(self._px())
        if self._polyrec is not None:
            self._polyrec.append((self._x, self._y))
        nx, ny = self._px()
        ms = 0
        if self._anim_on():
            d = _math.hypot(nx - ox, ny - oy)
            ms = min(4000, d / _PPS[self._speed] * 1000.0 * (self.screen._delay / 10.0) / max(1, self.screen._tracer))
        op = ["m", self._id, nx, ny, round(ms, 1)]
        if draw is False:
            op.append(0)
        _emit(op)
        if ms:
            _anim(ms)

    def _turn(self, deg):
        self.screen._check()
        self._h = (self._h + deg) % 360.0
        ms = 0
        if self._anim_on() and self._visible:
            ms = min(1500, abs(deg) / (90.0 * self._speed + 90.0) * 1000.0 * (self.screen._delay / 10.0) / max(1, self.screen._tracer))
        _emit(["h", self._id, self._screen_angle(), round(ms, 1)])
        if ms:
            _anim(ms)

    def _deg(self, a):
        return a * 360.0 / self._fullcircle

    def _from_deg(self, a):
        return a * self._fullcircle / 360.0

    def _hit(self, x, y, r=None):
        sx, sy = self.screen._scale()
        dx, dy = (x - self._x) * sx, (y - self._y) * sy
        return _math.hypot(dx, dy) <= (r or 12 * max(self._stretch[0], self._stretch[1]))

    # ---- 動く ----
    def forward(self, distance):
        """前へ distance 進む"""
        a = _math.radians(self._h)
        self._go_to(self._x + distance * _math.cos(a), self._y + distance * _math.sin(a))

    fd = forward

    def back(self, distance):
        """後ろへ distance 下がる"""
        self.forward(-distance)

    bk = backward = back

    def right(self, angle):
        """右へ angle 度回る"""
        self._turn(-self._deg(angle))

    rt = right

    def left(self, angle):
        """左へ angle 度回る"""
        self._turn(self._deg(angle))

    lt = left

    def goto(self, x, y=None):
        """(x, y) へ動く"""
        if y is None:
            x, y = x
        self._go_to(x, y)

    setpos = setposition = goto

    def teleport(self, x=None, y=None, *, fill_gap=False):
        """線を引かずに (x, y) へ瞬間移動する"""
        nx = self._x if x is None else x
        ny = self._y if y is None else y
        down = self._down
        self._down = False
        self._sync()
        speed = self._speed
        self._speed = 0
        try:
            self._go_to(nx, ny, draw=False)
        finally:
            self._speed = speed
            self._down = down
            self._sync()

    def setx(self, x):
        """x 座標だけ変える"""
        self._go_to(x, self._y)

    def sety(self, y):
        """y 座標だけ変える"""
        self._go_to(self._x, y)

    def setheading(self, to_angle):
        """向きを to_angle 度にする (standard: 0=右 90=上 / logo: 0=上 90=右)"""
        a = self._deg(to_angle)
        target = (90.0 - a) % 360.0 if self.screen._mode == "logo" else a % 360.0
        diff = (target - self._h + 180.0) % 360.0 - 180.0
        self._turn(diff)

    seth = setheading

    def home(self):
        """真ん中 (0, 0) に戻り、最初の向きにする"""
        self._go_to(0, 0)
        self.setheading(0)

    def circle(self, radius, extent=None, steps=None):
        """半径 radius の円 (extent 度の弧) を描く"""
        if extent is None:
            extent = self._fullcircle
        if steps is None:
            frac = abs(extent) / self._fullcircle
            steps = 1 + int(min(11 + abs(radius) / 6.0, 59.0) * frac)
        steps = max(1, int(steps))
        w = self._deg(extent) / steps
        w2 = 0.5 * w
        length = 2.0 * radius * _math.sin(_math.radians(w2))
        if radius < 0:
            length, w, w2 = -length, -w, -w2
        speed = self._speed
        vis = self._visible
        self._visible = False
        try:
            self._turn(w2)
            for _ in range(steps):
                self.forward(length)
                self._turn(w)
            self._turn(-w2)
        finally:
            self._visible = vis
        self._speed = speed

    def dot(self, size=None, *color):
        """点を打つ"""
        if not color:
            if isinstance(size, (str, tuple)):
                color = self.screen._colorstr((size,))
                size = None
            else:
                color = self._pencolor
        else:
            color = self.screen._colorstr(color)
        if size is None:
            size = max(self._pensize + 4, 2 * self._pensize)
        x, y = self._px()
        _emit(["dot", self._id, x, y, float(size), _color_out(color)])

    def stamp(self):
        """今のタートルの形をはんこのように残す (番号を返します)"""
        self._stamp_seq += 1
        sid = self._id * 100000 + self._stamp_seq
        self._stamps.append(sid)
        _emit(["st", self._id, sid])
        return sid

    def clearstamp(self, stampid):
        """スタンプを 1 つ消す"""
        if stampid in self._stamps:
            self._stamps.remove(stampid)
            _emit(["cst", stampid])

    def clearstamps(self, n=None):
        """スタンプを消す (n 個 / 全部)"""
        if n is None:
            ids = list(self._stamps)
        elif n >= 0:
            ids = self._stamps[:n]
        else:
            ids = self._stamps[n:]
        for sid in ids:
            self.clearstamp(sid)

    def write(self, arg, move=False, align="left", font=("Arial", 8, "normal")):
        """文字を書く"""
        text = str(arg)
        x, y = self._px()
        family, size, style = (list(font) + ["Arial", 8, "normal"][len(font):])[:3]
        _emit(["tx", self._id, x, y, text, align, [str(family), float(size), str(style)], _color_out(self._pencolor)])
        if move:
            width = sum(1.0 if ord(ch) > 0x2E80 else 0.6 for ch in text) * float(size) * 1.33
            sx, _ = self.screen._scale()
            self._go_to(self._x + width / sx, self._y)

    # ---- 塗りつぶし ----
    def begin_fill(self):
        """塗りつぶしを始める (end_fill() までに囲んだところを塗る)"""
        self._filling = True
        self._fillpath = [self._px()]
        _emit(["bf", self._id])

    def end_fill(self):
        """塗りつぶす"""
        if self._filling and len(self._fillpath) > 2:
            _emit(["ef", self._id, [list(p) for p in self._fillpath], _color_out(self._fillcolor)])
        else:
            _emit(["ef", self._id, [], None])
        self._filling = False
        self._fillpath = []

    def filling(self):
        return self._filling

    # ---- ペン ----
    def penup(self):
        """ペンを上げる (動いても線を引かない)"""
        self._down = False
        self._sync()

    pu = up = penup

    def pendown(self):
        """ペンを下ろす (動くと線を引く)"""
        self._down = True
        self._sync()

    pd = down = pendown

    def isdown(self):
        return self._down

    def pensize(self, width=None):
        """線の太さ"""
        if width is None:
            return self._pensize
        self._pensize = width
        self._sync()

    width = pensize

    def pencolor(self, *args):
        """線の色"""
        if not args:
            return self.screen._color_user(self._pencolor)
        self._pencolor = self.screen._colorstr(args)
        self._sync()

    def fillcolor(self, *args):
        """塗りつぶしの色"""
        if not args:
            return self.screen._color_user(self._fillcolor)
        self._fillcolor = self.screen._colorstr(args)
        self._sync()

    def color(self, *args):
        """線と塗りつぶしの色: color("red") / color("red", "yellow")"""
        if not args:
            return self.pencolor(), self.fillcolor()
        if len(args) == 1:
            c = self.screen._colorstr(args)
            self._pencolor = self._fillcolor = c
        elif len(args) == 2:
            self._pencolor = self.screen._colorstr((args[0],))
            self._fillcolor = self.screen._colorstr((args[1],))
        elif len(args) == 3:
            c = self.screen._colorstr((args,))
            self._pencolor = self._fillcolor = c
        else:
            raise TurtleGraphicsError("bad color arguments: %s" % str(args))
        self._sync()

    def pen(self, pen=None, **pendict):
        """ペンの状態 (辞書) を調べる / 変える"""
        cur = {"shown": self._visible, "pendown": self._down, "pencolor": self.pencolor(), "fillcolor": self.fillcolor(),
               "pensize": self._pensize, "speed": self._speed, "resizemode": "noresize", "stretchfactor": self._stretch[:2],
               "outline": self._stretch[2], "tilt": self._tilt}
        if pen is None and not pendict:
            return cur
        d = dict(pen or {})
        d.update(pendict)
        if "shown" in d:
            self._visible = bool(d["shown"])
        if "pendown" in d:
            self._down = bool(d["pendown"])
        if "pencolor" in d:
            self._pencolor = self.screen._colorstr((d["pencolor"],))
        if "fillcolor" in d:
            self._fillcolor = self.screen._colorstr((d["fillcolor"],))
        if "pensize" in d:
            self._pensize = d["pensize"]
        if "speed" in d:
            self.speed(d["speed"])
        self._sync()

    def speed(self, speed=None):
        """速さ: 1 (遅い) 〜 10 (速い)、0 はいちばん速い (動く様子を見せない)"""
        if speed is None:
            return self._speed
        if isinstance(speed, str):
            speed = _SPEEDS.get(speed, 6)
        speed = float(speed)
        self._speed = int(round(speed)) if 0.5 < speed < 10.5 else 0

    # ---- 見た目 ----
    def showturtle(self):
        """タートルを表示する"""
        self._visible = True
        self._sync()

    st = showturtle

    def hideturtle(self):
        """タートルを隠す (速く描けます)"""
        self._visible = False
        self._sync()

    ht = hideturtle

    def isvisible(self):
        return self._visible

    def shape(self, name=None):
        """形: "arrow" "turtle" "circle" "square" "triangle" "classic\""""
        if name is None:
            return self._shape
        if name not in self.screen._shapes:
            raise TurtleGraphicsError("There is no shape named %s" % name)
        self._shape = name
        self._sync()

    def shapesize(self, stretch_wid=None, stretch_len=None, outline=None):
        """形の大きさ (縦の倍率, 横の倍率, 輪郭の太さ)"""
        if stretch_wid is None and stretch_len is None and outline is None:
            return self._stretch
        sw, sl, ol = self._stretch
        if stretch_wid is not None:
            sw = stretch_wid
            sl = stretch_len if stretch_len is not None else stretch_wid
        elif stretch_len is not None:
            sl = stretch_len
        if outline is not None:
            ol = outline
        self._stretch = (float(sw), float(sl), ol)
        self._sync()

    turtlesize = shapesize

    def shearfactor(self, shear=None):
        return 0.0 if shear is None else None

    def tilt(self, angle):
        """形だけを angle 度回す"""
        self._tilt = (self._tilt + self._deg(angle)) % 360
        self._sync()

    def settiltangle(self, angle):
        self._tilt = self._deg(angle) % 360
        self._sync()

    def tiltangle(self, angle=None):
        if angle is None:
            return self._from_deg(self._tilt)
        self.settiltangle(angle)

    def shapetransform(self, t11=None, t12=None, t21=None, t22=None):
        return (1.0, 0.0, 0.0, 1.0)

    def get_shapepoly(self):
        return self.screen._shapes.get(self._shape, ("polygon", ()))[1]

    # ---- 調べる ----
    def position(self):
        """今の位置 (x, y)"""
        return Vec2D(self._x, self._y)

    pos = position

    def xcor(self):
        return self._x

    def ycor(self):
        return self._y

    def heading(self):
        """今の向き (度)"""
        h = self._h
        if self.screen._mode == "logo":
            h = (90.0 - h) % 360.0
        return self._from_deg(round(h, 10) % 360.0)

    def towards(self, x, y=None):
        """(x, y) の方向 (度)"""
        if y is None:
            x, y = (x.position() if isinstance(x, Turtle) else x)
        a = _math.degrees(_math.atan2(y - self._y, x - self._x)) % 360.0
        if self.screen._mode == "logo":
            a = (90.0 - a) % 360.0
        return self._from_deg(a)

    def distance(self, x, y=None):
        """(x, y) までの距離"""
        if y is None:
            x, y = (x.position() if isinstance(x, Turtle) else x)
        return _math.hypot(x - self._x, y - self._y)

    def degrees(self, fullcircle=360.0):
        """角度を度で (1 周 = fullcircle)"""
        self._fullcircle = float(fullcircle)

    def radians(self):
        """角度をラジアンで"""
        self._fullcircle = 2 * _math.pi

    # ---- 消す・戻す ----
    def clear(self):
        """このタートルが描いた絵を消す (位置はそのまま)"""
        self._stamps = []
        _emit(["cl", self._id])

    def reset(self):
        """このタートルの絵を消して、最初の状態に戻す"""
        self._stamps = []
        _emit(["cl", self._id])
        self._x = self._y = 0.0
        self._h = 0.0
        self._down, self._pensize, self._pencolor, self._fillcolor = True, 1, "black", "black"
        self._visible, self._stretch, self._tilt, self._filling = True, (1.0, 1.0, 1), 0.0, False
        self._sync()

    def undo(self):
        _fc.note("undo", "turtle: この環境では undo() は使えません")

    def setundobuffer(self, size):
        pass

    def undobufferentries(self):
        return 0

    # ---- そのほか ----
    def begin_poly(self):
        self._polyrec = [(self._x, self._y)]

    def end_poly(self):
        self._poly = tuple(self._polyrec or ())
        self._polyrec = None

    def get_poly(self):
        return self._poly

    def clone(self):
        """同じ状態のタートルをもう 1 匹作る"""
        t = Turtle(self._shape, visible=False)
        for k in ("_x", "_y", "_h", "_down", "_pensize", "_pencolor", "_fillcolor", "_speed", "_stretch", "_tilt", "_fullcircle"):
            setattr(t, k, getattr(self, k))
        t._visible = self._visible
        t._sync()
        return t

    def getturtle(self):
        return self

    getpen = getturtle

    def getscreen(self):
        return self.screen

    def onclick(self, fun, btn=1, add=None):
        """このタートルをクリック (タップ) したときに fun(x, y) を呼ぶ"""
        if fun is None:
            self._clicks.pop(btn, None)
        else:
            self._clicks[btn] = fun
        self.screen._send_bindings()

    def onrelease(self, fun, btn=1, add=None):
        if fun is None:
            self._releases.pop(btn, None)
        else:
            self._releases[btn] = fun
        self.screen._send_bindings()

    def ondrag(self, fun, btn=1, add=None):
        """このタートルをドラッグしたときに fun(x, y) を呼ぶ"""
        if fun is None:
            self._drags.pop(btn, None)
        else:
            self._drags[btn] = fun
        self.screen._send_bindings()


RawTurtle = RawPen = Pen = Turtle


def getturtle():
    """いつも使うタートル"""
    if Turtle._pen is None:
        Turtle._pen = Turtle()
    return Turtle._pen


getpen = getturtle


def _make_global(cls_name, name):
    if cls_name == "screen":
        meth = getattr(_Screen, name)

        def f(*args, **kwargs):
            return getattr(Screen(), name)(*args, **kwargs)
    else:
        meth = getattr(Turtle, name)

        def f(*args, **kwargs):
            return getattr(getturtle(), name)(*args, **kwargs)
    f.__name__ = name
    f.__doc__ = meth.__doc__
    return f


_tg_screen_functions = ["addshape", "bgcolor", "bgpic", "bye", "clearscreen", "colormode", "delay", "exitonclick", "getcanvas",
                        "getshapes", "listen", "mainloop", "mode", "numinput", "onkey", "onkeypress", "onkeyrelease", "onscreenclick",
                        "ontimer", "register_shape", "resetscreen", "screensize", "setup", "setworldcoordinates", "textinput",
                        "title", "tracer", "turtles", "update", "window_height", "window_width", "done"]
_tg_turtle_functions = ["back", "backward", "begin_fill", "begin_poly", "bk", "circle", "clear", "clearstamp", "clearstamps",
                        "clone", "color", "degrees", "distance", "dot", "down", "end_fill", "end_poly", "fd", "fillcolor", "filling",
                        "forward", "get_poly", "getscreen", "get_shapepoly", "goto", "heading", "hideturtle", "home", "ht",
                        "isdown", "isvisible", "left", "lt", "onclick", "ondrag", "onrelease", "pd", "pen", "pencolor", "pendown",
                        "pensize", "penup", "pos", "position", "pu", "radians", "right", "reset", "rt", "seth", "setheading",
                        "setpos", "setposition", "settiltangle", "setundobuffer", "setx", "sety", "shape", "shapesize",
                        "shapetransform", "shearfactor", "showturtle", "speed", "st", "stamp", "teleport", "tilt", "tiltangle",
                        "towards", "turtlesize", "undo", "undobufferentries", "up", "width", "write", "xcor", "ycor"]
for _n in _tg_screen_functions:
    globals()[_n] = _make_global("screen", _n)
for _n in _tg_turtle_functions:
    globals()[_n] = _make_global("turtle", _n)
del _n

__all__ = (["ScrolledCanvas", "TurtleScreen", "Screen", "RawTurtle", "Turtle", "RawPen", "Pen", "Shape", "Vec2D",
            "Terminator", "TurtleGraphicsError", "getturtle", "getpen", "write_docstringdict"]
           + _tg_screen_functions + _tg_turtle_functions)
ScrolledCanvas = None


def write_docstringdict(filename="turtle_docstringdict"):
    pass
`
