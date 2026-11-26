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
const LAVA_LV = [0, 180, 360, 520, 640, 760]
export const ICE_LV = [0, 125, 330, 560, 790]

interface World {
  /** How far the land reaches out (m from the floor's edge) at a point. */
  reach: (x: number, z: number) => number
  /** The land's potential (m above the ground) before the side canyons. */
  potential: (x: number, z: number, df: number, inner: boolean, roofTop: number) => number
  /** The surface over a potential (strata, flow fronts…). */
  surface: (E: number, x: number, z: number, df: number) => number
  /** Side canyons: their walls' rise per metre, half-widths (branch, trunk; way in at mouth, far out), the
   *  plateau they climb to, the ways in (u round the loop), the seed. */
  canyonK: number
  wTrunk: [number, number]
  wWay: [number, number]
  top: number
  ways: number[]
  seed: number
  /** Thermal erosion: iterations, talus (× step), rate; talus aprons at cliff feet (0 none). */
  erode: [number, number, number]
  apron: number
}

const reachOf = (x: number, z: number, base: number, a: number, b: number, sd: number) => base + a * warp(x / 9000, z / 9000, sd, 1.1, 2) + b * warp(x / 2800, z / 2800, sd + 1, 0.9, 2)

const WORLDS: Record<LandStyle, World> = {
  // CANYON RUN: the Grand Canyon's plateau — strata in flat caprock levels, an escarpment in lobes and bays
  // with a debris apron below it, buttes and mesas standing off it.
  desert: {
    reach: (x, z) => reachOf(x, z, 3600, 2400, 1200, 304),
    potential: (x, z, df, inner) => {
      const T = 880 + 160 * fbmR(x / 9000, z / 9000, 2, 301) + 70 * fbmR(x / 2600, z / 2600, 2, 302) + (inner ? 220 * sst(600, 4500, df) : 0)
      const lam = 260 + 190 * (0.5 + 0.5 * warp(x / 3500, z / 3500, 303, 0.8, 2))
      let E = T * (1 - Math.exp(-Math.max(0, df) / lam))
      if (!inner) {
        const reach = reachOf(x, z, 3600, 2400, 1200, 304)
        const dd = df + 500 * warp(x / 900, z / 900, 306, 0.9, 2)
        const m = sst(reach + 500, reach - 500, dd)
        const ped = 160 * sst(reach + 2600, reach, dd)
        E = Math.max(E * m, ped * (1 - m) + E * m)
        const bt = sst(0.5, 0.68, warp(x / 1400, z / 1400, 307, 1.0, 2)) * sst(reach + 4200, reach + 600, dd) * sst(reach - 200, reach + 500, dd)
        E = Math.max(E, bt * (T * (0.55 + 0.3 * (0.5 + 0.5 * vn(x / 3000, z / 3000, 308)))))
      }
      return E
    },
    surface: (E, x, z) => terrace(E, DESERT_LV, 0.9, 0.08, (j) => (j < 2 ? 0 : 45 * fbmR(x / 2600, z / 2600, 2, 320 + j * 13)), 0.4),
    canyonK: 2.2, wTrunk: [70, 130], wWay: [190, 260], top: 900, ways: [0.14, 0.4, 0.62, 0.86], seed: 7193,
    erode: [3, 1.3, 0.25], apron: 0.45,
  },
  // MAGMA GORGE: a basalt plateau — benches near the gorge (one to four, pinching out), its outer edge the
  // lobes of the last flows stepping down in low fronts, shield swells on top, tumuli.
  lava: {
    reach: (x, z) => 3000 + 2000 * warp(x / 9000, z / 9000, 404, 1.1, 2) + 1500 * Math.abs(warp(x / 2200, z / 2200, 405, 1.0, 2)),
    potential: (x, z, df, inner) => {
      const shield = 170 * Math.max(0, warp(x / 6000, z / 6000, 401, 0.9, 2)) ** 1.5
      const T = 600 + 70 * fbmR(x / 8000, z / 8000, 2, 402) + shield + (inner ? 120 * sst(600, 4000, df) : 0)
      const lam = 220 + 160 * (0.5 + 0.5 * warp(x / 3200, z / 3200, 403, 0.8, 2))
      let E = T * (1 - Math.exp(-Math.max(0, df) / lam))
      if (!inner) {
        // Lobate: the edge is where the last flows stopped — |warp| makes lobes, not a smooth outline.
        const reach = 3000 + 2000 * warp(x / 9000, z / 9000, 404, 1.1, 2) + 1500 * Math.abs(warp(x / 2200, z / 2200, 405, 1.0, 2))
        // (Down over km, flow on flow: dropping over a few hundred metres it ended in one tall scarp.)
        const dd = df + 700 * Math.abs(warp(x / 1100, z / 1100, 406, 1.0, 2))
        const m = sst(reach + 2200, reach - 500, dd) ** 1.4
        // Thin flows reaching out past it, lobe on lobe, 20–80 m.
        const lobes = (30 + 50 * (0.5 + 0.5 * warp(x / 1300, z / 1300, 407, 1.0, 2))) * sst(reach + 3200, reach + 200, dd + 600 * warp(x / 1800, z / 1800, 408, 0.9, 2))
        E = Math.max(E * m, lobes)
      }
      // Tumuli: blisters of crust a few tens of metres.
      E += 16 * Math.max(0, vn(x / 170, z / 170, 409)) ** 2 * sst(0, 300, df)
      return E
    },
    surface: (E, x, z, df) => {
      const big = terrace(E, LAVA_LV, 0.88, 0.06, (j) => (j < 2 ? 0 : 80 * fbmR(x / 2400, z / 2400, 2, 420 + j * 13)), 0.35)
      const fine = fronts(E, 9 + 9 * (0.5 + 0.5 * vn(x / 1200, z / 1200, 421)))
      // Benches near the gorge; low fronts everywhere else (never one tall cliff out on the flows).
      const w = sst(2200, 900, df)
      return Math.max(0, big * w + fine * (1 - w))
    },
    canyonK: 2.0, wTrunk: [60, 120], wWay: [200, 280], top: 620, ways: [0.12, 0.37, 0.66, 0.9], seed: 8317,
    erode: [3, 1.3, 0.2], apron: 0.3,
  },
  // BLUE HOLLOW: a glacier — its surface rising inward (the ice flows out from the middle), ice cliffs at the
  // gorge, seracs where it steepens toward its margin, which ramps down onto the snowfield. Over the cave
  // sections it runs across the gorge (the roof's ice is part of it).
  ice: {
    reach: (x, z) => reachOf(x, z, 2600, 1800, 700, 504),
    potential: (x, z, df, inner, roofTop) => {
      const G = 380 + 120 * fbmR(x / 7000, z / 7000, 2, 501) + 40 * fbmR(x / 2000, z / 2000, 2, 502) + (inner ? 0.03 * Math.min(df, 6000) : 0)
      const lam = 160 + 120 * (0.5 + 0.5 * warp(x / 3000, z / 3000, 503, 0.8, 2))
      let E = G * (1 - Math.exp(-Math.max(0, df) / lam))
      if (!inner) {
        const reach = reachOf(x, z, 2600, 1800, 700, 504)
        const W = 1400 + 500 * vn(x / 4000, z / 4000, 505)
        const dd = df + 300 * warp(x / 800, z / 800, 506, 0.9, 2)
        const t = Math.min(1, Math.max(0, (dd - reach) / W))
        // A convex snout, then the snowfield's ramp below it.
        E = Math.max(E * (1 - t * t), 55 * sst(reach + W + 1500, reach + W - 200, dd))
        // Seracs where it steepens: broken blocks across the margin.
        E += 4 * t * (1 - t) * 45 * sst(0.1, 0.6, warp(x / 210, z / 210, 507, 1.0, 2))
      }
      // Over the cave sections: the glacier's surface at the roof's ice, falling gently away from it.
      if (roofTop > 0) E = Math.max(E, (roofTop - 0.12 * Math.max(0, df - 300)) * sst(2400, 900, df))
      return E
    },
    // (No strata on a glacier: flat sheets of terrace read as cardboard.)
    surface: (E) => Math.max(0, E),
    canyonK: 1.0, wTrunk: [70, 120], wWay: [200, 260], top: 420, ways: [0.07, 0.31, 0.58, 0.95], seed: 9431,
    erode: [0, 1, 0], apron: 0,
  },
  // WHITEWATER: the river cut deep — granite bluffs at the water, steep wooded sides up to the shoulders,
  // the core inside the loop well above the outer bank, ridges and side valleys outside falling away to the
  // land around over km.
  forest: {
    reach: (x, z) => reachOf(x, z, 2200, 1400, 800, 604),
    potential: (x, z, df, inner) => {
      const d = Math.max(0, df)
      // (Tall, for a river 1.4 km wide: walls of 100 m beside it read as a lawn's low banks round a lake.)
      const Bb = 70 + 80 * (0.5 + 0.5 * warp(x / 1700, z / 1700, 601, 0.8, 2)) + 20 * fbmR(x / 220, z / 220, 2, 602)
      const bw = 30 + 40 * (0.5 + 0.5 * vn(x / 900, z / 900, 603))
      const S = 240 + 160 * (0.5 + 0.5 * warp(x / 4200, z / 4200, 604, 0.8, 2))
      const Ws = 260 + 260 * (0.5 + 0.5 * fbmR(x / 2500, z / 2500, 2, 605))
      const u = Math.min(1, Math.max(0, (d - bw) / Ws))
      let E = Bb * Math.pow(sst(0, bw, d), 0.5) + Math.max(0, S - Bb) * (1 - (1 - u) ** 2.4)
      const hills = 70 * fbmR(x / 2800, z / 2800, 3, 606) + 40 * fbmR(x / 800, z / 800, 2, 607)
      if (inner) E += sst(0, 1, (d - bw - Ws) / 900) * (160 + 300 * sst(1200, 5000, d) + hills)
      else {
        const rid = 1 - Math.abs(warp(x / 1700, z / 1700, 608, 0.9, 2))
        const reach = reachOf(x, z, 2200, 1400, 800, 604)
        const t = Math.min(1, Math.max(0, (d + 300 * warp(x / 900, z / 900, 609, 0.9, 2) - reach) / 2600))
        E += sst(0, 1, (d - bw - Ws) / 700) * (150 * rid ** 3 - 40 + hills)
        E = E * (1 - t) ** 1.5
      }
      return Math.max(0, E)
    },
    surface: (E) => Math.max(0, E),
    canyonK: 0.6, wTrunk: [30, 70], wWay: [150, 220], top: 380, ways: [0.16, 0.42, 0.69, 0.92], seed: 6151,
    erode: [8, 0.75, 0.25], apron: 0,
  },
}

