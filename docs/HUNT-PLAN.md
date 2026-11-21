# HUNT — refinement plan

Status: a plan to choose from, not a decision. Nothing here is built yet.
Written 2026-11-21 from a read of the code. Line numbers are as of that date; `src/main.ts` is being
edited, so its numbers may drift by a line or two.

---

## 1. What HUNT is today

### The loop
1. Pick the HUNT tab on the title (or press H) and START. `startHunt()` (`src/main.ts:998`) resets the
   player in place, hides the race course and the AI rivals, shows the score box and the reticle,
   and kicks you off at Mach 0.6 (`main.ts:1032`).
2. A wave director (`src/combat.ts:354-394`) queues drones per wave:
   - **holders**: `2 + wave` of them, at most `pressure` (3) alive at once;
   - **passers**: `wave` of them, from wave 2 on, and only spawned while you are above Mach 1.2;
   - **runners**: `1 + floor(wave / 2)`.
3. A wave is cleared when its queue is empty and nothing is alive. You get `250 × wave` and a 3.5 s
   breather (`combat.ts:356`, `main.ts:457`).
4. When wave 4 starts, the waves pause and the **Walker** spawns 15 km ahead (`main.ts:450-456`,
   `walker.ts:188`). Kill its four cores and it collapses. Then the waves resume with `pressure = 4`
   (`main.ts:479`).
5. After that the waves go on forever. The run ends only when you die (`main.ts:624`): SIGNAL LOST,
   with score, top speed, drones down and time.

### Weapons and lock
- One weapon: homing missiles from alternating rails, **unlimited**, every 0.28 s
  (`config.ts:108`, `combat.ts:296-313`).
- Lock is automatic: the target nearest the nose inside an 18° cone (`lockCone 0.32` rad), within
  7 km, locks after 0.42 s (`combat.ts:473-496`, `config.ts:102-104`). An unlocked missile flies
  straight.
- Missiles lead their target, accelerate, and corkscrew visually (`combat.ts:500-539`, `604-636`).

### Enemies
| Type | Behaviour | HP | Points | Where |
|---|---|---|---|---|
| Holder | Flown **in the player's frame**: it parks 700–1,600 m ahead of you and weaves, firing red bolts (7 damage) | 1 | 100 × Mach | `combat.ts:429-453` |
| Passer | Head-on from 7 km out, fires a few bolts, passes and is gone | 1 | 100 × Mach | `combat.ts:454-469` |
| Runner | Flees at 1.04× your speed (capped Mach 3.2–5.6), weaves and swerves round rock, escapes at 12 km | 2 | 300 × Mach | `combat.ts:415-428` |
| Walker | 360 m tall (modelled at 150 m, scaled ×2.4), two IK legs, walks at you at 55 m/s, fires a telegraphed 3-orb leading volley (28 damage each) every ~3 s; 4 cores × 3 HP | — | 500 per core, 5,000 down | `walker.ts`, `main.ts:477-479` |

### Survival
- Hull 100. Bolts do 7, orbs 28 (`combat.ts:552`). The hull regenerates 5 per second after 3 s
  without a hit (`player.ts:218`). Crashing into rock also costs hull (`player.ts:588`).
- Death is the end of the run; there are no lives and no respawn in HUNT.

### HUD and feel
- Score box top-right: the number, plus `WAVE n · n LEFT · time`, or `WALKER · n DOWN`
  (`main.ts:1888`, `index.html:226`).
- A red chevron with distance over every visible enemy, gold for runners, at most 14
  (`main.ts:392`, `main.ts:~1893`). An edge arrow to the walker or the nearest runner.
- The lock diamond wobbles, shrinks as the lock builds and fills red when locked
  (`main.ts:~1908-1919`, `index.html:68-71`).
- `#warn` flashes WALKER / RUNNER banners (`index.html:229`). Kills pop `+points  DRONE DOWN ×Mach`
  with a 0.05 s hitstop (`main.ts:443`).
- Music goes to its `final` section while the walker is up (`main.ts:1728`).

### What is good (keep it)
- **Points × Mach** (`combat.ts:291`) is exactly the right idea for this game: it pays you to stay fast.
- **Runners** are the one enemy that uses the game's real skill (driving fast through terrain).
- **The walker's collapse** is the best moment in HUNT: the slow-mo topple, the explosions, and the
  shockwave that catches you from behind and *throws you forward* (`walker.ts:327-338`).
- The lock diamond, the corkscrew missiles and the hitstop already feel good.
- Performance is healthy: combat runs at 60 fps with 60–82 draw calls (`docs/PERF_LOG.md:11-13`).

