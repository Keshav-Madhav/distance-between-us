// The classic racer (the first model): one smooth lens hull with the spine grown out of it, side intakes, a canopy, canted fins,
// three nacelles with petal rings. Restored as its own family beside the lofted ships, at about
// twice the polygon count, with every box rounded (raw boxes read as programmer art).
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Parts, ShipSpec } from './shipdesign'
import { loft, mirrorX, nacelle, X, Y, Z, type Key } from './shipgeo'

const NOZZLE_Z = -4.3
const NOZZLES: [number, number][] = [[-1.08, 0.36], [0, 0.6], [1.08, 0.36]]
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3()

/** A rounded box: radius a fraction of the smallest side. */
function rbox(w: number, h: number, d: number): THREE.BufferGeometry {
  const r = Math.min(w, h, d) * 0.35
  return new RoundedBoxGeometry(w, h, d, 3, r)
}

class B0 {
  constructor(readonly parts: Parts) {}
  add(key: string, g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    const geo = g.clone()
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz))
    geo.applyMatrix4(_m)
    if (!this.parts.has(key)) this.parts.set(key, [])
    this.parts.get(key)!.push(geo)
  }
  addSym(key: string, g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    this.add(key, g, x, y, z, rx, ry, rz, sx, sy, sz)
    this.add(key, g, -x, y, z, rx, -ry, -rz, sx, sy, sz)
  }
}

function hullShape(k: number): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(0, 5.6 * k)
  s.bezierCurveTo(0.45 * k, 4.6 * k, 1.0 * k, 2.4 * k, 2.2 * k, -0.6 * k)
  s.bezierCurveTo(2.7 * k, -1.6 * k, 3.1 * k, -2.2 * k, 3.15 * k, -2.75 * k)
  // (Rear corners rounded: hard corners pinched the bevel into a dark crease.)
  s.quadraticCurveTo(2.55 * k, -3.1 * k, 2.0 * k, -3.45 * k)
  s.quadraticCurveTo(1.62 * k, -3.72 * k, 1.5 * k, -4.0 * k)
  s.quadraticCurveTo(1.45 * k, -4.15 * k, 1.2 * k, -4.15 * k)
  s.lineTo(-1.2 * k, -4.15 * k)
  s.quadraticCurveTo(-1.45 * k, -4.15 * k, -1.5 * k, -4.0 * k)
  s.quadraticCurveTo(-1.62 * k, -3.72 * k, -2.0 * k, -3.45 * k)
  s.quadraticCurveTo(-2.55 * k, -3.1 * k, -3.15 * k, -2.75 * k)
  s.bezierCurveTo(-3.1 * k, -2.2 * k, -2.7 * k, -1.6 * k, -2.2 * k, -0.6 * k)
  s.bezierCurveTo(-1.0 * k, 2.4 * k, -0.45 * k, 4.6 * k, 0, 5.6 * k)
  return s
}


/** The whole hull as ONE surface: the hull outline's half-width at each station, a flat lens section
 *  (thin at the rim, deepest on the centre line), the spine grown out of its top as a ridge that
 *  fades out toward nose and tail. It was three stacked slabs and a capsule: every step and every
 *  join read as a separate panel. */
function hullLoft(rings: number, around: number): THREE.BufferGeometry {
  const pts = hullShape(1).getSpacedPoints(800)
  const half = (z: number) => { let w = 0; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; if ((a.y - z) * (b.y - z) <= 0 && a.y !== b.y) { const t = (z - a.y) / (b.y - a.y); w = Math.max(w, Math.abs(a.x + (b.x - a.x) * t)) } } return w }
  const keys: Key[] = []
  const zN = 5.6, zT = -4.15, N = 26
  for (let i = 0; i <= N; i++) {
    const u = i / N, z = zN + (zT - zN) * (0.5 - 0.5 * Math.cos(Math.PI * u))
    const w = Math.max(0.02, half(z) * (i === 0 ? 0 : 1) + (i === 0 ? 0.02 : 0))
    // SR-71 front: a flat pancake with knife chines (squareness under 2 points the section's sides)
    // that thickens slowly over most of the length; the fuselage rises out of it as a ridge from the
    // very tip. From above the outline is unchanged; side-on and head-on the nose is thin.
    const tail = Math.min(1, (z - zT) / 2.6)
    const d = Math.pow(Math.min(1, (zN - z) / 6), 0.8) * Math.sqrt(Math.max(0, tail))
    const r = Math.min(1, (zN - z) / 4.5) * THREE.MathUtils.smoothstep(z, -4.3, -2.6)
    const n = 2.6 - THREE.MathUtils.smoothstep(z, -0.5, 4.0)
    keys.push({ s: -z, c: [0, 0.18, z], a: w, t: 0.34 * d + 0.01, b: 0.26 * d + 0.01, n, h: 0.42 * r, hw: 0.3 + 0.42 * Math.min(1, (zN - z) / 4.5) })
  }
  return loft(keys, { A: X, B: Y, rings, around })
}

