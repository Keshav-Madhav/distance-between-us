// A craft's simulation (the player's and every AI racer's): the speed model (no brakes to zero;
// violent boost; the Mach 6 barrier), handling (twitchy yaw, drift, strafe/dodge), ground effect
// and flight, and collisions. Fixed 60 Hz; the renderer interpolates prev → pos.
//
// Ground and air:
//   grounded — held at hover height by a stiff ground-effect spring that follows the terrain's slope.
//              Gentle dunes never let go. A crest that would strip more than LAUNCH_DV of climb in
//              40 m (sharper crests, or the same crest taken faster) does:
//   airborne — ballistic under game gravity, still steerable (yaw at 60%), the nose following the
//              flight path and levelling for the landing. Brake in the air = dive.
//   landing  — the ground effect catches it: the hit is absorbed (suspension squash, dust, a thump)
//              and costs a little speed; only a truly brutal landing hurts.
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

const GRAVITY = 44
/** Launch when the ground would have to take more than this much upward speed (m/s) away within 40 m. */
const LAUNCH_DV = 45

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
  /** Strafe/dodge sideways velocity (decays on its own; never turned into forward speed). */
  side = 0
  vy = 0
  airborne = false
  airTime = 0
  /** Suspension squash, 0 … 1 (visual). */
  squash = 0
  /** Height above ground. */
  agl = 0
  bank = 0
  pitch = 0
  prevBank = 0
  prevPitch = 0
  boost = 0
  brake = 0
  accel = 0
  hull = 100
  sinceHurt = 10
  dead = false
  /** Rubbing a wall this step (0 … 1): drives scrape sparks and sound. */
  scrape = 0
  readonly scrapeAt = new THREE.Vector3()
  barrier: BarrierPhase = 'none'
  barrierT = 0
  barrierCooldown = 0
  topMach = 0
  /** Speed multiplier ceiling (AI skill / rubber band). */
  maxMach = CFG.speed.boostMach
  /** Seconds left as a ghost (just respawned): passes through other racers. */
  ghost = 0
  /** Whether Mach crossings fire callbacks (the player only). */
  announce = true
  onMach: ((m: number) => void) | null = null
  onBarrier: ((phase: BarrierPhase) => void) | null = null
  /** severity 0 … 1+ (normal speed / 600), contact point, outward normal. */
  onCrash: ((severity: number, big: boolean, x: number, y: number, z: number, nx: number, nz: number) => void) | null = null
  onLand: ((impact: number, airTime: number) => void) | null = null
  onLaunch: ((vy: number) => void) | null = null
  onBoostStart: (() => void) | null = null
  private wasBoost = false
  private lastMach = 0
  private readonly obs: Obstacle[] = []
  private dodgeCool = 0

  reset(x = 0, z = 0, heading = 0, mach = CFG.speed.launchMach): void {
    this.heading = this.prevHeading = heading
    this.updateAxes()
    this.pos.set(x, groundH(x, z) + CFG.handling.hover, z)
    this.prev.copy(this.pos)
    this.speed = mach * MACH
    this.lateral = 0
    this.side = 0
    this.vy = 0
    this.yawRate = 0
    this.airborne = false
    this.airTime = 0
    this.squash = 0
    this.bank = this.pitch = this.prevBank = this.prevPitch = 0
    this.hull = 100
    this.dead = false
    this.barrier = 'none'
    this.barrierT = 0
    this.barrierCooldown = 0
    this.topMach = 0
    this.lastMach = Math.floor(mach)
    this.vel.copy(this.fwd).multiplyScalar(this.speed)
  }

  get mach(): number { return this.speed / MACH }

  private updateAxes(): void {
    this.fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading))
    this.right.set(-Math.cos(this.heading), 0, Math.sin(this.heading))
  }

  /** Set the horizontal velocity (x, z): re-split into speed along the heading + lateral slide. */
  setHorizontal(vx: number, vz: number): void {
    this.speed = Math.max(0, vx * this.fwd.x + vz * this.fwd.z)
    this.lateral = vx * this.right.x + vz * this.right.z - this.side
  }

  step(dt: number, c: Controls, world: World, frozen = false): void {
    this.prev.copy(this.pos)
    this.prevHeading = this.heading
    this.prevBank = this.bank
    this.prevPitch = this.pitch
    this.sinceHurt += dt
    this.ghost = Math.max(0, this.ghost - dt)
    this.scrape = Math.max(0, this.scrape - dt * 6)
    if (frozen) {
      // On the grid: engines live, wheels-up, held.
      const g = groundH(this.pos.x, this.pos.z)
      this.pos.y = g + CFG.handling.hover
      this.boost += ((c.boost ? 1 : 0) - this.boost) * Math.min(1, dt * 6)
      this.speed = 0
      this.vel.set(0, 0, 0)
      return
    }
    if (this.dead) {
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
    if (c.brake && !this.airborne) { target = S.brakeMach * MACH; k = S.brakeK }
    else if (boosting) { target = Math.min(S.boostMach, this.maxMach) * MACH; k = S.boostK }
    if (!(c.brake && !this.airborne) && !boosting && this.speed > target) k = 0.12
    // (In the air there is nothing to push against: the engines only hold speed.)
    if (this.airborne) k *= 0.35
    const before = this.speed
    this.speed += (target - this.speed) * (1 - Math.exp(-k * dt))
    this.speed -= Math.abs(this.yawRate) * S.turnBleed * this.speed * dt

    // ── the barrier (the player only) ──
    if (this.announce) {
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
      const mi = Math.floor(this.speed / MACH)
      if (mi > this.lastMach && mi >= 1 && mi <= 5) this.onMach?.(mi)
      this.lastMach = mi
    }
    this.accel = (this.speed - before) / dt
    this.topMach = Math.max(this.topMach, this.speed / MACH)

    // ── steering ──
    const yawMax = THREE.MathUtils.lerp(H.yawLow, H.yawHigh, THREE.MathUtils.clamp((m - 1) / 5, 0, 1)) * (this.airborne ? 0.6 : 1)
    const want = -c.steer * yawMax * (1 + 0.25 * this.brake)
    this.yawRate += (want - this.yawRate) * (1 - Math.exp(-H.yawResponse * dt))
    this.heading += this.yawRate * dt
    // Turning keeps the velocity: re-split it against the new heading (the slide is real).
    const lat0 = this.lateral + this.side
    const hvx = this.fwd.x * this.speed + this.right.x * lat0
    const hvz = this.fwd.z * this.speed + this.right.z * lat0
    this.updateAxes()
    this.setHorizontal(hvx, hvz)

    this.dodgeCool -= dt
    if (this.dodgeCool <= 0 && (c.dodgeL || c.dodgeR)) {
      this.side += (c.dodgeR ? 1 : -1) * H.dodge
      this.dodgeCool = 0.25
    }
    this.side += c.strafe * H.strafe * (this.airborne ? 0.5 : 1) * dt
    this.side *= Math.exp(-3.2 * dt)
    // Grip turns the slide back into the heading: most of it becomes forward speed again (a carve),
    // so turning drifts a little and bleeds a little — far less in the air.
    const gl = this.lateral * (1 - Math.exp(-H.grip * (this.airborne ? 0.15 : 1) * dt))
    // (Energy: the slide joins the forward speed as a vector — √(s² + 0.8·g²) — never added to it,
    // which made every turn a speed boost: Mach 7.4.)
    this.lateral -= gl
    this.speed = Math.sqrt(this.speed * this.speed + gl * gl * 0.8)
    this.speed = Math.min(this.speed, 6.6 * MACH)

    // ── ground effect / flight ──
    const g0 = groundH(this.pos.x, this.pos.z)
    const ax = this.vel.x, az = this.vel.z
    const hs = Math.hypot(ax, az) || 1
    const ux = ax / hs, uz = az / hs
    // Slope along the direction of travel, here and 40 m on.
    const gA = groundH(this.pos.x + ux * 20, this.pos.z + uz * 20)
    const gB = groundH(this.pos.x - ux * 20, this.pos.z - uz * 20)
    const gC = groundH(this.pos.x + ux * 60, this.pos.z + uz * 60)
    const slope = (gA - gB) / 40
    const slopeAhead = (gC - gA) / 40
    const ride = g0 + H.hover
    if (!this.airborne) {
      const terrainVy = slope * hs
      // Launch: rising, and the ground is about to fall away faster than the ground effect can hold.
      if (slope > 0.02 && (slope - slopeAhead) * hs > LAUNCH_DV) {
        this.airborne = true
        this.airTime = 0
        this.vy = Math.min(terrainVy, 24 + 9 * m)
        this.onLaunch?.(this.vy)
      } else {
        const w = H.hoverW
        // Feed-forward on the slope, spring on the error.
        const err = ride - this.pos.y
        this.vy += (terrainVy - this.vy) * Math.min(1, dt * 18) + (w * w * err - 2 * w * (this.vy - terrainVy)) * dt * 0.25
        this.pos.y += this.vy * dt
        if (this.pos.y < g0 + 1.2) { this.pos.y = g0 + 1.2; this.vy = Math.max(this.vy, terrainVy) }
      }
    }
    if (this.airborne) {
      this.airTime += dt
      this.vy -= (GRAVITY + (c.brake ? 55 : 0)) * dt
      this.pos.y += this.vy * dt
      if (this.pos.y <= ride) {
        const terrainVy = slope * hs
        // (Against a rising slope at Mach speeds the raw number is hundreds of m/s: it is felt —
        // squash, dust, thump — but never damages. Landings are safe while in control.)
        const impact = Math.min(150, Math.max(0, terrainVy - this.vy))
        this.airborne = false
        this.pos.y = ride
        this.vy = terrainVy
        this.squash = Math.min(1, impact / 70)
        // Soft by design: you landed it. A little speed for a hard one; hull only past brutal.
        if (impact > 30) this.speed *= 1 - Math.min(0.06, (impact - 30) / 2000)
        if (this.airTime > 0.15) this.onLand?.(impact, this.airTime)
      }
    }
    this.squash = Math.max(0, this.squash - dt * 3.5)
    this.agl = this.pos.y - g0

    const lat = this.lateral + this.side
    this.vel.set(this.fwd.x * this.speed + this.right.x * lat, this.vy, this.fwd.z * this.speed + this.right.z * lat)
    this.pos.x += this.vel.x * dt
    this.pos.z += this.vel.z * dt

    // ── visual attitude ──
    const bankT = THREE.MathUtils.clamp(this.yawRate * 0.5 + ((this.lateral + this.side) / 400) * 0.3, -0.55, 0.55)
    this.bank += (bankT - this.bank) * Math.min(1, dt * 8)
    let pitchT: number
    if (this.airborne) {
      // Nose on the flight path; levelling toward the ground's slope as it comes up.
      const path = -Math.atan2(this.vy, hs) * 0.8
      const lvl = THREE.MathUtils.clamp(1 - this.agl / 40, 0, 1)
      pitchT = THREE.MathUtils.lerp(path, -Math.atan(slope), lvl * 0.8)
    } else {
      pitchT = -Math.atan(slope) - THREE.MathUtils.clamp(this.accel / 600, -0.08, 0.1)
    }
    this.pitch += (pitchT - this.pitch) * Math.min(1, dt * 6)

    this.collide(world)
  }

  /** Rock: push out along the true surface normal; keep the tangential speed (a glancing hit scrapes,
   *  a head-on one stops you hard); turn the nose part-way along the wall. */
  private collide(world: World): void {
    const n = world.near(this.pos.x, this.pos.z, this.pos.y, 40, this.obs)
    for (let i = 0; i < n; i++) {
      const o = this.obs[i]
      const dx = this.pos.x - o.x
      const dz = this.pos.z - o.z
      const d = Math.hypot(dx, dz)
      const rr = o.cr + 2.6
      if (d >= rr) continue
      const nx = dx / (d || 1)
      const nz = dz / (d || 1)
      this.pos.x = o.x + nx * rr
      this.pos.z = o.z + nz * rr
      const vx = this.vel.x, vz = this.vel.z
      const vn = vx * nx + vz * nz
      if (vn >= 0) continue
      const e = o.big ? 0.25 : 0.35
      const tx = vx - vn * nx, tz = vz - vn * nz
      const tl = Math.hypot(tx, tz)
      // Friction: proportional to how hard you hit.
      const fr = Math.max(0, 1 - (o.big ? 0.9 : 0.5) * (-vn) / Math.max(tl + -vn, 1))
      const nvx = tx * fr - e * vn * nx
      const nvz = tz * fr - e * vn * nz
      const sev = -vn / 600
      // Nose follows the new direction part of the way (a deflection, not a snap).
      const nh = Math.atan2(nvx, nvz)
      let dh = nh - this.heading
      dh = Math.atan2(Math.sin(dh), Math.cos(dh))
      this.heading += dh * (o.big ? 0.65 : 0.3)
      this.updateAxes()
      this.setHorizontal(nvx, nvz)
      this.yawRate *= 0.3
      this.scrape = Math.min(1, this.scrape + 0.5 + sev)
      this.scrapeAt.set(o.x + nx * o.cr, this.pos.y - 0.5, o.z + nz * o.cr)
      if (sev > 0.02 || !o.big) this.onCrash?.(sev, o.big, this.scrapeAt.x, this.scrapeAt.y, this.scrapeAt.z, nx, nz)
      if (o.big) this.hull -= Math.min(45, sev * 40)
      else this.hull -= 2 + sev * 10
      this.sinceHurt = 0
    }
  }

  shift(dx: number, dz: number): void {
    this.pos.x += dx; this.pos.z += dz
    this.prev.x += dx; this.prev.z += dz
  }
}

