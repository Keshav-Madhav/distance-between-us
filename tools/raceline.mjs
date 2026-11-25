// The ideal racing line of a course, from its best optimised run (tools/rollout.mjs): replayed, sampled every
// 3 steps — where, how fast, what the craft is doing (burner / throttle / lift / brake / air) — and checked
// against the track's bounds: the worn racing surface (±260 m, the packed lane the course is drawn with) and
// the corridor (gate half-width + 60 m). Writes tools/optruns/<course>-line.json and a top-down map
// (tools/optruns/<course>-line.png): the line coloured by action, every stretch outside the bounds marked.
//   node tools/raceline.mjs 4491 greenway        (MODE=bounded → public/lines/<course>.json, the IDEAL line;
//                                                 MODE=rogue → public/lines/<course>-rogue.json, the ROGUE line)
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const port = process.argv[2] ?? '4491', course = process.argv[3] ?? 'sprint'
const MODE = process.env.MODE ?? 'gates'
const rf = `tools/optruns/${course}-rollout${MODE === 'gates' ? '' : '-' + MODE}.json`
// (No optimised run yet: the perfect driver's own line.)
const run = fs.existsSync(rf) ? JSON.parse(fs.readFileSync(rf, 'utf8')) : { decisions: [], time: null }
const V1 = [{}, { burner: true }, { burner: false }, { latShift: 45 }, { latShift: -45 }, { steerBias: 0.15 }, { steerBias: -0.15 }, { brake: true }, { noDodge: true }]
const V2 = [{}, { burner: true }, { burner: false }, { latShift: 45 }, { latShift: -45 }, { latShift: 90 }, { latShift: -90 }, { steerBias: 0.15 }, { steerBias: -0.15 }, { steerBias: 0.3 }, { steerBias: -0.3 }, { brake: true }, { noDodge: true }, { burner: true, latShift: 45 }, { burner: true, latShift: -45 }]
const cands = run.cands ?? (run.PASSES ? V2 : V1)
const craft = JSON.parse(fs.readFileSync('tools/optruns/craft-model.json', 'utf8'))
const opts0 = { look: 1.2, margin: 34, reach: 3, burnK: 1.2, burnErr: 0.1, latV: 150, airAlign: true, sweep: true, strafeK: 20, slow: true, brakeAt: 0.35, tapNear: 35, tapFar: 70 }
const opts = run.mode === 'bounded' ? { ...opts0, bound: run.bound } : opts0
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await p.goto(`http://localhost:${port}/?course=${course}&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { localStorage.setItem('dbu-sub', 'trial'); document.querySelector('#submodes button[data-sub=trial]').click() })
await p.addScriptTag({ content: fs.readFileSync('tools/pdcore.js', 'utf8') })
const out = await p.evaluate(async ([craft, opts, cands, decisions, DEC, L]) => {
  const line = L ? { lane: L.lane, i0: L.i0, SEG: L.SEG } : null
  const g = window.__g, c = g.course, STEP = 1 / 60
  const pd = window.makePD(line, craft, opts), me = pd.me, P = pd.P
  const S = []
  let st = 0
  const rec = () => {
    const i = me.idx, [tx, tz] = c.tangent(i), lat = (P.pos.x - c.px[i]) * -tz + (P.pos.z - c.pz[i]) * tx
    // action: 3 burner, 2 throttle, 1 lift/coast, 0 brake; air flag separate
    const a = pd.ctl.brake ? 0 : pd.ctl.burner ? 3 : pd.ctl.boost ? 2 : 1
    S.push([+P.pos.x.toFixed(1), +(P.pos.y - P.agl).toFixed(1), +P.pos.z.toFixed(1), +(P.speed / 343).toFixed(2), a, P.airborne ? 1 : 0, i, +lat.toFixed(1)])
  }
  // (ROGUE's recording for DUEL: every 2 sim steps of race time, from the start — src/race.ts playback.)
  const pose = []
  const recPose = () => { if (g.race.state !== 'racing' || me.finished) return; const k = Math.round(g.race.clock / (2 / 60)); if (k * 6 !== pose.length) return; pose.push(+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2), +P.heading.toFixed(4), +P.bank.toFixed(4), +P.pitch.toFixed(4)) }
  const step = (ov) => { pd.control(ov); g.fastSim(STEP); recPose(); if (st++ % 3 === 0) rec() }
  if (decisions && decisions.length) { for (const d of decisions) { for (let j = 0; j < DEC && !me.finished; j++) step(cands[d]); await new Promise((r) => setTimeout(r, 0)) } }
  else while (!me.finished && st < 60 * 300) { step({}); if (st % 900 === 0) await new Promise((r) => setTimeout(r, 0)) }
  return { pose, time: me.finished ? me.finishTime : null, samples: S, gateHalf: c.gateHalf, n: c.n, px: Array.from(c.px), pz: Array.from(c.pz), startI: c.startI, finishI: c.finishI, gates: c.cps.map((q) => q.i) }
}, [craft, opts, cands, run.decisions, run.DEC ?? 30, run.line ? JSON.parse(fs.readFileSync(run.line, 'utf8')) : null])
const WORN = 260, CORR = out.gateHalf + 60
// Stretches outside each bound: contiguous samples, with where (km along), how long, how far out, which side.
function stretches(limit) {
  const list = []; let cur = null
  for (const s of out.samples) {
    const off = Math.abs(s[7]) - limit
    if (off > 0) { if (!cur) cur = { from: s[6], to: s[6], max: 0, side: Math.sign(s[7]) }; cur.to = s[6]; cur.max = Math.max(cur.max, off) }
    else if (cur) { list.push(cur); cur = null }
  }
  if (cur) list.push(cur)
  return list.map((x) => ({ km: +((x.from - out.startI) * 0.04).toFixed(1), length_km: +((x.to - x.from) * 0.04).toFixed(2), max_out_m: Math.round(x.max), side: x.side > 0 ? 'right' : 'left' }))
}
const worn = stretches(WORN), corr = stretches(CORR)
const share = (lim) => +(100 * out.samples.filter((s) => Math.abs(s[7]) > lim).length / out.samples.length).toFixed(1)
const tag = MODE === 'rogue' ? '-rogue' : ''
fs.writeFileSync(`tools/optruns/${course}${tag}-line.json`, JSON.stringify({ course, time: out.time, fields: ['x', 'groundY', 'z', 'mach', 'action(0 brake,1 lift,2 throttle,3 burner)', 'air', 'courseIndex', 'lateral'], samples: out.samples }))
// The game's copy: x, ground y, z, action, air, course index — whole numbers (the ribbon is drawn 12 m wide).
fs.mkdirSync('public/lines', { recursive: true })
fs.writeFileSync(`public/lines/${course}${tag}.json`, JSON.stringify({ time: out.time, ...(MODE === 'rogue' ? { pose: out.pose } : {}), s: out.samples.flatMap((q) => [Math.round(q[0]), Math.round(q[1]), Math.round(q[2]), q[4], q[5], q[6]]) }))
console.log(`${course}: line from the ${run.time?.toFixed?.(2) ?? 'driver'} s run → replayed ${out.time?.toFixed(2)} s, ${out.samples.length} samples`)
console.log(`  outside the worn surface (±${WORN} m): ${share(WORN)}% of the run, ${worn.length} stretches`, JSON.stringify(worn.slice(0, 12)))
console.log(`  outside the corridor (±${CORR} m): ${share(CORR)}% of the run, ${corr.length} stretches`, JSON.stringify(corr.slice(0, 12)))
// The map: course corridor + worn band, the line coloured by action, violations ringed.
let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
for (let i = out.startI; i <= out.finishI; i++) { x0 = Math.min(x0, out.px[i]); x1 = Math.max(x1, out.px[i]); z0 = Math.min(z0, out.pz[i]); z1 = Math.max(z1, out.pz[i]) }
const pad = CORR + 400; x0 -= pad; x1 += pad; z0 -= pad; z1 += pad
const W = 1600, Hh = Math.round(W * (z1 - z0) / (x1 - x0)), k = W / (x1 - x0)
const X = (x) => ((x - x0) * k).toFixed(1), Z = (z) => ((z - z0) * k).toFixed(1)
const centre = []; for (let i = out.startI; i <= out.finishI; i += 2) centre.push(`${X(out.px[i])},${Z(out.pz[i])}`)
const col = ['#ff3b30', '#ffcc00', '#34c759', '#3aa0ff']
let segs = ''
for (let j = 1; j < out.samples.length; j++) { const a = out.samples[j - 1], s = out.samples[j]; segs += `<line x1="${X(a[0])}" y1="${Z(a[2])}" x2="${X(s[0])}" y2="${Z(s[2])}" stroke="${s[5] ? '#c58bff' : col[s[4]]}" stroke-width="2.2"/>` }
let rings = ''
for (const s of out.samples) if (Math.abs(s[7]) > CORR) rings += `<circle cx="${X(s[0])}" cy="${Z(s[2])}" r="5" fill="none" stroke="#ff2d55" stroke-width="1.2"/>`
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" style="background:#15120f"><polyline points="${centre.join(' ')}" fill="none" stroke="#3a3128" stroke-width="${(2 * CORR * k).toFixed(1)}" stroke-linejoin="round"/><polyline points="${centre.join(' ')}" fill="none" stroke="#5a4a3a" stroke-width="${(2 * WORN * k).toFixed(1)}" stroke-linejoin="round"/><polyline points="${centre.join(' ')}" fill="none" stroke="#8a7a68" stroke-width="1" stroke-dasharray="4 4"/>${segs}${rings}<text x="16" y="28" fill="#eee" font-family="sans-serif" font-size="18">${course.toUpperCase()} ${MODE.toUpperCase()} · ${out.time?.toFixed(2)} s · blue burner · green throttle · yellow lift · red brake · violet airborne · rings: outside the corridor</text></svg>`
const pg = await (await b.newContext({ viewport: { width: W, height: Math.min(4000, Hh) } })).newPage()
await pg.setContent(`<html><body style="margin:0;background:#15120f">${svg}</body></html>`)
await pg.screenshot({ path: `tools/optruns/${course}${tag}-line.png`, fullPage: true })
await b.close()
