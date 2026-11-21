// The classic racer (the first model): stepped slab hull, side intakes, a framed canopy, canted fins,
// three nacelles with petal rings. Restored as its own family beside the lofted ships, at about
// twice the polygon count, with every box rounded (raw boxes read as programmer art).
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Parts, ShipSpec } from './shipdesign'

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
  s.lineTo(2.0 * k, -3.45 * k)
  s.lineTo(1.5 * k, -4.15 * k)
  s.lineTo(-1.5 * k, -4.15 * k)
  s.lineTo(-2.0 * k, -3.45 * k)
  s.lineTo(-3.15 * k, -2.75 * k)
  s.bezierCurveTo(-3.1 * k, -2.2 * k, -2.7 * k, -1.6 * k, -2.2 * k, -0.6 * k)
  s.bezierCurveTo(-1.0 * k, 2.4 * k, -0.45 * k, 4.6 * k, 0, 5.6 * k)
  return s
}

function slab(shape: THREE.Shape, depth: number, bevel: number, segs = 4): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: segs * 2, curveSegments: 64 })
  // rotateX(+90°): shape-y → +z (nose forward), extrusion → −y; lifted so it sits on y = 0.
  g.rotateX(Math.PI / 2)
  g.translate(0, depth, 0)
  g.computeVertexNormals()
  return g
}