const _n = new THREE.Vector3()
/** Racer-on-racer: separate, swap the closing speed (a bump that shoves), report the hit. */
export function bump(a: Player, b: Player, onHit: (a: Player, b: Player, severity: number, x: number, y: number, z: number) => void): void {
  if (a.dead || b.dead || a.ghost > 0 || b.ghost > 0) return
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, dy = b.pos.y - a.pos.y
  if (Math.abs(dy) > 3.5) return
  const d2 = dx * dx + dz * dz
  const R = 7.2
  if (d2 >= R * R) return
  const d = Math.sqrt(d2) || 0.01
  _n.set(dx / d, 0, dz / d)
  const pen = R - d
  a.pos.x -= _n.x * pen * 0.5; a.pos.z -= _n.z * pen * 0.5
  b.pos.x += _n.x * pen * 0.5; b.pos.z += _n.z * pen * 0.5
  const rel = (b.vel.x - a.vel.x) * _n.x + (b.vel.z - a.vel.z) * _n.z
  if (rel >= 0) return
  const j = Math.min(-rel * 0.75, 220) // e = 0.5, equal mass; capped: a bump shoves, never launches
  a.setHorizontal(a.vel.x - _n.x * j, a.vel.z - _n.z * j)
  b.setHorizontal(b.vel.x + _n.x * j, b.vel.z + _n.z * j)
  a.vel.x -= _n.x * j; a.vel.z -= _n.z * j
  b.vel.x += _n.x * j; b.vel.z += _n.z * j
  const sev = -rel / 400
  if (sev > 0.15) { const d = Math.min(12, sev * 3); a.hull -= d; b.hull -= d }
  a.sinceHurt = b.sinceHurt = 0
  onHit(a, b, sev, (a.pos.x + b.pos.x) / 2, (a.pos.y + b.pos.y) / 2, (a.pos.z + b.pos.z) / 2)
}
