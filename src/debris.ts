// Wreckage: real pieces of hull (plates, fins, nacelle chunks) thrown off in a crash — pooled, one
// instanced draw, simple physics (gravity, drag, tumbling, bouncing and skidding on the sand).
import * as THREE from 'three'
import { groundH } from './terrain'
import { patchStandard } from './shaders'

const N = 90

interface Piece {
  on: boolean
  p: THREE.Vector3
  v: THREE.Vector3
  q: THREE.Quaternion
  w: THREE.Vector3
  s: THREE.Vector3
  life: number
  smoke: boolean
  col: THREE.Color
}

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _m = new THREE.Matrix4()
const _c = new THREE.Color()
const _s = new THREE.Vector3()

export class Debris {
  readonly mesh: THREE.InstancedMesh
  private readonly pieces: Piece[] = []
  /** Called for burning pieces each frame (the caller adds smoke). */
  onSmoke: ((x: number, y: number, z: number, vx: number, vz: number) => void) | null = null

  constructor(env: THREE.Texture) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.4, envMap: env, flatShading: true })
    patchStandard(mat)
    // A bent plate: a box with one end folded — reads as torn panel at any size.
    const g = new THREE.BoxGeometry(1, 0.12, 1, 2, 1, 2)
    const pos = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) if (pos.getX(i) > 0.2) pos.setY(i, pos.getY(i) + (pos.getX(i) - 0.2) * 0.6)
    g.computeVertexNormals()
    this.mesh = new THREE.InstancedMesh(g, mat, N)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    for (let i = 0; i < N; i++) {
      this.pieces.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), s: new THREE.Vector3(), life: 0, smoke: false, col: new THREE.Color() })
      this.mesh.setColorAt(i, _c.set(0xffffff))
    }
  }

  /** Throw n pieces from (x, y, z) carried by (vx, vy, vz), in the craft's paint colours. */
  burst(x: number, y: number, z: number, vx: number, vy: number, vz: number, n: number, spread: number, body: number, trim: number): void {
    const R = Math.random
    for (let k = 0; k < n; k++) {
      let i = this.pieces.findIndex((p) => !p.on)
      if (i < 0) i = Math.floor(R() * N)
      const p = this.pieces[i]
      p.on = true
      p.life = 3 + R() * 3
      p.smoke = R() < 0.25
      p.p.set(x + (R() - 0.5) * 3, y + R() * 1.5, z + (R() - 0.5) * 3)
      p.v.set(vx * (0.55 + R() * 0.35) + (R() - 0.5) * spread, vy + 10 + R() * spread * 0.6, vz * (0.55 + R() * 0.35) + (R() - 0.5) * spread)
      p.q.setFromEuler(_e.set(R() * 6, R() * 6, R() * 6))
      p.w.set((R() - 0.5) * 30, (R() - 0.5) * 30, (R() - 0.5) * 30)
      const big = R() < 0.25
      p.s.set(big ? 1.6 + R() * 1.6 : 0.4 + R() * 0.8, 1 + R(), big ? 1 + R() * 1.4 : 0.3 + R() * 0.7)
      p.col.set(R() < 0.55 ? body : R() < 0.5 ? 0x16181c : trim)
    }
  }

  clear(): void { for (const p of this.pieces) p.on = false; this.mesh.count = 0 }

  shift(dx: number, dz: number): void { for (const p of this.pieces) { p.p.x += dx; p.p.z += dz } }

  update(dt: number): void {
    let n = 0
    for (let i = 0; i < N; i++) {
      const p = this.pieces[i]
      if (!p.on) continue
      p.life -= dt
      if (p.life <= 0) { p.on = false; continue }
      p.v.y -= 30 * dt
      p.v.multiplyScalar(Math.exp(-0.35 * dt))
      p.p.addScaledVector(p.v, dt)
      const g = groundH(p.p.x, p.p.z) + 0.2 * p.s.y
      if (p.p.y < g) {
        p.p.y = g
        if (p.v.y < -4) { p.v.y *= -0.3; p.w.multiplyScalar(0.6) } else p.v.y = 0
        // Skidding to a stop.
        const f = Math.exp(-3 * dt)
        p.v.x *= f; p.v.z *= f
        p.w.multiplyScalar(Math.exp(-4 * dt))
      }
      _q.setFromEuler(_e.set(p.w.x * dt, p.w.y * dt, p.w.z * dt))
      p.q.multiply(_q)
      const shrink = Math.min(1, p.life * 2)
      _m.compose(p.p, p.q, _s.copy(p.s).multiplyScalar(shrink))
      this.mesh.setMatrixAt(n, _m)
      this.mesh.setColorAt(n, p.col)
      if (p.smoke && this.onSmoke) this.onSmoke(p.p.x, p.p.y, p.p.z, p.v.x, p.v.z)
      n++
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
}
