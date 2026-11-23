// Every ship from eight angles (front, side, top, below, two three-quarters, rear, close nose),
// one PNG each, for critique.  OUT=dir node tools/critshots.mjs [ships e.g. 0,1,2]
import { chromium } from 'playwright-core'
const OUT = process.env.OUT, ships = (process.argv[2] ?? '0,1,2,3,4,5').split(',')
const V = {
  front: '0,0.7,14,0,0.5,0', side: '14,0.9,0,0,0.5,0', top: '0,17,0.01,0,0,0', below: '0,-17,0.01,0,0,0&noground',
  q34f: '8,3.4,9,0,0.5,0', q34r: '-8,3.4,-9,0,0.5,-1', rear: '0,1.6,-13,0,0.6,0', nose: '3.5,1.2,7.5,0,0.4,3',
}
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 })).newPage()
for (const m of ships) for (const [k, c] of Object.entries(V)) {
  await p.goto(`http://localhost:5417/showroom.html?only=${m}&cam=${c}`)
  await p.waitForFunction('window.ready', null, { timeout: 60000 }); await p.waitForTimeout(250)
  await p.screenshot({ path: `${OUT}/s${m}-${k}.png` })
  if (k === 'front') console.log('ship', m, 'triangles in view', await p.evaluate('window.tris'))
}
await b.close(); console.log('done')
