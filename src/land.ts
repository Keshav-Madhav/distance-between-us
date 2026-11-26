// The gorge courses' land, as ground: one world-space height tile per gorge (relative to the world's own
// ground), added to groundH everywhere it is asked — the terrain mesh draws it, the craft rides it, the
// scatter stands on it, and the land blends into the world at its edges because it IS the world's ground.
//
// Built in world space, never along the loop (a strip round the loop and rays from its middle made rings,
// radial ribs and the same cross-section all the way round, however much noise went on top):
//   a landmass (how far it reaches by warped noise: lobes and bays, near on one side and far out on
//   another), cut by the gorge (by distance to the race line, down to the floor), by a branching network
//   of side canyons that meander and join — a few reaching the plain at floor level, the ways in — then
//   each world's own surface (desert strata with flat caprock; basalt benches and flow fronts; a glacier;
//   a river valley in wooded hills), a little erosion, and talus at the cliffs' feet.
// Pure maths, no three.js: src/landjob.ts runs it in workers at boot; the walls' own mesh (src/canyon.ts)
// asks the same functions at its finer spacing.

export type LandStyle = 'desert' | 'ice' | 'lava' | 'forest'

export interface LandLoop {
  /** Race-line rows (every ~200 m): position, unit tangent, floor half-width. */
  rx: Float64Array
  rz: Float64Array
  tx: Float64Array
  tz: Float64Array
  half: Float64Array
  /** The loop's middle and which side of the line is the inside (+1/−1, the race's lateral sign). */
  cx: number
  cz: number
  sgIn: number
  /** BLUE HOLLOW: per row, the ice over the cave's roof (m above the floor; 0 where the gorge is open),
   *  smoothed along the loop — the glacier's surface runs over it. */
  roofTop: Float64Array
}

export interface LandSpec { style: LandStyle; x0: number; z0: number; step: number; nx: number; nz: number; wallTo: number }

export interface LandOpen { row: number; side: number; x: number; z: number; axis: number[] }
export interface LandTile extends LandSpec {
  /** Height above the world's own ground (m), nx × nz, row-major in z. 0 on the race floor exactly. */
  h: Float32Array
  /** The side canyons' carve (floor + walls, m; 1e5 none near), for the walls' mesh. */
  c: Float32Array
  /** The ways in: the race rows (and side) where a side canyon opens the wall at floor level. */
  open: LandOpen[]
}

// ── noise ──
function hash(ix: number, iz: number, sd: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(sd, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
/** −1…1, smooth. */
export function vn(x: number, z: number, sd: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz)
  const a = hash(ix, iz, sd), b = hash(ix + 1, iz, sd), c = hash(ix, iz + 1, sd), d = hash(ix + 1, iz + 1, sd)
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1
}
const RC = Math.cos(0.61), RS = Math.sin(0.61)
/** fbm with each octave turned (value noise's lattice shows: thresholds on it drew square shapes). */
export function fbmR(x: number, z: number, oct: number, sd: number): number {
  let s = 0, a = 1, n = 0
  for (let o = 0; o < oct; o++) {
    const rx = x * RC - z * RS, rz = x * RS + z * RC
    s += a * vn(rx, rz, sd + o * 17); n += a; a *= 0.5; x = rx * 2.03 + 1.7; z = rz * 2.03 - 3.1
  }
  return s / n
}
/** Domain-warped fbmR: lobed, wandering shapes — never blobs on a lattice. */
export function warp(x: number, z: number, sd: number, k: number, oct = 3): number {
  const wx = vn(x * 0.6 + 3.1, z * 0.6 - 1.7, sd + 101), wz = vn(x * 0.6 - 4.3, z * 0.6 + 2.9, sd + 202)
  return fbmR(x + k * wx, z + k * wz, oct, sd)
}
export const sst = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** The tile's spacing (m): the ground's middle ring draws a vertex every 60 m on a 60 m lattice — the same
 *  lattice, so it samples the tile's own points (a 64 m tile under a 60 m mesh beat into a 960 m ripple). */
export const LAND_STEP = 60
/** No land within this of the floor's edge (m): every tile cell touching the floor is exactly 0, so the race
 *  — on the floor, on groundH — is bit-for-bit the race it was. The walls there are their own mesh. */
export const LAND_ZERO = 100
/** Out to here from the floor's edge (m) the walls are their own mesh (crisp for the race). */
export const WALL_TO = 360

// ── each world's land ──

/** Strata: E stepped into levels (cliff at each band's top, a ledge below it, a talus apron at the foot);
 *  level j lifted by lift(j) — the beds swell across the land, so benches come and go and pinch out. */
export function terrace(E: number, L: readonly number[], a: number, g: number, lift: (j: number) => number, tal: number): number {
  if (E <= L[0]) return L[0]
  let lo = L[0]
  for (let j = 0; j < L.length - 1; j++) {
    const hi = L[j + 1] + lift(j + 1)
    if (hi <= lo + 4) continue
    if (E < hi) {
      const D = hi - lo, f = (E - lo) / D, ta = tal * (1 - g) * sst(a - 0.3, a, f) ** 2
      return lo + D * (g * f + ta + (1 - g - ta) * sst(a, 1, f))
    }
    lo = Math.max(lo, hi)
  }
  return lo + (E - lo) * g
}
/** Low flow fronts (`step` m high): each front sharp, the flow behind it near-flat. */
const fronts = (E: number, step: number) => { const k = Math.floor(E / step), f = E / step - k; return (k + 0.25 * f + 0.75 * sst(0.72, 1, f)) * step }

const DESERT_LV = [0, 210, 430, 640, 800, 960, 1110, 1260]
const LAVA_LV = [0, 180, 360, 520, 640, 760, 880, 1000]
export const ICE_LV = [0, 125, 330, 560, 790]

interface World {
  /** How far out the land reaches (m from the floor's edge) at a point: its rim, then all the way down. */
  extent: (x: number, z: number) => number
  /** The land's potential (m above the ground) before the side canyons. */
  potential: (x: number, z: number, df: number, inner: boolean, roofTop: number) => number
  /** The surface over a potential (strata, flow fronts…). */
  surface: (E: number, x: number, z: number, df: number) => number
  /** Side canyons: their walls' rise per metre (range), half-widths (branch, trunk; way in), the plateau they
   *  climb to, the ways in (u round the loop), the seed. */
  canyonK: [number, number]
  wTrunk: [number, number]
  wWay: [number, number]
  /** The canyons running out across the outer land: their half-width once grown (range). */
  wOut: [number, number]
  top: number
  ways: number[]
  seed: number
  /** Thermal erosion: iterations, talus (× step), rate; talus aprons at cliff feet (0 none). */
  erode: [number, number, number]
  apron: number
}

// ── the regional land ──
// The loop's middle (set by useLoop): noise round the loop is taken by angle about it, closed on itself.
let CX = 0, CZ = 0
export function useLoop(L: { cx: number; cz: number }): void { CX = L.cx; CZ = L.cz }
/** Noise by angle about the loop's middle (k bumps round it), −1…1. */
function cn(x: number, z: number, k: number, sd: number): number {
  const th = Math.atan2(x - CX, z - CZ)
  return vn(Math.cos(th) * k + 7.3, Math.sin(th) * k - 2.1, sd)
}
/** Tilt across the loop's middle (m per km along a seeded direction). */
function tilt(x: number, z: number, sd: number): number {
  const a = sd * 2.39996
  return ((x - CX) * Math.sin(a) + (z - CZ) * Math.cos(a)) / 1000
}
/** The outer land: its rim's width (varying ~4× round the loop and by place) and the long fall beyond it
 *  into the world's ground. 0 on the rim … 1 down. (A band of the same width all round read as a ring.) */
function rimW(x: number, z: number, b: number, sd: number): number {
  const s = Math.min(1, Math.max(0, 0.5 + 0.65 * (0.7 * cn(x, z, 2.3, sd) + 0.3 * cn(x, z, 6.1, sd + 1))))
  return b * (0.2 + 2.0 * s * s) + 0.25 * b * warp(x / 2600, z / 2600, sd + 2, 0.9, 2)
}
function fallL(x: number, z: number, F: number, sd: number): number { return F * (0.65 + 0.7 * (0.5 + 0.5 * cn(x, z, 3.7, sd + 3))) }
/** Massifs of their own out on the outer land, wherever they fall — not round the loop: plateaus and
 *  uplands standing km off the rim (0…1). */
function massif(x: number, z: number, sd: number): number { return sst(0.22, 0.55, warp(x / 7000, z / 7000, sd + 7, 1.1, 2)) }
function fall(x: number, z: number, dd: number, b: number, F: number, sd: number): number {
  return Math.min(1, Math.max(0, (dd - rimW(x, z, b, sd)) / fallL(x, z, F, sd)))
}
/** MAGMA's cones: one in about half of 1.7 km cells, 450–1000 m across the base, 150–420 m tall, its crater
 *  a quarter of its width (m above the ground). */
function cones(x: number, z: number): number {
  const G = 1700, gx = Math.floor(x / G), gz = Math.floor(z / G)
  let best = 0
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const ix = gx + a, iz = gz + b
    if (hash(ix, iz, 431) > 0.5) continue
    const cx = (ix + 0.15 + 0.7 * hash(ix, iz, 432)) * G, cz = (iz + 0.15 + 0.7 * hash(ix, iz, 433)) * G
    const R = 450 + 550 * hash(ix, iz, 434), H = 150 + 270 * hash(ix, iz, 435), r = Math.hypot(x - cx, z - cz)
    if (r >= R) continue
    const Rc = 0.26 * R, rim = H * (1 - Rc / R) ** 1.3
    const h = r > Rc ? H * (1 - r / R) ** 1.3 : rim - 0.35 * H * (1 - (r / Rc) ** 2)
    if (h > best) best = h
  }
  return best
}
/** The cones as they stand: back from the rim (on it they stood in the way of every view across the
 *  gorge), and only within ~9 km of it. */
