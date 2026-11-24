// The AUTO governor under an impossible load: a huge window, no fixed quality. It should trim the
// resolution until frames hold the screen's refresh. Prints its state every 2 s.
import { chromium } from 'playwright-core'
import { calm } from './loadguard.mjs'
const port = process.argv[2] ?? '4495', W = +(process.env.W ?? 2560), H = +(process.env.H ?? 1440), DPR = +(process.env.DPR ?? 3)
await calm()
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR })).newPage()
await p.addInitScript(() => { try { localStorage.removeItem('dbu-auto') } catch {} })
await p.goto(`http://localhost:${port}/?course=sprint`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { const g = window.__g; g.start(); g.skipCountdown(); g.autopilot(true) })
for (let i = 0; i < 10; i++) {
  await p.waitForTimeout(2000)
  console.log(await p.evaluate(() => { const s = window.__g.stats(); return `fps ${s.fps} ms ${s.ms} tier ${s.tier} detail ${s.detail} dyn ${s.dyn} scale ${s.scale} mach ${s.mach}` }))
}
await b.close()
