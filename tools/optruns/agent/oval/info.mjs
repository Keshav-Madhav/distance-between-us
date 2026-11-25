import { chromium } from 'playwright-core'
import fs from 'node:fs'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await page.goto(`http://localhost:4480/?course=oval&fixed=1`)
await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
const r = await page.evaluate(() => {
  const g = window.__g, c = g.course, P = g.player
  const SV = new Map(), sbuf = [], v3 = P.pos.clone(), vz3 = P.vel.clone().set(0, 0, 0)
  for (let i = Math.max(0, c.startI - 5); i <= Math.min(c.n - 1, c.finishI + 5); i += 8) {
    v3.set(c.px[i], P.pos.y, c.pz[i]); g.world.update(v3, 0, undefined, vz3)
    const nn = g.world.near(c.px[i], c.pz[i], -200, 2000, sbuf)
    for (let q = 0; q < nn; q++) { const o = sbuf[q]; const key = Math.round(o.x) + ',' + Math.round(o.z); if (!SV.has(key)) SV.set(key, { x: Math.round(o.x), z: Math.round(o.z), cr: Math.round(o.cr), big: o.big }) }
  }
  return { n: c.n, startI: c.startI, finishI: c.finishI, gateHalf: c.gateHalf, K: g.race.K, length: c.length,
    cps: c.cps.map((q) => ({ x: Math.round(q.x), z: Math.round(q.z), tx: q.tx, tz: q.tz, i: q.i })),
    pads: c.pads.map((p) => ({ x: Math.round(p.x), z: Math.round(p.z), tx: p.tx, tz: p.tz })),
    jumps: c.jumps ?? null,
    px: Array.from(c.px).filter((_, i) => i % 5 === 0).map(Math.round), pz: Array.from(c.pz).filter((_, i) => i % 5 === 0).map(Math.round),
    obs: [...SV.values()], player: { x: P.pos.x, z: P.pos.z, h: P.heading }, keys: Object.keys(c) }
})
fs.writeFileSync('tools/optruns/agent/oval/course.json', JSON.stringify(r))
console.log(JSON.stringify({ ...r, px: r.px.length, pz: undefined, obs: r.obs.length }))
await browser.close()
