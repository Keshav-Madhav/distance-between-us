// A playtest through the real keyboard (the same input path a player uses), recorded to video.
// A small bot looks at the game ~10×/s and presses W / Shift / A / D / S like a player would:
// a timed launch, lining up the next gate, stepping round spires, afterburner on clear straights,
// a brake-drift in the S-bends. Logs events; screenshots every 10 s; the video lands in shots/run4/video/.
//   node tools/playtest.mjs [seconds]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const SECS = +(process.argv[2] ?? 150)
mkdirSync('shots/run4/video', { recursive: true })
mkdirSync('shots/run4/play', { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: 'shots/run4/video', size: { width: 1280, height: 720 } } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://localhost:4417/'); await page.waitForFunction('window.__g && window.__g.ready')
await page.waitForTimeout(2500)
await page.screenshot({ path: 'shots/run4/play/00-title.png' })
await page.keyboard.press('Enter')

const held = new Set()
const hold = async (k, on) => {
  if (on && !held.has(k)) { held.add(k); await page.keyboard.down(k) }
  if (!on && held.has(k)) { held.delete(k); await page.keyboard.up(k) }
}
const log = []
const t0 = Date.now()
let lastShot = 0, lastLog = 0, drifted = false

// The launch: W in the last half second of the countdown.
while (true) {
  const cd = await page.evaluate(() => ({ s: window.__g.race.state, c: window.__g.race.countdown }))
  if (cd.s !== 'grid') break
  if (cd.c < 0.45) await hold('w', true)
  await page.waitForTimeout(40)
}
log.push(`launch: ${JSON.stringify(await page.evaluate(() => ({ mach: window.__g.player.mach.toFixed(2) })))}`)

while ((Date.now() - t0) / 1000 < SECS) {
  const s = await page.evaluate(() => {
    const g = window.__g, p = g.player, c = g.course, me = g.race.racers[0]
    const i = me.idx, [tx, tz] = c.tangent(i)
    const lat = (p.pos.x - c.px[i]) * -tz + (p.pos.z - c.pz[i]) * tx
    // The line a little ahead, and the nearest spire in my way within ~3 s.
    const look = Math.min(c.n - 1, i + Math.round((p.speed * 0.5 + 80) / 40))
    const [lx, lz] = c.tangent(look)
    let lane = 0, rockAhead = 1e9
    for (const rk of c.rocks) {
      if (rk.i < i - 1 || rk.i > i + (p.speed * 3 + 400) / 40) continue
      const foot = rk.r * 1.8 + 45
      rockAhead = Math.min(rockAhead, (rk.i - i) * 40)
      if (Math.abs(lane - rk.lat) < foot) lane = rk.lat + (lat >= rk.lat ? 1 : -1) * (foot + 25)
    }
    return {
      lineH: Math.atan2(lx, lz), heading: p.heading, lat, lane, speed: p.speed, mach: p.mach, yaw: p.yawRate, slip: p.slip,
      rockAhead, air: p.airborne, crashing: p.crashing, dead: p.dead, place: me.place, passed: me.passed, K: c.cps.length,
      finished: me.finished, hull: p.hull, burning: p.burning, toGo: g.race.toGo(me), wake: p.wake, drift: p.drift,
      bend: Math.abs(Math.atan2(Math.sin(Math.atan2(...c.tangent(Math.min(c.n - 1, i + 60))) - Math.atan2(tx, tz)), Math.cos(Math.atan2(...c.tangent(Math.min(c.n - 1, i + 60))) - Math.atan2(tx, tz)))),
    }
  })
  const el = (Date.now() - t0) / 1000
  if (s.finished) { log.push(`${el.toFixed(0)}s FINISHED P${s.place}`); break }
  // Steering: the AI's own brain decides (gap search round spires, cross-track), but the bot only
  // presses keys from it — the input path is the player's.
  const steer = await page.evaluate(() => { const g = window.__g, me = g.race.racers[0]; g.race.drive(me, 1 / 60); return me.controls.steer })
  const err = 0
  await hold('d', steer > 0.12)
  await hold('a', steer < -0.12)
  // Throttle always; afterburner on a clear straight; brake-drift once in a bend.
  await hold('w', !s.crashing)
  const clear = s.rockAhead > s.speed * 2.5 && s.bend < 0.05 && Math.abs(err) < 0.05 && s.mach < 8
  await hold('Shift', clear && !s.air)
  if (!drifted && s.bend > 0.12 && s.mach > 3 && !s.air) { await hold('s', true); await page.waitForTimeout(700); await hold('s', false); drifted = true; log.push(`${el.toFixed(0)}s brake-drift`) }
  if (el - lastLog > 5) {
    lastLog = el
    log.push(`${el.toFixed(0)}s P${s.place} gate ${s.passed}/${s.K} M${s.mach.toFixed(2)} hull ${Math.round(s.hull)} ${s.burning ? 'BURN' : ''} ${s.air ? 'AIR' : ''} ${s.crashing ? 'CRASH' : ''} ${s.wake > 0.2 ? 'WAKE' : ''} toGo ${(s.toGo / 1000).toFixed(1)}km`)
  }
  if (el - lastShot > 10) { lastShot = el; await page.screenshot({ path: `shots/run4/play/${String(Math.round(el)).padStart(3, '0')}.png` }) }
  await page.waitForTimeout(60)
}
await page.waitForTimeout(5000)
await page.screenshot({ path: 'shots/run4/play/zz-end.png' })
console.log(log.join('\n'))
console.log(await page.evaluate(() => window.__g.race.racers.map((r) => `${r.name} passed=${r.passed}/${window.__g.course.cps.length} next=${r.next} fin=${r.finished} idx=${r.idx}/${window.__g.course.finishI} dead=${r.p.dead} crash=${r.p.crashing} mach=${r.p.mach.toFixed(1)}`).join('\n')))
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].slice(0, 10).join('\n') : 'no errors')
const v = page.video()
await ctx.close()
console.log('video:', await v.path())
await browser.close()
