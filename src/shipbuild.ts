// Ship geometry as plain arrays: each model's parts merged per material key (positions + normals),
// hi and lo detail. Pure maths, no DOM — so it runs in a worker (src/shipworker.ts) while the page
// keeps drawing (building the six models on the main thread stalled a world switch ~400 ms), and on
// the main thread as a fallback.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { buildShip } from './shipdesign'
import { buildClassic } from './shipclassic'

export type MeshArrays = [key: string, position: Float32Array, normal: Float32Array]
export interface ModelArrays { model: number; hi: MeshArrays[]; lo: MeshArrays[]; spec: ReturnType<typeof buildClassic>['spec'] }

function merged(parts: Map<string, THREE.BufferGeometry[]> | [string, THREE.BufferGeometry[]][]): MeshArrays[] {
  const out: MeshArrays[] = []
  for (const [key, list] of parts) {
    const geos = list.map((g) => {
      const geo = g.index ? g.toNonIndexed() : g.clone()
      for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name)
      if (!geo.attributes.normal) geo.computeVertexNormals()
      return geo
    })
    const m = mergeGeometries(geos)
    out.push([key, m.attributes.position.array as Float32Array, m.attributes.normal.array as Float32Array])
  }
  return out
}

export function buildModelArrays(model: number): ModelArrays {
  const build = (hi: boolean) => (model < 3 ? buildClassic(model, hi) : buildShip(model - 3, hi))
  const H = build(true), L = build(false)
  return { model, hi: merged(H.parts), lo: merged(L.parts), spec: H.spec }
}