const coneAt = (x: number, z: number, df: number) => df < 800 || df > 9000 ? 0 : cones(x, z) * sst(800, 1500, df) * sst(9000, 3000, df)
const ext = (b: number, F: number, sd: number) => (x: number, z: number) => rimW(x, z, b, sd) + fallL(x, z, F, sd) + 900 + (massif(x, z, sd) > 0.02 ? 1e9 : 0)

const WORLDS: Record<LandStyle, World> = {
  // CANYON RUN: the Grand Canyon's plateau — strata in flat caprock levels, each bed its own thickness; the
  // rim wide here and narrow there, the land falling away over km in benches, debris slopes and buttes to
  // the plain; inside, a massif of its own height, tilted.
  desert: {
    extent: ext(3400, 7500, 311),
    potential: (x, z, df, inner) => {
      const T = inner
        ? 1000 + Math.max(-220, Math.min(260, 26 * tilt(x, z, 3))) + 140 * fbmR(x / 8000, z / 8000, 2, 301) + 70 * fbmR(x / 2600, z / 2600, 2, 302) + 160 * sst(600, 4500, df)
        : 800 + 180 * cn(x, z, 3, 312) + 70 * fbmR(x / 2600, z / 2600, 2, 302)
      // (The walls' set-back wanders: as a function of the distance alone, the benches ran round the loop
      //  like contour lines.)
      const dd = Math.max(0, df) + 520 * warp(x / 1400, z / 1400, 306, 0.9, 2) * sst(0, 500, df)
      const lam = 230 + 220 * (0.5 + 0.5 * warp(x / 3500, z / 3500, 303, 0.8, 2))
      let E = T * (1 - Math.exp(-Math.max(0, dd) / lam))
      // Gullies and alcoves every few hundred metres: the benches broken, the rims notched.
      const g = 1 - Math.abs(warp(x / 650, z / 650, 309, 1.0, 2))
      E -= 140 * g ** 7 * sst(120, 500, df)
      if (!inner) {
        const t = fall(x, z, dd, 3400, 7500, 311)
        E = E * (1 - t) ** 1.3 + 50 * fbmR(x / 5000, z / 5000, 2, 313) * (1 - t) * t
        // (Rising behind the rim, never at the gorge's edge: there a massif stood as one sheer 700 m face —
        //  the road cut, and from the air the square-cut ledges.)
        E = Math.max(E, T * 0.9 * massif(x, z, 311) * sst(150, 1300, df))
        // Buttes and mesas breaking off on the way down.
        const bt = sst(0.48, 0.66, warp(x / 1500, z / 1500, 307, 1.0, 2)) * sst(0.08, 0.25, t) * sst(0.85, 0.6, t)
        E = Math.max(E, bt * T * (0.35 + 0.35 * (0.5 + 0.5 * vn(x / 3000, z / 3000, 308))) * (1 - 0.6 * t))
      }
      return Math.max(0, E)
    },
    // (Below the first bed the land is smooth — pediments and debris slopes: stepped, everything under it
    //  was ground, and the land ended at the first cliff in a ring. The first bed's own top wanders every few
    //  hundred metres: level, the gorge's foot cliff was one height all round — a road cut.)
    surface: (E, x, z) => { const T = terrace(E, DESERT_LV, 0.9, 0.08, (j) => (j < 1 ? 0 : j < 2 ? 75 * fbmR(x / 700, z / 700, 2, 319) + 30 * vn(x / 170, z / 170, 318) : 95 * fbmR(x / (1500 + 350 * j), z / (1500 + 350 * j), 2, 320 + j * 13)), 0.45); return E + (T - E) * sst(120, 300, E) },
    canyonK: [0.75, 1.5], wTrunk: [60, 120], wWay: [180, 260], wOut: [90, 200], top: 900, ways: [0.14, 0.4, 0.62, 0.86], seed: 7193,
    erode: [3, 1.3, 0.25], apron: 0.5,
  },
  // MAGMA GORGE: a basalt plateau — benches near the gorge (one to four, pinching out), shield swells, its
  // land falling away over km as lobe on lobe of the last flows, low fronts, tumuli; the island its own height.
  lava: {
    extent: ext(2600, 7000, 411),
    potential: (x, z, df, inner) => {
      const shield = 170 * Math.max(0, warp(x / 6000, z / 6000, 401, 0.9, 2)) ** 1.5
      // The rim raised in a crest along the gorge, high here and low there (a plateau level to its edge
      // read from the plain as a line on the ground).
      const crest = 300 * (0.35 + 0.65 * sst(-0.5, 0.6, warp(x / 2400, z / 2400, 404, 0.9, 2))) * Math.exp(-(((df - 900) / 650) ** 2))
      const T = inner
        ? 680 + Math.max(-160, Math.min(200, 20 * tilt(x, z, 7))) + 70 * fbmR(x / 8000, z / 8000, 2, 402) + shield + 120 * sst(600, 4000, df) + 0.6 * crest
        : 700 + 160 * cn(x, z, 3, 412) + shield + crest
      const dd = Math.max(0, df) + 650 * Math.abs(warp(x / 1100, z / 1100, 406, 1.0, 2)) * sst(0, 500, df)
      const lam = 220 + 180 * (0.5 + 0.5 * warp(x / 3200, z / 3200, 403, 0.8, 2))
      let E = T * (1 - Math.exp(-Math.max(0, dd) / lam))
      if (!inner) {
        const t = fall(x, z, dd, 2600, 7000, 411)
        // Lobes: the flows' fronts are where |warp| says, not a smooth outline.
        E = E * (1 - t) ** 1.7 + (25 + 45 * (0.5 + 0.5 * warp(x / 1300, z / 1300, 407, 1.0, 2))) * sst(0, 0.2, t) * sst(1, 0.7, t + 0.25 * Math.abs(warp(x / 1800, z / 1800, 408, 0.9, 2)))
        // (Flows piled into uplands of their own out on the plain.)
        E = Math.max(E, (T * 0.75) * massif(x, z, 411) * sst(150, 1300, df))
      }
      // (Tumuli only on the flows: out on the plain they were a speckle of land patches.)
      E += 16 * Math.max(0, vn(x / 170, z / 170, 409)) ** 2 * sst(0, 300, df) * sst(40, 120, E)
      // Cinder cones along the rim and out on the flows, each with its crater, standing on the land.
      E += coneAt(x, z, df)
      return Math.max(0, E)
    },
    surface: (E, x, z, df) => {
      const big = terrace(E, LAVA_LV, 0.88, 0.06, (j) => (j < 2 ? 0 : 85 * fbmR(x / (1600 + 400 * j), z / (1600 + 400 * j), 2, 420 + j * 13)), 0.35)
      const fine = fronts(E, 9 + 9 * (0.5 + 0.5 * vn(x / 1200, z / 1200, 421)))
      // (Not on the cones: stepped, they were pyramids.)
      const w = sst(2200, 900, df) * (1 - sst(5, 60, coneAt(x, z, df)))
      return Math.max(0, big * w + fine * (1 - w))
    },
    canyonK: [1.0, 2.0], wTrunk: [55, 110], wWay: [190, 270], wOut: [80, 170], top: 760, ways: [0.12, 0.37, 0.66, 0.9], seed: 8317,
    erode: [3, 1.3, 0.2], apron: 0.3,
  },
  // BLUE HOLLOW: an ice sheet — rising toward the middle (tilted, its own height), ice cliffs at the gorge,
  // rolling ice out to a wide convex margin that ramps down onto the snowfield over km; seracs where it
  // steepens. Over the cave sections it runs across the gorge (the roof's ice is part of it).
  ice: {
    extent: ext(2400, 5500, 511),
    potential: (x, z, df, inner, roofTop) => {
      const G = inner
        ? 440 + Math.max(-120, Math.min(160, 14 * tilt(x, z, 11))) + 110 * fbmR(x / 7000, z / 7000, 2, 501) + 0.03 * Math.min(df, 6000)
        : 450 + 130 * cn(x, z, 3, 512) + 60 * fbmR(x / 7000, z / 7000, 2, 501)
      const lam = 160 + 140 * (0.5 + 0.5 * warp(x / 3000, z / 3000, 503, 0.8, 2))
      const dd = Math.max(0, df) + 250 * warp(x / 1500, z / 1500, 506, 0.9, 2) * sst(0, 400, df)
      let E = (G + 30 * fbmR(x / 1800, z / 1800, 2, 502)) * (1 - Math.exp(-Math.max(0, dd) / lam))
      if (!inner) {
        const t = Math.min(fall(x, z, dd, 2400, 5500, 511), 1 - 0.85 * massif(x, z, 511))
        // Convex: the ice thins slowly, then rolls over at its margin onto the snowfield.
        E = E * (1 - t * t) + 30 * sst(1.2, 0.9, t) * sst(0.5, 0.9, t)
        E += 4 * t * (1 - t) * 35 * sst(0.2, 0.65, warp(x / 650, z / 650, 507, 1.0, 2))
      }
      if (roofTop > 0) E = Math.max(E, (roofTop - 0.12 * Math.max(0, df - 300)) * sst(2400, 900, df))
      return Math.max(0, E)
    },
    // Ice cliffs across the sheet where it breaks over a step in its bed (here and there, not all round):
    // the glacier's own blue faces — on white rolling ice alone the gorge could not be seen from the land.
    surface: (E, x, z, df) => {
      const tk = sst(-0.1, 0.45, warp(x / 3200, z / 3200, 521, 0.9, 2)) * sst(6000, 2000, df)
      return Math.max(0, tk > 0 ? E + (terrace(E, ICE_LV, 0.9, 0.1, (j) => 40 * fbmR(x / 4000, z / 4000, 2, 522 + j), 0.3) - E) * tk : E)
    },
    canyonK: [0.5, 0.9], wTrunk: [70, 120], wWay: [200, 260], wOut: [160, 300], top: 420, ways: [0.07, 0.31, 0.58, 0.95], seed: 9431,
    erode: [0, 1, 0], apron: 0,
  },
  // WHITEWATER: the river cut deep — bluffs at the water from nothing to three times as tall, steep wooded
  // sides to the shoulders, the core inside well above the outer bank; outside, an upland of ridges and side
  // valleys falling over many km to the land around.
  forest: {
    extent: ext(2400, 7500, 611),
    potential: (x, z, df, inner) => {
      const d = Math.max(0, df)
      const Bb = 15 + 150 * sst(-0.45, 0.9, warp(x / 1700, z / 1700, 601, 0.8, 2)) ** 1.6 + 15 * fbmR(x / 220, z / 220, 2, 602)
      const bw = 25 + 45 * (0.5 + 0.5 * vn(x / 900, z / 900, 603))
      const S = 230 + 170 * (0.5 + 0.5 * warp(x / 4200, z / 4200, 604, 0.8, 2)) + (inner ? 60 : 60 * cn(x, z, 3, 612))
      const Ws = 240 + 300 * (0.5 + 0.5 * fbmR(x / 2500, z / 2500, 2, 605))
      const u = Math.min(1, Math.max(0, (d - bw) / Ws))
      let E = Bb * Math.pow(sst(0, bw, d), 0.5) + Math.max(0, S - Bb) * (1 - (1 - u) ** 2.4)
      const hills = 70 * fbmR(x / 2800, z / 2800, 3, 606) + 40 * fbmR(x / 800, z / 800, 2, 607)
      if (inner) E += sst(0, 1, (d - bw - Ws) / 900) * (200 + 300 * sst(1200, 5000, d) + Math.max(-150, Math.min(150, 16 * tilt(x, z, 5))) + hills)
      else {
        const rid = 1 - Math.abs(warp(x / 1700, z / 1700, 608, 0.9, 2))
        const t = Math.min(fall(x, z, d, 2400, 7500, 611), 1 - 0.8 * massif(x, z, 611))
        // (Ridges up to ~400 m over the shoulders: lower, from the land around the valley's side read as one
        //  low even berm.)
        E += sst(0, 1, (d - bw - Ws) / 700) * (380 * rid ** 2.5 - 60 + 1.6 * hills)
        E = E * (1 - t) ** 1.4
      }
      return Math.max(0, E)
    },
    surface: (E) => Math.max(0, E),
    canyonK: [0.5, 0.8], wTrunk: [30, 70], wWay: [150, 230], wOut: [70, 150], top: 380, ways: [0.16, 0.42, 0.69, 0.92], seed: 6151,
    erode: [8, 0.75, 0.25], apron: 0,
  },
}

