// The solver: node tools/optruns/solver/solve.mjs <course> <rogue|ideal> [budget-seconds] [--force] [--only a,b] [--no-mpc]
//
// Plans a route, flies it with the tracker for a small set of parameter variants (plain runs), puts the
// savestate planner (MPC) on top of the best ones, then verifies candidates with the bench
// (tools/agentrun.mjs) in order until one is VALID for the mode. Writes tools/optruns/solver/runs/<course>-<mode>.json
// (only if it beats a valid run already there, unless --force) and prints a one-line JSON summary.
// One browser at a time; waits while the 1-minute load average is above 90 before every browser launch.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'
const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--only'))
const [course, mode] = pos
const BUDGET = +(pos[2] ?? 900)
const oi = args.indexOf('--only'), ONLY = oi >= 0 ? args[oi + 1].split(',') : null
if (!course || !['rogue', 'ideal'].includes(mode)) { console.error('usage: node tools/optruns/solver/solve.mjs <course> <rogue|ideal> [budget-seconds] [--force] [--no-mpc] [--only names]'); process.exit(2) }
const DIR = new URL('.', import.meta.url).pathname, ROOT = new URL('../../../', import.meta.url).pathname
process.chdir(ROOT)
const LOG = (...a) => console.error(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a)
const T0 = Date.now()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const IDEAL = mode === 'ideal', LAT_MAX = 265

async function waitLoad() {
  for (;;) {
    const l1 = +execSync('sysctl -n vm.loadavg').toString().replace(/[{}]/g, '').trim().split(/\s+/)[0]
    if (l1 <= 90) return l1
    LOG(`load ${l1} > 90, waiting 60 s`); await sleep(60000)
  }
}

// ── variants: families merged from the per-course controllers that set the known bests ──
const COMMON = { la: 0.18, kp: 2, tp: 0.12, mgSmall: 50, mgPlan: 100, Rc: 4000, pads: true, padW: 20, lam: 10000, mid: 30, du: 20, padT: 0.3, padAimMin: 120, duty: true, smax: 0.95 }
const FAM = {
  // CALDERA: duty-cycled burner, Rc 4000, centreline mids
  cal: {},
  // OVAL: hairpin speed limit from curvature + grip, small radius, curvature bend cost, dense mids in hairpins
  oval: { la: 0.17, kp: 1.84, tp: 0.18, Rc: 1400, lam: 6000, omg: 1.7, gf: 0.95, kW: 15, bEff: 0.25, nbTol: 300, vTol: 0, midH: 5, lamK: 3e6 },
  // SPRINT: big radius, mounds kept clear, rocks given room, threshold burner near the route
  spr: { la: 0.265, kp: 1.82, Rc: 6000, mgSmall: 80, mgPlan: 120, padW: 28, padT: 0.26, mounds: 1.0, duty: false, burnNeed: 0.267, burnErr: 60 },
  // MISTRIVER: very wide arcs, no mids, bend cost per radian
  mis: { la: 0.25, kp: 2.5, Rc: 9000, lam: 3000, lam1: 3000, padW: 28, padT: 0.5, mid: 0, duty: false, burnNeed: 0.3 },
}
function variants() {
  const gh = 'auto'
  const V = []
  const add = (name, fam, extra) => V.push({ name, prm: { ...COMMON, ...FAM[fam], ...extra } })
  if (!IDEAL) {
    const R = { strafe: 1, turnThr: 0.05, midW: 300 }
    add('cal', 'cal', { ...R, sideAware: 0 })
    add('cal-sa', 'cal', { ...R, sideAware: 0.6, la: 0.2 })
    add('oval', 'oval', { ...R, sideAware: 0.3, midW: 200 })
    add('oval-g90', 'oval', { ...R, sideAware: 0.6, gf: 0.9, midW: 200 })
    add('spr', 'spr', { ...R })
    add('mis', 'mis', { ...R, turnThr: 0.08 })
    add('cal-omg', 'cal', { ...R, omg: 1.7, gf: 0.95, kW: 15, bEff: 0.25, nbTol: 300 })
    add('cal-r25', 'cal', { ...R, Rc: 2500, la: 0.16 })
    add('spr-duty', 'spr', { ...R, duty: true, Rc: 4000 })
    add('safe', 'cal', { ...R, mgSmall: 90, mgPlan: 160, hard: 30, mounds: 1.0, smax: 0.8 })
  } else {
    const I = { corr: 220, W: 240, Wf: 240, Wc: 260, midW: 200, guard: 190, minHold: 6, ideal: true }
    add('cal', 'cal', { ...I, smax: 0.75, la: 0.17, kp: 1.8, tp: 0.13, Rc: 3500, lam: 6000 })
    add('oval', 'oval', { ...I, smax: 0.75, gf: 0.9, la: 0.17, kp: 1.8, tp: 0.2 })
    add('spr', 'spr', { ...I, la: 0.25, kp: 2, Rc: 6000, burnNeed: 0.2 })
    add('mis', 'cal', { ...I, Rc: 6000, la: 0.25, kp: 2, duty: false, burnNeed: 0.2, padT: 0.15 })
    add('cal-95', 'cal', { ...I, smax: 0.95, la: 0.18 })
    add('oval-95', 'oval', { ...I, smax: 0.9, gf: 0.95 })
    add('cal-omg', 'cal', { ...I, smax: 0.75, omg: 1.7, gf: 0.92, kW: 15, bEff: 0.25, nbTol: 300 })
    add('narrow', 'cal', { ...I, corr: 190, W: 200, Wf: 200, Wc: 220, midW: 170, guard: 160, smax: 0.75 })
    add('safe', 'cal', { ...I, corr: 170, W: 180, Wf: 180, Wc: 200, midW: 150, guard: 140, smax: 0.6, mgSmall: 90, mgPlan: 160, hard: 30, mounds: 1.0 })
  }
  return ONLY ? V.filter((v) => ONLY.includes(v.name)) : V
}
// a planner failure is retried with these relaxations, in order
const RELAX = [{}, { hard: 4, mgPlan: 50, mgSmall: 25 }, { hard: 0, mgPlan: 20, mgSmall: 10, pen: 10, Rc: 1500, mid: 20 }]

