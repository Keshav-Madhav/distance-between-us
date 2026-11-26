// Builds part of a gorge's land off the main thread (src/landjob.ts): one band of the tile (src/land.ts) —
// its rows, with a halo of rows either side, then the finish over them — or the walls beside the floor
// (src/walls.ts).
import { landBand, type LandLoop, type LandSpec } from './land'
import { buildWalls, type WallsIn } from './walls'

self.onmessage = (e: MessageEvent<{ op: 'band'; L: LandLoop; spec: LandSpec; a: number; e: number } | { op: 'walls'; inp: WallsIn }>) => {
  const d = e.data
  if (d.op === 'walls') {
    const w = buildWalls(d.inp), tr: ArrayBuffer[] = []
    for (const S of w.sides) tr.push(S.y.buffer as ArrayBuffer, S.cv.buffer as ArrayBuffer, S.low.buffer as ArrayBuffer, S.rel.buffer as ArrayBuffer)
    for (const B of w.blocks) for (const a of [B.pos, B.posN, B.crev, B.posQ, B.top, B.topN, B.topC, B.topQ, B.cliff, B.cliffN, B.cliffC, B.cliffQ, B.topCol]) if (a) tr.push(a.buffer as ArrayBuffer)
    ;(self as unknown as Worker).postMessage({ walls: w }, tr)
    return
  }
  const r = landBand(d.L, d.spec, d.a, d.e)
  ;(self as unknown as Worker).postMessage({ a: d.a, ...r }, [r.h.buffer, r.c.buffer])
}
