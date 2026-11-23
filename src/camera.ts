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
const _up = new THREE.Vector3(0, 1, 0)

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
  private spinA = 0

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

  // ── crash cam: pulls back and up to the side at the moment of impact, then follows the wreck ──
  private readonly crashDir = new THREE.Vector3()
  private readonly crashPos = new THREE.Vector3()
  private readonly crashVel = new THREE.Vector3()
  private readonly crashRel = new THREE.Vector3()
  private inCrash = false
  private crashCam(dt: number, time: number, _p: Player, at: THREE.Vector3, world: World): void {
    const cam = this.camera
    if (!this.inCrash) {
      this.inCrash = true
      // Behind the line it was travelling, and off to one side: you see the hit and the tumble.
      this.crashDir.set(Math.sin(this.yaw.x), 0, Math.cos(this.yaw.x))
      this.crashRel.copy(cam.position).sub(at)
      this.crashVel.set(0, 0, 0)
    }
    // The offset from the wreck is what springs (so the camera rides along with the slide): behind
    // the line it was on, out to one side, a little above.
    // A slow orbit round the wreck while it tumbles.
    this.crashDir.applyAxisAngle(_up, dt * 0.45)
    const side = _tmp.set(this.crashDir.z, 0, -this.crashDir.x)
    const want = _pos.copy(this.crashDir).multiplyScalar(-22).addScaledVector(side, 12)
    want.y = 5
    const w = 2.4
    for (const k of ['x', 'y', 'z'] as const) {
      const d = this.crashRel[k] - want[k]
      const tmp = (this.crashVel[k] + w * d) * dt
      const e = Math.exp(-w * dt)
      this.crashRel[k] = want[k] + (d + tmp) * e
      this.crashVel[k] = (this.crashVel[k] - w * tmp) * e
    }
    this.crashPos.copy(at).add(this.crashRel)
    this.crashPos.y = Math.max(this.crashPos.y, groundH(this.crashPos.x, this.crashPos.z) + 2)
    cam.position.copy(this.crashPos)
    cam.up.set(0, 1, 0)
    cam.lookAt(at.x, at.y + 1, at.z)
    this.trauma = Math.max(0, this.trauma - dt * 1.1)
    const amt = this.trauma * this.trauma * CFG.camera.shakeMax * 1.4 * (CFG.camera.reduceShake ? 0.25 : 1)
    cam.rotateY(noise(time * 15, 1) * amt)
    cam.rotateX(noise(time * 15, 7) * amt)
    cam.fov = this.fov.step(58, dt)
    cam.updateProjectionMatrix()
    void world
  }

  // ── cinematic: cycling shots around a craft (after the finish) ──
  private cineT = 0
  private cineShot = 0
  private readonly cineAnchor = new THREE.Vector3()
  cinematic(dt: number, time: number, p: Player, at: THREE.Vector3, heading: number): void {
    const cam = this.camera
    this.cineT += dt
    const shots = 4
    const fwd = _tmp.set(Math.sin(heading), 0, Math.cos(heading))
    const right = _look.set(-fwd.z, 0, fwd.x)
    if (this.cineT > (this.cineShot === 2 ? 3 : 4.2) || this.cineT === dt) {
      if (this.cineT !== dt) this.cineShot = (this.cineShot + 1) % shots
      this.cineT = dt
      // The flyby: a fixed point a little way down the line, beside it.
      this.cineAnchor.copy(at).addScaledVector(fwd, 60 + p.speed * 1.6).addScaledVector(right, (Math.random() < 0.5 ? -1 : 1) * 26)
      this.cineAnchor.y = groundH(this.cineAnchor.x, this.cineAnchor.z) + 4
    }
    const u = this.cineT
    let fov = 50
    if (this.cineShot === 0) {
      // Tracking alongside, low, drifting forward.
      cam.position.copy(at).addScaledVector(right, 16).addScaledVector(fwd, -4 + u * 2)
      cam.position.y = at.y + 2.2
      cam.lookAt(at.x + fwd.x * 6, at.y + 0.8, at.z + fwd.z * 6)
      fov = 46
    } else if (this.cineShot === 1) {
      // Low in front, looking back as it bears down.
      cam.position.copy(at).addScaledVector(fwd, 22 - u * 1.5).addScaledVector(right, -5)
      cam.position.y = groundH(cam.position.x, cam.position.z) + 1.4
      cam.lookAt(at.x, at.y + 1.2, at.z)
      fov = 40
    } else if (this.cineShot === 2) {
      // Trackside: it screams past a fixed camera.
      cam.position.copy(this.cineAnchor)
      cam.lookAt(at.x, at.y + 1, at.z)
      fov = 34
    } else {
      // High, slowly orbiting.
      const a = time * 0.25
      cam.position.set(at.x + Math.sin(a) * 40, at.y + 26, at.z + Math.cos(a) * 40).addScaledVector(fwd, 20)
      cam.lookAt(at.x, at.y, at.z)
      fov = 55
    }
    cam.fov = this.fov.step(fov, dt)
    cam.updateProjectionMatrix()
    this.yaw.x = heading
  }

  update(dt: number, time: number, p: Player, at: THREE.Vector3, heading: number, world: World, fovMax: number): void {
    const C = CFG.camera
    if (p.crashing) { this.crashCam(dt, time, p, at, world); return }
    if (this.inCrash) { this.inCrash = false; this.snap(heading) }
    const s = Math.min(1, p.mach / 6)
    // Yaw target: heading, pulled toward the real direction of travel when sliding.
    const hv = Math.hypot(p.vel.x, p.vel.z)
    let travel = hv > 30 ? Math.atan2(p.vel.x, p.vel.z) : heading
    let dt0 = travel - heading
    dt0 = Math.atan2(Math.sin(dt0), Math.cos(dt0))
    // (In a spin-out the camera holds the travel: you watch the craft whirl, not the world.)
    // Drifting: the camera swings wider toward the travel as the slide deepens (you feel the angle).
    const swing = p.drifting ? Math.min(0.3, Math.abs(dt0) * 0.8) : 0
    travel = p.spin > 0 || p.recover > 0 ? travel : heading + dt0 * (0.45 + swing)
    if (!this.yawInit) this.snap(travel)
    // Unwrap toward the spring's current value.
    let dy = travel - this.yaw.x
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    this.yaw.w = C.yawFollow
    const yaw = this.yaw.step(this.yaw.x + dy, dt)

    const g = THREE.MathUtils.clamp(p.accel / 320, -1.3, 1.4)
    const air = p.airborne ? Math.min(1, p.airTime * 2) : 0
    // Spinning: pull back and up so the whirl reads (the camera holds the travel, the craft turns).
    const spinA = this.spinA += ((p.spin > 0 ? 1 : p.recover > 0 ? 0.5 : 0) - this.spinA) * Math.min(1, dt * 4)
    const dist = this.dist.step(C.distBase + s * 0.9 + p.boost * C.distBoost * 0.6 + g * 1.6 + air * 2.5 + spinA * 7 + (p.drifting ? Math.min(2, Math.abs(dt0) * 4) : 0), dt)
    const h = this.height.step(C.height - s * 0.25 + air * 2.2 + p.brake * 0.4 + spinA * 3.5, dt)
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
    // (Aimed a little lower: from the lower camera the craft sat on the speed readout.)
    const ly = this.lookY.step(-1.5 - air * 2.5 + (p.airborne ? p.vy * 0.03 : 0), dt)
    const vx = hv > 30 ? p.vel.x / hv : Math.sin(heading)
    const vz = hv > 30 ? p.vel.z / hv : Math.cos(heading)
    _look.set(at.x + vx * 44 * (1 - spinA * 0.7), at.y + ly, at.z + vz * 44 * (1 - spinA * 0.7))
    _tmp.set(-Math.cos(heading), 0, Math.sin(heading))
    // (Not in a spin: at 8 rad/s of yaw this aimed 80 m off to the side and lost the craft.)
    _look.addScaledVector(_tmp, -THREE.MathUtils.clamp(p.yawRate, -1.5, 1.5) * 10 * (1 - spinA))

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
    const fovT = C.fovBase + (fovMax - C.fovBase) * Math.pow(s, 1.25) + Math.min(12, Math.max(0, p.mach - 6) * 3) + p.boost * 3 + this.punch - p.brake * 6 + air * 4 + (p.drifting ? Math.min(1, p.drift / 2.6) * 4 : 0) - spinA * 4
    cam.fov = this.fov.step(fovT, dt)
    cam.updateProjectionMatrix()
  }
}
