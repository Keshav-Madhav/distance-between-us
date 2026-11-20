// The craft's simulation: speed model (no brakes to zero; violent boost; the Mach 6 barrier),
// handling (twitchy yaw, drift, strafe/dodge), hover over the dunes, and collisions.
// Runs at a fixed 60 Hz; the renderer interpolates prev → pos.
import * as THREE from 'three'
import { CFG, MACH } from './config'
import { groundH } from './terrain'
import type { Obstacle, World } from './world'

export interface Controls {
  steer: number // -1 left … 1 right
  boost: boolean
  brake: boolean
  strafe: number // -1 … 1
  dodgeL: boolean // edge
  dodgeR: boolean
}

export type BarrierPhase = 'none' | 'silence' | 'boom'

export class Player {
  readonly pos = new THREE.Vector3(0, 4, 0)
  readonly prev = new THREE.Vector3(0, 4, 0)
  readonly vel = new THREE.Vector3()
  readonly fwd = new THREE.Vector3(0, 0, 1)
  readonly right = new THREE.Vector3(-1, 0, 0)
  heading = 0
  prevHeading = 0
  yawRate = 0
  /** Along-heading speed, m/s. */
  speed = 0
  lateral = 0
  vy = 0
  /** Visual: bank and pitch (rad), smoothed in sim. */
  bank = 0
  pitch = 0
  prevBank = 0
  prevPitch = 0
  boost = 0 // 0 … 1, smoothed
  brake = 0
  accel = 0 // m/s² this step (for camera G-force)
  hull = 100
  sinceHurt = 10
  dead = false
  /** Mach 6 barrier: silence (held just under), then the boom. */
  barrier: BarrierPhase = 'none'
  barrierT = 0
  barrierCooldown = 0
  topMach = 0
  /** Fired once per Mach integer crossed upward (1…5); 6 is the barrier. */
  onMach: ((m: number) => void) | null = null
  onBarrier: ((phase: BarrierPhase) => void) | null = null
  onCrash: ((big: boolean, x: number, y: number, z: number, nx: number, nz: number) => void) | null = null
  onBoostStart: (() => void) | null = null
  private wasBoost = false
  private lastMach = 0
  private readonly obs: Obstacle[] = []
  private dodgeCool = 0

  reset(): void {
    this.pos.set(0, groundH(0, 0) + CFG.handling.hover, 0)
    this.prev.copy(this.pos)
    this.heading = this.prevHeading = 0
    this.speed = CFG.speed.launchMach * MACH
    this.lateral = 0
    this.vy = 0
    this.yawRate = 0
    this.bank = this.pitch = this.prevBank = this.prevPitch = 0
    this.hull = 100
    this.dead = false
    this.barrier = 'none'
    this.barrierT = 0
    this.barrierCooldown = 0
    this.topMach = 0
    this.lastMach = 0
    this.updateAxes()
    this.vel.copy(this.fwd).multiplyScalar(this.speed)
  }

  get mach(): number { return this.speed / MACH }

