// The ghost, end to end: a damaged old-format ghost is rejected (no NaN, no errors); a finished run
// saves one (IndexedDB) that loads after a reload and draws at finite positions; console errors counted.
//   node tools/ghostcheck.mjs 4495 whitewater
import { chromium } from 'playwright-core'
import { calm } from './loadguard.mjs'
const port = process.argv[2] ?? '4495', c = process.argv[3] ?? 'whitewater'
await calm()
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } })
const p = await ctx.newPage()
const errs = []
p.on('pageerror', (e) => errs.push('pageerror ' + e.message))
p.on('console', (m) => { if (m.type() === 'error' || /NaN/.test(m.text())) errs.push(m.type() + ' ' + m.text().slice(0, 140)) })
const url = `http://localhost:${port}/?course=${c}&q=high&fixed=1`
await p.goto(url)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
// A damaged ghost the old way (7 bytes: not whole floats, not whole samples).
await p.evaluate((c) => { localStorage.setItem('dbu-ghost-' + c, btoa('\x01\x02\x03\x04\x05\x06\x07')); indexedDB.deleteDatabase('dbu') }, c)
await p.reload(); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 }); await p.waitForTimeout(800)
console.log('damaged: localStorage key left?', await p.evaluate((c) => localStorage.getItem('dbu-ghost-' + c) !== null, c))
const run = async (label) => {
  const r = await p.evaluate(async () => {
    const g = window.__g
    g.start(); g.skipCountdown(); g.autopilot(true)
    const seen = { frames: 0, nan: 0, visible: 0 }
    const t0 = performance.now()
    await new Promise((res) => { const iv = setInterval(() => {
      const gp = g.craftPos // (the player's) — the ghost: scene object visible flag via stats
      const gh = [...g.scene.children].find((o) => o.userData?.ghost) // may be absent
      seen.frames++
      if (g.race.racers[0].finished || performance.now() - t0 > 90000) { clearInterval(iv); res() }
    }, 200) })
    return { finished: g.race.racers[0].finished, t: g.race.racers[0].finishTime }
  })
  console.log(label, JSON.stringify(r))
}
await run('race 1 (no ghost):')
await p.waitForFunction(() => !document.querySelector('#over').classList.contains('hide'), null, { timeout: 60000 })
await p.waitForTimeout(800)
console.log('saved to IndexedDB:', await p.evaluate((c) => new Promise((res) => { const r = indexedDB.open('dbu'); r.onsuccess = () => { const q = r.result.transaction('runs').objectStore('runs').get('dbu-ghost-' + c); q.onsuccess = () => res(q.result ? q.result.byteLength + ' bytes' : 'none') } }), c))
await p.reload(); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 }); await p.waitForTimeout(800)
// Race 2 with the ghost: sample the ghost craft's position as it runs.
const g2 = await p.evaluate(async () => {
  const g = window.__g
  g.start(); g.skipCountdown(); g.autopilot(true)
  let shown = 0, nan = 0
  await new Promise((r) => setTimeout(r, 300))
  const gr = g.scene.children.filter((o) => o.type === 'Group' && o.children[0]?.children?.length >= 3)
  const t0 = performance.now()
  await new Promise((res) => { const iv = setInterval(() => {
    for (const o of gr) { if (!o.visible) continue; if (o.children[0]?.children?.some((m) => m.material?.opacity === 0.3)) shown++; const v = o.position; if (!Number.isFinite(v.x + v.y + v.z)) nan++ }
    if (g.race.racers[0].finished || performance.now() - t0 > 90000) { clearInterval(iv); res() }
  }, 100) })
  return { finished: g.race.racers[0].finished, nanPositions: nan, ghostSamplesShown: shown, replayInputs: g.inputCount() }
})
console.log('race 2 (with ghost):', JSON.stringify(g2))
console.log(errs.length ? 'ERRORS:\n  ' + [...new Set(errs)].slice(0, 8).join('\n  ') : 'no console errors')
await b.close()
