// インライン候補 (ゴーストテキスト) — Tab で確定
// ・ルールベースの即時候補 (オフラインで動作)
// ・AI 候補 (設定で Claude API キーを登録した場合)
import { StateField, StateEffect, EditorView, Decoration, WidgetType, ViewPlugin, Prec, keymap, completionStatus, EditorSelection, indentUnit } from '../../vendor/codemirror.js'
import * as db from './apidb.js'
import { tokenize } from '../luau/lexer.js'

export const setGhost = StateEffect.define()

class GhostWidget extends WidgetType {
  constructor(text, source) { super(); this.text = text; this.source = source }
  eq(o) { return o.text === this.text && o.source === this.source }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-ghost' + (this.source === 'ai' ? ' cm-ghost-ai' : '')
    span.textContent = this.text
    span.title = 'Tab で確定 / Esc で閉じる'
    span.addEventListener('mousedown', e => { e.preventDefault(); span.dispatchEvent(new CustomEvent('ghost-accept', { bubbles: true })) })
    return span
  }
  ignoreEvent() { return false }
}

export const ghostField = StateField.define({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setGhost)) return e.value
    if (!value) return null
    if (tr.docChanged) {
      let next = null
      let touched = false
      tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
        touched = true
        if (fromA === value.pos && toA === fromA) {
          const ins = inserted.toString()
          if (ins && value.text.startsWith(ins) && ins.length < value.text.length) {
            next = { ...value, pos: toB, text: value.text.slice(ins.length), cursor: value.cursor !== undefined ? value.cursor - ins.length : undefined }
          }
        }
      })
      return touched ? next : value
    }
    if (tr.selection && tr.state.selection.main.head !== value.pos) return null
    return value
  },
  provide: f => EditorView.decorations.from(f, v => v ? Decoration.set([Decoration.widget({ widget: new GhostWidget(v.text, v.source), side: 1 }).range(v.pos)]) : Decoration.none),
})

export function hasGhost(state) { return !!state.field(ghostField, false) }

export function acceptGhost(view, partial = false) {
  const g = view.state.field(ghostField, false)
  if (!g) return false
  let text = g.text
  if (partial) {
    const m = /^(\s*[\w]+|\s*[^\w\s]+|\s+)/.exec(text)
    text = m ? m[0] : text
  }
  const cursor = !partial && g.cursor !== undefined ? g.pos + g.cursor : g.pos + text.length
  view.dispatch({
    changes: { from: g.pos, insert: text },
    selection: EditorSelection.cursor(cursor),
    effects: setGhost.of(partial && text.length < g.text.length ? { ...g, pos: g.pos + text.length, text: g.text.slice(text.length), cursor: g.cursor !== undefined ? g.cursor - text.length : undefined } : null),
    userEvent: 'input.complete',
    scrollIntoView: true,
  })
  return true
}

export function dismissGhost(view) {
  if (!view.state.field(ghostField, false)) return false
  view.dispatch({ effects: setGhost.of(null) })
  return true
}

// ============================================================
// ルールベースの候補
// ============================================================
const SERVICE_ALIASES = { UIS: 'UserInputService', CAS: 'ContextActionService', RS: 'ReplicatedStorage', SSS: 'ServerScriptService', SS: 'ServerStorage', TS: 'TweenService', DSS: 'DataStoreService', HS: 'HttpService', MPS: 'MarketplaceService', Http: 'HttpService', Tween: 'TweenService', Input: 'UserInputService', Run: 'RunService', Rep: 'ReplicatedStorage', Storage: 'ReplicatedStorage', LP: 'Players' }

function serviceFor(varName) {
  if (SERVICE_ALIASES[varName]) return SERVICE_ALIASES[varName]
  const names = db.serviceNames()
  const lower = varName.toLowerCase()
  const exact = names.find(n => n.toLowerCase() === lower)
  if (exact) return exact
  const svc = names.find(n => n.toLowerCase() === lower + 'service')
  return svc || null
}

function indentOf(text) { return /^\s*/.exec(text)[0] }

