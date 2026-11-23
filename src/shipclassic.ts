// The classic racer (the first model): one smooth lens hull with the spine grown out of it, side intakes, a canopy, canted fins,
// three nacelles with petal rings. Restored as its own family beside the lofted ships, at about
// twice the polygon count, with every box rounded (raw boxes read as programmer art).
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Parts, ShipSpec } from './shipdesign'
import { loft, mirrorX, nacelle, sample, X, Y, Z, type Key } from './shipgeo'

const NOZZLE_Z = -4.3
const NOZZLES: [number, number][] = [[-1.2, 0.4], [0, 0.52], [1.2, 0.4]]
const NR = 0.52
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
 *  (thin knife chines at the rim, deepest on the centre line), the spine grown out of its top as a
 *  ridge from the very tip. SR-71 front: a flat pancake that thickens slowly over most of the length,
 *  the tip drooped a little. From above the outline is the classic one; side-on and head-on it is thin.
 *  (It was three stacked slabs and a capsule: every step and every join read as a separate panel.) */
const OUTLINE = hullShape(1).getSpacedPoints(800)
function halfWidth(z: number): number {
  let w = 0
  for (let i = 1; i < OUTLINE.length; i++) {
    const a = OUTLINE[i - 1], b = OUTLINE[i]
    if ((a.y - z) * (b.y - z) <= 0 && a.y !== b.y) { const t = (z - a.y) / (b.y - a.y); w = Math.max(w, Math.abs(a.x + (b.x - a.x) * t)) }
  }
  return w
}
/** The trailing edge: the outline's z at half-width x, on its rear (swept-forward) stretch. */
function edgeZ(x: number): number {
  let z = -4.15
  for (let i = 1; i < OUTLINE.length; i++) {
    const a = OUTLINE[i - 1], b = OUTLINE[i]
    if (a.y < -2.6 && b.y < -2.6 && a.x > 0 && (a.x - x) * (b.x - x) <= 0 && a.x !== b.x) z = a.y + (b.y - a.y) * ((x - a.x) / (b.x - a.x))
  }
  return z
}
const ZN = 5.6, ZT = -4.15
let HULL: Key[] | null = null
function hullKeys(): Key[] {
  if (HULL) return HULL
  const keys: Key[] = [], N = 30
  for (let i = 0; i <= N; i++) {
    const u = i / N, z = ZN + (ZT - ZN) * (0.5 - 0.5 * Math.cos(Math.PI * u))
    const w = i === 0 ? 0.02 : Math.max(0.02, halfWidth(z))
    const tail = Math.min(1, (z - ZT) / 2.6)
    const d = Math.pow(Math.min(1, (ZN - z) / 6), 0.8) * Math.sqrt(Math.max(0, tail))
    const r = Math.min(1, (ZN - z) / 4.5) * THREE.MathUtils.smoothstep(z, -4.3, -2.6)
    const n = 2.6 - THREE.MathUtils.smoothstep(z, -0.5, 4.0)
    const droop = 0.08 * Math.pow(1 - Math.min(1, (ZN - z) / 2.5), 2)
    keys.push({ s: -z, c: [0, 0.18 - droop, z], a: w, t: 0.34 * d + 0.01, b: 0.26 * d + 0.01, n, h: 0.42 * r, hw: 0.3 + 0.42 * Math.min(1, (ZN - z) / 4.5) })
  }
  return (HULL = keys)
}
/** The hull's top (or underside) height at (x, z): for seating parts on the skin, not in the air. */
function hullY(x: number, z: number, top = true): number {
  const k = sample(hullKeys(), -z)
  const ax = Math.abs(x)
  if (ax >= k.a) return k.c[1]
  const ca = Math.pow(ax / k.a, k.n / 2), sa = Math.sqrt(Math.max(0, 1 - ca * ca))
  const e = 2 / k.n
  if (!top) return k.c[1] - k.b * Math.pow(sa, e)
  const q = ax / (k.hw || 1)
  return k.c[1] + k.t * Math.pow(sa, e) + (k.h ?? 0) * Math.exp(-q * q) * sa * sa
}
function hullLoft(rings: number, around: number): THREE.BufferGeometry {
  return loft(hullKeys(), { A: X, B: Y, rings, around })
}

