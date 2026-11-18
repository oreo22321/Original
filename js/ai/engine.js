// Forge AI: 頭脳 (依頼を読み取り、適切な処理を選んで実行し、返事を組み立てる) — Python 版
// 画面 (DOM) には触らず、host (アプリ側が用意する窓口) を通してファイルの読み書き・実行・解析をします。
//   host = {
//     hasProject, files() → [{path}], active() → { path, text, from, to } | null,
//     read(path), write(path, text, {focus}), create(path, text, {focus}),
//     py(type, args) → Promise (Python の解析: lint / describe / review / typehints / format / rename / help など),
//     lastErrors() → [{ text }], run({ seconds, signal }) → 結果, undoLast() → 説明 | null,
//     llm: { ready(), generate(messages, { onText, signal, maxTokens }) } | null,
//   }
// respond() は { text (Markdown), chips: [次に頼めそうなこと], memory } を返します。
import { normalize, concepts as conceptsOf, detectIntents, Bm25, tokens } from './text.js'
import { extractCode, lineOf, fence, isPy } from './pycode.js'
import { KNOWLEDGE } from './knowledge.js'
import { repairSyntax, fixAll, modernize, formatCode, lint, syntaxError } from './repair.js'
import { reviewCode, autoFixable, applyReviewFixes } from './review.js'
import { explainCode, addComments, addTypes } from './describe.js'
import { generateCode, EXAMPLES } from './generate.js'
import { explainError } from '../app/explain.js'

const tick = () => new Promise(r => setTimeout(r, 0))
const lineCount = s => s.split('\n').length

