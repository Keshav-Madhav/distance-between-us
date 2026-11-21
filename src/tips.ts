// Tips: one short line at a time, low on the left, shown once each (remembered), at the moment it
// matters — the controls on the first course, slipstream on the drag, grip and spinning before the
// hairpins, the lead pipper the first time a Dart is in range. Never a pause, never a box.
//
// Each tip names where it applies (a course id, 'race' for any course, 'hunt'), and when: a test on
// the live state — how far into the course (km), the race clock, or an event (first slide, first
// time in a slipstream, a missed gate…).

export interface TipCtx {
  mode: 'title' | 'race' | 'hunt'
  course: string
  /** Race clock (s) since GO, or hunt time. */
  t: number
  /** Distance into the course (km). */
  km: number
  mach: number
  burning: boolean
  burnHeld: number
  wake: number
  drifting: boolean
  slip: number
  spin: boolean
  airborne: boolean
  hull: number
  missed: number
  place: number
  lap: number
  /** HUNT: a Dart near the nose / any Darts up / kills / overheated / missiles fired. */
  dartNear: boolean
  darts: number
  kills: number
  overheat: boolean
  agl: number
}

interface Tip { id: string; where: string; text: string; when: (c: TipCtx) => boolean }

/** Key caps: [W] → a boxed key. */
const k = (s: string) => s.replace(/\[([^\]]+)\]/g, '<span class="kc">$1</span>')

