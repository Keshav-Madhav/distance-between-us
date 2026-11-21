// VERDANT's landforms (docs/MAP-VERDANT.md): where the desert has mesas, buttes and hoodoos, the
// forest world has granite domes crowned with trees, groves, and lone giant redwoods. Same slots,
// placement and collision (a radial profile: radius multiplier at angle th and height fraction t).
//
// The `aCrev` attribute is the material mask here: 0 granite, 0.5 bark, 1 foliage (the shader colours
// by it and sways the foliage in the wind).
import * as THREE from 'three'

export type ForestKind = 'mesa' | 'butte' | 'spire'
type Profile = (th: number, t: number) => number

export const FOREST_VARIANTS: Record<ForestKind, number> = { mesa: 3, butte: 3, spire: 3 }

const FOOT = -0.08
const ROCK = 0, BARK = 0.5, LEAF = 1
function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

class Mesh {
  readonly pos: number[] = []
  readonly mask: number[] = []
  /** A geometry's triangles, moved to (x, y, z) and scaled, with one mask value. */
  add(g: THREE.BufferGeometry, m: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0): void {
    const geo = g.index ? g.toNonIndexed() : g
    const p = geo.attributes.position as THREE.BufferAttribute
    const c = Math.cos(ry), s = Math.sin(ry)
    for (let i = 0; i < p.count; i++) {
      const lx = p.getX(i) * sx, lz = p.getZ(i) * sz
      this.pos.push(x + lx * c - lz * s, y + p.getY(i) * sy, z + lx * s + lz * c)
      this.mask.push(m)
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('aCrev', new THREE.Float32BufferAttribute(this.mask, 1))
    g.computeVertexNormals()
    return g
  }
}

interface Tree { x: number; z: number; h: number; r: number; kind: 'pine' | 'leaf' | 'red' }

/** One tree into the mesh, base at y0 (its own height h, canopy radius r). */
function tree(M: Mesh, t: Tree, y0: number, rnd: () => number): void {
  const rot = rnd() * 6.28
  if (t.kind === 'leaf') {
    // Broadleaf: a trunk, then a lumpy crown of three blobs.
    M.add(new THREE.CylinderGeometry(0.08, 0.12, 1, 6), BARK, t.x, y0 + t.h * 0.25, t.z, t.r, t.h * 0.5, t.r)
    for (let k = 0; k < 3; k++) {
      const a = rot + k * 2.1, d = t.r * 0.35
      M.add(new THREE.IcosahedronGeometry(1, 0), LEAF, t.x + Math.cos(a) * d, y0 + t.h * (0.62 + 0.12 * k), t.z + Math.sin(a) * d, t.r * (0.75 - k * 0.12), t.h * (0.28 - k * 0.04), t.r * (0.75 - k * 0.12), rnd() * 6)
    }
    return
  }
  // Conifers: a trunk, then stacked cones (tiers) narrowing upward; a redwood's crown starts high.
  const red = t.kind === 'red'
  const trunkTop = red ? 0.5 : 0.22
  M.add(new THREE.CylinderGeometry(red ? 0.07 : 0.05, red ? 0.12 : 0.08, 1, 7), BARK, t.x, y0 + (t.h * trunkTop) / 2, t.z, t.r, t.h * trunkTop + 0.02, t.r, rot)
  const tiers = red ? 3 : 4
  for (let k = 0; k < tiers; k++) {
    const f = k / tiers
    const base = trunkTop * 0.8 + f * (1 - trunkTop * 0.8) * 0.82
    const rr = t.r * (red ? 0.55 : 1) * (1 - f * 0.55)
    const hh = t.h * (red ? 0.34 : 0.36)
    M.add(new THREE.ConeGeometry(1, 1, 7), LEAF, t.x, y0 + t.h * base + hh / 2, t.z, rr, hh, rr, rot + k)
  }
}

/** The tallest point of a tree list's canopy at height y, along a ray from the centre (collision). */
function treeProfile(trees: Tree[], y0: number): Profile {
  return (th, t) => {
    const ct = Math.cos(th), st = Math.sin(th)
    let far = 0
    for (const tr of trees) {
      const u = (t - y0) / tr.h
      if (u > 1 || u < -0.2) continue
      // Trunk thin below the crown, the crown a cone above it.
      const rr = u < 0.3 ? tr.r * 0.12 : tr.r * Math.max(0.15, 1 - (u - 0.3) / 0.7)
      const p = tr.x * ct + tr.z * st, q = -tr.x * st + tr.z * ct
      if (Math.abs(q) >= rr) continue
      far = Math.max(far, p + Math.sqrt(rr * rr - q * q))
    }
    return far
  }
}

/** Granite domes (a lathe), crowned with a few trees; v1 a long ridge; v2 a half dome (one sheer face). */
function dome(seed: number, v: number) {
  const r = rng(seed)
  const M = new Mesh()
  const elong = [1, 1.6, 1][v]
  const prof: Profile = (th, t) => {
    let k = Math.sqrt(Math.max(0, 1 - Math.pow(Math.min(1, t), 2.2))) * 0.95 + 0.05
    k *= 1 + 0.08 * Math.sin(3 * th + seed) + 0.04 * Math.sin(7 * th + seed * 2)
    k *= 1 + 0.25 * Math.pow(1 - Math.min(1, t), 4) // a talus apron
    if (v === 1) k *= 1 + (elong - 1) * Math.abs(Math.cos(th))
    if (v === 2) { const face = Math.cos(th - 1); if (face > 0.2) k *= 1 - 0.55 * Math.min(1, (face - 0.2) * 2.5) * (0.4 + 0.6 * Math.min(1, t * 1.5)) }
    return k
  }
  const seg = 28, rows = 14
  const pt = (i: number, j: number): [number, number, number] => {
    const t = i / rows, th = (j / seg) * Math.PI * 2
    const k = prof(th, t)
    return [Math.cos(th) * k, FOOT + (1 - FOOT) * t, Math.sin(th) * k]
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < seg; j++) {
    const a = pt(i, j), b = pt(i, j + 1), c = pt(i + 1, j), d = pt(i + 1, j + 1)
    M.pos.push(...a, ...c, ...b, ...b, ...c, ...d)
    for (let k = 0; k < 6; k++) M.mask.push(ROCK)
  }
  // Trees on the crown and shoulders (not on the half dome's sheer face).
  const n = [7, 10, 4][v]
  for (let k = 0; k < n; k++) {
    const th = r() * 6.28
    if (v === 2 && Math.cos(th - 1) > 0) continue
    const t = 0.55 + r() * 0.4
    const rad = prof(th, t) * 0.9
    tree(M, { x: Math.cos(th) * rad * (v === 1 ? 1 : 1), z: Math.sin(th) * rad, h: 0.22 + r() * 0.12, r: 0.06 + r() * 0.04, kind: r() < 0.7 ? 'pine' : 'leaf' }, FOOT + (1 - FOOT) * t - 0.02, r)
  }
  return { geo: M.geometry(), prof }
}

/** Groves: a cluster of trees (v0 pines, v1 broadleaf, v2 mixed and dense). */
function grove(seed: number, v: number) {
  const r = rng(seed)
  const M = new Mesh()
  const trees: Tree[] = []
  const n = [7, 5, 10][v]
  for (let k = 0; k < n; k++) {
    const a = r() * 6.28, d = k === 0 ? 0 : 0.35 + r() * 0.9
    const kind: Tree['kind'] = v === 0 ? 'pine' : v === 1 ? 'leaf' : r() < 0.6 ? 'pine' : 'leaf'
    const h = (k === 0 ? 1 : 0.55 + r() * 0.4)
    trees.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, h, r: kind === 'leaf' ? 0.45 + r() * 0.2 : 0.32 + r() * 0.12, kind })
  }
  for (const t of trees) tree(M, t, FOOT, r)
  return { geo: M.geometry(), prof: treeProfile(trees, FOOT) }
}

/** Giants: a lone redwood (v0), twin redwoods (v1), a giant broadleaf (v2). */
function giant(seed: number, v: number) {
  const r = rng(seed)
  const M = new Mesh()
  const trees: Tree[] = v === 0 ? [{ x: 0, z: 0, h: 1, r: 0.9, kind: 'red' }]
    : v === 1 ? [{ x: -0.5, z: 0.1, h: 1, r: 0.8, kind: 'red' }, { x: 0.55, z: -0.15, h: 0.82, r: 0.7, kind: 'red' }]
      : [{ x: 0, z: 0, h: 0.75, r: 2.2, kind: 'leaf' }]
  for (const t of trees) tree(M, t, FOOT, r)
  return { geo: M.geometry(), prof: treeProfile(trees, FOOT) }
}

export function forestGeometry(kind: ForestKind, seed: number, v: number): { geo: THREE.BufferGeometry; prof: Profile } {
  if (kind === 'mesa') return dome(seed, v)
  if (kind === 'butte') return grove(seed, v)
  return giant(seed, v)
}
