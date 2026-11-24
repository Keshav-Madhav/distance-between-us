// LOD for the world's shapes (mesas, spires, ice, basalt, groves, trackside rocks and trees, clutter).
// Each shape gets a simplified twin (meshoptimizer via three's SimplifyModifier) at ~30% of its
// triangles; which one an object draws is chosen per frame by lodFade (motion-aware, below), with a
// dithered crossfade between them.
import * as THREE from 'three'
import { fromArrays, refinedRaw, simplifiedRaw, toArrays, type GeoArrays } from './geomath'
import { CASTER_LAYER } from './shadow'

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
/**
 * The quality tier's say over every LodPair: the score is scaled by `bias` (under 1: lighter shapes
 * nearer) and the refined close-up form can be switched off (weaker GPUs: it is ~16× the triangles).
 */
export const LOD = { bias: 1, up: true, cut: 0 }
// (`cut`: a score under which a shape is not drawn at all — a speck — dithered out over cut … 1.6 × cut.)
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

/** Resolves a moment after boot, one caller at a time (heavy geometry work spread over idle frames). */
let bootQueue: Promise<void> = new Promise((r) => setTimeout(r, 2500))
export function afterBoot(): Promise<void> {
  const p = bootQueue.then(() => new Promise<void>((r) => (window.requestIdleCallback ? window.requestIdleCallback(() => r(), { timeout: 400 }) : setTimeout(r, 30))))
  bootQueue = p
  return p
}
const cache = new Map<THREE.BufferGeometry, Promise<THREE.BufferGeometry>>()

// ── Off the main thread ──
// The refined forms and simplified twins are built in workers (src/geoworker.ts), from boot: run on the
// main thread in idle callbacks, each was one long task — with the game drawing every frame there is
// no idle time, so their 400 ms timeouts forced them in mid-race (stalls of 100–380 ms at the start).
const workers: Worker[] = []
let workerOk = true, nextJob = 0, rr = 0
const pending = new Map<number, (d: GeoArrays & { none?: boolean; fail?: boolean }) => void>()
function worker(): Worker | null {
  if (!workerOk) return null
  if (!workers.length) {
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2))
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./geoworker.ts', import.meta.url), { type: 'module' })
        w.onmessage = (e: MessageEvent<GeoArrays & { id: number; none?: boolean }>) => { const f = pending.get(e.data.id); pending.delete(e.data.id); f?.(e.data) }
        // (A worker that fails — will not start, or dies: every job it holds falls back to the main thread, not
        // left waiting forever with the shape stuck on its full form.)
        w.onerror = () => { workerOk = false; for (const [id, f] of [...pending]) { pending.delete(id); f({ attrs: [], index: null, fail: true }) } }
        workers.push(w)
      }
    } catch { workerOk = false; return null }
  }
  return workers[rr++ % workers.length]
}
function job(op: 'refine' | 'simplify', g: THREE.BufferGeometry, keep: number, local: () => THREE.BufferGeometry | null | Promise<THREE.BufferGeometry | null>): Promise<THREE.BufferGeometry | null> {
  const w = worker()
  // (No worker: the old way, one at a time in idle time.)
  if (!w) return afterBoot().then(local)
  const id = nextJob++
  return new Promise<THREE.BufferGeometry | null>((done) => {
    pending.set(id, (d) => { if (d.fail) void afterBoot().then(local).then(done); else done(d.none ? null : fromArrays(d)) })
    const msg = { id, op, keep, ...toArrays(g, true, ['normal', 'aKeep']) }
    try { w.postMessage(msg, [...msg.attrs.map((a) => a[1].buffer), ...(msg.index ? [msg.index.buffer] : [])]) }
    catch { pending.delete(id); void afterBoot().then(local).then(done) }
  })
}
const refinedCache = new Map<THREE.BufferGeometry, Promise<THREE.BufferGeometry>>()
/** The close-up form of `g` (see src/geomath.ts), built off the main thread. */
export function refined(g: THREE.BufferGeometry): Promise<THREE.BufferGeometry> {
  let p = refinedCache.get(g)
  if (!p) refinedCache.set(g, (p = job('refine', g, 0, () => refinedRaw(g)).then((r) => r ?? g)))
  return p
}
/** The simplified twin of `g` (≈ `keep` of its triangles), built off the main thread; `g` itself when
 *  it is not worth having. */
export function simplified(g: THREE.BufferGeometry, keep = 0.3): Promise<THREE.BufferGeometry> {
  let p = cache.get(g)
  if (!p) cache.set(g, (p = job('simplify', g, keep, () => simplifiedRaw(g, keep)).then((r) => r ?? g)))
  return p
}
/**
 * Swapping a finished shape in uploads it to the GPU on the next draw: at most one a frame (the frame
 * loop calls `drainSwaps`), so a batch of results landing together is not one long frame.
 */
const swaps: (() => void)[] = []
export function swapLater(f: () => void): void { swaps.push(f) }
export function drainSwaps(): void { const f = swaps.shift(); if (f) f() }

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
  private readonly upShadow: THREE.InstancedMesh
  private readonly hiShadow: THREE.InstancedMesh
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
    void refined(geo).then((g) => swapLater(() => { const r = view(g); r.setAttribute('aKeep', this.keepUp); this.up.geometry = r }))
    // (Until the twin is ready the far ones draw the full shape: same look, just not cheaper yet.)
    this.lo = make(view(geo), this.keepLo)
    // Shadows from the light twin: the close-up and full forms cast as the simplified shape (the same
    // instances; a shadow shows no surface detail) — the refined form is ~16× the triangles and both
    // shadow maps drew it. Only the shadow camera sees these stand-ins.
    const stand = (src: THREE.InstancedMesh) => {
      const m = new THREE.InstancedMesh(view(geo), mat, n)
      m.instanceMatrix = src.instanceMatrix
      m.frustumCulled = false
      m.count = 0
      m.visible = false
      m.layers.set(CASTER_LAYER)
      src.userData.noCast = true
      this.node.add(m)
      return m
    }
    this.upShadow = stand(this.up)
    this.hiShadow = stand(this.hi)
    // (After the world is up: simplifying every shape during boot doubled its 'world' step; until then the
    // far ones simply draw the full shape.)
    void simplified(geo).then((g) => swapLater(() => {
      const v = view(g)
      v.setAttribute('aKeep', this.keepLo)
      this.lo.geometry = v
      this.upShadow.geometry = v; this.hiShadow.geometry = v
    }))
  }
  begin(): void { this.kh = 0; this.kl = 0; this.ku = 0 }
  /** `m`: 16 floats (column-major) at `o`; `a`: the score from lodFade. */
  put(m: ArrayLike<number>, o: number, a: number): void {
    a *= LOD.bias
    // Too small to matter on this tier: dissolved out, then skipped.
    const gone = LOD.cut > 0 ? 1 - band(a, LOD.cut, LOD.cut * 1.6) : 0
    if (gone >= 1) return
    const up = LOD.up ? band(a, 3.2, 4.8) : 0
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
      ;(this.keepLo.array as Float32Array)[this.kl++] = fade > 0 ? -fade : gone > 0 ? -gone : 0
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
    this.upShadow.count = this.ku; this.upShadow.visible = this.ku > 0
    this.hiShadow.count = this.kh; this.hiShadow.visible = this.kh > 0
  }
}
