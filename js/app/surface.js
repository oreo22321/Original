// 実行画面の「動く絵」: matplotlib の図・pygame のゲーム画面を、1 つのキャンバスで描き直す
// ・ワーカーから届く 1 枚の画像 (RGBA の画素 か ImageBitmap) を、画面の更新に合わせて描く (たまったら最新だけ)
// ・描き終わったら共有メモリで知らせる (Python 側はそれを待つので、画面より速く描きすぎない)
// ・pygame: キー・マウス (タップ) を Python へ送る。タッチの端末では、使っているキーのボタンを出す
// ・画像の読み込み (pygame.image.load など)・ダイアログ (tkinter.messagebox など)・音 (pygame.mixer) も、ここで引き受ける
import { h, icon, modal } from './ui.js'

// pygame のキーの名前 → ブラウザの key / code
const PG_KEYS = {
  K_LEFT: ['ArrowLeft', 'ArrowLeft', '←'], K_RIGHT: ['ArrowRight', 'ArrowRight', '→'], K_UP: ['ArrowUp', 'ArrowUp', '↑'], K_DOWN: ['ArrowDown', 'ArrowDown', '↓'],
  K_SPACE: [' ', 'Space', 'スペース'], K_RETURN: ['Enter', 'Enter', 'Enter'], K_ESCAPE: ['Escape', 'Escape', 'Esc'], K_BACKSPACE: ['Backspace', 'Backspace', '⌫'],
  K_TAB: ['Tab', 'Tab', 'Tab'], K_LSHIFT: ['Shift', 'ShiftLeft', 'Shift'], K_RSHIFT: ['Shift', 'ShiftRight', 'Shift'], K_LCTRL: ['Control', 'ControlLeft', 'Ctrl'], K_z: ['z', 'KeyZ', 'Z'],
}
const keyInfo = name => {
  if (PG_KEYS[name]) return PG_KEYS[name]
  const m = /^K_([a-z0-9])$/.exec(name)
  if (m) return [m[1], /\d/.test(m[1]) ? 'Digit' + m[1] : 'Key' + m[1].toUpperCase(), m[1].toUpperCase()]
  return null
}

export class SurfaceView {
  constructor({ key, kind = 'fig', onEvent = () => {}, ack = () => {} }) {
    this.key = key
    this.kind = kind
    this.onEvent = onEvent
    this.ack = ack
    this.pending = null
    this.frames = 0
    this.live = true
    this.w = 0; this.h = 0
    this.build()
  }

  build() {
    this.canvas = h('canvas', { class: 'sf-canvas', tabindex: '0', 'aria-label': this.kind === 'pg' ? 'ゲームの画面 (キー操作・タップを受け付けます)' : '図' })
    this.ctx = this.canvas.getContext('2d', { alpha: false })
    this.stage = h('div', { class: 'sf-stage' }, this.canvas)
    this.titleEl = h('span', { class: 'sf-title' }, this.kind === 'pg' ? 'pygame' : '図')
    this.fpsEl = h('span', { class: 'sf-fps hidden' })
    this.keypad = h('div', { class: 'sf-keys hidden' })
    const btn = (ic, title, fn) => h('button', { class: 'icon-btn sm', title, 'aria-label': title, onclick: fn }, icon(ic, 16))
    this.maxBtn = btn('expand', '大きく表示', () => this.toggleMax())
    this.el = h('div', { class: 'out-surface', 'data-kind': this.kind },
      h('div', { class: 'sf-bar' }, icon(this.kind === 'pg' ? 'gamepad' : 'chart', 14), this.titleEl, this.fpsEl, h('span', { class: 'sf-spacer' }),
        this.maxBtn, btn('download', '画像として保存', () => this.save())),
      this.stage, this.keypad)
    if (this.kind === 'pg') this.bindInput()
    this.stage.addEventListener('dblclick', () => { if (this.kind === 'fig') this.toggleMax() })
  }

