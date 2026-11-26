// HUNT's flight (docs/HUNT-FLIGHT-PLAN.md, phase 1): the craft leaves the ground and truly flies.
//
// FlightCraft — arcade flight: a quaternion orientation (loops and inverted flight are fine), the nose
//   goes where it is pointed and the velocity follows it a moment later (hard turns slide a little),
//   climbing costs speed and diving gains it. No stall: there is a floor speed. A ground cushion
//   (skim the dirt at Mach 3), rock is solid (fly over a mesa, not through it), and the air pushes back
//   with height (AIR: thin air, turbulence, icing — no wall).
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
  /** Pitch and turn rate (rad/s) by Mach: a corner speed. Slow is sluggish (0.7 at Mach 1.1), the
   *  best turn is at Mach 2.2–2.6 (1.1, around cruise), fast is wide again (0.75 at Mach 5).
   *  (It was flat 1.05 from the floor speed to Mach 2.6: slowest always turned best, so holding the air
   *  brake and pulling beat everything — the answer to every fight.) */
  // (Calmer than the plan's 1.5 / 3.6: at those a key tap swung 120° a second — "too difficult".)
  rateCurve: [[0.9, 0.62], [1.1, 0.7], [2.2, 1.1], [2.6, 1.1], [5, 0.75], [6.2, 0.68]] as [number, number][],
  /** The air brake's snap: a burst of extra rate for the first moments of a press, then nothing — a
   *  move to time, not a state to hold. */
  brakeSnap: 1.3,
  brakeSnapTime: 0.5,
  /** Rock: no damage below this speed into the face (m/s) — a scrape slides along it; above, the
   *  damage grows with the impact. After any hit, a grace before rock can hurt again. */
  rockSafe: 250,
  rockGrace: 1.2,
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
  /** HUNT's last-resort ceiling (m): the thin air (AIR) holds a climb well under it. (It used to be a
   *  wall at 2.2 km — climbs stopped dead and a loop started above 300 m hit it.) */
  hardCeiling: 20000,
}

/**
 * The air, by height — one model for HUNT and FREE ROAM flight (not ORBIT, not the ground). Height
 * pushes back instead of a wall: past 3 km the air thins (less speed, less control, and a slow craft
 * can't hold its climb — it mushes and the nose drops), from ~4 km the cloud layer ices the craft, and
 * the air shakes it. Above ~25 km there's no weather left: a climb that punches through (FREE ROAM's
 * rocket) is clear. HUNT's craft runs out of air around 10–13 km.
 *
 * Icing never runs away: the ice eases toward a level set by the height (speed only lowers it a
 * little), its speed cost is bounded, and a slow craft sinks — down is always the way out, and below
 * 3 km it melts in seconds.
 */
