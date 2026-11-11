// インライン候補 (ゴーストテキスト) — Tab で確定
// ・ルールベースの即時候補 (オフラインで動作)
// ・AI 候補 (設定で Claude API キーを登録した場合)
import { StateField, StateEffect, EditorView, Decoration, WidgetType, ViewPlugin, Prec, keymap, completionStatus, EditorSelection, indentUnit, Annotation } from '../../vendor/codemirror.js'
import * as db from './apidb.js'
import { headerAt } from './blocks.js'
import { resolveChain, parseChain, docText } from './luau-intel.js'
import { inStringOrComment } from './typo.js'

export const setGhost = StateEffect.define()
const ghostDismiss = Annotation.define()

class GhostWidget extends WidgetType {
  constructor(text, source) { super(); this.text = text; this.source = source }
  eq(o) { return o.text === this.text && o.source === this.source }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-ghost' + (this.source === 'ai' ? ' cm-ghost-ai' : '')
    span.textContent = this.text
    span.setAttribute('aria-hidden', 'true')
    // タップ・クリックで確定
    const accept = e => { e.preventDefault(); span.dispatchEvent(new CustomEvent('ghost-accept', { bubbles: true })) }
    span.addEventListener('mousedown', accept)
    span.addEventListener('touchend', accept)
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
  view.dispatch({ effects: setGhost.of(null), annotations: ghostDismiss.of(true) })
  return true
}

