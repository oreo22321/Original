"""BotRunner のテスト:  python -m unittest discover -s botrunner/tests

Discord にはつながず、print するだけの小さなプログラムを bot の代わりに動かして確かめます。
"""
import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import TestClient, TestServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402

H = {"X-BotRunner": "1"}


async def fake_check_token(token):
    return ("bad", None) if token == "bad" else ("ok", {"id": "123456", "username": "testbot"})


server.check_token = fake_check_token
server.RESTART_DELAYS = [0.2, 0.2]


class BotRunnerTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = server.Store(Path(self.tmp.name))
        self.sup = server.Supervisor(self.store)
        self.client = TestClient(TestServer(server.App(self.store, self.sup).build()))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.tmp.cleanup()

    async def login(self):
        code = self.store.setup_code()
        r = await self.client.post("/api/setup", json={"code": code, "password": "password123"}, headers=H)
        self.assertEqual(r.status, 200, await r.text())

    async def new_bot(self, code, token="tok"):
        r = await self.client.post("/api/bots", json={"name": "テスト", "template": "none"}, headers=H)
        bid = (await r.json())["bot"]["id"]
        r = await self.client.put(f"/api/bots/{bid}", json={"code": code, "token": token}, headers=H)
        self.assertEqual(r.status, 200, await r.text())
        return bid

    async def wait_status(self, bid, *statuses, timeout=8):
        for _ in range(int(timeout / 0.05)):
            if self.sup.bots[bid].status in statuses:
                return
            await asyncio.sleep(0.05)
        self.fail(f"status {self.sup.bots[bid].status} not in {statuses}; logs={list(self.sup.bots[bid].logs)}")

    async def wait_log(self, bid, text, timeout=8):
        for _ in range(int(timeout / 0.05)):
            if any(text in line["text"] for line in self.sup.bots[bid].logs):
                return
            await asyncio.sleep(0.05)
        self.fail(f"log {text!r} not found; logs={list(self.sup.bots[bid].logs)}")

    # ---- ログイン

    async def test_auth(self):
        r = await self.client.get("/api/state")
        self.assertTrue((await r.json())["setup"])
        r = await self.client.get("/api/bots")
        self.assertEqual(r.status, 401)
        r = await self.client.post("/api/setup", json={"code": "000000x", "password": "password123"}, headers=H)
        self.assertEqual(r.status, 400)
        r = await self.client.post("/api/setup", json={"code": self.store.setup_code(), "password": "short"}, headers=H)
        self.assertEqual(r.status, 400)
        await self.login()
        r = await self.client.get("/api/bots")
        self.assertEqual(r.status, 200)
        # 他のサイトからの操作 (専用ヘッダーなし) は断る
        r = await self.client.post("/api/bots", json={"name": "x"})
        self.assertEqual(r.status, 403)
        # 2 回目の設定はできない
        r = await self.client.post("/api/setup", json={"code": "1", "password": "password123"}, headers=H)
        self.assertEqual(r.status, 400)
        # ログアウトしてからのログイン
        await self.client.post("/api/logout", headers=H)
        self.assertEqual((await self.client.get("/api/bots")).status, 401)
        r = await self.client.post("/api/login", json={"password": "wrong-password"}, headers=H)
        self.assertEqual(r.status, 400)
        r = await self.client.post("/api/login", json={"password": "password123"}, headers=H)
        self.assertEqual(r.status, 200)
        self.assertEqual((await self.client.get("/api/bots")).status, 200)

    async def test_login_throttle(self):
        await self.login()
        for _ in range(5):
            await self.client.post("/api/login", json={"password": "nope-nope"}, headers=H)
        r = await self.client.post("/api/login", json={"password": "password123"}, headers=H)
        self.assertEqual(r.status, 429)

    # ---- bot の実行

    async def test_start_stop_and_logs(self):
        await self.login()
        bid = await self.new_bot("import os, time\nprint('hello', os.environ['DISCORD_TOKEN'])\nwhile True: time.sleep(1)\n")
        r = await self.client.post(f"/api/bots/{bid}/start", headers=H)
        self.assertEqual(r.status, 200)
        await self.wait_status(bid, "running")
        await self.wait_log(bid, "hello tok")
        r = await self.client.get(f"/api/bots/{bid}/logs")
        self.assertTrue(any("hello tok" in x["text"] for x in (await r.json())["lines"]))
        self.assertTrue(self.sup.bots[bid].meta["enabled"])
        r = await self.client.post(f"/api/bots/{bid}/stop", headers=H)
        self.assertEqual((await r.json())["bot"]["status"], "stopped")
        self.assertFalse(self.sup.bots[bid].meta["enabled"])

    async def test_crash_restarts(self):
        await self.login()
        bid = await self.new_bot("print('boot')\nraise RuntimeError('boom')\n")
        await self.client.post(f"/api/bots/{bid}/start", headers=H)
        await self.wait_status(bid, "waiting")
        for _ in range(100):
            if self.sup.bots[bid].restarts >= 1:
                break
            await asyncio.sleep(0.05)
        self.assertGreaterEqual(self.sup.bots[bid].restarts, 1)
        await self.client.post(f"/api/bots/{bid}/stop", headers=H)
        self.assertEqual(self.sup.bots[bid].status, "stopped")
        restarts = self.sup.bots[bid].restarts
        await asyncio.sleep(0.5)
        self.assertEqual(self.sup.bots[bid].restarts, restarts)  # 止めたら再起動しない

    async def test_bad_token_is_fatal(self):
        await self.login()
        code = "import sys\nprint('discord.errors.LoginFailure: Improper token has been passed.')\nsys.exit(1)\n"
        bid = await self.new_bot(code)
        await self.client.post(f"/api/bots/{bid}/start", headers=H)
        await self.wait_status(bid, "error")
        self.assertIn("トークン", self.sup.bots[bid].error)
        await asyncio.sleep(0.5)
        self.assertEqual(self.sup.bots[bid].status, "error")

    async def test_missing_module_is_fatal(self):
        await self.login()
        bid = await self.new_bot("import surely_not_installed_pkg\n")
        await self.client.post(f"/api/bots/{bid}/start", headers=H)
        await self.wait_status(bid, "error")
        self.assertIn("surely_not_installed_pkg", self.sup.bots[bid].error)

    async def test_clean_exit_does_not_restart(self):
        await self.login()
        bid = await self.new_bot("print('bye')\n")
        await self.client.post(f"/api/bots/{bid}/start", headers=H)
        await self.wait_log(bid, "終了コード 0")
        self.assertEqual(self.sup.bots[bid].status, "stopped")
        self.assertFalse(self.sup.bots[bid].meta["enabled"])

    async def test_token_and_syntax(self):
        await self.login()
        r = await self.client.post("/api/bots", json={"name": "b", "template": "1_slash"}, headers=H)
        bid = (await r.json())["bot"]["id"]
        r = await self.client.get(f"/api/bots/{bid}")
        d = await r.json()
        self.assertIn("tree.command", d["code"])
        self.assertIsNone(d["syntax"])
        self.assertNotIn("title:", d["code"])
        # 起動前にトークンがないとエラー
        await self.client.post(f"/api/bots/{bid}/start", headers=H)
        self.assertEqual(self.sup.bots[bid].status, "error")
        r = await self.client.put(f"/api/bots/{bid}", json={"token": "bad"}, headers=H)
        self.assertEqual(r.status, 400)
        r = await self.client.put(f"/api/bots/{bid}", json={"token": "Bot abc.def"}, headers=H)
        d = await r.json()
        self.assertEqual(d["bot"]["client_id"], "123456")
        self.assertEqual(d["bot"]["bot_user"], "testbot")
        self.assertEqual(self.sup.bots[bid].meta["token"], "abc.def")
        # トークンは画面に返さない
        self.assertNotIn("abc.def", await (await self.client.get(f"/api/bots/{bid}")).text())
        await self.client.post(f"/api/bots/{bid}/stop", headers=H)
        r = await self.client.put(f"/api/bots/{bid}", json={"code": "def f(:\n  pass\n", "restart": True}, headers=H)
        d = await r.json()
        self.assertEqual(d["syntax"]["line"], 1)
        self.assertEqual(self.sup.bots[bid].status, "stopped")  # 文法エラーなら起動しない

    async def test_autostart_and_delete(self):
        await self.login()
        bid = await self.new_bot("import time\nprint('up')\nwhile True: time.sleep(1)\n")
        await self.client.post(f"/api/bots/{bid}/start", headers=H)
        await self.wait_status(bid, "running")
        await self.sup.shutdown()  # サーバー停止: enabled は残る
        self.assertEqual(self.sup.bots[bid].status, "stopped")
        self.assertTrue(self.sup.bots[bid].meta["enabled"])
        sup2 = server.Supervisor(self.store)  # サーバー再起動
        await sup2.autostart()
        self.assertEqual(sup2.bots[bid].status, "running")
        await sup2.delete(sup2.bots[bid])
        self.assertFalse((self.store.bots_dir / bid).exists())

    async def test_websocket(self):
        await self.login()
        bid = await self.new_bot("import time\nprint('ws-line')\nwhile True: time.sleep(1)\n")
        async with self.client.ws_connect("/api/ws") as ws:
            hello = await ws.receive_json(timeout=5)
            self.assertEqual(hello["type"], "hello")
            await self.client.post(f"/api/bots/{bid}/start", headers=H)
            seen = False
            for _ in range(20):
                msg = await ws.receive_json(timeout=5)
                if msg["type"] == "log" and msg["line"]["text"] == "ws-line":
                    seen = True
                    break
            self.assertTrue(seen)
        await self.client.post(f"/api/bots/{bid}/stop", headers=H)

    def test_client_id_from_token(self):
        import base64
        part = base64.b64encode(b"987654321").decode().rstrip("=")
        self.assertEqual(server.client_id_from_token(part + ".x.y"), "987654321")
        self.assertIsNone(server.client_id_from_token("!!!"))


if __name__ == "__main__":
    unittest.main()