/** How far out the land can reach at a point (m from the floor's edge), with its edge zone. */
export function landReach(style: LandStyle, x: number, z: number): number { return WORLDS[style].extent(x, z) }
/** The land's potential (m above the ground) at a point, before the side canyons. */
export function landPotential(style: LandStyle, x: number, z: number, df: number, inner: boolean, roofTop = 0): number { return WORLDS[style].potential(x, z, df, inner, roofTop) }
/** Its world's surface over a potential. */
export function landSurface(style: LandStyle, E: number, x: number, z: number, df: number): number { return WORLDS[style].surface(E, x, z, df) }
/** The land's surface at one point, as the walls' mesh and the boot-time questions (src/canyon.ts) ask it:
 *  the potential, cut by the side canyons (`carve`), as its world's surface. */
export function landAt(style: LandStyle, x: number, z: number, df: number, inner: boolean, carve = Infinity, roofTop = 0): number {
  const W = WORLDS[style]
  return W.surface(Math.min(W.potential(x, z, df, inner, roofTop), carve), x, z, df)
}

/** The tile's extent for a loop. */
export function landSpec(L: LandLoop, style: LandStyle): LandSpec {
  let xa = Infinity, xb = -Infinity, za = Infinity, zb = -Infinity
  for (let i = 0; i < L.rx.length; i++) { xa = Math.min(xa, L.rx[i]); xb = Math.max(xb, L.rx[i]); za = Math.min(za, L.rz[i]); zb = Math.max(zb, L.rz[i]) }
  const MARGIN = 13000, step = LAND_STEP
  const x0 = Math.floor((xa - MARGIN) / (2 * step)) * 2 * step, z0 = Math.floor((za - MARGIN) / (2 * step)) * 2 * step
  return { style, x0, z0, step, nx: Math.ceil((xb + MARGIN - x0) / step) + 1, nz: Math.ceil((zb + MARGIN - z0) / step) + 1, wallTo: WALL_TO }
}

