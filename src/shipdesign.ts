// The hover-racer's shape, as lofts (shipgeo.ts). Forward is +z, up +y; built for the right side
// (+x) and mirrored. Three silhouettes:
//   0 ARROW  — the standard: a slim fuselage, two engine pods on swept wings, twin canted tail fins
//   1 BRUTE  — wide and heavy: fat pods set further out, a broad fuselage, tall fins
//   2 NEEDLE — long and thin: a stretched nose with canards, slim pods, one tall dorsal fin
// Materials by key: paint (body colour), trim (team colour), carbon (dark), glass, metal, neon
// (team-colour light), glow (cyan light), hot (nozzle cores).
import * as THREE from 'three'
import { loft, mirrorX, nacelle, sample, X, Y, Z, type Key } from './shipgeo'

export type Parts = Map<string, THREE.BufferGeometry[]>

export interface ShipSpec {
  /** Outer nozzles (x, y) at NOZZLE_Z, centre one at (0, y). */
  nozzles: [number, number][]
  nozzleZ: number
  wingtip: [number, number, number]
  /** Where the racing numbers sit (right side; mirrored). */
  number: { pos: [number, number, number]; rotY: number; tilt: number; size: number }
}

const K = (s: number, c: [number, number, number], a: number, t: number, b: number, n = 2.6): Key => ({ s, c, a, t, b, n })

const PI = Math.PI

/** A rounded tip: one more key just past the last, shorter and much thinner (a flat cut read as a
 *  sawn-off plank end). */
function roundTip(keys: Key[], d = 0.08): Key[] {
  const a = keys[keys.length - 2], b = keys[keys.length - 1]
  const ds = b.s - a.s || 1
  const k = (d * (Math.abs(ds) || 1)) / Math.abs(ds)
  const dir = [(b.c[0] - a.c[0]) / ds, (b.c[1] - a.c[1]) / ds, (b.c[2] - a.c[2]) / ds]
  const s2 = b.s + ds * k
  return [...keys, { s: s2, c: [b.c[0] + dir[0] * ds * k, b.c[1] + dir[1] * ds * k, b.c[2] + dir[2] * ds * k], a: b.a * 0.72, t: b.t * 0.3, b: b.b * 0.3, n: b.n }]
}

