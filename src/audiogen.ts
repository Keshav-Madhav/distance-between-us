// The sound's generated buffers (src/audio.ts): the reverb's impulse, noise, brown noise, smooth random
// and the afterburner crackle — ~1.2 M samples of maths, built in a worker (src/audioworker.ts) from
// boot. Built inline in Sound.start they were a 150–300 ms freeze, and a world booting behind another
// starts its sound there.
export interface AudioData { sr: number; ir: [Float32Array, Float32Array]; noise: Float32Array; brown: Float32Array; smooth: Float32Array; crackle: [Float32Array, Float32Array] }
export function genAudio(sr: number): AudioData {
  // The space: a generated stereo impulse, exponential decay with a darkening tail.
  const len = Math.floor(sr * 2.6)
  const ir: [Float32Array, Float32Array] = [new Float32Array(len), new Float32Array(len)]
  for (const d of ir) {
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / len
      lp += (Math.random() * 2 - 1 - lp) * (0.9 - t * 0.75)
      d[i] = lp * Math.pow(1 - t, 3.2) * (i < sr * 0.012 ? i / (sr * 0.012) : 1)
    }
  }
  const noise = new Float32Array(sr * 2)
  for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1
  const brown = new Float32Array(sr * 2)
  let last = 0
  for (let i = 0; i < brown.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; brown[i] = last * 3.5 }
  // Smooth random (−1…1, ~8 new values a second, cosine-eased): turbulence for gains and filters —
  // a steady noise loop is what made everything sound generated.
  const smooth = new Float32Array(sr * 8)
  {
    const per = sr / 8
    const pts = Array.from({ length: 65 }, () => Math.random() * 2 - 1); pts[64] = pts[0]
    for (let i = 0; i < smooth.length; i++) {
      const k = Math.floor(i / per), u = (i % per) / per, e = (1 - Math.cos(u * Math.PI)) / 2
      smooth[i] = pts[k] + (pts[k + 1] - pts[k]) * e
    }
  }
  // Crackle: sparse pops — many small, a few big — each a tiny decaying burst. A real afterburner
  // crackles; a chopped noise only buzzes.
  const crackle: [Float32Array, Float32Array] = [new Float32Array(sr * 3), new Float32Array(sr * 3)]
  for (const d of crackle) {
    let i = 0
    while (i < d.length) {
      i += Math.floor((-Math.log(1 - Math.random()) / 70) * sr)
      const big = Math.random() < 0.08
      const a = (big ? 0.7 + Math.random() * 0.3 : Math.random() ** 2 * 0.5)
      const n = Math.floor(sr * (big ? 0.01 + Math.random() * 0.02 : 0.001 + Math.random() * 0.006))
      let lp = 0
      for (let j = 0; j < n && i + j < d.length; j++) {
        lp += ((Math.random() * 2 - 1) - lp) * (big ? 0.35 : 0.8)
        d[i + j] += lp * a * Math.exp((-5 * j) / n)
      }
    }
  }
  return { sr, ir, noise, brown, smooth, crackle }
}
