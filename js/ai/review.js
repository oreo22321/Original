// Forge AI: コードのレビュー (Python)
// pytools ワーカーの ast 解析 (__fca_review) の結果を、日本語の説明と直し方にします
// 返り値の 1 件: { line, kind: 'bug' | 'perf' | 'style', severity, message, edits? (自動で直せるとき) }
import { applyEdits } from './pycode.js'

const MESSAGES = {
  eq_none: f => ['style', `\`${f.code}\` — None との比較は \`is None\` / \`is not None\` で書くのが決まりです。`],
  eq_bool: f => ['style', `\`${f.code}\` — True / False と == で比べなくても、条件はそのまま書けます。`],
  type_eq: f => ['style', `\`${f.code}\` — 型を調べるときは \`isinstance(値, 型)\` を使います (子クラスも正しく判定できます)。`],
  len_zero: f => ['style', `\`${f.code}\` — 空かどうかは \`not リスト\` で調べられます。`],
  input_str: f => ['bug', `\`${f.name}\` は input() の結果なので文字列です。数として比べたり計算したりするなら \`int(${f.name})\` で変換します (このままだと TypeError になります)。`],
  bare_except: () => ['bug', '何でも受ける `except:` は、打ち間違いや ■ (停止) まで隠してしまいます。`except ValueError:` のように種類を書くか、せめて `except Exception:` にします。'],
  except_pass: () => ['bug', 'エラーを受けて何もしない (`pass`) と、問題が起きても気づけません。メッセージを表示するなどしましょう。'],
  mutable_default: f => ['bug', `${f.func}() の引数 \`${f.name}\` の既定値が変更できる値 ([] / {} など) です。呼び出すたびに同じものが使い回され、前の呼び出しの中身が残ります。既定値を None にして、関数の中で作ります。`],
  long_function: f => ['style', `${f.name}() が ${f.size} 行あります。いくつかの関数に分けると読みやすくなります。`],
  shadow_builtin: f => ['bug', `\`${f.name}\` は組み込みの関数と同じ名前です。この後 \`${f.name}(…)\` が使えなくなります。別の名前 (例: \`${f.name}_\`、\`my_${f.name}\`) にします。`],
  str_concat_loop: f => ['perf', `ループの中で文字列 \`${f.name}\` に += で足しています。回数が多いと遅くなるので、リストに append して最後に \`"".join(…)\` でつなげると速くなります。`],
  open_no_with: () => ['style', '`open()` したファイルは `with open(…) as f:` の形で開くと、閉じ忘れがありません。'],
  open_encoding: () => ['style', '`open()` に `encoding="utf-8"` を付けると、日本語の文字化けを防げます。'],
  global: f => ['style', `global (${(f.names || []).join(', ')}) を使っています。引数で受け取って return で返す形にすると、バグが見つけやすくなります。`],
  infinite_loop: () => ['bug', '`while True:` の中に break も return もありません。止まらないループです (■ で止められます)。'],
  range_len: f => ['style', `\`for ${f.name} in range(len(${f.seq})):\` は \`for ${f.name}, 値 in enumerate(${f.seq}):\` と書くと読みやすくなります。`],
  deep_nesting: f => ['style', `${f.name ? f.name + '() の' : ''}入れ子が ${f.depth} 段あります。早めに return / continue したり、関数に分けたりすると読みやすくなります。`],
}
// pyflakes の結果
const FLAKES = {
  UndefinedName: d => ['bug', `\`${d.args[0]}\` は定義されていません (打ち間違いか、import のし忘れかもしれません)。`],
  UndefinedLocal: d => ['bug', `\`${d.args[0]}\` を、値を入れる前に使っています。`],
  UnusedImport: d => ['style', `\`${d.args[0]}\` を import していますが、使っていません。`],
  UnusedVariable: d => ['style', `変数 \`${d.args[0]}\` に値を入れていますが、使っていません。`],
  RedefinedWhileUnused: d => ['bug', `\`${d.args[0]}\` を使う前に、もう一度定義しています。`],
  ImportStarUsed: () => ['style', '`from … import *` は、どの名前を使っているか分からなくなります。必要な名前だけ import します。'],
  IsLiteral: () => ['bug', '数値や文字列との比較に `is` を使っています。`==` を使います。'],
  FStringMissingPlaceholders: () => ['style', 'f-string に {…} がありません (f は要りません)。'],
}

export async function reviewCode(py, code) {
  let rv = null, flakes = []
  try { rv = await py('review', { code }) } catch {}
  try { flakes = (await py('lint', { code, path: 'main.py' })) || [] } catch {}
  const syntax = flakes.find(d => d.severity === 'error')
  if (syntax || !rv || !rv.ok) return { ok: false, error: syntax ? { line: syntax.line, message: syntax.msg } : rv && rv.error ? { line: rv.error.line, message: rv.error.msg } : null, findings: [] }
  const out = []
  for (const f of rv.findings) {
    const m = MESSAGES[f.kind]
    if (!m) continue
    const [kind, message] = m(f)
    out.push({ line: f.line, kind, severity: f.severity, message, edits: f.edits, id: f.kind })
  }
  for (const d of flakes) {
    const m = FLAKES[d.kind]
    if (!m) continue
    const [kind, message] = m(d)
    out.push({ line: d.line, kind, severity: kind === 'bug' ? 'warning' : 'info', message, id: d.kind })
  }
  out.sort((a, b) => a.line - b.line)
  return { ok: true, findings: out }
}

// 自動で直せるもの (動きを変えずに安全なもの + バグの直し)
const AUTO = new Set(['eq_none', 'eq_bool', 'type_eq', 'bare_except', 'mutable_default', 'open_encoding'])
export function autoFixable(findings) { return findings.filter(f => f.edits && AUTO.has(f.id)) }
export function applyReviewFixes(text, findings) {
  return applyEdits(text, findings.flatMap(f => f.edits || [])).text
}
