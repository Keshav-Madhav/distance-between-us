// World / course switches as a player makes them: time from the pick until the next world is on screen
// (its frame faded in, racing if asked), cold and pre-booted; screenshots mid-switch (SHOTS=dir).
//   node tools/switchtime.mjs 4495
import { chromium } from 'playwright-core'
import { calm } from './loadguard.mjs'
const port = process.argv[2] ?? '4495', SHOTS = process.env.SHOTS
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
await calm()
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
await p.goto(`http://localhost:${port}/?course=sprint&q=high`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.waitForTimeout(2000)
// The frame on screen: the top-most iframe (by z-index) once one exists.
const onScreen = () => p.evaluate(() => { const fs = [...document.querySelectorAll('iframe')].filter((f) => f.style.opacity === '1'); fs.sort((a, b) => +b.style.zIndex - +a.style.zIndex); return fs[0] ? new URL(fs[0].src).searchParams.get('course') : new URL(location.href).searchParams.get('course') })
async function sw(label, id, go, pre) {
  await calm(label)
  if (pre) { await p.evaluate((id) => { const g = [...document.querySelectorAll('iframe')].map((f) => f.contentWindow.__g).find((x) => x && !x.dormant) ?? window.__g; window.__g.prewarm(id) }, id); await p.waitForTimeout(pre) }
  const t0 = Date.now()
  // (The visible instance asks; it forwards to the host.)
  await p.evaluate(([id, go]) => { const fs = [...document.querySelectorAll('iframe')].filter((f) => f.style.opacity === '1').sort((a, b) => +b.style.zIndex - +a.style.zIndex); const w = fs[0]?.contentWindow ?? window; w.__g.swap(id, go) }, [id, go])
  let shot = 0
  for (;;) {
    await p.waitForTimeout(50)
    const ms = Date.now() - t0
    if (SHOTS && shot < 2 && ms > [400, 1000][shot]) await p.screenshot({ path: `${SHOTS}/${label}-${shot++}.png` })
    if ((await onScreen()) === id) break
    if (ms > 30000) { console.log(label, 'TIMEOUT'); return }
  }
  console.log(`${label.padEnd(34)} ${Date.now() - t0} ms`)
  await p.waitForTimeout(2500)
}
await sw('cold, other world (greenway)', 'greenway', true)
await sw('cold, same world (timberline)', 'timberline', true)
await sw('pre-booted 3 s ahead (frostline)', 'frostline', true, 3000)
await sw('back to the sleeping world (timberline)', 'timberline', false)
await b.close()
