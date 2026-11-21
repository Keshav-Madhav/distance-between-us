# FROSTLINE — the second world (design, 2026-11-21)

A whole new map, not a new route through the desert: an arctic plateau at polar twilight.
The brief: "very elaborate and visually very good but still not too hard."

## The look

- **Ground:** wind-packed snowfields. The desert's dunes become snow drifts and sastrugi
  (wind-carved ridges). Gravel patches become exposed dark rock.
- **Frozen lakes:** the dry riverbeds become black-teal glossy ice with white crack lines. The ice
  reflects the sky, so the aurora shows in it.
- **Glaciers and ice spikes** (src/ice.ts), in the slots the desert uses for mesas, buttes and
  hoodoos. Glaciers come in four shapes: a tabular sheet, a sloping tongue, a broken serac top and
  a tiered icefall. Seracs come in three: a tilted slab, a saddle and a peaked tower. Spike clusters
  come in three: one main spike with satellites, a dense cluster and an outward-leaning crown.
  They are shaded as layered blue ice that is lit from within, with a snow cornice dripping over
  each rim and drifts banked against the foot.
- **Mountains:** the far ring is white-capped and blue in the haze.
- **Sky:** deep twilight blue fading to a teal-rose horizon, with a low sun just above it, stars
  overhead, and **aurora curtains**: green ribbons with magenta crowns, rippling slowly.
- **Air:** cold blue fog, and snow drifting through the air around you. Ships throw white spray
  instead of sand, and the sparkle on the snow reads as frost.

## The circuit — FROSTLINE

- About 80 km, one lap, on a loop that crosses the frozen lakes.
- Wide sweepers (nothing under ~1.5 km radius): flowing, fast, forgiving.
- No spires. One pair of gentle snow-drift jumps.

## The second course — ICEFALL

- About 60 km, two laps, on a lobed loop with a tightest bend of 1.3 km.
- It runs close to the ice (the same clearance as CANYON RUN).
- The menu picks the world first (RED MESA / POLAR SHELF), then a course within it.

## How it's built

A **biome** is chosen when the page loads (a course switch is already a reload), exactly like the
per-course light. The biome turns on `BIOME_ICE` in every world shader (terrain, rock, mountains,
sky) and sets a dust palette for the particles. Nothing is duplicated: the same terrain formula,
mesas, physics and race code, recoloured and re-lit, with the aurora, stars and snow added.

## Review

Critic agents review in sequence, each one seeing the latest build: renders, in-race frames and
performance numbers. Fixes go in after each review. A real playtest comes last.
