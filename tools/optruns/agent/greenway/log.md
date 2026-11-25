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
