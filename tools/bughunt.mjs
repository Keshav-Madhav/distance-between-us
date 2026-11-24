// Bug hunt: every course and mode driven end to end; fails on any page error, console error, unhandled
// rejection, NaN/non-finite state or a stuck flow — in the top page and every world frame.
//   node tools/bughunt.mjs 4495            (ONLY=boot,race,modes,ghost,hunt,free,orbit,switch,settings)
import { chromium } from 'playwright-core'
import { calm } from './loadguard.mjs'
const port = process.argv[2] ?? '4495', BASE = `http://localhost:${port}/`
const ONLY = process.env.ONLY?.split(',')
const COURSES = ['sprint', 'dry-river', 'drag', 'circuit', 'oval', 'canyon', 'frostline', 'icefall', 'whiteout', 'icecave', 'caldera', 'faultline', 'obsidian', 'magma', 'greenway', 'riverrun', 'timberline', 'whitewater', 'mistriver', 'understory']
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
const fails = [], passes = []
const IGNORE = [/GPU stall due to ReadPixels/, /Autoplay/, /AudioContext was not allowed/, /favicon/]
async function page(path) {
  await calm()
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } })
  const p = await ctx.newPage()
  await p.addInitScript(() => {
    window.__errs = []
    addEventListener('error', (e) => window.__errs.push('error: ' + (e.message || e.error?.message)))
    addEventListener('unhandledrejection', (e) => window.__errs.push('rejection: ' + (e.reason?.message ?? e.reason)))
    const ce = console.error.bind(console), cw = console.warn.bind(console)
    console.error = (...a) => { window.__errs.push('console.error: ' + a.map(String).join(' ').slice(0, 200)); ce(...a) }
    console.warn = (...a) => { const s = a.map(String).join(' '); if (/NaN|Infinity/.test(s)) window.__errs.push('warn: ' + s.slice(0, 200)); cw(...a) }
  })
  const top = []
  p.on('pageerror', (e) => top.push('pageerror: ' + e.message))
  await p.goto(BASE + path)
  try { await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 90000 }) }
  catch (e) {
    const inPage = await p.evaluate(() => (window.__errs ?? []).concat([`webgl: ${(() => { try { return !!document.createElement('canvas').getContext('webgl2') } catch { return 'threw' } })()}`])).catch(() => ['(page unreachable)'])
    await ctx.close().catch(() => {})
    throw new Error('never ready — ' + [...top, ...inPage].slice(0, 4).join(' | '))
  }
  const errors = async () => {
    const all = [...top]
    for (const f of p.frames()) { try { all.push(...(await f.evaluate(() => window.__errs ?? []))) } catch { /* detached */ } }
    return all.filter((e) => !IGNORE.some((r) => r.test(e)))
  }
  return { ctx, p, errors }
}
async function scenario(name, fn) {
  if (ONLY && !ONLY.some((o) => name.startsWith(o))) return
  let pg
  try {
    pg = await fn()
    const errs = pg ? await pg.errors() : []
    if (errs.length) { fails.push(`${name}: ${[...new Set(errs)].slice(0, 4).join(' | ')}`); console.log('FAIL', name, errs.slice(0, 3)) }
    else { passes.push(name); console.log('ok  ', name, pg?.note ?? '') }
  } catch (e) {
    let extra = ''
    try { extra = pg ? (await pg.errors()).slice(0, 2).join(' | ') : '' } catch { /* gone */ }
    fails.push(`${name}: ${String(e.message ?? e).split('\n')[0].slice(0, 200)} ${extra}`); console.log('FAIL', name, String(e.message ?? e).split('\n')[0].slice(0, 200), extra)
  } finally { await pg?.ctx?.close().catch(() => {}) }
}
const finite = (v) => Number.isFinite(v)
// A race to the finish at sim speed (hold + fastSim), then real frames for the results.
const raceToEnd = (p, opts = {}) => p.evaluate(async (o) => {
  const g = window.__g
  if (o.level !== undefined) g.race.aiBoost = o.level
  if (o.sub) g.race.setMode(o.sub)
  g.start(); g.skipCountdown(); g.autopilot(true)
  await new Promise((r) => setTimeout(r, 1500))
  g.hold(true)
  let t = 0
  while (t < 600 && !g.race.racers[0].finished) { g.fastSim(4); t += 4; await new Promise((r) => setTimeout(r, 0)) }
  g.hold(false)
  // (The results come up after the finish sequence: up to 30 s.)
  for (let i = 0; i < 300 && document.querySelector('#over').classList.contains('hide'); i++) await new Promise((r) => setTimeout(r, 100))
  const me = g.race.racers[0], pos = g.player.pos
  return { finished: me.finished, time: me.finishTime, place: me.place, finite: [pos.x, pos.y, pos.z, me.finishTime].every(Number.isFinite),
    others: g.race.racers.filter((r) => r.finished).map((r) => r.finishTime).every(Number.isFinite),
    results: !document.querySelector('#over').classList.contains('hide'), mode: g.mode }
}, opts)
function check(r, what) { if (!r.finished) throw new Error(`${what}: did not finish`); if (!r.finite || !r.others) throw new Error(`${what}: non-finite state ${JSON.stringify(r)}`); if (!r.results) throw new Error(`${what}: no results screen`) }

