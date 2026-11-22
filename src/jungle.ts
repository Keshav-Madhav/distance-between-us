// MONSOON's landforms: where VERDANT has granite domes, groves and lone redwoods, the rainforest has
// karst towers (sheer limestone pillars with the jungle growing over their tops), the canopy (stands
// of tall straight-trunked trees in three layers, palms under them), and emergents — kapok giants on
// buttress roots, their flat crowns standing over everything. Same slots, placement and collision as
// the other worlds; `aCrev` is the material mask (0 rock, 0.5 bark, 1 foliage) as in src/forest.ts.
import * as THREE from 'three'
import { BARK, FOOT, LEAF, Mesh, ROCK, rng, treeProfile, type Tree } from './forest'

export type JungleKind = 'mesa' | 'butte' | 'spire'
type Profile = (th: number, t: number) => number
export const JUNGLE_VARIANTS: Record<JungleKind, number> = { mesa: 3, butte: 3, spire: 3 }

const ICO = new THREE.IcosahedronGeometry(1, 1)
const ICO0 = new THREE.IcosahedronGeometry(1, 0)

/** A rainforest tree: mostly crown — a short dark trunk, then a deep, wide mass of lumps from a
 *  third of the way up to the top (neighbouring crowns overlap into one canopy). */
function canopyTree(M: Mesh, x: number, z: number, y0: number, h: number, r: number, rnd: () => number): void {
  const rot = rnd() * 6.28
  const crownY = y0 + h * (0.42 + rnd() * 0.08)
  M.add(new THREE.CylinderGeometry(0.05, 0.08, 1, 6), BARK, x, (y0 + crownY) / 2 + 0.02, z, r * 0.8, crownY - y0 + 0.06, r * 0.8, rot)
  const top = y0 + h
  const n = 4 + Math.floor(rnd() * 2)
  for (let k = 0; k < n; k++) {
    // Lower lumps wide and spreading, upper ones tighter: a rounded dome of leaves.
    const u = k / (n - 1)
    const a = rot + k * 2.4 + rnd() * 0.5, d = r * (0.55 - 0.35 * u) * (0.6 + rnd() * 0.5)
    const sr = r * (1.0 - 0.35 * u) * (0.8 + rnd() * 0.3)
    const cy = crownY + (top - crownY) * (0.25 + 0.6 * u)
    M.add(k % 2 ? ICO0 : ICO, LEAF, x + Math.cos(a) * d, cy, z + Math.sin(a) * d, sr, (top - crownY) * (0.32 + rnd() * 0.12), sr, rnd() * 6)
  }
}

/** A palm: a thin leaning trunk, then a spray of drooping fronds (thin flattened cones). */
function palm(M: Mesh, x: number, z: number, y0: number, h: number, r: number, rnd: () => number): void {
  const lean = (rnd() - 0.5) * 0.25 * h, la = rnd() * 6.28
  const tx = x + Math.cos(la) * lean, tz = z + Math.sin(la) * lean
  const segs = 4
  for (let k = 0; k < segs; k++) {
    const u0 = k / segs, u1 = (k + 1) / segs
    const ax = x + (tx - x) * u0 * u0, az = z + (tz - z) * u0 * u0, bx = x + (tx - x) * u1 * u1, bz = z + (tz - z) * u1 * u1
    M.add(new THREE.CylinderGeometry(0.5, 0.55, 1, 5), BARK, (ax + bx) / 2, y0 + h * (u0 + u1) / 2, (az + bz) / 2, r * 0.05, h / segs + 0.01, r * 0.05)
  }
  const fy = y0 + h
  const fronds = 7
  for (let k = 0; k < fronds; k++) {
    const a = (k / fronds) * 6.28 + rnd() * 0.4
    const g = new THREE.ConeGeometry(0.18, 1, 4)
    g.rotateX(Math.PI / 2 + 0.55) // lying out and drooping
    g.translate(0, -0.2, 0.5)
    g.rotateY(-a + Math.PI / 2)
    M.add(g, LEAF, tx, fy, tz, r, r * 0.9, r)
  }
}

/** Ferns and undergrowth at the foot: low lumps, so a stand is never bare trunks on dirt. */
function undergrowth(M: Mesh, rad: number, n: number, rnd: () => number): void {
  for (let k = 0; k < n; k++) {
    const a = rnd() * 6.28, d = Math.sqrt(rnd()) * rad
    const s = 0.08 + rnd() * 0.08
    M.add(ICO0, LEAF, Math.cos(a) * d, FOOT + s * 0.2, Math.sin(a) * d, s * 1.6, s * 0.7, s * 1.6, rnd() * 6)
  }
}

/** Karst towers: sheer, bulging limestone pillars, overhangs at the top, the jungle spilling over the
 *  crown and down the ledges. v0 a single tower, v1 a split twin, v2 a broad flat tepui. */
