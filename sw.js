// Service Worker: オフラインでも使えるようにアプリのファイルをキャッシュします
// (tools/build-sw.mjs で VERSION と PRECACHE を更新します)
const VERSION = 'a6ea4ad7b8'
const CACHE = 'forgecode-' + VERSION
const RUNTIME = 'forgecode-runtime'
const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "boot.js",
  "css/app.css",
  "dist/app/main.js",
  "dist/chunks/app-ZI6UCTFQ.js",
  "dist/chunks/chunk-AIN4TSBF.js",
  "dist/chunks/chunk-GZBEBVPB.js",
  "dist/chunks/chunk-L52IZ56K.js",
  "dist/chunks/chunk-M4YAIX4P.js",
  "dist/chunks/chunk-OOBI3R4X.js",
  "dist/chunks/chunk-P24KNEGM.js",
  "dist/chunks/chunk-RHAKUTQ2.js",
  "dist/chunks/chunk-TRSZNM54.js",
  "dist/chunks/chunk-UCLDEFRU.js",
  "dist/chunks/chunk-VC46IEJQ.js",
  "dist/chunks/engine-GIN54T3M.js",
  "dist/chunks/fflate-TAGFKEII.js",
  "dist/chunks/generate-4METK36Z.js",
  "dist/chunks/knowledge-FVOLELZE.js",
  "dist/chunks/text-FPRMIC2R.js",
  "dist/chunks/ui-3TVMSVNX.js",
  "dist/workers/lint-worker.js",
  "dist/workers/luau-worker.js",
  "data/roblox-api.json",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/icon.svg",
  "live/connector.lua"
]

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('forgecode-') && k !== CACHE && k !== RUNTIME && !k.startsWith('forgecode-remote')).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  // 実機連携の中継サーバーが同じ場所にあるとき (Render などで本体ごと公開したとき): 通信はキャッシュしない
  const rel = url.pathname.slice(new URL(self.registration.scope).pathname.length)
  if (/^(r|c)\//.test(rel) || rel === 'health') return
  // アプリ本体は、このバージョン用にまとめて保存したものだけを返す
  // (ファイルごとに新旧が混ざると動かなくなるため、裏での個別更新はしない。新しい版は sw.js の更新で一括して切り替わる)
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true })
    if (hit) return hit
    try {
      const res = await fetch(req)
      // 存在しないページ (末尾に記号が付いたリンクなど) を開いたときは、アプリのトップへ
      if (req.mode === 'navigate' && res.status === 404) return Response.redirect(self.registration.scope, 302)
      if (res.ok && res.type === 'basic') c.put(req, res.clone())
      return res
    } catch {
      if (req.mode === 'navigate') { const idx = await c.match('index.html'); if (idx) return idx }
      return new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }
  }))
})
