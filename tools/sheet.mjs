// Contact sheet of shots: node tools/sheet.mjs out.jpg a b c d ...
import sharp from 'sharp'
const [out, ...names] = process.argv.slice(2)
const W = 640, H = 360, cols = 2
const tiles = await Promise.all(names.map((n) => sharp(`shots/${n}.png`).resize(W, H).toBuffer()))
await sharp({ create: { width: W * cols, height: H * Math.ceil(names.length / cols), channels: 3, background: '#000' } })
  .composite(tiles.map((b, i) => ({ input: b, left: (i % cols) * W, top: Math.floor(i / cols) * H }))).jpeg({ quality: 85 }).toFile(out)
