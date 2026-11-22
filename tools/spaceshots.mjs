// Climbing to space: the craft held at altitudes (level, and nose down) for review.
//   COURSE=id OUT=dir node tools/spaceshots.mjs [alts km, comma-separated]
import { chromium } from 'playwright-core'
const OUT = process.env.OUT, C = process.env.COURSE ?? 'sprint'
const ALTS = (process.argv[2] ?? '0.5,4,10,20,40,90,250').split(',').map(Number)
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
await p.goto(`http://localhost:5417/?course=${C}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { const g = window.__g; g.free(); g.fly(); g.flyForce(true); Object.assign(g.fc, { pitch: 0, turn: 0, roll: 0, throttle: false, brake: false, burner: false, aim: null }); document.getElementById('hints').style.display = 'none' })
const sunYaw = await p.evaluate(() => { const s = window.__g.world.sunLight.position; return Math.atan2(s.x, s.z) })
for (const a of ALTS) for (const [tag, pitch, yaw] of [['level', -0.06, 0], ['down', -0.55, 0], ['sun', -0.08, sunYaw]]) {
  await p.evaluate(([a, pitch, yaw]) => {
    const g = window.__g, f = g.flight, T = window.__g.camera.constructor
    const q = f.quat.clone().setFromAxisAngle({ x: 0, y: 1, z: 0, isVector3: true }, yaw)
    const e = f.quat.clone().setFromAxisAngle({ x: 1, y: 0, z: 0, isVector3: true }, -pitch)
    f.quat.copy(q.multiply(e)); f.prevQuat.copy(f.quat)
    f.pos.y = f.ground(f.pos.x, f.pos.z) + a * 1000; f.prev.copy(f.pos); f.speed = 600; f.vel.set(0, 0, 0)
    window.__hold = () => { f.pos.y = f.ground(f.pos.x, f.pos.z) + a * 1000; f.quat.copy(f.prevQuat) }
  }, [a, pitch, yaw])
  await p.waitForTimeout(1600)
  await p.screenshot({ path: `${OUT}/space-${C}-${String(a).padStart(5, '0')}km-${tag}.png` })
}
console.log('errors', errs.slice(0, 5))
await b.close()
