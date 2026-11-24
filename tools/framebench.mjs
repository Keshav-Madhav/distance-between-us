// Frozen-frame A/B: each build simulated to the same race moment (fixed sim steps, no wall clock), its
// own loop stopped, then that frame drawn over and over — GPU-synced (a pixel read), best of batches.
// One page at a time (paused pages still draw and fight for the GPU), builds interleaved per round.
// Robust on a loaded machine where live fps swings ±30%. Counts CPU submission and GPU time together.
//   node tools/framebench.mjs 4498,4495 [rounds]      (C=sprint,frostline  T=seconds into the race)
// A weaker machine: Q=low|medium|high  DPR=1  W=1920 H=1080  CPU=4 (CPU slowed 4×; the GPU cannot be).
// Reports the GPU-synced frame and the CPU time to submit it (no sync).
import { chromium } from 'playwright-core'
import { calm } from './loadguard.mjs'
const ports = (process.argv[2] ?? '4498').split(','), rounds = +(process.argv[3] ?? 3)
const Q = process.env.Q ?? 'high', DPR = +(process.env.DPR ?? 2), W = +(process.env.W ?? 1280), H = +(process.env.H ?? 720), CPU = +(process.env.CPU ?? 1)
const COURSES = (process.env.C ?? 'sprint,frostline,caldera,greenway,mistriver').split(','), T = +(process.env.T ?? 8)
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--ignore-gpu-blocklist'] })
async function one(port, c) {
  await calm()
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR })
  const p = await ctx.newPage()
  await p.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window), held = []
    window.__freeze = false
    window.requestAnimationFrame = (cb) => window.__freeze ? (held.push(cb), 0) : raf(cb)
    window.__thaw = () => { window.__freeze = false; for (const cb of held.splice(0)) raf(cb) }
  })
  await p.goto(`http://localhost:${port}/?course=${c}&q=${Q}&fixed=1`)
  await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
  if (CPU > 1) { const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU }) }
  const m = await p.evaluate(async (T) => {
    const g = window.__g
    g.start(); g.skipCountdown(); g.autopilot(true); g.hold(true); g.fastSim(T); g.snapCam()
    // Real frames first so lazy work (shader compiles, LOD settles, idle queues) is done.
    g.hold(false); await new Promise((r) => setTimeout(r, 2500)); g.hold(true)
    await new Promise((r) => setTimeout(r, 300)); window.__freeze = true; await new Promise((r) => setTimeout(r, 100))
    const gl = g.renderer.getContext(), px = new Uint8Array(4); let best = 1e9
    for (let r = 0; r < 8; r++) { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t = performance.now(); for (let i = 0; i < 30; i++) (g.drawFrame ?? g.draw)(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); best = Math.min(best, (performance.now() - t) / 30) }
    // CPU: the same draws, timed without waiting for the GPU (submission only).
    let cpu = 1e9
    for (let r = 0; r < 6; r++) { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t = performance.now(); for (let i = 0; i < 5; i++) (g.drawFrame ?? g.draw)(); cpu = Math.min(cpu, (performance.now() - t) / 5) }
    g.renderer.info.reset(); (g.drawFrame ?? g.draw)()
    return { best, cpu, calls: g.renderer.info.render.calls }
  }, T)
  await ctx.close()
  return m
}
const res = {}
for (let r = 0; r < rounds; r++) for (const c of COURSES) for (const k of (r % 2 ? [...ports.keys()].reverse() : [...ports.keys()])) {
  const m = await one(ports[k], c); const e = ((res[c] ??= {})[k] ??= { best: 1e9, all: [], calls: 0 }); e.best = Math.min(e.best, m.best); e.cpu = Math.min(e.cpu ?? 1e9, m.cpu); e.all.push(m.best); e.calls = m.calls
}
for (const c of COURSES) console.log(c.padEnd(10), ports.map((port, k) => `${port}: ${res[c][k].best.toFixed(2)} ms cpu ${res[c][k].cpu.toFixed(2)} [${res[c][k].all.map((x) => x.toFixed(1)).join(' ')}] ${res[c][k].calls}c`).join('  |  '))
await b.close()
