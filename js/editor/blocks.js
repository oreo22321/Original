// Luau のブロック構造 (function / if / for / while / do / repeat) を調べる軽量スキャナ
// 入力途中の壊れたコードでも止まらないように、専用の寛容な字句解析を使います。
// ・end の自動入力の判定
// ・「end が足りない / 余分」なときに、どのブロックが原因かを特定
const TOKEN_RE = /--\[(=*)\[[\s\S]*?(?:\]\1\]|$)|--[^\n]*|\[(=*)\[[\s\S]*?(?:\]\2\]|$)|"(?:\\[\s\S]|[^"\\\n])*(?:"|(?=\n)|$)|'(?:\\[\s\S]|[^'\\\n])*(?:'|(?=\n)|$)|`(?:\\[\s\S]|[^`\\])*(?:`|$)|[A-Za-z_][A-Za-z0-9_]*|0[xXbB]\w*|(?:\d[\d_]*(?:\.(?!\.)[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?\w*|\.\.\.|\.\.=?|[=~<>]=|::|->|\/\/=?|[+\-*/%^]=|\S/g

const KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while'])

// 式の途中であることを示す直前のトークン (この後の if は if 式)
const EXPR_PREV = new Set(['=', '(', ',', '{', '[', 'return', 'and', 'or', 'not', '+', '-', '*', '/', '//', '%', '^', '..', '==', '~=', '<', '>', '<=', '>=', '+=', '-=', '*=', '/=', '//=', '%=', '^=', '..=', 'in', 'until', 'while', 'if', 'elseif', '::', '#'])

export function lightTokens(text, keepComments = false) {
  const out = []
  TOKEN_RE.lastIndex = 0
  let m
  while ((m = TOKEN_RE.exec(text))) {
    const s = m[0]
    const c = s.charCodeAt(0)
    let t
    if (c === 45 && s.charCodeAt(1) === 45) { if (keepComments) out.push({ t: 'comment', s: m.index, e: m.index + s.length }); continue }
    if (c === 34 || c === 39 || c === 96 || (c === 91 && (s.charCodeAt(1) === 91 || s.charCodeAt(1) === 61) && s.length > 1)) t = 'str'
    else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95) t = KEYWORDS.has(s) ? s : 'name'
    else if ((c >= 48 && c <= 57) || (c === 46 && s.length > 1 && s.charCodeAt(1) >= 48 && s.charCodeAt(1) <= 57)) t = 'num'
    else t = s
    out.push({ t, s: m.index, e: m.index + s.length })
  }
  return out
}

function lineIndex(text) {
  const starts = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  return starts
}

export function makeLineInfo(text, tabSize = 4) {
  const starts = lineIndex(text)
  const lineOf = pos => {
    let lo = 0, hi = starts.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1 }
    return lo
  }
  const indentCache = new Map()
  const indentOfLine = ln => {
    let v = indentCache.get(ln)
    if (v !== undefined) return v
    v = 0
    for (let i = starts[ln]; i < text.length; i++) {
      const ch = text.charCodeAt(i)
      if (ch === 32) v++
      else if (ch === 9) v += tabSize - (v % tabSize)
      else break
    }
    indentCache.set(ln, v)
    return v
  }
  const lineEnd = ln => (ln + 1 < starts.length ? starts[ln + 1] - 1 : text.length)
  const isBlank = ln => !/\S/.test(text.slice(starts[ln], lineEnd(ln)))
  return { starts, lineOf, indentOfLine, lineEnd, isBlank, indentAt: pos => indentOfLine(lineOf(pos)) }
}

