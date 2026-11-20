// The desert: sky dome, three terrain rings (fine near, coarse far, each snapped to its own grid so
// nothing swims), shader-wrapped pebbles, CPU-wrapped boulders and mesas (both collide), the env map.
import * as THREE from 'three'
import { REBASE } from './config'
import { groundH, riverAt, SUN_DIR } from './terrain'
import { patchStandard, WORLD_GLSL } from './shaders'

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

// ───────────────────────────── sky ─────────────────────────────

function skyMaterial(ground: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      ${WORLD_GLSL}
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        float s = max(dot(d, SUN_DIR), 0.0);
        ${ground ? 'c = mix(c, vec3(0.62, 0.3, 0.13), 1.0 - smoothstep(-0.08, 0.0, d.y));' : ''}
        // The sun: a hot disk (well past bloom's threshold) and a wide glare.
        c += vec3(1.0, 0.9, 0.75) * (smoothstep(0.99955, 0.9998, s) * 60.0 + pow(s, 900.0) * 6.0 + pow(s, 30.0) * 0.5 + pow(s, 4.0) * 0.12);
        // A few high streaks of cirrus.
        float cl = vnoise(d.xz / max(d.y, 0.04) * vec2(1.6, 6.0) + 3.0) * vnoise(d.xz / max(d.y, 0.04) * 4.0);
        c = mix(c, vec3(1.9, 1.85, 1.8), smoothstep(0.35, 0.75, cl) * smoothstep(0.02, 0.25, d.y) * 0.35);
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
}

// ───────────────────────────── terrain ─────────────────────────────

function ringGeometry(spacing: number, cells: number, hole: number): THREE.BufferGeometry {
  const n = cells + 1
  const half = (cells * spacing) / 2
  const pos = new Float32Array(n * n * 3)
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3
      pos[k] = -half + i * spacing
      pos[k + 2] = -half + j * spacing
    }
  const idx: number[] = []
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++) {
      const cx = -half + (i + 0.5) * spacing
      const cz = -half + (j + 0.5) * spacing
      if (hole > 0 && Math.abs(cx) < hole && Math.abs(cz) < hole) continue
      const a = j * n + i
      idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9)
  return g
}

export interface GroundUniforms {
  uCraft: { value: THREE.Vector3 }
  uShadow: { value: THREE.Vector2 }
  uFwd: { value: THREE.Vector2 }
  uBoost: { value: number }
  uSpeed: { value: number }
  uWalker: { value: THREE.Vector4 }
  uTime: { value: number }
  tSand: { value: THREE.Texture | null }
  tClay: { value: THREE.Texture | null }
  tGravel: { value: THREE.Texture | null }
}

