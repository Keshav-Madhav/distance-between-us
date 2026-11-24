// Rollout optimisation on the exact physics (receding horizon, with savestates): every DEC steps the
// simulation is saved; each candidate manoeuvre for the next DEC steps (the driver's own choice, burner
// forced on / off, the sideways target shifted, a steering bias, the air brake, no dodge taps) is flown and
// then followed by H steps of the driver (tools/pdcore.js) — scored by progress along the course plus the
// worth of the speed carried, a crash costing far more than any gain; the state is put back and the best
// manoeuvre committed. The driver's own choice is always a candidate, so the result is never worse than it
// (over the horizon), and each decision is judged by the real physics, not a model.
//   node tools/rollout.mjs 4491 sprint            (DEC=30 H=180 steps; SPEEDW=1.0 s of travel per m/s)
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const port = process.argv[2] ?? '4491', course = process.argv[3] ?? 'sprint'
const DEC = +(process.env.DEC ?? 30), H = +(process.env.H ?? 180), SPEEDW = +(process.env.SPEEDW ?? 1.0)
const craft = JSON.parse(fs.readFileSync('tools/optruns/craft-model.json', 'utf8'))
const opts = { look: 1.2, margin: 34, reach: 3, burnK: 1.2, burnErr: 0.1, latV: 150, airAlign: true, sweep: true, strafeK: 20, slow: true, brakeAt: 0.35, tapNear: 35, tapFar: 70 }
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await p.goto(`http://localhost:${port}/?course=${course}&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { localStorage.setItem('dbu-sub', 'trial'); document.querySelector('#submodes button[data-sub=trial]').click() })
await p.addScriptTag({ content: fs.readFileSync('tools/pdcore.js', 'utf8') })
const res = await p.evaluate(async ([craft, opts, DEC, H, SPEEDW]) => {
  const g = window.__g, STEP = 1 / 60
  const pd = window.makePD(null, craft, opts)
  const me = pd.me, P = pd.P
  // The plain driver from the start, for reference (and to check it matches tools/perfectdrive.mjs).
  const s0 = g.snap(), d0 = pd.state()
  let n = 0; while (!me.finished && n < 60 * 300) { pd.control({}); g.fastSim(STEP); n++; if (n % 900 === 0) await new Promise((r) => setTimeout(r, 0)) }
  const base = me.finished ? me.finishTime : null
  g.restore(s0); pd.setState(d0)
  const cands = [{}, { burner: true }, { burner: false }, { latShift: 45 }, { latShift: -45 }, { steerBias: 0.15 }, { steerBias: -0.15 }, { brake: true }, { noDodge: true }]
  // (A missed gate counts as passed in the race — it only costs 40% of the speed — so progress alone made
  // skipping one look like free distance: a branch that misses a gate is ruled out like a crash.)
  const missedNow = () => g.snap().missedCount
  const score = (crashed, missed) => { if (me.finished) return 1e12 - me.finishTime * 1000 - (missed ? 1e9 : 0); return g.race.progress(me) + P.speed * SPEEDW - (crashed ? 1e6 : 0) - (missed ? 1e6 : 0) }
  const picks = new Array(cands.length).fill(0), decisions = []
  let steps = 0
  while (!me.finished && steps < 60 * 300) {
    const st = g.snap(), ds = pd.state()
    let best = 0, bestS = -Infinity
    for (let k = 0; k < cands.length; k++) {
      g.restore(st); pd.setState(ds)
      let crashed = false
      const m0 = missedNow()
      for (let j = 0; j < DEC && !me.finished; j++) { pd.control(cands[k]); g.fastSim(STEP); if (P.crashing) crashed = true }
      for (let j = 0; j < H && !me.finished; j++) { pd.control({}); g.fastSim(STEP); if (P.crashing) crashed = true }
      const s = score(crashed, missedNow() > m0)
      if (s > bestS + 1e-6 || (k === 0 && s >= bestS)) { bestS = s; best = k }
    }
    g.restore(st); pd.setState(ds)
    for (let j = 0; j < DEC && !me.finished; j++) { pd.control(cands[best]); g.fastSim(STEP); steps++ }
    picks[best]++; decisions.push(best)
    await new Promise((r) => setTimeout(r, 0))
  }
  const st = pd.state()
  const time = me.finished ? me.finishTime : null, missed = g.snap().missedCount
  // (Kept only if it beats the driver alone over the whole run: the per-decision guarantee holds over the look-ahead.)
  if (time === null || (base !== null && time >= base)) return { decisions: [], missedGates: missed, replay: base, base, time: base, kept: 'driver alone', crashes: st.crashes, picks: {} }
  // Replay: the same decisions from the start, nothing restored in between — must land on the same time.
  g.restore(s0); pd.setState(d0)
  let rs = 0
  for (const d of decisions) { for (let j = 0; j < DEC && !me.finished; j++) { pd.control(cands[d]); g.fastSim(STEP); rs++ } if (rs % 900 < DEC) await new Promise((r) => setTimeout(r, 0)) }
  const replay = me.finished ? me.finishTime : null
  return { decisions, missedGates: missed, replay, base, time, crashes: st.crashes, burnShare: +(st.burnSteps / Math.max(1, st.steps)).toFixed(3), picks: Object.fromEntries(cands.map((c, k) => [JSON.stringify(c), picks[k]])) }
}, [craft, opts, DEC, H, SPEEDW])
fs.writeFileSync(`tools/optruns/${course}-rollout.json`, JSON.stringify({ course, DEC, H, SPEEDW, ...res }))
const { decisions, ...show } = res
console.log(`${course} rollout (DEC ${DEC}, H ${H}): ${JSON.stringify(show)}`)
await b.close()
