// The gorge courses: two continuous walls that follow a whole loop, one each side of a wide floor —
// one strip of geometry per side, sampled every ~200 m round the closed loop: no gaps, no holes. Each
// world has one, with its own cross-section and dressing:
//   desert  CANYON RUN — the Grand Canyon's stepped cliffs up to a flat rim, a 3.6 km plateau.
//   ice     BLUE HOLLOW — a glacier cave: ice walls arching into a roof over the whole loop, lamplit.
//   lava    MAGMA GORGE — sheer basalt, lava glowing along both feet and in seams up the walls.
//   forest  WHITEWATER — a river gorge: granite banks under forest, the race on the water itself.
// The walls are solid: World.near asks wallsNear for a huge round "rock" whose surface is the wall's
// foot (inside) or the outer face (outside), so a wall is the same glance-and-scrape as any rock.
import * as THREE from 'three'
import { groundH } from './terrain'

export type GorgeStyle = 'desert' | 'ice' | 'lava' | 'forest'

interface Style {
  /** The wall's cross-section from its foot outward: [metres out, height, material mask (aCrev)]. */
  profile: [number, number, number][]
  /** Floor half-width (m) round the loop (u in 0…1). */
  half: (u: number) => number
  /** Height above the floor (m) under which a wall is in the way. */
  rim: number
  /** Out from the foot (m) to the outer face. */
  outer: number
  /** How much the height wanders along the wall (±). */
  hk: number
  /** Ledge jitter (m). */
  jit: number
  /** A roof over the floor at this height (the cave). */
  roof?: number
}

const STYLES: Record<GorgeStyle, Style> = {
  desert: {
    profile: [[0, -6, 0], [24, 260, 0], [52, 274, 0], [230, 290, 0], [258, 500, 0], [290, 516, 0], [470, 530, 0], [502, 760, 0], [536, 780, 0], [720, 800, 0], [760, 830, 0], [3560, 840, 0], [3590, 820, 0], [3640, -6, 0]],
    half: (u) => { const a = u * Math.PI * 2; return 1320 + 240 * Math.sin(a * 3 + 1.1) + 130 * Math.sin(a * 11 + 2.3) + 60 * Math.sin(a * 23 + 0.4) },
    rim: 900, outer: 3640, hk: 0.15, jit: 14,
  },
  // A tube of ice: the walls lean in and the roof (built across, see build) closes over the floor.
  ice: {
    profile: [[0, -4, 0.15], [30, 60, 0.15], [70, 150, 0.15], [140, 230, 0.1], [260, 290, 0.05], [700, 230, 0], [1100, 90, 0], [1400, -6, 0]],
    half: (u) => { const a = u * Math.PI * 2; return 760 + 120 * Math.sin(a * 3 + 0.4) + 60 * Math.sin(a * 9 + 1.7) },
    rim: 300, outer: 1400, hk: 0.08, jit: 18, roof: 330,
  },
  // Basalt, sheer: aCrev is the molten glow (1 at the foot — lava pooled along the walls).
  lava: {
    profile: [[0, -6, 1], [10, 6, 1], [22, 30, 0.6], [40, 210, 0], [70, 230, 0], [110, 420, 0], [150, 440, 0], [190, 610, 0], [240, 630, 0], [2400, 650, 0], [2440, 620, 0], [2500, -6, 0]],
    half: (u) => { const a = u * Math.PI * 2; return 900 + 180 * Math.sin(a * 4 + 0.9) + 90 * Math.sin(a * 13 + 2.0) },
    rim: 700, outer: 2500, hk: 0.12, jit: 10,
  },
  // A river gorge: low granite banks (aCrev 0) under forest (1) on top.
  forest: {
    profile: [[0, -4, 0], [20, 40, 0], [45, 70, 0], [70, 96, 0.2], [100, 112, 1], [600, 130, 1], [1600, 140, 1], [1700, -4, 1]],
    half: (u) => { const a = u * Math.PI * 2; return 700 + 140 * Math.sin(a * 3 + 2.2) + 70 * Math.sin(a * 8 + 0.3) },
    rim: 160, outer: 1700, hk: 0.18, jit: 8,
  },
}

/** The virtual rock behind each wall (m): big enough that its curve is the wall's line over a pass. */
const BIG = 20000
/** The water's clock (main.ts advances it). */
export const WATER_T = { value: 0 }

export class Canyon {
  readonly rx: Float64Array
  readonly rz: Float64Array
  readonly tx: Float64Array
  readonly tz: Float64Array
  /** Half-width of the floor (m): the wall's foot from the line. */
  readonly half: Float64Array
  readonly m: number
  readonly st: Style
  private last = 0

