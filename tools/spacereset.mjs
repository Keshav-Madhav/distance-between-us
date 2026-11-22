// The "reset": start each mode by CLICKING the menu (as a player does), then press and release Space
// (and Enter) mid-run. The run must not restart (clock keeps counting, the craft does not jump back).
import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
await p.goto('http://localhost:5417/?course=sprint'); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.waitForTimeout(1500)
await p.evaluate(() => { window.__starts = 0; document.getElementById('start').addEventListener('click', () => window.__starts++) })
let fails = 0
for (const mode of ['free', 'hunt', 'race']) {
  await p.evaluate(() => { const g = window.__g; if (g.mode !== 'title') g.toTitle?.() })
  if (await p.evaluate(() => window.__g.mode) !== 'title') { await p.keyboard.press('Escape'); await p.waitForTimeout(300); await p.click('#p-menu').catch(() => {}) }
  await p.waitForTimeout(800)
  await p.click(`.tabs button[data-mode="${mode}"]`)
  await p.click('#start')
  await p.waitForTimeout(1500)
  const s0 = await p.evaluate(() => window.__starts)
  const run = () => p.evaluate(() => ({ mode: window.__g.mode, x: window.__g.player.pos.x, z: window.__g.player.pos.z, t: window.__g.stats().race }))
  const pos0 = await run()
  await p.keyboard.down('KeyW')
  let restarts = 0, last = pos0
  for (let i = 0; i < 6; i++) {
    await p.keyboard.down('Space'); await p.waitForTimeout(400); await p.keyboard.up('Space'); await p.waitForTimeout(500)
    if (i === 3) { await p.keyboard.press('Enter'); await p.waitForTimeout(300) }
    const now = await run()
    // Back near the spawn after having left it = a restart.
    const fromSpawn = Math.hypot(now.x - pos0.x, now.z - pos0.z), lastFrom = Math.hypot(last.x - pos0.x, last.z - pos0.z)
    if (lastFrom > 1500 && fromSpawn < lastFrom * 0.3) restarts++
    last = now
  }
  await p.keyboard.up('KeyW')
  restarts += (await p.evaluate(() => window.__starts)) - s0
  console.log(`${mode}: ${restarts ? 'RESTARTED ' + restarts + '×' : 'no restart'} · ${(Math.hypot(last.x - pos0.x, last.z - pos0.z) / 1000).toFixed(1)} km from the start · focused: ${await p.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)}`)
  fails += restarts
}
await b.close()
process.exit(fails ? 1 : 0)
