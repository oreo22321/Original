// エディタのテーマ (配色)
import { EditorView, HighlightStyle, syntaxHighlighting, tags as t } from '../../vendor/codemirror.js'

// c: 配色 { bg, fg, gutter, gutterFg, line, sel, cursor, keyword, control, string, number, comment, func, prop, type, builtin, ns, cls, bool, op, def, meta, invalid }
export const THEMES = {
  'dark-plus': {
    name: 'Dark+ (VS Code)', dark: true,
    c: { bg: '#1e1e1e', fg: '#d4d4d4', gutter: '#1e1e1e', gutterFg: '#858585', line: '#2a2d2e', sel: '#264f78', cursor: '#aeafad', keyword: '#569cd6', control: '#c586c0', string: '#ce9178', number: '#b5cea8', comment: '#6a9955', func: '#dcdcaa', prop: '#9cdcfe', type: '#4ec9b0', builtin: '#4fc1ff', ns: '#4ec9b0', cls: '#4ec9b0', bool: '#569cd6', op: '#d4d4d4', def: '#9cdcfe', meta: '#808080', invalid: '#f44747', special: '#d7ba7d' },
  },
  'roblox-dark': {
    name: 'Roblox Studio (ダーク)', dark: true,
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
    name: 'Light+ (VS Code)', dark: false,
    c: { bg: '#ffffff', fg: '#000000', gutter: '#ffffff', gutterFg: '#6e7781', line: '#f3f3f3', sel: '#add6ff', cursor: '#000000', keyword: '#0000ff', control: '#af00db', string: '#a31515', number: '#098658', comment: '#008000', func: '#795e26', prop: '#001080', type: '#267f99', builtin: '#0070c1', ns: '#267f99', cls: '#267f99', bool: '#0000ff', op: '#000000', def: '#001080', meta: '#808080', invalid: '#cd3131', special: '#ee0000' },
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
    name: 'Roblox Studio (ライト)', dark: false,
    c: { bg: '#ffffff', fg: '#000000', gutter: '#ffffff', gutterFg: '#8f8f8f', line: '#f4f4f4', sel: '#a8d3ff', cursor: '#000000', keyword: '#0000ff', control: '#0000ff', string: '#ad0000', number: '#007f7f', comment: '#007f00', func: '#000000', prop: '#000000', type: '#7f007f', builtin: '#7f007f', ns: '#7f007f', cls: '#7f007f', bool: '#7f7f00', op: '#7f7f00', def: '#000000', meta: '#7f7f7f', invalid: '#ff0000', special: '#ad0000' },
  },
}

