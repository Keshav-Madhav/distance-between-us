// Builds one band of a gorge's land tile off the main thread (src/land.ts, src/landjob.ts): its rows, with a
// halo of rows either side, then the finish (erosion, talus) over them; the band's own rows back.
import { landBand, type LandLoop, type LandSpec } from './land'

self.onmessage = (e: MessageEvent<{ L: LandLoop; spec: LandSpec; a: number; e: number }>) => {
  const d = e.data, r = landBand(d.L, d.spec, d.a, d.e)
  ;(self as unknown as Worker).postMessage({ a: d.a, ...r }, [r.h.buffer, r.c.buffer])
}
