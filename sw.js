// Service Worker: オフラインでも使えるようにアプリのファイルをキャッシュします
// (tools/build-sw.mjs で VERSION と PRECACHE を更新します)
const VERSION = '4bc234f96d'
const CACHE = 'forgecode-' + VERSION
const RUNTIME = 'forgecode-runtime'
const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "boot.js",
  "css/app.css",
  "dist/app/main.js",
  "dist/chunks/ai-assist-XTNTCN76.js",
  "dist/chunks/app-VNX57VDM.js",
  "dist/chunks/assist-Z6AZCOYT.js",
  "dist/chunks/chunk-4AXLRMPC.js",
  "dist/chunks/chunk-4MYTFDFL.js",
  "dist/chunks/chunk-5YFU3I5N.js",
  "dist/chunks/chunk-6YYWDLBJ.js",
  "dist/chunks/chunk-7QRXHPAS.js",
  "dist/chunks/chunk-BIMSS3V4.js",
  "dist/chunks/chunk-CANPDHTU.js",
  "dist/chunks/chunk-DAL56S24.js",
  "dist/chunks/chunk-F5K4EXNR.js",
  "dist/chunks/chunk-FZCGVVQG.js",
  "dist/chunks/chunk-GFFV3COP.js",
  "dist/chunks/chunk-HLAUKS6A.js",
  "dist/chunks/chunk-IMPRJAZI.js",
  "dist/chunks/chunk-JSS2YWBD.js",
  "dist/chunks/chunk-MVLEP4PD.js",
  "dist/chunks/chunk-O6QJDXGJ.js",
  "dist/chunks/chunk-OCXOK7H2.js",
  "dist/chunks/chunk-OGXIANOP.js",
  "dist/chunks/chunk-Q6LWNVQE.js",
  "dist/chunks/chunk-QJPW3PIS.js",
  "dist/chunks/chunk-VLK6O2HE.js",
  "dist/chunks/chunk-ZVWI25S6.js",
  "dist/chunks/cloud-XZBE3ULX.js",
  "dist/chunks/cloud-core-DLVJ7J22.js",
  "dist/chunks/engine-KSS6D2WT.js",
  "dist/chunks/explain-OLE4ZNWD.js",
  "dist/chunks/fflate-ECKODDUP.js",
  "dist/chunks/file-preview-O7BXK7HV.js",
  "dist/chunks/generate-GFHSBG4N.js",
  "dist/chunks/github-sync-CZ7AWQFT.js",
  "dist/chunks/help-RM3RX4BL.js",
  "dist/chunks/i18n-en-TSIMURZU.js",
  "dist/chunks/knowledge-3US6XSXY.js",
  "dist/chunks/preview-EFR6P3KW.js",
  "dist/chunks/profile-view-MBZMO2TS.js",
  "dist/chunks/scm-A5TVDQJP.js",
  "dist/chunks/terminal-W25D44CE.js",
  "dist/chunks/tests-view-KP44NCPQ.js",
  "dist/chunks/text-GPDYCE7D.js",
  "dist/chunks/tk-view-3ANQPJ2K.js",
  "dist/chunks/ui-PT2FTTWV.js",
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
  // ひとつ前の版のファイルは残す (開いたままの古い画面が、あとから読み込む部品を見つけられるように)
  e.waitUntil(caches.keys().then(keys => {
    const old = keys.filter(k => /^forgecode-[0-9a-f]{6,}$/.test(k) && k !== CACHE)
    const keep = old[old.length - 1]
    return Promise.all(keys.filter(k => k.startsWith('forgecode-') && k !== CACHE && k !== keep && k !== RUNTIME && k !== PYODIDE_CACHE && k !== LIB_CACHE && !k.startsWith('forgecode-remote')).map(k => caches.delete(k)))
  }).then(() => self.clients.claim()))
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

// ---- Web アプリのプレビュー: __preview__/ の通信は、アプリの画面 (→ Python か プロジェクトのファイル) に答えてもらう ----
const PREVIEW = '__preview__'
const scopePath = () => new URL(self.registration.scope).pathname
const isPreviewUrl = u => new URL(u).pathname.startsWith(scopePath() + PREVIEW + '/') || new URL(u).pathname === scopePath() + PREVIEW
async function previewFetch(req, url, path) {
  const wins = await self.clients.matchAll({ type: 'window' })
  const appWin = wins.filter(c => !isPreviewUrl(c.url)).sort((a, b) => (b.focused - a.focused) || ((b.visibilityState === 'visible') - (a.visibilityState === 'visible')))[0]
  const text = (status, msg) => new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...ISOLATION } })
  if (!appWin) return text(503, 'ForgeCode のアプリを開いてから、もう一度読み込んでください')
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer()
  const ch = new MessageChannel()
  const res = await new Promise(resolve => {
    const t = setTimeout(() => resolve(null), 60000)
    ch.port1.onmessage = m => { clearTimeout(t); resolve(m.data) }
    appWin.postMessage({ type: 'fc-preview', req: { method: req.method, path: path || '/', query: url.search.slice(1), headers: [...req.headers], prefix: scopePath() + PREVIEW, dest: req.destination }, body }, [ch.port2, ...(body ? [body] : [])])
  })
  if (!res) return text(504, '答えが返ってきませんでした (時間がかかりすぎました)')
  const headers = new Headers()
  for (const [k, v] of res.headers || []) { try { headers.append(k, v) } catch {} }
  for (const [k, v] of Object.entries(ISOLATION)) headers.set(k, v)
  // / から始まる転送先は、プレビューの中に
  const loc = headers.get('Location')
  if (loc && loc.startsWith('/') && !loc.startsWith('//') && !loc.startsWith(scopePath() + PREVIEW)) headers.set('Location', scopePath() + PREVIEW + loc)
  const empty = req.method === 'HEAD' || res.status === 204 || res.status === 304
  return new Response(empty ? null : res.body, { status: res.status, statusText: res.statusText || '', headers })
}

self.addEventListener('fetch', e => {
  const req = e.request
  const url = new URL(req.url)
  if (url.origin === location.origin) {
    const base = scopePath() + PREVIEW
    if (url.pathname === base || url.pathname.startsWith(base + '/')) { e.respondWith(previewFetch(req, url, url.pathname.slice(base.length))); return }
    // プレビューの中のページが「/」から始まる場所を読んだ (fetch('/api')・<img src="/static/a.png"> など)
    if (!url.pathname.startsWith(scopePath()) && e.clientId) {
      e.respondWith(self.clients.get(e.clientId).then(c => (c && isPreviewUrl(c.url) ? previewFetch(req, url, url.pathname) : fetch(req))))
      return
    }
  }
  if (req.method !== 'GET') return
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
    const hit = await c.match(req, { ignoreSearch: true }) || (rel.startsWith('dist/') ? await caches.match(req, { ignoreSearch: true }) : null)
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
