// Dev only: the three ship silhouettes side by side, for judging the model. /showroom.html?view=N
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { Craft } from './craft'
import { SUN_DIR } from './terrain'

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(2, devicePixelRatio))
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
document.body.appendChild(renderer.domElement)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x9fc3e8)
const pm = new THREE.PMREMGenerator(renderer)
const env = pm.fromScene(new RoomEnvironment(), 0.04).texture
const sun = new THREE.DirectionalLight(0xfff1dd, 3.2)
sun.position.set(SUN_DIR[0] * 50, SUN_DIR[1] * 50, SUN_DIR[2] * 50)
scene.add(sun, new THREE.HemisphereLight(0xbfd8ff, 0xb07a4a, 1.1))
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0xc08a5a, roughness: 1 }))
ground.rotation.x = -Math.PI / 2
ground.position.y = -0.6
scene.add(ground)
const paints = [
  { body: 0x16324a, trim: 0x29d3ff, number: '88' },
  { body: 0xe9e2d6, trim: 0xff8a3d, number: '52' },
  { body: 0x1e1630, trim: 0xa96bff, number: '19' },
  { body: 0xeef1f4, trim: 0xff5a14, number: '07' },
  { body: 0x1b1d24, trim: 0xff3fa4, number: '11' },
  { body: 0xf2f2ea, trim: 0x5fe02a, number: '23' },
]
// Row 1 (front): the classics 0–2; row 2 (behind): the lofted 3–5. ?only=N shows one, centred.
const only = new URLSearchParams(location.search).get('only')
const crafts = (only ? [+only] : [0, 1, 2, 3, 4, 5]).map((v) => {
  const c = new Craft(env, paints[v], v)
  c.root.position.set(only ? 0 : ((v % 3) - 1) * 9, 0, only ? 0 : v < 3 ? 7 : -7)
  c.setFlames(0.6, 0, 0)
  scene.add(c.root)
  return c
})
void crafts
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 500)
const views: [number, number, number, number, number, number][] = [
  [7, 3.2, 9, 0, 0.7, 0], // 5: close three-quarter (with ?only=N)
  [-6, 2.6, -9, 0, 0.7, -1], // 6: close rear
  [18, 10, 26, 0, 0.6, 0], // three-quarter front
  [-16, 8, -28, 0, 0.6, 0], // three-quarter rear
  [0, 22, 0.01, 0, 0, 0], // top
  [24, 1.2, 0, 0, 0.6, 0], // side
  [0, 2.4, 22, 0, 0.6, 0], // front
  [-10, 2.2, -2, 0, 1.0, -2.5], // 7: close left side, aft
  [10, 2.2, -2, 0, 1.0, -2.5], // 8: close right side, aft
]
const view = views[+(new URLSearchParams(location.search).get('view') ?? 0)]
camera.position.set(view[0], view[1], view[2])
camera.lookAt(view[3], view[4], view[5])
renderer.render(scene, camera)
;(window as unknown as { ready: boolean }).ready = true
