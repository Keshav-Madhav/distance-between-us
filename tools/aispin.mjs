// A full autopilot race segment: count spins/flips per racer, track hull and places.
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage()
await page.goto('http://localhost:4417/?fixed&q=low'); await page.waitForFunction('window.__g && window.__g.ready')
await page.evaluate(() => {
  const g = window.__g; window.__spins = {}
  for (const r of g.race.racers) { const prev = r.p.onSpin; r.p.onSpin = (f) => { window.__spins[r.name] = (window.__spins[r.name] || '') + (f ? 'F' : 's') + (r.p.airTime > 0 && !r.p.airborne ? 'L' : '') + ' '; prev && prev(f) } }
  g.start(); g.autopilot(true)
})
for (let t = 0; t < 9; t++) {
  await page.waitForTimeout(8000)
  console.log(await page.evaluate(() => window.__g.race.racers.map((r) => `${r.name}:P${r.place} g${r.passed} ${(r.p.mach).toFixed(1)}M`).join('  ')))
}
console.log('spins', JSON.stringify(await page.evaluate(() => window.__spins)))
await browser.close()
