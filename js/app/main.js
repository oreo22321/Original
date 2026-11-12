// ForgeCode 起動処理
import { getSettings, onSettings, emit, on, loadSession, getMode } from './store.js'
import { uiColors, THEMES } from '../editor/themes.js'
import { intel } from '../editor/luau-intel.js'
import { loadRobloxApi } from '../editor/apidb.js'
import { app, openProject, runCommand, refreshFiles } from './app.js'
import * as vfs from './vfs.js'
import { Workbench } from './workbench.js'
import { showOnboarding } from './onboarding.js'
import { createFromTemplate } from './explorer.js'
import { APP_VERSION } from './settings-ui.js'
import { showWhatsNew } from './views.js'
import './palette.js'
import './code-nav.js'
import './remote-ui.js'
import './extlibs.js'
import { toast } from './ui.js'

function applyTheme(s) {
  const vars = uiColors(s.theme)
  const root = document.documentElement
  for (const [k, v] of Object.entries(vars)) {
    if (k === 'color-scheme') root.style.colorScheme = v
    else root.style.setProperty(k, v)
  }
  root.style.setProperty('--editor-font', s.fontFamily)
  const th = THEMES[s.theme] || THEMES['dark-plus']
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = th.c.bg
  document.body.dataset.theme = th.dark ? 'dark' : 'light'
}

// 予期しないエラーでアプリ全体が止まらないようにする (内容は「問題を報告」用に残す)
const errorLog = []
function setupErrorHandling() {
  let last = 0
  const report = (msg, detail) => {
    errorLog.push(`${new Date().toISOString()} ${msg}${detail ? '\n' + detail : ''}`)
    if (errorLog.length > 30) errorLog.shift()
    // 同じ画面で何度も出さない
    if (Date.now() - last < 8000) return
    last = Date.now()
    try { if (app.editors) app.editors.flushDrafts() } catch {}
    toast('問題が発生しました。編集内容は保存されています', { kind: 'error', duration: 7000, action: { label: '詳細', run: () => runCommand('showErrors') } })
  }
  addEventListener('error', e => {
    // リソースの読み込み失敗などは除外
    if (!e.message || /ResizeObserver|Script error/.test(e.message)) return
    report(e.message, e.error && e.error.stack ? e.error.stack.split('\n').slice(0, 6).join('\n') : `${e.filename}:${e.lineno}`)
  })
  addEventListener('unhandledrejection', e => {
    const r = e.reason
    if (r && (r.name === 'AbortError' || /aborted|cancel/i.test(r.message || ''))) return
    report(String(r && r.message || r), r && r.stack ? r.stack.split('\n').slice(0, 6).join('\n') : '')
  })
  app.commands.set('showErrors', { id: 'showErrors', title: '発生したエラーの記録を表示', run: async () => {
    const { modal, h, copyText } = await import('./ui.js')
    const text = errorLog.join('\n\n') || '記録されたエラーはありません'
    modal({ title: 'エラーの記録', wide: true, body: h('pre', { class: 'err-log' }, text), actions: [{ label: 'コピー', run: () => { copyText(`ForgeCode ${APP_VERSION}\n${navigator.userAgent}\n\n${text}`); toast('コピーしました'); return false } }, { label: '再読み込み', primary: true, run: () => location.reload() }] })
  } })
}

