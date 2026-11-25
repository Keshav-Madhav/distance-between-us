// RACING LINE (settings, off by default): the fastest line found for this course (tools/rollout.mjs, then
// tools/raceline.mjs → public/lines/<course>.json), laid on the ground ahead of you like a racing game's
// line, coloured by what the fastest run was doing there: blue burner, green throttle, yellow lift,
// red brake, violet airborne (its shadow on the ground). It shows the next ~5 km and fades either end.
import * as THREE from 'three'
import { groundH } from './terrain'

const COLS = [0xff4a3d, 0xffd23a, 0x3ee07a, 0x3aa0ff].map((c) => new THREE.Color(c)), AIR = new THREE.Color(0xc58bff)
const HALF = 15, STEP_M = 8, LIFT = 1.5
const AHEAD = 120, BEHIND = 3 // course indices (40 m each): ~4.8 km ahead, 120 m behind

export class RaceLine {
  readonly mesh: THREE.Mesh
  private mat: THREE.ShaderMaterial
  private id = ''
  private want = ''
  /** The fastest time the line was driven in (null: the driver's own line, not optimised). */
  time: number | null = null

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uCur: { value: 0 }, uT: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 col; attribute float ci; attribute float side;
        varying vec3 vCol; varying float vCi; varying float vSide;
        void main() { vCol = col; vCi = ci; vSide = side; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uCur; uniform float uT;
        varying vec3 vCol; varying float vCi; varying float vSide;
        void main() {
          float d = vCi - uCur;
          float a = smoothstep(${(-BEHIND).toFixed(1)}, 1.0, d) * (1.0 - smoothstep(${(AHEAD * 0.55).toFixed(1)}, ${AHEAD.toFixed(1)}, d));
          // Soft edges across, and chevrons running along it (every 40 m, drifting forward).
          float edge = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
          float chev = fract(vCi - abs(vSide) * 0.12 - uT * 0.6);
          float stripe = 0.55 + 0.45 * smoothstep(0.0, 0.08, chev) * (1.0 - smoothstep(0.42, 0.5, chev));
          a *= edge * stripe * 0.85;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vCol * 1.25, a);
        }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    })
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 2
    this.mesh.visible = false
  }

  /** The line for this course (fetched once per course; nothing is drawn if it has none). */
  load(id: string): void {
    if (id === this.id || id === this.want) return
    this.want = id
    this.mesh.visible = false
    void fetch(`${import.meta.env.BASE_URL}lines/${id}.json`).then((r) => (r.ok ? r.json() : null)).then((j: { time: number | null; s: number[] } | null) => {
      if (this.want !== id) return
      this.id = id; this.want = ''
      this.mesh.geometry.dispose()
      this.mesh.geometry = j ? this.build(j.s) : new THREE.BufferGeometry()
      this.time = j?.time ?? null
    }).catch(() => { if (this.want === id) { this.id = id; this.want = '' } })
  }

  /** Samples (x, ground y, z, action, air, course index) → a ribbon draped on the ground every 8 m. */
  private build(s: number[]): THREE.BufferGeometry {
    const N = 6, n = s.length / N
    const pos: number[] = [], col: number[] = [], ci: number[] = [], side: number[] = [], idx: number[] = []
    let v = 0, fresh = true
    for (let k = 0; k < n - 1; k++) {
      const a = k * N, b = a + N
      const ax = s[a], az = s[a + 2], bx = s[b], bz = s[b + 2]
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz)
      if (len < 0.5 || len > 2000) { if (len > 2000) fresh = true; continue } // (a respawn: no ribbon across it)
      const nx = -dz / len, nz = dx / len, c = s[b + 4] ? AIR : COLS[s[b + 3]]
      const m = Math.max(1, Math.ceil(len / STEP_M))
      for (let j = fresh ? 0 : 1; j <= m; j++) {
        const u = j / m, x = ax + dx * u, z = az + dz * u, i = s[a + 5] + (s[b + 5] - s[a + 5]) * u
        for (const sd of [-1, 1]) {
          const px = x + nx * HALF * sd, pz = z + nz * HALF * sd
          pos.push(px, groundH(px, pz) + LIFT, pz); col.push(c.r, c.g, c.b); ci.push(i); side.push(sd)
        }
        if (j > 0) { const p = v - 2; idx.push(p, p + 1, v, p + 1, v + 1, v) }
        v += 2
      }
      fresh = false
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('col', new THREE.Float32BufferAttribute(col, 3))
    g.setAttribute('ci', new THREE.Float32BufferAttribute(ci, 1))
    g.setAttribute('side', new THREE.Float32BufferAttribute(side, 1))
    g.setIndex(idx)
    return g
  }

  /** Each frame: shown (racing, switched on, this course has a line) at the player's place on the course. */
  update(on: boolean, courseIdx: number, t: number): void {
    this.mesh.visible = on && this.id !== '' && this.want === '' && !!this.mesh.geometry.index
    this.mat.uniforms.uCur.value = courseIdx
    this.mat.uniforms.uT.value = t
  }
}
