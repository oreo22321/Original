// ゲーム画面 (GUI プレビュー)
//  ・ワーカーの GUI エンジンが計算した位置・大きさで、ScreenGui の中身を描きます
//  ・届くのは「前回からの差分」だけなので、大きな UI ライブラリやアニメーションも軽く動きます
//  ・タップ / ドラッグ / ホイール / キー入力 / 文字入力 をワーカーへ送り、Roblox と同じイベントとして再現します
//  ・全画面表示 (スマホでは自動で横向き) に対応
import { h, icon } from './ui.js'

export const SCREENS = [
  { id: 'phone', label: 'スマホ', w: 812, h: 375 },
  { id: 'tablet', label: 'タブレット', w: 1024, h: 768 },
  { id: 'pc', label: 'PC', w: 1280, h: 720 },
]

const FONT = {
  sans: 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Hiragino Sans","Noto Sans JP",sans-serif',
  mono: 'ui-monospace,Menlo,Consolas,"Roboto Mono","Courier New",monospace',
  serif: 'Georgia,"Times New Roman","Hiragino Mincho ProN",serif',
  comic: '"Comic Sans MS","Chalkboard SE","Comic Neue",system-ui,sans-serif',
}

// キーボードのキー → Roblox の KeyCode 名
const CODE_MAP = {
  Space: 'Space', Enter: 'Return', NumpadEnter: 'KeypadEnter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape',
  ShiftLeft: 'LeftShift', ShiftRight: 'RightShift', ControlLeft: 'LeftControl', ControlRight: 'RightControl', AltLeft: 'LeftAlt', AltRight: 'RightAlt',
  MetaLeft: 'LeftSuper', MetaRight: 'RightSuper', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', CapsLock: 'CapsLock',
  Minus: 'Minus', Equal: 'Equals', BracketLeft: 'LeftBracket', BracketRight: 'RightBracket', Semicolon: 'Semicolon', Quote: 'Quote',
  Comma: 'Comma', Period: 'Period', Slash: 'Slash', Backslash: 'BackSlash', Backquote: 'Backquote',
}
const DIGITS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
export function keyCodeOf(e) {
  const c = e.code || ''
  if (CODE_MAP[c]) return CODE_MAP[c]
  let m = /^Key([A-Z])$/.exec(c)
  if (m) return m[1]
  m = /^Digit(\d)$/.exec(c)
  if (m) return DIGITS[+m[1]]
  m = /^Numpad(\d)$/.exec(c)
  if (m) return 'Keypad' + DIGITS[+m[1]]
  if (/^F\d{1,2}$/.test(c)) return c
  if (e.key && /^[a-z]$/i.test(e.key)) return e.key.toUpperCase()
  return null
}

