// LOD for the world's shapes (mesas, spires, ice, basalt, groves, trackside rocks and trees, clutter).
// Each shape gets a simplified twin (meshoptimizer via three's SimplifyModifier) at ~30% of its
// triangles; which one an object draws is chosen per frame by lodFade (motion-aware, below), with a
// dithered crossfade between them.
import * as THREE from 'three'
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Motion-aware LOD. The usual choice is by projected size (reach / distance, how big it looks). At
 * Mach 7 that is not the whole story: what matters is how long the eye can hold it. A thing dead ahead
 * barely moves across the screen while it grows — you are looking right at it — while one beside you
 * crosses the view in a blur. So the score is size over smear:
 *
 *     score = (reach / d) / (1 + ω·τ),   ω = |v × dir| / d   (its angular speed across the view)
 *
 * At a standstill ω = 0 and this is plain projected size; at speed the things you are about to meet
 * stay full detail while the ones streaking past drop to the twin, with no speed constants to tune.
 * (The per-object cousin of NVIDIA's Motion Adaptive Shading, which lowers shading rate where motion
 * blur hides it.) τ ≈ how long a smear must last to hide detail.
 */
const TAU = 0.25
/** Projected size (rad) above which the full shape is drawn: a 40 m object to ~3 km at rest. */
export const LOD_THRESHOLD = 0.0135
export interface LodView { cx: number; cz: number; vx: number; vz: number }
/** The score over the threshold: < 0.8 twin, 0.8-1.25 twin/full crossfade, full, and from 3.2 to
 *  4.8 full/close-up crossfade, above it the close-up form (refined). */
export function lodFade(dx: number, dz: number, reach: number, v: LodView): number {
  const d = Math.max(1, Math.hypot(dx, dz) - reach * 0.5)
  const w = Math.abs(v.vx * dz - v.vz * dx) / (d * d)
  return reach / d / (1 + w * TAU) / LOD_THRESHOLD
}
const band = (a: number, lo: number, hi: number) => (a >= hi ? 1 : a <= lo ? 0 : (a - lo) / (hi - lo))

/**
 * Per-instance dither between the two shapes: attribute `aKeep` — 1 or 0 drawn whole; in (0,1) the full
 * shape draws where a screen-space noise is under it; negative, the twin draws where it is over -aKeep.
 * The two masks are exact complements, so mid-fade the object is whole, half each.
 */
export function patchLodDither(mat: THREE.Material): void {
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (s, r) => {
    prev.call(mat, s, r)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aKeep;\nvarying float vKeep;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKeep = aKeep;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vKeep;\nfloat lodIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }')
      .replace('void main() {', 'void main() {\n  if (vKeep != 0.0 && vKeep != 1.0) { float n = lodIgn(gl_FragCoord.xy); if (vKeep > 0.0 ? n > vKeep : n <= -vKeep) discard; }')
  }
  const key = mat.customProgramCacheKey.bind(mat)
  mat.customProgramCacheKey = () => key() + '|lodd'
}

/** A second geometry over the same buffers (so its own per-instance attributes can hang off it). */
export function view(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const v = new THREE.BufferGeometry()
  for (const [k, a] of Object.entries(g.attributes)) if (k !== 'aKeep') v.setAttribute(k, a)
  v.setIndex(g.index)
  v.boundingSphere = g.boundingSphere
  return v
}

/**
 * The close-up form: every triangle split in four (all attributes interpolated) and the surface pushed
 * by a 3D value noise of position — lumps, chips and knots the base shape is too coarse to carry. The
 * push depends only on position, so the midpoint two faces share moves the same way: no cracks.
 */
