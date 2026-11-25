# MISTRIVER agent log

Approach: wrote my own closed-loop driver (ctl.mjs) that flies the real sim with g.force, recording inputs; every
result below is then verified by tools/agentrun.mjs (the verified time is what counts).
Key insight: the burner-press kick (+95 m/s per press) stacks with tap every 2nd step = ~+8 Mach/s, no real ceiling
until capMach 40. Baseline rogue run barely taps (31 presses).

| # | what | verified result |
|---|------|-----------------|
| 0 | baseline rogue inputs | 23.30 counted, 0 missed |
| 1 | ctl: taut-string through gates, tap2, vmax 20, no obstacle avoidance | crashes into mesas (53.4 in ctl) |
| 2 | + live detours | crash still (41.1 in ctl) |
| 3 | survey all obstacles + DP over gate offsets (clear legs, bend cost), tap2, vmax 20 | **22.567 counted**, 3 missed gates, 1 spin -> best.json |
| 4 | + small obstacles in the survey (small rocks at Mach 20 drain hull -> die/respawn) | **14.583 counted**, 2 missed (gates 7,8) -> best.json |
| 5 | soft obstacle penalty in DP, margins 50 small/100 big, la 0.3, vmax 20 | 14.25 (ctl), 0 missed |
| 6 | same, vmax 28 | **11.867 counted**, 2 missed (gates 7, 9) -> best.json |
| 7 | same, vmax 40 | hull death + crash, 23.6 |
| 8 | arc-smoothed route (Rc 5000) + corner obstacle check in DP + predictive pursuit (tp .12, la .25, kp 2), vmax 28 | **11.300 counted**, 1 missed (gate 8) -> best.json |
| 9 | emergency avoid / curvature feed-forward experiments | worse (21-26 s), dropped |
| 10 | sweep of vmax/Rc/la (8 configs, one session): vmax 32, Rc 8000, la .25, tp .12 | **10.550 counted**, 1 missed (gate 8) -> best.json |
| 11 | DP limit gate idx7 offset to [-280,0] (a ramp at z~29.6k throws the craft wide right), vmax 36, Rc 9000 | **9.833 counted**, 1 missed (gate 18) -> best.json |
| 12 | + DP limit gate idx17 offset to [-100,280] | **9.633 counted, 0 missed** -> best.json |
| 13 | + vmax 38 from gate idx 9 on (vmaxG); 40 there gave misses (10.15-10.18) | **9.433 counted, 0 missed** -> best.json |
| 14 | burnNeed 0.6-0.9 (burn while turning harder) | all worse (14-25 s): burning in turns loses the line |
| 15 | vmax 39 from gate idx 9 on, burnNeed 0.5 | **9.350 counted, 0 missed** -> best.json (params: best-params.json) |

Stopped: budget used (~36 browser runs incl. sweeps) and machine load rose to 125 (other jobs).
Regenerate best: `node tools/optruns/agent/mistriver/ctl.mjs tools/optruns/agent/mistriver/best-params.json out.json`
then verify with `node tools/agentrun.mjs run mistriver out.json`.

## New physics (burner kick recharges over 1.5 s off; tapping no longer pays)
Old 9.35 s run moved to oldphysics/best-9.35.json. Baseline rogue inputs under new physics: not counted (6 missed, crash).
Controller generalised: tools/optruns/agent/ctl.mjs <course> <params> <out> (pads as route nodes, corridor option).

| # | what | verified result |
|---|------|-----------------|
| N1 | hold burner when turn need < 0.1-0.35, no pads | ~29.6 (driver) |
| N2 | + boost pads as DP route nodes (±20 m), uLim removed; 9 of 11 pads hit | **26.867 counted, 0 missed** (maxLat 527) -> best.json |
| N3 | lam1 (linear bend cost), padW 28, burnNeed .1, Rc 12000 | 26.72 best (driver), others worse / no path |
| N4 | burner gated by path error / Mach cap | worse (27.2-30.6): fewer pads hit |
| N5 | pad window / corner-cut limits at pads | no gain (27.0-34) |
| D | drift experiments (exp2.mjs, from t=8 s, Mach 8.2): slides charge drift ~0.3 at most before speed loss; no boost fired | drift not useful at Mach 8+ |
| I1 | IDEAL: corridor + centreline mid-nodes every 25/40 course points; arcs overlapping -> clamp arc radius to 0.48 of legs | |
| I2 | IDEAL: mid 30, midW 180, lam 10000, corr 200, W 220, Rc 6000, pads | **28.900 counted, 0 missed, max |lat| 239 m** -> ideal.json |
| N6/N7 | look-ahead / gain / prediction sweeps | 26.70-43 (chaotic); kp 2.5 best |
| N8 | pad approach: from padT·v metres before a planned pad, burner off and aim straight at the pad point (padT .5) | **26.483 counted, 0 missed, 9 pads** -> best.json (params best-params.json) |
| I3 | ideal + pad approach (padT .3): 11/11 pads but strays to 345 m | 26.62 (rogue-valid only) |
| I4 | ideal: corr 180, midW 160, W 200, padT .15 | **28.083 counted, 0 missed, trace max |lat| 226 m** -> ideal.json (between 0.5 s samples it reached 296 m; ideal-strict-candidate.json = 28.417 in the driver, <=265 m every step, not bench-verified) |
| H1 | HUMAN ideal: burner min-hold 6 steps (ctl minHold), corr 120, padT .3 | **28.200 counted, 0 missed, human ok, every-step max |lat| 220 m** -> ideal-human.json |
| R3 | ROGUE: strafe + hold dodge INTO the turn whenever |asked yaw| > 0.08 rad/s (ctl strafeTurn/dodgeTurn/turnThr) | **25.517 counted, 0 missed** -> best2.json (best.json 26.483 kept as the DUEL run) |
| H2 | human-ideal sweeps (padT .5, corr 110-130, kp 2.5, burnNeed .3, lam 5000) | no gain (28.58-29.23); ideal-human stays 28.200 |
| R4 | turnThr 0.10 | **25.500 counted, 0 missed** -> best2.json (params best2-params.json); turnThr .12 26.6; weaving (sinusoidal yaw + dodge) 26.3-28.9, loses pads |

## Dodge removed from the game
| # | what | verified result |
|---|------|-----------------|
| D1 | best2 params without dodge (strafeTurn only), turnThr .08/.10 | 25.767 counted (rogue); same with minHold 6 + slew .33 -> hands ok |
| D2 | + hands rule (minHold 6, slew .33), burnNeed 0.3, turnThr .08 | **25.600 counted, 0 missed, hands.ok** -> best-nododge.json AND rogue-human-nododge.json (params best-nododge-params.json) |
| D3 | burnNeed .25-.4, turnThr .06/.1, constraints off | no gain (25.6-36.6) |
Removing dodge cost 0.10 s (25.50 -> 25.60); the human-hands limits cost nothing here.
