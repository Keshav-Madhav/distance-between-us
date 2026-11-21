// FROSTLINE's landforms: where the desert has mesas, buttes and hoodoos, the ice world has glaciers,
// seracs and clusters of ice spikes. Same slots, same placement and collision (a radial profile per
// shape: radius multiplier at angle th and height fraction t), different geometry.
import * as THREE from 'three'

export type IceKind = 'mesa' | 'butte' | 'spire'
type Profile = (th: number, t: number) => number

export const ICE_VARIANTS: Record<IceKind, number> = { mesa: 4, butte: 3, spire: 3 }

const sm = (a: number, b: number, x: number) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u) }
function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
const FOOT = -0.08

/**
 * A closed solid of revolution with a free outline and a free crown: rows climb the wall from the
 * buried foot to the rim, then walk in across the top to the centre. `prof` shapes the wall,
 * `crown(th, rho)` is the top's height (rho 1 = the rim, 0 = the centre).
 */
function shell(prof: Profile, crown: (th: number, rho: number) => number, radial: number, wallSegs: number, topRings: number, jitter = 0, crev: ((th: number, t: number) => number) | null = null, seed = 1): THREE.BufferGeometry {
  const pos: number[] = []
  const cv: number[] = []
  const rows = wallSegs + 1 + topRings
  // Uneven slabs: each column's angle jittered (flat shading turns them into broken ice faces).
  const r = rng(seed * 7 + 3)
  const ths: number[] = []
  for (let j = 0; j < radial; j++) ths.push(((j + (r() - 0.5) * jitter) / radial) * Math.PI * 2)
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < radial; j++) {
      const th = ths[j]
      const c = Math.cos(th), s = Math.sin(th)
      if (i <= wallSegs) {
        const top = crown(th, 1)
        const y = FOOT + ((top - FOOT) * i) / wallSegs
        const t = Math.max(0, Math.min(1, y))
        const k = prof(th, t)
        pos.push(c * k, y, s * k)
        cv.push(crev ? crev(th, t) : 0)
      } else {
        const rho = 1 - (i - wallSegs) / topRings
        const k = prof(th, 1) * rho
        pos.push(c * k, crown(th, rho), s * k)
        cv.push(0)
      }
    }
  }
  const idx: number[] = []
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < radial; j++) {
    const j1 = (j + 1) % radial
    const a = i * radial + j, b = i * radial + j1, c = (i + 1) * radial + j, d = (i + 1) * radial + j1
    idx.push(a, c, b, b, c, d)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aCrev', new THREE.Float32BufferAttribute(cv, 1))
  g.setIndex(idx)
  return orient(g)
}

/** Flip the winding if the faces point inward (checked on the wall against the axis). */
function orient(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.computeVertexNormals()
  const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute
  let dot = 0
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.3) dot += p.getX(i) * n.getX(i) + p.getZ(i) * n.getZ(i)
  if (dot < 0 && g.index) {
    const ix = g.index
    for (let i = 0; i < ix.count; i += 3) { const a = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, a) }
  }
  const out = g.index ? g.toNonIndexed() : g
  if (!out.attributes.aCrev) out.setAttribute('aCrev', new THREE.Float32BufferAttribute(new Float32Array(out.attributes.position.count), 1))
  out.computeVertexNormals()
  return out
}

