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


def sleep(secs):
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
    if argv is not None:
        sys.argv = list(argv)
        # プロジェクトのモジュールは読み直す (書き換えたものが使われるように) / turtle は新しい画面から
        for name, m in list(sys.modules.items()):
            f = getattr(m, "__file__", None) or ""
            if f.startswith(PROJECT + "/"):
                del sys.modules[name]
        t = sys.modules.get("turtle")
        if t is not None and hasattr(t, "_reset_all"):
            t._reset_all()
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
# 表示: display() / 画像 / 表
# ============================================================
_fig_gen = [0]


def _png(data, key=None):
    js.__fc_image(base64.b64encode(data).decode(), key)


def show_figures(live=False):
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")
        _png(buf.getvalue(), "fig%d-%d" % (_fig_gen[0], num))
    if not live:
        plt.close("all")
        _fig_gen[0] += 1


def _pil_png(img):
    buf = io.BytesIO()
    im = img
    if im.mode not in ("RGB", "RGBA", "L", "LA", "P", "1", "I;16"):
        im = im.convert("RGBA")
    im.save(buf, format="PNG")
    return buf.getvalue()


def _display_one(o):
    mod = type(o).__module__ or ""
    if mod.startswith("matplotlib") and hasattr(o, "savefig"):
        buf = io.BytesIO()
        o.savefig(buf, format="png", dpi=110, bbox_inches="tight")
        _png(buf.getvalue())
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

    def show(*args, **kwargs):
        show_figures()

    def pause(interval):
        show_figures(live=True)
        sleep(interval)

    show.__doc__ = plt.show.__doc__
    pause.__doc__ = plt.pause.__doc__
    plt.show = show
    plt.pause = pause


on_import("matplotlib.pyplot", _hook_pyplot)


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

export function runtimeFiles(turtle) {
  return {
    '_forgecode.py': FORGECODE,
    'webbrowser.py': WEBBROWSER,
    'multiprocessing/__init__.py': MP,
    'multiprocessing/pool.py': MP_POOL,
    'multiprocessing/dummy/__init__.py': MP_DUMMY,
    'multiprocessing/queues.py': MP_QUEUES,
    'turtle.py': turtle,
  }
}
