// Sun shadows: two maps that follow the camera — a near one (±180 m: the craft, rivals, gate towers,
// trackside trees, in detail) and a far one (±2.6 km: mesas, glaciers, domes, groves). Casters are
// the objects on layer 2 (solid meshes only); they are drawn with one override material that writes
// each point's height along the sun into a float target. A receiver is in shadow when something
// stored there stands higher along the sun than it does. Sampled with a small soft filter by the
// ground shader and by the patched standard materials (SHADOW_GLSL + SHADOW_U).
import * as THREE from 'three'
import { SUN_DIR } from './terrain'

export const CASTER_LAYER = 2

const SUN = new THREE.Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]).normalize()
// Light-space axes: right and up across the map (any pair perpendicular to the sun).
const RIGHT = new THREE.Vector3().crossVectors(SUN, Math.abs(SUN.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize()
const UPV = new THREE.Vector3().crossVectors(RIGHT, SUN).normalize()

/** Stored values are offset so a cleared texel (0) means "nothing here". */
const OFF = 20000

export const SHADOW_U = {
  tSh0: { value: null as THREE.Texture | null },
  tSh1: { value: null as THREE.Texture | null },
  uShC0: { value: new THREE.Vector3() },
  uShC1: { value: new THREE.Vector3() },
  /** Half-sizes of the two maps (m), texel sizes. */
  uShS: { value: new THREE.Vector4(180, 2600, 360 / 1024, 5200 / 2048) },
  uShOn: { value: 0 },
}

export const SHADOW_GLSL = /* glsl */ `
uniform sampler2D tSh0;
uniform sampler2D tSh1;
uniform vec3 uShC0;
uniform vec3 uShC1;
uniform vec4 uShS;
uniform float uShOn;
const vec3 SH_SUN = vec3(${SUN.x.toFixed(5)}, ${SUN.y.toFixed(5)}, ${SUN.z.toFixed(5)});
const vec3 SH_R = vec3(${(-RIGHT.x).toFixed(5)}, ${(-RIGHT.y).toFixed(5)}, ${(-RIGHT.z).toFixed(5)}); // the camera's x: up × sun
const vec3 SH_U = vec3(${UPV.x.toFixed(5)}, ${UPV.y.toFixed(5)}, ${UPV.z.toFixed(5)});
float shTap(sampler2D t, vec2 uv, float d, float bias) {
  float s = texture2D(t, uv).r;
  return (s > 0.5 && s - ${OFF.toFixed(1)} > d + bias) ? 0.0 : 1.0;
}
float shMap(sampler2D t, vec3 c, float hs, float texel, vec3 w, float bias) {
  vec3 r = w - c;
  vec2 uv = vec2(dot(r, SH_R), dot(r, SH_U)) / (2.0 * hs) + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -1.0;
  float d = dot(r, SH_SUN);
  // Bilinear-weighted comparisons over a 3×3 block of texels (a soft edge, never a stair-step).
  float n = 2.0 * hs / texel;
  vec2 st = uv * n - 0.5;
  vec2 f = fract(st), b0 = (floor(st) + 0.5) / n;
  float s = 0.0;
  for (int j = -1; j <= 2; j++) for (int i = -1; i <= 2; i++) {
    float wx = i == -1 ? 1.0 - f.x : i == 2 ? f.x : 1.0;
    float wy = j == -1 ? 1.0 - f.y : j == 2 ? f.y : 1.0;
    s += wx * wy * shTap(t, b0 + vec2(float(i), float(j)) / n, d, bias);
  }
  s /= 9.0;
  // Fade at the map's edge (no hard line where it ends).
  vec2 e = min(uv, 1.0 - uv);
  return mix(1.0, s, smoothstep(0.0, 0.06, min(e.x, e.y)));
}
/** 1 lit … 0 in full shadow. */
float sunShadow(vec3 w) {
  if (uShOn < 0.5) return 1.0;
  float a = shMap(tSh0, uShC0, uShS.x, uShS.z, w, 0.35);
  if (a >= 0.0) return a;
  float b = shMap(tSh1, uShC1, uShS.y, uShS.w, w, 3.0);
  return b >= 0.0 ? b : 1.0;
}
`

export class SunShadow {
  private readonly rt: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget]
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 30000)
  private readonly mat: THREE.ShaderMaterial
  private readonly centre = new THREE.Vector3()
  private frame = 0
  private readonly cc = new THREE.Color()
  private readonly c = new THREE.Vector3()
  private readonly f = new THREE.Vector3()
  enabled = true
  constructor() {
    const mk = (n: number) => new THREE.WebGLRenderTarget(n, n, { type: THREE.FloatType, format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true })
    this.rt = [mk(1024), mk(2048)]
    SHADOW_U.tSh0.value = this.rt[0].texture
    SHADOW_U.tSh1.value = this.rt[1].texture
    this.cam.layers.set(CASTER_LAYER)
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uC: { value: this.centre } },
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        uniform vec3 uC;
        varying float vD;
        void main() {
          vec4 p = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            p = instanceMatrix * p;
          #endif
          vec4 w = modelMatrix * p;
          vD = dot(w.xyz - uC, vec3(${SUN.x.toFixed(5)}, ${SUN.y.toFixed(5)}, ${SUN.z.toFixed(5)}));
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        varying float vD;
        void main() { gl_FragColor = vec4(vD + ${OFF.toFixed(1)}, 0.0, 0.0, 1.0); }`,
    })
    this.mat.toneMapped = false
  }

  /** Re-render the maps around the camera (near every frame, far every other frame). */
  /** `far`: redraw the far map this frame (every other frame; the caller picks the parity, so it never
   *  lands on the same frame as the other every-other-frame work — the minimap's redraw). */
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camPos: THREE.Vector3, fwd: THREE.Vector3, far = this.frame % 2 === 1): void {
    SHADOW_U.uShOn.value = this.enabled ? 1 : 0
    if (!this.enabled) return
    this.frame++
    const prevRT = renderer.getRenderTarget(), prevOv = scene.overrideMaterial
    const cc = this.cc; renderer.getClearColor(cc); const ca = renderer.getClearAlpha()
    const auto = renderer.autoClear
    renderer.autoClear = true
    renderer.setClearColor(0x000000, 0)
    scene.overrideMaterial = this.mat
    for (let k = 0; k < 2; k++) {
      if (k === 1 && !far) continue
      const half = k === 0 ? 180 : 2600
      const texel = (2 * half) / (k === 0 ? 1024 : 2048)
      // Centred a little ahead of the camera, snapped to whole texels in light space (no shimmer).
      const c = this.c.copy(camPos).addScaledVector(this.f.set(fwd.x, 0, fwd.z).normalize(), half * 0.45)
      const sr = Math.round(c.dot(RIGHT) / texel) * texel, su = Math.round(c.dot(UPV) / texel) * texel, sd = c.dot(SUN)
      c.copy(RIGHT).multiplyScalar(sr).addScaledVector(UPV, su).addScaledVector(SUN, sd)
      ;(k === 0 ? SHADOW_U.uShC0.value : SHADOW_U.uShC1.value).copy(c)
      this.centre.copy(c)
      const cam = this.cam
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half
      cam.near = 1; cam.far = 16000
      cam.position.copy(c).addScaledVector(SUN, 8000)
      cam.up.copy(UPV)
      cam.lookAt(c)
      cam.updateProjectionMatrix()
      cam.updateMatrixWorld()
      renderer.setRenderTarget(this.rt[k])
      renderer.clear()
      renderer.render(scene, cam)
    }
    scene.overrideMaterial = prevOv
    renderer.setRenderTarget(prevRT)
    renderer.setClearColor(cc, ca)
    renderer.autoClear = auto
  }
}

/** Mark the solid meshes under `root` as shadow casters. */
export function markCasters(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
    if (!m || Array.isArray(m)) return
    if (m.transparent || m.blending !== THREE.NormalBlending || (m as THREE.ShaderMaterial).isShaderMaterial) return
    // (A mesh with its own shadow stand-in: src/lod.ts, the refined close-up form.)
    if (o.userData.noCast) return
    o.layers.enable(CASTER_LAYER)
  })
}
