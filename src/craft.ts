// The craft: a low, sleek hover-racer built in code. Forward is local +Z.
// Pearl-white clearcoat body, carbon underside, orange accents, a cyan hover strip,
// three rear thrusters whose flames grow, whiten and grow shock diamonds on boost.
import * as THREE from 'three'
import { patchStandard } from './shaders'

function flameMaterial(core: THREE.Color, edge: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uThrottle: { value: 0 },
      uBoost: { value: 0 },
      uTime: { value: 0 },
      uCore: { value: core },
      uEdge: { value: edge },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uThrottle;
      uniform float uBoost;
      uniform float uTime;
      uniform vec3 uCore;
      uniform vec3 uEdge;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      float h(float x) { return fract(sin(x * 91.3) * 437.5); }
      void main() {
        // uv.y: 0 at the nozzle (the cone's base), 1 at the tip.
        float t = vUv.y;
        float facing = abs(dot(vN, vV));
        float body = pow(facing, 1.5);
        float fade = pow(1.0 - t, 1.6);
        float flick = 0.85 + 0.15 * h(floor(uTime * 60.0) + vUv.x * 7.0);
        // Shock diamonds: bright bands along the plume on boost.
        float diamonds = uBoost * smoothstep(0.55, 1.0, sin(t * 26.0 - uTime * 4.0)) * (1.0 - t) * 1.6;
        vec3 c = mix(uEdge, uCore, body * (1.0 - t * 0.7)) * (fade * body * 0.9 + diamonds * 0.5);
        gl_FragColor = vec4(c * flick * (0.3 + 0.7 * uThrottle), 1.0);
      }`,
  })
}

export class Craft {
  readonly root = new THREE.Group()
  /** Banks and pitches; root carries position + heading. */
  readonly body = new THREE.Group()
  readonly flames: THREE.Mesh[] = []
  readonly nozzles: THREE.Vector3[] = []
  readonly wingtips: THREE.Vector3[] = [new THREE.Vector3(-3.1, 0.15, -2.2), new THREE.Vector3(3.1, 0.15, -2.2)]
  readonly sidePuffs: THREE.Vector3[] = [new THREE.Vector3(-2.9, 0.1, 0.2), new THREE.Vector3(2.9, 0.1, 0.2)]
  private readonly flameMat: THREE.ShaderMaterial
  private readonly innerMat: THREE.ShaderMaterial
  private readonly glow: THREE.MeshBasicMaterial
  readonly cone: THREE.Mesh
  private readonly coneMat: THREE.ShaderMaterial

  constructor(env: THREE.Texture) {
    this.root.add(this.body)
    const white = new THREE.MeshPhysicalMaterial({ color: 0xeef1f4, roughness: 0.28, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08, envMap: env, envMapIntensity: 1.1 })
    const carbon = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.5, metalness: 0.6, envMap: env, flatShading: true })
    const orange = new THREE.MeshStandardMaterial({ color: 0xff5a14, roughness: 0.35, metalness: 0.2, emissive: 0xff3a00, emissiveIntensity: 0.35, envMap: env })
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b1420, roughness: 0.04, metalness: 0.5, clearcoat: 1, envMap: env, envMapIntensity: 1.6 })
    this.glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.6, 3.2) })
    const hot = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.3, 0.55) })
    for (const m of [white, carbon, orange, glass]) patchStandard(m as THREE.MeshStandardMaterial)

    // Hull: a delta outline (top view) extruded thin with a generous bevel.
    const s = new THREE.Shape()
    s.moveTo(0, 5.4)
    s.bezierCurveTo(0.55, 4.2, 1.2, 1.8, 2.8, -1.6)
    s.lineTo(3.05, -2.7)
    s.lineTo(1.9, -3.4)
    s.lineTo(1.3, -4.1)
    s.lineTo(-1.3, -4.1)
    s.lineTo(-1.9, -3.4)
    s.lineTo(-3.05, -2.7)
    s.lineTo(-2.8, -1.6)
    s.bezierCurveTo(-1.2, 1.8, -0.55, 4.2, 0, 5.4)
    const hullGeo = new THREE.ExtrudeGeometry(s, { depth: 0.32, bevelEnabled: true, bevelThickness: 0.24, bevelSize: 0.22, bevelSegments: 3, curveSegments: 14 })
    hullGeo.rotateX(Math.PI / 2)
    // (rotateX(+90°) maps shape-y to +z, so the nose is +Z; the extrusion goes to −y.)
    hullGeo.translate(0, 0.32, 0)
    hullGeo.computeVertexNormals()
    const hull = new THREE.Mesh(hullGeo, white)
    this.body.add(hull)
    // Belly: carbon, a little smaller, under the hull.
    const belly = new THREE.Mesh(hullGeo, carbon)
    belly.scale.set(0.9, 0.7, 0.94)
    belly.position.y = -0.28
    this.body.add(belly)

    // Spine + canopy.
    const spine = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 4.2, 6, 14), white)
    spine.rotation.x = Math.PI / 2
    spine.scale.set(1.1, 1, 0.55)
    spine.position.set(0, 0.62, -0.6)
    this.body.add(spine)
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 14), glass)
    canopy.scale.set(0.85, 0.55, 2.1)
    canopy.position.set(0, 0.86, 1.5)
    this.body.add(canopy)

    // Accent stripes.
    for (const x of [-0.95, 0.95]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 5.2), orange)
      st.position.set(x, 0.72, -0.1)
      st.rotation.y = x > 0 ? -0.12 : 0.12
      this.body.add(st)
    }
    // Canted fins.
    for (const x of [-1.55, 1.55]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.15, 1.7), white)
      fin.geometry.translate(0, 0.55, 0)
      fin.position.set(x, 0.55, -3.2)
      fin.rotation.z = x > 0 ? -0.35 : 0.35
      fin.rotation.x = -0.25
      this.body.add(fin)
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.6), orange)
      tip.position.set(x * 1.24, 1.55, -3.55)
      tip.rotation.z = fin.rotation.z
      this.body.add(tip)
    }
    // Hover strips (cyan, under the wings) and the wingtip side thrusters.
    for (const x of [-2.1, 2.1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 3.4), this.glow)
      strip.position.set(x, -0.08, -0.6)
      strip.rotation.y = x > 0 ? -0.5 : 0.5
      this.body.add(strip)
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.6, 10), carbon)
      pod.rotation.x = Math.PI / 2
      pod.position.set(x * 1.38, 0.18, -2.0)
      this.body.add(pod)
    }

    // Three thrusters: carbon nacelles, hot cores, and flames.
    this.flameMat = flameMaterial(new THREE.Color(3.2, 2.3, 1.4), new THREE.Color(2.2, 0.55, 0.1))
    this.innerMat = flameMaterial(new THREE.Color(3.6, 3.4, 3.4), new THREE.Color(1.4, 1.2, 1.8))
    const flameGeo = new THREE.ConeGeometry(0.48, 1, 20, 1, true)
    flameGeo.translate(0, 0.5, 0)
    flameGeo.rotateX(-Math.PI / 2) // base at the nozzle, tip toward -Z
    const nacGeo = new THREE.CylinderGeometry(0.52, 0.6, 1.9, 18, 1, true)
    nacGeo.rotateX(Math.PI / 2)
    const coreGeo = new THREE.CircleGeometry(0.44, 18)
    coreGeo.rotateY(Math.PI)
    const pos: [number, number, number][] = [[-1.05, 0.34, -4.0], [0, 0.55, -4.15], [1.05, 0.34, -4.0]]
    for (const [x, y, z] of pos) {
      const nac = new THREE.Mesh(nacGeo, carbon)
      nac.position.set(x, y, z + 0.6)
      this.body.add(nac)
      const core = new THREE.Mesh(coreGeo, hot)
      core.position.set(x, y, z - 0.25)
      this.body.add(core)
      const f = new THREE.Mesh(flameGeo, this.flameMat)
      f.position.set(x, y, z - 0.3)
      this.body.add(f)
      this.flames.push(f)
      const fi = new THREE.Mesh(flameGeo, this.innerMat)
      fi.position.set(x, y, z - 0.3)
      fi.scale.setScalar(0.5)
      f.userData.inner = fi
      this.body.add(fi)
      this.nozzles.push(new THREE.Vector3(x, y, z - 0.4))
    }

    // The vapour cone: a pale shell around the craft, flashed as each Mach number breaks.
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
          gl_FragColor = vec4(vec3(1.4, 1.45, 1.5), a * 0.75);
        }`,
    })
    const coneGeo = new THREE.ConeGeometry(4.6, 7, 40, 1, true)
    coneGeo.rotateX(Math.PI / 2) // apex forward
    this.cone = new THREE.Mesh(coneGeo, this.coneMat)
    this.cone.position.set(0, 0.4, -1.4)
    this.cone.visible = false
    this.body.add(this.cone)
  }

  /** Flames by throttle (0 idle … 1 cruise) and boost (0 … 1). */
  setFlames(throttle: number, boost: number, time: number, flicker: number): void {
    const len = 1.2 + throttle * 1.8 + boost * 5.5
    const wid = 0.85 + boost * 0.35
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i]
      const j = 1 + flicker * (Math.sin(time * 71 + i * 2.1) * 0.08 + Math.sin(time * 37 + i) * 0.06)
      f.scale.set(wid, wid, len * j)
      const fi = f.userData.inner as THREE.Mesh
      fi.scale.set(wid * 0.55, wid * 0.55, len * 0.55 * j)
    }
    for (const m of [this.flameMat, this.innerMat]) {
      m.uniforms.uThrottle.value = throttle
      m.uniforms.uBoost.value = boost
      m.uniforms.uTime.value = time
    }
    this.glow.color.setRGB(0.3 + boost * 0.4, 1.6, 3.2)
  }

  setCone(a: number, time: number): void {
    this.cone.visible = a > 0.01
    this.coneMat.uniforms.uA.value = a
    this.coneMat.uniforms.uTime.value = time
  }
}
