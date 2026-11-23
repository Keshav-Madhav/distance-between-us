// The desert: sky dome (with fbm cumulus), two rings of far mountains, three terrain rings (fine near,
// coarse far, each snapped to its own grid so nothing swims), shader-wrapped pebbles, CPU-wrapped
// boulders and mesas (both collide, against their true lumpy profile), the env map.
import * as THREE from 'three'
import { REBASE } from './config'
import { BIOME, groundH, LIGHT, MOUND_U, SUN_DIR, WORLD_FADE } from './terrain'
import { ICE_VARIANTS, iceGeometry } from './ice'
import { LAVA_VARIANTS, lavaGeometry } from './lava'
import { FOREST_VARIANTS, forestGeometry } from './forest'
import { JUNGLE_VARIANTS, jungleGeometry } from './jungle'
import { cloudGlsl, LOOK, PLANET_R, SPACE_FN, SPACE_U } from './space'

/** The world's own landform shapes (ice or basalt) — the desert's mesas come from mesaGeometry. */
const landGeometry = (kind: 'mesa' | 'butte' | 'spire', seed: number, v: number) => BIOME === 'lava' ? lavaGeometry(kind, seed, v) : BIOME === 'forest' ? forestGeometry(kind, seed, v) : BIOME === 'jungle' ? jungleGeometry(kind, seed, v) : iceGeometry(kind, seed, v)
import { FBMT_GLSL, NOISE_TEX, patchStandard, WORLD_GLSL } from './shaders'
import { SHADOW_GLSL, SHADOW_U } from './shadow'
import { LodPair, lodFade, patchLodDither, type LodView } from './lod'

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
    // (Fades out as you climb to space: the space pass behind it shows through.)
    uniforms: { uTime: { value: 0 }, uAurT: AUR_T, uCloudOff: { value: new THREE.Vector2() }, tNoise: { value: NOISE_TEX }, uAir: { value: 1 }, uDip: { value: 0 }, uCloudFade: { value: 1 }, ...MOUND_U },
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
      uniform float uAir;
      uniform float uDip;
      uniform float uCloudFade;
      varying vec3 vDir;
      ${FBMT_GLSL}
      // (Baked: three of these per pixel were 48 hashes — the costliest thing in the frame.)
      float fbm(vec2 p) { return fbmT(p); }
      void main() {
        vec3 d = normalize(vDir);
        // Up high the true horizon is below level (the dip): the dome's horizon follows it down.
        // (The gradient and the alpha only: shifting the sun and clouds too drew a second sun.)
        vec3 dh = normalize(vec3(d.x, d.y + uDip, d.z));
        vec3 c = skyColor(dh);
        float s = max(dot(d, SUN_DIR), 0.0);
        ${ground ? `c = mix(c, ${BIOME === 'lava' ? 'vec3(0.06, 0.04, 0.035)' : BIOME === 'ice' ? 'vec3(0.6, 0.66, 0.8)' : BIOME === 'forest' ? 'vec3(0.2, 0.3, 0.12)' : BIOME === 'jungle' ? 'vec3(0.05, 0.08, 0.05)' : 'vec3(0.62, 0.3, 0.13)'}, 1.0 - smoothstep(-0.08, 0.0, d.y));` : ''}
        // Fair-weather cumulus on a plane 2.6 km up: fbm coverage, lit tops, grey-blue bases,
        // thinned toward the horizon where they would alias.
        if (d.y > 0.015) {
          vec2 cp = d.xz / d.y * 2600.0 + uCloudOff;
          float base = fbm(cp * 0.00032);
          float cov = smoothstep(0.52, 0.78, base);
          #ifdef BIOME_ICE
          cov *= 0.08; // (a clear twilight: barely any cloud, so the aurora and stars show)
          #endif
          #ifdef BIOME_JUNGLE
          cov = smoothstep(0.28, 0.66, base); // (the rains: a low, near-total overcast)
          #endif
          #ifdef BIOME_LAVA
          cov = min(1.0, cov * 1.4 + 0.1); // (an ash sky)
          #endif
          float detail = fbm(cp * 0.0016 + 3.0);
          cov *= smoothstep(0.25, 0.55, detail + cov * 0.4);
          // (Climbing to the cloud layer: the painted clouds give way to the real deck — src/world.ts.)
          cov *= uCloudFade;
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
          #ifdef BIOME_JUNGLE
          // Rain clouds: heavy and grey-green, barely lit, melting into the mist at the horizon.
          cc = mix(vec3(0.1, 0.12, 0.115), vec3(0.28, 0.32, 0.3), lit) * (0.85 + 0.3 * detail);
          cc = mix(cc, skyColor(vec3(d.x, 0.03, d.z)) * 0.95, (1.0 - smoothstep(0.02, 0.25, d.y)) * 0.75);
          #endif
          float fade = smoothstep(0.015, 0.16, d.y);
          // High cirrus, 9 km up: thin streaks drawn out along the wind, behind the cumulus.
          vec2 hp = d.xz / d.y * 9000.0 + uCloudOff * 1.7;
          float ci = fbmT(hp * vec2(0.00006, 0.00028) + 7.3) * 0.7 + fbmT(hp * 0.0011 + 2.1) * 0.3;
          float cir = smoothstep(0.5, 0.78, ci) * smoothstep(0.03, 0.25, d.y) * (1.0 - cov);
          #if defined(BIOME_ICE)
          cir *= 0.15;
          #elif defined(BIOME_JUNGLE)
          cir = 0.0;
          #endif
          c = mix(c, vec3(1.45, 1.42, 1.38) * SUN_TINT + vec3(1.0, 0.8, 0.55) * pow(s, 8.0) * 0.5, cir * 0.42 * uCloudFade);
          c = mix(c, cc, cov * fade * 0.92);
        }
        // A bank of distant cloud along the horizon, above the mountains: tops lit on the sun's side,
        // dissolving into the haze — the farthest thing you see, and the sense of how far that is.
        // (Not in the rains: over MONSOON's mist it drew a bright seam behind the hills.)
        #if !defined(BIOME_ICE) && !defined(BIOME_JUNGLE)
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
        #elif defined(BIOME_JUNGLE)
        // Behind the overcast: no disc, a pale bright smear where the sun is.
        c += vec3(0.9, 0.95, 0.85) * (pow(s, 60.0) * 0.35 + pow(s, 6.0) * 0.1);
        #elif defined(BIOME_ICE)
        c += vec3(1.0, 0.75, 0.6) * (smoothstep(0.99955, 0.9998, s) * 12.0 + pow(s, 900.0) * 2.0 + pow(s, 30.0) * 0.15 + pow(s, 4.0) * 0.05);
        #else
        c += vec3(1.0, 0.9, 0.75) * (smoothstep(0.99955, 0.9998, s) * 40.0 + pow(s, 900.0) * 4.0 + (pow(s, 30.0) * 0.4 + pow(s, 4.0) * 0.1) * ${BIOME === 'forest' ? '0.45' : '1.0'});
        #endif
        // (In space mode only the sky above the horizon: below it the planet shows, not a painted ground.)
        gl_FragColor = vec4(c, uAir < 0.999 ? uAir * smoothstep(-0.04, 0.01, dh.y) : 1.0);
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
    uniforms: { ...MOUND_U, ...WORLD_FADE },
    vertexShader: /* glsl */ `
      attribute vec2 aT;
      attribute vec2 aH;
      uniform vec4 uWorldFade;
      varying vec2 vT;
      varying vec2 vH;
      varying vec3 vDir;
      void main() {
        vT = aT; vH = aH;
        // Climbing: the far ranges sink below the horizon (dithering them away left a pepper of holes).
        vec3 ps = position;
        ps.y = mix(ps.y, -0.02 * length(ps.xz), uWorldFade.w);
        vDir = ps;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(ps, 1.0);
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
        #ifdef BIOME_JUNGLE
        snowLine = 1e9; // (green to the summits: the rainforest's ridges, half lost in cloud)
        #endif
        vec3 c = mix(shade, lit, sun) * (0.85 + 0.3 * gully);
        // Forest on the lower slopes (VERDANT): dark green giving way to rock above the tree line.
        float tl = 1300.0 + 400.0 * (vnoise(vec2(az * 90.0, 3.0)) - 0.5);
        #ifdef BIOME_JUNGLE
        tl = 1e9;
        #endif
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
        #ifdef BIOME_JUNGLE
        haze = haze * 0.7 + 0.35 + (1.0 - smoothstep(0.0, 0.6, v)) * 0.3; // the range's foot lost in the mist
        #endif
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
    uniforms: { ...shared, ...MOUND_U, ...SHADOW_U, ...WORLD_FADE, ...SPACE_U, uSnap: snap, uDrop: { value: drop } },
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
        // Climbing (src/space.ts): the ground bends away to the planet's curvature, so its edge meets
        // the planet drawn behind it. (Zero on the ground: nothing changes there.)
        w.y -= uWorldFade.z * d * d / ${(2 * PLANET_R).toFixed(1)};
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
      ${SPACE_FN}
      void main() {
        if (worldCutGround(vW, gl_FragCoord.xy)) discard;
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
        // A third, much larger rotated scale mixed in by noise, and slow light/dark drifts: from the air
        // the 170 m tile still lined up into a diagonal grid to the horizon.
        vec3 s3 = texture2D(tSand, vec2(p.y, -p.x) / 1130.0 + 0.71, bias * 0.3).rgb;
        vec3 sFar = mix(s2, s3, smoothstep(0.32, 0.68, fbmT(p * 0.00045 + 1.7)));
        sFar *= 0.86 + 0.28 * fbmT(p * 0.00062 + 8.3);
        vec3 sandT = mix(s1, sFar, mix(0.4, 1.0, smoothstep(140.0, 800.0, length(vW - cameraPosition))));
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
          #ifdef BIOME_JUNGLE
          // MONSOON: the forest floor — dark wet leaf litter, moss, black mud; no meadow.
          {
            float moss = 0.75 - 0.6 * smoothstep(0.5, 0.75, fbmT(p * 0.0016 + 7.0));
            vec3 litter = mix(vec3(0.075, 0.058, 0.03), vec3(0.03, 0.07, 0.022), moss) * (0.7 + 0.6 * lumS) * (0.8 + 0.4 * fbmT(p * 0.006 + 2.0));
            alb = mix(litter, vec3(0.12, 0.13, 0.1) * (0.8 + 0.4 * dot(grav, vec3(0.333))), gm * 0.4);
          }
          // Past the drawn trees the ground reads as canopy from above: lumpy dark crowns, lit tops, the
          // rivers left open (it was a pale empty plain around one patch of forest).
          {
            float fdist = smoothstep(1400.0, 2600.0, length(vW - cameraPosition));
            if (fdist > 0.0) {
              float lump = fbmT(p * 0.012 + 3.3) * 0.6 + fbmT(p * 0.045 + 8.1) * 0.4;
              vec3 crown = mix(vec3(0.035, 0.075, 0.03), vec3(0.11, 0.19, 0.07), smoothstep(0.3, 0.75, lump));
              alb = mix(alb, crown, fdist * (1.0 - smoothstep(0.02, 0.2, river)));
            }
          }
          #endif
          // Wind waves over the grass: soft bright bands drifting across.
          float wv = sin(dot(p, vec2(0.012, 0.007)) - uTime * 1.4 + fbmT(p * 0.002) * 6.0);
          alb *= 1.0 + 0.1 * smoothstep(0.4, 1.0, wv) * (1.0 - gm);
          // Wildflowers, close in: sparse dots of white, yellow, violet.
          float fd = 1.0 - smoothstep(40.0, 220.0, length(vW - cameraPosition));
          fd = 0.0; // (the scatter's flower clumps replace these: flat discs read as litter)
          if (fd > 0.0) {
            vec2 fc = floor(p * 0.9);
            float fl = step(0.985, hash12(fc)) * (1.0 - smoothstep(0.2, 0.42, length(fract(p * 0.9) - 0.5))) * fd * (1.0 - gm);
            vec3 fcol = hash12(fc + 3.0) < 0.4 ? vec3(0.95, 0.92, 0.85) : hash12(fc + 3.0) < 0.75 ? vec3(0.95, 0.8, 0.2) : vec3(0.6, 0.4, 0.85);
            alb = mix(alb, fcol, fl);
          }
          // River beds: gravel banks under clear water (the water itself is lit below).
          #ifdef BIOME_JUNGLE
          alb = mix(alb, vec3(0.15, 0.11, 0.06), smoothstep(0.05, 0.3, river)); // mud banks
          #else
          alb = mix(alb, vec3(0.3, 0.32, 0.26), smoothstep(0.05, 0.3, river));
          #endif
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
          #elif defined(BIOME_JUNGLE)
          alb = mix(alb, vec3(0.13, 0.1, 0.06), pack * 0.4); // a mud track through the moss (thin: the green shows)
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
          #ifdef BIOME_JUNGLE
          water = mix(vec3(0.12, 0.085, 0.045), skyColor(Rw) * 0.45, 0.05 + 0.3 * fr); // a brown, silted river
          #endif
          water *= 0.85 + 0.15 * fbmT(p * 0.01 + vec2(uTime * 0.03, 0.0));
          water += vec3(0.9, 0.85, 0.7) * pow(max(dot(Rw, SUN_DIR), 0.0), 160.0) * 1.2;
          col = mix(col, water, w);
        }
        // Sunlit grass glows a little (it scatters light): a warm fill so the meadow is never dull.
        #ifndef BIOME_JUNGLE
        col += alb * vec3(0.12, 0.14, 0.06);
        #endif
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

        col = applyFog(col, vW);
        // Climbing: over the outer part of the flat world the ground turns into exactly what the space
        // pass draws behind it along this ray — so where it dissolves, both sides are the same pixels.
        if (uWorldFade.x > 0.0) {
          float rr = length(vW.xz - cameraPosition.xz);
          float k = smoothstep(uWorldFade.x * 0.35, uWorldFade.x * 0.85, rr);
          if (k > 0.002) col = mix(col, spacePixel(normalize(vW - cameraPosition)), k);
        }
        gl_FragColor = vec4(col, 1.0);
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
    uniforms: { uTile: { value: tile }, ...MOUND_U, ...WORLD_FADE },
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
        if (worldCut(vW, gl_FragCoord.xy)) discard;
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
        #ifdef BIOME_JUNGLE
        alb = mix(vec3(0.08, 0.11, 0.06), vec3(0.2, 0.22, 0.14), vTint); // (mossy stones, leaf litter)
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

/**
 * MONSOON's canopy: a carpet of tree crowns over every bit of ground off the course — domes of leaves
 * from the ground up (no trunks to see), each a cluster of lumps, tiled round the camera like the
 * pebbles. Off the course corridor (the track texture's blue) and out of the rivers; sunk into the
 * ground toward the tile's edge so the wrap never pops. The stands, emergents and karst towers rise
 * out of it.
 */
function canopy(count: number, tile: number, shared: GroundUniforms, wind: { value: number }): THREE.InstancedMesh {
  const r = rng(91)
  // One crown: seven lumps — a broad spreading base and a domed top (a few trunks carry wide crowns).
  const parts: THREE.BufferGeometry[] = []
  for (let k = 0; k < 7; k++) {
    const g = new THREE.IcosahedronGeometry(1, 0)
    // The centre lump, five around it spreading wide and low, one high on top.
    const ring = k >= 1 && k <= 5
    const a = (k / 5) * 6.28 + r() * 0.5, d = ring ? 0.55 + r() * 0.2 : 0
    const sc = k === 0 ? 0.7 : ring ? 0.45 + r() * 0.12 : 0.5
    g.scale(sc, sc * (ring ? 0.6 : 0.8), sc)
    g.translate(Math.cos(a) * d, k === 0 ? 0.1 : ring ? 0.0 + r() * 0.15 : 0.45, Math.sin(a) * d)
    parts.push(g.toNonIndexed())
  }
  const geo = new THREE.BufferGeometry()
  const pos: number[] = [], nrm: number[] = []
  // Each lump's normals point out from its own centre (a soft round mass, not crystal facets).
  for (let k = 0; k < parts.length; k++) {
    const pa = parts[k].attributes.position.array as Float32Array
    let cx = 0, cy = 0, cz = 0
    for (let i = 0; i < pa.length; i += 3) { cx += pa[i]; cy += pa[i + 1]; cz += pa[i + 2] }
    const nv = pa.length / 3; cx /= nv; cy /= nv; cz /= nv
    for (let i = 0; i < pa.length; i += 3) {
      pos.push(pa[i], pa[i + 1], pa[i + 2])
      const dx = pa[i] - cx, dy = pa[i + 1] - cy, dz = pa[i + 2] - cz, l = Math.hypot(dx, dy, dz) || 1
      nrm.push(dx / l, dy / l, dz / l)
    }
  }
  const trunkFlag: number[] = new Array(pos.length / 3).fill(0)
  // The trunk: a thin column, y 0…1 (the shader stretches it from the ground to the crown's base).
  {
    const t = new THREE.CylinderGeometry(0.7, 1, 1, 6, 1, true).toNonIndexed()
    t.translate(0, 0.5, 0)
    const ta = t.attributes.position.array as Float32Array, tn = t.attributes.normal.array as Float32Array
    for (let i = 0; i < ta.length; i++) { pos.push(ta[i]); nrm.push(tn[i]) }
    for (let i = 0; i < ta.length / 3; i++) trunkFlag.push(1)
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  geo.setAttribute('aTrunk', new THREE.Float32BufferAttribute(trunkFlag, 1))
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTile: { value: tile }, tTrack: shared.tTrack, uTrackBox: shared.uTrackBox, uTrackOn: shared.uTrackOn, uWind: wind, ...MOUND_U, ...WORLD_FADE },
    vertexShader: /* glsl */ `
      ${WORLD_GLSL}
      uniform float uTile;
      uniform sampler2D tTrack;
      uniform vec4 uTrackBox;
      uniform float uTrackOn;
      uniform float uWind;
      attribute float aTrunk;
      varying vec3 vW;
      varying vec3 vNw;
      varying float vTint;
      varying float vUp;
      varying float vTrunk;
      void main() {
        vec3 o = instanceMatrix[3].xyz;
        o.xz += uTile * floor((cameraPosition.xz - o.xz) / uTile + 0.5);
        mat3 m = mat3(instanceMatrix);
        float k = 1.0 - smoothstep(uTile * 0.36, uTile * 0.48, length(o.xz - cameraPosition.xz));
        // Off the racing line (the wear's second band, ~±200 m: the trees crowd the gates) and out of
        // the rivers.
        vec2 tuv = (o.xz - uTrackBox.xy) / uTrackBox.zw;
        float road = (uTrackOn > 0.01 && tuv.x > 0.0 && tuv.y > 0.0 && tuv.x < 1.0 && tuv.y < 1.0) ? texture2D(tTrack, tuv).r : 0.0;
        k *= 1.0 - smoothstep(0.16, 0.3, road);
        k *= 1.0 - smoothstep(0.08, 0.3, riverAt(o.xz));
        float h = length(m[1]);
        // Tall trees: an open forest — few trunks, each holding a huge crown 48-74 m above the floor (you see in under it).
        float lift = 48.0 + 26.0 * hash12(instanceMatrix[3].xz + 3.7);
        float g = groundH(o.xz) - (1.0 - k) * (lift + h * 1.5);
        o.y = g + lift + h * 0.55;
        vec3 lp = position;
        vec3 w;
        vTrunk = aTrunk;
        if (aTrunk > 0.5) {
          // Stretched from the floor to inside the crown; a fixed girth (not the crown's scale).
          float tr = 2.4 + 1.8 * hash12(instanceMatrix[3].xz + 9.1);
          w = vec3(o.x + lp.x * tr * k, g + lp.y * (lift + h * 0.5), o.z + lp.z * tr * k);
        } else {
          // A slow sway in the tops.
          lp.xz += vec2(0.6, 0.3) * sin(uWind * 1.1 + o.x * 0.013 + o.z * 0.017) * 0.03 * max(lp.y + 0.6, 0.0);
          w = o + m * lp * max(k, 0.001);
        }
        vW = w;
        vec3 sc = vec3(dot(m[0], m[0]), dot(m[1], m[1]), dot(m[2], m[2]));
        vNw = aTrunk > 0.5 ? normalize(vec3(normal.x, 0.0, normal.z)) : normalize(m * (normal / sc));
        vUp = lp.y;
        vTint = hash12(instanceMatrix[3].xz);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${WORLD_GLSL}
      varying vec3 vW;
      varying vec3 vNw;
      varying float vTint;
      varying float vUp;
      varying float vTrunk;
      float cvn(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        float a = mix(hash12(i.xz + i.y * 17.0), hash12(i.xz + vec2(1.0, 0.0) + i.y * 17.0), f.x);
        float b = mix(hash12(i.xz + vec2(0.0, 1.0) + i.y * 17.0), hash12(i.xz + vec2(1.0) + i.y * 17.0), f.x);
        float c = mix(hash12(i.xz + (i.y + 1.0) * 17.0), hash12(i.xz + vec2(1.0, 0.0) + (i.y + 1.0) * 17.0), f.x);
        float d = mix(hash12(i.xz + vec2(0.0, 1.0) + (i.y + 1.0) * 17.0), hash12(i.xz + vec2(1.0) + (i.y + 1.0) * 17.0), f.x);
        return mix(mix(a, b, f.z), mix(c, d, f.z), f.y);
      }
      void main() {
        if (worldCut(vW, gl_FragCoord.xy)) discard;
        // Leaves: clumps of foliage as bumps on the round mass, fading out with distance.
        float dist = length(vW - cameraPosition);
        float near = 1.0 - smoothstep(300.0, 1400.0, dist);
        float l1 = 0.5, l2 = 0.5;
        if (near > 0.0) { l1 = cvn(vW * 0.16); l2 = cvn(vW * 0.55 + 7.0); }
        vec3 n = normalize(vNw + near * vec3(l1 - 0.5, 0.0, l2 - 0.5) * 1.1);
        vec3 alb = mix(vec3(0.02, 0.065, 0.025), vec3(0.085, 0.17, 0.045), vTint);
        alb *= 0.75 + 0.45 * mix(0.5, l1 * 0.6 + l2 * 0.4, near);
        // Deep gaps between the leaf clumps.
        alb *= 1.0 - near * 0.45 * smoothstep(0.55, 0.2, l1 * 0.7 + l2 * 0.3);
        // Darker down in the crown (self-shade), paler new growth on top.
        alb *= mix(0.55, 1.15, smoothstep(-0.6, 0.7, vUp));
        if (vTrunk > 0.5) {
          // Dark wet bark, mossy toward the foot, in the crown's shade.
          n = vNw;
          alb = mix(vec3(0.03, 0.06, 0.025), vec3(0.075, 0.06, 0.045), smoothstep(0.0, 25.0, vW.y)) * (0.7 + 0.5 * hash12(floor(vW.xz) + floor(vW.y * 0.3)));
        }
        float sun = max(dot(n, SUN_DIR), 0.0) * (vTrunk > 0.5 ? 0.35 : 1.0);
        vec3 col = alb * (SUN_COL * sun * 0.8 + skyColor(n) * 0.5 + vec3(0.04, 0.07, 0.03));
        col = applyFog(col, vW);
        // Under the canopy the mist is thicker: far trunks dissolve into it (only the near ones read).
        if (vTrunk > 0.5) {
          vec3 dv = vW - cameraPosition;
          col = mix(col, skyColor(normalize(vec3(dv.x, 0.02, dv.z))) * 0.3, smoothstep(200.0, 900.0, length(dv.xz)) * 0.92);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sv = new THREE.Vector3()
  // A jittered grid: even cover, no clumping bare patches.
  const n = Math.ceil(Math.sqrt(count)), cell = tile / n
  let i = 0
  for (let gx = 0; gx < n && i < count; gx++) for (let gz = 0; gz < n && i < count; gz++) {
    v.set((gx + 0.15 + r() * 0.7) * cell, 0, (gz + 0.15 + r() * 0.7) * cell)
    const rad = cell * (0.62 + r() * 0.3), h = 42 + r() * 22 + (r() < 0.12 ? 18 : 0)
    sv.set(rad, h, rad)
    q.setFromEuler(e.set(0, r() * 6.28, 0))
    mesh.setMatrixAt(i++, mm.compose(v, q, sv))
  }
  mesh.count = i
  mesh.frustumCulled = false
  return mesh
}

/**
 * The cloud deck: the same cloud layer the sky paints, as a real sheet 2.6 km up that you fly through
 * and look down on (FREE ROAM, climbing). A disc round the camera, bent to the planet's curvature,
 * dissolving at its rim into the planet's own clouds drawn by the space pass (the same cover there).
 */
export function cloudDeck(cloudOff: { value: THREE.Vector2 }): THREE.Mesh {
  // (Rings of vertices out to the rim, so the curvature bends it.)
  const ring = new THREE.RingGeometry(1, 40000, 160, 48)
  ring.rotateX(-Math.PI / 2)
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uCloudOff: cloudOff, tNoise: { value: NOISE_TEX }, uAlt: { value: 0 }, uDeck: { value: 0 }, ...WORLD_FADE, ...MOUND_U },
    vertexShader: /* glsl */ `
      ${WORLD_GLSL}
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        float d = length(w.xz - cameraPosition.xz);
        w.y -= uWorldFade.z * d * d / ${(2 * PLANET_R).toFixed(1)};
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${WORLD_GLSL}
      ${FBMT_GLSL}
      uniform vec2 uCloudOff;
      uniform float uAlt;
      uniform float uDeck;
      varying vec3 vW;
      ${cloudGlsl('uAlt')}
      void main() {
        if (worldCut(vW, gl_FragCoord.xy)) discard;
        float cov = cloudAt(vW.xz);
        if (cov < 0.01) discard;
        float r = length(vW.xz - cameraPosition.xz);
        bool above = cameraPosition.y > vW.y;
        // Tops: lit by the sun, a little relief from the cover itself; bases: grey.
        float relief = fbmT((vW.xz + uCloudOff) * 0.0012 + 7.0);
        vec3 top = vec3(${LOOK.cloud.map((x) => x.toFixed(3)).join(', ')}) * (SUN_COL * (0.5 + 0.35 * relief) * 0.55 + skyColor(vec3(0.0, 1.0, 0.0)) * 0.35);
        vec3 base = vec3(${LOOK.cloud.map((x) => x.toFixed(3)).join(', ')}) * (skyColor(vec3(0.0, -0.2, 0.0)) * 0.45 + SUN_COL * 0.12);
        vec3 col = applyFog(above ? top : base, vW);
        float a = smoothstep(0.0, 0.6, cov) * uDeck * (1.0 - smoothstep(30000.0, 40000.0, r));
        gl_FragColor = vec4(col, a);
      }`,
  })
  const m = new THREE.Mesh(ring, mat)
  m.frustumCulled = false
  m.renderOrder = 2
  m.visible = false
  return m
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
  /** Extra sink (× h): half-buried blocks. And where `by` was last computed (it only changes on a wrap). */
  sink?: number
  bx?: number
  bz?: number
}

