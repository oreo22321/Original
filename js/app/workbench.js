// 画面全体のレイアウト (スマホ / タブレット・PC 両対応)
import { app, command, runCommand, setProjectKind, setRunTarget } from './app.js'
import { getSettings, setSettings, getMode, on, isTouch, MODE_LABELS } from './store.js'
import { h, icon, menu, toast, copyText, shareFile, haptic, promptDialog } from './ui.js'
import * as vfs from './vfs.js'
import { EditorManager } from './editors.js'
import { Explorer } from './explorer.js'
import { Runner } from './runner.js'
import { KeyBar } from './keybar.js'
import { SearchView, OutlineView } from './views.js'
import { SettingsView } from './settings-ui.js'
import { AiView } from './ai-panel.js'
import { LANG_LABELS, KIND_LABELS, scriptKindOf } from '../editor/setup.js'
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
    on('cursor', () => this.scheduleCursor())
    on('problems', () => this.updateStatus())
    on('running', () => { this.updateTop(); this.updateStatus() })
    on('project', () => { this.updateTop(); this.updateStatus() })
    on('mode', () => { this.updateTop(); this.updateStatus() })
    on('saveState', () => this.updateStatus())
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
    this.buildStatus()
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
    a.textContent = ''
    const doc = app.editors.activeDoc()
    const runner = app.runner
    const running = runner && runner.running
    const target = runner && runner.runTarget()
    const runnable = !!target || (doc && doc.lang === 'luau') || app.files.some(f => !f.dir && /\.luau?$/.test(f.path))
    const btn = (ic, title, fn, on) => h('button', { class: 'icon-btn' + (on ? ' on' : ''), title, 'aria-label': title, onclick: fn }, icon(ic, 20))
    if (doc && doc.lang === 'luau') a.append(btn('copy', 'コードをコピー', () => runCommand('copyCode')))
    if (doc && doc.lang === 'markdown') a.append(btn('eye', 'プレビュー', () => { app.editors.togglePreview(); this.updateTop() }, app.editors.preview))
    if (this.layout === 'desktop' && app.editors.order.length > 1) a.append(btn('split', 'エディタを分割', () => { app.editors.toggleSplit(); this.updateTop() }, app.editors.split))
    a.append(btn('terminal', '出力パネル', () => this.togglePanel(), this.panelOpen))
    if (running) {
      a.append(h('button', { class: 'run-btn stop' + (runner.waiting ? ' waiting' : ''), title: '停止', 'aria-label': '停止', onclick: () => runCommand('stop') }, icon('stop', 18), h('span', null, '停止')))
    } else {
      const pinned = target && (!doc || doc.path !== target)
      a.append(h('button', { class: 'run-btn', title: target ? `${target} を実行 (⌘/Ctrl + Enter)` : '実行 (⌘/Ctrl + Enter)', 'aria-label': '実行', disabled: !runnable, onclick: () => runCommand('run') },
        icon('play', 18), h('span', null, pinned ? vfs.basename(target).replace(/\.(server|client)?\.?luau?$/, '') : '実行')))
    }
    a.append(btn('more', 'その他', e => this.moreMenu(e.currentTarget)))
  }

  moreMenu(anchor) {
    const doc = app.editors.activeDoc()
    const s = getSettings()
    const luau = doc && doc.lang === 'luau'
    const v = app.editors.activeView()
    const hasSel = v && !v.state.selection.main.empty
    menu([
      { label: '保存', icon: 'save', hint: '⌘S', run: () => runCommand('save'), disabled: !doc },
      { label: '整形', icon: 'format', hint: '⇧⌥F', run: () => runCommand('format'), disabled: !doc },
      { label: 'この行のエラーを修正', icon: 'bulb', hint: '⌘.', run: () => runCommand('quickFix'), disabled: !luau },
      { label: '誤字・全角記号をまとめて直す', icon: 'wand', run: () => runCommand('fixAllTypos'), disabled: !luau },
      '-',
      hasSel && luau ? { label: '選択範囲だけ実行', icon: 'play', run: () => runCommand('runSelection') } : null,
      { label: 'コードをコピー', icon: 'copy', run: () => runCommand('copyCode'), disabled: !doc },
      { label: '圧縮してコピー', icon: 'copy', run: () => runCommand('copyMinified'), disabled: !luau },
      getMode() === 'executor' ? { label: 'loadstring の 1 行を作る', icon: 'bolt', run: () => runCommand('copyLoader') } : null,
      { label: '共有 / ファイルに保存', icon: 'share', run: () => runCommand('shareFile'), disabled: !doc },
      '-',
      { label: '検索・置換', icon: 'search', hint: '⌘F', run: () => runCommand('find'), disabled: !doc },
      { label: '全ファイルから検索', icon: 'search', hint: '⇧⌘F', run: () => runCommand('findInFiles') },
      { label: '関数・変数へ移動', icon: 'outline', run: () => runCommand('gotoSymbol'), disabled: !doc },
      { label: '変更履歴', icon: 'history', run: () => runCommand('history'), disabled: !doc },
      { label: '長い行を折り返す', icon: 'wrap', checked: s.wordWrap, run: () => setSettings({ wordWrap: !s.wordWrap }) },
      '-',
      { label: 'AI に質問', icon: 'sparkle', run: () => runCommand('aiChat') },
      { label: 'コマンドパレット', icon: 'command', hint: '⇧⌘P', run: () => runCommand('palette') },
      { label: 'プロジェクト一覧', icon: 'folder', run: () => runCommand('projects') },
      { label: '設定', icon: 'gear', run: () => runCommand('settings') },
      { label: '使い方', icon: 'book', run: () => runCommand('help') },
    ], anchor)
  }

  // ---- ステータスバー (要素は 1 度だけ作り、中身だけ書き換える) ----
  buildStatus() {
    const item = (cls, onclick, title) => h(onclick ? 'button' : 'span', { class: 'sb-item ' + cls, onclick, title })
    this.sb = {
      mode: item('sb-mode', e => this.modeMenu(e.currentTarget), 'モードを切り替え'),
      project: item('sb-project', () => runCommand('projects'), 'プロジェクト一覧'),
      problems: item('sb-problems', () => { this.togglePanel(true); app.runner.show('problems') }, '問題を表示'),
      save: item('sb-save', () => runCommand('save'), '保存の状態'),
      run: item('sb-run running hidden'),
      cursor: item('sb-cursor', () => runCommand('gotoLine'), '行へ移動'),
      indent: item('sb-indent hide-mobile', () => setSettings({ insertSpaces: !getSettings().insertSpaces }), 'タブ / スペースを切り替え'),
      kind: item('sb-kind'),
    }
    this.status = h('footer', { class: 'statusbar' }, this.sb.mode, this.sb.project, this.sb.problems, this.sb.save, this.sb.run, h('span', { class: 'sb-spacer' }), this.sb.cursor, this.sb.indent, this.sb.kind)
    this.sbCache = {}
  }

  // 値が変わったときだけ DOM を触る
  sbSet(key, sig, build) {
    if (this.sbCache[key] === sig) return
    this.sbCache[key] = sig
    const el = this.sb[key]
    el.textContent = ''
    const parts = build()
    if (parts) el.append(...[].concat(parts).filter(x => x !== null && x !== undefined && x !== false))
  }

  updateStatus() {
    if (!this.sb) return
    const doc = app.editors && app.editors.activeDoc()
    const runner = app.runner
    const pc = runner ? runner.problemCount : { error: 0, warning: 0 }
    const mode = getMode()
    const s = getSettings()
    this.sb.mode.className = 'sb-item sb-mode k-' + mode
    this.sbSet('mode', mode, () => [icon(mode === 'executor' ? 'bolt' : 'cube', 14), MODE_LABELS[mode]])
    this.sbSet('project', app.project ? app.project.name : '', () => (app.project ? [icon('folder', 13), h('span', { class: 'sb-clip' }, app.project.name)] : null))
    this.sb.problems.classList.toggle('err', pc.error > 0)
    this.sb.problems.classList.toggle('warn', !pc.error && pc.warning > 0)
    this.sbSet('problems', pc.error + ':' + pc.warning, () => [icon('close', 13), String(pc.error), icon('alert', 13), String(pc.warning)])
    const st = app.editors ? app.editors.saveState : 'saved'
    const auto = s.autoSave
    this.sb.save.className = 'sb-item sb-save s-' + st
    this.sbSet('save', st + auto, () => st === 'saving' ? [icon('saving', 14), h('span', { class: 'hide-mobile' }, '保存中…')] : st === 'error' ? [icon('alert', 14), '保存できません'] : st === 'dirty' ? [h('span', { class: 'sb-dot' }), h('span', { class: 'hide-mobile' }, auto ? '未保存' : '未保存 (⌘S)')] : [icon('saved', 14), h('span', { class: 'hide-mobile' }, '保存済み')])
    const running = runner && runner.running
    this.sb.run.classList.toggle('hidden', !running)
    this.sbSet('run', running ? (runner.waiting ? 'w' : 'r') : '', () => (running ? [h('span', { class: 'spinner' }), runner.waiting ? '操作待ち' : '実行中'] : null))
    this.sb.indent.classList.toggle('none', !doc)
    this.sb.cursor.classList.toggle('none', !doc)
    this.sb.kind.classList.toggle('none', !doc)
    if (doc) {
      this.sbSet('indent', s.insertSpaces + ':' + s.tabSize, () => (s.insertSpaces ? `スペース: ${s.tabSize}` : `タブ: ${s.tabSize}`))
      const kind = scriptKindOf(doc.path, mode)
      // Executor モードは左端に表示済みなので、ここでは言語名だけ
      this.sbSet('kind', doc.lang + kind, () => (kind && kind !== 'executor' ? KIND_LABELS[kind].replace(/ \(.*\)$/, '') : LANG_LABELS[doc.lang] || doc.lang))
      this.updateCursor()
    }
  }

  // カーソル位置の表示は 1 フレームに 1 回だけ更新
  scheduleCursor() {
    if (this.cursorRaf) return
    this.cursorRaf = requestAnimationFrame(() => { this.cursorRaf = 0; this.updateCursor() })
  }
  updateCursor() {
    const doc = app.editors && app.editors.activeDoc()
    if (!doc || !this.sb) return
    const sel = doc.state.selection.main
    const line = doc.state.doc.lineAt(sel.head)
    const selLen = sel.to - sel.from
    const text = `${line.number} 行, ${sel.head - line.from + 1} 列${selLen ? ` (${selLen} 文字選択)` : ''}`
    if (this.sbCache.cursor !== text) { this.sbCache.cursor = text; this.sb.cursor.textContent = text }
  }

  modeMenu(anchor) {
    const mode = getMode()
    menu([
      { note: 'モードによって、補完・エラーチェック・実行環境が切り替わります' },
      { label: 'Roblox Studio — ゲーム用のスクリプト', icon: 'cube', checked: mode === 'studio', run: () => runCommand('setMode', 'studio') },
      { label: 'Executor — エグゼキューター API も使う', icon: 'bolt', checked: mode === 'executor', run: () => runCommand('setMode', 'executor') },
    ], anchor, { title: 'このプロジェクトのモード' })
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
command('togglePreview', 'プレビューの切り替え (Markdown)', () => { app.editors.togglePreview(); app.wb.updateTop() }, { icon: 'eye' })
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
command('copyMinified', 'コードを圧縮してコピー', async () => {
  const doc = app.editors.activeDoc()
  if (!doc || doc.lang !== 'luau') return
  try { await copyText(minifyLuau(doc.state.doc.toString())); toast('圧縮したコードをコピーしました', { icon: 'copy' }) } catch (e) { toast(e.message, { kind: 'error' }) }
}, { icon: 'copy' })
command('copyLoader', 'loadstring の 1 行を作る (エグゼキューター)', async () => {
  const url = await promptDialog('loadstring の 1 行を作る', { label: 'スクリプトを置いた URL (GitHub の Raw や Pastebin の raw など)', placeholder: 'https://raw.githubusercontent.com/...', okLabel: 'コピー' })
  if (!url) return
  if (!/^https?:\/\//.test(url)) { toast('http:// か https:// で始まる URL を入力してください', { kind: 'error' }); return }
  const ok = await copyText(`loadstring(game:HttpGet(${JSON.stringify(url)}))()`)
  toast(ok ? 'コピーしました。エグゼキューターに貼り付けて実行できます' : 'コピーできませんでした', { icon: ok ? 'copy' : 'alert' })
}, { icon: 'bolt' })
command('shareFile', '共有 / ファイルに保存', () => {
  const doc = app.editors.activeDoc()
  if (doc) shareFile(doc.path.split('/').pop(), doc.state.doc.toString())
}, { icon: 'share' })
command('setMode', 'モードを切り替え (Studio / Executor)', async kind => {
  const next = kind === 'studio' || kind === 'executor' ? kind : getMode() === 'studio' ? 'executor' : 'studio'
  await setProjectKind(next)
  toast(`${MODE_LABELS[next]} モードにしました`, { icon: next === 'executor' ? 'bolt' : 'cube' })
}, { icon: 'swap' })
command('unpinRun', '実行ファイルの固定を解除', () => setRunTarget(null).then(() => toast('開いているファイルを実行します')), { icon: 'pin' })
command('reload', 'アプリを再読み込み', () => location.reload())
