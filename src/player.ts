// A craft's simulation (the player's and every AI racer's): the speed model (no brakes to zero;
// violent boost; the Mach 6 barrier), handling (twitchy yaw, drift, strafe), ground effect
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
import { rand } from './rng'
import { CFG, MACH } from './config'
import { BIOME, groundH } from './terrain'

/** POLAR SHELF and CINDER: a touch more grip (their long fast sweepers read as icy) — slight, on purpose. */
const WORLD_GRIP = BIOME === 'desert' ? 1 : 1.1
import type { Obstacle, World } from './world'

export interface Controls {
  steer: number // -1 left … 1 right
  /** W: the throttle (cruise up to throttleMach). */
  boost: boolean
  /** Shift: the afterburner (to Mach 6+, burns energy). */
  burner?: boolean
  brake: boolean
  strafe: number // -1 … 1
}

export type BarrierPhase = 'none' | 'silence' | 'boom'

const GRAVITY = 34
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
  /** Strafe sideways velocity (decays on its own). Turning toward it folds part of it into forward
   *  speed — strafing into a bend gains speed: a kept technique (found by an agent, worth seconds). */
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
  /** The afterburner's hard ceiling (safety only). */
  capMach = CFG.speed.burnCap
  /** The steering input as it reaches the craft (slew-limited by speed). */
  steerIn = 0
  /** Slew-limit the stick (yours; the AI's steering is already smooth). */
  slew = true
  /** × the burner's soft limit (AI skill spread; a racer well behind gets a little). */
  burnMul = 1
  /** How much a slipstream does for this craft (the player's is much bigger). */
  draftMul = 1
  /** 0 … 1 = within grip, > 1 = sliding (for the gauge). */
  gripLoad = 0
  /** 0 … 1: how close the slide is to a spin-out. */
  spinRisk = 0
  /** Slip angle (rad): + = travelling to the right of the nose. */
  slip = 0
  /** Seconds left of a spin-out (no control). */
  spin = 0
  /** Flip animation, 1 → 0 (visual roll of two full turns). */
  tumble = 0
  tumbleDir = 1
  /** Drift boost charge (0 … 2.6; level 1 at 0.9, level 2 at 2). */
  drift = 0
  drifting = false
  /** Wind clock and phase (each craft its own), and the wake it is in (0 … 1, set by the race). */
  windT = 0
  /** Each craft's wind phase (seeded per race: see Race.reset). */
  windPh = rand() * 100
  wake = 0
  /** The turn rate full lock asks for right now (rad/s): the grip limit at this speed (see step). */
  turnMax = 1
  /** Steering assist 0 … 1 (more grip, more self-align, automatic countersteer). */
  assist = 0.6
  bankV = 0
  pitchV = 0
  onSpin: ((flip: boolean) => void) | null = null
  onDriftBoost: ((level: number) => void) | null = null
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
  /** The burner lit; k = how much of its start kick it had (0–1: it refills over 1.5 s off the burner). */
  onBoostStart: ((k: number) => void) | null = null
  private wasBurn = false
  /** Seconds since the burner last burned (its start kick refills over 1.5 s of that). */
  private burnOff = 9
  /** The afterburner is lit this step (steering mostly locked). */
  burning = false
  /** What the stick asked for (the HUD flags steering against a lit afterburner). */
  steerWant = 0
  /** Throttle, smoothed (0 … 1). `boost` is the afterburner, smoothed. */
  throttle = 0
  // ── the crash: a wreck tumbling with real momentum ──
  crashing = false
  crashT = 0
  /** Visual tumble angles (pitch, yaw offset, roll) and their rates. */
  readonly crashRot = new THREE.Vector3()
  readonly crashW = new THREE.Vector3()
  readonly crashVel = new THREE.Vector3()
  crashGround = false
  /** Set when a crash ends and the craft should be put back (race / hunt consume it). */
  recovered = false
  onCrashStart: ((sev: number, destroyed: boolean, x: number, y: number, z: number, nx: number, nz: number) => void) | null = null
  onBounce: ((impact: number) => void) | null = null
  private lastMach = 0
  private readonly obs: Obstacle[] = []

  reset(x = 0, z = 0, heading = 0, mach = CFG.speed.launchMach): void {
    this.heading = this.prevHeading = heading
    this.updateAxes()
    this.pos.set(x, this.ground(x, z) + CFG.handling.hover, z)
    this.prev.copy(this.pos)
    this.speed = mach * MACH
    this.lateral = 0
    this.side = 0
    this.vy = 0
    this.yawRate = 0
    this.airborne = false
    this.airTime = 0
    this.squash = 0
    this.slip = 0
    this.spin = 0
    this.recover = 0
    this.tumble = 0
    this.crashing = false
    this.crashT = 0
    this.crashRot.set(0, 0, 0)
    this.recovered = false
    this.throttle = 0
    // (Everything that carries state between steps, back to a fresh craft: a restarted race must run exactly
    // as the first one did — a replay of its inputs in the same page drifted on boost/steer smoothing.)
    this.agl = 0; this.boost = 0; this.brake = 0; this.accel = 0; this.sinceHurt = 10; this.steerIn = 0
    this.gripLoad = 0; this.wake = 0; this.turnMax = 1; this.steerWant = 0
    this.drift = 0
    this.wasBurn = false; this.burnOff = 9
    this.bankV = this.pitchV = 0
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
    if (this.spin > 0 || this.recover > 0) { this.spinVx = vx; this.spinVz = vz; this.speed = Math.hypot(vx, vz); return }
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
      const g = this.ground(this.pos.x, this.pos.z)
      this.pos.y = g + CFG.handling.hover
      this.throttle += ((c.boost ? 1 : 0) - this.throttle) * Math.min(1, dt * 6)
      this.boost += ((c.burner ? 1 : 0) - this.boost) * Math.min(1, dt * 6)
      this.speed = 0
      this.vel.set(0, 0, 0)
      return
    }
    if (this.crashing) { this.crashStep(dt, world); return }
    if (this.dead) {
      this.speed *= Math.exp(-1.2 * dt)
      this.pos.addScaledVector(this.fwd, this.speed * dt)
      this.pos.y = Math.max(this.ground(this.pos.x, this.pos.z) + 0.8, this.pos.y - 20 * dt)
      return
    }
    if (this.sinceHurt > 3) this.hull = Math.min(100, this.hull + 5 * dt)

    const S = CFG.speed
    const H = CFG.handling
    const m = this.speed / MACH

    // ── speed ──
    // W accelerates to Mach 6.3. Shift is the afterburner: speed with no ceiling, at the price of the
    // steering (mostly locked while it burns — the HUD says so).
    // The barrier's half-second of silence pauses the burner's thrust only. (It used to switch the
    // burner off outright: its steering lock let go for exactly that half-second — full authority,
    // half the damping — and the craft snapped across from whatever steer you held; then the burner
    // 'restarted' at the boom and kicked again.)
    const burning = !!c.burner
    const thrust = burning && this.barrier !== 'silence'
    // The start kick is a charge: full after 1.5 s off the burner, a fraction of it sooner. (It was full on
    // every press: tapping the burner on and off stacked +Mach 0.3 kicks every other step — an agent rode
    // it to Mach 39 and a 9 s MISTRIVER. A press now feels the same; spamming it gains nothing.)
    if (burning && !this.wasBurn) {
      const k = Math.min(1, this.burnOff / 1.5)
      this.speed += S.boostKick * k
      this.onBoostStart?.(k)
    }
    this.burnOff = burning ? 0 : this.burnOff + dt
    this.wasBurn = burning
    this.burning = burning
    const boosting = !!c.boost || burning
    this.throttle += ((boosting ? 1 : 0) - this.throttle) * Math.min(1, dt * 5)
    this.boost += ((boosting ? (burning ? 1 : 0.6) : 0) - this.boost) * Math.min(1, dt * 6)
    // The brake comes on progressively (~0.3 s), not as a wall.
    this.brake += ((c.brake ? 1 : 0) - this.brake) * Math.min(1, dt * 3.5)
    // W is the throttle. Off it, you coast down (air and sand drag); there is no cruise control.
    let target = 0
    let k = S.coastK
    if (this.brake > 0.02 && !this.airborne && !boosting) { target = S.brakeMach * MACH; k = S.brakeK * this.brake * (Math.abs(c.steer) > 0.5 ? 0.45 : 1) }
    // (The burner includes the throttle and adds to it: it used to replace W, so a Shift launch was
    // slower than a W one — W's pull below Mach 6 is far stronger than the burner's 230 m/s².)
    else if (c.boost || burning) {
      target = Math.min(S.boostMach, this.maxMach) * MACH
      // Holding W keeps what the afterburner gave you (it never bleeds it away); below Mach 1 the
      // engines are still spooling — a slow start, then they bite.
      // Above it, a light drag (0.04/s): burner speed is something to manage, not a deposit kept all race
      // (it decided races by 25 s, and the AI's speed ceiling did nothing).
      k = this.speed > target ? 0.04 : S.boostK * (0.32 + 0.68 * THREE.MathUtils.smoothstep(m, 0.55, 1.15))
    }
    // (In the air there is nothing to push against: the engines only hold speed.)
    if (this.airborne) k *= 0.35
    const before = this.speed
    // Slipstream: in a rival's wake the air is thinner — a pull forward (and the buffeting above).
    if (this.wake > 0) this.speed += 110 * this.draftMul * this.wake * dt
    // The burner's push fades as you near its soft limit (thin air, not a wall); in a slipstream the
    // limit rises — that is how you close on someone faster.
    const soft = S.burnSoft * this.burnMul * (1 + 0.22 * this.draftMul * this.wake)
    if (thrust) this.speed += S.burnAccel * dt * (this.airborne ? 0.5 : 1) * Math.max(0, 1 - (m / soft) ** 2)
    if (!thrust || this.speed < target) this.speed += (target - this.speed) * (1 - Math.exp(-k * dt))
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
          // (Only if still at the barrier: it set Mach 6.05 outright, so braking or a hit during the
          //  silence flung you from Mach 2.6 back to 6 — tools/physcheck.mjs.)
          if (this.speed >= 5.6 * MACH) {
            this.barrier = 'boom'
            this.barrierT = 0
            this.speed = Math.max(this.speed, 6.05 * MACH)
            this.onBarrier?.('boom')
          } else { this.barrier = 'none'; this.barrierCooldown = 2 }
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

    const free = this.spin > 0 || this.recover > 0
    if (free) this.spinStep(dt)
    else {
      // ── steering: slip angle, a grip curve, yaw momentum ──
      // The nose and the direction of travel are two different things. Grip pulls the travel toward the
      // nose up to a peak slip angle and falls away past it: hold too much steer at speed, trail the
      // brake into a turn, or land crooked, and the craft slides; keep sliding and it spins; spin at
      // speed and it flips. Countersteer catches it. A held, controlled slide charges a drift boost.
      const A = this.assist
      const ab0 = Math.abs(Math.atan2(this.lateral, Math.max(this.speed, 1)))
      const hs0 = Math.hypot(this.speed, this.lateral)
      const peak = H.slipPeak
      const curveOf = (ab: number) => (ab < peak ? 0.35 + (0.65 * ab) / peak : Math.max(H.slideFloor, 1 - (ab - peak) * 1.3))
      let curve = curveOf(ab0)
      if (this.spin > 0) curve = Math.min(curve, 0.3)
      const beta0 = Math.atan2(this.lateral, Math.max(this.speed, 1))
      // The stick reaches the craft more slowly the faster you go (8/s at low speed → 2.6/s past Mach 6):
      // a tap is a small correction at Mach 6, a held lock still builds into a slide. ("A little too
      // responsive" at high speed — the authority stays, the twitch goes.)
      // …but letting go (or easing off) is quick, like a wheel that centres itself: the slow release
      // kept the craft turning ~25° after the key came up — release, overshoot, correct, wobble.
      const easing = Math.abs(c.steer) < Math.abs(this.steerIn) || c.steer * this.steerIn < 0
      const rate = !this.slew ? 100 : easing ? 12 : THREE.MathUtils.lerp(10, 4, THREE.MathUtils.clamp((m - 2) / 4, 0, 1))
      this.steerIn += THREE.MathUtils.clamp(c.steer - this.steerIn, -rate * dt, rate * dt)
      let steer = this.spin > 0 ? 0 : this.steerIn
      // Assist: automatic countersteer once past the peak — but only when you are not steering into the
      // turn yourself (neutral, or already countering). It catches the slide you let go of; it never
      // fights a turn you are asking for (it used to cancel your lock exactly when you pushed).
      if (A > 0 && ab0 > peak && steer * Math.sign(beta0) >= -0.15) steer = THREE.MathUtils.clamp(steer + Math.sign(beta0) * Math.min(1, (ab0 - peak) * 3) * A, -1, 1)
      // The stick asks for a TURN RATE, not a torque. Full lock = the tightest turn the grip can hold at
      // this speed (lateral grip at the peak slip ÷ speed); half lock half that; the craft tracks it,
      // damped. (It was a torque with yaw momentum, and full lock asked for more than the grip held at
      // speed: keys only send nothing or full lock, so a player either didn't turn or slid — while the
      // AI fed small analog amounts plus its own yaw damping. tools/gripcompare.mjs: a key driver was
      // past the grip limit 55-60% of the time, off the line 70-80%; the AI 0%.)
      // Assist sets how close to the limit full lock goes (off: a little past it, a slide if held;
      // high: just inside). The brake asks for more (and lightens the grip): a trail-brake still starts
      // a drift on purpose. The afterburner holds the line: a fraction of the turn.
      const gripPeak = (this.airborne ? H.airControl : 1) * ((H.gripK * (1 + A * 0.2) + H.gripQ * hs0) * hs0 + H.gripLow) * WORLD_GRIP
      const omegaGrip = Math.min(2.2, gripPeak / Math.max(hs0, 60))
      this.turnMax = omegaGrip * (1.12 - 0.2 * A) * (this.burning ? 0.1 : 1)
      const yawWant = -steer * this.turnMax * (1 + 0.35 * this.brake)
      // Weathervane: with grip, the nose is pulled back toward the travel.
      const align = (this.airborne ? H.airControl : 1) * -H.alignK * (1 + A * 0.5) * (1 + hs0 / 1400) * Math.sin(beta0) * curve * Math.min(1, hs0 / 250)
      this.steerWant = c.steer
      // Chaos: gusts at speed (smooth, never twitchy noise) and the wake of a rival just ahead (rough).
      this.windT += dt
      const fast = THREE.MathUtils.clamp((m - 2) / 4, 0, 1)
      const n1 = Math.sin(this.windT * 0.83 + this.windPh) * 0.55 + Math.sin(this.windT * 2.1 + this.windPh * 2) * 0.3 + Math.sin(this.windT * 4.7 + this.windPh * 3) * 0.15
      const n2 = Math.sin(this.windT * 1.37 + this.windPh * 5) * 0.6 + Math.sin(this.windT * 3.3 + this.windPh) * 0.4
      const rough = this.wake > 0 ? Math.sin(this.windT * 23 + this.windPh) * 0.6 + Math.sin(this.windT * 37) * 0.4 : 0
      this.side += (n1 * H.gust * fast + rough * 140 * this.wake) * dt * (this.airborne ? 1.5 : 1)
      const gustYaw = (n2 * H.gustYaw * fast + rough * 0.9 * this.wake) * (this.airborne ? 1.5 : 1)
      // Track the asked-for rate (yawDamp: ~0.2 s to settle; in the air, slower).
      // (Unwinding — asking for less turn than there is — goes faster than winding up: the turn stops
      //  where you let go.)
      const unwind = Math.abs(yawWant) < Math.abs(this.yawRate) || yawWant * this.yawRate < 0
      const track = H.yawDamp * 1.4 * (this.airborne ? 0.6 : 1) * (this.burning ? 1.6 : 1) * (unwind ? 1.8 : 1)
      this.yawRate += ((yawWant - this.yawRate) * track + align * (this.burning ? 0.4 : 1) + gustYaw) * dt
      this.heading += this.yawRate * dt
      // Turning keeps the velocity: re-split it against the new heading (the slide is real — and the strafe
      // drift with it: strafing into a bend gains speed, a kept technique; see `side`).
      const lat0 = this.lateral + this.side
      const hvx = this.fwd.x * this.speed + this.right.x * lat0
      const hvz = this.fwd.z * this.speed + this.right.z * lat0
      this.updateAxes()
      this.setHorizontal(hvx, hvz)

      // (There was a dodge — double-tap Q/E for an instant 170 m/s sideways kick, one every 0.25 s. Removed
      // 2026-11-25: barely discoverable, and its best use — tapped 4 times a second through a bend — was out of
      // a human's reach. Strafe is the sideways control.)
      this.side += (this.spin > 0 ? 0 : c.strafe) * H.strafe * (this.airborne ? 0.5 : 1) * dt
      this.side *= Math.exp(-3.2 * dt)

      // Grip: lateral acceleration capped by the curve (and halved-ish under the brake: a trail-brake
      // breaks traction — that is how a drift is started on purpose).
      const beta = Math.atan2(this.lateral, Math.max(this.speed, 1))
      const ab = Math.abs(beta)
      curve = this.spin > 0 ? Math.min(curveOf(ab), 0.3) : curveOf(ab)
      const brakeGrip = c.brake && !this.airborne ? H.driftBrakeGrip : 1
      // Ground effect grows with speed like downforce: the turn rate grip can hold is gripK + gripQ·v,
      // so a slow start is loose and twitchy, and flat-out is planted.
      const gripAcc = (this.airborne ? H.airControl : 1) * ((H.gripK * (1 + A * 0.2) + H.gripQ * hs0) * hs0 + H.gripLow) * curve * brakeGrip * WORLD_GRIP
      const dl = Math.sign(this.lateral) * Math.min(Math.abs(this.lateral), gripAcc * dt)
      this.lateral -= dl
      // (Energy: the slide joins the forward speed as a vector, never added to it. A carve keeps most
      // of it; a slide scrubs.)
      this.speed = Math.sqrt(this.speed * this.speed + dl * dl * (ab < peak * 1.4 ? 0.85 : 0.3))
      if (ab > peak && !this.airborne) this.speed *= 1 - Math.min(0.4, (ab - peak) * 0.28) * dt
      this.speed = Math.min(this.speed, this.capMach * MACH)
      this.slip = beta
      // Grip load for the gauge: 1 = at the limit (the peak slip angle, or the turn rate grip can hold).
      const omegaMax = H.gripK * (1 + A * 0.2) + H.gripQ * hs0 + H.gripLow / Math.max(hs0, 50)
      this.gripLoad = this.airborne ? 0 : Math.max(ab / peak, Math.abs(this.yawRate) / omegaMax * brakeGrip ** -1)
      this.spinRisk = this.airborne ? 0 : THREE.MathUtils.clamp((ab - peak) / (H.spinSlip + A * 0.35 - peak), 0, 1)

      // Spin-out: past the spin angle at speed, control is gone. Fast enough: it flips too.
      if (!this.airborne && ab > H.spinSlip + A * 0.35 && hs0 > 300) this.startSpin(hs0 > 1150 && ab > H.spinSlip + 0.2)
      if (this.tumble > 0) this.tumble = Math.max(0, this.tumble - dt / 1.25)

      // Drift boost: charge while sliding under control; straighten out to release it.
      const drifting = !this.airborne && this.spin <= 0 && ab > 0.17 && ab < H.spinSlip && hs0 > 400
      this.drifting = drifting
      if (drifting) this.drift = Math.min(2.6, this.drift + dt * (0.7 + ab * 2))
      else if (this.drift > 0) {
        if (ab < 0.1) {
          const lvl = this.drift >= 2 ? 2 : this.drift >= 0.9 ? 1 : 0
          if (lvl) { this.speed += (lvl === 2 ? 1.1 : 0.6) * MACH; this.onDriftBoost?.(lvl) }
          this.drift = 0
        } else this.drift = Math.max(0, this.drift - dt * 0.6)
      }
    }
    if (this.tumble > 0 && free) this.tumble = Math.max(0, this.tumble - dt / 1.25)

    // ── ground effect / flight ──
    const g0 = this.ground(this.pos.x, this.pos.z)
    const ax = this.vel.x, az = this.vel.z
    const hs = Math.hypot(ax, az) || 1
    const ux = ax / hs, uz = az / hs
    // Slope along the direction of travel, here and 40 m on.
    const gA = this.ground(this.pos.x + ux * 20, this.pos.z + uz * 20)
    const gB = this.ground(this.pos.x - ux * 20, this.pos.z - uz * 20)
    const gC = this.ground(this.pos.x + ux * 60, this.pos.z + uz * 60)
    const slope = (gA - gB) / 40
    const slopeAhead = (gC - gA) / 40
    const ride = g0 + H.hover
    // (Steeper than a landform's skirt, ~1:1.1: the hover rides down a flank and only falls off a real
    //  face. At −0.7 every skirt was a cliff — a W-only drive spent a third of its time falling.)
    if (!this.airborne && this.cliffs && slope < -1.4) {
      // Off the edge of a mesa: keep the height and fall from it. (With no more lift than a crest's
      // launch: riding up a landform's flank the hover climbs at hundreds of m/s, and kept, that threw
      // the craft 1.5–2.5 km into the sky off a lip.)
      this.airborne = true
      this.airTime = 0
      this.vy = THREE.MathUtils.clamp(this.vy, 0, 10 + 2 * m)
      this.onLaunch?.(0)
    }
    if (!this.airborne) {
      const terrainVy = slope * hs
      // Launch: rising, and the ground is about to fall away faster than the ground effect can hold.
      // (The bar rises with speed: at Mach 6 every dune was a ramp and the craft lived in the air.)
      // (FREE ROAM — `cliffs` — holds the ground harder: a crest takes half as much again to let go,
      //  and its hop is low and short, ~1.3 s at Mach 6. Driving W-only, the hover was in the air 40%
      //  of the time on hops alone.)
      if (slope > 0.02 && (slope - slopeAhead) * hs > (LAUNCH_DV + 0.05 * hs) * (this.cliffs ? 1.5 : 1)) {
        this.airborne = true
        this.airTime = 0
        // (Toned down: ~3.5 s of air at Mach 11, ~2.5 s at Mach 6.)
        this.vy = Math.min(terrainVy, this.cliffs ? 10 + 2 * m : 18 + 4 * m)
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
      // (FREE ROAM: falling, the ground effect pulls it down harder — a hop comes back to the ground.)
      this.vy -= (GRAVITY * (this.cliffs && this.vy < 0 ? 1.8 : 1) + (c.brake && this.tumble <= 0 ? 120 : 0)) * dt
      this.pos.y += this.vy * dt
      // On a ramp's rising face the ground climbs far faster than the launch (~1 km/s at Mach 10
      // against ~75 m/s): it re-landed the next frame, on every course — "sticky to the floor". Riding
      // the face to the crest makes the launch real.
      if (this.pos.y <= ride && this.airTime < 0.8 && slope > 0.01) {
        this.pos.y = ride
        this.vy = Math.max(this.vy, Math.min(slope * hs, this.cliffs ? 10 + 2 * m : 18 + 4 * m))
      } else if (this.pos.y <= ride) {
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
        // Landed crooked (the nose turned away from the travel in the air): it bites and spins.
        const lb = Math.abs(Math.atan2(this.lateral, Math.max(this.speed, 1)))
        if (this.spin <= 0 && this.recover <= 0 && this.tumble <= 0 && this.airTime > 0.3) {
          if (lb > 1.15 + this.assist * 0.3 && hs > 700) this.startSpin(true)
          else if (lb > 0.62 + this.assist * 0.3) this.startSpin(false)
        }
      }
    }
    this.squash = Math.max(0, this.squash - dt * 3.5)
    this.agl = this.pos.y - g0

    const lat = this.lateral + this.side
    if (this.spin > 0 || this.recover > 0) this.vel.set(this.spinVx, this.vy, this.spinVz)
    else this.vel.set(this.fwd.x * this.speed + this.right.x * lat, this.vy, this.fwd.z * this.speed + this.right.z * lat)
    this.pos.x += this.vel.x * dt
    this.pos.z += this.vel.z * dt
    // (The ground step above used the height before this move: at Mach 8 that is 20 m back, and rising
    //  ground could put the hull a little into it for a step. Never under the surface where it is now.)
    {
      const gN = this.ground(this.pos.x, this.pos.z)
      if (this.pos.y < gN + 1.2) this.pos.y = gN + 1.2
    }

    // ── visual attitude ──
    // Floaty: bank and pitch are under-damped springs (they lean, overshoot a touch, settle).
    const bankT = THREE.MathUtils.clamp(this.yawRate * 0.42 + Math.sin(this.slip) * 0.3 + (this.side / 400) * 0.3, -0.6, 0.6)
    this.bankV += ((bankT - this.bank) * 55 - this.bankV * 6.5) * dt
    this.bank += this.bankV * dt
    let pitchT: number
    if (this.airborne) {
      // Nose on the flight path; levelling toward the ground's slope as it comes up.
      const path = -Math.atan2(this.vy, hs) * 0.8
      const lvl = THREE.MathUtils.clamp(1 - this.agl / 40, 0, 1)
      pitchT = THREE.MathUtils.lerp(path, -Math.atan(slope), lvl * 0.8)
    } else {
      pitchT = -Math.atan(slope) - THREE.MathUtils.clamp(this.accel / 600, -0.08, 0.1)
    }
    this.pitchV += ((pitchT - this.pitch) * 40 - this.pitchV * 6) * dt
    this.pitch += this.pitchV * dt

    this.collide(world)
  }

  /** Travel during a spin-out: world-space, independent of the whirling nose. */
  spinVx = 0
  spinVz = 0
  /** After the spin: the nose settling back onto the travel (seconds left). */
  recover = 0
  private spinTime = 0

  private startSpin(flip: boolean): void {
    if (this.spin > 0 || this.recover > 0) return
    const lat = this.lateral + this.side
    this.spinVx = this.fwd.x * this.speed + this.right.x * lat
    this.spinVz = this.fwd.z * this.speed + this.right.z * lat
    this.spin = 3
    this.spinTime = 0
    this.drift = 0
    // Whirl the way it was already going: fast, decaying — about one and a quarter turns.
    const dir = Math.abs(this.yawRate) > 0.2 ? Math.sign(this.yawRate) : this.slip > 0 ? -1 : 1
    this.yawRate = dir * (7.5 + rand() * 2)
    if (flip) {
      this.tumble = 1
      this.tumbleDir = this.slip > 0 ? 1 : -1
      this.airborne = true
      this.airTime = 0
      this.vy = 22
      this.spinVx *= 0.62
      this.spinVz *= 0.62
      this.hull -= 22
      this.sinceHurt = 0
    }
    this.onSpin?.(flip)
  }

  /** The spin-out itself: the hull whirls, the travel carries on and scrubs, control comes back. */
  private spinStep(dt: number): void {
    const travel = Math.atan2(this.spinVx, this.spinVz)
    if (this.spin > 0) {
      this.spinTime += dt
      this.heading += this.yawRate * dt
      this.yawRate *= Math.exp(-1.05 * dt)
      const k = Math.exp(-(this.airborne ? 0.05 : 0.38) * dt)
      this.spinVx *= k
      this.spinVz *= k
      this.spin -= dt
      if (this.spin <= 0 || (this.spinTime > 0.8 && Math.abs(this.yawRate) < 1.1)) {
        this.spin = 0
        this.recover = 0.7
      }
    } else {
      // Recovering: the nose eases round onto the travel, then grip takes over again.
      let dh = travel - this.heading
      dh = Math.atan2(Math.sin(dh), Math.cos(dh))
      this.heading += dh * (1 - Math.exp(-7 * dt))
      this.yawRate = 0
      this.recover -= dt
      if (this.recover <= 0 || Math.abs(dh) < 0.04) this.recover = 0
    }
    this.updateAxes()
    const hs = Math.hypot(this.spinVx, this.spinVz)
    this.speed = hs
    this.lateral = 0
    this.side = 0
    let sl = travel - this.heading
    sl = Math.atan2(Math.sin(sl), Math.cos(sl))
    this.slip = -sl
    this.gripLoad = 0
    this.spinRisk = this.spin > 0 ? 1 : 0
    this.drifting = false
    if (this.recover === 0 && this.spin === 0) this.setHorizontal(this.spinVx, this.spinVz)
  }

  /**
   * A crash: the craft bounces off what it hit (normal speed reflected at 0.3, the rest scrubbed),
   * is thrown into the air and cartwheels — pitch, roll and yaw at rates set by how hard it was —
   * then bounces and grinds along the sand until it stops. (nx, nz): away from the obstacle.
   */
  startCrash(sev: number, nx: number, nz: number): void {
    if (this.crashing || this.dead) return
    // Off the rock, not back up the track: the tangential part carries on, a share of the original
    // momentum skids it round the obstacle, the normal part bounces weakly. Low and fast — it
    // cartwheels and grinds along the sand rather than flying.
    const vx = this.vel.x, vz = this.vel.z
    const vn = vx * nx + vz * nz
    const tx = vx - vn * nx, tz = vz - vn * nz
    const sp = Math.hypot(vx, vz) || 1
    let cx = tx * 0.6 + (vx / sp) * sp * 0.22 - Math.min(vn, 0) * 0.25 * nx + nx * 35
    let cz = tz * 0.6 + (vz / sp) * sp * 0.22 - Math.min(vn, 0) * 0.25 * nz + nz * 35
    // Head-on, the tangential part is ~0: glance it off to one side instead of straight back.
    if (Math.hypot(tx, tz) < sp * 0.3) { const sd = rand() < 0.5 ? 1 : -1; cx += -nz * sd * sp * 0.25; cz += nx * sd * sp * 0.25 }
    const ch = Math.hypot(cx, cz)
    if (ch > 650) { cx *= 650 / ch; cz *= 650 / ch }
    this.crashVel.set(cx, 8 + Math.min(20, sev * 7), cz)
    const k = Math.min(1.6, 0.5 + sev)
    const r = () => (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.6)
    this.crashW.set(r() * 9 * k, r() * 5 * k, r() * 13 * k)
    this.crashRot.set(0, 0, 0)
    this.crashing = true
    this.crashT = 0
    this.crashGround = false
    this.spin = 0
    this.recover = 0
    this.tumble = 0
    this.drift = 0
    this.airborne = true
    this.hull -= Math.min(65, 18 + sev * 40)
    this.sinceHurt = 0
    this.onCrashStart?.(sev, this.hull <= 0, this.scrapeAt.x, this.scrapeAt.y, this.scrapeAt.z, nx, nz)
  }

  private readonly cobs: Obstacle[] = []
  private crashStep(dt: number, world: World): void {
    this.crashT += dt
    const cv = this.crashVel
    cv.y -= 34 * dt
    this.pos.addScaledVector(cv, dt)
    const g = this.ground(this.pos.x, this.pos.z)
    this.crashGround = false
    if (this.pos.y < g + 1.1) {
      this.pos.y = g + 1.1
      if (cv.y < -6) {
        const impact = -cv.y
        cv.y = impact * 0.34
        // Each bounce kicks the tumble about.
        this.crashW.x += (rand() - 0.5) * impact * 0.12
        this.crashW.z += (rand() - 0.5) * impact * 0.16
        this.onBounce?.(impact)
      } else { cv.y = Math.max(cv.y, 0); this.crashGround = true }
    }
    const hs = Math.hypot(cv.x, cv.z)
    if (this.crashGround) {
      // Grinding along the sand: friction on the speed and on the spin; it settles flat.
      const f = Math.exp(-1.5 * dt)
      cv.x *= f; cv.z *= f
      this.crashW.multiplyScalar(Math.exp(-2.6 * dt))
      this.crashRot.x *= Math.exp(-2 * dt)
      this.crashRot.z += (Math.round(this.crashRot.z / Math.PI) * Math.PI - this.crashRot.z) * Math.min(1, dt * 2)
    } else this.crashW.multiplyScalar(Math.exp(-0.25 * dt))
    this.crashRot.addScaledVector(this.crashW, dt)
    // Rock still stops a wreck.
    const n = world.near(this.pos.x, this.pos.z, this.pos.y, 20, this.cobs)
    for (let i = 0; i < n; i++) {
      const o = this.cobs[i]
      const dx = this.pos.x - o.x, dz = this.pos.z - o.z, d = Math.hypot(dx, dz)
      if (d >= o.cr + 2) continue
      const nx = dx / (d || 1), nz = dz / (d || 1)
      // (At most 25 m a step: coming down onto a landform from above put the wreck deep inside it, and
      //  one push threw it 100+ m sideways. Now it slides off over a few frames.)
      const push = Math.min(o.cr + 2 - d, 25)
      this.pos.x += nx * push; this.pos.z += nz * push
      const vn = cv.x * nx + cv.z * nz
      if (vn < 0) { cv.x -= 1.3 * vn * nx; cv.z -= 1.3 * vn * nz; this.onBounce?.(-vn * 0.5) }
    }
    this.vel.copy(cv)
    this.speed = hs
    this.lateral = 0
    this.side = 0
    this.vy = cv.y
    this.agl = this.pos.y - g
    this.yawRate = 0
    this.boost = 0
    this.throttle = 0
    if (this.crashT > 3.6 || (this.crashGround && hs < 60 && this.crashT > 1.5)) {
      this.crashing = false
      if (this.hull <= 0) this.dead = true
      this.recovered = true
    }
  }

  /** Rock: push out along the true surface normal; keep the tangential speed (a glancing hit scrapes,
   *  a head-on one stops you hard); turn the nose part-way along the wall. */
  /** Tools: no rock collisions (handling tests on open ground). */
  noCollide = false
  /** IMPOSSIBLE rivals: a hard hit glances off instead of wrecking. */
  unwreckable = false
  /** The surface the hover rides (FREE ROAM swaps in World.surfaceAt: up the landforms). */
  ground: (x: number, z: number) => number = groundH
  /** FREE ROAM: a drop steeper than a landform's flank is a cliff edge — off it you fall, not slide down the face; hops are lower and fall faster. */
  cliffs = false
  /** FREE ROAM's damage is the game's (main.ts): when set, a rock hit is reported here — the speed into
   *  it (m/s), and whether it was solid (a landform or a gorge wall, not a boulder) — and slides along
   *  instead of wrecking or costing this hull. */
  onRockFree: ((impact: number, solid: boolean) => void) | null = null
  private collide(world: World): void {
    if (this.noCollide) return
    // Swept: at Mach 8+ a step is longer than a spire is wide. Walk the step in 12 m samples and stop
    // at the first one inside rock, then resolve there.
    const sx = this.pos.x - this.prev.x, sz = this.pos.z - this.prev.z
    const len = Math.hypot(sx, sz)
    if (len > 12) {
      const steps = Math.ceil(len / 12)
      const n0 = world.near(this.prev.x + sx / 2, this.prev.z + sz / 2, this.pos.y, len / 2 + 40, this.obs)
      if (n0 > 0) {
        outer: for (let k = 1; k < steps; k++) {
          const x = this.prev.x + (sx * k) / steps, z = this.prev.z + (sz * k) / steps
          for (let i = 0; i < n0; i++) {
            const o = this.obs[i]
            if (Math.hypot(x - o.x, z - o.z) < o.cr + 2.6) { this.pos.x = x; this.pos.z = z; break outer }
          }
        }
      }
    }
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
      // (Capped per step, like the wreck's: falling onto a landform's shoulder from a jump put the craft
      //  inside it, and one push threw it up to 190 m sideways.)
      const push = Math.min(rr - d, 25)
      this.pos.x += nx * push
      this.pos.z += nz * push
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
      // Hard into rock: not a deflection — a wreck.
      // (Only a real hit: more than 300 m/s into the rock. A shallow one at Mach 5 scrapes.)
      if (o.big && sev > 0.5 && this.ghost <= 0 && !this.unwreckable && !this.onRockFree) {
        this.scrapeAt.set(o.x + nx * o.cr, this.pos.y - 0.5, o.z + nz * o.cr)
        this.startCrash(sev, nx, nz)
        return
      }
      // Nose follows the new direction part of the way (a deflection, not a snap).
      let nh = Math.atan2(nvx, nvz)
      // (FREE ROAM: the nose is put along the face, a few degrees out, the way it was already going —
      //  the craft runs on beside it. Part-way, W drove it back into a gorge wall every few seconds; onto
      //  the bounce, it crossed the gorge into the other wall: Mach 5 hits until the hull was gone.)
      if (this.onRockFree) {
        const s = this.fwd.x * -nz + this.fwd.z * nx >= 0 ? 1 : -1
        nh = Math.atan2(-nz * s + nx * 0.1, nx * s + nz * 0.1)
      }
      let dh = nh - this.heading
      dh = Math.atan2(Math.sin(dh), Math.cos(dh))
      this.heading += dh * (this.onRockFree ? 1 : o.big ? 0.65 : 0.3)
      this.updateAxes()
      // IMPOSSIBLE rivals slide along the rock at full speed (only its direction changes).
      if (this.unwreckable) { const sp0 = Math.hypot(this.vel.x, this.vel.z), k = sp0 / Math.max(1, Math.hypot(nvx, nvz)); this.setHorizontal(nvx * k, nvz * k) }
      else this.setHorizontal(nvx, nvz)
      this.yawRate *= 0.3
      this.scrape = Math.min(1, this.scrape + 0.5 + sev)
      this.scrapeAt.set(o.x + nx * o.cr, this.pos.y - 0.5, o.z + nz * o.cr)
      if (sev > 0.02 || !o.big) this.onCrash?.(sev, o.big, this.scrapeAt.x, this.scrapeAt.y, this.scrapeAt.z, nx, nz)
      if (this.onRockFree) this.onRockFree(-vn, o.big || !!o.wall)
      else if (this.unwreckable) { /* no damage */ } else if (o.big) this.hull -= Math.min(45, sev * 40)
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
  if (a.dead || b.dead || a.ghost > 0 || b.ghost > 0 || a.crashing || b.crashing) return
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
  // A real T-bone at a closing speed of 700 m/s+: both go down.
  if (sev > 1.75) { if (!a.unwreckable) a.startCrash(sev * 0.5, -_n.x, -_n.z); if (!b.unwreckable) b.startCrash(sev * 0.5, _n.x, _n.z) }
}