function terrainMaterial(shared: GroundUniforms, snap: { value: THREE.Vector2 }, drop: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uSnap: snap, uDrop: { value: drop } },
    vertexShader: /* glsl */ `
      ${WORLD_GLSL}
      uniform vec2 uSnap;
      uniform float uDrop;
      varying vec3 vW;
      void main() {
        vec2 xz = position.xz + uSnap;
        float d = length(xz - cameraPosition.xz);
        vec3 w = vec3(xz.x, groundH(xz) - uDrop * smoothstep(0.0, 400.0, d), xz.y);
        vW = w;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${WORLD_GLSL}
      uniform vec3 uCraft;
      uniform vec2 uShadow;
      uniform vec2 uFwd;
      uniform float uBoost;
      uniform float uSpeed;
      uniform vec4 uWalker;
      uniform float uTime;
      uniform sampler2D tSand;
      uniform sampler2D tClay;
      uniform sampler2D tGravel;
      varying vec3 vW;
      void main() {
        vec2 p = vW.xz;
        float dist = length(vW - cameraPosition);
        float e = 1.5 + dist * 0.004;
        float h0 = groundH(p);
        vec3 n = normalize(vec3(h0 - groundH(p + vec2(e, 0.0)), e, h0 - groundH(p + vec2(0.0, e))));
        float river = riverAt(p);

        // A faint extra ripple in the normal (the texture carries the real ripples, baked).
        float near = 1.0 - smoothstep(25.0, 240.0, dist);
        vec2 q = p + 7.0 * vec2(vnoise(p * 0.03), vnoise(p * 0.03 + 7.3));
        float ph = dot(q, vec2(0.83, 0.55)) * 3.4;
        n = normalize(n + vec3(0.83, 0.0, 0.55) * cos(ph) * 0.1 * near * (1.0 - river) * (1.0 - 0.6 * uSpeed));

        // Generated textures (docs/ART_STYLE.md): sand at two scales, rotated against each other so
        // the repeat never lines up; gravel in patches; cracked clay in the riverbeds.
        mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
        vec3 s1 = texture2D(tSand, p / 26.0).rgb;
        vec3 s2 = texture2D(tSand, rot * p / 170.0 + 0.37).rgb;
        vec3 sandT = mix(s1, s2, 0.45);
        float gm = smoothstep(0.58, 0.72, vnoise(p * 0.0045 + 11.0) * 0.7 + vnoise(p * 0.03) * 0.3);
        vec3 grav = texture2D(tGravel, rot * p / 9.0).rgb;
        vec3 clayT = texture2D(tClay, p / 13.0).rgb;
        vec3 alb = mix(sandT, grav, gm * 0.85);
        alb = mix(alb, clayT * vec3(1.0, 0.92, 0.85), river);
        // Macro variation: red patches, pale crests (shapes the far land reads as).
        float big = vnoise(p * 0.0011) * 0.6 + vnoise(p * 0.004) * 0.4;
        alb *= mix(vec3(1.0), vec3(0.78, 0.55, 0.5), smoothstep(0.45, 0.75, big) * 0.7);
        alb *= mix(vec3(1.0), vec3(1.12, 1.1, 1.05), smoothstep(6.0, 22.0, h0) * 0.6);
        alb *= 0.9 + 0.2 * vnoise(p * 0.03);

        // Light: sun + sky from the normal's direction + a warm bounce.
        float sun = max(dot(n, SUN_DIR), 0.0);
        alb *= 0.72;
        vec3 col = alb * (vec3(1.0, 0.9, 0.78) * 2.4 * sun + skyColor(n) * 0.36 + vec3(0.5, 0.22, 0.1) * 0.2);

        // The craft's shadow, cast along the sun; its cyan hover glow below; thrust glow behind.
        vec2 side = vec2(uFwd.y, -uFwd.x);
        vec2 ds = p - uShadow;
        float ell = pow(dot(ds, uFwd) / 5.2, 2.0) + pow(dot(ds, side) / 2.9, 2.0);
        col *= 1.0 - 0.6 * (1.0 - smoothstep(0.55, 1.25, ell));
        vec2 dc = p - uCraft.xz;
        float hov = exp(-dot(dc, dc) / 22.0);
        col += vec3(0.1, 0.5, 1.0) * hov * 0.5;
        float ba = dot(dc, uFwd);
        float behind = exp(-pow(dot(dc, side) / 3.5, 2.0)) * (1.0 - smoothstep(-4.0, 0.0, ba)) * exp(ba / 26.0);
        col += vec3(1.4, 0.55, 0.18) * behind * (0.1 + 0.6 * uBoost);

        // The walker's shadow (a vast soft blot).
        if (uWalker.w > 0.0) {
          vec2 dw = p - uWalker.xy;
          col *= 1.0 - 0.45 * uWalker.w * exp(-dot(dw, dw) / (uWalker.z * uWalker.z));
        }
        gl_FragColor = vec4(applyFog(col, vW), 1.0);
      }`,
  })
}

// ───────────────────────────── pebbles (shader-wrapped) ─────────────────────────────

