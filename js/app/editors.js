// 開いているファイル (タブ) とエディタ画面の管理
import { EditorView, EditorSelection } from '../../vendor/codemirror.js'
import { createState, reconfigureEffects, langOf, LANG_LABELS } from '../editor/setup.js'
import { makeAiProvider } from '../editor/ai.js'
import { formatLuau, tidy } from '../editor/format.js'
import * as vfs from './vfs.js'
import { app, runCommand, persistSession } from './app.js'
import { getSettings, setSettings, emit, on } from './store.js'
import { h, icon, fileIcon, toast, menu, onLongPress, confirmDialog, copyText, modal } from './ui.js'
import { renderMarkdown } from './markdown.js'

export class EditorManager {
  constructor(root) {
    this.root = root
    this.docs = new Map()
    this.order = []
    this.active = null
    this.paneEls = []
    this.views = []
    this.paneDocs = [null, null]
    this.activePane = 0
    this.split = false
    this.preview = false
    this.saveTimers = new Map()
    this.lastHistory = new Map()
    this.build()
    on('files', () => this.renderTabs())
  }

  build() {
    this.tabbar = h('div', { class: 'tabbar', role: 'tablist' })
    this.breadcrumb = h('div', { class: 'breadcrumb' })
    this.panes = h('div', { class: 'panes' })
    this.empty = h('div', { class: 'empty-editor' })
    for (let i = 0; i < 2; i++) {
      const el = h('div', { class: 'pane' + (i === 1 ? ' hidden' : '') })
      el.addEventListener('focusin', () => this.setActivePane(i))
      el.addEventListener('mousedown', () => this.setActivePane(i))
      el.addEventListener('touchstart', () => this.setActivePane(i), { passive: true })
      this.paneEls.push(el)
      this.panes.append(el)
    }
    this.previewEl = h('div', { class: 'preview hidden' })
    this.panes.append(this.previewEl)
    this.root.append(this.tabbar, this.breadcrumb, this.panes, this.empty)
    this.renderEmpty()
  }

  ctxFor(doc) {
    return {
      getSettings,
      get path() { return doc.path },
      get lang() { return doc.lang },
      commands: {
        save: () => this.save(),
        run: () => runCommand('run'),
        format: () => this.format(),
        quickOpen: () => runCommand('quickOpen'),
        palette: () => runCommand('palette'),
        toggleSidebar: () => runCommand('toggleSidebar'),
        togglePanel: () => runCommand('togglePanel'),
        findInFiles: () => runCommand('findInFiles'),
        gotoLine: () => runCommand('gotoLine'),
        closeTab: () => this.close(this.active),
        outline: () => runCommand('outline'),
      },
      onUpdate: u => this.onUpdate(doc, u),
      aiProvider: this.aiProvider || (this.aiProvider = makeAiProvider(getSettings, () => ({ lang: this.activeDoc() ? this.activeDoc().lang : 'text', name: this.active || '' }))),
      onAiError: e => { if (!this.aiErrShown) { this.aiErrShown = true; toast('AI 候補: ' + e.message, { kind: 'error', duration: 5000 }); setTimeout(() => { this.aiErrShown = false }, 30000) } },
      onScale: size => {
        if (size === null) return getSettings().fontSize
        if (size !== getSettings().fontSize) setSettings({ fontSize: size })
        return size
      },
    }
  }

  has(path) { return this.docs.has(path) }
  activeDoc() { return this.active ? this.docs.get(this.active) : null }
  activeView() { return this.views[this.activePane] || this.views[0] || null }

  async open(path, { activate = true, cursor, scroll, line, pane } = {}) {
    let doc = this.docs.get(path)
    if (!doc) {
      const content = await vfs.readFile(app.project.id, path)
      if (content === null) { toast(`"${path}" を開けません`, { kind: 'error' }); return null }
      doc = { path, lang: langOf(path), state: null, savedDoc: null, dirty: false, scroll: scroll || 0, preview: false }
      doc.ctx = this.ctxFor(doc)
      doc.state = createState(content, doc.ctx)
      if (cursor !== undefined && cursor <= content.length) doc.state = doc.state.update({ selection: EditorSelection.cursor(cursor) }).state
      doc.savedDoc = doc.state.doc
      this.docs.set(path, doc)
      this.order.push(path)
    }
    if (activate) this.activate(path, pane)
    if (line) this.gotoLine(line)
    this.renderTabs()
    persistSession()
    return doc
  }

