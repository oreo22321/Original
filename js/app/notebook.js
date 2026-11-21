// ノートブック (.ipynb): Jupyter と同じ形のファイルを、セルごとに書いて・実行して・結果 (文字・表・図・エラー) を下に出す
// ・実行は Python の「ノートブックごとの名前空間」(nb:<パス>) で。変数はセルをまたいで残る (カーネルの再起動で消える)
// ・保存は nbformat 4 (Jupyter・VS Code・Google Colab で開ける)
import { app, writeProjectFile } from './app.js'
import { getSettings } from './store.js'
import { h, icon, toast, confirmDialog, menu } from './ui.js'
import * as vfs from './vfs.js'
import { safeHtml } from './runner.js'
import { renderMarkdown } from './markdown.js'
import { AnsiState, appendAnsi } from './ansi.js'
import { EditorView, EditorState, keymap, history, historyKeymap, defaultKeymap, indentWithTab, closeBrackets, closeBracketsKeymap, bracketMatching, indentOnInput, indentUnit, placeholder } from '../../vendor/codemirror.js'
import { pythonLanguage } from '../editor/python.js'
import { editorTheme } from '../editor/themes.js'
import { markdownLanguage } from '../editor/langs.js'

const uid = () => Math.random().toString(16).slice(2, 10)
const srcText = s => (Array.isArray(s) ? s.join('') : String(s || ''))
const lines = text => { const ls = text.split('\n'); return ls.map((l, i) => (i < ls.length - 1 ? l + '\n' : l)).filter((l, i, a) => !(i === a.length - 1 && l === '')) }

export const EMPTY_NOTEBOOK = () => JSON.stringify({
  cells: [
    { cell_type: 'markdown', id: uid(), metadata: {}, source: ['# ノートブック\n', '\n', 'セルに Python を書いて ▶ (Shift + Enter) で実行します。変数は次のセルでも使えます。'] },
    { cell_type: 'code', id: uid(), execution_count: null, metadata: {}, outputs: [], source: ['x = 21\n', 'x * 2'] },
  ],
  metadata: { kernelspec: { display_name: 'Python 3 (ForgeCode)', language: 'python', name: 'python3' }, language_info: { name: 'python' } },
  nbformat: 4, nbformat_minor: 5,
}, null, 1) + '\n'

let current = null
export const notebookBusy = () => !!(current && current.running)

export async function openNotebook(path) {
  if (current && current.path === path) { current.show(); return current }
  if (current) current.close()
  let text = app.contents.get(path)
  if (text === undefined) text = await vfs.readFile(app.project.id, path)
  if (text instanceof Uint8Array) text = new TextDecoder().decode(text)
  let nb
  try { nb = JSON.parse(text || '{}') } catch (e) { toast('ノートブックを読めませんでした (JSON の形が正しくありません): ' + e.message, { kind: 'error', duration: 7000 }); return null }
  if (!Array.isArray(nb.cells)) nb.cells = []
  current = new NotebookView(path, nb)
  app.notebook = { busy: notebookBusy, view: current }
  return current
}

class NotebookView {
  constructor(path, nb) {
    this.path = path
    this.nb = nb
    this.count = 0
    this.running = false
    this.queue = []
    this.cells = nb.cells.map(c => this.makeCell(c))
    if (!this.cells.length) this.cells.push(this.makeCell({ cell_type: 'code', source: '', outputs: [] }))
    this.build()
    this.render()
    this.show()
  }
  get ns() { return 'nb:' + this.path }
  dir() { return this.path.includes('/') ? this.path.slice(0, this.path.lastIndexOf('/')) : '' }

  makeCell(c) {
    return { type: c.cell_type === 'markdown' ? 'markdown' : c.cell_type === 'raw' ? 'raw' : 'code', id: c.id || uid(), source: srcText(c.source), outputs: c.outputs || [], count: c.execution_count ?? null, meta: c.metadata || {}, editing: false, el: null, view: null, outEl: null }
  }

