import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
p.on('pageerror', (e) => console.log('ERR', e.message))
await p.goto('http://localhost:5417/?course=frostline'); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => {
  const g = window.__g; g.startHunt(); g.flyForce(true)
  Object.assign(g.fc, { pitch: 0, turn: 0.3, roll: 0, throttle: true, brake: false, burner: false, aim: null })
  window.__jumps = []; let last = null, t = 0
  setInterval(() => { t += 0.05; const f = g.flight; const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z }; if (last) { const d = Math.hypot(p.x - last.x, p.z - last.z); if (d > 400) window.__jumps.push(`${t.toFixed(1)}s jump ${d.toFixed(0)} m to ${p.x.toFixed(0)},${p.z.toFixed(0)} hull ${f.hull.toFixed(0)} mode ${g.mode}`) } last = p }, 50)
})
for (let i = 0; i < 6; i++) { await p.waitForTimeout(10000); console.log(await p.evaluate(() => { const g = window.__g, f = g.flight; return `pos ${f.pos.x.toFixed(0)},${f.pos.z.toFixed(0)} agl ${f.agl.toFixed(0)} hull ${f.hull.toFixed(0)} mach ${f.mach.toFixed(2)} | ` + window.__jumps.splice(0).join(' ; ') })) }
await b.close()
