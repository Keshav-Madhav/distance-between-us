// The Distance Between Us — entry. Loop, modes (race / hunt), rendering of every racer, impacts,
// HUD, quality, test hooks.
import '@fontsource/chakra-petch/400.css'
import '@fontsource/chakra-petch/700.css'
import * as THREE from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { CFG, MACH, REBASE } from './config'
import { World } from './world'
import { Craft, MODELS, type Paint } from './craft'
import { Fx, resetE } from './particles'
import { Trail } from './trails'
import { Player } from './player'
import { Combat, type Target } from './combat'
import { Walker } from './walker'
import { Sound } from './audio'
import { Input } from './input'
import { Post } from './post'
import { BIOME, biomeOf, DUST, groundH, SUN_DIR } from './terrain'
/** Shadows are cast along the sun, but never stretched past a ~17° sun (a sun on the horizon threw them 100 m off). */
const SHADOW_Y = Math.max(SUN_DIR[1], 0.3)
import { loadTextures } from './textures'
import { centerline, Course, COURSES, LAPS } from './course'
import { Race, type Racer } from './race'
import { ChaseCam } from './camera'
import { Debris } from './debris'
import { Shock } from './shock'
/** '#rrggbb' for a colour, cached (built per frame before: garbage on every HUD tick). */
const hexOf = new Map<number, string>()
function hex(c: number): string { let h = hexOf.get(c); if (!h) { h = '#' + new THREE.Color(c).getHexString(); hexOf.set(c, h) } return h }

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

// The course: ?course=<id>, else the last one picked on the title screen. (Switching course rebuilds
// the world — mesas cleared along the line, terrain mounds — so it is a reload, not a hot swap.)
const courseDef = (() => {
  let id = params.get('course')
  try { id ??= localStorage.getItem('dbu-course') } catch { /* storage blocked */ }
  return COURSES.find((c) => c.id === id) ?? COURSES[0]
})()
const course = new Course(courseDef)
let pickedCourse = COURSES.indexOf(courseDef)
// Worlds first, then the courses in that world.
const WORLDS = [
  { id: 'desert', name: 'RED MESA', blurb: 'SANDSTONE' },
  { id: 'ice', name: 'POLAR SHELF', blurb: 'GLACIERS' },
] as const
let pickedWorld: 'desert' | 'ice' = biomeOf(courseDef.id)
const bestKey = (id: string) => `dbu-best-${id}`
const bestOf = (id: string): number | null => { try { const v = localStorage.getItem(bestKey(id)); return v ? +v : null } catch { return null } }
// Mesas clear of the course corridor — tested at every wrapped copy of each one that falls along the
// 140 km line (the world repeats every 72 km).
const clearAt = (x: number, z: number, r: number) => {
  const B = course.box, m = 3000
  for (let ix = Math.ceil((B.x0 - m - x) / REBASE); ix <= Math.floor((B.x1 + m - x) / REBASE); ix++)
    for (let iz = Math.ceil((B.z0 - m - z) / REBASE); iz <= Math.floor((B.z1 + m - z) / REBASE); iz++)
      if (course.distance(x + ix * REBASE, z + iz * REBASE) < (course.def.clearance ?? 850) + r) return false
  return true
}
const world = new World(clearAt, (x, z, r) => course.distance(x, z) < 460 + r)
world.addFixed(course.rocks)
// The polar world's set pieces: glaciers, seracs and spike fields placed close beside the line
// (150–400 m off its edge), so the race threads past the ice instead of seeing it on the horizon.
if (BIOME === 'ice') {
  let sd = (course.def.seed * 9301 + 49297) >>> 0
  const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296 }
  const tight = course.def.id === 'icefall'
  const laps = course.def.laps ?? 1
  const lapEnd = course.startI + Math.floor((course.finishI - course.startI) / laps)
  const heroes: Parameters<typeof world.addHeroes>[0] = []
  let i = course.startI + Math.round(1800 / 40)
  while (i < lapEnd - 40) {
    const roll = rnd()
    const kind: 'mesa' | 'butte' | 'spire' = tight ? (roll < 0.45 ? 'spire' : roll < 0.75 ? 'butte' : 'mesa') : (roll < 0.5 ? 'mesa' : roll < 0.8 ? 'spire' : 'butte')
    const v = Math.floor(rnd() * 3.999) % (kind === 'mesa' ? 4 : 3)
    let r: number, h: number, ext: number
    if (kind === 'mesa') { r = 220 + rnd() * 300; h = 130 + rnd() * 140; ext = 1.6 }
    else if (kind === 'butte') { r = 110 + rnd() * 110; h = 70 + rnd() * 80; ext = 1.4 }
    else { r = 40 + rnd() * 35; h = 260 + rnd() * 240; ext = 2.0 }
    const gap = 150 + rnd() * 250
    const side = rnd() < 0.5 ? -1 : 1
    const [tx, tz] = course.tangent(i)
    const lat = side * (gap + r * ext)
    const x = course.px[i] + tz * lat, z = course.pz[i] - tx * lat
    // Only where the nearest line is this one (a loop can bend back toward it).
    if (course.distance(x, z) > gap * 0.9 + r * ext * 0.95) heroes.push({ x, z, r, h, kind, v, yaw: rnd() * 6.28 })
    i += Math.round((tight ? 2200 + rnd() * 1300 : 3200 + rnd() * 1800) / 40)
  }
  world.addHeroes(heroes)
}
scene.add(world.group)
scene.add(course.group)
const env = world.makeEnv(renderer)
loadBar.style.width = '30%'
const tex = await loadTextures(renderer)
world.applyTextures(tex)
{
  const w = course.wearTexture()
  world.ground.tTrack.value = w.tex
  world.ground.uTrackBox.value.copy(w.box)
}
loadBar.style.width = '50%'
const fx = new Fx()
scene.add(fx.group)
const shock = new Shock()
scene.add(shock.group)
const wreckage = new Debris(env)
scene.add(wreckage.mesh)
wreckage.onSmoke = (x, y, z, vx, vz) => {
  if (Math.random() > 0.35) return
  const e = resetE()
  e.x = x; e.y = y; e.z = z; e.vx = vx * 0.3; e.vy = 4; e.vz = vz * 0.3
  e.life = 1.2; e.size0 = 1; e.size1 = 6; e.r = 0.07; e.g = 0.06; e.b = 0.055; e.a = 0.55; e.r1 = 3; e.g1 = 3; e.b1 = 3; e.drag = 2
  fx.smoke.emit(e)
}
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
/** Tools: scripted controls override the keyboard. */
let forced: import('./player').Controls | null = null
let wrongT = 0
let offT = 0
let fovMax = CFG.camera.fovMax
/** After the finish: autopilot + cinematic camera, until Esc hands control back. */
let spectate = false
/** Graphics settings (the Esc panel). */
const settings = { fps: 'auto' as 'auto' | '60' | '120' | 'max', map: true, scale: 1, dist: 20, part: 1, bloom: true, blur: 1, sharp: 0.4, grain: true, cloud: true }
let crashBreak = 0
const rivalVoices: import('./audio').RivalVoice[] = []
const camRight = new THREE.Vector3()
const passSide = new Map<object, number>()

const shake = (t: number) => { cam.trauma = Math.min(1, cam.trauma + t) }
const huntObs: import('./world').Obstacle[] = []