/** Glaciers: ice sheets with sheer, crevassed, slab-faced walls, a calving lip and a snow-domed top. */
function glacier(seed: number, v: number) {
  const r = rng(seed)
  const harm: [number, number][] = []
  for (let i = 2; i <= 7; i++) harm.push([(0.16 / i) * (0.4 + r()), r() * 6.28])
  const elong = [0.16, 0.36, 0.12, 0.08][v], eph = r() * 6.28
  const phi = r() * 6.28
  const cvs: [number, number, number][] = [[11 + Math.floor(r() * 4), r() * 6.28, 0.12], [19 + Math.floor(r() * 6), r() * 6.28, 0.08], [31, r() * 6.28, 0.05]]
  const lipPh = r() * 6.28
  // How deep the crevasse slots cut here (0 … ~1): shapes the wall and darkens the slots.
  const crev = (th: number, t: number) => {
    let c = 0
    for (const [n, p, d] of cvs) c += (d / 0.12) * Math.pow(Math.max(0, Math.sin(n * th + p)), 10)
    return Math.min(1, c) * (0.5 + 0.5 * t)
  }
  const prof: Profile = (th, t) => {
    let k = 1 + elong * Math.cos(2 * th + eph)
    for (let i = 0; i < harm.length; i++) k += harm[i][0] * Math.sin((i + 2) * th + harm[i][1])
    for (const [n, p, d] of cvs) k *= 1 - d * (0.5 + 0.5 * t) * Math.pow(Math.max(0, Math.sin(n * th + p)), 10)
    // Batter, a snowdrift ramped against the foot, and the upper rim leaning out where it calves.
    k *= 1 + 0.1 * (1 - t)
    const drift = 1 - sm(0, 0.16, t)
    k *= 1 + 0.3 * drift * drift
    k *= 1 + 0.07 * sm(0.78, 1, t) * Math.max(0, Math.sin(4 * th + lipPh))
    if (v === 3) { k *= 1 - 0.17 * sm(0.33, 0.37, t); k *= 1 - 0.2 * sm(0.64, 0.68, t) } // icefall tiers
    return k
  }
  const crown = (th: number, rho: number) => {
    if (v === 1) { // a tongue: the sheet slopes away down one end
      const a = rho * Math.cos(th - phi)
      return 1 + 0.05 * (1 - rho * rho) - 0.48 * sm(-0.3, 1, a)
    }
    if (v === 2) { // broken: big serac blocks, each tilted its own way
      const cell = Math.floor((th / 6.2832) * 6) * 7 + Math.floor(rho * 2.2) * 13
      const h = Math.sin(cell * 12.9898 + seed) * 43758.5453, f = h - Math.floor(h)
      return 0.88 + 0.22 * f + 0.06 * Math.sin(th * 6 + f * 6) * rho + 0.04 * (1 - rho)
    }
    return 1 + 0.1 * (1 - rho * rho) + 0.03 * Math.sin(3 * th + phi) * rho
  }
  return { geo: shell(prof, crown, 26, 14, v === 2 ? 6 : 4, 0.7, crev, seed), prof }
}

/** Seracs and stranded bergs: few-sided, slab-faced blocks with tilted or peaked tops. */
function serac(seed: number, v: number) {
  const r = rng(seed)
  const sides = [7, 8, 6][v]
  const harm: [number, number][] = []
  for (let i = 2; i <= 4; i++) harm.push([(0.14 / i) * (0.4 + r()), r() * 6.28])
  const phi = r() * 6.28
  const prof: Profile = (th, t) => {
    let k = 1
    for (let i = 0; i < harm.length; i++) k += harm[i][0] * Math.sin((i + 2) * th + harm[i][1])
    const drift = 1 - sm(0, 0.14, t)
    k *= 1 + 0.25 * drift * drift
    if (v === 2) k *= 1 - 0.6 * Math.pow(sm(0.05, 1, t), 0.8) // tall, tapering serac
    if (v === 1) k *= 1 + 0.06 * sm(0.75, 0.95, t) // overhanging lip
    if (v !== 2) k *= 1 - 0.18 * sm(0.2, 1, t) // walls lean in a little
    return k
  }
  const crown = (th: number, rho: number) => {
    if (v === 0) return 1 + 0.22 * rho * Math.cos(th - phi) // a tilted slab
    if (v === 1) return 1 + 0.2 * rho * Math.cos(2 * (th - phi)) - 0.05 // a saddle between two horns
    return 1 + 0.5 * (1 - rho) + 0.12 * rho * Math.cos(th - phi) // a peaked, broken serac
  }
  return { geo: shell(prof, crown, sides, 6, 2, 0.8, null, seed), prof }
}

interface Shard { cx: number; cz: number; r0: number; h: number; lx: number; lz: number; top: number }

