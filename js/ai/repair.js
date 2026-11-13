// Forge AI: コードの自動修復
// ・repairSyntax: 構文エラーを「候補を試して、いちばん先まで解析できるもの」を選ぶ探索で直す
//   (end / then / do / 括弧の不足、!= && || ! などの他の言語の書き方、{ } のブロック、// コメント、打ち間違い …)
// ・fixAll: 全角記号 → 構文 → エディタのチェック (誤字・非推奨・'.' と ':' の取り違え …) の順に、安全な修正だけを入れる
// ・modernize: 古い書き方を新しい書き方に (wait → task.wait、game.Workspace → workspace、Instance.new の第 2 引数 …)
// どの修正も「直した場所と理由」を返すので、AI の返事に一覧で表示できます。
import { checkSyntax } from '../luau/parser.js'
import { Lexer } from '../luau/lexer.js'
import { lintLuau } from '../editor/lint.js'
import { diagnoseBlocks } from '../editor/blocks.js'
import { fixCode, hasSuspect, KEYWORD_FIXES, nearest } from '../editor/typo.js'
import { formatLuau, detectIndentUnit } from '../editor/format.js'
import { EditorState } from '../../vendor/codemirror.js'
import * as db from '../editor/apidb.js'

const KEYWORDS = ['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while', 'continue']

