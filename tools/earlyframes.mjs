// The race's first seconds frame by frame: slow frames, and what each uploaded or compiled (new geometries,
// textures, shader programs — with the new program's key).  node tools/earlyframes.mjs 4495 sprint
import { chromium } from 'playwright-core'
const port = process.argv[2] ?? '4495', c = process.argv[3] ?? 'sprint'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })).newPage()
await p.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window); window.__log = []; let last = 0
  window.requestAnimationFrame = (cb) => raf((t) => { const g = window.__g; const m0 = g?.renderer?.info?.memory; const a0 = m0 ? [m0.geometries, m0.textures, g.renderer.info.programs.length] : [0, 0, 0]
    const a = performance.now(); cb(t); const js = performance.now() - a
    const m = g?.renderer?.info?.memory; const a1 = m ? [m.geometries, m.textures, g.renderer.info.programs.length] : [0, 0, 0]
    if (a1[2] > a0[2]) { const pr = g.renderer.info.programs[g.renderer.info.programs.length - 1]; window.__newprog = (window.__newprog ?? []).concat([pr.name + ' | ' + pr.cacheKey.replace(/\s+/g, ' ').slice(0, 400)]) }
    if (window.__rec) window.__log.push([t - window.__rec, t - last, js, a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2], g?.stats ? (() => { const st = g.stats(); return `M${st.mach} ${st.crashing ? 'CRASH ' : ''}${st.burning ? 'burn ' : ''}part${st.particles} bar:${g.player.barrier}` })() : '']); last = t })
})
await p.goto(`http://localhost:${port}/?course=${c}&q=high&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(() => { const f = document.querySelector('#g-fps'); f.value = 'max'; f.dispatchEvent(new Event('change')) })
await p.waitForTimeout(1500)
await p.evaluate(() => { window.__rec = performance.now(); const g = window.__g; g.start(); g.skipCountdown(); g.autopilot(true) })
await p.waitForTimeout(+(process.env.S ?? 4) * 1000)
console.log(await p.evaluate(() => window.__newprog)); console.log((await p.evaluate(() => window.__log.filter((x) => x[1] > 25 || x[3] || x[4] || x[5]).map((x) => `${(x[0] / 1000).toFixed(2)}s gap ${x[1].toFixed(0)} js ${x[2].toFixed(1)} +geo ${x[3]} +tex ${x[4]} +prog ${x[5]} ${x[6]}`))).join('\n'))
await b.close()
