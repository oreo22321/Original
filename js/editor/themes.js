// エディタのテーマ (配色)
import { EditorView, HighlightStyle, syntaxHighlighting, tags as t, highlightTree, tagHighlighter, pythonLanguage } from '../../vendor/codemirror.js'

// c: 配色 { bg, fg, gutter, gutterFg, line, sel, cursor, keyword, control, string, number, comment, func, prop, type, builtin, ns, cls, bool, op, def, meta, invalid }
export const THEMES = {
  // VS Code の標準 (Dark Modern / Light Modern) と同じ色。Python 拡張 (Pylance) の意味による色分けも同じ
  'vscode-dark': {
    name: 'Dark Modern (VS Code)', dark: true, vscode: true,
    c: { bg: '#1f1f1f', fg: '#cccccc', gutter: '#1f1f1f', gutterFg: '#6e7681', gutterActive: '#cccccc', line: 'transparent', lineBorder: '#282828', sel: '#264f78', selMatch: '#add6ff26', cursor: '#aeafad', keyword: '#569cd6', control: '#c586c0', string: '#ce9178', number: '#b5cea8', comment: '#6a9955', func: '#dcdcaa', prop: '#9cdcfe', type: '#4ec9b0', builtin: '#dcdcaa', ns: '#4ec9b0', cls: '#4ec9b0', bool: '#569cd6', op: '#d4d4d4', punct: '#cccccc', def: '#9cdcfe', variable: '#9cdcfe', constant: '#4fc1ff', meta: '#dcdcaa', invalid: '#f44747', special: '#569cd6', escape: '#d7ba7d', regexp: '#d16969', heading: '#569cd6', link: '#4daafc', indent: '#404040', indentActive: '#707070', bracketMatch: '#0064001a', bracketBorder: '#888888', findMatch: '#9e6a03', findHi: '#623315', rb: ['#ffd700', '#da70d6', '#179fff'] },
  },
  'vscode-light': {
    name: 'Light Modern (VS Code)', dark: false, vscode: true,
    c: { bg: '#ffffff', fg: '#3b3b3b', gutter: '#ffffff', gutterFg: '#6e7681', gutterActive: '#171184', line: 'transparent', lineBorder: '#eeeeee', sel: '#add6ff', selMatch: '#add6ff80', cursor: '#000000', keyword: '#0000ff', control: '#af00db', string: '#a31515', number: '#098658', comment: '#008000', func: '#795e26', prop: '#001080', type: '#267f99', builtin: '#795e26', ns: '#267f99', cls: '#267f99', bool: '#0000ff', op: '#000000', punct: '#3b3b3b', def: '#001080', variable: '#001080', constant: '#0070c1', meta: '#795e26', invalid: '#cd3131', special: '#0000ff', escape: '#ee0000', regexp: '#811f3f', heading: '#800000', link: '#005fb8', indent: '#d3d3d3', indentActive: '#939393', bracketMatch: '#0064001a', bracketBorder: '#b9b9b9', findMatch: '#a8ac94', findHi: '#ea5c0055', rb: ['#0431fa', '#319331', '#7b3814'] },
  },
  // ForgeCode の以前の標準: 落ち着いたグラファイトに、彩度を抑えた色
  'forge-dark': {
    name: 'Forge Dark', dark: true,
    c: { bg: '#121315', fg: '#d7d9dd', gutter: '#121315', gutterFg: '#55585f', line: '#17181b', sel: '#2b3350', cursor: '#e8e9ec', keyword: '#9ba6f5', control: '#b49cf0', string: '#a9cf9a', number: '#e3b47c', comment: '#62666e', func: '#e6d3a3', prop: '#b9c3d1', type: '#7fc4b4', builtin: '#8cc8d9', ns: '#7fc4b4', cls: '#7fc4b4', bool: '#e3b47c', op: '#9a9ea7', def: '#d7d9dd', meta: '#7d828b', invalid: '#ef6461', special: '#d8b4e2' },
  },
  'forge-light': {
    name: 'Forge Light', dark: false,
    c: { bg: '#fbfbfa', fg: '#24262b', gutter: '#fbfbfa', gutterFg: '#a2a5ab', line: '#f2f2f0', sel: '#d9e0fb', cursor: '#24262b', keyword: '#4650c8', control: '#7b4ab8', string: '#3d7a3a', number: '#a6611a', comment: '#8e9299', func: '#7a5a12', prop: '#2f4a68', type: '#21766a', builtin: '#1c6d8f', ns: '#21766a', cls: '#21766a', bool: '#a6611a', op: '#5d6169', def: '#24262b', meta: '#7d828b', invalid: '#cf2e2e', special: '#9b3f8f' },
  },
  'dark-plus': {
    name: 'Dark+ (VS Code)', dark: true, vscode: true,
    c: { bg: '#1e1e1e', fg: '#d4d4d4', gutter: '#1e1e1e', gutterFg: '#858585', gutterActive: '#c6c6c6', line: 'transparent', lineBorder: '#282828', sel: '#264f78', selMatch: '#add6ff26', cursor: '#aeafad', keyword: '#569cd6', control: '#c586c0', string: '#ce9178', number: '#b5cea8', comment: '#6a9955', func: '#dcdcaa', prop: '#9cdcfe', type: '#4ec9b0', builtin: '#dcdcaa', ns: '#4ec9b0', cls: '#4ec9b0', bool: '#569cd6', op: '#d4d4d4', punct: '#d4d4d4', def: '#9cdcfe', variable: '#9cdcfe', constant: '#4fc1ff', meta: '#dcdcaa', invalid: '#f44747', special: '#569cd6', escape: '#d7ba7d', regexp: '#d16969', heading: '#569cd6', link: '#3794ff', indent: '#404040', indentActive: '#707070', bracketMatch: '#0064001a', bracketBorder: '#888888', findMatch: '#515c6a', findHi: '#ea5c0055', rb: ['#ffd700', '#da70d6', '#179fff'] },
  },
  'roblox-dark': {
    name: 'クラシック (ダーク)', dark: true,
    c: { bg: '#2e2e2e', fg: '#cccccc', gutter: '#2e2e2e', gutterFg: '#8c8c8c', line: '#373737', sel: '#0b5aaf', cursor: '#ffffff', keyword: '#f86d7c', control: '#f86d7c', string: '#adf195', number: '#ffc600', comment: '#666666', func: '#fdfbac', prop: '#61a1f1', type: '#84d6f7', builtin: '#84d6f7', ns: '#84d6f7', cls: '#84d6f7', bool: '#ffc600', op: '#cccccc', def: '#cccccc', meta: '#a0a0a0', invalid: '#ff4444', special: '#e2a0ff' },
  },
  'monokai': {
    name: 'Monokai', dark: true,
    c: { bg: '#272822', fg: '#f8f8f2', gutter: '#272822', gutterFg: '#90908a', line: '#3e3d32', sel: '#49483e', cursor: '#f8f8f0', keyword: '#f92672', control: '#f92672', string: '#e6db74', number: '#ae81ff', comment: '#88846f', func: '#a6e22e', prop: '#f8f8f2', type: '#66d9ef', builtin: '#66d9ef', ns: '#66d9ef', cls: '#a6e22e', bool: '#ae81ff', op: '#f92672', def: '#fd971f', meta: '#75715e', invalid: '#f44747', special: '#fd971f' },
  },
  'dracula': {
    name: 'Dracula', dark: true,
    c: { bg: '#282a36', fg: '#f8f8f2', gutter: '#282a36', gutterFg: '#6272a4', line: '#343746', sel: '#44475a', cursor: '#f8f8f0', keyword: '#ff79c6', control: '#ff79c6', string: '#f1fa8c', number: '#bd93f9', comment: '#6272a4', func: '#50fa7b', prop: '#8be9fd', type: '#8be9fd', builtin: '#8be9fd', ns: '#8be9fd', cls: '#8be9fd', bool: '#bd93f9', op: '#ff79c6', def: '#ffb86c', meta: '#6272a4', invalid: '#ff5555', special: '#ffb86c' },
  },
  'one-dark': {
    name: 'One Dark', dark: true,
    c: { bg: '#282c34', fg: '#abb2bf', gutter: '#282c34', gutterFg: '#636d83', line: '#2c313c', sel: '#3e4451', cursor: '#528bff', keyword: '#c678dd', control: '#c678dd', string: '#98c379', number: '#d19a66', comment: '#7f848e', func: '#61afef', prop: '#e06c75', type: '#e5c07b', builtin: '#56b6c2', ns: '#e5c07b', cls: '#e5c07b', bool: '#d19a66', op: '#56b6c2', def: '#e06c75', meta: '#7f848e', invalid: '#ff5555', special: '#d19a66' },
  },
  'github-dark': {
    name: 'GitHub Dark', dark: true,
    c: { bg: '#0d1117', fg: '#e6edf3', gutter: '#0d1117', gutterFg: '#6e7681', line: '#161b22', sel: '#264f78', cursor: '#e6edf3', keyword: '#ff7b72', control: '#ff7b72', string: '#a5d6ff', number: '#79c0ff', comment: '#8b949e', func: '#d2a8ff', prop: '#79c0ff', type: '#ffa657', builtin: '#79c0ff', ns: '#ffa657', cls: '#ffa657', bool: '#79c0ff', op: '#ff7b72', def: '#ffa657', meta: '#8b949e', invalid: '#f85149', special: '#a5d6ff' },
  },
  'light-plus': {
    name: 'Light+ (VS Code)', dark: false, vscode: true,
    c: { bg: '#ffffff', fg: '#000000', gutter: '#ffffff', gutterFg: '#237893', gutterActive: '#0b216f', line: 'transparent', lineBorder: '#eeeeee', sel: '#add6ff', selMatch: '#add6ff80', cursor: '#000000', keyword: '#0000ff', control: '#af00db', string: '#a31515', number: '#098658', comment: '#008000', func: '#795e26', prop: '#001080', type: '#267f99', builtin: '#795e26', ns: '#267f99', cls: '#267f99', bool: '#0000ff', op: '#000000', punct: '#000000', def: '#001080', variable: '#001080', constant: '#0070c1', meta: '#795e26', invalid: '#cd3131', special: '#0000ff', escape: '#ee0000', regexp: '#811f3f', heading: '#800000', link: '#006ab1', indent: '#d3d3d3', indentActive: '#939393', bracketMatch: '#0064001a', bracketBorder: '#b9b9b9', findMatch: '#a8ac94', findHi: '#ea5c0055', rb: ['#0431fa', '#319331', '#7b3814'] },
  },
  'github-light': {
    name: 'GitHub Light', dark: false,
    c: { bg: '#ffffff', fg: '#1f2328', gutter: '#ffffff', gutterFg: '#8c959f', line: '#f6f8fa', sel: '#b6e3ff', cursor: '#1f2328', keyword: '#cf222e', control: '#cf222e', string: '#0a3069', number: '#0550ae', comment: '#6e7781', func: '#8250df', prop: '#0550ae', type: '#953800', builtin: '#0550ae', ns: '#953800', cls: '#953800', bool: '#0550ae', op: '#cf222e', def: '#953800', meta: '#6e7781', invalid: '#cf222e', special: '#0a3069' },
  },
  'solarized-light': {
    name: 'Solarized Light', dark: false,
    c: { bg: '#fdf6e3', fg: '#586e75', gutter: '#eee8d5', gutterFg: '#93a1a1', line: '#eee8d5', sel: '#d6d0bc', cursor: '#586e75', keyword: '#859900', control: '#859900', string: '#2aa198', number: '#d33682', comment: '#93a1a1', func: '#268bd2', prop: '#268bd2', type: '#b58900', builtin: '#cb4b16', ns: '#b58900', cls: '#b58900', bool: '#d33682', op: '#859900', def: '#268bd2', meta: '#93a1a1', invalid: '#dc322f', special: '#cb4b16' },
  },
  'roblox-light': {
    name: 'クラシック (ライト)', dark: false,
    c: { bg: '#ffffff', fg: '#000000', gutter: '#ffffff', gutterFg: '#8f8f8f', line: '#f4f4f4', sel: '#a8d3ff', cursor: '#000000', keyword: '#0000ff', control: '#0000ff', string: '#ad0000', number: '#007f7f', comment: '#007f00', func: '#000000', prop: '#000000', type: '#7f007f', builtin: '#7f007f', ns: '#7f007f', cls: '#7f007f', bool: '#7f7f00', op: '#7f7f00', def: '#000000', meta: '#7f7f7f', invalid: '#ff0000', special: '#ad0000' },
  },
}

