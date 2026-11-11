// コマンドパレット / ファイル検索 (Quick Open) / 行へ移動
import { app, command, runCommand } from './app.js'
import { h, icon, fileIcon, fuzzyScore, promptDialog } from './ui.js'

function openPicker({ placeholder, items, onPick, prefix = '', render }) {
  const overlay = h('div', { class: 'palette-overlay' })
  const input = h('input', { class: 'palette-input', placeholder, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', value: prefix })
  const list = h('div', { class: 'palette-list', role: 'listbox' })
  const box = h('div', { class: 'palette' }, input, list)
  overlay.append(box)
  document.body.append(overlay)
  let sel = 0
  let shown = []
  const close = () => { overlay.remove() }
  const update = () => {
    const q = input.value.trim()
    const res = typeof items === 'function' ? items(q) : items.map(it => ({ it, score: fuzzyScore(q, it.label + ' ' + (it.detail || '')) })).filter(x => x.score >= 0).sort((a, b) => b.score - a.score).slice(0, 80).map(x => x.it)
    shown = res
    sel = Math.min(sel, Math.max(0, res.length - 1))
    list.innerHTML = ''
    res.forEach((it, i) => {
      const row = h('div', { class: 'palette-item' + (i === sel ? ' sel' : ''), role: 'option', onmousedown: e => { e.preventDefault(); pick(i) } },
        render ? render(it) : [it.icon ? (typeof it.icon === 'string' ? icon(it.icon, 16) : it.icon) : h('span', { class: 'ico-space' }), h('span', { class: 'pi-label' }, it.label), it.detail ? h('span', { class: 'pi-detail' }, it.detail) : null, it.key ? h('kbd', null, it.key) : null])
      list.append(row)
    })
    if (!res.length) list.append(h('div', { class: 'palette-empty' }, '見つかりません'))
    const s = list.children[sel]
    if (s && s.scrollIntoView) s.scrollIntoView({ block: 'nearest' })
  }
  const pick = i => {
    const it = shown[i]
    if (!it) return
    close()
    onPick(it, input.value)
  }
  input.addEventListener('input', () => { sel = 0; update() })
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + 1); update(); e.preventDefault() }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); update(); e.preventDefault() }
    else if (e.key === 'Enter') { pick(sel); e.preventDefault() }
    else if (e.key === 'Escape') { close(); e.preventDefault(); app.editors.focus() }
  })
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close() })
  update()
  setTimeout(() => input.focus(), 30)
  return { close, input }
}

