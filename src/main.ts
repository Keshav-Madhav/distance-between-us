// The Distance Between Us — entry. Loop, camera, game flow, HUD, quality, test hooks.
import '@fontsource/chakra-petch/400.css'
import '@fontsource/chakra-petch/700.css'
import * as THREE from 'three'
import { CFG, MACH, REBASE } from './config'
import { World } from './world'
import { Craft } from './craft'
import { Fx, resetE } from './particles'
import { Trail } from './trails'
import { Player } from './player'
import { Combat, type Target } from './combat'
import { Walker } from './walker'
import { Sound } from './audio'
import { Input } from './input'
import { Post } from './post'
import { groundH, SUN_DIR } from './terrain'
import { loadTextures } from './textures'

const STEP = 1 / 60
const params = new URLSearchParams(location.search)
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T
const loadBar = $('#loading .b i')
loadBar.style.width = '15%'

// ───────────────────────── renderer ─────────────────────────
const canvas = $<HTMLCanvasElement>('#game')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', reversedDepthBuffer: true })
renderer.info.autoReset = false
renderer.toneMapping = THREE.NoToneMapping
{
  const seen = new Set<string>()
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const log = (gl.getShaderInfoLog(fs) || '') + (gl.getShaderInfoLog(vs) || '') + (gl.getProgramInfoLog(program) || '')
    console.error('shader error', log)
    const line = log.split('\n').find((l) => /ERROR/.test(l)) ?? log.slice(0, 200)
    if (!seen.has(line)) { seen.add(line); $('#debug').style.display = 'block'; $('#debug').textContent += 'SHADER: ' + line + '\n' }
  }
}

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(CFG.camera.fovBase, innerWidth / innerHeight, 0.5, 60000)

const world = new World()
scene.add(world.group)
const env = world.makeEnv(renderer)
loadBar.style.width = '35%'
const tex = await loadTextures(renderer)
world.applyTextures(tex)
loadBar.style.width = '55%'
const craft = new Craft(env)
scene.add(craft.root)
const fx = new Fx()
scene.add(fx.group)
const sound = new Sound()
const input = new Input()
const player = new Player()

// Exhaust trails (orange, additive) and wingtip vapour (white).
const trails: Trail[] = []
for (let i = 0; i < 3; i++) {
  const t = new Trail(56, new THREE.Color(1.6, 0.5, 0.12), true, 0.9)
  t.width = 0.42
  trails.push(t)
  scene.add(t.mesh)
}
const vapour: Trail[] = []
for (let i = 0; i < 2; i++) {
  const t = new Trail(40, new THREE.Color(1, 1, 1), false, 0.6)
  t.width = 0.25
  vapour.push(t)
  scene.add(t.mesh)
}

// ───────────────────────── game state ─────────────────────────
type Mode = 'title' | 'play' | 'over'
let mode: Mode = 'title'
let paused = false
let runTime = 0
let score = 0
let trauma = 0
let damageFlash = 0
let white = 0
let coneA = 0
let timeScale = 1
let slowmoT = 0
let hitstop = 0
let fovPunch = 0
let walkerDone = false
let autopilot = params.has('auto')

const shake = (t: number) => { trauma = Math.min(1, trauma + t) }

const combat = new Combat({
  player,
  fx,
  audio: sound,
  hurt(dmg, x, y, z, kind) {
    if (player.dead) return
    player.hull -= dmg
    player.sinceHurt = 0
    damageFlash = Math.min(1, damageFlash + (kind === 'orb' ? 0.9 : 0.45))
    shake(kind === 'orb' ? 0.6 : 0.3)
    sound.hit(kind === 'orb')
    input.rumble(kind === 'orb' ? 1 : 0.5, 0.6, kind === 'orb' ? 400 : 150)
    fx.explosion(x, y, z, player.vel.x * 0.95, player.vel.y, player.vel.z * 0.95, kind === 'orb' ? 0.7 : 0.25)
    if (player.hull <= 0) die()
  },
  scored(points, label) {
    score += points
    pop(`+${points}  ${label}`)
    hitstop = 0.05
  },
  shake,
  extraTargets: () => walker.cores as readonly Target[],
})
scene.add(combat.group)
const walker = new Walker(player, fx, sound, combat, shake)
scene.add(walker.root, walker.ring)
walker.onCoreLost = (left) => {
  score += 500
  pop(left > 0 ? `+500  CORE DESTROYED · ${left} LEFT` : '+500  LAST CORE')
  flash(left > 0 ? `${left} CORES LEFT` : 'IT\'S GOING DOWN')
}
walker.onFall = () => {
  slowmoT = 2.6
  sound.slowmo(1)
}
walker.onDown = () => {
  walkerDone = true
  score += 5000
  pop('+5000  WALKER DOWN')
  flash('WALKER DOWN')
  combat.pressure = 4
  setTimeout(() => showOver(true), 4500)
}

