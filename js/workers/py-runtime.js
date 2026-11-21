// Python 実行環境の「ふつうの Python との違い」を埋める道具 (python-worker の Python に置きます)
// ・time.sleep: ■ で止められる / 待つ前に出力を画面へ送る
// ・threading / concurrent.futures / multiprocessing: ブラウザではスレッドやプロセスを作れないので、順番に実行する
// ・asyncio.run / run_until_complete: ブラウザの特別な仕組み (JSPI) がなくても動くイベントループ
// ・urllib.request: ブラウザの通信 (XMLHttpRequest) で http / https を読む
// ・webbrowser.open: 出力にリンクを出す / getpass: 伏せ字の入力欄
// ・display(): 表 (pandas)・画像 (PIL・matplotlib) を出力に表示 / matplotlib の plt.show()・plt.pause()
// ここの Python はクラスの中の __ 名が変わらないよう、__ で始まる名前を使いません
import { FCSHELL, MSVCRT } from './py-shell.js'
import { MP, MP_POOL, MP_DUMMY, MP_QUEUES } from './py-mp.js'
import { WEBBROWSER, WINSOUND, PLAYSOUND } from './py-compat.js'
import { FCTEST } from './py-test.js'
import { FCPROF } from './py-prof.js'
import { FCWEB, UVICORN } from './py-web.js'
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


# ============================================================
# Web アプリ: app.run() などは、ポートを開く代わりにアプリの中のプレビューで受ける (_fcweb)
# ============================================================
def _hook_web(name):
    def fn(mod):
        import _fcweb
        _fcweb.patch(name, mod)
    return fn


for _n in ("flask", "werkzeug.serving", "wsgiref.simple_server", "http.server", "bottle", "anyio.to_thread"):
    on_import(_n, _hook_web(_n))
`

export function runtimeFiles(turtle) {
  return {
    'winsound.py': WINSOUND,
    '_fcshell.py': FCSHELL,
    '_fctest.py': FCTEST,
    '_fcprof.py': FCPROF,
    '_fcweb.py': FCWEB,
    'uvicorn.py': UVICORN,
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
