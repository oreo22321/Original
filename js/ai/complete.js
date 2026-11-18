// Forge AI: 続きの提案 (エディタのゴーストテキスト)
// ・統計モデル (n-gram): 内蔵のサンプルコードと、開いているプロジェクトのコードから「次に来やすいトークン」を学習し、行の続きを提案
//   (プロジェクトのコードを優先するので、自分の書き方・変数名を覚えて提案します)
// ・コメントからコード: 「# 1 から 100 まで足す」のようなコメントの次の行で頼むと、コードを組み立てて提案
import { pyTokens } from './pycode.js'

// 知識ベース・コード生成は大きいので、起動時には読み込まない (はじめて使うとき・手が空いたときに読み込む)
let heavy = null
function loadHeavy() {
  if (!heavy) {
    heavy = Promise.all([import('./knowledge.js'), import('./generate.js'), import('./text.js')])
      .then(([k, g, t]) => ({ KNOWLEDGE: k.KNOWLEDGE, generateCode: g.generateCode, detectIntents: t.detectIntents, concepts: t.concepts }))
      .catch(e => { heavy = null; throw e })
  }
  return heavy
}

// 手が空いたときまで待つ (重い学習を少しずつ進めて、入力を止めないため)
const idle = () => new Promise(r => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 400 }) : setTimeout(r, 16)))
const SLICE_MS = 8
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const NL = '\n'
const MAX_STR = 40

function toTokens(text) {
  const out = []
  let last = 0
  for (const t of pyTokens(text)) {
    if (t.t === 'nl') { if (out.length && out[out.length - 1] !== NL) out.push(NL); last = t.e; continue }
    if (text.slice(last, t.s).includes('\n') && out.length && out[out.length - 1] !== NL) out.push(NL)
    let v = text.slice(t.s, t.e)
    if (t.t === 'str' && v.length > MAX_STR) v = null
    out.push(v)
    last = t.e
  }
  return out
}

