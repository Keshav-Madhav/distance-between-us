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
interface Kind { name: string; build: Build; cell: number; grid: number; density: number; scale: [number, number]; glow?: boolean; tilt?: number; seed: number; where?: 'land' | 'river'; near?: number }

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
  for (let i = 0; i < 7; i++) {
    const a = i * 2.1, d = r * (0.3 + 0.25 * (i % 3) / 2)
    gs.push(col(new THREE.IcosahedronGeometry(r * (0.38 + 0.12 * (i % 3)), 0).translate(Math.cos(a) * d, h * (0.3 + 0.12 * (i % 4)), Math.sin(a) * d), c, 0.35))
  }
  return merge(gs)
}
const dryBush = (): Build => () => {
  // Desert scrub: a tangle of thin grey-brown twigs.
  const gs: THREE.BufferGeometry[] = []
  for (let i = 0; i < 11; i++) {
    const a = i * 2.4, e = 0.4 + 0.5 * ((i * 17) % 9) / 9
    gs.push(col(new THREE.CylinderGeometry(0.02, 0.04, 0.65, 3).translate(0, 0.32, 0).rotateZ(e).rotateY(a), [0.62, 0.55, 0.38], 0.3))
  }
  gs.push(col(new THREE.IcosahedronGeometry(0.3, 0).scale(1, 0.55, 1).translate(0, 0.2, 0), [0.58, 0.52, 0.34], 0.2))
  return merge(gs)
}
const mound = (c: [number, number, number], r: number, h: number): Build => () => col(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(r, h, r * 0.75), c, 0.06)
const iceChip = (): Build => () => col(new THREE.OctahedronGeometry(1, 0).scale(0.3, 0.24, 0.26).translate(0, 0.1, 0), [0.5, 0.68, 0.86], 0.4)
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

const tumbleweed = (): Build => () => {
  const gs: THREE.BufferGeometry[] = []
  for (let i = 0; i < 9; i++) gs.push(col(new THREE.TorusGeometry(0.55, 0.03, 3, 8).rotateX(i * 1.1).rotateY(i * 2.0).translate(0, 0.6, 0), [0.6, 0.5, 0.32], 0.3))
  // A dense tangled core (it read as a see-through wire cage): a faceted ball just inside the rings.
  gs.push(col(new THREE.IcosahedronGeometry(0.42, 0).translate(0, 0.6, 0), [0.5, 0.41, 0.26], 0.35))
  return merge(gs)
}
const charred = (): Build => () => {
  const gs: THREE.BufferGeometry[] = []
  for (let i = 0; i < 7; i++) gs.push(col(new THREE.CylinderGeometry(0.03, 0.07, 1.8, 4).translate(0, 0.9, 0).rotateZ(0.25 + 0.2 * (i % 3)).rotateY(i * 0.9), [0.13, 0.1, 0.09], 0.2))
  return merge(gs)
}
const tallGrass = (c: [number, number, number]): Build => tuft(c, 1.6, 9, 0.09)
const reeds = (c: [number, number, number]): Build => tuft(c, 3.2, 11, 0.06)
const spike = (): Build => () => col(new THREE.ConeGeometry(0.9, 6, 5).translate(0, 3, 0), [0.62, 0.82, 1.0], 0.3)
const pillar = (c: [number, number, number]): Build => () => col(new THREE.CylinderGeometry(0.9, 1.4, 7, 6).translate(0, 3.5, 0), c, 0.3)
// A cinder heap: a lumpy, slumped mound of clinker (a plain cone read as an untextured pyramid).
const cinderHeap = (): Build => () => {
  const g = new THREE.IcosahedronGeometry(1, 1)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const k = 1 + 0.22 * Math.sin(x * 7.1 + z * 3.3) * Math.cos(z * 5.7 - x * 2.1)
    p.setXYZ(i, x * k * 0.95, Math.max(0, y) * 0.42 * k, z * k * 0.8)
  }
  // (Dark warm clinker: flat grey stood out of CINDER's palette.)
  return col(g.translate(0, -0.02, 0), [0.2, 0.14, 0.12], 0.45)
}
const lilies = (): Build => () => col(new THREE.CircleGeometry(0.7, 7).rotateX(-Math.PI / 2).translate(0, 0.05, 0), [0.25, 0.5, 0.2], 0.3)

