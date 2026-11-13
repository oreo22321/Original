// エディタから AI を呼ぶ操作 (続きの提案・この行の問題を直す・選択範囲の操作・実行エラーから直す)
// どれもアプリ内蔵の Forge AI がすぐに処理します (1 回の「元に戻す」で取り消せます)
import { app, command, runCommand } from './app.js'
import { emit } from './store.js'
import { toast, menu, promptDialog } from './ui.js'
import { askAi } from './ai-host.js'
import { lintOpts } from './agent.js'
import { requestAiGhost } from '../editor/inline.js'
import { repairSyntax, applyAction } from '../ai/repair.js'
import { checkSyntax } from '../luau/parser.js'
import { lintLuau } from '../editor/lint.js'
import { undo } from '../../vendor/codemirror.js'

let busy = false

// 依頼をその場で実行して、結果を短く知らせる (チャットには残さない)
async function runInline(view, prompt, label) {
  if (busy) { toast('AI が作業中です'); return }
  busy = true
  emit('aiBusy', true)
  const t = toast(`AI が${label}…`, { icon: 'sparkle', duration: 30000, spinner: true })
  try {
    const r = await askAi({ text: prompt, focusEdits: true })
    if (t && t.close) t.close()
    const first = (r.text.split('\n').find(l => l.trim() && !/^#+\s/.test(l)) || '').replace(/\*\*/g, '').replace(/`/g, '').slice(0, 120)
    if (r.changes.length) {
      const v = app.editors.viewFor(r.changes[0].path) || view
      toast(first || `${label}ました`, { icon: 'sparkle', duration: 6000, action: { label: '元に戻す', run: () => { if (v) undo(v) } } })
    } else toast(first || '変更はありませんでした', { icon: 'sparkle', duration: 5000, action: r.text.length > 140 ? { label: '詳しく', run: () => runCommand('aiAsk', prompt) } : undefined })
  } catch (e) {
    if (t && t.close) t.close()
    toast('AI: ' + ((e && e.message) || 'エラーが発生しました'), { kind: 'error', duration: 6000 })
  } finally {
    busy = false
    emit('aiBusy', false)
  }
}

const selInfo = view => {
  const sel = view.state.selection.main
  if (sel.empty) return null
  const a = view.state.doc.lineAt(sel.from).number, b = view.state.doc.lineAt(sel.to).number
  return { a, b, text: view.state.sliceDoc(sel.from, sel.to) }
}

// ---- 続きを提案 (ゴーストテキスト) ----
command('aiSuggest', 'AI: 続きを提案', async () => {
  const view = app.editors.activeView()
  const doc = app.editors.activeDoc()
  if (!view || !doc) return
  if (!view.state.selection.main.empty) { runCommand('aiSelectionMenu'); return }
  try {
    const ok = await requestAiGhost(view, doc.ctx.aiProvider)
    if (!ok) toast('提案はありませんでした。コメント (-- 触れたら死ぬ など) を書いて次の行で頼むと、コードを組み立てます', { duration: 3500 })
    else view.focus()
  } catch (e) {
    toast('AI: ' + ((e && e.message) || e), { kind: 'error', duration: 4000 })
  }
}, { icon: 'sparkle' })

// ---- エディタが見つけた問題を直す (この行) ----
command('aiFixDiagnostics', 'AI: この行の問題を直す', view => {
  view = view || app.editors.activeView()
  const path = app.editors.active
  if (!view || !path) return
  const text = view.state.doc.toString()
  let next = text
  let what = ''
  if (checkSyntax(text)) {
    const r = repairSyntax(text)
    if (r.fixes.length) { next = r.text; what = r.fixes.slice(0, 3).map(f => f.why).join('、') }
  } else {
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    const diags = lintLuau(text, lintOpts(path)).filter(d => d.actions && d.actions.length && d.from <= line.to && d.to >= line.from).sort((a, b) => b.from - a.from)
    const done = []
    for (const d of diags) { const after = applyAction(next, d, d.actions[0]); if (after !== next) { next = after; done.push(d.actions[0].name) } }
    what = done.join('、')
  }
  if (next === text) { runInline(view, 'このコードの問題を直して', '直してい'); return }
  view.dispatch({ changes: { from: 0, to: text.length, insert: next }, userEvent: 'input.fix', scrollIntoView: true })
  toast(`AI が直しました: ${what}`.slice(0, 120), { icon: 'sparkle', duration: 5000, action: { label: '元に戻す', run: () => undo(view) } })
}, { icon: 'sparkle' })

// ---- 選択範囲 ----
const SELECTION_ACTIONS = [
  { label: '問題を直す', icon: 'bug', prompt: 'この範囲の問題を直して', verb: '直してい' },
  { label: '整理する (新しい書き方に)', icon: 'wand', prompt: 'この範囲を整理して', verb: '整理してい' },
  { label: '整形する', icon: 'format', prompt: 'この範囲を整形して', verb: '整形してい' },
  { label: 'コメントを追加', icon: 'comment', prompt: 'コメントを追加して', verb: 'コメントを書いてい' },
  { label: '型注釈を付ける', icon: 'braces', prompt: '型注釈を付けて', verb: '型を推測してい' },
  { label: '速く・軽くする', icon: 'bolt', prompt: '最適化して', verb: '最適化してい' },
]
command('aiSelectionMenu', 'AI: 選択範囲を頼む', async anchor => {
  const view = app.editors.activeView()
  if (!view) return
  const s = selInfo(view)
  const items = []
  if (s) {
    const range = s.a === s.b ? `${s.a} 行目` : `${s.a}〜${s.b} 行目`
    items.push({ note: `${range}を AI に頼む` })
    items.push({ label: '1 行ずつ説明', icon: 'book', run: () => runCommand('aiAsk', '選択した範囲を説明して') })
    for (const a of SELECTION_ACTIONS) items.push({ label: a.label, icon: a.icon, run: () => runInline(view, a.prompt, a.verb) })
    items.push('-', { label: '指示して頼む…', icon: 'edit', run: () => runCommand('aiEditSelection') })
  } else {
    items.push({ label: '続きを提案', icon: 'sparkle', hint: 'Alt+\\', run: () => runCommand('aiSuggest') })
    items.push({ label: 'この行の問題を直す', icon: 'bulb', run: () => runCommand('aiFixDiagnostics') })
    items.push({ label: 'ファイル全体を直す', icon: 'bug', run: () => runInline(view, 'このコードの問題を直して', '直してい') })
    items.push({ label: 'ファイル全体を説明', icon: 'book', run: () => runCommand('aiExplain') })
    items.push({ label: 'チェック (レビュー)', icon: 'check', run: () => runCommand('aiReview') })
    items.push({ label: '指示して頼む…', icon: 'edit', run: () => runCommand('aiEditSelection') })
  }
  items.push('-', { label: 'AI パネルを開く', icon: 'chat', run: () => runCommand('aiChat') })
  let a = anchor && anchor.getBoundingClientRect ? anchor : null
  if (!a) {
    const c = view.coordsAtPos(view.state.selection.main.head)
    if (c) a = { getBoundingClientRect: () => ({ left: c.left, right: c.left, top: c.top, bottom: c.bottom }) }
  }
  menu(items, a, { title: 'Forge AI' })
}, { icon: 'sparkle' })

command('aiEditSelection', 'AI: 指示して頼む', async () => {
  const view = app.editors.activeView()
  if (!view) return
  const s = selInfo(view)
  const what = await promptDialog(s ? `${s.a === s.b ? s.a + ' 行目' : s.a + '〜' + s.b + ' 行目'}をどうしますか?` : '何をしますか?', { placeholder: '例: 直して / コメントを追加して / E キーで開くドアを作って', okLabel: '頼む' })
  if (!what) return
  runCommand('aiAsk', what)
}, { icon: 'sparkle' })

// ---- 実行エラー ----
command('aiFixRunError', 'AI: 実行エラーを直す', text => {
  runCommand('aiAsk', `エラーを直して\n${String(text || '').slice(0, 2000)}`)
}, { icon: 'sparkle' })
