// The desert: sky dome (with fbm cumulus), two rings of far mountains, three terrain rings (fine near,
// coarse far, each snapped to its own grid so nothing swims), shader-wrapped pebbles, CPU-wrapped
// boulders and mesas (both collide, against their true lumpy profile), the env map.
import * as THREE from 'three'
import { REBASE } from './config'
import { groundH, MOUND_U, SUN_DIR } from './terrain'
import { patchStandard, WORLD_GLSL } from './shaders'

export function rng(seed: number): () => number {
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
    uniforms: { uTime: { value: 0 }, uCloudOff: { value: new THREE.Vector2() }, ...MOUND_U },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      ${WORLD_GLSL}
      uniform float uTime;
      uniform vec2 uCloudOff;
      varying vec3 vDir;
      float fbm(vec2 p) {
        float a = 0.5, s = 0.0;
        for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
        return s;
      }
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        float s = max(dot(d, SUN_DIR), 0.0);
        ${ground ? 'c = mix(c, vec3(0.62, 0.3, 0.13), 1.0 - smoothstep(-0.08, 0.0, d.y));' : ''}
        // Fair-weather cumulus on a plane 2.6 km up: fbm coverage, lit tops, grey-blue bases,
        // thinned toward the horizon where they would alias.
        if (d.y > 0.015) {
          vec2 cp = d.xz / d.y * 2600.0 + uCloudOff;
          float base = fbm(cp * 0.00032);
          float cov = smoothstep(0.52, 0.78, base);
          float detail = fbm(cp * 0.0016 + 3.0);
          cov *= smoothstep(0.25, 0.55, detail + cov * 0.4);
          float lit = clamp(fbm(cp * 0.00032 + SUN_DIR.xz * 0.06) - base + 0.55, 0.0, 1.0);
          vec3 cc = mix(vec3(0.62, 0.68, 0.8), vec3(1.9, 1.8, 1.65), lit);
          cc += vec3(1.0, 0.8, 0.55) * pow(s, 6.0) * 0.6;
          float fade = smoothstep(0.015, 0.16, d.y);
          c = mix(c, cc, cov * fade * 0.92);
        }
        // The sun: a hot disk (past bloom's threshold) and a wide glare.
        c += vec3(1.0, 0.9, 0.75) * (smoothstep(0.99955, 0.9998, s) * 40.0 + pow(s, 900.0) * 4.0 + pow(s, 30.0) * 0.4 + pow(s, 4.0) * 0.1);
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
}

