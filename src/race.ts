// The race: a grid of six, a countdown, three laps of 14 gates, AI rivals, positions, boost pads,
// racer-on-racer bumps, penalties for missed gates, and the finish.
//
// AI drivers steer at a point down the racing line (further the faster they go) offset into their
// own lane, ease off before sharp bends, swing out to pass, and are rubber-banded mildly toward the
// player so the race stays a race. They drive the same Player physics: the same jumps, pads, walls.
import * as THREE from 'three'
import { CFG, MACH } from './config'
import { Course, GATE_HALF } from './course'
import { bump, Player, type Controls } from './player'
import type { World } from './world'

export interface Racer {
  name: string
  color: number
  p: Player
  ai: boolean
  idx: number
  /** Gates passed in total (lap = floor((passed - 1) / K) + 1 once started). */
  passed: number
  next: number
  finished: boolean
  finishTime: number
  lapStart: number
  lastLap: number
  bestLap: number
  penalty: number
  place: number
  prog: number
  // AI
  skill: number
  lane: number
  laneT: number
  stuck: number
  controls: Controls
  padCool: number
  respawnT: number
}

export type RaceState = 'grid' | 'racing' | 'done'

const ROSTER: [string, number][] = [
  ['VEGA', 0xff3fa4],
  ['KESTREL', 0x7dff3a],
  ['NOMAD', 0xffc21a],
  ['ION', 0x29d3ff],
  ['RUSH', 0xff3b30],
  ['ORBIT', 0xa96bff],
  ['FLINT', 0xff8a3d],
  ['ZEPHYR', 0x3dffc5],
  ['SABLE', 0xd8d8e8],
]

export interface RaceEvents {
  gate(r: Racer, lapDone: boolean, missed: boolean): void
  finish(r: Racer): void
  pad(r: Racer): void
  bumped(a: Racer, b: Racer, sev: number, x: number, y: number, z: number): void
  countdown(n: number): void
  go(perfect: boolean): void
}

export class Race {
  readonly racers: Racer[] = []
  state: RaceState = 'grid'
  clock = 0
  /** Seconds left on the countdown (3 … 0). */
  countdown = 0
  private lastCount = 4
  private boostHeldSince = -1
  readonly K: number
  private readonly order: Racer[] = []

  constructor(readonly course: Course, readonly player: Player, private readonly ev: RaceEvents) {
    this.K = course.cps.length
    this.racers.push(this.make('YOU', 0xffffff, player, false, 0))
    ROSTER.forEach(([name, color], i) => {
      const p = new Player()
      p.announce = false
      p.assist = 0.85
      this.racers.push(this.make(name, color, p, true, 0.72 + i * 0.05))
    })
  }

  private make(name: string, color: number, p: Player, ai: boolean, skill: number): Racer {
    return {
      name, color, p, ai, idx: 0, passed: 0, next: 0, finished: false, finishTime: 0, lapStart: 0, lastLap: 0, bestLap: 0,
      penalty: 0, place: 0, prog: 0, skill, lane: 0, laneT: 0, stuck: 0,
      controls: { steer: 0, boost: false, brake: false, strafe: 0, dodgeL: false, dodgeR: false }, padCool: 0, respawnT: 0,
    }
  }

  /** Line up on the grid behind the start gate. */
  reset(): void {
    const c = this.course
    const start = c.cps[0]
    const heading = Math.atan2(start.tx, start.tz)
    // The player starts mid-pack (6th of 10); the rivals fill the other slots.
    const slots = [5, 0, 1, 2, 3, 4, 6, 7, 8, 9]
    this.racers.forEach((r, k) => {
      const slot = slots[k] ?? k
      const row = Math.floor(slot / 2), col = slot % 2
      const back = 60 + row * 45
      const side = (col === 0 ? -1 : 1) * 32
      const x = start.x - start.tx * back + start.tz * side
      const z = start.z - start.tz * back - start.tx * side
      r.p.reset(x, z, heading, 0)
      r.idx = c.nearest(x, z, -1)
      r.passed = 0
      r.next = 0
      r.finished = false
      r.finishTime = 0
      r.lapStart = 0
      r.lastLap = 0
      r.bestLap = 0
      r.penalty = 0
      r.lane = side * 1.4
      r.laneT = 0
      r.stuck = 0
      r.respawnT = 0
      r.p.maxMach = r.ai ? 4.7 + r.skill * 1.3 : CFG.speed.boostMach
    })
    this.state = 'grid'
    this.clock = 0
    this.countdown = 3.6
    this.lastCount = 4
    this.boostHeldSince = -1
  }

  lapOf(_r: Racer): number { return 1 }
  /** Metres of line left to the finish. */
  toGo(r: Racer): number { return Math.max(0, (this.course.finishI - r.idx) * 40) }

