// 実機で実行するコードの下ごしらえ (行番号は変えません: 改行を足さず、同じ行の中に書き足すだけ)
// ・片付け用の印: イベントの接続 (:Connect / :Once)、作ったオブジェクト (Instance.new / :Clone)、
//   動かしたスレッド (task.spawn / task.delay / task.defer) を覚えておき、もう一度実行する前・止めたときに片付ける
// ・デバッグ用の印: 各文の前に「止まるべきならここで止まる」処理を入れる (その場所で見える変数も一緒に渡す)
// 印の関数 (__T など) は、コネクターが 1 行目の先頭で用意します
import { parse } from '../luau/parser.js'

const CONNECT = new Set(['Connect', 'Once', 'ConnectParallel'])
const THREAD_FNS = new Set(['spawn', 'delay', 'defer'])
const MAX_VARS = 30

export function instrumentForDevice(src, { debug = false, track = true } = {}) {
  let ast
  try { ast = parse(src) } catch { return { code: src, ok: false } } // 構文エラー: そのまま送る (ゲームの中でエラーを表示)
  const ins = [] // { pos, text, rank } rank: 同じ位置なら小さい方が先 (文の前の印 → 式を包む印)
  const lineStarts = [0]
  for (let i = src.indexOf('\n'); i >= 0; i = src.indexOf('\n', i + 1)) lineStarts.push(i + 1)
  const lineOf = pos => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lineStarts[m] <= pos) lo = m; else hi = m - 1 } return lo + 1 }
  const doneLines = new Set()
  const scopes = [[]]
  const visible = () => {
    const seen = new Set(), out = []
    for (let i = scopes.length - 1; i >= 0 && out.length < MAX_VARS; i--) {
      const sc = scopes[i]
      for (let j = sc.length - 1; j >= 0 && out.length < MAX_VARS; j--) {
        const n = sc[j]
        if (seen.has(n) || n.startsWith('__') || n === '...') continue
        seen.add(n)
        out.push(n)
      }
    }
    return out
  }
  const declare = n => { if (n && /^[A-Za-z_]\w*$/.test(n)) scopes[scopes.length - 1].push(n) }
  const wrapExpr = (node, fn) => {
    if (typeof node.s !== 'number' || typeof node.e !== 'number') return
    ins.push({ pos: node.s, text: fn + '(', rank: 1 })
    ins.push({ pos: node.e, text: ')', rank: -1 })
  }

  // ---- 式 ----
  function expr(e) {
    if (!e || typeof e !== 'object') return
    switch (e.t) {
      case 'Method':
        expr(e.obj); e.args.forEach(expr)
        if (track && (CONNECT.has(e.name) || e.name === 'Clone')) wrapExpr(e, e.name === 'Clone' ? '__TI' : '__T')
        return
      case 'Call': {
        expr(e.fn); e.args.forEach(expr)
        const fn = e.fn
        if (track && fn.t === 'Index' && fn.dot && fn.obj.t === 'Name') {
          if (fn.obj.name === 'Instance' && fn.key.v === 'new') wrapExpr(e, '__TI')
          else if (fn.obj.name === 'task' && THREAD_FNS.has(fn.key.v)) wrapExpr(e, '__TT')
        }
        return
      }
      case 'Index': expr(e.obj); if (!e.dot) expr(e.key); return
      case 'Bin': expr(e.l); expr(e.r); return
      case 'Un': case 'Paren': case 'Cast': expr(e.e); return
      case 'Func': func(e); return
      case 'Table': for (const it of e.items) { if (it.k === 'expr') expr(it.key); expr(it.value) } return
      case 'IfExpr': for (const c of e.clauses) { expr(c.cond); expr(c.val) } expr(e.orelse); return
      case 'Interp': for (const p of e.parts) if (typeof p !== 'string') expr(p); return
    }
  }
  function func(f, isMethod) {
    scopes.push([])
    if (isMethod || f.isMethod) declare('self')
    for (const p of f.params || []) declare(p.name)
    block(f.body, false)
    scopes.pop()
  }

  // ---- 文 ----
  function before(st) {
    if (!debug || typeof st.s !== 'number') return
    const line = lineOf(st.s)
    if (doneLines.has(line)) return // 1 行に文が 2 つ以上あるときは最初の文だけ
    doneLines.add(line)
    const vars = visible()
    const args = vars.map(n => `"${n}", ${n}`).join(', ')
    ins.push({ pos: st.s, text: `if __DB[${line}] then __BP(${line}${args ? ', ' + args : ''}) end `, rank: 0 })
  }
  function block(stats, newScope = true) {
    if (newScope) scopes.push([])
    for (const st of stats || []) stat(st)
    if (newScope) scopes.pop()
  }
  function stat(st) {
    before(st)
    switch (st.t) {
      case 'Local': st.values.forEach(expr); st.names.forEach(n => declare(n.name)); return
      case 'LocalFunction': declare(st.name.name); func(st.func); return
      case 'Function': expr(st.target.t === 'Name' ? null : st.target.obj); func(st.func, st.isMethod); return
      case 'Assign': st.values.forEach(expr); st.targets.forEach(t => { if (t.t !== 'Name') expr(t) }); return
      case 'Compound': expr(st.value); if (st.target.t !== 'Name') expr(st.target); return
      case 'CallStat': expr(st.call); return
      case 'If': for (const c of st.clauses) { expr(c.cond); block(c.body) } if (st.orelse) block(st.orelse); return
      case 'While': expr(st.cond); block(st.body); return
      case 'Repeat': scopes.push([]); block(st.body, false); expr(st.cond); scopes.pop(); return
      case 'NumFor': expr(st.start); expr(st.stop); expr(st.step); scopes.push([]); declare(st.var.name); block(st.body, false); scopes.pop(); return
      case 'GenFor': st.exprs.forEach(expr); scopes.push([]); st.vars.forEach(v => declare(v.name)); block(st.body, false); scopes.pop(); return
      case 'Do': block(st.body); return
      case 'Return': st.values.forEach(expr); return
    }
  }
  block(ast.body, false)
  if (!ins.length) return { code: src, ok: true, lines: [] }
  // 後ろから書き足す (同じ位置は rank の小さい方が前に来るように)
  ins.sort((a, b) => b.pos - a.pos || b.rank - a.rank)
  let out = src
  for (const x of ins) out = out.slice(0, x.pos) + x.text + out.slice(x.pos)
  return { code: out, ok: true, lines: [...doneLines].sort((a, b) => a - b) }
}