// ── per world (cell metres, grid cells across, chance a cell holds one, scale range) ──
// (Seeds by position: new kinds go after FLAGS, or every kind after them reshuffles its layout.)
const SEEDED = (k: Omit<Kind, 'seed'>[]): Kind[] => k.map((x, i) => ({ ...x, seed: 17.3 + i * 31.7 }))
const FLAG_COL: Record<string, [number, number, number]> = { desert: [1.0, 0.42, 0.1], ice: [1.0, 0.35, 0.1], lava: [1.0, 0.75, 0.1], forest: [0.2, 0.5, 1.0], jungle: [1.0, 0.85, 0.15] }
const FLAGS: Omit<Kind, 'seed'> = { name: 'flag', build: flag(FLAG_COL[BIOME] ?? [1, 0.4, 0.1]), cell: 60, grid: 24, density: 0.35, scale: [0.9, 1.2] }
const KINDS: Record<string, Kind[]> = {
  desert: SEEDED([
    { name: 'pebble', build: pebble([0.66, 0.36, 0.2]), cell: 4, grid: 66, density: 0.55, scale: [0.5, 1.6] },
    { name: 'rock', build: lowRock([0.6, 0.34, 0.2]), cell: 11, grid: 64, density: 0.3, scale: [0.4, 0.9] },
    { name: 'scrub', build: dryBush(), cell: 14, grid: 56, density: 0.5, scale: [0.6, 1.0], tilt: 0.1 },
    { name: 'bigscrub', build: dryBush(), cell: 11, grid: 64, density: 0.55, scale: [1.8, 3.2], tilt: 0.12 },
    { name: 'tumble', build: tumbleweed(), cell: 24, grid: 30, density: 0.4, scale: [0.9, 1.8] },
    { name: 'pillar', build: pillar([0.62, 0.34, 0.2]), cell: 34, grid: 22, density: 0.35, scale: [0.6, 1.4], near: 30 },
    FLAGS,
    // Big fly-through scrub in the 30-300 m band (what fills the frame at speed is what passes there).
    { name: 'giantscrub', build: dryBush(), cell: 26, grid: 26, density: 0.45, scale: [4.0, 6.5], tilt: 0.12, near: 18 },
  ]),
  ice: SEEDED([
    { name: 'chip', build: iceChip(), cell: 3.5, grid: 76, density: 0.7, scale: [0.6, 1.6] },
    { name: 'mound', build: mound([0.78, 0.86, 1.0], 1.6, 0.56), cell: 14, grid: 56, density: 0.6, scale: [0.6, 1.6] },
    { name: 'spike', build: spike(), cell: 30, grid: 24, density: 0.4, scale: [0.5, 1.3], near: 30, tilt: 0.25 },
    { name: 'shrub', build: bush([0.86, 0.92, 1.0], 1.0, 1.6), cell: 13, grid: 44, density: 0.5, scale: [1.0, 2.2] },
    { name: 'snowman', build: snowman(), cell: 110, grid: 14, density: 0.4, scale: [0.9, 1.15] },
    FLAGS,
    { name: 'drift', build: mound([0.84, 0.9, 1.0], 1.6, 0.56), cell: 24, grid: 28, density: 0.42, scale: [2.4, 4.4], near: 18 },
  ]),
  lava: SEEDED([
    { name: 'pebble', build: pebble([0.26, 0.19, 0.16]), cell: 4, grid: 66, density: 0.5, scale: [0.5, 1.4] },
    { name: 'ash', build: () => col(new THREE.ConeGeometry(0.9, 0.36, 9, 1, true).translate(0, 0.16, 0), [0.5, 0.45, 0.42], 0.25), cell: 13, grid: 56, density: 0.4, scale: [0.6, 1.3] },
    { name: 'ember', build: ember(), cell: 7, grid: 60, density: 0.35, scale: [0.35, 0.9], glow: true },
    { name: 'pillar', build: pillar([0.14, 0.11, 0.1]), cell: 32, grid: 24, density: 0.4, scale: [0.6, 1.4], near: 30 },
    { name: 'spatter', build: ember(), cell: 6, grid: 90, density: 0.45, scale: [0.6, 1.6], glow: true, where: 'river' },
    { name: 'charred', build: charred(), cell: 12, grid: 60, density: 0.5, scale: [1.0, 2.0], tilt: 0.15 },
    { name: 'vent', build: vent(), cell: 20, grid: 36, density: 0.4, scale: [0.8, 1.6], near: 14 },
    { name: 'ventglow', build: ventGlow(), cell: 20, grid: 36, density: 0.4, scale: [0.8, 1.6], glow: true, near: 14 },
    FLAGS,
    { name: 'heap', build: cinderHeap(), cell: 24, grid: 28, density: 0.5, scale: [3.0, 6.0], near: 18 },
  ]),
  forest: SEEDED([
    { name: 'tuft', build: tuft([0.28, 0.46, 0.12], 0.7), cell: 5, grid: 60, density: 0.6, scale: [0.7, 1.6], tilt: 0.15 },
    { name: 'flower', build: tuft([0.95, 0.85, 0.3], 0.35, 5, 0.06), cell: 7, grid: 44, density: 0.3, scale: [0.8, 1.3] },
    { name: 'bush', build: bush([0.4, 0.68, 0.26], 0.8, 1.0), cell: 12, grid: 46, density: 0.55, scale: [1.2, 2.8] },
    { name: 'reeds', build: reeds([0.42, 0.58, 0.2]), cell: 7, grid: 80, density: 0.55, scale: [0.8, 1.4], tilt: 0.12, where: 'river' },
    { name: 'lily', build: lilies(), cell: 6, grid: 80, density: 0.4, scale: [0.7, 1.6], where: 'river' },
    { name: 'tallgrass', build: tallGrass([0.36, 0.56, 0.16]), cell: 8, grid: 80, density: 0.5, scale: [0.9, 1.8], tilt: 0.15 },
    FLAGS,
    { name: 'giantbush', build: bush([0.36, 0.62, 0.22], 0.9, 1.1), cell: 24, grid: 28, density: 0.45, scale: [3.2, 5.5], near: 18 },
  ]),
  jungle: SEEDED([
    { name: 'fern', build: fern([0.2, 0.32, 0.14]), cell: 6, grid: 90, density: 0.55, scale: [0.7, 1.6], tilt: 0.1 },
    { name: 'tuft', build: tuft([0.12, 0.26, 0.07], 0.6), cell: 4, grid: 70, density: 0.45, scale: [0.7, 1.5] },
    { name: 'bush', build: bush([0.14, 0.3, 0.1], 0.9, 1.2), cell: 12, grid: 46, density: 0.55, scale: [1.2, 2.6] },
    { name: 'reeds', build: reeds([0.2, 0.34, 0.12]), cell: 7, grid: 80, density: 0.55, scale: [0.8, 1.5], tilt: 0.12, where: 'river' },
    { name: 'bigfern', build: fern([0.18, 0.3, 0.12]), cell: 10, grid: 64, density: 0.5, scale: [2.0, 3.5], tilt: 0.1 },
    FLAGS,
    { name: 'hugefern', build: fern([0.16, 0.28, 0.11]), cell: 22, grid: 30, density: 0.5, scale: [4.5, 7.0], tilt: 0.1, near: 18 },
  ]),
}

