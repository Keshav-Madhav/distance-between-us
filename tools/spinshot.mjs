// A spin-out filmed: frames every 250 ms, plus the race HUD (gauge, minimap, tags, worn line).
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) }); page.on('pageerror', (e) => errs.push(e.message))
await page.goto('http://localhost:4417/?fixed'); await page.waitForFunction('window.__g && window.__g.ready')
const C = (o) => ({ steer: 0, boost: false, brake: false, strafe: 0, dodgeL: false, dodgeR: false, ...o })
await page.evaluate(() => { const g = window.__g; g.start() })
await page.waitForTimeout(1500); await page.screenshot({ path: 'shots/s-grid.png' })
await page.evaluate(() => { const g = window.__g; g.skipCountdown(); g.autopilot(true) })
await page.waitForTimeout(9000); await page.screenshot({ path: 'shots/s-race.png' })
await page.evaluate((c) => { const g = window.__g; g.autopilot(false); g.force(c) }, C({ boost: true, steer: 0.6 }))
await page.waitForTimeout(700); await page.screenshot({ path: 'shots/s-gauge.png' })
await page.evaluate(() => { const p = window.__g.player; p.noCollide = true; p.slip = -1.3; p.startSpin(false) })
for (let i = 0; i < 6; i++) { await page.waitForTimeout(260); await page.screenshot({ path: `shots/s-spin${i}.png` }) }
console.log(errs.slice(0, 5).join('\n') || 'no errors')
await browser.close()