const TIPS: Tip[] = [
  // ── the first course: the basics, one at a time ──
  { id: 'sprint-w', where: 'sprint', text: 'Hold [W] to throttle up. Off it, you coast.', when: (c) => c.t > 0.5 && c.t < 12 },
  { id: 'sprint-steer', where: 'sprint', text: '[A] [D] steer. Small inputs at Mach 4+ — the craft is quick to answer.', when: (c) => c.t > 7 },
  { id: 'sprint-gates', where: 'sprint', text: 'Fly between the gate towers. A missed gate costs most of your speed.', when: (c) => c.t > 13 },
  { id: 'sprint-shift', where: 'sprint', text: '[Shift] lights the afterburner: past Mach 6, but the steering stiffens.', when: (c) => c.t > 19 && c.mach > 3 },
  { id: 'sprint-spires', where: 'sprint', text: 'Spires on the line: pick your gap early — they are solid.', when: (c) => c.km > 30 && c.km < 60 },
  { id: 'sprint-reset', where: 'sprint', text: 'Lost? [R] puts you back at the last gate.', when: (c) => c.t > 40 },
  // ── dry river: grip, the hairpins, jumps ──
  { id: 'dry-grip', where: 'dry-river', text: 'The [GRIP] gauge: past its line you slide. Red means a spin is coming — countersteer.', when: (c) => c.t > 4 },
  { id: 'dry-forest', where: 'dry-river', text: 'Spire forest: lift off the throttle a touch and thread it.', when: (c) => c.km > 24 && c.km < 30 },
  { id: 'dry-hairpin', where: 'dry-river', text: 'Hairpins ahead. Brake with [S] before the turn, not in it.', when: (c) => c.km > 38 && c.km < 44.5 },
  { id: 'dry-drift', where: 'dry-river', text: '[S] + steer breaks traction: drift it, then straighten up for a boost.', when: (c) => c.km > 44.5 && c.km < 50 },
  { id: 'dry-jumps', where: 'dry-river', text: 'Jump fields: steer in the air to land pointing straight.', when: (c) => c.km > 58 && c.km < 61 },
  // ── the long drag: slipstream, ramps ──
  { id: 'drag-wake', where: 'drag', text: 'Tuck in right behind a rival: the slipstream builds ▮▮▮. Then pull out and pass.', when: (c) => c.t > 3 },
  { id: 'drag-burner', where: 'drag', text: 'No top speed on the afterburner here — the only limit is your nerve.', when: (c) => c.t > 14 && c.burning },
  { id: 'drag-catch', where: 'drag', text: 'Behind the leader? You get a small catch-up boost. Stay in it.', when: (c) => c.place > 5 && c.t > 25 },
  { id: 'drag-ramp', where: 'drag', text: 'Ramps ahead stand half on the line: take them straight, or go round.', when: (c) => c.km > 30 && c.km < 80 },
  // ── the circuit, the oval, the canyon ──
  { id: 'circuit-smooth', where: 'circuit', text: 'Always turning: keep the inputs small and the speed up.', when: (c) => c.t > 4 },
  { id: 'circuit-pads', where: 'circuit', text: 'Blue chevrons on the ground are boost pads — run over them.', when: (c) => c.t > 14 },
  { id: 'oval-ends', where: 'oval', text: 'The ends are tight: three gates lay out each turn. Brake into the first.', when: (c) => c.t > 6 },
  { id: 'oval-lap', where: 'oval', text: 'Lap two: you know the line now — carry more speed into the ends.', when: (c) => c.lap >= 2 },
  { id: 'canyon-walls', where: 'canyon', text: 'The rock closes in on this one. Stay central through the bends.', when: (c) => c.t > 4 },
  // ── the polar shelf ──
  { id: 'frost-lines', where: 'frostline', text: 'Follow the glowing edge lines — the course runs between them.', when: (c) => c.t > 3 },
  { id: 'frost-ice', where: 'frostline', text: 'The ice beside the track knocks you aside and kills your speed. Stay inside.', when: (c) => c.t > 15 },
  { id: 'frost-lake', where: 'frostline', text: 'Frozen lakes are just as fast as snow. Hold your line across.', when: (c) => c.t > 28 },
  { id: 'icefall-corridor', where: 'icefall', text: 'Glacier corridors: walls on both sides. Look for the gap between the edge lines.', when: (c) => c.t > 4 },
  { id: 'icefall-pack', where: 'icefall', text: 'The pack is quick here. Use their slipstream on the straights.', when: (c) => c.t > 18 },
  // ── cinder ──
  { id: 'caldera-lava', where: 'caldera', text: 'Where the course crosses lava it has cooled to a crust. Safe to drive over.', when: (c) => c.t > 6 },
  { id: 'caldera-hook', where: 'caldera', text: 'The hook: three gates mark it. Brake early and turn in at the first.', when: (c) => c.t > 18 },
  { id: 'fault-save', where: 'faultline', text: 'A long sprint: save the afterburner for the straights between the sweepers.', when: (c) => c.t > 4 },
  { id: 'fault-crossing', where: 'faultline', text: 'The crossing: long lava flats. Hold it straight and flat out.', when: (c) => c.km > 43 && c.km < 47 },
  { id: 'green-domes', where: 'greenway', text: 'Granite domes and forest belts line the course: the trees are solid, the meadow is fast.', when: (c) => c.t > 5 },
  { id: 'green-lap', where: 'greenway', text: 'Gentle bends all the way: hold the afterburner through them if you dare.', when: (c) => c.t > 20 },
  { id: 'river-cross', where: 'riverrun', text: 'River crossings ahead: water is as fast as grass. Hold it flat.', when: (c) => c.km > 36 && c.km < 41 },
  { id: 'river-slalom', where: 'riverrun', text: 'The slalom: four linked bends. Turn in early and let it flow.', when: (c) => c.km > 48 && c.km < 53 },
  // ── any course: learned the moment it happens ──
  { id: 'any-wake', where: 'race', text: 'Slipstream: right behind a rival you go faster. Pull out to pass.', when: (c) => c.wake > 0.35 },
  { id: 'any-slide', where: 'race', text: 'Sliding. Ease off the steering, or countersteer to catch it.', when: (c) => c.drifting || Math.abs(c.slip) > 0.35 },
  { id: 'any-spin', where: 'race', text: 'Spun out. Next time: less steering at speed, and countersteer when the gauge goes red.', when: (c) => c.spin },
  { id: 'any-air', where: 'race', text: 'In the air: steer to line the nose up with your travel before you land.', when: (c) => c.airborne },
  { id: 'any-miss', where: 'race', text: 'Missed a gate. They are wide — line up a few hundred metres early.', when: (c) => c.missed > 0 },
  { id: 'any-burn', where: 'race', text: 'Afterburner on: steering is stiffer. Let go of [Shift] before the bends.', when: (c) => c.burnHeld > 2.5 },
  { id: 'any-hull', where: 'race', text: 'Hull low. It heals if you stay out of trouble for a few seconds.', when: (c) => c.hull < 45 },
  // ── hunt ──
  { id: 'hunt-mouse', where: 'hunt', text: 'Steer with the mouse: the craft flies toward the cursor. Centre it to fly straight.', when: (c) => c.t > 1 },
  { id: 'hunt-keys', where: 'hunt', text: 'Or the keys: [A] [D] turn, [↑] [↓] dive and climb, [Q] [E] roll.', when: (c) => c.t > 8 },
  { id: 'hunt-speed', where: 'hunt', text: '[W] throttle, [S] air brake (tighter turns), [Shift] boost.', when: (c) => c.t > 15 },
  { id: 'hunt-pipper', where: 'hunt', text: 'The gold ring is where to aim: put your nose on it and fire (left mouse or [Space]).', when: (c) => c.dartNear },
  { id: 'hunt-missiles', where: 'hunt', text: 'Hold right mouse (or [K]) to paint up to four locks. Release to fire them.', when: (c) => c.darts > 0 && c.t > 25 },
  { id: 'hunt-heat', where: 'hunt', text: 'Overheated. Fire in short bursts — the cannon cools fast between them.', when: (c) => c.overheat },
  { id: 'hunt-engine', where: 'hunt', text: 'Hits from behind, into the engine, count double. Get on their tail.', when: (c) => c.kills >= 1 },
  { id: 'hunt-speedscore', where: 'hunt', text: 'Speed is score: every kill pays more the faster you are flying.', when: (c) => c.kills >= 3 },
  { id: 'hunt-low', where: 'hunt', text: 'Skimming low is legal — but the rock is solid.', when: (c) => c.agl < 40 && c.t > 5 },
]

