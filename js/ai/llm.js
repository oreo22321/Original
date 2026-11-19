// Forge AI: 高性能モード (端末内 LLM・任意)
// ・WebGPU で動く言語モデル (Qwen2.5-Coder) を、初回だけダウンロードして端末内で動かします。会話の内容は外に送りません
// ・ダウンロードしたモデルはブラウザのキャッシュに残り、2 回目からはオフラインでも読み込めます
// ・モデルの実行コード (wasm) は改ざんを防ぐため、ハッシュ (SRI) を確かめてから使います
//   (vendor/web-llm.js を更新したときは、tools の手順でハッシュも更新してください)

const HF = 'https://huggingface.co/mlc-ai/'
const LIB = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_86/base/'

export const LLM_MODELS = [
  {
    key: 'small', label: '軽量 (0.5B)', desc: 'スマホ向け。ダウンロード約 300 MB・メモリ約 1 GB', vram: 950,
    f16: { id: 'Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC', lib: 'Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm', sri: 'sha256-phgHSzD30CKreIbQz1e+Ku/aw0KQHUO+5OGREOG0tzk=' },
    f32: { id: 'Qwen2.5-Coder-0.5B-Instruct-q4f32_1-MLC', lib: 'Qwen2-0.5B-Instruct-q4f32_1_cs1k-webgpu.wasm', sri: 'sha256-JDziq9qNF1ixnUTa2lgkCk9d2wdddKsRo40U0jvQ91M=' },
  },
  {
    key: 'medium', label: '標準 (1.5B)', desc: 'iPad・PC 向け。ダウンロード約 900 MB・メモリ約 1.7 GB', vram: 1700,
    f16: { id: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC', lib: 'Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm', sri: 'sha256-Q2Rira1AfgkU0jUP1FKlo9mD4AMdd8lAxD6jUcjNMAA=' },
    f32: { id: 'Qwen2.5-Coder-1.5B-Instruct-q4f32_1-MLC', lib: 'Qwen2-1.5B-Instruct-q4f32_1_cs1k-webgpu.wasm', sri: 'sha256-1muCqPl9NRBoF1DawFXGBQud8zJ1aMi3hg0qxh2ZBrg=' },
  },
  {
    key: 'large', label: '高性能 (3B)', desc: 'PC 向け。ダウンロード約 1.8 GB・メモリ約 2.6 GB', vram: 2600,
    f16: { id: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC', lib: 'Qwen2.5-3B-Instruct-q4f16_1_cs1k-webgpu.wasm', sri: 'sha256-b4dOQN1nkEY5u+wCiq5qBreOkzVfCImvJiT18GfIEb8=' },
    f32: { id: 'Qwen2.5-Coder-3B-Instruct-q4f32_1-MLC', lib: 'Qwen2.5-3B-Instruct-q4f32_1_cs1k-webgpu.wasm', sri: 'sha256-nDD2yRVeVchmHCNY9ANE019Yytb+ncB8A/Ayl8307Dk=' },
  },
  {
    key: 'xlarge', label: '最高性能 (7B)', desc: 'GPU のメモリが多い PC 向け。ダウンロード約 4.3 GB・メモリ約 5.1 GB', vram: 5100,
    f16: { id: 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC', lib: 'Qwen2-7B-Instruct-q4f16_1_cs1k-webgpu.wasm', sri: 'sha256-4l7lD8+O7u3i9kXKIkz5DO8LiZYQKzSzjX0Eyxp3pWo=' },
    f32: { id: 'Qwen2.5-Coder-7B-Instruct-q4f32_1-MLC', lib: 'Qwen2-7B-Instruct-q4f32_1_cs1k-webgpu.wasm', sri: 'sha256-xN/nC7M2yNV4nbcHK082Gk6yxhoLwIojtcviXl7PLSM=' },
  },
]
const modelOf = key => LLM_MODELS.find(m => m.key === key) || LLM_MODELS[0]

let support = null
let lib = null
let engine = null
let worker = null
let current = null // { key, id }
let state = 'off'  // off | loading | ready | error
let lastError = ''
let progress = { text: '', value: 0 }
let loading = null
const listeners = new Set()
const notify = () => { for (const f of listeners) { try { f(status()) } catch {} } }
export const onLlmChange = f => { listeners.add(f); return () => listeners.delete(f) }

export function status() {
  return { state, model: current && current.key, error: lastError, progress, support }
}
export const llmReady = () => state === 'ready' && !!engine

// 端末が対応しているか (WebGPU)
export async function checkSupport() {
  if (support) return support
  const s = { ok: false, f16: false, reason: '' }
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu) { s.reason = 'このブラウザは WebGPU に対応していません (iPhone / iPad は iOS 26 以降の Safari、PC は Chrome / Edge の最新版で使えます)'; return (support = s) }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) { s.reason = 'GPU を使えませんでした (省電力モードや、ブラウザの設定で無効になっている可能性があります)'; return (support = s) }
    s.ok = true
    s.f16 = adapter.features && adapter.features.has('shader-f16')
    s.maxBuffer = adapter.limits ? adapter.limits.maxBufferSize : 0
  } catch (e) { s.reason = 'GPU の確認に失敗しました: ' + (e && e.message ? e.message : e) }
  return (support = s)
}

