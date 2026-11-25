// The minimum-curvature racing line: within the track (±BOUND m of the centreline, less a margin for the
// craft's lag), the smoothest path — an elastic band pulled tight: every point moved toward the midpoint of
// its neighbours along the track's normal, clamped to the edges, until it settles. (The smoother the path,
// the less the craft turns, and turning is what costs speed: 5% a radian, and the burner needs a straight.)
// Then the plain driver (tools/pdcore.js) flies it: time, how far it strays, gates missed.
// Writes tools/optruns/<course>-mincurv.json ({lane, i0, SEG} — the driver's `line`).
//   node tools/mincurv.mjs 4491 greenway        (BOUND=260 MARGIN=60 SEG=4)
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const port = process.argv[2] ?? '4491', course = process.argv[3] ?? 'greenway'
const BOUND = +(process.env.BOUND ?? 260), MARGINS = (process.env.MARGIN ?? '60').split(',').map(Number), SEG = +(process.env.SEG ?? 4)
const craft = JSON.parse(fs.readFileSync('tools/optruns/craft-model.json', 'utf8'))
const opts = { look: 1.2, margin: 34, reach: 3, burnK: 1.2, burnErr: 0.1, latV: 150, airAlign: true, sweep: true, strafeK: 20, slow: true, brakeAt: 0.35, tapNear: 35, tapFar: 70, ...(process.env.ROGUE ? {} : { bound: BOUND }) }
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 320, height: 180 } })).newPage()
await p.goto(`http://localhost:${port}/?course=${course}&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { localStorage.setItem('dbu-sub', 'trial'); document.querySelector('#submodes button[data-sub=trial]').click() })
await p.addScriptTag({ content: fs.readFileSync('tools/pdcore.js', 'utf8') })
const results = []
for (const MARGIN of MARGINS) {
  const r = await p.evaluate(async ([craft, opts, BOUND, MARGIN, SEG]) => {
    const g = window.__g, c = g.course, STEP = 1 / 60
    const i0 = Math.max(0, c.startI - 20), i1 = Math.min(c.n - 1, c.finishI + 20), K = Math.floor((i1 - i0) / SEG) + 1
    const cx = [], cz = [], nx = [], nz = [], lat = new Float64Array(K), lim = BOUND - MARGIN
    for (let k = 0; k < K; k++) { const i = i0 + k * SEG, [tx, tz] = c.tangent(i); cx.push(c.px[i]); cz.push(c.pz[i]); nx.push(-tz); nz.push(tx) }
    // The finish gate is always flown through: the line is pinned inside it there (and at the start).
    const pin = {}
    for (const gi of [c.cps[0].i, c.cps[c.cps.length - 1].i]) for (let k = Math.round((gi - i0) / SEG) - 3; k <= Math.round((gi - i0) / SEG) + 3; k++) if (k >= 0 && k < K) pin[k] = Math.min(lim, c.gateHalf - 80)
    const X = (k) => cx[k] + nx[k] * lat[k], Z = (k) => cz[k] + nz[k] * lat[k]
    // Elastic band, then a few passes of a wider (curvature-of-curvature) smoothing so the turn-in is gradual.
    for (let it = 0; it < 6000; it++) {
      let moved = 0
      for (let k = 1; k < K - 1; k++) {
        const mx = (X(k - 1) + X(k + 1)) / 2, mz = (Z(k - 1) + Z(k + 1)) / 2
        const d = (mx - X(k)) * nx[k] + (mz - Z(k)) * nz[k]
        const L = pin[k] ?? lim, v = Math.max(-L, Math.min(L, lat[k] + d * 0.9)); moved += Math.abs(v - lat[k]); lat[k] = v
      }
      if (moved < 1e-3 * K) break
    }
    const line = { lane: Array.from(lat, (v) => Math.round(v * 10) / 10), i0, SEG }
    const s0 = g.snap()
    const pd = window.makePD(line, craft, opts), me = pd.me, P = pd.P
    let n = 0, out = 0
    const m0 = g.snap().missedCount
    while (!me.finished && n < 60 * 300) {
      pd.control({}); g.fastSim(STEP); n++
      const i = me.idx, [tx, tz] = c.tangent(i); out = Math.max(out, Math.abs((P.pos.x - c.px[i]) * -tz + (P.pos.z - c.pz[i]) * tx) - BOUND)
      if (n % 900 === 0) await new Promise((r) => setTimeout(r, 0))
    }
    const res = { margin: MARGIN, time: me.finished ? +me.finishTime.toFixed(3) : null, maxOut: Math.round(out), missed: g.snap().missedCount - m0, crashes: pd.state().crashes, line }
    g.restore(s0)
    return res
  }, [craft, opts, BOUND, MARGIN, SEG])
  console.log(`${course} min-curvature line, bound ${BOUND}, margin ${MARGIN}: plain driver ${r.time} s, strays ${r.maxOut} m, missed ${r.missed}, crashes ${r.crashes}`)
  results.push(r)
}
const ok = results.filter((r) => r.time && (process.env.ROGUE || r.missed === 0)).sort((a, b) => (process.env.ROGUE ? 0 : (a.maxOut <= 10 ? 0 : 1) - (b.maxOut <= 10 ? 0 : 1)) || a.time - b.time)
if (ok[0]) fs.writeFileSync(`tools/optruns/${course}-mincurv${process.env.OUTTAG ? '-' + process.env.OUTTAG : ''}.json`, JSON.stringify({ course, bound: BOUND, margin: ok[0].margin, time: ok[0].time, maxOut: ok[0].maxOut, ...ok[0].line }))
await b.close()
