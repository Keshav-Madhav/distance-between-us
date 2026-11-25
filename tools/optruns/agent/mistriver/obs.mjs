import { chromium } from 'playwright-core'
import fs from 'node:fs'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await page.goto(`http://localhost:4480/?course=mistriver&fixed=1`)
await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
const r = await page.evaluate(() => {
  const w = window.__g.world
  const fixed = (w.fixed || []).map((it) => [Math.round(it.x), Math.round(it.z), Math.round(it.r), Math.round(it.h), Math.round(it.by), it.big ?? true])
  const wr = (w.wrapped || []).map((x) => ({ big: x.big, n: x.items.length, keys: Object.keys(x).slice(0, 20), sample: x.items.slice(0, 3).map((it) => ({ x: it.x, z: it.z, r: it.r, h: it.h, grow: it.grow })) }))
  return { fixed, wr, vis: w.courseRocks && w.courseRocks.visible }
})
fs.writeFileSync('tools/optruns/agent/mistriver/obs.json', JSON.stringify(r))
console.log(r.fixed.length, r.vis, JSON.stringify(r.wr).slice(0, 3000))
await browser.close()
