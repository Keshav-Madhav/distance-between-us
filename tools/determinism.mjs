// Is a run reproducible? Two separate page loads drive the same scripted inputs, step by step, and the
// player's state is compared at every second. Physics only (the field round you may differ: TIME TRIAL).
//   node tools/determinism.mjs [course]
import { chromium } from 'playwright-core'
const course = process.argv[2] ?? 'dry-river', URL = process.env.URL ?? 'http://localhost:5417/'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
async function run() {
  const p = await (await b.newContext({ viewport: { width: 480, height: 270 } })).newPage()
  await p.goto(`${URL}?course=${course}&fixed=1`)
  await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
  const out = await p.evaluate(async () => {
    const g = window.__g
    g.start(); g.skipCountdown(); g.hold(true)
    for (const r of g.race.racers) if (r.ai) r.p.pos.x += 1e6 // (the field out of the way: physics only)
    const log = []
    for (let s = 0; s < 60 * 40; s++) {
      // A scripted driver: weave, burn on the straights, brake-drift now and then, a deliberate crash.
      const t = s / 60
      g.force({ steer: Math.sin(t * 0.9) * (t % 7 < 1.2 ? 1 : 0.35), boost: true, burner: t % 9 > 4 && t % 9 < 7, brake: t % 11 > 9.6, strafe: t % 5 < 0.3 ? 1 : 0, dodgeL: false, dodgeR: false })
      g.fastSim(1 / 60)
      if (s % 60 === 0) { const P = g.player; log.push([P.pos.x, P.pos.z, P.speed, P.heading, P.hull].map((v) => +v.toFixed(6)).join(',')) }
    }
    return log
  })
  await p.context().close()
  return out
}
const a = await run(), c = await run()
let first = -1
for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) { first = i; break }
console.log(first < 0 ? `IDENTICAL over ${a.length} s` : `DIVERGED at ${first} s:\n  ${a[first]}\n  ${c[first]}`)
await b.close()
