// Roblox データ型 (Vector3, CFrame, Color3, UDim2, Enum など) のサンドボックス実装
import { LTable, LFunc, native, rtError, fmtNum, rt, callSync, T } from './runtime.js'
import { fromBytes, toBytes } from './lexer.js'

// ---- 共通の userdata 型定義ヘルパー ----
const fmt = fmtNum
export function defineType(name, spec) {
  const methods = {}
  for (const [m, f] of Object.entries(spec.methods || {})) methods[m] = native(m, f)
  const props = spec.props || {}
  const proto = {
    luaTypeName: name,
    meta: spec.meta || {},
    luaIndex(k) {
      const p = props[k]
      if (p) return p(this)
      const m = methods[k]
      if (m) return m
      throw rtError(`${fromBytes(String(k))} is not a valid member of ${name}`)
    },
    luaNewIndex(k) {
      throw rtError(`${fromBytes(String(k))} cannot be assigned to`)
    },
    luaToString() { return spec.tostring ? spec.tostring(this) : name },
  }
  if (spec.tostring) proto.meta.__tostring = v => spec.tostring(v)
  return function make(fields) {
    const o = Object.create(proto)
    Object.assign(o, fields)
    return o
  }
}

const num = (A, i, fname, def) => {
  const v = A[i]
  if (v === undefined && def !== undefined) return def
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v)
  throw rtError(`invalid argument #${i + 1} to '${fname}' (number expected, got ${v === undefined ? 'nil' : typeof v === 'object' ? (v.luaTypeName || 'table') : typeof v})`)
}
const is = (v, t) => v !== null && typeof v === 'object' && v.luaTypeName === t

// ============ Vector3 ============
export let V3
const v3meta = {
  __add: (a, b) => { chkV3(a, b, '+'); return V3(a.x + b.x, a.y + b.y, a.z + b.z) },
  __sub: (a, b) => { chkV3(a, b, '-'); return V3(a.x - b.x, a.y - b.y, a.z - b.z) },
  __mul: (a, b) => {
    if (typeof a === 'number') return V3(b.x * a, b.y * a, b.z * a)
    if (typeof b === 'number') return V3(a.x * b, a.y * b, a.z * b)
    if (is(a, 'Vector3') && is(b, 'Vector3')) return V3(a.x * b.x, a.y * b.y, a.z * b.z)
    throw rtError('invalid argument #2 (Vector3 or number expected)')
  },
  __div: (a, b) => {
    if (typeof b === 'number') return V3(a.x / b, a.y / b, a.z / b)
    if (typeof a === 'number') return V3(a / b.x, a / b.y, a / b.z)
    return V3(a.x / b.x, a.y / b.y, a.z / b.z)
  },
  __idiv: (a, b) => {
    if (typeof b === 'number') return V3(Math.floor(a.x / b), Math.floor(a.y / b), Math.floor(a.z / b))
    return V3(Math.floor(a.x / b.x), Math.floor(a.y / b.y), Math.floor(a.z / b.z))
  },
  __unm: a => V3(-a.x, -a.y, -a.z),
  __eq: (a, b) => a.x === b.x && a.y === b.y && a.z === b.z,
}
function chkV3(a, b, op) {
  if (!is(a, 'Vector3') || !is(b, 'Vector3')) throw rtError(`attempt to perform arithmetic (${op}) on ${is(a, 'Vector3') ? 'Vector3' : typeof a} and ${is(b, 'Vector3') ? 'Vector3' : typeof b}`)
}
const mag3 = v => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
const unit3 = v => { const m = mag3(v); return m === 0 ? V3(NaN, NaN, NaN) : V3(v.x / m, v.y / m, v.z / m) }
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const cross3 = (a, b) => V3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
const makeV3 = defineType('Vector3', {
  props: {
    X: v => v.x, Y: v => v.y, Z: v => v.z, x: v => v.x, y: v => v.y, z: v => v.z,
    Magnitude: mag3, magnitude: mag3, Unit: unit3, unit: unit3,
  },
  methods: {
    Dot: A => dot3(A[0], A[1]),
    Cross: A => cross3(A[0], A[1]),
    Lerp: A => { const [a, b] = A, t = num(A, 2, 'Lerp'); return V3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t) },
    lerp: A => { const [a, b] = A, t = num(A, 2, 'lerp'); return V3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t) },
    FuzzyEq: A => { const [a, b] = A, e = A[2] ?? 1e-5; return Math.abs(a.x - b.x) <= e && Math.abs(a.y - b.y) <= e && Math.abs(a.z - b.z) <= e },
    Min: A => V3(Math.min(...A.map(v => v.x)), Math.min(...A.map(v => v.y)), Math.min(...A.map(v => v.z))),
    Max: A => V3(Math.max(...A.map(v => v.x)), Math.max(...A.map(v => v.y)), Math.max(...A.map(v => v.z))),
    Abs: A => V3(Math.abs(A[0].x), Math.abs(A[0].y), Math.abs(A[0].z)),
    Ceil: A => V3(Math.ceil(A[0].x), Math.ceil(A[0].y), Math.ceil(A[0].z)),
    Floor: A => V3(Math.floor(A[0].x), Math.floor(A[0].y), Math.floor(A[0].z)),
    Sign: A => V3(Math.sign(A[0].x), Math.sign(A[0].y), Math.sign(A[0].z)),
    Angle: A => {
      const [a, b, axis] = A
      const ang = Math.atan2(mag3(cross3(a, b)), dot3(a, b))
      if (axis && dot3(cross3(a, b), axis) < 0) return -ang
      return ang
    },
  },
  meta: v3meta,
  tostring: v => `${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)}`,
})
V3 = (x, y, z) => makeV3({ x, y, z })

