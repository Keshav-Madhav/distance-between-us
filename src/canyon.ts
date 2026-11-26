// The gorge courses: a gorge cut into a landmass that follows a whole loop. The race runs down its floor
// between two walls; round it the land is real land — not a ring of tableland with a trench in it (the
// owner: "a donut inside a donut, flat top like it was cut by a straight knife"):
//   desert  CANYON RUN — Grand Canyon strata stepping up from the floor; inside the loop a high eroded
//           massif (side canyons, mesas on it); outside, the plateau breaks down to the plain in spurs and
//           buttes.
//   ice     BLUE HOLLOW — a glacier: lamplit cave sections roofed in ice, open ice gorge between them; on top
//           an ice cap with crevasse fields; its edge falls to the plain in ice cliffs and seracs.
//   lava    MAGMA GORGE — a basalt ravine in a lava plateau, lava at the walls' feet and in the plateau's
//           collapse pits; its broken flow fronts step down to the lava plains.
//   forest  WHITEWATER — a river gorge: granite banks, then wooded hills rolling away on both sides.
// Each has a few side canyons ("breaches") from the floor out to the open world at ground level, so FREE
// ROAM finds the gorge from outside and drives in. They lead outward only: no shortcut.
//
// Shape: each side of the floor is a grid — rows round the loop every ~100 m, columns out from the wall's
// foot along the ray from the loop's middle (every loop is star-shaped about it, so no two rays cross: the
// old profile, swept along the walls' normals, folded over itself at CANYON RUN's tight bends). Heights
// come from one function per world (noise at several scales, strata terraced in), so no two
// cross-sections are alike. The inner grid runs all the way to the middle: the loop's inside is filled.
//
// Solid: World.near asks wallsNear. Beside the floor it is the wall as it always was (a huge round "rock"
// whose surface is the foot, so racing is unchanged); everywhere else it is the drawn grid itself —
// inside the land by more than a step is rock, pushed out toward its contour at your height. FREE ROAM
// rides the same grid (surface): gentle ground is ground; a cliff is not a ramp (its foot is the ground).
import * as THREE from 'three'
import { groundH } from './terrain'
import { patchStandard } from './shaders'

export type GorgeStyle = 'desert' | 'ice' | 'lava' | 'forest'

/** One vertex being shaped (reused). */
interface Ctx {
  inner: boolean
  /** Out from the foot along the ray (m). */
  d: number
  x: number
  z: number
  /** Along the loop (m), and the loop's length. */
  s: number
  L: number
  /** BLUE HOLLOW: how roofed this row is (0 open gorge … 1 cave), and the wall's top under the roof (m). */
  roof: number
  edgeH: number
  /** …the top of the ice over the cave's middle there, and how near a cave section is (smoothed along
   *  the loop, 0…1). */
  apex: number
  roofS: number
  /** Out from a breach's floor edge (m; ≤ 0 on its floor, Infinity with none near). */
  chan: number
  /** The vertex's aCrev (the shape may set it: lava's glow). */
  crev: number
  /** CANYON RUN's island: out from its canyons' floor edge (m; Infinity none near), and that floor's level. */
  ich: number
  ichE: number
  /** The loop's middle. */
  cx: number
  cz: number
  /** Where the outer land must be down at its foot (m from the foot). */
  lim: number
}

interface Style {
  /** Floor half-width (m) round the loop (u in 0…1). */
  half: (u: number) => number
  /** Height above the floor (m) under which the wall beside the floor is in the way. */
  rim: number
  /** How far out the land reaches (m from the foot, the outer side). */
  outer: number
  /** How much the cave walls' height wanders along the loop (±). */
  hk: number
  /** A roof over the floor in the cave sections (BLUE HOLLOW). */
  roof?: number
  /** Along the loop (u): the cave walls' height scale, the roof's rise above the walls' tops (m), and
   *  how flat the roof is (0 an arch, 1 a flat ceiling) — the cave changes shape as it goes. */
  vary?: (u: number) => { wall: number; rise: number; flat: number }
  /** The first columns out from the foot (m): finest where the walls stand. */
  near: number[]
  /** Breaches: the floor's half-width (m: far out, and extra at the mouth). */
  chanW: [number, number]
  /** Breaches round the loop (u) — where the races keep off the outer wall. */
  breachU: number[]
  /** The farthest out (m from the foot) the outer land can stand: past it, ground. */
  reach: number
  /** The land's height above the ground (m) at one vertex. */
  shape: (c: Ctx) => number
  /** Faces flatter than this go to the top material, when one is given (the glacier's snow). */
  topY?: number
}

// ── noise: value noise on a hashed lattice, summed in octaves ──
function hash(ix: number, iz: number, sd: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(sd, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
/** −1…1, smooth. */
function vn(x: number, z: number, sd: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz)
  const a = hash(ix, iz, sd), b = hash(ix + 1, iz, sd), c = hash(ix, iz + 1, sd), d = hash(ix + 1, iz + 1, sd)
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1
}
function fbm(x: number, z: number, oct: number, sd: number): number {
  let s = 0, a = 1, n = 0
  for (let o = 0; o < oct; o++) { s += a * vn(x, z, sd + o * 17); n += a; a *= 0.5; x = x * 2.03 + 1.7; z = z * 2.03 - 3.1 }
  return s / n
}
/** fbm with each octave turned (value noise's lattice shows: a threshold on it drew square pits and
 *  edges along the axes). */
const RC = Math.cos(0.61), RS = Math.sin(0.61)
function fbmR(x: number, z: number, oct: number, sd: number): number {
  let s = 0, a = 1, n = 0
  for (let o = 0; o < oct; o++) {
    const rx = x * RC - z * RS, rz = x * RS + z * RC
    s += a * vn(rx, rz, sd + o * 17); n += a; a *= 0.5; x = rx * 2.03 + 1.7; z = rz * 2.03 - 3.1
  }
  return s / n
}
/** Domain-warped fbmR (k: how far it is pushed, in the noise's own units): lobed, wandering shapes —
 *  flow fronts, pit rims, serac fields — never blobs on a lattice. */
function warp(x: number, z: number, sd: number, k: number): number {
  // (One octave each for the push: two cost a fifth of the land's whole build, for nothing visible.)
  const wx = vn(x * 0.6 + 3.1, z * 0.6 - 1.7, sd + 101), wz = vn(x * 0.6 - 4.3, z * 0.6 + 2.9, sd + 202)
  return fbmR(x + k * wx, z + k * wz, 3, sd)
}
/** Noise along the loop (scale m, b a second coordinate): taken round a circle, so it closes on itself —
 *  as a plain function of the distance along, it jumped where the loop starts, and the step ran out from
 *  there as a straight crease to the middle. */
function va(c: Ctx, scale: number, b: number, sd: number): number {
  const R = c.L / (2 * Math.PI * scale), th = (c.s / c.L) * Math.PI * 2
  return vn(R * Math.cos(th) + b, R * Math.sin(th) - 0.7 * b + 50, sd)
}
/** k × f(), f only asked when k is not 0 (the warped noise is most of the land's build time). */
const w0 = (k: number, f: () => number) => (k === 0 ? 0 : k * f())
const sst = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** Strata: the potential E stepped into levels — a cliff (the riser) at the top of each band, a near-flat
 *  ledge (the tread, rising `g` of the band) below it, and at each cliff's foot a talus apron (`tal` of the
 *  band, concave: no hard line where cliff meets ground). Level j (past the first) is lifted by ofs[j] —
 *  the strata dip and swell, and where one level reaches the next its bench pinches out. */
