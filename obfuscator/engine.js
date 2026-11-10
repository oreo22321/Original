// Luau / Lua ソースコード難読化エンジン（ブラウザ内完結）
//
// 既存資産を再利用:
//   - js/luau/lexer.js  : tokenize()  … トークン列（各トークンに元ソースのオフセット s,e）
//   - js/luau/parser.js : parse() / checkSyntax()  … AST（識別子・束縛に s,e）
//   - js/luau/vm.js     : createVM()  … 難読化前後の「実行結果が一致するか」を検証
//
// 設計方針: 採用する変換はすべて *構造上 動作を変えない*(behavior-preserving)。
// さらに実行検証ラダーで「元コードと同じ動作」を自動確認し、万一崩れるパスは自動で外す。
// ネットワーク送信は一切なし。すべて端末内で処理する。

import { tokenize, LuauSyntaxError } from '../js/luau/lexer.js'
import { parse, checkSyntax } from '../js/luau/parser.js'
import { createVM } from '../js/luau/vm.js'
import { compileToLua, UnsupportedError } from './vm-compile.js'

// ---------------------------------------------------------------------------
// プリセット / 既定オプション
// ---------------------------------------------------------------------------
export const PRESETS = {
  //        変数名   ｸﾞﾛｰﾊﾞﾙ 数値    文字列   ｼﾞｬﾝｸ  ﾗｯﾌﾟ   ﾐﾆﾌｧｲ   VM      二重VM
  light:  { rename: true,  hoist: false, numbers: false, strings: true,  junk: false, wrap: true,  minify: false, vm: false, vmDouble: false, hideApi: false },
  normal: { rename: true,  hoist: false, numbers: true,  strings: true,  junk: false, wrap: true,  minify: true,  vm: false, vmDouble: false, hideApi: false },
  strong: { rename: true,  hoist: true,  numbers: true,  strings: true,  junk: true,  wrap: true,  minify: true,  vm: true,  vmDouble: false, hideApi: true  },
  max:    { rename: true,  hoist: true,  numbers: true,  strings: true,  junk: true,  wrap: true,  minify: true,  vm: true,  vmDouble: true,  hideApi: true  },
}

function normalizeOptions(opts) {
  const base = { ...PRESETS.strong }
  if (opts && typeof opts === 'object') {
    for (const k of Object.keys(base)) if (k in opts) base[k] = !!opts[k]
  }
  return base
}

// Lua / Luau 予約語（生成名が衝突しないように）
const RESERVED = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if',
  'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
  'continue', 'export', 'type', 'self',
])

// ---------------------------------------------------------------------------
// 一意な「紛らわしい」識別子の生成
// ---------------------------------------------------------------------------
class NameGen {
  constructor(avoid) {
    this.used = new Set(avoid)
    this.n = 0
  }
  _make(n) {
    const A = 'Il1O0o'
    let s = ''
    let x = n
    do { s = A[x % A.length] + s; x = Math.floor(x / A.length) } while (x > 0)
    return 'I' + s // 必ず英字で始まる有効な識別子
  }
  next() {
    for (;;) {
      this.n++
      const name = this._make(this.n)
      if (!this.used.has(name) && !RESERVED.has(name)) { this.used.add(name); return name }
    }
  }
}

// ソース中に出てくる識別子をすべて集める（生成名の衝突回避用）
function collectIdentifiers(src) {
  const ids = new Set()
  try {
    const { tokens } = tokenize(src)
    for (const t of tokens) {
      if (t.t === 'name') ids.add(t.v)
      else if (/^[A-Za-z_]/.test(t.t)) ids.add(t.t) // キーワード
    }
  } catch { /* 字句エラーは呼び出し側で処理 */ }
  return ids
}

