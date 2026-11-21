# HUNT, reworked — the flight plan

Status: a build plan, ready for Phase 1. Nothing here is built yet.
Written 2026-11-21 from a read of `src/combat.ts`, `src/player.ts`, `src/camera.ts`, `src/input.ts`,
`src/world.ts`, `src/terrain.ts`, `src/particles.ts`, `src/audio.ts`, the hunt parts of `src/main.ts`,
`tools/hunt.mjs`, `tools/playtest.mjs` and `docs/HUNT-PLAN.md`. Line numbers drift; names do not.

Replaces the direction in `docs/HUNT-PLAN.md`. Its diagnosis still stands: no ending, unlimited
auto-lock fire, enemies steered in the player's frame, difficulty that only scales the count, no
saved best, no onboarding, no threat warnings. This plan fixes all of them, in the air.

**The walker is gone.** It is not in this design. Phase 1 deletes it (see 7.1).

---

## 1. Vision

**Pitch:** *Leave the ground at Mach 3 and hunt a sky full of machines — fly it, aim it, chain it.*

HUNT becomes the game's second half: the hover-racer pulls up off the sand, folds its fins into
wings and truly flies. A run is an eight-minute sortie in one world's sky. You climb, dive, roll and
air-brake through three acts of enemy flights that fly real paths and can be out-flown, then two
flying set pieces: a drone train snaking low through the terrain, and a carrier the size of a mesa.
You shoot with a fast cannon you must lead and a missile rack you must ration, and you score more the
faster you fly and the longer you chain kills. It stays readable at Mach speed because enemies fly at
speeds near yours, the camera keeps the horizon steady, and every threat has a sound and a mark on
screen. It ends with a results screen, a medal and a best score to beat.

---

## 2. The flight model

### 2.1 What it is
Arcade flight. No stall, no lift curves, no fuel. The nose goes where you point it, the velocity
follows the nose a moment later (so hard turns slide a little), climbing costs speed and diving gains
it. The ground is a soft floor you can skim, rock is solid, and the sky has a soft ceiling.

### 2.2 Controls

Three schemes, all live at once (whatever input moved last drives). Rebinding is out of scope.

**Mouse + keyboard (default on laptops): aim-point flight.** The mouse moves an aim ring across the
screen; the craft turns, rolls and pitches to put its nose on the ring by itself. You aim where you
want to go, not the stick. Needs pointer lock (click the canvas; Esc releases it, as today).

| Action | Key / button | Why this key |
|---|---|---|
| Aim / fly | mouse | |
| Throttle up | W | same as RACE |
| Air brake (tighter turns, overshoot a tail) | S | same as RACE |
| Afterburner (spends energy) | Shift | same as RACE |
| Roll left / right (manual; overrides auto-roll) | A / D | |
| Rudder nudge (fine aim, ±3°) · double-tap = barrel-roll dodge | Q / E | same dodge as RACE |
| Cannon (hold) | left mouse | |
| Missiles: hold to paint, release to fire | right mouse | |
| Special (EMP or Ram, see 3.3) | Space | |
| Padlock camera (look at the target) | middle mouse / Tab | |
| Free look (hold) | C + mouse | |

**Keyboard only (classic).** Arrow keys fly: ↑ / ↓ pitch, ← / → turn (the craft banks into the turn
by itself). W / S / Shift / Q / E as above. J = cannon, K = missiles (hold, release), L = special,
Tab = padlock. Pitch convention follows the setting in section 8, question 3.

**Gamepad.**
| Action | Pad |
|---|---|
| Pitch + turn (auto-bank) | left stick |
| Roll (manual) | right stick X |
| Free look / padlock tap | right stick Y / R3 |
| Throttle / air brake | RT / LT (same as RACE) |
| Afterburner | X (same as RACE) |
| Cannon | RB (hold) |
| Missiles (hold, release) | LB |
| Special | Y |
| Barrel-roll dodge | B + left stick direction |

Input changes in `src/input.ts`: a new `FlightControls` object beside the race `Controls`
(`pitch`, `yaw`, `roll`, `rudder`, `throttle`, `brake`, `burner`, `dodge` (−1/0/1 edge), `cannon`,
`missile`, `special`, `padlock`, `aim` (a world direction, or null when not using the mouse)).
Pointer lock, `movementX/Y`, right and middle buttons and `contextmenu` suppression are added.

### 2.3 How aim-point flight works (the controller)
Every step:
1. The aim ring is a **direction in world space** (not a screen point), so it stays put when the
   camera shakes or rolls. Mouse movement rotates that direction (sensitivity in settings); it is
   clamped to 50° from the nose so you can never ask for the impossible.
2. In the craft's frame, take the aim direction's components: `up = D·craftUp`, `side = D·craftRight`.
3. **Roll** toward `atan2(side, up)` when the error is big (> 8°): bank, then pull. When the error is
   small, roll back toward wings-level instead (auto-level) and use rudder for the last few degrees.
4. **Pitch** command = `clamp(4 × asin(up), −1, 1)`; **yaw** = `clamp(4 × asin(side), −1, 1) × 0.25`.
5. A / D add manual roll on top and suspend auto-roll for 0.6 s after release.

Keyboard and pad turns use the same path: "turn right" becomes an aim direction 35° right of the nose,
so all three schemes share one flight model and feel the same.

### 2.4 Starting numbers (all in `CFG.flight`, tunable live with the G panel)

