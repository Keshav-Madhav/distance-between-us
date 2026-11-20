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

**Controls:** W/Shift boost · A/D steer · Q/E strafe (double-tap to dodge) · Space fire (lock first)
· S air brake · Esc settings · ` debug · G feel GUI. Gamepad: RT boost, LT brake, stick, A fire.

Docs: `docs/DESIGN.md`, `docs/TECH.md`, `docs/ART_STYLE.md`, `docs/PERF_LOG.md`.

## Regenerating textures (paid: Gemini)
Put `GEMINI_API_KEY=...` in `.env` (gitignored, never bundled). Then run
`node tools/generate-asset.mjs <name> <preset> <aspect> <size> "<request>"` (the prompts are in each
`assets/raw/*.json`), followed by `node tools/process-textures.mjs`.

Credits: see `CREDITS.md`.
