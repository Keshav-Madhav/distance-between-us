// HUNT phase 2 weapons (docs/HUNT-FLIGHT-PLAN.md §3.2):
//   Rounds   — one pool for everyone's bullets (yours cyan-white, theirs red), instanced streaks.
//   Cannon   — 12 rounds/s from alternating wing roots, inheriting your velocity (+2,600 m/s), live
//              0.9 s. Heat: 3 s of steady fire locks it out for 1.2 s. A slight aim assist (2°) bends
//              rounds toward the lead point of a target near it — forgiving, never a substitute.
//   Missiles — hold to paint (a 16° box: 0.3 s on a target = a lock, up to 4), release to ripple-fire
//              one per lock. A rack of 8, one back every 1.6 s. They arm after 250 m.
//   lead()   — where to aim so a round meets a moving target: the pipper.
import * as THREE from 'three'

export interface Target {
  pos: THREE.Vector3
  vel: THREE.Vector3
  alive: boolean
  radius: number
  /** A hit: damage, and the direction the hit came from (rear-cone hits count double inside). */
  hit(dmg: number, dir: THREE.Vector3): void
}

export interface Shooter { pos: THREE.Vector3; vel: THREE.Vector3; fwd: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 }

/** Time for a round (speed s relative to the shooter) to meet a target at relative position r moving
 *  at relative velocity v; NaN if it never can. Smallest positive root of |r + v t| = s t. */
export function interceptT(r: THREE.Vector3, v: THREE.Vector3, s: number): number {
  const a = v.dot(v) - s * s, b = 2 * r.dot(v), c = r.dot(r)
  if (Math.abs(a) < 1e-6) return b < 0 ? -c / b : NaN
  const d = b * b - 4 * a * c
  if (d < 0) return NaN
  const q = Math.sqrt(d)
  const t1 = (-b - q) / (2 * a), t2 = (-b + q) / (2 * a)
  const t = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity)
  return Number.isFinite(t) ? t : NaN
}

const _r = new THREE.Vector3(), _v = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3()
const Z = new THREE.Vector3(0, 0, 1)

/** The aim direction (unit) that leads target t for rounds at speed s from shooter p; null if none. */
export function leadDir(p: Shooter, t: { pos: THREE.Vector3; vel: THREE.Vector3 }, s: number, out: THREE.Vector3): THREE.Vector3 | null {
  _r.subVectors(t.pos, p.pos)
  _v.subVectors(t.vel, p.vel)
  const tt = interceptT(_r, _v, s)
  if (!Number.isFinite(tt) || tt > 3) return null
  return out.copy(_r).addScaledVector(_v, tt).normalize()
}

export interface Round { on: boolean; pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3; life: number; mine: boolean; dmg: number }

