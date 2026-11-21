// Combat at Mach 5: enemy drones flown in the player's own frame (they keep pace, weave, overtake,
// fire back), head-on passers, homing missiles that corkscrew, red tracer bolts, the walker's plasma
// orbs, and the soft lock. Fixed-step sim with prev/pos for interpolation; instanced draws.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { CFG, MACH } from './config'
import { groundH } from './terrain'
import { patchStandard } from './shaders'
import type { Fx } from './particles'
import { resetE } from './particles'
import type { Player } from './player'
import type { Sound } from './audio'

export interface Target {
  pos: THREE.Vector3
  prev: THREE.Vector3
  vel: THREE.Vector3
  alive: boolean
  radius: number
  kind: 'drone' | 'core'
  hit(dmg: number): void
}

export interface Ctx {
  player: Player
  fx: Fx
  audio: Sound
  hurt(dmg: number, x: number, y: number, z: number, kind: 'bolt' | 'orb'): void
  scored(points: number, label: string): void
  shake(t: number): void
  /** Other lock targets (the walker's cores). */
  extraTargets(): readonly Target[]
  waveStart?(wave: number): void
  waveCleared?(wave: number): void
  runner?(): void
  escaped?(): void
  /** Steer side (−1 … 1) to clear rock ahead of (x, z) moving along (dx, dz) at v; 0 when clear. */
  avoid?(x: number, z: number, dx: number, dz: number, v: number): number
}

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _x = new THREE.Vector3()
const _y = new THREE.Vector3()
const _z = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

/** Distance from the origin to segment a→b. */
function segDist(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = bx - ax, dy = by - ay, dz = bz - az
  const L = dx * dx + dy * dy + dz * dz
  let t = L > 1e-9 ? -(ax * dx + ay * dy + az * dz) / L : 0
  t = Math.max(0, Math.min(1, t))
  const x = ax + dx * t, y = ay + dy * t, z = az + dz * t
  return Math.sqrt(x * x + y * y + z * z)
}

/** Set m to a basis looking along f (unit) with roll, at p. */
function orient(m: THREE.Matrix4, f: THREE.Vector3, roll: number, p: THREE.Vector3, s: number): void {
  _z.copy(f)
  _x.crossVectors(UP, _z)
  if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0)
  _x.normalize()
  _y.crossVectors(_z, _x)
  const c = Math.cos(roll), sn = Math.sin(roll)
  // Roll about z.
  const xx = _x.x * c + _y.x * sn, xy = _x.y * c + _y.y * sn, xz = _x.z * c + _y.z * sn
  const yx = _y.x * c - _x.x * sn, yy = _y.y * c - _x.y * sn, yz = _y.z * c - _x.z * sn
  m.set(
    xx * s, yx * s, _z.x * s, p.x,
    xy * s, yy * s, _z.y * s, p.y,
    xz * s, yz * s, _z.z * s, p.z,
    0, 0, 0, 1,
  )
}

class Drone implements Target {
  readonly pos = new THREE.Vector3()
  readonly prev = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  alive = false
  /** Falling wreck after death. */
  wreck = false
  radius = 10
  kind = 'drone' as const
  mode: 'hold' | 'pass' | 'run' = 'hold'
  /** Runner: the heading it flees along, and its own speed. */
  runH = 0
  runV = 0
  ox = 0; oz = 0; oy = 0
  phase = 0
  t = 0
  fireT = 0
  bank = 0
  spin = 0
  hp = 1
  passed = false
  onHit: (d: Drone) => void = () => {}
  hit(dmg: number): void {
    this.hp -= dmg
    if (this.hp <= 0 && this.alive) this.onHit(this)
  }
}

interface Missile {
  on: boolean
  pos: THREE.Vector3
  prev: THREE.Vector3
  vel: THREE.Vector3
  target: Target | null
  age: number
  ph: number
  rpos: THREE.Vector3
}

interface Shot {
  on: boolean
  pos: THREE.Vector3
  prev: THREE.Vector3
  vel: THREE.Vector3
  life: number
  orb: boolean
}

