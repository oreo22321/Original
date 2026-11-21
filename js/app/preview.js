// Web アプリのプレビュー: アプリの中のブラウザ (iframe) で、作った Web ページ・Web アプリを動かす
// ・Python の Web アプリ (Flask・FastAPI・http.server など) が動いていれば、通信は Python に (runner.webRequest)
// ・動いていなければ、プロジェクトのファイル (HTML・CSS・JavaScript・画像) をそのまま返す
// ・通信は Service Worker (sw.js の __preview__/) から、ここに届く
import { app } from './app.js'
import { h, icon, toast } from './ui.js'
import * as vfs from './vfs.js'

const TYPES = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', py: 'text/plain; charset=utf-8', xml: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', avif: 'image/avif',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', wasm: 'application/wasm', pdf: 'application/pdf',
}
const enc = new TextEncoder(), dec = new TextDecoder()
const base = () => new URL('__preview__', document.baseURI).pathname

// プレビューのページに入れる小さな道具: 「/」から始まるリンク・フォームをプレビューの中に / console をアプリに出す
function helperScript(prefix) {
  return `<script>(function(){var P=${JSON.stringify(prefix)};function fix(u){try{var x=new URL(u,location.href);if(x.origin===location.origin&&x.pathname.indexOf(P)!==0)return P+x.pathname+x.search+x.hash}catch(e){}return null}
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a||a.target==='_blank'||e.defaultPrevented)return;var f=fix(a.getAttribute('href'));if(f){e.preventDefault();location.href=f}},true);
document.addEventListener('submit',function(e){var f=e.target,a=f.getAttribute('action');if(a){var x=fix(a);if(x)f.setAttribute('action',x)}},true);
function send(level,args){try{parent.postMessage({fcPreview:'console',level:level,text:Array.prototype.map.call(args,function(v){try{return typeof v==='object'?JSON.stringify(v):String(v)}catch(e){return String(v)}}).join(' ')},'*')}catch(e){}}
['log','info','warn','error','debug'].forEach(function(k){var o=console[k];console[k]=function(){send(k,arguments);return o.apply(console,arguments)}});
window.addEventListener('error',function(e){send('error',[e.message+(e.filename?' ('+e.filename.split('/').pop()+':'+e.lineno+')':'')])});
window.addEventListener('unhandledrejection',function(e){send('error',['Promise: '+(e.reason&&e.reason.message||e.reason)])});
try{parent.postMessage({fcPreview:'nav',path:location.pathname.slice(P.length)||'/',search:location.search,title:document.title},'*')}catch(e){}
document.addEventListener('DOMContentLoaded',function(){try{parent.postMessage({fcPreview:'nav',path:location.pathname.slice(P.length)||'/',search:location.search,title:document.title},'*')}catch(e){}});})()</script>`
}
function inject(html, prefix) {
  const tag = helperScript(prefix)
  const m = /<head[^>]*>/i.exec(html)
  if (m) return html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length)
  const d = /<!doctype[^>]*>/i.exec(html)
  if (d) return html.slice(0, d.index + d[0].length) + tag + html.slice(d.index + d[0].length)
  return tag + html
}

async function readProjectFile(p) {
  const d = app.editors && app.editors.docs.get(p)
  if (d && d.state) return d.state.doc.toString()
  if (app.contents.has(p)) return app.contents.get(p)
  return vfs.readFile(app.project.id, p)
}

async function staticFile(req) {
  let p = decodeURIComponent(req.path || '/').replace(/^\/+/, '')
  const files = app.files
  const isDir = q => q === '' || files.some(f => f.dir && f.path === q)
  if (isDir(p.replace(/\/$/, ''))) {
    const dir = p.replace(/\/$/, '')
    const idx = files.find(f => !f.dir && (f.path === (dir ? dir + '/' : '') + 'index.html'))
    if (idx) p = idx.path
    else {
      // フォルダの中身の一覧
      const list = files.filter(f => (dir ? f.path.startsWith(dir + '/') : true) && !f.path.slice(dir ? dir.length + 1 : 0).includes('/'))
      const pre = base()
      const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${dir || 'プロジェクト'}</title><body style="font-family:system-ui;padding:16px;line-height:1.8"><h3>${dir || 'プロジェクト'} の中身</h3><p style="color:#888">index.html を作ると、ここに表示されます</p><ul>${list.map(f => `<li><a href="${pre}/${f.path}${f.dir ? '/' : ''}">${f.path.split('/').pop()}${f.dir ? '/' : ''}</a></li>`).join('')}</ul>`
      return { status: 200, headers: [['Content-Type', TYPES.html]], body: enc.encode(html) }
    }
  }
  const f = files.find(x => !x.dir && x.path === p)
  if (!f) return { status: 404, headers: [['Content-Type', TYPES.html]], body: enc.encode(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:16px"><h3>404 — ${p} がありません</h3>`) }
  const content = await readProjectFile(p)
  const ext = p.split('.').pop().toLowerCase()
  const body = content instanceof Uint8Array ? content : enc.encode(String(content ?? ''))
  return { status: 200, headers: [['Content-Type', TYPES[ext] || 'application/octet-stream'], ['Cache-Control', 'no-store']], body }
}

