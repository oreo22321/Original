// Python 実行環境の「ふつうの Python との違い」を埋める道具 (python-worker の Python に置きます)
// ・time.sleep: ■ で止められる / 待つ前に出力を画面へ送る
// ・threading / concurrent.futures / multiprocessing: ブラウザではスレッドやプロセスを作れないので、順番に実行する
// ・asyncio.run / run_until_complete: ブラウザの特別な仕組み (JSPI) がなくても動くイベントループ
// ・urllib.request: ブラウザの通信 (XMLHttpRequest) で http / https を読む
// ・webbrowser.open: 出力にリンクを出す / getpass: 伏せ字の入力欄
// ・display(): 表 (pandas)・画像 (PIL・matplotlib) を出力に表示 / matplotlib の plt.show()・plt.pause()
// ここの Python はクラスの中の __ 名が変わらないよう、__ で始まる名前を使いません
export const FC_LIB = '/home/pyodide/.forgecode'

const FORGECODE = String.raw`"""ForgeCode の実行環境 (ブラウザの Python を、ふつうの Python に近づける道具)"""
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


# ============================================================
# os.system / os.popen / subprocess: よく使うコマンドを、この中で再現する (_fcshell)
# (cls・clear で画面を消す、pause、echo、python ほかのファイル.py など。ほかのプログラムは起動できない)
# ============================================================
def _system(cmd):
    import _fcshell
    code, out, err = _fcshell.run(cmd, shell=True, capture=False)
    return code << 8 if code > 0 else code


def _popen(cmd, mode="r", buffering=-1):
    import _fcshell, io
    code, out, err = _fcshell.run(cmd, shell=True, capture=True)
    if "w" in mode:
        return io.StringIO()
    return io.StringIO(out)


import os as _os_mod
_os_mod.system = _system
_os_mod.popen = _popen


def _hook_subprocess(sp):
    import _fcshell
    _fcshell.install(sp)


on_import("subprocess", _hook_subprocess)
`