export function quickOpen(prefix = '') {
  const files = app.files.filter(f => !f.dir)
  const recent = app.editors ? [...app.editors.order].reverse() : []
  openPicker({
    placeholder: 'ファイル名で検索 ( > でコマンド, : で行へ移動 )',
    prefix,
    items: q => {
      if (q.startsWith('>')) return commandItems(q.slice(1).trim())
      if (q.startsWith(':')) {
        const n = parseInt(q.slice(1), 10)
        return [{ label: isNaN(n) ? '行番号を入力してください' : `${n} 行目へ移動`, line: n }]
      }
      if (q.startsWith('@')) return symbolItems(q.slice(1).trim())
      if (!q) return [...recent.map(p => ({ label: p.split('/').pop(), detail: p, path: p, icon: fileIcon(p), recent: true })), ...files.filter(f => !recent.includes(f.path)).map(f => ({ label: f.path.split('/').pop(), detail: f.path, path: f.path, icon: fileIcon(f.path) }))].slice(0, 80)
      return files.map(f => ({ f, s: fuzzyScore(q, f.path.split('/').pop()) * 2 + Math.max(0, fuzzyScore(q, f.path)) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 60)
        .map(({ f }) => ({ label: f.path.split('/').pop(), detail: f.path, path: f.path, icon: fileIcon(f.path) }))
    },
    onPick: it => {
      if (it.path) app.editors.open(it.path)
      else if (it.line) app.editors.gotoLine(it.line)
      else if (it.cmd) it.cmd.run()
      else if (it.pos !== undefined) { const v = app.editors.activeView(); if (v) { app.editors.gotoLine(v.state.doc.lineAt(it.pos).number) } }
    },
  })
}

function commandItems(q) {
  const all = [...app.commands.values()].filter(c => !c.hidden)
  return all.map(c => ({ c, s: fuzzyScore(q, c.title + ' ' + (c.category || '')) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s)
    .map(({ c }) => ({ label: c.title, detail: c.category || '', key: c.key, icon: c.icon, cmd: c }))
}

export function symbolItems(q) {
  const v = app.editors.activeView()
  if (!v) return []
  return outlineSymbols(v.state.doc.toString(), app.editors.activeDoc().lang)
    .map(s => ({ s, score: fuzzyScore(q, s.name) })).filter(x => x.score >= 0).sort((a, b) => q ? b.score - a.score : a.s.pos - b.s.pos)
    .map(({ s }) => ({ label: s.name, detail: s.kind + ' ・ ' + s.line + ' 行目', pos: s.pos, icon: s.kind === '関数' || s.kind === 'メソッド' ? 'command' : 'outline' }))
}

export function palette() {
  openPicker({
    placeholder: 'コマンドを検索…',
    items: q => commandItems(q),
    onPick: it => it.cmd.run(),
  })
}

export async function gotoLineDialog() {
  const v = app.editors.activeView()
  if (!v) return
  const cur = v.state.doc.lineAt(v.state.selection.main.head).number
  const val = await promptDialog('行へ移動', { value: String(cur), label: `1 〜 ${v.state.doc.lines}`, okLabel: '移動' })
  const n = parseInt(val, 10)
  if (!isNaN(n)) app.editors.gotoLine(n)
}

// ---- アウトライン用のシンボル抽出 ----
export function outlineSymbols(text, lang) {
  const out = []
  const lines = text.split('\n')
  let pos = 0
  lines.forEach((line, i) => {
    let m
    if (lang === 'luau') {
      if ((m = /^\s*(local\s+)?function\s+([\w.:]+)\s*\(([^)]*)\)/.exec(line))) out.push({ name: m[2] + '(' + m[3].replace(/\s*:\s*[^,]+/g, '') + ')', kind: m[2].includes(':') ? 'メソッド' : '関数', line: i + 1, pos, depth: indentDepth(line) })
      else if ((m = /^\s*local\s+([\w]+)\s*=\s*function\s*\(([^)]*)\)/.exec(line))) out.push({ name: m[1] + '(' + m[2] + ')', kind: '関数', line: i + 1, pos, depth: indentDepth(line) })
      else if ((m = /^\s*([\w.]+)\s*=\s*function\s*\(([^)]*)\)/.exec(line))) out.push({ name: m[1] + '(' + m[2] + ')', kind: '関数', line: i + 1, pos, depth: indentDepth(line) })
      else if ((m = /^local\s+([\w]+)\s*=\s*game:GetService\(["'](\w+)["']\)/.exec(line))) out.push({ name: m[1], kind: 'サービス', line: i + 1, pos, depth: 0 })
      else if ((m = /^local\s+([\w, ]+?)\s*(?::[^=]+)?=/.exec(line))) out.push({ name: m[1], kind: '変数', line: i + 1, pos, depth: 0 })
      else if ((m = /^\s*(export\s+)?type\s+(\w+)/.exec(line))) out.push({ name: m[2], kind: '型', line: i + 1, pos, depth: 0 })
      else if ((m = /^\s*([\w.:]+(?:\.\w+)*)\s*:\s*Connect\s*\(/.exec(line))) out.push({ name: m[1] + ':Connect', kind: 'イベント', line: i + 1, pos, depth: indentDepth(line) })
      else if ((m = /^\s*--\s*(?:MARK|#region|==+)\s*:?\s*(.+)$/.exec(line))) out.push({ name: m[1].replace(/=+$/, '').trim(), kind: '見出し', line: i + 1, pos, depth: 0 })
    } else if (lang === 'markdown') {
      if ((m = /^(#{1,6})\s+(.+)$/.exec(line))) out.push({ name: m[2], kind: '見出し', line: i + 1, pos, depth: m[1].length - 1 })
    }
    pos += line.length + 1
  })
  return out
}
function indentDepth(line) {
  const lead = /^[ \t]*/.exec(line)[0]
  return Math.min(4, lead.replace(/ {2,4}/g, '\t').length)
}

command('palette', 'コマンドパレットを開く', () => palette(), { icon: 'command', key: '⌘⇧P' })
command('quickOpen', 'ファイルを検索して開く', () => quickOpen(), { icon: 'search', key: '⌘P' })
command('gotoLine', '行へ移動', () => gotoLineDialog(), { key: '⌘G' })
command('gotoSymbol', 'シンボルへ移動 (関数・変数)', () => quickOpen('@'), { icon: 'outline', key: '⌘⇧O' })
void runCommand
