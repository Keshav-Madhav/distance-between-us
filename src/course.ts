// The race course: a 40 km loop through the desert. A perturbed ellipse, resampled to an even 40 m
// polyline (the racing line the AI follows and the minimap draws), with:
//   gates      — 14 checkpoints: two 90 m towers and a glowing banner, the next one lit
//   pylons     — knee-high markers down both edges every 320 m (they read speed as much as track)
//   boost pads — glowing chevron strips on the line: run over one for a shove
//   mounds     — jumps on and beside the line (terrain.ts): their crests launch you
import * as THREE from 'three'
import { groundH, setMounds } from './terrain'
import { patchStandard, SKY_FOG_ONLY } from './shaders'

const STEP = 40
export const GATE_HALF = 260
export const LAPS = 3
/** Where the jumps are, as fractions of a lap (the test hooks use these too). */
export const JUMPS = [0.075, 0.17, 0.3, 0.41, 0.55, 0.64, 0.77, 0.88, 0.95]

export interface Checkpoint {
  x: number; z: number
  tx: number; tz: number
  /** Polyline index. */
  i: number
}

export interface Pad { x: number; z: number; tx: number; tz: number }

export class Course {
  /** Polyline x, z (closed: the last point joins the first). */
  readonly px: Float64Array
  readonly pz: Float64Array
  readonly n: number
  readonly length: number
  readonly cps: Checkpoint[] = []
  readonly pads: Pad[] = []
  /** Spires standing on the straights (collide; the AI steers round them). lat: offset to the right. */
  readonly rocks: { x: number; z: number; r: number; h: number; i: number; lat: number }[] = []
  readonly group = new THREE.Group()
  private readonly beamMesh: THREE.InstancedMesh
  private readonly towerLights: THREE.InstancedMesh
  private readonly curtain: THREE.Mesh
  private readonly curtainMat: THREE.ShaderMaterial
  private readonly padMat: THREE.ShaderMaterial
  /** Two light pillars into the sky over the next gate: visible from kilometres away. */
  private readonly pillars: THREE.Mesh[] = []
  private readonly pillarMat: THREE.ShaderMaterial
  private readonly pillarMat2: THREE.ShaderMaterial
  private readonly col = new THREE.Color()

  constructor() {
    // Dense sample of the curve, then resample to even arc length.
    // A stadium figure-8, 84 km a lap: two loops of R = 5 km around (±C, 0), joined by two dead-straight
    // 23 km runs that cross at the origin (51° apart). The straights are the race — flat out, small
    // corrections, weaving through rock — and the loops are long sweepers, one right-hand, one left.
    // (A tighter 40 km figure-8 had turns too sharp for Mach 5: user, 2026-11-20.)
    const C = 11500, R = 5000
    const phi = Math.asin(R / C)
    const L = Math.sqrt(C * C - R * R)
    const raw: [number, number][] = []
    const line = (x0: number, z0: number, x1: number, z1: number) => {
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 5)
      for (let i = 0; i < n; i++) raw.push([x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n])
    }
    const arc = (cx: number, a0: number, a1: number) => {
      const n = Math.ceil((Math.abs(a1 - a0) * R) / 5)
      for (let i = 0; i < n; i++) { const a = a0 + ((a1 - a0) * i) / n; raw.push([cx + Math.cos(a) * R, Math.sin(a) * R]) }
    }
    const cf = Math.cos(phi), sf = Math.sin(phi)
    const thR = Math.atan2(L * sf, L * cf - C) // the right loop's top tangent point, about its centre
    const thL = Math.atan2(L * sf, -L * cf + C)
    line(0, 0, L * cf, L * sf) // out along the first straight
    arc(C, thR, -thR) // round the right loop, far side
    line(L * cf, -L * sf, -L * cf, L * sf) // back across the crossing
    arc(-C, thL, 2 * Math.PI - thL) // round the left loop
    line(-L * cf, -L * sf, 0, 0) // home to the crossing
    // Start on the first straight, 4.5 km clear of the crossing.
    const s0 = raw.findIndex(([x, z]) => Math.hypot(x, z) > 4500)
    raw.push(...raw.splice(0, s0))
    const M = raw.length
    let total = 0
    const seg: number[] = []
    for (let i = 0; i < M; i++) {
      const p = raw[i], q = raw[(i + 1) % M]
      const d = Math.hypot(q[0] - p[0], q[1] - p[1])
      seg.push(d)
      total += d
    }
    const n = Math.floor(total / STEP)
    this.n = n
    this.length = n * STEP
    this.px = new Float64Array(n)
    this.pz = new Float64Array(n)
    let acc = 0, j = 0
    for (let k = 0; k < n; k++) {
      const target = (k / n) * total
      while (acc + seg[j] < target) { acc += seg[j]; j = (j + 1) % M }
      const u = (target - acc) / seg[j]
      const p = raw[j], q = raw[(j + 1) % M]
      this.px[k] = p[0] + (q[0] - p[0]) * u
      this.pz[k] = p[1] + (q[1] - p[1]) * u
    }

