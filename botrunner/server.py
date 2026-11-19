#!/usr/bin/env python3
"""BotRunner — Discord bot を自分のサーバーで 24 時間動かすための管理アプリ

使い方:
    python server.py                    # 起動 (http://<このマシン>:8765)
    python server.py --port 9000        # ポートを変える
    python server.py --set-password     # パスワードを設定し直す
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import collections
import getpass
import hashlib
import hmac
import json
import os
import platform
import re
import secrets
import shutil
import signal
import socket
import sys
import time
from pathlib import Path

from aiohttp import ClientSession, ClientTimeout, WSMsgType, web

VERSION = "1.0.0"
ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
TEMPLATES = ROOT / "templates"

LOG_LINES = 1500              # 画面に出すために覚えておくログの行数
LOG_FILE_MAX = 2 * 1024 * 1024  # bot.log がこの大きさを超えたら bot.log.1 に回す
SESSION_DAYS = 60
RESTART_DELAYS = [3, 10, 30, 60, 120, 300]  # 落ちたときに再起動するまでの秒数 (続けて落ちるほど長く)
STABLE_SECONDS = 120          # これだけ動いていたら「安定」とみなして待ち時間を戻す
COOKIE = "br_session"
DISCORD_API = "https://discord.com/api/v10"

# 再起動しても直らない失敗。ログにこれが出たら自動再起動をやめて、直し方を表示する
FATAL_PATTERNS = [
    (re.compile(r"LoginFailure|Improper token"),
     "トークンが正しくありません。Discord Developer Portal → Bot → Reset Token で新しいトークンを作り、設定に入れ直してください。"),
    (re.compile(r"PrivilegedIntentsRequired|privileged intents"),
     "コードが使っている特権 Intent が許可されていません。Developer Portal → Bot → Privileged Gateway Intents で、"
     "MESSAGE CONTENT INTENT (メッセージを読む) や SERVER MEMBERS INTENT (メンバー) をオンにしてください。"),
    (re.compile(r"ModuleNotFoundError: No module named '([\w.]+)'"),
     "パッケージ「{0}」が入っていません。設定 → パッケージ に追加して保存してください。"),
    (re.compile(r"^(SyntaxError|IndentationError|TabError): (.*)"),
     "コードに文法エラーがあります: {1}。ログの行番号の場所を直してください。"),
]

# 待てば直るかもしれない失敗。自動再起動は続けて、画面に理由を出す
HINT_PATTERNS = [
    (re.compile(r"Cannot connect to host|ClientConnectorError|Temporary failure in name resolution|Name or service not known"),
     "Discord に接続できません。サーバーのインターネット接続を確認してください (つながるまで自動で再試行します)。"),
    (re.compile(r"429 Too Many Requests|rate limited", re.I),
     "Discord の回数制限にかかっています。しばらく待つと自動で再試行します。"),
]


# ---------------------------------------------------------------- 保存まわり

def read_json(path: Path, default):
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return default


def write_private(path: Path, text: str):
    """途中で止まっても壊れないように、別名で書いてから置き換える。中身はこのユーザーだけが読める"""
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    os.replace(tmp, path)


def write_json(path: Path, data):
    write_private(path, json.dumps(data, ensure_ascii=False, indent=2))


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${h.hex()}"


def check_password(pw: str, stored: str) -> bool:
    try:
        _, salt, h = stored.split("$")
        got = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1, dklen=32)
        return hmac.compare_digest(got.hex(), h)
    except (ValueError, AttributeError):
        return False


def client_id_from_token(token: str) -> str | None:
    """トークンの最初の部分は bot のユーザー ID (= 招待リンクの client_id) を base64 にしたもの"""
    try:
        part = token.split(".")[0]
        cid = base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)).decode()
        return cid if cid.isdigit() else None
    except (ValueError, UnicodeDecodeError):
        return None


def process_memory(pid: int) -> int | None:
    """使っているメモリ (バイト)。Linux / Android のみ"""
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


class Store:
    def __init__(self, data: Path):
        self.data = data
        self.bots_dir = data / "bots"
        self.bots_dir.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(data, 0o700)
        except OSError:
            pass
        self.config_path = data / "config.json"
        self.config = read_json(self.config_path, {})
        self.config.setdefault("sessions", {})

    def save(self):
        write_json(self.config_path, self.config)

    # 初回の設定コード: パスワードが決まるまでは、サーバーの画面に出したこの番号を知っている人しか設定できない
    def setup_code(self) -> str | None:
        if self.config.get("password"):
            return None
        path = self.data / "setup-code.txt"
        code = path.read_text().strip() if path.exists() else ""
        if not code:
            code = "".join(secrets.choice("0123456789") for _ in range(6))
            write_private(path, code + "\n")
        return code

    def set_password(self, pw: str):
        self.config["password"] = hash_password(pw)
        self.config["sessions"] = {}  # パスワードを変えたら、ほかの端末のログインは切る
        self.save()
        (self.data / "setup-code.txt").unlink(missing_ok=True)


# ---------------------------------------------------------------- bot の実行

class Bot:
    def __init__(self, sup: "Supervisor", folder: Path, meta: dict):
        self.sup = sup
        self.dir = folder
        self.meta = meta
        self.proc: asyncio.subprocess.Process | None = None
        self.status = "stopped"   # stopped / installing / running / waiting / error
        self.started_at: float | None = None
        self.error: str | None = None
        self.next_restart: float | None = None
        self.restarts = 0
        self.logs: collections.deque = collections.deque(maxlen=LOG_LINES)
        self._fail = 0
        self._stopping = False
        self._fatal: str | None = None
        self._hint: str | None = None
        self._restart_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self._load_log_tail()

    @property
    def id(self) -> str:
        return self.meta["id"]

    @property
    def code_path(self) -> Path:
        return self.dir / "main.py"

    @property
    def log_path(self) -> Path:
        return self.dir / "bot.log"

    def save_meta(self):
        write_json(self.dir / "bot.json", self.meta)

    def summary(self) -> dict:
        token = self.meta.get("token") or ""
        return {
            "id": self.id,
            "name": self.meta.get("name", self.id),
            "status": self.status,
            "enabled": bool(self.meta.get("enabled")),
            "started_at": self.started_at,
            "next_restart": self.next_restart,
            "restarts": self.restarts,
            "error": self.error,
            "memory": process_memory(self.proc.pid) if self.proc else None,
            "token_set": bool(token),
            "client_id": self.meta.get("client_id") or (client_id_from_token(token) if token else None),
            "bot_user": self.meta.get("bot_user"),
        }

    def changed(self):
        self.sup.broadcast({"type": "bot", "bot": self.summary()})

    # ---- ログ

    def _load_log_tail(self):
        try:
            with open(self.log_path, "rb") as f:
                f.seek(max(0, f.seek(0, 2) - 200_000))
                lines = f.read().decode("utf-8", "replace").splitlines()[1:]
        except OSError:
            return
        for line in lines[-LOG_LINES:]:
            t, _, text = line.partition(" ")
            try:
                self.logs.append({"t": float(t), "s": "old", "text": text})
            except ValueError:
                pass

    def log(self, text: str, stream: str = "out"):
        entry = {"t": round(time.time(), 3), "s": stream, "text": text}
        self.logs.append(entry)
        try:
            if self.log_path.exists() and self.log_path.stat().st_size > LOG_FILE_MAX:
                os.replace(self.log_path, self.dir / "bot.log.1")
            with open(self.log_path, "a", encoding="utf-8") as f:
                f.write(f"{entry['t']} {text}\n")
        except OSError:
            pass
        self.sup.broadcast({"type": "log", "id": self.id, "line": entry})

    def sys_log(self, text: str):
        self.log(f"[BotRunner] {text}", "sys")

    def clear_logs(self):
        self.logs.clear()
        for p in (self.log_path, self.dir / "bot.log.1"):
            p.unlink(missing_ok=True)

    # ---- 起動・停止

    async def start(self, *, reset_backoff: bool = True):
        async with self._lock:
            if self.proc:
                return
            self._cancel_restart()
            if reset_backoff:
                self._fail = 0
            self.meta["enabled"] = True
            self.save_meta()
            self.error = None
            self._fatal = self._hint = None
            token = self.meta.get("token")
            if not token:
                self._set_error("トークンが設定されていません。設定 → トークン に bot のトークンを入れてください。")
                return
            if not await self._install_requirements():
                return
            env = dict(os.environ)
            env.update(DISCORD_TOKEN=token, PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8",
                       BOT_NAME=self.meta.get("name", ""), BOT_DATA_DIR=str(self.dir))
            self.sys_log("起動します")
            try:
                self.proc = await asyncio.create_subprocess_exec(
                    sys.executable, "-u", "main.py",
                    cwd=self.dir, env=env,
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                    limit=1024 * 1024,
                    **({"start_new_session": True} if os.name == "posix" else {}),
                )
            except OSError as e:
                self._set_error(f"起動できませんでした: {e}")
                return
            (self.dir / "bot.pid").write_text(str(self.proc.pid))
            self.status = "running"
            self.started_at = time.time()
            self.next_restart = None
            self._stopping = False
            self.changed()
            asyncio.create_task(self._watch(self.proc))

    async def stop(self, *, keep_enabled: bool = False):
        """keep_enabled=True はサーバーを止めるとき (次にサーバーが起動したらまた動かす)"""
        async with self._lock:
            self._cancel_restart()
            if not keep_enabled:
                self.meta["enabled"] = False
                self.save_meta()
            proc = self.proc
            if not proc:
                if self.status in ("waiting", "error") and not keep_enabled:
                    self.status, self.error = "stopped", None
                    self.changed()
                return
            self._stopping = True
            self.sys_log("停止します")
            self._signal(proc, signal.SIGTERM)
            try:
                await asyncio.wait_for(proc.wait(), 10)
            except asyncio.TimeoutError:
                self.sys_log("止まらないので強制終了します")
                self._signal(proc, signal.SIGKILL if os.name == "posix" else signal.SIGTERM)
                await proc.wait()
            # _watch が後片付けをするまで少し待つ
            for _ in range(50):
                if self.proc is None:
                    break
                await asyncio.sleep(0.02)

    async def restart(self):
        await self.stop()
        await self.start()

    @staticmethod
    def _signal(proc, sig):
        try:
            if os.name == "posix":
                os.killpg(proc.pid, sig)  # bot が作った子プロセスもまとめて止める
            elif sig == signal.SIGTERM:
                proc.terminate()
            else:
                proc.kill()
        except (ProcessLookupError, PermissionError, OSError):
            pass

    def _set_error(self, msg: str):
        self.status = "error"
        self.error = msg
        self.sys_log(msg)
        self.changed()

    def _cancel_restart(self):
        if self._restart_task and not self._restart_task.done() and self._restart_task is not asyncio.current_task():
            self._restart_task.cancel()
        self._restart_task = None
        self.next_restart = None

    async def _watch(self, proc):
        assert proc.stdout
        while True:
            try:
                raw = await proc.stdout.readline()
            except (ValueError, asyncio.LimitOverrunError):
                continue
            if not raw:
                break
            text = raw.decode("utf-8", "replace").rstrip("\r\n")
            self.log(text)
            if not self._fatal:
                for pat, msg in FATAL_PATTERNS:
                    m = pat.search(text)
                    if m:
                        self._fatal = msg.format(*(m.groups() or ("",)), "")
                        break
                for pat, msg in HINT_PATTERNS:
                    if pat.search(text):
                        self._hint = msg
        code = await proc.wait()
        ran = time.time() - (self.started_at or time.time())
        self.proc = None
        self.started_at = None
        (self.dir / "bot.pid").unlink(missing_ok=True)

        if self._stopping:
            self.status = "stopped"
            self.sys_log("停止しました")
        elif self._fatal:
            self._set_error(self._fatal)
            return
        elif code == 0:
            self.status = "stopped"
            self.meta["enabled"] = False
            self.save_meta()
            self.sys_log("プログラムが自分で終了しました (終了コード 0)。自動で再起動はしません")
        else:
            if ran >= STABLE_SECONDS:
                self._fail = 0
            delay = RESTART_DELAYS[min(self._fail, len(RESTART_DELAYS) - 1)]
            self._fail += 1
            self.status = "waiting"
            self.error = self._hint
            self.next_restart = time.time() + delay
            self.sys_log(f"止まりました (終了コード {code})。{delay} 秒後に自動で再起動します")
            self._restart_task = asyncio.create_task(self._restart_later(delay))
        self.changed()

    async def _restart_later(self, delay: float):
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return
        self.restarts += 1
        self._restart_task = None
        await self.start(reset_backoff=False)

    async def _install_requirements(self) -> bool:
        req = (self.meta.get("requirements") or "").strip()
        digest = hashlib.sha256(req.encode()).hexdigest()
        if not req or self.meta.get("installed_requirements") == digest:
            return True
        self.status = "installing"
        self.changed()
        async with self.sup.pip_lock:
            path = self.dir / "requirements.txt"
            path.write_text(req + "\n", "utf-8")
            self.sys_log("パッケージを入れています: " + ", ".join(req.split()))
            proc = await asyncio.create_subprocess_exec(
                sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "-r", str(path),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
            assert proc.stdout
            async for raw in proc.stdout:
                self.log(raw.decode("utf-8", "replace").rstrip(), "sys")
            code = await proc.wait()
        if code != 0:
            self._set_error("パッケージを入れられませんでした。名前が正しいか、ログを確認してください。")
            return False
        self.meta["installed_requirements"] = digest
        self.save_meta()
        return True


class Supervisor:
    def __init__(self, store: Store):
        self.store = store
        self.bots: dict[str, Bot] = {}
        self.clients: set[asyncio.Queue] = set()
        self.pip_lock = asyncio.Lock()
        self.started = time.time()
        for folder in sorted(store.bots_dir.iterdir()):
            meta = read_json(folder / "bot.json", None)
            if isinstance(meta, dict) and meta.get("id") == folder.name:
                self.bots[folder.name] = Bot(self, folder, meta)

    def broadcast(self, msg: dict):
        for q in list(self.clients):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                self.clients.discard(q)  # 受け取りが追いつかない画面は切る (開き直せば戻る)

    def ordered(self) -> list[Bot]:
        return sorted(self.bots.values(), key=lambda b: b.meta.get("created", 0))

    def create(self, name: str, code: str) -> Bot:
        bid = secrets.token_hex(4)
        folder = self.store.bots_dir / bid
        folder.mkdir()
        (folder / "main.py").write_text(code, "utf-8")
        meta = {"id": bid, "name": name, "token": "", "enabled": False, "requirements": "", "created": time.time()}
        write_json(folder / "bot.json", meta)
        bot = Bot(self, folder, meta)
        self.bots[bid] = bot
        return bot

    async def delete(self, bot: Bot):
        await bot.stop()
        self.bots.pop(bot.id, None)
        shutil.rmtree(bot.dir, ignore_errors=True)

    def kill_leftovers(self):
        """サーバーが強制終了されると bot が残ることがある。二重に動かないように、前回の bot を止める"""
        if os.name != "posix":
            return
        for bot in self.bots.values():
            pidfile = bot.dir / "bot.pid"
            try:
                pid = int(pidfile.read_text())
                cwd = os.readlink(f"/proc/{pid}/cwd")
                cmd = Path(f"/proc/{pid}/cmdline").read_bytes()
            except (OSError, ValueError):
                pidfile.unlink(missing_ok=True)
                continue
            if Path(cwd) == bot.dir.resolve() and b"main.py" in cmd:
                try:
                    os.killpg(pid, signal.SIGKILL)
                    print(f"前回の {bot.meta.get('name')} が残っていたので止めました")
                except OSError:
                    pass
            pidfile.unlink(missing_ok=True)

    async def autostart(self):
        self.kill_leftovers()
        for bot in self.ordered():
            if bot.meta.get("enabled"):
                await bot.start()
                await asyncio.sleep(1)

    async def shutdown(self):
        await asyncio.gather(*(b.stop(keep_enabled=True) for b in self.bots.values()), return_exceptions=True)


# ---------------------------------------------------------------- Web (画面と API)

def json_error(status: int, msg: str):
    return web.json_response({"error": msg}, status=status)


def load_templates() -> list[dict]:
    out = []
    for path in sorted(TEMPLATES.glob("*.py")):
        text = path.read_text("utf-8")
        title = re.search(r"^# title: (.+)$", text, re.M)
        desc = re.search(r"^# desc: (.+)$", text, re.M)
        body = re.sub(r"^# (title|desc): .+\n", "", text, flags=re.M)
        out.append({"id": path.stem, "title": title.group(1) if title else path.stem,
                    "desc": desc.group(1) if desc else "", "code": body})
    return out


def syntax_error(code: str) -> dict | None:
    try:
        compile(code, "main.py", "exec")
    except SyntaxError as e:
        return {"line": e.lineno, "msg": e.msg}
    except ValueError as e:
        return {"line": None, "msg": str(e)}
    return None


async def check_token(token: str) -> tuple[str, dict | None]:
    """Discord に問い合わせてトークンを確かめる。("ok", 情報) / ("bad", None) / ("unknown", None)"""
    try:
        async with ClientSession(timeout=ClientTimeout(total=8)) as s:
            async with s.get(f"{DISCORD_API}/users/@me", headers={"Authorization": f"Bot {token}"}) as r:
                if r.status == 401:
                    return "bad", None
                if r.status == 200:
                    return "ok", await r.json()
    except Exception:
        pass
    return "unknown", None


class App:
    def __init__(self, store: Store, sup: Supervisor):
        self.store = store
        self.sup = sup
        self.fails: dict[str, tuple[int, float]] = {}

    # ---- ログイン

    def session_ok(self, request) -> bool:
        token = request.cookies.get(COOKIE)
        if not token:
            return False
        key = hashlib.sha256(token.encode()).hexdigest()
        exp = self.store.config["sessions"].get(key)
        return bool(exp and exp > time.time())

    def new_session(self, request, resp):
        token = secrets.token_urlsafe(32)
        key = hashlib.sha256(token.encode()).hexdigest()
        now = time.time()
        sessions = {k: v for k, v in self.store.config["sessions"].items() if v > now}
        sessions[key] = now + SESSION_DAYS * 86400
        self.store.config["sessions"] = sessions
        self.store.save()
        secure = request.secure or request.headers.get("X-Forwarded-Proto") == "https"
        resp.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="Strict",
                        secure=secure, path="/")

    def throttled(self, request) -> float:
        n, until = self.fails.get(request.remote or "", (0, 0))
        return max(0, until - time.time())

    def record_fail(self, request):
        ip = request.remote or ""
        n, _ = self.fails.get(ip, (0, 0))
        n += 1
        wait = 0 if n < 5 else min(3600, 30 * 2 ** (n - 5))
        self.fails[ip] = (n, time.time() + wait)

    @web.middleware
    async def middleware(self, request, handler):
        path = request.path
        if path.startswith("/api/"):
            if request.method not in ("GET", "HEAD") and request.headers.get("X-BotRunner") != "1":
                return json_error(403, "不正なリクエストです")
            public = path in ("/api/state", "/api/login", "/api/setup")
            if not public and not self.session_ok(request):
                return json_error(401, "ログインしてください")
        resp = await handler(request)
        if not isinstance(resp, web.WebSocketResponse):
            resp.headers.setdefault("Cache-Control", "no-store")
            resp.headers["X-Content-Type-Options"] = "nosniff"
            resp.headers["Referrer-Policy"] = "no-referrer"
            resp.headers["Content-Security-Policy"] = (
                "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
                "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        return resp

    async def state(self, request):
        return web.json_response({
            "setup": not self.store.config.get("password"),
            "logged_in": self.session_ok(request),
            "version": VERSION,
        })

    async def setup(self, request):
        if self.store.config.get("password"):
            return json_error(400, "パスワードは設定済みです")
        if (wait := self.throttled(request)):
            return json_error(429, f"{int(wait) + 1} 秒待ってからもう一度試してください")
        body = await request.json()
        code = self.store.setup_code()
        if not hmac.compare_digest(str(body.get("code", "")).strip(), code or ""):
            self.record_fail(request)
            return json_error(400, "設定コードが違います。サーバーを起動した画面 (または data/setup-code.txt) の 6 桁の数字です")
        pw = str(body.get("password", ""))
        if len(pw) < 8:
            return json_error(400, "パスワードは 8 文字以上にしてください")
        self.store.set_password(pw)
        resp = web.json_response({"ok": True})
        self.new_session(request, resp)
        return resp

    async def login(self, request):
        if (wait := self.throttled(request)):
            return json_error(429, f"失敗が続いたので、{int(wait) + 1} 秒待ってからもう一度試してください")
        body = await request.json()
        if not check_password(str(body.get("password", "")), self.store.config.get("password", "")):
            self.record_fail(request)
            return json_error(400, "パスワードが違います")
        self.fails.pop(request.remote or "", None)
        resp = web.json_response({"ok": True})
        self.new_session(request, resp)
        return resp

    async def logout(self, request):
        token = request.cookies.get(COOKIE, "")
        self.store.config["sessions"].pop(hashlib.sha256(token.encode()).hexdigest(), None)
        self.store.save()
        resp = web.json_response({"ok": True})
        resp.del_cookie(COOKIE, path="/")
        return resp

    async def change_password(self, request):
        body = await request.json()
        if not check_password(str(body.get("current", "")), self.store.config.get("password", "")):
            return json_error(400, "今のパスワードが違います")
        pw = str(body.get("password", ""))
        if len(pw) < 8:
            return json_error(400, "パスワードは 8 文字以上にしてください")
        self.store.set_password(pw)
        resp = web.json_response({"ok": True})
        self.new_session(request, resp)
        return resp

    # ---- bot

    def bot_or_404(self, request) -> Bot:
        bot = self.sup.bots.get(request.match_info["id"])
        if not bot:
            raise web.HTTPNotFound(text=json.dumps({"error": "bot が見つかりません"}), content_type="application/json")
        return bot

    async def list_bots(self, request):
        return web.json_response({"bots": [b.summary() for b in self.sup.ordered()]})

    async def templates(self, request):
        return web.json_response({"templates": load_templates()})

    async def create_bot(self, request):
        body = await request.json()
        name = str(body.get("name", "")).strip()[:40]
        if not name:
            return json_error(400, "名前を入れてください")
        tpl = next((t for t in load_templates() if t["id"] == body.get("template")), None)
        bot = self.sup.create(name, tpl["code"] if tpl else "")
        bot.changed()
        return web.json_response({"bot": bot.summary()})

    async def get_bot(self, request):
        bot = self.bot_or_404(request)
        code = bot.code_path.read_text("utf-8") if bot.code_path.exists() else ""
        return web.json_response({
            "bot": bot.summary(),
            "code": code,
            "requirements": bot.meta.get("requirements", ""),
            "syntax": syntax_error(code),
        })

    async def update_bot(self, request):
        bot = self.bot_or_404(request)
        body = await request.json()
        result: dict = {}
        restart = bool(body.get("restart"))
        if "name" in body:
            name = str(body["name"]).strip()[:40]
            if not name:
                return json_error(400, "名前を入れてください")
            bot.meta["name"] = name
        if "token" in body:
            token = re.sub(r"\s+", "", str(body["token"]))
            if token.lower().startswith("bot"):
                token = token[3:]
            if token:
                status, info = await check_token(token)
                if status == "bad":
                    return json_error(400, "このトークンは Discord に受け付けられませんでした。Developer Portal → Bot → Reset Token で作ったものをそのまま貼ってください")
                bot.meta["client_id"] = (info or {}).get("id") or client_id_from_token(token)
                bot.meta["bot_user"] = (info or {}).get("username")
                result["token_check"] = status
            else:
                bot.meta["client_id"] = bot.meta["bot_user"] = None
            bot.meta["token"] = token
            if bot.meta.get("enabled") or bot.status == "error":
                restart = True
        if "requirements" in body:
            req = "\n".join(line.strip() for line in str(body["requirements"]).splitlines() if line.strip())
            if req != bot.meta.get("requirements", ""):
                bot.meta["requirements"] = req
                if bot.meta.get("enabled") or bot.status == "error":
                    restart = True
        if "code" in body:
            code = str(body["code"])
            if len(code) > 1_000_000:
                return json_error(400, "コードが大きすぎます")
            bot.code_path.write_text(code, "utf-8")
            result["syntax"] = syntax_error(code)
        bot.save_meta()
        if restart and not result.get("syntax"):
            await bot.restart()
        else:
            bot.changed()
        result["bot"] = bot.summary()
        return web.json_response(result)

    async def delete_bot(self, request):
        await self.sup.delete(self.bot_or_404(request))
        self.sup.broadcast({"type": "deleted", "id": request.match_info["id"]})
        return web.json_response({"ok": True})

    async def action(self, request):
        bot = self.bot_or_404(request)
        act = request.match_info["action"]
        if act == "start":
            await bot.start()
        elif act == "stop":
            await bot.stop()
        elif act == "restart":
            await bot.restart()
        elif act == "clear-logs":
            bot.clear_logs()
        else:
            return json_error(404, "不明な操作です")
        return web.json_response({"bot": bot.summary()})

    async def logs(self, request):
        bot = self.bot_or_404(request)
        return web.json_response({"lines": list(bot.logs)})

    async def server_info(self, request):
        disk = shutil.disk_usage(self.store.data)
        return web.json_response({
            "version": VERSION,
            "python": platform.python_version(),
            "platform": f"{platform.system()} {platform.machine()}",
            "hostname": socket.gethostname(),
            "uptime": time.time() - self.sup.started,
            "disk_free": disk.free,
            "data_dir": str(self.store.data),
        })

    async def ws(self, request):
        ws = web.WebSocketResponse(heartbeat=25)
        await ws.prepare(request)
        q: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self.sup.clients.add(q)

        async def writer():
            while True:
                msg = await q.get()
                await ws.send_json(msg)

        task = asyncio.create_task(writer())
        try:
            await ws.send_json({"type": "hello", "bots": [b.summary() for b in self.sup.ordered()]})
            async for msg in ws:
                if msg.type in (WSMsgType.ERROR, WSMsgType.CLOSE):
                    break
        finally:
            task.cancel()
            self.sup.clients.discard(q)
        return ws

    async def index(self, request):
        return web.FileResponse(STATIC / "index.html")

    def build(self) -> web.Application:
        app = web.Application(middlewares=[self.middleware], client_max_size=2 * 1024 * 1024)
        r = app.router
        r.add_get("/api/state", self.state)
        r.add_post("/api/setup", self.setup)
        r.add_post("/api/login", self.login)
        r.add_post("/api/logout", self.logout)
        r.add_post("/api/password", self.change_password)
        r.add_get("/api/server", self.server_info)
        r.add_get("/api/templates", self.templates)
        r.add_get("/api/bots", self.list_bots)
        r.add_post("/api/bots", self.create_bot)
        r.add_get("/api/bots/{id}", self.get_bot)
        r.add_put("/api/bots/{id}", self.update_bot)
        r.add_delete("/api/bots/{id}", self.delete_bot)
        r.add_get("/api/bots/{id}/logs", self.logs)
        r.add_post("/api/bots/{id}/{action}", self.action)
        r.add_get("/api/ws", self.ws)
        r.add_get("/", self.index)
        r.add_static("/static/", STATIC)

        async def on_startup(_):
            asyncio.create_task(self.sup.autostart())

        async def on_shutdown(_):
            await self.sup.shutdown()

        app.on_startup.append(on_startup)
        app.on_shutdown.append(on_shutdown)
        return app


def local_addresses() -> list[str]:
    addrs = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            addrs.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addrs.add(info[4][0])
    except OSError:
        pass
    return sorted(a for a in addrs if not a.startswith("127."))


def main():
    ap = argparse.ArgumentParser(description="BotRunner — Discord bot を 24 時間動かす管理アプリ")
    ap.add_argument("--host", default=os.environ.get("BOTRUNNER_HOST", "0.0.0.0"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("BOTRUNNER_PORT", "8765")))
    ap.add_argument("--data", default=os.environ.get("BOTRUNNER_DATA", str(ROOT / "data")))
    ap.add_argument("--set-password", action="store_true", help="パスワードを設定し直して終了する")
    args = ap.parse_args()

    store = Store(Path(args.data).resolve())
    if args.set_password:
        pw = getpass.getpass("新しいパスワード (8 文字以上): ")
        if len(pw) < 8 or pw != getpass.getpass("もう一度: "):
            sys.exit("パスワードが短いか、一致しません")
        store.set_password(pw)
        print("パスワードを設定しました")
        return

    sup = Supervisor(store)
    app = App(store, sup).build()
    print(f"BotRunner {VERSION} を起動しました")
    print(f"  このマシン:  http://localhost:{args.port}")
    for a in local_addresses():
        print(f"  同じ Wi-Fi:  http://{a}:{args.port}")
    if code := store.setup_code():
        print()
        print(f"  初回の設定コード: {code}")
        print("  (画面を開いて、この 6 桁の数字を入れてください)")
    print(flush=True)
    web.run_app(app, host=args.host, port=args.port, print=None, handle_signals=True)


if __name__ == "__main__":
    main()
