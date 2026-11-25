// Rollout optimisation on the exact physics (receding horizon, with savestates): every DEC steps the
// simulation is saved; each candidate manoeuvre for the next DEC steps (the driver's own choice, burner
// forced on / off, the sideways target shifted, a steering bias, the air brake, no dodge taps) is flown and
// then followed by H steps of the driver (tools/pdcore.js) — scored by progress along the course plus the
// worth of the speed carried, a crash costing far more than any gain; the state is put back and the best
// manoeuvre committed. The driver's own choice is always a candidate, so the result is never worse than it
// (over the horizon), and each decision is judged by the real physics, not a model.
//   node tools/rollout.mjs 4491 sprint            (DEC=30 H=180 steps; SPEEDW=1.0 s of travel per m/s)
// MODE: 'gates' (default: every gate taken, anywhere), 'bounded' (every gate taken AND never off the track:
// the craft's centre within BOUND = 260 m of the centreline, the worn surface; every metre outside costs, and
// only runs that never leave it count), 'rogue' (no rules: gates may be skipped, cut, anything that finishes
// sooner — with wider sideways shifts to find the cuts). SEED: start from that rollout json's decisions.
// Output: tools/optruns/<course>-rollout[-<mode>].json
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const port = process.argv[2] ?? '4491', course = process.argv[3] ?? 'sprint'
const DEC = +(process.env.DEC ?? 30), H = +(process.env.H ?? 180), SPEEDW = +(process.env.SPEEDW ?? 1.0), PASSES = +(process.env.PASSES ?? 3)
// TOL: how far the craft's centre may stray past the edge and still count (its wings still over the track).
const MODE = process.env.MODE ?? 'gates', BOUND = +(process.env.BOUND ?? 260), TOL = +(process.env.TOL ?? 10), OUTW = +(process.env.OUTW ?? 20)
const V1 = [{}, { burner: true }, { burner: false }, { latShift: 45 }, { latShift: -45 }, { steerBias: 0.15 }, { steerBias: -0.15 }, { brake: true }, { noDodge: true }]
let seed = null
// LINE: a racing line for the driver to follow (tools/mincurv.mjs) instead of the centreline.
const LINEF = process.env.LINE ?? '', line = LINEF && fs.existsSync(LINEF) ? JSON.parse(fs.readFileSync(LINEF, 'utf8')) : null
if (process.env.SEED && fs.existsSync(process.env.SEED)) { const r = JSON.parse(fs.readFileSync(process.env.SEED, 'utf8')); if (r.decisions?.length) seed = { cands: r.cands ?? V1, decisions: r.decisions } }
const craft = JSON.parse(fs.readFileSync('tools/optruns/craft-model.json', 'utf8'))
const opts = { look: 1.2, margin: 34, reach: 3, burnK: 1.2, burnErr: 0.1, latV: 150, airAlign: true, sweep: true, strafeK: 20, slow: true, brakeAt: 0.35, tapNear: 35, tapFar: 70 }
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await p.goto(`http://localhost:${port}/?course=${course}&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { localStorage.setItem('dbu-sub', 'trial'); document.querySelector('#submodes button[data-sub=trial]').click() })
await p.addScriptTag({ content: fs.readFileSync('tools/pdcore.js', 'utf8') })
const res = await p.evaluate(async ([craft, opts, DEC, H, SPEEDW, PASSES, MODE, BOUND, seed, TOL, OUTW, line]) => {
  const g = window.__g, STEP = 1 / 60
  const pd = window.makePD(line ? { lane: line.lane, i0: line.i0, SEG: line.SEG } : null, craft, MODE === 'bounded' ? { ...opts, bound: BOUND } : opts)
  const me = pd.me, P = pd.P, c = g.course
  // Metres outside the track this step (bounded mode's cost).
  const outside = () => { const i = me.idx, [tx, tz] = c.tangent(i); return Math.max(0, Math.abs((P.pos.x - c.px[i]) * -tz + (P.pos.z - c.pz[i]) * tx) - BOUND) }
  // The plain driver from the start, for reference (and to check it matches tools/perfectdrive.mjs).
  const s0 = g.snap(), d0 = pd.state()
  let n = 0; while (!me.finished && n < 60 * 300) { pd.control({}); g.fastSim(STEP); n++; if (n % 900 === 0) await new Promise((r) => setTimeout(r, 0)) }
  const base = me.finished ? me.finishTime : null
  g.restore(s0); pd.setState(d0)
  const cands = [{}, { burner: true }, { burner: false }, { latShift: 45 }, { latShift: -45 }, { latShift: 90 }, { latShift: -90 }, { steerBias: 0.15 }, { steerBias: -0.15 }, { steerBias: 0.3 }, { steerBias: -0.3 }, { brake: true }, { noDodge: true }, { burner: true, latShift: 45 }, { burner: true, latShift: -45 }]
  if (MODE === 'rogue') cands.push({ latShift: 200 }, { latShift: -200 }, { latShift: 400 }, { latShift: -400 }, { burner: true, latShift: 200 }, { burner: true, latShift: -200 })
  const ckey = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]))
  const seedDec = seed ? seed.decisions.map((d) => Math.max(0, cands.findIndex((o) => ckey(o) === ckey(seed.cands[d])))) : null
  // (A missed gate counts as passed in the race — it only costs 40% of the speed — so progress alone made
  // skipping one look like free distance: a branch that misses a gate is ruled out like a crash.)
  const missedNow = () => g.snap().missedCount
  // (rogue: a miss is just its own speed cost, already in the physics; bounded: each metre-step outside costs.)
  const score = (crashed, missed, out) => {
    if (MODE === 'rogue') missed = false
    if (me.finished) return 1e12 - me.finishTime * 1000 - (missed ? 1e9 : 0) - out * OUTW * 10
    return g.race.progress(me) + P.speed * SPEEDW - (crashed ? 1e6 : 0) - (missed ? 1e6 : 0) - out * OUTW
  }
  // Policy iteration: pass 1 judges each manoeuvre by the plain driver after it; each later pass by the previous
  // pass's own decisions after it (and always offers the previous decision) — so each pass improves the last.
  let prev = seedDec, bestRun = { time: base ?? Infinity, decisions: null, pass: 0 }
  const picks = new Array(cands.length).fill(0)
  const passLog = []
  for (let pass = 1; pass <= PASSES; pass++) {
    g.restore(s0); pd.setState(d0)
    const decisions = []
    let slot = 0, runOut = 0
    while (!me.finished && slot < 60 * 300 / DEC) {
      const st = g.snap(), ds = pd.state()
      let best = prev && prev[slot] !== undefined ? prev[slot] : 0, bestS = -Infinity
      const order = prev && prev[slot] !== undefined ? [prev[slot], ...cands.keys()] : [...cands.keys()]
      for (const k of order) {
        g.restore(st); pd.setState(ds)
        let crashed = false, out = 0
        const m0 = missedNow()
        for (let j = 0; j < DEC && !me.finished; j++) { pd.control(cands[k]); g.fastSim(STEP); if (P.crashing) crashed = true; if (MODE === 'bounded') out += outside() }
        for (let h = 0, sl = slot + 1; h < H && !me.finished; sl++) {
          const kk = prev && prev[sl] !== undefined ? prev[sl] : 0
          for (let j = 0; j < DEC && h < H && !me.finished; j++, h++) { pd.control(cands[kk]); g.fastSim(STEP); if (P.crashing) crashed = true; if (MODE === 'bounded') out += outside() }
        }
        const sc = score(crashed, missedNow() > m0, out)
        if (sc > bestS + 1e-6) { bestS = sc; best = k }
      }
      g.restore(st); pd.setState(ds)
      for (let j = 0; j < DEC && !me.finished; j++) { pd.control(cands[best]); g.fastSim(STEP); runOut = Math.max(runOut, outside()) }
      decisions.push(best); picks[best]++; slot++
      await new Promise((r) => setTimeout(r, 0))
    }
    // (A pass counts only if it kept the rules: no gate missed unless rogue; never off the track if bounded.)
    const ok = me.finished && (MODE === 'rogue' || missedNow() === 0) && (MODE !== 'bounded' || runOut <= TOL)
    const t = ok ? me.finishTime : Infinity
    passLog.push({ t: me.finished ? +me.finishTime.toFixed(3) : null, ok, missed: missedNow(), maxOut: Math.round(runOut) })
    if (t < bestRun.time) bestRun = { time: t, decisions, pass }
    prev = decisions
  }
  // The best run, replayed from the start with nothing restored in between.
  g.restore(s0); pd.setState(d0)
  const decisions = bestRun.decisions ?? []
  if (decisions.length) { let rs = 0; for (const d of decisions) { for (let j = 0; j < DEC && !me.finished; j++) { pd.control(cands[d]); g.fastSim(STEP); rs++ } if (rs % 900 < DEC) await new Promise((r) => setTimeout(r, 0)) } }
  else { let n2 = 0; while (!me.finished && n2 < 60 * 300) { pd.control({}); g.fastSim(STEP); n2++ } }
  const replay = me.finished ? me.finishTime : null
  return { mode: MODE, bound: BOUND, tol: TOL, cands, decisions, passes: passLog, bestPass: bestRun.pass, missedGates: missedNow(), replay, base, time: bestRun.time === Infinity ? null : bestRun.time, crashes: pd.state().crashes, picks: Object.fromEntries(cands.map((c, k) => [JSON.stringify(c), picks[k]])) }
}, [craft, opts, DEC, H, SPEEDW, PASSES, MODE, BOUND, seed, TOL, OUTW, line])
fs.writeFileSync(`tools/optruns/${course}-rollout${MODE === 'gates' ? '' : '-' + MODE}${process.env.TAG ? '-' + process.env.TAG : ''}.json`, JSON.stringify({ course, DEC, H, SPEEDW, PASSES, line: LINEF || null, ...res }))
const { decisions, ...show } = res
console.log(`${course} rollout ${MODE} (DEC ${DEC}, H ${H}): ${JSON.stringify(show)}`)
await b.close()
