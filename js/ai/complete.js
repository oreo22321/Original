// Forge AI: 続きの提案 (エディタのゴーストテキスト)
// ・統計モデル (n-gram): 内蔵のサンプルコードと、開いているプロジェクトのコードから「次に来やすいトークン」を学習し、行の続きを提案
//   (プロジェクトのコードを優先するので、自分の書き方・変数名を覚えて提案します)
// ・コメントからコード: 「-- 触れたら死ぬ」のようなコメントの次の行で頼むと、コードを組み立てて提案
import { lightTokens } from '../editor/blocks.js'
import { KNOWLEDGE } from './knowledge.js'
import { generateCode } from './generate.js'
import { detectIntents, concepts } from './text.js'

const NL = '\n'
const MAX_STR = 40

function toTokens(text) {
  const out = []
  let last = 0
  for (const t of lightTokens(text)) {
    if (text.slice(last, t.s).includes('\n') && out.length && out[out.length - 1] !== NL) out.push(NL)
    let v = text.slice(t.s, t.e)
    if (t.t === 'str' && v.length > MAX_STR) v = null
    out.push(v)
    last = t.e
  }
  return out
}

class Ngram {
  constructor() { this.maps = [null, new Map(), new Map(), new Map(), new Map()]; this.size = 0 }
  train(text, weight = 1) {
    const toks = toTokens(text)
    for (let i = 1; i < toks.length; i++) {
      const next = toks[i]
      if (next === null) continue
      for (let k = 1; k <= 4 && i - k >= 0; k++) {
        const ctx = toks.slice(i - k, i)
        if (ctx.includes(null)) break
        const key = ctx.join('\u0001')
        let m = this.maps[k].get(key)
        if (!m) { m = new Map(); this.maps[k].set(key, m) }
        m.set(next, (m.get(next) || 0) + weight)
      }
    }
    this.size += toks.length
  }
  // ctx: 直前のトークン。prefix: 書きかけの単語。文脈の長さ k を指定して、その長さで一致したものだけ
  nextAt(ctx, k, prefix = '') {
    if (ctx.length < k) return null
    const m = this.maps[k].get(ctx.slice(-k).join('\u0001'))
    if (!m) return null
    let total = 0, best = null, bestN = 0
    for (const [tok, n] of m) {
      if (prefix && !(tok.startsWith(prefix) && tok !== prefix)) continue
      total += n
      if (n > bestN) { best = tok; bestN = n }
    }
    return best ? { tok: best, n: bestN, total, k } : null
  }
}

let base = null
let project = null
let projectKey = ''
function baseModel() {
  if (base) return base
  base = new Ngram()
  for (const e of KNOWLEDGE) if (e.c) base.train(e.c)
  // よく使う形を少し足す
  base.train(`local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local TweenService = game:GetService("TweenService")
local player = Players.LocalPlayer
local character = player.Character or player.CharacterAdded:Wait()
local humanoid = character:WaitForChild("Humanoid")
local root = character:WaitForChild("HumanoidRootPart")
for _, child in workspace:GetChildren() do
end
for i, v in pairs(t) do
end
for i = 1, 10 do
end
script.Parent.Touched:Connect(function(hit)
end)
`, 2)
  return base
}
// プロジェクトのコードを学習 (内容が変わったときだけ作り直す)
export function setProjectCorpus(texts) {
  const key = texts.map(t => t.length).join(',') + ':' + texts.reduce((a, t) => a + (t.charCodeAt(t.length >> 1) || 0), 0)
  if (key === projectKey) return
  projectKey = key
  const m = new Ngram()
  let budget = 400000
  for (const t of texts) { if (budget <= 0) break; m.train(t.slice(0, budget), 1); budget -= t.length }
  project = m
}

