// GPU cost per frame (render + gl.finish) at Retina density, with features toggled one at a time.
import { chromium } from 'playwright-core'
const q = process.argv[2] ?? 'ultra'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
const page = await (await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 })).newPage()
await page.goto(`http://localhost:4417/?fixed&q=${q}${process.env.COURSE ? '&course=' + process.env.COURSE : ''}`); await page.waitForFunction('window.__g && window.__g.ready')
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
// Per-layer cost: hide one at a time (cumulative).
const hide = (pred) => page.evaluate((src) => { const f = eval(src); window.__g.world.group.traverse((o) => { if (f(o)) o.visible = false }) }, pred)
await hide("(o) => o.isInstancedMesh && o.material.uniforms && o.material.uniforms.uTile && o.material.uniforms.uTile.value > 4000")
await sample('- canopy')
await page.evaluate(() => { window.__g.world.shadowOff = true; })
await hide("(o) => o.isInstancedMesh && o.material && o.material.isMeshStandardMaterial")
await sample('- landforms')
await browser.close()
