// The title menu in every world, two window sizes, and the HUNT tab.
//   node tools/menushots.mjs <out dir>
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
const D = (process.argv[2] ?? 'shots/menu') + '/'
mkdirSync(D, { recursive: true })
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
for (const [w, h] of [[1440, 900], [1280, 720]]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage()
  p.on('pageerror', (e) => console.log('ERR', e.message))
  for (const c of ['circuit', 'icefall', 'caldera']) {
    await p.goto(`http://localhost:${process.env.PORT ?? 5417}/?course=${c}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 }); await p.waitForTimeout(2500)
    await p.screenshot({ path: `${D}${w}-${c}.png` })
  }
  await p.click('.tabs button[data-mode=hunt]'); await p.waitForTimeout(600)
  await p.screenshot({ path: `${D}${w}-hunt.png` })
  await p.click('#open-settings'); await p.waitForTimeout(600)
  await p.screenshot({ path: `${D}${w}-settings.png` })
}
await b.close()
console.log('ok')
