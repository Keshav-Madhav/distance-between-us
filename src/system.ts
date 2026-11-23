// ORBIT: the star system — a star and the five worlds as planets you can fly between and down to.
// One full-screen pass (it replaces the space pass's planet view while you are out here): every
// planet raytraced with its own world's colours, clouds and atmosphere (src/space.ts LOOKS), the star,
// the stars behind. Positions are in metres (doubles) on the CPU and handed to the shader relative to
// the camera in km, so a planet ten million km away and the ship beside you both stay precise.
import * as THREE from 'three'
import { BIOME } from './terrain'
import { FBMT_GLSL, NOISE_GLSL, NOISE_TEX } from './shaders'
import { LOOKS, PLANET_R, type PlanetBiome } from './space'
import { SKY_GLSL_SHARED } from './sky'

export interface Planet { biome: PlanetBiome; name: string; pos: THREE.Vector3 }

/** The star at the origin; the worlds round it (metres). */
/** (70,000 km: about a degree across from the worlds — a 520,000 km star was 5-10°, and its glare
 *  washed out the whole screen.) */
export const STAR_R = 70_000_000
const at = (dist: number, ang: number, y: number) => new THREE.Vector3(Math.sin(ang) * dist, y, Math.cos(ang) * dist)
export const PLANETS: Planet[] = [
  { biome: 'lava', name: 'CINDER', pos: at(3.1e9, 4.0, 1.2e8) },
  { biome: 'desert', name: 'RED MESA', pos: at(4.7e9, 0.4, -0.6e8) },
  { biome: 'forest', name: 'VERDANT', pos: at(6.4e9, 1.35, 2.0e8) },
  { biome: 'jungle', name: 'MONSOON', pos: at(8.1e9, 5.35, -1.5e8) },
  { biome: 'ice', name: 'POLAR SHELF', pos: at(10.8e9, 2.45, 0.9e8) },
]

const v4 = () => Array.from({ length: PLANETS.length }, () => new THREE.Vector4())