export const lineOf = (text, pos) => { let n = 1; for (let i = 0; i < pos && i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n }
const lineRange = (text, pos) => {
  const s = text.lastIndexOf('\n', pos - 1) + 1
  let e = text.indexOf('\n', pos)
  if (e < 0) e = text.length
  return { s, e }
}
const edit = (text, from, to, insert) => text.slice(0, from) + insert + text.slice(to)

// ============================================================
// エディタのチェック結果の「修正」を、画面なしで当てる
// ============================================================
function headlessView(text) {
  const view = {
    state: EditorState.create({ doc: text }),
    dispatch(spec) { this.state = this.state.update(spec).state },
    focus() {},
  }
  return view
}
export function applyAction(text, diag, action) {
  const view = headlessView(text)
  try { action.apply(view, diag.from, diag.to) } catch { return text }
  return view.state.doc.toString()
}

// ============================================================
// 構文の修復 (探索)
// ============================================================
// 1 つの候補 = { from, to, insert, why, prior }  (prior: もっともらしさ。大きいほど優先)
function candidates(text, err) {
  const out = []
  const add = (from, to, insert, why, prior = 1) => { if (from >= 0 && to >= from && to <= text.length) out.push({ from, to, insert, why, prior }) }
  const pos = Math.min(Math.max(0, err.pos || 0), text.length)
  const msg = err.message || ''
  const { s: ls, e: le } = lineRange(text, pos)
  const line = text.slice(ls, le)
  const prevRange = ls > 0 ? lineRange(text, ls - 1) : null

  // ---- その場所の記号 ----
  const two = text.slice(pos, pos + 2), three = text.slice(pos, pos + 3)
  if (three === '!==') add(pos, pos + 3, '~=', "'!==' → '~='", 9)
  else if (three === '===') add(pos, pos + 3, '==', "'===' → '=='", 9)
  else if (two === '!=') add(pos, pos + 2, '~=', "'!=' → '~=' (Luau の「等しくない」)", 9)
  else if (two === '&&') add(pos, pos + 2, 'and', "'&&' → 'and'", 9)
  else if (two === '||') add(pos, pos + 2, 'or', "'||' → 'or'", 9)
  else if (text[pos] === '!') add(pos, pos + 1, 'not ', "'!' → 'not'", 8)
  // 関数の中で ')' に出会った: `end)` の end を消してしまった形 → ) の前に end
  if (text[pos] === ')' && !/'\)' が必要/.test(msg)) {
    const { s: ls0 } = lineRange(text, pos)
    const ind = /^[ \t]*/.exec(text.slice(ls0))[0]
    const outer = ind.endsWith('\t') ? ind.slice(0, -1) : ind.slice(0, Math.max(0, ind.length - 4))
    const before = text.slice(ls0, pos)
    add(pos, pos, (before.trim() ? '\n' : '') + outer + 'end', "')' の前に 'end' を追加 (関数の終わり)", 7)
  }
  // 条件の中の '=' は比較の書き間違い
  if (text[pos] === '=' && text[pos + 1] !== '=' && /^'(then|do)' が必要/.test(msg)) add(pos, pos + 1, '==', "比較の '=' → '=='", 9)

  // ---- 行ごとの書き換え (他の言語の書き方) ----
  const lineFixes = (rs, re, isErrLine) => {
    const l = text.slice(rs, re)
    const sub = (re2, rep, why, prior) => {
      const m = re2.exec(l)
      if (!m) return
      const next = l.replace(re2, rep)
      if (next !== l) add(rs, re, next, why, prior)
    }
    sub(/^(\s*)(\/\/+|#)\s?/, '$1-- ', 'コメントは -- で書きます', 9)
    sub(/\/\*/, '--[[', "'/*' → '--[['", 7)
    sub(/\*\//, ']]', "'*/' → ']]'", 7)
    sub(/^(\s*)(?:const|let|var)\s+/, '$1local ', "'const / let / var' → 'local'", 8)
    sub(/\belse\s+if\b/, 'elseif', "'else if' → 'elseif'", 6)
    sub(/\belif\b/, 'elseif', "'elif' → 'elseif'", 8)
    sub(/^(\s*)([\w.[\]"']+)\s*\+\+\s*;?\s*$/, '$1$2 += 1', "'++' → '+= 1'", 8)
    sub(/^(\s*)(if|elseif)\s*\((.*)\)\s*\{\s*$/, '$1$2 $3 then', "'{' → 'then'", 9)
    sub(/^(\s*)(if|elseif)\s+(.*?)\s*\{\s*$/, '$1$2 $3 then', "'{' → 'then'", 9)
    sub(/^(\s*)(while|for)\s*\((.*)\)\s*\{\s*$/, '$1$2 $3 do', "'{' → 'do'", 9)
    sub(/^(\s*)(while|for)\s+(.*?)\s*\{\s*$/, '$1$2 $3 do', "'{' → 'do'", 9)
    sub(/^(\s*)((?:local\s+)?function\b.*\))\s*\{\s*$/, '$1$2', "関数の '{' は不要", 9)
    sub(/^(\s*)\}\s*else\s*if\s*\((.*)\)\s*\{\s*$/, '$1elseif $2 then', "'} else if {' → 'elseif ... then'", 9)
    sub(/^(\s*)\}\s*else\s*\{\s*$/, '$1else', "'} else {' → 'else'", 9)
    sub(/^(\s*)\}\s*\)?\s*;?\s*$/, (m, a) => a + (/\)\s*;?\s*$/.test(m) ? 'end)' : 'end'), "'}' → 'end'", 8)
    sub(/^(\s*)(if|elseif)\s+(.*?):\s*$/, '$1$2 $3 then', "':' → 'then'", 9)
    sub(/^(\s*)(while|for)\s+(.*?):\s*$/, '$1$2 $3 do', "':' → 'do'", 9)
    sub(/^(\s*)else:\s*$/, '$1else', "'else:' → 'else'", 9)
    sub(/^(\s*)def\s+([A-Za-z_]\w*)\s*\((.*)\)\s*:\s*$/, '$1local function $2($3)', "'def' → 'local function'", 9)
    sub(/^(\s*)(?:public\s+|static\s+)*(?:void|int|function)\s+([A-Za-z_]\w*)\s*\((.*)\)\s*\{\s*$/, '$1local function $2($3)', "関数の書き方を Luau に", 8)
    sub(/;\s*$/, '', "行末の ';' (不要)", 2)
    // then / do の付け忘れ
    if (isErrLine || /^'(then|do)' が必要/.test(msg)) {
      const code = l.replace(/\s*--.*$/, '')
      if (/^\s*(if|elseif)\b/.test(code) && !/\bthen\b/.test(code)) add(rs + code.length, rs + code.length, ' then', "'then' を追加", 8)
      if (/^\s*(while|for)\b/.test(code) && !/\bdo\b/.test(code)) add(rs + code.length, rs + code.length, ' do', "'do' を追加", 8)
    }
    // 括弧の閉じ忘れ (行の中で数が合わない)
    const code = l.replace(/--.*$/, '').replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""')
    const opens = (code.match(/\(/g) || []).length - (code.match(/\)/g) || []).length
    if (opens > 0 && !/\bfunction\s*\(/.test(code)) {
      const end = rs + l.replace(/\s*--.*$/, '').replace(/\s+$/, '').length
      add(end, end, ')'.repeat(opens), "閉じ括弧 ')' を追加", 6)
    }
    const sq = (code.match(/\[/g) || []).length - (code.match(/\]/g) || []).length
    if (sq > 0) { const end = rs + l.replace(/\s*--.*$/, '').replace(/\s+$/, '').length; add(end, end, ']'.repeat(sq), "']' を追加", 5) }
    // 閉じていない文字列
    const strs = l.replace(/--.*$/, '')
    for (const q of ['"', "'"]) {
      const cnt = (strs.replace(/\\./g, '').match(new RegExp(q, 'g')) || []).length
      if (cnt % 2 === 1) {
        // 行末の閉じ括弧の前で閉じる: print("abc)  →  print("abc")
        const body = l.replace(/\s+$/, '')
        const tail = /[)\]},\s]*$/.exec(body)[0]
        if (tail.trim()) add(rs + body.length - tail.length, rs + body.length - tail.length, q, `閉じていない文字列に ${q} を追加`, 8)
        add(re, re, q, `閉じていない文字列に ${q} を追加`, 7)
      }
    }
    // キーワードの打ち間違い
    const wre = /[A-Za-z_]\w*/g
    let m
    while ((m = wre.exec(l))) {
      const w = m[0]
      if (KEYWORDS.includes(w)) continue
      const fix = Object.prototype.hasOwnProperty.call(KEYWORD_FIXES, w) ? KEYWORD_FIXES[w] : (w.length >= 4 ? nearest(w, KEYWORDS, w.length >= 6 ? 2 : 1) : null)
      if (fix && KEYWORDS.includes(fix)) add(rs + m.index, rs + m.index + w.length, fix, `'${w}' → '${fix}' (打ち間違い)`, 7)
      else if (w === 'True' || w === 'False' || w === 'None' || w === 'null') add(rs + m.index, rs + m.index + w.length, { True: 'true', False: 'false', None: 'nil', null: 'nil' }[w], `'${w}' → Luau の書き方`, 4)
    }
  }
  lineFixes(ls, le, true)
  if (prevRange && prevRange.s !== ls) lineFixes(prevRange.s, prevRange.e, false)

  // ---- end の過不足 (ブロック構造から) ----
  try {
    for (const d of diagnoseBlocks(text)) {
      if (d.kind === 'missing' && d.insertAt !== undefined) add(d.insertAt, d.insertAt, d.insertText, `'${d.insertText.trim()}' を追加 (${lineOf(text, d.from)} 行目のブロック)`, 8)
      if (d.kind === 'extra' && d.removeFrom !== undefined) add(d.removeFrom, d.removeTo, '', `余分な '${text.slice(d.from, d.to)}' を削除 (${lineOf(text, d.from)} 行目)`, 7)
    }
  } catch {}

  // ---- 「')' が必要」: 直前の end の後ろに ) (:Connect(function() ... end の閉じ忘れ) ----
  if (/'\)' が必要/.test(msg)) {
    const before = text.slice(0, pos)
    const m = /\bend\b(?![\s\S]*\bend\b)/.exec(before)
    if (m) add(m.index + 3, m.index + 3, ')', "'end' の後ろに ')' を追加 (関数の閉じ括弧)", 7)
    const prevEnd = before.replace(/\s+$/, '').length
    add(prevEnd, prevEnd, ')', "')' を追加", 5)
  }
  if (/'\}' が必要/.test(msg)) {
    // テーブルの項目の間のカンマ忘れ
    const prevEnd = text.slice(0, pos).replace(/\s+$/, '').length
    if (/[\w"'\])}]$/.test(text.slice(0, prevEnd))) add(prevEnd, prevEnd, ',', "テーブルの項目の間に ',' を追加", 7)
    add(prevEnd, prevEnd, '\n}', "'}' を追加", 3)
  }
  if (/'end' が必要|ファイルが終わりました/.test(msg)) {
    const at = text.replace(/\s+$/, '').length
    add(at, at, '\nend', "'end' を追加", 4)
    // 'else if' は入れ子の if になるので end が 1 つ足りなくなる
    const ei = /\belse[ \t]+if\b/.exec(text)
    if (ei) add(ei.index, ei.index + ei[0].length, 'elseif', "'else if' → 'elseif'", 8)
  }

  // ---- 一般的な候補 (最後の手段) ----
  const tokEnd = (() => { let i = pos; if (/[\w]/.test(text[i] || '')) while (i < text.length && /\w/.test(text[i])) i++; else i = Math.min(text.length, pos + 1); return i })()
  if (pos < text.length && !/["'\[]/.test(text[pos])) add(pos, tokEnd, '', `'${text.slice(pos, tokEnd)}' を削除`, 0.3)
  for (const ins of ['then', 'do', 'end', ')', ',', '=']) add(pos, pos, ins + ' ', `'${ins}' を追加`, 0.3)
  return out
}

// 修復の評価: 解析できたら最高点。できなければ、どれだけ先まで進んだか
function evaluate(text, err, c) {
  const next = edit(text, c.from, c.to, c.insert)
  const e2 = checkSyntax(next)
  if (!e2) return { next, score: 985 + c.prior * 10, ok: true }
  const delta = c.insert.length - (c.to - c.from)
  const shifted = (err.pos || 0) + (c.from <= (err.pos || 0) ? delta : 0)
  const progress = (e2.pos || 0) - shifted
  if (progress <= 0) return { next, score: -1, ok: false, err: e2 }
  return { next, score: Math.min(200, Math.log2(1 + progress) * 10) + c.prior * 2, ok: false, err: e2 }
}

export function repairSyntax(src, { maxSteps = 24 } = {}) {
  let text = String(src)
  const fixes = []
  if (hasSuspect(text)) {
    const f = fixCode(text)
    if (f !== text) { text = f; fixes.push({ line: 0, why: '全角の記号・見えない文字を半角に' }) }
  }
  const seen = new Set([text])
  for (let step = 0; step < maxSteps; step++) {
    const err = checkSyntax(text)
    if (!err) return { text, fixes, ok: true }
    let best = null
    const tried = []
    for (const c of candidates(text, err)) {
      const r = evaluate(text, err, c)
      if (r.score < 0 || seen.has(r.next)) continue
      tried.push({ ...r, c })
      if (!best || r.score > best.score) best = { ...r, c }
    }
    // 1 手では直らない候補も、もう 1 手先まで読んで比べる (例: 文字列の閉じ忘れ → " と ) の 2 つが必要)
    if (text.length < 30000) {
      const partial = tried.filter(r => !r.ok && r.c.prior >= 2).sort((a, b) => b.score - a.score).slice(0, 6)
      for (const r of partial) {
        let best2 = null
        for (const c2 of candidates(r.next, r.err)) {
          if (c2.prior < 2) continue
          const n2 = edit(r.next, c2.from, c2.to, c2.insert)
          if (checkSyntax(n2)) continue
          const sc = 970 + (r.c.prior + c2.prior) * 5
          if (!best2 || sc > best2) best2 = sc
        }
        if (best2 && best2 > best.score) best = { ...r, score: best2 }
      }
    }
    if (!best) return { text, fixes, ok: false, error: err }
    fixes.push({ line: lineOf(text, best.c.from), why: best.c.why })
    text = best.next
    seen.add(text)
  }
  const err = checkSyntax(text)
  return { text, fixes, ok: !err, error: err || undefined }
}

// ============================================================
// エディタのチェック結果のうち、安全に自動で直せるもの
// ============================================================
const SAFE_MESSAGE = /(task\.\w+ に置き換え|Connect に置き換え|Destroy に置き換え|':' に置き換え|'\.' に置き換え|に直す|task\.wait\(\) を追加|半角に直す|'elseif' に直す)/
export function safeFixesOf(text, opts) {
  let diags = []
  try { diags = lintLuau(text, opts) } catch { return [] }
  return diags.filter(d => d.actions && d.actions.length && d.severity !== 'hint' && SAFE_MESSAGE.test(d.actions[0].name) && !/ファイル全体/.test(d.actions[0].name))
}

export function applyLintFixes(src, opts = {}, { rounds = 4, only } = {}) {
  let text = src
  const fixes = []
  for (let r = 0; r < rounds; r++) {
    let list = safeFixesOf(text, opts)
    if (only) list = list.filter(only)
    if (!list.length) break
    // 後ろから当てる (前の位置がずれないように)。重なるものは次の回に
    list.sort((a, b) => b.from - a.from)
    let next = text, lastFrom = Infinity
    const applied = []
    for (const d of list) {
      if (d.to > lastFrom) continue
      const after = applyAction(next, d, d.actions[0])
      if (after === next) continue
      next = after
      lastFrom = d.from
      applied.push({ line: lineOf(text, d.from), why: d.actions[0].name.replace(/^'(.*)' に直す$/, "'$1' に修正") + (d.source === '誤字' ? ` (${d.message.replace(/。.*$/, '')})` : '') })
    }
    // 直した結果、構文が壊れたら当てない
    if (!applied.length || (checkSyntax(next) && !checkSyntax(text))) break
    text = next
    fixes.push(...applied.reverse())
  }
  return { text, fixes }
}

// ============================================================
// まとめて直す
// ============================================================
export function fixAll(src, opts = {}) {
  const fixes = []
  let text = src
  const syn = repairSyntax(text)
  text = syn.text
  fixes.push(...syn.fixes)
  if (!syn.ok) return { text, fixes, ok: false, error: syn.error }
  const lf = applyLintFixes(text, opts)
  text = lf.text
  fixes.push(...lf.fixes)
  return { text, fixes, ok: true }
}

// ============================================================
// 近代化 (古い書き方 → 新しい書き方)
// ============================================================
// コードのトークン (文字列・コメント以外) の位置を返す
export function codeTokens(src) {
  const lx = new Lexer(src)
  lx.comments = []
  const toks = []
  try {
    for (let t = lx.next(); t.t !== 'eof'; t = lx.next()) toks.push(t)
  } catch { return null }
  return toks
}

export function modernize(src, opts = {}) {
  let text = src
  const fixes = []
  // 1) エディタのチェックの置き換え (wait → task.wait、:connect → :Connect、:Remove → :Destroy)
  const lf = applyLintFixes(text, { ...opts, undefinedGlobals: false }, { only: d => /(task\.|Connect|Destroy)/.test(d.actions[0].name) })
  text = lf.text
  fixes.push(...lf.fixes)
  const toks = codeTokens(text)
  if (!toks) return { text, fixes }
  const edits = []
  const isService = n => { try { return db.apiReady() ? db.isService(n) : /^(Players|ReplicatedStorage|ServerStorage|ServerScriptService|Lighting|TweenService|RunService|UserInputService|SoundService|StarterGui|StarterPack|StarterPlayer|Teams|Debris|HttpService|MarketplaceService|DataStoreService|CollectionService|PathfindingService|TextChatService|Chat|ContextActionService)$/.test(n) } catch { return false } }
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    const prev = toks[i - 1]
    if (prev && (prev.t === '.' || prev.t === ':')) continue
    // game.Workspace / game:GetService("Workspace") → workspace
    if (t.t === 'name' && t.v === 'game' && toks[i + 1] && toks[i + 1].t === '.' && toks[i + 2] && toks[i + 2].t === 'name') {
      const name = toks[i + 2].v
      const after = toks[i + 3]
      if (after && (after.t === '=' || /=$/.test(after.t))) continue
      if (name === 'Workspace') { edits.push({ from: t.s, to: toks[i + 2].e, insert: 'workspace', why: "'game.Workspace' → 'workspace'" }); i += 2; continue }
      if (isService(name) && name !== 'Workspace') { edits.push({ from: t.s, to: toks[i + 2].e, insert: `game:GetService("${name}")`, why: `'game.${name}' → 'game:GetService("${name}")'` }); i += 2; continue }
    }
    if (t.t === 'name' && t.v === 'game' && toks[i + 1] && toks[i + 1].t === ':' && toks[i + 2] && toks[i + 2].v === 'GetService' && toks[i + 3] && toks[i + 3].t === '(' && toks[i + 4] && toks[i + 4].t === 'string' && toks[i + 4].v === 'Workspace' && toks[i + 5] && toks[i + 5].t === ')') {
      edits.push({ from: t.s, to: toks[i + 5].e, insert: 'workspace', why: "'game:GetService(\"Workspace\")' → 'workspace'" }); i += 5; continue
    }
    // table.getn(t) → #t
    if (t.t === 'name' && t.v === 'table' && toks[i + 1] && toks[i + 1].t === '.' && toks[i + 2] && toks[i + 2].v === 'getn' && toks[i + 3] && toks[i + 3].t === '(' && toks[i + 4] && toks[i + 4].t === 'name' && toks[i + 5] && toks[i + 5].t === ')') {
      edits.push({ from: t.s, to: toks[i + 5].e, insert: '#' + toks[i + 4].v, why: "'table.getn(t)' → '#t'" }); i += 5; continue
    }
    // unpack( → table.unpack(
    if (t.t === 'name' && t.v === 'unpack' && toks[i + 1] && toks[i + 1].t === '(' && !/\blocal\s+(function\s+)?unpack\b/.test(text)) edits.push({ from: t.s, to: t.e, insert: 'table.unpack', why: "'unpack' → 'table.unpack'" })
  }
  edits.sort((a, b) => b.from - a.from)
  for (const e of edits) { fixes.push({ line: lineOf(text, e.from), why: e.why }); text = edit(text, e.from, e.to, e.insert) }
  // 2) local x = Instance.new("Class", parent) → Parent は最後に
  const r = moveParentLast(text)
  text = r.text
  fixes.push(...r.fixes)
  // 3) x = x + 1 → x += 1 (右辺が 1 つの値のときだけ: 意味が変わらないように)
  const lines = text.split('\n')
  let changed = false
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)([A-Za-z_][\w.]*)\s*=\s*([A-Za-z_][\w.]*)\s*([+\-*/]|\.\.)\s*([A-Za-z_][\w.]*|\d+(?:\.\d+)?|"[^"\\]*")\s*(--.*)?$/.exec(lines[i])
    if (m && m[2] === m[3]) {
      lines[i] = `${m[1]}${m[2]} ${m[4]}= ${m[5]}${m[6] ? ' ' + m[6] : ''}`
      fixes.push({ line: i + 1, why: `'${m[2]} = ${m[2]} ${m[4]} …' → '${m[2]} ${m[4]}= …'` })
      changed = true
    }
  }
  if (changed) {
    const next = lines.join('\n')
    if (!checkSyntax(next)) text = next
  }
  return { text, fixes: fixes.sort((a, b) => a.line - b.line) }
}

function moveParentLast(src) {
  const lines = src.split('\n')
  const fixes = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)local\s+([A-Za-z_]\w*)\s*=\s*Instance\.new\(\s*("[^"]+"|'[^']+')\s*,\s*(.+?)\)\s*(--.*)?$/.exec(lines[i])
    if (!m) continue
    const [, ind, name, cls, parent, cmt] = m
    if (/[()]/.test(parent) && (parent.match(/\(/g) || []).length !== (parent.match(/\)/g) || []).length) continue
    lines[i] = `${ind}local ${name} = Instance.new(${cls})${cmt ? ' ' + cmt : ''}`
    // 続けて name.Xxx = ... を設定している行の後ろに Parent を置く
    let j = i + 1
    const re = new RegExp(`^${ind.replace(/\t/g, '\\t')}${name}\\.\\w+\\s*=`)
    while (j < lines.length && re.test(lines[j])) j++
    lines.splice(j, 0, `${ind}${name}.Parent = ${parent.trim()}`)
    fixes.push({ line: i + 1, why: `Instance.new の第 2 引数をやめて、${name}.Parent を最後に設定 (速く・安全)` })
  }
  const text = lines.join('\n')
  if (fixes.length && checkSyntax(text)) return { text: src, fixes: [] }
  return { text, fixes }
}

// 整形 (字下げの単位は今のコードに合わせる)
export function formatCode(src) {
  const unit = detectIndentUnit(src) || '\t'
  try { return formatLuau(src, unit) } catch { return src }
}
