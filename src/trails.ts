// Ribbon trails: glowing exhaust streaks from the thrusters, vapour from the wingtips.
// A ring of the last N points; rebuilt each frame as a camera-facing strip. At Mach 5 the points
// are ~30 m apart and the ribbon runs a kilometre back.
import * as THREE from 'three'

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _t = new THREE.Vector3()
const _side = new THREE.Vector3()

export class Trail {
  readonly mesh: THREE.Mesh
  private readonly pts: Float32Array
  private readonly ages: Float32Array
  private head = 0
  private len = 0
  private readonly pos: Float32Array
  private readonly fade: Float32Array
  private readonly geo: THREE.BufferGeometry
  readonly mat: THREE.ShaderMaterial
  /** Intensity this frame (0 hides it). */
  strength = 1
  width = 0.6

  constructor(readonly n: number, color: THREE.Color, additive: boolean, readonly maxAge: number) {
    this.pts = new Float32Array(n * 3)
    this.ages = new Float32Array(n)
    this.pos = new Float32Array(n * 2 * 3)
    this.fade = new Float32Array(n * 2)
    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('aFade', new THREE.BufferAttribute(this.fade, 1).setUsage(THREE.DynamicDrawUsage))
    const idx: number[] = []
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    this.geo.setIndex(idx)
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uColor: { value: color }, uStrength: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aFade;
        varying float vFade;
        void main() {
          // Seen end-on from the chase camera a ribbon would cover the whole lower screen: it fades
          // out close to the eye and reads as a streak only further back.
          float d = length(position - cameraPosition);
          vFade = aFade * smoothstep(14.0, 70.0, d);
          gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uStrength;
        varying float vFade;
        void main() {
          float f = vFade * vFade * uStrength;
          ${additive ? 'gl_FragColor = vec4(uColor * f, 1.0);' : 'gl_FragColor = vec4(uColor, f);'}
        }`,
    })
    this.mesh = new THREE.Mesh(this.geo, this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 4
  }

  reset(): void { this.len = 0 }

  push(p: THREE.Vector3, dt: number): void {
    for (let i = 0; i < this.len; i++) this.ages[i] += dt
    this.head = (this.head + 1) % this.n
    const k = this.head * 3
    this.pts[k] = p.x; this.pts[k + 1] = p.y; this.pts[k + 2] = p.z
    this.ages[this.head] = 0
    this.len = Math.min(this.n, this.len + 1)
  }

  shift(dx: number, dz: number): void {
    for (let i = 0; i < this.n; i++) { this.pts[i * 3] += dx; this.pts[i * 3 + 2] += dz }
  }

  /** Rebuild the strip facing the camera. */
  build(cam: THREE.Vector3): void {
    this.mat.uniforms.uStrength.value = this.strength
    this.mesh.visible = this.strength > 0.01 && this.len > 1
    if (!this.mesh.visible) return
    for (let i = 0; i < this.n; i++) {
      const j = i < this.len ? i : this.len - 1
      const idx = (this.head - j + this.n) % this.n
      const nidx = (this.head - Math.min(j + 1, this.len - 1) + this.n) % this.n
      const pidx = (this.head - Math.max(j - 1, 0) + this.n) % this.n
      _a.fromArray(this.pts, idx * 3)
      _t.fromArray(this.pts, pidx * 3).sub(_b.fromArray(this.pts, nidx * 3))
      if (_t.lengthSq() < 1e-6) _t.set(0, 0, 1)
      _side.subVectors(cam, _a).cross(_t).normalize()
      const age = this.ages[idx] / this.maxAge
      const u = i / (this.n - 1)
      const w = this.width * (1 + u * 2.5)
      const f = i < this.len ? Math.max(0, 1 - Math.max(age, u)) : 0
      this.pos[i * 6] = _a.x + _side.x * w; this.pos[i * 6 + 1] = _a.y + _side.y * w; this.pos[i * 6 + 2] = _a.z + _side.z * w
      this.pos[i * 6 + 3] = _a.x - _side.x * w; this.pos[i * 6 + 4] = _a.y - _side.y * w; this.pos[i * 6 + 5] = _a.z - _side.z * w
      this.fade[i * 2] = f; this.fade[i * 2 + 1] = f
    }
    ;(this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.attributes.aFade as THREE.BufferAttribute).needsUpdate = true
  }
}
