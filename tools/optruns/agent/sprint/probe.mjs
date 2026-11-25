import { chromium } from 'playwright-core'
const [X, Z, R] = process.argv.slice(2).map(Number)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await page.goto(`http://localhost:4480/?course=sprint&fixed=1`)
await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
const r = await page.evaluate(([X, Z, R]) => {
  const g = window.__g, c = g.course, P = g.player
  const cps = c.cps.map((q, k) => [k, Math.round(q.x), Math.round(q.z), q.i, +q.tx.toFixed(3), +q.tz.toFixed(3)])
  const v3 = P.pos.clone().set(X, P.pos.y, Z); g.world.update(v3, 0, undefined, P.vel.clone().set(0, 0, 0))
  const buf = [], out = []
  for (const y of [-200, 0, 5, 50]) { const n = g.world.near(X, Z, y, R, buf); out.push([y, n, buf.slice(0, n).map((o) => [Math.round(o.x), Math.round(o.z), Math.round(o.cr), o.big, o.h ?? o.top ?? null])]) }
  return { K: c.cps.length, gateHalf: c.gateHalf, cps, pads: c.pads.map((p) => [Math.round(p.x), Math.round(p.z)]), ramps: (c.ramps || c.jumps || []).length, out, keys: Object.keys(c).slice(0, 60) }
}, [X, Z, R])
console.log(JSON.stringify(r))
await browser.close()