// ============ Vector2 ============
export let V2
const makeV2 = defineType('Vector2', {
  props: {
    X: v => v.x, Y: v => v.y, x: v => v.x, y: v => v.y,
    Magnitude: v => Math.hypot(v.x, v.y), magnitude: v => Math.hypot(v.x, v.y),
    Unit: v => { const m = Math.hypot(v.x, v.y); return V2(v.x / m, v.y / m) },
    unit: v => { const m = Math.hypot(v.x, v.y); return V2(v.x / m, v.y / m) },
  },
  methods: {
    Dot: A => A[0].x * A[1].x + A[0].y * A[1].y,
    Cross: A => A[0].x * A[1].y - A[0].y * A[1].x,
    Lerp: A => { const [a, b] = A, t = num(A, 2, 'Lerp'); return V2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) },
    FuzzyEq: A => { const e = A[2] ?? 1e-5; return Math.abs(A[0].x - A[1].x) <= e && Math.abs(A[0].y - A[1].y) <= e },
    Min: A => V2(Math.min(...A.map(v => v.x)), Math.min(...A.map(v => v.y))),
    Max: A => V2(Math.max(...A.map(v => v.x)), Math.max(...A.map(v => v.y))),
    Abs: A => V2(Math.abs(A[0].x), Math.abs(A[0].y)),
    Ceil: A => V2(Math.ceil(A[0].x), Math.ceil(A[0].y)),
    Floor: A => V2(Math.floor(A[0].x), Math.floor(A[0].y)),
    Sign: A => V2(Math.sign(A[0].x), Math.sign(A[0].y)),
    Angle: A => { const [a, b] = A; const ang = Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y); return A[2] ? ang : Math.abs(ang) },
  },
  meta: {
    __add: (a, b) => V2(a.x + b.x, a.y + b.y),
    __sub: (a, b) => V2(a.x - b.x, a.y - b.y),
    __mul: (a, b) => typeof a === 'number' ? V2(b.x * a, b.y * a) : typeof b === 'number' ? V2(a.x * b, a.y * b) : V2(a.x * b.x, a.y * b.y),
    __div: (a, b) => typeof b === 'number' ? V2(a.x / b, a.y / b) : V2(a.x / b.x, a.y / b.y),
    __unm: a => V2(-a.x, -a.y),
    __eq: (a, b) => a.x === b.x && a.y === b.y,
  },
  tostring: v => `${fmt(v.x)}, ${fmt(v.y)}`,
})
V2 = (x, y) => makeV2({ x, y })