// ---------------------------------------------------------------------------
// ステージ1: スコープ対応のローカル変数リネーム ＋ グローバル参照の巻き上げ
//   既存パーサの AST を歩き、各識別子の (s,e) 範囲を記録して元ソースへ範囲置換する。
// ---------------------------------------------------------------------------
function analyze(src, opts, nameGen) {
  const ast = parse(src) // 失敗時は LuauSyntaxError を投げる（呼び出し側で捕捉）

  const bindings = []          // { newName, rename, decls:[{s,e}], refs:[{s,e}] }
  const scopes = []            // Map(name -> binding) のスタック
  const globalReads = []       // { name, s, e }
  const globalWrites = new Set()

  const pushScope = () => scopes.push(new Map())
  const popScope = () => scopes.pop()
  const declare = (name, s, e, rename = true) => {
    const b = { name, newName: null, rename, decls: [], refs: [] }
    if (s != null && e != null) b.decls.push({ s, e })
    bindings.push(b)
    scopes[scopes.length - 1].set(name, b)
    return b
  }
  const lookup = (name) => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const b = scopes[i].get(name)
      if (b) return b
    }
    return null
  }
  const readName = (name, s, e) => {
    const b = lookup(name)
    if (b) { if (b.rename) b.refs.push({ s, e }) }
    else globalReads.push({ name, s, e })
  }
  const writeName = (name, s, e) => {
    const b = lookup(name)
    if (b) { if (b.rename) b.refs.push({ s, e }) }
    else globalWrites.add(name) // 代入されるグローバルは巻き上げ対象外
  }

  const inNewScope = (stats, predeclare) => {
    pushScope()
    if (predeclare) predeclare()
    for (const st of stats) walkStat(st)
    popScope()
  }

  const walkFunc = (func) => {
    inNewScope(func.body, () => {
      if (func.isMethod) declare('self', null, null, false) // 暗黙の self は参照解決のみ・改名しない
      for (const p of func.params) declare(p.name, p.s, p.e)
    })
  }

  function walkExpr(node) {
    if (!node || typeof node !== 'object') return
    switch (node.t) {
      case 'Name': readName(node.name, node.s, node.e); break
      case 'Index':
        walkExpr(node.obj)
        if (!node.dot) walkExpr(node.key) // a.b の b はフィールド名（文字列）なので触らない
        break
      case 'Call':
        walkExpr(node.fn)
        for (const a of node.args) walkExpr(a)
        break
      case 'Method':
        walkExpr(node.obj) // メソッド名は触らない
        for (const a of node.args) walkExpr(a)
        break
      case 'Bin': walkExpr(node.l); walkExpr(node.r); break
      case 'Un': walkExpr(node.e); break
      case 'Paren': walkExpr(node.e); break
      case 'Cast': walkExpr(node.e); break // 型注釈は触らない
      case 'Table':
        for (const it of node.items) {
          if (it.k === 'expr') walkExpr(it.key) // [expr]=value のキー
          walkExpr(it.value)                    // named のキーは文字列なので触らない
        }
        break
      case 'Func': walkFunc(node); break
      case 'Interp':
        for (const p of node.parts) if (typeof p !== 'string') walkExpr(p)
        break
      case 'IfExpr':
        for (const c of node.clauses) { walkExpr(c.cond); walkExpr(c.val) }
        walkExpr(node.orelse)
        break
      default: break // Number/String/Nil/True/False/Vararg など
    }
  }

  function walkStat(st) {
    switch (st.t) {
      case 'Local':
        for (const v of st.values) walkExpr(v)
        for (const b of st.names) declare(b.name, b.s, b.e)
        break
      case 'LocalFunction':
        declare(st.name.name, st.name.s, st.name.e) // 再帰のため先に宣言
        walkFunc(st.func)
        break
      case 'Function':
        if (st.target.t === 'Name') writeName(st.target.name, st.target.s, st.target.e)
        else walkExpr(st.target)
        walkFunc(st.func)
        break
      case 'Assign':
        for (const v of st.values) walkExpr(v)
        for (const tg of st.targets) {
          if (tg.t === 'Name') writeName(tg.name, tg.s, tg.e)
          else walkExpr(tg)
        }
        break
      case 'Compound':
        // 複合代入は読み書き両方だが、対象がローカルなら ref 1 回で十分
        if (st.target.t === 'Name') writeName(st.target.name, st.target.s, st.target.e)
        else walkExpr(st.target)
        walkExpr(st.value)
        break
      case 'CallStat': walkExpr(st.call); break
      case 'Do': inNewScope(st.body); break
      case 'While': walkExpr(st.cond); inNewScope(st.body); break
      case 'Repeat':
        pushScope()
        for (const s of st.body) walkStat(s)
        walkExpr(st.cond) // until 条件は body のローカルを見られる
        popScope()
        break
      case 'NumFor':
        walkExpr(st.start); walkExpr(st.stop); if (st.step) walkExpr(st.step)
        inNewScope(st.body, () => declare(st.var.name, st.var.s, st.var.e))
        break
      case 'GenFor':
        for (const e of st.exprs) walkExpr(e)
        inNewScope(st.body, () => { for (const v of st.vars) declare(v.name, v.s, v.e) })
        break
      case 'If':
        for (const c of st.clauses) { walkExpr(c.cond); inNewScope(c.body) }
        if (st.orelse) inNewScope(st.orelse)
        break
      case 'Return': for (const v of st.values) walkExpr(v); break
      case 'Break': case 'Continue': break
      case 'TypeAlias': break // 型レベルは触らない（実行時には消える）
      default: break
    }
  }

  inNewScope(ast.body) // チャンク本体

  // --- 置換リストを構築 ---
  const edits = []
  if (opts.rename) {
    for (const b of bindings) {
      if (!b.rename) continue
      if (b.decls.length === 0 && b.refs.length === 0) continue
      b.newName = nameGen.next()
      for (const r of b.decls) edits.push({ s: r.s, e: r.e, text: b.newName })
      for (const r of b.refs) edits.push({ s: r.s, e: r.e, text: b.newName })
    }
  }

  // --- グローバル巻き上げ（値として読むだけで代入されないグローバルのみ） ---
  let aliasText = ''
  if (opts.hoist) {
    const hoistable = new Map() // name -> aliasName
    for (const g of globalReads) {
      if (globalWrites.has(g.name)) continue
      if (!hoistable.has(g.name)) hoistable.set(g.name, nameGen.next())
    }
    if (hoistable.size > 0) {
      for (const g of globalReads) {
        const alias = hoistable.get(g.name)
        if (alias) edits.push({ s: g.s, e: g.e, text: alias })
      }
      const names = [...hoistable.values()]
      const reals = [...hoistable.keys()]
      aliasText = `local ${names.join(',')}=${reals.join(',')}`
    }
  }

  return { renamed: applyEdits(src, edits), aliasText }
}