/** A blended fairing along z that grows out of the hull top: centre on the skin plus lift, half-width
 *  a, height t — the keys run front to back. Open ends are for intakes; capped for tails. */
function fairing(x: number, stations: [number, number, number, number][], o: { capStart?: boolean; capEnd?: boolean; n?: number; around?: number } = {}): THREE.BufferGeometry {
  const keys: Key[] = stations.map(([z, lift, a, t]) => ({ s: -z, c: [x, hullY(x, z) + lift, z], a, t, b: t, n: o.n ?? 2.2 }))
  return loft(keys, { A: X, B: Y, rings: 18, around: o.around ?? 20, capStart: o.capStart, capEnd: o.capEnd })
}

/** An engine pod (intake at the front, nozzle at the back): an open loft with a dark duct inside the
 *  lip and a half-cone spike in the mouth; a flared metal nozzle, the hot throat. Centre (x, y). */
function pod(B: B0, x: number, y: number, zf: number, zr: number, r: number, sym: boolean): void {
  const L = zf - zr
  const keys: Key[] = [
    { s: 0, c: [0, 0, zf], a: r * 0.86, t: r * 0.82, b: r * 0.82, n: 2 },
    { s: 0.12 * L, c: [0, 0, zf - 0.12 * L], a: r, t: r * 0.95, b: r * 0.95, n: 2 },
    { s: 0.6 * L, c: [0, 0, zf - 0.6 * L], a: r * 0.98, t: r * 0.92, b: r * 0.92, n: 2 },
    { s: L, c: [0, 0, zr], a: r * 0.74, t: r * 0.7, b: r * 0.7, n: 2 },
  ]
  const add = sym ? B.addSym.bind(B) : B.add.bind(B)
  add('paint', loft(keys, { A: X, B: Y, rings: 16, around: 24 }), x, y, 0)
  const duct = loft([{ s: 0, c: [0, 0, zf - 0.005], a: r * 0.8, t: r * 0.76, b: r * 0.76, n: 2 }, { s: 1, c: [0, 0, zf - 0.35], a: r * 0.72, t: r * 0.68, b: r * 0.68, n: 2 }], { A: X, B: Y, rings: 1, around: 20, capEnd: true })
  add('carbon', duct, x, y, 0)
  add('metal', new THREE.ConeGeometry(r * 0.42, r * 1.3, 16).rotateX(Math.PI / 2), x, y, zf - 0.12)
  const sk = [new THREE.Vector2(r * 0.74, 0.02), new THREE.Vector2(r * 0.78, -0.1), new THREE.Vector2(r * 0.8, -0.24), new THREE.Vector2(r * 0.7, -0.26), new THREE.Vector2(r * 0.66, -0.04)]
  add('metal', new THREE.LatheGeometry(sk, 24).rotateX(Math.PI / 2), x, y, zr)
  add('hot', new THREE.CircleGeometry(r * 0.62, 16), x, y, zr - 0.05, 0, Math.PI, 0)
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
  return loft([k0, k1, tipRound(k0, k1, 0.05)], { A: Z, B: X, rings: 10, around: 24, foil: true, capStart: true, capEnd: true })
}

/** A flat swept surface (canard, winglet): span s outward along +x, root chord rc, tip chord tc, swept;
 *  an airfoil loft like the fins. */
function blade(s: number, rc: number, tc: number, sw: number, t: number): THREE.BufferGeometry {
  const k0 = KK(0, [0, 0, -rc / 2], rc / 2, t / 2), k1 = KK(s, [s, 0, -sw - tc / 2], tc / 2, t * 0.38)
  return loft([k0, k1, tipRound(k0, k1, 0.06)], { A: Z, B: Y, rings: 8, around: 20, foil: true, capStart: true, capEnd: true })
}

