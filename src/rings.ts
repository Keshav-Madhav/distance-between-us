// HUNT phase 1's sandbox: fly-through rings laid out ahead at varied heights — a slalom through the
// sky that teaches the flight (climb, dive, bank, skim the ground). The next ring glows hot; passed
// rings go dim; a set of ten is followed by the next set.
import * as THREE from 'three'
import { groundH } from './terrain'

export interface Ring { x: number; y: number; z: number; nx: number; ny: number; nz: number; r: number; state: 0 | 1 | 2 }

const N = 10

export class Rings {
  readonly items: Ring[] = []
  next = 0
  passed = 0
  missed = 0
  sets = 0
  readonly mesh: THREE.InstancedMesh
  private readonly col = new THREE.Color()
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  onPass: ((ring: Ring, i: number) => void) | null = null
  onMiss: ((ring: Ring, i: number) => void) | null = null
  onSet: (() => void) | null = null
  private topAt: ((x: number, z: number, r: number) => number) | null = null

  constructor() {
    const geo = new THREE.TorusGeometry(1, 0.06, 10, 64)
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
    this.mesh = new THREE.InstancedMesh(geo, mat, N)
    this.mesh.frustumCulled = false
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3)
    this.mesh.visible = false
  }

  /** A new set of ten ahead of (x, z, heading). */
  layout(x: number, z: number, heading: number, seed = 1, topAt: ((x: number, z: number, r: number) => number) | null = null): void {
    let s = (seed * 9301 + 49297) >>> 0
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
    this.items.length = 0
    let px = x, pz = z, h = heading
    for (let i = 0; i < N; i++) {
      // A slalom: each ring 2.4–3.6 km on, the heading wandering ±25°, heights from a skim (40 m)
      // to a climb (900 m).
      // (Gentler than the first cut: a ring every ~4 s at Mach 3.4, bends of ±15°, heights changing
      //  by at most ~400 m a ring — a slalom you can read, not a test.)
      h += (rnd() - 0.5) * 0.5
      const d = 3800 + rnd() * 1400
      const nx = Math.sin(h), nz = Math.cos(h)
      px += nx * d; pz += nz * d
      const prev = this.items.length ? this.items[this.items.length - 1].y - groundH(this.items[this.items.length - 1].x, this.items[this.items.length - 1].z) : 60
      const agl = i === 0 ? 60 : THREE.MathUtils.clamp(prev + (rnd() - 0.45) * 800, 50, 900)
      // Never inside or just over rock: 120 m clear of the highest top near it.
      const y = Math.max(groundH(px, pz) + agl, topAt ? topAt(px, pz, 300) + 120 : 0)
      this.items.push({ x: px, y, z: pz, nx, ny: 0, nz, r: 95, state: 0 })
    }
    this.topAt = topAt
    this.next = 0
    this.mesh.visible = true
    this.draw(0)
  }

  /** Passed (through the hoop) or missed (through its plane, outside it) since the last step. */
  step(p: { pos: THREE.Vector3; prev: THREE.Vector3; fwd: THREE.Vector3; heading: number }): void {
    const r = this.items[this.next]
    if (!r) return
    const s0 = (p.prev.x - r.x) * r.nx + (p.prev.y - r.y) * r.ny + (p.prev.z - r.z) * r.nz
    const s1 = (p.pos.x - r.x) * r.nx + (p.pos.y - r.y) * r.ny + (p.pos.z - r.z) * r.nz
    if (!(s0 < 0 && s1 >= 0)) {
      // Flown well past it (2 km beyond, or away): counted as missed.
      if (s1 > 2000) { r.state = 2; this.missed++; this.onMiss?.(r, this.next); this.advance(p) }
      return
    }
    const t = s0 / (s0 - s1)
    const hx = p.prev.x + (p.pos.x - p.prev.x) * t - r.x, hy = p.prev.y + (p.pos.y - p.prev.y) * t - r.y, hz = p.prev.z + (p.pos.z - p.prev.z) * t - r.z
    const off = Math.hypot(hx, hy, hz)
    if (off <= r.r) { r.state = 1; this.passed++; this.onPass?.(r, this.next) }
    else { r.state = 2; this.missed++; this.onMiss?.(r, this.next) }
    this.advance(p)
  }

  private advance(p: { pos: THREE.Vector3; heading: number }): void {
    this.next++
    if (this.next >= this.items.length) {
      this.sets++
      this.onSet?.()
      this.layout(p.pos.x, p.pos.z, p.heading, this.sets + 1, this.topAt)
    }
  }

  /** Instances: the next ring hot and pulsing, the rest cool; passed ones dim, missed ones red. */
  draw(time: number): void {
    const up = new THREE.Vector3(0, 0, 1)
    this.items.forEach((r, i) => {
      this.q.setFromUnitVectors(up, new THREE.Vector3(r.nx, r.ny, r.nz))
      const k = i === this.next ? 1 + 0.06 * Math.sin(time * 8) : 1
      this.m.compose(new THREE.Vector3(r.x, r.y, r.z), this.q, new THREE.Vector3(r.r * k, r.r * k, r.r * 8))
      this.mesh.setMatrixAt(i, this.m)
      if (r.state === 1) this.col.setRGB(0.2, 0.5, 0.3)
      else if (r.state === 2) this.col.setRGB(0.6, 0.08, 0.05)
      else if (i === this.next) this.col.setRGB(4, 1.5, 0.3)
      else this.col.setRGB(0.5, 1.6, 2.2).multiplyScalar(i === this.next + 1 ? 1 : 0.45)
      this.mesh.setColorAt(i, this.col)
    })
    this.mesh.count = this.items.length
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  shift(dx: number, dz: number): void { for (const r of this.items) { r.x += dx; r.z += dz } }
  hide(): void { this.mesh.visible = false; this.items.length = 0 }
}
