// Rock variety check: race frames on a course, from the dev server.
//   COURSE=sprint node tools/mesashots.mjs <out dir>
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
const D = (process.argv[2] ?? 'shots/mesa') + '/'
const C = process.env.COURSE ?? 'sprint'
mkdirSync(D, { recursive: true })
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
p.on('pageerror', (e) => console.log('ERR', e.message))
await p.goto(`http://localhost:5417/?course=${C}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 }); await p.waitForTimeout(3000)
await p.click('#start'); await p.waitForTimeout(4500)
await p.evaluate(() => window.__g.autopilot(true))
for (const i of [1, 2, 3, 4]) { await p.waitForTimeout(6000); await p.screenshot({ path: D + `${C}-${i}.png` }) }
execSync(`ffmpeg -v error -y -i ${D}${C}-1.png -i ${D}${C}-2.png -i ${D}${C}-3.png -i ${D}${C}-4.png -filter_complex "[0]scale=720:-1[a];[1]scale=720:-1[b];[2]scale=720:-1[c];[3]scale=720:-1[d];[a][b][c][d]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0" ${D}${C}-sheet.png`)
await b.close()
console.log('ok')