### What is weak, thin or broken
1. **There is no ending.** The run only ends on death (`main.ts:624`). `showHuntOver()` checks
   `walkerDone && !player.dead` to say WALKER DOWN (`main.ts:947`), but it is only ever called after
   `die()`, so that headline can never show. After the walker, waves repeat forever with nothing new.
2. **The weapon asks no decisions.** Unlimited missiles, a 0.28 s cooldown and auto-lock on whatever
   is nearest your nose mean the best play is "hold Space and point". The autopilot proves it:
   `input.fire = combat.locked` (`main.ts:1307`). There is no reason to fire unlocked, no ammo,
   no heat, no salvo, no choice of target.
3. **Holders ignore your driving.** They are steered toward a point in *your* frame
   (`combat.ts:431-438`), so they keep pace whatever you do. Speed, drifting and lines barely matter
   against them. Out-turning one just deletes it with no reward or cost (`combat.ts:453`).
4. **Difficulty only scales the count.** Wave N has more drones (`combat.ts:360-362`), but they are
   the same drones: same HP (1), same accuracy, same bolt damage. Wave 10 is wave 2 with more chevrons.
5. **The walker is one fight, once, and easy.** It spawns once per run (`walkerDone`, `main.ts:450`).
   Its cores have a 72 m hit radius (`walker.ts:31`) and 3 HP each, so 12 missiles (about 3.5 s of
   fire) kill it. It has one attack and no phases, and it plods toward you at 55 m/s.
6. **Scoring has no shape.** No combo or chain, no time pressure, no medal or grade, and no saved best
   for HUNT (RACE has `dbu-best-*`, `main.ts:70`). A score with nothing to beat is just a number.
7. **No onboarding.** The only explanation is one line on the title (`index.html:241`). The control
   hints are only shown by `startRace()` (`main.ts:994`). The fire key is never shown in a hunt.
8. **The map is the race map without the race.** HUNT hides the course (`main.ts:1612`) and plays on
   whatever world is loaded, tiled every 72 km (`config.ts:11`, `rebase()` in `main.ts`). The title says
   "open desert", but on POLAR SHELF it would be ice. There are no hunt landmarks or arenas.
9. **Threat readability is thin.** Nothing tells you a bolt or orb is coming from behind or the side,
   no "being locked" warning, no hull-low warning beyond the hull bar.
10. **Loose ends.** `walkerAfterKills` and `walkerAfterSeconds` in `config.ts:110-111` are unused.
    `walker.ts:1` says "150 m" but the walker is 360 m. Scripted controls (`forced`) cannot fire,
    because `combat.step` reads `input.fire`, not the controls (`main.ts:1277`), which makes HUNT
    hard to test with `window.__g`.

**In one line:** HUNT has great raw parts (speed-scaled points, runners, a spectacular walker death)
but no shape: no goal, no ending, no decisions in the weapon, and enemies that do not care how well
you fly.

---

## 2. Design pillars (pick one as the spine)

Each option is a different answer to "what is HUNT for?". They can borrow from each other, but one
should be the spine.

### A. QUARRY — the chase
- **Fantasy.** You are the fastest thing alive, and something is trying to outrun you anyway.
- **Core loop.** A marked target flees across the world at Mach 4–6 → you close the gap through
  canyons, spires and dunes → line up a lock in a short window → it breaks, dodges, drops decoys →
  you finish it → the next quarry is faster and smarter. A run is a set of 5–8 quarries against a clock.
- **Why it fits.** It is a race where the rival is prey. Every racing skill (lines, drafting, the
  afterburner, drifting round rock) becomes hunting skill. It grows straight out of the runner, the
  part of HUNT that already works.
- **Risks.** AI that flees well through terrain at Mach 5 is the hard part. If it is too good, the
  chase is frustrating; too weak, it is a formality. It can feel like a one-rival race unless the
  quarries differ (decoys, burrowing, splitting, leading you into an ambush).

### B. COLOSSUS — the boss hunt
- **Fantasy.** Tiny and fast against machines the size of buildings.
- **Core loop.** A run is 3 colossi in a row (walker, then a crawler or a flyer, then a final one).
  Each has phases, weak points that need an approach angle (under the belly, behind the knee, a
  vent that only opens after it fires), and an escort. Flying between its legs at Mach 5 is the move.
- **Why it fits.** Scale reads best at speed: a 360 m machine is a speck at 15 km and a wall at
  300 m. The walker collapse already proves this is the game's most memorable moment.
