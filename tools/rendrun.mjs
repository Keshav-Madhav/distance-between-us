// A real rendered run of an optimised drive (ROGUE / IDEAL / the earlier line), as a video: the decisions
// are replayed once with the driver (tools/pdcore.js) to get the run's exact inputs, then a fresh game plays
// those inputs back in the normal race view while this script drives its frame clock — exactly 30 frames a
// second of game time, whatever the machine is doing — and each frame is captured. ffmpeg makes the mp4.
//   node tools/rendrun.mjs 5417 canyon rogue out.mp4      (mode: rogue | bounded | gates; W=1280 H=720)
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const [port, course, MODE, outFile] = [process.argv[2] ?? '5417', process.argv[3] ?? 'canyon', process.argv[4] ?? 'rogue', process.argv[5] ?? 'run.mp4']
const W = +(process.env.W ?? 1280), H = +(process.env.H ?? 720), TAG = process.env.TAG ? '-' + process.env.TAG : ''
// INPUTS=<inputs.json> (tools/agentrun.mjs format): play that run instead of an optimiser's decisions.
const INPUTS = process.env.INPUTS
const run = INPUTS ? {} : JSON.parse(fs.readFileSync(`tools/optruns/${course}-rollout${MODE === 'gates' ? '' : '-' + MODE}${TAG}.json`, 'utf8'))
const V1 = [{}, { burner: true }, { burner: false }, { latShift: 45 }, { latShift: -45 }, { steerBias: 0.15 }, { steerBias: -0.15 }, { brake: true }, { noDodge: true }]
const cands = run.cands ?? V1
const craft = JSON.parse(fs.readFileSync('tools/optruns/craft-model.json', 'utf8'))
const opts0 = { look: 1.2, margin: 34, reach: 3, burnK: 1.2, burnErr: 0.1, latV: 150, airAlign: true, sweep: true, strafeK: 20, slow: true, brakeAt: 0.35, tapNear: 35, tapFar: 70 }
const opts = run.mode === 'bounded' ? { ...opts0, bound: run.bound } : opts0
const line = run.line ? JSON.parse(fs.readFileSync(run.line, 'utf8')) : null
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
// 1) The inputs.
let A
if (INPUTS) A = { time: JSON.parse(fs.readFileSync(INPUTS, 'utf8')).time ?? null, inputs: JSON.parse(fs.readFileSync(INPUTS, 'utf8')).steps.flat() }
else {
const pa = await (await b.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await pa.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
await pa.goto(`http://localhost:${port}/?course=${course}&fixed=1`)
await pa.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
await pa.addScriptTag({ content: fs.readFileSync('tools/pdcore.js', 'utf8') })
A = await pa.evaluate(async ([craft, opts, cands, decisions, DEC, L]) => {
  const g = window.__g, STEP = 1 / 60
  const pd = window.makePD(L ? { lane: L.lane, i0: L.i0, SEG: L.SEG } : null, craft, opts), me = pd.me
  for (const d of decisions) { for (let j = 0; j < DEC && !me.finished; j++) { pd.control(cands[d]); g.fastSim(STEP) } await new Promise((r) => setTimeout(r, 0)) }
  return { time: me.finished ? me.finishTime : null, inputs: g.inputs() }
}, [craft, opts, cands, run.decisions, run.DEC ?? 30, line])
await pa.context().close()
}
console.log(`${course} ${MODE}: optimiser ${run.time?.toFixed(2)} s, replayed ${A.time?.toFixed(2)} s, ${A.inputs.length / 3} steps of inputs`)
// 2) The rendered run: rAF driven by hand (virtual time), one capture per 1/30 s.
const dir = fs.mkdtempSync('/private/tmp/claude-502/-Users-keshavmadhav-verbaflo-Repositories-portfolio-website/e18b0817-8173-4e62-8348-b75848d93f42/scratchpad/frames-')
const pb = await (await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage()
await pb.addInitScript(() => {
  localStorage.setItem('dbu-sub', 'trial'); localStorage.setItem('dbu-line', '0'); localStorage.setItem('dbu-tips', JSON.stringify({ off: true }))
  let cbs = [], vt = 0, manual = false
  const raf = window.requestAnimationFrame.bind(window)
  const pnow = performance.now.bind(performance)
  window.requestAnimationFrame = (cb) => { if (!manual) return raf(cb); cbs.push(cb); return cbs.length }
  window.__manual = () => { manual = true; vt = pnow() }
  performance.now = () => (manual ? vt : pnow())
  window.__tick = (ms) => { vt += ms; const run = cbs; cbs = []; for (const cb of run) cb(vt) }
})
await pb.goto(`http://localhost:${port}/?course=${course}&q=high`)
await pb.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
await pb.waitForTimeout(3000)
await pb.evaluate((inp) => { const g = window.__g; g.replayWith(inp); g.skipCountdown(); window.__manual() }, A.inputs)
let f = 0, after = 0
for (;;) {
  await pb.evaluate(() => window.__tick(1000 / 30))
  await pb.screenshot({ path: `${dir}/f${String(f++).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 88 })
  const st = await pb.evaluate(() => { const me = window.__g.race.racers[0]; return { fin: me.finished, t: me.finishTime } })
  if (st.fin && ++after > 75) { console.log(`  rendered finish ${st.t.toFixed(2)} s, ${f} frames`); break }
  if (f > 30 * 200) break
}
await b.close()
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', `${dir}/f%05d.jpg`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', outFile])
console.log(`  → ${outFile}`)