const TMP_DIR = new THREE.Vector3()
const LV: LodView = { cx: 0, cz: 0, vx: 0, vz: 0 }

/**
 * Things the course places once and never moves (trackside rocks, shards, trees, spires): one set per
 * shape, its full and simplified forms, rewritten each frame with only what is in view (or close
 * enough to cast a shadow into it), near ones full detail. (They were batched in 5 km cells, culled
 * whole: nearly every cell touched the view, so ~2M triangles of trackside trees were drawn in MONSOON.)
 */
class StaticSet {
  readonly node: THREE.Group
  private readonly pair: LodPair
  private readonly mats: Float32Array
  /** x, z, reach (horizontal radius, generous), height per item. */
  private readonly at: Float32Array
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], at: number[]) {
    const n = mats.length
    this.mats = new Float32Array(n * 16)
    mats.forEach((m, i) => this.mats.set(m.elements, i * 16))
    this.at = Float32Array.from(at)
    this.pair = new LodPair(geo, mat, n)
    this.node = this.pair.node
  }
  update(v: LodView, fx: number, fz: number, cosHalf: number): void {
    const n = this.at.length / 4, A = this.at
    this.pair.begin()
    for (let i = 0; i < n; i++) {
      const dx = A[i * 4] - v.cx, dz = A[i * 4 + 1] - v.cz, reach = A[i * 4 + 2]
      const d = Math.hypot(dx, dz)
      // (Close enough that its shadow may fall into view: kept, seen or not.)
      if (d > Math.min(1000, 150 + A[i * 4 + 3] * 5) + reach && (dx * fx + dz * fz) / d < cosHalf - reach / d) continue
      this.pair.put(this.mats, i * 16, lodFade(dx, dz, reach, v))
    }
    this.pair.end()
  }
}

