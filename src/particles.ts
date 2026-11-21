// Pooled billboard particles: one instanced draw per pool, no allocation after construction.
// Two pools: 'glow' (additive: fire, sparks, flashes, plasma) and 'smoke' (alpha: dust, smoke).
// Particles keep their own momentum with drag — an explosion at Mach 5 keeps flying a moment, then
// falls behind, and you fly through it.
import * as THREE from 'three'
import { SKY_GLSL } from './terrain'
import { NOISE_TEX } from './shaders'

export interface Emit {
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  life: number
  size0: number; size1: number
  r: number; g: number; b: number; a: number
  /** End colour multiplier (fire cools). */
  r1?: number; g1?: number; b1?: number
  drag?: number
  grav?: number
  /** 0 soft blob, 1 streak along velocity. */
  streak?: number
}

// (Per-particle work moved to the vertex shader — fog and haze are constant across a puff — and every
// quad's size on screen is capped: a dust cloud at the camera stacked full-screen quads dozens deep,
// 50-100 ms frames on an M5 Pro.)
const VERT = /* glsl */ `
  ${SKY_GLSL}
  uniform float uAdd;
  attribute vec4 aPos;   // xyz, size
  attribute vec4 aCol;   // rgba
  attribute vec4 aVel;   // velocity (for streaks), streak flag
  varying vec4 vCol;
  varying vec2 vUv;
  varying vec3 vW;
  varying float vSeed;
  void main() {
    vUv = uv;
    vCol = aCol;
    vSeed = fract(aPos.x * 0.137 + aPos.z * 0.311);
    vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0);
    // Fog (smoke) or distance haze (glow), once per particle.
    if (uAdd > 0.5) { float d = length(aPos.xyz - cameraPosition) * 0.00006; vCol.rgb *= exp(-d * d); }
    else vCol.rgb = applyFog(aCol.rgb, aPos.xyz);
    // Size on screen capped (~a third of the screen height); a puff the camera is inside fades out.
    float depth = max(-mv.z, 0.01);
    float scr = aPos.w * projectionMatrix[1][1] / depth;
    float size = aPos.w * min(1.0, 0.7 / max(scr, 1e-4));
    vCol.a *= smoothstep(0.5, 1.6, depth / max(aPos.w, 0.01));
    vec2 off = position.xy * size;
    if (aVel.w > 0.5) {
      // Stretched along the screen-space velocity.
      vec3 vv = mat3(viewMatrix) * aVel.xyz;
      vec2 d = vv.xy;
      float l = length(d);
      d = l > 1e-4 ? d / l : vec2(1.0, 0.0);
      vec2 nrm = vec2(-d.y, d.x);
      float len = size * (1.0 + min(l * 0.05, 14.0));
      off = d * position.y * len + nrm * position.x * size * 0.35;
    }
    mv.xy += off;
    vW = aPos.xyz;
    gl_Position = projectionMatrix * mv;
  }`

