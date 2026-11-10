// エディタ (CodeMirror) の組み立て
import {
  EditorState, EditorView, Compartment, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor,
  rectangularSelection, crosshairCursor, highlightActiveLine, history, historyKeymap, defaultKeymap, indentWithTab, foldGutter, foldKeymap,
  indentOnInput, bracketMatching, closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap, searchKeymap, highlightSelectionMatches,
  lintKeymap, indentUnit, python, javascript, json, html, css, markdown, Prec, search,
} from '../../vendor/codemirror.js'
import { luauLanguage, indentFold } from './luau-lang.js'
import { editorTheme } from './themes.js'
import { luauCompletionSource, describeAt, signatureAt } from './luau-intel.js'
import { pythonCompletionSource, describePython, pythonSignatureAt } from './python-intel.js'
import { inlineSuggestions, luauAutoEnd } from './inline.js'
import { makeLinter } from './lint.js'
import { colorSwatches, indentGuides, rainbowBrackets, makeHover, signatureHelp, pinchZoom } from './extras.js'

export function langOf(path) {
  const ext = (path.split('.').pop() || '').toLowerCase()
  if (ext === 'lua' || ext === 'luau') return 'luau'
  if (ext === 'py' || ext === 'pyw') return 'python'
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs' || ext === 'ts' || ext === 'jsx' || ext === 'tsx') return 'javascript'
  if (ext === 'json' || ext === 'luaurc') return 'json'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'css') return 'css'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  return 'text'
}

export const LANG_LABELS = { luau: 'Luau', lua: 'Lua', python: 'Python', javascript: 'JavaScript', json: 'JSON', html: 'HTML', css: 'CSS', markdown: 'Markdown', text: 'テキスト' }

function languageExt(lang, path) {
  switch (lang) {
    case 'luau': return luauLanguage
    case 'python': return python()
    case 'javascript': return javascript({ typescript: /\.tsx?$/.test(path), jsx: /\.[jt]sx$/.test(path) })
    case 'json': return json()
    case 'html': return html()
    case 'css': return css()
    case 'markdown': return markdown()
    default: return []
  }
}

export const comps = {
  lang: new Compartment(),
  theme: new Compartment(),
  tab: new Compartment(),
  wrap: new Compartment(),
  gutter: new Compartment(),
  complete: new Compartment(),
  inline: new Compartment(),
  lint: new Compartment(),
  extras: new Compartment(),
  readOnly: new Compartment(),
  activeLine: new Compartment(),
}

// settings: アプリの設定オブジェクト / ctx: { getSettings, path, lang, commands, onUpdate, aiProvider, onScale }
function themeExt(s) {
  return editorTheme(s.theme, s.fontFamily, s.fontSize, s.lineHeight)
}
function tabExt(s, lang) {
  const spaces = lang === 'python' ? true : s.insertSpaces
  const size = lang === 'python' && !s.insertSpaces ? 4 : s.tabSize
  return [EditorState.tabSize.of(size), indentUnit.of(spaces ? ' '.repeat(size) : '\t')]
}
function completeExt(s, lang) {
  const source = lang === 'luau' ? luauCompletionSource : lang === 'python' ? pythonCompletionSource : null
  if (!s.autocomplete) return autocompletion({ activateOnTyping: false, override: source ? [source] : undefined })
  return autocompletion({
    activateOnTyping: true,
    override: source ? [source] : undefined,
    maxRenderedOptions: 60,
    icons: true,
    optionClass: o => (o.deprecated ? 'cm-deprecated' : ''),
    closeOnBlur: true,
    tooltipClass: () => 'fc-complete',
  })
}
function extrasExt(s, lang, ctx) {
  const out = []
  if (s.indentGuides) out.push(indentGuides)
  if (s.rainbowBrackets) out.push(rainbowBrackets)
  if (lang === 'luau' && s.colorPicker) out.push(colorSwatches)
  if (s.hover) {
    if (lang === 'luau') out.push(makeHover(describeAt))
    if (lang === 'python') out.push(makeHover(describePython))
  }
  if (s.signatureHelp) {
    if (lang === 'luau') out.push(signatureHelp(signatureAt, () => true))
    if (lang === 'python') out.push(signatureHelp(pythonSignatureAt, () => true))
  }
  if (s.pinchZoom && ctx.onScale) out.push(pinchZoom(ctx.onScale))
  return out
}