function variant(key) {
  const m = modelOf(key)
  return (support && support.f16) ? m.f16 : m.f32
}
function appConfig(key) {
  const m = modelOf(key)
  const v = variant(key)
  return {
    useIndexedDBCache: false,
    model_list: [{
      model: HF + v.id,
      model_id: v.id,
      model_lib: LIB + v.lib,
      integrity: { model_lib: v.sri, onFailure: 'error' },
      vram_required_MB: m.vram,
      low_resource_required: key === 'small',
      overrides: { context_window_size: 4096 },
    }],
  }
}

async function loadLib() {
  if (!lib) lib = await import('../../vendor/web-llm.js')
  return lib
}

// モデルが端末に保存済みか
export async function isDownloaded(key) {
  try {
    await checkSupport()
    const L = await loadLib()
    return await L.hasModelInCache(variant(key).id, appConfig(key))
  } catch { return false }
}

// 読み込み (初回はダウンロード)
export function load(key, { onProgress } = {}) {
  if (current && current.key === key && state === 'ready') return Promise.resolve(true)
  if (loading) return loading
  loading = (async () => {
    state = 'loading'; lastError = ''; progress = { text: '準備しています…', value: 0 }; notify()
    try {
      const s = await checkSupport()
      if (!s.ok) throw new Error(s.reason)
      await unload(true)
      const L = await loadLib()
      const v = variant(key)
      const cfg = {
        appConfig: appConfig(key),
        initProgressCallback: p => {
          progress = { text: jpProgress(p.text || ''), value: typeof p.progress === 'number' ? p.progress : progress.value }
          notify()
          if (onProgress) onProgress(progress)
        },
      }
      try {
        worker = new Worker(new URL('../workers/llm-worker.js', import.meta.url), { type: 'module' })
        engine = await L.CreateWebWorkerMLCEngine(worker, v.id, cfg)
      } catch (e) {
        // Worker の中で WebGPU を使えないブラウザでは、画面側で動かす
        if (worker) { try { worker.terminate() } catch {} worker = null }
        if (/integrity|Integrity/.test(String(e && e.message))) throw e
        engine = await L.CreateMLCEngine(v.id, cfg)
      }
      current = { key, id: v.id }
      state = 'ready'; progress = { text: '準備できました', value: 1 }
      notify()
      return true
    } catch (e) {
      state = 'error'
      lastError = friendlyError(e)
      engine = null; current = null
      if (worker) { try { worker.terminate() } catch {} worker = null }
      notify()
      throw new Error(lastError)
    } finally {
      loading = null
    }
  })()
  return loading
}

export async function unload(silent = false) {
  const e = engine
  engine = null; current = null
  if (e) { try { await e.unload() } catch {} }
  if (worker) { try { worker.terminate() } catch {} worker = null }
  if (!silent) { state = 'off'; notify() }
}

export async function removeDownloaded(key) {
  try {
    await checkSupport()
    const L = await loadLib()
    if (current && current.key === key) await unload()
    await L.deleteModelAllInfoInCache(variant(key).id, appConfig(key))
    return true
  } catch { return false }
}

// ============================================================
// 順番待ち: モデルは 1 度に 1 つしか考えられないので、大事なものから順に
//   chat (チャットで頼まれた) > fix (実行エラーの修正) > complete (続きの提案) > check (裏でのエラー探し)
//   大事な頼みが来たら、裏でのエラー探しは途中でやめて、あとでやり直す
// ============================================================
const PRI = { chat: 4, fix: 3, complete: 2, check: 1 }
let busy = null
const waiting = []
export class Preempted extends Error { constructor() { super('preempted'); this.name = 'Preempted' } }
const abortError = () => new DOMException('Aborted', 'AbortError')
function schedule(kind, run, signal) {
  return new Promise((resolve, reject) => {
    const job = { pri: PRI[kind] || 1, kind, run, resolve, reject, signal, preempted: false }
    // 続きの提案は、新しいものだけが意味を持つ
    if (kind === 'complete') for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].kind === 'complete') waiting.splice(i, 1)[0].reject(abortError())
    waiting.push(job)
    waiting.sort((a, b) => b.pri - a.pri)
    if (busy && busy.pri < job.pri && (busy.kind === 'check' || busy.kind === 'complete')) { busy.preempted = true; try { engine && engine.interruptGenerate() } catch {} }
    if (signal) signal.addEventListener('abort', () => { const i = waiting.indexOf(job); if (i >= 0) { waiting.splice(i, 1); reject(abortError()) } }, { once: true })
    pump()
  })
}
async function pump() {
  if (busy || !waiting.length) return
  const job = waiting.shift()
  if (job.signal && job.signal.aborted) { job.reject(abortError()); pump(); return }
  busy = job
  try {
    const r = await job.run(job)
    if (job.preempted) job.reject(new Preempted()); else job.resolve(r)
  } catch (e) { job.reject(job.preempted ? new Preempted() : e) } finally { busy = null; setTimeout(pump, 0) }
}
export const llmBusy = () => !!busy || waiting.length > 0

