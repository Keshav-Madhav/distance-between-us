import { chromium } from 'playwright-core'
import fs from 'node:fs'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await page.goto(`http://localhost:4480/?course=canyon&fixed=1`)
await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
const r = await page.evaluate(() => {
  const g = window.__g, c = g.course, P = g.player, out = {}
  for (let i = 60; i < 1970; i += 2) {
    const [tx, tz] = c.tangent(i), row = []
    for (let o = -1800; o <= 1800; o += 25) row.push(+P.ground(c.px[i] + tz * o, c.pz[i] - tx * o).toFixed(1))
    out[i] = row
  }
  return out
})
fs.writeFileSync(new URL('./ground.json', import.meta.url), JSON.stringify(r))
await browser.close()
