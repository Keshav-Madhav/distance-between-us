// Orbit → a planet (the live handover): the main thread's stalls (a loop on the top page) against the
// arriving world's boot steps, on one clock.  node tools/arrival.mjs 4495
import { chromium } from 'playwright-core'
import { calm } from './loadguard.mjs'
const port = process.argv[2] ?? '4495'
await calm()
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })).newPage()
await p.goto(`http://localhost:${port}/?course=orbit&q=high&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.waitForTimeout(1500)
await p.evaluate(() => {
  const g = window.__g; window.__gaps = []; let last = performance.now()
  const loop = (t) => { if (t - last > 40) window.__gaps.push([last, t - last]); last = t; requestAnimationFrame(loop) }
  requestAnimationFrame(loop)
  g.system(); g.flyForce(true); Object.assign(g.fc, { pitch: 0, turn: 0, roll: 0, throttle: true, brake: false, burner: true, aim: null })
})
await p.waitForTimeout(25000)
console.log(await p.evaluate(() => {
  const out = [], t0 = performance.timeOrigin
  for (const f of document.querySelectorAll('iframe')) { const w = f.contentWindow; const off = w.performance.timeOrigin - t0; out.push('FRAME ' + new URL(f.src).searchParams.get('course') + ' ' + (w.__boot ?? []).map(([k, t]) => `${k}@${(t + off).toFixed(0)}`).join(' ')) }
  out.push('STALLS ' + window.__gaps.map(([t, d]) => `@${t.toFixed(0)} ${d.toFixed(0)}ms`).join('  '))
  return out.join('\n')
}))
await b.close()
