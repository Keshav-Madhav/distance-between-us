// World swap smoothness: the frame gaps of the world you are looking at while the next one boots
// behind it (headed, real vsync). Prints the worst gaps and how many frames went over 50 / 100 ms.
import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio', '--window-size=1440,900'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.goto(`http://localhost:${process.env.PORT ?? 4417}/?course=circuit`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 }); await p.waitForTimeout(2500)
const res = await p.evaluate(() => new Promise((done) => {
  const gaps = []; let last = performance.now(); let t0 = last
  const f = (t) => { gaps.push(t - last); last = t; if (t - t0 < 6000) requestAnimationFrame(f); else done(gaps) }
  requestAnimationFrame(f)
  setTimeout(() => document.querySelector('#worlds .w[data-w=lava]').click(), 300)
}))
const s = [...res].sort((a, b) => b - a)
console.log('frames', res.length, 'worst', s.slice(0, 6).map((x) => x.toFixed(0)).join(' '), '| >50ms', res.filter((x) => x > 50).length, '>100ms', res.filter((x) => x > 100).length)
await b.close()