player.onMach = (m) => {
  flash(`MACH ${m}`)
  sound.machCrack(m)
  coneA = 1
  shake(0.15 + m * 0.03)
  fovPunch += 3
}
player.onBarrier = (ph) => {
  if (ph === "none") return
  sound.barrier(ph)
  if (ph === 'boom') {
    flash('MACH 6')
    shake(0.9)
    coneA = 1.6
    fovPunch += 12
    input.rumble(1, 1, 500)
    fx.dust(player.pos.x, groundH(player.pos.x, player.pos.z), player.pos.z, player.vel.x * 0.4, player.vel.z * 0.4, 30, 22, 50)
  }
}
player.onBoostStart = () => { sound.boostKick(); shake(0.2); fovPunch += 4; input.rumble(0.6, 0.3, 160) }
player.onCrash = (big, x, y, z, nx, nz) => {
  sound.crash(big)
  if (big) {
    shake(1)
    player.hull -= 30
    player.sinceHurt = 0
    damageFlash = 1
    hitstop = 0.08
    input.rumble(1, 1, 500)
    fx.explosion(x, y, z, player.vel.x * 0.5, 0, player.vel.z * 0.5, 0.6)
    fx.dust(x, y - 2, z, nx * 40, nz * 40, 26, 18, 30)
    if (player.hull <= 0) die()
  } else {
    shake(0.45)
    player.hull -= 4
    player.sinceHurt = 0
    damageFlash = Math.max(damageFlash, 0.3)
    input.rumble(0.5, 0.8, 120)
    for (let i = 0; i < 26; i++) {
      const e = resetE()
      e.x = x; e.y = y; e.z = z
      e.vx = player.vel.x * 0.8 + (Math.random() - 0.5) * 120; e.vy = Math.random() * 90; e.vz = player.vel.z * 0.8 + (Math.random() - 0.5) * 120
      e.life = 0.4 + Math.random() * 0.4; e.size0 = 0.6; e.size1 = 0.3; e.r = 9; e.g = 5; e.b = 2; e.a = 1; e.drag = 1.5; e.grav = 50; e.streak = 1
      fx.glow.emit(e)
    }
    fx.dust(x, y - 1, z, player.vel.x * 0.5, player.vel.z * 0.5, 10, 8, 15)
    if (player.hull <= 0) die()
  }
}

function die(): void {
  if (player.dead) return
  player.dead = true
  player.hull = 0
  fx.explosion(player.pos.x, player.pos.y + 1, player.pos.z, player.vel.x * 0.7, 10, player.vel.z * 0.7, 2.2)
  sound.death()
  shake(1)
  slowmoT = 1.6
  craft.root.visible = false
  setTimeout(() => showOver(false), 2200)
}

// ───────────────────────── HUD ─────────────────────────
const hud = $('#hud')
const machNum = $('#mach .num')
const barCells = Array.from(document.querySelectorAll<HTMLElement>('#bar i'))
const hullEl = $('#hull')
const hullFill = $('#hull .fill')
const scoreNum = $('#score .num')
const scoreSub = $('#score .sub')
const lockEl = $('#lock')
const arrowEl = $('#arrow')
const flashEl = $('#flash')
const warnEl = $('#warn')
const hintsEl = $('#hints')
const debugEl = $('#debug')
let flashT = 0
let warnT = 0

function flash(text: string): void {
  flashEl.textContent = text
  flashT = 1.1
}
function pop(text: string): void {
  const d = document.createElement('div')
  d.textContent = text
  $('#pops').prepend(d)
  setTimeout(() => d.remove(), 1700)
}
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