// Roblox のリッチテキスト (一部) を安全に DOM へ (innerHTML は使わない)
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
const decode = s => s.replace(/&(lt|gt|amp|quot|apos);/g, (m, k) => ENT[k])
const safeColor = v => {
  const s = String(v || '').trim()
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s
  const m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(s)
  if (m) return `rgb(${m[1]},${m[2]},${m[3]})`
  return /^[a-z]{3,20}$/i.test(s) ? s : null
}
function richNodes(src, limit) {
  const root = document.createDocumentFragment()
  const stack = [root]
  let shown = 0
  const re = /<(\/?)([a-zA-Z]+)([^<>]*?)\/?>|<br\s*\/?>/g
  let last = 0, m
  const text = t => {
    if (!t) return
    t = decode(t)
    if (limit >= 0) { const arr = [...t]; if (shown >= limit) return; if (shown + arr.length > limit) t = arr.slice(0, limit - shown).join(''); shown += arr.length }
    stack[stack.length - 1].append(t)
  }
  while ((m = re.exec(src))) {
    text(src.slice(last, m.index))
    last = re.lastIndex
    if (/^<br/i.test(m[0])) { stack[stack.length - 1].append(document.createElement('br')); continue }
    const close = m[1] === '/', tag = m[2].toLowerCase(), attrs = m[3] || ''
    if (close) { if (stack.length > 1) stack.pop(); continue }
    const el = document.createElement('span')
    const at = k => { const r = new RegExp(k + '\\s*=\\s*"([^"]*)"|' + k + "\\s*=\\s*'([^']*)'", 'i').exec(attrs); return r ? (r[1] ?? r[2]) : null }
    if (tag === 'b') el.style.fontWeight = '700'
    else if (tag === 'i') el.style.fontStyle = 'italic'
    else if (tag === 'u') el.style.textDecoration = 'underline'
    else if (tag === 's') el.style.textDecoration = 'line-through'
    else if (tag === 'uc' || tag === 'uppercase') el.style.textTransform = 'uppercase'
    else if (tag === 'sc' || tag === 'smallcaps') el.style.fontVariant = 'small-caps'
    else if (tag === 'font') {
      const c = safeColor(at('color')); if (c) el.style.color = c
      const sz = parseFloat(at('size')); if (sz > 0 && sz < 200) el.style.fontSize = sz + 'px'
      const wt = at('weight'); if (wt) el.style.fontWeight = /bold|heavy|black/i.test(wt) ? '700' : /medium|semi/i.test(wt) ? '600' : /\d{3}/.test(wt) ? wt : '400'
      const tr = parseFloat(at('transparency')); if (tr >= 0 && tr <= 1) el.style.opacity = String(1 - tr)
    } else if (tag === 'stroke') {
      const c = safeColor(at('color')) || '#000'
      const th = Math.min(8, parseFloat(at('thickness')) || 1)
      el.style.textShadow = `0 0 ${th}px ${c}, 0 0 1px ${c}`
    } else if (tag === 'mark') {
      const c = safeColor(at('color')); if (c) el.style.background = c
    }
    stack[stack.length - 1].append(el)
    stack.push(el)
  }
  text(src.slice(last))
  return root
}

// ============================================================
// ステージ
// ============================================================
export class GuiStage {
  constructor({ onInput, screen }) {
    this.onInput = onInput
    this.nodes = new Map()   // id → { el, p }
    this.live = false
    this.view = { cx: 0, cy: 0, s: 1, rot: 0 }
    this.layer = h('div', { class: 'g-nodes' })
    this.topbar = h('div', { class: 'g-topbar' },
      h('span', { class: 'g-tb-btn' }, icon('menu', 16)),
      h('span', { class: 'g-tb-btn' }, icon('chat', 16)))
    this.fx = h('div', { class: 'g-fx' })
    // Drawing (エグゼキューターの描画 API) は GUI の上に重ねて描く
    this.draw = h('canvas', { class: 'g-draw', 'aria-hidden': 'true' })
    this.drawList = []
    this.stage = h('div', { class: 'g-stage', tabindex: '0', 'aria-label': 'ゲーム画面' }, this.topbar, this.layer, this.draw, this.fx)
    this.empty = h('div', { class: 'g-empty' }, icon('layers', 22), h('div', null, 'GUI はまだありません'), h('div', { class: 'g-empty-sub' }, 'ScreenGui を PlayerGui や gethui() に入れると、ここに表示されます'))
    this.frame = h('div', { class: 'g-frame' }, this.stage, this.empty)
    this.setScreen(screen)
    this.bindInput()
    this.observe()
  }

  setScreen(id) {
    const sc = SCREENS.find(s => s.id === id) || SCREENS[0]
    this.screenId = sc.id
    this.w = sc.w; this.h = sc.h
    this.stage.style.width = sc.w + 'px'
    this.stage.style.height = sc.h + 'px'
    this.fit()
    this.paintDrawings()
  }

  reset() {
    this.nodes.clear()
    this.layer.textContent = ''
    this.closeText()
    this.drawList = []
    this.paintDrawings()
    this.frame.classList.remove('has-gui')
  }