/** Distance beyond the floor's edge (m; < 0 on the floor), the nearest row and the side, at one point
 *  (searching `cand` rows, or all). */
export function lineAt(L: LandLoop, x: number, z: number, cand: ArrayLike<number> | null): { df: number; row: number; side: number } {
  const m = L.rx.length
  let bi = 0, bd = Infinity
  if (cand) for (let c = 0; c < cand.length; c++) { const i = cand[c]; const d = (L.rx[i] - x) ** 2 + (L.rz[i] - z) ** 2; if (d < bd) { bd = d; bi = i } }
  else for (let i = 0; i < m; i++) { const d = (L.rx[i] - x) ** 2 + (L.rz[i] - z) ** 2; if (d < bd) { bd = d; bi = i } }
  const lat0 = (x - L.rx[bi]) * L.tz[bi] - (z - L.rz[bi]) * L.tx[bi]
  const al = (x - L.rx[bi]) * L.tx[bi] + (z - L.rz[bi]) * L.tz[bi]
  const nb = al >= 0 ? (bi + 1) % m : (bi - 1 + m) % m, f = Math.min(1, Math.abs(al) / 200)
  const hf = L.half[bi] + (L.half[nb] - L.half[bi]) * f
  return { df: Math.sqrt(Math.max(0, bd - al * al)) - hf, row: bi, side: lat0 >= 0 ? 1 : -1 }
}

