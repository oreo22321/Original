// Claude との接続 (AI 機能の土台)
// ・claude.ai で開いたとき (ForgeCode の Claude 版): 見ている人の Claude アカウントで動きます。API キーは要りません
//   (claude.ai の Artifact 実行環境の「sample」機能を使います。最初の 1 回だけ、使ってよいかの確認が出ます)
// ・それ以外: 設定に API キーがあれば Anthropic の API を直接使います (任意)
import { getSettings, emit } from './store.js'

// claude.ai の画面内で開かれているか (window.claude はページのスクリプトより先に用意されます)
export const IN_CLAUDE = typeof window !== 'undefined' && !!(window.claude && typeof window.claude.use === 'function')

// GitHub Pages 版から開く Claude 版 (claude.ai 上の ForgeCode)
export const CLAUDE_APP_URL = 'https://claude.ai/artifact/A8AyqZNprnumvcP85pG6mJ'

let sample = null          // claude.use('sample') の関数
let limits = null          // { tools, images, ... }
let state = IN_CLAUDE ? 'checking' : 'none' // checking | ready | none | denied
let denyReason = ''
let toolsOff = false

export function initClaude() {
  if (!IN_CLAUDE) return Promise.resolve(null)
  let p
  try { p = window.claude.use('sample') } catch { p = Promise.resolve(null) }
  return Promise.resolve(p).then(async s => {
    sample = s || null
    if (sample) { try { limits = await sample.limits() } catch { limits = null } }
    state = sample ? 'ready' : 'none'
    emit('ai', status())
    return sample
  }, () => { state = 'none'; emit('ai', status()); return null })
}

// いま使える接続: 'claude' (claude.ai・キー不要) | 'key' (API キー) | null
export function provider() {
  if (sample && state === 'ready') return 'claude'
  if (getSettings().aiKey) return 'key'
  return null
}
export const aiReady = () => !!provider()
export const canUseTools = () => provider() === 'key' || (!toolsOff && (!!(limits && limits.tools) || (provider() === 'claude' && !limits)))
export const canSendImages = () => provider() === 'key' || !!(limits && limits.images)
export function status() {
  return { provider: provider(), state, inClaude: IN_CLAUDE, reason: denyReason, tools: canUseTools(), images: canSendImages() }
}

// ============================================================
// エラー (日本語にそろえる)
// ============================================================
export class AiError extends Error {
  constructor(code, message, text) { super(message); this.code = code; this.text = text || '' }
}
const MESSAGES = {
  not_granted: 'Claude の利用が許可されていません。ページを開き直すと、もう一度確認が出ます',
  sampling_disabled: 'このアカウントでは Claude を使えません',
  not_declared: 'この画面では Claude を使えません',
  capability_disabled: 'この画面では Claude を使えません',
  capability_removed: 'Claude アプリを最新版にしてください',
  rate_limited: '利用上限に達したか、短い時間に送りすぎました。少し待ってからもう一度お試しください',
  session_expired: 'claude.ai にもう一度ログインしてください',
  refused: 'この内容には回答できませんでした。頼み方を変えてみてください',
  empty_completion: '回答が空でした。もう少し具体的に頼んでみてください',
  prompt_too_large: '送る内容が大きすぎます。範囲を選ぶか、ファイルを分けてください',
  invalid_json: 'AI の返答を読み取れませんでした。もう一度お試しください',
  tools_unavailable: 'この画面では Claude がファイルを直接操作できません。もう一度送ると、コードを表示する形で答えます',
  images_unavailable: 'この画面では画像を送れません',
  image_rejected: 'この画像は送れません (JPEG / PNG / WebP / GIF を選んでください)',
  upstream_error: '通信エラーが発生しました。もう一度お試しください',
  no_provider: 'AI が使えません。Claude 版で開くか、設定で API キーを入力してください',
}
function fromSampleError(e) {
  const code = e && typeof e.code === 'string' ? e.code : 'upstream_error'
  // この画面ではツール (ファイル操作) を使えない: 次からはツールなしで頼む
  if (code === 'tools_unavailable') { limits = { ...(limits || {}), tools: undefined }; toolsOff = true; emit('ai', status()) }
  if (code === 'images_unavailable') { limits = { ...(limits || {}), images: undefined }; emit('ai', status()) }
  if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' || code === 'capability_disabled') {
    state = 'denied'
    denyReason = MESSAGES[code]
    emit('ai', status())
  }
  return new AiError(code, MESSAGES[code] || MESSAGES.upstream_error, e && e.text)
}

