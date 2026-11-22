// The Mach 6 barrier must not change the handling: burner + a steady steer through it, yaw logged.
import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 900, height: 600 } })).newPage()
await p.goto('http://localhost:5417/?course=drag'); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
const r = await p.evaluate(() => new Promise((done) => {
  const g = window.__g; g.start(); g.skipCountdown()
  const pl = g.player
  g.force({ steer: 0.25, boost: true, burner: true, brake: false, strafe: 0, dodgeL: false, dodgeR: false })
  const log = []; let lastPhase = 'none'
  const iv = setInterval(() => {
    log.push({ m: pl.mach, ph: pl.barrier, yaw: pl.yawRate, burn: pl.burning })
    if (log.length > 900) { clearInterval(iv); done(log) }
  }, 16)
}))
const i = r.findIndex((x) => x.ph === 'silence')
if (i < 0) console.log('no barrier reached, max mach', Math.max(...r.map((x) => x.m)).toFixed(2))
else {
  const seg = r.slice(Math.max(0, i - 20), i + 70)
  const maxJump = Math.max(...seg.slice(1).map((x, k) => Math.abs(x.yaw - seg[k].yaw)))
  console.log('barrier at sample', i, 'burning through silence:', seg.filter((x) => x.ph === 'silence').every((x) => x.burn))
  console.log('yaw before', r[i - 5].yaw.toFixed(3), 'during', r[i + 15].yaw.toFixed(3), 'after boom', r[i + 50].yaw.toFixed(3), '| largest 16 ms yaw jump', maxJump.toFixed(3))
}
await b.close()
