// pygame 互換版の描画 (python-worker の中で動く)
// ・Surface ごとに OffscreenCanvas を 1 つ持つ。Python は描く命令をためておき、まとめて JSON で渡す (1 回ずつ呼ぶより速い)
// ・画面に出すとき (display.flip) は、画面の Surface を 1 枚の画像 (ImageBitmap) にして送る
// ・画素を読む操作 (get_at・mask・surfarray・image.save) は、その時点までの命令を先に実行してから読む
export function installPgCanvas(scope) {
  const surf = new Map()   // id → { c, x, v, clip, w, h }
  const ckCache = new Map() // id → { v, key, c } (colorkey で透明にしたもの)
  let nextId = 1
  const OC = typeof OffscreenCanvas === 'function' ? OffscreenCanvas : null

  // 使い終わったキャンバスは捨てずに取っておき、同じ大きさのものに使い回す
  // (ゲームは毎フレーム文字や回転した絵を作るので、作っては捨てるとメモリが一時的にふくらみ、スマホでは落ちることがある)
  const pool = new Map()     // "w x h" → [canvas]
  let pooled = 0, pooledPx = 0
  const POOL_MAX = 96, POOL_PX = 6_000_000
  const make = (w, h) => {
    if (!OC) throw new Error('この端末のブラウザでは pygame の画面を作れません (OffscreenCanvas に対応していません)')
    w = Math.max(1, w | 0); h = Math.max(1, h | 0)
    const list = pool.get(w + 'x' + h)
    if (list && list.length) {
      const c = list.pop()
      pooled--; pooledPx -= w * h
      const x = c.getContext('2d')
      x.setTransform(1, 0, 0, 1, 0, 0)
      x.globalAlpha = 1
      x.globalCompositeOperation = 'source-over'
      x.clearRect(0, 0, w, h)
      return c
    }
    return new OC(w, h)
  }
  const recycle = c => {
    const px = c.width * c.height
    if (pooled >= POOL_MAX || pooledPx + px > POOL_PX) return
    const k = c.width + 'x' + c.height
    if (!pool.has(k)) pool.set(k, [])
    pool.get(k).push(c)
    pooled++; pooledPx += px
  }
  const add = (c, w, h) => {
    const x = c.getContext('2d', { willReadFrequently: false })
    x.imageSmoothingEnabled = false
    const id = nextId++
    surf.set(id, { c, x, v: 0, clip: null, w, h })
    return id
  }
  scope.__fc_pg_new = (w, h, alpha) => {
    const c = make(w, h)
    const id = add(c, w | 0, h | 0)
    if (!alpha) { const s = surf.get(id); s.x.fillStyle = '#000'; s.x.fillRect(0, 0, c.width, c.height) }
    return id
  }
  scope.__fc_pg_adopt = c => add(c, c.width, c.height)
  scope.__fc_pg_size = id => { const s = surf.get(id); return s ? [s.w, s.h] : [0, 0] }
  scope.__fc_pg_count = () => surf.size
  scope.__fc_pg_reset = () => { surf.clear(); ckCache.clear(); pool.clear(); pooled = 0; pooledPx = 0 }

  const withClip = (s, fn) => {
    if (!s.clip) { fn(); return }
    s.x.save()
    s.x.beginPath()
    s.x.rect(s.clip[0], s.clip[1], s.clip[2], s.clip[3])
    s.x.clip()
    try { fn() } finally { s.x.restore() }
  }
  const BLEND = { 1: 'lighter', 2: 'difference', 3: 'multiply', 4: 'darken', 5: 'lighten', 6: 'lighter', 7: 'difference', 8: 'multiply', 9: 'darken', 10: 'lighten' }

  // colorkey: 指定の色を透明にしたもの (Surface が変わったら作り直す)
  function keyed(id, s, key) {
    const k = key.join(',')
    const hit = ckCache.get(id)
    if (hit && hit.v === s.v && hit.key === k) return hit.c
    if (hit) recycle(hit.c)
    const c = make(s.c.width, s.c.height)
    const x = c.getContext('2d')
    const img = s.x.getImageData(0, 0, s.c.width, s.c.height)
    const d = img.data
    const [r, g, b] = key
    for (let i = 0; i < d.length; i += 4) if (d[i] === r && d[i + 1] === g && d[i + 2] === b) d[i + 3] = 0
    x.putImageData(img, 0, 0)
    ckCache.set(id, { v: s.v, key: k, c })
    return c
  }

  function run(op) {
    const s = surf.get(op[1])
    if (!s) return
    const x = s.x
    switch (op[0]) {
      case 'fill': { // id, css, rect|null, replace, blend
        const [, , css, r, replace, blend] = op
        const R = r || [0, 0, s.w, s.h]
        withClip(s, () => {
          if (blend && BLEND[blend]) { x.save(); x.globalCompositeOperation = BLEND[blend]; x.fillStyle = css; x.fillRect(R[0], R[1], R[2], R[3]); x.restore() }
          else { if (replace) x.clearRect(R[0], R[1], R[2], R[3]); x.fillStyle = css; x.fillRect(R[0], R[1], R[2], R[3]) }
        })
        break
      }
      case 'rect': { // id, css, x, y, w, h, width, [tl, tr, bl, br]
        const [, , css, rx, ry, rw, rh, width, rad] = op
        withClip(s, () => {
          const round = rad && rad.some(v => v > 0)
          if (width > 0) {
            x.strokeStyle = css; x.lineWidth = width
            if (round && x.roundRect) { x.beginPath(); x.roundRect(rx + width / 2, ry + width / 2, Math.max(0, rw - width), Math.max(0, rh - width), [rad[0], rad[1], rad[3], rad[2]].map(v => Math.max(0, v - width / 2))); x.stroke() }
            else x.strokeRect(rx + width / 2, ry + width / 2, Math.max(0, rw - width), Math.max(0, rh - width))
          } else {
            x.fillStyle = css
            if (round && x.roundRect) { x.beginPath(); x.roundRect(rx, ry, rw, rh, [rad[0], rad[1], rad[3], rad[2]].map(v => Math.max(0, v))); x.fill() }
            else x.fillRect(rx, ry, rw, rh)
          }
        })
        break
      }
      case 'circle': { // id, css, cx, cy, r, width
        const [, , css, cx, cy, r, width] = op
        withClip(s, () => {
          x.beginPath()
          if (width > 0) { x.arc(cx, cy, Math.max(0, r - width / 2), 0, Math.PI * 2); x.strokeStyle = css; x.lineWidth = width; x.stroke() }
          else { x.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2); x.fillStyle = css; x.fill() }
        })
        break
      }
      case 'ellipse': { // id, css, x, y, w, h, width
        const [, , css, ex, ey, ew, eh, width] = op
        withClip(s, () => {
          x.beginPath()
          const half = width > 0 ? width / 2 : 0
          x.ellipse(ex + ew / 2, ey + eh / 2, Math.max(0, ew / 2 - half), Math.max(0, eh / 2 - half), 0, 0, Math.PI * 2)
          if (width > 0) { x.strokeStyle = css; x.lineWidth = width; x.stroke() } else { x.fillStyle = css; x.fill() }
        })
        break
      }
      case 'arc': { // id, css, x, y, w, h, start, stop, width
        const [, , css, ex, ey, ew, eh, a0, a1, width] = op
        withClip(s, () => {
          x.beginPath()
          const w2 = Math.max(1, width)
          // pygame は上向きが正 (反時計回り)
          x.ellipse(ex + ew / 2, ey + eh / 2, Math.max(0, ew / 2 - w2 / 2), Math.max(0, eh / 2 - w2 / 2), 0, -a0, -a1, true)
          x.strokeStyle = css; x.lineWidth = w2; x.stroke()
        })
        break
      }
      case 'line': { // id, css, x1, y1, x2, y2, width
        const [, , css, x1, y1, x2, y2, width] = op
        withClip(s, () => {
          x.beginPath(); x.moveTo(x1 + 0.5, y1 + 0.5); x.lineTo(x2 + 0.5, y2 + 0.5)
          x.strokeStyle = css; x.lineWidth = Math.max(1, width); x.lineCap = width > 2 ? 'butt' : 'square'; x.stroke()
        })
        break
      }
      case 'lines': // id, css, closed, pts, width
      case 'poly': { // id, css, pts, width
        const css = op[2]
        const closed = op[0] === 'poly' ? true : op[3]
        const pts = op[0] === 'poly' ? op[3] : op[4]
        const width = op[0] === 'poly' ? op[4] : op[5]
        if (pts.length < 4) break
        withClip(s, () => {
          x.beginPath()
          const off = op[0] === 'poly' && !(width > 0) ? 0 : 0.5
          for (let i = 0; i < pts.length; i += 2) i ? x.lineTo(pts[i] + off, pts[i + 1] + off) : x.moveTo(pts[i] + off, pts[i + 1] + off)
          if (closed) x.closePath()
          if (op[0] === 'poly' && !(width > 0)) { x.fillStyle = css; x.fill() }
          else { x.strokeStyle = css; x.lineWidth = Math.max(1, width); x.lineJoin = 'miter'; x.stroke() }
        })
        break
      }
      case 'blit': { // dst, src, dx, dy, sx, sy, sw, sh, alpha, colorkey, blend
        const [, , srcId, dx, dy, sx, sy, sw, sh, alpha, ck, blend] = op
        const src = surf.get(srcId)
        if (!src || sw <= 0 || sh <= 0) break
        const img = ck ? keyed(srcId, src, ck) : src.c
        withClip(s, () => {
          const special = (alpha >= 0 && alpha < 255) || (blend && BLEND[blend])
          if (special) { x.save(); if (alpha >= 0 && alpha < 255) x.globalAlpha = alpha / 255; if (blend && BLEND[blend]) x.globalCompositeOperation = BLEND[blend] }
          x.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh)
          if (special) x.restore()
        })
        break
      }
      case 'text': { // id, font, text, x, y, css, bg, underline
        const [, , font, text, tx, ty, css, bg, underline] = op
        if (bg) { x.fillStyle = bg; x.fillRect(0, 0, s.w, s.h) }
        x.font = font
        x.textBaseline = 'alphabetic'
        x.fillStyle = css
        x.fillText(text, tx, ty)
        if (underline) { const m = x.measureText(text); x.fillRect(tx, ty + 2, m.width, Math.max(1, Math.round(s.h / 18))) }
        break
      }
      case 'pix': { // id, x, y, css
        x.save(); x.clearRect(op[2], op[3], 1, 1); x.fillStyle = op[4]; x.fillRect(op[2], op[3], 1, 1); x.restore()
        break
      }
      case 'clip': s.clip = op[2] || null; return
      case 'copy': { const src = surf.get(op[2]); if (src) { x.clearRect(0, 0, s.w, s.h); x.drawImage(src.c, 0, 0) } break }
      case 'scale': { // dst, src, smooth, [area]
        const src = surf.get(op[2]); if (!src) break
        x.save(); x.imageSmoothingEnabled = !!op[3]; if (op[3]) x.imageSmoothingQuality = 'high'
        x.clearRect(0, 0, s.w, s.h)
        x.drawImage(src.c, 0, 0, src.w, src.h, 0, 0, s.w, s.h)
        x.restore()
        break
      }
      case 'rot': { // dst, src, angleDeg, scale, smooth
        const src = surf.get(op[2]); if (!src) break
        x.save(); x.imageSmoothingEnabled = !!op[5]
        x.clearRect(0, 0, s.w, s.h)
        x.translate(s.w / 2, s.h / 2); x.rotate(-op[3] * Math.PI / 180); x.scale(op[4], op[4])
        x.drawImage(src.c, -src.w / 2, -src.h / 2)
        x.restore()
        break
      }
      case 'flip': { // dst, src, fx, fy
        const src = surf.get(op[2]); if (!src) break
        x.save(); x.clearRect(0, 0, s.w, s.h)
        x.translate(op[3] ? s.w : 0, op[4] ? s.h : 0); x.scale(op[3] ? -1 : 1, op[4] ? -1 : 1)
        x.drawImage(src.c, 0, 0)
        x.restore()
        break
      }
      case 'scroll': { // id, dx, dy
        const tmp = make(s.w, s.h); tmp.getContext('2d').drawImage(s.c, 0, 0)
        x.drawImage(tmp, op[2], op[3])
        recycle(tmp)
        break
      }
      case 'gray': { // dst, src
        const src = surf.get(op[2]); if (!src) break
        const img = src.x.getImageData(0, 0, src.w || 1, src.h || 1); const d = img.data
        for (let i = 0; i < d.length; i += 4) { const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); d[i] = d[i + 1] = d[i + 2] = g }
        x.putImageData(img, 0, 0)
        break
      }
      case 'free': { surf.delete(op[1]); const ck = ckCache.get(op[1]); if (ck) recycle(ck.c); ckCache.delete(op[1]); recycle(s.c); return }
    }
    s.v++
  }
  scope.__fc_pg_exec = json => {
    const ops = JSON.parse(json)
    for (const op of ops) { try { run(op) } catch {} }
  }
  // 画素を読む (RGBA)
  scope.__fc_pg_pixels = (id, x, y, w, h) => {
    const s = surf.get(id)
    if (!s || w <= 0 || h <= 0) return new Uint8Array(0)
    return new Uint8Array(s.x.getImageData(x, y, w, h).data.buffer)
  }
  // 画素を書く (RGBA)
  scope.__fc_pg_put = (id, data, x, y, w, h) => {
    const s = surf.get(id)
    if (!s) return
    const arr = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data)
    s.x.putImageData(new ImageData(arr, w, h), x, y)
    s.v++
  }
  // 文字の大きさ [幅, 上, 下]
  const measurer = OC ? new OC(1, 1).getContext('2d') : null
  scope.__fc_pg_measure = (font, text) => {
    if (!measurer) return [text.length * 8, 12, 4]
    measurer.font = font
    const m = measurer.measureText(text)
    const asc = m.fontBoundingBoxAscent !== undefined ? m.fontBoundingBoxAscent : m.actualBoundingBoxAscent
    const desc = m.fontBoundingBoxDescent !== undefined ? m.fontBoundingBoxDescent : m.actualBoundingBoxDescent
    return [m.width, asc || 0, desc || 0]
  }
  // フォントファイル (.ttf / .otf) を読み込む
  scope.__fc_pg_font = (name, data) => {
    try {
      if (typeof FontFace !== 'function' || !scope.fonts) return false
      const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data)
      const face = new FontFace(name, bytes.buffer)
      scope.fonts.add(face)
      face.load().catch(() => {})
      return true
    } catch { return false }
  }
  // 画面に出す (画像にして送る)
  scope.__fc_pg_present = (id, key, title) => {
    const s = surf.get(id)
    if (!s) return
    scope.__fc_present(key, s.c, title)
  }
}