export function buildClassic(variant: number, hi: boolean): { parts: Parts; spec: ShipSpec } {
  const parts: Parts = new Map()
  let number: ShipSpec['number'] = { pos: [0, 0, 0], rotY: Math.PI / 2, tilt: 0, size: 0.8 }
  let wingtip: [number, number, number] = [3.45, 0.25, -2.9]
  if (hi) {
    const B = new B0(parts)
    B.add('paint', hullLoft(72, 60))
    // ── Canopy: a narrow bubble sunk into the spine (its sides meet the skin — no collar, no gap),
    // tilted with the spine's slope, a windscreen bow, and a fairing that runs it back into the spine.
    const cz = 1.35, cL = 1.45, cw = 0.44, cH = 0.5
    const slope = Math.atan2(hullY(0, cz + cL) - hullY(0, cz - cL), 2 * cL)
    const cy = hullY(cw * 0.92, cz) - 0.02
    const cRot = slope
    B.add('glass', new THREE.SphereGeometry(1, 36, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0, cy, cz, cRot, 0, 0, cw, cH, cL)
    {
      const dz = cL * 0.42, k = Math.sqrt(1 - (dz / cL) ** 2), pts: THREE.Vector3[] = []
      for (let i = 0; i <= 24; i++) { const ph = (Math.PI * i) / 24; pts.push(new THREE.Vector3(cw * k * Math.cos(ph) * 1.01, cH * k * Math.sin(ph) * 1.01, dz)) }
      B.add('carbon', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.022, 6), 0, cy, cz, cRot, 0, 0)
    }
    B.add('paint', fairing(0, [[cz - cL * 0.55, 0.0, cw * 0.82, cH * 0.62], [cz - cL - 0.4, -0.04, cw * 0.6, cH * 0.34], [cz - cL - 1.7, -0.1, 0.12, 0.05]], { capStart: true, capEnd: true }))
    // Inside: a dark tub, seat back with headrest, the pilot's helmet with a visor.
    B.add('carbon', new THREE.SphereGeometry(1, 20, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0, cy + 0.02, cz, cRot, 0, 0, cw * 0.95, 0.25, cL * 0.92)
    B.add('carbon', rbox(0.44, 0.42, 0.1), 0, cy + 0.22, cz - 0.55, cRot - 0.2, 0, 0)
    B.add('trim', new THREE.SphereGeometry(0.15, 16, 10), 0, cy + 0.32, cz - 0.38, 0, 0, 0, 0.92, 1, 1.05)
    B.add('glass', new THREE.SphereGeometry(0.155, 12, 6, -0.9, 1.8, 0.9, 0.9), 0, cy + 0.32, cz - 0.38)
    // ── Chine inlets (SR-71): fairings grown out of the hull with an open mouth, a dark duct and a
    // half-cone spike; they run back and sink into the skin.
    for (const sx of [1, -1]) {
      const ix = 1.12 * sx
      B.add('paint', fairing(ix, [[1.25, 0.15, 0.2, 0.17], [1.0, 0.16, 0.25, 0.2], [0.0, 0.12, 0.25, 0.19], [-1.2, 0.02, 0.17, 0.1], [-2.2, -0.04, 0.05, 0.02]], { capEnd: true }))
      const my = hullY(ix, 1.25) + 0.15
      B.add('carbon', loft([{ s: 0, c: [ix, my, 1.245], a: 0.185, t: 0.155, b: 0.155, n: 2.2 }, { s: 1, c: [ix, my, 0.95], a: 0.16, t: 0.13, b: 0.13, n: 2.2 }], { A: X, B: Y, rings: 1, around: 20, capEnd: true }))
      B.add('metal', new THREE.ConeGeometry(0.09, 0.32, 14).rotateX(Math.PI / 2), ix, my, 1.2)
    }
    // ── Engines: one aft body the three nozzles come out of (they sat on the deck as separate cans).
    B.add('paint', loft([
      { s: 0.8, c: [0, hullY(0, -0.8) - 0.12, -0.8], a: 0.45, t: 0.1, b: 0.1, n: 2.4 },
      { s: 1.8, c: [0, 0.62, -1.8], a: 1.25, t: 0.36, b: 0.3, n: 2.8 },
      { s: 2.9, c: [0, 0.55, -2.9], a: 1.78, t: 0.5, b: 0.4, n: 3.2 },
      { s: 4.2, c: [0, 0.48, -4.2], a: 1.72, t: 0.46, b: 0.36, n: 3.4 },
    ], { A: X, B: Y, rings: 20, around: 40, capEnd: true }))
    for (const [x, y] of NOZZLES) {
      B.add('carbon', nacelle(NR), x, y, NOZZLE_Z)
      // Flared petal skirt round the throat, the hot core inside.
      const k = NR / 0.6
      const sk = [new THREE.Vector2(0.6 * k, 0), new THREE.Vector2(0.63 * k, -0.12), new THREE.Vector2(0.64 * k, -0.28), new THREE.Vector2(0.58 * k, -0.3), new THREE.Vector2(0.56 * k, -0.05)]
      B.add('metal', new THREE.LatheGeometry(sk, 32).rotateX(Math.PI / 2), x, y, NOZZLE_Z)
      B.add('hot', new THREE.CircleGeometry(0.47 * k, 24), x, y, NOZZLE_Z + 0.4, 0, Math.PI, 0)
    }
    // ── Trailing-edge elevons: their own surfaces just behind the hull's edge — a real hinge gap,
    // not a painted line — drooped a touch.
    {
      const x0 = 1.8, x1 = 2.95, z0 = edgeZ(x0), z1 = edgeZ(x1)
      const ev = blade(x1 - x0, 0.42, 0.3, z0 - z1, 0.06)
      B.add('paint', ev, x0, 0.17, z0 - 0.035, -0.05, 0, 0)
      B.add('paint', mirrorX(ev), -x0, 0.17, z0 - 0.035, -0.05, 0, 0)
    }
    // ── Belly: a nose sensor blister and landing light, two flush hover-emitter slots on the chines.
    B.add('carbon', new THREE.SphereGeometry(1, 14, 7), 0, hullY(0, 3.2, false) + 0.02, 3.2, 0, 0, 0, 0.16, 0.07, 0.34)
    B.add('glow', new THREE.CircleGeometry(0.05, 16), 0, hullY(0, 3.6, false) - 0.004, 3.6, Math.PI / 2, 0, 0)
    for (const sx of [1, -1]) B.add('glow', loft([0.8, -0.6, -2.0].map((z, i) => ({ s: -z, c: [1.25 * sx, hullY(1.25, z, false) + 0.012, z] as [number, number, number], a: i === 1 ? 0.07 : 0.04, t: 0.012, b: 0.012, n: 2 })), { A: X, B: Y, rings: 10, around: 8, capStart: true, capEnd: true }))
    // ── A pitot at the tip.
    if (variant !== 2) B.add('metal', new THREE.CylinderGeometry(0.012, 0.022, 0.55, 8).rotateX(Math.PI / 2), 0, hullY(0, 5.5) - 0.03, 5.8)
    // Fins: swept and tapered, roots seated on the skin outboard of the engines; numbers on the
    // outer faces.
    const finAt = (fx: number, fz: number, rz: number, rl: number, tl: number, h: number, sw: number) => {
      const fy = hullY(fx, fz - rl / 2) - 0.03
      B.addSym('paint', fin(rl, tl, h, sw, 0.14), fx, fy, fz, 0, 0, rz)
      const u = 0.42 * h, back = sw * 0.42 + (rl + tl) * 0.25, off = 0.14 / 2 + 0.05
      number = { pos: [fx + Math.cos(rz) * off - Math.sin(rz) * u, fy + Math.sin(rz) * off + Math.cos(rz) * u, fz - back], rotY: Math.PI / 2, tilt: -rz, size: Math.min(0.85, h * 0.62) }
    }
    if (variant !== 1) {
      finAt(1.75, -2.1, -0.3, 1.5, 0.8, 1.25, 0.9)
      // Wingtip pods, faired into the tips (they hung off them on struts).
      for (const sx of [1, -1]) B.add('paint', loft([
        { s: 0, c: [3.02 * sx, 0.19, -1.4], a: 0.02, t: 0.02, b: 0.02, n: 2 },
        { s: 0.8, c: [3.02 * sx, 0.19, -2.2], a: 0.15, t: 0.13, b: 0.13, n: 2 },
        { s: 1.6, c: [3.02 * sx, 0.19, -3.0], a: 0.13, t: 0.12, b: 0.12, n: 2 },
      ], { A: X, B: Y, rings: 12, around: 16, capEnd: true }))
      B.addSym('glow', new THREE.CircleGeometry(0.09, 20), 3.02, 0.19, -3.005, 0, Math.PI, 0)
      wingtip = [3.02, 0.19, -3.0]
    }
    if (variant === 1) {
      // BULWARK: side sponsons on swept airfoil pylons, two tall fins.
      const py = blade(1.25, 1.2, 0.45, 0.55, 0.12)
      B.add('paint', py, 2.4, 0.22, 0.2); B.add('paint', mirrorX(py), -2.4, 0.22, 0.2)
      pod(B, 3.6, 0.24, 1.0, -2.3, 0.26, true)
      finAt(1.75, -2.0, -0.14, 1.6, 0.9, 1.9, 1.0)
      wingtip = [3.6, 0.24, -2.6]
    } else if (variant === 2) {
      // LANCE: a long pitot boom, canards off the chines, a dorsal fin on the engine body.
      B.add('metal', new THREE.CylinderGeometry(0.018, 0.05, 2.0, 8).rotateX(Math.PI / 2), 0, hullY(0, 5.5) - 0.03, 6.5)
      const cz2 = 3.1, cx = halfWidth(cz2) - 0.08
      const cn = blade(0.95, 0.7, 0.28, 0.4, 0.07)
      B.add('paint', cn, cx, hullY(cx, cz2 - 0.3) - 0.03, cz2, 0, 0, 0.05)
      B.add('paint', mirrorX(cn), -cx, hullY(cx, cz2 - 0.3) - 0.03, cz2, 0, 0, -0.05)
      B.add('paint', fin(1.3, 0.6, 1.1, 0.9, 0.14), 0, 1.0, -1.8)
    }
  } else {
    const L = new B0(parts)
    L.add('paint', hullLoft(26, 18))
    L.add('paint', loft([
      { s: 0.8, c: [0, 0.75, -0.8], a: 0.45, t: 0.1, b: 0.1, n: 2.4 },
      { s: 2.9, c: [0, 0.55, -2.9], a: 1.78, t: 0.5, b: 0.4, n: 3.2 },
      { s: 3.95, c: [0, 0.5, -3.95], a: 1.74, t: 0.48, b: 0.38, n: 3.4 },
    ], { A: X, B: Y, rings: 6, around: 14, capEnd: true }))
    for (const [x, y] of NOZZLES) {
      L.add('carbon', new THREE.CylinderGeometry(NR * 0.92, NR, 0.6, 10), x, y, NOZZLE_Z + 0.3, Math.PI / 2, 0, 0)
      L.add('hot', new THREE.CircleGeometry(NR * 0.78, 10), x, y, NOZZLE_Z - 0.04, 0, Math.PI, 0)
    }
    // Same silhouette as the detailed ship (no pop when the detail switches).
    if (variant === 1) {
      L.addSym('paint', new THREE.CapsuleGeometry(0.26, 2.8, 3, 8), 3.6, 0.24, -0.65, Math.PI / 2, 0, 0)
      L.addSym('paint', new THREE.BoxGeometry(0.14, 1.9, 1.3), 1.9, 1.45, -2.8, 0, 0, -0.14)
    } else {
      L.addSym('paint', new THREE.BoxGeometry(0.14, 1.25, 1.2), 1.9, 1.1, -2.8, 0, 0, -0.3)
    }
    if (variant === 2) L.add('paint', new THREE.BoxGeometry(0.14, 1.1, 1.2), 0, 1.5, -2.2)
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
