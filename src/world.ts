// The desert: sky dome (with fbm cumulus), two rings of far mountains, three terrain rings (fine near,
// coarse far, each snapped to its own grid so nothing swims), shader-wrapped pebbles, CPU-wrapped
// boulders and mesas (both collide, against their true lumpy profile), the env map.
import * as THREE from 'three'
import { REBASE } from './config'
import { BIOME, groundH, LIGHT, MOUND_U, SUN_DIR } from './terrain'
import { ICE_VARIANTS, iceGeometry } from './ice'
import { LAVA_VARIANTS, lavaGeometry } from './lava'
import { FOREST_VARIANTS, forestGeometry } from './forest'

/** The world's own landform shapes (ice or basalt) — the desert's mesas come from mesaGeometry. */
const landGeometry = (kind: 'mesa' | 'butte' | 'spire', seed: number, v: number) => BIOME === 'lava' ? lavaGeometry(kind, seed, v) : BIOME === 'forest' ? forestGeometry(kind, seed, v) : iceGeometry(kind, seed, v)
import { FBMT_GLSL, NOISE_TEX, patchStandard, WORLD_GLSL } from './shaders'
import { SHADOW_GLSL, SHADOW_U } from './shadow'

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

/** The aurora's clock (shared: the sky, and the ice that reflects it). */
export const AUR_T = { value: 0 }

function skyMaterial(ground: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uAurT: AUR_T, uCloudOff: { value: new THREE.Vector2() }, tNoise: { value: NOISE_TEX }, ...MOUND_U },
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
      ${FBMT_GLSL}
      // (Baked: three of these per pixel were 48 hashes — the costliest thing in the frame.)
      float fbm(vec2 p) { return fbmT(p); }
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        float s = max(dot(d, SUN_DIR), 0.0);
        ${ground ? `c = mix(c, ${BIOME === 'lava' ? 'vec3(0.06, 0.04, 0.035)' : BIOME === 'ice' ? 'vec3(0.6, 0.66, 0.8)' : BIOME === 'forest' ? 'vec3(0.2, 0.3, 0.12)' : 'vec3(0.62, 0.3, 0.13)'}, 1.0 - smoothstep(-0.08, 0.0, d.y));` : ''}
        // Fair-weather cumulus on a plane 2.6 km up: fbm coverage, lit tops, grey-blue bases,
        // thinned toward the horizon where they would alias.
        if (d.y > 0.015) {
          vec2 cp = d.xz / d.y * 2600.0 + uCloudOff;
          float base = fbm(cp * 0.00032);
          float cov = smoothstep(0.52, 0.78, base);
          #ifdef BIOME_ICE
          cov *= 0.08; // (a clear twilight: barely any cloud, so the aurora and stars show)
          #endif
          #ifdef BIOME_LAVA
          cov = min(1.0, cov * 1.4 + 0.1); // (an ash sky)
          #endif
          float detail = fbm(cp * 0.0016 + 3.0);
          cov *= smoothstep(0.25, 0.55, detail + cov * 0.4);
          float lit = clamp(fbm(cp * 0.00032 + SUN_DIR.xz * 0.06) - base + 0.55, 0.0, 1.0);
          vec3 cc = mix(vec3(0.62, 0.68, 0.8) * mix(vec3(1.0), SUN_TINT, 0.5), vec3(1.9, 1.8, 1.65) * SUN_TINT, lit);
          cc += vec3(1.0, 0.8, 0.55) * pow(s, 6.0) * 0.6;
          // Depth: thick cores darker and cooler underneath; thin edges facing the sun silver.
          cc *= mix(1.0, 0.72, smoothstep(0.55, 0.95, cov) * (1.0 - lit));
          cc += vec3(1.2, 1.1, 0.95) * SUN_TINT * cov * (1.0 - cov) * 3.0 * pow(s, 5.0) * 0.8;
          // Far clouds take the colour of the air in front of them (they recede into the horizon).
          cc = mix(cc, skyColor(vec3(d.x, 0.03, d.z)) * 1.08, (1.0 - smoothstep(0.02, 0.22, d.y)) * 0.65);
          #ifdef BIOME_LAVA
          // Ash clouds: dark, lit from below by the lava's glow toward the horizon.
          cc = mix(vec3(0.05, 0.04, 0.045), vec3(0.5, 0.15, 0.05), (1.0 - smoothstep(0.02, 0.35, d.y)) * (0.4 + 0.6 * lit));
          #endif
          float fade = smoothstep(0.015, 0.16, d.y);
          // High cirrus, 9 km up: thin streaks drawn out along the wind, behind the cumulus.
          vec2 hp = d.xz / d.y * 9000.0 + uCloudOff * 1.7;
          float ci = fbmT(hp * vec2(0.00006, 0.00028) + 7.3) * 0.7 + fbmT(hp * 0.0011 + 2.1) * 0.3;
          float cir = smoothstep(0.5, 0.78, ci) * smoothstep(0.03, 0.25, d.y) * (1.0 - cov);
          #ifdef BIOME_ICE
          cir *= 0.15;
          #endif
          c = mix(c, vec3(1.45, 1.42, 1.38) * SUN_TINT + vec3(1.0, 0.8, 0.55) * pow(s, 8.0) * 0.5, cir * 0.42);
          c = mix(c, cc, cov * fade * 0.92);
        }
        // A bank of distant cloud along the horizon, above the mountains: tops lit on the sun's side,
        // dissolving into the haze — the farthest thing you see, and the sense of how far that is.
        #ifndef BIOME_ICE
        if (d.y > -0.005 && d.y < 0.09) {
          float az = atan(d.z, d.x);
          float top = 0.025 + 0.03 * fbmT(vec2(az * 3.2, 1.7) + uCloudOff * 0.00002) + 0.018 * fbmT(vec2(az * 11.0, 4.1));
          float inBank = 1.0 - smoothstep(top - 0.012, top, d.y);
          float puff = fbmT(vec2(az * 26.0, d.y * 60.0) + 9.0);
          vec3 bank = mix(skyColor(vec3(d.x, 0.0, d.z)) * 1.12, vec3(1.25, 1.2, 1.12) * SUN_TINT, 0.35 + 0.4 * puff);
          bank += vec3(1.0, 0.82, 0.6) * pow(s, 4.0) * 0.5;
          #ifdef BIOME_LAVA
          bank = mix(vec3(0.12, 0.07, 0.06), vec3(0.55, 0.2, 0.08), puff);
          #endif
          c = mix(c, bank, inBank * smoothstep(0.004, 0.02, d.y) * 0.45);
        }
        #endif
        #ifdef BIOME_ICE
        // Polar twilight: stars overhead (twinkling a little), and the aurora.
        {
          vec2 sg = vec2(atan(d.x, d.z) * 240.0, asin(clamp(d.y, -1.0, 1.0)) * 240.0);
          vec2 cell = floor(sg);
          float st = step(0.9965, hash12(cell)) * smoothstep(0.08, 0.35, d.y);
          float tw = 0.65 + 0.35 * sin(uTime * (2.0 + hash12(cell + 3.1) * 4.0) + hash12(cell) * 40.0);
          float sz = 1.0 - smoothstep(0.0, 0.35, length(fract(sg) - 0.5));
          c += vec3(0.85, 0.9, 1.0) * st * tw * sz * 1.6;
          c += aurora(d);
        }
        #endif
        // The sun: a hot disk (past bloom's threshold) and a wide glare.
        #if defined(BIOME_LAVA)
        c += vec3(1.0, 0.4, 0.2) * (smoothstep(0.99955, 0.9998, s) * 6.0 + pow(s, 900.0) * 1.5 + pow(s, 30.0) * 0.15 + pow(s, 4.0) * 0.06);
        #elif defined(BIOME_ICE)
        c += vec3(1.0, 0.75, 0.6) * (smoothstep(0.99955, 0.9998, s) * 12.0 + pow(s, 900.0) * 2.0 + pow(s, 30.0) * 0.15 + pow(s, 4.0) * 0.05);
        #else
        c += vec3(1.0, 0.9, 0.75) * (smoothstep(0.99955, 0.9998, s) * 40.0 + pow(s, 900.0) * 4.0 + (pow(s, 30.0) * 0.4 + pow(s, 4.0) * 0.1) * ${BIOME === 'forest' ? '0.45' : '1.0'});
        #endif
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
}