export class Combat {
  readonly group = new THREE.Group()
  readonly drones: Drone[] = []
  private readonly missiles: Missile[] = []
  private readonly shots: Shot[] = []
  private readonly hullMesh: THREE.InstancedMesh
  private readonly glowMesh: THREE.InstancedMesh
  private readonly missileMesh: THREE.InstancedMesh
  private readonly boltMesh: THREE.InstancedMesh
  private readonly orbMesh: THREE.InstancedMesh
  // Lock.
  lockTarget: Target | null = null
  lockProgress = 0
  locked = false
  private fireCool = 0
  private rail = 1
  private spawnT = 4
  private passT = 14
  enabled = false
  kills = 0
  /** How many hold-drones to keep up at once. */
  pressure = 3
  wave = 0
  readonly queue = { hold: 0, pass: 0, run: 0 }
  private breather = 0
  private runT = 0
  /** Waves wait while the walker is up. */
  paused = false
  queueEmpty(): boolean { return this.queue.hold + this.queue.pass + this.queue.run === 0 }
  aliveCount(): number { return this.drones.reduce((n, d) => n + (d.alive ? 1 : 0), 0) }
  /** Left in this wave: queued + alive. */
  left(): number { return this.queue.hold + this.queue.pass + this.queue.run + this.aliveCount() }
  private readonly targets: Target[] = []

