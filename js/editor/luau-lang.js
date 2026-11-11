// Luau のシンタックスハイライトと字下げ (StreamLanguage)
import { StreamLanguage, foldService, indentUnit } from '../../vendor/codemirror.js'
import { EXECUTOR_GLOBALS } from '../data/executor-api.js'

const KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'for', 'function', 'if', 'in', 'local', 'not', 'or', 'repeat', 'return', 'then', 'until', 'while'])
const OP_KW = new Set(['and', 'or', 'not'])
const CONTEXTUAL = new Set(['continue', 'export', 'type', 'typeof'])
const LIBS = new Set(['string', 'table', 'math', 'os', 'coroutine', 'task', 'utf8', 'bit32', 'buffer', 'debug', 'io'])
const BUILTINS = new Set(['print', 'warn', 'error', 'assert', 'pcall', 'xpcall', 'select', 'type', 'typeof', 'tostring', 'tonumber', 'pairs', 'ipairs', 'next', 'rawget', 'rawset', 'rawequal', 'rawlen', 'setmetatable', 'getmetatable', 'unpack', 'loadstring', 'load', 'require', 'newproxy', 'gcinfo', 'collectgarbage', 'getfenv', 'setfenv', 'tick', 'time', 'elapsedTime', 'wait', 'spawn', 'delay', 'settings', 'UserSettings', 'version', 'printidentity', 'ypcall', 'dofile', 'loadfile'])
const RBX_GLOBALS = new Set(['game', 'workspace', 'script', 'plugin', 'shared', '_G', '_VERSION', 'Enum', 'Game', 'Workspace'])
const DATATYPES = new Set(['Instance', 'Vector3', 'Vector2', 'CFrame', 'Color3', 'UDim', 'UDim2', 'TweenInfo', 'BrickColor', 'NumberRange', 'NumberSequence', 'NumberSequenceKeypoint', 'ColorSequence', 'ColorSequenceKeypoint', 'Rect', 'Ray', 'Region3', 'Random', 'DateTime', 'RaycastParams', 'OverlapParams', 'PhysicalProperties', 'Font', 'Vector3int16', 'Vector2int16', 'PathWaypoint', 'Axes', 'Faces', 'CatalogSearchParams', 'Drawing', 'WebSocket'])
const BLOCK_OPEN = new Set(['function', 'do', 'then', 'repeat'])
const CLOSER_START = /^\s*(?:(?:end|until|else|elseif)(?![A-Za-z0-9_])|[)}\]])/

// エグゼキューターモードで特別な色にするグローバル (getgenv, writefile など)
const NO_EXTRA = new Set()
const EXEC_GLOBALS = new Set(Object.keys(EXECUTOR_GLOBALS))

