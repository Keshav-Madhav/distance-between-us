// Shockwaves: pooled expanding rings.
//   air    — a pale ring standing across the direction of travel (a Mach break, the afterburner
//            lighting): thin, bright-edged, gone in half a second; it rides with the craft's speed
//   ground — a flat ring on the sand, dust-coloured and wide (a crash, a hard landing, Mach 1 low down)
import * as THREE from 'three'
import { groundH } from './terrain'

const N = 16

interface Ring {
  on: boolean
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  t: number
  life: number
  r0: number
  r1: number
  vel: THREE.Vector3
  ground: boolean
}

const vert = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
const frag = /* glsl */ `
  uniform float uA; uniform vec3 uColor; uniform float uEdge; varying vec2 vUv;
  void main() {
    // RingGeometry uv: radial from the inside (x) — a bright leading edge, a soft wake inside.
    float r = vUv.y;
    float edge = smoothstep(uEdge, 1.0, r) * (1.0 - smoothstep(0.96, 1.0, r));
    float wake = smoothstep(0.0, 1.0, r) * 0.25;
    gl_FragColor = vec4(uColor * (edge + wake) * uA, 1.0);
  }`

export class Shock {
  readonly group = new THREE.Group()
  private readonly rings: Ring[] = []
  private readonly q = new THREE.Quaternion()
  private readonly z = new THREE.Vector3(0, 0, 1)
  private readonly d = new THREE.Vector3()

  constructor() {
    for (let i = 0; i < N; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { uA: { value: 0 }, uColor: { value: new THREE.Color() }, uEdge: { value: 0.75 } },
        vertexShader: vert, fragmentShader: frag,
      })
      const g = new THREE.RingGeometry(0.6, 1, 64, 1)
      // Map uv.y to "radius fraction" for the shader.
      const uv = g.attributes.uv as THREE.BufferAttribute
      const pos = g.attributes.position as THREE.BufferAttribute
      for (let k = 0; k < uv.count; k++) uv.setY(k, (Math.hypot(pos.getX(k), pos.getY(k)) - 0.6) / 0.4)
      const mesh = new THREE.Mesh(g, mat)
      mesh.visible = false
      mesh.frustumCulled = false
      mesh.renderOrder = 7
      this.group.add(mesh)
      this.rings.push({ on: false, mesh, mat, t: 0, life: 1, r0: 1, r1: 10, vel: new THREE.Vector3(), ground: false })
    }
  }

  private take(): Ring {
    let r = this.rings.find((q) => !q.on)
    if (!r) r = this.rings.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b))
    return r
  }

  /** A ring standing across `dir` at `at`, carried by `vel`. */
  air(at: THREE.Vector3, dir: THREE.Vector3, vel: THREE.Vector3, size: number, strength: number): void {
    const r = this.take()
    r.on = true; r.t = 0; r.life = 0.55; r.r0 = 4 * size; r.r1 = 70 * size; r.ground = false
    r.vel.copy(vel).multiplyScalar(0.92)
    r.mesh.position.copy(at)
    this.d.copy(dir).normalize()
    r.mesh.quaternion.copy(this.q.setFromUnitVectors(this.z, this.d))
    r.mat.uniforms.uColor.value.setRGB(1.6, 1.7, 1.9).multiplyScalar(strength)
    r.mat.uniforms.uEdge.value = 0.8
    r.mesh.visible = true
  }

  /** A flat ring on the ground at (x, z). */
  ground(x: number, z: number, size: number, strength: number, hot = false): void {
    const r = this.take()
    r.on = true; r.t = 0; r.life = 0.9 + size * 0.15; r.r0 = 6; r.r1 = 90 * size; r.ground = true
    r.vel.set(0, 0, 0)
    r.mesh.position.set(x, groundH(x, z) + 1.2, z)
    r.mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
    if (hot) r.mat.uniforms.uColor.value.setRGB(3, 1.4, 0.5).multiplyScalar(strength)
    else r.mat.uniforms.uColor.value.setRGB(1.4, 0.95, 0.6).multiplyScalar(strength)
    r.mat.uniforms.uEdge.value = 0.55
    r.mesh.visible = true
  }

  update(dt: number): void {
    for (const r of this.rings) {
      if (!r.on) continue
      r.t += dt
      const u = r.t / r.life
      if (u >= 1) { r.on = false; r.mesh.visible = false; continue }
      // Fast out, easing: a blast, not a ripple.
      const e = 1 - (1 - u) * (1 - u) * (1 - u)
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e)
      r.mesh.position.addScaledVector(r.vel, dt)
      r.mat.uniforms.uA.value = (1 - u) * (1 - u)
    }
  }

  shift(dx: number, dz: number): void { for (const r of this.rings) { r.mesh.position.x += dx; r.mesh.position.z += dz } }
}