// ============ CFrame ============
// r: [r00, r01, r02, r10, r11, r12, r20, r21, r22] (行優先)
export let CF
const IDR = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const mulR = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
]
const transR = r => [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]]
const mulRV = (r, x, y, z) => [r[0] * x + r[1] * y + r[2] * z, r[3] * x + r[4] * y + r[5] * z, r[6] * x + r[7] * y + r[8] * z]
const rotX = a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c] }
const rotY = a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c] }
const rotZ = a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1] }
function quatToR(qx, qy, qz, qw) {
  const n = Math.hypot(qx, qy, qz, qw) || 1
  qx /= n; qy /= n; qz /= n; qw /= n
  return [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw),
    2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw),
    2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy),
  ]
}
function rToQuat(r) {
  const tr = r[0] + r[4] + r[8]
  let qw, qx, qy, qz
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2
    qw = 0.25 * s; qx = (r[7] - r[5]) / s; qy = (r[2] - r[6]) / s; qz = (r[3] - r[1]) / s
  } else if (r[0] > r[4] && r[0] > r[8]) {
    const s = Math.sqrt(1 + r[0] - r[4] - r[8]) * 2
    qw = (r[7] - r[5]) / s; qx = 0.25 * s; qy = (r[1] + r[3]) / s; qz = (r[2] + r[6]) / s
  } else if (r[4] > r[8]) {
    const s = Math.sqrt(1 + r[4] - r[0] - r[8]) * 2
    qw = (r[2] - r[6]) / s; qx = (r[1] + r[3]) / s; qy = 0.25 * s; qz = (r[5] + r[7]) / s
  } else {
    const s = Math.sqrt(1 + r[8] - r[0] - r[4]) * 2
    qw = (r[3] - r[1]) / s; qx = (r[2] + r[6]) / s; qy = (r[5] + r[7]) / s; qz = 0.25 * s
  }
  return [qx, qy, qz, qw]
}
function axisAngleR(axis, ang) {
  const u = unit3(axis)
  const s = Math.sin(ang / 2)
  return quatToR(u.x * s, u.y * s, u.z * s, Math.cos(ang / 2))
}
function lookAtR(eye, target, up) {
  let fx = target.x - eye.x, fy = target.y - eye.y, fz = target.z - eye.z
  const fm = Math.hypot(fx, fy, fz)
  if (fm === 0) return IDR
  fx /= fm; fy /= fm; fz /= fm
  // right = forward × up
  let rx = fy * up.z - fz * up.y, ry = fz * up.x - fx * up.z, rz = fx * up.y - fy * up.x
  let rm = Math.hypot(rx, ry, rz)
  if (rm < 1e-6) { rx = 1; ry = 0; rz = 0; rm = 1 }
  rx /= rm; ry /= rm; rz /= rm
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx
  return [rx, ux, -fx, ry, uy, -fy, rz, uz, -fz]
}
function eulerXYZ(r) {
  // R = Rx(a) Ry(b) Rz(c)
  const b = Math.asin(Math.max(-1, Math.min(1, r[2])))
  const a = Math.atan2(-r[5], r[8])
  const c = Math.atan2(-r[1], r[0])
  return [a, b, c]
}
function eulerYXZ(r) {
  // R = Ry(b) Rx(a) Rz(c)
  const a = Math.asin(Math.max(-1, Math.min(1, -r[5])))
  const b = Math.atan2(r[2], r[8])
  const c = Math.atan2(r[3], r[4])
  return [a, b, c]
}
const cfMul = (a, b) => {
  const [x, y, z] = mulRV(a.r, b.x, b.y, b.z)
  return CF(a.x + x, a.y + y, a.z + z, mulR(a.r, b.r))
}
const cfInv = c => {
  const rt2 = transR(c.r)
  const [x, y, z] = mulRV(rt2, -c.x, -c.y, -c.z)
  return CF(x, y, z, rt2)
}
const makeCF = defineType('CFrame', {
  props: {
    Position: c => V3(c.x, c.y, c.z), p: c => V3(c.x, c.y, c.z),
    X: c => c.x, Y: c => c.y, Z: c => c.z, x: c => c.x, y: c => c.y, z: c => c.z,
    LookVector: c => V3(-c.r[2], -c.r[5], -c.r[8]), lookVector: c => V3(-c.r[2], -c.r[5], -c.r[8]),
    RightVector: c => V3(c.r[0], c.r[3], c.r[6]), rightVector: c => V3(c.r[0], c.r[3], c.r[6]),
    UpVector: c => V3(c.r[1], c.r[4], c.r[7]), upVector: c => V3(c.r[1], c.r[4], c.r[7]),
    XVector: c => V3(c.r[0], c.r[3], c.r[6]), YVector: c => V3(c.r[1], c.r[4], c.r[7]), ZVector: c => V3(c.r[2], c.r[5], c.r[8]),
    Rotation: c => CF(0, 0, 0, c.r),
  },
  methods: {
    Inverse: A => cfInv(A[0]), inverse: A => cfInv(A[0]),
    Lerp: A => {
      const [a, b] = A, t = num(A, 2, 'Lerp')
      const qa = rToQuat(a.r), qb = rToQuat(b.r)
      let d = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]
      if (d < 0) { qb.forEach((v, i) => { qb[i] = -v }); d = -d }
      let s0, s1
      if (d > 0.9995) { s0 = 1 - t; s1 = t } else {
        const th = Math.acos(d), sn = Math.sin(th)
        s0 = Math.sin((1 - t) * th) / sn; s1 = Math.sin(t * th) / sn
      }
      const q = qa.map((v, i) => v * s0 + qb[i] * s1)
      return CF(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, quatToR(...q))
    },
    ToWorldSpace: A => cfMul(A[0], A[1] || CF(0, 0, 0, IDR)),
    ToObjectSpace: A => cfMul(cfInv(A[0]), A[1] || CF(0, 0, 0, IDR)),
    toWorldSpace: A => cfMul(A[0], A[1]), toObjectSpace: A => cfMul(cfInv(A[0]), A[1]),
    PointToWorldSpace: A => { const c = A[0], v = A[1]; const [x, y, z] = mulRV(c.r, v.x, v.y, v.z); return V3(x + c.x, y + c.y, z + c.z) },
    PointToObjectSpace: A => { const c = cfInv(A[0]), v = A[1]; const [x, y, z] = mulRV(c.r, v.x, v.y, v.z); return V3(x + c.x, y + c.y, z + c.z) },
    VectorToWorldSpace: A => { const [x, y, z] = mulRV(A[0].r, A[1].x, A[1].y, A[1].z); return V3(x, y, z) },
    VectorToObjectSpace: A => { const [x, y, z] = mulRV(transR(A[0].r), A[1].x, A[1].y, A[1].z); return V3(x, y, z) },
    pointToWorldSpace: A => { const c = A[0], v = A[1]; const [x, y, z] = mulRV(c.r, v.x, v.y, v.z); return V3(x + c.x, y + c.y, z + c.z) },
    pointToObjectSpace: A => { const c = cfInv(A[0]), v = A[1]; const [x, y, z] = mulRV(c.r, v.x, v.y, v.z); return V3(x + c.x, y + c.y, z + c.z) },
    GetComponents: A => [A[0].x, A[0].y, A[0].z, ...A[0].r],
    components: A => [A[0].x, A[0].y, A[0].z, ...A[0].r],
    ToEulerAnglesXYZ: A => eulerXYZ(A[0].r),
    toEulerAnglesXYZ: A => eulerXYZ(A[0].r),
    ToEulerAnglesYXZ: A => eulerYXZ(A[0].r),
    toEulerAnglesYXZ: A => eulerYXZ(A[0].r),
    ToOrientation: A => eulerYXZ(A[0].r),
    ToAxisAngle: A => {
      const [qx, qy, qz, qw] = rToQuat(A[0].r)
      const ang = 2 * Math.acos(Math.max(-1, Math.min(1, qw)))
      const s = Math.sqrt(1 - qw * qw)
      return s < 1e-6 ? [V3(1, 0, 0), 0] : [V3(qx / s, qy / s, qz / s), ang]
    },
    Orthonormalize: A => CF(A[0].x, A[0].y, A[0].z, quatToR(...rToQuat(A[0].r))),
    FuzzyEq: A => { const [a, b] = A, e = A[2] ?? 1e-5; return Math.abs(a.x - b.x) <= e && Math.abs(a.y - b.y) <= e && Math.abs(a.z - b.z) <= e && a.r.every((v, i) => Math.abs(v - b.r[i]) <= e) },
  },
  meta: {
    __mul: (a, b) => {
      if (is(b, 'CFrame')) return cfMul(a, b)
      if (is(b, 'Vector3')) { const [x, y, z] = mulRV(a.r, b.x, b.y, b.z); return V3(x + a.x, y + a.y, z + a.z) }
      throw rtError('invalid argument #2 (CFrame or Vector3 expected)')
    },
    __add: (a, b) => { if (!is(b, 'Vector3')) throw rtError('invalid argument #2 (Vector3 expected)'); return CF(a.x + b.x, a.y + b.y, a.z + b.z, a.r) },
    __sub: (a, b) => { if (!is(b, 'Vector3')) throw rtError('invalid argument #2 (Vector3 expected)'); return CF(a.x - b.x, a.y - b.y, a.z - b.z, a.r) },
    __eq: (a, b) => a.x === b.x && a.y === b.y && a.z === b.z && a.r.every((v, i) => v === b.r[i]),
  },
  tostring: c => [c.x, c.y, c.z, ...c.r].map(fmt).join(', '),
})
CF = (x, y, z, r) => makeCF({ x, y, z, r: r || IDR })

