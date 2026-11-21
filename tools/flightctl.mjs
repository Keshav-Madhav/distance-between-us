// HUNT controls through the real input path: mouse right turns right, centred flies straight,
// ↑ dives, ↓ climbs, D turns right.  node tools/flightctl.mjs
import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
p.on('pageerror', (e) => console.log('ERR', e.message))
await p.goto('http://localhost:5417/?course=sprint'); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 }); await p.waitForTimeout(800)
await p.evaluate(() => window.__g.startHunt()); await p.waitForTimeout(1500)
const st = () => p.evaluate(() => { const f = window.__g.flight; return { h: Math.atan2(f.fwd.x, f.fwd.z), fy: f.fwd.y, agl: f.agl } })
// mouse right of centre: should turn right (heading decreases: right = -x)
let a = await st(); await p.mouse.move(1000, 360); for (let i = 0; i < 8; i++) { await p.mouse.move(1000 + (i % 2), 360); await p.waitForTimeout(100) }
let c = await st(); let dh = Math.atan2(Math.sin(c.h - a.h), Math.cos(c.h - a.h)); console.log('mouse right → heading change', dh.toFixed(2), dh < 0 ? 'RIGHT ok' : 'WRONG')
await p.screenshot({ path: 'shots/ctl-mouse.png' })
// centre: straightens
await p.mouse.move(640, 360); await p.waitForTimeout(2500); a = await st(); await p.waitForTimeout(1500); c = await st(); dh = Math.atan2(Math.sin(c.h - a.h), Math.cos(c.h - a.h)); console.log('mouse centre → heading change', dh.toFixed(3))
// ArrowUp: nose down
await p.keyboard.down('ArrowUp'); await p.waitForTimeout(700); c = await st(); await p.keyboard.up('ArrowUp'); console.log('ArrowUp → nose y', c.fy.toFixed(2), c.fy < 0 ? 'DOWN ok' : 'WRONG')
await p.keyboard.down('ArrowDown'); await p.waitForTimeout(1200); c = await st(); await p.keyboard.up('ArrowDown'); console.log('ArrowDown → nose y', c.fy.toFixed(2), c.fy > 0 ? 'UP ok' : 'WRONG')
a = await st(); await p.keyboard.down("KeyD"); await p.waitForTimeout(900); c = await st(); await p.keyboard.up('KeyD'); dh = Math.atan2(Math.sin(c.h - a.h), Math.cos(c.h - a.h)); console.log('D → heading change', dh.toFixed(2), dh < 0 ? 'RIGHT ok' : 'WRONG')
await b.close()
