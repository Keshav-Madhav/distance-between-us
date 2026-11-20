import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage()
await page.goto('http://localhost:4417/?fixed'); await page.waitForFunction('window.__g && window.__g.ready')
await page.evaluate(() => { window.__g.start(); window.__g.autopilot(true) })
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(500)
  const s = await page.evaluate(() => {
    const g = window.__g, p = g.player
    const cam = document.querySelector('canvas') && window.__g
    return `mach=${p.mach.toFixed(2)} air=${p.airborne} agl=${p.agl.toFixed(1)} ghost=${p.ghost.toFixed(1)} dead=${p.dead} bank=${p.bank.toFixed(2)} pitch=${p.pitch.toFixed(2)} y=${p.pos.y.toFixed(1)}`
  })
  console.log(i, s)
  if (i >= 6 && i <= 9) await page.screenshot({ path: `shots/vis${i}.png` })
}
await browser.close()