// ============ Color3 ============
export let C3
const toHSV = c => {
  const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === c.r) h = ((c.g - c.b) / d) % 6
    else if (max === c.g) h = (c.b - c.r) / d + 2
    else h = (c.r - c.g) / d + 4
    h /= 6
    if (h < 0) h += 1
  }
  return [h, max === 0 ? 0 : d / max, max]
}
const hex2 = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')
const makeC3 = defineType('Color3', {
  props: { R: c => c.r, G: c => c.g, B: c => c.b, r: c => c.r, g: c => c.g, b: c => c.b },
  methods: {
    Lerp: A => { const [a, b] = A, t = num(A, 2, 'Lerp'); return C3(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t) },
    lerp: A => { const [a, b] = A, t = num(A, 2, 'lerp'); return C3(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t) },
    ToHSV: A => toHSV(A[0]),
    ToHex: A => hex2(A[0].r) + hex2(A[0].g) + hex2(A[0].b),
  },
  meta: { __eq: (a, b) => a.r === b.r && a.g === b.g && a.b === b.b },
  tostring: c => `${fmt(c.r)}, ${fmt(c.g)}, ${fmt(c.b)}`,
})
C3 = (r, g, b) => makeC3({ r, g, b })
function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s)
  switch (((i % 6) + 6) % 6) {
    case 0: return C3(v, t, p)
    case 1: return C3(q, v, p)
    case 2: return C3(p, v, t)
    case 3: return C3(p, q, v)
    case 4: return C3(t, p, v)
    default: return C3(v, p, q)
  }
}

// ============ UDim / UDim2 ============
export let UD, UD2
const makeUD = defineType('UDim', {
  props: { Scale: u => u.s, Offset: u => u.o },
  meta: {
    __add: (a, b) => UD(a.s + b.s, a.o + b.o),
    __sub: (a, b) => UD(a.s - b.s, a.o - b.o),
    __unm: a => UD(-a.s, -a.o),
    __eq: (a, b) => a.s === b.s && a.o === b.o,
  },
  tostring: u => `${fmt(u.s)}, ${fmt(u.o)}`,
})
UD = (s, o) => makeUD({ s, o })
const makeUD2 = defineType('UDim2', {
  props: { X: u => u.X, Y: u => u.Y, Width: u => u.X, Height: u => u.Y },
  methods: {
    Lerp: A => {
      const [a, b] = A, t = num(A, 2, 'Lerp')
      const l = (x, y) => x + (y - x) * t
      return UD2(l(a.X.s, b.X.s), l(a.X.o, b.X.o), l(a.Y.s, b.Y.s), l(a.Y.o, b.Y.o))
    },
  },
  meta: {
    __add: (a, b) => UD2(a.X.s + b.X.s, a.X.o + b.X.o, a.Y.s + b.Y.s, a.Y.o + b.Y.o),
    __sub: (a, b) => UD2(a.X.s - b.X.s, a.X.o - b.X.o, a.Y.s - b.Y.s, a.Y.o - b.Y.o),
    __unm: a => UD2(-a.X.s, -a.X.o, -a.Y.s, -a.Y.o),
    __eq: (a, b) => a.X.s === b.X.s && a.X.o === b.X.o && a.Y.s === b.Y.s && a.Y.o === b.Y.o,
  },
  tostring: u => `{${fmt(u.X.s)}, ${fmt(u.X.o)}}, {${fmt(u.Y.s)}, ${fmt(u.Y.o)}}`,
})
UD2 = (xs, xo, ys, yo) => makeUD2({ X: UD(xs, xo), Y: UD(ys, yo) })

// ============ Enum ============
export function makeEnums(enumData) {
  const enumTypes = new Map()
  const itemProto = {
    luaTypeName: 'EnumItem',
    meta: { __tostring: e => `Enum.${e.enumType.name}.${e.name}` },
    luaIndex(k) {
      switch (k) {
        case 'Name': return this.name
        case 'Value': return this.value
        case 'EnumType': return this.enumType
        case 'IsA': return enumItemIsA
      }
      throw rtError(`${fromBytes(String(k))} is not a valid member of "Enum.${this.enumType.name}.${this.name}"`)
    },
    luaNewIndex() { throw rtError('EnumItem properties are read-only') },
    luaToString() { return `Enum.${this.enumType.name}.${this.name}` },
  }
  const enumItemIsA = native('IsA', A => A[0].enumType.name === A[1])
  const getItems = native('GetEnumItems', A => LTable.fromArray([...A[0].items.values()].sort((a, b) => a.value - b.value)))
  const fromName = native('FromName', A => A[0].items.get(A[1]))
  const fromValue = native('FromValue', A => [...A[0].items.values()].find(i => i.value === A[1]))
  const typeProto = {
    luaTypeName: 'Enum',
    meta: { __tostring: e => e.name },
    luaIndex(k) {
      const it = this.items.get(k)
      if (it) return it
      if (k === 'GetEnumItems') return getItems
      if (k === 'FromName') return fromName
      if (k === 'FromValue') return fromValue
      throw rtError(`${fromBytes(String(k))} is not a valid member of "Enum.${this.name}"`)
    },
    luaNewIndex() { throw rtError('Enum is read-only') },
    luaToString() { return this.name },
    luaIterate() { return null },
  }
  for (const [name, items] of Object.entries(enumData)) {
    const et = Object.create(typeProto)
    et.name = name
    et.items = new Map()
    for (const [iname, value] of items) {
      const it = Object.create(itemProto)
      it.name = iname; it.value = value; it.enumType = et
      et.items.set(iname, it)
    }
    enumTypes.set(name, et)
  }
  const getEnums = native('GetEnums', () => LTable.fromArray([...enumTypes.values()]))
  const EnumRoot = {
    luaTypeName: 'Enums',
    luaIndex(k) {
      const e = enumTypes.get(k)
      if (e) return e
      if (k === 'GetEnums') return getEnums
      throw rtError(`${fromBytes(String(k))} is not a valid member of "Enums"`)
    },
    luaNewIndex() { throw rtError('Enums is read-only') },
    luaToString() { return 'Enums' },
    meta: {},
  }
  const item = (type, name) => {
    const e = enumTypes.get(type)
    return e && (e.items.get(name) || e.items.values().next().value)
  }
  const firstItem = type => {
    const e = enumTypes.get(type)
    if (!e) return undefined
    let best
    for (const it of e.items.values()) if (!best || it.value < best.value) best = it
    return best
  }
  return { EnumRoot, enumTypes, item, firstItem }
}

