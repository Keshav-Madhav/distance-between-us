// Smooth ship surfaces: lofts. A loft sweeps a superellipse cross-section along a path of keyframed
// sections (centre, two half-sizes, squareness), eased between keys, into one smooth indexed surface.
// A fuselage lofts along z with sections in the x/y plane; a wing lofts along x with sections in the
// z/y plane; a fin lofts up y with sections in the z/x plane. Patches (a range of the section angle)
// let one surface be split between materials: paint on top, carbon underneath, a stripe down the
// spine — the livery is part of the shape, not boxes stuck on.
import * as THREE from 'three'

export interface Key {
  /** Position along the path (any monotone unit). */
  s: number
  /** Section centre. */
  c: [number, number, number]
  /** Half-size along axis A (width / half chord). */
  a: number
  /** Half-size along axis B, above (t) and below (b) the centre. */
  t: number
  b: number
  /** Squareness: 2 = ellipse, 3–4 = rounded box. */
  n: number
}

const smooth = (u: number) => u * u * (3 - 2 * u)

/** The section at path position s: keys eased (smoothstep) so the surface has no kinks at keys. */
export function sample(keys: Key[], s: number, out: Key = { s: 0, c: [0, 0, 0], a: 0, t: 0, b: 0, n: 2 }): Key {
  let i = 0
  while (i < keys.length - 2 && s > keys[i + 1].s) i++
  const k0 = keys[i], k1 = keys[i + 1]
  const u = smooth(Math.min(1, Math.max(0, (s - k0.s) / (k1.s - k0.s || 1))))
  const L = (a: number, b: number) => a + (b - a) * u
  out.s = s
  out.c = [L(k0.c[0], k1.c[0]), L(k0.c[1], k1.c[1]), L(k0.c[2], k1.c[2])]
  out.a = L(k0.a, k1.a); out.t = L(k0.t, k1.t); out.b = L(k0.b, k1.b); out.n = L(k0.n, k1.n)
  return out
}

const sgnPow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p)

export interface LoftOpts {
  /** Axis of the section's "a" half-size and of its "t/b" half-sizes. */
  A: THREE.Vector3
  B: THREE.Vector3
  /** Rings along the path and points around each. */
  rings: number
  around: number
  /** Patch: the section angle range (0 = +A, π/2 = +B). Default the full ring. */
  th0?: number
  th1?: number
  /** Close each end with a cap (a fan to the centre). */
  capStart?: boolean
  capEnd?: boolean
  /** An airfoil section instead of a superellipse: "a" is the half chord (leading edge at θ = 0, along
   *  +A), "t/b" the half thickness; a NACA 00xx thickness — round nose, sharp trailing edge. The
   *  section angle spaces the points by cosine, so they bunch at both edges where the curve is. */
  foil?: boolean
}

/** NACA 00xx half-thickness at chord fraction u (0 leading edge … 1 trailing edge), normalised to 1. */
function naca(u: number): number {
  const v = Math.max(0, Math.min(1, u))
  return (0.2969 * Math.sqrt(v) - 0.126 * v - 0.3516 * v * v + 0.2843 * v ** 3 - 0.1036 * v ** 4) / 0.1
}

/** A point on a loft's surface: path position s, section angle th. */
function surfacePoint(keys: Key[], o: LoftOpts, s: number, th: number, k: Key, out: THREE.Vector3): THREE.Vector3 {
  sample(keys, s, k)
  const e = 2 / k.n, ca = Math.cos(th), sa = Math.sin(th)
  let x: number, y: number
  if (o.foil) { x = k.a * ca; y = (sa >= 0 ? k.t : k.b) * naca((1 - ca) / 2) * Math.sign(sa) }
  else { x = k.a * sgnPow(ca, e); y = (sa >= 0 ? k.t : k.b) * sgnPow(sa, e) }
  return out.set(k.c[0] + o.A.x * x + o.B.x * y, k.c[1] + o.A.y * x + o.B.y * y, k.c[2] + o.A.z * x + o.B.z * y)
}
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pc = new THREE.Vector3(), _pd = new THREE.Vector3(), _kn: Key = { s: 0, c: [0, 0, 0], a: 0, t: 0, b: 0, n: 2 }
/** The surface's normal at (s, th), from the shape itself (finite differences on the analytic
 *  surface), pointing away from the section centre. Every patch of one loft — paint, stripe, belly —
 *  gets the same normal along a shared edge, so they shade as one surface (per-patch vertex normals
 *  disagreed at the seams: visible bands where the colours met). */
