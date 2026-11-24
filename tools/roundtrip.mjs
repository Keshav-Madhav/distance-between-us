// Ground → ORBIT → a planet, all live handovers between frames: every main-thread stall over 40 ms on the
// way (a loop on the top page), with when each handover happened.  node tools/roundtrip.mjs 4495
import { chromium } from 'playwright-core'
import { calm } from './loadguard.mjs'
const port = process.argv[2] ?? '4495'
await calm()
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })).newPage()
await p.goto(`http://localhost:${port}/?course=sprint&q=high`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.waitForTimeout(1500)
await p.evaluate(() => { window.__gaps = []; let last = performance.now(); const loop = (t) => { if (t - last > 40) window.__gaps.push([Math.round(last), Math.round(t - last)]); last = t; requestAnimationFrame(loop) }; requestAnimationFrame(loop) })
const vis = () => p.evaluate(() => { const fs = [...document.querySelectorAll('iframe')].filter((f) => f.style.opacity === '1').sort((a, b) => +b.style.zIndex - +a.style.zIndex); return fs[0] ? new URL(fs[0].src).searchParams.get('course') : 'top' })
const inTop = (js) => p.evaluate((js) => { const fs = [...document.querySelectorAll('iframe')].filter((f) => f.style.opacity === '1').sort((a, b) => +b.style.zIndex - +a.style.zIndex); const w = fs[0]?.contentWindow ?? window; return new Function('g', js)(w.__g) }, js)
await inTop(`g.free(); g.fly(); g.flyForce(true); Object.assign(g.fc, { aim: null, pitch: 0.8, turn: 0, roll: 0, burner: true, throttle: true, brake: false }); const iv = setInterval(() => { if (g.flight.fwd.y > 0.75) { g.fc.pitch = 0; clearInterval(iv) } }, 50)`)
const events = []
let where = 'top'
for (let i = 0; i < 180; i++) {
  await p.waitForTimeout(500)
  const v = await vis()
  if (v !== where) { events.push(`${v}@${await p.evaluate(() => Math.round(performance.now()))}`); where = v
    if (v === 'orbit') { await p.waitForTimeout(3000); await inTop(`g.flyForce(true); Object.assign(g.fc, { aim: null, pitch: 0, turn: 0, roll: 0, burner: true, throttle: true, brake: false })`) }
    else if (v !== 'top') { await p.waitForTimeout(4000); break } }
}
console.log('handovers:', events.join('  '))
console.log('stalls:', (await p.evaluate(() => window.__gaps)).map(([t, d]) => `@${t} ${d}ms`).join('  '))
await b.close()