/** A ring of far mountains around the camera, three ranges deep (15, 23, 33 km). Not flat cut-outs:
 *  each column carries its ridge height and slope, so the faces are lit and shadowed by the sun, cut
 *  by gullies, capped with snow where it is high and cold; and every range sinks into the air — the
 *  farther the paler and bluer, the foot lost in valley haze (aerial perspective). */
function mountains(): THREE.Mesh {
  const seg = 900
  const layers = [
    // (Grand on purpose: at 33 km a 1.9 km peak is 3 degrees of sky — it read as a smudge.)
    { r: 33000, amp: 3.6, seed: 7.9, far: 1.0 },
    { r: 23000, amp: 2.2, seed: 4.2, far: 0.55 },
    { r: 15000, amp: 1.0, seed: 1.7, far: 0.15 },
  ]
  const pos: number[] = [], at: number[] = [], ah: number[] = [], idx: number[] = []
  const n1 = (x: number, s: number) => Math.sin(x * 3 + s) * 0.5 + Math.sin(x * 7.3 + s * 2) * 0.25 + Math.sin(x * 17.1 + s * 3) * 0.14 + Math.sin(x * 41 + s) * 0.07 + Math.sin(x * 97 + s * 5) * 0.03
  // Ridged: sharp crests (1 − |noise|), so peaks are peaks, not hills.
  const ridged = (x: number, s: number) => 1 - Math.abs(Math.sin(x * 5.3 + s) * 0.6 + Math.sin(x * 13.7 + s * 1.7) * 0.3 + Math.sin(x * 29 + s * 2.3) * 0.1)
  const height = (a: number, L: (typeof layers)[number]) => 150 + Math.max(0, 0.25 + n1(a, L.seed) * 0.45 + ridged(a, L.seed + 3) * 0.55 - 0.3) * 1100 * L.amp
  for (const L of layers) {
    const start = pos.length / 3
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2
      const h = height(a, L)
      // Slope along the ring (m per m of arc): which way the face turns.
      const da = (Math.PI * 2) / seg
      const slope = (height(a + da, L) - height(a - da, L)) / (2 * da * L.r)
      const x = Math.cos(a) * L.r, z = Math.sin(a) * L.r
      pos.push(x, -400, z, x, h, z)
      at.push(L.far, 0, L.far, 1)
      ah.push(h, slope, h, slope)
    }
    for (let i = 0; i < seg; i++) {
      const v = start + i * 2
      idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 2))
  g.setAttribute('aH', new THREE.Float32BufferAttribute(ah, 2))
  g.setIndex(idx)
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    depthWrite: false,
    uniforms: { ...MOUND_U },
    vertexShader: /* glsl */ `
      attribute vec2 aT;
      attribute vec2 aH;
      varying vec2 vT;
      varying vec2 vH;
      varying vec3 vDir;
      void main() {
        vT = aT; vH = aH;
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      ${WORLD_GLSL}
      varying vec2 vT;
      varying vec2 vH;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float far = vT.x, v = vT.y;
        float hTop = vH.x, slope = vH.y;
        float h = mix(-400.0, hTop, v);                  // height of this point on the face (m)
        float az = atan(d.z, d.x);
        // The face's normal, faked: toward the camera, turned along the ring by the slope, leaning up
        // near the crest; and gullies (vertical noise) breaking it up.
        vec3 radial = normalize(vec3(d.x, 0.0, d.z)), along = vec3(-radial.z, 0.0, radial.x);
        float gully = vnoise(vec2(az * 520.0, h * 0.004)) * 0.6 + vnoise(vec2(az * 1500.0, h * 0.012)) * 0.4;
        vec3 n = normalize(-radial + along * (-slope * 2.2 + (gully - 0.5) * 0.9) + vec3(0.0, 0.25 + 0.9 * smoothstep(0.55, 1.0, v), 0.0));
        float sun = clamp(dot(n, SUN_DIR) * 0.8 + 0.25, 0.0, 1.0);
        // Rock and what grows / lies on it, per world.
        vec3 lit = vec3(0.58, 0.33, 0.22), shade = vec3(0.2, 0.13, 0.13);      // red rock
        float snowLine = 1e9, green = 0.0;
        #ifdef BIOME_ICE
        lit = vec3(0.55, 0.58, 0.66); shade = vec3(0.2, 0.24, 0.34); snowLine = 700.0;
        #endif
        #ifdef BIOME_LAVA
        lit = vec3(0.14, 0.1, 0.1); shade = vec3(0.05, 0.04, 0.045);
        #endif
        #ifdef BIOME_FOREST
        lit = vec3(0.5, 0.5, 0.48); shade = vec3(0.17, 0.19, 0.22); snowLine = 2300.0; green = 1.0;
        #endif
        vec3 c = mix(shade, lit, sun) * (0.85 + 0.3 * gully);
        // Forest on the lower slopes (VERDANT): dark green giving way to rock above the tree line.
        float tl = 1300.0 + 400.0 * (vnoise(vec2(az * 90.0, 3.0)) - 0.5);
        c = mix(c, mix(vec3(0.05, 0.1, 0.05), vec3(0.16, 0.26, 0.1), sun), green * (1.0 - smoothstep(tl - 60.0, tl + 60.0, h)));
        // Snow: above the line, more on gentle (up-facing) faces, streaming down the gullies.
        float sl = snowLine + 160.0 * (gully - 0.5) - 260.0 * n.y;
        c = mix(c, mix(vec3(0.55, 0.62, 0.78), vec3(1.05, 1.05, 1.08), sun), smoothstep(sl - 40.0, sl + 40.0, h));
        #ifdef BIOME_LAVA
        // The foothills lit from below by the lava fields.
        c += vec3(0.35, 0.08, 0.02) * (1.0 - smoothstep(0.0, 0.35, v)) * (1.0 - far * 0.7);
        #endif
        // The air between: the range takes the colour of the horizon sky — more with distance, and
        // most at its foot (valley haze). The sun's side glows.
        vec3 sky = skyColor(vec3(d.x, 0.02 + max(d.y, 0.0) * 0.4, d.z));
        float haze = mix(0.18, 0.6, far) + (1.0 - smoothstep(0.0, 0.45, v)) * mix(0.35, 0.25, far);
        c = mix(c, sky, clamp(haze, 0.0, 0.96));
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
  uTime: { value: number }
  tSand: { value: THREE.Texture | null }
  tClay: { value: THREE.Texture | null }
  tGravel: { value: THREE.Texture | null }
  tTrack: { value: THREE.Texture | null }
  uCloudOff: { value: THREE.Vector2 }
  uCloudShadow: { value: number }
  tNoise: { value: THREE.Texture }
  uAurT: { value: number }
  uTrackBox: { value: THREE.Vector4 }
  uTrackOn: { value: number }
}

function terrainMaterial(shared: GroundUniforms, snap: { value: THREE.Vector2 }, drop: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, ...MOUND_U, ...SHADOW_U, uSnap: snap, uDrop: { value: drop } },
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
      ${SHADOW_GLSL}
      uniform vec3 uCraft;
      uniform vec2 uShadow;
      uniform float uShadowK;
      uniform vec2 uFwd;
      uniform float uBoost;
      uniform float uSpeed;
      uniform float uTime;
      uniform sampler2D tSand;
      uniform sampler2D tClay;
      uniform sampler2D tGravel;
      uniform sampler2D tTrack;
      uniform vec2 uCloudOff;
      uniform float uCloudShadow;
      ${FBMT_GLSL}
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
        float bias = uSpeed * 0.5;
        mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
        vec3 s1 = texture2D(tSand, p / 26.0, bias).rgb;
        // Up close, bump the light from the sand texture itself (ripples and grains catch the sun).
        float nearB = 1.0 - smoothstep(60.0, 260.0, length(vW - cameraPosition));
        if (nearB > 0.0) {
          float l0 = dot(s1, vec3(0.33));
          float lx = dot(texture2D(tSand, (p + vec2(0.35, 0.0)) / 26.0, bias).rgb, vec3(0.33));
          float lz = dot(texture2D(tSand, (p + vec2(0.0, 0.35)) / 26.0, bias).rgb, vec3(0.33));
          #ifdef BIOME_ICE
          n = normalize(n + vec3(l0 - lx, 0.0, l0 - lz) * 0.3 * nearB * (1.0 - uSpeed * 0.7));
          #else
          n = normalize(n + vec3(l0 - lx, 0.0, l0 - lz) * 0.8 * nearB * (1.0 - uSpeed * 0.7));
          #endif
        }
        vec3 s2 = texture2D(tSand, rot * p / 170.0 + 0.37, bias * 0.5).rgb;
        // (The fine tiling fades out with distance: from the air it made a moire grid.)
        vec3 sandT = mix(s1, s2, mix(0.45, 1.0, smoothstep(250.0, 1800.0, length(vW - cameraPosition))));
        float gm = smoothstep(0.58, 0.72, fbmT(p * 0.0045 + 11.0) * 0.75 + fbmT(p * 0.03) * 0.32);
        vec3 grav = texture2D(tGravel, rot * p / 9.0, bias).rgb;
        vec3 clayT = texture2D(tClay, p / 13.0, bias).rgb;
        vec3 alb = mix(sandT, grav, gm * 0.85);
        alb = mix(alb, clayT * vec3(1.0, 0.92, 0.85), river);
        float big = fbmT(p * 0.0011 + 3.1) * 0.64 + fbmT(p * 0.004 + 5.7) * 0.42;
        alb *= mix(vec3(1.0), vec3(0.78, 0.55, 0.5), smoothstep(0.45, 0.75, big) * 0.7);
        alb *= mix(vec3(1.0), vec3(1.12, 1.1, 1.05), smoothstep(3.0, 12.0, h0) * 0.6);
        alb *= 0.9 + 0.21 * fbmT(p * 0.03 + 1.7);
        // Big slow patches (rotated, a much larger scale): no repeating pattern shows from the air.
        alb *= 0.84 + 0.32 * fbmT(mat2(0.8, 0.6, -0.6, 0.8) * p * 0.00025 + 13.0);
        #ifdef BIOME_ICE
        // Snow (the sand texture becomes its drift detail), dark rock where the gravel was, and the
        // dry riverbeds frozen: black-teal ice with white cracks.
        {
          float lumS = dot(sandT, vec3(0.333));
          // (Ripple contrast fades with distance: far sastrugi only made moire.)
          float rk = mix(0.15, 0.02, smoothstep(80.0, 700.0, length(vW - cameraPosition))) * (1.0 - min(0.8, uSpeed));
          // Sastrugi: long wind-carved ridges, all one way, sharp on the lee side.
          vec2 wd = vec2(0.8, 0.6);
          float along = dot(p, wd), across = dot(p, vec2(-wd.y, wd.x));
          float sg = fract(across / (7.0 + 5.0 * fbmT(p * 0.002)) + 0.4 * fbmT(vec2(along * 0.004, across * 0.01)));
          float sas = smoothstep(0.0, 0.7, sg) * (1.0 - smoothstep(0.7, 0.78, sg)) * smoothstep(0.35, 0.7, fbmT(vec2(along * 0.0015, across * 0.004) + 7.0));
          // A second set crossing at an angle where the wind veered.
          vec2 wd2 = vec2(0.26, 0.97);
          float sg2 = fract(dot(p, vec2(-wd2.y, wd2.x)) / (9.0 + 6.0 * fbmT(p * 0.0017 + 3.0)) + 0.5 * fbmT(p * 0.003));
          float sas2 = smoothstep(0.0, 0.7, sg2) * (1.0 - smoothstep(0.7, 0.78, sg2)) * smoothstep(0.55, 0.8, fbmT(p * 0.0012 + 2.0));
          sas = max(sas, sas2);
          // (Fine ridges shimmer into stripes far off and at speed: they fade with both.)
          sas *= (1.0 - smoothstep(150.0, 900.0, length(vW - cameraPosition))) * (1.0 - min(1.0, uSpeed * 0.9));
          vec3 snow = vec3(0.84, 0.89, 0.97) * (1.0 - rk * 0.5 + rk * lumS) * (1.0 - 0.12 * sas) * (0.94 + 0.12 * fbmT(p * 0.0011 + 3.1));
          vec3 rockI = vec3(0.26, 0.29, 0.36) * (0.85 + 0.3 * dot(grav, vec3(0.333)));
          alb = mix(snow, rockI, gm * 0.5);
          float cr = smoothstep(0.014, 0.0, abs(fbmT(p * 0.012) - 0.47)) + 0.6 * smoothstep(0.009, 0.0, abs(fbmT(p * 0.05 + 4.0) - 0.47));
          vec3 ice = mix(vec3(0.05, 0.11, 0.16), vec3(0.72, 0.86, 0.95), min(1.0, cr));
          // Wind-polished blue ice: bare patches out on the snowfield (they mirror the sky like the lakes).
          float pol = smoothstep(0.6, 0.66, fbmT(p * 0.0007 + 21.0)) * (1.0 - river);
          alb = mix(alb, mix(vec3(0.16, 0.32, 0.48), vec3(0.6, 0.78, 0.92), min(1.0, cr * 0.7)), pol * 0.85);
          river = max(river, pol * 0.55);
          alb = mix(alb, ice, river);
        }
        #endif

        #ifdef BIOME_FOREST
        // VERDANT: meadow grass (the sand texture as its blades), drier and darker patches, rock where
        // the gravel was, wildflowers close in, wind rolling across it in bright waves; rivers below.
        {
          float lumS = dot(sandT, vec3(0.333));
          float dry = smoothstep(0.45, 0.75, fbmT(p * 0.0009 + 4.0));
          vec3 grass = mix(vec3(0.17, 0.3, 0.07), vec3(0.33, 0.36, 0.12), dry) * (0.75 + 0.5 * lumS) * (0.85 + 0.3 * fbmT(p * 0.004 + 9.0));
          vec3 rockG = vec3(0.42, 0.41, 0.38) * (0.8 + 0.4 * dot(grav, vec3(0.333)));
          alb = mix(grass, rockG, gm * 0.55);
          // Wind waves over the grass: soft bright bands drifting across.
          float wv = sin(dot(p, vec2(0.012, 0.007)) - uTime * 1.4 + fbmT(p * 0.002) * 6.0);
          alb *= 1.0 + 0.1 * smoothstep(0.4, 1.0, wv) * (1.0 - gm);
          // Wildflowers, close in: sparse dots of white, yellow, violet.
          float fd = 1.0 - smoothstep(40.0, 220.0, length(vW - cameraPosition));
          if (fd > 0.0) {
            vec2 fc = floor(p * 0.9);
            float fl = step(0.985, hash12(fc)) * (1.0 - smoothstep(0.2, 0.42, length(fract(p * 0.9) - 0.5))) * fd * (1.0 - gm);
            vec3 fcol = hash12(fc + 3.0) < 0.4 ? vec3(0.95, 0.92, 0.85) : hash12(fc + 3.0) < 0.75 ? vec3(0.95, 0.8, 0.2) : vec3(0.6, 0.4, 0.85);
            alb = mix(alb, fcol, fl);
          }
          // River beds: gravel banks under clear water (the water itself is lit below).
          alb = mix(alb, vec3(0.3, 0.32, 0.26), smoothstep(0.05, 0.3, river));
        }
        #endif
        float lavaCrack = 0.0;
        #ifdef BIOME_LAVA
        // CINDER: black basalt sand, grey ash drifts where the gravel was, crusted banks to the lava.
        {
          float lumS = dot(sandT, vec3(0.333));
          vec3 basalt = vec3(0.16, 0.14, 0.14) * (0.7 + 0.6 * lumS) * (0.88 + 0.24 * fbmT(p * 0.0011 + 3.1));
          vec3 ashG = vec3(0.34, 0.31, 0.3) * (0.85 + 0.3 * dot(grav, vec3(0.333)));
          alb = mix(basalt, ashG, gm * 0.7);
          alb = mix(alb, vec3(0.04, 0.025, 0.02), smoothstep(0.1, 0.32, river));
          lavaCrack = smoothstep(0.012, 0.0, abs(fbmT(p * 0.006 + 2.0) - 0.5)) * (0.6 + 0.4 * fbmT(p * 0.03));
        }
        #endif
        // The racing line, worn: packed and darker, the ripples gone, scorched lanes down it.
        vec2 tuv = (p - uTrackBox.xy) / uTrackBox.zw;
        if (uTrackOn > 0.01 && tuv.x > 0.0 && tuv.y > 0.0 && tuv.x < 1.0 && tuv.y < 1.0) {
          vec2 wr = texture2D(tTrack, tuv).rg;
          float pack = smoothstep(0.05, 0.8, wr.r) * uTrackOn;
          #if defined(BIOME_ICE)
          alb = mix(alb, alb * vec3(0.8, 0.86, 0.97), pack * 0.8);
          #elif defined(BIOME_LAVA)
          alb = mix(alb, vec3(0.32, 0.3, 0.29), pack * 0.75); // packed ash: a grey road on black sand
          #elif defined(BIOME_FOREST)
          alb = mix(alb, vec3(0.28, 0.24, 0.17), pack * 0.6); // a dirt road through the grass (thin: the meadow shows)
          #else
          alb = mix(alb, mix(s2, vec3(dot(s2, vec3(0.33))), 0.25) * vec3(0.86, 0.74, 0.68), pack * 0.7);
          #endif
          float streak = wr.g * (0.75 + 0.25 * vnoise(p * 0.05)) * uTrackOn;
          alb *= 1.0 - 0.55 * smoothstep(0.05, 0.6, streak);
          #if defined(BIOME_ICE)
          alb = mix(alb, vec3(0.45, 0.55, 0.7), smoothstep(0.45, 0.9, streak) * 0.35);
          #elif defined(BIOME_LAVA)
          alb = mix(alb, vec3(0.03, 0.02, 0.02), smoothstep(0.45, 0.9, streak) * 0.35);
          #elif defined(BIOME_FOREST)
          alb = mix(alb, vec3(0.2, 0.14, 0.08), smoothstep(0.45, 0.9, streak) * 0.35);
          #else
          alb = mix(alb, vec3(0.16, 0.08, 0.05), smoothstep(0.45, 0.9, streak) * 0.35);
          #endif
        }
        // Fine grain right under you: a fifth-scale octave of the ground texture, close in only — the
        // speed blur has something to smear, and the ground reads as rushing past.
        float nearG = 1.0 - smoothstep(25.0, 150.0, length(vW - cameraPosition));
        if (nearG > 0.0) alb *= 1.0 + (dot(texture2D(tSand, p / 5.0, bias).rgb, vec3(0.333)) - 0.45) * 0.4 * nearG;
        alb *= 0.72;
        float sun = max(dot(n, SUN_DIR), 0.0);
        // Cloud shadows: the same coverage the sky draws, projected down along the sun, drifting.
        if (uCloudShadow > 0.5) {
          vec2 cp = p + SUN_DIR.xz / SUN_DIR.y * 2600.0 + uCloudOff;
          float b = fbmT(cp * 0.00032) * 0.93;
          sun *= 1.0 - 0.6 * smoothstep(0.46, 0.68, b);
        }
        // Cast shadows (mesas, trees, gate towers, the craft): sun light only, the sky fill stays.
        float shd = sunShadow(vW);
        sun *= shd;
        vec3 col = alb * (SUN_COL * sun + skyColor(n) * 0.36 + vec3(0.5, 0.22, 0.1) * 0.2);
        #ifdef BIOME_ICE
        // Snow is lit by the whole sky more than by the low sun; the ice mirrors the sky and aurora.
        // (Snow: bright under an open twilight sky — the old sand bounce removed, a cool ambient added.)
        col -= alb * vec3(0.5, 0.22, 0.1) * 0.2;
        col += alb * (skyColor(n) * 0.5 + vec3(0.3, 0.36, 0.48));
        // (Only where there is ice: the reflection — sky and aurora — cost every snow pixel 5 ms.)
        if (river > 0.01) {
          vec3 Vw = normalize(cameraPosition - vW), Rw = reflect(-Vw, n);
          float fr = pow(1.0 - max(dot(Vw, n), 0.0), 4.0);
          vec3 refl = skyColor(Rw) * 0.9 + aurora(Rw) * 0.9;
          col = mix(col, refl, river * (0.35 + 0.6 * fr));
        }
        #endif
        #ifdef BIOME_FOREST
        // Clear rivers: the sky and clouds mirrored, a little teal in the deep (only where there is water).
        if (river > 0.25) {
          vec3 Vw = normalize(cameraPosition - vW), Rw = reflect(-Vw, n);
          float fr = pow(1.0 - max(dot(Vw, n), 0.0), 3.0);
          float w = smoothstep(0.25, 0.55, river);
          // (Darker and less mirror-like than first drawn: at a racer's grazing angle the full sky
          //  turned every river into a pale sheet.)
          vec3 water = mix(vec3(0.03, 0.1, 0.12), skyColor(Rw) * 0.75, 0.15 + 0.4 * fr);
          water *= 0.85 + 0.15 * fbmT(p * 0.01 + vec2(uTime * 0.03, 0.0));
          water += vec3(0.9, 0.85, 0.7) * pow(max(dot(Rw, SUN_DIR), 0.0), 160.0) * 1.2;
          col = mix(col, water, w);
        }
        // Sunlit grass glows a little (it scatters light): a warm fill so the meadow is never dull.
        col += alb * vec3(0.12, 0.14, 0.06);
        #endif
        #ifdef BIOME_LAVA
        // Hot cracks across the basalt off the road (the race showed brown ground, lava only on the map):
        // glowing seams, faded far off (no shimmer) and kept off the course.
        {
          vec2 tl2 = (p - uTrackBox.xy) / uTrackBox.zw;
          float road = (uTrackOn > 0.01 && tl2.x > 0.0 && tl2.y > 0.0 && tl2.x < 1.0 && tl2.y < 1.0) ? smoothstep(0.2, 0.6, texture2D(tTrack, tl2, 1.5).b) : 0.0;
          col += vec3(3.0, 0.8, 0.12) * lavaCrack * (1.0 - road) * (1.0 - smoothstep(600.0, 3500.0, length(vW - cameraPosition)));
        }
        // The lava: flowing, glowing, crusting over in plates; and its glow on the sand beside it.
        col += alb * vec3(0.16, 0.12, 0.12) + alb * vec3(0.35, 0.12, 0.04) * 0.6; // the orange sky's light on the ground
        if (river > 0.01) {
          float fl = fbmT(p * 0.0035 + vec2(uTime * 0.012, uTime * 0.008));
          float crust = smoothstep(0.5, 0.62, fbmT(p * 0.018 + vec2(uTime * 0.03, uTime * 0.01)));
          // Where the course crosses, the flow has cooled to a black crust with glowing cracks (a wide
          // blur of the course's wear map marks the corridor): you race over it, not through fire.
          vec2 tl = (p - uTrackBox.xy) / uTrackBox.zw;
          float lane = (uTrackOn > 0.01 && tl.x > 0.0 && tl.y > 0.0 && tl.x < 1.0 && tl.y < 1.0) ? smoothstep(0.25, 0.75, texture2D(tTrack, tl, 1.5).b) : 0.0;
          float cracks = smoothstep(0.03, 0.0, abs(fbmT(p * 0.02) - 0.5)) + 0.5 * smoothstep(0.02, 0.0, abs(fbmT(p * 0.06 + 3.0) - 0.5));
          crust = mix(crust, 1.0 - min(1.0, cracks) * 0.3, lane);
          vec3 hot = mix(vec3(3.4, 0.7, 0.09), vec3(4.6, 1.9, 0.35), fl) * (1.0 - mix(0.93, 0.985, lane) * crust);
          col = mix(col, hot, smoothstep(0.3, 0.72, river));
          col += vec3(0.5, 0.13, 0.03) * 0.5 * smoothstep(0.12, 0.32, river) * (1.0 - smoothstep(0.32, 0.72, river)) * (1.0 - lane);
        }
        #endif
        // Sand glints: a few grains in each patch catch the sun toward you (near the camera, in sun,
        // fading out with speed so they never strobe).
        float gd = (1.0 - smoothstep(30.0, 200.0, length(vW - cameraPosition))) * (1.0 - min(1.0, uSpeed * 1.2));
        if (gd > 0.0) {
          vec2 cell = floor(p * 4.0);
          vec3 gn = normalize(n + vec3(hash12(cell + 1.3) - 0.5, 0.0, hash12(cell + 7.1) - 0.5) * 1.4);
          float sp = pow(max(dot(reflect(-SUN_DIR, gn), normalize(cameraPosition - vW)), 0.0), 80.0);
          // (Kept under bloom's threshold mostly: at 4× they bloomed into blobs, not twinkles.)
          col += vec3(1.7, 1.5, 1.2) * sp * step(0.93, hash12(cell)) * gd * sun * 1.4;
        }

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
        // (The painted-on shadow, now only a soft contact darkening: the shadow map draws the real one.)
        col *= 1.0 - (0.3 / (spread * spread)) * inside * (1.0 - uShOn * 0.7);
        vec2 dc = p - uCraft.xz;
        float near = exp(-uShadowK * 0.25);
        float hov = exp(-dot(dc, dc) / 22.0) * near;
        col += vec3(0.1, 0.5, 1.0) * hov * 0.5;
        float ba = dot(dc, uFwd);
        float sd = dot(dc, side) / 3.5;
        // (x·x, never pow(x, 2.0): pow of a negative is NaN in GLSL — black pixels around the craft.)
        // (exp(min(ba, 0)): ahead of the craft ba runs to kilometres, exp overflowed to infinity, and
        //  infinity × 0 is NaN — a black line on the ground straight ahead, a "post" on the horizon.)
        float behind = exp(-sd * sd) * (1.0 - smoothstep(-4.0, 0.0, ba)) * exp(min(ba, 0.0) / 26.0) * near;
        col += vec3(1.4, 0.55, 0.18) * behind * (0.1 + 0.6 * uBoost);

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
        #ifdef BIOME_ICE
        alb = mix(vec3(0.42, 0.48, 0.6), vec3(0.75, 0.82, 0.94), vTint);
        #endif
        #ifdef BIOME_FOREST
        alb = mix(vec3(0.3, 0.3, 0.28), vec3(0.55, 0.54, 0.5), vTint);
        #endif
        #ifdef BIOME_LAVA
        alb = mix(vec3(0.05, 0.045, 0.045), vec3(0.2, 0.17, 0.16), vTint);
        #endif
        float sun = max(dot(n, SUN_DIR), 0.0);
        vec3 col = alb * (SUN_COL * sun + skyColor(n) * 0.35);
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

/** Shape archetypes per kind, so no two neighbours read as the same rock. */
export const MESA_VARIANTS: Record<Kind, number> = { mesa: 6, butte: 4, spire: 3 }

/** Angular distance, wrapped to [0, π]. */
const angGap = (a: number, b: number) => { const d = Math.abs(((a - b) % 6.2832 + 6.2832) % 6.2832); return Math.min(d, 6.2832 - d) }

function mesaGeometry(kind: Kind, seed: number, v = 0): { geo: THREE.BufferGeometry; prof: Profile } {
  const r = rng(seed)
  const radial = kind === 'spire' ? 16 : 28
  const g = new THREE.CylinderGeometry(1, 1, 1.08, radial, kind === 'spire' ? 14 : 26, false)
  g.translate(0, 0.46, 0)
  // Ruggedness: how much the outline wanders (eroded variants are rougher).
  const rough = kind === 'mesa' ? [1.3, 1.0, 0.7, 1.1, 1.9, 1.0][v] : kind === 'butte' ? [1, 1.4, 0.9, 1.2][v] : [1, 0.8, 1.2][v]
  const harm: [number, number][] = []
  for (let i = 2; i <= 9; i++) harm.push([((0.16 / i) * (0.4 + r())) * rough, r() * 6.28])
  // Elongation: a strong second harmonic stretches the outline into a ridge or a peanut.
  const elong = kind === 'mesa' ? [0, 0, 0.34, 0.06, 0.08, 0.26][v] : kind === 'butte' ? [0, 0, 0.12, 0.2][v] : 0
  const eph = r() * 6.28
  const ledge = 0.45 + r() * 0.3
  const phi = r() * 6.28 // facing of a notch / low shoulder
  const t1 = 0.3 + r() * 0.12, t2 = 0.6 + r() * 0.12 // tier heights
  const f: Profile = (th, t) => {
    let k = 1 + elong * Math.cos(2 * th + eph)
    for (let i = 0; i < harm.length; i++) k += harm[i][0] * Math.sin((i + 2) * th + harm[i][1])
    k *= 1 + 0.04 * Math.sin(17 * th + 3 * t)
    if (kind === 'spire') {
      const tal = 1 - smooth(0, 0.2, t)
      k *= 1 + 0.7 * tal * tal
      if (v === 0) { // hoodoo: neck, capstone
        k *= 1 - 0.38 * smooth(0.1, 0.85, t)
        k *= 1 + 0.45 * smooth(0.86, 0.9, t)
      } else if (v === 1) { // needle: tapers to a point-ish crown
        k *= 1 - 0.62 * smooth(0.05, 1, t)
      } else { // stacked: two necks, two caps
        k *= 1 - 0.32 * smooth(0.08, 0.42, t)
        k *= 1 + 0.3 * smooth(0.44, 0.48, t)
        k *= 1 - 0.36 * smooth(0.5, 0.84, t)
        k *= 1 + 0.38 * smooth(0.86, 0.9, t)
      }
      return k
    }
    const skirt = kind === 'mesa' ? [0.55, 0.45, 0.5, 0.55, 0.95, 0.5][v] : [0.55, 0.4, 0.6, 0.5][v]
    const tal = 1 - smooth(0, kind === 'mesa' && v === 4 ? 0.5 : 0.34, t)
    k *= 1 + skirt * tal * tal
    const step = (at: number, d: number) => { k *= 1 - d * smooth(at - 0.015, at + 0.015, t) }
    if (kind === 'mesa') {
      if (v === 0) { step(ledge, 0.08); step(0.95, 0.05) }
      else if (v === 1) { step(t1, 0.2); step(t2, 0.24); step(0.95, 0.06) } // wedding cake
      else if (v === 2) { step(ledge, 0.05); step(0.95, 0.04) } // long ridge
      else if (v === 3) { // horseshoe: a deep bay bitten out of one side
        k *= 1 - 0.5 * Math.exp(-Math.pow(angGap(th, phi) / 0.55, 2)) * (0.7 + 0.3 * smooth(0.2, 0.6, t))
        step(ledge, 0.06); step(0.95, 0.05)
      } else if (v === 4) { // eroded: tapering walls to a small crown
        k *= 1 - 0.3 * smooth(0.25, 1, t)
        step(0.95, 0.08)
      } else { // split level: one half drops away at mid height
        const side = 0.5 + 0.5 * Math.cos(th - phi)
        k *= 1 - 0.55 * smooth(0.5, 0.56, t) * smooth(0.35, 0.75, side)
        step(0.95, 0.05)
      }
    } else {
      if (v === 0) { step(ledge, 0.08); step(0.95, 0.05) }
      else if (v === 1) { // chimney with an overhanging caprock
        k *= 1 - 0.22 * smooth(0.15, 0.8, t)
        k *= 1 + 0.22 * smooth(0.84, 0.88, t)
      } else if (v === 2) { step(t1 + 0.05, 0.28); step(0.95, 0.05) } // two tiers
      else { // shoulder: a low bench on one side
        const side = 0.5 + 0.5 * Math.cos(th - phi)
        k *= 1 - 0.45 * smooth(0.38, 0.44, t) * smooth(0.4, 0.8, side)
        step(0.95, 0.05)
      }
    }
    return k
  }
  const p = g.attributes.position as THREE.BufferAttribute
  // A gently uneven crown: tilt + a dip, so flat tops are not all billiard tables.
  const tilt = kind === 'spire' ? 0 : 0.03 + r() * 0.05, tph = r() * 6.28
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const z = p.getZ(i)
    let y = p.getY(i)
    if (y > 0.99 && tilt) y += tilt * (x * Math.cos(tph) + z * Math.sin(tph)) - 0.02 * Math.cos(3 * Math.atan2(z, x) + tph)
    if (Math.hypot(x, z) < 1e-4) { p.setY(i, y); continue }
    const k = f(Math.atan2(z, x), Math.max(0, p.getY(i)))
    p.setXYZ(i, x * k, y, z * k)
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
    uTime: { value: 0 },
    tSand: { value: null },
    tClay: { value: null },
    tGravel: { value: null },
    tTrack: { value: null },
    uCloudOff: { value: new THREE.Vector2() },
    uCloudShadow: { value: 1 },
    tNoise: { value: NOISE_TEX },
    uAurT: AUR_T,
    uTrackBox: { value: new THREE.Vector4(0, 0, 1, 1) },
    uTrackOn: { value: 0 },
  }
  private readonly rings: { mesh: THREE.Mesh; snap: { value: THREE.Vector2 }; step: number }[] = []
  private readonly wrapped: Wrapped[] = []
  /** Fixed rocks (the course's spires): not wrapped, always there. */
  private readonly fixed: { x: number; z: number; r: number; h: number; yaw: number; by: number; prof: Profile; big?: boolean }[] = []
  private spikeMat: THREE.MeshStandardMaterial | null = null
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
    const ICE = BIOME === 'ice', LAVA = BIOME === 'lava', FOREST = BIOME === 'forest'
    if (ICE) { mesaMat.roughness = 0.3; patchStandard(mesaMat, { ice: true, shadow: true }) }
    else if (LAVA) { mesaMat.roughness = 0.85; patchStandard(mesaMat, { lava: true, shadow: true }) }
    else if (FOREST) { mesaMat.roughness = 0.8; mesaMat.flatShading = true; patchStandard(mesaMat, { forest: true, aur: AUR_T, shadow: true }) }
    else patchStandard(mesaMat, { strata: true, shadow: true })
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.18, metalness: 0, flatShading: true })
    patchStandard(spikeMat, { ice: true, spike: true, aur: AUR_T, shadow: true })
    this.spikeMat = spikeMat
    const r = rng(1234)
    const kinds: [Kind, number, number][] = BIOME === 'lava'
      // CINDER: cinder cones first, a few basalt massifs (the column fields read as a city skyline).
      ? [['mesa', 160, 2200], ['butte', 520, 1000], ['spire', 70, 900]]
      : BIOME === 'forest'
      // VERDANT is a forest: groves everywhere, giant trees often, granite domes now and then.
      ? [['mesa', 360, 1500], ['butte', 1000, 380], ['spire', 520, 420]]
      : [
          // (×4: the world now wraps every 72 km, so the 130 km sprint overlaps itself less.)
          ['mesa', 680, 1300],
          ['butte', 240, 900],
          ['spire', 200, 600],
        ]
    const all: Placed[] = []
    this.mesaMat = mesaMat
    for (const [kind, count, spacing] of kinds) {
      // One instanced mesh per shape archetype; items are dealt across them at random.
      const ws: Wrapped[] = []
      for (let v = 0; v < (ICE ? ICE_VARIANTS : LAVA ? LAVA_VARIANTS : FOREST ? FOREST_VARIANTS : MESA_VARIANTS)[kind]; v++) {
        const seed = kind.length * 31 + 7 + v * 101
        const { geo, prof } = ICE || LAVA || FOREST ? landGeometry(kind, seed, v) : mesaGeometry(kind, seed, v)
        if (kind === 'spire' && v === 0) { this.spireGeo = geo; this.fixedProf = prof }
        ws.push(new Wrapped(geo, ICE && kind === 'spire' ? spikeMat : mesaMat, REBASE, 16500, 0.06, prof, true, null, 20000))
      }
      let placed = 0, tries = 0
      while (placed < count && tries++ < count * 80) {
        const ox = r() * REBASE
        const oz = r() * REBASE
        const sx = ((ox + REBASE / 2) % REBASE) - REBASE / 2
        const sz = ((oz + REBASE / 2) % REBASE) - REBASE / 2
        const v = Math.floor(r() * ws.length)
        let rad: number, h: number
        if (kind === 'mesa') {
          rad = 160 + r() * 520; h = 110 + r() * 260
          if (v === 1) h *= 1.25 // tiers need height to read
          if (v === 2) rad *= 1.15
          if (v === 4) h *= 0.8
        } else if (kind === 'butte') { rad = 90 + r() * 160; h = 160 + r() * 140; if (v === 1) { rad *= 0.8; h *= 1.2 } }
        else { rad = 35 + r() * 50; h = 140 + r() * 170; if (v === 2) h *= 1.15 }
        if (ICE) {
          if (kind === 'mesa') { rad *= 1.15; h *= 0.75 }
          else if (kind === 'spire') { rad *= 0.8; h *= 1.25 }
          else { rad *= 1.35; h *= 0.55 } // seracs: squat blocks, not towers
          // Ice comes in every size: small bergs to giants (skewed small, a few huge).
          const sc = 0.45 + 2.0 * Math.pow(r(), 2.2)
          rad *= sc; h *= 0.6 + 0.4 * sc
        }
        if (FOREST) {
          // Domes broad and rounded; groves a few hundred metres across and 60-120 m tall; giant trees.
          if (kind === 'mesa') { rad *= 1.0; h *= 0.75 }
          else if (kind === 'butte') { rad *= 0.7; h = 80 + r() * 80 }
          else { rad *= 0.55; h *= 0.75 }
          const sc = 0.55 + 1.5 * Math.pow(r(), 2)
          rad *= sc; h *= 0.7 + 0.3 * sc
        }
        if (LAVA) {
          // Massifs wide and low; cones broad (their slopes flare); stacks tall. Any size.
          if (kind === 'mesa') { rad *= 1.7; h *= 1.3 } // big volcanoes, broad slopes
          else if (kind === 'butte') { rad *= 1.8; h *= 0.9 }
          else { rad *= 1.0; h *= 0.28 } // stacks: squat crags (tall hex towers read as skyscrapers)
          const sc = 0.5 + 1.8 * Math.pow(r(), 2)
          rad *= sc; h *= 0.6 + 0.4 * sc
        }
        if (!clear(sx, sz, rad * (ICE && kind === 'spire' ? 2.4 : 1.6))) continue
        let ok = true
        for (const o of all) {
          let dx = Math.abs(o.ox - ox); dx = Math.min(dx, REBASE - dx)
          let dz = Math.abs(o.oz - oz); dz = Math.min(dz, REBASE - dz)
          if (Math.hypot(dx, dz) < spacing + (o.r + rad) * 1.2) { ok = false; break }
        }
        if (!ok) continue
        const it: Placed = { ox, oz, r: rad, h, yaw: r() * 6.28, x: 0, z: 0, by: 0, grow: 1 }
        ws[v].items.push(it)
        all.push(it)
        placed++
      }
      for (const w of ws) {
        w.finish()
        this.wrapped.push(w)
        this.group.add(w.mesh)
      }
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
    patchStandard(bMat, { strata: true, shadow: true })
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

    // (The course's hour: the sun's colour and strength, from the same light as the sky.)
    this.sunLight = new THREE.DirectionalLight(new THREE.Color(LIGHT.sunCol[0], LIGHT.sunCol[1], LIGHT.sunCol[2]).multiplyScalar(1 / 2.4), 3.0 * (LIGHT.sunCol[0] + LIGHT.sunCol[1] + LIGHT.sunCol[2]) / 6.43)
    this.sunLight.position.set(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2])
    this.group.add(this.sunLight)
    this.group.add(this.sunLight.target)
    // Fill: the sky from above, the ground's bounce from below — shaded rock was pitch black with the
    // sun the only light (a mesa's far face read as a hole cut in the view).
    {
      const sky = new THREE.Color(LIGHT.zenith[0], LIGHT.zenith[1], LIGHT.zenith[2]).lerp(new THREE.Color(LIGHT.horizon[0], LIGHT.horizon[1], LIGHT.horizon[2]), 0.55)
      const ground = BIOME === 'ice' ? new THREE.Color(0.55, 0.6, 0.72) : BIOME === 'lava' ? new THREE.Color(0.3, 0.09, 0.03) : BIOME === 'forest' ? new THREE.Color(0.2, 0.28, 0.1) : new THREE.Color(0.6, 0.32, 0.16)
      const k = BIOME === 'ice' ? 0.45 : BIOME === 'lava' ? 0.6 : BIOME === 'forest' ? 0.75 : 0.9
      this.group.add(new THREE.HemisphereLight(sky, ground, k))
    }
  }

  /** Rocks that stand where they are put (the course's spires). */
  /** Everything the course placed (spires, trackside landforms): hidden in HUNT, where you fly the
   *  open world — from the air they were rows along a course you are not on, and they did not wrap
   *  with the world (a jump every 72 km that looked like a reset). */
  readonly courseRocks = new THREE.Group()
  get courseOn(): boolean { return this.courseRocks.visible }
  set courseOn(v: boolean) { this.courseRocks.visible = v }
  addFixed(list: { x: number; z: number; r: number; h: number }[]): void {
    if (!this.courseRocks.parent) this.group.add(this.courseRocks)
    const mesh = new THREE.InstancedMesh(this.spireGeo!, this.mesaMat!, Math.max(1, list.length))
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3()
    list.forEach((o, i) => {
      const yaw = (i * 2.399) % 6.283
      const by = groundH(o.x, o.z) - 0.06 * o.h - 3
      this.fixed.push({ ...o, yaw, by, prof: this.fixedProf })
      mesh.setMatrixAt(i, m.compose(v.set(o.x, by, o.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), sc.set(o.r, o.h, o.r)))
    })
    mesh.count = list.length
    mesh.frustumCulled = false
    this.courseRocks.add(mesh)
  }

  /** The highest rock top within r of (x, z) (the ground if none): rings and flight clear it. */
  topAt(x: number, z: number, r: number): number {
    let top = groundH(x, z)
    for (const w of this.wrapped) for (const it of w.items) {
      if (it.grow < 0.03) continue
      const reach = r + it.r * 1.8
      if ((it.x - x) ** 2 + (it.z - z) ** 2 < reach * reach) top = Math.max(top, it.by + it.h * it.grow)
    }
    if (this.courseRocks.visible) for (const it of this.fixed) {
      const reach = r + it.r * 2
      if ((it.x - x) ** 2 + (it.z - z) ** 2 < reach * reach) top = Math.max(top, it.by + it.h)
    }
    return top
  }

  /** Everything standing at a fixed place (course spires, trackside landmarks): for pass-by sounds. */
  get landmarks(): readonly { x: number; z: number; r: number; h: number }[] { return this.fixed }

  /** Ice landmarks placed by the course itself, close beside the line (the polar world's set pieces). */
  addHeroes(list: { x: number; z: number; r: number; h: number; kind: 'mesa' | 'butte' | 'spire'; v: number; yaw: number; tilt?: number; sink?: number }[]): void {
    if (!this.courseRocks.parent) this.group.add(this.courseRocks)
    const groups = new Map<string, typeof list>()
    // Grouped by shape and by 5 km cell, each group its own culled mesh (thousands of small shards
    // line a course; only the cells in view are drawn).
    for (const o of list) { const k = `${o.kind}${o.v}:${Math.floor(o.x / 5000)},${Math.floor(o.z / 5000)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(o) }
    const shapes = new Map<string, ReturnType<typeof landGeometry>>()
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), e = new THREE.Euler()
    for (const g of groups.values()) {
      const sk = g[0].kind + g[0].v
      if (!shapes.has(sk)) shapes.set(sk, landGeometry(g[0].kind, g[0].kind.length * 31 + 7 + g[0].v * 101, g[0].v))
      const { geo, prof } = shapes.get(sk)!
      const mesh = new THREE.InstancedMesh(geo, g[0].kind === 'spire' && BIOME === 'ice' ? this.spikeMat! : this.mesaMat!, g.length)
      g.forEach((o, i) => {
        // (Small blocks may lie tilted or half sunk: toppled pieces, not a row of identical boxes.)
        const by = groundH(o.x, o.z) - (0.06 + (o.sink ?? 0)) * o.h - 3
        // (Trackside shards and blocks glance you off, no crash: a wide drift must not end a race.)
        this.fixed.push({ x: o.x, z: o.z, r: o.r, h: o.h, yaw: o.yaw, by, prof, big: o.r >= 60 })
        q.setFromEuler(e.set(o.tilt ?? 0, o.yaw, (o.tilt ?? 0) * 0.6, 'YXZ'))
        mesh.setMatrixAt(i, m.compose(v.set(o.x, by, o.z), q, sc.set(o.r, o.h, o.r)))
      })
      mesh.computeBoundingSphere()
      this.courseRocks.add(mesh)
    }
  }

  /** How far the mesas are drawn (m): they rise from the haze between 62% and 100% of it (a narrow band read as one ring of props). */
  setDrawDistance(d: number): void {
    for (const w of this.wrapped) if (w.big) { w.sinkTo = d; w.sinkFrom = d * 0.62 }
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
    AUR_T.value = time
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
    if (this.courseRocks.visible) for (const it of this.fixed) {
      const dx = x - it.x, dz = z - it.z
      const reach = range + it.r * 2.3
      if (dx * dx + dz * dz > reach * reach) continue
      const t = (y - it.by) / it.h
      if (t > 0.98) continue
      const c = Math.cos(it.yaw), s = Math.sin(it.yaw)
      const cr = it.r * it.prof(Math.atan2(dx * s + dz * c, dx * c - dz * s), Math.max(0, t)) * 0.97
      let o = out[n]
      if (!o) out[n] = o = { x: 0, z: 0, cr: 0, big: false }
      o.x = it.x; o.z = it.z; o.cr = cr; o.big = it.big ?? true
      n++
    }
    return n
  }
}
