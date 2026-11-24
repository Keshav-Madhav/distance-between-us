// The physics-limited floor of a course: the fastest any driver could go, computed — not searched.
//
// The craft's own formulas (src/player.ts, src/config.ts): throttle pulls toward Mach 6.3 (dv/dt = k(T − v));
// the burner adds 230·(1 − (M/12)²) m/s² with no drag above T; every radian turned bleeds 5% of the speed
// (dv/dt −= 0.05·|ω|·v); full lock holds ~1.3–1.5 rad/s at any speed (measured: tools/craftmodel.mjs) and
// the burner locks the stick to a tenth of it. So for any line, the fastest run is a forward pass: burner
// lit wherever the line is gentle enough for its locked stick, throttle elsewhere, never a brake (no bend is
// tighter than full lock holds). The line is then optimised (gradient descent on ~650 lateral offsets) to
// minimise that time — inside the corridor, through every gate, clear of every spire.
// Left out (so the floor is a little optimistic): jumps (half thrust in the air), the start's spool-up
// detail, drafting. A tracker then checks it in the real physics.
//   node tools/minline.mjs 4491 sprint
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const port = process.argv[2] ?? '4491', course = process.argv[3] ?? 'sprint'
const MACH = 343, STEPS = 60
// ── the course, once ──
const geoFile = `tools/optruns/${course}-geo.json`
let geo
if (fs.existsSync(geoFile)) geo = JSON.parse(fs.readFileSync(geoFile, 'utf8'))
else {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
  const p = await (await b.newContext({ viewport: { width: 320, height: 180 } })).newPage()
  await p.goto(`http://localhost:${port}/?course=${course}&fixed=1`)
  await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
  geo = await p.evaluate(() => { const c = window.__g.course
    // Pads and ramps placed on the course (index, lateral offset): nearest course point to each.
    const place = (x, z) => { let bi = 0, bd = Infinity; for (let i = 0; i < c.n; i++) { const d = (c.px[i] - x) ** 2 + (c.pz[i] - z) ** 2; if (d < bd) { bd = d; bi = i } } const [tx, tz] = c.tangent(bi); return { i: bi, lat: (x - c.px[bi]) * -tz + (z - c.pz[bi]) * tx } }
    const pads = c.pads.map((p) => place(p.x, p.z))
    const ramps = []; for (let k = 0; k < c.mounds.length; k += 4) if (c.mounds[k + 2] >= 20) ramps.push({ ...place(c.mounds[k], c.mounds[k + 1]), r: c.mounds[k + 3], h: c.mounds[k + 2] })
    return { n: c.n, px: Array.from(c.px), pz: Array.from(c.pz), startI: c.startI, finishI: c.finishI, gateHalf: c.gateHalf, gates: c.cps.map((g) => g.i), rocks: c.rocks.map((r) => ({ i: r.i, lat: r.lat, r: r.r })), pads, ramps, laps: c.def.laps ?? 1, loop: !!c.def.loop } })
  fs.mkdirSync('tools/optruns', { recursive: true }); fs.writeFileSync(geoFile, JSON.stringify(geo))
  await b.close()
}
const craft = JSON.parse(fs.readFileSync('tools/optruns/craft-model.json', 'utf8'))
const lerpTab = (tab, m, key) => { const t = tab.filter((x) => x[key] !== undefined); if (m <= t[0].mach) return t[0][key]; for (let i = 1; i < t.length; i++) if (m <= t[i].mach) { const u = (m - t[i - 1].mach) / (t[i].mach - t[i - 1].mach); return t[i - 1][key] + (t[i][key] - t[i - 1][key]) * u } return t[t.length - 1][key] }
const omegaMax = (v) => lerpTab(craft.turn, v / MACH, 'yaw')
const omegaBurn = (v) => lerpTab(craft.turnBurn, v / MACH, 'yaw')
const { n, px, pz, startI, finishI } = geo
// Course normal (right) at each point.
const nx = new Float64Array(n), nz = new Float64Array(n)
for (let i = 0; i < n; i++) { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); let tx = px[b] - px[a], tz = pz[b] - pz[a]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; nx[i] = -tz; nz[i] = tx }
const SEG = +(process.env.SEG ?? 6) // course points per control point (6: ~240 m)
const i0 = startI, i1 = finishI
const K = Math.ceil((i1 - i0) / SEG) + 1
const half = geo.gateHalf + 25 // the corridor: the course's clear band (clutter is kept off gateHalf + 30)
// The line's lateral offset at every course point (linear between control points).
// (A smooth curve — Catmull–Rom — through the control points: straight pieces put all the turning into kinks
// at the joints, which no craft can fly and which lit nothing but penalties.)
function latAt(lane, i) {
  const f = Math.max(0, Math.min(K - 1.0001, (i - i0) / SEG)), k = Math.floor(f), u = f - k
  const p0 = lane[Math.max(0, k - 1)], p1 = lane[k], p2 = lane[Math.min(K - 1, k + 1)], p3 = lane[Math.min(K - 1, k + 2)]
  const u2 = u * u, u3 = u2 * u
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
}
// ── the run along a line: time, and how far it breaks the rules ──
// The path sampled every ~10 m; its curvature; the speed each point allows (full lock: v·κ ≤ ω_max); a forward
// pass (throttle, the burner where its locked stick holds the bend, the turn bleed) capped by that, and a
// backward pass with the air brake (dv/dt = −1.8·(v − Mach 0.12), measured) so it brakes as late as it can.
const SUB = 4
function simulate(lane, detail = false) {
  const why = { corridor: 0, spire: 0, gate: 0, spires: 0, gates: 0 }
  let pen = 0
  const N = (i1 - i0) * SUB + 1
  const X = new Float64Array(N), Z = new Float64Array(N)
  for (let j = 0; j < N; j++) {
    const fi = i0 + j / SUB, ia = Math.floor(fi), ib = Math.min(n - 1, ia + 1), u = fi - ia
    const L = latAt(lane, fi)
    if (Math.abs(L) > half) { pen += (Math.abs(L) - half) ** 2 / SUB; why.corridor += (Math.abs(L) - half) ** 2 / SUB }
    const cx = px[ia] + (px[ib] - px[ia]) * u, cz = pz[ia] + (pz[ib] - pz[ia]) * u
    const nnx = nx[ia] + (nx[ib] - nx[ia]) * u, nnz = nz[ia] + (nz[ib] - nz[ia]) * u
    X[j] = cx + nnx * L; Z[j] = cz + nnz * L
  }
  const ds = new Float64Array(N), kap = new Float64Array(N)
  for (let j = 1; j < N; j++) ds[j] = Math.hypot(X[j] - X[j - 1], Z[j] - Z[j - 1])
  for (let j = 1; j < N - 1; j++) {
    const h1 = Math.atan2(X[j] - X[j - 1], Z[j] - Z[j - 1]), h2 = Math.atan2(X[j + 1] - X[j], Z[j + 1] - Z[j])
    let d = h2 - h1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI
    kap[j] = Math.abs(d) / Math.max(1e-3, (ds[j] + ds[j + 1]) / 2)
  }
  // Speed each point allows (full lock), solved against the measured ω_max(v).
  const vlim = new Float64Array(N)
  for (let j = 0; j < N; j++) { let v = 40 * MACH; for (let r = 0; r < 3; r++) v = Math.min(40 * MACH, omegaMax(v) / Math.max(1e-9, kap[j])); vlim[j] = v }
  const T = 6.3 * MACH
  const accel = (v, burn, w) => {
    const m = v / MACH, s0 = Math.min(1, Math.max(0, (m - 0.55) / 0.6)), kk = 0.62 * (0.32 + 0.68 * s0 * s0 * (3 - 2 * s0))
    let a = burn ? 230 * Math.max(0, 1 - (m / 12) ** 2) : 0
    if (!burn || v < T) a += v < T ? kk * (T - v) : -0.04 * (v - T)
    return a - w * 0.05 * v
  }
  // Pads: crossed within 32 m of the centre → +Mach 0.75 (src/race.ts, not in the air).
  const padAt = new Uint8Array(N)
  for (const pd of geo.pads ?? []) { if (pd.i < i0 || pd.i > i1) continue; if (Math.abs(latAt(lane, pd.i) - pd.lat) < 30) padAt[Math.round((pd.i - i0) * SUB)] = 1 }
  // Ramps: kept off (a jump halves thrust and takes away the thrusters' dodge).
  for (const rp of geo.ramps ?? []) { if (rp.i < i0 || rp.i > i1) continue; const gap = Math.abs(latAt(lane, rp.i) - rp.lat) - rp.r * 0.85; if (gap < 0) { pen += gap * gap; why.ramp = (why.ramp ?? 0) + 1 } }
  // Forward.
  const vf = new Float64Array(N); vf[0] = 0.35 * MACH
  const burnAt = new Uint8Array(N)
  for (let j = 1; j < N; j++) {
    let v = vf[j - 1], left = ds[j]
    const w0 = v * kap[j]
    const burn = w0 <= omegaBurn(v); burnAt[j] = burn ? 1 : 0
    while (left > 1e-6) { const dt = Math.min(1 / STEPS, left / Math.max(v, 1)); v = Math.max(5, v + accel(v, burn, v * kap[j]) * dt); left -= v * dt }
    if (padAt[j]) v += 0.75 * MACH
    vf[j] = Math.min(v, vlim[j])
  }
  // Backward (braking).
  const vb = 0.12 * MACH
  for (let j = N - 2; j >= 0; j--) { const cap = vf[j + 1] + 1.8 * (1 - vb / Math.max(vf[j + 1], vb + 1)) * ds[j + 1]; if (vf[j] > cap) vf[j] = cap }
  let t = 0, burnT = 0, turnTot = 0
  const prof = []
  for (let j = 1; j < N; j++) { const v = (vf[j] + vf[j - 1]) / 2, dt = ds[j] / Math.max(v, 1); t += dt; if (burnAt[j]) burnT += dt; turnTot += kap[j] * ds[j]; if (detail && j % (SUB * 25) === 0) prof.push([i0 + j / SUB, +(vf[j] / MACH).toFixed(2), burnAt[j]]) }
  // Spires: the craft (~6 m) clear of each one's radius.
  if (!THRUST) for (const r of geo.rocks) { if (r.i < i0 || r.i > i1) continue; const L = latAt(lane, r.i), gap = Math.abs(L - r.lat) - (r.r + 8); if (gap < 0) { pen += gap * gap; why.spire += gap * gap; why.spires++ } }
  // Gates: through, between the towers.
  for (const gi of geo.gates) { if (gi < i0 || gi > i1) continue; const L = latAt(lane, gi), over = Math.abs(L) - (geo.gateHalf - 15); if (over > 0) { pen += over * over; why.gate += over * over; why.gates++ } }
  return { t, pen, burnT, turnTot, prof, why }
}
const burn_ = (need, v) => need * v <= omegaBurn(v)
const cost = (lane) => { const r = simulate(lane); return r.t + r.pen * 1e-3 }
// ── the taut string: an elastic band through the corridor and the gates, round each spire on the side it
// already passes — relaxed, it is the straightest legal line (the burner's locked stick wants straight). ──
// A push of `amt` at control-point position f, spread as a wide bump (Gaussian, ~±1 km) so the line bends
// round a spire in a long arc — a 480 m kink at Mach 9 needed a hard brake. Scaled to move the line at f by amt.
const SPREAD = +(process.env.SPREAD ?? 2.2)
// THRUST=1: spires are dodged on the side thrusters (strafe 340 m/s², dodge taps +170 m/s every 0.25 s —
// ~200 m/s sideways held, no forward speed lost, no turning), so the steered line only needs the gates.
const THRUST = !!process.env.THRUST
function spread(lane, f, amt) {
  const k0 = Math.round(f), R = Math.ceil(SPREAD * 3), w = []
  let sum = 0
  for (let d = -R; d <= R; d++) { const k = k0 + d; if (k < 1 || k >= K - 1) { w.push(0); continue } const x = (k - f) / SPREAD, v = Math.exp(-0.5 * x * x); w.push(v); sum += v * v }
  if (!sum) return
  for (let d = -R; d <= R; d++) { const k = k0 + d; if (w[d + R]) lane[k] += amt * 0.6 * w[d + R] / Math.sqrt(sum) }
}
function bandFix(lane) {
  if (!THRUST) for (const r of geo.rocks) { if (r.i < i0 || r.i > i1) continue; const f = (r.i - i0) / SEG, L = latAt(lane, r.i), gap = Math.abs(L - r.lat) - (r.r + 14); if (gap < 0) spreadN(lane, f, (L >= r.lat ? 1 : -1) * -gap) }
  for (const gi of geo.gates) { if (gi < i0 || gi > i1) continue; const f = (gi - i0) / SEG, L = latAt(lane, gi), over = Math.abs(L) - (geo.gateHalf - 25); if (over > 0) spreadN(lane, f, -Math.sign(L) * over) }
}
function spreadN(lane, f, amt) { const k = Math.floor(f), u = f - k; if (k < 1 || k + 1 >= K - 1) return; const wa = 1 - u, wb = u, s2 = wa * wa + wb * wb; lane[k] += amt * wa / s2; lane[k + 1] += amt * wb / s2 }
function band(lane, iters) {
  const ci = (k) => Math.min(n - 1, i0 + k * SEG)
  const X = (k, L) => px[ci(k)] + nx[ci(k)] * L, Z = (k, L) => pz[ci(k)] + nz[ci(k)] * L
  const gateK = new Set(geo.gates.filter((gi) => gi >= i0 && gi <= i1).map((gi) => Math.round((gi - i0) / SEG)))
  for (let it = 0; it < iters; it++) {
    for (let k = 1; k < K - 1; k++) {
      const mx = (X(k - 1, lane[k - 1]) + X(k + 1, lane[k + 1])) / 2, mz = (Z(k - 1, lane[k - 1]) + Z(k + 1, lane[k + 1])) / 2
      let L = (mx - px[ci(k)]) * nx[ci(k)] + (mz - pz[ci(k)]) * nz[ci(k)]
      const lim = gateK.has(k) ? geo.gateHalf - 20 : half - 5
      lane[k] = Math.max(-lim, Math.min(lim, L))
    }
    // Gates: the line at each one pulled inside its towers.
    for (const gi of geo.gates) {
      if (gi < i0 || gi > i1) continue
      const f = (gi - i0) / SEG, k = Math.floor(f), u = f - k
      if (k + 1 >= K) continue
      const L = latAt(lane, gi), lim = geo.gateHalf - 25, over = Math.abs(L) - lim
      if (over <= 0) continue
      spread(lane, f, -Math.sign(L) * over)
    }
    // Spires: the line at each one's place pushed out of it, on the side it is on.
    if (!THRUST) for (const r of geo.rocks) {
      if (r.i < i0 || r.i > i1) continue
      const f = (r.i - i0) / SEG, k = Math.floor(f), u = f - k
      if (k + 1 >= K) continue
      const L = latAt(lane, r.i), clear = r.r + 12
      const gap = Math.abs(L - r.lat) - clear
      if (gap >= 0) continue
      const dir = L >= r.lat ? 1 : -1, need = -gap
      spread(lane, f, dir * need)
    }
  }
  return lane
}
let lane = new Float64Array(K)
const c0 = simulate(lane)
console.log(`${course}: ${((i1 - i0) * 0.04).toFixed(0)} km, ${K} control points, ${geo.rocks.length} spires, ${geo.gates.length} gates`)
console.log(`centre line: ${c0.t.toFixed(2)} s (burner ${(100 * c0.burnT / c0.t).toFixed(0)}% of the time, turned ${c0.turnTot.toFixed(1)} rad, penalty ${c0.pen.toFixed(0)})`)
band(lane, +(process.env.BAND ?? 3000))
// Then legal for certain: a narrow push until every spire and gate is clear (the wide bends stay).
{ const keep = SPREAD; for (let r = 0; r < 60; r++) { const w = simulate(lane).why; if (!w.spires && !w.gates) break; globalThis.__narrow = true; bandFix(lane) } void keep }
{ const t0 = performance.now(); simulate(lane); console.log(`(one run: ${(performance.now() - t0).toFixed(1)} ms)`) }
{ const r = simulate(lane); console.log(`taut string: ${r.t.toFixed(3)} s (burner ${(100 * r.burnT / r.t).toFixed(0)}%, turned ${r.turnTot.toFixed(1)} rad, penalty ${r.pen.toFixed(2)} ${JSON.stringify(r.why, (k, v) => typeof v === 'number' ? +v.toFixed(1) : v)})`) }
const m1 = new Float64Array(K), m2 = new Float64Array(K), g = new Float64Array(K)
let lr = 6
const t0 = Date.now()
for (let it = 1; it <= +(process.env.ITERS ?? 220); it++) {
  const base = cost(lane)
  for (let k = 0; k < K; k++) { const h = 2; lane[k] += h; const a = cost(lane); lane[k] -= 2 * h; const b2 = cost(lane); lane[k] += h; g[k] = (a - b2) / (2 * h) }
  for (let k = 0; k < K; k++) { m1[k] = 0.9 * m1[k] + 0.1 * g[k]; m2[k] = 0.999 * m2[k] + 0.001 * g[k] * g[k]; lane[k] -= lr * (m1[k] / (1 - 0.9 ** it)) / (Math.sqrt(m2[k] / (1 - 0.999 ** it)) + 1e-9) }
  if (it % 20 === 0) { lr *= 0.85; const r = simulate(lane); console.log(`iter ${it}: ${r.t.toFixed(3)} s  (burner ${(100 * r.burnT / r.t).toFixed(0)}%, turned ${r.turnTot.toFixed(1)} rad, penalty ${r.pen.toFixed(1)})  ${((Date.now() - t0) / 1000).toFixed(0)} s`) }
}
const fin = simulate(lane, true)
fs.writeFileSync(`tools/optruns/${course}-minline.json`, JSON.stringify({ course, time: fin.t, penalty: fin.pen, burnShare: fin.burnT / fin.t, turned: fin.turnTot, SEG, i0, lane: Array.from(lane), profile: fin.prof }, null, 1))
if (THRUST) {
  // Can the side thrusters make every dodge? For each spire on the line: the sideways shift needed, and the
  // time there is to make it (from the previous spire, at the speed there): the sideways speed asked for.
  const list = geo.rocks.filter((r) => r.i >= i0 && r.i <= i1).sort((a, b) => a.i - b.i)
  let worst = 0, hard = 0
  let prevI = i0, prevOff = 0
  for (const r of list) {
    const L = latAt(lane, r.i), need = Math.max(0, r.r + 14 - Math.abs(L - r.lat))
    const dist = Math.max(40, (r.i - prevI) * 40), vAt = 9 * MACH, t = dist / vAt
    const ask = Math.abs(need - prevOff) / t
    worst = Math.max(worst, ask); if (ask > 200) hard++
    prevI = r.i; prevOff = need
  }
  console.log(`side-thruster dodges: ${list.length} spires on the line; worst sideways speed needed ${worst.toFixed(0)} m/s (~200 m/s holdable); ${hard} beyond it`)
}
console.log(`\nfloor for ${course}: ${fin.t.toFixed(2)} s (line within rules: penalty ${fin.pen.toFixed(2)}; burner lit ${(100 * fin.burnT / fin.t).toFixed(0)}% of the run; ${fin.turnTot.toFixed(1)} rad turned)`)
