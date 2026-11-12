// Service Worker: オフラインでも使えるようにアプリのファイルをキャッシュします
// (tools/build-sw.mjs で VERSION と PRECACHE を更新します)
const VERSION = 'e08b2152ce'
const CACHE = 'forgecode-' + VERSION
const RUNTIME = 'forgecode-runtime'
const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/app.css",
  "js/app/ai-panel.js",
  "js/app/app.js",
  "js/app/code-nav.js",
  "js/app/debug-panel.js",
  "js/app/editors.js",
  "js/app/explain.js",
  "js/app/explorer.js",
  "js/app/gui-preview.js",
  "js/app/keybar.js",
  "js/app/main.js",
  "js/app/markdown.js",
  "js/app/onboarding.js",
  "js/app/palette.js",
  "js/app/runner.js",
  "js/app/settings-ui.js",
  "js/app/store.js",
  "js/app/templates.js",
  "js/app/ui.js",
  "js/app/vfs.js",
  "js/app/views.js",
  "js/app/workbench.js",
  "js/data/executor-api.js",
  "js/data/luau-api.js",
  "js/data/snippets.js",
  "js/editor/ai.js",
  "js/editor/apidb.js",
  "js/editor/autoend.js",
  "js/editor/blocks.js",
  "js/editor/breakpoints.js",
  "js/editor/errorlens.js",
  "js/editor/extras.js",
  "js/editor/format.js",
  "js/editor/inline.js",
  "js/editor/lint.js",
  "js/editor/luau-intel.js",
  "js/editor/luau-lang.js",
  "js/editor/setup.js",
  "js/editor/symbols.js",
  "js/editor/themes.js",
  "js/editor/typo.js",
  "js/luau/compiler.js",
  "js/luau/debug.js",
  "js/luau/executor.js",
  "js/luau/lexer.js",
  "js/luau/lstrings.js",
  "js/luau/parser.js",
  "js/luau/rbx-types.js",
  "js/luau/roblox.js",
  "js/luau/runtime.js",
  "js/luau/stdlib.js",
  "js/luau/vm.js",
  "js/workers/luau-worker.js",
  "vendor/LICENSES.txt",
  "vendor/anthropic.js",
  "vendor/codemirror.js",
  "vendor/fflate.js",
  "data/roblox-api.json",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/icon.svg"
]

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('forgecode-') && k !== CACHE && k !== RUNTIME).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  // アプリ本体は、このバージョン用にまとめて保存したものだけを返す
  // (ファイルごとに新旧が混ざると動かなくなるため、裏での個別更新はしない。新しい版は sw.js の更新で一括して切り替わる)
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true })
    if (hit) return hit
    try {
      const res = await fetch(req)
      if (res.ok && res.type === 'basic') c.put(req, res.clone())
      return res
    } catch {
      if (req.mode === 'navigate') { const idx = await c.match('index.html'); if (idx) return idx }
      return new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }
  }))
})
