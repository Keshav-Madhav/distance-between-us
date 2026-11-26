// Find a course's AI level so the field's winner (rubber band off) lands on a target time at a difficulty.
//   node tools/aitune.mjs <course> <target seconds> [boost: 0 NORMAL | 1 HARD]   → prints the level
import { chromium } from 'playwright-core'
const [course, target, boost = '0'] = process.argv.slice(2)
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 640, height: 360 } })).newPage()
async function winner(L) {
  await p.goto(`http://localhost:5417/?course=${course}&fixed=1`)
  await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
  return p.evaluate(async ([L, boost]) => {
    const g = window.__g
    g.course.def.aiLevel = L; g.race.aiBoost = boost
    g.start(); g.skipCountdown(); g.race.noBand = true; g.autopilot(true); g.hold(true)
    const ais = g.race.racers.filter((x) => x.ai)
    let t = 0
    while (t < 900 && ais.some((x) => !x.finished)) { g.fastSim(10); t += 10; await new Promise((r) => setTimeout(r, 0)) }
    const f = ais.filter((x) => x.finished).map((x) => x.finishTime)
    return f.length ? Math.min(...f) : 999
  }, [L, +boost])
}
let lo = -2, hi = 3, best = null
for (let k = 0; k < 9; k++) {
  const m = (lo + hi) / 2, w = await winner(m)
  console.log(`level ${m.toFixed(3)} → winner ${w.toFixed(2)}`)
  if (!best || Math.abs(w - target) < Math.abs(best.w - target)) best = { m, w }
  if (w > target) lo = m; else hi = m // higher level = faster field
}
console.log(`RESULT ${course} level ${best.m.toFixed(2)} winner ${best.w.toFixed(2)} (target ${target}, boost ${boost})`)
await b.close()
