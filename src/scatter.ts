// Near-field scatter: small things on the ground all around you — pebbles, grass, dry bushes, snow
// mounds, ferns, ash and glowing vents, flags — so the ground rushes past at Mach speed. Every one is
// harmless by design: too low to hit, soft (you fly through it), or a flag. None of them collides.
//
// A grid of cells follows the camera; each cell hashes its world coordinates to decide whether it holds
// a prop, where, how big and which way it faces, and the ground height comes from the GLSL terrain
// (TERRAIN_GLSL). So it is the same prop at the same spot whenever you pass, it costs no CPU per frame,
// and it is one draw call per kind. Props grow in at the edge of the grid (no popping) and stay out of
// rivers and lava.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { patchStandard } from './shaders'
import { BIOME, MOUND_U, TERRAIN_GLSL } from './terrain'

type Build = () => THREE.BufferGeometry
interface Kind { name: string; build: Build; cell: number; grid: number; density: number; scale: [number, number]; glow?: boolean; tilt?: number; seed: number }

const col = (g: THREE.BufferGeometry, c: [number, number, number], vary = 0): THREE.BufferGeometry => {
  const n = g.attributes.position.count, a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { const k = 1 - vary * ((i * 7919) % 13) / 13; a[i * 3] = c[0] * k; a[i * 3 + 1] = c[1] * k; a[i * 3 + 2] = c[2] * k }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3))
  return g
}
const clean = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
  const q = g.index ? g.toNonIndexed() : g
  for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') q.deleteAttribute(k)
  q.computeVertexNormals()
  return q
}
const merge = (gs: THREE.BufferGeometry[]): THREE.BufferGeometry => mergeGeometries(gs.map(clean))