/** How far out the land can reach at a point (m from the floor's edge), with its edge zone. */
export function landReach(style: LandStyle, x: number, z: number): number { return WORLDS[style].reach(x, z) + 3000 }
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
  const MARGIN = 11500, step = LAND_STEP
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
 *  (out across the outer land, or into the inner one), meandering, with branches that join them; the ways in
 *  keep their floor at the plain's level all the way out. Each: [x, z, floor, half-width] every 120 m. */
export function landNetwork(L: LandLoop, style: LandStyle): { lines: number[][]; open: LandOpen[] } {
  const W = WORLDS[style], m = L.rx.length, lines: number[][] = [], open: LandOpen[] = []
  let sd = W.seed >>> 0
  const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296 }
  const walk = (x: number, z: number, a: number, len: number, e0: number, e1: number, w0: number, w1: number, wig: number) => {
    const out: number[] = [], n = Math.max(2, Math.round(len / 120)), ph = rnd() * 9
    for (let i = 0; i <= n; i++) {
      const f = i / n
      out.push(x, z, e0 + (e1 - e0) * f ** 0.8, w0 + (w1 - w0) * f)
      a += wig * (0.5 * Math.sin(f * 7 + ph) + 0.35 * Math.sin(f * 19 + ph * 2)) * 0.12
      x += Math.sin(a) * 120; z += Math.cos(a) * 120
    }
    return out
  }
  for (const sg of [L.sgIn, -L.sgIn]) {
    const inner = sg === L.sgIn
    const todo = inner ? [] : W.ways.slice()
    let u = rnd() * 0.05
    while (u < 1 || todo.length) {
      // The next way in, when the walk round the loop reaches it.
      const way = todo.length && (todo[0] <= u + 0.02 || u >= 1) ? todo.shift() : undefined
      const uu = way ?? u, r = Math.floor(uu * m) % m
      const fx = L.rx[r] + L.tz[r] * sg * (L.half[r] - 40), fz = L.rz[r] - L.tx[r] * sg * (L.half[r] - 40)
      const a0 = Math.atan2(L.tz[r] * sg, -L.tx[r] * sg) + (way !== undefined ? 0.25 : 0.85) * (rnd() - 0.5) * 2
      const len = way !== undefined ? W.reach(fx, fz) + 5200 : (inner ? 1800 + rnd() * 3800 : 1500 + rnd() * 3200)
      const line = way !== undefined
        ? walk(fx, fz, a0, len, 0, 0, W.wWay[0], W.wWay[1], 0.6)
        : walk(fx, fz, a0, len, 30 + rnd() * 80, W.top * (0.7 + 0.25 * rnd()), W.wTrunk[1] - rnd() * 40, 25, 1.4)
      lines.push(line)
      if (way !== undefined) {
        const axis: number[] = []
        for (let i = 0; i < line.length; i += 4) axis.push(line[i], line[i + 1], (i / 4) * 120)
        open.push({ row: r, side: sg, x: fx, z: fz, axis })
      }
      const nb = way !== undefined ? 2 + Math.floor(rnd() * 2) : Math.floor(rnd() * 3)
      for (let b = 0; b < nb; b++) {
        const q = 4 * Math.floor((line.length / 4 - 1) * (0.25 + 0.6 * rnd()))
        const ha = Math.atan2(line[q + 4] - line[q], line[q + 5] - line[q + 1]) + (rnd() < 0.5 ? -1 : 1) * (0.6 + 0.6 * rnd())
        lines.push(walk(line[q], line[q + 1], ha, 900 + rnd() * 2200, line[q + 2] + 15, W.top * (0.8 + 0.2 * rnd()), W.wTrunk[0] - rnd() * 20, 18, 1.6))
      }
      // (Past a way in: the next trunk a fair way on, so the way's mouth stays clear.)
      if (way !== undefined) u = Math.max(u, way + 0.03)
      else u += 0.04 + rnd() * 0.05
    }
  }
  return { lines, open }
}

