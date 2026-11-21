// A full autopilot race segment: count spins/flips per racer, track hull and places.
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage()
await page.goto('http://localhost:4417/?fixed&q=low'); await page.waitForFunction('window.__g && window.__g.ready')
await page.evaluate(() => {
  const g = window.__g; window.__spins = {}
  window.__crash = {}
  for (const r of g.race.racers) { const pc = r.p.onCrashStart; r.p.onCrashStart = (...a) => { const rk = g.course.rocks.reduce((m, k) => Math.min(m, Math.hypot(k.x - r.p.pos.x, k.z - r.p.pos.z) - k.r), 1e9); const oth = g.race.racers.filter((o) => o !== r).reduce((m, o) => Math.min(m, o.p.pos.distanceTo(r.p.pos)), 1e9); const out = []; g.world.near(r.p.pos.x, r.p.pos.z, r.p.pos.y, 60, out); const c = g.course, i0 = c.nearest(r.p.pos.x, r.p.pos.z, r.idx), t = c.tangent(i0), myLat = (r.p.pos.x - c.px[i0]) * -t[1] + (r.p.pos.z - c.pz[i0]) * t[0]; const hit = c.rocks.reduce((m, k) => (Math.hypot(k.x - r.p.pos.x, k.z - r.p.pos.z) < Math.hypot(m.x - r.p.pos.x, m.z - r.p.pos.z) ? k : m)); (window.__why = window.__why || []).push(`aim=${(r.aimLane ?? 0).toFixed(0)} idxGap=${hit.i - r.idx} myLat=${myLat.toFixed(0)} rockLat=${hit.lat.toFixed(0)} r=${hit.r.toFixed(0)} burn=${r.p.burning} steer=${r.controls.steer.toFixed(2)} ` + `${r.name} sev=${a[0].toFixed(2)} rock=${rk.toFixed(0)} racer=${oth.toFixed(0)} near=${out.length} mach=${r.p.mach.toFixed(1)}`); window.__crash[r.name] = (window.__crash[r.name] || 0) + 1; pc && pc(...a) } }
  for (const r of g.race.racers) { const prev = r.p.onSpin; r.p.onSpin = (f) => { window.__spins[r.name] = (window.__spins[r.name] || '') + (f ? 'F' : 's') + (r.p.airTime > 0 && !r.p.airborne ? 'L' : '') + ' '; prev && prev(f) } }
  g.start(); g.autopilot(true)
})
for (let t = 0; t < 4; t++) {
  await page.waitForTimeout(8000)
  console.log(await page.evaluate(() => window.__g.race.racers.map((r) => `${r.name}:P${r.place} g${r.passed} ${(r.p.mach).toFixed(1)}M`).join('  ')))
}
console.log((await page.evaluate(() => window.__why || [])).slice(0, 14).join('\n'))
console.log('spins', JSON.stringify(await page.evaluate(() => window.__spins)), 'crashes', JSON.stringify(await page.evaluate(() => window.__crash)))
await browser.close()
