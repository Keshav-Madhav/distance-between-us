# Blind solver

A general solver for the hover racer: given a course id it produces a hands-legal input file, built
only from reading `src/` and from experiments against the running game (port 4480).

## Running it

```
cd ~/Repositories/distance-between-us
node tools/optruns/blind/solve.mjs <course> '{"plainToo":1}'   # writes tools/optruns/blind/<course>.cand.json
node tools/optruns/blind/judge.mjs <course> tools/optruns/blind/<course>.cand.json
#   runs tools/agentrun.mjs on it; if counted + hands.ok + faster than the saved best → <course>.json
tools/optruns/blind/batch.sh '{"plainToo":1}' [courses…]      # both steps, every course, one browser at a time
```

Options (JSON, all optional): `D` decision length in steps (30), `H` look-ahead in steps (150), `base`
controller params, `plan` lane-planner params, `plainToo` also try the plain controller and keep the better.
Each browser launch waits while the 1-minute load average is above 90.

Files: `browser.mjs` (headless page + the judge's warm-up), `core.js` (in-page planner, controller and
search), `solve.mjs`, `judge.mjs`, `batch.sh`, `exp.mjs` (dev helper for experiments), `probe.mjs`.

## How it works

1. **Warm-up exactly as the judge does** — race started, countdown skipped, the world swept end to end
   with `world.update` so every obstacle exists. With that the in-page simulation replays bit-identically
   under the judge (solver time = judged time on every course checked).
2. **Obstacle sweep** — every obstacle the collision code itself sees (`world.near`, at its widest
   radius) collected along the course and placed by (course index, sideways offset). Gorge courses: the
   free half-width from the canyon's own wall table.
3. **Lane planner** — a dynamic program over (knot every 200 m, lateral cell every 15 m, last move):
   shortest line (offset-corrected arc length, so it takes the inside of bends) + a smoothness cost,
   kept inside every gate (with a taper so the craft is lined up well before it), clear of obstacles
   (soft penalty, hard inside the rock), and rewarded for driving over boost pads.
4. **Controller** — tracks the lane: a lateral PD sets the sideways speed wanted, turned into a heading,
   turned into a yaw rate, divided by the craft's own full-lock turn rate (the game's grip formula) to give
   the steer; strafe closes the remaining lateral-speed error. Burner on when the next ~1.2 s of line
   needs less turn than a lit burner allows (a tenth of full lock); brake when a bend within 2 s needs
   more than full lock. A `legal()` filter makes any output hands-legal: keys change only after ≥ 6 steps,
   steer/strafe move ≤ 0.333 a step (dodge taps were supported until the game removed dodge).
5. **Search (MPC with savestates)** — every 30 steps (0.5 s), from a `g.snap()` savestate, ~12 variants
   of the controller parameters (burner more/less eager, always/never burn, brake earlier/later, lane
   ±40 m, strafe on/off…) are each played for 0.5 s and then 2.5 s of the auto policy; the one with the
   best progress + 2 s of speed (finish time once finished; crash and spin penalties) is committed.
   The recorded committed inputs are the run. The plain (unsearched) controller run is also kept if better.

## Results (every time judged by `node tools/agentrun.mjs run <course> <course>.json`: counted, hands.ok)

