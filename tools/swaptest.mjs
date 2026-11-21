// World swap without a black-out: click another world, shoot the screen as it loads and fades.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
const D = 'shots/swap/'; mkdirSync(D, { recursive: true })
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
p.on('pageerror', (e) => console.log('ERR', e.message))
p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()) })
await p.goto(`http://localhost:${process.env.PORT ?? 5417}/?course=circuit`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 }); await p.waitForTimeout(1500)
const t0 = Date.now()
await p.click('#worlds .w[data-w=lava]')
for (let i = 0; i < 14; i++) { await p.waitForTimeout(500); await p.screenshot({ path: `${D}${String(i).padStart(2, '0')}.png` }) }
const frames = p.frames()
console.log('frames', frames.length, 'took ~', ((Date.now() - t0) / 1000).toFixed(1), 's')
const inner = frames.find((f) => f !== p.mainFrame())
if (inner) console.log('inner ready', await inner.evaluate(() => !!(window.__g && window.__g.ready)), 'course', await inner.evaluate(() => window.__g.course.def.id))
console.log('url', p.url())
// Second swap from inside the frame: back to ice.
if (inner) { await inner.click('#worlds .w[data-w=ice]'); await p.waitForTimeout(6000); console.log('frames after 2nd', p.frames().length); const f2 = p.frames().find((f) => f !== p.mainFrame()); console.log('now', await f2.evaluate(() => window.__g.course.def.id)); await p.screenshot({ path: D + 'second.png' }) }
await b.close()
