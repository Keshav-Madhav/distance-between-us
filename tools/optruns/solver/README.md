# Solver

One command that, given a course and a mode, produces the fastest run it can find under that mode's rules,
verified by the bench (`tools/agentrun.mjs`), with no hand tuning.

```
cd ~/Repositories/distance-between-us
node tools/optruns/solver/solve.mjs <course> <rogue|ideal> [budget-seconds=900; all.sh uses 600] [--force] [--no-mpc] [--only v1,v2]
tools/optruns/solver/all.sh [courses…]          # every race course, both modes, resumable
node tools/optruns/solver/table.mjs              # the saved runs as a table
```

- Output: `tools/optruns/solver/runs/<course>-<mode>.json` — `{course, mode, valid, time (bench), missed, maxLat
  (every step, m), humanOk, variant, prm (the full parameter set), inpage, sec, steps}`. `steps` is the bench's input
  format (`node tools/agentrun.mjs run <course> runs/<course>-<mode>.json` replays it). A new result replaces a saved
  one only if the saved one is invalid or slower (or with `--force`).
- stdout: one JSON line `{course, mode, valid, time, missed, maxLat, benchTraceLat, humanOk, counted, variant, sec,
  written}`; progress goes to stderr. Exit code 0 = a valid run was found.
- Requires the game served on port 4480 (`PORT` to override). Never starts a server. One browser at a time: the
  solver's own browser is closed before the bench launches its own; before every launch it waits (60 s sleeps)
  while the 1-minute load average is above 90.

## Modes (as the bench judges them)

- **rogue** — must be `counted` (finished through the finish gate). Everything else is allowed: strafe, leaving the
  track, missing gates (the solver still penalises misses in its search — each costs 40 % of your speed).
- **ideal** — counted, `missedGates` 0, bench `human.ok` (strafe 0, no dodge flags, every key held/released ≥ 6
  steps), and the craft within 265 m of the centreline at EVERY step. The lateral is measured per step in the sim
  exactly as the bench measures it (racer index, centreline tangent); the solver demands ≤ 262 m in-page and the
  savestate planner treats > 255 m as a hard penalty.

## How it works

1. **Warm-up exactly as the bench** (`makePD` sweep from `tools/pdcore.js`, then `replayWith([0,0,1])`,
   `skipCountdown`). Every run restarts the race from the grid and resets the CANYON gorge's nearest-row hint
   (it lives outside `g.snap()`), so many runs in one page reproduce a fresh page (checked) and the bench
   (in-page time = bench time on every run checked). Steps 0/1 are `[0,0,1]`, `[0,0,0]`; steer/strafe are
   `Math.fround`ed before they are fed, so the bench's float32 replay is identical.
2. **Survey** (`core.js survey`): `world.near` swept along the course — every spire/rock/mesa the collision code
   sees (gorge walls excluded: they are handled as bounds). Optional mounds (height ≥ 10) as soft obstacles.
3. **Bounds** (`core.js bounds`): per course index, the lateral range allowed — the gorge floor minus `wallM` on
   CANYON-type courses (canyon, icecave, magma, whitewater) and the IDEAL corridor `±corr`.
4. **Plan** (`core.js plan`, from agent/ctl.mjs + the sprint/oval/caldera fixes): a DP over one crossing offset per
   node — every gate, every boost pad *per pass* (multi-lap courses: each lap's pass is its own node — the old
   controllers planned a pad only once), and centreline "mid" nodes every `mid` points (`midH` in hairpins) —
   minimising length + `lam`·bend² + `lam1`·bend + `lamK`·bend²/leg-length (a curvature cost: a per-node cost can't
   widen a hairpin) + obstacle-proximity penalties. Legs, corridor samples (every 150 m) and the arc-rounded corners
   (radius `Rc`) that hit an obstacle or leave the bounds are forbidden. If no path exists it relaxes in order:
   drop a pad node, drop a mid node, halve that corner's radius. After the DP the arcs **actually flown** are
   re-checked (the shared ctl shrank arcs after checking them — a bug) and bad corners get their radius halved
   until clean. If the planner still fails, the run is retried with looser clearances (`RELAX` in solve.mjs).
5. **Track** (`core.js run`): predictive pure pursuit on the route (look-ahead `la`·v, prediction `tp`), with a
   **windowed projection** (−1.5 km…+6 km of the current position — a global projection snapped onto a later lap),
   pad aiming (`padT`), the IDEAL target `guard`, and the burner either duty-cycled (`duty`: average turn matches
   the ask) or thresholded (`burnNeed`). A **speed limit** from the route curvature and the game's grip formula with
   a braking curve (`omg`) drops the burner near hairpins and brakes over it. ROGUE strafes into the turn
   (`strafe`, the main ROGUE speed trick). IDEAL runs every key through a hold filter (≥ 6 steps) and never strafes.
