// 端末内 AI (LLM) に任せる仕事: エラー検知・実行エラーの修正・続きの提案・作ったコードの見直し
// ・小さなモデルでも間違えにくいよう、頼み方 (プロンプト) を短く決まった形にし、答えは必ず検証してから使う
//   (直した行で構文エラーにならないか・新しい未定義の名前が増えないか を pytools で確かめる)
import * as llm from './llm.js'
import { lint } from './repair.js'

const indentOf = s => /^[ \t]*/.exec(s)[0]
const undefinedNames = list => new Set(list.filter(d => /Undefined/.test(d.kind || '')).map(d => (d.args || [])[0] || d.msg))
const hasSyntaxError = list => list.some(d => d.severity === 'error')
function numbered(lines, from = 1) {
  const w = String(from + lines.length).length
  return lines.map((l, i) => `${String(from + i).padStart(w)}| ${l}`).join('\n')
}
function codeBlock(text) {
  const m = /```(?:python|py)?[^\n]*\n([\s\S]*?)(?:```|$)/.exec(text)
  return m ? m[1].replace(/\s+$/, '') : null
}

// 直したコードを確かめる: 構文エラーがなく、未定義の名前が増えていない
async function validate(py, before, after, beforeLint) {
  if (after === before) return { ok: false, why: 'unchanged' }
  const list = await lint(py, after)
  if (hasSyntaxError(list)) return { ok: false, why: 'syntax', error: list.find(d => d.severity === 'error') }
  const was = undefinedNames(beforeLint || await lint(py, before))
  for (const n of undefinedNames(list)) if (!was.has(n)) return { ok: false, why: 'undefined', name: n }
  return { ok: true, lint: list }
}

// ============================================================
// エラー検知 (エディタの波線)
// ============================================================
const CHECK_RULES = `You are a meticulous Python 3 reviewer helping a beginner.
Report only REAL bugs that make the program behave wrongly or crash: wrong logic, wrong method or attribute names, wrong argument order or count, type mistakes (e.g. comparing input() text with a number), off-by-one errors, infinite loops, unreachable code, missing return, using a variable before it is set, mutating a list while iterating it.
Do NOT report style, naming, comments, docstrings, type hints, performance or things that are only unusual.
Answer with at most 4 lines in exactly this format and nothing else:
L<line number>: <what is wrong, in Japanese, under 50 characters> => <the whole corrected line>
If there is no real bug, answer exactly: NONE`

