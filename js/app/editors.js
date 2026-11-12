// 開いているファイル (タブ) とエディタ画面の管理
import { EditorView, EditorSelection, forEachDiagnostic, forceLinting, undo } from '../../vendor/codemirror.js'
import { createState, reconfigureEffects, langOf, scriptKindOf, LANG_LABELS, KIND_LABELS } from '../editor/setup.js'
import { makeAiProvider } from '../editor/ai.js'
import { formatLuau, tidy } from '../editor/format.js'
import { setRunError } from '../editor/errorlens.js'
import { intel } from '../editor/luau-intel.js'
import * as vfs from './vfs.js'
import { app, runCommand, persistSession, command } from './app.js'
import { getSettings, setSettings, getMode, emit, on } from './store.js'
import { h, icon, fileIcon, toast, menu, onLongPress, confirmDialog, copyText, modal } from './ui.js'
import { renderMarkdown } from './markdown.js'
import { bpStore } from './debug-panel.js'

const MAX_WAIT = 4000 // 打ち続けていても、この間隔では必ず保存する

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
    this.lastHistory = new Map()
    this.saveState = 'saved'
    this.fixNoted = false
    this.build()
    on('files', () => this.renderTabs())
    on('mode', () => { this.reconfigureAll('mode'); this.relint(); this.renderBreadcrumb() })
    // require したモジュールの中身を補完に使う (開いているファイルは編集中の内容を優先)
    intel.moduleSource = name => {
      const re = new RegExp(`(^|/)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.server|\\.client)?\\.luau?$`)
      const init = new RegExp(`(^|/)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/init\\.luau?$`)
      for (const [path, doc] of this.docs) if (re.test(path) || init.test(path)) return doc.state.doc.toString()
      for (const [path, src] of app.contents) if (re.test(path) || init.test(path)) return src
      return null
    }
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
      // フォーカスが外れたらすぐ保存 (アプリを切り替える直前など)
      el.addEventListener('focusout', () => { if (getSettings().autoSave) this.saveAll(); setTimeout(() => this.syncFocus(), 0) })
      el.addEventListener('focusin', () => this.syncFocus())
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
      getMode,
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
        quickFix: () => this.quickFix(),
        command: (id, ...a) => runCommand(id, ...a),
      },
      onUpdate: u => this.onUpdate(doc, u),
      aiProvider: this.aiProvider || (this.aiProvider = makeAiProvider(getSettings, () => ({ lang: this.activeDoc() ? this.activeDoc().lang : 'text', name: this.active || '', mode: getMode() }))),
      onAiError: e => { if (!this.aiErrShown) { this.aiErrShown = true; toast('AI 候補: ' + e.message, { kind: 'error', duration: 5000 }); setTimeout(() => { this.aiErrShown = false }, 30000) } },
      onScale: size => {
        if (size === null) return getSettings().fontSize
        if (size !== getSettings().fontSize) setSettings({ fontSize: size })
        return size
      },
      // 自動修正したことを知らせる (元に戻せるように)
      onFix: (from, to, count) => {
        const view = this.activeView()
        const undoAction = { label: '元に戻す', run: () => { if (view) undo(view) } }
        if (from === null) toast(`貼り付けたコードの全角記号を ${count} か所、半角に直しました`, { icon: 'wand', action: undoAction, duration: 3500 })
        else if (from.length > 1 && /^[A-Za-z_]/.test(from)) toast(`${from} → ${to} に直しました`, { icon: 'wand', action: undoAction, duration: 2200 })
        else if (!this.fixNoted) { this.fixNoted = true; toast(`全角の記号を半角の ${to.trim() || 'スペース'} に直しました (設定でオフにできます)`, { icon: 'wand', duration: 3500 }) }
      },
      onLensTap: (view, diags, anchor) => this.diagMenu(view, diags, anchor),
      // デバッガー
      getBreakpoints: () => bpStore.get(doc.path),
      onBreakpoints: list => { bpStore.set(doc.path, list); if (app.runner) app.runner.debug.syncRun() },
      onBreakpointEdit: (line, anchor) => app.runner && app.runner.debug.editBp(doc.path, line, anchor),
      debugValue: expr => (app.runner ? app.runner.debugValue(expr) : null),
      isPaused: () => !!(app.runner && app.runner.debug.paused),
    }
  }

  // エディタに入力中かどうか (スマホではこの間だけキーボードバーを出す)
  syncFocus() {
    const a = document.activeElement
    document.body.classList.toggle('ed-focus', !!(a && a.closest && a.closest('.pane')))
  }

  has(path) { return this.docs.has(path) }
  activeDoc() { return this.active ? this.docs.get(this.active) : null }
  activeView() { return this.views[this.activePane] || this.views[0] || null }

  async open(path, { activate = true, cursor, scroll, line, pane } = {}) {
    let doc = this.docs.get(path)
    if (!doc) {
      const pid = app.project.id
      let content = app.contents.get(path)
      if (content === undefined) content = await vfs.readFile(pid, path)
      if (content === null || content === undefined) { toast(`"${path}" を開けません`, { kind: 'error' }); return null }
      doc = { path, lang: langOf(path), state: null, savedDoc: null, dirty: false, scroll: scroll || 0, saving: null, saveTimer: null, draftTimer: null, firstDirty: 0 }
      doc.ctx = this.ctxFor(doc)
      doc.state = createState(content, doc.ctx)
      doc.savedDoc = doc.state.doc
      // 保存が終わる前に閉じられた変更があれば復元する
      const draft = vfs.getDraft(pid, path)
      if (draft && typeof draft.c === 'string' && draft.c !== content) {
        doc.state = doc.state.update({ changes: { from: 0, to: content.length, insert: draft.c } }).state
        doc.dirty = true
        doc.firstDirty = Date.now()
        setTimeout(() => {
          toast(`"${vfs.basename(path)}" の保存されていなかった変更を復元しました`, { icon: 'history', duration: 6000, action: { label: '破棄', run: () => { this.replaceAll(doc, content); vfs.clearDraft(pid, path) } } })
          if (getSettings().autoSave) this.scheduleSave(doc)
          this.updateSaveState()
        }, 300)
      } else if (draft) vfs.clearDraft(pid, path)
      if (cursor !== undefined && cursor <= doc.state.doc.length) doc.state = doc.state.update({ selection: EditorSelection.cursor(cursor) }).state
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
    else if (prev !== path) view.setState(doc.state)
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
      if (wasDirty !== doc.dirty) { this.renderTabs(); this.updateSaveState() }
      if (doc.dirty) {
        this.scheduleDraft(doc)
        if (getSettings().autoSave) this.scheduleSave(doc)
      } else { doc.firstDirty = 0; clearTimeout(doc.saveTimer); if (app.project) vfs.clearDraft(app.project.id, doc.path) }
      emit('docchange', doc)
      if (this.preview && doc.path === this.active) this.schedulePreview()
    }
    if (u.selectionSet || u.docChanged) emit('cursor', doc, u.state)
  }

  // ---- 保存 ----
  scheduleSave(doc) {
    clearTimeout(doc.saveTimer)
    if (!doc.firstDirty) doc.firstDirty = Date.now()
    const wait = Date.now() - doc.firstDirty > MAX_WAIT ? 0 : (getSettings().autoSaveDelay || 600)
    doc.saveTimer = setTimeout(() => this.save(doc.path, { auto: true }), wait)
  }

  // 下書きを同期的に残す (IndexedDB への保存が終わる前にアプリが落ちても復元できる)
  scheduleDraft(doc) {
    if (doc.draftTimer) return
    doc.draftTimer = setTimeout(() => {
      doc.draftTimer = null
      if (doc.dirty && app.project && this.docs.get(doc.path) === doc) vfs.putDraft(app.project.id, doc.path, doc.state.doc.toString())
    }, 350)
  }

  // 画面が隠れる・閉じる直前に呼ぶ。未保存の内容をすべて下書きへ (同期処理)
  flushDrafts() {
    if (!app.project) return
    for (const doc of this.docs.values()) {
      clearTimeout(doc.draftTimer)
      doc.draftTimer = null
      if (doc.dirty) vfs.putDraft(app.project.id, doc.path, doc.state.doc.toString())
    }
  }

  updateSaveState() {
    let st = 'saved'
    for (const d of this.docs.values()) {
      if (d.saveError) { st = 'error'; break }
      if (d.saving) st = 'saving'
      else if (d.dirty && st === 'saved') st = 'dirty'
    }
    if (st !== this.saveState) { this.saveState = st; emit('saveState', st) }
  }

  viewFor(path) {
    const i = this.paneDocs.indexOf(path)
    return i >= 0 ? this.views[i] : null
  }

  save(path = this.active, { auto = false } = {}) {
    const doc = this.docs.get(path)
    if (!doc || !app.project) return Promise.resolve()
    clearTimeout(doc.saveTimer)
    if (doc.saving) { doc.saveAgain = true; return doc.saving }
    const s = getSettings()
    if (!auto && (s.formatOnSave || s.trimOnSave)) {
      const text = doc.state.doc.toString()
      let next = text
      try { if (s.formatOnSave && doc.lang === 'luau') next = formatLuau(next, indentStr()) } catch {}
      if (s.trimOnSave) next = next.replace(/[ \t]+$/gm, '')
      if (next !== text) this.replaceAll(doc, next)
    }
    if (auto && !doc.dirty) return Promise.resolve()
    const pid = app.project.id
    const snapshot = doc.state.doc
    const content = snapshot.toString()
    doc.saving = vfs.writeFile(pid, doc.path, content).then(() => {
      doc.savedDoc = snapshot
      doc.dirty = !doc.state.doc.eq(snapshot)
      doc.firstDirty = doc.dirty ? Date.now() : 0
      doc.saveError = null
      if (app.project && app.project.id === pid) app.contents.set(doc.path, content)
      if (!doc.dirty) vfs.clearDraft(pid, doc.path)
      // ローカル履歴 (自動保存は 1 分に 1 回まで)
      const last = this.lastHistory.get(doc.path) || 0
      if (!auto || Date.now() - last > 60000) {
        this.lastHistory.set(doc.path, Date.now())
        vfs.addHistory(pid, doc.path, content).catch(() => {})
      }
      if (!auto) toast('保存しました', { icon: 'check', duration: 1200 })
      if (!this.persistAsked) { this.persistAsked = true; if (!/Firefox/.test(navigator.userAgent)) vfs.requestPersist() }
      emit('saved', doc)
    }, e => {
      doc.saveError = e
      vfs.putDraft(pid, doc.path, content)
      if (!this.saveErrShown) {
        this.saveErrShown = true
        setTimeout(() => { this.saveErrShown = false }, 8000)
        toast('保存に失敗しました: ' + (e && e.message || e) + ' (内容は下書きとして残しています)', { kind: 'error', duration: 8000, action: { label: '再試行', run: () => this.save(doc.path) } })
      }
    }).finally(() => {
      doc.saving = null
      this.renderTabs()
      this.updateSaveState()
      if (this.docs.get(doc.path) === doc && ((doc.saveAgain && doc.dirty) || (doc.dirty && getSettings().autoSave && !doc.saveError))) this.scheduleSave(doc)
      doc.saveAgain = false
    })
    this.updateSaveState()
    return doc.saving
  }

  async saveAll() {
    const jobs = []
    for (const d of this.docs.values()) if (d.dirty) jobs.push(this.save(d.path, { auto: true }))
    await Promise.all(jobs)
  }

  anyDirty() { for (const d of this.docs.values()) if (d.dirty) return true; return false }

  replaceAll(doc, text) {
    const view = this.viewFor(doc.path)
    const spec = { changes: { from: 0, to: doc.state.doc.length, insert: text }, userEvent: 'input.format' }
    if (view) view.dispatch(spec)
    else {
      doc.state = doc.state.update(spec).state
      doc.dirty = !doc.state.doc.eq(doc.savedDoc)
    }
  }

  format() {
    const doc = this.activeDoc()
    if (!doc) return
    const text = doc.state.doc.toString()
    let next
    try {
      if (doc.lang === 'luau') next = formatLuau(text, indentStr()).replace(/[ \t]+$/gm, '')
      else if (doc.lang === 'json') next = JSON.stringify(JSON.parse(text), null, getSettings().insertSpaces ? getSettings().tabSize : '\t') + '\n'
      else next = tidy(text)
    } catch (e) {
      toast(e.message, { kind: 'error' })
      return
    }
    if (next !== text) {
      const view = this.viewFor(doc.path)
      // カーソルは同じ行の同じ文字へ
      const sel = doc.state.selection.main.head
      const line = doc.state.doc.lineAt(sel)
      const colFromText = sel - line.from - (/^[ \t]*/.exec(line.text)[0].length)
      this.replaceAll(doc, next)
      if (view) {
        const nl = view.state.doc.line(Math.min(view.state.doc.lines, line.number))
        const pos = Math.min(nl.to, nl.from + /^[ \t]*/.exec(nl.text)[0].length + Math.max(0, colFromText))
        view.dispatch({ selection: EditorSelection.cursor(pos) })
      }
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
          if (app.project) vfs.clearDraft(app.project.id, path)
        }
      }
    }
    this.forceClose(path)
    return true
  }

  forceClose(path) {
    const doc = this.docs.get(path)
    if (!doc) return
    clearTimeout(doc.saveTimer)
    clearTimeout(doc.draftTimer)
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
    this.updateSaveState()
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
    // 種類 (言語・サーバー/クライアント) が変わったら作り直す
    if (newLang !== doc.lang || scriptKindOf(from, 'studio') !== scriptKindOf(to, 'studio')) {
      doc.lang = newLang
      doc.ctx = this.ctxFor(doc)
      const dirty = doc.dirty
      doc.state = createState(text, doc.ctx).update({ selection: sel }).state
      if (!dirty) doc.savedDoc = doc.state.doc
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
    const view = this.viewFor(path)
    const spec = { changes: { from: 0, to: doc.state.doc.length, insert: content }, userEvent: 'input.format' }
    // 読み込み直しは「保存済み」の状態として扱う
    if (view) { doc.savedDoc = view.state.update(spec).state.doc; view.dispatch(spec) } else { doc.state = doc.state.update(spec).state; doc.savedDoc = doc.state.doc }
    doc.dirty = false
    this.renderTabs()
  }

  reconfigureAll(what = null) {
    for (const doc of this.docs.values()) {
      const effects = reconfigureEffects(doc.ctx, what)
      if (!effects.length) continue
      const v = this.viewFor(doc.path)
      if (v) v.dispatch({ effects })
      else doc.state = doc.state.update({ effects }).state
    }
  }

  // エラーチェックをすぐやり直す (モード切り替え後など)
  relint() {
    for (const v of this.views) if (v) { try { forceLinting(v) } catch {} }
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

  // ---- 実行時エラーの表示 ----
  markRunError(path, line, message) {
    const doc = this.docs.get(path)
    if (!doc || doc.lang !== 'luau') return
    const effects = setRunError.of({ line, message })
    const v = this.viewFor(path)
    if (v) v.dispatch({ effects })
    else doc.state = doc.state.update({ effects }).state
  }
  clearRunErrors() {
    for (const doc of this.docs.values()) {
      if (doc.lang !== 'luau') continue
      const effects = setRunError.of(null)
      const v = this.viewFor(doc.path)
      if (v) v.dispatch({ effects })
      else doc.state = doc.state.update({ effects }).state
    }
  }

  // ---- エラーの内容と修正候補のメニュー ----
  diagMenu(view, diags, anchor) {
    // 修正は現在の位置に対して行う (表示後に文書が変わっている場合があるため)
    const cur = []
    forEachDiagnostic(view.state, (d, from, to) => { if (diags.includes(d)) cur.push({ d, from, to }) })
    if (!cur.length) return
    const items = []
    const seen = new Set()
    cur.forEach(({ d, from, to }, i) => {
      if (i) items.push('-')
      items.push({ note: d.message, kind: d.severity, icon: d.severity === 'error' ? 'close' : d.severity === 'warning' ? 'alert' : 'info' })
      for (const a of d.actions || []) {
        // 「ファイル全体を〜」のような共通の修正は 1 回だけ出す
        if (/^ファイル全体/.test(a.name)) { if (seen.has(a.name)) continue; seen.add(a.name) }
        items.push({ label: a.name, icon: 'wand', run: () => { a.apply(view, from, to); view.focus() } })
      }
    })
    items.push('-', { label: 'メッセージをコピー', icon: 'copy', run: () => copyText(cur.map(c => c.d.message).join('\n')).then(() => toast('コピーしました')) })
    menu(items, anchor, { title: `${view.state.doc.lineAt(cur[0].from).number} 行目` })
  }

  // カーソルのある行の問題を表示 (⌘. / キーボードバーの電球)
  lineDiagnostics(view) {
    const out = []
    if (!view) return out
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    forEachDiagnostic(view.state, (d, from) => { if (d.severity !== 'hint' && from >= line.from && from <= line.to) out.push(d) })
    return out
  }
  quickFix() {
    const view = this.activeView()
    const diags = this.lineDiagnostics(view)
    if (!diags.length) { toast('この行に問題はありません', { duration: 1200 }); return }
    const c = view.coordsAtPos(view.state.selection.main.head)
    this.diagMenu(view, diags, c ? { getBoundingClientRect: () => ({ left: c.left, right: c.left, top: c.top, bottom: c.bottom }) } : null)
  }
  // 誤字・全角文字の修正候補をまとめて適用
  fixAllTypos() {
    const view = this.activeView()
    if (!view) return
    const list = []
    forEachDiagnostic(view.state, (d, from, to) => { if ((d.source === '誤字' || d.source === '全角') && d.actions && d.actions.length) list.push({ d, from, to }) })
    if (!list.length) { toast('直せる誤字は見つかりませんでした', { duration: 1500 }); return }
    // 後ろから順に直す (前の位置がずれないように)
    list.sort((a, b) => b.from - a.from)
    for (const { d, from, to } of list) { try { d.actions[0].apply(view, from, to) } catch {} }
    toast(`${list.length} か所を直しました`, { icon: 'wand', action: { label: '元に戻す', run: () => { for (let i = 0; i < list.length; i++) undo(view) } }, duration: 4000 })
    forceLinting(view)
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

  // ---- プレビュー (Markdown) ----
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
    const show = this.preview && doc && doc.lang === 'markdown'
    this.previewEl.classList.toggle('hidden', !show)
    this.panes.classList.toggle('with-preview', !!show)
    if (!show) return
    this.previewEl.textContent = ''
    const body = h('div', { class: 'md-body' })
    body.innerHTML = renderMarkdown(doc.state.doc.toString())
    this.previewEl.append(body)
  }

  // ---- タブ ----
  renderTabs() {
    const bar = this.tabbar
    bar.textContent = ''
    const names = new Map()
    for (const p of this.order) { const b = vfs.basename(p); names.set(b, (names.get(b) || 0) + 1) }
    const target = app.project && app.project.runTarget
    for (const path of this.order) {
      const doc = this.docs.get(path)
      const base = vfs.basename(path)
      const dir = vfs.dirname(path)
      const isActive = path === this.active
      const inOther = this.split && this.paneDocs.includes(path) && !isActive
      const tab = h('div', {
        class: 'tab' + (isActive ? ' active' : '') + (inOther ? ' visible' : '') + (doc.dirty ? ' dirty' : '') + (doc.saveError ? ' save-error' : ''), role: 'tab', 'aria-selected': isActive ? 'true' : 'false', draggable: 'true', title: path,
        onclick: () => this.activate(path),
      },
      fileIcon(path),
      h('span', { class: 'tab-name' }, base, names.get(base) > 1 && dir ? h('span', { class: 'tab-dir' }, ' ' + dir) : null),
      target === path ? h('span', { class: 'tab-pin', title: '▶ で実行するファイル' }, icon('play', 10)) : null,
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
      { label: 'ファイル一覧で表示', icon: 'files', run: () => runCommand('revealInExplorer', path) },
      { label: '履歴を表示', icon: 'history', run: () => runCommand('history', path) },
    ], anchor, { title: vfs.basename(path) })
  }

  renderBreadcrumb() {
    const doc = this.activeDoc()
    this.breadcrumb.textContent = ''
    if (!doc) return
    const parts = doc.path.split('/')
    parts.forEach((p, i) => {
      if (i) this.breadcrumb.append(icon('chevronRight', 12))
      this.breadcrumb.append(h('span', { class: i === parts.length - 1 ? 'crumb last' : 'crumb' }, p))
    })
    const kind = scriptKindOf(doc.path, getMode())
    this.breadcrumb.append(h('span', { class: 'crumb-lang' + (kind ? ' k-' + kind : '') }, kind ? KIND_LABELS[kind] : LANG_LABELS[doc.lang] || doc.lang))
  }

  renderEmpty() {
    this.empty.textContent = ''
    this.empty.append(
      h('div', { class: 'empty-logo' }, h('img', { src: 'icons/icon.svg', alt: '', width: '72', height: '72' })),
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
        h('div', null, h('kbd', null, '⌘/Ctrl + .'), ' エラーを修正')))
  }

  sessionData() {
    const tabs = this.order.map(p => {
      const d = this.docs.get(p)
      const v = this.viewFor(p)
      return { path: p, cursor: d.state.selection.main.head, scroll: v ? v.scrollDOM.scrollTop : d.scroll }
    })
    return { tabs, active: this.active }
  }
}

function indentStr() {
  const s = getSettings()
  return s.insertSpaces ? ' '.repeat(s.tabSize) : '\t'
}

command('quickFix', 'この行のエラーを修正', () => app.editors.quickFix(), { icon: 'wand', key: '⌘.' })
command('fixAllTypos', '誤字・全角記号をまとめて直す', () => app.editors.fixAllTypos(), { icon: 'wand' })

export { modal }
