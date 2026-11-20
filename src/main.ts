// The Distance Between Us — entry. Loop, modes (race / hunt), rendering of every racer, impacts,
// HUD, quality, test hooks.
import '@fontsource/chakra-petch/400.css'
import '@fontsource/chakra-petch/700.css'
import * as THREE from 'three'
import { CFG, MACH, REBASE } from './config'
import { World } from './world'
import { Craft, type Paint } from './craft'
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
import { Course, LAPS } from './course'
import { Race } from './race'
import { ChaseCam } from './camera'

const STEP = 1 / 60
const params = new URLSearchParams(location.search)
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T
const loadBar = $('#loading .b i')
loadBar.style.width = '10%'

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
const camera = new THREE.PerspectiveCamera(CFG.camera.fovBase, innerWidth / innerHeight, 0.3, 60000)

const course = new Course()
const world = new World((x, z, r) => course.distance(x, z) > 520 + r, (x, z, r) => course.distance(x, z) < 300 + r)
scene.add(world.group)
scene.add(course.group)
const env = world.makeEnv(renderer)
loadBar.style.width = '30%'
const tex = await loadTextures(renderer)
world.applyTextures(tex)
loadBar.style.width = '50%'
const fx = new Fx()
scene.add(fx.group)
const sound = new Sound()
const input = new Input()
const player = new Player()
const cam = new ChaseCam(camera)

// ───────────────────────── game state ─────────────────────────
type Mode = 'title' | 'race' | 'hunt'
let mode: Mode = 'title'
let overlay = false
let paused = false
let runTime = 0
let score = 0
let damageFlash = 0
let impactPulse = 0
let white = 0
let coneA = 0
let slowmoT = 0
let hitstop = 0
let walkerDone = false
let autopilot = params.has('auto')
let wrongT = 0
let offT = 0
let fovMax = CFG.camera.fovMax

const shake = (t: number) => { cam.trauma = Math.min(1, cam.trauma + t) }

const race = new Race(course, player, {
  gate(r, lapDone, missed) {
    if (r.p !== player) return
    if (missed) { warn('MISSED GATE', '+2.0 S'); sound.missed() }
    sound.gate(lapDone)
    if (lapDone) {
      const lap = race.lapOf(r)
      flash(lap === LAPS ? 'FINAL LAP' : `LAP ${lap}`)
      pop(`LAP ${fmtLap(r.lastLap)}${r.lastLap === r.bestLap ? '  BEST' : ''}`)
    }
  },
  finish(r) {
    if (r.p === player) {
      flash(`P${r.place} · FINISHED`)
      setTimeout(showResults, 2600)
    } else pop(`${r.name} FINISHED P${r.place}`)
  },
  pad(r) {
    if (r.p !== player) return
    sound.pad()
    cam.punch += 6
    shake(0.25)
    input.rumble(0.4, 0.8, 200)
  },
  bumped(a, b, sev, x, y, z) {
    const mine = a.p === player || b.p === player
    sparks(x, y, z, a.p.vel, Math.round(14 + sev * 30), mine ? 1 : 0.6)
    if (mine) {
      sound.clang(Math.min(1, sev))
      shake(0.25 + sev * 0.5)
      hitstop = Math.max(hitstop, 0.03)
      impactPulse = Math.max(impactPulse, 0.5)
      input.rumble(0.7, 1, 220)
      const o = a.p === player ? b.p : a.p
      cam.impulse(Math.sign(player.pos.x - o.pos.x) * 0.5, 0.2, Math.sign(player.pos.z - o.pos.z) * 0.5, 0.6 + sev)
    } else if (camera.position.distanceTo(a.p.pos) < 500) sound.clang(0.3)
  },
  countdown(n) {
    sound.start()
    sound.beep(false)
    showCount(String(n))
  },
  go(perfect) {
    sound.beep(true)
    showCount('GO')
    if (perfect) { flash('PERFECT START'); sound.boostKick(); cam.punch += 6 }
    shake(perfect ? 0.6 : 0.35)
  },
})

const PAINTS: Paint[] = [
  { body: 0xeef1f4, trim: 0xff5a14, number: '07' },
  { body: 0x1b1d24, trim: 0xff3fa4, number: '11' },
  { body: 0xf2f2ea, trim: 0x5fe02a, number: '23' },
  { body: 0x2a2018, trim: 0xffc21a, number: '04' },
  { body: 0x16324a, trim: 0x29d3ff, number: '88' },
  { body: 0xd8dde2, trim: 0xff3b30, number: '31' },
]
interface Visual { craft: Craft; trail: Trail[]; vapour: Trail[]; lastDust: THREE.Vector3; heading: number; wasDead: boolean; wasHidden: boolean }
const visuals = new Map<Player, Visual>()
race.racers.forEach((r, i) => {
  const craft = new Craft(env, PAINTS[i])
  scene.add(craft.root)
  const trail: Trail[] = []
  const nT = r.ai ? 1 : 3
  for (let k = 0; k < nT; k++) {
    const t = new Trail(r.ai ? 40 : 56, new THREE.Color(1.6, 0.5, 0.12), true, 0.9)
    t.width = r.ai ? 0.6 : 0.42
    trail.push(t)
    scene.add(t.mesh)
  }
  const vapour: Trail[] = []
  if (!r.ai) for (let k = 0; k < 2; k++) {
    const t = new Trail(40, new THREE.Color(1, 1, 1), false, 0.6)
    t.width = 0.25
    vapour.push(t)
    scene.add(t.mesh)
  }
  visuals.set(r.p, { craft, trail, vapour, lastDust: new THREE.Vector3(), heading: 0, wasDead: false, wasHidden: false })
  if (r.ai) {
    r.p.onCrash = (sev, big, x, y, z) => { if (camera.position.distanceTo(r.p.pos) < 800) sparks(x, y, z, r.p.vel, big ? 30 : 10, 0.7 + sev) }
    r.p.onLand = (impact) => { if (camera.position.distanceTo(r.p.pos) < 700) landDust(r.p, impact) }
  }
})
const myCraft = visuals.get(player)!.craft