/** A ring of far mountains around the camera: a silhouette band in the haze, two layers deep. */
function mountains(): THREE.Mesh {
  const seg = 720
  const layers = [
    { r: 21000, base: 0.7, amp: 1.0, seed: 1.7, tint: 0 },
    { r: 28000, base: 1.0, amp: 1.6, seed: 4.2, tint: 1 },
  ]
  const pos: number[] = []
  const tint: number[] = []
  const idx: number[] = []
  const n1 = (x: number, s: number) => Math.sin(x * 3 + s) * 0.5 + Math.sin(x * 7.3 + s * 2) * 0.25 + Math.sin(x * 17.1 + s * 3) * 0.14 + Math.sin(x * 41 + s) * 0.06
  for (const L of layers) {
    const start = pos.length / 3
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2
      const ridge = Math.max(0, L.base * 0.35 + n1(a, L.seed) * 0.6 + Math.abs(n1(a * 2.1, L.seed + 9)) * 0.5)
      const h = 120 + ridge * 950 * L.amp
      const x = Math.cos(a) * L.r, z = Math.sin(a) * L.r
      pos.push(x, -400, z, x, h, z)
      tint.push(L.tint, 0, L.tint, 1)
    }
    for (let i = 0; i < seg; i++) {
      const a = start + i * 2
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aT', new THREE.Float32BufferAttribute(tint, 2))
  g.setIndex(idx)
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    depthWrite: false,
    uniforms: { ...MOUND_U },
    vertexShader: /* glsl */ `
      attribute vec2 aT;
      varying vec2 vT;
      varying vec3 vDir;
      void main() {
        vT = aT;
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      ${WORLD_GLSL}
      varying vec2 vT;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 sky = skyColor(vec3(d.x, max(d.y, 0.0) * 0.4, d.z));
        // Near range: warm, rusty, more solid; far: blue, nearly sky. Bases fade into the dust.
        vec3 rock = mix(vec3(0.42, 0.2, 0.14), vec3(0.34, 0.42, 0.6), vT.x);
        float sunSide = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(SUN_DIR.x, 0.0, SUN_DIR.z))), 0.0);
        rock *= 0.8 + 0.5 * sunSide;
        float haze = mix(0.32, 0.6, vT.x);
        vec3 c = mix(rock, sky, haze);
        c = mix(sky, c, smoothstep(0.0, 0.5, vT.y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
  const m = new THREE.Mesh(g, mat)
  m.frustumCulled = false
  m.renderOrder = -9
  return m
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
  uShadowK: { value: number }
  uFwd: { value: THREE.Vector2 }
  uBoost: { value: number }
  uSpeed: { value: number }
  uWalker: { value: THREE.Vector4 }
  uTime: { value: number }
  tSand: { value: THREE.Texture | null }
  tClay: { value: THREE.Texture | null }
  tGravel: { value: THREE.Texture | null }
  tTrack: { value: THREE.Texture | null }
  uCloudOff: { value: THREE.Vector2 }
  uCloudShadow: { value: number }
  uTrackBox: { value: THREE.Vector4 }
  uTrackOn: { value: number }
}

function terrainMaterial(shared: GroundUniforms, snap: { value: THREE.Vector2 }, drop: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, ...MOUND_U, uSnap: snap, uDrop: { value: drop } },
    vertexShader: /* glsl */ `
      ${WORLD_GLSL}
      uniform vec2 uSnap;
      uniform float uDrop;
      varying vec3 vW;
      varying vec3 vN;
      varying float vH;
      varying float vRiver;
      void main() {
        vec2 xz = position.xz + uSnap;
        float d = length(xz - cameraPosition.xz);
        float h = groundH(xz);
        // (Normals per vertex, not per pixel: three height samples per pixel, each looping the
        // mounds, were most of the frame on a laptop GPU.)
        float e = 3.0 + d * 0.004;
        vN = normalize(vec3(h - groundH(xz + vec2(e, 0.0)), e, h - groundH(xz + vec2(0.0, e))));
        vH = h;
        vRiver = riverAt(xz);
        vec3 w = vec3(xz.x, h - uDrop * smoothstep(0.0, 400.0, d), xz.y);
        vW = w;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${WORLD_GLSL}
      uniform vec3 uCraft;
      uniform vec2 uShadow;
      uniform float uShadowK;
      uniform vec2 uFwd;
      uniform float uBoost;
      uniform float uSpeed;
      uniform vec4 uWalker;
      uniform float uTime;
      uniform sampler2D tSand;
      uniform sampler2D tClay;
      uniform sampler2D tGravel;
      uniform sampler2D tTrack;
      uniform vec2 uCloudOff;
      uniform float uCloudShadow;
      uniform vec4 uTrackBox;
      uniform float uTrackOn;
      varying vec3 vW;
      varying vec3 vN;
      varying float vH;
      varying float vRiver;
      void main() {
        vec2 p = vW.xz;
        vec3 n = normalize(vN);
        float h0 = vH;
        float river = vRiver;

        // (At Mach speeds fine texture detail sweeps past faster than the frame rate and strobes —
        // the "flashing". The mip level is pushed up with speed: the ground blurs like the motion does.)
        float bias = uSpeed * 1.1;
        mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
        vec3 s1 = texture2D(tSand, p / 26.0, bias).rgb;
        // Up close, bump the light from the sand texture itself (ripples and grains catch the sun).
        float nearB = 1.0 - smoothstep(60.0, 260.0, length(vW - cameraPosition));
        if (nearB > 0.0) {
          float l0 = dot(s1, vec3(0.33));
          float lx = dot(texture2D(tSand, (p + vec2(0.35, 0.0)) / 26.0, bias).rgb, vec3(0.33));
          float lz = dot(texture2D(tSand, (p + vec2(0.0, 0.35)) / 26.0, bias).rgb, vec3(0.33));
          n = normalize(n + vec3(l0 - lx, 0.0, l0 - lz) * 0.8 * nearB * (1.0 - uSpeed * 0.7));
        }
        vec3 s2 = texture2D(tSand, rot * p / 170.0 + 0.37, bias * 0.5).rgb;
        vec3 sandT = mix(s1, s2, 0.45);
        float gm = smoothstep(0.58, 0.72, vnoise(p * 0.0045 + 11.0) * 0.7 + vnoise(p * 0.03) * 0.3);
        vec3 grav = texture2D(tGravel, rot * p / 9.0, bias).rgb;
        vec3 clayT = texture2D(tClay, p / 13.0, bias).rgb;
        vec3 alb = mix(sandT, grav, gm * 0.85);
        alb = mix(alb, clayT * vec3(1.0, 0.92, 0.85), river);
        float big = vnoise(p * 0.0011) * 0.6 + vnoise(p * 0.004) * 0.4;
        alb *= mix(vec3(1.0), vec3(0.78, 0.55, 0.5), smoothstep(0.45, 0.75, big) * 0.7);
        alb *= mix(vec3(1.0), vec3(1.12, 1.1, 1.05), smoothstep(3.0, 12.0, h0) * 0.6);
        alb *= 0.9 + 0.2 * vnoise(p * 0.03);

        // The racing line, worn: packed and darker, the ripples gone, scorched lanes down it.
        vec2 tuv = (p - uTrackBox.xy) / uTrackBox.zw;
        if (uTrackOn > 0.5 && tuv.x > 0.0 && tuv.y > 0.0 && tuv.x < 1.0 && tuv.y < 1.0) {
          vec2 wr = texture2D(tTrack, tuv).rg;
          float pack = smoothstep(0.05, 0.8, wr.r);
          alb = mix(alb, mix(s2, vec3(dot(s2, vec3(0.33))), 0.25) * vec3(0.86, 0.74, 0.68), pack * 0.7);
          float streak = wr.g * (0.75 + 0.25 * vnoise(p * 0.05));
          alb *= 1.0 - 0.55 * smoothstep(0.05, 0.6, streak);
          alb = mix(alb, vec3(0.16, 0.08, 0.05), smoothstep(0.45, 0.9, streak) * 0.35);
        }
        alb *= 0.72;
        float sun = max(dot(n, SUN_DIR), 0.0);
        // Cloud shadows: the same coverage the sky draws, projected down along the sun, drifting.
        if (uCloudShadow > 0.5) {
          vec2 cp = p + SUN_DIR.xz / SUN_DIR.y * 2600.0 + uCloudOff;
          vec2 q = cp * 0.00032;
          float a = 0.5, b = 0.0;
          for (int i = 0; i < 5; i++) { b += a * vnoise(q); q = q * 2.03 + 17.1; a *= 0.5; }
          sun *= 1.0 - 0.6 * smoothstep(0.52, 0.78, b);
        }
        vec3 col = alb * (vec3(1.0, 0.9, 0.78) * 2.4 * sun + skyColor(n) * 0.36 + vec3(0.5, 0.22, 0.1) * 0.2);

        // The craft's shadow, cast along the sun (fainter and wider the higher it flies).
        vec2 side = vec2(uFwd.y, -uFwd.x);
        vec2 ds = p - uShadow;
        // A delta-shaped soft shadow (nose +5.6 m, tail −4.2 m, 3.1 m half-span at the tail),
        // blurring and fading as the craft climbs.
        float spread = 1.0 + uShadowK * 0.05;
        float sa = dot(ds, uFwd) / spread, ss = abs(dot(ds, side)) / spread;
        float halfw = 3.1 * clamp((5.6 - sa) / 9.8, 0.0, 1.0);
        float soft = 0.9 + uShadowK * 0.08;
        float inside = (1.0 - smoothstep(halfw - soft, halfw + soft, ss)) * smoothstep(-4.2 - soft, -4.2 + soft, sa) * (1.0 - smoothstep(5.6 - soft, 5.6 + soft, sa));
        col *= 1.0 - (0.3 / (spread * spread)) * inside;
        vec2 dc = p - uCraft.xz;
        float near = exp(-uShadowK * 0.25);
        float hov = exp(-dot(dc, dc) / 22.0) * near;
        col += vec3(0.1, 0.5, 1.0) * hov * 0.5;
        float ba = dot(dc, uFwd);
        float sd = dot(dc, side) / 3.5;
        // (x·x, never pow(x, 2.0): pow of a negative is NaN in GLSL — black pixels around the craft.)
        float behind = exp(-sd * sd) * (1.0 - smoothstep(-4.0, 0.0, ba)) * exp(ba / 26.0) * near;
        col += vec3(1.4, 0.55, 0.18) * behind * (0.1 + 0.6 * uBoost);

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
    uniforms: { uTile: { value: tile }, ...MOUND_U },
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
        // Shrink into the sand with distance: sub-pixel rocks only shimmer.
        float k = 1.0 - smoothstep(220.0, 520.0, length(o.xz - cameraPosition.xz));
        o.y = groundH(o.xz) - 0.2 * s - (1.0 - k) * s;
        vec3 w = o + m * position * max(k, 0.001);
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
        vec3 col = alb * (vec3(1.0, 0.9, 0.76) * 2.4 * sun + skyColor(n) * 0.35);
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
type Profile = (th: number, t: number) => number

function mesaGeometry(kind: Kind, seed: number): { geo: THREE.BufferGeometry; prof: Profile } {
  const r = rng(seed)
  const radial = kind === 'spire' ? 16 : 26
  const g = new THREE.CylinderGeometry(1, 1, 1.08, radial, kind === 'spire' ? 12 : 16, false)
  g.translate(0, 0.46, 0)
  const harm: [number, number][] = []
  for (let i = 2; i <= 8; i++) harm.push([((0.16 / i) * (0.4 + r())) * (kind === 'mesa' ? 1.3 : 1), r() * 6.28])
  const ledge = 0.45 + r() * 0.3
  const f: Profile = (th, t) => {
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
    if (Math.hypot(x, z) < 1e-4) continue
    const k = f(Math.atan2(z, x), Math.max(0, p.getY(i)))
    p.setXYZ(i, x * k, p.getY(i), z * k)
  }
  const geo = g.toNonIndexed()
  geo.computeVertexNormals()
  return { geo, prof: f }
}

interface Placed {
  ox: number
  oz: number
  r: number
  h: number
  yaw: number
  /** The wrapped world centre this frame, its base height, and how grown (0 sunk … 1). */
  x: number
  z: number
  by: number
  grow: number
  /** Where the veto was last asked, and its answer (boulders off the race line). */
  vx?: number
  vz?: number
  vetoed?: boolean
}

class Wrapped {
  mesh: THREE.InstancedMesh
  readonly items: Placed[] = []
  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    readonly tile: number,
    public sinkFrom: number,
    readonly bury: number,
    readonly prof: Profile,
    readonly big: boolean,
    readonly veto: ((x: number, z: number, r: number) => boolean) | null = null,
    /** Fully sunk (and not drawn) past this distance. */
    public sinkTo = tile / 2,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, mat, 1)
  }
  finish(): void {
    const old = this.mesh
    this.mesh = new THREE.InstancedMesh(old.geometry, old.material, Math.max(1, this.items.length))
    this.mesh.frustumCulled = false
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.count = this.items.length
  }
  update(cx: number, cz: number): void {
    const a = this.mesh.instanceMatrix.array as Float32Array
    const T = this.tile
    // Only the ones near enough to see are written (compacted): the rest cost no vertex work at all.
    let k = 0
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]
      const x = it.ox + T * Math.floor((cx - it.ox) / T + 0.5)
      const z = it.oz + T * Math.floor((cz - it.oz) / T + 0.5)
      it.x = x
      it.z = z
      const cheb = Math.max(Math.abs(x - cx), Math.abs(z - cz))
      const grow = 1 - smooth(this.sinkFrom, this.sinkTo, cheb)
      if (this.veto && (it.vx !== x || it.vz !== z)) { it.vx = x; it.vz = z; it.vetoed = this.veto(x, z, it.r) }
      it.grow = it.vetoed ? 0 : grow
      if (it.grow < 0.03) continue
      const sy = it.h * it.grow
      const c = Math.cos(it.yaw)
      const s = Math.sin(it.yaw)
      it.by = groundH(x, z) - this.bury * it.h - 3
      const o = k * 16
      a[o] = c * it.r; a[o + 1] = 0; a[o + 2] = -s * it.r; a[o + 3] = 0
      a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0
      a[o + 8] = s * it.r; a[o + 9] = 0; a[o + 10] = c * it.r; a[o + 11] = 0
      a[o + 12] = x; a[o + 13] = it.by; a[o + 14] = z; a[o + 15] = 1
      k++
    }
    this.mesh.count = k
    this.mesh.instanceMatrix.clearUpdateRanges()
    this.mesh.instanceMatrix.addUpdateRange(0, k * 16)
    this.mesh.instanceMatrix.needsUpdate = true
  }
}

