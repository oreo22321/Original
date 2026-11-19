// 端末内 AI (LLM) をダウンロードしたら、エラー検知・実行エラーの修正・続きの提案を AI に任せる (設定「AI に任せる」)
// ・エラー検知: 書くのが止まって少したったら AI がファイルを読み、見つけたバグを波線 (AI) で出す。結果は行の中身で覚えておき、書き換えても消えにくい
// ・実行エラー: エラーの行のまわりを AI に直してもらい、確かめた直し方を出力に出す (適用はボタンで)
// ・続きの提案: AI が前後のコードを見て続きを書く (だめなら内蔵の統計モデル)
import * as llm from '../ai/llm.js'
import { getSettings, onSettings } from './store.js'
import { pyTools } from '../editor/python.js'
import { forceLinting } from '../../vendor/codemirror.js'

const py = (type, args) => pyTools(type, args, 30000)
const assist = () => import('../ai/assist.js')
export const assistOn = () => { const s = getSettings(); return !!(s.aiAssist && s.aiLlm && llm.llmReady() && llm.status().model === s.aiLlm) }

// ============================================================
// エラー検知
// ============================================================
const cache = new Map()   // path → { code, findings: [{ line, text, message, fix }] }
let timer = 0, running = null, lastView = null

function relocate(state, f) {
  const n = state.doc.lines
  if (f.line <= n && state.doc.line(f.line).text === f.text) return f.line
  for (let d = 1; d <= 30; d++) {
    for (const ln of [f.line - d, f.line + d]) if (ln >= 1 && ln <= n && state.doc.line(ln).text === f.text) return ln
  }
  return 0
}

export const aiLint = {
  // いまの AI の結果 (行の中身で場所を合わせる)
  diagnostics(state, path) {
    if (!assistOn()) return []
    const c = cache.get(path)
    if (!c) return []
    const out = []
    for (const f of c.findings) {
      const ln = relocate(state, f)
      if (!ln) continue
      const line = state.doc.line(ln)
      const from = line.from + /^\s*/.exec(line.text)[0].length
      const d = { from, to: Math.max(from + 1, line.to), severity: 'warning', source: 'AI', message: f.message, markClass: 'cm-ai-diag' }
      if (f.fix) {
        d.actions = [{
          name: 'AI の直し方にする',
          apply(view) {
            const st = view.state
            const l2 = relocate(st, f)
            if (!l2) return
            const L = st.doc.line(l2)
            view.dispatch({ changes: { from: L.from, to: L.to, insert: f.fix.text }, userEvent: 'input.ai' })
          },
        }]
      }
      out.push(d)
    }
    return out
  },
  // 書くのが止まったら AI に読んでもらう
  schedule(view, path, diags) {
    if (!assistOn()) return
    const code = view.state.doc.toString()
    const c = cache.get(path)
    if (c && c.code === code) return
    clearTimeout(timer)
    lastView = view
    const known = diags.filter(d => d.source !== 'AI' && d.severity !== 'hint').map(d => ({ line: view.state.doc.lineAt(d.from).number, message: d.message })).slice(0, 12)
    timer = setTimeout(() => runCheck(view, path, code, known), Math.max(1800, (getSettings().aiDelay || 700) * 3))
  },
}

async function runCheck(view, path, code, known) {
  if (view.state.doc.toString() !== code || !assistOn()) return
  if (running) running.abort()
  const ac = new AbortController()
  running = ac
  try {
    const { aiCheck } = await assist()
    const findings = await aiCheck(py, code, { known, signal: ac.signal })
    const lines = code.split('\n')
    cache.set(path, { code, findings: findings.map(f => ({ ...f, text: lines[f.line - 1] })) })
    if (cache.size > 30) cache.delete(cache.keys().next().value)
    if (view.state.doc.toString() === code) forceLinting(view)
  } catch (e) {
    // ほかの大事な頼み (チャットなど) に譲った → 少し待ってやり直す
    if (e && e.name === 'Preempted') timer = setTimeout(() => runCheck(view, path, view.state.doc.toString(), known), 5000)
  } finally {
    if (running === ac) running = null
  }
}

// ============================================================
// 続きの提案
// ============================================================
let compAbort = null
export async function aiCompletion(before, after) {
  if (!assistOn() || !getSettings().aiInline) return ''
  if (compAbort) compAbort.abort()
  const ac = new AbortController()
  compAbort = ac
  const t = setTimeout(() => ac.abort(), 6000)
  try {
    const { aiComplete } = await assist()
    return await aiComplete(before, after, { signal: ac.signal })
  } catch { return '' } finally { clearTimeout(t); if (compAbort === ac) compAbort = null }
}

// ============================================================
// 実行エラーの修正
// ============================================================
export async function suggestFix({ code, path, error, signal }) {
  if (!assistOn()) return null
  const { aiFixError } = await assist()
  return aiFixError(py, { code, path, error, signal })
}

// ============================================================
// 準備: 端末に保存済みのモデルを、手が空いたときに読み込む
// ============================================================
export function startAssist() {
  const go = () => {
    const s = getSettings()
    if (!s.aiAssist || !s.aiLlm) return
    const idle = window.requestIdleCallback || (f => setTimeout(f, 1500))
    idle(() => llm.preload(s.aiLlm).then(ok => { if (ok && lastView) forceLinting(lastView) }), { timeout: 8000 })
  }
  setTimeout(go, 4000)
  onSettings((s, prev) => { if (s && prev && (s.aiAssist !== prev.aiAssist || s.aiLlm !== prev.aiLlm)) go() })
  llm.onLlmChange(st => { if (st.state === 'ready' && lastView) forceLinting(lastView) })
}