// ============================================================
// API キーで使う場合 (Anthropic SDK)
// ============================================================
let keyClient = { key: null, client: null, Anthropic: null }
async function getClient() {
  const apiKey = getSettings().aiKey
  if (!apiKey) throw new AiError('no_provider', MESSAGES.no_provider)
  if (keyClient.key !== apiKey) {
    const { Anthropic } = await import('../../vendor/anthropic.js')
    keyClient = { key: apiKey, client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 }), Anthropic }
  }
  return keyClient
}
function keyModel(tier) {
  const s = getSettings()
  if (tier === 'quick') return 'claude-haiku-5-5'
  if (tier === 'complex') return /fable/.test(s.aiModel) ? s.aiModel : 'claude-opus-5-5'
  return s.aiModel || 'claude-opus-5-5'
}
function keyError(e, Anthropic) {
  if (e instanceof AiError) return e
  if (!Anthropic) return new AiError('upstream_error', e && e.message ? e.message : String(e))
  if (e instanceof Anthropic.APIUserAbortError) return new AiError('cancelled', '')
  if (e instanceof Anthropic.AuthenticationError) return new AiError('not_granted', 'API キーが正しくありません (設定 → AI で確認してください)')
  if (e instanceof Anthropic.PermissionDeniedError) return new AiError('not_granted', 'この API キーではこのモデルを使えません')
  if (e instanceof Anthropic.NotFoundError) return new AiError('upstream_error', 'モデルが見つかりません (設定 → AI でモデルを変更してください)')
  if (e instanceof Anthropic.RateLimitError) return new AiError('rate_limited', MESSAGES.rate_limited)
  if (e instanceof Anthropic.BadRequestError) return new AiError('invalid_request', 'リクエストが不正です: ' + e.message)
  if (e instanceof Anthropic.APIConnectionError) return new AiError('upstream_error', 'ネットワークに接続できません')
  if (e instanceof Anthropic.APIError) return new AiError('upstream_error', `API エラー (${e.status}): ${e.message}`)
  return new AiError('upstream_error', e && e.message ? e.message : String(e))
}
const blobToBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
  r.onerror = () => reject(r.error)
  r.readAsDataURL(blob)
})

