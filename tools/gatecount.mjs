// Gates per course (the race screen's count), straight from each built course.
import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 800, height: 500 } })).newPage()
for (const c of (process.env.COURSES ?? 'sprint,dry-river,drag,circuit,oval,canyon,frostline,icefall,caldera,faultline').split(',')) {
  await p.goto(`http://localhost:5417/?course=${c}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
  console.log(c, await p.evaluate(() => window.__g.course.cps.length))
}
await b.close()
