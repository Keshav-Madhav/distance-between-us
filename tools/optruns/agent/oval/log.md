# OVAL agent log
Tools: ctl.mjs (copy of caldera/ctl.mjs + OVAL additions below), info.mjs -> course.json, sw.sh (sweep a param list), ver.sh (bench-verify).
Course: 2 laps, 34 gates (K), 13 pad spots (26 per race), 33 km straights joined by ~R1250 m hairpins (pi rad each), finish = start line.

## ctl.mjs additions
- `omg`/`gf` speed limiter: vLim(s) from route curvature (window kW*40 m), backward braking profile dv/ds = -1.8*bEff;
  `gf` uses the game's grip model (a_lat = gf*min(2.2v, 1.1((0.8+0.00034v)v+60))), assist ignored. Brake (throttle off)
  when v > vLim+vTol, held >= minHold; burner off within nbTol of vLim.
- `midH`: dense centreline nodes (every midH course points) on segments whose gate tangents differ > 0.4 rad (the hairpins).
  Without it the hairpin route was a 3-corner polygon with R~700 m corners.
- `lamK`: integral-of-curvature^2 cost (bend^2/leg). `lam` (bend^2 per node) cannot widen a hairpin: the node count is fixed,
  so sum(bend^2) is independent of radius.
- `lapSplit`: plan pads on BOTH laps (the shared ctl took each pad's nearest course index over the whole 2-lap course,
  so lap-2 pads were never planned: ~15 of 26 collected). lapSplit 16 = the gate at the lap-1 hairpin exit.
- `weave` (rogue bang-bang weave pump on straights), `brkCurve` (trail brake in curves to charge a drift boost): both worse.
- drift-boost events logged (`drifts`).

| # | what | result |
|---|------|--------|
| s0/s1 | caldera params as-is (Rc 3500-4000): no path at hairpin; Rc 1200-1800: 56-75 s with 4-5 missed (hairpin overshoot) | |
| h1-h3 | curvature speed limiter; first versions braked everywhere (Rc arcs on tiny straight bends counted as R1400 curvature) -> kW 15 window | |
| s3 | midH 5 + omg 1.4-1.7 bEff .25 | **57.033 counted, 0 missed, human ok, maxLat 228** |
| s4/s5 | lam / lamK for a wider hairpin: no gain (pads at hairpin exits pin the line to the centre) | 60-62 |
| s6 | grip-model limit gf .8/.9, +/- padSkip | 57.48 best |
| s7 | pads on both laps, lapSplit 17 (wrong split) | 62 |
| r1/r2 | ROGUE: strafe+dodge+sideAware .6; dodgeThr | 55.67 (2 missed), 56.57 |
| r2-2 | IDEAL: s6-2 + lapSplit 16 | **56.767 counted, 0 missed, human ok, 20 pads, per-step maxLat 237** -> ideal.json |
| r3 | weave pump (rogue): top only M7.9-9 | 62.7-68.3 (worse) |
| s8/s9/s10 | gf/bEff/lamK/perturbations; trail-brake drift in hairpins (spins) | 57.05-67 (no gain) |
| r4-1 | ROGUE r1-0 + lapSplit 16, gf .95 | **55.350 counted, 2 missed (gates 8, 32), top M10.8** -> best.json |

## Final (bench-verified)
- ROGUE best.json: **55.350 s** counted, missed gates #8 and #32 (both in hairpins, x0.6 each), top M10.78 (best-params.json).
- IDEAL ideal.json: **56.767 s** counted, 0 missed, human.ok true, per-step maxLat 237 m (trace 234) (ideal-params.json).
Regenerate: `node tools/optruns/agent/oval/ctl.mjs oval tools/optruns/agent/oval/<params>.json out.json`, then `node tools/agentrun.mjs run oval out.json`.

## Findings
- OVAL is acceleration-bound: every hairpin costs M10 -> ~M5, and each 33 km straight is spent re-accelerating on the burner
  (230*(1-(M/12)^2) m/s^2, ~0.4 Mach/s at M6-8). Top speed is only ~M10.7.
- Grip turn limit: R_min(v) = v^2 / (1.1((0.8+0.00034v)v+60)) -> R1250 (centreline) ~M6.2, R1450 ~M6.7, at the grip limit.
  The controller tracks reliably only at ~0.9 of that; drift/overshoot -> slide -> speed collapses to M1-3.
- Strafe/dodge into the turn gives only ~1.4 s here (hairpins are short); weaving on straights to pump speed lost to the burner.
- Missed gates in hairpins (rogue) cost little because speed is already low there.
## Where time remains
- Hairpin min speed (M4.9 vs the M5.7 the limit allows: braking overshoot, brake ramps in over ~0.3 s) and a wider line (pads at hairpin exits pin it).
- A controlled drift through each hairpin (+0.6/+1.1 Mach drift boost on release, IDEAL-legal) — needs a slide-aware controller; trail-brake attempt spun.
- Pads: ideal collects 20/26.

## No-dodge build (dodge flags 8/16 ignored), Nov 2026
Old best.json (55.35, used dodge) no longer reproduces: crashes, uncounted. ideal.json re-verified: 56.767, human ok.
ctl.mjs: `dodge: false` now strips flags 8/16; `slew` clamps steer/strafe change per step (0.34 = the hands rule).
| # | what | result |
|---|------|--------|
| n1 | r4-1 params, dodge off (sideAware .6/.3, gf .9); rogue-human = same + slew .34 + minHold 6; ideal + strafe + slew | rogue 54.32-55.55; rogue-human 54.92 (hands ok) |
| n2 | sideAware .15, dodgeThr .3 | no gain |
| n3 | random la/kp/tp/gf perturbations | **rogue 53.917** (n3-1), **rogue-human 54.833** (n3-4) |
## Final no-dodge (bench-verified)
- best-nododge.json: **53.917 s** counted, 0 missed, top M11.29 (best-nododge-params.json).
- rogue-human-nododge.json: **54.833 s** counted, 0 missed, hands.ok true (rogue-human-nododge-params.json).
Removing dodge cost nothing: it was ~1.4 s FASTER than the old dodge ROGUE (55.35, 2 missed gates). The dodges pushed the craft
off the line and out of gates; the strafe-into-the-turn gain is enough on its own.
