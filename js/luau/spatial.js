// 空間の問い合わせ: レイキャスト・範囲内のパーツ・カメラの投影
// 物理シミュレーションはしませんが、パーツの位置 (CFrame) と大きさ (Size) から実際に計算します。
//  ・workspace:Raycast / Spherecast / Blockcast / FindPartOnRay*
//  ・workspace:GetPartBoundsInBox / GetPartBoundsInRadius / GetPartsInPart / FindPartsInRegion3 / BasePart:GetTouchingParts
//  ・Camera:WorldToViewportPoint / WorldToScreenPoint / ViewportPointToRay / ScreenPointToRay
import { LTable } from './runtime.js'
import { V3, V2, CF } from './rbx-types.js'

// CFrame の回転 r は行優先の 3x3 (mulRV(r, v) = r · v)
const toLocal = (c, x, y, z) => {
  const dx = x - c.x, dy = y - c.y, dz = z - c.z, r = c.r
  return [r[0] * dx + r[3] * dy + r[6] * dz, r[1] * dx + r[4] * dy + r[7] * dz, r[2] * dx + r[5] * dy + r[8] * dz]
}
const dirToLocal = (r, x, y, z) => [r[0] * x + r[3] * y + r[6] * z, r[1] * x + r[4] * y + r[7] * z, r[2] * x + r[5] * y + r[8] * z]
const dirToWorld = (r, x, y, z) => [r[0] * x + r[1] * y + r[2] * z, r[3] * x + r[4] * y + r[5] * z, r[6] * x + r[7] * y + r[8] * z]

// レイ (o + d·t, 0 ≦ t ≦ 1) と箱 (CFrame c, 大きさ s) の交点。始点が箱の中なら当たらない (Roblox と同じ)
export function rayBox(c, s, o, d) {
  const lo = toLocal(c, o.x, o.y, o.z)
  const ld = dirToLocal(c.r, d.x, d.y, d.z)
  const h = [s.x / 2, s.y / 2, s.z / 2]
  let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0
  for (let a = 0; a < 3; a++) {
    if (Math.abs(ld[a]) < 1e-12) { if (Math.abs(lo[a]) > h[a]) return null; continue }
    const t1 = (-h[a] - lo[a]) / ld[a], t2 = (h[a] - lo[a]) / ld[a]
    const near = Math.min(t1, t2), far = Math.max(t1, t2)
    if (near > tmin) { tmin = near; axis = a; sign = t1 < t2 ? -1 : 1 }
    if (far < tmax) tmax = far
    if (tmin > tmax) return null
  }
  if (axis < 0 || tmin < 0 || tmin > 1) return null
  const n = [0, 0, 0]
  n[axis] = sign
  return { t: tmin, n: dirToWorld(c.r, n[0], n[1], n[2]) }
}
export function raySphere(c, radius, o, d) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z
  const a = d.x * d.x + d.y * d.y + d.z * d.z
  const b = 2 * (ox * d.x + oy * d.y + oz * d.z)
  const cc = ox * ox + oy * oy + oz * oz - radius * radius
  if (cc < 0) return null // 始点が中
  const disc = b * b - 4 * a * cc
  if (disc < 0 || a === 0) return null
  const t = (-b - Math.sqrt(disc)) / (2 * a)
  if (t < 0 || t > 1) return null
  const px = ox + d.x * t, py = oy + d.y * t, pz = oz + d.z * t, m = Math.hypot(px, py, pz) || 1
  return { t, n: [px / m, py / m, pz / m] }
}
// 回転した箱を囲む、軸にそろった箱 [minX, minY, minZ, maxX, maxY, maxZ]
export function aabbOf(c, s) {
  const r = c.r, hx = s.x / 2, hy = s.y / 2, hz = s.z / 2
  const ex = Math.abs(r[0]) * hx + Math.abs(r[1]) * hy + Math.abs(r[2]) * hz
  const ey = Math.abs(r[3]) * hx + Math.abs(r[4]) * hy + Math.abs(r[5]) * hz
  const ez = Math.abs(r[6]) * hx + Math.abs(r[7]) * hy + Math.abs(r[8]) * hz
  return [c.x - ex, c.y - ey, c.z - ez, c.x + ex, c.y + ey, c.z + ez]
}
const overlap = (a, b) => a[0] <= b[3] && a[3] >= b[0] && a[1] <= b[4] && a[4] >= b[1] && a[2] <= b[5] && a[5] >= b[2]

