// What a frame's drawing pays for: one page, the game loop stopped at a fixed race moment, each feature
// switched off in turn and the frozen frame re-timed (GPU-synced, best of batches, toggled A-B-A).
//   node tools/ablate.mjs 4495 sprint        (Q=low|medium|high  DPR=1  W=1920 H=1080)
import { chromium } from 'playwright-core'
import { calm } from './loadguard.mjs'
const port = process.argv[2] ?? '4495', c = process.argv[3] ?? 'sprint'
const Q = process.env.Q ?? 'high', DPR = +(process.env.DPR ?? 2), W = +(process.env.W ?? 1280), H = +(process.env.H ?? 720)
// SW=1: SwiftShader (Chrome's software GPU) — a stand-in for a weak integrated GPU: its cost follows the
// real vertex and pixel work, with no clock states hiding it. Timed by wall clock with a pixel-read sync.
const SW = !!process.env.SW
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--ignore-gpu-blocklist', ...(SW ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-gl=angle'])] })
await calm()
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR })
const p = await ctx.newPage()
await p.addInitScript((T) => { window.__T = T }, process.env.T ?? '8')
await p.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.__freeze = false; window.requestAnimationFrame = (cb) => window.__freeze ? 0 : raf(cb) })
await p.goto(`http://localhost:${port}/?course=${c}&q=${Q}&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(async () => { const g = window.__g; g.start(); g.skipCountdown(); g.autopilot(true); g.hold(true); g.fastSim(+(window.__T ?? 8)); g.snapCam(); g.hold(false); await new Promise((r) => setTimeout(r, 2500)); g.hold(true); await new Promise((r) => setTimeout(r, 300)); window.__freeze = true })
// GPU time per frame from timer queries (EXT_disjoint_timer_query_webgl2), median of 40 frames after a
// warm-up (the GPU clocks up under load) — CPU noise and clock idling stay out of it.
const meas = () => p.evaluate(([N, R]) => {
  const g = window.__g, gl = g.renderer.getContext(), px = new Uint8Array(4)
  let best = 1e9
  for (let r = 0; r < R; r++) { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t = performance.now(); for (let i = 0; i < N; i++) (g.drawFrame ?? g.draw)(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); best = Math.min(best, (performance.now() - t) / N) }
  return best
}, SW ? [2, 3] : [25, 8])
// Each toggle: [name, js that switches it off and returns a restore function].
const rep = (from, to) => `const m = g.post.final.material, f = m.fragmentShader; if (!f.includes(${JSON.stringify(from)})) throw new Error("no match"); m.fragmentShader = f.split(${JSON.stringify(from)}).join(${JSON.stringify(to)}); m.needsUpdate = true; (g.drawFrame ?? g.draw)(); return () => { m.fragmentShader = f; m.needsUpdate = true; (g.drawFrame ?? g.draw)() }`
const T = process.env.POST ? {
  noJitter: rep('float j = hash(gl_FragCoord.xy + fract(uTime) * 61.0);', 'float j = 0.5;'),
  noBlur: rep('if (amt < 0.0012) {', 'if (true) {'),
  noStreaks: rep('if (uStreak > 0.004) {', 'if (false) {'),
  noSharpen: rep('if (shW > 0.001) {', 'if (false) {'),
  noNanChecks: rep('if (any(isnan(c)) || any(isinf(c))) {', 'if (false) {'),
  noHaze: rep('float haze = (1.0', 'float haze = 0.0 * (1.0'),
  noGrain: rep('c += (hash(gl_FragCoord.xy', 'c += 0.0 * (hash(gl_FragCoord.xy'),
  uniforms: 'return () => {}',
} : {
  shadows: 'const s = g.sunShadow.enabled; g.sunShadow.enabled = false; return () => { g.sunShadow.enabled = s }',
  scatter: 'const v = g.scatter.group.visible; g.scatter.group.visible = false; return () => { g.scatter.group.visible = v }',
  worldStatics: 'const k = g.world.group.children.filter((o, i) => i > 5 && o.visible); k.forEach((o) => o.visible = false); return () => k.forEach((o) => o.visible = true)',
  terrain: 'const k = g.world.group.children.filter((o, i) => i >= 1 && i <= 4 && o.visible); k.forEach((o) => o.visible = false); return () => k.forEach((o) => o.visible = true)',
  sky: 'const o = g.world.group.children[0]; o.visible = false; return () => { o.visible = true }',
  course: 'const o = g.course.group; const v = o.visible; o.visible = false; return () => { o.visible = v }',
  ships: 'const k = g.scene.children.filter((o, i) => i >= 6 && i <= 29 && o.type === "Group" && o.visible); k.forEach((o) => o.visible = false); return () => k.forEach((o) => o.visible = true)',
  particles: 'const k = [g.fx.glow?.mesh ?? g.fx.glow?.points, g.fx.smoke?.mesh ?? g.fx.smoke?.points].filter(Boolean); k.forEach((o) => o.visible = false); return () => k.forEach((o) => o.visible = true)',
  trails: 'const k = []; g.scene.traverse((o) => { if (o.isMesh && o.material?.transparent && o.material.isShaderMaterial && o.frustumCulled === false && o.parent === g.scene) k.push(o) }); k.forEach((o) => o.visible = false); return () => k.forEach((o) => o.visible = true)',
  fxAll: 'const k = [g.fx.glow, g.fx.smoke].flatMap((x) => x ? Object.values(x).filter((v) => v && v.isObject3D) : []); k.forEach((o) => o.visible = false); return () => k.forEach((o) => o.visible = true)',
  bloom: 'const v = g.post.bloom.enabled; g.post.bloom.enabled = false; return () => { g.post.bloom.enabled = v }',
  finalPass: 'g.post.final.enabled = false; const b = g.post.bloom; b.renderToScreen = true; return () => { g.post.final.enabled = true; b.renderToScreen = false }',
  finalTrivial: 'const m = g.post.final.material, f = m.fragmentShader; m.fragmentShader = "uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }"; m.needsUpdate = true; (g.drawFrame ?? g.draw)(); return () => { m.fragmentShader = f; m.needsUpdate = true; (g.drawFrame ?? g.draw)() }',
  wholeScene: 'g.scene.visible = false; return () => { g.scene.visible = true }',
  msaa: 'const n = g.post.composer.renderTarget1.samples; g.post.setSamples(0); return () => g.post.setSamples(n)',
}
const base0 = await meas()
console.log(`${c} q=${Q} ${W}x${H}@${DPR}: frame ${base0.toFixed(2)} ms`)
if (process.env.ONLY) { await b.close(); process.exit(0) }
for (const [name, js] of Object.entries(T)) {
  const a = await meas()
  if (process.env.POST) await p.evaluate(() => { const u = window.__g.post.final.uniforms; console.log(0); window.__u = [u.uBlur.value, u.uStreak.value, u.uSharpen.value] })
  const ok = await p.evaluate((js) => { const g = window.__g; window.__undo = new Function('g', js)(g); return true }, js).catch((e) => String(e))
  if (ok !== true) { console.log(name, 'ERR', ok); continue }
  const o = await meas()
  await p.evaluate(() => window.__undo())
  const a2 = await meas()
  console.log(`  ${name.padEnd(13)} ${(o - (a + a2) / 2).toFixed(2)} ms   (on ${((a + a2) / 2).toFixed(2)})`)
}
await b.close()