  // ---- 1 枚の画像を受け取る (描くのは次の画面更新のとき) ----
  frame(m) {
    if (this.pending && this.pending.bitmap) { try { this.pending.bitmap.close() } catch {} }
    this.pending = m
    if (m.title) this.title = m.title
    if (typeof document !== 'undefined' && document.hidden) { this.paint(); return }
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint() })
  }

  paint() {
    const m = this.pending
    if (!m) return
    this.pending = null
    try {
      if (m.w !== this.w || m.h !== this.h || m.scale !== this.scale) this.resize(m.w, m.h, m.scale)
      if (m.bitmap) { this.ctx.drawImage(m.bitmap, 0, 0); m.bitmap.close() }
      else if (m.data) this.ctx.putImageData(new ImageData(m.data instanceof Uint8ClampedArray ? m.data : new Uint8ClampedArray(m.data), m.w, m.h), 0, 0)
    } catch {}
    this.frames++
    if (this.title && this.titleEl.textContent !== this.title) this.titleEl.textContent = this.title
    if (this.frames === 2) this.el.classList.add('sf-animating')
    this.tickFps()
    this.ack(m.seq)
  }

  resize(w, h2, scale = 1) {
    this.w = w; this.h = h2; this.scale = scale || 1
    this.canvas.width = w; this.canvas.height = h2
    const lw = Math.round(w / this.scale), lh = Math.round(h2 / this.scale)
    this.stage.style.setProperty('--ar', `${lw} / ${lh}`)
    this.stage.style.setProperty('--lw', lw + 'px')
    this.stage.style.setProperty('--ratio', String(lw / lh))
    if (this.kind === 'pg' && (lw <= 320 || lh <= 240)) this.canvas.classList.add('pixel')
  }

  tickFps() {
    const now = performance.now()
    this.fpsT = this.fpsT || []
    this.fpsT.push(now)
    while (this.fpsT.length && now - this.fpsT[0] > 1000) this.fpsT.shift()
    if (this.frames > 10 && this.live) {
      this.fpsEl.classList.remove('hidden')
      const fps = this.fpsT.length
      if (Math.abs((this.lastFps || 0) - fps) >= 2 || !this.lastFps) { this.lastFps = fps; this.fpsEl.textContent = fps + ' fps' }
    }
  }

  finish() {
    this.live = false
    this.el.classList.remove('sf-animating', 'sf-sticky')
    this.fpsEl.classList.add('hidden')
    this.keypad.classList.add('hidden')
    this.unbindKeys()
    if (this.pending) this.paint()
  }

  toggleMax(force) {
    const on = force === undefined ? !this.el.classList.contains('sf-max') : force
    this.el.classList.toggle('sf-max', on)
    this.maxBtn.replaceChildren(icon(on ? 'shrink' : 'expand', 16))
    this.maxBtn.title = on ? '元の大きさに戻す' : '大きく表示'
    if (on) {
      this.onEsc = e => { if (e.key === 'Escape' && !(this.kind === 'pg' && this.live)) { e.preventDefault(); this.toggleMax(false) } }
      document.addEventListener('keydown', this.onEsc)
      this.canvas.focus({ preventScroll: true })
    } else if (this.onEsc) { document.removeEventListener('keydown', this.onEsc); this.onEsc = null }
  }

  save() {
    if (this.pending) this.paint()
    this.canvas.toBlob(b => {
      if (!b) return
      const url = URL.createObjectURL(b)
      const a = h('a', { href: url, download: (this.kind === 'pg' ? 'game' : 'figure') + '.png' })
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    }, 'image/png')
  }

  // ---- pygame: キー・マウス → Python ----
  pos(e) {
    const r = this.canvas.getBoundingClientRect()
    return { x: Math.round((e.clientX - r.left) / r.width * this.w), y: Math.round((e.clientY - r.top) / r.height * this.h) }
  }
  bindInput() {
    const c = this.canvas
    const btn = e => (e.button === 2 ? 3 : e.button === 1 ? 2 : 1)
    let last = 0
    c.addEventListener('pointerdown', e => { if (!this.live) return; c.focus({ preventScroll: true }); try { c.setPointerCapture(e.pointerId) } catch {} this.onEvent({ s: 'pg', t: 'md', ...this.pos(e), b: btn(e) }) })
    c.addEventListener('pointerup', e => { if (this.live) this.onEvent({ s: 'pg', t: 'mu', ...this.pos(e), b: btn(e) }) })
    c.addEventListener('pointermove', e => {
      if (!this.live) return
      const now = performance.now()
      if (now - last < 14) return
      last = now
      this.onEvent({ s: 'pg', t: 'mm', ...this.pos(e), bs: e.buttons })
    })
    c.addEventListener('wheel', e => { if (!this.live) return; e.preventDefault(); this.onEvent({ s: 'pg', t: 'mw', dx: Math.sign(e.deltaX), dy: -Math.sign(e.deltaY) }) }, { passive: false })
    c.addEventListener('contextmenu', e => e.preventDefault())
    // ゲームの間は、入力欄にいないときのキーをゲームへ送る (画面をタップしなくても操作できる)
    this.onKey = e => {
      if (!this.live || e.isComposing) return
      const t = e.target
      if (t && t !== c && t !== document.body && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (!this.el.isConnected || !this.el.offsetParent && !this.el.classList.contains('sf-max')) return
      if (e.metaKey || (e.ctrlKey && /^[a-z]$/i.test(e.key) && !/^[wasd]$/i.test(e.key))) return
      if (/^(Arrow|Space|Tab$|Enter$|Backspace$)/.test(e.code) || e.key === ' ' || e.key === 'Tab') e.preventDefault()
      const mods = (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0)
      this.onEvent({ s: 'pg', t: e.type === 'keydown' ? 'kd' : 'ku', k: e.key, c: e.code, m: mods, r: e.repeat ? 1 : 0 })
    }
    document.addEventListener('keydown', this.onKey)
    document.addEventListener('keyup', this.onKey)
  }
  unbindKeys() {
    if (this.onKey) { document.removeEventListener('keydown', this.onKey); document.removeEventListener('keyup', this.onKey); this.onKey = null }
    if (this.onEsc) { document.removeEventListener('keydown', this.onEsc); this.onEsc = null }
  }

  // ゲームが使うキーのボタン (タッチの端末だけ)
  setKeys(names) {
    this.keypad.textContent = ''
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    const list = [...new Set(names || [])].map(n => [n, keyInfo(n)]).filter(([, k]) => k).slice(0, 10)
    if (!touch || !list.length || !this.live) { this.keypad.classList.add('hidden'); return }
    const make = ([name, [key, code, label]]) => {
      const b = h('button', { class: 'btn small sf-key', 'aria-label': label }, label)
      let down = false
      const up = () => { if (!down) return; down = false; b.classList.remove('down'); this.onEvent({ s: 'pg', t: 'ku', k: key, c: code, m: 0 }) }
      b.addEventListener('pointerdown', e => { e.preventDefault(); if (down) return; down = true; b.classList.add('down'); this.onEvent({ s: 'pg', t: 'kd', k: key, c: code, m: 0 }) })
      b.addEventListener('pointerup', up)
      b.addEventListener('pointerleave', up)
      b.addEventListener('pointercancel', up)
      return b
    }
    const arrows = ['K_UP', 'K_LEFT', 'K_DOWN', 'K_RIGHT']
    const wasd = ['K_w', 'K_a', 'K_s', 'K_d']
    const has = n => list.some(([x]) => x === n)
    const pad = set => h('div', { class: 'tt-dpad' }, set.map(n => has(n) ? make(list.find(([x]) => x === n)) : h('span', { class: 'tt-key-gap' })))
    if (arrows.some(has)) this.keypad.append(pad(arrows))
    else if (wasd.filter(has).length >= 3) this.keypad.append(pad(wasd))
    const used = new Set([...(arrows.some(has) ? arrows : []), ...(!arrows.some(has) && wasd.filter(has).length >= 3 ? wasd : [])])
    const rest = list.filter(([n]) => !used.has(n))
    if (rest.length) this.keypad.append(h('div', { class: 'tt-other' }, rest.map(make)))
    this.keypad.classList.remove('hidden')
  }
}

