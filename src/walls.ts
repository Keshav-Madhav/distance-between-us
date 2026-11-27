// The gorge's walls beside the floor (src/canyon.ts draws them): their own fine mesh, out to WALL_TO from the
// floor's edge, where the land tile (src/land.ts) takes over. Shaped from the land's own functions at the
// walls' finer spacing — each world's foot on it — blended into the land's surface at their outer edge and
// tucked under it; then cut into triangles (gentle faces smooth-shaded apart from the cliffs).
// Pure maths, no three.js: built in a worker at boot (src/landjob.ts) alongside the tile.
import { CarveAt, LAND_ZERO, landNetwork, landPotential, landSurface, sst, useLoop, vn, WALL_TO, warp, type LandLoop, type LandStyle } from './land'

/** The cave's roof: its edges stand on the walls `ROOF_D` out from the foot, at `ROOF_H` (× the row's
 *  height scale); its ice is `ROOF_T` thick (the glacier over the cave is that much higher). */
export const ROOF_D = 260, ROOF_H = 290, ROOF_T = 70
/** BLUE HOLLOW's cave wall from its foot to the roof's edge: [m out, height] (the height at ROOF_D is
 *  scaled to the row's own). */
const CAVE_WALL: [number, number][] = [[0, -4], [30, 60], [70, 150], [140, 230], [ROOF_D, ROOF_H]]

export interface WallSideIn { inner: boolean; sg: number; fx: Float64Array; fz: Float64Array; lam: Float64Array; col: number[] }
export interface WallsIn {
  style: LandStyle
  L: LandLoop
  /** Wall rows (every land row) and race rows per wall row. */
  N: number
  SUB: number
  /** BLUE HOLLOW: per race row, how roofed (0…1), and per side the cave wall's top under the roof (m). */
  roofK: Float64Array
  eh: Float64Array[]
  sides: WallSideIn[]
  /** Faces flatter than this are the gentle ones (0: none apart); `cliffs`: the steep ones apart too. */
  topY: number
  cliffs: boolean
}
export interface WallSideOut { y: Float32Array; cv: Float32Array; low: Uint8Array; rel: Float32Array }
/** One chunk of the walls' triangles: walls, gentle faces (smooth normals),
 *  cliffs — each a flat triangle list with its normals and aCrev; heights above the world's ground, and each
 *  corner's grid vertex (Q: side 0's first, then side 1's) for the main thread to lift by the ground there
 *  (a worker cannot ask the ground: it is the course's, with its jumps). */
export interface WallBlock {
  pos: Float32Array; posN: Float32Array; crev: Float32Array; posQ: Int32Array
  top: Float32Array; topN: Float32Array; topC: Float32Array; topQ: Int32Array
  cliff: Float32Array; cliffN: Float32Array; cliffC: Float32Array; cliffQ: Int32Array
}
export interface WallsOut { sides: WallSideOut[]; blocks: WallBlock[] }

/** A growing float buffer (the walls are ~100k triangles: a JS array of every float was a third of the build). */
class IBuf {
  a = new Int32Array(1 << 15)
  n = 0
  push(x: number): void { if (this.n >= this.a.length) { const b = new Int32Array(this.a.length * 2); b.set(this.a); this.a = b } this.a[this.n++] = x }
  out(): Int32Array { return this.a.slice(0, this.n) }
}
class Buf {
  a = new Float32Array(1 << 16)
  n = 0
  private room(k: number): void { if (this.n + k > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b } }
  push(x: number): void { this.room(1); this.a[this.n++] = x }
  push3(x: number, y: number, z: number): void { this.room(3); const a = this.a, n = this.n; a[n] = x; a[n + 1] = y; a[n + 2] = z; this.n = n + 3 }
  out(): Float32Array { return this.a.slice(0, this.n) }
}

/** The land tile's own height at a point beside the floor (before its erosion and talus, which start past
 *  the walls): what the walls blend into and tuck under. */
function tileHere(s: LandStyle, x: number, z: number, d: number, inner: boolean, C: number, roofTop: number): number {
  return landSurface(s, Math.min(landPotential(s, x, z, d, inner, roofTop), C), x, z, d) * sst(LAND_ZERO, WALL_TO + 60, d)
}