// ============ BrickColor ============
const BRICK = [
  [1, 'White', 242, 243, 243], [194, 'Medium stone grey', 163, 162, 165], [199, 'Dark stone grey', 99, 95, 98], [26, 'Black', 27, 42, 53],
  [21, 'Bright red', 196, 40, 28], [23, 'Bright blue', 13, 105, 172], [24, 'Bright yellow', 245, 205, 48], [28, 'Dark green', 40, 127, 71],
  [37, 'Bright green', 75, 151, 75], [106, 'Bright orange', 218, 133, 65], [104, 'Bright violet', 107, 50, 124], [1004, 'Really red', 255, 0, 0],
  [1010, 'Really blue', 0, 0, 255], [1003, 'Really black', 17, 17, 17], [1001, 'Institutional white', 248, 248, 248], [1009, 'New Yeller', 255, 255, 0],
  [1020, 'Lime green', 0, 255, 0], [1019, 'Toothpaste', 0, 255, 255], [1032, 'Hot pink', 255, 0, 191], [1015, 'Magenta', 170, 0, 170],
  [1005, 'Deep orange', 255, 176, 0], [192, 'Reddish brown', 105, 64, 40], [217, 'Brown', 124, 92, 70], [5, 'Brick yellow', 215, 197, 154],
  [18, 'Nougat', 204, 142, 105], [125, 'Light orange', 234, 184, 146], [102, 'Medium blue', 110, 153, 202], [45, 'Light blue', 180, 210, 228],
  [119, 'Br. yellowish green', 164, 189, 71], [141, 'Earth green', 39, 70, 45], [1002, 'Mid gray', 205, 205, 205], [208, 'Light stone grey', 229, 228, 223],
]
export let BC
const makeBC = defineType('BrickColor', {
  props: {
    Name: b => b.name, Number: b => b.number, Color: b => C3(b.r / 255, b.g / 255, b.b / 255),
    r: b => b.r / 255, g: b => b.g / 255, b: b => b.b / 255,
  },
  meta: { __eq: (a, b) => a.number === b.number },
  tostring: b => b.name,
})
const bcFrom = e => makeBC({ number: e[0], name: e[1], r: e[2], g: e[3], b: e[4] })
BC = v => {
  if (typeof v === 'number') return bcFrom(BRICK.find(e => e[0] === v) || BRICK[1])
  if (typeof v === 'string') return bcFrom(BRICK.find(e => e[1] === fromBytes(v)) || BRICK[1])
  return bcFrom(BRICK[1])
}
function nearestBrick(r, g, b) {
  let best = BRICK[1], bd = Infinity
  for (const e of BRICK) {
    const d = (e[2] - r) ** 2 + (e[3] - g) ** 2 + (e[4] - b) ** 2
    if (d < bd) { bd = d; best = e }
  }
  return bcFrom(best)
}

// ============ その他の型 ============
const simple = (name, fieldNames, toStr) => defineType(name, {
  props: Object.fromEntries(fieldNames.map(f => [f, o => o[f]])),
  tostring: toStr || (o => fieldNames.map(f => fromBytes(String(typeof o[f] === 'number' ? fmt(o[f]) : o[f] && o[f].luaToString ? o[f].luaToString() : o[f]))).join(', ')),
})
const makeTweenInfo = simple('TweenInfo', ['Time', 'EasingStyle', 'EasingDirection', 'RepeatCount', 'Reverses', 'DelayTime'],
  o => `Time:${fmt(o.Time)} DelayTime:${fmt(o.DelayTime)} RepeatCount:${fmt(o.RepeatCount)} Reverses:${o.Reverses} EasingDirection:${o.EasingDirection.name} EasingStyle:${o.EasingStyle.name}`)
const makeNR = simple('NumberRange', ['Min', 'Max'], o => `${fmt(o.Min)} ${fmt(o.Max)} `)
const makeNSK = simple('NumberSequenceKeypoint', ['Time', 'Value', 'Envelope'], o => `${fmt(o.Time)} ${fmt(o.Value)} ${fmt(o.Envelope)} `)
const makeCSK = simple('ColorSequenceKeypoint', ['Time', 'Value'], o => `${fmt(o.Time)} ${o.Value.luaToString()} `)
const makeNS = simple('NumberSequence', ['Keypoints'], o => [...o.kps].map(k => k.luaToString()).join(''))
const makeCS = simple('ColorSequence', ['Keypoints'], o => [...o.kps].map(k => k.luaToString()).join(''))
const makeRect = simple('Rect', ['Min', 'Max', 'Width', 'Height'], o => `${o.Min.luaToString()}, ${o.Max.luaToString()}`)
const makeRay = defineType('Ray', {
  props: { Origin: r => r.o, Direction: r => r.d, Unit: r => makeRay({ o: r.o, d: unit3(r.d) }) },
  methods: {
    ClosestPoint: A => {
      const r = A[0], p = A[1], d = unit3(r.d)
      const t = Math.max(0, dot3(V3(p.x - r.o.x, p.y - r.o.y, p.z - r.o.z), d))
      return V3(r.o.x + d.x * t, r.o.y + d.y * t, r.o.z + d.z * t)
    },
    Distance: A => {
      const r = A[0], p = A[1], d = unit3(r.d)
      const t = Math.max(0, dot3(V3(p.x - r.o.x, p.y - r.o.y, p.z - r.o.z), d))
      return mag3(V3(p.x - r.o.x - d.x * t, p.y - r.o.y - d.y * t, p.z - r.o.z - d.z * t))
    },
  },
  tostring: r => `{${r.o.luaToString()}}, {${r.d.luaToString()}}`,
})
const makeRegion3 = simple('Region3', ['CFrame', 'Size'])
const makeV3i16 = simple('Vector3int16', ['X', 'Y', 'Z'])
const makeV2i16 = simple('Vector2int16', ['X', 'Y'])
const makePhys = simple('PhysicalProperties', ['Density', 'Friction', 'Elasticity', 'FrictionWeight', 'ElasticityWeight'])
const makeFont = simple('Font', ['Family', 'Weight', 'Style', 'Bold'], o => `Font { Family = ${fromBytes(o.Family)}, Weight = ${o.Weight.name}, Style = ${o.Style.name} }`)
const makeDateTime = defineType('DateTime', {
  props: { UnixTimestamp: d => Math.floor(d.ms / 1000), UnixTimestampMillis: d => d.ms },
  methods: {
    ToIsoDate: A => new Date(A[0].ms).toISOString().replace(/\.\d+Z$/, 'Z'),
    ToUniversalTime: A => { const d = new Date(A[0].ms); return LTable.fromObject({ Year: d.getUTCFullYear(), Month: d.getUTCMonth() + 1, Day: d.getUTCDate(), Hour: d.getUTCHours(), Minute: d.getUTCMinutes(), Second: d.getUTCSeconds(), Millisecond: d.getUTCMilliseconds() }) },
    ToLocalTime: A => { const d = new Date(A[0].ms); return LTable.fromObject({ Year: d.getFullYear(), Month: d.getMonth() + 1, Day: d.getDate(), Hour: d.getHours(), Minute: d.getMinutes(), Second: d.getSeconds(), Millisecond: d.getMilliseconds() }) },
    FormatUniversalTime: A => toBytes(new Date(A[0].ms).toLocaleString(fromBytes(A[2] || 'ja-JP'), { timeZone: 'UTC' })),
    FormatLocalTime: A => toBytes(new Date(A[0].ms).toLocaleString(fromBytes(A[2] || 'ja-JP'))),
  },
  tostring: d => new Date(d.ms).toISOString(),
})

