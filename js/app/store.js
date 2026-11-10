// 設定とアプリ状態の保存 (localStorage)
const KEY = 'forgecode.settings.v1'
const SESSION_KEY = 'forgecode.session.v1'

export const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
const smallScreen = typeof innerWidth !== 'undefined' && Math.min(innerWidth, innerHeight) < 600

export const DEFAULTS = {
  // 見た目
  theme: 'dark-plus',
  fontSize: smallScreen ? 13 : 15,
  fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, "Cascadia Code", Consolas, "Noto Sans Mono CJK JP", "Hiragino Sans", monospace',
  lineHeight: 1.55,
  uiSize: 'auto', // auto | compact | comfortable
  layout: 'auto', // auto | mobile | desktop
  // エディタ
  tabSize: 4,
  insertSpaces: false,
  wordWrap: smallScreen,
  lineNumbers: true,
  highlightLine: true,
  autoClose: true,
  autoEnd: true,
  indentGuides: true,
  rainbowBrackets: true,
  colorPicker: true,
  pinchZoom: true,
  // 補完
  autocomplete: true,
  inlineSuggest: true,
  signatureHelp: true,
  hover: true,
  // チェック
  lint: true,
  lintUndefined: true,
  lintUnused: true,
  // API
  robloxApi: true,
  executorApi: true,
  // ファイル
  autoSave: true,
  autoSaveDelay: 800,
  formatOnSave: false,
  trimOnSave: true,
  // 実行
  luaRuntime: 'roblox', // roblox | plain (.lua ファイルの実行環境)
  timeLimit: 10,
  maxRunTime: 60,
  clearOnRun: true,
  pyodideUrl: 'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/',
  // AI
  aiKey: '',
  aiModel: 'claude-opus-5-5',
  aiInline: false,
  aiDelay: 800,
  aiIncludeFile: true,
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
  if (raw) settings = { ...DEFAULTS, ...JSON.parse(raw) }
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
