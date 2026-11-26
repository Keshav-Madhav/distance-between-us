// A gorge's land (src/land.ts) and its walls (src/walls.ts), built at boot in workers while the rest of the
// page boots: the walls in one job, the tile in a fixed number of bands of rows (the same land on every
// machine), each built whole — rows, halo and finish — all posted at once (a job handed out only when the last
// came back waited on the main thread, busy booting). On the main thread it was ~650 ms of boot.
import { buildLand, LAND_BANDS, landNetwork, landSpec, type LandLoop, type LandStyle, type LandTile } from './land'
import { buildWalls, type WallsIn, type WallsOut } from './walls'
import { BIOME } from './terrain'

// The workers, started as this module loads (the first thing the page does): a worker takes a while to start,
// and started only when the land was asked for, the boot waited on that too.
const POOL: Worker[] | null = (() => {
  if (!['desert', 'ice', 'lava', 'forest'].includes(BIOME)) return null
  const W = Math.max(1, Math.min(LAND_BANDS + 1, (navigator.hardwareConcurrency || 4) - 2))
  try { return Array.from({ length: W }, () => new Worker(new URL('./landworker.ts', import.meta.url), { type: 'module' })) } catch { return null }
})()

export function startLand(L: LandLoop, style: LandStyle, wallsIn: WallsIn): Promise<{ tile: LandTile; walls: WallsOut }> {
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
