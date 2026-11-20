// The chase camera. Everything is a critically damped spring (no lerp-by-dt jitter at 2 km/s):
//   yaw       — follows a blend of heading and the actual direction of travel: drifts show, turns whip
//   distance  — G-force pulls it back on acceleration, braking shoves it in; flight lifts it
//   look      — ahead along the velocity, into the turn, down a touch in the air
//   FOV       — base → max (settings) with speed, small punches, a zoom-in on impacts
//   shake     — trauma², smooth noise, a speed-rumble floor; impact kicks are positional springs
//   collision — never below the ground (at the camera and halfway to the craft), never inside rock
import * as THREE from 'three'
import { CFG } from './config'
import { groundH } from './terrain'
import type { Player } from './player'
import type { Obstacle, World } from './world'

class Spring {
  v = 0
  constructor(public x: number, public w: number) {}
  step(target: number, dt: number): number {
    // Critically damped, exact for any dt.
    const w = this.w
    const e = Math.exp(-w * dt)
    const d = this.x - target
    const tmp = (this.v + w * d) * dt
    this.x = target + (d + tmp) * e
    this.v = (this.v - w * tmp) * e
    return this.x
  }
}

const noise = (t: number, s: number) => Math.sin(t * 1.7 + s) * 0.5 + Math.sin(t * 3.13 + s * 2.1) * 0.3 + Math.sin(t * 7.7 + s * 4.3) * 0.2
const _look = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _tmp = new THREE.Vector3()

export class ChaseCam {
  private readonly yaw = new Spring(0, 7)
  private readonly dist = new Spring(CFG.camera.distBase, 4.5)
  private readonly height = new Spring(CFG.camera.height, 5)
  private readonly fov = new Spring(CFG.camera.fovBase, 3.2)
  private readonly roll = new Spring(0, 5)
  private readonly lookY = new Spring(1.2, 6)
  private readonly kick = [new Spring(0, 9), new Spring(0, 9), new Spring(0, 9)]
  private readonly obs: Obstacle[] = []
  trauma = 0
  punch = 0
  private yawInit = false

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  snap(heading: number): void {
    this.yaw.x = heading
    this.yaw.v = 0
    this.yawInit = true
  }

  /** An impact: shove the camera along (nx, ny, nz) by `amount` metres (it springs back). */
  impulse(nx: number, ny: number, nz: number, amount: number): void {
    this.kick[0].v += nx * amount * 9
    this.kick[1].v += ny * amount * 9
    this.kick[2].v += nz * amount * 9
  }

  update(dt: number, time: number, p: Player, at: THREE.Vector3, heading: number, world: World, fovMax: number): void {
    const C = CFG.camera
    const s = Math.min(1, p.mach / 6)
    // Yaw target: heading, pulled toward the real direction of travel when sliding.
    const hv = Math.hypot(p.vel.x, p.vel.z)
    let travel = hv > 30 ? Math.atan2(p.vel.x, p.vel.z) : heading
    let dt0 = travel - heading
    dt0 = Math.atan2(Math.sin(dt0), Math.cos(dt0))
    travel = heading + dt0 * 0.45
    if (!this.yawInit) this.snap(travel)
    // Unwrap toward the spring's current value.
    let dy = travel - this.yaw.x
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    this.yaw.w = C.yawFollow
    const yaw = this.yaw.step(this.yaw.x + dy, dt)

    const g = THREE.MathUtils.clamp(p.accel / 320, -1.3, 1.4)
    const air = p.airborne ? Math.min(1, p.airTime * 2) : 0
    const dist = this.dist.step(C.distBase + s * 2.2 + p.boost * C.distBoost + g * 2 + air * 3, dt)
    const h = this.height.step(C.height - s * 0.5 + air * 2.2 + p.brake * 0.4, dt)
    const fx = Math.sin(yaw), fz = Math.cos(yaw)
    _pos.set(at.x - fx * dist, at.y + h, at.z - fz * dist)
    // Never inside rock: walk the camera in toward the craft until it is clear.
    const n = world.near(_pos.x, _pos.z, _pos.y, 6, this.obs)
    for (let i = 0; i < n; i++) {
      const o = this.obs[i]
      for (let k = 0; k < 8; k++) {
        const d = Math.hypot(_pos.x - o.x, _pos.z - o.z)
        if (d > o.cr + 3) break
        _pos.lerp(at, 0.25)
      }
    }
    // Never below the ground, here or halfway to the craft (a crest between would hide it).
    const gc = groundH(_pos.x, _pos.z)
    const gm = groundH((_pos.x + at.x) / 2, (_pos.z + at.z) / 2)
    _pos.y = Math.max(_pos.y, gc + 1.6, gm + 2.2)
    // Impact kicks.
    _pos.x += this.kick[0].step(0, dt)
    _pos.y += this.kick[1].step(0, dt)
    _pos.z += this.kick[2].step(0, dt)

    // Look ahead along the motion, into the turn.
    const ly = this.lookY.step(1.2 - air * 2.5 + (p.airborne ? p.vy * 0.03 : 0), dt)
    const vx = hv > 30 ? p.vel.x / hv : Math.sin(heading)
    const vz = hv > 30 ? p.vel.z / hv : Math.cos(heading)
    _look.set(at.x + vx * 32, at.y + ly, at.z + vz * 32)
    _tmp.set(-Math.cos(heading), 0, Math.sin(heading))
    _look.addScaledVector(_tmp, -p.yawRate * 10)

    const cam = this.camera
    cam.position.copy(_pos)
    cam.up.set(0, 1, 0)
    cam.lookAt(_look)
    cam.rotateZ(this.roll.step(-p.bank * C.rollFollow, dt))

    // Shake: trauma², smooth noise (lower frequency: high-frequency shake read as flicker).
    this.trauma = Math.max(0, this.trauma - dt * 1.3)
    const floor = s * s * C.speedTrauma * (p.dead ? 0 : 1) * (0.5 + 0.5 * p.boost) * (p.airborne ? 0.3 : 1)
    const t2 = Math.max(this.trauma, floor)
    const amt = t2 * t2 * C.shakeMax * (C.reduceShake ? 0.25 : 1)
    const ts = time * 17
    cam.rotateY(noise(ts, 1) * amt)
    cam.rotateX(noise(ts, 7) * amt)
    cam.rotateZ(noise(ts, 13) * amt * 0.8)

    this.punch *= Math.exp(-dt * 3)
    const fovT = C.fovBase + (fovMax - C.fovBase) * Math.pow(s, 1.25) + p.boost * 3 + this.punch - p.brake * 6 + air * 4
    cam.fov = this.fov.step(fovT, dt)
    cam.updateProjectionMatrix()
  }
}