- **Risks.** Content-heavy: each boss is a model, an animation rig, attacks and phases. Readability at
  a distance, and fairness of big attacks at Mach 5, need care. Low replay value per boss once learned.

### C. BOUNTY RUN — the open map
- **Fantasy.** A desert full of contracts and a clock. Where do you go first?
- **Core loop.** The map shows 6–10 bounties (a runner, a convoy, a drone nest, a walker, a
  cache). You plan a route, fly between them at Mach 6, clear what you choose, and bank the total
  before time runs out. Bonus for chaining bounties without dropping below Mach 3.
- **Why it fits.** It turns the world's size into the point. Route-picking is racing-line thinking
  at map scale.
- **Risks.** Most of the work is new content and map UX (a hunt map, markers, routes). Open worlds
  feel empty if the bounties are thin. Travel time between fights can be dead time.

### D. LAST STAND — survival escalation (today's mode, done properly)
- **Fantasy.** The desert keeps sending more, and you keep getting faster.
- **Core loop.** Endless waves with real escalation (new enemy types, tougher behaviour, a walker every
  5 waves, each one meaner), a notoriety meter that raises the threat and the points multiplier,
  and a best score to beat.
- **Why it fits.** Cheapest step from today; endless arcade score-chasing suits a game about
  speed numbers.
- **Risks.** It is the most generic option. Combat in a racer becomes a shooting gallery unless the
  enemies demand flying. Endless modes need very good escalation design to avoid a slow middle.

### My lean (not a pick)
**A as the spine, B for the climax, D's escalation and scoring inside it.** A run = a handful of
quarries that teach and test the chase, ending with a walker that has phases. It reuses what already
works (runners, Mach-scaled points, the walker death), it fixes the biggest flaw (enemies ignoring how
you fly), and it gives the run an ending. C is the most ambitious and is a good "later" mode.

---

## 3. Feature menu

Cost: **S** = a day or less, **M** = a few days, **L** = a week or more. Impact: how much it changes
how HUNT feels.

### Weapons and lock-on
| Idea | Cost | Impact | Notes |
|---|---|---|---|
| Lock tiers: lock 1–4 targets by holding fire, release to ripple a salvo | M | High | Turns "hold Space" into "hold, sweep, release". Classic, readable. |
| Missile heat (or 6-round rack that reloads) | S | High | One number makes firing a decision. |
| Lock speed scales with *your* Mach and closure (faster lock when close and fast) | S | Med | Rewards committing to the chase. |
| A forward cannon for unlocked shots (short-range tracer) | M | Med | Something to do inside 400 m, where missiles overshoot. |
| Afterburner ram: hitting a weakened target at Mach 5+ kills it | S | Med | Pure speed fantasy; needs a clear "weakened" glow. |
| Missile-cam: the camera briefly follows a killing missile (only the last one of a wave) | M | Med | Big payoff moments; must be skippable and rare. |

### Enemy types
| Idea | Cost | Impact | Notes |
|---|---|---|---|
| Holders fly real flight paths (pursuit with a turn limit) instead of the player-frame spring | M | High | Lets you out-fly them; needs `combat.ts:429-453` rewritten. |
| Quarry runner: decoy flares, sudden breaks, canyon dives, splits in two at half HP | M | High | The heart of pillar A. |
| Interceptor: lead-pursues you from behind; must be shaken by drifting round rock | M | High | Makes the "threat from behind" real and uses handling. |
| Mine-layer: drops a line of mines on its path | S | Med | Punishes lazy pursuit lines. |
| Shield drone: invulnerable from the front, must be flanked | M | Med | Forces angles, not just pointing. |
| Convoy: a slow armoured column with escorts | M | Med | A different rhythm; good for pillar C. |

### Bosses
| Idea | Cost | Impact | Notes |
|---|---|---|---|
| Walker phases: cores → leg armour off → it kneels and the head opens | M | High | Re-uses the rig; adds a real fight. |
| Walker attacks: ground-sweep beam, stomp shockwaves, drone launch bays | M | High | Variety that you dodge by flying, not by circling. |
| Smaller core hit radius + cores that shield until exposed | S | Med | 72 m is far too generous (`walker.ts:31`). |
| Walker steps can crush you (shadow telegraph, then the foot) | S | Med | Makes "fly between its legs" dangerous and thrilling. |
| A second colossus (a sand crawler, or a sky carrier) | L | High | Only for pillar B, or as a late-run variant. |