function applyEdits(src, edits) {
  if (edits.length === 0) return src
  edits.sort((a, b) => b.s - a.s) // 後ろから適用（オフセットがずれない）
  let out = src
  let prevS = Infinity
  for (const ed of edits) {
    if (ed.e > prevS) continue // 念のため重複はスキップ
    out = out.slice(0, ed.s) + ed.text + out.slice(ed.e)
    prevS = ed.s
  }
  return out
}

// ---------------------------------------------------------------------------
// 数値リテラル難読化（厳密に等価な整数式へ）
// ---------------------------------------------------------------------------
function numExpr(raw) {
  if (!/^\d+$/.test(raw)) return null // 10進の非負整数だけ対象（float/hex はそのまま）
  const v = Number(raw)
  if (!Number.isSafeInteger(v) || v > 0xffffffff) return null
  const r = Math.random()
  if (r < 0.5) {
    const q = 1 + Math.floor(Math.random() * 4096)
    return `(${v + q}-${q})`
  }
  const a = 2 + Math.floor(Math.random() * 40)
  const k = Math.floor(v / a)
  const m = v - a * k
  return `(${a}*${k}+${m})`
}

// ---------------------------------------------------------------------------
// ミニファイ時のトークン間スペース判定
// ---------------------------------------------------------------------------
const isWordChar = (c) => /[A-Za-z0-9_]/.test(c)
const DANGER_PAIRS = new Set([
  '--', '..', '::', '//', '==', '~=', '<=', '>=', '->',
  '+=', '-=', '*=', '/=', '%=', '^=', '[[', '<<', '>>',
])
function needSpace(a, b) {
  if (!a) return false
  if (isWordChar(a) && isWordChar(b)) return true
  const pair = a + b
  if (DANGER_PAIRS.has(pair)) return true
  if (/\d/.test(a) && b === '.') return true // 1 .5 が 1.5 にならないように
  if (a === '.' && /\d/.test(b)) return true
  return false
}

// 直前トークンが「呼び出し糖衣構文の前置式」を終えるものか（print"x" / f{} など）
function endsPrefixExpr(tok) {
  return tok && (tok.t === 'name' || tok.t === ')' || tok.t === ']' || tok.t === '}' ||
    tok.t === 'string' || tok.t === 'interp')
}