const WORDY = /^[A-Za-z_0-9"'`[]/
function join(prev, toks) {
  let s = ''
  let p = prev
  for (const t of toks) {
    const noSpaceBefore = /^[)\]},.:;]/.test(t) || t === '(' && /[\w\])"']$/.test(p) || t === '[' && /[\w\])]$/.test(p)
    const noSpaceAfterPrev = /[([{.:#]$/.test(p) || p === '' || /\s$/.test(p) || (p === '-' && false)
    if (s === '' && /\s$/.test(prev)) s += ''
    else if (!noSpaceBefore && !noSpaceAfterPrev && (WORDY.test(t) || /^(=|==|~=|<=|>=|<|>|\+|-|\*|\/|\.\.|and|or|not|then|do|\{)$/.test(t) || /^(=|==|~=|<=|>=|<|>|\+|-|\*|\/|\.\.|,|and|or|not|then|do|in|return|local|function)$/.test(p))) s += ' '
    s += t
    p = t
  }
  return s
}

// 行の続きを提案 (before: カーソルより前のテキスト)
export function completeLine(before, { maxTokens = 12 } = {}) {
  const tail = before.slice(-600)
  const lineStart = tail.lastIndexOf('\n') + 1
  const line = tail.slice(lineStart)
  if (!line.trim() || /--/.test(line)) return ''
  // 文字列の途中は提案しない
  if (((line.match(/"/g) || []).length % 2) || ((line.match(/'/g) || []).length % 2)) return ''
  let toks = toTokens(tail).filter(t => t !== null)
  const partialM = /[A-Za-z_]\w*$/.exec(line)
  let prefix = ''
  if (partialM) { prefix = partialM[0]; toks = toks.slice(0, -1) }
  const models = [project, baseModel()].filter(Boolean)
  const out = []
  let firstSuffix = ''
  for (let i = 0; i < maxTokens; i++) {
    const ctx = toks.concat(out)
    // 長い文脈で一致したものを優先 (短い文脈の当てずっぽうより確か)
    let best = null
    for (let k = 4; k >= 1 && !best; k--) {
      for (const m of models) {
        const r = m.nextAt(ctx, k, i === 0 ? prefix : '')
        if (!r) continue
        const ratio = r.n / r.total
        if (ratio < 0.5 || r.n < (k >= 3 ? 1 : k === 2 ? 2 : 3)) continue
        const conf = ratio * (m === project ? 1.15 : 1)
        if (!best || conf > best.conf) best = { ...r, conf }
      }
    }
    if (!best || best.tok === NL) break
    // 条件の行 (if / while) に代入の '=' は来ない
    if (best.tok === '=' && /^\s*(if|elseif|while|until)\b/.test(line)) break
    if (i === 0 && prefix) { firstSuffix = best.tok.slice(prefix.length); out.push(best.tok); continue }
    out.push(best.tok)
    if (/^(then|do)$/.test(best.tok) || (best.tok === ')' && /function\s*\(/.test(line + join('', out)))) break
  }
  if (!out.length) return ''
  const rest = prefix ? out.slice(1) : out
  const text = firstSuffix + join(prefix ? prefix : line, rest)
  if (!text.trim() || text.length > 120) return ''
  // 括弧が閉じすぎていたら切る
  const opens = (line.match(/[([{]/g) || []).length - (line.match(/[)\]}]/g) || []).length
  let depth = opens, cut = text.length
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) { depth--; if (depth < 0) { cut = i; break } }
  }
  return text.slice(0, cut)
}

// コメントからコード: カーソルが空の行で、直前の行が「作ってほしいもの」のコメントなら、コードを組み立てる
export function codeFromComment(before, mode = 'studio') {
  const lines = before.split('\n')
  const cur = lines[lines.length - 1]
  if (cur.trim()) return null
  let i = lines.length - 2
  while (i >= 0 && !lines[i].trim()) i--
  if (i < 0) return null
  const m = /^\s*--+\s*(.+)$/.exec(lines[i])
  if (!m) return null
  const req = m[1].trim()
  if (req.length < 4) return null
  const ints = detectIntents(req)
  const cs = concepts(req)
  if (!cs.size || (ints.length && !['generate', 'question'].includes(ints[0].id) && !cs.size)) return null
  const gen = generateCode(req, { mode })
  if (!gen || gen.files.length !== 1 || gen.files[0].error) return null
  // 先頭の説明コメント 2 行 (題名と置き場所) は省く
  const code = gen.files[0].code.split('\n').filter((l, k) => !(k < 2 && l.startsWith('--'))).join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
  const ind = /^[ \t]*/.exec(cur)[0]
  return { code: code.split('\n').map(l => (l ? ind + l : l)).join('\n').slice(ind.length), title: gen.title }
}