  constructor(loop: (u: number) => [number, number], readonly style: GorgeStyle = 'desert') {
    this.st = STYLES[style]
    let L = 0
    let [px, pz] = loop(0)
    for (let k = 1; k <= 2000; k++) { const [x, z] = loop(k / 2000); L += Math.hypot(x - px, z - pz); px = x; pz = z }
    const m = Math.max(64, Math.round(L / 200))
    this.m = m
    this.rx = new Float64Array(m); this.rz = new Float64Array(m); this.tx = new Float64Array(m); this.tz = new Float64Array(m); this.half = new Float64Array(m)
    for (let i = 0; i < m; i++) {
      const u = i / m
      const [x, z] = loop(u)
      const [x2, z2] = loop(u + 0.5 / m), [x0, z0] = loop(u - 0.5 / m)
      const dl = Math.hypot(x2 - x0, z2 - z0) || 1
      this.rx[i] = x; this.rz[i] = z; this.tx[i] = (x2 - x0) / dl; this.tz[i] = (z2 - z0) / dl
      this.half[i] = this.st.half(u)
    }
  }

  nearest(x: number, z: number, full = false): number {
    const m = this.m
    let best = this.last, bd = Infinity
    const span = full ? m : 24
    for (let k = -span; k <= span; k++) {
      const i = (((this.last + k) % m) + m) % m
      const d = (this.rx[i] - x) ** 2 + (this.rz[i] - z) ** 2
      if (d < bd) { bd = d; best = i }
    }
    if (!full && bd > 4e6) return this.nearest(x, z, true)
    this.last = best
    return best
  }

  across(x: number, z: number): { i: number; lat: number; half: number } {
    const i = this.nearest(x, z)
    const lat = (x - this.rx[i]) * this.tz[i] - (z - this.rz[i]) * this.tx[i]
    return { i, lat, half: this.half[i] }
  }

  /** Is (x, z) on the gorge floor (between the walls)? */
  inside(x: number, z: number): boolean { const a = this.across(x, z); return Math.abs(a.lat) < a.half }

  wallsNear(x: number, z: number, y: number, out: { x: number; z: number; cr: number; big: boolean }[], n: number): number {
    const i = this.nearest(x, z)
    if (y > groundH(this.rx[i], this.rz[i]) + this.st.rim) return n
    const sx = this.tz[i], sz = -this.tx[i], h = this.half[i], OUT = this.st.outer
    const lat = (x - this.rx[i]) * this.tz[i] - (z - this.rz[i]) * this.tx[i]
    const side = lat >= 0 ? 1 : -1, d = Math.abs(lat)
    let o = out[n]
    if (!o) out[n] = o = { x: 0, z: 0, cr: 0, big: false }
    o.big = false // (scrape and glance like a trackside block: a wall you run along)
    if (d < h + OUT / 2) { o.x = this.rx[i] + sx * side * (h + BIG); o.z = this.rz[i] + sz * side * (h + BIG); o.cr = BIG }
    else if (d < h + OUT + 400) { o.x = this.rx[i] + sx * side * (h + OUT - BIG); o.z = this.rz[i] + sz * side * (h + OUT - BIG); o.cr = BIG }
    else return n
    return n + 1
  }

  distance(x: number, z: number): number {
    let bd = Infinity
    for (let i = 0; i < this.m; i++) bd = Math.min(bd, (this.rx[i] - x) ** 2 + (this.rz[i] - z) ** 2)
    return Math.sqrt(bd)
  }
  /** Inside the gorge or under its rim (r: a landform's radius): nothing else stands there. */
  covers(x: number, z: number, r: number): boolean { return this.distance(x, z) < 1700 + this.st.outer + r }