// Blob shadows under the rivals (the player's is drawn by the ground shader itself).
const shadowMesh = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec2 vUv; void main(){ vec2 p = vUv * 2.0 - 1.0; float a = 1.0 - smoothstep(0.35, 1.0, length(p)); gl_FragColor = vec4(0.05, 0.02, 0.01, a * 0.5); }',
  }),
  race.racers.length,
)
shadowMesh.frustumCulled = false
shadowMesh.renderOrder = 1
scene.add(shadowMesh)
const shadowM = new THREE.Matrix4()
const shadowQ = new THREE.Quaternion()
const shadowS = new THREE.Vector3()
const Y_AXIS = new THREE.Vector3(0, 1, 0)

// Hunt mode: the old combat sandbox.
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
  scored(points, label) { score += points; pop(`+${points}  ${label}`); hitstop = 0.05 },
  shake,
  extraTargets: () => walker.cores as readonly Target[],
})
scene.add(combat.group)
const walker = new Walker(player, fx, sound, combat, shake)
scene.add(walker.root, walker.ring)
walker.onCoreLost = (left) => { score += 500; pop(left > 0 ? `+500  CORE · ${left} LEFT` : '+500  LAST CORE'); flash(left > 0 ? `${left} CORES LEFT` : "IT'S GOING DOWN") }
walker.onFall = () => { slowmoT = 2.6; sound.slowmo(1) }
walker.onDown = () => { walkerDone = true; score += 5000; pop('+5000  WALKER DOWN'); flash('WALKER DOWN'); combat.pressure = 4 }

// ───────────────────────── player feedback ─────────────────────────
player.onMach = (m) => {
  flash(`MACH ${m}`)
  sound.machCrack(m)
  coneA = 0.7
  shake(0.12 + m * 0.025)
  cam.punch += 1.5
}
player.onBarrier = (ph) => {
  if (ph === 'none') return
  sound.barrier(ph)
  if (ph === 'boom') {
    flash('MACH 6')
    shake(0.8)
    coneA = 1.2
    cam.punch += 6
    input.rumble(1, 1, 500)
    fx.dust(player.pos.x, groundH(player.pos.x, player.pos.z), player.pos.z, player.vel.x * 0.4, player.vel.z * 0.4, 30, 22, 50)
  }
}
player.onBoostStart = () => { sound.boostKick(); shake(0.15); cam.punch += 2; input.rumble(0.6, 0.3, 160) }
player.onLaunch = (vy) => { sound.launch(Math.min(1, vy / 70)); cam.punch += 2 }
player.onLand = (impact, air) => {
  landDust(player, impact)
  sound.land(impact)
  shake(Math.min(0.7, impact / 110))
  cam.impulse(0, -1, 0, Math.min(1.5, impact / 50))
  input.rumble(Math.min(1, impact / 80), 0.5, 180)
  if (air > 1.2) pop(`AIR ${air.toFixed(1)} S`)
}
player.onCrash = (sev, big, x, y, z, nx, nz) => {
  sound.crash(big)
  sparks(x, y, z, player.vel, big ? Math.round(30 + sev * 80) : 18, 1 + sev)
  if (big) {
    // A wall: freeze a beat, zoom in, kick the camera off the rock, spray rock and sand.
    const hard = Math.min(1, sev * 1.5)
    hitstop = Math.max(hitstop, 0.04 + hard * 0.08)
    shake(0.35 + hard * 0.7)
    damageFlash = Math.max(damageFlash, 0.3 + hard * 0.7)
    impactPulse = 1
    cam.punch -= 3 + hard * 6
    cam.impulse(nx, 0.3, nz, 0.8 + hard * 2.5)
    input.rumble(0.6 + hard * 0.4, 1, 200 + hard * 400)
    fx.dust(x, y - 2, z, nx * 40 + player.vel.x * 0.3, nz * 40 + player.vel.z * 0.3, Math.round(10 + hard * 20), 10 + hard * 14, 25 + hard * 25)
    debris(x, y, z, nx, nz, Math.round(6 + hard * 18))
    if (hard > 0.5) fx.explosion(x, y, z, player.vel.x * 0.4, 0, player.vel.z * 0.4, 0.4)
  } else {
    shake(0.3)
    damageFlash = Math.max(damageFlash, 0.25)
    impactPulse = Math.max(impactPulse, 0.4)
    cam.impulse(nx, 0.4, nz, 0.5)
    input.rumble(0.5, 0.8, 120)
    debris(x, y, z, nx, nz, 6)
  }
  if (player.hull <= 0) die()
}

function sparks(x: number, y: number, z: number, v: THREE.Vector3, n: number, k: number): void {
  for (let i = 0; i < n; i++) {
    const e = resetE()
    e.x = x; e.y = y; e.z = z
    e.vx = v.x * 0.85 + (Math.random() - 0.5) * 160 * k; e.vy = Math.random() * 90 * k; e.vz = v.z * 0.85 + (Math.random() - 0.5) * 160 * k
    e.life = 0.3 + Math.random() * 0.5; e.size0 = 0.5; e.size1 = 0.25
    e.r = 6; e.g = 3.2; e.b = 1.2; e.a = 1; e.drag = 1.4; e.grav = 60; e.streak = 1
    fx.glow.emit(e)
  }
}
/** Chunks of rock (dark, falling) knocked off a wall. */
function debris(x: number, y: number, z: number, nx: number, nz: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const e = resetE()
    e.x = x; e.y = y + Math.random() * 2; e.z = z
    const sp = 30 + Math.random() * 70
    e.vx = nx * sp + player.vel.x * 0.5 + (Math.random() - 0.5) * 40; e.vy = 20 + Math.random() * 50; e.vz = nz * sp + player.vel.z * 0.5 + (Math.random() - 0.5) * 40
    e.life = 0.8 + Math.random() * 0.7; e.size0 = 0.8 + Math.random() * 1.4; e.size1 = e.size0
    e.r = 0.22; e.g = 0.08; e.b = 0.04; e.a = 1; e.r1 = 1; e.g1 = 1; e.b1 = 1; e.drag = 0.6; e.grav = 70
    fx.smoke.emit(e)
  }
}
/** A ring of sand thrown out on landing. */
function landDust(p: Player, impact: number): void {
  const g = groundH(p.pos.x, p.pos.z)
  const n = Math.round(8 + Math.min(30, impact / 3))
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const sp = 20 + impact * 0.6
    const e = resetE()
    e.x = p.pos.x; e.y = g + 0.6; e.z = p.pos.z
    e.vx = p.vel.x * 0.35 + Math.cos(a) * sp; e.vy = 4 + Math.random() * 10; e.vz = p.vel.z * 0.35 + Math.sin(a) * sp
    e.life = 1.2 + Math.random(); e.size0 = 3; e.size1 = 12 + impact * 0.15
    e.r = 0.8; e.g = 0.42; e.b = 0.21; e.a = 0.45; e.drag = 2.2; e.grav = 4
    fx.smoke.emit(e)
  }
}