export function editorTheme(id, fontFamily, fontSize, lineHeight) {
  const th = THEMES[id] || THEMES['vscode-dark']
  const c = th.c
  // 意味による色分け (semantic.js) の色。VS Code のテーマは専用の色、ほかはテーマの色から
  const sem = {
    var: c.variable || c.fg, func: c.func, cls: c.cls, mod: c.ns, const: c.constant || c.number, prop: c.prop,
    fpre: c.vscode || th.vscode ? c.keyword : c.special, kwc: c.control,
  }
  const view = EditorView.theme({
    '&': { color: c.fg, backgroundColor: c.bg, fontSize: fontSize + 'px', height: '100%' },
    '.cm-scroller': { fontFamily, lineHeight: String(lineHeight) },
    '.cm-content': { caretColor: c.cursor },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: c.cursor, borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: c.sel },
    '.cm-activeLine': c.lineBorder ? { backgroundColor: 'transparent', boxShadow: `inset 0 1.5px 0 ${c.lineBorder}, inset 0 -1.5px 0 ${c.lineBorder}` } : { backgroundColor: c.line },
    '.cm-gutters': { backgroundColor: c.gutter, color: c.gutterFg, border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: c.lineBorder ? 'transparent' : c.line, color: c.gutterActive || c.fg },
    '.cm-selectionMatch': { backgroundColor: c.selMatch || (th.dark ? '#ffffff1a' : '#0000001a') },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: c.bracketMatch || (th.dark ? '#ffffff22' : '#00000018'), outline: `1px solid ${c.bracketBorder || c.gutterFg}` },
    '.cm-searchMatch': { backgroundColor: c.findHi || (th.dark ? '#613214' : '#ffe08a'), outline: '1px solid ' + (th.dark ? '#d18616' : '#e0a800') },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: c.findMatch || (th.dark ? '#9e6a03' : '#ffc107') },
    '.cm-tooltip': { backgroundColor: 'var(--elev)', color: 'var(--fg)', border: '1px solid var(--border)' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--active)', color: 'var(--fg)' },
    '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--fg)' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
    '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: `1px solid ${c.gutterFg}`, color: c.gutterFg },
    '.cm-ghost': { color: c.gutterFg, opacity: '0.85', fontStyle: 'italic' },
    '.cm-indent-guide': { boxShadow: `inset 1px 0 0 ${c.indent || (th.dark ? '#ffffff14' : '#00000014')}` },
    '.cm-indent-guide.active': { boxShadow: `inset 1px 0 0 ${c.indentActive || (th.dark ? '#ffffff40' : '#00000040')}` },
    '.sx-var': { color: sem.var }, '.sx-func': { color: sem.func }, '.sx-cls': { color: sem.cls }, '.sx-mod': { color: sem.mod },
    '.sx-const': { color: sem.const }, '.sx-prop': { color: sem.prop }, '.sx-fpre': { color: sem.fpre }, '.sx-kwc': { color: sem.kwc },
    '.cm-rb0': { color: (c.rb || [])[0] || 'var(--rb0)' }, '.cm-rb1': { color: (c.rb || [])[1] || 'var(--rb1)' }, '.cm-rb2': { color: (c.rb || [])[2] || 'var(--rb2)' },
  }, { dark: th.dark })
  const vs = !!th.vscode
  const hl = HighlightStyle.define([
    // キーワード: VS Code では def / class / lambda / and / or / not / in / is は青、if / for / return / import / as などは紫
    { tag: [t.definitionKeyword, t.operatorKeyword, t.modifier], color: c.keyword },
    { tag: [t.controlKeyword, t.moduleKeyword, t.keyword], color: vs ? c.control : c.keyword },
    { tag: [t.controlKeyword, t.operatorKeyword], color: vs ? undefined : c.control },
    { tag: [t.string, t.special(t.string)], color: c.string },
    { tag: [t.escape], color: c.escape || c.special },
    { tag: [t.regexp], color: c.regexp || c.special },
    { tag: [t.number], color: c.number },
    { tag: [t.bool, t.null, t.atom], color: c.bool },
    { tag: [t.self], color: vs ? c.variable : c.keyword },
    { tag: [t.comment, t.lineComment, t.blockComment], color: c.comment, fontStyle: vs ? undefined : 'italic' },
    { tag: [t.docComment], color: c.string },
    { tag: [t.special(t.comment)], color: c.special, fontWeight: 'bold' },
    { tag: [t.meta, t.documentMeta, t.annotation], color: c.meta },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: c.func },
    { tag: [t.standard(t.function(t.variableName))], color: c.builtin },
    { tag: [t.special(t.function(t.variableName)), t.special(t.variableName)], color: c.special },
    { tag: [t.propertyName, t.attributeName], color: c.prop },
    { tag: [t.constant(t.propertyName), t.constant(t.variableName)], color: c.constant || c.number },
    { tag: [t.typeName, t.definition(t.typeName)], color: c.type },
    { tag: [t.className, t.definition(t.className)], color: c.cls },
    { tag: [t.namespace], color: c.ns },
    { tag: [t.standard(t.variableName)], color: c.builtin },
    { tag: [t.definition(t.variableName)], color: c.def },
    { tag: [t.variableName], color: vs ? c.variable : c.fg },
    { tag: [t.operator, t.arithmeticOperator, t.compareOperator, t.bitwiseOperator, t.definitionOperator, t.updateOperator, t.logicOperator], color: c.op },
    { tag: [t.punctuation, t.separator, t.derefOperator], color: c.punct || c.op },
    { tag: [t.paren, t.brace, t.squareBracket, t.bracket], color: c.punct || c.op },
    { tag: [t.special(t.brace)], color: vs ? c.keyword : c.special },
    { tag: [t.invalid], color: c.invalid, textDecoration: 'underline wavy' },
    { tag: [t.heading], color: c.heading || c.keyword, fontWeight: 'bold' },
    { tag: [t.strong], fontWeight: 'bold' },
    { tag: [t.emphasis], fontStyle: 'italic' },
    { tag: [t.link, t.url], color: c.link || c.string, textDecoration: 'underline' },
    { tag: [t.tagName], color: c.keyword },
    { tag: [t.inserted], color: c.string },
    { tag: [t.deleted], color: c.invalid },
  ].map(r => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))).filter(r => Object.keys(r).length > 1))
  return [view, syntaxHighlighting(hl)]
}