| Quantity | Start value | Note |
|---|---|---|
| Floor speed | Mach 0.9 (309 m/s) | engines never let you go slower: no stall |
| Cruise (no throttle) | Mach 2.4 (823 m/s) | the speed you settle to off W |
| Throttle (W) | Mach 3.4 (1,166 m/s) | |
| Afterburner (Shift) | pushes toward Mach 5.0 | energy-limited |
| Dive limit | Mach 6.2 | crossing 6.0 triggers the existing barrier silence + boom |
| Air brake (S) | toward Mach 1.1, rate 2.2 /s | +25% pitch rate while held |
| Pitch rate | 1.5 rad/s at Mach 1.4–2.6 ("corner speed"), falling to 0.85 rad/s at Mach 5 | the reason to brake into a fight |
| Roll rate | 3.6 rad/s | snappy, readable |
| Rudder | 0.35 rad/s | fine aim only |
| Velocity follows nose | `k = 5 /s` (burner 3, brake 7) | low k = slide, high k = rails |
| Climb / dive energy | `dv/dt = −14 × sin(flight-path angle)` m/s² | a 45° climb at cruise bleeds ~10 m/s per s |
| Turn bleed | 3% of speed per s at full pitch rate | |
| Barrel-roll dodge | 0.45 s, 140 m/s sideways, 0.2 s of no damage, 1.2 s cooldown | reuses the race dodge edges |
| Energy | 100; burner −22 /s; refills 12 /s after 0.8 s idle; +8 per kill, +10 per graze | one bar under the speed readout |
| Hull | 100; regen 4 /s after 4 s unhit | today's is 5 /s after 3 s |

Corner speed matters: at Mach 2 the craft turns a 2 km circle in about 4 s; at Mach 5 it takes
about 7 s. Fast is safe and scores more; slow turns tighter. That is the core flying decision.

### 2.5 Ground, ceiling and terrain
- **Ground cushion.** Below 25 m above ground, a spring (the race's hover spring, `CFG.handling.hover`
  and `hoverW`, re-used) pushes you up. Skimming the sand at Mach 3 is legal and looks great.
- **Hitting the ground.** Shallow contact (descent under 60 m/s) is a bounce with dust and a scrape,
  5 damage. Steeper is a crash: 35 damage and the existing crash tumble (`Player.crashStep` is
  ported, not rewritten), then you are put back in the air 80 m up, ghosted 1.5 s.
- **Rock** (mesas, buttes, spires, ice, basalt) is solid, using the same `world.near()` obstacle test
  `player.ts` uses, extended to check height (you can fly *over* a mesa now). Clipping a rock edge
  costs 15 and a shove; a head-on hit is a crash.
- **Soft ceiling 1,800 m above ground, hard ceiling 2,200 m.** Above 1,800 m the engines thin out
  (thrust falls to zero at 2,200 m) and the nose is gently pushed down. The HUD shows "THIN AIR".
  Why: the terrain's far ring ends about 24 km out (`world.ts`, ring specs `[400, 120, 11600]`), the
  sky dome and mountain ring are tuned for a camera near the ground, and fights read best when the
  ground is in view. Phase 1 confirms the ceiling with screenshots at 200, 800, 1,500 and 2,200 m on
  all three worlds; if the far ring edge shows, lower the ceiling or thicken the haze with height.
- **The 72 km wrap** (`rebase()` in `main.ts`) keeps working: everything that moves gets `shift()`.

### 2.6 How it ties into `player.ts`
`player.ts` is a ground model: a heading, a yaw rate, grip and slip, a hover spring, ballistic jumps.
Its orientation is heading + pitch + bank as separate numbers, and `drawRacer` sets
`craft.root.rotation.set(0, heading, 0)` and the body's pitch and roll. That cannot loop or fly
inverted. So flight is a **new class, `FlightCraft`, in `src/flight.ts`**, not more branches inside
`Player.step`.

| Re-use as is | Port (copy and adapt) | New |
|---|---|---|
| `MACH`, `groundH`, `world.near` | the crash tumble (`crashStep`, `onCrash*`) | quaternion orientation + angular rates |
| the Mach barrier callbacks (`onBarrier`, `onMach`) | hull, `sinceHurt`, regen, `ghost` | aim-point controller (2.3) |
| `shift(dx, dz)` | `topMach`, `boost` / `burning` for flames and sound | energy, ceiling, ground cushion |
| the race dodge edges from `Input` | | prev/current quaternions for interpolation |

`FlightCraft` exposes the fields the renderer, sound and HUD already read from `Player`
(`pos`, `prev`, `vel`, `fwd`, `right`, `speed`, `mach`, `hull`, `dead`, `boost`, `burning`, `brake`,
`throttle`, `agl`, `topMach`, `crashing`) plus `quat` and `prevQuat`. `drawRacer` gets one branch: a
flying craft sets `craft.root.quaternion.slerpQuaternions(prevQuat, quat, alpha)` and leaves the body
rotation at zero. Engine flames, trails and vapour then just work.

**The takeoff.** Every run starts as the race does, hovering on the ground at Mach 1.5. A "PULL UP"
prompt; the first pull lifts the craft, the fins swing out (a 0.6 s tween on the existing fin meshes
in `craft.ts`), a sonic thump, and you are flying. It is 3 seconds and it sells the idea that this is
the same craft doing something new.

### 2.7 Keeping it readable at Mach speed
- **Enemies fly near your speed** (Mach 2–3.6, section 4), so most fights have closing speeds of a few
  hundred m/s, not 2 km/s. Only head-on passes are fast, and they are telegraphed.
- **The camera keeps the horizon mostly level** (2.8). Your craft rolls; the world rolls only 35% as
  much.
- **A velocity marker** (where you are actually going) and a **nose cross** (where you point) on the
  HUD; the gap between them shows slide.
- **A thin horizon line and three pitch ticks** (±30°, ±60°), drawn only when the nose is more than
  20° off level, so you never lose "up".