function terrace(E: number, L: readonly number[], a: number, g: number, ofs: readonly number[] | number = 0, tal = 0): number {
  if (E <= L[0]) return L[0]
  let T: number | null = null, lo = L[0]
  for (let j = 0; j < L.length - 1 && T === null; j++) {
    const hi = L[j + 1] + (typeof ofs === 'number' ? ofs : ofs[j + 1])
    if (hi <= lo + 4) continue
    if (E < hi) {
      const D = hi - lo, f = (E - lo) / D, ta = tal * (1 - g) * sst(a - 0.3, a, f) ** 2
      T = lo + D * (g * f + ta + (1 - g - ta) * sst(a, 1, f))
    }
    lo = Math.max(lo, hi)
  }
  if (T === null) T = lo + (E - lo) * g * 2
  // (Deep inside the loop the grid's rows close in on the middle: a stepped cliff drawn across them came
  //  out as a sunburst of slivers. There the land rolls instead — TK, set per vertex, 0 smooth … 1 strata.)
  return E + (T - E) * TK
}
/** How stepped the strata are at the vertex being shaped (see terrace). */
let TK = 1
/** Per-level lifts for terrace (reused). */
const OFS = new Array<number>(12).fill(0)
/** The strata's lifts at (x, z): a dip of ~1° across the land (from its middle), and each level swelling on
 *  its own (`amp` m) — so benches come and go, merge and pinch out (never the same count all the way). */
function strata(x: number, z: number, cx: number, cz: number, n: number, amp: number, sd: number): number[] {
  const dip = 0.017 * ((x - cx) * 0.8 + (z - cz) * 0.6)
  OFS[0] = 0; OFS[1] = 0.25 * amp * fbmR(x / 3000, z / 3000, 2, sd)
  for (let j = 2; j < n; j++) OFS[j] = Math.max(-220, Math.min(220, dip)) + amp * fbmR(x / 2600, z / 2600, 2, sd + j * 13)
  return OFS
}
/** Fine steps (lava flow fronts, `step` m high), each front sharp, the flow behind it near-flat. */
const fronts = (E: number, step: number) => { const k = Math.floor(E / step), f = E / step - k; return (k + 0.25 * f + 0.75 * sst(0.7, 1, f)) * step }

const DESERT_LV = [-6, 220, 450, 690, 840, 1000, 1170, 1320]
// (Few, tall ice cliffs: with a level every ~110 m the gorge's sides broke into a scree of small blocks.)
const ICE_LV = [-6, 125, 330, 560, 790]
const LAVA_LV = [-6, 190, 400, 600, 700, 810, 930]

/** The cave's roof: its edges stand on the walls `ROOF_D` out from the foot, at `ROOF_H` (× the row's
 *  height scale); its ice is `ROOF_T` thick (the glacier over the cave is that much higher). */
const ROOF_D = 260, ROOF_H = 290, ROOF_T = 70
/** BLUE HOLLOW's cave wall from its foot to the roof's edge: [m out, height] (the height at ROOF_D is
 *  scaled to the row's own). */
const CAVE_WALL: [number, number][] = [[0, -4], [30, 60], [70, 150], [140, 230], [ROOF_D, ROOF_H]]

/** The outer rim: a plateau 1–3 km wide (wandering along the loop, its outline ragged), then the way down
 *  to the surrounding land over another 2–4 km. 0 on the rim … 1 down on the plain. (The rim was one mesa
 *  thick: from anywhere it read as a fence round the track.) */
function rimDown(c: Ctx, sd: number, dMin = 2000, dAmp = 900, rimB = 2000): number {
  const { x, z, d } = c
  const rimW = rimB + 800 * va(c, 5000, 7, sd) + 450 * warp(x / 1800, z / 1800, sd + 1, 0.8)
  const D = dMin + dAmp * fbmR(x / 6000, z / 6000, 2, sd + 2)
  const dd = d + 380 * warp(x / 900, z / 900, sd + 3, 0.9)
  // (Down by the grid's end whatever the noise says: land still standing there ended in a wall along it.)
  return Math.max(Math.min(1, Math.max(0, (dd - rimW) / D)), Math.min(1, Math.max(0, (d - c.lim + 1800) / 1500)))
}