    // Checkpoints (nudged off the crossing, where the other straight would run through them).
    const K = 16
    for (let k = 0; k < K; k++) {
      let i = Math.round((k / K) * n) % n
      for (let g = 0; g < 120 && Math.hypot(this.px[i], this.pz[i]) < 2000; g++) i = (i + 1) % n
      const [tx, tz] = this.tangent(i)
      this.cps.push({ x: this.px[i], z: this.pz[i], tx, tz, i })
    }

    // Jumps: big mounds on the line, a few beside it (a choice of line).
    const mounds: number[] = []
    const onLine = JUMPS
    const clearOfCrossing = (i: number) => Math.hypot(this.px[i % n], this.pz[i % n]) > 1600
    onLine.forEach((f, k) => {
      const i = Math.round(f * n)
      if (!clearOfCrossing(i)) return
      const [tx, tz] = this.tangent(i)
      const off = k % 3 === 1 ? 110 : k % 3 === 2 ? -110 : 0
      mounds.push(this.px[i] + tz * off, this.pz[i] - tx * off, 26 + (k % 4) * 4, 125 + (k % 3) * 20)
    })
    // Rolling humps in a few runs (whoops), smaller.
    for (const f of [0.22, 0.7]) {
      for (let w = 0; w < 4; w++) {
        const i = Math.round(f * n) + w * 8
        if (!clearOfCrossing(i)) continue
        mounds.push(this.px[i % n], this.pz[i % n], 7, 90)
      }
    }
    setMounds(mounds)

    // Boost pads.
    for (const [f, off] of [[0.035, 0], [0.12, 70], [0.26, -70], [0.36, 0], [0.5, 60], [0.6, -60], [0.72, 0], [0.83, 70], [0.92, -40]] as const) {
      const i = Math.round(f * n)
      if (!clearOfCrossing(i)) continue
      const [tx, tz] = this.tangent(i)
      this.pads.push({ x: this.px[i] + tz * off, z: this.pz[i] - tx * off, tx, tz })
    }

    // Rock spires along the course (mostly the straights — that is most of it): on and beside the line,
    // to weave through at speed. Never at a
    // gate, a pad, a jump or the crossing, nor in the first 4 km.
    {
      let seed = 99
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      let i = Math.round(4000 / STEP)
      while (i < n - 20) {
        i += Math.round((800 + rnd() * 1200) / STEP)
        if (i >= n - 20) break
        const lat = (rnd() * 2 - 1) * 170
        const [tx, tz] = this.tangent(i)
        const x = this.px[i] - tz * lat, z = this.pz[i] + tx * lat
        const r = 18 + rnd() * 22
        if (Math.hypot(x, z) < 2200) continue
        if (this.cps.some((c) => Math.hypot(c.x - x, c.z - z) < 500)) continue
        if (this.pads.some((p) => Math.hypot(p.x - x, p.z - z) < 400)) continue
        let nearMound = false
        for (let m = 0; m < mounds.length; m += 4) if (Math.hypot(mounds[m] - x, mounds[m + 1] - z) < mounds[m + 3] * 1.6 + 80) nearMound = true
        if (nearMound) continue
        this.rocks.push({ x, z, r, h: 70 + rnd() * 110, i, lat })
      }
    }