- **Altitude ribbon** on the right, coloured red under 60 m and amber above 1,800 m.
- **Ground cues when low:** the craft's shadow (already in the ground shader, `uShadow`), a dust wake
  under 60 m (`fx.dust`), and the existing speed streaks.
- **A cloud layer** at 900–1,400 m: about 40 large soft billboards from the smoke pool's shader in their
  own instanced mesh, wrapped around the player. They give speed and altitude a reference in open
  sky. Off on tier low.
- **Bigger enemies.** At 1 km a 14 m drone is about 9 pixels at 720p. Enemy meshes are drawn at 2.5×
  today's drone scale (35 m span), each with an additive glint sprite so it reads as a coloured point
  at 4 km. Hit spheres stay honest to the mesh.

### 2.8 The flight camera (`src/flightcam.ts`)
A new `FlightCam` built from the same critically damped `Spring` (export it from `camera.ts`).
- **Position:** 14 m behind and 3.5 m above the craft, along a blend of 70% nose and 30% velocity, in
  the craft's up direction. Hard pulls make the camera lag, so the craft swings toward the outside of
  the turn on screen: you see the turn.
- **Orientation:** a quaternion spring toward the craft's orientation with roll scaled by 0.35 (a
  "horizon lock" setting goes from 0 to 1). Through a loop the up vector follows the craft smoothly, so
  there is no flip at the vertical.
- **FOV:** 72° at Mach 1 to the FOV setting (98° default) at Mach 5, plus the existing punch.
- **Padlock:** while held, the camera looks at the midpoint between the craft and the locked target,
  keeping the craft in the lower third. Releases with a 0.3 s ease.
- **Ground and rock:** the camera never goes under the ground or inside rock (same checks as
  `ChaseCam`).
- **Shake:** the existing trauma system, scaled down 40% in flight (aiming needs a steady frame).
  Reduce-shake setting still applies.
- **Crash cam:** the existing `ChaseCam` crash cam is used during a crash (switch cameras, as both
  write the same `PerspectiveCamera`).

---

## 3. The combat loop

### 3.1 The loop in one line
Find the flight → choose an angle (behind is safe, head-on is fast) → **lead** with the cannon or
**paint** a salvo → kill → keep the chain alive by moving straight to the next target → dodge what is
shooting at you → repeat, faster.

### 3.2 Weapons

**Pulse cannon (primary, always on).**
- 12 rounds/s from alternating wing roots; rounds fly at 2,600 m/s relative to you (they inherit your
  velocity), live 0.9 s, so the reach is about 2.3 km. 1 damage per round.
- **Heat:** firing adds 1 heat per second of fire; 3 s of steady fire overheats it for a 1.2 s lockout
  (with a loud vent). Released early, heat falls at 1.5 /s. Short bursts are better than holding.
- **Lead pipper:** for the locked or nearest-to-nose target inside 2.5 km, solve where it will be:
  relative position `r`, relative velocity `v` (target minus yours), round speed `s`; the smallest
  positive `t` with `|r + v t| = s t`; draw a small ring at `r + v t`. Put the pipper on the nose cross
  and fire.
- **Aim help:** rounds bend up to 2° toward a target near the pipper on Normal, 0° on Hard, 4° on
  Easy. Enough to forgive jitter, never enough to make the pipper pointless.
- **Tradeoff:** instant, unlimited apart from heat, needs real aim; the best damage per second
  close in.

**Seeker missiles (secondary, rationed).**
- **Hold to paint:** a large lock box (16° wide) on screen; each target inside it for 0.3 s gets a
  lock (a tone per lock), up to 4. **Release** to ripple-fire one missile per lock, 0.1 s apart.
  Releasing with no lock fires one dumb-fire missile straight ahead.
- **Rack of 8,** reloads one every 1.6 s (shown as 8 pips). You cannot spam it.
- 4 damage each. They arm after 250 m (fire point-blank and they fly past) and they can be
  decoyed by Flarer flares and broken by an Interceptor's jink (section 4). The existing missile code
  (lead, accel, turn rate, corkscrew visual, smoke trail) moves into `weapons.ts` unchanged.
- **Tradeoff:** fire-and-forget at range and against several targets at once, but rationed, beaten by
  flares, useless up close.

**Special (pick one per run on the HUNT card; see question 4).** Charged by kills and style
(about one use every 30–40 s of good play), shown as a ring around the reticle.
- **EMP burst:** a 900 m sphere. Kills Darts and swarm drones, strips shields, deletes enemy
  rounds in it, stuns the rest for 2 s. The defensive and crowd option.
- **Ram lance:** 2 s of a forward energy spike. While it is up and you are above Mach 3, flying
  through an enemy kills it (set-piece parts take heavy damage), and hits from the front are blocked.
  The aggressive, high-risk, high-score option (a ram kill counts as style).

### 3.3 Targeting and HUD
- **Brackets** on up to 8 enemies, the nearest and the most threatening first. Colour by archetype
  family (red attackers, amber shielded, violet support, gold set-piece parts). Distance under each.
- **Off-screen arrows** at the screen edge for the 3 most urgent enemies, plus the objective arrow.
- **Threat arcs:** a red arc at the screen edge in the direction of every round or missile that will
  pass within 60 m in the next 1.5 s. Missiles also get a rising warble.
- **"LOCKED" warning** (a red bar and a steady tone) when an enemy has a missile lock on you.
- **Bottom centre:** speed in Mach (big), energy bar, heat bar, missile pips, special ring.
- **Top right:** score, chain counter and multiplier, act and wave.
- **Objective line** (top centre): "ACT II · WAVE 3 · 6 LEFT" or "COMET CHAIN · 9 CARS".
- The existing lock diamond (`#lock` in `index.html`) becomes the paint box; the existing chevrons
  become brackets; `#warn` stays for banners.