  build() {
    const b = (ic, label, fn, cls = '') => h('button', { class: 'icon-btn sm ' + cls, title: label, 'aria-label': label, onclick: fn }, icon(ic, 17))
    this.runAllBtn = h('button', { class: 'btn small primary', onclick: () => this.runAll() }, icon('play', 13), h('span', null, 'すべて実行'))
    this.stopBtn = b('stop', '止める', () => app.runner.interruptEval(), 'hidden')
    this.state = h('span', { class: 'nb-state' })
    this.list = h('div', { class: 'nb-cells' })
    this.el = h('div', { class: 'nb' },
      h('div', { class: 'nb-bar' },
        h('button', { class: 'btn small ghost', onclick: () => this.close() }, icon('chevronLeft', 16), h('span', null, '戻る')),
        h('div', { class: 'nb-title' }, icon('notebook', 15), h('span', null, this.path.split('/').pop())),
        this.state, this.stopBtn, this.runAllBtn,
        b('more', 'その他', e => this.moreMenu(e.currentTarget))),
      this.list)
    this.onKey = e => {
      if (this.el.classList.contains('hidden')) return
      if (e.key === 'Escape' && !e.target.closest('.cm-editor') && !document.querySelector('.modal-overlay, .menu-overlay')) this.close()
    }
    addEventListener('keydown', this.onKey)
    document.body.append(this.el)
  }
  show() { this.el.classList.remove('hidden'); document.body.classList.add('nb-open') }
  close() {
    this.flush()
    this.el.classList.add('hidden')
    document.body.classList.remove('nb-open')
  }
  setState(text) { this.state.textContent = text || '' }

  moreMenu(anchor) {
    menu([
      { label: 'カーネルを再起動 (変数を消す)', icon: 'refresh', run: () => this.restart() },
      { label: '再起動してすべて実行', icon: 'play', run: async () => { await this.restart(); this.runAll() } },
      { label: '出力をすべて消す', icon: 'trash', run: () => { for (const c of this.cells) { c.outputs = []; c.count = null } this.render(); this.changed() } },
      '-',
      { label: 'コードのセルを最後に追加', icon: 'plus', run: () => this.insert(this.cells.length, 'code') },
      { label: 'Markdown のセルを最後に追加', icon: 'text', run: () => this.insert(this.cells.length, 'markdown') },
      '-',
      { label: 'Python のファイルに書き出す', icon: 'download', run: () => this.exportPy() },
      { label: 'JSON のまま開く', icon: 'braces', run: () => { this.close(); app.editors.open(this.path, { raw: true }) } },
    ], anchor)
  }

  // ---- 描く ----
  render() {
    this.list.replaceChildren(...this.cells.flatMap((c, i) => [this.renderCell(c, i)]), this.adder(this.cells.length))
  }
  adder(index) {
    return h('div', { class: 'nb-add' },
      h('button', { class: 'btn small ghost', onclick: () => this.insert(index, 'code') }, icon('plus', 13), 'コード'),
      h('button', { class: 'btn small ghost', onclick: () => this.insert(index, 'markdown') }, icon('plus', 13), 'Markdown'))
  }
  renderCell(c, i) {
    const tools = h('div', { class: 'nb-tools' },
      h('button', { class: 'icon-btn xs', title: '上へ', 'aria-label': '上へ', onclick: () => this.move(c, -1), disabled: i === 0 }, icon('arrowUp', 14)),
      h('button', { class: 'icon-btn xs', title: '下へ', 'aria-label': '下へ', onclick: () => this.move(c, 1), disabled: i === this.cells.length - 1 }, icon('arrowDown', 14)),
      h('button', { class: 'icon-btn xs', title: c.type === 'code' ? 'Markdown にする' : 'コードにする', 'aria-label': '種類を変える', onclick: () => this.toggleType(c) }, icon(c.type === 'code' ? 'text' : 'braces', 14)),
      h('button', { class: 'icon-btn xs', title: '下にセルを追加', 'aria-label': '下にセルを追加', onclick: () => this.insert(this.cells.indexOf(c) + 1, c.type === 'markdown' ? 'markdown' : 'code') }, icon('plus', 14)),
      h('button', { class: 'icon-btn xs', title: 'セルを消す', 'aria-label': 'セルを消す', onclick: () => this.remove(c) }, icon('trash', 14)))
    let el
    if (c.type === 'code') {
      const runBtn = h('button', { class: 'nb-run', title: '実行 (Shift + Enter)', 'aria-label': 'このセルを実行', onclick: () => this.runCell(c) }, c.running ? h('span', { class: 'spinner' }) : icon('play', 14))
      c.outEl = h('div', { class: 'nb-out' })
      el = h('div', { class: 'nb-cell code' + (c.running ? ' running' : '') + (c.queued ? ' queued' : '') },
        h('div', { class: 'nb-gutter' }, runBtn, h('span', { class: 'nb-count' }, c.running ? '[*]' : c.queued ? '[ ]' : c.count ? `[${c.count}]` : '')),
        h('div', { class: 'nb-main' }, this.editorFor(c), c.outEl), tools)
      this.paintOutputs(c)
    } else if (c.editing || !c.source.trim()) {
      el = h('div', { class: 'nb-cell md editing' }, h('div', { class: 'nb-gutter' }, h('button', { class: 'nb-run', title: '表示 (Shift + Enter)', 'aria-label': '表示', onclick: () => { c.editing = false; this.render() } }, icon('check', 14))), h('div', { class: 'nb-main' }, this.editorFor(c)), tools)
    } else {
      const view = h('div', { class: 'nb-md md-preview' })
      try { view.innerHTML = renderMarkdown(c.source) } catch { view.textContent = c.source }
      el = h('div', { class: 'nb-cell md', ondblclick: () => this.editMd(c) }, h('div', { class: 'nb-gutter' }, h('button', { class: 'nb-run ghost', title: '書き直す', 'aria-label': '書き直す', onclick: () => this.editMd(c) }, icon('edit', 13))), h('div', { class: 'nb-main' }, view), tools)
    }
    c.el = el
    return el
  }
  editMd(c) { c.editing = true; this.render(); setTimeout(() => c.view && c.view.focus(), 30) }

