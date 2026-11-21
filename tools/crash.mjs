import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
await page.goto('http://localhost:4417/?fixed'); await page.waitForFunction('window.__g && window.__g.ready')
await page.evaluate(() => { const g = window.__g; g.start(); g.skipCountdown() })
await page.waitForTimeout(400)
await page.evaluate(() => {
  const g = window.__g, p = g.player, rk = g.course.rocks[3]
  const dx = 900, h = Math.atan2(g.course.px[rk.i + 2] - g.course.px[rk.i - 2], g.course.pz[rk.i + 2] - g.course.pz[rk.i - 2])
  p.reset(rk.x - Math.sin(h) * dx, rk.z - Math.cos(h) * dx, h, 4.5)
  g.race.racers[0].idx = rk.i - 22
  g.force({ steer: 0, boost: true, brake: false, strafe: 0, dodgeL: false, dodgeR: false })
})
const log = []
for (let i = 0; i < 9; i++) {
  await page.waitForTimeout(i === 0 ? 450 : 380)
  const s = await page.evaluate(() => window.__g.stats())
  log.push(`${i}: crashing=${s.crashing} mach=${s.mach} hull=${s.hull} agl=${s.agl}`)
  await page.screenshot({ path: `shots/c${i}.png` })
}
console.log(log.join('\n'))
console.log(errs.slice(0, 5).join('\n') || 'no errors')
await browser.close()
