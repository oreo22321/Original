// 表示の言語 (日本語 / English)
// アプリの文言は日本語で書いてあり、英語のときは画面に出た文字を辞書 (i18n-en.js) で置き換えます
// ・コード・出力・ファイル名など、ユーザーの内容には触れません
// ・辞書にない文言は日本語のまま表示します
import { getSettings } from './store.js'
// 英語の辞書は、英語で表示するときだけ読み込む (日本語のときは起動を軽く)
let EN = {}, EN_PATTERNS = []

const JP = /[぀-ヿ㐀-鿿]/
// 翻訳しない場所 (コード・出力・ユーザーが書いたもの)
const SKIP = '.cm-content, .cm-gutters, .cm-line, code, pre, .out-text, .out-line:not(.meta), .lv-code, .md-preview, .ai-user, .ai-msg.user, .tree-name, .tab-name, .breadcrumb, .lv-name, .lv-prop-val, .dbg-var .v-val, [data-no-i18n], textarea, input'
const ATTRS = ['title', 'aria-label', 'placeholder']
// 属性 (説明・入力欄の案内) は、コードの中でなければ翻訳する
const SKIP_ATTR = '.cm-content, .cm-gutters, [data-no-i18n]'

export let lang = 'ja'
export function resolveLang(setting) {
  if (setting === 'ja' || setting === 'en') return setting
  try { return /^ja\b/i.test(navigator.language || '') ? 'ja' : 'en' } catch { return 'ja' }
}

// 文字列を表示の言語に
export function tr(s) {
  if (lang === 'ja' || typeof s !== 'string' || !JP.test(s)) return s
  const key = s.trim()
  const hit = EN[key]
  if (hit !== undefined) return s.replace(key, hit)
  for (const [re, fn] of EN_PATTERNS) {
    const m = re.exec(key)
    if (m) return s.replace(key, typeof fn === 'function' ? fn(m) : fn)
  }
  return s
}

function skip(node) {
  const el = node.nodeType === 1 ? node : node.parentElement
  return !el || !!el.closest(SKIP)
}
function translateText(node) {
  const v = node.nodeValue
  if (!v || !JP.test(v) || skip(node)) return
  const t = tr(v)
  if (t !== v) node.nodeValue = t
}
function translateAttrs(el) {
  if (el.closest(SKIP_ATTR)) return
  for (const a of ATTRS) {
    const v = el.getAttribute(a)
    if (v && JP.test(v)) { const t = tr(v); if (t !== v) el.setAttribute(a, t) }
  }
}
function translateTree(root) {
  if (root.nodeType === 3) { translateText(root); return }
  if (root.nodeType !== 1) return
  translateAttrs(root)
  for (const el of root.querySelectorAll('input[placeholder], textarea[placeholder]')) translateAttrs(el)
  if (skip(root)) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: n => (n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  let n
  while ((n = walker.nextNode())) {
    if (n.nodeType === 3) translateText(n)
    else translateAttrs(n)
  }
}

export async function startI18n() {
  lang = resolveLang(getSettings().language)
  document.documentElement.lang = lang
  if (lang === 'ja') return
  try { ({ EN, EN_PATTERNS } = await import('./i18n-en.js')) } catch { lang = 'ja'; return }
  translateTree(document.body)
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'childList') { for (const n of m.addedNodes) translateTree(n) }
      else if (m.type === 'characterData') translateText(m.target)
      else if (m.type === 'attributes') translateAttrs(m.target)
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })
}
