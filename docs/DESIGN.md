# The Distance Between Us — design

> Games never feel fast enough, so I'm making this.

## Core fantasy
You aren't driving. You're falling forward at an impossible speed and barely holding on. Speed is
something you feel, not a number on the HUD.

## Modes
- **Race (the main game).** Six racers, three laps of a 40 km desert loop with 14 gates. AI rivals,
  jumps, boost pads, and racing contact. Racing comes first; nobody is shooting.
- **Hunt.** The original combat sandbox: lock-on missiles against drones, then a 360 m walker.

## The race
- **Grid and countdown:** 3-2-1-GO. Hold boost in the last half second for a perfect start (Mach 1.8
  off the line). Pressing too early bogs you down.
- **Gates:** each is a pair of 96 m towers with a glowing banner 520 m wide. The next gate is lit
  cyan with a holographic curtain, and the finish is orange. Clipping past a gate or skipping one
  costs +2 s. A gate chime plays as you pass; a lap gets a third note and a lap-time pop.
- **Track reading:** pylons line both edges every 320 m (orange on one side, white on the other),
  an arrow at the screen edge points to the next gate, and a minimap shows the whole loop.
- **Boost pads:** chevron strips on the line add +Mach 0.75.
- **Jumps:** mounds on and beside the line, plus riverbanks, launch you when taken fast.
- **Rivals:** VEGA, KESTREL, NOMAD, ION and RUSH drive the same physics you do. They hold lanes,
  swing out to pass, slow for bends their speed can't hold, and are rubber-banded mildly.
- **Contact:** racers bump (a capped shove, sparks and a clang). Rock walls deflect you: a glancing
  hit scrapes and keeps your speed, a head-on hit stops you. Wrecked racers respawn at their last
  gate (R does this on demand) and pass through others as ghosts for 2.5 s.
- Position, lap, time, penalties, live standings with gaps, wrong-way and off-course warnings, and a
  results table at the end.

## Flight
Ground effect holds the craft over dunes. A crest that would strip more than 45 m/s of climb within
40 m launches you; that's speed-dependent, so the same mound launches at Mach 3 and is just ridden
over at Mach 1.5. In the air:
- Gravity is 44 m/s².
- Yaw keeps 60% authority, and brake turns into a dive.
- The nose follows the flight path and levels itself for the landing.

Landings are always survivable: suspension squash, a dust ring, a thump, and a small speed loss on
hard ones. Jumps last about 2–3 s and reach about 50–60 m at Mach 3.

## Controls
| Action | Keyboard | Gamepad |
|---|---|---|
| Boost | W / Shift / ↑ | RT |
| Steer | A D / ← → | left stick |
| Strafe / dodge | Q E (double-tap dodges) | right stick / LB, B |
| Air brake (in the air: dive) | S / ↓ | LT |
| Back to the last gate | R | |
| Restart | Shift+R | |
| Fire (Hunt) | Space / click | A |
| Settings (quality, FOV, volume, shake) | Esc | |
| Debug overlay / feel GUI | ` / G | |

## Feel
- **Camera:** every part is a critically damped spring. It follows the real direction of travel, so
  drifts show. G-force pulls it back on acceleration and pushes it in on braking. In the air it lifts
  and frames the craft. It never goes inside rock or below the ground, and impacts kick it away from
  the wall.
- **FOV:** goes from 68° up to the FOV setting (98° by default) as speed rises.
- **Impacts:** a big hit gives hitstop, a zoom-in, a camera kick, a chromatic aberration spike, a red
  edge, sparks, rock debris, a sand plume and rumble. Scrapes throw a continuous stream of sparks
  with a grinding sound.
- **The Mach 6 barrier:** half a second of near-silence and white-out, then the sonic boom.

## Out of scope (still)
Canyons, a rear-view mirror, more tracks, career mode or upgrades, online play, touch controls,
mobile tuning, KTX2 texture compression.