export function buildExtensions(ctx) {
  const s = ctx.getSettings()
  const lang = ctx.lang
  const cmd = ctx.commands
  const appKeys = keymap.of([
    { key: 'Mod-s', run: () => { cmd.save(); return true }, preventDefault: true },
    { key: 'Mod-Enter', run: () => { cmd.run(); return true }, preventDefault: true },
    { key: 'F5', run: () => { cmd.run(); return true }, preventDefault: true },
    { key: 'Shift-Alt-f', run: () => { cmd.format(); return true } },
    { key: 'Mod-p', run: () => { cmd.quickOpen(); return true }, preventDefault: true },
    { key: 'Mod-Shift-p', run: () => { cmd.palette(); return true }, preventDefault: true },
    { key: 'F1', run: () => { cmd.palette(); return true } },
    { key: 'Mod-b', run: () => { cmd.toggleSidebar(); return true } },
    { key: 'Mod-j', run: () => { cmd.togglePanel(); return true } },
    { key: 'Mod-Shift-f', run: () => { cmd.findInFiles(); return true }, preventDefault: true },
    { key: 'Mod-g', run: () => { cmd.gotoLine(); return true }, preventDefault: true },
    { key: 'Mod-w', run: () => { cmd.closeTab(); return true }, preventDefault: true },
    { key: 'Alt-w', run: () => { cmd.closeTab(); return true } },
    { key: 'Mod-Shift-o', run: () => { cmd.outline(); return true }, preventDefault: true },
  ])
  return [
    Prec.highest(appKeys),
    comps.gutter.of(s.lineNumbers ? [lineNumbers(), foldGutter({ openText: '⌄', closedText: '›' })] : [foldGutter({ openText: '⌄', closedText: '›' })]),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    s.autoClose !== false ? closeBrackets() : [],
    rectangularSelection(),
    crosshairCursor(),
    comps.activeLine.of(s.highlightLine ? highlightActiveLine() : []),
    highlightSelectionMatches(),
    search({ top: true }),
    indentFold,
    comps.lang.of(languageExt(lang, ctx.path)),
    comps.theme.of(themeExt(s)),
    comps.tab.of(tabExt(s, lang)),
    comps.wrap.of(s.wordWrap ? EditorView.lineWrapping : []),
    comps.complete.of(completeExt(s, lang)),
    comps.inline.of(inlineSuggestions(() => {
      const st = ctx.getSettings()
      return { enabled: st.inlineSuggest, local: true, lang, ai: st.aiInline && !!st.aiKey, aiProvider: ctx.aiProvider, aiDelay: st.aiDelay, onError: ctx.onAiError }
    })),
    lang === 'luau' ? luauAutoEnd(() => ctx.getSettings().autoEnd) : [],
    comps.lint.of(makeLinter(() => lang, () => {
      const st = ctx.getSettings()
      return { enabled: st.lint, roblox: st.robloxApi, executor: st.executorApi, undefinedGlobals: st.lintUndefined, unused: st.lintUnused }
    })),
    comps.extras.of(extrasExt(s, lang, ctx)),
    comps.readOnly.of(EditorState.readOnly.of(!!ctx.readOnly)),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
    EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off', 'data-gramm': 'false' }),
    EditorView.updateListener.of(u => ctx.onUpdate && ctx.onUpdate(u)),
  ]
}

export function createState(doc, ctx) {
  return EditorState.create({ doc, extensions: buildExtensions(ctx) })
}

// 設定変更をエディタ状態に反映するエフェクト
export function reconfigureEffects(ctx) {
  const s = ctx.getSettings()
  const lang = ctx.lang
  return [
    comps.theme.reconfigure(themeExt(s)),
    comps.tab.reconfigure(tabExt(s, lang)),
    comps.wrap.reconfigure(s.wordWrap ? EditorView.lineWrapping : []),
    comps.gutter.reconfigure(s.lineNumbers ? [lineNumbers(), foldGutter({ openText: '⌄', closedText: '›' })] : [foldGutter({ openText: '⌄', closedText: '›' })]),
    comps.complete.reconfigure(completeExt(s, lang)),
    comps.extras.reconfigure(extrasExt(s, lang, ctx)),
    comps.activeLine.reconfigure(s.highlightLine ? highlightActiveLine() : []),
  ]
}
