// エディタの AI 候補 (Claude が続きを提案するゴーストテキスト)
// ・ローカルの補完 (即時) はそのまま。Claude の候補は、手で呼んだとき (✨ キー / Alt+\) か、
//   設定で「入力が止まったら自動で」をオンにしたときだけ取りに行きます (速度・利用枠を守るため)
import { ask, provider } from '../app/claude.js'

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (標準・高性能)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (速い)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (最速・低コスト)' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2 (最上位)' },
]

const MODE_NOTES = {
  studio: 'The file is a Roblox Studio script (Script / LocalScript / ModuleScript). Use only official Roblox APIs.',
  executor: 'The file is a Roblox executor script (client-side). UNC executor APIs are available (getgenv, writefile/readfile, request, hookmetamethod, Drawing, gethui ...).',
}

function stripFences(text) {
  const m = /^\s*```[\w-]*\n([\s\S]*?)\n?```\s*$/.exec(text)
  return m ? m[1] : text
}

// 返ってきた候補を整える (重複・前後のゴミを除く)
export function cleanSuggestion(text, before, after) {
  let t = stripFences(String(text || ''))
  if (/^\s*<none>\s*$/i.test(t)) return ''
  t = t.replace(/<\/?CURSOR>/g, '')
  const lastLine = before.split('\n').pop()
  if (lastLine.trim() && t.startsWith(lastLine)) t = t.slice(lastLine.length)
  // 後ろに既にある行を繰り返していたら、そこで切る
  const nextLine = (after.split('\n').find(l => l.trim()) || '').trim()
  if (nextLine.length > 3) {
    const lines = t.split('\n')
    const k = lines.findIndex((l, i) => i > 0 && l.trim() === nextLine)
    if (k > 0) t = lines.slice(0, k).join('\n')
  }
  return t.replace(/\s+$/, m => (m.includes('\n') ? '' : m))
}

export function inlinePrompt({ before, after, filename, mode }) {
  return `You are the inline code-completion engine of ForgeCode, a Roblox Luau editor on phones.
${MODE_NOTES[mode] || ''}
Reply with ONLY the exact text to insert at <CURSOR>: no explanation, no code fences, nothing that is already before or after the cursor.
Usually finish the current line or the current small block (at most about 8 lines). Match the indentation, naming and comment language. Prefer modern APIs (task.wait, GetService, :Connect).
If nothing useful can be inserted, reply with exactly <none>.

File: ${filename}
<code>
${before}<CURSOR>${after}
</code>`
}

// エディタ用: インライン候補プロバイダ ((state, pos) → 挿入する文字列)
let lastAuto = 0, pausedUntil = 0
export function makeAiProvider(getFile) {
  let ctrl = null
  return async (state, pos, { manual = false } = {}) => {
    if (!provider()) return ''
    if (!manual) {
      // 自動のときは呼びすぎない (利用枠を守る)
      const now = Date.now()
      if (now < pausedUntil || now - lastAuto < 2500) return ''
      lastAuto = now
    }
    if (ctrl) ctrl.abort()
    ctrl = new AbortController()
    const file = getFile()
    const before = state.doc.sliceString(Math.max(0, pos - 5000), pos)
    const after = state.doc.sliceString(pos, Math.min(state.doc.length, pos + 1500))
    try {
      const r = await ask(inlinePrompt({ before, after, filename: file.name, mode: file.mode }), { tier: 'quick', signal: ctrl.signal, maxTokens: 400 })
      return cleanSuggestion(r.text, before, after)
    } catch (e) {
      if (e && e.code === 'cancelled') return ''
      if (e && e.code === 'rate_limited') pausedUntil = Date.now() + 120000
      throw e
    }
  }
}
