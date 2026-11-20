// CPU cost per frame: time inside every requestAnimationFrame callback, during an autopilot race.
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window)
  window.__cpu = []
  window.requestAnimationFrame = (cb) => raf((t) => { const a = performance.now(); cb(t); window.__cpu.push(performance.now() - a) })
})
await page.goto('http://localhost:4417/' + (process.argv[2] ?? '?fixed')); await page.waitForFunction('window.__g && window.__g.ready')
await page.evaluate(() => { window.__g.start(); window.__g.autopilot(true) })
await page.waitForTimeout(6000)
await page.evaluate(() => { window.__cpu.length = 0; window.__gaps = []; let l = performance.now(); const f = (n) => { window.__gaps.push(n - l); l = n; requestAnimationFrame(f) }; requestAnimationFrame(f) })
await page.waitForTimeout(8000)
const r = await page.evaluate(() => {
  const c = window.__cpu.filter((x) => x > 0.3).sort((a, b) => a - b), g = window.__gaps.sort((a, b) => a - b)
  const q = (a, p) => a[Math.floor(a.length * p)].toFixed(2)
  return `cpu/frame p50 ${q(c, 0.5)} p95 ${q(c, 0.95)} max ${c[c.length - 1].toFixed(1)} ms | frame gap p50 ${q(g, 0.5)} p99 ${q(g, 0.99)} max ${g[g.length - 1].toFixed(1)} | >20ms: ${g.filter((x) => x > 20).length}/${g.length}`
})
console.log(r)
await browser.close()
