// 設定とアプリ状態の保存 (localStorage)
const KEY = 'forgecode.settings.v1'
const SESSION_KEY = 'forgecode.session.v1'

export const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
const smallScreen = typeof innerWidth !== 'undefined' && Math.min(innerWidth, innerHeight) < 600
export const isIOS = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

export const DEFAULTS = {
  // 見た目
  theme: 'vscode-dark',
  language: 'ja',      // 表示の言語: ja / en / auto (端末に合わせる)
  fontSize: smallScreen ? 13 : 15,
  fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, "Cascadia Code", Consolas, "Noto Sans Mono CJK JP", "Hiragino Sans", monospace',
  lineHeight: 1.55,
  layout: 'auto', // auto | mobile | desktop
  // エディタ
  tabSize: 4,
  insertSpaces: true,   // Python はスペース 4 つが標準 (PEP 8)
  wordWrap: smallScreen,
  lineNumbers: true,
  highlightLine: true,
  autoClose: true,
  indentGuides: true,
  stickyScroll: true,      // 画面の上に、いま見ている def / class / if の行を固定表示
  highlightSymbols: true,  // カーソルのある単語を、同じ単語ごとハイライト
  rainbowBrackets: true,
  pinchZoom: true,
  // 補完
  autocomplete: true,
  signatureHelp: true,
  hover: true,
  // チェック・誤字対策
  lint: true,
  lintUndefined: true,
  lintUnused: true,
  errorLens: true,     // エラーの内容を行の右に表示
  fixInput: true,      // 全角記号・スマート引用符を自動で半角に
  autoCorrect: true,   // pirnt( → print( などを自動修正
  // ファイル
  autoSave: true,
  autoSaveDelay: 600,
  formatOnSave: false,
  trimOnSave: true,
  // 実行
  maxRunTime: 0,       // 最大実行時間 (秒)。0 は無制限
  clearOnRun: true,
  runView: 'full',     // 実行結果の表示: full (全画面の実行画面) / panel (下のパネル)
  groupOutput: true,   // 同じ出力をまとめる (×3)
  explainErrors: true, // 実行エラーに日本語の解説を付ける
  // AI
  aiInline: true,      // 入力が止まったら AI (Forge AI) が続きを提案
  aiDelay: 700,
  aiLlm: '',           // 高性能モード (端末内 LLM): '' (使わない) / small / medium / large
  // モバイル
  keybar: true,
  keybarKeys: ': ( ) [ ] { } " \' = . , _ # + - * / < > % ! & | @ \\ ~ ^ ;',
  haptics: true,
  // その他
  onboarded: false,
  design: 3,           // デザインの版 (新しいデザインへの移行用)
  python: 1,           // Python 版への移行済み
  confirmDelete: true,
}

let settings = { ...DEFAULTS }
try {
  const raw = localStorage.getItem(KEY)
  if (raw) {
    const saved = JSON.parse(raw)
    // 廃止した設定は捨てる
    let dropped = false
    // v10.1: 新しいデザイン。標準のテーマ (Dark+ / Light+) のままの人は、新しい標準テーマに
    if (!('design' in saved)) {
      if (saved.theme === 'dark-plus' || !saved.theme) saved.theme = 'forge-dark'
      else if (saved.theme === 'light-plus') saved.theme = 'forge-light'
      saved.design = 2
      dropped = true
    }
    // v13: 色を VS Code と同じに。以前の標準テーマのままの人は、VS Code の標準 (Dark Modern / Light Modern) に
    if ((saved.design || 0) < 3) {
      if (!saved.theme || saved.theme === 'forge-dark') saved.theme = 'vscode-dark'
      else if (saved.theme === 'forge-light') saved.theme = 'vscode-light'
      saved.design = 3
      dropped = true
    }
    // v12: Python になったので、字下げはスペース 4 つ (タブとスペースが混ざると Python ではエラー)、キーボードバーは Python の記号
    if (!('python' in saved)) {
      saved.insertSpaces = true
      saved.tabSize = 4
      saved.keybarKeys = DEFAULTS.keybarKeys
      saved.maxRunTime = 0
      saved.python = 1
      dropped = true
    }
    // v10: AI が内蔵になり無料で動くので、続きの提案を有効にする (以前は API の利用料を抑えるため既定でオフ)
    if (!('aiLlm' in saved) && 'aiKey' in saved) saved.aiInline = true
    for (const k of Object.keys(saved)) if (!(k in DEFAULTS)) { delete saved[k]; dropped = true }
    settings = { ...DEFAULTS, ...saved }
    // 使わなくなった設定 (以前の API キーなど) は端末からも消す
    if (dropped) localStorage.setItem(KEY, JSON.stringify(settings))
  }
} catch {}

const listeners = new Set()
export function getSettings() { return settings }
export function setSettings(patch) {
  const prev = settings
  settings = { ...settings, ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch {}
  for (const fn of listeners) fn(settings, prev)
}
export function resetSettings() {
  const keep = { onboarded: true }
  settings = { ...DEFAULTS, ...keep }
  try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch {}
  for (const fn of listeners) fn(settings, {})
}
export function onSettings(fn) { listeners.add(fn); return () => listeners.delete(fn) }

// 言語は Python だけ (以前の版の呼び出しのために残しています)
export const MODE_LABELS = { python: 'Python' }
export function getMode() { return 'python' }
export function setMode() {}

// セッション (開いているタブなど)
export function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}') } catch { return {} }
}
let sessionTimer = null
export function saveSession(data) {
  clearTimeout(sessionTimer)
  sessionTimer = setTimeout(() => {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)) } catch {}
  }, 300)
}

// 簡易イベントバス
const bus = new Map()
export function on(ev, fn) { if (!bus.has(ev)) bus.set(ev, new Set()); bus.get(ev).add(fn); return () => bus.get(ev).delete(fn) }
export function emit(ev, ...args) { const s = bus.get(ev); if (s) for (const fn of [...s]) fn(...args) }