export function surfaceNormal(keys: Key[], o: LoftOpts, s: number, th: number, out: THREE.Vector3): THREE.Vector3 {
  const s0 = keys[0].s, s1 = keys[keys.length - 1].s
  const ds = (s1 - s0) * 1e-3, dt = 1e-3
  const sa = Math.max(s0, s - ds), sb = Math.min(s1, s + ds)
  surfacePoint(keys, o, s, th + dt, _kn, _pa); surfacePoint(keys, o, s, th - dt, _kn, _pb)
  _pa.sub(_pb)
  surfacePoint(keys, o, sb, th, _kn, _pc); surfacePoint(keys, o, sa, th, _kn, _pd)
  _pc.sub(_pd)
  out.crossVectors(_pa, _pc)
  if (out.lengthSq() < 1e-14) {
    // Degenerate (a pointed end): straight out from the axis.
    surfacePoint(keys, o, s, th, _kn, _pa); out.set(_pa.x - _kn.c[0], _pa.y - _kn.c[1], _pa.z - _kn.c[2])
  }
  out.normalize()
  surfacePoint(keys, o, s, th, _kn, _pa)
  const cx = _pa.x - _kn.c[0], cy = _pa.y - _kn.c[1], cz = _pa.z - _kn.c[2]
  if (out.x * cx + out.y * cy + out.z * cz < 0) out.negate()
  return out
}

export function loft(keys: Key[], o: LoftOpts): THREE.BufferGeometry {
  const s0 = keys[0].s, s1 = keys[keys.length - 1].s
  const th0 = o.th0 ?? 0, th1 = o.th1 ?? Math.PI * 2
  const full = Math.abs(th1 - th0 - Math.PI * 2) < 1e-6
  const nA = full ? o.around : o.around + 1
  const pos: number[] = []
  const idx: number[] = []
  const k: Key = { s: 0, c: [0, 0, 0], a: 0, t: 0, b: 0, n: 2 }
  const ringCentres: THREE.Vector3[] = []
  const params: number[] = []
  for (let r = 0; r <= o.rings; r++) {
    // Rings bunch toward the ends (where the shape changes fastest: noses, tails, tips).
    const u = r / o.rings
    const s = s0 + (s1 - s0) * (0.5 - 0.5 * Math.cos(Math.PI * u))
    sample(keys, s, k)
    ringCentres.push(new THREE.Vector3(...k.c))
    const e = 2 / k.n
    for (let j = 0; j < nA; j++) {
      const th = th0 + ((th1 - th0) * j) / (full ? o.around : o.around)
      params.push(s, th)
      const ca = Math.cos(th), sa = Math.sin(th)
      let x: number, y: number
      if (o.foil) { x = k.a * ca; y = (sa >= 0 ? k.t : k.b) * naca((1 - ca) / 2) * Math.sign(sa) }
      else { x = k.a * sgnPow(ca, e); y = (sa >= 0 ? k.t : k.b) * sgnPow(sa, e) }
      pos.push(k.c[0] + o.A.x * x + o.B.x * y, k.c[1] + o.A.y * x + o.B.y * y, k.c[2] + o.A.z * x + o.B.z * y)
    }
  }
  for (let r = 0; r < o.rings; r++) {
    for (let j = 0; j < (full ? nA : nA - 1); j++) {
      const j1 = (j + 1) % nA
      const a = r * nA + j, b = r * nA + j1, c = (r + 1) * nA + j, d = (r + 1) * nA + j1
      idx.push(a, c, b, b, c, d)
    }
  }
  const cap = (ring: number, flip: boolean) => {
    const ci = pos.length / 3
    const cc = ringCentres[ring]
    pos.push(cc.x, cc.y, cc.z)
    for (let j = 0; j < (full ? nA : nA - 1); j++) {
      const a = ring * nA + j, b = ring * nA + ((j + 1) % nA)
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b)
    }
  }
  if (o.capStart) cap(0, false)
  if (o.capEnd) cap(o.rings, true)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  // Face outward whatever the axes' handedness: normals against each point's own section centre.
  const n = g.attributes.normal as THREE.BufferAttribute
  let dot = 0
  for (let r = 1; r < o.rings; r++) for (let j = 0; j < nA; j++) {
    const i = r * nA + j, c = ringCentres[r]
    dot += (pos[i * 3] - c.x) * n.getX(i) + (pos[i * 3 + 1] - c.y) * n.getY(i) + (pos[i * 3 + 2] - c.z) * n.getZ(i)
  }
  if (dot < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t }
    g.setIndex(idx)
    g.computeVertexNormals()
  }
  // The surface's own normals on every ring vertex (caps keep their fan's).
  const nn = g.attributes.normal as THREE.BufferAttribute, v = new THREE.Vector3()
  for (let i = 0; i < params.length / 2; i++) {
    surfaceNormal(keys, o, params[i * 2], params[i * 2 + 1], v)
    nn.setXYZ(i, v.x, v.y, v.z)
  }
  nn.needsUpdate = true
  return g
}

