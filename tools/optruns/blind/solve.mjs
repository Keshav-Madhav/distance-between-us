// The blind solver: node tools/optruns/blind/solve.mjs <course> [opts-json] — plans a lane, runs the MPC search
// in a warmed page, writes tools/optruns/blind/<course>.cand.json (and <course>.json if it beats the saved best
// by the judge's verdict when --judge is given; see README).
import fs from 'node:fs'
import { openBrowser, openCourse } from './browser.mjs'
const [course, optArg] = process.argv.slice(2)
const opt = optArg ? JSON.parse(optArg) : {}
const dir = new URL('.', import.meta.url).pathname
const b = await openBrowser()
const { page } = await openCourse(b, course)
await page.addScriptTag({ content: fs.readFileSync(dir + 'core.js', 'utf8') })
const r = await page.evaluate(async (opt) => {
  const B = window.BL
  const obs = B.sweepObstacles(opt.Wmax ?? 600), hw = B.wallHalf()
  const L = B.planLane({ obs, hw, ...(opt.plan ?? {}) })
  B.setLane(L.ok || true ? L : null)
  let plain = null
  if (opt.plainOnly || opt.plainToo) { const q = B.plain({ ...B.DEF, ...(opt.base ?? {}) }); plain = { time: q.time, steps: q.steps } }
  if (opt.plainOnly) return { plain, best: plain }
  const s = await B.solve(opt)
  const best = plain && plain.time && (!s.time || plain.time < s.time) ? plain : s
  return { plain: plain && plain.time, solve: s.time, ms: s.ms, best }
}, opt)
const out = opt.out ?? `${dir}${course}.cand.json`
fs.writeFileSync(out, JSON.stringify({ course, time: r.best.time, steps: r.best.steps }))
console.log(JSON.stringify({ course, plain: r.plain?.time ?? r.plain, solve: r.solve, ms: r.ms, out }))
await b.close()