  ensureView(i) {
    if (!this.views[i]) {
      const doc = this.docs.get(this.paneDocs[i])
      this.views[i] = new EditorView({ state: doc.state, parent: this.paneEls[i] })
    }
    return this.views[i]
  }

  activate(path, pane = this.activePane) {
    const doc = this.docs.get(path)
    if (!doc) return
    if (this.split && pane !== undefined && this.paneDocs[1 - pane] === path) pane = 1 - pane
    const prev = this.paneDocs[pane]
    const view = this.views[pane]
    if (prev && view && this.docs.has(prev)) {
      const pd = this.docs.get(prev)
      pd.state = view.state
      pd.scroll = view.scrollDOM.scrollTop
    }
    this.paneDocs[pane] = path
    this.activePane = pane
    this.active = path
    if (!view) this.ensureView(pane)
    else view.setState(doc.state)
    const v = this.views[pane]
    requestAnimationFrame(() => { v.scrollDOM.scrollTop = doc.scroll || 0; v.requestMeasure() })
    this.empty.classList.add('hidden')
    this.panes.classList.remove('hidden')
    this.renderTabs()
    this.renderBreadcrumb()
    this.updatePreview()
    emit('active', doc)
    persistSession()
  }

  setActivePane(i) {
    if (this.activePane === i || !this.paneDocs[i]) return
    this.activePane = i
    this.active = this.paneDocs[i]
    this.renderTabs()
    this.renderBreadcrumb()
    emit('active', this.activeDoc())
  }

  focus() { const v = this.activeView(); if (v) v.focus() }

  onUpdate(doc, u) {
    doc.state = u.state
    emit('editorupdate', u)
    if (u.docChanged) {
      const wasDirty = doc.dirty
      doc.dirty = !u.state.doc.eq(doc.savedDoc)
      if (wasDirty !== doc.dirty) this.renderTabs()
      if (doc.dirty && getSettings().autoSave) this.scheduleSave(doc)
      emit('docchange', doc)
      if (doc.preview || (this.preview && doc.path === this.active)) this.schedulePreview()
    }
    if (u.selectionSet || u.docChanged) emit('cursor', doc, u.state)
  }

  scheduleSave(doc) {
    clearTimeout(this.saveTimers.get(doc.path))
    this.saveTimers.set(doc.path, setTimeout(() => this.save(doc.path, { auto: true }), getSettings().autoSaveDelay || 800))
  }

  viewFor(path) {
    const i = this.paneDocs.indexOf(path)
    return i >= 0 ? this.views[i] : null
  }

  async save(path = this.active, { auto = false } = {}) {
    const doc = this.docs.get(path)
    if (!doc) return
    clearTimeout(this.saveTimers.get(path))
    const view = this.viewFor(path)
    const s = getSettings()
    if (!auto && (s.formatOnSave || s.trimOnSave)) {
      let text = doc.state.doc.toString()
      let next = text
      try {
        if (s.formatOnSave && doc.lang === 'luau') next = formatLuau(next, doc.state.facet ? indentStr(doc.state) : '\t')
      } catch {}
      if (s.trimOnSave) next = next.replace(/[ \t]+$/gm, '')
      if (next !== text) this.replaceAll(doc, next)
    }
    const content = doc.state.doc.toString()
    try {
      await vfs.writeFile(app.project.id, path, content)
    } catch (e) {
      toast('保存に失敗しました: ' + e.message, { kind: 'error' })
      return
    }
    doc.savedDoc = doc.state.doc
    doc.dirty = false
    this.renderTabs()
    // ローカル履歴 (自動保存は 1 分に 1 回まで)
    const last = this.lastHistory.get(path) || 0
    if (!auto || Date.now() - last > 60000) {
      this.lastHistory.set(path, Date.now())
      vfs.addHistory(app.project.id, path, content).catch(() => {})
    }
    if (!auto) toast('保存しました', { icon: 'check', duration: 1200 })
    emit('saved', doc)
    void view
  }

  async saveAll() {
    for (const d of this.docs.values()) if (d.dirty) await this.save(d.path, { auto: true })
  }

  anyDirty() { for (const d of this.docs.values()) if (d.dirty) return true; return false }