// ============================================================
// ルールベースの候補 (オフラインで即座に出る)
//  1. 文法の続き (then / do / 関数の本体)
//  2. Roblox の定番 (GetService、イベントの引数、コンストラクタの引数)
//  3. このファイルから学ぶ候補 (似た行の続き・同じ並びのくり返し)
// ============================================================
const SERVICE_ALIASES = { UIS: 'UserInputService', CAS: 'ContextActionService', RS: 'ReplicatedStorage', SSS: 'ServerScriptService', SS: 'ServerStorage', TS: 'TweenService', DSS: 'DataStoreService', HS: 'HttpService', MPS: 'MarketplaceService', Http: 'HttpService', Tween: 'TweenService', Input: 'UserInputService', Run: 'RunService', Rep: 'ReplicatedStorage', Storage: 'ReplicatedStorage', Debris: 'Debris', CG: 'CoreGui', VIM: 'VirtualInputManager', VU: 'VirtualUser', TPS: 'TeleportService', PPS: 'ProximityPromptService' }
const COMMON_SERVICES = ['Players', 'ReplicatedStorage', 'RunService', 'UserInputService', 'TweenService', 'Workspace', 'Lighting', 'HttpService', 'DataStoreService', 'ServerStorage', 'ServerScriptService', 'StarterGui', 'TeleportService', 'MarketplaceService', 'CoreGui', 'SoundService', 'Debris', 'CollectionService', 'ContextActionService', 'PathfindingService', 'TextChatService', 'VirtualUser', 'VirtualInputManager']
const COMMON_CLASSES = ['Part', 'Model', 'Folder', 'ScreenGui', 'Frame', 'TextLabel', 'TextButton', 'ImageLabel', 'TextBox', 'ScrollingFrame', 'RemoteEvent', 'RemoteFunction', 'BindableEvent', 'IntValue', 'StringValue', 'BoolValue', 'NumberValue', 'ObjectValue', 'Sound', 'PointLight', 'Attachment', 'WeldConstraint', 'Highlight', 'BillboardGui', 'UICorner', 'UIStroke', 'UIListLayout', 'UIPadding', 'UIGradient', 'Tool', 'ProximityPrompt', 'ClickDetector', 'Animation', 'ParticleEmitter', 'BodyVelocity', 'LinearVelocity', 'ImageButton']
// 変数名から推測する初期値
const VALUE_HINTS = [
  [/^(player|plr|localPlayer|LocalPlayer|lp|LP)$/, 'game:GetService("Players").LocalPlayer', src => { const m = /local\s+(\w+)\s*=\s*game:GetService\(["']Players["']\)/.exec(src); return m ? m[1] + '.LocalPlayer' : null }],
  [/^(char|character|Character)$/, 'player.Character or player.CharacterAdded:Wait()'],
  [/^(humanoid|hum|Humanoid)$/, 'character:WaitForChild("Humanoid")'],
  [/^(root|hrp|rootPart|HumanoidRootPart|HRP)$/, 'character:WaitForChild("HumanoidRootPart")'],
  [/^(mouse|Mouse)$/, 'player:GetMouse()'],
  [/^(camera|cam|Camera)$/, 'workspace.CurrentCamera'],
  [/^(playerGui|PlayerGui|pgui)$/, 'player:WaitForChild("PlayerGui")'],
  [/^(backpack|Backpack)$/, 'player:WaitForChild("Backpack")'],
  [/^(leaderstats|stats)$/, 'player:WaitForChild("leaderstats")'],
  [/^(animator|Animator)$/, 'humanoid:WaitForChild("Animator")'],
]
// 変数名の当てはめ (候補の中の player / character などを、実際に宣言されている名前へ)
const ROLE_NAMES = { player: /^(player|plr|localPlayer|LocalPlayer|lp|LP)$/, character: /^(character|char|Character)$/, humanoid: /^(humanoid|hum|Humanoid)$/ }
function adaptNames(text, src) {
  return text.replace(/\b(player|character|humanoid)\b/g, role => {
    const re = /\blocal\s+([A-Za-z_]\w*)\s*=/g
    let m, found = null
    while ((m = re.exec(src))) if (ROLE_NAMES[role].test(m[1])) found = m[1]
    return found || role
  })
}
// コンストラクタの引数のひな形
const CTOR_ARGS = {
  'Vector3.new': '0, 0, 0)', 'Vector2.new': '0, 0)', 'CFrame.new': '0, 0, 0)', 'CFrame.Angles': '0, 0, 0)', 'Color3.fromRGB': '255, 255, 255)', 'Color3.new': '1, 1, 1)', 'Color3.fromHex': '"#ffffff")',
  'UDim2.new': '0, 0, 0, 0)', 'UDim2.fromScale': '1, 1)', 'UDim2.fromOffset': '100, 100)', 'UDim.new': '0, 8)', 'TweenInfo.new': '0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)',
  'Instance.new': '"Part")', 'NumberRange.new': '0, 1)', 'Random.new': ')', 'RaycastParams.new': ')', 'BrickColor.new': '"Bright red")', 'Rect.new': '0, 0, 0, 0)',
}
// 関数を引数に取る呼び出し
const CALLBACK_CALLS = { 'task.spawn': '', 'task.defer': '', 'coroutine.wrap': '', 'coroutine.create': '', pcall: '', spawn: '', 'task.delay': null, delay: null, xpcall: '' }
const PARAM_NAMES = { otherPart: 'hit', gameProcessedEvent: 'gameProcessed', deltaTime: 'dt', inputObject: 'input', arguments: '...', descendant: 'descendant', child: 'child', playerWhoTriggered: 'player', playerWhoClicked: 'player' }

function serviceFor(varName) {
  if (SERVICE_ALIASES[varName]) return SERVICE_ALIASES[varName]
  const names = db.serviceNames()
  const lower = varName.toLowerCase()
  const exact = names.find(n => n.toLowerCase() === lower)
  if (exact) return exact
  const svc = names.find(n => n.toLowerCase() === lower + 'service')
  return svc || null
}

function indentOf(text) { return /^[ \t]*/.exec(text)[0] }

function balanced(s) {
  let d = 0
  for (const c of s.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '')) {
    if ('([{'.includes(c)) d++
    else if (')]}'.includes(c)) d--
  }
  return d === 0
}

// イベントの引数名 (API の定義から)
function eventParams(src, before, pos) {
  const m = /([\w.:"'()[\]]+?)\s*:\s*(?:Connect|Once|ConnectParallel)\(\s*$/.exec(before)
  if (!m) return ''
  try {
    const chain = parseChain(m[1])
    if (!chain || !chain.steps.length) return ''
    const last = chain.steps[chain.steps.length - 1]
    if (last.op !== '.') return ''
    const parent = resolveChain({ root: chain.root, steps: chain.steps.slice(0, -1) }, { text: src, pos, index: 0 })
    if (parent && parent.k === 'execobj') return last.name === 'OnMessage' ? 'message' : ''
    if (!parent || parent.k !== 'class') return ''
    const mem = db.member(parent.name, last.name)
    if (!mem || mem.kind !== 'e') return ''
    return db.paramsOf(mem.type).map(p => PARAM_NAMES[p.name] || p.name).join(', ')
  } catch { return '' }
}

// ---- このファイルから学ぶ候補 ----
function firstIdent(line) {
  const m = /^(?:local\s+)?([A-Za-z_]\w*)/.exec(line)
  return m ? m[1] : null
}
// 行の「形」: 同じ形の行を過去から探すためのキー
function shapeOf(line) {
  let m
  if ((m = /^local\s+\w+\s*=\s*Instance\.new\(\s*["'](\w+)["']/.exec(line))) return 'new:' + m[1]
  if ((m = /^\w+\.(\w+)\s*=(?!=)/.exec(line))) return 'set:' + m[1]
  if ((m = /^\w+:(\w+)\(/.exec(line))) return 'call:' + m[1]
  return null
}
// 直前の行と同じ形の行を過去から探し、その「次の行」を変数名を置き換えて提案
function analogyNext(lines, ln, typed) {
  let p = ln - 1
  while (p >= 0 && !lines[p].trim()) p--
  if (p < 0) return null
  const prev = lines[p].trim()
  const shape = shapeOf(prev)
  const cur = firstIdent(prev)
  if (!shape || !cur) return null
  const recent = lines.slice(Math.max(0, p - 30), p + 1).map(l => l.trim())
  for (let i = p - 1, seen = 0; i >= 0 && seen < 400; i--, seen++) {
    const t = lines[i].trim()
    if (!t || shapeOf(t) !== shape) continue
    const other = firstIdent(t)
    if (!other || other === cur) continue
    let j = i + 1
    while (j < p && !lines[j].trim()) j++
    if (j >= p) continue
    const next = lines[j].trim()
    // 同じオブジェクトについての行が続いているときだけ
    if (!new RegExp(`^${other}[.:]`).test(next)) continue
    if (/\bfunction\b|\b(then|do)\s*$/.test(next)) continue
    const sug = next.replace(new RegExp(`\\b${other}\\b`, 'g'), cur)
    const head = /^\w+[.:]\w+/.exec(sug)
    // 既に同じ設定を書いているなら提案しない
    if (head && recent.some(r => r.startsWith(head[0]) && /^\s*[=(]/.test(r.slice(head[0].length)))) return null
    if (!sug.startsWith(typed) || sug === typed) return null
    return sug.slice(typed.length)
  }
  return null
}
// 入力中の行と同じ書き出しの行が過去にあれば、その続きを提案
function lineRepeat(lines, ln, typed) {
  if (typed.replace(/\s/g, '').length < 5 || /^(local|return|print|end|if|for|while)\s*\w{0,2}$/.test(typed)) return null
  let best = null, count = 0
  for (let i = ln - 1, seen = 0; i >= 0 && seen < 800; i--, seen++) {
    const t = lines[i].trim()
    if (t.length <= typed.length + 1 || !t.startsWith(typed)) continue
    if (!best) best = t
    else if (t !== best) { if (++count > 2) return null }
  }
  if (!best || /\b(function|then|do|repeat)\s*(\(.*\))?\s*$/.test(best)) return null
  // 宣言の丸写しは避ける (同じ変数を二重に宣言してしまうため)
  if (/^local\s+\w+\s*=/.test(best) && /^local\s+\w*$/.test(typed)) return null
  return best.slice(typed.length)
}

export function luauLocalSuggest(state, pos, mode = 'studio') {
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  const after = line.text.slice(pos - line.from)
  if (after.trim() && !/^[)"'\]}]*\s*$/.test(after)) return null
  const unit = state.facet(indentUnit)
  const ind = indentOf(line.text)
  const sp = before.endsWith(' ') || !before.trim() ? '' : ' '
  const closeQuote = after.startsWith('"') || after.startsWith("'") ? '' : '")'
  let m

  if (before.trim()) {
    const src = docText(state)
    const inStr = inStringOrComment(src, pos)
    // ---- 文字列の中: サービス名・クラス名の続き ----
    if ((m = /:GetService\(\s*["']([A-Za-z]+)$/.exec(before))) {
      const cands = db.serviceNames().filter(n => n.startsWith(m[1]))
      const pick = COMMON_SERVICES.find(n => cands.includes(n)) || (cands.length === 1 ? cands[0] : null)
      return pick && pick !== m[1] ? { text: pick.slice(m[1].length) + closeQuote } : null
    }
    if ((m = /Instance\.new\(\s*["']([A-Za-z]+)$/.exec(before))) {
      const pick = COMMON_CLASSES.find(n => n.startsWith(m[1]) && n !== m[1])
      return pick ? { text: pick.slice(m[1].length) + closeQuote } : null
    }
    if ((m = /:(?:WaitForChild|FindFirstChild)\(\s*["']([A-Za-z]+)$/.exec(before))) {
      const pick = ['Humanoid', 'HumanoidRootPart', 'PlayerGui', 'Backpack', 'leaderstats', 'Head', 'Animator'].find(n => n.startsWith(m[1]) && n !== m[1])
      return pick ? { text: pick.slice(m[1].length) + closeQuote } : null
    }
    if (inStr) return null

    // ---- local 名前 = → 初期値 ----
    if ((m = /^\s*local\s+([A-Za-z_]\w*)\s*=\s*$/.exec(before))) {
      const svc = serviceFor(m[1])
      if (svc) return { text: sp + `game:GetService("${svc}")` }
      for (const [re, value, alt] of VALUE_HINTS) if (re.test(m[1])) return { text: sp + ((alt && alt(src)) || adaptNames(value, src.slice(0, line.from))) }
      if (/^(old|oldNamecall|oldIndex|original|orig)\w*$/.test(m[1]) && mode === 'executor') return null
      return null
    }
    // ---- イベント: :Connect( → function(引数) ... end) ----
    if (/:(Connect|Once|ConnectParallel)\(\s*$/.test(before)) {
      const head = `function(${eventParams(src, before, pos)})\n`
      const body = ind + unit
      return { text: head + body + '\n' + ind + 'end' + (after.startsWith(')') ? '' : ')'), cursor: head.length + body.length }
    }
    // ---- 関数を渡す呼び出し: task.spawn( / pcall( / table.sort(t, ----
    if ((m = /(?:^|[^\w.])((?:task|coroutine)\.\w+|pcall|xpcall|spawn|delay)\(\s*((?:[\d.]+)\s*,\s*)?$/.exec(before)) && m[1] in CALLBACK_CALLS && (CALLBACK_CALLS[m[1]] !== null || m[2])) {
      const head = 'function()\n', body = ind + unit
      return { text: head + body + '\n' + ind + 'end' + (after.startsWith(')') ? '' : ')'), cursor: head.length + body.length }
    }
    if (/\btable\.sort\(\s*[\w.]+\s*,\s*$/.test(before)) {
      const head = 'function(a, b)\n', body = ind + unit + 'return a < b'
      return { text: head + body + '\n' + ind + 'end' + (after.startsWith(')') ? '' : ')'), cursor: head.length + body.length }
    }
    // ---- コンストラクタの引数 ----
    if ((m = /(?:^|[^\w.])((?:Vector3|Vector2|CFrame|Color3|UDim2|UDim|TweenInfo|Instance|NumberRange|Random|RaycastParams|BrickColor|Rect)\.\w+)\($/.exec(before)) && CTOR_ARGS[m[1]]) {
      const text = CTOR_ARGS[m[1]]
      return { text: after.startsWith(')') ? text.slice(0, -1) : text }
    }
    // ---- for ----
    if (/^\s*for\s+[A-Za-z_]\w*\s*=\s*$/.test(before)) return { text: sp + '1, 10 do' }
    if ((m = /^\s*for\s+([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s+in\s+$/.exec(before))) {
      const v = m[2]
      const text = src.slice(0, line.from)
      if (/^(player|plr|p)$/i.test(v)) {
        const pm = /local\s+(\w+)\s*=\s*game:GetService\(["']Players["']\)/.exec(text)
        return { text: `${pm ? pm[1] : 'game:GetService("Players")'}:GetPlayers() do` }
      }
      if (/^(conn|connection|c)$/i.test(v) && mode === 'executor') return { text: 'getconnections() do', cursor: 15 }
      if (/^(child|obj|object|inst|instance|part|item)$/i.test(v)) return { text: 'workspace:GetChildren() do' }
      if (/^(descendant|desc)$/i.test(v)) return { text: 'workspace:GetDescendants() do' }
      const pl = new RegExp(`\\b(${v}s|${v}List|${v}es|${v}Table)\\b`).exec(text)
      if (pl) return { text: `${pl[1]} do` }
      if (m[1] !== '_' && /^(k|key)$/.test(m[1])) return { text: 'pairs() do', cursor: 6 }
      return null
    }
    // ---- 文法の続き ----
    if ((m = /^\s*(if|elseif)\s+(.+?)\s*$/.exec(before)) && !/\bthen\b/.test(before) && balanced(m[2]) && !/(\b(and|or|not)|==|~=|[<>=+\-*/.,(]|\.\.)$/.test(m[2].trim())) return { text: sp + 'then' }
    if ((m = /^\s*while\s+(.+?)\s*$/.exec(before)) && !/\bdo\b/.test(before) && balanced(m[1]) && !/(\b(and|or|not)|==|~=|[<>=+\-*/.,(])$/.test(m[1].trim())) return { text: sp + 'do' }
    if (/^\s*for\s+.+\bin\s+.+[)\w]\s*$/.test(before) && !/\bdo\b/.test(before) && balanced(before)) return { text: sp + 'do' }
    if (/^\s*for\s+\w+\s*=\s*[^,]+,\s*[^,]+[)\w]\s*$/.test(before) && !/\bdo\b/.test(before) && balanced(before)) return { text: sp + 'do' }
    if (/^\s*(?:local\s+)?function\s+[\w.:]+$/.test(before) && !after.trim()) return { text: '()', cursor: 1 }
    // ---- モジュールの最後の return ----
    if (/^return\s*$/.test(before) && line.number === state.doc.lines) {
      const mm = /^local\s+([A-Z]\w*)\s*=\s*\{\s*\}/m.exec(src)
      if (mm && !new RegExp(`^return\\s+${mm[1]}\\b`, 'm').test(src)) return { text: sp + mm[1] }
    }
    // ---- エグゼキューターの定番 ----
    if (mode === 'executor') {
      if (/(?:^|[^\w.])loadstring\($/.test(before)) return { text: 'game:HttpGet(""))()', cursor: 14 }
      if (/(?:^|=\s*)hookmetamethod\($/.test(before)) {
        const om = /^\s*(?:local\s+)?(\w+)\s*=\s*hookmetamethod\($/.exec(before)
        const old = om ? om[1] : 'old'
        const head = 'game, "__namecall", newcclosure(function(self, ...)\n', body = ind + unit
        return { text: head + body + 'local method = getnamecallmethod()\n' + body + '\n' + body + `return ${old}(self, ...)\n` + ind + 'end)' + (after.startsWith(')') ? '' : ')'), cursor: head.length + body.length + 'local method = getnamecallmethod()\n'.length + body.length }
      }
      if (/(?:^|[^\w.])(?:request|http_request|syn\.request)\($/.test(before)) {
        const body = ind + unit
        return { text: '{\n' + body + 'Url = "",\n' + body + 'Method = "GET",\n' + ind + '}' + (after.startsWith(')') ? '' : ')'), cursor: 2 + body.length + 7 }
      }
      if (/^\s*if\s+not\s+isfolder\(\s*(["'][^"']+["'])\s*\)\s*then\s*$/.test(before)) return null
      if ((m = /^\s*getgenv\(\)\.(\w+)\s*=\s*$/.exec(before))) return { text: sp + 'true' }
    }
  }

  // ---- このファイルから学ぶ候補 ----
  if (state.doc.lines > 4000) return null
  const typed = before.trim()
  const lines = state.doc.sliceString(0, line.from).split('\n')
  lines.pop()
  const ln = lines.length
  if (after.trim()) return null
  const next = analogyNext(lines, ln, typed)
  if (next) return { text: next }
  if (typed) {
    const rep = lineRepeat(lines, ln, typed)
    if (rep) return { text: rep }
  }
  return null
}

// ============================================================
// プロバイダ (入力のたびに候補を計算)
// ============================================================
export function inlineSuggestions(getConfig) {
  return [
    ghostField,
    ViewPlugin.fromClass(class {
      constructor(view) { this.view = view; this.timer = null; this.reqId = 0; this.dismissed = null }
      update(u) {
        // Esc で閉じた候補は、その行を書き換えるまで出さない
        for (const tr of u.transactions) for (const e of tr.effects) if (e.is(setGhost) && e.value === null && tr.annotation(ghostDismiss)) this.dismissed = u.state.doc.lineAt(u.state.selection.main.head).number
        if (!u.docChanged) return
        const cfg = getConfig()
        if (!cfg.enabled) return
        const userTyped = u.transactions.some(tr => tr.isUserEvent('input') && !tr.isUserEvent('input.paste') && !tr.isUserEvent('input.format'))
        if (!userTyped) return
        const view = this.view
        clearTimeout(this.timer)
        // 既存のゴーストがあり、入力と一致して残っていれば何もしない
        if (view.state.field(ghostField, false)) return
        const run = () => {
          const state = view.state
          const sel = state.selection.main
          if (!sel.empty || state.selection.ranges.length > 1 || completionStatus(state) === 'active' || view.composing) return
          const pos = sel.head
          const lineNo = state.doc.lineAt(pos).number
          if (this.dismissed === lineNo) return
          this.dismissed = null
          let sug = null
          try { sug = luauLocalSuggest(state, pos, cfg.mode) } catch { sug = null }
          if (sug && sug.text) {
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
        this.timer = setTimeout(run, 70)
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
export function autoEndCommand(view) {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty || state.selection.ranges.length > 1) return false
  if (completionStatus(state) === 'active') return false
  const pos = sel.head
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  // ほとんどの Enter はここで抜ける (見出しの直後でなければ通常の改行)
  if (!/\b(then|do|repeat)\s*(--.*)?$/.test(before) && !/\bfunction\b/.test(before)) return false
  if (state.doc.length > 400000) return false
  const hd = headerAt(state.doc.toString(), pos, state.tabSize)
  if (!hd) return false
  const after = line.text.slice(pos - line.from)
  const lead = after.length - after.trimStart().length
  const trailing = after.trim()
  const ind = indentOf(line.text)
  const unit = state.facet(indentUnit)
  const body = '\n' + ind + unit
  const cursor = EditorSelection.cursor(pos + body.length)
  if (!hd.needsCloser) {
    // function() |end) のように同じ行で閉じている → 間に本体の行を作る
    if (hd.closedOnLine && /^(end|until)(?![A-Za-z0-9_])/.test(trailing)) {
      view.dispatch({ changes: { from: pos, to: pos + lead, insert: body + '\n' + ind }, selection: cursor, userEvent: 'input', scrollIntoView: true })
      return true
    }
    return false
  }
  const closer = hd.closer
  let changes
  if (/^[)\]},;\s]*$/.test(trailing)) {
    // 後ろが閉じ括弧だけ ( :Connect(function()|) ) → end の後ろへ移す
    changes = { from: pos, to: line.to, insert: body + '\n' + ind + (trailing ? closer.trimEnd() + trailing : closer) }
  } else {
    // 後ろにコードが続く → それを本体にして、その下に end
    changes = [{ from: pos, to: pos + lead, insert: body }, { from: line.to, insert: '\n' + ind + closer.trimEnd() }]
  }
  view.dispatch({ changes, selection: cursor, userEvent: 'input', scrollIntoView: true })
  return true
}

export function luauAutoEnd(enabled) {
  return Prec.high(keymap.of([{ key: 'Enter', run: view => enabled() && autoEndCommand(view) }]))
}
