// Savestates are exact: snapshot mid-run, run on (A); restore, take a different branch, restore again, run
// the same as A (B) — A and B must match to the last bit; also the time cost of a sim step.
//   node tools/snapcheck.mjs 4491 sprint
import { chromium } from 'playwright-core'
const port = process.argv[2] ?? '4491', c = process.argv[3] ?? 'sprint'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await p.goto(`http://localhost:${port}/?course=${c}&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { localStorage.setItem('dbu-sub', 'trial'); document.querySelector('#submodes button[data-sub=trial]').click() })
console.log(await p.evaluate(() => {
  const g = window.__g, P = g.player, STEP = 1 / 60, me = g.race.racers[0]
  g.start(); g.skipCountdown(); g.autopilot(true); g.hold(true)
  for (let i = 0; i < 1500; i++) g.fastSim(STEP)
  const fp = () => [P.pos.x, P.pos.y, P.pos.z, P.speed, P.heading, P.side, P.lateral, me.idx, me.passed].map((x) => x.toFixed(9)).join(',')
  const st = g.snap()
  for (let i = 0; i < 900; i++) g.fastSim(STEP)
  const A = fp()
  g.restore(st)
  g.autopilot(false); g.force({ steer: 1, strafe: -1, boost: true, burner: true, brake: false, dodgeL: true, dodgeR: false })
  for (let i = 0; i < 400; i++) g.fastSim(STEP)
  g.force(null); g.autopilot(true)
  g.restore(st)
  for (let i = 0; i < 900; i++) g.fastSim(STEP)
  const B = fp()
  const t0 = performance.now(); for (let i = 0; i < 600; i++) g.fastSim(STEP); const ms = (performance.now() - t0) / 600
  const t1 = performance.now(); for (let i = 0; i < 50; i++) { const s2 = g.snap(); g.restore(s2) } const snapMs = (performance.now() - t1) / 50
  return `${A === B ? 'IDENTICAL' : 'DIFFERENT\nA ' + A + '\nB ' + B} · one sim step ${ms.toFixed(3)} ms · snap+restore ${snapMs.toFixed(3)} ms`
}))
await b.close()
