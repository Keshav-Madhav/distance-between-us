// Space: everything past the flat world, drawn first (behind the game's scene) as one full-screen
// pass — the planet raytraced as a true sphere (600 km radius), its cloud shell, the atmosphere by
// single scattering (Rayleigh + Mie, per world), the stars, the Milky Way and the sun. It only runs
// once you climb (FREE ROAM flight); at ground level it is off and costs nothing.
//
// Precision: all of it is in km, relative to the point under the camera (the planet's centre is
// straight below it), so the sphere test never subtracts two 600-km numbers.
//
// The planet's surface uses the same coordinates as the ground: a point on the sphere maps back to a
// world (x, z) by the azimuthal-equidistant projection about the camera, and is coloured from the same
// rivers and noise, the clouds from the same coverage as the cloud layer — so where the flat world
// dissolves into the planet, the two agree.
import * as THREE from 'three'
import { FBMT_GLSL, NOISE_GLSL, NOISE_TEX } from './shaders'
import { SKY_GLSL_SHARED } from './sky'
import { BIOME, MOUND_U, SKY, SUN_DIR, TERRAIN_GLSL } from './terrain'

/** Earth-sized: at 10 km the horizon is nearly flat, at 150 km a gentle arc (a 600 km planet read as a toy globe). */
export const PLANET_R = 6_371_000
export const ATMO_TOP = 100_000

/** Per world: scattering (1/km), scale heights (km), Mie's forward lobe, the ground and cloud look. */
export const LOOKS = {
  desert: { amb: [0.3, 0.24, 0.2], g3: [0.3, 0.13, 0.07], br: [5.8e-3, 13.5e-3, 33.1e-3], bm: 0.03, hr: 8, hm: 1.6, g: 0.76, mieTint: [1, 0.95, 0.88], g1: [0.62, 0.32, 0.15], g2: [0.4, 0.17, 0.09], water: [0.8, 0.64, 0.45], cloud: [0.95, 0.95, 0.97], cov: [0.6, 0.86], sun: 22 },
  ice: { amb: [0.0, 0.0, 0.0], g3: [0.62, 0.74, 0.88], br: [5.8e-3, 13.5e-3, 33.1e-3], bm: 0.02, hr: 8, hm: 1.4, g: 0.76, mieTint: [1, 0.9, 0.95], g1: [0.86, 0.9, 0.97], g2: [0.55, 0.62, 0.75], water: [0.2, 0.34, 0.48], cloud: [0.95, 0.96, 1.0], cov: [0.7, 0.9], sun: 18 },
  lava: { amb: [0.75, 0.36, 0.2], g3: [0.24, 0.12, 0.08], br: [9e-3, 7e-3, 5e-3], bm: 0.05, hr: 9, hm: 2.5, g: 0.7, mieTint: [0.8, 0.5, 0.35], g1: [0.13, 0.11, 0.1], g2: [0.07, 0.05, 0.05], water: [1.8, 0.45, 0.06], cloud: [0.32, 0.27, 0.26], cov: [0.48, 0.74], sun: 16 },
  forest: { amb: [0.2, 0.25, 0.24], g3: [0.06, 0.1, 0.04], br: [5.8e-3, 13.5e-3, 33.1e-3], bm: 0.028, hr: 8, hm: 1.6, g: 0.76, mieTint: [1, 1, 0.95], g1: [0.15, 0.21, 0.08], g2: [0.25, 0.26, 0.12], water: [0.04, 0.12, 0.15], cloud: [0.96, 0.96, 0.98], cov: [0.52, 0.78], sun: 22 },
  jungle: { amb: [0.13, 0.16, 0.14], g3: [0.03, 0.07, 0.025], br: [5e-3, 11e-3, 22e-3], bm: 0.05, hr: 8, hm: 2.2, g: 0.72, mieTint: [0.8, 0.92, 0.84], g1: [0.05, 0.12, 0.04], g2: [0.09, 0.15, 0.05], water: [0.16, 0.11, 0.06], cloud: [0.62, 0.66, 0.63], cov: [0.2, 0.5], sun: 15 },
}
export type PlanetBiome = keyof typeof LOOKS
export const LOOK = LOOKS[BIOME === 'space' ? 'desert' : BIOME]