6. **Savestate planner (MPC)** on top of the tracker: every `D` steps, from `g.snap()` (+ the gorge hint + the
   controller's own state), try each candidate — burner {rule, on, off} × aim offset — for `D` steps, then the plain
   tracker to horizon `H`; score = route progress (m) + `Wv`·speed (or finish time), minus penalties (crash 1e7,
   missed gate 1e6, spin 1e3, hull loss ×100, IDEAL lateral > 255 m 1e6, and a soft `latW` per m beyond `latSoft`); commit the best block.
7. **Sweep** (solve.mjs): (a) 9–10 variant families merged from the controllers that set the known bests
   (`cal` CALDERA, `oval` OVAL, `spr` SPRINT, `mis` MISTRIVER, + a `safe` one), plain tracker each (~1–3 s);
   (b) deterministic jitter around the best three until 30 % of the budget is spent (results are chaotic in the
   parameters, so a sweep beats a single config); (c) MPC on the best three seeds × two MPC configs, as the budget
   allows (each ≈ 20–130 s); (d) the bench judges candidates best-first until one is valid for the mode.

## Parameters (core.js `run(prm)`; families/jitter in solve.mjs)

Planner: `W` gate half-window (gateHalf−40), `Wf` finish half-window (250), `Wc` how far a corner may cut past a
gate (gateHalf−10), `du` offset grid (20 m), `pads` plan pads, `padW` (20) half-window across a pad, `padCut`,
`mid` (30, 0 = none) / `midH` (hairpins) spacing of centreline nodes in course points, `midW` (200) their
half-window, `midCut`, `lam` (10000) bend², `lam1` bend, `lamK` bend²/length, `Rc` corner radius (4000),
`mgPlan`/`mgSmall` clearance for big/small obstacles (100/50, soft, `pen` 30 per m), `hard` (12) hard clearance,
`mounds` (0 = ignore; × mound radius as an obstacle), `moundMinH` (10), `corr` IDEAL corridor (220), `wallM`
gorge wall margin (150).
Tracker: `la` (0.18) look-ahead s, `laMin` (150 m), `kp` (2), `tp` (0.12 s) prediction, `sideAware` (strip this
fraction of the side-slip from the velocity heading), `padT` (0.3 s) / `padAimMin` (120 m), `guard` (IDEAL: aim
point within this many m of the centreline), `duty` + `smax` (0.95) / `dutyMin`, else `burnNeed` (0.2) +
`burnErr` (burn only within this many m of the route), `vmax` (Mach cap, 40), `omg` (speed limit on) + `gf` (grip
fraction 0.95) / `kW` (curvature window, 15 × 20 m) / `bEff` (braking 0.25) / `nbTol` (burner off within this of the
limit, 300 m/s) / `vTol`, `strafe` (ROGUE: strafe amount into the turn) / `turnThr` (0.05 rad/s) /
`strafeMaxLat`, `slew` (max steer/strafe change a step), `minHold` (keys held ≥ n; IDEAL forces 6), `ideal`,
`latLim` (MPC hard lateral penalty, IDEAL 255) / `latSoft` (200) + `latW` (1 per m per step: a soft pull back
inside before the hard limit), `maxT` (200 s).
MPC (`prm.mpc`): `D` (6) block steps, `H` (60/90) horizon, `aims` (m), `burns` (−1 rule / 1 on / 0 off), `Wv` (1),
`hullPen` (100).
A run aborts if it makes < 500 m of route progress in 10 s.

## Known limits

- The bench is the only authority; the solver never trusts its own time. It re-benches up to 4 candidates.
- Times are chaotic in the parameters: a different budget explores a different set and may land elsewhere.
  Budget mostly buys MPC passes; 600–900 s is enough for most courses.
- No explicit model of terrain crests (CANYON's diagonal ridges) or the "pass consecutive mounds on the same side"
  rule; the MPC's progress score avoids launches only when an alternative is within its horizon.
- No gate-skipping search in ROGUE (a miss costs 40 % of your speed, never seen to pay).
- MPC candidates change only burner and aim; no brake or steer-bias candidates.
- Files: `core.js` (in-page), `solve.mjs`, `all.sh`, `table.mjs`; dev helpers `probe.mjs`, `probe-all.mjs`,
  `reusetest.mjs`.

## Results (2026-11-25, budget 600 s, every time from `node tools/agentrun.mjs run`, all re-benched)

| course | ROGUE | best known | IDEAL | max lat (every step) | best known |
|---|---|---|---|---|---|
| canyon | 21.950 | 22.78 | 23.917 | 236 m | 24.15 |
| caldera | 39.367 | 39.62 | 43.883 | 203 m | 44.08 |
| oval | 52.383 | 53.92 | 55.117 | 199 m | 56.77 |
| sprint | 40.033 | 45.43 | 45.667 | 183 m | 49.67 |
| greenway | 39.033 | 40.88 | 43.650 | 201 m | 45.80 |
| mistriver | 24.750 | 25.60 | 26.917 | 214 m | 28.20 |

Every run counted with 0 missed gates; every IDEAL run has `human.ok` true. One solve takes 4–9.5 min at budget
600 s (plain runs 1–3 s each, MPC passes 20–130 s each, the bench ~12 s per check). Reruns land elsewhere because
the search is chaotic: OVAL ROGUE gave 53.083 on a rerun (the saved 52.383 came from an earlier solve that had no
jitter phase) and CANYON IDEAL gave 24.383 (the 23.917 was saved before the soft lateral penalty was added). The
solver keeps the faster valid run.
