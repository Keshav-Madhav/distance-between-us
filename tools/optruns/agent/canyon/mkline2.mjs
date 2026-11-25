// Racing line, exact: min Σ|second difference|² of the points (≈ min Σκ²) over lateral offsets, inside
// ±(half − margin), gate windows ±w — an active-set QP with a banded (pentadiagonal) solve.
// node mkline2.mjs margin gateW(list by gate k) finW out.json [moundClear sigma]
import fs from 'node:fs'
const d = JSON.parse(fs.readFileSync(new URL('./course.json', import.meta.url)))
const margin = +process.argv[2], GW = process.argv[3].split(',').map(Number), finw = +process.argv[4], out = process.argv[5], moundC = +(process.argv[6] ?? 0), SIGm = +(process.argv[7] ?? 1500)
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
// the grid: the craft starts on the centreline; keep the first stretch near it
for (let j = 0; j <= S - i0 + 2; j++) { lo[j] = Math.max(lo[j], -30); hi[j] = Math.min(hi[j], 30) }
d.cps.forEach((c, k) => { const w = k === d.cps.length - 1 ? finw : k === 0 ? 0 : (GW.length > 1 ? GW[k] : GW[0]); if (w > 0) for (let jj = c.i - i0 - 1; jj <= c.i - i0 + 1; jj++) { lo[jj] = Math.max(lo[jj], -w); hi[jj] = Math.min(hi[jj], w) } })
for (const z of (process.env.ZONES ?? '').split(';').filter(Boolean)) { const [a, b, l2, h2] = z.split(',').map(Number); for (let j = a - i0; j <= b - i0; j++) { lo[j] = Math.max(lo[j], l2); hi[j] = Math.min(hi[j], h2) } }
const Nx = T.map(([tx, tz]) => [tz, -tx])
// residual r_j (j=1..m-2) = D_j + o_{j-1}N_{j-1} - 2o_jN_j + o_{j+1}N_{j+1}
let WJ = new Float64Array(m).fill(1)
function build(fixed, val) {
  // A (5 bands: A[j][k], k=-2..2) and b, with fixed rows as identity
  const A = Array.from({ length: m }, () => new Float64Array(5)), b = new Float64Array(m)
  for (let j = 1; j < m - 1; j++) {
    const D = [px[i0 + j - 1] - 2 * px[i0 + j] + px[i0 + j + 1], pz[i0 + j - 1] - 2 * pz[i0 + j] + pz[i0 + j + 1]]
    const idx = [j - 1, j, j + 1], co = [1, -2, 1]
    const v = idx.map((q, t) => [co[t] * Nx[q][0], co[t] * Nx[q][1]])
    const w = WJ[j]
    for (let a = 0; a < 3; a++) {
      for (let c = 0; c < 3; c++) A[idx[a]][idx[c] - idx[a] + 2] += w * (v[a][0] * v[c][0] + v[a][1] * v[c][1])
      b[idx[a]] -= w * (v[a][0] * D[0] + v[a][1] * D[1])
    }
  }
  for (let j = 0; j < m; j++) A[j][2] += 1e-6
  // fixed
  for (let j = 0; j < m; j++) if (fixed[j]) {
    for (let k = -2; k <= 2; k++) { const q = j + k; if (k === 0 || q < 0 || q >= m) continue; if (!fixed[q]) b[q] -= A[q][j - q + 2] * val[j]; A[q][j - q + 2] = 0; A[j][k + 2] = 0 }
    A[j][2] = 1; b[j] = val[j]
  }
  return [A, b]
}
function solveBand(A, b) {
  // Gaussian elimination, bandwidth 2, no pivoting (SPD)
  const M = A.map((r) => Float64Array.from(r)), y = Float64Array.from(b)
  for (let j = 0; j < m; j++) {
    const p = M[j][2]
    for (let k = 1; k <= 2 && j + k < m; k++) {
      const f = M[j + k][2 - k] / p
      if (f === 0) continue
      for (let c = 0; c <= 2; c++) { const col = j + c; if (col >= m) break; M[j + k][col - (j + k) + 2] -= f * M[j][c + 2] }
      y[j + k] -= f * y[j]
    }
  }
  const x = new Float64Array(m)
  for (let j = m - 1; j >= 0; j--) { let s = y[j]; for (let c = 1; c <= 2 && j + c < m; c++) s -= M[j][c + 2] * x[j + c]; x[j] = s / M[j][2] }
  return x
}
function qp(lo, hi) {
  const fixed = new Uint8Array(m), val = new Float64Array(m)
  let o
  for (let it = 0; it < 400; it++) {
    const [A, b] = build(fixed, val)
    o = solveBand(A, b)
    let changed = 0
    for (let j = 0; j < m; j++) if (!fixed[j]) {
      if (o[j] > hi[j] + 1e-6) { fixed[j] = 1; val[j] = hi[j]; changed++ } else if (o[j] < lo[j] - 1e-6) { fixed[j] = 1; val[j] = lo[j]; changed++ }
    }
    if (!changed) {
      // release fixed points whose gradient pulls them inside
      const [A0, b0] = build(new Uint8Array(m), val)
      for (let j = 0; j < m; j++) if (fixed[j]) {
        let g = -b0[j]; for (let k = -2; k <= 2; k++) { const q = j + k; if (q >= 0 && q < m) g += A0[j][k + 2] * o[q] }
        if ((val[j] >= hi[j] - 1e-6 && g > 1e-9) || (val[j] <= lo[j] + 1e-6 && g < -1e-9)) { fixed[j] = 0; changed++ }
      }
      if (!changed) break
    }
  }
  return o
}
let o = qp(lo, hi)
if (moundC > 0) {
  for (let q = 0; q < d.mounds.length; q += 4) {
    const [mx, mz, , mr] = d.mounds.slice(q, q + 4)
    let bj = 0, bd = 1e18
    for (let j = 0; j < m; j++) { const dd = (px[i0 + j] - mx) ** 2 + (pz[i0 + j] - mz) ** 2; if (dd < bd) { bd = dd; bj = j } }
    const om = (mx - px[i0 + bj]) * T[bj][1] - (mz - pz[i0 + bj]) * T[bj][0], need = mr * 1.3 + moundC
    const gap = o[bj] - om
    if (Math.abs(gap) >= need) continue
    const dir = process.env['SIDE' + q / 4] ? +process.env['SIDE' + q / 4] : (gap >= 0 ? 1 : -1)
    const band = Math.ceil((mr + 200) / 40)
    for (let j = bj - band; j <= bj + band; j++) { if (dir > 0) lo[j] = Math.max(lo[j], om + need); else hi[j] = Math.min(hi[j], om - need) }
    console.error('mound', q / 4, 'idx', bj + i0, 'om', Math.round(om), 'line', Math.round(o[bj]), 'side', dir)
  }
  o = qp(lo, hi)
}
// crests (crest.json from probe3.mjs): keep the line out of cells whose launch metric > CREST, re-solving a few times
if (process.env.CREST) {
  const thr = +process.env.CREST, pad = +(process.env.CPAD ?? 50), cm = JSON.parse(fs.readFileSync(new URL('./crest.json', import.meta.url)))
  for (let pass = 0; pass < 8; pass++) {
    let moved = 0
    for (let j = 0; j < m; j++) {
      const row = cm[i0 + j]; if (!row) continue
      const bad = (oo) => { const k = Math.round((oo + 1700) / 50); for (let q = k - 1; q <= k + 1; q++) if (row[q] > thr && Math.abs(-1700 + 50 * q - oo) < 25 + pad) return true; return false }
      if (!bad(o[j])) {
        continue
      } else {
        // inside a crest: step out to the nearer free side
        let dn = o[j], up = o[j]
        while (dn > lo[j] && bad(dn)) dn -= 10
        while (up < hi[j] && bad(up)) up += 10
        const goUp = (up < hi[j] && (up - o[j] < o[j] - dn || dn <= lo[j]))
        if (goUp && up <= hi[j]) lo[j] = Math.max(lo[j], up); else if (!goUp && dn >= lo[j]) hi[j] = Math.min(hi[j], dn)
        moved++
      }
    }
    o = qp(lo, hi)
    console.error('crest pass', pass, 'moved', moved)
    if (!moved) break
  }
}
const IRLS = +(process.env.IRLS ?? 0), PW = +(process.env.PW ?? 2)
for (let r = 0; r < IRLS; r++) {
  const k2 = new Float64Array(m)
  for (let j = 1; j < m - 1; j++) { const ax = px[i0 + j - 1] + Nx[j - 1][0] * o[j - 1], az = pz[i0 + j - 1] + Nx[j - 1][1] * o[j - 1], bx = px[i0 + j] + Nx[j][0] * o[j], bz = pz[i0 + j] + Nx[j][1] * o[j], cx = px[i0 + j + 1] + Nx[j + 1][0] * o[j + 1], cz = pz[i0 + j + 1] + Nx[j + 1][1] * o[j + 1]; k2[j] = Math.hypot(ax - 2 * bx + cx, az - 2 * bz + cz) }
  // smooth the weights a little (a window of 5) so the solve stays well posed
  const mean = k2.reduce((a, b) => a + b, 0) / m
  for (let j = 1; j < m - 1; j++) { let s = 0, c = 0; for (let k = Math.max(1, j - 4); k <= Math.min(m - 2, j + 4); k++) { s += k2[k]; c++ } WJ[j] = WJ[j] * Math.pow(Math.max(0.05, s / c / mean), PW / IRLS) }
  o = qp(lo, hi)
}
const x = [], z = []; for (let j = 0; j < m; j++) { x.push(px[i0 + j] + Nx[j][0] * o[j]); z.push(pz[i0 + j] + Nx[j][1] * o[j]) }
const R = []
for (let j = 0; j < m; j++) {
  const a = Math.max(0, j - 3), c = Math.min(m - 1, j + 3)
  const h1 = Math.atan2(x[j] - x[a], z[j] - z[a]), h2 = Math.atan2(x[c] - x[j], z[c] - z[j])
  let dh = h2 - h1; dh = Math.atan2(Math.sin(dh), Math.cos(dh))
  const ds = Math.hypot(x[j] - x[a], z[j] - z[a]) + Math.hypot(x[c] - x[j], z[c] - z[j])
  R.push(ds / 2 / Math.max(1e-6, Math.abs(dh)))
}
let len = 0, yaw = 0; for (let j = S - i0; j < F - i0; j++) len += Math.hypot(x[j + 1] - x[j], z[j + 1] - z[j])
for (let j = S - i0 + 1; j < F - i0; j++) { let dh = Math.atan2(x[j + 1] - x[j], z[j + 1] - z[j]) - Math.atan2(x[j] - x[j - 1], z[j] - z[j - 1]); yaw += Math.abs(Math.atan2(Math.sin(dh), Math.cos(dh))) }
fs.writeFileSync(out, JSON.stringify({ i0, x, z, R, o: Array.from(o), H }))
const Rs = R.slice(S - i0 + 5, F - i0).sort((a, b) => a - b)
console.log(JSON.stringify({ out, len: Math.round(len), yawRad: +yaw.toFixed(2), minR: Rs.slice(0, 3).map(Math.round), p5: Math.round(Rs[Math.floor(Rs.length * 0.05)]), p20: Math.round(Rs[Math.floor(Rs.length * 0.2)]), gates: d.cps.map((c) => Math.round(o[c.i - i0])).join(' ') }))
