// ORBIT end to end: spawn in the system, cruise to a planet (autopilot aims, Shift held), fly down
// into it (the world swap), then climb out again (back to ORBIT). Screenshots at each stage.
//   OUT=dir [TARGET=desert] node tools/orbit.mjs
import { chromium } from 'playwright-core'
const OUT = process.env.OUT, TARGET = process.env.TARGET ?? 'desert'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
await p.goto('http://localhost:5417/?course=orbit'); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.waitForTimeout(1500)
await p.screenshot({ path: `${OUT}/orbit-0-title.png` })
await p.click('#start'); await p.waitForTimeout(1500)
await p.screenshot({ path: `${OUT}/orbit-1-spawn.png` })
console.log('spawn', await p.evaluate(() => { const s = window.__g.sys; return { mode: window.__g.mode, near: s.near } }))
// Cruise: aim at the target planet, Shift.
await p.evaluate((target) => {
  const g = window.__g; g.flyForce(true)
  window.__cruise = setInterval(() => {
    const s = g.sys, pl = s.planets.find((q) => q.biome === target)
    const d = pl.pos.clone().sub(s.pos).normalize()
    Object.assign(g.fc, { aim: d, burner: true, throttle: true, brake: false, roll: 0, turn: 0, pitch: 0 })
  }, 50)
}, TARGET)
let swapped = false, t0 = Date.now(), lastLog = 0
while (Date.now() - t0 < 90000) {
  await p.waitForTimeout(500)
  const st = await p.evaluate(() => ({ near: window.__g.sys.near, speed: window.__g.flight.speed, frame: !!document.querySelector('iframe') }))
  if (Date.now() - lastLog > 3000) { console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}s alt ${(st.near.alt / 1000).toFixed(0)} km · ${(st.speed / 1000).toFixed(1)} km/s`); lastLog = Date.now() }
  if (Date.now() - t0 > 8000 && Date.now() - t0 < 9000) await p.screenshot({ path: `${OUT}/orbit-2-cruise.png` })
  if (st.near.alt < 3e6 && !p.__shotNear) { p.__shotNear = true; await p.screenshot({ path: `${OUT}/orbit-3-near.png` }) }
  if (st.frame) { swapped = true; break }
}
console.log('swapped into a planet:', swapped, `after ${((Date.now() - t0) / 1000).toFixed(0)} s`)
if (swapped) {
  await p.waitForTimeout(4000)
  const f = p.frames().find((fr) => fr !== p.mainFrame())
  await f.waitForFunction('window.__g && window.__g.ready', null, { timeout: 60000 })
  const st = await f.evaluate(() => ({ mode: window.__g.mode, air: window.__g.freeAir, alt: Math.round(window.__g.flight.agl / 1000), url: location.search }))
  console.log('in the planet:', st)
  await p.screenshot({ path: `${OUT}/orbit-4-arrived.png` })
  await p.waitForTimeout(5000)
  await p.screenshot({ path: `${OUT}/orbit-5-descending.png` })
  // Climb back out: nose up, Shift.
  await f.evaluate(() => { const g = window.__g; g.flyForce(true); Object.assign(g.fc, { aim: null, pitch: 0.8, turn: 0, roll: 0, burner: true, throttle: true, brake: false }); const iv = setInterval(() => { if (g.flight.fwd.y > 0.75) { g.fc.pitch = 0; clearInterval(iv) } }, 50) })
  let back = false; const t1 = Date.now()
  while (Date.now() - t1 < 90000) {
    await p.waitForTimeout(1000)
    const n = p.frames().length
    const a = await f.evaluate(() => Math.round(window.__g.flight.agl / 1000)).catch(() => -1)
    if (n > 2 || a < 0) { back = true; break }
    if ((Date.now() - t1) % 10000 < 1000) console.log('  climbing', a, 'km')
  }
  console.log('climbed back out to ORBIT:', back)
  await p.waitForTimeout(5000)
  await p.screenshot({ path: `${OUT}/orbit-6-back.png` })
}
console.log('errors', errs.slice(0, 5))
await b.close()