export const AIR = {
  /** The air thins from here to there (m): 0 … 1. */
  thinFrom: 3000,
  thinTo: 16000,
  /** At the thinnest: the speed the engines reach (−45%) and the control rates (−35%). */
  thrustLoss: 0.45,
  authLoss: 0.35,
  /** The slowest the craft holds its height (Mach): the floor speed in thick air, +2 in the thinnest. */
  stallMach: 0.9,
  stallThin: 2.0,
  /** Under it: the sink (m/s²) at a full Mach 0.6 short, and the nose falling toward the travel (rad/s). */
  sink: 45,
  nodDown: 1.0,
  /** Icing: the band (m) — up to full from 4 to 14 km, gone between 20 and 25 km. */
  iceFrom: 4000,
  iceFull: 14000,
  iceTop: 20000,
  iceGone: 25000,
  /** Kinetic heating: at Mach 7 the ice's level is 30% lower. */
  iceHeat: 0.3,
  /** At full ice: speed −35%, control −40%. */
  iceSpeed: 0.35,
  iceAuth: 0.4,
  /** Above this ice, one axis at a time locks for a moment (a chance a second that grows with the ice). */
  freezeAt: 0.55,
  /** Turbulence: from 4.5 km, full by 11 km, gone with the weather. (From 3.5 km it shook HUNT's usual
   *  fighting heights, 1–6 km, for nothing: the push back belongs above them.) */
  turbFrom: 4500,
  turbFull: 11000,
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
/** "Up" for level flight, banking and the view: the world's — or, near a planet in ORBIT, the planet's
 *  (set by the game; shared by the craft and its camera). */
export const UP_REF = new THREE.Vector3(0, 1, 0)
/** How much there is an "up" at all (1 in a world or near a planet, 0 in deep space): scales the
 *  auto-bank and self-levelling, turns A/D from a banked turn into a pure yaw about the craft's own
 *  vertical, and lets the camera follow the craft's roll instead of holding a horizon. */
export const FLY_LEVEL = { k: 1 }
const _ax = new THREE.Vector3()
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
  /** The nose's angular velocity in the world (rad/s) from the pitch and turn rates, roll left out: where
   *  the nose is swinging (the camera looks ahead along it). */
  readonly omega = new THREE.Vector3()
  /** Manual roll suspends the auto-bank for a moment after release. */
  private manualT = 0
  /** How long the air brake has been held (the snap is its first moments). */
  private brakeT = 0
  /** Rock can't hurt again until this runs out (s). */
  rockGrace = 0
  /** Events for the game: hits (damage), ground scrapes. */
  onHit: ((dmg: number, kind: 'ground' | 'rock') => void) | null = null
  /** FREE ROAM's damage is the game's (main.ts): when set, a rock contact is reported here — the speed
   *  into the face (m/s), its normal, and whether it was solid (a landform or a gorge wall, not a
   *  boulder) — instead of HUNT's damage. */
  onRock: ((impact: number, nx: number, nz: number, solid: boolean) => void) | null = null
  /** This step met the ground (it was put back on it), and the velocity it came in with. */
  groundHit = false
  readonly impactVel = new THREE.Vector3()
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
  /** The air (AIR): how thin (0 … 1), the ice on the craft (0 … 1), the turbulence (0 … 1), how far
   *  under the speed that holds height (0 … 1: mushing). */
  thin = 0
  ice = 0
  turb = 0
  mush = 0
  /** A control frozen by the ice: 0 none, 1 pitch, 2 turn; for how long (s). */
  frozen: 0 | 1 | 2 = 0
  frozenT = 0
  private freezeCd = 0
  private airT = 0
  /** A deterministic die for the freezes (replays and fast-sim tests see the same run). */
  private seed = 12345
  /** The game's warning when an axis freezes. */
  onFreeze: ((axis: 1 | 2) => void) | null = null

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
    this.rockGrace = 0
    this.brakeT = 0
    this.rates.set(0, 0, 0); this.omega.set(0, 0, 0)
    this.topMach = 0
    this.ice = 0; this.frozen = 0; this.frozenT = 0; this.freezeCd = 0; this.mush = 0
  }

  /** Set the attitude outright (a world handover): the nose and wings as given, velocity along the nose. */
  setAttitude(q: THREE.Quaternion, speed: number): void {
    this.quat.copy(q); this.prevQuat.copy(q); this.axes()
    this.speed = speed
    this.vel.copy(this.fwd).multiplyScalar(speed)
    this.aim.copy(this.fwd)
    this.rates.set(0, 0, 0); this.omega.set(0, 0, 0)
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
    this.airStep(dt)
    /** What the air and the ice leave of the engines and the controls (1 in thick air, clean). */
    const airK = 1 - this.vac
    const spdK = (1 - AIR.thrustLoss * this.thin * airK) * (1 - AIR.iceSpeed * this.ice)
    const authK = (1 - AIR.authLoss * this.thin * airK) * (1 - AIR.iceAuth * this.ice)

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
    // Iced up: the frozen axis doesn't answer (the rate stops as on a release).
    if (this.frozen === 1) pitchIn = 0
    else if (this.frozen === 2) turnIn = 0
    this.brakeT = c.brake ? this.brakeT + dt : 0
    const snap = c.brake && this.brakeT < F.brakeSnapTime ? F.brakeSnap : 1
    // (FREE ROAM and ORBIT keep their old flat rate and held brake bonus: tuned for touring, not fights.)
    let pitchMax = this.sandbox || this.unbound
      ? THREE.MathUtils.lerp(1.05, 0.7, THREE.MathUtils.clamp((this.mach - 2.6) / 2.4, 0, 1)) * (c.brake ? 1.25 : 1)
      : turnRate(this.mach) * snap
    pitchMax *= authK
    // (Equal to pitch: at 0.75× a Dart out-turned you on the keys.)
    const turnMax = pitchMax
    // Bank: the world's up seen from the cockpit (+ = rolled right).
    const bank = Math.atan2(-UP_REF.dot(this.right), UP_REF.dot(this.up))
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
      rollCmd = THREE.MathUtils.clamp(d * 2.5, -1, 1) * FLY_LEVEL.k // (deep space: nothing to level to)
    }
    // Rates build in a tenth of a second but stop in a twenty-fifth: letting go of a turn should stop
    // the nose where it is (at one easing both ways it carried on ~6° past — the gun never settled).
    const ease = 1 - Math.exp(-dt * 10), stop = 1 - Math.exp(-dt * 25)
    const pw = pitchIn * pitchMax, tw = turnIn * turnMax
    this.rates.x += (pw - this.rates.x) * (Math.abs(pw) < Math.abs(this.rates.x) || pw * this.rates.x < 0 ? stop : ease)
    this.rates.y += (tw - this.rates.y) * (Math.abs(tw) < Math.abs(this.rates.y) || tw * this.rates.y < 0 ? stop : ease)
    this.rates.z += (rollCmd * F.rollRate - this.rates.z) * ease
    // Turn about the world's up (pre-multiplied: a world-axis rotation); pitch and roll in the craft.
    // Turn about "up" — or, in deep space, about the craft's own vertical (a pure yaw). In ORBIT also
    // when the nose points along the planet's up (straight at it or away): a turn about the axis you
    // are looking down only spun the view, and A/D seemed dead from the spawn.
    let kUp = FLY_LEVEL.k
    if (this.unbound) { const a = this.fwd.dot(UP_REF); kUp *= 1 - a * a }
    _ax.copy(UP_REF).multiplyScalar(kUp).addScaledVector(this.up, 1 - kUp)
    if (_ax.lengthSq() < 1e-6) _ax.copy(this.up)
    _q.setFromAxisAngle(_ax.normalize(), -this.rates.y * dt); this.quat.premultiply(_q)
    // (Pitch about the right wing: the craft's −x.)
    this.omega.copy(_ax).multiplyScalar(-this.rates.y).addScaledVector(this.right, this.rates.x)
    _q.setFromAxisAngle(AX, -this.rates.x * dt); this.quat.multiply(_q)
    _q.setFromAxisAngle(AZ, this.rates.z * dt); this.quat.multiply(_q)
    // Turbulence: smooth, slow wander (a few incommensurate sines) — the wings rock, the nose bobs a
    // little; readable, never a twitch.
    if (this.turb > 0.01) {
      const t = this.airT, k = this.turb * (0.7 + 0.3 * this.ice)
      const nP = Math.sin(t * 1.9) * 0.6 + Math.sin(t * 3.7 + 1.3) * 0.4
      const nR = Math.sin(t * 1.3 + 2.1) * 0.6 + Math.sin(t * 2.9 + 0.4) * 0.4
      const nY = Math.sin(t * 0.9 + 4.2)
      _q.setFromAxisAngle(AX, nP * 0.07 * k * dt); this.quat.multiply(_q)
      _q.setFromAxisAngle(AZ, nR * 0.3 * k * dt); this.quat.multiply(_q)
      _q.setFromAxisAngle(AY, nY * 0.05 * k * dt); this.quat.multiply(_q)
      // and a little lift and drop (m/s² — a bump, not a fall)
      this.vel.y += (Math.sin(t * 2.3 + 0.7) * 0.6 + Math.sin(t * 4.1) * 0.4) * 18 * k * dt
    }
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
    // (FREE ROAM: up into space — src/space.ts; the limit is far beyond where the air ends.)
    const hard = this.unbound ? Infinity : this.sandbox ? 5000000 : F.hardCeiling
    const vac = this.vac
    // Off the throttle the speed creeps toward cruise; Shift pushes hard (energy), or toward the
    // throttle speed when the energy is gone.
    if (this.cruise > 0) this.speed += (this.cruise - this.speed) * (1 - Math.exp(-2.4 * dt))
    else if (this.sandbox) {
      // Held off the throttle (a little drag); W and Shift push toward their speeds, never pull back.
      const boost = 1 + 3 * vac
      if (c.brake) this.speed += Math.max(F.brakeMach * MACH - this.speed, -F.decel * 1.6 * boost * dt)
      else if (this.burning && this.speed < THREE.MathUtils.lerp(12, 80, vac) * MACH * spdK) this.speed += F.accel * 1.5 * boost * dt
      else if (c.throttle && this.speed < THREE.MathUtils.lerp(8.5, 30, vac) * MACH * spdK) this.speed += F.accel * boost * dt
      this.speed -= this.speed * 0.012 * (1 - vac) * dt
    } else {
      let target = (c.brake ? F.brakeMach : this.burning ? F.burnerMach : c.throttle || c.burner ? F.throttleMach : F.cruiseMach) * MACH
      target *= spdK
      // (Off the throttle it recovers at 0.5× — enough to hold a level full-rate turn at cruise, the corner:
      //  at 0.3× any sustained turn bled you to the floor speed, where the turn is worst.)
      const up = this.burning ? F.accel * 1.5 : c.throttle || c.burner ? F.accel : F.accel * 0.5
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
    // (Mushing — too slow for the thin air — the wings barely bend the travel: the nose points, the
    //  craft sinks.)
    const k = (c.brake ? 7 : this.burning ? 3 : F.follow) * (1 - 0.85 * this.mush)
    const dir = _v.copy(this.vel).normalize()
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.copy(this.fwd)
    dir.lerp(this.fwd, 1 - Math.exp(-k * dt)).normalize()
    this.vel.copy(dir).multiplyScalar(this.speed)

    // ── too slow for the air: it sinks, and the nose drops toward the travel (a stall's mush — the
    //    climb ends by itself, at a height set by the engines; diving gives the speed back) ──
    if (this.mush > 0) {
      this.vel.y -= AIR.sink * this.mush * dt
      const ve = Math.asin(THREE.MathUtils.clamp(this.vel.y / Math.max(1, this.vel.length()), -1, 1))
      const ne = Math.asin(THREE.MathUtils.clamp(this.fwd.y, -1, 1))
      if (ne > ve && ne > -0.35) { // (to −20° at most: a nod, not a dive to the ground)
        const ax = _w.crossVectors(this.fwd, UP)
        if (ax.lengthSq() > 1e-6) {
          _q.setFromAxisAngle(ax.normalize(), -Math.min(ne - ve, AIR.nodDown * this.mush * dt))
          this.quat.premultiply(_q); this.quat.normalize(); this.axes()
        }
      }
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
    this.groundHit = this.agl < 3
    if (this.agl < 3) {
      this.impactVel.copy(this.vel)
      const descent = -this.vel.y
      this.pos.y = g + 3
      if (this.vel.y < 0) this.vel.y = 0
      if (this.ghost <= 0 && descent > 40) this.hurt(descent > 220 ? 20 : 4, 'ground')
      this.agl = 3
    }
    // Hard ceiling.
    if (this.agl > hard) this.pos.y = g + hard

    // ── rock: solid (with height — over a mesa is clear air) ──
    // A touch slides you along the face: the speed into it is taken away (a little bounce), the nose is
    // turned to run along the wall, and only a real impact hurts — scaled by the speed into the rock,
    // then a grace. (It reflected the velocity and took 15 hull a contact, but the nose still pointed
    // in, so the craft re-scraped every few steps: grinding a wall cost ~60 hull a second.)
    const n = world.near(this.pos.x, this.pos.z, this.pos.y, 30, this.obs)
    for (let i = 0; i < n; i++) {
      const o = this.obs[i]
      const dx = this.pos.x - o.x, dz = this.pos.z - o.z
      const d = Math.hypot(dx, dz)
      if (d >= o.cr + 6 || d < 1e-3) continue
      const nx = dx / d, nz = dz / d
      this.pos.x = o.x + nx * (o.cr + 6); this.pos.z = o.z + nz * (o.cr + 6)
      const vn = this.vel.x * nx + this.vel.z * nz
      if (vn < 0) {
        this.vel.x -= nx * vn * 1.2; this.vel.z -= nz * vn * 1.2
        // (FREE ROAM: a graze — under 300 m/s into the face — only scrapes a little speed off.)
        const k = this.onRock && -vn < 300 ? 0.08 : 0.55 * Math.min(1, -vn / Math.max(1, this.speed))
        this.speed = Math.max(F.floorMach * MACH, this.speed * (1 - k))
      }
      // The nose off the face: along the wall, a few degrees out.
      const fn = this.fwd.x * nx + this.fwd.z * nz
      if (fn < 0.06) {
        _w.copy(this.fwd); _w.x += nx * (0.06 - fn); _w.z += nz * (0.06 - fn); _w.normalize()
        _q.setFromUnitVectors(this.fwd, _w); this.quat.premultiply(_q).normalize(); this.axes()
      }
      const impact = -vn
      if (this.onRock) { if (impact > 0) this.onRock(impact, nx, nz, o.big || !!o.wall) }
      else if (impact > F.rockSafe && this.ghost <= 0 && this.rockGrace <= 0) {
        // ~10 at a 20° glance at cruise, ~35 head-on at Mach 2.4, 45 at most.
        this.hurt(Math.min(45, 6 + (impact - F.rockSafe) * 0.05), 'rock')
        this.rockGrace = F.rockGrace
      }
    }

    this.ghost = Math.max(0, this.ghost - dt)
    this.rockGrace = Math.max(0, this.rockGrace - dt)
    this.sinceHurt += dt
    if (this.sinceHurt > 4) this.hull = Math.min(100, this.hull + 4 * dt)
  }

  /** The air at this height (AIR): thinning, mushing, turbulence, ice and its freezes. ORBIT has none
   *  (the ice melts off). */
  private airStep(dt: number): void {
    const A = AIR, S = THREE.MathUtils.smoothstep
    this.airT += dt
    if (this.frozenT > 0) { this.frozenT -= dt; if (this.frozenT <= 0) this.frozen = 0 }
    this.freezeCd = Math.max(0, this.freezeCd - dt)
    // (0 in vacuum, FREE ROAM — set from the height above the ground, as before.)
    this.vac = this.sandbox ? S(this.agl, 20000, 70000) : 0
    if (this.unbound) {
      this.thin = 0; this.turb = 0; this.mush = 0; this.frozen = 0; this.frozenT = 0
      this.ice *= Math.exp(-0.6 * dt)
      return
    }
    const alt = this.pos.y, airK = 1 - this.vac
    this.thin = S(alt, A.thinFrom, A.thinTo)
    // Holding height: a faster speed the thinner the air (not in vacuum — no lift needed, none had).
    const stall = (A.stallMach + A.stallThin * this.thin) * MACH
    // (Not scaled by the thinness: the floor speed — no stall — held a braked craft climbing slowly at
    //  Mach 0.9 from 8 to 9 km. In thick air the stall speed is the floor, so nothing changes down low.)
    this.mush = THREE.MathUtils.clamp((stall - this.speed) / (0.6 * MACH), 0, 1) * airK
    this.turb = S(alt, A.turbFrom, A.turbFull) * (1 - S(alt, A.iceTop, A.iceGone + 1000)) * airK
    // Ice: toward a level set by the height (higher in the band, more), a little lower the faster you
    // go (kinetic heating). It builds over ~6–10 s, melts in a few below 3 km — speed melts it faster
    // too, but nothing feeds back: the target never depends on the ice.
    const band = S(alt, A.iceFrom, A.iceFull) * (1 - S(alt, A.iceTop, A.iceGone))
    const heat = S(this.mach, 2.5, 7)
    const target = band * (1 - A.iceHeat * heat)
    const rate = target > this.ice ? 0.05 + 0.12 * band : (alt < A.thinFrom ? 0.5 : 0.15) + 0.3 * heat
    this.ice += (target - this.ice) * (1 - Math.exp(-rate * dt))
    // Freezes: past freezeAt, now and then one axis locks for 0.5–1.5 s (never both, a gap between).
    if (this.frozen === 0 && this.freezeCd <= 0 && this.ice > A.freezeAt && this.rnd() < (this.ice - A.freezeAt) * 1.6 * dt) {
      this.frozen = this.rnd() < 0.5 ? 1 : 2
      this.frozenT = 0.5 + this.rnd() * (0.4 + 0.6 * (this.ice - A.freezeAt) / (1 - A.freezeAt))
      this.freezeCd = this.frozenT + 1.5
      this.onFreeze?.(this.frozen)
    }
  }
  private rnd(): number { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296 }

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

/** Pitch / turn rate (rad/s) at Mach m: FLIGHT.rateCurve, linear between its points. */
export function turnRate(m: number): number {
  const C = FLIGHT.rateCurve
  if (m <= C[0][0]) return C[0][1]
  for (let i = 1; i < C.length; i++) if (m <= C[i][0]) return THREE.MathUtils.lerp(C[i - 1][1], C[i][1], (m - C[i - 1][0]) / (C[i][0] - C[i - 1][0]))
  return C[C.length - 1][1]
}

/** The flight camera: behind and above along nose and travel, horizon mostly level. It looks ahead
 *  along a turn, pulls back on the burner, and rides higher where you navigate to far-off targets. */
export class FlightCam {
  /** The camera's offset direction from the craft (smoothed), and its up (smoothed). Position is
   *  rebuilt from the craft every frame — smoothing the position itself lagged 130 m at Mach 3. */
  private readonly back = new THREE.Vector3(0, 0, -1)
  private readonly upS = new THREE.Vector3(0, 1, 0)
  private readonly fwdS = new THREE.Vector3(0, 0, 1)
  private init = false
  /** How much of the craft's roll the view takes (0 = horizon locked, 1 = cockpit). */
  horizon = 0.3
  /** Turbulence shake (0 … 1, set by the game each frame): a small, slow wobble of the view. */
  shake = 0
  private shakeT = 0
  /** The burner (0 … 1, set by the game): the view pulls back and widens, with a light buffet. */
  kick = 0
  private kickS = 0
  /** Far targets (0 … 1, set by the game — ORBIT, space): the camera rides higher and looks over the
   *  craft, so what the nose is on shows above it instead of behind it. */
  lift = 0
  private liftS = 0
  /** How far ahead along a turn the view looks (s of the nose's swing). */
  static readonly LEAD = 0.42
  private readonly omS = new THREE.Vector3()
  constructor(private readonly camera: THREE.PerspectiveCamera) {}
  snap(): void { this.init = false }
  /** omega: the nose's angular velocity (rad/s, world) — the view leads the nose by it. */
  update(dt: number, at: THREE.Vector3, q: THREE.Quaternion, vel: THREE.Vector3, mach: number, fovMax: number, punch = 0, omega: THREE.Vector3 | null = null): void {
    const fwd = _v.copy(AZ).applyQuaternion(q)
    const cUp = _w.copy(AY).applyQuaternion(q)
    const vdir = vel.lengthSq() > 1 ? vel.clone().normalize() : fwd.clone()
    // Where to look: ahead of the nose along its swing (a full-rate turn shows where it is going, ~12°
    // on). The camera swings round to the outside of the turn with most of it, so the craft slides only
    // a little toward the outside on screen (looking ahead alone threw it a quarter-screen sideways, and
    // a pull-up dropped it off the bottom). (It aimed at the nose itself, smoothed: in a hard turn the
    // nose ran 8° ahead of the view and the craft never moved on screen.)
    // (The swing itself eased — ~0.15 s — so letting go of a turn settles the view, never snaps it.)
    if (omega) this.omS.lerp(omega, 1 - Math.exp(-dt * 6))
    else this.omS.set(0, 0, 0)
    _lead.crossVectors(this.omS, fwd).multiplyScalar(FlightCam.LEAD)
    const wantFwd = fwd.clone().add(_lead).normalize()
    const wantBack = fwd.clone().addScaledVector(_lead, 1.1).multiplyScalar(0.7).addScaledVector(vdir, 0.3).normalize()
    // The view's up: the world's, taking a little of the craft's roll — and all of it when the craft
    // goes past vertical (through a loop the world's up would flip the view).
    // (Deep space: no horizon to hold — the view rolls with the craft.)
    const lean = THREE.MathUtils.lerp(1, THREE.MathUtils.clamp(this.horizon + Math.max(0, -cUp.dot(UP_REF)) * 1.4, 0, 1), FLY_LEVEL.k)
    const wantUp = UP_REF.clone().lerp(cUp, lean)
    if (wantUp.lengthSq() < 1e-4) wantUp.copy(cUp)
    wantUp.normalize()
    if (!this.init) { this.back.copy(wantBack); this.upS.copy(wantUp); this.fwdS.copy(wantFwd); this.kickS = this.kick; this.liftS = this.lift; if (omega) this.omS.copy(omega); this.init = true }
    // The swing: the offset direction trails the nose a little (hard pulls show the craft swinging
    // toward the outside of the turn), the up follows smoothly.
    this.back.lerp(wantBack, 1 - Math.exp(-dt * 7)).normalize()
    this.upS.lerp(wantUp, 1 - Math.exp(-dt * 5)).normalize()
    this.fwdS.lerp(wantFwd, 1 - Math.exp(-dt * 8)).normalize()
    // (The burner's pull-back eases in over ~0.4 s and out slower; the lift over a second or two.)
    this.kickS += (this.kick - this.kickS) * (1 - Math.exp(-dt * (this.kick > this.kickS ? 2.5 : 1.5)))
    this.liftS += (this.lift - this.liftS) * (1 - Math.exp(-dt * 1.5))
    const k = this.kickS, l = this.liftS
    const cam = this.camera
    // 14 m back and 4.6 up; the burner 3 m further; lifted, further and higher (the craft smaller and
    // lower on screen, the nose's target ~4° above the middle).
    cam.position.copy(at).addScaledVector(this.back, -(14 + 3 * k + 5 * l)).addScaledVector(this.upS, 4.6 + 0.6 * k + 3.4 * l)
    const g = groundH(cam.position.x, cam.position.z)
    if (cam.position.y < g + 1.6) cam.position.y = g + 1.6
    cam.up.copy(this.upS)
    const lu = 1.2 + 2.6 * l
    cam.lookAt(at.x + this.fwdS.x * 45 + this.upS.x * lu, at.y + this.fwdS.y * 45 + this.upS.y * lu, at.z + this.fwdS.z * 45 + this.upS.z * lu)
    const sh = this.shake + 0.35 * k
    if (sh > 0.01) {
      // (Low frequencies, under half a degree: a buffeting, not a flicker.)
      const t = (this.shakeT += dt), kk = Math.min(1, sh) * 0.007
      cam.rotateX((Math.sin(t * 7.1) * 0.6 + Math.sin(t * 11.3 + 1.7) * 0.4) * kk)
      cam.rotateY((Math.sin(t * 6.3 + 0.9) * 0.6 + Math.sin(t * 9.7 + 2.3) * 0.4) * kk)
    }
    const s = THREE.MathUtils.clamp((mach - 1) / 4, 0, 1)
    cam.fov += (72 + (fovMax - 72) * s + 6 * k + punch - cam.fov) * (1 - Math.exp(-dt * 3))
    cam.updateProjectionMatrix()
  }
}
const _lead = new THREE.Vector3()
