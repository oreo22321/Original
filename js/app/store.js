// 設定とアプリ状態の保存 (localStorage)
const KEY = 'forgecode.settings.v1'
const SESSION_KEY = 'forgecode.session.v1'

export const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
const smallScreen = typeof innerWidth !== 'undefined' && Math.min(innerWidth, innerHeight) < 600
export const isIOS = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

export const DEFAULTS = {
  // 見た目
  theme: 'dark-plus',
  fontSize: smallScreen ? 13 : 15,
  fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, "Cascadia Code", Consolas, "Noto Sans Mono CJK JP", "Hiragino Sans", monospace',
  lineHeight: 1.55,
  layout: 'auto', // auto | mobile | desktop
  // エディタ
  tabSize: 4,
  insertSpaces: false,
  wordWrap: smallScreen,
  lineNumbers: true,
  highlightLine: true,
  autoClose: true,
  autoEnd: true,       // then / do / function() を書いたら end を追加
  autoEndDelete: true, // if / for / function などを消したら対の end も消す
  indentGuides: true,
  stickyScroll: true,      // 画面の上に、いま見ている function / if の行を固定表示
  highlightSymbols: true,  // カーソル位置の変数を同じ変数ごとハイライト
  rainbowBrackets: true,
  colorPicker: true,
  pinchZoom: true,
  // 補完
  autocomplete: true,
  inlineSuggest: true,
  signatureHelp: true,
  hover: true,
  // チェック・誤字対策
  lint: true,
  lintUndefined: true,
  lintUnused: true,
  lintTypos: true,     // スペルミスを検出して「もしかして」を提案
  errorLens: true,     // エラーの内容を行の右に表示
  fixInput: true,      // 全角記号・スマート引用符を自動で半角に
  autoCorrect: true,   // fucntion → function などを自動修正
  // ファイル
  autoSave: true,
  autoSaveDelay: 600,
  formatOnSave: false,
  autoFormat: true,    // 入力した行・エラーのないコード全体の見た目を裏で整える
  trimOnSave: true,
  // 実行
  timeLimit: 10,
  maxRunTime: 60,
  clearOnRun: true,
  groupOutput: true,   // 同じ出力をまとめる (×3)
  outputTime: false,   // 出力に経過時間を表示
  explainErrors: true, // 実行エラーに日本語の解説を付ける
  netProxy: '',        // 外部 URL を直接取得できないときの中継サーバー ('' / corsproxy / allorigins / 独自 URL)
  // AI
  aiKey: '',
  aiModel: 'claude-opus-5-5',
  aiInline: false,
  aiDelay: 800,
  aiIncludeFile: true,
  aiTier: 'default',   // Claude のモデル: quick (速い) / default (標準) / complex (高性能)
  // モバイル
  keybar: true,
  keybarKeys: '( ) { } [ ] " \' = . : , ; + - * / # ~ < > _ ` ! & | % ^ @ \\ $ ?',
  haptics: true,
  // その他
  onboarded: false,
  confirmDelete: true,
}

let settings = { ...DEFAULTS }
try {
  const raw = localStorage.getItem(KEY)
  if (raw) {
    const saved = JSON.parse(raw)
    // 廃止した設定は捨てる
    for (const k of Object.keys(saved)) if (!(k in DEFAULTS)) delete saved[k]
    settings = { ...DEFAULTS, ...saved }
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
  const keep = { aiKey: settings.aiKey, onboarded: true }
  settings = { ...DEFAULTS, ...keep }
  try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch {}
  for (const fn of listeners) fn(settings, {})
}
export function onSettings(fn) { listeners.add(fn); return () => listeners.delete(fn) }

// ---- モード: 'studio' (Roblox Studio 用スクリプト) / 'executor' (エグゼキューター用スクリプト) ----
// 開いているプロジェクトごとに決まります。補完・エラーチェック・実行環境が切り替わります。
let mode = 'studio'
export const MODE_LABELS = { studio: 'Studio', executor: 'Executor' }
export function getMode() { return mode }
export function setMode(m) {
  m = m === 'executor' ? 'executor' : 'studio'
  if (m === mode) return
  mode = m
  emit('mode', m)
}

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
