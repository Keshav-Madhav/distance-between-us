// Closed-loop generator: an in-page pilot follows a racing line (mkline.mjs) with a speed profile, playing
// through the game's own forced-controls path; the recorded per-step inputs are saved for tools/agentrun.mjs.
//   node gen.mjs configs.json   (configs: [{name, line, ...params}] — run one after another on one page)
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
    // speed profile: KR·R (smoothed min over a window), capped, then a braking pass backward
    const W = cfg.win ?? 6
    const vt = new Float64Array(m)
    for (let j = 0; j < m; j++) { let r = 1e9; for (let k = Math.max(0, j - W); k <= Math.min(m - 1, j + W); k++) r = Math.min(r, k > m - 12 || k < 8 ? 1e9 : line.R[k]); vt[j] = Math.min(cfg.vcap * MACH, cfg.kr * r) }
    for (const s of cfg.zones ?? []) for (let j = s[0] - line.i0; j < s[1] - line.i0; j++) if (j >= 0 && j < m) vt[j] = Math.min(vt[j], s[2] * MACH)
    for (let j = m - 2; j >= 0; j--) vt[j] = Math.min(vt[j], vt[j + 1] + cfg.db * 40)
    const ctl = { steer: 0, strafe: 0, boost: true, burner: true, brake: false, dodgeL: false, dodgeR: false }
    g.hold(true); g.replayWith([0, 0, 3]); g.skipCountdown(); g.hold(true)
    const me = g.race.racers[0]
    let j = 0, best = 1e18
    for (let k = 0; k < m; k++) { const dd = (X[k] - P.pos.x) ** 2 + (Z[k] - P.pos.z) ** 2; if (dd < best) { best = dd; j = k } }
    const gates = [], events = [], trace = []
    let passed = me.passed, wasAir = false, wasSpin = false, wasCrash = false, top = 0, st = 0, lastB = false, nAir = 0, sinceB = 9
    const m0 = g.snap().missedCount; let missed = m0
    const at = (f) => { const a = Math.max(0, Math.min(m - 1.001, f)), k = Math.floor(a), t = a - k; return [X[k] + (X[k + 1] - X[k]) * t, Z[k] + (Z[k + 1] - Z[k]) * t] }
    while (st < 60 * 90) {
      if (st > 0) {
        // nearest line index
        let bj = j; best = 1e18
        for (let k = Math.max(0, j - 3); k < Math.min(m, j + 60); k++) { const dd = (X[k] - P.pos.x) ** 2 + (Z[k] - P.pos.z) ** 2; if (dd < best) { best = dd; bj = k } }
        j = bj
        const v = Math.max(P.speed, 50)
        const Ld = Math.max(cfg.lmin, v * cfg.tl)
        const [ax, az] = at(j + Ld / 40)
        const hv = Math.atan2(P.vel.x, P.vel.z)
        const qx = P.pos.x + P.vel.x * (cfg.pred ?? 0), qz = P.pos.z + P.vel.z * (cfg.pred ?? 0)
        let al = Math.atan2(ax - qx, az - qz) - hv; al = Math.atan2(Math.sin(al), Math.cos(al))
        // feed-forward: the line's own turn rate here (signed curvature from the heading change ahead)
        const [bx, bz] = at(j + 1 + v * 0.1 / 40), [cx, cz] = at(j + 3 + v * 0.1 / 40)
        const [dx0, dz0] = at(j - 1 + v * 0.1 / 40)
        let dh = Math.atan2(cx - bx, cz - bz) - Math.atan2(bx - dx0, bz - dz0); dh = Math.atan2(Math.sin(dh), Math.cos(dh))
        const kap = dh / Math.max(1, Math.hypot(cx - dx0, cz - dz0) / 1)
        const omega = 2 * v * Math.sin(al) / Ld * cfg.kp + cfg.ff * kap * v
        const full = Math.max(0.05, P.turnMax / (P.burning ? 0.1 : 1))
        ctl.steer = Math.max(-1, Math.min(1, -omega / full))
        const tv = vt[Math.min(m - 1, j + Math.round(v * (cfg.react ?? 0.2) / 40))]
        ctl.brake = false; ctl.boost = true; ctl.burner = false
        const sp = P.speed
        if (sp > tv * (1 + cfg.hyst)) { ctl.boost = false; ctl.brake = true }
        else if (sp < tv && Math.abs(ctl.steer) < cfg.tapSteer) { const n = Math.abs(ctl.steer) > (cfg.tap3 ?? 9) ? 3 : 2; sinceB++; if (sinceB >= n) { ctl.burner = true; sinceB = 0 } }
        if (cfg.bt && Math.abs(ctl.steer) > cfg.bt && !ctl.burner && ctl.boost) ctl.brake = true
        if (cfg.airBrake && P.airborne) { ctl.brake = true; ctl.boost = true; if (sp < tv) ctl.burner = !lastB }
        lastB = ctl.burner
        g.force({ ...ctl })
      }
      g.fastSim(STEP); st++
      const t = +(st / 60).toFixed(3), mach = +(P.speed / MACH).toFixed(2)
      top = Math.max(top, mach)
      const mc = g.snap().missedCount
      if (me.passed !== passed) { for (let k = passed + 1; k <= me.passed; k++) gates.push({ gate: k, t, mach, missed: mc > missed }); passed = me.passed }
      if (mc > missed) { events.push({ t, step: st, what: 'missed gate' }); missed = mc }
      if (P.spin > 0 && !wasSpin) events.push({ t, step: st, what: 'spin-out' }); wasSpin = P.spin > 0
      if (P.crashing && !wasCrash) events.push({ t, step: st, what: 'crash' }); wasCrash = P.crashing
      if (P.airborne !== wasAir && P.airborne) { nAir++; if (nAir < 12) events.push({ t, step: st, what: 'air' }) } wasAir = P.airborne
      if (st % 30 === 0) trace.push([t, mach, Math.round(Math.sqrt(best)), j + line.i0, (P.burning ? 'B' : '') + (P.airborne ? 'A' : '') + (ctl.brake ? 'K' : ''), +ctl.steer.toFixed(2)])
      if (me.finished || P.crashing) break
      if (st % 4 === 0) await new Promise((r) => setTimeout(r, 0))
    }
    const inp = g.inputs()
    return { counted: me.finished, time: me.finished ? +me.finishTime.toFixed(3) : null, passed: me.passed, missedGates: missed - m0, topMach: top, steps: st, nAir, gates, events, trace, inp }
  }, [line, cfg])
  const steps = []; for (let i = 0; i < rep.inp.length; i += 3) steps.push([rep.inp[i], rep.inp[i + 1], rep.inp[i + 2]])
  delete rep.inp
  if (save) {
    fs.writeFileSync(here + 'gen-' + cfg.name + '.json', JSON.stringify({ course: 'canyon', cfg, steps }))
    fs.writeFileSync(here + 'rep-' + cfg.name + '.json', JSON.stringify(rep))
  }
  rep.stepsArr = steps
  return rep
}
const score = (r) => r.counted ? r.time : 100 + (15 - r.passed) * 10
const say = (name, rep) => console.log(JSON.stringify({ name, counted: rep.counted, time: rep.time, passed: rep.passed, missed: rep.missedGates, top: rep.topMach, nAir: rep.nAir, ev: rep.events.slice(0, 8).map((e) => e.t + ':' + e.what).join(' ') }))
if (Array.isArray(cfgs)) for (const cfg of cfgs) say(cfg.name, await roll(cfg))
else {
  // hill-climb: { base, ranges: {k: [lo, hi]}, iters, name, seed }
  let s = cfgs.seed ?? 1; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())
  let best = { ...cfgs.base, name: cfgs.name }, bestR = await roll(best, false), bs = score(bestR)
  console.log('start', bs)
  const keys = Object.keys(cfgs.ranges)
  for (let it = 0; it < cfgs.iters; it++) {
    const c = { ...best }
    const nk = 1 + Math.floor(rnd() * 3)
    for (let q = 0; q < nk; q++) { const k = keys[Math.floor(rnd() * keys.length)], [lo, hi] = cfgs.ranges[k]; c[k] = +Math.min(hi, Math.max(lo, c[k] + gauss() * (cfgs.sigma ?? 0.15) * (hi - lo))).toFixed(4) }
    const r = await roll(c, false), sc = score(r)
    if (sc < bs) { best = c; bestR = r; bs = sc; console.log('it', it, 'NEW', sc, JSON.stringify(Object.fromEntries(keys.map((k) => [k, c[k]])))) }
  }
  fs.writeFileSync(here + 'gen-' + cfgs.name + '.json', JSON.stringify({ course: 'canyon', cfg: best, steps: bestR.stepsArr }))
  delete bestR.stepsArr
  fs.writeFileSync(here + 'rep-' + cfgs.name + '.json', JSON.stringify(bestR))
  say(cfgs.name, bestR)
}
await browser.close()
