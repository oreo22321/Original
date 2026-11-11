// GUI プレビュー: スクリプトが作った ScreenGui を HTML で再現します。
// ボタンをタップすると、接続されている関数 (Activated / MouseButton1Click) が実行されます。
import { h } from './ui.js'

export const SCREENS = [
  { id: 'phone', label: 'スマホ', w: 812, h: 375 },
  { id: 'tablet', label: 'タブレット', w: 1024, h: 768 },
  { id: 'pc', label: 'PC', w: 1280, h: 720 },
]

const rgba = (c, alpha = 1) => (c ? `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, alpha))})` : 'transparent')
const ALIGN = { Left: 'flex-start', Center: 'center', Right: 'flex-end', Top: 'flex-start', Bottom: 'flex-end' }

function build(n, pw, ph, onInput, forced) {
  const isLayer = !n.s
  const el = document.createElement(n.c === 'TextBox' ? 'label' : 'div')
  el.className = 'g-node'
  el.dataset.cls = n.c
  el.title = `${n.n} (${n.c})`
  let w = pw, hgt = ph
  const st = el.style
  if (!isLayer) {
    w = pw * n.s[0] + n.s[1]
    hgt = ph * n.s[2] + n.s[3]
    let x = pw * n.p[0] + n.p[1], y = ph * n.p[2] + n.p[3]
    if (n.a) { x -= n.a[0] * w; y -= n.a[1] * hgt }
    if (forced) { x = forced.x; y = forced.y; if (forced.w !== undefined) { w = forced.w; hgt = forced.h } }
    st.left = x + 'px'; st.top = y + 'px'; st.width = Math.max(0, w) + 'px'; st.height = Math.max(0, hgt) + 'px'
    if (n.v === 0) st.display = 'none'
    st.background = n.grad ? `linear-gradient(${90 + (n.grad.rot || 0)}deg, ${rgba(n.grad.a, 1 - n.bt)}, ${rgba(n.grad.b, 1 - n.bt)})` : rgba(n.bg, 1 - n.bt)
    const shadows = []
    if (n.bs && n.bt < 1) shadows.push(`0 0 0 ${n.bs}px ${rgba(n.bc)}`)
    const isText = n.t !== undefined
    if (n.st && (!isText || n.st.border || n.c !== 'TextLabel')) shadows.push(`0 0 0 ${n.st.th}px ${rgba(n.st.c, 1 - n.st.tr)}`)
    if (shadows.length) st.boxShadow = shadows.join(', ')
    if (n.cr) st.borderRadius = Math.min(n.cr[0] * Math.min(w, hgt) + n.cr[1], Math.min(w, hgt) / 2) + 'px'
    if (n.z) st.zIndex = String(n.z)
    const tf = []
    if (n.rot) tf.push(`rotate(${n.rot}deg)`)
    if (n.scale !== undefined && n.scale !== 1) { tf.push(`scale(${n.scale})`); st.transformOrigin = n.a ? `${n.a[0] * 100}% ${n.a[1] * 100}%` : '0 0' }
    if (tf.length) st.transform = tf.join(' ')
    if (n.clip || n.scroll) st.overflow = n.scroll ? 'auto' : 'hidden'
    if (isText) {
      el.classList.add('g-text')
      st.color = rgba(n.tc, 1 - (n.tt || 0))
      st.justifyContent = ALIGN[n.tx] || 'center'
      st.alignItems = ALIGN[n.ty] || 'center'
      st.textAlign = n.tx === 'Left' ? 'left' : n.tx === 'Right' ? 'right' : 'center'
      const len = Math.max(1, [...(n.t || n.ph || '')].length)
      st.fontSize = (n.tsc ? Math.max(6, Math.min(hgt * 0.72, (w / len) * 1.75, 100)) : n.ts) + 'px'
      if (n.b) st.fontWeight = '700'
      if (n.mono) st.fontFamily = 'ui-monospace, Menlo, Consolas, monospace'
      st.whiteSpace = n.tw ? 'pre-wrap' : 'pre'
      if (n.st && n.c === 'TextLabel' && !n.st.border) st.textShadow = `0 0 ${Math.max(1, n.st.th)}px ${rgba(n.st.c, 1 - n.st.tr)}, 0 0 1px ${rgba(n.st.c, 1 - n.st.tr)}`
      if (n.c === 'TextBox') {
        const input = h('input', { class: 'g-input', value: n.t || '', placeholder: n.ph || '', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
        input.style.textAlign = st.textAlign
        input.addEventListener('change', () => onInput({ kind: 'text', id: n.id, text: input.value }))
        input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur() })
        el.append(input)
      } else el.append(h('span', null, n.t || ''))
    }
    if (n.img !== undefined) {
      el.classList.add('g-img')
      if (/^(https?:|data:)/.test(n.img)) { st.backgroundImage = `url("${n.img.replace(/"/g, '%22')}")`; st.backgroundSize = '100% 100%'; st.opacity = String(1 - (n.it || 0)) } else if (n.img) el.classList.add('g-img-ph')
    }
    if (n.btn && n.c !== 'TextBox') {
      el.classList.add('g-btn')
      if (n.btn === 1) el.classList.add('g-live')
      el.addEventListener('click', e => {
        e.stopPropagation()
        el.classList.add('g-press')
        setTimeout(() => el.classList.remove('g-press'), 140)
        onInput({ kind: 'gui', id: n.id })
      })
    }
  } else { st.left = '0'; st.top = '0'; st.width = pw + 'px'; st.height = ph + 'px'; el.classList.add('g-layer'); if (n.order) st.zIndex = String(n.order) }
  if (!n.k) return el
  // 子の配置
  let ox = 0, oy = 0, iw = w, ih = hgt
  if (n.pad) {
    const top = n.pad[0][0] * hgt + n.pad[0][1], right = n.pad[1][0] * w + n.pad[1][1], bottom = n.pad[2][0] * hgt + n.pad[2][1], left = n.pad[3][0] * w + n.pad[3][1]
    ox = left; oy = top; iw = w - left - right; ih = hgt - top - bottom
  }
  let host = el
  if (n.pad || n.scroll) {
    host = document.createElement('div')
    host.className = 'g-inner'
    if (n.scroll && n.canvas) { iw = Math.max(iw, iw * n.canvas[0] + n.canvas[1]); ih = Math.max(ih, ih * n.canvas[2] + n.canvas[3]) }
    host.style.cssText = `left:${ox}px;top:${oy}px;width:${iw}px;height:${ih}px`
    el.append(host)
  }
  const kids = n.k
  if (n.list || n.grid) {
    const items = kids.filter(k => k.s && k.v !== 0).sort((a, b) => (a.lo || 0) - (b.lo || 0))
    const rest = kids.filter(k => !k.s)
    if (n.list) {
      const vertical = n.list.dir !== 'Horizontal'
      const gap = n.list.pad[0] * (vertical ? ih : iw) + n.list.pad[1]
      const sizes = items.map(k => ({ w: iw * k.s[0] + k.s[1], h: ih * k.s[2] + k.s[3] }))
      const total = sizes.reduce((a, s) => a + (vertical ? s.h : s.w), 0) + gap * Math.max(0, items.length - 1)
      const mainAlign = vertical ? n.list.va : n.list.ha
      const mainSize = vertical ? ih : iw
      let cur = mainAlign === 'Center' ? (mainSize - total) / 2 : mainAlign === 'Bottom' || mainAlign === 'Right' ? mainSize - total : 0
      items.forEach((k, i) => {
        const s = sizes[i]
        const crossAlign = vertical ? n.list.ha : n.list.va
        const crossSize = vertical ? iw - s.w : ih - s.h
        const cross = crossAlign === 'Center' ? crossSize / 2 : crossAlign === 'Right' || crossAlign === 'Bottom' ? crossSize : 0
        host.append(build(k, iw, ih, onInput, vertical ? { x: cross, y: cur } : { x: cur, y: cross }))
        cur += (vertical ? s.h : s.w) + gap
      })
      if (n.scroll && vertical && total > ih) host.style.height = total + 'px'
    } else {
      const cw = iw * n.grid.cell[0] + n.grid.cell[1], chh = ih * n.grid.cell[2] + n.grid.cell[3]
      const gx = iw * n.grid.pad[0] + n.grid.pad[1], gy = ih * n.grid.pad[2] + n.grid.pad[3]
      const cols = Math.max(1, Math.floor((iw + gx) / (cw + gx)))
      items.forEach((k, i) => host.append(build(k, iw, ih, onInput, { x: (i % cols) * (cw + gx), y: Math.floor(i / cols) * (chh + gy), w: cw, h: chh })))
    }
    for (const k of rest) host.append(build(k, iw, ih, onInput))
  } else for (const k of kids) host.append(build(k, iw, ih, onInput))
  return el
}

