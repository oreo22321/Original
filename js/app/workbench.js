// 画面全体のレイアウト (スマホ / タブレット・PC 両対応)
import { app, command, runCommand, persistSession } from './app.js'
import { getSettings, setSettings, on, emit, isTouch } from './store.js'
import { h, icon, menu, toast, copyText, shareFile, haptic } from './ui.js'
import { EditorManager } from './editors.js'
import { Explorer } from './explorer.js'
import { Runner } from './runner.js'
import { KeyBar } from './keybar.js'
import { SearchView, OutlineView } from './views.js'
import { SettingsView } from './settings-ui.js'
import { AiView } from './ai-panel.js'
import { LANG_LABELS } from '../editor/setup.js'
import { openSearchPanel, toggleComment, foldAll, unfoldAll, undo, redo, selectAll } from '../../vendor/codemirror.js'
import { minifyLuau } from '../editor/format.js'

const VIEWS = [
  ['files', 'files', 'ファイル'],
  ['search', 'search', '検索'],
  ['outline', 'outline', '構造'],
  ['ai', 'sparkle', 'AI'],
  ['settings', 'gear', '設定'],
]

export class Workbench {
  constructor(root) {
    this.root = root
    this.sidebarOpen = localStorage.getItem('forgecode.sidebar') !== '0'
    this.panelOpen = false
    this.view = 'files'
    this.sidebarWidth = Number(localStorage.getItem('forgecode.sidebarW')) || 270
    this.panelHeight = Number(localStorage.getItem('forgecode.panelH')) || 0
    this.build()
    this.applyLayout()
    addEventListener('resize', () => this.applyLayout())
    this.setupViewport()
    on('active', () => { this.updateTop(); this.updateStatus() })
    on('tabs', () => this.updateTop())
    on('cursor', () => this.updateStatus())
    on('problems', () => this.updateStatus())
    on('running', () => { this.updateTop(); this.updateStatus() })
    on('project', () => this.updateStatus())
    on('fileOpened', () => { if (this.layout === 'mobile') this.toggleSidebar(false) })
  }

  build() {
    const r = this.root
    r.innerHTML = ''
    // アクティビティバー
    this.activity = h('nav', { class: 'activitybar', 'aria-label': 'ビュー' })
    for (const [id, ic, label] of VIEWS) {
      this.activity.append(h('button', { class: 'act-btn', 'data-view': id, title: label, 'aria-label': label, onclick: () => this.onActivity(id) }, icon(ic, 24)))
    }
    this.activity.append(h('div', { class: 'act-spacer' }), h('button', { class: 'act-btn', title: '使い方', 'aria-label': '使い方', onclick: () => runCommand('help') }, icon('book', 22)))
    // サイドバー
    this.sideTabs = h('div', { class: 'side-tabs' }, VIEWS.map(([id, ic, label]) => h('button', { class: 'side-tab', 'data-view': id, 'aria-label': label, onclick: () => this.showView(id) }, icon(ic, 20), h('span', null, label))),
      h('button', { class: 'side-tab close', 'aria-label': '閉じる', onclick: () => this.toggleSidebar(false) }, icon('close', 20)))
    this.viewHost = h('div', { class: 'view-host' })
    this.sidebar = h('aside', { class: 'sidebar' }, this.sideTabs, this.viewHost)
    this.sideResize = h('div', { class: 'resizer v', title: 'ドラッグで幅を変更' })
    this.scrim = h('div', { class: 'scrim', onclick: () => this.toggleSidebar(false) })
    // 上部バー
    this.menuBtn = h('button', { class: 'icon-btn top-menu', 'aria-label': 'ファイル一覧', onclick: () => this.toggleSidebar() }, icon('menu', 22))
    this.topActions = h('div', { class: 'top-actions' })
    this.editorRoot = h('div', { class: 'editor-root' })
    this.topbar = h('div', { class: 'topbar' }, this.menuBtn, h('div', { class: 'tab-slot' }), this.topActions)
    // パネル
    this.panelRoot = h('section', { class: 'panel hidden' })
    this.panelResize = h('div', { class: 'resizer h', title: 'ドラッグで高さを変更' })
    this.center = h('main', { class: 'center' }, this.topbar, this.editorRoot, this.panelResize, this.panelRoot)
    this.keybarRoot = h('div', { class: 'keybar' })
    this.status = h('footer', { class: 'statusbar' })
    this.mainEl = h('div', { class: 'main' }, this.activity, this.sidebar, this.sideResize, this.scrim, this.center)
    r.append(this.mainEl, this.keybarRoot, this.status)

    app.editors = new EditorManager(this.editorRoot)
    this.topbar.querySelector('.tab-slot').append(app.editors.tabbar)
    app.runner = new Runner(this.panelRoot)
    this.keybar = new KeyBar(this.keybarRoot)

    this.views = {}
    this.viewEls = {}
    for (const [id] of VIEWS) {
      const el = h('div', { class: 'view hidden', 'data-view': id })
      this.viewEls[id] = el
      this.viewHost.append(el)
    }
    this.views.files = new Explorer(this.viewEls.files)
    this.views.search = new SearchView(this.viewEls.search)
    this.views.outline = new OutlineView(this.viewEls.outline)
    this.views.ai = new AiView(this.viewEls.ai)
    this.views.settings = new SettingsView(this.viewEls.settings)
    this.showView('files', null, true)
    this.setupResizers()
    this.updateTop()
    this.updateStatus()
  }

