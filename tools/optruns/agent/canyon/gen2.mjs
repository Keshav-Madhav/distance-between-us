// Closed-loop generator v2 (post burner-kick change): pursuit on a racing line, burner HELD whenever the
// needed turn fits in the burner's 10% steering, strafe for fine lateral tracking (pads, gates).
//   node gen2.mjs configs.json      (array: run each; object {base, ranges, iters, name, seed}: hill-climb)
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
async function roll(cfg, save = true) {
  const line = JSON.parse(fs.readFileSync(here + cfg.line, 'utf8'))
  const rep = await page.evaluate(async ([line, cfg]) => {
    const g = window.__g, P = g.player, c = g.course, STEP = 1 / 60, MACH = 343
    const X = line.x, Z = line.z, m = X.length
    const ctl = { steer: 0, strafe: 0, boost: true, burner: false, brake: false, dodgeL: false, dodgeR: false }
    g.hold(true); g.replayWith([0, 0, 1]); g.skipCountdown(); g.hold(true)
    const me = g.race.racers[0]
    let j = 0, best = 1e18
    for (let k = 0; k < m; k++) { const dd = (X[k] - P.pos.x) ** 2 + (Z[k] - P.pos.z) ** 2; if (dd < best) { best = dd; j = k } }
    const gates = [], events = [], trace = []
    let passed = me.passed, wasAir = false, wasSpin = false, wasCrash = false, top = 0, st = 0, nAir = 0, offN = 99, onN = 0, maxLat = 0, pads = 0, lastSp = P.speed, started = false
    const m0 = g.snap().missedCount; let missed = m0
    const at = (f) => { const a = Math.max(0, Math.min(m - 1.001, f)), k = Math.floor(a), t = a - k; return [X[k] + (X[k + 1] - X[k]) * t, Z[k] + (Z[k + 1] - Z[k]) * t] }
    while (st < 60 * 60) {
      let bj = j; best = 1e18
      for (let k = Math.max(0, j - 3); k < Math.min(m, j + 60); k++) { const dd = (X[k] - P.pos.x) ** 2 + (Z[k] - P.pos.z) ** 2; if (dd < best) { best = dd; bj = k } }
      j = bj
      const v = Math.max(P.speed, 50)
      const Ld = Math.max(cfg.lmin, v * cfg.tl)
      const [ax, az] = at(j + Ld / 40)
      const hv = Math.atan2(P.vel.x, P.vel.z)
      const qx = P.pos.x + P.vel.x * cfg.pred, qz = P.pos.z + P.vel.z * cfg.pred
      let al = Math.atan2(ax - qx, az - qz) - hv; al = Math.atan2(Math.sin(al), Math.cos(al))
      const fa = v * cfg.ffa / 40
      const [bx, bz] = at(j + 1 + fa), [cx, cz] = at(j + 3 + fa), [dx0, dz0] = at(j - 1 + fa)
      let dh = Math.atan2(cx - bx, cz - bz) - Math.atan2(bx - dx0, bz - dz0); dh = Math.atan2(Math.sin(dh), Math.cos(dh))
      const kap = dh / Math.max(1, Math.hypot(cx - dx0, cz - dz0))
      const omega = 2 * v * Math.sin(al) / Ld * cfg.kp + cfg.ff * kap * v
      const full = Math.max(0.05, P.turnMax / (P.burning ? 0.1 : 1))
      // burner: hold when the turn needed (now and a little ahead) fits in its 10% steering
      const [ex, ez] = at(j + 2 + v * cfg.blook / 40), [fx, fz] = at(j + 4 + v * cfg.blook / 40), [gx, gz] = at(j + v * cfg.blook / 40)
      let dh2 = Math.atan2(fx - ex, fz - ez) - Math.atan2(ex - gx, ez - gz); dh2 = Math.atan2(Math.sin(dh2), Math.cos(dh2))
      const kap2 = Math.abs(dh2) / Math.max(1, Math.hypot(fx - gx, fz - gz))
      const need = Math.max(Math.abs(omega), kap2 * v * cfg.bkap)
      let burn = need < full * 0.1 * cfg.bk && P.speed / MACH < cfg.bcap
      if (P.speed / MACH < cfg.startB) burn = true
      if (cfg.holdOff && P.speed / MACH > cfg.relM && P.speed / MACH < cfg.pressM && st < 60 * 12 && !started) burn = false
      if (P.speed / MACH >= cfg.pressM) started = true
      if (burn && P.burning === false && offN < cfg.minOff) burn = false
      if (!burn && P.burning && onN < cfg.minOn && need < full * 0.1 * cfg.bk2) burn = true
      if (P.airborne && cfg.airB === 0) burn = false
      offN = burn ? 0 : offN + 1; onN = burn ? onN + 1 : 0
      ctl.burner = burn
      ctl.steer = Math.max(-1, Math.min(1, -omega / (full * (burn ? 0.1 : 1))))
      // strafe: lateral error to the line (P.right)
      const [lx, lz] = at(j), [nx, nz] = at(j + 1)
      const tl = Math.hypot(nx - lx, nz - lz) || 1, tx = (nx - lx) / tl, tz = (nz - lz) / tl
      const e = (P.pos.x - lx) * tz - (P.pos.z - lz) * tx, ev = P.vel.x * tz - P.vel.z * tx
      const rr = P.right.x * tz - P.right.z * tx
      ctl.strafe = cfg.ks ? Math.max(-1, Math.min(1, -(cfg.ks * e + cfg.kd * ev) * Math.sign(rr || 1))) : 0
      ctl.brake = !!(cfg.airBrake && P.airborne)
      g.force({ ...ctl })
      g.fastSim(STEP); st++
      const t = +(st / 60).toFixed(3), mach = +(P.speed / MACH).toFixed(2)
      if (P.speed - lastSp > 200) { pads++; events.push({ t, what: 'pad' }) }
      lastSp = P.speed
      top = Math.max(top, mach)
      const i = me.idx, [ttx, ttz] = c.tangent(i), lat = Math.round((P.pos.x - c.px[i]) * -ttz + (P.pos.z - c.pz[i]) * ttx)
      if (me.passed >= 1 && !me.finished) maxLat = Math.max(maxLat, Math.abs(lat))
      const mc = g.snap().missedCount
      if (me.passed !== passed) { for (let k = passed + 1; k <= me.passed; k++) gates.push({ gate: k, t, mach, missed: mc > missed }); passed = me.passed }
      if (mc > missed) { events.push({ t, what: 'missed gate' }); missed = mc }
      if (P.spin > 0 && !wasSpin) events.push({ t, what: 'spin-out' }); wasSpin = P.spin > 0
      if (P.crashing && !wasCrash) events.push({ t, what: 'crash' }); wasCrash = P.crashing
      if (P.airborne !== wasAir && P.airborne) { nAir++; events.push({ t, what: 'air' }) } wasAir = P.airborne
      if (st % 30 === 0) trace.push([t, mach, lat, j + line.i0, (P.burning ? 'B' : '') + (P.airborne ? 'A' : ''), +ctl.steer.toFixed(2)])
      if (me.finished || P.crashing) break
      if (st % 6 === 0) await new Promise((r) => setTimeout(r, 0))
    }
    const inp = g.inputs()
    return { counted: me.finished, time: me.finished ? +me.finishTime.toFixed(3) : null, passed: me.passed, missedGates: missed - m0, topMach: top, maxLat, pads, nAir, steps: st, gates, events, trace, inp }
  }, [line, cfg])
  const steps = []; for (let i = 0; i < rep.inp.length; i += 3) steps.push([rep.inp[i], rep.inp[i + 1], rep.inp[i + 2]])
  delete rep.inp
  if (save) {
    fs.writeFileSync(here + 'g2-' + cfg.name + '.json', JSON.stringify({ course: 'canyon', cfg, steps }))
    fs.writeFileSync(here + 'r2-' + cfg.name + '.json', JSON.stringify(rep))
  }
  rep.stepsArr = steps
  return rep
}
const D = { pred: 0.1, ffa: 0.1, kp: 1, ff: 1, lmin: 300, tl: 0.25, blook: 0.3, bkap: 1, bk: 0.9, bk2: 1.2, bcap: 99, startB: 0, minOff: 0, minOn: 0, airB: 1, ks: 0, kd: 0, airBrake: false, holdOff: false, relM: 5, pressM: 5.7 }
const score = (r) => r.counted ? r.time + (r.missedGates ? 50 : 0) + (r.maxLat > (cfgs.latLim ?? 1e9) ? 30 : 0) : 100 + (15 - r.passed) * 10
const say = (name, rep) => console.log(JSON.stringify({ name, counted: rep.counted, time: rep.time, passed: rep.passed, missed: rep.missedGates, maxLat: rep.maxLat, pads: rep.pads, top: rep.topMach, nAir: rep.nAir, ev: rep.events.filter((e) => e.what !== 'pad').slice(0, 8).map((e) => e.t + ':' + e.what).join(' ') }))
if (Array.isArray(cfgs)) for (const cfg of cfgs) say(cfg.name, await roll({ ...D, ...cfg }))
else {
  let s = cfgs.seed ?? 1; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())
  let best = { ...D, ...cfgs.base, name: cfgs.name }, bestR = await roll(best, false), bs = score(bestR)
  console.log('start', bs, bestR.time, bestR.missedGates, bestR.maxLat)
  const keys = Object.keys(cfgs.ranges)
  for (let it = 0; it < cfgs.iters; it++) {
    const cc = { ...best }
    const nk = 1 + Math.floor(rnd() * 3)
    for (let q = 0; q < nk; q++) { const k = keys[Math.floor(rnd() * keys.length)], [lo, hi] = cfgs.ranges[k]; cc[k] = +Math.min(hi, Math.max(lo, cc[k] + gauss() * (cfgs.sigma ?? 0.15) * (hi - lo))).toFixed(4) }
    const r = await roll(cc, false), sc = score(r)
    if (sc < bs) { best = cc; bestR = r; bs = sc; console.log('it', it, 'NEW', sc, r.time, r.missedGates, r.maxLat, JSON.stringify(Object.fromEntries(keys.map((k) => [k, cc[k]])))) }
  }
  fs.writeFileSync(here + 'g2-' + cfgs.name + '.json', JSON.stringify({ course: 'canyon', cfg: best, steps: bestR.stepsArr }))
  delete bestR.stepsArr
  fs.writeFileSync(here + 'r2-' + cfgs.name + '.json', JSON.stringify(bestR))
  say(cfgs.name, bestR)
}
await browser.close()
