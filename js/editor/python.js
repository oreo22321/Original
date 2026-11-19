// Python のエディタ機能
// ・補完 / 引数のヒント / 説明 / 定義へ移動: jedi (pytools ワーカー)。準備ができるまでは組み込みの候補
// ・エラーチェック: 構文エラー + pyflakes (日本語のメッセージと、直し方)
// ・整形: autopep8
// ・全角記号の入力を半角に (日本語キーボードでの打ち間違い対策。文字列とコメントの中はそのまま)
import {
  python, pythonLocalCompletions, pythonGlobalCompletions, syntaxTree, linter, hoverTooltip,
  StateField, StateEffect, showTooltip, EditorView, ViewPlugin,
} from '../../vendor/codemirror.js'
import { STDLIB, ALIASES, FULLWIDTH, fixFullwidth, editDistance, similarNames, TYPOS } from './pyfix.js'
export { fixFullwidth, similarNames, editDistance, TYPOS }

// ============================================================
// pytools ワーカー (補完・チェック・整形)
// ============================================================
let worker = null, broken = false, seq = 0, readyAt = 0
const waits = new Map()
let filesProvider = () => ({})
let filesVersion = 0, sentVersion = -1
export function setPythonFiles(fn) { filesProvider = fn }
export function pythonFilesChanged() { filesVersion++ }

function getWorker() {
  if (broken || typeof Worker === 'undefined') return null
  if (worker) return worker
  try { worker = new Worker(new URL('../workers/pytools-worker.js', import.meta.url), { type: 'module' }) } catch { broken = true; return null }
  worker.onmessage = e => {
    const m = e.data
    const w = waits.get(m.id)
    if (!w) return
    waits.delete(m.id)
    clearTimeout(w.timer)
    if (!readyAt) readyAt = Date.now()
    if (m.ok) w.resolve(m.result)
    else w.reject(new Error(m.error))
  }
  worker.onerror = e => {
    if (e && e.preventDefault) e.preventDefault()
    broken = true
    for (const w of waits.values()) { clearTimeout(w.timer); w.reject(new Error('python tools failed')) }
    waits.clear()
  }
  return worker
}
export function pyTools(type, args = {}, timeout = 30000) {
  const w = getWorker()
  if (!w) return Promise.reject(new Error('この環境では使えません'))
  const id = ++seq
  const msg = { type, id, ...args }
  if (sentVersion !== filesVersion) { msg.files = filesProvider(); sentVersion = filesVersion }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waits.delete(id); reject(new Error('timeout')) }, timeout)
    waits.set(id, { resolve, reject, timer })
    w.postMessage(msg)
  })
}
// 起動後、手が空いたら準備を始める (jedi の初回は時間がかかるため)
export function warmPython() { pyTools('warm', {}, 120000).catch(() => {}) }
export const pythonToolsReady = () => !!readyAt

const lineCol = (state, pos) => { const l = state.doc.lineAt(pos); return { line: l.number, col: pos - l.from } }
const posOf = (state, line, col) => {
  const l = state.doc.line(Math.max(1, Math.min(state.doc.lines, line)))
  return Math.min(l.to, l.from + Math.max(0, col))
}