### Map and arena
| Idea | Cost | Impact | Notes |
|---|---|---|---|
| A hunt world pick (desert / polar) with its own title text | S | Low | Fixes the wrong "open desert" text on polar. |
| Hand-placed hunt set pieces: a canyon run, a spire forest, a dry lake for the boss | M | High | Gives quarries places to run and the walker a stage. |
| A soft arena edge (a sandstorm wall that hurts) instead of infinite tiling | M | Med | Keeps fights near content; good for D. |
| Terrain the walker damages (craters, broken spires) | L | Med | Lovely, but heavy. |

### Progression and scoring
| Idea | Cost | Impact | Notes |
|---|---|---|---|
| A real end: "hunt complete" after the final target, with a results screen | S | High | Fixes the biggest flaw. |
| Saved best score per hunt, shown on the title card | S | High | A score is only interesting with a number to beat. |
| Chain: kills within 4 s raise a multiplier; dropping below Mach 3 breaks it | S | High | Fuses the racing and the shooting. |
| Style bonuses: kill while drifting, through a spire gap, in the air, during the shockwave | S | Med | Cheap to add, makes clips. |
| Medals (bronze/silver/gold) by score and time | S | Med | Clear goals for repeat runs. |
| Daily seed (same quarries and spawns for everyone that day, local only) | M | Med | Free replay hook; no server needed. |

### Juice (camera, audio, effects)
| Idea | Cost | Impact | Notes |
|---|---|---|---|
| Kill-cam beat: 0.15 s slow-mo + FOV punch on a runner or core kill | S | High | Re-uses the existing hitstop and `slowmoT`. |
| Distinct lock tones: building, locked, "locked on you" | S | High | Audio is the fastest way to read combat at Mach 5. |
| Debris from drones that you can fly through (re-use `wreckage`) | S | Med | Kills feel physical. |
| Shockwave rings for every big kill (re-use `shock.ground`) | S | Med | Already exists for crashes. |
| Walker footfalls that shake the HUD and throw sand walls | S | Med | Scale through feel. |
| Synthesised combat stems: the music thins and a drum layer joins when the chain is high | M | Med | Audio is already procedural (`audio.ts`). |

### HUD
| Idea | Cost | Impact | Notes |
|---|---|---|---|
| Threat arcs at the screen edge for incoming bolts, orbs and missiles | S | High | Fixes "hit from nowhere". |
| Chain meter and multiplier next to the score | S | High | Needed by the chain idea. |
| Quarry panel: name, distance, closing speed, escape distance bar | S | High | Makes the chase readable. |
| Boss bar with phase pips | S | Med | Standard but needed once the walker has phases. |
| Fewer chevrons at once (nearest 6 plus the quarry), larger and clearer | S | Med | 14 tags is noisy at speed. |

### Difficulty and onboarding
| Idea | Cost | Impact | Notes |
|---|---|---|---|
| A first-run briefing card (fire, lock, chain) and hints in the first hunt | S | High | Today the fire key is never shown. |
| A tutorial quarry: slow, does not shoot, teaches lock and chase | S | Med | The first target of every run can be this. |
| Escalation by behaviour, not count: accuracy, HP, new types per stage | M | High | Fixes "wave 10 = wave 2". |
| Difficulty pick: CALM / HUNT / APEX (damage taken, quarry speed) | S | Med | Cheap, and lets the mode be tuned for both kinds of player. |
| Fire input for scripted controls, so `window.__g` can drive and test a hunt | S | Med (for us) | Makes every phase below testable. |

---

## 4. Recommended path

Six small phases. Each one ships on its own, is playable, and has its own checks. The order puts the
cheap fixes that give HUNT a shape first, then the chase, then the boss. It assumes the lean in
section 2 (A + B climax + D scoring); if a different spine is picked, phases 0, 1 and 5 still apply
as written.

**Rules for every phase.** No paid assets or services, and no paid AI APIs. Geometry, shaders and
most sound stay procedural, as today. Any outside asset is CC0 or CC-BY (OpenGameArt, Kenney,
Freesound CC0, Poly Haven), credited in `CREDITS.md` in the same commit. Each phase records a row in
`docs/PERF_LOG.md` for its heaviest scene.

### Phase 0 — Give it a shape (S, about a day)
- A run has an end: after the walker falls and the shockwave passes, HUNT COMPLETE and a results
  screen. Fix the unreachable WALKER DOWN headline (`main.ts:947`).
- Saved best score for HUNT; show it on the HUNT tab.
- A briefing card on first play, and the control hints in a hunt.
- The world pick for HUNT, and correct title text.
- Clean-ups: remove or use `walkerAfterKills` / `walkerAfterSeconds`, fix the `walker.ts:1` size
  comment, and let scripted controls fire.