export async function aiCheck(py, code, { known = [], signal, gen = llm.generate } = {}) {
  const all = code.split('\n')
  if (!code.trim() || all.length > 400) return []
  const lines = all.slice(0, 260)
  const beforeLint = await lint(py, code)
  if (hasSyntaxError(beforeLint)) return []    // 構文エラーは、ふつうのチェックで先に直してもらう
  const knownText = known.slice(0, 12).map(k => `L${k.line}: ${k.message}`).join('\n')
  const messages = [
    { role: 'system', content: CHECK_RULES },
    { role: 'user', content: `${numbered(lines)}${knownText ? `\n\nAlready reported (do not repeat):\n${knownText}` : ''}` },
  ]
  const raw = await gen(messages, { signal, maxTokens: 320, temperature: 0.1, kind: 'check' })
  if (/^\s*NONE\b/i.test(raw)) return []
  const out = []
  for (const row of raw.split('\n')) {
    const m = /^\s*[-*]?\s*L?(\d+)\s*[:：|]\s*(.+?)(?:\s*=>\s*(.*))?\s*$/.exec(row)
    if (!m) continue
    const line = Number(m[1])
    if (line < 1 || line > lines.length) continue
    let message = m[2].replace(/`/g, '').trim()
    if (!message || message.length > 140 || /^none$/i.test(message)) continue
    if (known.some(k => k.line === line)) continue
    const orig = all[line - 1]
    let fix = null
    const proposed = !!(m[3] && m[3].trim() && m[3].trim() !== '-')
    if (proposed) {
      let text = m[3].replace(/^`+|`+$/g, '').replace(/\s+$/, '')
      text = indentOf(orig) + text.trimStart()
      if (text.trim() !== orig.trim()) {
        const next = [...all]; next[line - 1] = text
        const v = await validate(py, code, next.join('\n'), beforeLint)
        if (v.ok) fix = { line, text }
      }
    }
    // 直し方を出したのに確かめられなかったものは捨てる。直し方がないものは、その行の名前に触れているときだけ出す (思い込みを減らす)
    if (proposed && !fix) continue
    if (!fix) {
      const words = (orig.match(/[A-Za-z_]\w{2,}/g) || [])
      if (!words.some(w => message.includes(w))) continue
    }
    out.push({ line, message, fix })
    if (out.length >= 4) break
  }
  return out
}

// ============================================================
// 実行エラーの修正
// ============================================================
const FIX_RULES = `You fix bugs in Python 3 programs written by beginners.
You get the error, the whole file for context, and a few lines to rewrite.
Return ONLY the corrected version of those lines in one \`\`\`python block, keeping the same indentation and everything that is not part of the bug.
Then add one short sentence in Japanese explaining the fix.`

// 直す範囲: エラーの行を含む関数 (なければ前後 6 行)
export function fixWindow(lines, line) {
  const i = Math.max(0, Math.min(lines.length - 1, line - 1))
  const ind = indentOf(lines[i]).length
  let start = Math.max(0, i - 6), end = Math.min(lines.length - 1, i + 6)
  for (let k = i; k >= Math.max(0, i - 40); k--) {
    const l = lines[k]
    if (/^\s*(async\s+def|def|class)\s/.test(l) && indentOf(l).length < Math.max(1, ind)) {
      const base = indentOf(l).length
      let e = k + 1
      while (e < lines.length && e - k < 60 && (!lines[e].trim() || indentOf(lines[e]).length > base)) e++
      start = k; end = Math.max(i, e - 1)
      while (end > i && !lines[end].trim()) end--
      break
    }
  }
  return { start: start + 1, end: end + 1 }
}

export async function aiFixError(py, { code, path = 'main.py', error, signal, onText, gen = llm.generate }) {
  const all = code.split('\n')
  const line = Number(error.line) || 1
  if (line > all.length) return null
  const { start, end } = fixWindow(all, line)
  const before = all.slice(start - 1, end).join('\n')
  const tb = String(error.text || `${error.type}: ${error.message}`).split('\n').slice(-14).join('\n')
  const ctx = all.length <= 160 ? numbered(all) : numbered(all.slice(Math.max(0, start - 40), Math.min(all.length, end + 40)), Math.max(1, start - 39))
  const beforeLint = await lint(py, code)
  let feedback = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages = [
      { role: 'system', content: FIX_RULES },
      { role: 'user', content: `File ${path}:\n${ctx}\n\nError when running it:\n${tb}\n\nRewrite lines ${start}-${end} (the bug is around line ${line}):\n\`\`\`python\n${before}\n\`\`\`${feedback}` },
    ]
    const raw = await gen(messages, { signal, maxTokens: 700, temperature: 0.15, kind: 'fix', onText })
    let after = codeBlock(raw)
    if (!after) continue
    // 字下げを外して書いてきたら、元の字下げに戻す
    const baseIn = indentOf(all[start - 1])
    if (baseIn && !after.startsWith(baseIn)) after = after.split('\n').map(l => (l.trim() ? baseIn + l : l)).join('\n')
    const next = [...all.slice(0, start - 1), ...after.split('\n'), ...all.slice(end)].join('\n')
    const v = await validate(py, code, next, beforeLint)
    if (v.ok) {
      const why = raw.replace(/```[\s\S]*?(```|$)/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
      return { start, end, before, after, code: next, why }
    }
    feedback = v.why === 'syntax' ? `\n\nYour previous answer had a syntax error (${v.error.msg} at line ${v.error.line}). Return valid Python.` : v.why === 'undefined' ? `\n\nYour previous answer used the undefined name "${v.name}". Do not invent names.` : '\n\nYour previous answer did not change anything. Fix the bug.'
  }
  return null
}

// ============================================================
// 続きの提案 (入力が止まったとき)
// ============================================================
export async function aiComplete(before, after, { signal } = {}) {
  const prefix = before.slice(-3000)
  const suffix = after.slice(0, 800)
  let text = await llm.complete(prefix, suffix, { signal, maxTokens: 64 })
  if (!text) return ''
  text = text.replace(/\r/g, '').replace(/<\|[^|]*\|>/g, '')
  const curLine = prefix.slice(prefix.lastIndexOf('\n') + 1)
  let lines = text.split('\n')
  // 行の途中なら、その行の残りだけ。行の頭なら、数行まで (空行で止める)
  if (curLine.trim()) lines = lines.slice(0, 1)
  else {
    const out = []
    for (const l of lines) { if (!l.trim() && out.length) break; out.push(l); if (out.length >= 6) break }
    lines = out
  }
  let s = lines.join('\n').replace(/\s+$/, '')
  if (!s.trim()) return ''
  // 後ろにすでに書いてあることは出さない
  const nextLine = suffix.split('\n').find(l => l.trim()) || ''
  if (nextLine.trim() && s.trim() === nextLine.trim()) return ''
  if (/^\s*$/.test(curLine) && curLine.length && s.startsWith(curLine)) s = s.slice(curLine.length)
  return s
}

// ============================================================
// AI が作ったコードの見直し: 構文・未定義の名前 → 直してもらう (2 回まで)。実行できるものは実行して確かめる
// ============================================================
const REPAIR_RULES = 'You are a Python 3 expert. Fix the problems listed and return the complete corrected program in one ```python block. Do not explain.'

export async function refineCode(py, code, { signal, run, onStep = () => {}, gen = llm.generate } = {}) {
  const notes = []
  let cur = code
  for (let round = 0; round < 2; round++) {
    const list = await lint(py, cur)
    const bad = list.filter(d => d.severity === 'error' || /Undefined/.test(d.kind || ''))
    if (!bad.length) break
    onStep('wrench', `見つけた問題 (${bad.length} 件) を AI が直しています`)
    const probs = bad.slice(0, 8).map(d => `line ${d.line}: ${d.msg}`).join('\n')
    const raw = await gen([{ role: 'system', content: REPAIR_RULES }, { role: 'user', content: `\`\`\`python\n${cur}\n\`\`\`\n\nProblems:\n${probs}` }], { signal, maxTokens: 1400, temperature: 0.1, kind: 'chat' })
    const next = codeBlock(raw)
    if (!next || next === cur) break
    cur = next
    notes.push(`問題を ${bad.length} 件直しました`)
  }
  const final = await lint(py, cur)
  if (final.some(d => d.severity === 'error')) notes.push('まだ構文エラーが残っています')
  // 入力や画面を使わないプログラムは、実際に動かして確かめる
  // (通信・ファイルの削除・画面の操作をするコードは、自動では動かさない)
  if (run && !final.some(d => d.severity === 'error') && !/\binput\s*\(|tkinter|turtle|pygame|while\s+True|urllib|requests|http|socket|webbrowser|pyodide|\bjs\b|shutil|os\.remove|os\.unlink|rmdir|getpass/.test(cur)) {
    onStep('play', '作ったコードを試しに実行しています')
    let r = null
    try { r = await run(cur) } catch {}
    if (r && r.errors && r.errors.length) {
      const err = r.errors[0]
      onStep('wrench', '実行エラーを AI が直しています')
      const raw = await gen([{ role: 'system', content: REPAIR_RULES }, { role: 'user', content: `\`\`\`python\n${cur}\n\`\`\`\n\nRunning it failed:\n${String(err.text).split('\n').slice(-8).join('\n')}` }], { signal, maxTokens: 1400, temperature: 0.1, kind: 'chat' })
      const next = codeBlock(raw)
      if (next && next !== cur && !(await lint(py, next)).some(d => d.severity === 'error')) {
        cur = next
        notes.push('実行して見つかったエラーを直しました')
      } else notes.push('実行するとエラーになりました')
    } else if (r && r.started) notes.push('実行して確かめました')
  }
  return { code: cur, notes }
}
