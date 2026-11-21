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
  /** Debug: the lane the AI last aimed at. */
  aimLane?: number
}

export type RaceState = 'grid' | 'racing' | 'done'

const BLK0 = new Float64Array(32), BLK1 = new Float64Array(32)
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
  missedGate?(r: Racer): void
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
      controls: { steer: 0, boost: false, burner: false, brake: false, strafe: 0, dodgeL: false, dodgeR: false }, padCool: 0, respawnT: 0,
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
    // Finished: by finish time alone (the distance to the line kept counting as they drove on past
    // it — 19 km "behind" a racer who had only just crossed).
    if (r.finished) return 1e12 - r.finishTime * 1000
    const c = this.course.cps[Math.min(r.next, this.K - 1)]
    const d = Math.hypot(r.p.pos.x - c.x, r.p.pos.z - c.z)
    return r.passed * (this.course.length / this.K) - d
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
          // (A slow roll off the line: the engines spool up to Mach 1, then it goes.)
          r.p.speed = (r.ai ? 0.18 + r.skill * 0.15 : perfect ? 0.55 : early ? 0.05 : 0.2) * MACH
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
      if (r.p.hull <= 0 && !r.p.dead && !r.p.crashing) { r.p.dead = true; r.respawnT = 1.6 }
      // A wreck that has come to rest: destroyed → the respawn timer; otherwise straight back on the line.
      if (r.p.recovered) {
        r.p.recovered = false
        if (r.p.dead) r.respawnT = 1.2
        else this.respawnNear(r)
      }
      r.idx = this.course.nearest(r.p.pos.x, r.p.pos.z, r.idx)
      this.gates(r)
      this.pads(r, dt)
    }
    // Wakes: right behind a rival (40–300 m, within ~30 m across) you're in its turbulent slipstream.
    for (const r of this.racers) {
      let w = 0
      for (const o of this.racers) {
        if (o === r || o.p.dead || o.p.crashing) continue
        const dx = o.p.pos.x - r.p.pos.x, dz = o.p.pos.z - r.p.pos.z
        const ahead = dx * r.p.fwd.x + dz * r.p.fwd.z
        const side = Math.abs(dx * r.p.right.x + dz * r.p.right.z)
        if (ahead > 40 && ahead < 300 && side < 32) w = Math.max(w, (1 - side / 32) * (1 - (ahead - 40) / 260))
      }
      r.p.wake += (w - r.p.wake) * Math.min(1, dt * 4)
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
      // A missed gate is paid for on the spot: the speed is ripped away (and no time is added).
      if (missed) {
        r.p.speed *= 0.38
        r.p.lateral *= 0.38
        r.p.side *= 0.38
        if (r.p.spin > 0 || r.p.recover > 0) { r.p.spinVx *= 0.38; r.p.spinVz *= 0.38 }
        this.ev.missedGate?.(r)
      }
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

  /** After a crash: back on the line just ahead of where it came to rest, rolling. */
  respawnNear(r: Racer): void {
    const c = this.course
    const i = Math.min(c.n - 1, c.nearest(r.p.pos.x, r.p.pos.z, r.idx) + 6)
    const [tx, tz] = c.tangent(i)
    const hull = r.p.hull
    // A lane clear of every spire in the next 2 km (so a respawn never lands you straight back on one).
    let lat = r.ai ? (Math.random() - 0.5) * 120 : 0
    for (let tries = 0; tries < 12; tries++) {
      const hit = c.rocks.some((rk) => rk.i >= i && rk.i < i + 50 && Math.abs(rk.lat - lat) < rk.r * 1.8 + 40)
      if (!hit) break
      lat = (tries % 2 ? -1 : 1) * (40 + tries * 20)
    }
    r.p.reset(c.px[i] - tz * lat, c.pz[i] + tx * lat, Math.atan2(tx, tz), 1.3)
    r.p.hull = Math.max(35, hull)
    r.p.ghost = 2.5
    r.idx = i
    r.stuck = 0
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
    // The course's spires ahead: the first one in the lane decides the line — aim at the gap beside
    // it (the side clear of every spire standing there, rock gates included), not at a point
    // kilometres on, which cut diagonally through it.
    // Near a gate, the lane is squeezed inside its towers (a miss now costs most of your speed). The
    // gap search below works inside the same limit — clamping after it pushed racers into spires.
    const nextGate = this.course.cps[Math.min(r.next, this.K - 1)]
    const toGate = (nextGate.i - r.idx) * 40
    const laneLim = toGate > 0 && toGate < p.speed * 2 + 600 ? 175 : 220
    lane = THREE.MathUtils.clamp(lane, -laneLim, laneLim)
    const horizon = r.idx + Math.round((p.speed * 3.5 + 400) / 40)
    // Where it actually is across the line (right = +).
    const [t0x, t0z] = c.tangent(r.idx)
    const myLat = (p.pos.x - c.px[r.idx]) * -t0z + (p.pos.z - c.pz[r.idx]) * t0x
    let aimI = -1
    for (const rk of this.course.rocks) {
      // (Until it is actually behind: dropping it 80 m out swung the AI back into it at Mach 5.)
      if (rk.i < r.idx - 1 || rk.i > horizon) continue
      const soon = (rk.i - r.idx) * 40 < p.speed * 1.6 + 200
      // (Spires flare to ~1.7× their radius at the base: the footprint is r·1.8.)
      if (Math.abs(lane - rk.lat) >= rk.r * 1.8 + 55 && !(soon && Math.abs(myLat - rk.lat) < rk.r * 1.8 + 30)) continue
      // The free gaps across the line at this spire (and any partner standing with it): block each
      // rock's width plus a margin, then take the clear point nearest to where the craft already is.
      // (Preallocated: this runs per racer per tick — fresh arrays here were GC pauses mid-race.)
      let nb = 0
      for (const o of this.course.rocks) {
        if (Math.abs(o.i - rk.i) >= 12) continue
        const b0 = o.lat - o.r * 1.8 - 30, b1 = o.lat + o.r * 1.8 + 30
        let j = nb++
        while (j > 0 && BLK0[j - 1] > b0) { BLK0[j] = BLK0[j - 1]; BLK1[j] = BLK1[j - 1]; j-- }
        BLK0[j] = b0; BLK1[j] = b1
        if (nb >= BLK0.length - 1) break
      }
      BLK0[nb] = laneLim; BLK1[nb] = laneLim; nb++
      let best = NaN, bestD = Infinity, lo = -laneLim
      for (let q = 0; q < nb; q++) {
        const b0 = BLK0[q], b1 = BLK1[q]
        if (b0 - lo > 16) {
          const cand = Math.max(lo + 8, Math.min(b0 - 8, myLat))
          if (Math.abs(cand - myLat) < bestD) { bestD = Math.abs(cand - myLat); best = cand }
        }
        lo = Math.max(lo, b1)
      }
      if (Number.isNaN(best)) continue
      lane = best
      aimI = rk.i
      // (The nearest conflict decides; a farther spire overwriting the lane put it back into this one.)
      break
    }
    lane = THREE.MathUtils.clamp(lane, -laneLim, laneLim)
    r.aimLane = lane
    // Stanley-style steering: the line's heading a little ahead, plus a correction that closes the
    // cross-track error to the lane fast (the old far-point aim drifted 80 m off its own lane).
    const look = Math.min(n - 1, r.idx + Math.round((p.speed * 0.45 + 60) / 40))
    const [tx, tz] = c.tangent(look)
    const lineH = Math.atan2(tx, tz)
    const cte = lane - myLat
    const want = lineH - Math.atan2(3 * cte, p.speed + 60)
    let err = want - p.heading
    err = Math.atan2(Math.sin(err), Math.cos(err))
    void aimI
    // (Yaw has momentum now: damp it, or the AI over-rotates into its own spin.)
    const lim = p.mach > 3 ? 0.7 : 1
    ctl.steer = THREE.MathUtils.clamp(-err * 3.2 + p.yawRate * 0.7, -lim, lim)
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
    // (Raised again, 2026-11-21: "I crashed twice and still won". Ahead of you they ease a little;
    // behind, they push hard.)
    // (Up again after a playtest win from 10th: the field must hold Mach 6 like you do.)
    const band = THREE.MathUtils.clamp(-gap / 2500, -0.4, 0.6)
    p.maxMach = THREE.MathUtils.clamp(5.3 + r.skill * 0.8 + band, 4.6, 6.3)
    const corner = p.mach > safe * 0.92
    ctl.boost = !corner && Math.abs(err) < 0.5
    // The afterburner on the long straights only (it locks the steering), and only when the line
    // and their lane are clear for a while; the bolder ones light it more.
    const clearAhead = !this.course.rocks.some((rk) => rk.i > r.idx && rk.i < r.idx + (p.speed * 3) / 40 && Math.abs(rk.lat - lane) < rk.r * 1.8 + 80)
    ctl.burner = ctl.boost && bend < 0.06 && Math.abs(err) < 0.08 && clearAhead && p.mach > 3.5 && p.mach < 5.6 + r.skill * 2.4
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
