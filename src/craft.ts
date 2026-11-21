// The craft: a low, sleek hover-racer built in code. Forward is local +Z.
//
// Detailed model, merged per material (paint, trim, carbon, metal, glass, glow, hot) so a full ship
// is ~10 draws: a stepped three-layer hull, side intakes, a framed canopy, panel seams, strakes, canted
// fins with racing numbers, nacelles with petal rings, a rear diffuser, hover emitters, wingtip side
// thrusters. A low-detail version (hull, nacelles, fin) is shown past LOD_DIST.
// Flames: one draw for the three outer plumes, one for the cores; length and width set in the shader.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { patchStandard } from './shaders'
import { buildShip } from './shipdesign'
import { buildClassic } from './shipclassic'

/** The ships: three classics (the first model, refined) and three lofted. */
export const MODELS = ['VANGUARD', 'BULWARK', 'LANCE', 'ARROW', 'BRUTE', 'NEEDLE'] as const

const LOD_DIST = 260
const NOZZLE_Z = -4.45

export interface Paint { body: number; trim: number; number: string }

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _soot = new THREE.Color(0x17110d)

class Builder {
  private readonly parts = new Map<string, THREE.BufferGeometry[]>()
  add(key: string, g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    const geo = g.index ? g.toNonIndexed() : g.clone()
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name)
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz))
    geo.applyMatrix4(_m)
    if (!this.parts.has(key)) this.parts.set(key, [])
    this.parts.get(key)!.push(geo)
  }
  /** Also mirrored across x = 0. */
  addSym(key: string, g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    this.add(key, g, x, y, z, rx, ry, rz, sx, sy, sz)
    this.add(key, g, -x, y, z, rx, -ry, -rz, sx, sy, sz)
  }
  build(mats: Record<string, THREE.Material>, into: THREE.Object3D): void {
    for (const [key, list] of this.parts) {
      const g = mergeGeometries(list)
      into.add(new THREE.Mesh(g, mats[key]))
    }
  }
}