const KK = (s: number, c: [number, number, number], a: number, h: number): Key => ({ s, c, a, t: h, b: h, n: 2 })
/** One more key past the tip: shorter and much thinner — a rounded end, not a sawn-off plank. */
function tipRound(k0: Key, k1: Key, d: number): Key {
  const f = d
  return { s: k1.s + (k1.s - k0.s) * f, c: [k1.c[0] + (k1.c[0] - k0.c[0]) * f, k1.c[1] + (k1.c[1] - k0.c[1]) * f, k1.c[2] + (k1.c[2] - k0.c[2]) * f], a: k1.a * 0.72, t: k1.t * 0.3, b: k1.b * 0.3, n: 2 }
}

/** A swept, tapered fin: root (length rl) flat on local y = 0 from z = 0 back, tip (length tl) at
 *  height h, swept back by sw; thickness t. An airfoil loft (round leading edge, sharp trailing edge,
 *  a rounded tip) — the extruded slab had hard edges all round. Thickness along x. */
function fin(rl: number, tl: number, h: number, sw: number, t: number): THREE.BufferGeometry {
  const k0 = KK(0, [0, -0.04, -rl / 2], rl / 2, t / 2), k1 = KK(1, [0, h, -sw - tl / 2], tl / 2, t * 0.38)
  return loft([k0, k1, tipRound(k0, k1, 0.05)], { A: Z, B: X, rings: 24, around: 40, foil: true, capStart: true, capEnd: true })
}

/** A flat swept surface (canard, winglet): span s outward along +x, root chord rc, tip chord tc, swept;
 *  an airfoil loft like the fins. */
function blade(s: number, rc: number, tc: number, sw: number, t: number): THREE.BufferGeometry {
  const k0 = KK(0, [0, 0, -rc / 2], rc / 2, t / 2), k1 = KK(s, [s, 0, -sw - tc / 2], tc / 2, t * 0.38)
  return loft([k0, k1, tipRound(k0, k1, 0.06)], { A: Z, B: Y, rings: 20, around: 40, foil: true, capStart: true, capEnd: true })
}

