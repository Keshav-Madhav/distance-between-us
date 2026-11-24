// Record a run (TIME TRIAL, autopilot), then replay its saved inputs — in the same page and in a fresh
// page load — and compare the finish times. Deterministic physics: they must be identical.
//   node tools/replaycheck.mjs [course]
import { chromium } from 'playwright-core'
const course = process.argv[2] ?? 'oval', URL = process.env.URL ?? 'http://localhost:5417/'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const ctx = await b.newContext({ viewport: { width: 480, height: 270 } })
const runTo = (p, prep) => p.evaluate(async (prep) => {
  const g = window.__g
  if (prep === 'record') { localStorage.setItem('dbu-sub', 'trial'); document.querySelector('#submodes button[data-sub=trial]').click(); g.start(); g.autopilot(true) }
  else { g.autopilot(false); if (!g.replayBest()) return 'no saved inputs' }
  g.hold(true)
  let t = 0
  while (t < 400 && !g.race.racers[0].finished) { g.fastSim(2); t += 2; await new Promise((r) => setTimeout(r, 0)) }
  g.hold(false)
  const me = g.race.racers[0]
  return { time: me.finishTime, steps: g.inputCount(), x: g.player.pos.x, z: g.player.pos.z }
}, prep)
const p1 = await ctx.newPage()
await p1.goto(`${URL}?course=${course}&fixed=1`); await p1.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
const rec = await runTo(p1, 'record')
await p1.waitForFunction(() => !document.querySelector('#over').classList.contains('hide'), null, { timeout: 20000 })
await p1.waitForTimeout(300)
const rep1 = await runTo(p1, 'replay')
const p2 = await ctx.newPage()
await p2.goto(`${URL}?course=${course}&fixed=1`); await p2.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p2.waitForTimeout(500) // (this course's recordings load from IndexedDB just after boot)
const rep2 = await runTo(p2, 'replay')
const f = (r) => typeof r === 'string' ? r : `${r.time.toFixed(4)} s (${r.steps} steps)`
console.log('recorded       ', f(rec))
console.log('replay, same   ', f(rep1))
console.log('replay, reload ', f(rep2))
console.log(rec.time === rep1.time && rec.time === rep2.time ? 'IDENTICAL' : 'DIFFERENT')
await b.close()
