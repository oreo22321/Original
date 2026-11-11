// 誤字対策
// ・全角記号 / スマート引用符 / 見えない文字を自動で半角に直す (文字列・コメントの中は対象外)
// ・fucntion → function のようなキーワードの打ち間違いを自動修正
// ・「もしかして」候補を探すための編集距離
import { EditorView, EditorState, EditorSelection, Prec, keymap } from '../../vendor/codemirror.js'
import { lightTokens } from './blocks.js'

// iOS の「スマート句読点」やコピペで紛れ込む文字
const SMART = {
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"', '«': '"', '»': '"',
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  '—': '--', '–': '-', '−': '-', '…': '...', ' ': ' ', '　': ' ', '〜': '~', '￥': '\\',
  '​': '', '‌': '', '‍': '', '﻿': '', '⁠': '',
}
const SUSPECT = /[ «»–—‘-‟…′″​-‍⁠−　〜﻿！-～￥]/
const SUSPECT_G = new RegExp(SUSPECT.source, 'g')

export function fixChar(ch) {
  if (ch in SMART) return SMART[ch]
  const c = ch.charCodeAt(0)
  if (c >= 0xff01 && c <= 0xff5e) return String.fromCharCode(c - 0xfee0)
  return ch
}
export const hasSuspect = text => SUSPECT.test(text)
export const fixAll = text => text.replace(SUSPECT_G, fixChar)

// 文字の説明 (エラーメッセージ用)
export function describeChar(ch) {
  const c = ch.charCodeAt(0)
  if (c === 0x3000) return '全角スペース'
  if (c === 0xa0) return '特殊な空白 (NBSP)'
  if (c >= 0x200b && c <= 0x200d || c === 0xfeff || c === 0x2060) return '見えない文字'
  if (c >= 0x2018 && c <= 0x201f) return `スマート引用符 ${ch}`
  if (c >= 0xff01 && c <= 0xff5e) return `全角の ${ch}`
  return `'${ch}'`
}

