// Frame pacing on the real display (a headed, muted Chrome window — headless is locked to 60 Hz): the
// screen's refresh, and per quality setting how many frames land on every refresh vs miss one, the 1% low,
// and what AUTO decided (resolution share, detail steps, a 60 cap).   node tools/refreshcheck.mjs 4417
import { chromium } from 'playwright-core'
const port = process.argv[2] ?? '4417'
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] })
const ctx = await b.newContext({ viewport: null })
const runs = (process.env.RUNS ?? 'auto:40,balanced:25,high:25,ultra:25').split(',').map((x) => { const [q, s] = x.split(':'); return [q, +s] })
for (const [q, secs] of runs) {
  const p = await ctx.newPage()
  await p.bringToFront()
  await p.goto(`http://localhost:${port}/?course=sprint${q === 'auto' ? '' : `&q=${q}`}`)
  await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
  await p.evaluate(() => { try { localStorage.removeItem('dbu-auto') } catch {} })
  // The screen: median rAF gap at rest on the title.
  const refresh = await p.evaluate(() => new Promise((res) => { const g = []; let last = 0; const f = (t) => { if (last) g.push(t - last); last = t; if (g.length < 120) requestAnimationFrame(f); else { g.sort((a, b) => a - b); res(g[60]) } }; requestAnimationFrame(f) }))
  const r = await p.evaluate(async ([secs, refresh]) => {
    const g = window.__g; g.start(); g.skipCountdown(); g.autopilot(true)
    await new Promise((r) => setTimeout(r, 3000))
    const gaps = [], states = []
    let last = 0
    const t0 = performance.now()
    await new Promise((res) => { const f = (t) => { if (last) gaps.push(t - last); last = t; if (performance.now() - t0 < secs * 1000) requestAnimationFrame(f); else res() }; requestAnimationFrame(f)
      const iv = setInterval(() => { const s = g.stats(); states.push(`${s.tier}/d${s.detail}/dyn${s.dyn}/fps${s.fps}`); if (performance.now() - t0 > secs * 1000) clearInterval(iv) }, 5000) })
    // A frame "drawn" per rAF only if the game's own counter moved; with a 60 cap it skips alternate refreshes.
    const s = g.stats()
    const sorted = [...gaps].sort((a, b) => a - b), mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    const missed = gaps.filter((x) => x > refresh * 1.5).length
    return { frames: gaps.length, rafFps: +(1000 / mean).toFixed(1), gameFps: s.fps, onTime: +(100 * (1 - missed / gaps.length)).toFixed(1), missed, low1: +(1000 / sorted[Math.floor(sorted.length * 0.99)]).toFixed(0), low01: +(1000 / sorted[Math.floor(sorted.length * 0.999)]).toFixed(0), worst: +sorted[sorted.length - 1].toFixed(1), end: `${s.tier}/detail ${s.detail}/dyn ${s.dyn}/scale ${s.scale}/px ${s.px}`, every5s: states }
  }, [secs, refresh])
  console.log(`${q.padEnd(9)} refresh ${refresh.toFixed(2)} ms (${(1000 / refresh).toFixed(0)} Hz) · ${JSON.stringify(r)}`)
  await p.close()
}
await b.close()
