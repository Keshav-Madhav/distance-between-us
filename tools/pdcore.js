// The perfect driver's controller (from tools/perfectdrive.mjs) as a factory, for tools that run it a step at
// a time and branch (tools/rollout.mjs): window.makePD(line, craft, opts) → { control(ov), state(),
// setState(), … }. `ov` overrides one step: burner on/off, a sideways target shift, a steering bias, the air
// brake, no dodge taps. Its own memory (the last target, counters) is part of state() for savestates.
window.makePD = function (line, craft, opts) {
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

  // Pads (+Mach 0.75) to drive through, ramps (a jump: half thrust, no dodge) to go round.
  const place = (x, z) => { let bi = 0, bd = Infinity; for (let k = 0; k < n; k++) { const d = (c.px[k] - x) ** 2 + (c.pz[k] - z) ** 2; if (d < bd) { bd = d; bi = k } } const [tx, tz] = c.tangent(bi); return { i: bi, lat: (x - c.px[bi]) * -tz + (z - c.pz[bi]) * tx } }
  const pads = c.pads.map((q) => place(q.x, q.z)).sort((a, b) => a.i - b.i)
  // (Whoops too — the small bumps that hop the craft into the air, where its thrusters have half the push.)
  const ramps = []; for (let k = 0; k < c.mounds.length; k += 4) ramps.push({ ...place(c.mounds[k], c.mounds[k + 1]), r: c.mounds[k + 3] * (c.mounds[k + 2] >= 20 ? 0.95 : 0.8) })
  ramps.sort((a, b) => a.i - b.i)
  g.start(); g.skipCountdown(); g.hold(true)
  // Every obstacle the collision code itself sees (world.near: course spires, landforms — the world repeats
  // every 72 km, so copies of its mesas and spires stand on a 165 km course — trackside rocks), swept along the
  // course once, each with its true radius at craft height, placed by course index and sideways offset.
  const rocks = opts.sweep ? [] : c.rocks.map((r) => ({ i: r.i, lat: r.lat, r: r.r })).sort((a, b) => a.i - b.i)
  if (opts.sweep) {
    const seen = new Set(), out = [], cam = P.pos.clone()
    for (let j = c.startI; j <= c.finishI; j += 3) {
      cam.set(c.px[j], 0, c.pz[j]); g.world.update(cam, 0)
      const y = (g.course.groundAt ? g.course.groundAt(c.px[j], c.pz[j]) : 0)
      // (Asked far below every base: each one's widest radius — never smaller than what the craft can hit.)
      const k = g.world.near(c.px[j], c.pz[j], -1e6, c.gateHalf + 120, out)
      for (let q = 0; q < k; q++) { const o = out[q], key = Math.round(o.x / 8) + ',' + Math.round(o.z / 8); if (seen.has(key)) continue; seen.add(key)
        let bi = j, bd = Infinity; for (let m = Math.max(0, j - 40); m < Math.min(n, j + 40); m++) { const d = (c.px[m] - o.x) ** 2 + (c.pz[m] - o.z) ** 2; if (d < bd) { bd = d; bi = m } }
        const [tx, tz] = c.tangent(bi), lat = (o.x - c.px[bi]) * -tz + (o.z - c.pz[bi]) * tx
        if (Math.abs(lat) < c.gateHalf + 80) rocks.push({ i: bi, lat, r: o.cr }) }
      void y
    }
    rocks.sort((a, b) => a.i - b.i)
  }
  const sweptCount = rocks.length
  g.start(); g.skipCountdown(); g.autopilot(false); g.hold(true); P.noCollide = false
  const me = g.race.racers[0]
  const ctl = { steer: 0, strafe: 0, boost: true, burner: false, brake: false, dodgeL: false, dodgeR: false }
  g.force(ctl)
  let steps = 0, burnSteps = 0, dodges = 0, crashes = 0, wasCrash = false
  const crashLog = []
  let lastTarget = 0, stuckSteps = 0, lastSteer = 0
  function control(ov = {}) {
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
    // Lateral plan: a shortest path through the obstacles ahead. Each spire, ramp or whoop in reach (~3 s) is a
    // layer of clear sideways positions (every 12 m across the corridor); a step between layers is allowed only
    // if the side thrusters can make the shift in the time between them (~opts.latV m/s held, half in the air);
    // the cost is distance from the racing line, less a pull through any pad. Dynamic programming picks the
    // path; the target is its first point. (One position for the whole stretch failed wherever two spires sat
    // on opposite sides — the weave SPRINT is built round.)
    const reach = v * (P.airborne ? 3.4 : opts.reach), lim = opts.bound ? Math.min(c.gateHalf - 30, opts.bound - 60) : c.gateHalf - 30
    const layers = []
    for (const r of rocks) { if (r.i < i - 1) continue; const ahead = (r.i - i) * 40; if (ahead > reach) break; layers.push({ i: r.i, ahead, blocks: [[r.lat, r.r + opts.margin]] }) }
    for (const q of ramps) { if (q.i < i - 3) continue; const ahead = (q.i - i) * 40; if (ahead > reach) break; layers.push({ i: q.i, ahead, blocks: [[q.lat, q.r + 20]] }) }
    let padHere = null
    for (const q of pads) { if (q.i < i) continue; const ahead = (q.i - i) * 40; if (ahead > reach) break; layers.push({ i: q.i, ahead, blocks: [], pad: q.lat }); if (padHere === null) padHere = q.lat }
    layers.sort((a, b) => a.i - b.i)
    // (Same place: merged into one layer.)
    const L2 = []
    for (const l of layers) { const last = L2[L2.length - 1]; if (last && Math.abs(last.i - l.i) <= 2) { last.blocks.push(...l.blocks); if (l.pad !== undefined) last.pad = l.pad } else L2.push({ ...l, blocks: [...l.blocks] }) }
    const latV = opts.latV * (P.airborne ? 0.5 : 1)
    const xs = []; for (let x = -lim; x <= lim; x += 12) xs.push(x)
    let target = latAt(i + Math.min(60, reach / 40)), danger = 0, stuck = false
    if (L2.length) {
      danger = 1 - L2[0].ahead / reach
      // cost[k][x]: best from layer k onward; built back to front.
      const free = (l, x) => l.blocks.every(([o, cl]) => Math.abs(x - o) >= cl)
      const nodeCost = (l, x) => Math.abs(x - latAt(l.i)) * 0.01 + (l.pad !== undefined ? (Math.abs(x - l.pad) < 28 ? -3 : 0) : 0)
      let next = xs.map(() => 0)
      const choice = []
      for (let k = L2.length - 1; k >= 0; k--) {
        const l = L2[k], cur = xs.map(() => Infinity), pick = xs.map(() => -1)
        const dt = k + 1 < L2.length ? (L2[k + 1].i - l.i) * 40 / Math.max(v, 1) : 1
        const maxD = latV * dt
        for (let a = 0; a < xs.length; a++) {
          if (!free(l, xs[a])) continue
          if (k === L2.length - 1) { cur[a] = nodeCost(l, xs[a]); continue }
          let best = Infinity, bj = -1
          for (let b = 0; b < xs.length; b++) { if (next[b] === Infinity || Math.abs(xs[b] - xs[a]) > maxD) continue; if (next[b] < best) { best = next[b]; bj = b } }
          if (bj >= 0) { cur[a] = nodeCost(l, xs[a]) + best; pick[a] = bj }
        }
        choice[k] = pick; next = cur
      }
      // The first layer's point we can reach from here in time, cheapest onward.
      const dt0 = L2[0].ahead / Math.max(v, 1), reach0 = latV * dt0 + 10
      let bestA = -1, bestC = Infinity
      for (let a = 0; a < xs.length; a++) { if (next[a] === Infinity || Math.abs(xs[a] - myLat) > reach0) continue; const c2 = next[a] + Math.abs(xs[a] - lastTarget) * 0.002; if (c2 < bestC) { bestC = c2; bestA = a } }
      // (No clear path reachable at this speed: aim for the nearest clear one, and slow down to buy the time.)
      if (bestA < 0) { stuck = true; for (let a = 0; a < xs.length; a++) { if (next[a] === Infinity) continue; const c2 = Math.abs(xs[a] - myLat); if (c2 < bestC) { bestC = c2; bestA = a } } }
      if (bestA >= 0) target = xs[bestA]
    }
    lastTarget = target
    if (ov.latShift) target += ov.latShift
    if (opts.bound) target = Math.max(-(opts.bound - 40), Math.min(opts.bound - 40, target))
    const e = target - myLat
    ctl.steer = Math.max(-1, Math.min(1, -yawWant / Math.max(0.15, P.turnMax)))
    // In the air: the nose kept on the travel (land crooked and it spins). The thrusters keep working — the
    // spin is from the slide (nose vs travel), not their sideways drift, and at Mach 9 it is airborne often.
    if (P.airborne && opts.airAlign) {
      const vh = Math.atan2(P.vel.x, P.vel.z)
      let be = vh - P.heading; while (be > Math.PI) be -= 2 * Math.PI; while (be < -Math.PI) be += 2 * Math.PI
      ctl.steer = Math.max(-1, Math.min(1, -be * 6))
    }
    if (stuck && opts.slow) { stuckSteps++; if (danger > opts.brakeAt) brake = true }
    ctl.burner = burnOk && !brake && !(stuck && opts.slow)
    ctl.brake = brake
    ctl.boost = !brake
    ctl.strafe = Math.max(-1, Math.min(1, e / opts.strafeK - P.side / 140))
    const tap = danger > 0.4 ? opts.tapNear : opts.tapFar
    ctl.dodgeL = e < -tap && P.side > -180; ctl.dodgeR = e > tap && P.side < 180
    // calm: the same aim with less fuss — the steer eased toward its new value instead of snapping, small
    // sideways corrections left to drift out, no dodge taps (each wobble of the nose costs speed).
    if (ov.calm) { ctl.steer = lastSteer + (ctl.steer - lastSteer) * 0.25; if (Math.abs(e) < 25) ctl.strafe = 0; ctl.dodgeL = ctl.dodgeR = false }
    if (ov.steerBias) ctl.steer = Math.max(-1, Math.min(1, ctl.steer + ov.steerBias))
    if (ov.burner !== undefined) ctl.burner = ov.burner
    if (ov.brake) { ctl.brake = true; ctl.boost = false; ctl.burner = false }
    if (ov.noDodge) { ctl.dodgeL = false; ctl.dodgeR = false }
    if (ctl.dodgeL || ctl.dodgeR) dodges++
    lastSteer = ctl.steer
    if (ctl.burner) burnSteps++
  }
  return { control, ctl, me, P, sweptCount, rocks, state: () => ({ lastTarget, stuckSteps, steps, burnSteps, dodges, crashes, wasCrash, lastSteer }), setState: (s) => { ({ lastTarget, stuckSteps, steps, burnSteps, dodges, crashes, wasCrash, lastSteer } = s); lastSteer ??= 0 } }
}