// コードを色付きの HTML 要素にする (AI の答え・出力のコンソールなど、エディタの外のコード)
export function highlightPython(text, theme) {
  const out = document.createDocumentFragment()
  let tree
  try { tree = pythonLanguage.parser.parse(text) } catch { out.append(text); return out }
  const cls = highlighterFor(theme)
  let pos = 0
  const push = (to, c) => {
    if (to <= pos) return
    const s = text.slice(pos, to)
    if (c) { const span = document.createElement('span'); span.className = c; span.textContent = s; out.append(span) } else out.append(s)
    pos = to
  }
  highlightTree(tree, cls, (from, to, c) => { push(from, null); push(to, c) })
  push(text.length, null)
  return out
}
// エディタと同じ色を、エディタの外でも使えるクラス名に
let hlCache = null
function highlighterFor() {
  if (hlCache) return hlCache
  hlCache = tagHighlighter([
    { tag: [t.definitionKeyword, t.operatorKeyword, t.modifier, t.bool, t.null, t.special(t.brace)], class: 'hx-kw' },
    { tag: [t.controlKeyword, t.moduleKeyword, t.keyword], class: 'hx-ctl' },
    { tag: [t.string, t.special(t.string), t.docComment], class: 'hx-str' },
    { tag: [t.escape], class: 'hx-esc' },
    { tag: [t.number], class: 'hx-num' },
    { tag: [t.comment, t.lineComment, t.blockComment], class: 'hx-com' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName)), t.meta], class: 'hx-fn' },
    { tag: [t.className, t.definition(t.className), t.typeName, t.namespace], class: 'hx-cls' },
    { tag: [t.propertyName, t.variableName, t.definition(t.variableName)], class: 'hx-var' },
    { tag: [t.operator, t.arithmeticOperator, t.compareOperator, t.definitionOperator, t.updateOperator], class: 'hx-op' },
  ])
  return hlCache
}