  // ---- Drawing ----
  setDrawings(list) {
    this.drawList = list || []
    this.paintDrawings()
    this.frame.classList.toggle('has-gui', this.nodes.size > 0 || this.drawList.length > 0)
  }
  paintDrawings() {
    const cv = this.draw
    const list = this.drawList
    if (!list.length) { if (cv.width) { cv.width = 0; cv.height = 0 } return }
    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1)
    if (cv.width !== Math.round(this.w * dpr) || cv.height !== Math.round(this.h * dpr)) { cv.width = Math.round(this.w * dpr); cv.height = Math.round(this.h * dpr) }
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, this.w, this.h)
    const col = c => (c ? `rgb(${c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(',')})` : '#fff')
    const DRAW_FONT = ['system-ui,sans-serif', 'Arial,sans-serif', '"Segoe UI",Roboto,sans-serif', 'ui-monospace,Menlo,monospace']
    for (const d of [...list].sort((a, b) => (a.ZIndex || 0) - (b.ZIndex || 0))) {
      g.globalAlpha = Math.max(0, Math.min(1, d.Transparency === undefined ? 1 : d.Transparency))
      g.strokeStyle = g.fillStyle = col(d.Color)
      g.lineWidth = d.Thickness || 1
      g.lineJoin = 'round'
      const fillOrStroke = () => (d.Filled ? g.fill() : g.stroke())
      if (d.kind === 'Line' && d.From && d.To) { g.beginPath(); g.moveTo(d.From[0], d.From[1]); g.lineTo(d.To[0], d.To[1]); g.stroke() }
      else if (d.kind === 'Circle' && d.Position) {
        const n = Math.max(3, Math.min(128, d.NumSides || 64)), r = Math.max(0, d.Radius || 0)
        g.beginPath()
        for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; const x = d.Position[0] + Math.cos(a) * r, y = d.Position[1] + Math.sin(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y) }
        fillOrStroke()
      } else if (d.kind === 'Square' && d.Position && d.Size) { d.Filled ? g.fillRect(d.Position[0], d.Position[1], d.Size[0], d.Size[1]) : g.strokeRect(d.Position[0], d.Position[1], d.Size[0], d.Size[1]) }
      else if (d.kind === 'Text' && d.Position) {
        const size = d.Size || 16
        g.font = `${size}px ${DRAW_FONT[d.Font | 0] || DRAW_FONT[0]}`
        g.textAlign = d.Center ? 'center' : 'left'
        g.textBaseline = 'top'
        const lines = String(d.Text || '').split('\n')
        lines.forEach((t, i) => {
          if (d.Outline) { g.lineWidth = 2; g.strokeStyle = col(d.OutlineColor || [0, 0, 0]); g.strokeText(t, d.Position[0], d.Position[1] + i * size) }
          g.fillText(t, d.Position[0], d.Position[1] + i * size)
        })
      } else if ((d.kind === 'Triangle' || d.kind === 'Quad') && d.PointA && d.PointB && d.PointC) {
        g.beginPath(); g.moveTo(d.PointA[0], d.PointA[1]); g.lineTo(d.PointB[0], d.PointB[1]); g.lineTo(d.PointC[0], d.PointC[1]); if (d.PointD) g.lineTo(d.PointD[0], d.PointD[1]); g.closePath(); fillOrStroke()
      } else if (d.kind === 'Image' && d.Position && d.Size) {
        g.setLineDash([4, 3]); g.strokeStyle = 'rgba(255,255,255,.5)'; g.strokeRect(d.Position[0], d.Position[1], d.Size[0], d.Size[1]); g.setLineDash([])
      }
    }
    g.globalAlpha = 1
  }

  // ---- 差分の反映 ----
  apply(patch) {
    if (!patch) return
    if (patch.full) {
      for (const n of this.nodes.values()) n.el.remove()
      this.nodes.clear()
    }
    for (const id of patch.del || []) {
      const n = this.nodes.get(id)
      if (n) { n.el.remove(); this.nodes.delete(id) }
    }
    for (const [id, p] of patch.set || []) {
      let n = this.nodes.get(id)
      if (!n) { n = { el: document.createElement('div'), p: {} }; n.el.className = 'gn'; n.el.dataset.id = id; this.nodes.set(id, n) }
      this.update(n, p)
    }
    if (patch.order) {
      // 描画順に並べる (動いたものだけ移動)
      const layer = this.layer
      let ref = layer.firstChild
      for (const id of patch.order) {
        const n = this.nodes.get(id)
        if (!n) continue
        if (n.el === ref) { ref = ref.nextSibling; continue }
        layer.insertBefore(n.el, ref)
      }
      while (ref) { const next = ref.nextSibling; if (!this.nodes.has(+ref.dataset.id)) ref.remove(); ref = next }
    }
    this.frame.classList.toggle('has-gui', this.nodes.size > 0 || this.drawList.length > 0)
  }

  update(n, p) {
    const o = n.p
    const el = n.el
    const st = el.style
    if (o.x !== p.x || o.y !== p.y || o.w !== p.w || o.h !== p.h) {
      st.left = p.x + 'px'; st.top = p.y + 'px'; st.width = Math.max(0, p.w) + 'px'; st.height = Math.max(0, p.h) + 'px'
    }
    if (o.bg !== p.bg) st.background = p.bg || ''
    if (o.r !== p.r) st.borderRadius = p.r ? p.r + 'px' : ''
    const sk = p.sk ? (p.sk[2] === 1 ? `inset 0 0 0 ${p.sk[0]}px ${p.sk[1]}` : p.sk[2] === 2 ? `0 0 0 ${p.sk[0] / 2}px ${p.sk[1]}, inset 0 0 0 ${p.sk[0] / 2}px ${p.sk[1]}` : `0 0 0 ${p.sk[0]}px ${p.sk[1]}`) : ''
    const bd = p.bd ? `0 0 0 ${p.bd[0]}px ${p.bd[1]}` : ''
    const shadow = [sk, bd].filter(Boolean).join(',')
    if (el._sh !== shadow) { st.boxShadow = shadow; el._sh = shadow }
    const cl = p.cl ? `inset(${p.cl[1] - p.y}px ${p.x + p.w - p.cl[2]}px ${p.y + p.h - p.cl[3]}px ${p.cl[0] - p.x}px)` : ''
    if (el._cl !== cl) { st.clipPath = cl; st.webkitClipPath = cl; el._cl = cl }
    if (o.rot !== p.rot) st.transform = p.rot ? `rotate(${p.rot}deg)` : ''
    el.classList.toggle('gb', !!p.b)
    // テキスト
    const textKey = p.t === undefined && p.ph === undefined ? '' : [p.t, p.ph, p.rich, p.mvg, p.fs, p.ff, p.fw, p.fi, p.xa, p.ya, p.wr, p.tr, p.lh, p.fc, p.tg, p.tst, p.tsk && p.tsk.join(), p.pd && p.pd.join(), p.pc].join('|')
    if (el._tk !== textKey) {
      el._tk = textKey
      let t = el._t
      if (!textKey) { if (t) { t.remove(); el._t = null } }
      else {
        if (!t) { t = el._t = document.createElement('div'); t.className = 'gt'; el.prepend(t) }
        const ts = t.style
        ts.fontSize = p.fs + 'px'
        ts.fontFamily = FONT[p.ff] || FONT.sans
        ts.fontWeight = p.fw ? String(p.fw) : ''
        ts.fontStyle = p.fi ? 'italic' : ''
        ts.justifyContent = p.xa === 'l' ? 'flex-start' : p.xa === 'r' ? 'flex-end' : 'center'
        ts.textAlign = p.xa === 'l' ? 'left' : p.xa === 'r' ? 'right' : 'center'
        ts.alignItems = p.ya === 't' ? 'flex-start' : p.ya === 'b' ? 'flex-end' : 'center'
        ts.whiteSpace = p.wr ? 'pre-wrap' : 'pre'
        ts.lineHeight = p.lh ? String(p.lh) : ''
        ts.padding = p.pd ? `${p.pd[0]}px ${p.pd[1]}px ${p.pd[2]}px ${p.pd[3]}px` : ''
        const placeholder = p.t === undefined || p.t === ''
        ts.color = placeholder && p.ph ? p.pc : p.fc
        if (p.tg) { ts.backgroundImage = p.tg; ts.webkitBackgroundClip = 'text'; ts.backgroundClip = 'text'; ts.color = 'transparent' } else { ts.backgroundImage = ''; ts.webkitBackgroundClip = ''; ts.backgroundClip = '' }
        const strokes = []
        if (p.tst) strokes.push(`0 0 1px ${p.tst}`, `1px 1px 0 ${p.tst}`, `-1px -1px 0 ${p.tst}`, `1px -1px 0 ${p.tst}`, `-1px 1px 0 ${p.tst}`)
        if (p.tsk) strokes.push(`0 0 ${p.tsk[0]}px ${p.tsk[1]}`, `0 0 1px ${p.tsk[1]}`)
        ts.textShadow = strokes.join(',')
        const inner = document.createElement('span')
        inner.className = p.tr ? 'gtx trunc' : 'gtx'
        if (placeholder && p.ph) inner.textContent = p.ph
        else if (p.rich) inner.append(richNodes(String(p.t), p.mvg ?? -1))
        else inner.textContent = p.t
        t.replaceChildren(inner)
      }
    }
    // 画像
    const imgKey = p.im || p.iph ? [p.im, p.iph, p.ic, p.ia, p.st, p.ir && p.ir.join(), p.sl && p.sl.join(), p.ti && p.ti.join(), p.w, p.h].join('|') : ''
    if (el._ik !== imgKey) {
      el._ik = imgKey
      let im = el._im
      if (!imgKey) { if (im) { im.remove(); el._im = null } }
      else {
        if (!im) { im = el._im = document.createElement('div'); im.className = 'gi'; el.append(im) }
        this.paintImage(im, p)
      }
    }
    // 形を推測して描く画像 (角丸の背景・影)
    const igKey = p.ig ? p.ig.join('|') : ''
    if (el._igk !== igKey) {
      el._igk = igKey
      if (!igKey) { if (el._ig) { el._ig.remove(); el._ig = null } }
      else {
        if (!el._ig) { el._ig = document.createElement('div'); el._ig.className = 'gig'; el.prepend(el._ig) }
        const s = el._ig.style
        s.background = p.ig[0]; s.borderRadius = p.ig[1] + 'px'
        s.filter = p.ig[2] ? `blur(${p.ig[2]}px)` : ''
        s.inset = p.ig[2] ? p.ig[2] + 'px' : '0'
      }
    }
    // スクロールバー
    const sbKey = p.sb ? p.sb.join('|') : ''
    if (el._sbk !== sbKey) {
      el._sbk = sbKey
      if (!sbKey) { if (el._sb) { el._sb.remove(); el._sb = null } }
      else {
        if (!el._sb) { el._sb = document.createElement('div'); el._sb.className = 'gsb'; el.append(el._sb) }
        const s = el._sb.style
        s.width = Math.max(2, p.sb[0] * 0.6) + 'px'; s.height = p.sb[1] + 'px'; s.top = p.sb[2] + 'px'; s.background = p.sb[3]
      }
    }
    el.classList.toggle('gtb', !!p.tb)
    el.classList.toggle('gfo', !!p.fo)
    n.p = p
  }

  paintImage(im, p) {
    const s = im.style
    s.cssText = ''
    im.className = 'gi'
    if (p.iph) { im.classList.add('gph'); if (p.ic) s.color = p.ic; return }
    const url = `url("${String(p.im).replace(/["\\\n\r]/g, c => encodeURIComponent(c))}")`
    const tint = !!p.ic
    if (tint) {
      // 色付け: 画像を形 (マスク) として使い、ImageColor3 で塗る
      s.backgroundColor = p.ic
      s.webkitMaskImage = url; s.maskImage = url
    } else s.backgroundImage = url
    if (p.ia !== undefined) s.opacity = String(p.ia)
    const sizeProp = tint ? ['webkitMaskSize', 'maskSize'] : ['backgroundSize']
    const posProp = tint ? ['webkitMaskPosition', 'maskPosition'] : ['backgroundPosition']
    const repProp = tint ? ['webkitMaskRepeat', 'maskRepeat'] : ['backgroundRepeat']
    const set = (props, v) => { for (const k of props) s[k] = v }
    set(repProp, 'no-repeat')
    if (p.ir) {
      // スプライト (ImageRectOffset / ImageRectSize): 元画像の大きさが分かってから位置を合わせる
      const [ox, oy, sw, sh] = p.ir
      loadSize(p.im).then(nat => {
        if (!nat || !im.isConnected) return
        const kx = p.w / (sw || nat.w), ky = p.h / (sh || nat.h)
        set(sizeProp, `${nat.w * kx}px ${nat.h * ky}px`)
        set(posProp, `${-ox * kx}px ${-oy * ky}px`)
      })
      set(sizeProp, '100% 100%')
    } else if (p.st === 'Fit') { set(sizeProp, 'contain'); set(posProp, 'center') }
    else if (p.st === 'Crop') { set(sizeProp, 'cover'); set(posProp, 'center') }
    else if (p.st === 'Tile' && p.ti) { set(sizeProp, `${p.ti[0]}px ${p.ti[1]}px`); set(repProp, 'repeat') }
    else if (p.st === 'Slice' && p.sl && !tint) {
      s.backgroundImage = ''
      const [l, t, r, b, sc] = p.sl
      loadSize(p.im).then(nat => {
        if (!nat || !im.isConnected) return
        s.borderStyle = 'solid'
        s.borderWidth = `${t * sc}px ${(nat.w - r) * sc}px ${(nat.h - b) * sc}px ${l * sc}px`
        s.borderImage = `${url} ${t} ${nat.w - r} ${nat.h - b} ${l} fill stretch`
      })
    } else set(sizeProp, '100% 100%')
  }

  // ---- 大きさを枠に合わせる ----
  fit() {
    const host = this.full ? this.overlay : this.frame
    if (!host || !host.isConnected) return
    if (this.full) {
      const vw = window.innerWidth, vh = window.innerHeight
      const portrait = vh > vw && this.w > this.h
      const aw = portrait ? vh : vw, ah = portrait ? vw : vh
      const s = Math.min((aw - 12) / this.w, (ah - 12) / this.h)
      this.view = { s, rot: portrait ? 90 : 0, cx: vw / 2, cy: vh / 2 }
      this.stage.style.transform = `translate(-50%,-50%) rotate(${this.view.rot}deg) scale(${s})`
      this.stage.style.left = '50%'; this.stage.style.top = '50%'
      this.stage.style.transformOrigin = '50% 50%'
      return
    }
    const parent = this.frame.parentElement
    const availW = parent ? parent.clientWidth - 2 : 320
    const availH = parent ? Math.max(160, (parent.closest('.panel-view') || parent).clientHeight - 64) : 400
    const w = Math.max(160, Math.min(availW, availH * this.w / this.h))
    const s = w / this.w
    this.frame.style.width = w + 'px'
    this.frame.style.height = w * this.h / this.w + 'px'
    this.stage.style.left = '0'; this.stage.style.top = '0'
    this.stage.style.transformOrigin = '0 0'
    this.stage.style.transform = `scale(${s})`
    this.view = { s, rot: 0, cx: null, cy: null }
  }
  // 画面に見えているか (見えていない間はワーカーが描画データを送らない)
  setVisible(v) {
    v = !!v || !!this.full
    if (v === this.visible) return
    this.visible = v
    if (this.onVisible) this.onVisible(v)
  }
  observe() {
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver(es => { for (const e of es) this.setVisible(e.isIntersecting) })
      this.io.observe(this.frame)
    }
    if (typeof ResizeObserver === 'undefined') return
    this.ro = new ResizeObserver(() => this.fit())
    requestAnimationFrame(() => { if (this.frame.parentElement) this.ro.observe(this.frame.parentElement) })
    window.addEventListener('resize', () => { if (this.full) this.fit() })
  }
  attach(host) {
    host.append(this.frame)
    if (this.ro && this.frame.parentElement) { this.ro.disconnect(); this.ro.observe(this.frame.parentElement) }
    requestAnimationFrame(() => this.fit())
  }

  // 画面上の座標 → ゲーム画面の座標
  toStage(e) {
    const r = this.stage.getBoundingClientRect()
    const v = this.view
    if (v.rot === 90) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      const dx = e.clientX - cx, dy = e.clientY - cy
      return { x: dy / v.s + this.w / 2, y: -dx / v.s + this.h / 2 }
    }
    return { x: (e.clientX - r.left) / v.s, y: (e.clientY - r.top) / v.s }
  }

  // ---- 入力 ----
  bindInput() {
    const st = this.stage
    let pending = null, raf = 0
    const flushMove = () => { raf = 0; if (pending) { this.send(pending); pending = null } }
    const kindOf = e => (e.pointerType === 'mouse' ? 'mouse' : 'touch')
    let active = null
    st.addEventListener('pointerdown', e => {
      if (!this.live) return
      if (e.target.closest('.g-textin')) return
      e.preventDefault()
      st.focus({ preventScroll: true })
      if (active !== null && active !== e.pointerId) return // 複数の指は最初の 1 本だけ
      active = e.pointerId
      try { st.setPointerCapture(e.pointerId) } catch {}
      const p = this.toStage(e)
      this.ripple(p)
      if (raf) { cancelAnimationFrame(raf); flushMove() }
      this.send({ kind: 'pointer', phase: 'down', x: p.x, y: p.y, pointer: kindOf(e), button: e.button === 2 ? 2 : 0 })
    })
    st.addEventListener('pointermove', e => {
      if (!this.live) return
      if (active !== null && e.pointerId !== active) return
      if (active === null && kindOf(e) !== 'mouse') return
      const p = this.toStage(e)
      pending = { kind: 'pointer', phase: 'move', x: p.x, y: p.y, pointer: kindOf(e) }
      if (!raf) raf = requestAnimationFrame(flushMove)
    })
    const up = e => {
      if (e.pointerId !== active) return
      active = null
      if (!this.live) return
      if (raf) { cancelAnimationFrame(raf); flushMove() }
      const p = this.toStage(e)
      this.send({ kind: 'pointer', phase: e.type === 'pointercancel' ? 'cancel' : 'up', x: p.x, y: p.y, pointer: kindOf(e), button: e.button === 2 ? 2 : 0 })
    }
    st.addEventListener('pointerup', up)
    st.addEventListener('pointercancel', up)
    st.addEventListener('contextmenu', e => { if (this.live) e.preventDefault() })
    st.addEventListener('wheel', e => {
      if (!this.live) return
      e.preventDefault()
      const p = this.toStage(e)
      const k = e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? 300 : 1
      this.send({ kind: 'wheel', x: p.x, y: p.y, dx: e.deltaX * k, dy: e.deltaY * k })
    }, { passive: false })
    const keyEv = down => e => {
      if (!this.live || e.target.closest('.g-textin')) return
      const key = keyCodeOf(e)
      if (!key) return
      if (!e.metaKey && !e.ctrlKey) e.preventDefault()
      if (down && e.repeat) return
      this.send({ kind: 'key', key, down, char: e.key && e.key.length === 1 ? e.key : undefined })
    }
    st.addEventListener('keydown', keyEv(true))
    st.addEventListener('keyup', keyEv(false))
  }
  send(m) { if (this.onInput) this.onInput(m) }

  ripple(p) {
    const r = h('span', { class: 'g-ripple', style: { left: p.x + 'px', top: p.y + 'px' } })
    this.fx.append(r)
    setTimeout(() => r.remove(), 600)
  }

  // ---- TextBox の入力 (画面に重ねた入力欄で受け付ける) ----
  focusText(m) {
    this.closeText(true)
    if (!m || m.id === null || m.id === undefined) return
    const multi = !!m.multi
    const input = h(multi ? 'textarea' : 'input', { class: 'g-textin', placeholder: m.ph || '', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done' })
    input.value = m.text || ''
    const host = this.full ? this.overlay : document.body
    const place = () => {
      const r = this.stage.getBoundingClientRect()
      const v = this.view
      const [x, y, w, hh] = m.rect
      let left, top, width
      if (v.rot === 90) { left = r.left + r.width - (y + hh) * v.s; top = r.top + x * v.s; width = Math.max(160, hh * v.s) }
      else { left = r.left + x * v.s; top = r.top + y * v.s + hh * v.s + 4; width = Math.max(180, w * v.s) }
      const vw = window.innerWidth
      left = Math.max(8, Math.min(vw - width - 8, left))
      Object.assign(input.style, { left: left + 'px', top: Math.min(window.innerHeight - 52, top) + 'px', width: width + 'px' })
    }
    place()
    let t = 0
    const push = done => { clearTimeout(t); this.send({ kind: 'text', id: m.id, text: input.value, done, enter: done === 'enter' }) }
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => push(false), 60) })
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing && (!multi || !e.shiftKey)) { e.preventDefault(); this.textDone = 'enter'; input.blur() }
      else if (e.key === 'Escape') { e.preventDefault(); input.blur() }
    })
    input.addEventListener('blur', () => {
      if (input._silent) return
      const how = this.textDone === 'enter' ? 'enter' : true
      this.textDone = null
      push(how)
      if (this.textEl === input) { input.remove(); this.textEl = null }
    })
    host.append(input)
    this.textEl = input
    requestAnimationFrame(() => { input.focus(); try { input.setSelectionRange(input.value.length, input.value.length) } catch {} })
  }
  closeText(silent) {
    const el = this.textEl
    if (!el) return
    this.textEl = null
    if (silent) { el._silent = true; el.remove() } else el.blur()
  }

  // ---- 全画面 ----
  toggleFull(on = !this.full) {
    if (on === !!this.full) return
    if (on) {
      this.overlay = h('div', { class: 'g-overlay', role: 'dialog', 'aria-label': 'ゲーム画面 (全画面)' },
        h('button', { class: 'g-ov-close', 'aria-label': '全画面を閉じる', onclick: () => this.toggleFull(false) }, icon('close', 20)))
      this.overlay.append(this.stage)
      document.body.append(this.overlay)
      this.full = true
      this.onKey = e => { if (e.key === 'Escape' && !this.textEl) this.toggleFull(false) }
      window.addEventListener('keydown', this.onKey)
      requestAnimationFrame(() => { this.overlay.classList.add('in'); this.fit(); this.stage.focus({ preventScroll: true }) })
    } else {
      this.full = false
      window.removeEventListener('keydown', this.onKey)
      this.frame.prepend(this.stage)
      const ov = this.overlay
      this.overlay = null
      ov.classList.remove('in')
      setTimeout(() => ov.remove(), 200)
      this.fit()
    }
    if (this.onFull) this.onFull(this.full)
    this.setVisible(this.full || this.frame.isConnected)
  }
}

const sizeCache = new Map()
function loadSize(url) {
  if (sizeCache.has(url)) return sizeCache.get(url)
  const p = new Promise(res => {
    const img = new Image()
    img.onload = () => res({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 })
    img.onerror = () => res(null)
    img.src = url
  })
  sizeCache.set(url, p)
  return p
}