// ── prop shapes (local units ≈ metres; y up, base at 0) ──
const pebble = (c: [number, number, number]): Build => () => col(new THREE.IcosahedronGeometry(1, 0).scale(0.32, 0.16, 0.26).translate(0, 0.06, 0), c, 0.3)
const lowRock = (c: [number, number, number]): Build => () => col(new THREE.DodecahedronGeometry(1, 0).scale(0.9, 0.38, 0.7).translate(0, 0.12, 0), c, 0.35)
const tuft = (c: [number, number, number], h: number, blades = 5, w = 0.07): Build => () => {
  const gs: THREE.BufferGeometry[] = []
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2, lean = 0.35 + 0.25 * ((i * 37) % 5) / 5
    gs.push(col(new THREE.ConeGeometry(w, h * (0.7 + 0.3 * ((i * 13) % 7) / 7), 3).translate(0, h / 2, 0).rotateZ(lean).rotateY(a), c, 0.25))
  }
  return merge(gs)
}
const fern = (c: [number, number, number]): Build => () => {
  const gs: THREE.BufferGeometry[] = []
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    gs.push(col(new THREE.PlaneGeometry(0.34, 1.4, 1, 3).translate(0, 0.7, 0).rotateX(-0.9).rotateY(a), c, 0.3))
  }
  const g = merge(gs)
  // Droop the frond tips.
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getZ(i)); p.setY(i, p.getY(i) - r * r * 0.35) }
  g.computeVertexNormals()
  return g
}
const bush = (c: [number, number, number], r: number, h: number): Build => () => {
  // A loose clump of lumpy blobs (reads soft: something you fly straight through).
  const gs: THREE.BufferGeometry[] = []
  for (let i = 0; i < 4; i++) {
    const a = i * 2.1, d = r * 0.45
    gs.push(col(new THREE.IcosahedronGeometry(r * (0.55 + 0.15 * (i % 2)), 1).scale(1, h / r * 0.8, 1).translate(Math.cos(a) * d, h * 0.45, Math.sin(a) * d), c, 0.35))
  }
  return merge(gs)
}
const dryBush = (): Build => () => {
  // Desert scrub: a tangle of thin grey-brown twigs.
  const gs: THREE.BufferGeometry[] = []
  for (let i = 0; i < 11; i++) {
    const a = i * 2.4, e = 0.4 + 0.5 * ((i * 17) % 9) / 9
    gs.push(col(new THREE.CylinderGeometry(0.02, 0.04, 1.1, 3).translate(0, 0.55, 0).rotateZ(e).rotateY(a), [0.42, 0.33, 0.24], 0.3))
  }
  gs.push(col(new THREE.IcosahedronGeometry(0.42, 0).scale(1, 0.6, 1).translate(0, 0.32, 0), [0.4, 0.38, 0.24], 0.2))
  return merge(gs)
}
const mound = (c: [number, number, number], r: number, h: number): Build => () => col(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(r, h, r * 0.75), c, 0.06)
const iceChip = (): Build => () => col(new THREE.OctahedronGeometry(1, 0).scale(0.26, 0.2, 0.22).translate(0, 0.08, 0), [0.87, 0.93, 0.98], 0.15)
const snowman = (): Build => () => merge([
  col(new THREE.SphereGeometry(0.55, 10, 7).translate(0, 0.45, 0), [0.95, 0.96, 1.0]),
  col(new THREE.SphereGeometry(0.4, 10, 7).translate(0, 1.15, 0), [0.95, 0.96, 1.0]),
  col(new THREE.SphereGeometry(0.28, 10, 7).translate(0, 1.65, 0), [0.95, 0.96, 1.0]),
  col(new THREE.ConeGeometry(0.06, 0.3, 6).rotateX(Math.PI / 2).translate(0, 1.66, 0.38), [1.0, 0.45, 0.1]),
  col(new THREE.CylinderGeometry(0.2, 0.22, 0.28, 10).translate(0, 1.98, 0), [0.12, 0.12, 0.14]),
])
const flag = (c: [number, number, number]): Build => () => {
  // A thin pole and a pennant: plainly something you fly through, not a wall.
  const pen = new THREE.BufferGeometry()
  pen.setAttribute('position', new THREE.Float32BufferAttribute([0, 4.4, 0, 0, 3.4, 0, 1.6, 3.95, 0], 3))
  return merge([col(new THREE.CylinderGeometry(0.04, 0.05, 4.6, 5).translate(0, 2.3, 0), [0.85, 0.85, 0.82]), col(pen, c), col(pen.clone().rotateY(Math.PI), c)])
}
const vent = (): Build => () => merge([
  // A low crusted ring round a glowing mouth (the glow is a separate, emissive kind).
  col(new THREE.TorusGeometry(0.9, 0.32, 5, 12).rotateX(Math.PI / 2).scale(1, 0.6, 1).translate(0, 0.08, 0), [0.12, 0.1, 0.1], 0.3),
])
const ventGlow = (): Build => () => col(new THREE.CircleGeometry(0.7, 12).rotateX(-Math.PI / 2).translate(0, 0.12, 0), [3.2, 1.1, 0.25])
const ember = (): Build => () => col(new THREE.DodecahedronGeometry(1, 0).scale(0.3, 0.18, 0.25).translate(0, 0.06, 0), [2.6, 0.7, 0.15])

