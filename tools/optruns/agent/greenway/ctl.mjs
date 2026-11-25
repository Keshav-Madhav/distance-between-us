// Closed-loop driver for GREENWAY: follows a precomputed racing line (line.mjs) in the real sim via g.force,
// records the per-step inputs; the output is then verified with tools/agentrun.mjs (the replay is what counts).
// usage: node ctl.mjs params.json|params-list.json out-inputs.json
// Burner: held when the turn asked for fits the burner's 10% steering; otherwise a sigma-delta duty cycle
// (burner on some steps, full authority on the others) so the average turn rate matches the asked one.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const [pf, out] = process.argv.slice(2)
const prmAll = JSON.parse(fs.readFileSync(pf, 'utf8'))
const LIST = Array.isArray(prmAll) ? prmAll : [prmAll]
const DIR = new URL('.', import.meta.url).pathname
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const ctx = await browser.newContext({ viewport: { width: 320, height: 180 } })
for (let ci = 0; ci < LIST.length; ci++) {
  const prm = LIST[ci]
  const line = JSON.parse(fs.readFileSync(DIR + prm.line, 'utf8'))
  const page = await ctx.newPage()
  await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
  await page.goto(`http://localhost:4480/?course=greenway&fixed=1`)
  await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
  await page.addScriptTag({ content: fs.readFileSync('tools/pdcore.js', 'utf8') })
  await page.evaluate((craft) => { window.makePD(null, craft, { look: 1.2, margin: 34, reach: 3, burnK: 1.2, burnErr: 0.1, latV: 150, airAlign: true, sweep: true, strafeK: 20, slow: true, brakeAt: 0.35, tapNear: 35, tapFar: 70 }) }, JSON.parse(fs.readFileSync('tools/optruns/craft-model.json', 'utf8')))
  const rep = await page.evaluate(async ([prm, line]) => {
    const g = window.__g, P = g.player, c = g.course, race = g.race, MACH = 343
    const poly = line.pts, NP = poly.length
    const cum = [0]; for (let i = 1; i < NP; i++) cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]))
    const total = cum[NP - 1]
    // curvature per point (signed, + = heading increasing)
    const kap = new Float64Array(NP)
    for (let i = 1; i < NP - 1; i++) { const h0 = Math.atan2(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]), h1 = Math.atan2(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]); kap[i] = Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)) / ((cum[i + 1] - cum[i - 1]) / 2) }
    const kapS = new Float64Array(NP)
    for (let i = 4; i < NP - 5; i++) { const ha = Math.atan2(poly[i - 3][0] - poly[i - 4][0], poly[i - 3][1] - poly[i - 4][1]), hb = Math.atan2(poly[i + 5][0] - poly[i + 4][0], poly[i + 5][1] - poly[i + 4][1]); kapS[i] = Math.abs(Math.atan2(Math.sin(hb - ha), Math.cos(hb - ha))) / (cum[i + 4] - cum[i - 4]) }
    let segHint = 1
    const seg = (s) => { let i = Math.max(1, Math.min(NP - 1, segHint)); while (i < NP - 1 && cum[i] < s) i++; while (i > 1 && cum[i - 1] > s) i--; return i }
    const at = (s) => { s = Math.max(0, Math.min(total, s)); const i = seg(s); const f = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [poly[i - 1][0] + f * (poly[i][0] - poly[i - 1][0]), poly[i - 1][1] + f * (poly[i][1] - poly[i - 1][1])] }
    const kAt = (s) => { const i = seg(Math.max(0, Math.min(total, s))); return kap[Math.min(NP - 2, i)] }
    const kSAt = (s) => { const i = seg(Math.max(0, Math.min(total, s))); return kapS[Math.min(NP - 2, i)] }
    const proj = (x, z) => { let best = 1e18, bs = 0, bi = segHint; for (let i = Math.max(1, segHint - 30); i < Math.min(NP, segHint + 60); i++) { const ax = poly[i - 1][0], az = poly[i - 1][1], dx = poly[i][0] - ax, dz = poly[i][1] - az; const L2 = dx * dx + dz * dz || 1; let f = ((x - ax) * dx + (z - az) * dz) / L2; f = Math.max(0, Math.min(1, f)); const ex = ax + f * dx - x, ez = az + f * dz - z, d = ex * ex + ez * ez; if (d < best) { best = d; bs = cum[i - 1] + f * Math.sqrt(L2); bi = i } } segHint = bi; return [bs, Math.sqrt(best)] }
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
    g.hold(true); g.replayWith([0, 0, 1]); g.skipCountdown(); g.hold(true)
    const me = race.racers[0]
    const steps = [], trace = [], evs = []
    const pads = c.pads.map((p) => ({ x: p.x, z: p.z, tx: p.tx, tz: p.tz })); let maxLatTr = 0, padI = 0, npad = 0, lastPC = 0, st = 0, acc = 0, wasCrash = false, wasSpin = false, wasAir = false, maxLat = 0, maxOff = 0, lastHull = 100, offSum = 0, burnN = 0
    const buf = []
    while (st < 60 * 90 && !me.finished) {
      const v = P.speed, m = v / MACH
      const tp = prm.tp ?? 0.12, la = prm.la ?? 0.25
      const vh0 = Math.atan2(P.vel.x, P.vel.z) || P.heading
      let vh = vh0 + P.yawRate * tp
      let ppx = P.pos.x + Math.sin(vh0 + P.yawRate * tp / 2) * v * tp, ppz = P.pos.z + Math.cos(vh0 + P.yawRate * tp / 2) * v * tp
      if (prm.sidePred) {
        // the side velocity decays (tau 0.31 s): predict the travel without the part that will be gone
        const hp = P.heading + P.yawRate * tp, e = Math.exp(-3.2 * tp), sd = P.side, la0 = P.lateral * (prm.latKeep ?? 0.3)
        const vx = Math.sin(hp) * v - Math.cos(hp) * (la0 + sd * e), vz = Math.cos(hp) * v + Math.sin(hp) * (la0 + sd * e)
        vh = Math.atan2(vx, vz)
        const hm = P.heading + P.yawRate * tp / 2, sdi = sd * (1 - e) / 3.2
        ppx = P.pos.x + Math.sin(hm) * v * tp - Math.cos(hm) * sdi; ppz = P.pos.z + Math.cos(hm) * v * tp + Math.sin(hm) * sdi
      }
      const [s, dOff] = proj(ppx, ppz)
      const L = Math.max(prm.laMin ?? 150, v * la)
      let tgt = at(s + L)
      // next pad (race order): aim straight at it in the last padT seconds, no dodges meanwhile
      while (padI < pads.length) { const pd = pads[padI]; const al = (P.pos.x - pd.x) * pd.tx + (P.pos.z - pd.z) * pd.tz; if (al > 60) padI++; else break }
      let quiet = false
      if (prm.padT && padI < pads.length) { const pd = pads[padI]; const d = Math.hypot(pd.x - ppx, pd.z - ppz); if (d < v * prm.padT && d < 3000) { quiet = true; if (d > (prm.padAimMin ?? 120)) tgt = [pd.x + pd.tx * (prm.padLead ?? 0), pd.z + pd.tz * (prm.padLead ?? 0)] } }
      if (prm.guard) {
        const ii = me.idx, [gx, gz] = c.tangent(ii); const latNow = (P.pos.x - c.px[ii]) * -gz + (P.pos.z - c.pz[ii]) * gx
        // centreline lateral of the target; clamp it inside the guard
        const jj = Math.min(c.n - 1, ii + Math.round(L / 40)), [hx, hz] = c.tangent(jj)
        const tl = (tgt[0] - c.px[jj]) * -hz + (tgt[1] - c.pz[jj]) * hx
        const lim = prm.guard - Math.max(0, Math.abs(latNow) - prm.guard) * (prm.guardK ?? 1)
        if (Math.abs(tl) > lim) { const nl = Math.sign(tl) * lim; tgt = [tgt[0] - (-hz) * (tl - nl), tgt[1] - hx * (tl - nl)] }
        if (Math.abs(latNow) > prm.guard) quiet = true
      }
      const want = Math.atan2(tgt[0] - ppx, tgt[1] - ppz)
      const err = wrap(want - vh)
      let yawD = (prm.kp ?? 2) * v * Math.sin(err) / L
      if (prm.kff) { const sf = s + v * (prm.tff ?? 0.1); let kk = 0; const n = 5; for (let j = 0; j < n; j++) kk += kAt(sf + (j - 2) * 80); yawD += prm.kff * v * kk / n }
      const T = Math.max(0.05, P.turnMax / (P.burning ? 0.1 : 1))
      const bm = prm.bm ?? 0.9
      let steer, burn
      // speed limit from the line's curvature ahead (2.2 rad/s is the most grip gives)
      let vlim = 1e9
      if (prm.vlimK) { for (let d = 0; d <= v * (prm.vlimT ?? 1.0); d += 80) { const k = kSAt(s + d); if (k > 1e-6) vlim = Math.min(vlim, prm.vlimK * 2.2 / k) } }
      const need = Math.abs(yawD) / T
      if (prm.noBurn || (prm.burnMach != null && m > prm.burnMach)) { burn = false; steer = -yawD / T }
      else if (need <= 0.1 * bm) { burn = true; steer = -yawD / (0.1 * T) }
      else {
        const d = Math.max(0, Math.min(1, (1 - need / (prm.dm ?? 1)) / 0.9))
        acc += d; burn = acc >= 1; if (burn) acc -= 1
        steer = -yawD / (T * (1 - 0.9 * d))
      }
      if (v > vlim) burn = false
      steer = Math.max(-1, Math.min(1, steer))
      let fl = 1 | (burn ? 2 : 0)
      if (prm.brakeK && v > vlim * prm.brakeK) fl = 4
      if (st < (prm.noBurnFirst ?? 0)) fl = 1
      // side thrusters into the turn: the yaw re-splits that sideways velocity into forward speed
      let strafe = 0
      const yr = prm.strafeUse === 'yaw' ? P.yawRate : yawD
      if (prm.strafeK && !quiet) strafe = Math.max(-1, Math.min(1, -yr * prm.strafeK))
      if (prm.dodgeThr != null && !quiet && Math.abs(yr) > prm.dodgeThr) fl |= yr < 0 ? 16 : 8
      const cc = [+steer.toFixed(4), +strafe.toFixed(3), fl]
      g.force({ steer: cc[0], strafe: cc[1], boost: !!(fl & 1), burner: !!(fl & 2), brake: !!(fl & 4), dodgeL: !!(fl & 8), dodgeR: !!(fl & 16) })
      steps.push(cc); if (burn) burnN++
      g.fastSim(1 / 60); st++
      if (me.padCool > lastPC + 0.5) npad++; lastPC = me.padCool
      if (dOff > 150 && maxOff <= 150) evs.push(['off', +(st / 60).toFixed(2), me.idx, Math.round(dOff), +m.toFixed(1)])
      maxOff = Math.max(maxOff, dOff); offSum += dOff
      if (P.crashing && !wasCrash) evs.push(['crash', +(st / 60).toFixed(2), Math.round(P.pos.x), Math.round(P.pos.z), +m.toFixed(1)]); wasCrash = P.crashing
      if (P.hull < lastHull - 0.5) evs.push(['hurt', +(st / 60).toFixed(2), Math.round(lastHull - P.hull), +m.toFixed(1)]); lastHull = P.hull
      if (P.spin > 0 && !wasSpin) evs.push(['spin', +(st / 60).toFixed(2)]); wasSpin = P.spin > 0
      if (P.airborne && !wasAir) evs.push(['air', +(st / 60).toFixed(2), Math.round(P.pos.x), Math.round(P.pos.z), me.idx, Math.round(dOff), +m.toFixed(1)]); wasAir = P.airborne
      const i = me.idx, [tx, tz] = c.tangent(i); const lat = Math.round((P.pos.x - c.px[i]) * -tz + (P.pos.z - c.pz[i]) * tx)
      maxLat = Math.max(maxLat, Math.abs(lat)); if (st % 30 === 0) maxLatTr = Math.max(maxLatTr, Math.abs(lat))
      if (st % (prm.trEvery ?? 30) === 0) trace.push([+(st / 60).toFixed(1), +(P.speed / MACH).toFixed(2), lat, Math.round(dOff), me.passed, P.burning ? 'B' : ''])
      if (st % 4 === 0) await new Promise((r) => setTimeout(r, 0))
    }
    const rec = g.inputs(); const rsteps = []; for (let i = 0; i < rec.length; i += 3) rsteps.push([rec[i], rec[i + 1], rec[i + 2]])
    return { maxLatTr, rsteps, pads: npad, finished: me.finished, time: me.finished ? +me.finishTime.toFixed(3) : null, missed: g.snap().missedCount, passed: me.passed, maxLat, maxOff: Math.round(maxOff), meanOff: Math.round(offSum / st), burnShare: +(burnN / st).toFixed(2), topMach: +P.topMach.toFixed(2), steps, trace, evs }
  }, [prm, line])
  const outF = LIST.length > 1 ? out.replace('.json', '-' + ci + '.json') : out
  fs.writeFileSync(outF, JSON.stringify({ course: 'greenway', time: rep.time, steps: rep.rsteps, prm }))
  console.log(ci, JSON.stringify(prm), JSON.stringify({ pads: rep.pads, finished: rep.finished, time: rep.time, missed: rep.missed, passed: rep.passed, maxLat: rep.maxLat, maxLatTr: rep.maxLatTr, maxOff: rep.maxOff, meanOff: rep.meanOff, burnShare: rep.burnShare, topMach: rep.topMach, evs: rep.evs.slice(0, 30) }))
  if (LIST.length === 1 || prm.showTrace) console.log(rep.trace.map((r) => r.join(' ')).join(' | '))
  await page.close()
}
await browser.close()