  editorFor(c) {
    if (c.view && c.viewType === c.type) return c.view.dom
    const s = getSettings()
    const runKeys = keymap.of([
      { key: 'Shift-Enter', run: () => { this.runAndNext(c); return true }, preventDefault: true },
      { key: 'Mod-Enter', run: () => { if (c.type === 'code') this.runCell(c); else { c.editing = false; this.render() } return true }, preventDefault: true },
      { key: 'Alt-Enter', run: () => { this.runCell(c); this.insert(this.cells.indexOf(c) + 1, 'code'); return true }, preventDefault: true },
      { key: 'Mod-s', run: () => { this.flush(); toast('保存しました'); return true }, preventDefault: true },
    ])
    const ext = [
      runKeys, history(), indentOnInput(), bracketMatching(), closeBrackets(), indentUnit.of(' '.repeat(s.tabSize || 4)),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      editorTheme(s.theme, s.fontFamily, s.fontSize, s.lineHeight),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off' }),
      placeholder(c.type === 'code' ? 'Python のコード' : '# 見出し・文章 (Markdown)'),
      EditorView.updateListener.of(u => { if (u.docChanged) { c.source = u.state.doc.toString(); this.changed() } }),
      c.type === 'code' ? pythonLanguage() : markdownLanguage,
    ]
    if (c.view && c.viewType === c.type) return c.view.dom   // 描き直しでも同じエディタを使う (カーソル・入力中の文字を残す)
    if (c.view) c.view.destroy()
    c.viewType = c.type
    c.view = new EditorView({ state: EditorState.create({ doc: c.source, extensions: ext }) })
    c.view.dom.classList.add('nb-editor')
    return c.view.dom
  }