// ── per world (cell metres, grid cells across, chance a cell holds one, scale range) ──
const SEEDED = (k: Omit<Kind, 'seed'>[]): Kind[] => k.map((x, i) => ({ ...x, seed: 17.3 + i * 31.7 }))
const FLAG_COL: Record<string, [number, number, number]> = { desert: [1.0, 0.42, 0.1], ice: [0.9, 0.15, 0.2], lava: [1.0, 0.75, 0.1], forest: [0.2, 0.5, 1.0], jungle: [1.0, 0.85, 0.15] }
const FLAGS: Omit<Kind, 'seed'> = { name: 'flag', build: flag(FLAG_COL[BIOME] ?? [1, 0.4, 0.1]), cell: 90, grid: 20, density: 0.3, scale: [0.9, 1.2] }
const KINDS: Record<string, Kind[]> = {
  desert: SEEDED([
    { name: 'pebble', build: pebble([0.66, 0.36, 0.2]), cell: 4, grid: 110, density: 0.55, scale: [0.5, 1.6] },
    { name: 'rock', build: lowRock([0.6, 0.34, 0.2]), cell: 11, grid: 64, density: 0.3, scale: [0.4, 0.9] },
    { name: 'scrub', build: dryBush(), cell: 14, grid: 56, density: 0.5, scale: [0.7, 1.5], tilt: 0.1 },
    FLAGS,
  ]),
  ice: SEEDED([
    { name: 'chip', build: iceChip(), cell: 4, grid: 110, density: 0.6, scale: [0.6, 1.5] },
    { name: 'mound', build: mound([0.93, 0.95, 1.0], 1.6, 0.42), cell: 14, grid: 56, density: 0.6, scale: [0.6, 1.6] },
    { name: 'snowman', build: snowman(), cell: 140, grid: 14, density: 0.35, scale: [0.9, 1.15] },
    FLAGS,
  ]),
  lava: SEEDED([
    { name: 'pebble', build: pebble([0.26, 0.19, 0.16]), cell: 4, grid: 110, density: 0.5, scale: [0.5, 1.4] },
    { name: 'ash', build: mound([0.36, 0.32, 0.3], 0.9, 0.28), cell: 13, grid: 56, density: 0.4, scale: [0.6, 1.3] },
    { name: 'ember', build: ember(), cell: 7, grid: 90, density: 0.35, scale: [0.6, 1.5], glow: true },
    { name: 'vent', build: vent(), cell: 34, grid: 30, density: 0.4, scale: [0.8, 1.6] },
    { name: 'ventglow', build: ventGlow(), cell: 34, grid: 30, density: 0.4, scale: [0.8, 1.6], glow: true },
    FLAGS,
  ]),
  forest: SEEDED([
    { name: 'tuft', build: tuft([0.28, 0.46, 0.12], 0.7), cell: 5, grid: 100, density: 0.6, scale: [0.7, 1.6], tilt: 0.15 },
    { name: 'flower', build: tuft([0.95, 0.85, 0.3], 0.35, 5, 0.06), cell: 7, grid: 70, density: 0.3, scale: [0.8, 1.3] },
    { name: 'bush', build: bush([0.3, 0.54, 0.22], 0.8, 1.0), cell: 15, grid: 52, density: 0.4, scale: [0.7, 1.4] },
    FLAGS,
  ]),
  jungle: SEEDED([
    { name: 'fern', build: fern([0.16, 0.36, 0.1]), cell: 6, grid: 90, density: 0.55, scale: [0.7, 1.6], tilt: 0.1 },
    { name: 'tuft', build: tuft([0.12, 0.26, 0.07], 0.6), cell: 4, grid: 110, density: 0.45, scale: [0.7, 1.5] },
    { name: 'bush', build: bush([0.14, 0.3, 0.1], 0.9, 1.2), cell: 14, grid: 56, density: 0.45, scale: [0.7, 1.4] },
    FLAGS,
  ]),
}

export class Scatter {
  readonly group = new THREE.Group()
  private readonly cam = { value: new THREE.Vector2() }
  private readonly on = { value: 1 }

  constructor() {
    // (Code ships with the same kind set per world: one material per kind keeps the shaders' seeds apart.)
    for (const k of KINDS[BIOME] ?? []) this.group.add(this.mesh(k))
  }

