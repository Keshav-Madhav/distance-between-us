// The drift mechanic still works: at Mach 3 / 4.5, trail-brake into full lock (charge), then straighten
// out (release) — a drift boost must fire, and no spin. node tools/drifttest.mjs
import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 800, height: 500 } })).newPage()
await p.goto('http://localhost:5417/?course=drag'); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { const g = window.__g; g.start(); g.skipCountdown(); for (const r of g.race.racers) if (r.ai) { r.p.pos.y = -9999; r.p.dead = true } })
let ok = true
for (const [mach, hold] of [[3, 1.2], [4.5, 1.2], [4.5, 2.2]]) {
  const r = await p.evaluate(([mach, hold]) => new Promise((done) => {
    const g = window.__g, pl = g.player, MACH = 343
    pl.reset(pl.pos.x, pl.pos.z, pl.heading, mach); pl.maxMach = 30; pl.noCollide = true
    let boosts = [], maxDrift = 0, spun = false
    const prev = pl.onDriftBoost; pl.onDriftBoost = (l) => { boosts.push(l); prev?.(l) }
    const ctl = { steer: 0, boost: true, burner: false, brake: false, strafe: 0, dodgeL: false, dodgeR: false }
    g.force(ctl)
    let t = 0
    const iv = setInterval(() => {
      t += 1 / 60
      if (t > 0.4 && t < 0.4 + hold) { ctl.steer = 1; ctl.brake = t < 0.4 + hold * 0.6 }
      else if (t >= 0.4 + hold && t < 0.4 + hold + 0.25) { ctl.steer = -0.6; ctl.brake = false } // catch it
      else { ctl.steer = 0; ctl.brake = false }
      maxDrift = Math.max(maxDrift, pl.drift); if (pl.spin > 0) spun = true
      if (t > hold + 3) { clearInterval(iv); g.force(null); pl.onDriftBoost = prev; done({ boosts, maxDrift, spun }) }
    }, 1000 / 60)
  }), [mach, hold])
  const good = r.boosts.length > 0 && !r.spun
  ok &&= good
  console.log(`Mach ${mach}, ${hold}s trail-brake drift: charge ${r.maxDrift.toFixed(2)} · boost levels ${JSON.stringify(r.boosts)} · spun ${r.spun} → ${good ? 'ok' : 'FAIL'}`)
}
await b.close()
process.exit(ok ? 0 : 1)