export function luauLocalSuggest(state, pos) {
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  const after = line.text.slice(pos - line.from)
  if (after.trim() && !/^[)"'\]}]*\s*$/.test(after)) return null
  if (!before.trim()) return null
  const unit = state.facet(indentUnit)
  const ind = indentOf(line.text)
  let m

  // local Players = → game:GetService("Players")
  if ((m = /^\s*local\s+([A-Za-z_]\w*)\s*=\s*$/.exec(before))) {
    const svc = serviceFor(m[1])
    if (svc) return { text: (before.endsWith(' ') ? '' : ' ') + `game:GetService("${svc}")` }
    if (/^(player|plr|localPlayer|LocalPlayer)$/.test(m[1])) return { text: (before.endsWith(' ') ? '' : ' ') + 'game:GetService("Players").LocalPlayer' }
    if (/^(char|character|Character)$/.test(m[1])) return { text: (before.endsWith(' ') ? '' : ' ') + 'player.Character or player.CharacterAdded:Wait()' }
    if (/^(humanoid|hum|Humanoid)$/.test(m[1])) return { text: (before.endsWith(' ') ? '' : ' ') + 'character:WaitForChild("Humanoid")' }
    if (/^(root|hrp|rootPart|HumanoidRootPart)$/.test(m[1])) return { text: (before.endsWith(' ') ? '' : ' ') + 'character:WaitForChild("HumanoidRootPart")' }
    if (/^(mouse|Mouse)$/.test(m[1])) return { text: (before.endsWith(' ') ? '' : ' ') + 'player:GetMouse()' }
    if (/^(camera|cam|Camera)$/.test(m[1])) return { text: (before.endsWith(' ') ? '' : ' ') + 'workspace.CurrentCamera' }
    return null
  }
  // GetService("Play → ers")
  if ((m = /:GetService\(\s*["']([A-Za-z]+)$/.exec(before))) {
    const typed = m[1]
    const cands = db.serviceNames().filter(n => n.startsWith(typed))
    const pick = cands.find(n => ['Players', 'ReplicatedStorage', 'RunService', 'UserInputService', 'TweenService', 'Workspace', 'Lighting', 'HttpService', 'DataStoreService', 'ServerStorage', 'ServerScriptService', 'StarterGui', 'TeleportService', 'MarketplaceService'].includes(n)) || (cands.length === 1 ? cands[0] : null)
    if (pick && pick !== typed) return { text: pick.slice(typed.length) + (after.startsWith('"') || after.startsWith("'") ? '' : '")') }
    return null
  }
  // :Connect( → function() ... end)
  if (/:(Connect|Once|ConnectParallel)\(\s*$/.test(before)) {
    const closing = after.startsWith(')') ? '' : ')'
    const head = 'function()\n'
    const body = ind + unit
    return { text: head + body + '\n' + ind + 'end' + closing, cursor: head.length + body.length }
  }
  // for i = → 1, 10 do
  if (/^\s*for\s+[A-Za-z_]\w*\s*=\s*$/.test(before)) return { text: (before.endsWith(' ') ? '' : ' ') + '1, 10 do' }
  // for _, player in → ipairs(Players:GetPlayers()) do
  if ((m = /^\s*for\s+([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s+in\s+$/.exec(before))) {
    const v = m[2]
    const text = state.doc.sliceString(0, pos)
    if (/^(player|plr|p)$/i.test(v)) {
      const pm = /local\s+(\w+)\s*=\s*game:GetService\(["']Players["']\)/.exec(text)
      return { text: `ipairs(${pm ? pm[1] : 'game:GetService("Players")'}:GetPlayers()) do` }
    }
    if (/^(child|obj|object|inst|instance|part|descendant|item)$/i.test(v)) return { text: v.toLowerCase() === 'descendant' ? 'ipairs(workspace:GetDescendants()) do' : 'ipairs(workspace:GetChildren()) do' }
    const plural = new RegExp(`\\b(${v}s|${v}List|${v}es)\\b`)
    const pl = plural.exec(text)
    if (pl) return { text: `ipairs(${pl[1]}) do` }
    if (m[1] !== '_' && /^(k|key)$/.test(m[1])) return { text: 'pairs() do', cursor: 6 }
    return null
  }
  // if 条件 → then / while 条件 → do / for ... → do
  if ((m = /^\s*(if|elseif)\s+(.+?)\s*$/.exec(before)) && !/\bthen\b/.test(before) && balanced(m[2]) && !/(and|or|not|==|~=|[<>=+\-*/.,(]|\.\.)$/.test(m[2].trim())) {
    return { text: (before.endsWith(' ') ? '' : ' ') + 'then' }
  }
  if ((m = /^\s*while\s+(.+?)\s*$/.exec(before)) && !/\bdo\b/.test(before) && balanced(m[1]) && !/(and|or|not|==|~=|[<>=+\-*/.,(])$/.test(m[1].trim())) {
    return { text: (before.endsWith(' ') ? '' : ' ') + 'do' }
  }
  if (/^\s*for\s+.+\bin\s+.+[)\w]\s*$/.test(before) && !/\bdo\b/.test(before) && balanced(before)) return { text: (before.endsWith(' ') ? '' : ' ') + 'do' }
  if (/^\s*for\s+\w+\s*=\s*[^,]+,\s*[^,]+[)\w]\s*$/.test(before) && !/\bdo\b/.test(before) && balanced(before)) return { text: (before.endsWith(' ') ? '' : ' ') + 'do' }
  // Instance.new("Pa → rt")
  if ((m = /Instance\.new\(\s*["']([A-Za-z]+)$/.exec(before))) {
    const typed = m[1]
    const common = ['Part', 'Model', 'Folder', 'ScreenGui', 'Frame', 'TextLabel', 'TextButton', 'ImageLabel', 'TextBox', 'RemoteEvent', 'RemoteFunction', 'BindableEvent', 'IntValue', 'StringValue', 'BoolValue', 'NumberValue', 'Sound', 'PointLight', 'Attachment', 'WeldConstraint', 'Highlight', 'BillboardGui', 'UICorner', 'UIStroke', 'UIListLayout', 'Tool', 'ProximityPrompt', 'ClickDetector', 'Animation', 'ParticleEmitter']
    const pick = common.find(n => n.startsWith(typed) && n !== typed)
    if (pick) return { text: pick.slice(typed.length) + (after.startsWith('"') || after.startsWith("'") ? '' : '")') }
  }
  // local function name( → ) は closeBrackets に任せる
  return null
}

function balanced(s) {
  let d = 0
  for (const c of s.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '')) {
    if ('([{'.includes(c)) d++
    else if (')]}'.includes(c)) d--
  }
  return d === 0
}

export function pythonLocalSuggest(state, pos) {
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  const after = line.text.slice(pos - line.from)
  if (after.trim() && !/^[)"'\]}]*\s*$/.test(after)) return null
  let m
  if ((m = /^\s*(if|elif|while|for|def|class|with|except)\b(.*\S)?\s*$/.exec(before)) && !before.trimEnd().endsWith(':') && balanced(before) && (m[2] || m[1] === 'except')) {
    if (/(and|or|not|==|!=|[<>=+\-*/.,(])$/.test((m[2] || '').trim())) return null
    if (m[1] === 'def' && !/\)\s*(->\s*\S+)?$/.test(before)) return null
    if (m[1] === 'for' && !/\bin\b\s+\S/.test(before)) {
      if (/\bfor\s+\w+\s*$/.test(before)) return { text: ' in range(10):' }
      return null
    }
    return { text: ':' }
  }
  if ((m = /^\s*(else|try|finally)\s*$/.exec(before))) return { text: ':' }
  if (/^\s*if\s+__name__\s*$/.test(before)) return { text: ' == "__main__":' }
  return null
}

// ============================================================
// プロバイダ (入力のたびに候補を計算)
// ============================================================
export function inlineSuggestions(getConfig) {
  return [
    ghostField,
    ViewPlugin.fromClass(class {
      constructor(view) { this.view = view; this.timer = null; this.reqId = 0 }
      update(u) {
        const cfg = getConfig()
        if (!cfg.enabled) return
        if (!u.docChanged) return
        const userTyped = u.transactions.some(tr => tr.isUserEvent('input.type') || tr.isUserEvent('input.complete'))
        if (!userTyped) return
        const view = this.view
        clearTimeout(this.timer)
        // 既存のゴーストがあり、入力と一致して残っていれば何もしない
        if (view.state.field(ghostField, false)) return
        const run = () => {
          const state = view.state
          const sel = state.selection.main
          if (!sel.empty || completionStatus(state) === 'active') return
          const pos = sel.head
          let sug = null
          if (cfg.local !== false) sug = cfg.lang === 'python' ? pythonLocalSuggest(state, pos) : cfg.lang === 'luau' ? luauLocalSuggest(state, pos) : null
          if (sug) {
            view.dispatch({ effects: setGhost.of({ pos, text: sug.text, cursor: sug.cursor, source: 'local' }) })
            return
          }
          if (cfg.ai && cfg.aiProvider) {
            clearTimeout(this.timer)
            const id = ++this.reqId
            const docAt = state.doc
            this.timer = setTimeout(async () => {
              if (view.state.doc !== docAt || view.state.selection.main.head !== pos) return
              try {
                const text = await cfg.aiProvider(view.state, pos)
                if (id !== this.reqId || view.state.doc !== docAt || view.state.selection.main.head !== pos) return
                if (text && text.trim()) view.dispatch({ effects: setGhost.of({ pos, text, source: 'ai' }) })
              } catch (e) {
                if (cfg.onError) cfg.onError(e)
              }
            }, cfg.aiDelay || 700)
          }
        }
        // 補完ポップアップが開く前に評価されないよう少し遅らせる
        this.timer = setTimeout(run, 60)
      }
      destroy() { clearTimeout(this.timer) }
    }),
    Prec.highest(keymap.of([
      { key: 'Tab', run: v => acceptGhost(v) },
      { key: 'Mod-ArrowRight', run: v => acceptGhost(v, true) },
      { key: 'Escape', run: dismissGhost },
    ])),
    EditorView.domEventHandlers({ 'ghost-accept': (e, view) => { acceptGhost(view); return true } }),
  ]
}

// ============================================================
// Enter で end を自動挿入 (Luau)
// ============================================================
function blockBalance(text) {
  let toks
  try { toks = tokenize(text).tokens } catch { return 1 }
  let bal = 0
  let pendingDo = 0
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i].t
    if (t === 'function' || t === 'if' || t === 'repeat') bal++
    else if (t === 'while' || t === 'for') { bal++; pendingDo++ }
    else if (t === 'do') { if (pendingDo > 0) pendingDo--; else bal++ }
    else if (t === 'end' || t === 'until') bal--
  }
  return bal
}

export function luauAutoEnd(enabled) {
  return Prec.high(keymap.of([{
    key: 'Enter',
    run(view) {
      if (!enabled()) return false
      const { state } = view
      const sel = state.selection.main
      if (!sel.empty || state.selection.ranges.length > 1) return false
      if (completionStatus(state) === 'active') return false
      const line = state.doc.lineAt(sel.head)
      const before = line.text.slice(0, sel.head - line.from)
      const after = line.text.slice(sel.head - line.from)
      const code = before.replace(/--.*$/, '').trimEnd()
      let closer = null
      if (/\b(then|do)$/.test(code) || /\bfunction\b[^()]*\([^()]*\)(\s*:\s*[^=]+)?$/.test(code) || /^\s*(else|elseif\b.*then)$/.test(code)) closer = 'end'
      else if (/^\s*repeat$/.test(code)) closer = 'until '
      if (!closer) return false
      if (/^\s*(else|elseif)/.test(code) && closer === 'end') return false
      const ind = indentOf(line.text)
      const unit = state.facet(indentUnit)
      // 既に閉じられているなら挿入しない
      if (blockBalance(state.doc.toString()) <= 0) return false
      const trailing = after.trim()
      const insert = '\n' + ind + unit + '\n' + ind + closer + (trailing ? trailing : '')
      view.dispatch({
        changes: { from: sel.head, to: line.to, insert },
        selection: EditorSelection.cursor(sel.head + 1 + ind.length + unit.length),
        userEvent: 'input',
        scrollIntoView: true,
      })
      return true
    },
  }]))
}
