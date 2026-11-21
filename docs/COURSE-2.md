# Course 2 — plan (draft, 2026-11-21)

Same world (the desert, mesas, sky, dry river, terrain shader), a second route through it.
Course 1 ("The Sprint", 165 km) is flat-out: nearly straight, spires to weave, micro-corrections.
Course 2 should feel different to drive, not just look different.

## Working concept: "Dry River" (~80–90 km, point to point)

A shorter, technical course that uses the handling that now exists: the brake-drift, a grip
limit that can be broken, air control. Six sections, each with one idea:

| km | Section | What it asks of you |
|---|---|---|
| 0–10 | **Open start** | Launch, Mach 1 boom, settle into the pack |
| 10–28 | **The Riverbed** | The line drops into a dry channel (banked walls, ~15 m deep) and follows its slow bends. Rubbing a wall at speed scrubs and can spin you |
| 28–42 | **Spire Forest** | Twice course 1's spire density, more rock gates. Slower, threading |
| 42–52 | **The Hairpins** | Two real corners (radius ~1.2–2 km) that can't be taken flat. Brake, drift, catch, boost out |
| 52–70 | **Jump Fields** | A chain of big mounds. Air control, crooked landings punished |
| 70–85 | **Last Run** | Long straight with boost pads; the finish line in a slot between two mesas |

## Build order

1. **Course data, not code.** Turn `Course` into `new Course(def)`.
   - `CourseDef` holds: name, length, centreline (sum of sines plus S-bend/hairpin terms),
     gate spacing, spire density and seed, jumps, pads, sections.
   - `SPRINT_KM`, `JUMPS` and similar become per-course.
   - Course 1 becomes `defs/sprint.ts`, and must play identically: same seed, same result.
2. **Course select** on the title screen (← / →), with a best time per course saved in
   localStorage.
3. **The channel (riverbed).**
   - Add a trench term to `groundH` in both JS and GLSL.
   - The centreline is a sum of sines, so its coefficients can go in as uniforms (the
     same trick as `MOUND_U`); no texture and no distance-to-polyline in the shader.
   - Mesas are kept clear of the channel by the existing `clear()` corridor.
4. **Hairpins.**
   - A tight-bend term in the centreline.
   - Corner markers: chevron boards on the outside, a brake marker 1 km before.
   - The minimap already shows the shape.
5. **AI corner planning.** The AI only steers today, which works on course 1 because
   nothing there needs braking.
   - It needs a speed target from the curvature ahead (`v ≤ √(grip / κ)`), braking
     points, and its own drift for the hairpins.
   - The biggest piece of work, and what keeps the AI "formidable" here.
6. **Section feel.** A banner per section ("THE RIVERBED"), music sections tied to the
   course sections (`audio.setSection` exists), and a different time of day or haze so
   course 2 reads differently at a glance.
7. **Verify.**
   - Playtest bot runs on course 2 (video and screenshots).
   - AI crash and spin counts, finish placing, 1% lows.
   - Course 1 regression: same gates, same spires, same times.

## Open questions

- Length: ~85 km technical (proposed), or another epic 150 km+?
- Hairpins that force braking: yes? (They change the game from "hold W" to braking points.)
- Riverbed walls: hard walls that bounce you, or soft banks that only slow you?
- Keep it point to point (no laps), like course 1?
