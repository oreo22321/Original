// コマンドパレット / ファイル検索 (Quick Open) / 行へ移動
import { app, command, runCommand } from './app.js'
import { h, icon, fileIcon, fuzzyScore, promptDialog } from './ui.js'

// コマンドの分類 (コマンドパレットで、種類ごとにまとめて表示)
const CATEGORIES = [
  ['実行', /^(run|runSelection|stop|restartPython|clearOutput|openRunScreen|unpinRun)$/],
  ['ターミナル', /^(terminal|toggleTerminal|terminalRun)$/],
  ['ファイル', /^(save|saveAll|newFile|newFolder|importFiles|importZip|exportZip|shareFile|closeTab|closeAll|projects|history|revealInExplorer|explorer|quickOpen|copyCode)$/],
  ['編集', /^(undo|redo|selectAll|format|find|toggleComment|copyLineDown|moveLineUp|moveLineDown|selectNextOccurrence|fixAllTypos|quickFix|foldAll|unfoldAll)$/],
  ['移動・検索', /^(gotoLine|gotoSymbol|gotoDefinition|findReferences|renameSymbol|outline|findInFiles|codeMenu)$/],
  ['デバッグ', /^(debug|toggleBreakpoint|clearBreakpoints|showDebug)/],
  ['AI', /^ai/],
  ['GitHub', /^github/],
  ['表示', /^(toggleSidebar|togglePanel|togglePanelMax|toggleSplit|togglePreview|toggleWrap|zoomIn|zoomOut|palette)$/],
  ['アプリ', /^(settings|help|whatsNew|onboarding|reload|showErrors)$/],
]
export function categoryOf(c) {
  if (c.category) return c.category
  for (const [name, re] of CATEGORIES) if (re.test(c.id)) return name
  return 'そのほか'
}
const RECENT = 'forgecode.recentCommands'
const recentIds = () => { try { return JSON.parse(localStorage.getItem(RECENT) || '[]') } catch { return [] } }
function noteRecent(id) {
  try { localStorage.setItem(RECENT, JSON.stringify([id, ...recentIds().filter(x => x !== id)].slice(0, 8))) } catch {}
}

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
    // 見出しの行は選べない
    if (shown[sel] && shown[sel].header) sel = Math.max(0, shown.findIndex(x => !x.header))
    list.innerHTML = ''
    res.forEach((it, i) => {
      if (it.header) { list.append(h('div', { class: 'palette-head', role: 'presentation' }, it.header)); return }
      const row = h('div', { class: 'palette-item' + (i === sel ? ' sel' : ''), role: 'option', onmousedown: e => { e.preventDefault(); pick(i) } },
        render ? render(it) : [it.icon ? (typeof it.icon === 'string' ? icon(it.icon, 16) : it.icon) : h('span', { class: 'ico-space' }), h('span', { class: 'pi-label' }, it.label), it.detail ? h('span', { class: 'pi-detail' }, it.detail) : null, it.key ? h('kbd', null, it.key) : null])
      list.append(row)
    })
    if (!res.length) list.append(h('div', { class: 'palette-empty' }, '見つかりません'))
    const s = list.querySelector('.palette-item.sel')
    if (s && s.scrollIntoView) s.scrollIntoView({ block: 'nearest' })
  }
  const pick = i => {
    const it = shown[i]
    if (!it || it.header) return
    close()
    onPick(it, input.value)
  }
  input.addEventListener('input', () => { sel = 0; update() })
  input.addEventListener('keydown', e => {
    const step = d => { let k = sel + d; while (k >= 0 && k < shown.length && shown[k].header) k += d; if (k >= 0 && k < shown.length) sel = k }
    if (e.key === 'ArrowDown') { step(1); update(); e.preventDefault() }
    else if (e.key === 'ArrowUp') { step(-1); update(); e.preventDefault() }
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
      else if (it.cmd) { noteRecent(it.cmd.id); it.cmd.run() }
      else if (it.pos !== undefined) { const v = app.editors.activeView(); if (v) { app.editors.gotoLine(v.state.doc.lineAt(it.pos).number) } }
    },
  })
}

