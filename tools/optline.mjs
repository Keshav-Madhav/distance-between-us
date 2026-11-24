// The fastest line we can find: TIME TRIAL runs (no rivals — physics and driver fully deterministic)
// of your autopilot driven by a searched policy (race.playerPolicy: the lane at points along the
// course, how hard it corners, how readily it burns), at sim speed, improved by a (1+λ) evolution
// strategy with step-size control. Not a proof of the absolute optimum (the input space is enormous),
// but every time it prints is a real, replayable run.
//   node tools/optline.mjs 4495 whitewater [generations] [lambda]      (SEED=ghost.json: start from a recorded
//   ghost's line — x,y,z,heading,bank,pitch per sample — e.g. your own run, decoded from Zen's storage)
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { calm } from './loadguard.mjs'
const port = process.argv[2] ?? '4495', course = process.argv[3] ?? 'whitewater', GENS = +(process.argv[4] ?? 40), LAMBDA = +(process.argv[5] ?? 8)
const BEST = { sprint: 84.07, 'dry-river': 44.25, drag: 49.87, oval: 32.93, canyon: 33.83, icefall: 64.95, faultline: 49.4, greenway: 70.78, timberline: 57.22, understory: 59.87 }
await calm()
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await p.goto(`http://localhost:${port}/?course=${course}&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { localStorage.setItem('dbu-sub', 'trial'); document.querySelector('#submodes button[data-sub=trial]').click() })
const info = await p.evaluate(() => ({ n: window.__g.course.n, L: window.__g.course.def.aiLevel ?? 1, km: window.__g.course.def.km }))
const STEP = Math.max(20, Math.round(2000 / 40)) // course points between control points (~2 km; points are ~40 m apart)
const K = Math.ceil(info.n / STEP) + 1
// One run of a policy (null: the plain autopilot). Returns the finish time, or a penalty for not finishing.
const run = (pol) => p.evaluate(async (pol) => {
  const g = window.__g
  g.race.playerPolicy = pol ? { lane: Float32Array.from(pol.lane), step: pol.step, L: pol.L, burn: pol.burn } : null
  g.start(); g.skipCountdown(); g.autopilot(true); g.hold(true)
  let t = 0
  while (t < 400 && !g.race.racers[0].finished) { g.fastSim(5); t += 5; if (t % 50 === 0) await new Promise((r) => setTimeout(r, 0)) }
  const me = g.race.racers[0]
  g.hold(false)
  return me.finished ? me.finishTime : 1000 + (1 - g.race.progress(me) / g.course.n) * 1000
}, pol)
const base = await run(null)
console.log(`${course}: ${info.km} km, ${K} control points · plain autopilot ${base.toFixed(3)} s · your best ${BEST[course] ?? '—'}`)
let best = { lane: new Array(K).fill(0), step: STEP, L: info.L + 2.2, burn: 1 }
let bestT = await run(best)
console.log(`start (ELITE-level driver, centre line) ${bestT.toFixed(3)} s`)
if (process.env.SEED) {
  // A recorded line: where the ghost was across the course at each control point (its nearest sample).
  const G = JSON.parse(fs.readFileSync(process.env.SEED, 'utf8'))
  const lane = await p.evaluate(([G, STEP, K]) => {
    const c = window.__g.course, out = []
    for (let k = 0; k < K; k++) {
      const i = Math.min(c.n - 1, k * STEP), [tx, tz] = c.tangent(i)
      let bd = Infinity, lat = 0
      for (let j = 0; j < G.length; j += 6) { const dx = G[j] - c.px[i], dz = G[j + 2] - c.pz[i], d = dx * dx + dz * dz; if (d < bd) { bd = d; lat = dx * -tz + dz * tx } }
      out.push(Math.max(-220, Math.min(220, bd < 600 * 600 ? lat : 0)))
    }
    return out
  }, [G, STEP, K])
  const seeded = { lane, step: STEP, L: info.L + 2.2, burn: 1 }
  const t = await run(seeded)
  console.log(`seeded from ${process.env.SEED.split('/').pop()}: ${t.toFixed(3)} s`)
  if (t < bestT) { best = seeded; bestT = t }
}
let sig = 1, wins = 0, tries = 0
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
const t0 = Date.now()
for (let gen = 0; gen < GENS; gen++) {
  let genBest = null, genT = Infinity
  for (let k = 0; k < LAMBDA; k++) {
    // Mutate: a few lane points (local changes keep good stretches), the level and the burner factor.
    const c = { lane: best.lane.slice(), step: STEP, L: best.L, burn: best.burn }
    const m = 1 + Math.floor(Math.random() * 3)
    for (let j = 0; j < m; j++) { const i = Math.floor(Math.random() * K); for (let d = -1; d <= 1; d++) if (c.lane[i + d] !== undefined) c.lane[i + d] = Math.max(-220, Math.min(220, c.lane[i + d] + gauss() * 45 * sig * (d ? 0.5 : 1))) }
    if (Math.random() < 0.4) c.L = Math.max(0, Math.min(8, c.L + gauss() * 0.35 * sig))
    if (Math.random() < 0.3) c.burn = Math.max(0.5, Math.min(2.5, c.burn + gauss() * 0.12 * sig))
    const t = await run(c); tries++
    if (t < genT) { genT = t; genBest = c }
  }
  if (genT < bestT - 1e-6) { best = genBest; bestT = genT; wins++; sig = Math.min(2.5, sig * 1.25) } else sig = Math.max(0.25, sig * 0.85)
  console.log(`gen ${String(gen + 1).padStart(3)}  best ${bestT.toFixed(3)} s  (L ${best.L.toFixed(2)}, burn ${best.burn.toFixed(2)}, σ ${sig.toFixed(2)})  ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  fs.mkdirSync('tools/optruns', { recursive: true })
  fs.writeFileSync(`tools/optruns/${course}.json`, JSON.stringify({ course, time: bestT, base, playerBest: BEST[course] ?? null, policy: best, evals: tries }, null, 1))
}
console.log(`\n${course}: best found ${bestT.toFixed(3)} s vs plain autopilot ${base.toFixed(3)} s${BEST[course] ? ` and your best ${BEST[course]} s` : ''} (${tries} runs)`)
await b.close()
