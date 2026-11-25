// experiments: from a common state on the first straight, try control patterns, report speed/drift
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const pats = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await page.goto(`http://localhost:4480/?course=mistriver&fixed=1`)
await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
const r = await page.evaluate(async (pats) => {
  const g = window.__g, P = g.player
  const pads = g.course.pads.map((p) => [Math.round(p.x), Math.round(p.z)])
  g.hold(true); g.replayWith([0, 0, 1]); g.skipCountdown(); g.hold(true)
  const F = (s, b, br, st) => g.force({ steer: st || 0, strafe: 0, boost: true, burner: !!b, brake: !!br, dodgeL: false, dodgeR: false })
  // warm: burn straight for 3.5 s
  for (let i = 0; i < 210; i++) { F(0, i > 1, 0, 0); g.fastSim(1 / 60) }
  const s0 = g.snap(), m0 = P.speed / 343
  const out = []
  for (const p of pats) {
    g.restore(s0)
    const fn = new Function('i', 'P', p.code)
    const tr = []; let boosts = 0
    const ob = P.onDriftBoost; P.onDriftBoost = (l) => { boosts++; tr.push(['DB', i0, l]) }
    var i0 = 0
    for (let i = 0; i < p.n; i++) { i0 = i; const c = fn(i, P); g.force({ steer: c[0], strafe: 0, boost: true, burner: !!c[1], brake: !!c[2], dodgeL: false, dodgeR: false }); g.fastSim(1 / 60); if (i % 15 === 0) tr.push([i, +(P.speed / 343).toFixed(2), +P.slip.toFixed(2), +P.drift.toFixed(2), P.spin > 0 ? 'S' : '']) }
    P.onDriftBoost = ob
    out.push({ name: p.name, m: +(P.speed / 343).toFixed(3), boosts, hdg: +P.heading.toFixed(2), tr: p.tr ? tr : undefined })
  }
  return { m0, pads, out }
}, pats)
console.log(JSON.stringify({ m0: r.m0, npads: r.pads.length, pads: r.pads }))
for (const o of r.out) console.log(JSON.stringify(o))
await browser.close()