// 返り値: { tokens, blocks, unclosed, extra }
//   blocks: [{ kind, s, e, headerEnd?, close: {s,e} | null }]  (if 式は含みません)
//   unclosed: 閉じられていないブロック (外側から順)
//   extra: 対応するブロックがない end / until
// 各トークンには role が付きます:
//   'open' (ブロック開始) / 'close' (end・until) / 'mid' (文の else・elseif) / 'expr' (if 式の一部)
export function scanBlocks(text, keepComments = false, opts = null) {
  const tokens = lightTokens(text, keepComments)
  const strictDo = !!(opts && opts.strictDo)
  const blocks = []
  const stack = []
  const extra = []
  let prev = null
  let fn = null // function のヘッダー (引数リスト) を追跡中
  const popExprs = () => { while (stack.length && stack[stack.length - 1].kind === 'ifexpr') stack.pop() }
  const topReal = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind !== 'ifexpr') return stack[i]; return null }
  const open = (kind, tok) => {
    const b = { kind, s: tok.s, e: tok.e, close: null }
    stack.push(b)
    if (kind !== 'ifexpr') { blocks.push(b); tok.role = 'open' } else tok.role = 'expr'
    return b
  }
  for (const tok of tokens) {
    const t = tok.t
    if (t === 'comment') continue
    if (fn) {
      if (!fn.started) {
        if (t === '(') { fn.started = true; fn.depth = 1 } else if (!(t === 'name' || t === '.' || t === ':' || t === '<' || t === '>' || t === ',')) fn = null
      } else if (t === '(') fn.depth++
      else if (t === ')' && --fn.depth === 0) { fn.block.headerEnd = tok.e; fn = null }
    }
    switch (t) {
      case 'function': fn = { block: open('function', tok), started: false, depth: 0 }; break
      case 'if': {
        const top = stack[stack.length - 1]
        const isExpr = prev && (EXPR_PREV.has(prev.t) || ((prev.t === 'then' || prev.t === 'else') && top && top.kind === 'ifexpr'))
        open(isExpr ? 'ifexpr' : 'if', tok)
        break
      }
      case 'while': case 'for': open(t, tok).needDo = true; break
      case 'repeat': open('repeat', tok).headerEnd = tok.e; break
      case 'do': {
        const top = topReal()
        if (top && top.needDo) { top.needDo = false; top.headerEnd = tok.e; popExprs() }
        // strictDo: 同じ行で値の直後にある do は、for / while の見出しが消えた残り (ブロックとして数えない)
        else if (strictDo && prev && VALUE_END.has(prev.t) && !text.slice(prev.e, tok.s).includes('\n')) tok.role = 'orphan'
        else open('do', tok).headerEnd = tok.e
        break
      }
      case 'then': {
        const top = stack[stack.length - 1]
        if (top && top.kind === 'ifexpr' && !top.then) { top.then = true; tok.role = 'expr' }
        else { const b = topReal(); if (b && b.kind === 'if' && b.headerEnd === undefined) b.headerEnd = tok.e }
        break
      }
      case 'else': case 'elseif': {
        // else まで済んだ if 式はもう続かないので取り除く
        while (stack.length && stack[stack.length - 1].kind === 'ifexpr' && stack[stack.length - 1].done) stack.pop()
        const top = stack[stack.length - 1]
        if (top && top.kind === 'ifexpr') { tok.role = 'expr'; if (t === 'else') top.done = true; else top.then = false } else tok.role = 'mid'
        break
      }
      case 'end': case 'until': {
        popExprs()
        const top = stack[stack.length - 1]
        tok.role = 'close'
        if (!top || (t === 'until' && top.kind !== 'repeat')) extra.push(tok)
        else { stack.pop(); top.close = { s: tok.s, e: tok.e, t } }
        break
      }
    }
    prev = tok
  }
  return { tokens, blocks, unclosed: stack.filter(b => b.kind !== 'ifexpr'), extra }
}

// pos を含むいちばん内側の (まだ閉じていない、または pos より後ろで閉じる) ブロック
function innermostAt(blocks, pos) {
  let best = null
  for (const b of blocks) {
    if (b.s >= pos) break
    if (!b.close || b.close.s >= pos) best = b
  }
  return best
}

