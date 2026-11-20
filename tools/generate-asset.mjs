// Offline asset generation with Gemini image models. NEVER imported by the game.
//
//   node tools/generate-asset.mjs <name> <preset> <aspect> <size> "<request>"
//
// Reads GEMINI_API_KEY from .env (gitignored). Writes assets/raw/<name>.png plus a JSON sidecar
// (prompt, model, settings) so every asset is reproducible. The model lives in tools/gen.config.json.
// The key is never printed or written anywhere else.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const cfg = JSON.parse(readFileSync(new URL('./gen.config.json', import.meta.url)))
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const key = env.GEMINI_API_KEY
if (!key) throw new Error('GEMINI_API_KEY missing from .env')

const [name, preset, aspect = '1:1', size = '2K', request] = process.argv.slice(2)
if (!name || !preset || !request) {
  console.error('usage: node tools/generate-asset.mjs <name> <preset> <aspect> <size> "<request>"')
  process.exit(1)
}
const style = readFileSync(new URL('../docs/ART_STYLE.md', import.meta.url), 'utf8')
const bible = style.split('## Prompt core')[1]?.split('##')[0]?.trim() ?? ''
const presetText = cfg.presets[preset]
if (!presetText) throw new Error(`unknown preset ${preset}`)
const prompt = `${presetText}\n\nSubject: ${request}\n\nStyle bible: ${bible}`

const body = {
  model: cfg.model,
  input: prompt,
  response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: aspect, image_size: size },
}
const t0 = Date.now()
const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
  method: 'POST',
  headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json', 'Api-Revision': cfg.apiRevision },
  body: JSON.stringify(body),
})
const text = await res.text()
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${text.slice(0, 1200)}`)
  process.exit(2)
}
const json = JSON.parse(text)
// Find the image wherever this API revision puts it.
function findImage(o) {
  if (!o || typeof o !== 'object') return null
  if (typeof o.data === 'string' && o.data.length > 1000) return o.data
  for (const v of Object.values(o)) {
    const r = findImage(v)
    if (r) return r
  }
  return null
}
const b64 = findImage(json)
if (!b64) {
  console.error('no image in response; keys:', JSON.stringify(json, (k, v) => (typeof v === 'string' && v.length > 200 ? `<${v.length} chars>` : v)).slice(0, 1500))
  process.exit(3)
}
mkdirSync(new URL('../assets/raw/', import.meta.url), { recursive: true })
const out = new URL(`../assets/raw/${name}.jpg`, import.meta.url)
writeFileSync(out, Buffer.from(b64, 'base64'))
writeFileSync(new URL(`../assets/raw/${name}.json`, import.meta.url), JSON.stringify({ name, model: cfg.model, preset, aspect, size, request, prompt, usage: json.usage ?? null, ms: Date.now() - t0, date: new Date().toISOString() }, null, 2))
console.log(`wrote assets/raw/${name}.jpg (${Math.round((b64.length * 0.75) / 1024)} KB, ${Date.now() - t0} ms)`, json.usage ? JSON.stringify(json.usage) : '')