function numberTexture(text: string, color: string): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 128; c.height = 128
  const x = c.getContext('2d')!
  x.font = 'bold 92px "Chakra Petch", system-ui, sans-serif'
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  x.fillStyle = color
  x.fillText(text, 64, 70)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function flameMaterial(core: THREE.Color, edge: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uThrottle: { value: 0 }, uBoost: { value: 0 }, uTime: { value: 0 },
      uLen: { value: 1 }, uWid: { value: 1 }, uNz: { value: NOZZLE_Z },
      uCore: { value: core }, uEdge: { value: edge }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uTintA: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aCenter;
      uniform float uLen;
      uniform float uWid;
      uniform float uNz;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vUv = uv;
        vec3 p = position;
        // Length along −z from the nozzle plane; width around each nozzle's own centre.
        p.z = uNz + (p.z - uNz) * uLen;
        p.xy = aCenter + (p.xy - aCenter) * uWid;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uThrottle, uBoost, uTime;
      uniform vec3 uCore, uEdge, uTint;
      uniform float uTintA;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float t = vUv.y;
        float facing = abs(dot(vN, vV));
        float body = pow(clamp(facing, 0.0, 1.0), 1.5);
        float fade = pow(clamp(1.0 - t, 0.0, 1.0), 1.6);
        // A smooth flicker (a per-frame random strobed).
        float flick = 0.9 + 0.1 * sin(uTime * 53.0 + vUv.x * 6.28) * sin(uTime * 31.0);
        float diamonds = uBoost * smoothstep(0.55, 1.0, sin(t * 26.0 - uTime * 4.0)) * (1.0 - t);
        vec3 c = mix(uEdge, uCore, body * (1.0 - t * 0.7)) * (fade * body * 0.9 + diamonds * 0.5);
        // Drift charge: the flame takes the charge's colour, brighter at the core.
        c = mix(c, uTint * (fade * body * 1.1 + 0.15 * fade), uTintA);
        gl_FragColor = vec4(c * flick * (0.3 + 0.7 * uThrottle), 1.0);
      }`,
  })
}

function flameGeometry(radius: number, nozzles: [number, number][], nz: number): THREE.BufferGeometry {
  const list: THREE.BufferGeometry[] = []
  for (const [x, y] of nozzles) {
    const g = new THREE.ConeGeometry(radius, 1, 20, 1, true)
    g.translate(0, 0.5, 0)
    g.rotateX(-Math.PI / 2) // base at z = 0, tip at z = −1
    g.translate(x, y, nz)
    const n = g.attributes.position.count
    const c = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) { c[i * 2] = x; c[i * 2 + 1] = y }
    g.setAttribute('aCenter', new THREE.BufferAttribute(c, 2))
    list.push(g)
  }
  return mergeGeometries(list)
}

export class Craft {
  readonly root = new THREE.Group()
  /** Banks and pitches; root carries position + heading. */
  readonly body = new THREE.Group()
  private readonly hi = new THREE.Group()
  private readonly lo = new THREE.Group()
  readonly nozzles: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  readonly wingtips: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3()]
  readonly sidePuffs: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3()]
  private mats!: Record<string, THREE.Material>
  private numMat!: THREE.MeshBasicMaterial
  private flames: THREE.Mesh[] = []
  model = -1
  private readonly flameMat: THREE.ShaderMaterial
  private readonly innerMat: THREE.ShaderMaterial
  private readonly glow: THREE.MeshBasicMaterial
  readonly cone: THREE.Mesh
  private readonly coneMat: THREE.ShaderMaterial

  /** model: an index into MODELS. */
  constructor(env: THREE.Texture, paint: Paint = { body: 0xeef1f4, trim: 0xff5a14, number: '07' }, model = 0) {
    this.root.add(this.body)
    this.body.add(this.hi, this.lo)
    const mats: Record<string, THREE.Material> = {
      // (Shell surfaces double-sided: an open loft end can never show as a see-through hole.)
      paint: new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, color: paint.body, roughness: 0.16, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.04, envMap: env, envMapIntensity: 1.7 }),
      trim: new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: paint.trim, roughness: 0.2, metalness: 0.45, emissive: paint.trim, emissiveIntensity: 0.18, envMap: env, envMapIntensity: 1.5 }),
      carbon: new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: 0x15171b, roughness: 0.3, metalness: 0.75, envMap: env, envMapIntensity: 1.3 }),
      metal: new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: 0x9aa0a8, roughness: 0.12, metalness: 1, envMap: env, envMapIntensity: 1.5 }),
      // (Tinted and see-through: the pilot shows inside.)
      glass: new THREE.MeshPhysicalMaterial({ color: 0x1a2c44, roughness: 0.04, metalness: 0.3, clearcoat: 1, envMap: env, envMapIntensity: 1.6, transparent: true, opacity: 0.62, depthWrite: false }),
    }
    for (const m of Object.values(mats)) patchStandard(m as THREE.MeshStandardMaterial)
    this.charMats = [mats.paint, mats.trim, mats.metal].map((m) => ({ m: m as THREE.MeshStandardMaterial, base: (m as THREE.MeshStandardMaterial).color.clone() }))
    this.glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.6, 3.2) })
    mats.glow = this.glow
    mats.hot = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.42, 0.1) })
    mats.neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(paint.trim).multiplyScalar(2.4) })

    this.mats = mats
    this.numMat = new THREE.MeshBasicMaterial({ map: numberTexture(paint.number, '#' + new THREE.Color(paint.trim).getHexString()), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
    this.flameMat = flameMaterial(new THREE.Color(2.2, 1.5, 0.8), new THREE.Color(2.0, 0.5, 0.1))
    this.innerMat = flameMaterial(new THREE.Color(2.6, 2.3, 2.0), new THREE.Color(1.3, 1.1, 1.6))
    this.setModel(model)
    this.lo.visible = false

    // The vapour cone: a pale shell, flashed as each Mach number breaks.
    this.coneMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uA: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec2 vUv;
        void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform float uA; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
        void main() {
          float rim = 1.0 - abs(dot(vN, vV));
          float wisp = 0.6 + 0.4 * sin(vUv.x * 40.0 + uTime * 30.0) * sin(vUv.y * 9.0 - uTime * 20.0);
          float a = uA * rim * rim * wisp * smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
          gl_FragColor = vec4(vec3(1.4, 1.45, 1.5), a * 0.6);
        }`,
    })
    const coneGeo = new THREE.ConeGeometry(4.6, 7, 40, 1, true)
    coneGeo.rotateX(Math.PI / 2) // apex forward
    this.cone = new THREE.Mesh(coneGeo, this.coneMat)
    this.cone.position.set(0, 0.4, -1.4)
    this.cone.visible = false
    this.body.add(this.cone)
  }

  /** Repaint live: body, team colour (trim, neon, number). */
  setPaint(p: Paint): void {
    const m = this.mats
    ;(m.paint as THREE.MeshStandardMaterial).color.set(p.body)
    ;(m.trim as THREE.MeshStandardMaterial).color.set(p.trim)
    ;(m.trim as THREE.MeshStandardMaterial).emissive.set(p.trim)
    ;(m.neon as THREE.MeshBasicMaterial).color.set(p.trim).multiplyScalar(2.4)
    for (const c of this.charMats) c.base.copy(c.m.color)
    this.char = -1
    this.numMat.map?.dispose()
    this.numMat.map = numberTexture(p.number, '#' + new THREE.Color(p.trim).getHexString())
    this.numMat.needsUpdate = true
  }

  /** Build (or rebuild, swapping ship live) the shape: hull, numbers, low detail, flames. */
  setModel(model: number): void {
    if (model === this.model) return
    this.model = model
    const build = (hi: boolean) => (model < 3 ? buildClassic(model, hi) : buildShip(model - 3, hi))
    for (const grp of [this.hi, this.lo]) {
      for (const c of [...grp.children]) { grp.remove(c); (c as THREE.Mesh).geometry?.dispose() }
    }
    for (const f of this.flames) { this.body.remove(f); f.geometry.dispose() }
    this.flames = []
    const { parts, spec } = build(true)
    const B = new Builder()
    for (const [key, list] of parts) for (const g of list) B.add(key, g)
    B.build(this.mats, this.hi)
    spec.nozzles.forEach(([x, y], i) => this.nozzles[i].set(x, y, spec.nozzleZ - 0.1))
    const [wx, wy, wz] = spec.wingtip
    this.wingtips[0].set(-wx, wy, wz); this.wingtips[1].set(wx, wy, wz)
    this.sidePuffs[0].set(-wx + 0.6, wy + 0.1, wz + 1.2); this.sidePuffs[1].set(wx - 0.6, wy + 0.1, wz + 1.2)
    // Racing numbers on the fins' outer faces.
    const N = spec.number
    for (const sgn of [-1, 1]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(N.size, N.size), this.numMat)
      plane.position.set(sgn * N.pos[0], N.pos[1], N.pos[2])
      plane.rotation.set(0, sgn * N.rotY, 0, 'YXZ')
      // (tilt = the fin's outward lean; the same sign both sides — sgn·tilt sank the right one into its fin.)
      plane.rotateX(N.tilt)
      this.hi.add(plane)
    }
    const L = new Builder()
    for (const [key, list] of build(false).parts) for (const g of list) L.add(key, g)
    L.build(this.mats, this.lo)
    // Flames: two draws for all three nozzles.
    for (const [r, m] of [[0.48, this.flameMat], [0.26, this.innerMat]] as const) {
      const f = new THREE.Mesh(flameGeometry(r, spec.nozzles, spec.nozzleZ), m)
      m.uniforms.uNz.value = spec.nozzleZ
      f.frustumCulled = false
      f.renderOrder = 5
      this.body.add(f)
      this.flames.push(f)
    }
  }

  private readonly charMats: { m: THREE.MeshStandardMaterial; base: THREE.Color }[] = []
  private char = 0
  /** Scorch the paint toward soot (0 clean … 1 burnt). */
  setChar(a: number): void {
    if (Math.abs(a - this.char) < 0.01) return
    this.char = a
    for (const { m, base } of this.charMats) m.color.copy(base).lerp(_soot, a * 0.85)
  }

  /** Detail by distance from the camera. */
  lod(cam: THREE.Vector3): void {
    const far = this.root.position.distanceToSquared(cam) > LOD_DIST * LOD_DIST
    this.hi.visible = !far
    this.lo.visible = far
  }

  setFlames(throttle: number, boost: number, time: number): void {
    // (Shorter and cooler than they were: the plumes ran down over the Mach readout, blown white.)
    const len = 1.0 + throttle * 1.4 + boost * 4.2
    const wid = 0.85 + boost * 0.35
    const j = 1 + Math.sin(time * 41) * 0.05 + Math.sin(time * 23) * 0.04
    for (const [m, k] of [[this.flameMat, 1], [this.innerMat, 0.55]] as const) {
      m.uniforms.uThrottle.value = throttle
      m.uniforms.uBoost.value = boost
      m.uniforms.uTime.value = time
      m.uniforms.uLen.value = len * k * j
      m.uniforms.uWid.value = wid
    }
    this.glow.color.setRGB(0.3 + boost * 0.4, 1.6, 3.2)
  }

  /** A rival's exhaust edged in its own colour (its leaderboard colour): told apart at a glance. */
  setFlameTint(c: THREE.Color, a: number): void {
    this.flameMat.uniforms.uTint.value.set(c.r * 2.2, c.g * 2.2, c.b * 2.2)
    this.flameMat.uniforms.uTintA.value = a
    this.innerMat.uniforms.uTintA.value = 0
  }

  /** Drift charge in the exhaust: 0 none, 1 first level (electric blue), 2 second (violet-white). */
  setDriftTint(level: number, a: number): void {
    for (const m of [this.flameMat, this.innerMat]) {
      m.uniforms.uTintA.value = a
      // (Kept under the bloom's white-out: at 2–3× these read as blue / violet, at 6× as white.)
      if (level >= 2) m.uniforms.uTint.value.set(2.0, 0.7, 2.6)
      else m.uniforms.uTint.value.set(0.35, 1.1, 2.8)
    }
  }

  setCone(a: number, time: number): void {
    this.cone.visible = a > 0.01
    this.coneMat.uniforms.uA.value = a
    this.coneMat.uniforms.uTime.value = time
  }
}