const STYLES: Record<GorgeStyle, Style> = {
  desert: {
    half: (u) => { const a = u * Math.PI * 2; return 1320 + 240 * Math.sin(a * 3 + 1.1) + 130 * Math.sin(a * 11 + 2.3) + 60 * Math.sin(a * 23 + 0.4) },
    rim: 900, outer: 8600, reach: 8400, hk: 0.15,
    near: [0, 8, 14, 22, 32],
    chanW: [230, 330],
    breachU: [0.14, 0.4, 0.62, 0.86],
    // (Its tops and ledges smooth-shaded, cap rock and sand: faceted, the massif's long thin triangles near
    // the middle shone as a starburst.)
    topY: 0.8,
    shape: (c) => {
      const { x, z, d } = c
      // (The outer rim lower than the inner and wandering more: one side of a canyon is rarely the other's
      // mirror, and an even ring of rim read as a donut.)
      const A = c.inner ? 1020 + 150 * va(c, 9000, 1, 3) : 760 + 260 * va(c, 6000, 5, 3)
      const lam = 330 + 170 * va(c, 5200, 2, 4)
      let E = 150 + A * (1 - Math.exp(-d / lam))
      E += sst(0, 90, d) * (130 * fbm(x / 1700, z / 1700, 3, 11) + 55 * fbm(x / 430, z / 430, 2, 12))
      // Gullies: side canyons cut back into the rim every km or two, a few hundred m wide — the rim
      // notched and stepped back, never one line.
      const gl = 1 - Math.abs(va(c, 650, d / 2600 + 7 + (c.inner ? 0 : 40), 5))
      E -= 620 * gl ** 8 * sst(20, 160, d) * sst(2800, 900, d)
      if (c.inner) {
        // The massif: higher inward, mesas standing on it — and split into mesas by its own canyons, which
        // branch down toward the gorge (see island).
        E += sst(500, 2600, d) * (200 + 170 * fbm(x / 3600, z / 3600, 3, 13))
        E += 330 * sst(0.45, 0.7, vn(x / 1300, z / 1300, 21)) * sst(1200, 2400, d)
        if (c.ich < 1e8) E = Math.min(E, c.ichE + Math.max(0, c.ich) * 2.4)
      } else {
        // The rim, then down over km of benches and debris slopes to the plain; buttes break off on the way.
        const t = rimDown(c, 90, 2900, 1000, 2300)
        E = -80 + (E + 80) * (1 - t) ** 1.15
        // Outward the cliffs give way to benches and debris slopes (cliffs only face the gorge).
        TK *= 1 - 0.6 * sst(0.05, 0.55, t)
        E += w0(sst(0.08, 0.3, t) * sst(1, 0.65, t), () => 420 * sst(0.45, 0.72, warp(x / 900, z / 900, 94, 0.9)))
      }
      // (Always a cliff at the foot — the race's wall is there: a gully notches the rim, never the foot.)
      E = Math.max(E, 236 * sst(4, 18, d) * sst(70, 40, d))
      if (c.chan < 1e8) E = Math.min(E, -80 + Math.max(0, c.chan) * 3)
      let h = terrace(E, DESERT_LV, 0.92, 0.1, strata(x, z, c.cx, c.cz, DESERT_LV.length, 60, 20), 0.35)
      // Shallow drainages across the tops (a few metres to ~20, branching).
      h -= w0(sst(40, 200, d), () => 18 * (1 - Math.abs(fbmR(x / 700, z / 700, 3, 24))) ** 6)
      return h
    },
  },
  // A glacier: cave sections roofed in ice (the walls lean out under the roof), open ice gorge between.
  ice: {
    half: (u) => { const a = u * Math.PI * 2; return 780 + 340 * Math.sin(a * 5 + 0.7) + 120 * Math.sin(a * 11 + 1.7) },
    rim: 450, outer: 6800, reach: 6600, hk: 0.08, roof: 330,
    // Low passages (a ceiling just over the walls, flat), tall arched halls, wide flat-roofed chambers.
    vary: (u) => {
      const a = u * Math.PI * 2
      const big = 0.5 + 0.5 * Math.sin(a * 5 + 0.7), wob = 0.5 + 0.5 * Math.sin(a * 13 + 2.1)
      return { wall: 0.55 + 0.9 * big, rise: 20 + 380 * big * (0.6 + 0.4 * wob), flat: 0.5 + 0.5 * Math.sin(a * 7 + 1.3) }
    },
    near: [0, 10, 20, 30, 45, 70, 100, 140, 190, 230, 260, 280, 310],
    chanW: [200, 260],
    breachU: [0.07, 0.31, 0.58, 0.95],
    topY: 0.62,
    shape: (c) => {
      const { x, z, d } = c
      // The ice cap: higher toward the middle, swelling and sagging at every scale — no strata on it (flat
      // sheets of terrace there read as cardboard).
      const G = 430 + 95 * fbmR(x / 2600, z / 2600, 3, 31) + 45 * warp(x / 900, z / 900, 32, 0.7) + w0(14 * sst(500, 900, d), () => fbmR(x / 240, z / 240, 2, 42)) + (c.inner ? 0.035 * Math.min(d, 5000) : 0)
      const lam = 170 + 120 * va(c, 4000, 3, 33)
      let E = 110 + (G + 40) * (1 - Math.exp(-d / lam)) + sst(0, 80, d) * 60 * fbm(x / 900, z / 900, 2, 34)
      const gl = 1 - Math.abs(va(c, 520, d / 2000 + 3 + (c.inner ? 0 : 30), 35))
      E -= 380 * gl ** 8 * sst(20, 140, d) * sst(2000, 700, d)
      if (!c.inner) {
        // Outward the ice thins over its rim, then ends in a convex margin 100–300 m high spread over 1–2 km
        // — a glacier's snout, no wall.
        E *= 1 - (0.5 + 0.15 * fbmR(x / 3000, z / 3000, 2, 45)) * sst(500, 1600, d)
        const t = rimDown(c, 36, 1500, 500)
        E = -80 + (E + 80) * (1 - t * t)
      }
      E = Math.max(E, 125 * sst(4, 22, d) * sst(80, 50, d))
      let chanTK = 0
      // (A breach: a broad valley through the ice, its sides rolling — steep, they were the rim's cut ends.)
      if (c.chan < 1e8) { E = Math.min(E, -80 + Math.max(0, c.chan) * 0.55); chanTK = 0 }
      // Ice cliffs only by the gorge's walls; elsewhere the ice rolls (a breach's sides too: stepped, they
      // were cut ends of the rim, square, their undersides dark).
      TK = Math.max(1 - sst(450, 900, d), chanTK) * (c.chan < 600 ? sst(150, 600, c.chan) : 1)
      let h = TK === 0 || E <= ICE_LV[1] - 60 ? Math.max(ICE_LV[0], E) : terrace(E, ICE_LV, 0.92, 0.08, 25 * vn(x / 5000, z / 5000, 41) + 30 * fbmR(x / 700, z / 700, 2, 44), 0.3)
      if (c.roofS > 0 && d > ROOF_D - 40) {
        // Over the cave sections the glacier swells to the ice over the roof and falls away from it gently:
        // the cave is inside the glacier, not under a road laid across the gorge.
        // (Falling away faster past ~700 m: at an even slope the swell ran out km past the rim as flat plates.)
        const dd = Math.max(0, d - ROOF_D), dome = c.apex - 0.22 * dd - 0.5 * Math.max(0, dd - 700) - 10 + 25 * fbmR(x / 600, z / 600, 2, 46)
        h = Math.max(h, h + (dome - h) * c.roofS * sst(ROOF_D - 40, ROOF_D + 60, d))
      }
      if (c.roof > 0) {
        // Under the roof: the cave wall leaning out to the roof's edge, then up over the roof's ice into
        // the glacier.
        let w: number
        if (d <= ROOF_D) {
          const P = CAVE_WALL
          w = P[P.length - 1][1]
          for (let k = 0; k < P.length - 1; k++) if (d <= P[k + 1][0]) { const t = (d - P[k][0]) / (P[k + 1][0] - P[k][0]); w = P[k][1] + (P[k + 1][1] - P[k][1]) * t; break }
          if (w > 0) w *= c.edgeH / ROOF_H
        // (Past the roof's edge the glacier falls away from it — held at the roof's height all the way out, the
        //  cave sections' outer land stood as flat plates ending in walls.)
        } else w = Math.max(c.edgeH + ROOF_T * sst(ROOF_D, ROOF_D + 40, d) - 0.6 * Math.max(0, d - ROOF_D - 60), h)
        h = h + (w - h) * c.roof
      }
      return h
    },
  },
  // Basalt: sheer columnar cliffs in flows, lava pooled along both walls' feet (aCrev: its glow).
  lava: {
    half: (u) => { const a = u * Math.PI * 2; return 900 + 180 * Math.sin(a * 4 + 0.9) + 90 * Math.sin(a * 13 + 2.0) },
    rim: 700, outer: 8200, reach: 8000, hk: 0.12,
    near: [0, 6, 12, 18, 26, 36],
    chanW: [210, 300],
    breachU: [0.12, 0.37, 0.66, 0.9],
    // (Its flats: the flows' own rough dark surface — see main.ts.)
    topY: 0.45,
    shape: (c) => {
      const { x, z, d } = c
      // (The glow only on the foot's own narrow faces: across a 200 m face it read as a band of yellow paint.)
      if (d <= 12 && !(c.chan <= 0)) { c.crev = d <= 6 ? 1 : 0; return d <= 0 ? -6 : d <= 6 ? 2 : 8 }
      const A = (c.inner ? 700 : 600) + 90 * va(c, 8000, 1, 51)
      const lam = 230 + 120 * va(c, 5000, 2, 52)
      let E = 140 + A * (1 - Math.exp(-Math.max(0, d - 12) / lam)) + 80 * warp(x / 1500, z / 1500, 53, 0.6) * sst(12, 70, d) + w0(55 * sst(12, 70, d) * sst(900, 500, d), () => warp(x / 350, z / 350, 54, 0.8))
      const gl = 1 - Math.abs(va(c, 700, d / 2400 + 5 + (c.inner ? 0 : 50), 55))
      E -= 480 * gl ** 8 * sst(30, 180, d) * sst(2400, 800, d)
      let t = 0
      if (c.inner) {
        // The plateau: flow on flow, collapse pits with lava standing in them.
        // (Flows of their own shape across it: their fronts are the plateau's steps, wandering — not out in
        // the middle, where the grid is too coarse across the rays for them and they came out as spokes.)
        E += w0(sst(600, 3000, d), () => 70 + 110 * fbmR(x / 4000, z / 4000, 3, 56)) + w0(110 * sst(250, 800, d) * sst(4500, 2600, d), () => warp(x / 650, z / 650, 64, 0.9))
        // (Inside the grid's fine part: further in, its rows close on the middle and a pit's walls came out as
        // black slivers raying from it.)
        const pit = w0(sst(900, 1500, d) * sst(2350, 2000, d), () => sst(0.3, 0.6, warp(x / 1700, z / 1700, 57, 0.9)))
        E -= 760 * pit
        // (Lava only on a pit's floor: on its walls too, the pits read as yellow paint from the air.)
        if (pit > 0.8 && E < 150) c.crev = 1
      } else {
        // The rim, then down to the lava plain over lobe on lobe of the last flows — each front 5–20 m, never
        // one tall cliff — with tumuli (blisters of crust) on them.
        t = rimDown(c, 58, 2700, 1000, 2200)
        // (Running out onto the plain at a slant that eases off: ending at a slope, the dark flows met the
        // bright plain in one hard line.)
        E = -10 + (E + 10) * (1 - t) ** 2
        E += w0(sst(0, 0.15, t) * sst(1, 0.8, t), () => 70 * warp(x / 650, z / 650, 59, 0.9) + 22 * Math.max(0, vn(x / 160, z / 160, 60)) ** 2)
      }
      E = Math.max(E, 200 * sst(12, 22, d) * sst(70, 40, d))
      if (c.chan < 1e8) E = Math.min(E, -80 + Math.max(0, c.chan) * 3)
      // (A breach's sides one sheer face: stepped, their ledges came out as slivers of ash up the black.)
      if (c.chan < 400) TK = Math.min(TK, 0.15 + 0.85 * sst(150, 400, c.chan))
      // (Away from the gorge the risers widen: knife-thin, they fell between the grid's lines and were drawn
      // along them — straight slabs, long black wedges of shadow.) Benches 1–4, coming and going.
      const big = E <= LAVA_LV[1] - 60 ? Math.max(LAVA_LV[0], E + (LAVA_LV[0] + (E - LAVA_LV[0]) * 0.06 - E) * TK)
        : terrace(E, LAVA_LV, 0.94 - 0.14 * sst(250, 900, d), 0.06, strata(x, z, c.cx, c.cz, LAVA_LV.length, 95, 65), 0.3)
      const fine = sst(0, 0.12, t)
      return fine > 0 ? big + (Math.max(-6, fronts(E, 9 + 9 * (0.5 + 0.5 * vn(x / 1200, z / 1200, 66)))) - big) * fine : big
    },
  },
  // A river valley: the river down a deep V widening to a U, bluffs of granite at the water, forested slopes
  // up to the shoulders; inside the loop a higher wooded upland; outside a range of ridges and side valleys
  // falling to the surrounding land. (aCrev 0: grey rock — and green wherever it is gentle.)
  forest: {
    half: (u) => { const a = u * Math.PI * 2; return 700 + 140 * Math.sin(a * 3 + 2.2) + 70 * Math.sin(a * 8 + 0.3) },
    rim: 270, outer: 6900, reach: 6700, hk: 0.15,
    near: [0, 10, 20, 32, 46, 62, 80],
    chanW: [150, 230],
    breachU: [0.16, 0.42, 0.69, 0.92],
    shape: (c) => {
      const { x, z, d } = c
      // Bluffs at the water, 20–80 m (high at the bends, broken into outcrops), then the valley side: steep
      // near the river, easing toward the shoulders 80–250 m above it.
      const Bb = 22 + 55 * sst(-0.2, 0.7, va(c, 1700, 1, 71)) + 18 * fbmR(x / 220, z / 220, 2, 72)
      const bw = 28 + 30 * (0.5 + 0.5 * va(c, 900, 3, 73))
      const S = 140 + 120 * (0.5 + 0.5 * va(c, 4200, 5, 74)) + 40 * fbmR(x / 1500, z / 1500, 2, 75)
      const Ws = 240 + 260 * (0.5 + 0.5 * fbmR(x / 2500, z / 2500, 2, 76))
      const u = Math.min(1, Math.max(0, (d - bw) / Ws))
      let h = Bb * Math.pow(sst(0, bw, d), 0.5) + Math.max(0, S - Bb) * (1 - (1 - u) ** 2.4)
      // Beyond the shoulders: inside, an upland higher than the outer bank in places; outside, ridges with
      // spurs and side valleys running out (long in the way they run), falling over 2–3 km to the land around.
      const hills = 70 * fbmR(x / 2800, z / 2800, 3, 77) + 45 * fbmR(x / 800, z / 800, 2, 78)
      if (c.inner) h += sst(0, 1, (d - bw - Ws) / 900) * (90 + 160 * sst(1200, 5000, d) + hills + 60 * (0.5 + 0.5 * fbmR(x / 4000, z / 4000, 2, 79)))
      else {
        const rid = 1 - Math.abs(warp(x / 1700, z / 1700, 80, 0.9)), t = rimDown(c, 81, 2200, 900)
        h += sst(0, 1, (d - bw - Ws) / 700) * (170 * rid ** 3 - 60 + hills)
        h = -4 + (h + 4) * (1 - t) ** 1.4 * (0.75 + 0.25 * rid * (1 - t))
      }
      if (c.chan < 1e8) {
        // A side valley: wooded slopes down to a stream bed; cut sheer where it meets the gorge's granite.
        const k = 0.6 + 2.5 * sst(bw + 200, 0, d)
        h = Math.min(h, -4 + Math.max(0, c.chan) * k)
      }
      return Math.max(-4, h)
    },
  },
}

