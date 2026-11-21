// Vistas: the horizon in each world from the menu flight (title hidden), looking two ways.
//   node tools/vista.mjs [out dir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
const D = (process.argv[2] ?? 'shots/vista') + '/'
mkdirSync(D, { recursive: true })
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 810 } })).newPage()
p.on('pageerror', (e) => console.log('ERR', e.message))
const files = []
for (const c of ['circuit', 'frostline', 'caldera', 'greenway']) {
  await p.goto(`http://localhost:5417/?course=${c}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 }); await p.waitForTimeout(2500)
  await p.evaluate(() => { document.getElementById('title').style.visibility = 'hidden' })
  for (const k of [0, 1]) {
    if (k) { await p.keyboard.down('ArrowLeft'); await p.waitForTimeout(1400); await p.keyboard.up('ArrowLeft'); await p.waitForTimeout(400) }
    const f = `${D}${c}-${k}.png`; await p.screenshot({ path: f }); files.push(f)
  }
}
await b.close()
console.log(files.length, 'shots')
