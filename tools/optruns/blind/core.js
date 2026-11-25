// In-page core of the blind solver: a hands-legal controller and savestate-based search over it.
// Loaded into the game page (window.__g). Everything here only reads the simulation and feeds it inputs
// through g.force — exactly the controls the judge's replay will feed.
(function () {
  const g = window.__g, c = g.course, P = g.player, MACH = 343, n = c.n
  const me = () => g.race.racers[0]
  // ── course geometry ──
  const heads = new Float64Array(n)
  for (let i = 0; i < n; i++) { const [tx, tz] = c.tangent(i); heads[i] = Math.atan2(tx, tz) }
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
  // Signed turn of the line between two indices (rad), + = heading increasing.
  const turnBetween = (i, j) => wrap(heads[Math.max(0, Math.min(n - 1, j))] - heads[Math.max(0, Math.min(n - 1, i))])
  const latOf = (i, x, z) => { const [tx, tz] = c.tangent(i); return (x - c.px[i]) * -tz + (z - c.pz[i]) * tx }
  const gateIdx = c.cps.map((q) => q.i)

  // ── hands: every key held/released >= 6 steps, steer/strafe change <= 0.34 a step ──
  function Hands() { return { f: 1, run: [99, 99, 99, 99, 99], steer: 0, strafe: 0 } }
  const BITS = [1, 2, 4, 8, 16]
  function legal(h, want) {
    // want: { steer, strafe, flags }; returns the legal [steer, strafe, flags], updating h.
    const ds = Math.max(-0.333, Math.min(0.333, want.steer - h.steer)); h.steer = Math.fround(Math.max(-1, Math.min(1, h.steer + ds)))
    const df = Math.max(-0.333, Math.min(0.333, want.strafe - h.strafe)); h.strafe = Math.fround(Math.max(-1, Math.min(1, h.strafe + df)))
    let f = h.f
    for (let k = 0; k < 3; k++) {
      const b = BITS[k], cur = f & b, w = want.flags & b
      if (cur !== w && h.run[k] >= 6) { f ^= b; h.run[k] = 1 } else h.run[k]++
    }
    // Dodges are taps: one step on, at least 15 steps (the dodge's own 0.25 s cooldown) after the last tap.
    for (let k = 3; k < 5; k++) {
      const b = BITS[k]
      h.run[k]++
      if ((want.flags & b) && h.run[k] >= 15) { f |= b; h.run[k] = 0 } else f &= ~b
    }
    h.f = f
    return [h.steer, h.strafe, f]
  }
  const toCtl = (s) => ({ steer: s[0], strafe: s[1], boost: !!(s[2] & 1), burner: !!(s[2] & 2), brake: !!(s[2] & 4), dodgeL: !!(s[2] & 8), dodgeR: !!(s[2] & 16) })

  // ── one step of the sim with given legal inputs ──
  function step(s) { g.force(toCtl(s)); g.fastSim(1 / 60) }

  // ── savestates: the sim + our controller's own state ──
  function save(extra) { return { s: g.snap(), extra: JSON.parse(JSON.stringify(extra)) } }
  function load(st) { g.restore(st.s); return JSON.parse(JSON.stringify(st.extra)) }

  // Fractional course progress (index + along-segment), for scoring.
  function prog() {
    const i = me().idx, [tx, tz] = c.tangent(i)
    return i + ((P.pos.x - c.px[i]) * tx + (P.pos.z - c.pz[i]) * tz) / 40
  }
  function start() { g.hold(true); g.start(); g.skipCountdown(); g.hold(true) }

  // ── curvature (signed, rad/m) at each index, from the heading change over ±5 points ──
  const kap = new Float64Array(n), kapAbs = new Float64Array(n)
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - 5), b = Math.min(n - 1, i + 5); kap[i] = b > a ? turnBetween(a, b) / ((b - a) * 40) : 0; kapAbs[i] = Math.abs(kap[i]) }
  // Max |curvature| over [i, j].
  const maxKap = (i, j) => { let m = 0; for (let k = Math.max(0, i); k <= Math.min(n - 1, j); k++) if (kapAbs[k] > m) m = kapAbs[k]; return m }
  const H = g.CFG.handling
  // The turn rate full lock gives, unburnt, at speed v (Player.turnMax with assist 0.6).
  const A = P.assist
  const turnMaxAt = (v) => { const hs = Math.max(v, 1); const gp = ((H.gripK * (1 + A * 0.2) + H.gripQ * hs) * hs + H.gripLow); return Math.min(2.2, gp / Math.max(hs, 60)) * (1.12 - 0.2 * A) }
  const nearGate = (i, span) => { for (const gi of gateIdx) if (Math.abs(gi - i) <= span) return true; return false }
  const gateHalf = c.gateHalf

  // ── the controller: parameters p, state st { h: Hands } → the step's legal inputs ──
  // p: lane (m, right +), fb (burner aggressiveness), fbr (brake aggressiveness), dodge (0/1), kc, strafeK,
  //    burn: -1 never / 0 auto / 1 always, thr (throttle), look (s).
  const DEF = { lane: 0, fb: 2.5, fbr: 1.0, dodge: 0, kc: 1.5, strafeK: 1 / 30, sv: 0, burn: 0, look: 0.05, tb: 1.2, kh: 20, be: 0.06, bc: 40 }
  function ctl(p, st) {
    const r = me(), i = r.idx, v = P.speed
    const myLat = latOf(i, P.pos.x, P.pos.z)
    // Lane: clamped inside the gate near one.
    let lane = laneAt(i + (v * 0.15) / 40) + p.lane
    const lim = gateHalf - 45
    if (nearGate(i + Math.round((v * 0.8) / 40), Math.round((v * 0.9) / 40) + 4)) lane = Math.max(-lim, Math.min(lim, lane))
    const look = Math.min(n - 1, i + Math.round((v * p.look + 60) / 40))
    const lineH = heads[look]
    const cte = lane - myLat
    // Lateral PD: the sideways speed wanted (lane slope + closing the error), turned into a heading.
    const [rx, rz] = (() => { const [tx, tz] = c.tangent(i); return [-tz, tx] })()
    const vlat = P.vel.x * rx + P.vel.z * rz
    const slope = (laneAt(look + 2) - laneAt(look - 2)) / 160
    const vm = Math.max(60, v * 0.12)
    const vlatDes = slope * v + Math.max(-vm, Math.min(vm, cte * p.kc))
    const sideV = P.side + P.lateral
    const headDes = lineH - Math.asin(Math.max(-0.6, Math.min(0.6, (vlatDes - sideV * p.sv) / Math.max(v, 50))))
    const err = wrap(headDes - P.heading)
    const lineTurn = turnBetween(look, look + 6)
    const yawWant = (lineTurn / 240) * v + err * p.kh
    const tmNB = turnMaxAt(Math.hypot(v, P.lateral))
    const tmNow = P.burning ? tmNB * 0.1 : tmNB
    let steer = Math.max(-1, Math.min(1, -yawWant / Math.max(tmNow, 0.02)))
    // Burner: the turn the line needs over the next tb seconds within what a lit burner steers.
    const ahead = i + Math.round((v * p.tb) / 40) + 3
    const need = v * maxKap(i, ahead) + Math.abs(err) * 2
    let burn = p.burn > 0 || (p.burn === 0 && need < tmNB * 0.1 * p.fb && Math.abs(err) < p.be && Math.abs(cte) < p.bc)
    // Brake: a bend within ~2 s that needs more than full lock gives.
    let brake = false
    const far = i + Math.round((v * 2.0) / 40) + 3
    for (let k = i; k <= Math.min(n - 1, far); k += 2) {
      const d = (k - i) * 40, vAt = Math.max(0, v - d / 2.0 * 0.0) // (crude)
      if (vAt * kapAbs[k] > turnMaxAt(vAt) * p.fbr * (0.75 + 0.25 * Math.min(1, d / (v * 2 + 1)))) { brake = true; break }
    }
    if (P.airborne) brake = false
    let flags = brake ? 4 : 1
    if (burn && !brake) flags |= 2
    let strafe = Math.max(-1, Math.min(1, (vlatDes - vlat) * p.strafeK))
    if (p.dodge) {
      const y = P.yawRate
      if (Math.abs(y) > 0.15) { flags |= y > 0 ? 8 : 16; strafe = y > 0 ? -1 : 1 }
    }
    return legal(st.h, { steer, strafe, flags })
  }

  // ── obstacles: everything the collision code sees (World.near), swept along the course once ──
  const W = g.world
  function sweepObstacles(Wmax) {
    const seen = new Map(), out = []
    const cn = W.canyon, last0 = cn ? cn.last : 0
    for (let j = Math.max(0, c.startI - 10); j <= Math.min(n - 1, c.finishI + 10); j += 2) {
      const k = W.near(c.px[j], c.pz[j], -1e6, Wmax + 100, out)
      for (let q = 0; q < k; q++) {
        const o = out[q]; if (o.cr > 5000) continue
        const key = Math.round(o.x * 2) + ',' + Math.round(o.z * 2); if (seen.has(key)) continue
        // Place it on the course: nearest index near j.
        let bi = j, bd = Infinity
        for (let t = Math.max(0, j - 40); t <= Math.min(n - 1, j + 40); t++) { const d = (c.px[t] - o.x) ** 2 + (c.pz[t] - o.z) ** 2; if (d < bd) { bd = d; bi = t } }
        seen.set(key, { i: bi, lat: latOf(bi, o.x, o.z), r: o.cr })
      }
    }
    if (cn) cn.last = last0
    return [...seen.values()]
  }
  // Gorge walls: the free half-width at each index (Infinity off a gorge).
  function wallHalf() {
    const cn = W.canyon, hw = new Float64Array(n).fill(Infinity)
    if (!cn || !W.canyonOn) return hw
    const last0 = cn.last
    for (let i = 0; i < n; i++) {
      const k = cn.nearest(c.px[i], c.pz[i], i === 0)
      const off = (c.px[i] - cn.rx[k]) * cn.tz[k] - (c.pz[i] - cn.rz[k]) * cn.tx[k]
      hw[i] = cn.half[k] - Math.abs(off)
    }
    cn.last = last0
    return hw
  }
  // ── the lane planner: a DP over (knot, lateral cell, last move) for the shortest smooth line clear of
  // every obstacle and inside every gate ──
  function planLane(o) {
    const KS = o.KS ?? 5, CELL = o.CELL ?? 15, Wmax = o.Wmax ?? 600, MS = o.MS ?? 3, marg = o.marg ?? 60, wS = o.wS ?? 100
    const obs = o.obs, hw = o.hw
    const i0 = Math.max(0, c.startI - 20), i1 = Math.min(n - 2, c.finishI + 15)
    const K = Math.floor((i1 - i0) / KS) + 1, NC = Math.round(Wmax / CELL) * 2 + 1, mid = (NC - 1) / 2
    const latC = (q) => (q - mid) * CELL
    // Bounds per knot: gates, gorge walls.
    const lo = new Int32Array(K), hi = new Int32Array(K)
    for (let k = 0; k < K; k++) {
      const i = i0 + k * KS
      let b = Wmax
      for (const gi of gateIdx) { const dm = Math.abs(gi - i) * 40; b = Math.min(b, gateHalf - (o.gm ?? 110) + Math.max(0, dm - (o.gz ?? 1200)) * (o.gt ?? 0.1)) }
      b = Math.min(b, hw[i] - 45)
      const nb = Math.max(0, Math.floor(b / CELL))
      lo[k] = Math.max(0, mid - nb); hi[k] = Math.min(NC - 1, mid + nb)
    }
    // Boost pads (+Mach 0.75 each, kept for good under a lit burner): a bonus for a line through them.
    const padB = o.padB ?? 1500, padSeg = Array.from({ length: K }, () => [])
    for (const pd of c.pads) {
      let bi = 0, bd = Infinity
      for (let t = i0; t <= i1; t++) { const d = (c.px[t] - pd.x) ** 2 + (c.pz[t] - pd.z) ** 2; if (d < bd) { bd = d; bi = t } }
      if (bd > 1e6) continue
      const k = Math.floor((bi - i0) / KS); if (k < 0 || k >= K - 1) continue
      padSeg[k].push({ u: (bi - (i0 + k * KS)) / KS, lat: latOf(bi, pd.x, pd.z) })
    }
    // Obstacles bucketed by knot.
    const buck = Array.from({ length: K }, () => [])
    for (const ob of obs) { const k = Math.round((ob.i - i0) / KS); for (let d = -2; d <= 2; d++) if (k + d >= 0 && k + d < K) buck[k + d].push(ob) }
    // Is the segment knot k (cell a) → k+1 (cell b) clear?
    const segPen = (k, a, b) => {
      const L = buck[k]; if (!L.length) return 0
      const ia = i0 + k * KS, la = latC(a), lb = latC(b)
      let pen = 0
      for (let s = 0; s <= 4; s++) {
        const u = s / 4, ii = ia + KS * u, ll = la + (lb - la) * u
        for (const ob of L) {
          const dx = (ii - ob.i) * 40, dy = ll - ob.lat, rr = ob.r * 1.05 + marg, d2 = dx * dx + dy * dy
          if (d2 < rr * rr) { const d = Math.sqrt(d2); pen += d < ob.r + 8 ? 1e6 : (rr - d) * 60 }
        }
      }
      return pen
    }
    const ND = 2 * MS + 1, INF = 1e18
    let cost = new Float64Array(NC * ND).fill(INF)
    const back = []
    // Start: wherever the grid is (lane near 0).
    for (let q = lo[0]; q <= hi[0]; q++) cost[q * ND + MS] = Math.abs(latC(q)) * 0.5
    for (let k = 0; k < K - 1; k++) {
      const nc = new Float64Array(NC * ND).fill(INF), bk = new Int32Array(NC * ND).fill(-1)
      const i = i0 + k * KS, ds = KS * 40, kp = kap[i + (KS >> 1)]
      for (let a = lo[k]; a <= hi[k]; a++) for (let pd = 0; pd < ND; pd++) {
        const c0 = cost[a * ND + pd]; if (c0 >= INF) continue
        for (let d = -MS; d <= MS; d++) {
          const b = a + d; if (b < lo[k + 1] || b > hi[k + 1]) continue
          const la = latC(a), lb = latC(b), along = ds * (1 + kp * (la + lb) / 2)
          const cc = c0 + Math.hypot(along, lb - la) + wS * ((d - (pd - MS)) * CELL) ** 2 / ds
          if (cc >= nc[b * ND + d + MS]) continue
          let c2 = cc + segPen(k, a, b)
          for (const pd of padSeg[k]) if (Math.abs(la + (lb - la) * pd.u - pd.lat) < 20) c2 -= padB
          if (c2 >= nc[b * ND + d + MS]) continue
          nc[b * ND + d + MS] = c2; bk[b * ND + d + MS] = a * ND + pd
        }
      }
      back.push(bk); cost = nc
    }
    let bi = -1, bc = INF
    for (let x = 0; x < NC * ND; x++) if (cost[x] < bc) { bc = cost[x]; bi = x }
    const lanes = new Float64Array(K)
    for (let k = K - 1; k >= 0; k--) { lanes[k] = latC(Math.floor(bi / ND)); if (k > 0) bi = back[k - 1][bi] }
    return { i0, KS, lanes, ok: bc < INF }
  }
  let LANE = null
  const laneAt = (fi) => {
    if (!LANE) return 0
    const f = Math.max(0, Math.min(LANE.lanes.length - 1.0001, (fi - LANE.i0) / LANE.KS)), k = Math.floor(f), u = f - k
    return LANE.lanes[k] + (LANE.lanes[k + 1] - LANE.lanes[k]) * u
  }
  function setLane(L) { LANE = L }

  // ── search ──
  const done = () => me().finished
  function score() {
    if (done()) return 1e7 - me().finishTime * 1000
    let s = prog() + (P.speed * 2.0) / 40
    if (P.crashing || P.dead) s -= 200
    if (P.spin > 0) s -= 30
    return s
  }
  // Roll a param set for k steps (recording into rec if given). Returns false when finished.
  function roll(p, st, k, rec) {
    for (let j = 0; j < k && !done(); j++) { const s = ctl(p, st); if (rec) rec.push(s); step(s) }
    return !done()
  }
  async function solve(opt) {
    const D = opt.D ?? 30, Hh = opt.H ?? 150, base = { ...DEF, ...(opt.base ?? {}) }
    const mk = opt.cands ?? ((cur) => [
      { ...cur }, { ...base, lane: cur.lane }, { ...cur, fb: cur.fb * 1.6 }, { ...cur, fb: cur.fb / 1.6 },
      { ...cur, burn: 1 }, { ...cur, burn: -1 }, { ...cur, lane: cur.lane + 40 }, { ...cur, lane: cur.lane - 40 },
      { ...cur, lane: 0 }, { ...cur, strafeK: cur.strafeK > 0 ? 0 : 1 / 30 }, { ...cur, fbr: cur.fbr * 1.25 }, { ...cur, fbr: cur.fbr / 1.25 },
    ])
    start()
    const st = { h: Hands() }, rec = []
    let cur = { ...base }
    const t0 = performance.now()
    let nd = 0
    while (!done() && rec.length < 60 * 280) {
      const sv = save(st)
      let best = null, bestS = -Infinity
      for (const p of mk(cur)) {
        p.fb = Math.max(0.3, Math.min(12, p.fb)); p.fbr = Math.max(0.5, Math.min(2, p.fbr)); p.lane = Math.max(-300, Math.min(300, p.lane))
        const st2 = load(sv)
        roll(p, st2, D)
        roll(p.burn === 0 ? p : { ...p, burn: 0 }, st2, Hh)
        const sc = score()
        if (sc > bestS + 1e-9) { bestS = sc; best = p }
      }
      Object.assign(st, load(sv))
      roll(best, st, D, rec)
      cur = best
      if (++nd % 5 === 0) await new Promise((r) => setTimeout(r, 0))
    }
    return { time: done() ? me().finishTime : null, steps: rec, ms: performance.now() - t0, prog: prog() }
  }
  // Plain run of one param set from the start.
  function plain(p) {
    start(); const st = { h: Hands() }, rec = []
    while (!done() && rec.length < 60 * 280) roll(p, st, 60, rec)
    return { time: done() ? me().finishTime : null, steps: rec, prog: prog() }
  }

  window.BL = { sweepObstacles, wallHalf, planLane, setLane, laneAt, DEF, ctl, solve, plain, score, roll, kap, maxKap, turnMaxAt, g, c, P, MACH, n, me, heads, wrap, turnBetween, latOf, gateIdx, Hands, legal, toCtl, step, save, load, prog, start }
})()
