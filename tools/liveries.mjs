// The menu ship in each livery / finish / exhaust (paint drawer open), and a race frame with rivals.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
mkdirSync('shots/livery', { recursive: true })
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
p.on('pageerror', (e) => console.log('ERR', e.message))
await p.goto('http://localhost:5417/?course=greenway'); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 }); await p.waitForTimeout(2000)
await p.click('#paint-btn'); await p.waitForTimeout(400)
const files = []
const combos = [[1, 0, 0], [2, 2, 1], [3, 1, 2], [4, 3, 3], [5, 1, 4], [6, 4, 0]]
for (const [l, f, x] of combos) {
  await p.click(`#sw-livery button:nth-child(${l + 1})`); await p.click(`#sw-finish button:nth-child(${f + 1})`); await p.click(`#sw-flame button:nth-child(${x + 1})`)
  await p.waitForTimeout(700)
  const fn = `shots/livery/l${l}.png`; await p.screenshot({ path: fn, clip: { x: 420, y: 250, width: 720, height: 450 } }); files.push(fn)
}
await p.screenshot({ path: 'shots/livery/menu.png' })
execSync(`ffmpeg -v error -y ${files.map((f) => '-i ' + f).join(' ')} -filter_complex "${files.map((_, i) => `[${i}]scale=480:-1[s${i}]`).join(';')};${files.map((_, i) => `[s${i}]`).join('')}xstack=inputs=6:layout=0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0" shots/livery/sheet.png`)
await b.close()
