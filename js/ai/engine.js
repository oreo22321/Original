// Forge AI: 頭脳 (依頼を読み取り、適切な処理を選んで実行し、返事を組み立てる)
// 画面 (DOM) には触らず、host (アプリ側が用意する窓口) を通してファイルの読み書き・実行をします。
//   host = {
//     mode, hasProject, files() → [{path}], active() → { path, text, from, to } | null,
//     read(path), write(path, text, {focus}), create(path, text), lintOpts(path), problems(path, text),
//     lastErrors() → [{ text, traceback }], run({ path, seconds, signal }) → 結果, undoLast() → 説明 | null,
//     llm: { ready(), generate(messages, { onText, signal, maxTokens }) } | null,
//   }
// respond() は { text (Markdown), chips: [次に頼めそうなこと], memory } を返します。
import { normalize, concepts as conceptsOf, slots as slotsOf, detectIntents, extractCode, Bm25, tokens } from './text.js'
import { KNOWLEDGE, KNOWLEDGE_BY_ID } from './knowledge.js'
import { repairSyntax, fixAll, modernize, formatCode, applyLintFixes, lineOf, codeTokens } from './repair.js'
import { reviewCode, applyReviewFixes } from './review.js'
import { explainCode, addComments, addTypes } from './describe.js'
import { generateCode, EXAMPLES } from './generate.js'
import { checkSyntax } from '../luau/parser.js'
import { explainError } from '../app/explain.js'
import { analyzeSymbols } from '../editor/symbols.js'
import * as apidb from '../editor/apidb.js'
import { LUAU_GLOBALS, LUAU_LIBS, ROBLOX_DATATYPES } from '../data/luau-api.js'
import { EXECUTOR_GLOBALS, EXECUTOR_LIBS } from '../data/executor-api.js'

const isLua = p => /\.luau?$/i.test(p || '')
const tick = () => new Promise(r => setTimeout(r, 0))
const fence = (code, lang = 'lua') => '```' + lang + '\n' + code.replace(/\n+$/, '') + '\n```'
const plural = list => list.join('\n')
const lineCount = s => s.split('\n').length

// ============================================================
// 知識の検索
// ============================================================
let index = null
function knowledgeIndex() {
  if (!index) index = new Bm25(KNOWLEDGE.map(e => ({ id: e.id, ref: e, fields: [[e.t, 3], [e.k, 3], [e.b, 1], [e.c || '', 0.3]] })))
  return index
}
export function searchKnowledge(text, mode = 'studio', limit = 4) {
  const n = normalize(text)
  const aboutApp = /(forgecode|このアプリ|アプリの|この画面|エディタ|エディター|保存|zip|実行ボタン|デバッ|ブレークポイント|モード|プレビュー|forge ?ai|ai で|ai の|ai に|設定)/.test(n)
  return knowledgeIndex().search(text, limit, d => {
    const e = d.ref
    if (e.mode === 'executor') return mode === 'executor' ? 0.8 : -4
    if (e.mode === 'app') return aboutApp ? 2 : -2
    return 0
  })
}

