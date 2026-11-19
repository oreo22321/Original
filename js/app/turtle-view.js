// turtle (タートルグラフィックス) の画面: python-worker から届く命令を、出力パネルのキャンバスに描く
// ・動き (m / h) は命令に付いた時間をかけてなめらかに描く (Python 側も同じ時間だけ待つので、ずれない)
// ・キー操作・クリック (タップ) を Python へ送る。タッチの端末では、使うキーのボタンを出す
import { h, icon } from './ui.js'

const SHAPES = {
  arrow: [[-10, 0], [10, 0], [0, 10]],
  turtle: [[0, 16], [-2, 14], [-1, 10], [-4, 7], [-7, 9], [-9, 8], [-6, 5], [-7, 1], [-5, -3], [-8, -6], [-6, -8], [-4, -5], [0, -7], [4, -5], [6, -8], [8, -6], [5, -3], [7, 1], [6, 5], [9, 8], [7, 9], [4, 7], [1, 10], [2, 14]],
  circle: Array.from({ length: 20 }, (_, a) => [10 * Math.cos(a * Math.PI / 10), 10 * Math.sin(a * Math.PI / 10)]),
  square: [[10, -10], [10, 10], [-10, 10], [-10, -10]],
  triangle: [[10, -5.77], [0, 11.55], [-10, -5.77]],
  classic: [[0, 0], [-5, -9], [0, -7], [5, -9]],
  blank: [],
}
// キーボードの key → turtle (Tk) のキーの名前
const KEYSYM = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'space', Enter: 'Return', Escape: 'Escape', Backspace: 'BackSpace', Tab: 'Tab', Delete: 'Delete', Shift: 'Shift_L', Control: 'Control_L', Alt: 'Alt_L' }
const KEY_LABEL = { Up: '↑', Down: '↓', Left: '←', Right: '→', space: 'スペース', Return: 'Enter', Escape: 'Esc', BackSpace: '⌫' }
const SCALE = 2

export class TurtleView {
  constructor(sendEvent) {
    this.sendEvent = sendEvent
    this.W = 640; this.H = 480
    this.bg = 'white'
    this.turtles = new Map()
    this.items = []
    this.queue = []
    this.opStart = 0
    this.partial = null
    this.shapes = { ...SHAPES }
    this.live = true
    this.keys = []
    this.clickable = false
    this.build()
  }

  build() {
    this.base = h('canvas', { class: 'tt-base' })
    this.top = h('canvas', { class: 'tt-top', tabindex: '0', 'aria-label': 'タートルの画面 (キー操作・タップを受け付けます)' })
    this.stage = h('div', { class: 'tt-stage' }, this.base, this.top)
    this.titleEl = h('span', { class: 'tt-title' }, 'turtle')
    this.keypad = h('div', { class: 'tt-keys hidden' })
    const btn = (ic, title, fn) => h('button', { class: 'icon-btn sm', title, 'aria-label': title, onclick: fn }, icon(ic, 16))
    this.el = h('div', { class: 'out-turtle' },
      h('div', { class: 'tt-bar' }, icon('brush', 14), this.titleEl, h('span', { class: 'tt-spacer' }),
        btn('play', 'すぐに描き終える', () => this.flushAll()),
        btn('download', '画像として保存', () => this.save())),
      this.stage, this.keypad)
    this.resize(640, 480)
    // 操作 → Python
    const pos = e => {
      const r = this.top.getBoundingClientRect()
      return { x: Math.round(((e.clientX - r.left) / r.width - 0.5) * this.W), y: Math.round((0.5 - (e.clientY - r.top) / r.height) * this.H) }
    }
    let lastDrag = 0
    this.top.addEventListener('pointerdown', e => { this.top.focus({ preventScroll: true }); if (this.live) this.sendEvent({ t: 'c', ...pos(e), b: e.button === 2 ? 3 : e.button === 1 ? 2 : 1 }) })
    this.top.addEventListener('pointerup', e => { if (this.live) this.sendEvent({ t: 'r', ...pos(e), b: 1 }) })
    this.top.addEventListener('pointermove', e => { if (this.live && e.buttons && performance.now() - lastDrag > 30) { lastDrag = performance.now(); this.sendEvent({ t: 'd', ...pos(e), b: 1 }) } })
    this.top.addEventListener('contextmenu', e => { if (this.clickable) e.preventDefault() })
    const key = (e, t) => {
      if (!this.live || e.isComposing) return
      const k = KEYSYM[e.key] || (e.key.length === 1 ? e.key : /^F\d+$/.test(e.key) ? e.key : null)
      if (!k || !this.wants(k)) return
      e.preventDefault()
      this.sendEvent({ t, k })
    }
    this.top.addEventListener('keydown', e => key(e, 'kd'))
    this.top.addEventListener('keyup', e => key(e, 'ku'))
  }