// opts: { getWorkspace, enums, makeResult, isA }
export function makeSpatial({ getWorkspace, enums, makeResult }) {
  const listFrom = t => {
    const out = []
    if (t && typeof t.length === 'function') for (let i = 1, n = t.length(); i <= n; i++) { const v = t.get(i); if (v && v.info) out.push(v) }
    return out
  }
  // params: RaycastParams / OverlapParams (なければ既定)
  const filterOf = params => {
    if (!params || !params.fields) return { list: [], include: false, collide: false, max: 0 }
    const f = params.fields
    const ft = f.get('FilterType')
    const name = ft && ft.name
    return { list: listFrom(f.get('FilterDescendantsInstances')), include: name === 'Include' || name === 'Whitelist', collide: !!f.get('RespectCanCollide'), max: f.get('MaxParts') || 0 }
  }
  const passes = (p, flt) => {
    if (flt.collide && !p.getProp('CanCollide')) return false
    const inList = flt.list.some(x => x === p || p.isDescendantOf(x))
    return flt.include ? inList : !inList
  }
  const parts = () => {
    const ws = getWorkspace()
    if (!ws) return []
    const out = []
    for (const d of ws.descendants()) if (!d.destroyed && d.info.isA.has('BasePart') && d.ClassName !== 'Terrain') out.push(d)
    return out
  }
  const isBall = p => { const sh = p.ClassName === 'Part' ? p.getProp('Shape') : null; return !!sh && sh.name === 'Ball' }

  // レイキャスト: { part, pos, normal, dist } または null
  function cast(o, d, flt, extra = 0) {
    let best = null
    const len = Math.hypot(d.x, d.y, d.z)
    if (!(len > 0)) return null
    for (const p of parts()) {
      if (p.getProp('CanQuery') === false || !passes(p, flt)) continue
      const c = p.getProp('CFrame'), s = p.getProp('Size')
      if (!c || !s) continue
      let hit
      if (isBall(p)) hit = raySphere(c, Math.min(s.x, s.y, s.z) / 2 + extra, o, d)
      else hit = rayBox(c, extra ? { x: s.x + extra * 2, y: s.y + extra * 2, z: s.z + extra * 2 } : s, o, d)
      if (hit && (!best || hit.t < best.t)) best = { ...hit, part: p }
    }
    if (!best) return null
    return { part: best.part, pos: V3(o.x + d.x * best.t, o.y + d.y * best.t, o.z + d.z * best.t), normal: V3(best.n[0], best.n[1], best.n[2]), dist: len * best.t }
  }
  const result = h => makeResult({ Instance: h.part, Position: h.pos, Normal: h.normal, Material: h.part.getProp('Material') || enums.item('Material', 'Plastic'), Distance: h.dist })

  function inBox(box, flt, except = null) {
    const out = []
    for (const p of parts()) {
      if (p === except || p.getProp('CanQuery') === false || !passes(p, flt)) continue
      const c = p.getProp('CFrame'), s = p.getProp('Size')
      if (c && s && overlap(box, aabbOf(c, s))) { out.push(p); if (flt.max && out.length >= flt.max) break }
    }
    return LTable.fromArray(out)
  }
  function inRadius(pos, radius, flt) {
    const out = []
    for (const p of parts()) {
      if (p.getProp('CanQuery') === false || !passes(p, flt)) continue
      const c = p.getProp('CFrame'), s = p.getProp('Size')
      if (!c || !s) continue
      const b = aabbOf(c, s)
      const dx = Math.max(b[0] - pos.x, 0, pos.x - b[3]), dy = Math.max(b[1] - pos.y, 0, pos.y - b[4]), dz = Math.max(b[2] - pos.z, 0, pos.z - b[5])
      if (dx * dx + dy * dy + dz * dz <= radius * radius) { out.push(p); if (flt.max && out.length >= flt.max) break }
    }
    return LTable.fromArray(out)
  }
  const ignoreFilter = list => ({ list, include: false, collide: false, max: 0 })
  const onlyFilter = list => ({ list, include: true, collide: false, max: 0 })
  const rayParts = ray => [ray.o || ray.Origin, ray.d || ray.Direction]
  const findOnRay = (ray, flt) => {
    const [o, d] = rayParts(ray)
    if (!o || !d) return [undefined, V3(0, 0, 0), V3(0, 0, 0), enums.item('Material', 'Air')]
    const h = cast(o, d, flt)
    if (!h) return [undefined, V3(o.x + d.x, o.y + d.y, o.z + d.z), V3(0, 0, 0), enums.item('Material', 'Air')]
    return [h.part, h.pos, h.normal, h.part.getProp('Material') || enums.item('Material', 'Plastic')]
  }

  return {
    // マウスなどから: 除外するインスタンスの一覧でレイを飛ばす
    castRay: (o, d, ignore = []) => cast(o, d, ignoreFilter(ignore)),
    Raycast: (A) => { const h = A[1] && A[2] ? cast(A[1], A[2], filterOf(A[3])) : null; return [h ? result(h) : undefined] },
    Spherecast: (A) => { const h = A[1] && A[3] ? cast(A[1], A[3], filterOf(A[4]), (A[2] || 0)) : null; return [h ? result(h) : undefined] },
    Blockcast: (A) => { const c = A[1], s = A[2]; const h = c && s && A[3] ? cast(V3(c.x, c.y, c.z), A[3], filterOf(A[4]), Math.max(s.x, s.y, s.z) / 2) : null; return [h ? result(h) : undefined] },
    FindPartOnRay: (A) => findOnRay(A[1], ignoreFilter(A[2] && A[2].info ? [A[2]] : [])),
    FindPartOnRayWithIgnoreList: (A) => findOnRay(A[1], ignoreFilter(listFrom(A[2]))),
    FindPartOnRayWithWhitelist: (A) => findOnRay(A[1], onlyFilter(listFrom(A[2]))),
    GetPartBoundsInBox: (A) => (A[1] && A[2] ? inBox(aabbOf(A[1], A[2]), filterOf(A[3])) : new LTable()),
    GetPartBoundsInRadius: (A) => (A[1] ? inRadius(A[1], A[2] || 0, filterOf(A[3])) : new LTable()),
    GetPartsInPart: (A) => { const p = A[1]; if (!p || !p.info) return new LTable(); return inBox(aabbOf(p.getProp('CFrame'), p.getProp('Size')), filterOf(A[2]), p) },
    FindPartsInRegion3: (A) => { const r = A[1]; if (!r || !r.CFrame) return new LTable(); return inBox(aabbOf(r.CFrame, r.Size), { ...ignoreFilter(A[2] && A[2].info ? [A[2]] : []), max: A[3] || 0 }) },
    GetTouchingParts: (A) => { const p = A[0]; if (!p.getProp('CFrame')) return new LTable(); return inBox(aabbOf(p.getProp('CFrame'), p.getProp('Size')), { list: [], include: false, collide: false, max: 0 }, p) },
  }
}

