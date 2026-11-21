import { Vector4 } from 'three'

/** The course this page was loaded for (a switch is a reload): picks the light and the world. */
const COURSE_ID: string = (() => {
  try { return new URLSearchParams(location.search).get('course') ?? localStorage.getItem('dbu-course') ?? 'sprint' } catch { return 'sprint' }
})()
/** The world: the desert, or FROSTLINE's arctic plateau (docs/MAP-FROSTLINE.md). */
export type Biome = 'desert' | 'ice' | 'lava' | 'forest'
const COURSE_BIOME: Record<string, Biome> = { frostline: 'ice', icefall: 'ice', caldera: 'lava', faultline: 'lava', greenway: 'forest', riverrun: 'forest' }
/** Which world a course is in. */
export const biomeOf = (id: string): Biome => COURSE_BIOME[id] ?? 'desert'
export const BIOME: Biome = COURSE_BIOME[COURSE_ID] ?? 'desert'
/** Dust / spray colour for the particles (sand, snow, or ash). */
export const DUST: [number, number, number] = BIOME === 'ice' ? [0.8, 0.86, 0.96] : BIOME === 'lava' ? [0.32, 0.27, 0.26] : BIOME === 'forest' ? [0.52, 0.47, 0.32] : [0.8, 0.42, 0.21]
/** The GLSL define naming the world (every world shader gets it). */
const BIOME_DEF = BIOME === 'ice' ? '#ifndef BIOME_ICE\n#define BIOME_ICE\n#endif' : BIOME === 'lava' ? '#ifndef BIOME_LAVA\n#define BIOME_LAVA\n#endif' : BIOME === 'forest' ? '#ifndef BIOME_FOREST\n#define BIOME_FOREST\n#endif' : ''
// The ground, as one formula run in two places: here in JS (the craft hovers on it, rocks and mesas
// sit on it) and in GLSL (the terrain mesh is displaced by it). The two must stay identical.
//
// Every wave has an integer wave number over P, so the whole desert repeats every P metres — and
// REBASE (config.ts) is a multiple of P, so shifting the world back by REBASE changes nothing.
//
//   dunes:     six long sine swells, rotated
//   crests:    (1 - |sin|)² — a sharp-crested ridge line
//   riverbeds: a meandering zero line of a sine, carved 9 m deep with a flat bed: dry tracks
//              that run for kilometres, made for flying in

// P = REBASE (72 km): wave numbers are ~6× the old 12 km set, nudged off multiples of 6, so the
// pattern no longer repeats every 12 km (the top-down minimap made the tiling obvious: 2026-11-21).
const P = 72000
const TAU = Math.PI * 2
/** kx, kz, amplitude, phase */
const WAVES: readonly [number, number, number, number][] = [
  // Two long swells (~9 km): broad rises and hollows, so no stretch looks like the last.
  [7, 4, 3.0, 1.1],
  [-5, 9, 2.4, 2.3],
  // (Halved, 2026-11-20: at Mach speeds the full-height dunes read as a washboard.)
  [31, 11, 5.5, 0.3],
  [17, -43, 4, 1.7],
  [67, 23, 2.2, 2.9],
  [-37, 79, 1.6, 0.8],
  [101, -55, 0.9, 4.1],
  [-139, 83, 0.5, 5.5],
]

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
const k = (a: number, b: number, x: number, z: number) => (TAU * (a * x + b * z)) / P

/** How deep in a riverbed (0 none … 1 on the bed floor). */
export function riverAt(x: number, z: number): number {
  // A meandering zero line (three warps), and a mask so riverbeds come and go instead of striping
  // the whole desert at a fixed spacing.
  const c = Math.sin(k(7, 17, x, z) + 0.4 + 0.9 * Math.sin(k(23, -5, x, z) + 2.0) + 0.5 * Math.sin(k(-13, 29, x, z) + 1.0))
  const m = 0.5 + 0.5 * Math.sin(k(4, -3, x, z) + 0.7) * Math.cos(k(2, 5, x, z) + 0.2)
  // (Wide, shallow banks: steep ones were ramps at Mach 6.)
  // (FROSTLINE: about four times as wide, and more of them — frozen lakes you are on for seconds.)
  // (CINDER: lava rivers, a little wider than the desert's dry beds.)
  if (BIOME === 'lava') return (1 - smooth(0.04, 0.36, Math.abs(c))) * smooth(0.25, 0.5, m)
  // (VERDANT: rivers, a bit wider than the desert's beds.)
  if (BIOME === 'forest') return (1 - smooth(0.05, 0.4, Math.abs(c))) * smooth(0.22, 0.48, m)
  return BIOME === 'ice' ? (1 - smooth(0.1, 0.62, Math.abs(c))) * smooth(0.15, 0.4, m) : (1 - smooth(0.03, 0.3, Math.abs(c))) * smooth(0.3, 0.55, m)
}