  wants(k) { return this.keys.includes(k) || this.keys.includes('*') }

  resize(w, h2) {
    this.W = w; this.H = h2
    for (const c of [this.base, this.top]) { c.width = Math.min(4096, w * SCALE); c.height = Math.min(4096, h2 * SCALE) }
    this.stage.style.setProperty('--ar', `${w} / ${h2}`)
    this.stage.style.maxWidth = `min(100%, calc(62vh * ${w / h2}))`
    this.redraw()
  }

  // ---- 命令を受け取る ----
  push(ops) {
    for (const op of ops) this.queue.push(op)
    this.kick()
  }
  kick() { if (!this.raf) this.raf = requestAnimationFrame(t => this.frame(t)) }

  opMs(op) { return op[0] === 'm' ? op[4] : op[0] === 'h' ? op[3] : 0 }

  frame(now) {
    this.raf = 0
    const t0 = performance.now()
    this.partial = null
    // 遅れすぎたら追いつく (タブを隠していた間など)
    if (this.opStart && now - this.opStart > 400) this.opStart = now - 400
    while (this.queue.length) {
      const op = this.queue[0]
      const ms = this.opMs(op)
      if (ms > 0) {
        if (!this.opStart) this.opStart = now
        const end = this.opStart + ms
        if (now < end) { this.partial = { op, p: (now - this.opStart) / ms }; break }
        this.opStart = end
      }
      this.queue.shift()
      this.apply(op)
      if (performance.now() - t0 > 14) break
    }
    if (!this.queue.length) this.opStart = 0
    this.drawTop()
    if (this.queue.length) this.kick()
  }

  // 残りを全部すぐに描く
  flushAll() {
    while (this.queue.length) this.apply(this.queue.shift())
    this.partial = null
    this.opStart = 0
    this.drawTop()
  }

  finish() { this.live = false; this.keypad.classList.add('hidden') }

  apply(op) {
    const [k] = op
    const t = this.turtles.get(op[1])
    switch (k) {
      case 'nt': this.turtles.set(op[1], { ...op[2], filling: false, segs: [] }); break
      case 'ps': if (t) Object.assign(t, op[2]); break
      case 'm': {
        if (!t) break
        if (t.down && op[5] !== 0 && (t.x !== op[2] || t.y !== op[3])) {
          const it = { k: 'line', tid: op[1], x1: t.x, y1: t.y, x2: op[2], y2: op[3], c: t.pc, w: t.w }
          this.add(it)
          if (t.filling) t.segs.push(it)
        }
        t.x = op[2]; t.y = op[3]
        break
      }
      case 'h': if (t) t.h = op[2]; break
      case 'bf': if (t) { t.filling = true; t.segs = [] } break
      case 'ef':
        if (t) {
          if (op[2].length > 2 && op[3]) this.add({ k: 'fill', tid: op[1], pts: op[2], c: op[3], segs: t.segs.slice() })
          t.filling = false; t.segs = []
        }
        break
      case 'dot': this.add({ k: 'dot', tid: op[1], x: op[2], y: op[3], size: op[4], c: op[5] }); break
      case 'tx': this.add({ k: 'text', tid: op[1], x: op[2], y: op[3], text: op[4], align: op[5], font: op[6], c: op[7] }); break
      case 'st': if (t) this.add({ k: 'stamp', tid: op[1], sid: op[2], s: { ...t, segs: null } }); break
      case 'cst': this.items = this.items.filter(i => i.sid !== op[1]); this.redraw(); break
      case 'cl': this.items = this.items.filter(i => i.tid !== op[1]); this.redraw(); break
      case 'clr': this.items = []; this.turtles.clear(); this.bg = 'white'; this.redraw(); break
      case 'bg': this.bg = op[1]; this.redraw(); break
      case 'sz': this.resize(op[1], op[2]); break
      case 'title': this.titleEl.textContent = op[1]; break
      case 'shape': this.shapes[op[1]] = op[2]; break
      case 'keys': this.setKeys(op[1], op[2]); break
    }
  }

