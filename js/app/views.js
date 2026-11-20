// サイドバーのビュー: 検索 / アウトライン + 履歴・ヘルプのダイアログ
import * as vfs from './vfs.js'
import { app, command, writeProjectFile, refreshFiles } from './app.js'
import { on } from './store.js'
import { h, icon, fileIcon, modal, toast, relTime, confirmDialog, escapeHtml } from './ui.js'
import { outlineSymbols } from './palette.js'
import { EditorState, EditorView, unifiedMergeView } from '../../vendor/codemirror.js'
import { editorTheme } from '../editor/themes.js'
import { getSettings } from './store.js'

// ============================================================
// ファイル内検索・置換
// ============================================================
export class SearchView {
  constructor(root) {
    this.root = root
    this.opts = { regex: false, caseSensitive: false, word: false }
    this.build()
  }
  build() {
    const opt = (key, label, title) => {
      const b = h('button', { class: 'opt-btn', title, 'aria-pressed': 'false', onclick: () => { this.opts[key] = !this.opts[key]; b.classList.toggle('on', this.opts[key]); this.search() } }, label)
      return b
    }
    this.q = h('input', { class: 'input', placeholder: '検索', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
    this.r = h('input', { class: 'input', placeholder: '置換', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
    this.include = h('input', { class: 'input small', placeholder: '対象 (例: *.lua, src/)', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
    this.results = h('div', { class: 'search-results' })
    this.summary = h('div', { class: 'search-summary' })
    let t = null
    this.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.search(), 250) })
    this.q.addEventListener('keydown', e => { if (e.key === 'Enter') this.search() })
    this.include.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.search(), 300) })
    this.root.append(
      h('div', { class: 'side-head' }, h('div', { class: 'side-title' }, '検索')),
      h('div', { class: 'search-form' },
        h('div', { class: 'input-row' }, this.q, opt('caseSensitive', 'Aa', '大文字と小文字を区別'), opt('word', 'ab', '単語単位'), opt('regex', '.*', '正規表現')),
        h('div', { class: 'input-row' }, this.r, h('button', { class: 'btn small', onclick: () => this.replaceAll() }, 'すべて置換')),
        this.include),
      this.summary, this.results)
  }
  focus() { setTimeout(() => this.q.focus(), 50) }
  regex() {
    const q = this.q.value
    if (!q) return null
    let src = this.opts.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (this.opts.word) src = `\\b${src}\\b`
    try { return new RegExp(src, 'g' + (this.opts.caseSensitive ? '' : 'i')) } catch { return null }
  }
  async search() {
    const re = this.regex()
    this.results.innerHTML = ''
    this.summary.textContent = ''
    if (!re || !app.project) return
    const filter = this.include.value.trim()
    const pats = filter ? filter.split(',').map(s => s.trim()).filter(Boolean).map(p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + (p.endsWith('/') ? '' : '$'))) : null
    const all = await vfs.readAll(app.project.id)
    let total = 0, nfiles = 0
    for (const f of all.sort((a, b) => a.path.localeCompare(b.path))) {
      if (f.dir) continue
      if (pats && !pats.some(p => p.test(f.path) || p.test(f.path.split('/').pop()) || f.path.startsWith(p.source.slice(1).replace(/\\/g, '')))) continue
      const doc = app.editors.docs.get(f.path)
      const text = doc ? doc.state.doc.toString() : (f.content || '')
      if (typeof text !== 'string') continue
      const lines = text.split('\n')
      const hits = []
      lines.forEach((line, i) => {
        re.lastIndex = 0
        let m
        while ((m = re.exec(line))) {
          hits.push({ line: i + 1, col: m.index, len: m[0].length || 1, text: line })
          if (!m[0].length) re.lastIndex++
          if (hits.length > 500) break
        }
      })
      if (!hits.length) continue
      nfiles++
      total += hits.length
      const group = h('div', { class: 'sr-group' })
      group.append(h('div', { class: 'sr-file' }, fileIcon(f.path), h('span', null, f.path), h('span', { class: 'badge' }, hits.length)))
      for (const hit of hits.slice(0, 100)) {
        const pre = hit.text.slice(Math.max(0, hit.col - 30), hit.col)
        const mid = hit.text.slice(hit.col, hit.col + hit.len)
        const post = hit.text.slice(hit.col + hit.len, hit.col + hit.len + 60)
        const row = h('button', { class: 'sr-hit', onclick: () => app.editors.open(f.path, { line: hit.line }).then(() => app.editors.gotoLine(hit.line, hit.col + 1)) },
          h('span', { class: 'sr-ln' }, hit.line))
        const txt = h('span', { class: 'sr-text' })
        txt.innerHTML = escapeHtml(pre.trimStart()) + '<mark>' + escapeHtml(mid) + '</mark>' + escapeHtml(post)
        row.append(txt)
        group.append(row)
      }
      this.results.append(group)
      if (total > 5000) break
    }
    this.summary.textContent = total ? `${nfiles} ファイル / ${total} 件` : '見つかりません'
  }
  async replaceAll() {
    const re = this.regex()
    if (!re) return
    const rep = this.r.value
    const all = await vfs.readAll(app.project.id)
    const targets = []
    for (const f of all) {
      if (f.dir) continue
      const doc = app.editors.docs.get(f.path)
      const text = doc ? doc.state.doc.toString() : (f.content || '')
      if (typeof text !== 'string') continue
      re.lastIndex = 0
      if (re.test(text)) targets.push({ f, text, doc })
    }
    if (!targets.length) return
    if (!(await confirmDialog('すべて置換', `${targets.length} 個のファイルで置換します。よろしいですか?`, { okLabel: '置換' }))) return
    for (const { f, text, doc } of targets) {
      re.lastIndex = 0
      const next = text.replace(re, rep)
      if (doc) app.editors.replaceAll(doc, next)
      else await writeProjectFile(f.path, next, { reload: false })
    }
    await app.editors.saveAll()
    await refreshFiles()
    toast('置換しました')
    this.search()
  }
}

