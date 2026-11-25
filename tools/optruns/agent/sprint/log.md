# SPRINT agent log

Controller: copy of tools/optruns/agent/ctl.mjs in sprint/ctl.mjs with one change: when the DP finds no clear
path, the arc radius at the previous node is halved (down to 0) and the plan retried (Rc 9000 had no path at
gate 9; the corners at gates 8, 16, 21, 32 needed smaller arcs). Every time below is bench-verified unless marked
(driver).

Course facts (probe.mjs): 35 gates, gateHalf is 260 (SPRINT has no gateHalf override -> GATE_HALF 260, NOT 600;
the brief's 600 is another course; W 550 missed 16 gates). 18 boost pads. Three S-bend sections (z 28-52k,
83-107k, 133-157k). A big spire (cr 50) at (-3990, 45552), 565 m past gate 10 -> the craft hit it in most early
runs (thrown off line by the pad approach at pad z 44157).

| # | what | result |
|---|------|--------|
| s1 | MISTRIVER best-params, W 550 | 16 missed gates (gate is only 260 wide) |
| s2 | W 240, Rc 9000/6000 | "no clear path at gate 9"; Rc 0: 77.9 (driver), 6 missed, crash |
| s3 | + per-node arc fallback; Rc 0, mgSmall 80, mgPlan 120 | 56.8 (driver), 0 missed but crash at the spire after gate 10 |
| s4 | speed caps in S-bends (vmaxG 8-9), kp 3, la .3, lam 10000 | 60.5-76 (driver), crash at the same spire |
| s5 | padT .2 (shorter straight-at-pad approach) | **55.367 counted**, 1 missed (gate 14) -> best.json |
| s6 | W 220, Wc 260 | 52.833 (driver), 0 missed, 2 small hull hits |
| s7 | + kp 2 | **50.433 counted, 0 missed, 0 events** -> best.json (best-params.json) |
| s8-s11 | look-ahead/prediction/margin/burnErr sweeps; mounds (jump ramps, c.mounds) as soft obstacles (`mounds` = radius scale) | 51.5-76 (driver): chaotic, most crash on spires |
| diag | crash report now names the nearest surveyed obstacle + how close the planned polyline came: the ideal run's crash at the spire (2637,136657) cr 58 was ON the planned route (polyline 34 m from its centre) — the arc the poly actually flies is clamped to 0.48·leg and can differ from the arc the DP checked | |
| fix | ctl: after building the polyline, check every arc against obstacles (+corridor); a bad arc halves that node's radius and re-plans | |
| s12 | IDEAL config (mid 30, midW 200, corr 220, W 220, Rc 6000, lam 10000, burnErr 60, mounds 1.0, padT .2, kp 2) | **50.150 counted, 0 missed, max lat 254 m every step (253 trace)** -> ideal.json AND best.json |
| s14 | IDEAL config + padT .25 | **49.200 counted, 0 missed, max lat 253 every step (248 trace)** -> ideal.json AND best.json (ideal-params.json) |
| s15 | hardBig 40/60 (hard clearance for spires) | no clear path; relaxed corridors (300/400) for rogue: 50.6-63 (driver) |
| s19 | `inflate` (extra planning radius for the spires the craft kept hitting: (-3990,45552)+50, (-550,88130)+40, (2608,69583)+30, (-6682,39057)+30) | 5 of 7 configs clean, 49.4-50.4 (driver) |
| rule | coordinator: IDEAL must be human-drivable (no strafe/dodge, every key press/release >= 6 steps). ctl: `minHold` (burner state changes only after 6 steps), projection windowed 1.5 km back / 6 km ahead (CALDERA fix) | |
| s20 | IDEAL inflate set b + minHold 6 | **49.667 counted, 0 missed, human ok, max lat 250 every step (244 trace)** -> ideal.json (ideal-params.json) |
| s21 | ROGUE: strafe into turns (`strafe`, `dodge`, `dodgeThr` — side velocity re-split into forward speed as the nose yaws) on the ideal plan | Mach 13-15.6 reached; most crash on spire (2637,136657); strafe only, inflate b: **46.217 counted, 0 missed** -> best.json |
| s22 | strafe + inflate set incl. (2637,136657)+40 | 45.967 counted |
| s24 | strafe + DODGE into turns, but no strafe/dodge while next gate = 30 (the spire at (2637,136657) killed every dodge run at Mach 15) — `noStrafeG` | **41.717 counted, 0 missed, top Mach 15.6** -> best.json (best-params.json) |
| s25 | perturbations of the 41.7 rogue (dodgeThr, kp, padT, corridor, burnErr) | all worse (46.7-62.7, mostly spire crashes) — 41.7 is a lucky point |
| s26 | random perturbations of the IDEAL (minHold 6) | best 49.817; 49.667 stands |

## Final (bench-verified)
- ROGUE best.json: **41.717 s counted, 0 missed gates, no crash** (best-params.json; ctl `strafe`+`dodge` into turns, off for gate 30).
- IDEAL ideal.json: **49.667 s counted, 0 missed, human ok, max |lat| 250 m every step (244 at 0.5 s samples)** (ideal-params.json, minHold 6).
Regenerate: `node tools/optruns/agent/sprint/ctl.mjs sprint tools/optruns/agent/sprint/<params>.json out.json` then `node tools/agentrun.mjs run sprint out.json`.

Where time remains: the spires the craft keeps hitting (45552, 88130, 136657) — the controller drifts 50-250 m off the route
while burning (10% steering) or after pad approaches and jumps; a planner that keeps a larger hard clearance from big
spires (hardBig 40 had no path with corr 220; needs per-spire choice of side) would make the fast dodge settings
reliable. ROGUE never cut S-bends wider than ~280 m; a corridor-free plan with dodge (corr 300 gave 47.6 with a miss) is untested at scale.
