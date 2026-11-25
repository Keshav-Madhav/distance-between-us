// Dev helper: node exp.mjs <course> <script.js> — runs the script's body (async, gets g) in the warmed page.
import fs from 'node:fs'
import { openBrowser, openCourse } from './browser.mjs'
const [course, file] = process.argv.slice(2)
const b = await openBrowser()
const { page } = await openCourse(b, course)
await page.addScriptTag({ content: fs.readFileSync(new URL('./core.js', import.meta.url), 'utf8') })
const r = await page.evaluate(`(async () => { const g = window.__g; const ARGS = ${JSON.stringify(JSON.parse(process.env.ARGS ?? "{}"))}; ${fs.readFileSync(file, 'utf8')} })()`)
console.log(typeof r === 'string' ? r : JSON.stringify(r))
await b.close()
