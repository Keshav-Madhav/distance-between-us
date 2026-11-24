// A fingerprint of the world's placed shapes (every landform, boulder and clutter item: where, how big,
// how turned) — two builds that should make the same world must print the same hashes.
//   node tools/worldhash.mjs 4498,4495
import { chromium } from 'playwright-core'
import { calm } from './loadguard.mjs'
const ports = (process.argv[2] ?? '4495').split(',')
await calm()
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
for (const c of ['sprint', 'frostline', 'caldera', 'greenway', 'mistriver']) {
  const row = []
  for (const port of ports) {
    const p = await (await b.newContext()).newPage()
    await p.goto(`http://localhost:${port}/?course=${c}&fixed=1`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
    row.push(await p.evaluate(() => { let h = 2166136261, n = 0
      const mix = (v) => { h ^= Math.round(v * 1000) | 0; h = Math.imul(h, 16777619) }
      for (const w of window.__g.world.wrapped) { mix(w.items.length); for (const it of w.items) { mix(it.ox); mix(it.oz); mix(it.r); mix(it.h); mix(it.yaw); n++ } }
      return `${n} items #${(h >>> 0).toString(16)}` }))
    await p.context().close()
  }
  console.log(c.padEnd(10), row.join('  |  '), row.every((x) => x === row[0]) ? 'SAME' : 'DIFFERENT')
}
await b.close()
