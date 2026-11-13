// エディタから Claude を呼ぶ操作 (続きの提案・エラーの修正・選択範囲の書き換え)
import { app, command, runCommand } from './app.js'
import { emit } from './store.js'
import { toast, menu, promptDialog } from './ui.js'
import { aiReady, errorMessage } from './claude.js'
import { quickEdit, applyQuick } from './agent.js'
import { requestAiGhost } from '../editor/inline.js'
import { undo } from '../../vendor/codemirror.js'

let busy = false
const needAi = () => {
  if (aiReady()) return true
  toast('Claude を使うには、Claude 版で開くか API キーを設定してください', { action: { label: '開き方', run: () => runCommand('aiChat') }, duration: 5000 })
  return false
}

// 小さな修正を頼んで、すぐ反映する (1 回の「元に戻す」で戻せる)
async function runQuick(view, path, instruction, focusLine, label) {
  if (busy) { toast('Claude が作業中です'); return }
  busy = true
  emit('aiBusy', true)
  const t = toast(`Claude が${label}…`, { icon: 'sparkle', duration: 60000, spinner: true })
  try {
    const r = await quickEdit({ path, instruction, focusLine })
    if (t && t.close) t.close()
    if (!r.count || r.after === r.before) { toast(r.summary || '変更はありませんでした', { icon: 'sparkle', duration: 3500 }); return }
    await applyQuick(path, r)
    const v = app.editors.viewFor(path) || view
    toast(r.summary ? `Claude: ${r.summary}` : `Claude が${label}ました`, { icon: 'sparkle', duration: 6000, action: { label: '元に戻す', run: () => { if (v) undo(v) } } })
  } catch (e) {
    if (t && t.close) t.close()
    const msg = errorMessage(e)
    if (msg) toast(msg, { kind: 'error', duration: 6000, action: { label: 'パネルで頼む', run: () => runCommand('aiAsk', instruction) } })
  } finally {
    busy = false
    emit('aiBusy', false)
  }
}

const activePath = () => app.editors.active
const selInfo = view => {
  const sel = view.state.selection.main
  if (sel.empty) return null
  const a = view.state.doc.lineAt(sel.from).number, b = view.state.doc.lineAt(sel.to).number
  return { a, b, text: view.state.sliceDoc(sel.from, sel.to) }
}

// ---- 続きを提案 (ゴーストテキスト) ----
command('aiSuggest', 'Claude: 続きを提案', async () => {
  const view = app.editors.activeView()
  const doc = app.editors.activeDoc()
  if (!view || !doc) return
  if (!needAi()) return
  if (!view.state.selection.main.empty) { runCommand('aiSelectionMenu'); return }
  const t = toast('Claude が続きを考えています…', { icon: 'sparkle', duration: 20000, spinner: true })
  try {
    const ok = await requestAiGhost(view, doc.ctx.aiProvider)
    if (t && t.close) t.close()
    if (!ok) toast('提案はありませんでした', { duration: 1500 })
    else view.focus()
  } catch (e) {
    if (t && t.close) t.close()
    const msg = errorMessage(e)
    if (msg) toast(msg, { kind: 'error', duration: 5000 })
  }
}, { icon: 'sparkle' })

// ---- エディタが見つけた問題を直す ----
command('aiFixDiagnostics', 'Claude: この行の問題を直す', (view, list) => {
  view = view || app.editors.activeView()
  if (!view || !needAi()) return
  if (!list) list = app.editors.lineDiagnostics(view).map(d => ({ message: d.message, line: view.state.doc.lineAt(view.state.selection.main.head).number }))
  if (!list.length) { toast('この行に問題はありません', { duration: 1200 }); return }
  const desc = list.map(p => `line ${p.line}: ${p.message}`).join('\n')
  runQuick(view, activePath(), `Fix these problems reported by the editor's checker, changing only what is needed:\n${desc}`, list[0].line, '修正し')
}, { icon: 'sparkle' })

