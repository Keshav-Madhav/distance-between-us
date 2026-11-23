// A filmstrip of the chase view at speed: 6 frames 60 ms apart, side by side (shows the ground's rush
// in a still).  URL=http://localhost:5417 COURSE=sprint OUT=file.png node tools/feelstrip.mjs
import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
const URL = process.env.URL ?? 'http://localhost:5417', C = process.env.COURSE ?? 'sprint', OUT = process.env.OUT
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 960, height: 540 } })).newPage()
await p.goto(`${URL}/?course=${C}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.click('#start'); await p.waitForTimeout(5200)
if (process.env.AUTO) await p.evaluate(() => window.__g.autopilot(true))
await p.keyboard.down('KeyW'); await p.keyboard.down('ShiftLeft'); await p.waitForTimeout(+(process.env.T ?? 8000))
const fs = []
for (let i = 0; i < 6; i++) { const f = `${OUT}.${i}.png`; await p.screenshot({ path: f }); fs.push(f); await p.waitForTimeout(60) }
await b.close()
execSync(`ffmpeg -loglevel error -y ${fs.map((f) => `-i ${f}`).join(' ')} -filter_complex "[0][1][2]hstack=3[a];[3][4][5]hstack=3[b];[a][b]vstack" ${OUT}`)
console.log('ok')