/**
 * Mounds: Gaussian humps (x, z, height, radius) — the course's jumps. Flattened into MOUNDS (JS) and
 * mirrored into the uMounds uniform (GLSL) by setMounds(); hit at speed, their crests launch you.
 */
export const MAX_MOUNDS = 32
export const MOUNDS: number[] = []
export const MOUND_U = {
  uMounds: { value: Array.from({ length: MAX_MOUNDS }, () => new Vector4()) },
  uMoundCount: { value: 0 },
}
export function setMounds(list: number[]): void {
  MOUNDS.length = 0
  MOUNDS.push(...list.slice(0, MAX_MOUNDS * 4))
  const n = MOUNDS.length / 4
  for (let i = 0; i < MAX_MOUNDS; i++) {
    const u = MOUND_U.uMounds.value[i]
    if (i < n) { u.x = MOUNDS[i * 4]; u.y = MOUNDS[i * 4 + 1]; u.z = MOUNDS[i * 4 + 2]; u.w = MOUNDS[i * 4 + 3] }
    else { u.x = u.y = u.z = 0; u.w = 0 }
  }
  MOUND_U.uMoundCount.value = n
}

export function groundH(x: number, z: number): number {
  let h = 0
  for (let i = 0; i < MOUNDS.length; i += 4) {
    const dx = x - MOUNDS[i], dz = z - MOUNDS[i + 1], r = MOUNDS[i + 3]
    const q = (dx * dx + dz * dz) / (r * r)
    if (q < 9) h += MOUNDS[i + 2] * Math.exp(-q)
  }
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i]
    h += w[2] * Math.sin(k(w[0], w[1], x, z) + w[3])
  }
  // (Smooth crests: a kinked crest launched the craft at Mach speeds on every ridge.) Their height
  // swells and fades across the desert.
  const c = Math.cos(k(47, -19, x, z) + 1.1)
  h += 3 * c * c * c * c * (0.55 + 0.45 * Math.sin(k(5, 3, x, z) + 0.4))
  h -= 5 * riverAt(x, z)
  return h
}

const glslWaves = WAVES.map(
  (w) => `h += ${w[2].toFixed(3)} * sin(TAU * (${w[0].toFixed(1)} * p.x + ${w[1].toFixed(1)} * p.y) / PER + ${w[3].toFixed(3)});`,
).join('\n  ')

/** GLSL: groundH(vec2 xz) and riverAt(vec2 xz), the same as above. */
export const TERRAIN_GLSL = /* glsl */ `${BIOME_DEF}
#ifndef TAU
#define TAU 6.283185307
#endif
#define PER ${P.toFixed(1)}
#define KW(a, b) (TAU * ((a) * p.x + (b) * p.y) / PER)
float riverAt(vec2 p) {
  float c = sin(KW(7.0, 17.0) + 0.4 + 0.9 * sin(KW(23.0, -5.0) + 2.0) + 0.5 * sin(KW(-13.0, 29.0) + 1.0));
  float m = 0.5 + 0.5 * sin(KW(4.0, -3.0) + 0.7) * cos(KW(2.0, 5.0) + 0.2);
  #if defined(BIOME_ICE)
  return (1.0 - smoothstep(0.1, 0.62, abs(c))) * smoothstep(0.15, 0.4, m);
  #elif defined(BIOME_LAVA)
  return (1.0 - smoothstep(0.04, 0.36, abs(c))) * smoothstep(0.25, 0.5, m);
  #elif defined(BIOME_FOREST)
  return (1.0 - smoothstep(0.05, 0.4, abs(c))) * smoothstep(0.22, 0.48, m);
  #else
  return (1.0 - smoothstep(0.03, 0.3, abs(c))) * smoothstep(0.3, 0.55, m);
  #endif
}
#define MAX_MOUNDS ${MAX_MOUNDS}
uniform vec4 uMounds[MAX_MOUNDS];
uniform int uMoundCount;
float groundH(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < MAX_MOUNDS; i++) {
    if (i >= uMoundCount) break;
    vec4 m = uMounds[i];
    vec2 d = p - m.xy;
    float q = dot(d, d) / max(m.w * m.w, 1.0);
    if (q < 9.0) h += m.z * exp(-q);
  }
  ${glslWaves}
  float c = cos(KW(47.0, -19.0) + 1.1);
  h += 3.0 * c * c * c * c * (0.55 + 0.45 * sin(KW(5.0, 3.0) + 0.4));
  h -= 5.0 * riverAt(p);
  return h;
}
`