/** The side canyons, for one world (seeded): trunks off the gorge's edges at irregular spacing and angles
 *  (out across the outer land, or into the inner one), winding, with branches that join them — narrow and
 *  shallow at their heads, widening toward the gorge; the ways in keep their floor at the plain's level all
 *  the way out and open onto it in a fan. Each line: [x, z, floor, half-width] every 120 m; k its walls'
 *  rise per metre. */
export function landNetwork(L: LandLoop, style: LandStyle): { lines: number[][]; k: number[]; open: LandOpen[] } {
  useLoop(L)
  const W = WORLDS[style], m = L.rx.length, lines: number[][] = [], ks: number[] = [], open: LandOpen[] = []
  let sd = W.seed >>> 0
  const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296 }
  // (A canyon's floor climbs late, `pe`: rising evenly, every trunk was a shallow groove past its first km —
  //  from the air the plateau had no canyons in it at all.)
  const walk = (x: number, z: number, a: number, len: number, e0: number, e1: number, w: (f: number) => number, wig: number, out_ = false, pe = 2, R = rnd) => {
    const out: number[] = [], n = Math.max(2, Math.round(len / 120)), ph = R() * 9, ph2 = R() * 9
    for (let i = 0; i <= n; i++) {
      const f = i / n
      out.push(x, z, e0 + (e1 - e0) * f ** pe, w(f))
      a += wig * (0.5 * Math.sin(f * 7 + ph) + 0.35 * Math.sin(f * 19 + ph2) + 0.25 * Math.sin(f * 41 + ph)) * 0.13
      if (out_) {
        // (A way in winds, but always outward: free, one wandered back along the gorge and onto its floor.)
        const rad = Math.atan2(x - L.cx, z - L.cz)
        let da = Math.atan2(Math.sin(a - rad), Math.cos(a - rad))
        da = Math.max(-0.75, Math.min(0.75, da))
        a = rad + da
      }
      x += Math.sin(a) * 120; z += Math.cos(a) * 120
    }
    return out
  }
  const kOf = () => W.canyonK[0] + (W.canyonK[1] - W.canyonK[0]) * rnd()
  for (const sg of [L.sgIn, -L.sgIn]) {
    const inner = sg === L.sgIn
    const todo = inner ? [] : W.ways.slice()
    let u = rnd() * 0.05
    while (u < 1 || todo.length) {
      const way = todo.length && (todo[0] <= u + 0.02 || u >= 1) ? todo.shift() : undefined
      const uu = way ?? u, r = Math.floor(uu * m) % m
      const fx = L.rx[r] + L.tz[r] * sg * (L.half[r] - 40), fz = L.rz[r] - L.tx[r] * sg * (L.half[r] - 40)
      const a0 = Math.atan2(L.tz[r] * sg, -L.tx[r] * sg) + (way !== undefined ? 0.3 : 0.85) * (rnd() - 0.5) * 2
      let line: number[]
      if (way !== undefined) {
        // A way in: as wide as a road at least, wandering in width, out past where the land ends (through any
        // massif in its way) and into a fan on the plain.
        const ph = rnd() * 6, [w0, w1] = W.wWay
        const long = walk(fx, fz, a0, 26000, 0, 0, () => w0, 1.25, true)
        let cut = long.length / 4, flat = 0
        for (let i = 8; i < long.length / 4; i++) {
          const x = long[i * 4], z = long[i * 4 + 1], l = lineAt(L, x, z, null)
          flat = W.potential(x, z, l.df, l.side === L.sgIn, 0) < 6 ? flat + 1 : 0
          if (flat >= 8) { cut = Math.min(long.length / 4, i + 20); break }
        }
        line = long.slice(0, cut * 4)
        const n = cut - 1
        for (let i = 0; i < cut; i++) { const f = i / n; line[i * 4 + 3] = (w0 + (w1 - w0) * (0.5 + 0.5 * Math.sin(f * 11 + ph))) * (1 + 2.2 * sst(0.8, 1, f)) }
      } else {
        const len = inner ? 2600 + rnd() * 5000 : 1500 + rnd() * 3200, wt = W.wTrunk[1] - rnd() * 40
        line = walk(fx, fz, a0, len, 30 + rnd() * 80, W.top * (0.7 + 0.25 * rnd()), (f) => 18 + (wt - 18) * (1 - f) ** 1.3, 1.5)
      }
      lines.push(line); ks.push(kOf())
      if (way !== undefined) {
        const axis: number[] = []
        for (let i = 0; i < line.length; i += 4) axis.push(line[i], line[i + 1], (i / 4) * 120)
        open.push({ row: r, side: sg, x: fx, z: fz, axis })
      }
      const nb = way !== undefined ? 2 + Math.floor(rnd() * 3) : Math.floor(rnd() * 3)
      for (let b = 0; b < nb; b++) {
        const q = 4 * Math.floor((line.length / 4 - 1) * (0.15 + 0.6 * rnd()))
        const ha = Math.atan2(line[q + 4] - line[q], line[q + 5] - line[q + 1]) + (rnd() < 0.5 ? -1 : 1) * (0.5 + 0.7 * rnd())
        const wb = W.wTrunk[0] - rnd() * 20
        lines.push(walk(line[q], line[q + 1], ha, 900 + rnd() * 2600, line[q + 2] + 15, W.top * (0.8 + 0.2 * rnd()), (f) => 14 + (wb - 14) * (1 - f), 1.7, false, 1.3)); ks.push(kOf())
      }
      if (way !== undefined) u = Math.max(u, way + 0.03)
      else u += 0.035 + rnd() * 0.06
    }
  }
  // (Everything below on a generator of its own: the ways in above, and so the gorge's breaches, as they were.)
  let sd2 = (W.seed * 7 + 1) >>> 0
  const rn2 = () => { sd2 = (sd2 * 1664525 + 1013904223) >>> 0; return sd2 / 4294967296 }
  const branch = (line: number[], f0: number, f1: number, len: number, rise: number) => {
    const q = 4 * Math.floor((line.length / 4 - 1) * (f0 + (f1 - f0) * rn2()))
    const ha = Math.atan2(line[q + 4] - line[q], line[q + 5] - line[q + 1]) + (rn2() < 0.5 ? -1 : 1) * (0.5 + 0.6 * rn2())
    const wb = Math.max(18, line[q + 3] * 0.55)
    lines.push(walk(line[q], line[q + 1], ha, len * (0.6 + 0.8 * rn2()), line[q + 2] + 10, rise, (f) => 14 + (wb - 14) * (1 - f) ** 1.2, 1.7, false, 1.5, rn2)); ks.push(W.canyonK[0] + (W.canyonK[1] - W.canyonK[0]) * rn2())
  }
  // The island's trunks branch again and again (one groove each was a scratch on a flat top).
  for (let li = 0, nIn = lines.length; li < nIn; li++) {
    const P = lines[li]
    if (P.length < 40) continue
    const l0 = lineAt(L, P[0], P[1], null)
    if (l0.side !== L.sgIn) continue
    for (let b = 0; b < 2; b++) branch(P, 0.2, 0.8, 1800, W.top * (0.75 + 0.2 * rn2()))
  }
  // Out on the outer land the rain runs away from the gorge: canyons with their heads by the rim (notching
  // its lip), deepening outward through the land's whole fall and out onto the plain, each with its
  // tributaries — the land read from the air as a ring round the gorge without them.
  const nOut = 13, sgO = -L.sgIn, [wo0, wo1] = W.wOut
  for (let o = 0; o < nOut; o++) {
    const uu = (o + 0.2 + 0.6 * rn2()) / nOut
    if (W.ways.some((w) => Math.abs(((uu - w + 1.5) % 1) - 0.5) < 0.035)) continue
    const r = Math.floor(uu * m) % m, hd = 140 + 420 * rn2()
    const nx = L.tz[r] * sgO, nz = -L.tx[r] * sgO
    const hx = L.rx[r] + nx * (L.half[r] + hd), hz = L.rz[r] + nz * (L.half[r] + hd)
    const wo = wo0 + (wo1 - wo0) * rn2()
    const long = walk(hx, hz, Math.atan2(nx, nz) + 0.5 * (rn2() - 0.5) * 2, 15000, 0, 0, (f) => 25 + (wo - 25) * Math.min(1, f * 3) ** 0.8, 1.4, true, 1, rn2)
    let fl = Infinity, flat = 0, cut = long.length / 4
    for (let i = 0; i < long.length / 4; i++) {
      const x = long[i * 4], z = long[i * 4 + 1], l = lineAt(L, x, z, null)
      const pot = W.potential(x, z, l.df, l.side === L.sgIn, 0)
      fl = Math.min(fl, pot * (0.45 - 0.35 * sst(0, 30, i)))
      long[i * 4 + 2] = Math.max(0, fl)
      flat = pot < 6 ? flat + 1 : 0
      if (flat >= 6) { cut = Math.min(long.length / 4, i + 12); break }
    }
    const line = long.slice(0, cut * 4)
    for (let i = Math.max(0, cut - 12); i < cut; i++) line[i * 4 + 2] = 0
    if (cut < 6) continue
    lines.push(line); ks.push(W.canyonK[0] + (W.canyonK[1] - W.canyonK[0]) * rn2())
    for (let b = 0, nb = 2 + Math.floor(rn2() * 2); b < nb; b++) branch(line, 0.1, 0.7, 2600, W.top * (0.8 + 0.2 * rn2()))
  }
  return { lines, k: ks, open }
}

