// Shared shader helpers: fog patching for three's standard materials, and small noise functions.
import * as THREE from 'three'
import { SKY_GLSL, TERRAIN_GLSL } from './terrain'

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
}

/**
 * Our fog on a three material (the sky-matched, direction-coloured haze), plus optional strata.
 * The material's own fog stays off.
 */
export function patchStandard(mat: THREE.MeshStandardMaterial, opts: PatchOpts = {}): void {
  mat.fog = false
  // (three caches programs by onBeforeCompile's source text, the same for every patch: key it.)
  mat.customProgramCacheKey = () => `patched-${opts.strata ? 'strata' : 'plain'}`
  mat.onBeforeCompile = (s) => {
    if (opts.strata) { s.uniforms.tRock = TEX.tRock; s.uniforms.tSand = TEX.tSand }
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogW;\nvarying vec3 vWN;\nvarying float vBaseY;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 fw = vec4(transformed, 1.0);
        vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          fw = instanceMatrix * fw;
          wn = mat3(instanceMatrix) * wn;
        #endif
        vFogW = (modelMatrix * fw).xyz;
        vWN = normalize(mat3(modelMatrix) * wn);
        #ifdef USE_INSTANCING
          vBaseY = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y;
        #else
          vBaseY = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y;
        #endif`,
      )
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFogW;\nvarying vec3 vWN;\nvarying float vBaseY;\n${opts.strata ? 'uniform sampler2D tRock;\nuniform sampler2D tSand;' : ''}\n${SKY_GLSL}\n${NOISE_GLSL}`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vFogW);')
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