  // ---- レイアウト ----
  applyLayout() {
    const s = getSettings()
    const w = innerWidth
    const layout = s.layout === 'auto' ? (w < 760 ? 'mobile' : 'desktop') : s.layout
    const changed = layout !== this.layout
    this.layout = layout
    document.body.dataset.layout = layout
    document.body.classList.toggle('touch', isTouch)
    if (changed) {
      if (layout === 'mobile') this.sidebarOpen = false
      else this.sidebarOpen = localStorage.getItem('forgecode.sidebar') !== '0'
    }
    this.sidebar.style.width = layout === 'desktop' ? this.sidebarWidth + 'px' : ''
    this.applySidebar()
    this.applyPanel()
  }

  applySidebar() {
    document.body.classList.toggle('sidebar-open', this.sidebarOpen)
    this.sidebar.classList.toggle('open', this.sidebarOpen)
    this.sideResize.classList.toggle('hidden', !this.sidebarOpen || this.layout === 'mobile')
    this.activity.querySelectorAll('.act-btn[data-view]').forEach(b => b.classList.toggle('active', this.sidebarOpen && b.dataset.view === this.view))
    setTimeout(() => app.editors.views.forEach(v => v && v.requestMeasure()), 220)
  }

  toggleSidebar(force) {
    this.sidebarOpen = force === undefined ? !this.sidebarOpen : force
    if (this.layout === 'desktop') localStorage.setItem('forgecode.sidebar', this.sidebarOpen ? '1' : '0')
    this.applySidebar()
  }

  onActivity(id) {
    if (this.sidebarOpen && this.view === id) this.toggleSidebar(false)
    else this.showView(id)
  }

