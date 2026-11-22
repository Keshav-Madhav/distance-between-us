// FREE ROAM loop: level flight, then hold Space (real key). The nose must go all the way round:
// through vertical, inverted over the top, and back — total pitch angle ≥ 360°, wings not rolled level.
import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 900, height: 600 } })).newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto(`http://localhost:5417/?course=${process.env.COURSE ?? 'sprint'}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { const g = window.__g; g.free(); g.fly(); g.flight.pos.y += 1500; g.flight.prev.copy(g.flight.pos); g.flight.speed = 3 * 343 })
await p.waitForTimeout(500)
await p.evaluate(() => { const g = window.__g; window.__loop = { a: 0, last: null, minUp: 1, maxAlt: 0, minAlt: 1e9 }; const L = window.__loop
  const h0 = Math.atan2(g.flight.fwd.x, g.flight.fwd.z), hx = Math.sin(h0), hz = Math.cos(h0)
  const f = () => { const fw = g.flight.fwd; const ang = Math.atan2(fw.y, fw.x * hx + fw.z * hz)
    if (L.last !== null) { let d = ang - L.last; d = Math.atan2(Math.sin(d), Math.cos(d)); L.a += d }
    L.last = ang; L.minUp = Math.min(L.minUp, g.flight.up.y); L.maxAlt = Math.max(L.maxAlt, g.flight.agl); L.minAlt = Math.min(L.minAlt, g.flight.agl); L.air = g.freeAir; requestAnimationFrame(f) }
  requestAnimationFrame(f) })
await p.keyboard.down('KeyW'); await p.keyboard.down('Space')
await p.waitForTimeout(9000)
await p.keyboard.up('Space'); await p.keyboard.up('KeyW')
const L = await p.evaluate(() => window.__loop)
console.log(`pitched through ${(L.a * 57.3).toFixed(0)}° · went inverted: ${L.minUp < -0.5} (min up.y ${L.minUp.toFixed(2)}) · alt ${L.minAlt.toFixed(0)}–${L.maxAlt.toFixed(0)} m · still flying: ${L.air}`)
console.log(Math.abs(L.a) >= 2 * Math.PI && L.minUp < -0.5 ? 'LOOP ok' : 'LOOP FAILED', errs.slice(0, 3))
await b.close()
