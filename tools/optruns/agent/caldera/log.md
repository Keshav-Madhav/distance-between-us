# CALDERA agent log
Tools: ../ctl.mjs (shared controller), info.mjs (course dump -> course.json). 29 gates (2 laps x 14 + finish), 16 pads, 2519 obstacles (93 big).
Lava is cosmetic (src/lava.ts is only landform geometry); no special lava rule.

| # | what | verified result |
|---|------|-----------------|
| s0 | MISTRIVER best/ideal params as-is | no DP path at gate 9 (the hook: Rc arc cut exceeds window) |
| s1 | Rc 2000-4500 rogue params: still no path at gate 9; ideal params with Rc 4000 | **45.650 counted, 0 missed, maxLat 239 every step, 15/16 pads** -> ideal.json (also best.json for now) |
| s2 | rogue (MISTRIVER best + mid nodes, midW 400-1500): paths found but misses/crashes near lap-2 start ((1.5k,4.5k): something unsurveyed) | 46.5-58 (driver) |
| — | copy caldera/ctl.mjs: `duty` = duty-cycled burner (burn a fraction f of steps, full lock on the rest, so the mean turn matches; each re-press refunds the kick charge ~63 m/s^2 of off-time) | |
| s3 | ideal params + duty (smax .95) | 45.05 (0 missed, but per-step maxLat 347 -> not ideal); padBurn 44.73 -> best.json |
| r1 | rogue: wider W 300-340 / no corridor + duty | 46.4-50.7: worse — riding the gate edge misses gates |
| i2 | ideal + duty, sweep: **la 0.2** | **43.183 counted, 0 missed, 16/16 pads, maxLat 233 every step** -> ideal.json + best.json |
| — | BUG in ctl (shared): `proj` searched the whole 2-lap route; at the lap-2 start it snapped onto the finish leg's 2 km extension and flew the craft into a rock at (956,3945). Fixed in caldera/ctl.mjs with a windowed projection (sCur −1.5 km … +6 km). | |
| i5 | after the fix: wider corridor 230/W250, la .18 | 43.03-43.5 |
| — | caldera/ctl.mjs: `strafe`/`dodge` INTO the turn (side velocity is re-split into forward speed while yawing — the same trick GREENWAY's agent found), `sideAware`, `dodgeThr`, `dodgeMaxLat`/`strafeMaxLat` (no side push outward past that lateral). (First try had dodges forced off in g.force — fixed.) | |
| t1 | strafe only: 41.12; strafe+dodge+sideAware 1: | **38.483 counted, 0 missed, top M16.3** (maxLat 293: rogue) -> best.json |
| t2 | sweep la/tp/sideAware, padT .3: la .18 tp .12 sideAware .6 | **36.383 counted, 0 missed, 15 pads, top M17.6** -> best.json (best-params.json) |
| t3 | ideal: corr 180, W 200, midW 160 + dodgeMaxLat 150 / strafeMaxLat 200 | **37.817 counted, 0 missed, maxLat 245 every step** -> ideal.json (ideal-params.json) |
| t4 | brake held with throttle (+35% turn, no decel while boosting) `brk`; sideAware/Rc/kp/smax | 37.0-38.7, no gain (chaotic) |
| t5 | random perturbations of best | 37.35-47; repeated crashes near (-6.4k,-6.3k) on lap 2 at M16+ (between gates 11 and 12) |
| t6 | ideal: dodgeMaxLat 170 / strafeMaxLat 210 | **37.700 counted, 0 missed, maxLat 254 every step** -> ideal.json |

## Final (bench-verified)
- ROGUE best.json: **36.383 s** counted, 0 missed, top M17.6 (params best-params.json, per-step maxLat 283).
- IDEAL ideal.json: **37.700 s** counted, 0 missed, per-step maxLat 254 m (<=265), trace max 247 (params ideal-params.json).
Regenerate: `node tools/optruns/agent/caldera/ctl.mjs caldera tools/optruns/agent/caldera/<params>.json out.json`, then `node tools/agentrun.mjs run caldera out.json`.

## Findings
- Biggest gain: side thrusters + dodge INTO the turn (43.2 -> 36.4). Player.step re-splits velocity (forward*speed + right*(lateral+side)) against the new heading, so side velocity opposite in sign to yawRate becomes forward speed (~side*|dyaw|, side ~300 m/s with dodge every 0.25 s + strafe) vs the 5%/rad turn bleed: equilibrium speed ~20*side ~ M18. CALDERA is a loop (4*pi rad of turning over 2 laps), so it pays the whole race.
- Duty-cycled burner (45.65 -> 45.05, with la .2 -> 43.2): burn on a fraction of steps with full lock on the others; each re-press refunds the kick charge (95 m/s per 1.5 s off = 63 m/s^2 of off-time), which roughly cancels the off-burner drag at M11.
- Shared ctl.mjs bug: global projection onto the 2-lap route snapped to the finish leg's extension at the lap-2 start (craft flew NE into a rock at (956,3945)). Windowed projection fixes it (caldera/ctl.mjs).
- Lava is cosmetic. No rivals in the bench (solo), so no slipstream. Missed gates (x0.6 speed) never pay here: cutting the loop inside the 2500 m gate-plane limit saves ~0.9 km/gate but costs ~4-6 Mach each.
- Where time remains: control at M16+ (pads 13-15 of 16 collected; lap-2 crash spot near (-6.4k,-6.3k)); a line planner that knows the side-thrust crab; weaving to pump speed at low Mach (gain side*|w| > bleed 0.05*v*|w| while v < 20*side).
