# The Distance Between Us — design

> Games never feel fast enough, so I'm making this.

## Core fantasy
You aren't driving. You're falling forward at an impossible speed and barely holding on. Speed is
something you feel, not a number on the HUD.

## Modes
- **Race (the main game).** Ten racers, three laps of an 82 km stadium figure-8 with 16 gates: two
  dead-straight 23 km runs that cross in the middle, joined by 5 km-radius sweepers (one right-hand
  loop, one left-hand loop). 33 rock spires stand along the line to weave through at speed. The
  racing line is worn into the sand: packed, darker, with scorched lanes. AI rivals,
  jumps, boost pads, and racing contact. Racing comes first; nobody is shooting.
- **Hunt.** The original combat sandbox: lock-on missiles against drones, then a 360 m walker.

## The race
- **Grid and countdown:** 3-2-1-GO. Hold boost in the last half second for a perfect start (Mach 1.8
  off the line). Pressing too early bogs you down.
- **Gates:** each is a pair of 140 m towers with a glowing banner 530 m wide. The next gate is lit
  cyan, with a holographic curtain, two light pillars rising 2.4 km into the sky, and an on-screen
  diamond showing its distance. The finish is orange. Clipping past a gate or skipping one
  costs +2 s. A gate chime plays as you pass; a lap gets a third note and a lap-time pop.
- **Track reading:** pylons line both edges every 320 m (orange on one side, white on the other),
  an arrow at the screen edge points to the next gate, and a minimap shows the whole loop.
- **Boost pads:** chevron strips on the line add +Mach 0.75.
- **Jumps:** mounds on and beside the line, plus riverbanks, launch you when taken fast.
- **Rivals:** VEGA, KESTREL, NOMAD, ION and RUSH drive the same physics you do. Each has a name
  tag, a trail in its own colour, and an engine glow visible at range. They hold lanes,
  swing out to pass, slow for bends their speed can't hold, and are rubber-banded mildly.
- **Contact:** racers bump (a capped shove, sparks and a clang). Rock walls deflect you: a glancing
  hit scrapes and keeps your speed, a head-on hit stops you. Wrecked racers respawn at their last
  gate (R does this on demand) and pass through others as ghosts for 2.5 s.
- Position, lap, time, penalties, live standings with gaps, wrong-way and off-course warnings, and a
  results table at the end.

## Throttle, brake, steering
- **W is the throttle.** Off it, you coast down; there's no cruise control. **S brakes hard.** S with
  steer is a trail-brake drift that still scrubs speed. In the air, S dives at +120 m/s².
- **Adaptive steering:** authority grows ×1.75 by Mach 5, faster than grip does. Sharp turns are
  available at speed, but full lock held there slides (12–14° at Mach 5) and half lock is safe.
- **Grip gauge** (above the Mach readout): green within grip, yellow near the limit, orange once
  you're past the line and sliding, flashing red with CATCH IT when a spin is close. Keyboard
  steering ramps in over about 0.4 s, so taps give part-lock you can modulate against it.
- **Spin-outs** are visible: the hull whirls about 1¼ turns, decaying, with a messy shudder, while the
  travel carries on and scrubs. The camera holds your direction of travel, so you watch the ship
  spin, and then the nose eases back into line.

## Handling: slip, drift, losing it
The nose and the direction of travel are separate. Grip pulls the travel back toward the nose. It
rises to a peak at a 9° slip angle and falls to 42% once you're sliding, and the craft's yaw has
momentum.
- **Grip grows with speed, like downforce.** The turn rate grip can hold is gripK + gripQ·v, so the
  start of a race is loose and twitchy and flat-out is planted. Full steer at Mach 5 sits at about 4°
  of slip. Speed makes it easier; the brake and crooked landings are how you lose it.
- **Brake + steer** is a trail-brake: grip halves and the speed mostly stays. That's how you start a
  drift on purpose.
- **A controlled slide (10°–65°) charges a drift boost.** Straighten out to release it: +Mach 0.6 at
  level 1, +Mach 1.1 at level 2 (orange). Hold the slide too long and you lose the charge, then spin.
- **Past 66° of slip at speed you spin out** and lose control for about 1.2 s with heavy scrub. Spin
  above 1,150 m/s and you **flip**: two rolls, a hop, −22 hull, −38% speed.
- **In the air there's no grip.** Steering turns the nose but not the travel, so you have to land
  straight: more than about 43° off spins you out (Low assist), and more than about 74° at speed flips you. An in-air readout
  shows how far off the nose is.
- **Steering assist** (Esc): Off, Low (default, 0.45) or High. Assist adds grip and self-align, plus a
  little automatic countersteer. The AI drives on High.
- **Floatier feel:** soft hover suspension with a slow bob, under-damped bank and pitch, and gravity
  of 34 m/s².

## Flight
Ground effect holds the craft over dunes. A crest that would strip more than 45 m/s of climb within
40 m launches you; that's speed-dependent, so the same mound launches at Mach 3 and is just ridden
over at Mach 1.5. In the air:
- Gravity is 34 m/s².
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