// 何も入力していないとき: 最近使ったもの → 種類ごと / 入力したとき: 近い順 (種類も検索の対象)
function commandItems(q) {
  const all = [...app.commands.values()].filter(c => !c.hidden)
  const item = c => ({ label: c.title, detail: categoryOf(c), key: c.key, icon: c.icon, cmd: c })
  // 見出しの下では、種類の名前は出さない
  const plain = c => ({ ...item(c), detail: '' })
  if (!q) {
    const out = []
    const recent = recentIds().map(id => app.commands.get(id)).filter(c => c && !c.hidden)
    if (recent.length) { out.push({ header: '最近使ったもの' }); out.push(...recent.map(item)) }
    const order = [...CATEGORIES.map(([n]) => n), 'そのほか']
    for (const cat of order) {
      const cs = all.filter(c => categoryOf(c) === cat).sort((a, b) => a.title.localeCompare(b.title, 'ja'))
      if (!cs.length) continue
      out.push({ header: cat })
      out.push(...cs.map(plain))
    }
    return out
  }
  return all.map(c => ({ c, s: fuzzyScore(q, c.title + ' ' + categoryOf(c) + ' ' + c.id) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).map(({ c }) => item(c))
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
    placeholder: 'すべての機能から検索 (例: ターミナル・整形・GitHub)',
    items: q => commandItems(q),
    onPick: it => { noteRecent(it.cmd.id); it.cmd.run() },
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
    if (lang === 'python') {
      const depth = indentDepth(line)
      if ((m = /^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)?/.exec(line))) {
        const params = m[2].split(',').map(p => p.replace(/[:=].*$/, '').trim()).filter(p => p && p !== 'self' && p !== 'cls').join(', ')
        // クラスの中 (直前の、より浅い行が class) ならメソッド
        let kind = '関数'
        for (let j = out.length - 1; j >= 0; j--) { if (out[j].depth < depth) { if (out[j].kind === 'クラス') kind = 'メソッド'; break } }
        out.push({ name: `${m[1]}(${params})`, kind, line: i + 1, pos, depth })
      } else if ((m = /^\s*class\s+(\w+)/.exec(line))) out.push({ name: m[1], kind: 'クラス', line: i + 1, pos, depth })
      else if ((m = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?::[^=]+)?=(?!=)/.exec(line))) out.push({ name: m[1], kind: /^[A-Z][A-Z0-9_]*$/.test(m[1]) ? '定数' : '変数', line: i + 1, pos, depth: 0 })
      else if (/^if\s+__name__\s*==\s*["']__main__["']/.test(line)) out.push({ name: '__main__', kind: '見出し', line: i + 1, pos, depth: 0 })
      else if ((m = /^\s*#\s*(?:%%|MARK:?|---+|===+)\s*(.*?)[-=\s]*$/.exec(line)) && m[1]) out.push({ name: m[1], kind: '見出し', line: i + 1, pos, depth: 0 })
    } else if (lang === 'markdown') {
      if ((m = /^(#{1,6})\s+(.+)$/.exec(line))) out.push({ name: m[2], kind: '見出し', line: i + 1, pos, depth: m[1].length - 1 })
    }
    pos += line.length + 1
  })
  return out
}
function indentDepth(line) {
  const lead = /^[ \t]*/.exec(line)[0]
  return Math.min(6, Math.floor(lead.replace(/\t/g, '    ').length / 4))
}

command('palette', 'すべての機能 (コマンドパレット)', () => palette(), { icon: 'command', key: '⌘⇧P' })
command('quickOpen', 'ファイルを検索して開く', () => quickOpen(), { icon: 'search', key: '⌘P' })
command('gotoLine', '行へ移動', () => gotoLineDialog(), { key: '⌘G' })
command('gotoSymbol', 'シンボルへ移動 (関数・変数)', () => quickOpen('@'), { icon: 'outline', key: '⌘⇧O' })
void runCommand
