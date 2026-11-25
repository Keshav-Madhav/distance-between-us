// The launch rule along each line: crest metric (slope − slopeAhead) where slope > 0.02 — at speed hs a launch needs
// metric·hs > LAUNCH_DV + 0.05·hs. Prints the worst stretches.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const here = new URL('.', import.meta.url).pathname
const files = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await page.goto(`http://localhost:4480/?course=canyon&fixed=1`)
await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
for (const f of files) {
  const l = JSON.parse(fs.readFileSync(here + f, 'utf8'))
  const r = await page.evaluate((l) => {
    const G = window.__g.player.ground, out = []
    for (let j = 1; j < l.x.length - 2; j++) {
      const dx = l.x[j + 1] - l.x[j], dz = l.z[j + 1] - l.z[j], len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len
      for (let s = 0; s < len; s += 5) {
        const x = l.x[j] + ux * s, z = l.z[j] + uz * s
        const gA = G(x + ux * 20, z + uz * 20), gB = G(x - ux * 20, z - uz * 20), gC = G(x + ux * 60, z + uz * 60)
        const slope = (gA - gB) / 40, ahead = (gC - gA) / 40
        if (slope > 0.02) out.push([j + l.i0, +(slope - ahead).toFixed(3)])
      }
    }
    return out
  }, l)
  // worst per index
  const byI = {}
  for (const [i, v] of r) byI[i] = Math.max(byI[i] ?? -1, v)
  const ent = Object.entries(byI).map(([i, v]) => [+i, v]).filter((a) => a[1] > 0.03).sort((a, b) => a[0] - b[0])
  console.log(f, 'idx>0.03:', ent.length, ent.filter((a) => a[1] > 0.045).map((a) => a[0] + ':' + a[1]).join(' '))
}
await browser.close()
