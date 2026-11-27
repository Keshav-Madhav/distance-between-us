// The gorge courses: a gorge cut into a landmass. The race runs down its floor between two walls; round it
// the land is real land — the gorge's land is the world's own ground (src/land.ts: a height tile added to
// groundH, built in world space), not a ring of tableland round a trench:
//   desert  CANYON RUN — Grand Canyon strata; a lobed plateau with side canyons, mesas and buttes off it.
//   ice     BLUE HOLLOW — a glacier: lamplit cave sections under the ice, the open gorge between them,
//           crevasse fields on the ice, its margin ramping down onto the snowfield.
//   lava    MAGMA GORGE — a basalt plateau with lava at the walls' feet, its edge the lobes of the last
//           flows stepping down to the lava plains.
//   forest  WHITEWATER — a river cut deep between granite bluffs, wooded valley sides, hills behind.
// Its side canyons include a few ways in from the open world at the floor's level, so FREE ROAM finds the
// gorge from outside and drives in. They lead outward only: no shortcut.
//
// This file: the walls beside the floor (their own fine mesh — crisp for the race — out to WALL_TO, the
// land's own surface at finer spacing, tucked under the tile at its edge), the cave's roof, lamps, the
// river; and asking the land (heightAt: the walls' mesh, then the tile).
//
// Solid: World.near asks wallsNear. Beside the floor it is the wall as it always was (a huge round "rock"
// whose surface is the foot, so racing is unchanged); everywhere else it is the land itself — inside it by
// more than a step is rock, pushed out toward its contour at your height. FREE ROAM rides it (surface):
// gentle ground is ground; a cliff is not a ramp (its foot is the ground).
import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { groundBase as groundH, SKY_GLSL, WORLD_FADE } from './terrain'
import { fbmR, landNetwork, landReach, lineAt, sst, useLoop, vn, WALL_TO, type LandLoop, type LandTile } from './land'
import { ROOF_D, ROOF_H, ROOF_T, type WallsIn, type WallsOut } from './walls'
import { patchStandard } from './shaders'

export type GorgeStyle = 'desert' | 'ice' | 'lava' | 'forest'

interface Style {
  /** Floor half-width (m) round the loop (u in 0…1). */
  half: (u: number) => number
  /** Height above the floor (m) under which the wall beside the floor is in the way. */
  rim: number
  /** How much the cave walls' height wanders along the loop (±). */
  hk: number
  /** A roof over the floor in the cave sections (BLUE HOLLOW). */
  roof?: number
  /** Along the loop (u): the cave walls' height scale, the roof's rise above the walls' tops (m), and
   *  how flat the roof is (0 an arch, 1 a flat ceiling) — the cave changes shape as it goes. */
  vary?: (u: number) => { wall: number; rise: number; flat: number }
  /** The walls' first columns out from the foot (m): finest where they are steepest. */
  near: number[]
  /** Faces flatter than this go to the top material, when one is given (the glacier's snow). */
  topY?: number
}

const STYLES: Record<GorgeStyle, Style> = {
  desert: {
    half: (u) => { const a = u * Math.PI * 2; return 1320 + 240 * Math.sin(a * 3 + 1.1) + 130 * Math.sin(a * 11 + 2.3) + 60 * Math.sin(a * 23 + 0.4) },
    rim: 900, hk: 0.15,
    near: [0, 8, 14, 22, 32],
    // (Its tops and ledges smooth-shaded, cap rock and sand.)
    topY: 0.8,
  },
  ice: {
    half: (u) => { const a = u * Math.PI * 2; return 780 + 340 * Math.sin(a * 5 + 0.7) + 120 * Math.sin(a * 11 + 1.7) },
    rim: 450, hk: 0.08, roof: 330,
    // Low passages (a ceiling just over the walls, flat), tall arched halls, wide flat-roofed chambers.
    vary: (u) => {
      const a = u * Math.PI * 2
      const big = 0.5 + 0.5 * Math.sin(a * 5 + 0.7), wob = 0.5 + 0.5 * Math.sin(a * 13 + 2.1)
      return { wall: 0.55 + 0.9 * big, rise: 20 + 380 * big * (0.6 + 0.4 * wob), flat: 0.5 + 0.5 * Math.sin(a * 7 + 1.3) }
    },
    near: [0, 10, 20, 30, 45, 70, 100, 140, 190, 230, 260, 280, 310],
    topY: 0.62,
  },
  lava: {
    half: (u) => { const a = u * Math.PI * 2; return 900 + 180 * Math.sin(a * 4 + 0.9) + 90 * Math.sin(a * 13 + 2.0) },
    rim: 700, hk: 0.12,
    near: [0, 6, 12, 18, 26, 36],
    // (Its flats: the flows' own rough dark crust — see main.ts.)
    topY: 0.45,
  },
  forest: {
    half: (u) => { const a = u * Math.PI * 2; return 700 + 140 * Math.sin(a * 3 + 2.2) + 70 * Math.sin(a * 8 + 0.3) },
    rim: 270, hk: 0.15,
    near: [0, 10, 20, 32, 46, 62, 80],
  },
}

/** The virtual rock behind each wall (m): big enough that its curve is the wall's line over a pass. */
const BIG = 20000
/** Beside the floor (m out from the foot) the wall is the race's own (see wallsNear). */
const BAND = 150
/** The arches' undersides over the floor (m), at least, everywhere across it. */
const ARCH_CLEAR: Record<GorgeStyle, number> = { desert: 420, lava: 380, ice: 340, forest: 300 }
/** Wall rows per row of the race's wall grid (every ~200 m → ~100 m). */
const SUB = 2
/** The water's clock (main.ts advances it). */
export const WATER_T = { value: 0 }

/** One side's walls. */
interface Side {
  inner: boolean
  /** Feet (one per row), their distance from the middle, and their angle about it (unwrapped). */
  fx: Float64Array
  fz: Float64Array
  lam: Float64Array
  ang: Float64Array
  /** Columns: metres out from the foot. */
  col: number[]
  /** Heights (absolute y) and aCrev, rows × columns. */
  y: Float32Array
  cv: Float32Array
  /** 1 where the walls are down at their foot (a triangle all of these is not drawn). */
  low: Uint8Array
  /** Height above the ground there (m). */
  rel: Float32Array
  K: number
}

export class Canyon {
  readonly rx: Float64Array
  readonly rz: Float64Array
  readonly tx: Float64Array
  readonly tz: Float64Array
  /** Half-width of the floor (m): the wall's foot from the line. */
  readonly half: Float64Array
  /** The cave's shape along the loop (see Style.vary). */
  readonly wallK: Float64Array
  readonly rise: Float64Array
  readonly flat: Float64Array
  /** BLUE HOLLOW: how roofed each row is (0 open sky … 1 cave). */
  readonly roofK: Float64Array
  readonly m: number
  readonly st: Style
  /** The loop's middle (every loop is star-shaped about it). */
  readonly cx: number
  readonly cz: number
  /** Loop length (m). */
  readonly L: number
  /** The ways in: the race's row at the mouth, its side (+1/−1), the mouth on the floor's edge; axis:
   *  [x, z, metres out] every 120 m. */
  readonly breaches: { row: number; side: number; u: number; x: number; z: number; axis: number[]; wid: number[]; big: boolean; box: number[] }[] = []
  /** Per row of the race's grid: is the wall beside the floor open (a way in) on side +1 / −1? */
  private readonly openP: Uint8Array
  private readonly openN: Uint8Array
  private readonly sides: Side[] = []
  private readonly N: number
  /** The land (src/land.ts): built in workers at boot (src/landjob.ts) and given here by attachLand. */
  tile: LandTile | null = null
  /** The land's loop description (for the workers, and the boot-time questions before the tile is here). */
  readonly land: LandLoop
  /** Farthest the land reaches from the middle (m). */
  private reach = 0
  private last = 0
  private qlast = 0
  private readonly cand = new Int32Array(81)
  private readonly reachMemo = new Map<number, number>()

