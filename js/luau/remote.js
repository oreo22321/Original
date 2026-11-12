// 外部スクリプトの取得 (loadstring(game:HttpGet(url))() など)
//  ・GitHub のページ URL などを、中身をそのまま取れる URL に直す
//  ・取得した中身はブラウザのキャッシュ (Cache API) に保存し、オフラインでも同じスクリプトを動かせる
//  ・ブラウザの CORS 制限で取れないときは、設定で許可した場合だけ中継サーバーを使う
//  ・どうしても取れない URL は、中身を貼り付けて登録できる (登録した中身が最優先)
// 実行用ワーカーと画面 (補完の解析) の両方から使います。
export const REMOTE_CACHE = 'forgecode-remote-v1'
const MAX_CACHE = 8 * 1024 * 1024
const memory = new Map() // Cache API が使えない環境用

export const PROXIES = {
  corsproxy: 'https://corsproxy.io/?url={url}',
  allorigins: 'https://api.allorigins.win/raw?url={url}',
}

// 中身を直接取れる URL に直す
export function normalizeUrl(url) {
  let u = String(url || '').trim()
  let m
  if ((m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/i.exec(u))) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3].replace(/\?.*$/, '')}`
  if ((m = /^https?:\/\/gist\.github\.com\/([^/]+)\/([0-9a-f]+)\/?$/i.exec(u))) return `https://gist.githubusercontent.com/${m[1]}/${m[2]}/raw`
  if ((m = /^https?:\/\/pastebin\.com\/(?!raw\/)([A-Za-z0-9]{4,})\/?$/i.exec(u))) return `https://pastebin.com/raw/${m[1]}`
  if ((m = /^https?:\/\/raw\.githubusercontent\.com\/(.+)$/i.exec(u))) return 'https://raw.githubusercontent.com/' + m[1]
  return u
}

// URL の短い表示名 (出力・補完の説明用)
export function shortUrl(url) {
  const u = normalizeUrl(url)
  let m
  if ((m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(?:refs\/heads\/)?[^/]+\/(.+)$/.exec(u))) return `${m[1]}/${m[2]}/${m[3]}`
  if ((m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/.*\/([^/]+)$/.exec(u))) return `${m[1]}/${m[2]} (${m[3]})`
  return u.replace(/^https?:\/\//, '').slice(0, 80)
}

async function openCache() {
  try { return typeof caches !== 'undefined' ? await caches.open(REMOTE_CACHE) : null } catch { return null }
}
async function readCache(url) {
  const c = await openCache()
  if (!c) return memory.get(url) || null
  try {
    const r = await c.match(url)
    if (!r) return null
    return { text: await r.text(), at: Number(r.headers.get('x-fetched-at')) || 0, manual: r.headers.get('x-forge-manual') === '1', via: r.headers.get('x-via') || 'direct' }
  } catch { return null }
}
const MAX_ENTRIES = 150
let writes = 0
// 古いものから消して、件数を抑える (登録した中身は残す)
async function prune(c) {
  try {
    const keys = await c.keys()
    if (keys.length <= MAX_ENTRIES) return
    const items = []
    for (const req of keys) { const r = await c.match(req); items.push({ req, at: r ? Number(r.headers.get('x-fetched-at')) || 0 : 0, manual: r && r.headers.get('x-forge-manual') === '1' }) }
    items.filter(i => !i.manual).sort((a, b) => a.at - b.at).slice(0, keys.length - MAX_ENTRIES).forEach(i => c.delete(i.req))
  } catch {}
}
async function writeCache(url, text, meta = {}) {
  if (text.length > MAX_CACHE) return
  const entry = { text, at: Date.now(), manual: !!meta.manual, via: meta.via || 'direct' }
  const c = await openCache()
  if (!c) { memory.set(url, entry); if (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value); return }
  try {
    await c.put(url, new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'x-fetched-at': String(entry.at), 'x-forge-manual': entry.manual ? '1' : '0', 'x-via': entry.via, 'x-size': String(text.length) } }))
    if (++writes % 20 === 0) prune(c)
  } catch { memory.set(url, entry) }
}

function withTimeout(ms) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const t = ctl ? setTimeout(() => ctl.abort(), ms) : 0
  return { signal: ctl ? ctl.signal : undefined, done: () => clearTimeout(t) }
}
async function tryFetch(url, opts, timeout) {
  const to = withTimeout(timeout)
  try {
    const res = await fetch(url, { ...opts, signal: to.signal, credentials: 'omit', redirect: 'follow' })
    const text = await res.text()
    return { res, text }
  } finally { to.done() }
}

