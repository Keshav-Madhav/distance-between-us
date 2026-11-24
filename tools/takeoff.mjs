// Free roam: driving, then taking off — every slow frame around the takeoff, with what it compiled or
// uploaded.  node tools/takeoff.mjs 4495 mistriver
import { chromium } from 'playwright-core'
import { calm } from './loadguard.mjs'
const port = process.argv[2] ?? '4495', c = process.argv[3] ?? 'mistriver'
await calm()
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })).newPage()
await p.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window); window.__log = []; window.__np = []; let last = 0
  window.requestAnimationFrame = (cb) => raf((t) => { const g = window.__g; const r = g?.renderer; const n0 = r ? r.info.programs.length : 0, m0 = r ? r.info.memory.geometries : 0
    const a = performance.now(); cb(t); const js = performance.now() - a
    if (r && r.info.programs.length > n0) for (const pr of r.info.programs.slice(n0)) window.__np.push(((t - window.__rec) / 1000).toFixed(2) + 's ' + pr.cacheKey.replace(/\s+/g, ' ').slice(0, 160))
    if (window.__rec && (t - last > 25 || js > 20)) window.__log.push(`${((t - window.__rec) / 1000).toFixed(2)}s gap ${(t - last).toFixed(0)} js ${js.toFixed(0)} +geo ${r ? r.info.memory.geometries - m0 : 0} mode ${g?.mode} air ${g?.freeAir}`); last = t })
})
await p.goto(`http://localhost:${port}/?course=${c}&q=high&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { const f = document.querySelector('#g-fps'); f.value = 'max'; f.dispatchEvent(new Event('change')) })
await p.waitForTimeout(1500)
await p.evaluate(() => { const g = window.__g; window.__rec = performance.now(); g.free(); g.force({ steer: 0.12, boost: true, burner: true, brake: false, strafe: 0, dodgeL: false, dodgeR: false }) })
await p.waitForTimeout(5000)
await p.evaluate(() => { const g = window.__g; window.__tko = (performance.now() - window.__rec) / 1000; g.force(null); g.fly(); g.flyForce(true); Object.assign(g.fc, { pitch: 0.3, turn: 0.25, roll: 0, throttle: true, brake: false, burner: true, aim: null }) })
let prof = null
if (process.env.PROF) { const cdp = await p.context().newCDPSession(p); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await p.waitForTimeout(1500); await cdp.send('Profiler.start'); await p.waitForTimeout(3000); prof = (await cdp.send('Profiler.stop')).profile; await p.waitForTimeout(1500) } else await p.waitForTimeout(6000)
if (prof) {
  const byId = new Map(prof.nodes.map((n) => [n.id, n])), parent = new Map(); for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id)
  const name = (n) => (n.callFrame.functionName || '(anon)') + ' :' + n.callFrame.lineNumber
  const incl = new Map()
  for (let i = 0; i < prof.samples.length; i++) { const seen = new Set(); let id = prof.samples[i]; while (id) { const k = name(byId.get(id)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + (prof.timeDeltas[i] || 0)) } id = parent.get(id) } }
  console.log([...incl.entries()].filter(([k]) => !/idle|root|program/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => (v / 1000).toFixed(1) + 'ms ' + k).join('\n'))
}
console.log(await p.evaluate(() => `takeoff at ${window.__tko.toFixed(2)}s\n` + window.__log.join('\n') + '\nNEW PROGRAMS\n' + window.__np.join('\n')))
await b.close()
