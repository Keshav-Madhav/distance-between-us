# Perf log

Measured with `node tools/shot.mjs` (headless Chrome, ANGLE/Metal, M-series Mac, 1280×720, tier
high = DPR 1.5 + MSAA 4 + bloom, `?fixed` so no dynamic resolution). Frame times are capped by vsync
at 60 Hz.

| date | scene | fps | avg / p95 / p99 ms | calls | tris | particles |
|---|---|---|---|---|---|---|
| 2026-11-20 | title | 60 | 16.7 | 49 | 798k | 0 |
| 2026-11-20 | Mach 6 cruise | 60 | 16.7 | 57 | 800k | 250 |
| 2026-11-20 | combat, 5 s sample | 60 | 16.60 / 16.70 / 16.80 | 60 | 802k | 1,485 |
| 2026-11-20 | Walker fight | 60 | 16.7 | 77 | 799k | 113 |
| 2026-11-20 | Walker collapse | 60 | 16.7 | 82 | 805k | 2,480 |
| 2026-11-20 | race, 6 racers, 5 s sample | 60 | 16.70 p50 / 16.80 p99 | 92 | 835k | 1,170 |
| 2026-11-20 | race start (all 6 near) | 60 | 16.7 | 111 | 880k | 1,250 |

The triangle count is dominated by about 350 mesas (each around 1–2k tris, all drawn with no LODs)
and the near terrain ring. The next lever is mesa LODs and per-instance culling.

## 2026-11-28 — a laptop report: "i7 + RTX 3050, lowest graphics, unstable 60 fps, lag and hitches"

**Frame pacing on high-refresh screens (the likely cause).** AUTO capped at 16.7 ms when it missed frames. On a
144 Hz screen (most RTX 3050 laptops) that skips any refresh under 14.7 ms, so it rendered every *third* refresh:
48 fps, not 60. It then retried the full rate every 8–60 s, a burst of missed frames each time. Now the cap is a
whole number of refreshes (144 Hz: 72 then 48; 120: 60 then 40; 165: 82 then 55), it steps down only, never retries
mid-race, and the rate it settles on is remembered (`dbu-pace`). The explicit "60" setting uses the even rate
nearest 60 (72 on 144 Hz). Checked on a virtual 144/120/165/60 Hz clock: renders land on every Nth refresh.

**LOW's triangles** (`tools/tris.mjs`, scatter by kind, per-world averages over a 12 s race at 1920×1080):

| world (course) | before | after |
|---|---|---|
| RED MESA (sprint) | 1.54M | 0.96M |
| RED MESA (canyon) | 1.46M | 0.88M |
| POLAR SHELF (frostline) | 1.24M | 0.78M |
| POLAR SHELF (icecave) | 1.49M | 1.03M |
| CINDER (caldera) | 1.47M | 0.90M |
| VERDANT (greenway) | 1.27M | 0.79M |
| MONSOON (mistriver) | 2.38M | 1.86M |

- The middle terrain ring (60 m cells to 12 km, 315k triangles in one draw) has a LOW twin at 120 m cells (79k).
- LOW's scatter reach 0.6 → 0.42: shrubs are 152 triangles and tumbleweeds 452, and every instance in reach runs
  the vertex shader even where the density hides it (647k of RED MESA's triangles at 0.6).
- Rival ships switch to the merged far model at 180 m on LOW (was 600 m): a detailed ship is ~12 draws.
- MONSOON keeps its canopy (thinning it on LOW was rejected: bare patches).

Measured on the M5 Pro the CPU-slowed (×4) race barely moves (the M5's GPU is not the bottleneck); `tools/stutter.mjs`
prints each spike with what caused it (program links, uploads, GC, the game's own sections) — no mid-race shader
programs were linked on any world.