export function buildClassic(variant: number, hi: boolean): { parts: Parts; spec: ShipSpec } {
  const parts: Parts = new Map()
  if (hi) {
    const B = new B0(parts)
    // ── hull: three stepped slabs, each smaller and higher ──
    B.add('paint', slab(hullShape(1), 0.3, 0.24, 5))
    B.add('carbon', slab(hullShape(0.93), 0.2, 0.12), 0, -0.3, -0.05)
    B.add('paint', slab(hullShape(0.7), 0.22, 0.16, 4), 0, 0.42, -0.35)
    // Spine + canopy with a frame.
    B.add('paint', new THREE.CapsuleGeometry(0.62, 4.0, 16, 40), 0, 0.66, -0.7, Math.PI / 2, 0, 0, 1.15, 1, 0.55)
    B.add('glass', new THREE.SphereGeometry(0.72, 56, 32), 0, 0.92, 1.45, 0, 0, 0, 0.86, 0.56, 2.15)
    B.add('carbon', rbox(0.07, 0.08, 2.9), 0, 1.31, 1.4)
    // Nose: a sensor strip and a splitter.
    B.add('glow', rbox(1.1, 0.05, 0.1), 0, 0.42, 4.55)
    B.add('carbon', rbox(1.6, 0.06, 1.4), 0, -0.25, 4.3, 0.05, 0, 0)
    // Side intakes (dark mouths behind the cockpit).
    B.addSym('carbon', rbox(0.55, 0.42, 1.7), 1.05, 0.62, 0.2, 0, -0.18, 0)
    B.addSym('metal', rbox(0.5, 0.06, 1.2), 1.07, 0.62, 0.35, 0, -0.18, 0)
    // Strakes and panel seams.
    B.addSym('trim', rbox(0.14, 0.07, 5.0), 0.95, 0.8, -0.2, 0, -0.12, 0)
    B.addSym('carbon', rbox(0.04, 0.04, 2.6), 1.75, 0.57, -1.4, 0, -0.55, 0)
    B.addSym('carbon', rbox(1.6, 0.04, 0.04), 1.6, 0.57, -2.4)
    B.addSym('trim', rbox(1.4, 0.05, 0.22), 2.3, 0.35, -1.2, 0, -0.62, 0)
    // Canted fins with tips.
    const fin = rbox(0.12, 1.2, 1.8)
    fin.translate(0, 0.6, 0)
    B.addSym('paint', fin, 1.55, 0.6, -3.25, -0.25, 0, -0.35)
    B.addSym('trim', rbox(0.12, 0.26, 0.7), 1.97, 1.66, -3.6, -0.25, 0, -0.35)
    // Wingtip pods (side thrusters) with glowing ports.
    B.addSym('carbon', new THREE.CylinderGeometry(0.22, 0.3, 1.7, 24), 3.0, 0.22, -2.1, Math.PI / 2, 0, 0)
    B.addSym('glow', new THREE.CylinderGeometry(0.12, 0.12, 0.08, 20), 3.0, 0.22, -1.22, Math.PI / 2, 0, 0)
    // Hover emitters underneath.
    B.addSym('glow', rbox(0.22, 0.05, 3.4), 2.0, -0.33, -0.6, 0, -0.5, 0)
    B.add('glow', rbox(0.9, 0.05, 0.2), 0, -0.33, 3.0)
    // Rear diffuser.
    for (const x of [-1.4, -0.7, 0, 0.7, 1.4]) B.add('carbon', rbox(0.06, 0.4, 1.1), x, -0.25, -3.75)
    // Nacelles, petal rings, hot cores.
    for (const [x, y] of NOZZLES) {
      B.add('carbon', new THREE.CylinderGeometry(0.52, 0.6, 2.0, 44, 1, true), x, y, NOZZLE_Z + 0.95, Math.PI / 2, 0, 0)
      B.add('metal', new THREE.TorusGeometry(0.54, 0.07, 16, 48), x, y, NOZZLE_Z + 0.05)
      B.add('metal', new THREE.TorusGeometry(0.58, 0.04, 12, 48), x, y, NOZZLE_Z + 1.6)
      for (let p = 0; p < 10; p++) {
        const a = (p / 10) * Math.PI * 2
        B.add('carbon', rbox(0.2, 0.04, 0.45), x + Math.cos(a) * 0.55, y + Math.sin(a) * 0.55, NOZZLE_Z - 0.1, 0, 0, a + Math.PI / 2)
      }
      B.add('hot', new THREE.CircleGeometry(0.34, 40), x, y, NOZZLE_Z + 0.25, 0, Math.PI, 0)
      B.add('carbon', new THREE.CylinderGeometry(0.47, 0.36, 0.3, 40, 1, true), x, y, NOZZLE_Z + 0.1, Math.PI / 2, 0, 0)
    }
    B.add('carbon', new THREE.CylinderGeometry(0.02, 0.03, 0.9, 16), -0.5, 1.2, -1.6, -0.3, 0, 0)
    // Light lines in the team colour along the leading edges, and a light bar across the tail.
    B.addSym('neon', rbox(0.06, 0.05, 3.3), 1.62, 0.36, 1.2, 0, -0.38, 0)
    B.addSym('neon', rbox(0.05, 0.05, 1.6), 2.55, 0.34, -1.9, 0, -0.95, 0)
    B.add('neon', rbox(2.6, 0.07, 0.06), 0, 0.5, -4.2)
    // Silhouettes: 1 = heavy (side pods, tall twin fins), 2 = needle (nose probe, canards, dorsal fin).
    if (variant === 1) {
      B.addSym('paint', new THREE.CapsuleGeometry(0.42, 3.2, 12, 32), 2.45, 0.28, -0.9, Math.PI / 2, 0, 0, 1, 1, 0.75)
      B.addSym('trim', rbox(0.1, 0.06, 3.0), 2.45, 0.6, -0.9)
      B.addSym('carbon', new THREE.CylinderGeometry(0.3, 0.38, 0.5, 28, 1, true), 2.45, 0.28, -2.95, Math.PI / 2, 0, 0)
      const tall = rbox(0.1, 1.9, 1.5)
      tall.translate(0, 0.95, 0)
      B.addSym('paint', tall, 1.1, 0.75, -3.4, -0.35, 0, -0.12)
      B.addSym('neon', rbox(0.12, 0.1, 0.9), 1.32, 2.5, -3.95, -0.35, 0, -0.12)
    } else if (variant === 2) {
      B.add('metal', new THREE.CylinderGeometry(0.04, 0.12, 2.4, 16), 0, 0.42, 6.6, Math.PI / 2, 0, 0)
      B.add('neon', new THREE.SphereGeometry(0.08, 16, 12), 0, 0.42, 7.8)
      B.addSym('paint', rbox(1.4, 0.06, 0.55), 1.35, 0.42, 3.0, 0, -0.5, 0)
      const dorsal = rbox(0.1, 1.5, 2.2)
      dorsal.translate(0, 0.75, 0)
      B.add('paint', dorsal, 0, 0.95, -2.9, -0.45, 0, 0)
      B.add('neon', rbox(0.12, 0.08, 1.8), 0, 2.15, -3.3, -0.45, 0, 0)
    }
    // The pilot under the (see-through) canopy.
    B.add('carbon', rbox(0.44, 0.5, 0.5), 0, 0.95, 0.75)
    B.add('trim', new THREE.SphereGeometry(0.2, 32, 20), 0, 1.08, 1.05, 0, 0, 0, 0.95, 1, 1.1)
  } else {
    const L = new B0(parts)
    L.add('paint', slab(hullShape(1), 0.45, 0.2, 1))
    L.add('paint', new THREE.CapsuleGeometry(0.6, 4.0, 2, 8), 0, 0.66, -0.7, Math.PI / 2, 0, 0, 1.1, 1, 0.55)
    for (const [x, y] of NOZZLES) {
      L.add('carbon', new THREE.CylinderGeometry(0.52, 0.6, 2.0, 8, 1, true), x, y, NOZZLE_Z + 0.95, Math.PI / 2, 0, 0)
      L.add('hot', new THREE.CircleGeometry(0.44, 8), x, y, NOZZLE_Z + 0.1, 0, Math.PI, 0)
    }
    L.addSym('trim', new THREE.BoxGeometry(0.14, 1.2, 1.8), 1.55, 1.2, -3.25, -0.25, 0, -0.35)
  }
  const spec: ShipSpec = {
    nozzles: NOZZLES,
    nozzleZ: NOZZLE_Z,
    wingtip: [3.15, 0.2, -2.6],
    number: { pos: [1.92, 1.2, -3.3], rotY: Math.PI / 2, tilt: -0.35, size: 0.85 },
  }
  return { parts, spec }
}