// ============================================================
// 補完
// ============================================================
const TYPE_MAP = { function: 'function', class: 'class', module: 'namespace', keyword: 'keyword', instance: 'variable', statement: 'variable', param: 'variable', property: 'property', path: 'text' }
export function pythonCompletionSource(getPath) {
  return async context => {
    const before = context.matchBefore(/[\w.]*$/)
    const word = context.matchBefore(/\w*$/)
    if (!context.explicit && (!before || (before.from === before.to))) return null
    // 文字列・コメントの中では出さない (import の文字列などを除く)
    const node = syntaxTree(context.state).resolveInner(context.pos, -1)
    if (/Comment|String/.test(node.name) && !context.explicit) return null
    const afterDot = before && before.text.includes('.')
    if (!context.explicit && !afterDot && word && word.to - word.from < 1) return null
    const fallback = () => {
      const local = pythonLocalCompletions(context)
      const global = pythonGlobalCompletions(context)
      if (!local && !global) return null
      const options = [...((local && local.options) || []), ...((global && global.options) || [])]
      return { from: (local || global).from, options, validFor: /^\w*$/ }
    }
    const { line, col } = lineCol(context.state, context.pos)
    let list
    try {
      const req = pyTools('complete', { code: context.state.doc.toString(), line, col, path: getPath() }, 8000)
      // 準備中で時間がかかるときは、組み込みの候補を出す
      list = pythonToolsReady() ? await req : await Promise.race([req, new Promise(r => setTimeout(() => r(null), 700))])
    } catch { list = null }
    if (context.aborted) return null
    if (!list) return afterDot ? null : fallback()
    const from = word ? word.from : context.pos
    return {
      from,
      validFor: /^\w*$/,
      options: list.map((c, i) => c.auto ? {
        // まだ import していない名前: 選ぶと import の行も足す
        label: c.name,
        type: TYPE_MAP[c.type] || 'variable',
        detail: c.desc,
        boost: -20,
        apply: (view, completion, from, to) => applyAutoImport(view, c.name, c.auto, from, to),
      } : {
        label: c.name,
        type: TYPE_MAP[c.type] || 'variable',
        detail: c.type === 'keyword' ? '' : (c.desc || '').replace(/^(def|class|module|instance|param|statement) /, '').slice(0, 60),
        boost: c.name.startsWith('_') ? -10 : -Math.min(9, Math.floor(i / 20)),
        info: c.type === 'keyword' ? undefined : () => pyTools('doc', { code: context.state.doc.toString(), line, col, path: getPath(), name: c.name }, 6000).then(d => {
          if (!d || (!d.sig && !d.doc)) return null
          const el = document.createElement('div')
          el.className = 'cm-py-doc'
          if (d.sig) { const s = document.createElement('div'); s.className = 'sig'; s.textContent = d.sig; el.append(s) }
          if (d.doc) { const p = document.createElement('div'); p.className = 'doc'; p.textContent = d.doc.slice(0, 600); el.append(p) }
          return el
        }, () => null),
      })),
    }
  }
}

// 補完で選んだ名前を入れて、ファイルの先頭に import を足す (まだなければ)
function applyAutoImport(view, name, stmt, from, to) {
  const doc = view.state.doc.toString()
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const has = new RegExp(`^\\s*${esc(stmt)}\\s*$`, 'm').test(doc)
  const changes = [{ from, to, insert: name }]
  let shift = 0
  if (!has) {
    const at = importInsertPos(view.state)
    const line = stmt + '\n'
    changes.unshift({ from: at, insert: line })
    if (at <= from) shift = line.length
  }
  view.dispatch({ changes, selection: { anchor: from + name.length + shift }, userEvent: 'input.complete', scrollIntoView: true })
}

