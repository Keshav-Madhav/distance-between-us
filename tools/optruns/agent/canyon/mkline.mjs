// Racing line: multiscale min-curvature smoothing inside the floor (±(half - margin)); gate windows optional.
// node mkline.mjs margin gateW finW out.json [moundClear]
import fs from 'node:fs'
const d = JSON.parse(fs.readFileSync(new URL('./course.json', import.meta.url)))
const margin = +process.argv[2], GW = process.argv[3].split(",").map(Number), finw = +process.argv[4], out = process.argv[5], moundC = +(process.argv[6] ?? 0)
const { px, pz, startI: S, finishI: F } = d, n = px.length
const loop = (u) => { const a = 2 * Math.PI * u, r = 10500 + 2600 * Math.cos(2 * a + 0.3) + 700 * Math.sin(5 * a + 1.0) + 260 * Math.sin(11 * a + 2.0); return [r * Math.sin(a), r * Math.cos(a) - 10500] }
const half = (u) => { const a = u * Math.PI * 2; return 1320 + 240 * Math.sin(a * 3 + 1.1) + 130 * Math.sin(a * 11 + 2.3) + 60 * Math.sin(a * 23 + 0.4) }
const N = 40000, L = Array.from({ length: N }, (_, i) => loop(i / N))
const i0 = Math.max(1, S - 40), i1 = Math.min(n - 2, F + 70), m = i1 - i0 + 1
const T = [], H = [], lo = [], hi = []
let ui = -1
for (let j = 0; j < m; j++) {
  const i = i0 + j
  let tx = px[i + 1] - px[i - 1], tz = pz[i + 1] - pz[i - 1]; const l = Math.hypot(tx, tz); tx /= l; tz /= l; T.push([tx, tz])
  let best = 1e18, bj = 0
  const cand = ui < 0 ? Array.from({ length: N / 10 }, (_, k) => k * 10) : Array.from({ length: 800 }, (_, k) => (ui + k - 400 + N) % N)
  for (const q of cand) { const dd = (L[q][0] - px[i]) ** 2 + (L[q][1] - pz[i]) ** 2; if (dd < best) { best = dd; bj = q } }
  ui = bj; H.push(half(ui / N)); lo.push(-(H[j] - margin)); hi.push(H[j] - margin)
}
d.cps.forEach((c, k) => { const w = k === d.cps.length - 1 ? finw : k === 0 ? 0 : (GW.length > 1 ? GW[k] : GW[0]); if (w > 0) for (let jj = c.i - i0 - 1; jj <= c.i - i0 + 1; jj++) { lo[jj] = Math.max(lo[jj], -w); hi[jj] = Math.min(hi[jj], w) } })
const o = new Float64Array(m)
const X = (j) => px[i0 + j] + T[j][1] * o[j], Z = (j) => pz[i0 + j] - T[j][0] * o[j]
const solve = (ks) => { for (const k of ks) {
  for (let it = 0; it < 3000; it++) {
    for (let j = 2 * k; j < m - 2 * k; j++) {
      const tx_ = (4 * (X(j - k) + X(j + k)) - (X(j - 2 * k) + X(j + 2 * k))) / 6
      const tz_ = (4 * (Z(j - k) + Z(j + k)) - (Z(j - 2 * k) + Z(j + 2 * k))) / 6
      const i = i0 + j, [tx, tz] = T[j]
      const oo = (tx_ - px[i]) * tz - (tz_ - pz[i]) * tx
      o[j] = Math.min(hi[j], Math.max(lo[j], oo))
    }
  }
} }
solve([64, 32, 16, 8, 4, 2, 1])
if (moundC > 0) {
  // smooth sidesteps round the mounds: a Gaussian bump in the offset (sigma SIG m), the side the line is already on
  const SIG = +(process.argv[7] ?? 1200) / 40
  for (let q = 0; q < d.mounds.length; q += 4) {
    const [mx, mz, , mr] = d.mounds.slice(q, q + 4)
    let bj = 0, bd = 1e18
    for (let j = 0; j < m; j++) { const dd = (px[i0 + j] - mx) ** 2 + (pz[i0 + j] - mz) ** 2; if (dd < bd) { bd = dd; bj = j } }
    const om = (mx - px[i0 + bj]) * T[bj][1] - (mz - pz[i0 + bj]) * T[bj][0], need = mr * 1.3 + moundC
    const gap = o[bj] - om
    if (Math.abs(gap) >= need) continue
    const dir = process.env['SIDE' + q / 4] ? +process.env['SIDE' + q / 4] : (gap >= 0 ? 1 : -1)
    const A = dir * need - gap
    for (let j = 0; j < m; j++) o[j] = Math.min(hi[j], Math.max(lo[j], o[j] + A * Math.exp(-((j - bj) ** 2) / (2 * SIG * SIG))))
    console.error('mound', q / 4, 'idx', bj + i0, 'om', Math.round(om), 'line', Math.round(o[bj] - A), '->', Math.round(o[bj]))
  }
}
const x = [], z = []; for (let j = 0; j < m; j++) { x.push(X(j)); z.push(Z(j)) }
const R = []
for (let j = 0; j < m; j++) {
  const a = Math.max(0, j - 3), c = Math.min(m - 1, j + 3)
  const h1 = Math.atan2(x[j] - x[a], z[j] - z[a]), h2 = Math.atan2(x[c] - x[j], z[c] - z[j])
  let dh = h2 - h1; dh = Math.atan2(Math.sin(dh), Math.cos(dh))
  const ds = Math.hypot(x[j] - x[a], z[j] - z[a]) + Math.hypot(x[c] - x[j], z[c] - z[j])
  R.push(ds / 2 / Math.max(1e-6, Math.abs(dh)))
}
let len = 0, yaw = 0; for (let j = S - i0; j < F - i0; j++) { len += Math.hypot(x[j + 1] - x[j], z[j + 1] - z[j]) }
for (let j = S - i0 + 1; j < F - i0; j++) { let dh = Math.atan2(x[j + 1] - x[j], z[j + 1] - z[j]) - Math.atan2(x[j] - x[j - 1], z[j] - z[j - 1]); yaw += Math.abs(Math.atan2(Math.sin(dh), Math.cos(dh))) }
fs.writeFileSync(out, JSON.stringify({ i0, x, z, R, o: Array.from(o), H }))
const Rs = R.slice(S - i0, F - i0).sort((a, b) => a - b)
console.log(JSON.stringify({ out, len: Math.round(len), yawRad: +yaw.toFixed(2), minR: Rs.slice(0, 3).map(Math.round), p5: Math.round(Rs[Math.floor(Rs.length * 0.05)]), p20: Math.round(Rs[Math.floor(Rs.length * 0.2)]) }))