// 文章を作る (少しずつ onText に渡す)
export function generate(messages, { onText, signal, maxTokens = 800, temperature = 0.2, kind = 'chat', stop } = {}) {
  if (!engine) return Promise.reject(new Error('モデルが読み込まれていません'))
  return schedule(kind, async job => {
    let text = ''
    const abort = () => { try { engine.interruptGenerate() } catch {} }
    if (signal) { if (signal.aborted) throw abortError(); signal.addEventListener('abort', abort, { once: true }) }
    try {
      const chunks = await engine.chat.completions.create({ messages, stream: true, temperature, top_p: 0.9, max_tokens: maxTokens, frequency_penalty: 0.2, ...(stop ? { stop } : {}) })
      for await (const c of chunks) {
        const d = c && c.choices && c.choices[0] && c.choices[0].delta ? c.choices[0].delta.content : ''
        if (d) { text += d; if (onText) onText(text) }
        if ((signal && signal.aborted) || job.preempted) break
      }
    } finally {
      if (signal) signal.removeEventListener('abort', abort)
    }
    if (signal && signal.aborted) throw abortError()
    return text
  }, signal)
}

// 続きを書く (チャットではなく、文章の続き。Qwen2.5-Coder の FIM: 前と後ろを見て、間を埋める)
export function complete(prefix, suffix, { signal, maxTokens = 64, kind = 'complete' } = {}) {
  if (!engine) return Promise.reject(new Error('モデルが読み込まれていません'))
  return schedule(kind, async job => {
    if (signal && signal.aborted) throw abortError()
    const prompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`
    const abort = () => { try { engine.interruptGenerate() } catch {} }
    if (signal) signal.addEventListener('abort', abort, { once: true })
    try {
      const r = await engine.completions.create({ prompt, max_tokens: maxTokens, temperature: 0.1, top_p: 0.95, stop: ['<|endoftext|>', '<|fim_pad|>', '<|file_sep|>', '<|im_end|>', '\n\n\n'] })
      if ((signal && signal.aborted) || job.preempted) throw abortError()
      return (r && r.choices && r.choices[0] && r.choices[0].text) || ''
    } finally { if (signal) signal.removeEventListener('abort', abort) }
  }, signal)
}

// 端末に保存済みなら、手が空いたときに読み込んでおく (AI のエラー検知・続きの提案をすぐ使えるように)
export async function preload(key) {
  if (!key || state === 'ready' || state === 'loading') return false
  try {
    const s = await checkSupport()
    if (!s.ok || !(await isDownloaded(key))) return false
    await load(key)
    return true
  } catch { return false }
}

function jpProgress(t) {
  const pct = /(\d+)%/.exec(t)
  if (/Fetching param cache|Loading model from cache|fetching/i.test(t)) return `モデルを${/cache\[/.test(t) || /from cache/i.test(t) ? '読み込み' : 'ダウンロード'}中${pct ? ' ' + pct[1] + '%' : ''}`
  if (/Loading GPU shader|shader/i.test(t)) return 'GPU の準備中'
  if (/Finish loading/i.test(t)) return '準備できました'
  return pct ? `読み込み中 ${pct[1]}%` : '読み込み中…'
}
function friendlyError(e) {
  const m = String(e && e.message ? e.message : e)
  if (/integrity|Integrity/.test(m)) return 'モデルのファイルが想定と違うため、安全のため読み込みを止めました (アプリの更新をお待ちください)'
  if (/QuotaExceeded|quota|storage/i.test(m)) return '端末の空き容量が足りません。不要なデータを消すか、小さいモデルを選んでください'
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'モデルをダウンロードできませんでした。インターネットに接続して、もう一度お試しください'
  if (/out of memory|OOM|Device was lost|device lost|maxBufferSize|maxStorageBufferBindingSize|exceed/i.test(m)) return 'この端末ではメモリが足りません。小さいモデル (軽量) を選んでください'
  if (/WebGPU|navigator\.gpu|adapter/i.test(m)) return 'この端末・ブラウザでは WebGPU を使えません'
  return 'モデルを読み込めませんでした: ' + m.slice(0, 160)
}