// カーソルがブロックの見出し (then / do / function(...) / repeat) の直後にあるとき、
// そのブロックの情報を返します: { block, closer: 'end' | 'until ', needsCloser, closedOnLine }
export function headerAt(text, pos, tabSize = 4) {
  const scan = scanBlocks(text)
  const { tokens, blocks } = scan
  const info = makeLineInfo(text, tabSize)
  const line = info.lineOf(pos)
  // カーソル直前のトークン (同じ行にあること)
  let last = null
  for (const tok of tokens) { if (tok.e > pos) break; last = tok }
  if (!last || info.lineOf(last.s) !== line) return null
  const block = innermostAt(blocks, pos)
  if (!block) return null
  let atHeader = false
  // elseif ... then や if 式の then は対象外 (headerEnd は最初の then の位置)
  if (last.t === 'then') atHeader = block.kind === 'if' && last.role !== 'expr'
  else if (last.t === 'do') atHeader = (block.kind === 'while' || block.kind === 'for' || block.kind === 'do') && block.headerEnd === last.e
  else if (last.t === 'repeat') atHeader = block.kind === 'repeat' && block.s === last.s
  // else / elseif ... then の後ろ (if 文がまだ閉じていなければ end を足す)
  else if (last.t === 'else' && last.role === 'mid') atHeader = block.kind === 'if'
  else if (block.kind === 'function' && block.headerEnd !== undefined && pos >= block.headerEnd) {
    // function(...) の後ろに戻り値の型注釈だけがある
    const between = text.slice(block.headerEnd, pos).replace(/--.*$/, '')
    atHeader = /^\s*(:\s*[^=\n]+?)?\s*$/.test(between) && !/\b(end|then|do|return|local)\b/.test(between)
  }
  if (!atHeader) return null
  const closer = block.kind === 'repeat' ? 'until ' : 'end'
  return { block, closer, needsCloser: needsCloserFor(scan, info, block, line), closedOnLine: !!block.close && info.lineOf(block.close.s) === line }
}

// ブロックに end を足す必要があるか (閉じていない、または end を外側のブロックに取られている)
function needsCloserFor(scan, info, block, line) {
  if (!block.close) return true
  const outer = scan.unclosed.filter(b => b.s < block.s)
  if (!outer.length) return false
  // どこかで end が足りない。インデントから「この end は自分のものか」を推定
  const mine = info.indentAt(block.s)
  const closeInd = info.indentAt(block.close.s)
  const closeLine = info.lineOf(block.close.s)
  if (closeLine === line) return false
  if (closeInd < mine) return true
  if (closeInd === mine) return info.indentAt(outer[outer.length - 1].s) >= mine
  return false
}

// ============================================================
// 入力に合わせた end の自動挿入・自動削除
// ============================================================
const STRICT = { strictDo: true }
const OPENER_WORD = /(?:^|[^\w])(if|for|while|function|repeat|do)(?![\w])/
const VALUE_END = new Set(['name', 'num', 'str', ')', ']', '}', 'true', 'false', 'nil', '...'])

