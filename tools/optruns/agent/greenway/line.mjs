// Min-curvature racing line for GREENWAY (whole 2-lap race as one open path), box-constrained lateral
// offsets, solved by multi-resolution projected coordinate descent.
// usage: node line.mjs cfg.json out-line.json
// cfg: { W: corridor half width (ideal 255), Wgate: |u| at gates, obsM: obstacle margin, useObs: bool,
//        pads: true|false|[indices], padTol, mu (length weight), moundSide: [+1|-1,...], H: sample step (idx) }
import fs from 'node:fs'
const [cf, out] = process.argv.slice(2)
const cfg = JSON.parse(fs.readFileSync(cf, 'utf8'))
const C = JSON.parse(fs.readFileSync(new URL('./course.json', import.meta.url), 'utf8'))
const { px, pz, startI, finishI } = C
const H = cfg.H ?? 2
const W = cfg.W ?? 255
const tang = (i) => { const a = Math.max(0, i - 2), b = Math.min(px.length - 1, i + 2); const dx = px[b] - px[a], dz = pz[b] - pz[a], L = Math.hypot(dx, dz); return [dx / L, dz / L] }
// samples: from the player's start to the finish gate index + a bit
const S = []
for (let i = startI - 2; i <= finishI + 4; i += H) S.push(i)
const N = S.length
const cx = S.map((i) => px[i]), cz = S.map((i) => pz[i])
// normal = (tz, -tx) (the game's "right"): P = C + n*u
const nx = [], nz = []
for (const i of S) { const [tx, tz] = tang(i); nx.push(tz); nz.push(-tx) }
const lo = new Float64Array(N).fill(-W), hi = new Float64Array(N).fill(W)
const latOf = (k, x, z) => (x - cx[k]) * nx[k] + (z - cz[k]) * nz[k]
const alongOf = (k, x, z) => { const [tx, tz] = tang(S[k]); return (x - cx[k]) * tx + (z - cz[k]) * tz }
// gates
const gk = C.cps.map((q) => { let b = 0, bd = 1e18; for (let k = 0; k < N; k++) { const d = Math.abs(S[k] - q[4]); if (d < bd) { bd = d; b = k } } return b })
const Wg = cfg.Wgate ?? 320
for (const k of gk) for (let d = -1; d <= 1; d++) { const kk = k + d; if (kk >= 0 && kk < N) { lo[kk] = Math.max(lo[kk], -Wg); hi[kk] = Math.min(hi[kk], Wg) } }
// obstacles (survey) + mounds
const obs = cfg.useObs ? C.obs.map((o) => ({ x: o[0], z: o[1], r: o[2] + (o[3] ? (cfg.obsMBig ?? 100) : (cfg.obsM ?? 50)) })) : []
const ms = C.mounds; const mside = cfg.moundSide ?? []
for (let m = 0; m < ms.length; m += 4) obs.push({ x: ms[m], z: ms[m + 1], r: ms[m + 3] + (cfg.moundM ?? 40), side: mside[m / 4] })
// lap-aware: an obstacle only applies to samples whose centre point is near it
for (const o of obs) {
  if (o.side == null) { let bd = 1e18, bl = 0; for (let k = 0; k < N; k++) { const d = Math.hypot(cx[k] - o.x, cz[k] - o.z); if (d < bd) { bd = d; bl = latOf(k, o.x, o.z) } } o.side = bl >= 0 ? 1 : -1 }
  for (let k = 0; k < N; k++) {
    if (Math.abs(cx[k] - o.x) > o.r + 2000 || Math.abs(cz[k] - o.z) > o.r + 2000) continue
    const a = alongOf(k, o.x, o.z); if (Math.abs(a) > o.r) continue
    const l = latOf(k, o.x, o.z), half = Math.sqrt(o.r * o.r - a * a)
    const side = o.side
    if (side > 0) hi[k] = Math.min(hi[k], l - half); else lo[k] = Math.max(lo[k], l + half)
  }
}
// pads: in race order, each to the nearest sample after the previous
const padTol = cfg.padTol ?? 14
let kp = 0; const padK = []
C.pads.forEach((p, j) => {
  let b = -1, bd = 1e18
  for (let k = kp; k < Math.min(N, kp + 400); k++) { const d = Math.hypot(cx[k] - p[0], cz[k] - p[1]); if (d < bd) { bd = d; b = k } }
  padK.push(b); kp = b + 1
  const use = cfg.pads === true || (Array.isArray(cfg.pads) && cfg.pads.includes(j))
  if (use) { const l = latOf(b, p[0], p[1]); for (let d = -(cfg.padSpan ?? 0); d <= (cfg.padSpan ?? 0); d++) { lo[b + d] = Math.max(lo[b + d], l - padTol); hi[b + d] = Math.min(hi[b + d], l + padTol) } }
})
// start: pinned at the player's position laterally (fixed first 2 samples)
const p0 = C.p0
const u = new Float64Array(N)
for (let k = 0; k < N; k++) u[k] = Math.max(lo[k], Math.min(hi[k], 0))
let bad = 0; for (let k = 0; k < N; k++) if (lo[k] > hi[k]) { bad++; const m = (lo[k] + hi[k]) / 2; lo[k] = hi[k] = m }
const u0 = latOf(0, p0.x, p0.z); lo[0] = hi[0] = u0; u[0] = u0
const mu = cfg.mu ?? 0
const wt = new Float64Array(N).fill(1)
const X = (k) => cx[k] + nx[k] * u[k], Z = (k) => cz[k] + nz[k] * u[k]
// coordinate descent over a stride s (treating every s-th sample as the variable chain, others interpolated)
function solve(s, iters) {
  const idx = []; for (let k = 0; k < N; k += s) idx.push(k); if (idx[idx.length - 1] !== N - 1) idx.push(N - 1)
  const M = idx.length
  for (let it = 0; it < iters; it++) {
    for (let j = 1; j < M - 1; j++) {
      const k = idx[j]
      let g = 0, q = 0
      for (const [a, b, c, w] of [[j - 2, j - 1, j, 1], [j - 1, j, j + 1, -2], [j, j + 1, j + 2, 1]]) {
        if (a < 0 || c >= M) continue
        const ka = idx[a], kb = idx[b], kc = idx[c], ww = wt[kb]
        const dx = X(ka) - 2 * X(kb) + X(kc), dz = Z(ka) - 2 * Z(kb) + Z(kc)
        g += ww * w * (nx[k] * dx + nz[k] * dz); q += ww * w * w
      }
      if (mu) { for (const a of [j - 1, j + 1]) { const ka = idx[a]; g += mu * (nx[k] * (X(k) - X(ka)) + nz[k] * (Z(k) - Z(ka))); q += mu } }
      let v = u[k] - g / q
      // the band lo/hi over the samples this chain point stands for
      let L = lo[k], Hh = hi[k]
      v = Math.max(L, Math.min(Hh, v)); u[k] = v
    }
    if (s > 1) { // interpolate between, clamped to bounds
      for (let j = 0; j < M - 1; j++) { const a = idx[j], b = idx[j + 1]; for (let k = a + 1; k < b; k++) { const f = (k - a) / (b - a); u[k] = Math.max(lo[k], Math.min(hi[k], u[a] * (1 - f) + u[b] * f)) } }
    }
  }
}
for (const [s, n] of cfg.sched ?? [[32, 3000], [16, 3000], [8, 3000], [4, 3000], [2, 2000], [1, 2000]]) solve(s, n)
// IRLS toward a minimax curvature: weight each bend by its (smoothed) curvature over the reference
const curvSm = () => { const P = []; for (let k = 0; k < N; k++) P.push([X(k), Z(k)]); const r = new Float64Array(N); const h = (i) => Math.atan2(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); for (let k = 4; k < N - 5; k++) { const d = Math.atan2(Math.sin(h(k + 4) - h(k - 4)), Math.cos(h(k + 4) - h(k - 4))); r[k] = Math.abs(d) / Math.hypot(P[k + 4][0] - P[k - 4][0], P[k + 4][1] - P[k - 4][1]) } return r }
for (let rw = 0; rw < (cfg.rw ?? 0); rw++) {
  const r = curvSm(); const kr = 1 / (cfg.Rref ?? 3500)
  for (let k = 0; k < N; k++) wt[k] = wt[k] * 0.5 + 0.5 * (1 + (cfg.rwA ?? 4) * Math.max(0, r[k] / kr - 0.6) ** (cfg.rwP ?? 2))
  for (const [s, n] of [[8, 1500], [4, 1500], [2, 1500], [1, 1500]]) solve(s, n)
}
{ const r = curvSm(); let mx = 0; for (let k = 0; k < N; k++) mx = Math.max(mx, r[k]); console.error('min smoothed R', Math.round(1 / mx)) }
// report
const pts = []; for (let k = 0; k < N; k++) pts.push([+X(k).toFixed(1), +Z(k).toFixed(1)])
let len = 0, sumK2 = 0, maxK = 0, turn = 0
for (let k = 1; k < N; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])
const kap = new Array(N).fill(0)
for (let k = 1; k < N - 1; k++) { const h0 = Math.atan2(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]), h1 = Math.atan2(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]); const d = Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)); const ds = Math.hypot(pts[k + 1][0] - pts[k - 1][0], pts[k + 1][1] - pts[k - 1][1]) / 2; kap[k] = d / ds; turn += Math.abs(d); maxK = Math.max(maxK, Math.abs(d / ds)) }
fs.writeFileSync(out, JSON.stringify({ cfg, S, u: Array.from(u).map((v) => +v.toFixed(1)), pts, padK, gk, kap: kap.map((v) => +v.toExponential(3)) }))
console.log(JSON.stringify({ N, bad, len: Math.round(len), turnRad: +turn.toFixed(2), minR: Math.round(1 / maxK), maxU: Math.round(Math.max(...u.map(Math.abs))) }))
