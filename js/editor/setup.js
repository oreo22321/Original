// エディタ (CodeMirror) の組み立て — Luau 専用
import {
  EditorState, EditorView, Compartment, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor,
  rectangularSelection, crosshairCursor, highlightActiveLine, history, historyKeymap, defaultKeymap, indentWithTab, foldGutter, foldKeymap,
  indentOnInput, bracketMatching, closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap, searchKeymap, highlightSelectionMatches,
  lintKeymap, indentUnit, json, Prec, search,
} from '../../vendor/codemirror.js'
import { luauFor, markdownLanguage, indentFold } from './luau-lang.js'
import { editorTheme } from './themes.js'
import { luauCompletionSource, describeAt, signatureAt } from './luau-intel.js'
import { inlineSuggestions, luauAutoEnd } from './inline.js'
import { makeLinter } from './lint.js'
import { colorSwatches, indentGuides, rainbowBrackets, makeHover, signatureHelp, pinchZoom } from './extras.js'
import { inputFixer, keywordAutoCorrect } from './typo.js'
import { errorLens, runErrorMarks } from './errorlens.js'
import { autoEndPairs } from './autoend.js'
import { breakpointGutter, debugHover } from './breakpoints.js'
import { symbolHighlight, stickyScroll } from './symbols.js'
import { autoFormat } from './autoformat.js'

export function langOf(path) {
  const ext = (path.split('.').pop() || '').toLowerCase()
  if (ext === 'lua' || ext === 'luau') return 'luau'
  if (ext === 'json' || ext === 'luaurc') return 'json'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  return 'text'
}

// Studio モードでのスクリプトの種類 (Rojo と同じ命名規則)
export function scriptKindOf(path, mode) {
  if (langOf(path) !== 'luau') return null
  if (mode === 'executor') return 'executor'
  if (/\.server\.luau?$/i.test(path)) return 'server'
  if (/\.client\.luau?$/i.test(path)) return 'client'
  return 'module'
}

export const LANG_LABELS = { luau: 'Luau', json: 'JSON', markdown: 'Markdown', text: 'テキスト' }
export const KIND_LABELS = { server: 'Script (サーバー)', client: 'LocalScript (クライアント)', module: 'ModuleScript', executor: 'Executor' }

