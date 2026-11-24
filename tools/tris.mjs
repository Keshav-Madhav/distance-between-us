// Triangles a frame, by owner (main pass and shadow passes), at a fixed race moment.  node tools/tris.mjs 4495 sprint  (Q=low…)
import { chromium } from 'playwright-core'
const port = process.argv[2] ?? '4495', c = process.argv[3] ?? 'sprint', Q = process.env.Q ?? 'high'
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
await p.goto(`http://localhost:${port}/?course=${c}&q=${Q}&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(async () => { const g = window.__g; g.start(); g.skipCountdown(); g.autopilot(true); g.hold(true); g.fastSim(8); g.snapCam(); g.hold(false); await new Promise((r) => setTimeout(r, 2500)); g.hold(true) })
console.log(await p.evaluate(() => {
  const g = window.__g, r = g.renderer, by = {}
  const owner = (o) => {
    for (let a = o; a; a = a.parent) {
      if (a === g.scatter.group) return 'scatter:' + (o.name || '')
      if (a === g.course.group) return 'course'
      if (a.parent === g.world.group) { const i = g.world.group.children.indexOf(a); return i <= 4 ? 'terrain/sky#' + i : 'world#' + i + (o.name ? ':' + o.name : '') }
      if (a.parent === g.scene && a.type === 'Group' && a.children[0]?.children?.length > 3 && a !== g.world.group) return 'ship'
    }
    return 'other:' + o.type
  }
  const orig = r.renderBufferDirect.bind(r)
  r.renderBufferDirect = (cam, scene, geo, mat, obj, grp) => {
    const idx = geo.index ? geo.index.count : geo.attributes.position.count
    const inst = obj.isInstancedMesh ? obj.count : geo.isInstancedBufferGeometry ? geo.instanceCount : 1
    const draw = geo.drawRange.count === Infinity ? idx : Math.min(idx, geo.drawRange.count)
    const t = (draw / 3) * inst
    const k = (cam.isOrthographicCamera ? 'SH ' : '') + owner(obj)
    const e = (by[k] ??= { t: 0, calls: 0 }); e.t += t; e.calls++
    return orig(cam, scene, geo, mat, obj, grp) }
  // (Two frames, halved: the far shadow map is redrawn every other frame.)
  const df = g.drawFrame ?? (() => { g.sunShadow?.update?.(r, g.scene, g.camera.position, new g.camera.position.constructor(0, 0, -1)); g.draw() })
  df(); df(); r.renderBufferDirect = orig
  for (const v of Object.values(by)) { v.t /= 2; v.calls /= 2 }
  const tot = Object.values(by).reduce((a, b) => a + b.t, 0)
  return `total ${(tot / 1e6).toFixed(2)}M tris\n` + Object.entries(by).sort((a, b) => b[1].t - a[1].t).slice(0, 30).map(([k, v]) => `${(v.t / 1e3).toFixed(0).padStart(6)}k ${String(v.calls).padStart(3)}c  ${k}`).join('\n')
}))
await b.close()