// ============================================================
// API の説明 (日本語)
// ============================================================
const KIND_JP = { p: 'プロパティ', f: 'メソッド', e: 'イベント', c: 'コールバック' }
export function apiAnswer(query, mode = 'studio') {
  const q = String(query || '').trim().replace(/^game:GetService\(["'](\w+)["']\)/, '$1')
  const m = /^([A-Za-z_]\w*)(?:[.:]([A-Za-z_]\w*))?/.exec(q)
  if (!m) return null
  const [, a, b] = m
  const docLine = (name, e) => (e ? `\`${name}${e.kind === 'function' ? e.sig : ': ' + (e.type || 'any')}\`${e.doc ? ' — ' + e.doc : ''}` : null)
  if (a === 'Enum' && b && apidb.apiReady()) {
    const items = apidb.enumItems(b)
    if (!items) return null
    return `**Enum.${b}** (列挙型) の値: ${items.slice(0, 60).map(it => '`' + (Array.isArray(it) ? it[0] : it) + '`').join('、')}${items.length > 60 ? ' …' : ''}\n\n使い方: \`Enum.${b}.${Array.isArray(items[0]) ? items[0][0] : items[0]}\``
  }
  if (apidb.apiReady() && apidb.isClass(a)) {
    if (b) {
      const mem = apidb.member(a, b)
      if (!mem) {
        const names = [...apidb.classMembers(a).keys()]
        const sim = names.filter(n => n.toLowerCase().includes(b.toLowerCase().slice(0, 4))).slice(0, 6)
        return `**${a}** に \`${b}\` はありません。${sim.length ? '似た名前: ' + sim.map(x => '`' + x + '`').join('、') : ''}`
      }
      const flags = []
      if (mem.flags.includes('r')) flags.push('読み取り専用')
      if (mem.flags.includes('d')) flags.push('非推奨')
      const how = mem.kind === 'f' ? `\`obj:${mem.name}${mem.type || '()'}\`` : mem.kind === 'e' ? `\`obj.${mem.name}:Connect(function(...) end)\`` : `\`obj.${mem.name}\` (${mem.type || '?'})`
      return `**${mem.owner}.${mem.name}** — ${KIND_JP[mem.kind] || mem.kind}${flags.length ? ' (' + flags.join('・') + ')' : ''}\n\n書き方: ${how}`
    }
    const info = apidb.classInfo(a)
    const groups = { p: [], f: [], e: [] }
    for (const mem of apidb.classMembers(a).values()) {
      if (mem.flags.includes('d') || mem.flags.includes('h') || mem.owner === 'Instance' || mem.owner === 'Object') continue
      if (groups[mem.kind]) groups[mem.kind].push('`' + mem.name + '`')
    }
    const out = [`**${a}** — Roblox のクラス${apidb.isService(a) ? ` (サービス: \`game:GetService("${a}")\` で取得)` : ''}${info && info.s ? `。${apidb.superChain(a).slice(1, 4).join(' → ')} を受け継いでいます` : ''}`]
    if (groups.p.length) out.push(`- プロパティ: ${groups.p.slice(0, 30).join('、')}${groups.p.length > 30 ? ' …' : ''}`)
    if (groups.f.length) out.push(`- メソッド: ${groups.f.slice(0, 30).join('、')}${groups.f.length > 30 ? ' …' : ''}`)
    if (groups.e.length) out.push(`- イベント: ${groups.e.slice(0, 20).join('、')}`)
    return out.join('\n')
  }
  const lib = LUAU_LIBS[a] || (mode === 'executor' || EXECUTOR_LIBS[a] ? EXECUTOR_LIBS[a] : null)
  if (lib) {
    if (b) return lib[b] ? docLine(`${a}.${b}`, lib[b]) : `\`${a}\` に \`${b}\` はありません。あるもの: ${Object.keys(lib).slice(0, 30).map(k => '`' + k + '`').join('、')}`
    return `**${a}** ライブラリ:\n` + Object.entries(lib).slice(0, 24).map(([k, e]) => '- ' + docLine(`${a}.${k}`, e)).join('\n')
  }
  const dt = ROBLOX_DATATYPES[a]
  if (dt) {
    const parts = [`**${a}** (データ型)`]
    for (const [k, e] of Object.entries(dt.ctor || {}).slice(0, 8)) parts.push('- ' + docLine(`${a}.${k}`, e))
    const props = Object.keys(dt.props || {})
    if (props.length) parts.push(`- プロパティ: ${props.slice(0, 20).map(x => '`' + x + '`').join('、')}`)
    const meth = Object.keys(dt.methods || {})
    if (meth.length) parts.push(`- メソッド: ${meth.slice(0, 20).map(x => '`' + x + '`').join('、')}`)
    return parts.join('\n')
  }
  if (EXECUTOR_GLOBALS[a]) return docLine(a, EXECUTOR_GLOBALS[a]) + (mode === 'executor' ? '' : '\n\n(エグゼキューター専用の関数です。Executor モードで使えます)')
  if (LUAU_GLOBALS[a]) return docLine(a, LUAU_GLOBALS[a])
  return null
}
// 文の中の API 名らしいもの
function apiMentions(text, mode) {
  const out = []
  const re = /\b(Enum\.[A-Z]\w+|[A-Za-z_]\w*(?:[.:][A-Za-z_]\w*)?)\b/g
  let m
  const seen = new Set()
  while ((m = re.exec(String(text).normalize('NFKC')))) {
    const w = m[1]
    if (seen.has(w) || w.length < 3) continue
    seen.add(w)
    const head = w.split(/[.:]/)[0]
    const known = head === 'Enum' || (apidb.apiReady() && apidb.isClass(head)) || LUAU_LIBS[head] || ROBLOX_DATATYPES[head] || (EXECUTOR_GLOBALS[head] && mode === 'executor') || EXECUTOR_LIBS[head] || (LUAU_GLOBALS[head] && head.length > 3)
    if (known) out.push(w)
  }
  return out.slice(0, 3)
}

// ============================================================
// 返事の部品
// ============================================================
function changeReport(fixes, max = 14) {
  if (!fixes.length) return ''
  const list = fixes.slice(0, max).map(f => `- ${f.line ? f.line + ' 行目: ' : ''}${f.why}`)
  if (fixes.length > max) list.push(`- …ほか ${fixes.length - max} 件`)
  return list.join('\n')
}
function problemList(list, max = 10) {
  return list.slice(0, max).map(p => `- ${p.line} 行目 ${p.severity === 'error' ? '🔴' : p.severity === 'warning' ? '🟡' : '🔵'} ${p.message}`).join('\n') + (list.length > max ? `\n- …ほか ${list.length - max} 件` : '')
}

// 対象のコード (選択範囲があればそこ、なければファイル全体)
function target(host) {
  const act = host.active()
  if (!act) return null
  const sel = act.to > act.from ? { from: act.from, to: act.to } : null
  return { path: act.path, text: act.text, sel, lua: isLua(act.path) }
}
// 選択範囲だけを変換して戻す (前後は触らない)。範囲は行単位に広げる
function withRange(text, sel, fn) {
  if (!sel) return fn(text)
  const s = text.lastIndexOf('\n', sel.from - 1) + 1
  let e = text.indexOf('\n', Math.max(sel.from, sel.to - 1))
  if (e < 0) e = text.length
  const part = text.slice(s, e)
  const r = fn(part)
  if (!r || r.text === undefined) return r
  return { ...r, text: text.slice(0, s) + r.text + text.slice(e), offsetLine: lineOf(text, s) - 1 }
}

// ============================================================
// 各処理
// ============================================================
async function doFix(host, step, opts = {}) {
  const tg = target(host)
  if (!tg) return { text: '直すファイルが開かれていません。ファイルを開いてから頼んでください。', chips: [] }
  if (!tg.lua) return { text: `${tg.path} は Luau のファイルではないため、自動修正の対象外です。`, chips: [] }
  const lintOpts = host.lintOpts(tg.path)
  step('bug', `${tg.path} の問題を調べています`)
  await tick()
  const before = tg.text
  // 1) 構文 + エディタのチェックの安全な修正
  const r = withRange(before, tg.sel, part => fixAll(part, lintOpts))
  let text = r.text
  const fixes = (r.fixes || []).map(f => ({ ...f, line: f.line + (r.offsetLine || 0) }))
  // 2) レビューで見つかった、自動で直せるバグ
  let findings = []
  if (r.ok !== false) {
    findings = reviewCode(text, { executor: host.mode === 'executor' })
    const auto = findings.filter(f => f.fix && f.severity !== 'info' && (!tg.sel || (f.line >= lineOf(before, tg.sel.from) && f.line <= lineOf(before, tg.sel.to))))
    if (auto.length) {
      const next = applyReviewFixes(text, auto)
      if (!checkSyntax(next)) { text = next; for (const f of auto) fixes.push({ line: f.line, why: f.message.replace(/。.*$/, '') }) }
    }
  }
  // 3) 実行時のエラー (直前の実行) の説明
  const errs = opts.runtime !== false ? (host.lastErrors() || []).filter(e => !e.path || e.path === tg.path).slice(-2) : []
  const parts = []
  if (text !== before) {
    await host.write(tg.path, text, { focus: true })
    step('edit', `${tg.path} を修正`, { path: tg.path })
    parts.push(`**${fixes.length} か所を直しました** (${tg.path}${tg.sel ? '・選択範囲' : ''}):\n${changeReport(fixes)}`)
  }
  if (r.ok === false) parts.push(`⚠️ まだ構文エラーが残っています (${r.error ? r.error.line + ' 行目: ' + r.error.message : ''})。自動では直し方を決められませんでした。その行のまわりを確認してください。`)
  // 残っている問題
  const remain = host.problems(tg.path, text).filter(p => p.severity === 'error' || p.severity === 'warning')
  const restReview = reviewCode(text, { executor: host.mode === 'executor' }).filter(f => !f.fix && f.severity !== 'info')
  if (remain.length) parts.push(`**残っている問題** (自動では直せないもの):\n${problemList(remain, 8)}`)
  if (restReview.length) parts.push(`**気をつけたいところ**:\n${restReview.slice(0, 6).map(f => `- ${f.line} 行目: ${f.message}`).join('\n')}`)
  for (const e of errs) {
    const ex = explainError(e.text, { kind: host.mode === 'executor' ? 'executor' : 'any' })
    const lm = /:(\d+):/.exec(e.text)
    const codeLine = lm ? (text.split('\n')[+lm[1] - 1] || '').trim() : ''
    parts.push(`**実行時のエラー**: \`${e.text.slice(0, 200)}\`${codeLine ? `\n\n該当の行: \`${codeLine.slice(0, 120)}\`` : ''}${ex ? `\n\n${ex.why}\n${ex.fixes.slice(0, 3).map(f => '- ' + f).join('\n')}` : ''}`)
  }
  if (!parts.length) parts.push(`${tg.path}${tg.sel ? ' の選択範囲' : ''}に、自動で見つけられる問題はありませんでした ✅\n\n動きがおかしいときは、▶ で実行してエラーを出してから「エラーを直して」と頼むか、どう動いてほしいかを具体的に教えてください。`)
  return { text: parts.join('\n\n'), chips: text !== before ? ['実行して確かめて', '説明して'] : ['実行して', 'コードをチェックして'], changed: text !== before }
}

async function doFormat(host, step, { tidy = false } = {}) {
  const tg = target(host)
  if (!tg || !tg.lua) return { text: '整形するには Luau のファイルを開いてください。', chips: [] }
  if (checkSyntax(tg.text)) {
    const rep = repairSyntax(tg.text)
    if (!rep.ok) return { text: `構文エラーがあるため整形できません (${rep.error ? rep.error.line + ' 行目' : ''})。先に「直して」と頼んでください。`, chips: ['直して'] }
  }
  step('wand', tidy ? `${tg.path} を整理しています` : `${tg.path} を整形しています`)
  await tick()
  let fixes = []
  const r = withRange(tg.text, tg.sel, part => {
    let t = part
    if (tidy) { const m = modernize(t, host.lintOpts(tg.path)); t = m.text; fixes = m.fixes; const h = hoistServices(t); if (h.count) { t = h.text; fixes.push({ line: 0, why: `GetService の呼び出し ${h.count} か所を、先頭の変数にまとめました` }) } }
    return { text: formatCode(t) }
  })
  if (r.text === tg.text) return { text: `${tg.path}${tg.sel ? ' の選択範囲' : ''}は、もう${tidy ? '整理' : '整形'}されています ✅`, chips: tidy ? [] : ['整理して'] }
  if (checkSyntax(r.text)) return { text: '整形すると構文が壊れてしまうため、中止しました。', chips: [] }
  await host.write(tg.path, r.text, { focus: true })
  step('edit', `${tg.path} を${tidy ? '整理' : '整形'}`, { path: tg.path })
  const msg = [tidy ? `**${tg.path} を整理しました。**` : `**${tg.path} を整形しました** (字下げ・空白・空行をそろえました)。`]
  if (fixes.length) msg.push('古い書き方を新しい書き方にしました:\n' + changeReport(fixes))
  else if (tidy) msg.push('字下げと空白をそろえました。')
  return { text: msg.join('\n\n'), chips: ['説明して', 'コメントを追加して'], changed: true }
}

// GetService をループ・関数の中で呼んでいるものを、先頭の変数にまとめる
export function hoistServices(src) {
  const toks = codeTokens(src)
  if (!toks) return { text: src, count: 0 }
  const top = new Map() // サービス名 → 既にある変数名
  for (const m of src.matchAll(/^local\s+([A-Za-z_]\w*)\s*=\s*game:GetService\(\s*["'](\w+)["']\s*\)\s*$/gm)) top.set(m[2], m[1])
  const occ = []
  for (let i = 0; i + 5 < toks.length; i++) {
    const t = toks[i]
    if (t.t === 'name' && t.v === 'game' && toks[i + 1].t === ':' && toks[i + 2].v === 'GetService' && toks[i + 3].t === '(' && toks[i + 4].t === 'string' && toks[i + 5].t === ')') {
      const lineStart = src.lastIndexOf('\n', t.s - 1) + 1
      const lineText = src.slice(lineStart, src.indexOf('\n', t.s) < 0 ? src.length : src.indexOf('\n', t.s))
      // 先頭の「local X = game:GetService("X")」そのものは対象外
      if (/^local\s+\w+\s*=\s*game:GetService\(\s*["']\w+["']\s*\)\s*$/.test(lineText)) continue
      if (/^\s/.test(lineText) || toks[i - 1]) occ.push({ s: t.s, e: toks[i + 5].e, name: toks[i + 4].v, indented: /^\s/.test(lineText) })
    }
  }
  const inner = occ.filter(o => o.indented)
  if (!inner.length) return { text: src, count: 0 }
  const decl = []
  let text = src
  for (const o of [...inner].sort((a, b) => b.s - a.s)) {
    let v = top.get(o.name)
    if (!v) {
      v = o.name
      // 同じ名前の変数が別の意味で使われていたらやめる
      if (new RegExp(`\\blocal\\s+${v}\\b`).test(src)) continue
      top.set(o.name, v)
      decl.push(`local ${v} = game:GetService("${o.name}")`)
    }
    text = text.slice(0, o.s) + v + text.slice(o.e)
  }
  if (decl.length) {
    // 既存のサービスの宣言の後ろ (なければ先頭のコメントの後ろ) に入れる
    const lines = text.split('\n')
    let at = 0
    lines.forEach((l, i) => { if (/^local\s+\w+\s*=\s*game:GetService\(/.test(l)) at = i + 1 })
    if (!at) while (at < lines.length && /^\s*(--|$)/.test(lines[at])) at++
    lines.splice(at, 0, ...[...new Set(decl)].reverse())
    text = lines.join('\n')
  }
  if (checkSyntax(text)) return { text: src, count: 0 }
  return { text, count: inner.length }
}

async function doComments(host, step) {
  const tg = target(host)
  if (!tg || !tg.lua) return { text: 'コメントを追加するには Luau のファイルを開いてください。', chips: [] }
  step('comment', 'コメントを考えています')
  await tick()
  const r = addComments(tg.text, tg.sel || {})
  if (!r.ok) return { text: '構文エラーがあるため、先に直す必要があります。', chips: ['直して'] }
  if (!r.count) return { text: 'コメントを足す場所が見つかりませんでした (すでにコメントがあるか、短いコードです)。', chips: [] }
  await host.write(tg.path, r.text, { focus: true })
  step('edit', `${tg.path} にコメントを追加`, { path: tg.path })
  return { text: `**${r.count} か所に説明のコメントを追加しました** (処理は変えていません)。関数・イベント・ループ・条件分岐の上に「何をしているか」を書いています。`, chips: ['説明して', '型注釈を付けて'], changed: true }
}

async function doTypes(host, step) {
  const tg = target(host)
  if (!tg || !tg.lua) return { text: '型注釈を付けるには Luau のファイルを開いてください。', chips: [] }
  step('braces', '使われ方から型を推測しています')
  await tick()
  const r = addTypes(tg.text, tg.sel || {})
  if (!r.ok) return { text: '構文エラーがあるため、先に直す必要があります。', chips: ['直して'] }
  if (!r.count) return { text: '型を推測できる引数・戻り値が見つかりませんでした (すでに型が付いているか、使われ方から判断できません)。', chips: [] }
  await host.write(tg.path, r.text, { focus: true })
  step('edit', `${tg.path} に型注釈を追加`, { path: tg.path })
  return { text: `**${r.count} か所に型注釈を付けました** (引数と戻り値)。イベントの引数 (Touched → BasePart、PlayerAdded → Player など) と、関数の中での使われ方から推測しています。動きは変わりません。`, chips: ['チェックして'], changed: true }
}

async function doOptimize(host, step) {
  const tg = target(host)
  if (!tg || !tg.lua) return { text: '最適化するには Luau のファイルを開いてください。', chips: [] }
  if (checkSyntax(tg.text)) return { text: '構文エラーがあるため、先に直す必要があります。', chips: ['直して'] }
  step('bolt', '重くなる書き方を探しています')
  await tick()
  const fixes = []
  let text = tg.text
  const h = hoistServices(text)
  if (h.count) { text = h.text; fixes.push({ line: 0, why: `ループ・関数の中の GetService ${h.count} か所を、先頭で 1 回だけ取得する形に` }) }
  const m = modernize(text, host.lintOpts(tg.path))
  if (m.text !== text) { text = m.text; fixes.push(...m.fixes) }
  const perf = reviewCode(text, { executor: host.mode === 'executor' }).filter(f => f.kind === 'perf' || /毎フレーム/.test(f.message))
  const parts = []
  if (text !== tg.text && !checkSyntax(text)) {
    await host.write(tg.path, text, { focus: true })
    step('edit', `${tg.path} を最適化`, { path: tg.path })
    parts.push(`**自動で直したところ:**\n${changeReport(fixes)}`)
  }
  if (perf.length) parts.push(`**手で直すと軽くなるところ:**\n${perf.slice(0, 8).map(f => `- ${f.line} 行目: ${f.message}`).join('\n')}`)
  if (!parts.length) parts.push('目立って重くなる書き方は見つかりませんでした ✅\n\nさらに軽くしたいときのコツ:\n- 毎フレームの処理 (Heartbeat / RenderStepped) の中で、探す・作る処理をしない\n- 使い終わった接続は :Disconnect()、オブジェクトは :Destroy()\n- while true で見張るより、イベント (Changed・Touched) を使う')
  return { text: parts.join('\n\n'), chips: ['説明して'], changed: text !== tg.text }
}

async function doReview(host, step) {
  const tg = target(host)
  if (!tg || !tg.lua) return { text: 'チェックするには Luau のファイルを開いてください。', chips: [] }
  step('check', `${tg.path} をチェックしています`)
  await tick()
  const probs = host.problems(tg.path, tg.text)
  const errs = probs.filter(p => p.severity === 'error' || p.severity === 'warning')
  const findings = checkSyntax(tg.text) ? [] : reviewCode(tg.text, { executor: host.mode === 'executor' })
  const parts = []
  if (errs.length) parts.push(`**エラー・警告 (${errs.length})**\n${problemList(errs, 10)}`)
  const bugs = findings.filter(f => f.kind === 'bug' || f.kind === 'security')
  const perf = findings.filter(f => f.kind === 'perf')
  const style = findings.filter(f => f.kind === 'style')
  if (bugs.length) parts.push(`**バグ・安全面で気になるところ (${bugs.length})**\n${bugs.slice(0, 8).map(f => `- ${f.line} 行目: ${f.message}`).join('\n')}`)
  if (perf.length) parts.push(`**重くなりそうなところ (${perf.length})**\n${perf.slice(0, 6).map(f => `- ${f.line} 行目: ${f.message}`).join('\n')}`)
  if (style.length) parts.push(`**読みやすさ (${style.length})**\n${style.slice(0, 4).map(f => `- ${f.line} 行目: ${f.message}`).join('\n')}`)
  if (!parts.length) return { text: `${tg.path} をチェックしました。問題は見つかりませんでした ✅`, chips: ['説明して', 'コメントを追加して'] }
  const fixable = errs.some(p => p.fixable) || findings.some(f => f.fix) || errs.length
  return { text: `${tg.path} をチェックしました。\n\n${parts.join('\n\n')}`, chips: fixable ? ['直して', '最適化して'] : ['最適化して'] }
}

async function doExplain(host, step, code) {
  if (code) {
    step('book', '貼り付けられたコードを読んでいます')
    const r = explainCode(code, { mode: host.mode })
    return { text: r.markdown, chips: r.ok ? ['このコードの問題をチェックして'] : ['直して'] }
  }
  const tg = target(host)
  if (!tg) return { text: '説明するファイルを開いてください (または、コードを貼り付けて「説明して」と送ってください)。', chips: [] }
  if (!tg.lua) return { text: `${tg.path} は Luau のファイルではないため、説明できません。`, chips: [] }
  step('book', tg.sel ? '選択した範囲を読んでいます' : `${tg.path} を読んでいます`)
  await tick()
  const r = explainCode(tg.text, { path: tg.path, mode: host.mode, from: tg.sel ? tg.sel.from : null, to: tg.sel ? tg.sel.to : null, lintProblems: host.problems(tg.path, tg.text) })
  return { text: r.markdown, chips: r.ok ? ['コメントを追加して', 'チェックして'] : ['直して'] }
}

async function doRun(host, step, signal) {
  if (!host.run) return { text: 'この画面では実行できません。', chips: [] }
  step('play', '実行しています (3 秒)')
  const r = await host.run({ seconds: 3, signal })
  if (!r || !r.started) return { text: '実行を始められませんでした。プロジェクトに実行するファイルがあるか確認してください。', chips: [] }
  const out = (r.output || []).filter(o => o.kind !== 'meta').slice(-12).map(o => o.text)
  const parts = []
  parts.push(r.errors.length ? `**エラーが ${r.errors.length} 件出ました。**` : r.stillRunning ? '**実行中です** (エラーは出ていません)。' : '**エラーなく実行できました** ✅')
  if (out.length) parts.push('出力 (最後の行):\n' + fence(out.join('\n'), 'text'))
  for (const e of r.errors.slice(0, 2)) {
    const ex = explainError(e.text, {})
    parts.push(`- \`${e.text.slice(0, 200)}\`${ex ? '\n  ' + ex.why : ''}`)
  }
  if (r.screen && r.screen.gui) parts.push('画面の GUI:\n' + fence(r.screen.gui.split('\n').slice(0, 12).join('\n'), 'text'))
  return { text: parts.join('\n\n'), chips: r.errors.length ? ['エラーを直して'] : ['説明して'], ran: true }
}

async function doRename(host, step, text) {
  const tg = target(host)
  if (!tg || !tg.lua) return { text: '名前を変えるには Luau のファイルを開いてください。', chips: [] }
  const ids = [...String(text).normalize('NFKC').matchAll(/[A-Za-z_]\w*/g)].map(m => m[0]).filter(w => !/^(rename|to|from|local|function)$/i.test(w))
  if (ids.length < 2) return { text: '「oldName を newName に名前を変えて」のように、今の名前と新しい名前を書いてください。', chips: [] }
  const [from, to] = ids
  let an
  try { an = analyzeSymbols(tg.text) } catch { return { text: '構文エラーがあるため、名前を変えられません。', chips: ['直して'] } }
  const syms = an.symbols.filter(s => s.name === from)
  if (!syms.length) return { text: `\`${from}\` という変数・関数が見つかりませんでした。`, chips: [] }
  const refs = syms.flatMap(s => s.refs)
  let out = tg.text
  for (const r of [...refs].sort((a, b) => b.s - a.s)) out = out.slice(0, r.s) + to + out.slice(r.e)
  if (checkSyntax(out)) return { text: '名前を変えると構文が壊れるため、中止しました。', chips: [] }
  await host.write(tg.path, out, { focus: true })
  step('edit', `${from} → ${to}`, { path: tg.path })
  return { text: `\`${from}\` を \`${to}\` に変えました (${refs.length} か所。文字列やコメントの中・別の場所で宣言された同じ名前は変えていません)。`, chips: [], changed: true }
}

// ---- コードの生成 ----
function freeName(host, name) {
  const files = new Set(host.files().map(f => f.path))
  if (!files.has(name)) return name
  const m = /^(.*?)(\.(?:server\.|client\.)?luau?)$/.exec(name) || [null, name, '']
  for (let i = 2; i < 100; i++) { const n = `${m[1]}${i}${m[2]}`; if (!files.has(n)) return n }
  return name
}
async function doGenerate(host, step, text, memory, { replaceFiles = null } = {}) {
  step('sparkle', 'コードを組み立てています')
  await tick()
  const gen = generateCode(text, { mode: host.mode })
  if (!gen) return null
  const written = []
  const act = host.active()
  const activeEmpty = act && isLua(act.path) && act.text.split('\n').filter(l => l.trim() && !l.trim().startsWith('--')).length <= 2
  for (let i = 0; i < gen.files.length; i++) {
    const f = gen.files[i]
    let path
    if (replaceFiles && replaceFiles[i] && host.files().some(x => x.path === replaceFiles[i])) path = replaceFiles[i]
    else if (i === 0 && gen.files.length === 1 && activeEmpty) path = act.path
    if (!host.hasProject) continue
    if (path) await host.write(path, f.code, { focus: i === 0 })
    else { path = freeName(host, f.name); await host.create(path, f.code, { focus: i === 0 }) }
    step(replaceFiles ? 'edit' : 'newFile', `${path} を${replaceFiles ? '書き換え' : '作成'}`, { path })
    written.push(path)
  }
  memory.lastGen = { text, files: written, spec: gen.spec, title: gen.title }
  const parts = [`**${gen.title}** を${replaceFiles ? '作り直しました' : '作りました'}。`]
  parts.push(gen.summary.map(s => '- ' + s).join('\n'))
  if (written.length) parts.push(`ファイル: ${written.map(p => '`' + p + '`').join('、')}`)
  // 短いものはコードも見せる (長いものはファイルで)
  for (const f of gen.files) {
    if (!host.hasProject || lineCount(f.code) <= 40) parts.push(`${gen.files.length > 1 ? f.name + '\n' : ''}${fence(f.code)}`)
    if (f.error) parts.push(`⚠️ ${f.name} に構文エラー: ${f.error}`)
  }
  if (gen.alternatives && gen.alternatives.length) parts.push(`ほかに近いもの: ${gen.alternatives.join('、')}`)
  const chips = ['説明して', '実行して確かめて']
  if (gen.spec.kind === 'compose') chips.push(gen.spec.trigger === 'key' ? 'ボタンでも使えるようにして' : '数値を変えるには?')
  return { text: parts.join('\n\n'), chips, changed: written.length > 0 }
}

// ---- 質問への回答 ----
function doQuestion(host, text, memory) {
  const parts = []
  const n = normalize(text)
  // エラー文
  const ex = explainError(text, {})
  if (ex && /(attempt|expected|valid member|infinite yield|nil|timeout|error|エラー)/i.test(text)) {
    parts.push(`**このエラーの意味**\n\n${ex.why}\n\n**直し方**\n${ex.fixes.map(f => '- ' + f).join('\n')}`)
  }
  // API 名
  for (const name of apiMentions(text, host.mode)) {
    const a = apiAnswer(name, host.mode)
    if (a) parts.push(a)
  }
  // 知識ベース
  const hits = searchKnowledge(text, host.mode, 4)
  const top = hits[0]
  const strong = top && (top.score >= 6 || (top.score >= 3.5 && hits.length > 1 && top.score > hits[1].score * 1.25))
  if (top && (strong || !parts.length) && top.score >= 2.5) {
    const e = top.ref
    memory.lastTopic = e.id
    parts.push(`### ${e.t}\n\n${e.b}${e.c ? '\n\n' + fence(e.c) : ''}`)
    const rel = hits.slice(1).filter(h => h.score >= top.score * 0.45).map(h => h.ref.t)
    return { text: parts.join('\n\n'), chips: rel.slice(0, 3).map(t => `${t.replace(/ \(.*\)$/, '')}について教えて`), confident: true }
  }
  if (parts.length) return { text: parts.join('\n\n'), chips: [], confident: true }
  return { text: '', chips: hits.slice(0, 3).map(h => `${h.ref.t.replace(/ \(.*\)$/, '')}について教えて`), confident: false, hits }
}

function helpText(mode) {
  return `**Forge AI** はこのアプリに入っている AI です。インターネットがなくても、すぐに答えます。

- **直す**: 「直して」「エラーを直して」— 構文エラー・打ち間違い・非推奨の書き方・よくあるバグを自動で修正
- **整える**: 「整形して」「整理して」「最適化して」
- **説明する**: 「説明して」(範囲を選ぶとその部分を 1 行ずつ)、「コメントを追加して」「型注釈を付けて」
- **作る**: 「触れたら死ぬブロック」「E キーでドアが開く」「ショップの UI」のように日本語で
- **答える**: 「RemoteEvent の使い方は?」「TweenService とは」「attempt to index nil って何?」
- **確かめる**: 「チェックして」「実行して」

作れるものの例: ${(EXAMPLES[mode] || EXAMPLES.studio).slice(0, 8).join('、')}`
}

// ============================================================
// LLM (端末内の言語モデル) を使う
// ============================================================
const LLM_RULES = `You are Forge AI, the assistant inside ForgeCode, a Roblox Luau code editor used on phones. Reply in Japanese, short and practical, for beginners.
Rules for code: Luau only, in one \`\`\`lua block. Use game:GetService, task.wait/task.spawn/task.delay, :Connect, local variables, check for nil (FindFirstChildOfClass / WaitForChild), set Parent last after Instance.new. Never use deprecated wait(), spawn(), :connect. Do not invent APIs.`
function llmContext(host, text) {
  const ctx = []
  const hits = searchKnowledge(text, host.mode, 2).filter(h => h.score > 2)
  for (const h of hits) ctx.push(`Reference (${h.ref.t}):\n${h.ref.b.slice(0, 600)}${h.ref.c ? '\n' + h.ref.c.slice(0, 600) : ''}`)
  for (const name of apiMentions(text, host.mode)) { const a = apiAnswer(name, host.mode); if (a) ctx.push('API: ' + a.slice(0, 500)) }
  const tg = target(host)
  if (tg && tg.lua) {
    const code = tg.sel ? tg.text.slice(tg.sel.from, tg.sel.to) : tg.text
    ctx.push(`${tg.sel ? 'Selected code' : 'Open file ' + tg.path}:\n${code.slice(0, 3000)}${code.length > 3000 ? '\n-- (truncated)' : ''}`)
  }
  return ctx.join('\n\n')
}
// LLM の答えの中のコードを検証して直す
export function verifyLlmCode(answer, opts = {}) {
  const notes = []
  const out = answer.replace(/```(?:lua|luau)?\n([\s\S]*?)```/g, (m, code) => {
    let c = code
    const rep = repairSyntax(c)
    if (rep.fixes.length) { c = rep.text; notes.push(`構文を ${rep.fixes.length} か所自動で修正しました`) }
    const m2 = modernize(c, opts)
    if (m2.text !== c && !checkSyntax(m2.text)) { c = m2.text; if (m2.fixes.length) notes.push('古い書き方を新しい書き方にしました') }
    const lf = applyLintFixes(c, opts)
    if (lf.fixes.length) { c = lf.text; notes.push(`打ち間違いなど ${lf.fixes.length} か所を修正しました`) }
    return '```lua\n' + c.replace(/\n+$/, '') + '\n```'
  })
  return { text: out, notes: [...new Set(notes)] }
}
async function askLlm(host, step, text, history, { onText, signal, purpose = 'chat' }) {
  const llm = host.llm
  if (!llm || !llm.ready()) return null
  step('sparkle', purpose === 'generate' ? '端末内の AI モデルがコードを書いています' : '端末内の AI モデルが考えています')
  const messages = [{ role: 'system', content: LLM_RULES + (host.mode === 'executor' ? '\nThe user writes Roblox executor scripts (client-side, UNC functions like getgenv, Drawing are available).' : '\nThe user writes Roblox Studio scripts.') }]
  for (const h of (history || []).slice(-4)) messages.push({ role: h.role, content: String(h.content).slice(0, 1200) })
  messages.push({ role: 'user', content: `${llmContext(host, text)}\n\nRequest: ${text}` })
  const raw = await llm.generate(messages, { onText, signal, maxTokens: purpose === 'generate' ? 1200 : 700 })
  const v = verifyLlmCode(raw, host.lintOpts ? host.lintOpts('x.lua') : {})
  return v.text + (v.notes.length ? `\n\n_(Forge AI のチェック: ${v.notes.join('・')})_` : '')
}

// ============================================================
// 入口
// ============================================================
const FOLLOWUP_RE = /(にして|に変えて|にかえて|へ変えて|変更して|増やして|減らして|もっと|強く|弱く|長く|短く|大きく|小さく|速く|遅く|色を|キーを|キーに|ボタンで|ボタンに|にしたい)/

export async function respond({ text, history = [], host, onStep = () => {}, onText, signal, memory = {} }) {
  const step = (icon, t, extra) => onStep({ icon, text: t, ...(extra || {}) })
  const raw = String(text || '').trim()
  const intents = detectIntents(raw)
  const has = id => intents.some(i => i.id === id)
  const top = intents.length ? intents[0].id : null
  const pasted = extractCode(raw)
  const n = normalize(raw)
  const finish = r => ({ text: r.text, chips: r.chips || [], memory, changed: !!r.changed, ran: !!r.ran })

  if (top === 'greet' && raw.length < 20) return finish({ text: 'こんにちは! Forge AI です。コードを直す・説明する・作る・質問に答える、などができます。何をしましょう?', chips: ['何ができる?', 'このコードを説明して', '触れたら死ぬブロックを作って'] })
  if (top === 'thanks' && raw.length < 30) return finish({ text: 'どういたしまして! ほかにも気になることがあれば、いつでもどうぞ。', chips: [] })
  if (top === 'help') return finish({ text: helpText(host.mode), chips: (EXAMPLES[host.mode] || EXAMPLES.studio).slice(0, 3).map(x => x + 'を作って') })
  if (top === 'undo' && host.undoLast) {
    const r = await host.undoLast()
    return finish({ text: r || '元に戻せる変更がありません。', chips: [] })
  }

  // ---- 貼り付けられたコード ----
  if (pasted) {
    if (has('fix')) {
      const r = fixAll(pasted, host.lintOpts ? host.lintOpts('pasted.lua') : {})
      const rv = r.ok ? reviewCode(r.text, { executor: host.mode === 'executor' }) : []
      const text2 = rv.some(f => f.fix) ? applyReviewFixes(r.text, rv.filter(f => f.fix)) : r.text
      const fixes = [...r.fixes, ...rv.filter(f => f.fix).map(f => ({ line: f.line, why: f.message.replace(/。.*$/, '') }))]
      return finish({ text: (fixes.length ? `**${fixes.length} か所を直しました:**\n${changeReport(fixes)}` : '自動で直せる問題は見つかりませんでした。') + '\n\n' + fence(text2) + (r.ok ? '' : `\n\n⚠️ まだ構文エラーが残っています: ${r.error && r.error.message}`), chips: ['このコードを説明して'] })
    }
    if (has('format') || has('tidy')) {
      const rep = repairSyntax(pasted)
      const m = has('tidy') ? modernize(rep.text, {}) : { text: rep.text, fixes: [] }
      return finish({ text: `整形しました${m.fixes.length ? ` (古い書き方 ${m.fixes.length} か所も修正)` : ''}:\n\n${fence(formatCode(m.text))}`, chips: [] })
    }
    if (has('review') || has('optimize')) {
      const f = checkSyntax(pasted) ? [] : reviewCode(pasted, { executor: host.mode === 'executor' })
      const syn = checkSyntax(pasted)
      return finish({ text: syn ? `構文エラーがあります: ${syn.line} 行目 ${syn.message}` : f.length ? f.slice(0, 10).map(x => `- ${x.line} 行目: ${x.message}`).join('\n') : '問題は見つかりませんでした ✅', chips: syn ? ['直して'] : [] })
    }
    return finish(await doExplain(host, step, pasted))
  }

  // ---- 直前に作ったものの手直し (「ダメージを 50 にして」「キーを F にして」) ----
  if (memory.lastGen && memory.lastGen.files && memory.lastGen.files.length && FOLLOWUP_RE.test(n) && !/(新しく|別の|べつの|もう一つ|もうひとつ)/.test(n) && (!top || top === 'generate' || top === 'optimize' || top === 'question') && raw.length < 60) {
    const merged = `${raw} ${memory.lastGen.text}`
    const r = await doGenerate(host, step, merged, memory, { replaceFiles: memory.lastGen.files })
    if (r) { memory.lastGen.text = merged; return finish(r) }
  }

  // ---- エラー文だけが送られてきた ----
  if (top === 'error' || (has('error') && !has('fix') && !has('generate'))) {
    const ex = explainError(raw, {})
    if (ex) {
      const act = host.active()
      return finish({ text: `**このエラーの意味**\n\n${ex.why}\n\n**直し方**\n${ex.fixes.map(f => '- ' + f).join('\n')}`, chips: act ? ['エラーを直して'] : [] })
    }
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
  // 「〜を作って」が主なら生成を優先 (「コメント付きで作って」など)
  const strongGen = /(作って|つくって|作成して|生成して|書いて|かいて|作りたい|つくりたい|作れる\?|作れますか)/.test(n)
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
    if (llm) return finish({ text: llm, chips: ['チェックして'] })
    const q = doQuestion(host, raw, memory)
    const ex = (EXAMPLES[host.mode] || EXAMPLES.studio)
    return finish({ text: `ごめんなさい、その内容はまだ自分では組み立てられませんでした。${q.confident ? '関係ありそうな説明を載せます。\n\n' + q.text : ''}\n\n**作れるものの例**: ${ex.slice(0, 10).join('、')}\n\n「きっかけ (触れたら・クリック・E キー・ボタン・チャット・◯秒ごと)」と「動作 (倒す・ダメージ・回復・速さ・ジャンプ・テレポート・色・消える・コイン・音・爆発)」を組み合わせて頼むと、たいてい作れます。${llmErr ? `\n\n_(高性能モードは使えませんでした: ${llmErr})_` : '設定 → AI で「高性能モード (端末内 LLM)」をオンにすると、自由な内容にも挑戦できます。'}`, chips: ex.slice(0, 3).map(x => x + 'を作って') })
  }

  // ---- 質問 ----
  const q = doQuestion(host, raw, memory)
  if (q.confident) return finish(q)
  let llmErr = ''
  const llm = await askLlm(host, step, raw, history, { onText, signal }).catch(e => { if (e && e.name === 'AbortError') throw e; llmErr = e && e.message; return null })
  if (llm) return finish({ text: llm, chips: [] })
  // 何をしたいか分からない
  const act = host.active()
  const guess = []
  if (act && isLua(act.path)) guess.push('このコードを説明して', 'コードをチェックして')
  guess.push('何ができる?')
  return finish({ text: `うまく理解できませんでした。${q.chips.length ? 'もしかして、これについてですか?' : ''}\n\n例えば次のように頼んでください:\n- 「説明して」「直して」「整形して」「チェックして」(開いているファイルに対して)\n- 「触れたら死ぬブロックを作って」「E キーでドアが開く」\n- 「RemoteEvent の使い方は?」「TweenService とは」${llmErr ? `\n\n_(高性能モードは使えませんでした: ${llmErr})_` : ''}`, chips: [...q.chips, ...guess].slice(0, 4) })
}

export { tokens }
