// Tips: a fresh browser (nothing seen), a course on autopilot; logs every tip as it appears.
//   COURSE=dry-river SECS=60 node tools/tipshots.mjs
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
mkdirSync('shots/tips', { recursive: true })
const C = process.env.COURSE ?? 'sprint', S = +(process.env.SECS ?? 40)
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
p.on('pageerror', (e) => console.log('ERR', e.message))
await p.goto(`http://localhost:5417/?course=${C}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate((hunt) => { const g = window.__g; if (hunt) g.startHunt(); else { g.start(); g.skipCountdown() } g.autopilot(true) }, C === 'hunt')
let last = '', n = 0
const t0 = Date.now()
while ((Date.now() - t0) / 1000 < S) {
  const t = await p.evaluate(() => { const e = document.querySelector('#tip'); return e.classList.contains('on') ? e.textContent : '' })
  if (t && t !== last) { console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s  ${t}`); if (n++ < 2) await p.screenshot({ path: `shots/tips/${C}-${n}.png` }) }
  last = t
  await p.waitForTimeout(400)
}
await b.close()