// ---------------------------------------------------------------------------
// ステージ2: 文字列プール暗号化 / 数値難読化 / ミニファイ（トークン単位）
// ---------------------------------------------------------------------------
function stage2(src1, opts, nameGen) {
  const { tokens } = tokenize(src1)

  const pool = []
  const poolIndex = new Map()
  const key = 1 + Math.floor(Math.random() * 250)
  const addString = (bytes) => {
    if (poolIndex.has(bytes)) return poolIndex.get(bytes)
    const enc = []
    for (let i = 0; i < bytes.length; i++) enc.push((bytes.charCodeAt(i) + key) % 256)
    const idx = pool.length + 1
    pool.push(enc)
    poolIndex.set(bytes, idx)
    return idx
  }

  // 復号関数などの名前（本体と衝突しないもの）
  const POOL = nameGen.next(), DEC = nameGen.next(), P = nameGen.next()
  const T = nameGen.next(), S = nameGen.next(), J = nameGen.next()

  const useMinify = opts.minify
  let out = ''
  let last = ''
  const emit = (txt) => {
    if (txt === '') return
    if (useMinify && needSpace(last, txt[0])) out += ' '
    out += txt
    last = txt[txt.length - 1]
  }

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]
    if (t.t === 'eof') break
    const prev = k > 0 ? tokens[k - 1] : null

    // 非ミニファイ時は元の空白・コメントを保持
    if (!useMinify && prev) {
      const gap = src1.slice(prev.e, t.s)
      out += gap
      if (gap.length) last = gap[gap.length - 1]
    }

    let txt
    if (t.t === 'string' && opts.strings) {
      const idx = addString(t.v)
      txt = `${DEC}(${idx})`
      if (endsPrefixExpr(prev)) txt = `(${txt})` // print"x" → print(DEC(i))
    } else if (t.t === 'number' && opts.numbers) {
      const raw = src1.slice(t.s, t.e)
      txt = numExpr(raw) || raw
    } else {
      txt = src1.slice(t.s, t.e)
    }
    emit(txt)
  }

  let stringPrelude = ''
  if (opts.strings && pool.length > 0) {
    const poolLit = '{' + pool.map(a => '{' + a.join(',') + '}').join(',') + '}'
    stringPrelude =
      `local ${POOL}=${poolLit} ` +
      `local function ${DEC}(${P}) ` +
      `local ${T}=${POOL}[${P}] local ${S}="" ` +
      `for ${J}=1,#${T} do ${S}=${S}..string.char((${T}[${J}]-${key})%256) end ` +
      `return ${S} end`
  }

  return { body: out, stringPrelude }
}

// ---------------------------------------------------------------------------
// ジャンク（無害・完全に非実行 or 恒等）コードの生成
// ---------------------------------------------------------------------------
function junkStatements(nameGen, count = 2) {
  const out = []
  for (let i = 0; i < count; i++) {
    const a = nameGen.next(), b = nameGen.next()
    const n = 1 + Math.floor(Math.random() * 9)
    // a=0 → 0回ループ → a は 0 のまま → if は常に false。副作用なし。
    out.push(`local ${a}=0 for ${b}=1,0 do ${a}=${a}+${n} end if ${a}~=0 then return end`)
  }
  return out.join(' ')
}

// ---------------------------------------------------------------------------
// 1 回分の難読化（同期）
// ---------------------------------------------------------------------------
export function buildOnce(src, options) {
  const opts = normalizeOptions(options)

  // --- VM 方式（独自バイトコードVM / 制御フロー平坦化 / 暗号化 / 改ざん検知） ---
  // 対応できない構文に当たると UnsupportedError を投げ、呼び出し側が従来方式へフォールバック。
  if (opts.vm) {
    let lua = compileToLua(src, { rnd: Math.random, hideApi: opts.hideApi }).lua
    if (opts.vmDouble) lua = compileToLua(lua, { rnd: Math.random }).lua // 二重VM（外側は名前隠蔽なし）
    if (opts.minify) lua = stage2(lua, { strings: false, numbers: false, minify: true }, new NameGen(collectIdentifiers(lua))).body
    return lua
  }

  const nameGen = new NameGen(collectIdentifiers(src))

  // ステージ1（rename / hoist が両方 off でも素通り）
  let renamed = src
  let aliasText = ''
  if (opts.rename || opts.hoist) {
    const r = analyze(src, opts, nameGen)
    renamed = r.renamed
    aliasText = r.aliasText
  }

  // ステージ2（strings / numbers / minify）
  const { body, stringPrelude } = stage2(renamed, opts, nameGen)

  // ジャンク
  const junk = opts.junk ? junkStatements(nameGen, 2) : ''

  // 組み立て（前置き → 本体）。文はそれぞれ改行で区切れば常に安全。
  const parts = [junk, stringPrelude, aliasText, body].filter(Boolean)
  let inner = parts.join('\n')

  if (opts.wrap) inner = `return (function(...)\n${inner}\nend)(...)`
  return inner
}