All runs were (re-)judged after the game's 2026-11-25 update that removed the dodge (flags 8/16); none
uses those flags. Human reference = `MEDAL_H` in src/course.ts (the player's best × 1.04).

| course | time (s) | human ref (s) | notes |
|---|---|---|---|
| sprint | 49.433 | 87.43 | |
| dry-river | 32.700 | 46.02 | solved with `{"H":240,"D":20}` (default settings gave 48.05) |
| drag | 47.433 | 51.86 | |
| circuit | 70.500 | 79.10 | |
| oval | 67.733 | 68.50 | |
| canyon | 30.783 | 35.18 | one gate missed on purpose by the search (a cut) |
| frostline | 55.050 | 80.75 | |
| icefall | 43.733 | 67.55 | |
| whiteout | 31.300 | 39.17 | |
| icecave | 27.483 | 45.30 | |
| caldera | 47.250 | 72.41 | |
| faultline | 32.833 | 51.37 | |
| obsidian | 42.550 | 63.58 | |
| magma | 23.767 | 34.43 | |
| greenway | 47.333 | 73.61 | |
| riverrun | 31.250 | 44.39 | |
| timberline | 41.067 | 59.51 | |
| whitewater | 23.533 | 33.04 | |
| mistriver | 27.850 | 40.94 | |
| understory | 46.800 | 62.26 | |
| orbit | 9.333 | — | not a real race: ORBIT is the star system; the game only builds a hidden 20 km straight for it, which the judge does play to a finish |

Everything except dry-river and orbit came from one batch at default settings (`'{"plainToo":1}'`,
~1–2 min per course). The dry-river jump (48 → 32.7 s) from a longer look-ahead says the other courses
very likely improve with `{"H":240,"D":20}` too — not done for lack of time.

## What mattered

- **Determinism + savestates.** `g.snap()/g.restore()` plus the judge's own warm-up (sweep the world
  along the course) make every in-page rollout replay identically under the judge. That makes the
  search trustworthy: what the solver measures is the judged time.
- **Tracking was the hard part, not speed.** The first controllers (a far look-ahead, like the game's
  AI) lagged the lane by 60–300 m, missed a third of the gates (each costs 40 % of your speed) and hit
  spires. Aiming at the line's heading *here* (look-ahead ≈ 0) with a stiff heading loop (gain 20/s) and
  a lateral-speed loop brought the error to ~10 m and sprint from ~150 s to 63 s with no search at all.
- **The burner is the whole game; it locks steering to 10 %.** Lit, it pushes 230 m/s² fading to zero at
  Mach 12, but full lock gives a tenth of the turn. The controller lights it whenever the next ~1.2 s of
  line can be held with that tenth, and drops it (≥ 6 steps) to steer. The search mostly tunes how
  eagerly to do this and when to brake.
- **Above the burner's soft limit nothing bleeds speed while it is lit** (no drag term while thrusting), so
  every boost pad (+Mach 0.75) taken while burning is kept for good — the lane planner is paid to drive
  over pads.
- Gate rule: only the next gate or the one after is checked; crossing the one after counts the skipped
  one as missed (×0.6 speed). The finish must be flown through (within gateHalf + 15 m).

## Bugs / exploits / oddities

1. **No drag above Mach 12 with the burner lit** (player.ts speed section: the drag line runs only
   `if (!thrust || speed < target)`). Repro (`exp.mjs drag <script>`): start a race, set
   `P.speed = 15*343`, hold throttle+burner (flags 3) for 5 s → still Mach 15.25; throttle only (flags 1)
   → Mach 13.4. Combined with pads (+0.75 Mach each, no cap) speed ratchets upward on pad-rich courses.
2. **Boost pads (and drift boosts) skip the Mach 5.88 barrier's half-second of no thrust** — the barrier
   check compares speed before/after the thrust step, the pad shove is added later in race.pads.
   (Read in code; not separately measured.)
3. **Strafing into a turn keeps speed** (velocity is re-split against the new heading and `side` is not
   reduced). Measured from Mach 4, coasting with full right lock for 2 s: Mach 2.28 plain, 2.73 strafing
   right, 1.88 strafing left (coasting straight: 3.21). A real ~20 % saving in bends — the code calls it a
   kept technique; it does not create energy on its own.
4. **The dodge was removed mid-task** (flags 8/16 now ignored). Before that, a held dodge key fired every
   0.25 s and the judge was changed to require one-step taps ≥ 12 steps apart; the solver's `legal()`
   handled that, then the candidate was dropped.
5. **Judge/solver hazard:** `Canyon.nearest` keeps a `last` hint that is not in the savestate; the solver
   restores it after its own wall queries so it does not perturb collisions.
6. ORBIT is listed in COURSES and the judge will "race" its hidden 20 km placeholder straight (9.33 s).
