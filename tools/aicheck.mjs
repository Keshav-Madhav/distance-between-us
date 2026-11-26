// The field's winner (rubber band off) at EASY / NORMAL / HARD on every course, against the calibration target
// (tools/aicalib.json: a normal human's time) and the IDEAL time. One run each (the field is seeded per course).
//   node tools/aicheck.mjs [port] [courses]
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const port = process.argv[2] ?? '5417'
const cal = JSON.parse(fs.readFileSync('tools/aicalib.json', 'utf8'))
const courses = (process.argv[3] ?? Object.keys(cal).join(',')).split(',')
const LEVELS = [['EASY', -0.7], ['NORMAL', 0], ['HARD', 1]]
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 640, height: 360 } })).newPage()
const rows = []
for (const c of courses) {
  const row = { course: c, target: cal[c]?.target }
  for (const [name, boost] of LEVELS) {
    await p.goto(`http://localhost:${port}/?course=${c}&fixed=1`)
    await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
    row[name] = await p.evaluate(async (boost) => {
      const g = window.__g
      g.race.aiBoost = boost
      g.start(); g.skipCountdown(); g.race.noBand = true; g.autopilot(true); g.hold(true)
      const ais = g.race.racers.filter((x) => x.ai)
      let t = 0
      while (t < 900 && ais.some((x) => !x.finished)) { g.fastSim(10); t += 10; await new Promise((r) => setTimeout(r, 0)) }
      const f = ais.filter((x) => x.finished).map((x) => x.finishTime)
      return f.length ? +Math.min(...f).toFixed(2) : null
    }, boost)
  }
  rows.push(row)
  console.log(JSON.stringify(row))
}
fs.writeFileSync('tools/optruns/aicheck.json', JSON.stringify(rows))
await b.close()
