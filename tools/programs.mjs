// Shader programs a world compiles, grouped by material type and shader name.  node tools/programs.mjs 4495 sprint
import { chromium } from 'playwright-core'
const port = process.argv[2] ?? '4495', c = process.argv[3] ?? 'sprint'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
await p.goto(`http://localhost:${port}/?course=${c}&q=high&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(async () => { const g = window.__g; g.start(); g.skipCountdown(); g.autopilot(true); await new Promise((r) => setTimeout(r, 6000)) })
console.log(await p.evaluate(() => { const ps = window.__g.renderer.info.programs, by = {}
  for (const pr of ps) { const ck = pr.cacheKey, k = /^[a-z]+,/.test(ck) ? ck.split(',')[0] : 'custom:' + ck.replace(/\s+/g, ' ').slice(0, 70); by[k] = (by[k] ?? 0) + 1 }
  return `${ps.length} programs\n` + Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${String(v).padStart(3)}  ${k}`).join('\n') }))
await b.close()
