// The race course: a 165 km sprint across the desert, resampled to an even 40 m polyline (the
// racing line the AI follows and the minimap draws), with:
//   gates      — every ~5 km: two 140 m towers and a glowing banner, the next one lit
//   pylons     — knee-high markers down both edges every 320 m (they read speed as much as track)
//   boost pads — glowing chevron strips on the line: run over one for a shove
//   mounds     — jumps on and beside the line (terrain.ts): their crests launch you
import * as THREE from 'three'
import { groundH, setMounds } from './terrain'
import { patchStandard, SKY_FOG_ONLY } from './shaders'

const STEP = 40
export const GATE_HALF = 260
export const LAPS = 1
/** The sprint's length (km). */
export const SPRINT_KM = 165
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
  /** Polyline x, z (open: a run-up, the race, a run-off). */
  readonly px: Float64Array
  readonly pz: Float64Array
  readonly n: number
  readonly length: number
  readonly cps: Checkpoint[] = []
  readonly pads: Pad[] = []
  /** Spires standing on the straights (collide; the AI steers round them). lat: offset to the right. */
  readonly rocks: { x: number; z: number; r: number; h: number; i: number; lat: number }[] = []
  readonly group = new THREE.Group()
  /** Polyline indices of the start and finish lines (the line runs on past both). */
  readonly startI: number
  readonly finishI: number
  readonly box: { x0: number; x1: number; z0: number; z1: number }
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
    // A sprint, not a loop: 130 km across the desert, nearly straight. Two slow sine bends (62 km and
    // 23.5 km wavelengths, radius never under ~6 km) ease in after the first 8 km. A 3 km run-up holds
    // the grid; a 6 km run-off past the finish. (A looping course kept turning — "why make it a loop,
    // can make it much much more straight": user, 2026-11-20.)
    const RUNUP = 3000, RACE = SPRINT_KM * 1000, RUNOFF = 6000
    const xAt = (z: number) => {
      const ramp = z <= 0 ? 0 : z >= 8000 ? 1 : (z / 8000) ** 2 * (3 - (2 * z) / 8000)
      // Three S-bend sections (14 km wavelength, radius ≥ ~4.5 km) eased in and out of the long run.
      let ess = 0
      for (const c of [40000, 95000, 145000]) {
        const d = Math.abs(z - c) / 12000
        if (d < 1) ess += (1 - d * d) ** 2 * 1100 * Math.sin((2 * Math.PI * (z - c)) / 14000)
      }
      return ramp * (4200 * Math.sin((2 * Math.PI * z) / 62000) + 1800 * Math.sin((2 * Math.PI * z) / 23500 + 1.2) - 1800 * Math.sin(1.2) + ess)
    }
    const raw: [number, number][] = []
    for (let z = -RUNUP; z <= RACE + RUNOFF; z += 5) raw.push([xAt(z), z])
    const M = raw.length
    let total = 0
    const seg: number[] = []
    for (let i = 0; i < M - 1; i++) {
      const d = Math.hypot(raw[i + 1][0] - raw[i][0], raw[i + 1][1] - raw[i][1])
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
      const target = k * STEP
      while (j < M - 2 && acc + seg[j] < target) { acc += seg[j]; j++ }
      const u = Math.min(1, (target - acc) / seg[j])
      const p = raw[j], q = raw[j + 1]
      this.px[k] = p[0] + (q[0] - p[0]) * u
      this.pz[k] = p[1] + (q[1] - p[1]) * u
    }
    // Arc-length index of a distance (m) from the start line.
    let startI = 0
    while (startI < n - 1 && this.pz[startI] < 0) startI++
    this.startI = startI
    const at = (m: number) => Math.min(n - 1, startI + Math.round(m / STEP))
    // The race distance along the line (not z): find the finish by walking the arc.
    const finishI = Math.min(n - 1, startI + Math.round((RACE * 1.02) / STEP))
    this.finishI = finishI
    const raceLen = (finishI - startI) * STEP

    // Gates: the start, one every ~5 km, the finish.
    const K = Math.round(raceLen / 5000) + 1
    for (let k = 0; k < K; k++) {
      const i = k === K - 1 ? finishI : startI + Math.round((k * raceLen) / (K - 1) / STEP)
      const [tx, tz] = this.tangent(i)
      this.cps.push({ x: this.px[i], z: this.pz[i], tx, tz, i })
    }

    // Jumps: big mounds on the line, a few beside it (a choice of line); a few runs of whoops.
    const mounds: number[] = []
    const clear = (i: number) => i > startI + 75 && i < finishI - 50
    JUMPS.forEach((f, k) => {
      const i = at(f * raceLen)
      if (!clear(i)) return
      const [tx, tz] = this.tangent(i)
      const off = k % 3 === 1 ? 110 : k % 3 === 2 ? -110 : 0
      mounds.push(this.px[i] + tz * off, this.pz[i] - tx * off, 26 + (k % 4) * 4, 125 + (k % 3) * 20)
    })
    for (const f of [0.22, 0.52, 0.81]) {
      for (let w = 0; w < 4; w++) {
        const i = at(f * raceLen) + w * 8
        if (clear(i)) mounds.push(this.px[i], this.pz[i], 7, 90)
      }
    }
    setMounds(mounds)

    // Boost pads, every ~9 km, alternating sides.
    for (let k = 0, m = 4000; m < raceLen - 3000; k++, m += 8000 + ((k * 2711) % 2000)) {
      const i = at(m)
      const off = k % 3 === 0 ? 0 : k % 3 === 1 ? 70 : -70
      const [tx, tz] = this.tangent(i)
      this.pads.push({ x: this.px[i] + tz * off, z: this.pz[i] - tx * off, tx, tz })
    }

    // Rock spires: on and beside the line, every 0.8–2 km, to weave through at speed. Never at a gate,
    // a pad or a jump, nor in the first 4 km.
    {
      let seed = 99
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      let i = startI + Math.round(4000 / STEP)
      while (i < finishI - 40) {
        i += Math.round((800 + rnd() * 1200) / STEP)
        if (i >= finishI - 40) break
        const lat = (rnd() * 2 - 1) * 170
        const [tx, tz] = this.tangent(i)
        const x = this.px[i] - tz * lat, z = this.pz[i] + tx * lat
        const r = 18 + rnd() * 22
        if (this.cps.some((c) => Math.hypot(c.x - x, c.z - z) < 500)) continue
        if (this.pads.some((p) => Math.hypot(p.x - x, p.z - z) < 400)) continue
        let nearMound = false
        for (let m = 0; m < mounds.length; m += 4) if (Math.hypot(mounds[m] - x, mounds[m + 1] - z) < mounds[m + 3] * 1.6 + 80) nearMound = true
        if (nearMound) continue
        this.rocks.push({ x, z, r, h: 70 + rnd() * 110, i, lat })
        // Now and then a rock gate: a second spire across the line, leaving a slot to thread.
        if (rnd() < 0.22 && Math.abs(lat) < 120) {
          const gap = 120 + rnd() * 60
          const lat2 = lat + (lat > 0 ? -1 : 1) * (gap + r * 2)
          const r2 = 18 + rnd() * 16
          this.rocks.push({ x: this.px[i] - tz * lat2, z: this.pz[i] + tx * lat2, r: r2, h: 80 + rnd() * 100, i, lat: lat2 })
        }
      }
    }
    let x0 = Infinity, x1 = -Infinity
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, this.px[i]); x1 = Math.max(x1, this.px[i]) }
    this.box = { x0, x1, z0: this.pz[0], z1: this.pz[n - 1] }

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
    const beamGeo = new THREE.BoxGeometry(GATE_HALF * 2 + 11, 5, 2.5)
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
          // Mostly see-through: thin scan lines and a bright frame read from kilometres away, and the
          // whole curtain fades out as you close in, so whatever stands behind the gate shows early.
          float scan = smoothstep(0.82, 1.0, sin(vUv.y * 70.0 - uTime * 6.0));
          float edge = smoothstep(0.0, 0.04, vUv.x) * (1.0 - smoothstep(0.96, 1.0, vUv.x));
          float bottom = smoothstep(0.0, 0.25, vUv.y);
          float frame = max(1.0 - smoothstep(0.0, 0.01, vUv.x), 1.0 - smoothstep(0.99, 1.0, vUv.x));
          float d = length(vW - cameraPosition);
          float near = smoothstep(350.0, 1500.0, d);
          gl_FragColor = vec4(uColor * (0.035 * scan * edge * bottom + frame * 0.5) * uA * near, 1.0);
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
          float up = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.4);
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
    const H = 8192, W = Math.max(64, Math.ceil(((x1 - x0) / (z1 - z0)) * H / 4) * 4)
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
      for (let i = 0; i < this.n; i++) {
        const k = i
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
    const a = Math.max(0, Math.min(n - 1, i - 2)), b = Math.max(0, Math.min(n - 1, i + 2))
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
      const i = hint + k
      if (i < 0 || i >= n) continue
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
      const isAfter = next >= 0 && k === next + 1
      const pulse = 0.75 + 0.25 * Math.sin(time * 6)
      if (k === 0 || k === K - 1) this.col.setRGB(5, 1.6, 0.3).multiplyScalar(isNext ? pulse * 1.4 : isAfter ? 1 : 0.7)
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
      this.curtainMat.uniforms.uColor.value.setRGB(...((next === 0 || next === K - 1 ? [2.4, 0.9, 0.2] : [0.2, 1.4, 2.0]) as [number, number, number]))
      this.curtainMat.uniforms.uA.value = next === K - 1 || finalLap ? 1.6 : 1
      this.pillarMat.uniforms.uColor.value.copy(this.curtainMat.uniforms.uColor.value)
    }
    const c2 = next >= 0 ? this.cps[next + 1] : undefined
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