  // ---- 描く ----
  cx(x) { return (x + this.W / 2) * SCALE }
  cy(y) { return (this.H / 2 - y) * SCALE }

  add(it) {
    this.items.push(it)
    if (this.items.length > 60000) { this.items.splice(0, 10000); this.redraw() } else this.drawItem(this.base.getContext('2d'), it)
  }

  redraw() {
    const ctx = this.base.getContext('2d')
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = this.bg === 'transparent' ? 'white' : this.bg
    ctx.fillRect(0, 0, this.base.width, this.base.height)
    ctx.restore()
    for (const it of this.items) this.drawItem(ctx, it)
    this.drawTop()
  }

  line(ctx, x1, y1, x2, y2, c, w) {
    ctx.strokeStyle = c
    ctx.lineWidth = Math.max(1, w) * SCALE
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath(); ctx.moveTo(this.cx(x1), this.cy(y1)); ctx.lineTo(this.cx(x2), this.cy(y2)); ctx.stroke()
  }

  drawItem(ctx, it) {
    try {
      if (it.k === 'line') this.line(ctx, it.x1, it.y1, it.x2, it.y2, it.c, it.w)
      else if (it.k === 'fill') {
        ctx.fillStyle = it.c
        ctx.beginPath()
        it.pts.forEach(([x, y], i) => i ? ctx.lineTo(this.cx(x), this.cy(y)) : ctx.moveTo(this.cx(x), this.cy(y)))
        ctx.closePath()
        ctx.fill('evenodd')
        for (const s of it.segs) this.line(ctx, s.x1, s.y1, s.x2, s.y2, s.c, s.w)
      } else if (it.k === 'dot') {
        ctx.fillStyle = it.c
        ctx.beginPath(); ctx.arc(this.cx(it.x), this.cy(it.y), Math.max(0.5, it.size / 2) * SCALE, 0, Math.PI * 2); ctx.fill()
      } else if (it.k === 'text') {
        const [family, size, style] = it.font
        const st = String(style).toLowerCase()
        ctx.font = `${st.includes('italic') ? 'italic ' : ''}${st.includes('bold') ? 'bold ' : ''}${Math.max(1, size * 1.33) * SCALE}px ${JSON.stringify(family)}, system-ui, sans-serif`
        ctx.fillStyle = it.c
        ctx.textAlign = it.align === 'center' ? 'center' : it.align === 'right' ? 'right' : 'left'
        ctx.textBaseline = 'bottom'
        ctx.fillText(it.text, this.cx(it.x), this.cy(it.y))
      } else if (it.k === 'stamp') this.drawTurtle(ctx, it.s, it.s.x, it.s.y, it.s.h)
    } catch {}
  }

