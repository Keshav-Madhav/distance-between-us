// CANYON RUN's canyon: two continuous walls that follow the whole loop, one each side of a wide floor —
// the Grand Canyon's stepped profile (sheer cliff, ledge, cliff, ledge, cliff) up to a flat rim that runs
// out ~3 km. One strip of geometry per side, sampled every ~200 m round the closed loop: no gaps, no holes.
// The walls are solid: World.near asks wallsNear for a huge round "rock" just beyond each wall's foot
// (its surface on the foot), so hitting one is the same glance-and-scrape as any rock.
import * as THREE from 'three'
import { groundH } from './terrain'

/** The wall's cross-section from its foot outward: [metres out from the foot, height]: sheer cliffs, ledges, a flat rim. */
// (Tall: at ~460 m the walls 1.3 km off read as low ledges; the Grand Canyon's are far taller than wide.)
const PROFILE: [number, number][] = [
  [0, -6], [24, 260], [52, 274], [230, 290], [258, 500], [290, 516], [470, 530], [502, 760], [536, 780], [720, 800], [760, 830], [3560, 840], [3590, 820], [3640, -6],
]
/** The rim's height above the floor (m): above it the walls are not in the way (fly over them). */
const RIM = 900
/** The outer cliff of the rim plateau, out from the foot (m). */
const OUTER = 3640
/** The virtual rock behind each wall (m): big enough that its curve is the wall's line over a pass. */
const BIG = 20000

export class Canyon {
  readonly rx: Float64Array
  readonly rz: Float64Array
  readonly tx: Float64Array
  readonly tz: Float64Array
  /** Half-width of the floor (m): the wall's foot from the line, ~2.6-3.2 km across. */
  readonly half: Float64Array
  readonly m: number
  private last = 0

  constructor(loop: (u: number) => [number, number]) {
    // Ring samples every ~200 m along the loop.
    let L = 0
    let [px, pz] = loop(0)
    for (let k = 1; k <= 2000; k++) { const [x, z] = loop(k / 2000); L += Math.hypot(x - px, z - pz); px = x; pz = z }
    const m = Math.max(64, Math.round(L / 200))
    this.m = m
    this.rx = new Float64Array(m); this.rz = new Float64Array(m); this.tx = new Float64Array(m); this.tz = new Float64Array(m); this.half = new Float64Array(m)
    for (let i = 0; i < m; i++) {
      const u = i / m
      const [x, z] = loop(u)
      const [x2, z2] = loop(u + 0.5 / m), [x0, z0] = loop(u - 0.5 / m)
      const dl = Math.hypot(x2 - x0, z2 - z0) || 1
      this.rx[i] = x; this.rz[i] = z; this.tx[i] = (x2 - x0) / dl; this.tz[i] = (z2 - z0) / dl
      const a = u * Math.PI * 2
      this.half[i] = 1320 + 240 * Math.sin(a * 3 + 1.1) + 130 * Math.sin(a * 11 + 2.3) + 60 * Math.sin(a * 23 + 0.4)
    }
  }

  /** The nearest ring sample to (x, z) (searched near the last one found, the whole ring now and then). */
  nearest(x: number, z: number, full = false): number {
    const m = this.m
    let best = this.last, bd = Infinity
    const span = full ? m : 24
    for (let k = -span; k <= span; k++) {
      const i = (((this.last + k) % m) + m) % m
      const d = (this.rx[i] - x) ** 2 + (this.rz[i] - z) ** 2
      if (d < bd) { bd = d; best = i }
    }
    // (Far from where it last looked: a full search.)
    if (!full && bd > 4e6) return this.nearest(x, z, true)
    this.last = best
    return best
  }

  /** Half-width at the point nearest (x, z), and the signed distance across the line there. */
  across(x: number, z: number): { i: number; lat: number; half: number } {
    const i = this.nearest(x, z)
    const lat = (x - this.rx[i]) * this.tz[i] - (z - this.rz[i]) * this.tx[i]
    return { i, lat, half: this.half[i] }
  }

