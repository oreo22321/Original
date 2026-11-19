var i="/home/pyodide/.forgecode",n=String.raw`"""ForgeCode の実行環境 (ブラウザの Python を、ふつうの Python に近づける道具)"""
import sys, os, io, json, base64, builtins, time as _time, heapq
import js

PROJECT = "/home/pyodide/project"
LIB = "/home/pyodide/.forgecode"
sys.dont_write_bytecode = True  # 書き換えたモジュールが古いまま使われないように (.pyc を作らない)
_notes = set()
_finishers = []
_user = {"active": False, "saved": None}


def note(key, text):
    """実行ごとに 1 回だけ、出力に説明を出す"""
    if key in _notes:
        return
    _notes.add(key)
    js.__fc_meta(text)


def on_finish(fn):
    if fn not in _finishers:
        _finishers.append(fn)


# ============================================================
# time.sleep (■ で止められる・待つ前に出力を送る)
# ============================================================
_orig_sleep = _time.sleep


_slept = [False]


def sleep(secs):
    _slept[0] = True
    if isinstance(secs, (str, bytes)) or secs is None or not (hasattr(type(secs), "__float__") or hasattr(type(secs), "__index__")):
        return _orig_sleep(secs)
    s = float(secs)
    if s != s:
        raise ValueError("Invalid value NaN (not a number)")
    if s < 0:
        raise ValueError("sleep length must be non-negative")
    end = _time.monotonic() + s
    while True:
        left = end - _time.monotonic()
        if left <= 0:
            return None
        if not js.__fc_sleep(min(left, 0.2)):
            _orig_sleep(left)
            return None


sleep.__doc__ = _orig_sleep.__doc__
_time.sleep = sleep


# ============================================================
# 読み込んだときに手を加える (matplotlib.pyplot・PIL.Image・urllib.request など)
# ============================================================
class _HookLoader:
    def __init__(self, inner, hook):
        self._inner = inner
        self._hook = hook

    def create_module(self, spec):
        f = getattr(self._inner, "create_module", None)
        return f(spec) if f else None

    def exec_module(self, module):
        try:
            self._inner.exec_module(module)
        finally:
            try:
                module.__spec__.loader = self._inner
                module.__loader__ = self._inner
            except Exception:
                pass
        try:
            self._hook(module)
        except Exception:
            pass

    def __getattr__(self, name):
        return getattr(self._inner, name)


class _Hooks:
    def __init__(self):
        self.hooks = {}

    def find_spec(self, name, path=None, target=None):
        hook = self.hooks.get(name)
        if hook is None:
            return None
        for f in sys.meta_path:
            if f is self or not hasattr(f, "find_spec"):
                continue
            spec = f.find_spec(name, path, target)
            if spec is not None:
                if spec.loader is not None and hasattr(spec.loader, "exec_module"):
                    spec.loader = _HookLoader(spec.loader, hook)
                return spec
        return None


_hooks = _Hooks()
sys.meta_path.insert(0, _hooks)


def on_import(name, fn):
    if name in sys.modules:
        try:
            fn(sys.modules[name])
        except Exception:
            pass
    else:
        _hooks.hooks[name] = fn


# ============================================================
# スレッド: 同時には動かせないので、start() の時点で順番に実行する
# ============================================================
import threading as _threading
import _thread

_THREAD_NOTE = "この環境ではスレッドを同時に動かせないため、start() した時点で順番に実行します"
_Thread = _threading.Thread
_orig_start, _orig_join, _orig_alive = _Thread.start, _Thread.join, _Thread.is_alive


def _thread_start(self):
    try:
        return _orig_start(self)
    except RuntimeError as e:
        if "can't start new thread" not in str(e):
            raise
    note("thread", _THREAD_NOTE)
    self.__dict__["_fc_state"] = "running"
    self._started.set()
    active = _threading._active
    ident = _threading.get_ident()
    prev = active.get(ident)
    active[ident] = self
    try:
        self.run()
    except SystemExit:
        pass
    except KeyboardInterrupt:
        raise
    except BaseException as e:
        # この道具の行はトレースバックに出さない
        if e.__traceback__ is not None and e.__traceback__.tb_next is not None:
            e.__traceback__ = e.__traceback__.tb_next
        try:
            self._invoke_excepthook(self)
        except Exception:
            import traceback
            traceback.print_exc()
    finally:
        if prev is not None:
            active[ident] = prev
        else:
            active.pop(ident, None)
        self.__dict__["_fc_state"] = "done"


def _thread_join(self, timeout=None):
    if self.__dict__.get("_fc_state"):
        return None
    return _orig_join(self, timeout)


def _thread_alive(self):
    st = self.__dict__.get("_fc_state")
    if st:
        return st == "running"
    return _orig_alive(self)


_Thread.start, _Thread.join, _Thread.is_alive = _thread_start, _thread_join, _thread_alive
_thread_start.__doc__, _thread_join.__doc__, _thread_alive.__doc__ = _orig_start.__doc__, _orig_join.__doc__, _orig_alive.__doc__

_orig_snt = _thread.start_new_thread


def _start_new_thread(function, args, kwargs=None):
    try:
        return _orig_snt(function, args, kwargs or {})
    except RuntimeError as e:
        if "can't start new thread" not in str(e):
            raise
    note("thread", _THREAD_NOTE)
    try:
        function(*args, **(kwargs or {}))
    except SystemExit:
        pass
    except KeyboardInterrupt:
        raise
    except BaseException:
        import traceback
        traceback.print_exc()
    return _thread.get_ident()


_thread.start_new_thread = _start_new_thread
if hasattr(_thread, "start_new"):
    _thread.start_new = _start_new_thread

import concurrent.futures as _cf
import concurrent.futures.thread as _cft


class SyncExecutor(_cf.Executor):
    """ThreadPoolExecutor / ProcessPoolExecutor の代わり (submit した時点で順番に実行します)"""

    def __init__(self, max_workers=None, *args, initializer=None, initargs=(), **kwargs):
        if max_workers is not None and max_workers <= 0:
            raise ValueError("max_workers must be greater than 0")
        self._shutdown = False
        self._max_workers = max_workers or 1
        if initializer is not None:
            initializer(*initargs)

    def submit(self, fn, /, *args, **kwargs):
        if self._shutdown:
            raise RuntimeError("cannot schedule new futures after shutdown")
        note("executor", "この環境ではスレッドやプロセスを同時に動かせないため、submit / map した時点で順番に実行します")
        f = _cf.Future()
        f.set_running_or_notify_cancel()
        try:
            r = fn(*args, **kwargs)
        except KeyboardInterrupt:
            raise
        except BaseException as e:
            f.set_exception(e)
        else:
            f.set_result(r)
        return f

    def shutdown(self, wait=True, *, cancel_futures=False):
        self._shutdown = True


_cf.ThreadPoolExecutor = SyncExecutor
_cf.ProcessPoolExecutor = SyncExecutor
_cft.ThreadPoolExecutor = SyncExecutor


# ============================================================
# asyncio: ブラウザの仕組み (JSPI) がなくても asyncio.run() が動くイベントループ
# ============================================================
import asyncio
from asyncio import events as _events, base_events as _base_events


class _NoSelector:
    def select(self, timeout=None):
        if timeout is None:
            sleep(0.05)
        elif timeout > 0:
            sleep(timeout)
        return []

    def close(self):
        pass

    def get_map(self):
        return {}


class ForgeEventLoop(_base_events.BaseEventLoop):
    """時間待ち (asyncio.sleep など) を time.sleep で待つ、ふつうの Python と同じイベントループ"""

    def __init__(self):
        super().__init__()
        self._selector = _NoSelector()

    def _process_events(self, event_list):
        pass

    def _write_to_self(self):
        pass

    def run_forever(self):
        prev = _events._get_running_loop()
        outer = prev is not None and not isinstance(prev, ForgeEventLoop)
        if outer:
            _events._set_running_loop(None)
        try:
            return super().run_forever()
        finally:
            if outer:
                _events._set_running_loop(prev)


class _Policy(_events._BaseDefaultEventLoopPolicy):
    _loop_factory = ForgeEventLoop

    def get_event_loop(self):
        try:
            return super().get_event_loop()
        except RuntimeError:
            loop = self.new_event_loop()
            self.set_event_loop(loop)
            return loop


_orig_asyncio_run = asyncio.run


def _asyncio_run(main, *, debug=None, loop_factory=None):
    prev = _events._get_running_loop()
    if isinstance(prev, ForgeEventLoop):
        raise RuntimeError("asyncio.run() cannot be called from a running event loop")
    _events._set_running_loop(None)
    try:
        with asyncio.Runner(debug=debug, loop_factory=loop_factory or ForgeEventLoop) as runner:
            return runner.run(main)
    finally:
        _events._set_running_loop(prev)


_asyncio_run.__doc__ = _orig_asyncio_run.__doc__
asyncio.run = _asyncio_run
asyncio.runners.run = _asyncio_run


def run_coro(coro):
    return _asyncio_run(coro)


# ============================================================
# 実行の始まりと終わり
# ============================================================
def begin(argv=None):
    _notes.clear()
    _finishers.clear()
    _evq.clear()
    _slept[0] = False
    _figs["keys"].clear()
    _figs["sites"].clear()
    _figs["anims"].clear()
    _figs["count"].clear()
    _figs["scale"].clear()
    if argv is not None:
        sys.argv = list(argv)
        # プロジェクトのモジュールは読み直す (書き換えたものが使われるように) / turtle は新しい画面から
        for name, m in list(sys.modules.items()):
            f = getattr(m, "__file__", None) or ""
            if f.startswith(PROJECT + "/"):
                del sys.modules[name]
        for lib in ("turtle", "pygame._base", "tkinter"):
            t = sys.modules.get(lib)
            if t is not None and hasattr(t, "_reset_all"):
                try:
                    t._reset_all()
                except Exception:
                    pass
        import importlib
        importlib.invalidate_caches()
    if not _user["active"]:
        _user["saved"] = (_events._get_running_loop(), _events._get_event_loop_policy())
        _user["active"] = True
    _events._set_running_loop(None)
    _events._set_event_loop_policy(_Policy())


def end():
    for fn in list(_finishers):
        try:
            fn()
        except BaseException:
            pass
    if _user["active"]:
        loop, policy = _user["saved"]
        _events._set_event_loop_policy(policy)
        _events._set_running_loop(loop)
        _user["active"] = False


# ============================================================
# 画面からの操作 (キー・クリック・タップ): turtle / pygame / tkinter / 図 で分けて受け取る
# ============================================================
_evq = {}


def _pump_events():
    while True:
        s = js.__fc_ev_poll()
        if not s:
            return
        try:
            evs = json.loads(s)
        except Exception:
            continue
        for ev in evs:
            q = _evq.setdefault(ev.get("s") or "turtle", [])
            q.append(ev)
            if len(q) > 2000:
                del q[:1000]


def take_events(source):
    """source ("turtle" / "pg" / "tk" / "fig") あての操作を取り出す"""
    _pump_events()
    q = _evq.get(source)
    if not q:
        return []
    out = list(q)
    q.clear()
    return out


def events_ok():
    return bool(js.__fc_ev_ok())


def wait_events(ms):
    """操作が届くか、ms ミリ秒たつか、■ が押されるまで待つ"""
    return js.__fc_ev_wait(int(max(1, ms)))


def rpc(op, args=None, data=None):
    """画面 (メインスレッド) に頼んで、結果を待つ (画像の読み込み・ダイアログなど)"""
    if data is not None:
        from pyodide.ffi import to_js
        data = to_js(data)
    r = js.__fc_rpc(op, json.dumps(args or {}), data)
    if r is None:
        raise KeyboardInterrupt
    return r


# ============================================================
# 表示: display() / 画像 / 表
# ============================================================
def _png(data, key=None):
    js.__fc_image(base64.b64encode(data).decode(), key)


# ---- matplotlib の図: 1 つの画面で描き直す (plt.pause・アニメーション・ion・ループの中の plt.show) ----
# 図は PNG にせず、Agg の画素 (RGBA) をそのまま画面のキャンバスへ送るので、速くなめらかに動きます
_figs = {"gen": 0, "seq": 0, "keys": {}, "sites": {}, "scale": {}, "count": {}, "anims": [], "closed": set()}


def _site():
    f = sys._getframe(2)
    while f is not None:
        fn = f.f_code.co_filename
        if fn.startswith(PROJECT + "/") or fn.startswith("<"):
            return "%s:%d" % (fn, f.f_lineno)
        f = f.f_back
    return "?"


def _agg_canvas(fig):
    c = fig.canvas
    if hasattr(c, "buffer_rgba") and hasattr(c, "draw"):
        return c
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    return FigureCanvasAgg(fig)


def present(fig, key, title=None):
    """図を描いて、画面の key の場所へ送る (同じ key なら同じ場所で描き直す)"""
    canvas = _agg_canvas(fig)
    # はじめの 1 枚はくっきり (2 倍)。動き始めたら軽く (1.25 倍まで) して、メモリと時間を節約する
    n = _figs["count"].get(key, 0)
    _figs["count"][key] = n + 1
    sc = _figs["scale"].get(key, 2.0 if n == 0 else 1.25)
    if n > 0:
        sc = min(sc, 1.25)
    # 画素数の上限 (大きな図でもメモリを使いすぎないように)
    try:
        wi, hi = fig.get_size_inches()
        px = wi * hi * (fig.dpi * sc) ** 2
        if px > 2_400_000:
            sc = max(0.5, sc * (2_400_000 / px) ** 0.5)
    except Exception:
        pass
    dpi0 = fig.dpi
    t0 = _time.monotonic()
    try:
        fig.dpi = dpi0 * sc
        canvas.draw()
        mv = memoryview(canvas.buffer_rgba())
        h, w = mv.shape[0], mv.shape[1]
        if title is None:
            try:
                title = fig.canvas.manager.get_window_title()
            except Exception:
                title = "Figure %s" % getattr(fig, "number", "")
        js.__fc_frame(key, w, h, mv, sc, str(title or ""))
    finally:
        fig.dpi = dpi0
    # 描くのに時間がかかる図は、少し粗くして速く動かす
    dt = _time.monotonic() - t0
    if dt > 0.07 and sc > 1.0:
        _figs["scale"][key] = max(1.0, sc * 0.8)


def _fig_key(fig, site=None):
    num = getattr(fig, "number", id(fig))
    k = _figs["keys"].get(num)
    if k is None and site is not None:
        # 同じ行の plt.show() を、待ちながら何度も呼んでいる (ループのアニメーション) → 同じ場所で描き直す
        prev = _figs["sites"].get(site)
        if prev and _slept[0]:
            k = prev.get(num)
    if k is None:
        _figs["seq"] += 1
        k = "fig-%d" % _figs["seq"]
    _figs["keys"][num] = k
    return k


def _fignums(plt):
    try:
        return list(plt.get_fignums())
    except Exception:
        return []


def show_figures(live=False, site=None):
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return
    nums = _fignums(plt)
    if not nums:
        return
    if not live and _run_animations(plt):
        nums = _fignums(plt)
    keys = {}
    for num in nums:
        fig = plt.figure(num)
        k = _fig_key(fig, site)
        keys[num] = k
        present(fig, k)
    if not live:
        if site is not None:
            _figs["sites"][site] = keys
        _slept[0] = False
        plt.close("all")
        _figs["keys"].clear()


def _live(fig):
    # plt.draw()・fig.canvas.draw_idle()・flush_events() (plt.ion() のとき): その図だけ描き直す
    try:
        present(fig, _fig_key(fig))
    except Exception:
        pass


# ---- matplotlib.animation (FuncAnimation / ArtistAnimation): plt.show() で再生する ----
def _run_animations(plt):
    import weakref
    live = []
    for r in _figs["anims"]:
        a = r()
        if a is None or getattr(a, "_fc_done", False):
            continue
        fig = getattr(a, "_fig", None)
        if fig is None or getattr(fig, "number", None) not in _fignums(plt):
            continue
        live.append(a)
    _figs["anims"].clear()
    if not live:
        return False
    note("anim", "matplotlib: アニメーションを再生しています (■ で止めます)")
    slots = []
    for a in live:
        a._fc_done = True
        fig = a._fig
        try:
            a._blit = False  # 毎回ぜんぶ描く (ブリットは使わない)
        except Exception:
            pass
        try:
            a.event_source.stop()
        except Exception:
            pass
        key = _fig_key(fig)
        try:
            present(fig, key)  # 最初の描画 (ここで init_func が呼ばれる)
        except Exception:
            pass
        interval = max(0.001, float(getattr(a, "_interval", 200) or 200) / 1000.0)
        slots.append([a, iter(a.new_frame_seq()), interval, _time.monotonic(), key, fig, 0])
    while slots:
        now = _time.monotonic()
        nxt = min(s[3] for s in slots)
        if nxt > now:
            sleep(nxt - now)
        for ev in take_events("fig"):
            if ev.get("t") == "close":
                slots = [s for s in slots if s[4] != ev.get("key")]
        for s in list(slots):
            if s not in slots or s[3] > _time.monotonic():
                continue
            a = s[0]
            try:
                fd = next(s[1])
            except StopIteration:
                if not getattr(a, "_repeat", False):
                    slots.remove(s)
                    continue
                s[6] += 1
                try:
                    a._init_draw()
                except Exception:
                    pass
                s[1] = iter(a.new_frame_seq())
                try:
                    fd = next(s[1])
                except StopIteration:
                    slots.remove(s)
                    continue
                delay = float(getattr(a, "_repeat_delay", 0) or 0) / 1000.0
                if delay:
                    s[3] = _time.monotonic() + delay
                    continue
            a._draw_frame(fd)
            present(s[5], s[4])
            s[3] += s[2]
            if s[3] < _time.monotonic() - 0.25:
                s[3] = _time.monotonic()
    return True


def _hook_animation(anim):
    import weakref
    orig = anim.Animation.__init__

    def __init__(self, *args, **kwargs):
        orig(self, *args, **kwargs)
        _figs["anims"].append(weakref.ref(self))

    anim.Animation.__init__ = __init__


def _pil_png(img):
    buf = io.BytesIO()
    im = img
    if im.mode not in ("RGB", "RGBA", "L", "LA", "P", "1", "I;16"):
        im = im.convert("RGBA")
    im.save(buf, format="PNG")
    return buf.getvalue()


def _display_one(o):
    mod = type(o).__module__ or ""
    if mod.startswith("matplotlib") and hasattr(o, "savefig") and hasattr(o, "canvas"):
        _figs["seq"] += 1
        present(o, "fig-%d" % _figs["seq"])
        return
    if mod.startswith("PIL") and hasattr(o, "save") and hasattr(o, "mode"):
        _png(_pil_png(o))
        return
    f = getattr(o, "_repr_png_", None)
    if callable(f):
        try:
            data = f()
            if data:
                _png(data if isinstance(data, bytes) else base64.b64decode(data))
                return
        except Exception:
            pass
    f = getattr(o, "_repr_html_", None)
    if callable(f) and not isinstance(o, type):
        try:
            html = f()
            if html:
                js.__fc_html(str(html), repr(o)[:4000])
                return
        except Exception:
            pass
    f = getattr(o, "_repr_svg_", None)
    if callable(f) and not isinstance(o, type):
        try:
            svg = f()
            if svg:
                js.__fc_svg(str(svg))
                return
        except Exception:
            pass
    print(repr(o))


def display(*objs, **kwargs):
    """表 (pandas)・画像 (PIL・matplotlib の図) などを、出力に見やすく表示します"""
    for o in objs:
        _display_one(o)


builtins.display = display


def rich(v):
    """コンソールの値: 表なら HTML も返す"""
    f = getattr(v, "_repr_html_", None)
    if callable(f) and not isinstance(v, type):
        try:
            html = f()
            if html:
                return str(html)
        except Exception:
            pass
    return None


def _hook_pyplot(plt):
    try:
        import matplotlib
        matplotlib.use("agg")
    except Exception:
        pass
    orig_draw = plt.draw

    def show(*args, block=None, **kwargs):
        show_figures(live=(block is False), site=_site())

    def pause(interval):
        nums = _fignums(plt)
        for num in nums:
            _live(plt.figure(num))
        sleep(interval)

    def draw():
        orig_draw()
        if _fignums(plt):
            _live(plt.gcf())

    show.__doc__ = plt.show.__doc__
    pause.__doc__ = plt.pause.__doc__
    draw.__doc__ = orig_draw.__doc__
    plt.show = show
    plt.pause = pause
    plt.draw = draw
    try:
        from matplotlib.backend_bases import FigureCanvasBase

        def flush_events(self):
            if self.figure is not None and getattr(self.figure, "number", None) in _fignums(plt):
                _live(self.figure)

        FigureCanvasBase.flush_events = flush_events
    except Exception:
        pass


on_import("matplotlib.pyplot", _hook_pyplot)
on_import("matplotlib.animation", _hook_animation)


def _hook_pil(Image):
    def show(self, title=None, **kwargs):
        _png(_pil_png(self))

    Image.Image.show = show


on_import("PIL.Image", _hook_pil)


def _hook_getpass(getpass):
    def _getpass(prompt="Password: ", stream=None, **kwargs):
        js.__fc_password()
        return builtins.input(prompt)

    getpass.getpass = _getpass


on_import("getpass", _hook_getpass)


# ============================================================
# 通信: urllib.request をブラウザの通信 (XMLHttpRequest) で
# ============================================================
_FORBIDDEN = {"host", "connection", "user-agent", "accept-encoding", "content-length", "cookie", "origin", "referer", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade"}


def http_request(method, url, headers=None, body=None, timeout=None):
    """(status, reason, headers の文字列, 本文 bytes, 最終的な URL)"""
    XHR = getattr(js, "XMLHttpRequest", None)
    if XHR is None:
        raise OSError("この環境ではインターネットに接続できません")
    x = XHR.new()
    x.open(method, url, False)
    try:
        x.responseType = "arraybuffer"
    except Exception:
        pass
    if timeout:
        try:
            x.timeout = int(timeout * 1000)
        except Exception:
            pass
    for k, v in (headers or {}).items():
        if k.lower() in _FORBIDDEN:
            continue
        try:
            x.setRequestHeader(k, str(v))
        except Exception:
            pass
    try:
        if body is None:
            x.send()
        else:
            from pyodide.ffi import to_js
            if isinstance(body, str):
                body = body.encode("utf-8")
            if not isinstance(body, (bytes, bytearray, memoryview)):
                body = b"".join(bytes(b) if not isinstance(b, str) else b.encode() for b in body)
            x.send(to_js(bytes(body)))
    except Exception as e:
        raise ConnectionError(_net_error(url)) from None
    if not x.status:
        raise ConnectionError(_net_error(url))
    data = b""
    resp = x.response
    if resp is not None:
        try:
            data = js.Uint8Array.new(resp).to_bytes()
        except Exception:
            data = str(resp).encode("utf-8")
    return x.status, x.statusText or "", x.getAllResponseHeaders() or "", data, x.responseURL or url


def _net_error(url):
    return ("%s に接続できませんでした (インターネットにつながっていないか、相手のサーバーがブラウザからの読み込みを許可していません (CORS))" % url)


def _hook_urllib(ur):
    import http.client
    import urllib.error

    class _Response(io.BytesIO):
        def __init__(self, data, url, status, reason, headers):
            super().__init__(data)
            self.url = url
            self.status = self.code = status
            self.reason = self.msg = reason
            self.headers = headers
            self.length = len(data)
            self.version = 11
            self.will_close = True
            self.chunked = False

        def getcode(self):
            return self.status

        def geturl(self):
            return self.url

        def info(self):
            return self.headers

        def getheader(self, name, default=None):
            return self.headers.get(name, default)

        def getheaders(self):
            return list(self.headers.items())

        def isclosed(self):
            return self.closed

        def __repr__(self):
            return "<http.client.HTTPResponse status=%d>" % self.status

    def do_open(self, http_class, req, **kwargs):
        headers = dict(req.unredirected_hdrs)
        headers.update({k: v for k, v in req.headers.items() if k not in headers})
        timeout = req.timeout if isinstance(getattr(req, "timeout", None), (int, float)) else None
        try:
            status, reason, raw, data, final = http_request(req.get_method(), req.full_url, headers, req.data, timeout)
        except ConnectionError as e:
            raise urllib.error.URLError(str(e)) from None
        hdrs = http.client.parse_headers(io.BytesIO(raw.replace("\r\n", "\n").encode("latin-1", "replace")))
        return _Response(data, final, status, reason, hdrs)

    ur.AbstractHTTPHandler.do_open = do_open


on_import("urllib.request", _hook_urllib)
`,f=String.raw`"""ForgeCode の webbrowser: 出力にリンクを表示します (タップで開けます)"""
import js

__all__ = ["Error", "open", "open_new", "open_new_tab", "get", "register"]


class Error(Exception):
    pass


def open(url, new=0, autoraise=True):
    js.__fc_link(str(url))
    return True


def open_new(url):
    return open(url, 1)


def open_new_tab(url):
    return open(url, 2)


class _Browser:
    name = "forgecode"

    def open(self, url, new=0, autoraise=True):
        return open(url, new)

    def open_new(self, url):
        return open(url, 1)

    def open_new_tab(self, url):
        return open(url, 2)


def get(using=None):
    return _Browser()


def register(name, klass, instance=None, *, preferred=False):
    pass
`,o=String.raw`"""ForgeCode の multiprocessing
ブラウザではプロセスを作れないため、同じ Python の中で順番に実行します (結果はふつうと同じになります)
"""
import os as _os
import queue as _queue
import threading as _th
import itertools as _it
import traceback as _tb

__all__ = ["Process", "Pool", "Queue", "JoinableQueue", "SimpleQueue", "Pipe", "Lock", "RLock", "Event", "Semaphore",
           "BoundedSemaphore", "Condition", "Barrier", "Value", "Array", "Manager", "cpu_count", "current_process",
           "parent_process", "active_children", "freeze_support", "set_start_method", "get_start_method",
           "get_context", "get_all_start_methods", "TimeoutError", "ProcessError", "AuthenticationError", "BufferTooShort"]


def _note():
    try:
        import _forgecode
        _forgecode.note("mp", "この環境ではプロセスを作れないため、multiprocessing の処理は順番に実行します")
    except Exception:
        pass


class ProcessError(Exception):
    pass


class BufferTooShort(ProcessError):
    pass


class TimeoutError(ProcessError):
    pass


class AuthenticationError(ProcessError):
    pass


Lock, RLock, Event, Semaphore, BoundedSemaphore, Condition, Barrier = _th.Lock, _th.RLock, _th.Event, _th.Semaphore, _th.BoundedSemaphore, _th.Condition, _th.Barrier
_pids = _it.count(_os.getpid() + 1)


class _Current:
    name = "MainProcess"
    daemon = False
    exitcode = None
    authkey = b""

    @property
    def pid(self):
        return _os.getpid()

    ident = pid


_main = _Current()
_cur = [_main]


def current_process():
    return _cur[-1]


def parent_process():
    return None if _cur[-1] is _main else _main


def active_children():
    return []


def cpu_count():
    return _os.cpu_count() or 1


def freeze_support():
    pass


def set_start_method(method, force=False):
    pass


def get_start_method(allow_none=False):
    return "fork"


def get_all_start_methods():
    return ["fork", "spawn"]


class Process:
    _counter = _it.count(1)

    def __init__(self, group=None, target=None, name=None, args=(), kwargs=None, *, daemon=None):
        self._target = target
        self._args = tuple(args)
        self._kwargs = dict(kwargs or {})
        self.name = name or "Process-%d" % next(Process._counter)
        self.daemon = bool(daemon)
        self.exitcode = None
        self.pid = None
        self.authkey = b""

    @property
    def ident(self):
        return self.pid

    def run(self):
        if self._target is not None:
            self._target(*self._args, **self._kwargs)

    def start(self):
        if self.pid is not None:
            raise AssertionError("cannot start a process twice")
        _note()
        self.pid = next(_pids)
        _cur.append(self)
        try:
            self.run()
            self.exitcode = 0
        except SystemExit as e:
            self.exitcode = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
        except KeyboardInterrupt:
            raise
        except BaseException:
            print("Process %s:" % self.name)
            _tb.print_exc()
            self.exitcode = 1
        finally:
            _cur.pop()

    def join(self, timeout=None):
        pass

    def is_alive(self):
        return False

    def terminate(self):
        pass

    def kill(self):
        pass

    def close(self):
        pass

    @property
    def sentinel(self):
        return 0


class Queue(_queue.Queue):
    def __init__(self, maxsize=0, *, ctx=None):
        super().__init__(maxsize)

    def close(self):
        pass

    def join_thread(self):
        pass

    def cancel_join_thread(self):
        pass


JoinableQueue = Queue


class SimpleQueue(_queue.SimpleQueue):
    def close(self):
        pass

    def empty(self):
        return super().empty()


class _Conn:
    def __init__(self, inbox, outbox):
        self._in, self._out = inbox, outbox
        self.closed = False

    def send(self, obj):
        self._out.append(obj)

    def recv(self):
        if not self._in:
            raise EOFError("相手がまだ何も送っていません (この環境では順番に実行するため、送る側を先に実行します)")
        return self._in.pop(0)

    def poll(self, timeout=0.0):
        return bool(self._in)

    def send_bytes(self, buf, offset=0, size=None):
        b = bytes(buf)
        self.send(b[offset: None if size is None else offset + size])

    def recv_bytes(self, maxlength=None):
        return self.recv()

    def close(self):
        self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


def Pipe(duplex=True):
    a, b = [], []
    return _Conn(a, b), _Conn(b, a)


class _Value:
    def __init__(self, typecode_or_type, value, lock=True):
        self.value = value
        self._lock = _th.RLock()

    def get_lock(self):
        return self._lock

    def get_obj(self):
        return self

    def __repr__(self):
        return "<Value %r>" % (self.value,)


def Value(typecode_or_type, *args, lock=True):
    return _Value(typecode_or_type, args[0] if args else 0, lock)


class _Array(list):
    def __init__(self, init):
        super().__init__(init)
        self._lock = _th.RLock()

    def get_lock(self):
        return self._lock

    def get_obj(self):
        return self


def Array(typecode_or_type, size_or_initializer, *, lock=True):
    if isinstance(size_or_initializer, int):
        return _Array([0] * size_or_initializer)
    return _Array(size_or_initializer)


class _Namespace:
    def __repr__(self):
        return "Namespace(%s)" % ", ".join("%s=%r" % kv for kv in self.__dict__.items())


class _Manager:
    def start(self, *a, **k):
        pass

    def shutdown(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        pass

    def dict(self, *a, **k):
        return dict(*a, **k)

    def list(self, *a):
        return list(*a)

    def Queue(self, maxsize=0):
        return Queue(maxsize)

    JoinableQueue = Queue

    def Value(self, typecode, value, lock=True):
        return _Value(typecode, value)

    def Array(self, typecode, seq, lock=True):
        return Array(typecode, seq)

    def Namespace(self):
        return _Namespace()

    def Lock(self):
        return Lock()

    def RLock(self):
        return RLock()

    def Event(self):
        return Event()

    def Semaphore(self, value=1):
        return Semaphore(value)

    def Condition(self, lock=None):
        return Condition(lock)

    def Barrier(self, parties, action=None, timeout=None):
        return Barrier(parties, action, timeout)


def Manager():
    return _Manager()


from multiprocessing.pool import Pool  # noqa: E402


class _Context:
    def __getattr__(self, name):
        return globals()[name]


def get_context(method=None):
    return _Context()
`,a=String.raw`"""ForgeCode の multiprocessing.pool (順番に実行します)"""
import itertools as _it

__all__ = ["Pool", "ThreadPool", "AsyncResult", "ApplyResult", "MapResult"]


class AsyncResult:
    def __init__(self, fn, callback=None, error_callback=None):
        self._ok = True
        try:
            self._value = fn()
        except KeyboardInterrupt:
            raise
        except BaseException as e:
            self._ok = False
            self._value = e
            if error_callback:
                error_callback(e)
        else:
            if callback:
                callback(self._value)

    def get(self, timeout=None):
        if self._ok:
            return self._value
        raise self._value

    def wait(self, timeout=None):
        pass

    def ready(self):
        return True

    def successful(self):
        return self._ok


ApplyResult = MapResult = AsyncResult


class Pool:
    def __init__(self, processes=None, initializer=None, initargs=(), maxtasksperchild=None, context=None):
        if processes is not None and processes < 1:
            raise ValueError("Number of processes must be at least 1")
        self._closed = False
        try:
            from multiprocessing import _note
            _note()
        except Exception:
            pass
        if initializer is not None:
            initializer(*initargs)

    def _check(self):
        if self._closed:
            raise ValueError("Pool not running")

    def apply(self, func, args=(), kwds={}):
        self._check()
        return func(*args, **kwds)

    def apply_async(self, func, args=(), kwds={}, callback=None, error_callback=None):
        self._check()
        return AsyncResult(lambda: func(*args, **kwds), callback, error_callback)

    def map(self, func, iterable, chunksize=None):
        self._check()
        return [func(x) for x in iterable]

    def map_async(self, func, iterable, chunksize=None, callback=None, error_callback=None):
        self._check()
        return AsyncResult(lambda: [func(x) for x in iterable], callback, error_callback)

    def imap(self, func, iterable, chunksize=1):
        self._check()
        return (func(x) for x in iterable)

    imap_unordered = imap

    def starmap(self, func, iterable, chunksize=None):
        self._check()
        return [func(*a) for a in iterable]

    def starmap_async(self, func, iterable, chunksize=None, callback=None, error_callback=None):
        self._check()
        return AsyncResult(lambda: [func(*a) for a in iterable], callback, error_callback)

    def close(self):
        self._closed = True

    def terminate(self):
        self._closed = True

    def join(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.terminate()


ThreadPool = Pool
`,_=String.raw`"""ForgeCode の multiprocessing.dummy (順番に実行します)"""
from multiprocessing import (Queue, JoinableQueue, Lock, RLock, Event, Semaphore, BoundedSemaphore, Condition, Barrier,
                             Value, Array, Manager, cpu_count, current_process, active_children, Pipe)
from multiprocessing.pool import ThreadPool as Pool
from threading import Thread as Process
`,d=String.raw`from multiprocessing import Queue, JoinableQueue, SimpleQueue
`,c=String.raw`"""winsound (ForgeCode 互換版: 画面で音を鳴らします)"""
import json as _json
import js as _js

SND_FILENAME = 0x20000
SND_ALIAS = 0x10000
SND_LOOP = 0x0008
SND_MEMORY = 0x0004
SND_PURGE = 0x0040
SND_ASYNC = 0x0001
SND_NODEFAULT = 0x0002
SND_NOSTOP = 0x0010
SND_NOWAIT = 0x2000
MB_ICONASTERISK = 0x40
MB_ICONEXCLAMATION = 0x30
MB_ICONHAND = 0x10
MB_ICONQUESTION = 0x20
MB_OK = 0x0
_n = [0]


def Beep(frequency, duration):
    if not 37 <= frequency <= 32767:
        raise ValueError("frequency must be in 37 thru 32767")
    _js.__fc_sound(_json.dumps({"op": "beep", "freq": int(frequency), "ms": int(duration)}), None)
    import time
    time.sleep(duration / 1000.0)


def MessageBeep(type=MB_OK):
    _js.__fc_sound(_json.dumps({"op": "beep", "freq": 660, "ms": 150, "wave": "sine"}), None)


def PlaySound(sound, flags):
    if sound is None or flags & SND_PURGE:
        _js.__fc_sound(_json.dumps({"op": "stopall"}), None)
        return
    if flags & SND_ALIAS:
        MessageBeep()
        return
    data = bytes(sound) if flags & SND_MEMORY else open(sound, "rb").read()
    from pyodide.ffi import to_js
    _n[0] += 1
    _js.__fc_sound(_json.dumps({"op": "play", "id": "ws%d" % _n[0], "channel": "winsound", "loops": -1 if flags & SND_LOOP else 0}), to_js(data))
`,u=String.raw`"""playsound (ForgeCode 互換版: 画面で音を鳴らします)"""
import json as _json
import js as _js

_n = [0]


class PlaysoundException(Exception):
    pass


def playsound(sound, block=True):
    import os
    path = os.fspath(sound)
    if path.startswith("http://") or path.startswith("https://"):
        raise PlaysoundException("この環境では、プロジェクトの中の音のファイルだけ鳴らせます")
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError as e:
        raise PlaysoundException(str(e))
    from pyodide.ffi import to_js
    _n[0] += 1
    _js.__fc_sound(_json.dumps({"op": "play", "id": "ps%d" % _n[0]}), to_js(data))
`;function e(l){return{"winsound.py":c,"playsound.py":u,"_forgecode.py":n,"webbrowser.py":f,"multiprocessing/__init__.py":o,"multiprocessing/pool.py":a,"multiprocessing/dummy/__init__.py":_,"multiprocessing/queues.py":d,"turtle.py":l}}var s=String.raw`"""ForgeCode の turtle (タートルグラフィックス)

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
def _ev_take():
    return _fc.take_events("turtle")


def _ev_ok():
    return _fc.events_ok()


def _ev_wait(ms):
    return _fc.wait_events(ms)


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
            for ev in _ev_take():
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
`;var p=String.raw`"""pygame (ForgeCode 互換版)
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
`,m=String.raw`"""pygame の土台 (初期化・エラー・画面とのやりとり)"""
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
`,g=String.raw`"""pygame の定数"""
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
`,y=String.raw`"""from pygame.locals import * で使う定数"""
from pygame.constants import *
from pygame.rect import Rect, FRect
from pygame.color import Color
`,h=String.raw`"""pygame.Rect (長方形)"""


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
`,w=String.raw`"""pygame.Color (色)"""
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
`,x=String.raw`"""pygame.Surface (絵を描く板)"""
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
`,v=String.raw`"""pygame.display (ゲームの画面)"""
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
`,k=String.raw`"""pygame.draw (図形を描く)"""
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
`,b=String.raw`"""pygame.gfxdraw (よく使うものだけ)"""
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
`,N=String.raw`"""pygame.event (キー・マウスなどの出来事)"""
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
`,E=String.raw`"""ブラウザのキー → pygame のキー"""
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
`,S=String.raw`"""pygame.key (キーボード)"""
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
`,T=String.raw`"""pygame.mouse (マウス・タップ)"""
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
`,O=String.raw`"""pygame.time (時間)"""
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
`,K=String.raw`"""pygame.font (文字)"""
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
`,R=String.raw`"""pygame.image (画像の読み込み・保存)"""
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
`,A=String.raw`"""pygame.transform (拡大・回転・反転)"""
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
`,F=String.raw`"""pygame.mixer (音): 画面側の Web Audio で鳴らします"""
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
`,L=String.raw`"""pygame.math (ベクトル)"""
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
`,I=String.raw`"""pygame.sprite (スプライトとグループ)"""
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
`,P=String.raw`"""pygame.mask (画素単位の当たり判定)"""
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
`,C=String.raw`"""pygame.surfarray (numpy の配列とのやりとり)"""
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
`,z={"pygame/joystick.py":String.raw`"""pygame.joystick (この環境ではつながりません)"""


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
`,"pygame/cursors.py":String.raw`"""pygame.cursors (形だけ)"""
arrow = diamond = broken_x = tri_left = tri_right = ball = None


class Cursor:
    def __init__(self, *a):
        self.data = a


def compile(strings, black="X", white=".", xor="o"):
    return ((), ())


def load_xbm(cursorfile, maskfile):
    return None
`,"pygame/scrap.py":String.raw`"""pygame.scrap (形だけ)"""


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
`,"pygame/freetype.py":String.raw`"""pygame.freetype (pygame.font で代わりに描きます)"""
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
`};function t(){return{"pygame/__init__.py":p,"pygame/_base.py":m,"pygame/constants.py":g,"pygame/locals.py":y,"pygame/rect.py":h,"pygame/color.py":w,"pygame/surface.py":x,"pygame/display.py":v,"pygame/draw.py":k,"pygame/gfxdraw.py":b,"pygame/event.py":N,"pygame/_keys.py":E,"pygame/key.py":S,"pygame/mouse.py":T,"pygame/time.py":O,"pygame/font.py":K,"pygame/image.py":R,"pygame/transform.py":A,"pygame/mixer.py":F,"pygame/math.py":L,"pygame/sprite.py":I,"pygame/mask.py":P,"pygame/surfarray.py":C,...z}}var D=String.raw`"""tkinter の定数"""
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
`,M=String.raw`"""tkinter (ForgeCode 互換版)
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
`,q=String.raw`"""tkinter.ttk (ForgeCode 互換版)"""
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
`,B={"tkinter/messagebox.py":String.raw`"""tkinter.messagebox (画面にダイアログを出します)"""
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
`,"tkinter/simpledialog.py":String.raw`"""tkinter.simpledialog (文字や数を入れてもらう)"""
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
`,"tkinter/filedialog.py":String.raw`"""tkinter.filedialog (プロジェクトのファイルから選ぶ)"""
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
`,"tkinter/colorchooser.py":String.raw`"""tkinter.colorchooser (色を選ぶ)"""
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
`,"tkinter/font.py":String.raw`"""tkinter.font"""
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
`,"tkinter/scrolledtext.py":String.raw`"""tkinter.scrolledtext"""
from tkinter import Text, Frame, Scrollbar

__all__ = ["ScrolledText"]


class ScrolledText(Text):
    def __init__(self, master=None, **kw):
        Text.__init__(self, master, **kw)
        self.frame = self
        self.vbar = None
`,"tkinter/commondialog.py":String.raw`"""tkinter.commondialog"""


class Dialog:
    command = None

    def __init__(self, master=None, **options):
        self.master = master
        self.options = options

    def show(self, **options):
        return None
`,"tkinter/dnd.py":String.raw`"""tkinter.dnd (この環境では使えません)"""


def dnd_start(source, event):
    return None
`,"tkinter/__main__.py":String.raw`import tkinter
tkinter._test()
`,"_tkinter.py":String.raw`"""_tkinter (ForgeCode の tkinter 互換版が使います)"""
TK_VERSION = "8.6"
TCL_VERSION = "8.6"
READABLE = 2
WRITABLE = 4
EXCEPTION = 8


class TclError(Exception):
    pass


def create(*a, **k):
    raise TclError("この環境では Tcl は使えません")
`};function r(){return{"tkinter/__init__.py":M,"tkinter/constants.py":D,"tkinter/ttk.py":q,...B}}var X=new Set(["pygame","tkinter","_tkinter","turtle","webbrowser","multiprocessing","winsound","playsound"]);function Z(){return{...e(s),...t(),...r()}}var ee={bs4:"beautifulsoup4",dotenv:"python-dotenv",jwt:"PyJWT",docx:"python-docx",pptx:"python-pptx",serial:"pyserial",slugify:"python-slugify",dateutil:"python-dateutil",yaml:"pyyaml",PIL:"pillow",sklearn:"scikit-learn",skimage:"scikit-image",cv2:"opencv-python",Crypto:"pycryptodome",Cryptodome:"pycryptodomex",OpenSSL:"pyopenssl",attr:"attrs",magic:"python-magic",jose:"python-jose",multipart:"python-multipart",fitz:"pymupdf",websocket:"websocket-client",pkg_resources:"setuptools",sentence_transformers:"sentence-transformers",Levenshtein:"levenshtein",github:"PyGithub",googletrans:"googletrans",wikipedia:"wikipedia",emoji:"emoji",termcolor:"termcolor",colorama:"colorama",tabulate:"tabulate",faker:"Faker",markdown:"markdown",toml:"toml",ujson:"ujson",simplejson:"simplejson",more_itertools:"more-itertools",typing_extensions:"typing-extensions"},se={PyQt5:"PyQt (ウィンドウを出す GUI) はブラウザでは使えません。画面は tkinter で作れます",PyQt6:"PyQt (ウィンドウを出す GUI) はブラウザでは使えません。画面は tkinter で作れます",PySide2:"PySide (ウィンドウを出す GUI) はブラウザでは使えません。画面は tkinter で作れます",PySide6:"PySide (ウィンドウを出す GUI) はブラウザでは使えません。画面は tkinter で作れます",wx:"wxPython (ウィンドウを出す GUI) はブラウザでは使えません",kivy:"kivy (アプリの画面) はブラウザでは使えません",pyautogui:"pyautogui (パソコンの操作) はブラウザでは使えません",pynput:"pynput (キーボード・マウスの操作) はブラウザでは使えません",keyboard:"keyboard (キーボードの操作) はブラウザでは使えません",mouse:"mouse (マウスの操作) はブラウザでは使えません",selenium:"selenium (ブラウザの自動操作) はこの環境では使えません",discord:"discord.py (常時接続の通信) はブラウザでは使えません",telegram:"Telegram のボット (常時接続の通信) はブラウザでは使えません",torch:"PyTorch はブラウザでは使えません",tensorflow:"TensorFlow はブラウザでは使えません"},j="314.0.8",te=`https://cdn.jsdelivr.net/pyodide/v${j}/full/`;export{i as a,X as b,Z as c,ee as d,se as e,te as f};
