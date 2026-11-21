// FROSTLINE review set: menu flight, the sky (orbit pitched up), race frames over a lap section.
//   node tools/frostshots.mjs <out dir>
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
const D = (process.argv[2] ?? 'shots/frost') + '/'
mkdirSync(D, { recursive: true })
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
p.on('pageerror', (e) => console.log('ERR', e.message))
await p.goto('http://localhost:4417/?course=frostline'); await p.waitForFunction('window.__g && window.__g.ready'); await p.waitForTimeout(3000)
await p.screenshot({ path: D + '01-menu.png' })
await p.evaluate(() => { document.getElementById('title').style.visibility = 'hidden' })
await p.keyboard.down('ArrowLeft'); await p.waitForTimeout(1700); await p.keyboard.up('ArrowLeft'); await p.waitForTimeout(500)
await p.screenshot({ path: D + '02-sky.png' })
await p.evaluate(() => { document.getElementById('title').style.visibility = '' })
await p.click('#start'); await p.waitForTimeout(4500)
await p.evaluate(() => window.__g.autopilot(true))
for (const [i, t] of [[3, 6000], [4, 7000], [5, 7000], [6, 8000]]) { await p.waitForTimeout(t); await p.screenshot({ path: D + `0${i}-race.png` }) }
execSync(`ffmpeg -v error -y -i ${D}03-race.png -i ${D}04-race.png -i ${D}05-race.png -i ${D}06-race.png -filter_complex "[0]scale=720:-1[a];[1]scale=720:-1[b];[2]scale=720:-1[c];[3]scale=720:-1[d];[a][b][c][d]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0" ${D}race-sheet.png`)
await b.close()
console.log('ok')
