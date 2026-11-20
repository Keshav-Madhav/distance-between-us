// Screenshot + perf harness (headless Chrome on the real GPU, muted).
//   npm run preview   (port 4417), then:  node tools/shot.mjs [scene ...]
// Scenes drive the game through window.__g; each logs __g.stats().
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const BASE = process.env.URL ?? 'http://localhost:4417/'
const OUT = process.env.SHOTS ?? 'shots'
mkdirSync(OUT, { recursive: true })
const want = process.argv.slice(2)

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`) })
await page.goto(BASE + (process.env.Q ?? '?fixed'), { waitUntil: 'domcontentloaded' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 120000 })
await page.waitForTimeout(800)

const wait = (ms) => page.waitForTimeout(ms)
async function shot(name) {
  const s = await page.evaluate(() => window.__g.stats())
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`${OUT}/${name}.png`, JSON.stringify(s))
}

const scenes = {
  async title() { await wait(1500); await shot('title') },
  async launch() {
    await page.evaluate(() => { window.__g.startHunt(); window.__g.autopilot(true) })
    await wait(1200); await shot('launch')
    await wait(5000); await shot('cruise')
  },
  async speed() {
    await page.evaluate(() => { window.__g.setMach(4.6) })
    await wait(1500); await shot('mach5')
  },
  async combat() {
    await wait(9000); await shot('combat')
  },
  async walker() {
    await page.evaluate(() => window.__g.walkerNear())
    await wait(2500); await shot('walker')
    await wait(3000); await shot('walker2')
  },
  async fall() {
    await page.evaluate(() => window.__g.killCores())
    await wait(2500); await shot('falling')
    await wait(4000); await shot('down')
  },
  async walkerview() {
    await page.evaluate(() => { const g = window.__g; g.startHunt(); g.autopilot(false); g.CFG.speed.cruiseMach = 1.2; g.setMach(1.2); g.walkerNear() })
    await wait(2500); await shot('walkerview')
    await page.evaluate(() => window.__g.killCores())
    await wait(2200); await shot('wfall')
    await wait(3500); await shot('wdown')
  },
  async fps() {
    // Sample frame times for 5 s.
    const r = await page.evaluate(() => new Promise((res) => {
      const t = []; let last = performance.now(); const end = last + 5000
      const f = (now) => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else res(t) }
      requestAnimationFrame(f)
    }))
    r.sort((a, b) => a - b)
    const avg = r.reduce((a, b) => a + b, 0) / r.length
    console.log(`frames ${r.length}  avg ${avg.toFixed(2)} ms  p50 ${r[r.length >> 1].toFixed(2)}  p95 ${r[Math.floor(r.length * 0.95)].toFixed(2)}  p99 ${r[Math.floor(r.length * 0.99)].toFixed(2)}`, JSON.stringify(await page.evaluate(() => window.__g.stats())))
  },
}
for (const name of want.length ? want : ['title', 'launch', 'speed', 'combat', 'fps', 'walker', 'fall']) await scenes[name]()
if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 20).join('\n'))
await browser.close()
