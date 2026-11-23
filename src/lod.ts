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
/** 0 → twin only, 1 → full only; in between both, dithered (a crossfade band, no pop). */
export function lodFade(dx: number, dz: number, reach: number, v: LodView): number {
  const d = Math.max(1, Math.hypot(dx, dz) - reach * 0.5)
  const w = Math.abs(v.vx * dz - v.vz * dx) / (d * d)
  const score = reach / d / (1 + w * TAU)
  const a = score / LOD_THRESHOLD
  return a >= 1.25 ? 1 : a <= 0.8 ? 0 : (a - 0.8) / 0.45
}

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
  private readonly keepHi: THREE.InstancedBufferAttribute
  private readonly keepLo: THREE.InstancedBufferAttribute
  private kh = 0
  private kl = 0
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
    this.hi = make(view(geo), this.keepHi)
    // (Until the twin is ready the far ones draw the full shape: same look, just not cheaper yet.)
    this.lo = make(view(geo), this.keepLo)
    void simplified(geo).then((g) => {
      const v = view(g)
      v.setAttribute('aKeep', this.keepLo)
      this.lo.geometry = v
    })
  }
  begin(): void { this.kh = 0; this.kl = 0 }
  /** `m`: 16 floats (column-major) at `o`; `fade` from lodFade. */
  put(m: ArrayLike<number>, o: number, fade: number): void {
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
    for (const [m, k, keep] of [[this.hi, this.kh, this.keepHi], [this.lo, this.kl, this.keepLo]] as const) {
      m.count = k
      m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, k * 16); m.instanceMatrix.needsUpdate = true
      keep.clearUpdateRanges(); keep.addUpdateRange(0, k); keep.needsUpdate = true
    }
  }
}