// ============================================================
// 知識の検索
// ============================================================
let index = null
function knowledgeIndex() {
  if (!index) index = new Bm25(KNOWLEDGE.map(e => ({ id: e.id, ref: e, fields: [[e.t, 3], [e.k, 3], [e.b, 1], [e.c || '', 0.3]] })))
  return index
}
// 「〜の使い方」「〜とは」「教えて」のような、どの話題にも付く言い方は検索に使わない
const FILLER = /(の|を)?(使い方|つかいかた|やり方|書き方|かきかた|方法|とは|って何|ってなに|ってなん|について|を?教えて|おしえて|ください|知りたい|わからない|分からない|何ですか|なんですか)/g
// 題名の言葉 (「リスト (list)」→ リスト / list) が質問に入っていたら、その項目を上に
const titleWords = e => e.t.replace(/^ForgeCode:\s*/, '').split(/[()（）/・、,]|\s+と\s+/).map(w => normalize(w).trim()).filter(w => w.length >= 2)
export function searchKnowledge(text, limit = 4) {
  const n = normalize(text)
  const aboutApp = /(forgecode|このアプリ|アプリの|この画面|エディタ|エディター|保存|zip|実行ボタン|デバッ|ブレークポイント|プレビュー|forge ?ai|ai で|ai の|ai に|ai は|設定|github|同期|使える)/.test(n)
  const q = n.replace(FILLER, ' ').trim() || n
  const hits = knowledgeIndex().search(q, limit * 4)
  for (const h of hits) {
    const e = h.ref
    if (e.mode === 'app' && !aboutApp) h.score *= 0.35
    else if (e.mode === 'app') h.score += 2
    for (const w of titleWords(e)) {
      if (/^[a-z_][\w ]*$/.test(w) ? new RegExp(`(^|[^a-z_])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z_])`).test(q) : q.includes(w)) { h.score += 4 + Math.min(4, w.length); break }
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

// ============================================================
// 返事の部品
// ============================================================
function changeReport(fixes, max = 14) {
  if (!fixes.length) return ''
  const seen = new Set()
  const uniq = fixes.filter(f => { const k = f.line + f.why; if (seen.has(k)) return false; seen.add(k); return true })
  const list = uniq.slice(0, max).map(f => `- ${f.line ? f.line + ' 行目: ' : ''}${f.why}`)
  if (uniq.length > max) list.push(`- …ほか ${uniq.length - max} 件`)
  return list.join('\n')
}
const SEV = { error: 'エラー', warning: '警告', info: '情報', hint: 'ヒント' }
function problemList(list, max = 10) {
  return list.slice(0, max).map(p => `- ${p.line} 行目 (${SEV[p.severity] || p.severity}): ${p.message}`).join('\n') + (list.length > max ? `\n- …ほか ${list.length - max} 件` : '')
}
// エディタと同じ日本語のメッセージで、問題の一覧
async function problemsOf(host, code) {
  const list = await lint(host.py, code)
  return list.map(d => ({ line: d.line, severity: d.severity === 'error' ? 'error' : /Undefined|Redefined|IsLiteral/.test(d.kind) ? 'warning' : 'info', message: d.severity === 'error' ? `構文エラー: ${d.msg}` : d.msg, kind: d.kind }))
}

// 対象のコード (選択範囲があればそこ、なければファイル全体)
function target(host) {
  const act = host.active()
  if (!act) return null
  const sel = act.to > act.from ? { from: act.from, to: act.to } : null
  return { path: act.path, text: act.text, sel, py: isPy(act.path) }
}
const needPy = (tg, what) => (!tg ? { text: `${what}ファイルを開いてから頼んでください (または、コードを貼り付けてください)。`, chips: [] } : !tg.py ? { text: `${tg.path} は Python のファイル (.py) ではありません。`, chips: [] } : null)
// 選択範囲だけを変換して戻す (範囲は行単位に広げる)。字下げされた部分は、字下げを外して渡し、戻すときに付け直す
async function withRange(text, sel, fn) {
  if (!sel) return fn(text)
  const s = text.lastIndexOf('\n', sel.from - 1) + 1
  let e = text.indexOf('\n', Math.max(sel.from, sel.to - 1))
  if (e < 0) e = text.length
  const part = text.slice(s, e)
  const first = part.split('\n').find(l => l.trim()) || ''
  const indent = /^[ \t]*/.exec(first)[0]
  const canStrip = !!indent && part.split('\n').every(l => !l.trim() || l.startsWith(indent))
  const inner = canStrip ? part.split('\n').map(l => (l.startsWith(indent) ? l.slice(indent.length) : l)).join('\n') : part
  // 範囲の前後の空行は、そのまま残す (整形で消えないように)
  const lead = /^\s*\n/.exec(inner) ? /^(\s*\n)*/.exec(inner)[0] : ''
  const trail = /\n\s*$/.exec(inner) ? /(\n\s*)*$/.exec(inner)[0] : ''
  const r = await fn(inner.slice(lead.length, inner.length - trail.length) + (trail ? '\n' : ''))
  if (!r || r.text === undefined) return r
  const body = lead + r.text.replace(/^\s*\n/, '').replace(/\s+$/, '') + trail
  const restored = canStrip ? body.split('\n').map(l => (l.trim() ? indent + l : l)).join('\n') : body
  return { ...r, text: text.slice(0, s) + restored + text.slice(e), offsetLine: lineOf(text, s) - 1 + (lead.match(/\n/g) || []).length }
}

// ============================================================
// 各処理
// ============================================================
async function doFix(host, step, opts = {}) {
  const tg = target(host)
  const bad = needPy(tg, '直す')
  if (bad) return bad
  step('bug', `${tg.path} の問題を調べています`)
  await tick()
  const before = tg.text
  // 1) 構文 + 打ち間違い・import 忘れ
  const r = await withRange(before, tg.sel, part => fixAll(host.py, part))
  let text = r.text
  const fixes = (r.fixes || []).map(f => ({ ...f, line: f.line ? f.line + (r.offsetLine || 0) : 0 }))
  // 2) レビューで見つかった、自動で直せるバグ (None の比較・何でも受ける except・変更できる既定値 など)
  if (r.ok !== false) {
    const rv = await reviewCode(host.py, text)
    if (rv.ok) {
      const a = tg.sel ? lineOf(before, tg.sel.from) : 1, b = tg.sel ? lineOf(before, tg.sel.to) : Infinity
      const auto = autoFixable(rv.findings).filter(f => f.line >= a && f.line <= b)
      if (auto.length) {
        const next = applyReviewFixes(text, auto)
        if (!(await syntaxError(host.py, next))) { text = next; for (const f of auto) fixes.push({ line: f.line, why: f.message.replace(/。.*$/s, '').replace(/`/g, '') }) }
      }
    }
  }
  // 3) 直前の実行のエラー
  const errs = opts.runtime !== false ? (host.lastErrors() || []).slice(-2) : []
  const parts = []
  if (text !== before) {
    await host.write(tg.path, text, { focus: true })
    step('edit', `${tg.path} を修正`, { path: tg.path })
    parts.push(`**${fixes.length} か所を直しました** (${tg.path}${tg.sel ? '・選択範囲' : ''}):\n${changeReport(fixes)}`)
  }
  if (r.ok === false) parts.push(`**注意:** まだ構文エラーが残っています (${r.error ? r.error.line + ' 行目: ' + r.error.message : ''})。自動では直し方を決められませんでした。その行と 1 つ上の行を確認してください。`)
  const remain = (await problemsOf(host, text)).filter(p => p.severity !== 'info')
  if (remain.length) parts.push(`**残っている問題** (自動では直せないもの):\n${problemList(remain, 8)}`)
  const rv2 = r.ok !== false ? await reviewCode(host.py, text) : { findings: [] }
  const rest = rv2.findings.filter(f => !f.edits && f.kind === 'bug' && !/Undefined/.test(f.id))
  if (rest.length) parts.push(`**気をつけたいところ**:\n${rest.slice(0, 6).map(f => `- ${f.line} 行目: ${f.message}`).join('\n')}`)
  for (const e of errs) {
    const ex = explainError(e.text)
    const lm = /line (\d+)/.exec(e.text)
    const codeLine = lm ? (text.split('\n')[+lm[1] - 1] || '').trim() : ''
    const last = e.text.trim().split('\n').pop()
    parts.push(`**実行時のエラー**: \`${last.slice(0, 200)}\`${codeLine ? `\n\n該当の行 (${lm[1]} 行目): \`${codeLine.slice(0, 120)}\`` : ''}${ex ? `\n\n${ex.why}\n${ex.fixes.slice(0, 3).map(f => '- ' + f).join('\n')}` : ''}`)
  }
  if (!parts.length) parts.push(`${tg.path}${tg.sel ? ' の選択範囲' : ''}に、自動で見つけられる問題はありませんでした。\n\n動きがおかしいときは、▶ で実行してエラーを出してから「エラーを直して」と頼むか、どう動いてほしいかを具体的に教えてください。ブレークポイント (行番号の左をタップ) で止めて、変数の中身を確かめるのもおすすめです。`)
  return { text: parts.join('\n\n'), chips: text !== before ? ['実行して確かめて', '説明して'] : ['実行して', 'レビューして'], changed: text !== before }
}

async function doFormat(host, step, { tidy = false } = {}) {
  const tg = target(host)
  const bad = needPy(tg, '整形する')
  if (bad) return bad
  const err = await syntaxError(host.py, tg.text)
  if (err) return { text: `構文エラーがあるため整形できません (${err.line} 行目)。先に「直して」と頼んでください。`, chips: ['直して'] }
  step('wand', tidy ? `${tg.path} を整理しています` : `${tg.path} を整形しています`)
  let fixes = []
  const r = await withRange(tg.text, tg.sel, async part => {
    let t = part
    if (tidy) { const m = await modernize(host.py, t); t = m.text; fixes = m.fixes }
    return { text: await formatCode(host.py, t) }
  })
  if (r.text === tg.text) return { text: `${tg.path}${tg.sel ? ' の選択範囲' : ''}は、もう${tidy ? '整理' : '整形'}されています。`, chips: tidy ? [] : ['整理して'] }
  if (await syntaxError(host.py, r.text)) return { text: '整形すると構文が壊れてしまうため、中止しました。', chips: [] }
  await host.write(tg.path, r.text, { focus: true })
  step('edit', `${tg.path} を${tidy ? '整理' : '整形'}`, { path: tg.path })
  const msg = [tidy ? `**${tg.path} を整理しました。**` : `**${tg.path} を整形しました** (PEP 8 に合わせて、空白・字下げ・空行をそろえました)。`]
  if (fixes.length) msg.push('新しい書き方にしたところ:\n' + changeReport(fixes))
  return { text: msg.join('\n\n'), chips: ['説明して', 'コメントを追加して'], changed: true }
}

async function doComments(host, step) {
  const tg = target(host)
  const bad = needPy(tg, 'コメントを追加する')
  if (bad) return bad
  step('comment', 'コメントを考えています')
  const r = await addComments(host.py, tg.text, tg.sel || {})
  if (!r.ok) return { text: '構文エラーがあるため、先に直す必要があります。', chips: ['直して'] }
  if (!r.count) return { text: 'コメントを足す場所が見つかりませんでした (すでにコメントがあるか、短いコードです)。', chips: [] }
  await host.write(tg.path, r.text, { focus: true })
  step('edit', `${tg.path} にコメントを追加`, { path: tg.path })
  return { text: `**${r.count} か所に説明のコメントを追加しました** (処理は変えていません)。関数・クラス・ループ・条件分岐・入力などの上に「何をしているか」を書いています。`, chips: ['説明して', '型ヒントを付けて'], changed: true }
}

async function doTypes(host, step) {
  const tg = target(host)
  const bad = needPy(tg, '型ヒントを付ける')
  if (bad) return bad
  step('braces', '既定値と return から型を推測しています')
  const r = await addTypes(host.py, tg.text, tg.sel || {})
  if (!r.ok) return { text: '構文エラーがあるため、先に直す必要があります。', chips: ['直して'] }
  if (!r.count) return { text: '型を推測できる引数・戻り値が見つかりませんでした (すでに型が付いているか、既定値や return から判断できません)。\n\n型ヒントは `def f(name: str, n: int = 1) -> bool:` のように書きます。', chips: [] }
  await host.write(tg.path, r.text, { focus: true })
  step('edit', `${tg.path} に型ヒントを追加`, { path: tg.path })
  return { text: `**${r.count} か所に型ヒントを付けました** (引数の既定値と、return する値から推測)。実行の動きは変わりませんが、補完が賢くなり、読みやすくなります。`, chips: ['レビューして'], changed: true }
}

async function doOptimize(host, step) {
  const tg = target(host)
  const bad = needPy(tg, '最適化する')
  if (bad) return bad
  if (await syntaxError(host.py, tg.text)) return { text: '構文エラーがあるため、先に直す必要があります。', chips: ['直して'] }
  step('bolt', '遅くなる書き方を探しています')
  const rv = await reviewCode(host.py, tg.text)
  const perf = rv.findings.filter(f => f.kind === 'perf' || f.id === 'range_len')
  const parts = []
  if (perf.length) parts.push(`**速く・読みやすくできるところ:**\n${perf.slice(0, 8).map(f => `- ${f.line} 行目: ${f.message}`).join('\n')}`)
  parts.push(`${perf.length ? '' : '目立って遅くなる書き方は見つかりませんでした。\n\n'}**Python を速くするコツ:**\n- for で append するより、内包表記 \`[x * 2 for x in nums]\` の方が速い\n- 「含まれているか」を何度も調べるなら、リストより集合 (\`set\`) や辞書\n- 文字列をたくさんつなぐなら \`"".join(リスト)\`\n- 合計・最大などは \`sum\` / \`max\` などの組み込み関数を使う\n- 大量の数の計算は numpy でまとめて`)
  return { text: parts.join('\n\n'), chips: ['レビューして', '説明して'] }
}

async function doReview(host, step) {
  const tg = target(host)
  const bad = needPy(tg, 'チェックする')
  if (bad) return bad
  step('check', `${tg.path} をチェックしています`)
  const rv = await reviewCode(host.py, tg.text)
  if (!rv.ok) return { text: `構文エラーがあります${rv.error ? ` (${rv.error.line} 行目: ${rv.error.message})` : ''}。「直して」と頼むと、自動で直せるものは直します。`, chips: ['直して'] }
  const a = tg.sel ? lineOf(tg.text, tg.sel.from) : 1, b = tg.sel ? lineOf(tg.text, tg.sel.to) : Infinity
  const f = rv.findings.filter(x => x.line >= a && x.line <= b)
  const bugs = f.filter(x => x.kind === 'bug'), perf = f.filter(x => x.kind === 'perf'), style = f.filter(x => x.kind === 'style')
  const parts = []
  if (bugs.length) parts.push(`**バグになりそうなところ (${bugs.length})**\n${bugs.slice(0, 8).map(x => `- ${x.line} 行目: ${x.message}`).join('\n')}`)
  if (perf.length) parts.push(`**遅くなりそうなところ (${perf.length})**\n${perf.slice(0, 6).map(x => `- ${x.line} 行目: ${x.message}`).join('\n')}`)
  if (style.length) parts.push(`**読みやすさ・書き方 (${style.length})**\n${style.slice(0, 6).map(x => `- ${x.line} 行目: ${x.message}`).join('\n')}`)
  if (!parts.length) return { text: `${tg.path}${tg.sel ? ' の選択範囲' : ''}をチェックしました。問題は見つかりませんでした。`, chips: ['説明して', 'コメントを追加して'] }
  const fixable = autoFixable(f).length > 0 || bugs.some(x => /Undefined/.test(x.id))
  return { text: `${tg.path} をチェックしました。\n\n${parts.join('\n\n')}${fixable ? '\n\n「直して」と頼むと、自動で直せるものは直します。' : ''}`, chips: fixable ? ['直して', '整理して'] : ['整理して'] }
}

async function doExplain(host, step, code) {
  if (code) {
    step('book', '貼り付けられたコードを読んでいます')
    const r = await explainCode(host.py, code)
    return { text: r.markdown, chips: r.ok ? ['このコードをレビューして'] : ['直して'] }
  }
  const tg = target(host)
  const bad = needPy(tg, '説明する')
  if (bad) return bad
  step('book', tg.sel ? '選択した範囲を読んでいます' : `${tg.path} を読んでいます`)
  const problems = tg.sel ? [] : (await problemsOf(host, tg.text)).filter(p => p.severity !== 'info')
  const r = await explainCode(host.py, tg.text, { from: tg.sel ? tg.sel.from : null, to: tg.sel ? tg.sel.to : null, problems })
  return { text: r.markdown, chips: r.ok ? ['コメントを追加して', 'レビューして'] : ['直して'] }
}

async function doRun(host, step, signal) {
  if (!host.run) return { text: 'この画面では実行できません。', chips: [] }
  step('play', '実行しています')
  const r = await host.run({ seconds: 6, signal })
  if (!r || !r.started) return { text: '実行を始められませんでした。プロジェクトに Python のファイルがあるか確認してください。', chips: [] }
  const out = (r.output || []).filter(o => o.kind !== 'meta').slice(-14).map(o => o.text)
  const parts = []
  parts.push(r.errors.length ? `**エラーが出ました。**` : r.stillRunning ? '**まだ実行中です** (input() の入力待ちか、長い処理の途中です)。' : '**エラーなく実行できました。**')
  if (out.length) parts.push('出力 (最後の行):\n' + fence(out.join('\n'), 'text'))
  for (const e of r.errors.slice(0, 2)) {
    const ex = explainError(e.text)
    parts.push(`- \`${e.text.trim().split('\n').pop().slice(0, 200)}\`${ex ? '\n  ' + ex.why : ''}`)
  }
  return { text: parts.join('\n\n'), chips: r.errors.length ? ['エラーを直して'] : ['説明して'], ran: true }
}

async function doRename(host, step, text) {
  const tg = target(host)
  const bad = needPy(tg, '名前を変える')
  if (bad) return bad
  const ids = [...String(text).normalize('NFKC').matchAll(/[A-Za-z_]\w*/g)].map(m => m[0]).filter(w => !/^(rename|to|from)$/i.test(w))
  if (ids.length < 2) return { text: '「old_name を new_name に名前を変えて」のように、今の名前と新しい名前を書いてください (カーソルを名前に置いて F2 でも変えられます)。', chips: [] }
  const [from, to] = ids
  const m = new RegExp(`\\b${from}\\b`).exec(tg.text)
  if (!m) return { text: `\`${from}\` が見つかりませんでした。`, chips: [] }
  const line = lineOf(tg.text, m.index)
  const col = m.index - (tg.text.lastIndexOf('\n', m.index - 1) + 1)
  let res
  try { res = await host.py('rename', { code: tg.text, line, col, path: tg.path, name: to }) } catch (e) { return { text: '名前を変えられませんでした: ' + e.message, chips: [] } }
  if (!res || res.error || !res.files) return { text: `名前を変えられませんでした${res && res.error ? ': ' + res.error : ''}。`, chips: [] }
  for (const [path, code] of Object.entries(res.files)) {
    await host.write(path, code, { focus: path === tg.path })
    step('edit', `${path}: ${from} → ${to}`, { path })
  }
  const n = Object.keys(res.files).length
  return { text: `\`${from}\` を \`${to}\` に変えました${n > 1 ? ` (${n} ファイル)` : ''}。文字列やコメントの中・別の意味の同じ名前は変えていません。`, chips: [], changed: true }
}

// ---- コードの生成 ----
function freeName(host, name) {
  const files = new Set(host.files().map(f => f.path))
  if (!files.has(name)) return name
  const m = /^(.*?)(\.py)$/.exec(name) || [null, name, '']
  for (let i = 2; i < 100; i++) { const n = `${m[1]}_${i}${m[2]}`; if (!files.has(n)) return n }
  return name
}
async function doGenerate(host, step, text, memory, { replaceFiles = null } = {}) {
  step('sparkle', 'コードを組み立てています')
  await tick()
  const gen = generateCode(text)
  if (!gen) return null
  const written = []
  const act = host.active()
  // 開いているファイルがほぼ空なら、そこに書く
  const activeEmpty = act && isPy(act.path) && !act.text.split('\n').some(l => l.trim() && !l.trim().startsWith('#'))
  for (let i = 0; i < gen.files.length; i++) {
    const f = gen.files[i]
    if (!host.hasProject) continue
    let path
    if (replaceFiles && replaceFiles[i] && host.files().some(x => x.path === replaceFiles[i])) path = replaceFiles[i]
    else if (i === 0 && gen.files.length === 1 && activeEmpty) path = act.path
    if (path) await host.write(path, f.code, { focus: i === 0 })
    else { path = freeName(host, f.name); await host.create(path, f.code, { focus: i === 0 }) }
    step(replaceFiles ? 'edit' : 'newFile', `${path} を${replaceFiles ? '書き換え' : '作成'}`, { path })
    written.push(path)
  }
  memory.lastGen = { text, files: written, spec: gen.spec, title: gen.title }
  const parts = [`**${gen.title}** を${replaceFiles ? '作り直しました' : '作りました'}。`]
  parts.push(gen.summary.map(s => '- ' + s).join('\n'))
  if (written.length) parts.push(`ファイル: ${written.map(p => '`' + p + '`').join('、')} — ▶ で実行できます${/input\(/.test(gen.files[0].code) ? ' (入力は出力の下の入力欄に)' : ''}`)
  for (const f of gen.files) if (!host.hasProject || lineCount(f.code) <= 30) parts.push(fence(f.code))
  if (gen.alternatives && gen.alternatives.length) parts.push(`ほかに近いもの: ${gen.alternatives.join('、')}`)
  return { text: parts.join('\n\n'), chips: ['実行して確かめて', '説明して', 'コメントを追加して'], changed: written.length > 0 }
}

// ---- 質問への回答 ----
const NAME_RE = /\b((?:[a-z_][\w]*\.)*[A-Za-z_]\w*)(?:\(\))?/g
async function pythonHelp(host, text) {
  // 「str.split とは」「enumerate の使い方」など、Python の名前の説明 (jedi)
  const out = []
  const seen = new Set()
  for (const m of String(text).normalize('NFKC').matchAll(NAME_RE)) {
    const w = m[1]
    if (seen.has(w) || w.length < 3 || /^(python|forgecode|ai|forge|the|and|for|how|what|use|is|in|to|of)$/i.test(w)) continue
    seen.add(w)
    if (out.length >= 2) break
    const code = `${/^(np|pd|plt)\./.test(w) ? { np: 'import numpy as np\n', pd: 'import pandas as pd\n', plt: 'import matplotlib.pyplot as plt\n' }[w.split('.')[0]] : w.includes('.') && !/^(str|list|dict|set|tuple|int|float)\./.test(w) ? `import ${w.split('.')[0]}\n` : ''}${w}`
    const lines = code.split('\n')
    try {
      const r = await host.py('help', { code, line: lines.length, col: lines[lines.length - 1].length - 1, path: 'help.py' })
      const it = r && r[0]
      if (it && (it.doc || it.sig) && it.type !== 'statement') out.push(`**${w}**${it.sig ? ` — \`${it.sig.slice(0, 160)}\`` : ''}\n\n${(it.doc || '').split('\n\n').slice(0, 2).join('\n\n').slice(0, 700)}`)
    } catch {}
  }
  return out
}
async function doQuestion(host, text, memory) {
  const parts = []
  const ex = explainError(text)
  if (ex) parts.push(`**このエラーの意味**\n\n${ex.why}\n\n**直し方**\n${ex.fixes.map(f => '- ' + f).join('\n')}`)
  const hits = searchKnowledge(text, 4)
  const top = hits[0]
  const strong = top && (top.score >= 6 || (top.score >= 3.5 && (hits.length < 2 || top.score > hits[1].score * 1.25)))
  if (top && (strong || !parts.length) && top.score >= 2.5) {
    const e = top.ref
    memory.lastTopic = e.id
    parts.push(`### ${e.t}\n\n${e.b}${e.c ? '\n\n' + fence(e.c) : ''}`)
    const rel = hits.slice(1).filter(h => h.score >= top.score * 0.45).map(h => h.ref.t)
    return { text: parts.join('\n\n'), chips: rel.slice(0, 3).map(t => `${t.replace(/ \(.*\)$/, '')}について教えて`), confident: true }
  }
  // Python の名前 (標準ライブラリ・組み込み関数) の説明
  if (/[A-Za-z_]{3,}/.test(text)) {
    const help = await pythonHelp(host, text)
    if (help.length) parts.push(...help)
  }
  if (parts.length) return { text: parts.join('\n\n'), chips: [], confident: true }
  return { text: '', chips: hits.slice(0, 3).map(h => `${h.ref.t.replace(/ \(.*\)$/, '')}について教えて`), confident: false, hits }
}

function helpText() {
  return `**Forge AI** はこのアプリに入っている AI です。インターネットがなくても、すぐに答えます。

- **作る**: 「数当てゲームを作って」「CSV を読んでグラフにして」「犬のクラスを作って」
- **直す**: 「直して」「エラーを直して」— 構文エラー・打ち間違い・import 忘れ・よくあるバグを自動で修正
- **整える**: 「整形して」「整理して (新しい書き方に)」「最適化して」
- **説明する**: 「説明して」(範囲を選ぶとその部分を 1 行ずつ)、「コメントを追加して」「型ヒントを付けて」
- **答える**: 「リストと辞書の違いは?」「for 文の使い方」「enumerate とは」「NameError って何?」
- **確かめる**: 「レビューして」「実行して」

作れるものの例: ${EXAMPLES.slice(0, 12).join('、')}`
}

// ============================================================
// LLM (端末内の言語モデル) を使う
// ============================================================
const LLM_RULES = `You are Forge AI, the assistant inside ForgeCode, a Python code editor used on phones (Python 3.14 running in the browser via Pyodide). Reply in Japanese, short and practical, for beginners.
Rules for code: Python 3 only, in one \`\`\`python block, PEP 8 style, 4-space indents. Use input()/print() for I/O. Do not use tkinter, turtle, pip install or network requests. numpy, pandas, matplotlib (plt.show() shows the figure) are available. Do not invent APIs.`
function llmContext(host, text) {
  const ctx = []
  for (const h of searchKnowledge(text, 2).filter(h => h.score > 2)) ctx.push(`Reference (${h.ref.t}):\n${h.ref.b.slice(0, 600)}${h.ref.c ? '\n' + h.ref.c.slice(0, 600) : ''}`)
  const tg = target(host)
  if (tg && tg.py) {
    const code = tg.sel ? tg.text.slice(tg.sel.from, tg.sel.to) : tg.text
    ctx.push(`${tg.sel ? 'Selected code' : 'Open file ' + tg.path}:\n${code.slice(0, 3000)}${code.length > 3000 ? '\n# (truncated)' : ''}`)
  }
  return ctx.join('\n\n')
}
// LLM の答えの中のコードを検証して直す
export async function verifyLlmCode(py, answer) {
  const notes = []
  const blocks = [...answer.matchAll(/```(?:python|py)?\n([\s\S]*?)```/g)]
  let out = answer
  for (const m of blocks) {
    let c = m[1]
    const r = await fixAll(py, c)
    if (r.fixes.length) { c = r.text; notes.push(`構文・打ち間違いを ${r.fixes.length} か所自動で修正しました`) }
    if (!r.ok) notes.push('まだ構文エラーが残っています')
    out = out.replace(m[0], '```python\n' + c.replace(/\n+$/, '') + '\n```')
  }
  return { text: out, notes: [...new Set(notes)] }
}
async function askLlm(host, step, text, history, { onText, signal, purpose = 'chat' }) {
  const llm = host.llm
  if (!llm || !llm.ready()) return null
  step('sparkle', purpose === 'generate' ? '端末内の AI モデルがコードを書いています' : '端末内の AI モデルが考えています')
  const messages = [{ role: 'system', content: LLM_RULES }]
  for (const h of (history || []).slice(-4)) messages.push({ role: h.role, content: String(h.content).slice(0, 1200) })
  messages.push({ role: 'user', content: `${llmContext(host, text)}\n\nRequest: ${text}` })
  const raw = await llm.generate(messages, { onText, signal, maxTokens: purpose === 'generate' ? 1200 : 700 })
  const v = await verifyLlmCode(host.py, raw)
  return v.text + (v.notes.length ? `\n\n_(Forge AI のチェック: ${v.notes.join('・')})_` : '')
}

// ============================================================
// 入口
// ============================================================
const FOLLOWUP_RE = /(にして|に変えて|にかえて|へ変えて|変更して|増やして|減らして|もっと|大きく|小さく|長く|短く|回にして|個にして|までにして)/

export async function respond({ text, history = [], host, onStep = () => {}, onText, signal, memory = {} }) {
  const step = (icon, t, extra) => onStep({ icon, text: t, ...(extra || {}) })
  const raw = String(text || '').trim()
  const intents = detectIntents(raw)
  const has = id => intents.some(i => i.id === id)
  const top = intents.length ? intents[0].id : null
  const pasted = extractCode(raw)
  const n = normalize(raw)
  const finish = r => ({ text: r.text, chips: r.chips || [], memory, changed: !!r.changed, ran: !!r.ran })

  if (top === 'greet' && raw.length < 20) return finish({ text: 'こんにちは! Forge AI です。Python のコードを作る・直す・説明する・質問に答える、などができます。何をしましょう?', chips: ['何ができる?', 'このコードを説明して', '数当てゲームを作って'] })
  if (top === 'thanks' && raw.length < 30) return finish({ text: 'どういたしまして! ほかにも気になることがあれば、いつでもどうぞ。', chips: [] })
  if (top === 'help') return finish({ text: helpText(), chips: EXAMPLES.slice(0, 3).map(x => x + 'を作って') })
  if (top === 'undo' && host.undoLast) {
    const r = await host.undoLast()
    return finish({ text: r || '元に戻せる変更がありません。', chips: [] })
  }

  // ---- 貼り付けられたコード ----
  if (pasted && !has('generate')) {
    if (has('fix')) {
      const r = await fixAll(host.py, pasted)
      const rv = r.ok ? await reviewCode(host.py, r.text) : { findings: [] }
      const auto = autoFixable(rv.findings || [])
      const text2 = auto.length ? applyReviewFixes(r.text, auto) : r.text
      const fixes = [...r.fixes, ...auto.map(f => ({ line: f.line, why: f.message.replace(/。.*$/s, '').replace(/`/g, '') }))]
      return finish({ text: (fixes.length ? `**${fixes.length} か所を直しました:**\n${changeReport(fixes)}` : '自動で直せる問題は見つかりませんでした。') + '\n\n' + fence(text2) + (r.ok ? '' : `\n\n**注意:** まだ構文エラーが残っています: ${r.error && r.error.message}`), chips: ['このコードを説明して'] })
    }
    if (has('format') || has('tidy')) {
      const rep = await repairSyntax(host.py, pasted)
      const m = has('tidy') ? await modernize(host.py, rep.text) : { text: rep.text, fixes: [] }
      return finish({ text: `整形しました${m.fixes.length ? ` (新しい書き方 ${m.fixes.length} か所も)` : ''}:\n\n${fence(await formatCode(host.py, m.text))}`, chips: [] })
    }
    if (has('review') || has('optimize')) {
      const rv = await reviewCode(host.py, pasted)
      return finish({ text: !rv.ok ? `構文エラーがあります${rv.error ? `: ${rv.error.line} 行目 ${rv.error.message}` : ''}` : rv.findings.length ? rv.findings.slice(0, 10).map(x => `- ${x.line} 行目: ${x.message}`).join('\n') : '問題は見つかりませんでした。', chips: rv.ok ? [] : ['直して'] })
    }
    if (!has('error')) return finish(await doExplain(host, step, pasted))
  }

  // ---- 直前に作ったものの手直し (「10 回にして」「200 までにして」) ----
  if (memory.lastGen && memory.lastGen.files && memory.lastGen.files.length && FOLLOWUP_RE.test(n) && !/(新しく|別の|べつの|もう一つ|もうひとつ)/.test(n) && (!top || top === 'generate' || top === 'optimize' || top === 'question') && raw.length < 60) {
    const merged = `${raw} ${memory.lastGen.text}`
    const r = await doGenerate(host, step, merged, memory, { replaceFiles: memory.lastGen.files })
    if (r) { memory.lastGen.text = merged; return finish(r) }
  }

  // ---- エラー文が送られてきた (「エラーを直して」+ トレースバックも) ----
  if (has('error') && !has('generate')) {
    if (has('fix') && host.active()) {
      const r = await doFix(host, step)
      const ex = explainError(raw)
      const last = raw.trim().split('\n').filter(l => l.trim()).pop() || ''
      const extra = ex ? `\n\n---\n\n**エラー \`${last.slice(0, 160)}\` について**\n\n${ex.why}\n${ex.fixes.map(f => '- ' + f).join('\n')}` : ''
      return finish({ ...r, text: r.text + extra })
    }
    const ex = explainError(raw)
    if (ex) return finish({ text: `**このエラーの意味**\n\n${ex.why}\n\n**直し方**\n${ex.fixes.map(f => '- ' + f).join('\n')}`, chips: host.active() ? ['エラーを直して'] : [] })
  }

  // ---- コードへの操作 (順番に実行) ----
  const ops = []
  if (has('fix')) ops.push('fix')
  if (has('format') && !has('tidy')) ops.push('format')
  if (has('tidy')) ops.push('tidy')
  if (has('optimize') && !has('generate')) ops.push('optimize')
  if (has('types')) ops.push('types')
  if (has('comment')) ops.push('comment')
  if (has('rename')) ops.push('rename')
  if (has('explain') && !has('generate')) ops.push('explain')
  if (has('review') && !ops.length) ops.push('review')
  if (has('run')) ops.push('run')
  const strongGen = /(作って|つくって|作成して|生成して|書いて|かいて|作りたい|つくりたい|作れる\?|作れますか|プログラム)/.test(n)
  const genFirst = has('generate') && (top === 'generate' || strongGen || !ops.length) && !/^(この|その|今の|いまの|開いて)/.test(n)
  if (ops.length && !genFirst) {
    const texts = []
    const chips = new Set()
    let changed = false, ran = false
    for (const op of ops.slice(0, 3)) {
      if (signal && signal.aborted) break
      let r
      if (op === 'fix') r = await doFix(host, step)
      else if (op === 'format') r = await doFormat(host, step)
      else if (op === 'tidy') r = await doFormat(host, step, { tidy: true })
      else if (op === 'optimize') r = await doOptimize(host, step)
      else if (op === 'types') r = await doTypes(host, step)
      else if (op === 'comment') r = await doComments(host, step)
      else if (op === 'rename') r = await doRename(host, step, raw)
      else if (op === 'explain') r = await doExplain(host, step)
      else if (op === 'review') r = await doReview(host, step)
      else if (op === 'run') r = await doRun(host, step, signal)
      texts.push(r.text)
      for (const c of r.chips || []) chips.add(c)
      changed = changed || r.changed
      ran = ran || r.ran
    }
    return finish({ text: texts.join('\n\n---\n\n'), chips: [...chips].slice(0, 3), changed, ran })
  }

  // ---- 作る ----
  if (has('generate') || (!top && conceptsOf(raw).size >= 2)) {
    const r = await doGenerate(host, step, raw, memory)
    if (r) return finish(r)
    let llmErr = ''
    const llm = await askLlm(host, step, raw, history, { onText, signal, purpose: 'generate' }).catch(e => { if (e && e.name === 'AbortError') throw e; llmErr = e && e.message; return null })
    if (llm) return finish({ text: llm, chips: ['レビューして'] })
    const q = await doQuestion(host, raw, memory)
    return finish({ text: `ごめんなさい、その内容はまだ自分では組み立てられませんでした。${q.confident ? '関係ありそうな説明を載せます。\n\n' + q.text : ''}\n\n**作れるものの例**: ${EXAMPLES.slice(0, 14).join('、')}${llmErr ? `\n\n_(高性能モードは使えませんでした: ${llmErr})_` : '\n\n設定 → AI で「高性能モード (端末内 LLM)」をオンにすると、自由な内容にも挑戦できます。'}`, chips: EXAMPLES.slice(0, 3).map(x => x + 'を作って') })
  }

  // ---- 質問 ----
  const q = await doQuestion(host, raw, memory)
  if (q.confident) return finish(q)
  let llmErr = ''
  const llm = await askLlm(host, step, raw, history, { onText, signal }).catch(e => { if (e && e.name === 'AbortError') throw e; llmErr = e && e.message; return null })
  if (llm) return finish({ text: llm, chips: [] })
  const act = host.active()
  const guess = []
  if (act && isPy(act.path)) guess.push('このコードを説明して', 'レビューして')
  guess.push('何ができる?')
  return finish({ text: `うまく理解できませんでした。${q.chips.length ? 'もしかして、これについてですか?' : ''}\n\n例えば次のように頼んでください:\n- 「説明して」「直して」「整形して」「レビューして」(開いているファイルに対して)\n- 「数当てゲームを作って」「1 から 100 まで足すプログラム」\n- 「リストの使い方は?」「辞書とは」「TypeError って何?」${llmErr ? `\n\n_(高性能モードは使えませんでした: ${llmErr})_` : ''}`, chips: [...q.chips, ...guess].slice(0, 4) })
}

export { tokens }
