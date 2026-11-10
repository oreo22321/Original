// ForgeCode 起動処理
import { getSettings, onSettings, emit, loadSession } from './store.js'
import { uiColors, THEMES } from '../editor/themes.js'
import { setExtraGlobals } from '../editor/luau-lang.js'
import { intel } from '../editor/luau-intel.js'
import { loadRobloxApi } from '../editor/apidb.js'
import { EXECUTOR_GLOBALS } from '../data/executor-api.js'
import { app, openProject, runCommand } from './app.js'
import * as vfs from './vfs.js'
import { Workbench } from './workbench.js'
import { showOnboarding } from './onboarding.js'
import { createFromTemplate } from './explorer.js'
import './palette.js'
import './views.js'
import { toast } from './ui.js'

function applyTheme(s) {
  const vars = uiColors(s.theme)
  const root = document.documentElement
  for (const [k, v] of Object.entries(vars)) {
    if (k === 'color-scheme') root.style.colorScheme = v
    else root.style.setProperty(k, v)
  }
  root.style.setProperty('--editor-font', s.fontFamily)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = (THEMES[s.theme] || THEMES['dark-plus']).c.bg
  document.body.dataset.theme = (THEMES[s.theme] || THEMES['dark-plus']).dark ? 'dark' : 'light'
}

function applyIntel(s) {
  intel.executor = s.executorApi
  intel.roblox = s.robloxApi
  setExtraGlobals(s.executorApi ? Object.keys(EXECUTOR_GLOBALS) : [])
}

async function boot() {
  const s = getSettings()
  applyTheme(s)
  applyIntel(s)
  const root = document.getElementById('app')
  app.wb = new Workbench(root)

  loadRobloxApi().catch(e => toast('Roblox API データを読み込めませんでした: ' + e.message, { kind: 'error' }))

  const projects = await vfs.listProjects()
  if (!s.onboarded && !projects.length) {
    await showOnboarding()
  } else {
    const sess = loadSession()
    const id = sess.project && projects.some(p => p.id === sess.project) ? sess.project : projects[0] && projects[0].id
    if (id) await openProject(id, { openMain: true })
    else await createFromTemplate('lua')
  }

  onSettings((ns, prev) => {
    if (ns.theme !== prev.theme || ns.fontFamily !== prev.fontFamily) applyTheme(ns)
    if (ns.executorApi !== prev.executorApi || ns.robloxApi !== prev.robloxApi) applyIntel(ns)
    app.editors.reconfigureAll()
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

  // バックグラウンドに回ったら保存 (iOS ではアプリが終了されることがあるため)
  document.addEventListener('visibilitychange', () => { if (document.hidden) app.editors.saveAll() })
  addEventListener('pagehide', () => app.editors.saveAll())
  addEventListener('beforeunload', e => {
    if (app.editors.anyDirty() && !getSettings().autoSave) { e.preventDefault(); e.returnValue = '' }
    else app.editors.saveAll()
  })

  // オフライン対応 (Service Worker)
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing
        if (!w) return
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            toast('新しいバージョンがあります', { action: { label: '更新', run: () => location.reload() }, duration: 10000 })
          }
        })
      })
    }).catch(() => {})
  }
  document.getElementById('boot') && document.getElementById('boot').remove()
}

boot().catch(e => {
  console.error(e)
  const b = document.getElementById('boot')
  if (b) b.querySelector('.boot-sub').textContent = '起動に失敗しました: ' + e.message
})