/** Cloud cover at a world (x, z) — the same layer everywhere: the sky pass's shell from orbit, the
 *  cloud deck you fly up through (src/world.ts). Needs uCloudOff, fbmT, uAlt (km, for the detail's LOD). */
const LOOK_COV = LOOK.cov
export const cloudGlsl = (alt: string) => /* glsl */ `
        float cloudAt(vec2 xz) {
          // (Warped, and mixed with a second octave at an odd scale and angle: the noise texture tiles every
          //  25 km, and from orbit the bare pattern repeated hundreds of times — stamped flecks.)
          vec2 pc = xz + uCloudOff;
          vec2 wc = vec2(fbmT(pc * 0.00009 + 1.7), fbmT(pc * 0.00009 + 5.3)) - 0.5;
          // (From hundreds of km up the fine octaves repeat hundreds of times across the view — a lace:
          //  they give way to their mean and to a larger scale.)
          float hiK = smoothstep(120.0, 700.0, ${alt});
          float base = mix(fbmT(pc * 0.00032 + wc * 2.2), 0.5, hiK) * 0.62 + mix(fbmT(mat2(0.8, -0.6, 0.6, 0.8) * pc * 0.000131 + 3.1), fbmT(mat2(0.8, -0.6, 0.6, 0.8) * pc * 0.000019 + 8.4), hiK) * 0.38;
          // Weather: large clear regions and cloud bands, not an even scatter of puffs.
          float wx = fbmT(xz * 0.000011 + 4.0) * 0.7 + fbmT(xz * 0.0000037 + 9.0) * 0.3;
          base += (wx - 0.5) * 0.45;
          // Fronts: long, curved bands of cloud (a warped ridge, thousands of km).
          float fr = 1.0 - abs(fbmT(xz * 0.0000016 + vec2(fbmT(xz * 0.0000009 + 3.3), 0.0) * 2.5 + 6.1) * 2.0 - 1.0);
          base += smoothstep(0.82, 0.97, fr) * 0.32;
          // Cyclones: one per ~1,400 km cell, a spiral of arms winding in to a clear eye.
          {
            vec2 cell = floor(xz / 1400000.0);
            vec2 ctr = (cell + 0.25 + 0.5 * vec2(fbmT(cell * 0.37 + 1.1), fbmT(cell * 0.37 + 5.9))) * 1400000.0;
            vec2 dv = xz - ctr;
            float rk = length(dv) / 1000.0;
            if (rk < 520.0 && fbmT(cell * 0.53 + 2.4) > 0.5) {
              float ang = atan(dv.y, dv.x);
              float arm = 0.5 + 0.5 * sin(ang * 2.0 + log(rk + 8.0) * 4.2 + fbmT(xz * 0.00002) * 2.0);
              float body = smoothstep(520.0, 140.0, rk) * smoothstep(12.0, 45.0, rk);
              base += (arm - 0.35) * 0.55 * body;
            }
          }
          float cov = smoothstep(${LOOK_COV[0].toFixed(2)}, ${LOOK_COV[1].toFixed(2)}, base);
          // (The fine detail fades with height: from orbit it was glitter, finer than a pixel.)
          float detail = mix(fbmT((xz + uCloudOff) * 0.0016 + 3.0), 0.55, smoothstep(25.0, 120.0, ${alt}));
          return cov * smoothstep(0.25, 0.55, detail + cov * 0.4);
        }
`
/** The star's angular radius from this world, as ORBIT draws it (its radius / this planet's distance). */
const SUN_ANG = (() => {
  const d = { lava: 3.1e9, desert: 4.7e9, forest: 6.4e9, jungle: 8.1e9, ice: 10.8e9, space: 4.7e9 }[BIOME]
  return Math.asin(7e7 / d)
})()
const v3 = (a: number[]) => `vec3(${a.map((n) => n.toFixed(5)).join(', ')})`

/** The space pass as a function of the view direction: the planet (and its clouds and aurora) or the
 *  sky, through the atmosphere. Shared: the flat world's ground blends into exactly this at its rim, so
 *  where it dissolves the two sides are the same pixels (no seam). Needs uCloudOff, uTime, tNoise,
 *  TERRAIN_GLSL (riverAt) and fbmT declared by the host. */
