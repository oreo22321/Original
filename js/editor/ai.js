// AI 機能 (Claude API) — インライン候補・チャット
// API キーはこの端末のブラウザ (localStorage) にのみ保存され、Anthropic の API にだけ送信されます。
let cached = { key: null, client: null, Anthropic: null }

async function getClient(apiKey) {
  if (!apiKey) throw new Error('設定で Claude の API キーを入力してください')
  if (cached.key !== apiKey) {
    const { Anthropic } = await import('../../vendor/anthropic.js')
    cached = { key: apiKey, client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 }), Anthropic }
  }
  return cached
}

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (標準・高性能)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (速い)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (最速・低コスト)' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2 (最上位)' },
]

const LANG_NAMES = { luau: 'Luau (Roblox)', lua: 'Lua', python: 'Python', javascript: 'JavaScript', json: 'JSON', html: 'HTML', css: 'CSS', markdown: 'Markdown', text: 'plain text' }

const INLINE_SYSTEM = `You are the inline code-completion engine of ForgeCode, a code editor used on phones and tablets.
You receive the code before and after the cursor. Reply with ONLY the exact text to insert at the cursor:
- no explanations, no markdown code fences, no repetition of code that is already before or after the cursor
- usually finish the current line or the current small block (at most about 8 lines)
- match the existing indentation, naming style and language of comments
- for Roblox Luau prefer modern APIs (task.wait, task.spawn, game:GetService, :Connect)
If nothing useful can be inserted, reply with an empty message.`

const CHAT_SYSTEM = `You are the coding assistant built into ForgeCode, a mobile/tablet code editor for Luau (Roblox), Lua and Python.
Answer in Japanese unless the user writes in another language. Keep answers practical and concise; beginners use this app.
When you show code, put it in fenced code blocks with a language tag (\`\`\`lua, \`\`\`python ...). When fixing code, show the full corrected snippet.
For Roblox, prefer current APIs (task.wait over wait, GetService, :Connect, Instance properties set before Parent).`

function friendlyError(e, Anthropic) {
  if (!Anthropic) return e && e.message ? e.message : String(e)
  if (e instanceof Anthropic.APIUserAbortError) return null
  if (e instanceof Anthropic.AuthenticationError) return 'API キーが正しくありません (設定 → AI で確認してください)'
  if (e instanceof Anthropic.PermissionDeniedError) return 'この API キーではこのモデルを使えません'
  if (e instanceof Anthropic.NotFoundError) return 'モデルが見つかりません (設定 → AI でモデルを変更してください)'
  if (e instanceof Anthropic.RateLimitError) return '利用制限に達しました。少し待ってから再度お試しください'
  if (e instanceof Anthropic.BadRequestError) return 'リクエストが不正です: ' + e.message
  if (e instanceof Anthropic.APIConnectionError) return 'ネットワークに接続できません'
  if (e instanceof Anthropic.APIError) return `API エラー (${e.status}): ${e.message}`
  return e && e.message ? e.message : String(e)
}

function stripFences(text) {
  const m = /^\s*```[\w-]*\n([\s\S]*?)\n?```\s*$/.exec(text)
  return m ? m[1] : text
}

// インライン候補: カーソル位置に挿入するテキストを返す
export async function aiInline({ apiKey, model, before, after, lang, filename, signal }) {
  const { client, Anthropic } = await getClient(apiKey)
  try {
    const resp = await client.beta.messages.create({
      model,
      max_tokens: 512,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: INLINE_SYSTEM,
      messages: [{
        role: 'user',
        content: `File: ${filename} (${LANG_NAMES[lang] || lang})\n<code_before_cursor>\n${before}</code_before_cursor>\n<code_after_cursor>\n${after}\n</code_after_cursor>\nReply with only the text to insert at the cursor.`,
      }],
    }, { signal })
    if (resp.stop_reason === 'refusal') return ''
    let text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('')
    text = stripFences(text)
    // 直前と重複する部分を取り除く
    const lastLine = before.split('\n').pop()
    if (lastLine.trim() && text.startsWith(lastLine)) text = text.slice(lastLine.length)
    return text.replace(/\s+$/, m => (m.includes('\n') ? '' : m))
  } catch (e) {
    const msg = friendlyError(e, Anthropic)
    if (msg === null) return ''
    throw new Error(msg)
  }
}

// チャット (ストリーミング)。onText に差分テキストが届きます
export async function aiChat({ apiKey, model, messages, context, onText, signal }) {
  const { client, Anthropic } = await getClient(apiKey)
  const system = context ? `${CHAT_SYSTEM}\n\n<current_file>\n${context}\n</current_file>` : CHAT_SYSTEM
  try {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system,
      messages,
    }, { signal })
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onText(event.delta.text)
    }
    const final = await stream.finalMessage()
    if (final.stop_reason === 'refusal') onText('\n\n(このリクエストには回答できませんでした)')
    if (final.stop_reason === 'max_tokens') onText('\n\n(回答が長すぎたため途中で終了しました)')
    return final
  } catch (e) {
    const msg = friendlyError(e, Anthropic)
    if (msg === null) return null
    throw new Error(msg)
  }
}

// エディタ用: インライン候補プロバイダ
export function makeAiProvider(getSettings, getFile) {
  let ctrl = null
  return async (state, pos) => {
    const s = getSettings()
    if (!s.aiKey) return ''
    if (ctrl) ctrl.abort()
    ctrl = new AbortController()
    const file = getFile()
    const before = state.doc.sliceString(Math.max(0, pos - 6000), pos)
    const after = state.doc.sliceString(pos, Math.min(state.doc.length, pos + 2000))
    return aiInline({ apiKey: s.aiKey, model: s.aiModel, before, after, lang: file.lang, filename: file.name, signal: ctrl.signal })
  }
}
