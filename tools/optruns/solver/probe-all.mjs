// dev helper: facts for every course (one browser). node tools/optruns/solver/probe-all.mjs
import { chromium } from 'playwright-core'
const ids = ['sprint','dry-river','drag','circuit','oval','canyon','icecave','magma','whitewater','frostline','icefall','caldera','faultline','greenway','riverrun','whiteout','obsidian','timberline','mistriver','understory']
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const ctx = await browser.newContext({ viewport: { width: 320, height: 180 } })
for (const course of ids) {
  const page = await ctx.newPage(); const t0 = Date.now()
  await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
  await page.goto(`http://localhost:4480/?course=${course}&fixed=1`)
  await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
  const r = await page.evaluate(() => { const g = window.__g, c = g.course; let L = 0; for (let i = c.startI + 1; i <= c.finishI; i++) L += Math.hypot(c.px[i] - c.px[i - 1], c.pz[i] - c.pz[i - 1]); return { n: c.n, K: c.cps.length, gh: c.gateHalf, pads: c.pads.length, mounds: c.mounds.length / 4, laps: c.def?.laps, canyonOn: g.world.canyonOn, km: +(L / 1000).toFixed(1), rocks: c.rocks.length } })
  console.log(course, JSON.stringify(r), 'load', Date.now() - t0, 'ms')
  await page.close()
}
await browser.close()