/** How far a canyon's carve reaches past its line (m) at most; and segment i's own reach — only as far as its
 *  walls can still cut land (no land stands above HMAX: a carve that high cuts nothing; painting every
 *  segment the full reach was most of the build). */
const CARVE_R = 1600, HMAX = 1800
function carveReach(P: number[], i: number, k: number): number {
  return Math.min(CARVE_R, Math.max(P[i + 3], P[i + 7]) + (HMAX - Math.min(P[i + 2], P[i + 6])) / k)
}

/** The side canyons' carve at single points (the walls' mesh): their segments hashed in 600 m cells. */
export class CarveAt {
  private readonly cells = new Map<number, number[]>()
  private readonly net: { lines: number[][]; k: number[] }
  constructor(net: { lines: number[][]; k: number[] }) {
    this.net = net
    net.lines.forEach((P, li) => {
      for (let i = 0; i + 4 < P.length; i += 4) {
        const R = carveReach(P, i, net.k[li])
        if (R <= 0) continue
        const x0 = Math.min(P[i], P[i + 4]) - R, x1 = Math.max(P[i], P[i + 4]) + R, z0 = Math.min(P[i + 1], P[i + 5]) - R, z1 = Math.max(P[i + 1], P[i + 5]) + R
        for (let cx = Math.floor(x0 / 600); cx <= Math.floor(x1 / 600); cx++) for (let cz = Math.floor(z0 / 600); cz <= Math.floor(z1 / 600); cz++) {
          const key = cx * 100003 + cz
          let a = this.cells.get(key)
          if (!a) this.cells.set(key, (a = []))
          a.push(li, i)
        }
      }
    })
  }
  at(x: number, z: number): number {
    const a = this.cells.get(Math.floor(x / 600) * 100003 + Math.floor(z / 600))
    let best = 1e5
    if (!a) return best
    for (let n = 0; n < a.length; n += 2) {
      const P = this.net.lines[a[n]], i = a[n + 1], k = this.net.k[a[n]]
      const ax = P[i], az = P[i + 1], ex = P[i + 4] - ax, ez = P[i + 5] - az, l2 = ex * ex + ez * ez || 1
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2))
      const d = Math.hypot(x - ax - ex * t, z - az - ez * t)
      const v = P[i + 2] + (P[i + 6] - P[i + 2]) * t + Math.max(0, d - (P[i + 3] + (P[i + 7] - P[i + 3]) * t)) * k
      if (v < best) best = v
    }
    return best
  }
}