/** The sky's colours, shared by the sky dome, the fog on everything, and the env map. */
interface Light { zenith: number[]; horizon: number[]; haze: number[]; sunDir: number[]; fogK: number; sunCol: number[]; tint: number[] }
/**
 * Each course has its own hour: the light is chosen as the page loads (a course switch is a reload),
 * before any shader compiles — the sky's colours are constants in the shaders.
 */
const LIGHTS: Record<string, Light> = {
  // The Sprint: high noon.
  noon: { zenith: [0.06, 0.24, 0.72], horizon: [0.42, 0.64, 0.92], haze: [0.98, 0.82, 0.62], sunDir: [0.36, 0.78, -0.52], fogK: 0.000062, sunCol: [2.4, 2.16, 1.87], tint: [1, 1, 1] },
  // Dry River: late afternoon, warmer and lower.
  afternoon: { zenith: [0.07, 0.2, 0.6], horizon: [0.55, 0.62, 0.78], haze: [1.0, 0.72, 0.48], sunDir: [0.55, 0.45, -0.7], fogK: 0.000066, sunCol: [2.45, 1.95, 1.45], tint: [1.02, 0.92, 0.8] },
  // The Circuit: a low sun under a clear blue sky (RED MESA keeps blue skies: sunset is CINDER's).
  golden: { zenith: [0.07, 0.25, 0.7], horizon: [0.58, 0.68, 0.86], haze: [1.0, 0.74, 0.52], sunDir: [0.62, 0.3, -0.74], fogK: 0.00007, sunCol: [2.5, 2.0, 1.5], tint: [1.03, 0.94, 0.84] },
  // The Long Drag: late day, the sun low but the sky still blue.
  // Frostline: polar twilight — the sun just over the horizon, deep blue overhead, rose haze.
  // VERDANT: a clear highland morning — deep blue overhead, a pale horizon, a low warm sun.
  meadow: { zenith: [0.09, 0.28, 0.72], horizon: [0.58, 0.72, 0.88], haze: [0.92, 0.86, 0.72], sunDir: [-0.62, 0.36, 0.68], fogK: 0.000068, sunCol: [2.45, 2.15, 1.75], tint: [1.02, 1.0, 0.94] },
  // CINDER: volcanic dusk — a smoky red sky, a low bloody sun, ash haze.
  ember: { zenith: [0.02, 0.018, 0.03], horizon: [0.3, 0.12, 0.07], haze: [0.85, 0.32, 0.12], sunDir: [-0.55, 0.05, 0.84], fogK: 0.000075, sunCol: [1.7, 0.75, 0.42], tint: [1.0, 0.62, 0.5] },
  polar: { zenith: [0.006, 0.014, 0.05], horizon: [0.17, 0.21, 0.38], haze: [0.78, 0.48, 0.52], sunDir: [0.6, 0.04, -0.8], fogK: 0.00006, sunCol: [1.5, 0.95, 0.8], tint: [0.85, 0.8, 1.0] },
  // Canyon Run: dawn — cool blue-pink sky, a low sun from the east, rose light on the rock.
  dawn: { zenith: [0.07, 0.24, 0.68], horizon: [0.6, 0.7, 0.9], haze: [0.96, 0.8, 0.72], sunDir: [-0.7, 0.32, 0.65], fogK: 0.000068, sunCol: [2.4, 2.05, 1.75], tint: [1.0, 0.94, 0.9] },
  dusk: { zenith: [0.05, 0.17, 0.52], horizon: [0.55, 0.62, 0.82], haze: [0.96, 0.66, 0.48], sunDir: [-0.66, 0.24, -0.73], fogK: 0.000072, sunCol: [2.35, 1.8, 1.3], tint: [1.0, 0.9, 0.8] },
}
const COURSE_LIGHT: Record<string, string> = { sprint: 'noon', 'dry-river': 'afternoon', circuit: 'golden', drag: 'dusk', oval: 'noon', canyon: 'dawn', frostline: 'polar', icefall: 'polar', caldera: 'ember', faultline: 'ember', greenway: 'meadow', riverrun: 'meadow' }
export const LIGHT: Light = LIGHTS[COURSE_LIGHT[COURSE_ID] ?? 'noon'] ?? LIGHTS.noon
export const SKY = {
  zenith: LIGHT.zenith,
  horizon: LIGHT.horizon,
  haze: LIGHT.haze,
  sunDir: LIGHT.sunDir,
  /** Fog density: 1 - exp(-(d·k)²). */
  fogK: LIGHT.fogK,
}

