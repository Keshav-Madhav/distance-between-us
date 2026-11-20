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

const P = 12000
const TAU = Math.PI * 2
/** kx, kz, amplitude, phase */
const WAVES: readonly [number, number, number, number][] = [
  [5, 2, 10, 0.3],
  [3, -7, 7, 1.7],
  [11, 4, 4, 2.9],
  [-6, 13, 3.2, 0.8],
  [17, -9, 2, 4.1],
  [-23, 14, 1.2, 5.5],
]

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** How deep in a riverbed (0 none … 1 on the bed floor). */
export function riverAt(x: number, z: number): number {
  const c = Math.sin((TAU * (1 * x + 3 * z)) / P + 0.4 + 0.9 * Math.sin((TAU * (4 * x - 1 * z)) / P + 2.0))
  return 1 - smooth(0.03, 0.13, Math.abs(c))
}

export function groundH(x: number, z: number): number {
  let h = 0
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i]
    h += w[2] * Math.sin((TAU * (w[0] * x + w[1] * z)) / P + w[3])
  }
  const r = 1 - Math.abs(Math.sin((TAU * (8 * x - 3 * z)) / P + 1.1))
  h += 6 * r * r
  h -= 9 * riverAt(x, z)
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
#define PER 12000.0
float riverAt(vec2 p) {
  float c = sin(TAU * (1.0 * p.x + 3.0 * p.y) / PER + 0.4 + 0.9 * sin(TAU * (4.0 * p.x - 1.0 * p.y) / PER + 2.0));
  return 1.0 - smoothstep(0.03, 0.13, abs(c));
}
float groundH(vec2 p) {
  float h = 0.0;
  ${glslWaves}
  float r = 1.0 - abs(sin(TAU * (8.0 * p.x - 3.0 * p.y) / PER + 1.1));
  h += 6.0 * r * r;
  h -= 9.0 * riverAt(p);
  return h;
}
`

/** The sky's colours, shared by the sky dome, the fog on everything, and the env map. */
export const SKY = {
  zenith: [0.06, 0.24, 0.72],
  horizon: [0.42, 0.64, 0.92],
  haze: [0.98, 0.82, 0.62],
  sunDir: [0.42, 0.52, -0.74],
  /** Fog density: 1 - exp(-(d·k)²). */
  fogK: 0.000062,
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
