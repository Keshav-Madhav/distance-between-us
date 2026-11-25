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
