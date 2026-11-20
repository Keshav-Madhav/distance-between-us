import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage()
await page.goto('http://localhost:4417/?fixed&q=low'); await page.waitForFunction('window.__g && window.__g.ready')
await page.evaluate(() => {
  const g = window.__g; window.__log = []
  const p = g.player
  const c0 = p.onCrash, l0 = p.onLand
  p.onCrash = (...a) => { window.__log.push(`crash sev=${a[0].toFixed(2)} big=${a[1]} hull=${p.hull.toFixed(0)}`); c0(...a) }
  p.onLand = (...a) => { window.__log.push(`land imp=${a[0].toFixed(0)} air=${a[1].toFixed(2)} hull=${p.hull.toFixed(0)}`); l0(...a) }
  const b0 = g.race.ev.bumped
  g.race.ev.bumped = (a, b, sev, ...r) => { if (a.p === p || b.p === p) window.__log.push(`bump ${a.name}/${b.name} sev=${sev.toFixed(2)} hull=${p.hull.toFixed(0)}`); b0(a, b, sev, ...r) }
  let last = 100
  setInterval(() => { if (p.hull < last - 3) window.__log.push(`hull ${last.toFixed(0)}→${p.hull.toFixed(0)} mach=${p.mach.toFixed(1)} air=${p.airborne}`); last = p.hull }, 50)
  g.start(); g.autopilot(true)
})
await page.waitForTimeout(20000)
console.log((await page.evaluate(() => window.__log)).slice(0, 60).join('\n'))
await browser.close()