function longBracket(stream) {
  // stream は '[' の位置。レベルを返す (なければ -1)
  const m = stream.match(/^\[(=*)\[/, false)
  return m ? m[1].length : -1
}

function readLong(stream, state, level, style) {
  const close = ']' + '='.repeat(level) + ']'
  for (;;) {
    const idx = stream.string.indexOf(close, stream.pos)
    if (idx >= 0) {
      stream.pos = idx + close.length
      state.tokenize = null
      return style
    }
    stream.skipToEnd()
    state.tokenize = (s, st) => readLong(s, st, level, style)
    return style
  }
}

function readString(stream, state, quote) {
  let escaped = false, ch
  while ((ch = stream.next()) != null) {
    if (ch === quote && !escaped) { state.tokenize = null; return 'string' }
    if (ch === '\\' && !escaped && stream.eol()) { state.tokenize = (s, st) => readString(s, st, quote); return 'string' }
    escaped = !escaped && ch === '\\'
  }
  state.tokenize = null
  return 'string'
}

// 補間文字列 `...{expr}...`
function readInterp(stream, state) {
  let escaped = false, ch
  while ((ch = stream.peek()) != null) {
    if (ch === '`' && !escaped) { stream.next(); state.tokenize = null; state.interp.pop(); return 'string.special' }
    if (ch === '{' && !escaped) {
      if (stream.pos === stream.start) {
        stream.next()
        state.tokenize = null
        state.interpDepth.push(0)
        return 'brace.special'
      }
      return 'string.special'
    }
    stream.next()
    escaped = !escaped && ch === '\\'
  }
  return 'string.special'
}

function tokenBase(stream, state) {
  if (stream.eatSpace()) return null
  const ch = stream.peek()
  const start = stream.pos

  // コメント
  if (stream.match('--')) {
    if (stream.peek() === '[') {
      const lvl = longBracket(stream)
      if (lvl >= 0) { stream.pos += lvl + 2; return readLong(stream, state, lvl, 'comment') }
    }
    if (start === 0 && stream.match(/^!\w+/)) { stream.skipToEnd(); return 'meta' }
    stream.skipToEnd()
    if (/--\s*(TODO|FIXME|NOTE|HACK|XXX)\b/.test(stream.current())) return 'comment.special'
    return 'comment'
  }
  if (ch === '"' || ch === "'") { stream.next(); return readString(stream, state, ch) }
  if (ch === '`') {
    stream.next()
    state.interp.push(true)
    state.tokenize = readInterp
    return readInterp(stream, state)
  }
  if (ch === '[') {
    const lvl = longBracket(stream)
    if (lvl >= 0) { stream.pos += lvl + 2; return readLong(stream, state, lvl, 'string') }
  }
  if (/\d/.test(ch) || (ch === '.' && /\d/.test(stream.string.charAt(stream.pos + 1)))) {
    if (stream.match(/^0[xX][0-9a-fA-F_]+/) || stream.match(/^0[bB][01_]+/) || stream.match(/^(\d[\d_]*\.?[\d_]*|\.\d[\d_]*)([eE][+-]?\d+)?/)) {
      state.lastSig = 'num'
      return 'number'
    }
  }
  if (stream.match(/^[A-Za-z_][\w]*/)) {
    const word = stream.current()
    const prev = state.lastSig
    state.lastSig = 'name'
    const prevWord = state.prevWord
    state.prevWord = word
    const nextCh = stream.string.slice(stream.pos).match(/^\s*(.)/)
    const next = nextCh ? nextCh[1] : ''
    const isCall = next === '(' || next === '"' || next === "'" || next === '{' || next === '`'
    if (state.typeMode) {
      // 型注釈の途中でもキーワードが来たら型は終わり (for k: string, v: number in ... do など)
      if (KEYWORDS.has(word)) { state.typeMode = false; state.typeDepth = 0 } else return typeWord(word)
    }
    if (prev === '.' || prev === ':') {
      if (prev === ':' && state.typeAfterColon) { state.typeMode = true; return typeWord(word) }
      return isCall ? 'propertyName.function' : (/^[A-Z][A-Z0-9_]+$/.test(word) ? 'propertyName.constant' : 'propertyName')
    }
    if (KEYWORDS.has(word)) {
      state.prevWord = word
      if (word === 'local') state.localDecl = true
      if (word === 'function') { state.funcDecl = true; state.localDecl = false }
      // インデント用: この行で開いた / 閉じたブロックを数える
      if (BLOCK_OPEN.has(word)) state.delta++
      else if (word === 'end' || word === 'until' || word === 'elseif') closer(state)
      else if (word === 'else' && state.leading) { state.delta++; state.keep = false }
      if (word === 'then' || word === 'do') state.typeAfterColon = false
      return OP_KW.has(word) ? 'operatorKeyword' : (word === 'function' || word === 'local' ? 'definitionKeyword' : 'controlKeyword')
    }
    if (word === 'nil') return 'null'
    if (word === 'true' || word === 'false') return 'bool'
    if (word === 'self') return 'self'
    if (CONTEXTUAL.has(word)) {
      if (word === 'continue' && !/^[.:([=]/.test(next)) return 'controlKeyword'
      if ((word === 'type' || word === 'export') && /^[A-Za-z_]/.test(next)) { if (word === 'type') state.typeDecl = true; return 'definitionKeyword' }
      if (word === 'typeof') return 'variableName.standard'
    }
    if (state.typeDecl) { state.typeDecl = false; return 'typeName.definition' }
    if (state.funcDecl) {
      if (next === '.' || next === ':') return 'variableName'
      state.funcDecl = false
      return 'variableName.function.definition'
    }
    if (prevWord === 'local' || state.localDecl) {
      if (prevWord === 'local' || prev === ',') return 'variableName.definition'
    }
    if (LIBS.has(word)) return 'namespace'
    if (DATATYPES.has(word)) return 'className'
    if (RBX_GLOBALS.has(word)) return 'variableName.standard'
    if (BUILTINS.has(word)) return isCall ? 'variableName.function.standard' : 'variableName.standard'
    if (state.ex.has(word)) return isCall ? 'variableName.function.special' : 'variableName.special'
    if (isCall) return 'variableName.function'
    return 'variableName'
  }
  // 記号
  stream.next()
  const two = ch + (stream.peek() || '')
  let op = ch
  if (/^(==|~=|<=|>=|\.\.|::|->|\/\/|\+=|-=|\*=|\/=|%=|\^=)$/.test(two)) { stream.next(); op = two }
  if (op === '.' && stream.peek() === '.') { stream.next(); op = '..' }
  if (op === '..' && stream.peek() === '.') { stream.next(); op = '...' }
  if (op === '..' && stream.peek() === '=') { stream.next(); op = '..=' }
  state.prevWord = null
  if (op === ':' && (state.localDecl || state.paramDepth > 0)) { state.typeMode = true; state.lastSig = ':'; return 'punctuation' }
  if (op === '::' || op === '->') { state.typeMode = true; state.lastSig = op; return 'operator' }
  if (op === ')' && state.paramDepth > 0 && state.parenDepth === state.paramStart) {
    state.paramDepth--
    // 戻り値の型
    if (/^\s*:/.test(stream.string.slice(stream.pos))) state.typeAfterColon = true
  }
  state.lastSig = op
  if (op === '=' || op === ',' || op === ';' || op === ')' || op === '(' || op === '}' || op === '{' || op === '[' || op === ']') {
    if (op === '=') { state.localDecl = false; state.typeMode = false; state.typeAfterColon = false }
    if (op === ',' && state.typeMode && state.typeDepth === 0) state.typeMode = false
    if (op === ')' && state.typeMode && state.typeDepth === 0) state.typeMode = false
    if (op === '(') {
      state.parenDepth++
      if (state.prevFunc) { state.paramDepth++; state.paramStart = state.parenDepth; state.prevFunc = false }
      state.delta++
      if (state.typeMode) state.typeDepth++
    }
    if (op === ')') { state.parenDepth--; closer(state); if (state.typeMode && state.typeDepth > 0) state.typeDepth-- }
    if (op === '{') { state.delta++; if (state.typeMode) state.typeDepth++; else if (state.interpDepth.length) state.interpDepth[state.interpDepth.length - 1]++ }
    if (op === '}') {
      if (state.interpDepth.length && !state.typeMode && state.interpDepth[state.interpDepth.length - 1] === 0) {
        state.interpDepth.pop()
        state.tokenize = readInterp
        return 'brace.special'
      }
      closer(state)
      if (state.typeMode && state.typeDepth > 0) state.typeDepth--
      else if (state.interpDepth.length) state.interpDepth[state.interpDepth.length - 1]--
    }
    if (op === '[') state.delta++
    if (op === ']') closer(state)
    if (op === '(' || op === ')') return 'paren'
    if (op === '{' || op === '}') return 'brace'
    if (op === '[' || op === ']') return 'squareBracket'
    return 'punctuation'
  }
  if (op === '@') { stream.match(/^\w+/); return 'meta' }
  if (op === '.' || op === ':') return 'punctuation'
  if (op === '|' || op === '&' || op === '?') return state.typeMode ? 'operator' : 'invalid'
  if (op === '!') return 'invalid'
  return 'operator'
}

// 行頭に並んだ閉じ (end / ) / } など) はその行自身を字下げ解除するだけで、次の行には影響しない
function closer(state) {
  if (state.leading) state.keep = true
  else state.delta--
}

function typeWord(word) {
  if (word === 'nil') return 'null'
  if (word === 'true' || word === 'false') return 'bool'
  if (word === 'typeof') return 'variableName.standard'
  return 'typeName'
}

const luauParser = {
  name: 'luau',
  startState: () => ({
    tokenize: null, base: 0, delta: 0, leading: true, keep: false, lastSig: null, prevWord: null, localDecl: false, funcDecl: false, prevFunc: false,
    typeMode: false, typeDepth: 0, typeDecl: false, typeAfterColon: false, paramDepth: 0, paramStart: 0, parenDepth: 0,
    interp: [], interpDepth: [], ex: NO_EXTRA,
  }),
  copyState: s => ({ ...s, interp: s.interp.slice(), interpDepth: s.interpDepth.slice() }),
  token(stream, state) {
    if (stream.sol()) {
      // 複数行の文字列・コメントの途中でなければ、この行をインデントの基準にする
      if (!state.tokenize) { state.base = stream.indentation(); state.delta = 0; state.leading = true }
      state.localDecl = false
      if (state.typeMode && state.typeDepth === 0) state.typeMode = false
      state.typeDecl = false
    }
    const style = state.tokenize ? state.tokenize(stream, state) : tokenBase(stream, state)
    const cur = stream.current()
    if (style !== null) {
      if (state.keep) state.keep = false
      else state.leading = false
    }
    // function の直後の ( は引数リスト (型注釈の判定に使用)
    if (cur === 'function') state.prevFunc = true
    else if (style !== null && cur !== '(' && !/^variableName/.test(style) && cur !== '.' && cur !== ':' && style !== 'propertyName' && style !== 'typeName' && cur !== '<' && cur !== '>' && cur !== ',') state.prevFunc = false
    // type Foo = <型> の右辺は型
    if (cur === '=' && state.lastTypeAlias) { state.typeMode = true; state.lastTypeAlias = false }
    if (style === 'typeName.definition') state.lastTypeAlias = true
    return style
  },
  // 前の行のインデントを基準に、ブロックを開いていれば 1 段深く、閉じで始まる行は 1 段浅くします。
  // (深さを数える方式と違い、括弧と function が同じ行にあっても 1 段だけ字下げされます)
  indent(state, textAfter, cx) {
    if (state.tokenize) return null
    let n = state.base + (state.delta > 0 ? cx.unit : state.delta < 0 ? -cx.unit : 0)
    if (CLOSER_START.test(textAfter)) n -= cx.unit
    return Math.max(0, n)
  },
  languageData: {
    commentTokens: { line: '--', block: { open: '--[[', close: ']]' } },
    closeBrackets: { brackets: ['(', '[', '{', '"', "'", '`'] },
    // end などを打った瞬間に字下げを戻す。endTime のように続きを打ったら元に戻す
    indentOnInput: /^\s*(?:(?:end|until|else|elseif|\}|\)|\])|(?:end|until|elseif)\w|else[^i\W])$/,
    wordChars: '_',
  },
}

// Studio 用と Executor 用で別の言語オブジェクトを使います (切り替えると色付けをやり直します)
const baseState = luauParser.startState
export const luauStudio = StreamLanguage.define(luauParser)
export const luauExecutor = StreamLanguage.define({ ...luauParser, startState: () => ({ ...baseState(), ex: EXEC_GLOBALS }) })
export const luauLanguage = luauStudio
export const luauFor = mode => (mode === 'executor' ? luauExecutor : luauStudio)

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

export { indentUnit }
