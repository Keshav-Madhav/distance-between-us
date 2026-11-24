// Frame-cost benchmark: builds served on ports, every world, interleaved and repeated. Per run: 6 s of an
// autopiloted race to settle, then 360 uncapped frames — mean and p95 frame time, and the JS time inside
// a frame (rAF callback). Retina-sized, AUTO quality off (fixed 'high') so builds are compared like for like.
//   node tools/perfbench.mjs 4494,4498 [reps]
import { chromium } from 'playwright-core'
import { calm } from './loadguard.mjs'
const ports = (process.argv[2] ?? '4498').split(','), reps = +(process.argv[3] ?? 2)
const COURSES = (process.env.C ?? 'sprint,frostline,caldera,greenway,mistriver').split(',')
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--ignore-gpu-blocklist'] })
const res = {}
for (let rep = 0; rep < reps; rep++) for (const c of COURSES) for (const port of ports) {
  await calm()
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  await p.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window)
    window.__js = []
    window.requestAnimationFrame = (cb) => raf((t) => { const a = performance.now(); cb(t); window.__js.push(performance.now() - a) })
  })
  await p.goto(`http://localhost:${port}/?course=${c}&q=high&fixed=1`)
  await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
  await p.evaluate(() => { const f = document.querySelector('#g-fps'); if (f) { f.value = 'max'; f.dispatchEvent(new Event('change')) } window.__g.start(); window.__g.skipCountdown(); window.__g.autopilot(true) })
  await p.waitForTimeout(6000)
  // The game's own frame clock: its fps counter (frames drawn per 0.5 s) and the gap of each drawn frame.
  const r = await p.evaluate(() => new Promise((res) => {
    const g = window.__g, fps = [], ms = []
    window.__js.length = 0
    const t0 = performance.now()
    const iv = setInterval(() => { const s = g.stats(); fps.push(s.fps); ms.push(s.ms) }, 100)
    setTimeout(() => { clearInterval(iv); res({ fps, ms, js: window.__js.reduce((a, b) => a + b, 0), wall: performance.now() - t0 }) }, 5000)
  }))
  const fpsMean = r.fps.reduce((a, b) => a + b, 0) / r.fps.length
  const s = r.ms.sort((a, b) => a - b), mean = 1000 / fpsMean
  const js = r.js / Math.max(1, fpsMean * r.wall / 1000)
  ;((res[c] ??= {})[port] ??= []).push({ mean, p95: s[Math.floor(s.length * 0.95)], js })
  await ctx.close()
}
for (const c of COURSES) {
  const row = ports.map((port) => {
    const a = res[c][port], m = (k) => a.reduce((x, y) => x + y[k], 0) / a.length
    return `${port}: ${m('mean').toFixed(1)} ms (p95 ${m('p95').toFixed(1)}, js ${m('js').toFixed(1)})`
  })
  console.log(c.padEnd(10), row.join('  |  '))
}
await b.close()