export class StarSystem {
  readonly mat: THREE.ShaderMaterial
  private readonly rel = new THREE.Vector3()
  constructor() {
    const g1 = v4(), g2 = v4(), atm = v4(), cl = v4()
    PLANETS.forEach((p, i) => {
      const L = LOOKS[p.biome]
      g1[i].set(L.g1[0], L.g1[1], L.g1[2], p.biome === 'lava' ? 1 : 0)
      g2[i].set(L.g2[0], L.g2[1], L.g2[2], i * 1.7 + 0.4)
      // The limb's colour from the air's scattering (blue for Rayleigh air, ochre for CINDER's dust),
      // tinted by its haze.
      const m = Math.max(...L.br)
      const lim = L.br.map((b, k) => (b / m) * 0.75 + L.mieTint[k] * 0.25)
      atm[i].set(lim[0], lim[1], lim[2], p.biome === 'jungle' ? 1.4 : p.biome === 'lava' ? 1.3 : 1)
      cl[i].set(L.cloud[0], L.cloud[1], L.cloud[2], L.cov[0])
    })
    this.mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uInvProj: { value: new THREE.Matrix4() },
        uCamRot: { value: new THREE.Matrix3() },
        uPl: { value: v4() },
        uG1: { value: g1 }, uG2: { value: g2 }, uAtm: { value: atm }, uCl: { value: cl },
        uStar: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        tNoise: { value: NOISE_TEX },
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
        ${NOISE_GLSL}
        ${FBMT_GLSL}
        #define NP ${PLANETS.length}
        uniform vec4 uPl[NP];   // centre relative to the camera (km), radius (km)
        uniform vec4 uG1[NP];   // ground colour 1, w: lava world
        uniform vec4 uG2[NP];   // ground colour 2, w: a seed
        uniform vec4 uAtm[NP];  // limb colour, w: haze
        uniform vec4 uCl[NP];   // cloud colour, w: cover threshold
        uniform vec3 uStar;     // the star (km, relative)
        uniform float uTime;
        varying vec3 vDir;
        const float STAR_R = ${(STAR_R / 1000).toFixed(1)};
        // Noise on a sphere: three projections, blended by the normal.
        float tri(vec3 n, float s, float o) {
          vec3 w = abs(n); w /= (w.x + w.y + w.z);
          float v = fbmT(n.yz * s + o) * w.x + fbmT(n.zx * s + o * 1.7) * w.y + fbmT(n.xy * s + o * 2.3) * w.z;
          // (Blending three projections averages the noise toward 0.5: the contrast restored, or the cloud
          //  cover never reached its threshold and the planets read as smooth balls.)
          return clamp((v - 0.5) * 1.9 + 0.5, 0.0, 1.0);
        }
        ${SKY_GLSL_SHARED}
        // Ray (from the camera, along d) to a sphere at c, radius r: the near distance, or −1.
        // (Closest-approach form: no |c|² − r² cancellation at ten million km.)
        float hitSphere(vec3 c, float r, vec3 d, out float miss) {
          float b = dot(c, d);
          vec3 perp = c - d * b;
          float pp = dot(perp, perp);
          miss = sqrt(pp) - r; // how far the ray passes above the surface (km), < 0 = it hits
          if (b < 0.0 || pp > r * r) return -1.0;
          return b - sqrt(r * r - pp);
        }
        vec3 planetShade(int i, vec3 d, float t, vec3 c, float r) {
          vec3 p = d * t - c;              // from the centre (km)
          vec3 n = normalize(p);
          vec3 L = normalize(uStar - d * t);
          float sd = uG2[i].w;
          // Spin (slow), and the cloud layer drifting on its own.
          float a = uTime * 0.004 + sd, ca = cos(a), sa = sin(a);
          vec3 ns = vec3(n.x * ca - n.z * sa, n.y, n.x * sa + n.z * ca);
          float b2 = uTime * 0.007 + sd * 2.0, cb = cos(b2), sb = sin(b2);
          vec3 nc = vec3(n.x * cb - n.z * sb, n.y, n.x * sb + n.z * cb);
          float h1 = tri(ns, 3.4, sd), h2 = tri(ns, 13.0, sd + 3.0), h3 = tri(ns, 46.0, sd + 7.0);
          vec3 alb = mix(uG1[i].rgb, uG2[i].rgb, smoothstep(0.35, 0.65, h1 * 0.6 + h2 * 0.4)) * (0.78 + 0.44 * h3);
          // Polar caps on the temperate worlds; the ice world is ice all over.
          alb = mix(alb, vec3(0.86, 0.9, 0.96), smoothstep(0.82, 0.9, abs(ns.y) + 0.08 * h2) * step(uG1[i].w, 0.5));
          float lit = max(dot(n, L), 0.0);
          float term = smoothstep(-0.08, 0.18, dot(n, L));
          vec3 col = alb * (lit * 1.35 + 0.006);
          // Clouds: their own layer, lit, casting nothing (a planet's worth of weather).
          float cov = smoothstep(uCl[i].w - 0.06, uCl[i].w + 0.16, tri(nc, 5.5, sd + 5.0) * 0.55 + tri(nc, 21.0, sd + 9.0) * 0.3 + tri(nc, 70.0, sd + 2.0) * 0.15);
          col = mix(col, uCl[i].rgb * (lit * 1.5 + 0.008), cov * 0.92);
          // CINDER: lava glowing through the dark side (and faintly by day).
          if (uG1[i].w > 0.5) {
            float thr = smoothstep(0.02, 0.0, abs(tri(ns, 7.0, sd + 1.0) - 0.5)) * smoothstep(0.42, 0.62, tri(ns, 2.0, sd + 4.0));
            col += vec3(2.0, 0.5, 0.06) * thr * (1.0 - cov * 0.8) * mix(1.0, 0.35, term);
          }
          // The air over the disc: thicker toward the limb, lit on the day side.
          float graze = 1.0 - max(dot(n, -d), 0.0);
          // (Some of the air over the whole disc, as a world's own view of itself from orbit shows it — the
          //  handover then morphs between two pictures of the same planet, not two planets.)
          // (The veil thins as you close on it: within a few thousand km the world's own view of itself is
          //  saturated ground under thin air, and the handover cross-faded from a pale lilac disc to it.)
          float far = smoothstep(1500.0, 15000.0, t);
          col = mix(col, uAtm[i].rgb * (term * 1.2 + 0.01), (0.05 + 0.15 * far + pow(graze, 4.0) * 0.45) * uAtm[i].w);
          return col;
        }
        void main() {
          vec3 d = normalize(vDir);
          vec3 col = vec3(0.0);
          float best = 1e30; int hit = -1;
          float misses[NP];
          for (int i = 0; i < NP; i++) {
            float m;
            float t = hitSphere(uPl[i].xyz, uPl[i].w, d, m);
            misses[i] = m;
            if (t > 0.0 && t < best) { best = t; hit = i; }
          }
          // The star.
          float sm;
          float ts = hitSphere(uStar, STAR_R, d, sm);
          float sDist = length(uStar);
          vec3 sDir = uStar / sDist;
          float ang = acos(clamp(dot(d, sDir), -1.0, 1.0));
          float sAng = asin(clamp(STAR_R / sDist, 0.0, 1.0));
          bool starFirst = ts > 0.0 && ts < best;
          if (hit >= 0 && !starFirst) {
            for (int i = 0; i < NP; i++) if (i == hit) col = planetShade(i, d, best, uPl[i].xyz, uPl[i].w);
          } else if (starFirst) {
            float mu = sqrt(max(1.0 - pow(ang / max(sAng, 1e-6), 2.0), 0.0));
            col = vec3(1.0, 0.95, 0.88) * 14.0 * (0.55 + 0.45 * mu); // limb-darkened
          } else {
            // Stars, hidden when the star is near the view (it sets the exposure).
            float glareK = smoothstep(0.6, 0.15, ang - sAng);
            col = skyBack(d) * (1.0 - 0.95 * glareK);
          }
          // The star's glare (over everything it is not hidden behind).
          if (!(hit >= 0 && !starFirst) || starFirst) {
            float k = sAng / max(ang, sAng);
            col += vec3(1.0, 0.88, 0.72) * (k * k * k * 0.9 + k * 0.012);
          }
          // Each planet's thin limb, where the ray passes just above it (not behind a nearer body).
          for (int i = 0; i < NP; i++) {
            float r = uPl[i].w, m = misses[i];
            float b = dot(uPl[i].xyz, d);
            if (m <= 0.0 || b <= 0.0 || (hit >= 0 && b > best)) continue;
            vec3 q = d * b - uPl[i].xyz;
            vec3 rn = normalize(q);
            vec3 L = normalize(uStar - d * b);
            float lit = smoothstep(-0.25, 0.3, dot(rn, L));
            float px = max(fwidth(m), 0.5);
            col += uAtm[i].rgb * exp(-m / max(r * 0.008, px * 0.6)) * lit * 0.9 * uAtm[i].w;
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  }

  /** Before rendering: the bodies relative to the camera, which is at ship (metres) + camera offset. */
  update(camera: THREE.PerspectiveCamera, eye: THREE.Vector3, time: number): void {
    const u = this.mat.uniforms
    camera.updateMatrixWorld()
    u.uInvProj.value.copy(camera.projectionMatrixInverse)
    u.uCamRot.value.setFromMatrix4(camera.matrixWorld)
    PLANETS.forEach((p, i) => {
      this.rel.subVectors(p.pos, eye).multiplyScalar(0.001)
      ;(u.uPl.value as THREE.Vector4[])[i].set(this.rel.x, this.rel.y, this.rel.z, PLANET_R / 1000)
    })
    u.uStar.value.copy(eye).multiplyScalar(-0.001)
    u.uTime.value = time
  }

  /** The nearest body to a point (metres): which, how far above its surface. */
  nearest(at: THREE.Vector3): { i: number; alt: number } {
    let i = -1, alt = at.length() - STAR_R
    PLANETS.forEach((p, k) => { const a = at.distanceTo(p.pos) - PLANET_R; if (a < alt) { alt = a; i = k } })
    return { i, alt }
  }
}
void BIOME