  replaceAll(doc, text) {
    const view = this.viewFor(doc.path)
    const spec = { changes: { from: 0, to: doc.state.doc.length, insert: text }, userEvent: 'input.format' }
    if (view) view.dispatch(spec)
    else doc.state = doc.state.update(spec).state
  }

  format() {
    const doc = this.activeDoc()
    if (!doc) return
    const text = doc.state.doc.toString()
    let next
    try {
      if (doc.lang === 'luau') next = formatLuau(text, indentStr(doc.state))
      else if (doc.lang === 'json') next = JSON.stringify(JSON.parse(text), null, getSettings().insertSpaces ? getSettings().tabSize : '\t') + '\n'
      else next = tidy(text)
    } catch (e) {
      toast(e.message, { kind: 'error' })
      return
    }
    if (next !== text) {
      const view = this.viewFor(doc.path)
      const sel = doc.state.selection.main.head
      this.replaceAll(doc, next)
      if (view) view.dispatch({ selection: EditorSelection.cursor(Math.min(sel, next.length)) })
      toast('整形しました', { icon: 'format', duration: 1200 })
    } else toast('整形済みです', { duration: 1000 })
  }

  async close(path, { force = false } = {}) {
    const doc = this.docs.get(path)
    if (!doc) return true
    if (doc.dirty && !force) {
      if (getSettings().autoSave) await this.save(path, { auto: true })
      else {
        const ok = await confirmDialog('保存されていない変更', `"${path}" の変更を保存しますか?`, { okLabel: '保存して閉じる' })
        if (ok) await this.save(path)
        else {
          const discard = await confirmDialog('変更を破棄', '保存せずに閉じますか?', { okLabel: '破棄して閉じる', danger: true })
          if (!discard) return false
        }
      }
    }
    this.forceClose(path)
    return true
  }

  forceClose(path) {
    const doc = this.docs.get(path)
    if (!doc) return
    clearTimeout(this.saveTimers.get(path))
    const idx = this.order.indexOf(path)
    this.docs.delete(path)
    this.order.splice(idx, 1)
    for (let i = 0; i < 2; i++) {
      if (this.paneDocs[i] !== path) continue
      this.paneDocs[i] = null
      const next = this.order[Math.min(idx, this.order.length - 1)]
      const other = this.paneDocs[1 - i]
      const candidate = next && next !== other ? next : this.order.find(p => p !== other)
      if (candidate) {
        this.paneDocs[i] = null
        this.activate(candidate, i)
      } else if (i === 1) {
        this.toggleSplit(false)
      } else if (this.split && this.paneDocs[1]) {
        // 右ペインのファイルを左へ
        const p = this.paneDocs[1]
        this.toggleSplit(false)
        this.activate(p, 0)
      } else {
        if (this.views[0]) { this.views[0].destroy(); this.views[0] = null }
        this.active = null
        this.panes.classList.add('hidden')
        this.empty.classList.remove('hidden')
        this.renderEmpty()
        emit('active', null)
      }
    }
    if (this.active === path) this.active = this.paneDocs[this.activePane] || this.paneDocs[0]
    this.renderTabs()
    this.renderBreadcrumb()
    persistSession()
  }

  async closeAll({ force = false, silent = false, except } = {}) {
    for (const p of [...this.order]) {
      if (p === except) continue
      if (silent) { if (this.docs.get(p) && this.docs.get(p).dirty) await this.save(p, { auto: true }); this.forceClose(p) }
      else if (!(await this.close(p, { force }))) return false
    }
    return true
  }

  renamed(from, to) {
    const doc = this.docs.get(from)
    if (!doc) return
    this.docs.delete(from)
    const text = doc.state.doc.toString()
    const sel = doc.state.selection
    doc.path = to
    const newLang = langOf(to)
    if (newLang !== doc.lang) {
      doc.lang = newLang
      doc.ctx = this.ctxFor(doc)
      doc.state = createState(text, doc.ctx).update({ selection: sel }).state
      doc.savedDoc = doc.state.doc
      const v = this.viewFor(from)
      if (v) v.setState(doc.state)
    }
    this.docs.set(to, doc)
    this.order[this.order.indexOf(from)] = to
    for (let i = 0; i < 2; i++) if (this.paneDocs[i] === from) this.paneDocs[i] = to
    if (this.active === from) this.active = to
    this.renderTabs()
    this.renderBreadcrumb()
  }