function pebbles(count: number, tile: number): THREE.InstancedMesh {
  const geo = new THREE.IcosahedronGeometry(1, 0)
  const p = geo.attributes.position as THREE.BufferAttribute
  const r = rng(77)
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.8 + r() * 0.5), p.getY(i) * (0.55 + r() * 0.3), p.getZ(i) * (0.8 + r() * 0.5))
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTile: { value: tile } },
    vertexShader: /* glsl */ `
      ${WORLD_GLSL}
      uniform float uTile;
      varying vec3 vW;
      varying float vTint;
      void main() {
        vec3 o = instanceMatrix[3].xyz;
        o.xz += uTile * floor((cameraPosition.xz - o.xz) / uTile + 0.5);
        mat3 m = mat3(instanceMatrix);
        float s = length(m[0]);
        o.y = groundH(o.xz) - 0.2 * s;
        vec3 w = o + m * position;
        vW = w;
        vTint = hash12(instanceMatrix[3].xz);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${WORLD_GLSL}
      varying vec3 vW;
      varying float vTint;
      void main() {
        vec3 cr = cross(dFdx(vW), dFdy(vW));
        vec3 n = dot(cr, cr) > 1e-12 ? normalize(cr) : vec3(0.0, 1.0, 0.0);
        if (n.y < 0.0) n = -n;
        vec3 alb = mix(vec3(0.3, 0.07, 0.03), vec3(0.55, 0.28, 0.14), vTint);
        float sun = max(dot(n, SUN_DIR), 0.0);
        vec3 col = alb * (vec3(1.0, 0.9, 0.76) * 3.0 * sun + skyColor(n) * 0.35);
        gl_FragColor = vec4(applyFog(col, vW), 1.0);
      }`,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const v = new THREE.Vector3()
  const s = new THREE.Vector3()
  for (let i = 0; i < count; i++) {
    v.set(r() * tile, 0, r() * tile)
    const k = 0.2 + Math.pow(r(), 3) * 0.8
    s.set(k, k, k)
    q.setFromEuler(e.set(r() * 0.5, r() * 6.28, r() * 0.5))
    mesh.setMatrixAt(i, m.compose(v, q, s))
  }
  mesh.frustumCulled = false
  return mesh
}

// ───────────────────────────── mesas + boulders (CPU-wrapped) ─────────────────────────────

type Kind = 'mesa' | 'butte' | 'spire'

function mesaGeometry(kind: Kind, seed: number): { geo: THREE.BufferGeometry; baseR: number } {
  const r = rng(seed)
  const radial = kind === 'spire' ? 16 : 26
  const g = new THREE.CylinderGeometry(1, 1, 1.08, radial, kind === 'spire' ? 12 : 16, false)
  g.translate(0, 0.46, 0)
  const harm: [number, number][] = []
  for (let i = 2; i <= 8; i++) harm.push([((0.16 / i) * (0.4 + r())) * (kind === 'mesa' ? 1.3 : 1), r() * 6.28])
  const ledge = 0.45 + r() * 0.3
  const f = (th: number, t: number) => {
    let k = 1
    for (let i = 0; i < harm.length; i++) k += harm[i][0] * Math.sin((i + 2) * th + harm[i][1])
    k *= 1 + 0.04 * Math.sin(17 * th + 3 * t)
    const tal = 1 - smooth(0, kind === 'spire' ? 0.2 : 0.34, t)
    k *= 1 + (kind === 'spire' ? 0.7 : 0.55) * tal * tal
    if (kind === 'spire') {
      k *= 1 - 0.38 * smooth(0.1, 0.85, t)
      k *= 1 + 0.45 * smooth(0.86, 0.9, t)
    } else {
      k *= 1 - 0.08 * smooth(ledge - 0.02, ledge + 0.02, t)
      k *= 1 - 0.05 * smooth(0.93, 0.97, t)
    }
    return k
  }
  const p = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const z = p.getZ(i)
    const rr = Math.hypot(x, z)
    if (rr < 1e-4) continue
    const y = Math.max(0, p.getY(i))
    const th = Math.atan2(z, x)
    const k = f(th, y)
    p.setXYZ(i, x * k, p.getY(i), z * k)
  }
  const geo = g.toNonIndexed()
  geo.computeVertexNormals()
  let sum = 0
  for (let i = 0; i < 64; i++) sum += f((i / 64) * 6.283, 0.03)
  return { geo, baseR: sum / 64 }
}

interface Placed {
  ox: number
  oz: number
  r: number
  h: number
  yaw: number
  /** The wrapped world centre this frame. */
  x: number
  z: number
  /** Collision radius at hover height. */
  cr: number
  top: number
}

