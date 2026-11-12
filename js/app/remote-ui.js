// 外部スクリプト (loadstring で読み込む URL) の管理画面と、取得に失敗したときの案内
import { h, icon, toast, modal, copyText, confirmDialog } from './ui.js'
import { listRemote, deleteRemote, registerRemote, readRemote, fetchText, shortUrl, normalizeUrl, PROXIES } from '../luau/remote.js'
import { getSettings, setSettings, emit } from './store.js'
import { UI_LIBRARIES } from '../data/snippets.js'
import { app, newFile, runCommand, command } from './app.js'
import * as vfs from './vfs.js'

export function proxyTemplate() {
  const p = getSettings().netProxy
  if (!p) return null
  if (PROXIES[p]) return PROXIES[p]
  return /^https:\/\/.+\{url\}/.test(p) ? p : null
}

const kb = n => (n < 1024 ? n + ' B' : n < 1024 * 1024 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB')
const when = t => {
  if (!t) return ''
  const d = (Date.now() - t) / 1000
  if (d < 60) return 'たった今'
  if (d < 3600) return Math.floor(d / 60) + ' 分前'
  if (d < 86400) return Math.floor(d / 3600) + ' 時間前'
  return Math.floor(d / 86400) + ' 日前'
}

// URL の中身を貼り付けて登録 (CORS で取れないサイト用)
export function pasteRemote(url) {
  return new Promise(resolve => {
    const urlIn = h('input', { class: 'input', value: url || '', placeholder: 'https://...', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
    const ta = h('textarea', { class: 'input code-area', placeholder: 'ブラウザで URL を開き、表示された中身をすべてコピーして、ここに貼り付けてください', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' })
    let done = false
    const m = modal({
      title: '中身を登録',
      body: h('div', { class: 'form' },
        h('label', { class: 'label' }, 'URL'), urlIn,
        h('label', { class: 'label' }, 'スクリプトの中身'), ta,
        h('div', { class: 'set-desc' }, '登録した中身は、この URL を game:HttpGet したときに使われます (この端末にだけ保存)'),
        url ? h('button', { class: 'btn small ghost', onclick: () => window.open(normalizeUrl(urlIn.value), '_blank', 'noopener') }, icon('link', 14), 'URL を開く') : null),
      actions: [
        { label: 'キャンセル', value: null },
        { label: '登録', primary: true, run: () => {
          const u = urlIn.value.trim(), text = ta.value
          if (!/^https?:\/\//.test(u)) { toast('URL を入力してください'); return false }
          if (!text.trim()) { toast('中身を貼り付けてください'); return false }
          done = true
          registerRemote(u, text).then(() => { toast('登録しました', { icon: 'check' }); emit('remote', u); resolve(u) })
        } },
      ],
      onClose: () => { if (!done) resolve(null) },
      sheet: false,
      wide: true,
    })
    setTimeout(() => (url ? ta : urlIn).focus(), 60)
    void m
  })
}

// 取得に失敗したときのボタン (エラー表示の中に入れる)
export function remoteActions(url, reason, { rerun }) {
  const proxy = proxyTemplate()
  const acts = []
  if (reason === 'cors' && !proxy) {
    acts.push(h('button', { class: 'btn small primary', onclick: async () => {
      const ok = await confirmDialog('中継サーバーを使う', `このサイトはブラウザの制限 (CORS) で直接読み込めません。中継サーバー (corsproxy.io) を経由して取得します。読み込む URL は中継サーバーの運営者に送られます。設定 → 実行 からいつでも止められます。`, { okLabel: '使って再実行' })
      if (!ok) return
      setSettings({ netProxy: 'corsproxy' })
      rerun()
    } }, icon('cloud', 14), '中継を使って再実行'))
  }
  acts.push(h('button', { class: 'btn small' + (reason === 'cors' && !proxy ? '' : ' primary'), onclick: async () => { if (await pasteRemote(url)) rerun() } }, icon('paste', 14), '中身を登録'))
  return acts
}
// エラーとして表示されなかった (pcall で包まれていた) ときの案内
export function remoteFailBlock(url, reason, opts) {
  // スクリプト側でエラーを処理した (動作は続いている) ので、控えめな 1 行にする。タップで対処のボタンを出す
  const box = h('div', { class: 'out-remote compact' },
    h('button', { class: 'or-head', title: '対処のしかたを表示', onclick: () => { box.classList.toggle('open') } }, icon('cloud', 14), h('span', null, reason === 'offline' ? 'オフラインのため読み込めませんでした' : '読み込めなかった URL があります (スクリプトは続行)'), h('code', { class: 'or-url', title: url }, shortUrl(url)), icon('chevronDown', 12, 'or-more')))
  box.append(h('div', { class: 'oe-actions' }, remoteActions(url, reason, opts)))
  return box
}

// 一覧
export async function openRemoteScripts() {
  const list = h('div', { class: 'remote-list' })
  const render = async () => {
    const items = await listRemote()
    list.textContent = ''
    if (!items.length) { list.append(h('div', { class: 'out-hint' }, 'まだありません。loadstring(game:HttpGet("URL"))() を実行すると、ここに保存されます')); return }
    for (const it of items) {
      const row = h('div', { class: 'remote-row' },
        h('div', { class: 'rr-main' },
          h('div', { class: 'rr-url', title: it.url }, shortUrl(it.url)),
          h('div', { class: 'rr-meta' }, [kb(it.size), when(it.at), it.manual ? '貼り付けで登録' : it.via === 'proxy' ? '中継で取得' : 'ダウンロード'].filter(Boolean).join(' ・ '))),
        h('button', { class: 'icon-btn sm', title: '取得し直す', 'aria-label': '取得し直す', onclick: async () => {
          if (it.manual) { if (await pasteRemote(it.url)) render(); return }
          const r = await fetchText(it.url, { proxy: proxyTemplate() })
          toast(r.ok && r.from !== 'cache' ? '最新の中身に更新しました' : '取得できませんでした (保存済みの中身はそのまま使えます)', { icon: r.ok ? 'check' : 'alert' })
          render()
        } }, icon('refresh', 16)),
        h('button', { class: 'icon-btn sm', title: '中身をコピー', 'aria-label': '中身をコピー', onclick: async () => { const c = await readRemote(it.url); if (c) copyText(c.text).then(() => toast('中身をコピーしました', { icon: 'copy' })) } }, icon('copy', 16)),
        h('button', { class: 'icon-btn sm danger', title: '削除', 'aria-label': '削除', onclick: async () => { await deleteRemote(it.url); emit('remote', it.url); render() } }, icon('trash', 16)))
      list.append(row)
    }
  }
  modal({
    title: '取得した外部スクリプト',
    body: h('div', null,
      h('div', { class: 'set-desc', style: { marginBottom: '8px' } }, 'game:HttpGet で読み込んだスクリプトの保存先です。オフラインでもこの中身で実行でき、補完 (候補・ゴーストテキスト) にも使われます。'),
      list),
    actions: [{ label: '中身を貼り付けて追加', run: () => { pasteRemote('').then(u => { if (u) render() }); return false } }, { label: '閉じる', primary: true, value: null }],
    wide: true,
  })
  render()
}

command('remoteScripts', '取得した外部スクリプトの一覧', () => openRemoteScripts(), { icon: 'cloud' })

// ============================================================
// UI ライブラリのギャラリー: 選ぶと、すぐ動くひな形のファイルを作って開きます
// ============================================================

const LIB_COLORS = { obsidian: '#7c5cff', linoria: '#3b82f6', orion: '#22c55e', kavo: '#f59e0b', windui: '#06b6d4', rayfield: '#ef4444' }
const plain = body => body.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\{\d+\}/g, '')

export function openUiGallery() {
  const grid = h('div', { class: 'lib-grid' })
  let m
  for (const lib of UI_LIBRARIES) {
    const card = h('button', { class: 'lib-card', onclick: async () => {
      m.close()
      if (!app.project) return
      let path = `${lib.id}-ui.lua`
      for (let i = 2; await vfs.exists(app.project.id, path); i++) path = `${lib.id}-ui-${i}.lua`
      if (await newFile(path, plain(lib.body))) {
        toast(`${lib.name} のひな形を作りました。▶ で実行するとゲーム画面に表示されます`, { icon: 'check', duration: 4200, action: { label: '実行', run: () => runCommand('run') } })
      }
    } },
    h('span', { class: 'lib-dot' }),
    h('span', { class: 'lib-name' }, lib.name),
    h('span', { class: 'lib-desc' }, lib.desc))
    card.style.setProperty('--lib', LIB_COLORS[lib.id] || '#4fc1ff')
    grid.append(card)
  }
  m = modal({
    title: 'UI ライブラリで GUI を作る',
    body: h('div', null, h('div', { class: 'set-desc', style: { marginBottom: '10px' } }, 'loadstring で読み込む人気の UI ライブラリです。選ぶとサンプル付きのファイルができ、そのまま実行・操作できます。ライブラリの関数は自動で補完に追加されます。'), grid),
    wide: true,
  })
}
command('uiGallery', 'UI ライブラリで GUI を作る (Obsidian など)', () => openUiGallery(), { icon: 'layers' })
