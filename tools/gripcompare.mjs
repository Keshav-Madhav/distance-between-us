// Why does the AI hold the forest's bends and the player not? The same race, every racer measured:
// slip angle, time past the grip limit, spins, scrapes, distance off the line — with YOU driven by the
// AI's own brain, either as it steers (analog) or quantised to what a keyboard can send (−1 / 0 / +1).
//   node tools/gripcompare.mjs [course] [seconds] [analog|keys|both]
import { chromium } from 'playwright-core'
const [course = 'timberline', secsArg = '60', which = 'both'] = process.argv.slice(2)
const SECS = +secsArg
async function run(variant) {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
  const p = await (await b.newContext({ viewport: { width: 800, height: 500 } })).newPage()
  await p.goto(`http://localhost:5417/?course=${course}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
  const res = await p.evaluate(([variant, SECS]) => new Promise((done) => {
    const g = window.__g, race = g.race, c = g.course
    // You: driven by race.drive (the AI brain), optionally quantised like keys.
    const drive = race.drive.bind(race)
    race.drive = (r, dt) => {
      drive(r, dt)
      if (r === race.racers[0] && variant === 'keys') {
        const s = r.controls.steer
        r.controls.steer = Math.abs(s) > 0.3 ? Math.sign(s) : 0
      }
      if (r === race.racers[0] && (variant === 'human' || variant === 'human-noburn')) {
        // A player on keys: reacts ~0.2 s late, full lock or nothing, holds W always and Shift except
        // while steering hard (human-noburn: never), brakes only when the brain asks for a lot.
        // Taps: a key held for a share of each 0.2 s window (the share = how much turn is wanted; a tap
        // is at least 50 ms), from what the brain wanted 0.2 s ago.
        const q = (window.__hq ??= [])
        q.push(r.controls.steer)
        const s = q.length > 24 ? q.shift() : 0
        window.__ht = ((window.__ht ?? 0) + dt) % 0.2
        const duty = Math.abs(s) < 0.08 ? 0 : Math.max(0.25, Math.min(1, Math.abs(s)))
        r.controls.steer = window.__ht < duty * 0.2 ? Math.sign(s) : 0
        r.controls.boost = true
        r.controls.burner = variant === 'human' && Math.abs(r.controls.steer) < 0.5 && r.p.mach > 1.5
        r.controls.brake = false
      }
    }
    g.start(); g.skipCountdown(); g.autopilot(true)
    const M = race.racers.map((r) => ({ machSum: 0, machMax: 0, name: r.name, ai: r.ai, n: 0, slipSum: 0, slipMax: 0, over: 0, spinT: 0, scrapes: 0, wasScrape: false, latMax: 0, latOver250: 0, steerAbs: 0, fullLock: 0, sat: 0 }))
    const t0 = performance.now()
    const tick = () => {
      race.racers.forEach((r, i) => {
        const pl = r.p, m = M[i]
        if (pl.dead || pl.crashing || r.finished) return
        m.n++
        m.machSum += pl.mach; m.machMax = Math.max(m.machMax, pl.mach)
        const sd = Math.abs(pl.slip) * 57.3
        m.slipSum += sd; m.slipMax = Math.max(m.slipMax, sd)
        if (pl.gripLoad > 1) m.over++
        if (pl.spin > 0) m.spinT++
        const scr = pl.scrape > 0.4; if (scr && !m.wasScrape) m.scrapes++; m.wasScrape = scr
        const [tx, tz] = c.tangent(r.idx)
        const lat = Math.abs((pl.pos.x - c.px[r.idx]) * -tz + (pl.pos.z - c.pz[r.idx]) * tx)
        m.latMax = Math.max(m.latMax, lat); if (lat > 250) m.latOver250++
        m.steerAbs += Math.abs(r.controls.steer); if (Math.abs(r.controls.steer) > 0.95) m.fullLock++
      })
      if (performance.now() - t0 < SECS * 1000) requestAnimationFrame(tick)
      else done(M.map((m, i) => ({ ...m, prog: race.racers[i].passed, place: race.racers[i].place, assist: race.racers[i].p.assist, slew: race.racers[i].p.slew })))
    }
    requestAnimationFrame(tick)
  }), [variant, SECS])
  await b.close()
  return res
}
const row = (m) => `${(m.ai ? m.name : 'YOU').padEnd(8)} P${String(m.place).padEnd(2)} gates ${String(m.prog).padStart(2)} · slip avg ${(m.slipSum / m.n).toFixed(1).padStart(4)}° max ${m.slipMax.toFixed(0).padStart(3)}° · past grip ${((m.over / m.n) * 100).toFixed(0).padStart(3)}% · spin ${((m.spinT / m.n) * 100).toFixed(1).padStart(4)}% · scrapes ${String(m.scrapes).padStart(2)} · off line >250 m ${((m.latOver250 / m.n) * 100).toFixed(0).padStart(3)}% (max ${m.latMax.toFixed(0)}) · |steer| ${(m.steerAbs / m.n).toFixed(2)} full-lock ${((m.fullLock / m.n) * 100).toFixed(0)}% · Mach avg ${(m.machSum / m.n).toFixed(2)} max ${m.machMax.toFixed(2)} · assist ${m.assist} slew ${m.slew}`
for (const v of which === 'both' ? ['analog', 'keys'] : which.split(',')) {
  const R = await run(v)
  console.log(`\n== ${course}, ${SECS}s — YOU driven by the AI brain, steering ${v}`)
  console.log(row(R[0]))
  const ai = R.filter((m) => m.ai)
  const avg = (f) => ai.reduce((s, m) => s + f(m), 0) / ai.length
  console.log(`AI avg   slip avg ${avg((m) => m.slipSum / m.n).toFixed(1)}° max ${avg((m) => m.slipMax).toFixed(0)}° · past grip ${(avg((m) => m.over / m.n) * 100).toFixed(0)}% · spin ${(avg((m) => m.spinT / m.n) * 100).toFixed(1)}% · scrapes ${avg((m) => m.scrapes).toFixed(1)} · off line >250 m ${(avg((m) => m.latOver250 / m.n) * 100).toFixed(0)}% · |steer| ${avg((m) => m.steerAbs / m.n).toFixed(2)} full-lock ${(avg((m) => m.fullLock / m.n) * 100).toFixed(0)}%`)
}