async function askWithKey(input, opts) {
  const { client, Anthropic } = await getClient()
  const turns = typeof input === 'string' ? [{ role: 'user', content: input }] : input.map(t => ({ role: t.role, content: t.content }))
  // 同じ役割が続く場合はまとめる (API は交互でないと受け付けないため)
  const messages = []
  for (const t of turns) {
    const last = messages[messages.length - 1]
    if (last && last.role === t.role) last.content += '\n\n' + t.content
    else messages.push({ ...t })
  }
  if (opts.images && opts.images.length) {
    const last = messages[messages.length - 1]
    const blocks = []
    for (const img of opts.images) blocks.push({ type: 'image', source: { type: 'base64', media_type: img.type || 'image/png', data: await blobToBase64(img) } })
    blocks.push({ type: 'text', text: last.content })
    last.content = blocks
  }
  const tools = opts.tools || []
  const apiTools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema || { type: 'object', properties: {} } }))
  let text = ''
  const push = delta => { if (!delta) return; text += delta; if (opts.onText) opts.onText(text) }
  try {
    for (let round = 0; round < 12; round++) {
      const params = {
        model: keyModel(opts.tier),
        max_tokens: opts.maxTokens || (opts.tier === 'quick' ? 1024 : 32000),
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages,
      }
      if (opts.tier !== 'quick') params.output_config = { effort: opts.tier === 'complex' ? 'high' : 'medium' }
      // 最後の回は答えを書かせる
      if (apiTools.length && round < 11) params.tools = apiTools
      if (round > 0 && text && !text.endsWith('\n\n')) push('\n\n')
      const stream = client.beta.messages.stream(params, { signal: opts.signal })
      for await (const ev of stream) {
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') push(ev.delta.text)
      }
      const msg = await stream.finalMessage()
      if (msg.stop_reason === 'refusal') throw new AiError('refused', MESSAGES.refused)
      if (msg.stop_reason !== 'tool_use') return { text, truncated: msg.stop_reason === 'max_tokens' }
      messages.push({ role: 'assistant', content: msg.content })
      const results = []
      for (const b of msg.content) {
        if (b.type !== 'tool_use') continue
        const tool = tools.find(t => t.name === b.name)
        let out, isError = false
        try {
          if (!tool) throw new Error('unknown tool ' + b.name)
          out = await tool.execute(b.input || {}, { signal: opts.signal || new AbortController().signal })
        } catch (e) { out = 'Error: ' + (e && e.message ? e.message : String(e)); isError = true }
        results.push({ type: 'tool_result', tool_use_id: b.id, content: typeof out === 'string' ? out : JSON.stringify(out), is_error: isError })
      }
      messages.push({ role: 'user', content: results })
    }
    return { text, truncated: true }
  } catch (e) {
    const err = keyError(e, Anthropic)
    err.text = text
    throw err
  }
}

// ============================================================
// 共通の呼び出し
// ============================================================
// input: 文字列、または [{role:'user'|'assistant', content}] (user で始まり user で終わる)
// opts: { onText(text 全体), signal, tier: 'quick'|'default'|'complex', tools, images, cache, maxTokens }
export async function ask(input, opts = {}) {
  const p = provider()
  if (!p) throw new AiError('no_provider', MESSAGES.no_provider)
  if (p === 'key') return askWithKey(input, opts)
  const o = {}
  if (opts.onText) o.onText = ({ text }) => opts.onText(text)
  if (opts.signal) o.signal = opts.signal
  if (opts.tier) o.modelTier = opts.tier
  if (opts.tools && opts.tools.length) o.tools = opts.tools
  else if (opts.cache !== undefined) o.cache = opts.cache
  if (opts.images && opts.images.length) o.images = opts.images
  try {
    const r = await sample(input, o)
    return { text: r.text, truncated: !!r.truncated, tier: r.modelTierApplied }
  } catch (e) {
    throw fromSampleError(e)
  }
}

// JSON で答えてもらう (寛容に読み取る)
export function parseJsonLoose(text) {
  const t = String(text || '').trim()
  try { return JSON.parse(t) } catch {}
  const fence = /```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(t)
  if (fence) { try { return JSON.parse(fence[1]) } catch {} }
  const a = t.search(/[[{]/), b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'))
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)) } catch {} }
  throw new AiError('invalid_json', MESSAGES.invalid_json, t)
}
export async function askJson(input, opts = {}) {
  const p = provider()
  if (p === 'claude' && !opts.tools && typeof sample.json === 'function') {
    const o = {}
    if (opts.signal) o.signal = opts.signal
    if (opts.tier) o.modelTier = opts.tier
    if (opts.cache !== undefined) o.cache = opts.cache
    if (opts.onText) o.onText = ({ text }) => opts.onText(text)
    try { return await sample.json(input, o) } catch (e) { throw fromSampleError(e) }
  }
  const r = await ask(input, opts)
  return parseJsonLoose(r.text)
}

export const errorMessage = e => (e && e.code === 'cancelled' ? '' : e && e.message ? e.message : String(e))