// Service Worker から届いた 1 回の通信に答える
export async function handlePreview(msg, port) {
  const { req, body } = msg
  const r = app.runner
  let res
  try {
    if (r && r.serving) {
      if (r.running) res = { status: 503, headers: [['Content-Type', 'text/html; charset=utf-8']], body: enc.encode('<meta charset="utf-8"><p style="font-family:system-ui;padding:16px">プログラムの実行中なので答えられません。終わると、Web アプリが答えます。</p>') }
      else res = await r.webRequest(req, body)
    } else res = await staticFile(req)
  } catch (e) {
    res = { status: 500, headers: [['Content-Type', 'text/plain; charset=utf-8']], body: enc.encode('プレビューでエラーが起きました: ' + (e && e.message || e)) }
  }
  const type = ((res.headers || []).find(([k]) => k.toLowerCase() === 'content-type') || [])[1] || ''
  if (/text\/html/i.test(type) && req.dest !== 'script' && req.dest !== 'style') res.body = enc.encode(inject(dec.decode(res.body), req.prefix || base()))
  if (!(res.body instanceof Uint8Array)) res.body = enc.encode(String(res.body ?? ''))
  port.postMessage(res, [res.body.buffer])
}

// ---- 画面 ----
let view = null
export function openPreview(path = null) {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
    toast('プレビューには、アプリをもう一度読み込む必要があります (オフライン用の仕組みが動いていません)', { kind: 'error', duration: 7000, action: { label: '再読み込み', run: () => { app.editors.flushDrafts(); location.reload() } } })
    return
  }
  if (path === null) {
    const doc = app.editors && app.editors.activeDoc()
    path = app.runner && app.runner.serving ? '/' : doc && /\.html?$/.test(doc.path) ? '/' + doc.path : '/'
  }
  if (view) { view.go(path); view.el.classList.remove('hidden'); return }
  view = new PreviewView()
  view.go(path)
}
export function closePreview() { if (view) view.close() }

class PreviewView {
  constructor() {
    this.addr = h('input', { class: 'pv-addr', 'aria-label': '場所', spellcheck: 'false', autocapitalize: 'off', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); this.go(this.addr.value || '/') } } })
    this.frame = h('iframe', { class: 'pv-frame', title: 'プレビュー', allow: 'fullscreen; clipboard-write' })
    this.logEl = h('div', { class: 'pv-log' })
    this.logBox = h('div', { class: 'pv-console hidden' }, h('div', { class: 'pv-console-head' }, h('span', null, 'コンソール'), h('button', { class: 'btn small ghost', onclick: () => { this.logEl.textContent = ''; this.count(0) } }, '消す')), this.logEl)
    this.badge = h('span', { class: 'pv-badge hidden' })
    this.title = h('span', { class: 'pv-title' })
    const b = (ic, label, fn) => h('button', { class: 'icon-btn sm', title: label, 'aria-label': label, onclick: fn }, icon(ic, 17))
    this.el = h('div', { class: 'pv' },
      h('div', { class: 'pv-bar' },
        h('button', { class: 'btn small ghost pv-close', onclick: () => this.close() }, icon('chevronLeft', 16), h('span', null, '戻る')),
        b('arrowLeft', '前のページ', () => { try { this.frame.contentWindow.history.back() } catch {} }),
        b('refresh', '読み込み直す', () => { try { this.frame.contentWindow.location.reload() } catch { this.go(this.path) } }),
        this.addr,
        h('button', { class: 'icon-btn sm pv-con-btn', title: 'コンソール', 'aria-label': 'コンソール', onclick: () => this.logBox.classList.toggle('hidden') }, icon('terminal', 17), this.badge),
        b('share', '新しいタブで開く', () => window.open(base() + this.path, '_blank', 'noopener'))),
      h('div', { class: 'pv-status' }, this.title),
      this.frame, this.logBox)
    this.n = 0
    this.onMsg = e => {
      if (e.source !== this.frame.contentWindow || !e.data || !e.data.fcPreview) return
      const d = e.data
      if (d.fcPreview === 'nav') { this.path = d.path + (d.search || ''); this.addr.value = this.path; this.title.textContent = d.title || ''; return }
      if (d.fcPreview === 'console') this.log(d.level, d.text)
    }
    addEventListener('message', this.onMsg)
    this.onKey = e => { if (e.key === 'Escape' && !this.el.classList.contains('hidden')) this.close() }
    addEventListener('keydown', this.onKey)
    document.body.append(this.el)
    this.status()
  }
  status() {
    const r = app.runner
    this.title.textContent = r && r.serving ? `● ${r.serving.title}` : 'プロジェクトのファイル'
  }
  go(path) {
    if (!path.startsWith('/')) path = '/' + path
    this.path = path
    this.addr.value = path
    this.status()
    this.frame.src = base() + path
  }
  log(level, text) {
    const row = h('div', { class: 'pv-line ' + level }, text)
    this.logEl.append(row)
    while (this.logEl.childElementCount > 300) this.logEl.firstChild.remove()
    this.logEl.scrollTop = this.logEl.scrollHeight
    this.count(this.n + 1, level === 'error')
  }
  count(n, err) {
    this.n = n
    this.badge.textContent = n > 99 ? '99+' : String(n)
    this.badge.classList.toggle('hidden', !n)
    if (err) this.badge.classList.add('err')
    if (!n) this.badge.classList.remove('err')
  }
  close() { this.el.classList.add('hidden'); this.frame.src = 'about:blank' }
}
