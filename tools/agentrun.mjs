// A player's-eye test bench for tuning a run by hand (or by an agent): inputs in, the race's verdict out —
// through the game's own input replay, so every rule a player meets applies (crashes, spins, missed gates,
// the finish only counting through the finish gate, the burner-tap kick, …).
//
//   node tools/agentrun.mjs export <course> <rollout.json> <inputs.json>
//        replay an optimiser run (tools/optruns/*-rollout*.json) and save its per-step inputs
//   node tools/agentrun.mjs run <course> <inputs.json> [edits.json] [--save out.json]
//        LINE=public/lines/<course>.json also writes the game's racing-line file from the run (the ribbon);
//        POSE=1 adds ROGUE's pose recording to it (DUEL at IMPOSSIBLE plays that back)
//        play inputs (+ edits) and report; --save writes the edited per-step inputs
//
// inputs.json: { "steps": [[steer, strafe, flags], …] } one per 1/60 s from the start, flags = 1 throttle,
//   2 burner, 4 brake, 8 dodge left, 16 dodge right. After the last step the craft holds throttle only.
// edits.json: [{ "from": step, "to": step (exclusive), set any of: "steer", "strafe" (−1…1), "throttle",
//   "burner", "brake", "dodgeL", "dodgeR" (true/false), "steerAdd" (added, clamped), "tap": n (burner on
//   every n-th step, off between — each press kicks) }, …] applied in order. Steps are 1/60 s.
// Report (JSON): counted (finished through the finish gate), time, gates [{gate, t, mach, missed}],
//   events [{t, step, what}] (crash, spin, missed gate, missed finish, airborne), trace (every 0.5 s:
//   t, mach, lateral m from centre, burner/air), topMach. Port 4480 = the optimiser's build.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const [cmd, course, a, b2, ...rest] = process.argv.slice(2)
const PORT = process.env.PORT ?? '4480'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await page.goto(`http://localhost:${PORT}/?course=${course}&fixed=1`)
await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
if (cmd === 'export') {
  const run = JSON.parse(fs.readFileSync(a, 'utf8'))
  const V1 = [{}, { burner: true }, { burner: false }, { latShift: 45 }, { latShift: -45 }, { steerBias: 0.15 }, { steerBias: -0.15 }, { brake: true }, { noDodge: true }]
  const craft = JSON.parse(fs.readFileSync('tools/optruns/craft-model.json', 'utf8'))
  const o0 = { look: 1.2, margin: 34, reach: 3, burnK: 1.2, burnErr: 0.1, latV: 150, airAlign: true, sweep: true, strafeK: 20, slow: true, brakeAt: 0.35, tapNear: 35, tapFar: 70 }
  const opts = run.mode === 'bounded' ? { ...o0, bound: run.bound } : o0
  const line = run.line ? JSON.parse(fs.readFileSync(run.line, 'utf8')) : null
  await page.addScriptTag({ content: fs.readFileSync('tools/pdcore.js', 'utf8') })
  const r = await page.evaluate(async ([craft, opts, cands, decisions, DEC, L]) => {
    const g = window.__g
    const pd = window.makePD(L ? { lane: L.lane, i0: L.i0, SEG: L.SEG } : null, craft, opts), me = pd.me
    for (const d of decisions) { for (let j = 0; j < DEC && !me.finished; j++) { pd.control(cands[d]); g.fastSim(1 / 60) } await new Promise((r) => setTimeout(r, 0)) }
    return { time: me.finished ? me.finishTime : null, inputs: g.inputs() }
  }, [craft, opts, run.cands ?? V1, run.decisions ?? [], run.DEC ?? 30, line])
  const steps = []; for (let i = 0; i < r.inputs.length; i += 3) steps.push([r.inputs[i], r.inputs[i + 1], r.inputs[i + 2]])
  fs.writeFileSync(b2, JSON.stringify({ course, from: a, time: r.time, steps }))
  console.log(JSON.stringify({ exported: b2, steps: steps.length, time: r.time }))
} else if (cmd === 'run') {
  const inp = JSON.parse(fs.readFileSync(a, 'utf8'))
  const edits = b2 && b2 !== '--save' && fs.existsSync(b2) ? JSON.parse(fs.readFileSync(b2, 'utf8')) : []
  const si = process.argv.indexOf('--save'), saveTo = si > 0 ? process.argv[si + 1] : null
  const steps = inp.steps.map((s) => s.slice())
  for (const e of edits) {
    for (let i = Math.max(0, e.from); i < e.to; i++) {
      while (steps.length <= i) steps.push([0, 0, 1])
      const s = steps[i]
      if (e.steer !== undefined) s[0] = e.steer
      if (e.steerAdd !== undefined) s[0] = Math.max(-1, Math.min(1, s[0] + e.steerAdd))
      if (e.strafe !== undefined) s[1] = e.strafe
      const bit = (k, v) => { if (v !== undefined) s[2] = v ? s[2] | k : s[2] & ~k }
      bit(1, e.throttle); bit(2, e.burner); bit(4, e.brake); bit(8, e.dodgeL); bit(16, e.dodgeR)
      if (e.tap) bit(2, (i - e.from) % e.tap === 0)
    }
  }
  if (saveTo) fs.writeFileSync(saveTo, JSON.stringify({ course, from: a, steps }))
  const flat = steps.flat()
  // (The same warm-up a played race gets: the course's obstacles looked up end to end first — a cold
  // lookup mid-run changed collisions, so a fresh page replayed differently.)
  await page.addScriptTag({ content: fs.readFileSync('tools/pdcore.js', 'utf8') })
  await page.evaluate((craft) => { window.makePD(null, craft, { look: 1.2, margin: 34, reach: 3, burnK: 1.2, burnErr: 0.1, latV: 150, airAlign: true, sweep: true, strafeK: 20, slow: true, brakeAt: 0.35, tapNear: 35, tapFar: 70 }) }, JSON.parse(fs.readFileSync('tools/optruns/craft-model.json', 'utf8')))
  const rep = await page.evaluate(async ([flat, YIELD]) => {
    const g = window.__g, P = g.player, c = g.course, STEP = 1 / 60
    g.hold(true); g.replayWith(flat); g.skipCountdown(); g.hold(true)
    const me = g.race.racers[0], n = flat.length / 3
    const gates = [], events = [], trace = []
    const S = [], pose = []
    let passed = me.passed, wasAir = false, wasSpin = false, wasCrash = false, top = 0, st = 0
    const m0 = g.snap().missedCount
    let missed = m0
    while (st < n + 60 * 8 && st < 60 * 300) {
      if (st >= n) g.force({ steer: 0, strafe: 0, boost: true, burner: false, brake: false, dodgeL: false, dodgeR: false })
      g.fastSim(STEP); st++
      const t = +(st / 60).toFixed(3), mach = +(P.speed / 343).toFixed(2)
      top = Math.max(top, mach)
      const mc = g.snap().missedCount
      if (me.passed !== passed) { for (let k = passed + 1; k <= me.passed; k++) gates.push({ gate: k, t, mach, missed: mc > missed }); passed = me.passed }
      if (mc > missed) { events.push({ t, step: st, what: 'missed gate' }); missed = mc }
      if (P.spin > 0 && !wasSpin) events.push({ t, step: st, what: 'spin-out' }); wasSpin = P.spin > 0
      if (P.crashing && !wasCrash) events.push({ t, step: st, what: 'crash' }); wasCrash = P.crashing
      if (P.airborne !== wasAir && P.airborne) events.push({ t, step: st, what: 'airborne' }); wasAir = P.airborne
      if (st % 30 === 0) { const i = me.idx, [tx, tz] = c.tangent(i); trace.push([t, mach, Math.round((P.pos.x - c.px[i]) * -tz + (P.pos.z - c.pz[i]) * tx), (P.burning ? 'B' : '') + (P.airborne ? 'A' : '')]) }
      if (st % 3 === 0) S.push(Math.round(P.pos.x), Math.round(P.pos.y - P.agl), Math.round(P.pos.z), P.brake > 0.5 ? 0 : P.burning ? 3 : P.throttle > 0.5 ? 2 : 1, P.airborne ? 1 : 0, me.idx)
      if (g.race.state === 'racing' && !me.finished) { const k = Math.round(g.race.clock / (2 / 60)); if (k * 6 === pose.length) pose.push(+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2), +P.heading.toFixed(4), +P.bank.toFixed(4), +P.pitch.toFixed(4)) }
      if (me.finished) break
      if (st % YIELD === 0) await new Promise((r) => setTimeout(r, 0))
    }
    return { line: { s: S, pose }, counted: me.finished, time: me.finished ? +me.finishTime.toFixed(3) : null, gatesTotal: g.race.K, passed: me.passed, missedGates: missed - m0, topMach: top, steps: st, gates, events: events.filter((e) => e.what !== 'airborne').concat(events.filter((e) => e.what === 'airborne').slice(0, 40)), trace }
  }, [flat, +(process.env.YIELD ?? 2)])
  const { line, ...out } = rep
  if (process.env.LINE && rep.counted) fs.writeFileSync(process.env.LINE, JSON.stringify({ time: rep.time, ...(process.env.POSE ? { pose: line.pose } : {}), s: line.s }))
  console.log(JSON.stringify(out))
}
await browser.close()
