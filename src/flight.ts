// HUNT's flight (docs/HUNT-FLIGHT-PLAN.md, phase 1): the craft leaves the ground and truly flies.
//
// FlightCraft — arcade flight: a quaternion orientation (loops and inverted flight are fine), the nose
//   goes where it is pointed and the velocity follows it a moment later (hard turns slide a little),
//   climbing costs speed and diving gains it. No stall: there is a floor speed. A ground cushion
//   (skim the dirt at Mach 3), rock is solid (fly over a mesa, not through it), a soft ceiling.
// Aim-point control — every input scheme becomes one thing: a direction in the world to fly toward.
//   The controller banks and pulls to put the nose on it, and levels the wings when it is close.
// FlightCam — a chase camera that keeps the horizon mostly level (the craft rolls; the world rolls
//   35% as much) and swings wide through hard turns.
//
// The craft writes its state into the race's Player each step (position, speed, hull, …) so the
// renderer, trails, sound and HUD that read a Player keep working; only the craft's orientation (a
// quaternion) and the camera are flight-specific.
import * as THREE from 'three'
import { MACH } from './config'
import { groundH } from './terrain'
import type { Player } from './player'
import type { Obstacle, World } from './world'

export const FLIGHT = {
  floorMach: 0.9,
  cruiseMach: 2.4,
  throttleMach: 3.4,
  burnerMach: 5.0,
  diveMach: 6.2,
  brakeMach: 1.1,
  /** Speed change toward the target (m/s²): up, and down. */
  accel: 140,
  decel: 220,
  /** Pitch rate (rad/s) at corner speed (Mach 1.4–2.6), falling to `pitchFast` at Mach 5. */
  // (Calmer than the plan's 1.5 / 3.6: at those a key tap swung 120° a second — "too difficult".)
  pitchRate: 1.05,
  pitchFast: 0.7,
  rollRate: 2.6,
  yawRate: 0.35,
  /** How fast the velocity swings onto the nose (1/s): low slides, high is rails. */
  follow: 5,
  /** Climb/dive: speed change per second per unit sin(flight-path angle) (m/s²). */
  gravity: 60,
  energyMax: 100,
  burnDrain: 22,
  energyRefill: 12,
  cushion: 25,
  softCeiling: 1800,
  hardCeiling: 2200,
}

export interface FlightControls {
  /** Keyboard / pad: −1 … 1 (pitch: + climbs; turn: + right). */
  pitch: number
  turn: number
  /** Manual roll (Q/E): −1 … 1; overrides the auto-bank while held. */
  roll: number
  throttle: boolean
  brake: boolean
  burner: boolean
  /** Mouse aim (world direction), or null when steering by keys / stick. */
  aim: THREE.Vector3 | null
}

const _q = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1)

export class FlightCraft {
  readonly pos = new THREE.Vector3()
  readonly prev = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  readonly quat = new THREE.Quaternion()
  readonly prevQuat = new THREE.Quaternion()
  /** The craft's axes (from quat): nose, right wing, top. */
  readonly fwd = new THREE.Vector3(0, 0, 1)
  readonly right = new THREE.Vector3(-1, 0, 0)
  readonly up = new THREE.Vector3(0, 1, 0)
  /** The aim direction the controller flies toward (what the HUD's aim ring shows). */
  readonly aim = new THREE.Vector3(0, 0, 1)
  speed = 0
  energy = FLIGHT.energyMax
  energyIdle = 0
  hull = 100
  sinceHurt = 10
  ghost = 0
  agl = 0
  burning = false
  braking = false
  throttle = false
  topMach = 0
  /** Rates (rad/s) actually applied: pitch, roll, yaw. */
  private rates = new THREE.Vector3()
  /** Manual roll suspends the auto-bank for a moment after release. */
  private manualT = 0
  /** Events for the game: hits (damage), ground scrapes. */
  onHit: ((dmg: number, kind: 'ground' | 'rock') => void) | null = null
  private readonly obs: Obstacle[] = []

  get mach(): number { return this.speed / MACH }

  /** Airborne at (x, z), height h above the ground, heading (rad), Mach m. */
  reset(x: number, z: number, heading: number, h = 30, m = 2): void {
    this.pos.set(x, groundH(x, z) + h, z)
    this.prev.copy(this.pos)
    this.quat.setFromAxisAngle(AY, heading)
    this.prevQuat.copy(this.quat)
    this.axes()
    this.speed = m * MACH
    this.vel.copy(this.fwd).multiplyScalar(this.speed)
    this.aim.copy(this.fwd)
    this.energy = FLIGHT.energyMax
    this.hull = 100
    this.ghost = 0
    this.rates.set(0, 0, 0)
    this.topMach = 0
  }