// ============================================================
// エラーチェック (日本語のメッセージと直し方)
// ============================================================
const SYNTAX_JA = [
  [/^expected ':'$/, "':' が必要です (if / for / def / class などの行の最後に ':' を付けます)"],
  [/^invalid syntax\. Perhaps you forgot a comma\?$/, "書き方が正しくありません。',' (カンマ) を忘れていませんか?"],
  [/^invalid syntax\. Maybe you meant '==' or ':=' instead of '='\?$/, "比較には '==' を使います ('=' は代入です)"],
  [/^invalid syntax$/, '書き方が正しくありません'],
  [/^unexpected indent$/, '字下げ (インデント) が多すぎます'],
  [/^unindent does not match any outer indentation level$/, '字下げの深さが、どのブロックとも合っていません'],
  [/^expected an indented block after '(\w+)' statement on line (\d+)$/, (m) => `${m[2]} 行目の '${m[1]}' の次の行は、字下げ (インデント) が必要です`],
  [/^expected an indented block after function definition on line (\d+)$/, m => `${m[1]} 行目の関数の中身は、字下げ (インデント) して書きます`],
  [/^expected an indented block after class definition on line (\d+)$/, m => `${m[1]} 行目のクラスの中身は、字下げ (インデント) して書きます`],
  [/^expected an indented block/, '次の行は字下げ (インデント) が必要です'],
  [/^unterminated string literal/, '文字列が閉じられていません (" か \' が足りません)'],
  [/^unterminated triple-quoted string literal/, '""" の文字列が閉じられていません'],
  [/^'(\(|\[|\{)' was never closed$/, m => `'${m[1]}' が閉じられていません`],
  [/^unmatched '(\)|\]|\})'$/, m => `'${m[1]}' に対応する開き括弧がありません`],
  [/^closing parenthesis '(.)' does not match opening parenthesis '(.)'/, m => `閉じ括弧 '${m[1]}' が、開き括弧 '${m[2]}' と合っていません`],
  [/^Missing parentheses in call to 'print'\. Did you mean print\((.*)\)\?$/, 'Python 3 では print は関数です。print(…) のように ( ) で囲みます'],
  [/^invalid character '(.)' \(U\+([0-9A-F]+)\)$/, m => `使えない文字 '${m[1]}' があります (全角の記号かもしれません)`],
  [/^invalid non-printable character/, '目に見えない文字が入っています (全角スペースなど)'],
  [/^cannot assign to (.+)$/, m => `${m[1]} には代入できません`],
  [/^'return' outside function$/, "'return' は関数の中でしか使えません"],
  [/^'break' outside loop$/, "'break' はループ (for / while) の中でしか使えません"],
  [/^'continue' not properly in loop$/, "'continue' はループの中でしか使えません"],
  [/^inconsistent use of tabs and spaces in indentation$/, '字下げにタブとスペースが混ざっています'],
  [/^f-string: (.+)$/, m => `f-string の書き方が正しくありません (${m[1]})`],
]
function syntaxJa(msg) {
  for (const [re, ja] of SYNTAX_JA) { const m = re.exec(msg); if (m) return typeof ja === 'function' ? ja(m) : ja }
  return msg
}
function flakeJa(d) {
  const a = d.args || []
  switch (d.kind) {
    case 'UndefinedName': return [`'${a[0]}' は定義されていません (スペルミスか、import のし忘れかもしれません)`, 'warning']
    case 'UndefinedLocal': return [`'${a[0]}' を、値を入れる前に使っています`, 'warning']
    case 'UnusedImport': return [`'${a[0]}' を import していますが、使っていません`, 'hint']
    case 'UnusedVariable': return [`変数 '${a[0]}' に値を入れていますが、使っていません`, 'hint']
    case 'RedefinedWhileUnused': return [`'${a[0]}' を使う前に、もう一度定義しています`, 'warning']
    case 'ImportShadowedByLoopVar': return [`import した '${a[0]}' を、ループの変数で上書きしています`, 'warning']
    case 'ImportStarUsed': return ['import * を使うと、どの名前があるか分からなくなります', 'info']
    case 'ImportStarUsage': return [`'${a[0]}' は import * で読み込んだものかもしれません`, 'info']
    case 'DuplicateArgument': return [`引数 '${a[0]}' が 2 回あります`, 'error']
    case 'MultiValueRepeatedKeyLiteral': return [`辞書のキー ${a[0]} が 2 回あります`, 'warning']
    case 'IsLiteral': return ["数値や文字列と比べるときは 'is' ではなく '==' を使います", 'warning']
    case 'FStringMissingPlaceholders': return ["f-string に {…} がありません (f を外せます)", 'info']
    case 'PercentFormatInvalidFormat': case 'StringDotFormatInvalidFormat': return ['文字列のフォーマットの書き方が正しくありません', 'warning']
    case 'ReturnOutsideFunction': return ["'return' は関数の中でしか使えません", 'error']
    case 'YieldOutsideFunction': return ["'yield' は関数の中でしか使えません", 'error']
    case 'ContinueOutsideLoop': case 'BreakOutsideLoop': return ['ループの外で使っています', 'error']
    case 'DefaultExceptNotLast': return ["'except:' (何でも受ける) は最後に書きます", 'error']
    case 'TooManyExpressionsInStarredAssignment': return ['* を使った代入の式が多すぎます', 'error']
    case 'AssertTuple': return ['assert にタプルを渡すと、いつも成り立ちます (括弧を外します)', 'warning']
    case 'RaiseNotImplemented': return ["NotImplemented ではなく NotImplementedError を raise します", 'warning']
    default: return [d.msg, 'warning']
  }
}
function toDiagnostics(state, list) {
  const out = []
  for (const d of list) {
    const line = state.doc.line(Math.max(1, Math.min(state.doc.lines, d.line || 1)))
    let from = Math.min(line.to, line.from + Math.max(0, (d.col || 1) - 1))
    let to = from
    if (d.severity === 'error') {
      // 構文エラー: その位置の単語 (なければ 1 文字、行末なら行全体)
      if (d.endLine === d.line && d.endCol && d.endCol > d.col) to = Math.min(line.to, line.from + d.endCol - 1)
      else { const m = /^\w+/.exec(state.doc.sliceString(from, line.to)); to = m ? from + m[0].length : Math.min(line.to, from + 1) }
      if (to <= from) { from = line.from + (/^\s*/.exec(line.text)[0].length); to = line.to }
      if (to <= from) to = Math.min(state.doc.length, from + 1)
      const acts = syntaxActions(d, state, line)
      out.push({ from, to, severity: 'error', source: acts.some(a => a.source === '全角') ? '全角' : '構文', message: syntaxJa(d.msg), actions: acts })
      continue
    }
    if (d.kind === 'Check') {
      // 実行する前に分かる間違い (py-check.js)。メッセージは日本語で届く
      from = Math.min(line.to, line.from + Math.max(0, (d.col || 1) - 1))
      const endLine = d.endLine && d.endLine !== d.line ? state.doc.line(Math.min(state.doc.lines, d.endLine)) : line
      to = Math.max(from, Math.min(endLine.to, endLine.from + Math.max(0, (d.endCol || d.col || 1) - 1)))
      const diag = { from, to, severity: d.severity || 'warning', message: d.msg, source: 'チェック' }
      if (d.fix && d.fix.text) diag.actions = [checkFix(d.fix)]
      out.push(diag)
      continue
    }
    const name = (d.args || [])[0]
    const m = name ? new RegExp(`\\b${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split('.')[0]}\\b`).exec(state.doc.sliceString(from, line.to)) : null
    if (m) { from += m.index; to = from + m[0].length } else to = Math.min(line.to, from + 1)
    const [message, severity] = flakeJa(d)
    const diag = { from, to, severity: severity === 'hint' ? 'hint' : severity, message, source: 'Python' }
    if (severity === 'hint') diag.markClass = 'cm-unused'
    const actions = flakeActions(d, state, line)
    if (actions.length) diag.actions = actions
    const typo = actions.find(a => a.source === '誤字')
    if (typo) { diag.source = '誤字'; diag.message += ` — もしかして '${typo.value}'?` }
    out.push(diag)
  }
  return out
}
// チェックの直し方: 範囲をそのまま置き換える / その行の old を text にする
function checkFix(fix) {
  return {
    name: fix.label,
    apply(view, from, to) {
      if (fix.span) { view.dispatch({ changes: { from, to, insert: fix.text }, userEvent: 'input.fix' }); return }
      const doc = view.state.doc
      if (!fix.line || fix.line > doc.lines) return
      const l = doc.line(fix.line)
      const at = l.text.indexOf(fix.old)
      if (at < 0) return
      view.dispatch({ changes: { from: l.from + at, to: l.from + at + fix.old.length, insert: fix.text }, userEvent: 'input.fix' })
    },
  }
}
const lineEdit = (view, n, fn) => {
  const l = view.state.doc.line(Math.min(view.state.doc.lines, n))
  const t = fn(l.text)
  if (t !== l.text) view.dispatch({ changes: { from: l.from, to: l.to, insert: t }, userEvent: 'input.fix' })
}
const BRACKET = { '(': ')', '[': ']', '{': '}' }
function syntaxActions(d, state, line) {
  const acts = []
  const msg = d.msg || ''
  const n = line.number
  let m
  if (/expected ':'/.test(msg)) acts.push({ name: "':' を付ける", apply(view) { lineEdit(view, n, t => { const c = /\s*(#.*)?$/.exec(t); return t.slice(0, c.index) + ':' + (c[1] ? '  ' + c[1] : '') }) } })
  if (/Missing parentheses in call to 'print'/.test(msg)) acts.push({ name: 'print(…) にする', apply(view) { lineEdit(view, n, t => { const p = /^(\s*)print\s+(.*?)\s*$/.exec(t); return p ? `${p[1]}print(${p[2]})` : t }) } })
  if (/Maybe you meant '==' or ':=' instead of '='/.test(msg)) acts.push({ name: "'==' にする", apply(view) { lineEdit(view, n, t => t.replace(/([^=!<>:])=(?!=)/, '$1==')) } })
  if (/^invalid character|^invalid non-printable character/.test(msg)) {
    acts.push({ name: 'この行の全角記号を半角にする', source: '全角', apply(view) { lineEdit(view, n, t => fixFullwidth(t).replace(/[\u200b\u00a0\ufeff]/g, '')) } })
    acts.push({ name: 'ファイル全体の全角記号を半角にする', apply(view) { const t = view.state.doc.toString(), f = fixFullwidth(t).replace(/[\u200b\ufeff]/g, ''); if (f !== t) view.dispatch({ changes: { from: 0, to: t.length, insert: f }, userEvent: 'input.fix' }) } })
  }
  if (/^unexpected indent$/.test(msg)) acts.push({ name: '字下げを前の行に合わせる', apply(view) {
    const doc = view.state.doc
    let prev = ''
    for (let i = n - 1; i >= 1; i--) { const t = doc.line(i).text; if (t.trim() && !/^\s*#/.test(t)) { prev = /^\s*/.exec(t)[0]; break } }
    lineEdit(view, n, t => prev + t.trimStart())
  } })
  if (/^expected an indented block/.test(msg)) acts.push({ name: 'この行を字下げする', apply(view) {
    const base = /on line (\d+)$/.exec(msg)
    const ind = /^\s*/.exec(view.state.doc.line(base ? Number(base[1]) : Math.max(1, n - 1)).text)[0] + '    '
    lineEdit(view, n, t => ind + t.trimStart())
  } })
  if (/^inconsistent use of tabs and spaces|^unindent does not match/.test(msg)) acts.push({ name: 'ファイル全体のタブをスペース 4 つにする', apply(view) {
    const t = view.state.doc.toString(), f = t.replace(/^[ \t]+/gm, x => x.replace(/\t/g, '    '))
    if (f !== t) view.dispatch({ changes: { from: 0, to: t.length, insert: f }, userEvent: 'input.fix' })
  } })
  if (/^unterminated string literal/.test(msg)) acts.push({ name: '文字列を閉じる', apply(view) {
    lineEdit(view, n, t => { const q = /(["'])[^"']*$/.exec(t); return q ? t.replace(/\s*$/, '') + q[1] : t })
  } })
  if ((m = /^'(\(|\[|\{)' was never closed$/.exec(msg))) { const close = BRACKET[m[1]]; acts.push({ name: `行の最後に '${close}' を付ける`, apply(view) { lineEdit(view, n, t => t.replace(/\s*(:?)\s*$/, (x, colon) => close + colon)) } }) }
  if ((m = /^unmatched '(\)|\]|\})'$/.exec(msg))) { const ch = m[1]; acts.push({ name: `余分な '${ch}' を消す`, apply(view) { const l = view.state.doc.line(n); const at = l.text.indexOf(ch, Math.max(0, (d.col || 1) - 1)); const pos = at >= 0 ? at : l.text.lastIndexOf(ch); if (pos >= 0) view.dispatch({ changes: { from: l.from + pos, to: l.from + pos + 1 }, userEvent: 'input.fix' }) } }) }
  return acts
}
function flakeActions(d, state, line) {
  const acts = []
  const name = (d.args || [])[0]
  if (d.kind === 'UndefinedName' && name) {
    for (const c of similarNames(name, state.doc.toString())) {
      acts.push({ name: `'${c}' に直す`, source: '誤字', value: c, apply(view, from, to) { view.dispatch({ changes: { from, to, insert: c }, userEvent: 'input.fix' }) } })
    }
    const imp = ALIASES[name] || (STDLIB.has(name) ? `import ${name}` : null)
    if (imp) acts.push({ name: `${imp} を先頭に追加`, apply(view) { view.dispatch({ changes: { from: importInsertPos(view.state), insert: imp + '\n' }, userEvent: 'input.fix' }) } })
  }
  if (d.kind === 'UnusedImport' && /^\s*(import|from)\b/.test(line.text) && !line.text.includes(',')) {
    acts.push({ name: 'この import を消す', apply(view) { const l = view.state.doc.line(line.number); view.dispatch({ changes: { from: l.from, to: Math.min(view.state.doc.length, l.to + 1) }, userEvent: 'input.fix' }) } })
  }
  if (d.kind === 'IsLiteral') acts.push({ name: "'==' にする", apply(view) { lineEdit(view, line.number, t => t.replace(/\bis not\b/, '!=').replace(/\bis\b/, '==')) } })
  if (d.kind === 'FStringMissingPlaceholders') acts.push({ name: "f を外す", apply(view, from) { const l = view.state.doc.line(line.number); const m = /\b[fF](?=["'])/.exec(view.state.doc.sliceString(Math.max(l.from, from - 1), l.to)); if (m) { const at = Math.max(l.from, from - 1) + m.index; view.dispatch({ changes: { from: at, to: at + 1 }, userEvent: 'input.fix' }) } } })
  return acts
}
// import を足す位置: 先頭の説明 (docstring)・コメント・既存の import の後ろ
function importInsertPos(state) {
  let pos = 0
  for (let i = 1; i <= state.doc.lines; i++) {
    const t = state.doc.line(i).text
    if (/^\s*(#|$)/.test(t) || /^\s*(import|from)\s/.test(t) || (i === 1 && /^\s*("""|''')/.test(t))) { if (/^\s*(import|from)\s/.test(t)) pos = state.doc.line(i).to + 1; continue }
    break
  }
  return Math.min(pos, state.doc.length)
}

export function pythonLinter(getOpts) {
  return linter(async view => {
    const opts = getOpts()
    if (!opts.enabled) return []
    const doc = view.state.doc
    if (doc.length > 500000) return []
    let list
    try { list = await pyTools('lint', { code: doc.toString(), path: opts.path || 'main.py' }, 60000) } catch { return [] }
    if (view.state.doc !== doc) return []
    let diags = toDiagnostics(view.state, list)
    if (opts.unused === false) diags = diags.filter(d => d.severity !== 'hint')
    if (opts.undefined === false) diags = diags.filter(d => !/定義されていません/.test(d.message))
    return diags
  }, { delay: 500 })
}

// ============================================================
// 説明 (マウスを乗せたとき・長押し)
// ============================================================
export function pythonHover(getPath) {
  return hoverTooltip(async (view, pos) => {
    const word = view.state.wordAt(pos)
    if (!word) return null
    const node = syntaxTree(view.state).resolveInner(pos, 1)
    if (/Comment|String/.test(node.name)) return null
    const { line, col } = lineCol(view.state, pos)
    let info
    try { info = await pyTools('help', { code: view.state.doc.toString(), line, col, path: getPath() }, 6000) } catch { return null }
    const it = info && info[0]
    if (!it || (!it.sig && !it.doc)) return null
    return {
      pos: word.from, end: word.to, above: true,
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'cm-doc-tip cm-py-doc'
        const t = document.createElement('div')
        t.className = 'sig'
        t.textContent = it.sig || `${it.name} (${it.type})`
        dom.append(t)
        if (it.doc) { const d = document.createElement('div'); d.className = 'doc'; d.textContent = it.doc.slice(0, 700); dom.append(d) }
        if (it.module && it.module !== '__main__') { const mm = document.createElement('div'); mm.className = 'meta'; mm.textContent = it.module; dom.append(mm) }
        return { dom }
      },
    }
  }, { hoverTime: 400 })
}

// ============================================================
// 引数のヒント: ( や , を打ったときに、関数の引数を表示
// ============================================================
const setSig = StateEffect.define()
const sigField = StateField.define({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setSig)) return e.value
    // 入力以外の書き換え (AI・同期・整形など) では消す
    if (v && tr.docChanged && !tr.isUserEvent('input') && !tr.isUserEvent('delete')) return null
    if (v && (tr.docChanged || tr.selection)) {
      const head = tr.state.selection.main.head
      // カーソルが離れたら、閉じ括弧の外に出たら消す
      if (head < v.pos - 200 || /\)\s*$/.test(tr.state.doc.sliceString(Math.max(0, head - 1), head)) && tr.docChanged) return null
      return { ...v, pos: tr.changes.mapPos(v.pos) }
    }
    return v
  },
  provide: f => showTooltip.compute([f], state => {
    const v = state.field(f)
    if (!v) return null
    return {
      pos: v.pos, above: true, strictSide: false, arrow: false,
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'cm-sig-help'
        const name = document.createElement('span')
        name.textContent = v.sig.name + '('
        dom.append(name)
        v.sig.params.forEach((p, i) => {
          const s = document.createElement('span')
          s.textContent = p
          if (i === v.sig.index) s.className = 'active'
          dom.append(s)
          if (i < v.sig.params.length - 1) dom.append(document.createTextNode(', '))
        })
        dom.append(document.createTextNode(')'))
        if (v.sig.doc) { const d = document.createElement('div'); d.className = 'doc'; d.textContent = v.sig.doc.split('\n\n')[0].slice(0, 240); dom.append(d) }
        return { dom }
      },
    }
  }),
})
export function pythonSignatureHelp(getPath, enabled) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) { this.view = view; this.timer = 0; this.seq = 0 }
    update(u) {
      if (!enabled() || !u.docChanged) return
      let typed = '', user = false
      u.transactions.forEach(tr => {
        if (tr.isUserEvent('input') || tr.isUserEvent('delete')) user = true
        if (tr.isUserEvent('input')) tr.changes.iterChanges((a, b, c, d, ins) => { typed += ins.toString() })
      })
      if (!user) return
      const head = u.state.selection.main.head
      const v = u.state.field(sigField, false)
      if (!/[(,]/.test(typed) && !v) return
      // ) を打ったら消える (sigField が消す)。待っている問い合わせも取り消す
      if (typed.includes(')')) { clearTimeout(this.timer); this.seq++; return }
      clearTimeout(this.timer)
      const id = ++this.seq
      this.timer = setTimeout(async () => {
        const st = this.view.state
        const { line, col } = lineCol(st, head)
        let sig = null
        try { sig = await pyTools('signature', { code: st.doc.toString(), line, col, path: getPath() }, 5000) } catch {}
        if (id !== this.seq) return
        this.view.dispatch({ effects: setSig.of(sig ? { pos: this.view.state.selection.main.head, sig } : null) })
      }, 120)
    }
    destroy() { clearTimeout(this.timer) }
  })
  return [sigField, plugin]
}

// ============================================================
// 整形 / 定義へ移動
// ============================================================
export async function formatPython(view, { aggressive = false } = {}) {
  const before = view.state.doc.toString()
  const after = await pyTools('format', { code: before, aggressive }, 30000)
  if (typeof after !== 'string' || after === before || view.state.doc.toString() !== before) return false
  // 変わった行だけ置き換える (カーソルの位置を保つため)
  const a = before.split('\n'), b = after.split('\n')
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let ea = a.length - 1, eb = b.length - 1
  while (ea >= s && eb >= s && a[ea] === b[eb]) { ea--; eb-- }
  const from = a.slice(0, s).join('\n').length + (s > 0 ? 1 : 0)
  const to = Math.min(before.length, a.slice(0, ea + 1).join('\n').length)
  const insert = b.slice(s, eb + 1).join('\n')
  view.dispatch({ changes: { from: Math.min(from, to), to, insert: from > to ? insert + '\n' : insert }, userEvent: 'input.format' })
  return true
}
export async function pythonGoto(state, pos, path) {
  const { line, col } = lineCol(state, pos)
  return pyTools('goto', { code: state.doc.toString(), line, col, path }, 8000)
}
export async function pythonRefs(state, pos, path) {
  const { line, col } = lineCol(state, pos)
  return pyTools('refs', { code: state.doc.toString(), line, col, path }, 10000)
}
export async function pythonRename(state, pos, path, name) {
  const { line, col } = lineCol(state, pos)
  return pyTools('rename', { code: state.doc.toString(), line, col, path, name }, 15000)
}
export async function pythonOutline(state, path) {
  return pyTools('outline', { code: state.doc.toString(), path }, 8000)
}
export { posOf as pythonPosOf }

// ============================================================
// 全角記号 → 半角 (文字列・コメントの外で、記号を 1 文字打ったときだけ)
// ============================================================
export function pythonInputFixer(enabled, onFix) {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (!enabled() || text.length !== 1 || !FULLWIDTH[text]) return false
    const node = syntaxTree(view.state).resolveInner(from, -1)
    if (/Comment|String/.test(node.name) && !(node.name === 'String' && node.to === from)) return false
    const fixed = FULLWIDTH[text]
    view.dispatch({ changes: { from, to, insert: fixed }, selection: { anchor: from + fixed.length }, userEvent: 'input.type' })
    if (onFix) onFix(text, fixed)
    return true
  })
}

// ============================================================
// よくある打ち間違いの自動修正 (pirnt → print など)。区切りの文字を打ったときに、直前の単語だけ
// ============================================================
// 区切りごとの対象 (誤って直さないよう、意味が通る場所だけ)
const AFTER = { ' ': /^(improt|imoprt|ipmort|imprt|iport|retrun|reutrn|retunr|retur|reurn|whiel|wihle|whlie|hwile|calss|clas|clsas|raies|rasie|gloabl|nonlocla|asert|yeild|lamda|lamba|excpet|exept|elsf|elfi|eilf|esif|elsif|elseif)$/, ':': /^(esle|eles|excpet|exept|finaly|finnally)$/, '(': /^(pirnt|pritn|prnit|prnt|rpint|pinrt|rnage|ragne|rang|inptu|inupt|inpt|lne|enumarate|enumrate|isinstnace|srt)$/ }
const VALUES = /^(ture|Ture|treu|Treu|true|flase|Flase|fasle|Fasle|false|none|Noen|nul|null|slef|sefl|contiune|conitnue|continu|braek|brak|breka)$/
export function pythonAutoCorrect(enabled, onFix) {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (!enabled() || from !== to || !/^[ :(),.\]\n]$/.test(text)) return false
    const line = view.state.doc.lineAt(from)
    const before = view.state.doc.sliceString(line.from, from)
    const m = /(?:^|[^\w.])([A-Za-z_]\w*)$/.exec(before)
    if (!m) return false
    const word = m[1]
    const fixed = TYPOS[word]
    if (!fixed) return false
    const ok = (AFTER[text] && AFTER[text].test(word)) || (VALUES.test(word) && /[ :),\]\n.]/.test(text))
    if (!ok) return false
    const node = syntaxTree(view.state).resolveInner(from, -1)
    if (/Comment|String/.test(node.name)) return false
    // 同じ名前を自分で定義しているなら直さない (true = ... など)
    const doc = view.state.doc.toString()
    if (new RegExp(`(^|[\\s,(])${word}\\s*(=[^=]|,|\\))|def\\s+${word}\\b|class\\s+${word}\\b|import\\s+${word}\\b|as\\s+${word}\\b`, 'm').test(doc.slice(0, line.from) + doc.slice(line.to))) return false
    const start = from - word.length
    view.dispatch({ changes: { from: start, to: from, insert: fixed + text }, selection: { anchor: start + fixed.length + text.length }, userEvent: 'input.type' })
    if (onFix) onFix(word, fixed)
    return true
  })
}

export const pythonLanguage = () => python()
