// Which materials make which shader programs: every material in the scene, grouped by the program it
// compiled to, with what differs between programs of the same kind.  node tools/progmap.mjs 4495 sprint
import { chromium } from 'playwright-core'
import { calm } from './loadguard.mjs'
const port = process.argv[2] ?? '4495', c = process.argv[3] ?? 'sprint'
await calm()
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
await p.goto(`http://localhost:${port}/?course=${c}&q=high&fixed=1`)
await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.evaluate(async () => { const g = window.__g; g.start(); g.skipCountdown(); g.autopilot(true); await new Promise((r) => setTimeout(r, 3000)) })
console.log(await p.evaluate(() => {
  const g = window.__g, r = g.renderer, byProg = new Map()
  g.scene.traverse((o) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []
    for (const m of ms) { const pr = r.properties.get(m).currentProgram; if (!pr) continue
      const e = byProg.get(pr) ?? { key: pr.cacheKey, mats: new Set(), objs: 0 }; e.mats.add(m); e.objs++; byProg.set(pr, e) } })
  const rows = [...byProg.values()].map((e) => { const m = [...e.mats][0]
    const flags = ['vertexColors', 'flatShading', 'transparent', 'side', 'alphaTest', 'map', 'envMap', 'fog', 'depthWrite'].map((k) => k + '=' + (m[k]?.isTexture ? 'tex' : m[k])).join(' ')
    return `${String(e.mats.size).padStart(3)} mats ${String(e.objs).padStart(4)} objs  ${m.type.padEnd(22)} ${m.customProgramCacheKey?.().slice(0, 30) ?? ''} | ${flags}` })
  return `${byProg.size} programs in use by scene materials\n` + rows.sort().join('\n')
}))
await b.close()
