// GUI エンジン (ワーカー側)
//  ・ScreenGui / Frame / TextLabel … の大きさと位置を Roblox と同じ規則で計算します
//    (UIListLayout / UIGridLayout / UIPadding / UIScale / AutomaticSize / ScrollingFrame / UIFlexItem など)
//  ・AbsoluteSize / AbsolutePosition / TextBounds / AbsoluteContentSize を読むと計算済みの値が返り、
//    変わったときは GetPropertyChangedSignal も発火します
//  ・画面からのタップ・ドラッグ・ホイール・キー入力を InputObject として再現します
//  ・描画用のデータは「前回からの差分」だけを画面側へ送ります (大きな UI ライブラリでも軽く動くように)
import { LTable, native, nativeGen, rtError, EMPTY, T, callSync, index } from './runtime.js'
import { fromBytes, toBytes } from './lexer.js'
import { V2, V3, UD, UD2, C3 } from './rbx-types.js'

export const GUI_INSET = 58 // 画面上部のトップバーの高さ (GuiService:GetGuiInset と同じ)

// ============================================================
// 文字の寸法
// ============================================================
export const FONT_STACKS = {
  sans: 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Hiragino Sans","Noto Sans JP",sans-serif',
  mono: 'ui-monospace,Menlo,Consolas,"Roboto Mono","Courier New",monospace',
  serif: 'Georgia,"Times New Roman","Hiragino Mincho ProN",serif',
  comic: '"Comic Sans MS","Chalkboard SE","Comic Neue",system-ui,sans-serif',
}
const WEIGHTS = { Thin: 100, ExtraLight: 200, Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Heavy: 900 }

export function fontKind(name) {
  const n = String(name || '').toLowerCase()
  if (/code|mono|courier|inconsolata|jetbrains|ubuntumono/.test(n)) return 'mono'
  if (/fredoka|cartoon|comic|luckiest|bangers|creepster|kalam|patrick|permanent|indie|specialelite|denk|grenze|amatic|bubblegum/.test(n)) return 'comic'
  if (/merriweather|garamond|antique|bodoni|playfair|crimson|serif/.test(n) && !/sans/.test(n)) return 'serif'
  return 'sans'
}

let measureCtx = null
const widthCache = new Map()
function canvasCtx() {
  if (measureCtx !== null) return measureCtx
  try { measureCtx = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4).getContext('2d') : false } catch { measureCtx = false }
  return measureCtx || false
}
// 1 行の幅 (px)
export function textWidth(text, size, font) {
  if (!text) return 0
  const key = font.key + '|' + size + '|' + text
  let w = widthCache.get(key)
  if (w !== undefined) return w
  const c = canvasCtx()
  if (c) {
    c.font = `${font.italic ? 'italic ' : ''}${font.weight} ${size}px ${FONT_STACKS[font.kind]}`
    w = c.measureText(text).width
  } else {
    // キャンバスが使えない環境 (テスト) 用の近似
    w = 0
    for (const ch of text) {
      const code = ch.codePointAt(0)
      w += code > 0x2e80 ? 1 : ch === ' ' ? 0.28 : /[A-Z0-9MW@#%&]/.test(ch) ? 0.62 : /[il.,:;'|!]/.test(ch) ? 0.26 : 0.52
    }
    w *= size * (font.kind === 'mono' ? 1.15 : 1) * (font.weight >= 600 ? 1.06 : 1)
  }
  if (widthCache.size > 6000) widthCache.clear()
  widthCache.set(key, w)
  return w
}

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
export function stripRich(s) {
  return s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^<>]*>/g, '').replace(/&(lt|gt|amp|quot|apos);/g, (m, k) => ENT[k])
}

// 折り返しを考えた行の分割
export function wrapLines(text, size, font, maxW, wrap) {
  const out = []
  for (const para of text.split('\n')) {
    if (!wrap || !(maxW > 0) || textWidth(para, size, font) <= maxW) { out.push(para); continue }
    // 単語 (空白区切り) と全角文字 1 字ずつを単位にする
    const tokens = para.match(/[⺀-￿]|\s+|[^\s⺀-￿]+/g) || ['']
    let line = ''
    for (const tok of tokens) {
      const cand = line + tok
      if (!line || textWidth(cand, size, font) <= maxW) { line = cand; continue }
      if (/^\s+$/.test(tok)) { out.push(line); line = ''; continue }
      out.push(line.replace(/\s+$/, ''))
      line = tok
      // 1 単語で幅を超える場合は文字単位で分ける
      while (textWidth(line, size, font) > maxW && line.length > 1) {
        let i = line.length - 1
        while (i > 1 && textWidth(line.slice(0, i), size, font) > maxW) i--
        out.push(line.slice(0, i))
        line = line.slice(i)
      }
    }
    out.push(line)
  }
  return out
}

export function measureText(text, size, font, maxW, wrap, lineHeight = 1) {
  const lines = wrapLines(text, size, font, maxW, wrap)
  let w = 0
  for (const l of lines) w = Math.max(w, textWidth(l, size, font))
  return { w, h: lines.length * size * lineHeight, lines: lines.length }
}

// ============================================================
// QueryDescendants のセレクター (ClassName / .Tag / #Name / [Attr] / :not() / > / ,)
// ============================================================
export function compileSelector(sel) {
  const groups = String(sel).split(',').map(s => s.trim()).filter(Boolean)
  const parseCompound = s => {
    const tests = []
    const re = /:not\(([^()]*)\)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:\s*=\s*("?)([^\]"]*)\5)?\]|([A-Za-z_][\w]*)/g
    let m
    while ((m = re.exec(s))) {
      if (m[1] !== undefined) { const inner = compileSelector(m[1]); tests.push(i => !inner(i)) }
      else if (m[2]) { const t = m[2]; tests.push(i => i.tags.has(t)) }
      else if (m[3]) { const n = m[3]; tests.push(i => i.name === n) }
      else if (m[4]) {
        const k = m[4], v = m[6]
        tests.push(i => {
          const a = i.attrs.has(k) ? i.attrs.get(k) : undefined
          if (a === undefined) return false
          return v === undefined || String(typeof a === 'string' ? fromBytes(a) : a) === v
        })
      } else if (m[7]) { const c = m[7]; tests.push(i => i.info.isA.has(c)) }
    }
    return i => tests.every(t => t(i))
  }
  const compiled = groups.map(g => {
    const parts = g.split(/\s*(>)\s*|\s+/).filter(x => x !== undefined && x !== '')
    // 右から照合
    const steps = []
    let comb = ' '
    for (const p of parts) {
      if (p === '>') { comb = '>'; continue }
      steps.push({ test: parseCompound(p), comb })
      comb = ' '
    }
    return inst => {
      const match = (i, k) => {
        if (!steps[k].test(i)) return false
        if (k === 0) return true
        if (steps[k].comb === '>') return !!i.parent && match(i.parent, k - 1)
        for (let p = i.parent; p; p = p.parent) if (match(p, k - 1)) return true
        return false
      }
      return steps.length > 0 && match(inst, steps.length - 1)
    }
  })
  return inst => compiled.some(f => f(inst))
}

