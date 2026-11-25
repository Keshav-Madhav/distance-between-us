// probe: replay an inputs file and print rivals / wake / drift info
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const inp = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).steps
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await page.goto(`http://localhost:4480/?course=caldera&fixed=1`)
await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
const r = await page.evaluate(async (inp) => {
  const g = window.__g, race = g.race, P = g.player
  g.hold(true); g.replayWith(inp.flat()); g.skipCountdown(); g.hold(true)
  const out = [{ n: race.racers.length, all: race.all.length, ai: race.racers.map((r) => [r.ai, !!r.replay, Math.round(r.p.pos.x), Math.round(r.p.pos.z)]) }]
  for (let st = 0; st < inp.length + 600 && !race.racers[0].finished; st++) {
    g.fastSim(1 / 60)
    if (st % 30 === 0 && st < 900) out.push([st, +(P.speed / 343).toFixed(2), +P.wake.toFixed(2), race.racers.slice(1).map((r) => [+(r.p.speed / 343).toFixed(1), Math.round(r.p.pos.x - P.pos.x), Math.round(r.p.pos.z - P.pos.z)])])
    if (st % 4 === 0) await new Promise((r) => setTimeout(r, 0))
  }
  out.push(['fin', race.racers[0].finishTime])
  return out
}, inp)
console.log(r.map((x) => JSON.stringify(x)).join('\n'))
await browser.close()
