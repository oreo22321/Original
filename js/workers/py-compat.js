// webbrowser・winsound・playsound の互換版
// (python-worker の Python に置くファイル。py-runtime.js の runtimeFiles で集めます)

// webbrowser: ブラウザでは「開く」代わりに、出力にリンクを出す (Pyodide の webbrowser はワーカーで使えないため置き換え)
export const WEBBROWSER = String.raw`"""ForgeCode の webbrowser: 出力にリンクを表示します (タップで開けます)"""
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

// winsound / playsound: 画面側の Web Audio で鳴らす
export const WINSOUND = String.raw`"""winsound (ForgeCode 互換版: 画面で音を鳴らします)"""
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

export const PLAYSOUND = String.raw`"""playsound (ForgeCode 互換版: 画面で音を鳴らします)"""
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