function languageExt(lang, mode) {
  switch (lang) {
    case 'luau': return luauFor(mode)
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

// ctx: { getSettings, getMode, path, lang, commands, onUpdate, aiProvider, onScale, onFix, onLensTap }
function themeExt(s) {
  return editorTheme(s.theme, s.fontFamily, s.fontSize, s.lineHeight)
}
function tabExt(s) {
  return [EditorState.tabSize.of(s.tabSize), indentUnit.of(s.insertSpaces ? ' '.repeat(s.tabSize) : '\t')]
}
function gutterExt(s) {
  const fold = foldGutter({ openText: '⌄', closedText: '›' })
  return s.lineNumbers ? [lineNumbers(), fold] : [fold]
}
function completeExt(s, lang) {
  const source = lang === 'luau' ? luauCompletionSource : null
  if (!s.autocomplete) return autocompletion({ activateOnTyping: false, override: source ? [source] : undefined })
  return autocompletion({
    activateOnTyping: true,
    override: source ? [source] : undefined,
    maxRenderedOptions: 50,
    icons: true,
    optionClass: o => (o.deprecated ? 'cm-deprecated' : ''),
    closeOnBlur: true,
    interactionDelay: 60,
    tooltipClass: () => 'fc-complete',
  })
}
function extrasExt(s, lang, ctx) {
  const out = []
  if (s.indentGuides) out.push(indentGuides)
  if (s.rainbowBrackets) out.push(rainbowBrackets)
  if (lang === 'luau') {
    if (s.colorPicker) out.push(colorSwatches)
    if (s.hover) out.push(makeHover(describeAt))
    if (s.signatureHelp) out.push(signatureHelp(signatureAt, () => true))
    if (s.errorLens) out.push(errorLens(ctx.onLensTap))
    if (s.highlightSymbols !== false) out.push(symbolHighlight)
    if (s.stickyScroll !== false) out.push(stickyScroll(3))
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
    { key: 'Shift-F12', run: () => { cmd.command('findReferences'); return true }, preventDefault: true },
    { key: 'F2', run: () => { cmd.command('renameSymbol'); return true }, preventDefault: true },
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
    // Claude: 続きを提案 / 選択範囲を頼む / パネルを開く
    { key: 'Alt-\\', run: () => { cmd.command('aiSuggest'); return true }, preventDefault: true },
    { key: 'Mod-i', run: () => { cmd.command('aiSelectionMenu'); return true }, preventDefault: true },
    { key: 'Mod-Shift-i', run: () => { cmd.command('aiChat'); return true }, preventDefault: true },
  ])
  const luau = lang === 'luau'
  return [
    Prec.highest(appKeys),
    luau && ctx.onBreakpoints ? breakpointGutter(ctx.onBreakpoints, ctx.getBreakpoints ? ctx.getBreakpoints() : [], ctx.onBreakpointEdit) : [],
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
    highlightSelectionMatches({ minSelectionLength: 2 }),
    search({ top: true }),
    indentFold,
    comps.lang.of(languageExt(lang, ctx.getMode())),
    comps.theme.of(themeExt(s)),
    comps.tab.of(tabExt(s)),
    comps.wrap.of(s.wordWrap ? EditorView.lineWrapping : []),
    comps.complete.of(completeExt(s, lang)),
    // 誤字対策 (設定はその都度読むので再構成は不要)
    luau ? inputFixer(() => st().fixInput, ctx.onFix) : [],
    luau ? keywordAutoCorrect(() => st().autoCorrect, ctx.onFix) : [],
    luau ? inlineSuggestions(() => {
      const c = st()
      return { enabled: c.inlineSuggest, mode: ctx.getMode(), ai: c.aiInline && !!(ctx.aiReady && ctx.aiReady()), aiProvider: ctx.aiProvider, aiDelay: c.aiDelay, onError: ctx.onAiError }
    }) : [],
    luau ? luauAutoEnd(() => st().autoEnd) : [],
    luau && !ctx.readOnly ? autoFormat(() => ({ enabled: st().autoFormat !== false }), ctx.onAutoFormat) : [],
    luau ? autoEndPairs(() => { const c = st(); return { insert: c.autoEnd, remove: c.autoEndDelete !== false } }) : [],
    luau ? makeLinter(() => {
      const c = st()
      const mode = ctx.getMode()
      return { enabled: c.lint, executor: mode === 'executor', undefinedGlobals: c.lintUndefined, unused: c.lintUnused, typos: c.lintTypos, scriptKind: scriptKindOf(ctx.path, mode) }
    }) : [],
    comps.extras.of(extrasExt(s, lang, ctx)),
    luau ? runErrorMarks : [],
    luau && ctx.debugValue ? debugHover(ctx.debugValue) : [],
    comps.readOnly.of(EditorState.readOnly.of(!!ctx.readOnly)),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
    EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off', 'data-gramm': 'false', enterkeyhint: 'enter' }),
    EditorView.updateListener.of(u => ctx.onUpdate && ctx.onUpdate(u)),
  ]
}

export function createState(doc, ctx, extra = {}) {
  return EditorState.create({ doc, extensions: buildExtensions(ctx), ...extra })
}

// 設定・モードの変更をエディタ状態に反映するエフェクト
export function reconfigureEffects(ctx, what = null) {
  const s = ctx.getSettings()
  const lang = ctx.lang
  if (what === 'mode') return lang === 'luau' ? [comps.lang.reconfigure(languageExt(lang, ctx.getMode()))] : []
  return [
    comps.theme.reconfigure(themeExt(s)),
    comps.tab.reconfigure(tabExt(s)),
    comps.wrap.reconfigure(s.wordWrap ? EditorView.lineWrapping : []),
    comps.gutter.reconfigure(gutterExt(s)),
    comps.complete.reconfigure(completeExt(s, lang)),
    comps.extras.reconfigure(extrasExt(s, lang, ctx)),
    comps.activeLine.reconfigure(s.highlightLine ? highlightActiveLine() : []),
    comps.brackets.reconfigure(s.autoClose !== false ? closeBrackets() : []),
  ]
}
