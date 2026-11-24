// The craft's limits, measured from the real physics (sim time, deterministic — machine load cannot touch
// it): acceleration at each speed (throttle; throttle + burner), braking, and the turn at full lock at each
// speed (without and with the burner, which locks the stick to a tenth), with the speed a turn bleeds.
// Free roam, collisions off, on the open ground. Writes tools/optruns/craft-model.json.
//   node tools/craftmodel.mjs 4491
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const port = process.argv[2] ?? '4491'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await p.goto(`http://localhost:${port}/?course=sprint&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { localStorage.setItem('dbu-sub', 'trial'); document.querySelector('#submodes button[data-sub=trial]').click() })
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
const model = await p.evaluate(async () => {
  const g = window.__g, P = g.player, MACH = P.speed / Math.max(1e-6, P.mach) || 343
  g.start(); g.skipCountdown(); g.hold(true); P.noCollide = true
  // (Each test from the start line, the same ground and heading: the race's grid.)
  const restart = (m) => { g.start(); g.skipCountdown(); g.hold(true); P.noCollide = true; g.fastSim(0.5); g.setMach(m) }
  const STEP = 1 / 60
  const ctl = (o) => ({ steer: 0, strafe: 0, boost: false, burner: false, brake: false, dodgeL: false, dodgeR: false, ...o })
  const step = (n = 1) => g.fastSim(n * STEP)
  const yield_ = () => new Promise((r) => setTimeout(r, 0))
  const out = { mach: 343 }
  // Longitudinal: from Mach 0.3, full throttle (± burner), speed every 0.25 s for 60 s.
  for (const [name, c] of [['throttle', { boost: true }], ['burner', { boost: true, burner: true }]]) {
    restart(0.3); g.force(ctl(c)); const pts = []
    for (let i = 0; i <= 240; i++) { pts.push([i * 0.25, P.speed]); step(15); if (i % 20 === 0) await yield_() }
    out[name] = pts
  }
  // Braking from Mach 7 (air brake).
  restart(7); g.force(ctl({ brake: true })); { const pts = []; for (let i = 0; i <= 80; i++) { pts.push([i * 0.1, P.speed]); step(6) } out.brake = pts }
  // Coasting from Mach 7.
  restart(7); g.force(ctl({})); { const pts = []; for (let i = 0; i <= 80; i++) { pts.push([i * 0.1, P.speed]); step(6) } out.coast = pts }
  // Full-lock turns at a range of speeds: settle 1.5 s, then measure yaw rate and speed change over 1 s.
  for (const [name, c] of [['turn', { boost: true }], ['turnBurn', { boost: true, burner: true }]]) {
    const pts = []
    for (let m = 0.5; m <= 9.01; m += 0.5) {
      restart(m); g.force(ctl({ ...c, steer: 1 })); step(90)
      if (P.airborne) { pts.push({ mach: m, air: true }); continue }
      const h0 = P.heading, v0 = P.speed; step(60)
      let dh = P.heading - h0; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI
      pts.push({ mach: m, v: (v0 + P.speed) / 2, yaw: Math.abs(dh), dv: P.speed - v0, latAcc: Math.abs(dh) * (v0 + P.speed) / 2, slip: P.slip, air: P.airborne, crash: P.crashing })
      await yield_()
    }
    out[name] = pts
  }
  g.force(null); g.hold(false)
  return out
})
fs.mkdirSync('tools/optruns', { recursive: true })
fs.writeFileSync('tools/optruns/craft-model.json', JSON.stringify(model, null, 1))
const at = (pts, t) => pts.find((x) => x[0] >= t)?.[1] / 343
console.log('throttle: Mach at 2/5/10/20 s', [2, 5, 10, 20].map((t) => at(model.throttle, t).toFixed(2)).join(' '))
console.log('burner:   Mach at 2/5/10/20/40 s', [2, 5, 10, 20, 40].map((t) => at(model.burner, t).toFixed(2)).join(' '))
console.log('brake: Mach after 1/2/4 s', [1, 2, 4].map((t) => (model.brake.find((x) => x[0] >= t)[1] / 343).toFixed(2)).join(' '))
console.log('turn (no burner):', model.turn.map((x) => x.yaw === undefined ? `M${x.mach} air` : `M${x.mach} ${x.yaw.toFixed(2)}rad/s ${(x.dv / 343).toFixed(2)}${x.crash ? ' CRASH' : ''}`).join(' · '))
console.log('turn (burner):   ', model.turnBurn.map((x) => x.yaw === undefined ? `M${x.mach} air` : `M${x.mach} ${x.yaw.toFixed(2)}`).join(' · '))
await b.close()
