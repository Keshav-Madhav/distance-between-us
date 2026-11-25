// ctl.mjs — a closed-loop driver that writes a per-step input file for tools/agentrun.mjs, for ANY course.
//
//   node tools/optruns/agent/ctl.mjs <course> <params.json | list.json> <out.json>
//
// It flies the real sim (g.force + g.fastSim, same warm-up as agentrun) with its own planner + steering and
// records every step's inputs. A list of params runs each config in turn (one browser, one run at a time) and
// writes out-<i>.json. ALWAYS verify the result with: node tools/agentrun.mjs run <course> out.json
// (the replay matched the driver's own time exactly on MISTRIVER, every time).
//
// How it drives:
//  1. Survey: moves the world centre along the course so every obstacle is placed, and records all of them
//     (big rocks/mesas wreck you; small ones drain hull — at Mach 10+ one hit kills → respawn, so keep them).
//  2. Plan: dynamic programming over one crossing offset u per node (gate line ±W; optionally boost pads,
//     ±padW across the pad) minimising length + lam·bend² + obstacle-proximity penalty; legs and the
//     arc-rounded corners (radius Rc) that touch an obstacle are forbidden; optional corridor `corr`
//     (max metres from the centreline along legs/arcs — for "ideal" runs).
//  3. Fly: predictive pure pursuit on the arc-rounded route (look-ahead la·v, prediction tp s).
//     Burner: held while the asked-for turn is < burnNeed of full lock and Mach < vmax (burning locks
//     steering to 10%). tap>1 presses it every tap-th step instead (only useful if the press kick pays).
//
// Params (all optional): W 280, Wf 250 (finish half-window), du 20, lam 3000, Rc 0 (arc radius m; ~5000-9000
// is good), Wc 330 (gate half-window the corner cut must stay in), mgPlan 70 / mgSmall 25 (clearance m for
// big / small obstacles, soft), hard 12, pen 30, smallMin 0 (ignore small rocks under this radius), pads
// false, padW 20, corr 0, la 0.25, laMin 150, kp 2, tp 0.12, vmax 40, vmaxG [per next-gate index],
// burnNeed 0.5, tap 1, brakeOver null (brake when Mach > vmax+this), uLim {gateIdx: [umin, umax]},
// logEvery 30 (log printed for single runs: t mach x z passed air pathErr yawRate burner).
// More: lam1 (cost per radian of bend: turning bleeds ~5% speed per radian), padCut (how far the corner
// arc may cut at a pad node), padT (from padT·v metres before a planned pad: burner off, aim straight at
// the pad — this is what actually collects pads; .15-.5), padAimMin 120, burnErr (burn only while within
// this many metres of the route), mid (add centreline nodes every `mid` course points between gates —
// needed with corr, since straight legs leave the corridor), midW 200, midCut.
// Output line: time, missed, pads collected, maxLat (every step) / maxLat30 (at the bench's 0.5 s
// samples) metres from the centreline, top Mach, events (hurt/crash/spin), the chosen offsets.
// Physics notes (MISTRIVER, Nov 2026): the burner kick now recharges (1.5 s off for a full one), so hold
// it; burner thrust fades to 0 at Mach 12, so above ~Mach 11 pads (+0.75) and fewer radians of turning
// matter more than burning; at Mach 8+ slides cost more than a drift boost gives; small rocks are deadly.
// Good MISTRIVER starting points: mistriver/best-params.json (rogue), mistriver/ideal-params.json.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const [course, pf, out] = process.argv.slice(2)
if (!out) { console.error('usage: node tools/optruns/agent/ctl.mjs <course> <params.json|list.json> <out.json>'); process.exit(1) }
const prmAll = JSON.parse(fs.readFileSync(pf, 'utf8'))
const LIST = Array.isArray(prmAll) ? prmAll : [prmAll]
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const ctx = await browser.newContext({ viewport: { width: 320, height: 180 } })
for (let ci = 0; ci < LIST.length; ci++) {
  const prm = LIST[ci]
  const page = await ctx.newPage()
  await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
  await page.goto(`http://localhost:${process.env.PORT ?? '4480'}/?course=${course}&fixed=1`)
  await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
  await page.addScriptTag({ content: fs.readFileSync('tools/pdcore.js', 'utf8') })
  await page.evaluate((craft) => { window.makePD(null, craft, { look: 1.2, margin: 34, reach: 3, burnK: 1.2, burnErr: 0.1, latV: 150, airAlign: true, sweep: true, strafeK: 20, slow: true, brakeAt: 0.35, tapNear: 35, tapFar: 70 }) }, JSON.parse(fs.readFileSync('tools/optruns/craft-model.json', 'utf8')))
  let rep
  try {
    rep = await page.evaluate(async (prm) => {
      const g = window.__g, P = g.player, c = g.course, race = g.race, MACH = 343
      const cps = c.cps, K = cps.length
      const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
      // ── nodes: the gates (+ pads), in course order ──
      const nodes = cps.map((q, k) => ({ x: q.x, z: q.z, tx: q.tx, tz: q.tz, i: q.i, gate: k }))
      if (prm.pads) for (const p of c.pads) {
        const LS = prm.lapSplit ?? 0, rngs = LS ? [[cps[0].i, cps[LS].i], [cps[LS].i, cps[K - 1].i - 3]] : [[0, c.n]]
        for (const [r0, r1] of rngs) {
        let i = -1, bd = 1e18; for (let j = r0; j < r1; j++) { const d = (c.px[j] - p.x) ** 2 + (c.pz[j] - p.z) ** 2; if (d < bd) { bd = d; i = j } }
        if (i < 0 || bd > 400 * 400) continue
        if (i < cps[0].i || i >= cps[K - 1].i - 3) continue
        if (prm.padSkip && prm.padSkip.includes(Math.round(p.z))) continue
        nodes.push({ x: p.x, z: p.z, tx: p.tx, tz: p.tz, i, gate: -1 })
        }
      }
      if (prm.mid) for (let k = 1; k < K; k++) {
        const i0 = cps[k - 1].i, i1 = cps[k].i, hp = prm.midH && Math.abs(wrap(Math.atan2(cps[k].tx, cps[k].tz) - Math.atan2(cps[k - 1].tx, cps[k - 1].tz))) > 0.4, n = Math.floor((i1 - i0) / (hp ? prm.midH : prm.mid))
        for (let j = 1; j < n; j++) { const i = Math.round(i0 + (i1 - i0) * j / n), [tx, tz] = c.tangent(i); nodes.push({ x: c.px[i], z: c.pz[i], tx, tz, i, gate: -2 }) }
      }
      nodes.sort((a, b) => a.i - b.i)
      let N = nodes.length
      const pt = (k, u) => [nodes[k].x + nodes[k].tz * u, nodes[k].z - nodes[k].tx * u]
      // centreline lateral of a point (near course index hint)
      const latOf = (x, z, hint) => {
        let bi = hint, bd = 1e18
        for (let i = Math.max(0, hint - 160); i < Math.min(c.n, hint + 160); i += 2) { const d = (c.px[i] - x) ** 2 + (c.pz[i] - z) ** 2; if (d < bd) { bd = d; bi = i } }
        return Math.sqrt(bd)
      }
      // ── survey ──
      const SV = new Map(), sbuf = []
      const v3 = P.pos.clone(), vz3 = P.vel.clone().set(0, 0, 0)
      for (let i = Math.max(0, c.startI - 5); i <= Math.min(c.n - 1, c.finishI + 5); i += (prm.svStep ?? 8)) {
        v3.set(c.px[i], P.pos.y, c.pz[i]); g.world.update(v3, 0, undefined, vz3)
        const nn = g.world.near(c.px[i], c.pz[i], -200, prm.svR ?? 2000, sbuf)
        for (let q = 0; q < nn; q++) { const o = sbuf[q]; if (!o.big && o.cr < (prm.smallMin ?? 0)) continue; const key = Math.round(o.x) + ',' + Math.round(o.z); const pr = SV.get(key); if (!pr || pr.cr < o.cr) SV.set(key, { x: o.x, z: o.z, cr: o.cr, big: o.big }) }
      }
      const ALL = [...SV.values()]
      const start = [P.pos.x, P.pos.z]
      const W = prm.W ?? 280, du = prm.du ?? 20, padW = prm.padW ?? 20
      const US = []; for (let u = -W; u <= W + 1e-6; u += du) US.push(u)
      const UL = prm.uLim || {}
      const mkUC = () => nodes.map((n, k) => {
        if (n.gate === -2) { const a = []; const mw = prm.midW ?? 200; for (let u = -mw; u <= mw + 1e-6; u += du) a.push(u); return a }
        if (n.gate < 0) { const a = []; for (let u = -padW; u <= padW + 1e-6; u += Math.min(du, padW || 1)) a.push(u); return a.length ? a : [0] }
        let a = n.gate === K - 1 ? US.filter((u) => Math.abs(u) <= (prm.Wf ?? 250)) : US
        const l = UL[n.gate]; if (l) a = a.filter((u) => u >= l[0] && u <= l[1])
        return a
      })
      let UC = mkUC()
      const half = (k) => nodes[k].gate === -2 ? (prm.midCut ?? (prm.midW ?? 200) + 30) : nodes[k].gate < 0 ? (prm.padCut ?? padW + 8) : (prm.Wc ?? 330)
      const MG = prm.mgPlan ?? 70, MGs = prm.mgSmall ?? 25, HARD = prm.hard ?? 12, PEN = prm.pen ?? 30, CORR = prm.corr ?? 0
      const clear = (a, b, list, hint) => {
        const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1
        let pen = 0
        for (const o of list) {
          const R = o.cr + (o.big ? MG : MGs)
          let t = ((o.x - a[0]) * dx + (o.z - a[1]) * dz) / L2; t = Math.max(0, Math.min(1, t))
          const ex = a[0] + t * dx - o.x, ez = a[1] + t * dz - o.z, d = Math.sqrt(ex * ex + ez * ez)
          if (d < o.cr + HARD) return false
          if (d < R) pen += (R - d) * PEN
        }
        if (CORR) { const n = Math.ceil(Math.sqrt(L2) / 250); for (let j = 1; j < n; j++) if (latOf(a[0] + dx * j / n, a[1] + dz * j / n, hint) > CORR) return false }
        return pen
      }
      const legObs = (a, b) => ALL.filter((o) => o.x > Math.min(a[0], b[0]) - 1500 && o.x < Math.max(a[0], b[0]) + 1500 && o.z > Math.min(a[1], b[1]) - 1500 && o.z < Math.max(a[1], b[1]) + 1500)
      const lam = prm.lam ?? 3000, Rc = prm.Rc ?? 0
      let hist, best, cornerObs, failed; const dropped = []
      for (let attempt = 0; attempt < 30; attempt++) {
      failed = false
      hist = []; best = new Map()
      {
        const lo = legObs(start, pt(0, 0)), m = new Map()
        UC[0].forEach((u, j) => { const p = pt(0, u); const cl = clear(start, p, lo, nodes[0].i); if (cl !== false) m.set('S,' + j, { c: cl + Math.hypot(p[0] - start[0], p[1] - start[1]), prev: null, a: 'S', b: j }) })
        hist.push(m); best = m
      }
      cornerObs = nodes.map((q) => legObs([q.x, q.z], [q.x, q.z]))
      for (let k = 1; k < N; k++) {
        const m = new Map(), lo = legObs(pt(k - 1, 0), pt(k, 0)), ck = UC[k], cp = UC[k - 1], okLeg = new Map()
        for (const [key, st] of best) {
          const i1 = st.b, A = st.a === 'S' ? start : pt(k - 2, UC[k - 2][st.a]), B = pt(k - 1, cp[i1])
          const h0 = Math.atan2(B[0] - A[0], B[1] - A[1])
          ck.forEach((u, j) => {
            const C = pt(k, u), lk = i1 + ',' + j
            let ok = okLeg.get(lk); if (ok === undefined) { ok = clear(B, C, lo, (nodes[k - 1].i + nodes[k].i) >> 1); okLeg.set(lk, ok) }
            if (ok === false) return
            const h1 = Math.atan2(C[0] - B[0], C[1] - B[1]), bs = wrap(h1 - h0), bend = Math.abs(bs)
            let cpen = 0
            if (Rc && k - 1 > 0) {
              const cut = Rc * bend * bend / 8; if (Math.abs(cp[i1] + Math.sign(bs) * cut) > half(k - 1)) return
              const T = Rc * Math.tan(bend / 2)
              if (T > 30) {
                const P1 = [B[0] - Math.sin(h0) * T, B[1] - Math.cos(h0) * T], P2 = [B[0] + Math.sin(h1) * T, B[1] + Math.cos(h1) * T]
                const Mx = (P1[0] + P2[0]) / 2, Mz = (P1[1] + P2[1]) / 2, dB = Math.hypot(B[0] - Mx, B[1] - Mz) || 1, md = Rc * (1 / Math.cos(bend / 2) - 1)
                const M = [B[0] + (Mx - B[0]) / dB * md, B[1] + (Mz - B[1]) / dB * md]
                const c1 = clear(P1, M, cornerObs[k - 1], nodes[k - 1].i), c2 = clear(M, P2, cornerObs[k - 1], nodes[k - 1].i)
                if (c1 === false || c2 === false) return
                cpen = c1 + c2
              }
            }
            const cc = st.c + ok + cpen + Math.hypot(C[0] - B[0], C[1] - B[1]) + lam * bend * bend + (prm.lam1 ?? 0) * bend + (prm.lamK ? prm.lamK * bend * bend * 2 / (Math.hypot(C[0] - B[0], C[1] - B[1]) + Math.hypot(B[0] - A[0], B[1] - A[1]) + 1) : 0)
            const pr = m.get(lk)
            if (!pr || pr.c > cc) m.set(lk, { c: cc, prev: key, a: i1, b: j })
          })
        }
        if (m.size === 0) { if (nodes[k].gate === -1 || (k > 0 && nodes[k - 1].gate === -1)) { const kk = nodes[k].gate === -1 ? k : k - 1; dropped.push(Math.round(nodes[kk].z)); nodes.splice(kk, 1); N = nodes.length; UC = mkUC(); failed = true; break } throw new Error('no clear path at node ' + k + ' (gate ' + nodes[k].gate + ')') }
        hist.push(m); best = m
      }
      if (!failed) break
      }
      let bk = null, bc = 1e18; for (const [key, st] of best) if (st.c < bc) { bc = st.c; bk = key }
      const off = new Array(N).fill(0)
      for (let k = N - 1; k >= 0; k--) { const st = hist[k].get(bk); off[k] = UC[k][st.b]; bk = st.prev }
      const pts = off.map((u, k) => pt(k, u))
      // ── route: start + node points, corners rounded with arcs of radius Rc ──
      const raw = [start, ...pts.slice(1)]
      let poly = raw
      if (Rc) {
        poly = [raw[0]]
        for (let i = 1; i < raw.length - 1; i++) {
          const A = raw[i - 1], B = raw[i], C = raw[i + 1]
          const h0 = Math.atan2(B[0] - A[0], B[1] - A[1]), h1 = Math.atan2(C[0] - B[0], C[1] - B[1]), th = wrap(h1 - h0)
          const Lp = Math.hypot(B[0] - A[0], B[1] - A[1]), Ln = Math.hypot(C[0] - B[0], C[1] - B[1]), tq = Math.tan(Math.abs(th) / 2)
          const R = tq > 1e-6 ? Math.min(Rc, 0.48 * Math.min(Lp, Ln) / tq) : Rc
          const T = R * tq, n = Math.max(2, Math.ceil(Math.abs(th) / 0.03))
          let x = B[0] - Math.sin(h0) * T, z = B[1] - Math.cos(h0) * T
          poly.push([x, z])
          for (let j = 1; j <= n; j++) { const ha = h0 + th * (j - 0.5) / n, ds = Math.abs(th) / n * R; x += Math.sin(ha) * ds; z += Math.cos(ha) * ds; poly.push([x, z]) }
        }
        poly.push(raw[raw.length - 1])
      }
      // extend 2 km past the finish so the look-ahead never runs out
      { const a = poly[poly.length - 2], b = poly[poly.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; poly.push([b[0] + (b[0] - a[0]) / L * 2000, b[1] + (b[1] - a[1]) / L * 2000]) }
      const segLen = [], cum = [0]
      for (let i = 1; i < poly.length; i++) { segLen.push(Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1])); cum.push(cum[i - 1] + segLen[i - 1]) }
      const total = cum[cum.length - 1]
      const at = (s) => { s = Math.max(0, Math.min(total, s)); let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const f = (s - cum[i - 1]) / (segLen[i - 1] || 1); return [poly[i - 1][0] + f * (poly[i][0] - poly[i - 1][0]), poly[i - 1][1] + f * (poly[i][1] - poly[i - 1][1])] }
      // ── OVAL: speed limit from route curvature (omg rad/s), braking profile dv/ds = -1.8·bEff ──
      const DS = 20, NS = Math.ceil(total / DS) + 2, vLim = new Float64Array(NS).fill(1e9)
      if (prm.omg) {
        const hdg = new Float64Array(NS); for (let j = 0; j < NS; j++) { const s0 = j * DS, a0 = at(s0 - 30), b0 = at(s0 + 30); hdg[j] = Math.atan2(b0[0] - a0[0], b0[1] - a0[1]) }
        const W2 = prm.kW ?? 4
        for (let j = W2; j < NS - W2; j++) { const k = Math.abs(wrap(hdg[j + W2] - hdg[j - W2])) / (2 * W2 * DS); if (prm.gf) { let lo = 50, hi = 8000; for (let it = 0; it < 40; it++) { const v = (lo + hi) / 2, al = prm.gf * Math.min(2.2 * v, 1.1 * ((0.8 + 0.00034 * v) * v + 60)); if (v * v * k > al) hi = v; else lo = v } vLim[j] = lo } else vLim[j] = prm.omg / Math.max(k, 1e-7) }
        const dec = 1.8 * (prm.bEff ?? 0.8)
        for (let j = NS - 2; j >= 0; j--) vLim[j] = Math.min(vLim[j], vLim[j + 1] + dec * DS)
      }
      const vLimAt = (s) => vLim[Math.max(0, Math.min(NS - 1, Math.round(s / DS)))]
      let sCur = 0
      // (windowed: the 2-lap route overlaps itself, and a global projection snapped onto the finish leg's
      //  extension at the lap-2 start — the craft flew off toward it into a rock)
      const proj = (x, z, win = true) => { let bd = 1e18, bs = 0; for (let i = 1; i < poly.length; i++) { if (win && (cum[i] < sCur - 1500 || cum[i - 1] > sCur + 6000)) continue; const ax = poly[i - 1][0], az = poly[i - 1][1], dx = poly[i][0] - ax, dz = poly[i][1] - az; const L2 = dx * dx + dz * dz || 1; let f = ((x - ax) * dx + (z - az) * dz) / L2; f = Math.max(0, Math.min(1, f)); const ex = ax + f * dx - x, ez = az + f * dz - z, d = ex * ex + ez * ez; if (d < bd) { bd = d; bs = cum[i - 1] + f * Math.sqrt(L2) } } return bs }
      const padS = []; nodes.forEach((n, k) => { if (n.gate === -1) padS.push([proj(pts[k][0], pts[k][1], false), pts[k]]) })
      // ── fly ──
      g.hold(true); g.replayWith([0, 0, 1]); g.skipCountdown(); g.hold(true)
      const me = race.racers[0]
      const steps = [], log = [], evs = []
      let lastBrk = false, brkChg = -99, nBrk = 0, cc0 = 0, wv = 1, nW = 0
      let st = 0, dAcc = 0, lastBurn = false, burnChg = -99, tapPh = 0, wasCrash = false, wasSpin = false, lastHull = 100, maxLat = 0, maxLat30 = 0, pads = 0
      let drifts = []; { const od = P.onDriftBoost; P.onDriftBoost = (l) => { drifts.push([+(st / 60).toFixed(1), l]); od && od.call(P, l) } }
      const op = race.ev.pad; race.ev.pad = (r) => { if (r === me) pads++; op && op.call(race.ev, r) }
      while (st < 60 * 90 && !me.finished) {
        let cc, latNow = 0, latSgn = 0
        { const i = me.idx, [tx, tz] = c.tangent(i), l = (P.pos.x - c.px[i]) * -tz + (P.pos.z - c.pz[i]) * tx; latNow = Math.abs(l); latSgn = Math.sign(l) }
        if (st === 0) cc = [0, 0, 1]
        else if (st === 1) cc = [0, 0, 0]
        else {
          const v = P.speed, m = v / MACH
          const la = prm.la ?? 0.25, kp = prm.kp ?? 2, tap = prm.tap ?? 1, tp = prm.tp ?? 0.12
          let vmax = prm.vmax ?? 40
          if (prm.vmaxG && prm.vmaxG[me.next] != null) vmax = prm.vmaxG[me.next]
          const vh0 = prm.sideAware ? Math.atan2(P.vel.x - P.right.x * P.side * prm.sideAware, P.vel.z - P.right.z * P.side * prm.sideAware) : (Math.atan2(P.vel.x, P.vel.z) || P.heading), vh = vh0 + P.yawRate * tp
          const ppx = P.pos.x + Math.sin(vh0 + P.yawRate * tp / 2) * v * tp, ppz = P.pos.z + Math.cos(vh0 + P.yawRate * tp / 2) * v * tp
          sCur = proj(P.pos.x, P.pos.z); const s = proj(ppx, ppz), L = Math.max(prm.laMin ?? 150, v * la)
          let tgt = at(s + L), padNear = false
          if (prm.padT) for (const [sp, pp] of padS) { const d = sp - s; if (d > 0 && d < v * prm.padT) { padNear = true; if (d > (prm.padAimMin ?? 120)) tgt = pp; break } }
          if (prm.guard) { const gi = c.nearest(tgt[0], tgt[1], me.idx), [gx, gz] = c.tangent(gi), gl = (tgt[0] - c.px[gi]) * -gz + (tgt[1] - c.pz[gi]) * gx
            if (Math.abs(gl) > prm.guard) { const d = gl - Math.sign(gl) * prm.guard; tgt = [tgt[0] - (-gz) * d, tgt[1] - gx * d] } }
          const err = wrap(Math.atan2(tgt[0] - ppx, tgt[1] - ppz) - vh)
          const yawD = v * Math.sin(err) / L * kp
          const tm = Math.max(0.05, P.turnMax / (P.burning ? 0.1 : 1)) * (prm.brk ? 1 + 0.35 * P.brake : 1)
          let steer = Math.max(-1, Math.min(1, -yawD / tm))
          const need = Math.abs(yawD) / tm
          let burn = false
          let pErr = 0; if (prm.burnErr) { const q = at(proj(P.pos.x, P.pos.z)); pErr = Math.hypot(q[0] - P.pos.x, q[1] - P.pos.z) }
          if (prm.duty) {
            // duty-cycled burner: burn on a fraction f of steps so that the average turn still matches the ask
            const smax = prm.smax ?? 0.95, sg = Math.sign(-yawD) || 1, mn = prm.dutyMin ?? 0
            if (m >= vmax || (padNear && !prm.padBurn)) burn = false
            else if (need <= 0.1 * smax) { burn = true; steer = Math.max(-1, Math.min(1, -yawD / (tm * 0.1))) }
            else {
              const f = Math.max(mn, Math.min(1, (smax - need) / (smax - 0.1)))
              dAcc += f; if (dAcc >= 1) { dAcc -= 1; burn = true; steer = sg } else steer = sg * Math.min(1, Math.max(0, (need - 0.1 * f) / Math.max(1e-3, 1 - f)))
            }
          } else if (m < vmax && !padNear && need < (prm.burnNeed ?? 0.5) && (!prm.burnErr || pErr < prm.burnErr)) { burn = (tapPh % tap) === 0; tapPh++ } else tapPh = 0
          if (prm.omg && v > vLimAt(sCur) - (prm.nbTol ?? 250)) burn = false
          if (prm.minHold) {
            if (burn !== lastBurn) { if (st - burnChg < prm.minHold) burn = lastBurn; else { burnChg = st; lastBurn = burn } }
            if (prm.duty) {
              const smax = prm.smax ?? 0.95, sg = Math.sign(-yawD) || 1
              const f = Math.max(0, Math.min(1, (smax - need) / (smax - 0.1)))
              if (burn) steer = need <= 0.1 * smax ? Math.max(-1, Math.min(1, -yawD / (tm * 0.1))) : sg
              else steer = sg * Math.min(1, Math.max(0, need >= 1 ? 1 : (need - 0.1 * f) / Math.max(1e-3, 1 - f)))
            }
          }
          let fl = 1 | (burn ? 2 : 0)
          if (prm.brakeOver != null && m > vmax + prm.brakeOver) fl = 4
          // side thrusters INTO the turn: while the nose yaws, the side velocity is re-split into forward speed
          // (speed' = speed - (lateral+side)*dyaw), so side opposite in sign to the yaw rate feeds speed.
          let sf = 0
          if (prm.strafe && Math.abs(yawD) > (prm.dodgeThr ?? 0.05)) {
            sf = yawD > 0 ? -1 : 1
            if (prm.dodge && !(prm.dodgeMaxLat && latNow > prm.dodgeMaxLat && sf * latSgn > 0)) fl |= sf > 0 ? 16 : 8
            if (prm.strafeMaxLat && latNow > prm.strafeMaxLat && sf * latSgn > 0) sf = 0
          }
          if (prm.brk && (fl & 1) && m > (prm.brkMin ?? 3)) fl |= 4
          if (prm.omg) {
            let wb = v > vLimAt(sCur) + (prm.vTol ?? 0)
            if (wb !== lastBrk) { if (st - brkChg < (prm.minHold ?? 0) || (wb && (fl & 2))) wb = lastBrk; else { brkChg = st; lastBrk = wb } }
            if (wb) { fl = (fl & ~3) | 4; nBrk++ }
            else if (prm.brkCurve && vLimAt(sCur) < prm.brkCurve) { fl = (fl & ~2) | 4; cc0 = 1 }
          }
          // ROGUE weave pump: bang-bang full-lock yaw around the pursuit bearing, side thrust + dodge INTO each yaw
          if (prm.weave && v < vLimAt(sCur) - (prm.wTol ?? 600) && !padNear && m > (prm.wMin ?? 3) && m < (prm.wMax ?? 99)) {
            if (wv > 0 && err < -prm.weave) wv = -1; else if (wv < 0 && err > prm.weave) wv = 1
            steer = -wv * (prm.wSteer ?? 1); sf = wv > 0 ? -1 : 1
            fl = 1 | (prm.wBurn ? 2 : 0) | (prm.wDodge === false ? 0 : sf > 0 ? 16 : 8); nW++
          }
          cc = [steer, sf, fl]
        }
        g.force({ steer: cc[0], strafe: cc[1], boost: !!(cc[2] & 1), burner: !!(cc[2] & 2), brake: !!(cc[2] & 4), dodgeL: !!(cc[2] & 8), dodgeR: !!(cc[2] & 16) })
        steps.push(cc)
        g.fastSim(1 / 60); st++
        // the bench's lateral (signed metres from the centreline at the racer's index)
        { const i = me.idx, [tx, tz] = c.tangent(i), lat = Math.abs((P.pos.x - c.px[i]) * -tz + (P.pos.z - c.pz[i]) * tx); maxLat = Math.max(maxLat, lat); if (st % 30 === 0) maxLat30 = Math.max(maxLat30, lat) }
        if (P.crashing && !wasCrash) evs.push(['crash', st, Math.round(P.pos.x), Math.round(P.pos.z)]); wasCrash = P.crashing
        if (P.hull < lastHull - 0.5) evs.push(['hurt', st, Math.round(lastHull - P.hull), Math.round(P.pos.x), Math.round(P.pos.z)]); lastHull = P.hull
        if (P.spin > 0 && !wasSpin) evs.push(['spin', st]); wasSpin = P.spin > 0
        if (st % (prm.logEvery ?? 30) === 0) { const q = at(proj(P.pos.x, P.pos.z)); log.push([+(st / 60).toFixed(2), +(P.speed / MACH).toFixed(2), Math.round(P.pos.x), Math.round(P.pos.z), me.passed, P.airborne ? 'A' : '', Math.round(Math.hypot(q[0] - P.pos.x, q[1] - P.pos.z)), +P.yawRate.toFixed(2), P.burning ? 'B' : '']) }
        if (st % 4 === 0) await new Promise((r) => setTimeout(r, 0))
      }
      return { time: me.finished ? +me.finishTime.toFixed(3) : null, missed: g.snap().missedCount, passed: me.passed, pads, maxLat: Math.round(maxLat), maxLat30: Math.round(maxLat30), nBrk, nW, drifts, dbg: prm.dbg ? { vLim: Array.from(vLim).map(Math.round), poly: poly.map((q) => [Math.round(q[0]), Math.round(q[1])]), cum: cum.map(Math.round), nodes: nodes.map((n) => [n.i, n.gate, Math.round(n.x), Math.round(n.z), +n.tx.toFixed(3), +n.tz.toFixed(3)]), off } : undefined, top: +(P.topMach).toFixed(2), nobs: ALL.length, nodes: N, dropped, steps, log, evs, off: off.map((x) => Math.round(x)) }
    }, prm)
  } catch (e) { rep = { error: String(e).slice(0, 300), steps: [] } }
  const outF = LIST.length > 1 ? out.replace(/\.json$/, '-' + ci + '.json') : out
  if (!rep.error) fs.writeFileSync(outF, JSON.stringify({ course, time: rep.time, steps: rep.steps, prm }))
  const { steps, log, ...rest } = rep
  if (rest.dbg) { fs.writeFileSync(outF.replace(/\.json$/, '-dbg.json'), JSON.stringify(rest.dbg)); delete rest.dbg }
  console.log(ci, JSON.stringify(prm), JSON.stringify({ ...rest, evs: rest.evs ? rest.evs.slice(0, 6) : undefined, nevs: rest.evs ? rest.evs.length : 0 }))
  if (LIST.length === 1 && log) console.log(log.map((r) => r.join(' ')).join('\n'))
  await page.close()
}
await browser.close()
