import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })).newPage()
await page.goto('http://localhost:4417/'); await page.waitForFunction('window.__g && window.__g.ready')
const C = (o) => ({ steer: 0, boost: false, brake: false, strafe: 0, dodgeL: false, dodgeR: false, ...o })
await page.evaluate(() => { const g = window.__g; g.start(); g.skipCountdown() })
await page.waitForTimeout(500)
await page.evaluate((c) => window.__g.force(c), C({ boost: true }))
for (let i = 0; i < 4; i++) { await page.waitForTimeout(900); await page.screenshot({ path: `shots/b${i}.png` }) }
await browser.close()
