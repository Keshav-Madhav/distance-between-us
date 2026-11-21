import { Vector4 } from 'three'
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
  return (1 - smooth(0.03, 0.3, Math.abs(c))) * smooth(0.3, 0.55, m)
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
export const TERRAIN_GLSL = /* glsl */ `
#ifndef TAU
#define TAU 6.283185307
#endif
#define PER ${P.toFixed(1)}
#define KW(a, b) (TAU * ((a) * p.x + (b) * p.y) / PER)
float riverAt(vec2 p) {
  float c = sin(KW(7.0, 17.0) + 0.4 + 0.9 * sin(KW(23.0, -5.0) + 2.0) + 0.5 * sin(KW(-13.0, 29.0) + 1.0));
  float m = 0.5 + 0.5 * sin(KW(4.0, -3.0) + 0.7) * cos(KW(2.0, 5.0) + 0.2);
  return (1.0 - smoothstep(0.03, 0.3, abs(c))) * smoothstep(0.3, 0.55, m);
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
  // The Circuit: golden hour — a low sun, amber haze, long shadows.
  golden: { zenith: [0.1, 0.15, 0.42], horizon: [0.9, 0.6, 0.42], haze: [1.0, 0.52, 0.28], sunDir: [0.62, 0.26, -0.74], fogK: 0.000074, sunCol: [2.5, 1.62, 0.95], tint: [1.06, 0.8, 0.6] },
  // The Long Drag: dusk — the sun on the horizon, a violet sky, the land in shadow and glow.
  dusk: { zenith: [0.05, 0.06, 0.2], horizon: [0.7, 0.38, 0.36], haze: [0.95, 0.42, 0.26], sunDir: [-0.66, 0.17, -0.73], fogK: 0.000082, sunCol: [2.1, 1.05, 0.6], tint: [1.0, 0.62, 0.5] },
}
const COURSE_LIGHT: Record<string, string> = { sprint: 'noon', 'dry-river': 'afternoon', circuit: 'golden', drag: 'dusk' }
export const LIGHT: Light = (() => {
  let id: string | null = null
  try { id = new URLSearchParams(location.search).get('course') ?? localStorage.getItem('dbu-course') } catch { /* not a browser / storage blocked */ }
  return LIGHTS[COURSE_LIGHT[id ?? 'sprint'] ?? 'noon'] ?? LIGHTS.noon
})()
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
export const SKY_GLSL = /* glsl */ `
const vec3 SKY_ZENITH = ${v3(SKY.zenith)};
const vec3 SKY_HORIZON = ${v3(SKY.horizon)};
const vec3 SKY_HAZE = ${v3(SKY.haze)};
const vec3 SUN_DIR = ${v3(sd)};
const vec3 SUN_COL = ${v3(LIGHT.sunCol)};
const vec3 SUN_TINT = ${v3(LIGHT.tint)};
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