function showOver(won: boolean): void {
  if (mode !== 'play') return
  if (won && player.dead) return
  mode = 'over'
  $('#over-h').textContent = won ? 'WALKER DOWN' : 'SIGNAL LOST'
  $('#over-stats').innerHTML = `SCORE ${score}<br/>TOP SPEED MACH ${player.topMach.toFixed(2)}<br/>DRONES DOWN ${combat.kills}<br/>TIME ${fmtTime(runTime)}`
  $('#over').classList.remove('hide')
  if (won) $('#over .go').textContent = 'PRESS R TO RUN IT AGAIN · C TO KEEP FLYING'
  else $('#over .go').textContent = 'PRESS R TO RUN IT AGAIN'
}

function startRun(): void {
  sound.start()
  sound.revive()
  mode = 'play'
  player.reset()
  combat.reset()
  combat.enabled = true
  walker.hide()
  walkerDone = false
  fx.clear()
  for (const t of [...trails, ...vapour]) t.reset()
  craft.root.visible = true
  runTime = 0
  score = 0
  trauma = 0
  damageFlash = 0
  slowmoT = 0
  timeScale = 1
  $('#title').classList.add('hide')
  $('#over').classList.add('hide')
  hud.classList.add('on')
  hintsEl.style.opacity = '0.85'
  setTimeout(() => (hintsEl.style.opacity = '0'), 12000)
  // Launch: a hard shove.
  player.speed = 0.6 * MACH
  shake(0.5)
  sound.boostKick()
}

