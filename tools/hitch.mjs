// Hitch hunt: a long autopilot race at Retina density, vsync on, AUTO quality (the governor live),
// every frame logged — gap, JS time inside the frame, heap (a drop = a GC), resizes, what the
// player was doing — and every frame over 25 ms printed with its context.
//   node tools/hitch.mjs [course] [seconds]
import { chromium } from 'playwright-core'
const course = process.argv[2] ?? 'sprint', secs = +(process.argv[3] ?? 60)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] })
const page = await (await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 })).newPage()
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window)
  window.__cpuLast = 0
  window.requestAnimationFrame = (cb) => raf((t) => { const a = performance.now(); cb(t); window.__cpuLast += performance.now() - a })
})
await page.goto(`http://localhost:4417/?course=${course}`); await page.waitForFunction('window.__g && window.__g.ready')
await page.evaluate(() => {
  const g = window.__g, pl = g.player
  window.__log = []; window.__ev = []
  const rs = g.renderer?.setSize?.bind(g.renderer)
  if (rs) g.renderer.setSize = (...a) => { window.__ev.push('resize'); return rs(...a) }
  for (const k of ['onCrashStart', 'onMach', 'onBoostStart', 'onLand', 'onSpin', 'onLaunch']) { const f = pl[k]; pl[k] = (...a) => { window.__ev.push(k); return f?.(...a) } }
  let l = performance.now(), heap = performance.memory?.usedJSHeapSize ?? 0
  const f = (n) => {
    const h = performance.memory?.usedJSHeapSize ?? 0
    window.__log.push([n - l, window.__cpuLast, h < heap - 1e6 ? 'GC' : '', window.__ev.join('+'), g.stats().particles, pl.mach.toFixed(1)])
    heap = h; window.__cpuLast = 0; window.__ev = []; l = n
    requestAnimationFrame(f)
  }
  requestAnimationFrame(f)
  g.start(); g.skipCountdown(); g.autopilot(true)
})
await page.waitForTimeout(3000)
await page.evaluate(() => { window.__log.length = 0 })
await page.waitForTimeout(secs * 1000)
console.log(await page.evaluate(() => {
  const L = window.__log, t = L.map((x) => x[0]).sort((a, b) => a - b)
  const q = (p) => t[Math.floor(t.length * p)].toFixed(1)
  const big = L.map((x, i) => [i, ...x]).filter((x) => x[1] > 25)
  return `frames ${L.length} p50 ${q(0.5)} p99 ${q(0.99)} max ${t[t.length - 1].toFixed(1)} ms | >25ms: ${big.length} | GCs: ${L.filter((x) => x[2]).length}\n` +
    big.slice(0, 40).map((x) => `#${x[0]} ${x[1].toFixed(0)}ms cpu ${x[2].toFixed(1)} ${x[3]} ${x[4]} p${x[5]} M${x[6]}`).join('\n')
}))
await browser.close()
