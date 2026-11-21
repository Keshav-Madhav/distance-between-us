// A whole HUNT run on autopilot (invulnerable): waves, kinds, beams, locks, the ending, errors.
//   node tools/huntrun.mjs [seconds]
import { chromium } from 'playwright-core'
const S = +(process.argv[2] ?? 150)
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://localhost:5417/?course=sprint'); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => {
  const g = window.__g; g.startHunt(); g.autopilot(true)
  window.__ev = { charge: 0, beam: 0, lock: 0, launch: 0, hits: 0 }
  const d = g.darts
  const oc = d.onCharge, ol = d.onLockOn, on = d.onLaunch, oh = d.onPlayerHit
  d.onCharge = (x) => { window.__ev.charge++; oc?.(x) }
  d.onLockOn = (x) => { window.__ev.lock++; ol?.(x) }
  d.onLaunch = (x) => { if (x.kind === 'lancer') window.__ev.beam++; else window.__ev.launch++; on?.(x) }
  d.onPlayerHit = (dm, f) => { window.__ev.hits++; oh?.(dm, f) }
  setInterval(() => { g.flight.ghost = 5; g.flight.hull = 100 }, 200)
})
let shot = 0
const t0 = Date.now()
while ((Date.now() - t0) / 1000 < S) {
  await p.waitForTimeout(10000)
  const st = await p.evaluate(() => ({ sub: document.querySelector('#score .sub').textContent, kinds: window.__g.darts.list.filter((d) => d.alive).map((d) => d.kind[0]).join(''), ev: window.__ev, over: !document.querySelector('#over').classList.contains('hide'), head: document.querySelector('#over-h').textContent }))
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s alive[${st.kinds}] ${st.sub.split('·').slice(4, 6).join('·')} ev ${JSON.stringify(st.ev)}${st.over ? ' OVER: ' + st.head : ''}`)
  if (shot++ % 3 === 1) await p.screenshot({ path: `shots/huntrun-${shot}.png` })
  if (st.over) break
}
console.log(errs.length ? 'ERRORS ' + errs.slice(0, 3).join(' | ') : 'no page errors')
await b.close()
