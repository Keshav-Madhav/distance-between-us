// AI difficulty, measured: run whole races faster than real time (no frames drawn) with the rubber band
// off — the field's natural pace — and read every finish time. Used to set CourseDef.aiLevel per course
// so the field's winner lands near a normal human's time.
//   node tools/aitune.mjs sprint 1.0            one run: AI finish times at that level
//   URL=http://localhost:5417/ node tools/aitune.mjs sprint 0.9,1,1.1
import { chromium } from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:5417/'
const [course, levels = '1'] = process.argv.slice(2)
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 640, height: 360 } })).newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
for (const L of levels.split(',').map(Number)) {
  await p.goto(`${URL}?course=${course}&fixed=1`)
  await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
  const r = await p.evaluate(async (L) => {
    const g = window.__g
    g.start(); g.skipCountdown()
    g.race.noBand = true
    g.course.def.aiLevel = L
    g.autopilot(true)
    g.hold(true) // (no frames: only the fast steps below advance the race)
    let t = 0
    const ais = g.race.racers.filter((x) => x.ai)
    while (t < 900 && ais.some((x) => !x.finished)) { g.fastSim(10); t += 10; await new Promise((res) => setTimeout(res, 0)) }
    const fin = ais.filter((x) => x.finished).map((x) => x.finishTime).sort((a, b) => a - b)
    const me = g.race.racers[0]
    return { fin, unfinished: ais.length - fin.length, me: me.finished ? me.finishTime : null, simT: t }
  }, L)
  const f = (x) => (x == null ? '—' : x.toFixed(2))
  console.log(`${course} L=${L} winner ${f(r.fin[0])} median ${f(r.fin[Math.floor(r.fin.length / 2)])} last ${f(r.fin[r.fin.length - 1])} unfinished ${r.unfinished} autopilot ${f(r.me)}`)
}
if (errs.length) console.log('page errors:', errs.slice(0, 3).join(' | '))
await b.close()
