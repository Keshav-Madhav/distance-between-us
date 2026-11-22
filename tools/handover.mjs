// The world handovers, frame by frame: ORBIT → a planet (aimed off-centre: a glide in, not a plunge),
// then climbing back out. Screenshots every ~150 ms across each switch.  OUT=dir node tools/handover.mjs
import { chromium } from 'playwright-core'
const OUT = process.env.OUT
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 960, height: 540 } })).newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://localhost:5417/?course=orbit'); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.click('#start'); await p.waitForTimeout(800)
await p.evaluate(() => {
  const g = window.__g; g.flyForce(true); document.getElementById('hints').style.display = 'none'
  window.__iv = setInterval(() => {
    const s = g.sys, pl = s.planets[1], to = pl.pos.clone().sub(s.pos), d = to.length()
    // Aim at a point beside the planet (a grazing approach), Shift held.
    const side = to.clone().cross({ x: 0, y: 1, z: 0, isVector3: true }).normalize().multiplyScalar(6371000 + Math.min(1.2e6, d * 0.15))
    Object.assign(g.fc, { aim: to.clone().add(side).normalize(), burner: true, throttle: true, brake: false, roll: 0, turn: 0, pitch: 0 })
  }, 30)
})
let n = 0, seenFrame = 0
const t0 = Date.now()
while (Date.now() - t0 < 60000) {
  const st = await p.evaluate(() => ({ alt: window.__g.sys.near.alt, fr: document.querySelector('iframe')?.style.opacity ?? null }))
  if (st.alt < 4e6 || st.fr !== null) { await p.screenshot({ path: `${OUT}/in-${String(n++).padStart(2, '0')}.png` }); if (st.fr === '1') seenFrame++ }
  if (seenFrame > 10) break
  await p.waitForTimeout(120)
}
console.log('entry frames', n)
// Climb out: in the new frame, nose up, Shift.
const f = p.frames().find((fr) => fr !== p.mainFrame())
await f.evaluate(() => { const g = window.__g; g.flyForce(true); Object.assign(g.fc, { aim: null, pitch: 0.8, turn: 0, roll: 0, burner: true, throttle: true, brake: false }); const iv = setInterval(() => { if (g.flight.fwd.y > 0.5) { g.fc.pitch = 0; clearInterval(iv) } }, 30) })
let m = 0, after = 0
const t1 = Date.now()
while (Date.now() - t1 < 60000) {
  const st = await f.evaluate(() => window.__g.flight.agl).catch(() => 0)
  const frames = p.frames().length
  if (st > 1.2e6 || frames > 2) { await p.screenshot({ path: `${OUT}/out-${String(m++).padStart(2, '0')}.png` }); if (frames > 2) after++ }
  if (after > 14) break
  await p.waitForTimeout(120)
}
console.log('exit frames', m, 'errors', errs.slice(0, 3))
await b.close()
