// HUNT flight checks (phase 1): scripted controls through the real sim, asserts, screenshots.
//   node tools/flight.mjs [out dir]   (dev server, 5417)
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
const D = (process.argv[2] ?? 'shots/flight') + '/'
mkdirSync(D, { recursive: true })
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto(`http://localhost:${process.env.PORT ?? 5417}/?course=${process.env.COURSE ?? 'sprint'}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 }); await p.waitForTimeout(1000)
await p.evaluate(() => window.__g.startHunt())
const results = []
const check = (name, ok, info) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`) }
const sample = () => p.evaluate(() => { const f = window.__g.flight; return { y: f.pos.y, agl: f.agl, mach: f.mach, q: Math.hypot(f.quat.x, f.quat.y, f.quat.z, f.quat.w), fy: f.fwd.y, hx: f.fwd.x, hz: f.fwd.z, hull: f.hull, e: f.energy, nan: !Number.isFinite(f.pos.x + f.pos.y + f.pos.z) } })
const set = (o) => p.evaluate((o) => { const fc = window.__g.fc; Object.assign(fc, { pitch: 0, turn: 0, roll: 0, throttle: false, brake: false, burner: false, aim: null }, o); window.__g.flyForce(true) }, o)
// 1) Hands off for 8 s: holds altitude within ±25 m, wings level.
await set({}); await p.waitForTimeout(1500)
let a = await sample(); await p.waitForTimeout(8000); let c = await sample()
check('level flight holds altitude', Math.abs(c.y - a.y) < 25 || Math.abs(c.agl - a.agl) < 25, `${a.agl.toFixed(0)} → ${c.agl.toFixed(0)} m AGL`)
await p.screenshot({ path: D + '1-level.png' })
// 2) Climb: hold pitch up; never above the hard ceiling.
await set({ pitch: 1, throttle: true }); await p.waitForTimeout(9000)
c = await sample(); check('climb stays under the ceiling', c.agl <= 2205, `${c.agl.toFixed(0)} m`)
await p.screenshot({ path: D + '2-climb.png' })
// 3) A loop: pull for 6 s.
await set({ pitch: 1, throttle: true }); await p.waitForTimeout(4000)
await p.screenshot({ path: D + '3-loop.png' })
// 4) Dive at the ground: never below it, no NaN.
await set({ pitch: -1, burner: true }); let minAgl = 1e9
for (let i = 0; i < 20; i++) { await p.waitForTimeout(400); const s = await sample(); minAgl = Math.min(minAgl, s.agl); if (s.nan) break }
c = await sample(); check('dive never goes under the ground', minAgl >= 1.5 && !c.nan, `min AGL ${minAgl.toFixed(1)}, mach ${c.mach.toFixed(2)}`)
await p.screenshot({ path: D + '4-dive.png' })
// 5) Turn hard right for 5 s, then a roll.
await set({ turn: 1, throttle: true }); await p.waitForTimeout(5000)
await p.screenshot({ path: D + '5-turn.png' })
await set({ roll: 1 }); await p.waitForTimeout(1800); await set({}); await p.waitForTimeout(2000)
c = await sample(); check('quaternion stays unit', Math.abs(c.q - 1) < 1e-4, c.q.toFixed(6))
check('speed within limits', c.mach >= 0.89 && c.mach <= 6.21, c.mach.toFixed(2))
// 6) Burner drains energy.
await set({ burner: true }); await p.waitForTimeout(6000); const e = (await sample()).e
check('burner drains energy', e < 20, e.toFixed(0))
// 7) Rings with the autopilot.
await p.evaluate(() => { const g = window.__g, f = g.flight; f.reset(f.pos.x, f.pos.z, Math.atan2(f.fwd.x, f.fwd.z), 80, 2.4); g.director(false); g.darts.clear(); g.rings.passed = 0; g.rings.missed = 0; g.rings.layout(f.pos.x, f.pos.z, Math.atan2(f.fwd.x, f.fwd.z), 3, (x, z, r) => g.world.topAt(x, z, r)); g.flyForce(false); g.autopilot(true) })
for (let i = 0; i < 15; i++) { await p.waitForTimeout(3000); if (process.env.DBG) console.log(await p.evaluate(() => { const g = window.__g, f = g.flight, r = g.rings.items[g.rings.next]; return `n ${g.rings.next} p ${g.rings.passed} d ${(Math.hypot(r.x - f.pos.x, r.z - f.pos.z) / 1000).toFixed(1)} dy ${(r.y - f.pos.y).toFixed(0)} m ${f.mach.toFixed(2)} agl ${f.agl.toFixed(0)} hull ${f.hull.toFixed(0)} fy ${f.fwd.y.toFixed(2)}` })) }
const r = await p.evaluate(() => ({ passed: window.__g.rings.passed, missed: window.__g.rings.missed }))
check('autopilot flies the rings', r.passed >= 6, `${r.passed} passed, ${r.missed} missed`)
await p.screenshot({ path: D + '6-rings.png' })
check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '))
console.log(results.join('\n'))
await b.close()
