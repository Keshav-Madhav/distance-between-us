// Dumps GREENWAY's gates, pads, mounds, centreline and an obstacle survey to course.json.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await page.goto(`http://localhost:4480/?course=greenway&fixed=1`)
await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
await page.addScriptTag({ content: fs.readFileSync('tools/pdcore.js', 'utf8') })
await page.evaluate((craft) => { window.makePD(null, craft, { look: 1.2, margin: 34, reach: 3, burnK: 1.2, burnErr: 0.1, latV: 150, airAlign: true, sweep: true, strafeK: 20, slow: true, brakeAt: 0.35, tapNear: 35, tapFar: 70 }) }, JSON.parse(fs.readFileSync('tools/optruns/craft-model.json', 'utf8')))
const r = await page.evaluate(() => {
  const g = window.__g, c = g.course, P = g.player
  g.hold(true); g.replayWith([0, 0, 1]); g.skipCountdown(); g.hold(true)
  const p0 = { x: P.pos.x, z: P.pos.z, h: P.heading, y: P.pos.y }
  const SV = new Map(), sbuf = []
  const v3 = P.pos.clone(), vz3 = P.vel.clone().set(0, 0, 0)
  for (let i = Math.max(0, c.startI - 5); i <= Math.min(c.n - 1, c.finishI + 5); i += 8) {
    v3.set(c.px[i], P.pos.y, c.pz[i]); g.world.update(v3, 0, undefined, vz3)
    const nn = g.world.near(c.px[i], c.pz[i], -200, 1500, sbuf)
    for (let q = 0; q < nn; q++) { const o = sbuf[q]; const key = Math.round(o.x) + ',' + Math.round(o.z); const pr = SV.get(key); if (!pr || pr.cr < o.cr) SV.set(key, [Math.round(o.x), Math.round(o.z), Math.round(o.cr), o.big ? 1 : 0]) }
  }
  return { n: c.n, startI: c.startI, finishI: c.finishI, gateHalf: c.gateHalf, K: g.race.K, STEPm: Math.hypot(c.px[1] - c.px[0], c.pz[1] - c.pz[0]),
    cps: c.cps.map((q) => [Math.round(q.x), Math.round(q.z), +q.tx.toFixed(4), +q.tz.toFixed(4), q.i]),
    pads: c.pads.map((p) => [Math.round(p.x), Math.round(p.z), +p.tx.toFixed(4), +p.tz.toFixed(4)]),
    mounds: c.mounds, rocks: c.rocks.length,
    px: Array.from(c.px).map(Math.round), pz: Array.from(c.pz).map(Math.round), p0, obs: [...SV.values()] }
})
fs.writeFileSync('tools/optruns/agent/greenway/course.json', JSON.stringify(r))
console.log(JSON.stringify({ ...r, px: r.px.length, pz: undefined, obs: r.obs.length, cps: r.cps.slice(0, 4), pads: r.pads.length }))
await browser.close()
