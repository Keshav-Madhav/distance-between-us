// Hitches in a live race: every frame gap over 20 s of an autopiloted race (from the green light),
// counted over 25 / 50 ms, and the worst. Builds interleaved, repeated.  node tools/hitchbench.mjs 4494,4498 [reps]
import { chromium } from 'playwright-core'
import { calm } from './loadguard.mjs'
const ports = (process.argv[2] ?? '4498').split(','), reps = +(process.argv[3] ?? 2)
const COURSES = (process.env.C ?? 'sprint,frostline,caldera,greenway,mistriver').split(','), DUR = +(process.env.D ?? 20000)
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const res = {}
for (let r = 0; r < reps; r++) for (const c of COURSES) for (const port of (r % 2 ? [...ports].reverse() : ports)) {
  await calm()
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  await p.goto(`http://localhost:${port}/?course=${c}&q=high&fixed=1`)
  await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
  await p.waitForTimeout(1500)
  const gaps = await p.evaluate((DUR) => new Promise((res) => {
    const g = window.__g; g.start(); g.skipCountdown(); g.autopilot(true)
    const gaps = []; let last = performance.now(); const t0 = last
    const f = (t) => { gaps.push(t - last); last = t; if (t - t0 < DUR) requestAnimationFrame(f); else res(gaps) }
    requestAnimationFrame(f)
  }), DUR)
  await ctx.close()
  const e = ((res[c] ??= {})[port] ??= { n25: 0, n50: 0, max: 0, frames: 0 })
  e.n25 += gaps.filter((x) => x > 25).length / reps; e.n50 += gaps.filter((x) => x > 50).length / reps; e.max = Math.max(e.max, ...gaps); e.frames += gaps.length / reps
}
for (const c of COURSES) console.log(c.padEnd(10), ports.map((port) => { const e = res[c][port]; return `${port}: >25ms ${e.n25.toFixed(1)}  >50ms ${e.n50.toFixed(1)}  max ${e.max.toFixed(0)}  (${e.frames.toFixed(0)} fr)` }).join('  |  '))
await b.close()
