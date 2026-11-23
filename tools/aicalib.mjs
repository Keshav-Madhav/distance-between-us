// Calibrate CourseDef.aiLevel per course: bisect the level until the field's winner (rubber band off,
// averaged over runs) lands on a target time — a normal human's time (the player's best × 1.04), the
// first course of each world a little easier. Writes tools/aicalib.json.
//   node tools/aicalib.mjs                 all courses
//   node tools/aicalib.mjs sprint,greenway some
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const URL = process.env.URL ?? 'http://localhost:5417/'
// The player's best times (s), from their browser's storage on :5417 (2026-11-23). circuit and
// frostline were set on older, shorter versions of those courses — treated as unknown.
const BEST = { sprint: 84.07, 'dry-river': 44.25, drag: 49.87, oval: 32.93, canyon: 33.83, icefall: 64.95, faultline: 49.4, greenway: 70.78, timberline: 57.22, understory: 59.87 }
const WORLDS = [['sprint', 'dry-river', 'drag', 'circuit', 'oval', 'canyon'], ['frostline', 'icefall', 'whiteout', 'icecave'], ['caldera', 'faultline', 'obsidian', 'magma'], ['greenway', 'riverrun', 'timberline', 'whitewater'], ['mistriver', 'understory']]
const EASE = [1.05, 1.02] // first and second course of each world: the field's winner this much slower
const HUMAN = 1.04 // a normal human: a little slower than the player's best
const RUNS = 2
const only = process.argv[2]?.split(',')

const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const page = await (await b.newContext({ viewport: { width: 640, height: 360 } })).newPage()
async function winner(course, L) {
  let sum = 0
  for (let k = 0; k < RUNS; k++) {
    await page.goto(`${URL}?course=${course}&fixed=1`)
    await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
    sum += await page.evaluate(async (L) => {
      const g = window.__g
      g.start(); g.skipCountdown(); g.race.noBand = true; g.course.def.aiLevel = L; g.autopilot(true); g.hold(true)
      const ais = g.race.racers.filter((x) => x.ai)
      let t = 0
      while (t < 900 && ais.some((x) => !x.finished)) { g.fastSim(10); t += 10; await new Promise((r) => setTimeout(r, 0)) }
      return Math.min(...ais.filter((x) => x.finished).map((x) => x.finishTime))
    }, L)
  }
  return sum / RUNS
}

const out = fs.existsSync('tools/aicalib.json') ? JSON.parse(fs.readFileSync('tools/aicalib.json', 'utf8')) : {}
const all = WORLDS.flat()
// The player's pace relative to the field at level 1, from the courses with a best: the median ratio
// estimates a best for the others.
const ratios = []
const base1 = {}
for (const c of all) {
  if (only && !only.includes(c) && !BEST[c]) continue
  base1[c] = await winner(c, 1)
  if (BEST[c]) ratios.push(BEST[c] / base1[c])
  console.log(`level 1: ${c} ${base1[c].toFixed(2)}${BEST[c] ? ` (best ${BEST[c]}, ratio ${(BEST[c] / base1[c]).toFixed(3)})` : ''}`)
}
ratios.sort((a, b) => a - b)
const med = ratios[Math.floor(ratios.length / 2)]
console.log('median ratio', med.toFixed(3))
for (const [w, list] of WORLDS.entries()) for (const [k, c] of list.entries()) {
  if (only && !only.includes(c)) continue
  const best = BEST[c] ?? base1[c] * med
  const target = best * HUMAN * (EASE[k] ?? 1)
  let lo = -0.4, hi = 2.2, L = 1
  for (let it = 0; it < 6; it++) {
    L = (lo + hi) / 2
    const t = await winner(c, L)
    // Higher level → faster field (smaller time).
    if (t > target) lo = L; else hi = L
    console.log(`  ${c} L=${L.toFixed(3)} winner ${t.toFixed(2)} target ${target.toFixed(2)}`)
  }
  L = +((lo + hi) / 2).toFixed(3)
  out[c] = { level: L, target: +target.toFixed(2), best: BEST[c] ?? null, estimated: !BEST[c], world: w, order: k }
  fs.writeFileSync('tools/aicalib.json', JSON.stringify(out, null, 2))
  console.log(`${c}: level ${L} (target ${target.toFixed(2)})`)
}
await b.close()
