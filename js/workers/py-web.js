// Web アプリのプレビュー (_fcweb): Flask・Bottle・WSGI・http.server・FastAPI (ASGI) を、アプリの中のブラウザで動かす
// ・app.run() / serve_forever() / uvicorn.run() は、ポートを開く代わりに「プレビューで受ける」ように登録してすぐ戻る
// ・プレビューの通信は Service Worker → 画面 → ワーカー の順に届き、handle() が 1 回ずつ答える
// (python-worker の Python に置くファイル。py-runtime.js の runtimeFiles で集めます)

export const FCWEB = String.raw`"""ForgeCode の Web アプリのプレビュー"""
import sys, io, os, json, traceback, urllib.parse

PROJECT = "/home/pyodide/project"
REQ_FILE, BODY_FILE = "/tmp/fcweb_req", "/tmp/fcweb_body"
current = {"kind": None, "obj": None, "title": ""}


def _event(data):
    try:
        import js
        js.__fc_event("web", json.dumps(data, ensure_ascii=False, default=str))
    except Exception:
        pass


def serve(obj, kind, title=""):
    current.update(kind=kind, obj=obj, title=title)
    _event({"phase": "serve", "kind": kind, "title": title})
    sys.stdout.write("\x1b[32m * %s をプレビューで動かしています\x1b[0m (実行画面の「プレビューを開く」で見られます。ポートは使いません)\n" % title)


def stop():
    current.update(kind=None, obj=None, title="")


# ---- ポートを開く代わりに、プレビューに登録する ----
def patch(name, mod):
    if name == "flask":
        def run(self, host=None, port=None, debug=None, load_dotenv=True, **kw):
            serve(self, "wsgi", "Flask (%s)" % getattr(self, "name", "app"))
        mod.Flask.run = run
    elif name == "werkzeug.serving":
        def run_simple(hostname, port, application, *a, **k):
            serve(application, "wsgi", "WSGI")
        mod.run_simple = run_simple
    elif name == "wsgiref.simple_server":
        class PreviewServer:
            server_address = ("127.0.0.1", 8000)
            server_port = 8000

            def __init__(self, app):
                self.app = app

            def serve_forever(self, *a, **k):
                serve(self.app, "wsgi", "WSGI (wsgiref)")

            handle_request = serve_forever

            def set_app(self, app):
                self.app = app

            def get_app(self):
                return self.app

            def server_close(self):
                pass

            def shutdown(self):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                pass

        mod.make_server = lambda host, port, app, *a, **k: PreviewServer(app)
    elif name == "http.server":
        base = mod.HTTPServer

        class PreviewHTTPServer(base):
            def __init__(self, server_address, RequestHandlerClass, bind_and_activate=True):
                self.server_address = server_address
                self.server_name, self.server_port = "forgecode.local", (server_address[1] if len(server_address) > 1 else 8000)
                self.RequestHandlerClass = RequestHandlerClass

            def serve_forever(self, poll_interval=0.5):
                serve(self, "http", "http.server (%s)" % self.RequestHandlerClass.__name__)

            handle_request = serve_forever

            def server_close(self):
                pass

            def shutdown(self):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                pass

        mod.HTTPServer = PreviewHTTPServer
        mod.ThreadingHTTPServer = PreviewHTTPServer
    elif name == "bottle":
        orig_run = mod.run

        def run(app=None, *a, **k):
            serve(app or mod.default_app(), "wsgi", "Bottle")
        mod.run = run
        mod.Bottle.run = lambda self, **k: serve(self, "wsgi", "Bottle")
    elif name == "anyio.to_thread":
        # ブラウザではスレッドを使えないので、その場で実行する (FastAPI の def の関数のため)
        async def run_sync(func, *args, abandon_on_cancel=False, cancellable=None, limiter=None):
            return func(*args)
        mod.run_sync = run_sync


# ---- 1 回の通信に答える ----
def _headers_dict(pairs):
    return {k.lower(): v for k, v in pairs}


def _wsgi(app, req, body):
    path = req.get("path") or "/"
    hdr = _headers_dict(req.get("headers") or [])
    env = {
        "REQUEST_METHOD": req.get("method", "GET"),
        "SCRIPT_NAME": req.get("prefix", ""),
        "PATH_INFO": urllib.parse.unquote(path),
        "QUERY_STRING": req.get("query", ""),
        "SERVER_NAME": "forgecode.local", "SERVER_PORT": "443", "SERVER_PROTOCOL": "HTTP/1.1",
        "REMOTE_ADDR": "127.0.0.1", "REMOTE_HOST": "localhost",
        "CONTENT_TYPE": hdr.get("content-type", ""), "CONTENT_LENGTH": str(len(body)),
        "wsgi.version": (1, 0), "wsgi.url_scheme": "https", "wsgi.input": io.BytesIO(body), "wsgi.errors": sys.stderr,
        "wsgi.multithread": False, "wsgi.multiprocess": False, "wsgi.run_once": False,
    }
    for k, v in hdr.items():
        if k in ("content-type", "content-length"):
            continue
        env["HTTP_" + k.upper().replace("-", "_")] = v
    out = {"status": "500 Internal Server Error", "headers": []}
    chunks = []

    def start_response(status, headers, exc_info=None):
        out["status"], out["headers"] = status, list(headers)
        return chunks.append

    result = app(env, start_response)
    try:
        for c in result:
            if c:
                chunks.append(c)
    finally:
        if hasattr(result, "close"):
            result.close()
    return int(str(out["status"]).split()[0]), out["headers"], b"".join(c if isinstance(c, bytes) else str(c).encode() for c in chunks)


def _http(server, req, body):
    cls = server.RequestHandlerClass
    path = req.get("path") or "/"
    full = path + ("?" + req["query"] if req.get("query") else "")
    lines = ["%s %s HTTP/1.1" % (req.get("method", "GET"), full)]
    has_len = False
    for k, v in req.get("headers") or []:
        if k.lower() == "content-length":
            has_len = True
        lines.append("%s: %s" % (k, v))
    if body and not has_len:
        lines.append("Content-Length: %d" % len(body))
    raw = ("\r\n".join(lines) + "\r\n\r\n").encode("latin-1", "replace") + body
    h = cls.__new__(cls)
    h.rfile, h.wfile = io.BytesIO(raw), io.BytesIO()
    h.client_address, h.server, h.request, h.connection = ("127.0.0.1", 0), server, None, None
    if not hasattr(h, "directory"):
        h.directory = os.getcwd()
    h.close_connection = True
    h.handle_one_request()
    data = h.wfile.getvalue()
    head, _, rest = data.partition(b"\r\n\r\n")
    hl = head.decode("latin-1").split("\r\n")
    try:
        status = int(hl[0].split()[1])
    except Exception:
        status = 200
    headers = [tuple(x.split(": ", 1)) for x in hl[1:] if ": " in x]
    return status, headers, rest


def _asgi(app, req, body):
    import asyncio
    path = req.get("path") or "/"
    scope = {
        "type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"}, "http_version": "1.1",
        "method": req.get("method", "GET"), "scheme": "https", "path": urllib.parse.unquote(path), "raw_path": path.encode(),
        "query_string": (req.get("query") or "").encode(), "root_path": req.get("prefix", ""),
        "headers": [(k.lower().encode("latin-1"), v.encode("latin-1", "replace")) for k, v in (req.get("headers") or [])],
        "client": ("127.0.0.1", 0), "server": ("forgecode.local", 443), "state": {},
    }
    sent = {"status": 500, "headers": [], "body": bytearray()}
    got = [False]

    async def receive():
        if not got[0]:
            got[0] = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.disconnect"}

    async def send(msg):
        if msg["type"] == "http.response.start":
            sent["status"] = msg["status"]
            sent["headers"] = [(k.decode("latin-1") if isinstance(k, bytes) else k, v.decode("latin-1") if isinstance(v, bytes) else v) for k, v in msg.get("headers", [])]
        elif msg["type"] == "http.response.body":
            sent["body"] += msg.get("body", b"")

    asyncio.run(app(scope, receive, send))
    return sent["status"], sent["headers"], bytes(sent["body"])


def _error_page(e):
    tb = [f for f in traceback.extract_tb(e.__traceback__) if f.filename.startswith(PROJECT)]
    text = "Traceback (most recent call last):\n" + "".join(traceback.format_list(tb)).replace(PROJECT + "/", "") + "%s: %s" % (type(e).__name__, e)
    sys.stderr.write(text + "\n")
    import html
    page = "<!doctype html><meta charset=utf-8><title>500</title><body style='font-family:system-ui;padding:16px'><h2 style='color:#c33'>500 サーバーのエラー</h2><pre style='white-space:pre-wrap;background:#f4f4f4;padding:12px;border-radius:8px'>%s</pre>" % html.escape(text)
    return 500, [("Content-Type", "text/html; charset=utf-8")], page.encode()


def handle(req_json):
    req = json.loads(req_json)
    try:
        with open(REQ_FILE, "rb") as f:
            body = f.read()
    except OSError:
        body = b""
    kind, obj = current["kind"], current["obj"]
    try:
        if kind == "wsgi":
            status, headers, data = _wsgi(obj, req, body)
        elif kind == "http":
            status, headers, data = _http(obj, req, body)
        elif kind == "asgi":
            status, headers, data = _asgi(obj, req, body)
        else:
            status, headers, data = 503, [("Content-Type", "text/plain; charset=utf-8")], "Web アプリは動いていません".encode()
    except KeyboardInterrupt:
        status, headers, data = 503, [("Content-Type", "text/plain; charset=utf-8")], "止めました".encode()
    except BaseException as e:
        status, headers, data = _error_page(e)
    with open(BODY_FILE, "wb") as f:
        f.write(data)
    if kind:
        col = "32" if status < 300 else "33" if status < 400 else "31"
        sys.stdout.write("\x1b[90m%s %s%s \x1b[%sm%d\x1b[0m\n" % (req.get("method", "GET"), req.get("path", "/"), "?" + req["query"] if req.get("query") else "", col, status))
    return json.dumps({"status": status, "headers": [[str(k), str(v)] for k, v in headers]})
`

// uvicorn (互換版): uvicorn.run(app) で、ポートを開く代わりにプレビューで動かす
export const UVICORN = String.raw`"""uvicorn (ForgeCode 互換版: アプリの中のプレビューで動かします)"""
import importlib


def _load(app):
    if isinstance(app, str):
        mod, _, attr = app.partition(":")
        m = importlib.import_module(mod)
        app = getattr(m, attr or "app")
    return app


def run(app, host="127.0.0.1", port=8000, **kwargs):
    import _fcweb
    _fcweb.serve(_load(app), "asgi", "ASGI (uvicorn)")


class Config:
    def __init__(self, app, host="127.0.0.1", port=8000, **kwargs):
        self.app, self.host, self.port = app, host, port


class Server:
    def __init__(self, config):
        self.config = config

    def run(self, sockets=None):
        run(self.config.app)

    async def serve(self, sockets=None):
        run(self.config.app)
`
