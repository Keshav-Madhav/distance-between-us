import { chromium } from 'playwright-core'
import fs from 'node:fs'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await page.goto(`http://localhost:4480/?course=mistriver&fixed=1`)
await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
const r = await page.evaluate(() => {
  const g = window.__g, c = g.course
  g.hold(true); g.replayWith([0,0,1]); g.skipCountdown(); g.hold(true)
  const P = g.player
  return { n: c.px.length, startI: c.startI, finishI: c.finishI, gateHalf: c.gateHalf, K: g.race.K,
    cps: c.cps.map((q) => ({ x: q.x, z: q.z, tx: q.tx, tz: q.tz, i: q.i })),
    px: Array.from(c.px).filter((_, i) => i % 5 === 0), pz: Array.from(c.pz).filter((_, i) => i % 5 === 0),
    player: { x: P.pos.x, z: P.pos.z, h: P.heading, sp: P.speed }, keys: Object.keys(c).slice(0, 60), def: Object.keys(c.def) }
})
fs.writeFileSync('tools/optruns/agent/mistriver/course.json', JSON.stringify(r))
console.log(JSON.stringify({ ...r, px: r.px.length, pz: undefined }))
await browser.close()
