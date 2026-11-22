// Can a player reach space with real keys? FREE ROAM via the menu, W+Shift, Space to pull up for a
// moment, then hold W+Shift (hands off pitch) and log the altitude for 90 s.
import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 1000, height: 620 } })).newPage()
await p.goto(`http://localhost:5417/?course=${process.env.COURSE ?? 'sprint'}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.waitForTimeout(1000)
await p.click('.tabs button[data-mode="free"]'); await p.click('#start'); await p.waitForTimeout(800)
await p.keyboard.down('KeyW'); await p.keyboard.down('ShiftLeft'); await p.waitForTimeout(4000)
await p.keyboard.down('Space'); await p.waitForTimeout(+(process.env.PULL ?? 1200)); await p.keyboard.up('Space')
const log = []
for (let i = 0; i < 18; i++) { await p.waitForTimeout(5000); log.push(await p.evaluate(() => { const g = window.__g; return `${(g.player.pos.y / 1000).toFixed(1)}km${g.freeAir ? '' : '(gnd)'}` })) }
console.log(log.join(' '))
await b.close()