export interface Obstacle {
  x: number
  z: number
  /** True surface radius toward the query point, at the query height. */
  cr: number
  big: boolean
}

export class World {
  readonly group = new THREE.Group()
  readonly sky: THREE.Mesh
  readonly hills: THREE.Mesh
  readonly ground: GroundUniforms = {
    uCraft: { value: new THREE.Vector3() },
    uShadow: { value: new THREE.Vector2() },
    uShadowK: { value: 0 },
    uFwd: { value: new THREE.Vector2(0, 1) },
    uBoost: { value: 0 },
    uSpeed: { value: 0 },
    uWalker: { value: new THREE.Vector4(0, 0, 60, 0) },
    uTime: { value: 0 },
    tSand: { value: null },
    tClay: { value: null },
    tGravel: { value: null },
    tTrack: { value: null },
    uCloudOff: { value: new THREE.Vector2() },
    uCloudShadow: { value: 1 },
    uTrackBox: { value: new THREE.Vector4(0, 0, 1, 1) },
    uTrackOn: { value: 0 },
  }
  private readonly rings: { mesh: THREE.Mesh; snap: { value: THREE.Vector2 }; step: number }[] = []
  private readonly wrapped: Wrapped[] = []
  /** Fixed rocks (the course's spires): not wrapped, always there. */
  private readonly fixed: { x: number; z: number; r: number; h: number; yaw: number; by: number }[] = []
  private fixedProf: Profile = () => 1
  private spireGeo: THREE.BufferGeometry | null = null
  private mesaMat: THREE.Material | null = null
  readonly sunLight: THREE.DirectionalLight
  envTexture: THREE.Texture | null = null

