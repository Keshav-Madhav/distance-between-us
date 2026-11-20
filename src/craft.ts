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

const LOD_DIST = 260
const NOZZLE_Z = -4.3
const NOZZLES: [number, number][] = [[-1.08, 0.36], [0, 0.6], [1.08, 0.36]]

export interface Paint { body: number; trim: number; number: string }

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()

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

function hullShape(k: number): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(0, 5.6 * k)
  s.bezierCurveTo(0.45 * k, 4.6 * k, 1.0 * k, 2.4 * k, 2.2 * k, -0.6 * k)
  s.bezierCurveTo(2.7 * k, -1.6 * k, 3.1 * k, -2.2 * k, 3.15 * k, -2.75 * k)
  s.lineTo(2.0 * k, -3.45 * k)
  s.lineTo(1.5 * k, -4.15 * k)
  s.lineTo(-1.5 * k, -4.15 * k)
  s.lineTo(-2.0 * k, -3.45 * k)
  s.lineTo(-3.15 * k, -2.75 * k)
  s.bezierCurveTo(-3.1 * k, -2.2 * k, -2.7 * k, -1.6 * k, -2.2 * k, -0.6 * k)
  s.bezierCurveTo(-1.0 * k, 2.4 * k, -0.45 * k, 4.6 * k, 0, 5.6 * k)
  return s
}