// roots: ワーカーから届いた ScreenGui の配列 / onInput: 操作をワーカーへ送る関数
export function renderGui(roots, onInput, screenId) {
  const screen = SCREENS.find(s => s.id === screenId) || SCREENS[0]
  const stage = h('div', { class: 'g-stage', style: { width: screen.w + 'px', height: screen.h + 'px' } })
  for (const r of [...roots].sort((a, b) => (a.order || 0) - (b.order || 0))) stage.append(build(r, screen.w, screen.h, onInput))
  const frame = h('div', { class: 'g-frame' }, stage)
  // パネルの幅と高さの両方に収まる大きさにする
  const fit = () => {
    const host = frame.parentElement
    if (!host || !host.clientWidth) return
    const cs = getComputedStyle(host)
    const availW = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    const availH = Math.max(150, host.clientHeight - 70)
    const w = Math.max(120, Math.min(availW, availH * screen.w / screen.h, 960))
    frame.style.width = w + 'px'
    frame.style.height = w * screen.h / screen.w + 'px'
    stage.style.transform = `scale(${w / screen.w})`
  }
  requestAnimationFrame(() => {
    fit()
    if (typeof ResizeObserver !== 'undefined' && frame.parentElement) {
      const ro = new ResizeObserver(() => { if (frame.isConnected) fit(); else ro.disconnect() })
      ro.observe(frame.parentElement)
    }
  })
  return frame
}
