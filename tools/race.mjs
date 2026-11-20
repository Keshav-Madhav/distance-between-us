// Race harness: start a race, autopilot, screenshots at points, stats.
//   node tools/race.mjs [scene...]   (preview on 4417)
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
const BASE = process.env.URL ?? 'http://localhost:4417/'
mkdirSync('shots', { recursive: true })
const want = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`) })
await page.goto(BASE + '?fixed', { waitUntil: 'domcontentloaded' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 120000 })
await page.waitForTimeout(800)
const wait = (ms) => page.waitForTimeout(ms)
async function shot(name) {
  const s = await page.evaluate(() => window.__g.stats())
  await page.screenshot({ path: `shots/${name}.png` })
  console.log(`shots/${name}.png`, JSON.stringify(s))
}
const scenes = {
  async title() { await wait(1200); await shot('r-title') },
  async grid() { await page.evaluate(() => window.__g.start()); await wait(1600); await shot('r-grid') },
  async go() { await page.evaluate(() => window.__g.autopilot(true)); await wait(3200); await shot('r-go'); await wait(4000); await shot('r-run1') },
  async run() { await wait(8000); await shot('r-run2'); await wait(8000); await shot('r-run3') },
  async jump() {
    await page.evaluate(() => { const g = window.__g; if (g.mode !== 'race') g.start(); g.skipCountdown(); g.autopilot(false) }); await wait(300); await page.evaluate(() => window.__g.toJump(0, 3.4))
    const samples = []
    for (let i = 0; i < 40; i++) { await wait(100); samples.push(await page.evaluate(() => { const s = window.__g.stats(); return `${s.air ? 'A' : 'g'}${s.agl}` })) ; if (i === 9) await shot('r-jump-air') }
    console.log('jump trace', samples.join(' '))
    await shot('r-jump-land')
  },
  async lap() {
    const t0 = Date.now()
    while (Date.now() - t0 < 45000) {
      await wait(5000)
      const s = await page.evaluate(() => { const g = window.__g; const s = g.stats(); return `${(s.mach).toFixed(1)}M hull${s.hull} P${s.place} gates${s.passed} ${s.air ? 'AIR' : ''}` })
      console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', s)
    }
    await shot('r-lap')
  },
  async wall() {
    // Aim at the nearest mesa beside the course and hit it.
    await page.evaluate(() => { const g = window.__g; g.autopilot(false); g.setMach(3) })
    await wait(2500); await shot('r-wall')
  },
}
for (const n of want.length ? want : ['title', 'grid', 'go', 'run', 'jump']) await scenes[n]()
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].slice(0, 15).join('\n'))
await browser.close()
