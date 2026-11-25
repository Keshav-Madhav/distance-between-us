// Closed-loop driver: generates a per-step input file by flying the real sim with g.force (my own controller).
// usage: node ctl.mjs params.json out-inputs.json
// The output is then verified with tools/agentrun.mjs (the replay is what counts).
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const [pf, out] = process.argv.slice(2)
const prmAll = JSON.parse(fs.readFileSync(pf, 'utf8'))
const LIST = Array.isArray(prmAll) ? prmAll : [prmAll]
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const ctx = await browser.newContext({ viewport: { width: 320, height: 180 } })
for (let ci = 0; ci < LIST.length; ci++) {
const prm = LIST[ci]
const page = await ctx.newPage()
await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await page.goto(`http://localhost:4480/?course=mistriver&fixed=1`)
await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
// same warm-up as agentrun
await page.addScriptTag({ content: fs.readFileSync('tools/pdcore.js', 'utf8') })
await page.evaluate((craft) => { window.makePD(null, craft, { look: 1.2, margin: 34, reach: 3, burnK: 1.2, burnErr: 0.1, latV: 150, airAlign: true, sweep: true, strafeK: 20, slow: true, brakeAt: 0.35, tapNear: 35, tapFar: 70 }) }, JSON.parse(fs.readFileSync('tools/optruns/craft-model.json', 'utf8')))
const rep = await page.evaluate(async (prm) => {
  const g = window.__g, P = g.player, c = g.course, race = g.race, MACH = 343
  const cps = c.cps, K = cps.length
  const W = prm.W ?? 280
  // aim points on each gate line: offset u along the gate's normal (n = (tz, -tx))
  const off = new Array(K).fill(0)
  if (prm.off) prm.off.forEach((v, i) => { if (v != null) off[i] = v })
  const pt = (i, u) => [cps[i].x + cps[i].tz * u, cps[i].z - cps[i].tx * u]

  // ── survey: every obstacle near the course (grown by moving the world centre along it) ──
  const SV = new Map(); const sbuf = []
  const v3 = P.pos.clone(), vz3 = P.vel.clone().set(0, 0, 0)
  for (let i = c.startI - 5; i <= c.finishI + 5; i += (prm.svStep ?? 8)) {
    v3.set(c.px[i], P.pos.y, c.pz[i]); g.world.update(v3, 0, undefined, vz3)
    const nn = g.world.near(c.px[i], c.pz[i], -200, prm.svR ?? 2000, sbuf)
    for (let q = 0; q < nn; q++) { const o = sbuf[q]; if (!o.big && o.cr < (prm.smallMin ?? 15)) continue; const key = Math.round(o.x) + ',' + Math.round(o.z); const pr = SV.get(key); if (!pr || pr.cr < o.cr) SV.set(key, { x: o.x, z: o.z, cr: o.cr, big: o.big }) }
  }
  const ALL = [...SV.values()]
  const start = [P.pos.x, P.pos.z]
  const US = []; for (let u = -(prm.W ?? 280); u <= (prm.W ?? 280) + 1e-6; u += (prm.du ?? 20)) US.push(u)
  const UF = US.filter((u) => Math.abs(u) <= (prm.Wf ?? 250))
  const UL = prm.uLim || {}
  const UC = cps.map((_, k) => (k === K - 1 ? UF : US).filter((u) => !UL[k] || (u >= UL[k][0] && u <= UL[k][1])))
  const ucand = (k) => UC[k]
  const MG = prm.mgPlan ?? 70, MGs = prm.mgSmall ?? 25
  const HARD = prm.hard ?? 12, PEN = prm.pen ?? 30
  const clear = (a, b, list) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz
    let pen = 0
    for (const o of list) {
      const R = o.cr + (o.big ? MG : MGs)
      let t = ((o.x - a[0]) * dx + (o.z - a[1]) * dz) / L2; t = Math.max(0, Math.min(1, t))
      const ex = a[0] + t * dx - o.x, ez = a[1] + t * dz - o.z, d = Math.sqrt(ex * ex + ez * ez)
      if (d < o.cr + HARD) return false
      if (d < R) pen += (R - d) * PEN
    }
    return pen
  }
  // obstacles relevant per leg k (from gate k-1 to k): within the bounding box + 600
  const legObs = (a, b) => ALL.filter((o) => o.x > Math.min(a[0], b[0]) - 1200 && o.x < Math.max(a[0], b[0]) + 1200 && o.z > Math.min(a[1], b[1]) - 900 && o.z < Math.max(a[1], b[1]) + 900)
  const lam = prm.lam ?? 3000
  // DP over (u_{k-1}, u_k); leg 0: start -> gate 0
  let best = new Map() // key `${i0},${i1}` for gates (k-1,k) -> {c, prev}
  const hist = []
  {
    const lo = legObs(start, [cps[0].x, cps[0].z])
    const m = new Map()
    ucand(0).forEach((u, j) => { const p = pt(0, u); const cl = clear(start, p, lo); if (cl !== false) m.set('S,' + j, { c: cl + Math.hypot(p[0] - start[0], p[1] - start[1]), prev: null, a: 'S', b: j }) })
    hist.push(m); best = m
  }
  const cornerObs = cps.map((q) => legObs([q.x - 1500, q.z - 1500], [q.x + 1500, q.z + 1500]))
  for (let k = 1; k < K; k++) {
    const m = new Map()
    const lo = legObs(pt(k - 1, 0), pt(k, 0))
    const ck = ucand(k), cp = ucand(k - 1)
    const okLeg = new Map()
    for (const [key, st] of best) {
      const i1 = st.b, A = st.a === 'S' ? start : pt(k - 2, ucand(k - 2)[st.a])
      const B = pt(k - 1, cp[i1])
      const h0 = Math.atan2(B[0] - A[0], B[1] - A[1])
      ck.forEach((u, j) => {
        const C = pt(k, u)
        const lk = i1 + ',' + j
        let ok = okLeg.get(lk); if (ok === undefined) { ok = clear(B, C, lo); okLeg.set(lk, ok) }
        if (ok === false) return
        const h1 = Math.atan2(C[0] - B[0], C[1] - B[1])
        const bs = Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0))
        let bend = Math.abs(bs)
        let cpen = 0
        if (prm.Rc) {
          const cut = prm.Rc * bend * bend / 8; if (Math.abs(cp[i1] + Math.sign(bs) * cut) > (prm.Wc ?? 330)) return
          const T = prm.Rc * Math.tan(bend / 2)
          const P1 = [B[0] - Math.sin(h0) * T, B[1] - Math.cos(h0) * T], P2 = [B[0] + Math.sin(h1) * T, B[1] + Math.cos(h1) * T]
          const Mx = (P1[0] + P2[0]) / 2, Mz = (P1[1] + P2[1]) / 2
          const dB = Math.hypot(B[0] - Mx, B[1] - Mz) || 1, md = prm.Rc * (1 / Math.cos(bend / 2) - 1)
          const M = [B[0] + (Mx - B[0]) / dB * md, B[1] + (Mz - B[1]) / dB * md]
          if (T > 30) {
            const co = cornerObs[k - 1]
            const c1 = clear(P1, M, co), c2 = clear(M, P2, co)
            if (c1 === false || c2 === false) return
            cpen = c1 + c2
          }
        }
        const cc = st.c + ok + cpen + Math.hypot(C[0] - B[0], C[1] - B[1]) + lam * bend * bend + (prm.lam1 ?? 0) * bend
        const nk = i1 + ',' + j
        const pr = m.get(nk)
        if (!pr || pr.c > cc) m.set(nk, { c: cc, prev: key, a: i1, b: j })
      })
    }
    if (m.size === 0) throw new Error('no clear path at leg ' + k)
    hist.push(m); best = m
  }
  let bk = null, bc = 1e18; for (const [key, st] of best) if (st.c < bc) { bc = st.c; bk = key }
  for (let k = K - 1; k >= 0; k--) { const st = hist[k].get(bk); off[k] = ucand(k)[st.b]; bk = st.prev }
  if (prm.offAdd) prm.offAdd.forEach((v, i) => { if (v) off[i] += v })
  var planInfo = { nobs: ALL.length, cost: Math.round(bc) }
  // the last gate (finish) must be inside
  off[K - 1] = Math.max(-(prm.Wf ?? 250), Math.min(prm.Wf ?? 250, off[K - 1]))
  const pts = off.map((u, i) => pt(i, u))
  // polyline from the start position
  const raw = [[P.pos.x, P.pos.z], ...pts.slice(1)]
  let poly = raw
  if (prm.Rc) {
    poly = [raw[0]]
    for (let i = 1; i < raw.length - 1; i++) {
      const A = raw[i - 1], B = raw[i], C = raw[i + 1]
      const h0 = Math.atan2(B[0] - A[0], B[1] - A[1]), h1 = Math.atan2(C[0] - B[0], C[1] - B[1])
      const th = Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0))
      const R = prm.Rc * (prm.RcG && prm.RcG[i] != null ? prm.RcG[i] : 1)
      const T = R * Math.tan(Math.abs(th) / 2)
      const n = Math.max(2, Math.ceil(Math.abs(th) / 0.03))
      // arc from heading h0 to h1, starting T before B
      let x = B[0] - Math.sin(h0) * T, z = B[1] - Math.cos(h0) * T
      poly.push([x, z])
      for (let j = 1; j <= n; j++) {
        const ha = h0 + th * (j - 0.5) / n, ds = Math.abs(th) / n * R
        x += Math.sin(ha) * ds; z += Math.cos(ha) * ds; poly.push([x, z])
      }
    }
    poly.push(raw[raw.length - 1])
  }
  const segLen = []; let cum = [0]
  for (let i = 1; i < poly.length; i++) { segLen.push(Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1])); cum.push(cum[i - 1] + segLen[i - 1]) }
  const total = cum[cum.length - 1]
  const at = (s) => { s = Math.max(0, Math.min(total, s)); let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const f = (s - cum[i - 1]) / (segLen[i - 1] || 1); return [poly[i - 1][0] + f * (poly[i][0] - poly[i - 1][0]), poly[i - 1][1] + f * (poly[i][1] - poly[i - 1][1])] }
  const proj = (x, z) => { let best = 1e18, bs = 0; for (let i = 1; i < poly.length; i++) { const ax = poly[i - 1][0], az = poly[i - 1][1], dx = poly[i][0] - ax, dz = poly[i][1] - az; const L2 = dx * dx + dz * dz || 1; let f = ((x - ax) * dx + (z - az) * dz) / L2; f = Math.max(0, Math.min(1, f)); const ex = ax + f * dx - x, ez = az + f * dz - z, d = ex * ex + ez * ez; if (d < best) { best = d; bs = cum[i - 1] + f * Math.sqrt(L2) } } return bs }
  // heading of the path at s
  const hdg = (s) => { const a = at(s - 60), b = at(s + 60); return Math.atan2(b[0] - a[0], b[1] - a[1]) }
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
  g.hold(true); g.replayWith([0, 0, 1]); g.skipCountdown(); g.hold(true)
  const me = race.racers[0]

  const OBS = []
  const gatherObs = () => {
    // big obstacles near the route ahead (from the current gate on, 3 gates)
    const k0 = me.next, k1 = Math.min(K - 1, k0 + (prm.ahead ?? 3))
    const route = [[P.pos.x, P.pos.z], ...pts.slice(k0, k1 + 1)]
    const seen = new Map()
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(d / 400)
      for (let j = 0; j <= n; j++) {
        const x = a[0] + (b[0] - a[0]) * j / n, z = a[1] + (b[1] - a[1]) * j / n
        const nn = g.world.near(x, z, P.pos.y, prm.qr ?? 900, buf)
        for (let q = 0; q < nn; q++) { const o = buf[q]; if (!o.big && !prm.small) continue; const key = Math.round(o.x) + ',' + Math.round(o.z); const pr = seen.get(key); if (!pr || pr.cr < o.cr) seen.set(key, { x: o.x, z: o.z, cr: o.cr, big: o.big }) }
      }
    }
    OBS.length = 0; for (const o of seen.values()) OBS.push(o)
  }
  const buf = []
  const segHit = (a, b, mg) => {
    let best = null, bt = 2
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz
    for (const o of OBS) {
      const R = o.cr + mg
      let t = ((o.x - a[0]) * dx + (o.z - a[1]) * dz) / L2; t = Math.max(0, Math.min(1, t))
      const ex = a[0] + t * dx - o.x, ez = a[1] + t * dz - o.z
      if (ex * ex + ez * ez < R * R && t < bt && t > 0.0001) { bt = t; best = o }
    }
    return best
  }
  const detour = (a, b, mg, depth) => {
    const o = depth > 0 ? segHit(a, b, mg) : null
    if (!o) return [b]
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz)
    // side: which side of the line the obstacle centre is; go the other way
    const cr = (o.x - a[0]) * dz - (o.z - a[1]) * dx
    const nx = dz / L, nz = -dx / L // right normal
    const sgn = cr > 0 ? -1 : 1
    const R = (o.cr + mg) * 1.25
    const w = [o.x + nx * sgn * R, o.z + nz * sgn * R]
    return [...detour(a, w, mg, depth - 1), ...detour(w, b, mg, depth - 1)]
  }
  let route = null, rcum = null
  const replan = () => {
    gatherObs()
    const k0 = me.next, k1 = Math.min(K - 1, k0 + (prm.ahead ?? 3))
    const mg = (prm.mg ?? 40) + (prm.mgv ?? 0.01) * P.speed
    let r = [[P.pos.x, P.pos.z]]
    for (let k = k0; k <= k1; k++) r.push(...detour(r[r.length - 1], pts[k], mg, prm.detour ?? 0))
    route = r; rcum = [0]
    for (let i = 1; i < r.length; i++) rcum.push(rcum[i - 1] + Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]))
  }
  const rat = (s) => { const tot = rcum[rcum.length - 1]; s = Math.max(0, Math.min(tot, s)); let i = 1; while (i < rcum.length - 1 && rcum[i] < s) i++; const L = rcum[i] - rcum[i - 1] || 1; const f = (s - rcum[i - 1]) / L; return [route[i - 1][0] + f * (route[i][0] - route[i - 1][0]), route[i - 1][1] + f * (route[i][1] - route[i - 1][1])] }
  const rproj = (x, z) => { let best = 1e18, bs = 0; for (let i = 1; i < route.length; i++) { const ax = route[i - 1][0], az = route[i - 1][1], dx = route[i][0] - ax, dz = route[i][1] - az; const L2 = dx * dx + dz * dz || 1; let f = ((x - ax) * dx + (z - az) * dz) / L2; f = Math.max(0, Math.min(1, f)); const ex = ax + f * dx - x, ez = az + f * dz - z, d = ex * ex + ez * ez; if (d < best) { best = d; bs = rcum[i - 1] + f * Math.sqrt(L2) } } return bs }
  const steps = []; const log = []
  let st = 0, tapPh = 0, lastNext = -1
  const evs = []
  let avoided = 0; let wasCrash = false, wasSpin = false, lastHull = 100
  const sched = prm.sched || [] // [{from,to, vmax?, tap?, la?}]
  while (st < 60 * 60 && !me.finished) {
    let cc
    if (st === 0) cc = [0, 0, 1]
    else if (st === 1) cc = [0, 0, 0]
    else {
      const v = P.speed, m = v / MACH
      let la = prm.la ?? 0.35, vmax = prm.vmax ?? 40, tap = prm.tap ?? 2, kp = prm.kp ?? 3, kd = prm.kd ?? 0.25
      for (const e of sched) if (st >= e.from && st < e.to) { if (e.la != null) la = e.la; if (e.vmax != null) vmax = e.vmax; if (e.tap != null) tap = e.tap; if (e.kp != null) kp = e.kp }
      if (prm.vmaxG && prm.vmaxG[me.next] != null) vmax = prm.vmaxG[me.next]
      const tp = prm.tp ?? 0
      const vh0 = Math.atan2(P.vel.x, P.vel.z) || P.heading
      const vh = vh0 + P.yawRate * tp
      const ppx = P.pos.x + Math.sin(vh0 + P.yawRate * tp / 2) * v * tp, ppz = P.pos.z + Math.cos(vh0 + P.yawRate * tp / 2) * v * tp
      const s = proj(ppx, ppz)
      const L = Math.max(prm.laMin ?? 150, v * la)
      const tgt = at(s + L)
      const want = Math.atan2(tgt[0] - ppx, tgt[1] - ppz)
      const err = wrap(want - vh)
      const herr = wrap(want - P.heading)
      // desired yaw rate (pure pursuit): 2 v sin(err) / L
      let yawD = 2 * v * Math.sin(err) / L * kp / 2 + (prm.kh ?? 0) * herr
      if (prm.avoid) {
        // emergency: obstacle on the predicted arc within avoid seconds -> steer away
        let worst = null, wt = 1e9
        for (const o of ALL) {
          const dx = o.x - P.pos.x, dz = o.z - P.pos.z
          if (Math.abs(dx) > v * prm.avoid + 600 || Math.abs(dz) > v * prm.avoid + 600) continue
          const fwd = dx * Math.sin(vh0) + dz * Math.cos(vh0)
          if (fwd < 0 || fwd > v * prm.avoid) continue
          const tt = fwd / v
          const lat = dx * Math.cos(vh0) - dz * Math.sin(vh0) // +: obstacle to the right (+x side when heading +z)
          const curLat = 0.5 * v * P.yawRate * tt * tt // own drift to the right from current yaw
          const rel = lat - curLat
          if (Math.abs(rel) < o.cr + (prm.avoidM ?? 30) && tt < wt) { wt = tt; worst = rel }
        }
        if (worst !== null) { yawD = (worst > 0 ? -1 : 1) * 3; avoided++ }
      }
      if (prm.kff) { const sf = s + v * (prm.tff ?? 0.1), d = 150; const kap = wrap(hdg(sf + d) - hdg(sf - d)) / (2 * d); yawD += prm.kff * kap * v }
      const tm = Math.max(0.05, P.turnMax / (P.burning ? 0.1 : 1))
      let steer = -(yawD - kd * (P.yawRate - yawD) * 0) / tm
      steer = Math.max(-1, Math.min(1, steer))
      // burner: tap if not saturating the turn and below vmax
      const need = Math.abs(yawD) / tm
      let burn = false
      if (m < vmax && need < (prm.burnNeed ?? 0.5)) { burn = (tapPh % tap) === 0; tapPh++ } else tapPh = 0
      let fl = 1 | (burn ? 2 : 0)
      if (prm.brakeOver != null && m > vmax + prm.brakeOver) fl = 4
      cc = [steer, 0, fl]
    }
    g.force({ steer: cc[0], strafe: cc[1], boost: !!(cc[2] & 1), burner: !!(cc[2] & 2), brake: !!(cc[2] & 4), dodgeL: false, dodgeR: false })
    steps.push(cc)
    g.fastSim(1 / 60); st++
    if (P.crashing && !wasCrash) evs.push(['crash', st, Math.round(P.pos.x), Math.round(P.pos.z), +(P.speed/343).toFixed(1), (() => { const nb = g.world.near(P.pos.x, P.pos.z, P.pos.y, 300, buf); const o = []; for (let q = 0; q < nb; q++) o.push([Math.round(buf[q].x), Math.round(buf[q].z), Math.round(buf[q].cr), buf[q].big]); return o })(), OBS.filter((o) => Math.hypot(o.x - P.pos.x, o.z - P.pos.z) < 1500).map((o) => [Math.round(o.x), Math.round(o.z), Math.round(o.cr)]), route && route.map((q) => q.map(Math.round))]); wasCrash = P.crashing
    if (P.hull < lastHull - 0.5) evs.push(['hurt', st, Math.round(lastHull - P.hull), Math.round(P.pos.x), Math.round(P.pos.z), +(P.speed/343).toFixed(1), P.scrapeAt ? [Math.round(P.scrapeAt.x), Math.round(P.scrapeAt.z)] : null]); lastHull = P.hull
    if (P.spin > 0 && !wasSpin) evs.push(['spin', st]); wasSpin = P.spin > 0
    if (st % (prm.logEvery ?? 30) === 0) log.push([+(st / 60).toFixed(2), +(P.speed / MACH).toFixed(1), Math.round(P.pos.x), Math.round(P.pos.z), me.passed, P.airborne ? 'A' : '', (() => { const sp = proj(P.pos.x, P.pos.z), q = at(sp); return Math.round(Math.hypot(q[0] - P.pos.x, q[1] - P.pos.z)) })(), +P.yawRate.toFixed(2), P.burning ? 'B' : ''])
    if (st % 4 === 0) await new Promise((r) => setTimeout(r, 0))
  }
  return { avoided, planInfo, missed: g.snap().missedCount, finished: me.finished, time: me.finished ? me.finishTime : null, passed: me.passed, steps, log, evs, off: off.map((x) => Math.round(x)) }
}, prm)
const outF = LIST.length > 1 ? out.replace('.json', '-' + ci + '.json') : out
fs.writeFileSync(outF, JSON.stringify({ course: 'mistriver', time: rep.time, steps: rep.steps, prm }))
console.log(ci, JSON.stringify(prm), JSON.stringify({ avoided: rep.avoided, planInfo: rep.planInfo, missed: rep.missed, finished: rep.finished, time: rep.time, passed: rep.passed, evs: rep.evs, off: rep.off }))
if (LIST.length === 1) console.log(rep.log.map((r) => r.join(' ')).join('\n'))
await page.close()
}
await browser.close()
