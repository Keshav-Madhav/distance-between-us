// Hunting the HUNT "reset": real key input for a few minutes; logs clock resets, teleports,
// orientation snaps, deaths, overlays.   node tools/huntreset.mjs [seconds] [course]
import { chromium } from 'playwright-core'
const S = +(process.argv[2] ?? 180), C = process.argv[3] ?? 'frostline'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
p.on('pageerror', (e) => console.log('ERR', e.message))
p.on('console', (m) => { if (m.text().startsWith('[R]')) console.log(m.text()) })
await p.goto(`http://localhost:5417/?course=${C}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.keyboard.press('KeyH'); await p.waitForTimeout(300)
await p.evaluate(() => window.__g.startHunt())
await p.evaluate(() => {
  const g = window.__g, f = g.flight
  let last = null, t = 0
  const q0 = f.quat.clone()
  setInterval(() => {
    t += 0.05
    const s = { x: f.pos.x, y: f.pos.y, z: f.pos.z, time: document.querySelector('#score .sub')?.textContent.split('·').pop().trim(), mode: g.mode, hull: f.hull, dead: g.player.dead, over: !document.querySelector('#over').classList.contains('hide') }
    if (last) {
      const d = Math.hypot(s.x - last.x, s.y - last.y, s.z - last.z)
      if (d > 120) console.log(`[R] ${t.toFixed(1)}s TELEPORT ${d.toFixed(0)} m (${last.x.toFixed(0)},${last.y.toFixed(0)},${last.z.toFixed(0)} → ${s.x.toFixed(0)},${s.y.toFixed(0)},${s.z.toFixed(0)}) agl ${f.agl.toFixed(0)}`)
      const ang = q0.angleTo(f.quat)
      if (ang > 0.5) console.log(`[R] ${t.toFixed(1)}s SNAP ${ang.toFixed(2)} rad agl ${f.agl.toFixed(0)}`)
      if (s.time && last.time && s.time < last.time && s.time.length === last.time.length) console.log(`[R] ${t.toFixed(1)}s CLOCK ${last.time} → ${s.time}`)
      if (s.mode !== last.mode) console.log(`[R] ${t.toFixed(1)}s MODE ${last.mode} → ${s.mode}`)
      if (s.dead !== last.dead) console.log(`[R] ${t.toFixed(1)}s DEAD ${s.dead} hull ${s.hull.toFixed(0)}`)
      if (s.over !== last.over) console.log(`[R] ${t.toFixed(1)}s OVERLAY ${s.over}`)
    }
    q0.copy(f.quat)
    last = s
  }, 50)
})
// A player-ish pattern: Shift most of the time, gentle turns, pitch, firing.
const keys = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyQ', 'KeyE']
const t0 = Date.now()
await p.keyboard.down('ShiftLeft')
while ((Date.now() - t0) / 1000 < S) {
  const k = keys[Math.floor(Math.random() * keys.length)]
  await p.keyboard.down(k); await p.keyboard.down('Space')
  await p.waitForTimeout(300 + Math.random() * 1200)
  await p.keyboard.up(k); await p.keyboard.up('Space')
  await p.waitForTimeout(500 + Math.random() * 1500)
}
console.log('done', await p.evaluate(() => document.querySelector('#score .sub').textContent))
await b.close()