  private axes(): void {
    this.fwd.copy(AZ).applyQuaternion(this.quat)
    this.right.copy(AX).applyQuaternion(this.quat).negate() // three's +x is the craft's left
    this.up.copy(AY).applyQuaternion(this.quat)
  }

  step(dt: number, c: FlightControls, world: World): void {
    const F = FLIGHT
    this.prev.copy(this.pos)
    this.prevQuat.copy(this.quat)

    // ── where to fly: an aim direction ──
    if (c.aim) this.aim.copy(c.aim)
    else {
      // Keys / stick: a direction off the nose — turn about the world's up and pitch toward the
      // world's up or down (so ↑/↓ mean dive and climb whatever the bank).
      const flat = _v.set(this.fwd.x, 0, this.fwd.z)
      if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1)
      flat.normalize()
      const sideW = _w.set(-flat.z, 0, flat.x) // world right of the nose's heading
      this.aim.copy(this.fwd).addScaledVector(sideW, c.turn * 0.45).addScaledVector(UP, c.pitch * 0.5).normalize()
    }

    // ── the controller: bank toward a sideways aim, pitch straight at a high or low one ──
    // (It never rolls over to reach an aim below the nose — that bank-and-yank read as the controls
    //  doing the opposite of what you asked.)
    const up = this.aim.dot(this.up), side = this.aim.dot(this.right)
    const m = this.mach
    const corner = THREE.MathUtils.clamp((m - 2.6) / (5 - 2.6), 0, 1)
    const pitchMax = THREE.MathUtils.lerp(F.pitchRate, F.pitchFast, corner) * (c.brake ? 1.25 : 1)
    // Bank: how far the wings are from level (the world's up seen in the craft's frame).
    const bank = Math.atan2(-UP.dot(this.right), UP.dot(this.up))
    const inverted = UP.dot(this.up) < 0
    let rollCmd: number
    this.manualT = Math.max(0, this.manualT - dt)
    if (c.roll !== 0) { rollCmd = c.roll; this.manualT = 0.6 }
    else if (this.manualT > 0) rollCmd = 0
    else {
      // Target bank from the sideways part of the aim (up to ~75°), wings level when straight.
      const want = THREE.MathUtils.clamp(Math.atan2(side, 0.35) * 0.85, -1.3, 1.3)
      const target = Math.abs(side) < 0.02 ? 0 : want
      const d = inverted ? -Math.atan2(Math.sin(bank), Math.cos(bank)) : target - bank
      rollCmd = THREE.MathUtils.clamp(d * 2.2, -1, 1)
    }
    // Pitch: at the aim's up/down in the cockpit frame, plus a pull while banked into a turn.
    let pitchCmd = THREE.MathUtils.clamp(4 * Math.asin(THREE.MathUtils.clamp(up, -1, 1)) + Math.abs(side) * 2.2 * Math.abs(Math.sin(bank)), -1, 1)
    if (inverted && c.roll === 0 && this.manualT <= 0) pitchCmd *= 0.3 // rolling upright first
    const yawCmd = THREE.MathUtils.clamp(4 * Math.asin(THREE.MathUtils.clamp(side, -1, 1)), -1, 1) * 0.25
    // Rates ease in (snappy, not instant).
    const ease = 1 - Math.exp(-dt * 10)
    this.rates.x += (pitchCmd * pitchMax - this.rates.x) * ease
    this.rates.z += (rollCmd * F.rollRate - this.rates.z) * ease
    this.rates.y += (yawCmd * F.yawRate * 4 - this.rates.y) * ease
    // Apply in the craft's frame: pitch about its wing (x), yaw about its top (y), roll about its nose (z).
    _q.setFromAxisAngle(AX, -this.rates.x * dt); this.quat.multiply(_q)
    _q.setFromAxisAngle(AY, -this.rates.y * dt); this.quat.multiply(_q)
    _q.setFromAxisAngle(AZ, this.rates.z * dt); this.quat.multiply(_q)
    this.quat.normalize()
    this.axes()