  constructor(private readonly loop: (u: number) => [number, number], readonly style: GorgeStyle = 'desert') {
    this.st = STYLES[style]
    let L = 0
    let [px, pz] = loop(0)
    let cx = 0, cz = 0
    for (let k = 1; k <= 2000; k++) { const [x, z] = loop(k / 2000); L += Math.hypot(x - px, z - pz); px = x; pz = z; cx += x; cz += z }
    this.L = L
    this.cx = cx / 2000; this.cz = cz / 2000
    const m = Math.max(64, Math.round(L / 200))
    this.m = m
    this.rx = new Float64Array(m); this.rz = new Float64Array(m); this.tx = new Float64Array(m); this.tz = new Float64Array(m); this.half = new Float64Array(m)
    this.wallK = new Float64Array(m); this.rise = new Float64Array(m); this.flat = new Float64Array(m); this.roofK = new Float64Array(m)
    for (let i = 0; i < m; i++) {
      const u = i / m
      const [x, z] = loop(u)
      const [x2, z2] = loop(u + 0.5 / m), [x0, z0] = loop(u - 0.5 / m)
      const dl = Math.hypot(x2 - x0, z2 - z0) || 1
      this.rx[i] = x; this.rz[i] = z; this.tx[i] = (x2 - x0) / dl; this.tz[i] = (z2 - z0) / dl
      this.half[i] = this.st.half(u)
      const v = this.st.vary?.(u); this.wallK[i] = v?.wall ?? 1; this.rise[i] = v?.rise ?? 0; this.flat[i] = v?.flat ?? 0
      this.roofK[i] = this.st.roof ? Canyon.roofed(u) : 0
    }
    this.openP = new Uint8Array(m); this.openN = new Uint8Array(m)
    this.N = m * SUB
    // Which side is the inside (nearer the middle)?
    const dIn = (sg: number) => Math.hypot(this.rx[0] + this.tz[0] * sg * this.half[0] - this.cx, this.rz[0] - this.tx[0] * sg * this.half[0] - this.cz)
    const sgIn = dIn(1) < dIn(-1) ? 1 : -1
    // The ice over the cave's roof, per row, smoothed along the loop (the glacier runs over it).
    const roofTop = new Float64Array(m)
    if (this.st.roof) for (let i = 0; i < m; i++) {
      let a = 0, n = 0
      for (let q = -6; q <= 6; q++) { const j = (i + q + m) % m; a += this.roofK[j] * (this.roofLift(j, 0.5) + ROOF_T); n++ }
      roofTop[i] = a / n
    }
    this.land = { rx: this.rx, rz: this.rz, tx: this.tx, tz: this.tz, half: this.half, cx: this.cx, cz: this.cz, sgIn, roofTop }
    useLoop(this.land)
    // The ways in, from the land's own network (the same the workers build: seeded).
    for (const o of landNetwork(this.land, style).open) {
      const box = [Infinity, Infinity, -Infinity, -Infinity]
      for (let j = 0; j < o.axis.length; j += 3) { box[0] = Math.min(box[0], o.axis[j] - 1700); box[1] = Math.min(box[1], o.axis[j + 1] - 1700); box[2] = Math.max(box[2], o.axis[j] + 1700); box[3] = Math.max(box[3], o.axis[j + 1] + 1700) }
      this.breaches.push({ row: Math.floor(o.row / SUB) * 0 + o.row, side: o.side, u: o.row / m, x: o.x, z: o.z, axis: o.axis, wid: o.wid, big: o.big, box })
    }
    this.feet(sgIn)
  }

  /** BLUE HOLLOW's cave sections (u): about half the loop under ice, the rest an open gorge — the start
   *  out in the light. Each end is a mouth. */
  private static roofed(u: number): number {
    for (const [a, b] of [[0.12, 0.27], [0.36, 0.53], [0.66, 0.79], [0.83, 0.9]]) if (u >= a && u <= b) return 1
    return 0
  }

  // ── the walls ──

  /** Each side's feet (every wall row) and columns: what the boot-time questions need before the land. */
  private feet(sgIn: number): void {
    const st = this.st, N = this.N, m = this.m
    for (const sg of [sgIn, -sgIn]) {
      const inner = sg === sgIn
      const fx = new Float64Array(N), fz = new Float64Array(N), lam = new Float64Array(N), ang = new Float64Array(N)
      for (let r = 0; r < N; r++) {
        const u = r / N
        const [x, z] = this.loop(u), [x2, z2] = this.loop(u + 0.5 / m), [x0, z0] = this.loop(u - 0.5 / m)
        const dl = Math.hypot(x2 - x0, z2 - z0) || 1, tx = (x2 - x0) / dl, tz = (z2 - z0) / dl, h = st.half(u)
        fx[r] = x + tz * sg * h; fz[r] = z - tx * sg * h
        lam[r] = Math.hypot(fx[r] - this.cx, fz[r] - this.cz)
        const a = Math.atan2(fx[r] - this.cx, fz[r] - this.cz)
        ang[r] = r === 0 ? a : ang[r - 1] + Math.atan2(Math.sin(a - ang[r - 1]), Math.cos(a - ang[r - 1]))
      }
      // Columns: the near ones as given, then every 45 m to WALL_TO; and a skirt tucked under the land.
      const col = st.near.slice()
      while (col[col.length - 1] < WALL_TO - 1) { const d = col[col.length - 1]; col.push(Math.min(WALL_TO, d + Math.min(45, 12 + 0.09 * d))) }
      col.push(WALL_TO + 50)
      const K = col.length
      this.sides.push({ inner, fx, fz, lam, ang, col, y: new Float32Array(N * K), cv: new Float32Array(N * K), low: new Uint8Array(N * K), rel: new Float32Array(N * K), K })
    }
  }

  /** What the walls' worker needs (src/walls.ts). */
  wallsIn(): WallsIn {
    const m = this.m
    const eh = this.sides.map((S) => { const sg = S.inner ? this.land.sgIn : -this.land.sgIn, a = new Float64Array(m); for (let i = 0; i < m; i++) a[i] = ROOF_H * this.wallH(i, sg); return a })
    return {
      style: this.style, L: this.land, N: this.N, SUB, roofK: this.roofK, eh,
      sides: this.sides.map((S) => ({ inner: S.inner, sg: S.inner ? this.land.sgIn : -this.land.sgIn, fx: S.fx, fz: S.fz, lam: S.lam, col: S.col })),
      topY: this.st.topY ?? 0, cliffs: this.style === 'ice' || this.style === 'lava',
    }
  }

  /** The land and the walls are here (from the workers): the walls lifted onto the ground, and the race's
   *  wall opened where a way in meets the floor. */
  attachLand(tile: LandTile, walls: WallsOut): void {
    this.tile = tile
    this.walls = walls
    const N = this.N, m = this.m
    // The ground under every wall vertex (the workers cannot ask it: it is the course's, with its jumps).
    let G: number[] = []
    for (let si = 0; si < this.sides.length; si++) {
      const S = this.sides[si], W = walls.sides[si], K = S.K, dir = S.inner ? -1 : 1
      for (let r = 0; r < N; r++) {
        const ox = (S.fx[r] - this.cx) / S.lam[r], oz = (S.fz[r] - this.cz) / S.lam[r]
        const roofed = this.roofK[Math.floor(r / SUB)] > 0
        for (let k = 0; k < K; k++) {
          const x = S.fx[r] + ox * dir * S.col[k], z = S.fz[r] + oz * dir * S.col[k]
          const q = r * K + k, g = groundH(x, z)
          // Their outer edge into the tile as it was built — eroded, talus at its cliffs' feet, sampled on its
          // own cells — not the land's formula the worker blended into: where the two parted (steep crests,
          // cones) the walls' edge stood up out of the land like a card, or sank into it as a gash.
          const w = roofed ? 0 : sst(230, WALL_TO, S.col[k])
          const dl = w > 0 ? (this.tileH(x, z) - (k === K - 1 ? 25 : 0) - W.rel[q]) * w : 0
          G.push(g + dl)
          S.y[q] = W.y[q] + dl + g; S.rel[q] = W.rel[q] + dl; S.cv[q] = W.cv[q]; S.low[q] = W.low[q]
        }
      }
      const sg = S.inner ? this.land.sgIn : -this.land.sgIn, open = sg > 0 ? this.openP : this.openN
      for (let i = 0; i < m; i++) {
        let lo = false
        for (let q = -1; q <= SUB; q++) {
          const r = (i * SUB + q + N) % N
          let hi = -Infinity
          for (let k = 1; k < K && S.col[k] <= BAND; k++) if (S.col[k] >= 40) hi = Math.max(hi, S.rel[r * K + k])
          if (hi < 40) lo = true
        }
        if (lo) open[i] = 1
      }
    }
    const g = Float32Array.from(G); G = []
    for (const B of walls.blocks) for (const [p, q] of [[B.pos, B.posQ], [B.top, B.topQ], [B.cliff, B.cliffQ]] as const) for (let j = 0; j < q.length; j++) p[j * 3 + 1] += g[q[j]]
    this.reachMemo.clear()
    this.reach = Math.max(Math.hypot(tile.x0 - this.cx, tile.z0 - this.cz), Math.hypot(tile.x0 + tile.nx * tile.step - this.cx, tile.z0 + tile.nz * tile.step - this.cz))
    this.placeArches()
  }
  /** The walls' triangles, from their worker (src/walls.ts). */
  private walls: WallsOut | null = null

