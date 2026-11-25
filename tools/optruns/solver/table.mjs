// node tools/optruns/solver/table.mjs — the saved runs as a table (course, rogue, ideal, against the best known).
import fs from 'node:fs'
const DIR = new URL('.', import.meta.url).pathname
const KNOWN = { canyon: [22.78, 24.15], mistriver: [25.6, 28.2], caldera: [39.62, 44.08], greenway: [40.88, 45.8], sprint: [45.43, 49.67], oval: [53.92, 56.77] }
const rd = (c, m) => { try { const j = JSON.parse(fs.readFileSync(`${DIR}runs/${c}-${m}.json`, 'utf8')); return j.valid ? j : { time: 'INVALID' } } catch { return null } }
const ids = [...new Set(fs.readdirSync(`${DIR}runs`).filter((f) => /-(rogue|ideal)\.json$/.test(f)).map((f) => f.replace(/-(rogue|ideal)\.json$/, '')))].sort()
console.log('| course | rogue | best known | ideal | max lat | best known |\n|---|---|---|---|---|---|')
for (const c of ids) {
  const r = rd(c, 'rogue'), i = rd(c, 'ideal'), k = KNOWN[c] ?? ['', '']
  console.log(`| ${c} | ${r?.time ?? '—'} | ${k[0]} | ${i?.time ?? '—'} | ${i?.maxLat ?? ''} | ${k[1]} |`)
}