    // ── gates ──
    const dark = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.45, metalness: 0.8 })
    patchStandard(dark)
    // Square towers (faces along the track), a lit strip pair on each inner face.
    const towerGeo = new THREE.BoxGeometry(11, 140, 11)
    towerGeo.translate(0, 70, 0)
    const towers = new THREE.InstancedMesh(towerGeo, dark, K * 2)
    const lightGeo = new THREE.BoxGeometry(0.8, 122, 2.2)
    lightGeo.translate(0, 74, 0)
    this.towerLights = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), K * 4)
    const beamGeo = new THREE.BoxGeometry(GATE_HALF * 2 + 11, 9, 4)
    this.beamMesh = new THREE.InstancedMesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), K)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3()
    const Y = new THREE.Vector3(0, 1, 0)
    for (let k = 0; k < K; k++) {
      const c = this.cps[k]
      const yaw = Math.atan2(c.tx, c.tz)
      q.setFromAxisAngle(Y, yaw)
      let hmax = -1e9
      for (const side of [-1, 1]) {
        // Normal to the right: (tz, -tx).
        const x = c.x + c.tz * GATE_HALF * side, z = c.z - c.tx * GATE_HALF * side
        const g = groundH(x, z)
        hmax = Math.max(hmax, g)
        towers.setMatrixAt(k * 2 + (side > 0 ? 1 : 0), m.compose(v.set(x, g - 4, z), q, s))
        for (const off of [-2.8, 2.8]) {
          // On the face toward the track: −side along the normal (tz, −tx).
          const lx = x + c.tx * off - c.tz * 5.7 * side, lz = z + c.tz * off + c.tx * 5.7 * side
          this.towerLights.setMatrixAt(k * 4 + (side > 0 ? 2 : 0) + (off > 0 ? 1 : 0), m.compose(v.set(lx, g - 4, lz), q, s))
        }
      }
      this.beamMesh.setMatrixAt(k, m.compose(v.set(c.x, hmax + 132, c.z), q, s))
    }
    for (const im of [towers, this.towerLights, this.beamMesh]) { im.frustumCulled = false; this.group.add(im) }

    // The next gate's holographic curtain: you see that you fly through it.
    this.curtainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0.2, 1.4, 2.0) }, uA: { value: 1 } },
      vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor; uniform float uA; varying vec2 vUv; varying vec3 vW;
        void main() {
          float scan = 0.55 + 0.45 * sin(vUv.y * 90.0 - uTime * 8.0);
          float edge = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x);
          float top = smoothstep(1.0, 0.85, vUv.y) * 0.6 + 0.4;
          float bottom = smoothstep(0.0, 0.25, vUv.y);
          float frame = max(1.0 - smoothstep(0.0, 0.012, vUv.x), 1.0 - smoothstep(0.988, 1.0, vUv.x));
          // Close to it, it fades (it would otherwise fill the screen for a frame).
          float d = length(vW - cameraPosition);
          float near = smoothstep(40.0, 260.0, d);
          gl_FragColor = vec4(uColor * (0.08 * scan * top * edge * bottom + frame * 0.6) * uA * near, 1.0);
        }`,
    })
    this.curtain = new THREE.Mesh(new THREE.PlaneGeometry(GATE_HALF * 2, 128), this.curtainMat)
    this.curtain.frustumCulled = false
    this.group.add(this.curtain)

    this.pillarMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0.2, 1.4, 2.0) } },
      vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          float core = pow(abs(dot(vN, vV)), 2.0);
          float up = pow(1.0 - vUv.y, 1.4);
          float pulse = 0.8 + 0.2 * sin(uTime * 5.0 - vUv.y * 30.0);
          gl_FragColor = vec4(uColor * core * up * pulse * 1.3, 1.0);
        }`,
    })
    const pillarGeo = new THREE.CylinderGeometry(7, 7, 2400, 16, 1, true)
    pillarGeo.translate(0, 1200, 0)
    // The gate after next: thinner, fainter pillars (you see the next turn coming).
    this.pillarMat2 = this.pillarMat.clone()
    this.pillarMat2.uniforms.uColor.value = new THREE.Color(0.05, 0.35, 0.5)
    for (let j = 0; j < 4; j++) {
      const p = new THREE.Mesh(pillarGeo, j < 2 ? this.pillarMat : this.pillarMat2)
      if (j >= 2) p.scale.set(0.55, 0.75, 0.55)
      p.frustumCulled = false
      p.renderOrder = 6
      this.pillars.push(p)
      this.group.add(p)
    }

    // ── pylons along both edges ──
    const pylonEvery = 8 // × 40 m
    const nPy = Math.ceil(n / pylonEvery) * 2
    const pyGeo = new THREE.CylinderGeometry(0.5, 0.9, 7, 6)
    pyGeo.translate(0, 3.5, 0)
    const pyTip = new THREE.BoxGeometry(1.4, 1.6, 1.4)
    pyTip.translate(0, 7.6, 0)
    const pylons = new THREE.InstancedMesh(pyGeo, dark, nPy)
    const tips = new THREE.InstancedMesh(pyTip, new THREE.MeshBasicMaterial({ color: 0xffffff }), nPy)
    let pi = 0
    for (let i = 0; i < n; i += pylonEvery) {
      const [tx, tz] = this.tangent(i)
      for (const side of [-1, 1]) {
        const x = this.px[i] + tz * 250 * side, z = this.pz[i] - tx * 250 * side
        m.compose(v.set(x, groundH(x, z) - 0.3, z), q.identity(), s)
        pylons.setMatrixAt(pi, m)
        tips.setMatrixAt(pi, m)
        // Orange on the outside of each turn's left, white on the right: you read the edges.
        tips.setColorAt(pi, this.col.setRGB(side < 0 ? 5 : 4, side < 0 ? 1.4 : 4, side < 0 ? 0.3 : 4.5))
        pi++
      }
    }
    for (const im of [pylons, tips]) { im.frustumCulled = false; im.count = pi; this.group.add(im) }

    // ── boost pads ──
    this.padMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        uniform float uTime; varying vec2 vUv; varying vec3 vW;
        ${SKY_FOG_ONLY}
        void main() {
          // Chevrons racing forward along the strip.
          float x = abs(vUv.x - 0.5) * 2.0;
          float ch = fract(vUv.y * 7.0 - x * 0.6 - uTime * 2.5);
          float band = smoothstep(0.0, 0.08, ch) * (1.0 - smoothstep(0.32, 0.4, ch));
          float edge = 1.0 - smoothstep(0.85, 1.0, x);
          float rim = smoothstep(0.86, 0.96, x) * (1.0 - smoothstep(0.96, 1.0, x));
          vec3 c = vec3(0.25, 1.4, 2.4) * (band * edge * 0.9 + rim * 0.8 + 0.06);
          c *= 1.0 - fogAmount(vW);
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
    for (const p of this.pads) this.group.add(this.padMesh(p))
  }

  /**
   * Where races have worn the ground: R = packed, darker sand along the line (soft falloff over
   * ~250 m), G = scorch lanes (broken streaks from a thousand exhausts). Box = (minX, minZ, w, h).
   */
  wearTexture(): { tex: THREE.Texture; box: THREE.Vector4 } {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (let i = 0; i < this.n; i++) { x0 = Math.min(x0, this.px[i]); x1 = Math.max(x1, this.px[i]); z0 = Math.min(z0, this.pz[i]); z1 = Math.max(z1, this.pz[i]) }
    const m = 700
    x0 -= m; x1 += m; z0 -= m; z1 += m
    const W = 2048, H = Math.min(2048, Math.ceil(((z1 - z0) / (x1 - x0)) * W / 4) * 4)
    const kx = W / (x1 - x0), kz = H / (z1 - z0)
    const cv = document.createElement('canvas')
    cv.width = W; cv.height = H
    const g = cv.getContext('2d')!
    g.fillStyle = '#000'
    g.fillRect(0, 0, W, H)
    g.globalCompositeOperation = 'lighter'
    g.lineJoin = 'round'
    g.lineCap = 'round'
    const path = (off: number) => {
      g.beginPath()
      for (let i = 0; i <= this.n; i++) {
        const k = i % this.n
        const [tx, tz] = this.tangent(k)
        const x = this.px[k] - tz * off, z = this.pz[k] + tx * off
        if (i === 0) g.moveTo((x - x0) * kx, (z - z0) * kz); else g.lineTo((x - x0) * kx, (z - z0) * kz)
      }
    }
    for (const [w, a] of [[560, 0.12], [440, 0.14], [330, 0.16], [230, 0.18], [140, 0.2], [70, 0.16]] as const) {
      g.strokeStyle = `rgba(255,0,0,${a})`
      g.lineWidth = w * kx
      path(0)
      g.stroke()
    }
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let l = 0; l < 46; l++) {
      const off = (rnd() + rnd() + rnd() - 1.5) * 150
      g.strokeStyle = `rgba(0,255,0,${0.12 + rnd() * 0.3})`
      g.lineWidth = Math.max(1, (2 + rnd() * 5) * kx)
      g.setLineDash([(200 + rnd() * 1800) * kx, (100 + rnd() * 900) * kx])
      g.lineDashOffset = rnd() * 3000
      path(off)
      g.stroke()
    }
    g.setLineDash([])
    const tex = new THREE.CanvasTexture(cv)
    tex.flipY = false
    tex.colorSpace = THREE.NoColorSpace
    tex.anisotropy = 4
    return { tex, box: new THREE.Vector4(x0, z0, x1 - x0, z1 - z0) }
  }

  /** A strip 60 × 140 m draped on the terrain. */
  private padMesh(p: Pad): THREE.Mesh {
    const g = new THREE.PlaneGeometry(60, 140, 6, 14)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position as THREE.BufferAttribute
    const yaw = Math.atan2(p.tx, p.tz)
    const c = Math.cos(yaw), s = Math.sin(yaw)
    for (let i = 0; i < pos.count; i++) {
      // Plane local: x across, -z along (rotated): map so +along = tangent.
      const lx = pos.getX(i), lz = -pos.getZ(i)
      const x = p.x + lx * c + lz * s
      const z = p.z - lx * s + lz * c
      pos.setXYZ(i, x, groundH(x, z) + 0.35, z)
    }
    const mesh = new THREE.Mesh(g, this.padMat)
    mesh.frustumCulled = false
    mesh.renderOrder = 1
    return mesh
  }

  tangent(i: number): [number, number] {
    const n = this.n
    const a = ((i - 2) % n + n) % n, b = (i + 2) % n
    const dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a]
    const l = Math.hypot(dx, dz) || 1
    return [dx / l, dz / l]
  }

  /** Nearest polyline index to (x, z), searched around `hint` (or everywhere when hint < 0). */
  nearest(x: number, z: number, hint: number): number {
    const n = this.n
    let best = 0, bd = Infinity
    if (hint < 0) {
      for (let i = 0; i < n; i++) {
        const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2
        if (d < bd) { bd = d; best = i }
      }
      return best
    }
    for (let k = -30; k <= 60; k++) {
      const i = ((hint + k) % n + n) % n
      const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2
      if (d < bd) { bd = d; best = i }
    }
    return best
  }

  private grid: Map<number, number[]> | null = null
  /** How far (m) the course is from (x, z), up to ~3 km (beyond that: Infinity). A 1 km grid of the
   *  line's points keeps the tens of thousands of startup queries (mesa placement) cheap. */
  distance(x: number, z: number): number {
    const G = 1000
    if (!this.grid) {
      this.grid = new Map()
      for (let i = 0; i < this.n; i += 2) {
        const key = Math.floor(this.px[i] / G) * 100003 + Math.floor(this.pz[i] / G)
        let a = this.grid.get(key)
        if (!a) this.grid.set(key, (a = []))
        a.push(i)
      }
    }
    const cx = Math.floor(x / G), cz = Math.floor(z / G)
    let bd = Infinity
    for (let ix = -3; ix <= 3; ix++) for (let iz = -3; iz <= 3; iz++) {
      const a = this.grid.get((cx + ix) * 100003 + cz + iz)
      if (!a) continue
      for (const i of a) {
        const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2
        if (d < bd) bd = d
      }
    }
    return Math.sqrt(bd)
  }

  /** Light the gates: `next` bright (pulsing), the finish orange, the rest dim. */
  update(next: number, time: number, finalLap: boolean): void {
    const K = this.cps.length
    for (let k = 0; k < K; k++) {
      const isNext = k === next
      const isAfter = next >= 0 && k === (next + 1) % K
      const pulse = 0.75 + 0.25 * Math.sin(time * 6)
      if (k === 0) this.col.setRGB(5, 1.6, 0.3).multiplyScalar(isNext ? pulse * 1.4 : isAfter ? 1 : 0.7)
      else if (isNext) this.col.setRGB(0.6, 3.2, 5).multiplyScalar(pulse)
      else if (isAfter) this.col.setRGB(0.4, 1.6, 2.4).multiplyScalar(0.6)
      else this.col.setRGB(1.6, 1.2, 0.9).multiplyScalar(0.55)
      this.beamMesh.setColorAt(k, this.col)
      for (let j = 0; j < 4; j++) this.towerLights.setColorAt(k * 4 + j, this.col)
    }
    if (this.beamMesh.instanceColor) this.beamMesh.instanceColor.needsUpdate = true
    if (this.towerLights.instanceColor) this.towerLights.instanceColor.needsUpdate = true
    const c = this.cps[next]
    if (c) {
      const g = Math.max(groundH(c.x + c.tz * GATE_HALF, c.z - c.tx * GATE_HALF), groundH(c.x - c.tz * GATE_HALF, c.z + c.tx * GATE_HALF))
      this.curtain.position.set(c.x, g + 62, c.z)
      for (let j = 0; j < 2; j++) {
        const sd = j === 0 ? 1 : -1
        const x = c.x + c.tz * GATE_HALF * sd, z = c.z - c.tx * GATE_HALF * sd
        this.pillars[j].position.set(x, groundH(x, z), z)
      }
      this.curtain.rotation.set(0, Math.atan2(c.tx, c.tz), 0)
      this.curtainMat.uniforms.uColor.value.setRGB(...((next === 0 ? [2.4, 0.9, 0.2] : [0.2, 1.4, 2.0]) as [number, number, number]))
      this.curtainMat.uniforms.uA.value = next === 0 && finalLap ? 1.6 : 1
      this.pillarMat.uniforms.uColor.value.copy(this.curtainMat.uniforms.uColor.value)
    }
    const c2 = next >= 0 ? this.cps[(next + 1) % K] : undefined
    if (c2) for (let j = 0; j < 2; j++) {
      const sd = j === 0 ? 1 : -1
      const x = c2.x + c2.tz * GATE_HALF * sd, z = c2.z - c2.tx * GATE_HALF * sd
      this.pillars[2 + j].position.set(x, groundH(x, z), z)
    }
    for (let j = 0; j < 4; j++) this.pillars[j].visible = j < 2 ? !!c : !!c2
    this.pillarMat.uniforms.uTime.value = time
    this.pillarMat2.uniforms.uTime.value = time
    this.curtainMat.uniforms.uTime.value = time
    this.padMat.uniforms.uTime.value = time
  }
}
