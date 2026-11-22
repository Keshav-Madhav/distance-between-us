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
import { BIOME, MOUND_U, SUN_DIR, TERRAIN_GLSL } from './terrain'

/** Earth-sized: at 10 km the horizon is nearly flat, at 150 km a gentle arc (a 600 km planet read as a toy globe). */
export const PLANET_R = 6_371_000
export const ATMO_TOP = 100_000

/** Per world: scattering (1/km), scale heights (km), Mie's forward lobe, the ground and cloud look. */
export const LOOK = {
  desert: { g3: [0.3, 0.13, 0.07], br: [5.8e-3, 13.5e-3, 33.1e-3], bm: 0.03, hr: 8, hm: 1.6, g: 0.76, mieTint: [1, 0.95, 0.88], g1: [0.62, 0.32, 0.15], g2: [0.4, 0.17, 0.09], water: [0.8, 0.64, 0.45], cloud: [0.95, 0.95, 0.97], cov: [0.52, 0.78], sun: 22 },
  ice: { g3: [0.62, 0.74, 0.88], br: [5.8e-3, 13.5e-3, 33.1e-3], bm: 0.02, hr: 8, hm: 1.4, g: 0.76, mieTint: [1, 0.9, 0.95], g1: [0.86, 0.9, 0.97], g2: [0.55, 0.62, 0.75], water: [0.2, 0.34, 0.48], cloud: [0.95, 0.96, 1.0], cov: [0.7, 0.9], sun: 18 },
  lava: { g3: [0.24, 0.12, 0.08], br: [26e-3, 13e-3, 7e-3], bm: 0.045, hr: 9, hm: 2.5, g: 0.7, mieTint: [0.8, 0.5, 0.35], g1: [0.13, 0.11, 0.1], g2: [0.07, 0.05, 0.05], water: [1.8, 0.45, 0.06], cloud: [0.32, 0.27, 0.26], cov: [0.48, 0.74], sun: 16 },
  forest: { g3: [0.07, 0.15, 0.05], br: [5.8e-3, 13.5e-3, 33.1e-3], bm: 0.028, hr: 8, hm: 1.6, g: 0.76, mieTint: [1, 1, 0.95], g1: [0.2, 0.32, 0.1], g2: [0.33, 0.35, 0.15], water: [0.04, 0.12, 0.15], cloud: [0.96, 0.96, 0.98], cov: [0.52, 0.78], sun: 22 },
  jungle: { g3: [0.03, 0.07, 0.025], br: [5e-3, 11e-3, 22e-3], bm: 0.05, hr: 8, hm: 2.2, g: 0.72, mieTint: [0.8, 0.92, 0.84], g1: [0.05, 0.12, 0.04], g2: [0.09, 0.15, 0.05], water: [0.16, 0.11, 0.06], cloud: [0.62, 0.66, 0.63], cov: [0.3, 0.66], sun: 15 },
}[BIOME]

/** Cloud cover at a world (x, z) — the same layer everywhere: the sky pass's shell from orbit, the
 *  cloud deck you fly up through (src/world.ts). Needs uCloudOff, fbmT, uAlt (km, for the detail's LOD). */
const LOOK_COV = LOOK.cov
export const CLOUD_GLSL = /* glsl */ `
        float cloudAt(vec2 xz) {
          // (Warped, and mixed with a second octave at an odd scale and angle: the noise texture tiles every
          //  25 km, and from orbit the bare pattern repeated hundreds of times — stamped flecks.)
          vec2 pc = xz + uCloudOff;
          vec2 wc = vec2(fbmT(pc * 0.00009 + 1.7), fbmT(pc * 0.00009 + 5.3)) - 0.5;
          float base = fbmT(pc * 0.00032 + wc * 2.2) * 0.62 + fbmT(mat2(0.8, -0.6, 0.6, 0.8) * pc * 0.000131 + 3.1) * 0.38;
          // Weather: large clear regions and cloud bands, not an even scatter of puffs.
          float wx = fbmT(xz * 0.000011 + 4.0) * 0.7 + fbmT(xz * 0.0000037 + 9.0) * 0.3;
          base += (wx - 0.5) * 0.45;
          float cov = smoothstep(${LOOK_COV[0].toFixed(2)}, ${LOOK_COV[1].toFixed(2)}, base);
          // (The fine detail fades with height: from orbit it was glitter, finer than a pixel.)
          float detail = mix(fbmT((xz + uCloudOff) * 0.0016 + 3.0), 0.55, smoothstep(25.0, 120.0, uAlt));
          return cov * smoothstep(0.25, 0.55, detail + cov * 0.4);
        }
`
/** A rotation of the star field per world (each world its own sky). */
function skyRot(): string {
  const seed = { desert: 0.3, ice: 1.9, lava: 3.1, forest: 4.4, jungle: 5.6 }[BIOME]
  const m = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(seed * 1.3, seed * 2.1, seed * 0.7)))
  return m.elements.map((x) => x.toFixed(5)).join(', ')
}
const v3 = (a: number[]) => `vec3(${a.map((n) => n.toFixed(5)).join(', ')})`

