// Handling tests: scripted inputs on open ground (Hunt mode, no rivals), traces of slip / yaw / spin.
//   node tools/handling.mjs   (preview on 4417)
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage()
await page.goto('http://localhost:4417/?fixed&q=low'); await page.waitForFunction('window.__g && window.__g.ready')
const C = (o) => ({ steer: 0, boost: false, brake: false, strafe: 0, dodgeL: false, dodgeR: false, ...o })
async function run(name, mach, steps) {
  await page.evaluate((m) => { const g = window.__g; g.startHunt(); g.combat.enabled = false; g.player.reset(0, 0, 0, m); g.player.noCollide = true; g.CFG.speed.cruiseMach = m }, mach)
  const out = []
  for (const [ms, ctl] of steps) {
    await page.evaluate((c) => window.__g.force(c), ctl)
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      await page.waitForTimeout(200)
      out.push(await page.evaluate(() => { const s = window.__g.stats(); return `${s.mach.toFixed(1)}M slip${s.slip.toFixed(0)} yaw${s.yaw.toFixed(2)}${s.spin > 0 ? ' SPIN' : ''}${s.drift > 0 ? ' d' + s.drift.toFixed(1) : ''}${s.air ? ' AIR' : ''}` }))
    }
  }
  console.log(`\n${name}\n  ` + out.join('\n  '))
}
await run('A: Mach 2, full right held 3 s', 2, [[3000, C({ steer: 1 })]])
await run('B: Mach 5, full right held 4 s', 5, [[4000, C({ steer: 1, boost: true })]])
await run('C: Mach 4, brake+steer 1.4 s, then straighten', 4, [[1400, C({ steer: 1, brake: true })], [600, C({ steer: -0.4 })], [1400, C({})]])
await run('D: Mach 5, brake+steer held 3 s', 5, [[3000, C({ steer: 1, brake: true })]])
await run('E: Mach 5, full right 2 s then countersteer', 5, [[2000, C({ steer: 1, boost: true })], [1200, C({ steer: -0.6, boost: true })]])
await page.evaluate(() => window.__g.force(null))
await browser.close()
