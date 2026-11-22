// HUNT weapon checks (phase 2): the lead pipper, heat, the missile rack, arming, and the autopilot
// actually downing Darts.   node tools/huntaim.mjs   (dev server 5417)
import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://localhost:5417/?course=sprint'); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 }); await p.waitForTimeout(800)
const out = []
const check = (name, ok, info) => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`)
await p.evaluate(() => { const g = window.__g; g.startHunt(); g.director(false); g.flyForce(true); g.darts.clear(); Object.assign(g.fc, { pitch: 0, turn: 0, roll: 0, throttle: false, brake: false, burner: false, aim: null }); const f = g.flight; f.reset(f.pos.x, f.pos.z, Math.atan2(f.fwd.x, f.fwd.z), 600, 2.4) })
await p.waitForTimeout(500)
// A crossing dummy, 1.2 km ahead, Mach 2 across the nose; aim at the pipper or at the target.
const crossing = (mode) => p.evaluate((mode) => new Promise((res) => {
  const g = window.__g, f = g.flight, d = g.darts.list[0]
  g.darts.clear(); g.rounds.clear(); g.cannon.reset()
  f.reset(f.pos.x, f.pos.z, Math.atan2(f.fwd.x, f.fwd.z), 600, 2.4)
  d.alive = true; d.dummy = true; d.hp = 1e6; d.killed = false
  let hitN = 0; if (!d._orig) d._orig = d.hit.bind(d); d.hit = (...a) => { hitN++; return d._orig(...a) }
  d.pos.copy(f.pos).addScaledVector(f.fwd, 1200); d.prev.copy(d.pos)
  d.vel.copy(f.right).multiplyScalar(-686) // crossing right → left at Mach 2
  let fired = 0, t0 = performance.now(), aimDir = f.fwd.clone()
  const tick = () => {
    const r = d.pos.clone().sub(f.pos), v = d.vel.clone().sub(f.vel)
    if (mode === 'pipper') {
      const a = v.dot(v) - 2600 * 2600, bb = 2 * r.dot(v), c = r.dot(r), disc = bb * bb - 4 * a * c
      const t = (-bb - Math.sqrt(disc)) / (2 * a) > 0 ? (-bb - Math.sqrt(disc)) / (2 * a) : (-bb + Math.sqrt(disc)) / (2 * a)
      aimDir.copy(r).addScaledVector(v, t).normalize()
    } else aimDir.copy(r).normalize()
    g.fc.aim = aimDir
    // A perfect pilot: the nose held on the aim (this checks the lead, not the flying).
    f.quat.setFromUnitVectors(new f.fwd.constructor(0, 0, 1), aimDir); f.prevQuat.copy(f.quat); f.fwd.copy(aimDir)
    // Fire for 0.9 s only: at 2.4 Mach the range closes fast, and point-blank everything hits.
    g.autoFire(performance.now() - t0 < 900)
    if (performance.now() - t0 < 1900) requestAnimationFrame(tick)
    else { g.autoFire(false); const hits = hitN; res({ hits, fired: g.cannon.firedTotal ?? 0 }) }
  }
  g.cannon.firedTotal = 0
  if (!g.rounds._orig) { g.rounds._orig = g.rounds.spawn.bind(g.rounds); g.rounds.spawn = (...a) => { if (a[3]) g.cannon.firedTotal++; return g.rounds._orig(...a) } }
  tick()
}), mode)
const pip = await crossing('pipper'); const dir = await crossing('target')
check('pipper hits ≥ 70%', pip.fired > 5 && pip.hits / pip.fired >= 0.7, `${pip.hits}/${pip.fired}`)
check('aiming at the target hits < 20%', dir.fired > 5 && dir.hits / dir.fired < 0.2, `${dir.hits}/${dir.fired}`)
// Heat: hold fire 3.1 s → lockout, nothing fires during it.
const heat = await p.evaluate(() => new Promise((res) => {
  const g = window.__g; g.darts.clear(); g.cannon.reset(); g.autoFire(true)
  setTimeout(() => { const locked = g.cannon.lockout > 0; const n0 = g.cannon.firedTotal; setTimeout(() => { g.autoFire(false); res({ locked, during: g.cannon.firedTotal - n0 }) }, 600) }, 3150)
}))
check('overheat after 3 s, nothing during the lockout', heat.locked && heat.during === 0, JSON.stringify(heat))
// Rack: 5 dumb-fire salvos quickly → at most 6 leave.
const rack = await p.evaluate(() => new Promise((res) => {
  const g = window.__g; g.missiles.reset()
  let launched = 0; const ol = g.missiles.onLaunch; g.missiles.onLaunch = () => { launched++; ol?.() }
  let i = 0
  const salvo = () => { window.__g.input.down.add('KeyK'); setTimeout(() => { window.__g.input.down.delete('KeyK'); if (++i < 12) setTimeout(salvo, 60); else setTimeout(() => res({ launched, rack: g.missiles.rack }), 200) }, 60) }
  salvo()
}))
check('missile rack: at most 6 quickly', rack.launched <= 6 && rack.launched >= 5, JSON.stringify(rack))
// Arming: a dummy 150 m ahead, one missile: no hit.
const arm = await p.evaluate(() => new Promise((res) => {
  const g = window.__g, f = g.flight, d = g.darts.list[0]
  g.missiles.reset(); g.darts.clear()
  d.alive = true; d.dummy = true; d.hp = 100; d.pos.copy(f.pos).addScaledVector(f.fwd, 150); d.prev.copy(d.pos); d.vel.copy(f.vel)
  g.input.down.add('KeyK'); setTimeout(() => g.input.down.delete('KeyK'), 40)
  setTimeout(() => res({ hp: d.hp }), 900)
}))
check('missile does not arm inside 250 m', arm.hp === 100, JSON.stringify(arm))
// The autopilot dogfights a flight of 3.
await p.evaluate(() => { const g = window.__g; g.darts.clear(); g.missiles.reset(); g.flyForce(false); g.director(true); g.autopilot(true) })
await p.waitForTimeout(40000)
const k = await p.evaluate(() => ({ kills: window.__g.darts.list.filter((d) => !d.alive).length, score: window.__g.stats().fps, hull: window.__g.flight.hull, down: document.querySelector('#score .sub')?.textContent }))
check('autopilot downs Darts', /\b([1-9]\d*) DOWN/.test(k.down ?? ''), k.down)
await p.screenshot({ path: 'shots/huntaim.png' })
check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '))
console.log(out.join('\n'))
await b.close()
