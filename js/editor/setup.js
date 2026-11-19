// エディタ (CodeMirror) の組み立て — Python
import {
  EditorState, EditorView, Compartment, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor,
  rectangularSelection, crosshairCursor, highlightActiveLine, history, historyKeymap, defaultKeymap, indentWithTab, foldGutter, foldKeymap,
  indentOnInput, bracketMatching, closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap, searchKeymap, highlightSelectionMatches,
  lintKeymap, indentUnit, json, Prec, search,
} from '../../vendor/codemirror.js'
import { markdownLanguage, indentFold } from './langs.js'
import { editorTheme } from './themes.js'
import { indentGuides, rainbowBrackets, pinchZoom } from './extras.js'
import { errorLens, runErrorMarks } from './errorlens.js'
import { breakpointGutter, debugHover } from './breakpoints.js'
import { pythonLanguage, pythonCompletionSource, pythonLinter, pythonHover, pythonSignatureHelp, pythonInputFixer, pythonAutoCorrect } from './python.js'
import { stickyScroll } from './sticky.js'
import { pySemantic } from './semantic.js'
import { aiGhost } from './ghost.js'

export function langOf(path) {
  const ext = (path.split('.').pop() || '').toLowerCase()
  if (ext === 'py' || ext === 'pyw' || ext === 'pyi') return 'python'
  if (ext === 'json' || ext === 'ipynb') return 'json'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  return 'text'
}

export const LANG_LABELS = { python: 'Python', json: 'JSON', markdown: 'Markdown', text: 'テキスト' }

