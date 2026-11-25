// MPC driver (savestates): every D steps try candidate blocks (burner on/off × lateral aim offset) from
// g.snap(), each followed by the rule controller to a horizon H, score progress + speed (− penalties),
// commit the best block. Records its own (float32) inputs; replays them clean at the end to confirm.
//   node mpc.mjs cfg.json   (array of configs, run one after another)
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const here = new URL('.', import.meta.url).pathname
const cfgs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await page.goto(`http://localhost:4480/?course=canyon&fixed=1`)
await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
const root = here + '../../../../'
await page.addScriptTag({ content: fs.readFileSync(root + 'tools/pdcore.js', 'utf8') })
await page.evaluate((craft) => { window.makePD(null, craft, { look: 1.2, margin: 34, reach: 3, burnK: 1.2, burnErr: 0.1, latV: 150, airAlign: true, sweep: true, strafeK: 20, slow: true, brakeAt: 0.35, tapNear: 35, tapFar: 70 }) }, JSON.parse(fs.readFileSync(root + 'tools/optruns/craft-model.json', 'utf8')))
const D0 = { pred: 0.1, ffa: 0.1, kp: 1, ff: 1, lmin: 300, tl: 0.25, bk: 8, minOff: 4, minOn: 4, ks: 0.02, kd: 0.01, D: 6, H: 60, Wv: 1.0, aims: [-60, 0, 60], burns: [1, 0], latLim: 0, latPen: 50, startOff: 0, maxT: 40, sb: 0, sbw: 0.05, sbt: 0, rl: 0 }
async function run(cfg) {
  const line = JSON.parse(fs.readFileSync(here + cfg.line, 'utf8'))
  return await page.evaluate(async ([line, cfg]) => {
    const g = window.__g, P = g.player, c = g.course, STEP = 1 / 60, MACH = 343
    const X = line.x, Z = line.z, m = X.length
    const at = (f) => { const a = Math.max(0, Math.min(m - 1.001, f)), k = Math.floor(a), t = a - k; return [X[k] + (X[k + 1] - X[k]) * t, Z[k] + (Z[k + 1] - Z[k]) * t] }
    const me = () => g.race.racers[0]
    // controller: cs = {j, offN, onN}; mode {burn: -1 rule / 1 on / 0 off, aim: metres}
    function ctrl(cs, mode) {
      let bj = cs.j, best = 1e18
      for (let k = Math.max(0, cs.j - 3); k < Math.min(m, cs.j + 60); k++) { const dd = (X[k] - P.pos.x) ** 2 + (Z[k] - P.pos.z) ** 2; if (dd < best) { best = dd; bj = k } }
      cs.j = bj
      const j = bj, v = Math.max(P.speed, 50), Ld = Math.max(cfg.lmin, v * cfg.tl)
      let [ax, az] = at(j + Ld / 40)
      const [a2x, a2z] = at(j + Ld / 40 + 1), tl0 = Math.hypot(a2x - ax, a2z - az) || 1
      { const ux = (a2x - ax) / tl0, uz = (a2z - az) / tl0; ax += uz * mode.aim; az -= ux * mode.aim }
      const hv = Math.atan2(P.vel.x, P.vel.z)
      const qx = P.pos.x + P.vel.x * cfg.pred, qz = P.pos.z + P.vel.z * cfg.pred
      let al = Math.atan2(ax - qx, az - qz) - hv; al = Math.atan2(Math.sin(al), Math.cos(al))
      const fa = v * cfg.ffa / 40
      const [bx, bz] = at(j + 1 + fa), [cx, cz] = at(j + 3 + fa), [dx0, dz0] = at(j - 1 + fa)
      let dh = Math.atan2(cx - bx, cz - bz) - Math.atan2(bx - dx0, bz - dz0); dh = Math.atan2(Math.sin(dh), Math.cos(dh))
      const kap = dh / Math.max(1, Math.hypot(cx - dx0, cz - dz0))
      const omega = 2 * v * Math.sin(al) / Ld * cfg.kp + cfg.ff * kap * v
      const full = Math.max(0.05, P.turnMax / (P.burning ? 0.1 : 1))
      let burn
      if (mode.burn === 1) burn = true
      else if (mode.burn === 0) burn = false
      else {
        burn = Math.abs(omega) < full * 0.1 * cfg.bk
        if (burn && !P.burning && cs.offN < cfg.minOff) burn = false
        if (!burn && P.burning && cs.onN < cfg.minOn) burn = true
      }
      if (cs.st < cfg.startOff) burn = false
      cs.offN = burn ? 0 : cs.offN + 1; cs.onN = burn ? cs.onN + 1 : 0
      const steer = Math.max(-1, Math.min(1, -omega / (full * (burn ? 0.1 : 1))))
      const [lx, lz] = at(j), [nx, nz] = at(j + 1)
      const tl = Math.hypot(nx - lx, nz - lz) || 1, tx = (nx - lx) / tl, tz = (nz - lz) / tl
      const e = (P.pos.x - lx) * tz - (P.pos.z - lz) * tx - mode.aim, ev = P.vel.x * tz - P.vel.z * tx
      const rr = P.right.x * tz - P.right.z * tx
      const strafe = cfg.ks ? Math.max(-1, Math.min(1, -(cfg.ks * e + cfg.kd * ev) * Math.sign(rr || 1))) : 0
      let st2 = strafe
      if (cfg.sb) st2 = Math.max(-1, Math.min(1, -cfg.sb * Math.sign(P.yawRate) * Math.min(1, Math.abs(P.yawRate) / cfg.sbw) + (cfg.sbt ? strafe : 0)))
      let sr = steer
      if (cfg.rl) { sr = cs.ps + Math.max(-cfg.rl, Math.min(cfg.rl, steer - cs.ps)); st2 = cs.pst + Math.max(-cfg.rl, Math.min(cfg.rl, st2 - cs.pst)) }
      sr = Math.fround(sr); st2 = Math.fround(st2); cs.ps = sr; cs.pst = st2
      return { steer: sr, strafe: st2, boost: true, burner: burn, brake: false, dodgeL: false, dodgeR: false }
    }
    const latOf = () => { const i = me().idx, [tx, tz] = c.tangent(i); return (P.pos.x - c.px[i]) * -tz + (P.pos.z - c.pz[i]) * tx }
    // one step; returns flags of trouble
    function step(cs, mode, rec) {
      const ct = ctrl(cs, mode)
      g.force(ct); g.fastSim(STEP); cs.st++
      if (rec) rec.push(ct.steer, ct.strafe, 1 | (ct.burner ? 2 : 0))
    }
    g.hold(true); g.replayWith([0, 0, 1]); g.skipCountdown(); g.hold(true)
    const cs = { j: 0, offN: 99, onN: 0, st: 0, ps: 0, pst: 0 }
    { let best = 1e18; for (let k = 0; k < m; k++) { const dd = (X[k] - P.pos.x) ** 2 + (Z[k] - P.pos.z) ** 2; if (dd < best) { best = dd; cs.j = k } } }
    const rec = []
    const cands = []; for (const b of cfg.burns) for (const a of cfg.aims) cands.push({ burn: b, aim: a })
    const RULE = { burn: -1, aim: 0 }
    cfg.endJ = c.finishI - line.i0
    let decisions = 0
    while (!me().finished && cs.st < 60 * cfg.maxT && !P.crashing) {
      const snap = g.snap(), cs0 = { ...cs }, miss0 = snap.missedCount
      let bestK = 0, bestS = -1e18
      for (let k = 0; k < cands.length; k++) {
        if (k > 0) g.restore(snap)
        const s = { ...cs0 }
        let pen = 0
        for (let q = 0; q < cfg.H && !me().finished; q++) {
          step(s, q < cfg.D ? cands[k] : RULE, null)
          if (P.crashing) { pen += 1e7; break }
          if (P.spin > 0) pen += 1e4
          if (cfg.latLim) { const l = Math.abs(latOf()); if (l > cfg.latLim && me().passed >= 1) pen += cfg.latPen * (l - cfg.latLim) }
        }
        if (g.snap().missedCount > miss0) pen += 1e6
        const prog = me().finished ? 1e6 - me().finishTime * 1e4 : cfg.Wv === 'T' ? -1e4 * (s.st / 60 + Math.max(0, (cfg.endJ - s.j) * 40) / Math.max(P.speed, 300)) : (s.j * 40) + cfg.Wv * P.speed
        const sc = prog - pen
        if (sc > bestS) { bestS = sc; bestK = k }
      }
      g.restore(snap)
      Object.assign(cs, cs0)
      for (let q = 0; q < cfg.D && !me().finished; q++) step(cs, cands[bestK], rec)
      decisions++
      if (decisions % 5 === 0) await new Promise((r) => setTimeout(r, 0))
    }
    const t1 = me().finished ? me().finishTime : null
    const endPos = [P.pos.x, P.pos.z]; let drift = null
    // clean replay of the recorded inputs
    g.force(null)
    g.hold(true); g.replayWith(rec); g.skipCountdown(); g.hold(true)
    let st = 0, maxLat = 0, top = 0; const ev = [], trace = []; let missed0 = g.snap().missedCount, wasAir = false, yawSum = 0, pads = 0, lastSp = P.speed, burnN = 0
    const n = rec.length / 3
    while (!me().finished && st < n + 60 * 8) {
      if (st >= n) g.force({ steer: 0, strafe: 0, boost: true, burner: false, brake: false, dodgeL: false, dodgeR: false })
      g.fastSim(STEP); st++
      if (st === n) drift = Math.hypot(P.pos.x - endPos[0], P.pos.z - endPos[1])
      top = Math.max(top, P.speed / MACH)
      yawSum += Math.abs(P.yawRate) / 60; if (P.speed - lastSp > 200) { pads++; ev.push((st / 60).toFixed(2) + ':pad') } lastSp = P.speed; if (P.burning) burnN++
      const l = Math.round(latOf()); if (me().passed >= 1 && !me().finished) maxLat = Math.max(maxLat, Math.abs(l))
      if (P.airborne && !wasAir) ev.push((st / 60).toFixed(2) + ':air'); wasAir = P.airborne
      if (st % 30 === 0) trace.push([+(st / 60).toFixed(1), +(P.speed / MACH).toFixed(2), l, P.burning ? 'B' : ''])
    }
    return { yawSum: +yawSum.toFixed(2), pads, burn: +(burnN / st).toFixed(2), drift, mpcTime: t1, time: me().finished ? me().finishTime : null, missed: g.snap().missedCount - missed0, maxLat, top: +top.toFixed(2), ev, trace, steps: rec }
  }, [line, cfg])
}
for (const c of cfgs) {
  const cfg = { ...D0, ...c }
  const t0 = Date.now()
  const r = await run(cfg)
  const steps = []; for (let i = 0; i < r.steps.length; i += 3) steps.push([r.steps[i], r.steps[i + 1], r.steps[i + 2]])
  fs.writeFileSync(here + 'm-' + cfg.name + '.json', JSON.stringify({ course: 'canyon', cfg, steps }))
  delete r.steps
  fs.writeFileSync(here + 'mr-' + cfg.name + '.json', JSON.stringify(r))
  console.log(JSON.stringify({ name: cfg.name, drift: r.drift, mpc: r.mpcTime, time: r.time, missed: r.missed, maxLat: r.maxLat, top: r.top, yaw: r.yawSum, pads: r.pads, burn: r.burn, ev: r.ev.filter((e) => !e.endsWith('pad')).slice(0, 6).join(' '), sec: Math.round((Date.now() - t0) / 1000) }))
}
await browser.close()
