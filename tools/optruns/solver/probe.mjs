// dev helper: course facts + sim speed. node tools/optruns/solver/probe.mjs <course>
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const course = process.argv[2]
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await page.goto(`http://localhost:4480/?course=${course}&fixed=1`)
await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
await page.addScriptTag({ content: fs.readFileSync('tools/pdcore.js', 'utf8') })
await page.evaluate((craft) => { window.makePD(null, craft, { look: 1.2, margin: 34, reach: 3, burnK: 1.2, burnErr: 0.1, latV: 150, airAlign: true, sweep: true, strafeK: 20, slow: true, brakeAt: 0.35, tapNear: 35, tapFar: 70 }) }, JSON.parse(fs.readFileSync('tools/optruns/craft-model.json', 'utf8')))
const r = await page.evaluate(() => {
  const g = window.__g, c = g.course, P = g.player
  g.hold(true); g.replayWith([0, 0, 1]); g.skipCountdown(); g.hold(true)
  const t0 = performance.now(); let n = 0
  for (; n < 600; n++) { g.force({ steer: 0, strafe: 0, boost: true, burner: n > 2, brake: false, dodgeL: false, dodgeR: false }); g.fastSim(1 / 60) }
  const t1 = performance.now(); const s = g.snap(); const t2 = performance.now(); for (let i = 0; i < 20; i++) g.restore(s); const t3 = performance.now()
  return { n: c.n, startI: c.startI, finishI: c.finishI, K: c.cps.length, gi: c.cps.map((q) => q.i), gateHalf: c.gateHalf, pads: c.pads.length, mounds: c.mounds.length / 4, laps: c.laps ?? c.def?.laps, canyon: !!g.world.canyon, canyonOn: g.world.canyonOn, msPerStep: (t1 - t0) / n, snapMs: t2 - t1, restoreMs: (t3 - t2) / 20, mach: P.speed / 343, keys: Object.keys(c).slice(0, 60) }
})
console.log(JSON.stringify(r))
await browser.close()
