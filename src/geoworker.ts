// Builds the world shapes' refined close-up forms and simplified twins off the main thread (src/lod.ts).
import { fromArrays, refinedRaw, simplifiedRaw, toArrays, type GeoArrays } from './geomath'

self.onmessage = async (e: MessageEvent<GeoArrays & { id: number; op: 'refine' | 'simplify'; keep: number }>) => {
  const { id, op, keep } = e.data
  const g = fromArrays(e.data)
  const r = op === 'refine' ? refinedRaw(g) : await simplifiedRaw(g, keep)
  if (!r) { (self as unknown as Worker).postMessage({ id, none: true, attrs: [], index: null }); return }
  const out = toArrays(r, false)
  ;(self as unknown as Worker).postMessage({ id, ...out }, [...out.attrs.map((a) => a[1].buffer), ...(out.index ? [out.index.buffer] : [])])
}
