// multiprocessing (順番に実行する互換版)
// (python-worker の Python に置くファイル。py-runtime.js の runtimeFiles で集めます)

// multiprocessing: プロセスは作れないので、同じ Python の中で順番に実行する (よく使う部分だけ)
export const MP = String.raw`"""ForgeCode の multiprocessing
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

export const MP_POOL = String.raw`"""ForgeCode の multiprocessing.pool (順番に実行します)"""
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

export const MP_DUMMY = String.raw`"""ForgeCode の multiprocessing.dummy (順番に実行します)"""
from multiprocessing import (Queue, JoinableQueue, Lock, RLock, Event, Semaphore, BoundedSemaphore, Condition, Barrier,
                             Value, Array, Manager, cpu_count, current_process, active_children, Pipe)
from multiprocessing.pool import ThreadPool as Pool
from threading import Thread as Process
`

export const MP_QUEUES = String.raw`from multiprocessing import Queue, JoinableQueue, SimpleQueue
`