// GitHub のリリース (releases/latest/download/xxx.lua) は API 経由で取得を試す
async function viaGithubRelease(url, timeout) {
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/(?:latest\/download|download\/([^/]+))\/(.+)$/i.exec(url)
  if (!m) return null
  const api = m[3] ? `https://api.github.com/repos/${m[1]}/${m[2]}/releases/tags/${m[3]}` : `https://api.github.com/repos/${m[1]}/${m[2]}/releases/latest`
  try {
    const { res, text } = await tryFetch(api, { headers: { Accept: 'application/vnd.github+json' } }, timeout)
    if (!res.ok) return null
    const asset = (JSON.parse(text).assets || []).find(a => a.name === decodeURIComponent(m[4]))
    if (!asset) return null
    const r2 = await tryFetch(asset.url, { headers: { Accept: 'application/octet-stream' } }, timeout)
    return r2.res.ok ? r2.text : null
  } catch { return null }
}

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false

// GET で取得。戻り値: { ok, status, statusText, text, from: 'net'|'proxy'|'cache'|'manual', error?: 'cors'|'offline'|'http'|'timeout', url }
export async function fetchText(rawUrl, { proxy = null, timeout = 20000, preferCache = false } = {}) {
  const url = normalizeUrl(rawUrl)
  const cached = await readCache(url)
  if (cached && cached.manual) return { ok: true, status: 200, statusText: 'OK', text: cached.text, from: 'manual', url }
  if (cached && preferCache) return { ok: true, status: 200, statusText: 'OK', text: cached.text, from: 'cache', url, at: cached.at }
  let failure = null
  if (online()) {
    try {
      const { res, text } = await tryFetch(url, {}, timeout)
      if (res.ok) {
        writeCache(url, text, { via: 'direct' })
        return { ok: true, status: res.status, statusText: res.statusText, text, from: 'net', url, headers: res.headers }
      }
      // 404 などは本物の結果として返す (キャッシュがあればそちらを使う)
      if (cached) return { ok: true, status: 200, statusText: 'OK', text: cached.text, from: 'cache', url, at: cached.at, stale: res.status }
      return { ok: false, status: res.status, statusText: res.statusText || 'HTTP Error', text, error: 'http', url }
    } catch (e) {
      failure = e && e.name === 'AbortError' ? 'timeout' : 'cors'
    }
    const rel = await viaGithubRelease(url, timeout)
    if (rel !== null) { writeCache(url, rel, { via: 'github-api' }); return { ok: true, status: 200, statusText: 'OK', text: rel, from: 'net', url } }
    if (proxy && failure === 'cors') {
      try {
        const purl = proxy.replace('{url}', encodeURIComponent(url))
        const { res, text } = await tryFetch(purl, {}, timeout)
        if (res.ok) { writeCache(url, text, { via: 'proxy' }); return { ok: true, status: 200, statusText: 'OK', text, from: 'proxy', url } }
      } catch { /* 下へ */ }
    }
  } else failure = 'offline'
  if (cached) return { ok: true, status: 200, statusText: 'OK', text: cached.text, from: 'cache', url, at: cached.at }
  return { ok: false, status: 0, statusText: failure === 'offline' ? 'オフラインです' : failure === 'timeout' ? '時間切れ' : 'CORS', text: '', error: failure, url }
}

// GET 以外 (POST など) や、ヘッダーを付けた要求。キャッシュはしない
// (認証情報や本文を第三者に渡さないよう、中継サーバーは使わない)
export async function fetchOther(rawUrl, opts, { timeout = 20000 } = {}) {
  const url = normalizeUrl(rawUrl)
  try {
    const { res, text } = await tryFetch(url, opts, timeout)
    return { ok: res.ok, status: res.status, statusText: res.statusText, text, headers: res.headers, url }
  } catch (e) {
    return { ok: false, status: 0, statusText: online() ? 'CORS' : 'オフラインです', text: '', error: online() ? 'cors' : 'offline', url }
  }
}

// ---- 一覧・登録・削除 (設定画面用) ----
export async function listRemote() {
  const c = await openCache()
  const out = []
  if (!c) { for (const [url, e] of memory) out.push({ url, size: e.text.length, at: e.at, manual: e.manual, via: e.via }); return out }
  try {
    for (const req of await c.keys()) {
      const r = await c.match(req)
      if (!r) continue
      const len = Number(r.headers.get('x-size')) || Number(r.headers.get('content-length')) || 0
      out.push({ url: req.url, size: len, at: Number(r.headers.get('x-fetched-at')) || 0, manual: r.headers.get('x-forge-manual') === '1', via: r.headers.get('x-via') || 'direct' })
    }
  } catch {}
  return out.sort((a, b) => b.at - a.at)
}
export async function registerRemote(url, text) { await writeCache(normalizeUrl(url), text, { manual: true, via: 'manual' }) }
export async function deleteRemote(url) {
  const u = normalizeUrl(url)
  memory.delete(u)
  const c = await openCache()
  if (c) try { await c.delete(u) } catch {}
}
export async function readRemote(url) { return readCache(normalizeUrl(url)) }