// ───────────────────────── quality ─────────────────────────
type Tier = 'low' | 'medium' | 'high' | 'ultra'
const TIERS: Record<Tier, { pr: number; samples: number; bloom: boolean; density: number }> = {
  low: { pr: 0.75, samples: 0, bloom: false, density: 0.5 },
  medium: { pr: 1, samples: 2, bloom: true, density: 0.75 },
  high: { pr: 1.5, samples: 4, bloom: true, density: 1 },
  ultra: { pr: 2, samples: 4, bloom: true, density: 1 },
}
let tierName = ((params.get('q') as Tier | null) ?? 'auto') as Tier | 'auto'
let tier: Tier = tierName === 'auto' ? 'high' : tierName
let renderScale = 1
const post = new Post(renderer, scene, camera, TIERS[tier].samples)
function applyTier(): void {
  const t = TIERS[tier]
  post.setSamples(t.samples)
  post.bloom.enabled = t.bloom
  fx.smoke.density = t.density
  resize()
}
function pixelRatio(): number { return Math.min(devicePixelRatio, TIERS[tier].pr) * renderScale }
function resize(): void {
  const w = innerWidth, h = innerHeight
  renderer.setPixelRatio(pixelRatio())
  renderer.setSize(w, h, false)
  post.setSize(w, h, pixelRatio())
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
addEventListener('resize', resize)
applyTier()

// Dynamic resolution: hold ~60 fps by trading pixels.
let govAcc = 0, govN = 0
function governor(frameMs: number): void {
  if (tierName !== 'auto' || params.has('fixed')) return
  govAcc += frameMs; govN++
  if (govAcc < 1000) return
  const avg = govAcc / govN
  govAcc = 0; govN = 0
  const old = renderScale
  if (avg > 18.5) renderScale = Math.max(0.5, renderScale - 0.1)
  else if (avg < 13 && renderScale < 1) renderScale = Math.min(1, renderScale + 0.05)
  if (renderScale !== old) resize()
  if (avg > 24 && renderScale <= 0.5 && tier !== 'low') { tier = tier === 'ultra' ? 'high' : tier === 'high' ? 'medium' : 'low'; renderScale = 0.8; applyTier() }
}

// Settings.
const qSel = $<HTMLSelectElement>('#q')
qSel.value = tierName
qSel.onchange = () => { tierName = qSel.value as Tier | 'auto'; tier = tierName === 'auto' ? 'high' : tierName; renderScale = 1; applyTier() }
const vols = () => sound.setVolumes(+$<HTMLInputElement>('#vm').value, +$<HTMLInputElement>('#vmu').value, +$<HTMLInputElement>('#vs').value)
for (const id of ['#vm', '#vmu', '#vs']) $(id).oninput = vols
$<HTMLInputElement>('#rs').onchange = (e) => { CFG.camera.reduceShake = (e.target as HTMLInputElement).checked }

// ───────────────────────── camera ─────────────────────────
const renderPos = new THREE.Vector3()
const camPos = new THREE.Vector3()
const lookAt = new THREE.Vector3()
let camYaw = 0
let camDist = CFG.camera.distBase
let camRoll = 0
let fov = CFG.camera.fovBase
let gPull = 0
const tmp = new THREE.Vector3()
const tmp2 = new THREE.Vector3()
const noise = (t: number, s: number) => Math.sin(t * 1.7 + s) * 0.5 + Math.sin(t * 3.13 + s * 2.1) * 0.3 + Math.sin(t * 7.7 + s * 4.3) * 0.2

function cameraUpdate(dt: number, time: number, heading: number): void {
  const C = CFG.camera
  const m = player.mach
  const s = Math.min(1, m / 6)
  // Heading lags: the camera whips through turns.
  let dh = heading - camYaw
  dh = Math.atan2(Math.sin(dh), Math.cos(dh))
  camYaw += dh * (1 - Math.exp(-C.yawFollow * dt))
  // G-force: acceleration pulls the camera back, braking shoves it in.
  gPull += (THREE.MathUtils.clamp(player.accel / 300, -1.2, 1.5) - gPull) * Math.min(1, dt * 4)
  const distT = C.distBase + s * 2 + player.boost * C.distBoost + gPull * 2.2
  camDist += (distT - camDist) * Math.min(1, dt * 5)
  const fx_ = Math.sin(camYaw), fz = Math.cos(camYaw)
  camPos.set(renderPos.x - fx_ * camDist, 0, renderPos.z - fz * camDist)
  const g = groundH(camPos.x, camPos.z)
  camPos.y = Math.max(renderPos.y + C.height - s * 0.6, g + 1.5)
  lookAt.set(renderPos.x + Math.sin(heading) * 30, renderPos.y + 1.2, renderPos.z + Math.cos(heading) * 30)
  // Look into the turn a touch.
  lookAt.x += -Math.cos(heading) * player.yawRate * -14
  lookAt.z += Math.sin(heading) * player.yawRate * -14
  camera.position.copy(camPos)
  camera.up.set(0, 1, 0)
  camera.lookAt(lookAt)
  camRoll += (-player.bank * C.rollFollow - camRoll) * Math.min(1, dt * 6)
  camera.rotateZ(camRoll)
  // Shake: trauma², smooth noise, never random jitter. A floor of speed rumble.
  trauma = Math.max(0, trauma - dt * 1.4)
  const t2 = Math.max(trauma, s * s * C.speedTrauma * (player.dead ? 0 : 1) * (0.6 + 0.4 * player.boost))
  const amt = t2 * t2 * C.shakeMax * (C.reduceShake ? 0.25 : 1)
  const ts = time * 28
  camera.rotateY(noise(ts, 1) * amt)
  camera.rotateX(noise(ts, 7) * amt)
  camera.rotateZ(noise(ts, 13) * amt * 1.4)
  // FOV: stretches with speed, punches on boost and Mach breaks.
  fovPunch *= Math.exp(-dt * 3)
  const fovT = C.fovBase + (C.fovMax - C.fovBase) * Math.pow(s, 1.3) + player.boost * 6 + fovPunch - player.brake * 8
  fov += (fovT - fov) * Math.min(1, dt * 4)
  camera.fov = fov
  camera.updateProjectionMatrix()
}

// ───────────────────────── autopilot (attract mode + tools) ─────────────────────────
const obs: import('./world').Obstacle[] = []
function autopilotControls(): void {
  const c = input.c
  c.boost = true
  c.brake = false
  c.strafe = 0
  c.dodgeL = c.dodgeR = false
  let steer = 0
  // Walker: circle it.
  if (walker.state === 'fight' || walker.state === 'coming') {
    tmp.subVectors(walker.hullPos, player.pos)
    const d = Math.hypot(tmp.x, tmp.z)
    const want = Math.atan2(tmp.x, tmp.z) + (d < 3500 ? 1.1 : 0)
    let dh = want - player.heading
    dh = Math.atan2(Math.sin(dh), Math.cos(dh))
    steer = THREE.MathUtils.clamp(-dh * 2, -1, 1)
  }
  // Dodge rocks ahead.
  const look = Math.max(600, player.speed * 1.4)
  const n = world.near(player.pos.x + player.fwd.x * look * 0.5, player.pos.z + player.fwd.z * look * 0.5, look * 0.6, obs)
  for (let i = 0; i < n; i++) {
    const o = obs[i]
    if (!o.big) continue
    tmp.set(o.x - player.pos.x, 0, o.z - player.pos.z)
    const ahead = tmp.dot(player.fwd)
    const side = tmp.dot(player.right)
    if (ahead > 0 && ahead < look && Math.abs(side) < o.cr + 140) steer += side > 0 ? -1.2 : 1.2
  }
  c.steer = THREE.MathUtils.clamp(steer, -1, 1)
  input.fire = combat.locked
}

// ───────────────────────── loop ─────────────────────────
let acc = 0
let last = performance.now()
let time = 0
let frames = 0, fpsT = 0, fps = 0, lastMs = 16
const nozzleW = new THREE.Vector3()
const lastDust = new THREE.Vector3()
const proj = new THREE.Vector3()
let attractYaw = 0

function rebase(): void {
  const dx = player.pos.x > REBASE / 2 ? -REBASE : player.pos.x < -REBASE / 2 ? REBASE : 0
  const dz = player.pos.z > REBASE / 2 ? -REBASE : player.pos.z < -REBASE / 2 ? REBASE : 0
  if (!dx && !dz) return
  player.shift(dx, dz)
  combat.shift(dx, dz)
  walker.shift(dx, dz)
  fx.shift(dx, dz)
  for (const t of [...trails, ...vapour]) t.shift(dx, dz)
  lastDust.x += dx; lastDust.z += dz
}

function frame(now: number): void {
  requestAnimationFrame(frame)
  const realDt = Math.min(0.1, (now - last) / 1000)
  lastMs = now - last
  last = now
  if (paused) return
  frames++; fpsT += realDt
  if (fpsT >= 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0 }
  governor(lastMs)
  renderer.info.reset()

  // Time: hitstop freezes, slow motion stretches.
  if (hitstop > 0) { hitstop -= realDt; timeScale = 0.05 }
  else if (slowmoT > 0) { slowmoT -= realDt; timeScale = THREE.MathUtils.lerp(1, 0.28, Math.min(1, slowmoT / 0.6)); if (slowmoT <= 0) sound.slowmo(0) }
  else timeScale = 1
  if (slowmoT > 0) sound.slowmo(Math.min(1, slowmoT / 0.6))
  const dt = realDt * timeScale
  time += dt

  // Input first, then the fixed-step sim.
  input.read(realDt, now / 1000)
  if (mode === 'play') {
    if (autopilot) autopilotControls()
    acc += dt
    let steps = 0
    while (acc >= STEP && steps < 6) {
      player.step(STEP, input.c, world)
      combat.step(STEP, input.fire && mode === 'play')
      walker.step(STEP)
      rebase()
      acc -= STEP
      steps++
      if (!player.dead) runTime += STEP
    }
    if (steps >= 6) acc = 0
    // The walker arrives after enough kills or time.
    if (walker.state === 'off' && !walkerDone && !player.dead && (combat.kills >= CFG.combat.walkerAfterKills || runTime > CFG.combat.walkerAfterSeconds)) {
      walker.spawn()
      warnT = 4
      combat.pressure = 2
      sound.machCrack(6)
    }
  } else if (mode === 'title') {
    // Attract: the craft idles, hovering; the camera drifts around it.
    player.prev.copy(player.pos)
    player.pos.y = groundH(player.pos.x, player.pos.z) + CFG.handling.hover + Math.sin(time * 1.6) * 0.25
  } else if (mode === 'over') {
    acc += dt
    while (acc >= STEP) { player.step(STEP, input.c, world); combat.step(STEP, false); walker.step(STEP); rebase(); acc -= STEP }
  }
  const alpha = mode === 'title' ? 1 : acc / STEP

  // Interpolated craft.
  renderPos.lerpVectors(player.prev, player.pos, alpha)
  let dh = player.heading - player.prevHeading
  dh = Math.atan2(Math.sin(dh), Math.cos(dh))
  const heading = player.prevHeading + dh * alpha
  craft.root.position.copy(renderPos)
  craft.root.rotation.set(0, heading, 0)
  craft.body.rotation.set(THREE.MathUtils.lerp(player.prevPitch, player.pitch, alpha), 0, -THREE.MathUtils.lerp(player.prevBank, player.bank, alpha))
  craft.root.updateMatrixWorld(true)
  const throttle = mode === 'title' ? 0.15 : player.dead ? 0 : 0.5 + 0.5 * Math.min(1, player.mach / 2)
  craft.setFlames(throttle, player.boost, time, 1)
  coneA = Math.max(0, coneA - realDt * 2.2)
  const nearMach1 = Math.max(0, 1 - Math.abs(player.mach - 1) / 0.06) * 0.5
  craft.setCone(Math.max(coneA, nearMach1), time)

  if (mode === 'title') {
    attractYaw += realDt * 0.12
    const r = 13
    const a = Math.PI * 0.82 + Math.sin(attractYaw) * 0.5
    camera.position.set(renderPos.x + Math.sin(a) * r, renderPos.y + 1.4, renderPos.z + Math.cos(a) * r)
    camera.lookAt(renderPos.x, renderPos.y + 2.6, renderPos.z)
    camera.fov = 46
    camera.updateProjectionMatrix()
  } else {
    cameraUpdate(realDt, time, heading)
  }

  // Trails from the nozzles and wingtips.
  if (mode !== 'title' && !player.dead) {
    for (let i = 0; i < 3; i++) {
      nozzleW.copy(craft.nozzles[i]).applyMatrix4(craft.body.matrixWorld)
      trails[i].push(nozzleW, dt)
      trails[i].strength = 0.2 + player.boost * 0.8
    }
    const vap = THREE.MathUtils.clamp((player.mach - 1.5) / 3, 0, 1) * (0.25 + Math.min(1, Math.abs(player.yawRate) * 1.4))
    for (let i = 0; i < 2; i++) {
      nozzleW.copy(craft.wingtips[i]).applyMatrix4(craft.body.matrixWorld)
      vapour[i].push(nozzleW, dt)
      vapour[i].strength = vap * 0.6
    }
    // Sand thrown up behind, laid along the path since last frame.
    const g = groundH(renderPos.x, renderPos.z)
    const agl = renderPos.y - g
    if (agl < 8) {
      const seg = lastDust.distanceTo(renderPos)
      const n = Math.min(10, Math.ceil(seg / 12)) * (0.4 + player.boost * 0.8 + player.brake * 2)
      for (let i = 0; i < n; i++) {
        const k = Math.random()
        tmp.lerpVectors(lastDust, renderPos, k)
        const e = resetE()
        e.x = tmp.x + (Math.random() - 0.5) * 4; e.y = groundH(tmp.x, tmp.z) + 0.5; e.z = tmp.z + (Math.random() - 0.5) * 4
        const sp = 14 + player.boost * 22
        e.vx = player.vel.x * 0.08 + player.right.x * (Math.random() - 0.5) * sp * 2; e.vy = 6 + Math.random() * sp; e.vz = player.vel.z * 0.08 + player.right.z * (Math.random() - 0.5) * sp * 2
        e.life = 0.9 + Math.random() * 1.1; e.size0 = 1.5; e.size1 = 9 + player.boost * 8
        e.r = 0.8; e.g = 0.42; e.b = 0.21; e.a = 0.32 * (1 - agl / 8); e.drag = 2.4; e.grav = 6
        fx.smoke.emit(e)
      }
    }
    // Side-thruster puffs when strafing.
    if (Math.abs(input.c.strafe) > 0.2 || input.c.dodgeL || input.c.dodgeR) {
      const side = input.c.strafe > 0 || input.c.dodgeR ? 0 : 1
      nozzleW.copy(craft.sidePuffs[side]).applyMatrix4(craft.body.matrixWorld)
      const e = resetE()
      e.x = nozzleW.x; e.y = nozzleW.y; e.z = nozzleW.z
      const out = side === 0 ? -1 : 1
      e.vx = player.vel.x + player.right.x * out * 40; e.vy = 0; e.vz = player.vel.z + player.right.z * out * 40
      e.life = 0.15; e.size0 = 1.6; e.size1 = 3.5; e.r = 1.5; e.g = 3; e.b = 6; e.a = 1; e.drag = 4
      fx.glow.emit(e)
    }
  }
  lastDust.copy(renderPos)

  combat.render(alpha, realDt, time)
  fx.update(dt)
  for (const t of [...trails, ...vapour]) t.build(camera.position)

  // World + ground uniforms.
  world.update(camera.position, time)
  const G = world.ground
  G.uCraft.value.copy(renderPos)
  const agl = renderPos.y - groundH(renderPos.x, renderPos.z)
  G.uShadow.value.set(renderPos.x - (SUN_DIR[0] / SUN_DIR[1]) * agl, renderPos.z - (SUN_DIR[2] / SUN_DIR[1]) * agl)
  G.uFwd.value.set(Math.sin(heading), Math.cos(heading))
  G.uBoost.value = craft.root.visible ? player.boost : 0
  G.uSpeed.value = Math.min(1, player.mach / 6)
  walker.shadow(G.uWalker.value)

  // Post.
  const s = Math.min(1, player.mach / 6)
  const P = post.final.uniforms
  damageFlash = Math.max(0, damageFlash - realDt * 1.8)
  if (player.barrier === 'silence') white = Math.min(1, white + realDt * 2.4)
  else white = Math.max(0, white - realDt * (player.barrier === 'boom' ? 1.6 : 4))
  P.uSpeed.value = mode === 'title' ? 0 : s
  P.uBlur.value = mode === 'title' ? 0 : CFG.post.radialBlur * (s * s * 1.2 + player.boost * 0.4 + white * 0.6)
  P.uAberr.value = mode === 'title' ? 0 : CFG.post.aberration * (s + player.boost * 0.5 + damageFlash)
  P.uStreak.value = mode === 'title' ? 0 : CFG.post.streaks * THREE.MathUtils.clamp((player.mach - 0.8) / 4, 0, 1)
  P.uStreakT.value += realDt * (0.4 + player.mach * 0.55)
  P.uWhite.value = white * 0.95
  P.uDamage.value = damageFlash
  P.uTime.value = time
  P.uGrain.value = CFG.post.grain
  P.uExposure.value = CFG.post.exposure
  post.bloom.strength = CFG.post.bloom
  post.bloom.threshold = CFG.post.bloomThreshold
  sound.update(realDt, mode === 'title' ? 0.2 : player.mach, player.boost, player.brake, combat.lockProgress, combat.locked, mode !== 'title' && !player.dead, walker.state === 'fight' || walker.state === 'coming' ? 1 : 0)

  post.render(realDt)
  updateHud(realDt)
  input.consume()
}

function updateHud(dt: number): void {
  if (mode === 'title') return
  const m = player.mach
  machNum.textContent = m.toFixed(2)
  for (let i = 0; i < 6; i++) {
    barCells[i].classList.toggle('on', m >= i + 0.5 || m > i + 1)
    barCells[i].classList.toggle('white', m >= 5.9)
  }
  hullFill.style.width = `${Math.max(0, player.hull)}%`
  hullEl.classList.toggle('low', player.hull < 35)
  scoreNum.textContent = String(score)
  scoreSub.textContent = `${combat.kills} DOWN · ${fmtTime(runTime)}`
  // Lock diamond: wobbles with speed (you are both moving too fast to hold still).
  const t = combat.lockTarget
  if (t && !player.dead) {
    proj.copy(t.pos).project(camera)
    if (proj.z < 1 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1) {
      const wob = (1 - combat.lockProgress * 0.6) * (4 + player.mach * 2)
      const x = (proj.x * 0.5 + 0.5) * innerWidth + noise(time * 9, 3) * wob
      const y = (-proj.y * 0.5 + 0.5) * innerHeight + noise(time * 9, 17) * wob
      lockEl.style.display = 'block'
      lockEl.style.transform = `translate(${x}px, ${y}px)`
      lockEl.style.setProperty('--s', String(1.7 - combat.lockProgress * 0.9))
      lockEl.classList.toggle('locked', combat.locked)
      ;(lockEl.querySelector('.t') as HTMLElement).textContent = combat.locked ? (t.kind === 'core' ? 'CORE · LOCKED' : 'LOCKED') : `${(t.pos.distanceTo(player.pos) / 1000).toFixed(1)} KM`
    } else lockEl.style.display = 'none'
  } else lockEl.style.display = 'none'
  // Walker arrow at the screen edge.
  if ((walker.state === 'fight' || walker.state === 'coming') && !player.dead) {
    proj.copy(walker.hullPos).project(camera)
    const behind = proj.z > 1
    let x = proj.x, y = proj.y
    if (behind) { x = -x; y = -y }
    const on = !behind && Math.abs(x) < 0.9 && Math.abs(y) < 0.9
    if (!on) {
      const a = Math.atan2(y, x)
      const ex = Math.cos(a) * 0.86, ey = Math.sin(a) * 0.8
      arrowEl.style.display = 'block'
      arrowEl.style.left = `${(ex * 0.5 + 0.5) * innerWidth - 14}px`
      arrowEl.style.top = `${(-ey * 0.5 + 0.5) * innerHeight - 13}px`
      arrowEl.style.transform = `rotate(${Math.PI / 2 - a}rad)`
      ;(arrowEl.querySelector('.t') as HTMLElement).textContent = `WALKER ${(walker.hullPos.distanceTo(player.pos) / 1000).toFixed(1)} KM`
    } else arrowEl.style.display = 'none'
  } else arrowEl.style.display = 'none'
  flashT = Math.max(0, flashT - dt)
  flashEl.style.opacity = String(Math.min(1, flashT * 3))
  flashEl.style.transform = `translate(-50%, -50%) scale(${1 + (1.1 - flashT) * 0.15})`
  warnT = Math.max(0, warnT - dt)
  warnEl.style.opacity = warnT > 0 ? String((Math.sin(warnT * 14) > -0.3 ? 1 : 0.2) * Math.min(1, warnT)) : '0'
  if (debugEl.style.display === 'block') {
    const i = renderer.info
    debugEl.textContent = `${fps.toFixed(0)} fps  ${lastMs.toFixed(1)} ms\ncalls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k\ntier ${tier} (${tierName})  scale ${renderScale.toFixed(2)}  pr ${pixelRatio().toFixed(2)}\nmach ${m.toFixed(2)}  particles ${fx.glow.count}+${fx.smoke.count}\ngeo ${i.memory.geometries}  tex ${i.memory.textures}`
  }
}

// ───────────────────────── keys ─────────────────────────
addEventListener('keydown', (e) => {
  sound.start()
  if (e.code === 'Backquote') debugEl.style.display = debugEl.style.display === 'block' ? 'none' : 'block'
  if (e.code === 'KeyG') void import('./gui').then((g) => g.toggleGui())
  if (e.code === 'Escape' && mode === 'play') {
    paused = !paused
    $('#pause').classList.toggle('hide', !paused)
    sound.suspend(paused)
    last = performance.now()
  }
  if (mode === 'title' && (e.code === 'Enter' || e.code === 'Space')) startRun()
  if (mode === 'over' && e.code === 'KeyR') startRun()
  if (mode === 'over' && e.code === 'KeyC' && !player.dead) { mode = 'play'; $('#over').classList.add('hide') }
  if (mode === 'play' && e.code === 'KeyR' && e.shiftKey) startRun()
})
addEventListener('mousedown', () => { sound.start(); if (mode === 'title') startRun() })
document.addEventListener('visibilitychange', () => {
  sound.suspend(document.hidden)
  last = performance.now()
})
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); paused = true })
canvas.addEventListener('webglcontextrestored', () => { paused = false; last = performance.now() })

