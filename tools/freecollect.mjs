import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 900, height: 600 } })).newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://localhost:5417/?course=sprint'); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 130000 })
const r = await p.evaluate(() => new Promise((done) => {
  const g = window.__g; g.free()
  const pl = g.player, c = { steer: 0, boost: true, burner: false, brake: false, strafe: 0, dodgeL: false, dodgeR: false }
  g.force(c)
  const t0 = performance.now(); let minD = 1e9
  const iv = setInterval(() => {
    let best = null, bd = 1e9
    for (const t of g.shards.trails) if (t.kind !== 'sky') for (const s of t.shards) if (s.alive) { const d = Math.hypot(s.x - pl.pos.x, s.z - pl.pos.z); if (d < bd) { bd = d; best = s } }
    if (best) { let a = Math.atan2(best.x - pl.pos.x, best.z - pl.pos.z) - pl.heading; a = Math.atan2(Math.sin(a), Math.cos(a)); c.steer = Math.max(-1, Math.min(1, -1 * a * 3)); minD = Math.min(minD, bd); c.brake = Math.abs(a) > 0.6 }
    if (performance.now() - t0 > 30000) { clearInterval(iv); done({ taken: g.shards.taken, minD }) }
  }, 30)
}))
console.log(JSON.stringify(r), errs.slice(0, 3))
await b.close()