// subprocess / os.system の中身: よく使うコマンドを Python の中で再現する
const FCSHELL = String.raw`"""ForgeCode の subprocess / os.system (よく使うコマンドを、この中で再現します)

使えるもの: cls / clear (画面を消す)・pause・echo・python (ほかの .py)・ls / dir・cat / type・pwd / cd・
mkdir・rm / del・sleep / timeout・date・whoami・exit・color / title / chcp (何もしない)
ほかのプログラム (git など) は、ブラウザの中では起動できません
"""
import io, os, sys, shlex, time, runpy, contextlib

CLEAR = "\x1b[2J\x1b[H"


class _Exit(Exception):
    def __init__(self, code):
        self.code = code


def _split(cmd, shell):
    if isinstance(cmd, (list, tuple)):
        args = [os.fspath(a) if not isinstance(a, str) else a for a in cmd]
        if shell and len(args) == 1:
            return _split(args[0], True)
        return [args]
    cmd = os.fspath(cmd) if not isinstance(cmd, str) else cmd
    # && ; で区切った複数のコマンド (かんたんに)
    out = []
    for part in cmd.replace("&&", ";").split(";"):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(shlex.split(part, posix=os.name != "nt"))
        except ValueError:
            out.append(part.split())
    return out


def _python(args, out, err, stdin):
    # python ファイル.py 引数 / -c コード / -m モジュール を、この Python の中で実行
    argv0 = sys.argv
    saved_in = sys.stdin
    try:
        if stdin is not None:
            sys.stdin = io.StringIO(stdin)
        if not args:
            raise _Exit(0)
        if args[0] == "-c":
            sys.argv = ["-c"] + args[2:]
            g = {"__name__": "__main__"}
            exec(compile(args[1] if len(args) > 1 else "", "<string>", "exec"), g)
        elif args[0] == "-m":
            sys.argv = [args[1]] + args[2:]
            runpy.run_module(args[1], run_name="__main__", alter_sys=True)
        elif args[0] in ("-V", "--version"):
            print("Python " + sys.version.split()[0])
        else:
            sys.argv = list(args)
            runpy.run_path(args[0], run_name="__main__")
        return 0
    except SystemExit as e:
        c = e.code
        if c is None:
            return 0
        if isinstance(c, int):
            return c
        print(c, file=sys.stderr)
        return 1
    except _Exit as e:
        return e.code
    except Exception:
        import traceback
        traceback.print_exc()
        return 1
    finally:
        sys.argv = argv0
        sys.stdin = saved_in


def _one(args, shell, stdin):
    name = os.path.basename(args[0]).lower()
    if name.endswith(".exe"):
        name = name[:-4]
    rest = args[1:]
    if name in ("cls", "clear"):
        sys.stdout.write(CLEAR)
        return 0
    if name == "pause":
        try:
            input("続行するには Enter キーを押してください . . . ")
        except EOFError:
            pass
        return 0
    if name == "echo":
        if rest == ["."] or rest == []:
            print()
        else:
            print(" ".join(rest))
        return 0
    if name in ("python", "python3", "py") or args[0] == sys.executable:
        return _python(rest, None, None, stdin)
    if name in ("pip", "pip3"):
        print("pip はターミナルで使ってください (例: pip install 名前)。import するだけでも自動で入ります", file=sys.stderr)
        return 1
    if name in ("ls", "dir"):
        path = next((a for a in rest if not a.startswith("-") and not a.startswith("/")), ".")
        try:
            names = sorted(n for n in os.listdir(path) if not n.startswith(".") and n != "__pycache__")
        except OSError as e:
            print(e, file=sys.stderr)
            return 1
        print("\n".join(names))
        return 0
    if name in ("cat", "type"):
        code = 0
        for f in rest:
            try:
                with open(f, encoding="utf-8") as fh:
                    sys.stdout.write(fh.read())
            except OSError as e:
                print(e, file=sys.stderr)
                code = 1
        return code
    if name == "pwd" or (name == "cd" and not rest):
        print(os.getcwd())
        return 0
    if name == "cd":
        try:
            os.chdir(rest[0])
            return 0
        except OSError as e:
            print(e, file=sys.stderr)
            return 1
    if name in ("mkdir", "md"):
        for d in rest:
            if not d.startswith("-"):
                os.makedirs(d, exist_ok=True)
        return 0
    if name in ("rm", "del", "erase"):
        code = 0
        for f in rest:
            if f.startswith("-") or f.startswith("/"):
                continue
            try:
                if os.path.isdir(f):
                    import shutil
                    shutil.rmtree(f)
                else:
                    os.remove(f)
            except OSError as e:
                print(e, file=sys.stderr)
                code = 1
        return code
    if name in ("sleep", "timeout"):
        nums = [a for a in rest if a.replace(".", "", 1).isdigit()]
        time.sleep(float(nums[0]) if nums else 1)
        return 0
    if name == "date":
        import datetime
        print(datetime.datetime.now().strftime("%Y年 %m月 %d日 %H:%M:%S"))
        return 0
    if name == "whoami":
        print("forge")
        return 0
    if name == "exit":
        raise _Exit(int(rest[0]) if rest and rest[0].lstrip("-").isdigit() else 0)
    if name in ("color", "title", "chcp", "mode", "true", "rem", ":"):
        return 0
    if name == "false":
        return 1
    if shell:
        print("'%s' はこの環境では使えません (ブラウザの中では、ほかのプログラムを起動できません)" % args[0], file=sys.stderr)
        return 127
    raise FileNotFoundError(2, "No such file or directory: '%s' (ブラウザの中では、ほかのプログラムを起動できません)" % args[0], args[0])


def run(cmd, shell=False, capture=False, input=None, cwd=None, text=True):
    """戻り値: (終了コード, 出力, エラー出力)"""
    out, err = io.StringIO(), io.StringIO()
    old = os.getcwd()
    code = 0
    try:
        if cwd is not None:
            os.chdir(cwd)
        ctx_out = contextlib.redirect_stdout(out) if capture else contextlib.nullcontext()
        ctx_err = contextlib.redirect_stderr(err) if capture else contextlib.nullcontext()
        with ctx_out, ctx_err:
            for args in _split(cmd, shell):
                if not args:
                    continue
                try:
                    code = _one(args, shell, input)
                except _Exit as e:
                    code = e.code
                    break
    finally:
        if cwd is not None:
            os.chdir(old)
    return code, out.getvalue(), err.getvalue()


def install(sp):
    """subprocess の run / call / check_output などを置き換える"""
    def _data(v, text):
        if v is None:
            return None
        return v if text else v.encode()

    def _run(args, *, stdin=None, input=None, stdout=None, stderr=None, capture_output=False, shell=False, cwd=None,
             timeout=None, check=False, text=None, universal_newlines=None, encoding=None, errors=None, env=None, **kw):
        txt = bool(text or universal_newlines or encoding or errors)
        cap_out = capture_output or stdout in (sp.PIPE, sp.DEVNULL)
        cap_err = capture_output or stderr in (sp.PIPE, sp.DEVNULL, sp.STDOUT)
        if isinstance(input, bytes):
            input = input.decode("utf-8", "replace")
        code, out, err = run(args, shell=shell, capture=cap_out or cap_err, input=input, cwd=cwd)
        if stderr == sp.STDOUT and cap_out:
            out, err = out + err, ""
        # 受け取らないものは、そのまま画面へ
        if not cap_out:
            if out:
                sys.stdout.write(out)
            out = None
        elif stdout == sp.DEVNULL:
            out = None
        if not cap_err:
            if err:
                sys.stderr.write(err)
            err = None
        elif stderr in (sp.DEVNULL, sp.STDOUT):
            err = None
        cp = sp.CompletedProcess(args, code, _data(out, txt), _data(err, txt))
        if check and code:
            raise sp.CalledProcessError(code, args, cp.stdout, cp.stderr)
        return cp

    def _call(args, **kw):
        kw.pop("check", None)
        return _run(args, **kw).returncode

    def _check_call(args, **kw):
        kw["check"] = True
        _run(args, **kw)
        return 0

    def _check_output(args, **kw):
        kw.setdefault("stdout", sp.PIPE)
        kw["check"] = True
        return _run(args, **kw).stdout

    def _getstatusoutput(cmd, **kw):
        code, out, err = run(cmd, shell=True, capture=True)
        data = (out + err)
        if data.endswith("\n"):
            data = data[:-1]
        return code, data

    def _getoutput(cmd, **kw):
        return _getstatusoutput(cmd)[1]

    class Popen:
        """かんたんな Popen (作った時点で最後まで実行します)"""
        def __init__(self, args, stdin=None, stdout=None, stderr=None, shell=False, cwd=None, text=None, universal_newlines=None, encoding=None, **kw):
            self.args = args
            self._txt = bool(text or universal_newlines or encoding)
            self._kw = dict(stdout=stdout, stderr=stderr, shell=shell, cwd=cwd)
            self._done = None
            self.stdin = None
            self.pid = 2
            if stdin != sp.PIPE:
                self._finish(None)

        def _finish(self, input):
            if self._done is None:
                self._done = _run(self.args, input=input, text=self._txt, **self._kw)
                self.returncode = self._done.returncode
                self.stdout = io.StringIO(self._done.stdout) if isinstance(self._done.stdout, str) else io.BytesIO(self._done.stdout) if self._done.stdout is not None else None
                self.stderr = io.StringIO(self._done.stderr) if isinstance(self._done.stderr, str) else io.BytesIO(self._done.stderr) if self._done.stderr is not None else None
            return self._done

        def communicate(self, input=None, timeout=None):
            d = self._finish(input)
            return d.stdout, d.stderr

        def wait(self, timeout=None):
            self._finish(None)
            return self.returncode

        def poll(self):
            return self.returncode if self._done is not None else None

        def kill(self):
            pass

        terminate = kill

        def __enter__(self):
            return self

        def __exit__(self, *a):
            self.wait()

    sp.run = _run
    sp.call = _call
    sp.check_call = _check_call
    sp.check_output = _check_output
    sp.getoutput = _getoutput
    sp.getstatusoutput = _getstatusoutput
    sp.Popen = Popen
`