  constructor(private readonly ctx: Ctx) {
    // Drone: a dark arrowhead with forward-swept wings, a red eye and a red engine.
    const body = new THREE.OctahedronGeometry(1, 0)
    body.scale(1.3, 0.65, 3.6)
    const wingL = new THREE.BoxGeometry(5.2, 0.16, 1.5)
    wingL.translate(-2.7, 0, 0)
    wingL.rotateY(-0.35)
    const wingR = new THREE.BoxGeometry(5.2, 0.16, 1.5)
    wingR.translate(2.7, 0, 0)
    wingR.rotateY(0.35)
    const tail = new THREE.BoxGeometry(0.15, 1.4, 1.8)
    tail.translate(0, 0.7, -2.4)
    const hullGeo = mergeGeometries([body.toNonIndexed(), wingL.toNonIndexed(), wingR.toNonIndexed(), tail.toNonIndexed()])
    hullGeo.computeVertexNormals()
    const eye = new THREE.SphereGeometry(0.55, 10, 8)
    eye.translate(0, 0.2, 2.6)
    const eng = new THREE.CylinderGeometry(0.55, 0.3, 0.6, 10)
    eng.rotateX(Math.PI / 2)
    eng.translate(0, 0, -3.5)
    const tips = [-5, 5].map((x) => { const g = new THREE.BoxGeometry(0.4, 0.2, 0.9); g.translate(x, 0, -0.9 + Math.abs(x) * 0.0); return g })
    const glowGeo = mergeGeometries([eye, eng, ...tips].map((g) => (g.index ? g.toNonIndexed() : g)))
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.4, metalness: 0.7, flatShading: true })
    patchStandard(hullMat)
    this.hullMesh = new THREE.InstancedMesh(hullGeo, hullMat, 14)
    this.glowMesh = new THREE.InstancedMesh(glowGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 0.6, 0.35) }), 14)
    for (const m of [this.hullMesh, this.glowMesh]) { m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage) }
    this.group.add(this.hullMesh, this.glowMesh)
    for (let i = 0; i < 14; i++) {
      const d = new Drone()
      d.onHit = (dd) => this.droneDown(dd)
      this.drones.push(d)
    }

    const mg = new THREE.CylinderGeometry(0.22, 0.28, 2.6, 8)
    mg.rotateX(Math.PI / 2)
    const missileMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, metalness: 0.3 })
    patchStandard(missileMat)
    this.missileMesh = new THREE.InstancedMesh(mg, missileMat, 24)
    this.missileMesh.frustumCulled = false
    this.missileMesh.count = 0
    this.group.add(this.missileMesh)
    for (let i = 0; i < 24; i++) this.missiles.push({ on: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), target: null, age: 0, ph: 0, rpos: new THREE.Vector3() })

    const bg = new THREE.CylinderGeometry(0.5, 0.5, 1, 6)
    bg.rotateX(Math.PI / 2)
    this.boltMesh = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({ color: new THREE.Color(12, 1.2, 0.6) }), 80)
    this.boltMesh.frustumCulled = false
    this.boltMesh.count = 0
    const og = new THREE.IcosahedronGeometry(1, 2)
    this.orbMesh = new THREE.InstancedMesh(og, new THREE.MeshBasicMaterial({ color: new THREE.Color(10, 4.5, 14) }), 40)
    this.orbMesh.frustumCulled = false
    this.orbMesh.count = 0
    this.group.add(this.boltMesh, this.orbMesh)
    for (let i = 0; i < 80; i++) this.shots.push({ on: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, orb: false })
  }

  reset(): void {
    for (const d of this.drones) { d.alive = false; d.wreck = false }
    for (const m of this.missiles) m.on = false
    for (const s of this.shots) s.on = false
    this.lockTarget = null
    this.lockProgress = 0
    this.locked = false
    this.kills = 0
    this.spawnT = 5
    this.passT = 16
    this.pressure = 3
    this.wave = 0
    this.queue.hold = this.queue.pass = this.queue.run = 0
    this.breather = 0
    this.paused = false
  }

  shift(dx: number, dz: number): void {
    for (const d of this.drones) { d.pos.x += dx; d.pos.z += dz; d.prev.x += dx; d.prev.z += dz }
    for (const m of this.missiles) { m.pos.x += dx; m.pos.z += dz; m.prev.x += dx; m.prev.z += dz }
    for (const s of this.shots) { s.pos.x += dx; s.pos.z += dz; s.prev.x += dx; s.prev.z += dz }
  }

  private spawn(mode: 'hold' | 'pass' | 'run', lane: number): void {
    const d = this.drones.find((q) => !q.alive && !q.wreck)
    if (!d) return
    const p = this.ctx.player
    d.alive = true
    d.wreck = false
    d.hp = 1
    d.mode = mode
    d.t = 0
    d.phase = Math.random() * 6.28
    d.fireT = 1.5 + Math.random() * 1.5
    d.passed = false
    if (mode === 'hold') {
      d.ox = (Math.random() - 0.5) * 700
      d.oz = 700 + Math.random() * 900
      d.oy = 25 + Math.random() * 70
      // Enters from behind and overtakes.
      _v.copy(p.pos).addScaledVector(p.fwd, -700 - Math.random() * 300).addScaledVector(p.right, d.ox * 0.6 + lane * 80)
      _v.y = groundH(_v.x, _v.z) + d.oy + 30
      d.pos.copy(_v)
      d.vel.copy(p.vel).addScaledVector(p.fwd, 500)
    } else if (mode === 'run') {
      // A runner: well ahead, already fleeing, a little faster than you. Chase it down.
      d.runH = p.heading + (Math.random() - 0.5) * 0.5
      d.runV = Math.max(p.speed * 1.06, 3.2 * MACH)
      _v.copy(p.pos).addScaledVector(p.fwd, 2200 + Math.random() * 1200).addScaledVector(p.right, (Math.random() - 0.5) * 1200)
      _v.y = groundH(_v.x, _v.z) + 18
      d.pos.copy(_v)
      d.vel.set(Math.sin(d.runH) * d.runV, 0, Math.cos(d.runH) * d.runV)
      d.hp = 2
    } else {
      // Head-on, a few hundred metres to one side: a pass you can lock and hit, or dodge.
      const off = (lane - 1) * 70 + (Math.random() - 0.5) * 60
      _v.copy(p.pos).addScaledVector(p.fwd, 7000).addScaledVector(p.right, off)
      _v.y = groundH(_v.x, _v.z) + 14 + Math.random() * 30
      d.pos.copy(_v)
      d.vel.copy(p.fwd).multiplyScalar(-Math.max(1.4 * MACH, 0.6 * p.speed))
    }
    d.prev.copy(d.pos)
  }

  private droneDown(d: Drone): void {
    d.alive = false
    d.wreck = true
    d.spin = (Math.random() - 0.5) * 8
    this.kills++
    const p = this.ctx.player
    this.ctx.fx.explosion(d.pos.x, d.pos.y, d.pos.z, d.vel.x, d.vel.y, d.vel.z, 1.2)
    const dist = d.pos.distanceTo(p.pos)
    this.ctx.audio.explosion(dist, 1)
    this.ctx.shake(Math.max(0.15, 0.55 - dist / 3000))
    const run = d.mode === 'run'
    const pts = Math.round((run ? 300 : 100) * Math.max(1, p.mach))
    this.ctx.scored(pts, `${run ? 'RUNNER' : 'DRONE'} DOWN  ×${p.mach.toFixed(1)}`)
    if (this.lockTarget === d) { this.lockTarget = null; this.locked = false; this.lockProgress = 0 }
  }

  fire(): void {
    if (this.fireCool > 0) return
    const m = this.missiles.find((q) => !q.on)
    if (!m) return
    this.fireCool = CFG.combat.fireCooldown
    const p = this.ctx.player
    this.rail = -this.rail
    m.on = true
    m.age = 0
    m.ph = Math.random() * 6.28
    m.target = this.locked ? this.lockTarget : null
    m.pos.copy(p.pos).addScaledVector(p.right, this.rail * 2.2).addScaledVector(p.fwd, 1)
    m.pos.y -= 0.6
    m.prev.copy(m.pos)
    m.vel.copy(p.vel).addScaledVector(p.right, this.rail * 25)
    m.vel.y -= 8
    this.ctx.audio.missile()
  }

  /** Walker cannon: a heavy, slow plasma orb. */
  fireOrb(from: THREE.Vector3, vel: THREE.Vector3): void {
    const s = this.shots.find((q) => !q.on)
    if (!s) return
    s.on = true
    s.orb = true
    s.life = 9
    s.pos.copy(from)
    s.prev.copy(from)
    s.vel.copy(vel)
  }

  private fireBolt(d: Drone): void {
    const s = this.shots.find((q) => !q.on)
    if (!s) return
    const p = this.ctx.player
    s.on = true
    s.orb = false
    s.life = 3
    s.pos.copy(d.pos)
    s.prev.copy(d.pos)
    // Lead the player a little, sloppily.
    const relSpeed = 950
    const dist = d.pos.distanceTo(p.pos)
    const tt = dist / relSpeed
    _v.copy(p.pos).addScaledVector(p.right, p.lateral * tt * 0.5).add(_w.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 14))
    _v.sub(d.pos).normalize()
    s.vel.copy(p.vel).addScaledVector(_v, relSpeed)
    this.ctx.audio.bolt(dist)
  }

  step(dt: number, firing: boolean): void {
    const p = this.ctx.player
    this.fireCool -= dt

    // ── director: waves ──
    // Each wave queues drones that hold ahead and shoot, head-on passers, and runners (flee, never
    // shoot, worth triple — chase them). A wave is cleared when its queue is empty and nothing is
    // left in the air; a breather, then the next, bigger one.
    if (this.enabled && !p.dead && !this.paused) {
      if (this.wave === 0 || (this.queueEmpty() && this.aliveCount() === 0)) {
        if (this.wave > 0 && this.breather <= 0) { this.breather = 3.5; this.ctx.waveCleared?.(this.wave) }
        this.breather -= dt
        if (this.breather <= 0 || this.wave === 0) {
          this.wave++
          this.queue.hold = 2 + this.wave
          this.queue.pass = this.wave >= 2 ? this.wave : 0
          this.queue.run = 1 + Math.floor(this.wave / 2)
          this.breather = 0
          this.spawnT = 1.5
          this.passT = 6
          this.runT = 3
          this.ctx.waveStart?.(this.wave)
        }
      } else {
        this.spawnT -= dt
        const holding = this.drones.reduce((n, d) => n + (d.alive && d.mode === 'hold' ? 1 : 0), 0)
        if (this.queue.hold > 0 && this.spawnT <= 0 && holding < this.pressure) {
          const n = Math.min(this.queue.hold, this.pressure - holding, 2)
          for (let i = 0; i < n; i++) this.spawn('hold', i)
          this.queue.hold -= n
          this.spawnT = 4 + Math.random() * 3
          this.ctx.audio.flyby(0.7)
        }
        this.passT -= dt
        if (this.queue.pass > 0 && this.passT <= 0 && p.mach > 1.2) {
          const n = Math.min(this.queue.pass, 2)
          for (let i = 0; i < n; i++) this.spawn('pass', i)
          this.queue.pass -= n
          this.passT = 9 + Math.random() * 5
        }
        this.runT -= dt
        if (this.queue.run > 0 && this.runT <= 0) {
          this.spawn('run', 0)
          this.queue.run--
          this.runT = 8 + Math.random() * 4
          this.ctx.runner?.()
        }
      }
    }

    // ── drones ──
    for (const d of this.drones) {
      if (!d.alive && !d.wreck) continue
      d.prev.copy(d.pos)
      d.t += dt
      if (d.wreck) {
        d.vel.multiplyScalar(Math.exp(-0.9 * dt))
        d.vel.y -= 40 * dt
        d.bank += d.spin * dt
        d.pos.addScaledVector(d.vel, dt)
        const g = groundH(d.pos.x, d.pos.z)
        if (d.pos.y < g + 2) {
          d.wreck = false
          this.ctx.fx.explosion(d.pos.x, g + 3, d.pos.z, d.vel.x * 0.3, 0, d.vel.z * 0.3, 0.9)
          this.ctx.fx.dust(d.pos.x, g, d.pos.z, d.vel.x * 0.2, d.vel.z * 0.2, 14, 26, 40)
          this.ctx.audio.explosion(d.pos.distanceTo(p.pos), 0.6)
        }
        continue
      }
      if (d.mode === 'run') {
        // Fleeing: weaves, swerves round rock, speeds up when you close in; gone past 12 km.
        _v.subVectors(d.pos, p.pos)
        const dist = _v.length()
        const panic = dist < 900 ? 1.12 : dist < 2000 ? 1.05 : 1
        const target = Math.min(5.6 * MACH, Math.max(3.2 * MACH, p.speed * 1.04)) * panic
        d.runV += (target - d.runV) * Math.min(1, dt * 0.8)
        const dodge = this.ctx.avoid ? this.ctx.avoid(d.pos.x, d.pos.z, Math.sin(d.runH), Math.cos(d.runH), d.runV) : 0
        d.runH += (Math.sin(d.t * 0.7 + d.phase) * 0.18 + dodge * 0.9) * dt
        d.vel.set(Math.sin(d.runH) * d.runV, 0, Math.cos(d.runH) * d.runV)
        const g = groundH(d.pos.x, d.pos.z)
        d.vel.y = (g + 18 + Math.sin(d.t * 1.7) * 6 - d.pos.y) * 3
        d.bank = -dodge * 0.6 + Math.sin(d.t * 0.7 + d.phase) * 0.25
        if (dist > 12000) { d.alive = false; this.ctx.escaped?.() }
      } else if (d.mode === 'hold') {
        // Where it wants to be, in the player's frame.
        const wx = d.ox + Math.sin(d.t * 0.8 + d.phase) * 160
        const wy = d.oy + Math.sin(d.t * 1.3 + d.phase * 2) * 14
        _v.copy(p.pos).addScaledVector(p.fwd, d.oz).addScaledVector(p.right, wx)
        _v.y = Math.max(groundH(_v.x, _v.z), groundH(d.pos.x, d.pos.z)) + wy
        _w.subVectors(_v, d.pos).multiplyScalar(1.4)
        const L = _w.length()
        if (L > 650) _w.multiplyScalar(650 / L)
        _w.add(p.vel)
        // Steer the velocity toward it, hard.
        const a = 1 - Math.exp(-3.2 * dt)
        const lat0 = d.vel.dot(p.right)
        d.vel.lerp(_w, a)
        d.bank += (THREE.MathUtils.clamp((d.vel.dot(p.right) - lat0) / dt / 400, -1.1, 1.1) - d.bank) * Math.min(1, dt * 4)
        // Fire back while ahead.
        _v.subVectors(d.pos, p.pos)
        const ahead = _v.dot(p.fwd)
        d.fireT -= dt
        if (d.fireT <= 0 && ahead > 150 && ahead < 2600 && !p.dead) {
          this.fireBolt(d)
          d.fireT = 1.3 + Math.random() * 1.6
        }
        // Lost far behind (the player out-turned it): gone.
        if (ahead < -3500 || _v.lengthSq() > 9000 * 9000) d.alive = false
      } else {
        // Passer: straight, then gone behind.
        _v.subVectors(d.pos, p.pos)
        const ahead = _v.dot(p.fwd)
        d.fireT -= dt
        if (d.fireT <= 0 && ahead > 600 && ahead < 3500) { this.fireBolt(d); d.fireT = 0.7 + Math.random() }
        if (!d.passed && ahead < 0) {
          d.passed = true
          const dist = _v.length()
          if (dist < 400) { this.ctx.audio.flyby(1 - dist / 400); this.ctx.shake(0.25) }
        }
        if (ahead < -2500) d.alive = false
        const g = groundH(d.pos.x, d.pos.z)
        d.vel.y += ((g + 22 - d.pos.y) * 2 - d.vel.y) * Math.min(1, dt * 3)
        d.bank = Math.sin(d.t * 2 + d.phase) * 0.4
      }
      d.pos.addScaledVector(d.vel, dt)
    }

    // ── lock ──
    this.targets.length = 0
    for (const d of this.drones) if (d.alive) this.targets.push(d)
    for (const t of this.ctx.extraTargets()) if (t.alive) this.targets.push(t)
    let best: Target | null = null
    let bestA = CFG.combat.lockCone
    for (const t of this.targets) {
      _v.subVectors(t.pos, p.pos)
      const dist = _v.length()
      if (dist > CFG.combat.lockRange || dist < 40) continue
      const a = Math.acos(THREE.MathUtils.clamp(_v.dot(p.fwd) / dist, -1, 1))
      // Prefer the one already being locked (no flicker between two).
      const bias = t === this.lockTarget ? 0.08 : 0
      if (a - bias < bestA) { bestA = a - bias; best = t }
    }
    if (best !== this.lockTarget) {
      this.lockTarget = best
      this.lockProgress = 0
      this.locked = false
    }
    if (best && !p.dead) {
      this.lockProgress = Math.min(1, this.lockProgress + dt / CFG.combat.lockTime)
      if (!this.locked && this.lockProgress >= 1) { this.locked = true; this.ctx.audio.locked() }
    }

    if (firing && !p.dead) this.fire()

    // ── missiles ──
    for (const m of this.missiles) {
      if (!m.on) continue
      m.prev.copy(m.pos)
      m.age += dt
      const t = m.target && m.target.alive ? m.target : null
      if (m.age > 0.12) {
        const baseSpeed = (t ? t.vel.length() : p.speed) + CFG.combat.missileRelSpeed
        let dir: THREE.Vector3
        if (t) {
          // Lead: aim where it will be.
          _v.subVectors(t.pos, m.pos)
          const tt = _v.length() / CFG.combat.missileRelSpeed
          _v.addScaledVector(t.vel, tt * 0.6).normalize()
          dir = _v
        } else {
          dir = _v.copy(m.vel).normalize()
        }
        const sp = Math.min(m.vel.length() + CFG.combat.missileAccel * dt, baseSpeed)
        _w.copy(m.vel).normalize()
        _w.lerp(dir, 1 - Math.exp(-CFG.combat.missileTurn * dt)).normalize()
        m.vel.copy(_w).multiplyScalar(sp)
      } else {
        m.vel.y -= 30 * dt
      }
      m.pos.addScaledVector(m.vel, dt)
      if (t) {
        const hd = segDist(m.prev.x - t.prev.x, m.prev.y - t.prev.y, m.prev.z - t.prev.z, m.pos.x - t.pos.x, m.pos.y - t.pos.y, m.pos.z - t.pos.z)
        if (hd < t.radius) {
          m.on = false
          if (t.kind === 'core') this.ctx.fx.explosion(m.pos.x, m.pos.y, m.pos.z, t.vel.x, t.vel.y, t.vel.z, 1.4)
          t.hit(1)
          continue
        }
      }
      if (m.age > 6 || m.pos.y < groundH(m.pos.x, m.pos.z)) {
        m.on = false
        this.ctx.fx.explosion(m.pos.x, m.pos.y + 2, m.pos.z, m.vel.x * 0.1, 0, m.vel.z * 0.1, 0.5)
      }
    }

    // ── bolts and orbs ──
    for (const s of this.shots) {
      if (!s.on) continue
      s.prev.copy(s.pos)
      s.life -= dt
      s.pos.addScaledVector(s.vel, dt)
      const r = s.orb ? 20 : 5.5
      if (!p.dead) {
        const hd = segDist(s.prev.x - p.prev.x, s.prev.y - p.prev.y, s.prev.z - p.prev.z, s.pos.x - p.pos.x, s.pos.y - p.pos.y, s.pos.z - p.pos.z)
        if (hd < r) {
          s.on = false
          this.ctx.hurt(s.orb ? 28 : 7, s.pos.x, s.pos.y, s.pos.z, s.orb ? 'orb' : 'bolt')
          continue
        }
        // Near miss of an orb: a whump and a shake (the threat is felt).
        if (s.orb && hd < 90 && s.life > 0) {
          const near = 1 - hd / 90
          this.ctx.shake(near * 0.03)
        }
      }
      const g = groundH(s.pos.x, s.pos.z)
      if (s.life <= 0 || s.pos.y < g) {
        s.on = false
        if (s.orb) {
          this.ctx.fx.explosion(s.pos.x, Math.max(s.pos.y, g + 4), s.pos.z, 0, 0, 0, 1.5)
          this.ctx.fx.dust(s.pos.x, g, s.pos.z, 0, 0, 16, 40, 50)
          this.ctx.audio.explosion(s.pos.distanceTo(p.pos), 0.8)
        }
      }
    }
  }

  /** Interpolated draw + trailing particles. alpha: 0 … 1 between prev and pos. */
  render(alpha: number, dt: number, time: number): void {
    const fx = this.ctx.fx
    let n = 0
    for (const d of this.drones) {
      if (!d.alive && !d.wreck) continue
      _v.lerpVectors(d.prev, d.pos, alpha)
      _w.copy(d.vel).normalize()
      orient(_m, _w, d.bank, _v, 1.4)
      this.hullMesh.setMatrixAt(n, _m)
      this.glowMesh.setMatrixAt(n, _m)
      n++
      if (d.wreck) {
        const e = resetE()
        e.x = _v.x; e.y = _v.y; e.z = _v.z
        e.vx = d.vel.x * 0.6; e.vy = d.vel.y * 0.6 + 8; e.vz = d.vel.z * 0.6
        e.life = 1.8; e.size0 = 4; e.size1 = 16
        e.r = 0.05; e.g = 0.045; e.b = 0.04; e.a = 0.7; e.r1 = 2.5; e.g1 = 2.4; e.b1 = 2.3; e.drag = 2.5
        fx.smoke.emit(e)
        const f = resetE()
        f.x = _v.x; f.y = _v.y; f.z = _v.z; f.vx = d.vel.x * 0.9; f.vy = d.vel.y * 0.9; f.vz = d.vel.z * 0.9
        f.life = 0.25; f.size0 = 5; f.size1 = 2; f.r = 8; f.g = 3; f.b = 1; f.a = 1; f.drag = 3
        fx.glow.emit(f)
      }
    }
    this.hullMesh.count = n
    this.glowMesh.count = n
    this.hullMesh.instanceMatrix.needsUpdate = true
    this.glowMesh.instanceMatrix.needsUpdate = true

    n = 0
    for (const m of this.missiles) {
      if (!m.on) continue
      _v.lerpVectors(m.prev, m.pos, alpha)
      _w.copy(m.vel).normalize()
      // Corkscrew: a visual offset around the flight line, widest mid-flight.
      const t = m.target
      const far = t ? Math.min(1, t.pos.distanceTo(m.pos) / 500) : 0.4
      const amp = 4.5 * far * Math.min(1, m.age * 3)
      _x.crossVectors(UP, _w).normalize()
      _y.crossVectors(_w, _x)
      const a = m.age * 17 + m.ph
      _v.addScaledVector(_x, Math.cos(a) * amp).addScaledVector(_y, Math.sin(a) * amp)
      orient(_m, _w, 0, _v, 1)
      this.missileMesh.setMatrixAt(n++, _m)
      if (m.age > 0.12) {
        // The motor (a hot flare) and a smoke trail laid down between this frame and the last.
        const f = resetE()
        f.x = _v.x - _w.x * 1.6; f.y = _v.y - _w.y * 1.6; f.z = _v.z - _w.z * 1.6
        f.vx = m.vel.x; f.vy = m.vel.y; f.vz = m.vel.z
        f.life = 0.06; f.size0 = 3.2; f.size1 = 2.2; f.r = 10; f.g = 6; f.b = 3; f.a = 1
        fx.glow.emit(f)
        const steps = 3
        for (let i = 0; i < steps; i++) {
          const k = i / steps
          const e = resetE()
          e.x = _v.x - m.vel.x * dt * k; e.y = _v.y - m.vel.y * dt * k; e.z = _v.z - m.vel.z * dt * k
          e.vx = m.vel.x * 0.25; e.vy = m.vel.y * 0.25 + 3; e.vz = m.vel.z * 0.25
          e.life = 1.3; e.size0 = 1.4; e.size1 = 7
          e.r = 0.85; e.g = 0.82; e.b = 0.8; e.a = 0.5; e.drag = 3
          fx.smoke.emit(e)
        }
      }
    }
    this.missileMesh.count = n
    this.missileMesh.instanceMatrix.needsUpdate = true

    let nb = 0
    let no = 0
    for (const s of this.shots) {
      if (!s.on) continue
      _v.lerpVectors(s.prev, s.pos, alpha)
      if (s.orb) {
        const pulse = 1 + 0.15 * Math.sin(time * 30 + s.life * 7)
        _m.makeScale(9 * pulse, 9 * pulse, 9 * pulse).setPosition(_v)
        this.orbMesh.setMatrixAt(no++, _m)
        const e = resetE()
        e.x = _v.x; e.y = _v.y; e.z = _v.z; e.vx = s.vel.x * 0.7; e.vy = s.vel.y * 0.7; e.vz = s.vel.z * 0.7
        e.life = 0.35; e.size0 = 34; e.size1 = 18; e.r = 3; e.g = 1.2; e.b = 4.5; e.a = 1; e.drag = 3
        fx.glow.emit(e)
      } else {
        // A stretched tracer, its length along its velocity relative to the player.
        _w.copy(s.vel).sub(this.ctx.player.vel)
        const L = _w.length()
        _w.multiplyScalar(1 / (L || 1))
        orient(_m, _w, 0, _v, 1)
        const len = 24
        _m.scale(_y.set(1, 1, len))
        this.boltMesh.setMatrixAt(nb++, _m)
      }
    }
    this.boltMesh.count = nb
    this.orbMesh.count = no
    this.boltMesh.instanceMatrix.needsUpdate = true
    this.orbMesh.instanceMatrix.needsUpdate = true
  }
}
