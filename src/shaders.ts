// Shared shader helpers: fog patching for three's standard materials, and small noise functions.
import * as THREE from 'three'
import { SKY_GLSL, TERRAIN_GLSL, WORLD_FADE } from './terrain'
import { SHADOW_GLSL, SHADOW_U } from './shadow'

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`

/**
 * Baked noise: a 256² tiling fbm (four octaves of value noise, lattices 8/16/32/64 per tile), so a
 * shader reads one texel instead of hashing 16 lattice points per call. The sky did three of these
 * per pixel (48 hashes) — the single biggest cost in the frame (~1.3 ms at Retina).
 */
export const NOISE_TEX = (() => {
  const S = 256, data = new Uint8Array(S * S)
  const h = (x: number, y: number, o: number) => { const v = Math.sin(x * 127.1 + y * 311.7 + o * 74.7) * 43758.5453; return v - Math.floor(v) }
  const sm = (t: number) => t * t * (3 - 2 * t)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0, a = 0.5
    for (let o = 0; o < 4; o++) {
      const L = 8 << o, fx = (x / S) * L, fy = (y / S) * L
      const ix = Math.floor(fx), iy = Math.floor(fy), ux = sm(fx - ix), uy = sm(fy - iy)
      const x0 = ix % L, x1 = (ix + 1) % L, y0 = iy % L, y1 = (iy + 1) % L
      const n0 = h(x0, y0, o) + (h(x1, y0, o) - h(x0, y0, o)) * ux, n1 = h(x0, y1, o) + (h(x1, y1, o) - h(x0, y1, o)) * ux
      v += a * (n0 + (n1 - n0) * uy); a *= 0.5
    }
    data[y * S + x] = Math.round(Math.min(1, v) * 255)
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RedFormat, THREE.UnsignedByteType)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
  return t
})()
/** GLSL: fbmT(p) ≈ a 4-octave fbm of unit-lattice value noise (needs uniform tNoise = NOISE_TEX). */
export const FBMT_GLSL = /* glsl */ `
uniform sampler2D tNoise;
float fbmT(vec2 p) { return texture2D(tNoise, p * 0.125).r; }
`

/** The generated textures, shared by every patched material (set before shaders compile). */
export const TEX = {
  tRock: { value: null as THREE.Texture | null },
  tSand: { value: null as THREE.Texture | null },
}

export interface PatchOpts {
  /** Red-rock strata coloured by world height (mesas). */
  strata?: boolean
  /** Glacial ice (FROSTLINE's glaciers, seracs and spikes): blue, layered, snow-capped, lit from within. */
  ice?: boolean
  /** Basalt (CINDER's columns, cones and stacks): dark rock, ash on the tops, glowing splits. */
  lava?: boolean
  /** Receives the sun shadow maps (src/shadow.ts). */
  shadow?: boolean
  /** VERDANT: granite, bark and foliage by the aCrev mask; foliage sways (needs `aur` as the clock). */
  forest?: boolean
  /** With ice: the shards (spikes) — no snow cap, glowing tips that breathe with the aurora clock. */
  spike?: boolean
  /** The aurora clock uniform (world.ts AUR_T), for the spike tips. */
  aur?: { value: number }
}

/**
 * Our fog on a three material (the sky-matched, direction-coloured haze), plus optional strata.
 * The material's own fog stays off.
 */
export function patchStandard(mat: THREE.MeshStandardMaterial, opts: PatchOpts = {}): void {
  mat.fog = false
  // (three caches programs by onBeforeCompile's source text, the same for every patch: key it.)
  mat.customProgramCacheKey = () => `patched-${opts.shadow ? 'sh-' : ''}${opts.strata ? 'strata' : opts.lava ? 'lava' : opts.forest ? 'forest' : opts.ice ? (opts.spike ? 'spike' : 'ice') : 'plain'}`
  mat.onBeforeCompile = (s) => {
    if (opts.strata) { s.uniforms.tRock = TEX.tRock; s.uniforms.tSand = TEX.tSand }
    if (opts.aur) s.uniforms.uAurT = opts.aur
    if (opts.shadow) {
      Object.assign(s.uniforms, SHADOW_U)
      Object.assign(s.uniforms, WORLD_FADE)
      // (After the full patch below has declared vFogW: appended at the end of this callback.)
    }
    if (opts.forest && opts.aur) s.uniforms.uWindT = opts.aur
    if (opts.ice || opts.lava || opts.forest) {
      // The crevasse depth (a geometry attribute) and the instance's own origin (a per-glacier seed).
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aCrev;\nvarying float vCrev;\nvarying vec2 vOrg;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCrev = aCrev;
        #ifdef USE_INSTANCING
          vOrg = instanceMatrix[3].xz;
        #else
          vOrg = vec2(0.0);
        #endif`)
    }
    if (opts.forest) {
      // Foliage sways: more toward the top, each tree out of step (its position), a slow gust.
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWindT;')
        .replace('vOrg = vec2(0.0);\n        #endif', `vOrg = vec2(0.0);
        #endif
        {
          float sw = smoothstep(0.75, 1.0, aCrev) * max(transformed.y, 0.0);
          float ph = uWindT * 1.3 + vOrg.x * 0.011 + vOrg.y * 0.017 + transformed.y * 2.5;
          transformed.xz += vec2(0.85, 0.45) * (sin(ph) * 0.7 + sin(ph * 2.3) * 0.3) * 0.014 * sw * sw;
        }`)
    }
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogW;\nvarying vec3 vWN;\nvarying float vBaseY;\nvarying float vHt;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 fw = vec4(transformed, 1.0);
        vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          fw = instanceMatrix * fw;
          // Non-uniform instance scale: normals take the inverse scale (tall thin shards stay steep).
          mat3 iMx = mat3(instanceMatrix);
          wn = iMx * (wn / vec3(dot(iMx[0], iMx[0]), dot(iMx[1], iMx[1]), dot(iMx[2], iMx[2])));
        #endif
        vFogW = (modelMatrix * fw).xyz;
        vWN = normalize(mat3(modelMatrix) * wn);
        #ifdef USE_INSTANCING
          vBaseY = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y;
          vHt = max(1.0, length(instanceMatrix[1].xyz));
        #else
          vHt = 1.0;
          vBaseY = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y;
        #endif`,
      )
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFogW;\nvarying vec3 vWN;\nvarying float vBaseY;\nvarying float vHt;\nfloat gIceSnow = 0.0;\n${opts.strata ? 'uniform sampler2D tRock;\nuniform sampler2D tSand;' : ''}\n${SKY_GLSL}\n${NOISE_GLSL}`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vFogW);')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n      if (worldCut(vFogW, gl_FragCoord.xy)) discard;')
    if (opts.forest) {
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying float vCrev;\nvarying vec2 vOrg;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float hy = vFogW.y - vBaseY;
          float t = hy / vHt;
          float sd = hash12(floor(mod(vOrg, 72000.0) / 37.0));
          float fh = hash12(floor(vWN.xz * 5.0 + 40.0) + floor(vFogW.xz / 7.0) + sd * 51.0);
          vec3 c;
          if (vCrev < 0.25) {
            // Granite: pale grey, streaked, moss and grass on every gentle slope.
            c = vec3(0.52, 0.5, 0.47) * (0.8 + 0.3 * fh);
            c *= 0.85 + 0.15 * vnoise(vec2((vFogW.x + vFogW.z) * 0.02, vFogW.y * 0.004));
            c = mix(c, vec3(0.16, 0.28, 0.08), smoothstep(0.55, 0.8, vWN.y + 0.15 * vnoise(vFogW.xz * 0.03)));
          } else if (vCrev < 0.75) {
            c = vec3(0.26, 0.17, 0.11) * (0.8 + 0.3 * fh); // bark
          } else {
            // Foliage: each tree its own green (deep pine to bright leaf), facets catching light, the
            // top paler where the new growth is.
            vec3 g0 = mix(vec3(0.06, 0.16, 0.07), vec3(0.2, 0.33, 0.08), sd);
            c = g0 * (0.8 + 0.4 * fh);
            c = mix(c, c * vec3(1.35, 1.3, 0.9), smoothstep(0.6, 1.0, fract(t * 3.0)) * 0.4);
          }
          #ifdef BIOME_JUNGLE
          // MONSOON: limestone streaked dark with wet and furred with moss; black-wet bark; deep greens.
          if (vCrev < 0.25) {
            c = vec3(0.34, 0.35, 0.31) * (0.75 + 0.3 * fh) * (0.7 + 0.3 * vnoise(vec2((vFogW.x - vFogW.z) * 0.05, vFogW.y * 0.02)));
            float mossy = smoothstep(0.25, 0.65, vWN.y + 0.5 * vnoise(vFogW.xz * 0.02 + vFogW.y * 0.01));
            c = mix(c, vec3(0.05, 0.12, 0.04) * (0.8 + 0.4 * fh), mossy);
          } else if (vCrev < 0.75) c = vec3(0.1, 0.08, 0.06) * (0.8 + 0.3 * fh);
          else {
            vec3 g0 = mix(vec3(0.02, 0.07, 0.03), vec3(0.09, 0.19, 0.05), sd);
            c = g0 * (0.75 + 0.5 * fh);
            c = mix(c, c * vec3(1.4, 1.35, 0.85), smoothstep(0.55, 1.0, fh) * 0.35);
          }
          #endif
          c *= mix(0.7, 1.0, smoothstep(1.0, 18.0, hy));
          diffuseColor.rgb = c;
        }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // Sun through the leaves at grazing angles; a little sky fill so shade is green, not black.
          float rim = 1.0 - abs(dot(normalize(vViewPosition), normal));
          float leaf = smoothstep(0.75, 1.0, vCrev);
          #ifdef BIOME_JUNGLE
          totalEmissiveRadiance += diffuseColor.rgb * (0.16 + leaf * 0.18 * rim * rim);
          #else
          totalEmissiveRadiance += diffuseColor.rgb * (0.22 + leaf * 0.25 * rim * rim);
          #endif
        }`)
    }
    if (opts.lava) {
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying float vCrev;\nvarying vec2 vOrg;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float hy = vFogW.y - vBaseY;
          float t = hy / vHt;
          float sd = hash12(floor(mod(vOrg, 72000.0) / 37.0));
          // Basalt: near-black, each column face its own shade, faint cooling bands across it.
          float fh = hash12(floor(vWN.xz * 5.0 + 40.0) + floor(vFogW.xz / 9.0) + sd * 51.0);
          vec3 c = vec3(0.2, 0.18, 0.18) * (0.7 + 0.6 * fh);
          c *= 0.9 + 0.1 * sin(vFogW.y * 0.9 + vnoise(vFogW.xz * 0.05) * 6.0);
          // Rust and sulphur streaks on some faces.
          c = mix(c, vec3(0.32, 0.14, 0.06), smoothstep(0.7, 0.9, vnoise(vec2((vFogW.x + vFogW.z) * 0.03, vFogW.y * 0.01))) * 0.5);
          // Ash settles on every top and ledge.
          float ash = smoothstep(0.55, 0.8, vWN.y + 0.15 * vnoise(vFogW.xz * 0.04));
          c = mix(c, vec3(0.5, 0.46, 0.44), ash * (1.0 - vCrev));
          c *= mix(0.65, 1.0, smoothstep(1.0, 20.0, hy));
          diffuseColor.rgb = c;
        }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // Molten where the rock splits (vCrev), breathing; and the lava's red light from below.
          float pulse = 0.8 + 0.2 * sin(vFogW.x * 0.01 + vFogW.z * 0.013 + vFogW.y * 0.05);
          totalEmissiveRadiance += vec3(3.2, 0.9, 0.18) * smoothstep(0.72, 1.0, vCrev) * pulse;
          float hy2 = vFogW.y - vBaseY;
          totalEmissiveRadiance += vec3(0.3, 0.08, 0.02) * (1.0 - smoothstep(0.0, 60.0, hy2)) * (0.4 + 0.6 * (1.0 - max(vWN.y, 0.0)));
          // Fill: the glowing sky and the lava fields light the shadow side warm (no black cut-outs).
          float rim2 = 1.0 - abs(dot(normalize(vViewPosition), normal));
          totalEmissiveRadiance += diffuseColor.rgb * vec3(0.55, 0.32, 0.25) + vec3(0.12, 0.04, 0.02) * rim2 * rim2;
        }`)
    }
    if (opts.ice) {
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying float vCrev;\nvarying vec2 vOrg;\n${opts.spike ? '#define ICE_SPIKE' : ''}`)
      s.fragmentShader = s.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float hy = vFogW.y - vBaseY;
          float t = hy / vHt;
          // Each glacier its own: a seed from where it stands sets its layers' period and dip.
          float sd = hash12(floor(mod(vOrg, 72000.0) / 37.0));
          float sd2 = hash12(floor(mod(vOrg, 72000.0) / 37.0) + 17.3);
          vec2 dipDir = vec2(cos(sd * 6.28), sin(sd * 6.28));
          float yL = vFogW.y + 30.0 * vnoise(vFogW.xz * 0.006 + sd * 40.0) + dot(vFogW.xz - vOrg, dipDir) * (0.05 + 0.2 * sd2);
          vec3 deep = vec3(0.02, 0.1, 0.27), pale = vec3(0.5, 0.78, 0.96);
          float n1 = vnoise(vec2((vFogW.x + vFogW.z) * 0.015, vFogW.y * 0.012));
          vec3 c = mix(deep, pale, clamp(0.05 + 0.65 * t + 0.35 * n1 + 0.15 * (sd2 - 0.5), 0.0, 1.0));
          // Annual layers: pale bands and darker dusty ones, folded and dipping per glacier.
          float per = 8.0 + 12.0 * sd;
          float lay = fract((yL + per * 0.3 * (vnoise(vFogW.xz * 0.04 + vFogW.y * 0.02) - 0.5) * 2.0) / per);
          c = mix(c, vec3(0.86, 0.95, 1.0), smoothstep(0.82, 0.88, lay) * (1.0 - smoothstep(0.92, 0.98, lay)) * 0.6);
          c *= 1.0 - 0.3 * smoothstep(0.4, 0.45, lay) * (1.0 - smoothstep(0.49, 0.54, lay)) * (0.5 + sd2);
          // Meltwater streaks running down the faces.
          float st = vnoise(vec2((vFogW.x - vFogW.z) * 0.05, vFogW.y * 0.0025));
          c = mix(c, deep * 0.7, smoothstep(0.6, 0.86, st) * 0.55);
          c = mix(c, vec3(0.75, 0.92, 1.0), (1.0 - smoothstep(0.0, 0.1, st)) * 0.35);
          // Each facet a little lighter or darker (broken faces, not a painted tin).
          c *= 0.92 + 0.16 * hash12(floor(vWN.xz * 6.0 + 50.0) + sd * 91.0);
          // Vertical fracture planes: tall darker bands down the faces.
          float fb = vnoise(vec2((vFogW.x * 0.7 + vFogW.z) * 0.012 + sd * 13.0, vFogW.y * 0.0015));
          c *= 1.0 - 0.3 * smoothstep(0.62, 0.8, fb);
          // Crevasse slots: dark, deep blue.
          c = mix(c, deep * 0.45, smoothstep(0.15, 0.7, vCrev));
          float wob = vnoise(vFogW.xz * 0.03 + vFogW.y * 0.02);
          float snow = smoothstep(0.42, 0.68, vWN.y + 0.12 * wob);
          #ifdef ICE_SPIKE
          // Shards: snow only banked at the foot; paler, glassier toward the tips.
          // Shards: deep blue at the root to pale glassy tips, snow on up-facing ledges and banked
          // at the foot.
          // Each cluster its own ice: white-blue, grey-teal or deep cyan.
          vec3 pa = sd < 0.34 ? vec3(0.55, 0.7, 0.86) : sd < 0.67 ? vec3(0.32, 0.5, 0.56) : vec3(0.1, 0.42, 0.62);
          vec3 pb = sd < 0.34 ? vec3(0.86, 0.94, 1.0) : sd < 0.67 ? vec3(0.62, 0.78, 0.8) : vec3(0.45, 0.85, 0.98);
          c = mix(pa * 0.55, pb, smoothstep(0.05, 0.95, t)) * (0.9 + 0.2 * hash12(floor(vWN.xz * 6.0 + 50.0) + sd * 91.0));
          // Frost-white tips.
          c = mix(c, vec3(0.95, 0.98, 1.0), smoothstep(0.82, 0.98, t) * 0.8);
          snow = max(smoothstep(0.55, 0.8, vWN.y), (1.0 - smoothstep(0.03, 0.08 + 0.05 * clamp(wob, 0.0, 1.0), t)) * 0.9);
          #else
          // A cornice over the rim (dripping down the streaks), drifts banked against the foot.
          float e0 = 0.8 - 0.1 * clamp(st, 0.0, 1.0) - 0.05 * clamp(wob, 0.0, 1.0);
          snow = max(snow, smoothstep(e0, e0 + 0.06, t) * (1.0 - smoothstep(0.3, 0.8, vCrev)));
          snow = max(snow, (1.0 - smoothstep(0.05, 0.12 + 0.08 * clamp(wob, 0.0, 1.0), t)) * 0.95);
          #endif
          c *= mix(0.6, 1.0, smoothstep(2.0, 30.0, hy));
          // Pulled toward grey, so the ice sits in the lilac air instead of shouting cobalt.
          c = mix(vec3(dot(c, vec3(0.3, 0.45, 0.25))), c, 0.6);
          c = mix(c, vec3(1.15, 1.18, 1.25), snow);
          gIceSnow = snow;
          diffuseColor.rgb = c;
        }`,
      ).replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // Light through the ice: walls glow faintly blue, strongest at grazing angles.
          float sn = gIceSnow;
          float rim = 1.0 - abs(dot(normalize(vViewPosition), normal));
          totalEmissiveRadiance += (1.0 - sn) * vec3(0.03, 0.14, 0.28) * (0.6 + 0.9 * rim * rim) + sn * vec3(0.16, 0.17, 0.2);
          #ifdef ICE_SPIKE
          {
            // Tips lit from within, breathing slowly with the aurora (each cluster out of step).
            float tt = (vFogW.y - vBaseY) / vHt;
            float br = 0.65 + 0.35 * sin(uAurT * 0.6 + hash12(floor(mod(vOrg, 72000.0) / 37.0)) * 6.28);
            totalEmissiveRadiance += vec3(0.3, 0.9, 0.85) * smoothstep(0.75, 1.05, tt) * br * (0.4 + 0.8 * rim);
            // Light inside the shard, and a few facets catching it as a bright vertical streak.
            totalEmissiveRadiance += (1.0 - sn) * vec3(0.02, 0.06, 0.08) * (1.0 + rim);
            float fh = hash12(floor(vWN.xz * 6.0 + 50.0) + floor(mod(vOrg, 72000.0) / 37.0));
            totalEmissiveRadiance += (1.0 - sn) * vec3(0.55, 0.85, 1.0) * pow(fh, 8.0) * 0.9 * (0.4 + 0.6 * tt);
          }
          #endif
        }`,
      )
    }
    if (opts.strata) {
      s.fragmentShader = s.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // Generated sandstone (docs/ART_STYLE.md), mapped on the two vertical planes so the strata
          // stay level on every face; one tile is 110 m tall (mirror-wrapped vertically).
          vec3 an = abs(vWN);
          vec2 wxz = an.xz / max(an.x + an.z, 1e-3);
          float wy0 = vFogW.y + 9.0 * vnoise(vFogW.xz * 0.004);
          vec3 tx = texture2D(tRock, vec2(vFogW.z / 140.0, wy0 / 110.0)).rgb;
          vec3 tz = texture2D(tRock, vec2(vFogW.x / 140.0, wy0 / 110.0)).rgb;
          vec3 c = tx * wxz.x + tz * wxz.y;
          // A slow large-scale shift so neighbouring mesas are not the same rock.
          c *= mix(vec3(1.0), vec3(1.08, 0.86, 0.8), vnoise(vFogW.xz * 0.0007));
          // Flat tops: sand-covered cap rock.
          vec3 top = texture2D(tSand, vFogW.xz / 30.0).rgb * vec3(0.95, 0.9, 0.85);
          c = mix(c, top, smoothstep(0.7, 0.92, vWN.y));
          #ifdef BIOME_ICE
          // Ice cliffs: blue-grey rock, icy bands, snow on every flat and gentle face.
          c = vec3(dot(c, vec3(0.333))) * vec3(0.68, 0.78, 0.92) * 1.25;
          c = mix(c, vec3(0.45, 0.78, 0.95), smoothstep(0.5, 0.58, fract(wy0 / 23.0)) * (1.0 - smoothstep(0.62, 0.7, fract(wy0 / 23.0))) * 0.7);
          // Frozen runs down the faces: vertical streaks of blue ice.
          c = mix(c, vec3(0.55, 0.82, 0.98), smoothstep(0.62, 0.8, vnoise(vec2((vFogW.x + vFogW.z) * 0.08, vFogW.y * 0.004))) * 0.5);
          c = mix(c, vec3(0.9, 0.93, 1.0), smoothstep(0.35, 0.75, vWN.y));
          #endif
          // Crevices darker, ledges lighter (the texture's own light and dark, pushed), and the foot
          // of the rock in its own shade where it meets the sand.
          float lum = dot(tx * wxz.x + tz * wxz.y, vec3(0.33));
          #ifdef BIOME_ICE
          c *= 0.88 + 0.3 * smoothstep(0.08, 0.5, lum);
          #else
          c *= 0.78 + 0.5 * smoothstep(0.08, 0.5, lum);
          #endif
          c *= mix(0.55, 1.0, smoothstep(2.0, 45.0, vFogW.y - vBaseY - 4.0));
          diffuseColor.rgb = c;
        }`,
      )
    }
    if (opts.shadow) {
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>\n${SHADOW_GLSL}`)
        .replace('#include <aomap_fragment>', `{ float shd = mix(0.25, 1.0, sunShadow(vFogW)); reflectedLight.directDiffuse *= shd; reflectedLight.directSpecular *= shd; }\n#include <aomap_fragment>`)
    }
  }
}

/** Ground + sky GLSL bundle, for custom ShaderMaterials. */
export const WORLD_GLSL = `${TERRAIN_GLSL}\n${SKY_GLSL}\n${NOISE_GLSL}`

/** Just the fog amount (for additive effects that must fade, not tint, with distance). */
export const SKY_FOG_ONLY = /* glsl */ `
float fogAmount(vec3 wpos) {
  float k = length(wpos - cameraPosition) * 0.000062;
  return clamp(1.0 - exp(-k * k), 0.0, 1.0);
}
`