function die(): void {
  if (player.dead) return
  player.dead = true
  player.hull = 0
  fx.explosion(player.pos.x, player.pos.y + 1, player.pos.z, player.vel.x * 0.7, 10, player.vel.z * 0.7, 2.2)
  sound.death()
  shake(1)
  slowmoT = 1.4
  if (mode === 'race') {
    race.racers[0].respawnT = 1.8
    setTimeout(() => { if (mode === 'race') sound.revive() }, 1800)
  } else setTimeout(() => showHuntOver(), 2200)
}

// ───────────────────────── HUD ─────────────────────────
const hud = $('#hud')
const machNum = $('#mach .num')
const barCells = Array.from(document.querySelectorAll<HTMLElement>('#bar i'))
const hullEl = $('#hull')
const hullFill = $('#hull .fill')
const scoreEl = $('#score')
const scoreNum = $('#score .num')
const scoreSub = $('#score .sub')
const lockEl = $('#lock')
const arrowEl = $('#arrow')
const flashEl = $('#flash')
const warnEl = $('#warn')
const hintsEl = $('#hints')
const debugEl = $('#debug')
const raceEl = $('#race')
const standEl = $('#stand')
const countEl = $('#count')
const mini = $<HTMLCanvasElement>('#mini')
const reticle = $('#reticle')
let flashT = 0
let warnT = 0
let countT = 0