  /** Rough distance (m) around the course, for ordering and gaps. */
  progress(r: Racer): number {
    const c = this.course.cps[r.next]
    const d = Math.hypot(r.p.pos.x - c.x, r.p.pos.z - c.z)
    return r.passed * (this.course.length / this.K) - d + (r.finished ? 1e9 - r.finishTime * 1000 : 0)
  }

  step(dt: number, playerControls: Controls, world: World): void {
    if (this.state === 'grid') {
      this.countdown -= dt
      const n = Math.ceil(this.countdown)
      if (n !== this.lastCount && n >= 1 && n <= 3) { this.ev.countdown(n); this.lastCount = n }
      if (playerControls.boost) { if (this.boostHeldSince < 0) this.boostHeldSince = this.countdown } else this.boostHeldSince = -1
      for (const r of this.racers) r.p.step(dt, r.ai ? r.controls : playerControls, world, true)
      const sorted0 = [...this.racers].sort((a, b) => this.progress(b) - this.progress(a))
      sorted0.forEach((r, i) => (r.place = i + 1))
      if (this.countdown <= 0) {
        this.state = 'racing'
        // Perfect start: boost pressed in the last half second, not before.
        const perfect = this.boostHeldSince >= 0 && this.boostHeldSince < 0.5
        const early = this.boostHeldSince >= 1.2
        for (const r of this.racers) {
          r.p.speed = (r.ai ? 0.9 + r.skill * 0.6 : perfect ? 1.8 : early ? 0.3 : 0.9) * MACH
        }
        this.ev.go(perfect)
      }
      return
    }
    this.clock += dt
    for (const r of this.racers) {
      if (r.ai) this.drive(r, dt)
      if (r.respawnT > 0) {
        r.respawnT -= dt
        if (r.respawnT <= 0) this.respawn(r)
        r.p.step(dt, r.controls, world, true)
        continue
      }
      r.p.step(dt, r.ai ? r.controls : playerControls, world)
      if (r.p.hull <= 0 && !r.p.dead) { r.p.dead = true; r.respawnT = 1.6 }
      r.idx = this.course.nearest(r.p.pos.x, r.p.pos.z, r.idx)
      this.gates(r)
      this.pads(r, dt)
    }
    for (let i = 0; i < this.racers.length; i++)
      for (let j = i + 1; j < this.racers.length; j++)
        bump(this.racers[i].p, this.racers[j].p, (a, b, sev, x, y, z) => this.ev.bumped(this.find(a), this.find(b), sev, x, y, z))
    // Places (a reused array: no garbage at 60 Hz).
    this.order.length = 0
    for (const r of this.racers) { r.prog = this.progress(r); this.order.push(r) }
    this.order.sort((a, b) => b.prog - a.prog)
    for (let i = 0; i < this.order.length; i++) this.order[i].place = i + 1
    if (this.racers[0].finished && this.state === 'racing') this.state = 'done'
  }

  private find(p: Player): Racer { return this.racers.find((r) => r.p === p)! }

  private gates(r: Racer): void {
    if (r.finished) return
    const p = r.p
    for (const ahead of [0, 1]) {
      const k = r.next + ahead
      if (k >= this.K) continue
      const c = this.course.cps[k]
      const s0 = (p.prev.x - c.x) * c.tx + (p.prev.z - c.z) * c.tz
      const s1 = (p.pos.x - c.x) * c.tx + (p.pos.z - c.z) * c.tz
      if (!(s0 < 0 && s1 >= 0)) continue
      const lat = Math.abs((p.pos.x - c.x) * c.tz - (p.pos.z - c.z) * c.tx)
      if (lat > 2500) continue
      // Through the gate, beside it, or past it having skipped one: every skipped/missed gate costs 2 s.
      const wide = lat > GATE_HALF + 15
      const missed = wide || ahead === 1
      const count = ahead + 1
      for (let q = 0; q < count; q++) {
        r.passed++
        r.next = r.next + 1
        if (r.passed === 1) r.lapStart = this.clock + r.penalty
        this.ev.gate(r, false, missed && q === 0)
        if (r.passed >= this.K) {
          r.finished = true
          r.finishTime = this.clock + r.penalty
          r.lastLap = r.bestLap = r.finishTime
          this.ev.finish(r)
          return
        }
      }
      r.penalty += 2 * ((ahead === 1 ? 1 : 0) + (wide ? 1 : 0))
      return
    }
  }

  private pads(r: Racer, dt: number): void {
    r.padCool -= dt
    if (r.padCool > 0 || r.p.airborne) return
    for (const pad of this.course.pads) {
      const dx = r.p.pos.x - pad.x, dz = r.p.pos.z - pad.z
      const along = dx * pad.tx + dz * pad.tz
      const across = dx * pad.tz - dz * pad.tx
      if (Math.abs(along) < 70 && Math.abs(across) < 32) {
        r.p.speed += 0.75 * MACH
        r.padCool = 1
        this.ev.pad(r)
        return
      }
    }
  }