  /** The walls (and the roof, the lamps, the water) as one group. */
  build(mat: THREE.Material, extra: { roofMat?: THREE.Material } = {}): THREE.Group {
    const g = new THREE.Group()
    const rows = this.m, st = this.st, P = st.profile.length
    const H = (r: number, side: number) => 1 - st.hk + st.hk * Math.sin(r * 0.09 * side + 1.3) + st.hk * 0.5 * Math.sin(r * 0.37 + side)
    for (const side of [1, -1]) {
      const pos = new Float32Array(rows * P * 3), crev = new Float32Array(rows * P)
      for (let r = 0; r < rows; r++) {
        const sx = this.tz[r] * side, sz = -this.tx[r] * side
        const W = this.half[r]
        const base = groundH(this.rx[r], this.rz[r])
        const hk = H(r, side)
        for (let k = 0; k < P; k++) {
          const [d, hgt, cv] = st.profile[k]
          const jit = k > 0 && k < P - 1 ? st.jit * Math.sin(r * 1.3 + k * 1.7 + side * 3) : 0
          const off = W + d + jit
          const o = (r * P + k) * 3
          pos[o] = this.rx[r] + sx * off
          pos[o + 1] = base + hgt * (hgt > 0 ? hk : 1)
          pos[o + 2] = this.rz[r] + sz * off
          // MAGMA GORGE: seams of lava up the walls here and there.
          crev[r * P + k] = this.style === 'lava' && k > 1 && k < 9 && Math.sin(r * 0.71 + k * 2.3 + side) > 0.93 ? 0.8 : cv
        }
      }
      const idx: number[] = []
      for (let r = 0; r < rows; r++) {
        const r2 = (r + 1) % rows
        for (let k = 0; k < P - 1; k++) {
          const a = r * P + k, b = r2 * P + k, c = r * P + k + 1, d = r2 * P + k + 1
          if (side > 0) idx.push(a, b, c, b, d, c)
          else idx.push(a, c, b, b, c, d)
        }
      }
      g.add(this.mesh(pos, crev, idx, mat))
    }
    if (st.roof) {
      // BLUE HOLLOW: the roof, an arch from the top of one wall to the other, over the whole loop.
      const top = st.profile[4], A = 9
      const pos = new Float32Array(rows * A * 3), crev = new Float32Array(rows * A)
      for (let r = 0; r < rows; r++) {
        const W = this.half[r] + top[0], base = groundH(this.rx[r], this.rz[r])
        for (let k = 0; k < A; k++) {
          const t = k / (A - 1), across = (t * 2 - 1) * W
          const lift = top[1] + Math.sin(t * Math.PI) * (st.roof - top[1])
          const o = (r * A + k) * 3
          pos[o] = this.rx[r] + this.tz[r] * across
          pos[o + 1] = base + lift + 6 * Math.sin(r * 0.8 + k * 2.1)
          pos[o + 2] = this.rz[r] - this.tx[r] * across
          crev[r * A + k] = 0.3
        }
      }
      const idx: number[] = []
      for (let r = 0; r < rows; r++) {
        const r2 = (r + 1) % rows
        for (let k = 0; k < A - 1; k++) {
          const a = r * A + k, b = r2 * A + k, c = r * A + k + 1, d = r2 * A + k + 1
          idx.push(a, c, b, b, c, d)
        }
      }
      g.add(this.mesh(pos, crev, idx, extra.roofMat ?? mat))
      g.add(this.lamps())
      g.add(this.icicles())
    }
    if (this.style === 'forest') g.add(this.water())
    return g
  }

  private mesh(pos: Float32Array, crev: Float32Array, idx: number[], mat: THREE.Material): THREE.Mesh {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aCrev', new THREE.BufferAttribute(crev, 1))
    geo.setIndex(idx)
    const flat = geo.toNonIndexed()
    flat.computeVertexNormals()
    flat.computeBoundingSphere()
    const m = new THREE.Mesh(flat, mat)
    m.frustumCulled = false
    return m
  }