### 3.4 What makes it skilful, not hold-to-win
1. **The cannon must be led.** Crossing targets cannot be hit by pointing at them (Phase 2 tests
   this).
2. **Heat** punishes holding fire; **the rack** punishes missile spam.
3. **Enemies answer the obvious play:** Wardens block front shots, Flarers beat lazy missiles,
   Interceptors punish flying straight, Sowers punish following a target's exact path.
4. **Angles matter:** shots into the engine (rear 60° cone) do double damage.
5. **Speed is score:** the multiplier pays you to fight fast, but turning is easier slow. Every fight
   is a choice between scoring and comfort.
6. **The chain** pays you to plan the next target before this one dies.
7. **The autopilot can no longer win by `fire = locked`.** If the scripted run in Phase 4 scores more
   than a "bronze" human, the design is too easy.

---

## 4. Enemies

All enemies **fly real paths**: a position, a velocity, a top speed and a turn-rate limit, steered by
small behaviours (pursue, evade, keep formation, avoid ground and rock with the existing `avoid` hook).
None is steered in the player's frame. An enemy left more than 9 km behind is not deleted for free:
it turns back and rejoins (ignoring a target never removes it). Enemy rounds are slower than yours
(1,400 m/s relative) and visible.

| # | Name | Speed | HP | Points | What it does | How you beat it |
|---|---|---|---|---|---|---|
| 1 | **Dart** | Mach 2.2–3.0, turn 1.1 rad/s | 3 | 100 | Flies in V-flights of 3–5 behind a leader. Pursues, fires 3-round bursts in a 10° front cone, breaks turn when shot at. | Cannon from behind. Kill the leader and the flight scatters (easier singles, but harder to chain). |
| 2 | **Lancer** | Mach 2.6, turn 0.6 rad/s | 6 | 150 | Head-on jouster. Lines up from 7 km ahead, glows for 1.2 s, then fires a thin beam that lasts 0.5 s along its nose (25 damage). Turns slowly after the pass. | Barrel-roll or pitch out of the line during the glow, then turn and kill it from behind while it is slow to come round. Or kill it head-on before it fires (fast and risky). |
| 3 | **Warden** | Mach 2.0, turn 0.5 rad/s | 10 | 250 | A wide shield disc in front blocks rounds and missiles from its front 120°. Escorts others and turns its shield toward you. | Overshoot it and come in from the side or rear; air-brake turns are the tool. EMP strips the shield. |
| 4 | **Flarer** | Mach 3.0, turn 1.4 rad/s, jinks | 4 | 200 | Evasive. Drops a flare when a missile is within 600 m (the flare pulls the missile off). Flares recharge 6 s; its flare pods glow when ready. | Cannon with good lead, or missiles fired just after it flares (pods dark). |
| 5 | **Interceptor** | Mach 3.6 (faster than your throttle) | 6 | 300 | Spawns behind you, closes, locks you (warning tone, 2 s), fires 2 missiles (15 each). Jinks to break your locks. | Shake it: air-brake so it overshoots, then shoot it in front of you; or fly low through rock so its missiles hit stone; or barrel-roll each missile at the last moment. |
| 6 | **Sower** | Mach 2.4, flies ahead of you | 5 | 200 | Lays curtains of floating proximity mines (12 per curtain, 2 s life, 8 damage) across your path. | Kill it before the curtain, shoot a mine to chain-pop the curtain (10 points each), or go round. Never follow its exact path. |
| 7 | **Hive** | Mach 1.6, turn 0.3 rad/s | 16 | 300 | A slow, armoured pod that releases 4 seeker motes every 5 s (homing, 6 s life, 5 damage, Mach 3.8 but turn badly; they hit rock). | Kill the pod first; outturn motes (they overshoot), drag them into rock, or EMP them. |
| 8 | **Flak Crown** (on mesa tops, does not move) | — | 12 | 250 | A turret ring on a mesa or berg top. Fills the sky above 400 m within 3 km with flak bursts (delayed-fuse puffs, 10 damage). | Fly low under its cone and pop up to hit it, or dive on it from above fast. It makes "low and fast" the safe line. |

**How they combine.**
- Darts + Warden: the shield screens the flight; you must break angle to hit anything.
- Interceptor + Sower: pressure from behind while the path ahead is mined. Don't fly straight.
- Hive + Flak Crowns: motes chase you down into the flak-free low zone, where the rock is.
- Lancer pairs from two sides: dodge one and you fly into the other's line unless you climb.
- Flarer escort around a set piece: missiles become unreliable exactly when you want them most.

**Escalation is behaviour, not just count** (per act, in `CFG.hunt.acts`): enemy round accuracy
(lead error from 12 m down to 4 m), fire intervals (−30% by Act III), shields up, mixes, and from Act
II one "ace" per wave (gold trim, +50% HP and speed, 2× points).

### 4.1 Set pieces (flying, not walking)

**The Comet Chain (mid-run, ~70 s).** A train of 14 linked drone cars flies low (40 m above ground)
at Mach 2.8, snaking between mesas, ice bergs or basalt spires along a path that bends round the
world's rocks (same avoidance as today's runners). Every third car carries a turret firing back
along the train; the head car (the "engine") is shielded until 6 cars are destroyed. Killing a car
detaches the ones behind it: they spin, slow and become obstacles you must thread. The head then
climbs and tries to run for the clouds; kill it before it reaches 1,800 m.
- Skill tested: matching speed and staying low on a moving target's path, picking cars off
  without overrunning it, threading the debris.
- Cost: one car mesh (instanced), a spline-follow along the head's trail (each car follows the
  head's recorded positions, like a snake), turrets reuse the Dart's fire code.