// ---- カメラの投影 ----
// 返り値: [Vector3(画面 x, 画面 y, 奥行き), 画面内か]
export function project(cam, p, inset = 0) {
  const c = cam.getProp('CFrame') || CF(0, 10, 20)
  const vs = cam.getProp('ViewportSize') || V2(1920, 1080)
  const fov = (cam.getProp('FieldOfView') || 70) * Math.PI / 180
  const [lx, ly, lz] = toLocal(c, p.x, p.y, p.z)
  const depth = -lz
  const f = 1 / Math.tan(fov / 2)
  const aspect = vs.x / vs.y
  const nx = depth !== 0 ? (lx / depth) * f / aspect : 0
  const ny = depth !== 0 ? (ly / depth) * f : 0
  const sx = (nx + 1) / 2 * vs.x
  const sy = (1 - ny) / 2 * vs.y - inset
  const on = depth > 0 && sx >= 0 && sx <= vs.x && sy + inset >= 0 && sy + inset <= vs.y
  return [V3(sx, sy, depth), on]
}
// 画面の点を通るレイ (長さ 1 の向き)。depth があればその長さ
export function unproject(cam, x, y, depth = 1, inset = 0) {
  const c = cam.getProp('CFrame') || CF(0, 10, 20)
  const vs = cam.getProp('ViewportSize') || V2(1920, 1080)
  const fov = (cam.getProp('FieldOfView') || 70) * Math.PI / 180
  const f = 1 / Math.tan(fov / 2)
  const aspect = vs.x / vs.y
  const nx = (x / vs.x) * 2 - 1, ny = 1 - ((y + inset) / vs.y) * 2
  const lx = nx * aspect / f, ly = ny / f, lz = -1
  const [wx, wy, wz] = dirToWorld(c.r, lx, ly, lz)
  const m = Math.hypot(wx, wy, wz) || 1
  return { o: V3(c.x, c.y, c.z), d: V3(wx / m * depth, wy / m * depth, wz / m * depth) }
}