// アプリ全体の UI 配色 (CSS 変数)
// 画面の枠 (サイドバー・パネル・メニュー) は、エディタの背景色から作る落ち着いた無彩色。
// アクセント色はテーマの文字色に合わせず固定 (テーマを変えても、画面の印象がぶれないように)
// VS Code の画面の色 (Dark Modern / Light Modern / Dark+ / Light+)
const VSCODE_UI = {
  'vscode-dark': {
    '--bg': '#1f1f1f', '--fg': '#cccccc', '--muted': '#9d9d9d', '--faint': '#6e7681',
    '--panel': '#181818', '--panel2': '#313131', '--elev': '#202020', '--border': '#2b2b2b', '--border-strong': '#3c3c3c',
    '--hover': '#2a2d2e', '--active': '#04395e', '--accent': '#4daafc', '--accent-fg': '#ffffff', '--primary': '#0078d4', '--primary-fg': '#ffffff',
    '--danger': '#f14c4c', '--ok': '#89d185', '--warn': '#cca700', '--focus': '#0078d4',
  },
  'vscode-light': {
    '--bg': '#ffffff', '--fg': '#3b3b3b', '--muted': '#616161', '--faint': '#8b949e',
    '--panel': '#f8f8f8', '--panel2': '#ffffff', '--elev': '#ffffff', '--border': '#e5e5e5', '--border-strong': '#cecece',
    '--hover': '#f2f2f2', '--active': '#e4e6f1', '--accent': '#005fb8', '--accent-fg': '#ffffff', '--primary': '#005fb8', '--primary-fg': '#ffffff',
    '--danger': '#e51400', '--ok': '#388a34', '--warn': '#bf8803', '--focus': '#005fb8',
  },
  'dark-plus': {
    '--bg': '#1e1e1e', '--fg': '#cccccc', '--muted': '#9d9d9d', '--faint': '#6e7681',
    '--panel': '#252526', '--panel2': '#3c3c3c', '--elev': '#252526', '--border': '#2b2b2b', '--border-strong': '#454545',
    '--hover': '#2a2d2e', '--active': '#04395e', '--accent': '#3794ff', '--accent-fg': '#ffffff', '--primary': '#0e639c', '--primary-fg': '#ffffff',
    '--danger': '#f14c4c', '--ok': '#89d185', '--warn': '#cca700', '--focus': '#007fd4',
  },
  'light-plus': {
    '--bg': '#ffffff', '--fg': '#616161', '--muted': '#717171', '--faint': '#9e9e9e',
    '--panel': '#f3f3f3', '--panel2': '#ffffff', '--elev': '#f3f3f3', '--border': '#e5e5e5', '--border-strong': '#cecece',
    '--hover': '#e8e8e8', '--active': '#0060c0', '--accent': '#006ab1', '--accent-fg': '#ffffff', '--primary': '#007acc', '--primary-fg': '#ffffff',
    '--danger': '#e51400', '--ok': '#388a34', '--warn': '#bf8803', '--focus': '#0090f1',
  },
}

