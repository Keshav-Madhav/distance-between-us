// Post: scene (HDR, multisampled) → bloom (half res) → one final pass that does the speed:
// radial motion blur that leaves the centre sharp, chromatic fringing at the edges, speed streaks,
// tunnel-vision vignette, the Mach 6 white-out, damage flash, heat haze, ACES, a hot desert grade,
// grain. One full-screen read for all of it.
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { CFG } from './config'
import { NOISE_TEX } from './shaders'
import { BIOME } from './terrain'

/** A grade per world: shadow tint, highlight tint, saturation, black lift. */
const GRADE = BIOME === 'ice'
  ? { sh: 'vec3(0.85, 0.95, 1.15)', hi: 'vec3(1.0, 0.98, 1.04)', sat: '1.05', lift: '0.0' }
  : BIOME === 'forest'
    ? { sh: 'vec3(0.9, 0.98, 1.06)', hi: 'vec3(1.05, 1.02, 0.93)', sat: '1.1', lift: '0.0' }
  : BIOME === 'lava'
    ? { sh: 'vec3(0.75, 0.82, 1.02)', hi: 'vec3(1.12, 0.95, 0.8)', sat: '1.22', lift: '-0.02' }
    : { sh: 'vec3(0.92, 0.98, 1.1)', hi: 'vec3(1.05, 1.0, 0.94)', sat: '1.12', lift: '0.0' }

