// Builds every ship model's geometry off the main thread (see src/shipbuild.ts).
import { buildModelArrays } from './shipbuild'

self.onmessage = (e: MessageEvent<number[]>) => {
  for (const model of e.data) {
    const m = buildModelArrays(model)
    const transfer: Transferable[] = []
    for (const list of [m.hi, m.lo]) for (const [, p, n] of list) transfer.push(p.buffer, n.buffer)
    ;(self as unknown as Worker).postMessage(m, transfer)
  }
}