// ============================================================
// アウトライン
// ============================================================
export class OutlineView {
  constructor(root) {
    this.root = root
    this.list = h('div', { class: 'outline-list' })
    this.root.append(h('div', { class: 'side-head' }, h('div', { class: 'side-title' }, 'アウトライン')), this.list)
    let t = null
    // 見えていないときは作り直さない (表示したときに作る)
    const visible = () => (this.root.checkVisibility ? this.root.checkVisibility() : this.root.offsetParent !== null)
    const sched = () => { clearTimeout(t); t = setTimeout(() => { if (visible()) this.render() }, 400) }
    on('active', sched)
    on('docchange', sched)
  }
  render() {
    this.list.innerHTML = ''
    const doc = app.editors && app.editors.activeDoc()
    if (!doc) { this.list.append(h('div', { class: 'tree-empty' }, 'ファイルを開いてください')); return }
    const syms = outlineSymbols(doc.state.doc.toString(), doc.lang)
    if (!syms.length) { this.list.append(h('div', { class: 'tree-empty' }, '関数や変数が見つかりません')); return }
    const KIND_ICON = { '関数': 'ƒ', 'メソッド': 'ƒ', '変数': 'x', '定数': 'K', '見出し': '#', 'クラス': 'C' }
    for (const s of syms) {
      this.list.append(h('button', { class: 'outline-item', style: { paddingLeft: 10 + s.depth * 14 + 'px' }, onclick: () => app.editors.gotoLine(s.line) },
        h('span', { class: 'ol-kind k-' + s.kind }, KIND_ICON[s.kind] || '•'), h('span', { class: 'ol-name' }, s.name), h('span', { class: 'ol-line' }, s.line)))
    }
  }
}

// ============================================================
// ローカル履歴
// ============================================================
export async function showHistory(path) {
  path = path || app.editors.active
  if (!path) return
  const list = await vfs.getHistory(app.project.id, path)
  const body = h('div', { class: 'history' })
  const m = modal({ title: `履歴: ${path.split('/').pop()}`, body, wide: true })
  if (!list.length) { body.append(h('div', { class: 'tree-empty' }, 'まだ履歴がありません。保存するたびに自動で記録されます。')); return }
  const listEl = h('div', { class: 'history-list' })
  const diffEl = h('div', { class: 'history-diff' })
  body.append(listEl, diffEl)
  const current = () => { const d = app.editors.docs.get(path); return d ? d.state.doc.toString() : null }
  let view = null
  const select = async (rec, row) => {
    listEl.querySelectorAll('.history-item').forEach(r => r.classList.remove('active'))
    row.classList.add('active')
    diffEl.innerHTML = ''
    const cur = current() ?? (await vfs.readFile(app.project.id, path)) ?? ''
    const s = getSettings()
    if (view) view.destroy()
    view = new EditorView({
      parent: diffEl,
      state: EditorState.create({
        doc: cur,
        extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false), editorTheme(s.theme, s.fontFamily, Math.max(11, s.fontSize - 2), 1.45), unifiedMergeView({ original: rec.content, mergeControls: false, highlightChanges: true, gutter: true })],
      }),
    })
    diffEl.prepend(h('div', { class: 'history-actions' },
      h('span', { class: 'label' }, '赤 = この版 / 緑 = 現在'),
      h('button', { class: 'btn small primary', onclick: async () => {
        if (!(await confirmDialog('この版に戻す', `${new Date(rec.time).toLocaleString('ja-JP')} の内容に戻しますか? (現在の内容も履歴に残ります)`, { okLabel: '戻す' }))) return
        await vfs.addHistory(app.project.id, path, cur)
        const doc = app.editors.docs.get(path)
        if (doc) { app.editors.replaceAll(doc, rec.content); await app.editors.save(path) }
        else await writeProjectFile(path, rec.content)
        toast('復元しました')
        m.close()
      } }, icon('history', 16), 'この版に戻す')))
  }
  list.forEach((rec, i) => {
    const row = h('button', { class: 'history-item', onclick: () => select(rec, row) }, h('span', null, new Date(rec.time).toLocaleString('ja-JP')), h('span', { class: 'pr-meta' }, relTime(rec.time) + ' ・ ' + rec.content.split('\n').length + ' 行'))
    listEl.append(row)
    if (i === 0) setTimeout(() => select(rec, row), 0)
  })
}

command('history', 'ファイルの履歴を表示', p => showHistory(typeof p === 'string' ? p : undefined), { icon: 'history' })
// 使い方・新機能の文章は大きいので、開いたときに読み込む (help.js)
command('help', '使い方を表示', section => import('./help.js').then(m => m.showHelp(section)), { icon: 'book' })
command('whatsNew', '新機能を表示', () => import('./help.js').then(m => m.showWhatsNew()), { icon: 'sparkle' })
