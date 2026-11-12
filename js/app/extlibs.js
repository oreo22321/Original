// 外部ライブラリの補完: エディタに loadstring(game:HttpGet(URL))() があると、
// 裏で URL の中身を取得・解析して、補完・ゴーストテキスト・ホバーに使えるようにします。
// (取得した中身と解析結果はこの端末に保存されるので、2 回目からはオフラインでもすぐ使えます)
import { intel, scanLoadstringUrls } from '../editor/luau-intel.js'
import { analyzeLibrary } from '../editor/extlib.js'
import { fetchText, normalizeUrl } from '../luau/remote.js'
import { app } from './app.js'
import { on, emit } from './store.js'
import { toast } from './ui.js'
import { proxyTemplate } from './remote-ui.js'

const API_CACHE = 'forgecode-remote-api-v1'
const MAX_SOURCE = 4 * 1024 * 1024
const apis = new Map()     // URL → 解析結果 | 'loading' | { failedAt }
const announced = new Set()

// 表示名: GitHub ならリポジトリ名 (+ 中心でないファイル名)
export function libName(url) {
  const u = normalizeUrl(url)
  let m = /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/([^/]+)\/(?:refs\/heads\/)?[^/]+\/(.+)$/.exec(u)
  if (m) {
    const file = m[2].split('/').pop().replace(/\.(lua|luau|txt)$/i, '')
    return /^(library|source|main|init|lib|ui|module|script|src|dist|loader)$/i.test(file) ? m[1] : `${m[1]}/${file}`
  }
  m = /^https?:\/\/github\.com\/[^/]+\/([^/]+)\//.exec(u)
  if (m) return m[1]
  m = /^https?:\/\/(?:www\.)?([^/]+)\/?([^?#]*)/.exec(u)
  if (m) { const tail = m[2].split('/').filter(Boolean).pop(); return tail ? tail.replace(/\.(lua|luau|txt)$/i, '') : m[1] }
  return 'ライブラリ'
}

const quickHash = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i += Math.max(1, Math.floor(s.length / 4000))) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return h.toString(16) + ':' + s.length }

async function cachedApi(url, key) {
  try {
    if (typeof caches === 'undefined') return null
    const c = await caches.open(API_CACHE)
    const r = await c.match(url)
    if (!r) return null
    const j = await r.json()
    return j && j.key === key ? j.api : null
  } catch { return null }
}
async function saveApi(url, key, api) {
  try {
    if (typeof caches === 'undefined') return
    const c = await caches.open(API_CACHE)
    await c.put(url, new Response(JSON.stringify({ key, api }), { headers: { 'content-type': 'application/json' } }))
  } catch {}
}

const idle = () => new Promise(r => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 1500 }) : setTimeout(r, 30)))

async function load(url) {
  apis.set(url, 'loading')
  try {
    const r = await fetchText(url, { preferCache: true, proxy: proxyTemplate() })
    if (!r.ok || !r.text || r.text.length > MAX_SOURCE) throw new Error('fetch')
    const key = quickHash(r.text)
    let api = await cachedApi(url, key)
    if (!api) {
      await idle()
      api = analyzeLibrary(r.text)
      saveApi(url, key, api)
    }
    api.lib = libName(url)
    apis.set(url, api)
    const count = api.shapes.reduce((n, s) => n + Object.values(s.m).filter(m => m.k === 'fn').length, 0)
    if (api.root !== null && api.root !== undefined && !announced.has(url)) {
      announced.add(url)
      toast(`📚 ${api.lib} の補完を読み込みました (関数 ${count} 個)`, { duration: 2600 })
    }
    emit('extlib', url)
  } catch {
    // 失敗したら 1 分は再試行しない
    apis.set(url, { failedAt: Date.now() })
  }
}

intel.extLib = rawUrl => {
  const url = normalizeUrl(rawUrl)
  const v = apis.get(url)
  if (v && v.shapes) return v
  if (v === 'loading') return null
  if (v && v.failedAt && Date.now() - v.failedAt < 60000) return null
  load(url)
  return null
}

// 開いているファイルの loadstring を見つけたら先に読み込んでおく
let timer = 0
function scan() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    const view = app.editors && app.editors.activeView && app.editors.activeView()
    if (!view) return
    const text = view.state.doc.length > 600000 ? view.state.doc.sliceString(0, 600000) : view.state.doc.toString()
    if (!/loadstring/.test(text)) return
    for (const url of scanLoadstringUrls(text)) intel.extLib(url)
  }, 1200)
}
on('docchange', scan)
on('active', scan)
on('remote', url => { apis.delete(normalizeUrl(url)); scan() })