// ── browser ──
let browser = null
async function openB() { await waitLoad(); browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] }) }
async function closeB() { if (browser) { await browser.close(); browser = null; page = null } }
const CRAFT = JSON.parse(fs.readFileSync('tools/optruns/craft-model.json', 'utf8'))
const PDCORE = fs.readFileSync('tools/pdcore.js', 'utf8'), CORE = fs.readFileSync(DIR + 'core.js', 'utf8')
let page = null
async function openPage() {
  // one page per solve, warmed exactly as the bench warms it (every run restarts the race from the grid and
  // resets the gorge hint, so runs in the same page reproduce a fresh page's — checked, and the bench re-checks)
  const ctx = await browser.newContext({ viewport: { width: 320, height: 180 } })
  page = await ctx.newPage()
  await page.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
  await page.goto(`http://localhost:${process.env.PORT ?? '4480'}/?course=${course}&fixed=1`)
  await page.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
  await page.addScriptTag({ content: PDCORE })
  await page.evaluate((craft) => { window.makePD(null, craft, { look: 1.2, margin: 34, reach: 3, burnK: 1.2, burnErr: 0.1, latV: 150, airAlign: true, sweep: true, strafeK: 20, slow: true, brakeAt: 0.35, tapNear: 35, tapFar: 70 }) }, CRAFT)
  await page.addScriptTag({ content: CORE })
}
async function runOne(prm) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (!page) await openPage()
      let last = null
      for (const rx of RELAX) {
        const p = { ...prm, ...rx }
        const r = await page.evaluate(async (p) => { try { return await window.SOLV.run(p) } catch (e) { return { error: String(e && e.stack || e).slice(0, 400) } } }, p)
        if (!r.error) { r.prm = p; return r }
        last = r
        if (!/no clear path|gave up/.test(r.error)) break
      }
      return last
    } catch (e) {
      LOG('page error', String(e).slice(0, 200)); try { await page.context().close() } catch {} page = null
      if (attempt) return { error: String(e).slice(0, 300) }
    }
  }
}
// small deterministic jitter around a good variant (results are chaotic in the parameters)
let seed = [...(course + mode)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7)
const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const U = (a, b) => a + (b - a) * rnd()
function jitter(p) {
  const q = { ...p }
  q.la = +(p.la * U(0.85, 1.15)).toFixed(3); q.kp = +(p.kp * U(0.9, 1.1)).toFixed(3); q.tp = +(p.tp * U(0.8, 1.25)).toFixed(3)
  q.Rc = Math.round(p.Rc * U(0.7, 1.3)); q.padT = +(p.padT * U(0.8, 1.2)).toFixed(3)
  if (p.duty) q.smax = +Math.min(0.97, Math.max(0.55, p.smax + U(-0.08, 0.05))).toFixed(3)
  else q.burnNeed = +(p.burnNeed * U(0.8, 1.25)).toFixed(3)
  if (p.omg) q.gf = +Math.min(0.99, p.gf + U(-0.04, 0.02)).toFixed(3)
  if (!IDEAL) q.sideAware = [0, 0.3, 0.6][Math.floor(rnd() * 3)]
  else { q.guard = Math.round(Math.min(205, p.guard + U(-25, 10))) }
  return q
}

