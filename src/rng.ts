// The race's random numbers, seeded at every start (mulberry32): with the inputs applied per sim step
// (src/input.ts), the same inputs at the same race times replay the same run — your physics, the
// crashes, the field round you.
let s = 1
export function seedRng(seed: number): void { s = (seed >>> 0) || 1 }
export function rand(): number {
  s = (s + 0x6d2b79f5) >>> 0
  let t = s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