function noise3(x: number, y: number, z: number): number {
  const h = (i: number, j: number, k: number) => { const v = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return v - Math.floor(v) }
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf)
  const l = (a: number, b: number, t: number) => a + (b - a) * t
  return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w)
}
const refinedCache = new Map<THREE.BufferGeometry, THREE.BufferGeometry>()
export function refined(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let r = refinedCache.get(g)
  if (!r) refinedCache.set(g, (r = refinedRaw(g)))
  return r
}
function refinedRaw(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let src = g.index ? g.toNonIndexed() : g
  const names = Object.keys(src.attributes).filter((k) => k !== 'normal' && k !== 'aKeep')
  // One split (two for light shapes): 4x or 16x the triangles, only ever drawn close and slow.
  const passes = src.attributes.position.count / 3 < 1500 ? 2 : 1
  for (let pass = 0; pass < passes; pass++) {
    const n = src.attributes.position.count, out = new THREE.BufferGeometry()
    for (const k of names) {
      const a = src.attributes[k] as THREE.BufferAttribute, sz = a.itemSize, A = a.array as ArrayLike<number>
      const o = new Float32Array(n * 4 * sz)
      let w = 0
      const put = (i: number, j: number) => { for (let c = 0; c < sz; c++) o[w++] = (A[i * sz + c] + A[j * sz + c]) / 2 }
      for (let t = 0; t < n; t += 3) {
        const [p, q, r] = [t, t + 1, t + 2]
        // corners and midpoints: (p, pq, rp) (pq, q, qr) (rp, qr, r) (pq, qr, rp)
        put(p, p); put(p, q); put(r, p)
        put(p, q); put(q, q); put(q, r)
        put(r, p); put(q, r); put(r, r)
        put(p, q); put(q, r); put(r, p)
      }
      out.setAttribute(k, new THREE.BufferAttribute(o, sz))
    }
    src = out
  }
  src.computeBoundingSphere()
  const R = src.boundingSphere!.radius || 1, amp = R * 0.035, k = 7 / R
  const P = src.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i)
    P.setXYZ(i, x + (noise3(x * k, y * k, z * k) - 0.5) * amp, y + (noise3(x * k + 17, y * k, z * k) - 0.5) * amp * 0.6, z + (noise3(x * k, y * k + 31, z * k) - 0.5) * amp)
  }
  src.computeVertexNormals()
  src.computeBoundingSphere()
  return src
}

/** Resolves a moment after boot, one caller at a time (heavy geometry work spread over idle frames). */
let bootQueue: Promise<void> = new Promise((r) => setTimeout(r, 2500))
export function afterBoot(): Promise<void> {
  const p = bootQueue.then(() => new Promise<void>((r) => (window.requestIdleCallback ? window.requestIdleCallback(() => r(), { timeout: 400 }) : setTimeout(r, 30))))
  bootQueue = p
  return p
}
const cache = new Map<THREE.BufferGeometry, Promise<THREE.BufferGeometry>>()

/**
 * The simplified twin of `g` (≈ `keep` of its triangles). Flat-shaded faces are welded first
 * (normals dropped, rebuilt after), so edges can collapse; other attributes (the `aCrev` material
 * mask / glow) ride along, and a change in them keeps a seam: bark never melts into foliage.
 */
export function simplified(g: THREE.BufferGeometry, keep = 0.3): Promise<THREE.BufferGeometry> {
  let p = cache.get(g)
  if (p) return p
  p = (async () => {
    const m = new THREE.BufferGeometry()
    for (const [k, a] of Object.entries(g.attributes)) if (k !== 'normal') m.setAttribute(k, a)
    if (g.index) m.setIndex(g.index)
    const w = mergeVertices(m.index ? m.toNonIndexed() : m, 1e-3)
    const tris = w.index!.count / 3
    if (tris < 120) return g // (nothing worth saving)
    const s = await new SimplifyModifier().modify(w, Math.floor(w.attributes.position.count * (1 - keep)))
    // (A shape that will not simplify — all seams — keeps its full geometry.)
    if (!s.index || s.index.count / 3 > tris * 0.85) return g
    s.computeVertexNormals()
    s.computeBoundingSphere()
    return s
  })()
  cache.set(g, p)
  return p
}

export function triCount(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.attributes.position.count) / 3
}