/** The walls d out from the foot, at race row i: the land's own surface (cut by its side canyons), with each
 *  world's foot — a cliff always (a canyon notches the rim, never the foot), lava glowing along it, the cave's
 *  walls leaning out to its roof. */
function wallShape(inp: WallsIn, carve: CarveAt, x: number, z: number, d: number, inner: boolean, i: number, side: number): { h: number; crev: number } {
  const s = inp.style, C = carve.at(x, z), open = C < 60, roofTop = inp.L.roofTop[i]
  let E = Math.min(landPotential(s, x, z, d, inner, roofTop), C)
  let h: number, crev = 0
  if (s === 'desert') {
    // The foot's cliff: low, its height wandering along the gorge and notched — the strata's own cliffs stand
    // above it, set back as the land wanders; behind it a long debris slope down into the land wherever the land
    // is lower. (One tall face at the floor's edge, one height all round and cut square behind, read as a road
    // cut, and from the air as boxes on a shelf; a bench held up until the land rose past it ended in a sheer
    // face wherever a side canyon came down, a card standing in the land.)
    const Hf = 15 + 190 * sst(-0.5, 0.7, warp(x / 900, z / 900, 441, 0.9, 2)) - 40 * Math.max(0, vn(x / 260, z / 260, 442)) ** 2
    E = Math.max(E, Hf * sst(4, 18, d) * (1 - sst(45, 230, d)) * sst(60, 260, C))
    h = landSurface(s, E, x, z, d) - 6 * sst(30, 0, d)
  } else if (s === 'lava') {
    // (The glow only on the foot's own narrow faces: across a 200 m face it read as a band of yellow paint.)
    // (And in pools along it, not one unbroken seam: from the air a lit line drawn round the floor.)
    if (d <= 12 && !open) return { h: d <= 0 ? -6 : d <= 6 ? 2 : 8, crev: d <= 6 ? sst(0.05, 0.45, vn(x / 110, z / 110, 433)) : 0 }
    // The rim's lip: uneven, here a low levee and there a tall wall (one height all round read as a parapet).
    // (Low in long stretches, tall in others, and falling back into the land as a levee: one band of even
    //  height with flat tops read from the air as a wall built round the gorge; a bench held up behind it
    //  ended in a sheer card wherever a side canyon came down.)
    const Hr = 25 + 230 * sst(-0.5, 0.7, warp(x / 800, z / 800, 431, 0.8, 2)) - 50 * Math.max(0, vn(x / 240, z / 240, 432)) ** 2
    E = Math.max(E, Hr * sst(12, 22, d) * (1 - sst(40, 220, d)) * sst(60, 260, C))
    h = landSurface(s, E, x, z, d)
  } else if (s === 'ice') {
    // The foot's ice cliff, its height wandering, its back falling away as a long slope (a ledge of one height
    // cut square behind lay along the gorge as a plank, and from afar notched its skyline like a castle).
    const Hi = 30 + 140 * sst(-0.5, 0.7, warp(x / 900, z / 900, 452, 0.9, 2))
    E = Math.max(E, Hi * sst(4, 22, d) * (1 - sst(40, 240, d)) * sst(60, 260, C))
    // (No terraced ice cliffs in the walls' own mesh: their steps fell between its columns, and every row
    //  cut them its own way — a sawtooth along the rim from the air. The sheet's cliffs stand out past it.)
    h = E
    const roof = inp.roofK[i]
    if (roof > 0) {
      // Under the roof: the cave wall leaning out to the roof's edge; past it the ice, never below the roof's.
      const eh = inp.eh[side][i]
      let w: number
      if (d <= ROOF_D) {
        const P = CAVE_WALL
        w = P[P.length - 1][1]
        for (let k = 0; k < P.length - 1; k++) if (d <= P[k + 1][0]) { const t = (d - P[k][0]) / (P[k + 1][0] - P[k][0]); w = P[k][1] + (P[k + 1][1] - P[k][1]) * t; break }
        if (w > 0) w *= eh / ROOF_H
        // (Bulging and hollowed: one profile all along, the cave's walls were flat blue boards.)
        w += 22 * vn(x / 70, z / 70, 451) * Math.sin(Math.PI * d / ROOF_D)
      } else w = Math.max(eh + ROOF_T * sst(ROOF_D, ROOF_D + 40, d) + 20, h)
      h = h + (w - h) * roof
      // (The cave's own lit ice only well inside it: at its mouths, under open sky, the walls are the
      //  glacier's — in the cave's blue they were ragged blue ribbons laid along the rim from the air.)
      // (Nor its last stretch under the roof's edge: from the air that showed past the edge as a broken blue
      //  line along the rim; in the glacier's own look it is snow there.)
      crev = d <= ROOF_D - 50 && roof > 0.85 ? 0.15 * (1 - d / ROOF_D) * roof : 0
    }
  } else h = landSurface(s, E, x, z, d)
  // Into the land's own surface at the walls' outer edge (above or below it, a step there read as a fence).
  if (d > 230) h += (tileHere(s, x, z, d, inner, C, roofTop) - h) * sst(230, WALL_TO, d) * (s === 'ice' && inp.roofK[i] > 0 ? 0 : 1)
  return { h, crev }
}