const KEY = 'dbu-tips-seen'

export class Tips {
  private seen = new Set<string>()
  private showT = 0
  /** The tip on screen is a course's own (a general one can be cut short by it). */
  private showingCourse = false
  private checkT = 0
  enabled = true
  constructor(private readonly el: HTMLElement) {
    try { for (const id of JSON.parse(localStorage.getItem(KEY) || '[]') as string[]) this.seen.add(id) } catch { /* fresh */ }
  }
  /** Forget every tip shown (settings: "Reset tips"). */
  reset(): void { this.seen.clear(); try { localStorage.removeItem(KEY) } catch { /* blocked */ } }
  hide(): void { this.el.classList.remove('on'); this.showT = 0 }
  update(dt: number, c: TipCtx): void {
    if (this.showT > 0) {
      this.showT -= dt
      if (this.showT <= 0) this.el.classList.remove('on')
      // A course's own tip (a section coming up: the hairpins, the forest) cuts a general one short.
      if (this.showingCourse || !this.enabled) return
      this.checkT -= dt
      if (this.checkT > 0) return
      this.checkT = 0.3
      for (const tip of TIPS) if (tip.where === c.course && !this.seen.has(tip.id) && tip.when(c)) { this.show(tip, true); return }
      return
    }
    if (!this.enabled || c.mode === 'title') return
    // A breath between tips, and checked a few times a second (cheap).
    this.checkT -= dt
    if (this.checkT > 0) return
    this.checkT = 0.3
    for (const tip of TIPS) {
      if (this.seen.has(tip.id)) continue
      const here = tip.where === c.course || (tip.where === 'race' && c.mode === 'race') || (tip.where === 'hunt' && c.mode === 'hunt')
      if (!here || (tip.where !== 'hunt' && c.mode === 'hunt') || (tip.where === 'hunt' && c.mode !== 'hunt')) continue
      // (Event tips wait until the course's own opening tips have had their turn.)
      if (tip.where === 'race' && c.t < 6) continue
      if (!tip.when(c)) continue
      this.show(tip, tip.where === c.course)
      return
    }
  }
  private show(tip: Tip, course: boolean): void {
    this.seen.add(tip.id)
    try { localStorage.setItem(KEY, JSON.stringify([...this.seen])) } catch { /* blocked */ }
    this.el.innerHTML = k(tip.text)
    this.el.classList.add('on')
    this.showT = 5 + tip.text.length * 0.03
    this.showingCourse = course
    this.checkT = 1.5
  }
}