  private mesh(k: Kind): THREE.Mesh {
    const base = clean(k.build())
    const n = k.grid * k.grid
    const cell = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) { cell[i * 2] = (i % k.grid) - k.grid / 2; cell[i * 2 + 1] = Math.floor(i / k.grid) - k.grid / 2 }
    // One copy of the shape, drawn once per cell (instanced): the cell offset is a per-instance attribute.
    const g = new THREE.InstancedBufferGeometry()
    for (const name of ['position', 'normal', 'color']) g.setAttribute(name, base.attributes[name])
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 2))
    g.instanceCount = n
    const mat = k.glow
      ? new THREE.MeshBasicMaterial({ vertexColors: true })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true, side: THREE.DoubleSide })
    if (!k.glow) patchStandard(mat as THREE.MeshStandardMaterial)
    const prev = mat.onBeforeCompile
    const R = (k.cell * k.grid) / 2
    mat.onBeforeCompile = (s, r) => {
      prev.call(mat, s, r)
      s.uniforms.uScatCam = this.cam
      s.uniforms.uScatOn = this.on
      Object.assign(s.uniforms, MOUND_U)
      const head = `${TERRAIN_GLSL}
attribute vec2 aCell;
uniform vec2 uScatCam;
uniform float uScatOn;
float scHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
vec3 scPos; float scS; float scA; float scT;`
      const place = `{
        vec2 c0 = floor(uScatCam / ${k.cell.toFixed(1)});
        vec2 c = c0 + aCell;
        float h1 = scHash(c + ${k.seed.toFixed(2)}), h2 = scHash(c * 1.7 + ${(k.seed + 5.1).toFixed(2)}), h3 = scHash(c * 0.73 + ${(k.seed + 9.7).toFixed(2)});
        vec2 xz = (c + vec2(h2, h3)) * ${k.cell.toFixed(1)};
        float d = length(xz - uScatCam);
        float keep = step(h1, ${k.density.toFixed(3)}) * (1.0 - smoothstep(${(R * 0.72).toFixed(1)}, ${(R * 0.96).toFixed(1)}, d)) * uScatOn;
        keep *= 1.0 - smoothstep(0.08, 0.2, riverAt(xz));
        scS = mix(${k.scale[0].toFixed(2)}, ${k.scale[1].toFixed(2)}, fract(h1 * 13.7)) * keep;
        scA = h2 * 6.2832;
        scT = (h3 - 0.5) * ${(k.tilt ?? 0).toFixed(2)};
        scPos = vec3(xz.x, groundH(xz) - 0.04, xz.y);
      }`
      s.vertexShader = s.vertexShader
        .replace('#include <common>', `#include <common>\n${head}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${place}\n{ float ca = cos(scA), sa = sin(scA); objectNormal.xz = mat2(ca, -sa, sa, ca) * objectNormal.xz; }`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float ca = cos(scA), sa = sin(scA);
          transformed *= scS;
          transformed.x += transformed.y * scT;
          transformed.xz = mat2(ca, -sa, sa, ca) * transformed.xz;
          transformed += scPos;
        }`)
      if (k.glow) {
        // (Basic material has no beginnormal include before begin_vertex in every three version: place it here too.)
        s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', `${place}\n#include <begin_vertex>`)
      }
    }
    if (!k.glow) {
      // A fill matched to each world's ground (which shades itself): in POLAR SHELF's dim twilight the
      // lit props came out charcoal against the bright snow, in MONSOON they vanished into the floor.
      const lift = BIOME === 'ice' ? 0.75 : BIOME === 'jungle' ? 0.45 : BIOME === 'lava' ? 0.3 : 0.22
      const prev2 = mat.onBeforeCompile
      mat.onBeforeCompile = (s, r) => {
        prev2.call(mat, s, r)
        s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * ${lift.toFixed(2)};`)
      }
    }
    mat.customProgramCacheKey = () => `scatter-${BIOME}-${k.name}`
    const m = new THREE.Mesh(g, mat)
    m.frustumCulled = false
    m.renderOrder = 0
    return m
  }

  /** Follow the camera; hidden in space and when the world fades out. */
  update(cam: THREE.Vector3, visible: boolean): void {
    this.cam.value.set(cam.x, cam.z)
    this.on.value = visible ? 1 : 0
    this.group.visible = visible
  }
}
