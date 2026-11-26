// Is STEERING ASSIST useful? Simulated keyboard players — digital A/D with the game's keyboard steer ramp,
// a reaction delay, a look-ahead, throttle held, the burner on straights (held >= 6 steps) — race courses at
// every assist level (time trial, deterministic sim). Per run: finish time, crashes, spin-outs.
//   node tools/assiststudy.mjs 4417 sprint,canyon,…
import { chromium } from 'playwright-core'
const port = process.argv[2] ?? '4417', courses = (process.argv[3] ?? 'sprint,canyon,icefall,greenway,oval,circuit,mistriver').split(',')
const BASE = { novice: { react: 12, look: 0.55, dead: 0.06 }, average: { react: 8, look: 0.75, dead: 0.045 }, good: { react: 5, look: 0.95, dead: 0.03 } }
// Three drivers per skill (look-ahead and reaction varied a little): one run of a chaotic sim decides nothing.
const SKILLS = {}
for (const [k, v] of Object.entries(BASE)) for (const [m, dr] of [[0.85, 1], [1, 0], [1.15, -1]]) SKILLS[`${k}${m}`] = { ...v, look: v.look * m, react: v.react + dr, skill: k }
const ASSISTS = [0, 0.35, 0.6, 0.85]
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const rows = []
for (const c of courses) {
  const p = await (await b.newContext({ viewport: { width: 320, height: 180 } })).newPage()
  await p.addInitScript(() => localStorage.setItem('dbu-sub', 'trial'))
  await p.goto(`http://localhost:${port}/?course=${c}&fixed=1`)
  await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 180000 })
  for (const [skill, S] of Object.entries(SKILLS)) for (const A of ASSISTS) {
    const r = await p.evaluate(async ([S, A]) => {
      const g = window.__g, P = g.player, c = g.course, STEP = 1 / 60
      g.start(); g.hold(true); g.skipCountdown(); g.autopilot(false)
      P.assist = A
      const me = g.race.racers[0]
      const ctl = { steer: 0, strafe: 0, boost: true, burner: false, brake: false }
      g.force(ctl)
      let tPen = null, key = 0, steerS = 0, burn = false, hold = 0, crashes = 0, spins = 0, wasC = false, wasS = false, st = 0
      while (!me.finished && st < 60 * 150) {
        if (st % S.react === 0) {
          // where the course goes, look-ahead seconds ahead at this speed
          const ahead = Math.max(8, Math.round(Math.max(P.speed, 200) * S.look / 40)), i = Math.min(c.n - 2, me.idx + ahead)
          let e = Math.atan2(c.px[i] - P.pos.x, c.pz[i] - P.pos.z) - P.heading
          while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI
          key = e < -S.dead ? 1 : e > S.dead ? -1 : 0
          // burner on when the road ahead is straight enough (a player lifts for a bend)
          const j = Math.min(c.n - 2, me.idx + ahead * 2)
          let e2 = Math.atan2(c.px[j] - P.pos.x, c.pz[j] - P.pos.z) - P.heading
          while (e2 > Math.PI) e2 -= 2 * Math.PI; while (e2 < -Math.PI) e2 += 2 * Math.PI
          const want = Math.abs(e) < 0.04 && Math.abs(e2) < 0.08
          if (want !== burn && hold >= 6) { burn = want; hold = 0 }
        }
        // the game's keyboard ramp (src/input.ts): toward the key at 3.6/s, back or across at 9/s
        const rate = key === 0 || Math.sign(key) !== Math.sign(steerS) ? 9 : 3.6
        steerS += Math.max(-rate * STEP, Math.min(rate * STEP, key - steerS))
        ctl.steer = steerS; ctl.burner = burn; hold++
        g.fastSim(STEP); st++
        if (P.crashing && !wasC) crashes++; wasC = P.crashing
        if (P.spin > 0 && !wasS) spins++; wasS = P.spin > 0
        if (tPen === null && me.passed >= g.race.K - 1) { tPen = g.race.clock; break }
        if (st % 600 === 0) await new Promise((r) => setTimeout(r, 0))
      }
      g.force(null)
      return { fin: tPen === null ? null : +tPen.toFixed(2), crashes, spins }
    }, [S, A])
    rows.push({ course: c, skill: S.skill, driver: skill, assist: A, ...r })
    
  }
  await p.context().close()
}
await b.close()
// summary: per skill and assist, over every course and driver
console.log('skill    assist  reached-last-gate  mean time (runs all 4 assists reached)  crashes  spins')
for (const skill of Object.keys(BASE)) {
  const keys = [...new Set(rows.filter((r) => r.skill === skill).map((r) => r.course + '|' + r.driver))]
  const fair = keys.filter((k) => ASSISTS.every((A) => rows.find((r) => r.course + '|' + r.driver === k && r.assist === A)?.fin))
  for (const A of ASSISTS) {
    const rs = rows.filter((r) => r.skill === skill && r.assist === A)
    const t = fair.reduce((s, k) => s + rows.find((r) => r.course + '|' + r.driver === k && r.assist === A).fin, 0) / Math.max(1, fair.length)
    console.log(skill.padEnd(8), String(A).padEnd(7), `${rs.filter((r) => r.fin).length}/${rs.length}`.padEnd(18), `${t.toFixed(2)} s over ${fair.length}`.padEnd(40), String(rs.reduce((s, r) => s + r.crashes, 0)).padEnd(8), rs.reduce((s, r) => s + r.spins, 0))
  }
}
import('node:fs').then((fs) => fs.writeFileSync('tools/optruns/assiststudy.json', JSON.stringify(rows)))
