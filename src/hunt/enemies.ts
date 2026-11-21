// HUNT phase 2's first enemy (docs/HUNT-FLIGHT-PLAN.md §4): the Dart.
// Flights of 3–5 in a V behind a leader. Real flight — a velocity, a top speed, a turn-rate limit —
// never steered in your frame. The leader pursues you; wingmen hold their slots. Each fires 3-round
// bursts when you are in its 10° front cone; shot at, it breaks hard for a moment. It keeps clear of
// the ground and rock. Left far behind, it turns back (pursuit) rather than vanishing.
// 3 HP; hits from behind (the engine, a 60° rear cone) count double.
import * as THREE from 'three'
import { MACH } from '../config'
import { groundH } from '../terrain'
import { leadDir, type Rounds, type Shooter, type Target } from './weapons'

export const DART = { hp: 3, minMach: 2.2, maxMach: 3.0, turn: 1.1, cone: 10, range: 2200, burst: 3, burstGap: 0.12, roundSpeed: 1400, roundLife: 1.6, dmg: 4, points: 100, scale: 2.5 }

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1)

export class Dart implements Target {
  readonly pos = new THREE.Vector3()
  readonly prev = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  readonly radius = 14
  alive = false
  hp = DART.hp
  leader: Dart | null = null
  /** Slot in the V (leader's frame: right, up, back). */
  readonly slot = new THREE.Vector3()
  breakT = 0
  readonly breakDir = new THREE.Vector3()
  fireCd = 2
  burstLeft = 0
  burstT = 0
  bank = 0
  /** Set when killed (for the game's score/explosion), cleared by the game. */
  killed = false
  /** Last hit came from behind (double damage). */
  rearHit = false
  /** A test target: flies straight, never fires. */
  dummy = false
  hit(dmg: number, dir: THREE.Vector3): void {
    if (!this.alive) return
    const fwd = _a.copy(this.vel).normalize()
    // A hit travelling the same way the Dart flies came from behind it: into the engine.
    this.rearHit = dir.dot(fwd) > 0.5
    this.hp -= dmg * (this.rearHit ? 2 : 1)
    if (this.breakT <= 0) {
      this.breakT = 1.4
      this.breakDir.crossVectors(fwd, UP).normalize().multiplyScalar(Math.random() < 0.5 ? -1 : 1).addScaledVector(UP, (Math.random() - 0.3) * 0.6).normalize()
    }
    if (this.hp <= 0) { this.alive = false; this.killed = true }
  }
}

