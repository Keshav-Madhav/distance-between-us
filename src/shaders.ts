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
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogW;\nvarying vec3 vWN;')
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
        vWN = normalize(mat3(modelMatrix) * wn);`,
      )
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFogW;\nvarying vec3 vWN;\n${opts.strata ? 'uniform sampler2D tRock;\nuniform sampler2D tSand;' : ''}\n${SKY_GLSL}\n${NOISE_GLSL}`)
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
          diffuseColor.rgb = c;
        }`,
      )
    }
  }
}

/** Ground + sky GLSL bundle, for custom ShaderMaterials. */
export const WORLD_GLSL = `${TERRAIN_GLSL}\n${SKY_GLSL}\n${NOISE_GLSL}`