export const SPACE_U = { uSpAlt: { value: 0 }, uSpCamXZ: { value: new THREE.Vector2() }, uSunView: { value: 0 }, uSkyM: { value: new THREE.Matrix3() } }
export const SPACE_FN = /* glsl */ `
        uniform float uSpAlt;
        uniform vec2 uSpCamXZ;
        uniform float uSunView;
        uniform mat3 uSkyM; // this world's directions → the star system's (the shared sky)
        const float SP_R = ${(PLANET_R / 1000).toFixed(1)};
        const float SP_RA = ${((PLANET_R + ATMO_TOP) / 1000).toFixed(1)};
        const float SP_RC = SP_R + 2.6;
        const vec3 SP_SUN = ${v3(SUN_DIR)};
        const float SP_SUNANG = ${SUN_ANG.toFixed(6)}; // the star's angular radius from this world (ORBIT's size)
        // (Each world's sky is the star system's, turned into its frame: uSkyM.)
        const vec3 SP_BR = ${v3(LOOK.br.map((x) => x * 0.75))};
        const float SP_BM = ${LOOK.bm.toFixed(5)};
        const vec3 SP_MIE_T = ${v3(LOOK.mieTint)};
        const float SP_HR = ${LOOK.hr.toFixed(2)}, SP_HM = ${LOOK.hm.toFixed(2)}, SP_G = ${LOOK.g.toFixed(3)};
        // Ray from height h (km above the surface) along d: the distances to a spsphere of radius r about
        // the centre straight below (t0, t1; t1 < 0 = miss). Written without subtracting big numbers.
        vec2 spsphere(float h, vec3 d, float r) {
          float o = SP_R + h;
          float b = d.y * o;
          float c = (h - (r - SP_R)) * (o + r); // = o² − r²
          float disc = b * b - c;
          if (disc < 0.0) return vec2(-1.0);
          float s = sqrt(disc);
          return vec2(-b - s, -b + s);
        }
        float spdens(float hh, float H) { return exp(-max(hh, 0.0) / H); }
        float spheightAt(float h, vec3 d, float t) { // height above the surface at distance t along the ray
          vec3 p = vec3(0.0, SP_R + h, 0.0) + d * t;
          return length(p) - SP_R;
        }
        // Sunlight reaching a point, cheap: the air above it (one scale height's worth at its density)
        // times the air mass toward the sun (1/μ, capped at the grazing value for this planet); dark
        // in the planet's shadow. (The marched version below, per sample, was 144 density lookups a pixel.)
        vec3 spsunTransFast(vec3 p) {
          float r = length(p), hh = r - SP_R;
          float mu = dot(p / r, SP_SUN);
          // The planet's shadow, softened over its edge (a hard test stepped the twilight into bands).
          float horizonMu = -sqrt(max(1.0 - (SP_R * SP_R) / (r * r), 0.0));
          float lit = smoothstep(horizonMu - 0.012, horizonMu + 0.006, mu);
          float am = 1.0 / max(mu + 0.03, 0.035); // (grazing air mass for an Earth-sized planet: ~30)
          return lit * exp(-(SP_BR * SP_HR * spdens(hh, SP_HR) + SP_BM * 1.1 * SP_HM * spdens(hh, SP_HM)) * am);
        }
        // Optical depth from height hh toward the sun, marched (ground and cloud lighting).
        vec3 spsunTrans(vec3 p) {
          float hh = length(p) - SP_R;
          vec3 up = p / (SP_R + hh);
          float mu = dot(up, SP_SUN);
          // The ground in the way: no sun.
          float bb = mu * (SP_R + hh), cc = (SP_R + hh) * (SP_R + hh) - SP_R * SP_R;
          if (mu < 0.0 && bb * bb - cc > 0.0) return vec3(0.0);
          float L = 0.0, M = 0.0;
          // March 6 steps up to the top of the atmosphere along the sun.
          float bb2 = mu * (SP_R + hh), cc2 = (SP_R + hh) * (SP_R + hh) - SP_RA * SP_RA;
          float tTop = -bb2 + sqrt(max(bb2 * bb2 - cc2, 0.0));
          float ds = tTop / 6.0;
          for (int i = 0; i < 6; i++) {
            vec3 q = p + SP_SUN * ds * (float(i) + 0.5);
            float qh = length(q) - SP_R;
            L += spdens(qh, SP_HR) * ds; M += spdens(qh, SP_HM) * ds;
          }
          return exp(-(SP_BR * L + SP_BM * 1.1 * M));
        }
        // The ground seen from up here: world (x, z) by the azimuthal-equidistant map about the camera.
        vec2 sptoWorld(vec3 n) {
          float th = acos(clamp(n.y, -1.0, 1.0));
          vec2 dir = length(n.xz) > 1e-6 ? normalize(n.xz) : vec2(0.0);
          return uSpCamXZ + dir * th * SP_R * 1000.0;
        }
        float spLake = 0.0;
        vec3 spgroundCol(vec2 xz) {
          // Provinces at planet scale (hundreds of km, domain-warped so they never tile), then regions,
          // then texture — never one pattern repeated across the globe.
          vec2 q = xz * 0.0000012;
          vec2 wq = vec2(fbmT(q + 1.3), fbmT(q + 8.1)) - 0.5;
          float prov = fbmT(q * 1.7 + wq * 2.2 + 5.0);
          float n1 = fbmT(xz * 0.0000045 + 3.0 + wq * 3.0), n2 = fbmT(xz * 0.00003 + 7.0), n3 = fbmT(xz * 0.0002 + 1.0);
          vec3 c = mix(${v3(LOOK.g1)}, ${v3(LOOK.g2)}, smoothstep(0.35, 0.65, n1 * 0.6 + n2 * 0.4));
          // Ranges: ridged noise along warped lines — mountain chains hundreds of km long, darker rock
          // with pale crests (from orbit, the folds that give a continent its grain).
          float rg = 1.0 - abs(fbmT(xz * 0.0000028 + wq * 1.6 + 2.2) * 2.0 - 1.0);
          float range = smoothstep(0.78, 0.95, rg) * smoothstep(0.35, 0.6, fbmT(xz * 0.0000011 + 7.7));
          c = mix(c, c * 0.55, range * 0.7);
          c = mix(c, c * 1.35 + 0.04, smoothstep(0.95, 0.99, rg) * range * 0.6);
          // (VERDANT: the dark provinces read as water — so they are lakes, with shores.)
          ${BIOME === 'forest' ? 'float lake = smoothstep(0.6, 0.62, prov); spLake = lake; c = mix(c, vec3(0.025, 0.06, 0.08), lake);' : 'c = mix(c, ' + v3(LOOK.g3) + ', smoothstep(0.52, 0.7, prov) * 0.85);'}
          // (Fine texture fades with height: from orbit it aliased into a crosshatch.)
          c *= 0.8 + 0.4 * mix(n3, 0.5, smoothstep(15.0, 60.0, uSpAlt));
          // A finer octave close in, faded by its footprint (the planet next to the crisp ground was mush).
          float fineK = (1.0 - smoothstep(15000.0, 60000.0, length(xz - uSpCamXZ))) * (1.0 - smoothstep(8.0, 30.0, uSpAlt));
          c *= 1.0 + (fbmT(xz * 0.0011 + 4.0) - 0.5) * 0.45 * fineK;
          // Rivers, the same ones the ground has.
          // (Only near you: at planet scale their regular meanders read as a pattern.)
          float rv = riverAt(xz) * (1.0 - smoothstep(12000.0, 24000.0, length(xz - uSpCamXZ))) * (1.0 - smoothstep(6.0, 14.0, uSpAlt));
          c = mix(c, ${v3(LOOK.water)}, smoothstep(0.35, 0.7, rv) * 0.55);
          return c;
        }
        ${cloudGlsl('uSpAlt')}
        ${SKY_GLSL_SHARED}
        vec3 spacePixel(vec3 d) {
          float h = uSpAlt;
          vec3 o = vec3(0.0, SP_R + h, 0.0);
          vec2 gA = spsphere(h, d, SP_RA);
          vec2 gP = spsphere(h, d, SP_R);
          bool ground = gP.y > 0.0;
          float tEnd = ground ? max(gP.x, 0.0) : gA.y;
          float tStart = max(gA.x, 0.0);
          vec3 col = vec3(0.0);
          vec3 trans = vec3(1.0);
          // ── single scattering through the atmosphere ──
          if (gA.y > 0.0) {
            float mu = dot(d, SP_SUN);
            float pr = 3.0 / (16.0 * 3.14159) * (1.0 + mu * mu);
            float pm = 3.0 / (8.0 * 3.14159) * ((1.0 - SP_G * SP_G) * (1.0 + mu * mu)) / ((2.0 + SP_G * SP_G) * pow(1.0 + SP_G * SP_G - 2.0 * SP_G * mu, 1.5));
            float seg = tEnd - tStart;
            float ds = seg / 20.0;
            vec3 sr = vec3(0.0), sm = vec3(0.0);
            float oR = 0.0, oM = 0.0;
            float jit = 0.25 + 0.5 * hash12(gl_FragCoord.xy + 17.0); // (white, half-range: IGN's diagonal structure showed as hatching)
            for (int i = 0; i < 20; i++) {
              float t = tStart + ds * (float(i) + jit);
              vec3 p = o + d * t;
              float ph = length(p) - SP_R;
              float dR = spdens(ph, SP_HR) * ds, dM = spdens(ph, SP_HM) * ds;
              oR += dR; oM += dM;
              vec3 att = exp(-(SP_BR * oR + SP_BM * 1.1 * oM)) * spsunTransFast(p);
              sr += att * dR; sm += att * dM;
            }
            trans = exp(-(SP_BR * oR + SP_BM * 1.1 * oM));
            // (Over the ground the haze is greyer than the open sky: blue haze over red desert read lavender.)
            if (ground) { vec3 sR = sr * SP_BR; sr = mix(sr, vec3(dot(sR, vec3(0.33)) / max(dot(SP_BR, vec3(0.33)), 1e-6)), 0.45); }
            // (Paths that end on the ground are lighter: the full grazing haze laid over the ground turned
            //  the red desert pink and broke it away from the ground you just left.)
            col = ${LOOK.sun.toFixed(1)} * 0.6 * (ground ? mix(0.38, 1.0, smoothstep(40.0, 400.0, seg)) : 1.0) * (sr * SP_BR * pr + sm * SP_BM * SP_MIE_T * pm);
          }
          // ── what is behind the air: the ground (and clouds over it), or space ──
          vec3 back;
          if (ground) {
            vec3 p = o + d * gP.x, n = normalize(p);
            vec2 xz = sptoWorld(n);
            float sunN = max(dot(n, SP_SUN), 0.0);
            vec3 lit = spsunTrans(p * 1.0001) * ${LOOK.sun.toFixed(1)} * 0.075;
            vec3 gc = spgroundCol(xz);
            // Relief from orbit: the province and region noise as heights, its slope tilting the normal
            // (a low sun picks out plateaus and basins instead of one flat tint).
            {
              float e = 6000.0 + uSpAlt * 60.0;
              float hc = fbmT(xz * 0.0000045 + 3.0) * 0.7 + fbmT(xz * 0.00003 + 7.0) * 0.3;
              float hx = fbmT((xz + vec2(e, 0.0)) * 0.0000045 + 3.0) * 0.7 + fbmT((xz + vec2(e, 0.0)) * 0.00003 + 7.0) * 0.3;
              float hz = fbmT((xz + vec2(0.0, e)) * 0.0000045 + 3.0) * 0.7 + fbmT((xz + vec2(0.0, e)) * 0.00003 + 7.0) * 0.3;
              vec2 g = vec2(hx - hc, hz - hc) * 9.0;
              vec3 tx = normalize(cross(n, vec3(0.0, 0.0, 1.0))), tz = normalize(cross(tx, n));
              n = normalize(n - tx * g.x - tz * g.y);
              sunN = max(dot(n, SP_SUN), 0.0);
            }
            // Cloud shadows: the cover 2.6 km up, along the sun.
            float shade = 1.0 - 0.28 * cloudAt(xz + SP_SUN.xz / max(SP_SUN.y, 0.08) * 2600.0);
            // Light from the sky dome itself (twilight worlds are lit by it, not left black).
            vec3 skyL = vec3(0.55, 0.7, 1.0) * ${LOOK.sun.toFixed(1)} * ${BIOME === 'ice' ? '0.03' : '0.004'} * (0.3 + smoothstep(-0.1, 0.3, dot(n, SP_SUN)));
            // (Ice catches even a 2° sun: a grazing floor on the light — snow scatters it everywhere.)
            ${BIOME === 'ice' ? 'sunN = max(sunN, 0.22 * smoothstep(-0.05, 0.1, dot(n, SP_SUN)));' : ''}
            // Ambient: the light the ground's own shader gives it (sky fill, bounce, CINDER's lava glow) —
            // without it the planet beyond the flat world went black where the ground was lit.
            back = gc * (lit * sunN * shade + skyL + ${v3(LOOK.amb)});
            // (Snow is lit by the whole sky, not the low sun: the same cold ambient the ground's snow has.)
            ${BIOME === 'ice' ? 'back += gc * vec3(0.38, 0.44, 0.58) * 0.6;' : ''}
            // Sun glint off water, close in (rivers, lakes).
            float wet = smoothstep(0.35, 0.7, riverAt(xz)) * (1.0 - smoothstep(12000.0, 24000.0, length(xz - uSpCamXZ))) * (1.0 - smoothstep(6.0, 14.0, uSpAlt));
            back += lit * 2.0 * pow(max(dot(reflect(d, n), SP_SUN), 0.0), 120.0) * max(wet * (1.0 - smoothstep(4.0, 12.0, gP.x)), spLake);
            ${BIOME === 'lava' ? `{
              // Near you, the ground's own cracks and lava rivers; across the planet, sparse volcanic
              // centres glowing (Io), not one crack pattern tiled over the globe.
              float nearK = (1.0 - smoothstep(12000.0, 24000.0, length(xz - uSpCamXZ))) * (1.0 - smoothstep(6.0, 14.0, uSpAlt));
              back += (vec3(2.2, 0.5, 0.06) * smoothstep(0.012, 0.0, abs(fbmT(xz * 0.0004 + 2.0) - 0.5)) * 0.25 + vec3(1.6, 0.4, 0.05) * smoothstep(0.25, 0.6, riverAt(xz)) * 0.5) * nearK;
              float hot = smoothstep(0.62, 0.74, fbmT(xz * 0.0000025 + 11.0)) * smoothstep(0.45, 0.7, fbmT(xz * 0.00002 + 3.0));
              // (Regional features — what you see of the lava fields from orbit: faded in with height.)
              float orbitK = smoothstep(12.0, 45.0, uSpAlt);
              back += vec3(2.4, 0.6, 0.08) * hot * 3.0 * orbitK;
              // Lava threads at regional scale (tens of km): what you see of the lava fields from orbit.
              float thr = smoothstep(0.012, 0.0, abs(fbmT(xz * 0.000018 + 6.0) - 0.5)) * smoothstep(0.45, 0.65, fbmT(xz * 0.000006 + 2.0));
              back += vec3(2.2, 0.55, 0.07) * thr * 1.2 * orbitK;
            }` : ''}
            // The cloud shell 2.6 km up, over the ground (from above it).
            if (h > 2.6) {
              vec2 gc = spsphere(h, d, SP_RC);
              if (gc.x > 0.0) {
                vec3 pc = o + d * gc.x, nc = normalize(pc);
                float cl = cloudAt(sptoWorld(nc));
                float sc = max(dot(nc, SP_SUN), 0.0);
                vec3 ccol = ${v3(LOOK.cloud)} * (spsunTrans(pc) * ${LOOK.sun.toFixed(1)} * 0.05 * (0.35 + 0.65 * sc) + vec3(${BIOME === 'ice' ? '0.35, 0.4, 0.52' : '0.015'}));
                back = mix(back, ccol, cl * 0.95);
              }
            }
          } else {
            // (A bright sky drowns the stars: they fade with the light scattered in front of them.)
            // Day side: the sunlit world sets the exposure, and the sky is nearly black (ISS daylight).
            vec3 ds = uSkyM * d;
            // (The sun in view sets the exposure: no stars then, as in every photo.)
            // Low down, the day sets the exposure (few stars); above the air the sky is ORBIT's own, star
            // for star, dimmed the same way it is out there: only by the star's glare.
            float vacK = smoothstep(40.0, 250.0, uSpAlt);
            float sang = acos(clamp(dot(d, SP_SUN), -1.0, 1.0));
            float glareK = smoothstep(0.6, 0.15, sang - SP_SUNANG);
            float dayDim = ${Math.min(0.3, 1 - 0.96 * Math.min(1, Math.max(0, (SUN_DIR[1] + 0.05) / 0.3))).toFixed(3)} * (1.0 - 0.92 * uSunView);
            back = skyBack(ds) * mix(dayDim * exp(-dot(col, vec3(0.3, 0.5, 0.2)) * 30.0), 1.0 - 0.95 * glareK, vacK);
            // The sun's disc (and its glare is the bloom's job).
            float sd = dot(d, SP_SUN);
            vec3 sunLow = vec3(1.0, 0.96, 0.9) * (smoothstep(0.99996, 0.99999, sd) * 600.0 + pow(max(sd, 0.0), 20000.0) * 6.0 + pow(max(sd, 0.0), 2000.0) * 0.6);
            // Up there, ORBIT's star exactly: its size from here, limb-darkened, the same glare.
            float sk = SP_SUNANG / max(sang, SP_SUNANG);
            vec3 sunHi = sang < SP_SUNANG ? vec3(1.0, 0.95, 0.88) * 14.0 * (0.55 + 0.45 * sqrt(max(1.0 - pow(sang / SP_SUNANG, 2.0), 0.0))) : vec3(0.0);
            sunHi += vec3(1.0, 0.88, 0.72) * (sk * sk * sk * 0.9 + sk * 0.012);
            back += mix(sunLow, sunHi, vacK);
          }
          col += back * trans;
          // The ground's own haze, shared: the same fog the flat world uses (thinned by height the same
          // way), toward the same colour — low down both sides fade alike (CINDER's planet went black
          // under its bright stylised dusk sky); up high it thins away and the physics above rules.
          if (ground) {
            float dm = gP.x * 1000.0, hm = uSpAlt * 1000.0;
            float kf = dm * ${SKY.fogK.toFixed(7)} * exp(-max(0.5 * hm, 0.0) / 2200.0);
            float fg = 1.0 - exp(-kf * kf);
            col = mix(col, ${v3(SKY.haze.map((x) => x * 0.92 * 1.3))}, clamp(fg, 0.0, 1.0));
          }
          ${BIOME === 'ice' ? `{
            // Aurora, seen from above or beside: green curtains 100-220 km up, along wavy arcs in the
            // world below, red at their tops; marched through that shell (POLAR SHELF only).
            // The part of the ray inside the 100-220 km shell — never past the ground (marching on through
            // the planet lit curtains on its far side as green stripes on the ice).
            vec2 a0 = spsphere(h, d, SP_R + 100.0), a1 = spsphere(h, d, SP_R + 220.0);
            float tIn = max(0.0, a1.x), tOut = a1.y;
            if (h < 100.0) tIn = max(tIn, a0.y);          // from below: start where the ray leaves the lower shell
            else if (a0.x > 0.0) tOut = min(tOut, a0.x);  // from above: stop where it enters it
            if (ground) tOut = min(tOut, gP.x);
            // Only where the sky is dark enough: faded on the sunlit side.
            float night = 1.0 - smoothstep(-0.12, 0.08, dot(normalize(o + d * max(tIn, 0.0)), SP_SUN));
            if (tOut > tIn && night > 0.01) {
              float dsA = (tOut - tIn) / 16.0;
              vec3 em = vec3(0.0);
              float ja = 0.25 + 0.5 * hash12(gl_FragCoord.xy + 41.0);
              for (int i = 0; i < 16; i++) {
                vec3 pa = o + d * (tIn + dsA * (float(i) + ja));
                float ha = length(pa) - SP_R;
                if (ha < 85.0 || ha > 220.0) continue;
                float feet = smoothstep(85.0, 112.0, ha); // (soft feet: a hard 100 km cut drew a ruler line)
                vec2 wxz = sptoWorld(normalize(pa));
                float arc = sin(wxz.x * 0.000006 + 2.0 * sin(wxz.y * 0.0000045 + uTime * 0.05) + wxz.y * 0.0000025);
                float curtain = exp(-arc * arc * 30.0) * (0.5 + 0.5 * fbmT(wxz * 0.00004 + vec2(uTime * 0.02, 0.0)));
                float fold = 0.75 + 0.25 * fbmT(wxz * 0.00003 + vec2(0.0, uTime * 0.03)); // (a soft fold, not a fine sine: it beat into moiré)
                float u = (ha - 100.0) / 120.0;
                vec3 c = mix(vec3(0.15, 1.0, 0.45), vec3(0.85, 0.2, 0.55), smoothstep(0.45, 1.0, u)) * exp(-u * 2.2);
                em += c * curtain * fold * feet * dsA;
              }
              col += em * 0.006 * night;
            }
          }` : ''}
          return col;
        }
`
export class Space {
  readonly scene = new THREE.Scene()
  readonly cam = new THREE.PerspectiveCamera() // (unused by the full-screen pass; a perspective one because passes are resized)
  readonly mat: THREE.ShaderMaterial
  /** The full-screen quad (ORBIT draws the star system with it instead: src/system.ts). */
  quad!: THREE.Mesh
  /** 0 at the ground … 1 in space (the HUD, the sky dome and the flight model read it). */
  vac = 0
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uInvProj: { value: new THREE.Matrix4() },
        uCamRot: { value: new THREE.Matrix3() },
        ...SPACE_U,
        uCloudOff: { value: new THREE.Vector2() },
        uTime: { value: 0 },
        uExposure: { value: 1 },
        tNoise: { value: NOISE_TEX },
        ...MOUND_U,
      },
      vertexShader: /* glsl */ `
        uniform mat4 uInvProj;
        uniform mat3 uCamRot;
        varying vec3 vDir;
        void main() {
          vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
          vDir = uCamRot * (v.xyz / v.w);
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${TERRAIN_GLSL}
        ${NOISE_GLSL}
        ${FBMT_GLSL}
        uniform vec2 uCloudOff;
        uniform float uTime;
        uniform float uExposure;
        varying vec3 vDir;
        ${SPACE_FN}
        void main() {
          gl_FragColor = vec4(spacePixel(normalize(vDir)) * uExposure, 1.0);
        }`,
    })
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat)
    q.frustumCulled = false
    this.scene.add(q)
    this.quad = q
  }

  /** The game's sky dome, drawn over the space backdrop (fading as you climb). It lives here while you
   *  climb: in the game's scene a blended dome is drawn after the solid things and covered the ship. */
  private dome: THREE.Mesh | null = null
  addSky(sky: THREE.Mesh): void {
    const m = (sky.material as THREE.ShaderMaterial).clone()
    m.uniforms = (sky.material as THREE.ShaderMaterial).uniforms // (shared: the same clouds, the same air)
    m.transparent = true
    this.dome = new THREE.Mesh(sky.geometry, m)
    this.dome.frustumCulled = false
    this.dome.renderOrder = 1
    this.scene.add(this.dome)
  }
  /** Follow the main camera (call before rendering). */
  update(camera: THREE.PerspectiveCamera, cloudOff: THREE.Vector2, time: number, shift?: THREE.Vector2): void {
    const u = this.mat.uniforms
    camera.updateMatrixWorld()
    u.uInvProj.value.copy(camera.projectionMatrixInverse)
    u.uCamRot.value.setFromMatrix4(camera.matrixWorld)
    SPACE_U.uSpAlt.value = Math.max(0.002, camera.position.y / 1000)
    SPACE_U.uSpCamXZ.value.set(camera.position.x - (shift?.x ?? 0), camera.position.z - (shift?.y ?? 0))
    // The sun in view (or near it): 1 — the exposure is set for it.
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    SPACE_U.uSunView.value = THREE.MathUtils.smoothstep(fwd.x * SUN_DIR[0] + fwd.y * SUN_DIR[1] + fwd.z * SUN_DIR[2], 0.55, 0.85)
    u.uCloudOff.value.copy(cloudOff)
    u.uTime.value = time
    this.dome?.position.copy(camera.position)
    this.vac = THREE.MathUtils.smoothstep(camera.position.y, 20_000, 70_000)
  }
}