function tokenClosed(text) {
  const q = text[0]
  if (q === '"' || q === "'" || q === '`') {
    if (text.length < 2 || text[text.length - 1] !== q) return false
    let bs = 0
    for (let i = text.length - 2; i >= 0 && text[i] === '\\'; i--) bs++
    return bs % 2 === 0
  }
  const m = /^(?:--)?\[(=*)\[/.exec(text)
  if (m) return text.length >= m[0].length + m[1].length + 2 && text.endsWith(']' + m[1] + ']')
  return !text.startsWith('--') // 行コメントは行末まで続く
}

// pos が文字列・コメントの中かどうか (入力途中の閉じていない文字列も考慮)
export function inStringOrComment(text, pos) {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  // 高速パス: この行より前に長い文字列 / コメントが開いていなければ行だけを見る
  const head = text.slice(0, lineStart)
  const prefix = /\[=*\[|`/.test(head) ? text.slice(0, pos) : text.slice(lineStart, pos)
  const toks = lightTokens(prefix, true)
  const last = toks[toks.length - 1]
  if (!last || last.e !== prefix.length) return false
  if (last.t !== 'str' && last.t !== 'comment') return false
  return !tokenClosed(prefix.slice(last.s, last.e))
}

// 貼り付けたコードの中の紛らわしい文字を直す (文字列・コメントの中はそのまま)
export function fixCode(code) {
  if (!SUSPECT.test(code)) return code
  const toks = lightTokens(code, true)
  let out = '', at = 0
  for (const t of toks) {
    if (t.t !== 'str' && t.t !== 'comment') continue
    out += fixAll(code.slice(at, t.s)) + code.slice(t.s, t.e)
    at = t.e
  }
  return out + fixAll(code.slice(at))
}

// ---- 入力時の自動修正 ----
export function inputFixer(enabled, onFix) {
  const handler = (view, from, to, text) => {
    if (!enabled() || view.composing || !text || text.length > 4 || !SUSPECT.test(text)) return false
    const fixed = fixAll(text)
    if (fixed === text) return false
    if (inStringOrComment(view.state.doc.toString(), from)) return false
    if (onFix) onFix(text, fixed)
    // 括弧の自動閉じなど、他の入力ハンドラにも修正後の文字を渡す
    const fallback = () => view.state.update({ changes: { from, to, insert: fixed }, selection: EditorSelection.cursor(from + fixed.length), userEvent: 'input.type', scrollIntoView: true })
    for (const h of view.state.facet(EditorView.inputHandler)) {
      if (h !== handler && h(view, from, to, fixed, fallback)) return true
    }
    view.dispatch(fallback())
    return true
  }
  return [
    EditorView.inputHandler.of(handler),
    // 貼り付け: コード部分だけ修正
    EditorState.transactionFilter.of(tr => {
      if (!tr.docChanged || !tr.isUserEvent('input.paste') || !enabled()) return tr
      const fixes = []
      tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
        const text = inserted.toString()
        if (!SUSPECT.test(text)) return
        const fixed = fixCode(text)
        if (fixed !== text) fixes.push({ from: fromB, to: toB, insert: fixed })
      })
      if (!fixes.length) return tr
      if (onFix) setTimeout(() => onFix(null, null, fixes.length), 0)
      return [tr, { changes: fixes, sequential: true }]
    }),
    // 日本語入力 (IME) で確定した全角記号: 確定した文字がすべて記号・空白なら半角に
    EditorView.domEventHandlers({
      compositionend(e, view) {
        const data = e.data
        if (!enabled() || !data || data.length > 8 || !SUSPECT.test(data) || fixAll(data) === data) return
        if (/[^！-～　‘-‟—…〜￥]/.test(data)) return // かな・漢字を含む確定は触らない
        setTimeout(() => {
          const head = view.state.selection.main.head
          const from = head - data.length
          if (from < 0 || view.composing || view.state.sliceDoc(from, head) !== data) return
          if (inStringOrComment(view.state.doc.toString(), from)) return
          const fixed = fixAll(data)
          if (onFix) onFix(data, fixed)
          view.dispatch({ changes: { from, to: head, insert: fixed }, selection: EditorSelection.cursor(from + fixed.length), userEvent: 'input.fix' })
        }, 20)
      },
    }),
  ]
}

// ---- キーワードなどの打ち間違い ----
export const KEYWORD_FIXES = {
  fucntion: 'function', funciton: 'function', funtion: 'function', functoin: 'function', fnction: 'function', funcion: 'function', functon: 'function', fuction: 'function', funciotn: 'function', functino: 'function', fuinction: 'function', funcition: 'function', fumction: 'function',
  locla: 'local', loacl: 'local', lcoal: 'local', olcal: 'local', lcal: 'local', locl: 'local', locak: 'local', lical: 'local',
  retrun: 'return', reutrn: 'return', retrn: 'return', returm: 'return', retunr: 'return', rerurn: 'return', retur: 'return', reurn: 'return',
  thne: 'then', tehn: 'then', hten: 'then', thrn: 'then', thenn: 'then',
  esle: 'else', eles: 'else', elsee: 'else', elesif: 'elseif', esleif: 'elseif', elsif: 'elseif', elif: 'elseif', elseIf: 'elseif', elsief: 'elseif',
  edn: 'end', ned: 'end', ennd: 'end', endd: 'end',
  whiel: 'while', wihle: 'while', whlie: 'while', whle: 'while',
  braek: 'break', berak: 'break', breka: 'break', contniue: 'continue', contiune: 'continue', coninue: 'continue', continu: 'continue',
  ture: 'true', treu: 'true', tru: 'true', flase: 'false', fasle: 'false', fales: 'false', flae: 'false', nli: 'nil', nill: 'nil',
  repaet: 'repeat', reapeat: 'repeat', repat: 'repeat', untill: 'until', unitl: 'until', utnil: 'until',
  ofr: 'for', fro: 'for', adn: 'and', nad: 'and', nto: 'not', ont: 'not',
  pritn: 'print', prnit: 'print', pirnt: 'print', pritnt: 'print', prnt: 'print', prinnt: 'print', pint: 'print',
  wran: 'warn', wanr: 'warn', paris: 'pairs', piars: 'pairs', pairss: 'pairs', iparis: 'ipairs', ipiars: 'ipairs', ipars: 'ipairs',
  requrie: 'require', reqiure: 'require', reuqire: 'require', requier: 'require', tostirng: 'tostring', tosting: 'tostring', tostrng: 'tostring', tonubmer: 'tonumber', tonumer: 'tonumber',
  gaem: 'game', gmae: 'game', agme: 'game', scirpt: 'script', srcipt: 'script', scritp: 'script', workspcae: 'workspace', wrokspace: 'workspace', worksapce: 'workspace', workspce: 'workspace',
  Instnace: 'Instance', Insatnce: 'Instance', Instacne: 'Instance', Intance: 'Instance', Vecotr3: 'Vector3', Vectro3: 'Vector3', Vetcor3: 'Vector3', Vecotr2: 'Vector2', Vectro2: 'Vector2',
  CFrmae: 'CFrame', CFarme: 'CFrame', Cframe: 'CFrame', Colro3: 'Color3', Coolr3: 'Color3', Enmu: 'Enum', Eunm: 'Enum', UDmi2: 'UDim2', Udim2: 'UDim2',
  stirng: 'string', strnig: 'string', srting: 'string', tabel: 'table', talbe: 'table', tbale: 'table', mtah: 'math', amth: 'math', mahth: 'math', taks: 'task', tsak: 'task',
  getgnev: 'getgenv', getgenev: 'getgenv', loadstirng: 'loadstring', laodstring: 'loadstring', loadsting: 'loadstring', wirtefile: 'writefile', raedfile: 'readfile',
}

// カーソル直前の単語が既知の打ち間違いなら置き換える。置き換え後のカーソル位置を返す (何もしなければ -1)
function fixWordBefore(view, pos, onFix) {
  const { state } = view
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  const m = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(before)
  if (!m) return -1
  const word = m[1]
  if (!Object.prototype.hasOwnProperty.call(KEYWORD_FIXES, word)) return -1
  const fix = KEYWORD_FIXES[word]
  const start = pos - word.length
  const prev = before[before.length - word.length - 1]
  if (prev === '.' || prev === ':') return -1
  const doc = state.doc.toString()
  // 同じ名前が他の場所でも使われているなら、意図した名前とみなす
  const re = new RegExp(`\\b${word}\\b`, 'g')
  let count = 0
  while (re.exec(doc)) if (++count > 1) return -1
  if (inStringOrComment(doc, start)) return -1
  view.dispatch({ changes: { from: start, to: pos, insert: fix }, selection: EditorSelection.cursor(start + fix.length), userEvent: 'input.fix' })
  if (onFix) onFix(word, fix)
  return start + fix.length
}

// 区切り文字 (空白・括弧・改行など) を打った瞬間に修正します
export function keywordAutoCorrect(enabled, onFix) {
  const handler = (view, from, to, text) => {
    if (from !== to || text.length !== 1 || /[\w]/.test(text) || view.composing || !enabled()) return false
    const pos = fixWordBefore(view, from, onFix)
    if (pos < 0) return false
    // 文書が変わったので、打った文字は修正後の位置に入れ直す (括弧の自動閉じなども通す)
    const fallback = () => view.state.update({ changes: { from: pos, insert: text }, selection: EditorSelection.cursor(pos + text.length), userEvent: 'input.type', scrollIntoView: true })
    for (const h of view.state.facet(EditorView.inputHandler)) {
      if (h !== handler && h(view, pos, pos, text, fallback)) return true
    }
    view.dispatch(fallback())
    return true
  }
  return [
    EditorView.inputHandler.of(handler),
    Prec.highest(keymap.of([{ key: 'Enter', run: view => { if (enabled() && view.state.selection.main.empty) fixWordBefore(view, view.state.selection.main.head, onFix); return false } }])),
  ]
}

// ---- 編集距離 (隣り合う 2 文字の入れ替えも 1 回と数える) ----
export function editDistance(a, b, max = 3) {
  const la = a.length, lb = b.length
  if (Math.abs(la - lb) > max) return max + 1
  let prev2 = null, prev = new Array(lb + 1), cur = new Array(lb + 1)
  for (let j = 0; j <= lb; j++) prev[j] = j
  for (let i = 1; i <= la; i++) {
    cur[0] = i
    let rowMin = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1)
      const cost = ca === cb ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    const t = prev2 || new Array(lb + 1)
    prev2 = prev; prev = cur; cur = t
  }
  return prev[lb]
}

// 許容する距離: 短い名前ほど厳しく
export function typoLimit(len) {
  return len <= 3 ? 0 : len <= 5 ? 1 : len <= 9 ? 2 : 3
}

// name に近い候補を返す (大文字小文字だけの違いを最優先)。見つからなければ null
export function nearest(name, candidates, limit = typoLimit(name.length)) {
  const lower = name.toLowerCase()
  let best = null, bestD = Infinity
  for (const c of candidates) {
    if (c === name) return null // 正しい名前
    if (c.length < 2) continue
    if (c.toLowerCase() === lower) { if (bestD > 0.5) { best = c; bestD = 0.5 } continue }
    if (limit < 1 || Math.abs(c.length - name.length) > limit) continue
    const d = editDistance(name, c, limit)
    if (d <= limit && d < bestD) { best = c; bestD = d }
  }
  return best
}