function karst(seed: number, v: number) {
  const r = rng(seed)
  const M = new Mesh()
  const prof: Profile = (th, t) => {
    const tt = Math.min(1, t)
    // Near-vertical sides, a bulge two-thirds up, a slight overhang under a rounded crown.
    let k = 0.78 + 0.12 * Math.sin(tt * 4.2 + 0.6) + 0.12 * Math.pow(1 - tt, 6)
    k *= 1 - Math.pow(Math.max(0, tt - 0.88) / 0.12, 2) * 0.65
    k *= 1 + 0.1 * Math.sin(3 * th + seed) + 0.06 * Math.sin(7 * th + seed * 1.7) + 0.04 * Math.sin(13 * th + tt * 9)
    if (v === 1) k *= 0.75 + 0.45 * Math.abs(Math.cos(th)) * (1 - 0.6 * Math.max(0, Math.cos(2 * th)) * tt)
    if (v === 2) k *= 1.25 + 0.15 * (1 - tt)
    return k
  }
  const seg = 30, rows = 18
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
  // The crown: a cap of canopy over the top, and growth on ledges down the sides.
  const capN = [14, 18, 24][v]
  for (let k = 0; k < capN; k++) {
    const th = r() * 6.28, d = Math.sqrt(r()) * prof(th, 0.97) * 0.85
    canopyTree(M, Math.cos(th) * d, Math.sin(th) * d, 0.9, 0.14 + r() * 0.06, 0.14 + r() * 0.08, r)
  }
  for (let k = 0; k < 10; k++) {
    const th = r() * 6.28, t = 0.2 + r() * 0.6
    const rr = prof(th, t) * 1.0
    const s = 0.06 + r() * 0.06
    M.add(ICO0, LEAF, Math.cos(th) * rr, FOOT + (1 - FOOT) * t, Math.sin(th) * rr, s * 1.4, s, s * 1.4, r() * 6)
  }
  undergrowth(M, 1.3, 14, r)
  return { geo: M.geometry(), prof }
}

/** The canopy: a stand of rainforest — emergent, canopy and understorey layers, palms beneath.
 *  v0 a tall dark stand, v1 a palm-rich edge, v2 a dense broad mass. */
function stand(seed: number, v: number) {
  const r = rng(seed)
  const M = new Mesh()
  const trees: Tree[] = []
  const n = [8, 6, 10][v]
  for (let k = 0; k < n; k++) {
    const a = r() * 6.28, d = k === 0 ? 0 : 0.2 + Math.sqrt(r()) * 1.0
    const x = Math.cos(a) * d, z = Math.sin(a) * d
    const layer = k === 0 ? 1 : r()
    const h = layer > 0.75 ? 0.85 + r() * 0.15 : layer > 0.3 ? 0.55 + r() * 0.2 : 0.3 + r() * 0.15
    const isPalm = v === 1 ? r() < 0.3 : r() < 0.08
    const cr = isPalm ? 0.22 + r() * 0.08 : 0.55 + r() * 0.25
    if (isPalm) palm(M, x, z, FOOT, h * 0.6, cr, r)
    else canopyTree(M, x, z, FOOT, h, cr, r)
    trees.push({ x, z, h: isPalm ? h * 0.6 : h, r: cr, kind: 'leaf' })
  }
  undergrowth(M, 1.2, 18, r)
  return { geo: M.geometry(), prof: treeProfile(trees, FOOT) }
}

/** Emergents: a kapok giant on buttress roots (v0), a strangler fig of braided trunks (v1), a stand
 *  of tall palms (v2). */
function emergent(seed: number, v: number) {
  const r = rng(seed)
  const M = new Mesh()
  const trees: Tree[] = []
  if (v === 2) {
    for (let k = 0; k < 5; k++) {
      const a = r() * 6.28, d = k === 0 ? 0 : 0.3 + r() * 0.5
      const h = 0.7 + r() * 0.3
      palm(M, Math.cos(a) * d, Math.sin(a) * d, FOOT, h, 0.35, r)
      trees.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, h, r: 0.35, kind: 'leaf' })
    }
  } else {
    // Buttresses: thin fins flaring from the trunk's foot.
    const fins = v === 0 ? 5 : 0
    for (let k = 0; k < fins; k++) {
      const a = (k / fins) * 6.28 + r() * 0.3
      const g = new THREE.ConeGeometry(0.5, 1, 3)
      g.scale(0.15, 1, 1)
      g.rotateY(-a)
      M.add(g, BARK, Math.cos(a) * 0.1, FOOT + 0.07, Math.sin(a) * 0.1, 0.5, 0.18, 0.5)
    }
    // Trunk(s): one column, or several braided (the fig) — short of the crown, mostly hidden by it.
    const tn = v === 0 ? 1 : 4
    for (let k = 0; k < tn; k++) {
      const a = (k / tn) * 6.28
      const o = v === 0 ? 0 : 0.05
      M.add(new THREE.CylinderGeometry(v === 0 ? 0.06 : 0.035, v === 0 ? 0.1 : 0.05, 1, 7), BARK, Math.cos(a) * o, FOOT + 0.34, Math.sin(a) * o, 1, 0.72, 1, r() * 6)
    }
    // The crown: huge, in tiers of lumps from 60% up — wide below, domed on top (you race under it).
    const lumps = 16
    for (let k = 0; k < lumps; k++) {
      const u = k / (lumps - 1)
      const a = k * 2.4 + r() * 0.5, d = (k === 0 ? 0 : 0.85 - 0.55 * u) * (0.6 + r() * 0.5)
      const sr = (0.7 - 0.3 * u) * (0.8 + r() * 0.35)
      M.add(k % 3 ? ICO0 : ICO, LEAF, Math.cos(a) * d, FOOT + 0.66 + 0.28 * u, Math.sin(a) * d, sr, 0.1 + r() * 0.06, sr, r() * 6)
    }
    trees.push({ x: 0, z: 0, h: 1, r: 1.1, kind: 'leaf' })
  }
  undergrowth(M, 1.0, 10, r)
  return { geo: M.geometry(), prof: treeProfile(trees, FOOT) }
}

export function jungleGeometry(kind: JungleKind, seed: number, v: number): { geo: THREE.BufferGeometry; prof: Profile } {
  if (kind === 'mesa') return karst(seed, v)
  if (kind === 'butte') return stand(seed, v)
  return emergent(seed, v)
}