/** Build rows [j0, j1) of a tile: the land's potential, cut by the side canyons, as its world's surface;
 *  and each cell's distance beyond the floor's edge (for the finish). */
export function landRows(L: LandLoop, spec: LandSpec, j0: number, j1: number): { h: Float32Array; df: Float32Array; c: Float32Array } {
  const { style, x0, z0, step, nx, nz } = spec, W = WORLDS[style], m = L.rx.length
  useLoop(L)
  const rows = j1 - j0, h = new Float32Array(rows * nx), df = new Float32Array(rows * nx), C = new Float32Array(rows * nx).fill(1e5)
  const net = landNetwork(L, style)
  // The canyons' carve, painted segment by segment into these rows.
  for (let li = 0; li < net.lines.length; li++) for (let i = 0, P = net.lines[li], k = net.k[li]; i + 4 < P.length; i += 4) {
    const ax = P[i], az = P[i + 1], bx = P[i + 4], bz = P[i + 5]
    const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1
    const e0 = P[i + 2], de = P[i + 6] - e0, w0 = P[i + 3], dw = P[i + 7] - w0
    const reach = carveReach(P, i, k)
    if (reach <= 0) continue
    const ja = Math.max(j0, Math.floor((Math.min(az, bz) - reach - z0) / step)), jb = Math.min(j1 - 1, Math.ceil((Math.max(az, bz) + reach - z0) / step))
    if (ja > jb) continue
    const ka = Math.max(0, Math.floor((Math.min(ax, bx) - reach - x0) / step)), kb = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + reach - x0) / step))
    for (let j = ja; j <= jb; j++) for (let kk = ka; kk <= kb; kk++) {
      const x = x0 + kk * step, z = z0 + j * step
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2))
      const dx = x - ax - ex * t, dz = z - az - ez * t, d2 = dx * dx + dz * dz
      if (d2 > reach * reach) continue
      const e = e0 + de * t, w = w0 + dw * t
      const v = e + Math.max(0, Math.sqrt(d2) - w) * k, q = (j - j0) * nx + kk
      if (v < C[q]) C[q] = v
    }
  }
  // The line field, block by block: near the line every cell exactly (from the rows the block could be
  // nearest to); far from it, the block's corners exactly and the cells between them (smooth there).
  const B = 16, cand: number[] = []
  const corner = new Float64Array(4), cside = new Int8Array(4), lat = new Float64Array((B + 1) * (B + 1))
  for (let bz = j0; bz < j1; bz += B) for (let bx = 0; bx < nx; bx += B) {
    const cx = x0 + (bx + B / 2) * step, cz = z0 + (bz + B / 2) * step, R = B * step * 0.75
    let best = Infinity
    for (let i = 0; i < m; i++) best = Math.min(best, Math.hypot(L.rx[i] - cx, L.rz[i] - cz))
    cand.length = 0
    for (let i = 0; i < m; i++) if (Math.hypot(L.rx[i] - cx, L.rz[i] - cz) <= best + 2 * R + 220) cand.push(i)
    // (Exact within ~2 km of the line, where the walls and the gorge's edges are: past it the distance is
    // smooth, and its corners are enough — the exact search there was most of the build.)
    const far = best > (style === 'ice' ? 2600 : 1300) + R
    if (far) for (let c = 0; c < 4; c++) {
      const r = lineAt(L, x0 + (bx + (c & 1) * B) * step, z0 + (bz + (c >> 1) * B) * step, null)
      corner[c] = r.df; cside[c] = r.side
    }
    // Past ~3 km from the line the potential itself on a coarser lattice (every S cells), the cells between
    // it interpolated: out there it is broad land (the canyons' carve, still every cell, cuts it), and its
    // noise at every cell of the whole tile was most of the cold boot.
    const S = far && best > 3000 + R ? 2 : 1
    if (S > 1) for (let a = 0; a <= B; a += S) for (let b = 0; b <= B; b += S) {
      const u = b / B, v = a / B, x = x0 + (bx + b) * step, z = z0 + (bz + a) * step
      const d = (corner[0] + (corner[1] - corner[0]) * u) * (1 - v) + (corner[2] + (corner[3] - corner[2]) * u) * v
      lat[a * (B + 1) + b] = d < LAND_ZERO ? 0 : W.potential(x, z, d, cside[(v < 0.5 ? 0 : 2) + (u < 0.5 ? 0 : 1)] === L.sgIn, 0)
    }
    for (let j = bz; j < Math.min(j1, bz + B); j++) for (let kk = bx; kk < Math.min(nx, bx + B); kk++) {
      const x = x0 + kk * step, z = z0 + j * step, q = (j - j0) * nx + kk
      let d: number, side: number, row = 0
      if (far) {
        const u = (kk - bx) / B, v = (j - bz) / B
        d = (corner[0] + (corner[1] - corner[0]) * u) * (1 - v) + (corner[2] + (corner[3] - corner[2]) * u) * v
        side = cside[(v < 0.5 ? 0 : 2) + (u < 0.5 ? 0 : 1)]
      } else { const r = lineAt(L, x, z, cand); d = r.df; side = r.side; row = r.row }
      df[q] = d
      if (d < LAND_ZERO) continue
      const inner = side === L.sgIn
      let P: number
      if (S > 1) {
        const a = j - bz, b = kk - bx, a0 = a - (a % S), b0 = b - (b % S), fa = (a - a0) / S, fb = (b - b0) / S, o = a0 * (B + 1) + b0
        P = (lat[o] * (1 - fb) + lat[o + S] * fb) * (1 - fa) + (lat[o + S * (B + 1)] * (1 - fb) + lat[o + S * (B + 1) + S] * fb) * fa
      } else P = W.potential(x, z, d, inner, far ? 0 : L.roofTop[row])
      let E = Math.min(P, C[q])
      const bd = Math.min(kk, nx - 1 - kk, j, nz - 1 - j) * step
      // (Down to the world's own ground over the tile's last km: the land fades into it, no edge.)
      E *= sst(0, 4500, bd - 300)
      h[q] = Math.max(0, W.surface(E, x, z, d))
    }
  }
  return { h, df, c: C }
}