// tkinter の PhotoImage (id → { src: ImageBitmap か canvas, w, h })
export const tkImages = new Map()

// ============================================================
// 画面への頼みごと (ワーカーは共有メモリで結果を待っている)
// ============================================================
export async function handleRpc(m) {
  const ctl = new Int32Array(m.ctl)
  const buf = new Uint8Array(m.buf)
  const reply = (st, bytes, w = 0, h2 = 0) => {
    if (bytes && bytes.length > buf.length) { Atomics.store(ctl, 1, bytes.length); Atomics.store(ctl, 0, 3); Atomics.notify(ctl, 0); return }
    if (bytes) buf.set(bytes)
    Atomics.store(ctl, 1, bytes ? bytes.length : 0)
    Atomics.store(ctl, 2, w)
    Atomics.store(ctl, 3, h2)
    Atomics.store(ctl, 0, st)
    Atomics.notify(ctl, 0)
  }
  const text = s => new TextEncoder().encode(String(s))
  try {
    if (m.op === 'decode') {
      const bmp = await createImageBitmap(new Blob([m.data]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
      const w = bmp.width, h2 = bmp.height
      if (w * h2 > 4096 * 4096) { bmp.close(); throw new Error(`画像が大きすぎます (${w}×${h2})`) }
      const c = document.createElement('canvas')
      c.width = w; c.height = h2
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(bmp, 0, 0)
      bmp.close()
      const id = ctx.getImageData(0, 0, w, h2)
      reply(1, new Uint8Array(id.data.buffer), w, h2)
    } else if (m.op === 'imgreg') {
      const id = String((m.args || {}).id || '')
      if (m.data) {
        const bmp = await createImageBitmap(new Blob([m.data]))
        tkImages.set(id, { src: bmp, w: bmp.width, h: bmp.height })
        reply(1, null, bmp.width, bmp.height)
      } else {
        const w = Math.max(0, m.args.w | 0), h2 = Math.max(0, m.args.h | 0)
        const c = document.createElement('canvas')
        c.width = Math.max(1, w); c.height = Math.max(1, h2)
        tkImages.set(id, { src: c, w, h: h2 })
        reply(1, null, w, h2)
      }
    } else if (m.op === 'dialog') {
      const v = await programDialog(m.args || {})
      reply(1, text(JSON.stringify(v === undefined ? null : v)))
    } else reply(2, text('知らない頼みごとです: ' + m.op))
  } catch (e) {
    reply(2, text(e && e.message ? e.message : e))
  }
}

// tkinter.messagebox / simpledialog / colorchooser など、プログラムが出すダイアログ
const DIALOG_ICON = { info: 'info', warning: 'alert', error: 'close', question: 'info' }
export function programDialog(a) {
  return new Promise(resolve => {
    const kind = a.kind || 'info'
    const msg = h('div', { class: 'pd-msg' }, String(a.message || ''))
    const body = h('div', { class: 'pd-body pd-' + (a.icon || kind) }, h('span', { class: 'pd-icon' }, icon(DIALOG_ICON[a.icon] || 'info', 22)), msg)
    let field = null
    if (kind === 'string' || kind === 'integer' || kind === 'float') {
      field = h('input', { class: 'input', value: a.initial === undefined || a.initial === null ? '' : String(a.initial), type: kind === 'string' ? (a.show ? 'password' : 'text') : 'text', inputmode: kind === 'string' ? 'text' : 'decimal', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
      body.append(field)
    } else if (kind === 'color') {
      field = h('input', { type: 'color', class: 'pd-color', value: /^#[0-9a-f]{6}$/i.test(a.initial || '') ? a.initial : '#3d7ae0' })
      body.append(field)
    }
    if (kind === 'file') {
      const files = (a.files || []).slice(0, 500)
      const list = h('div', { class: 'pd-files' }, files.length ? files.map(f => h('button', { class: 'pd-file', onclick: () => { finish(f); md.close() } }, icon('file', 15), h('span', null, f))) : h('div', { class: 'pd-msg' }, 'プロジェクトに選べるファイルがありません'))
      body.append(list)
    }
    const err = h('div', { class: 'pd-err hidden' })
    body.append(err)
    let done = false
    const finish = v => { if (done) return; done = true; resolve(v) }
    const value = () => {
      if (!field) return true
      const s = field.value
      if (kind === 'integer') { if (!/^[-+]?\d+$/.test(s.trim())) return fail('整数を入れてください'); const n = parseInt(s, 10); if (a.min !== undefined && a.min !== null && n < a.min) return fail(`${a.min} 以上にしてください`); if (a.max !== undefined && a.max !== null && n > a.max) return fail(`${a.max} 以下にしてください`); return { v: n } }
      if (kind === 'float') { const n = Number(s.trim()); if (!s.trim() || !Number.isFinite(n)) return fail('数を入れてください'); if (a.min !== undefined && a.min !== null && n < a.min) return fail(`${a.min} 以上にしてください`); if (a.max !== undefined && a.max !== null && n > a.max) return fail(`${a.max} 以下にしてください`); return { v: n } }
      return { v: s }
    }
    function fail(t) { err.textContent = t; err.classList.remove('hidden'); return false }
    const buttons = {
      info: [['OK', 'ok', true]], warning: [['OK', 'ok', true]], error: [['OK', 'ok', true]],
      yesno: [['いいえ', 'no'], ['はい', 'yes', true]], okcancel: [['キャンセル', 'cancel'], ['OK', 'ok', true]],
      yesnocancel: [['キャンセル', 'cancel'], ['いいえ', 'no'], ['はい', 'yes', true]], retrycancel: [['キャンセル', 'cancel'], ['再試行', 'retry', true]],
      abortretryignore: [['中止', 'abort'], ['再試行', 'retry'], ['無視', 'ignore', true]],
      string: [['キャンセル', null], ['OK', '@value', true]], integer: [['キャンセル', null], ['OK', '@value', true]], float: [['キャンセル', null], ['OK', '@value', true]],
      color: [['キャンセル', null], ['OK', '@value', true]], file: [['キャンセル', null]],
    }[kind] || [['OK', 'ok', true]]
    const md = modal({
      title: String(a.title || 'メッセージ'), body, sheet: false, cls: 'program-dialog',
      actions: buttons.map(([label, v, primary]) => ({ label, primary, run: () => { if (v === '@value') { const r = value(); if (!r) return false; finish(r.v) } else finish(v); return undefined } })),
      onClose: () => finish(kind === 'yesno' ? 'no' : kind === 'okcancel' || kind === 'yesnocancel' || kind === 'retrycancel' ? 'cancel' : buttons.length === 1 ? 'ok' : null),
    })
    if (field) {
      field.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { const r = value(); if (r) { finish(r.v); md.close() } } })
      setTimeout(() => { field.focus(); if (field.select) field.select() }, 60)
    }
  })
}

// ============================================================
// 音 (pygame.mixer / winsound): Web Audio で鳴らす
// ============================================================
export class SoundPlayer {
  constructor() { this.buffers = new Map(); this.playing = new Map(); this.music = null; this.ctx = null; this.vol = new Map() }
  audio() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      this.ctx = new AC()
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
    return this.ctx
  }
  async load(id, data) {
    const ctx = this.audio()
    if (!ctx || !data) return
    const p = ctx.decodeAudioData(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)).catch(() => null)
    this.buffers.set(id, p)
    return p
  }
  async handle(m) {
    try {
      const ctx = this.audio()
      if (!ctx) return
      if (m.data) await this.load(m.id, m.data)
      if (m.op === 'play') {
        const buf = await this.buffers.get(m.id)
        if (!buf) return
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.loop = m.loops === -1 || m.loops > 0
        const gain = ctx.createGain()
        gain.gain.value = Math.max(0, Math.min(1, m.volume === undefined ? 1 : m.volume))
        src.connect(gain).connect(ctx.destination)
        const ch = m.channel || m.id
        this.stop(ch)
        src.start(0, m.start || 0)
        if (m.loops > 0) setTimeout(() => { try { src.loop = false } catch {} }, buf.duration * 1000 * (m.loops + 1) - 30)
        if (m.maxtime > 0) src.stop(ctx.currentTime + m.maxtime / 1000)
        this.playing.set(ch, { src, gain })
        src.onended = () => { if (this.playing.get(ch) && this.playing.get(ch).src === src) this.playing.delete(ch) }
      } else if (m.op === 'stop') this.stop(m.channel || m.id)
      else if (m.op === 'volume') { const p = this.playing.get(m.channel || m.id); if (p) p.gain.gain.value = Math.max(0, Math.min(1, m.volume)) }
      else if (m.op === 'pause') { if (ctx.state === 'running') ctx.suspend() }
      else if (m.op === 'unpause') { if (ctx.state === 'suspended') ctx.resume() }
      else if (m.op === 'beep') {
        const o = ctx.createOscillator(), g = ctx.createGain()
        o.frequency.value = Math.max(37, Math.min(32767, m.freq || 440))
        o.type = m.wave || 'square'
        g.gain.value = 0.08
        o.connect(g).connect(ctx.destination)
        o.start()
        o.stop(ctx.currentTime + Math.max(0.01, (m.ms || 200) / 1000))
      } else if (m.op === 'stopall') this.stopAll()
    } catch {}
  }
  stop(ch) { const p = this.playing.get(ch); if (p) { try { p.src.stop() } catch {} this.playing.delete(ch) } }
  stopAll() { for (const ch of [...this.playing.keys()]) this.stop(ch); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}) }
}