export function editorTheme(id, fontFamily, fontSize, lineHeight) {
  const th = THEMES[id] || THEMES['dark-plus']
  const c = th.c
  const view = EditorView.theme({
    '&': { color: c.fg, backgroundColor: c.bg, fontSize: fontSize + 'px', height: '100%' },
    '.cm-scroller': { fontFamily, lineHeight: String(lineHeight) },
    '.cm-content': { caretColor: c.cursor },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: c.cursor, borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: c.sel + (th.dark ? '' : '') },
    '.cm-activeLine': { backgroundColor: c.line },
    '.cm-gutters': { backgroundColor: c.gutter, color: c.gutterFg, border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: c.line, color: c.fg },
    '.cm-selectionMatch': { backgroundColor: th.dark ? '#ffffff1a' : '#0000001a' },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: th.dark ? '#ffffff22' : '#00000018', outline: `1px solid ${c.gutterFg}` },
    '.cm-searchMatch': { backgroundColor: th.dark ? '#613214' : '#ffe08a', outline: '1px solid ' + (th.dark ? '#d18616' : '#e0a800') },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: th.dark ? '#9e6a03' : '#ffc107' },
    '.cm-tooltip': { backgroundColor: th.dark ? '#252526' : '#f8f8f8', color: c.fg, border: `1px solid ${th.dark ? '#454545' : '#c8c8c8'}` },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: th.dark ? '#04395e' : '#d6ebff', color: c.fg },
    '.cm-panels': { backgroundColor: th.dark ? '#252526' : '#f3f3f3', color: c.fg },
    '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: `1px solid ${c.gutterFg}`, color: c.gutterFg },
    '.cm-ghost': { color: c.gutterFg, opacity: '0.85', fontStyle: 'italic' },
    '.cm-indent-guide': { boxShadow: `inset 1px 0 0 ${th.dark ? '#ffffff14' : '#00000014'}` },
    '.cm-indent-guide.active': { boxShadow: `inset 1px 0 0 ${th.dark ? '#ffffff40' : '#00000040'}` },
  }, { dark: th.dark })
  const hl = HighlightStyle.define([
    { tag: [t.keyword, t.definitionKeyword, t.moduleKeyword], color: c.keyword },
    { tag: [t.controlKeyword, t.operatorKeyword], color: c.control },
    { tag: [t.string], color: c.string },
    { tag: [t.special(t.string), t.regexp], color: c.special },
    { tag: [t.number], color: c.number },
    { tag: [t.bool, t.null, t.atom], color: c.bool },
    { tag: [t.self], color: c.keyword, fontStyle: 'italic' },
    { tag: [t.comment, t.lineComment, t.blockComment], color: c.comment, fontStyle: 'italic' },
    { tag: [t.special(t.comment)], color: c.special, fontWeight: 'bold' },
    { tag: [t.meta, t.documentMeta, t.annotation], color: c.meta },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: c.func },
    { tag: [t.standard(t.function(t.variableName))], color: c.builtin },
    { tag: [t.special(t.function(t.variableName)), t.special(t.variableName)], color: c.special },
    { tag: [t.propertyName, t.attributeName], color: c.prop },
    { tag: [t.constant(t.propertyName), t.constant(t.variableName)], color: c.number },
    { tag: [t.typeName, t.definition(t.typeName)], color: c.type },
    { tag: [t.className], color: c.cls },
    { tag: [t.namespace], color: c.ns },
    { tag: [t.standard(t.variableName)], color: c.builtin },
    { tag: [t.definition(t.variableName)], color: c.def },
    { tag: [t.variableName], color: c.fg },
    { tag: [t.operator, t.punctuation, t.separator], color: c.op },
    { tag: [t.paren, t.brace, t.squareBracket, t.bracket], color: c.op },
    { tag: [t.special(t.brace)], color: c.special },
    { tag: [t.invalid], color: c.invalid, textDecoration: 'underline wavy' },
    { tag: [t.heading], color: c.keyword, fontWeight: 'bold' },
    { tag: [t.strong], fontWeight: 'bold' },
    { tag: [t.emphasis], fontStyle: 'italic' },
    { tag: [t.link, t.url], color: c.string, textDecoration: 'underline' },
    { tag: [t.tagName], color: c.keyword },
    { tag: [t.inserted], color: c.string },
    { tag: [t.deleted], color: c.invalid },
  ])
  return [view, syntaxHighlighting(hl)]
}

// アプリ全体の UI 配色 (CSS 変数)
export function uiColors(id) {
  const th = THEMES[id] || THEMES['dark-plus']
  const c = th.c
  if (th.dark) {
    return {
      '--bg': c.bg, '--fg': c.fg, '--panel': mix(c.bg, '#ffffff', 0.04), '--panel2': mix(c.bg, '#ffffff', 0.08),
      '--border': mix(c.bg, '#ffffff', 0.14), '--muted': c.gutterFg, '--accent': c.builtin, '--accent-fg': '#ffffff',
      '--hover': mix(c.bg, '#ffffff', 0.1), '--active': mix(c.bg, c.builtin, 0.28), '--danger': c.invalid, '--ok': c.string === '#ce9178' ? '#89d185' : c.string,
      '--warn': '#cca700', '--sel': c.sel, '--shadow': '0 8px 30px rgba(0,0,0,.5)', 'color-scheme': 'dark',
    }
  }
  return {
    '--bg': c.bg, '--fg': c.fg, '--panel': mix(c.bg, '#000000', 0.03), '--panel2': mix(c.bg, '#000000', 0.06),
    '--border': mix(c.bg, '#000000', 0.13), '--muted': c.gutterFg, '--accent': c.builtin === '#7f007f' ? '#0b6bcb' : c.builtin, '--accent-fg': '#ffffff',
    '--hover': mix(c.bg, '#000000', 0.07), '--active': mix(c.bg, '#0b6bcb', 0.18), '--danger': c.invalid, '--ok': '#1a7f37',
    '--warn': '#9a6700', '--sel': c.sel, '--shadow': '0 8px 30px rgba(0,0,0,.18)', 'color-scheme': 'light',
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
