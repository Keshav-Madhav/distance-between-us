// Two runs of a course side by side as one video (left / right), each a real rendered run (tools/rendrun.mjs
// INPUTS=), labelled with its name and time; the shorter one holds its last frame.
//   node tools/vspair.mjs <course> <left.json> "<left label>" <right.json> "<right label>" <out.mp4>
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { chromium } from 'playwright-core'
const [course, lf, ll, rf, rl, out] = process.argv.slice(2)
const tmp = fs.mkdtempSync('/private/tmp/claude-502/-Users-keshavmadhav-verbaflo-Repositories-portfolio-website/e18b0817-8173-4e62-8348-b75848d93f42/scratchpad/pair-')
const env = (f) => ({ ...process.env, INPUTS: f })
for (const [f, name] of [[lf, 'l'], [rf, 'r']]) execFileSync('node', ['tools/rendrun.mjs', process.env.PORT ?? '4480', course, 'agent', `${tmp}/${name}.mp4`], { env: env(f), stdio: 'inherit' })
const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await b.newPage()
for (const [t, name] of [[ll, 'l'], [rl, 'r']]) {
  await p.setContent(`<body style="margin:0;background:transparent"><div id=l style="display:inline-block;font:700 26px Arial;color:#fff;background:rgba(0,0,0,.58);padding:9px 14px;letter-spacing:.04em">${t}</div></body>`)
  await (await p.$('#l')).screenshot({ path: `${tmp}/${name}.png`, omitBackground: true })
}
await b.close()
const dur = (f) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString()
const D = Math.max(dur(`${tmp}/l.mp4`), dur(`${tmp}/r.mp4`))
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${tmp}/l.mp4`, '-i', `${tmp}/r.mp4`, '-i', `${tmp}/l.png`, '-i', `${tmp}/r.png`, '-filter_complex',
  `[0:v]trim=start_frame=6,setpts=PTS-STARTPTS,scale=960:540,tpad=stop_mode=clone:stop_duration=${D}[a0];[a0][2:v]overlay=20:H-66[a];` +
  `[1:v]trim=start_frame=6,setpts=PTS-STARTPTS,scale=960:540,tpad=stop_mode=clone:stop_duration=${D}[b0];[b0][3:v]overlay=20:H-66[b];[a][b]hstack=inputs=2,trim=duration=${D}`,
  '-c:v', 'libx264', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out])
console.log(`→ ${out}`)