// in-page validity (the bench re-checks): ROGUE counted; IDEAL counted, 0 missed, every step <= 265 m, keys legal
function humanOk(steps) {
  if (steps.some((q) => q[1] !== 0 || q[2] & 24)) return false
  for (const bit of [1, 2, 4]) {
    let run = 0
    for (let i = 3; i <= steps.length; i++) {
      const prev = steps[i - 1][2] & bit, cur = i < steps.length ? steps[i][2] & bit : -1
      run++
      if (cur !== prev) { if (run < 6 && i < steps.length && i - run > 2) return false; run = 0 }
    }
  }
  return true
}
const validIn = (r) => r && !r.error && r.time != null && (!IDEAL || (r.missed === 0 && r.maxLat <= LAT_MAX - 3 && humanOk(r.steps)))
const scoreOf = (r) => !r || r.error || r.time == null ? 1e9 : r.time + (validIn(r) ? 0 : 1000 + (r.missed || 0) * 100 + Math.max(0, (r.maxLat || 0) - LAT_MAX))
const brief = (r) => r.error ? { error: r.error.slice(0, 160) } : { time: r.time, missed: r.missed, maxLat: r.maxLat, pads: r.pads, crashes: r.crashes, hurt: r.hurt, dropped: r.dropped?.length, ms: r.ms, valid: validIn(r) }

// ── main ──
const outF = `${DIR}runs/${course}-${mode}.json`
fs.mkdirSync(`${DIR}runs`, { recursive: true })
const results = []
const left = () => BUDGET - (Date.now() - T0) / 1000
await openB()
try {
  // phase 1: plain tracker over the variants
  for (const v of variants()) {
    if (left() < BUDGET * 0.35 && results.some(validIn)) break
    const r = await runOne(v.prm); r.name = v.name; results.push(r)
    LOG('plain', v.name, JSON.stringify(brief(r)))
  }
  // phase 1b: jitter around the best three (until 30 % of the budget is spent)
  for (let j = 0; j < 60 && left() > BUDGET * 0.7; j++) {
    const top = results.filter((r) => !r.error && r.time != null).sort((a, b) => scoreOf(a) - scoreOf(b)).slice(0, 3)
    if (!top.length) break
    const base = top[j % top.length], p = jitter(base.prm)
    const r = await runOne(p); r.name = base.name.split('~')[0] + '~' + j; results.push(r)
    LOG('jitter', r.name, JSON.stringify(brief(r)))
  }
  // phase 2: the savestate planner on top of the best variants
  if (!flags.has('--no-mpc')) {
    const ranked = results.filter((r) => !r.error && r.time != null).sort((a, b) => scoreOf(a) - scoreOf(b))
    // ideal: a candidate that went wide can still be pulled in by the planner's lateral penalty
    const seeds = ranked.slice(0, 3)
    if (!seeds.length) { const p = results.find((r) => !r.error); if (p) seeds.push(p) }
    const MPCS = IDEAL
      ? [{ D: 6, H: 60, aims: [-60, -20, 20, 60], burns: [-1, 1, 0] }, { D: 6, H: 90, aims: [-40, 0, 40], burns: [-1, 1, 0] }]
      : [{ D: 6, H: 60, aims: [-40, 0, 40], burns: [-1, 1, 0] }, { D: 6, H: 90, aims: [-80, -30, 0, 30, 80], burns: [-1, 1, 0] }]
    let mi = 0
    for (const s of seeds) for (const m of MPCS) {
      const est = (s.ms || 3000) / 1000 * (m.aims.length * m.burns.length * m.H / m.D) * 0.8 + 10
      if (mi > 0 && left() < est) { LOG('skip mpc (budget)', s.name, JSON.stringify(m)); continue }
      mi++
      const { mpc, ...base } = s.prm
      const r = await runOne({ ...base, mpc: m }); r.name = s.name + '+mpc' + (m.H === 90 ? 'H' : '')
      results.push(r); LOG('mpc', r.name, JSON.stringify(brief(r)))
      if (mi >= 4) break
    }
  }
} finally { await closeB() }

