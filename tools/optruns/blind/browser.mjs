// Shared: one headless Chrome on the served game (port 4480), a course loaded and warmed exactly as the judge
// warms it (the race started, countdown skipped, held, the world swept end to end so every obstacle is built).
import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export async function waitLoad(limit = 90) {
  for (;;) {
    const l1 = +execSync('sysctl -n vm.loadavg').toString().trim().replace(/[{}]/g, '').trim().split(/\s+/)[0]
    if (l1 <= limit) return l1
    console.error(`load ${l1} > ${limit}, waiting 60 s`); await sleep(60000)
  }
}
export async function openBrowser() {
  await waitLoad()
  return chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
}
export async function openCourse(browser, course, port = process.env.PORT ?? '4480') {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 180 } })
  const page = await ctx.newPage()
  await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
  await page.goto(`http://localhost:${port}/?course=${course}&fixed=1`)
  await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
  await page.evaluate(() => {
    const g = window.__g, c = g.course, P = g.player
    g.start(); g.skipCountdown(); g.hold(true)
    const cam = P.pos.clone()
    for (let j = c.startI; j <= c.finishI; j += 3) { cam.set(c.px[j], 0, c.pz[j]); g.world.update(cam, 0) }
  })
  return { page, ctx }
}