const FINAL = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSpeed: { value: 0 },
    uBlur: { value: 0 },
    uAberr: { value: 0 },
    uStreak: { value: 0 },
    uStreakT: { value: 0 },
    uWhite: { value: 0 },
    uDamage: { value: 0 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uExposure: { value: 1 },
    uGrain: { value: 0.03 },
    uCenter: { value: new THREE.Vector2(0.5, 0.52) },
    uSharpen: { value: 0.35 },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    // Engine heat: three nozzles in screen uv (xy) with a plume radius (z), the exhaust's screen
    // direction, and a strength (0 off).
    uJet: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uJetDir: { value: new THREE.Vector2(0, -1) },
    uJetK: { value: 0 },
    tNoise: { value: NOISE_TEX },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSpeed, uBlur, uAberr, uStreak, uStreakT, uWhite, uDamage, uTime, uAspect, uExposure, uGrain, uSharpen;
    uniform vec2 uTexel;
    uniform vec2 uCenter;
    uniform vec3 uJet[3];
    uniform vec2 uJetDir;
    uniform float uJetK;
    uniform sampler2D tNoise;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    vec3 aces(vec3 x) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }
    vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    void main() {
      vec2 d = vUv - uCenter;
      vec2 da = d; da.x *= uAspect;
      float r = length(da);
      // Heat haze: a shimmer low in the frame (the hot ground), calmer at speed.
      vec2 uv = vUv;
      float haze = (1.0 - smoothstep(0.0, 0.42, vUv.y)) * (1.0 - 0.6 * uSpeed);
      uv.x += haze * 0.0016 * sin(vUv.y * 160.0 + uTime * 9.0) * sin(vUv.x * 40.0 - uTime * 3.0);
      // Engine heat: the air behind each nozzle wobbles (a plume that widens and fades with length).
      if (uJetK > 0.0) {
        float acc = 0.0;
        vec2 dir = normalize(uJetDir), perp = vec2(-dir.y, dir.x);
        for (int i = 0; i < 3; i++) {
          vec2 q = vUv - uJet[i].xy; q.x *= uAspect;
          float R = uJet[i].z, L = R * 9.0;
          float al = dot(q, dir), ac = dot(q, perp);
          if (al > -R && al < L) {
            float w = R * (1.0 + max(al, 0.0) / L * 2.5);
            acc += (1.0 - smoothstep(0.0, L, al)) * smoothstep(-R, 0.0, al) * exp(-(ac * ac) / (w * w));
          }
        }
        if (acc > 0.001) {
          vec2 nq = vUv * vec2(uAspect, 1.0) * 26.0 - dir * uTime * 9.0;
          vec2 wob = vec2(texture2D(tNoise, nq * 0.125).r, texture2D(tNoise, nq * 0.125 + 0.37).r) - 0.47;
          uv += wob * 0.012 * min(acc, 1.5) * uJetK;
        }
      }

      // Radial blur: strength grows with r², so the middle (where you aim) stays sharp.
      float amt = uBlur * smoothstep(0.16, 0.85, r) * r;
      // (Cost: the old loop read 36 texels a pixel at full Retina resolution. Now the middle, where
      // there is no blur, reads 3; the edges read 8 for the blur + 2 for the fringe.)
      vec2 ca = d * uAberr * r * 2.0;
      vec3 c;
      if (amt < 0.0012) {
        c = vec3(texture2D(tDiffuse, uv + ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - ca).b);
      } else {
        c = vec3(0.0);
        float wsum = 0.0;
        float j = hash(gl_FragCoord.xy + fract(uTime) * 61.0);
        for (int i = 0; i < 8; i++) {
          float t = (float(i) + j) / 8.0;
          float w = 1.0 - t * 0.5;
          vec3 sm = texture2D(tDiffuse, uv - d * amt * t).rgb;
          if (any(isnan(sm)) || any(isinf(sm))) continue;
          c += sm * w;
          wsum += w;
        }
        c /= max(wsum, 1e-4);
        // The fringe: red and blue pulled apart once, on top of the blur.
        vec2 rb = vec2(texture2D(tDiffuse, uv - d * amt * 0.5 + ca).r, texture2D(tDiffuse, uv - d * amt * 0.5 - ca).b);
        if (!(any(isnan(rb)) || any(isinf(rb)))) { c.r = mix(c.r, rb.x, 0.6); c.b = mix(c.b, rb.y, 0.6); }
      }
      // Sharpen (contrast-adaptive, in a reversible tone curve so HDR highlights don't ring), weakest
      // where the motion blur is working — the centre stays crisp, the edges stay smooth.
      if (uSharpen > 0.001) {
        vec3 e = c / (1.0 + c);
        vec3 nb = texture2D(tDiffuse, uv + vec2(0.0, -uTexel.y)).rgb; nb /= 1.0 + nb;
        vec3 nd = texture2D(tDiffuse, uv + vec2(-uTexel.x, 0.0)).rgb; nd /= 1.0 + nd;
        vec3 nf = texture2D(tDiffuse, uv + vec2(uTexel.x, 0.0)).rgb; nf /= 1.0 + nf;
        vec3 nh = texture2D(tDiffuse, uv + vec2(0.0, uTexel.y)).rgb; nh /= 1.0 + nh;
        vec3 mn = min(min(nb, nd), min(nf, nh)), mx = max(max(nb, nd), max(nf, nh));
        vec3 amp = clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0);
        float w = -0.2 * uSharpen * (1.0 - smoothstep(0.0, 0.03, amt)) * dot(sqrt(amp), vec3(0.333));
        vec3 sh = clamp((e + (nb + nd + nf + nh) * w) / (1.0 + 4.0 * w), 0.0, 0.999);
        c = sh / (1.0 - sh);
      }
      // (A NaN anywhere upstream must never show as black: take an unblurred neighbour instead.)
      if (any(isnan(c)) || any(isinf(c))) {
        c = texture2D(tDiffuse, vUv + uTexel * 3.0).rgb;
        if (any(isnan(c)) || any(isinf(c))) c = texture2D(tDiffuse, vUv - uTexel * 3.0).rgb;
        if (any(isnan(c)) || any(isinf(c))) c = vec3(0.4, 0.3, 0.25);
      }

      // Speed streaks: pale spokes flowing outward at the edges of the view.
      if (uStreak > 0.004) {
        float sa = atan(da.y, da.x);
        float lanes = 200.0;
        float lane = floor((sa / 6.2831853 + 0.5) * lanes);
        float lh = fract(sin(lane * 91.17) * 4373.13);
        float across = abs(fract((sa / 6.2831853 + 0.5) * lanes) - 0.5) * 2.0;
        float thin = 1.0 - smoothstep(0.0, mix(0.2, 0.5, uStreak), across);
        float run = fract(r * (1.2 + lh * 1.8) - uStreakT * (0.7 + lh) + lh * 7.0);
        float dash = smoothstep(0.0, 0.06, run) * (1.0 - smoothstep(0.2 + 0.3 * lh, 0.55 + 0.3 * lh, run));
        float on = step(1.0 - mix(0.15, 0.6, uStreak), lh);
        float edge = smoothstep(mix(0.5, 0.35, uStreak), 0.95, r);
        // (Mostly below the horizon, where the ground rushes: across the sky they were clutter.)
        edge *= mix(0.35, 1.0, smoothstep(-0.1, 0.15, -da.y));
        float sk = thin * dash * on * edge * uStreak;
        c = mix(c, c * 1.6 + vec3(0.25, 0.27, 0.3), clamp(sk, 0.0, 0.7));
      }

      c *= uExposure;
      // White-hot: the barrier. Floods from the centre outward.
      // (Edges only, the middle kept: a full-screen white-out was a flash-bang.)
      c = mix(c, c * 1.6 + vec3(1.2, 1.1, 1.0), uWhite * smoothstep(0.12, 0.85, r));
      c = aces(c);
      // Grade: punchy, saturated, warm highlights, a cool lift in the shadows.
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, ${GRADE.sat});
      c *= mix(${GRADE.sh}, ${GRADE.hi}, smoothstep(0.1, 0.8, l));
      c += ${GRADE.lift};
      c = clamp(c, 0.0, 1.0);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.25);
      // Tunnel vision: the vignette closes in with speed.
      c *= 1.0 - mix(0.22, 0.6, uSpeed * uSpeed) * smoothstep(mix(0.55, 0.32, uSpeed), 1.1, r);
      // Hurt: red at the edges.
      c = mix(c, vec3(0.9, 0.05, 0.02), uDamage * smoothstep(0.3, 0.95, r) * 0.75);
      c = toSrgb(clamp(c, 0.0, 1.0));
      c += (hash(gl_FragCoord.xy + floor(fract(uTime * 7.13) * 97.0)) - 0.5) * uGrain;
      gl_FragColor = vec4(c, 1.0);
    }`,
}

export class Post {
  readonly composer: EffectComposer
  readonly bloom: UnrealBloomPass
  readonly final: ShaderPass
  private readonly target: THREE.WebGLRenderTarget

  constructor(readonly renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, samples: number) {
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples })
    this.composer = new EffectComposer(renderer, this.target)
    this.composer.addPass(new RenderPass(scene, camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), CFG.post.bloom, 0.55, CFG.post.bloomThreshold)
    // (Bloom's blur spreads one NaN/inf pixel over the whole frame — a black screen. Its bright-pass
    // input is sanitised and clamped, which also tames fireflies.)
    const hp = this.bloom.materialHighPassFilter
    hp.fragmentShader = hp.fragmentShader.replace(
      'vec4 texel = texture2D( tDiffuse, vUv );',
      'vec4 texel = texture2D( tDiffuse, vUv ); if (any(isnan(texel)) || any(isinf(texel))) texel = vec4(0.0); texel.rgb = min(texel.rgb, vec3(40.0));',
    )
    hp.needsUpdate = true
    this.composer.addPass(this.bloom)
    this.final = new ShaderPass(FINAL)
    this.composer.addPass(this.final)
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio)
    this.composer.setSize(w, h)
    // Bloom is soft by nature: computed at half resolution (a quarter of the pixels).
    this.bloom.setSize(Math.max(1, Math.round((w * pixelRatio) / 2)), Math.max(1, Math.round((h * pixelRatio) / 2)))
    this.final.uniforms.uAspect.value = w / h
    this.final.uniforms.uTexel.value.set(1 / (w * pixelRatio), 1 / (h * pixelRatio))
  }

  setSamples(n: number): void { this.target.samples = n }

  render(dt: number): void { this.composer.render(dt) }
  /** Every material the passes use (for compiling them ahead of the first frame, off the hitch). */
  materials(): THREE.Material[] {
    const out = new Set<THREE.Material>()
    const take = (v: unknown) => { if (v instanceof THREE.Material) out.add(v); else if (Array.isArray(v)) for (const x of v) if (x instanceof THREE.Material) out.add(x) }
    for (const pass of this.composer.passes) for (const v of Object.values(pass)) take(v)
    return [...out]
  }
}
