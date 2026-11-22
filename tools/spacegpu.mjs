// GPU cost of the climb to space (preview build, Retina density, uncapped): ground vs 10 / 40 / 150 km.
import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
const p = await (await b.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 })).newPage()
await p.goto(`http://localhost:4417/?fixed&q=${process.argv[2] ?? 'ultra'}&course=${process.env.COURSE ?? 'sprint'}`); await p.waitForFunction('window.__g && window.__g.ready')
await p.evaluate(() => {
  const g = window.__g; window.__t = []; let l = performance.now()
  const f = (n) => { window.__t.push(n - l); l = n; requestAnimationFrame(f) }; requestAnimationFrame(f)
  document.getElementById('g-fps').value = 'max'; document.getElementById('g-fps').dispatchEvent(new Event('change'))
  g.free(); g.fly(); g.flyForce(true); Object.assign(g.fc, { pitch: 0, turn: 0, roll: 0, throttle: false, brake: false, burner: false, aim: null })
})
for (const km of [0.3, 10, 40, 150]) {
  await p.evaluate((km) => { const f = window.__g.flight; f.pos.y = f.ground(f.pos.x, f.pos.z) + km * 1000; f.prev.copy(f.pos); f.vel.set(0, 0, 0) }, km)
  await p.waitForTimeout(1200)
  await p.evaluate(() => { window.__t.length = 0 })
  await p.waitForTimeout(2500)
  console.log(`${String(km).padStart(5)} km`, await p.evaluate(() => { const t = window.__t.slice().sort((a, b) => a - b); return `frame p50 ${t[t.length >> 1].toFixed(1)} ms p90 ${t[Math.floor(t.length * 0.9)].toFixed(1)} ms` }))
}
await b.close()
