// Close looks at the world's rock / ice shapes: parks the craft facing the nearest few of each kind.
//   COURSE=frostline node tools/rockview.mjs <out dir>
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
const D = (process.argv[2] ?? 'shots/rock') + '/'
const C = process.env.COURSE ?? 'frostline'
mkdirSync(D, { recursive: true })
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
p.on('pageerror', (e) => console.log('ERR', e.message))
await p.goto(`http://localhost:5417/?course=${C}`); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 }); await p.waitForTimeout(2500)
await p.click('#start'); await p.evaluate(() => window.__g.skipCountdown()); await p.waitForTimeout(1500)
const files = []
// Wrapped meshes 0.. are the rock kinds, in order of variants (big ones).
const n = await p.evaluate(() => window.__g.world.wrapped.filter((w) => w.big).length)
for (let wi = 0; wi < Math.min(n, +(process.env.N ?? 99)); wi++) {
  const ok = await p.evaluate((wi) => {
    const g = window.__g, w = g.world.wrapped.filter((w) => w.big)[wi]
    // Pick an item that is currently grown (near the player).
    const P = g.player.pos
    let best = null, bd = 1e12
    for (const it of w.items) { if (it.grow < 0.99) continue; const d = Math.hypot(it.x - P.x, it.z - P.z); if (d < bd && d > 500) { bd = d; best = it } }
    if (!best) return false
    const dist = best.r * 3.2 + best.h * 0.8
    const a = 0.7
    const x = best.x - Math.sin(a) * dist, z = best.z - Math.cos(a) * dist
    g.player.reset(x, z, a, 0.3)
    g.forced = null
    g.cam?.snap?.(a)
    return true
  }, wi)
  if (!ok) continue
  await p.evaluate(() => window.__g.force({ steer: 0, boost: false, brake: true, strafe: 0, dodgeL: false, dodgeR: false }))
  await p.waitForTimeout(1800)
  const f = `${D}${C}-v${wi}.png`; await p.screenshot({ path: f }); files.push(f)
}
console.log(files.length, 'shots')
const ins = files.map((f) => `-i ${f}`).join(' ')
const sc = files.map((_, i) => `[${i}]scale=480:-1[s${i}]`).join(';')
const cols = 4
const lay = files.map((_, i) => `${(i % cols) ? Array.from({ length: i % cols }, () => 'w0').join('+') : '0'}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, () => 'h0').join('+') : '0'}`).join('|')
execSync(`ffmpeg -v error -y ${ins} -filter_complex "${sc};${files.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${files.length}:layout=${lay}:fill=black" ${D}${C}-rocks.png`)
await b.close()
