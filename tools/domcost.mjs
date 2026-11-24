// The browser's own per-frame work around the game over 6 s of a race: script, style recalc, layout,
// and the task total (CDP Performance metrics), per frame drawn.  node tools/domcost.mjs 4495 sprint
import { chromium } from 'playwright-core'
import { calm } from './loadguard.mjs'
const port = process.argv[2] ?? '4495', c = process.argv[3] ?? 'sprint', Q = process.env.Q ?? 'high'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
await calm()
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
const p = await ctx.newPage()
await p.goto(`http://localhost:${port}/?course=${c}&q=${Q}&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { const g = window.__g; g.start(); g.skipCountdown(); g.autopilot(true) })
await p.waitForTimeout(4000)
const cdp = await ctx.newCDPSession(p)
await cdp.send('Performance.enable')
const get = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
const f0 = await p.evaluate(() => { let n = 0; const f = () => { n++; window.__nf = n; requestAnimationFrame(f) }; requestAnimationFrame(f); return 0 })
const a = await get(); await p.waitForTimeout(6000); const z = await get()
const frames = await p.evaluate(() => window.__nf)
const per = (k) => ((z[k] - a[k]) * 1000 / frames).toFixed(3)
console.log(`${c} ${Q}: ${frames} frames · per frame ms: script ${per('ScriptDuration')} style ${per('RecalcStyleDuration')} layout ${per('LayoutDuration')} task ${per('TaskDuration')} · recalcs ${((z.RecalcStyleCount - a.RecalcStyleCount) / frames).toFixed(2)} layouts ${((z.LayoutCount - a.LayoutCount) / frames).toFixed(2)}`)
await b.close()