  /**
   * clear(x, z, r): false where a mesa of radius r must not stand (the race course corridor).
   * keepOff(x, z, r): true where a boulder must not be (the racing line itself).
   */
  constructor(clear: (x: number, z: number, r: number) => boolean = () => true, keepOff: ((x: number, z: number, r: number) => boolean) | null = null) {
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMaterial(false))
    this.sky.renderOrder = -10
    this.sky.frustumCulled = false
    this.group.add(this.sky)
    this.hills = mountains()
    this.group.add(this.hills)

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

    const mesaMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, flatShading: true })
    patchStandard(mesaMat, { strata: true })
    const r = rng(1234)
    const kinds: [Kind, number, number][] = [
      // (×4: the world now wraps every 72 km, so the 130 km sprint overlaps itself less.)
      ['mesa', 680, 1300],
      ['butte', 240, 900],
      ['spire', 200, 600],
    ]
    const all: Placed[] = []
    this.mesaMat = mesaMat
    for (const [kind, count, spacing] of kinds) {
      const { geo, prof } = mesaGeometry(kind, kind.length * 31 + 7)
      if (kind === 'spire') { this.spireGeo = geo; this.fixedProf = prof }
      const w = new Wrapped(geo, mesaMat, REBASE, 16500, 0.06, prof, true, null, 20000)
      let tries = 0
      while (w.items.length < count && tries++ < count * 80) {
        const ox = r() * REBASE
        const oz = r() * REBASE
        const sx = ((ox + REBASE / 2) % REBASE) - REBASE / 2
        const sz = ((oz + REBASE / 2) % REBASE) - REBASE / 2
        let rad: number, h: number
        if (kind === 'mesa') { rad = 160 + r() * 520; h = 110 + r() * 260 }
        else if (kind === 'butte') { rad = 90 + r() * 160; h = 160 + r() * 140 }
        else { rad = 35 + r() * 50; h = 140 + r() * 170 }
        if (!clear(sx, sz, rad * 1.6)) continue
        let ok = true
        for (const o of all) {
          let dx = Math.abs(o.ox - ox); dx = Math.min(dx, REBASE - dx)
          let dz = Math.abs(o.oz - oz); dz = Math.min(dz, REBASE - dz)
          if (Math.hypot(dx, dz) < spacing + (o.r + rad) * 1.2) { ok = false; break }
        }
        if (!ok) continue
        const it: Placed = { ox, oz, r: rad, h, yaw: r() * 6.28, x: 0, z: 0, by: 0, grow: 1 }
        w.items.push(it)
        all.push(it)
      }
      w.finish()
      this.wrapped.push(w)
      this.group.add(w.mesh)
    }

    // Boulders: knee-to-roof high.
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
    const bw = new Wrapped(bg, bMat, 6000, 2400, 0.12, () => 0.92, false, keepOff, 3000)
    let bt = 0
    while (bw.items.length < 80 && bt++ < 4000) {
      const ox = r() * 6000
      const oz = r() * 6000
      const rad = 3 + Math.pow(r(), 2) * 9
      bw.items.push({ ox, oz, r: rad, h: rad, yaw: r() * 6.28, x: 0, z: 0, by: 0, grow: 1 })
    }
    bw.finish()
    this.wrapped.push(bw)
    this.group.add(bw.mesh)

    this.sunLight = new THREE.DirectionalLight(0xfff0dc, 3.0)
    this.sunLight.position.set(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2])
    this.group.add(this.sunLight)
    this.group.add(this.sunLight.target)
  }

  /** Rocks that stand where they are put (the course's spires). */
  addFixed(list: { x: number; z: number; r: number; h: number }[]): void {
    const mesh = new THREE.InstancedMesh(this.spireGeo!, this.mesaMat!, Math.max(1, list.length))
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3()
    list.forEach((o, i) => {
      const yaw = (i * 2.399) % 6.283
      const by = groundH(o.x, o.z) - 0.06 * o.h - 3
      this.fixed.push({ ...o, yaw, by })
      mesh.setMatrixAt(i, m.compose(v.set(o.x, by, o.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), sc.set(o.r, o.h, o.r)))
    })
    mesh.count = list.length
    mesh.frustumCulled = false
    this.group.add(mesh)
  }

  /** How far the mesas are drawn (m): they rise from the haze between 82% and 100% of it. */
  setDrawDistance(d: number): void {
    for (const w of this.wrapped) if (w.big) { w.sinkTo = d; w.sinkFrom = d * 0.82 }
  }

  applyTextures(t: { sand: THREE.Texture; clay: THREE.Texture; gravel: THREE.Texture }): void {
    this.ground.tSand.value = t.sand
    this.ground.tClay.value = t.clay
    this.ground.tGravel.value = t.gravel
  }

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
    this.hills.position.set(cam.x, 0, cam.z)
    const sm = this.sky.material as THREE.ShaderMaterial
    sm.uniforms.uTime.value = time
    sm.uniforms.uCloudOff.value.set(time * 14, time * 5)
    for (const r of this.rings) r.snap.value.set(Math.round(cam.x / r.step) * r.step, Math.round(cam.z / r.step) * r.step)
    for (const w of this.wrapped) w.update(cam.x, cam.z)
    this.ground.uTime.value = time
  }

  /**
   * Every obstacle within `range` of (x, z), into `out` (reused). Each one's radius is its true
   * surface toward (x, z) at height y — the lumpy profile, not a cylinder, so no clipping into rock
   * and no bouncing off air.
   */
  near(x: number, z: number, y: number, range: number, out: Obstacle[]): number {
    let n = 0
    for (let wi = 0; wi < this.wrapped.length; wi++) {
      const w = this.wrapped[wi]
      for (const it of w.items) {
        if (it.grow < 0.5) continue
        const dx = x - it.x
        const dz = z - it.z
        const reach = range + it.r * 2.3
        if (dx * dx + dz * dz > reach * reach) continue
        const hh = it.h * it.grow
        const t = (y - it.by) / hh
        if (t > (w.big ? 0.98 : 0.8)) continue
        // Into the instance's own frame (rotation about Y by yaw).
        const c = Math.cos(it.yaw), s = Math.sin(it.yaw)
        const lx = dx * c - dz * s
        const lz = dx * s + dz * c
        const cr = it.r * w.prof(Math.atan2(lz, lx), Math.max(0, t)) * 0.97
        let o = out[n]
        if (!o) out[n] = o = { x: 0, z: 0, cr: 0, big: false }
        o.x = it.x; o.z = it.z; o.cr = cr; o.big = w.big
        n++
      }
    }
    for (const it of this.fixed) {
      const dx = x - it.x, dz = z - it.z
      const reach = range + it.r * 2.3
      if (dx * dx + dz * dz > reach * reach) continue
      const t = (y - it.by) / it.h
      if (t > 0.98) continue
      const c = Math.cos(it.yaw), s = Math.sin(it.yaw)
      const cr = it.r * this.fixedProf(Math.atan2(dx * s + dz * c, dx * c - dz * s), Math.max(0, t)) * 0.97
      let o = out[n]
      if (!o) out[n] = o = { x: 0, z: 0, cr: 0, big: false }
      o.x = it.x; o.z = it.z; o.cr = cr; o.big = true
      n++
    }
    return n
  }
}