export class Rounds {
  readonly items: Round[] = []
  readonly mesh: THREE.InstancedMesh
  private readonly col = new THREE.Color()
  constructor(n = 400) {
    for (let i = 0; i < n; i++) this.items.push({ on: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, mine: false, dmg: 1 })
    const g = new THREE.BoxGeometry(0.5, 0.5, 1)
    g.translate(0, 0, -0.5)
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
  }
  spawn(pos: THREE.Vector3, vel: THREE.Vector3, life: number, mine: boolean, dmg: number): void {
    const r = this.items.find((x) => !x.on)
    if (!r) return
    r.on = true; r.pos.copy(pos); r.prev.copy(pos); r.vel.copy(vel); r.life = life; r.mine = mine; r.dmg = dmg
  }
  /** Move; `hit` tests each round's segment this step and returns true if it struck something. */
  step(dt: number, hit: (r: Round) => boolean): void {
    for (const r of this.items) {
      if (!r.on) continue
      r.prev.copy(r.pos)
      r.pos.addScaledVector(r.vel, dt)
      r.life -= dt
      if (r.life <= 0 || hit(r)) r.on = false
    }
  }
  /** Streaks: from where the round was a frame ago to where it is now (stretched, thin). */
  draw(camPos: THREE.Vector3): void {
    let k = 0
    for (const r of this.items) {
      if (!r.on) continue
      _d.subVectors(r.pos, r.prev)
      const len = Math.max(6, _d.length() * 0.6)
      _q.setFromUnitVectors(Z, _d.normalize())
      const w = Math.min(3.5, 0.6 + r.pos.distanceTo(camPos) * 0.0012) // stays visible far off
      _m.compose(r.pos, _q, _s.set(w, w, len))
      this.mesh.setMatrixAt(k, _m)
      if (r.mine) this.col.setRGB(2.2, 3.2, 4.0); else this.col.setRGB(4.5, 0.6, 0.3)
      this.mesh.setColorAt(k, this.col)
      k++
    }
    this.mesh.count = k
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
  clear(): void { for (const r of this.items) r.on = false; this.mesh.count = 0 }
  shift(dx: number, dz: number): void { for (const r of this.items) if (r.on) { r.pos.x += dx; r.pos.z += dz; r.prev.x += dx; r.prev.z += dz } }
}

export const CANNON = { rate: 12, speed: 2600, life: 0.9, heatMax: 3, lockout: 1.2, cool: 1.5, assistDeg: 2 }

export class Cannon {
  heat = 0
  lockout = 0
  private cd = 0
  private side = 1
  /** Rounds fired since the last read (for sound/flash). */
  fired = 0
  onOverheat: (() => void) | null = null
  step(dt: number, firing: boolean, p: Shooter, target: { pos: THREE.Vector3; vel: THREE.Vector3 } | null, rounds: Rounds): void {
    const C = CANNON
    if (this.lockout > 0) { this.lockout -= dt; this.heat = Math.max(0, this.heat - C.cool * dt); this.cd = 0; return }
    if (!firing) { this.heat = Math.max(0, this.heat - C.cool * dt); this.cd = Math.max(0, this.cd - dt); return }
    this.heat += dt
    if (this.heat >= C.heatMax) { this.heat = C.heatMax; this.lockout = C.lockout; this.onOverheat?.(); return }
    this.cd -= dt
    while (this.cd <= 0) {
      this.cd += 1 / C.rate
      _d.copy(p.fwd)
      // Aim assist: bend toward the lead point when it is within a couple of degrees of the nose.
      if (target && leadDir(p, target, C.speed, _r)) {
        const ang = _d.angleTo(_r), max = (C.assistDeg * Math.PI) / 180
        if (ang < max * 3) _d.lerp(_r, Math.min(1, max / Math.max(ang, 1e-6))).normalize()
      }
      _v.copy(p.vel).addScaledVector(_d, C.speed)
      _s.copy(p.pos).addScaledVector(p.right, 2.2 * this.side).addScaledVector(p.fwd, 5)
      this.side = -this.side
      rounds.spawn(_s, _v, C.life, true, 1)
      this.fired++
    }
  }
  reset(): void { this.heat = 0; this.lockout = 0; this.cd = 0 }
}

export const MISSILE = { rack: 6, reload: 1.6, boxDeg: 16, lockTime: 0.3, maxLocks: 4, arm: 250, life: 6, accel: 600, extra: 900, turn: 2.4, dmg: 3, radius: 22, ripple: 0.1 }

export interface Missile { on: boolean; pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3; target: Target | null; life: number; travelled: number }

export class Missiles {
  rack = MISSILE.rack
  private reloadT = 0
  readonly locks: Target[] = []
  private readonly lockT = new Map<Target, number>()
  painting = false
  private queue: (Target | null)[] = []
  private queueT = 0
  readonly items: Missile[] = []
  readonly mesh: THREE.InstancedMesh
  onLock: ((t: Target) => void) | null = null
  onLaunch: (() => void) | null = null
  constructor() {
    for (let i = 0; i < 24; i++) this.items.push({ on: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), target: null, life: 0, travelled: 0 })
    const g = new THREE.CylinderGeometry(0.5, 0.5, 6, 8).rotateX(Math.PI / 2)
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 2.2), toneMapped: false }), 24)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
  }
  /** Paint while held; fire the locks on release (or one dumb-fire if there are none). */
  step(dt: number, hold: boolean, p: Shooter, targets: readonly Target[], hit: (m: Missile, t: Target) => void): void {
    const M = MISSILE
    if (this.rack < M.rack) { this.reloadT += dt; if (this.reloadT >= M.reload) { this.reloadT = 0; this.rack++ } } else this.reloadT = 0
    if (hold) {
      this.painting = true
      const half = ((M.boxDeg / 2) * Math.PI) / 180
      for (const t of targets) {
        if (!t.alive || this.locks.includes(t)) continue
        _r.subVectors(t.pos, p.pos)
        const d = _r.length()
        if (d > 6000 || _r.normalize().angleTo(p.fwd) > half) { this.lockT.delete(t); continue }
        const k = (this.lockT.get(t) ?? 0) + dt
        this.lockT.set(t, k)
        if (k >= M.lockTime && this.locks.length < Math.min(M.maxLocks, this.rack)) { this.locks.push(t); this.onLock?.(t) }
      }
      for (let i = this.locks.length - 1; i >= 0; i--) if (!this.locks[i].alive) this.locks.splice(i, 1)
    } else if (this.painting) {
      this.painting = false
      if (this.locks.length) this.queue.push(...this.locks)
      else if (this.rack > 0) this.queue.push(null)
      this.locks.length = 0
      this.lockT.clear()
    }
    // Ripple fire.
    this.queueT -= dt
    while (this.queue.length && this.queueT <= 0 && this.rack > 0) {
      const t = this.queue.shift()!
      const m = this.items.find((x) => !x.on)
      if (!m) break
      m.on = true; m.target = t; m.life = M.life; m.travelled = 0
      m.pos.copy(p.pos).addScaledVector(p.up, -2).addScaledVector(p.right, this.rack % 2 ? 2.5 : -2.5)
      m.prev.copy(m.pos)
      m.vel.copy(p.vel).addScaledVector(p.fwd, 60)
      this.rack--
      this.queueT = M.ripple
      this.onLaunch?.()
    }
    if (!this.queue.length) this.queueT = 0
    // Fly: accelerate, turn toward the lead point, arm after 250 m.
    for (const m of this.items) {
      if (!m.on) continue
      m.prev.copy(m.pos)
      const sp = m.vel.length()
      const top = p.vel.length() + M.extra
      const ns = Math.min(top, sp + M.accel * dt)
      _d.copy(m.vel).normalize()
      if (m.target?.alive) {
        _r.subVectors(m.target.pos, m.pos)
        const tt = _r.length() / Math.max(1, ns)
        _r.addScaledVector(m.target.vel, Math.min(2, tt)).normalize()
        const ang = _d.angleTo(_r)
        if (ang > 1e-4) _d.lerp(_r, Math.min(1, (M.turn * dt) / ang)).normalize()
      }
      m.vel.copy(_d).multiplyScalar(ns)
      m.pos.addScaledVector(m.vel, dt)
      // Armed once it is 250 m from you (not 250 m flown: alongside a target at your speed it would
      // "arm" still behind it, and hit point-blank).
      const wasArmed = m.travelled >= M.arm
      m.travelled = Math.max(m.travelled, m.pos.distanceTo(p.pos))
      m.life -= dt
      if (m.life <= 0) { m.on = false; continue }
      if (m.travelled < M.arm) continue
      // Arming with the target already behind (fired point-blank): it flies on, dumb.
      if (!wasArmed && m.target && _r.subVectors(m.target.pos, m.pos).dot(m.vel) < 0) m.target = null
      for (const t of targets) {
        if (!t.alive) continue
        if (segDist(m.prev, m.pos, t.pos) < M.radius + t.radius) { hit(m, t); m.on = false; break }
      }
    }
  }
  draw(): void {
    let k = 0
    for (const m of this.items) {
      if (!m.on) continue
      _q.setFromUnitVectors(Z, _d.copy(m.vel).normalize())
      _m.compose(m.pos, _q, _s.set(1, 1, 1))
      this.mesh.setMatrixAt(k++, _m)
    }
    this.mesh.count = k
    this.mesh.instanceMatrix.needsUpdate = true
  }
  reset(): void { this.rack = MISSILE.rack; this.reloadT = 0; this.locks.length = 0; this.lockT.clear(); this.queue.length = 0; this.painting = false; for (const m of this.items) m.on = false; this.mesh.count = 0 }
  shift(dx: number, dz: number): void { for (const m of this.items) if (m.on) { m.pos.x += dx; m.pos.z += dz; m.prev.x += dx; m.prev.z += dz } }
}

/** Distance from point c to the segment a–b. */
export function segDist(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  _d.subVectors(b, a)
  const l2 = _d.lengthSq()
  const t = l2 > 1e-9 ? THREE.MathUtils.clamp(_v.subVectors(c, a).dot(_d) / l2, 0, 1) : 0
  return _v.copy(a).addScaledVector(_d, t).distanceTo(c)
}