/** The same surface mirrored across x = 0 (winding flipped so it still faces out). */
export function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone()
  const p = m.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) p.setX(i, -p.getX(i))
  const n = m.attributes.normal as THREE.BufferAttribute | undefined
  if (n) for (let i = 0; i < n.count; i++) n.setX(i, -n.getX(i))
  const ix = m.index
  if (ix) for (let i = 0; i < ix.count; i += 3) { const a = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, a) }
  else {
    // Non-indexed (extrusions): swap the 2nd and 3rd vertex of every triangle, in every attribute.
    for (const att of Object.values(m.attributes) as THREE.BufferAttribute[]) {
      const n = att.itemSize, arr = att.array as Float32Array
      for (let t = 0; t + 2 < att.count; t += 3) for (let k = 0; k < n; k++) { const a = arr[(t + 1) * n + k]; arr[(t + 1) * n + k] = arr[(t + 2) * n + k]; arr[(t + 2) * n + k] = a }
    }
  }
  return m
}

export /** One engine, closed: a rounded front cap, the outer wall, a rolled lip, the inner wall down to a
 *  throat plate — no open tube to see through. Built along +z with its rear lip at z = 0. */
function nacelle(r: number): THREE.BufferGeometry {
  const P = (a: number, b: number) => new THREE.Vector2(a * r / 0.6, b)
  const prof = [
    P(0.0, 2.12), P(0.22, 2.1), P(0.4, 2.03), P(0.5, 1.9), P(0.53, 1.7), P(0.56, 1.0), P(0.6, 0.2),
    P(0.625, 0.08), P(0.62, -0.02), P(0.585, -0.06), P(0.55, -0.03), P(0.52, 0.12), P(0.48, 0.42), P(0.0, 0.44),
  ]
  const g = new THREE.LatheGeometry(prof, 48)
  g.rotateX(Math.PI / 2)
  return g
}


export const X = new THREE.Vector3(1, 0, 0)
export const Y = new THREE.Vector3(0, 1, 0)
export const Z = new THREE.Vector3(0, 0, 1)