// 見出し (if ... then / for ... do / while ... do / function(...)) を書き終えた直後なら、
// 追加する end の情報を返します: { at, text, block }  (at から行末までを text に置き換え)
//   ・then / do はカーソルがその直後 (行の残りは空かコメント)
//   ・function はカーソルが引数リストの中か直後 (行の残りは閉じ括弧だけ)
export function completedHeader(text, pos, tabSize = 4) {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  let lineEnd = text.indexOf('\n', pos)
  if (lineEnd < 0) lineEnd = text.length
  const before = text.slice(lineStart, pos)
  const rest = text.slice(pos, lineEnd)
  const kw = /(?:^|[^\w])(then|do)$/.exec(before)
  if (!kw && !/\bfunction\b/.test(before)) return null
  if (kw && !/^\s*(--.*)?$/.test(rest)) return null
  if (text.length > 400000) return null
  const scan = scanBlocks(text)
  const info = makeLineInfo(text, tabSize)
  const line = info.lineOf(pos)
  let block = null, cut = lineEnd
  if (kw) {
    let i = scan.tokens.findIndex(t => t.e === pos)
    if (i < 1) return null
    const tok = scan.tokens[i], prev = scan.tokens[i - 1]
    // 条件が書きかけ (if then / while x and do など) なら入れない
    if (!VALUE_END.has(prev.t)) return null
    const b = innermostAt(scan.blocks, pos)
    if (!b || info.lineOf(b.s) !== line) return null
    if (tok.t === 'then' && !(b.kind === 'if' && b.headerEnd === tok.e)) return null
    if (tok.t === 'do' && !((b.kind === 'while' || b.kind === 'for') && b.headerEnd === tok.e)) return null
    block = b
  } else {
    // カーソルを含む function の見出し
    for (const b of scan.blocks) {
      if (b.s >= pos) break
      if (b.kind !== 'function' || b.headerEnd === undefined || info.lineOf(b.s) !== line) continue
      const open = scan.tokens.find(t => t.s >= b.e && t.t === '(')
      if (open && open.s < pos && pos <= b.headerEnd) block = b
    }
    if (!block) return null
    const after = text.slice(block.headerEnd, lineEnd)
    // 戻り値の型注釈のあとに閉じ括弧だけが続く
    const m = /^(\s*(?::\s*[\w.<>, ?|&{}]+?)?)\s*([)\]},;\s]*)$/.exec(after)
    if (!m || /^\s*:\s*$/.test(m[1])) return null
    cut = block.headerEnd + m[1].length
  }
  if (!needsCloserFor(scan, info, block, line)) return null
  const trailing = text.slice(cut, lineEnd).trim()
  // ブロックの中身にあたる行 (見出しより深いインデントが続く範囲) の後ろに置く
  const ind = info.indentOfLine(line)
  let last = line
  for (let ln = line + 1; ln < info.starts.length; ln++) {
    if (info.isBlank(ln)) continue
    if (info.indentOfLine(ln) <= ind) break
    last = ln
  }
  const lead = /^[ \t]*/.exec(text.slice(info.starts[line], lineEnd))[0]
  const insert = '\n' + lead + 'end' + trailing
  if (last === line) return { changes: [{ from: cut, to: lineEnd, insert }], at: cut, offset: 1 + lead.length, block }
  // 既存の行を包む: 本体 (見出しより深いインデントの行) の後ろに end を置く
  const at = info.lineEnd(last)
  const changes = [{ from: at, insert }]
  if (trailing) changes.unshift({ from: cut, to: lineEnd })
  return { changes, at, offset: 1 + lead.length, block }
}

// 削除でブロックの開始語 (if / for / while / function / repeat / do) が消えたとき、
// それと対になっていた end (until) の削除範囲を返します (新しい文書での位置)。
//   changes: 旧→新の ChangeSet (iterChanges と mapPos を持つもの)
export function orphanedClosers(oldText, newText, changes) {
  const removed = []
  changes.iterChanges((fromA, toA) => { if (toA > fromA) removed.push([fromA, toA]) })
  if (!removed.length) return []
  // 速い判定: 消した範囲 (の前後の単語を含む) にブロックの開始語があるか
  const isW = c => /[\w]/.test(c || '')
  const hit = removed.some(([a, b]) => {
    while (a > 0 && isW(oldText[a - 1])) a--
    while (b < oldText.length && isW(oldText[b])) b++
    return OPENER_WORD.test(oldText.slice(a, b))
  })
  if (!hit || oldText.length > 400000) return []
  const touched = (s, e) => removed.some(([a, b]) => a < e && b > s)
  const old = scanBlocks(oldText, false, STRICT)
  const cands = old.blocks.filter(b => b.close && touched(b.s, b.e) && !touched(b.close.s, b.close.e))
  if (!cands.length) return []
  const now = scanBlocks(newText, false, STRICT)
  if (now.extra.length - old.extra.length !== cands.length) return []
  const brackets = strayClosers(now.tokens)
  const out = []
  for (const b of cands) {
    const s = changes.mapPos(b.close.s, 1)
    const tok = now.tokens.find(t => t.s === s)
    if (!tok || tok.t !== b.close.t) return []
    const ls = newText.lastIndexOf('\n', s - 1) + 1
    let le = newText.indexOf('\n', s)
    if (le < 0) le = newText.length
    const lead = newText.slice(ls, s)
    let tail = newText.slice(tok.e, le)
    if (b.close.t === 'until') tail = ''
    // end の後ろが、対応する開き括弧を失った閉じ括弧だけ ( end) など ) ならまとめて消す
    const tailToks = now.tokens.filter(t => t.s >= tok.e && t.s < le)
    const strayTail = tailToks.length > 0 && tailToks.every(t => brackets.has(t.s) || t.t === ',' || t.t === ';')
    if (!lead.trim() && (!tail.trim() || /^\s*--/.test(tail) || strayTail)) {
      // 行ごと消す (前の改行も含めて、空行を残さない)
      out.push(ls > 0 ? { from: ls - 1, to: le } : { from: 0, to: Math.min(newText.length, le + 1) })
    } else {
      const to = b.close.t === 'until' ? le : tok.e
      out.push({ from: lead.trim() && lead.endsWith(' ') ? tok.s - 1 : tok.s, to })
    }
  }
  // 消した結果、end の過不足が元より悪くならないことを確かめる
  const sorted = out.sort((a, b) => b.from - a.from)
  let result = newText
  for (const r of sorted) result = result.slice(0, r.from) + result.slice(r.to)
  const check = scanBlocks(result, false, STRICT)
  if (check.extra.length > old.extra.length || check.unclosed.length > old.unclosed.length) return []
  return sorted.reverse()
}

