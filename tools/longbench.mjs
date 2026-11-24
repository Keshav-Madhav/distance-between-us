// The long run: frame-time consistency across the whole game — every race course raced to the finish
// against a strong field, IMPOSSIBLE and DUEL fields, free roam (ground and air), a HUNT, ORBIT.
// Uncapped frames; per scenario: average fps, 1% and 0.1% lows, frames over 25 / 50 ms, the worst
// frames with what was happening. Writes OUT (json) as it goes; prints a table at the end.
//   PORT=4497 OUT=/tmp/long.json node tools/longbench.mjs            (ONLY=race:sprint,hunt to pick)
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const PORT = process.env.PORT ?? '4497', OUT = process.env.OUT ?? '/tmp/longbench.json', Q = process.env.Q ?? 'high'
const COURSES = ['sprint', 'dry-river', 'drag', 'circuit', 'oval', 'canyon', 'frostline', 'icefall', 'whiteout', 'icecave', 'caldera', 'faultline', 'obsidian', 'magma', 'greenway', 'riverrun', 'timberline', 'whitewater', 'mistriver', 'understory']
const SC = [
  ...COURSES.map((c) => ({ id: `race:${c}`, course: c, kind: 'race', level: 2.2 })),
  { id: 'impossible:sprint', course: 'sprint', kind: 'race', level: 4.5 },
  { id: 'impossible:caldera', course: 'caldera', kind: 'race', level: 4.5 },
  { id: 'duel:greenway', course: 'greenway', kind: 'race', level: 2.2, sub: 'duel' },
  { id: 'free:desert', course: 'sprint', kind: 'free', secs: 120 },
  { id: 'free:jungle', course: 'mistriver', kind: 'free', secs: 120 },
  { id: 'hunt:desert', course: 'sprint', kind: 'hunt', secs: 150 },
  { id: 'orbit', course: 'orbit', kind: 'orbit', secs: 90 },
  { id: 'arrive:orbit-to-mesa', course: 'orbit', kind: 'arrive', secs: 40 },
].filter((s) => !process.env.ONLY || process.env.ONLY.split(',').some((o) => s.id === o || s.id.startsWith(o + ':') || s.kind === o))
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--ignore-gpu-blocklist'] })
const pct = (a, q) => a[Math.min(a.length - 1, Math.floor(a.length * q))]
const results = fs.existsSync(OUT) && process.env.APPEND ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {}
for (const s of SC) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window)
    window.__f = []; window.__rec = false
    window.requestAnimationFrame = (cb) => raf((t) => { const a = performance.now(); cb(t); if (window.__rec) { const g = window.__g; window.__f.push([t, performance.now() - a, g ? +g.stats().mach : 0]) } })
  })
  try {
    await p.goto(`http://localhost:${PORT}/?course=${s.course}&q=${Q}&fixed=1`)
    await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
    await p.evaluate(() => { const f = document.querySelector('#g-fps'); if (f) { f.value = 'max'; f.dispatchEvent(new Event('change')) } })
    await p.waitForTimeout(2000)
    const r = await p.evaluate(async (s) => {
      const g = window.__g
      const t0 = performance.now()
      if (s.kind === 'race') {
        g.race.aiBoost = s.level
        if (s.sub) g.race.setMode(s.sub)
        g.start(); g.skipCountdown(); g.autopilot(true)
        window.__rec = true
        // To the finish (the player's), or 200 s.
        await new Promise((res) => { const iv = setInterval(() => { if (g.race.racers[0].finished || performance.now() - t0 > 200000) { clearInterval(iv); res() } }, 250) })
      } else if (s.kind === 'free') {
        g.free(); g.force({ steer: 0.12, boost: true, burner: true, brake: false, strafe: 0, dodgeL: false, dodgeR: false })
        window.__rec = true
        await new Promise((r) => setTimeout(r, s.secs * 500))
        g.force(null); g.fly(); g.flyForce(true)
        Object.assign(g.fc, { pitch: 0.3, turn: 0.25, roll: 0, throttle: true, brake: false, burner: true, aim: null })
        const iv = setInterval(() => { const k = (performance.now() - t0) / 1000; Object.assign(g.fc, { pitch: g.flight.agl > 4000 ? -0.4 : g.flight.agl < 600 ? 0.5 : 0.05 * Math.sin(k), turn: 0.4 * Math.sin(k * 0.3) }) }, 200)
        await new Promise((r) => setTimeout(r, s.secs * 500)); clearInterval(iv)
      } else if (s.kind === 'hunt') {
        g.startHunt(); g.autopilot(true); g.autoFire?.(true)
        const iv = setInterval(() => { g.flight.ghost = 5; g.flight.hull = 100 }, 200)
        window.__rec = true
        await new Promise((r) => setTimeout(r, s.secs * 1000)); clearInterval(iv)
      } else if (s.kind === 'orbit') {
        g.system(); g.flyForce(true)
        // (Braked and turning: full burn flies into a planet in ~10 s — that is the 'arrive' scenario.)
        Object.assign(g.fc, { pitch: 0.1, turn: 0.35, roll: 0, throttle: false, brake: true, burner: false, aim: null })
        window.__rec = true
        await new Promise((r) => setTimeout(r, s.secs * 1000))
      } else if (s.kind === 'arrive') {
        // Orbit → a planet: the live handover into another instance. Timed by a loop of the top page's own
        // (it outlives this instance, and shares the main thread with the one booting).
        window.__f = []
        const own = []
        const loop = (t) => { own.push([t, 0, g.stats ? +g.stats().mach : 0]); if (performance.now() - t0 < s.secs * 1000) requestAnimationFrame(loop) }
        g.system(); g.flyForce(true)
        Object.assign(g.fc, { pitch: 0, turn: 0, roll: 0, throttle: true, brake: false, burner: true, aim: null })
        requestAnimationFrame(loop)
        await new Promise((r) => setTimeout(r, s.secs * 1000 + 100))
        window.__f = own
      }
      window.__rec = false
      const f = window.__f
      return { f: f.map((x) => [x[0] - f[0][0], x[1], x[2]]) }
    }, s)
    const f = r.f, gaps = []
    for (let i = 1; i < f.length; i++) gaps.push([f[i][0] - f[i - 1][0], f[i][1], f[i][0], f[i][2]])
    const gs = gaps.map((x) => x[0]).sort((a, b) => a - b), js = gaps.map((x) => x[1]).sort((a, b) => a - b)
    const dur = f.length ? f[f.length - 1][0] / 1000 : 0
    const mean = gs.reduce((a, b) => a + b, 0) / Math.max(1, gs.length)
    results[s.id] = {
      secs: +dur.toFixed(1), frames: gs.length, avg: +(1000 / mean).toFixed(1), low1: +(1000 / pct(gs, 0.99)).toFixed(1), low01: +(1000 / pct(gs, 0.999)).toFixed(1),
      max: +gs[gs.length - 1].toFixed(1), over25: gaps.filter((x) => x[0] > 25).length, over50: gaps.filter((x) => x[0] > 50).length,
      js50: +pct(js, 0.5).toFixed(2), js99: +pct(js, 0.99).toFixed(2), js999: +pct(js, 0.999).toFixed(2),
      worst: gaps.sort((a, b) => b[0] - a[0]).slice(0, 10).map(([g, j, t, m]) => `${g.toFixed(0)}ms js${j.toFixed(0)} @${(t / 1000).toFixed(1)}s M${(+m).toFixed(1)}`),
      errors: errs.slice(0, 3),
    }
  } catch (e) { results[s.id] = { error: String(e).slice(0, 300), errors: errs.slice(0, 3) } }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1))
  const x = results[s.id]
  console.log(x.error ? `${s.id}: ERROR ${x.error}` : `${s.id.padEnd(20)} ${String(x.secs).padStart(6)}s  avg ${x.avg}  1% ${x.low1}  0.1% ${x.low01}  max ${x.max}ms  >25ms ${x.over25}  >50ms ${x.over50}  js p50/p99/p99.9 ${x.js50}/${x.js99}/${x.js999}${x.errors.length ? '  ERR ' + x.errors[0] : ''}`)
  await ctx.close()
}
await b.close()