  showView(id, focusText, silent) {
    this.view = id
    for (const [vid, el] of Object.entries(this.viewEls)) el.classList.toggle('hidden', vid !== id)
    this.sideTabs.querySelectorAll('.side-tab[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === id))
    if (!silent) this.toggleSidebar(true)
    if (id === 'search') this.views.search.focus()
    if (id === 'outline') this.views.outline.render()
    if (id === 'ai') this.views.ai.render()
    if (id === 'settings') {
      this.views.settings.render()
      if (focusText) { this.views.settings.search.value = focusText; this.views.settings.filter = focusText.toLowerCase(); this.views.settings.render() }
    }
    this.applySidebar()
  }

  applyPanel() {
    this.panelRoot.classList.toggle('hidden', !this.panelOpen)
    this.panelResize.classList.toggle('hidden', !this.panelOpen)
    const total = this.center.clientHeight || innerHeight
    const def = this.layout === 'mobile' ? Math.round(total * 0.42) : Math.round(total * 0.34)
    const hgt = Math.max(120, Math.min(total - 140, this.panelHeight || def))
    this.panelRoot.style.height = hgt + 'px'
    setTimeout(() => app.editors.views.forEach(v => v && v.requestMeasure()), 50)
  }

  togglePanel(force) {
    this.panelOpen = force === undefined ? !this.panelOpen : force
    this.applyPanel()
    this.updateTop()
  }

  setupResizers() {
    const drag = (el, onMove, onEnd) => {
      el.addEventListener('pointerdown', e => {
        e.preventDefault()
        el.setPointerCapture(e.pointerId)
        el.classList.add('dragging')
        const move = ev => onMove(ev)
        const up = () => { el.classList.remove('dragging'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); onEnd() }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
        el.addEventListener('pointercancel', up)
      })
    }
    drag(this.sideResize, e => {
      const left = this.activity.getBoundingClientRect().right
      this.sidebarWidth = Math.max(180, Math.min(innerWidth * 0.6, e.clientX - left))
      this.sidebar.style.width = this.sidebarWidth + 'px'
    }, () => { localStorage.setItem('forgecode.sidebarW', String(Math.round(this.sidebarWidth))); app.editors.views.forEach(v => v && v.requestMeasure()) })
    drag(this.panelResize, e => {
      const rect = this.center.getBoundingClientRect()
      this.panelHeight = Math.max(100, Math.min(rect.height - 120, rect.bottom - e.clientY))
      this.panelRoot.style.height = this.panelHeight + 'px'
    }, () => { localStorage.setItem('forgecode.panelH', String(Math.round(this.panelHeight))); app.editors.views.forEach(v => v && v.requestMeasure()) })
  }

  // iOS / Android の画面キーボード対策
  setupViewport() {
    const vv = window.visualViewport
    const update = () => {
      const hgt = vv ? vv.height : innerHeight
      document.documentElement.style.setProperty('--app-h', hgt + 'px')
      const kb = vv ? innerHeight - vv.height > 140 : false
      document.body.classList.toggle('kb-open', kb)
      if (vv && vv.offsetTop) window.scrollTo(0, 0)
    }
    update()
    if (vv) { vv.addEventListener('resize', update); vv.addEventListener('scroll', update) }
    addEventListener('orientationchange', () => setTimeout(update, 300))
  }

  // ---- 上部バー ----
  updateTop() {
    const a = this.topActions
    a.innerHTML = ''
    const doc = app.editors.activeDoc()
    const running = app.runner && app.runner.running
    const runnable = doc && ['luau', 'python', 'javascript', 'html', 'markdown'].includes(doc.lang)
    if (doc && doc.lang === 'luau') a.append(h('button', { class: 'icon-btn', title: 'コードをコピー', 'aria-label': 'コードをコピー', onclick: () => runCommand('copyCode') }, icon('copy', 20)))
    if (doc && (doc.lang === 'markdown' || doc.lang === 'html')) a.append(h('button', { class: 'icon-btn' + (app.editors.preview ? ' on' : ''), title: 'プレビュー', 'aria-label': 'プレビュー', onclick: () => { app.editors.togglePreview(); this.updateTop() } }, icon('eye', 20)))
    if (this.layout === 'desktop' && app.editors.order.length > 1) a.append(h('button', { class: 'icon-btn' + (app.editors.split ? ' on' : ''), title: 'エディタを分割', 'aria-label': 'エディタを分割', onclick: () => { app.editors.toggleSplit(); this.updateTop() } }, icon('split', 20)))
    a.append(h('button', { class: 'icon-btn' + (this.panelOpen ? ' on' : ''), title: '出力パネル', 'aria-label': '出力パネル', onclick: () => this.togglePanel() }, icon('terminal', 20)))
    if (running) a.append(h('button', { class: 'run-btn stop', title: '停止', 'aria-label': '停止', onclick: () => runCommand('stop') }, icon('stop', 18), h('span', null, '停止')))
    else a.append(h('button', { class: 'run-btn', title: '実行 (⌘/Ctrl + Enter)', 'aria-label': '実行', disabled: !runnable, onclick: () => runCommand('run') }, icon('play', 18), h('span', null, '実行')))
    a.append(h('button', { class: 'icon-btn', title: 'その他', 'aria-label': 'その他', onclick: e => this.moreMenu(e.currentTarget) }, icon('more', 20)))
  }

  moreMenu(anchor) {
    const doc = app.editors.activeDoc()
    const s = getSettings()
    menu([
      { label: '保存', icon: 'save', hint: '⌘S', run: () => runCommand('save'), disabled: !doc },
      { label: '整形', icon: 'format', hint: '⇧⌥F', run: () => runCommand('format'), disabled: !doc },
      { label: '検索・置換', icon: 'search', hint: '⌘F', run: () => runCommand('find'), disabled: !doc },
      { label: '全ファイルから検索', icon: 'search', hint: '⇧⌘F', run: () => runCommand('findInFiles') },
      { label: '行へ移動', hint: '⌘G', run: () => runCommand('gotoLine'), disabled: !doc },
      { label: '関数・変数へ移動', icon: 'outline', run: () => runCommand('gotoSymbol'), disabled: !doc },
      '-',
      { label: 'コードをコピー', icon: 'copy', run: () => runCommand('copyCode'), disabled: !doc },
      { label: '共有 / ファイルに保存', icon: 'share', run: () => runCommand('shareFile'), disabled: !doc },
      { label: '変更履歴', icon: 'history', run: () => runCommand('history'), disabled: !doc },
      { label: '長い行を折り返す', icon: 'wrap', checked: s.wordWrap, run: () => setSettings({ wordWrap: !s.wordWrap }) },
      this.layout === 'desktop' ? { label: 'エディタを分割', icon: 'split', checked: app.editors.split, run: () => runCommand('toggleSplit') } : null,
      '-',
      { label: 'AI に質問', icon: 'sparkle', run: () => runCommand('aiChat') },
      { label: 'コマンドパレット', icon: 'command', hint: '⇧⌘P', run: () => runCommand('palette') },
      { label: 'プロジェクト一覧', icon: 'folder', run: () => runCommand('projects') },
      { label: '設定', icon: 'gear', run: () => runCommand('settings') },
      { label: '使い方', icon: 'book', run: () => runCommand('help') },
    ], anchor)
  }

  // ---- ステータスバー ----
  updateStatus() {
    const st = this.status
    st.innerHTML = ''
    const doc = app.editors && app.editors.activeDoc()
    const pc = app.runner ? app.runner.problemCount : { error: 0, warning: 0 }
    const running = app.runner && app.runner.running
    const add = (...els) => st.append(...els.filter(Boolean))
    add(
      h('button', { class: 'sb-item', onclick: () => runCommand('projects') }, icon('folder', 14), app.project ? app.project.name : ''),
      h('button', { class: 'sb-item' + (pc.error ? ' err' : ''), onclick: () => { this.togglePanel(true); app.runner.show('problems') } }, icon('close', 13), String(pc.error), icon('alert', 13), String(pc.warning)),
      running ? h('span', { class: 'sb-item running' }, h('span', { class: 'spinner' }), '実行中') : null,
      h('span', { class: 'sb-spacer' }))
    if (doc) {
      const sel = doc.state.selection.main
      const line = doc.state.doc.lineAt(sel.head)
      const s = getSettings()
      const selLen = Math.abs(sel.to - sel.from)
      add(
        h('button', { class: 'sb-item', onclick: () => runCommand('gotoLine') }, `${line.number} 行, ${sel.head - line.from + 1} 列${selLen ? ` (${selLen} 文字選択)` : ''}`),
        h('button', { class: 'sb-item hide-mobile', onclick: () => setSettings({ insertSpaces: !s.insertSpaces }) }, doc.lang === 'python' || s.insertSpaces ? `スペース: ${s.tabSize}` : `タブ: ${s.tabSize}`),
        h('span', { class: 'sb-item' }, LANG_LABELS[doc.lang] || doc.lang),
        doc.lang === 'luau' && (s.robloxApi || s.executorApi) ? h('button', { class: 'sb-item hide-mobile', onclick: () => this.showView('settings', 'API') }, s.executorApi ? 'Roblox + Executor' : 'Roblox') : null)
    }
  }
}

// ---- コマンド ----
command('toggleSidebar', 'サイドバーの表示切り替え', f => app.wb.toggleSidebar(typeof f === 'boolean' ? f : undefined), { key: '⌘B' })
command('togglePanel', 'パネルの表示切り替え', f => app.wb.togglePanel(typeof f === 'boolean' ? f : undefined), { icon: 'terminal', key: '⌘J' })
command('findInFiles', '全ファイルから検索', () => app.wb.showView('search'), { icon: 'search', key: '⇧⌘F' })
command('outline', 'アウトラインを表示', () => app.wb.showView('outline'), { icon: 'outline' })
command('explorer', 'エクスプローラーを表示', () => app.wb.showView('files'), { icon: 'files' })
command('revealInExplorer', 'エクスプローラーで表示', p => { app.wb.showView('files'); app.wb.views.files.reveal(typeof p === 'string' ? p : app.editors.active) }, { icon: 'files' })
command('save', '保存', () => app.editors.save(), { icon: 'save', key: '⌘S' })
command('saveAll', 'すべて保存', () => app.editors.saveAll().then(() => toast('すべて保存しました')), { icon: 'save' })
command('format', 'ドキュメントを整形', () => app.editors.format(), { icon: 'format', key: '⇧⌥F' })
command('find', '検索・置換', () => { const v = app.editors.activeView(); if (v) { openSearchPanel(v) } }, { icon: 'search', key: '⌘F' })
command('toggleComment', 'コメントの切り替え', () => { const v = app.editors.activeView(); if (v) toggleComment(v) }, { key: '⌘/' })
command('foldAll', 'すべて折りたたむ', () => { const v = app.editors.activeView(); if (v) foldAll(v) })
command('unfoldAll', 'すべて展開', () => { const v = app.editors.activeView(); if (v) unfoldAll(v) })
command('undo', '元に戻す', () => { const v = app.editors.activeView(); if (v) undo(v) }, { icon: 'undo', key: '⌘Z' })
command('redo', 'やり直し', () => { const v = app.editors.activeView(); if (v) redo(v) }, { icon: 'redo', key: '⇧⌘Z' })
command('selectAll', 'すべて選択', () => { const v = app.editors.activeView(); if (v) { selectAll(v); v.focus() } }, { key: '⌘A' })
command('closeTab', 'タブを閉じる', () => app.editors.close(app.editors.active), { icon: 'close', key: '⌘W' })
command('closeAll', 'すべてのタブを閉じる', () => app.editors.closeAll())
command('toggleSplit', 'エディタを分割', () => app.editors.toggleSplit(), { icon: 'split' })
command('togglePreview', 'プレビューの切り替え (Markdown / HTML)', () => { app.editors.togglePreview(); app.wb.updateTop() }, { icon: 'eye' })
command('toggleWrap', '折り返しの切り替え', () => setSettings({ wordWrap: !getSettings().wordWrap }), { icon: 'wrap' })
command('zoomIn', '文字を大きく', () => setSettings({ fontSize: Math.min(32, getSettings().fontSize + 1) }))
command('zoomOut', '文字を小さく', () => setSettings({ fontSize: Math.max(9, getSettings().fontSize - 1) }))
command('copyCode', 'コードをすべてコピー', async () => {
  const doc = app.editors.activeDoc()
  if (!doc) return
  const v = app.editors.activeView()
  const sel = v && !v.state.selection.main.empty ? v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) : null
  const ok = await copyText(sel || doc.state.doc.toString())
  haptic(10)
  toast(ok ? (sel ? '選択範囲をコピーしました' : 'コード全体をコピーしました') : 'コピーできませんでした', { icon: ok ? 'copy' : 'alert' })
}, { icon: 'copy' })
command('copyMinified', 'コードを圧縮してコピー (Lua)', async () => {
  const doc = app.editors.activeDoc()
  if (!doc || doc.lang !== 'luau') return
  try { await copyText(minifyLuau(doc.state.doc.toString())); toast('圧縮したコードをコピーしました') } catch (e) { toast(e.message, { kind: 'error' }) }
}, { icon: 'copy' })
command('shareFile', '共有 / ファイルに保存', () => {
  const doc = app.editors.activeDoc()
  if (doc) shareFile(doc.path.split('/').pop(), doc.state.doc.toString())
}, { icon: 'share' })
command('reload', 'アプリを再読み込み', () => location.reload())
void emit; void persistSession