// 対応する開き括弧がない閉じ括弧の位置
function strayClosers(tokens) {
  const stack = [], stray = new Set()
  const pair = { ')': '(', ']': '[', '}': '{' }
  for (const t of tokens) {
    if (t.t === '(' || t.t === '[' || t.t === '{') stack.push(t.t)
    else if (pair[t.t]) {
      if (stack.length && stack[stack.length - 1] === pair[t.t]) stack.pop()
      else stray.add(t.s)
    }
  }
  return stray
}

// end の過不足を診断します。
// 返り値: [{ kind: 'missing' | 'extra', from, to, message, insertAt?, insertText?, removeFrom?, removeTo? }]
export function diagnoseBlocks(text, tabSize = 4) {
  const scan = scanBlocks(text)
  if (!scan.unclosed.length && !scan.extra.length) return []
  const info = makeLineInfo(text, tabSize)
  const out = []
  const WORD = { function: 'function', if: 'if', for: 'for', while: 'while', do: 'do', repeat: 'repeat' }
  if (scan.unclosed.length) {
    // 「end を奪われた」ブロックのうち、いちばん内側が原因
    let culprit = null, guessed = false
    for (const b of scan.blocks) {
      if (!b.close) continue
      const openLine = info.lineOf(b.s), closeLine = info.lineOf(b.close.s)
      if (closeLine !== openLine && info.indentOfLine(closeLine) < info.indentOfLine(openLine)) culprit = b
    }
    if (!culprit) { culprit = scan.unclosed[scan.unclosed.length - 1]; guessed = true }
    const openLine = info.lineOf(culprit.s)
    const ind = info.indentOfLine(openLine)
    // ブロック本体の終わり (見出しより深い行が続く範囲) を探す
    let lastBody = openLine
    for (let ln = openLine + 1; ln < info.starts.length; ln++) {
      if (info.isBlank(ln)) continue
      if (info.indentOfLine(ln) <= ind) break
      lastBody = ln
    }
    const lead = text.slice(info.starts[openLine], info.starts[openLine] + (/^[ \t]*/.exec(text.slice(info.starts[openLine], info.lineEnd(openLine)))[0].length))
    const closer = culprit.kind === 'repeat' ? 'until true' : 'end'
    out.push({
      kind: 'missing', from: culprit.s, to: culprit.e,
      message: `${openLine + 1} 行目の '${WORD[culprit.kind]}' に対応する '${culprit.kind === 'repeat' ? 'until' : 'end'}' がありません`,
      insertAt: guessed && lastBody === openLine ? text.replace(/\s+$/, '').length : info.lineEnd(lastBody), insertText: '\n' + lead + closer,
    })
  }
  for (const tok of scan.extra) {
    const ln = info.lineOf(tok.s)
    const only = text.slice(info.starts[ln], info.lineEnd(ln)).trim() === text.slice(tok.s, tok.e)
    out.push({
      kind: 'extra', from: tok.s, to: tok.e,
      message: `余分な '${text.slice(tok.s, tok.e)}' です (対応する function / if / for / while がありません)`,
      removeFrom: only ? info.starts[ln] : tok.s, removeTo: only ? Math.min(text.length, info.lineEnd(ln) + 1) : tok.e,
    })
  }
  return out
}
