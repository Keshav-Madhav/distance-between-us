# The Distance Between Us — design (POC vertical slice)

> Games never feel fast enough, so I'm making this.

## Core fantasy
You aren't driving. You're falling forward at an impossible speed and barely holding on. Speed is
something you feel, not a number on the HUD.

## Core loop (first 2 minutes)
1. **Launch** (0–10 s): from Mach 0.6, hold boost. Mach 1 to Mach 6 takes a few seconds. Each Mach
   number cracks with a vapour cone, a flash and a camera kick.
2. **The barrier:** at Mach 5.88 all sound cuts to near-silence and the frame goes white-hot for
   0.5 s. Then the boom (a two-crack N-wave), a FOV punch, and you're past Mach 6.
3. **Combat at speed:** drones overtake you and hold ahead, weaving and firing red tracers back at
   you. Head-on passers scream by. A soft lock (a wobbling diamond) builds in about 0.4 s, then a
   missile corkscrews after the target. The fireball keeps its momentum, then falls behind as you fly
   through the smoke. The boom arrives late because sound travels at 343 m/s.
4. **The Walker** (after 6 kills or 70 s): a 360 m reverse-jointed machine appears 15 km ahead, with
   a warning banner, an edge arrow and a heavier score. It lobs leading three-orb plasma volleys that
   you thread between. Kill its four glowing cores. It then collapses in slow motion, and a ground
   shockwave chases you down and shoves you forward.
5. Results card, then R to run again or C to keep flying.

## Controls
| Action | Keyboard | Gamepad |
|---|---|---|
| Boost (afterburner) | W / Shift / ↑ | RT |
| Steer | A D / ← → | left stick |
| Strafe / dodge | Q E (double-tap dodges) | right stick / LB, B |
| Fire missile | Space / click / J | A / RB |
| Air brake (can't drop below Mach 0.9) | S / ↓ | LT |
| Settings | Esc | |
| Debug overlay / feel GUI | ` / G | |

## Feel
- A twitchy yaw that eases in over about 60 ms. The craft drifts sideways out of turns, banks, and
  pitches with G-force.
- Chase camera: heading lags so turns whip it round. Acceleration pulls it back and braking shoves
  it in. FOV runs from 64° to 100° with speed, with punches on boost and Mach breaks. Shake is noise
  driven by trauma², with a constant rumble floor at high speed.
- Hitstop on kills, slow motion on the Walker's fall and on death, gamepad rumble.
- Riverbeds are flat, rock-free tracks. Boulders clip you (sparks, a jolt), and mesas wreck you (−30
  hull, speed lost, deflected along the wall).

## World and art
An endless desert: wind-rippled orange sand, gravel patches, cracked-clay riverbeds, red sandstone
mesas, buttes and spires, a huge blue sky. The style bible is in `ART_STYLE.md`.

## Out of scope for the POC
Canyons, a rear-view mirror, more enemy types, progression or upgrades, online leaderboards,
touch controls, mobile tuning, KTX2 texture compression, story.