  // ---- 出力 ----
  paintOutputs(c) {
    if (!c.outEl) return
    c.outEl.replaceChildren(...c.outputs.map(o => this.renderOutput(o)).filter(Boolean))
    if (c.inputEl) c.outEl.append(c.inputEl)
    c.outEl.classList.toggle('empty', !c.outEl.childElementCount)
  }
  renderOutput(o) {
    const data = o.data || {}
    if (o.output_type === 'stream') {
      const el = h('pre', { class: 'nb-stream' + (o.name === 'stderr' ? ' err' : '') })
      appendAnsi(el, srcText(o.text), new AnsiState())
      return el
    }
    if (o.output_type === 'error') {
      const el = h('pre', { class: 'nb-stream err' })
      appendAnsi(el, (o.traceback || []).join('\n') || `${o.ename}: ${o.evalue}`, new AnsiState())
      return el
    }
    for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml']) {
      if (data[mime]) {
        const raw = srcText(data[mime])
        const src = mime === 'image/svg+xml' ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(raw) : `data:${mime};base64,${raw.replace(/\s+/g, '')}`
        return h('img', { class: 'nb-img', src, alt: '図' })
      }
    }
    if (data['text/html']) {
      try { return h('div', { class: 'nb-html out-html' }, safeHtml(srcText(data['text/html']))) } catch {}
    }
    if (data['text/markdown']) { try { const el = h('div', { class: 'nb-md md-preview' }); el.innerHTML = renderMarkdown(srcText(data['text/markdown'])); return el } catch {} }
    if (data['text/plain'] !== undefined) return h('pre', { class: 'nb-stream result' }, srcText(data['text/plain']))
    return null
  }

  // ---- 実行 ----
  async runAndNext(c) {
    const i = this.cells.indexOf(c)
    if (c.type === 'code') this.runCell(c)
    else { c.editing = false; this.render() }
    let next = this.cells[i + 1]
    if (!next) { this.insert(i + 1, 'code'); return }
    if (next.type !== 'code' || !next.view) { if (next.type === 'markdown' && !next.source.trim()) next.view && next.view.focus(); return }
    setTimeout(() => next.view && next.view.focus(), 30)
  }
  runCell(c) {
    if (c.type !== 'code') return Promise.resolve(true)
    if (c.running || c.queued) return c.promise
    c.queued = true
    this.paintCell(c)
    c.promise = new Promise(resolve => { this.queue.push({ c, resolve }) })
    this.pump()
    return c.promise
  }
  async runAll() {
    for (const c of this.cells) if (c.type === 'code') { const ok = await this.runCell(c); if (!ok) { for (const q of this.queue) { q.c.queued = false; q.resolve(false) } this.queue = []; this.render(); break } }
  }
  paintCell(c) { const old = c.el; if (!old) return; const fresh = this.renderCell(c, this.cells.indexOf(c)); if (old.isConnected) old.replaceWith(fresh) }
  async pump() {
    if (this.running) return
    const item = this.queue.shift()
    if (!item) { this.setState(''); this.stopBtn.classList.add('hidden'); return }
    const { c, resolve } = item
    const r = app.runner
    if (r.running) { toast('ほかのプログラムが実行中です (止めてから)'); c.queued = false; this.paintCell(c); resolve(false); for (const q of this.queue) { q.c.queued = false; q.resolve(false) } this.queue = []; this.render(); return }
    this.running = true
    c.queued = false
    c.running = true
    c.outputs = []
    c.inputEl = null
    this.stopBtn.classList.remove('hidden')
    this.setState('実行中…')
    // セルの編集を残したまま、出力だけ描き直す
    const gutter = c.el && c.el.querySelector('.nb-gutter')
    if (gutter) { gutter.querySelector('.nb-run').replaceChildren(h('span', { class: 'spinner' })); gutter.querySelector('.nb-count').textContent = '[*]' }
    c.el && c.el.classList.add('running')
    this.paintOutputs(c)
    let paintTimer = 0
    const repaint = () => { if (!paintTimer) paintTimer = setTimeout(() => { paintTimer = 0; this.paintOutputs(c) }, 50) }
    const stream = (name, text) => {
      const last = c.outputs[c.outputs.length - 1]
      if (last && last.output_type === 'stream' && last.name === name) last.text = srcText(last.text) + text
      else c.outputs.push({ output_type: 'stream', name, text })
      repaint()
    }
    const imgKeys = new Map()
    const view = this
    const sink = {
      finished: false,
      output(items) {
        for (const it of items) {
          if (it.kind === 'meta' || it.kind === 'log') { view.setState(it.text.slice(0, 60)); continue }
          const name = it.kind === 'err' || it.kind === 'error' || it.kind === 'error-text' || it.kind === 'warn' ? 'stderr' : 'stdout'
          stream(name, it.text + (it.partial ? '' : '\n'))
        }
      },
      block(m) {
        let o = null
        if (m.type === 'image') o = { output_type: 'display_data', data: { [m.mime || 'image/png']: m.data, 'text/plain': '<Figure>' }, metadata: {} }
        else if (m.type === 'html') o = { output_type: 'display_data', data: { 'text/html': m.html, 'text/plain': m.text || '' }, metadata: {} }
        else if (m.type === 'link') o = { output_type: 'display_data', data: { 'text/plain': m.url }, metadata: {} }
        if (!o) return
        if (m.key && imgKeys.has(m.key)) c.outputs[imgKeys.get(m.key)] = o
        else { if (m.key) imgKeys.set(m.key, c.outputs.length); c.outputs.push(o) }
        repaint()
      },
      input(password) {
        const field = h('input', { class: 'input nb-input', type: password ? 'password' : 'text', placeholder: '入力して Enter', onkeydown: e => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          const v = field.value
          if (!password) stream('stdout', v + '\n')
          c.inputEl = null
          r.sendInput(v)
          view.paintOutputs(c)
        } })
        c.inputEl = h('div', { class: 'nb-input-row' }, icon('keyboard', 15), field)
        view.paintOutputs(c)
        setTimeout(() => field.focus(), 30)
      },
      inputDone() { c.inputEl = null; view.paintOutputs(c) },
      visual() { stream('stderr', '(ゲーム・アニメーションの画面は実行画面に出しています)\n') },
      note(text) { view.setState(text) },
      done() {},
    }
    if (app.editors) await app.editors.saveAll().catch(() => {})
    const { files, keep } = r.filesPayload()
    const res = await r.termEval(c.source, { ns: this.ns, sink, files, keep, cwd: this.dir() })
    clearTimeout(paintTimer)
    let ok = !!res.ok
    if (res.busy) { stream('stderr', res.error + '\n'); ok = false }
    else if (res.ok) {
      c.count = ++this.count
      if (res.value !== null && res.value !== undefined) c.outputs.push({ output_type: 'execute_result', execution_count: c.count, data: { 'text/plain': res.value, ...(res.html ? { 'text/html': res.html } : {}) }, metadata: {} })
    } else {
      c.count = ++this.count
      const ename = res.etype || 'Error'
      c.outputs.push({ output_type: 'error', ename, evalue: String(res.error || '').split('\n').pop(), traceback: String(res.error || '').split('\n') })
    }
    if (res.files && Object.keys(res.files).length) r.applyFiles(res.files)
    c.running = false
    c.inputEl = null
    this.running = false
    this.paintCell(c)
    this.changed()
    resolve(ok)
    this.pump()
  }
  async restart() {
    if (this.running) app.runner.interruptEval()
    for (const q of this.queue) { q.c.queued = false; q.resolve(false) }
    this.queue = []
    const r = app.runner
    await r.termEval('None', { ns: 'nb-new:' + this.path })
    this.count = 0
    for (const c of this.cells) c.count = null
    this.render()
    toast('カーネルを再起動しました (変数を消しました)', { icon: 'refresh' })
  }

  // ---- 編集 ----
  insert(index, type) {
    const c = this.makeCell({ cell_type: type, source: '', outputs: [] })
    if (type === 'markdown') c.editing = true
    this.cells.splice(index, 0, c)
    this.render()
    this.changed()
    setTimeout(() => { c.view && c.view.focus(); c.el && c.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, 30)
  }
  async remove(c) {
    if (c.source.trim() && !(await confirmDialog('このセルを消しますか?', c.source.split('\n')[0].slice(0, 60), { okLabel: '消す', danger: true }))) return
    this.cells.splice(this.cells.indexOf(c), 1)
    if (c.view) c.view.destroy()
    if (!this.cells.length) this.cells.push(this.makeCell({ cell_type: 'code', source: '', outputs: [] }))
    this.render()
    this.changed()
  }
  move(c, d) {
    const i = this.cells.indexOf(c), j = i + d
    if (j < 0 || j >= this.cells.length) return
    this.cells.splice(i, 1)
    this.cells.splice(j, 0, c)
    this.render()
    this.changed()
  }
  toggleType(c) {
    c.type = c.type === 'code' ? 'markdown' : 'code'
    c.outputs = []
    c.count = null
    c.editing = c.type === 'markdown'
    this.render()
    this.changed()
  }

  // ---- 保存 ----
  toJSON() {
    const meta = this.nb.metadata || {}
    if (!meta.kernelspec) meta.kernelspec = { display_name: 'Python 3 (ForgeCode)', language: 'python', name: 'python3' }
    if (!meta.language_info) meta.language_info = { name: 'python' }
    return {
      cells: this.cells.map(c => c.type === 'code'
        ? { cell_type: 'code', execution_count: c.count, id: c.id, metadata: c.meta, outputs: c.outputs.map(o => (o.output_type === 'stream' ? { ...o, text: lines(srcText(o.text)) } : o)), source: lines(c.source) }
        : { cell_type: c.type, id: c.id, metadata: c.meta, source: lines(c.source) }),
      metadata: meta, nbformat: 4, nbformat_minor: Math.max(5, this.nb.nbformat_minor || 0),
    }
  }
  changed() {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 700)
  }
  flush() {
    clearTimeout(this.saveTimer)
    const text = JSON.stringify(this.toJSON(), null, 1) + '\n'
    if (text === this.saved) return
    this.saved = text
    writeProjectFile(this.path, text, { reload: false }).catch(e => toast('保存できませんでした: ' + e.message, { kind: 'error' }))
  }
  async exportPy() {
    const out = []
    for (const c of this.cells) {
      if (c.type === 'code') out.push('# %%', c.source, '')
      else out.push('# %% [markdown]', ...c.source.split('\n').map(l => '# ' + l), '')
    }
    const path = this.path.replace(/\.ipynb$/, '.py')
    const { newFile } = await import('./app.js')
    if (app.files.some(f => f.path === path)) { await writeProjectFile(path, out.join('\n')); toast(`${path} に書き出しました`) }
    else { await newFile(path, out.join('\n')); toast(`${path} を作りました`) }
  }
}
