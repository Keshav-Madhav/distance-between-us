// Screenshots of one course's world: the menu, the race at a few moments (autopilot), and FREE ROAM
// from up high. COURSE=id OUT=dir.
import { chromium } from 'playwright-core'
const OUT = process.env.OUT, C = process.env.COURSE ?? 'mistriver'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
await p.goto(`http://localhost:5417/?course=${C}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.waitForTimeout(2500)
await p.screenshot({ path: `${OUT}/${C}-0-menu.png` })
await p.evaluate(() => { const g = window.__g; g.start(); g.skipCountdown(); g.autopilot(true) })
for (const [t, n] of [[6, 1], [14, 2], [24, 3]]) { await p.waitForTimeout(t * 1000 - (n > 1 ? [0, 6, 14][n - 1] * 1000 : 0)); await p.screenshot({ path: `${OUT}/${C}-${n}-race.png` }) }
const st = await p.evaluate(() => window.__g.stats())
await p.evaluate(() => { const g = window.__g; g.autopilot(false); g.free(); g.fly(); g.flyForce(true); Object.assign(g.fc, { pitch: 0.5, turn: 0, roll: 0, throttle: false, brake: false, burner: true, aim: null }) })
await p.waitForTimeout(1200)
await p.evaluate(() => Object.assign(window.__g.fc, { pitch: -0.6, burner: false }))
await p.waitForTimeout(2200)
await p.screenshot({ path: `${OUT}/${C}-4-high.png` })
console.log(JSON.stringify({ fps: st.fps, ms: st.ms, calls: st.calls, mach: st.mach, crashing: st.crashing }), errs.slice(0, 5))
await b.close()