const SEP = '\u0001'
class Ngram {
  constructor() { this.maps = [null, new Map(), new Map(), new Map(), new Map()]; this.size = 0 }
  // toks の from〜to 番目を学習 (文脈のキーは配列を作らず、後ろから 1 トークンずつ伸ばして作る)
  trainTokens(toks, weight = 1, from = 1, to = toks.length) {
    const maps = this.maps
    for (let i = Math.max(1, from); i < to; i++) {
      const next = toks[i]
      if (next === null) continue
      let key = ''
      for (let k = 1; k <= 4 && i - k >= 0; k++) {
        const t = toks[i - k]
        if (t === null) break
        key = k === 1 ? t : t + SEP + key
        let m = maps[k].get(key)
        if (!m) { if (weight < 0) continue; m = new Map(); maps[k].set(key, m) }
        const n = (m.get(next) || 0) + weight
        if (n > 0) m.set(next, n)
        else { m.delete(next); if (!m.size) maps[k].delete(key) }
      }
    }
  }
  train(text, weight = 1) {
    const toks = toTokens(text)
    this.trainTokens(toks, weight)
    this.size += toks.length
  }
  // ctx: 直前のトークン。prefix: 書きかけの単語。文脈の長さ k を指定して、その長さで一致したものだけ
  nextAt(ctx, k, prefix = '') {
    if (ctx.length < k) return null
    const m = this.maps[k].get(ctx.slice(-k).join(SEP))
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

// 少しずつ学習する (SLICE_MS ごとに手を離す)。cancelled() が true になったら途中でやめる
async function trainSliced(model, text, weight, cancelled) {
  const toks = toTokens(text)
  if (cancelled()) return false
  await idle()
  const STEP = 400
  let t0 = now()
  for (let i = 1; i < toks.length; i += STEP) {
    model.trainTokens(toks, weight, i, Math.min(toks.length, i + STEP))
    if (now() - t0 > SLICE_MS) {
      await idle()
      if (cancelled()) return false
      t0 = now()
    }
  }
  model.size += toks.length
  return true
}

let base = null
let baseLoading = null
let project = null
// 内蔵サンプルからの学習 (はじめて使うときに 1 回だけ)
function ensureBase() {
  if (base) return Promise.resolve(base)
  if (!baseLoading) {
    baseLoading = loadHeavy().then(async ({ KNOWLEDGE }) => {
      const m = new Ngram()
      for (const e of KNOWLEDGE) if (e.c) { m.train(e.c); await idle() }
      m.train(COMMON, 2)
      base = m
      return m
    }).catch(e => { baseLoading = null; throw e })
  }
  return baseLoading
}
// AI の候補を出す前に呼ぶ (読み込み済みならすぐ終わる)
export function warmComplete() { return ensureBase().then(() => {}, () => {}) }

// よく使う形
const COMMON = `import random
import math
import time
import json
import csv
from collections import Counter, defaultdict
from pathlib import Path
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
for i in range(10):
for i, item in enumerate(items):
for key, value in data.items():
with open("data.txt", encoding="utf-8") as f:
with open("out.txt", "w", encoding="utf-8") as f:
if __name__ == "__main__":
    main()
def __init__(self):
def __str__(self):
    return f"{self.name}"
text = input("> ")
n = int(input("数: "))
print(f"{name}: {value}")
except ValueError:
except Exception as e:
    print("エラー:", e)
`

// プロジェクトのコードを学習 (変わったファイルだけ学習し直す。少しずつ進めるので入力は止まらない)
// files: [{ path, text }] (文字列の配列も可)
let trainedFiles = new Map()   // path → 学習済みの内容
let pendingFiles = null
let corpusRun = null
const CORPUS_BUDGET = 400000
export function setProjectCorpus(files) {
  pendingFiles = files.map((f, i) => (typeof f === 'string' ? { path: '#' + i, text: f } : f))
  if (!corpusRun) corpusRun = runCorpus().finally(() => { corpusRun = null })
  return corpusRun
}
async function runCorpus() {
  while (pendingFiles) {
    const list = pendingFiles
    pendingFiles = null
    const want = new Map()
    let budget = CORPUS_BUDGET
    for (const f of list) {
      if (budget <= 0) break
      const t = String(f.text || '').slice(0, budget)
      budget -= t.length
      want.set(f.path, t)
    }
    let changed = 0, total = 0
    for (const [p, t] of want) { total += t.length; const old = trainedFiles.get(p); if (old !== t) changed += t.length + (old ? old.length : 0) }
    for (const [p, t] of trainedFiles) if (!want.has(p)) changed += t.length
    if (!changed) continue
    // 新しい内容が来たら、作り直しは途中でやめて新しい方から (作り直しは別のモデルなので、やめても壊れない)
    const stale = () => pendingFiles !== null
    if (!project || changed >= total) {
      const m = new Ngram()
      let ok = true
      for (const t of want.values()) if (!(await trainSliced(m, t, 1, stale))) { ok = false; break }
      if (!ok) continue
      project = m
    } else {
      // 変わったファイルだけ: 古い内容を引いて、新しい内容を足す (途中でやめると数が合わなくなるので、最後まで)
      const never = () => false
      for (const [p, old] of trainedFiles) {
        const t = want.get(p)
        if (t === old) continue
        await trainSliced(project, old, -1, never)
        if (t !== undefined) await trainSliced(project, t, 1, never)
      }
      for (const [p, t] of want) if (!trainedFiles.has(p)) await trainSliced(project, t, 1, never)
    }
    trainedFiles = want
  }
}

const WORDY = /^[A-Za-z_0-9"'[\u00c0-\uffff]|^[rbfu]{1,2}["']/i
function join(prev, toks) {
  let s = ''
  let p = prev
  for (const t of toks) {
    const noSpaceBefore = /^[)\]},.:;]/.test(t) || t === '(' && /[\w\])"']$/.test(p) || t === '[' && /[\w\])]$/.test(p)
    const noSpaceAfterPrev = /[([{.@]$/.test(p) || p === '' || /\s$/.test(p) || p === '**' || (p === '=' && /[(,]\s*\w+$/.test(s.slice(0, -1)))
    const BIN = /^(=|==|!=|<=|>=|<|>|\+|-|\*|\/|\/\/|%|\+=|-=|\*=|\/=|->|:=|and|or|not|in|is|if|else|for|as|import|from|lambda)$/
    if (s === '' && /\s$/.test(prev)) s += ''
    else if (!noSpaceBefore && !noSpaceAfterPrev && (WORDY.test(t) || BIN.test(t) || BIN.test(p) || p === ',' || p === ':')) s += ' '
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
  if (!line.trim() || /#/.test(line.replace(/(["'])(?:(?!\1).)*\1/g, ''))) return ''
  // 文字列の途中は提案しない
  if (((line.match(/"/g) || []).length % 2) || ((line.match(/'/g) || []).length % 2)) return ''
  let toks = toTokens(tail).filter(t => t !== null)
  const partialM = /[A-Za-z_]\w*$/.exec(line)
  let prefix = ''
  if (partialM) { prefix = partialM[0]; toks = toks.slice(0, -1) }
  const models = [project, base].filter(Boolean)
  if (!base) ensureBase().catch(() => {})
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
    if (best.tok === '=' && /^\s*(if|elif|while)\b/.test(line)) break
    if (i === 0 && prefix) { firstSuffix = best.tok.slice(prefix.length); out.push(best.tok); continue }
    out.push(best.tok)
    // ブロックの見出しは : で終わり
    if (best.tok === ':' && /^\s*(if|elif|else|for|while|def|class|with|try|except|finally)\b/.test(line + join('', out))) break
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
export async function codeFromComment(before) {
  const lines = before.split('\n')
  const cur = lines[lines.length - 1]
  if (cur.trim()) return null
  let i = lines.length - 2
  while (i >= 0 && !lines[i].trim()) i--
  if (i < 0) return null
  const m = /^\s*#+\s*(.+)$/.exec(lines[i])
  if (!m) return null
  const req = m[1].trim()
  if (req.length < 4) return null
  const { detectIntents, concepts, generateCode } = await loadHeavy()
  const ints = detectIntents(req)
  const cs = concepts(req)
  if (!cs.size || (ints.length && !['generate', 'question'].includes(ints[0].id) && !cs.size)) return null
  const gen = generateCode(req)
  if (!gen || gen.files.length !== 1 || gen.files[0].error) return null
  // 先頭の題名のコメントは省く (頼んだコメントがあるので)
  const code = gen.files[0].code.split('\n').filter((l, k) => !(k === 0 && l.startsWith('#'))).join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
  const ind = /^[ \t]*/.exec(cur)[0]
  return { code: code.split('\n').map(l => (l ? ind + l : l)).join('\n').slice(ind.length), title: gen.title }
}
