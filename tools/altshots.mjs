// HUNT flight: the world from height (far ring edge, haze, mountains), one course per world.
//   node tools/altshots.mjs [out dir]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
const D = (process.argv[2] ?? 'shots/alt') + '/'
mkdirSync(D, { recursive: true })
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
p.on('pageerror', (e) => console.log('ERR', e.message))
for (const c of ['sprint', 'frostline', 'caldera']) {
  await p.goto(`http://localhost:5417/?course=${c}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 }); await p.waitForTimeout(800)
  await p.evaluate(() => { window.__g.startHunt(); window.__g.flyForce(true) })
  for (const h of [200, 800, 1500, 2150]) {
    for (const nose of [0, -0.5]) {
      await p.evaluate(([h, nose]) => {
        const g = window.__g, f = g.flight
        f.reset(f.pos.x, f.pos.z, Math.atan2(f.fwd.x, f.fwd.z), h, 2.4)
        if (nose) { const q = new f.quat.constructor(); q.setFromAxisAngle({ x: 1, y: 0, z: 0, isVector3: true }, -nose); f.quat.multiply(q); f.prevQuat.copy(f.quat) }
        Object.assign(g.fc, { pitch: 0, turn: 0, roll: 0, throttle: false, brake: false, burner: false, aim: null })
      }, [h, nose])
      await p.waitForTimeout(700)
      await p.screenshot({ path: `${D}${c}-${h}${nose ? '-down' : ''}.png` })
    }
  }
}
await b.close()
console.log('ok')
