var f="/home/pyodide/.forgecode",s=String.raw`"""ForgeCode の実行環境 (ブラウザの Python を、ふつうの Python に近づける道具)"""
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
`,t=String.raw`"""ForgeCode の webbrowser: 出力にリンクを表示します (タップで開けます)"""
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
`,r=String.raw`"""ForgeCode の multiprocessing
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
`,l=String.raw`"""ForgeCode の multiprocessing.pool (順番に実行します)"""
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
`,n=String.raw`"""ForgeCode の multiprocessing.dummy (順番に実行します)"""
from multiprocessing import (Queue, JoinableQueue, Lock, RLock, Event, Semaphore, BoundedSemaphore, Condition, Barrier,
                             Value, Array, Manager, cpu_count, current_process, active_children, Pipe)
from multiprocessing.pool import ThreadPool as Pool
from threading import Thread as Process
`,o=String.raw`from multiprocessing import Queue, JoinableQueue, SimpleQueue
`;function a(e){return{"_forgecode.py":s,"webbrowser.py":t,"multiprocessing/__init__.py":r,"multiprocessing/pool.py":l,"multiprocessing/dummy/__init__.py":n,"multiprocessing/queues.py":o,"turtle.py":e}}var d=String.raw`"""ForgeCode の turtle (タートルグラフィックス)

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
`;var p={bs4:"beautifulsoup4",dotenv:"python-dotenv",jwt:"PyJWT",docx:"python-docx",pptx:"python-pptx",serial:"pyserial",slugify:"python-slugify",dateutil:"python-dateutil",yaml:"pyyaml",PIL:"pillow",sklearn:"scikit-learn",skimage:"scikit-image",cv2:"opencv-python",Crypto:"pycryptodome",Cryptodome:"pycryptodomex",OpenSSL:"pyopenssl",attr:"attrs",magic:"python-magic",jose:"python-jose",multipart:"python-multipart",fitz:"pymupdf",websocket:"websocket-client",pkg_resources:"setuptools",sentence_transformers:"sentence-transformers",Levenshtein:"levenshtein",github:"PyGithub",googletrans:"googletrans",wikipedia:"wikipedia",emoji:"emoji",termcolor:"termcolor",colorama:"colorama",tabulate:"tabulate",faker:"Faker",markdown:"markdown",toml:"toml",ujson:"ujson",simplejson:"simplejson",more_itertools:"more-itertools",typing_extensions:"typing-extensions"},u={tkinter:"tkinter (ウィンドウを出す GUI) はブラウザでは使えません。絵や簡単なゲームは turtle、グラフは matplotlib で作れます",PyQt5:"PyQt (ウィンドウを出す GUI) はブラウザでは使えません",PyQt6:"PyQt (ウィンドウを出す GUI) はブラウザでは使えません",PySide2:"PySide (ウィンドウを出す GUI) はブラウザでは使えません",PySide6:"PySide (ウィンドウを出す GUI) はブラウザでは使えません",wx:"wxPython (ウィンドウを出す GUI) はブラウザでは使えません",kivy:"kivy (アプリの画面) はブラウザでは使えません",pyautogui:"pyautogui (パソコンの操作) はブラウザでは使えません",pynput:"pynput (キーボード・マウスの操作) はブラウザでは使えません",keyboard:"keyboard (キーボードの操作) はブラウザでは使えません",mouse:"mouse (マウスの操作) はブラウザでは使えません",pygame:"pygame の画面 (ウィンドウ) はこの環境ではまだ表示できません。ゲームは turtle (onkey・ontimer) で作れます",selenium:"selenium (ブラウザの自動操作) はこの環境では使えません",discord:"discord.py (常時接続の通信) はブラウザでは使えません",telegram:"Telegram のボット (常時接続の通信) はブラウザでは使えません",torch:"PyTorch はブラウザでは使えません",tensorflow:"TensorFlow はブラウザでは使えません"},i="314.0.8",m=`https://cdn.jsdelivr.net/pyodide/v${i}/full/`;export{f as a,a as b,d as c,p as d,u as e,m as f};
