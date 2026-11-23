// Deterministic A/B captures: the player is put at the same points of the course, at the same Mach,
// on the same heading, in every build — rivals sent far off, tips off, away from jumps — so two
// builds' frames differ only by what the builds draw.
//   URL=http://localhost:4417/ COURSE=greenway OUT=dir TAG=A node tools/fairshot.mjs
// Writes <OUT>/<course>-<slow|fast>-<k>-<TAG>.png (k = position index), 2560x1440.
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const URL = process.env.URL ?? 'http://localhost:5417/', C = process.env.COURSE ?? 'sprint'
const OUT = process.env.OUT ?? '/tmp/fair', TAG = process.env.TAG ?? 'A'
const POS = (process.env.POS ?? '0.18,0.41,0.63,0.86').split(',').map(Number)
fs.mkdirSync(OUT, { recursive: true })
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })).newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto(`${URL}?course=${C}&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => {
  // (Tips and the controls card hidden by style: clicking the tips toggle opened the controls card.)
  const st = document.createElement('style'); st.textContent = '#tip, #hints { display: none !important }'; document.head.append(st)
  window.__g.start(); window.__g.skipCountdown()
})
await p.waitForTimeout(1500)
for (const [speed, mach] of [['slow', 0.8], ['fast', 6.5]]) {
  for (let k = 0; k < POS.length; k++) {
    await p.evaluate(({ f, mach }) => {
      const g = window.__g, co = g.course
      // Off the jumps: nudge forward until clear of every jump by 3% of the lap.
      const jumps = co.def.jumps ?? []
      let ff = f
      for (let n = 0; n < 20 && jumps.some((j) => Math.abs(j - ff) < 0.03); n++) ff += 0.01
      const i = co.startI + Math.round(ff * (co.finishI - co.startI))
      const [tx, tz] = co.tangent(i)
      g.player.reset(co.px[i], co.pz[i], Math.atan2(tx, tz), mach)
      g.race.racers[0].idx = i
      // Rivals far away (they still race, out of every frame).
      for (const r of g.race.racers) if (r.ai) r.p.pos.x += 1e6
      // (Slow: coasting on the line, no throttle — the autopilot would climb out of 'slow'.)
      g.autopilot(mach > 2)
    }, { f: POS[k], mach })
    // The chase camera's springs settle; the autopilot holds the line (same code in every build).
    await p.waitForTimeout(speed === 'slow' ? 2500 : 1500)
    // Exact: put it back on the same point (the camera is settled for this heading and speed), let one
    // frame run, freeze, draw. (A free-running capture drifted 0.1-0.3 km between builds at Mach 6.5.)
    await p.evaluate(({ f, mach }) => new Promise((res) => {
      const g = window.__g, co = g.course
      const jumps = co.def.jumps ?? []
      let ff = f
      for (let n = 0; n < 20 && jumps.some((j) => Math.abs(j - ff) < 0.03); n++) ff += 0.01
      const i = co.startI + Math.round(ff * (co.finishI - co.startI))
      const [tx, tz] = co.tangent(i)
      g.player.reset(co.px[i], co.pz[i], Math.atan2(tx, tz), mach)
      g.race.racers[0].idx = i
      if (g.snapCam) g.snapCam()
      requestAnimationFrame(() => requestAnimationFrame(() => { if (g.hold) { g.hold(true); g.draw() } res() }))
    }), { f: POS[k], mach })
    await p.screenshot({ path: `${OUT}/${C}-${speed}-${k}-${TAG}.png` })
    const st = await p.evaluate(() => window.__g.stats())
    await p.evaluate(() => { if (window.__g.hold) window.__g.hold(false) })
    const togo = await p.evaluate(() => document.querySelector('#r-lap')?.textContent)
    console.log(`${C} ${speed} ${k} ${TAG} mach ${st.mach} togo ${togo} tris ${(st.tris / 1e6).toFixed(2)}M`)
  }
}
if (errs.length) console.log('page errors:', errs.slice(0, 3).join(' | '))
await b.close()
