// Ships modelled in Blender (art/ships/*.py → public/ships/*.glb). A minimal GLB reader: mesh
// primitives merged per material name (the name is the game's material key: paint, trim, carbon,
// metal, glass, glow, hot), node transforms applied; empties carry the game hooks (nozzle_0..2,
// wingtip, number). No textures — the livery is the paint shader's.
import * as THREE from 'three'
import type { ModelArrays } from './shipbuild'

/** Which models are Blender-built, and their files (served from public/). */
export const GLB_MODELS: Record<number, string> = { 3: 'ships/arrow.glb', 4: 'ships/brute.glb', 5: 'ships/needle.glb' }

interface GltfNode { mesh?: number; name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }
interface Gltf {
  nodes: GltfNode[]; scenes: { nodes: number[] }[]; scene?: number
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[]
  materials?: { name?: string }[]
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[]
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[]
}

const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

export function parseShipGlb(model: number, buf: ArrayBuffer): ModelArrays {
  const dv = new DataView(buf)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb')
  let off = 12, json: Gltf | null = null, bin: ArrayBuffer | null = null
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)))
    else if (type === 0x004e4942) bin = buf.slice(off + 8, off + 8 + len)
    off += 8 + len
  }
  if (!json || !bin) throw new Error('glb without json/bin')
  const g = json
  const read = (i: number): ArrayLike<number> => {
    const a = g.accessors[i], v = g.bufferViews[a.bufferView], n = a.count * SIZE[a.type]
    const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
    if (a.componentType === 5126) return new Float32Array(bin!, start, n)
    if (a.componentType === 5125) return new Uint32Array(bin!, start, n)
    if (a.componentType === 5123) return new Uint16Array(bin!, start, n)
    return new Uint8Array(bin!, start, n)
  }
  const parts = new Map<string, { p: number[]; n: number[] }>()
  const hooks = new Map<string, THREE.Vector3>(), hookVal = new Map<string, number>()
  const m4 = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3(), w = new THREE.Vector3()
  const walk = (ni: number, parent: THREE.Matrix4) => {
    const node = g.nodes[ni], local = new THREE.Matrix4()
    if (node.matrix) local.fromArray(node.matrix)
    else local.compose(new THREE.Vector3(...(node.translation ?? [0, 0, 0])), new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(node.scale ?? [1, 1, 1])))
    const world = parent.clone().multiply(local)
    if (node.mesh === undefined && node.name) {
      // (A hook's name may carry a value: "nozzle_1@0.45" — the nozzle's flame size.)
      const [nm, val] = node.name.split('@')
      hooks.set(nm, new THREE.Vector3().setFromMatrixPosition(world))
      if (val) hookVal.set(nm, +val)
    }
    if (node.mesh !== undefined) {
      m4.copy(world); nm.getNormalMatrix(m4)
      for (const pr of g.meshes[node.mesh].primitives) {
        const key = (pr.material !== undefined ? g.materials?.[pr.material]?.name : undefined)?.replace(/\.\d+$/, '') ?? 'paint'
        const P = read(pr.attributes.POSITION), N = pr.attributes.NORMAL !== undefined ? read(pr.attributes.NORMAL) : null
        const I = pr.indices !== undefined ? read(pr.indices) : null
        const out = parts.get(key) ?? { p: [], n: [] }; parts.set(key, out)
        const cnt = I ? I.length : P.length / 3
        for (let k = 0; k < cnt; k++) {
          const i = I ? I[k] : k
          v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(m4); out.p.push(v.x, v.y, v.z)
          if (N) { w.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]).applyMatrix3(nm).normalize(); out.n.push(w.x, w.y, w.z) } else out.n.push(0, 1, 0)
        }
      }
    }
    for (const c of node.children ?? []) walk(c, world)
  }
  for (const ni of g.scenes[g.scene ?? 0].nodes) walk(ni, new THREE.Matrix4())
  const hi: ModelArrays['hi'] = [...parts].map(([k, { p, n }]) => [k, new Float32Array(p), new Float32Array(n)])
  const H = (name: string, d: [number, number, number]) => hooks.get(name)?.toArray() as [number, number, number] ?? d
  const nz = [0, 1, 2].map((i) => H(`nozzle_${i}`, [(i - 1) * 1.5, 0.6, -4.2]))
  const num = H('number', [1.5, 0.8, 0])
  return {
    model, hi, lo: hi.map(([k, p, n]) => [k, p.slice(), n.slice()]),
    spec: { nozzles: nz.map((q) => [q[0], q[1]] as [number, number]), nozzleZ: nz[1][2], nozzleR: [0, 1, 2].map((i) => hookVal.get(`nozzle_${i}`) ?? 1), wingtip: H('wingtip', [3, 0.6, -3]), number: { pos: num, rotY: Math.PI / 2, tilt: 0, size: 0.8 } },
  }
}

export async function loadShipGlb(model: number): Promise<ModelArrays> {
  const r = await fetch(import.meta.env.BASE_URL + GLB_MODELS[model])
  return parseShipGlb(model, await r.arrayBuffer())
}