export class Space {
  readonly scene = new THREE.Scene()
  readonly cam = new THREE.PerspectiveCamera() // (unused by the full-screen pass; a perspective one because passes are resized)
  readonly mat: THREE.ShaderMaterial
  /** 0 at the ground … 1 in space (the HUD, the sky dome and the flight model read it). */
  vac = 0
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uInvProj: { value: new THREE.Matrix4() },
        uCamRot: { value: new THREE.Matrix3() },
        uAlt: { value: 0 },
        uCamXZ: { value: new THREE.Vector2() },
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
        uniform float uAlt;
        uniform vec2 uCamXZ;
        uniform vec2 uCloudOff;
        uniform float uTime;
        uniform float uExposure;
        varying vec3 vDir;
        const float R = ${(PLANET_R / 1000).toFixed(1)};
        const float RA = ${((PLANET_R + ATMO_TOP) / 1000).toFixed(1)};
        const float RC = R + 2.6;
        const vec3 SUN = ${v3(SUN_DIR)};
        // Each world under its own stars.
        const mat3 SKYROT = mat3(${skyRot()});
        const vec3 BR = ${v3(LOOK.br.map((x) => x * 0.75))};
        const float BM = ${LOOK.bm.toFixed(5)};
        const vec3 MIE_T = ${v3(LOOK.mieTint)};
        const float HR = ${LOOK.hr.toFixed(2)}, HM = ${LOOK.hm.toFixed(2)}, G = ${LOOK.g.toFixed(3)};
        // Ray from height h (km above the surface) along d: the distances to a sphere of radius r about
        // the centre straight below (t0, t1; t1 < 0 = miss). Written without subtracting big numbers.
        vec2 sphere(float h, vec3 d, float r) {
          float o = R + h;
          float b = d.y * o;
          float c = (h - (r - R)) * (o + r); // = o² − r²
          float disc = b * b - c;
          if (disc < 0.0) return vec2(-1.0);
          float s = sqrt(disc);
          return vec2(-b - s, -b + s);
        }
        float dens(float hh, float H) { return exp(-max(hh, 0.0) / H); }
        float heightAt(float h, vec3 d, float t) { // height above the surface at distance t along the ray
          vec3 p = vec3(0.0, R + h, 0.0) + d * t;
          return length(p) - R;
        }
        // Sunlight reaching a point, cheap: the air above it (one scale height's worth at its density)
        // times the air mass toward the sun (1/μ, capped at the grazing value for this planet); dark
        // in the planet's shadow. (The marched version below, per sample, was 144 density lookups a pixel.)
        vec3 sunTransFast(vec3 p) {
          float r = length(p), hh = r - R;
          float mu = dot(p / r, SUN);
          // The planet's shadow, softened over its edge (a hard test stepped the twilight into bands).
          float horizonMu = -sqrt(max(1.0 - (R * R) / (r * r), 0.0));
          float lit = smoothstep(horizonMu - 0.012, horizonMu + 0.006, mu);
          float am = 1.0 / max(mu + 0.03, 0.035); // (grazing air mass for an Earth-sized planet: ~30)
          return lit * exp(-(BR * HR * dens(hh, HR) + BM * 1.1 * HM * dens(hh, HM)) * am);
        }
        // Optical depth from height hh toward the sun, marched (ground and cloud lighting).
        vec3 sunTrans(vec3 p) {
          float hh = length(p) - R;
          vec3 up = p / (R + hh);
          float mu = dot(up, SUN);
          // The ground in the way: no sun.
          float bb = mu * (R + hh), cc = (R + hh) * (R + hh) - R * R;
          if (mu < 0.0 && bb * bb - cc > 0.0) return vec3(0.0);
          float L = 0.0, M = 0.0;
          // March 6 steps up to the top of the atmosphere along the sun.
          float bb2 = mu * (R + hh), cc2 = (R + hh) * (R + hh) - RA * RA;
          float tTop = -bb2 + sqrt(max(bb2 * bb2 - cc2, 0.0));
          float ds = tTop / 6.0;
          for (int i = 0; i < 6; i++) {
            vec3 q = p + SUN * ds * (float(i) + 0.5);
            float qh = length(q) - R;
            L += dens(qh, HR) * ds; M += dens(qh, HM) * ds;
          }
          return exp(-(BR * L + BM * 1.1 * M));
        }
        // The ground seen from up here: world (x, z) by the azimuthal-equidistant map about the camera.
        vec2 toWorld(vec3 n) {
          float th = acos(clamp(n.y, -1.0, 1.0));
          vec2 dir = length(n.xz) > 1e-6 ? normalize(n.xz) : vec2(0.0);
          return uCamXZ + dir * th * R * 1000.0;
        }
        vec3 groundCol(vec2 xz) {
          // Provinces at planet scale (hundreds of km, domain-warped so they never tile), then regions,
          // then texture — never one pattern repeated across the globe.
          vec2 q = xz * 0.0000012;
          vec2 wq = vec2(fbmT(q + 1.3), fbmT(q + 8.1)) - 0.5;
          float prov = fbmT(q * 1.7 + wq * 2.2 + 5.0);
          float n1 = fbmT(xz * 0.0000045 + 3.0 + wq * 3.0), n2 = fbmT(xz * 0.00003 + 7.0), n3 = fbmT(xz * 0.0002 + 1.0);
          vec3 c = mix(${v3(LOOK.g1)}, ${v3(LOOK.g2)}, smoothstep(0.35, 0.65, n1 * 0.6 + n2 * 0.4));
          c = mix(c, ${v3(LOOK.g3)}, smoothstep(0.52, 0.7, prov) * 0.85);
          c *= 0.8 + 0.4 * n3;
          // Rivers, the same ones the ground has.
          // (Only near you: at planet scale their regular meanders read as a pattern.)
          float rv = riverAt(xz) * (1.0 - smoothstep(20000.0, 60000.0, length(xz - uCamXZ))) * (1.0 - smoothstep(8.0, 25.0, uAlt));
          c = mix(c, ${v3(LOOK.water)}, smoothstep(0.35, 0.7, rv) * 0.55);
          return c;
        }
        ${CLOUD_GLSL}
        // Stars: three layers of cells on the sphere of directions; most cells empty, the rest one star
        // each, about a pixel wide (sized by the cell's footprint on screen), brightness a steep power
        // law (a few bright, most faint), tinted by temperature.
        vec3 hash33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
        vec3 stars(vec3 d) {
          vec3 acc = vec3(0.0);
          for (int k = 0; k < 3; k++) {
            float S = k == 0 ? 120.0 : k == 1 ? 300.0 : 700.0;
            vec3 p = d * S, c = floor(p), h = hash33(c + float(k) * 17.0);
            if (h.z > (k == 0 ? 0.03 : k == 1 ? 0.035 : 0.04)) continue;
            vec3 sp = c + 0.2 + 0.6 * hash33(c + 2.7);
            float px = max(length(fwidth(p)), 1e-4);
            float w = length(p - sp) / px;
            float m = pow(hash33(c + 4.1 + float(k)).x, 9.0);
            vec3 tint = mix(vec3(1.0, 0.75, 0.55), vec3(0.7, 0.82, 1.0), hash33(c + 9.3).y);
            acc += tint * (0.04 + m) * exp(-w * w * 1.3) * (k == 0 ? 2.5 : k == 1 ? 0.9 : 0.4);
          }
          return acc;
        }
        // The Milky Way: a band along a tilted great circle, clumpy, cut by dust lanes.
        vec3 galaxy(vec3 d) {
          vec3 nG = normalize(vec3(0.35, 0.62, -0.7));
          float b = dot(d, nG);
          vec3 t = normalize(cross(nG, vec3(0.0, 0.0, 1.0)));
          vec2 uv = vec2(atan(dot(d, cross(nG, t)), dot(d, t)), b);
          float band = exp(-b * b / 0.012) + 0.35 * exp(-b * b / 0.08);
          // (Around the band, whole numbers of the noise's 8-unit tile: no seam where atan wraps.)
          float clump = fbmT(vec2(uv.x * 2.5465, uv.y * 9.0) + 1.0) * 0.7 + fbmT(vec2(uv.x * 10.186, uv.y * 30.0) + 5.0) * 0.3;
          float dust = smoothstep(0.45, 0.7, fbmT(vec2(uv.x * 6.3662, uv.y * 40.0) + 9.0)) * exp(-b * b / 0.004);
          float core = exp(-pow(abs(uv.x - 0.6), 2.0) * 1.6);
          vec3 col = mix(vec3(0.55, 0.6, 0.8), vec3(1.0, 0.85, 0.65), core);
          return col * band * (0.35 + clump) * (1.0 - 0.45 * dust) * (0.05 + 0.1 * core);
        }
        void main() {
          vec3 d = normalize(vDir);
          float h = uAlt;
          vec3 o = vec3(0.0, R + h, 0.0);
          vec2 gA = sphere(h, d, RA);
          vec2 gP = sphere(h, d, R);
          bool ground = gP.y > 0.0;
          float tEnd = ground ? max(gP.x, 0.0) : gA.y;
          float tStart = max(gA.x, 0.0);
          vec3 col = vec3(0.0);
          vec3 trans = vec3(1.0);
          // ── single scattering through the atmosphere ──
          if (gA.y > 0.0) {
            float mu = dot(d, SUN);
            float pr = 3.0 / (16.0 * 3.14159) * (1.0 + mu * mu);
            float pm = 3.0 / (8.0 * 3.14159) * ((1.0 - G * G) * (1.0 + mu * mu)) / ((2.0 + G * G) * pow(1.0 + G * G - 2.0 * G * mu, 1.5));
            float seg = tEnd - tStart;
            float ds = seg / 20.0;
            vec3 sr = vec3(0.0), sm = vec3(0.0);
            float oR = 0.0, oM = 0.0;
            float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            for (int i = 0; i < 20; i++) {
              float t = tStart + ds * (float(i) + jit);
              vec3 p = o + d * t;
              float ph = length(p) - R;
              float dR = dens(ph, HR) * ds, dM = dens(ph, HM) * ds;
              oR += dR; oM += dM;
              vec3 att = exp(-(BR * oR + BM * 1.1 * oM)) * sunTransFast(p);
              sr += att * dR; sm += att * dM;
            }
            trans = exp(-(BR * oR + BM * 1.1 * oM));
            // (Paths that end on the ground are lighter: the full grazing haze laid over the ground turned
            //  the red desert pink and broke it away from the ground you just left.)
            col = ${LOOK.sun.toFixed(1)} * 0.6 * (ground ? 0.38 : 1.0) * (sr * BR * pr + sm * BM * MIE_T * pm);
          }
          // ── what is behind the air: the ground (and clouds over it), or space ──
          vec3 back;
          if (ground) {
            vec3 p = o + d * gP.x, n = normalize(p);
            vec2 xz = toWorld(n);
            float sunN = max(dot(n, SUN), 0.0);
            vec3 lit = sunTrans(p * 1.0001) * ${LOOK.sun.toFixed(1)} * 0.075;
            vec3 gc = groundCol(xz);
            // Cloud shadows: the cover 2.6 km up, along the sun.
            float shade = 1.0 - 0.55 * cloudAt(xz + SUN.xz / max(SUN.y, 0.08) * 2600.0);
            // Light from the sky dome itself (twilight worlds are lit by it, not left black).
            vec3 skyL = vec3(0.55, 0.7, 1.0) * ${LOOK.sun.toFixed(1)} * ${BIOME === 'ice' ? '0.014' : '0.004'} * (0.3 + smoothstep(-0.1, 0.3, dot(n, SUN)));
            back = gc * (lit * sunN * shade + skyL);
            // Sun glint off water, close in (rivers, lakes).
            float wet = smoothstep(0.35, 0.7, riverAt(xz)) * (1.0 - smoothstep(20000.0, 60000.0, length(xz - uCamXZ))) * (1.0 - smoothstep(8.0, 25.0, uAlt));
            back += lit * 2.0 * pow(max(dot(reflect(d, n), SUN), 0.0), 120.0) * wet;
            ${BIOME === 'lava' ? `{
              // Near you, the ground's own cracks and lava rivers; across the planet, sparse volcanic
              // centres glowing (Io), not one crack pattern tiled over the globe.
              float nearK = (1.0 - smoothstep(20000.0, 60000.0, length(xz - uCamXZ))) * (1.0 - smoothstep(8.0, 25.0, uAlt));
              back += (vec3(2.2, 0.5, 0.06) * smoothstep(0.012, 0.0, abs(fbmT(xz * 0.0004 + 2.0) - 0.5)) * 0.25 + vec3(1.6, 0.4, 0.05) * smoothstep(0.25, 0.6, riverAt(xz)) * 0.5) * nearK;
              float hot = smoothstep(0.62, 0.74, fbmT(xz * 0.0000025 + 11.0)) * smoothstep(0.45, 0.7, fbmT(xz * 0.00002 + 3.0));
              back += vec3(2.4, 0.6, 0.08) * hot * 3.0;
            }` : ''}
            // The cloud shell 2.6 km up, over the ground (from above it).
            if (h > 2.6) {
              vec2 gc = sphere(h, d, RC);
              if (gc.x > 0.0) {
                vec3 pc = o + d * gc.x, nc = normalize(pc);
                float cl = cloudAt(toWorld(nc));
                float sc = max(dot(nc, SUN), 0.0);
                vec3 ccol = ${v3(LOOK.cloud)} * (sunTrans(pc) * ${LOOK.sun.toFixed(1)} * 0.05 * (0.35 + 0.65 * sc) + vec3(0.015));
                back = mix(back, ccol, cl * 0.95);
              }
            }
          } else {
            // (A bright sky drowns the stars: they fade with the light scattered in front of them.)
            // Day side: the sunlit world sets the exposure, and the sky is nearly black (ISS daylight).
            vec3 ds = SKYROT * d;
            back = (stars(ds) + galaxy(ds)) * exp(-dot(col, vec3(0.3, 0.5, 0.2)) * 30.0) * ${(1 - 0.85 * Math.min(1, Math.max(0, (SUN_DIR[1] + 0.05) / 0.3))).toFixed(3)};
            // The sun's disc (and its glare is the bloom's job).
            float sd = dot(d, SUN);
            back += vec3(1.0, 0.96, 0.9) * (smoothstep(0.99996, 0.99999, sd) * 400.0 + pow(max(sd, 0.0), 2000.0) * 8.0);
          }
          col += back * trans;
          ${BIOME === 'ice' ? `{
            // Aurora, seen from above or beside: green curtains 100-220 km up, along wavy arcs in the
            // world below, red at their tops; marched through that shell (POLAR SHELF only).
            vec2 a0 = sphere(h, d, R + 100.0), a1 = sphere(h, d, R + 220.0);
            float t0 = a0.y > 0.0 && a0.x > 0.0 ? 0.0 : 0.0;
            float tIn = max(0.0, a1.x), tOut = a1.y;
            if (tOut > 0.0) {
              // Skip the inside of the lower shell (below the curtains' feet).
              if (a0.x > 0.0) tOut = min(tOut, a0.x);
              float dsA = (tOut - tIn) / 16.0;
              vec3 em = vec3(0.0);
              float ja = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
              for (int i = 0; i < 16; i++) {
                vec3 pa = o + d * (tIn + dsA * (float(i) + ja));
                float ha = length(pa) - R;
                if (ha < 100.0 || ha > 220.0) continue;
                vec2 wxz = toWorld(normalize(pa));
                float arc = sin(wxz.x * 0.000006 + 2.0 * sin(wxz.y * 0.0000045 + uTime * 0.05) + wxz.y * 0.0000025);
                float curtain = exp(-arc * arc * 30.0) * (0.5 + 0.5 * fbmT(wxz * 0.00004 + vec2(uTime * 0.02, 0.0)));
                float fold = 0.6 + 0.4 * sin(wxz.x * 0.00008 + wxz.y * 0.00005 + uTime * 0.3);
                float u = (ha - 100.0) / 120.0;
                vec3 c = mix(vec3(0.15, 1.0, 0.45), vec3(0.85, 0.2, 0.55), smoothstep(0.45, 1.0, u)) * exp(-u * 2.2);
                em += c * curtain * fold * dsA;
              }
              col += em * 0.009;
              t0 += 0.0;
            }
          }` : ''}
          gl_FragColor = vec4(col * uExposure, 1.0);
        }`,
    })
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat)
    q.frustumCulled = false
    this.scene.add(q)
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
  update(camera: THREE.PerspectiveCamera, cloudOff: THREE.Vector2, time: number): void {
    const u = this.mat.uniforms
    camera.updateMatrixWorld()
    u.uInvProj.value.copy(camera.projectionMatrixInverse)
    u.uCamRot.value.setFromMatrix4(camera.matrixWorld)
    u.uAlt.value = Math.max(0.002, camera.position.y / 1000)
    u.uCamXZ.value.set(camera.position.x, camera.position.z)
    u.uCloudOff.value.copy(cloudOff)
    u.uTime.value = time
    this.dome?.position.copy(camera.position)
    this.vac = THREE.MathUtils.smoothstep(camera.position.y, 20_000, 70_000)
  }
}