  private updateAxes(): void {
    this.fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading))
    this.right.set(-Math.cos(this.heading), 0, Math.sin(this.heading))
  }

  step(dt: number, c: Controls, world: World): void {
    this.prev.copy(this.pos)
    this.prevHeading = this.heading
    this.prevBank = this.bank
    this.prevPitch = this.pitch
    this.sinceHurt += dt
    if (this.dead) {
      // A wreck sliding to a stop.
      this.speed *= Math.exp(-1.2 * dt)
      this.pos.addScaledVector(this.fwd, this.speed * dt)
      this.pos.y = Math.max(groundH(this.pos.x, this.pos.z) + 0.8, this.pos.y - 20 * dt)
      return
    }
    if (this.sinceHurt > 3) this.hull = Math.min(100, this.hull + 5 * dt)

    const S = CFG.speed
    const H = CFG.handling
    const m = this.speed / MACH

    // ── speed ──
    const boosting = c.boost && this.barrier !== 'silence'
    if (boosting && !this.wasBoost) {
      this.speed += S.boostKick
      this.onBoostStart?.()
    }
    this.wasBoost = c.boost
    this.boost += ((boosting ? 1 : 0) - this.boost) * Math.min(1, dt * 6)
    this.brake += ((c.brake ? 1 : 0) - this.brake) * Math.min(1, dt * 8)
    let target = S.cruiseMach * MACH
    let k = S.cruiseK
    if (c.brake) { target = S.brakeMach * MACH; k = S.brakeK }
    else if (boosting) { target = S.boostMach * MACH; k = S.boostK }
    // Above cruise with no input, coast down slowly (the speed you earned stays a while).
    if (!c.brake && !boosting && this.speed > target) k = 0.12
    const before = this.speed
    this.speed += (target - this.speed) * (1 - Math.exp(-k * dt))
    this.speed -= Math.abs(this.yawRate) * S.turnBleed * this.speed * dt

    // ── the barrier ──
    this.barrierCooldown -= dt
    if (this.barrier === 'none' && this.speed >= 5.88 * MACH && before < 5.88 * MACH && this.barrierCooldown <= 0) {
      this.barrier = 'silence'
      this.barrierT = 0
      this.onBarrier?.('silence')
    }
    if (this.barrier === 'silence') {
      this.speed = Math.min(this.speed, 5.88 * MACH)
      this.barrierT += dt
      if (this.barrierT >= 0.5) {
        this.barrier = 'boom'
        this.barrierT = 0
        this.speed = 6.05 * MACH
        this.onBarrier?.('boom')
      }
    } else if (this.barrier === 'boom') {
      this.barrierT += dt
      if (this.barrierT > 1.2) { this.barrier = 'none'; this.barrierCooldown = 4 }
    }
    if (this.speed < 5.4 * MACH) this.barrierCooldown = Math.min(this.barrierCooldown, 0)
    this.accel = (this.speed - before) / dt

    const mi = Math.floor(this.speed / MACH)
    if (mi > this.lastMach && mi >= 1 && mi <= 5) this.onMach?.(mi)
    this.lastMach = mi
    this.topMach = Math.max(this.topMach, this.speed / MACH)

    // ── steering ──
    const yawMax = THREE.MathUtils.lerp(H.yawLow, H.yawHigh, THREE.MathUtils.clamp((m - 1) / 5, 0, 1))
    const want = -c.steer * yawMax * (1 - 0.35 * this.brake) + -c.steer * 0.35 * this.brake
    this.yawRate += (want - this.yawRate) * (1 - Math.exp(-H.yawResponse * dt))
    this.heading += this.yawRate * dt
    this.updateAxes()

    // Lateral: the old velocity's sideways part drifts out; strafe and dodge push.
    this.dodgeCool -= dt
    if (this.dodgeCool <= 0 && (c.dodgeL || c.dodgeR)) {
      this.lateral += (c.dodgeR ? 1 : -1) * H.dodge
      this.dodgeCool = 0.25
    }
    this.lateral += c.strafe * H.strafe * dt
    this.lateral += this.yawRate * this.speed * 0.12 * dt // slide out of turns
    this.lateral *= Math.exp(-H.grip * dt)

    // ── hover ──
    const gx = this.pos.x
    const gz = this.pos.z
    const look = Math.min(this.speed * 0.05, 60)
    const g0 = groundH(gx, gz)
    const g1 = groundH(gx + this.fwd.x * look, gz + this.fwd.z * look)
    const gTarget = Math.max(g0, g1 * 0.9 + g0 * 0.1) + H.hover
    const w = H.hoverW
    this.vy += (w * w * (gTarget - this.pos.y) - 2 * w * this.vy) * dt
    this.vel.set(
      this.fwd.x * this.speed + this.right.x * this.lateral,
      this.vy,
      this.fwd.z * this.speed + this.right.z * this.lateral,
    )
    this.pos.addScaledVector(this.vel, dt)
    if (this.pos.y < g0 + 1.2) { this.pos.y = g0 + 1.2; if (this.vy < 0) this.vy = 0 }

    // ── visual attitude ──
    const bankT = this.yawRate * 0.55 + (this.lateral / 200) * 0.35
    this.bank += (bankT - this.bank) * Math.min(1, dt * 8)
    const slope = (g1 - g0) / Math.max(look, 1)
    const pitchT = -Math.atan(slope) * 0.6 - THREE.MathUtils.clamp(this.accel / 600, -0.08, 0.1)
    this.pitch += (pitchT - this.pitch) * Math.min(1, dt * 6)

    // ── collisions ──
    const n = world.near(this.pos.x, this.pos.z, 30, this.obs)
    for (let i = 0; i < n; i++) {
      const o = this.obs[i]
      const dx = this.pos.x - o.x
      const dz = this.pos.z - o.z
      const d = Math.hypot(dx, dz)
      const rr = o.cr + 2.4
      if (d >= rr) continue
      if (this.pos.y - g0 > o.top + 1) continue
      const nx = dx / (d || 1)
      const nz = dz / (d || 1)
      if (o.big) {
        // A rock wall at Mach 4: push out, kill the inward part of the motion, bleed speed.
        this.pos.x = o.x + nx * rr
        this.pos.z = o.z + nz * rr
        const into = this.fwd.x * nx + this.fwd.z * nz
        // Turn the heading along the wall.
        const tx = -nz, tz = nx
        const along = this.fwd.x * tx + this.fwd.z * tz
        const sgn = along >= 0 ? 1 : -1
        this.heading = Math.atan2(tx * sgn, tz * sgn)
        this.updateAxes()
        this.lateral = (into < 0 ? 1 : -1) * 0
        this.lateral += (this.right.x * nx + this.right.z * nz) * 140
        this.speed *= 0.55 + 0.25 * (1 + into)
        this.onCrash?.(true, this.pos.x - nx * 2.5, this.pos.y, this.pos.z - nz * 2.5, nx, nz)
      } else {
        // Clipping a boulder: a jolt, sparks, a little speed.
        this.lateral += (this.right.x * nx + this.right.z * nz) * 60
        this.vy += 25
        this.speed *= 0.96
        this.onCrash?.(false, o.x + nx * o.cr, this.pos.y - 1, o.z + nz * o.cr, nx, nz)
        // Moved off it so one rock is one hit.
        this.pos.x = o.x + nx * rr
        this.pos.z = o.z + nz * rr
      }
    }
  }

  shift(dx: number, dz: number): void {
    this.pos.x += dx; this.pos.z += dz
    this.prev.x += dx; this.prev.z += dz
  }
}
