// Crest map: for each centreline index and lateral offset, the worst launch metric (slope − slopeAhead, slope > 0.02)
// for travel along the centreline tangent, within ±20 m along.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await page.goto(`http://localhost:4480/?course=canyon&fixed=1`)
await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
const r = await page.evaluate(() => {
  const g = window.__g, c = g.course, G = g.player.ground, out = {}
  for (let i = 50; i < 1975; i++) {
    const [tx, tz] = c.tangent(i), row = []
    for (let o = -1700; o <= 1700; o += 50) {
      let w = 0
      for (let s = -20; s < 20; s += 5) {
        const x = c.px[i] + tz * o + tx * s, z = c.pz[i] - tx * o + tz * s
        const gA = G(x + tx * 20, z + tz * 20), gB = G(x - tx * 20, z - tz * 20), gC = G(x + tx * 60, z + tz * 60)
        const slope = (gA - gB) / 40
        if (slope > 0.02) w = Math.max(w, slope - (gC - gA) / 40)
      }
      row.push(+w.toFixed(3))
    }
    out[i] = row
  }
  return out
})
fs.writeFileSync(new URL('./crest.json', import.meta.url), JSON.stringify(r))
await browser.close()