**The Lantern (finale, ~2–2.5 min).** A flying carrier 600 m long, cruising at Mach 1.4 at 900 m,
with a glowing hangar spine.
- **Phase 1 — the screen:** 4 engine pods (12 HP each, double damage from behind), 2 Flak Crowns on
  its back, Darts launched in pairs from the bay. Each pod lost makes it list and sink 150 m.
- **Phase 2 — the bay:** with the pods gone it drops to 500 m and opens the bay to launch Hives; the
  bay core (20 HP) only takes damage while the doors are open (6 s open, 8 s shut). Fly through the
  open bay for a style bonus (and a lot of risk).
- **Phase 3 — the fall:** the bridge core is exposed (24 HP) and the carrier dives toward the ground
  firing everything. Kill the bridge and it breaks in two, slow motion, and ploughs into the world:
  across mesas on RED MESA, through the shelf ice on POLAR SHELF, into the lava sea on CINDER. A
  shockwave ring (the existing `shock.ts`) and the one kill cam of the run (section 6).
- Cost: one hull model built in code like the ships (`shipgeo.ts` style), 8 or so sub-meshes for
  parts, a scripted path, reused turrets and spawners.

---

## 5. Structure

### 5.1 A run
A run is one sortie in one world's sky (see question 1 for chaining all three). Times are targets.

| Time | Beat | Content |
|---|---|---|
| 0:00–0:10 | Takeoff | Hover at Mach 1.5, PULL UP, fins out, climb through 3 rings (they teach pitch and roll). |
| 0:10–2:20 | **Act I — Scramble** | 4 waves: Darts (cannon prompt), Darts + Lancer (dodge prompt), Flarers (missile prompt), Darts + Warden. Prompts show once ever, then only on the first run of a session. |
| 2:20–3:30 | **Comet Chain** | Set piece 1. |
| 3:30–6:00 | **Act II — Pressure** | 4 waves with Interceptors, Sowers, Hives, Flak Crowns, aces. Each wave has a one-line bonus ("kill the Warden first", "no missiles"), +1,000. |
| 6:00–8:30 | **Act III — The Lantern** | 1 escort wave, then the carrier's three phases. |
| ~8:30 | Results | Score breakdown, medal, best, "again" and "title". |

Between waves: a 3 s breather (as today). The director drives each wave along a **sortie vector**,
a world heading shown by the objective arrow, so you always travel somewhere: waves meet you ahead
of you and set pieces appear on the horizon 12 km out. The vector bends between acts to cross
different terrain (canyons, open ice, a lava field).

The run is **seeded** (`rng()` from `world.ts`), so the same seed gives the same waves (a daily
seed is a later, cheap extra).

### 5.2 Each world's sky
- **RED MESA:** clear blue sky and high cumulus. Mesas and buttes are the cover; Flak Crowns sit on
  mesa tops. Thermals (invisible lift columns marked by a dust devil at their base) give a free climb.
- **POLAR SHELF:** twilight and aurora, long views. Shard fields and bergs are the low cover. Cold fog
  banks at 200–400 m hide enemies until 1.5 km (their brackets still show).
- **CINDER:** ash sky, low visibility (enemy brackets matter more). Ash plumes rise from the lava
  and block sight; lava vents give strong updrafts.

Hazards are light touches (a few per act), not a new system each. Phase 7 adds them.

### 5.3 Scoring
For each kill:
`points = base (table above) × speed × chain × style`
- **Speed multiplier** = `clamp(0.5 + 0.5 × Mach, 1, 3.5)` at the moment of the kill: Mach 1 → ×1,
  Mach 3 → ×2, Mach 5 → ×3, Mach 6 → ×3.5. Keeps today's "points × Mach" idea, tuned to the new speed
  band.
- **Chain:** each kill within 3.5 s of the last adds a step; multiplier `1 + 0.25 × steps`, up to ×4
  (12 steps). Style events add 0.75 s to the window. A hit of 10 damage or more halves the steps
  (it does not zero them). The chain counter and its draining window sit by the score.