- **Measure:** a scripted run (autopilot) reaches the results screen; the best score survives a reload;
  frame time unchanged.

### Phase 1 — Make the weapon a decision (S–M)
- Missile rack (6 rounds, reloads in ~2 s) or heat; pick one.
- Hold to paint up to 4 locks, release to ripple-fire.
- Threat arcs for incoming fire, and a "locked on you" tone.
- Kill beat: short slow-mo + FOV punch on runner and core kills only.
- **Measure (feel):** in 5 test runs, how often is fire held down with nothing locked (should fall
  sharply); time from lock to kill; deaths "from nowhere" (should be near zero with threat arcs).
- **Measure (perf):** p95 frame time in the combat scene stays at or under 16.8 ms on tier high;
  draw calls under 90.

### Phase 2 — The chase (M)
- Holders get real flight paths with a turn limit, so you can out-fly them.
- The **quarry**: a runner upgraded with breaks, decoys, canyon dives and a split. An escape bar
  in the HUD.
- The chain multiplier (kills within 4 s; below Mach 3 breaks it) and the first style bonuses.
- A run becomes: tutorial quarry → 3 quarry stages with escorts → the walker.
- **Measure (feel):** average Mach during a hunt (target: above 4); share of runners caught (target
  roughly 60–80%: catchable, not free); time spent with no enemy in view (should be short).
- **Measure (perf):** AI cost per drone per step (log it with the debug overlay); no frame spikes
  when a quarry splits.

### Phase 3 — Walker 2.0 (M)
- Three phases: cores (with a smaller hit radius and shields) → leg armour off, it kneels →
  head open, the final burst.
- Two new attacks: a ground-sweep beam you jump or out-run, and stomps with shadow telegraphs.
- A boss bar with phase pips; the music climbs with each phase.
- **Measure (feel):** fight length (target 60–120 s for a good player, not 4 s); hits taken per
  attack type (each attack should be dodgeable by flying, not memorised); does the collapse still land
  as the run's high point (play-test notes).
- **Measure (perf):** the Walker fight and collapse rows in `PERF_LOG.md` stay at 60 fps; particles at
  the collapse under ~3,000.

### Phase 4 — Escalation and the stage (M)
- Two new enemy types from the menu (the interceptor and the mine-layer suggested).
- Escalation by behaviour per stage: accuracy, HP, mixes.
- Hand-placed hunt set pieces: a canyon for quarries, a dry lake as the walker's stage.
- Medals by score.
- **Measure (feel):** first-run completion rate in play-tests; where players die (a heat map of
  death positions from scripted and real runs); a run length of about 6–10 minutes.
- **Measure (perf):** worst-case scene with all types alive; draw calls under 100; triangles not
  more than 5% above today's ~800k.

### Phase 5 — Polish and replay (S–M)
- Synthesised combat music layers tied to the chain.
- Daily seed (local only).
- Difficulty pick (CALM / HUNT / APEX).
- Juice pass: drone debris, kill shock rings, walker footfall sand walls.
- **Measure:** a final perf row for every hunt scene; a full scripted run on both worlds without
  errors; a gamepad pass of every new input.

---

## 5. Open questions for you

1. **Which spine?** A) QUARRY chase · B) COLOSSUS boss hunt · C) BOUNTY RUN open map · D) LAST STAND
   survival · E) my lean (A + B climax + D scoring).
2. **Should a hunt end?** A) Yes, a fixed run of about 6–10 minutes with a results screen ·
   B) No, endless until death · C) Both, as two HUNT sub-modes.
3. **How should the weapon limit you?** A) A missile rack that reloads · B) Heat that overheats ·
   C) Keep it unlimited, but add multi-lock salvos.
4. **Add a second weapon?** A) No, missiles only · B) A short-range cannon · C) An afterburner ram.
5. **Who should the walker be?** A) Keep one walker, give it phases · B) Several walker variants
   across a run · C) Add a second, different colossus later.
6. **Which world does HUNT use?** A) Desert only · B) Desert and polar, picked on the title ·
   C) Its own hunt map with set pieces.
7. **How hard by default?** A) Forgiving (most players finish the first run) · B) Fair (about half
   finish) · C) Hard (a run you learn) · D) Offer a difficulty pick.
8. **Where should the first effort go?** A) Phase 0 only, then decide · B) Phases 0–1 together ·
   C) Straight to the chase (phase 2) after phase 0.