const TMP_M = new Float32Array(16)
class Wrapped {
  readonly items: Placed[] = []
  private pair: LodPair | null = null
  node = new THREE.Group()
  constructor(
    private readonly geo: THREE.BufferGeometry,
    private readonly mat: THREE.Material,
    readonly tile: number,
    public sinkFrom: number,
    readonly bury: number,
    readonly prof: Profile,
    readonly big: boolean,
    readonly veto: ((x: number, z: number, r: number) => boolean) | null = null,
    /** Fully sunk (and not drawn) past this distance. */
    public sinkTo = tile / 2,
  ) {}
  /** After the items are dealt: the full shape and its simplified twin (src/lod.ts), both in `node`. */
  finish(): void {
    this.pair = new LodPair(this.geo, this.mat, this.items.length)
    this.node = this.pair.node
  }
  update(v: LodView, fx = 0, fz = 0, cosHalf = -2): void {
    const pair = this.pair!, cx = v.cx, cz = v.cz, m = TMP_M
    const T = this.tile
    pair.begin()
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
      // (Cached until it wraps: thousands of clutter items, one terrain lookup each per frame, added up.)
      if (it.bx !== x || it.bz !== z) { it.bx = x; it.bz = z; it.by = groundH(x, z) - (this.bury + (it.sink ?? 0)) * it.h - 3 }
      // Out of view and past shadow reach (a tall grove's shadow falls far, a block's not): not drawn.
      // (MONSOON drew 6M triangles of forest, half of it behind the camera.)
      const dx = x - cx, dz = z - cz, reach = it.r * 1.8 + it.h * 0.5
      if (cheb > Math.min(1000, 150 + it.h * 5) + it.r) {
        const d = Math.hypot(dx, dz)
        if ((dx * fx + dz * fz) / d < cosHalf - (it.r * 1.8 + it.h) / d) continue
      }
      const sy = it.h * it.grow
      const c = Math.cos(it.yaw)
      const s = Math.sin(it.yaw)
      m[0] = c * it.r; m[1] = 0; m[2] = -s * it.r; m[3] = 0
      m[4] = 0; m[5] = sy; m[6] = 0; m[7] = 0
      m[8] = s * it.r; m[9] = 0; m[10] = c * it.r; m[11] = 0
      m[12] = x; m[13] = it.by; m[14] = z; m[15] = 1
      pair.put(m, 0, lodFade(dx, dz, reach, v))
    }
    pair.end()
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
  constructor(clear: (x: number, z: number, r: number) => boolean = () => true, keepOff: ((x: number, z: number, r: number) => boolean) | null = null, clutterOff: ((x: number, z: number, r: number) => boolean) | null = null) {
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
    this.deck = cloudDeck((this.sky.material as THREE.ShaderMaterial).uniforms.uCloudOff as { value: THREE.Vector2 })
    this.group.add(this.deck)
    if (BIOME === 'jungle') this.group.add(canopy(2000, 4400, this.ground, AUR_T))

    const mesaMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, flatShading: true })
    const ICE = BIOME === 'ice', LAVA = BIOME === 'lava', FOREST = BIOME === 'forest' || BIOME === 'jungle', JUNGLE = BIOME === 'jungle'
    if (ICE) { mesaMat.roughness = 0.3; patchStandard(mesaMat, { ice: true, shadow: true }) }
    else if (LAVA) { mesaMat.roughness = 0.85; patchStandard(mesaMat, { lava: true, shadow: true }) }
    else if (FOREST) { mesaMat.roughness = 0.8; mesaMat.flatShading = true; patchStandard(mesaMat, { forest: true, aur: AUR_T, shadow: true }) }
    else patchStandard(mesaMat, { strata: true, shadow: true })
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.18, metalness: 0, flatShading: true })
    patchStandard(spikeMat, { ice: true, spike: true, aur: AUR_T, shadow: true })
    this.spikeMat = spikeMat
    patchLodDither(mesaMat); patchLodDither(spikeMat)
    const r = rng(1234)
    const kinds: [Kind, number, number][] = BIOME === 'lava'
      // CINDER: cinder cones first, a few basalt massifs (the column fields read as a city skyline).
      ? [['mesa', 160, 2200], ['butte', 520, 1000], ['spire', 70, 900]]
      : JUNGLE
      // MONSOON: the canopy nearly everywhere, emergents standing over it, karst towers now and then.
      ? [['mesa', 240, 1700], ['butte', 1300, 320], ['spire', 900, 340]]
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
      for (let v = 0; v < (ICE ? ICE_VARIANTS : LAVA ? LAVA_VARIANTS : JUNGLE ? JUNGLE_VARIANTS : FOREST ? FOREST_VARIANTS : MESA_VARIANTS)[kind]; v++) {
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
        if (JUNGLE) {
          // Karst towers tall and narrow; the canopy a few hundred metres across, 70-120 m; emergents over it.
          if (kind === 'mesa') { rad *= 0.5; h *= 1.25 }
          else if (kind === 'butte') { rad *= 1.15; h = 85 + r() * 50 }
          else { rad *= 0.85; h = 120 + r() * 70 }
          const sc = 0.6 + 1.2 * Math.pow(r(), 2)
          rad *= sc; h *= 0.75 + 0.25 * sc
        } else if (FOREST) {
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
        this.group.add(w.node)
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
    patchLodDither(bMat)
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
    this.group.add(bw.node)

    // The near field everywhere, not only along the course: the same clumps of shards, lone blocks and
    // stands of trees that line the track (src/main.ts, the course's near field), dealt across a 12 km
    // tile that repeats, kept off the racing corridor. Full shapes near, simplified twins far.
    if (clutterOff) {
      const TILE = 12000
      const ws: Wrapped[] = []
      for (const kind of ['butte', 'spire'] as const) for (let v = 0; v < 3; v++) {
        const { geo, prof } = landGeometry(kind, kind.length * 31 + 7 + v * 101, v)
        // (MONSOON's mist hides it past ~3 km; elsewhere it rises from the haze by 4.5 km.)
        const far = JUNGLE ? 3200 : 4600
        ws.push(new Wrapped(geo, ICE && kind === 'spire' ? spikeMat : mesaMat, TILE, far * 0.7, 0.06, prof, false, clutterOff, far))
      }
      const GREEN = FOREST
      // (~25 items a km², the density the course's own near field has.)
      const N = JUNGLE || BIOME === 'forest' ? 900 : 700
      for (let c = 0; c < N; c++) {
        const cx = r() * TILE, cz = r() * TILE
        const zr = r()
        const zone = GREEN ? (zr < 0.75 ? 'forest' : zr < 0.9 ? 'glacier' : 'open') : zr < 0.35 ? 'forest' : zr < 0.65 ? 'glacier' : 'open'
        const n = zone === 'forest' ? 2 + Math.floor(r() * 6) : zone === 'glacier' ? 1 + Math.floor(r() * 3) : 1 + Math.floor(r() * 2)
        const spread = 50 + r() * (zone === 'forest' ? 260 : 180)
        for (let q = 0; q < n; q++) {
          const a = r() * 6.28, d = Math.sqrt(r()) * spread
          const pSpike = zone === 'forest' ? 0.75 : zone === 'glacier' ? 0.35 : 0.3
          const roll = r(), spike = roll < pSpike, sentinel = zone === 'forest' && roll > 0.94
          const sc = 0.4 + 1.6 * r()
          let rad = sentinel ? 30 + r() * 15 : spike ? 6 + r() * 8 : (12 + r() * 12) * sc
          let h = sentinel ? 120 + r() * 80 : spike ? (JUNGLE ? 110 + r() * 80 : zone === 'forest' ? 45 + r() * 95 : 20 + r() * 40) * (q === 0 ? 1 : 0.55 + r() * 0.45) : GREEN ? rad * (1.3 + r() * 0.8) : (10 + r() * 16) * sc
          if (LAVA && (spike || sentinel)) { h *= 0.3; rad *= 1.5 }
          const kind = spike || sentinel ? 1 : 0
          ws[kind * 3 + Math.floor(r() * 2.999)].items.push({ ox: (cx + Math.cos(a) * d + TILE) % TILE, oz: (cz + Math.sin(a) * d + TILE) % TILE, r: rad, h, yaw: r() * 6.28, x: 0, z: 0, by: 0, grow: 1, sink: spike || sentinel ? 0 : r() * 0.35 })
        }
      }
      for (const w of ws) { w.finish(); this.wrapped.push(w); this.group.add(w.node) }
    }

    // (The course's hour: the sun's colour and strength, from the same light as the sky.)
    this.sunLight = new THREE.DirectionalLight(new THREE.Color(LIGHT.sunCol[0], LIGHT.sunCol[1], LIGHT.sunCol[2]).multiplyScalar(1 / 2.4), 3.0 * (LIGHT.sunCol[0] + LIGHT.sunCol[1] + LIGHT.sunCol[2]) / 6.43)
    this.sunLight.position.set(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2])
    this.group.add(this.sunLight)
    this.group.add(this.sunLight.target)
    // Fill: the sky from above, the ground's bounce from below — shaded rock was pitch black with the
    // sun the only light (a mesa's far face read as a hole cut in the view).
    {
      const sky = new THREE.Color(LIGHT.zenith[0], LIGHT.zenith[1], LIGHT.zenith[2]).lerp(new THREE.Color(LIGHT.horizon[0], LIGHT.horizon[1], LIGHT.horizon[2]), 0.55)
      const ground = BIOME === 'ice' ? new THREE.Color(0.55, 0.6, 0.72) : BIOME === 'lava' ? new THREE.Color(0.3, 0.09, 0.03) : BIOME === 'forest' ? new THREE.Color(0.2, 0.28, 0.1) : BIOME === 'jungle' ? new THREE.Color(0.06, 0.1, 0.04) : new THREE.Color(0.6, 0.32, 0.16)
      const k = BIOME === 'ice' ? 0.45 : BIOME === 'lava' ? 0.6 : BIOME === 'forest' ? 0.75 : BIOME === 'jungle' ? 0.8 : 0.9
      this.hemi = new THREE.HemisphereLight(sky, ground, k)
      this.hemiK = k
      this.group.add(this.hemi)
    }
  }

  /** The real cloud layer (FREE ROAM, climbing). */
  deck!: THREE.Mesh
  /** The sky's fill light (dims in space: src/space.ts). */
  hemi!: THREE.HemisphereLight
  hemiK = 1
  /** Rocks that stand where they are put (the course's spires). */
  /** Everything the course placed (spires, trackside landforms): hidden in HUNT, where you fly the
   *  open world — from the air they were rows along a course you are not on, and they did not wrap
   *  with the world (a jump every 72 km that looked like a reset). */
  readonly courseRocks = new THREE.Group()
  private readonly statics: StaticSet[] = []
  get courseOn(): boolean { return this.courseRocks.visible }
  set courseOn(v: boolean) { this.courseRocks.visible = v }
  addFixed(list: { x: number; z: number; r: number; h: number }[]): void {
    if (!this.courseRocks.parent) this.group.add(this.courseRocks)
    const q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3()
    const mats: THREE.Matrix4[] = [], at: number[] = []
    list.forEach((o, i) => {
      const yaw = (i * 2.399) % 6.283
      const by = groundH(o.x, o.z) - 0.06 * o.h - 3
      this.fixed.push({ ...o, yaw, by, prof: this.fixedProf })
      mats.push(new THREE.Matrix4().compose(v.set(o.x, by, o.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), sc.set(o.r, o.h, o.r)))
      at.push(o.x, o.z, o.r * 1.8 + o.h * 0.5, o.h)
    })
    const set = new StaticSet(this.spireGeo!, this.mesaMat!, mats, at)
    this.statics.push(set)
    this.courseRocks.add(set.node)
  }

  /**
   * FREE ROAM rides over the landforms: the height of whatever is under (x, z) — the ground, or the
   * rock there at its true profile, with a skirt at the foot (wide at the bottom, gone at the top) so
   * a wall is a steep ramp you can drive up, not a cliff you stop against.
   */
  surfaceAt(x: number, z: number): number {
    let top = groundH(x, z)
    for (let wi = 0; wi < this.wrapped.length; wi++) {
      const w = this.wrapped[wi]
      for (const it of w.items) {
        if (it.grow < 0.5) continue
        const hh = it.h * it.grow
        // (Linear, ~1:1.1: a curved skirt was gentle at the foot and a wall at the lip — 90 m in one step.)
        const sk = Math.min(320, hh * 0.9)
        const dx = x - it.x, dz = z - it.z
        const reach = it.r * 2.3 + sk
        const d2 = dx * dx + dz * dz
        if (d2 > reach * reach) continue
        const c = Math.cos(it.yaw), s = Math.sin(it.yaw)
        const th = Math.atan2(dx * s + dz * c, dx * c - dz * s)
        const d = Math.sqrt(d2)
        const rad = (t: number) => it.r * w.prof(th, t) * 0.97 + sk * (1 - t)
        if (d >= rad(0)) continue
        let t = 1
        if (d >= rad(1)) {
          // The highest t the point is still inside (profiles narrow upward): bisect.
          let lo = 0, hi = 1
          for (let k = 0; k < 9; k++) { const m = (lo + hi) / 2; if (d < rad(m)) lo = m; else hi = m }
          t = lo
        }
        top = Math.max(top, it.by + hh * t)
      }
    }
    return top
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
    // One set per shape (see StaticSet: culled and LOD'd per item each frame).
    for (const o of list) { const k = `${o.kind}${o.v}`; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(o) }
    const shapes = new Map<string, ReturnType<typeof landGeometry>>()
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), e = new THREE.Euler()
    for (const g of groups.values()) {
      const sk = g[0].kind + g[0].v
      if (!shapes.has(sk)) shapes.set(sk, landGeometry(g[0].kind, g[0].kind.length * 31 + 7 + g[0].v * 101, g[0].v))
      const { geo, prof } = shapes.get(sk)!
      const mats: THREE.Matrix4[] = [], at: number[] = []
      g.forEach((o) => {
        // (Small blocks may lie tilted or half sunk: toppled pieces, not a row of identical boxes.)
        const by = groundH(o.x, o.z) - (0.06 + (o.sink ?? 0)) * o.h - 3
        // (Trackside shards and blocks glance you off, no crash: a wide drift must not end a race.)
        this.fixed.push({ x: o.x, z: o.z, r: o.r, h: o.h, yaw: o.yaw, by, prof, big: o.r >= 60 })
        q.setFromEuler(e.set(o.tilt ?? 0, o.yaw, (o.tilt ?? 0) * 0.6, 'YXZ'))
        mats.push(m.compose(v.set(o.x, by, o.z), q, sc.set(o.r, o.h, o.r)).clone())
        at.push(o.x, o.z, o.r * 1.8 + o.h * 0.5, o.h)
      })
      const set = new StaticSet(geo, g[0].kind === 'spire' && BIOME === 'ice' ? this.spikeMat! : this.mesaMat!, mats, at)
      this.statics.push(set)
      this.courseRocks.add(set.node)
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

  /** `vel`: the camera's velocity (motion-aware LOD, src/lod.ts). */
  update(cam: THREE.Vector3, time: number, view?: THREE.PerspectiveCamera, vel?: THREE.Vector3): void {
    this.sky.position.copy(cam)
    this.hills.position.set(cam.x, 0, cam.z)
    this.deck.position.set(cam.x, 2600, cam.z)
    const sm = this.sky.material as THREE.ShaderMaterial
    sm.uniforms.uTime.value = time
    sm.uniforms.uCloudOff.value.set(time * 14, time * 5)
    for (const r of this.rings) r.snap.value.set(Math.round(cam.x / r.step) * r.step, Math.round(cam.z / r.step) * r.step)
    let fx = 0, fz = 0, cosHalf = -2
    if (view) {
      // A horizontal cone round the look direction: half the horizontal FOV plus a margin (camera shake, banking).
      view.getWorldDirection(TMP_DIR)
      const h = Math.hypot(TMP_DIR.x, TMP_DIR.z)
      if (h > 0.3) {
        fx = TMP_DIR.x / h; fz = TMP_DIR.z / h
        const half = Math.atan(Math.tan((view.fov * Math.PI) / 360) * view.aspect)
        cosHalf = Math.cos(Math.min(Math.PI, half + 0.35))
      }
    }
    const lv = LV
    lv.cx = cam.x; lv.cz = cam.z; lv.vx = vel?.x ?? 0; lv.vz = vel?.z ?? 0
    for (const w of this.wrapped) w.update(lv, fx, fz, cosHalf)
    if (this.courseRocks.visible) for (const st of this.statics) st.update(lv, fx, fz, cosHalf)
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