class Wrapped {
  readonly mesh: THREE.InstancedMesh
  readonly items: Placed[] = []
  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    readonly tile: number,
    readonly sinkFrom: number,
    readonly bury: number,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, mat, 1)
    this.mesh.frustumCulled = false
  }
  finish(): void {
    const old = this.mesh
    ;(this as { mesh: THREE.InstancedMesh }).mesh = new THREE.InstancedMesh(old.geometry, old.material, Math.max(1, this.items.length))
    this.mesh.frustumCulled = false
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.count = this.items.length
  }
  update(cx: number, cz: number): void {
    const a = this.mesh.instanceMatrix.array as Float32Array
    const T = this.tile
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]
      const x = it.ox + T * Math.floor((cx - it.ox) / T + 0.5)
      const z = it.oz + T * Math.floor((cz - it.oz) / T + 0.5)
      it.x = x
      it.z = z
      const cheb = Math.max(Math.abs(x - cx), Math.abs(z - cz))
      const grow = 1 - smooth(this.sinkFrom, T / 2, cheb)
      // (Fully sunk: not drawn at all — a flattened disc pokes through the coarse far terrain.)
      const sy = grow < 0.03 ? 0 : it.h * grow
      const sr = grow < 0.03 ? 0 : it.r
      const c = Math.cos(it.yaw)
      const s = Math.sin(it.yaw)
      const k = i * 16
      a[k] = c * sr; a[k + 1] = 0; a[k + 2] = -s * sr; a[k + 3] = 0
      a[k + 4] = 0; a[k + 5] = sy; a[k + 6] = 0; a[k + 7] = 0
      a[k + 8] = s * sr; a[k + 9] = 0; a[k + 10] = c * sr; a[k + 11] = 0
      a[k + 12] = x; a[k + 13] = groundH(x, z) - this.bury * it.h - 3; a[k + 14] = z; a[k + 15] = 1
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }
}

export interface Obstacle {
  x: number
  z: number
  cr: number
  top: number
  big: boolean
}

export class World {
  readonly group = new THREE.Group()
  readonly sky: THREE.Mesh
  readonly ground: GroundUniforms = {
    uCraft: { value: new THREE.Vector3() },
    uShadow: { value: new THREE.Vector2() },
    uFwd: { value: new THREE.Vector2(0, 1) },
    uBoost: { value: 0 },
    uSpeed: { value: 0 },
    uWalker: { value: new THREE.Vector4(0, 0, 60, 0) },
    uTime: { value: 0 },
    tSand: { value: null },
    tClay: { value: null },
    tGravel: { value: null },
  }
  private readonly rings: { mesh: THREE.Mesh; snap: { value: THREE.Vector2 }; step: number }[] = []
  private readonly wrapped: Wrapped[] = []
  readonly sunLight: THREE.DirectionalLight
  envTexture: THREE.Texture | null = null

  constructor() {
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMaterial(false))
    this.sky.renderOrder = -10
    this.sky.frustumCulled = false
    this.group.add(this.sky)

    // Terrain rings: 12.5 m near, 60 m mid, 400 m to the horizon.
    const specs: [number, number, number, number][] = [
      [12.5, 256, 0, 0],
      [60, 400, 1500, 1.2],
      [400, 120, 11600, 6],
    ]
    for (const [step, cells, hole, drop] of specs) {
      const snap = { value: new THREE.Vector2() }
      const mesh = new THREE.Mesh(ringGeometry(step, cells, hole), terrainMaterial(this.ground, snap, drop))
      mesh.frustumCulled = false
      this.rings.push({ mesh, snap, step: step * 2 })
      this.group.add(mesh)
    }

    this.group.add(pebbles(1800, 1500))