/** A growing float buffer (the land is ~100k triangles: a JS array of every float was a third of the build). */
class Buf {
  a = new Float32Array(1 << 16)
  n = 0
  private room(k: number): void { if (this.n + k > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b } }
  push(x: number): void { this.room(1); this.a[this.n++] = x }
  push3(x: number, y: number, z: number): void { this.room(3); const a = this.a, n = this.n; a[n] = x; a[n + 1] = y; a[n + 2] = z; this.n = n + 3 }
  out(): Float32Array { return this.a.slice(0, this.n) }
}

/** The virtual rock behind each wall (m): big enough that its curve is the wall's line over a pass. */
const BIG = 20000
/** Beside the floor (m out from the foot) the wall is the race's own (see wallsNear). */
const BAND = 150
/** Land rows per row of the race's wall grid (every ~200 m → ~100 m). */
const SUB = 2
/** The inner columns are metric to this far out from the foot, then share out what is left to the middle. */
const D0 = 2400
/** The water's clock (main.ts advances it). */
export const WATER_T = { value: 0 }

/** One side's grid. */
interface Side {
  inner: boolean
  /** Feet (one per row), their distance from the middle, and their angle about it (unwrapped). */
  fx: Float64Array
  fz: Float64Array
  lam: Float64Array
  ang: Float64Array
  /** Columns: metres out (outer: every row alike); inner: those, then fractions of what is left. */
  col: number[]
  frac: number[]
  /** Inner: the shortest foot-to-middle less D0 (the rings near the middle sit within it). */
  rmin: number
  /** Heights (absolute y) and aCrev, rows × columns. */
  y: Float32Array
  cv: Float32Array
  /** 1 where the land is down at its foot (under the ground: a triangle all of these is not drawn). */
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
  /** The breaches: the race's row at the mouth, its side (+1/−1), and the mouth on the floor's edge;
   *  axis: [x, z, metres out] every 100 m. */
  readonly breaches: { row: number; side: number; u: number; x: number; z: number; axis: number[]; box: number[] }[] = []
  /** Per row of the race's grid: is the wall beside the floor open (a breach) on side +1 / −1? */
  private readonly openP: Uint8Array
  private readonly openN: Uint8Array
  private readonly sides: Side[] = []
  private readonly N: number
  /** Farthest the land reaches from the middle (m). */
  private reach = 0
  private last = 0
  private qlast = 0

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
    this.shapeLand()
  }

  /** BLUE HOLLOW's cave sections (u): about half the loop under ice, the rest an open gorge — the start
   *  out in the light. Each end is a mouth. */
  private static roofed(u: number): number {
    for (const [a, b] of [[0.12, 0.27], [0.36, 0.53], [0.66, 0.79], [0.83, 0.9]]) if (u >= a && u <= b) return 1
    return 0
  }

  // ── the land ──

  private shapeLand(): void {
    const st = this.st, N = this.N, m = this.m
    // Feet every land row, from the loop itself (the race's rows are every SUB-th).
    const lx = new Float64Array(N), lz = new Float64Array(N), ltx = new Float64Array(N), ltz = new Float64Array(N), lh = new Float64Array(N)
    for (let r = 0; r < N; r++) {
      const u = r / N
      const [x, z] = this.loop(u), [x2, z2] = this.loop(u + 0.5 / m), [x0, z0] = this.loop(u - 0.5 / m)
      const dl = Math.hypot(x2 - x0, z2 - z0) || 1
      lx[r] = x; lz[r] = z; ltx[r] = (x2 - x0) / dl; ltz[r] = (z2 - z0) / dl; lh[r] = st.half(u)
    }
    // Which side is the inside (nearer the middle)?
    const dIn = (sg: number) => Math.hypot(lx[0] + ltz[0] * sg * lh[0] - this.cx, lz[0] - ltx[0] * sg * lh[0] - this.cz)
    const sgIn = dIn(1) < dIn(-1) ? 1 : -1
    // Breaches: outward, from the floor's edge to past the land's end, wandering a little.
    for (const bu of st.breachU) {
      const r = Math.round(bu * N) % N, sg = -sgIn
      const fx = lx[r] + ltz[r] * sg * lh[r], fz = lz[r] - ltx[r] * sg * lh[r]
      const ox = fx - this.cx, oz = fz - this.cz, ol = Math.hypot(ox, oz), dx = ox / ol, dz = oz / ol
      const axis: number[] = [], ph = bu * 40, box = [Infinity, Infinity, -Infinity, -Infinity]
      for (let d = -300; d <= st.outer + 600; d += 100) {
        const w = 320 * Math.sin(d / 900 + ph) * sst(0, 900, d)
        const x = fx + dx * d - dz * w, z = fz + dz * d + dx * w
        axis.push(x, z, d)
        box[0] = Math.min(box[0], x - 1700); box[1] = Math.min(box[1], z - 1700); box[2] = Math.max(box[2], x + 1700); box[3] = Math.max(box[3], z + 1700)
      }
      this.breaches.push({ row: Math.round(bu * m) % m, side: sg, u: bu, x: fx, z: fz, axis, box })
    }
    const c: Ctx = { inner: false, d: 0, x: 0, z: 0, s: 0, L: this.L, roof: 0, edgeH: 0, apex: 0, roofS: 0, chan: Infinity, crev: 0, ich: Infinity, ichE: 0, cx: this.cx, cz: this.cz, lim: st.reach - 300 }
    // CANYON RUN's island: three canyons from the gorge meeting near the middle (with branches), cutting the
    // massif into mesas — its drainage running down to the gorge, hanging over it at the first bench.
    const isl: { p: number[]; w: number; box: number[] }[] = []
    if (this.style === 'desert') {
      let sd = 5309
      const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296 }
      const jx = this.cx + 900, jz = this.cz - 600
      const line = (x0: number, z0: number, x1: number, z1: number, e0: number, e1: number, amp: number, w: number) => {
        const L = Math.hypot(x1 - x0, z1 - z0), nx = (z1 - z0) / L, nz = -(x1 - x0) / L, ph = rnd() * 6, p: number[] = [], box = [Infinity, Infinity, -Infinity, -Infinity]
        for (let q = 0; q <= Math.ceil(L / 150); q++) {
          const f = q / Math.ceil(L / 150), wv = amp * Math.sin(f * Math.PI * 3 + ph) * Math.sin(f * Math.PI)
          const x = x0 + (x1 - x0) * f + nx * wv, z = z0 + (z1 - z0) * f + nz * wv
          p.push(x, z, e0 + (e1 - e0) * f)
          box[0] = Math.min(box[0], x - 900); box[1] = Math.min(box[1], z - 900); box[2] = Math.max(box[2], x + 900); box[3] = Math.max(box[3], z + 900)
        }
        isl.push({ p, w, box })
        return p
      }
      for (const u of [0.05, 0.38, 0.71]) {
        const r = Math.round(u * N) % N
        const fx = lx[r] + ltz[r] * sgIn * (lh[r] - 120), fz = lz[r] - ltx[r] * sgIn * (lh[r] - 120)
        const p = line(fx, fz, jx, jz, 240, 640, 450, 170)
        for (const f of [0.4, 0.68]) {
          const q = Math.floor((p.length / 3 - 1) * f) * 3, a = Math.atan2(jx - fx, jz - fz) + (rnd() < 0.5 ? -1 : 1) * (0.7 + 0.4 * rnd()), Lb = 1500 + 900 * rnd()
          line(p[q], p[q + 1], p[q] + Math.sin(a) * Lb, p[q + 1] + Math.cos(a) * Lb, p[q + 2], p[q + 2] + 300, 200, 90)
        }
      }
    }
    const island = (x: number, z: number) => {
      let bestE = Infinity
      c.ich = Infinity
      for (const L of isl) {
        const B = L.box, P = L.p
        if (x < B[0] || z < B[1] || x > B[2] || z > B[3]) continue
        for (let j = 0; j + 3 < P.length; j += 3) {
          const ax = P[j], az = P[j + 1], ex = P[j + 3] - ax, ez = P[j + 4] - az, l2 = ex * ex + ez * ez
          const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2))
          const dd = Math.hypot(x - ax - ex * t, z - az - ez * t) - L.w, e = P[j + 2] + (P[j + 5] - P[j + 2]) * t
          const E = e + Math.max(0, dd) * 2.4
          if (E < bestE) { bestE = E; c.ich = dd; c.ichE = e }
        }
      }
    }
    const roofS = new Float64Array(m)
    for (let i = 0; i < m; i++) { let a = 0; for (let q = -4; q <= 4; q++) a += this.roofK[(i + q + m) % m]; roofS[i] = a / 9 }
    for (const sg of [sgIn, -sgIn]) {
      const inner = sg === sgIn
      const fx = new Float64Array(N), fz = new Float64Array(N), lam = new Float64Array(N), ang = new Float64Array(N)
      for (let r = 0; r < N; r++) {
        fx[r] = lx[r] + ltz[r] * sg * lh[r]; fz[r] = lz[r] - ltx[r] * sg * lh[r]
        lam[r] = Math.hypot(fx[r] - this.cx, fz[r] - this.cz)
        const a = Math.atan2(fx[r] - this.cx, fz[r] - this.cz)
        ang[r] = r === 0 ? a : ang[r - 1] + Math.atan2(Math.sin(a - ang[r - 1]), Math.cos(a - ang[r - 1]))
      }
      // Columns: the near ones as given, then wider and wider (to the land's end, or toward the middle).
      const col = st.near.slice()
      const end = inner ? D0 : st.outer
      // (Never wider than 45 m outside out to 2.6 km, where the rim's cliffs and benches are — coarser, its
      // stepped cliffs read as pyramids — then 95 m down its long outer slopes; 110 m inside, out to the
      // massif. WHITEWATER's hills are smooth: wider will do.)
      const cap = (d: number) => this.style === 'forest' ? (inner ? 200 : 120) : inner ? 110 : d < 2600 ? 45 : 95
      while (col[col.length - 1] < end - 1) { const d = col[col.length - 1]; col.push(Math.min(end, d + Math.min(cap(d), 12 + 0.09 * d))) }
      const frac: number[] = []
      if (inner) for (let k = 1; k <= 20; k++) frac.push((k / 20) ** 1.25)
      const K = col.length + frac.length
      const y = new Float32Array(N * K), cv = new Float32Array(N * K)
      let rmin = Infinity
      for (let r = 0; r < N; r++) rmin = Math.min(rmin, lam[r] - D0)
      const low = new Uint8Array(N * K)
      const rel = new Float32Array(N * K)
      const S: Side = { inner, fx, fz, lam, ang, col, frac, rmin, y, cv, low, rel, K }
      for (let r = 0; r < N; r++) {
        const i = Math.floor(r / SUB)
        const ox = (fx[r] - this.cx) / lam[r], oz = (fz[r] - this.cz) / lam[r], dir = inner ? -1 : 1
        c.inner = inner; c.s = (r / N) * this.L
        // (The roof and the walls under it: by the race's row, as the roof mesh is.)
        c.roof = this.roofK[i]
        c.edgeH = st.roof ? ROOF_H * this.wallH(i, sg) : 0
        c.apex = st.roof ? this.roofLift(i, 0.5) + ROOF_T : 0
        c.roofS = roofS[i]
        for (let k = 0; k < K; k++) {
          const d = this.colD(S, r, k)
          // (Past where the land can reach at all, the row is ground: asking the noise for it was most of the
          // build. Not sooner: a few columns down at the foot is not the land's end — the rim rises again.)
          // (Deep under: never drawn, and the ground is above it wherever it is asked — no need to ask the
          // ground's own height there, which was most of what was left.)
          if (!inner && d > st.reach) { y[r * K + k] = -1e4; cv[r * K + k] = 0; low[r * K + k] = 1; rel[r * K + k] = -1e4; continue }
          c.d = d; c.x = fx[r] + ox * dir * d; c.z = fz[r] + oz * dir * d; c.crev = 0
          c.chan = inner ? Infinity : this.chanAt(c.x, c.z)
          // (A breach's sides broken at a few hundred metres: drawn true to the axis they were huge flat facets.)
          if (c.chan < 800) c.chan += 70 * warp(c.x / 320, c.z / 320, 99, 0.8) + 28 * fbmR(c.x / 110, c.z / 110, 2, 98)
          if (inner && isl.length) island(c.x, c.z); else c.ich = Infinity
          TK = inner ? 1 - sst(1800, 2400, d) : 1
          let h = st.shape(c)
          // (The foot exactly on the floor's edge, where the race's wall is — see wallsNear.)
          const foot = this.style === 'forest' || this.style === 'ice' ? -4 : -6
          if (k === 0) h = foot
          // (Down to the ground before the grid ends: land still standing at its last column ended in a
          //  straight slab.)
          if (!inner) h = foot + (h - foot) * sst(st.outer, st.outer - 450, d)
          low[r * K + k] = h <= foot + 0.01 && k > 0 ? 1 : 0
          y[r * K + k] = groundH(c.x, c.z) + h
          rel[r * K + k] = h
          cv[r * K + k] = c.crev + (this.style === 'ice' && c.roof > 0 && d <= ROOF_D ? 0.15 * (1 - d / ROOF_D) : 0)
        }
      }
      this.sides.push(S)
      if (!inner) for (let r = 0; r < N; r++) this.reach = Math.max(this.reach, lam[r] + st.outer + 200)
      // The race's wall is open where a breach meets the floor: one of the row's land rows still low all the
      // way across the band beside the floor (past the foot's own first rise).
      const open = sg > 0 ? this.openP : this.openN
      for (let i = 0; i < m; i++) {
        let low = false
        for (let q = -1; q <= SUB; q++) {
          const r = (i * SUB + q + N) % N
          let hi = -Infinity
          for (let k = 1; k < K && col[k] <= BAND; k++) if (col[k] >= 40) hi = Math.max(hi, y[r * K + k] - groundH(fx[r], fz[r]))
          if (hi < 40) low = true
        }
        if (low) open[i] = 1
      }
    }
  }

  /** The cave walls' height scale at a race row (BLUE HOLLOW's walls wander). */
  private wallH(i: number, side: number): number {
    const st = this.st
    return (1 - st.hk + st.hk * Math.sin(i * 0.09 * side + 1.3) + st.hk * 0.5 * Math.sin(i * 0.37 + side)) * this.wallK[i]
  }

  /** Column k's distance out from row r's foot. */
  private colD(S: Side, r: number, k: number): number {
    if (k < S.col.length) return S.col[k]
    // Toward the middle, rings at the same distance from it on every row (fractions of each row's own
    // length left the triangles there skewed, and their edges radiated from the middle).
    const f = S.frac[k - S.col.length], w = f * f
    const rho = (S.lam[r] - D0) * (1 - f) * (1 - w) + S.rmin * (1 - f) * w
    return S.lam[r] - rho
  }

  /** Out from the nearest breach's floor edge (m): ≤ 0 on it; Infinity if none is near. */
  private chanAt(x: number, z: number): number {
    let best = Infinity
    const [w0, w1] = this.st.chanW
    for (const b of this.breaches) {
      const A = b.axis, B = b.box
      if (x < B[0] || z < B[1] || x > B[2] || z > B[3]) continue
      for (let j = 0; j + 3 < A.length; j += 3) {
        const ax = A[j], az = A[j + 1], ex = A[j + 3] - ax, ez = A[j + 4] - az, l2 = ex * ex + ez * ez
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2))
        const dx = x - ax - ex * t, dz = z - az - ez * t, dd = dx * dx + dz * dz
        if (dd > 2.5e6) continue
        const along = A[j + 2] + (A[j + 5] - A[j + 2]) * t
        // Wider at the mouth (a fan opening onto the floor), then a canyon's own width.
        const v = Math.sqrt(dd) - (w0 + w1 * Math.exp(-Math.max(0, along) / 380))
        if (v < best) best = v
      }
    }
    return best
  }

  // ── asking the land ──

  /** The land row of side S at angle th about the middle: row r, the fraction f on to r + 1, and the
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
    const K = S.K, nc = S.col.length
    let k: number, t: number
    if (!S.inner || s < S.col[nc - 1]) {
      let lo = 0, hi = nc - 1
      if (s >= S.col[hi]) return S.y[r * K + hi]
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S.col[mid] <= s) lo = mid; else hi = mid }
      k = lo; t = (s - S.col[lo]) / (S.col[hi] - S.col[lo])
    } else {
      let j = nc, d1 = this.colD(S, r, j)
      while (j < K - 1 && d1 < s) { j++; d1 = this.colD(S, r, j) }
      const d0 = this.colD(S, r, j - 1)
      k = j - 1; t = Math.max(0, Math.min(1, (s - d0) / Math.max(1e-6, d1 - d0)))
    }
    const a = S.y[r * K + k], b = S.y[r * K + k + 1]
    return a + (b - a) * t
  }

  /** The land's height (absolute y) at (x, z), as drawn; −Infinity on the floor or off the land. */
  heightAt(x: number, z: number): number {
    const qx = x - this.cx, qz = z - this.cz, rho = Math.hypot(qx, qz), th = Math.atan2(qx, qz)
    for (const S of this.sides) {
      const q = this.rowAt(S, th)
      const s = S.inner ? q.lam - rho : rho - q.lam
      if (s < 0) continue
      if (!S.inner && s > this.st.outer) return -Infinity
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
  /** In the gorge or on its land (r: a landform's radius): nothing else stands there. Past the land's
   *  broken edge the world's own landforms stand — its buttes and outliers. */
  covers(x: number, z: number, r: number): boolean {
    // (By the middle's angle, not a search of the line: populate asks this of every landform it places.)
    const rho = Math.hypot(x - this.cx, z - this.cz)
    if (rho > this.reach + r) return false
    const th = Math.atan2(x - this.cx, z - this.cz)
    // Inside the loop, the floor, and the outer rim's first ~900 m: always.
    if (rho < this.rowAt(this.sides[1], th).lam + 900 + r) return true
    // (Nor in a breach: the world's mesas stood in them, out on the plain, and blocked the way in.)
    if (this.chanAt(x, z) < r + 500) return true
    return this.topNear(x, z, r + 150) > groundH(x, z) + 2
  }

  // ── drawing ──

  /** The land (and the roof, the lamps, the water) as one group. `topMat`: the gentlest faces' own. */
  build(mat: THREE.Material, extra: { roofMat?: THREE.Material; topMat?: THREE.Material; roofTopMat?: THREE.Material; cliffMat?: THREE.Material } = {}): THREE.Group {
    const g = new THREE.Group()
    // A few chunks round the loop, both sides in each, each culled on its own: smaller ones culled better,
    // but every chunk is a draw call in every pass (at ~4 km chunks the frame's calls rose by half).
    const topMat = this.st.topY ? extra.topMat ?? null : null, cliffMat = topMat ? extra.cliffMat ?? null : null
    const blocks = Array.from({ length: 4 }, () => ({ pos: new Buf(), crev: new Buf(), top: new Buf(), topC: new Buf(), topN: new Buf(), topR: new Buf(), cliff: new Buf(), cliffC: new Buf() }))
    for (const S of this.sides) this.landTris(S, topMat !== null, cliffMat !== null, blocks)
    // (Drawn before the ground: from the air the land covers much of the screen, and the ground's costly
    // shading under it is then rejected by depth instead of shaded and painted over.)
    const add = (m: THREE.Mesh) => { m.renderOrder = -1; g.add(m) }
    for (const B of blocks) {
      if (B.pos.n) add(this.mesh(B.pos.out(), B.crev.out(), mat))
      if (B.cliff.n) add(this.mesh(B.cliff.out(), B.cliffC.out(), cliffMat!))
      if (B.top.n) {
        const pos = B.top.out(), rel = B.topR.out(), m = this.mesh(pos, B.topC.out(), topMat!, B.topN.out())
        if (this.style === 'lava') {
          // MAGMA's flats: the flows' own rough dark crust, rusty where it has oxidised (a tan ash draped on
          // the basalt read as another material).
          const col = new Float32Array(pos.length)
          for (let i = 0; i < pos.length; i += 3) {
            const x = pos[i], z = pos[i + 2], ox = sst(0.15, 0.6, fbmR(x / 520, z / 520, 2, 141)), v = 0.85 + 0.3 * vn(x / 60, z / 60, 142)
            // (Paler toward the plain at the flows' feet: a dark crust ending on the bright plain was a hard rim.)
            const pl = sst(70, 4, rel[i / 3])
            col[i] = (0.3 + 0.24 * ox) * v * (1 - pl) + 0.5 * pl; col[i + 1] = (0.25 + 0.02 * ox) * v * (1 - pl) + 0.3 * pl; col[i + 2] = (0.22 - 0.08 * ox) * v * (1 - pl) + 0.2 * pl
          }
          m.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3))
        }
        add(m)
      }
    }
    if (this.st.roof) {
      this.roofMeshes(extra.roofMat ?? mat, extra.roofTopMat ?? extra.topMat ?? mat, mat, g)
      g.add(this.lamps())
      g.add(this.icicles())
      g.add(this.crevasses())
    }
    if (this.style === 'forest') { g.add(this.water()); g.add(this.treeLine()) }
    return g
  }

  /** One side's grid as triangles, into the chunks round the loop. `split`: the gentlest faces apart, with
   *  normals shared between them (smooth ground; crisp only where it is a cliff). `cliffs`: the steep faces
   *  outside the cave apart too (BLUE HOLLOW's glacier cliffs, in their own ice). */
  private landTris(S: Side, split: boolean, cliffs: boolean, blocks: { pos: Buf; crev: Buf; top: Buf; topC: Buf; topN: Buf; topR: Buf; cliff: Buf; cliffC: Buf }[]): void {
    const N = this.N, K = S.K, RB = Math.ceil(N / blocks.length)
    const dir = S.inner ? -1 : 1
    const vx = new Float32Array(N * K), vz = new Float32Array(N * K)
    for (let r = 0; r < N; r++) {
      const ox = (S.fx[r] - this.cx) / S.lam[r], oz = (S.fz[r] - this.cz) / S.lam[r]
      for (let k = 0; k < K; k++) { const d = this.colD(S, r, k); vx[r * K + k] = S.fx[r] + ox * dir * d; vz[r * K + k] = S.fz[r] + oz * dir * d }
    }
    // Winding: facing up in plan, whichever way the rows run.
    const flip = (vx[K] - vx[0]) * (vz[1] - vz[0]) - (vz[K] - vz[0]) * (vx[1] - vx[0]) > 0
    const Y = S.y, topY = this.st.topY ?? 0.6
    // Each face: 0 wall, 1 gentle (top), 2 cliff outside the cave; and the gentle faces' normals summed
    // at each grid vertex (area-weighted).
    const vn3 = split ? new Float32Array(N * K * 3) : null
    const kind = (q0: number, q1: number, q2: number, acc: boolean): number => {
      if (!split) return 0
      const ux = vx[q1] - vx[q0], uy = Y[q1] - Y[q0], uz = vz[q1] - vz[q0], wx = vx[q2] - vx[q0], wy = Y[q2] - Y[q0], wz = vz[q2] - vz[q0]
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz }
      // (Never the cave's own walls under the roof: they are the ice the lamps light.)
      const cave = S.cv[q0] > 0 || S.cv[q1] > 0 || S.cv[q2] > 0
      if (cave) return 0
      // (A steep face only a few metres tall is not a cliff: on the gentle ice they were stray blue shards.)
      const ext = Math.max(Y[q0], Y[q1], Y[q2]) - Math.min(Y[q0], Y[q1], Y[q2])
      if (ny / Math.hypot(nx, ny, nz) > topY || ext < 22) {
        if (acc) for (const q of [q0, q1, q2]) { vn3![q * 3] += nx; vn3![q * 3 + 1] += ny; vn3![q * 3 + 2] += nz }
        return 1
      }
      return cliffs ? 2 : 0
    }
    const quads = (f: (a: number, b: number, c: number, r: number) => void) => {
      for (let r = 0; r < N; r++) {
        const r2 = (r + 1) % N
        for (let k = 0; k < K - 1; k++) {
          const a = r * K + k, b = r2 * K + k, c = r * K + k + 1, d = r2 * K + k + 1
          if (flip) { f(a, c, b, r); f(b, c, d, r) } else { f(a, b, c, r); f(b, d, c, r) }
        }
      }
    }
    const kinds = new Uint8Array(N * (K - 1) * 2)
    let ti = 0
    if (split) quads((a, b, c) => { kinds[ti++] = kind(a, b, c, true) })
    // (Every row meets at the middle, each with its own corner there: one shared normal for them all, or the
    // middle shone as a starburst.)
    if (split && S.inner) {
      let ax = 0, ay = 0, az = 0
      for (let r = 0; r < N; r++) { const q = (r * K + K - 1) * 3; ax += vn3![q]; ay += vn3![q + 1]; az += vn3![q + 2] }
      for (let r = 0; r < N; r++) { const q = (r * K + K - 1) * 3; vn3![q] = ax; vn3![q + 1] = ay; vn3![q + 2] = az }
    }
    ti = 0
    quads((q0, q1, q2, r) => {
      const B = blocks[Math.floor(r / RB)]
      const kd = kinds[ti++]
      // (Ground under the ground: never seen — beyond the land's edge, most of the outer grid.)
      if (S.low[q0] && S.low[q1] && S.low[q2]) return
      const o = kd === 1 ? B.top : kd === 2 ? B.cliff : B.pos, oc = kd === 1 ? B.topC : kd === 2 ? B.cliffC : B.crev
      o.push3(vx[q0], Y[q0], vz[q0]); o.push3(vx[q1], Y[q1], vz[q1]); o.push3(vx[q2], Y[q2], vz[q2])
      oc.push(S.cv[q0]); oc.push(S.cv[q1]); oc.push(S.cv[q2])
      if (kd === 1) for (const q of [q0, q1, q2]) {
        const x = vn3![q * 3], y = vn3![q * 3 + 1], z = vn3![q * 3 + 2], l = Math.hypot(x, y, z) || 1
        B.topN.push3(x / l, y / l, z / l)
        B.topR.push(S.rel[q])
      }
    })
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
    const m = this.m, A = 13
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
      const W = L(this.half) + ROOF_D + 6, across = (t * 2 - 1) * W
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
      }
      out.push(cx + tz * across, y, cz - tx * across)
    }
    const hh = (n: number) => { const v = Math.sin(n * 12.9898) * 43758.5453; return v - Math.floor(v) }
    // (Every section's ceiling in one mesh, every top in one, every mouth in one: a draw call each.)
    const ceil: number[] = [], top: number[] = [], mouth: number[] = [], ends: number[] = []
    for (const [i0, i1] of segs) {
      // The mouths are ragged: each column's ice ends at its own place (up to most of a row back), and
      // hangs below the ceiling there in a lip of its own depth — broken ice, not a sawn edge.
      const R = (j: number, k: number) => j === 0 ? i0 + 0.85 * hh(i0 * 31 + k) : j === i1 - i0 ? i1 - 0.85 * hh(i1 * 17 + k) : i0 + j
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
      for (const side of [1, -1]) {
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
    const ic = new THREE.InstancedMesh(new THREE.ConeGeometry(4, 1, 5).rotateX(Math.PI).translate(0, -0.5, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.62, 0.95) }), n)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3()
    let c = 0
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / per), hh = Math.sin(i * 12.9898) * 43758.5453, f = hh - Math.floor(hh)
      if (this.roofK[r] <= 0) continue
      const W = this.half[r] + ROOF_D, across = (f * 2 - 1) * this.half[r] * 0.8, t = across / W * 0.5 + 0.5
      // (Into the roof, so they hang from it: they floated just below before.)
      const y = groundH(this.rx[r], this.rz[r]) + this.roofLift(r, t) + 8
      v.set(this.rx[r] + this.tz[r] * across, y, this.rz[r] - this.tx[r] * across)
      const w = 3 + 4 * ((f * 3.1) % 1)
      s.set(w, 40 + 110 * ((f * 7.3) % 1) ** 2, w)
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
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: WATER_T },
      side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; varying vec3 vW;
        void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vW;
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
          gl_FragColor = vec4(c, 1.0); // (opaque: the worn track's orange smear showed through)
        }`,
    })
    const w = new THREE.Mesh(geo, mat)
    w.frustumCulled = false
    w.renderOrder = 1
    return w
  }
}
