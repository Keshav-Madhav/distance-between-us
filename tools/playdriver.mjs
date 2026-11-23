// A real browser on the PLAYTEST build, driven only through player inputs over HTTP — for blind
// playtesters (agents) who must play like a person: keys, mouse, screenshots. No test hooks.
//   PORT=7801 OUT=dir node tools/playdriver.mjs      (then curl http://localhost:7801/help)
import { chromium } from 'playwright-core'
import http from 'node:http'
import fs from 'node:fs'

const PORT = +(process.env.PORT ?? 7801), OUT = process.env.OUT ?? '/tmp/playtest'
fs.mkdirSync(OUT, { recursive: true })
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto(process.env.URL ?? 'http://localhost:4417/')
let n = 0
const held = new Set()

const HELP = `Player-input controls (one action per request; every action returns a fresh screenshot path):
  GET /shot                      just look (screenshot)
  GET /press?k=KeyW              tap a key        (key names: KeyW KeyA KeyS KeyD KeyQ KeyE KeyR KeyC Space ShiftLeft Enter Escape ArrowUp ArrowDown ArrowLeft ArrowRight Digit1 ...)
  GET /hold?k=KeyW&ms=1500       hold a key for ms, then release
  GET /down?k=KeyW               press and keep holding (until /up)
  GET /up?k=KeyW                 release
  GET /release                   release everything held
  GET /wait?ms=2000              let time pass (keys stay as they are)
  GET /click?x=640&y=360         left-click at a screen point (the screenshot is 1280x720)
  GET /drag?x1=..&y1=..&x2=..&y2=..   drag the mouse
Screenshots are written to ${OUT}/NNN.png — open them to see the game.`

async function shot() { const f = `${OUT}/${String(++n).padStart(3, '0')}.png`; await p.screenshot({ path: f }); return f }

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), q = (k) => u.searchParams.get(k)
  try {
    let msg = ''
    switch (u.pathname) {
      case '/help': res.end(HELP); return
      case '/shot': break
      case '/press': await p.keyboard.press(q('k')); await p.waitForTimeout(150); break
      case '/hold': await p.keyboard.down(q('k')); await p.waitForTimeout(Math.min(+(q('ms') ?? 500), 15000)); await p.keyboard.up(q('k')); break
      case '/down': await p.keyboard.down(q('k')); held.add(q('k')); await p.waitForTimeout(100); break
      case '/up': await p.keyboard.up(q('k')); held.delete(q('k')); await p.waitForTimeout(100); break
      case '/release': for (const k of held) await p.keyboard.up(k); held.clear(); break
      case '/wait': await p.waitForTimeout(Math.min(+(q('ms') ?? 1000), 15000)); break
      case '/click': await p.mouse.click(+q('x'), +q('y')); await p.waitForTimeout(300); break
      case '/drag': await p.mouse.move(+q('x1'), +q('y1')); await p.mouse.down(); await p.mouse.move(+q('x2'), +q('y2'), { steps: 12 }); await p.mouse.up(); break
      default: res.statusCode = 404; res.end('unknown; see /help'); return
    }
    const f = await shot()
    msg = `screenshot: ${f}${held.size ? `\nholding: ${[...held].join(' ')}` : ''}${errs.length ? `\npage errors so far: ${errs.slice(-3).join(' | ')}` : ''}`
    res.end(msg)
  } catch (e) { res.statusCode = 500; res.end(String(e)) }
}).listen(PORT, () => console.log(`playdriver on :${PORT} → ${OUT}`))