  /** Both walls as round rocks for World.near: [x, z, radius] × 2 (the surface on the wall's foot). */
  wallsNear(x: number, z: number, y: number, out: { x: number; z: number; cr: number; big: boolean }[], n: number): number {
    const i = this.nearest(x, z)
    if (y > groundH(this.rx[i], this.rz[i]) + RIM) return n
    const sx = this.tz[i], sz = -this.tx[i], h = this.half[i]
    const lat = (x - this.rx[i]) * this.tz[i] - (z - this.rz[i]) * this.tx[i]
    const side = lat >= 0 ? 1 : -1, d = Math.abs(lat)
    let o = out[n]
    if (!o) out[n] = o = { x: 0, z: 0, cr: 0, big: false }
    // (Scrape and glance like a trackside block, not the mesa crash: a wall you run along.)
    o.big = false
    if (d < h + OUTER / 2) {
      // Inside the canyon: the wall's foot on this side (a rock whose surface is the foot).
      o.x = this.rx[i] + sx * side * (h + BIG); o.z = this.rz[i] + sz * side * (h + BIG); o.cr = BIG
    } else if (d < h + OUTER + 400) {
      // Outside it, beyond the rim plateau: its outer cliff (a rock on the canyon's side of it).
      o.x = this.rx[i] + sx * side * (h + OUTER - BIG); o.z = this.rz[i] + sz * side * (h + OUTER - BIG); o.cr = BIG
    } else return n
    return n + 1
  }

  /** Distance (m) from the canyon's line, for keeping other landforms out of it. */
  distance(x: number, z: number): number {
    let bd = Infinity
    for (let i = 0; i < this.m; i++) bd = Math.min(bd, (this.rx[i] - x) ** 2 + (this.rz[i] - z) ** 2)
    return Math.sqrt(bd)
  }
  /** Inside the canyon or under its rim plateau (r: the landform's radius). */
  covers(x: number, z: number, r: number): boolean { return this.distance(x, z) < 1700 + OUTER + r }

  build(mat: THREE.Material): THREE.Group {
    const g = new THREE.Group()
    const rows = this.m, P = PROFILE.length
    for (const side of [1, -1]) {
      const pos = new Float32Array(rows * P * 3)
      for (let r = 0; r < rows; r++) {
        const sx = this.tz[r] * side, sz = -this.tx[r] * side
        const W = this.half[r]
        const base = groundH(this.rx[r], this.rz[r])
        // Each wall wanders and its height varies along the canyon (never the same cliff twice).
        const hk = 0.85 + 0.15 * Math.sin(r * 0.09 * side + 1.3) + 0.08 * Math.sin(r * 0.37 + side)
        for (let k = 0; k < P; k++) {
          const [d, hgt] = PROFILE[k]
          const jit = k > 0 && k < P - 1 ? 14 * Math.sin(r * 1.3 + k * 1.7 + side * 3) : 0
          const off = W + d + jit
          const o = (r * P + k) * 3
          pos[o] = this.rx[r] + sx * off
          pos[o + 1] = base + hgt * hk
          pos[o + 2] = this.rz[r] + sz * off
        }
      }
      const idx: number[] = []
      for (let r = 0; r < rows; r++) {
        const r2 = (r + 1) % rows
        for (let k = 0; k < P - 1; k++) {
          const a = r * P + k, b = r2 * P + k, c = r * P + k + 1, d = r2 * P + k + 1
          // Faces toward the floor (the winding flips with the side).
          // (Flipped once: the cliffs faced away and the rim's underside showed as a slab floating in the sky.)
          if (side > 0) idx.push(a, b, c, b, d, c)
          else idx.push(a, c, b, b, c, d)
        }
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setIndex(idx)
      const flat = geo.toNonIndexed()
      flat.computeVertexNormals()
      flat.computeBoundingSphere()
      const mesh = new THREE.Mesh(flat, mat)
      mesh.frustumCulled = false
      g.add(mesh)
    }
    return g
  }
}