  externalChange(path, content) {
    const doc = this.docs.get(path)
    if (!doc) return
    if (doc.state.doc.toString() === content) return
    if (doc.dirty) { toast(`"${path}" が外部で変更されました (編集中のため反映していません)`, { kind: 'warn' }); return }
    this.replaceAll(doc, content)
    doc.savedDoc = doc.state.doc
    doc.dirty = false
    this.renderTabs()
  }

  reconfigureAll() {
    for (const doc of this.docs.values()) {
      const effects = reconfigureEffects(doc.ctx)
      const v = this.viewFor(doc.path)
      if (v) v.dispatch({ effects })
      else doc.state = doc.state.update({ effects }).state
    }
  }

  gotoLine(line, col = 1) {
    const v = this.activeView()
    if (!v) return
    const n = Math.max(1, Math.min(v.state.doc.lines, line))
    const l = v.state.doc.line(n)
    const pos = Math.min(l.to, l.from + Math.max(0, col - 1))
    v.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
    v.focus()
  }

  toggleSplit(force) {
    const want = force === undefined ? !this.split : force
    if (want === this.split) return
    if (want) {
      if (this.order.length < 2) { toast('分割するには 2 つ以上のファイルを開いてください'); return }
      this.split = true
      this.paneEls[1].classList.remove('hidden')
      this.panes.classList.add('split')
      const other = this.order.find(p => p !== this.paneDocs[0])
      this.paneDocs[1] = null
      this.activate(other, 1)
    } else {
      this.split = false
      const p1 = this.paneDocs[1]
      if (p1 && this.views[1]) { const d = this.docs.get(p1); if (d) d.state = this.views[1].state }
      if (this.views[1]) { this.views[1].destroy(); this.views[1] = null }
      this.paneDocs[1] = null
      this.paneEls[1].classList.add('hidden')
      this.panes.classList.remove('split')
      this.activePane = 0
      this.active = this.paneDocs[0]
      this.renderTabs()
    }
  }

  // ---- プレビュー (Markdown / HTML) ----
  togglePreview(force) {
    this.preview = force === undefined ? !this.preview : force
    this.updatePreview()
  }
  schedulePreview() {
    clearTimeout(this.previewTimer)
    this.previewTimer = setTimeout(() => this.updatePreview(), 300)
  }
  updatePreview() {
    const doc = this.activeDoc()
    const can = doc && (doc.lang === 'markdown' || doc.lang === 'html')
    const show = this.preview && can
    this.previewEl.classList.toggle('hidden', !show)
    this.panes.classList.toggle('with-preview', !!show)
    if (!show) return
    const text = doc.state.doc.toString()
    if (doc.lang === 'markdown') {
      this.previewEl.innerHTML = ''
      const body = h('div', { class: 'md-body' })
      body.innerHTML = renderMarkdown(text)
      this.previewEl.append(body)
    } else {
      let frame = this.previewEl.querySelector('iframe')
      if (!frame) { this.previewEl.innerHTML = ''; frame = h('iframe', { sandbox: 'allow-scripts allow-modals', class: 'html-preview' }); this.previewEl.append(frame) }
      frame.srcdoc = text
    }
  }