export function buildClassic(variant: number, hi: boolean): { parts: Parts; spec: ShipSpec } {
  const parts: Parts = new Map()
  let number: ShipSpec['number'] = { pos: [0, 0, 0], rotY: Math.PI / 2, tilt: 0, size: 0.8 }
  let wingtip: [number, number, number] = [3.45, 0.25, -2.9]
  if (hi) {
    const B = new B0(parts)
    // ── hull: three stepped slabs, each smaller and higher ──
    B.add('paint', hullLoft(120, 96))
    // Canopy: a dome (not a whole ellipsoid buried in the spine — that showed the hull through the
    // glass), a sill round its base, a frame bow following its crown.
    B.add('glass', new THREE.SphereGeometry(0.72, 56, 24, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.8, 1.45, 0.14, 0, 0, 0.86, 0.56, 2.15)
    B.add('carbon', new THREE.TorusGeometry(0.72, 0.035, 10, 72).rotateX(Math.PI / 2).scale(0.86, 1, 2.15), 0, 0.81, 1.45, 0.14, 0, 0)
    // The pilot: seat back, torso, helmet — all under the dome.
    B.add('carbon', rbox(0.5, 0.36, 0.12), 0, 0.8, 0.78)
    B.add('carbon', new THREE.CapsuleGeometry(0.16, 0.14, 8, 16), 0, 0.8, 0.98)
    B.add('trim', new THREE.SphereGeometry(0.16, 32, 20), 0, 0.93, 1.1, 0, 0, 0, 0.95, 1, 1.1)
    // Side intakes: a rounded fairing with a dark mouth and a lip, not a box.
    B.addSym('paint', new THREE.CapsuleGeometry(0.24, 1.1, 10, 24), 1.08, 0.66, 0.15, Math.PI / 2, -0.18, 0, 1.05, 1, 0.8)
    B.addSym('carbon', new THREE.CircleGeometry(0.2, 32).scale(1, 0.75, 1), 1.18, 0.66, 0.97, 0, -0.18, 0)
    B.addSym('trim', new THREE.TorusGeometry(0.21, 0.03, 8, 32).scale(1, 0.75, 1), 1.18, 0.66, 0.96, 0, -0.18, 0)
    // Hover emitters just under the belly.
    B.add('glow', rbox(0.5, 0.03, 3.6), 0, -0.25, -0.4)
    // Engines: closed nacelles, overlapping petals tilted in, a team-colour band, the hot throat.
    for (const [x, y] of NOZZLES) {
      B.add('carbon', nacelle(0.6), x, y, NOZZLE_Z)
      B.add('trim', new THREE.TorusGeometry(0.575, 0.028, 8, 48), x, y, NOZZLE_Z + 1.25)
      // A continuous flared skirt: a round outline (tiles read as a bottle cap, ribs as tyre tread).
      const sk = [new THREE.Vector2(0.6, 0), new THREE.Vector2(0.63, -0.12), new THREE.Vector2(0.64, -0.28), new THREE.Vector2(0.58, -0.3), new THREE.Vector2(0.56, -0.05)]
      B.add('metal', new THREE.LatheGeometry(sk, 64).rotateX(Math.PI / 2), x, y, NOZZLE_Z)

      B.add('hot', new THREE.CircleGeometry(0.47, 40), x, y, NOZZLE_Z + 0.4, 0, Math.PI, 0)
    }
    if (variant !== 2) B.add('carbon', new THREE.CylinderGeometry(0.02, 0.03, 0.9, 16), -0.5, 1.4, -1.6, -0.3, 0, 0)
    // Fins: swept and tapered, roots flat on the lower deck outboard of the engines (they grew out
    // of the boosters before). Racing numbers on their outer faces.
    const finAt = (fx: number, fy: number, fz: number, rz: number, rl: number, tl: number, h: number, sw: number, cap: boolean) => {
      B.addSym('paint', fin(rl, tl, h, sw, 0.13), fx, fy, fz, 0, 0, rz)
      if (cap) B.addSym('trim', fin(tl + 0.08, tl, 0.16, 0.04, 0.15), fx - Math.sin(rz) * (h - 0.16), fy + Math.cos(rz) * (h - 0.16), fz - sw + 0.02, 0, 0, rz)
      // Number plate: on the outer face, mid fin.
      const u = 0.42 * h, back = sw * 0.42 + (rl + tl) * 0.25, off = 0.13 / 2 + 0.05
      number = { pos: [fx + Math.cos(rz) * off - Math.sin(rz) * u, fy + Math.sin(rz) * off + Math.cos(rz) * u, fz - back], rotY: Math.PI / 2, tilt: -rz, size: Math.min(0.85, h * 0.62) }
    }
    // (Roots kept over the deck: the rear of the hull rounds off at x ≈ 1.9.)
    if (variant !== 1) finAt(1.85, 0.5, -2.2, -0.3, 1.5, 0.8, 1.25, 0.9, true)
    // Wingtip side-thruster pods, mounted outboard on pylons (they were buried in the hull edge).
    if (variant !== 1) {
      // Sunk a little into the hull bevel, with a paint fairing onto the deck edge.
      B.addSym('paint', new THREE.CapsuleGeometry(0.16, 0.7, 8, 20), 3.18, 0.42, -2.2, Math.PI / 2, 0, 0)
      B.addSym('carbon', new THREE.CapsuleGeometry(0.22, 1.2, 8, 24), 3.32, 0.3, -2.2, Math.PI / 2, 0, 0)
      B.addSym('glow', new THREE.CircleGeometry(0.12, 20), 3.32, 0.3, -1.38)
    }
    if (variant === 1) {
      // BULWARK: side sponsons on pylons, two tall fins.
      // Out past the hull's flare on visible pylons; the exhaust stands clear of the rear dome.
      // Pylon angled along the hull edge (a straight one only met the hull at its rear half).
      { const py = blade(1.35, 0.8, 0.7, 0.1, 0.1); B.add('paint', py, 2.45, 0.3, -0.3); B.add('paint', mirrorX(py), -2.45, 0.3, -0.3) }
      B.addSym('paint', new THREE.CapsuleGeometry(0.34, 2.6, 12, 32), 3.7, 0.3, -0.6, Math.PI / 2, 0, 0, 1, 1, 0.75)
      B.addSym('carbon', nacelle(0.27), 3.7, 0.3, -2.85, 0, 0, 0, 1, 0.75, 1)
      B.addSym('hot', new THREE.CircleGeometry(0.19, 28), 3.7, 0.3, -2.45, 0, Math.PI, 0, 1, 0.75, 1)
      finAt(1.85, 0.5, -2.1, -0.14, 1.6, 0.9, 1.9, 1.0, true)
      wingtip = [3.7, 0.3, -3.0]
    } else if (variant === 2) {
      // LANCE: a nose probe, canards on the deck, a dorsal fin on the spine ahead of the engines.
      B.add('metal', new THREE.ConeGeometry(0.11, 2.2, 24).rotateX(-Math.PI / 2), 0, 0.19, 6.3)
      B.add('metal', new THREE.TorusGeometry(0.13, 0.04, 8, 24), 0, 0.19, 5.25)
      B.add('neon', new THREE.SphereGeometry(0.07, 16, 12), 0, 0.19, 7.42)
      // (Each side built on its own: addSym only mirrors position, so the left one pointed inboard.)
      const cn = blade(1.1, 0.75, 0.32, 0.35, 0.06)
      B.add('paint', cn, 0.45, 0.24, 3.35, 0, 0, 0.06)
      B.add('paint', mirrorX(cn), -0.45, 0.24, 3.35, 0, 0, -0.06)
      B.add('paint', fin(1.55, 0.7, 1.45, 1.0, 0.14), 0, 0.97, -0.55)
      B.add('trim', fin(0.78, 0.7, 0.14, 0.04, 0.16), 0, 0.97 + 1.33, -0.55 - 0.98)
    }
  } else {
    const L = new B0(parts)
    L.add('paint', hullLoft(22, 16))
    for (const [x, y] of NOZZLES) {
      L.add('carbon', new THREE.CylinderGeometry(0.55, 0.6, 2.0, 10), x, y, NOZZLE_Z + 1.0, Math.PI / 2, 0, 0)
      L.add('hot', new THREE.CircleGeometry(0.47, 10), x, y, NOZZLE_Z - 0.04, 0, Math.PI, 0)
    }
    // Same silhouette as the detailed ship (no pop when the detail switches).
    if (variant === 1) {
      L.addSym('paint', new THREE.CapsuleGeometry(0.42, 2.6, 3, 8), 3.7, 0.3, -0.6, Math.PI / 2, 0, 0, 1, 1, 0.75)
      L.addSym('paint', new THREE.BoxGeometry(0.14, 1.9, 1.3), 1.95, 1.45, -2.9, 0, 0, -0.14)
    } else {
      L.addSym('paint', new THREE.BoxGeometry(0.14, 1.25, 1.2), 2.0, 1.1, -2.9, 0, 0, -0.3)
      L.addSym('carbon', new THREE.CapsuleGeometry(0.22, 1.2, 2, 6), 3.32, 0.3, -2.2, Math.PI / 2, 0, 0)
    }
    if (variant === 2) {
      L.add('paint', new THREE.BoxGeometry(0.14, 1.45, 1.4), 0, 1.7, -1.6)
      L.add('metal', new THREE.ConeGeometry(0.11, 2.2, 6).rotateX(-Math.PI / 2), 0, 0.19, 6.3)
    }
  }
  if (hi) {
    // Navigation lights at the wingtips (red to port, green to starboard).
    const B = new B0(parts)
    B.add('navG', new THREE.SphereGeometry(0.07, 16, 12), wingtip[0], wingtip[1] + 0.12, wingtip[2] + 0.5)
    B.add('navR', new THREE.SphereGeometry(0.07, 16, 12), -wingtip[0], wingtip[1] + 0.12, wingtip[2] + 0.5)
  }
  const spec: ShipSpec = {
    nozzles: NOZZLES,
    nozzleZ: NOZZLE_Z,
    wingtip,
    number,
  }
  return { parts, spec }
}