async function boot() {
  const s = getSettings()
  applyTheme(s)
  setupErrorHandling()
  const root = document.getElementById('app')
  app.wb = new Workbench(root)
  intel.executor = getMode() === 'executor'
  on('mode', m => { intel.executor = m === 'executor' })

  loadRobloxApi().then(() => app.editors.relint()).catch(e => toast('Roblox API データを読み込めませんでした: ' + e.message, { kind: 'error' }))

  const projects = await vfs.listProjects()
  if (!s.onboarded && !projects.length) {
    document.getElementById('boot') && document.getElementById('boot').remove()
    await showOnboarding()
  } else {
    const sess = loadSession()
    const id = sess.project && projects.some(p => p.id === sess.project) ? sess.project : projects[0] && projects[0].id
    if (id) await openProject(id, { openMain: true })
    else await createFromTemplate('studio')
  }

  onSettings((ns, prev) => {
    if (ns.theme !== prev.theme || ns.fontFamily !== prev.fontFamily) applyTheme(ns)
    app.editors.reconfigureAll()
    if (ns.lint !== prev.lint || ns.lintTypos !== prev.lintTypos || ns.lintUndefined !== prev.lintUndefined || ns.lintUnused !== prev.lintUnused) app.editors.relint()
    if (ns.layout !== prev.layout) app.wb.applyLayout()
    emit('settings', ns)
    app.wb.updateStatus()
  })

  // 画面外でのショートカット
  addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) { if (e.key === 'F5') { e.preventDefault(); runCommand('run') } return }
    const k = e.key.toLowerCase()
    const inEditor = document.activeElement && document.activeElement.closest && document.activeElement.closest('.cm-editor')
    if (inEditor) return
    if (k === 'p' && e.shiftKey) { e.preventDefault(); runCommand('palette') }
    else if (k === 'p') { e.preventDefault(); runCommand('quickOpen') }
    else if (k === 's') { e.preventDefault(); runCommand('save') }
    else if (k === 'enter') { e.preventDefault(); runCommand('run') }
    else if (k === 'b') { e.preventDefault(); runCommand('toggleSidebar') }
    else if (k === 'j') { e.preventDefault(); runCommand('togglePanel') }
    else if (k === ',') { e.preventDefault(); runCommand('settings') }
    else if (k === 'f' && e.shiftKey) { e.preventDefault(); runCommand('findInFiles') }
  })

  // iOS のページ全体のピンチズームを止める (エディタのピンチは文字サイズ変更に使う)
  document.addEventListener('gesturestart', e => e.preventDefault())
  document.addEventListener('dblclick', e => { if (!e.target.closest('.cm-editor')) e.preventDefault() })

  // 画面が隠れる・閉じるとき: まず下書きを同期的に残し、そのうえで保存を始める
  // (iOS ではアプリを切り替えた直後に終了されることがあり、非同期の保存は間に合わない場合があるため)
  const stash = () => { app.editors.flushDrafts(); app.editors.saveAll().catch(() => {}) }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stash() })
  addEventListener('pagehide', stash)
  addEventListener('freeze', stash)
  addEventListener('beforeunload', e => {
    app.editors.flushDrafts()
    if (app.editors.anyDirty() && !getSettings().autoSave) { e.preventDefault(); e.returnValue = '' }
    else app.editors.saveAll().catch(() => {})
  })

  // 別のタブで同じプロジェクトを編集した場合に反映
  let remoteTimer = null
  vfs.onRemoteChange(async m => {
    if (!app.project || m.pid !== app.project.id) return
    if (m.op === 'write' && app.editors.has(m.path)) {
      const content = await vfs.readFile(app.project.id, m.path)
      if (content !== null) app.editors.externalChange(m.path, content)
    }
    clearTimeout(remoteTimer)
    remoteTimer = setTimeout(() => refreshFiles(), 400)
  })

  // オフライン対応 (Service Worker)
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing
        if (!w) return
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            toast('新しいバージョンがあります', { action: { label: '更新', run: () => { app.editors.flushDrafts(); location.reload() } }, duration: 12000 })
          }
        })
      })
      // 開きっぱなしでも 1 時間ごとに更新を確認
      setInterval(() => reg.update().catch(() => {}), 3600000)
    }).catch(() => {})
  }
  document.getElementById('boot') && document.getElementById('boot').remove()

  // バージョンアップ後に 1 度だけ変更点を表示
  try {
    const prev = localStorage.getItem('forgecode.version')
    localStorage.setItem('forgecode.version', APP_VERSION)
    if (prev !== APP_VERSION && s.onboarded && projects.length) setTimeout(showWhatsNew, 600)
  } catch {}
}

boot().catch(e => {
  console.error(e)
  const b = document.getElementById('boot')
  if (!b) return
  b.querySelector('.boot-sub').textContent = '起動に失敗しました: ' + (e && e.message || e)
  // データはそのままで、アプリだけ読み込み直す手段を出す
  const btn = document.createElement('button')
  btn.className = 'btn primary'
  btn.style.marginTop = '16px'
  btn.textContent = 'キャッシュを消して再読み込み'
  btn.onclick = async () => {
    try { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))) } catch {}
    try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())) } catch {}
    location.reload()
  }
  b.append(btn)
})