function flash(text: string): void { flashEl.textContent = text; flashT = 1.1 }
function warn(big: string, small: string): void {
  ;(warnEl.querySelector('.big') as HTMLElement).textContent = big
  ;(warnEl.querySelector('.small') as HTMLElement).textContent = small
  warnT = 2
}
function showCount(t: string): void { countEl.textContent = t; countT = 1 }
function pop(text: string): void {
  const d = document.createElement('div')
  d.textContent = text
  $('#pops').prepend(d)
  setTimeout(() => d.remove(), 1700)
}
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
const fmtLap = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`
const ord = (n: number) => `${n}${n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH'}`

function showResults(): void {
  if (mode !== 'race') return
  overlay = true
  const rows = [...race.racers].sort((a, b) => a.place - b.place)
  $('#over-h').textContent = `${ord(race.racers[0].place)} PLACE`
  $('#over-stats').innerHTML = `BEST LAP ${fmtLap(race.racers[0].bestLap)} · TOP SPEED MACH ${player.topMach.toFixed(2)}`
  $('#res').innerHTML = rows.map((r) => `<tr class="${r.ai ? '' : 'me'}"><td>${r.place}</td><td>${r.name}</td><td>${r.finished ? fmtLap(r.finishTime) : 'RACING'}</td><td>${r.bestLap ? fmtLap(r.bestLap) : ''}</td></tr>`).join('')
  $('#over .go').textContent = 'R TO RACE AGAIN · H FOR HUNT · ESC TO KEEP FLYING'
  $('#over').classList.remove('hide')
}
function showHuntOver(): void {
  if (mode !== 'hunt') return
  overlay = true
  $('#over-h').textContent = walkerDone && !player.dead ? 'WALKER DOWN' : 'SIGNAL LOST'
  $('#over-stats').innerHTML = `SCORE ${score}<br/>TOP SPEED MACH ${player.topMach.toFixed(2)}<br/>DRONES DOWN ${combat.kills}<br/>TIME ${fmtTime(runTime)}`
  $('#res').innerHTML = ''
  $('#over .go').textContent = 'R TO RUN IT AGAIN · ENTER FOR A RACE'
  $('#over').classList.remove('hide')
}

function resetVisuals(): void {
  fx.clear()
  for (const v of visuals.values()) { for (const t of [...v.trail, ...v.vapour]) t.reset(); v.craft.root.visible = true }
}

function startRace(): void {
  sound.start()
  sound.revive()
  mode = 'race'
  overlay = false
  combat.enabled = false
  combat.reset()
  walker.hide()
  race.reset()
  resetVisuals()
  for (const r of race.racers) visuals.get(r.p)!.lastDust.copy(r.p.pos)
  cam.snap(player.heading)
  runTime = 0
  damageFlash = 0
  slowmoT = 0
  wrongT = offT = 0
  $('#title').classList.add('hide')
  $('#over').classList.add('hide')
  hud.classList.add('on')
  raceEl.classList.add('on')
  standEl.classList.add('on')
  mini.classList.add('on')
  scoreEl.style.display = 'none'
  reticle.style.display = 'none'
  hintsEl.style.opacity = '0.85'
  setTimeout(() => (hintsEl.style.opacity = '0'), 14000)
}

function startHunt(): void {
  sound.start()
  sound.revive()
  mode = 'hunt'
  overlay = false
  player.reset()
  combat.reset()
  combat.enabled = true
  walker.hide()
  walkerDone = false
  resetVisuals()
  for (const r of race.racers) if (r.ai) visuals.get(r.p)!.craft.root.visible = false
  visuals.get(player)!.lastDust.copy(player.pos)
  cam.snap(player.heading)
  runTime = 0
  score = 0
  damageFlash = 0
  slowmoT = 0
  $('#title').classList.add('hide')
  $('#over').classList.add('hide')
  hud.classList.add('on')
  raceEl.classList.remove('on')
  standEl.classList.remove('on')
  mini.classList.remove('on')
  scoreEl.style.display = ''
  reticle.style.display = ''
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

const qSel = $<HTMLSelectElement>('#q')
qSel.value = tierName
qSel.onchange = () => { tierName = qSel.value as Tier | 'auto'; tier = tierName === 'auto' ? 'high' : tierName; renderScale = 1; applyTier() }
const vols = () => sound.setVolumes(+$<HTMLInputElement>('#vm').value, +$<HTMLInputElement>('#vmu').value, +$<HTMLInputElement>('#vs').value)
for (const id of ['#vm', '#vmu', '#vs']) $(id).oninput = vols
$<HTMLInputElement>('#rs').onchange = (e) => { CFG.camera.reduceShake = (e.target as HTMLInputElement).checked }
$<HTMLInputElement>('#fov').oninput = (e) => { fovMax = +(e.target as HTMLInputElement).value }
try {
  const saved = localStorage.getItem('dbu-fov')
  if (saved) { fovMax = +saved; $<HTMLInputElement>('#fov').value = saved }
  $<HTMLInputElement>('#fov').addEventListener('change', () => { try { localStorage.setItem('dbu-fov', String(fovMax)) } catch { /* private mode */ } })
} catch { /* storage blocked */ }

// ───────────────────────── loop ─────────────────────────
let acc = 0
let last = performance.now()
let time = 0
let frames = 0, fpsT = 0, fps = 0, lastMs = 16
const tmp = new THREE.Vector3()
const nozzleW = new THREE.Vector3()
const proj = new THREE.Vector3()
const renderPos = new THREE.Vector3()
let attractYaw = 0
let hudT = 0

function rebase(): void {
  if (mode !== 'hunt') return
  const dx = player.pos.x > REBASE / 2 ? -REBASE : player.pos.x < -REBASE / 2 ? REBASE : 0
  const dz = player.pos.z > REBASE / 2 ? -REBASE : player.pos.z < -REBASE / 2 ? REBASE : 0
  if (!dx && !dz) return
  player.shift(dx, dz)
  combat.shift(dx, dz)
  walker.shift(dx, dz)
  fx.shift(dx, dz)
  for (const v of visuals.values()) { for (const t of [...v.trail, ...v.vapour]) t.shift(dx, dz); v.lastDust.x += dx; v.lastDust.z += dz }
}

function simStep(): void {
  if (mode === 'race') {
    const me = race.racers[0]
    if (autopilot) race.drive(me, STEP)
    race.step(STEP, autopilot ? me.controls : input.c, world)
    if (race.state !== 'grid') runTime += STEP
  } else if (mode === 'hunt') {
    if (autopilot) huntAutopilot()
    player.step(STEP, input.c, world)
    combat.step(STEP, input.fire)
    walker.step(STEP)
    rebase()
    if (!player.dead) runTime += STEP
    if (walker.state === 'off' && !walkerDone && !player.dead && (combat.kills >= CFG.combat.walkerAfterKills || runTime > CFG.combat.walkerAfterSeconds)) {
      walker.spawn()
      warn('WALKER', 'ON THE HORIZON · HIT ITS FOUR CORES')
      warnT = 4
      combat.pressure = 2
    }
  }
}

function huntAutopilot(): void {
  const c = input.c
  c.boost = true; c.brake = false; c.strafe = 0; c.dodgeL = c.dodgeR = false
  let steer = 0
  if (walker.state === 'fight' || walker.state === 'coming') {
    tmp.subVectors(walker.hullPos, player.pos)
    const d = Math.hypot(tmp.x, tmp.z)
    let dh = Math.atan2(tmp.x, tmp.z) + (d < 3500 ? 1.1 : 0) - player.heading
    dh = Math.atan2(Math.sin(dh), Math.cos(dh))
    steer = THREE.MathUtils.clamp(-dh * 2, -1, 1)
  }
  // Rocks ahead: steer around them.
  const look = Math.max(600, player.speed * 1.4)
  const n = world.near(player.pos.x + player.fwd.x * look * 0.5, player.pos.z + player.fwd.z * look * 0.5, player.pos.y, look * 0.6, huntObs)
  for (let i = 0; i < n; i++) {
    const o = huntObs[i]
    tmp.set(o.x - player.pos.x, 0, o.z - player.pos.z)
    const ahead = tmp.dot(player.fwd)
    const side = tmp.dot(player.right)
    if (ahead > 0 && ahead < look && Math.abs(side) < o.cr + (o.big ? 160 : 30)) steer += side > 0 ? -1.2 : 1.2
  }
  c.steer = THREE.MathUtils.clamp(steer, -1, 1)
  input.fire = combat.locked
}
const huntObs: import('./world').Obstacle[] = []

/** Draw one racer's craft, flames, trails and dust. */
function drawRacer(p: Player, alpha: number, dt: number, isMe: boolean): void {
  const v = visuals.get(p)!
  const craft = v.craft
  if (!craft.root.visible) return
  tmp.lerpVectors(p.prev, p.pos, alpha)
  let dh = p.heading - p.prevHeading
  dh = Math.atan2(Math.sin(dh), Math.cos(dh))
  const heading = p.prevHeading + dh * alpha
  v.heading = heading
  craft.root.position.copy(tmp)
  craft.root.rotation.set(0, heading, 0)
  craft.body.rotation.set(THREE.MathUtils.lerp(p.prevPitch, p.pitch, alpha), 0, -THREE.MathUtils.lerp(p.prevBank, p.bank, alpha))
  // Suspension squash on landing.
  craft.body.position.y = -p.squash * 0.55
  craft.body.scale.set(1 + p.squash * 0.04, 1 - p.squash * 0.1, 1)
  craft.root.updateMatrixWorld(true)
  craft.lod(camera.position)
  const throttle = mode === 'title' ? 0.15 : p.dead ? 0 : 0.5 + 0.5 * Math.min(1, p.mach / 2)
  craft.setFlames(throttle, p.boost, time + (isMe ? 0 : p.pos.x * 0.01))
  if (mode === 'title' || p.dead) return
  const near = camera.position.distanceToSquared(tmp) < 1500 * 1500
  for (let i = 0; i < v.trail.length; i++) {
    nozzleW.copy(craft.nozzles[v.trail.length === 1 ? 1 : i]).applyMatrix4(craft.body.matrixWorld)
    v.trail[i].push(nozzleW, dt)
    v.trail[i].strength = 0.2 + p.boost * 0.8
  }
  if (isMe) {
    const vap = THREE.MathUtils.clamp((p.mach - 1.5) / 3, 0, 1) * (0.25 + Math.min(1, Math.abs(p.yawRate) * 1.4))
    for (let i = 0; i < 2; i++) {
      nozzleW.copy(craft.wingtips[i]).applyMatrix4(craft.body.matrixWorld)
      v.vapour[i].push(nozzleW, dt)
      v.vapour[i].strength = vap * 0.6
    }
  }
  // Sand thrown up behind, laid along the path since last frame.
  if (near && p.agl < 8) {
    const seg = v.lastDust.distanceTo(tmp)
    const n = Math.min(isMe ? 10 : 4, Math.ceil(seg / 14)) * (0.4 + p.boost * 0.8 + p.brake * 2)
    for (let i = 0; i < n; i++) {
      const k = Math.random()
      const x = v.lastDust.x + (tmp.x - v.lastDust.x) * k, z = v.lastDust.z + (tmp.z - v.lastDust.z) * k
      const e = resetE()
      e.x = x + (Math.random() - 0.5) * 4; e.y = groundH(x, z) + 0.5; e.z = z + (Math.random() - 0.5) * 4
      const sp = 14 + p.boost * 22
      e.vx = p.vel.x * 0.08 + p.right.x * (Math.random() - 0.5) * sp * 2; e.vy = 6 + Math.random() * sp; e.vz = p.vel.z * 0.08 + p.right.z * (Math.random() - 0.5) * sp * 2
      e.life = 0.9 + Math.random() * 1.1; e.size0 = 1.5; e.size1 = 9 + p.boost * 8
      e.r = 0.8; e.g = 0.42; e.b = 0.21; e.a = 0.3 * (1 - p.agl / 8); e.drag = 2.4; e.grav = 6
      fx.smoke.emit(e)
    }
  }
  // Rubbing rock: a stream of sparks at the contact.
  if (p.scrape > 0.05 && near) sparks(p.scrapeAt.x, p.scrapeAt.y, p.scrapeAt.z, p.vel, Math.ceil(p.scrape * 6), 0.6)
  if (isMe && (Math.abs(input.c.strafe) > 0.2 || input.c.dodgeL || input.c.dodgeR)) {
    const side = input.c.strafe > 0 || input.c.dodgeR ? 0 : 1
    nozzleW.copy(craft.sidePuffs[side]).applyMatrix4(craft.body.matrixWorld)
    const e = resetE()
    e.x = nozzleW.x; e.y = nozzleW.y; e.z = nozzleW.z
    const out = side === 0 ? -1 : 1
    e.vx = p.vel.x + p.right.x * out * 40; e.vy = 0; e.vz = p.vel.z + p.right.z * out * 40
    e.life = 0.15; e.size0 = 1.6; e.size1 = 3.5; e.r = 1.5; e.g = 3; e.b = 6; e.a = 1; e.drag = 4
    fx.glow.emit(e)
  }
  // Smoking when badly hurt.
  if (p.hull < 35 && near) {
    const e = resetE()
    e.x = tmp.x; e.y = tmp.y + 0.8; e.z = tmp.z
    e.vx = p.vel.x * 0.7; e.vy = 6; e.vz = p.vel.z * 0.7
    e.life = 1; e.size0 = 1.5; e.size1 = 7; e.r = 0.06; e.g = 0.055; e.b = 0.05; e.a = 0.6; e.r1 = 3; e.g1 = 3; e.b1 = 3; e.drag = 3
    fx.smoke.emit(e)
  }
  v.lastDust.copy(tmp)
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

  let timeScale = 1
  if (hitstop > 0) { hitstop -= realDt; timeScale = 0.06 }
  else if (slowmoT > 0) { slowmoT -= realDt; timeScale = THREE.MathUtils.lerp(1, 0.28, Math.min(1, slowmoT / 0.6)); if (slowmoT <= 0) sound.slowmo(0) }
  if (slowmoT > 0) sound.slowmo(Math.min(1, slowmoT / 0.6))
  const dt = realDt * timeScale
  time += dt

  input.read(realDt, now / 1000)
  if (mode === 'title') {
    player.prev.copy(player.pos)
    player.pos.y = groundH(player.pos.x, player.pos.z) + CFG.handling.hover + Math.sin(time * 1.6) * 0.25
  } else {
    acc += dt
    let steps = 0
    while (acc >= STEP && steps < 6) { simStep(); acc -= STEP; steps++ }
    if (steps >= 6) acc = 0
  }
  const alpha = mode === 'title' ? 1 : acc / STEP

  for (const r of race.racers) {
    const v = visuals.get(r.p)!
    if (r.ai && mode !== 'race') { v.craft.root.visible = false; continue }
    // Wrecked: a fireball, then hidden until the respawn (visibility always follows the state).
    if (r.p.dead && !v.wasDead && r.ai && camera.position.distanceTo(r.p.pos) < 3000) {
      fx.explosion(r.p.pos.x, r.p.pos.y + 1, r.p.pos.z, r.p.vel.x * 0.6, 8, r.p.vel.z * 0.6, 1.6)
      sound.explosion(camera.position.distanceTo(r.p.pos), 1.5)
    }
    v.wasDead = r.p.dead
    v.craft.root.visible = !r.p.dead
    if (!r.p.dead && v.wasHidden) { v.lastDust.copy(r.p.pos); for (const t of v.trail) t.reset() }
    v.wasHidden = r.p.dead
    drawRacer(r.p, alpha, dt, r.p === player)
  }
  let ns = 0
  if (mode === 'race') for (const r of race.racers) {
    if (!r.ai) continue
    const c = visuals.get(r.p)!.craft
    if (!c.root.visible) continue
    const p = c.root.position
    const g = groundH(p.x, p.z)
    const h = Math.max(0, p.y - g)
    // Cast along the sun; wider and fainter the higher it flies.
    const k = 1 + h * 0.04
    shadowS.set(6.4 * k, 1, 10.5 * k)
    shadowQ.setFromAxisAngle(Y_AXIS, visuals.get(r.p)!.heading)
    shadowM.compose(tmp.set(p.x - (SUN_DIR[0] / SUN_DIR[1]) * h, g + 0.3, p.z - (SUN_DIR[2] / SUN_DIR[1]) * h), shadowQ, shadowS)
    if (h < 120) shadowMesh.setMatrixAt(ns++, shadowM)
  }
  shadowMesh.count = ns
  shadowMesh.instanceMatrix.needsUpdate = true
  renderPos.copy(myCraft.root.position)
  const heading = visuals.get(player)!.heading
  coneA = Math.max(0, coneA - realDt * 2.2)
  const nearMach1 = Math.max(0, 1 - Math.abs(player.mach - 1) / 0.06) * 0.4
  myCraft.setCone(mode === 'title' ? 0 : Math.max(coneA, nearMach1), time)

  if (mode === 'title') {
    attractYaw += realDt * 0.12
    // A low three-quarter view, the ship in the lower right, the title above it.
    const r = 17
    const a = heading + Math.PI * 0.8 + Math.sin(attractYaw) * 0.3
    camera.position.set(renderPos.x + Math.sin(a) * r, renderPos.y + 1.1, renderPos.z + Math.cos(a) * r)
    tmp.set(-Math.cos(a), 0, Math.sin(a))
    camera.lookAt(renderPos.x + tmp.x * 2.2, renderPos.y + 3.4, renderPos.z + tmp.z * 2.2)
    camera.fov = 42
    camera.updateProjectionMatrix()
  } else {
    cam.update(realDt, time, player, renderPos, heading, world, fovMax)
  }

  const me = race.racers[0]
  course.update(mode === 'race' ? me.next : -1, time, race.lapOf(me) === LAPS && me.passed > 0)
  course.group.visible = mode !== 'hunt'

  if (mode === 'hunt') combat.render(alpha, realDt, time)
  combat.group.visible = mode === 'hunt'
  fx.update(dt)
  for (const v of visuals.values()) for (const t of [...v.trail, ...v.vapour]) t.build(camera.position)
  sound.scrape(mode === 'title' ? 0 : player.scrape)

  world.update(camera.position, time)
  const G = world.ground
  G.uCraft.value.copy(renderPos)
  const agl = Math.max(0, renderPos.y - groundH(renderPos.x, renderPos.z))
  G.uShadow.value.set(renderPos.x - (SUN_DIR[0] / SUN_DIR[1]) * agl, renderPos.z - (SUN_DIR[2] / SUN_DIR[1]) * agl)
  G.uShadowK.value = agl
  G.uFwd.value.set(Math.sin(heading), Math.cos(heading))
  G.uBoost.value = myCraft.root.visible ? player.boost : 0
  G.uSpeed.value = Math.min(1, player.mach / 6)
  walker.shadow(G.uWalker.value)

  // Post.
  const s = Math.min(1, player.mach / 6)
  const P = post.final.uniforms
  const play = mode !== 'title'
  damageFlash = Math.max(0, damageFlash - realDt * 1.8)
  impactPulse = Math.max(0, impactPulse - realDt * 3)
  if (player.barrier === 'silence') white = Math.min(1, white + realDt * 2.4)
  else white = Math.max(0, white - realDt * (player.barrier === 'boom' ? 1.6 : 4))
  P.uSpeed.value = play ? s : 0
  P.uBlur.value = play ? CFG.post.radialBlur * (s * s * 1.2 + player.boost * 0.4 + white * 0.6 + impactPulse * 0.8) : 0
  P.uAberr.value = play ? CFG.post.aberration * (s + player.boost * 0.5 + damageFlash + impactPulse * 2.5) : 0
  P.uStreak.value = play ? CFG.post.streaks * THREE.MathUtils.clamp((player.mach - 0.8) / 4, 0, 1) : 0
  P.uStreakT.value += realDt * (0.4 + player.mach * 0.45)
  P.uWhite.value = white * 0.95
  P.uDamage.value = damageFlash
  P.uTime.value = time
  P.uGrain.value = CFG.post.grain
  P.uExposure.value = CFG.post.exposure
  post.bloom.strength = CFG.post.bloom
  post.bloom.threshold = CFG.post.bloomThreshold
  const onGrid = mode === 'race' && race.state === 'grid'
  const engineMach = mode === 'title' ? 0.2 : onGrid ? 0.3 + player.boost * 0.9 : player.mach
  const heat = mode === 'race' ? Math.min(1, Math.max(0, me.passed - 1) / (course.cps.length * LAPS) * 1.5) : walker.state === 'fight' || walker.state === 'coming' ? 1 : 0
  sound.update(realDt, engineMach, player.boost, player.brake, mode === 'hunt' ? combat.lockProgress : 0, mode === 'hunt' && combat.locked, play && !player.dead, heat)

  post.render(realDt)
  hudT -= realDt
  updateHud(realDt, hudT <= 0)
  if (hudT <= 0) hudT = 0.1
  input.consume()
}

function updateHud(dt: number, slow: boolean): void {
  if (mode === 'title') return
  const m = player.mach
  machNum.textContent = m.toFixed(2)
  for (let i = 0; i < 6; i++) {
    barCells[i].classList.toggle('on', m >= i + 0.5 || m > i + 1)
    barCells[i].classList.toggle('white', m >= 5.9)
  }
  hullFill.style.width = `${Math.max(0, player.hull)}%`
  hullEl.classList.toggle('low', player.hull < 35)
  flashT = Math.max(0, flashT - dt)
  flashEl.style.opacity = String(Math.min(1, flashT * 3))
  flashEl.style.transform = `translate(-50%, -50%) scale(${1 + (1.1 - flashT) * 0.15})`
  warnT = Math.max(0, warnT - dt)
  warnEl.style.opacity = warnT > 0 ? String((Math.sin(warnT * 14) > -0.3 ? 1 : 0.2) * Math.min(1, warnT)) : '0'
  countT = Math.max(0, countT - dt)
  countEl.style.opacity = String(Math.min(1, countT * 2.5))
  countEl.style.transform = `translate(-50%, -50%) scale(${1 + (1 - countT) * 0.35})`

  if (mode === 'race') {
    const me = race.racers[0]
    if (slow) {
      $('#r-pos').innerHTML = `${me.place}<small>/${race.racers.length}</small>`
      $('#r-lap').innerHTML = `${race.state === 'grid' ? 1 : race.lapOf(me)}<small>/${LAPS}</small>`
      $('#r-pen').textContent = me.penalty ? `+${me.penalty.toFixed(0)} S PENALTY` : ''
      const rows = [...race.racers].sort((a, b) => a.place - b.place)
      const lead = race.progress(rows[0])
      standEl.innerHTML = rows.map((r) => {
        const gap = r === rows[0] ? 'LEADER' : r.finished ? fmtLap(r.finishTime) : `+${((lead - race.progress(r)) / Math.max(800, player.speed)).toFixed(1)}`
        return `<div class="${r.ai ? '' : 'me'}" style="--c:#${new THREE.Color(r.color).getHexString()}"><span>${r.place}&nbsp;&nbsp;${r.name}</span><span class="g">${gap}</span></div>`
      }).join('')
      drawMini()
    }
    $('#r-time').textContent = fmtLap(me.finished ? me.finishTime : race.clock + me.penalty)
    const [tx, tz] = course.tangent(me.idx)
    const along = player.vel.x * tx + player.vel.z * tz
    wrongT = race.state === 'racing' && along < -0.3 * player.speed && player.speed > 100 ? wrongT + dt : 0
    if (wrongT > 1.2 && warnT < 0.5) warn('WRONG WAY', 'TURN AROUND · R FOR THE LAST GATE')
    const off = Math.hypot(player.pos.x - course.px[me.idx], player.pos.z - course.pz[me.idx])
    offT = off > 2600 && race.state === 'racing' ? offT + dt : 0
    if (offT > 1 && warnT < 0.5) warn('OFF COURSE', 'R TO RETURN TO THE LAST GATE')
    const c = course.cps[me.next]
    proj.set(c.x, groundH(c.x, c.z) + 40, c.z).project(camera)
    arrowTo(proj, me.finished ? '' : `${me.next === 0 ? 'FINISH' : 'GATE ' + me.next} · ${(Math.hypot(c.x - player.pos.x, c.z - player.pos.z) / 1000).toFixed(1)} KM`)
    lockEl.style.display = 'none'
  } else if (mode === 'hunt') {
    scoreNum.textContent = String(score)
    scoreSub.textContent = `${combat.kills} DOWN · ${fmtTime(runTime)}`
    const t = combat.lockTarget
    if (t && !player.dead) {
      proj.copy(t.pos).project(camera)
      if (proj.z < 1 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1) {
        const wob = (1 - combat.lockProgress * 0.6) * (4 + m * 2)
        const x = (proj.x * 0.5 + 0.5) * innerWidth + Math.sin(time * 31) * wob
        const y = (-proj.y * 0.5 + 0.5) * innerHeight + Math.cos(time * 27) * wob
        lockEl.style.display = 'block'
        lockEl.style.transform = `translate(${x}px, ${y}px)`
        lockEl.style.setProperty('--s', String(1.7 - combat.lockProgress * 0.9))
        lockEl.classList.toggle('locked', combat.locked)
        ;(lockEl.querySelector('.t') as HTMLElement).textContent = combat.locked ? (t.kind === 'core' ? 'CORE · LOCKED' : 'LOCKED') : `${(t.pos.distanceTo(player.pos) / 1000).toFixed(1)} KM`
      } else lockEl.style.display = 'none'
    } else lockEl.style.display = 'none'
    if ((walker.state === 'fight' || walker.state === 'coming') && !player.dead) {
      proj.copy(walker.hullPos).project(camera)
      arrowTo(proj, `WALKER ${(walker.hullPos.distanceTo(player.pos) / 1000).toFixed(1)} KM`)
    } else arrowEl.style.display = 'none'
  }
  if (debugEl.style.display === 'block' && slow) {
    const i = renderer.info
    debugEl.textContent = `${fps.toFixed(0)} fps  ${lastMs.toFixed(1)} ms\ncalls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k\ntier ${tier} (${tierName})  scale ${renderScale.toFixed(2)}  pr ${pixelRatio().toFixed(2)}\nmach ${m.toFixed(2)}  agl ${player.agl.toFixed(1)}  air ${player.airborne}\nparticles ${fx.glow.count}+${fx.smoke.count}`
  }
}

/** The edge arrow toward a projected point when it is off screen. */
function arrowTo(p: THREE.Vector3, label: string): void {
  const behind = p.z > 1
  let x = p.x, y = p.y
  if (behind) { x = -x; y = -y }
  const on = !behind && Math.abs(x) < 0.9 && Math.abs(y) < 0.9
  if (on || !label) { arrowEl.style.display = 'none'; return }
  const a = Math.atan2(y, x)
  const ex = Math.cos(a) * 0.86, ey = Math.sin(a) * 0.8
  arrowEl.style.display = 'block'
  arrowEl.style.left = `${(ex * 0.5 + 0.5) * innerWidth - 14}px`
  arrowEl.style.top = `${(-ey * 0.5 + 0.5) * innerHeight - 13}px`
  arrowEl.style.transform = `rotate(${Math.PI / 2 - a}rad)`
  ;(arrowEl.querySelector('.t') as HTMLElement).textContent = label
}

// Minimap: the whole course, north up, racers as dots, you as an arrow.
const miniCtx = mini.getContext('2d')!
const bounds = (() => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let i = 0; i < course.n; i++) { x0 = Math.min(x0, course.px[i]); x1 = Math.max(x1, course.px[i]); z0 = Math.min(z0, course.pz[i]); z1 = Math.max(z1, course.pz[i]) }
  const span = Math.max(x1 - x0, z1 - z0) * 1.12
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, k: 400 / span }
})()
const toMini = (x: number, z: number): [number, number] => [200 - (x - bounds.cx) * bounds.k, 200 - (z - bounds.cz) * bounds.k]
function drawMini(): void {
  const g = miniCtx
  g.clearRect(0, 0, 400, 400)
  g.fillStyle = 'rgba(10,6,4,0.35)'
  g.beginPath(); g.arc(200, 200, 198, 0, Math.PI * 2); g.fill()
  g.lineWidth = 7
  g.strokeStyle = 'rgba(255,255,255,0.55)'
  g.beginPath()
  for (let i = 0; i <= course.n; i += 4) { const [x, y] = toMini(course.px[i % course.n], course.pz[i % course.n]); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y) }
  g.closePath(); g.stroke()
  const me = race.racers[0]
  course.cps.forEach((c, k) => {
    const [x, y] = toMini(c.x, c.z)
    g.fillStyle = k === me.next ? '#5fe6ff' : k === 0 ? '#ff6a1a' : 'rgba(255,255,255,0.6)'
    g.beginPath(); g.arc(x, y, k === me.next ? 11 : 6, 0, Math.PI * 2); g.fill()
  })
  for (const r of race.racers) {
    if (!r.ai) continue
    const [x, y] = toMini(r.p.pos.x, r.p.pos.z)
    g.fillStyle = '#' + new THREE.Color(r.color).getHexString()
    g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill()
  }
  const [x, y] = toMini(player.pos.x, player.pos.z)
  g.save(); g.translate(x, y); g.rotate(-player.heading + Math.PI)
  g.fillStyle = '#ff6a1a'; g.strokeStyle = '#fff'; g.lineWidth = 3
  g.beginPath(); g.moveTo(0, -18); g.lineTo(11, 12); g.lineTo(-11, 12); g.closePath(); g.fill(); g.stroke()
  g.restore()
}