    // Mesas, buttes, spires, and the boulders between them.
    const mesaMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, flatShading: true })
    patchStandard(mesaMat, { strata: true })
    const r = rng(1234)
    const kinds: [Kind, number, number][] = [
      ['mesa', 210, 900],
      ['butte', 80, 600],
      ['spire', 60, 300],
    ]
    const all: Placed[] = []
    for (const [kind, count, spacing] of kinds) {
      const { geo, baseR } = mesaGeometry(kind, kind.length * 31 + 7)
      const w = new Wrapped(geo, mesaMat, REBASE, REBASE / 2 - 2200, 0.06)
      let tries = 0
      while (w.items.length < count && tries++ < count * 60) {
        const ox = r() * REBASE
        const oz = r() * REBASE
        // A clear run straight out of the start (the first seconds are for speed, not dodging).
        const sx = ((ox + REBASE / 2) % REBASE) - REBASE / 2
        const sz = ((oz + REBASE / 2) % REBASE) - REBASE / 2
        if (Math.abs(sx) < 1600 && sz > -1500 && sz < 9000) continue
        let rad: number, h: number
        if (kind === 'mesa') { rad = 160 + r() * 520; h = 110 + r() * 260 }
        else if (kind === 'butte') { rad = 90 + r() * 160; h = 160 + r() * 140 }
        else { rad = 35 + r() * 50; h = 140 + r() * 170 }
        let ok = true
        for (const o of all) {
          let dx = Math.abs(o.ox - ox); dx = Math.min(dx, REBASE - dx)
          let dz = Math.abs(o.oz - oz); dz = Math.min(dz, REBASE - dz)
          if (Math.hypot(dx, dz) < spacing + (o.r + rad) * 1.2) { ok = false; break }
        }
        if (!ok) continue
        const it: Placed = { ox, oz, r: rad, h, yaw: r() * 6.28, x: 0, z: 0, cr: rad * baseR * 0.93, top: h * 0.95 }
        w.items.push(it)
        all.push(it)
      }
      w.finish()
      this.wrapped.push(w)
      this.group.add(w.mesh)
    }

    // Boulders: knee-to-roof high, never in a riverbed (the beds are the clean lines).
    const bGeo = new THREE.IcosahedronGeometry(1, 1)
    {
      const p = bGeo.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < p.count; i++) {
        const k = 1 + 0.25 * Math.sin(p.getX(i) * 5 + p.getZ(i) * 3)
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * 0.75 * k, p.getZ(i) * k)
      }
    }
    const bg = bGeo.toNonIndexed()
    bg.computeVertexNormals()
    const bMat = new THREE.MeshStandardMaterial({ color: 0x8a3a1c, roughness: 0.95, flatShading: true })
    patchStandard(bMat, { strata: true })
    const bw = new Wrapped(bg, bMat, 6000, 2400, 0.12)
    let bt = 0
    while (bw.items.length < 95 && bt++ < 4000) {
      const ox = r() * 6000
      const oz = r() * 6000
      if (riverAt(ox, oz) > 0.01) continue
      const sx = ((ox + 3000) % 6000) - 3000
      if (Math.abs(sx) < 120) continue
      const rad = 3 + Math.pow(r(), 2) * 9
      bw.items.push({ ox, oz, r: rad, h: rad, yaw: r() * 6.28, x: 0, z: 0, cr: rad * 0.85, top: rad * 0.65 })
    }
    bw.finish()
    this.wrapped.push(bw)
    this.group.add(bw.mesh)

    this.sunLight = new THREE.DirectionalLight(0xfff0dc, 3.0)
    this.sunLight.position.set(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2])
    this.group.add(this.sunLight)
    this.group.add(this.sunLight.target)
  }

  applyTextures(t: { sand: THREE.Texture; clay: THREE.Texture; gravel: THREE.Texture }): void {
    this.ground.tSand.value = t.sand
    this.ground.tClay.value = t.clay
    this.ground.tGravel.value = t.gravel
  }

  /** Sky-and-sand environment for the craft's reflections. */
  makeEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
    const pm = new THREE.PMREMGenerator(renderer)
    const s = new THREE.Scene()
    s.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), skyMaterial(true)))
    const rt = pm.fromScene(s, 0.02, 0.1, 1000)
    pm.dispose()
    this.envTexture = rt.texture
    return rt.texture
  }

  update(cam: THREE.Vector3, time: number): void {
    this.sky.position.copy(cam)
    for (const r of this.rings) r.snap.value.set(Math.round(cam.x / r.step) * r.step, Math.round(cam.z / r.step) * r.step)
    for (const w of this.wrapped) w.update(cam.x, cam.z)
    this.ground.uTime.value = time
  }

  /** Every obstacle within `range` of (x, z), into `out` (reused; no allocation). */
  near(x: number, z: number, range: number, out: Obstacle[]): number {
    let n = 0
    for (let wi = 0; wi < this.wrapped.length; wi++) {
      const w = this.wrapped[wi]
      const big = w.tile === REBASE
      for (const it of w.items) {
        const dx = it.x - x
        const dz = it.z - z
        const rr = range + it.cr
        if (dx * dx + dz * dz > rr * rr) continue
        let o = out[n]
        if (!o) out[n] = o = { x: 0, z: 0, cr: 0, top: 0, big: false }
        o.x = it.x; o.z = it.z; o.cr = it.cr; o.top = it.top; o.big = big
        n++
      }
    }
    return n
  }
}