function material(additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uAdd: { value: additive ? 1 : 0 }, tNoise: { value: NOISE_TEX } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tNoise;
      varying vec4 vCol;
      varying vec2 vUv;
      varying vec3 vW;
      varying float vSeed;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        ${
          additive
            ? `float a = pow(max(1.0 - r, 0.0), 1.8); // (a softer edge than a²: a² beaded the fire trails)
               gl_FragColor = vec4(vCol.rgb * a * vCol.a, 1.0);`
            : `// A lumpy puff, not a disc (one baked-noise read for the lumps).
               if (r > 1.0) discard;
               float lump = 0.66 + 0.34 * texture2D(tNoise, p * 0.18 + vSeed * 7.0).r;
               float a = smoothstep(lump, lump * 0.35, r) * vCol.a;
               if (a < 0.004) discard;
               gl_FragColor = vec4(vCol.rgb, a);`
        }
      }`,
  })
}

export class Pool {
  readonly mesh: THREE.InstancedMesh
  private readonly n: number
  private alive = 0
  // Per-particle state.
  private readonly p: Float32Array
  private readonly v: Float32Array
  private readonly t: Float32Array // age, life
  private readonly s: Float32Array // size0, size1
  private readonly c0: Float32Array
  private readonly c1: Float32Array
  private readonly k: Float32Array // drag, grav, streak
  private readonly aPos: THREE.InstancedBufferAttribute
  private readonly aCol: THREE.InstancedBufferAttribute
  private readonly aVel: THREE.InstancedBufferAttribute
  /** Scales every emission count (quality tiers). */
  density = 1

  constructor(n: number, additive: boolean) {
    this.n = n
    this.p = new Float32Array(n * 3)
    this.v = new Float32Array(n * 3)
    this.t = new Float32Array(n * 2)
    this.s = new Float32Array(n * 2)
    this.c0 = new Float32Array(n * 4)
    this.c1 = new Float32Array(n * 3)
    this.k = new Float32Array(n * 3)
    const g = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(1, 1)
    g.index = quad.index
    g.setAttribute('position', quad.attributes.position)
    g.setAttribute('uv', quad.attributes.uv)
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage)
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage)
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('aPos', this.aPos)
    g.setAttribute('aCol', this.aCol)
    g.setAttribute('aVel', this.aVel)
    this.mesh = new THREE.InstancedMesh(g, material(additive), n)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.renderOrder = additive ? 3 : 2
  }

  emit(e: Emit): void {
    if (this.alive >= this.n) return
    const i = this.alive++
    const i3 = i * 3
    this.p[i3] = e.x; this.p[i3 + 1] = e.y; this.p[i3 + 2] = e.z
    this.v[i3] = e.vx; this.v[i3 + 1] = e.vy; this.v[i3 + 2] = e.vz
    this.t[i * 2] = 0; this.t[i * 2 + 1] = e.life
    this.s[i * 2] = e.size0; this.s[i * 2 + 1] = e.size1
    this.c0[i * 4] = e.r; this.c0[i * 4 + 1] = e.g; this.c0[i * 4 + 2] = e.b; this.c0[i * 4 + 3] = e.a
    this.c1[i3] = e.r1 ?? 1; this.c1[i3 + 1] = e.g1 ?? 1; this.c1[i3 + 2] = e.b1 ?? 1
    this.k[i3] = e.drag ?? 0; this.k[i3 + 1] = e.grav ?? 0; this.k[i3 + 2] = e.streak ?? 0
  }

  private kill(i: number): void {
    const j = --this.alive
    if (i === j) return
    const cp = (arr: Float32Array, w: number) => { for (let q = 0; q < w; q++) arr[i * w + q] = arr[j * w + q] }
    cp(this.p, 3); cp(this.v, 3); cp(this.t, 2); cp(this.s, 2); cp(this.c0, 4); cp(this.c1, 3); cp(this.k, 3)
  }

  shift(dx: number, dz: number): void {
    for (let i = 0; i < this.alive; i++) { this.p[i * 3] += dx; this.p[i * 3 + 2] += dz }
  }

  clear(): void { this.alive = 0; this.mesh.count = 0 }

  update(dt: number): void {
    const P = this.aPos.array as Float32Array
    const C = this.aCol.array as Float32Array
    const V = this.aVel.array as Float32Array
    let i = 0
    while (i < this.alive) {
      const age = (this.t[i * 2] += dt)
      const life = this.t[i * 2 + 1]
      if (age >= life) { this.kill(i); continue }
      const i3 = i * 3
      const drag = Math.exp(-this.k[i3] * dt)
      this.v[i3] *= drag; this.v[i3 + 1] = this.v[i3 + 1] * drag - this.k[i3 + 1] * dt; this.v[i3 + 2] *= drag
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt
      const u = age / life
      const sz = this.s[i * 2] + (this.s[i * 2 + 1] - this.s[i * 2]) * (1 - (1 - u) * (1 - u))
      P[i * 4] = this.p[i3]; P[i * 4 + 1] = this.p[i3 + 1]; P[i * 4 + 2] = this.p[i3 + 2]; P[i * 4 + 3] = sz
      const fadeIn = Math.min(1, age * 12)
      const fade = (1 - u) * (1 - u) * fadeIn
      C[i * 4] = this.c0[i * 4] * (1 + (this.c1[i3] - 1) * u)
      C[i * 4 + 1] = this.c0[i * 4 + 1] * (1 + (this.c1[i3 + 1] - 1) * u)
      C[i * 4 + 2] = this.c0[i * 4 + 2] * (1 + (this.c1[i3 + 2] - 1) * u)
      C[i * 4 + 3] = this.c0[i * 4 + 3] * fade
      V[i * 4] = this.v[i3]; V[i * 4 + 1] = this.v[i3 + 1]; V[i * 4 + 2] = this.v[i3 + 2]; V[i * 4 + 3] = this.k[i3 + 2]
      i++
    }
    this.mesh.count = this.alive
    if (this.alive > 0) {
      this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, this.alive * 4); this.aPos.needsUpdate = true
      this.aCol.clearUpdateRanges(); this.aCol.addUpdateRange(0, this.alive * 4); this.aCol.needsUpdate = true
      this.aVel.clearUpdateRanges(); this.aVel.addUpdateRange(0, this.alive * 4); this.aVel.needsUpdate = true
    }
  }

  get count(): number { return this.alive }
}

/** The shared emit record (filled and passed; never allocated per particle). */
export const E: Emit = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size0: 1, size1: 1, r: 1, g: 1, b: 1, a: 1 }
export function resetE(): Emit {
  E.r1 = 1; E.g1 = 1; E.b1 = 1; E.drag = 0; E.grav = 0; E.streak = 0
  return E
}

export class Fx {
  readonly glow = new Pool(2600, true)
  readonly smoke = new Pool(3200, false)
  readonly group = new THREE.Group()
  constructor() {
    this.group.add(this.smoke.mesh, this.glow.mesh)
  }
  update(dt: number): void { this.glow.update(dt); this.smoke.update(dt) }
  shift(dx: number, dz: number): void { this.glow.shift(dx, dz); this.smoke.shift(dx, dz) }
  clear(): void { this.glow.clear(); this.smoke.clear() }

  /** A big fireball with smoke, sparks and debris, carried by (vx, vy, vz). */
  explosion(x: number, y: number, z: number, vx: number, vy: number, vz: number, scale: number): void {
    const R = Math.random
    const nFire = Math.round(22 * scale ** 0.6)
    for (let i = 0; i < nFire; i++) {
      const e = resetE()
      const a = R() * 6.283, b = R() * 2 - 1, sp = (40 + R() * 90) * scale ** 0.7
      const c = Math.sqrt(1 - b * b)
      e.x = x; e.y = y; e.z = z
      e.vx = vx * 0.92 + Math.cos(a) * c * sp; e.vy = vy * 0.9 + b * sp + 10; e.vz = vz * 0.92 + Math.sin(a) * c * sp
      e.life = 0.5 + R() * 0.7
      e.size0 = 4 * scale; e.size1 = (16 + R() * 14) * scale
      e.r = 9; e.g = 4.2; e.b = 1.4; e.a = 1
      e.r1 = 0.35; e.g1 = 0.18; e.b1 = 0.12
      e.drag = 2.2; e.grav = -4
      this.glow.emit(e)
    }
    // White core flash.
    {
      const e = resetE()
      e.x = x; e.y = y; e.z = z; e.vx = vx * 0.95; e.vy = vy * 0.95; e.vz = vz * 0.95
      e.life = 0.22; e.size0 = 30 * scale; e.size1 = 70 * scale
      e.r = 14; e.g = 12; e.b = 10; e.a = 1; e.drag = 1.5
      this.glow.emit(e)
    }
    const nSmoke = Math.round(18 * scale ** 0.6 * this.smoke.density)
    for (let i = 0; i < nSmoke; i++) {
      const e = resetE()
      const a = R() * 6.283, b = R() * 1.6 - 0.6, sp = (25 + R() * 60) * scale ** 0.7
      e.x = x; e.y = y; e.z = z
      e.vx = vx * 0.85 + Math.cos(a) * sp; e.vy = vy * 0.85 + b * sp + 6; e.vz = vz * 0.85 + Math.sin(a) * sp
      e.life = 2.2 + R() * 2.2
      e.size0 = 8 * scale; e.size1 = (34 + R() * 26) * scale
      const g = 0.06 + R() * 0.08
      e.r = g * 1.2; e.g = g; e.b = g * 0.9; e.a = 0.78
      e.r1 = 3.2; e.g1 = 3.0; e.b1 = 2.8
      e.drag = 1.6; e.grav = -6
      this.smoke.emit(e)
    }
    const nSp = Math.round(40 * scale ** 0.5)
    for (let i = 0; i < nSp; i++) {
      const e = resetE()
      const a = R() * 6.283, b = R() * 2 - 1, sp = 120 + R() * 260
      const c = Math.sqrt(1 - b * b)
      e.x = x; e.y = y; e.z = z
      e.vx = vx * 0.95 + Math.cos(a) * c * sp; e.vy = vy + b * sp; e.vz = vz * 0.95 + Math.sin(a) * c * sp
      e.life = 0.5 + R() * 0.9; e.size0 = 0.9; e.size1 = 0.4
      e.r = 8; e.g = 5; e.b = 2.2; e.a = 1; e.drag = 1.2; e.grav = 60; e.streak = 1
      this.glow.emit(e)
    }
  }

  /** A burst of sand thrown up from the ground. */
  dust(x: number, y: number, z: number, vx: number, vz: number, n: number, size: number, up: number): void {
    const R = Math.random
    n = Math.round(n * this.smoke.density)
    for (let i = 0; i < n; i++) {
      const e = resetE()
      const a = R() * 6.283, sp = R() * up
      e.x = x + (R() - 0.5) * size * 0.5; e.y = y + R() * 2; e.z = z + (R() - 0.5) * size * 0.5
      e.vx = vx + Math.cos(a) * sp; e.vy = up * (0.4 + R() * 0.8); e.vz = vz + Math.sin(a) * sp
      e.life = 1.4 + R() * 1.8
      e.size0 = size * 0.35; e.size1 = size * (1.2 + R())
      e.r = 0.78; e.g = 0.4; e.b = 0.2; e.a = 0.55
      e.r1 = 1.1; e.g1 = 1.15; e.b1 = 1.2
      e.drag = 2.2; e.grav = 9
      this.smoke.emit(e)
    }
  }
}