// ───────────────────────── keys ─────────────────────────
addEventListener('keydown', (e) => {
  sound.start()
  if (e.code === 'Backquote') debugEl.style.display = debugEl.style.display === 'block' ? 'none' : 'block'
  if (e.code === 'KeyG') void import('./gui').then((g) => g.toggleGui())
  if (e.code === 'Escape' && mode !== 'title') {
    if (overlay) { overlay = false; $('#over').classList.add('hide'); return }
    paused = !paused
    $('#pause').classList.toggle('hide', !paused)
    sound.suspend(paused)
    last = performance.now()
  }
  if (mode === 'title') {
    if (e.code === 'Enter' || e.code === 'Space') startRace()
    if (e.code === 'KeyH') startHunt()
    return
  }
  if (overlay) {
    if (e.code === 'KeyR') { if (mode === 'race') startRace(); else startHunt() }
    if (e.code === 'KeyH') startHunt()
    if (e.code === 'Enter') startRace()
    return
  }
  if (e.code === 'KeyR' && e.shiftKey) { if (mode === 'race') startRace(); else startHunt(); return }
  if (e.code === 'KeyR' && mode === 'race' && race.state === 'racing') {
    const me = race.racers[0]
    if (!me.finished) {
      race.respawn(me)
      const v = visuals.get(player)!
      v.lastDust.copy(player.pos)
      for (const t of v.trail) t.reset()
      cam.snap(player.heading)
    }
  }
})
addEventListener('mousedown', () => { sound.start(); if (mode === 'title') startRace() })
document.addEventListener('visibilitychange', () => { sound.suspend(document.hidden); last = performance.now() })
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); paused = true })
canvas.addEventListener('webglcontextrestored', () => { paused = false; last = performance.now() })

