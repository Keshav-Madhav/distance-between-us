// The Walker: a 150 m reverse-jointed war machine stomping across the desert. Real 2-bone IK legs
// with planted feet, a bobbing hull, four glowing cores (the lock targets), a head cannon that lobs
// heavy plasma volleys with lead, and a slow-motion collapse with a shockwave that catches you.
import * as THREE from 'three'
import { MACH } from './config'
import { groundH } from './terrain'
import { patchStandard } from './shaders'
import type { Target, Combat } from './combat'
import type { Fx } from './particles'
import type { Player } from './player'
import type { Sound } from './audio'

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _q = new THREE.Quaternion()
const Y = new THREE.Vector3(0, 1, 0)

/** Everything below is modelled at 150 m tall, then scaled: at Mach 4 a 150 m machine is a speck. */
const K = 2.4
const L1 = 62 * K // thigh
const L2 = 66 * K // shin
const HIP_W = 24 * K
const STEP_T = 2.3
const SPEED = 55

class Core implements Target {
  readonly pos = new THREE.Vector3()
  readonly prev = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  alive = true
  radius = 30 * K
  kind = 'core' as const
  hp = 3
  mesh!: THREE.Mesh
  onHit: (c: Core) => void = () => {}
  hit(dmg: number): void {
    if (!this.alive) return
    this.hp -= dmg
    this.onHit(this)
  }
}

interface Leg {
  hip: THREE.Object3D
  thigh: THREE.Mesh
  shin: THREE.Mesh
  foot: THREE.Mesh
  plant: THREE.Vector3
  from: THREE.Vector3
  to: THREE.Vector3
  swinging: boolean
  side: number
}

export type WalkerState = 'off' | 'coming' | 'fight' | 'falling' | 'down'

export class Walker {
  readonly root = new THREE.Group()
  private readonly hull = new THREE.Group()
  private readonly legs: Leg[] = []
  readonly cores: Core[] = []
  state: WalkerState = 'off'
  readonly pos = new THREE.Vector3()
  heading = 0
  private gait = 0
  private fireT = 4
  private charge = 0
  private fallT = 0
  private readonly fallAxis = new THREE.Vector3()
  private bob = 0
  private stagger = 0
  private readonly headGlow: THREE.MeshBasicMaterial
  private readonly coreMat: THREE.MeshBasicMaterial
  private readonly deadMat: THREE.MeshStandardMaterial
  private readonly muzzle = new THREE.Object3D()
  /** The shockwave ring after it falls: radius (m), or < 0 when none. */
  shock = -1
  readonly shockCenter = new THREE.Vector3()
  private shockHit = false
  readonly ring: THREE.Mesh
  private readonly ringMat: THREE.ShaderMaterial
  onCoreLost: ((left: number) => void) | null = null
  onFall: (() => void) | null = null
  onDown: (() => void) | null = null

