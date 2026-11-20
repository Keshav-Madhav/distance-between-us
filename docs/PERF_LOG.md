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
