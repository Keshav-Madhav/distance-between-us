// Drag race check: the player holds W + Shift all race (steering from the AI brain, in the game loop);
// samples the pack around you, top speed, airtime, bumps; screenshots. node tools/dragtest.mjs [burn 0|1]
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
const BURN = process.argv[2] !== '0'
mkdirSync('shots/run11', { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
page.on('pageerror', (e) => console.log('ERR', e.message))
await page.goto('http://localhost:4417/?fixed&course=drag'); await page.waitForFunction('window.__g && window.__g.ready')
await page.evaluate((burn) => {
  const g = window.__g, me = g.race.racers[0]
  window.__st = { bumps: 0, air: 0, maxM: 0, wasAir: false, crashes: 0, wasC: false }
  g.race.ev.bumped = ((f) => (...a) => { window.__st.bumps++; return f(...a) })(g.race.ev.bumped)
  const tick = () => {
    if (g.race.state === 'racing' && !me.finished) {
      g.race.drive(me, 1 / 60)
      g.force({ steer: me.controls.steer, boost: true, burner: burn && !g.player.airborne, brake: false, strafe: 0, dodgeL: false, dodgeR: false })
    } else g.force({ steer: 0, boost: g.race.state !== 'grid' || g.race.countdown < 0.4, burner: false, brake: false, strafe: 0, dodgeL: false, dodgeR: false })
    const s = window.__st, p = g.player
    s.maxM = Math.max(s.maxM, p.mach)
    if (p.airborne && !s.wasAir) s.air++
    if (p.crashing && !s.wasC) s.crashes++
    s.wasAir = p.airborne; s.wasC = p.crashing
    requestAnimationFrame(tick)
  }
  tick()
  g.start()
}, BURN)
const t0 = Date.now(); let shot = 0
while (Date.now() - t0 < 240000) {
  await page.waitForTimeout(5000)
  const s = await page.evaluate(() => {
    const g = window.__g, me = g.race.racers[0], rs = g.race.racers
    const prog = (r) => g.race.progress(r)
    const mp = prog(me)
    const d = rs.filter((r) => r !== me).map((r) => prog(r) - mp)
    const within = (m) => d.filter((x) => Math.abs(x) < m).length
    const ms = rs.map((r) => r.p.mach)
    return { fin: me.finished, place: me.place, toGo: g.race.toGo(me) / 1000, mach: g.player.mach, spread: (Math.max(...d) - Math.min(...d)) / 1000, w500: within(500), w2k: within(2000), aiM: `${Math.min(...ms.slice(1)).toFixed(1)}-${Math.max(...ms.slice(1)).toFixed(1)}`, st: { ...window.__st } }
  })
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s P${s.place} ${s.toGo.toFixed(0)}km M${s.mach.toFixed(1)} | pack spread ${s.spread.toFixed(1)}km, ${s.w500} within 500m, ${s.w2k} within 2km, AI M${s.aiM} | jumps ${s.st.air} bumps ${s.st.bumps} crashes ${s.st.crashes} maxM ${s.st.maxM.toFixed(1)}`)
  if (shot < 6) await page.screenshot({ path: `shots/run11/drag${shot++}.png` })
  if (s.fin) break
}
console.log(await page.evaluate(() => window.__g.race.racers.slice().sort((a, b) => a.place - b.place).slice(0, 8).map((r) => `${r.place}.${r.name} ${r.finished ? r.finishTime.toFixed(1) + 's' : (window.__g.race.toGo(r) / 1000).toFixed(1) + 'km'}`).join('  ')))
await browser.close()