    // ── speed ──
    this.throttle = c.throttle
    this.braking = c.brake
    this.burning = c.burner && this.energy > 0.5
    if (this.burning) { this.energy = Math.max(0, this.energy - F.burnDrain * dt); this.energyIdle = 0 }
    else { this.energyIdle += dt; if (this.energyIdle > 0.8) this.energy = Math.min(F.energyMax, this.energy + F.energyRefill * dt) }
    const thin = THREE.MathUtils.clamp((this.agl - F.softCeiling) / (F.hardCeiling - F.softCeiling), 0, 1)
    let target = (c.brake ? F.brakeMach : this.burning ? F.burnerMach : c.throttle ? F.throttleMach : F.cruiseMach) * MACH
    target *= 1 - thin * 0.6
    this.speed += THREE.MathUtils.clamp(target - this.speed, -F.decel * dt * (c.brake ? 1.6 : 1), F.accel * dt * (this.burning ? 1.5 : 1))
    // Climbing costs, diving gains; turning bleeds a little.
    const gamma = Math.asin(THREE.MathUtils.clamp(this.vel.y / Math.max(1, this.vel.length()), -1, 1))
    this.speed -= F.gravity * Math.sin(gamma) * dt
    this.speed -= this.speed * 0.03 * Math.min(1, Math.abs(this.rates.x) / pitchMax) * dt
    this.speed = THREE.MathUtils.clamp(this.speed, F.floorMach * MACH, F.diveMach * MACH)
    this.topMach = Math.max(this.topMach, this.mach)

    // ── velocity follows the nose ──
    const k = c.brake ? 7 : this.burning ? 3 : F.follow
    const dir = _v.copy(this.vel).normalize()
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.copy(this.fwd)
    dir.lerp(this.fwd, 1 - Math.exp(-k * dt)).normalize()
    this.vel.copy(dir).multiplyScalar(this.speed)

    // ── the ceiling: thin air pushes the nose down and stops the climb ──
    if (thin > 0) {
      if (this.vel.y > 0) this.vel.y *= 1 - thin
      _q.setFromAxisAngle(AX, thin * 0.6 * dt * Math.sign(this.fwd.y)); if (this.fwd.y > 0) this.quat.multiply(_q)
    }

    this.pos.addScaledVector(this.vel, dt)

    // ── the ground: a cushion, then a scrape, then a hard hit ──
    const g = groundH(this.pos.x, this.pos.z)
    this.agl = this.pos.y - g
    if (this.agl < F.cushion) {
      const push = (F.cushion - this.agl) / F.cushion
      if (this.vel.y < 0) this.vel.y *= 1 - Math.min(1, push * 6 * dt * 10)
      this.pos.y += push * push * 40 * dt
    }
    if (this.agl < 2) {
      const descent = -this.vel.y
      this.pos.y = g + 2
      if (this.vel.y < 0) this.vel.y = Math.abs(this.vel.y) * 0.3
      // Nose up out of it.
      if (this.fwd.y < 0) { _q.setFromAxisAngle(AX, -Math.min(0.5, -this.fwd.y) ); this.quat.multiply(_q); this.axes() }
      if (this.ghost <= 0) this.hurt(descent > 60 ? 35 : 5, 'ground')
      this.agl = 2
    }
    // Hard ceiling.
    if (this.agl > F.hardCeiling) this.pos.y = g + F.hardCeiling

    // ── rock: solid (with height — over a mesa is clear air) ──
    const n = world.near(this.pos.x, this.pos.z, this.pos.y, 30, this.obs)
    for (let i = 0; i < n; i++) {
      const o = this.obs[i]
      const dx = this.pos.x - o.x, dz = this.pos.z - o.z
      const d = Math.hypot(dx, dz)
      if (d >= o.cr + 6 || d < 1e-3) continue
      const nx = dx / d, nz = dz / d
      this.pos.x = o.x + nx * (o.cr + 6); this.pos.z = o.z + nz * (o.cr + 6)
      const vn = this.vel.x * nx + this.vel.z * nz
      if (vn < 0) { this.vel.x -= nx * vn * 1.6; this.vel.z -= nz * vn * 1.6; this.speed *= vn < -this.speed * 0.6 ? 0.5 : 0.85 }
      if (this.ghost <= 0) this.hurt(vn < -this.speed * 0.6 ? 35 : 15, 'rock')
    }

