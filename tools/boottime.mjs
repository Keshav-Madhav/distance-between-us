// Boot phases (main-thread time per step) for a few courses: what a world switch costs.
import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
for (const c of (process.env.COURSES ?? 'sprint,icefall,caldera').split(',')) {
  await p.goto(`http://localhost:${process.env.PORT ?? 4417}/?course=${c}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
  const marks = await p.evaluate(() => window.__boot)
  let prev = marks[0][1]
  console.log(c, marks.slice(1).map(([n, t]) => { const d = t - prev; prev = t; return `${n} ${d.toFixed(0)}` }).join(' · '), `| total ${(marks[marks.length - 1][1] - marks[0][1]).toFixed(0)} ms`)
}
await b.close()
