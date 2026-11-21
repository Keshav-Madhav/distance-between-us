# VERDANT — the fourth world (2026-11-22)

The user asked for "grassy forest land this time".

**The look.** Temperate highlands on a clear morning.
- **Grass:** meadows of grass with soft bright waves rolling across in the wind, and wildflowers close in.
- **Rivers:** clear water with gravel banks, mirroring the sky. They are toned down so they never wash out at a racer's grazing angle.
- **The road:** packed dirt down the racing line.
- **Light:** a low warm sun and cumulus clouds, with blue-green mountains in the haze.
- **Air:** drifting pollen.
- **Sound:** wind in the leaves, and birdsong in phrases of two to five chirps.

**The landforms** (src/forest.ts) use the same slots as the other worlds:
- **Mesa slot:** granite domes crowned with pines and broadleaf trees. One variant is a long ridge, another a half dome with a sheer face.
- **Butte slot:** groves of pines, of broadleaf, and mixed.
- **Spire slot:** a lone giant redwood, twin redwoods, or a giant broadleaf.

A single mask attribute colours granite, bark and foliage. The foliage sways in the wind, each tree out of step with the others. Groves are about four times as common as rock elsewhere, and they can stand 520 m from the line.

**Courses.**
- **GREENWAY:** 74 km, run twice. A rolling loop with nothing tighter than about 1.9 km. It is mostly forest belts, with one meadow to breathe in and a run past the domes.
- **RIVERRUN:** a 95 km sprint with sweepers, river crossings and a four-bend slalom.

**Performance.** GREENWAY runs with no frame over 25 ms. At ultra, 2× resolution, it costs 7.2 ms per frame, against 9.6 ms on the desert sprint in the same run.
