// The menu ship close up (ARROW, blue/orange): OUT png, livery, finish; NODRAG=1 keeps the side view.

import { chromium } from 'playwright-core'
const [out, liv = '0', fin = '0'] = process.argv.slice(2)
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle'] })
const ctx = await b.newContext({ viewport: { width: 1000, height: 690 }, deviceScaleFactor: 2 })
await ctx.addInitScript(([l, f]) => { localStorage.setItem('dbu-ship', '3'); localStorage.setItem('dbu-paint', JSON.stringify({ body: 0x1d3f8a, trim: 0xff7a2a, number: '07', livery: +l, finish: +f })) }, [liv, fin])
const p = await ctx.newPage()
await p.goto('http://localhost:5417/'); await p.waitForFunction('window.__g && window.__g.ready', null, { timeout: 120000 })
await p.waitForTimeout(1500)
if (!process.env.NODRAG) { await p.mouse.move(700, 150); await p.mouse.down(); await p.mouse.move(640, 400, { steps: 10 }); await p.mouse.up() }
await p.waitForTimeout(1500)
await p.screenshot({ path: out })
await b.close()
