// Stutter probe: what each hitch IS. An autopiloted race at a laptop's 1920×1080 (DPR 1), uncapped, with every
// frame's gap, the game's JS inside it, and what changed during it: shader programs linked (a mid-race compile is a
// 50–500 ms stall on Windows/ANGLE-D3D), geometries and textures created (GPU uploads), the JS heap dropping (a GC).
// Prints the spikes (over 2.5× the median and 20 ms) with that context, then the game's own section profile.
//   node tools/stutter.mjs 4495 [course,course] [seconds]      (Q=low  CPU=4 slows the main thread 4×  W=1920 H=1080)
import { chromium } from 'playwright-core'
const port = process.argv[2] ?? '4495', courses = (process.argv[3] ?? 'sprint').split(','), secs = +(process.argv[4] ?? 25)
const Q = process.env.Q ?? 'low', CPU = +(process.env.CPU ?? 1), W = +(process.env.W ?? 1920), H = +(process.env.H ?? 1080)
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-precise-memory-info'] })
for (const course of courses) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log('  pageerror', e.message))
  await p.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window)
    window.__js = 0
    window.requestAnimationFrame = (cb) => raf((t) => { const a = performance.now(); cb(t); window.__js += performance.now() - a })
  })
  await p.goto(`http://localhost:${port}/?course=${course}&q=${Q}&prof=1`)
  await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
  await p.evaluate(() => { const f = document.querySelector('#g-fps'); if (f) { f.value = 'max'; f.dispatchEvent(new Event('change')) } })
  await p.waitForTimeout(1500)
  if (CPU > 1) { const s = await ctx.newCDPSession(p); await s.send('Emulation.setCPUThrottlingRate', { rate: CPU }) }
  await p.evaluate(() => {
    const g = window.__g, r = g.renderer
    window.__log = []
    let l = performance.now(), heap = performance.memory?.usedJSHeapSize ?? 0
    let prog = r.info.programs?.length ?? 0, geo = r.info.memory.geometries, tex = r.info.memory.textures
    const f = (n) => {
      const h = performance.memory?.usedJSHeapSize ?? 0, pr = r.info.programs?.length ?? 0, ge = r.info.memory.geometries, te = r.info.memory.textures
      window.__log.push([n - l, window.__js, h < heap - 1.5e6 ? +((heap - h) / 1e6).toFixed(0) : 0, pr - prog, ge - geo, te - tex, +g.player.mach.toFixed(1), Math.round(performance.now())])
      heap = h; prog = pr; geo = ge; tex = te; window.__js = 0; l = n
      requestAnimationFrame(f)
    }
    requestAnimationFrame(f)
    g.profReset(); g.start(); g.skipCountdown(); g.autopilot(true)
  })
  await p.waitForTimeout(secs * 1000)
  const out = await p.evaluate(() => ({ L: window.__log.slice(1), prof: window.__g.prof(), progs: window.__g.renderer.info.programs?.length, info: window.__g.stats() }))
  await ctx.close()
  const L = out.L, gaps = L.map((x) => x[0]).sort((a, b) => a - b), js = L.map((x) => x[1]).sort((a, b) => a - b)
  const q = (a, f) => a[Math.min(a.length - 1, Math.floor(a.length * f))]
  const med = q(gaps, 0.5), lim = Math.max(20, med * 2.5)
  const spikes = L.map((x, i) => [i, ...x]).filter((x) => x[1] > lim)
  const sum = (k) => L.reduce((a, x) => a + (x[k] > 0 ? x[k] : 0), 0)
  console.log(`\n== ${course}  Q=${Q} CPU×${CPU} ${W}x${H}  ${L.length} frames  fps avg ${(1000 * L.length / L.reduce((a, x) => a + x[0], 0)).toFixed(0)}  gap p50 ${med.toFixed(1)} p99 ${q(gaps, 0.99).toFixed(1)} p99.9 ${q(gaps, 0.999).toFixed(1)} max ${gaps[gaps.length - 1].toFixed(0)} ms  js p50 ${q(js, 0.5).toFixed(1)} p99 ${q(js, 0.99).toFixed(1)}`)
  console.log(`   during the race: programs linked ${sum(3)} (total ${out.progs})  geometries +${sum(4)}  textures +${sum(5)}  GCs ${L.filter((x) => x[2]).length}  spikes>${lim.toFixed(0)}ms ${spikes.length}`)
  for (const s of spikes.slice(0, 25)) console.log(`   #${s[0]} t${((s[8] - L[0][7]) / 1000).toFixed(1)}s  ${s[1].toFixed(0)}ms  js ${s[2].toFixed(1)}${s[3] ? `  GC ${s[3]}MB` : ''}${s[4] ? `  +${s[4]} programs` : ''}${s[5] ? `  +${s[5]} geo` : ''}${s[6] ? `  +${s[6]} tex` : ''}  M${s[7]}`)
  console.log(out.prof.split('\n').map((l) => '   ' + l).join('\n'))
}
await b.close()
