// The player's craft driven by the AI brain inside the game loop (60 Hz, no bot latency) for a whole
// race: does the course + physics allow a clean run? Counts crashes, spins, missed gates.
//   node tools/autorace.mjs [url]
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage()
page.on('pageerror', (e) => console.log('ERR', e.message))
await page.goto(process.argv[2] ?? 'http://localhost:4417/?fixed&q=low'); await page.waitForFunction('window.__g && window.__g.ready')
await page.evaluate(() => {
  const g = window.__g, p = g.player
  window.__ev = { crash: 0, spin: 0, wasC: false, wasS: false }
  setInterval(() => {
    const e = window.__ev
    if (p.crashing && !e.wasC) e.crash++
    if (p.spin > 0 && !e.wasS) e.spin++
    e.wasC = p.crashing; e.wasS = p.spin > 0
  }, 16)
  g.start(); g.skipCountdown(); g.autopilot(true)
})
const t0 = Date.now()
while (Date.now() - t0 < 200000) {
  await page.waitForTimeout(2000)
  if (await page.evaluate(() => window.__g.race.racers[0].finished)) break
}
console.log(await page.evaluate(() => { const g = window.__g, me = g.race.racers[0]; return `finished=${me.finished} P${me.place} time=${me.finishTime?.toFixed(1)}s crashes=${window.__ev.crash} spins=${window.__ev.spin}` }))
await browser.close()
