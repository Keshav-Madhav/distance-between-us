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
  async gate() {
    await page.evaluate(() => { const g = window.__g; if (g.mode !== 'race') g.start(); g.skipCountdown(); g.autopilot(false) })
    await wait(300)
    await page.evaluate(() => { const g = window.__g; const c = g.course.cps[3]; g.player.reset(c.x - c.tx * 700, c.z - c.tz * 700, Math.atan2(c.tx, c.tz), 2.2) })
    await wait(650); await shot('r-gate')
  },
  async wall() {
    // Find a mesa near the player and fly straight at it.
    await page.evaluate(() => { const g = window.__g; if (g.mode !== 'race') g.start(); g.skipCountdown(); g.autopilot(false) })
    await wait(300)
    const ok = await page.evaluate(() => {
      const g = window.__g, p = g.player, out = []
      g.world.update(p.pos, 0)
      const n = g.world.near(p.pos.x, p.pos.z, p.pos.y, 6000, out)
      const o = out.slice(0, n).filter((o) => o.big)[0]
      if (!o) return false
      const dx = o.x - p.pos.x, dz = o.z - p.pos.z, d = Math.hypot(dx, dz)
      p.reset(o.x - dx / d * (o.cr + 900), o.z - dz / d * (o.cr + 900), Math.atan2(dx, dz), 2.5)
      return true
    })
    if (!ok) { console.log('no mesa'); return }
    for (let i = 0; i < 50; i++) { await wait(40); const s = await page.evaluate(() => window.__g.stats()); if (s.hull < 100) { await wait(40); await shot('r-wall'); await wait(400); await shot('r-wall2'); return } }
    await shot('r-wall')
  },
}
for (const n of want.length ? want : ['title', 'grid', 'go', 'run', 'jump']) await scenes[n]()
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].slice(0, 15).join('\n'))
await browser.close()
