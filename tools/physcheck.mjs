// Physics invariants, checked on EVERY step of the real game loop (Player.step and FlightCraft.step
// are wrapped in the page), under scripted, autopilot and fuzzed real-key input, in every mode.
//   node tools/physcheck.mjs <scenario> [course] [seconds]
// Scenarios: race-auto, race-fuzz, race-abuse, hunt-fuzz, free-fuzz, free-cases
// Prints a summary of every violation kind with its first examples; exit code 1 if any.
import { chromium } from 'playwright-core'
const [scenario = 'race-auto', course = 'sprint', secsArg] = process.argv.slice(2)
const SECS = +(secsArg ?? 45)
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 960, height: 600 } })).newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
await p.goto(`http://localhost:5417/?course=${course}`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })

// ── the watchers ──
await p.evaluate(() => {
  const g = window.__g, MACH = 343
  const V = (window.__v = { kinds: {}, steps: 0, fsteps: 0, maxMach: 0, maxFMach: 0, minAgl: 1e9, transitions: [], frames: 0 })
  const bad = (kind, info) => { const k = (V.kinds[kind] ??= { n: 0, ex: [] }); k.n++; if (k.ex.length < 4) k.ex.push({ t: +(performance.now() / 1000).toFixed(2), mode: g.mode, ...info }) }
  const fin = (...xs) => xs.every(Number.isFinite)
  const pl = g.player, fl = g.flight
  // Designed events, attributed (not violations): race respawns (wreck, stuck, R), boost pads, drift
  // boosts, the burner's kick, rock deflections.
  V.events = { respawn: 0, pad: 0, drift: 0, deflect: 0 }
  let evStep = -1, respawnFrame = -1
  if (g.race) {
    const rs = g.race.respawn.bind(g.race); g.race.respawn = (r) => { rs(r); if (r.p === pl) { V.events.respawn++; respawnFrame = V.frames } }
    const rn = g.race.respawnNear.bind(g.race); g.race.respawnNear = (r) => { rn(r); if (r.p === pl) { V.events.respawn++; respawnFrame = V.frames } }
    const pd = g.race.pads.bind(g.race); g.race.pads = (r, dt) => { const c0 = r.padCool; pd(r, dt); if (r.p === pl && r.padCool > c0 + 0.5) { V.events.pad++; evStep = V.steps + 1 } }
  }
  const db = pl.onDriftBoost; pl.onDriftBoost = (l) => { V.events.drift++; evStep = V.steps + 1; db?.(l) }
  // Player
  const ps = pl.step.bind(pl)
  pl.step = (dt, c, w, frozen) => {
    const x0 = pl.pos.x, y0 = pl.pos.y, z0 = pl.pos.z, h0 = pl.heading, s0 = Math.hypot(pl.vel.x, pl.vel.z), crash0 = pl.crashing, spin0 = pl.spin > 0 || pl.recover > 0, sc0 = pl.scrape, burn0 = pl.burning
    ps(dt, c, w, frozen)
    if (g.mode === 'title') return
    V.steps++
    const P = pl.pos
    if (!fin(P.x, P.y, P.z, pl.vel.x, pl.vel.y, pl.vel.z, pl.speed, pl.heading, pl.vy, pl.lateral, pl.yawRate)) { bad('player NaN/Inf', { pos: [P.x, P.y, P.z], speed: pl.speed }); return }
    const gr = pl.ground(P.x, P.z)
    if (P.y < gr - 0.05 && !pl.dead) bad('player under the surface', { below: +(gr - P.y).toFixed(2), air: pl.airborne, crash: pl.crashing, mach: +pl.mach.toFixed(2) })
    const m = pl.speed / MACH; V.maxMach = Math.max(V.maxMach, m)
    if (m > (g.course.def.drag ? 31 : 13)) bad('player speed over its cap', { mach: +m.toFixed(2) })
    if (pl.speed < -0.01) bad('player negative speed', { speed: pl.speed })
    const d = Math.hypot(P.x - x0, P.z - z0)
    if (d < 5000 && d > Math.max(s0, pl.speed) * dt * 1.6 + 40) bad('player teleport (xz)', { moved: +d.toFixed(1), expect: +(pl.speed * dt).toFixed(1) })
    if (Math.abs(P.y - y0) > 60 + Math.abs(pl.vy) * dt * 2 && Math.abs(P.y - y0) < 5000) bad('player vertical snap', { dy: +(P.y - y0).toFixed(1), air: pl.airborne, vy: +pl.vy.toFixed(1), mach: +pl.mach.toFixed(2) })
    let dh = pl.heading - h0; dh = Math.atan2(Math.sin(dh), Math.cos(dh))
    const hit = pl.scrape > sc0 + 0.3
    if (hit) V.events.deflect++
    if (!crash0 && !pl.crashing && !spin0 && pl.spin <= 0 && Math.abs(dh) > 0.12 && !hit) bad('player heading snap', { dh: +dh.toFixed(3), mach: +pl.mach.toFixed(2), yaw: +pl.yawRate.toFixed(2), air: pl.airborne, recover: +pl.recover.toFixed(2), tumble: +pl.tumble.toFixed(2), scrape: +pl.scrape.toFixed(2), sc0: +sc0.toFixed(2), dead: pl.dead, hull: +pl.hull.toFixed(0) })
    const ds = Math.hypot(pl.vel.x, pl.vel.z) - s0
    const kick = (pl.burning && !burn0 ? 120 : 0) + (V.steps <= evStep ? 1.85 * MACH : 0)
    if (!pl.crashing && !crash0 && ds > 0.9 * MACH + kick) bad('player speed jump up', { from: +(s0 / MACH).toFixed(2), to: +(pl.speed / MACH).toFixed(2) })
    if (g.mode === 'free' && pl.hull < 100 - 1e-6) bad('FREE ROAM took damage', { hull: pl.hull })
  }
  // FlightCraft
  const fs = fl.step.bind(fl)
  fl.step = (dt, c, w) => {
    const p0 = fl.pos.clone(), f0 = fl.fwd.clone(), s0 = fl.speed
    fs(dt, c, w)
    V.fsteps++
    const P = fl.pos, q = fl.quat
    if (!fin(P.x, P.y, P.z, fl.vel.x, fl.vel.y, fl.vel.z, fl.speed, q.x, q.y, q.z, q.w)) { bad('flight NaN/Inf', { pos: [P.x, P.y, P.z] }); return }
    const ql = Math.hypot(q.x, q.y, q.z, q.w); if (Math.abs(ql - 1) > 1e-3) bad('flight quaternion not unit', { len: ql })
    const gr = fl.ground(P.x, P.z)
    V.minAgl = Math.min(V.minAgl, P.y - gr)
    if (P.y < gr + 2.5) bad('flight under the surface', { below: +(gr - P.y).toFixed(2) })
    const m = fl.speed / MACH; V.maxFMach = Math.max(V.maxFMach, m)
    if (m > (g.mode === 'free' ? 14.01 : 6.21)) bad('flight speed over its cap', { mach: m })
    if (fl.speed < 0.85 * 0.9 * MACH && g.mode === 'hunt') bad('flight under the floor speed', { mach: +m.toFixed(2) })
    const d = p0.distanceTo(P)
    if (d < 5000 && d > Math.max(s0, fl.speed) * dt * 1.6 + 40) bad('flight teleport', { moved: +d.toFixed(1) })
    const turn = Math.acos(Math.min(1, Math.max(-1, f0.dot(fl.fwd))))
    if (turn > 0.08) bad('flight nose snap', { rad: +turn.toFixed(3), agl: +(P.y - gr).toFixed(1) })
    if (fl.speed - s0 > 0.5 * MACH) bad('flight speed jump', { from: +(s0 / MACH).toFixed(2), to: +m.toFixed(2) })
  }
  // Frame-level: the rendered craft never jumps (incl. FREE ROAM's ground ↔ air handovers).
  let lastP = null, lastAir = null, lastS = 0
  const frame = () => {
    if (g.mode !== 'title') {
      V.frames++
      const air = g.freeAir, P = g.player.pos.clone(), s = g.player.speed
      if (lastP) {
        const d = Math.hypot(P.x - lastP.x, P.z - lastP.z), dy = Math.abs(P.y - lastP.y)
        if (V.frames - respawnFrame <= 2) { /* the race put you back on the line */ }
        else if (d < 5000 && d > Math.max(s, lastS) * 0.1 + 60) bad('frame: craft jumped (xz)', { sinceRespawn: V.frames - respawnFrame, d: +d.toFixed(1), air, crashing: g.player.crashing, dead: g.player.dead, recovered: g.player.recovered, spinning: g.player.spin > 0, mach: +(s / MACH).toFixed(2), lastMach: +(lastS / MACH).toFixed(2) })
        if (dy > 80 && dy < 5000) bad('frame: craft jumped (y)', { dy: +dy.toFixed(1), air, was: lastAir })
        if (air !== lastAir && lastAir !== null) {
          V.transitions.push({ to: air ? 'air' : 'ground', mach0: +(lastS / MACH).toFixed(2), mach1: +(s / MACH).toFixed(2), dy: +(P.y - lastP.y).toFixed(1) })
          if (Math.abs(s - lastS) > 0.4 * Math.max(lastS, 300)) bad('handover speed jump', { from: +(lastS / MACH).toFixed(2), to: +(s / MACH).toFixed(2), to_: air ? 'air' : 'ground' })
        }
      }
      lastP = P; lastAir = air; lastS = s
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
})

const wait = (s) => p.waitForTimeout(s * 1000)
const KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft', 'Space', 'KeyC', 'KeyQ', 'KeyE']
const held = new Set()
const key = async (k, on) => { if (on && !held.has(k)) { held.add(k); await p.keyboard.down(k) } else if (!on && held.has(k)) { held.delete(k); await p.keyboard.up(k) } }
const releaseAll = async () => { for (const k of [...held]) await key(k, false) }
let seed = 12345
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
/** Fuzzed real keys: each key flips on/off at random every 0.15-0.6 s, biased so W is often held. */
async function fuzz(secs, keys = KEYS, bias = { KeyW: 0.75, ShiftLeft: 0.4 }) {
  const t0 = Date.now()
  while (Date.now() - t0 < secs * 1000) {
    for (const k of keys) await key(k, rnd() < (bias[k] ?? 0.3))
    if (held.has('KeyA') && held.has('KeyD')) await key(rnd() < 0.5 ? 'KeyA' : 'KeyD', false)
    if (held.has('Space') && held.has('KeyC')) await key('KeyC', false)
    await wait(0.15 + rnd() * 0.45)
  }
  await releaseAll()
}

const log = []
if (scenario === 'race-auto') {
  await p.evaluate(() => { const g = window.__g; g.start(); g.skipCountdown(); g.autopilot(true) })
  await wait(SECS)
} else if (scenario === 'race-fuzz') {
  await p.evaluate(() => { const g = window.__g; g.start(); g.skipCountdown() })
  await wait(1)
  await fuzz(SECS, ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft', 'KeyQ', 'KeyE'])
} else if (scenario === 'race-abuse') {
  // Flat out, burner, hard lock one way then the other: spins, flips, rock hits, the barrier.
  await p.evaluate(() => { const g = window.__g; g.start(); g.skipCountdown() })
  await key('KeyW', true); await key('ShiftLeft', true)
  for (let i = 0; i < SECS / 6; i++) {
    await key('KeyD', true); await wait(2.5); await key('KeyD', false)
    await key('ShiftLeft', false); await key('KeyS', true); await key('KeyA', true); await wait(1.2); await key('KeyS', false); await wait(1.3); await key('KeyA', false); await key('ShiftLeft', true); await wait(1)
  }
  await releaseAll()
} else if (scenario === 'hunt-fuzz') {
  await p.evaluate(() => { const g = window.__g; g.startHunt ? g.startHunt() : g.hunt() })
  await wait(1)
  await fuzz(SECS, ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft', 'KeyC', 'KeyQ', 'KeyE'], { ShiftLeft: 0.5, KeyW: 0.3, KeyS: 0.35 })
} else if (scenario === 'free-fuzz') {
  await p.evaluate(() => window.__g.free())
  await wait(1)
  await fuzz(SECS)
} else if (scenario === 'free-cases') {
  await p.evaluate(() => window.__g.free())
  const st = () => p.evaluate(() => { const g = window.__g, pl = g.player; return { air: g.freeAir, mach: +pl.mach.toFixed(2), agl: +(pl.pos.y - pl.ground(pl.pos.x, pl.pos.z)).toFixed(1), y: +pl.pos.y.toFixed(0), onRock: +(pl.ground(pl.pos.x, pl.pos.z) - g.world.surfaceAt(pl.pos.x, pl.pos.z) + (g.world.surfaceAt(pl.pos.x, pl.pos.z) - (window.__gh ? 0 : 0))).toFixed(1) } })
  // 1. Standing start, crawl, take-off attempt below the speed: nothing must happen.
  // 2. Pull up at speed: lift off; full climb to the ceiling.
  await key('KeyW', true); await key('ShiftLeft', true); await wait(5); log.push(['flat out on the ground', await st()])
  await key('Space', true); await wait(12); log.push(['pulled up 12 s (ceiling?)', await st()]); await key('Space', false)
  // 3. Hands off: the assist should settle into a glide and land.
  await key('ShiftLeft', false); await key('KeyW', false); await wait(25); log.push(['hands off 25 s (glide down?)', await st()])
  // 4. Stall attempt: brake in the air, nose straight up.
  await key('KeyW', true); await wait(3); await key('Space', true); await wait(4); await key('KeyW', false); await key('KeyS', true); await wait(6); log.push(['stall: vertical + brake', await st()]); await key('KeyS', false); await key('Space', false)
  // 5. Nose-dive into the ground at full burner.
  await key('KeyC', true); await key('ShiftLeft', true); await key('KeyW', true); await wait(8); log.push(['full burner nose-dive', await st()]); await key('KeyC', false)
  // 6. Drive at a landform: find the nearest big rock and steer at it flat out (ride up, launch off).
  const tgt = await p.evaluate(() => { const g = window.__g, pl = g.player, w = g.world; let best = null
    for (let a = 0; a < 64; a++) for (const d of [600, 1200, 2000, 3000]) { const x = pl.pos.x + Math.sin(a / 64 * 6.28) * d, z = pl.pos.z + Math.cos(a / 64 * 6.28) * d; const h = w.surfaceAt(x, z) - pl.ground(x, z) + (w.surfaceAt(x, z) > pl.ground(x, z) ? 0 : 0); if (w.surfaceAt(x, z) - (window.__tmpG = 0) > 120 && (!best || d < best.d)) best = { x, z, d } }
    return best })
  log.push(['rock target', tgt])
  if (tgt) {
    const t0 = Date.now()
    while (Date.now() - t0 < 20000) {
      const a = await p.evaluate(([x, z]) => { const g = window.__g, pl = g.player; let a = Math.atan2(x - pl.pos.x, z - pl.pos.z) - pl.heading; return Math.atan2(Math.sin(a), Math.cos(a)) }, [tgt.x, tgt.z])
      // (Steering sign: D turns the heading negative.)
      await key('KeyD', a < -0.08); await key('KeyA', a > 0.08)
      await wait(0.05)
    }
    log.push(['after riding at the rock', await st()])
  }
  await releaseAll()
  // 7. Drop off whatever we are on with nothing held, then idle 10 s.
  await wait(10); log.push(['idle 10 s', await st()])
}

const V = await p.evaluate(() => window.__v)
console.log(`\n== ${scenario} on ${course} (${SECS}s): ${V.steps} player steps, ${V.fsteps} flight steps, ${V.frames} frames · max Mach ground ${V.maxMach.toFixed(2)} air ${V.maxFMach.toFixed(2)} · min flight AGL ${V.minAgl === 1e9 ? '-' : V.minAgl.toFixed(1)}`)
for (const [what, s] of log) console.log('  ·', what, JSON.stringify(s))
console.log(`  designed events: ${V.events.respawn} race respawns · ${V.events.pad} pads · ${V.events.drift} drift boosts · ${V.events.deflect} rock deflections`)
if (V.transitions.length) {
  const ups = V.transitions.filter((t) => t.to === 'air').length
  console.log(`  handovers: ${V.transitions.length} (${ups} to air) · worst speed change ${Math.max(...V.transitions.map((t) => Math.abs(t.mach1 - t.mach0))).toFixed(2)} Mach · worst dy ${Math.max(...V.transitions.map((t) => Math.abs(t.dy))).toFixed(1)} m`)
}
const kinds = Object.entries(V.kinds)
if (!kinds.length) console.log('  ALL INVARIANTS HELD')
for (const [k, v] of kinds) { console.log(`  ✗ ${k}: ${v.n}×`); for (const e of v.ex) console.log('      ', JSON.stringify(e)) }
if (errs.length) console.log('  page errors:', errs.slice(0, 5))
await b.close()
process.exit(kinds.length || errs.length ? 1 : 0)