  drawTurtle(ctx, t, x, y, angle) {
    const data = this.shapes[t.shape] || SHAPES.classic
    // 形の点 (前 = +y、右 = +x) → 画面: 向き angle (右が 0°、左回り) に回し、伸ばす
    const a = (angle + (t.tilt || 0)) * Math.PI / 180
    const e0 = Math.cos(a), e1 = Math.sin(a)
    const [sw, sl, ol] = t.st || [1, 1, 1]
    const parts = Array.isArray(data[0]) && Array.isArray(data[0][0]) ? data : [[data, null, null]]
    for (const [poly, fill, outline] of parts) {
      if (!poly || poly.length < 2) continue
      ctx.beginPath()
      poly.forEach(([px, py], i) => {
        const X = x + e1 * px * sw + e0 * py * sl
        const Y = y - e0 * px * sw + e1 * py * sl
        i ? ctx.lineTo(this.cx(X), this.cy(Y)) : ctx.moveTo(this.cx(X), this.cy(Y))
      })
      ctx.closePath()
      ctx.fillStyle = fill || t.fc
      ctx.fill()
      ctx.strokeStyle = outline || t.pc
      ctx.lineWidth = Math.max(1, ol || 1) * SCALE
      ctx.lineJoin = 'round'
      ctx.stroke()
    }
  }

  drawTop() {
    const ctx = this.top.getContext('2d')
    ctx.clearRect(0, 0, this.top.width, this.top.height)
    const p = this.partial
    for (const [id, t] of this.turtles) {
      let x = t.x, y = t.y, ang = t.h
      if (p && p.op[1] === id) {
        if (p.op[0] === 'm') {
          x = t.x + (p.op[2] - t.x) * p.p
          y = t.y + (p.op[3] - t.y) * p.p
          if (t.down && p.op[5] !== 0) this.line(ctx, t.x, t.y, x, y, t.pc, t.w)
        } else {
          const d = ((p.op[2] - t.h + 540) % 360) - 180
          ang = t.h + d * p.p
        }
      }
      if (t.vis) this.drawTurtle(ctx, t, x, y, ang)
    }
  }

  // ---- キー (タッチの端末ではボタン) ----
  setKeys(keys, clickable) {
    this.keys = keys || []
    this.clickable = !!clickable
    this.keypad.textContent = ''
    const touch = matchMedia('(pointer: coarse)').matches
    const shown = this.keys.filter(k => k !== '*')
    if (!this.live || !shown.length || !touch) { this.keypad.classList.add('hidden'); if (shown.length) this.top.focus({ preventScroll: true }); return }
    const make = k => {
      const b = h('button', { class: 'btn small tt-key', 'aria-label': k }, KEY_LABEL[k] || k)
      let rep = 0
      const up = () => { if (!rep) return; clearInterval(rep); rep = 0; this.sendEvent({ t: 'ku', k }) }
      b.addEventListener('pointerdown', e => { e.preventDefault(); if (rep) return; this.sendEvent({ t: 'kd', k }); rep = setInterval(() => this.sendEvent({ t: 'kd', k }), 110) })
      b.addEventListener('pointerup', up)
      b.addEventListener('pointerleave', up)
      b.addEventListener('pointercancel', up)
      return b
    }
    const arrows = ['Up', 'Left', 'Down', 'Right'].filter(k => shown.includes(k))
    if (arrows.length) this.keypad.append(h('div', { class: 'tt-dpad' }, ['Up', 'Left', 'Down', 'Right'].map(k => shown.includes(k) ? make(k) : h('span', { class: 'tt-key-gap' }))))
    const rest = shown.filter(k => !arrows.includes(k))
    if (rest.length) this.keypad.append(h('div', { class: 'tt-other' }, rest.map(make)))
    this.keypad.classList.remove('hidden')
  }

  save() {
    this.flushAll()
    const c = document.createElement('canvas')
    c.width = this.base.width; c.height = this.base.height
    const ctx = c.getContext('2d')
    ctx.drawImage(this.base, 0, 0)
    ctx.drawImage(this.top, 0, 0)
    const a = h('a', { href: c.toDataURL('image/png'), download: 'turtle.png' })
    a.click()
  }
}