export function buildWalls(inp: WallsIn): WallsOut {
  useLoop(inp.L)
  const net = landNetwork(inp.L, inp.style), carve = new CarveAt(net)
  const { N, SUB, L, style } = inp, cx = L.cx, cz = L.cz
  const foot = style === 'forest' || style === 'ice' ? -4 : -6
  const sides: WallSideOut[] = []
  const blocks = Array.from({ length: 4 }, () => ({ pos: new Buf(), posN: new Buf(), crev: new Buf(), posQ: new IBuf(), top: new Buf(), topN: new Buf(), topC: new Buf(), topQ: new IBuf(), cliff: new Buf(), cliffN: new Buf(), cliffC: new Buf(), cliffQ: new IBuf() }))
  let qBase = 0
  for (let si = 0; si < inp.sides.length; si++) {
    const S = inp.sides[si], { fx, fz, lam, col, inner } = S, K = col.length
    const y = new Float32Array(N * K), cv = new Float32Array(N * K), low = new Uint8Array(N * K), rel = new Float32Array(N * K)
    const vx = new Float32Array(N * K), vz = new Float32Array(N * K), dir = inner ? -1 : 1
    for (let r = 0; r < N; r++) {
      const i = Math.floor(r / SUB), ox = (fx[r] - cx) / lam[r], oz = (fz[r] - cz) / lam[r]
      for (let k = 0; k < K; k++) {
        const d = col[k], x = fx[r] + ox * dir * d, z = fz[r] + oz * dir * d, q = r * K + k
        vx[q] = x; vz[q] = z
        let h: number, c = 0
        if (k === 0) h = foot // (the foot exactly on the floor's edge, where the race's wall is)
        else if (k === K - 1) {
          // (The skirt: just under the land's own surface there.)
          const C = carve.at(x, z)
          h = tileHere(style, x, z, d, inner, C, L.roofTop[i]) - 25
        } else { const w = wallShape(inp, carve, x, z, d, inner, i, si); h = w.h; c = w.crev }
        // (Never down at the ground's own level past the foot, where the ground and the walls' faces crossed:
        //  lying on the floor at a way's mouth they z-fought it into a dark striped band; pressed just under it,
        //  the ground cut through them along their long triangles as spikes of grass. Down a way in, under it
        //  for good (the way's floor is the ground); elsewhere a few metres up, covering it.)
        if (k > 0 && k < K - 1 && h < 4) {
          h = carve.at(x, z) < 100 ? foot : 4
        }
        low[q] = h <= foot + 0.01 && k > 0 ? 1 : 0
        y[q] = h; rel[q] = h; cv[q] = c
      }
    }
    sides.push({ y, cv, low, rel })
    tris(inp, vx, vz, y, cv, low, N, K, blocks, qBase)
    qBase += N * K
  }
  const out: WallBlock[] = blocks.map((B) => {
    const top = B.top.out()
    return { pos: B.pos.out(), posN: B.posN.out(), crev: B.crev.out(), posQ: B.posQ.out(), top, topN: B.topN.out(), topC: B.topC.out(), topQ: B.topQ.out(), cliff: B.cliff.out(), cliffN: B.cliffN.out(), cliffC: B.cliffC.out(), cliffQ: B.cliffQ.out() }
  })
  return { sides, blocks: out }
}