// phase 3: the bench decides, best in-page candidate first
const cands = results.filter((r) => !r.error && r.time != null).sort((a, b) => scoreOf(a) - scoreOf(b))
let chosen = null, bench = null
const tried = []
for (const r of cands.slice(0, 4)) {
  await waitLoad()
  const tmp = `${DIR}runs/.cand-${course}-${mode}.json`
  fs.writeFileSync(tmp, JSON.stringify({ course, steps: r.steps }))
  let d
  try { d = JSON.parse(execFileSync('node', ['tools/agentrun.mjs', 'run', course, tmp], { maxBuffer: 1 << 28 }).toString()) } catch (e) { LOG('bench error', String(e).slice(0, 200)); continue }
  const ok = d.counted && (!IDEAL || (d.missedGates === 0 && d.human.ok && r.maxLat <= LAT_MAX))
  tried.push({ name: r.name, inpage: r.time, bench: d.time, counted: d.counted, missed: d.missedGates, human: d.human.ok, ok })
  LOG('bench', r.name, 'in-page', r.time, 'bench', d.time, 'counted', d.counted, 'missed', d.missedGates, 'human', d.human.ok, ok ? 'VALID' : 'invalid')
  if (ok) { chosen = r; bench = d; break }
}
fs.rmSync(`${DIR}runs/.cand-${course}-${mode}.json`, { force: true })
const sec = Math.round((Date.now() - T0) / 1000)
const benchLatMax = bench ? Math.max(...bench.trace.map((t) => Math.abs(t[2]))) : null
const summary = chosen
  ? { course, mode, valid: true, time: bench.time, missed: bench.missedGates, maxLat: chosen.maxLat, benchTraceLat: benchLatMax, humanOk: bench.human.ok, counted: bench.counted, variant: chosen.name, sec }
  : { course, mode, valid: false, time: null, tried, sec }
let kept = false
if (chosen) {
  let prev = null; try { prev = JSON.parse(fs.readFileSync(outF, 'utf8')) } catch {}
  if (flags.has('--force') || !prev || !prev.valid || !(prev.time <= bench.time)) {
    fs.writeFileSync(outF, JSON.stringify({ course, mode, valid: true, time: bench.time, missed: bench.missedGates, maxLat: chosen.maxLat, humanOk: bench.human.ok, variant: chosen.name, prm: chosen.prm, inpage: chosen.time, solvedAt: new Date().toISOString(), sec, steps: chosen.steps }))
    kept = true
  } else { summary.keptPrevious = prev.time }
} else if (!fs.existsSync(outF)) fs.writeFileSync(outF, JSON.stringify({ course, mode, valid: false, tried, solvedAt: new Date().toISOString(), sec }))
summary.written = kept
console.log(JSON.stringify(summary))
process.exit(chosen ? 0 : 1)