export function buildShip(variant: number, hi: boolean): { parts: Parts; spec: ShipSpec } {
  const parts: Parts = new Map()
  const put = (key: string, g: THREE.BufferGeometry, mirror = false) => {
    if (!parts.has(key)) parts.set(key, [])
    parts.get(key)!.push(g)
    if (mirror) parts.get(key)!.push(mirrorX(g))
  }
  // (Hi detail: dense surfaces — every loft ~2× the rings and points it had.)
  // (×3 since 2026-11-23: smoother curves, no facets on the pods and spine close up.)
  const R = hi ? 3 : 0.35
  const ring = (n: number) => Math.max(4, Math.round(n * R))

  /** A racing stripe: a band on a loft's skin whose centre angle sweeps from thA (at s0) to thB (at s1),
   *  width w (radians), tapering to points at both ends, a hair proud of the paint. */
  const swoosh = (keys: Key[], key: string, s0: number, s1: number, thA: number, thB: number, w: number, mirror: boolean) => {
    const N = ring(30), M = 4
    const pos: number[] = [], idx: number[] = []
    for (let r = 0; r <= N; r++) {
      const u = r / N, k = sample(keys, s0 + (s1 - s0) * u)
      const e = 2 / k.n, thc = thA + (thB - thA) * (u * u * (3 - 2 * u)), ww = w * Math.pow(Math.sin(PI * u), 0.5)
      for (let j = 0; j <= M; j++) {
        const th = thc - ww / 2 + (ww * j) / M, ca = Math.cos(th), sa = Math.sin(th)
        const x = k.a * 1.012 * Math.sign(ca) * Math.pow(Math.abs(ca), e), y = (sa >= 0 ? k.t : k.b) * 1.012 * Math.sign(sa) * Math.pow(Math.abs(sa), e)
        pos.push(k.c[0] + x, k.c[1] + y, k.c[2])
      }
    }
    for (let r = 0; r < N; r++) for (let j = 0; j < M; j++) { const a = r * (M + 1) + j, b = a + 1, c = a + M + 1, d = c + 1; idx.push(a, c, b, b, c, d) }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals()
    put(key, g, mirror)
  }

  const v = variant
  const brute = v === 1, needle = v === 2
  // Proportions per silhouette.
  const podX = brute ? 2.2 : needle ? 1.75 : 1.95
  // (Slimmed: "some ships still feel weirdly bulky" — 2026-11-21.)
  const podW = brute ? 0.58 : needle ? 0.41 : 0.5
  const podH = brute ? 0.55 : needle ? 0.43 : 0.5
  const bodyW = brute ? 1.16 : needle ? 0.92 : 1.06
  const nose = needle ? 7.4 : brute ? 5.6 : 6.3
  const tailZ = -4.45
  const NY = 0.36 // nozzle line height
  const CY = 0.5, CR = 0.36 // centre nozzle
  const PR = podW * 0.8 // pod nozzle radius

  // ── fuselage ── (s = z, tail → nose)
  const fus: Key[] = [
    // (The tail necks onto the centre nozzle's lip: a round section matching it, no open gap.)
    K(tailZ, [0, CY, tailZ], CR + 0.03, CR + 0.03, CR + 0.03, 2),
    K(tailZ + 0.4, [0, 0.48, tailZ + 0.4], brute ? bodyW * 0.56 : 0.58, brute ? 0.55 : 0.44, 0.36, 3),
    K(-3.3, [0, 0.46, -3.3], bodyW * 0.82, 0.62, 0.38, 3.2),
    K(-1.2, [0, 0.42, -1.2], bodyW, 0.8, 0.4, 3.4),
    K(0.9, [0, 0.38, 0.9], bodyW * 0.94, 0.74, 0.38, 3.2),
    K(2.9, [0, 0.3, 2.9], bodyW * 0.7, 0.5, 0.32, 2.8),
    K(nose - 1.6, [0, 0.2, nose - 1.6], bodyW * 0.38, 0.27, 0.22, 2.4),
    K(nose, [0, 0.12, nose], 0.03, 0.03, 0.03, 2),
  ]
  const F = { A: X, B: Y, rings: ring(44), around: ring(18), capStart: !hi }
  // Livery split by section angle: paint shoulders, a trim stripe down the spine, a carbon belly.
  put('paint', loft(fus, { ...F, th0: 0, th1: PI / 2 - 0.13 }))
  put('trim', loft(fus, { ...F, th0: PI / 2 - 0.13, th1: PI / 2 + 0.13, around: ring(3) }))
  put('paint', loft(fus, { ...F, th0: PI / 2 + 0.13, th1: PI }))
  put('carbon', loft(fus, { ...F, th0: PI, th1: 2 * PI }))

  // ── canopy ── a bubble on the spine, framed at its sills
  const cz = needle ? 2.2 : 1.6
  const can: Key[] = [
    K(cz - 2.3, [0, 0.96, cz - 2.3], 0.06, 0.04, 0.02, 2),
    K(cz - 1.4, [0, 1.0, cz - 1.4], 0.46, 0.46, 0.3, 2.2),
    K(cz, [0, 0.98, cz], 0.52, 0.52, 0.3, 2.3),
    K(cz + 1.25, [0, 0.76, cz + 1.25], 0.34, 0.36, 0.08, 2.2),
    K(cz + 1.8, [0, 0.66, cz + 1.8], 0.04, 0.03, 0.02, 2),
  ]
  const C = { A: X, B: Y, rings: ring(28), around: ring(12) }
  put('glass', loft(can, { ...C, th0: 0.32, th1: PI - 0.32 }))
  put('carbon', loft(can, { ...C, th0: 0, th1: 0.32, around: ring(3) }))
  put('carbon', loft(can, { ...C, th0: PI - 0.32, th1: PI, around: ring(3) }))
  // The cockpit tub: the dome's lower half, dark, sunk into the spine (the glass showed paint before).
  put('carbon', loft(can, { ...C, th0: PI, th1: 2 * PI }))

  // ── engine pods ── (right side, mirrored): pointed nose, fat round tail around the nozzle
  const pz0 = needle ? 2.6 : brute ? 2.0 : 2.4
  const pod: Key[] = [
    K(tailZ, [podX, NY, tailZ], PR + 0.03, PR + 0.03, PR + 0.03, 2),
    K(-4.0, [podX, NY, -4.0], podW * 0.95, podH * 0.95, podH * 0.92, 2.1),
    K(-3.4, [podX, NY + 0.02, -3.4], podW * 1.05, podH, podH * 0.92, 2.3),
    K(-0.9, [podX + 0.03, NY, -0.9], podW, podH * 0.92, podH * 0.78, 2.7),
    K(1.2, [podX - 0.03, NY - 0.02, 1.2], podW * 0.84, podH * 0.8, podH * 0.66, 2.5),
    // (A jet intake at the front, not a missile point.)
    K(pz0, [podX - 0.06, NY - 0.04, pz0], podW * 0.7, podH * 0.63, podH * 0.63, 2.2),
  ]
  // (Low detail: closed at both ends — the far field must not be see-through tubes.)
  const P = { A: X, B: Y, rings: ring(36), around: ring(12), capStart: !hi, capEnd: !hi }
  put('paint', loft(pod, { ...P, th0: 0.22, th1: PI }), true)
  put('neon', loft(pod, { ...P, th0: 0.12, th1: 0.22, around: 1 }), true)
  put('trim', loft(pod, { ...P, th0: -0.25, th1: 0.12, around: ring(3) }), true)
  put('carbon', loft(pod, { ...P, th0: PI, th1: 2 * PI - 0.25 }), true)

  // ── wings ── inner (body → pod) and outer (pod → tip, swept and drooped)
  const inner: Key[] = [
    K(0.5, [0.5, 0.36, -1.0], 2.0, 0.11, 0.07, 2),
    K(podX - 0.2, [podX - 0.2, NY, -1.5], 1.55, 0.09, 0.06, 2),
  ]
  // Airfoil sections (round leading edge, sharp trailing edge); a team-colour band along the leading edge.
  const W = { A: Z, B: Y, rings: ring(6), foil: true }
  put('trim', loft(inner, { ...W, around: ring(6), th0: -0.42, th1: 0.42 }), true)
  put('paint', loft(inner, { ...W, around: ring(14), th0: 0.42, th1: 2.3 }), true)
  put('paint', loft(inner, { ...W, around: ring(14), th0: -2.3, th1: -0.42 }), true)
  put('carbon', loft(inner, { ...W, around: ring(6), th0: 2.3, th1: 2 * PI - 2.3 }), true)
  const tipX = podX + (brute ? 1.45 : needle ? 1.3 : 1.7)
  const outer: Key[] = [
    K(podX + 0.3, [podX + 0.3, NY - 0.04, -2.3], 1.15, 0.08, 0.05, 2),
    K(tipX, [tipX, NY - 0.22, -3.5], 0.6, 0.05, 0.04, 2),
  ]
  const outerR = roundTip(outer, 0.05)
  put('trim', loft(outerR, { ...W, around: ring(6), th0: -0.42, th1: 0.42 }), true)
  put('paint', loft(outerR, { ...W, around: ring(16), th0: 0.42, th1: 2 * PI - 0.42, capEnd: true }), true)
  // Wingtip fins: canted outward, swept.
  const tipFin: Key[] = [
    K(0, [tipX - 0.05, NY - 0.22, -3.5], 0.48, 0.045, 0.045, 2),
    K(1, [tipX + 0.2, NY + 0.6, -3.95], 0.26, 0.03, 0.03, 2),
  ]
  put('trim', loft(roundTip(tipFin, 0.1), { A: Z, B: X, rings: ring(5), around: ring(14), foil: true, capStart: true, capEnd: true }), true)

  // ── tail fins ──
  const finH = brute ? 1.7 : 1.35
  let number: ShipSpec['number']
  if (needle) {
    const dorsal: Key[] = [
      K(0, [0, 1.0, -2.6], 1.15, 0.06, 0.06, 2),
      K(1, [0, 1.0 + finH + 0.4, -3.9], 0.5, 0.04, 0.04, 2),
    ]
    put('paint', loft(dorsal, { A: Z, B: X, rings: ring(8), around: ring(16), foil: true }))
    { const k0 = sample(dorsal, 0.9), k1 = sample(dorsal, 1); for (const k of [k0, k1]) { k.a *= 1.03; k.t *= 1.15; k.b *= 1.15 } put('neon', loft(roundTip([k0, k1], 0.6), { A: Z, B: X, rings: 4, around: ring(16), foil: true, capEnd: true })) }
    // Canards by the nose.
    put('trim', loft(roundTip([K(0.25, [0.25, 0.22, nose - 2.4], 0.45, 0.05, 0.03, 2), K(1.25, [1.25, 0.32, nose - 2.8], 0.22, 0.03, 0.02, 2)]), { A: Z, B: Y, rings: 8, around: ring(14), foil: true, capEnd: true }), true)
    number = { pos: [0.09, 1.75, -3.15], rotY: PI / 2, tilt: 0, size: 0.8 }
  } else {
    const fx = podX - 0.05
    const fin: Key[] = [
      K(0, [fx, NY + podH * 0.8, -3.0], 0.95, 0.06, 0.06, 2),
      K(1, [fx + 0.45, NY + podH * 0.8 + finH, -3.95], 0.42, 0.04, 0.04, 2),
    ]
    put('paint', loft(fin, { A: Z, B: X, rings: ring(8), around: ring(16), foil: true }), true)
    // A team-colour cap on each fin tip: the fin's own last tenth, a hair proud, its end rounded.
    { const k0 = sample(fin, 0.9), k1 = sample(fin, 1); for (const k of [k0, k1]) { k.a *= 1.03; k.t *= 1.2; k.b *= 1.2 } put('trim', loft(roundTip([k0, k1], 0.6), { A: Z, B: X, rings: 4, around: ring(16), foil: true, capEnd: true }), true) }
    const t = Math.atan2(0.45, finH)
    number = { pos: [fx + 0.22 + 0.075, NY + podH * 0.8 + finH * 0.48, -3.45], rotY: PI / 2, tilt: t, size: 0.62 }
  }

  if (hi) {
    // Racing stripes: one sweeping down the fuselage's flank from behind the canopy to the tail, one
    // along each pod from its intake to the nozzle (the livery's line, not a straight band).
    swoosh(fus, 'trim', 1.6, -3.9, 0.55, -0.15, 0.22, true)
    swoosh(fus, 'neon', 1.4, -3.6, 0.32, -0.38, 0.035, true)
    swoosh(pod, 'trim', pz0 - 0.4, -3.9, 1.15, 0.35, 0.26, true)
    // Navigation lights on the wingtips (red to port, green to starboard), and a white strobe on the tail.
    put('navG', new THREE.SphereGeometry(0.06, 16, 12).translate(tipX + 0.05, NY - 0.2, -3.25))
    put('navR', new THREE.SphereGeometry(0.06, 16, 12).translate(-tipX - 0.05, NY - 0.2, -3.25))
    // Nozzles: a metal lip ring, a dark inner liner, a hot core — centre and both pods.
    // Nozzles: closed engine shapes (lip, inner wall, throat) with the hot core filling the throat.
    const noz: [number, number, number][] = [[0, CY, CR], [podX, NY, PR], [-podX, NY, PR]]
    for (const [x, y, r] of noz) {
      put('metal', nacelle(r).translate(x, y, tailZ))
      put('hot', new THREE.CircleGeometry(r * 0.8, 32).rotateY(PI).translate(x, y, tailZ + 0.38))
      // A converging metal shroud behind the lip (flat box petals read as a black tyre).
      const sh = [new THREE.Vector2(r * 1.04, 0), new THREE.Vector2(r * 1.0, -0.12), new THREE.Vector2(r * 0.95, -0.24), new THREE.Vector2(r * 0.92, -0.24), new THREE.Vector2(r * 0.95, 0)]
      put('metal', new THREE.LatheGeometry(sh, 64).rotateX(PI / 2).translate(x, y, tailZ))
    }
    // Pod intakes: a metal lip, a dark mouth, a spinner cone.
    const ix = podX - 0.06, iy = NY - 0.04, sx = podW * 0.7, sy = podH * 0.63
    put('metal', new THREE.TorusGeometry(1 - 0.03 / Math.min(sx, sy), 0.035 / Math.min(sx, sy), 12, 48).scale(sx, sy, 1).translate(ix, iy, pz0), true)
    // The duct: a short dark tube into the pod, closed by the fan face.
    put('carbon', new THREE.CylinderGeometry(1, 0.9, 0.32, 40, 1, true).rotateX(PI / 2).scale(sx * 0.98, sy * 0.98, 1).translate(ix, iy, pz0 - 0.16), true)
    put('carbon', new THREE.CircleGeometry(1, 40).scale(sx * 0.9, sy * 0.9, 1).translate(ix, iy, pz0 - 0.32), true)
    put('metal', new THREE.ConeGeometry(Math.min(sx, sy) * 0.32, Math.min(sx, sy) * 0.55, 24).rotateX(PI / 2).translate(ix, iy, pz0 - 0.22), true)
    // Panel seams: thin raised dark bands round the pods and the fuselage.
    const seam = (keys: Key[], s: number, mirror: boolean, th0 = 0, th1 = 2 * PI) => {
      const k0 = sample(keys, s - 0.012), k1 = sample(keys, s + 0.012)
      for (const k of [k0, k1]) { k.a *= 1.015; k.t *= 1.015; k.b *= 1.015 }
      put('carbon', loft([k0, k1], { A: X, B: Y, rings: 1, around: 48, th0, th1 }), mirror)
    }
    for (const z of [-2.6, -0.2, 1.0]) seam(pod, z, true)
    for (const z of [-2.2, -0.2]) seam(fus, z, false, 0, PI)
    // The pilot: a headrest, a torso, a helmet — in the tub, under the dome.
    put('carbon', new THREE.CapsuleGeometry(0.2, 0.2, 8, 20).scale(1.2, 1, 0.5).translate(0, 1.12, cz - 0.55))
    put('carbon', new THREE.CapsuleGeometry(0.17, 0.16, 8, 20).translate(0, 1.04, cz - 0.3))
    put('trim', new THREE.SphereGeometry(0.16, 32, 20).scale(0.95, 1, 1.1).translate(0, 1.26, cz - 0.22))
    // Hover emitters: strips that follow the pods' and the belly's skin.
    const strip = (keys: Key[], s0: number, s1: number, mirror: boolean) => {
      const ks: Key[] = []
      for (let i = 0; i <= 8; i++) { const k = sample(keys, s0 + ((s1 - s0) * i) / 8); k.a *= 1.01; k.t *= 1.01; k.b *= 1.01; ks.push(k) }
      put('glow', loft(ks, { A: X, B: Y, rings: 8, around: 2, th0: 1.5 * PI - 0.12, th1: 1.5 * PI + 0.12 }), mirror)
    }
    strip(pod, -3.0, 0.8, true)
    strip(fus, 2.6, 3.3, false)
    // Tail light: a short bar on the tail's top, inside its width.
    put('neon', new THREE.BoxGeometry(0.42, 0.04, 0.05).translate(0, 0.48 + (brute ? 0.55 : 0.44) + 0.03, tailZ + 0.42))

  } else {
    for (const [x, y, r] of [[0, CY, CR], [podX, NY, PR], [-podX, NY, PR]] as const) put('hot', new THREE.CircleGeometry(r * 0.95, 10).rotateY(PI).translate(x, y, tailZ - 0.015))
  }

  const spec: ShipSpec = {
    nozzles: [[-podX, NY], [0, CY], [podX, NY]],
    nozzleZ: tailZ,
    wingtip: [tipX + 0.1, NY - 0.2, -3.6],
    number,
  }
  return { parts, spec }
}