// 1. Boot every course (and ORBIT), a few real frames.
for (const c of [...COURSES, 'orbit']) await scenario(`boot:${c}`, async () => {
  const pg = await page(`?course=${c}&fixed=1`)
  await pg.p.waitForTimeout(1200)
  const s = await pg.p.evaluate(() => window.__g.stats())
  if (!(s.fps > 0)) throw new Error('no frames drawn')
  return pg
})
// 2. Race every course to the finish.
for (const c of COURSES) await scenario(`race:${c}`, async () => {
  const pg = await page(`?course=${c}&fixed=1`)
  const r = await raceToEnd(pg.p); check(r, c); pg.note = `P${r.place} ${r.time.toFixed(2)} s`
  return pg
})
// 3. Sub-modes and rival levels.
for (const [c, o] of [['oval', { sub: 'trial' }], ['canyon', { sub: 'duel' }], ['sprint', { level: -0.7 }], ['caldera', { level: 4.5 }], ['greenway', { level: 4.5, sub: 'duel' }]]) await scenario(`modes:${c}:${JSON.stringify(o)}`, async () => {
  const pg = await page(`?course=${c}&fixed=1`)
  const r = await raceToEnd(pg.p, o); check(r, c); pg.note = `P${r.place} ${r.time.toFixed(2)} s`
  return pg
})
// 4. Ghost: race, reload, race again with it (real time, then sim) — finite, drawn, no errors; replay too.
await scenario('ghost:whitewater', async () => {
  const pg = await page(`?course=whitewater&fixed=1`)
  check(await raceToEnd(pg.p), 'ghost run 1')
  await pg.p.reload(); await pg.p.waitForFunction('window.__g && window.__g.ready'); await pg.p.waitForTimeout(800)
  const n = await pg.p.evaluate(async () => {
    const g = window.__g; g.start(); g.skipCountdown(); g.autopilot(true)
    let shown = 0, bad = 0
    for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 100)); for (const o of g.scene.children) if (o.visible && o.children[0]?.children?.some((m) => m.material?.opacity === 0.3)) { shown++; if (!Number.isFinite(o.position.x + o.position.y + o.position.z)) bad++ } }
    return { shown, bad }
  })
  if (!n.shown) throw new Error('ghost never drawn'); if (n.bad) throw new Error('ghost at non-finite positions')
  const r = await raceToEnd(pg.p); check(r, 'ghost run 2')
  const rp = await pg.p.evaluate(async () => { const g = window.__g; if (!g.replayBest()) return 'no inputs'; g.hold(true); let t = 0; while (t < 300 && !g.race.racers[0].finished) { g.fastSim(4); t += 4; await new Promise((r) => setTimeout(r, 0)) } g.hold(false); return g.race.racers[0].finished ? 'ok' : 'replay did not finish' })
  if (rp !== 'ok') throw new Error('replay: ' + rp)
  pg.note = `ghost drawn ${n.shown} samples`
  return pg
})
// 5. HUNT, a minute, god mode.
await scenario('hunt', async () => {
  const pg = await page(`?course=sprint&fixed=1`)
  const r = await pg.p.evaluate(async () => {
    const g = window.__g; g.startHunt(); g.autopilot(true); g.autoFire?.(true)
    const iv = setInterval(() => { g.flight.ghost = 5; g.flight.hull = 100 }, 200)
    await new Promise((r) => setTimeout(r, 60000)); clearInterval(iv)
    const p = g.flight.pos; return { mode: g.mode, finite: [p.x, p.y, p.z].every(Number.isFinite) }
  })
  if (!r.finite) throw new Error('non-finite flight state'); return pg
})
// 6. Free roam: drive, take off, fly, climb out to ORBIT (a live handover to another frame), fly there.
await scenario('free:climb-to-orbit', async () => {
  const pg = await page(`?course=sprint&fixed=1`)
  await pg.p.evaluate(() => { const g = window.__g; g.free(); g.force({ steer: 0.1, boost: true, burner: true, brake: false, strafe: 0, dodgeL: false, dodgeR: false }) })
  await pg.p.waitForTimeout(6000)
  await pg.p.evaluate(() => { const g = window.__g; g.force(null); g.fly(); g.flyForce(true); Object.assign(g.fc, { aim: null, pitch: 0.8, turn: 0, roll: 0, burner: true, throttle: true, brake: false }); const iv = setInterval(() => { if (g.flight.fwd.y > 0.75) { g.fc.pitch = 0; clearInterval(iv) } }, 50) })
  // Up to the handover into ORBIT (a new frame), then fly there.
  let ok = false
  for (let i = 0; i < 90 && !ok; i++) { await pg.p.waitForTimeout(1000); ok = await pg.p.evaluate(() => [...document.querySelectorAll('iframe')].some((f) => f.style.opacity === '1' && new URL(f.src).searchParams.get('course') === 'orbit')) }
  if (!ok) throw new Error('never reached orbit')
  await pg.p.waitForTimeout(5000)
  pg.note = 'reached orbit'
  return pg
})
// 7. ORBIT: fly into a planet (live handover) and keep flying there.
await scenario('orbit:arrive', async () => {
  const pg = await page(`?course=orbit&fixed=1`)
  await pg.p.evaluate(() => { const g = window.__g; g.system(); g.flyForce(true); Object.assign(g.fc, { pitch: 0, turn: 0, roll: 0, throttle: true, brake: false, burner: true, aim: null }) })
  let landed = null
  for (let i = 0; i < 60 && !landed; i++) { await pg.p.waitForTimeout(1000); landed = await pg.p.evaluate(() => { const f = [...document.querySelectorAll('iframe')].find((f) => f.style.opacity === '1'); return f ? new URL(f.src).searchParams.get('course') : null }) }
  if (!landed || landed === 'orbit') throw new Error('never arrived on a planet')
  await pg.p.waitForTimeout(6000)
  const st = await pg.p.evaluate(() => { const f = [...document.querySelectorAll('iframe')].find((f) => f.style.opacity === '1'); const g = f.contentWindow.__g; const p = g.flight.pos; return { mode: g.mode, finite: [p.x, p.y, p.z].every(Number.isFinite) } })
  if (!st.finite) throw new Error('non-finite after arrival')
  pg.note = `arrived on ${landed}, mode ${st.mode}`
  return pg
})
// 8. World switches as a player makes them: start a race elsewhere, finish, NEXT COURSE, back to a slept world.
await scenario('switch:chain', async () => {
  const pg = await page(`?course=sprint`)
  const vis = () => pg.p.evaluate(() => { const fs = [...document.querySelectorAll('iframe')].filter((f) => f.style.opacity === '1').sort((a, b) => +b.style.zIndex - +a.style.zIndex); return fs[0] ? { id: new URL(fs[0].src).searchParams.get('course'), w: fs[0].contentWindow } && new URL(fs[0].src).searchParams.get('course') : new URL(location.href).searchParams.get('course') })
  const call = (js, arg) => pg.p.evaluate(([js, arg]) => { const fs = [...document.querySelectorAll('iframe')].filter((f) => f.style.opacity === '1').sort((a, b) => +b.style.zIndex - +a.style.zIndex); const w = fs[0]?.contentWindow ?? window; return new Function('g', 'arg', 'document', js)(w.__g, arg, w.document) }, [js, arg]) // (its own document: the top page's is a retired instance)
  const waitOn = async (id) => { for (let i = 0; i < 300; i++) { if ((await vis()) === id) return; await pg.p.waitForTimeout(100) } throw new Error('switch to ' + id + ' never showed') }
  for (const [id, go] of [['greenway', true], ['timberline', false], ['sprint', false], ['caldera', true]]) {
    await call('g.swap(arg[0], arg[1])', [id, go]); await waitOn(id); await pg.p.waitForTimeout(2500)
    const st = await call('return { mode: g.mode, race: g.race.state }')
    if (go && st.mode !== 'race') throw new Error(`${id}: asked to race, mode ${st.mode}`)
  }
  // Finish CALDERA (sim speed) then NEXT COURSE (pre-booted behind the results).
  await call(`return (async () => { g.skipCountdown(); g.autopilot(true); await new Promise((r) => setTimeout(r, 800)); g.hold(true); let t = 0; while (t < 600 && !g.race.racers[0].finished) { g.fastSim(4); t += 4; await new Promise((r) => setTimeout(r, 0)) } g.hold(false) })()`)
  await pg.p.waitForTimeout(3500)
  await call('document.querySelector("#b-next").click()')
  await waitOn('faultline'); await pg.p.waitForTimeout(2500)
  const st = await call('return { mode: g.mode }')
  if (st.mode !== 'race') throw new Error('NEXT COURSE did not start a race: ' + st.mode)
  pg.note = 'greenway → timberline → sprint (slept) → caldera → NEXT faultline'
  return pg
})
// 9. Settings live, mid-race: every quality tier, shadows, ghost, rivals, frame rate, resize, pause, back to title.
await scenario('settings:live', async () => {
  const pg = await page(`?course=frostline`)
  await pg.p.evaluate(async () => {
    const g = window.__g; g.start(); g.skipCountdown(); g.autopilot(true)
    const set = (id, v) => { const e = document.querySelector(id); if (!e) return; if (e.type === 'checkbox') e.checked = v; else e.value = v; e.dispatchEvent(new Event('change')); e.dispatchEvent(new Event('input')) }
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    for (const q of ['low', 'medium', 'high', 'ultra', 'auto']) { set('#q', q); await wait(1200) }
    for (const f of ['60', '120', 'max', 'auto']) { set('#g-fps', f); await wait(500) }
    set('#shadows', false); await wait(800); set('#shadows', true)
    set('#ghoston', false); await wait(500); set('#ghoston', true)
    for (const r of ['-0.7', '2.2', '4.5', '0']) { document.querySelector(`#rivalpick button[data-v="${r}"]`).click(); if (g.race.aiBoost !== +r) throw new Error('rivals button did not set ' + r); await wait(400) }
    dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' })); await wait(600)
    dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' })); await wait(600)
  })
  for (const [w, h] of [[800, 600], [1920, 1080], [1280, 720]]) { await pg.p.setViewportSize({ width: w, height: h }); await pg.p.waitForTimeout(700) }
  const s = await pg.p.evaluate(() => { const g = window.__g, p = g.player.pos; return { fps: g.stats().fps, finite: [p.x, p.y, p.z].every(Number.isFinite) } })
  if (!s.finite) throw new Error('non-finite after settings'); if (!(s.fps > 0)) throw new Error('stopped drawing')
  return pg
})
console.log(`\n${passes.length} passed, ${fails.length} failed`)
for (const f of fails) console.log('  ✗', f)
await b.close()