  constructor(
    private readonly player: Player,
    private readonly fx: Fx,
    private readonly audio: Sound,
    private readonly combat: Combat,
    private readonly shake: (t: number) => void,
  ) {
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.55, metalness: 0.75, flatShading: true })
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.6, metalness: 0.6, flatShading: true })
    const warn = new THREE.MeshStandardMaterial({ color: 0xe0a020, roughness: 0.5, metalness: 0.3, flatShading: true })
    this.deadMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, flatShading: true })
    for (const m of [metal, dark, warn, this.deadMat]) patchStandard(m)
    this.headGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 2, 1) })
    this.coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(12, 5, 1.2) })

    const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.hull) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
      b.position.set(x, y, z)
      parent.add(b)
      return b
    }
    // Hull: a wedge of armour plates over a dark frame.
    box(64, 26, 54, metal, 0, 0, 0)
    box(54, 12, 44, dark, 0, -17, -2)
    box(40, 10, 40, metal, 0, 17, -6)
    box(66, 3, 4, warn, 0, 6, 27.5)
    const head = box(26, 16, 26, metal, 0, 4, 34)
    head.rotation.x = 0.12
    const visor = box(20, 3.5, 1, this.headGlow, 0, 6, 47.6)
    visor.rotation.x = 0.12
    // Cannons on the shoulders.
    for (const x of [-38, 38]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5.5, 52, 10), dark)
      c.rotation.x = Math.PI / 2
      c.position.set(x, 8, 14)
      this.hull.add(c)
      box(14, 14, 22, metal, x, 8, -6)
    }
    this.muzzle.position.set(0, 6, 50)
    this.hull.add(this.muzzle)
    // Back fins / radiators.
    for (let i = 0; i < 4; i++) {
      const f = box(2.5, 22, 18, dark, -15 + i * 10, 26, -18)
      f.rotation.x = -0.4
    }

    // Cores: two hip actuators, a back reactor, and one under the head.
    const coreGeo = new THREE.IcosahedronGeometry(7, 1)
    const coreSpots: [number, number, number][] = [[-35, -10, 0], [35, -10, 0], [0, 25, -26], [0, -10, 30]]
    for (const [x, y, z] of coreSpots) {
      const c = new Core()
      c.mesh = new THREE.Mesh(coreGeo, this.coreMat)
      c.mesh.position.set(x, y, z)
      this.hull.add(c.mesh)
      c.onHit = (cc) => this.coreHit(cc)
      this.cores.push(c)
    }

    this.hull.scale.setScalar(K)
    this.root.add(this.hull)

    // Legs: thigh and shin are unit boxes, scaled and aimed every frame.
    const thighGeo = new THREE.CylinderGeometry(6, 9, 1, 6)
    thighGeo.translate(0, 0.5, 0)
    const shinGeo = new THREE.CylinderGeometry(4.5, 6.5, 1, 6)
    shinGeo.translate(0, 0.5, 0)
    const footGeo = new THREE.BoxGeometry(18, 6, 30)
    for (const side of [-1, 1]) {
      const hip = new THREE.Object3D()
      hip.position.set(side * HIP_W, -12, 0)
      this.hull.add(hip)
      const thigh = new THREE.Mesh(thighGeo, metal)
      const shin = new THREE.Mesh(shinGeo, dark)
      const foot = new THREE.Mesh(footGeo, metal)
      this.root.add(thigh, shin, foot)
      this.legs.push({ hip, thigh, shin, foot, plant: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), swinging: false, side })
    }

    // The shockwave: a flat ring on the ground, expanding.
    this.ringMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uA: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        uniform float uA; varying vec2 vUv;
        void main() {
          float x = vUv.y; // 0 inner … 1 outer
          float a = smoothstep(0.0, 0.7, x) * (1.0 - smoothstep(0.85, 1.0, x));
          gl_FragColor = vec4(vec3(2.6, 1.6, 0.9) * a * uA, 1.0);
        }`,
    })
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 96, 1), this.ringMat)
    this.ring.rotation.x = -Math.PI / 2
    this.ring.visible = false
    this.ring.frustumCulled = false
    this.root.visible = false
  }

  /** Arrive far ahead of the player. */
  spawn(ahead = 15000, side = (Math.random() - 0.5) * 3000): void {
    const p = this.player
    this.pos.copy(p.pos).addScaledVector(p.fwd, ahead).addScaledVector(p.right, side)
    this.heading = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z)
    this.state = 'coming'
    this.fireT = 3
    this.gait = 0
    this.fallT = 0
    this.shock = -1
    this.shockHit = false
    this.ring.visible = false
    this.hull.rotation.set(0, 0, 0)
    for (const c of this.cores) { c.alive = true; c.hp = 3; c.mesh.material = this.coreMat }
    this.coreMat.color.setRGB(12, 5, 1.2)
    this.root.visible = true
    const fwd = _v.set(Math.sin(this.heading), 0, Math.cos(this.heading))
    for (const l of this.legs) {
      const side = _w.set(fwd.z, 0, -fwd.x).multiplyScalar(l.side * HIP_W * 1.1)
      l.plant.copy(this.pos).add(side).addScaledVector(fwd, l.side * 18)
      l.plant.y = groundH(l.plant.x, l.plant.z)
      l.swinging = false
    }
    this.layout(1)
  }

  hide(): void {
    this.state = 'off'
    this.root.visible = false
    this.ring.visible = false
    for (const c of this.cores) c.alive = false
  }

  shift(dx: number, dz: number): void {
    this.pos.x += dx; this.pos.z += dz
    this.shockCenter.x += dx; this.shockCenter.z += dz
    for (const l of this.legs) { l.plant.x += dx; l.plant.z += dz; l.from.x += dx; l.from.z += dz; l.to.x += dx; l.to.z += dz }
    for (const c of this.cores) { c.pos.x += dx; c.pos.z += dz; c.prev.x += dx; c.prev.z += dz }
  }

  get coresLeft(): number { return this.cores.reduce((n, c) => n + (c.alive ? 1 : 0), 0) }

  private coreHit(c: Core): void {
    const p = this.player
    this.stagger = 1
    this.audio.explosion(c.pos.distanceTo(p.pos), 1.4)
    this.shake(0.2)
    if (c.hp <= 0) {
      c.alive = false
      c.mesh.material = this.deadMat
      this.fx.explosion(c.pos.x, c.pos.y, c.pos.z, 0, 0, 0, 3)
      const left = this.coresLeft
      this.onCoreLost?.(left)
      if (left === 0) this.fall()
    }
  }

  private fall(): void {
    this.state = 'falling'
    this.fallT = 0
    // Topples forward-ish, a little to one side.
    const fwd = _v.set(Math.sin(this.heading), 0, Math.cos(this.heading))
    this.fallAxis.set(fwd.z, 0, -fwd.x).applyAxisAngle(Y, (Math.random() - 0.5) * 0.6).normalize()
    this.onFall?.()
  }

  step(dt: number): void {
    if (this.state === 'off') return
    const p = this.player
    for (const c of this.cores) c.prev.copy(c.pos)
    this.stagger = Math.max(0, this.stagger - dt * 1.5)

    if (this.state === 'coming' || this.state === 'fight') {
      const toP = _v.subVectors(p.pos, this.pos)
      const dist = Math.hypot(toP.x, toP.z)
      if (this.state === 'coming' && dist < 11000) this.state = 'fight'
      // Turns slowly toward the player, walks.
      const want = Math.atan2(toP.x, toP.z)
      let dh = want - this.heading
      dh = Math.atan2(Math.sin(dh), Math.cos(dh))
      this.heading += THREE.MathUtils.clamp(dh, -0.12 * dt, 0.12 * dt)
      const speed = SPEED
      this.pos.x += Math.sin(this.heading) * speed * dt
      this.pos.z += Math.cos(this.heading) * speed * dt
      this.gait += dt / STEP_T
      this.stepLegs()

      // Cannon: charge (telegraphed), then a volley of three, leading the player.
      if (this.state === 'fight' && !p.dead && dist < 9000) {
        this.fireT -= dt
        if (this.fireT < 0.8 && this.charge === 0) { this.charge = 0.001; this.audio.charge(dist) }
        if (this.charge > 0) this.charge = Math.min(1, this.charge + dt / 0.8)
        if (this.fireT <= 0) {
          this.muzzle.getWorldPosition(_w)
          const orbSpeed = 1250
          for (let i = -1; i <= 1; i++) {
            // Predict where the player will be.
            let tt = _w.distanceTo(p.pos) / (orbSpeed + p.speed * 0.3)
            const aim = _v.copy(p.pos).addScaledVector(p.vel, tt * 0.95)
            tt = _w.distanceTo(aim) / orbSpeed
            aim.copy(p.pos).addScaledVector(p.vel, tt * 0.95).addScaledVector(p.right, i * 70)
            aim.y = groundH(aim.x, aim.z) + 6
            const vel = aim.sub(_w).normalize().multiplyScalar(orbSpeed)
            this.combat.fireOrb(_w, vel)
          }
          this.audio.cannon(dist)
          this.fireT = 2.6 + Math.random() * 0.8
          this.charge = 0
        }
      }
    } else if (this.state === 'falling') {
      this.fallT += dt
      const T = 4.2
      const u = Math.min(1, this.fallT / T)
      // Knees buckle first, then it goes over, accelerating.
      const ang = u * u * 1.35
      this.hull.quaternion.setFromAxisAngle(this.fallAxis, ang)
      this.bob = (-40 * Math.min(1, this.fallT / 1.6) - u * u * 30) * K
      // Explosions ripple over it as it goes.
      if (Math.random() < dt * 6) {
        _v.set((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 50)
        this.hull.localToWorld(_v)
        this.fx.explosion(_v.x, _v.y, _v.z, 0, 0, 0, 1.6 + Math.random() * 1.5)
      }
      if (u >= 1) {
        this.state = 'down'
        // Impact: the biggest thing in the game.
        _v.set(0, 0, 40)
        this.hull.localToWorld(_v)
        const g = groundH(_v.x, _v.z)
        for (let i = 0; i < 6; i++) this.fx.explosion(_v.x + (Math.random() - 0.5) * 120 * K, g + 40 + Math.random() * 90, _v.z + (Math.random() - 0.5) * 120 * K, 0, 0, 0, 4)
        this.fx.dust(_v.x, g, _v.z, 0, 0, 90, 120 * K, 160)
        this.shock = 0
        this.shockCenter.set(_v.x, g, _v.z)
        this.shockHit = false
        this.ring.visible = true
        this.audio.explosion(_v.distanceTo(p.pos), 4)
        this.onDown?.()
      }
    } else if (this.state === 'down') {
      if (this.shock >= 0) {
        this.shock += dt * 520
        const dist = Math.hypot(p.pos.x - this.shockCenter.x, p.pos.z - this.shockCenter.z)
        if (!this.shockHit && this.shock >= dist) {
          this.shockHit = true
          // The shockwave catches you from behind.
          this.shake(0.9)
          this.audio.shockwave()
          p.speed += 0.5 * MACH
          p.vy += 30
        }
        if (this.shock > 9000) { this.shock = -1; this.ring.visible = false }
      }
      // Smoulders.
      if (Math.random() < dt * 8) {
        _v.set((Math.random() - 0.5) * 60, 10, (Math.random() - 0.5) * 60)
        this.hull.localToWorld(_v)
        const g = groundH(_v.x, _v.z)
        this.fx.dust(_v.x, Math.max(_v.y, g), _v.z, 0, 0, 1, 50, 30)
      }
    }
    this.layout(dt)
  }

  private stepLegs(): void {
    const fwd = _v.set(Math.sin(this.heading), 0, Math.cos(this.heading))
    const ph = this.gait % 2
    for (let i = 0; i < 2; i++) {
      const l = this.legs[i]
      // Leg i swings during [i, i+1) of the 2-step cycle.
      const local = ph - i
      const swing = local >= 0 && local < 1
      if (swing && !l.swinging) {
        l.swinging = true
        l.from.copy(l.plant)
        const side = _w.set(fwd.z, 0, -fwd.x).multiplyScalar(l.side * HIP_W * 1.1)
        // Plant ahead of the body by half a stride (plus where the body will be by then).
        l.to.copy(this.pos).add(side).addScaledVector(fwd, SPEED * STEP_T)
        l.to.y = groundH(l.to.x, l.to.z)
      }
      if (swing) {
        const u = local
        const e = u * u * (3 - 2 * u)
        l.plant.lerpVectors(l.from, l.to, e)
        l.plant.y = THREE.MathUtils.lerp(l.from.y, l.to.y, e) + Math.sin(Math.PI * u) * 22 * K
      } else if (l.swinging) {
        l.swinging = false
        l.plant.copy(l.to)
        this.footfall(l.plant)
      }
    }
    this.bob = (-4 + 4 * Math.cos(Math.PI * 2 * this.gait)) * K
  }

  private footfall(at: THREE.Vector3): void {
    this.fx.dust(at.x, at.y, at.z, 0, 0, 26, 60 * K, 40 * K)
    const d = at.distanceTo(this.player.pos)
    this.audio.footfall(d)
    this.shake(Math.max(0, 0.35 - d / 9000))
  }

  /** Place the hull and aim the legs at the feet (2-bone IK, knee bent backward). */
  private layout(_dt: number): void {
    const g = groundH(this.pos.x, this.pos.z)
    const st = this.stagger * Math.sin(performance.now() * 0.03) * 1.5
    this.hull.position.set(this.pos.x, g + 112 * K + this.bob, this.pos.z)
    if (this.state !== 'falling' && this.state !== 'down') this.hull.rotation.set(0.04 + st * 0.02, this.heading, st * 0.02)
    else this.hull.rotation.y = this.heading
    if (this.state === 'falling' || this.state === 'down') {
      // (Fall: the axis-angle tilt composed on top of the heading.)
      const u = Math.min(1, this.fallT / 4.2)
      _q.setFromAxisAngle(this.fallAxis, u * u * 1.35)
      this.hull.quaternion.setFromAxisAngle(Y, this.heading).premultiply(_q)
    }
    this.hull.updateMatrixWorld(true)
    const fwd = _w.set(Math.sin(this.heading), 0, Math.cos(this.heading))
    for (const l of this.legs) {
      const hip = l.hip.getWorldPosition(_hip)
      const foot = _foot.copy(l.plant)
      foot.y += 4 * K
      const d = _d.subVectors(foot, hip)
      let dist = d.length()
      dist = Math.min(dist, L1 + L2 - 0.5)
      d.normalize()
      // Knee: in the plane of hip→foot and forward, bent backward (reverse joint).
      const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist)
      const h = Math.sqrt(Math.max(0, L1 * L1 - a * a))
      const bend = _bend.copy(fwd).multiplyScalar(-1)
      bend.addScaledVector(d, -bend.dot(d)).normalize()
      const knee = _knee.copy(hip).addScaledVector(d, a).addScaledVector(bend, h)
      aim(l.thigh, hip, knee)
      aim(l.shin, knee, foot.copy(hip).addScaledVector(d, dist))
      l.foot.position.copy(l.plant)
      l.foot.position.y += 2 * K
      l.foot.rotation.set(0, this.heading, 0)
      l.foot.scale.setScalar(K)
    }
    for (const c of this.cores) {
      c.mesh.getWorldPosition(c.pos)
      c.vel.subVectors(c.pos, c.prev).multiplyScalar(60)
    }
    // Head glow: charging brightens it.
    const ch = this.charge
    this.headGlow.color.setRGB(14 + ch * 30, 2 + ch * 10, 1 + ch * 14)
    if (this.state === 'down' || this.state === 'falling') this.headGlow.color.setRGB(0.4, 0.05, 0.02)
    if (this.shock >= 0) {
      this.ring.position.set(this.shockCenter.x, this.shockCenter.y + 3, this.shockCenter.z)
      this.ring.scale.setScalar(Math.max(1, this.shock))
      this.ringMat.uniforms.uA.value = 1 - Math.min(1, this.shock / 9000)
    }
  }

  /** For the ground shader: x, z, radius, strength. */
  shadow(out: THREE.Vector4): void {
    if (this.state === 'off') { out.w = 0; return }
    out.set(this.hull.position.x, this.hull.position.z, 70 * K, this.state === 'down' ? 0.5 : 1)
  }

  get hullPos(): THREE.Vector3 { return this.hull.position }
}

const _hip = new THREE.Vector3()
const _foot = new THREE.Vector3()
const _d = new THREE.Vector3()
const _bend = new THREE.Vector3()
const _knee = new THREE.Vector3()
const _dir = new THREE.Vector3()
function aim(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
  _dir.subVectors(b, a)
  const len = _dir.length()
  m.position.copy(a)
  m.quaternion.setFromUnitVectors(Y, _dir.multiplyScalar(1 / (len || 1)))
  m.scale.set(K, len, K)
}