export function uiColors(id) {
  const th = THEMES[id] || THEMES['vscode-dark']
  const c = th.c
  const rb = c.rb || (th.dark ? ['#d9c287', '#b9a0e6', '#8fb3e0'] : ['#8a6a12', '#7b4ab8', '#2f5f9a'])
  const extra = { '--rb0': rb[0], '--rb1': rb[1], '--rb2': rb[2], ...syntaxVars(c, th) }
  if (VSCODE_UI[id]) {
    const v = VSCODE_UI[id]
    return {
      ...v, ...extra, '--sel': c.sel,
      '--shadow': th.dark ? '0 16px 40px -12px rgba(0,0,0,.7), 0 2px 8px rgba(0,0,0,.36)' : '0 16px 40px -14px rgba(0,0,0,.2), 0 2px 6px rgba(0,0,0,.08)',
      '--scrim': th.dark ? 'rgba(0,0,0,.55)' : 'rgba(0,0,0,.25)', 'color-scheme': th.dark ? 'dark' : 'light',
    }
  }
  return { ...uiColorsBase(th, c), ...extra }
}

// エディタの外でコードを色付けするときの色 (CSS 変数)
function syntaxVars(c, th) {
  const vs = !!th.vscode
  return {
    '--hx-kw': c.keyword, '--hx-ctl': vs ? c.control : c.keyword, '--hx-str': c.string, '--hx-esc': c.escape || c.special, '--hx-num': c.number,
    '--hx-com': c.comment, '--hx-fn': c.func, '--hx-cls': c.cls, '--hx-var': vs ? (c.variable || c.fg) : c.fg, '--hx-op': c.op, '--hx-fg': c.fg, '--hx-bg': c.bg,
  }
}