/** Finish a whole tile: a little erosion and talus aprons at the cliffs' feet (out past the walls' own
 *  mesh, where the tile is what you see), then 0 by the floor exactly and under the walls' mesh. */
export function landFinish(spec: LandSpec, h: Float32Array, df: Float32Array): void {
  const { nx, nz, step, wallTo, style } = spec, W = WORLDS[style], N = nx * nz
  const list: number[] = []
  for (let j = 1; j < nz - 1; j++) for (let k = 1; k < nx - 1; k++) if (df[j * nx + k] > wallTo + 120 && h[j * nx + k] > 0) list.push(j * nx + k)
  // (And the bare ground next to the land: debris spreads onto it.)
  for (let j = 1; j < nz - 1; j++) for (let k = 1; k < nx - 1; k++) {
    const q = j * nx + k
    if (h[q] === 0 && df[q] > wallTo + 120 && (h[q + 1] > 0 || h[q - 1] > 0 || h[q + nx] > 0 || h[q - nx] > 0)) list.push(q)
  }
  const off = [1, -1, nx, -nx, nx + 1, nx - 1, -nx + 1, -nx - 1]
  const [iters, talus, rate] = W.erode
  if (iters > 0) {
    const tal = [1, 1, 1, 1, 1.414, 1.414, 1.414, 1.414].map((s) => talus * step * s)
    const d = new Float32Array(N), e = new Float64Array(8)
    for (let it = 0; it < iters; it++) {
      d.fill(0)
      for (let li = 0; li < list.length; li++) {
        const q = list[li], hq = h[q]
        let tot = 0, mx = 0
        for (let n = 0; n < 8; n++) { const v = hq - h[q + off[n]] - tal[n]; e[n] = v; if (v > 0) { tot += v; if (v > mx) mx = v } }
        if (tot <= 0) continue
        const mv = rate * mx * 0.5
        d[q] -= mv
        for (let n = 0; n < 8; n++) if (e[n] > 0) d[q + off[n]] += mv * (e[n] / tot)
      }
      for (let li = 0; li < list.length; li++) { const q = list[li]; h[q] += d[q] }
    }
  }
  if (W.apron > 0) {
    // Talus: below every cliff a cone of debris at ~35° from its top, filled part of the way up (concave:
    // no hard line where the cliff meets the ground).
    const R = 4, src = h.slice(), slope = 0.7 * step
    const ring: number[] = []
    for (let oz = -R; oz <= R; oz++) for (let ox = -R; ox <= R; ox++) if (ox || oz) ring.push(oz * nx + ox, slope * Math.sqrt(ox * ox + oz * oz))
    // (The highest within R of each cell first — a separable max — so only cells under something taller
    //  than a talus slope ask the full cone: asking every cell was most of the finish.)
    const mx1 = new Float32Array(N), mx = new Float32Array(N)
    for (let j = 0; j < nz; j++) for (let k = 0; k < nx; k++) { let v = 0; for (let o = Math.max(0, k - R); o <= Math.min(nx - 1, k + R); o++) v = Math.max(v, src[j * nx + o]); mx1[j * nx + k] = v }
    for (let j = 0; j < nz; j++) for (let k = 0; k < nx; k++) { let v = 0; for (let o = Math.max(0, j - R); o <= Math.min(nz - 1, j + R); o++) v = Math.max(v, mx1[o * nx + k]); mx[j * nx + k] = v }
    for (let li = 0; li < list.length; li++) {
      const q = list[li], j = Math.floor(q / nx), k = q - j * nx
      if (j < R || k < R || j >= nz - R || k >= nx - R || mx[q] - src[q] <= slope) continue
      let cone = 0
      for (let i = 0; i < ring.length; i += 2) { const v = src[q + ring[i]] - ring[i + 1]; if (v > cone) cone = v }
      const gap = cone - src[q]
      if (gap > 0) h[q] = src[q] + W.apron * gap * gap / (gap + 60)
    }
  }
  for (let q = 0; q < N; q++) {
    const d = df[q]
    if (d < LAND_ZERO) h[q] = 0
    else if (d < wallTo + 60) h[q] = Math.max(0, h[q] * sst(LAND_ZERO, wallTo + 60, d))
  }
}

/** The tile in this many bands of rows, each finished on its own with a halo of rows either side (the
 *  finish reaches a few cells): built in workers (src/landjob.ts), the same land on every machine. */
export const LAND_BANDS = 6
const HALO = 12

/** One band, rows [a, e): its rows and halo built, finished, the band's own rows back. */
export function landBand(L: LandLoop, spec: LandSpec, a: number, e: number): { h: Float32Array; c: Float32Array } {
  const ha = Math.max(0, a - HALO), he = Math.min(spec.nz, e + HALO)
  const r = landRows(L, spec, ha, he)
  landFinish({ ...spec, nz: he - ha, z0: spec.z0 + ha * spec.step }, r.h, r.df)
  return { h: r.h.slice((a - ha) * spec.nx, (e - ha) * spec.nx), c: r.c.slice((a - ha) * spec.nx, (e - ha) * spec.nx) }
}

/** A whole tile, here (the workers' fallback). */
export function buildLand(L: LandLoop, style: LandStyle): LandTile {
  const spec = landSpec(L, style), N = spec.nx * spec.nz, h = new Float32Array(N), c = new Float32Array(N)
  const bh = Math.ceil(spec.nz / LAND_BANDS)
  for (let b = 0; b < LAND_BANDS; b++) {
    const a = b * bh, e = Math.min(spec.nz, a + bh)
    if (a >= e) continue
    const r = landBand(L, spec, a, e)
    h.set(r.h, a * spec.nx); c.set(r.c, a * spec.nx)
  }
  return { ...spec, h, c, open: landNetwork(L, style).open }
}
