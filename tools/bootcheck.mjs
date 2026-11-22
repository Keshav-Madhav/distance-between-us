// Boot every world on the dev server (strict TDZ) with saved settings present; report any page error.
import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } })
await ctx.addInitScript(() => { try { localStorage.setItem('dbu-settings', JSON.stringify({ invp: true, rs: false, shadows: true, tipson: true })) } catch {} })
const p = await ctx.newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
for (const c of ['sprint', 'frostline', 'caldera', 'greenway']) {
  await p.goto(`http://localhost:5417/?course=${c}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 }); await p.waitForTimeout(800)
  const failed = await p.evaluate(() => document.querySelector('#loading .t')?.textContent ?? '')
  console.log(c, failed.includes('FAILED') ? 'LOAD FAILED' : 'ok')
}
console.log(errs.length ? errs.slice(0, 5).join('\n') : 'no errors')
await b.close()
