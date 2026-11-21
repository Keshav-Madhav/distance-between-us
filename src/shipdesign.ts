// The hover-racer's shape, as lofts (shipgeo.ts). Forward is +z, up +y; built for the right side
// (+x) and mirrored. Three silhouettes:
//   0 ARROW  — the standard: a slim fuselage, two engine pods on swept wings, twin canted tail fins
//   1 BRUTE  — wide and heavy: fat pods set further out, a broad fuselage, tall fins
//   2 NEEDLE — long and thin: a stretched nose with canards, slim pods, one tall dorsal fin
// Materials by key: paint (body colour), trim (team colour), carbon (dark), glass, metal, neon
// (team-colour light), glow (cyan light), hot (nozzle cores).
import * as THREE from 'three'
import { loft, mirrorX, sample, X, Y, Z, type Key } from './shipgeo'

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

export function buildShip(variant: number, hi: boolean): { parts: Parts; spec: ShipSpec } {
  const parts: Parts = new Map()
  const put = (key: string, g: THREE.BufferGeometry, mirror = false) => {
    if (!parts.has(key)) parts.set(key, [])
    parts.get(key)!.push(g)
    if (mirror) parts.get(key)!.push(mirrorX(g))
  }
  // (Hi detail: dense surfaces — every loft ~2× the rings and points it had.)
  const R = hi ? 2 : 0.35
  const ring = (n: number) => Math.max(4, Math.round(n * R))

  const v = variant
  const brute = v === 1, needle = v === 2
  // Proportions per silhouette.
  const podX = brute ? 2.2 : needle ? 1.75 : 1.95
  const podW = brute ? 0.66 : needle ? 0.44 : 0.54
  const podH = brute ? 0.62 : needle ? 0.46 : 0.54
  const bodyW = brute ? 1.3 : needle ? 0.95 : 1.12
  const nose = needle ? 7.4 : brute ? 5.6 : 6.3
  const tailZ = -4.45
  const NY = 0.36 // nozzle line height

  // ── fuselage ── (s = z, tail → nose)
  const fus: Key[] = [
    K(tailZ, [0, 0.48, tailZ], 0.58, 0.44, 0.34, 3),
    K(-3.3, [0, 0.46, -3.3], bodyW * 0.82, 0.62, 0.38, 3.2),
    K(-1.2, [0, 0.42, -1.2], bodyW, 0.8, 0.4, 3.4),
    K(0.9, [0, 0.38, 0.9], bodyW * 0.94, 0.74, 0.38, 3.2),
    K(2.9, [0, 0.3, 2.9], bodyW * 0.7, 0.5, 0.32, 2.8),
    K(nose - 1.6, [0, 0.2, nose - 1.6], bodyW * 0.38, 0.27, 0.22, 2.4),
    K(nose, [0, 0.12, nose], 0.03, 0.03, 0.03, 2),
  ]
  const F = { A: X, B: Y, rings: ring(44), around: ring(14) }
  // Livery split by section angle: paint shoulders, a trim stripe down the spine, a carbon belly.
  put('paint', loft(fus, { ...F, th0: 0, th1: PI / 2 - 0.13 }))
  put('trim', loft(fus, { ...F, th0: PI / 2 - 0.13, th1: PI / 2 + 0.13, around: ring(3) }))
  put('paint', loft(fus, { ...F, th0: PI / 2 + 0.13, th1: PI }))
  put('carbon', loft(fus, { ...F, th0: PI, th1: 2 * PI, capStart: true }))

  // ── canopy ── a bubble on the spine, framed at its sills
  const cz = needle ? 2.2 : 1.6
  const can: Key[] = [
    K(cz - 2.3, [0, 0.96, cz - 2.3], 0.06, 0.04, 0.02, 2),
    K(cz - 1.4, [0, 1.0, cz - 1.4], 0.46, 0.36, 0.05, 2.2),
    K(cz, [0, 0.98, cz], 0.52, 0.4, 0.05, 2.3),
    K(cz + 1.25, [0, 0.82, cz + 1.25], 0.34, 0.22, 0.05, 2.2),
    K(cz + 1.8, [0, 0.7, cz + 1.8], 0.04, 0.03, 0.02, 2),
  ]
  const C = { A: X, B: Y, rings: ring(28), around: ring(12) }
  put('glass', loft(can, { ...C, th0: 0.32, th1: PI - 0.32 }))
  put('carbon', loft(can, { ...C, th0: 0, th1: 0.32, around: ring(3) }))
  put('carbon', loft(can, { ...C, th0: PI - 0.32, th1: PI, around: ring(3) }))

  // ── engine pods ── (right side, mirrored): pointed nose, fat round tail around the nozzle
  const pz0 = needle ? 2.6 : brute ? 2.0 : 2.4
  const pod: Key[] = [
    K(tailZ, [podX, NY, tailZ], podW * 0.92, podH * 0.92, podH * 0.92, 2.1),
    K(-3.4, [podX, NY + 0.02, -3.4], podW * 1.05, podH, podH * 0.92, 2.3),
    K(-0.9, [podX + 0.03, NY, -0.9], podW, podH * 0.92, podH * 0.78, 2.7),
    K(1.2, [podX - 0.03, NY - 0.02, 1.2], podW * 0.84, podH * 0.8, podH * 0.66, 2.5),
    // (A jet intake at the front, not a missile point.)
    K(pz0, [podX - 0.06, NY - 0.04, pz0], podW * 0.7, podH * 0.66, podH * 0.6, 2.2),
  ]
  const P = { A: X, B: Y, rings: ring(36), around: ring(12) }
  put('paint', loft(pod, { ...P, th0: 0.22, th1: PI }), true)
  put('neon', loft(pod, { ...P, th0: 0.12, th1: 0.22, around: 1 }), true)
  put('trim', loft(pod, { ...P, th0: -0.25, th1: 0.12, around: ring(3) }), true)
  put('carbon', loft(pod, { ...P, th0: PI, th1: 2 * PI - 0.25 }), true)

  // ── wings ── inner (body → pod) and outer (pod → tip, swept and drooped)
  const inner: Key[] = [
    K(0.5, [0.5, 0.36, -1.0], 2.0, 0.11, 0.07, 2),
    K(podX - 0.2, [podX - 0.2, NY, -1.5], 1.55, 0.09, 0.06, 2),
  ]
  put('paint', loft(inner, { A: Z, B: Y, rings: ring(6), around: ring(16) }), true)
  const tipX = podX + (brute ? 1.15 : needle ? 1.05 : 1.35)
  const outer: Key[] = [
    K(podX + 0.3, [podX + 0.3, NY - 0.04, -2.3], 1.15, 0.08, 0.05, 2),
    K(tipX, [tipX, NY - 0.22, -3.0], 0.5, 0.05, 0.04, 2),
  ]
  put('paint', loft(outer, { A: Z, B: Y, rings: ring(6), around: ring(14), capEnd: true }), true)
  // Wingtip fins: canted outward, swept.
  const tipFin: Key[] = [
    K(0, [tipX, NY - 0.24, -3.0], 0.55, 0.045, 0.045, 2),
    K(1, [tipX + 0.22, NY + 0.62, -3.45], 0.28, 0.03, 0.03, 2),
  ]
  put('trim', loft(tipFin, { A: Z, B: X, rings: ring(5), around: ring(12), capEnd: true }), true)

  // ── tail fins ──
  const finH = brute ? 1.7 : 1.35
  let number: ShipSpec['number']
  if (needle) {
    const dorsal: Key[] = [
      K(0, [0, 1.0, -2.6], 1.15, 0.06, 0.06, 2),
      K(1, [0, 1.0 + finH + 0.4, -3.9], 0.5, 0.04, 0.04, 2),
    ]
    put('paint', loft(dorsal, { A: Z, B: X, rings: ring(8), around: ring(14), capEnd: true }))
    put('neon', loft([K(0, [0, 1.0 + finH + 0.38, -3.85], 0.48, 0.07, 0.07, 2), K(1, [0, 1.0 + finH + 0.46, -3.95], 0.42, 0.07, 0.07, 2)], { A: Z, B: X, rings: 2, around: 8, capStart: true, capEnd: true }))
    // Canards by the nose.
    put('trim', loft([K(0.25, [0.25, 0.22, nose - 2.4], 0.45, 0.05, 0.03, 2), K(1.25, [1.25, 0.2, nose - 2.8], 0.22, 0.03, 0.02, 2)], { A: Z, B: Y, rings: 4, around: ring(10), capEnd: true }), true)
    number = { pos: [0.09, 1.75, -3.15], rotY: PI / 2, tilt: 0, size: 0.8 }
  } else {
    const fx = podX - 0.05
    const fin: Key[] = [
      K(0, [fx, NY + podH * 0.8, -3.0], 0.95, 0.06, 0.06, 2),
      K(1, [fx + 0.45, NY + podH * 0.8 + finH, -3.95], 0.42, 0.04, 0.04, 2),
    ]
    put('paint', loft(fin, { A: Z, B: X, rings: ring(8), around: ring(14) }), true)
    // A team-colour cap on each fin tip.
    const capY = NY + podH * 0.8 + finH
    put('trim', loft([K(0, [fx + 0.41, capY - 0.12, -3.9], 0.45, 0.05, 0.05, 2), K(1, [fx + 0.46, capY + 0.02, -3.97], 0.41, 0.045, 0.045, 2)], { A: Z, B: X, rings: 2, around: ring(12), capEnd: true }), true)
    const t = Math.atan2(0.45, finH)
    number = { pos: [fx + 0.22 + 0.075, NY + podH * 0.8 + finH * 0.48, -3.45], rotY: PI / 2, tilt: -t, size: 0.62 }
  }

  if (hi) {
    // Nozzles: a metal lip ring, a dark inner liner, a hot core — centre and both pods.
    const noz: [number, number, number][] = [[0, 0.5, 0.44], [podX, NY, podW * 0.8], [-podX, NY, podW * 0.8]]
    for (const [x, y, r] of noz) {
      put('metal', new THREE.TorusGeometry(r, 0.06, 8, 28).translate(x, y, tailZ - 0.02))
      put('carbon', new THREE.CylinderGeometry(r * 0.92, r * 0.8, 0.5, 24, 1, true).rotateX(PI / 2).translate(x, y, tailZ + 0.2))
      put('hot', new THREE.CircleGeometry(r * 0.74, 24).rotateY(PI).translate(x, y, tailZ + 0.4))
    }
    // Pod intakes: a metal lip, a dark mouth, a spinner cone.
    const ix = podX - 0.06, iy = NY - 0.04, ir = Math.min(podW * 0.7, podH * 0.63)
    put('metal', new THREE.TorusGeometry(ir * 0.98, 0.05, 12, 48).scale(podW * 0.7 / ir, podH * 0.63 / ir, 1).translate(ix, iy, pz0), true)
    put('carbon', new THREE.CircleGeometry(ir, 40).scale(podW * 0.7 / ir, podH * 0.63 / ir, 1).translate(ix, iy, pz0 - 0.25), true)
    put('metal', new THREE.ConeGeometry(ir * 0.32, ir * 0.7, 24).rotateX(PI / 2).translate(ix, iy, pz0 - 0.05), true)
    // Panel seams: thin raised dark bands round the pods and the fuselage.
    const seam = (keys: Key[], s: number, mirror: boolean, th0 = 0, th1 = 2 * PI) => {
      const k0 = sample(keys, s - 0.03), k1 = sample(keys, s + 0.03)
      for (const k of [k0, k1]) { k.a *= 1.012; k.t *= 1.012; k.b *= 1.012 }
      put('carbon', loft([k0, k1], { A: X, B: Y, rings: 1, around: 48, th0, th1 }), mirror)
    }
    for (const z of [-2.6, -0.2, 1.0]) seam(pod, z, true)
    for (const z of [-2.2, -0.2]) seam(fus, z, false, 0, PI)
    // Vent slats on each pod's back, behind the wing.
    for (let i = 0; i < 5; i++) put('carbon', new THREE.BoxGeometry(podW * 0.9, 0.04, 0.09).translate(podX, NY + podH * 0.86 - i * 0.008, -2.95 - i * 0.2), true)
    // Petal rings round every nozzle.
    for (const [x, y, r] of noz) for (let p = 0; p < 14; p++) {
      const a = (p / 14) * PI * 2
      put('metal', new THREE.BoxGeometry(0.16, 0.03, 0.34).rotateZ(a + PI / 2).translate(x + Math.cos(a) * r * 1.06, y + Math.sin(a) * r * 1.06, tailZ - 0.12))
    }
    // Trailing-edge flaps in the team colour.
    const flap: Key[] = inner.map((k) => ({ ...k, c: [k.c[0], k.c[1], k.c[2] - k.a + 0.32] as [number, number, number], a: 0.34, t: k.t * 1.2, b: k.b * 1.2 }))
    put('trim', loft(flap, { A: Z, B: Y, rings: 6, around: 16 }), true)
    // The pilot: a seat and a helmet under the (tinted, see-through) canopy.
    put('carbon', new THREE.BoxGeometry(0.42, 0.5, 0.5).translate(0, 0.98, cz - 0.55))
    put('trim', new THREE.SphereGeometry(0.2, 32, 20).scale(0.95, 1, 1.1).translate(0, 1.16, cz - 0.25))
    put('glass', new THREE.SphereGeometry(0.205, 32, 12, 0, PI * 2, 0, PI * 0.42).rotateX(PI / 2.2).translate(0, 1.15, cz - 0.17))
    // Hover emitters underneath: cyan strips along the pods and the belly.
    put('glow', new THREE.BoxGeometry(0.16, 0.04, 3.6).translate(podX, NY - podH * 0.88, -1.2), true)
    put('glow', new THREE.BoxGeometry(0.7, 0.04, 0.18).translate(0, 0.04, 3.1))
    // Nose light, tail light bar, a short antenna.
    put('glow', new THREE.BoxGeometry(0.5, 0.04, 0.08).translate(0, 0.2, nose - 0.9))
    put('neon', new THREE.BoxGeometry(bodyW * 0.9, 0.06, 0.05).translate(0, 0.86, tailZ + 0.05))
    put('carbon', new THREE.CylinderGeometry(0.015, 0.025, 0.7, 5).rotateX(-0.35).translate(-0.35, 1.35, -1.6))
    // Diffuser strakes under the tail.
    for (const x of [-0.45, 0, 0.45]) put('carbon', new THREE.BoxGeometry(0.05, 0.26, 1.0).translate(x, 0.08, -3.95))
  } else {
    for (const [x, y, r] of [[0, 0.5, 0.44], [podX, NY, podW * 0.8], [-podX, NY, podW * 0.8]] as const) put('hot', new THREE.CircleGeometry(r * 0.8, 8).rotateY(PI).translate(x, y, tailZ - 0.01))
  }

  const spec: ShipSpec = {
    nozzles: [[-podX, NY], [0, 0.5], [podX, NY]],
    nozzleZ: tailZ,
    wingtip: [tipX + 0.1, NY - 0.2, -3.1],
    number,
  }
  return { parts, spec }
}
