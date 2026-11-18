// Forge AI: コードの説明 (Python)
// ・explainCode: 全体の構成 (import・関数・クラス) と、処理の流れを日本語で説明 (範囲を選ぶと 1 行ずつ)
// ・addComments: 処理の上に説明のコメントを足す (処理は変えない)
// ・addTypes: 既定値や return から分かる型ヒントを付ける
// 文の構造は pytools ワーカーの ast 解析 (__fca_describe) から受け取ります
import { lineOf, applyEdits } from './pycode.js'

const MODULES = {
  random: '乱数', math: '数学の関数', time: '時間', datetime: '日付と時刻', json: 'JSON の読み書き', csv: 'CSV の読み書き', os: 'OS・ファイルの操作',
  sys: 'Python の設定', re: '正規表現', collections: '便利なデータ構造', itertools: 'くり返しの道具', functools: '関数の道具', string: '文字の定数',
  statistics: '統計', pathlib: 'ファイルのパス', secrets: '安全な乱数', unittest: 'テスト', dataclasses: 'データクラス', typing: '型ヒント',
  numpy: '数値計算', pandas: '表のデータ分析', 'matplotlib.pyplot': 'グラフ', matplotlib: 'グラフ', copy: 'コピー', calendar: 'カレンダー',
  operator: '演算子の関数', decimal: '正確な小数', fractions: '分数', heapq: '優先度つきキュー', bisect: '二分探索', textwrap: '文章の折り返し',
  sympy: '数式の計算', scipy: '科学技術計算', sqlite3: 'データベース', hashlib: 'ハッシュ', base64: 'Base64', uuid: 'ID の生成', enum: '列挙型', asyncio: '非同期処理',
}
const q = s => '`' + String(s).replace(/`/g, "'") + '`'
const TYPE_JA = { int: '整数', float: '小数', str: '文字列', bool: '真偽値', None: 'None', complex: '複素数', bytes: 'バイト列' }
const CALL_JA = {
  len: '長さ', sum: '合計', max: '最大の値', min: '最小の値', sorted: '並べ替えた新しいリスト', abs: '絶対値', round: '四捨五入した値', range: '数の並び',
  list: 'リスト', dict: '辞書', set: '集合', tuple: 'タプル', int: '整数に変換した値', float: '小数に変換した値', str: '文字列に変換した値', open: '開いたファイル',
  'random.randint': '乱数 (整数)', 'random.random': '0〜1 の乱数', 'random.choice': 'ランダムに選んだ 1 つ', 'random.sample': 'ランダムに選んだいくつか', 'random.uniform': '乱数 (小数)',
  'math.sqrt': '平方根', 'math.floor': '切り捨てた値', 'math.ceil': '切り上げた値', 'time.time': '今の時刻 (秒)', 'time.perf_counter': '計測用の時刻',
  'datetime.now': '今の日時', 'date.today': '今日の日付', 'json.load': 'JSON から読み込んだデータ', 'json.loads': 'JSON から読み込んだデータ', 'enumerate': '番号付きの並び', zip: '組にした並び',
  'pd.read_csv': 'CSV から読んだ表', 'pd.DataFrame': '表 (DataFrame)', 'np.array': 'numpy の配列', 'Counter': '数を数えた結果', 'defaultdict': '既定値つきの辞書',
}
const callJa = f => CALL_JA[f] || CALL_JA[f.split('.').slice(-2).join('.')] || null

function valueJa(v, target) {
  if (!v) return ''
  const t = q(target)
  switch (v.kind) {
    case 'call':
      if (v.func === 'input') return `入力を受け取って${v.convert ? ` ${TYPE_JA[v.convert] || v.convert}に変換し、` : ''} ${t} に入れます${v.convert ? '' : ' (文字列です)'}`
      return callJa(v.func) ? `${q(v.src)} の結果 (${callJa(v.func)}) を ${t} に入れます` : /^[A-Z]/.test(v.func.split('.').pop()) ? `${q(v.func)} のインスタンスを作って ${t} に入れます` : `${q(v.src)} を呼んだ結果を ${t} に入れます`
    case 'const': return v.type === 'None' ? `${t} を None (まだ何もない) にします` : `${t} に${TYPE_JA[v.type] || '値'} ${q(v.src)} を入れます`
    case 'list': return v.n ? `${t} に ${v.n} 個の値のリストを作ります` : `${t} に空のリストを作ります`
    case 'dict': return v.n ? `${t} に ${v.n} 組のキーと値を持つ辞書を作ります` : `${t} に空の辞書を作ります`
    case 'set': return `${t} に集合を作ります`
    case 'tuple': return `${t} にタプル ${q(v.src)} を入れます`
    case 'comp': return `内包表記で新しい${{ list: 'リスト', set: '集合', dict: '辞書', gen: 'ジェネレーター' }[v.of]}を作り、${t} に入れます`
    case 'fstring': return `f-string で文字列を組み立てて ${t} に入れます`
    case 'binop': return `${q(v.src)} を計算した結果を ${t} に入れます`
    case 'compare': case 'boolop': return `条件 ${q(v.src)} の結果 (True / False) を ${t} に入れます`
    case 'name': return `${q(v.name)} の値を ${t} に入れます`
    case 'lambda': return `小さな関数 (lambda) を ${t} に入れます`
    case 'ifexp': return `条件によって選んだ値 (${q(v.src)}) を ${t} に入れます`
    case 'subscript': return `${q(v.src)} (一部を取り出した値) を ${t} に入れます`
    default: return `${q(v.src)} を ${t} に入れます`
  }
}

function forJa(s) {
  const it = s.iter || {}
  const v = q(s.target)
  if (it.func === 'range') {
    const a = it.args || []
    if (a.length === 1) return `${v} を 0 から ${a[0]} - 1 まで変えながら、${a[0]} 回くり返します`
    if (a.length === 2) return `${v} を ${a[0]} から ${a[1]} - 1 まで 1 ずつ変えながらくり返します`
    if (a.length === 3) return `${v} を ${a[0]} から ${a[1]} の手前まで ${a[2]} ずつ変えながらくり返します`
  }
  if (it.func === 'enumerate') return `${q((it.args || [])[0] || it.src)} の番号と値を ${v} に取り出しながらくり返します`
  if (it.func === 'zip') return `${(it.args || []).map(q).join(' と ')} を同時に 1 つずつ取り出してくり返します`
  if (/\.items$/.test(it.func || '')) return `辞書 ${q(it.func.replace(/\.items$/, ''))} のキーと値を ${v} に取り出してくり返します`
  if (/\.keys$/.test(it.func || '')) return `辞書 ${q(it.func.replace(/\.keys$/, ''))} のキーを順にくり返します`
  if (/\.values$/.test(it.func || '')) return `辞書 ${q(it.func.replace(/\.values$/, ''))} の値を順にくり返します`
  return `${q(it.src)} の中身を 1 つずつ ${v} に入れてくり返します`
}

function callStmtJa(s) {
  const f = s.func || ''
  const args = s.args || []
  if (f === 'print') return args.length ? `${args.map(q).join('、')} を表示します` : '空の行を表示します'
  if (f === 'input') return '入力を待ちます (入力した値は使っていません)'
  if (/\.append$/.test(f)) return `${q(f.replace(/\.append$/, ''))} の最後に ${q(args[0] || '')} を追加します`
  if (/\.extend$/.test(f)) return `${q(f.replace(/\.extend$/, ''))} に ${q(args[0] || '')} の中身を全部追加します`
  if (/\.insert$/.test(f)) return `${q(f.replace(/\.insert$/, ''))} の ${args[0]} 番目に ${q(args[1] || '')} を入れます`
  if (/\.remove$/.test(f)) return `${q(f.replace(/\.remove$/, ''))} から ${q(args[0] || '')} を取り除きます`
  if (/\.pop$/.test(f)) return `${q(f.replace(/\.pop$/, ''))} から取り出します`
  if (/\.sort$/.test(f)) return `${q(f.replace(/\.sort$/, ''))} を並べ替えます${s.kw && s.kw.includes('reverse') ? ' (大きい順)' : ''}`
  if (/\.update$/.test(f)) return `${q(f.replace(/\.update$/, ''))} を更新します`
  if (/\.write$/.test(f)) return `ファイルに ${q(args[0] || '')} を書き込みます`
  if (f === 'time.sleep' || f === 'sleep') return `${args[0] || ''} 秒待ちます`
  if (f === 'random.shuffle') return `${q(args[0] || '')} の並びをランダムに混ぜます`
  if (/^plt\.show$/.test(f)) return '描いたグラフを表示します (出力に図が出ます)'
  if (/^plt\.(plot|bar|pie|scatter|hist|barh)$/.test(f)) return `グラフ (${{ plot: '折れ線', bar: '棒', pie: '円', scatter: '散布図', hist: 'ヒストグラム', barh: '横棒' }[f.split('.')[1]]}) を描きます`
  if (/^plt\./.test(f)) return 'グラフの見た目 (タイトル・軸など) を設定します'
  if (f === 'unittest.main') return 'テストを実行します'
  if (/^(sys\.exit|exit|quit)$/.test(f)) return 'プログラムを終わります'
  if (f === 'main') return 'main 関数を呼んで、プログラムを始めます'
  return `${q(s.src || f + '(…)')} を呼びます`
}

export function stmtJa(s) {
  switch (s.kind) {
    case 'import': {
      if (s.frm !== undefined) return `${q(s.frm)}${MODULES[s.frm] ? ` (${MODULES[s.frm]})` : ''} から ${s.names.map(q).join('、')} を読み込みます`
      return s.modules.map((m, i) => `${q(m)}${MODULES[m] ? ` (${MODULES[m]})` : ''}${s.aliases[i] ? ` を ${q(s.aliases[i])} という名前で` : ' を'}`).join('、') + '読み込みます'
    }
    case 'def': {
      const args = s.args.filter(a => a.name !== 'self' && a.name !== 'cls')
      const what = s.method ? `${q(s.method)} のメソッド` : '関数'
      const special = { __init__: '(インスタンスを作るときに呼ばれ、属性を準備します)', __str__: '(print したときの表示を決めます)', __repr__: '(表示用の文字列を決めます)', __len__: '(len() の結果を決めます)', __eq__: '(== で比べたときの動きを決めます)' }[s.name]
      const parts = [`${what} ${q(s.name + '(' + s.args.map(a => a.name).join(', ') + ')')} を作ります${special ? ' ' + special : ''}`]
      if (args.length) parts.push(`受け取るもの: ${args.map(a => q(a.name) + (a.default != null ? ` (省略すると ${a.default})` : '')).join('、')}`)
      if (s.doc) parts.push(`説明: 「${s.doc}」`)
      if (s.yields) parts.push('yield で値を 1 つずつ渡すジェネレーターです')
      else if (s.returns) parts.push(`結果 (${s.ret.slice(0, 2).map(q).join(' / ')}) を返します`)
      if (s.recursive) parts.push('中で自分自身を呼ぶ「再帰」関数です')
      if (s.decorators && s.decorators.length) parts.push(`デコレーター ${s.decorators.map(d => q('@' + d)).join(' ')} が付いています`)
      return parts.join('。')
    }
    case 'class': {
      const parts = [`クラス ${q(s.name)} を作ります${s.bases.length ? ` (${s.bases.map(q).join('、')} を継承)` : ''}${s.decorators && s.decorators.some(d => /dataclass/.test(d)) ? ' (dataclass)' : ''}`]
      if (s.doc) parts.push(`説明: 「${s.doc}」`)
      const ms = s.methods.filter(m => !/^__/.test(m))
      if (ms.length) parts.push(`メソッド: ${ms.map(m => q(m + '()')).join('、')}`)
      const attrs = [...new Set([...(s.fields || []), ...(s.attrs || [])])]
      if (attrs.length) parts.push(`持っているデータ (属性): ${attrs.map(q).join('、')}`)
      return parts.join('。')
    }
    case 'assign': return s.targets.length > 1 ? `${s.targets.map(q).join(' と ')} に同じ値を入れます` : /,/.test(s.targets[0]) && s.value.kind !== 'call' ? `${s.targets[0].split(',').map(x => q(x.trim())).join('、')} にまとめて値を入れます (${q(s.value.src)})` : valueJa(s.value, s.targets[0])
    case 'annassign': return `${q(s.targets[0])} を型 ${q(s.ann)} として用意します`
    case 'augassign': return augJa(s)
    case 'for': return forJa(s) + (s.orelse ? '。最後まで回ったら else の処理をします' : '')
    case 'while': return s.forever ? `ずっとくり返します${s.hasBreak ? ' (break で抜けます)' : ' (止まらないので ■ で止めます)'}` : `${q(s.test)} が成り立つ間、くり返します`
    case 'if': return s.main ? 'このファイルを直接実行したときだけ、中の処理をします' : `もし ${q(s.test)} なら、次の処理をします${s.elifs ? `。ほかに ${s.elifs} 個の条件 (elif) があります` : ''}${s.hasElse ? '。どれでもなければ else の処理をします' : ''}`
    case 'elif': return `そうでなく、${q(s.test)} なら`
    case 'else': return 'どの条件にも当てはまらないとき'
    case 'with': return s.items.map(it => it.open ? `ファイル ${it.open[0] || ''} を${/["']w/.test(it.open[1] || '') ? '書き込み' : /["']a/.test(it.open[1] || '') ? '追記' : '読み込み'}用に開き${it.as ? `、${q(it.as)} として使います` : 'ます'} (終わると自動で閉じます)` : `${q(it.src)} を使う間の処理をします`).join('。')
    case 'try': return `エラーが起きるかもしれない処理を試します${s.handlers.length ? ` (${s.handlers.map(h => h ? q(h) : '何でも').join('・')} のエラーに対応)` : ''}${s.hasFinally ? '。finally は必ず最後に実行します' : ''}`
    case 'except': return `${s.type ? q(s.type) : 'どんな'} エラーが起きたとき${s.name ? ` (内容は ${q(s.name)})` : ''}`
    case 'return': return s.value ? `結果 ${q(s.value.src)} を返して、関数を終わります` : '関数を終わります'
    case 'call': return callStmtJa(s)
    case 'expr': return `${q(s.src)} を計算します`
    case 'break': return 'ループを抜けます'
    case 'continue': return 'この回の残りを飛ばして、次の回へ進みます'
    case 'pass': return '何もしません (中身を後で書くための目印)'
    case 'raise': return s.exc ? `エラー ${q(s.exc)} を起こします` : '受けたエラーをもう一度起こします'
    case 'global': return `関数の外の変数 ${s.names.map(q).join('、')} を書き換えられるようにします`
    case 'nonlocal': return `外側の関数の変数 ${s.names.map(q).join('、')} を書き換えられるようにします`
    case 'assert': return `${q(s.test)} が成り立つか確かめます (成り立たないと AssertionError)`
    case 'del': return `${s.targets.map(q).join('、')} を削除します`
    case 'docstring': return '説明 (docstring)'
    case 'match': return `${q(s.subject)} の値によって処理を分けます`
    default: return `${q(s.src || '')}`
  }
}
// augassign は読みやすい文にしておく
function augJa(s) {
  const sym = { Add: '+', Sub: '-', Mult: '*', Div: '/', FloorDiv: '//', Mod: '%', Pow: '**' }[s.op] || '?'
  const verb = { Add: `に ${q(s.value.src)} を足します`, Sub: `から ${q(s.value.src)} を引きます`, Mult: `に ${q(s.value.src)} を掛けます`, Div: `を ${q(s.value.src)} で割ります`, FloorDiv: `を ${q(s.value.src)} で割って切り捨てます`, Mod: `を ${q(s.value.src)} で割った余りにします`, Pow: `を ${q(s.value.src)} 乗します` }[s.op]
  return verb ? `${q(s.target)} ${verb} (${s.target} = ${s.target} ${sym} …)` : `${q(s.target)} を更新します`
}
const explainStmt = s => (s.kind === 'augassign' ? augJa(s) : stmtJa(s))
// コメント用の短い言い方
function commentJa(s) {
  if (s.kind === 'if') return s.main ? '直接実行したときだけ動く部分' : `${s.test} のとき`
  if (s.kind === 'while') return s.forever ? `ずっとくり返す${s.hasBreak ? ' (break で抜ける)' : ''}` : `${s.test} の間くり返す`
  if (s.kind === 'for') return forJa(s).replace(/くり返します$/, 'くり返す')
  if (s.kind === 'call' && s.func === 'print' && (s.args || []).join(', ').length > 30) return '結果を表示します'
  return explainStmt(s).split('。')[0]
}

function purpose(d) {
  const f = d.features || {}
  const acts = []
  if (f.input) acts.push(['キーボードから入力を受け取り', 'キーボードから入力を受け取ります'])
  if (f.random) acts.push(['乱数を使い', '乱数を使います'])
  if (f.files) acts.push(['ファイルを読み書きし', 'ファイルを読み書きします'])
  if (f.loops) acts.push(['くり返しの処理をし', 'くり返しの処理をします'])
  if (f.plot) acts.push(['グラフを描き', 'グラフを描きます'])
  if (f.print) acts.push(['結果を表示し', '結果を表示します'])
  if (!acts.length) return ''
  return 'このプログラムは、' + acts.map((x, i) => (i === acts.length - 1 ? x[1] : x[0])).join('、') + '。'
}

export async function explainCode(py, code, { from = null, to = null, problems = [] } = {}) {
  let d
  try { d = await py('describe', { code }) } catch (e) { return { ok: false, markdown: 'コードを読めませんでした: ' + (e && e.message) } }
  if (!d.ok) return { ok: false, markdown: `構文エラーがあるため、説明できません (${d.error.line} 行目: ${d.error.msg})。先に「直して」と頼んでください。` }
  const lines = code.split('\n')
  const parts = []
  const range = from !== null && to !== null && to > from ? [lineOf(code, from), lineOf(code, Math.max(from, to - 1))] : null
  if (range) {
    const [a, b] = range
    const inRange = d.stmts.filter(s => s.line >= a && s.line <= b && s.kind !== 'docstring')
    parts.push(`### ${a === b ? a + ' 行目' : a + '〜' + b + ' 行目'}の説明`)
    if (!inRange.length) parts.push('この範囲には、説明できる文がありません (コメントや空行だけです)。')
    for (const s of inRange.slice(0, 60)) {
      const code1 = (lines[s.line - 1] || '').trim()
      parts.push(`${'  '.repeat(Math.min(3, s.depth - Math.min(...inRange.map(x => x.depth))))}- **${s.line} 行目** ${q(code1.slice(0, 80))}\n${'  '.repeat(Math.min(3, s.depth - Math.min(...inRange.map(x => x.depth))) + 1)}${explainStmt(s)}`)
    }
    return { ok: true, markdown: parts.join('\n') }
  }
  const p = purpose(d)
  const top = d.stmts.filter(s => s.depth === 0)
  const imports = top.filter(s => s.kind === 'import')
  const defs = d.stmts.filter(s => s.kind === 'def' && !s.method && s.depth === 0)
  const classes = d.stmts.filter(s => s.kind === 'class')
  parts.push(`### このコードの説明\n\n${p || 'Python のプログラムです。'}${d.lines > 1 ? ` (${d.lines} 行)` : ''}`)
  const struct = []
  if (imports.length) struct.push(`- **読み込んでいるもの**: ${imports.map(s => s.frm !== undefined ? `${q(s.frm)} の ${s.names.join(', ')}` : s.modules.map((m, i) => `${q(m)}${MODULES[m] ? ` (${MODULES[m]})` : ''}`).join('、')).join('、')}`)
  for (const c of classes) struct.push(`- **クラス ${q(c.name)}**: ${stmtJa(c).replace(/^クラス `[^`]+` を作ります。?/, '') || 'データと処理をまとめたものです'}`)
  for (const f of defs) struct.push(`- **関数 ${q(f.name + '()')}**: ${stmtJa(f).replace(/^関数 `[^`]+` を作ります。?/, '') || '処理をまとめたものです'}`)
  if (struct.length) parts.push('**全体の構成**\n' + struct.join('\n'))
  // 流れ (関数・クラスの定義と import を除いた、上から順に実行される部分)
  const flow = []
  const main = d.stmts.filter(s => !['import', 'def', 'class', 'docstring'].includes(s.kind) && !insideDef(s, d.stmts))
  for (const s of main.slice(0, 40)) {
    const indent = '  '.repeat(Math.min(3, s.depth))
    flow.push(`${indent}${s.depth === 0 ? `${flow.filter(x => !x.startsWith(' ')).length + 1}.` : '-'} ${explainStmt(s)} (${s.line} 行目)`)
  }
  if (main.length > 40) flow.push(`…ほか ${main.length - 40} 文`)
  if (flow.length) parts.push('**処理の流れ**\n' + flow.join('\n'))
  else if (defs.length || classes.length) parts.push('このファイルは関数やクラスを定義するだけで、実行しても何も起きません (別のファイルから import して使うか、下で呼び出します)。')
  const errs = (problems || []).filter(x => x.severity === 'error' || x.severity === 'warning')
  if (errs.length) parts.push('**気になるところ**\n' + errs.slice(0, 6).map(x => `- ${x.line} 行目: ${x.message}`).join('\n'))
  return { ok: true, markdown: parts.join('\n\n') }
}
// 関数・クラスの中の文か
function insideDef(s, all) {
  return all.some(x => (x.kind === 'def' || x.kind === 'class') && x.line < s.line && x.end >= s.line && x.depth < s.depth)
}

// ============================================================
// コメントを足す
// ============================================================
const COMMENT_KINDS = new Set(['def', 'class', 'for', 'while', 'if', 'with', 'try', 'assign', 'call', 'augassign', 'return'])
export async function addComments(py, code, { from = 0, to = Infinity } = {}) {
  let d
  try { d = await py('describe', { code }) } catch { return { ok: false, text: code, count: 0 } }
  if (!d.ok) return { ok: false, text: code, count: 0, error: d.error }
  const ls = code.split('\n')
  const a = lineOf(code, from), b = to === Infinity ? ls.length : lineOf(code, Math.max(from, to - 1))
  const inserts = []
  let lastAssignComment = -10
  for (const s of d.stmts) {
    if (s.line < a || s.line > b || !COMMENT_KINDS.has(s.kind)) continue
    const prev = ls[s.line - 2]
    if (prev !== undefined && /^\s*#/.test(prev)) continue
    if (/#/.test(ls[s.line - 1].replace(/(["'])(?:(?!\1).)*\1/g, ''))) continue
    // 代入・呼び出しは、意味のあるものだけ (続く行には付けすぎない)
    if (s.kind === 'assign' && !(s.value && (s.value.kind === 'call' || s.value.kind === 'comp'))) continue
    if (s.kind === 'call' && !/^(print|input)$/.test(s.func) && !/\.(append|sort|write|shuffle)$|^plt\.show$|^time\.sleep$/.test(s.func)) continue
    if ((s.kind === 'assign' || s.kind === 'call' || s.kind === 'augassign') && s.line - lastAssignComment < 3) continue
    if (s.kind === 'return' && !(s.value && s.value.kind !== 'name' && s.value.kind !== 'const')) continue
    if (s.kind === 'def' && s.doc) continue
    let text = commentJa(s).replace(/`/g, '').replace(/ \((?:tries|[a-z_]\w*) = .*\)$/, '')
    if (s.kind === 'def') text = text.replace(/\s*を作ります。?$/, '')
    text = text.trim()
    if (text.length > 70) text = text.slice(0, 68) + '…'
    inserts.push({ line: s.line, text })
    if (s.kind === 'assign' || s.kind === 'call' || s.kind === 'augassign') lastAssignComment = s.line
  }
  for (const ins of inserts.sort((x, y) => y.line - x.line)) {
    const ind = /^[ \t]*/.exec(ls[ins.line - 1])[0]
    // デコレーターの上に付ける
    let at = ins.line - 1
    while (at > 0 && /^\s*@/.test(ls[at - 1])) at--
    ls.splice(at, 0, `${ind}# ${ins.text}`)
  }
  return { ok: true, text: ls.join('\n'), count: inserts.length }
}

// ============================================================
// 型ヒントを付ける
// ============================================================
export async function addTypes(py, code, { from = 0, to = Infinity } = {}) {
  const ls = code.split('\n')
  const a = lineOf(code, from), b = to === Infinity ? ls.length : lineOf(code, Math.max(from, to - 1))
  let r
  try { r = await py('typehints', { code, from: a, to: b }) } catch { return { ok: false, text: code, count: 0 } }
  if (!r.ok) return { ok: false, text: code, count: 0, error: r.error }
  if (!r.edits.length) return { ok: true, text: code, count: 0 }
  const out = applyEdits(code, r.edits)
  return { ok: true, text: out.text, count: out.count }
}
