// CINDER's landforms: where the desert has mesas, buttes and hoodoos, the volcanic world has basalt
// column massifs (hexagonal columns stepping down to their edges), cinder cones with glowing craters,
// and leaning basalt stacks. Same slots, placement and collision (a radial profile: radius multiplier
// at angle th and height fraction t) as src/world.ts and src/ice.ts.
//
// The `aCrev` attribute is the glow: 1 where the rock is molten (a crater's throat, a column's split).
import * as THREE from 'three'

export type LavaKind = 'mesa' | 'butte' | 'spire'
type Profile = (th: number, t: number) => number

export const LAVA_VARIANTS: Record<LavaKind, number> = { mesa: 3, butte: 3, spire: 3 }

const FOOT = -0.08
function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
const sm = (a: number, b: number, x: number) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u) }

/** Append one hexagonal column (base at FOOT, flat top at y) to the position / glow arrays. */
function column(pos: number[], glow: number[], cx: number, cz: number, r: number, y: number, rot: number, g: number, lx = 0, lz = 0): void {
  const P = (k: number, yy: number): [number, number, number] => {
    const a = rot + (k / 6) * Math.PI * 2
    return [cx + Math.cos(a) * r + lx * yy, yy, cz + Math.sin(a) * r + lz * yy]
  }
  const top: [number, number, number] = [cx + lx * y, y, cz + lz * y]
  for (let k = 0; k < 6; k++) {
    const a0 = P(k, FOOT), a1 = P(k + 1, FOOT), b0 = P(k, y), b1 = P(k + 1, y)
    // Side (two triangles, outward), then the top's slice.
    pos.push(...a0, ...b1, ...a1, ...a0, ...b0, ...b1)
    pos.push(...top, ...b1, ...b0)
    // The glow lives at the foot of the side faces (a split at the base), none on top.
    glow.push(g, 0, g, g, 0, 0, 0, 0, 0)
  }
}

function finish(pos: number[], glow: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aCrev', new THREE.Float32BufferAttribute(glow, 1))
  g.computeVertexNormals()
  // Face outward: tops face up, so the normals' summed y is positive (a safety: built that way).
  const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute
  let dot = 0
  for (let i = 0; i < p.count; i++) dot += n.getY(i)
  if (dot < 0) {
    const a = p.array as Float32Array
    for (let t = 0; t < p.count; t += 3) for (let k = 0; k < 3; k++) { const v = a[(t + 1) * 3 + k]; a[(t + 1) * 3 + k] = a[(t + 2) * 3 + k]; a[(t + 2) * 3 + k] = v }
    const gl = (g.attributes.aCrev as THREE.BufferAttribute).array as Float32Array
    for (let t = 0; t < p.count; t += 3) { const v = gl[t + 1]; gl[t + 1] = gl[t + 2]; gl[t + 2] = v }
    g.computeVertexNormals()
  }
  return g
}

/** Basalt massifs: columns on a hex grid inside a lobed outline, stepping down toward the edge. */
export function massif(seed: number, v: number) {
  const r = rng(seed)
  const harm: [number, number][] = []
  for (let i = 2; i <= 5; i++) harm.push([(0.14 / i) * (0.4 + r()), r() * 6.28])
  const elong = [0.1, 0.32, 0.05][v], eph = r() * 6.28
  const edge = (th: number) => {
    let k = 1 + elong * Math.cos(2 * th + eph)
    for (let i = 0; i < harm.length; i++) k += harm[i][0] * Math.sin((i + 2) * th + harm[i][1])
    return k
  }
  // Height of the column field at polar (rho fraction of the edge, th): a plateau stepping down in
  // tiers at its rim (v1: a ridge; v2: a broken causeway of low steps).
  const tiers = [3, 4, 6][v]
  const H = (rho: number, th: number) => {
    const fall = v === 2 ? Math.pow(1 - rho, 0.7) : 1 - sm(0.55, 1.0, rho) * 0.85
    const q = Math.ceil(fall * tiers) / tiers
    return Math.max(0.08, q * (v === 1 ? 0.75 + 0.25 * Math.cos(th - eph) : 1))
  }
  const pos: number[] = [], glow: number[] = []
  const cr = 0.14 // column radius (unit) (bigger, fewer: small ones read as voxel dice)
  const dx = cr * Math.sqrt(3), dz = cr * 1.5
  const rot = r() * 0.4
  for (let iz = -14; iz <= 14; iz++) for (let ix = -16; ix <= 16; ix++) {
    const x = ix * dx + (iz & 1 ? dx / 2 : 0), z = iz * dz
    const th = Math.atan2(z, x), e = edge(th) * (1 + elong)
    const rho = Math.hypot(x, z) / e
    if (rho > 1) continue
    // Ragged tops (each column its own height, some snapped short): even tops read as a skyline.
    const y = H(rho, th) * (0.62 + 0.5 * r()) * (r() < 0.12 ? 0.55 : 1)
    column(pos, glow, x, z, cr * 0.97, y, rot, rho > 0.85 && r() < 0.12 ? 1 : 0)
  }
  const prof: Profile = (th, t) => {
    // Along the ray, the farthest rho whose height clears t.
    const e = edge(th) * (1 + elong)
    for (let rho = 1; rho > 0; rho -= 0.04) if (H(rho, th) >= t) return rho * e + cr
    return 0
  }
  return { geo: finish(pos, glow), prof }
}

