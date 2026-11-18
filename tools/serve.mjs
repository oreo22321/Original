// 手元で ForgeCode を動かすための小さなサーバー:  node tools/serve.mjs  (PORT=8080 で番号を変えられます)
// ・Python (Pyodide) の input() / ■ 停止 / デバッガーは SharedArrayBuffer を使うので、
//   COOP / COEP (cross-origin isolation) のヘッダーを付けて配信します
//   (GitHub Pages などヘッダーを付けられない場所では、sw.js が同じヘッダーを付けます)
// ・テスト (tests/e2e) からも使います: createServer() → { server }
import http from 'node:http'
import path from 'node:path'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm', '.zip': 'application/zip', '.whl': 'application/zip',
}
const PUBLIC = /^\/(?:index\.html|404\.html|sw\.js|boot\.js|manifest\.webmanifest|(?:css|js|dist|vendor|icons)\/[\w./@+-]+)$/
export const ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' }

export function createServer({ log = () => {} } = {}) {
  const cache = new Map()
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    let p = decodeURIComponent(url.pathname)
    if (p === '/') p = '/index.html'
    const file = path.join(ROOT, p)
    const type = TYPES[path.extname(file)]
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !PUBLIC.test(p) || p.includes('..') || !file.startsWith(ROOT + path.sep) || !type) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...ISOLATION })
      res.end('Not found')
      return
    }
    let body = cache.get(file)
    if (!body) {
      try { if (!statSync(file).isFile()) throw new Error('not a file'); body = readFileSync(file) } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...ISOLATION })
        res.end('Not found')
        return
      }
      if (cache.size < 600 && body.length < 4e6) cache.set(file, body)
    }
    log(`${req.method} ${p}`)
    const noCache = /\/(index\.html|sw\.js)$/.test(p)
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': noCache ? 'no-cache' : 'public, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...ISOLATION })
    res.end(req.method === 'HEAD' ? undefined : body)
  })
  return { server }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT) || 8080
  createServer().server.listen(port, () => console.log(`ForgeCode: http://localhost:${port}/  (ソースのまま: http://localhost:${port}/?src)`))
}