function slab(shape: THREE.Shape, depth: number, bevel: number, segs = 4): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: segs, curveSegments: 28 })
  // rotateX(+90°): shape-y → +z (nose forward), extrusion → −y; lifted so it sits on y = 0.
  g.rotateX(Math.PI / 2)
  g.translate(0, depth, 0)
  g.computeVertexNormals()
  return g
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
      uLen: { value: 1 }, uWid: { value: 1 },
      uCore: { value: core }, uEdge: { value: edge },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aCenter;
      uniform float uLen;
      uniform float uWid;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vUv = uv;
        vec3 p = position;
        // Length along −z from the nozzle plane; width around each nozzle's own centre.
        p.z = ${NOZZLE_Z.toFixed(2)} + (p.z - ${NOZZLE_Z.toFixed(2)}) * uLen;
        p.xy = aCenter + (p.xy - aCenter) * uWid;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uThrottle, uBoost, uTime;
      uniform vec3 uCore, uEdge;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float t = vUv.y;
        float facing = abs(dot(vN, vV));
        float body = pow(facing, 1.5);
        float fade = pow(1.0 - t, 1.6);
        // A smooth flicker (a per-frame random strobed).
        float flick = 0.9 + 0.1 * sin(uTime * 53.0 + vUv.x * 6.28) * sin(uTime * 31.0);
        float diamonds = uBoost * smoothstep(0.55, 1.0, sin(t * 26.0 - uTime * 4.0)) * (1.0 - t);
        vec3 c = mix(uEdge, uCore, body * (1.0 - t * 0.7)) * (fade * body * 0.9 + diamonds * 0.5);
        gl_FragColor = vec4(c * flick * (0.3 + 0.7 * uThrottle), 1.0);
      }`,
  })
}

function flameGeometry(radius: number): THREE.BufferGeometry {
  const list: THREE.BufferGeometry[] = []
  for (const [x, y] of NOZZLES) {
    const g = new THREE.ConeGeometry(radius, 1, 20, 1, true)
    g.translate(0, 0.5, 0)
    g.rotateX(-Math.PI / 2) // base at z = 0, tip at z = −1
    g.translate(x, y, NOZZLE_Z)
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
  readonly nozzles: THREE.Vector3[] = NOZZLES.map(([x, y]) => new THREE.Vector3(x, y, NOZZLE_Z - 0.1))
  readonly wingtips: THREE.Vector3[] = [new THREE.Vector3(-3.15, 0.2, -2.6), new THREE.Vector3(3.15, 0.2, -2.6)]
  readonly sidePuffs: THREE.Vector3[] = [new THREE.Vector3(-3.0, 0.2, -1.4), new THREE.Vector3(3.0, 0.2, -1.4)]
  private readonly flameMat: THREE.ShaderMaterial
  private readonly innerMat: THREE.ShaderMaterial
  private readonly glow: THREE.MeshBasicMaterial
  readonly cone: THREE.Mesh
  private readonly coneMat: THREE.ShaderMaterial

  constructor(env: THREE.Texture, paint: Paint = { body: 0xeef1f4, trim: 0xff5a14, number: '07' }) {
    this.root.add(this.body)
    this.body.add(this.hi, this.lo)
    const mats: Record<string, THREE.Material> = {
      paint: new THREE.MeshPhysicalMaterial({ color: paint.body, roughness: 0.3, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.14, envMap: env, envMapIntensity: 1.1 }),
      trim: new THREE.MeshStandardMaterial({ color: paint.trim, roughness: 0.35, metalness: 0.25, emissive: paint.trim, emissiveIntensity: 0.18, envMap: env }),
      carbon: new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.45, metalness: 0.65, envMap: env }),
      metal: new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.25, metalness: 1, envMap: env }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x0b1420, roughness: 0.05, metalness: 0.5, clearcoat: 1, envMap: env, envMapIntensity: 1.6 }),
    }
    for (const m of Object.values(mats)) patchStandard(m as THREE.MeshStandardMaterial)
    this.glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.6, 3.2) })
    mats.glow = this.glow
    mats.hot = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.42, 0.1) })

    const B = new Builder()
    // ── hull: three stepped slabs, each smaller and higher ──
    B.add('paint', slab(hullShape(1), 0.3, 0.24, 5))
    B.add('carbon', slab(hullShape(0.93), 0.2, 0.12), 0, -0.3, -0.05)
    B.add('paint', slab(hullShape(0.7), 0.22, 0.16, 4), 0, 0.42, -0.35)
    // Spine + canopy with a frame.
    B.add('paint', new THREE.CapsuleGeometry(0.62, 4.0, 8, 18), 0, 0.66, -0.7, Math.PI / 2, 0, 0, 1.15, 1, 0.55)
    B.add('glass', new THREE.SphereGeometry(0.72, 28, 16), 0, 0.92, 1.45, 0, 0, 0, 0.86, 0.56, 2.15)
    B.add('carbon', new THREE.BoxGeometry(0.07, 0.08, 2.9), 0, 1.31, 1.4)
    // Nose: a sensor strip and a splitter.
    B.add('glow', new THREE.BoxGeometry(1.1, 0.05, 0.1), 0, 0.42, 4.55)
    B.add('carbon', new THREE.BoxGeometry(1.6, 0.06, 1.4), 0, -0.25, 4.3, 0.05, 0, 0)
    // Side intakes (dark mouths behind the cockpit).
    B.addSym('carbon', new THREE.BoxGeometry(0.55, 0.42, 1.7), 1.05, 0.62, 0.2, 0, -0.18, 0)
    B.addSym('metal', new THREE.BoxGeometry(0.5, 0.06, 1.2), 1.07, 0.62, 0.35, 0, -0.18, 0)
    // Strakes and panel seams.
    B.addSym('trim', new THREE.BoxGeometry(0.14, 0.07, 5.0), 0.95, 0.8, -0.2, 0, -0.12, 0)
    B.addSym('carbon', new THREE.BoxGeometry(0.04, 0.04, 2.6), 1.75, 0.57, -1.4, 0, -0.55, 0)
    B.addSym('carbon', new THREE.BoxGeometry(1.6, 0.04, 0.04), 1.6, 0.57, -2.4)
    B.addSym('trim', new THREE.BoxGeometry(1.4, 0.05, 0.22), 2.3, 0.35, -1.2, 0, -0.62, 0)
    // Canted fins with tips.
    const fin = new THREE.BoxGeometry(0.1, 1.2, 1.8)
    fin.translate(0, 0.6, 0)
    B.addSym('paint', fin, 1.55, 0.6, -3.25, -0.25, 0, -0.35)
    B.addSym('trim', new THREE.BoxGeometry(0.12, 0.26, 0.7), 1.97, 1.66, -3.6, -0.25, 0, -0.35)
    // Wingtip pods (side thrusters) with glowing ports.
    B.addSym('carbon', new THREE.CylinderGeometry(0.22, 0.3, 1.7, 12), 3.0, 0.22, -2.1, Math.PI / 2, 0, 0)
    B.addSym('glow', new THREE.CylinderGeometry(0.12, 0.12, 0.08, 10), 3.0, 0.22, -1.22, Math.PI / 2, 0, 0)
    // Hover emitters underneath.
    B.addSym('glow', new THREE.BoxGeometry(0.22, 0.05, 3.4), 2.0, -0.33, -0.6, 0, -0.5, 0)
    B.add('glow', new THREE.BoxGeometry(0.9, 0.05, 0.2), 0, -0.33, 3.0)
    // Rear diffuser.
    for (const x of [-1.4, -0.7, 0, 0.7, 1.4]) B.add('carbon', new THREE.BoxGeometry(0.06, 0.4, 1.1), x, -0.25, -3.75)
    // Nacelles, petal rings, hot cores.
    for (const [x, y] of NOZZLES) {
      B.add('carbon', new THREE.CylinderGeometry(0.52, 0.6, 2.0, 22, 1, true), x, y, NOZZLE_Z + 0.95, Math.PI / 2, 0, 0)
      B.add('metal', new THREE.TorusGeometry(0.54, 0.07, 8, 24), x, y, NOZZLE_Z + 0.05)
      B.add('metal', new THREE.TorusGeometry(0.58, 0.04, 6, 24), x, y, NOZZLE_Z + 1.6)
      for (let p = 0; p < 10; p++) {
        const a = (p / 10) * Math.PI * 2
        B.add('carbon', new THREE.BoxGeometry(0.2, 0.04, 0.45), x + Math.cos(a) * 0.55, y + Math.sin(a) * 0.55, NOZZLE_Z - 0.1, 0, 0, a + Math.PI / 2)
      }
      B.add('hot', new THREE.CircleGeometry(0.34, 20), x, y, NOZZLE_Z + 0.25, 0, Math.PI, 0)
      B.add('carbon', new THREE.CylinderGeometry(0.47, 0.36, 0.3, 20, 1, true), x, y, NOZZLE_Z + 0.1, Math.PI / 2, 0, 0)
    }
    B.add('carbon', new THREE.CylinderGeometry(0.02, 0.03, 0.9, 5), -0.5, 1.2, -1.6, -0.3, 0, 0)
    B.build(mats, this.hi)

    // Racing numbers on the fins' outer faces.
    const num = new THREE.MeshBasicMaterial({ map: numberTexture(paint.number, '#' + new THREE.Color(paint.trim).getHexString()), transparent: true, depthWrite: false })
    for (const sgn of [-1, 1]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), num)
      // Fin at x = ±1.55 canted outward 0.35 rad: sit the plate just off its outer face.
      plane.position.set(sgn * 1.83, 1.18, -3.3)
      plane.rotation.set(0, sgn * Math.PI / 2, 0, 'YXZ')
      plane.rotateX(-sgn * 0.35)
      this.hi.add(plane)
    }

    // Low detail.
    const L = new Builder()
    L.add('paint', slab(hullShape(1), 0.45, 0.2, 1))
    L.add('paint', new THREE.CapsuleGeometry(0.6, 4.0, 2, 8), 0, 0.66, -0.7, Math.PI / 2, 0, 0, 1.1, 1, 0.55)
    for (const [x, y] of NOZZLES) {
      L.add('carbon', new THREE.CylinderGeometry(0.52, 0.6, 2.0, 8, 1, true), x, y, NOZZLE_Z + 0.95, Math.PI / 2, 0, 0)
      L.add('hot', new THREE.CircleGeometry(0.44, 8), x, y, NOZZLE_Z + 0.1, 0, Math.PI, 0)
    }
    L.addSym('trim', new THREE.BoxGeometry(0.14, 1.2, 1.8), 1.55, 1.2, -3.25, -0.25, 0, -0.35)
    L.build(mats, this.lo)
    this.lo.visible = false

    // Flames: two draws for all three nozzles.
    this.flameMat = flameMaterial(new THREE.Color(3.2, 2.3, 1.4), new THREE.Color(2.2, 0.55, 0.1))
    this.innerMat = flameMaterial(new THREE.Color(3.6, 3.4, 3.4), new THREE.Color(1.4, 1.2, 1.8))
    for (const f of [new THREE.Mesh(flameGeometry(0.48), this.flameMat), new THREE.Mesh(flameGeometry(0.26), this.innerMat)]) {
      f.frustumCulled = false
      f.renderOrder = 5
      this.body.add(f)
    }

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

  /** Detail by distance from the camera. */
  lod(cam: THREE.Vector3): void {
    const far = this.root.position.distanceToSquared(cam) > LOD_DIST * LOD_DIST
    this.hi.visible = !far
    this.lo.visible = far
  }

  setFlames(throttle: number, boost: number, time: number): void {
    const len = 1.2 + throttle * 1.8 + boost * 5.5
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

  setCone(a: number, time: number): void {
    this.cone.visible = a > 0.01
    this.coneMat.uniforms.uA.value = a
    this.coneMat.uniforms.uTime.value = time
  }
}
