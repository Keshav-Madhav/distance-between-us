import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errs = []; page.on('pageerror', (e) => errs.push(e.message))
await page.goto('http://localhost:4417/?fixed&q=medium'); await page.waitForFunction('window.__g && window.__g.ready')
await page.evaluate(() => { window.__g.startHunt(); window.__g.autopilot(true) })
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(6000)
  console.log(await page.evaluate(() => { const c = window.__g.combat; return `wave ${c.wave} left ${c.left()} kills ${c.kills} runners ${c.drones.filter((d) => d.alive && d.mode === 'run').length} walker ${window.__g.walker.state}` }))
  if (i === 2) await page.screenshot({ path: 'shots/h-wave.png' })
}
console.log(errs.join('\n') || 'no errors')
await browser.close()