function languageExt(lang) {
  switch (lang) {
    case 'python': return pythonLanguage()
    case 'json': return json()
    case 'markdown': return markdownLanguage
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
  extras: new Compartment(),
  readOnly: new Compartment(),
  activeLine: new Compartment(),
  brackets: new Compartment(),
}

function themeExt(s) {
  return editorTheme(s.theme, s.fontFamily, s.fontSize, s.lineHeight)
}
function tabExt(s) {
  // Python はスペース 4 つが標準
  return [EditorState.tabSize.of(s.tabSize), indentUnit.of(s.insertSpaces ? ' '.repeat(s.tabSize) : '\t')]
}
function gutterExt(s) {
  const fold = foldGutter({ openText: '⌄', closedText: '›' })
  return s.lineNumbers ? [lineNumbers(), fold] : [fold]
}
function completeExt(s, lang, ctx) {
  const source = lang === 'python' ? pythonCompletionSource(() => ctx.path) : null
  if (!s.autocomplete) return autocompletion({ activateOnTyping: false, override: source ? [source] : undefined })
  return autocompletion({
    activateOnTyping: true,
    override: source ? [source] : undefined,
    maxRenderedOptions: 60,
    icons: true,
    closeOnBlur: true,
    interactionDelay: 60,
    tooltipClass: () => 'fc-complete',
  })
}
function extrasExt(s, lang, ctx) {
  const out = []
  if (s.indentGuides) out.push(indentGuides)
  if (s.rainbowBrackets) out.push(Prec.highest(rainbowBrackets))
  // 同じ単語をハイライト (カーソルのある単語も)
  out.push(highlightSelectionMatches({ minSelectionLength: 2, highlightWordAroundCursor: !!s.highlightSymbols }))
  if (lang === 'python') {
    out.push(pySemantic)
    if (s.stickyScroll) out.push(stickyScroll())
    if (s.hover) out.push(pythonHover(() => ctx.path))
    if (s.signatureHelp) out.push(pythonSignatureHelp(() => ctx.path, () => true))
    if (s.errorLens) out.push(errorLens(ctx.onLensTap))
  }
  if (s.pinchZoom && ctx.onScale) out.push(pinchZoom(ctx.onScale))
  return out
}

export function buildExtensions(ctx) {
  const s = ctx.getSettings()
  const lang = ctx.lang
  const cmd = ctx.commands
  const st = () => ctx.getSettings()
  const appKeys = keymap.of([
    { key: 'Mod-s', run: () => { cmd.save(); return true }, preventDefault: true },
    { key: 'Mod-Enter', run: () => { cmd.run(); return true }, preventDefault: true },
    // F5: デバッガーで止まっていれば続行、そうでなければ実行
    { key: 'F5', run: () => { if (ctx.isPaused && ctx.isPaused()) cmd.command('debugContinue'); else cmd.run(); return true }, preventDefault: true },
    { key: 'Shift-F5', run: () => { cmd.command('stop'); return true }, preventDefault: true },
    { key: 'F9', run: () => { cmd.command('toggleBreakpoint'); return true }, preventDefault: true },
    { key: 'F10', run: () => { cmd.command('debugStepOver'); return true }, preventDefault: true },
    { key: 'F11', run: () => { cmd.command('debugStepInto'); return true }, preventDefault: true },
    { key: 'Shift-F11', run: () => { cmd.command('debugStepOut'); return true }, preventDefault: true },
    { key: 'F12', run: () => { cmd.command('gotoDefinition'); return true }, preventDefault: true },
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
    { key: 'Mod-.', run: () => { cmd.quickFix(); return true }, preventDefault: true },
    // AI: 続きを提案 / 選択範囲を頼む / パネルを開く
    { key: 'Alt-\\', run: () => { cmd.command('aiSuggest'); return true }, preventDefault: true },
    { key: 'Mod-i', run: () => { cmd.command('aiSelectionMenu'); return true }, preventDefault: true },
    { key: 'Mod-Shift-i', run: () => { cmd.command('aiChat'); return true }, preventDefault: true },
  ])
  const py = lang === 'python'
  return [
    Prec.highest(appKeys),
    py && ctx.onBreakpoints ? breakpointGutter(ctx.onBreakpoints, ctx.getBreakpoints ? ctx.getBreakpoints() : [], ctx.onBreakpointEdit) : [],
    comps.gutter.of(gutterExt(s)),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    comps.brackets.of(s.autoClose !== false ? closeBrackets() : []),
    rectangularSelection(),
    crosshairCursor(),
    comps.activeLine.of(s.highlightLine ? highlightActiveLine() : []),
    search({ top: true }),
    indentFold,
    comps.lang.of(languageExt(lang)),
    comps.theme.of(themeExt(s)),
    comps.tab.of(tabExt(s)),
    comps.wrap.of(s.wordWrap ? EditorView.lineWrapping : []),
    comps.complete.of(completeExt(s, lang, ctx)),
    py ? pythonInputFixer(() => st().fixInput, ctx.onFix) : [],
    py ? pythonAutoCorrect(() => st().autoCorrect, ctx.onFix) : [],
    py ? pythonLinter(() => { const c = st(); return { enabled: c.lint, unused: c.lintUnused, undefined: c.lintUndefined, path: ctx.path } }) : [],
    py && ctx.aiProvider ? aiGhost(() => { const c = st(); return { enabled: c.aiInline, delay: c.aiDelay, provider: ctx.aiProvider } }) : [],
    comps.extras.of(extrasExt(s, lang, ctx)),
    py ? runErrorMarks : [],
    py && ctx.debugValue ? debugHover(ctx.debugValue) : [],
    comps.readOnly.of(EditorState.readOnly.of(!!ctx.readOnly)),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
    EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off', 'data-gramm': 'false', enterkeyhint: 'enter' }),
    EditorView.updateListener.of(u => ctx.onUpdate && ctx.onUpdate(u)),
  ]
}

export function createState(doc, ctx, extra = {}) {
  return EditorState.create({ doc, extensions: buildExtensions(ctx), ...extra })
}

// 設定の変更をエディタ状態に反映するエフェクト
export function reconfigureEffects(ctx) {
  const s = ctx.getSettings()
  const lang = ctx.lang
  return [
    comps.theme.reconfigure(themeExt(s)),
    comps.tab.reconfigure(tabExt(s)),
    comps.wrap.reconfigure(s.wordWrap ? EditorView.lineWrapping : []),
    comps.gutter.reconfigure(gutterExt(s)),
    comps.complete.reconfigure(completeExt(s, lang, ctx)),
    comps.extras.reconfigure(extrasExt(s, lang, ctx)),
    comps.activeLine.reconfigure(s.highlightLine ? highlightActiveLine() : []),
    comps.brackets.reconfigure(s.autoClose !== false ? closeBrackets() : []),
  ]
}