export class Darts {
  readonly list: Dart[] = []
  readonly mesh: THREE.InstancedMesh
  readonly glow: THREE.InstancedMesh
  /** Fires when a Dart shoots (for sound), with its position. */
  onFire: ((p: THREE.Vector3) => void) | null = null
  constructor(n = 16) {
    for (let i = 0; i < n; i++) this.list.push(new Dart())
    // A dart: a long nose, swept delta wings, twin fins, a hot engine.
    const parts: THREE.BufferGeometry[] = []
    const body = new THREE.ConeGeometry(1.1, 9, 6).rotateX(Math.PI / 2)
    parts.push(body)
    const wing = new THREE.BufferGeometry()
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 2.5, 6.5, -0.2, -3.5, -6.5, -0.2, -3.5, 0, 0, 2.5, -6.5, -0.2, -3.5, 6.5, -0.2, -3.5], 3))
    parts.push(wing)
    for (const s of [-1, 1]) {
      const fin = new THREE.BufferGeometry()
      fin.setAttribute('position', new THREE.Float32BufferAttribute([s * 1.4, 0, -1.5, s * 2.2, 2.6, -4.2, s * 1.4, 0, -4.4, s * 1.4, 0, -1.5, s * 1.4, 0, -4.4, s * 2.2, 2.6, -4.2], 3))
      parts.push(fin)
    }
    const geo = mergeAll(parts)
    geo.scale(DART.scale, DART.scale, DART.scale)
    geo.computeVertexNormals()
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.4, metalness: 0.6, emissive: new THREE.Color(0.35, 0.03, 0.02), side: THREE.DoubleSide, flatShading: true })
    this.mesh = new THREE.InstancedMesh(geo, mat, n)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    // The engine and a glint, additive: a red point that reads at 4 km.
    const g2 = new THREE.SphereGeometry(1, 8, 6)
    this.glow = new THREE.InstancedMesh(g2, new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.9, 0.3), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), n)
    this.glow.frustumCulled = false
    this.glow.count = 0
  }

  get alive(): number { let n = 0; for (const d of this.list) if (d.alive) n++; return n }

  /** A flight of n ahead of (pos, heading) at distance dist, around altitude y. */
  spawnFlight(n: number, around: THREE.Vector3, heading: number, dist: number, toward: THREE.Vector3): void {
    const free = this.list.filter((d) => !d.alive).slice(0, n)
    if (!free.length) return
    const cx = around.x + Math.sin(heading) * dist, cz = around.z + Math.cos(heading) * dist
    const cy = Math.max(groundH(cx, cz) + 250, around.y + (Math.random() - 0.3) * 300)
    // Head toward the player, roughly (a head-on opening pass, then the dogfight).
    _a.subVectors(toward, _b.set(cx, cy, cz)).setY(0).normalize()
    const lead = free[0]
    free.forEach((d, i) => {
      d.alive = true; d.dummy = false; d.killed = false; d.hp = DART.hp; d.breakT = 0; d.burstLeft = 0; d.fireCd = 1.5 + Math.random() * 2
      d.leader = i === 0 ? null : lead
      const k = Math.ceil(i / 2), side = i % 2 ? 1 : -1
      d.slot.set(side * 70 * k, 0, -60 * k)
      d.pos.set(cx + side * 70 * k * _a.z, cy, cz - side * 70 * k * _a.x).addScaledVector(_a, -60 * k)
      d.prev.copy(d.pos)
      d.vel.copy(_a).multiplyScalar(2.6 * MACH)
    })
  }

  step(dt: number, me: Shooter, rounds: Rounds, topAt: (x: number, z: number, r: number) => number): void {
    for (const d of this.list) {
      if (!d.alive) continue
      d.prev.copy(d.pos)
      if (d.dummy) { d.pos.addScaledVector(d.vel, dt); continue }
      const fwd = _a.copy(d.vel).normalize()
      // Where it wants to go.
      const want = _b
      if (d.breakT > 0) { d.breakT -= dt; want.copy(d.breakDir) }
      else if (d.leader?.alive) {
        // Hold the slot: a point beside and behind the leader, in the leader's frame.
        const lf = _c.copy(d.leader.vel).normalize()
        const lr = new THREE.Vector3().crossVectors(lf, UP).normalize()
        want.copy(d.leader.pos).addScaledVector(lr, d.slot.x).addScaledVector(lf, d.slot.z).sub(d.pos)
        const dist = want.length()
        want.normalize().multiplyScalar(Math.min(1, dist / 400)).addScaledVector(lf, 1).normalize()
      } else {
        // Pursue: aim a little ahead of where you will be.
        want.copy(me.pos).addScaledVector(me.vel, 0.8).sub(d.pos).normalize()
      }
      // Keep clear of the ground and rock ahead.
      const look = d.vel.length() * 1.2
      const top = topAt(d.pos.x + fwd.x * look, d.pos.z + fwd.z * look, 200)
      const floor = Math.max(top, groundH(d.pos.x, d.pos.z)) + 90
      if (d.pos.y + fwd.y * look < floor) want.y = Math.max(want.y, 0.7)
      want.normalize()
      // Turn toward it at a limited rate.
      const ang = fwd.angleTo(want)
      const maxTurn = DART.turn * dt * (d.breakT > 0 ? 1.4 : 1)
      const before = fwd.clone()
      if (ang > 1e-5) fwd.lerp(want, Math.min(1, maxTurn / ang)).normalize()
      // Bank into the turn (for drawing).
      const turnSide = before.cross(fwd).y
      d.bank += (THREE.MathUtils.clamp(-turnSide * 40, -1.2, 1.2) - d.bank) * Math.min(1, dt * 4)
      // Speed: keep up with you, within its band.
      const target = THREE.MathUtils.clamp(me.vel.length() * (d.leader ? 1.05 : 0.98), DART.minMach * MACH, DART.maxMach * MACH)
      const sp = d.vel.length() + THREE.MathUtils.clamp(target - d.vel.length(), -150 * dt, 120 * dt)
      d.vel.copy(fwd).multiplyScalar(sp)
      d.pos.addScaledVector(d.vel, dt)
      const g = groundH(d.pos.x, d.pos.z) + 25
      if (d.pos.y < g) { d.pos.y = g; if (d.vel.y < 0) d.vel.y = 0 }
      // Fire: you in its front cone and in range — a 3-round burst, led.
      d.fireCd -= dt
      if (d.burstLeft > 0) {
        d.burstT -= dt
        if (d.burstT <= 0) {
          d.burstT = DART.burstGap
          d.burstLeft--
          const shooter: Shooter = { pos: d.pos, vel: d.vel, fwd, right: _c.crossVectors(fwd, UP).normalize(), up: UP }
          const dir = leadDir(shooter, me, DART.roundSpeed, new THREE.Vector3()) ?? fwd.clone()
          // A little scatter: the lead is not perfect.
          dir.x += (Math.random() - 0.5) * 0.012; dir.y += (Math.random() - 0.5) * 0.012; dir.z += (Math.random() - 0.5) * 0.012
          rounds.spawn(d.pos.clone().addScaledVector(fwd, 14), d.vel.clone().addScaledVector(dir.normalize(), DART.roundSpeed), DART.roundLife, false, DART.dmg)
          this.onFire?.(d.pos)
        }
      } else if (d.fireCd <= 0) {
        const to = _c.subVectors(me.pos, d.pos)
        const dist = to.length()
        if (dist < DART.range && to.normalize().angleTo(fwd) < (DART.cone * Math.PI) / 180) {
          d.burstLeft = DART.burst; d.burstT = 0; d.fireCd = 2.5 + Math.random()
        }
      }
    }
  }

  draw(alpha: number, cam: THREE.Vector3): void {
    let k = 0
    for (const d of this.list) {
      if (!d.alive) continue
      _a.lerpVectors(d.prev, d.pos, alpha)
      _q.setFromUnitVectors(Z, _b.copy(d.vel).normalize())
      _q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, d.bank))
      _m.compose(_a, _q, _s.set(1, 1, 1))
      this.mesh.setMatrixAt(k, _m)
      _c.copy(_a).addScaledVector(_b, -11 * DART.scale)
      // The glint grows with distance (about 5 px on screen far off): a red point you can find at 4 km.
      const gs = Math.max(2.2, _c.distanceTo(cam) * 0.005)
      _m.compose(_c, _q, _s.set(gs, gs, gs))
      this.glow.setMatrixAt(k, _m)
      k++
    }
    this.mesh.count = k; this.glow.count = k
    this.mesh.instanceMatrix.needsUpdate = true; this.glow.instanceMatrix.needsUpdate = true
  }

  clear(): void { for (const d of this.list) { d.alive = false; d.killed = false } this.mesh.count = 0; this.glow.count = 0 }
  shift(dx: number, dz: number): void { for (const d of this.list) if (d.alive) { d.pos.x += dx; d.pos.z += dz; d.prev.x += dx; d.prev.z += dz } }
}

/** Merge non-indexed position-only geometries. */
function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = []
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p
    pos.push(...(g.attributes.position.array as Float32Array))
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return out
}