// ───────────────────────── boot ─────────────────────────
race.reset()
player.reset(0, -40, Math.atan2(course.cps[0].tx, course.cps[0].tz), 0)
renderPos.copy(player.pos)
camera.position.set(player.pos.x + 10, player.pos.y + 2, player.pos.z + 10)
camera.lookAt(player.pos)
world.update(camera.position, 0)
loadBar.style.width = '75%'
// Compile with every racer visible so no shader compiles mid-race.
for (const v of visuals.values()) v.craft.root.visible = true
combat.group.visible = true
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
  start: () => startRace(),
  startHunt: () => startHunt(),
  autopilot: (on: boolean) => { autopilot = on },
  setMach: (m: number) => { player.speed = m * MACH },
  skipCountdown: () => { race.countdown = 0.01 },
  /** Put the player just before jump k, at Mach m. */
  toJump: (k: number, m = 3) => {
    const f = [0.075, 0.17, 0.3, 0.41, 0.55, 0.64, 0.77, 0.88, 0.95][k] // on the line: k % 3 === 0
    const i = Math.round(f * course.n) - 25
    const [tx, tz] = course.tangent(i)
    player.reset(course.px[i], course.pz[i], Math.atan2(tx, tz), m)
    race.racers[0].idx = i
    cam.snap(player.heading)
  },
  spawnWalker: () => { walker.spawn(); warnT = 4 },
  walkerNear: (d = 2200) => { walker.spawn(d, 500); walker.state = 'fight' },
  killCores: () => { for (const c of walker.cores) { c.hp = 1; c.hit(1) } },
  boom: (x: number) => fx.explosion(player.pos.x + player.fwd.x * x, player.pos.y + 20, player.pos.z + player.fwd.z * x, player.vel.x, 0, player.vel.z, 1.5),
  debug: (on: boolean) => { debugEl.style.display = on ? 'block' : 'none' },
  stats: () => ({
    fps: Math.round(fps), ms: +lastMs.toFixed(1), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, mach: +player.mach.toFixed(2),
    tier, scale: renderScale, hull: Math.round(player.hull), air: player.airborne, agl: +player.agl.toFixed(1),
    place: race.racers[0].place, lap: race.lapOf(race.racers[0]), passed: race.racers[0].passed, race: race.state, particles: fx.glow.count + fx.smoke.count,
  }),
  player, race, course, combat, walker, CFG, world,
}
;(window as unknown as { __g: typeof g }).__g = g
