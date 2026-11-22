// Steering step response on open ground (the drag strip, rivals parked): hold full lock (a key) for
// 2.5 s at Mach 4 / 6 / 8, then let go. Reports how fast the turn builds, the yaw it settles at vs the
// grip's limit, the slip, the radius, spins, and how far the turn runs on after release (momentum).
//   node tools/steertest.mjs
import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 800, height: 500 } })).newPage()
await p.goto('http://localhost:5417/?course=drag'); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { const g = window.__g; g.start(); g.skipCountdown(); for (const r of g.race.racers) if (r.ai) { r.p.pos.y = -9999; r.p.dead = true } })
for (const [mach, burner, brake] of [[4, false, false], [6, false, false], [8, false, false], [8, true, false], [6, false, true]]) {
  const r = await p.evaluate(([mach, burner, brake]) => new Promise((done) => {
    const g = window.__g, pl = g.player, MACH = 343
    pl.reset(pl.pos.x, pl.pos.z, pl.heading, mach); pl.maxMach = 30; pl.noCollide = true
    const ctl = { steer: 0, boost: true, burner, brake: false, strafe: 0, dodgeL: false, dodgeR: false }
    g.force(ctl)
    const log = []; let t = 0, phase = 'settle'
    const iv = setInterval(() => {
      t += 1 / 60
      if (phase === 'settle') { pl.speed = mach * MACH; if (t > 0.6) { phase = 'lock'; t = 0; ctl.steer = 1; ctl.brake = brake } }
      else if (phase === 'lock') { if (!burner) pl.speed = Math.max(pl.speed, mach * MACH * 0.97); log.push({ t, yaw: pl.yawRate, slip: pl.slip, spin: pl.spin > 0, load: pl.gripLoad, v: pl.speed, tm: pl.turnMax ?? 0 }); if (t > 2.5) { phase = 'release'; t = 0; ctl.steer = 0; ctl.brake = false; window.__h0 = pl.heading } }
      else { log.push({ t, yaw: pl.yawRate, rel: true, slip: pl.slip, spin: pl.spin > 0 }); if (t > 1.5) { clearInterval(iv); g.force(null); done({ log, after: pl.heading - window.__h0 }) } }
    }, 1000 / 60)
  }), [mach, burner, brake])
  const L = r.log.filter((x) => !x.rel), R = r.log.filter((x) => x.rel)
  const peak = Math.max(...L.map((x) => Math.abs(x.yaw)))
  const t90 = (L.find((x) => Math.abs(x.yaw) > 0.9 * Math.abs(L[L.length - 1].yaw)) ?? L[L.length - 1]).t
  const end = L[L.length - 1]
  const slipMax = Math.max(...L.map((x) => Math.abs(x.slip))) * 57.3
  const settle = (R.find((x) => Math.abs(x.yaw) < 0.05) ?? R[R.length - 1]).t
  const radius = end.v / Math.max(Math.abs(end.yaw), 1e-3)
  console.log(`Mach ${mach}${burner ? ' +burner' : ''}${brake ? ' +brake' : ''}: yaw ${Math.abs(end.yaw).toFixed(2)} rad/s (peak ${peak.toFixed(2)}, 90% in ${t90.toFixed(2)} s) · radius ${(radius / 1000).toFixed(2)} km · slip max ${slipMax.toFixed(1)}° end ${(Math.abs(end.slip) * 57.3).toFixed(1)}° · grip load ${end.load.toFixed(2)} · spun ${L.some((x) => x.spin) || R.some((x) => x.spin)} · after release: turned on ${(Math.abs(r.after) * 57.3).toFixed(1)}°, yaw < 0.05 in ${settle.toFixed(2)} s`)
}
await b.close()
