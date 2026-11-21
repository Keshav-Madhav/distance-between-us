import { chromium } from 'playwright-core'
import sharp from 'sharp'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
await page.goto('http://localhost:4417/?fixed'); await page.waitForFunction('window.__g && window.__g.ready')
await page.evaluate(() => { window.__g.start(); document.getElementById('hud').style.display = 'none' })
async function specks(label) {
  const { data, info } = await sharp(await page.screenshot()).raw().toBuffer({ resolveWithObject: true })
  const L = (x, y) => { const i = (y * info.width + x) * info.channels; return data[i] + data[i + 1] + data[i + 2] }
  let n = 0; const at = []
  for (let y = 3; y < info.height - 3; y++) for (let x = 3; x < info.width - 3; x++) {
    if (L(x, y) > 30) continue
    if (L(x - 3, y) > 240 && L(x + 3, y) > 240 && L(x, y - 3) > 240 && L(x, y + 3) > 240) { n++; if (at.length < 5) at.push(`${x},${y}`) }
  }
  console.log(label.padEnd(20), 'isolated black specks:', n, at.join(' '))
}
for (let i = 0; i < 3; i++) { await page.waitForTimeout(700); await specks('grid ' + i) }
await page.evaluate(() => { const g = window.__g; g.skipCountdown(); g.autopilot(true) })
for (let i = 0; i < 6; i++) { await page.waitForTimeout(1500); await specks('racing ' + i) }
await browser.close()