  // ---- タブ ----
  renderTabs() {
    const bar = this.tabbar
    bar.innerHTML = ''
    const names = new Map()
    for (const p of this.order) { const b = vfs.basename(p); names.set(b, (names.get(b) || 0) + 1) }
    for (const path of this.order) {
      const doc = this.docs.get(path)
      const base = vfs.basename(path)
      const dir = vfs.dirname(path)
      const isActive = path === this.active
      const inOther = this.split && this.paneDocs.includes(path) && !isActive
      const tab = h('div', {
        class: 'tab' + (isActive ? ' active' : '') + (inOther ? ' visible' : '') + (doc.dirty ? ' dirty' : ''), role: 'tab', 'aria-selected': isActive ? 'true' : 'false', draggable: 'true', title: path,
        onclick: () => this.activate(path),
      },
      fileIcon(path),
      h('span', { class: 'tab-name' }, base, names.get(base) > 1 && dir ? h('span', { class: 'tab-dir' }, ' ' + dir) : null),
      h('button', { class: 'tab-close', 'aria-label': '閉じる', onclick: e => { e.stopPropagation(); this.close(path) } }, h('span', { class: 'dot' }), icon('close', 14)))
      onLongPress(tab, () => this.tabMenu(path, tab))
      tab.addEventListener('auxclick', e => { if (e.button === 1) this.close(path) })
      tab.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-tab', path); tab.classList.add('dragging') })
      tab.addEventListener('dragend', () => tab.classList.remove('dragging'))
      tab.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/x-tab')) e.preventDefault() })
      tab.addEventListener('drop', e => {
        const from = e.dataTransfer.getData('text/x-tab')
        if (!from || from === path) return
        e.preventDefault()
        const fi = this.order.indexOf(from)
        this.order.splice(fi, 1)
        this.order.splice(this.order.indexOf(path) + (fi <= this.order.indexOf(path) ? 1 : 0), 0, from)
        this.renderTabs()
        persistSession()
      })
      bar.append(tab)
      if (isActive) requestAnimationFrame(() => tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
    }
    emit('tabs')
  }

  tabMenu(path, anchor) {
    const idx = this.order.indexOf(path)
    menu([
      { label: '閉じる', icon: 'close', run: () => this.close(path) },
      { label: '他のタブを閉じる', run: () => this.closeAll({ except: path }) },
      { label: '右側のタブを閉じる', run: async () => { for (const p of this.order.slice(idx + 1)) await this.close(p) } },
      { label: 'すべて閉じる', run: () => this.closeAll() },
      '-',
      { label: '分割して右に表示', icon: 'split', run: () => { if (!this.split) { this.toggleSplit(true) } this.activate(path, 1) } },
      { label: 'パスをコピー', icon: 'copy', run: () => copyText(path).then(() => toast('コピーしました')) },
      { label: 'エクスプローラーで表示', icon: 'files', run: () => runCommand('revealInExplorer', path) },
      { label: '履歴を表示', icon: 'history', run: () => runCommand('history', path) },
    ], anchor, { title: vfs.basename(path) })
  }

  renderBreadcrumb() {
    const doc = this.activeDoc()
    this.breadcrumb.innerHTML = ''
    if (!doc) return
    const parts = doc.path.split('/')
    parts.forEach((p, i) => {
      if (i) this.breadcrumb.append(icon('chevronRight', 12))
      this.breadcrumb.append(h('span', { class: i === parts.length - 1 ? 'crumb last' : 'crumb' }, p))
    })
    this.breadcrumb.append(h('span', { class: 'crumb-lang' }, LANG_LABELS[doc.lang] || doc.lang))
  }

  renderEmpty() {
    this.empty.innerHTML = ''
    this.empty.append(
      h('div', { class: 'empty-logo' }, '⚒︎'),
      h('div', { class: 'empty-title' }, app.project ? app.project.name : 'ForgeCode'),
      h('div', { class: 'empty-actions' },
        h('button', { class: 'btn primary', onclick: () => runCommand('newFile') }, icon('newFile', 18), '新しいファイル'),
        h('button', { class: 'btn', onclick: () => runCommand('quickOpen') }, icon('search', 18), 'ファイルを開く'),
        h('button', { class: 'btn', onclick: () => runCommand('importFiles') }, icon('upload', 18), '端末から読み込む'),
        h('button', { class: 'btn', onclick: () => runCommand('projects') }, icon('folder', 18), 'プロジェクト一覧'),
        h('button', { class: 'btn', onclick: () => runCommand('help') }, icon('book', 18), '使い方')),
      h('div', { class: 'empty-keys' },
        h('div', null, h('kbd', null, '⌘/Ctrl + P'), ' ファイルを開く'),
        h('div', null, h('kbd', null, '⌘/Ctrl + Shift + P'), ' コマンド'),
        h('div', null, h('kbd', null, '⌘/Ctrl + Enter'), ' 実行'),
        h('div', null, h('kbd', null, '⌘/Ctrl + S'), ' 保存')))
  }

  sessionData() {
    const tabs = this.order.map(p => {
      const d = this.docs.get(p)
      const v = this.viewFor(p)
      return { path: p, cursor: d.state.selection.main.head, scroll: v ? v.scrollDOM.scrollTop : d.scroll }
    })
    return { tabs, active: this.active }
  }

  // ---- 編集コマンド (キーバーやメニューから) ----
  view() { return this.activeView() }
}

function indentStr(state) {
  const s = getSettings()
  void state
  return s.insertSpaces ? ' '.repeat(s.tabSize) : '\t'
}

export { modal }
