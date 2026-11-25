// In-page core of the solver (loaded into the game page after the bench's own warm-up). window.SOLV.run(prm)
// surveys the course, plans a route, and flies it with the tracker — optionally with the savestate planner
// (MPC) on top — recording the exact per-step inputs. See README.md for every parameter.
(function () {
  const g = window.__g, P = g.player, c = g.course, race = g.race, MACH = 343
  const cps = c.cps, K = cps.length
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
  // CANYON-type gorges keep a nearest-row hint outside g.snap(): save/restore it with every savestate and
  // after our own queries, or rollouts drift from the judge.
  const CNY = g.world.canyon || null
  const cnGet = () => (CNY ? CNY.last : 0)
  const cnSet = (v) => { if (CNY) CNY.last = v }
  const GORGE = !!(CNY && g.world.canyonOn)
  const CN0 = cnGet() // (as the bench's warm-up left it: every run starts from it)
  // Signed lateral (the bench's sign) of (x, z) against the centreline, nearest index searched near hint.
  const latAt = (x, z, hint, span = 60) => {
    let bi = hint, bd = 1e18
    for (let i = Math.max(0, hint - span); i < Math.min(c.n, hint + span); i++) { const d = (c.px[i] - x) ** 2 + (c.pz[i] - z) ** 2; if (d < bd) { bd = d; bi = i } }
    const [tx, tz] = c.tangent(bi)
    return [bi, (x - c.px[bi]) * -tz + (z - c.pz[bi]) * tx]
  }
  const benchLat = () => { const i = race.racers[0].idx, [tx, tz] = c.tangent(i); return (P.pos.x - c.px[i]) * -tz + (P.pos.z - c.pz[i]) * tx }

  // ── per-index lateral bounds: the gorge floor (minus wallM) and the IDEAL corridor ──
  function bounds(prm) {
    const lo = new Float64Array(c.n).fill(-1e9), hi = new Float64Array(c.n).fill(1e9)
    let any = false
    if (GORGE) {
      any = true
      const last0 = cnGet(), wm = prm.wallM ?? 150
      for (let i = 0; i < c.n; i++) {
        const k = CNY.nearest(c.px[i], c.pz[i], i === 0), [tx, tz] = c.tangent(i)
        const lc = (CNY.rx[k] - c.px[i]) * -tz + (CNY.rz[k] - c.pz[i]) * tx, h = CNY.half[k] - wm
        lo[i] = lc - h; hi[i] = lc + h
      }
      cnSet(last0)
    }
    if (prm.corr) { any = true; for (let i = 0; i < c.n; i++) { lo[i] = Math.max(lo[i], -prm.corr); hi[i] = Math.min(hi[i], prm.corr) } }
    return { lo, hi, any }
  }

  // ── survey: every obstacle the collision code sees along the course (+ mounds as soft ones) ──
  let SURVEY = null
  function survey(prm) {
    if (SURVEY) return SURVEY
    const SV = new Map(), sbuf = [], last0 = cnGet()
    const v3 = P.pos.clone(), vz3 = P.vel.clone().set(0, 0, 0)
    for (let i = Math.max(0, c.startI - 5); i <= Math.min(c.n - 1, c.finishI + 5); i += 8) {
      v3.set(c.px[i], P.pos.y, c.pz[i]); g.world.update(v3, 0, undefined, vz3)
      const nn = g.world.near(c.px[i], c.pz[i], -200, 2000, sbuf)
      for (let q = 0; q < nn; q++) {
        const o = sbuf[q]; if (o.cr > 5000) continue // (gorge walls: handled by bounds)
        const key = Math.round(o.x) + ',' + Math.round(o.z), pr = SV.get(key)
        if (!pr || pr.cr < o.cr) SV.set(key, { x: o.x, z: o.z, cr: o.cr, big: o.big })
      }
    }
    cnSet(last0)
    SURVEY = [...SV.values()]
    return SURVEY
  }

  // ── plan: DP over one crossing offset per node (gates, pads per pass, centreline mids), arcs of radius Rc ──
  function plan(prm, B) {
    const ALL = survey(prm).map((o) => ({ ...o }))
    if (prm.mounds) { const M = c.mounds; for (let q = 0; q < M.length; q += 4) if (M[q + 2] >= (prm.moundMinH ?? 10)) ALL.push({ x: M[q], z: M[q + 1], cr: M[q + 3] * prm.mounds, big: false, mound: true }) }
    const nodes = cps.map((q, k) => ({ x: q.x, z: q.z, tx: q.tx, tz: q.tz, i: q.i, gate: k }))
    const iLo = cps[0].i, iHi = cps[K - 1].i - 3
    if (prm.pads) for (const p of c.pads) {
      // every pass of the course over the pad (multi-lap courses: one node per lap)
      let run = null; const passes = []
      for (let j = iLo; j < iHi; j++) {
        const d = (c.px[j] - p.x) ** 2 + (c.pz[j] - p.z) ** 2
        if (d < 400 * 400) { if (!run || j - run.j1 > 5) { run = { j1: j, bi: j, bd: d }; passes.push(run) } run.j1 = j; if (d < run.bd) { run.bd = d; run.bi = j } }
      }
      for (const r of passes) {
        if (nodes.some((n) => n.gate >= 0 && Math.abs(n.i - r.bi) < 3)) continue
        nodes.push({ x: p.x, z: p.z, tx: p.tx, tz: p.tz, i: r.bi, gate: -1 })
      }
    }
    if (prm.mid) for (let k = 1; k < K; k++) {
      const i0 = cps[k - 1].i, i1 = cps[k].i
      const hp = prm.midH && Math.abs(wrap(Math.atan2(cps[k].tx, cps[k].tz) - Math.atan2(cps[k - 1].tx, cps[k - 1].tz))) > 0.4
      const n = Math.floor((i1 - i0) / (hp ? prm.midH : prm.mid))
      for (let j = 1; j < n; j++) {
        const i = Math.round(i0 + (i1 - i0) * j / n)
        if (nodes.some((q) => q.gate !== -2 && Math.abs(q.i - i) < 4)) continue
        const [tx, tz] = c.tangent(i); nodes.push({ x: c.px[i], z: c.pz[i], tx, tz, i, gate: -2 })
      }
    }
    nodes.sort((a, b) => a.i - b.i || b.gate - a.gate)
    let N = nodes.length
    const pt = (k, u) => [nodes[k].x + nodes[k].tz * u, nodes[k].z - nodes[k].tx * u]
    const start = [P.pos.x, P.pos.z]
    const gh = c.gateHalf
    const W = prm.W ?? gh - 40, du = prm.du ?? 20, padW = prm.padW ?? 20
    const okU = (k, u) => { const i = nodes[k].i; return -u >= B.lo[i] && -u <= B.hi[i] }
    const mkUC = () => nodes.map((n, k) => {
      let a = []
      if (n.gate === -2) { const mw = prm.midW ?? 200; for (let u = -mw; u <= mw + 1e-6; u += du) a.push(u) }
      else if (n.gate < 0) { for (let u = -padW; u <= padW + 1e-6; u += Math.min(du, padW || 1)) a.push(u); if (!a.length) a = [0] }
      else { const w = n.gate === K - 1 ? Math.min(W, prm.Wf ?? 250) : W; for (let u = -w; u <= w + 1e-6; u += du) a.push(u) }
      const f = a.filter((u) => okU(k, u))
      if (!f.length && n.gate >= 0) { // the gorge/corridor leaves nothing on the grid: the closest allowed offset
        const i = n.i, m = -(B.lo[i] + B.hi[i]) / 2; return [clamp(m, -W, W)]
      }
      return f
    })
    let UC = mkUC()
    const half = (k) => nodes[k].gate === -2 ? (prm.midCut ?? (prm.midW ?? 200) + 30) : nodes[k].gate < 0 ? (prm.padCut ?? padW + 8) : (prm.Wc ?? gh - 10)
    const MG = prm.mgPlan ?? 100, MGs = prm.mgSmall ?? 50, HARD = prm.hard ?? 12, PEN = prm.pen ?? 30
    const corrOK = (a, b, i0, i1) => {
      if (!B.any) return true
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 150))
      for (let j = 1; j < n; j++) { const f = j / n, [ii, l] = latAt(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.round(i0 + (i1 - i0) * f)); if (l < B.lo[ii] || l > B.hi[ii]) return false }
      return true
    }
    const clear = (a, b, list, i0, i1) => {
      const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1
      let pen = 0
      for (const o of list) {
        const R = o.cr + (o.big ? MG : MGs)
        let t = ((o.x - a[0]) * dx + (o.z - a[1]) * dz) / L2; t = Math.max(0, Math.min(1, t))
        const ex = a[0] + t * dx - o.x, ez = a[1] + t * dz - o.z, d = Math.sqrt(ex * ex + ez * ez)
        if (d < o.cr + HARD) return false
        if (d < R) pen += (R - d) * PEN
      }
      if (!corrOK(a, b, i0, i1)) return false
      return pen
    }
    const legObs = (a, b) => ALL.filter((o) => o.x > Math.min(a[0], b[0]) - 1500 && o.x < Math.max(a[0], b[0]) + 1500 && o.z > Math.min(a[1], b[1]) - 1500 && o.z < Math.max(a[1], b[1]) + 1500)
    const lam = prm.lam ?? 10000, Rc0 = prm.Rc ?? 4000, RcN = new Map()
    const rcOf = (k) => RcN.has(nodes[k]) ? RcN.get(nodes[k]) : Rc0
    let hist, best, cornerObs, failed, off, pts, raw, poly; const dropped = []; let polyFix = 0
    for (let pass = 0; ; pass++) {
      for (let attempt = 0; attempt < 80; attempt++) {
        failed = false; hist = []
        {
          const lo = legObs(start, pt(0, 0)), m = new Map()
          UC[0].forEach((u, j) => { const p = pt(0, u); const cl = clear(start, p, lo, nodes[0].i, nodes[0].i); if (cl !== false) m.set('S,' + j, { c: cl + Math.hypot(p[0] - start[0], p[1] - start[1]), prev: null, a: 'S', b: j }) })
          if (!m.size) UC[0].forEach((u, j) => { const p = pt(0, u); m.set('S,' + j, { c: Math.hypot(p[0] - start[0], p[1] - start[1]), prev: null, a: 'S', b: j }) })
          hist.push(m); best = m
        }
        cornerObs = nodes.map((q) => legObs([q.x, q.z], [q.x, q.z]))
        for (let k = 1; k < N; k++) {
          const m = new Map(), lo = legObs(pt(k - 1, 0), pt(k, 0)), ck = UC[k], cp = UC[k - 1], okLeg = new Map()
          for (const [key, st] of best) {
            const i1 = st.b, A = st.a === 'S' ? start : pt(k - 2, UC[k - 2][st.a]), Bp = pt(k - 1, cp[i1])
            const h0 = Math.atan2(Bp[0] - A[0], Bp[1] - A[1]), Lp = Math.hypot(Bp[0] - A[0], Bp[1] - A[1])
            ck.forEach((u, j) => {
              const C = pt(k, u), lk = i1 + ',' + j
              let ok = okLeg.get(lk); if (ok === undefined) { ok = clear(Bp, C, lo, nodes[k - 1].i, nodes[k].i); okLeg.set(lk, ok) }
              if (ok === false) return
              const h1 = Math.atan2(C[0] - Bp[0], C[1] - Bp[1]), bs = wrap(h1 - h0), bend = Math.abs(bs), Ln = Math.hypot(C[0] - Bp[0], C[1] - Bp[1])
              let cpen = 0
              const Rc = rcOf(k - 1)
              if (Rc && k - 1 > 0) {
                const cut = Rc * bend * bend / 8; if (Math.abs(cp[i1] + Math.sign(bs) * cut) > half(k - 1)) return
                const T = Rc * Math.tan(bend / 2)
                if (T > 30) {
                  const P1 = [Bp[0] - Math.sin(h0) * T, Bp[1] - Math.cos(h0) * T], P2 = [Bp[0] + Math.sin(h1) * T, Bp[1] + Math.cos(h1) * T]
                  const Mx = (P1[0] + P2[0]) / 2, Mz = (P1[1] + P2[1]) / 2, dB = Math.hypot(Bp[0] - Mx, Bp[1] - Mz) || 1, md = Rc * (1 / Math.cos(bend / 2) - 1)
                  const M = [Bp[0] + (Mx - Bp[0]) / dB * md, Bp[1] + (Mz - Bp[1]) / dB * md]
                  const ni = nodes[k - 1].i
                  const c1 = clear(P1, M, cornerObs[k - 1], ni, ni), c2 = clear(M, P2, cornerObs[k - 1], ni, ni)
                  if (c1 === false || c2 === false) return
                  cpen = c1 + c2
                }
              }
              const cc = st.c + ok + cpen + Ln + lam * bend * bend + (prm.lam1 ?? 0) * bend + (prm.lamK ? prm.lamK * bend * bend * 2 / (Ln + Lp + 1) : 0)
              const pr = m.get(lk)
              if (!pr || pr.c > cc) m.set(lk, { c: cc, prev: key, a: i1, b: j })
            })
          }
          if (m.size === 0) {
            // relax in order: drop a pad node, drop a mid node, halve the corner radius, then give up
            const kk = [k, k - 1].find((q) => q > 0 && nodes[q].gate === -1) ?? [k, k - 1].find((q) => q > 0 && nodes[q].gate === -2)
            if (kk !== undefined) { dropped.push(nodes[kk].gate + '@' + nodes[kk].i); nodes.splice(kk, 1); N = nodes.length; UC = mkUC(); failed = true; break }
            const r0 = rcOf(k - 1); if (Rc0 && r0 > 0) { RcN.set(nodes[k - 1], r0 < 1000 ? 0 : r0 / 2); failed = true; break }
            throw new Error('no clear path at node ' + k + ' (gate ' + nodes[k].gate + ', i ' + nodes[k].i + ')')
          }
          hist.push(m); best = m
        }
        if (!failed) break
      }
      if (failed) throw new Error('planner gave up')
      let bk = null, bc = 1e18; for (const [key, st] of best) if (st.c < bc) { bc = st.c; bk = key }
      off = new Array(N).fill(0)
      for (let k = N - 1; k >= 0; k--) { const st = hist[k].get(bk); off[k] = UC[k][st.b]; bk = st.prev }
      pts = off.map((u, k) => pt(k, u))
      raw = [start, ...pts.slice(1)]
      poly = [raw[0]]; const arcP = []
      for (let i = 1; i < raw.length - 1; i++) {
        const A = raw[i - 1], Bq = raw[i], C = raw[i + 1]
        const h0 = Math.atan2(Bq[0] - A[0], Bq[1] - A[1]), h1 = Math.atan2(C[0] - Bq[0], C[1] - Bq[1]), th = wrap(h1 - h0)
        const Lp = Math.hypot(Bq[0] - A[0], Bq[1] - A[1]), Ln = Math.hypot(C[0] - Bq[0], C[1] - Bq[1]), tq = Math.tan(Math.abs(th) / 2)
        const R = tq > 1e-6 ? Math.min(rcOf(i), 0.48 * Math.min(Lp, Ln) / tq) : 0
        const T = R * tq
        if (T < 1) { poly.push(Bq); continue }
        const n = Math.max(2, Math.ceil(Math.abs(th) / 0.03))
        let x = Bq[0] - Math.sin(h0) * T, z = Bq[1] - Math.cos(h0) * T
        poly.push([x, z]); const ap = [[x, z]]
        for (let j = 1; j <= n; j++) { const ha = h0 + th * (j - 0.5) / n, ds = Math.abs(th) / n * R; x += Math.sin(ha) * ds; z += Math.cos(ha) * ds; poly.push([x, z]); ap.push([x, z]) }
        arcP.push([i, ap])
      }
      poly.push(raw[raw.length - 1])
      // re-check the arcs actually flown (not the DP's estimate) against obstacles and bounds; halve the bad ones
      const bad = []
      for (const [i, ap] of arcP) {
        let ok = true; const ni = nodes[i].i
        for (let j = 1; j < ap.length && ok; j++) if (clear(ap[j - 1], ap[j], cornerObs[i], ni, ni) === false) ok = false
        if (ok && B.any) for (const q of ap) { const [ii, l] = latAt(q[0], q[1], ni); if (l < B.lo[ii] - 5 || l > B.hi[ii] + 5) { ok = false; break } }
        if (!ok) bad.push(i)
      }
      if (!bad.length || pass > 30) break
      polyFix += bad.length
      for (const i of bad) { const r0 = rcOf(i); RcN.set(nodes[i], r0 < 1000 ? 0 : r0 / 2) }
    }
    { const a = poly[poly.length - 2], b = poly[poly.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; poly.push([b[0] + (b[0] - a[0]) / L * 2000, b[1] + (b[1] - a[1]) / L * 2000]) }
    // drop zero-length segments
    const pl = [poly[0]]; for (let i = 1; i < poly.length; i++) if (Math.hypot(poly[i][0] - pl[pl.length - 1][0], poly[i][1] - pl[pl.length - 1][1]) > 0.5) pl.push(poly[i])
    return { poly: pl, nodes, pts, off, N, dropped, polyFix, nobs: ALL.length }
  }

  // ── route helpers over a polyline (binary-searched, windowed projection) ──
  function route(poly) {
    const n = poly.length, cum = new Float64Array(n)
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1])
    const total = cum[n - 1]
    const seg = (s) => { let lo = 1, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < s) lo = m + 1; else hi = m } return lo }
    const at = (s) => { s = clamp(s, 0, total); const i = seg(s), L = cum[i] - cum[i - 1] || 1, f = (s - cum[i - 1]) / L; return [poly[i - 1][0] + f * (poly[i][0] - poly[i - 1][0]), poly[i - 1][1] + f * (poly[i][1] - poly[i - 1][1])] }
    // windowed: the multi-lap route overlaps itself — a global projection snapped onto a later lap
    const proj = (x, z, sc, win = true) => {
      let i0 = 1, i1 = n - 1
      if (win) { i0 = Math.max(1, seg(sc - 1500)); i1 = Math.min(n - 1, seg(sc + 6000)) }
      let bd = 1e18, bs = 0
      for (let i = i0; i <= i1; i++) {
        const ax = poly[i - 1][0], az = poly[i - 1][1], dx = poly[i][0] - ax, dz = poly[i][1] - az, L2 = dx * dx + dz * dz || 1
        let f = ((x - ax) * dx + (z - az) * dz) / L2; f = f < 0 ? 0 : f > 1 ? 1 : f
        const ex = ax + f * dx - x, ez = az + f * dz - z, d = ex * ex + ez * ez
        if (d < bd) { bd = d; bs = cum[i - 1] + f * Math.sqrt(L2) }
      }
      return bs
    }
    return { at, proj, total, cum }
  }

  // speed limit from route curvature and the game's grip, with a braking curve (OVAL's hairpins)
  function speedLimit(R, prm) {
    const DS = 20, NS = Math.ceil(R.total / DS) + 2, vLim = new Float64Array(NS).fill(1e9)
    if (prm.omg) {
      const hdg = new Float64Array(NS); for (let j = 0; j < NS; j++) { const a0 = R.at(j * DS - 30), b0 = R.at(j * DS + 30); hdg[j] = Math.atan2(b0[0] - a0[0], b0[1] - a0[1]) }
      const W2 = prm.kW ?? 15, gf = prm.gf ?? 0.95
      for (let j = W2; j < NS - W2; j++) {
        const k = Math.abs(wrap(hdg[j + W2] - hdg[j - W2])) / (2 * W2 * DS)
        let lo = 50, hi = 8000; for (let it = 0; it < 40; it++) { const v = (lo + hi) / 2, al = gf * Math.min(2.2 * v, 1.1 * ((0.8 + 0.00034 * v) * v + 60)); if (v * v * k > al) hi = v; else lo = v }
        vLim[j] = lo
      }
      const dec = 1.8 * (prm.bEff ?? 0.25)
      for (let j = NS - 2; j >= 0; j--) vLim[j] = Math.min(vLim[j], vLim[j + 1] + dec * DS)
    }
    return (s) => vLim[clamp(Math.round(s / DS), 0, NS - 1)]
  }

  // ── the run: tracker (+ MPC) from the grid; records exact inputs ──
  async function run(prm) {
    const t0 = performance.now()
    g.force(null); g.hold(true); g.replayWith([0, 0, 1]); g.skipCountdown(); g.hold(true); cnSet(CN0) // (the craft back on the grid: the plan starts there)
    const B = bounds(prm)
    const PL = plan(prm, B)
    const R = route(PL.poly)
    const vLimAt = speedLimit(R, prm)
    const padS = []; PL.nodes.forEach((n, k) => { if (n.gate === -1) padS.push([R.proj(PL.pts[k][0], PL.pts[k][1], 0, false), PL.pts[k]]) })
    padS.sort((a, b) => a[0] - b[0])
    const IDEAL = !!prm.ideal, HOLD = IDEAL ? 6 : (prm.minHold ?? 0)
    const me = race.racers[0]
    let pads = 0
    const op = race.ev.pad; race.ev.pad = (r) => { if (r === me) pads++; op && op.call(race.ev, r) }

    // controller state (part of every savestate)
    const S0 = () => ({ st: 0, sCur: 0, dAcc: 0, tapPh: 0, run: [99, 99, 99], f: 0, steer: 0, strafe: 0 })
    function ctl(S, ov) {
      if (S.st === 0) return [0, 0, 1]
      if (S.st === 1) return [0, 0, 0]
      const v = P.speed, m = v / MACH
      const la = prm.la ?? 0.18, kp = prm.kp ?? 2, tp = prm.tp ?? 0.12, vmax = prm.vmax ?? 40
      const sa = prm.sideAware ?? 0
      const vh0 = sa ? Math.atan2(P.vel.x - P.right.x * P.side * sa, P.vel.z - P.right.z * P.side * sa) : (Math.atan2(P.vel.x, P.vel.z) || P.heading)
      const vh = vh0 + P.yawRate * tp
      const ppx = P.pos.x + Math.sin(vh0 + P.yawRate * tp / 2) * v * tp, ppz = P.pos.z + Math.cos(vh0 + P.yawRate * tp / 2) * v * tp
      S.sCur = R.proj(P.pos.x, P.pos.z, S.sCur)
      const s = R.proj(ppx, ppz, S.sCur), L = Math.max(prm.laMin ?? 150, v * la)
      let tgt = R.at(s + L), padNear = false
      if (prm.padT) for (const [sp, pp] of padS) { const d = sp - s; if (d > 0 && d < v * prm.padT) { padNear = true; if (d > (prm.padAimMin ?? 120)) tgt = pp; break } }
      if (ov && ov.aim) { const a = R.at(s + L - 20), b = R.at(s + L + 20), l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; tgt = [tgt[0] + (b[1] - a[1]) / l * ov.aim, tgt[1] - (b[0] - a[0]) / l * ov.aim] }
      if (prm.guard) {
        const gi = c.nearest(tgt[0], tgt[1], me.idx), [gx, gz] = c.tangent(gi), gl = (tgt[0] - c.px[gi]) * -gz + (tgt[1] - c.pz[gi]) * gx
        if (Math.abs(gl) > prm.guard) { const d = gl - Math.sign(gl) * prm.guard; tgt = [tgt[0] - (-gz) * d, tgt[1] - gx * d] }
      }
      const err = wrap(Math.atan2(tgt[0] - ppx, tgt[1] - ppz) - vh)
      const yawD = v * Math.sin(err) / L * kp
      const tm = Math.max(0.05, P.turnMax / (P.burning ? 0.1 : 1))
      const need = Math.abs(yawD) / tm, sg = Math.sign(-yawD) || 1, smax = prm.smax ?? 0.95
      let burn = false
      if (prm.duty) {
        if (m >= vmax || (padNear && !prm.padBurn)) burn = false
        else if (need <= 0.1 * smax) burn = true
        else { const f = Math.max(prm.dutyMin ?? 0, Math.min(1, (smax - need) / (smax - 0.1))); S.dAcc += f; if (S.dAcc >= 1) { S.dAcc -= 1; burn = true } }
      } else {
        let pErr = 0; if (prm.burnErr) { const q = R.at(S.sCur); pErr = Math.hypot(q[0] - P.pos.x, q[1] - P.pos.z) }
        if (m < vmax && !padNear && need < (prm.burnNeed ?? 0.2) && (!prm.burnErr || pErr < prm.burnErr)) burn = true
      }
      const vl = vLimAt(S.sCur)
      if (prm.omg && v > vl - (prm.nbTol ?? 300)) burn = false
      if (ov && ov.burn === 1) burn = true
      else if (ov && ov.burn === 0) burn = false
      let fl = 1 | (burn ? 2 : 0)
      if (prm.omg && v > vl + (prm.vTol ?? 0)) fl = 4
      // keys: held/released >= HOLD steps (IDEAL: the bench's human rule)
      if (HOLD) {
        let f = S.f
        for (let k = 0; k < 3; k++) { const b = 1 << k; if ((f & b) !== (fl & b) && S.run[k] >= HOLD) { f ^= b; S.run[k] = 1 } else S.run[k]++ }
        fl = f
      }
      S.f = fl
      const burnOut = !!(fl & 2)
      let steer
      if (prm.duty && burnOut) steer = need <= 0.1 * smax ? clamp(-yawD / (tm * 0.1), -1, 1) : sg
      else if (prm.duty && !burnOut && need > 0.1 * smax) { const f = Math.max(0, Math.min(1, (smax - need) / (smax - 0.1))); steer = f >= 1 ? clamp(-yawD / tm, -1, 1) : sg * Math.min(1, Math.max(0, need >= 1 ? 1 : (need - 0.1 * f) / Math.max(1e-3, 1 - f))) }
      else steer = clamp(-yawD / tm, -1, 1)
      if (ov && ov.steerAdd) steer = clamp(steer + ov.steerAdd, -1, 1)
      // ROGUE: side thrust INTO the turn (the side velocity is re-split into forward speed as the nose yaws)
      let sf = 0
      if (!IDEAL && prm.strafe && Math.abs(yawD) > (prm.turnThr ?? 0.05)) {
        sf = (yawD > 0 ? -1 : 1) * prm.strafe
        if (prm.strafeMaxLat) { const l = benchLat(); if (Math.abs(l) > prm.strafeMaxLat && sf * Math.sign(l) > 0) sf = 0 }
      }
      if (prm.slew) { steer = clamp(steer, S.steer - prm.slew, S.steer + prm.slew); sf = clamp(sf, S.strafe - prm.slew, S.strafe + prm.slew) }
      steer = Math.fround(steer); sf = Math.fround(sf)
      S.steer = steer; S.strafe = sf
      return [steer, sf, fl]
    }
    const force = (cc) => g.force({ steer: cc[0], strafe: cc[1], boost: !!(cc[2] & 1), burner: !!(cc[2] & 2), brake: !!(cc[2] & 4), dodgeL: false, dodgeR: false })
    const cloneS = (S) => ({ ...S, run: S.run.slice() })

    g.force(null)
    g.hold(true); g.replayWith([0, 0, 1]); g.skipCountdown(); g.hold(true); cnSet(CN0)
    const m0 = g.snap().missedCount
    const S = S0(), steps = [], evs = []
    let maxLat = 0, wasCrash = false, wasSpin = false, lastHull = P.hull, crashes = 0, hurt = 0
    const maxSteps = 60 * (prm.maxT ?? 200)
    const MPC = prm.mpc || null
    const latLim = prm.latLim ?? (IDEAL ? 255 : 0), latSoft = prm.latSoft ?? 200, latW = prm.latW ?? 1
    let decisions = 0, lastProgSt = 0, lastProg = 0
    const commit = (ov) => {
      const cc = ctl(S, ov); force(cc); steps.push(cc); g.fastSim(1 / 60); S.st++
      const l = Math.abs(benchLat()); if (l > maxLat) maxLat = l
      if (P.crashing && !wasCrash) { crashes++; evs.push(['crash', S.st, Math.round(P.pos.x), Math.round(P.pos.z)]) } wasCrash = P.crashing
      if (P.hull < lastHull - 0.5) { hurt += lastHull - P.hull; if (evs.length < 40) evs.push(['hurt', S.st, Math.round(lastHull - P.hull)]) } lastHull = P.hull
      if (P.spin > 0 && !wasSpin) evs.push(['spin', S.st]); wasSpin = P.spin > 0
    }
    if (!MPC) {
      while (S.st < maxSteps && !me.finished) {
        commit(null)
        if (S.st % 600 === 0) { if (S.sCur < lastProg + 500) break; lastProg = S.sCur }
        if (S.st % 240 === 0) await new Promise((r) => setTimeout(r, 0))
      }
    } else {
      const D = MPC.D ?? 6, H = MPC.H ?? 60, Wv = MPC.Wv ?? 1
      const cands = []; for (const b of MPC.burns ?? [-1, 1, 0]) for (const a of MPC.aims ?? [-40, 0, 40]) cands.push({ burn: b, aim: a })
      const RULE = null
      while (S.st < maxSteps && !me.finished) {
        if (S.st < 2) { commit(null); continue }
        const snap = g.snap(), cl0 = cnGet(), S1 = cloneS(S), miss0 = snap.missedCount, pads0 = pads
        let bestK = 0, bestS = -1e18
        for (let k = 0; k < cands.length; k++) {
          if (k > 0) { g.restore(snap); cnSet(cl0) }
          const s2 = cloneS(S1); let pen = 0, h0 = P.hull
          for (let q = 0; q < H && !me.finished; q++) {
            const cc = ctl(s2, q < D ? cands[k] : RULE); force(cc); g.fastSim(1 / 60); s2.st++
            if (P.crashing) { pen += 1e7; break }
            if (P.spin > 0) pen += 1e3
            if (latLim) { const l = Math.abs(benchLat()); if (l > latLim) pen += 1e6 + 1e4 * (l - latLim); else if (l > latSoft) pen += latW * (l - latSoft) }
          }
          if (P.hull < h0) pen += (h0 - P.hull) * (MPC.hullPen ?? 100)
          if (g.snap().missedCount > miss0) pen += 1e6
          const prog = me.finished ? 1e8 - me.finishTime * 1e5 : R.proj(P.pos.x, P.pos.z, s2.sCur) + Wv * P.speed
          const sc = prog - pen
          if (sc > bestS) { bestS = sc; bestK = k }
        }
        g.restore(snap); cnSet(cl0); pads = pads0
        Object.assign(S, cloneS(S1))
        for (let q = 0; q < D && !me.finished; q++) commit(cands[bestK])
        if (++decisions % 4 === 0) await new Promise((r) => setTimeout(r, 0))
        if (S.st - lastProgSt >= 600) { if (S.sCur < lastProg + 500) break; lastProg = S.sCur; lastProgSt = S.st }
      }
    }
    g.force(null)
    race.ev.pad = op
    const missed = g.snap().missedCount - m0
    return { time: me.finished ? +me.finishTime.toFixed(3) : null, missed, passed: me.passed, K, pads, maxLat: Math.round(maxLat * 10) / 10, crashes, hurt: Math.round(hurt), top: +(P.topMach ?? 0).toFixed(2), nobs: PL.nobs, nodes: PL.N, dropped: PL.dropped, polyFix: PL.polyFix, evs: evs.slice(0, 12), steps, ms: Math.round(performance.now() - t0) }
  }
  window.SOLV = { run, survey, bounds, plan, GORGE }
})()
