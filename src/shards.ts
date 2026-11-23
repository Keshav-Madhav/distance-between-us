// FREE ROAM's collectibles: trails of five glowing crystals laid round you — along the ground, up on
// a rock top, or arcing through the sky — each with a faint beam so it can be found from far off.
// Take all five of a trail for a bonus. Trails out of reach (or taken) are laid again further on.
import * as THREE from 'three'

export type TrailKind = 'ground' | 'top' | 'sky'
interface Shard { x: number; y: number; z: number; alive: boolean }
interface Trail { kind: TrailKind; shards: Shard[]; got: number }

const TRAILS = 10, PER = 5, N = TRAILS * PER

export class Shards {
  readonly group = new THREE.Group()
  readonly trails: Trail[] = []
  total = 0
  /** Taken this run. */
  taken = 0
  onTake: ((x: number, y: number, z: number, inTrail: number, trailDone: boolean, kind: TrailKind) => void) | null = null
  private readonly gem: THREE.InstancedMesh
  private readonly beam: THREE.InstancedMesh
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly s = new THREE.Vector3()
  private readonly p = new THREE.Vector3()
  private seed = 7

  constructor(color = 0xffd36a) {
    this.gem = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color, toneMapped: false }), N)
    const bg = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true)
    bg.translate(0, 0.5, 0)
    this.beam = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), N)
    for (const m of [this.gem, this.beam]) { m.frustumCulled = false; this.group.add(m) }
    this.group.visible = false
    try { this.total = +(localStorage.getItem('dbu-shards') ?? 0) || 0 } catch { /* blocked */ }
  }

  private rnd(): number { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296 }

  /** Lay every trail round (x, z). */
  start(x: number, z: number, heading: number, ground: (x: number, z: number) => number, rock: (x: number, z: number) => number): void {
    this.seed = (Date.now() & 0xffff) | 1
    this.trails.length = 0
    this.taken = 0
    for (let i = 0; i < TRAILS; i++) {
      const t: Trail = { kind: 'ground', shards: [], got: 0 }
      for (let k = 0; k < PER; k++) t.shards.push({ x: 0, y: 0, z: 0, alive: true })
      this.trails.push(t)
      // The first three in sight ahead: something to go for straight away.
      this.lay(t, x, z, heading, i < 3 ? 700 + i * 500 : 1200, i < 3 ? 0.5 : Math.PI, ground, rock, i === 0 ? 'ground' : i === 1 ? 'sky' : null)
    }
    this.group.visible = true
  }

  private lay(t: Trail, x: number, z: number, heading: number, dist: number, spread: number, ground: (x: number, z: number) => number, rock: (x: number, z: number) => number, force: TrailKind | null): void {
    t.got = 0
    let cx = 0, cz = 0, ang = heading, kind: TrailKind = force ?? (this.rnd() < 0.45 ? 'ground' : this.rnd() < 0.5 ? 'top' : 'sky')
    for (let tries = 0; ; tries++) {
      const a = heading + (this.rnd() * 2 - 1) * spread
      ang = a
      const d = dist + this.rnd() * 3500
      cx = x + Math.sin(a) * d; cz = z + Math.cos(a) * d
      // A rock top: look for a spot where the surface stands well above the ground.
      if (kind !== 'top' || rock(cx, cz) - ground(cx, cz) > 60) break
      if (tries > 40) { kind = 'sky'; break }
    }
    t.kind = kind
    // Laid along the line you come in on (from where it was laid): one pass can take all five.
    const dir = ang + (this.rnd() - 0.5) * 0.5, dx = Math.sin(dir), dz = Math.cos(dir)
    const base = kind === 'sky' ? 250 + this.rnd() * 500 : 0
    for (let k = 0; k < PER; k++) {
      const s = t.shards[k]
      // Ground and rock trails run along the surface; a top's five ring its crown; sky ones climb.
      if (kind === 'top') { const a = (k / PER) * 6.28; s.x = cx + Math.sin(a) * 18; s.z = cz + Math.cos(a) * 18 }
      else { s.x = cx + dx * (k - 2) * 140; s.z = cz + dz * (k - 2) * 140 }
      s.y = kind === 'sky' ? ground(s.x, s.z) + base + k * 60 : rock(s.x, s.z) + 9
      s.alive = true
    }
  }

  /** The nearest crystal still standing (for the HUD's pointer), or null. */
  nearest(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 | null {
    let best = Infinity
    for (const t of this.trails) for (const sh of t.shards) {
      if (!sh.alive) continue
      const d = (sh.x - x) ** 2 + (sh.y - y) ** 2 + (sh.z - z) ** 2
      if (d < best) { best = d; out.set(sh.x, sh.y, sh.z) }
    }
    return best < Infinity ? out : null
  }

  /** Take any the craft passed through this step (prev → pos); re-lay trails left behind or emptied. */
  step(prev: THREE.Vector3, pos: THREE.Vector3, heading: number, ground: (x: number, z: number) => number, rock: (x: number, z: number) => number): void {
    const sx = pos.x - prev.x, sy = pos.y - prev.y, sz = pos.z - prev.z
    const l2 = sx * sx + sy * sy + sz * sz || 1
    for (const t of this.trails) {
      const R = t.kind === 'sky' ? 36 : 30
      let far = true
      for (const s of t.shards) {
        if (!s.alive) continue
        const ex = s.x - prev.x, ey = s.y - prev.y, ez = s.z - prev.z
        if (ex * ex + ez * ez < 6500 * 6500) far = false
        // Closest point of this step's segment to the shard.
        const u = Math.max(0, Math.min(1, (ex * sx + ey * sy + ez * sz) / l2))
        const qx = ex - sx * u, qy = ey - sy * u, qz = ez - sz * u
        if (qx * qx + qy * qy + qz * qz < R * R) {
          s.alive = false
          t.got++
          this.taken++
          this.total++
          this.onTake?.(s.x, s.y, s.z, t.got, t.got === PER, t.kind)
        }
      }
      const left = t.shards.some((s) => s.alive)
      if (!left || far) this.lay(t, pos.x, pos.z, heading, 2500, left ? Math.PI : 1.2, ground, rock, null)
    }
  }

  saveTotal(): void { try { localStorage.setItem('dbu-shards', String(this.total)) } catch { /* blocked */ } }

  draw(time: number): void {
    let i = 0
    for (const t of this.trails) for (const s of t.shards) {
      const sc = s.alive ? (t.kind === 'sky' ? 7 : 5.5) : 0.0001
      this.q.setFromAxisAngle(this.p.set(0, 1, 0), time * 1.7 + i)
      this.s.set(sc * 0.7, sc * (1.25 + 0.1 * Math.sin(time * 3 + i)), sc * 0.7)
      this.m.compose(this.p.set(s.x, s.y + Math.sin(time * 2 + i) * 1.5, s.z), this.q, this.s)
      this.gem.setMatrixAt(i, this.m)
      // The beam: from the ground up through the crystal (sky ones: a short one above).
      const bh = s.alive ? (t.kind === 'sky' ? 120 : 420) : 0.0001
      this.q.identity()
      this.m.compose(this.p.set(s.x, s.y - (t.kind === 'sky' ? 0 : 9), s.z), this.q, this.s.set(1.6, bh, 1.6))
      this.beam.setMatrixAt(i, this.m)
      i++
    }
    this.gem.instanceMatrix.needsUpdate = true
    this.beam.instanceMatrix.needsUpdate = true
  }

  hide(): void { this.group.visible = false }

  shift(dx: number, dz: number): void {
    for (const t of this.trails) for (const s of t.shards) { s.x += dx; s.z += dz }
  }
}
