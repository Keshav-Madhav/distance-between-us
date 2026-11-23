// Speed LOD for the world's shapes (mesas, spires, ice, basalt, groves, trackside rocks and trees).
// Each shape gets a simplified twin (meshoptimizer via three's SimplifyModifier) at ~30% of its
// triangles. Objects near the camera draw the full shape; past `hiDist` they draw the twin, and
// `hiDist` shrinks with speed: at a standstill everything within 3 km is full detail, flat out only
// the last few hundred metres are (at Mach 7 the rest is past in a fraction of a second, under blur).
import * as THREE from 'three'
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

/** Full-detail radius (m): 3 km at rest, down to 700 m at Mach 6.5+. */
export function hiDistFor(mach: number): number {
  const t = THREE.MathUtils.smoothstep(mach, 1.5, 6.5)
  return 3000 + (700 - 3000) * t
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
