import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage()
await page.goto('http://localhost:4417/?fixed&q=low'); await page.waitForFunction('window.__g && window.__g.ready')
await page.evaluate(() => { window.__g.start(); window.__g.skipCountdown() })
await page.waitForTimeout(400)
await page.keyboard.down('w')
await page.waitForTimeout(500)
await page.evaluate(() => { const g = window.__g, p = g.player; p.vel.set(Math.sin(p.heading) * 1500, 0, Math.cos(p.heading) * 1500); p.scrapeAt.copy(p.pos); p.startCrash(2.5, -Math.sin(p.heading), -Math.cos(p.heading)) })
for (let i = 0; i < 10; i++) { await page.waitForTimeout(600); console.log(i, await page.evaluate(() => { const g = window.__g; return `crashing=${g.player.crashing} boost=${g.input.c.boost} mach=${g.player.mach.toFixed(2)} throttle=${g.player.throttle.toFixed(2)} dead=${g.player.dead}` })) }
await browser.close()
