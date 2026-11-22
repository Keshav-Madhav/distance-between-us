// FREE ROAM: drive (burner) across the world riding the rocks, take off, fly, drop, land; log it.
// OUT=dir for screenshots. COURSE picks the world.
import { chromium } from 'playwright-core'
const OUT = process.env.OUT
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
await p.goto(`http://localhost:5417/?course=${process.env.COURSE ?? 'sprint'}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { const g = window.__g; g.free(); g.force({ steer: 0.12, boost: true, burner: true, brake: false, strafe: 0, dodgeL: false, dodgeR: false }) })
const run = (secs, tag) => p.evaluate(([secs, tag]) => new Promise((done) => {
  const g = window.__g, pl = g.player, w = g.world
  const s = { tag, maxRock: 0, maxAgl: 0, air: 0, n: 0, hullMin: 100, jumpY: 0, nan: false }
  const t0 = performance.now()
  const iv = setInterval(() => {
    const gr = w.surfaceAt(pl.pos.x, pl.pos.z)
    const { groundH } = { groundH: null }
    s.n++
    if (!Number.isFinite(pl.pos.y)) s.nan = true
    s.maxRock = Math.max(s.maxRock, gr - (pl.pos.y - pl.agl))  // (unused if agl from same surface)
    s.maxAgl = Math.max(s.maxAgl, pl.agl)
    if (pl.airborne) s.air++
    s.hullMin = Math.min(s.hullMin, pl.hull)
    s.y = pl.pos.y
    if (performance.now() - t0 > secs * 1000) { clearInterval(iv); s.taken = g.shards.taken; s.mach = pl.mach.toFixed(2); s.freeAir = g.freeAir; s.air = (s.air / s.n).toFixed(2); done(s) }
  }, 50)
}), [secs, tag])
const shot = async (n) => { if (OUT) await p.screenshot({ path: `${OUT}/${n}.png` }) }
console.log(JSON.stringify(await run(12, 'drive')))
await shot('1-drive')
// Track the highest ground the hover rode over (rock riding).
const ride = await p.evaluate(() => new Promise((done) => {
  const g = window.__g, pl = g.player, w = g.world
  let best = 0, t0 = performance.now()
  const iv = setInterval(() => {
    const over = w.surfaceAt(pl.pos.x, pl.pos.z) - (pl.pos.y - pl.agl)
    const rock = pl.airborne ? 0 : Math.max(0, w.surfaceAt(pl.pos.x, pl.pos.z) - w.topAt(pl.pos.x, pl.pos.z, -1e9))
    void over; best = Math.max(best, pl.pos.y)
    if (performance.now() - t0 > 15000) { clearInterval(iv); done({ highestY: best.toFixed(0) }) }
  }, 50)
}))
console.log('ride', JSON.stringify(ride))
await p.evaluate(() => { const g = window.__g; g.fly() })
await p.evaluate(() => { const g = window.__g; g.flyForce(true); Object.assign(g.fc, { pitch: 0.6, turn: 0, roll: 0, throttle: false, brake: false, burner: true, aim: null }) })
console.log(JSON.stringify(await run(4, 'climb')))
await shot('2-climb')
await p.evaluate(() => { Object.assign(window.__g.fc, { pitch: 0, turn: 0.6 }) })
console.log(JSON.stringify(await run(5, 'turn')))
await shot('3-fly')
await p.evaluate(() => { window.__g.fly() }) // drop
console.log(JSON.stringify(await run(1.5, 'drop')))
await shot('4-drop')
console.log(JSON.stringify(await run(8, 'fall+land')))
await shot('5-landed')
// Fly down gently to touch down on its own.
await p.evaluate(() => { const g = window.__g; g.fly(); Object.assign(g.fc, { pitch: -0.5, turn: 0, burner: false }) })
console.log(JSON.stringify(await run(10, 'glide-down')))
await shot('6-touchdown')
console.log('errors', errs.slice(0, 5))
await b.close()
