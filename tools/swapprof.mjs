// World swap profile: the visible world's frame gaps against the booting world's boot marks (headed).
import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio', '--window-size=1440,900'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.goto('http://localhost:4417/?course=circuit'); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 }); await p.waitForTimeout(2500)
const gaps = await p.evaluate(() => new Promise((done) => {
  const out = []; let last = performance.now(); const t0 = last
  const f = (t) => { if (t - last > 40) out.push([performance.timeOrigin + last, t - last]); last = t; if (t - t0 < 7000) requestAnimationFrame(f); else done(out) }
  requestAnimationFrame(f)
  setTimeout(() => { window.__clickAt = performance.timeOrigin + performance.now(); document.querySelector('#worlds .w[data-w=lava]').click() }, 300)
}))
const click = await p.evaluate(() => window.__clickAt)
const fr = p.frames().find((f) => f !== p.mainFrame())
const marks = fr ? await fr.evaluate(() => [performance.timeOrigin, window.__boot]) : null
console.log('gaps (ms after click, length):', gaps.map(([t, g]) => `${(t - click).toFixed(0)}+${g.toFixed(0)}`).join('  '))
if (marks) { const [to, bm] = marks; console.log('iframe origin', (to - click).toFixed(0), 'marks:', bm.map(([n, t]) => `${n}@${(to + t - click).toFixed(0)}`).join(' ')) }
await b.close()
