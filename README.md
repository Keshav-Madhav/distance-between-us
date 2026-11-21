# The Distance Between Us — POC

*Games never feel fast enough, so I'm making this.* A hover-racer screaming across an endless red
desert at Mach 6, with dogfights at speed and a 360 m walker to take down. Three.js, all in the
browser.

```
npm install
npm run dev          # http://localhost:5417
npm run build && npm run preview   # http://localhost:4417
node tools/shot.mjs  # screenshots + frame times into shots/ (needs the preview running)
```

**Modes:** Race (Enter): a 130 km sprint against nine AI rivals, with gates, rock spires, jumps and
boost pads. Hunt (H): waves of drones, runners to chase down, and the walker after wave 3.

**Controls:** W/Shift boost (hold it as the lights go for a perfect start) · A/D steer · Q/E strafe
(double-tap to dodge) · S air brake, or dive in the air · R back to the last gate · Space fire (Hunt)
· Esc settings (FOV, quality, volume) · ` debug · G feel GUI. Gamepad: RT boost, LT brake, stick, A
fire.

`node tools/race.mjs` drives a race with the autopilot and screenshots it. `node tools/shot.mjs`
does the same for Hunt.

Docs: `docs/DESIGN.md`, `docs/TECH.md`, `docs/ART_STYLE.md`, `docs/PERF_LOG.md`.

## Regenerating textures (paid: Gemini)
Put `GEMINI_API_KEY=...` in `.env` (gitignored, never bundled). Then run
`node tools/generate-asset.mjs <name> <preset> <aspect> <size> "<request>"` (the prompts are in each
`assets/raw/*.json`), followed by `node tools/process-textures.mjs`.

Credits: see `CREDITS.md`.
