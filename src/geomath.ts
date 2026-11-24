// Geometry maths shared by the main thread and src/geoworker.ts (which runs it off the main thread):
// the refined close-up form and the simplified twin of a shape (see src/lod.ts).
import * as THREE from 'three'
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

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
export function refinedRaw(g: THREE.BufferGeometry): THREE.BufferGeometry {
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

/** The simplified twin (≈ `keep` of the triangles), or null when it is not worth having. Flat-shaded
 *  faces are welded first (normals dropped, rebuilt after), so edges can collapse; other attributes
 *  ride along, and a change in them keeps a seam: bark never melts into foliage. */
export async function simplifiedRaw(g: THREE.BufferGeometry, keep: number): Promise<THREE.BufferGeometry | null> {
  const m = new THREE.BufferGeometry()
  for (const [k, a] of Object.entries(g.attributes)) if (k !== 'normal' && k !== 'aKeep') m.setAttribute(k, a)
  if (g.index) m.setIndex(g.index)
  const w = mergeVertices(m.index ? m.toNonIndexed() : m, 1e-3)
  const tris = w.index!.count / 3
  if (tris < 120) return null // (nothing worth saving)
  const s = await new SimplifyModifier().modify(w, Math.floor(w.attributes.position.count * (1 - keep)))
  // (A shape that will not simplify — all seams — keeps its full geometry.)
  if (!s.index || s.index.count / 3 > tris * 0.85) return null
  s.computeVertexNormals()
  s.computeBoundingSphere()
  return s
}

/** A geometry as plain arrays (for a worker message) and back. */
export interface GeoArrays { attrs: [string, Float32Array | Uint16Array | Uint32Array | Int16Array | Uint8Array | Int8Array, number, boolean][]; index: Uint16Array | Uint32Array | null }
export function toArrays(g: THREE.BufferGeometry, copy: boolean, skip: string[] = []): GeoArrays {
  const attrs: GeoArrays['attrs'] = []
  for (const [k, a] of Object.entries(g.attributes)) {
    if (skip.includes(k)) continue
    const A = a as THREE.BufferAttribute
    const arr = A.array as GeoArrays['attrs'][number][1]
    attrs.push([k, copy ? arr.slice() : arr, A.itemSize, A.normalized])
  }
  const ix = g.index ? (g.index.array as Uint16Array | Uint32Array) : null
  return { attrs, index: ix ? (copy ? ix.slice() : ix) : null }
}
export function fromArrays(d: GeoArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  for (const [k, arr, size, norm] of d.attrs) g.setAttribute(k, new THREE.BufferAttribute(arr, size, norm))
  if (d.index) g.setIndex(new THREE.BufferAttribute(d.index, 1))
  g.computeBoundingSphere()
  return g
}
