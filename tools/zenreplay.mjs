// Replay a run recorded in another browser (its inputs as a JSON float list) in headless Chrome, and
// report the finish — does the deterministic physics hold across engines?
//   node tools/zenreplay.mjs 4491 sprint inputs.json [expected]
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { calm } from './loadguard.mjs'
const [port, course, file, expected] = process.argv.slice(2)
const SUB = process.env.SUB ?? 'race', LVL = +(process.env.LVL ?? 0)
const inputs = JSON.parse(fs.readFileSync(file, 'utf8'))
await calm()
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await p.goto(`http://localhost:${port}/?course=${course}&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(([course, inputs]) => new Promise((res) => { const r = indexedDB.open('dbu', 1); r.onupgradeneeded = () => r.result.createObjectStore('runs'); r.onsuccess = () => { const t = r.result.transaction('runs', 'readwrite'); t.objectStore('runs').put(Float32Array.from(inputs).buffer, 'inputs-' + course); t.oncomplete = res } }), [course, inputs])
await p.evaluate(([sub]) => localStorage.setItem('dbu-sub', sub), [SUB])
await p.reload(); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 }); await p.waitForTimeout(800)
const r = await p.evaluate(async (LVL) => {
  const g = window.__g
  g.race.aiBoost = LVL
  if (!g.replayBest()) return 'no inputs loaded'
  g.hold(true); let t = 0
  while (t < 400 && !g.race.racers[0].finished) { g.fastSim(4); t += 4; await new Promise((r) => setTimeout(r, 0)) }
  g.hold(false)
  const me = g.race.racers[0]
  return { finished: me.finished, time: +me.finishTime.toFixed(4), mode: g.race.sub, lvl: g.race.aiBoost, prog: +(g.race.progress(me) / g.course.n).toFixed(3) }
}, LVL)
console.log(JSON.stringify(r), expected ? `expected ${expected}` : '')
await b.close()