/** Cinder cones: a lathe of the cone and its crater (v1 breached on one side, v2 twin-peaked). */
function cone(seed: number, v: number) {
  const r = rng(seed)
  const rim = 0.26 + r() * 0.06, pit = rim * 0.55
  const breach = r() * 6.28
  const profR = (t: number) => (1 - t) * (1 - rim) + rim // outer slope radius at height t
  const rows: [number, number, number][] = [] // radius fraction, y, glow
  for (let i = 0; i <= 10; i++) { const t = i / 10; rows.push([profR(t) * (1 + 0.25 * Math.pow(1 - t, 3)), FOOT + (1 - FOOT) * t, 0]) }
  rows.push([pit * 1.2, 0.86, 0.6], [pit * 0.7, 0.72, 1], [0, 0.7, 1])
  const seg = 28
  const pos: number[] = [], glow: number[] = []
  const at = (row: number, j: number): [number, number, number] => {
    const th = (j / seg) * Math.PI * 2
    let [rr, y] = rows[row]
    if (row >= 8 && row <= 10) {
      if (v === 1) y -= 0.35 * Math.pow(Math.max(0, Math.cos(th - breach)), 6) * ((row - 7) / 3) // the breach
      if (v === 2) y += 0.12 * Math.cos(2 * (th - breach)) * ((row - 7) / 3)
    }
    rr *= 1 + 0.05 * Math.sin(5 * th + seed) + 0.03 * Math.sin(11 * th + seed * 2)
    return [Math.cos(th) * rr, y, Math.sin(th) * rr]
  }
  for (let row = 0; row < rows.length - 1; row++) for (let j = 0; j < seg; j++) {
    const a = at(row, j), b = at(row, j + 1), c = at(row + 1, j), d = at(row + 1, j + 1)
    pos.push(...a, ...c, ...b, ...b, ...c, ...d)
    const g0 = rows[row][2], g1 = rows[row + 1][2]
    glow.push(g0, g1, g0, g0, g1, g1)
  }
  const prof: Profile = (_th, t) => profR(Math.min(1, t)) * (1 + 0.25 * Math.pow(1 - t, 3))
  return { geo: finish(pos, glow), prof }
}

interface Stack { cx: number; cz: number; r: number; h: number; lx: number; lz: number }

/** Basalt stacks: 1-5 tall hexagonal columns, leaning, glowing where they split from the ground. */
function stacks(seed: number, v: number) {
  const r = rng(seed)
  const list: Stack[] = [{ cx: 0, cz: 0, r: 0.75, h: 1, lx: (r() - 0.5) * 0.12, lz: (r() - 0.5) * 0.12 }]
  const n = [0, 2, 4][v]
  for (let i = 0; i < n; i++) {
    const a = r() * 6.28, d = 0.9 + r() * 0.6
    list.push({ cx: Math.cos(a) * d, cz: Math.sin(a) * d, r: 0.45 + r() * 0.3, h: 0.35 + r() * 0.5, lx: Math.cos(a) * 0.15 * r(), lz: Math.sin(a) * 0.15 * r() })
  }
  const pos: number[] = [], glow: number[] = []
  for (const s of list) column(pos, glow, s.cx, s.cz, s.r, s.h, r() * 1.05, 1, s.lx, s.lz)
  const prof: Profile = (th, t) => {
    const ct = Math.cos(th), st = Math.sin(th)
    let far = 0
    for (const s of list) {
      if (t >= s.h) continue
      const x = s.cx + s.lx * t, z = s.cz + s.lz * t
      const p = x * ct + z * st, q = -x * st + z * ct
      if (Math.abs(q) >= s.r) continue
      far = Math.max(far, p + Math.sqrt(s.r * s.r - q * q))
    }
    return far
  }
  return { geo: finish(pos, glow), prof }
}

export function lavaGeometry(kind: LavaKind, seed: number, v: number): { geo: THREE.BufferGeometry; prof: Profile } {
  // (The column massifs read as a city skyline from the course: the big slot is broad volcanoes too.)
  if (kind === 'mesa') return cone(seed + 17, v)
  if (kind === 'butte') return cone(seed, v)
  return stacks(seed, v)
}