  // ── natural arches ──
  // A few rock (or ice) bridges spanning the gorge, high over the race: from the sky they break the ring.
  // Each: its row, its spine from one rim's anchor to the other's (A → B, on the land), and its underside's
  // height over the floor at its middle. Their undersides stay ARCH_CLEAR over the floor across the whole of
  // it — several times the highest any racer has flown there (80 m, a rival thrown on CANYON RUN).
  readonly arches: { row: number; ax: number; az: number; ay: number; bx: number; bz: number; by: number; tx: number; tz: number; W: number; T: number; rise: number }[] = []
  /** Place the arches (after the land: their feet are found on it). */
  private placeArches(): void {
    const m = this.m, clear = ARCH_CLEAR[this.style]
    let sd = (this.land.rx.length * 7919 + this.style.length * 31) >>> 0
    const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296 }
    const n = 3 + Math.floor(rnd() * 3), taken: number[] = []
    for (let tries = 0; tries < 240 && this.arches.length < n; tries++) {
      const i = Math.floor(rnd() * m)
      // (Not over a way in, a cave, or another arch.)
      const near = (j: number, w: number) => Math.min(Math.abs(i - j), m - Math.abs(i - j)) < w
      if (taken.some((j) => near(j, m * 0.07)) || this.breaches.some((b) => near(b.row, 10))) continue
      let roofed = false
      for (let q = -5; q <= 5; q++) if (this.roofK[(i + q + m) % m] > 0) roofed = true
      if (roofed) continue
      const g0 = groundH(this.rx[i], this.rz[i])
      // Each foot: out along the row to where the land stands high enough, then a little into it.
      const foot = (sg: number) => {
        for (let d = 60; d < 1600; d += 20) {
          const x = this.rx[i] + this.tz[i] * sg * (this.half[i] + d), z = this.rz[i] - this.tx[i] * sg * (this.half[i] + d)
          const h = this.heightAt(x, z)
          if (h > g0 + clear + 40) return [this.rx[i] + this.tz[i] * sg * (this.half[i] + d + 70), this.rz[i] - this.tx[i] * sg * (this.half[i] + d + 70), Math.min(h, g0 + clear + 160)]
        }
        return null
      }
      const A = foot(-1), B = foot(1)
      if (!A || !B) continue
      const span = Math.hypot(B[0] - A[0], B[1] - A[1])
      if (span > 4200) continue
      taken.push(i)
      // (Broad as natural bridges go — 0.7–1.3 km along the gorge over its middle, more at its feet: narrower, from
      //  the sky they were threads across the ring, and from the oblique camera not there at all.)
      const W = 360 + 300 * rnd(), T = 140 + 110 * rnd()
      this.arches.push({ row: i, ax: A[0], az: A[1], ay: A[2], bx: B[0], bz: B[1], by: B[2], tx: this.tx[i], tz: this.tz[i], W, T, rise: 40 + 120 * rnd() })
    }
  }
  /** An arch's underside and thickness at t (0…1 from A to B; smooth, without the rock's own roughness):
   *  the span sags into an arch, thickest and widest at its feet. */
  private static archAt(a: Canyon['arches'][number], t: number): { u: number; T: number; W: number } {
    const s = Math.sin(Math.PI * Math.min(1, Math.max(0, t))), foot = (1 - s) ** 2
    return { u: a.ay + (a.by - a.ay) * t - 40 + a.rise * s, T: a.T * (1 + 2.2 * foot), W: a.W * (1 + 1.4 * foot) }
  }
  /** Inside an arch's rock at (x, z, y)? Then how far to its nearer face along the gorge (signed; +: toward
   *  the arch's +t̂ side), else null. */
  private archHit(x: number, z: number, y: number): { a: Canyon['arches'][number]; out: number } | null {
    for (const a of this.arches) {
      const ex = a.bx - a.ax, ez = a.bz - a.az, l2 = ex * ex + ez * ez
      const t = ((x - a.ax) * ex + (z - a.az) * ez) / l2
      if (t < 0 || t > 1) continue
      const along = (x - a.ax - ex * t) * a.tx + (z - a.az - ez * t) * a.tz
      const p = Canyon.archAt(a, t)
      if (Math.abs(along) > p.W * 0.9 || y < p.u || y > p.u + p.T) continue
      return { a, out: (along >= 0 ? 1 : -1) * (p.W * 0.9 - Math.abs(along)) }
    }
    return null
  }
  /** An arch's top under (x, z) when you are over it (FREE ROAM lands on it), else -Infinity. */
  private archTop(x: number, z: number, y: number): number {
    for (const a of this.arches) {
      const ex = a.bx - a.ax, ez = a.bz - a.az, l2 = ex * ex + ez * ez
      const t = ((x - a.ax) * ex + (z - a.az) * ez) / l2
      if (t < 0 || t > 1) continue
      const along = (x - a.ax - ex * t) * a.tx + (z - a.az - ez * t) * a.tz
      const p = Canyon.archAt(a, t)
      if (Math.abs(along) > p.W * 0.85) continue
      const top = p.u + p.T
      if (y > top - 15) return top
    }
    return -Infinity
  }

  /** The land tile's height above the ground at (x, z) (whether it is switched on or not). */
  tileH(x: number, z: number): number {
    const t = this.tile
    if (!t) return 0
    const fx = (x - t.x0) / t.step, fz = (z - t.z0) / t.step
    if (fx < 0 || fz < 0 || fx >= t.nx - 1 || fz >= t.nz - 1) return 0
    const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz, q = iz * t.nx + ix, H = t.h
    return (H[q] + (H[q + 1] - H[q]) * u) * (1 - v) + (H[q + t.nx] + (H[q + t.nx + 1] - H[q + t.nx]) * u) * v
  }

  /** The cave walls' height scale at a race row (BLUE HOLLOW's walls wander). */
  private wallH(i: number, side: number): number {
    const st = this.st
    return (1 - st.hk + st.hk * Math.sin(i * 0.09 * side + 1.3) + st.hk * 0.5 * Math.sin(i * 0.37 + side)) * this.wallK[i]
  }

  /** Out from the nearest way in's floor edge (m): ≤ 0 on it; Infinity if none is near. */
  private chanAt(x: number, z: number): number {
    let best = Infinity
    for (const b of this.breaches) {
      const A = b.axis, B = b.box
      if (x < B[0] || z < B[1] || x > B[2] || z > B[3]) continue
      for (let j = 0; j + 3 < A.length; j += 3) {
        const ax = A[j], az = A[j + 1], ex = A[j + 3] - ax, ez = A[j + 4] - az, l2 = ex * ex + ez * ez
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2))
        const dx = x - ax - ex * t, dz = z - az - ez * t, dd = dx * dx + dz * dz
        if (dd > 2.5e6) continue
        const v = Math.sqrt(dd) - 220
        if (v < best) best = v
      }
    }
    return best
  }

  // ── asking the land ──

  /** The wall row of side S at angle th about the middle: row r, the fraction f on to r + 1, and the
   *  foot's distance from the middle there. */
  private rowAt(S: Side, th: number): { r: number; f: number; lam: number } {
    const N = this.N, a0 = S.ang[0], sgn = S.ang[N - 1] > a0 ? 1 : -1
    let t = ((th - a0) * sgn) % (Math.PI * 2)
    if (t < 0) t += Math.PI * 2
    let lo = 0, hi = N - 1
    if ((S.ang[N - 1] - a0) * sgn <= t) lo = N - 1
    else while (hi - lo > 1) { const mid = (lo + hi) >> 1; if ((S.ang[mid] - a0) * sgn <= t) lo = mid; else hi = mid }
    const r = lo, r2 = (r + 1) % N
    const ax = S.fx[r] - this.cx, az = S.fz[r] - this.cz, bx = S.fx[r2] - S.fx[r], bz = S.fz[r2] - S.fz[r]
    const ex = Math.sin(th), ez = Math.cos(th)
    const den = bx * ez - bz * ex
    const f = Math.abs(den) < 1e-9 ? 0 : Math.max(0, Math.min(1, -(ax * ez - az * ex) / den))
    return { r, f, lam: Math.hypot(ax + bx * f, az + bz * f) }
  }

  /** Height (absolute y) along row r of side S at distance s out from its foot. */
  private rowY(S: Side, r: number, s: number): number {
    const K = S.K, col = S.col
    let lo = 0, hi = K - 1
    if (s >= col[hi]) return S.y[r * K + hi]
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (col[mid] <= s) lo = mid; else hi = mid }
    const t = (s - col[lo]) / (col[hi] - col[lo]), a = S.y[r * K + lo]
    return a + (S.y[r * K + hi] - a) * t
  }

  /** The land's height (absolute y) at (x, z), as drawn: the walls' mesh beside the floor, the tile beyond;
   *  −Infinity on the floor. */
  heightAt(x: number, z: number): number {
    const qx = x - this.cx, qz = z - this.cz, rho = Math.hypot(qx, qz), th = Math.atan2(qx, qz)
    for (const S of this.sides) {
      const q = this.rowAt(S, th)
      const s = S.inner ? q.lam - rho : rho - q.lam
      if (s < 0) continue
      if (s > WALL_TO || !this.tile) return groundH(x, z) + this.tileH(x, z)
      const r2 = (q.r + 1) % this.N, a = this.rowY(S, q.r, s)
      return a + (this.rowY(S, r2, s) - a) * q.f
    }
    return -Infinity
  }

  /** The land's slope at (x, z): its gradient into g (0 where there is no land either side). */
  private grad(x: number, z: number, g: number[]): void {
    const e = 6
    const h0 = this.heightAt(x, z)
    const one = (a: number, b: number) => (a === -Infinity ? (b === -Infinity || h0 === -Infinity ? 0 : (b - h0) / e) : b === -Infinity ? (h0 === -Infinity ? 0 : (h0 - a) / e) : (b - a) / (2 * e))
    g[0] = one(this.heightAt(x - e, z), this.heightAt(x + e, z))
    g[1] = one(this.heightAt(x, z - e), this.heightAt(x, z + e))
  }
  private readonly g2 = [0, 0]

  /**
   * FREE ROAM's ground on the land (−Infinity where there is none): its surface where it is gentle enough
   * to stand on; at a cliff, the cliff's foot — a face is not a ramp (wallsNear makes it solid). `y`: the
   * asker's height — over BLUE HOLLOW's roof its ice is ground, under it the floor is.
   */
  surface(x: number, z: number, y = Infinity): number {
    if (this.st.roof) { const roof = this.roofAt(x, z); if (roof && y > roof.ceil + 10) return roof.top }
    // (Over an arch: its top is ground — only up there: the race far below never asks it.)
    if (this.arches.length && y < Infinity) { const at = this.archTop(x, z, y); if (at > -Infinity) return Math.max(at, this.heightAt(x, z)) }
    const h = this.heightAt(x, z)
    if (h === -Infinity) return h
    const g = this.g2
    this.grad(x, z, g)
    const sl = Math.hypot(g[0], g[1])
    if (sl < 1.3) return h
    // Down the face to where it stops being one.
    let lo = h, px = x, pz = z
    const nx = -g[0] / sl, nz = -g[1] / sl
    for (let k = 0; k < 8; k++) {
      px += nx * 12; pz += nz * 12
      const hh = this.heightAt(px, pz)
      if (hh === -Infinity) { lo = Math.min(lo, groundH(px, pz)); break }
      lo = Math.min(lo, hh)
      this.grad(px, pz, g)
      if (Math.hypot(g[0], g[1]) < 1.3) break
    }
    return lo
  }

  /** The highest land within r of (x, z) (−Infinity if none): rings and flight clear it. */
  topNear(x: number, z: number, r: number): number {
    let t = this.heightAt(x, z)
    for (let k = 0; k < 8; k++) { const a = k * 0.785; t = Math.max(t, this.heightAt(x + Math.sin(a) * r, z + Math.cos(a) * r)) }
    const roof = this.st.roof ? this.roofAt(x, z) : null
    return roof ? Math.max(t, roof.top) : t
  }

  /** BLUE HOLLOW: over a roofed stretch, the ceiling and the ice's top there (absolute y). */
  roofAt(x: number, z: number): { ceil: number; top: number } | null {
    const i = this.rowNear(x, z)
    if (this.roofK[i] <= 0) return null
    const lat = (x - this.rx[i]) * this.tz[i] - (z - this.rz[i]) * this.tx[i]
    const W = this.half[i] + ROOF_D + 6
    if (Math.abs(lat) > W) return null
    const ceil = groundH(this.rx[i], this.rz[i]) + this.roofLift(i, (lat / W + 1) / 2)
    return { ceil, top: ceil + ROOF_T }
  }

  /** Under BLUE HOLLOW's roof? */
  underRoof(x: number, z: number, y: number): boolean {
    const r = this.roofAt(x, z)
    return !!r && y < r.ceil
  }

  /** The nearest row of the race's grid, for asks of my own: its own hint (the race's `last` is race
   *  state — the solver saves and restores it — and nothing else may move it). */
  private rowNear(x: number, z: number): number {
    const m = this.m
    let best = this.qlast, bd = Infinity
    for (let k = -24; k <= 24; k++) {
      const i = (((this.qlast + k) % m) + m) % m
      const d = (this.rx[i] - x) ** 2 + (this.rz[i] - z) ** 2
      if (d < bd) { bd = d; best = i }
    }
    if (bd > 4e6) for (let i = 0; i < m; i++) { const d = (this.rx[i] - x) ** 2 + (this.rz[i] - z) ** 2; if (d < bd) { bd = d; best = i } }
    this.qlast = best
    return best
  }

  nearest(x: number, z: number, full = false): number {
    const m = this.m
    let best = this.last, bd = Infinity
    const span = full ? m : 24
    for (let k = -span; k <= span; k++) {
      const i = (((this.last + k) % m) + m) % m
      const d = (this.rx[i] - x) ** 2 + (this.rz[i] - z) ** 2
      if (d < bd) { bd = d; best = i }
    }
    if (!full && bd > 4e6) return this.nearest(x, z, true)
    this.last = best
    return best
  }

  across(x: number, z: number): { i: number; lat: number; half: number } {
    const i = this.nearest(x, z)
    const lat = (x - this.rx[i]) * this.tz[i] - (z - this.rz[i]) * this.tx[i]
    return { i, lat, half: this.half[i] }
  }

  /** Is (x, z) on the gorge floor (between the walls)? */
  inside(x: number, z: number): boolean { const a = this.across(x, z); return Math.abs(a.lat) < a.half }

  wallsNear(x: number, z: number, y: number, out: { x: number; z: number; cr: number; big: boolean; wall?: boolean }[], n: number): number {
    // An arch's rock, flown into: a cliff's face across the gorge (only up there — never in the race's way).
    if (this.arches.length) {
      const h = this.archHit(x, z, y)
      if (h) {
        let o = out[n]
        if (!o) out[n] = o = { x: 0, z: 0, cr: 0, big: false }
        o.big = false; o.wall = true
        const s = Math.sign(h.out) || 1
        o.x = x - h.a.tx * s * (BIG - Math.abs(h.out)); o.z = z - h.a.tz * s * (BIG - Math.abs(h.out)); o.cr = BIG
        n++
      }
    }
    const i = this.nearest(x, z)
    const sx = this.tz[i], sz = -this.tx[i], h = this.half[i]
    const lat = (x - this.rx[i]) * this.tz[i] - (z - this.rz[i]) * this.tx[i]
    const side = lat >= 0 ? 1 : -1, d = Math.abs(lat)
    const open = (side > 0 ? this.openP : this.openN)[i] === 1
    // Beside the floor: the race's wall, a line at the foot (as it always was) — unless a breach opens it.
    if (d < h + BAND && !open) {
      if (y > groundH(this.rx[i], this.rz[i]) + this.st.rim) return n
      let o = out[n]
      if (!o) out[n] = o = { x: 0, z: 0, cr: 0, big: false }
      o.big = false // (scrape and glance like a trackside block: a wall you run along)
      o.wall = true
      o.x = this.rx[i] + sx * side * (h + BIG); o.z = this.rz[i] + sz * side * (h + BIG); o.cr = BIG
      return n + 1
    }
    if (d < h) return n
    // The land: rock where you are inside it by more than a step — its contour at your height, as a huge
    // round rock whose face is that contour (locally). On ground gentle enough to ride, you are on it.
    const T = this.heightAt(x, z)
    if (T === -Infinity || T < y + 4) return n
    const g = this.g2
    this.grad(x, z, g)
    const sl = Math.max(0.05, Math.hypot(g[0], g[1]))
    const nx = -g[0] / sl, nz = -g[1] / sl, s = Math.min(300, (T - y) / sl)
    let o = out[n]
    if (!o) out[n] = o = { x: 0, z: 0, cr: 0, big: false }
    o.big = false; o.wall = true
    o.x = x + nx * (s - BIG); o.z = z + nz * (s - BIG); o.cr = BIG
    return n + 1
  }

  distance(x: number, z: number): number {
    let bd = Infinity
    for (let i = 0; i < this.m; i++) bd = Math.min(bd, (this.rx[i] - x) ** 2 + (this.rz[i] - z) ** 2)
    return Math.sqrt(bd)
  }
  /** In the gorge or on its land (r: a landform's radius): nothing else stands there — past the land's
   *  edge the world's own landforms stand. Asked at boot (populate) before the land is built: then the
   *  land's own functions, at the point and round it. */
  covers(x: number, z: number, r: number): boolean {
    // (Remembered by 500 m cells as a margin — covered where margin + r > 0: populate asks ~50,000 times,
    //  most of them in the same few cells, and the test is a search of the line and the ways in.)
    const C = 500, key = Math.floor(x / C) * 100003 + Math.floor(z / C)
    let mg = this.reachMemo.get(key)
    if (mg === undefined) {
      const cx = (Math.floor(x / C) + 0.5) * C, cz = (Math.floor(z / C) + 0.5) * C
      const rho = Math.hypot(cx - this.cx, cz - this.cz), th = Math.atan2(cx - this.cx, cz - this.cz)
      // Inside the loop, the floor, the outer walls; the ways in (the world's mesas stood in them and blocked
      // the way); and the land — before it is built, anywhere it may reach.
      mg = Math.max(this.rowAt(this.sides[1], th).lam + WALL_TO - rho, 500 - this.chanAt(cx, cz))
      if (!this.tile) {
        const r0 = Math.floor(this.rowAt(this.sides[1], th).r / SUB), cand = this.cand
        for (let k = 0; k < cand.length; k++) cand[k] = (r0 + k - 40 + this.m) % this.m
        const l = lineAt(this.land, cx, cz, cand)
        mg = Math.max(mg, l.side === this.land.sgIn ? Infinity : landReach(this.style, cx, cz) - l.df)
      }
      this.reachMemo.set(key, mg)
    }
    if (mg + 360 > -r) return true
    if (!this.tile) return false
    if (Math.hypot(x - this.cx, z - this.cz) > this.reach + r) return false
    for (let k = 0; k < 9; k++) {
      const a = k * 0.785, rr = k ? r + 150 : 0
      if (this.tileH(x + Math.sin(a) * rr, z + Math.cos(a) * rr) > 2) return true
    }
    return false
  }


  // ── drawing ──

  /** The land (and the roof, the lamps, the water) as one group. `topMat`: the gentlest faces' own. */
  build(mat: THREE.Material, extra: { roofMat?: THREE.Material; topMat?: THREE.Material; roofTopMat?: THREE.Material; cliffMat?: THREE.Material; archMat?: THREE.Material } = {}): THREE.Group {
    const g = new THREE.Group()
    // A few chunks round the loop, both sides in each, each culled on its own: smaller ones culled better,
    // but every chunk is a draw call in every pass (at ~4 km chunks the frame's calls rose by half).
    const topMat = this.st.topY ? extra.topMat ?? null : null, cliffMat = topMat ? extra.cliffMat ?? null : null
    // (Drawn before the ground: from the air the land covers much of the screen, and the ground's costly
    // shading under it is then rejected by depth instead of shaded and painted over.)
    const add = (m: THREE.Mesh) => { m.renderOrder = -1; g.add(m) }
    for (const B of this.walls?.blocks ?? []) {
      if (B.pos.length) add(this.mesh(B.pos, B.crev, mat, B.posN))
      if (B.cliff.length) add(this.mesh(B.cliff, B.cliffC, cliffMat ?? mat, B.cliffN))
      if (B.top.length) add(this.mesh(B.top, B.topC, topMat ?? mat, B.topN))
    }
    if (this.st.roof) {
      // (The cave's mouths in the glacier's own cliff ice: in the cave's lit blue they were flat blue boards.)
      this.roofMeshes(extra.roofMat ?? mat, extra.roofTopMat ?? extra.topMat ?? mat, extra.cliffMat ?? mat, g)
      g.add(this.lamps())
      g.add(this.icicles())
      g.add(this.crevasses())
    }
    if (this.style === 'forest') { g.add(this.water()); g.add(this.treeLine()) }
    // Down the two big valleys, what made the gorge: the river coming in and going out, a lava flow, a frozen
    // meltwater stream, a dry wash.
    g.add(this.valleyStreams())
    if (this.arches.length) g.add(this.archMesh(extra.archMat ?? mat))
    return g
  }

  /** A mesh from a flat triangle list (its own normals if given, else each face's; culled by its bounds). */
  private mesh(pos: Float32Array, crev: Float32Array, mat: THREE.Material, nrm?: Float32Array): THREE.Mesh {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aCrev', new THREE.BufferAttribute(crev, 1))
    if (nrm) geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
    else geo.computeVertexNormals()
    geo.computeBoundingSphere()
    return new THREE.Mesh(geo, mat)
  }

  /** Height of the cave roof over the floor at race row r, across fraction t (0 one wall's top … 1 the
   *  other's): an arch, or a flat ceiling with rounded shoulders, by the cave's shape there. */
  roofLift(r: number, t: number): number {
    const edge = ROOF_H * (this.wallH(r, -1) + (this.wallH(r, 1) - this.wallH(r, -1)) * t)
    const arch = Math.sin(t * Math.PI)
    const flatTop = Math.min(1, Math.sin(t * Math.PI) * 3.2)
    return edge + this.rise[r] * (arch + (flatTop - arch) * this.flat[r])
  }

  /** BLUE HOLLOW: over each cave section the ceiling (lit ice, seen from below), the glacier's ice on top
   *  of it (seen from above), and at each end the mouth — the ice's face between the two. */
  private roofMeshes(ceilMat: THREE.Material, topMat: THREE.Material, wallMat: THREE.Material, g: THREE.Group): void {
    const m = this.m, A = 25
    const segs: [number, number][] = []
    for (let i = 0; i < m; i++) if (this.roofK[i] > 0 && this.roofK[(i - 1 + m) % m] <= 0) { let j = i; while (this.roofK[(j + 1) % m] > 0 && j - i < m) j++; segs.push([i, j]) }
    const sideH = new Map<number, number[]>()
    // A point of the roof at a (fractional) race row fr, column k across, `lift` over the ceiling.
    const P = (fr: number, k: number, lift: number, out: number[]) => {
      const i = Math.floor(fr), f = fr - i, a = ((i % m) + m) % m, b = (a + 1) % m, t = k / (A - 1)
      const L = (v: Float64Array) => v[a] + (v[b] - v[a]) * f
      const cx = L(this.rx), cz = L(this.rz), tx = L(this.tx), tz = L(this.tz)
      // (Its edges on the walls' own tops — they wander in height — and a little into them: a gap let the
      // aurora through along the seam.)
      // (The ice's top reaches on past the roof's edge, down into the glacier beside it: ending at the edge, a
      //  thin line of the cave's lit walls showed between them from the air.)
      const W = L(this.half) + ROOF_D + 6 + (lift >= ROOF_T && (k === 0 || k === A - 1) ? 120 : 0), across = (t * 2 - 1) * W
      const wob = k > 0 && k < A - 1 ? 6 * Math.sin(fr * 0.8 + k * 2.1) : -4
      const lift0 = this.roofLift(a, t) + (this.roofLift(b, t) - this.roofLift(a, t)) * f
      let y = groundH(cx, cz) + lift0 + wob + lift
      if (lift >= ROOF_T) {
        // The ice over the cave: the glacier running on across it at the height either side (just its thin
        // shell over the ceiling, it read from the air as a road laid across the gorge). (Asked once per
        // row: every corner is shared by six triangles.)
        const key = Math.round(fr * 1000)
        let lr = sideH.get(key)
        if (!lr) { lr = [this.heightAt(cx - tz * (W + 300), cz + tx * (W + 300)), this.heightAt(cx + tz * (W + 300), cz - tx * (W + 300))]; sideH.set(key, lr) }
        const [hl, hr] = lr
        if (hl > -Infinity && hr > -Infinity) y = Math.max(y, hl + (hr - hl) * t - 15 + 25 * Math.sin(Math.PI * t))
        // The ice sags and swells over the cave (a flat plate read as a slab laid across the gorge).
        const px = cx + tz * across, pz = cz - tx * across
        y += 22 * fbmR(px / 420, pz / 420, 2, 71) - 8 * Math.sin(Math.PI * t) + 9 * vn(px / 90, pz / 90, 72)
        if (k === 0 || k === A - 1) { const hg = this.heightAt(px, pz); if (hg > -Infinity) y = Math.min(y, hg - 8) }
      }
      out.push(cx + tz * across, y, cz - tx * across)
    }
    const hh = (n: number) => { const v = Math.sin(n * 12.9898) * 43758.5453; return v - Math.floor(v) }
    // (Every section's ceiling in one mesh, every top in one, every mouth in one: a draw call each.)
    const ceil: number[] = [], top: number[] = [], mouth: number[] = [], ends: number[] = []
    for (const [i0, i1] of segs) {
      // The mouths are ragged: each column's ice ends at its own place (up to most of a row on out), and
      // hangs below the ceiling there in a lip of its own depth — broken ice, not a sawn edge. (Out past the
      // last roofed row, never short of it: short, the cave's own walls under it showed from the air as blue
      // holes along the rim.)
      const R = (j: number, k: number) => j === 0 ? i0 - 0.85 * hh(i0 * 31 + k) : j === i1 - i0 ? i1 + 0.85 * hh(i1 * 17 + k) : i0 + j
      const drop = (j: number, k: number) => (k > 0 && k < A - 1 ? 12 + 34 * hh(j * 7 + k * 3 + i0) : 0)
      for (const [lift, pos] of [[0, ceil], [ROOF_T, top]] as const) {
        for (let j = 0; j < i1 - i0; j++) for (let k = 0; k < A - 1; k++) {
          P(R(j, k), k, lift, pos); P(R(j + 1, k), k, lift, pos); P(R(j, k + 1), k + 1, lift, pos)
          P(R(j + 1, k), k, lift, pos); P(R(j + 1, k + 1), k + 1, lift, pos); P(R(j, k + 1), k + 1, lift, pos)
        }
      }
      // The mouths: the ice between its lip and its top, across the gorge at both ends, facing out of the cave.
      for (const [j, sg] of [[0, -1], [i1 - i0, 1]]) {
        for (let k = 0; k < A - 1; k++) {
          P(R(j, k), k, -drop(j, k), mouth); P(R(j, k + 1), k + 1, -drop(j, k + 1), mouth); P(R(j, k), k, ROOF_T, mouth)
          P(R(j, k + 1), k + 1, -drop(j, k + 1), mouth); P(R(j, k + 1), k + 1, ROOF_T, mouth); P(R(j, k), k, ROOF_T, mouth)
        }
        ends.push((i0 + j) % m, sg)
      }
    }
    if (!ceil.length) return
    g.add(this.mesh(new Float32Array(ceil), new Float32Array(ceil.length / 3).fill(0.3), ceilMat))
    // (The top must face the sky; the ceiling's material is two-sided.)
    const tm = this.mesh(new Float32Array(top), new Float32Array(top.length / 3), topMat)
    Canyon.orient(tm, () => [0, 1, 0])
    // (Drawn as the glacier's own ground — its snow, sastrugi, polished ice — with smooth normals: in a
    //  material of its own it read from the air as pale plates laid across the gorge.)
    tm.geometry.deleteAttribute('normal')
    tm.geometry = mergeVertices(tm.geometry, 0.5)
    tm.geometry.computeVertexNormals()
    g.add(tm)
    const mm = this.mesh(new Float32Array(mouth), new Float32Array(mouth.length / 3).fill(0.1), wallMat)
    Canyon.orient(mm, (x, z) => {
      let bi = 0, bd = Infinity
      for (let j = 0; j < ends.length; j += 2) { const d = (x - this.rx[ends[j]]) ** 2 + (z - this.rz[ends[j]]) ** 2; if (d < bd) { bd = d; bi = j } }
      const i = ends[bi], s = ends[bi + 1]
      return [this.tx[i] * s, 0, this.tz[i] * s]
    })
    g.add(mm)
  }

  /** Turn each face of a flat-shaded mesh to face `want` (given its first corner). */
  private static orient(mesh: THREE.Mesh, want: (x: number, z: number) => number[]): void {
    const a = (mesh.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array
    for (let i = 0; i < a.length; i += 9) {
      const ux = a[i + 3] - a[i], uy = a[i + 4] - a[i + 1], uz = a[i + 5] - a[i + 2], wx = a[i + 6] - a[i], wy = a[i + 7] - a[i + 1], wz = a[i + 8] - a[i + 2]
      const w = want(a[i], a[i + 2])
      if ((uy * wz - uz * wy) * w[0] + (uz * wx - ux * wz) * w[1] + (ux * wy - uy * wx) * w[2] < 0) for (let j = 0; j < 3; j++) { const t = a[i + 3 + j]; a[i + 3 + j] = a[i + 6 + j]; a[i + 6 + j] = t }
    }
    mesh.geometry.computeVertexNormals()
  }

  /** Lamps along both walls (not across a breach's mouth), every ~200 m, warm; and a cold strip high
   *  under the roof where there is one. */
  private lamps(): THREE.Group {
    const g = new THREE.Group()
    const rows = this.m
    // Lamp posts at the foot of each wall, each with a warm pool of light on the ice floor in front of it.
    const warm = new THREE.InstancedMesh(new THREE.BoxGeometry(5, 5, 12).translate(0, 18, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 7.5, 3) }), rows * 2)
    const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.8, 1.2, 18, 5).translate(0, 9, 0), new THREE.MeshBasicMaterial({ color: 0x1a1d26 }), rows * 2)
    const pool = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.4, 0.6), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }), rows * 2)
    const cold = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 1.2, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 3.6, 7) }), rows)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0)
    let k = 0, kc = 0
    for (let r = 0; r < rows; r++) {
      const base = groundH(this.rx[r], this.rz[r])
      q.setFromAxisAngle(Y, Math.atan2(this.tx[r], this.tz[r]))
      // (Only in the caves and just out of their mouths: out in the open gorge, from the air, rows of lamps
      //  drew the race's ribbon across the glacier.)
      let cave = 0
      for (let q = -3; q <= 3; q++) cave = Math.max(cave, this.roofK[(r + q + rows) % rows])
      for (const side of [1, -1]) {
        if (!cave) continue
        if ((side > 0 ? this.openP : this.openN)[r]) continue
        const off = this.half[r] - 6
        const x = this.rx[r] + this.tz[r] * side * off, z = this.rz[r] - this.tx[r] * side * off
        v.set(x, groundH(x, z), z)
        warm.setMatrixAt(k, m.compose(v, q, s))
        post.setMatrixAt(k, m.compose(v, q, s))
        const px = this.rx[r] + this.tz[r] * side * (off - 40), pz = this.rz[r] - this.tx[r] * side * (off - 40)
        v.set(px, groundH(px, pz) + 0.6, pz)
        pool.setMatrixAt(k++, m.compose(v, q, s.set(70, 1, 70)))
        s.set(1, 1, 1)
      }
      if (this.roofK[r] <= 0) continue
      v.set(this.rx[r], base + this.roofLift(r, 0.5) - 12, this.rz[r])
      cold.setMatrixAt(kc++, m.compose(v, q, s))
    }
    warm.count = post.count = pool.count = k; cold.count = kc
    for (const x of [warm, cold, post, pool]) { x.frustumCulled = false; g.add(x) }
    return g
  }

  /** Icicles hanging from the roof (low-poly cones, a faint blue). */
  private icicles(): THREE.InstancedMesh {
    const per = 10, n = this.m * per
    // Lit ice, faceted, pale at the root going clear blue to the tip; each turned and leaning its own way
    // and fat or thin (unlit, all alike and upright, they read as paper cones pinned to the roof).
    const geo = new THREE.ConeGeometry(4, 1, 6, 3).rotateX(Math.PI).translate(0, -0.5, 0).toNonIndexed()
    const P = geo.getAttribute('position'), col = new Float32Array(P.count * 3)
    for (let i = 0; i < P.count; i++) {
      const t = -P.getY(i), x = P.getX(i), z = P.getZ(i)
      // (A wobble round each ring: no two faces in line.)
      const k = 1 + 0.25 * Math.sin(Math.atan2(z, x) * 3 + t * 5)
      P.setXYZ(i, x * k, P.getY(i), z * k)
      col[i * 3] = 0.9 - 0.35 * t; col[i * 3 + 1] = 0.97 - 0.17 * t; col[i * 3 + 2] = 1
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.computeVertexNormals()
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0, emissive: 0x3d7cbc, flatShading: true })
    patchStandard(mat, {})
    const ic = new THREE.InstancedMesh(geo, mat, n)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), e = new THREE.Euler()
    let c = 0
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / per), hh = Math.sin(i * 12.9898) * 43758.5453, f = hh - Math.floor(hh)
      if (this.roofK[r] <= 0) continue
      const W = this.half[r] + ROOF_D, across = (f * 2 - 1) * this.half[r] * 0.8, t = across / W * 0.5 + 0.5
      // (Into the roof, so they hang from it: they floated just below before.)
      const y = groundH(this.rx[r], this.rz[r]) + this.roofLift(r, t) + 8
      v.set(this.rx[r] + this.tz[r] * across, y, this.rz[r] - this.tx[r] * across)
      // (Up to ~70 m: longer, they hung far down into the hall, well below the ceiling's own height.)
      const w = 2.5 + 5 * ((f * 3.1) % 1) ** 1.5
      s.set(w * (0.7 + 0.6 * ((f * 5.7) % 1)), 12 + 55 * ((f * 7.3) % 1) ** 2, w * (0.7 + 0.6 * ((f * 9.1) % 1)))
      q.setFromEuler(e.set(0.12 * (((f * 13.7) % 1) - 0.5), ((f * 17.3) % 1) * 6.28, 0.12 * (((f * 19.1) % 1) - 0.5)))
      ic.setMatrixAt(c++, m.compose(v, q, s))
    }
    ic.count = c
    ic.frustumCulled = false
    return ic
  }

  /** BLUE HOLLOW: crevasse fields on the ice — narrow ragged cracks in echelon, across the way the ice
   *  flows (out from the middle): pale blue at the lips going deep blue down inside. (Dark boxes read as
   *  black blocks lying on the snow.) */
  private crevasses(): THREE.InstancedMesh {
    // (Lit from inside, as ice is: in the polar dusk a crack lit only by the sky was a black hole.)
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, emissive: 0x1c4f8c, roughness: 0.35, flatShading: true, side: THREE.DoubleSide })
    patchStandard(mat, {})
    // One crack, 1 long (z), 1 deep: its two walls zigzag along it, opening in the middle and pinching shut
    // at the ends; the floor wanders under it.
    const SEG = 14, P: number[] = [], C: number[] = [], idx: number[] = []
    let sd = 4111
    const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296 }
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG, z = t - 0.5, open = Math.sqrt(Math.sin(Math.PI * t)) * (0.55 + 0.45 * rnd())
      const cx = (rnd() - 0.5) * 0.35
      P.push(cx - 0.5 * open, 0, z + (rnd() - 0.5) * 0.02, cx + 0.5 * open, 0, z + (rnd() - 0.5) * 0.02, cx + (rnd() - 0.5) * 0.2 * open, -(0.4 + 0.6 * Math.sqrt(open)), z)
      C.push(0.62, 0.85, 1.0, 0.62, 0.85, 1.0, 0.02, 0.07, 0.22)
      if (i < SEG) { const a = i * 3, b = a + 3; idx.push(a, b, a + 2, b, b + 2, a + 2, a + 1, a + 2, b + 1, b + 1, a + 2, b + 2) }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const MAX = 2600
    const cr = new THREE.InstancedMesh(geo, mat, MAX)
    const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), E = new THREE.Euler()
    let k = 0
    sd = 977
    for (let f = 0; f < 110 && k < MAX; f++) {
      // A field: on the cap inside the loop, or on the glacier outside before its edge.
      const S = this.sides[rnd() < 0.65 ? 0 : 1], r = Math.floor(rnd() * this.N)
      const d = S.inner ? 600 + rnd() * (S.lam[r] - 1600) : 450 + rnd() * 800
      const ox = (S.fx[r] - this.cx) / S.lam[r], oz = (S.fz[r] - this.cz) / S.lam[r], dir = S.inner ? -1 : 1
      const fx = S.fx[r] + ox * dir * d, fz = S.fz[r] + oz * dir * d
      const yaw0 = Math.atan2(ox, oz) + Math.PI / 2 + (rnd() - 0.5) * 0.6
      const count = 8 + Math.floor(rnd() * 16), gap = 22 + rnd() * 30
      for (let j = 0; j < count && k < MAX; j++) {
        // In echelon: each a step along the field and a little sideways, each its own length and turn.
        const o = (j - count / 2) * gap, sl = (rnd() - 0.5) * 120 + o * 0.6 * Math.sin(f)
        const x = fx + ox * o + Math.sin(yaw0) * sl, z = fz + oz * o + Math.cos(yaw0) * sl
        const yaw = yaw0 + (rnd() - 0.5) * 0.35
        const h = this.heightAt(x, z)
        if (h === -Infinity) continue
        this.grad(x, z, this.g2)
        if (Math.hypot(this.g2[0], this.g2[1]) > 0.3) continue
        // Laid along the ice (pitched to it end to end), its lips just into it.
        const len = 70 + rnd() * 190, ax = Math.sin(yaw) * len / 2, az = Math.cos(yaw) * len / 2
        const h0 = this.heightAt(x - ax, z - az), h1 = this.heightAt(x + ax, z + az)
        if (h0 === -Infinity || h1 === -Infinity) continue
        q.setFromEuler(E.set(-Math.atan2(h1 - h0, len), yaw, 0, 'YXZ'))
        v.set(x, Math.min(h, (h0 + h1) / 2) + 0.25, z); s.set((2 + rnd() * 5) * (rnd() < 0.5 ? -1 : 1), 18 + rnd() * 30, len)
        cr.setMatrixAt(k++, mm.compose(v, q, s))
      }
    }
    cr.count = k
    cr.frustumCulled = false
    return cr
  }

  /** WHITEWATER: pines over the banks and the hills behind them (low-poly cones on trunks), wherever it is
   *  gentle enough to grow. */
  private treeLine(): THREE.Group {
    const g = new THREE.Group(), per = 14, n = this.m * per * 2
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x24502a, roughness: 0.9, flatShading: true }), n)
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 1, 5).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 }), n)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3()
    let k = 0
    for (let r = 0; r < this.m; r++) for (const side of [1, -1]) for (let j = 0; j < per; j++) {
      const hh = Math.sin((r * 31 + j * 7 + side * 3) * 12.9898) * 43758.5453, f = hh - Math.floor(hh)
      // (Thick near the gorge, thinning out over the hills — as far as they roll: the world's own groves
      // keep off the land.)
      const off = this.half[r] + 70 + f ** 1.6 * 2600, a = j / per
      const cx = this.rx[r] + this.tx[r] * a * 200, cz = this.rz[r] + this.tz[r] * a * 200
      const x = cx + this.tz[r] * side * off, z = cz - this.tx[r] * side * off
      const top = this.heightAt(x, z)
      if (top === -Infinity) continue
      this.grad(x, z, this.g2)
      if (Math.hypot(this.g2[0], this.g2[1]) > 0.75) continue
      const H = 26 + 34 * ((f * 7.7) % 1)
      v.set(x, top + H * 0.3, z); s.set(H * 0.32, H, H * 0.32)
      crown.setMatrixAt(k, m.compose(v, q, s))
      v.set(x, top - 2, z); s.set(H * 0.3, H * 0.35, H * 0.3)
      trunk.setMatrixAt(k++, m.compose(v, q, s))
    }
    for (const x of [crown, trunk]) { x.count = k; x.frustumCulled = false; g.add(x) }
    return g
  }

  /** WHITEWATER: the river on the gorge floor — dark water, the sky in it, streaks running downstream. */
  private water(): THREE.Mesh {
    // Dense (every 50 m along, 21 across): the surface follows the ground closely — sampled every 200 m,
    // the terrain's swells rose through it as dry strips.
    const SUB = 4, rows = this.m * SUB, A = 21
    const pos = new Float32Array(rows * A * 3), uv = new Float32Array(rows * A * 2)
    let along = 0, px = 0, pz = 0
    for (let r = 0; r < rows; r++) {
      const i0 = Math.floor(r / SUB), i1 = (i0 + 1) % this.m, f = (r % SUB) / SUB
      const L = (a: Float64Array) => a[i0] + (a[i1] - a[i0]) * f
      const cx = L(this.rx), cz = L(this.rz), tx = L(this.tx), tz = L(this.tz)
      if (r > 0) along += Math.hypot(cx - px, cz - pz)
      px = cx; pz = cz
      // (Bank to bank, its edges under the walls' feet: narrower, a strip of dry floor showed like a pier.)
      const W = L(this.half) + 24
      for (let k = 0; k < A; k++) {
        const t = k / (A - 1), across = (t * 2 - 1) * W
        const x = cx + tz * across, z = cz - tx * across
        const o = (r * A + k) * 3
        pos[o] = x; pos[o + 1] = groundH(x, z) + 1.4; pos[o + 2] = z
        uv[(r * A + k) * 2] = t; uv[(r * A + k) * 2 + 1] = along
      }
    }
    const idx: number[] = []
    for (let r = 0; r < rows; r++) {
      const r2 = (r + 1) % rows
      for (let k = 0; k < A - 1; k++) { const a = r * A + k, b = r2 * A + k, c = r * A + k + 1, d = r2 * A + k + 1; idx.push(a, c, b, b, c, d) }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.setIndex(idx)
    geo.setAttribute('aF', new THREE.BufferAttribute(new Float32Array(rows * A).fill(0.5), 1))
    const w = new THREE.Mesh(geo, Canyon.waterMat())
    w.frustumCulled = false
    w.renderOrder = 1
    return w
  }

  /** Every arch in one mesh: a rough tube along its spine — sagging, thickest and widest at its feet, which
   *  run on down into the land — its rock knobbled and eroded (a smooth even span read as a built bridge). */
  private archMesh(mat: THREE.Material): THREE.Mesh {
    const NS = 56, NR = 16, pos: number[] = [], idx: number[] = []
    for (const a of this.arches) {
      const base = pos.length / 3, i0 = idx.length, ex = a.bx - a.ax, ez = a.bz - a.az
      for (let i = 0; i <= NS; i++) {
        // (Past both feet a little, and down: buried in the rim, never standing on it.)
        const t = -0.06 + 1.12 * (i / NS), p = Canyon.archAt(a, t), bury = Math.max(0, -t, t - 1) * 900
        const cx = a.ax + ex * t, cz = a.az + ez * t, cy = p.u + p.T / 2 - bury
        for (let k = 0; k < NR; k++) {
          const ang = (k / NR) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang)
          const x0 = cx + a.tx * p.W * ca, z0 = cz + a.tz * p.W * ca, y0 = cy + (p.T / 2) * sa
          // Eroded: lumps and hollows, deeper on the underside and the sides; the top flatter.
          // (No finer than the spine's own spacing, ~70 m: finer, it aliased into a sawtooth along the edges.)
          const e = 1 + 0.3 * vn(x0 / 170, (z0 + y0) / 170, 81) + 0.12 * vn(x0 / 75, (z0 - y0) / 75, 82) - 0.12 * Math.max(0, -sa)
          const top = sa > 0.5 ? 0.6 : 1
          pos.push(cx + a.tx * p.W * ca * e, cy + (p.T / 2) * sa * (1 + (e - 1) * top), cz + a.tz * p.W * ca * e)
        }
        if (i < NS) for (let k = 0; k < NR; k++) {
          const q0 = base + i * NR + k, q1 = base + i * NR + ((k + 1) % NR), q2 = q0 + NR, q3 = q1 + NR
          idx.push(q0, q2, q1, q1, q2, q3)
        }
      }
      // (Its faces wound to face out: their normal is the spine × up, which is +t̂ only one way round.)
      if (ex * a.tz - ez * a.tx < 0) for (let j = i0; j < idx.length; j += 3) { const q = idx[j + 1]; idx[j + 1] = idx[j + 2]; idx[j + 2] = q }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = true; m.receiveShadow = true
    return m
  }

  /** The big valleys' streams: a strip down each one's axis from inside the floor out onto the plain, as wide
   *  as part of its floor, at the floor's own level (the land round it rises over its edges). */
  private valleyStreams(): THREE.Mesh {
    const A = 9, pos: number[] = [], uv: number[] = [], fa: number[] = [], idx: number[] = []
    const frac = this.style === 'forest' ? 0.6 : this.style === 'lava' ? 0.4 : this.style === 'desert' ? 0.45 : 0.3
    for (const b of this.breaches) {
      if (!b.big) continue
      const P = b.axis, n = P.length / 3, base = pos.length / 3
      // (From the floor's edge on: lying out on the floor it was a sheet on the ice, and a second river laid
      //  over the first.)
      for (let i = 1; i < n; i++) {
        const j = Math.min(n - 2, i), dx = P[(j + 1) * 3] - P[j * 3], dz = P[(j + 1) * 3 + 1] - P[j * 3 + 1], l = Math.hypot(dx, dz) || 1
        // (Its first point is on the floor: the stream starts in the river, or out of the gorge's lava.)
        const hw = (i === 0 ? b.wid[1] : b.wid[i]) * frac * (0.85 + 0.3 * vn(i * 0.37, b.row, 61))
        for (let k = 0; k < A; k++) {
          const t = k / (A - 1), a = (t * 2 - 1) * hw, x = P[i * 3] + (dz / l) * a, z = P[i * 3 + 1] - (dx / l) * a
          pos.push(x, groundH(x, z) + 1.4, z); uv.push(t, P[i * 3 + 2]); fa.push((i - 1) / (n - 2))
        }
        if (i < n - 1) for (let k = 0; k < A - 1; k++) { const q = base + (i - 1) * A + k; idx.push(q, q + 1, q + A, q + A, q + 1, q + A + 1) }
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setAttribute('aF', new THREE.Float32BufferAttribute(fa, 1))
    geo.setIndex(idx)
    const m = new THREE.Mesh(geo, Canyon.waterMat(this.style === 'lava' ? 1 : this.style === 'ice' ? 2 : this.style === 'desert' ? 3 : 0, true))
    m.frustumCulled = false
    m.renderOrder = 1
    return m
  }

  /** Running water (kind 0), molten lava (1), a frozen stream (2), or a dry wash (3). */
  private static waterMat(kind = 0, stream = false): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      defines: { KIND: kind },
      uniforms: { uTime: WATER_T, uAurT: { value: 0 }, ...WORLD_FADE },
      side: THREE.DoubleSide,
      // (Lifted with distance — 1.4 m over the ground is below the depth buffer's grain km off: there the
      //  ground cut through it along its triangles, the river's edges sawn into steps from the air. With the
      //  square of it, as the grain grows: lifted evenly, near by it stood above its banks as a bright line.)
      // aF: how far along a valley's stream (0…1; the river's own is 0.5 all along).
      vertexShader: `attribute float aF; varying vec2 vUv; varying vec3 vW; varying float vF;
        void main() { vUv = uv; vF = aF; vec4 w = modelMatrix * vec4(position, 1.0); float d = length(w.xz - cameraPosition.xz); w.y += min(15.0, 1.5e-7 * d * d); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `${SKY_GLSL}
        uniform float uTime; varying vec2 vUv; varying vec3 vW; varying float vF;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + 1.0), f.x), f.y); }
        void main() {
          vec3 V = normalize(cameraPosition - vW);
          float fr = pow(1.0 - max(V.y, 0.0), 3.0);
          // Streaks running downstream, broken by a slower swell; their density makes rapids.
          // Flow: streaks running downstream, quick; standing waves where the river runs fast (rapids, every
          // few km) — bands of white across it, scrolling.
          float s = n(vec2(vUv.x * 70.0, vUv.y * 0.035 - uTime * 6.0)) * n(vec2(vUv.x * 12.0, vUv.y * 0.008 - uTime * 2.0));
          float rap = smoothstep(0.5, 0.8, n(vec2(vUv.y * 0.0012, 3.0)));
          // (Broken crests, not solid bands across the whole river.)
          float wave = smoothstep(0.85, 1.0, sin(vUv.y * 0.09 - uTime * 4.0 + n(vec2(vUv.x * 6.0, vUv.y * 0.01)) * 3.0)) * rap * smoothstep(0.4, 0.8, n(vec2(vUv.x * 18.0, vUv.y * 0.05)));
          vec3 c = mix(vec3(0.012, 0.05, 0.06), vec3(0.36, 0.52, 0.64), 0.04 + 0.3 * fr);
          c += vec3(0.85, 0.95, 1.0) * smoothstep(0.5 - 0.2 * rap, 0.8 - 0.2 * rap, s) * (0.55 + 0.4 * rap);
          // The sun in it: a broken glint.
          vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
          c += vec3(1.0, 0.9, 0.7) * pow(max(dot(R, normalize(vec3(-0.62, 0.36, 0.68))), 0.0), 60.0) * (0.2 + s) * 0.6;
          c = mix(c, vec3(0.92, 0.97, 1.0), wave * 0.6);
          float bank = smoothstep(0.08, 0.0, vUv.x) + smoothstep(0.92, 1.0, vUv.x);
          c = mix(c, vec3(0.9, 0.95, 0.95), bank * (0.5 + 0.5 * n(vec2(vUv.y * 0.05 - uTime, vUv.x * 30.0))));
          #if KIND == 1
          // Lava: crust plates riding a molten flow, glowing in the cracks between them and hottest mid-stream.
          float pl = n(vec2(vUv.x * 9.0, vUv.y * 0.02 - uTime * 0.6)) * 0.7 + n(vec2(vUv.x * 25.0, vUv.y * 0.06 - uTime * 0.6)) * 0.3;
          float mid = 1.0 - abs(vUv.x * 2.0 - 1.0);
          float hot = smoothstep(0.55, 0.35, pl) * (0.4 + 0.6 * mid);
          c = mix(vec3(0.06, 0.035, 0.03), vec3(2.6, 0.9, 0.15), hot) + vec3(0.5, 0.12, 0.02) * mid * 0.3;
          #elif KIND == 2
          // Frozen: ice, cracked, blue where it is clear, the sky in it; no flow. Lit as the snow round it is.
          float cr = smoothstep(0.03, 0.0, abs(n(vec2(vUv.x * 14.0, vUv.y * 0.04)) - 0.5));
          c = mix(vec3(0.3, 0.48, 0.7), vec3(0.55, 0.7, 0.86), n(vec2(vUv.x * 5.0, vUv.y * 0.01))) * (1.0 - 0.3 * cr);
          c *= SUN_COL * max(SUN_DIR.y, 0.0) * 0.6 + skyColor(vec3(0.0, 1.0, 0.0)) * 0.5 + vec3(0.3, 0.36, 0.48);
          #elif KIND == 3
          // A dry wash: paler silt in braided channels, darker gravel bars between — lit as the ground is.
          float br = n(vec2(vUv.x * 7.0 + 2.0 * n(vec2(vUv.y * 0.004, 1.0)), vUv.y * 0.006));
          c = mix(vec3(0.5, 0.36, 0.24), vec3(0.66, 0.53, 0.4), smoothstep(0.35, 0.6, br)) * (0.9 + 0.2 * n(vec2(vUv.x * 60.0, vUv.y * 0.2)));
          c *= (SUN_COL * max(SUN_DIR.y, 0.0) + skyColor(vec3(0.0, 1.0, 0.0)) * 0.36) * 0.72;
          #endif
          // (Running water and lava half as hazed as the land: the haze is the land's, and fully in it the river
          //  went to milk from the air.)
          c = KIND <= 1 ? mix(c, applyFog(c, vW), 0.5) : applyFog(c, vW);
          // A valley's stream fades in from the gorge's edge, out at its sides, and away into the plain at its far
          // end (cut off, it ended in a hook or an arrowhead; edged, it lay on the land as a ribbon).
          float edge = KIND >= 2 ? smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x) : 1.0;
          gl_FragColor = vec4(c, edge * smoothstep(0.0, 0.06, vF) * smoothstep(0.95, 0.6, vF)); // (else opaque: the worn track's orange smear showed through)
        }`,
      // (Blended only down the valleys, which fade: the river is opaque, and drawn so it hides what is under it.)
      transparent: stream, depthWrite: !stream,
    })
  }
}