/** How close to the lens a kind may come: props big enough to cover the HUD (ferns, bushes) stay
 *  14 m off; small ones 8 m (a fern over the HULL bar was the judges' note). */
const nearOf = (k: Kind): number => k.near ?? (k.name === 'flag' ? 20 : k.scale[1] >= 2 ? 14 : 8)
/** Giants (4 m+) and flags also keep further off the lens at speed: at Mach 6 a 6 m bush 20 m away
 *  was a screen-wide blurred slab. (Only those: applied to every prop over 2 m it emptied the near
 *  field — the scrub whipping past at 10-40 m is what sells the speed.) */
const BIGNEAR = (k: Kind): boolean => k.scale[1] >= 4 || k.name === 'flag'

export class Scatter {
  readonly group = new THREE.Group()
  private readonly cam = { value: new THREE.Vector2() }
  private readonly on = { value: 1 }
  private readonly view = { value: new THREE.Vector3(0, 0, -2) }
  private readonly lods: { g: THREE.InstancedBufferGeometry; n: number; R: number; cell: number; radius: { value: number }; centre: { value: THREE.Vector2 }; fine: boolean }[] = []

  /** The course's wear map (R: where races actually run): big props stay off it. */
  private readonly track: { tTrack: { value: THREE.Texture | null }; uTrackBox: { value: THREE.Vector4 }; uTrackOn: { value: number } }
  /** Extra lens clearance for big props, growing with speed (m). */
  private readonly nearAdd = { value: 0 }
  constructor(track: { tTrack: { value: THREE.Texture | null }; uTrackBox: { value: THREE.Vector4 }; uTrackOn: { value: number } }) {
    this.track = track
    // (Code ships with the same kind set per world: one material per kind keeps the shaders' seeds apart.)
    for (const k of KINDS[BIOME] ?? []) this.group.add(this.mesh(k))
  }