// 可変オブジェクト (RaycastParams など): 任意のプロパティを代入可
function mutableType(name, defaults, methods = {}) {
  const m = {}
  for (const [k, f] of Object.entries(methods)) m[k] = native(k, f)
  return () => {
    const fields = new Map(Object.entries(defaults()))
    return {
      luaTypeName: name, meta: {}, fields,
      luaIndex(k) {
        if (fields.has(k)) return fields.get(k)
        if (m[k]) return m[k]
        throw rtError(`${fromBytes(String(k))} is not a valid member of ${name}`)
      },
      luaNewIndex(k, v) {
        if (!fields.has(k)) throw rtError(`${fromBytes(String(k))} is not a valid member of ${name}`)
        fields.set(k, v)
      },
      luaToString() { return name },
    }
  }
}

// ============ グローバルへの登録 ============
export function installDatatypes(G, enums) {
  const lib = (name, fns, consts = {}) => {
    const t = new LTable()
    for (const [k, f] of Object.entries(fns)) t.set(k, native(name + '.' + k, f))
    for (const [k, v] of Object.entries(consts)) t.set(k, v)
    t.readonly = true
    G.set(name, t)
    return t
  }
  lib('Vector3', {
    new: A => V3(num(A, 0, 'new', 0), num(A, 1, 'new', 0), num(A, 2, 'new', 0)),
    FromNormalId: A => { const n = A[0] && A[0].name; return ({ Right: V3(1, 0, 0), Left: V3(-1, 0, 0), Top: V3(0, 1, 0), Bottom: V3(0, -1, 0), Back: V3(0, 0, 1), Front: V3(0, 0, -1) })[n] || V3(0, 0, 0) },
    FromAxis: A => { const n = A[0] && A[0].name; return ({ X: V3(1, 0, 0), Y: V3(0, 1, 0), Z: V3(0, 0, 1) })[n] || V3(0, 0, 0) },
  }, { zero: V3(0, 0, 0), one: V3(1, 1, 1), xAxis: V3(1, 0, 0), yAxis: V3(0, 1, 0), zAxis: V3(0, 0, 1) })
  lib('Vector2', { new: A => V2(num(A, 0, 'new', 0), num(A, 1, 'new', 0)) }, { zero: V2(0, 0), one: V2(1, 1), xAxis: V2(1, 0), yAxis: V2(0, 1) })
  lib('Vector3int16', { new: A => makeV3i16({ X: Math.trunc(A[0] || 0), Y: Math.trunc(A[1] || 0), Z: Math.trunc(A[2] || 0) }) })
  lib('Vector2int16', { new: A => makeV2i16({ X: Math.trunc(A[0] || 0), Y: Math.trunc(A[1] || 0) }) })
  lib('CFrame', {
    new: A => {
      const n = A.length
      if (n === 0) return CF(0, 0, 0)
      if (is(A[0], 'Vector3')) {
        if (is(A[1], 'Vector3')) return CF(A[0].x, A[0].y, A[0].z, lookAtR(A[0], A[1], V3(0, 1, 0)))
        return CF(A[0].x, A[0].y, A[0].z)
      }
      if (n === 3) return CF(num(A, 0, 'new'), num(A, 1, 'new'), num(A, 2, 'new'))
      if (n === 7) return CF(A[0], A[1], A[2], quatToR(A[3], A[4], A[5], A[6]))
      if (n === 12) return CF(A[0], A[1], A[2], A.slice(3, 12).map(Number))
      throw rtError('Invalid number of arguments: ' + n)
    },
    lookAt: A => CF(A[0].x, A[0].y, A[0].z, lookAtR(A[0], A[1], A[2] || V3(0, 1, 0))),
    lookAlong: A => CF(A[0].x, A[0].y, A[0].z, lookAtR(A[0], V3(A[0].x + A[1].x, A[0].y + A[1].y, A[0].z + A[1].z), A[2] || V3(0, 1, 0))),
    Angles: A => CF(0, 0, 0, mulR(mulR(rotX(A[0] || 0), rotY(A[1] || 0)), rotZ(A[2] || 0))),
    fromEulerAnglesXYZ: A => CF(0, 0, 0, mulR(mulR(rotX(A[0] || 0), rotY(A[1] || 0)), rotZ(A[2] || 0))),
    fromEulerAnglesYXZ: A => CF(0, 0, 0, mulR(mulR(rotY(A[1] || 0), rotX(A[0] || 0)), rotZ(A[2] || 0))),
    fromOrientation: A => CF(0, 0, 0, mulR(mulR(rotY(A[1] || 0), rotX(A[0] || 0)), rotZ(A[2] || 0))),
    fromEulerAngles: A => CF(0, 0, 0, mulR(mulR(rotX(A[0] || 0), rotY(A[1] || 0)), rotZ(A[2] || 0))),
    fromAxisAngle: A => CF(0, 0, 0, axisAngleR(A[0], A[1])),
    fromMatrix: A => {
      const p = A[0], x = A[1], y = A[2]
      const z = A[3] || cross3(x, y)
      return CF(p.x, p.y, p.z, [x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z])
    },
  }, { identity: CF(0, 0, 0) })
  lib('Color3', {
    new: A => C3(num(A, 0, 'new', 0), num(A, 1, 'new', 0), num(A, 2, 'new', 0)),
    fromRGB: A => C3(num(A, 0, 'fromRGB', 0) / 255, num(A, 1, 'fromRGB', 0) / 255, num(A, 2, 'fromRGB', 0) / 255),
    fromHSV: A => hsv(num(A, 0, 'fromHSV'), num(A, 1, 'fromHSV'), num(A, 2, 'fromHSV')),
    toHSV: A => toHSV(A[0]),
    fromHex: A => {
      const h = fromBytes(A[0] || '').replace('#', '')
      const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
      if (!/^[0-9a-f]{6}$/i.test(full)) throw rtError('Unable to convert characters to hex value')
      return C3(parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255)
    },
  })
  lib('UDim', { new: A => UD(num(A, 0, 'new', 0), num(A, 1, 'new', 0)) })
  lib('UDim2', {
    new: A => is(A[0], 'UDim') ? UD2(A[0].s, A[0].o, A[1].s, A[1].o) : UD2(num(A, 0, 'new', 0), num(A, 1, 'new', 0), num(A, 2, 'new', 0), num(A, 3, 'new', 0)),
    fromScale: A => UD2(num(A, 0, 'fromScale', 0), 0, num(A, 1, 'fromScale', 0), 0),
    fromOffset: A => UD2(0, num(A, 0, 'fromOffset', 0), 0, num(A, 1, 'fromOffset', 0)),
  })
  lib('TweenInfo', {
    new: A => makeTweenInfo({
      Time: A[0] ?? 1, EasingStyle: A[1] || enums.item('EasingStyle', 'Quad'), EasingDirection: A[2] || enums.item('EasingDirection', 'Out'),
      RepeatCount: A[3] ?? 0, Reverses: A[4] ?? false, DelayTime: A[5] ?? 0,
    }),
  })
  lib('NumberRange', { new: A => makeNR({ Min: num(A, 0, 'new'), Max: A[1] ?? A[0] }) })
  lib('NumberSequenceKeypoint', { new: A => makeNSK({ Time: A[0] ?? 0, Value: A[1] ?? 0, Envelope: A[2] ?? 0 }) })
  lib('ColorSequenceKeypoint', { new: A => makeCSK({ Time: A[0] ?? 0, Value: A[1] || C3(1, 1, 1) }) })
  lib('NumberSequence', {
    new: A => {
      let kps
      if (A[0] instanceof LTable) kps = A[0].arr.slice(1)
      else if (A.length >= 2) kps = [makeNSK({ Time: 0, Value: A[0], Envelope: 0 }), makeNSK({ Time: 1, Value: A[1], Envelope: 0 })]
      else kps = [makeNSK({ Time: 0, Value: A[0] ?? 0, Envelope: 0 }), makeNSK({ Time: 1, Value: A[0] ?? 0, Envelope: 0 })]
      const o = makeNS({ kps })
      o.Keypoints = LTable.fromArray(kps)
      return o
    },
  })
  lib('ColorSequence', {
    new: A => {
      let kps
      if (A[0] instanceof LTable) kps = A[0].arr.slice(1)
      else kps = [makeCSK({ Time: 0, Value: A[0] || C3(1, 1, 1) }), makeCSK({ Time: 1, Value: A[1] || A[0] || C3(1, 1, 1) })]
      const o = makeCS({ kps })
      o.Keypoints = LTable.fromArray(kps)
      return o
    },
  })
  lib('Rect', {
    new: A => {
      const [a, b, c, d] = is(A[0], 'Vector2') ? [A[0].x, A[0].y, A[1].x, A[1].y] : [A[0] || 0, A[1] || 0, A[2] || 0, A[3] || 0]
      return makeRect({ Min: V2(a, b), Max: V2(c, d), Width: c - a, Height: d - b })
    },
  })
  lib('Ray', { new: A => makeRay({ o: A[0] || V3(0, 0, 0), d: A[1] || V3(0, 0, 0) }) })
  lib('Region3', {
    new: A => {
      const a = A[0] || V3(0, 0, 0), b = A[1] || V3(0, 0, 0)
      return makeRegion3({ CFrame: CF((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), Size: V3(Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z)) })
    },
  })
  lib('BrickColor', {
    new: A => {
      if (typeof A[0] === 'number' && A.length >= 3) return nearestBrick(A[0] * 255, A[1] * 255, A[2] * 255)
      if (is(A[0], 'Color3')) return nearestBrick(A[0].r * 255, A[0].g * 255, A[0].b * 255)
      return BC(A[0])
    },
    random: () => bcFrom(BRICK[Math.floor(Math.random() * BRICK.length)]),
    palette: A => bcFrom(BRICK[(A[0] || 0) % BRICK.length]),
    White: () => BC('White'), Gray: () => BC('Medium stone grey'), DarkGray: () => BC('Dark stone grey'), Black: () => BC('Black'),
    Red: () => BC('Bright red'), Yellow: () => BC('Bright yellow'), Green: () => BC('Dark green'), Blue: () => BC('Bright blue'),
  })
  lib('PhysicalProperties', {
    new: A => typeof A[0] === 'number'
      ? makePhys({ Density: A[0], Friction: A[1] ?? 0.3, Elasticity: A[2] ?? 0.5, FrictionWeight: A[3] ?? 1, ElasticityWeight: A[4] ?? 1 })
      : makePhys({ Density: 0.7, Friction: 0.3, Elasticity: 0.5, FrictionWeight: 1, ElasticityWeight: 1 }),
  })
  lib('Font', {
    new: A => makeFont({ Family: A[0] || 'rbxasset://fonts/families/SourceSansPro.json', Weight: A[1] || enums.item('FontWeight', 'Regular'), Style: A[2] || enums.item('FontStyle', 'Normal'), Bold: false }),
    fromEnum: A => makeFont({ Family: toBytes(`rbxasset://fonts/families/${A[0] ? A[0].name : 'SourceSansPro'}.json`), Weight: enums.item('FontWeight', 'Regular'), Style: enums.item('FontStyle', 'Normal'), Bold: false }),
    fromName: A => makeFont({ Family: toBytes(`rbxasset://fonts/families/${fromBytes(A[0] || '')}.json`), Weight: A[1] || enums.item('FontWeight', 'Regular'), Style: A[2] || enums.item('FontStyle', 'Normal'), Bold: false }),
    fromId: A => makeFont({ Family: toBytes(`rbxassetid://${A[0]}`), Weight: A[1] || enums.item('FontWeight', 'Regular'), Style: A[2] || enums.item('FontStyle', 'Normal'), Bold: false }),
  })
  lib('DateTime', {
    now: () => makeDateTime({ ms: Date.now() }),
    fromUnixTimestamp: A => makeDateTime({ ms: (A[0] || 0) * 1000 }),
    fromUnixTimestampMillis: A => makeDateTime({ ms: A[0] || 0 }),
    fromIsoDate: A => { const t = Date.parse(fromBytes(A[0] || '')); return isNaN(t) ? undefined : makeDateTime({ ms: t }) },
    fromUniversalTime: A => makeDateTime({ ms: Date.UTC(A[0] ?? 1970, (A[1] ?? 1) - 1, A[2] ?? 1, A[3] ?? 0, A[4] ?? 0, A[5] ?? 0, A[6] ?? 0) }),
    fromLocalTime: A => makeDateTime({ ms: new Date(A[0] ?? 1970, (A[1] ?? 1) - 1, A[2] ?? 1, A[3] ?? 0, A[4] ?? 0, A[5] ?? 0, A[6] ?? 0).getTime() }),
  })
  const makeRandom = seed => {
    let s = (seed === undefined ? Math.floor(Math.random() * 2 ** 31) : Math.floor(seed)) >>> 0 || 1
    const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
    const r = {
      luaTypeName: 'Random', meta: {},
      luaIndex(k) {
        const m = randomMethods[k]
        if (m) return m
        throw rtError(`${fromBytes(String(k))} is not a valid member of Random`)
      },
      luaNewIndex() { throw rtError('Random cannot be assigned to') },
      luaToString() { return 'Random' },
      next,
    }
    return r
  }
  const randomMethods = {
    NextInteger: native('NextInteger', A => { const lo = Math.ceil(num(A, 1, 'NextInteger')), hi = Math.floor(num(A, 2, 'NextInteger')); if (lo > hi) throw rtError('invalid argument #2 to \'NextInteger\' (interval is empty)'); return lo + Math.floor(A[0].next() * (hi - lo + 1)) }),
    NextNumber: native('NextNumber', A => { const lo = A[1] ?? 0, hi = A[2] ?? 1; return lo + A[0].next() * (hi - lo) }),
    NextUnitVector: native('NextUnitVector', A => { const z = A[0].next() * 2 - 1, t = A[0].next() * 2 * Math.PI, r = Math.sqrt(1 - z * z); return V3(r * Math.cos(t), r * Math.sin(t), z) }),
    Shuffle: native('Shuffle', A => { const t = A[1]; const n = t.length(); for (let i = n; i > 1; i--) { const j = 1 + Math.floor(A[0].next() * i); const tmp = t.get(i); t.set(i, t.get(j)); t.set(j, tmp) } }),
    Clone: native('Clone', A => makeRandom(A[0].next() * 2 ** 31)),
  }
  lib('Random', { new: A => makeRandom(A[0]) })
  const makeRaycastParams = mutableType('RaycastParams', () => ({
    FilterDescendantsInstances: new LTable(), FilterType: enums.item('RaycastFilterType', 'Exclude'), IgnoreWater: false, CollisionGroup: 'Default', RespectCanCollide: false, BruteForceAllSlow: false,
  }), { AddToFilter: () => {} })
  lib('RaycastParams', { new: () => makeRaycastParams() })
  const makeOverlapParams = mutableType('OverlapParams', () => ({
    FilterDescendantsInstances: new LTable(), FilterType: enums.item('RaycastFilterType', 'Exclude'), MaxParts: 0, CollisionGroup: 'Default', RespectCanCollide: false, BruteForceAllSlow: false,
  }), { AddToFilter: () => {} })
  lib('OverlapParams', { new: () => makeOverlapParams() })
  const makePathWaypoint = simple('PathWaypoint', ['Position', 'Action', 'Label'])
  lib('PathWaypoint', { new: A => makePathWaypoint({ Position: A[0] || V3(0, 0, 0), Action: A[1] || enums.item('PathWaypointAction', 'Walk'), Label: A[2] || '' }) })
  const makeAxes = simple('Axes', ['X', 'Y', 'Z'])
  lib('Axes', { new: () => makeAxes({ X: true, Y: true, Z: true }) })
  const makeFaces = simple('Faces', ['Top', 'Bottom', 'Left', 'Right', 'Back', 'Front'])
  lib('Faces', { new: () => makeFaces({ Top: true, Bottom: true, Left: true, Right: true, Back: true, Front: true }) })
  const makeCatalog = mutableType('CatalogSearchParams', () => ({ SearchKeyword: '', MinPrice: 0, MaxPrice: 2147483647, Limit: 30 }))
  lib('CatalogSearchParams', { new: () => makeCatalog() })
  G.set('Enum', enums.EnumRoot)
  void callSync; void LFunc; void T; void rt
}

export { is, num, unit3, mag3, dot3, cross3, toHSV, hsv, eulerYXZ, nearestBrick, makeTweenInfo, lookAtR, IDR }
