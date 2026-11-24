// The perfect driver: flies a computed line (tools/minline.mjs) in the REAL physics, a sim step at a time
// (TIME TRIAL — deterministic, replayable). Pure pursuit on the line for the heading; the burner whenever
// the line ahead is gentle enough for its locked stick; the air brake only if a bend needs it; spires
// dodged on the side thrusters (strafe holds the sideways target, dodge taps for the big moves), never by
// steering. Reports the real finish time against the computed floor.
//   node tools/perfectdrive.mjs 4491 sprint [line.json]      (no line: the centre line)
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { calm } from './loadguard.mjs'
const port = process.argv[2] ?? '4491', course = process.argv[3] ?? 'sprint', lineFile = process.argv[4]
const line = lineFile ? JSON.parse(fs.readFileSync(lineFile, 'utf8')) : null
const craft = JSON.parse(fs.readFileSync('tools/optruns/craft-model.json', 'utf8'))
await calm()
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 320, height: 180 } })).newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto(`http://localhost:${port}/?course=${course}&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { localStorage.setItem('dbu-sub', 'trial'); document.querySelector('#submodes button[data-sub=trial]').click() })
const res = await p.evaluate(async ([line, craft, opts]) => {
  const g = window.__g, c = g.course, P = g.player, MACH = 343
  const n = c.n
  // The line's lateral offset at any course index (Catmull–Rom through its control points).
  const latAt = (i) => {
    if (!line) return 0
    const K = line.lane.length, f = Math.max(0, Math.min(K - 1.0001, (i - line.i0) / line.SEG)), k = Math.floor(f), u = f - k
    const A = line.lane, p0 = A[Math.max(0, k - 1)], p1 = A[k], p2 = A[Math.min(K - 1, k + 1)], p3 = A[Math.min(K - 1, k + 2)]
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u)
  }
  const tan = (i) => c.tangent(Math.max(0, Math.min(n - 1, i)))
  const ptAt = (fi) => { const i = Math.max(0, Math.min(n - 2, Math.floor(fi))), u = fi - i, L = latAt(fi); const [tx, tz] = tan(i); return [c.px[i] + (c.px[i + 1] - c.px[i]) * u - tz * L, c.pz[i] + (c.pz[i + 1] - c.pz[i]) * u + tx * L] }
  const lerpTab = (tab, m, key) => { const t = tab.filter((x) => x[key] !== undefined); if (m <= t[0].mach) return t[0][key]; for (let i = 1; i < t.length; i++) if (m <= t[i].mach) { const u = (m - t[i - 1].mach) / (t[i].mach - t[i - 1].mach); return t[i - 1][key] + (t[i][key] - t[i - 1][key]) * u } return t[t.length - 1][key] }
  const wBurn = (v) => lerpTab(craft.turnBurn, v / MACH, 'yaw'), wMax = (v) => lerpTab(craft.turn, v / MACH, 'yaw')
  // Curvature of the line around index fi (over ±span points).
  const kappa = (fi, span) => { const a = ptAt(fi - span), m = ptAt(fi), z = ptAt(fi + span); const h1 = Math.atan2(m[0] - a[0], m[1] - a[1]), h2 = Math.atan2(z[0] - m[0], z[1] - m[1]); let d = h2 - h1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d) / (span * 2 * 40) }
  const rocks = c.rocks.slice().sort((a, b) => a.i - b.i)
  // Pads (+Mach 0.75) to drive through, ramps (a jump: half thrust, no dodge) to go round.
  const place = (x, z) => { let bi = 0, bd = Infinity; for (let k = 0; k < n; k++) { const d = (c.px[k] - x) ** 2 + (c.pz[k] - z) ** 2; if (d < bd) { bd = d; bi = k } } const [tx, tz] = c.tangent(bi); return { i: bi, lat: (x - c.px[bi]) * -tz + (z - c.pz[bi]) * tx } }
  const pads = c.pads.map((q) => place(q.x, q.z)).sort((a, b) => a.i - b.i)
  const ramps = []; for (let k = 0; k < c.mounds.length; k += 4) if (c.mounds[k + 2] >= 20) ramps.push({ ...place(c.mounds[k], c.mounds[k + 1]), r: c.mounds[k + 3] })
  ramps.sort((a, b) => a.i - b.i)
  g.start(); g.skipCountdown(); g.autopilot(false); g.hold(true); P.noCollide = false
  const me = g.race.racers[0]
  const ctl = { steer: 0, strafe: 0, boost: true, burner: false, brake: false, dodgeL: false, dodgeR: false }
  g.force(ctl)
  let steps = 0, burnSteps = 0, dodges = 0, crashes = 0, wasCrash = false
  const crashLog = []
  let lastTarget = 0
  const STEP = 1 / 60
  while (!me.finished && steps < 60 * 300) {
    const v = Math.max(P.speed, 30), i = me.idx
    const [tx, tz] = tan(i)
    const myLat = (P.pos.x - c.px[i]) * -tz + (P.pos.z - c.pz[i]) * tx
    // Heading: pure pursuit toward the line ahead (long look-ahead at speed: smooth, few corrections).
    const look = Math.max(12, (v * opts.look) / 40)
    // (Aimed at the planned sideways target, not the bare line: steering and thrusters pull the same way.)
    const [lx, lz] = ptAt(i + look), [tx2, tz2] = tan(Math.floor(i + look)), off = lastTarget - latAt(i + look)
    const ax = lx - tz2 * off, az = lz + tx2 * off
    const want = Math.atan2(ax - P.pos.x, az - P.pos.z)
    let err = want - P.heading; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI
    const dist = Math.hypot(ax - P.pos.x, az - P.pos.z)
    const yawWant = (2 * v * Math.sin(err)) / Math.max(1, dist)
    // Burner: the bend just ahead within its locked stick, and the nose on the line.
    const kAhead = Math.max(kappa(i + look * 0.3, 6), kappa(i + look * 0.7, 6))
    // (The burner locks the stick, not the thrusters: dodging under it is fine.)
    const burnOk = v * kAhead <= wBurn(v) * opts.burnK && Math.abs(err) < opts.burnErr
    // Brake: only if a bend ahead (within braking reach) is tighter than full lock holds at this speed.
    let brake = false
    for (let d = 10; d < (v * 2.5) / 40; d += 10) { const kk = kappa(i + d, 4); if (v * kk > wMax(v) * 0.92) { brake = true; break } }
    // Spires: the sideways target clears the next one in reach; thrusters move us there.
    // Every spire within reach (~2 s), against the line AND where the craft actually is: the target is moved
    // clear of the nearest one that either is close to; in the air (half thrust) it is settled earlier.
    // Lateral plan for the next stretch: every sideways position across the corridor (10 m apart), scored —
    // inside any spire's or ramp's clearance in reach is ruled out, a pad in reach pulls, the racing line pulls
    // gently, staying where it is pulls (no flip-flop). The best is the sideways target.
    const reach = v * (P.airborne ? 3.4 : opts.reach), lim = c.gateHalf - 30
    const obs = []
    for (const r of rocks) { if (r.i < i - 2) continue; const ahead = (r.i - i) * 40; if (ahead > reach) break; obs.push([r.lat, r.r + opts.margin, ahead]) }
    for (const q of ramps) { if (q.i < i - 4) continue; const ahead = (q.i - i) * 40; if (ahead > reach) break; obs.push([q.lat, q.r * 0.95 + 25, ahead]) }
    let padLat = null
    for (const q of pads) { if (q.i < i) continue; if ((q.i - i) * 40 > v * 1.4) break; padLat = q.lat; break }
    const lineL = latAt(i + Math.min(60, reach / 40))
    let target = lineL, bestC = Infinity, danger = 0
    for (let L = -lim; L <= lim; L += 10) {
      let cost = Math.abs(L - lineL) * 0.02 + Math.abs(L - lastTarget) * 0.01
      if (padLat !== null) cost += Math.abs(L - padLat) * 0.05
      let blocked = false
      for (const [ol, cl] of obs) if (Math.abs(L - ol) < cl) { blocked = true; break }
      if (blocked) continue
      // Reaching it in time: the sideways distance from here, against the time to the nearest obstacle.
      const near = obs.length ? Math.min(...obs.map((o) => o[2])) : reach
      cost += Math.max(0, Math.abs(L - myLat) - 0.25 * (near / Math.max(v, 1)) * 200) * 0.05
      if (cost < bestC) { bestC = cost; target = L }
    }
    if (obs.length) danger = 1 - Math.min(...obs.map((o) => o[2])) / reach
    lastTarget = target
    const e = target - myLat
    ctl.steer = Math.max(-1, Math.min(1, -yawWant / Math.max(0.15, P.turnMax)))
    ctl.burner = burnOk && !brake
    ctl.brake = brake
    ctl.boost = !brake
    ctl.strafe = Math.max(-1, Math.min(1, e / 20 - P.side / 140))
    const tap = danger > 0.4 ? 35 : 70
    ctl.dodgeL = e < -tap && P.side > -180; ctl.dodgeR = e > tap && P.side < 180
    if (ctl.dodgeL || ctl.dodgeR) dodges++
    if (ctl.burner) burnSteps++
    g.fastSim(STEP); steps++
    if (P.crashing && !wasCrash) { crashes++; const near = rocks.reduce((b, r) => Math.abs(r.i - i) < Math.abs(b.i - i) ? r : b, rocks[0]); crashLog.push({ t: +(steps / 60).toFixed(1), i, mach: +(v / MACH).toFixed(1), myLat: +myLat.toFixed(0), target: +target.toFixed(0), rock: near ? { di: near.i - i, lat: +near.lat.toFixed(0), r: +near.r.toFixed(0) } : null, air: P.airborne }) }
    wasCrash = P.crashing
    if (steps % 600 === 0) await new Promise((r) => setTimeout(r, 0))
  }
  g.force(null); g.hold(false)
  return { crashLog, finished: me.finished, time: me.finished ? me.finishTime : null, simSeconds: steps / 60, burnShare: burnSteps / steps, dodges, crashes, missed: g.race.racers[0].missed ?? null, progress: +(g.race.progress(me) / n).toFixed(3) }
}, [line, craft, { look: +(process.env.LOOK ?? 1.2), margin: +(process.env.MARGIN ?? 34), reach: +(process.env.REACH ?? 3), burnK: +(process.env.BURNK ?? 0.95), burnErr: +(process.env.BURNERR ?? 0.05) }])
console.log(`${course} ${line ? `line ${lineFile.split('/').pop()} (computed ${line.time.toFixed(2)} s)` : 'centre line'}: ${JSON.stringify(res)}`, errs.length ? errs : '')
await b.close()
