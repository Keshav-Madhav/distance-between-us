// 1% / 0.1% lows: uncapped frame times over a race (no vsync), with spikes listed against what the
// game was doing. node tools/lows.mjs [quality] [seconds]
import { chromium } from 'playwright-core'
const q = process.argv[2] ?? 'high', secs = +(process.argv[3] ?? 25), off = (process.argv[4] ?? '').split(',').filter(Boolean)
// VSYNC=1: the real case — a locked refresh; reports the frames that missed it (a visible stutter).
const vsync = !!process.env.VSYNC
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist', ...(vsync ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit'])] })
const page = await (await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 })).newPage()
await page.goto(`http://localhost:4417/?fixed&q=${q}`); await page.waitForFunction('window.__g && window.__g.ready')
await page.evaluate((off) => {
  const g = window.__g
  // Ablation: g-map g-bloom g-cloud g-grain (checkboxes off), g-part (particles to the lowest).
  for (const id of off) { const el = document.getElementById(id); if (el.type === 'checkbox') el.checked = false; else el.value = el.options ? el.options[0].value : '0'; el.dispatchEvent(new Event('change')); el.dispatchEvent(new Event('input')) }
  document.getElementById('g-fps').value = 'max'; document.getElementById('g-fps').dispatchEvent(new Event('change'))
  window.__f = []
  let l = performance.now()
  const f = (n) => { const p = g.player; window.__f.push([n - l, p.crashing ? 'crash' : p.airborne ? 'air' : '', g.stats().particles]); l = n; requestAnimationFrame(f) }
  requestAnimationFrame(f)
  g.start(); g.skipCountdown(); g.autopilot(true)
}, off)
await page.waitForTimeout(2000)
await page.evaluate(() => { window.__f.length = 0 })
// A crash mid-run (the moment that must not hitch).
await page.waitForTimeout(secs * 500)
await page.evaluate(() => { const p = window.__g.player; p.scrapeAt.copy(p.pos); p.startCrash(2, -p.fwd.x, -p.fwd.z) })
await page.waitForTimeout(secs * 500)
const r = await page.evaluate(() => {
  const f = window.__f, t = f.map((x) => x[0]).sort((a, b) => a - b)
  const pct = (p) => t[Math.min(t.length - 1, Math.floor(t.length * p))].toFixed(1)
  const med = t[t.length >> 1]
  const spikes = f.map((x, i) => [i, ...x]).filter((x) => x[1] > med * 2.5).slice(0, 12).map((x) => `#${x[0]} ${x[1].toFixed(1)}ms ${x[2]} p${x[3]}`)
  const missed = f.filter((x) => x[0] > 16.7 * 1.5).length
  return `missed vsync ${missed}/${t.length} (${(missed / t.length * 100).toFixed(2)}%)  frames ${t.length}  p50 ${med.toFixed(1)}  p99 (1% low) ${pct(0.99)}  p99.9 ${pct(0.999)}  max ${t[t.length - 1].toFixed(1)} ms  | spikes >2.5×: ${f.filter((x) => x[0] > med * 2.5).length}\n  ${spikes.join('\n  ')}`
})
console.log(q, off.join(',') || 'all', r.split('\n')[0])
await browser.close()
