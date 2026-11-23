// The views a player actually sees: from behind. Six rear angles per ship (showroom) plus a live
// chase shot.  OUT=dir node tools/rearshots.mjs [ships]
import { chromium } from 'playwright-core'
const OUT = process.env.OUT, ships = (process.argv[2] ?? '0,1,2,3,4,5').split(',')
const V = {
  chase: '0,3.0,-12,0,0.9,1', high: '0,6,-9,0,0.5,0', low: '0,0.9,-11,0,0.7,0',
  left: '-5,2.6,-10,0,0.8,0', right: '5,2.6,-10,0,0.8,0', close: '1.6,2.5,-6,0,1.0,1',
}
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 1000, height: 640 } })).newPage()
for (const m of ships) for (const [k, c] of Object.entries(V)) {
  await p.goto(`http://localhost:5417/showroom.html?only=${m}&cam=${c}`)
  await p.waitForFunction('window.ready', null, { timeout: 60000 }); await p.waitForTimeout(250)
  await p.screenshot({ path: `${OUT}/r${m}-${k}.png` })
}
await b.close()
for (const m of ships) {
  const b2 = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
  const ctx = await b2.newContext({ viewport: { width: 1000, height: 640 } })
  await ctx.addInitScript((s) => localStorage.setItem('dbu-ship', s), m)
  const q = await ctx.newPage()
  await q.goto('http://localhost:5417/'); await q.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
  await q.click('#start'); await q.waitForTimeout(4500)
  await q.keyboard.down('KeyW'); await q.keyboard.down('ShiftLeft'); await q.waitForTimeout(2500)
  await q.screenshot({ path: `${OUT}/r${m}-race.png`, clip: { x: 250, y: 300, width: 500, height: 300 } })
  await b2.close()
}
console.log('done')
