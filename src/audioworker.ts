// Builds the sound's generated buffers off the main thread (src/audiogen.ts).
import { genAudio } from './audiogen'
self.onmessage = (e: MessageEvent<number>) => {
  const a = genAudio(e.data)
  ;(self as unknown as Worker).postMessage(a, [a.ir[0].buffer, a.ir[1].buffer, a.noise.buffer, a.brown.buffer, a.smooth.buffer, a.crackle[0].buffer, a.crackle[1].buffer])
}
