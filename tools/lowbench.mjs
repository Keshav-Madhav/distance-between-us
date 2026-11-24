// Frame-time consistency in a live race: every frame of an uncapped, autopiloted race (from the green
// light), as average fps, 1% and 0.1% lows (fps at the 99th / 99.9th percentile frame time) and the
// worst frame; plus the game's own JS per frame at the same percentiles — a spike with no JS spike
// is the GPU, the compositor or the machine. Builds interleaved, repeated.
//   node tools/lowbench.mjs 4498,4495 [reps]     (C=sprint,greenway  D=30000 ms  Q=high  SPIKES=1 to list the worst)
import { chromium } from 'playwright-core'
import { calm } from './loadguard.mjs'
const ports = (process.argv[2] ?? '4495').split(','), reps = +(process.argv[3] ?? 2)
const COURSES = (process.env.C ?? 'sprint,frostline,caldera,greenway,mistriver').split(','), DUR = +(process.env.D ?? 30000), Q = process.env.Q ?? 'high'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--ignore-gpu-blocklist'] })
const pct = (a, q) => a[Math.min(a.length - 1, Math.floor(a.length * q))]
const res = {}
for (let r = 0; r < reps; r++) for (const c of COURSES) for (const port of (r % 2 ? [...ports].reverse() : ports)) {
  await calm()
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  await p.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window)
    window.__f = []
    window.requestAnimationFrame = (cb) => raf((t) => { const a = performance.now(); cb(t); window.__f.push([t, performance.now() - a]) })
  })
  await p.goto(`http://localhost:${port}/?course=${c}&q=${Q}&fixed=1`)
  await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
  await p.evaluate(() => { const f = document.querySelector('#g-fps'); if (f) { f.value = 'max'; f.dispatchEvent(new Event('change')) } })
  await p.waitForTimeout(1500)
  const out = await p.evaluate(async (DUR) => {
    const g = window.__g
    g.start(); g.skipCountdown(); g.autopilot(true)
    window.__f.length = 0
    await new Promise((r) => setTimeout(r, DUR))
    const f = window.__f.slice(), gaps = [], js = [], ctxs = []
    // (One game frame per rAF tick; a tick's gap is the time since the previous one.)
    for (let i = 1; i < f.length; i++) { gaps.push(f[i][0] - f[i - 1][0]); js.push(f[i][1]) }
    return { gaps, js, t: f.map((x) => x[0] - f[0][0]) }
  }, DUR)
  await ctx.close()
  const gs = [...out.gaps].sort((a, b) => a - b), js = [...out.js].sort((a, b) => b - a).reverse()
  const mean = out.gaps.reduce((a, b) => a + b, 0) / out.gaps.length
  const e = { avg: 1000 / mean, low1: 1000 / pct(gs, 0.99), low01: 1000 / pct(gs, 0.999), max: gs[gs.length - 1], js50: pct(js, 0.5), js99: pct(js, 0.99), js999: pct(js, 0.999), jsmax: js[js.length - 1] }
  if (process.env.SPIKES) {
    const worst = out.gaps.map((g, i) => [g, out.js[i], out.t[i + 1]]).sort((a, b) => b[0] - a[0]).slice(0, 12)
    console.log(`${c} ${port} worst:`, worst.map(([g, j, t]) => `${g.toFixed(1)}ms(js ${j.toFixed(1)})@${(t / 1000).toFixed(2)}s`).join(' '))
  }
  ;((res[c] ??= {})[port] ??= []).push(e)
}
const f = (v, d = 0) => v.toFixed(d)
for (const c of COURSES) for (const port of ports) {
  const a = res[c][port], m = (k) => a.reduce((x, y) => x + y[k], 0) / a.length, w = (k) => Math.min(...a.map((x) => x[k])), W = (k) => Math.max(...a.map((x) => x[k]))
  console.log(`${c.padEnd(10)} ${port}: avg ${f(m('avg'))} fps · 1% low ${f(m('low1'))} (worst run ${f(w('low1'))}) · 0.1% low ${f(m('low01'))} (worst ${f(w('low01'))}) · max ${f(W('max'), 1)} ms · js p50 ${f(m('js50'), 2)} p99 ${f(m('js99'), 2)} p99.9 ${f(m('js999'), 2)} max ${f(W('jsmax'), 1)}`)
}
await b.close()