function uiColorsBase(th, c) {
  if (th.dark) {
    const base = c.bg
    return {
      '--bg': base, '--fg': '#e6e7ea', '--muted': '#8d9097', '--faint': '#5f626a',
      '--panel': mix(base, '#000000', 0.18), '--panel2': mix(base, '#ffffff', 0.045), '--elev': mix(base, '#ffffff', 0.06),
      '--border': mix(base, '#ffffff', 0.085), '--border-strong': mix(base, '#ffffff', 0.15),
      '--hover': mix(base, '#ffffff', 0.05), '--active': mix(base, '#7d8df0', 0.2),
      '--accent': '#8d9cff', '--accent-fg': '#0d0e12', '--primary': '#ecedf0', '--primary-fg': '#0f1013',
      '--danger': '#ef6461', '--ok': '#5fbf86', '--warn': '#e0aa4a', '--sel': c.sel,
      '--shadow': '0 16px 40px -12px rgba(0,0,0,.65), 0 2px 8px rgba(0,0,0,.35)', '--scrim': 'rgba(4,5,7,.6)', 'color-scheme': 'dark',
    }
  }
  const base = c.bg
  return {
    '--bg': base, '--fg': '#1d1f23', '--muted': '#6a6e76', '--faint': '#9a9ea6',
    '--panel': mix(base, '#000000', 0.025), '--panel2': mix(base, '#000000', 0.04), '--elev': '#ffffff',
    '--border': mix(base, '#000000', 0.09), '--border-strong': mix(base, '#000000', 0.16),
    '--hover': mix(base, '#000000', 0.045), '--active': mix(base, '#4458e0', 0.12),
    '--accent': '#4458e0', '--accent-fg': '#ffffff', '--primary': '#18191c', '--primary-fg': '#ffffff',
    '--danger': '#cf2e2e', '--ok': '#1f8a4c', '--warn': '#9a6700', '--sel': c.sel,
    '--shadow': '0 16px 40px -14px rgba(20,22,30,.22), 0 2px 6px rgba(20,22,30,.08)', '--scrim': 'rgba(20,22,28,.28)', 'color-scheme': 'light',
  }
}

function mix(a, b, w) {
  const pa = hex(a), pb = hex(b)
  const r = pa.map((v, i) => Math.round(v * (1 - w) + pb[i] * w))
  return '#' + r.map(v => v.toString(16).padStart(2, '0')).join('')
}
function hex(h) {
  const s = h.replace('#', '')
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16))
}