// msvcrt (Windows のキー入力): getch() は 1 行の入力の最初の文字を返す
const MSVCRT = String.raw`"""msvcrt (ForgeCode 互換版: キーを押す代わりに、入力欄に入れて Enter)"""
_buf = []


def _line():
    if not _buf:
        try:
            s = input()
        except EOFError:
            s = ""
        _buf.extend(list(s) or ["\r"])
    return _buf.pop(0)


def getwch():
    return _line()


def getwche():
    c = _line()
    print(c, end="")
    return c


def getch():
    return getwch().encode("utf-8")[:1] or b"\r"


def getche():
    return getwche().encode("utf-8")[:1] or b"\r"


def kbhit():
    return bool(_buf)


def putch(c):
    print(c.decode() if isinstance(c, bytes) else c, end="")


def putwch(c):
    print(c, end="")
`

// webbrowser: ブラウザでは「開く」代わりに、出力にリンクを出す (Pyodide の webbrowser はワーカーで使えないため置き換え)
const WEBBROWSER = String.raw`"""ForgeCode の webbrowser: 出力にリンクを表示します (タップで開けます)"""
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
`

// multiprocessing: プロセスは作れないので、同じ Python の中で順番に実行する (よく使う部分だけ)
const MP = String.raw`"""ForgeCode の multiprocessing
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
`

const MP_POOL = String.raw`"""ForgeCode の multiprocessing.pool (順番に実行します)"""
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
`

const MP_DUMMY = String.raw`"""ForgeCode の multiprocessing.dummy (順番に実行します)"""
from multiprocessing import (Queue, JoinableQueue, Lock, RLock, Event, Semaphore, BoundedSemaphore, Condition, Barrier,
                             Value, Array, Manager, cpu_count, current_process, active_children, Pipe)
from multiprocessing.pool import ThreadPool as Pool
from threading import Thread as Process
`

const MP_QUEUES = String.raw`from multiprocessing import Queue, JoinableQueue, SimpleQueue
`

// winsound / playsound: 画面側の Web Audio で鳴らす
const WINSOUND = String.raw`"""winsound (ForgeCode 互換版: 画面で音を鳴らします)"""
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
`

const PLAYSOUND = String.raw`"""playsound (ForgeCode 互換版: 画面で音を鳴らします)"""
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
`

export function runtimeFiles(turtle) {
  return {
    'winsound.py': WINSOUND,
    '_fcshell.py': FCSHELL,
    'msvcrt.py': MSVCRT,
    'playsound.py': PLAYSOUND,
    '_forgecode.py': FORGECODE,
    'webbrowser.py': WEBBROWSER,
    'multiprocessing/__init__.py': MP,
    'multiprocessing/pool.py': MP_POOL,
    'multiprocessing/dummy/__init__.py': MP_DUMMY,
    'multiprocessing/queues.py': MP_QUEUES,
    'turtle.py': turtle,
  }
}
