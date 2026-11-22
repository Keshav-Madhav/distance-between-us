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
  // (Shift is the throttle now: it drains slower, and the engines still push when the bar is empty.)
  burnDrain: 12,
  energyRefill: 12,
  cushion: 70,
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
  /** Low and coming down fast (the HUD's PULL UP). */
  sinking = false
  throttle = false
  topMach = 0
  /** Rates (rad/s) actually applied: pitch, roll, yaw. */
  private rates = new THREE.Vector3()
  /** Manual roll suspends the auto-bank for a moment after release. */
  private manualT = 0
  /** Events for the game: hits (damage), ground scrapes. */
  onHit: ((dmg: number, kind: 'ground' | 'rock') => void) | null = null
  private readonly obs: Obstacle[] = []
  /** The surface under the craft (FREE ROAM: World.surfaceAt, so a mesa top is ground). */
  ground: (x: number, z: number) => number = groundH
  /** FREE ROAM: no hull loss, ever. */
  invincible = false
  /** The ground cushion (HUNT: skimming is safe). FREE ROAM turns it off: the ground is where you land. */
  cushionOn = true
  /** FREE ROAM: no caps tuned for HUNT's fights — speed is held off the throttle (only drag, climbs and
   *  dives change it), W pushes toward Mach 8.5 and Shift toward 12 with no energy limit, the ceiling is
   *  7 km, the auto-bank goes to ~77°. */
  sandbox = false
  /** 0 in the air … 1 in vacuum (set each step). */
  vac = 0
  /** ORBIT: free space — no ground, no ceiling. */
  unbound = false
  /** ORBIT's cruise: a speed the craft eases to (m/s; 0 = off), above every other limit. */
  cruise = 0

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

  /** FREE ROAM: lift off from the hover — at pos, on heading, at speed (m/s), the nose up a little. */
  launch(pos: THREE.Vector3, heading: number, speed: number, pitchUp: number): void {
    this.reset(pos.x, pos.z, heading, 0, Math.max(FLIGHT.floorMach, speed / MACH))
    this.pos.copy(pos); this.prev.copy(pos)
    _q.setFromAxisAngle(AX, -pitchUp); this.quat.multiply(_q); this.prevQuat.copy(this.quat); this.axes()
    this.vel.copy(this.fwd).multiplyScalar(this.speed)
    this.aim.copy(this.fwd)
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

    // ── controls: rates, like other arcade flyers ──
    // Turn: the heading swings about the world's up at a steady rate, and the craft banks into it by
    // itself. Pitch: the nose about the wings. Roll: only roll. Hands off: straight on, wings level.
    // (The old aim-point controller flew toward a point in the world, so rolling moved that point in
    //  the craft's frame and the nose chased it — "roll makes me pitch up".)
    let turnIn = c.turn, pitchIn = c.pitch
    if (c.aim) {
      // An aim (autopilot, tests): its heading and elevation off the nose, as turn and pitch.
      const hA = Math.atan2(c.aim.x, c.aim.z), hF = Math.atan2(this.fwd.x, this.fwd.z)
      let dh = hF - hA; dh = Math.atan2(Math.sin(dh), Math.cos(dh)) // + = aim to the right
      turnIn = THREE.MathUtils.clamp(dh * 3, -1, 1)
      pitchIn = THREE.MathUtils.clamp((Math.asin(THREE.MathUtils.clamp(c.aim.y, -1, 1)) - Math.asin(THREE.MathUtils.clamp(this.fwd.y, -1, 1))) * 3, -1, 1)
    }
    const m = this.mach
    const corner = THREE.MathUtils.clamp((m - 2.6) / (5 - 2.6), 0, 1)
    const pitchMax = THREE.MathUtils.lerp(F.pitchRate, F.pitchFast, corner) * (c.brake ? 1.25 : 1)
    // (Equal to pitch: at 0.75× a Dart out-turned you on the keys.)
    const turnMax = pitchMax
    // Bank: the world's up seen from the cockpit (+ = rolled right).
    const bank = Math.atan2(-UP.dot(this.right), UP.dot(this.up))
    let rollCmd: number
    this.manualT = Math.max(0, this.manualT - dt)
    if (c.roll !== 0) { rollCmd = c.roll; this.manualT = 0.6 }
    else if (this.manualT > 0) rollCmd = 0
    // Pulling (or pushing) hard with no turn: leave the wings where they are — that is a loop, not
    // something to level. (Auto-levelling rolled you upright over the top: every loop became a half
    // loop and a roll.)
    else if (Math.abs(pitchIn) > 0.3 && Math.abs(turnIn) < 0.2) { rollCmd = 0; this.manualT = 0.4 }
    else {
      const target = turnIn * (this.sandbox ? 1.35 : 1.0) // up to ~57° into a turn (77° in FREE ROAM); level when straight (also from inverted)
      let d = target - bank
      d = Math.atan2(Math.sin(d), Math.cos(d))
      rollCmd = THREE.MathUtils.clamp(d * 2.5, -1, 1)
    }
    const ease = 1 - Math.exp(-dt * 10)
    this.rates.x += (pitchIn * pitchMax - this.rates.x) * ease
    this.rates.y += (turnIn * turnMax - this.rates.y) * ease
    this.rates.z += (rollCmd * F.rollRate - this.rates.z) * ease
    // Turn about the world's up (pre-multiplied: a world-axis rotation); pitch and roll in the craft.
    _q.setFromAxisAngle(UP, -this.rates.y * dt); this.quat.premultiply(_q)
    _q.setFromAxisAngle(AX, -this.rates.x * dt); this.quat.multiply(_q)
    _q.setFromAxisAngle(AZ, this.rates.z * dt); this.quat.multiply(_q)
    this.quat.normalize()
    this.axes()
    // Where the inputs are taking the nose (the HUD's aim ring when flying by keys).
    if (c.aim) this.aim.copy(c.aim)
    else this.aim.copy(this.fwd).addScaledVector(_v.set(-this.fwd.z, 0, this.fwd.x).normalize(), turnIn * 0.35).addScaledVector(this.up, pitchIn * 0.35).normalize()

    // ── speed ──
    this.throttle = c.throttle
    this.braking = c.brake
    this.burning = c.burner && (this.energy > 0.5 || this.sandbox)
    if (this.burning && !this.sandbox) { this.energy = Math.max(0, this.energy - F.burnDrain * dt); this.energyIdle = 0 }
    else { this.energyIdle += dt; if (this.energyIdle > 0.8) this.energy = Math.min(F.energyMax, this.energy + F.energyRefill * dt) }
    // (FREE ROAM: only where the world stops being drawn — the terrain reaches ~24 km.)
    // (FREE ROAM: up into space — src/space.ts; the limit is far beyond where the air ends.)
    const soft = this.unbound ? Infinity : this.sandbox ? 1650000 : F.softCeiling, hard = this.unbound ? Infinity : this.sandbox ? 1700000 : F.hardCeiling
    /** 0 in the air … 1 in vacuum (FREE ROAM): no drag, the engines push harder, speed is free. */
    const vac = this.sandbox ? THREE.MathUtils.smoothstep(this.agl, 20000, 70000) : 0
    this.vac = vac
    const thin = this.unbound ? 0 : THREE.MathUtils.clamp((this.agl - soft) / (hard - soft), 0, 1)
    // Off the throttle the speed creeps toward cruise; Shift pushes hard (energy), or toward the
    // throttle speed when the energy is gone.
    if (this.cruise > 0) this.speed += (this.cruise - this.speed) * (1 - Math.exp(-2.4 * dt))
    else if (this.sandbox) {
      // Held off the throttle (a little drag); W and Shift push toward their speeds, never pull back.
      const boost = 1 + 3 * vac
      if (c.brake) this.speed += Math.max(F.brakeMach * MACH - this.speed, -F.decel * 1.6 * boost * dt)
      else if (this.burning && this.speed < THREE.MathUtils.lerp(12, 80, vac) * MACH) this.speed += F.accel * 1.5 * boost * dt
      else if (c.throttle && this.speed < THREE.MathUtils.lerp(8.5, 30, vac) * MACH) this.speed += F.accel * boost * dt
      this.speed -= this.speed * 0.012 * (1 - vac) * dt
      this.speed *= 1 - thin * 0.5 * dt
    } else {
      let target = (c.brake ? F.brakeMach : this.burning ? F.burnerMach : c.throttle || c.burner ? F.throttleMach : F.cruiseMach) * MACH
      target *= 1 - thin * 0.6
      const up = this.burning ? F.accel * 1.5 : c.throttle || c.burner ? F.accel : F.accel * 0.3
      this.speed += THREE.MathUtils.clamp(target - this.speed, -F.decel * dt * (c.brake ? 1.6 : 0.25), up * dt)
    }
    // Climbing costs, diving gains; turning bleeds a little.
    const gamma = Math.asin(THREE.MathUtils.clamp(this.vel.y / Math.max(1, this.vel.length()), -1, 1))
    this.speed -= F.gravity * Math.sin(gamma) * (1 - 0.8 * (this.vac ?? 0)) * dt
    // Drag in manoeuvres: pulling, turning and rolling hard all bleed speed (turns cost, straights pay).
    this.speed -= this.speed * (0.1 * Math.min(1, Math.abs(this.rates.x) / pitchMax) + 0.07 * Math.min(1, Math.abs(this.rates.y) / turnMax) + 0.02 * Math.min(1, Math.abs(this.rates.z) / F.rollRate)) * dt
    this.speed = THREE.MathUtils.clamp(this.speed, F.floorMach * MACH, Math.max(this.cruise, (this.sandbox ? THREE.MathUtils.lerp(14, 85, this.vac) : F.diveMach) * MACH))
    this.topMach = Math.max(this.topMach, this.mach)

    // ── velocity follows the nose ──
    const k = c.brake ? 7 : this.burning ? 3 : F.follow
    const dir = _v.copy(this.vel).normalize()
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.copy(this.fwd)
    dir.lerp(this.fwd, 1 - Math.exp(-k * dt)).normalize()
    this.vel.copy(dir).multiplyScalar(this.speed)

    // ── the ceiling: thin air pushes the nose down and stops the climb ──
    if (thin > 0 && !this.sandbox) {
      if (this.vel.y > 0) this.vel.y *= 1 - thin
      if (this.fwd.y > 0) { _q.setFromAxisAngle(AX, thin * 0.6 * dt); this.quat.multiply(_q); this.axes() }
    }

    this.pos.addScaledVector(this.vel, dt)

    // ── the ground: a soft cushion from 70 m that eases the nose up and kills the sink (never a snap),
    //    then a scrape; only a real nose-dive into it hurts. (It used to yank the nose 0.5 rad in one
    //    step and take 35 hull for any shallow dive — three skims ended the run: "the reset".) ──
    const g = this.ground(this.pos.x, this.pos.z)
    this.agl = this.pos.y - g
    this.sinking = this.vel.y < -30 && this.agl < 250 + -this.vel.y * 2.5
    if (this.cushionOn && this.agl < F.cushion) {
      const k = 1 - Math.max(0, this.agl) / F.cushion
      if (this.vel.y < 0) this.vel.y *= 1 - Math.min(1, k * k * 6 * dt)
      if (this.fwd.y < 0) {
        const ax = _w.crossVectors(this.fwd, UP)
        if (ax.lengthSq() > 1e-6) {
          ax.normalize()
          _q.setFromAxisAngle(ax, Math.min(-this.fwd.y, (0.4 + 2.2 * k * k) * dt))
          this.quat.premultiply(_q); this.quat.normalize(); this.axes()
        }
      }
    }
    if (this.agl < 3) {
      const descent = -this.vel.y
      this.pos.y = g + 3
      if (this.vel.y < 0) this.vel.y = 0
      if (this.ghost <= 0 && descent > 40) this.hurt(descent > 220 ? 20 : 4, 'ground')
      this.agl = 3
    }
    // Hard ceiling.
    if (this.agl > hard) this.pos.y = g + hard

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
    if (this.ghost > 0 || this.invincible) return
    this.hull -= dmg
    this.sinceHurt = 0
  }

  private hurt(dmg: number, kind: 'ground' | 'rock'): void {
    if (this.invincible) { this.onHit?.(0, kind); return }
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
    cam.position.copy(at).addScaledVector(this.back, -14).addScaledVector(this.upS, 4.6)
    const g = groundH(cam.position.x, cam.position.z)
    if (cam.position.y < g + 1.6) cam.position.y = g + 1.6
    cam.up.copy(this.upS)
    cam.lookAt(at.x + this.fwdS.x * 45 + this.upS.x * 1.2, at.y + this.fwdS.y * 45 + this.upS.y * 1.2, at.z + this.fwdS.z * 45 + this.upS.z * 1.2)
    const s = THREE.MathUtils.clamp((mach - 1) / 4, 0, 1)
    cam.fov += (72 + (fovMax - 72) * s + punch - cam.fov) * (1 - Math.exp(-dt * 3))
    cam.updateProjectionMatrix()
  }
}
