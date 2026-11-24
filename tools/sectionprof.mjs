// Which part of a frame spikes: a race with ?prof=1 (src/main.ts times each section of every frame),
// then each section's p50 / p99 / p99.9 / max and the worst frames broken down.
//   node tools/sectionprof.mjs 4495 icecave [seconds] [level]
import { chromium } from 'playwright-core'
import { calm } from './loadguard.mjs'
const port = process.argv[2] ?? '4495', c = process.argv[3] ?? 'sprint', S = +(process.argv[4] ?? 40), L = +(process.argv[5] ?? 2.2)
await calm()
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })).newPage()
await p.goto(`http://localhost:${port}/?course=${c}&q=high&fixed=1&prof=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.waitForTimeout(2000)
await p.evaluate((L) => { const g = window.__g; g.race.aiBoost = L; g.start(); g.skipCountdown(); g.autopilot(true); g.profReset() }, L)
await p.waitForTimeout(S * 1000)
console.log(`${c} (${S} s, field ${L}):\n` + await p.evaluate(() => window.__g.prof()))
await b.close()
