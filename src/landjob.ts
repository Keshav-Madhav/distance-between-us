// A gorge's land (src/land.ts) and its walls (src/walls.ts), built at boot in workers while the rest of the
// page boots: the walls in one job, the tile in a fixed number of bands of rows (the same land on every
// machine), each built whole — rows, halo and finish — all posted at once (a job handed out only when the last
// came back waited on the main thread, busy booting). On the main thread it was ~650 ms of boot.
import { buildLand, LAND_BANDS, landNetwork, landSpec, type LandLoop, type LandStyle, type LandTile } from './land'
import { buildWalls, type WallsIn, type WallsOut } from './walls'
import { BIOME } from './terrain'
import { idbGetAny, idbPrune, idbSetAny } from './store'
import LAND_SRC from './land.ts?raw'
import WALLS_SRC from './walls.ts?raw'

// The workers, started as this module loads (the first thing the page does): a worker takes a while to start,
// and started only when the land was asked for, the boot waited on that too.
const POOL: Worker[] | null = (() => {
  if (!['desert', 'ice', 'lava', 'forest'].includes(BIOME)) return null
  const W = Math.max(1, Math.min(LAND_BANDS + 1, (navigator.hardwareConcurrency || 4) - 2))
  try { return Array.from({ length: W }, () => new Worker(new URL('./landworker.ts', import.meta.url), { type: 'module' })) } catch { return null }
})()

/** The land's cache key: its course's line, and the land's own code (a change to either is a new land). */
function cacheKey(L: LandLoop, style: LandStyle, wallsIn: WallsIn): string {
  let h = 2166136261
  const mix = (s: string) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) }
  mix(LAND_SRC); mix(WALLS_SRC); mix(style)
  for (let i = 0; i < L.rx.length; i += 7) mix(`${L.rx[i].toFixed(1)},${L.rz[i].toFixed(1)},${L.half[i].toFixed(1)},${L.roofTop[i].toFixed(1)}`)
  mix(`${wallsIn.N},${wallsIn.topY},${wallsIn.sides.map((S) => S.col.join(',')).join('|')}`)
  return `land:${style}:${(h >>> 0).toString(36)}`
}

/**
 * The land and its walls: from the cache when this course's land was built before (the first boot of a world
 * pays for it, later ones do not — and the course picker's prewarm builds the next one's behind the menu),
 * else built in the workers and put in the cache once the page is up.
 */
export async function startLand(L: LandLoop, style: LandStyle, wallsIn: WallsIn): Promise<{ tile: LandTile; walls: WallsOut }> {
  const key = cacheKey(L, style, wallsIn)
  const hit = await idbGetAny<{ tile: LandTile; walls: WallsOut }>(key)
  if (hit && hit.tile && hit.walls) { if (POOL) for (const w of POOL) w.terminate(); return hit }
  const built = await build(L, style, wallsIn)
  // (Stored when the page is idle: cloning ~10 MB is a hitch.)
  const store = () => { void idbSetAny(key, { tile: { ...built.tile, c: new Float32Array(0) }, walls: built.walls }).then(() => idbPrune(`land:${style}:`, key)) }
  if ('requestIdleCallback' in window) requestIdleCallback(store, { timeout: 5000 }); else setTimeout(store, 2000)
  return built
}

function build(L: LandLoop, style: LandStyle, wallsIn: WallsIn): Promise<{ tile: LandTile; walls: WallsOut }> {
  const spec = landSpec(L, style)
  const here = () => ({ tile: buildLand(L, style), walls: buildWalls(wallsIn) })
  if (!POOL) return Promise.resolve(here())
  const workers = POOL, W = workers.length
  return new Promise((resolve) => {
    const N = spec.nx * spec.nz, h = new Float32Array(N), c = new Float32Array(N), bh = Math.ceil(spec.nz / LAND_BANDS)
    let left = 0, failed = false, walls: WallsOut | null = null
    const finish = () => { for (const w of workers) w.terminate() }
    const check = () => { if (--left === 0 && !failed) { finish(); resolve({ tile: { ...spec, h, c, open: landNetwork(L, style).open }, walls: walls! }) } }
    for (const w of workers) {
      w.onerror = () => { if (failed) return; failed = true; finish(); resolve(here()) }
      w.onmessage = (e: MessageEvent<{ a: number; h: Float32Array; c: Float32Array; walls?: WallsOut }>) => {
        if (e.data.walls) walls = e.data.walls
        else { h.set(e.data.h, e.data.a * spec.nx); c.set(e.data.c, e.data.a * spec.nx) }
        check()
      }
    }
    // (The walls first, to the last worker — it gets one band fewer.)
    left++
    workers[W - 1].postMessage({ op: 'walls', inp: wallsIn })
    for (let b = 0; b < LAND_BANDS; b++) {
      const a = b * bh, e = Math.min(spec.nz, a + bh)
      if (a >= e) continue
      left++
      workers[b % W].postMessage({ op: 'band', L, spec, a, e })
    }
  })
}
