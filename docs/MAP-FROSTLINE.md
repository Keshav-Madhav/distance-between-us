# FROSTLINE — the second world (design, 2026-11-21)

A whole new map, not a new route through the desert: an arctic plateau at polar twilight.
The brief: "very elaborate and visually very good but still not too hard."

## The look

- **Ground:** wind-packed snowfields. The desert's dunes become snow drifts and sastrugi
  (wind-carved ridges). Gravel patches become exposed dark rock.
- **Frozen lakes:** the dry riverbeds become black-teal glossy ice with white crack lines. The ice
  reflects the sky, so the aurora shows in it.
- **Ice cliffs:** the mesas become blue-grey rock with snow on every flat and gentle surface and
  icy blue bands.
- **Mountains:** the far ring is white-capped and blue in the haze.
- **Sky:** deep twilight blue fading to a teal-rose horizon, with a low sun just above it, stars
  overhead, and **aurora curtains**: green ribbons with magenta crowns, rippling slowly.
- **Air:** cold blue fog, and snow drifting through the air around you. Ships throw white spray
  instead of sand, and the sparkle on the snow reads as frost.

## The circuit — FROSTLINE

- About 80 km, one lap, on a loop that crosses the frozen lakes.
- Wide sweepers (nothing under ~1.5 km radius): flowing, fast, forgiving.
- No spires. One pair of gentle snow-drift jumps.

## How it's built

A **biome** is chosen when the page loads (a course switch is already a reload), exactly like the
per-course light. The biome turns on `BIOME_ICE` in every world shader (terrain, rock, mountains,
sky) and sets a dust palette for the particles. Nothing is duplicated: the same terrain formula,
mesas, physics and race code, recoloured and re-lit, with the aurora, stars and snow added.

## Review

Critic agents review in sequence, each one seeing the latest build: renders, in-race frames and
performance numbers. Fixes go in after each review. A real playtest comes last.
