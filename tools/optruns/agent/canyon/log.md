# CANYON RUN — agent speedrun log

Bench: `node tools/agentrun.mjs run canyon <inputs.json>`. Generator: `gen.mjs` (in-page closed-loop pilot on a
racing line from `mkline.mjs`; records the game's own per-step inputs; every result re-checked on the bench).

| # | attempt | result |
|---|---------|--------|
| 0 | baseline `canyon-rogue-inputs.json` | NOT counted (crossed the line beside the finish gate; 14/15 gates), wall at 26 s |
| 1 | gen a1: line_g8 (min-curvature line inside floor ±(half−200), 8 natural gates held ±250), Mach cap 14, pursuit tl 0.6 | not counted: finish crossed 284 m wide, long airborne after mounds |
| 2 | gen b1/b2: finish window ±120, gate windows ±180, airborne → brake (+120 m/s² gravity) while tapping | 16.583 / 17.133 counted |
| 3 | gen b3: cap Mach 18, kr 1.8 | **14.533 counted** (bench-verified) → best.json |

---
## Restart after the burner-kick change (e907c64: kick recharges over 1.5 s off; tapping no longer stacks)
Everything above was flown with the old tap glitch; none of it is valid any more (best.json 14.533 is a tap run).

Physics notes (src/player.ts, src/race.ts):
- Burner held above the throttle target: NO 0.04/s drag at all (drag only applies `if (!thrust || speed < target)`),
  thrust 230·(1−(M/12)²). Burner off: drag 0.04·(v−6.3 Mach). Re-press kick 95·min(1, off/1.5) ≈ 63 m/s² of credit
  for off-time, so short burner-off spells for steering cost little at Mach 10+.
- The real speed limit is the turn bleed 5%/rad of nose yaw: the ring needs ~10 rad (line yaw 9.8–10.2) → pads matter
  (8 pads × 0.75 Mach; the pad add bypasses the Mach-5.88 barrier silence if it lands across it).
- Gates: only the next or next+1 gate's plane counts (|lat|<2500): the ring can't be cut; a miss costs 40% speed →
  rogue ≈ ideal here; rogue only gains the extra width between gates (worth ~0).
- Mounds are Gaussians h·exp(−d²/r²); launch when (slope−slopeAhead)·v > 45+0.05v → keep ~0.9–1.2 r off their centre.
  Diagonal terrain crests (crest.json) also launch: mound 3 must be passed on the + side (the − side sits on a ridge).

| # | attempt | result |
|---|---------|--------|
| 10 | gen2.mjs rule pilot (burner only when the turn fits its 10%): burner almost never on | 29.5–31 s |
| 11 | gen2 PWM: burner on while |ω| < bk·10%·turnMax, bk 2..8 | 24.9 s (bk 8, minOn/Off 4), 5–6/8 pads |
| 12 | mpc.mjs (savestates: every 0.1 s try burner on/off × aim ±60 m, 1 s horizon, rule controller after) on Lr_m-1 | 27.18, 1 miss (crest launch at mound 3 − side) |
| 13 | lines with pad windows + mound windows + crest avoidance (CREST 0.055) → Lr_k0.055 / Li_k0.055 | mpc q1 23.733, 0 missed, no air |
| 14 | mpc q2: 5 aims (±80, ±30, 0) × burner, 1.5 s horizon, rogue line | **23.100 counted** (bench), 0 missed → best.json |
| 15 | mpc q3: ideal line (±240 band), lateral penalty past 250 | **23.833 counted** (bench), 0 missed, trace max |lat| 232 → ideal.json |
| 16 | mpc variants on rogue line (scoring by time-to-go, Wv 4, bk 5/12, tl .35, minOn 8, D 4) | 23.20–23.77: plateau (yaw ≈ 9.2–9.6 rad, burner duty ~0.7, 7–8 pads) |
| — | RULE CHANGE: IDEAL must be human-drivable (strafe 0, no dodge, key runs ≥ 6 steps, ≤ 265 m) | old ideal (strafe) set aside as old-ideal-strafe-23.833.json |
| 17 | mpc ideal, ks 0, aims ±20/±60, burner fixed per 6-step block (so every press/release ≥ 6 steps), latLim 245 | **24.150 counted** (bench), 0 missed, human.ok true, trace max |lat| 220 (in-sim every step 243) → ideal.json |
| 18 | ideal variants (bk 5; H 90) | 24.18 / 24.52: no gain |
| 19 | rogue mpc 5 aims + minOn 8 / minOff 2 | **23.067 counted** (bench), 0 missed → best.json |

Final: ROGUE best.json 23.067 (m-v1), IDEAL ideal.json 24.150 (m-i2, human.ok). Regenerate: `node mpc.mjs <cfg.json>`
(configs are inside each m-*.json `cfg`), lines from mkline2.mjs (PADZ/mound/CREST zones above).
Where the time is: speed tops out ~Mach 11.8. Turn bleed (5%/rad × ~9.3 rad of nose yaw) roughly matches burner thrust +
8 pads; the burner is on ~70% (its 10% steering can't hold the ring's curvature). Start to Mach 6 takes ~3 s.