/** One side's grid as triangles, into the chunks round the loop. */
function tris(inp: WallsIn, vx: Float32Array, vz: Float32Array, Y: Float32Array, cv: Float32Array, low: Uint8Array, N: number, K: number, blocks: { pos: Buf; posN: Buf; crev: Buf; posQ: IBuf; top: Buf; topN: Buf; topC: Buf; topQ: IBuf; cliff: Buf; cliffN: Buf; cliffC: Buf; cliffQ: IBuf }[], qBase: number): void {
  const RB = Math.ceil(N / blocks.length), split = inp.topY > 0, topY = inp.topY
  const flip = (vx[K] - vx[0]) * (vz[1] - vz[0]) - (vz[K] - vz[0]) * (vx[1] - vx[0]) > 0
  const vn3 = split ? new Float32Array(N * K * 3) : null
  const fn = [0, 0, 0]
  const face = (q0: number, q1: number, q2: number) => {
    const ux = vx[q1] - vx[q0], uy = Y[q1] - Y[q0], uz = vz[q1] - vz[q0], wx = vx[q2] - vx[q0], wy = Y[q2] - Y[q0], wz = vz[q2] - vz[q0]
    fn[0] = uy * wz - uz * wy; fn[1] = uz * wx - ux * wz; fn[2] = ux * wy - uy * wx
  }
  const kind = (q0: number, q1: number, q2: number, acc: boolean): number => {
    if (!split) return 0
    face(q0, q1, q2)
    let [nx, ny, nz] = fn
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz }
    // (Never the cave's own walls under the roof: they are the ice the lamps light.)
    if (cv[q0] > 0 || cv[q1] > 0 || cv[q2] > 0) return 0
    // (A steep face only a few metres tall is not a cliff: on gentle ice they were stray blue shards.)
    const ext = Math.max(Y[q0], Y[q1], Y[q2]) - Math.min(Y[q0], Y[q1], Y[q2])
    if (ny / Math.hypot(nx, ny, nz) > topY || ext < 22) {
      if (acc) for (const q of [q0, q1, q2]) { vn3![q * 3] += nx; vn3![q * 3 + 1] += ny; vn3![q * 3 + 2] += nz }
      return 1
    }
    return inp.cliffs ? 2 : 0
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
  ti = 0
  quads((q0, q1, q2, r) => {
    const B = blocks[Math.floor(r / RB)], kd = kinds[ti++]
    // (Ground under the ground: never seen.)
    if (low[q0] && low[q1] && low[q2]) return
    const o = kd === 1 ? B.top : kd === 2 ? B.cliff : B.pos, oc = kd === 1 ? B.topC : kd === 2 ? B.cliffC : B.crev, oq = kd === 1 ? B.topQ : kd === 2 ? B.cliffQ : B.posQ
    o.push3(vx[q0], Y[q0], vz[q0]); o.push3(vx[q1], Y[q1], vz[q1]); o.push3(vx[q2], Y[q2], vz[q2])
    oq.push(qBase + q0); oq.push(qBase + q1); oq.push(qBase + q2)
    oc.push(cv[q0]); oc.push(cv[q1]); oc.push(cv[q2])
    if (kd === 1) for (const q of [q0, q1, q2]) {
      const x = vn3![q * 3], y = vn3![q * 3 + 1], z = vn3![q * 3 + 2], l = Math.hypot(x, y, z) || 1
      B.topN.push3(x / l, y / l, z / l)
    } else {
      face(q0, q1, q2)
      const l = Math.hypot(fn[0], fn[1], fn[2]) || 1, on = kd === 2 ? B.cliffN : B.posN
      for (let j = 0; j < 3; j++) on.push3(fn[0] / l, fn[1] / l, fn[2] / l)
    }
  })
}
