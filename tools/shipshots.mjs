// Every ship model, alone, from three close angles (showroom.html), into one contact sheet per model.
//   OUT=dir node tools/shipshots.mjs [tag]
import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
const OUT = process.env.OUT, tag = process.argv[2] ?? 'a'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 })).newPage()
for (let m = 0; m < 6; m++) {
  for (const v of [0, 1, 7]) {
    await p.goto(`http://localhost:5417/showroom.html?only=${m}&view=${v}`)
    await p.waitForFunction('window.ready', null, { timeout: 60000 })
    await p.waitForTimeout(300)
    await p.screenshot({ path: `${OUT}/${tag}-m${m}-v${v}.png` })
  }
  execSync(`ffmpeg -loglevel error -y -i ${OUT}/${tag}-m${m}-v0.png -i ${OUT}/${tag}-m${m}-v1.png -i ${OUT}/${tag}-m${m}-v7.png -filter_complex "[0][1][2]hstack=inputs=3" ${OUT}/${tag}-m${m}.jpg`)
}
await b.close()
console.log('done')