- **Style** (each +50%, they stack additively, shown as a word under the kill pop):
  LOW (under 60 m above ground), REVERSAL (the target was behind you in the last 2 s), HEAD-ON
  (cannon kill closing faster than Mach 3), SWEEP (all 4 missiles of a salvo kill), RAM, THREAD
  (through a gap or the Lantern's bay while chaining), BOOM (crossing Mach 6 while chaining).
- **Graze:** an enemy round passing within 15 m without hitting: +25 and +10 energy.
- **Act bonuses:** clear time against a par, no-damage, wave bonus objectives.
- **End:** hull left × 20, the Lantern kill 10,000.

**Medals** per world: bronze / silver / gold / apex, thresholds set in Phase 4 from play-tests
(starting guess: autopilot score × 1.0 / 1.6 / 2.3 / 3.0).

### 5.4 Death, retry, bests
- **One hull per run.** At 0 you are shot down: the existing crash tumble and SIGNAL LOST.
- **Retry from the act** (see question 5): restart the current act with the score you had when it
  began; the result is marked "with retries" and does not count for the best. **Shift+R** restarts the
  whole run in under a second (no reload).
- **Bests** in `localStorage`, guarded with try/catch as today (`bestOf`, `main.ts`):
  `dbu-hunt-best-<world>-<difficulty>` (score, medal, time) and `dbu-hunt-act-<world>-<n>` (best per
  act). The HUNT card on the title shows the best and medal for the selected world.
- **Difficulty:** EASY / NORMAL / HARD on the HUNT card: damage taken (×0.6 / ×1 / ×1.4), aim help
  (4° / 2° / 0°), enemy accuracy. A hidden mercy: if hull is under 25, the next spawn waits 3 s.

---

## 6. Feel and juice

### 6.1 Speed and motion
- Speed streaks (`post.ts`, `uStreak`) scale with Mach as today; radial blur during the burner.
- Wingtip vapour trails (`trails.ts`) on pulls above 70% pitch rate, and always above Mach 4.
- Dust wake and rooster tail under 60 m (`fx.dust`), ice spray on POLAR SHELF, embers on CINDER
  (the race already does the last two for the player in `drawRacer`).
- The cloud layer (2.7) streams past; flying through a cloud gives 0.2 s of white haze.
- The Mach 6 barrier beat (silence, white-out, boom) is kept for dives.

### 6.2 Hits and kills
- **Cannon hits:** a spark and a short tick sound on every hit (so you hear you are on target); the
  bracket flashes white.
- **Kill:** explosion (`fx.explosion`), the wreck falls and burns (existing drone wreck code), a pop
  with points and the style words. **Hit-stop 0.03 s** on normal kills (today 0.05 s; at 12 kills a
  minute a longer stop feels like stutter), 0.08 s plus a 0.5 s slow-mo on aces, set-piece parts and
  sweeps.
- **Being hit:** red edge flash in the hit's direction, camera kick away from the hit, a heavy
  thump, pad rumble (`input.rumble`).
- **The kill cam:** once per run, the Lantern's death. 1.8 s at 25% speed, the camera orbits the
  breaking hull (spring orbit like the crash cam), then snaps back behind you. Any fire input skips it.
  No other kill cams (they break the flow at Mach speed).

### 6.3 Audio (`src/audio.ts`)
Keep everything procedural or from the CC0/CC-BY sets already credited.
- New cues: cannon (a short noise burst plus a pitched click, alternating left/right pan), heat whine
  and vent, paint tone per lock (rising), salvo release, "locked on you" steady tone, incoming missile
  warble rising with closeness, graze whoosh (`whoosh` exists), shield deflect ping, mine curtain hum,
  carrier horn.
- Flight engine: the existing engine loop, with pitch from Mach and a wind layer that rises with
  pitch rate (you hear the pull).
- Music: the existing sections. `drop` for Acts I and II, `break` in breathers and the takeoff,
  `final` for the Lantern. The chain at ×3 or more raises the music bus 2 dB.
- Re-use from the walker: `cannon`, `charge` and `shockwave` sounds move to the Lantern;
  `footfall` is deleted.

### 6.4 Performance budget
Baseline (`docs/PERF_LOG.md`): combat today runs at 60 fps, 60 draw calls, ~800k triangles, ~1,500
particles on an M-series Mac at tier high. The target is the same smoothness on a low-end laptop at
tier low.

| Thing | Cap | How |
|---|---|---|
| Live enemies (not counting parts) | 16 (tier low: 12) | pooled; the director never exceeds it |
| Enemy meshes | 1 hull + 1 glow `InstancedMesh` per archetype family (4 families) | ≤ 8 draw calls for all enemies |
| Player cannon rounds | 64 pooled | one instanced mesh |
| Missiles (yours + theirs) | 24 + 16 pooled | existing pool pattern |
| Enemy rounds, mines, motes | 120 / 48 / 24 pooled | one instanced mesh each |
| Set piece | ≤ 40k triangles, ≤ 12 draw calls | parts are child meshes of one group |
| Particles | ≤ 1,800 live on average, ≤ 3,000 peak (pools are 2,600 glow + 3,200 smoke) | effects scale by `settings.part`; tier low halves them |
| Clouds | 40 billboards, 1 draw call | off on tier low |
| Draw calls total | ≤ 100 | measured with `renderer.info` via `__g.stats()` |
| Triangles | ≤ 5% above today's 800k | |
| Sim CPU | ≤ 2 ms per 60 Hz step with every cap full | no allocation in `step()`; rock checks per enemy every 4th step, staggered |
| HUD DOM writes | brackets reuse elements; write only on change | as the chevrons already do |

Every phase adds its heaviest scene to `docs/PERF_LOG.md` at tier high and tier low, plus a tier-low
run with 4× CPU throttling (Playwright CDP `Emulation.setCPUThrottlingRate`, as `tools/cpu.mjs`
measures CPU cost per frame).

---

## 7. Build plan

**Rules for every phase.** No paid assets or services and no paid AI/LLM APIs (geometry, shaders and
most sound stay procedural; any outside asset is CC0 or CC-BY and credited in `CREDITS.md` in the same
commit). `npm run build` passes. `node tools/hunt.mjs` (rewritten in Phase 1) passes. All tunables go
in `CFG.flight` / `CFG.hunt` so the G panel can edit them. Test hooks go on `window.__g`. Each phase is
playable on its own.

New files at a glance:
```
src/flight.ts          FlightCraft: quaternion flight model, ground cushion, ceiling, crash port
src/flightcam.ts       FlightCam
src/hunt/hunt.ts       the run: takeoff, acts, waves, director, sortie vector, results
src/hunt/weapons.ts    cannon, missiles, special, rounds (moves the pools out of combat.ts)
src/hunt/enemies.ts    archetypes, behaviours, pooled instanced drawing
src/hunt/score.ts      chain, style, speed multiplier, medals, bests
src/hunt/hud.ts        brackets, pipper, paint box, threat arcs, bars, ribbons
src/hunt/chain.ts      the Comet Chain
src/hunt/lantern.ts    the Lantern
tools/flight.mjs       scripted manoeuvre checks
tools/altshots.mjs     altitude screenshots per world
tools/huntaim.mjs      weapon checks
```
`src/combat.ts` and `src/walker.ts` are gone by the end of Phase 3.

### Phase 1 — Fly (and remove the walker)
**Deliverables**
- `FlightCraft` with the numbers in 2.4, ground cushion, ceiling, rock collision with height, the crash
  port, the takeoff.
- `FlightCam` with horizon lock, padlock stub, FOV, shake.
- `FlightControls` for mouse (pointer lock), keyboard and pad.
- HUD: speed, energy, altitude ribbon, velocity marker, nose cross, horizon ticks, aim ring.
- HUNT starts as a **free-flight sandbox**: takeoff, then 10 fly-through rings at varied heights
  ahead (instanced tori; they become the takeoff rings later). No enemies.
- **Walker removal:** delete `src/walker.ts`; remove its imports, `walker.*` calls, `walkerDone`,
  `onCoreLost` / `onFall` / `onDown`, `huntAutopilot`'s walker branch, the `WALKER` HUD and arrow
  code, `spawnWalker` / `walkerNear` / `killCores` from `__g` (all in `main.ts`); `uWalker` and its
  shader block in `world.ts`; `walkerAfterKills` / `walkerAfterSeconds` in `config.ts`; `fireOrb`,
  orbs and `extraTargets` in `combat.ts`; `audio.footfall`. Keep `cannon` / `charge` / `shockwave`
  sounds for the Lantern. Old waves keep running in the sandbox only if trivial; otherwise HUNT is
  flight-only until Phase 2.

**Files:** new `src/flight.ts`, `src/flightcam.ts`; edit `src/input.ts`, `src/config.ts`,
`src/main.ts`, `src/camera.ts` (export `Spring`), `src/craft.ts` (fin tween), `src/world.ts`,
`src/combat.ts`, `src/audio.ts`, `index.html` (HUD elements); delete `src/walker.ts`.

**Automated checks**
- `tools/flight.mjs`: through `__g.flyForce(controls)` (scripted `FlightControls`, the same path as
  `__g.force` for the race), run manoeuvres and assert:
  - level flight with no input stays within ±20 m of altitude for 10 s (auto-level works);
  - a full loop at Mach 2 completes in 3–6 s and ends within 15° of the start heading;
  - a 360° roll takes 1.5–2.0 s;
  - a dive to the ground at 30° never goes below the ground and never NaNs; at 70° it crashes;
  - holding climb for 60 s never passes 2,200 m above ground;
  - burner holds then drains energy to 0 and stops; speed never below Mach 0.9 or above 6.2;
  - `quat` stays normalized (|q| within 1 ± 1e-4) over 5 min of random input;
  - a 72 km wrap during flight keeps the camera continuous (no jump over 1 m in a frame).
- `tools/altshots.mjs`: screenshots at 200 / 800 / 1,500 / 2,200 m, level and 30° nose down, on
  `?course=` one track per world. Reviewed by eye for the far ring edge, haze and mountain ring.
- `tools/hunt.mjs` rewritten: starts HUNT, flies the rings with a ring-seeking autopilot, asserts all
  10 rings hit, no page errors.
- Perf row: free flight at 800 m and at 30 m over mesas.

**Done when:** a person can take off and fly all 10 rings in under 90 s with mouse, keyboard only and
pad; all checks pass; no reference to the walker is left (`grep -ri walker src` is empty); frame time
unchanged from the race at the same tier.

### Phase 2 — Shoot
**Deliverables**
- Pulse cannon with heat and lead pipper; seeker missiles with paint, rack, arming distance; engine
  (rear-cone) double damage.
- HUD: brackets, pipper, paint box, heat bar, missile pips, hit flash, off-screen arrows.
- One enemy: the **Dart**, with real flight, formation and break-turns, and its bursts. Threat arcs
  and the hit feedback for it.
- A "practice" wave in the sandbox (`__g.spawn('dart', n)`).
- Move the missile, round and wreck code out of `combat.ts` into `hunt/weapons.ts` and
  `hunt/enemies.ts`.

**Files:** new `src/hunt/weapons.ts`, `src/hunt/enemies.ts`, `src/hunt/hud.ts`; edit `src/main.ts`,
`src/input.ts`, `src/audio.ts`, `src/config.ts`, `index.html`.

**Automated checks** (`tools/huntaim.mjs`)
- A target crossing at 90° at Mach 2, 1.2 km away: firing at the **pipper** hits at least 70% of
  rounds; firing at the **target itself** hits under 20%. (Proves the lead matters and is right.)
- 3.1 s of held fire overheats; nothing fires during the lockout.
- 5 salvos in a row: at most 8 missiles leave, then 1 per 1.6 s.
- A missile fired at a target 150 m away does not hit it (arming).
- 4 Darts, 4 locks, release: 4 missiles, 4 different targets.
- Darts never pass through the ground or rock in 60 s of autopilot combat (log min height above
  ground per Dart).
- Perf row: 16 Darts, all firing, plus your cannon and a full salvo.

**Done when:** killing a flight of 5 Darts with the cannon alone feels like aiming, not pointing
(play-test note), and all checks pass.

### Phase 3 — The roster
**Deliverables**
- Lancer, Warden, Flarer, Interceptor, with their telegraphs, shields, flares and missile locks.
- The "LOCKED" warning, missile warble, graze detection, barrel-roll dodge with no-damage window.
- Hull, damage, being shot down, SIGNAL LOST, quick restart.
- `src/combat.ts` deleted.

**Files:** `src/hunt/enemies.ts`, `src/hunt/weapons.ts`, `src/hunt/hud.ts`, `src/audio.ts`,
`src/main.ts`, `src/config.ts`; delete `src/combat.ts`.

**Automated checks**
- Per archetype, a scripted duel (`__g.spawn(kind)` + a scripted player): Warden takes no damage
  from 40 rounds fired into its front, full damage from behind; a Flarer decoys a missile fired when
  its pods glow and is hit by one fired when they are dark; a Lancer beam hits a craft that holds
  still and misses one that barrel-rolls in the glow window; an Interceptor's missiles miss a
  scripted last-moment roll at least 70% of the time.
- A 3-minute soak with all four types respawning: no errors, enemy count never over the cap, no
  enemy farther than 12 km for over 10 s (rejoin works).
- Perf row: the worst mix at the cap.

**Done when:** each archetype is beaten by its intended answer in play-tests and checks, and dies
to "hold fire and point" noticeably less often than to the intended answer.

### Phase 4 — The run
**Deliverables**
- `hunt.ts` director: takeoff rings, Acts I–III as waves (the Lantern slot is a placeholder "boss
  wave" of aces for now), breathers, sortie vector and objective arrow, prompts, seeded spawns.
- Sower, Hive, Flak Crown (placed on real mesa/berg tops from `world.near`).
- `score.ts`: speed × chain × style, graze, act bonuses, results screen with a breakdown, medals,
  bests per world and difficulty, retry-from-act.
- HUNT card on the title: world, difficulty, special pick, best and medal.

**Files:** new `src/hunt/hunt.ts`, `src/hunt/score.ts`; edit `src/hunt/enemies.ts`, `src/main.ts`
(`startHunt`, `showHuntOver`, menu), `index.html`, `src/config.ts`.

**Automated checks**
- `tools/hunt.mjs`: a full run on autopilot (it flies the sortie vector, leads the pipper with a
  small error, paints and fires) on each world; asserts it reaches Act III and the results screen,
  logs score, time, deaths, kills per type; and asserts the run time is 6–10 min on NORMAL.
- Best score persists after a reload; a "with retries" run does not overwrite it.
- Same seed twice gives the same spawn log.
- Chain unit check: scripted kills 3 s apart reach ×4 at 12; a 10-damage hit halves it.
- `tools/playtest.mjs` gains `MODE=hunt`: drives real keys and mouse (pointer-lock-free fallback
  via the keyboard scheme), records video, screenshots every 10 s.

**Done when:** a run starts, escalates and ends; the autopilot finishes it; scores and medals save;
play-tests put the median first-run length at 6–10 minutes.

### Phase 5 — The Comet Chain
**Deliverables:** the train (head + 14 cars on the head's trail), turrets, the head's shield, car
detachment into tumbling obstacles, the climb-and-run end, its music beat, banners and HUD line.

**Files:** new `src/hunt/chain.ts`; edit `src/hunt/hunt.ts`, `src/hunt/hud.ts`, `src/audio.ts`.

**Automated checks:** the train stays 25–80 m above ground and never inside rock for 3 min on each
world; detached cars collide with the player; `__g.chainKill()` completes the set piece and the act
continues; perf row with all cars, turrets firing and debris.

**Done when:** it takes a good player 50–90 s and the head's escape is a real fail case
(it escapes in some play-tests, not most).

### Phase 6 — The Lantern
**Deliverables:** the carrier model in code, the three phases, the bay fly-through, the fall into
each world's ground, the shockwave, the kill cam, the music climb, the results hand-off.

**Files:** new `src/hunt/lantern.ts`; edit `src/hunt/hunt.ts`, `src/shock.ts` (if the ring needs
size), `src/flightcam.ts` (kill cam), `src/audio.ts`.

**Automated checks:** `__g.lanternPhase(n)` jumps to each phase; the bay core takes damage only with
the doors open; the full fight on autopilot ends in 90–180 s; the fall plays on all three worlds
without errors; particles at the peak under 3,000; perf rows for each phase and the fall.

**Done when:** the Lantern's death is the run's high point in play-test notes (the job the walker's
collapse used to do), and every check passes.

### Phase 7 — Polish, worlds and reach
**Deliverables:** the per-world hazards (thermals, fog banks, ash plumes, vents), the cloud layer,
the special (EMP and Ram), aces, the wave bonus objectives, the full audio pass, onboarding prompts
tuned, difficulty tuning, a gamepad pass, tier-low tuning. If question 1 picks it: the Grand Sortie.
Update `docs/DESIGN.md` (HUNT section, controls table) to match.

**Automated checks:** a full run on each world at tier low with 4× CPU throttle: p95 frame time at or
under 16.8 ms on the reference machine, no errors; the whole Phase 1–6 suite again.

**Done when:** three play-testers finish a NORMAL run on each world, and none of them asks "what was
I supposed to do?".

---

## 8. Risks and open questions

Each is answerable with a pick. My lean is marked.

1. **Worlds in one run.** The world is fixed when the page loads (`BIOME` in `terrain.ts` comes from
   the URL; shaders compile with it), so switching worlds mid-run means a page reload (its length is
   not measured yet; time it before choosing B).
   A) One world per run, picked on the HUNT card (lean) · B) A "Grand Sortie" that chains all three
   worlds, the reload hidden behind a climb into white cloud, state carried in `sessionStorage` ·
   C) A now, B in Phase 7.
2. **Default mouse scheme.** A) Aim-point flight (the craft flies to the ring) (lean) ·
   B) Mouse as a virtual stick (moves the nose directly; more raw, harder) · C) Both, as a setting,
   A by default.
3. **Pitch on arrows and sticks.** A) Down / stick back = nose up, like a plane · B) Up = nose up ·
   C) A setting, defaulting to A (lean).
4. **The special.** A) EMP only · B) Ram only · C) Pick one per run on the HUNT card (lean) ·
   D) No special.
5. **Death.** A) One hull, restart the run · B) Retry from the act start; retries do not count for
   the best (lean) · C) Three lives per run.
6. **Speed band.** The main risk to aiming. A) Fights at Mach 2.4–3.4, burner to 5, dives to 6
   (lean: readable, still fast) · B) Fights at Mach 4–6 like the race (rawer, much harder to aim,
   enemies must be bigger) · C) A, then try B as an APEX difficulty once the rest is built.