// ============================================================
// 本体
// ============================================================
export function installGui(k) {
  const { IMPL, D, enums, sched, hooks, ctx, newInstance, getService, localPlayer, G } = k
  const M = (name, fn) => native(name, fn)
  const MG = (name, fn) => nativeGen(name, fn)
  const item = (t, n) => enums.item(t, n)
  const P = (i, key) => i.getProp(key, i.info.members.get(key))
  const E = (i, key) => { const v = P(i, key); return v && v.name }
  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d)
  const r2 = v => Math.round(v * 100) / 100
  const css = (c, a = 1) => (c ? `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${r2(Math.max(0, Math.min(1, a)))})` : 'transparent')

  // ---- 既定値 (Roblox と同じ) ----
  D('GuiObject', {
    AutomaticSize: () => item('AutomaticSize', 'None'), SizeConstraint: () => item('SizeConstraint', 'RelativeXY'),
    BorderMode: () => item('BorderMode', 'Outline'), Interactable: () => true, Selectable: () => false,
  })
  D('GuiButton', { Active: () => true, AutoButtonColor: () => true, Modal: () => false, Selected: () => false })
  D('TextBox', { Active: () => true, TextEditable: () => true, MultiLine: () => false, ClearTextOnFocus: () => true, PlaceholderColor3: () => C3(0.7, 0.7, 0.7), CursorPosition: () => 1, SelectionStart: () => -1 })
  const textMore = {
    LineHeight: () => 1, MaxVisibleGraphemes: () => -1, TextStrokeTransparency: () => 1, TextStrokeColor3: () => C3(0, 0, 0),
    TextTruncate: () => item('TextTruncate', 'None'), TextXAlignment: () => item('TextXAlignment', 'Center'), TextYAlignment: () => item('TextYAlignment', 'Center'),
    FontFace: i => fontFromEnum(P(i, 'Font')),
  }
  for (const c of ['TextLabel', 'TextButton', 'TextBox']) D(c, textMore)
  const imgDefaults = {
    Image: () => '', ImageColor3: () => C3(1, 1, 1), ImageTransparency: () => 0, ScaleType: () => item('ScaleType', 'Stretch'),
    ImageRectOffset: () => V2(0, 0), ImageRectSize: () => V2(0, 0), SliceScale: () => 1, TileSize: () => UD2(1, 0, 1, 0),
  }
  D('ImageLabel', imgDefaults)
  D('ImageButton', imgDefaults)
  D('ScrollingFrame', {
    CanvasSize: () => UD2(0, 0, 2, 0), CanvasPosition: () => V2(0, 0), ScrollBarThickness: () => 12, ScrollingEnabled: () => true,
    ScrollingDirection: () => item('ScrollingDirection', 'XY'), AutomaticCanvasSize: () => item('AutomaticSize', 'None'),
    ScrollBarImageColor3: () => C3(0, 0, 0), ScrollBarImageTransparency: () => 0, ElasticBehavior: () => item('ElasticBehavior', 'WhenScrollable'),
    VerticalScrollBarInset: () => item('ScrollBarInset', 'None'), HorizontalScrollBarInset: () => item('ScrollBarInset', 'None'),
  })
  D('CanvasGroup', { GroupTransparency: () => 0, GroupColor3: () => C3(1, 1, 1) })
  D('LayerCollector', { ZIndexBehavior: () => item('ZIndexBehavior', 'Sibling') })
  D('ScreenGui', { ClipToDeviceSafeArea: () => true })
  D('UIListLayout', {
    FillDirection: () => item('FillDirection', 'Vertical'), SortOrder: () => item('SortOrder', 'LayoutOrder'), Padding: () => UD(0, 0),
    HorizontalAlignment: () => item('HorizontalAlignment', 'Left'), VerticalAlignment: () => item('VerticalAlignment', 'Top'),
    Wraps: () => false, HorizontalFlex: () => item('UIFlexAlignment', 'None'), VerticalFlex: () => item('UIFlexAlignment', 'None'),
    ItemLineAlignment: () => item('ItemLineAlignment', 'Automatic'),
  })
  D('UIGridLayout', {
    FillDirection: () => item('FillDirection', 'Horizontal'), SortOrder: () => item('SortOrder', 'LayoutOrder'),
    HorizontalAlignment: () => item('HorizontalAlignment', 'Left'), VerticalAlignment: () => item('VerticalAlignment', 'Top'),
    CellSize: () => UD2(0, 100, 0, 100), CellPadding: () => UD2(0, 5, 0, 5), FillDirectionMaxCells: () => 0, StartCorner: () => item('StartCorner', 'TopLeft'),
  })
  D('UIPageLayout', { FillDirection: () => item('FillDirection', 'Horizontal'), SortOrder: () => item('SortOrder', 'LayoutOrder'), Padding: () => UD(0, 0), HorizontalAlignment: () => item('HorizontalAlignment', 'Center'), VerticalAlignment: () => item('VerticalAlignment', 'Center'), Circular: () => false, Animated: () => true })
  D('UICorner', { CornerRadius: () => UD(0, 8) })
  D('UIStroke', { Color: () => C3(0, 0, 0), Thickness: () => 1, Transparency: () => 0, Enabled: () => true, ApplyStrokeMode: () => item('ApplyStrokeMode', 'Contextual') })
  D('UIScale', { Scale: () => 1 })
  D('UIPadding', { PaddingTop: () => UD(0, 0), PaddingBottom: () => UD(0, 0), PaddingLeft: () => UD(0, 0), PaddingRight: () => UD(0, 0) })
  D('UIGradient', { Enabled: () => true, Rotation: () => 0, Offset: () => V2(0, 0) })
  D('UISizeConstraint', { MinSize: () => V2(0, 0), MaxSize: () => V2(Infinity, Infinity) })
  D('UIAspectRatioConstraint', { AspectRatio: () => 1, AspectType: () => item('AspectType', 'FitWithinMaxSize'), DominantAxis: () => item('DominantAxis', 'Width') })
  D('UITextSizeConstraint', { MinTextSize: () => 1, MaxTextSize: () => 100 })
  D('UIFlexItem', { FlexMode: () => item('UIFlexMode', 'None'), GrowRatio: () => 1, ShrinkRatio: () => 1, ItemLineAlignment: () => item('ItemLineAlignment', 'Automatic') })
  D('Camera', { ViewportSize: () => V2(screen.w, screen.h) })

  function fontFromEnum(e) {
    try { return callSync(index(index(G, 'Font'), 'fromEnum'), [e || item('Font', 'Legacy')])[0] } catch { return undefined }
  }

  // ---- 画面 ----
  const screen = { w: 1280, h: 720 }
  const inset = () => GUI_INSET

  // ============================================================
  // 変更の追跡
  // ============================================================
  const WATCH = ['AbsoluteSize', 'AbsolutePosition', 'AbsoluteContentSize', 'AbsoluteCanvasSize', 'TextBounds', 'AbsoluteWindowSize', 'TextFits', 'AbsoluteCellSize', 'MaxCanvasPosition', 'AbsoluteRotation', 'ContentText']
  const WATCH_SET = new Set(WATCH)
  let epoch = 1      // 変更があるたびに増やす (計算結果のキャッシュはこの値ごと)
  let frameQueued = false
  const isGuiInfo = info => {
    if (info.gui === undefined) info.gui = info.isA.has('GuiBase2d') || info.isA.has('UIBase')
    return info.gui
  }
  function touch(inst, key) {
    // AbsoluteSize などの計算結果の通知は、変更として扱わない
    if (key && WATCH_SET.has(key)) return
    epoch++
    queueFrame()
  }
  function queueFrame() {
    if (frameQueued || sched.stopped) return
    frameQueued = true
    sched.setTimer(1 / 60, () => { frameQueued = false; frame() })
  }

  // ============================================================
  // レイアウト計算
  // ============================================================
  // 子にある UI 部品 (UIListLayout など) をまとめて取得 (epoch ごとにキャッシュ)
  function parts(n) {
    let c = n._parts
    if (c && c.epoch === epoch) return c
    c = { epoch, layout: null, pad: null, corner: null, stroke: null, grad: null, scale: 1, size: null, aspect: null, tsize: null, flex: null }
    for (const ch of n.children) {
      switch (ch.ClassName) {
        case 'UIListLayout': case 'UIGridLayout': case 'UIPageLayout': case 'UITableLayout': if (!c.layout) c.layout = ch; break
        case 'UIPadding': c.pad = ch; break
        case 'UICorner': c.corner = ch; break
        case 'UIStroke': if (P(ch, 'Enabled') !== false) c.stroke = ch; break
        case 'UIGradient': if (P(ch, 'Enabled') !== false) c.grad = ch; break
        case 'UIScale': c.scale *= num(P(ch, 'Scale'), 1); break
        case 'UISizeConstraint': c.size = ch; break
        case 'UIAspectRatioConstraint': c.aspect = ch; break
        case 'UITextSizeConstraint': c.tsize = ch; break
        case 'UIFlexItem': c.flex = ch; break
      }
    }
    n._parts = c
    return c
  }
  const isObj = n => n.info.isA.has('GuiObject')
  const isText = n => n.ClassName === 'TextLabel' || n.ClassName === 'TextButton' || n.ClassName === 'TextBox'
  const visibleKids = n => n.children.filter(c => isObj(c) && P(c, 'Visible') !== false)
  // 子の GuiObject (Folder の中身も含む。Roblox では Folder は配置に影響しない)
  const objsOf = n => {
    const out = []
    const walk = p => { for (const c of p.children) { if (isObj(c)) out.push(c); else if (c.ClassName === 'Folder') walk(c) } }
    walk(n)
    return out
  }
  // 配置の基準になる親 (間の Folder は飛ばす)
  const guiParent = i => {
    let p = i.parent
    while (p && p.ClassName === 'Folder') p = p.parent
    return p && p.info.isA.has('GuiBase2d') ? p : null
  }

  function padOf(n, w, h, kk) {
    const p = parts(n).pad
    if (!p) return [0, 0, 0, 0]
    const u = (key, ref) => { const v = P(p, key); return v ? ref * v.s + v.o * kk : 0 }
    return [u('PaddingTop', h), u('PaddingRight', w), u('PaddingBottom', h), u('PaddingLeft', w)]
  }

  function fontOf(n) {
    const ff = n.props.get('FontFace')
    if (ff && ff.Family !== undefined) {
      const fam = fromBytes(ff.Family)
      const wn = ff.Weight && ff.Weight.name
      return { kind: fontKind(fam), weight: WEIGHTS[wn] || 400, italic: ff.Style && ff.Style.name === 'Italic', key: fam + (wn || '') }
    }
    const e = E(n, 'Font') || 'Legacy'
    const weight = /ExtraBold|Black|Heavy/.test(e) ? 800 : /SemiBold/.test(e) ? 600 : /Bold/.test(e) ? 700 : /Medium/.test(e) ? 500 : /Light/.test(e) ? 300 : 400
    return { kind: fontKind(e), weight, italic: /Italic/.test(e), key: e }
  }

  // テキストの寸法 (TextScaled なら文字の大きさも決める)
  function textInfo(n, w, h, kk, forAuto) {
    const raw = P(n, 'Text')
    let text = typeof raw === 'string' ? fromBytes(raw) : ''
    const rich = P(n, 'RichText') === true
    if (rich) text = stripRich(text)
    const font = fontOf(n)
    const lh = num(P(n, 'LineHeight'), 1) || 1
    const wrap = P(n, 'TextWrapped') === true
    const pad = padOf(n, w, h, kk)
    const aw = w - pad[1] - pad[3], ah = h - pad[0] - pad[2]
    let size = num(P(n, 'TextSize'), 14) * kk
    if (P(n, 'TextScaled') === true && !forAuto) {
      const tc = parts(n).tsize
      const max = Math.min(100, tc ? num(P(tc, 'MaxTextSize'), 100) : 100) * kk
      const min = (tc ? num(P(tc, 'MinTextSize'), 1) : 1) * kk
      let lo = Math.max(1, min), hi = Math.max(lo, max)
      const t = text || ' '
      for (let i = 0; i < 9 && hi - lo > 0.5; i++) {
        const mid = (lo + hi) / 2
        const m = measureText(t, mid, font, aw, true, lh)
        if (m.w <= aw + 0.5 && m.h <= ah + 0.5) lo = mid; else hi = mid
      }
      size = Math.floor(lo)
    }
    const m = measureText(text, size, font, forAuto && !wrap ? 0 : aw, wrap && !forAuto ? true : wrap, lh)
    return { text, rich, font, size, lh, w: m.w, h: text ? m.h : size * lh, pad, wrap }
  }

  // 大きさ (親の内側の大きさ pw × ph に対して)
  function sizeOf(n, pw, ph, k) {
    const c = n._sz
    if (c && c[0] === epoch && c[1] === pw && c[2] === ph && c[3] === k) return c[4]
    const pc = parts(n)
    const S = P(n, 'Size') || UD2(0, 100, 0, 100)
    const scn = E(n, 'SizeConstraint')
    const refW = scn === 'RelativeYY' ? ph : pw, refH = scn === 'RelativeXX' ? pw : ph
    let w = refW * S.X.s + S.X.o * k, h = refH * S.Y.s + S.Y.o * k
    if (pc.aspect) {
      const ar = num(P(pc.aspect, 'AspectRatio'), 1) || 1
      if (E(pc.aspect, 'AspectType') === 'ScaleWithParentSize') { if (E(pc.aspect, 'DominantAxis') === 'Height') w = h * ar; else h = w / ar }
      else if (w / Math.max(h, 1e-9) > ar) w = h * ar; else h = w / ar
    }
    const s = pc.scale
    const kk = k * s
    const auto = E(n, 'AutomaticSize')
    w *= s; h *= s
    if (auto && auto !== 'None') {
      const [cw, ch] = contentSize(n, w, h, kk)
      if (auto !== 'Y') w = Math.max(w, cw)
      if (auto !== 'X') h = Math.max(h, ch)
    }
    if (pc.size) {
      const mn = P(pc.size, 'MinSize'), mx = P(pc.size, 'MaxSize')
      if (mx) { w = Math.min(w, mx.x * kk); h = Math.min(h, mx.y * kk) }
      if (mn) { w = Math.max(w, mn.x * kk); h = Math.max(h, mn.y * kk) }
    }
    const out = [Math.max(0, w), Math.max(0, h)]
    n._sz = [epoch, pw, ph, k, out]
    return out
  }

  // 中身の大きさ (AutomaticSize 用)
  function contentSize(n, w, h, kk) {
    const pad = padOf(n, w, h, kk)
    const iw = w - pad[1] - pad[3], ih = h - pad[0] - pad[2]
    let cw = 0, ch = 0
    if (isText(n)) {
      const t = textInfo(n, w, h, kk, true)
      cw = t.w; ch = t.h
    }
    const pc = parts(n)
    if (pc.layout) {
      const r = arrange(n, pc.layout, iw, ih, kk)
      cw = Math.max(cw, r.cw); ch = Math.max(ch, r.ch)
    } else {
      for (const c of objsOf(n)) {
        if (P(c, 'Visible') === false) continue
        const [sw, sh] = sizeOf(c, iw, ih, kk)
        const p = P(c, 'Position'), a = P(c, 'AnchorPoint')
        const x = iw * p.X.s + p.X.o * kk - (a ? a.x : 0) * sw
        const y = ih * p.Y.s + p.Y.o * kk - (a ? a.y : 0) * sh
        cw = Math.max(cw, x + sw); ch = Math.max(ch, y + sh)
      }
    }
    return [cw + pad[1] + pad[3], ch + pad[0] + pad[2]]
  }

  const sortItems = (layout, items) => {
    const so = E(layout, 'SortOrder')
    const idx = new Map(items.map((c, i) => [c, i]))
    return items.slice().sort((a, b) => {
      if (so === 'Name') { const an = fromBytes(String(a.name)), bn = fromBytes(String(b.name)); if (an !== bn) return an < bn ? -1 : 1 }
      else { const d = num(P(a, 'LayoutOrder')) - num(P(b, 'LayoutOrder')); if (d) return d }
      return idx.get(a) - idx.get(b)
    })
  }

  // UIListLayout / UIGridLayout の配置。位置は内側の左上からの相対
  function arrange(n, layout, iw, ih, kk) {
    const memo = layout._arr
    if (memo && memo.epoch === epoch && memo.iw === iw && memo.ih === ih && memo.kk === kk) return memo
    const items = sortItems(layout, visibleKids(n))
    const out = { epoch, iw, ih, kk, pos: new Map(), cw: 0, ch: 0, cell: null }
    const cls = layout.ClassName
    if (cls === 'UIGridLayout') {
      const cs = P(layout, 'CellSize'), cp = P(layout, 'CellPadding')
      const cwid = iw * cs.X.s + cs.X.o * kk, chei = ih * cs.Y.s + cs.Y.o * kk
      const gx = iw * cp.X.s + cp.X.o * kk, gy = ih * cp.Y.s + cp.Y.o * kk
      const horiz = E(layout, 'FillDirection') !== 'Vertical'
      const maxCells = num(P(layout, 'FillDirectionMaxCells'))
      let per = horiz ? Math.max(1, Math.floor((iw + gx) / (cwid + gx + 1e-9))) : Math.max(1, Math.floor((ih + gy) / (chei + gy + 1e-9)))
      if (maxCells > 0) per = Math.min(per, maxCells)
      items.forEach((c, i) => {
        const a = i % per, b = Math.floor(i / per)
        const col = horiz ? a : b, row = horiz ? b : a
        out.pos.set(c, { x: col * (cwid + gx), y: row * (chei + gy), w: cwid, h: chei })
      })
      const cols = horiz ? Math.min(per, items.length) : Math.ceil(items.length / per)
      const rows = horiz ? Math.ceil(items.length / per) : Math.min(per, items.length)
      out.cw = Math.max(0, cols * (cwid + gx) - gx); out.ch = Math.max(0, rows * (chei + gy) - gy)
      out.cell = [cwid, chei]
      alignBlock(layout, out, iw, ih)
    } else {
      const vertical = E(layout, 'FillDirection') === 'Vertical'
      const pad = P(layout, 'Padding') || UD(0, 0)
      const gap = (vertical ? ih : iw) * pad.s + pad.o * kk
      const mainSize = vertical ? ih : iw, crossSize = vertical ? iw : ih
      const wraps = P(layout, 'Wraps') === true
      const sized = items.map(c => { const [w, h] = sizeOf(c, iw, ih, kk); return { c, w, h, main: vertical ? h : w, cross: vertical ? w : h } })
      // 行 (折り返し) に分ける
      const lines = []
      let cur = [], used = 0
      for (const it of sized) {
        if (wraps && cur.length && used + gap + it.main > mainSize + 0.01) { lines.push(cur); cur = []; used = 0 }
        used += (cur.length ? gap : 0) + it.main
        cur.push(it)
      }
      if (cur.length) lines.push(cur)
      const mainFlex = E(layout, vertical ? 'VerticalFlex' : 'HorizontalFlex')
      const crossFlex = E(layout, vertical ? 'HorizontalFlex' : 'VerticalFlex')
      const lineAlign = E(layout, 'ItemLineAlignment')
      let crossCursor = 0, maxMain = 0
      for (const line of lines) {
        let total = line.reduce((a, it) => a + it.main, 0) + gap * Math.max(0, line.length - 1)
        let free = mainSize - total
        // UIFlexItem / Flex による伸縮
        const growers = line.map(it => {
          const f = parts(it.c).flex
          const mode = f ? E(f, 'FlexMode') : (mainFlex === 'Fill' ? 'Fill' : 'None')
          const g = mode === 'Grow' || mode === 'Fill' ? 1 : mode === 'Custom' ? num(P(f, 'GrowRatio'), 1) : 0
          const s = mode === 'Shrink' || mode === 'Fill' ? 1 : mode === 'Custom' ? num(P(f, 'ShrinkRatio'), 1) : 0
          return { g: g * (f && mode !== 'Fill' && mode !== 'Custom' ? num(P(f, 'GrowRatio'), 1) : 1), s }
        })
        const gsum = growers.reduce((a, x) => a + x.g, 0), ssum = growers.reduce((a, x) => a + x.s, 0)
        if (free > 0 && gsum > 0) { line.forEach((it, i) => { it.main += free * growers[i].g / gsum }); free = 0 }
        else if (free < 0 && ssum > 0) { line.forEach((it, i) => { it.main = Math.max(0, it.main + free * growers[i].s / ssum) }); free = 0 }
        total = line.reduce((a, it) => a + it.main, 0) + gap * Math.max(0, line.length - 1)
        let lineCross = line.reduce((a, it) => Math.max(a, it.cross), 0)
        if (!wraps || lines.length === 1) lineCross = Math.max(lineCross, crossFlex === 'Fill' ? crossSize : 0)
        // 主軸方向の余白の配り方
        let start = 0, between = gap
        const spare = mainSize - total
        if (spare > 0 && (mainFlex === 'SpaceBetween' || mainFlex === 'SpaceAround' || mainFlex === 'SpaceEvenly')) {
          const nI = line.length
          if (mainFlex === 'SpaceBetween') between = gap + (nI > 1 ? spare / (nI - 1) : 0), start = nI > 1 ? 0 : spare / 2
          else if (mainFlex === 'SpaceAround') { between = gap + spare / nI; start = spare / nI / 2 }
          else { between = gap + spare / (nI + 1); start = spare / (nI + 1) }
        } else {
          const al = vertical ? E(layout, 'VerticalAlignment') : E(layout, 'HorizontalAlignment')
          if (al === 'Center') start = spare / 2
          else if (al === 'Bottom' || al === 'Right') start = spare
        }
        let m = start
        for (const it of line) {
          const f = parts(it.c).flex
          const ia = (f && E(f, 'ItemLineAlignment') !== 'Automatic' ? E(f, 'ItemLineAlignment') : lineAlign) || 'Automatic'
          if (crossFlex === 'Fill' || ia === 'Stretch') it.cross = lineCross
          let crossPos
          if (ia === 'Start') crossPos = 0
          else if (ia === 'Center') crossPos = (lineCross - it.cross) / 2
          else if (ia === 'End') crossPos = lineCross - it.cross
          else {
            // 自動: レイアウト全体の揃え方に従う (折り返しなしなら内側全体に対して)
            const ca = vertical ? E(layout, 'HorizontalAlignment') : E(layout, 'VerticalAlignment')
            const ref = wraps && lines.length > 1 ? lineCross : crossSize
            crossPos = ca === 'Center' ? (ref - it.cross) / 2 : ca === 'Right' || ca === 'Bottom' ? ref - it.cross : 0
          }
          const x = vertical ? crossCursor + crossPos : m, y = vertical ? m : crossCursor + crossPos
          out.pos.set(it.c, { x, y, w: vertical ? it.cross : it.main, h: vertical ? it.main : it.cross })
          m += it.main + between
        }
        maxMain = Math.max(maxMain, total)
        crossCursor += lineCross + (wraps ? gap : 0)
      }
      if (wraps && lines.length) crossCursor -= gap
      const crossTotal = lines.length > 1 ? crossCursor : lines.length ? lines[0].reduce((a, it) => Math.max(a, it.cross), 0) : 0
      out.cw = vertical ? crossTotal : maxMain
      out.ch = vertical ? maxMain : crossTotal
      if (cls === 'UIPageLayout') {
        // 現在のページが見えるようにずらす
        const cur = layout.currentPage && out.pos.get(layout.currentPage)
        if (cur) for (const p of out.pos.values()) { if (vertical) p.y -= cur.y; else p.x -= cur.x }
      }
    }
    layout._arr = out
    layout._acs = [out.cw / kk, out.ch / kk]
    return out
  }
  function alignBlock(layout, out, iw, ih) {
    const ha = E(layout, 'HorizontalAlignment'), va = E(layout, 'VerticalAlignment')
    const dx = ha === 'Center' ? (iw - out.cw) / 2 : ha === 'Right' ? iw - out.cw : 0
    const dy = va === 'Center' ? (ih - out.ch) / 2 : va === 'Bottom' ? ih - out.ch : 0
    if (dx || dy) for (const p of out.pos.values()) { p.x += dx; p.y += dy }
  }

  // ---- 配置 (画面上の位置を確定) ----
  // 子を置く領域 (UIPadding・ScrollingFrame のキャンバスを考慮)。n._r が決まっている前提
  function innerBox(n) {
    if (n._ib === epoch) return n._inner
    const [x, y, w, h] = n._r
    const kk = n._kk
    const pad = padOf(n, w, h, kk)
    let ix = x + pad[3], iy = y + pad[0], iw = w - pad[1] - pad[3], ih = h - pad[0] - pad[2]
    if (n.ClassName === 'ScrollingFrame') {
      const cs = P(n, 'CanvasSize') || UD2(0, 0, 2, 0)
      let cw = w * cs.X.s + cs.X.o * kk, ch = h * cs.Y.s + cs.Y.o * kk
      const auto = E(n, 'AutomaticCanvasSize')
      if (auto && auto !== 'None') {
        const [ew, eh] = contentSize(n, w, h, kk)
        if (auto !== 'Y') cw = Math.max(cw, ew)
        if (auto !== 'X') ch = Math.max(ch, eh)
      }
      cw = Math.max(cw, w); ch = Math.max(ch, h)
      n._canvas = [cw, ch]
      const cp = P(n, 'CanvasPosition') || V2(0, 0)
      const ox = Math.max(0, Math.min(cp.x, cw - w)), oy = Math.max(0, Math.min(cp.y, ch - h))
      n._scroll = [ox, oy]
      ix = x - ox + pad[3]; iy = y - oy + pad[0]
      iw = cw - pad[1] - pad[3]; ih = ch - pad[0] - pad[2]
    }
    n._inner = [ix, iy, iw, ih]
    n._ib = epoch
    return n._inner
  }
  // 親 n の中での子 c の位置と大きさ
  function childRect(n, c) {
    const [ix, iy, iw, ih] = innerBox(n)
    const kk = n._kk
    const layout = parts(n).layout
    if (layout) {
      const p = arrange(n, layout, iw, ih, kk).pos.get(c)
      if (p) return [ix + p.x, iy + p.y, p.w, p.h]
    }
    const [cw, ch] = sizeOf(c, iw, ih, kk)
    const p = P(c, 'Position') || UD2(0, 0, 0, 0), a = P(c, 'AnchorPoint')
    return [ix + iw * p.X.s + p.X.o * kk - (a ? a.x * cw : 0), iy + ih * p.Y.s + p.Y.o * kk - (a ? a.y * ch : 0), cw, ch]
  }
  function setRect(n, r, k, rot) {
    n._lv = epoch
    n._r = r
    n._kk = k * parts(n).scale
    n._rot = rot + (isObj(n) ? num(P(n, 'Rotation')) : 0)
  }
  function rootRect(g) {
    if (g.info.isA.has('LayerCollector')) {
      const y0 = P(g, 'IgnoreGuiInset') === true ? 0 : inset()
      return [0, y0, screen.w, screen.h - y0]
    }
    // ScreenGui に入っていない GuiObject
    const [w, h] = sizeOf(g, 0, 0, 1)
    const p = P(g, 'Position') || UD2(0, 0, 0, 0)
    return [p.X.o, p.Y.o + inset(), w, h]
  }

  let collect = null // 表示中の要素の一覧 (描画・当たり判定用)
  function place(n, ctxp) {
    const pc = parts(n)
    void pc
    const visible = ctxp.visible && (isObj(n) ? P(n, 'Visible') !== false : true)
    if (!visible && !collect) return
    let alpha = ctxp.alpha
    if (n.ClassName === 'CanvasGroup') alpha *= 1 - num(P(n, 'GroupTransparency'))
    const [x, y, w, h] = n._r
    if (collect && visible && isObj(n)) collect.push({ n, x, y, w, h, clip: ctxp.clip, alpha, rot: isObj(n) ? num(P(n, 'Rotation')) : 0 })
    const objs = objsOf(n)
    if (!objs.length) return
    const clips = isObj(n) && (P(n, 'ClipsDescendants') === true || n.ClassName === 'ScrollingFrame' || n.ClassName === 'CanvasGroup')
    const clip = clips ? intersect(ctxp.clip, [x, y, x + w, y + h]) : ctxp.clip
    const child = { visible, alpha, clip }
    for (const c of objs) {
      // 見えない枝は、読まれたときに計算する (ensure)
      if (!visible || P(c, 'Visible') === false) continue
      setRect(c, childRect(n, c), n._kk, n._rot)
      place(c, child)
    }
  }
  const intersect = (a, b) => (a ? [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])] : b)

  // ---- 表示中の ScreenGui ----
  function roots() {
    const out = []
    const visit = (inst, rank) => {
      for (const c of inst.children) {
        if (c.ClassName === 'ScreenGui') out.push({ g: c, rank, order: out.length })
        else if (!c.info.isA.has('GuiBase2d')) visit(c, rank)
      }
    }
    const cg = getService('CoreGui', false), sg = getService('StarterGui', false)
    const pl = localPlayer()
    const pg = pl && pl.children.find(c => c.ClassName === 'PlayerGui')
    if (sg && !(pg && pg.children.some(c => c.ClassName === 'ScreenGui'))) visit(sg, 0)
    if (pg) visit(pg, 1)
    if (cg) visit(cg, 2)
    return out.filter(r => !r.g.destroyed && P(r.g, 'Enabled') !== false)
      .sort((a, b) => num(P(a.g, 'DisplayOrder')) - num(P(b.g, 'DisplayOrder')) || a.rank - b.rank || a.order - b.order)
  }

  let paint = []   // 描画順の一覧
  let paintV = -1  // paint を作った時点の epoch
  const stats = { layouts: 0, ms: 0, paths: 0 }
  function layoutAll() {
    if (paintV === epoch) return
    const t0 = performance.now()
    stats.layouts++
    paintV = epoch
    const list = []
    collect = list
    try {
      for (const r of roots()) {
        const g = r.g
        setRect(g, rootRect(g), 1, 0)
        const start = list.length
        place(g, { visible: true, alpha: 1, clip: null })
        // 描画順 (Sibling: 兄弟の ZIndex 順 / Global: ScreenGui 全体の ZIndex 順)
        const seg = list.splice(start)
        list.push(...orderSegment(g, seg))
      }
    } finally { collect = null }
    paint = list
    stats.ms += performance.now() - t0
  }
  const dirtyNow = () => paintV !== epoch
  function orderSegment(g, seg) {
    const global = E(g, 'ZIndexBehavior') === 'Global'
    if (global) {
      seg.forEach((e, i) => { e.i = i })
      return seg.sort((a, b) => num(P(a.n, 'ZIndex'), 1) - num(P(b.n, 'ZIndex'), 1) || a.i - b.i)
    }
    // 木構造に沿って、兄弟は ZIndex 順
    const byInst = new Map(seg.map(e => [e.n, e]))
    const out = []
    const walk = n => {
      const kids = objsOf(n).filter(c => byInst.has(c))
      kids.forEach((c, i) => { c._zi = i })
      kids.sort((a, b) => num(P(a, 'ZIndex'), 1) - num(P(b, 'ZIndex'), 1) || a._zi - b._zi)
      for (const c of kids) { out.push(byInst.get(c)); walk(c) }
    }
    walk(g)
    return out
  }

  // 1 つのオブジェクトの位置を計算する (祖先の道筋だけ。大きさの計算結果は全体の計算でも再利用)
  function ensure(inst) {
    if (inst._lv === epoch) return
    stats.paths++
    const chain = []
    for (let p = inst; p; p = guiParent(p)) {
      if (!p.info.isA.has('GuiBase2d')) break
      chain.push(p)
      if (p.info.isA.has('LayerCollector')) break
    }
    chain.reverse()
    let start = chain.findIndex(c => c._lv !== epoch)
    if (start < 0) return
    if (start === 0) { setRect(chain[0], rootRect(chain[0]), 1, 0); start = 1 }
    for (let i = start; i < chain.length; i++) {
      const parent = chain[i - 1]
      setRect(chain[i], childRect(parent, chain[i]), parent._kk, parent._rot)
    }
  }

  // ---- 計算で決まるプロパティ ----
  const absSize = i => { ensure(i); const r = i._r; return r ? V2(r2(r[2]), r2(r[3])) : V2(0, 0) }
  const absPos = i => { ensure(i); const r = i._r; return r ? V2(r2(r[0]), r2(r[1] - inset())) : V2(0, -inset()) }
  IMPL.GuiBase2d = {
    props: {
      AbsoluteSize: { get: absSize },
      AbsolutePosition: { get: absPos },
      AbsoluteRotation: { get: i => { ensure(i); return num(i._rot) } },
    },
  }
  const textBounds = i => {
    ensure(i)
    const r = i._r
    if (!r) return V2(0, 0)
    const kk = kOf(i)
    const t = textInfo(i, r[2], r[3], kk, false)
    i._tinfo = t
    return V2(r2(t.w / kk), r2(t.h / kk))
  }
  const kOf = i => { ensure(i); return i._kk || 1 }
  const contentText = i => { const v = P(i, 'Text'); const s = typeof v === 'string' ? fromBytes(v) : ''; return toBytes(P(i, 'RichText') === true ? stripRich(s) : s) }
  for (const c of ['TextLabel', 'TextButton', 'TextBox']) {
    IMPL[c] = IMPL[c] || {}
    IMPL[c].props = {
      ...(IMPL[c].props || {}),
      TextBounds: { get: textBounds },
      TextFits: { get: i => { const b = textBounds(i); const r = i._r; return !r || (b.x <= r[2] + 0.5 && b.y <= r[3] + 0.5) } },
      ContentText: { get: contentText },
    }
  }
  // レイアウトを今の状態で計算し直す (AbsoluteContentSize を読んだとき)
  function arrangeNow(l) {
    const p = l.parent
    if (!p || !p.info.isA.has('GuiBase2d')) return
    ensure(p)
    if (parts(p).layout !== l) return
    const [, , iw, ih] = innerBox(p)
    arrange(p, l, iw, ih, p._kk)
  }
  const layoutProps = {
    AbsoluteContentSize: { get: l => { arrangeNow(l); return l._acs ? V2(r2(l._acs[0]), r2(l._acs[1])) : V2(0, 0) } },
  }
  IMPL.UIGridStyleLayout = { props: layoutProps, methods: { ApplyLayout: M('ApplyLayout', A => { touch(A[0]); return EMPTY }) } }
  IMPL.UIGridLayout = { props: { AbsoluteCellSize: { get: l => { arrangeNow(l); const c = l._arr && l._arr.cell; return c ? V2(r2(c[0]), r2(c[1])) : V2(0, 0) } } } }
  IMPL.ScrollingFrame = {
    props: {
      AbsoluteCanvasSize: { get: i => { ensure(i); innerBox(i); const c = i._canvas; return c ? V2(r2(c[0]), r2(c[1])) : V2(0, 0) } },
      AbsoluteWindowSize: { get: absSize },
      MaxCanvasPosition: { get: i => { ensure(i); innerBox(i); const c = i._canvas, r = i._r; return c && r ? V2(r2(Math.max(0, c[0] - r[2])), r2(Math.max(0, c[1] - r[3]))) : V2(0, 0) } },
    },
    methods: {
      ScrollToTop: M('ScrollToTop', A => { A[0].luaNewIndex('CanvasPosition', V2(0, 0)); return EMPTY }),
      GetScrollVelocity: M('GetScrollVelocity', () => V2(0, 0)),
    },
  }
  IMPL.UIPageLayout = {
    methods: {
      JumpTo: M('JumpTo', A => { A[0].currentPage = A[1]; touch(A[0]); return EMPTY }),
      JumpToIndex: M('JumpToIndex', A => { const p = A[0].parent; if (p) { A[0].currentPage = sortItems(A[0], visibleKids(p))[A[1]] } touch(A[0]); return EMPTY }),
      Next: M('Next', A => pageStep(A[0], 1)),
      Previous: M('Previous', A => pageStep(A[0], -1)),
    },
    props: { CurrentPage: { get: l => l.currentPage || (l.parent ? sortItems(l, visibleKids(l.parent))[0] : undefined) } },
  }
  function pageStep(l, d) {
    if (!l.parent) return EMPTY
    const items = sortItems(l, visibleKids(l.parent))
    const i = Math.max(0, items.indexOf(l.currentPage || items[0]))
    l.currentPage = items[Math.max(0, Math.min(items.length - 1, i + d))]
    touch(l)
    return EMPTY
  }

  // 計算で決まるプロパティが変わったら通知する
  const watched = new Set()
  const watchValue = (inst, key) => {
    let v
    try { v = inst.luaIndex(key) } catch { return undefined }
    return v && typeof v === 'object' ? v.x + ',' + v.y : String(v)
  }
  // 監視を始めた時点の値を覚えておく (最初の変化から通知できるように)
  function noteWatch(inst, key) {
    if (!WATCH_SET.has(key)) return
    watched.add(inst)
    if (!inst._watch) inst._watch = {}
    const keys = key === 'AbsoluteSize' ? ['AbsoluteSize', 'AbsolutePosition'] : [key]
    for (const k of keys) {
      if (inst._watch[k] !== undefined) continue
      if (!inst.info.members.has(k) && !inst.info.props.has(k)) continue
      inst._watch[k] = watchValue(inst, k)
    }
  }
  function fireComputed() {
    if (!watched.size) return
    for (const inst of [...watched]) {
      if (inst.destroyed) { watched.delete(inst); continue }
      const keys = []
      const hasChanged = inst.signals && inst.signals.get('Changed') && inst.signals.get('Changed').conns.length
      for (const key of WATCH) {
        if (!(hasChanged || (inst.propSignals && inst.propSignals.has(key)))) continue
        if (!inst.info.members.has(key) && !inst.info.props.has(key)) continue
        const s = watchValue(inst, key)
        if (s === undefined) continue
        const prev = inst._watch && inst._watch[key]
        if (!inst._watch) inst._watch = {}
        inst._watch[key] = s
        if (prev !== undefined && prev !== s) keys.push(key)
      }
      for (const key of keys) inst.changed(key)
    }
  }

  // ============================================================
  // 毎フレームの処理: 計算 → 変化の通知 → 画面へ差分を送る
  // ============================================================
  let lastSend = 0
  let sendTimer = null
  function frame() {
    if (sched.stopped) return
    if (dirtyNow()) { layoutAll(); fireComputed() }
    const now = performance.now()
    // 画面への送信は最大 30 回/秒
    if (now - lastSend >= 33) { lastSend = now; sendPatch() }
    else if (!sendTimer) sendTimer = sched.setTimer((33 - (now - lastSend)) / 1000, () => { sendTimer = null; lastSend = performance.now(); sendPatch() })
    sched.checkIdle()
  }

  // ============================================================
  // 描画データ
  // ============================================================
  let gid = 0
  const idOf = i => i._gid || (i._gid = ++gid)
  const byId = new Map()
  let lastOrder = ''
  let lastSig = new Map()
  let pendingFull = true
  const assetUrl = new Map()

  function imageUrl(img, n) {
    const s = typeof img === 'string' ? fromBytes(img) : ''
    if (!s) return null
    if (/^https?:\/\//i.test(s)) return { url: s }
    if (/^data:image\//i.test(s)) return { url: s }
    const m = /^rbxasset:\/\/forgecode\/(.+)$/.exec(s)
    if (m && ctx.fs) {
      const path = m[1]
      const data = ctx.fs.get(path)
      if (data === undefined) return { ph: true }
      const c = assetUrl.get(path)
      if (c && c.len === data.length) return { url: c.url }
      const ext = (/\.(\w+)$/.exec(path) || [])[1] || 'png'
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png'
      let url = null
      try { url = data.length < 4e6 ? `data:${mime};base64,${btoa(data)}` : null } catch { url = null }
      assetUrl.set(path, { len: data.length, url })
      return url ? { url } : { ph: true }
    }
    // rbxassetid:// などのアセットは取得できない: 小さいもの (アイコン) は目印、大きいものは形を推測して描く
    const r = n._r
    return r && r[2] <= 64 && r[3] <= 64 ? { ph: true } : { asset: true }
  }

  function gradientCss(g, baseAlpha, base) {
    const cs = P(g, 'Color'), ts = P(g, 'Transparency')
    const ck = cs && cs.kps ? cs.kps : null, tk = ts && ts.kps ? ts.kps : null
    const times = new Set([0, 1])
    if (ck) for (const p of ck) times.add(p.Time)
    if (tk) for (const p of tk) times.add(p.Time)
    const sample = (kps, t, get, lerp) => {
      if (!kps || !kps.length) return null
      for (let i = 0; i < kps.length - 1; i++) {
        const a = kps[i], b = kps[i + 1]
        if (t >= a.Time && t <= b.Time) { const f = b.Time === a.Time ? 0 : (t - a.Time) / (b.Time - a.Time); return lerp(get(a), get(b), f) }
      }
      return get(t <= kps[0].Time ? kps[0] : kps[kps.length - 1])
    }
    const lc = (a, b, f) => ({ r: a.r + (b.r - a.r) * f, g: a.g + (b.g - a.g) * f, b: a.b + (b.b - a.b) * f })
    const ln = (a, b, f) => a + (b - a) * f
    const off = P(g, 'Offset') || V2(0, 0)
    const rot = num(P(g, 'Rotation'))
    const shift = Math.abs(Math.cos(rot * Math.PI / 180)) >= Math.abs(Math.sin(rot * Math.PI / 180)) ? off.x : off.y
    const stops = [...times].sort((a, b) => a - b).map(t => {
      const c = sample(ck, t, p => p.Value, lc) || { r: 1, g: 1, b: 1 }
      const tr = sample(tk, t, p => p.Value, ln) || 0
      const mul = base || { r: 1, g: 1, b: 1 }
      return `${css({ r: c.r * mul.r, g: c.g * mul.g, b: c.b * mul.b }, baseAlpha * (1 - tr))} ${r2((t + shift) * 100)}%`
    })
    return `linear-gradient(${r2(90 + rot)}deg,${stops.join(',')})`
  }

  // 1 つの要素の描画用データ
  function nodeProps(e) {
    const n = e.n
    const pc = parts(n)
    const out = { x: r2(e.x), y: r2(e.y), w: r2(e.w), h: r2(e.h) }
    if (e.clip) {
      const c = e.clip
      if (c[2] <= c[0] || c[3] <= c[1] || c[0] >= e.x + e.w + 40 || c[2] <= e.x - 40 || c[1] >= e.y + e.h + 40 || c[3] <= e.y - 40) return null
      if (!(c[0] <= e.x - 30 && c[1] <= e.y - 30 && c[2] >= e.x + e.w + 30 && c[3] >= e.y + e.h + 30)) out.cl = [r2(c[0]), r2(c[1]), r2(c[2]), r2(c[3])]
    }
    if (e.x > screen.w + 50 || e.y > screen.h + 50 || e.x + e.w < -50 || e.y + e.h < -50) return null
    if (e.rot) out.rot = r2(e.rot)
    const a = e.alpha
    let painted = false
    const bt = num(P(n, 'BackgroundTransparency'))
    const bgA = (1 - bt) * a
    if (bgA > 0.003 && e.w > 0 && e.h > 0) {
      let bg = P(n, 'BackgroundColor3')
      if (n.info.isA.has('GuiButton') && P(n, 'AutoButtonColor') !== false && bg) {
        const f = pressed.has(n) ? 0.7 : hover.has(n) && lastKind === 'mouse' ? 0.88 : 1
        if (f !== 1) bg = { r: bg.r * f, g: bg.g * f, b: bg.b * f }
      }
      out.bg = pc.grad && !isTextOnly(n) ? gradientCss(pc.grad, bgA, bg) : css(bg, bgA)
      painted = true
      const bs = num(P(n, 'BorderSizePixel'))
      if (bs > 0 && !pc.stroke) out.bd = [r2(bs), css(P(n, 'BorderColor3'), bgA)]
    }
    if (pc.corner) {
      const cr = P(pc.corner, 'CornerRadius')
      if (cr) out.r = r2(Math.min(Math.min(e.w, e.h) * cr.s + cr.o * kOf(n), Math.min(e.w, e.h) / 2))
    }
    if (pc.stroke) {
      const s = pc.stroke
      const sa = (1 - num(P(s, 'Transparency'))) * a
      const th = num(P(s, 'Thickness'), 1) * kOf(n)
      const border = !isText(n) || E(s, 'ApplyStrokeMode') === 'Border'
      if (sa > 0.003 && th > 0) {
        if (border) { out.sk = [r2(th), css(P(s, 'Color'), sa), E(s, 'BorderStrokePosition') === 'Inner' ? 1 : E(s, 'BorderStrokePosition') === 'Center' ? 2 : 0]; painted = true }
        else out.tsk = [r2(th), css(P(s, 'Color'), sa)]
      }
    }
    if (isText(n)) {
      const t = textInfo(n, e.w, e.h, kOf(n), false)
      let shown = t.text
      const tbox = n.ClassName === 'TextBox'
      if (tbox && !shown && P(n, 'PlaceholderText')) { out.ph = fromBytes(String(P(n, 'PlaceholderText'))); out.pc = css(P(n, 'PlaceholderColor3'), a) }
      const tt = num(P(n, 'TextTransparency'))
      const ta = (1 - tt) * a
      if ((shown || out.ph) && ta > 0.003) {
        const mvg = num(P(n, 'MaxVisibleGraphemes'), -1)
        if (mvg >= 0 && !t.rich) shown = [...shown].slice(0, mvg).join('')
        out.t = t.rich ? fromBytes(String(P(n, 'Text'))) : shown
        if (t.rich) out.rich = 1
        if (t.rich && mvg >= 0) out.mvg = mvg
        out.fs = r2(t.size)
        out.fc = css(P(n, 'TextColor3'), ta)
        if (pc.grad && isTextOnly(n)) out.tg = gradientCss(pc.grad, ta, P(n, 'TextColor3'))
        out.ff = t.font.kind
        if (t.font.weight !== 400) out.fw = t.font.weight
        if (t.font.italic) out.fi = 1
        const xa = E(n, 'TextXAlignment'), ya = E(n, 'TextYAlignment')
        if (xa !== 'Center') out.xa = xa === 'Left' ? 'l' : 'r'
        if (ya !== 'Center') out.ya = ya === 'Top' ? 't' : 'b'
        if (t.wrap) out.wr = 1
        if (E(n, 'TextTruncate') && E(n, 'TextTruncate') !== 'None') out.tr = 1
        if (t.lh !== 1) out.lh = t.lh
        const st = num(P(n, 'TextStrokeTransparency'), 1)
        if (st < 1) out.tst = css(P(n, 'TextStrokeColor3'), (1 - st) * a)
        if (t.pad.some(v => v)) out.pd = t.pad.map(r2)
        painted = true
      }
      if (tbox) { out.tb = 1; painted = true; if (focused === n) out.fo = 1 }
    }
    if (n.ClassName === 'ImageLabel' || n.ClassName === 'ImageButton') {
      const im = imageUrl(P(n, 'Image'), n)
      const ia = (1 - num(P(n, 'ImageTransparency'))) * a
      const st0 = E(n, 'ScaleType')
      if (im && im.asset && ia > 0.003 && st0 === 'Slice') {
        // 9 スライスの画像はほとんどが「角丸の四角」(背景・枠・影) なので、その形で描く
        const sc = P(n, 'SliceCenter'), ss = num(P(n, 'SliceScale'), 1)
        const k = kOf(n)
        const rad = sc && sc.Min ? Math.min(sc.Min.x * ss * k, Math.min(e.w, e.h) / 2) : 8
        const shadowy = /shadow|blur|glow/i.test(String(n.name)) || (e.w > 0 && P(n, 'Size') && (P(n, 'Size').X.o > 20 && P(n, 'Size').X.s >= 1))
        out.ig = [css(P(n, 'ImageColor3'), ia), r2(rad), shadowy ? r2(Math.max(6, Math.min(30, rad / 2 + 8))) : 0]
        painted = true
      } else if (im && !im.asset && ia > 0.003) {
        if (im.url) out.im = im.url; else out.iph = 1
        const ic = P(n, 'ImageColor3')
        if (ic && (ic.r < 0.99 || ic.g < 0.99 || ic.b < 0.99)) out.ic = css(ic, 1)
        if (ia < 0.997) out.ia = r2(ia)
        const st = E(n, 'ScaleType')
        if (st && st !== 'Stretch') out.st = st
        const rs = P(n, 'ImageRectSize'), ro = P(n, 'ImageRectOffset')
        if (rs && (rs.x > 0 || rs.y > 0)) out.ir = [ro ? ro.x : 0, ro ? ro.y : 0, rs.x, rs.y]
        if (st === 'Slice') { const sc = P(n, 'SliceCenter'); if (sc && sc.Min) out.sl = [sc.Min.x, sc.Min.y, sc.Max.x, sc.Max.y, num(P(n, 'SliceScale'), 1)] }
        if (st === 'Tile') { const ts = P(n, 'TileSize'); if (ts) out.ti = [r2(e.w * ts.X.s + ts.X.o), r2(e.h * ts.Y.s + ts.Y.o)] }
        painted = true
      }
    }
    if (n.info.isA.has('GuiButton') || n.ClassName === 'TextBox') out.b = 1
    if (n.ClassName === 'ScrollingFrame' && n._canvas) {
      // スクロールバー
      const [cw, ch] = n._canvas
      const th = num(P(n, 'ScrollBarThickness'), 12) * kOf(n)
      const sa = (1 - num(P(n, 'ScrollBarImageTransparency'))) * a
      if (ch > e.h + 1 && th > 0 && sa > 0.003) {
        const len = Math.max(16, e.h * e.h / ch)
        const pos = (e.h - len) * (n._scroll[1] / Math.max(1, ch - e.h))
        out.sb = [r2(th), r2(len), r2(pos), css(P(n, 'ScrollBarImageColor3'), Math.max(0.35, sa * 0.6))]
        painted = true
      }
    }
    if (!painted) return null
    return out
  }
  const isTextOnly = n => isText(n) && num(P(n, 'BackgroundTransparency')) >= 1

  function buildPatch(full, quiet) {
    // quiet: 実行が終わった後の描き直しでは、スクリプトの関数 (変化の通知) を動かさない
    if (dirtyNow()) { layoutAll(); if (!quiet) fireComputed() }
    const order = []
    const set = []
    const seen = new Set()
    for (const e of paint) {
      const pr = nodeProps(e)
      if (!pr) continue
      const id = idOf(e.n)
      byId.set(id, e.n)
      order.push(id)
      seen.add(id)
      const sig = JSON.stringify(pr)
      if (full || lastSig.get(id) !== sig) { set.push([id, pr]); lastSig.set(id, sig) }
    }
    const del = []
    for (const id of lastSig.keys()) if (!seen.has(id)) { del.push(id); lastSig.delete(id); const n = byId.get(id); if (!n || n.destroyed) byId.delete(id) }
    const os = order.join(',')
    const orderChanged = full || os !== lastOrder
    lastOrder = os
    if (!full && !set.length && !del.length && !orderChanged) return null
    const patch = { set, del }
    if (orderChanged) patch.order = order
    if (full) { patch.full = 1; patch.screen = [screen.w, screen.h, inset()] }
    return patch
  }
  let shown = true // 画面側でゲーム画面が見えているか (見えていない間は送らない)
  let availSent = false
  function sendPatch() {
    if (!shown) {
      pendingFull = true
      // 見えていなくても、GUI ができたことだけは知らせる (画面側がゲーム画面に切り替えられるように)
      if (!availSent) { if (dirtyNow()) layoutAll(); if (paint.length) { availSent = true; hooks.post({ type: 'guiAvail' }) } }
      return
    }
    let patch
    try { patch = buildPatch(pendingFull) } catch (e) { hooks.output('warn', 'GUI の描画に失敗しました: ' + (e && e.message)); return }
    pendingFull = false
    if (patch) hooks.post({ type: 'gui', patch })
  }

  // ============================================================
  // 入力
  // ============================================================
  const mouse = { x: screen.w / 2, y: screen.h / 2 }
  const buttonsDown = new Set()
  const keysDown = new Map()
  let hover = new Set()
  const pressed = new Set()
  let press = null
  let focused = null
  let lastKind = 'mouse'
  let mouseMoveIo = null
  const uis = () => getService('UserInputService')
  const guiPos = (x, y) => V3(x, y - inset(), 0)
  const setp = (inst, key, v) => { inst.props.set(key, v); inst.changed(key) }
  function newInput(type, state, x, y) {
    const io = newInstance('InputObject')
    io.props.set('UserInputType', item('UserInputType', type))
    io.props.set('UserInputState', item('UserInputState', state))
    io.props.set('KeyCode', item('KeyCode', 'Unknown'))
    io.props.set('Position', guiPos(x, y))
    io.props.set('Delta', V3(0, 0, 0))
    return io
  }
  function playerMouse() {
    const pl = localPlayer()
    return pl && pl.mouse
  }
  function moveMouse(x, y) {
    const dx = x - mouse.x, dy = y - mouse.y
    mouse.x = x; mouse.y = y
    const m = playerMouse()
    if (m) {
      m.props.set('X', Math.round(x)); m.props.set('Y', Math.round(y - inset()))
      m.props.set('ViewSizeX', screen.w); m.props.set('ViewSizeY', screen.h - inset())
      if (dx || dy) m.fire('Move', EMPTY)
    }
    return [dx, dy]
  }
  // 位置にある GUI (手前から)
  function hitAt(x, y) {
    if (dirtyNow()) { layoutAll(); fireComputed() }
    const out = []
    for (let i = paint.length - 1; i >= 0; i--) {
      const e = paint[i]
      if (x < e.x || y < e.y || x > e.x + e.w || y > e.y + e.h) continue
      if (e.clip && (x < e.clip[0] || y < e.clip[1] || x > e.clip[2] || y > e.clip[3])) continue
      if (P(e.n, 'Interactable') === false) continue
      out.push(e.n)
    }
    return out
  }
  const sinks = n => P(n, 'Active') === true || n.info.isA.has('GuiButton') || n.ClassName === 'TextBox'
  function receivers(hits) {
    const out = []
    for (const n of hits) { out.push(n); if (sinks(n)) break }
    return out
  }
  function updateHover(hits, x, y) {
    const now = new Set(hits)
    const gx = Math.round(x), gy = Math.round(y - inset())
    for (const n of hover) if (!now.has(n)) n.fire('MouseLeave', [gx, gy])
    for (const n of hits) if (!hover.has(n)) n.fire('MouseEnter', [gx, gy])
    for (const n of hits) n.fire('MouseMoved', [gx, gy])
    const changed = hover.size !== now.size || [...now].some(n => !hover.has(n))
    hover = now
    if (changed) touch()
  }
  const gp = hits => hits.some(sinks)

  function pointer(m) {
    const x = num(m.x), y = num(m.y)
    const touchKind = m.pointer === 'touch'
    lastKind = touchKind ? 'touch' : 'mouse'
    const U = uis()
    if (m.phase === 'down') {
      const [dx, dy] = moveMouse(x, y)
      void dx; void dy
      const type = touchKind ? 'Touch' : m.button === 2 ? 'MouseButton2' : 'MouseButton1'
      const hits = hitAt(x, y)
      updateHover(hits, x, y)
      const io = newInput(type, 'Begin', x, y)
      const rec = receivers(hits)
      const processed = gp(hits)
      buttonsDown.add(type === 'Touch' ? 'MouseButton1' : type)
      press = { io, type, rec, button: rec.find(n => n.info.isA.has('GuiButton')), x0: x, y0: y, lx: x, ly: y, moved: false, scroll: null, processed }
      if (touchKind) press.scroll = hits.find(n => n.ClassName === 'ScrollingFrame')
      if (press.button) { pressed.add(press.button); touch() }
      U.fire('InputBegan', [io, processed])
      if (touchKind) U.fire('TouchStarted', [io, processed])
      for (const n of rec) n.fire('InputBegan', [io])
      const gx = Math.round(x), gy = Math.round(y - inset())
      if (press.button) press.button.fire(type === 'MouseButton2' ? 'MouseButton2Down' : 'MouseButton1Down', [gx, gy])
      const pm = playerMouse()
      if (pm) pm.fire(type === 'MouseButton2' ? 'Button2Down' : 'Button1Down', EMPTY)
      const tb = rec.find(n => n.ClassName === 'TextBox')
      if (tb && P(tb, 'TextEditable') !== false) focusBox(tb)
      else if (focused) releaseFocus(false, io)
    } else if (m.phase === 'move') {
      const [dx, dy] = moveMouse(x, y)
      const hits = hitAt(x, y)
      if (!touchKind || press) updateHover(hits, x, y)
      const processed = gp(hits)
      if (touchKind && press && press.type === 'Touch') {
        const io = press.io
        io.props.set('Delta', V3(x - press.lx, y - press.ly, 0))
        setp(io, 'Position', guiPos(x, y))
        if (E(io, 'UserInputState') !== 'Change') setp(io, 'UserInputState', item('UserInputState', 'Change'))
        U.fire('InputChanged', [io, processed])
        U.fire('TouchMoved', [io, processed])
        for (const n of hits) n.fire('InputChanged', [io])
      } else {
        if (!mouseMoveIo) mouseMoveIo = newInput('MouseMovement', 'Change', x, y)
        mouseMoveIo.props.set('Delta', V3(dx, dy, 0))
        setp(mouseMoveIo, 'Position', guiPos(x, y))
        U.fire('InputChanged', [mouseMoveIo, processed])
        for (const n of hits) n.fire('InputChanged', [mouseMoveIo])
      }
      if (press) {
        if (Math.hypot(x - press.x0, y - press.y0) > 8) press.moved = true
        // タッチで ScrollingFrame をなぞるとスクロール
        const sf = press.scroll
        if (sf && press.moved && P(sf, 'ScrollingEnabled') !== false && !sf.destroyed) {
          scrollBy(sf, press.lx - x, press.ly - y)
          if (press.button) { pressed.delete(press.button); press.button = null }
          press.scrolled = true
        }
        press.lx = x; press.ly = y
      }
    } else if (m.phase === 'up' || m.phase === 'cancel') {
      moveMouse(x, y)
      const p = press
      press = null
      const hits = hitAt(x, y)
      const processed = gp(hits)
      const type = p ? p.type : touchKind ? 'Touch' : 'MouseButton1'
      buttonsDown.delete(type === 'Touch' ? 'MouseButton1' : type)
      const io = p ? p.io : newInput(type, 'End', x, y)
      if (p) { io.props.set('Position', guiPos(x, y)); setp(io, 'UserInputState', item('UserInputState', m.phase === 'cancel' ? 'Cancel' : 'End')) }
      U.fire('InputEnded', [io, processed])
      if (type === 'Touch') {
        U.fire('TouchEnded', [io, processed])
        if (p && !p.moved) U.fire('TouchTap', [LTable.fromArray([V2(x, y - inset())]), processed])
      }
      for (const n of receivers(hits)) n.fire('InputEnded', [io])
      const gx = Math.round(x), gy = Math.round(y - inset())
      const upBtn = receivers(hits).find(n => n.info.isA.has('GuiButton'))
      const m2 = type === 'MouseButton2'
      if (upBtn) upBtn.fire(m2 ? 'MouseButton2Up' : 'MouseButton1Up', [gx, gy])
      if (p && p.button && p.button === upBtn && !p.scrolled && m.phase === 'up' && P(upBtn, 'Interactable') !== false) {
        if (m2) { upBtn.fire('MouseButton2Click', EMPTY); upBtn.fire('SecondaryActivated', [io]) }
        else { upBtn.fire('MouseButton1Click', EMPTY); upBtn.fire('Activated', [io, 1]) }
      }
      const pm = playerMouse()
      if (pm) pm.fire(m2 ? 'Button2Up' : 'Button1Up', EMPTY)
      if (p && p.button) pressed.delete(p.button)
      if (type === 'Touch') updateHover([], x, y)
      touch()
    }
    sched.checkIdle()
  }

  function scrollBy(sf, dx, dy) {
    ensure(sf)
    const c = sf._canvas, r = sf._r
    if (!c || !r) return false
    const dir = E(sf, 'ScrollingDirection')
    const cp = P(sf, 'CanvasPosition') || V2(0, 0)
    const nx = dir === 'Y' ? cp.x : Math.max(0, Math.min(c[0] - r[2], cp.x + dx))
    const ny = dir === 'X' ? cp.y : Math.max(0, Math.min(c[1] - r[3], cp.y + dy))
    if (nx === cp.x && ny === cp.y) return false
    sf.luaNewIndex('CanvasPosition', V2(Math.round(nx), Math.round(ny)))
    return true
  }
  function wheel(m) {
    const x = num(m.x), y = num(m.y), dy = num(m.dy), dx = num(m.dx)
    moveMouse(x, y)
    const hits = hitAt(x, y)
    const io = newInput('MouseWheel', 'Change', x, y)
    io.props.set('Position', V3(x, y - inset(), dy > 0 ? -1 : 1))
    uis().fire('InputChanged', [io, gp(hits)])
    for (const n of hits) { n.fire('InputChanged', [io]); n.fire(dy > 0 ? 'MouseWheelBackward' : 'MouseWheelForward', [Math.round(x), Math.round(y - inset())]) }
    const pm = playerMouse()
    if (pm) pm.fire(dy > 0 ? 'WheelBackward' : 'WheelForward', EMPTY)
    for (const n of hits) {
      if (n.ClassName === 'ScrollingFrame' && P(n, 'ScrollingEnabled') !== false && scrollBy(n, dx, dy)) break
    }
    sched.checkIdle()
  }
  function key(m) {
    const kc = item('KeyCode', m.key) || item('KeyCode', 'Unknown')
    const name = kc.name
    if (m.down) {
      if (keysDown.has(name)) return
      const io = newInput('Keyboard', 'Begin', mouse.x, mouse.y)
      io.props.set('KeyCode', kc)
      keysDown.set(name, io)
      if (name === 'Space') uis().fire('JumpRequest', EMPTY)
      uis().fire('InputBegan', [io, !!focused])
      const pm = playerMouse()
      if (pm) pm.fire('KeyDown', [toBytes((m.char || name).toLowerCase())])
    } else {
      const io = keysDown.get(name) || newInput('Keyboard', 'End', mouse.x, mouse.y)
      io.props.set('KeyCode', kc)
      keysDown.delete(name)
      setp(io, 'UserInputState', item('UserInputState', 'End'))
      uis().fire('InputEnded', [io, !!focused])
      const pm = playerMouse()
      if (pm) pm.fire('KeyUp', [toBytes((m.char || name).toLowerCase())])
    }
    sched.checkIdle()
  }

  // ---- TextBox ----
  function focusBox(tb) {
    if (focused === tb) return
    byId.set(idOf(tb), tb)
    if (focused) releaseFocus(false)
    focused = tb
    if (P(tb, 'ClearTextOnFocus') === true) tb.luaNewIndex('Text', '')
    tb.fire('Focused', EMPTY)
    uis().fire('TextBoxFocused', [tb])
    touch()
    ensure(tb)
    const r = tb._r || [0, 0, 100, 30]
    hooks.post({ type: 'guiFocus', id: idOf(tb), text: fromBytes(String(P(tb, 'Text') || '')), multi: P(tb, 'MultiLine') === true, rect: r.map(r2), ph: fromBytes(String(P(tb, 'PlaceholderText') || '')) })
  }
  function releaseFocus(enter, io) {
    const tb = focused
    if (!tb) return
    focused = null
    tb.fire('FocusLost', [!!enter, io || newInput('Focus', 'End', mouse.x, mouse.y)])
    uis().fire('TextBoxFocusReleased', [tb])
    touch()
    hooks.post({ type: 'guiFocus', id: null })
  }
  function textInput(m) {
    const tb = byId.get(m.id)
    if (!tb || tb.destroyed) return
    if (typeof m.text === 'string' && fromBytes(String(P(tb, 'Text') || '')) !== m.text) {
      try { tb.luaNewIndex('Text', toBytes(m.text)) } catch { /* 読み取り専用など */ }
    }
    if (m.done && focused === tb) releaseFocus(!!m.enter)
    sched.checkIdle()
  }
  IMPL.TextBox = IMPL.TextBox || {}
  IMPL.TextBox.methods = {
    ...(IMPL.TextBox.methods || {}),
    CaptureFocus: M('CaptureFocus', A => { focusBox(A[0]); return EMPTY }),
    ReleaseFocus: M('ReleaseFocus', A => { if (focused === A[0]) releaseFocus(T(A[1])); return EMPTY }),
    IsFocused: M('IsFocused', A => focused === A[0]),
  }

  // ---- UserInputService / Mouse ----
  Object.assign(IMPL.UserInputService.methods, {
    GetMouseLocation: M('GetMouseLocation', () => V2(Math.round(mouse.x), Math.round(mouse.y))),
    IsMouseButtonPressed: M('IsMouseButtonPressed', A => !!(A[1] && buttonsDown.has(A[1].name))),
    IsKeyDown: M('IsKeyDown', A => !!(A[1] && keysDown.has(A[1].name))),
    GetKeysPressed: M('GetKeysPressed', () => LTable.fromArray([...keysDown.values()])),
    GetMouseButtonsPressed: M('GetMouseButtonsPressed', () => LTable.fromArray([...buttonsDown].map(b => newInput(b, 'Begin', mouse.x, mouse.y)))),
    GetFocusedTextBox: M('GetFocusedTextBox', () => [focused || undefined]),
    GetLastInputType: M('GetLastInputType', () => item('UserInputType', lastKind === 'touch' ? 'Touch' : 'MouseMovement')),
  })
  IMPL.GuiService.methods.GetGuiInset = M('GetGuiInset', () => [V2(0, inset()), V2(0, 0)])
  IMPL.GuiService.methods.GetScreenResolution = M('GetScreenResolution', () => V2(screen.w, screen.h))
  // 古い Tween 関数 (GuiObject:TweenPosition など)
  function legacyTween(inst, goals, A, at) {
    const dir = A[at] && A[at].name ? A[at] : item('EasingDirection', 'Out')
    const style = A[at + 1] && A[at + 1].name ? A[at + 1] : item('EasingStyle', 'Quad')
    const time = typeof A[at + 2] === 'number' ? A[at + 2] : 1
    const cb = A[at + 4]
    const ts = getService('TweenService')
    const info = callSync(index(index(G, 'TweenInfo'), 'new'), [time, style, dir])[0]
    const tw = callSync(ts.luaIndex('Create'), [ts, inst, info, LTable.fromObject(goals)])[0]
    if (cb) tw.signal('Completed').conns.push({ connected: true, enabled: true, once: true, fn: cb, disconnect() { this.connected = false } })
    callSync(tw.luaIndex('Play'), [tw])
    return true
  }
  IMPL.GuiObject = {
    methods: {
      TweenPosition: M('TweenPosition', A => legacyTween(A[0], { Position: A[1] }, A, 2)),
      TweenSize: M('TweenSize', A => legacyTween(A[0], { Size: A[1] }, A, 2)),
      TweenSizeAndPosition: M('TweenSizeAndPosition', A => legacyTween(A[0], { Size: A[1], Position: A[2] }, A, 3)),
    },
  }
  const objectsAt = A => LTable.fromArray(hitAt(num(A[1]), num(A[2]) + inset()))
  IMPL.LayerCollector = { methods: { GetGuiObjectsAtPosition: M('GetGuiObjectsAtPosition', objectsAt) } }
  IMPL.BasePlayerGui = { methods: { GetGuiObjectsAtPosition: M('GetGuiObjectsAtPosition', objectsAt) } }
  IMPL.TextService.methods.GetTextSize = M('GetTextSize', A => {
    const text = typeof A[1] === 'string' ? fromBytes(A[1]) : ''
    const size = num(A[2], 14)
    const f = A[3] && A[3].name ? A[3].name : 'Legacy'
    const font = { kind: fontKind(f), weight: /Bold/.test(f) ? 700 : 400, italic: false, key: f }
    const fw = A[4] && typeof A[4].x === 'number' ? A[4].x : 0
    const m = measureText(text, size, font, fw, fw > 0, 1)
    return V2(Math.ceil(m.w), Math.ceil(text ? m.h : size))
  })
  IMPL.TextService.methods.GetTextBoundsAsync = M('GetTextBoundsAsync', A => {
    const p = A[1]
    const get = key => { try { return p.luaIndex(key) } catch { return undefined } }
    const text = typeof get('Text') === 'string' ? fromBytes(get('Text')) : ''
    const size = num(get('Size'), 14)
    const ff = get('Font')
    const fam = ff && ff.Family ? fromBytes(ff.Family) : 'Legacy'
    const font = { kind: fontKind(fam), weight: (ff && ff.Weight && WEIGHTS[ff.Weight.name]) || 400, italic: false, key: fam }
    const width = num(get('Width'), 0)
    const m = measureText(text, size, font, width, width > 0, 1)
    return V2(Math.ceil(m.w), Math.ceil(text ? m.h : size))
  })
  IMPL.Instance.methods.QueryDescendants = M('QueryDescendants', A => {
    const self = A[0]
    if (!(self && self.isInstance)) throw rtError("Expected ':' not '.' calling member function QueryDescendants")
    const sel = typeof A[1] === 'string' ? fromBytes(A[1]) : ''
    const test = compileSelector(sel)
    return LTable.fromArray(self.descendants().filter(test))
  })

  // ============================================================
  // 外から使う関数
  // ============================================================
  return {
    isGuiInfo,
    touch,
    noteWatch,
    setScreen(w, h) {
      if (!(w > 0 && h > 0)) return
      if (w === screen.w && h === screen.h) return
      screen.w = w; screen.h = h
      pendingFull = true
      const cam = k.camera && k.camera()
      if (cam) setp(cam, 'ViewportSize', V2(w, h))
      touch()
    },
    screen,
    input(m) {
      try {
        if (m.kind === 'pointer') pointer(m)
        else if (m.kind === 'wheel') wheel(m)
        else if (m.kind === 'key') key(m)
        else if (m.kind === 'text') textInput(m)
      } finally { if (dirtyNow()) queueFrame() }
    },
    setVisible(v) { shown = !!v; if (shown && pendingFull) sendPatch() },
    // 全体を送り直す (画面側を作り直したとき)
    full() { pendingFull = true; sendPatch() },
    snapshot() { pendingFull = true; const p = buildPatch(true, true); pendingFull = false; return p },
    // AI 用: 表示中の GUI を文章にする (画面上の位置・大きさ・文字・色)
    describe(max = 180) {
      layoutAll()
      const out = [`screen ${screen.w}x${screen.h} px (top bar ${inset()} px)`]
      const R = Math.round
      const col = c => (c && c.luaTypeName === 'Color3' ? `rgb(${R(c.r * 255)},${R(c.g * 255)},${R(c.b * 255)})` : '')
      const walk = (n, depth) => {
        for (const c of objsOf(n)) {
          if (out.length >= max) return
          const r = c._r && c._lv === epoch ? c._r : null
          let line = '  '.repeat(depth) + `${c.ClassName} "${c.name}"`
          if (P(c, 'Visible') === false) line += ' [hidden]'
          else if (r) line += ` at (${R(r[0])},${R(r[1])}) size ${R(r[2])}x${R(r[3])}`
          const bgT = num(P(c, 'BackgroundTransparency'))
          if (bgT < 1 && c.ClassName !== 'ImageLabel' && c.ClassName !== 'ImageButton') line += ` bg=${col(P(c, 'BackgroundColor3'))}${bgT > 0 ? ' alpha=' + (1 - bgT).toFixed(2) : ''}`
          if (isText(c)) {
            const raw = P(c, 'Text')
            const t = typeof raw === 'string' ? fromBytes(raw) : ''
            if (t) line += ` text=${JSON.stringify(t.length > 60 ? t.slice(0, 60) + '…' : t)} color=${col(P(c, 'TextColor3'))} size=${num(P(c, 'TextSize'), 14)}`
            if (c.ClassName === 'TextBox') { const ph = P(c, 'PlaceholderText'); if (typeof ph === 'string' && ph) line += ` placeholder=${JSON.stringify(fromBytes(ph))}` }
          }
          out.push(line)
          if (P(c, 'Visible') !== false) walk(c, depth + 1)
        }
      }
      const rs = roots()
      if (!rs.length) out.push('(no visible ScreenGui)')
      for (const rt of rs) {
        if (out.length >= max) break
        out.push(`ScreenGui "${rt.g.name}" (in ${rt.g.parent ? rt.g.parent.name : '?'})`)
        walk(rt.g, 1)
      }
      if (out.length >= max) out.push('… (truncated)')
      return out.join('\n')
    },
    // 操作を待つ GUI があるか (ボタン・入力欄・ドラッグなど)
    interactive() {
      if (dirtyNow()) layoutAll()
      for (const e of paint) {
        const s = e.n.signals
        if (!s) continue
        for (const name of ['Activated', 'MouseButton1Click', 'MouseButton1Down', 'InputBegan', 'MouseEnter', 'FocusLost', 'Focused']) {
          const sg = s.get(name)
          if (sg && sg.conns.length) return true
        }
      }
      return false
    },
    visibleCount: () => paint.length,
    stats,
    byId,
  }
}