  /** Back on the line at the last gate passed (crashed out, or the R key). */
  respawn(r: Racer): void {
    const c = this.course.cps[Math.max(0, Math.min(this.K - 1, r.next - 1))]
    const heading = Math.atan2(c.tx, c.tz)
    const off = r.ai ? (Math.random() - 0.5) * 80 : 0
    r.p.reset(c.x + c.tx * 40 + c.tz * off, c.z + c.tz * 40 - c.tx * off, heading, 1.4)
    r.idx = this.course.nearest(r.p.pos.x, r.p.pos.z, -1)
    r.respawnT = 0
    r.stuck = 0
    r.p.ghost = 2.5
  }

  // ───────────────────────── AI ─────────────────────────

  drive(r: Racer, dt: number): void {
    const p = r.p
    const c = this.course
    const ctl = r.controls
    const n = c.n
    // Lane: a slow drift across the line, and a swing out when someone is just ahead in it.
    r.laneT += dt
    let lane = r.lane + Math.sin(r.laneT * 0.21 + r.skill * 9) * 70
    for (const o of this.racers) {
      if (o === r) continue
      const dx = o.p.pos.x - p.pos.x, dz = o.p.pos.z - p.pos.z
      const ahead = dx * p.fwd.x + dz * p.fwd.z
      const side = dx * p.right.x + dz * p.right.z
      if (ahead > 0 && ahead < 220 && Math.abs(side) < 22) lane += side > 0 ? -55 : 55
    }
    // The course's spires ahead in the lane: step round them.
    const horizon = r.idx + Math.round((p.speed * 2.2 + 300) / 40)
    for (const rk of this.course.rocks) {
      let di = rk.i - r.idx
      if (di <= 0 || r.idx + di > horizon) continue
      if (Math.abs(lane - rk.lat) < rk.r + 45) lane = rk.lat + (lane >= rk.lat ? 1 : -1) * (rk.r + 70)
    }
    lane = THREE.MathUtils.clamp(lane, -220, 220)
    const la = Math.min(1300, 220 + p.speed * 0.6)
    const want_k = r.idx + Math.round(la / 40)
    const k = Math.min(n - 1, want_k)
    const [tx, tz] = c.tangent(k)
    // Lane offset to the craft's right: right = (−tz, tx). Past the end of the line: straight on.
    const over = (want_k - k) * 40
    const gx = c.px[k] - tz * lane + tx * over
    const gz = c.pz[k] + tx * lane + tz * over
    const want = Math.atan2(gx - p.pos.x, gz - p.pos.z)
    let err = want - p.heading
    err = Math.atan2(Math.sin(err), Math.cos(err))
    // (Yaw has momentum now: damp it, or the AI over-rotates into its own spin.)
    const lim = p.mach > 3 ? 0.7 : 1
    ctl.steer = THREE.MathUtils.clamp(-err * 2.6 + p.yawRate * 0.85, -lim, lim)
    // Bends ahead: how much the line turns over the next ~2.5 s.
    // The sharpest the line turns, per km, over the next ~3 s: what speed it can be taken at.
    let bend = 0
    const [ax, az] = c.tangent(r.idx)
    for (let s = 10; s <= Math.round((p.speed * 3) / 40) + 10; s += 10) {
      const [bx, bz] = c.tangent(Math.min(n - 1, r.idx + s))
      bend = Math.max(bend, Math.acos(THREE.MathUtils.clamp(ax * bx + az * bz, -1, 1)) / (s * 0.04))
    }
    // Turn radius at speed v is v / yawMax; the line's radius is 1 / bend (km⁻¹ → m).
    const safe = (CFG.handling.yawHigh * 1000) / Math.max(bend, 1e-3) / MACH
    // Rubber band toward the player (mild): ahead → a lower ceiling, behind → a higher one.
    const gap = this.progress(r) - this.progress(this.racers[0])
    // (Eased, 2026-11-20: the field was too quick. Ahead of you they lift a lot; behind, a little push.)
    const band = THREE.MathUtils.clamp(-gap / 2000, -1.1, 0.3)
    p.maxMach = THREE.MathUtils.clamp(4.0 + r.skill * 1.0 + band, 3.0, 5.8)
    const corner = p.mach > safe * 0.92
    ctl.boost = !corner && Math.abs(err) < 0.5
    ctl.brake = p.mach > safe * 1.08
    ctl.strafe = 0
    ctl.dodgeL = ctl.dodgeR = false
    // Stuck on something: back on the line.
    if (this.state === 'racing' && !r.finished) {
      r.stuck = p.speed < 120 ? r.stuck + dt : 0
      if (r.stuck > 2.5) this.respawn(r)
    }
  }

  shift(dx: number, dz: number): void {
    for (const r of this.racers) if (r.p !== this.player) r.p.shift(dx, dz)
  }
}
