# Web サーバー (Webhook を受け取る / ページを出す)
# 設定タブの「Web 公開」の URL で、このサーバーにアクセスできます (この bot では最初からオンです)。
# GitHub・Stripe などの Webhook を受け取る bot や、「keep alive」のページを出す bot の土台にどうぞ。
# 外部のライブラリを使わないので、すぐに起動できます。
import json
import os
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

received = []


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = "<h1>動いています</h1><p>受け取った Webhook: {} 件</p>".format(len(received))
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body.encode())

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        data = self.rfile.read(length).decode("utf-8", "replace")
        received.append(data)
        print(f"[{datetime.now():%H:%M:%S}] {self.path} に届きました: {data[:200]}")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True}).encode())

    def log_message(self, *args):
        pass


port = int(os.environ.get("PORT", "8080"))
print(f"Web サーバーを起動しました (ポート {port})")
ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
