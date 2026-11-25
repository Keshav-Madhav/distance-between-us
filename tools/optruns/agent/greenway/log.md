# GREENWAY agent log

Approach: own pipeline in this folder.
- info.mjs: dumps gates, pads, mounds, centreline and an obstacle survey -> course.json
- line.mjs: min-curvature line over the whole 2-lap race (lateral offsets every 80 m, box-constrained:
  corridor W, gates, pads pinned, mounds/obstacles), multi-resolution coordinate descent, optional IRLS
  reweighting toward a minimax curvature.
- ctl.mjs: closed-loop driver in the real sim (g.force) following the line: predictive pure pursuit +
  curvature feed-forward; burner held when the turn fits its 10% steering, else a sigma-delta duty cycle;
  side thrusters + dodges into the turn. Output = the game's own recorded inputs (g.inputs()) so the
  bench replay is exact (writing my own forced values diverged: the 1-step replayWith stub overrides steps 0-1).

| # | what | result |
|---|------|--------|
| 1 | min-curv line W255, all pads, pursuit la .25 | ctl 44.88, 0 missed, speed stuck ~M10-11 |
| 2 | tighter tracking (la .15) | 46.2 (7/15 pads) - turn bleed caps speed ~M11 |
| 3 | + strafe+dodge INTO the turn (dodgeThr .1) | speed climbs to M13.4 by 26 s, then lost line in a tight bend |
| 4 | corner speed limit + brake | worse (50-55) - braking kills it; dropped |
| 5 | lines with padSpan 1 (pad pinned over 3 samples), IRLS | ctl 38.37 (8/15 pads); pads matter: no-pad line 41.7 |
| 6 | bench verify (after fixing input recording) | **38.367 counted, 0 missed**, maxLat 316 (rogue only) -> best.json |
| 7 | pad aiming (last padT s aim at the pad, no dodges) | 14-15/15 pads, but lost the line into the lap-2 mound after pad 9 (airborne -> crash) |
| 8 | mounds: launch needs the crest, so margin = mound r + 30, both mounds passed on the SAME side (no S-bend); IRLS -> min R 3.3 km | **37.700 counted, 0 missed, 15/15 pads, top M15.5** (ctl sw7 #2, padT .35) -> best.json; maxLat 304 |
| 9 | side-aware prediction (the dodge's side velocity decays, tau .31 s; predict travel without it) | **36.033 counted, 0 missed** (sw9 #1) -> best.json; maxLat 423 |
| 10 | IDEAL: W205 line + corridor guard (target clamped inside 200 m of the centreline, no dodges past it), latKeep 0 | **37.950 counted, 0 missed, trace max |lat| 229** (sw10 #4) -> ideal.json (between 0.5 s samples it touches 315) |
| 11 | IDEAL variant: guard 190, dodgeThr .05 | **36.917 counted, 0 missed, trace max |lat| 242** (sw11 #4) -> ideal.json (between samples 323) |
| 11 | rogue variants (dodgeThr .05/.15, strafeK 40, padT .35) | all lost the line at the lap-2 mound (43-52 s); 36.033 stays best |

Stopped: budget (~75 config runs + 10 bench verifications).

## Findings
- **Side-thruster energy trick (biggest gain, ~6-8 s)**: Player.step re-splits the velocity against the new heading
  using lateral + side (src/player.ts ~382-386), so while the craft yaws, the strafe/dodge `side` velocity is
  projected into forward `speed` (speed' = speed cos d + (lat+side) sin d) and the side velocity itself stays
  (decays only by exp(-3.2 t)). Strafing + dodging (every 0.25 s, +170 m/s) INTO the turn feeds ~side*|yawRate|
  of speed (~300 m/s per radian) against the turn bleed (0.05*v per radian, ~200 m/s per radian at M12), so turning
  gains speed instead of costing it. (The comment on `side` says it is "never turned into forward speed".)
  Minimal repro: at Mach ~10 hold burner off, steer full right for 1 s with strafe +1 and dodgeR held vs. with
  strafe 0: the first should end faster (repro not run separately; evidence is the A/B below). In the race: speed plateaued at M10-11 without it, climbed to M15-16 with it.
- Holding the burner above its soft limit (M12) costs nothing: no drag while thrust is on (`!thrust || speed < target`),
  so every pad (+0.75) and gain above 12 is kept. Pads are worth ~1 s each early on: 0 pads 41.7, 8 pads 38.4, 15 pads 36-37.
- Mounds launch only through the crest region (|offset| < ~0.76 r); pass both GREENWAY mounds on the same side.
- The bench replays the game's own recorded inputs; record with g.inputs() (forcing your own copy diverges at steps 0-1).
