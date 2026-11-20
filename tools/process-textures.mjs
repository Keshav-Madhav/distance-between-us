// assets/raw/*.jpg → public/tex/*.jpg: made seamless, power-of-two, verified by tiling.
//
// Seamless: O = the image rolled by half (its EDGES wrap perfectly; its seam is a cross in the
// middle). Out = mix(O, I, mask), mask 0 at the edges and 1 in the middle, so the edges come from O
// (seamless) and the middle from I (no seam there either).
//   node tools/process-textures.mjs
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const JOBS = [
  { name: 'sand', size: 2048 },
  { name: 'rock', size: 2048, horizontalOnly: true },
  { name: 'clay', size: 1024 },
  { name: 'gravel', size: 1024 },
]
mkdirSync('public/tex', { recursive: true })
mkdirSync('assets/check', { recursive: true })

for (const job of JOBS) {
  const { data, info } = await sharp(`assets/raw/${job.name}.jpg`).resize(job.size, job.size).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height, C = info.channels
  const out = Buffer.alloc(data.length)
  const band = 0.22 // fraction of the size over which the blend happens
  const sm = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = Math.min(x, W - 1 - x) / W
      const dy = Math.min(y, H - 1 - y) / H
      // (Rock: across only. Blending its strata vertically ghosts the bands; the game mirror-wraps it
      // vertically instead, which strata take well.)
      const m = sm(0, band, dx) * (job.horizontalOnly ? 1 : sm(0, band, dy))
      const ox = (x + W / 2) % W, oy = job.horizontalOnly ? y : (y + H / 2) % H
      const i = (y * W + x) * C, o = (oy * W + ox) * C
      for (let c = 0; c < C; c++) out[i + c] = Math.round(data[o + c] * (1 - m) + data[i + c] * m)
    }
  }
  await sharp(out, { raw: { width: W, height: H, channels: C } }).jpeg({ quality: 86, mozjpeg: true }).toFile(`public/tex/${job.name}.jpg`)
  // Verification sheet: 2×2 tiling at half size; seams would show as a cross.
  const half = await sharp(out, { raw: { width: W, height: H, channels: C } }).resize(512, 512).jpeg().toBuffer()
  await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#000' } })
    .composite([{ input: half, left: 0, top: 0 }, { input: half, left: 512, top: 0 }, { input: half, left: 0, top: 512 }, { input: half, left: 512, top: 512 }])
    .jpeg().toFile(`assets/check/${job.name}-tiled.jpg`)
  // Mean colour (linear), for the shader's distance fade.
  let r = 0, g = 0, b = 0
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  for (let i = 0; i < out.length; i += C * 16) { r += lin(out[i]); g += lin(out[i + 1]); b += lin(out[i + 2]) }
  const n = out.length / (C * 16)
  console.log(`${job.name}: ${W}² → public/tex/${job.name}.jpg  mean linear (${(r / n).toFixed(3)}, ${(g / n).toFixed(3)}, ${(b / n).toFixed(3)})`)
}
await sharp('assets/raw/keyart.jpg').resize(1920).jpeg({ quality: 84, mozjpeg: true }).toFile('public/keyart.jpg')
console.log('keyart → public/keyart.jpg')
