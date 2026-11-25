// node tools/optruns/blind/judge.mjs <course> <inputs.json> — the judge's (tools/agentrun.mjs) verdict on a
// run; if it counts, is hands-legal and beats tools/optruns/blind/<course>.json, it becomes the new best.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { waitLoad } from './browser.mjs'
const [course, file] = process.argv.slice(2)
const dir = new URL('.', import.meta.url).pathname, root = new URL('../../../', import.meta.url).pathname
await waitLoad()
const out = execFileSync('node', ['tools/agentrun.mjs', 'run', course, file], { cwd: root, maxBuffer: 1 << 26 }).toString()
const d = JSON.parse(out)
const ok = d.counted && d.hands.ok
const bestF = `${dir}${course}.json`
let prev = null
try { prev = JSON.parse(fs.readFileSync(bestF, 'utf8')).judged } catch {}
const better = ok && (!prev || d.time < prev)
if (better) { const inp = JSON.parse(fs.readFileSync(file, 'utf8')); fs.writeFileSync(bestF, JSON.stringify({ course, judged: d.time, steps: inp.steps })) }
console.log(JSON.stringify({ course, counted: d.counted, time: d.time, hands: d.hands, missed: d.missedGates, crashes: d.events.filter((e) => e.what === 'crash').length, prev, saved: better }))
