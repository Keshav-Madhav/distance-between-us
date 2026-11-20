# Tech

- **Stack:** Vite 8 + TypeScript (strict) + three r187. Fonts are Chakra Petch (OFL, via
  fontsource) and lil-gui (lazy-loaded). All audio is synthesized with Web Audio; there are no
  audio files.
- **Renderer: WebGL2, not WebGPU/TSL.** A deliberate choice for the POC: the post chain (bloom +
  one custom final pass), reversed-Z, MSAA render targets and the shader-patching approach are proven
  in the TITANS project on r187 WebGL. WebGPU would be a later port, not a prerequisite.
- **Sim:** a fixed 60 Hz step with prev/pos interpolation for the craft, drones, missiles, shots and
  cores, so nothing judders against the camera at 2 km/s. Particles are visual only and simulate at
  render dt.
- **Endless world, float-safe:** every pattern repeats every 12 km (integer wave numbers). The world
  rebases by 36 km when you stray, so float32 never degrades. Mesas and boulders are CPU-wrapped
  (they collide). Pebbles are wrapped in the vertex shader.
- **Terrain:** one height formula in JS (hover and collision) and GLSL (displacement). Three rings
  (12.5 m / 60 m / 400 m spacing), each snapped to its own grid. Normals come from finite differences
  in the fragment shader. Generated textures are sampled at two rotated scales so the repeat doesn't
  show.
- **Post:** HDR half-float MSAA scene, then UnrealBloom (its bright-pass input is NaN-sanitized and
  clamped), then one final pass: radial blur that keeps the centre sharp (r² weighting, 12 jittered
  taps), edge chromatic fringing, speed streaks, heat haze, ACES, a hot grade, tunnel vignette,
  white-out, damage edge, grain.
- **Draw calls:** about 50 cruising and about 80 at the Walker peak. Particles are two instanced
  draws (2,600 additive + 3,200 alpha), pooled, with no per-particle allocation.
- **Quality tiers:** low/medium/high/ultra (pixel ratio, MSAA, bloom, particle density). Auto
  starts on high, then dynamic resolution (0.5–1×) holds 60 fps and drops a tier if that isn't
  enough. `?q=low` etc. forces a tier; `?fixed` disables the governor.
- **Assets:** textures come from Gemini (`tools/generate-asset.mjs`, model in `tools/gen.config.json`,
  key in the gitignored `.env`). `tools/process-textures.mjs` makes them seamless (the rock only
  horizontally, then mirror-wrapped vertically), checks the tiling and writes power-of-two JPEGs to
  `public/tex`. KTX2 is pending: there's no `toktx`/`basisu` on this machine yet.
- **Budgets (POC):** 60 fps locked on an M-series laptop at high. First load is about 4.2 MB (JS
  700 KB raw, textures 2.4 MB).
- **Hooks:** `window.__g` (start, autopilot, setMach, spawnWalker, walkerNear, killCores, stats).
  `tools/shot.mjs` drives headless Chrome for screenshots and frame-time sampling.
