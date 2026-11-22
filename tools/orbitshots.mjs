// ORBIT views for review: at the spawn facing the planet, the star, sideways, behind; cruising; near.
//   OUT=dir node tools/orbitshots.mjs
import { chromium } from 'playwright-core'
const OUT = process.env.OUT
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://localhost:5417/?course=orbit'); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { window.__g.system(); document.getElementById('hints').style.display = 'none' }); await p.waitForTimeout(500)
const aimAt = (dir, burner = false) => p.evaluate(([dir, burner]) => { const g = window.__g; g.flyForce(true); const s = g.sys
  let d; if (dir === 'star') d = s.pos.clone().negate().normalize(); else if (dir === 'planet') d = s.planets[1].pos.clone().sub(s.pos).normalize(); else d = { x: dir[0], y: dir[1], z: dir[2] }
  const v = new (s.pos.constructor)(d.x, d.y, d.z).normalize()
  Object.assign(g.fc, { aim: v, burner, throttle: false, brake: !burner, roll: 0, turn: 0, pitch: 0 }) }, [dir, burner])
for (const [tag, dir] of [['planet', 'planet'], ['star', 'star'], ['side', [0, 0.2, 1]], ['up', [0.3, 0.9, 0.2]]]) {
  await aimAt(dir); await p.waitForTimeout(3500); await p.screenshot({ path: `${OUT}/o-${tag}.png` })
}
await aimAt([0.7, 0.05, -0.7], true); await p.waitForTimeout(2500); await p.screenshot({ path: `${OUT}/o-cruise.png` })
console.log('errors', errs.slice(0, 3))
await b.close()