/** Build rows [j0, j1) of a tile: the land's potential, cut by the side canyons, as its world's surface;
 *  and each cell's distance beyond the floor's edge (for the finish). */
export function landRows(L: LandLoop, spec: LandSpec, j0: number, j1: number): { h: Float32Array; df: Float32Array; c: Float32Array } {
  const { style, x0, z0, step, nx, nz } = spec, W = WORLDS[style], m = L.rx.length
  const rows = j1 - j0, h = new Float32Array(rows * nx), df = new Float32Array(rows * nx), C = new Float32Array(rows * nx).fill(1e5)
  const net = landNetwork(L, style)
  // The canyons' carve, painted segment by segment into these rows.
  const reach = 1200, k = W.canyonK
  for (const P of net.lines) for (let i = 0; i + 4 < P.length; i += 4) {
    const ax = P[i], az = P[i + 1], bx = P[i + 4], bz = P[i + 5]
    const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1
    const ja = Math.max(j0, Math.floor((Math.min(az, bz) - reach - z0) / step)), jb = Math.min(j1 - 1, Math.ceil((Math.max(az, bz) + reach - z0) / step))
    if (ja > jb) continue
    const ka = Math.max(0, Math.floor((Math.min(ax, bx) - reach - x0) / step)), kb = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + reach - x0) / step))
    for (let j = ja; j <= jb; j++) for (let kk = ka; kk <= kb; kk++) {
      const x = x0 + kk * step, z = z0 + j * step
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2))
      const d = Math.hypot(x - ax - ex * t, z - az - ez * t)
      const e = P[i + 2] + (P[i + 6] - P[i + 2]) * t, w = P[i + 3] + (P[i + 7] - P[i + 3]) * t
      const v = e + Math.max(0, d - w) * k, q = (j - j0) * nx + kk
      if (v < C[q]) C[q] = v
    }
  }
  // The line field, block by block: near the line every cell exactly (from the rows the block could be
  // nearest to); far from it, the block's corners exactly and the cells between them (smooth there).
  const B = 16, cand: number[] = []
  const corner = new Float64Array(4), cside = new Int8Array(4)
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
      let E = Math.min(W.potential(x, z, d, inner, far ? 0 : L.roofTop[row]), C[q])
      const bd = Math.min(kk, nx - 1 - kk, j, nz - 1 - j) * step
      E *= sst(0, 3000, bd - 600)
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