// ───────────────────────── boot ─────────────────────────
player.reset()
// Start on the title, the craft idling on the sand, shaders compiled behind the loading veil.
renderPos.copy(player.pos)
camera.position.set(player.pos.x + 10, player.pos.y + 2, player.pos.z + 10)
camera.lookAt(player.pos)
world.update(camera.position, 0)
loadBar.style.width = '75%'
await renderer.compileAsync(scene, camera)
post.render(0.016)
loadBar.style.width = '100%'
$('#loading').classList.add('hide')
$('#title').classList.remove('hide')
requestAnimationFrame((t) => { last = t; frame(t) })

// Test hooks for tools/.
const g = {
  ready: true,
  get mode() { return mode },
  start: () => startRun(),
  autopilot: (on: boolean) => { autopilot = on },
  setMach: (m: number) => { player.speed = m * MACH },
  spawnWalker: () => { walker.spawn(); warnT = 4 },
  walkerNear: (d = 2200) => { walker.spawn(d, 500); walker.state = 'fight' },
  killCores: () => { for (const c of walker.cores) { c.hp = 1; c.hit(1) } },
  boom: (x: number) => fx.explosion(player.pos.x + player.fwd.x * x, player.pos.y + 20, player.pos.z + player.fwd.z * x, player.vel.x, 0, player.vel.z, 1.5),
  debug: (on: boolean) => { debugEl.style.display = on ? 'block' : 'none' },
  stats: () => ({ fps: Math.round(fps), ms: +lastMs.toFixed(1), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, mach: +player.mach.toFixed(2), tier, scale: renderScale, kills: combat.kills, hull: Math.round(player.hull), walker: walker.state, particles: fx.glow.count + fx.smoke.count }),
  player, combat, walker, CFG, tmp2,
}
;(window as unknown as { __g: typeof g }).__g = g