    this.ghost = Math.max(0, this.ghost - dt)
    this.sinceHurt += dt
    if (this.sinceHurt > 4) this.hull = Math.min(100, this.hull + 4 * dt)
  }

  /** Hit by enemy fire. */
  damage(dmg: number): void {
    if (this.ghost > 0) return
    this.hull -= dmg
    this.sinceHurt = 0
  }

  private hurt(dmg: number, kind: 'ground' | 'rock'): void {
    this.hull -= dmg
    this.sinceHurt = 0
    this.ghost = dmg >= 30 ? 1.5 : 0.25
    this.onHit?.(dmg, kind)
  }

  /** Mirror the state into a race Player (renderer, trails, sound, HUD read those fields). */
  syncTo(p: Player): void {
    p.prev.copy(this.prev)
    p.pos.copy(this.pos)
    p.vel.copy(this.vel)
    p.fwd.copy(this.fwd)
    p.right.copy(this.right)
    p.prevHeading = p.heading
    p.heading = Math.atan2(this.fwd.x, this.fwd.z)
    p.speed = this.speed
    p.hull = this.hull
    p.sinceHurt = this.sinceHurt
    p.agl = this.agl
    p.boost = this.burning ? 1 : this.throttle ? 0.6 : 0.3
    p.burning = this.burning
    p.brake = this.braking ? 1 : 0
    p.throttle = this.throttle ? 1 : 0.45
    p.topMach = this.topMach
    p.airborne = false
    p.pitch = p.prevPitch = 0
    p.bank = p.prevBank = 0
    p.crashing = false
  }

  /** Shift with the world's 72 km wrap. */
  shift(dx: number, dz: number): void {
    this.pos.x += dx; this.pos.z += dz
    this.prev.x += dx; this.prev.z += dz
  }
}

/** The flight camera: behind and above along nose and travel, horizon mostly level. */
export class FlightCam {
  /** The camera's offset direction from the craft (smoothed), and its up (smoothed). Position is
   *  rebuilt from the craft every frame — smoothing the position itself lagged 130 m at Mach 3. */
  private readonly back = new THREE.Vector3(0, 0, -1)
  private readonly upS = new THREE.Vector3(0, 1, 0)
  private readonly fwdS = new THREE.Vector3(0, 0, 1)
  private init = false
  /** How much of the craft's roll the view takes (0 = horizon locked, 1 = cockpit). */
  horizon = 0.3
  constructor(private readonly camera: THREE.PerspectiveCamera) {}
  snap(): void { this.init = false }
  update(dt: number, at: THREE.Vector3, q: THREE.Quaternion, vel: THREE.Vector3, mach: number, fovMax: number, punch = 0): void {
    const fwd = _v.copy(AZ).applyQuaternion(q)
    const cUp = _w.copy(AY).applyQuaternion(q)
    const vdir = vel.lengthSq() > 1 ? vel.clone().normalize() : fwd.clone()
    const wantBack = fwd.clone().multiplyScalar(0.7).addScaledVector(vdir, 0.3).normalize()
    // The view's up: the world's, taking a little of the craft's roll — and all of it when the craft
    // goes past vertical (through a loop the world's up would flip the view).
    const lean = THREE.MathUtils.clamp(this.horizon + Math.max(0, -cUp.y) * 1.4, 0, 1)
    const wantUp = UP.clone().lerp(cUp, lean)
    if (wantUp.lengthSq() < 1e-4) wantUp.copy(cUp)
    wantUp.normalize()
    if (!this.init) { this.back.copy(wantBack); this.upS.copy(wantUp); this.fwdS.copy(fwd); this.init = true }
    // The swing: the offset direction trails the nose a little (hard pulls show the craft swinging
    // toward the outside of the turn), the up follows smoothly.
    this.back.lerp(wantBack, 1 - Math.exp(-dt * 7)).normalize()
    this.upS.lerp(wantUp, 1 - Math.exp(-dt * 5)).normalize()
    this.fwdS.lerp(fwd, 1 - Math.exp(-dt * 10)).normalize()
    const cam = this.camera
    cam.position.copy(at).addScaledVector(this.back, -13).addScaledVector(this.upS, 3.2)
    const g = groundH(cam.position.x, cam.position.z)
    if (cam.position.y < g + 1.6) cam.position.y = g + 1.6
    cam.up.copy(this.upS)
    cam.lookAt(at.x + this.fwdS.x * 45 + this.upS.x * 1.2, at.y + this.fwdS.y * 45 + this.upS.y * 1.2, at.z + this.fwdS.z * 45 + this.upS.z * 1.2)
    const s = THREE.MathUtils.clamp((mach - 1) / 4, 0, 1)
    cam.fov += (72 + (fovMax - 72) * s + punch - cam.fov) * (1 - Math.exp(-dt * 3))
    cam.updateProjectionMatrix()
  }
}