const v3 = (a: number[]) => `vec3(${a.map((n) => n.toFixed(4)).join(',')})`
const sd = (() => {
  const [x, y, z] = SKY.sunDir
  const l = Math.hypot(x, y, z)
  return [x / l, y / l, z / l]
})()
export const SUN_DIR = sd

/** GLSL: skyColor(dir) and applyFog(col, worldPos). Needs cameraPosition. */
export const SKY_GLSL = /* glsl */ `${BIOME_DEF}
const vec3 SKY_ZENITH = ${v3(SKY.zenith)};
const vec3 SKY_HORIZON = ${v3(SKY.horizon)};
const vec3 SKY_HAZE = ${v3(SKY.haze)};
const vec3 SUN_DIR = ${v3(sd)};
const vec3 SUN_COL = ${v3(LIGHT.sunCol)};
const vec3 SUN_TINT = ${v3(LIGHT.tint)};
#ifdef BIOME_ICE
uniform float uAurT;
/** Aurora curtains: a bright wavy lower edge fading upward, fine vertical rays, green into magenta. */
vec3 aurora(vec3 d) {
  if (d.y < 0.05) return vec3(0.0);
  // (Every azimuth term uses a whole-number frequency: atan wraps at ±π, and any other frequency
  //  cut a hard vertical edge into the sky there.)
  float az = atan(d.x, d.z), t = uAurT * 0.05;
  vec3 acc = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    // The curtain's foot snakes across the sky, high (well clear of the land), never a ruler line.
    float base = 0.24 + fk * 0.1 + 0.06 * sin(az * (2.0 + fk) + t * (1.0 + fk * 0.6)) + 0.035 * sin(az * 5.0 - t * 1.3 + fk * 2.0) + 0.015 * sin(az * 13.0 + t * 2.1 + fk);
    float above = d.y - base;
    float curtain = smoothstep(-0.025, 0.035, above) * exp(-max(above, 0.0) * (4.5 + fk * 2.0));
    // Rays at uneven spacing: a warped phase, so they bunch and thin like real folds.
    float ph = az * 53.0 + 7.0 * sin(az * 4.0 + t + fk) + 3.0 * sin(az * 11.0 - t * 0.7);
    float rays = 0.3 + 0.7 * pow(abs(sin(ph) * sin(az * 29.0 - t + fk * 1.3 + 2.0 * sin(az * 6.0))), 0.7);
    // Curtains in a few bright folds with dark sky between, ends feathered.
    float dens = smoothstep(0.4, 0.95, 0.5 + 0.5 * sin(az * 2.0 + t * 0.7 + fk * 1.7) * sin(az * 1.0 - t * 0.45 + fk));
    vec3 col = mix(vec3(0.1, 1.0, 0.45), vec3(0.75, 0.22, 0.95), smoothstep(0.08, 0.35, above));
    acc += col * curtain * rays * dens * (1.0 - fk * 0.3);
  }
  // Dimmer, and stronger in some stretches than others (it comes and goes along the course).
  float swell = 0.55 + 0.45 * sin(cameraPosition.x * 0.00011 + 1.3) * sin(cameraPosition.z * 0.00009 + 0.4);
  return acc * 0.56 * swell * smoothstep(0.05, 0.16, d.y);
}
#endif
vec3 skyColor(vec3 d) {
  float up = clamp(d.y, -0.2, 1.0);
  float sunAmt = max(dot(d, SUN_DIR), 0.0);
  vec3 c = mix(SKY_HORIZON, SKY_ZENITH, pow(clamp(up, 0.0, 1.0), 0.55));
  // A warm haze band low in the sky, strongest toward the sun.
  float band = exp(-max(up, 0.0) * 9.0);
  c = mix(c, SKY_HAZE, band * (0.35 + 0.55 * pow(sunAmt, 3.0)));
  // Below the horizon: the far desert's dust.
  c = mix(c, SKY_HAZE * 0.92, 1.0 - smoothstep(-0.12, 0.0, up));
  return c * 1.3;
}
vec3 applyFog(vec3 col, vec3 wpos) {
  vec3 d = wpos - cameraPosition;
  float dist = length(d);
  float k = dist * ${SKY.fogK.toFixed(7)};
  float f = 1.0 - exp(-k * k);
  // Thinner up high: mesa tops stand clear of the ground haze.
  f *= mix(1.0, 0.55, smoothstep(0.0, 500.0, wpos.y));
  return mix(col, skyColor(d / max(dist, 1e-3)), clamp(f, 0.0, 1.0));
}
`
