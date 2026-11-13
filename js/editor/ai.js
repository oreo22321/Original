// エディタの AI 候補 (ゴーストテキスト)
// ・統計モデル: プロジェクトと内蔵サンプルから学習し、行の続きを提案 (すぐに出る・オフライン)
// ・コメントからコード: 「-- 触れたら死ぬ」と書いて次の行で ✨ (Alt + \) を押すと、コードを組み立てて提案
import { completeLine, codeFromComment } from '../ai/complete.js'

// 返ってきた候補を整える (重複・前後のゴミを除く)
export function cleanSuggestion(text, before, after) {
  let t = String(text || '')
  const fence = /^\s*```[\w-]*\n([\s\S]*?)\n?```\s*$/.exec(t)
  if (fence) t = fence[1]
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

// エディタ用: インライン候補プロバイダ ((state, pos, { manual }) → 挿入する文字列)
export function makeAiProvider(getFile) {
  return async (state, pos, { manual = false } = {}) => {
    const file = getFile()
    if (file.lang && file.lang !== 'luau' && file.lang !== 'lua') return ''
    const before = state.doc.sliceString(Math.max(0, pos - 4000), pos)
    const after = state.doc.sliceString(pos, Math.min(state.doc.length, pos + 400))
    // 行の途中 (カーソルの後ろに文字がある) は提案しない
    const restOfLine = after.split('\n')[0]
    if (restOfLine.trim() && !/^[)\]}"']*\s*$/.test(restOfLine)) return ''
    if (manual) {
      const gen = codeFromComment(before, file.mode)
      if (gen) return gen.code
    }
    return cleanSuggestion(completeLine(before), before, after)
  }
}
