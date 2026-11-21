import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errs = []; page.on('pageerror', (e) => errs.push(e.message))
await page.goto('http://localhost:4417/?fixed'); await page.waitForFunction('window.__g && window.__g.ready')
await page.evaluate(() => { const g = window.__g; g.start(); g.skipCountdown() })
await page.waitForTimeout(300)
await page.evaluate(() => {
  const g = window.__g, K = g.course.cps.length, me = g.race.racers[0], c = g.course.cps[K - 1]
  g.player.reset(c.x - c.tx * 1500, c.z - c.tz * 1500, Math.atan2(c.tx, c.tz), 4)
  me.passed = K - 1; me.next = K - 1; me.idx = c.i - 37
  g.force({ steer: 0, boost: true, brake: false, strafe: 0, dodgeL: false, dodgeR: false })
})
await page.waitForTimeout(800)
await page.evaluate(() => window.__g.force(null))
const shots = []
for (let i = 0; i < 6; i++) { await page.waitForTimeout(1500); await page.screenshot({ path: `shots/f${i}.png` }); shots.push(await page.evaluate(() => `fin=${window.__g.race.racers[0].finished} mach=${window.__g.player.mach.toFixed(1)}`)) }
console.log(shots.join(' | '))
await page.keyboard.press('Escape')
await page.waitForTimeout(800); await page.screenshot({ path: 'shots/f-esc.png' })
console.log(errs.join('\n') || 'no errors')
await browser.close()