const race = new Race(course, player, {
  gate(r, lapDone, missed) {
    if (r.p !== player) return
    if (missed) { /* the speed cut and its effects: missedGate() */ }
    sound.gate(lapDone || r.passed === race.K - 1)
    if (r.passed > 1) pop(`GATE ${r.passed - 1}/${race.K - 2}  ·  P${r.place}  ·  ${fmtLap(race.clock + r.penalty)}`)
    if (r.passed === race.K - 1) flash('FINAL GATE')
  },
  finish(r) {
    if (r.p === player) {
      flash(`P${r.place} · FINISHED`)
      spectate = true
      sound.fanfare(r.place <= 3)
      slowmoT = 1.2
      sound.slowmo(1)
      setTimeout(showResults, 3200)
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
  missedGate(r) {
    if (r.p !== player) return
    warn('MISSED GATE', 'SPEED LOST')
    sound.missed()
    sound.crash(false)
    damageFlash = Math.max(damageFlash, 0.7)
    impactPulse = 1
    shake(0.6)
    cam.punch -= 8
    input.rumble(1, 0.6, 400)
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

let shipPick = (() => { try { return Math.min(MODELS.length - 1, Math.max(0, +(localStorage.getItem('dbu-ship') ?? 0) || 0)) } catch { return 0 } })()
// Your paint: a body colour and a team colour (trim, lights, number), picked on the menu, saved.
const BODY_COLORS = [0xeef1f4, 0x1b1d24, 0x16324a, 0x8a1c22, 0xd9c3a0, 0x1f3a2a, 0x2a1d44, 0xc9a227, 0x6b7380]
const TRIM_COLORS = [0xff5a14, 0xff3fa4, 0x29d3ff, 0x7dff3a, 0xffc21a, 0xa96bff, 0xff3b30, 0xf2f2f2, 0x3dffc5]
const myPaint: Paint = (() => {
  try { const v = JSON.parse(localStorage.getItem('dbu-paint') || 'null'); if (v && typeof v.body === 'number' && typeof v.trim === 'number') return { body: v.body, trim: v.trim, number: '07' } } catch { /* fresh */ }
  return { body: 0xeef1f4, trim: 0xff5a14, number: '07' }
})()
const PAINTS: Paint[] = [
  myPaint,
  { body: 0x1b1d24, trim: 0xff3fa4, number: '11' },
  { body: 0xf2f2ea, trim: 0x5fe02a, number: '23' },
  { body: 0x2a2018, trim: 0xffc21a, number: '04' },
  { body: 0x16324a, trim: 0x29d3ff, number: '88' },
  { body: 0xd8dde2, trim: 0xff3b30, number: '31' },
  { body: 0x1e1630, trim: 0xa96bff, number: '19' },
  { body: 0xe9e2d6, trim: 0xff8a3d, number: '52' },
  { body: 0x102a26, trim: 0x3dffc5, number: '66' },
  { body: 0x2b2d33, trim: 0xd8d8e8, number: '00' },
]
// A bigger field (the drag race): paint the rest from their colours, dark and light bodies in turn.
for (let i = PAINTS.length; i < race.racers.length; i++)
  PAINTS.push({ body: i % 2 ? 0x1c1e24 : 0xe6e8ec, trim: race.racers[i].color, number: String(40 + i * 3) })
interface Visual { craft: Craft; trail: Trail[]; vapour: Trail[]; lastDust: THREE.Vector3; heading: number; wasDead: boolean; wasHidden: boolean }
const visuals = new Map<Player, Visual>()
race.racers.forEach((r, i) => {
  // Your ship: the one picked on the title (saved); the field: a spread of all six.
  const craft = new Craft(env, PAINTS[i], i === 0 ? shipPick : (i * 7) % MODELS.length)
  scene.add(craft.root)
  const trail: Trail[] = []
  const nT = r.ai ? 1 : 3
  for (let k = 0; k < nT; k++) {
    // (Rivals' a touch longer and brighter: clearly told apart at a glance, not a laser show.)
    const t = new Trail(r.ai ? 64 : 56, r.ai ? new THREE.Color(r.color).multiplyScalar(1.9) : new THREE.Color(1.6, 0.5, 0.12), true, r.ai ? 1.8 : 0.9)
    t.width = r.ai ? 0.9 : 0.42
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

// ── wrecks: every racer's crash and every bounce of it ──
race.racers.forEach((r, i) => {
  const paint = PAINTS[i]
  const mine = r.p === player
  r.p.onCrashStart = (sev, destroyed, x, y, z, nx, nz) => {
    const dist = camera.position.distanceTo(r.p.pos)
    if (dist > 3000) return
    const v = r.p.vel
    sparks(x, y, z, v, Math.round(40 + sev * 60), 1.4)
    wreckage.burst(r.p.pos.x, r.p.pos.y, r.p.pos.z, v.x, v.y, v.z, Math.round(10 + sev * 10), 60 + sev * 50, paint.body, paint.trim)
    fx.dust(x, y - 2, z, nx * 50 + v.x * 0.3, nz * 50 + v.z * 0.3, Math.round(18 + sev * 20), 14 + sev * 10, 40)
    fx.explosion(x, y, z, v.x * 0.3, 10, v.z * 0.3, destroyed ? 2.4 : 1 + sev * 0.5)
    fx.explosion(x + nx * 6, y + 4, z + nz * 6, v.x * 0.5, 20, v.z * 0.5, 0.8)
    shock.ground(x, z, 0.7 + sev * 0.3, 1.2, true)
    shock.air(r.p.pos, r.p.fwd, r.p.vel, 0.8 + sev * 0.2, 1)
    sound.wreck(Math.min(1.5, sev), mine ? 0 : dist)
    if (!mine) return
    flash(destroyed ? 'DESTROYED' : 'WRECKED')
    hitstop = 0.09
    slowmoT = 1.1
    sound.slowmo(1)
    shake(1)
    damageFlash = 1
    impactPulse = 1
    input.rumble(1, 1, 700)
  }
  r.p.onBounce = (impact) => {
    const dist = camera.position.distanceTo(r.p.pos)
    if (dist > 2500 || impact < 8) return
    const g = groundH(r.p.pos.x, r.p.pos.z)
    fx.dust(r.p.pos.x, g, r.p.pos.z, r.p.vel.x * 0.3, r.p.vel.z * 0.3, Math.round(6 + impact / 4), 8 + impact * 0.2, 20 + impact * 0.3)
    sparks(r.p.pos.x, g + 0.5, r.p.pos.z, r.p.vel, Math.round(impact / 2), 0.8)
    if (impact > 25) wreckage.burst(r.p.pos.x, g + 1, r.p.pos.z, r.p.vel.x, 5, r.p.vel.z, 3, 35, paint.body, paint.trim)
    // Each hard bounce: a fresh burst of fire and a ring in the sand.
    if (impact > 18) { fx.explosion(r.p.pos.x, g + 2, r.p.pos.z, r.p.vel.x * 0.4, 6, r.p.vel.z * 0.4, 0.35 + impact / 120); shock.ground(r.p.pos.x, r.p.pos.z, 0.25 + impact / 200, 0.7, true) }
    sound.bounce(Math.min(1, impact / 60), mine ? 0 : dist)
    if (mine) { shake(Math.min(0.6, impact / 80)); input.rumble(0.8, 0.6, 140) }
  }
})
const rivalCols = new Map(race.racers.map((r) => [r.p, new THREE.Color(r.color)]))
const rivalColor = (p: Player) => rivalCols.get(p)!
// Name tags over the rivals.
const enemyEls = Array.from({ length: 14 }, () => {
  const d = document.createElement('div')
  d.className = 'etag'
  d.innerHTML = '<span></span><i></i>'
  $('#tags').appendChild(d)
  return d
})
const tagEls = race.racers.filter((r) => r.ai).map((r) => {
  const d = document.createElement('div')
  d.className = 'tag'
  d.style.setProperty('--c', hex(r.color))
  d.innerHTML = `<span>${r.name}</span><i></i>`
  $('#tags').appendChild(d)
  return { r, d }
})

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
  waveStart(w) {
    flash(`WAVE ${w}`)
    sound.beep(true)
    // After three waves, the walker; the waves wait until it is down.
    if (w === 4 && !walkerDone) {
      combat.paused = true
      walker.spawn()
      warn('WALKER', 'ON THE HORIZON · HIT ITS FOUR CORES')
      warnT = 4
    }
  },
  waveCleared(w) { flash(`WAVE ${w} CLEARED`); score += 250 * w; pop(`+${250 * w}  WAVE BONUS`) },
  runner() { warn('RUNNER', 'CHASE IT DOWN · WORTH TRIPLE'); warnT = 2 },
  escaped() { pop('RUNNER ESCAPED') },
  avoid(x, z, dx, dz, v) {
    const look = Math.max(500, v * 1.2)
    const n = world.near(x + dx * look * 0.5, z + dz * look * 0.5, 30, look * 0.6, huntObs)
    let steer = 0
    for (let i = 0; i < n; i++) {
      const o = huntObs[i]
      const ox = o.x - x, oz = o.z - z
      const ahead = ox * dx + oz * dz
      const side = ox * -dz + oz * dx // + = to the left
      if (ahead > 0 && ahead < look && Math.abs(side) < o.cr + 120) steer += side > 0 ? -1 : 1
    }
    return Math.max(-1, Math.min(1, steer))
  },
})
scene.add(combat.group)
const walker = new Walker(player, fx, sound, combat, shake)
scene.add(walker.root, walker.ring)
walker.onCoreLost = (left) => { score += 500; pop(left > 0 ? `+500  CORE · ${left} LEFT` : '+500  LAST CORE'); flash(left > 0 ? `${left} CORES LEFT` : "IT'S GOING DOWN") }
walker.onFall = () => { slowmoT = 2.6; sound.slowmo(1) }
walker.onDown = () => { walkerDone = true; score += 5000; pop('+5000  WALKER DOWN'); flash('WALKER DOWN'); combat.pressure = 4; combat.paused = false }

// ───────────────────────── player feedback ─────────────────────────
player.onMach = (m) => {
  flash(`MACH ${m}`)
  coneA = m === 1 ? 1.2 : 0.7
  shock.air(player.pos, player.fwd, player.vel, m === 1 ? 1.3 : 0.8 + m * 0.1, m === 1 ? 1.4 : 0.9)
  if (m === 1) {
    // Breaking the sound barrier off the line: the boom, a ring on the sand, the punch.
    sound.barrier('boom')
    shock.ground(player.pos.x, player.pos.z, 1.1, 1)
    fx.dust(player.pos.x, groundH(player.pos.x, player.pos.z), player.pos.z, player.vel.x * 0.3, player.vel.z * 0.3, 24, 18, 40)
    shake(0.55)
    cam.punch += 6
    impactPulse = Math.max(impactPulse, 0.6)
    input.rumble(0.8, 0.8, 300)
  } else {
    sound.machCrack(m)
    shake(0.12 + m * 0.025)
    cam.punch += 1.5
  }
}
player.onBarrier = (ph) => {
  if (ph === 'none') return
  sound.barrier(ph)
  if (ph === 'boom') {
    flash('MACH 6')
    shock.air(player.pos, player.fwd, player.vel, 1.8, 1.5)
    shock.ground(player.pos.x, player.pos.z, 1.4, 0.9)
    shake(0.6)
    coneA = 0.8
    cam.punch += 4
    input.rumble(1, 1, 500)
    fx.dust(player.pos.x, groundH(player.pos.x, player.pos.z), player.pos.z, player.vel.x * 0.4, player.vel.z * 0.4, 30, 22, 50)
  }
}
player.onBoostStart = () => { shock.air(player.pos, player.fwd, player.vel, 0.7, 1.1); sound.boostKick(); shake(0.15); cam.punch += 2; input.rumble(0.6, 0.3, 160) }
player.onLaunch = (vy) => { sound.launch(Math.min(1, vy / 70)); cam.punch += 2 }
player.onLand = (impact, air) => {
  landDust(player, impact)
  if (impact > 40) shock.ground(player.pos.x, player.pos.z, 0.4 + impact / 150, 0.6)
  sound.land(impact)
  shake(Math.min(0.7, impact / 110))
  cam.impulse(0, -1, 0, Math.min(1.5, impact / 50))
  input.rumble(Math.min(1, impact / 80), 0.5, 180)
  if (air > 1.2) pop(`AIR ${air.toFixed(1)} S`)
}
player.onSpin = (flip) => {
  flash(flip ? 'FLIPPED' : 'SPUN OUT')
  // The moment it goes: a beat of slow motion (longer for a flip) so you see it happen.
  slowmoT = Math.max(slowmoT, flip ? 0.9 : 0.55)
  hitstop = Math.max(hitstop, 0.05)
  sound.spinOut(flip)
  sound.crash(flip)
  shake(flip ? 0.9 : 0.45)
  cam.punch -= flip ? 6 : 2
  impactPulse = Math.max(impactPulse, flip ? 1 : 0.4)
  if (flip) { damageFlash = Math.max(damageFlash, 0.6); hitstop = Math.max(hitstop, 0.06) }
  input.rumble(1, 0.8, flip ? 600 : 300)
  fx.dust(player.pos.x, groundH(player.pos.x, player.pos.z), player.pos.z, player.vel.x * 0.3, player.vel.z * 0.3, flip ? 30 : 16, 14, 30)
  if (player.hull <= 0) die()
}
player.onDriftBoost = (lvl) => {
  sound.driftRelease(lvl)
  sound.pad()
  cam.punch += lvl === 2 ? 7 : 4
  shake(0.2 + lvl * 0.1)
  input.rumble(0.5, 0.9, 200)
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
    e.r = DUST[0]; e.g = DUST[1]; e.b = DUST[2]; e.a = 0.45; e.drag = 2.2; e.grav = 4
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
const kmsEl = $('#mach .kms')
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
const standRows: Racer[] = []
const standEls = Array.from({ length: 10 }, () => {
  const el = document.createElement('div'), name = document.createElement('span'), gap = document.createElement('span')
  gap.className = 'g'; el.append(name, gap); standEl.append(el)
  return { el, name, gap, who: null as Racer | null }
})
const countEl = $('#count')
const mini = $<HTMLCanvasElement>('#mini')
const reticle = $('#reticle')
let flashT = 0
let warnT = 0
let countT = 0

// ───────────────────────── the menu ─────────────────────────
// Mouse first (keys too): RACE / HUNT tabs, a course card per course with the whole layout drawn
// beside it, the ship picker (the ship on screen changes as you pick), START, SETTINGS.
let menuMode: 'race' | 'hunt' = 'race'
const SHIP_DESC = ['CLASSIC · BALANCED LINES', 'CLASSIC · HEAVY, SIDE PODS', 'CLASSIC · NEEDLE NOSE, CANARDS', 'LOFTED · TWIN-FIN ARROW', 'LOFTED · WIDE AND HEAVY', 'LOFTED · LONG, ONE TALL FIN']
function showCourse(): void {
  const title = $('#title')
  title.classList.toggle('hunt', menuMode === 'hunt')
  for (const b of title.querySelectorAll<HTMLButtonElement>('.tabs button')) b.classList.toggle('on', b.dataset.mode === menuMode)
  const worlds = $('#worlds')
  if (!worlds.childElementCount) for (const w of WORLDS) {
    const el = document.createElement('div')
    el.className = 'w'
    el.dataset.w = w.id
    el.onclick = () => {
      if (pickedWorld === w.id) return
      pickedWorld = w.id
      // Back to the course last raced in that world, else its first.
      let last: string | null = null
      try { last = localStorage.getItem('dbu-course-' + w.id) } catch { /* blocked */ }
      const i = COURSES.findIndex((c) => c.id === last && biomeOf(c.id) === w.id)
      pickedCourse = i >= 0 ? i : COURSES.findIndex((c) => biomeOf(c.id) === w.id)
      // A world is built at page load (its sky, ground and ice compile in): reload into it, so the
      // menu behind you is the world you picked.
      try { localStorage.setItem('dbu-course', COURSES[pickedCourse].id) } catch { /* blocked */ }
      const u = new URL(location.href); u.searchParams.delete('course'); location.href = u.toString()
      return
    }
    const n = COURSES.filter((c) => biomeOf(c.id) === w.id).length
    el.innerHTML = `<b>${w.name}</b><small>${w.blurb} · ${n} ${n === 1 ? 'COURSE' : 'COURSES'}</small>`
    worlds.append(el)
  }
  for (const el of worlds.children) (el as HTMLElement).classList.toggle('on', (el as HTMLElement).dataset.w === pickedWorld)
  const cards = $('#courses')
  if (!cards.childElementCount) COURSES.forEach((_d, i) => {
    const el = document.createElement('div')
    el.className = 'c'
    el.onclick = () => { pickedCourse = i; showCourse() }
    cards.append(el)
  })
  COURSES.forEach((d, i) => {
    const el = cards.children[i] as HTMLElement, b = bestOf(d.id)
    el.classList.toggle('on', i === pickedCourse)
    el.style.display = biomeOf(d.id) === pickedWorld ? '' : 'none'
    el.innerHTML = `<b>${d.name}</b><span class="best">${b !== null ? fmtLap(b) : d.km + ' KM'}</span><small>${d.blurb}</small>`
  })
  // Paint swatches (built once; the picked ones ringed).
  for (const [id, list, key] of [['#sw-body', BODY_COLORS, 'body'], ['#sw-trim', TRIM_COLORS, 'trim']] as const) {
    const box = $(id)
    if (!box.childElementCount) for (const c of list) {
      const el = document.createElement('i')
      el.style.background = hex(c)
      el.title = hex(c)
      el.onclick = () => {
        myPaint[key] = c
        myCraft.setPaint(myPaint)
        try { localStorage.setItem('dbu-paint', JSON.stringify({ body: myPaint.body, trim: myPaint.trim })) } catch { /* blocked */ }
        showCourse()
      }
      box.append(el)
    }
    list.forEach((c, i) => (box.children[i] as HTMLElement).classList.toggle('on', c === myPaint[key]))
  }
  $('#ship-name').textContent = MODELS[shipPick]
  $('#ship-desc').textContent = SHIP_DESC[shipPick] + ' · LOOKS ONLY'
  drawTrackPreview(COURSES[pickedCourse])
}
/** The whole course, start at the bottom, finish at the top; across exaggerated so bends read. */
/** The menu's course map: drawn once per course into an offscreen layer (true scale on a gridded
 *  sand ground, the line coloured by how hard it turns, gates, jumps, arrows, km marks, a scale
 *  bar); a dot laps it live on top (animTrackPreview). */
const trackBg = document.createElement('canvas')
let trackPath: { x: number[]; y: number[]; arc: number[]; L: number; u: number; loop: boolean } | null = null
function drawTrackPreview(d: (typeof COURSES)[number]): void {
  const cv = $<HTMLCanvasElement>('#track')
  const dpr = Math.min(2, devicePixelRatio)
  cv.width = Math.max(100, Math.round(cv.clientWidth * dpr)); cv.height = Math.max(100, Math.round(cv.clientHeight * dpr))
  trackBg.width = cv.width; trackBg.height = cv.height
  const g = trackBg.getContext('2d')!
  const W = cv.width, H = cv.height, M = 26 * dpr, u = dpr
  // The line, and the distance along it.
  const { xs, zs } = centerline(d)
  const N = xs.length, arc = [0]
  for (let i = 1; i < N; i++) arc.push(arc[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]))
  const L = arc[N - 1]
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let i = 0; i < N; i++) { x0 = Math.min(x0, xs[i]); x1 = Math.max(x1, xs[i]); z0 = Math.min(z0, zs[i]); z1 = Math.max(z1, zs[i]) }
  const k = Math.min((W - 2 * M) / Math.max(1, x1 - x0), (H - 2 * M) / Math.max(1, z1 - z0))
  const PX = (x: number) => W / 2 + (x - (x0 + x1) / 2) * k, PY = (z: number) => H / 2 - (z - (z0 + z1) / 2) * k
  // Ground: warm sand, a 1 km grid (10 km lines stronger).
  const bg = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7)
  // (FROSTLINE's map: snow-blue ground, not the desert's sand.)
  if (biomeOf(d.id) === 'ice') { bg.addColorStop(0, '#3a4a62'); bg.addColorStop(1, '#141c2a') } else { bg.addColorStop(0, '#5a3a24'); bg.addColorStop(1, '#2a1a10') }
  g.fillStyle = bg; g.fillRect(0, 0, W, H)
  const gx0 = Math.floor(((x0 + x1) / 2 - W / 2 / k) / 1000) * 1000, gz0 = Math.floor(((z0 + z1) / 2 - H / 2 / k) / 1000) * 1000
  for (let gx = gx0; PX(gx) < W; gx += 1000) { const major = Math.round(gx / 1000) % 10 === 0; if (!major && k * 1000 < 6 * u) continue; g.strokeStyle = major ? 'rgba(255,220,180,0.14)' : 'rgba(255,220,180,0.05)'; g.lineWidth = u; g.beginPath(); g.moveTo(PX(gx), 0); g.lineTo(PX(gx), H); g.stroke() }
  for (let gz = gz0; PY(gz) > 0; gz += 1000) { const major = Math.round(gz / 1000) % 10 === 0; if (!major && k * 1000 < 6 * u) continue; g.strokeStyle = major ? 'rgba(255,220,180,0.14)' : 'rgba(255,220,180,0.05)'; g.lineWidth = u; g.beginPath(); g.moveTo(0, PY(gz)); g.lineTo(W, PY(gz)); g.stroke() }
  // Curvature at each point (three-point), for the colouring and the stats.
  const kap = new Float64Array(N)
  for (let i = 1; i < N - 1; i++) {
    const ax = xs[i] - xs[i - 1], az = zs[i] - zs[i - 1], bx = xs[i + 1] - xs[i], bz = zs[i + 1] - zs[i], cx = xs[i + 1] - xs[i - 1], cz = zs[i + 1] - zs[i - 1]
    kap[i] = (2 * Math.abs(ax * bz - az * bx)) / Math.max(1e-6, Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(cx, cz))
  }
  // Spire stretches (open courses): a dim band.
  if (!d.loop) {
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 22 * u; g.lineCap = 'butt'
    for (let i = 1; i < N; i++) if (zs[i] > 4000 && d.spireGap(zs[i] / 1000)) { g.beginPath(); g.moveTo(PX(xs[i - 1]), PY(zs[i - 1])); g.lineTo(PX(xs[i]), PY(zs[i])); g.stroke() }
  }
  // The line: a dark under-stroke, a glow, then coloured by turn (white straight → amber → red).
  g.lineJoin = 'round'; g.lineCap = 'round'
  const path = () => { g.beginPath(); for (let i = 0; i < N; i++) { if (i) g.lineTo(PX(xs[i]), PY(zs[i])); else g.moveTo(PX(xs[i]), PY(zs[i])) } }
  path(); g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 8 * u; g.stroke()
  path(); g.strokeStyle = 'rgba(255,190,120,0.18)'; g.lineWidth = 14 * u; g.stroke()
  g.lineWidth = 4 * u
  for (let i = 1; i < N; i++) {
    const r = 1 / Math.max(1e-7, Math.max(kap[i], kap[i - 1]))
    g.strokeStyle = r < 1250 ? '#ff3b30' : r < 2500 ? '#ff8a3d' : r < 6000 ? '#ffd29a' : '#fff4ea'
    g.beginPath(); g.moveTo(PX(xs[i - 1]), PY(zs[i - 1])); g.lineTo(PX(xs[i]), PY(zs[i])); g.stroke()
  }
  const at = (s: number): [number, number, number] => {
    let i = 1
    while (i < N - 1 && arc[i] < s) i++
    const t = Math.min(1, Math.max(0, (s - arc[i - 1]) / Math.max(1e-6, arc[i] - arc[i - 1])))
    const x = xs[i - 1] + (xs[i] - xs[i - 1]) * t, z = zs[i - 1] + (zs[i] - zs[i - 1]) * t
    return [PX(x), PY(z), Math.atan2(-(zs[i] - zs[i - 1]), xs[i] - xs[i - 1])]
  }
  // Direction arrows along the way.
  g.fillStyle = 'rgba(255,255,255,0.75)'
  for (let s = L * 0.08; s < L * 0.95; s += L / (d.loop ? 9 : 6)) {
    const [px, py, an] = at(s)
    g.beginPath(); g.moveTo(px + Math.cos(an) * 7 * u, py + Math.sin(an) * 7 * u); g.lineTo(px + Math.cos(an + 2.4) * 6 * u, py + Math.sin(an + 2.4) * 6 * u); g.lineTo(px + Math.cos(an - 2.4) * 6 * u, py + Math.sin(an - 2.4) * 6 * u); g.fill()
  }
  // Gates: cyan dots ringed; jumps: orange triangles.
  for (let s = d.gateEvery; s < L - 100; s += d.gateEvery) { const [px, py] = at(s); g.fillStyle = '#5fe6ff'; g.beginPath(); g.arc(px, py, 3.6 * u, 0, Math.PI * 2); g.fill(); g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.2 * u; g.stroke() }
  g.fillStyle = '#ff8a3d'
  for (const f of d.jumps) { const [px, py] = at(f * L); g.beginPath(); g.moveTo(px + 8 * u, py); g.lineTo(px + 17 * u, py - 5 * u); g.lineTo(px + 17 * u, py + 5 * u); g.fill() }
  // Km marks beside the line.
  g.font = `600 ${Math.round(9 * dpr)}px "Chakra Petch", system-ui, sans-serif`; g.textBaseline = 'middle'; g.fillStyle = 'rgba(255,240,225,0.55)'
  const step = L > 150000 ? 50000 : L > 60000 ? 20000 : 10000
  for (let s = step; s < L - step * 0.4; s += step) { const [px, py] = at(s); g.fillText(`${Math.round(s / 1000)}`, px + 9 * u, py - 8 * u) }
  // Section names (open courses).
  g.font = `600 ${Math.round(10 * dpr)}px "Chakra Petch", system-ui, sans-serif`; g.fillStyle = 'rgba(255,255,255,0.85)'
  if (d.xAt) for (const [zk, name] of d.sections) g.fillText(name, Math.min(W - 100 * dpr, PX(d.xAt(zk * 1000)) + 22 * dpr), PY(zk * 1000))
  // Start (green bar + flag) and finish (chequered).
  const fx = PX(xs[N - 1]), fy = PY(zs[N - 1])
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#111' : '#fff'; g.fillRect(fx - 16 * u + i * 4 * u, fy - 8 * u, 4 * u, 3 * u); g.fillStyle = i % 2 ? '#fff' : '#111'; g.fillRect(fx - 16 * u + i * 4 * u, fy - 5 * u, 4 * u, 3 * u) }
  g.fillStyle = '#7dff3a'; g.fillRect(PX(xs[0]) - 16 * u, PY(zs[0]) + 2 * u, 32 * u, 4 * u)
  // Scale bar.
  const sb = [1000, 2000, 5000, 10000, 20000, 50000].find((m) => m * k > 60 * u) ?? 50000
  // (Top-left: at the bottom it ran into the start line.)
  const sy0 = M * 0.6
  g.fillStyle = 'rgba(255,240,225,0.8)'; g.fillRect(M * 0.5, sy0, sb * k, 2 * u)
  g.fillRect(M * 0.5, sy0 - 4 * u, 1.5 * u, 6 * u); g.fillRect(M * 0.5 + sb * k - 1.5 * u, sy0 - 4 * u, 1.5 * u, 6 * u)
  g.fillText(`${sb / 1000} KM`, M * 0.5 + sb * k + 6 * u, sy0)
  // For the live dot.
  trackPath = { x: xs.map(PX), y: zs.map(PY), arc, L, u, loop: !!d.loop }
  // Header and stats.
  $('#tp-name').textContent = d.name
  $('#tp-blurb').textContent = d.blurb
  let turning = 0, rmin = Infinity
  for (let i = 1; i < N - 1; i++) { const r = 1 / Math.max(1e-7, kap[i]); if (r < 6000) turning += arc[i + 1] - arc[i]; rmin = Math.min(rmin, r) }
  const spires = d.loop ? 0 : (() => { let n = 0; for (let i = 1; i < N; i++) if (zs[i] > 4000) { const gp = d.spireGap(zs[i] / 1000); if (gp) n += (arc[i] - arc[i - 1]) / ((gp[0] + gp[1]) / 2) } return Math.round(n) })()
  const cell = (v: string, l: string) => `<div><b>${v}</b><small>${l}</small></div>`
  $('#tp-stats').innerHTML = cell(`${d.km} KM`, d.loop ? ((d.laps ?? 1) > 1 ? `LOOP · ${d.laps} LAPS` : 'LOOP') : 'SPRINT') + cell(String(Math.round(d.km * 1000 / d.gateEvery) + 1), 'GATES') + cell(String(d.racers ?? 10), 'RACERS') +
    cell(`${Math.round((turning / L) * 100)}%`, 'TURNING') + cell(rmin > 20000 ? '—' : `${(rmin / 1000).toFixed(1)} KM`, 'TIGHTEST') + cell(d.jumps.length ? String(d.jumps.length) : spires ? `~${spires}` : '0', d.jumps.length ? 'JUMPS' : 'SPIRES')
  const best = bestOf(d.id)
  $('#tp-info').innerHTML = `${best !== null ? 'YOUR BEST ' + fmtLap(best) : 'NO TIME SET YET'}${d === course.def ? '' : ' · LOADS ON START'}<br/><span style="color:#fff4ea">━</span> STRAIGHT <span style="color:#ffd29a">━</span> SWEEPER <span style="color:#ff8a3d">━</span> BEND <span style="color:#ff3b30">━</span> HAIRPIN <span style="color:#5fe6ff">●</span> GATE`
  animTrackPreview(performance.now())
}
/** The live layer: a dot lapping the course with a fading tail. */
function animTrackPreview(now: number): void {
  if (!trackPath) return
  const cv = $<HTMLCanvasElement>('#track'), g = cv.getContext('2d')!
  g.drawImage(trackBg, 0, 0)
  const { x, y, arc, L, u } = trackPath
  const at = (s: number): [number, number] => {
    let lo = 0, hi = arc.length - 1
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arc[m] < s) lo = m; else hi = m }
    const t = Math.min(1, Math.max(0, (s - arc[lo]) / Math.max(1e-6, arc[hi] - arc[lo])))
    return [x[lo] + (x[hi] - x[lo]) * t, y[lo] + (y[hi] - y[lo]) * t]
  }
  const period = 9000, s = ((now % period) / period) * L
  for (let j = 14; j >= 0; j--) {
    const sj = s - j * L * 0.004
    if (sj < 0) continue
    const [px, py] = at(sj)
    g.fillStyle = `rgba(255,${120 + j * 6},40,${(1 - j / 15) * 0.8})`
    g.beginPath(); g.arc(px, py, (5 - j * 0.25) * u, 0, Math.PI * 2); g.fill()
  }
  const [px, py] = at(s)
  g.fillStyle = '#fff'; g.beginPath(); g.arc(px, py, 3 * u, 0, Math.PI * 2); g.fill()
}
function pickShip(delta: number): void {
  shipPick = (shipPick + delta + MODELS.length) % MODELS.length
  myCraft.setModel(shipPick)
  try { localStorage.setItem('dbu-ship', String(shipPick)) } catch { /* blocked */ }
  showCourse()
}
function menuStart(): void {
  if (menuMode === 'hunt') { startHunt(); return }
  try { localStorage.setItem('dbu-course-' + biomeOf(COURSES[pickedCourse].id), COURSES[pickedCourse].id) } catch { /* blocked */ }
  if (COURSES[pickedCourse] !== course.def) {
    try { localStorage.setItem('dbu-course', COURSES[pickedCourse].id); sessionStorage.setItem('dbu-go', '1') } catch { /* blocked */ }
    const u = new URL(location.href); u.searchParams.delete('course'); location.href = u.toString()
    return
  }
  startRace()
}
function setPaused(on: boolean): void {
  paused = on
  $('#pause').classList.toggle('hide', !on)
  $('#pause').classList.remove('from-title')
  sound.suspend(on)
  last = performance.now()
}
/** Back to the menu: everything off, the ship idling on the grid. */
function toTitle(): void {
  setPaused(false)
  overlay = false
  spectate = false
  $('#over').classList.add('hide')
  mode = 'title'
  combat.enabled = false
  combat.reset()
  walker.hide()
  race.reset()
  player.reset(course.cps[0].x - course.cps[0].tx * 60, course.cps[0].z - course.cps[0].tz * 60, Math.atan2(course.cps[0].tx, course.cps[0].tz), 0)
  renderPos.copy(player.pos)
  player.speed = 4 * MACH
  resetVisuals()
  hud.classList.remove('on'); raceEl.classList.remove('on'); standEl.classList.remove('on'); mini.classList.remove('on')
  scoreEl.style.display = 'none'
  reticle.style.display = 'none'
  sound.setSection('title')
  $('#title').classList.remove('hide')
  document.body.classList.remove('playing', 'racing')
  showCourse()
}
for (const b of $('#title').querySelectorAll<HTMLButtonElement>('.tabs button')) b.onclick = () => { menuMode = b.dataset.mode as 'race' | 'hunt'; showCourse() }
$('#ship-prev').onclick = () => pickShip(-1)
$('#ship-next').onclick = () => pickShip(1)
$('#start').onclick = () => { sound.start(); menuStart() }
$('#open-settings').onclick = () => { $('#pause').classList.remove('hide'); $('#pause').classList.add('from-title') }
$('#p-close').onclick = () => { $('#pause').classList.add('hide'); $('#pause').classList.remove('from-title') }
$('#p-resume').onclick = () => setPaused(false)
$('#p-restart').onclick = () => { setPaused(false); if (mode === 'hunt') startHunt(); else startRace() }
$('#p-menu').onclick = () => toTitle()
$('#pausebtn').onclick = () => { if (mode !== 'title' && !overlay) setPaused(!paused) }
$('#b-again').onclick = () => { if (mode === 'hunt') startHunt(); else startRace() }
$('#b-next').onclick = () => { pickedCourse = (COURSES.indexOf(course.def) + 1) % COURSES.length; menuMode = 'race'; menuStart() }
$('#b-menu').onclick = () => toTitle()
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
// (Milliseconds: a drag-race finish is decided by hundredths.)
const fmtLap = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`
const ord = (n: number) => `${n}${n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH'}`

function showResults(): void {
  if (mode !== 'race') return
  overlay = true
  // Best time per course.
  const me0 = race.racers[0]
  let newBest = false
  if (me0.finished) {
    const b = bestOf(course.def.id)
    if (b === null || me0.finishTime < b) { newBest = true; try { localStorage.setItem(bestKey(course.def.id), String(me0.finishTime)) } catch { /* blocked */ } }
  }
  const rows = [...race.racers].sort((a, b) => a.place - b.place)
  $('#over-h').textContent = `${ord(race.racers[0].place)} PLACE`
  $('#over-stats').innerHTML = `${course.def.name} · ${course.def.km} KM IN ${fmtLap(race.racers[0].finishTime)}${newBest ? ' · <b style="color:#ffb070">NEW BEST</b>' : ''} · TOP SPEED MACH ${Math.max(runTop, player.topMach).toFixed(2)}`
  $('#res').innerHTML = rows.map((r) => `<tr class="${r.ai ? '' : 'me'}"><td>${r.place}</td><td>${r.name}</td><td>${r.finished ? fmtLap(r.finishTime) : (race.toGo(r) / 1000).toFixed(1) + ' KM TO GO'}</td></tr>`).join('')
  $('#over .go').textContent = 'R TO RACE AGAIN · H FOR HUNT · ESC TO KEEP FLYING'
  $('#over').classList.remove('hide')
}
function showHuntOver(): void {
  if (mode !== 'hunt') return
  overlay = true
  $('#over-h').textContent = walkerDone && !player.dead ? 'WALKER DOWN' : 'SIGNAL LOST'
  $('#over-stats').innerHTML = `SCORE ${score}<br/>TOP SPEED MACH ${Math.max(runTop, player.topMach).toFixed(2)}<br/>DRONES DOWN ${combat.kills}<br/>TIME ${fmtTime(runTime)}`
  $('#res').innerHTML = ''
  $('#over .go').textContent = 'R TO RUN IT AGAIN · ENTER FOR A RACE'
  $('#over').classList.remove('hide')
}

function resetVisuals(): void {
  fx.clear()
  for (const v of visuals.values()) { for (const t of [...v.trail, ...v.vapour]) t.reset(); v.craft.root.visible = true }
}

// Top speed over the whole run (player.topMach resets with each respawn after a crash).
let runTop = 0
let driftLvl = 0
let secK = 0, pinUntil = 0
function startRace(): void {
  applyPending()
  runTop = 0; secK = 0; pinUntil = 0
  player.noCollide = false
  player.announce = true
  spectate = false
  wreckage.clear()
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
  document.body.classList.add('playing', 'racing')
  hud.classList.add('on')
  raceEl.classList.add('on')
  standEl.classList.add('on')
  mini.classList.add('on')
  scoreEl.style.display = 'none'
  reticle.style.display = 'none'
  hintsEl.style.opacity = '0.85'
  setTimeout(() => (hintsEl.style.opacity = '0'), 9000)
}

function startHunt(): void {
  applyPending()
  runTop = 0
  player.noCollide = false
  player.announce = true
  player.maxMach = CFG.speed.boostMach
  spectate = false
  wreckage.clear()
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
  document.body.classList.add('playing'); document.body.classList.remove('racing')
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
  high: { pr: 1.6, samples: 2, bloom: true, density: 1 },
  // (MSAA 4 at native Retina was the single biggest GPU cost: 12.4 → 8.4 ms without it.)
  ultra: { pr: 2, samples: 2, bloom: true, density: 1 },
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
addEventListener('resize', () => { if (mode === 'title') drawTrackPreview(COURSES[pickedCourse]) })
applyTier()

// (Declared up here: applyGraphics() resets it during boot, before the frame-pacing code below.)
let autoCap = 0
let govAcc = 0, govN = 0, govBad = 0, govGood = 0, govLast = 0
let pendingScale = -1, pendingTier: Tier | null = null, partCut = 1
/**
 * Dynamic resolution, with hysteresis — but never applied mid-race: a resize reallocates every render
 * target (a 194 ms stall, then a 200 ms frame, measured). It decides while you drive and applies on
 * the menu or at the next start; mid-race it only trims particles (free). The choice is remembered.
 */
function governor(frameMs: number): void {
  if (tierName !== 'auto' || params.has('fixed') || settings.scale < 1) return
  govAcc += frameMs; govN++
  if (govAcc < 500) return
  const avg = govAcc / govN
  govAcc = 0; govN = 0
  govBad = avg > 19 ? govBad + 1 : 0
  govGood = avg < 13 ? govGood + 1 : 0
  const now = performance.now()
  if (now - govLast < 3000) return
  let scale = pendingScale >= 0 ? pendingScale : renderScale
  if (govBad >= 3) scale = Math.max(0.6, scale - 0.1)
  else if (govGood >= 8 && scale < 1) scale = Math.min(1, scale + 0.08)
  if (scale !== (pendingScale >= 0 ? pendingScale : renderScale)) { pendingScale = scale; govLast = now; govBad = govGood = 0 }
  if (avg > 26 && scale <= 0.6 && tier !== 'low') { pendingTier = tier === 'ultra' ? 'high' : tier === 'high' ? 'medium' : 'low'; govLast = now }
  // Mid-race relief that costs nothing to switch: fewer particles.
  if (avg > 22) { partCut = Math.max(0.35, partCut * 0.8); fx.smoke.density = Math.min(TIERS[tier].density, settings.part) * partCut; fx.glow.density = settings.part * partCut }
  if (mode === 'title') applyPending()
}
/** Apply what the governor decided (between races only). */
function applyPending(): void {
  partCut = 1
  fx.smoke.density = Math.min(TIERS[tier].density, settings.part); fx.glow.density = settings.part
  let changed = false
  if (pendingTier && pendingTier !== tier) { tier = pendingTier; renderScale = 0.8; applyTier(); changed = true }
  else if (pendingScale >= 0 && Math.abs(pendingScale - renderScale) > 0.001) { renderScale = pendingScale; resize(); changed = true }
  pendingScale = -1; pendingTier = null
  if (changed) try { localStorage.setItem('dbu-auto', JSON.stringify({ tier, renderScale })) } catch { /* blocked */ }
}
// AUTO starts where it settled last time (a slower machine should not re-learn every session).
if (tierName === 'auto' && !params.has('fixed')) try {
  const v = JSON.parse(localStorage.getItem('dbu-auto') || 'null')
  if (v && TIERS[v.tier as Tier]) { tier = v.tier; renderScale = Math.min(1, Math.max(0.6, +v.renderScale || 1)); applyTier() }
} catch { /* fresh */ }

const qSel = $<HTMLSelectElement>('#q')
qSel.value = tierName
qSel.onchange = () => { tierName = qSel.value as Tier | 'auto'; tier = tierName === 'auto' ? 'high' : tierName; renderScale = 1; applyTier() }
const vols = () => sound.setVolumes(+$<HTMLInputElement>('#vm').value, +$<HTMLInputElement>('#vmu').value, +$<HTMLInputElement>('#vs').value)
for (const id of ['#vm', '#vmu', '#vs']) $(id).oninput = vols
// The soundtrack: AUTO plays each course's own track (and its climax take on the final stretch).
sound.setCourse(course.def.id)
$<HTMLSelectElement>('#mus').onchange = (e) => { sound.musicChoice = (e.target as HTMLSelectElement).value; sound.refreshMusic() }
$<HTMLInputElement>('#rs').onchange = (e) => { CFG.camera.reduceShake = (e.target as HTMLInputElement).checked }
// Graphics settings: applied live, remembered.
const applyGraphics = () => {
  settings.scale = +$<HTMLInputElement>('#g-scale').value / 100
  settings.dist = +$<HTMLSelectElement>('#g-dist').value
  settings.part = +$<HTMLSelectElement>('#g-part').value
  settings.bloom = $<HTMLInputElement>('#g-bloom').checked
  settings.blur = +$<HTMLInputElement>('#g-blur').value / 100
  settings.sharp = +$<HTMLInputElement>('#g-sharp').value / 100
  settings.grain = $<HTMLInputElement>('#g-grain').checked
  settings.cloud = $<HTMLInputElement>('#g-cloud').checked
  settings.map = $<HTMLInputElement>('#g-map').checked
  settings.fps = $<HTMLSelectElement>('#g-fps').value as typeof settings.fps
  autoCap = 0
  world.setDrawDistance(settings.dist * 1000)
  fx.smoke.density = Math.min(TIERS[tier].density, settings.part)
  fx.glow.density = settings.part
  post.bloom.enabled = TIERS[tier].bloom && settings.bloom
  world.ground.uCloudShadow.value = settings.cloud ? 1 : 0
  if (settings.scale < 1) { renderScale = settings.scale; resize() }
  try { localStorage.setItem('dbu-gfx', JSON.stringify(settings)) } catch { /* storage blocked */ }
}
try {
  const saved = JSON.parse(localStorage.getItem('dbu-gfx') || 'null')
  if (saved) {
    $<HTMLInputElement>('#g-scale').value = String(Math.round(saved.scale * 100))
    $<HTMLSelectElement>('#g-dist').value = String(saved.dist)
    $<HTMLSelectElement>('#g-part').value = String(saved.part)
    $<HTMLInputElement>('#g-bloom').checked = saved.bloom
    $<HTMLInputElement>('#g-blur').value = String(Math.round(saved.blur * 100))
    $<HTMLInputElement>('#g-sharp').value = String(Math.round(saved.sharp * 100))
    $<HTMLInputElement>('#g-grain').checked = saved.grain
    $<HTMLInputElement>('#g-cloud').checked = saved.cloud
    $<HTMLInputElement>('#g-map').checked = saved.map
    if (saved.fps) $<HTMLSelectElement>('#g-fps').value = saved.fps
  }
} catch { /* fresh */ }
for (const id of ['#g-fps', '#g-scale', '#g-dist', '#g-part', '#g-bloom', '#g-blur', '#g-sharp', '#g-grain', '#g-cloud', '#g-map']) $(id).addEventListener('input', applyGraphics), $(id).addEventListener('change', applyGraphics)
applyGraphics()
$<HTMLSelectElement>('#as').onchange = (e) => { player.assist = +(e.target as HTMLSelectElement).value }
$<HTMLInputElement>('#fov').oninput = (e) => { fovMax = +(e.target as HTMLInputElement).value }
try {
  const saved = localStorage.getItem('dbu-fov')
  if (saved) { fovMax = +saved; $<HTMLInputElement>('#fov').value = saved }
  $<HTMLInputElement>('#fov').addEventListener('change', () => { try { localStorage.setItem('dbu-fov', String(fovMax)) } catch { /* private mode */ } })
} catch { /* storage blocked */ }

// Every setting is remembered (quality, volumes, assist, FOV, shake, graphics): saved on any change,
// restored at boot by setting each control and firing its own handlers. A ?q= in the URL still wins.
{
  const ctrls = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#pause input, #pause select')].filter((e) => e.id)
  const save = () => {
    const o: Record<string, string | boolean> = {}
    for (const e of ctrls) o[e.id] = e instanceof HTMLInputElement && e.type === 'checkbox' ? e.checked : e.value
    try { localStorage.setItem('dbu-settings', JSON.stringify(o)) } catch { /* storage blocked */ }
  }
  try {
    const saved = JSON.parse(localStorage.getItem('dbu-settings') || 'null') as Record<string, string | boolean> | null
    if (saved) for (const e of ctrls) {
      if (!(e.id in saved) || (e.id === 'q' && params.has('q'))) continue
      if (e instanceof HTMLInputElement && e.type === 'checkbox') e.checked = !!saved[e.id]
      else e.value = String(saved[e.id])
      e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change'))
    }
  } catch { /* fresh */ }
  for (const e of ctrls) { e.addEventListener('change', save); e.addEventListener('input', save) }
}

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
let orbitYaw = -0.65, orbitPitch = 0.12, orbitKey = 0, orbitKeyP = 0
{
  // Drag on the menu background to turn the view.
  let drag = false, lx = 0, ly = 0
  // (The menu overlay covers the canvas: catch the drag on it, outside its panels.)
  $('#title').addEventListener('pointerdown', (e) => { if (mode === 'title' && !(e.target as HTMLElement).closest('.menu, .preview')) { drag = true; lx = e.clientX; ly = e.clientY } })
  addEventListener('pointerup', () => (drag = false))
  addEventListener('pointermove', (e) => {
    if (!drag || mode !== 'title') return
    orbitYaw -= (e.clientX - lx) * 0.006
    orbitPitch = THREE.MathUtils.clamp(orbitPitch + (e.clientY - ly) * 0.004, 0.02, 0.9)
    lx = e.clientX; ly = e.clientY
  })
  addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') orbitKey = 0
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') orbitKeyP = 0
  })
}
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
  wreckage.shift(dx, dz)
  shock.shift(dx, dz)
  for (const v of visuals.values()) { for (const t of [...v.trail, ...v.vapour]) t.shift(dx, dz); v.lastDust.x += dx; v.lastDust.z += dz }
}

/** The menu's flight: your ship flat out down the course (the AI's line round the spires), never
 *  colliding, back to the start before the finish. */
function titleStep(): void {
  const me = race.racers[0]
  me.idx = course.nearest(player.pos.x, player.pos.z, me.idx)
  if (me.idx > course.finishI - 150 || player.crashing || player.spin > 0) {
    const c = course.cps[1]
    player.reset(c.x - c.tx * 400, c.z - c.tz * 400, Math.atan2(c.tx, c.tz), 4)
    me.idx = course.nearest(player.pos.x, player.pos.z, -1)
    cam.snap(player.heading)
  }
  race.drive(me, STEP)
  player.noCollide = true
  player.announce = false
  player.maxMach = 4.2
  titleCtl.steer = me.controls.steer
  player.step(STEP, titleCtl, world)
}
const titleCtl = { steer: 0, boost: true, burner: false, brake: false, strafe: 0, dodgeL: false, dodgeR: false }
function simStep(): void {
  if (mode === 'title') { titleStep(); return }
  if (mode === 'race') {
    const me = race.racers[0]
    const auto = autopilot || (spectate && me.finished)
    if (auto) race.drive(me, STEP)
    race.step(STEP, forced ?? (auto ? me.controls : input.c), world)
    if (race.state !== 'grid') runTime += STEP
  } else if (mode === 'hunt') {
    if (autopilot) huntAutopilot()
    player.step(STEP, forced ?? input.c, world)
    runTop = Math.max(runTop, player.topMach)
    if (player.recovered) {
      player.recovered = false
      if (player.dead) die()
      else {
        // Upright again, pointing where it slid, rolling slowly.
        const hull = player.hull
        player.reset(player.pos.x, player.pos.z, Math.atan2(player.vel.x, player.vel.z) || player.heading, 0.8)
        player.hull = hull
        player.ghost = 1.5
        cam.snap(player.heading)
      }
    }
    combat.step(STEP, input.fire)
    walker.step(STEP)
    rebase()
    if (!player.dead) runTime += STEP

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
  // A flip: two full rolls (eased) on top of the bank.
  const tu = 1 - p.tumble
  const roll = p.tumble > 0 ? p.tumbleDir * Math.PI * 4 * (1 - (1 - tu) * (1 - tu)) : 0
  // A spin-out is messy: the hull shudders and rocks while it whirls.
  const mess = p.spin > 0 ? Math.min(1, p.spin) : 0
  const wob = mess * (Math.sin(time * 23 + p.pos.x) * 0.1 + Math.sin(time * 37) * 0.06)
  craft.setChar(p.crashing ? Math.min(1, p.crashT / 0.9) : 0)
  if (p.crashing) craft.body.rotation.set(p.crashRot.x, p.crashRot.y, p.crashRot.z)
  else craft.body.rotation.set(THREE.MathUtils.lerp(p.prevPitch, p.pitch, alpha) + wob * 0.6, 0, -THREE.MathUtils.lerp(p.prevBank, p.bank, alpha) + roll + wob)
  // Suspension squash on landing; a slow float bob on the ground effect.
  const bob = p.airborne ? 0 : Math.sin(time * 1.9 + p.pos.x * 0.001) * 0.16 + Math.sin(time * 3.1) * 0.05
  craft.body.position.y = -p.squash * 0.55 + bob
  craft.body.scale.set(1 + p.squash * 0.04, 1 - p.squash * 0.1, 1)
  craft.root.updateMatrixWorld(true)
  craft.lod(camera.position)
  const throttle = p.dead || p.crashing ? 0 : 0.3 + 0.7 * p.throttle
  craft.setFlames(throttle, p.boost, time + (isMe ? 0 : p.pos.x * 0.01))
  // The drift charge shows in the exhaust itself (no HUD bar): blue at level one, violet-white at two.
  craft.setDriftTint(p.drift >= 2 ? 2 : 1, isMe && p.drift >= 0.9 && !p.burning ? Math.min(1, (p.drift - 0.9) * 4) * (0.75 + 0.25 * Math.sin(time * 30)) : 0)
  if (p.dead) return
  const near = camera.position.distanceToSquared(tmp) < 1500 * 1500
  for (let i = 0; i < v.trail.length; i++) {
    nozzleW.copy(craft.nozzles[v.trail.length === 1 ? 1 : i]).applyMatrix4(craft.body.matrixWorld)
    v.trail[i].push(nozzleW, dt)
    v.trail[i].strength = isMe ? 0.2 + p.boost * 0.8 : 0.16 + p.boost * 0.18
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
      e.r = DUST[0]; e.g = DUST[1]; e.b = DUST[2]; e.a = 0.3 * (1 - p.agl / 8); e.drag = 2.4; e.grav = 6
      fx.smoke.emit(e)
    }
  }
  // Rivals far away: a hot engine glow sized to stay a few pixels wide at any range.
  if (!isMe) {
    const d = Math.sqrt(camera.position.distanceToSquared(tmp))
    if (d > 120) {
      nozzleW.copy(craft.nozzles[1]).applyMatrix4(craft.body.matrixWorld)
      const e = resetE()
      e.x = nozzleW.x; e.y = nozzleW.y; e.z = nozzleW.z
      e.vx = p.vel.x; e.vy = p.vel.y; e.vz = p.vel.z
      const sz = Math.min(60, d * 0.012)
      e.life = 0.04; e.size0 = sz; e.size1 = sz
      const col = rivalColor(p)
      e.r = col.r * 3; e.g = col.g * 3; e.b = col.b * 3; e.a = 1
      fx.glow.emit(e)
    }
  }
  // Drifting: sand sprayed out sideways from under the hull, and glow sparks showing the charge.
  if (near && (p.drifting || p.spin > 0) && !p.airborne) {
    const out = p.slip > 0 ? 1 : -1
    for (let i = 0; i < (isMe ? 5 : 2); i++) {
      const e = resetE()
      e.x = tmp.x + p.right.x * out * 2 + (Math.random() - 0.5) * 3; e.y = groundH(tmp.x, tmp.z) + 0.6; e.z = tmp.z + p.right.z * out * 2 + (Math.random() - 0.5) * 3
      const sp = 40 + Math.abs(p.slip) * 90
      e.vx = p.vel.x * 0.25 + p.right.x * out * sp; e.vy = 8 + Math.random() * 18; e.vz = p.vel.z * 0.25 + p.right.z * out * sp
      e.life = 0.9 + Math.random() * 0.8; e.size0 = 2; e.size1 = 12; e.r = DUST[0]; e.g = DUST[1]; e.b = DUST[2]; e.a = 0.4; e.drag = 2.4; e.grav = 8
      fx.smoke.emit(e)
    }
    if (isMe && p.drifting) {
      const l2 = p.drift >= 2, l1 = p.drift >= 0.9
      for (const side of [0, 1]) {
        if (!l1 && Math.random() < 0.6) continue
        nozzleW.copy(craft.sidePuffs[side]).applyMatrix4(craft.body.matrixWorld)
        const e = resetE()
        e.x = nozzleW.x; e.y = nozzleW.y - 0.4; e.z = nozzleW.z
        e.vx = p.vel.x * 0.9 + (Math.random() - 0.5) * 30; e.vy = Math.random() * 20; e.vz = p.vel.z * 0.9 + (Math.random() - 0.5) * 30
        e.life = 0.25; e.size0 = 0.6; e.size1 = 0.3; e.streak = 1; e.drag = 2; e.grav = 30
        // Charging: dull orange grit; level one: blue; level two: violet-white and bigger.
        if (l2) { e.r = 6; e.g = 2.6; e.b = 7.5; e.size0 = 0.9 } else if (l1) { e.r = 1.2; e.g = 3.5; e.b = 7 } else { e.r = 2.2; e.g = 1.0; e.b = 0.35 }
        e.a = 1
        fx.glow.emit(e)
      }
    }
  }
  // FROSTLINE: snow drifting through the air around you (a few flakes a frame, small, slow, wind-blown).
  if (isMe && BIOME === 'ice') {
    // (Never right at the camera — near flakes were big soft discs — fine, many, streaking with speed.)
    for (let i = 0; i < 24; i++) {
      const e = resetE()
      const ahead = 25 + Math.random() * 235, side = (Math.random() - 0.5) * 160
      e.x = tmp.x + p.fwd.x * ahead + p.right.x * side; e.z = tmp.z + p.fwd.z * ahead + p.right.z * side
      e.y = groundH(e.x, e.z) + 1 + Math.random() * 30
      e.vx = 14 + Math.random() * 6; e.vy = -2 - Math.random() * 2; e.vz = 6
      e.life = 2.5; e.size0 = 0.1; e.size1 = 0.1; e.r = 1.6; e.g = 1.7; e.b = 1.9; e.a = 0.9; e.streak = p.mach > 1.5 ? 1 : 0
      fx.smoke.emit(e)
    }
  }
  // Speed cues: sand wisps hanging low in the air ahead, which rush past at your speed.
  if (isMe && !p.airborne && p.mach > 0.8) {
    const n = Math.min(6, Math.floor(p.mach * 1.2))
    for (let i = 0; i < n; i++) {
      const ahead = 120 + Math.random() * 260, side = (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 60)
      const x = tmp.x + p.fwd.x * ahead + p.right.x * side, z = tmp.z + p.fwd.z * ahead + p.right.z * side
      const e = resetE()
      e.x = x; e.y = groundH(x, z) + 0.6 + Math.random() * 5; e.z = z
      e.vx = 0; e.vy = 0; e.vz = 0
      e.life = 0.5 + Math.random() * 0.4; e.size0 = 1 + Math.random() * 2; e.size1 = 2.5 + Math.random() * 3
      e.r = DUST[0] * 1.15; e.g = DUST[1] * 1.3; e.b = DUST[2] * 1.5; e.a = 0.35
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
  // A wreck burns as it tumbles: fire at the hull, a thick black plume behind.
  if (p.crashing && near) {
    for (let k = 0; k < 3; k++) {
      const e = resetE()
      e.x = tmp.x + (Math.random() - 0.5) * 3; e.y = tmp.y + Math.random() * 2; e.z = tmp.z + (Math.random() - 0.5) * 3
      e.vx = p.vel.x * 0.5; e.vy = 10 + Math.random() * 10; e.vz = p.vel.z * 0.5
      e.life = 1.6 + Math.random(); e.size0 = 3; e.size1 = 14 + Math.random() * 8
      e.r = 0.05; e.g = 0.045; e.b = 0.04; e.a = 0.75; e.r1 = 2.5; e.g1 = 2.4; e.b1 = 2.3; e.drag = 1.8; e.grav = -5
      fx.smoke.emit(e)
    }
    // (Spread along the distance covered since last frame: a stream of fire, not a row of beads.)
    // (Along the wreck's actual path since last frame — in a crash p.vel is not what moves it, and the
    // stream came out as beads.)
    const gap = v.lastDust.distanceTo(tmp)
    const nf = Math.min(10, 3 + Math.ceil(gap / 3))
    for (let k = 0; k < nf; k++) {
      const u = k / nf
      const f = resetE()
      f.x = tmp.x + (v.lastDust.x - tmp.x) * u; f.y = tmp.y + 0.5 + (v.lastDust.y - tmp.y) * u; f.z = tmp.z + (v.lastDust.z - tmp.z) * u
      f.vx = (Math.random() - 0.5) * 8; f.vy = 6 + Math.random() * 6; f.vz = (Math.random() - 0.5) * 8
      f.life = 0.3 + Math.random() * 0.2; f.size0 = 3; f.size1 = 7.5; f.r = 7; f.g = 2.6 + Math.random(); f.b = 0.7; f.a = 0.8; f.drag = 2.5
      fx.glow.emit(f)
    }
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

// ── frame pacing ──
// On a 120 Hz screen a frame that takes 9–12 ms is shown alternately for 8 ms and 16 ms: judder, at a
// "high" frame rate. AUTO watches for that and locks to an even 60 (retrying 120 later); 60 / 120 / MAX
// are fixed. (rAF still fires every refresh; skipped refreshes simply don't render.)
// Refresh interval: the median of the last 30 rAF gaps, in a fixed ring (no per-frame arrays).
const rafGaps = new Float64Array(30), rafSorted = new Float64Array(30)
let rafN = 0, rafHead = 0, refreshMs = 16.7
let lastRaf = performance.now()
let autoMisses = 0, autoFrames = 0, autoSince = 0
function frameCap(): number {
  const refresh = refreshMs
  if (refresh > 12) return 0 // a 60 Hz screen: every refresh
  if (settings.fps === '60') return 1000 / 60
  if (settings.fps === '120' || settings.fps === 'max') return 0
  return autoCap
}
function paceAuto(delta: number, now: number): void {
  if (settings.fps !== 'auto') return
  const refresh = refreshMs
  if (refresh > 12) return
  autoFrames++
  if (delta > (autoCap || refresh) * 1.45) autoMisses++
  if (autoFrames >= 120) {
    if (!autoCap && autoMisses > 10) { autoCap = 1000 / 60; autoSince = now }
    else if (autoCap && autoMisses === 0 && now - autoSince > 30000) { autoCap = 0; autoSince = now }
    autoFrames = 0; autoMisses = 0
  }
}

function frame(now: number): void {
  requestAnimationFrame(frame)
  rafGaps[rafHead] = now - lastRaf; lastRaf = now
  rafHead = (rafHead + 1) % 30; if (rafN < 30) rafN++
  if ((rafHead & 7) === 0) { const v = rafSorted.subarray(0, rafN); v.set(rafGaps.subarray(0, rafN)); v.sort(); refreshMs = v[rafN >> 1] }
  const cap = frameCap()
  if (cap > 0 && now - last < cap - 2) return
  paceAuto(now - last, now)
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
  else if (slowmoT > 0) { slowmoT -= realDt; timeScale = THREE.MathUtils.lerp(1, 0.22, Math.min(1, slowmoT / 0.6)); if (slowmoT <= 0) sound.slowmo(0) }
  if (slowmoT > 0) sound.slowmo(Math.min(1, slowmoT / 0.6))
  const dt = realDt * timeScale
  time += dt

  input.read(realDt, now / 1000)
  {
    acc += dt
    let steps = 0
    while (acc >= STEP && steps < 6) { simStep(); acc -= STEP; steps++ }
    if (steps >= 6) acc = 0
  }
  const alpha = acc / STEP

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
    shadowM.compose(tmp.set(p.x - (SUN_DIR[0] / SHADOW_Y) * h, g + 0.3, p.z - (SUN_DIR[2] / SHADOW_Y) * h), shadowQ, shadowS)
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
    if (!$('#title').classList.contains('hunt')) animTrackPreview(now)
    // A fixed orbit round the ship as it flies (← → and ↑ ↓, or drag, turn it): locked to the ship,
    // so the desert streams past at Mach 4.
    void attractYaw
    orbitYaw += orbitKey * realDt * 1.6
    orbitPitch = THREE.MathUtils.clamp(orbitPitch + orbitKeyP * realDt * 0.8, 0.02, 0.9)
    const r = 17
    const a = heading + Math.PI + orbitYaw
    camera.position.set(renderPos.x + Math.sin(a) * Math.cos(orbitPitch) * r, renderPos.y + 1.4 + Math.sin(orbitPitch) * r, renderPos.z + Math.cos(a) * Math.cos(orbitPitch) * r)
    camera.position.y = Math.max(camera.position.y, groundH(camera.position.x, camera.position.z) + 1.5)
    tmp.set(-Math.cos(a), 0, Math.sin(a))
    // (Centred between the menu on the left and the course map on the right.)
    camera.lookAt(renderPos.x - tmp.x * 0.4, renderPos.y + 1.6, renderPos.z - tmp.z * 0.4)
    camera.fov = 42
    camera.updateProjectionMatrix()
  } else if (mode === 'race' && spectate && race.racers[0].finished) {
    cam.cinematic(realDt, time, player, renderPos, heading)
  } else {
    cam.update(realDt, time, player, renderPos, heading, world, fovMax)
  }

  const me = race.racers[0]
  course.update(mode === 'race' ? me.next : -1, time, false)
  course.group.visible = mode !== 'hunt'
  world.ground.uTrackOn.value = mode === 'hunt' ? 0 : course.def.wear ?? 1

  if (mode === 'hunt') combat.render(alpha, realDt, time)
  combat.group.visible = mode === 'hunt'
  fx.update(dt)
  wreckage.update(dt)
  shock.update(dt)
  for (const v of visuals.values()) { for (const t of v.trail) t.build(camera.position); for (const t of v.vapour) t.build(camera.position) }
  sound.scrape(mode === 'title' ? 0 : Math.max(player.scrape, player.drifting || player.spin > 0 ? 0.25 + Math.abs(player.slip) * 0.35 : 0))
  sound.slide(mode === 'title' || player.airborne ? 0 : player.drifting ? 0.4 + Math.min(0.6, Math.abs(player.slip)) : 0, player.drift / 2.6, player.spin > 0 ? player.yawRate : 0)

  world.update(camera.position, time)
  const G = world.ground
  G.uCraft.value.copy(renderPos)
  const agl = Math.max(0, renderPos.y - groundH(renderPos.x, renderPos.z))
  // (On the ground the shadow sits right under the hull: cast along the sun it poked out ahead of the
  // nose — the "black thing in front", user 2026-11-20. It slides off with the sun only as you climb.)
  const cast = THREE.MathUtils.smoothstep(agl, 6, 30) * agl
  G.uShadow.value.set(renderPos.x - (SUN_DIR[0] / SHADOW_Y) * cast, renderPos.z - (SUN_DIR[2] / SHADOW_Y) * cast)
  G.uShadowK.value = agl
  G.uFwd.value.set(Math.sin(heading), Math.cos(heading))
  G.uBoost.value = myCraft.root.visible ? player.boost : 0
  G.uSpeed.value = Math.min(1, player.mach / 6)
  walker.shadow(G.uWalker.value)

  // Post.
  const s = Math.min(1, player.mach / 6)
  const P = post.final.uniforms
  // Engine heat haze: your nozzles and the line their exhaust runs along, on screen.
  {
    const on = !player.dead && !player.crashing && myCraft.root.visible
    let k = on ? 0.35 + 0.65 * player.throttle + player.boost * 0.6 : 0
    myCraft.body.updateMatrixWorld()
    tmp.set(0, 0, 0)
    for (let i = 0; i < 3; i++) {
      nozzleW.copy(myCraft.nozzles[i]).applyMatrix4(myCraft.body.matrixWorld)
      tmp.add(nozzleW)
      proj.copy(nozzleW).project(camera)
      const dist = camera.position.distanceTo(nozzleW)
      P.uJet.value[i].set(proj.x * 0.5 + 0.5, proj.y * 0.5 + 0.5, Math.min(0.06, (0.55 / Math.max(dist, 1)) / Math.tan((camera.fov * Math.PI) / 360) * 0.5))
      if (proj.z > 1) k = 0
    }
    tmp.multiplyScalar(1 / 3)
    proj.copy(tmp).project(camera)
    const ax = proj.x, ay = proj.y
    proj.copy(tmp).addScaledVector(player.fwd, -12).project(camera)
    P.uJetDir.value.set((proj.x - ax) * camera.aspect, proj.y - ay)
    if (P.uJetDir.value.lengthSq() < 1e-6) k = 0
    P.uJetK.value = Math.min(1.4, k)
  }
  const play = mode !== 'title'
  const cine = mode === 'race' && spectate && race.racers[0].finished
  hud.style.opacity = cine ? '0.3' : ''
  damageFlash = Math.max(0, damageFlash - realDt * 1.8)
  impactPulse = Math.max(0, impactPulse - realDt * 3)
  if (player.barrier === 'silence') white = Math.min(1, white + realDt * 1.6)
  else white = Math.max(0, white - realDt * (player.barrier === 'boom' ? 1.6 : 4))
  P.uSpeed.value = play ? s : 0
  P.uBlur.value = play ? settings.blur * (cine ? 0.3 : 1) * CFG.post.radialBlur * (s * s * 1.2 + player.boost * 0.4 + white * 0.6 + impactPulse * 0.8) : 0
  P.uAberr.value = play ? CFG.post.aberration * (s + player.boost * 0.5 + damageFlash + impactPulse * 2.5) : 0
  P.uStreak.value = play ? (cine ? 0.25 : 1) * (BIOME === 'ice' ? 0.45 : 1) * CFG.post.streaks * THREE.MathUtils.clamp((player.mach - 0.8) / 4, 0, 1) : 0
  P.uStreakT.value += realDt * (0.4 + player.mach * 0.45)
  P.uWhite.value = white * 0.45
  P.uDamage.value = damageFlash
  P.uTime.value = time
  P.uGrain.value = settings.grain ? CFG.post.grain : 0
  P.uSharpen.value = settings.sharp + (1 - renderScale) * 1.2
  P.uExposure.value = CFG.post.exposure
  post.bloom.strength = CFG.post.bloom
  world.ground.uCloudOff.value.copy((world.sky.material as THREE.ShaderMaterial).uniforms.uCloudOff.value)
  post.bloom.threshold = CFG.post.bloomThreshold
  const onGrid = mode === 'race' && race.state === 'grid'
  const engineMach = mode === 'title' ? 2.5 : onGrid ? 0.3 + player.boost * 0.9 : player.mach
  const heat = mode === 'race' ? Math.min(1, (Math.max(0, me.passed - 1) / course.cps.length) * 1.5 * LAPS) : walker.state === 'fight' || walker.state === 'coming' ? 1 : 0
  // Rivals' engines: the three nearest, with their closing speed (Doppler) and side (pan).
  rivalVoices.length = 0
  if (mode === 'race') {
    camRight.set(1, 0, 0).applyQuaternion(camera.quaternion)
    for (const r of race.racers) {
      if (!r.ai || r.p.dead) continue
      tmp.subVectors(r.p.pos, camera.position)
      const dist = tmp.length()
      if (dist > 900) continue
      tmp.multiplyScalar(1 / (dist || 1))
      const closing = -((r.p.vel.x - player.vel.x) * tmp.x + (r.p.vel.z - player.vel.z) * tmp.z)
      rivalVoices.push({ dist, closing, pan: tmp.dot(camRight), mach: r.p.mach })
    }
    rivalVoices.sort((a, b) => a.dist - b.dist)
    // Passing things: a whoosh as a spire or a rival goes by.
    const me = race.racers[0]
    for (const rk of course.rocks) {
      if (Math.abs(rk.i - me.idx) > 6) continue
      const ahead = (rk.x - player.pos.x) * player.fwd.x + (rk.z - player.pos.z) * player.fwd.z
      const was = passSide.get(rk) ?? ahead
      passSide.set(rk, ahead)
      if (was > 0 && ahead <= 0) {
        const lat = (rk.x - player.pos.x) * player.right.x + (rk.z - player.pos.z) * player.right.z
        const close = Math.abs(lat) - rk.r
        if (close < 160) { sound.whoosh(Math.min(1, 50 / Math.max(close, 8)) * Math.min(1, player.mach / 3), lat > 0 ? 0.8 : -0.8); if (close < 40) shake(0.12) }
      }
    }
    for (const r of race.racers) {
      if (!r.ai) continue
      const ahead = (r.p.pos.x - player.pos.x) * player.fwd.x + (r.p.pos.z - player.pos.z) * player.fwd.z
      const was = passSide.get(r) ?? ahead
      passSide.set(r, ahead)
      const lat = (r.p.pos.x - player.pos.x) * player.right.x + (r.p.pos.z - player.pos.z) * player.right.z
      if (Math.sign(was) !== Math.sign(ahead) && Math.abs(lat) < 60) sound.whoosh(0.7, lat > 0 ? 0.7 : -0.7)
    }
    // The music's sections.
    if (race.state === 'grid') sound.setSection('build')
    else if (me.finished) sound.setSection('outro')
    else if (player.crashing || (crashBreak > 0 && (crashBreak -= realDt) > 0)) sound.setSection('break')
    else sound.setSection(race.toGo(me) < 25000 ? 'final' : 'drop')
    if (player.crashing) crashBreak = 2
  } else if (mode === 'hunt') sound.setSection(walker.state === 'fight' || walker.state === 'coming' ? 'final' : player.crashing ? 'break' : 'drop')
  else sound.setSection('title')
  sound.update(realDt, engineMach, player.boost, player.brake, mode === 'hunt' ? combat.lockProgress : 0, mode === 'hunt' && combat.locked, play && !player.dead && !player.crashing, heat, player.burning, rivalVoices)

  post.render(realDt)
  renderMap()
  hudT -= realDt
  updateHud(realDt, hudT <= 0)
  if (hudT <= 0) hudT = 0.1
  input.consume()
}

function updateHud(dt: number, slow: boolean): void {
  if (mode === 'title') return
  const m = player.mach
  machNum.textContent = m.toFixed(2)
  kmsEl.textContent = `${(player.speed / 1000).toFixed(2)} KM/S`
  for (let i = 0; i < 6; i++) {
    barCells[i].classList.toggle('on', m >= i + 0.5 || m > i + 1)
    barCells[i].classList.toggle('white', m >= 5.9)
  }
  // In the air: how far the nose is from the travel — land straight or it spins.
  const al = $('#align')
  if (player.airborne && player.tumble <= 0 && player.airTime > 0.25 && Math.abs(player.slip * 57.3) > 8) {
    const deg = Math.abs(player.slip * 57.3)
    al.style.display = 'block'
    al.textContent = deg < 6 ? 'ALIGNED' : `NOSE ${deg.toFixed(0)}° OFF · ${player.slip > 0 ? 'STEER RIGHT' : 'STEER LEFT'}`
    al.className = deg > 26 ? 'bad' : 'ok'
  } else if (player.wake > 0.3 && !player.airborne) {
    al.style.display = 'block'
    al.textContent = `SLIPSTREAM ${'▮'.repeat(Math.ceil(player.wake * 5))}`
    al.className = 'ok'
  } else al.style.display = 'none'
  // Grip gauge: how much of the grip you are using; past the line you are sliding, red is a spin.
  const gg = $('#grip')
  const load = player.gripLoad
  gg.style.opacity = mode === 'race' || mode === 'hunt' ? (player.airborne ? '0.35' : '1') : '0'
  ;(gg.querySelector('i') as HTMLElement).style.width = `${Math.min(100, (load / 1.6) * 100)}%`
  gg.className = player.spin > 0 || player.recover > 0 ? 'spin' : player.spinRisk > 0.55 ? 'danger' : load > 1 ? 'slide' : load > 0.8 ? 'edge' : ''
  ;(gg.querySelector('span') as HTMLElement).textContent = player.spin > 0 ? 'SPIN' : player.spinRisk > 0.55 ? 'CATCH IT' : load > 1 ? 'SLIDING' : 'GRIP'
  // The afterburner: say plainly that the steering is locked, and say it louder if you try to turn.
  const bn = $('#burn')
  const fighting = player.burning && Math.abs(player.steerWant) > 0.3
  bn.style.display = player.burning ? 'block' : 'none'
  bn.className = fighting ? 'fight' : ''
  bn.innerHTML = fighting ? 'RELEASE <b>SHIFT</b> TO TURN' : 'AFTERBURNER · <b>STEERING LOCKED</b>'
  $('#grip').classList.toggle('locked', player.burning)
  // In a wake: the camera shakes with it.
  if (player.wake > 0.15) cam.trauma = Math.max(cam.trauma, player.wake * 0.45)
  // Drift charge levels: felt, not read — a thunk, a rumble and a camera nudge at each level.
  const lvl = player.drifting ? (player.drift >= 2 ? 2 : player.drift >= 0.9 ? 1 : 0) : 0
  if (lvl > driftLvl) { sound.driftLevel(lvl); input.rumble(0.35 + lvl * 0.2, 0.6, 110); cam.punch += 1.5 + lvl; shake(0.12 + lvl * 0.08) }
  driftLvl = lvl
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
      $('#r-lap').innerHTML = `${(race.toGo(me) / 1000).toFixed(1)}<small> KM</small>`
      $('#r-pen').textContent = ''
      // Rows built once; each tick only changes text that actually changed (no innerHTML re-parse,
      // no style recalc of the whole panel).
      // (Places are 0 until the race has ticked once: nothing to list yet.)
      for (const r of race.racers) if (r.place >= 1) standRows[r.place - 1] = r
      const top = standRows[0], lead = top ? race.progress(top) : 0
      // Ten rows at most: with a bigger field, the top three and the six around you.
      const N = race.racers.length, myP = race.racers[0].place
      let shown = 0
      for (let k = 0; top && k < N && shown < standEls.length; k++) {
        if (!standRows[k]) continue
        if (N > standEls.length && k >= 3 && Math.abs(k + 1 - myP) > 3 && !(myP <= 7 && k < 10)) continue
        const r = standRows[k], row = standEls[shown++]
        row.el.style.display = ''
        const gap = r.finished ? (r === top ? 'WINNER ' : '') + fmtLap(r.finishTime) : top.finished ? `${(race.toGo(r) / 1000).toFixed(1)} KM` : r === top ? 'LEADER' : `+${((lead - race.progress(r)) / Math.max(800, player.speed)).toFixed(1)}`
        const name = `${r.place}\u00a0\u00a0${r.name}`
        if (row.who !== r) { row.who = r; row.el.className = r.ai ? '' : 'me'; row.el.style.setProperty('--c', hex(r.color)) }
        if (row.name.textContent !== name) row.name.textContent = name
        if (row.gap.textContent !== gap) row.gap.textContent = gap
      }
      for (let k = shown; k < standEls.length; k++) standEls[k].el.style.display = 'none'
      // Who is just ahead and just behind, in seconds at your speed.
      const ahead = standRows[myP - 2], behind = standRows[myP]
      const sec = (a: Racer, b: Racer) => ((race.progress(a) - race.progress(b)) / Math.max(300, player.speed)).toFixed(2)
      $('#gap-a').innerHTML = ahead && !me.finished ? `<span class="up">▲ ${ahead.name} +${sec(ahead, me)} S</span>` : ''
      $('#gap-b').innerHTML = behind && !me.finished ? `<span class="dn">▼ ${behind.name} −${sec(me, behind)} S</span>` : ''
    }
    drawMini()
    // Section banners as you enter each (course 2), and a warning ~3 s before a hairpin.
    const kmIn = course.pz[me.idx] / 1000
    const secs = course.def.sections
    while (secK < secs.length && kmIn >= secs[secK][0]) { if (kmIn - secs[secK][0] < 2) flash(secs[secK][1]); secK++ }
    if (race.state === 'racing' && me.idx > pinUntil) {
      const look = Math.min(course.n, me.idx + Math.round((player.speed * 3 + 300) / 40))
      for (let i = me.idx; i < look; i += 3) {
        // (1.25 km: the circuit's constant sweepers are not hairpins; Dry River's ~1 km ones are.)
        if (course.curv[i] > 1 / 1250) { if (player.mach > 3.2) warn('HAIRPIN', 'BRAKE · S'); pinUntil = i + 80; break }
      }
    }
    $('#r-time').textContent = fmtLap(me.finished ? me.finishTime : race.clock + me.penalty)
    const [tx, tz] = course.tangent(me.idx)
    const along = player.vel.x * tx + player.vel.z * tz
    wrongT = race.state === 'racing' && !player.crashing && player.ghost <= 0 && along < -0.3 * player.speed && player.speed > 100 ? wrongT + dt : 0
    if (wrongT > 1.2 && warnT < 0.5) warn('WRONG WAY', 'TURN AROUND · R FOR THE LAST GATE')
    const off = Math.hypot(player.pos.x - course.px[me.idx], player.pos.z - course.pz[me.idx])
    offT = off > 2600 && race.state === 'racing' && !player.crashing ? offT + dt : 0
    if (offT > 1 && warnT < 0.5) warn('OFF COURSE', 'R TO RETURN TO THE LAST GATE')
    for (const el of enemyEls) el.style.display = 'none'
    // Rival tags.
    for (const { r, d } of tagEls) {
      const dist = r.p.pos.distanceTo(camera.position)
      proj.set(r.p.pos.x, r.p.pos.y + 4, r.p.pos.z).project(camera)
      const on = !r.p.dead && proj.z < 1 && Math.abs(proj.x) < 1 && Math.abs(proj.y) < 1 && dist > 25 && dist < 4000
      d.style.display = on ? 'block' : 'none'
      if (on) {
        d.style.left = `${(proj.x * 0.5 + 0.5) * innerWidth}px`
        d.style.top = `${(-proj.y * 0.5 + 0.5) * innerHeight}px`
        // Far ahead (you, well behind): just a small faint chevron — a row of names across the middle of
        // the view hid the spires you were about to meet. Near the centre of the screen, fainter still.
        const far = dist > 1200
        if (d.classList.contains('far') !== far) d.classList.toggle('far', far)
        const centre = Math.hypot(proj.x, proj.y * 1.6)
        d.style.opacity = String(THREE.MathUtils.clamp(1.2 - dist / 8000, 0.45, 1) * (far ? 0.6 : 1) * THREE.MathUtils.lerp(0.45, 1, THREE.MathUtils.smoothstep(centre, 0.08, 0.3)))
      }
    }
    const c = course.cps[Math.min(me.next, course.cps.length - 1)]
    // The next gate: a diamond on it when on screen (with distance), the edge arrow when not.
    proj.set(c.x, groundH(c.x, c.z) + 70, c.z).project(camera)
    const gm = $('#gmark')
    const gd = Math.hypot(c.x - player.pos.x, c.z - player.pos.z)
    const gon = !me.finished && proj.z < 1 && Math.abs(proj.x) < 0.95 && Math.abs(proj.y) < 0.95 && gd > 150
    gm.style.display = gon ? 'block' : 'none'
    // …and the gate after it, smaller and fainter: where the next turn goes.
    const c2 = course.cps[Math.min(me.next + 1, course.cps.length - 1)]
    proj.set(c2.x, groundH(c2.x, c2.z) + 70, c2.z).project(camera)
    const g2 = $('#gmark2')
    const g2on = !me.finished && me.next + 1 < course.cps.length && proj.z < 1 && Math.abs(proj.x) < 0.95 && Math.abs(proj.y) < 0.95
    g2.style.display = g2on ? 'block' : 'none'
    if (g2on) g2.style.transform = `translate(${(proj.x * 0.5 + 0.5) * innerWidth}px, ${(-proj.y * 0.5 + 0.5) * innerHeight}px)`
    if (gon) {
      gm.style.transform = `translate(${(proj.x * 0.5 + 0.5) * innerWidth}px, ${(-proj.y * 0.5 + 0.5) * innerHeight}px)`
      gm.classList.toggle('fin', me.next === 0 || me.next === race.K - 1)
      ;(gm.querySelector('.t') as HTMLElement).textContent = `${me.next === 0 ? 'START' : me.next === race.K - 1 ? 'FINISH' : 'GATE ' + me.next} · ${gd < 1000 ? Math.round(gd) + ' M' : (gd / 1000).toFixed(1) + ' KM'}`
    }
    arrowTo(proj, me.finished ? '' : `${me.next === 0 ? 'START' : me.next === race.K - 1 ? 'FINISH' : 'GATE ' + me.next} · ${(Math.hypot(c.x - player.pos.x, c.z - player.pos.z) / 1000).toFixed(1)} KM`)
    lockEl.style.display = 'none'
  } else if (mode === 'hunt') {
    for (const { d } of tagEls) d.style.display = 'none'
    $('#gmark').style.display = 'none'
    $('#gmark2').style.display = 'none'
    scoreNum.textContent = String(score)
    scoreSub.textContent = combat.paused ? `WALKER · ${combat.kills} DOWN` : `WAVE ${combat.wave} · ${combat.left()} LEFT · ${fmtTime(runTime)}`
    // Enemy markers: a chevron over each on screen (gold for runners), the nearest runner off screen.
    let ei = 0
    let nearRun: THREE.Vector3 | null = null
    let nearD = Infinity
    for (const d of combat.drones) {
      if (!d.alive) continue
      const dist = d.pos.distanceTo(player.pos)
      if (d.mode === 'run' && dist < nearD) { nearD = dist; nearRun = d.pos }
      proj.copy(d.pos).project(camera)
      if (proj.z >= 1 || Math.abs(proj.x) > 1 || Math.abs(proj.y) > 1 || ei >= enemyEls.length) continue
      const el = enemyEls[ei++]
      el.style.display = 'block'
      el.style.left = `${(proj.x * 0.5 + 0.5) * innerWidth}px`
      el.style.top = `${(-proj.y * 0.5 + 0.5) * innerHeight - 8}px`
      el.classList.toggle('run', d.mode === 'run')
      el.firstElementChild!.textContent = `${d.mode === 'run' ? 'RUNNER ' : ''}${dist < 1000 ? Math.round(dist) + ' M' : (dist / 1000).toFixed(1) + ' KM'}`
    }
    for (; ei < enemyEls.length; ei++) enemyEls[ei].style.display = 'none'
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
    } else if (nearRun && !player.dead) {
      proj.copy(nearRun).project(camera)
      arrowTo(proj, `RUNNER ${(nearD / 1000).toFixed(1)} KM`)
    } else arrowEl.style.display = 'none'
  }
  if (debugEl.style.display === 'block' && slow) {
    const i = renderer.info
    debugEl.textContent = `${fps.toFixed(0)} fps  ${lastMs.toFixed(1)} ms\ncalls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k\ntier ${tier} (${tierName})  scale ${renderScale.toFixed(2)}  pr ${pixelRatio().toFixed(2)}\ncap ${frameCap() ? '60' : 'max'}  mach ${m.toFixed(2)}  agl ${player.agl.toFixed(1)}  air ${player.airborne}\nslip ${(player.slip * 57.3).toFixed(0)}°  yaw ${player.yawRate.toFixed(2)}  drift ${player.drift.toFixed(2)}  spin ${player.spin.toFixed(1)}\nparticles ${fx.glow.count}+${fx.smoke.count}`
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

// Map (top left): a wide top-down window of the course — 1.5 km behind you to 7 km ahead, the line
// running left to right — with the track as a band of its real width, every spire to scale, gate bars,
// rivals and you; along the bottom, the whole sprint as a strip with everyone on it.
const miniCtx = mini.getContext('2d')!
const MW = mini.width, MH = mini.height
const MAP_H = MH - 56
const WIN_BACK = 1500, WIN_AHEAD = 7000
const mk = (MAP_H - 24) / (WIN_BACK + WIN_AHEAD)
const mapView = { cx: 0, cz: 0, kk: mk, ang: 0, fx: 0, fz: 1, init: false }
const mapCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 30000)
mapCam.up.set(0, 0, 1) // screen up = +z (the way the course runs), screen right = −x (your right)
const mapRT = new THREE.WebGLRenderTarget((MW - 16) >> 1, MAP_H >> 1, { type: THREE.HalfFloatType })
// The map camera sees layer 1 only: terrain, mesas, rocks, the course's solid parts and the sun —
// no sky, particles, ships, trails or additive glow (a cheap render, not a second frame).
mapCam.layers.set(1)
let mapLayersSet = false
const mapQuad = new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms: { tMap: { value: mapRT.texture } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tMap; varying vec2 vUv;
    vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    void main() {
      vec3 c = texture2D(tMap, vUv).rgb;
      if (any(isnan(c))) c = vec3(0.3);
      c = aces(c * 0.85);
      // A touch darker and cooler than the view, so the icons on it read.
      c = mix(c, c * vec3(0.8, 0.85, 0.95), 0.35);
      c = mix(c * 12.92, 1.055 * pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
      gl_FragColor = vec4(c, 1.0);
    }`,
  depthTest: false,
  depthWrite: false,
}))
let mapFrame = 0
/** The real top-down render under the map overlay: an orthographic camera straight down. */
function renderMap(): void {
  if (mode !== 'race' || !mini.classList.contains('on') || !settings.map) return
  if (!mapLayersSet) {
    mapLayersSet = true
    for (const o of world.group.children) {
      const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined
      if (o === world.sky || o === world.hills || m?.uniforms?.uTile) continue
      o.layers.enable(1)
    }
    course.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined
      // (No glow on the map: the gates' light pillars drew a long stray line across it.)
      if (m && m.blending === THREE.AdditiveBlending) return
      o.layers.enable(1)
    })
  }
  // Redrawn evenly every other frame (cheap now), blitted every frame.
  if ((mapFrame++ & 1) !== 0) { blitMap(); return }
  const kk = mapView.kk
  // World extents of the panel's map area (canvas px → metres), matching the overlay's mapping.
  // Heading-up: centred on the panel's centre point, screen-up along the line's direction.
  const halfX = (MW / 2 - 8) / kk, halfZ = MAP_H / 2 / kk
  mapCam.left = -halfX; mapCam.right = halfX
  mapCam.top = halfZ; mapCam.bottom = -halfZ
  mapCam.up.set(mapView.fx, 0, mapView.fz)
  mapCam.position.set(mapView.cx, 4000, mapView.cz)
  mapCam.lookAt(mapView.cx, 0, mapView.cz)
  mapCam.updateProjectionMatrix()
  renderer.setRenderTarget(mapRT)
  renderer.clear()
  renderer.render(scene, mapCam)
  renderer.setRenderTarget(null)
  blitMap()
}
function blitMap(): void {
  const r = mini.getBoundingClientRect()
  const sx = r.width / MW
  const x = r.left + 8 * sx, w = (MW - 16) * sx, top = r.top + 8 * sx, h = MAP_H * sx
  const y = innerHeight - top - h
  const auto = renderer.autoClear
  renderer.autoClear = false
  renderer.setViewport(x, y, w, h)
  renderer.setScissor(x, y, w, h)
  renderer.setScissorTest(true)
  mapQuad.render(renderer)
  renderer.setScissorTest(false)
  renderer.setViewport(0, 0, innerWidth, innerHeight)
  renderer.autoClear = auto
}

const DASH = [10, 9], NODASH: number[] = []
function drawMini(): void {
  const g = miniCtx
  g.clearRect(0, 0, MW, MH)
  // (The map itself is a real top-down render, drawn underneath this canvas: renderMap().)
  g.fillStyle = 'rgba(12,7,5,0.55)'
  g.beginPath(); g.roundRect(2, MAP_H + 12, MW - 4, MH - MAP_H - 14, 14); g.fill()
  g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 3
  g.beginPath(); g.roundRect(6, 6, MW - 12, MAP_H + 4, 14); g.stroke()
  const me = race.racers[0]
  // Heading-up, true top-down: screen-up is the line's direction just ahead (eased, so the map turns
  // smoothly through bends — any course shape, loops included); your right-hand side is right.
  const [t1x, t1z] = course.tangent(me.idx), [t2x, t2z] = course.tangent(Math.min(course.n - 1, me.idx + 30))
  const want = Math.atan2(t1x + t2x, t1z + t2z)
  if (!mapView.init) { mapView.ang = want; mapView.init = true }
  mapView.ang += Math.atan2(Math.sin(want - mapView.ang), Math.cos(want - mapView.ang)) * Math.min(1, lastMs / 1000 * 2.5)
  const fx = Math.sin(mapView.ang), fz = Math.cos(mapView.ang), rx = -fz, rz = fx
  const kk = mk
  const ahead = (WIN_AHEAD - WIN_BACK) / 2
  const cx = player.pos.x + fx * ahead, cz = player.pos.z + fz * ahead
  const SX = (x: number, z: number) => MW / 2 + ((x - cx) * rx + (z - cz) * rz) * kk
  const SY = (x: number, z: number) => 8 + MAP_H / 2 - ((x - cx) * fx + (z - cz) * fz) * kk
  const i0 = Math.max(0, me.idx - Math.round(WIN_BACK / 40) - 10), i1 = Math.min(course.n - 1, me.idx + Math.round((WIN_AHEAD * 1.6) / 40))
  g.save()
  g.beginPath(); g.roundRect(8, 8, MW - 16, MAP_H, 14); g.clip()
  g.beginPath()
  for (let i = i0; i <= i1; i++) { const x = SX(course.px[i], course.pz[i]), y = SY(course.px[i], course.pz[i]); if (i === i0) g.moveTo(x, y); else g.lineTo(x, y) }
  g.lineJoin = 'round'; g.lineCap = 'round'
  g.strokeStyle = 'rgba(255,240,225,0.35)'; g.lineWidth = 2; g.setLineDash(DASH); g.stroke(); g.setLineDash(NODASH)
  // Spires: a thin ring round each (the render shows the rock; the ring makes it pop at this size).
  for (const rk of course.rocks) {
    if (rk.i < i0 || rk.i > i1) continue
    const x = SX(rk.x, rk.z), y = SY(rk.x, rk.z)
    g.strokeStyle = 'rgba(255,110,60,0.9)'; g.lineWidth = 2
    g.beginPath(); g.arc(x, y, Math.max(6, rk.r * 1.8 * kk) + 2, 0, Math.PI * 2); g.stroke()
  }
  mapView.cx = cx; mapView.cz = cz; mapView.kk = kk; mapView.fx = fx; mapView.fz = fz
  for (let k = 0; k < course.cps.length; k++) {
    const c = course.cps[k]
    if (c.i < i0 || c.i > i1) continue
    const gh = course.gateHalf
    const ax = SX(c.x + c.tz * gh, c.z - c.tx * gh), ay = SY(c.x + c.tz * gh, c.z - c.tx * gh)
    const bx = SX(c.x - c.tz * gh, c.z + c.tx * gh), by = SY(c.x - c.tz * gh, c.z + c.tx * gh)
    const fin = k === 0 || k === course.cps.length - 1
    g.strokeStyle = k === me.next ? '#5fe6ff' : k === me.next + 1 ? 'rgba(95,230,255,0.45)' : fin ? '#ff7a1a' : 'rgba(255,255,255,0.35)'
    g.lineWidth = k === me.next ? 5 : 3
    if (k === me.next) { g.shadowColor = '#5fe6ff'; g.shadowBlur = 12 }
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke()
    g.shadowBlur = 0
  }
  for (const r of race.racers) {
    if (!r.ai || r.p.dead) continue
    const x = SX(r.p.pos.x, r.p.pos.z), y = SY(r.p.pos.x, r.p.pos.z)
    g.fillStyle = hex(r.color)
    g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 2.5
    g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); g.stroke()
  }
  const px = SX(player.pos.x, player.pos.z), py = SY(player.pos.x, player.pos.z)
  g.translate(px, py); g.rotate(Math.PI - (player.heading - mapView.ang))
  g.shadowColor = '#ff6a1a'; g.shadowBlur = 14
  g.fillStyle = '#ff6a1a'; g.strokeStyle = '#fff'; g.lineWidth = 2.5
  g.beginPath(); g.moveTo(0, 15); g.lineTo(9, -10); g.lineTo(0, -5); g.lineTo(-9, -10); g.closePath(); g.fill(); g.stroke()
  g.restore()
  const sy = MH - 24, sx0 = 24, sx1 = MW - 24
  const span = course.finishI - course.startI
  const xAt = (i: number) => sx0 + ((Math.max(course.startI, Math.min(course.finishI, i)) - course.startI) / span) * (sx1 - sx0)
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(sx0, sy); g.lineTo(sx1, sy); g.stroke()
  g.strokeStyle = '#ff7a1a'; g.beginPath(); g.moveTo(sx0, sy); g.lineTo(xAt(me.idx), sy); g.stroke()
  for (const c of course.cps) { g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(xAt(c.i) - 1, sy - 6, 2, 12) }
  for (const r of race.racers) {
    g.fillStyle = r.ai ? hex(r.color) : '#ffffff'
    g.beginPath(); g.arc(xAt(r.idx), sy, r.ai ? 5 : 7, 0, Math.PI * 2); g.fill()
  }
}

// ───────────────────────── keys ─────────────────────────
addEventListener('keydown', (e) => {
  sound.start()
  if (e.code === 'Backquote') debugEl.style.display = debugEl.style.display === 'block' ? 'none' : 'block'
  if (e.code === 'KeyG') void import('./gui').then((g) => g.toggleGui())
  if (e.code === 'Escape' && mode !== 'title') {
    if (overlay) { overlay = false; spectate = false; $('#over').classList.add('hide'); cam.snap(player.heading); return }
    setPaused(!paused)
  }
  if (mode === 'title') {
    // Course select: ← / → on the title; a different course loads on Enter (a reload, straight into
    // the race).
    if (!$('#pause').classList.contains('hide')) { if (e.code === 'Escape') $('#p-close').click(); return }
    // Arrows turn the view round the ship (the menu is for the mouse).
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { orbitKey = e.code === 'ArrowLeft' ? 1 : -1; e.preventDefault(); return }
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { orbitKeyP = e.code === 'ArrowUp' ? 1 : -1; e.preventDefault(); return }
    if (e.code === 'Enter') menuStart()
    if (e.code === 'KeyH') { menuMode = 'hunt'; showCourse() }
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
addEventListener('mousedown', () => sound.start())
document.addEventListener('visibilitychange', () => { sound.suspend(document.hidden); last = performance.now() })
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); paused = true })
canvas.addEventListener('webglcontextrestored', () => { paused = false; last = performance.now() })

// ───────────────────────── boot ─────────────────────────
race.reset()
player.reset(course.cps[0].x - course.cps[0].tx * 60, course.cps[0].z - course.cps[0].tz * 60, Math.atan2(course.cps[0].tx, course.cps[0].tz), 0)
player.speed = 4 * MACH // the menu flight
renderPos.copy(player.pos)
camera.position.set(player.pos.x + 10, player.pos.y + 2, player.pos.z + 10)
camera.lookAt(player.pos)
world.update(camera.position, 0)
loadBar.style.width = '75%'
// Warm-up: nothing may compile or upload for the first time mid-race (a 30–100 ms hitch exactly
// at your first crash, Mach break or burner). Everything hidden — shock rings, flames, the vapour
// cone, wreckage, the walker, combat — is shown for one compile + one real frame (frustum culling
// off, so every texture and buffer uploads too), the map pipeline included, then restored.
const hidden: THREE.Object3D[] = [], culled: THREE.Object3D[] = []
scene.traverse((o) => {
  if (!o.visible) { hidden.push(o); o.visible = true }
  if (o.frustumCulled) { culled.push(o); o.frustumCulled = false }
})
const wreckCount = wreckage.mesh.count
;wreckage.mesh.count = 1
await renderer.compileAsync(scene, camera)
post.render(0.016)
renderer.setRenderTarget(mapRT); renderer.render(scene, mapCam); renderer.setRenderTarget(null)
mapQuad.render(renderer)
for (const o of hidden) o.visible = false
for (const o of culled) o.frustumCulled = true
;wreckage.mesh.count = wreckCount
renderer.clear()
post.render(0.016)
loadBar.style.width = '100%'
$('#loading').classList.add('hide')
$('#title').classList.remove('hide')
requestAnimationFrame((t) => { last = t; frame(t) })
showCourse()
// Picked a different course on the title: it has loaded — straight into the race.
try { if (sessionStorage.getItem('dbu-go')) { sessionStorage.removeItem('dbu-go'); startRace() } } catch { /* blocked */ }

// Test hooks for tools/.
const g = {
  ready: true,
  get mode() { return mode },
  start: () => startRace(),
  startHunt: () => startHunt(),
  autopilot: (on: boolean) => { autopilot = on },
  setMach: (m: number) => { player.speed = m * MACH },
  skipCountdown: () => { race.countdown = 0.01 },
  force: (c: import('./player').Controls | null) => { forced = c },
  sound,
  renderer,
  /** Put the player just before jump k, at Mach m. */
  toJump: (k: number, m = 3) => {
    const f = course.def.jumps[k] // on the line: k % 3 === 0
    const i = course.startI + Math.round(f * (course.finishI - course.startI)) - 25
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
    place: race.racers[0].place, crashing: player.crashing, burning: player.burning, slip: +(player.slip * 57.3).toFixed(1), spin: +player.spin.toFixed(2), drift: +player.drift.toFixed(2), yaw: +player.yawRate.toFixed(2), lap: race.lapOf(race.racers[0]), passed: race.racers[0].passed, race: race.state, particles: fx.glow.count + fx.smoke.count,
  }),
  player, race, course, combat, walker, CFG, world, scene, camera, post, fx, input, wreckage,
}
;(window as unknown as { __g: typeof g }).__g = g
