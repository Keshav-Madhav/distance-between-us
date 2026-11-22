// Is the ship on screen at every speed? ORBIT cruise and FREE ROAM high up, a range of speeds; every
// frame, where the ship projects to and how many pixels tall it is.  node tools/speedvis.mjs
import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
let bad = 0
for (const [course, label] of [['orbit', 'ORBIT'], ['sprint', 'RED MESA, 600 km up']]) {
  await p.goto(`http://localhost:5417/?course=${course}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
  await p.evaluate((course) => { const g = window.__g; if (course === 'orbit') g.system(); else { g.free(); g.fly(); g.flight.pos.y = 600000; g.flight.prev.copy(g.flight.pos) } g.flyForce(true) }, course)
  for (const kms of [0.3, 3, 30, 300, 3000, 30000]) {
    const r = await p.evaluate((kms) => new Promise((done) => {
      const g = window.__g, f = g.flight, cam = g.camera
      let n = 0, off = 0, minPx = 1e9, maxPx = 0
      const T = cam.constructor
      g.setSpeed(kms * 1000)
      const tick = () => {
        Object.assign(g.fc, { aim: null, pitch: 0, turn: 0.1, roll: 0, burner: false, throttle: false, brake: false })
        const pos = g.craftPos.clone() // where the ship is drawn, not where the physics has it
        const a = pos.clone().project(cam), top = pos.clone().add({ x: 0, y: 3, z: 0, isVector3: true }).project(cam)
        const px = Math.abs(a.y - top.y) * 360
        const on = a.z < 1 && Math.abs(a.x) < 1 && Math.abs(a.y) < 1
        if (!on) off++
        minPx = Math.min(minPx, px); maxPx = Math.max(maxPx, px)
        if (++n < 120) requestAnimationFrame(tick); else { g.setSpeed(0); done({ off, minPx: +minPx.toFixed(1), maxPx: +maxPx.toFixed(1), speed: Math.round(f.speed / 1000) }) }
      }
      requestAnimationFrame(tick)
    }), kms)
    const ok = r.off === 0 && r.minPx > 4
    if (!ok) bad++
    console.log(`${label.padEnd(22)} ${String(kms).padStart(6)} km/s → actual ${r.speed} km/s · off screen ${r.off}/120 frames · ship ${r.minPx}-${r.maxPx} px tall ${ok ? 'ok' : 'FAIL'}`)
  }
}
await b.close()
process.exit(bad ? 1 : 0)
