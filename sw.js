// Service Worker: オフラインでも使えるようにアプリのファイルをキャッシュします
// (tools/build-sw.mjs で VERSION と PRECACHE を更新します)
const VERSION = 'af49e77fbd'
const CACHE = 'forgecode-' + VERSION
const RUNTIME = 'forgecode-runtime'
const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "boot.js",
  "css/app.css",
  "dist/app/main.js",
  "dist/chunks/app-WRHM3ZT4.js",
  "dist/chunks/chunk-2LETSP27.js",
  "dist/chunks/chunk-4MYTFDFL.js",
  "dist/chunks/chunk-6YYWDLBJ.js",
  "dist/chunks/chunk-BQ23ITVI.js",
  "dist/chunks/chunk-CANPDHTU.js",
  "dist/chunks/chunk-GS7GOFRA.js",
  "dist/chunks/chunk-IPI5JKKD.js",
  "dist/chunks/chunk-RUWENCJJ.js",
  "dist/chunks/chunk-WG23Z3JL.js",
  "dist/chunks/engine-6BTUALJR.js",
  "dist/chunks/fflate-ECKODDUP.js",
  "dist/chunks/generate-GFHSBG4N.js",
  "dist/chunks/knowledge-ERSTBRLI.js",
  "dist/chunks/text-GPDYCE7D.js",
  "dist/chunks/tk-view-CKJWK3Z6.js",
  "dist/chunks/ui-BY42G7NV.js",
  "dist/workers/python-worker.js",
  "dist/workers/pytools-worker.js",
  "vendor/pywheels/autopep8-2.3.2-py2.py3-none-any.whl",
  "vendor/pywheels/jedi-0.19.2-py2.py3-none-any.whl",
  "vendor/pywheels/micropip-0.11.1-py3-none-any.whl",
  "vendor/pywheels/parso-0.8.6-py2.py3-none-any.whl",
  "vendor/pywheels/pycodestyle-2.15.0-py2.py3-none-any.whl",
  "vendor/pywheels/pyflakes-4.1.0-py2.py3-none-any.whl",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/icon.svg"
]

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()))
})

// Python (Pyodide) は大きい (約 13 MB) ので、アプリの版とは別に、Pyodide の版ごとに保存しておく (アプリを更新しても読み直さない)
const PYODIDE_CACHE = 'forgecode-pyodide-314.0.8'
// import したライブラリ (Pyodide の numpy など・PyPI のもの) も、一度読んだら保存して次からすぐ・オフラインでも使う
const LIB_CACHE = 'forgecode-libs'
const LIB_URL = /^https:\/\/(cdn\.jsdelivr\.net\/pyodide\/v314\.0\.8\/full\/[^?#]+\.(whl|zip|json|tar)|files\.pythonhosted\.org\/packages\/[^?#]+\.whl)$/

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('forgecode-') && k !== CACHE && k !== RUNTIME && k !== PYODIDE_CACHE && k !== LIB_CACHE && !k.startsWith('forgecode-remote')).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})

// 共有メモリ (Python の input() と停止に使う) のための「クロスオリジン分離」: このアプリのファイルに必要なヘッダーを付ける
// (GitHub Pages ではサーバーのヘッダーを変えられないため、Service Worker で付けます)
const ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' }
function isolate(res) {
  if (!res || res.type === 'opaque' || res.type === 'opaqueredirect' || res.status === 0 || (res.status >= 300 && res.status < 400)) return res
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(ISOLATION)) headers.set(k, v)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (LIB_URL.test(req.url)) {
    // ファイル名に版が入っていて中身は変わらないので、保存したものを使う (Python のワーカーからの読み込み)
    e.respondWith(caches.open(LIB_CACHE).then(async c => {
      const hit = await c.match(req.url)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok && (res.type === 'cors' || res.type === 'basic')) c.put(req.url, res.clone()).catch(() => {})
      return res
    }))
    return
  }
  if (url.origin !== location.origin) return
  const rel = url.pathname.slice(new URL(self.registration.scope).pathname.length)
  // Python 本体: 一度読んだら、Pyodide の版が変わるまで使い続ける
  if (rel.startsWith('vendor/pyodide/')) {
    e.respondWith(caches.open(PYODIDE_CACHE).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true })
      if (hit) return isolate(hit)
      const res = await fetch(req)
      if (res.ok && res.type === 'basic') c.put(req, res.clone())
      return isolate(res)
    }))
    return
  }
  // アプリ本体は、このバージョン用にまとめて保存したものだけを返す
  // (ファイルごとに新旧が混ざると動かなくなるため、裏での個別更新はしない。新しい版は sw.js の更新で一括して切り替わる)
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true })
    if (hit) return isolate(hit)
    try {
      const res = await fetch(req)
      // 存在しないページ (末尾に記号が付いたリンクなど) を開いたときは、アプリのトップへ
      if (req.mode === 'navigate' && res.status === 404) return Response.redirect(self.registration.scope, 302)
      if (res.ok && res.type === 'basic') c.put(req, res.clone())
      return isolate(res)
    } catch {
      if (req.mode === 'navigate') { const idx = await c.match('index.html'); if (idx) return isolate(idx) }
      return new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }
  }))
})