function syntaxOk(code) {
  return checkSyntax(code) === null
}

// ---------------------------------------------------------------------------
// 実行検証（難読化前後の出力列を比較）
// ---------------------------------------------------------------------------
export function runCapture(src, timeLimit = 2000) {
  return new Promise((resolve) => {
    const out = []
    let errored = false
    let done = false
    const finish = (ran) => { if (done) return; done = true; resolve({ ran, errored, out }) }
    const hooks = {
      output: (k, t) => out.push(k + '\u0000' + t),
      onError: () => { errored = true; out.push('\u0001') },
      onIdle: () => finish(true),
    }
    let vm
    try { vm = createVM(hooks, { timeLimit }) } catch { return finish(false) }
    try { vm.run(src, 'verify') } catch { errored = true; return finish(true) }
    setTimeout(() => finish(true), timeLimit + 500)
  })
}

function sameOutput(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// ---------------------------------------------------------------------------
// 公開 API: 検証フォールバックラダー付きの難読化
// ---------------------------------------------------------------------------
export async function obfuscate(src, options) {
  if (typeof src !== 'string' || src.trim() === '') {
    return { ok: false, error: 'コードが空です。' }
  }
  // 入力自体が構文エラーなら難読化しない
  const srcErr = checkSyntax(src)
  if (srcErr) {
    return { ok: false, error: `入力に構文エラーがあります: ${srcErr.message} (${srcErr.line} 行目)` }
  }

  const opts = normalizeOptions(options)
  // 強い順に外していける任意パス（名前隠蔽→二重VM→VM の順で外れる）
  const droppable = ['hideApi', 'vmDouble', 'vm', 'junk', 'hoist', 'numbers', 'strings', 'minify']
  const dropped = []

  // 実行検証が可能か（純粋に完走し決定的な場合のみ）
  const orig1 = await runCapture(src)
  let canVerify = orig1.ran && !orig1.errored
  let origOut = orig1.out
  if (canVerify) {
    const orig2 = await runCapture(src)
    if (!(orig2.ran && !orig2.errored) || !sameOutput(orig1.out, orig2.out)) canVerify = false
  }

  let dropIndex = 0
  for (;;) {
    let code
    try {
      code = buildOnce(src, opts)
    } catch (e) {
      // 変換で想定外 → 任意パスを外して再試行、尽きたら原文を返す
      if (dropIndex < droppable.length) { opts[droppable[dropIndex]] = false; dropped.push(droppable[dropIndex]); dropIndex++; continue }
      return { ok: true, code: src, report: { verified: false, verifiable: canVerify, dropped, note: '安全のため変換を最小化しました。' } }
    }

    if (!syntaxOk(code)) {
      if (dropIndex < droppable.length) { opts[droppable[dropIndex]] = false; dropped.push(droppable[dropIndex]); dropIndex++; continue }
      return { ok: true, code: src, report: { verified: false, verifiable: canVerify, dropped, note: '安全のため変換を最小化しました。' } }
    }

    if (canVerify) {
      const res = await runCapture(code)
      if (!res.ran || res.errored || !sameOutput(origOut, res.out)) {
        if (dropIndex < droppable.length) { opts[droppable[dropIndex]] = false; dropped.push(droppable[dropIndex]); dropIndex++; continue }
        // すべて外しても不一致（通常起きない）→ 原文を返す
        return { ok: true, code: src, report: { verified: false, verifiable: canVerify, dropped, note: '安全のため変換を最小化しました。' } }
      }
    }

    return {
      ok: true,
      code,
      report: {
        verified: canVerify,            // true: 実行して元と同じ動作を確認
        verifiable: canVerify,
        dropped,                        // 外したパス
        applied: opts,                  // 実際に適用した構成
        originalLength: src.length,
        resultLength: code.length,
      },
    }
  }
}

export { LuauSyntaxError }