  private mesh(k: Kind): THREE.Mesh {
    const base = clean(k.build())
    const n = k.grid * k.grid
    const cell = new Float32Array(n * 2)
    // Centre outward (by distance), so drawing the first N cells draws a disc: the speed LOD below
    // shrinks a small prop's field by drawing fewer instances, not by hiding them in the shader.
    const order = Array.from({ length: n }, (_, i) => [(i % k.grid) - k.grid / 2 + 0.5, Math.floor(i / k.grid) - k.grid / 2 + 0.5] as const).sort((p, q) => p[0] * p[0] + p[1] * p[1] - (q[0] * q[0] + q[1] * q[1]))
    order.forEach(([x, z], i) => { cell[i * 2] = x - 0.5; cell[i * 2 + 1] = z - 0.5 })
    // One copy of the shape, drawn once per cell (instanced): the cell offset is a per-instance attribute.
    const g = new THREE.InstancedBufferGeometry()
    for (const name of ['position', 'normal', 'color']) g.setAttribute(name, base.attributes[name])
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 2))
    g.instanceCount = n
    const R = (k.cell * k.grid) / 2
    // Fine props (pebbles, chips, tufts, embers…): at speed their field shrinks to ~55% of its radius.
    const radius = { value: R }, centre = { value: new THREE.Vector2() }
    this.lods.push({ g, n, R, cell: k.cell, radius, centre, fine: k.scale[1] < 2 && !k.near })
    const mat = k.glow
      ? new THREE.MeshBasicMaterial({ vertexColors: true })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true, side: THREE.DoubleSide })
    if (!k.glow) patchStandard(mat as THREE.MeshStandardMaterial)
    const prev = mat.onBeforeCompile
    mat.onBeforeCompile = (s, r) => {
      prev.call(mat, s, r)
      s.uniforms.uScatCam = this.cam
      s.uniforms.uScatR = radius
      s.uniforms.uScatC = centre
      s.uniforms.uScatView = this.view
      s.uniforms.tTrack = this.track.tTrack; s.uniforms.uTrackBox = this.track.uTrackBox; s.uniforms.uTrackOn = this.track.uTrackOn; s.uniforms.uNearAdd = this.nearAdd
      s.uniforms.uScatOn = this.on
      Object.assign(s.uniforms, MOUND_U)
      const head = `${TERRAIN_GLSL}
attribute vec2 aCell;
uniform vec2 uScatCam;
uniform float uScatOn;
uniform float uScatR;
uniform vec2 uScatC;
uniform vec3 uScatView;
uniform sampler2D tTrack;
uniform vec4 uTrackBox;
uniform float uTrackOn;
uniform float uNearAdd;
float scHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
vec3 scPos; float scS; float scA; float scT;`
      const place = `{
        vec2 c0 = floor(uScatC / ${k.cell.toFixed(1)});
        vec2 c = c0 + aCell;
        float h1 = scHash(c + ${k.seed.toFixed(2)}), h2 = scHash(c * 1.7 + ${(k.seed + 5.1).toFixed(2)}), h3 = scHash(c * 0.73 + ${(k.seed + 9.7).toFixed(2)});
        vec2 xz = (c + vec2(h2, h3)) * ${k.cell.toFixed(1)};
        float d = length(xz - uScatC);
        float keep = step(h1, ${k.density.toFixed(3)}) * (1.0 - smoothstep(uScatR * 0.72, uScatR * 0.96, d)) * uScatOn;
        // View cull (see update): the instance's angular half-width widens the cone a little.
        { vec2 dv = xz - uScatC; float dl = length(dv);
          if (dl > 40.0 && dot(dv, uScatView.xy) < (uScatView.z - ${(k.scale[1] * 3).toFixed(1)} / dl) * dl) keep = 0.0; }
        ${k.scale[1] >= 4 && !k.near || k.near === 18 ? `// (Giants only: the camera rides the racing line, so clearing it of 2.5 m props halved the
        // near field that sells the speed — measured 4.1% → 1.8% of the screen.) Giants off the racing line (the wear map's packing, where the simulated races ran): a bush
        // in the exhaust or a drift dome dead ahead read as an obstacle you were about to hit.
        { vec2 tuv = (xz - uTrackBox.xy) / uTrackBox.zw;
          if (uTrackOn > 0.01 && keep > 0.0 && tuv.x > 0.0 && tuv.y > 0.0 && tuv.x < 1.0 && tuv.y < 1.0) keep *= 1.0 - smoothstep(0.35, 0.55, texture2D(tTrack, tuv).r); }` : ''}
        ${k.where === 'river' ? 'keep *= smoothstep(0.25, 0.45, riverAt(xz));' : BIOME === 'ice' ? '' : 'keep *= 1.0 - smoothstep(0.08, 0.2, riverAt(xz));'} // (POLAR SHELF's rivers are frozen: props sit on them, or whole stretches were bare)
        scS = mix(${k.scale[0].toFixed(2)}, ${k.scale[1].toFixed(2)}, fract(h1 * 13.7)) * keep;
        scA = h2 * 6.2832;
        scT = (h3 - 0.5) * ${(k.tilt ?? 0).toFixed(2)};
        // (An empty cell skips the terrain lookup: most cells are empty, and groundH is the costly part.)
        scPos = vec3(xz.x, keep > 0.0 ? groundH(xz) - 0.04 : -1e4, xz.y);
        // (Not right at the lens: up close a fern or a twig filled the screen.)
        // (A clear pocket round you and your craft, ~10 m ahead: foliage covered it.)
        ${BIGNEAR(k) ? `float nearD = ${nearOf(k).toFixed(1)} + uNearAdd;` : `float nearD = ${nearOf(k).toFixed(1)};`}
        scS *= smoothstep(nearD, nearD + 16.0, distance(scPos, cameraPosition));
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
      const lift = BIOME === 'ice' ? 0.5 : BIOME === 'jungle' ? 0.45 : BIOME === 'lava' ? 0.3 : 0.22
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
  /**
   * `fx, fz`: the look direction on the ground; `cosHalf`: cos of the half view angle plus a margin.
   * Each instance outside that cone (and past ~40 m, so nothing vanishes beside you in a snap turn)
   * is collapsed in the vertex shader before the terrain lookup: per-instance view culling on the GPU.
   */
  update(cam: THREE.Vector3, visible: boolean, mach = 0, fx = 0, fz = 0, cosHalf = -2): void {
    this.view.value.set(fx, fz, cosHalf)
    this.nearAdd.value = Math.max(0, mach - 1.5) * 4
    this.cam.value.set(cam.x, cam.z)
    const f = 1 - 0.45 * THREE.MathUtils.smoothstep(mach, 1.5, 6.5)
    for (const l of this.lods) {
      const r = l.fine ? l.R * f : l.R
      l.radius.value = r
      l.centre.value.set(cam.x, cam.z)
      // (Cells whose centres lie within r, plus a ring for the cell offset: π(r/cell + 1.5)².)
      l.g.instanceCount = Math.min(l.n, Math.ceil(Math.PI * (r / l.cell + 1.5) ** 2))
    }
    this.on.value = visible ? 1 : 0
    this.group.visible = visible
  }
}
