// GPU cost per frame (render + gl.finish) at Retina density, with features toggled one at a time.
import { chromium } from 'playwright-core'
const q = process.argv[2] ?? 'ultra'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
const page = await (await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 })).newPage()
await page.goto(`http://localhost:4417/?fixed&q=${q}`); await page.waitForFunction('window.__g && window.__g.ready')
await page.evaluate(() => {
  const g = window.__g
  window.__t = []
  let l = performance.now()
  const f = (n) => { window.__t.push(n - l); l = n; requestAnimationFrame(f) }
  requestAnimationFrame(f)
  document.getElementById('g-fps').value = 'max'; document.getElementById('g-fps').dispatchEvent(new Event('change'))
  g.start(); g.skipCountdown(); g.autopilot(true)
})
await page.waitForTimeout(5000)
async function sample(label) {
  await page.evaluate(() => { window.__t.length = 0 })
  await page.waitForTimeout(2500)
  const r = await page.evaluate(() => { const t = window.__t.slice().sort((a, b) => a - b); return `frame p50 ${t[t.length >> 1].toFixed(1)} ms (${(1000 / t[t.length >> 1]).toFixed(0)} fps) p90 ${t[Math.floor(t.length * 0.9)].toFixed(1)} ms` })
  console.log(label.padEnd(26), r)
}
await sample(`${q} @2x, everything`)
await page.evaluate(() => { document.getElementById('g-map').checked = false; document.getElementById('g-map').dispatchEvent(new Event('change')) })
await sample('+ minimap off')
await page.evaluate(() => { document.getElementById('g-cloud').checked = false; document.getElementById('g-cloud').dispatchEvent(new Event('change')) })
await sample('+ cloud shadows off')
await page.evaluate(() => { document.getElementById('g-bloom').checked = false; document.getElementById('g-bloom').dispatchEvent(new Event('change')) })
await sample('+ bloom off')
await page.evaluate(() => { window.__g.post.setSamples(0) })
await sample('+ MSAA off')
await browser.close()
