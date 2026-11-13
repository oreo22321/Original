// Forge AI とアプリをつなぐ窓口
// ・エンジン (js/ai/engine.js) は画面に触らないので、ここでファイルの読み書き・実行・チェックの結果を渡します
// ・AI の変更は 1 回の依頼ごとに記録し、まとめて元に戻せるようにします
// ・高性能モード (端末内 LLM) が設定されていれば、必要になったときに読み込みます
import { app, refreshFiles } from './app.js'
import { getSettings, getMode, emit } from './store.js'
import * as vfs from './vfs.js'
import { fileText, writeText, isFile, cleanPath, lintOpts, problemsOf, finishChanges, revertChanges, serial } from './agent.js'
import { respond } from '../ai/engine.js'
import * as llm from '../ai/llm.js'
import { setProjectCorpus } from '../ai/complete.js'

// ============================================================
// 状態
// ============================================================
export function aiStatus() {
  const s = getSettings()
  const l = llm.status()
  return { engine: 'forge', llmKey: s.aiLlm || '', llm: l, llmReady: llm.llmReady() }
}
llm.onLlmChange(() => emit('ai', aiStatus()))

// ============================================================
// 窓口 (1 回の依頼ごとに作る)
// ============================================================
export function makeHost(session) {
  const record = async path => { if (!session.changes.has(path)) session.changes.set(path, { before: isFile(path) ? await fileText(path) : null }) }
  const focusFirst = () => session.focusEdits && session.changes.size <= 1
  const host = {
    mode: getMode(),
    hasProject: !!app.project,
    files: () => app.files.filter(f => !f.dir).map(f => ({ path: f.path })),
    active() {
      const doc = app.editors && app.editors.activeDoc()
      if (!doc) return null
      const view = app.editors.activeView()
      const st = view && app.editors.viewFor(doc.path) === view ? view.state : doc.state
      const sel = st.selection.main
      return { path: doc.path, text: st.doc.toString(), from: sel.from, to: sel.to }
    },
    read: path => fileText(cleanPath(path)),
    write: (path, text, opts = {}) => serial(async () => {
      path = cleanPath(path)
      await record(path)
      await writeText(path, text, { focus: !!opts.focus && focusFirst() })
    }),
    create: (path, text, opts = {}) => serial(async () => {
      path = cleanPath(path)
      if (!app.project) throw new Error('プロジェクトが開かれていません')
      await record(path)
      if (isFile(path)) { await writeText(path, text, { focus: !!opts.focus }); return }
      await vfs.writeFile(app.project.id, path, text)
      app.contents.set(path, text)
      await refreshFiles()
      await app.editors.open(path, { activate: !!opts.focus || focusFirst() })
    }),
    lintOpts: path => lintOpts(path || 'main.lua'),
    problems: (path, text) => problemsOf(path, text, { max: 40 }),
    lastErrors() {
      if (!app.runner) return []
      return [...document.querySelectorAll('.out-error')].slice(-3).map(e => ({ text: e.dataset.text || e.textContent || '' })).filter(e => e.text)
    },
    run: app.runner ? async ({ seconds = 3, signal } = {}) => { const r = await app.runner.runAndCollect({ seconds, signal }); session.ran = true; return r } : null,
    undoLast: async () => {
      const last = session.lastChanges && session.lastChanges()
      if (!last || !last.changes.length) return null
      await revertChanges(last.changes)
      last.reverted = true
      return `直前の変更 (${last.changes.map(c => c.path).join('、')}) を元に戻しました。`
    },
    llm: llmBridge(session),
  }
  return host
}

// 高性能モード: 設定でモデルが選ばれていれば使える (まだ読み込んでいなければ、使うときに読み込む)
function llmBridge(session) {
  return {
    ready: () => !!getSettings().aiLlm && (llm.llmReady() || llm.status().state !== 'error'),
    async generate(messages, opts = {}) {
      const key = getSettings().aiLlm
      if (!llm.llmReady() || llm.status().model !== key) {
        session.onStep({ icon: 'download', text: '端末内の AI モデルを読み込んでいます…' })
        await llm.load(key, { onProgress: p => session.onProgress && session.onProgress(p) })
      }
      return llm.generate(messages, opts)
    },
  }
}

// ============================================================
// 依頼を実行
// ============================================================
let memory = {}
export function resetMemory() { memory = {} }

export async function askAi({ text, history = [], onStep = () => {}, onText, onProgress, signal, focusEdits = false, lastChanges }) {
  const session = { changes: new Map(), onStep, onProgress, focusEdits, ran: false, lastChanges }
  const host = makeHost(session)
  let r
  try {
    r = await respond({ text, history, host, onStep, onText, signal, memory })
  } catch (e) {
    try { e.changes = await finishChanges(session) } catch { e.changes = [] }
    throw e
  }
  memory = r.memory || memory
  return { text: r.text, chips: r.chips || [], changes: await finishChanges(session), ran: session.ran }
}

// ============================================================
// 続きの提案用に、プロジェクトのコードを学習させる (変更が落ち着いたときに)
// ============================================================
let corpusTimer = 0
export function refreshCorpus() {
  clearTimeout(corpusTimer)
  corpusTimer = setTimeout(() => {
    try {
      const texts = []
      for (const f of app.files) if (!f.dir && /\.luau?$/i.test(f.path)) { const t = app.contents.get(f.path); if (t) texts.push(t) }
      setProjectCorpus(texts)
    } catch {}
  }, 1500)
}
