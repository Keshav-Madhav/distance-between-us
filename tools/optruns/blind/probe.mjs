import { openBrowser, openCourse } from './browser.mjs'
const course = process.argv[2] ?? 'sprint'
const b = await openBrowser()
const { page } = await openCourse(b, course)
const r = await page.evaluate(async () => {
  const g = window.__g, c = g.course, P = g.player
  const info = { n: c.n, startI: c.startI, finishI: c.finishI, K: g.race.K, cps: c.cps.map((q) => q.i), rocks: c.rocks.length, pads: c.pads.length, mounds: c.mounds.length / 4, racers: g.race.racers.length, gateHalf: c.gateHalf }
  g.hold(true); g.autopilot(true); g.replayWith([]); g.skipCountdown(); g.hold(true)
  const me = g.race.racers[0]
  const t0 = performance.now(); let st = 0
  while (!me.finished && st < 60 * 300) { g.fastSim(1 / 60); st++; if (st % 600 === 0) await new Promise((r) => setTimeout(r, 0)) }
  const ms = performance.now() - t0
  return { ...info, autoTime: me.finished ? me.finishTime : null, steps: st, msPerStep: ms / st }
})
console.log(JSON.stringify(r))
await b.close()
