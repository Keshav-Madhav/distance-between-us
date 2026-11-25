import { chromium } from 'playwright-core'
import fs from 'node:fs'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await page.goto(`http://localhost:4480/?course=canyon&fixed=1`)
await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
const d = await page.evaluate(() => {
  const c = window.__g.course
  const pads = (c.pads ?? []).map((p) => ({ ...p }))
  return { startI: c.startI, finishI: c.finishI, n: c.px.length, px: Array.from(c.px), pz: Array.from(c.pz), cps: c.cps, gateHalf: c.gateHalf, keys: Object.keys(c), jumps: c.def.jumps, padsRaw: JSON.stringify(c.pads ?? c.boostPads ?? null).slice(0, 3000), mounds: Array.from(c.mounds ?? []), rocks: (c.rocks ?? []).length, pads2: JSON.stringify(c.pads).slice(0,4000) }
})
fs.writeFileSync('tools/optruns/agent/canyon/course.json', JSON.stringify(d))
console.log(d.startI, d.finishI, d.n, d.keys, d.cps.length, d.padsRaw.slice(0, 500), d.mounds, d.rocks, d.pads2)
await browser.close()
