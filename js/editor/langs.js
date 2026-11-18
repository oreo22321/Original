// 共通の言語の部品: Markdown の簡易ハイライトと、インデントでの折りたたみ
import { StreamLanguage, foldService } from '../../vendor/codemirror.js'

// Markdown (README やメモ用の簡易ハイライト)
export const markdownLanguage = StreamLanguage.define({
  name: 'markdown',
  startState: () => ({ code: false }),
  token(stream, state) {
    if (stream.sol() && stream.match(/^\s*```/)) { state.code = !state.code; stream.skipToEnd(); return 'meta' }
    if (state.code) { stream.skipToEnd(); return 'string' }
    if (stream.sol()) {
      if (stream.match(/^#{1,6}\s.*/)) return 'heading'
      if (stream.match(/^\s*(?:[-*+]|\d+\.)\s/)) return 'keyword'
      if (stream.match(/^>.*/)) return 'comment'
    }
    if (stream.match(/^`[^`]+`/)) return 'string'
    if (stream.match(/^\*\*[^*]+\*\*/)) return 'strong'
    if (stream.match(/^\[[^\]]*\]\([^)]*\)/)) return 'link'
    stream.next()
    stream.eatWhile(/[^`*[]/)
    return null
  },
})

// インデントに基づく折りたたみ (全言語共通)
export const indentFold = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart)
  const indentOf = text => {
    if (!text.trim()) return -1
    let n = 0
    for (const c of text) { if (c === ' ') n++; else if (c === '\t') n += state.tabSize; else break }
    return n
  }
  const base = indentOf(line.text)
  if (base < 0) return null
  let end = null
  for (let i = line.number + 1; i <= state.doc.lines; i++) {
    const l = state.doc.line(i)
    const ind = indentOf(l.text)
    if (ind < 0) continue
    if (ind <= base) {
      break
    }
    end = l.to
  }
  if (end === null) return null
  return { from: line.to, to: end }
})

