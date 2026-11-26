// A gorge's land tile (src/land.ts), built at boot in workers while the rest of the page boots: a fixed number
// of bands of rows (the same land on every machine), each built whole — rows, halo and finish — in a worker,
// all posted at once (a job handed out only when the last came back waited on the main thread, busy booting).
// (On the main thread it was ~650 ms of boot.)
import { buildLand, LAND_BANDS, landNetwork, landSpec, type LandLoop, type LandStyle, type LandTile } from './land'

export function startLand(L: LandLoop, style: LandStyle): Promise<LandTile> {
  const spec = landSpec(L, style)
  const W = Math.max(1, Math.min(LAND_BANDS, (navigator.hardwareConcurrency || 4) - 2))
  let workers: Worker[]
  try { workers = Array.from({ length: W }, () => new Worker(new URL('./landworker.ts', import.meta.url), { type: 'module' })) }
  catch { return Promise.resolve(buildLand(L, style)) }
  return new Promise<LandTile>((resolve) => {
    const N = spec.nx * spec.nz, h = new Float32Array(N), c = new Float32Array(N), bh = Math.ceil(spec.nz / LAND_BANDS)
    let left = 0, failed = false
    const finish = () => { for (const w of workers) w.terminate() }
    for (const w of workers) {
      w.onerror = () => { if (failed) return; failed = true; finish(); resolve(buildLand(L, style)) }
      w.onmessage = (e: MessageEvent<{ a: number; h: Float32Array; c: Float32Array }>) => {
        h.set(e.data.h, e.data.a * spec.nx); c.set(e.data.c, e.data.a * spec.nx)
        if (--left === 0 && !failed) { finish(); resolve({ ...spec, h, c, open: landNetwork(L, style).open }) }
      }
    }
    for (let b = 0; b < LAND_BANDS; b++) {
      const a = b * bh, e = Math.min(spec.nz, a + bh)
      if (a >= e) continue
      left++
      workers[b % W].postMessage({ L, spec, a, e })
    }
  })
}
