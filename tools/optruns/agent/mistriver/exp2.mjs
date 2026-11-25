// replay the first N steps of an input file, snapshot, then try patterns; report Mach after, drift boosts
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const [inF, N, pf] = process.argv.slice(2)
const inp = JSON.parse(fs.readFileSync(inF, 'utf8')).steps.slice(0, +N)
const pats = JSON.parse(fs.readFileSync(pf, 'utf8'))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await page.goto(`http://localhost:4480/?course=mistriver&fixed=1`)
await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
const r = await page.evaluate(async ([inp, pats]) => {
  const g = window.__g, P = g.player
  const F = (c) => g.force({ steer: c[0], strafe: c[1], boost: !!(c[2] & 1), burner: !!(c[2] & 2), brake: !!(c[2] & 4), dodgeL: !!(c[2] & 8), dodgeR: !!(c[2] & 16) })
  g.hold(true); g.replayWith([0, 0, 1]); g.skipCountdown(); g.hold(true)
  for (let i = 0; i < inp.length; i++) { F(i === 1 ? [0, 0, 0] : inp[i]); g.fastSim(1 / 60) }
  const s0 = g.snap(), m0 = P.speed / 343, h0 = P.heading
  const out = []
  for (const p of pats) {
    g.restore(s0)
    const fn = new Function('i', 'P', p.code)
    let boosts = 0; const tr = []
    const ob = P.onDriftBoost; P.onDriftBoost = (l) => { boosts += l }
    for (let i = 0; i < p.n; i++) { F(fn(i, P)); g.fastSim(1 / 60); if (i % 10 === 0) tr.push([i, +(P.speed / 343).toFixed(2), +P.slip.toFixed(2), +P.drift.toFixed(2), +(P.heading - h0).toFixed(2), P.spin > 0 ? 'S' : '']) }
    P.onDriftBoost = ob
    out.push({ name: p.name, m: +(P.speed / 343).toFixed(3), boosts, dh: +(P.heading - h0).toFixed(2), crash: P.crashing, tr: p.tr ? tr : undefined })
  }
  return { m0, out }
}, [inp, pats])
console.log('m0', r.m0)
for (const o of r.out) console.log(JSON.stringify(o))
await browser.close()