/** Shard radius at height y: concave taper ((1 - u)^1.6) to a point, or to a snapped-off top. */
const shardR = (s: Shard, y: number) => s.r0 * Math.pow(Math.max(0, 1 - (y - FOOT) / (s.h - FOOT)), 1.6)

/** Ice spikes: a cluster of faceted shards (a main spike, leaning satellites at uneven angles). */
function spikes(seed: number, v: number) {
  const r = rng(seed)
  const shards: Shard[] = [{ cx: 0, cz: 0, r0: 1, h: 1.15, lx: (r() - 0.5) * 0.1, lz: (r() - 0.5) * 0.1, top: 1 }]
  const n = [4, 6, 7][v]
  const angs: number[] = []
  let tries = 0
  while (angs.length < n && tries++ < 200) {
    const a = r() * 6.2832
    if (angs.every((b) => Math.abs(((a - b + 9.42) % 6.2832) - 3.14) > 0.45)) angs.push(a)
  }
  for (const a of angs) {
    const d = v === 2 ? 0.9 + r() * 0.45 : 0.55 + r() * 0.75
    const out = v === 2 ? 0.3 + r() * 0.25 : 0.06 + r() * 0.3
    shards.push({
      cx: Math.cos(a) * d, cz: Math.sin(a) * d,
      r0: v === 1 ? 0.55 + r() * 0.4 : 0.3 + r() * 0.4,
      h: (v === 1 ? 0.5 + r() * 0.5 : v === 2 ? 0.45 + r() * 0.35 : 0.25 + r() * 0.45) * (0.8 + 0.4 * r()),
      lx: Math.cos(a) * out + (r() - 0.5) * 0.15, lz: Math.sin(a) * out + (r() - 0.5) * 0.15,
      top: r() < 0.3 ? 0.55 + r() * 0.25 : 1, // some snapped off
    })
  }
  const parts: number[] = []
  for (const s of shards) {
    const sides = 5 + Math.floor(r() * 3)
    const c = new THREE.CylinderGeometry(1, 1, 1, sides, 6, false)
    c.rotateY(r() * 6.28)
    const p = c.attributes.position as THREE.BufferAttribute
    const yTop = FOOT + (s.h - FOOT) * s.top
    // A snapped top is cut at a slant.
    const cutA = r() * 6.28
    for (let i = 0; i < p.count; i++) {
      const u = p.getY(i) + 0.5
      let y = FOOT + (yTop - FOOT) * u
      const rr = shardR(s, y)
      if (u > 0.999 && s.top < 1) y += 0.06 * (p.getX(i) * Math.cos(cutA) + p.getZ(i) * Math.sin(cutA))
      p.setXYZ(i, p.getX(i) * rr + s.cx + s.lx * y, y, p.getZ(i) * rr + s.cz + s.lz * y)
    }
    const nn = c.toNonIndexed()
    parts.push(...(nn.attributes.position.array as Float32Array))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(parts, 3))
  g.setAttribute('aCrev', new THREE.Float32BufferAttribute(new Float32Array(parts.length / 3), 1))
  g.computeVertexNormals()
  // Collision: along a ray from the centre at angle th, the farthest point inside any shard at t.
  const prof: Profile = (th, t) => {
    const ct = Math.cos(th), st = Math.sin(th)
    let far = 0
    for (const s of shards) {
      if (t >= FOOT + (s.h - FOOT) * s.top) continue
      const rho = shardR(s, t)
      const x = s.cx + s.lx * t, z = s.cz + s.lz * t
      const p = x * ct + z * st, q = -x * st + z * ct
      if (Math.abs(q) >= rho) continue
      far = Math.max(far, p + Math.sqrt(rho * rho - q * q))
    }
    return far
  }
  return { geo: g, prof }
}

export function iceGeometry(kind: IceKind, seed: number, v: number): { geo: THREE.BufferGeometry; prof: Profile } {
  if (kind === 'mesa') return glacier(seed, v)
  if (kind === 'butte') return serac(seed, v)
  return spikes(seed, v)
}