// ---- 選択範囲 ----
const SELECTION_ACTIONS = [
  { id: 'fix', label: 'バグを直す', icon: 'bug', inst: s => `Find and fix bugs in lines ${s.a}-${s.b} (the selected code). Change only those lines unless a fix needs more.`, verb: '直し' },
  { id: 'tidy', label: '読みやすく整理', icon: 'wand', inst: s => `Refactor lines ${s.a}-${s.b} (the selected code) to be cleaner and easier to read without changing behavior (better names, less duplication, modern APIs).`, verb: '整理し' },
  { id: 'comment', label: 'コメントを追加', icon: 'comment', inst: s => `Add helpful Japanese comments to lines ${s.a}-${s.b} (the selected code). Do not change the code itself.`, verb: 'コメントを追加し' },
  { id: 'types', label: '型注釈を付ける', icon: 'braces', inst: s => `Add Luau type annotations to the functions and locals in lines ${s.a}-${s.b} where they help. Do not change behavior.`, verb: '型注釈を付け' },
  { id: 'faster', label: '速く・軽くする', icon: 'bolt', inst: s => `Optimize lines ${s.a}-${s.b} (the selected code) for performance (cache services and lookups, avoid per-frame allocations, disconnect connections) without changing behavior.`, verb: '最適化し' },
]
command('aiSelectionMenu', 'Claude: 選択範囲を頼む', async anchor => {
  const view = app.editors.activeView()
  if (!view || !needAi()) return
  const s = selInfo(view)
  const items = []
  if (s) {
    const range = s.a === s.b ? `${s.a} 行目` : `${s.a}〜${s.b} 行目`
    items.push({ note: `${range}を Claude に頼む` })
    items.push({ label: '説明して', icon: 'book', run: () => runCommand('aiAsk', `選択した ${range}のコードが何をしているか、わかりやすく説明してください。`) })
    for (const a of SELECTION_ACTIONS) items.push({ label: a.label, icon: a.icon, run: () => runQuick(view, activePath(), a.inst(s), s.a, a.verb) })
    items.push('-', { label: '指示して書き換え…', icon: 'edit', run: () => runCommand('aiEditSelection') })
  } else {
    items.push({ label: '続きを提案', icon: 'sparkle', hint: 'Alt+\\', run: () => runCommand('aiSuggest') })
    items.push({ label: 'この行の問題を直す', icon: 'bulb', run: () => runCommand('aiFixDiagnostics') })
    items.push({ label: '指示して書き換え…', icon: 'edit', run: () => runCommand('aiEditSelection') })
    items.push({ label: 'ファイル全体を説明', icon: 'book', run: () => runCommand('aiExplain') })
  }
  items.push('-', { label: 'Claude パネルを開く', icon: 'chat', run: () => runCommand('aiChat') })
  let a = anchor && anchor.getBoundingClientRect ? anchor : null
  if (!a) {
    const c = view.coordsAtPos(view.state.selection.main.head)
    if (c) a = { getBoundingClientRect: () => ({ left: c.left, right: c.left, top: c.top, bottom: c.bottom }) }
  }
  menu(items, a, { title: 'Claude' })
}, { icon: 'sparkle' })

command('aiEditSelection', 'Claude: 指示して書き換え', async () => {
  const view = app.editors.activeView()
  if (!view || !needAi()) return
  const s = selInfo(view)
  const what = await promptDialog(s ? `${s.a === s.b ? s.a + ' 行目' : s.a + '〜' + s.b + ' 行目'}をどう変えますか?` : 'このファイルをどう変えますか?', { placeholder: '例: ボタンを押したら色が変わるようにして', okLabel: '頼む' })
  if (!what) return
  const inst = s ? `Change lines ${s.a}-${s.b} (the selected code) as the user asks: ${what}` : `Change this file as the user asks: ${what}`
  const line = s ? s.a : view.state.doc.lineAt(view.state.selection.main.head).number
  runQuick(view, activePath(), inst, line, '書き換え')
}, { icon: 'sparkle' })

// ---- 実行エラー ----
command('aiFixRunError', 'Claude: 実行エラーを直す', text => {
  if (!needAi()) return
  runCommand('aiAsk', `実行すると次のエラーが出ました。原因を調べて直し、実行して確かめてください:\n${text}`)
}, { icon: 'sparkle' })
