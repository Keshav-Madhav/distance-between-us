// dev helper: does re-running in the same page reproduce a fresh page's run? node reusetest.mjs <course> <prm-json>
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const [course, pj] = process.argv.slice(2)
const prm = JSON.parse(pj)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await page.goto(`http://localhost:4480/?course=${course}&fixed=1`)
await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
await page.addScriptTag({ content: fs.readFileSync('tools/pdcore.js', 'utf8') })
await page.evaluate((craft) => { window.makePD(null, craft, { look: 1.2, margin: 34, reach: 3, burnK: 1.2, burnErr: 0.1, latV: 150, airAlign: true, sweep: true, strafeK: 20, slow: true, brakeAt: 0.35, tapNear: 35, tapFar: 70 }) }, JSON.parse(fs.readFileSync('tools/optruns/craft-model.json', 'utf8')))
await page.addScriptTag({ content: fs.readFileSync('tools/optruns/solver/core.js', 'utf8') })
for (const p of [prm, { ...prm, la: (prm.la ?? 0.18) + 0.03 }, prm, { ...prm, mpc: { D: 6, H: 30, aims: [0, 40], burns: [-1, 1] }, maxT: 15 }, prm]) {
  const r = await page.evaluate(async (p) => { const r = await window.SOLV.run(p); return { time: r.time, missed: r.missed, maxLat: r.maxLat, n: r.steps.length, h: r.steps.flat().reduce((a, x, i) => a + x * ((i % 7) + 1), 0) } }, p)
  console.log(JSON.stringify(r))
}
await browser.close()