/**
 * A full shape and its twin as two instanced meshes, filled each frame: `put` writes one instance
 * into whichever the fade asks for (both inside the crossfade band).
 */
export class LodPair {
  readonly node = new THREE.Group()
  readonly hi: THREE.InstancedMesh
  readonly lo: THREE.InstancedMesh
  readonly up: THREE.InstancedMesh
  private readonly keepHi: THREE.InstancedBufferAttribute
  private readonly keepLo: THREE.InstancedBufferAttribute
  private readonly keepUp: THREE.InstancedBufferAttribute
  private kh = 0
  private kl = 0
  private ku = 0
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, capacity: number) {
    const n = Math.max(1, capacity)
    const make = (g: THREE.BufferGeometry, keep: THREE.InstancedBufferAttribute) => {
      g.setAttribute('aKeep', keep)
      const m = new THREE.InstancedMesh(g, mat, n)
      m.frustumCulled = false
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      m.count = 0
      this.node.add(m)
      return m
    }
    this.keepHi = new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage)
    this.keepLo = new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage)
    this.keepUp = new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage)
    this.hi = make(view(geo), this.keepHi)
    // The close-up form, built off the boot path (until then it draws the full shape).
    this.up = make(view(geo), this.keepUp)
    void afterBoot().then(() => { const r = view(refined(geo)); r.setAttribute('aKeep', this.keepUp); this.up.geometry = r })
    // (Until the twin is ready the far ones draw the full shape: same look, just not cheaper yet.)
    this.lo = make(view(geo), this.keepLo)
    // (After the world is up: simplifying every shape during boot doubled its 'world' step; until then the
    // far ones simply draw the full shape.)
    void afterBoot().then(() => simplified(geo)).then((g) => {
      const v = view(g)
      v.setAttribute('aKeep', this.keepLo)
      this.lo.geometry = v
    })
  }
  begin(): void { this.kh = 0; this.kl = 0; this.ku = 0 }
  /** `m`: 16 floats (column-major) at `o`; `a`: the score from lodFade. */
  put(m: ArrayLike<number>, o: number, a: number): void {
    const up = band(a, 3.2, 4.8)
    if (up > 0) {
      const c = this.up.instanceMatrix.array as Float32Array
      for (let i = 0; i < 16; i++) c[this.ku * 16 + i] = m[o + i]
      ;(this.keepUp.array as Float32Array)[this.ku++] = up
      if (up >= 1) return
      // Mid-band: the full shape draws the complement.
      const b = this.hi.instanceMatrix.array as Float32Array
      for (let i = 0; i < 16; i++) b[this.kh * 16 + i] = m[o + i]
      ;(this.keepHi.array as Float32Array)[this.kh++] = -up
      return
    }
    const fade = band(a, 0.8, 1.25)
    if (fade > 0) {
      const a = this.hi.instanceMatrix.array as Float32Array
      for (let i = 0; i < 16; i++) a[this.kh * 16 + i] = m[o + i]
      ;(this.keepHi.array as Float32Array)[this.kh++] = fade
    }
    if (fade < 1) {
      const b = this.lo.instanceMatrix.array as Float32Array
      for (let i = 0; i < 16; i++) b[this.kl * 16 + i] = m[o + i]
      ;(this.keepLo.array as Float32Array)[this.kl++] = fade > 0 ? -fade : 0
    }
  }
  end(): void {
    for (const [m, k, keep] of [[this.hi, this.kh, this.keepHi], [this.lo, this.kl, this.keepLo], [this.up, this.ku, this.keepUp]] as const) {
      m.count = k
      // (Nothing to draw: not drawn at all — an empty instanced mesh still cost a program bind and every
      // uniform upload each frame, in the main pass and both shadow passes.)
      m.visible = k > 0
      m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, k * 16); m.instanceMatrix.needsUpdate = true
      keep.clearUpdateRanges(); keep.addUpdateRange(0, k); keep.needsUpdate = true
    }
  }
}