  /** Lamps along both walls of the cave, every ~200 m, warm; and a cold strip high under the roof. */
  private lamps(): THREE.Group {
    const g = new THREE.Group()
    const rows = this.m
    // Lamp posts at the foot of each wall (they sat inside the wall's lean before), each with a warm pool
    // of light on the ice floor in front of it.
    const warm = new THREE.InstancedMesh(new THREE.BoxGeometry(5, 5, 12).translate(0, 18, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 7.5, 3) }), rows * 2)
    const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.8, 1.2, 18, 5).translate(0, 9, 0), new THREE.MeshBasicMaterial({ color: 0x1a1d26 }), rows * 2)
    const pool = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.55, 0.25), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }), rows * 2)
    const cold = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 1.2, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 3.6, 7) }), rows)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0)
    let k = 0
    for (let r = 0; r < rows; r++) {
      const base = groundH(this.rx[r], this.rz[r])
      q.setFromAxisAngle(Y, Math.atan2(this.tx[r], this.tz[r]))
      for (const side of [1, -1]) {
        const off = this.half[r] - 6
        const x = this.rx[r] + this.tz[r] * side * off, z = this.rz[r] - this.tx[r] * side * off
        v.set(x, groundH(x, z), z)
        warm.setMatrixAt(k, m.compose(v, q, s))
        post.setMatrixAt(k, m.compose(v, q, s))
        const px = this.rx[r] + this.tz[r] * side * (off - 40), pz = this.rz[r] - this.tx[r] * side * (off - 40)
        v.set(px, groundH(px, pz) + 0.6, pz)
        pool.setMatrixAt(k++, m.compose(v, q, s.set(70, 1, 70)))
        s.set(1, 1, 1)
      }
      v.set(this.rx[r], base + (this.st.roof ?? 300) - 12, this.rz[r])
      cold.setMatrixAt(r, m.compose(v, q, s))
    }
    for (const x of [warm, cold, post, pool]) { x.frustumCulled = false; g.add(x) }
    return g
  }

  /** Icicles hanging from the roof (low-poly cones, a faint blue). */
  private icicles(): THREE.InstancedMesh {
    const n = this.m * 6, roof = this.st.roof!, top = this.st.profile[4]
    const ic = new THREE.InstancedMesh(new THREE.ConeGeometry(4, 1, 5).rotateX(Math.PI).translate(0, -0.5, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.62, 0.95) }), n)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / 6), hh = Math.sin(i * 12.9898) * 43758.5453, f = hh - Math.floor(hh)
      const W = this.half[r] + top[0], across = (f * 2 - 1) * this.half[r] * 0.8, t = across / W * 0.5 + 0.5
      const y = groundH(this.rx[r], this.rz[r]) + top[1] + Math.sin(t * Math.PI) * (roof - top[1]) - 6
      v.set(this.rx[r] + this.tz[r] * across, y, this.rz[r] - this.tx[r] * across)
      const w = 1 + ((f * 3.1) % 1.5)
      s.set(w, 18 + 50 * ((f * 7.3) % 1), w)
      ic.setMatrixAt(i, m.compose(v, q, s))
    }
    ic.frustumCulled = false
    return ic
  }

  /** WHITEWATER: the river on the gorge floor — dark water, the sky in it, streaks running downstream. */
  private water(): THREE.Mesh {
    // Dense (every 50 m along, 21 across): the surface follows the ground closely — sampled every 200 m,
    // the terrain's swells rose through it as dry strips.
    const SUB = 4, rows = this.m * SUB, A = 21
    const pos = new Float32Array(rows * A * 3), uv = new Float32Array(rows * A * 2)
    let along = 0, px = 0, pz = 0
    for (let r = 0; r < rows; r++) {
      const i0 = Math.floor(r / SUB), i1 = (i0 + 1) % this.m, f = (r % SUB) / SUB
      const L = (a: Float64Array) => a[i0] + (a[i1] - a[i0]) * f
      const cx = L(this.rx), cz = L(this.rz), tx = L(this.tx), tz = L(this.tz)
      if (r > 0) along += Math.hypot(cx - px, cz - pz)
      px = cx; pz = cz
      // (Bank to bank, its edges under the walls' feet: narrower, a strip of dry floor showed like a pier.)
      const W = L(this.half) + 24
      for (let k = 0; k < A; k++) {
        const t = k / (A - 1), across = (t * 2 - 1) * W
        const x = cx + tz * across, z = cz - tx * across
        const o = (r * A + k) * 3
        pos[o] = x; pos[o + 1] = groundH(x, z) + 1.4; pos[o + 2] = z
        uv[(r * A + k) * 2] = t; uv[(r * A + k) * 2 + 1] = along
      }
    }
    const idx: number[] = []
    for (let r = 0; r < rows; r++) {
      const r2 = (r + 1) % rows
      for (let k = 0; k < A - 1; k++) { const a = r * A + k, b = r2 * A + k, c = r * A + k + 1, d = r2 * A + k + 1; idx.push(a, c, b, b, c, d) }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.setIndex(idx)
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: WATER_T },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; varying vec3 vW;
        void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vW;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + 1.0), f.x), f.y); }
        void main() {
          vec3 V = normalize(cameraPosition - vW);
          float fr = pow(1.0 - max(V.y, 0.0), 3.0);
          // Streaks running downstream, broken by a slower swell; their density makes rapids.
          float s = n(vec2(vUv.x * 70.0, vUv.y * 0.035 - uTime * 3.0)) * n(vec2(vUv.x * 12.0, vUv.y * 0.008 - uTime * 0.9));
          float rap = smoothstep(0.55, 0.9, n(vec2(vUv.y * 0.0012, 3.0)));
          vec3 c = mix(vec3(0.012, 0.05, 0.06), vec3(0.36, 0.52, 0.64), 0.04 + 0.3 * fr);
          c += vec3(0.85, 0.95, 1.0) * smoothstep(0.5 - 0.2 * rap, 0.8 - 0.2 * rap, s) * (0.55 + 0.4 * rap);
          // The sun in it: a broken glint.
          vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
          c += vec3(1.0, 0.9, 0.7) * pow(max(dot(R, normalize(vec3(-0.62, 0.36, 0.68))), 0.0), 60.0) * (0.2 + s) * 0.6;
          float bank = smoothstep(0.06, 0.0, vUv.x) + smoothstep(0.94, 1.0, vUv.x);
          c = mix(c, vec3(0.9, 0.95, 0.95), bank * (0.5 + 0.5 * n(vec2(vUv.y * 0.05 - uTime, vUv.x * 30.0))));
          gl_FragColor = vec4(c, 0.94);
        }`,
    })
    const w = new THREE.Mesh(geo, mat)
    w.frustumCulled = false
    w.renderOrder = 1
    return w
  }
}
