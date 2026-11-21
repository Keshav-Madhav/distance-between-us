// All sound is synthesised (Web Audio, no downloads).
//
//   space    — one generated convolution reverb (a 2.6 s stereo tail) that everything big sends to
//   engine   — rumble, roar, a driven saw tone, a turbine whine, and an afterburner layer (sub, crackle,
//              a blowtorch hiss) that only lives while Shift is held
//   rivals   — three engine voices for the three nearest rivals: Doppler-shifted, panned, louder near
//   world    — wind, breathing past Mach 4, whooshes as spires and rivals rip past
//   music    — 170 BPM drum & bass in sections that follow the race: a count-in riser, the drop at GO,
//              a break when you wreck, a heavier final stretch, a fanfare and an outro at the finish
//   impacts  — layered: sub thud, mid crunch, metal ring, debris clatter; panned and delayed by distance
//
// Distant sounds arrive late (343 m/s) — you can outrun an explosion's sound.

const BPM = 170
const STEP = 60 / BPM / 4
const ROOTS = [45, 41, 48, 43, 45, 41, 38, 40]
const CHORDS: number[][] = [
  [57, 60, 64, 69], [53, 57, 60, 65], [55, 60, 64, 67], [55, 59, 62, 67],
  [57, 60, 64, 69], [53, 57, 60, 65], [50, 53, 57, 62], [52, 56, 59, 64],
]
// The lead: a 2-bar hook over the progression (scale degrees as MIDI).
const LEAD = [81, 0, 79, 81, 0, 84, 83, 0, 81, 0, 79, 76, 0, 79, 77, 76]
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

export type Section = 'title' | 'build' | 'drop' | 'break' | 'final' | 'outro'

export interface RivalVoice { dist: number; closing: number; pan: number; mach: number }

export class Sound {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private duck!: GainNode
  private lowpass!: BiquadFilterNode
  private music!: GainNode
  private musicF!: BiquadFilterNode
  private sfx!: GainNode
  private eng!: GainNode
  private verb!: ConvolverNode
  private verbIn!: GainNode
  private noise!: AudioBuffer
  private brown!: AudioBuffer
  // engine
  private rumbleF!: BiquadFilterNode
  private rumbleG!: GainNode
  private roarF!: BiquadFilterNode
  private roarG!: GainNode
  private toneA!: OscillatorNode
  private toneB!: OscillatorNode
  private toneG!: GainNode
  private toneF!: BiquadFilterNode
  private whine!: OscillatorNode
  private whine2!: OscillatorNode
  private whineG!: GainNode
  private burnSub!: OscillatorNode
  private burnG!: GainNode
  private burnHissF!: BiquadFilterNode
  private crackleG!: GainNode
  private windF!: BiquadFilterNode
  private windG!: GainNode
  private breathF!: BiquadFilterNode
  private breathG!: GainNode
  private brakeG!: GainNode
  private lockOsc!: OscillatorNode
  private lockG!: GainNode
  private rivalV: { o: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode; p: StereoPannerNode }[] = []
  // music
  private nextStep = 0
  private stepI = 0
  private bassG!: GainNode
  private bassF!: BiquadFilterNode
  private bassOsc: OscillatorNode[] = []
  private arpF!: BiquadFilterNode
  private padG!: GainNode
  private padOsc: OscillatorNode[] = []
  private section: Section = 'title'
  private sectionT = 0
  private intensity = 0
  volume = { master: 0.8, music: 0.7, sfx: 1 }
  started = false
  private breathT = 0
  private lockBeepT = 0
  private scrapeG: GainNode | null = null

  start(): void {
    if (this.ctx) { void this.ctx.resume(); return }
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx
    this.started = true
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.22
    this.master = ctx.createGain(); this.master.gain.value = this.volume.master
    this.duck = ctx.createGain()
    this.lowpass = ctx.createBiquadFilter(); this.lowpass.type = 'lowpass'; this.lowpass.frequency.value = 20000
    this.duck.connect(this.lowpass).connect(comp).connect(this.master).connect(ctx.destination)

    // The space: a generated stereo impulse, exponential decay with a darkening tail.
    const sr = ctx.sampleRate
    const len = Math.floor(sr * 2.6)
    const ir = ctx.createBuffer(2, len, sr)
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch)
      let lp = 0
      for (let i = 0; i < len; i++) {
        const t = i / len
        lp += (Math.random() * 2 - 1 - lp) * (0.9 - t * 0.75)
        d[i] = lp * Math.pow(1 - t, 3.2) * (i < sr * 0.012 ? i / (sr * 0.012) : 1)
      }
    }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.55
    this.verbIn.connect(this.verb).connect(this.duck)

    this.music = ctx.createGain(); this.music.gain.value = this.volume.music * 0.5
    this.musicF = ctx.createBiquadFilter(); this.musicF.type = 'lowpass'; this.musicF.frequency.value = 20000
    this.music.connect(this.musicF).connect(this.duck)
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.volume.sfx
    this.eng = ctx.createGain(); this.eng.gain.value = 0.85
    this.sfx.connect(this.duck)
    this.eng.connect(this.duck)

    this.noise = ctx.createBuffer(1, sr * 2, sr)
    const nd = this.noise.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1
    this.brown = ctx.createBuffer(1, sr * 2, sr)
    const bd = this.brown.getChannelData(0)
    let last = 0
    for (let i = 0; i < bd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5 }
    const loop = (buf: AudioBuffer) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random(); s.start(); return s }
    const drive = (k: number) => { const w = ctx.createWaveShaper(); const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) c[i] = Math.tanh(((i / 1023) * 2 - 1) * k); w.curve = c; return w }

    // ── engine ──
    this.rumbleF = ctx.createBiquadFilter(); this.rumbleF.type = 'lowpass'; this.rumbleF.frequency.value = 160
    this.rumbleG = ctx.createGain(); this.rumbleG.gain.value = 0
    loop(this.brown).connect(this.rumbleF).connect(this.rumbleG).connect(this.eng)
    this.roarF = ctx.createBiquadFilter(); this.roarF.type = 'bandpass'; this.roarF.Q.value = 0.7
    this.roarG = ctx.createGain(); this.roarG.gain.value = 0
    loop(this.noise).connect(this.roarF).connect(this.roarG).connect(this.eng)
    this.toneA = ctx.createOscillator(); this.toneA.type = 'sawtooth'
    this.toneB = ctx.createOscillator(); this.toneB.type = 'sawtooth'; this.toneB.detune.value = 14
    this.toneF = ctx.createBiquadFilter(); this.toneF.type = 'lowpass'; this.toneF.Q.value = 2.5
    this.toneG = ctx.createGain(); this.toneG.gain.value = 0
    this.toneA.connect(this.toneF); this.toneB.connect(this.toneF)
    this.toneF.connect(drive(3)).connect(this.toneG).connect(this.eng)
    this.toneA.start(); this.toneB.start()
    this.whine = ctx.createOscillator(); this.whine.type = 'sine'
    this.whine2 = ctx.createOscillator(); this.whine2.type = 'triangle'
    this.whineG = ctx.createGain(); this.whineG.gain.value = 0
    // A slow vibrato makes it a turbine, not a test tone.
    const vib = ctx.createOscillator(); vib.frequency.value = 5.3
    const vibG = ctx.createGain(); vibG.gain.value = 12
    vib.connect(vibG); vibG.connect(this.whine.frequency); vibG.connect(this.whine2.frequency); vib.start()
    this.whine.connect(this.whineG); this.whine2.connect(this.whineG); this.whineG.connect(this.eng)
    this.whine.start(); this.whine2.start()
    // Afterburner: a sub, a chopped crackle and a blowtorch hiss.
    this.burnSub = ctx.createOscillator(); this.burnSub.type = 'square'; this.burnSub.frequency.value = 38
    const subF = ctx.createBiquadFilter(); subF.type = 'lowpass'; subF.frequency.value = 140
    this.burnG = ctx.createGain(); this.burnG.gain.value = 0
    this.burnSub.connect(subF).connect(this.burnG).connect(this.eng); this.burnSub.start()
    this.burnHissF = ctx.createBiquadFilter(); this.burnHissF.type = 'highpass'; this.burnHissF.frequency.value = 2500
    loop(this.noise).connect(this.burnHissF).connect(this.burnG)
    const crF = ctx.createBiquadFilter(); crF.type = 'bandpass'; crF.frequency.value = 700; crF.Q.value = 0.6
    const chop = ctx.createGain(); chop.gain.value = 0
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 27
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.5
    lfo.connect(lfoG).connect(chop.gain); lfo.start()
    this.crackleG = ctx.createGain(); this.crackleG.gain.value = 0
    loop(this.noise).connect(crF).connect(chop).connect(this.crackleG).connect(this.eng)
    // World.
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 600
    const windH = ctx.createBiquadFilter(); windH.type = 'highpass'; windH.frequency.value = 160
    this.windG = ctx.createGain(); this.windG.gain.value = 0
    loop(this.noise).connect(windH).connect(this.windF).connect(this.windG).connect(this.eng)
    this.breathF = ctx.createBiquadFilter(); this.breathF.type = 'bandpass'; this.breathF.frequency.value = 1300; this.breathF.Q.value = 1.4
    this.breathG = ctx.createGain(); this.breathG.gain.value = 0
    loop(this.noise).connect(this.breathF).connect(this.breathG).connect(this.sfx)
    const brakeF = ctx.createBiquadFilter(); brakeF.type = 'bandpass'; brakeF.frequency.value = 2400; brakeF.Q.value = 6
    this.brakeG = ctx.createGain(); this.brakeG.gain.value = 0
    loop(this.noise).connect(brakeF).connect(this.brakeG).connect(this.eng)
    this.lockOsc = ctx.createOscillator(); this.lockOsc.type = 'square'; this.lockOsc.frequency.value = 1760
    this.lockG = ctx.createGain(); this.lockG.gain.value = 0
    const lockF = ctx.createBiquadFilter(); lockF.type = 'lowpass'; lockF.frequency.value = 3500
    this.lockOsc.connect(lockF).connect(this.lockG).connect(this.sfx); this.lockOsc.start()
    // Rivals: three voices.
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.detune.value = 9
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3
      const g = ctx.createGain(); g.gain.value = 0
      const p = ctx.createStereoPanner()
      const nz = loop(this.noise)
      const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.8
      const ng = ctx.createGain(); ng.gain.value = 0.5
      nz.connect(nf).connect(ng).connect(g)
      o.connect(f); o2.connect(f); f.connect(g).connect(p).connect(this.eng)
      o.start(); o2.start()
      this.rivalV.push({ o, o2, f, g, p })
    }

    // ── music ──
    this.bassF = ctx.createBiquadFilter(); this.bassF.type = 'lowpass'; this.bassF.frequency.value = 300; this.bassF.Q.value = 4
    this.bassG = ctx.createGain(); this.bassG.gain.value = 0
    for (const det of [-16, 0, 15]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = det; o.frequency.value = mtof(ROOTS[0] - 12)
      o.connect(this.bassF); o.start(); this.bassOsc.push(o)
    }
    const bassLfo = ctx.createOscillator(); bassLfo.frequency.value = BPM / 60 / 2
    const bassLfoG = ctx.createGain(); bassLfoG.gain.value = 220
    bassLfo.connect(bassLfoG).connect(this.bassF.frequency); bassLfo.start()
    this.bassF.connect(drive(2.2)).connect(this.bassG).connect(this.music)
    this.arpF = ctx.createBiquadFilter(); this.arpF.type = 'lowpass'; this.arpF.frequency.value = 1200; this.arpF.Q.value = 5
    // Ping-pong delay on the arp.
    const dl = ctx.createDelay(1); dl.delayTime.value = STEP * 3
    const dr = ctx.createDelay(1); dr.delayTime.value = STEP * 3
    const pl = ctx.createStereoPanner(); pl.pan.value = -0.7
    const pr = ctx.createStereoPanner(); pr.pan.value = 0.7
    const fb = ctx.createGain(); fb.gain.value = 0.38
    this.arpF.connect(this.music)
    this.arpF.connect(dl); dl.connect(pl).connect(this.music); dl.connect(dr); dr.connect(pr).connect(this.music); dr.connect(fb).connect(dl)
    this.padG = ctx.createGain(); this.padG.gain.value = 0.04
    const padF = ctx.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 1600
    for (let i = 0; i < 4; i++) for (const det of [-11, 0, 11]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = det; o.frequency.value = mtof(CHORDS[0][i])
      o.connect(padF); o.start(); this.padOsc.push(o)
    }
    padF.connect(this.padG)
    this.padG.connect(this.music)
    this.padG.connect(this.verbIn)
    this.nextStep = ctx.currentTime + 0.1
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.volume = { master, music, sfx }
    if (!this.ctx) return
    this.master.gain.value = master
    this.music.gain.value = music * 0.5
    this.sfx.gain.value = sfx
  }

  suspend(on: boolean): void {
    if (!this.ctx) return
    if (on) void this.ctx.suspend(); else void this.ctx.resume()
  }

  /** The music's section (see the header). */
  setSection(s: Section): void {
    if (s === this.section) return
    this.section = s
    this.sectionT = 0
    if (!this.ctx) return
    const t = this.ctx.currentTime
    if (s === 'drop') {
      // The drop lands: a crash cymbal, a sub hit, the filter wide open.
      this.cymbal(t, 0.5)
      this.thump(t, 60, 30, 1, 1)
      this.musicF.frequency.cancelScheduledValues(t)
      this.musicF.frequency.setTargetAtTime(20000, t, 0.05)
    } else if (s === 'break') {
      this.musicF.frequency.setTargetAtTime(600, t, 0.15)
    } else if (s === 'final') {
      this.cymbal(t, 0.4)
      this.musicF.frequency.setTargetAtTime(20000, t, 0.05)
    } else if (s === 'outro' || s === 'title') {
      this.musicF.frequency.setTargetAtTime(2400, t, 0.6)
    } else if (s === 'build') {
      this.musicF.frequency.setValueAtTime(500, t)
      this.musicF.frequency.exponentialRampToValueAtTime(9000, t + 3.4)
      // A riser into the drop.
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'
      o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + 3.4)
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2
      f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(5000, t + 3.4)
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 3.3); g.gain.linearRampToValueAtTime(0, t + 3.45)
      o.connect(f).connect(g).connect(this.music); o.start(t); o.stop(t + 3.5)
      this.burst(t, 3.4, 'highpass', 300, 9000, 0.08, 0.7, this.music, 3.2)
    }
  }

  /** Per frame: engine, wind, rivals and music follow the race. */
  update(dt: number, mach: number, boost: number, brake: number, lockProg: number, locked: boolean, alive: boolean, heat: number, burning = false, rivals: RivalVoice[] = []): void {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const s = Math.min(mach / 6, 1.2)
    const k = 0.06
    const live = alive ? 1 : 0
    const burn = burning && alive ? 1 : 0
    this.rumbleG.gain.setTargetAtTime(live * (0.32 + 0.35 * boost + 0.3 * burn), t, k)
    this.rumbleF.frequency.setTargetAtTime(110 + 150 * s + 120 * boost, t, k)
    this.roarG.gain.setTargetAtTime(live * (0.1 + 0.32 * s + 0.25 * boost), t, k)
    this.roarF.frequency.setTargetAtTime(240 + 1400 * s + 500 * boost, t, k)
    const f0 = 36 + 72 * s + 22 * boost
    this.toneA.frequency.setTargetAtTime(f0, t, k)
    this.toneB.frequency.setTargetAtTime(f0 * 1.006, t, k)
    this.toneF.frequency.setTargetAtTime(240 + 900 * s + 800 * boost, t, k)
    this.toneG.gain.setTargetAtTime(live * (0.09 + 0.1 * boost), t, k)
    this.whine.frequency.setTargetAtTime(560 + 2700 * s * s, t, k)
    this.whine2.frequency.setTargetAtTime(1130 + 5200 * s * s, t, k)
    this.whineG.gain.setTargetAtTime(live * (0.004 + 0.042 * Math.min(1, s * s * s)), t, k)
    this.burnG.gain.setTargetAtTime(burn * 0.34, t, 0.05)
    this.burnSub.frequency.setTargetAtTime(34 + mach * 2, t, 0.1)
    this.crackleG.gain.setTargetAtTime(burn * 0.3 + live * boost * 0.06, t, 0.03)
    this.windG.gain.setTargetAtTime(0.04 + 0.5 * Math.pow(Math.min(1, s), 1.5), t, k)
    this.windF.frequency.setTargetAtTime(500 + 8500 * Math.min(1, s * s), t, k)
    this.brakeG.gain.setTargetAtTime(live * brake * 0.26, t, 0.03)
    this.breathT += dt * (0.75 + 0.6 * Math.min(1, s))
    const br = Math.max(0, Math.sin(this.breathT * Math.PI)) ** 2
    this.breathG.gain.setTargetAtTime(live * Math.max(0, (mach - 3.7) / 2) * br * 0.16, t, 0.05)
    this.breathF.frequency.setTargetAtTime(this.breathT % 2 < 1 ? 1400 : 900, t, 0.1)
    // Rivals: Doppler (closing speed against sound), distance, pan.
    for (let i = 0; i < 3; i++) {
      const v = this.rivalV[i]
      const r = rivals[i]
      if (!r || !alive) { v.g.gain.setTargetAtTime(0, t, 0.1); continue }
      const dop = Math.min(2.2, Math.max(0.45, 343 / Math.max(80, 343 - Math.max(-600, Math.min(260, r.closing)))))
      const base = (40 + 60 * Math.min(1, r.mach / 6)) * dop
      v.o.frequency.setTargetAtTime(base, t, 0.05)
      v.o2.frequency.setTargetAtTime(base * 1.5, t, 0.05)
      v.f.frequency.setTargetAtTime(500 + 2500 * Math.min(1, 120 / Math.max(r.dist, 20)), t, 0.05)
      v.g.gain.setTargetAtTime(0.32 / (1 + (r.dist / 60) ** 1.5), t, 0.04)
      v.p.pan.setTargetAtTime(Math.max(-1, Math.min(1, r.pan)), t, 0.04)
    }
    if (locked) {
      this.lockOsc.frequency.setTargetAtTime(1980, t, 0.01)
      this.lockG.gain.setTargetAtTime(0.045, t, 0.01)
    } else if (lockProg > 0) {
      this.lockBeepT -= dt
      if (this.lockBeepT <= 0) {
        this.lockBeepT = 0.16 - lockProg * 0.11
        this.lockOsc.frequency.setValueAtTime(900 + lockProg * 900, t)
        this.lockG.gain.cancelScheduledValues(t)
        this.lockG.gain.setValueAtTime(0.05, t)
        this.lockG.gain.setTargetAtTime(0, t + 0.04, 0.01)
      }
    } else this.lockG.gain.setTargetAtTime(0, t, 0.02)
    this.sectionT += dt
    this.intensity += ((this.section === 'title' || this.section === 'outro' ? 0.2 : Math.max(Math.min(1, mach / 5), heat)) - this.intensity) * Math.min(1, dt * 0.8)
    this.arpF.frequency.setTargetAtTime(600 + 5200 * this.intensity, t, 0.2)
    this.padG.gain.setTargetAtTime(this.section === 'break' || this.section === 'outro' || this.section === 'title' ? 0.07 : 0.035, t, 0.5)
    this.schedule()
  }

  // ───────────────────────── music ─────────────────────────

  private schedule(): void {
    const ctx = this.ctx!
    while (this.nextStep < ctx.currentTime + 0.12) {
      this.playStep(this.stepI, this.nextStep)
      this.nextStep += STEP
      this.stepI++
    }
    if (this.nextStep < ctx.currentTime - 0.2) this.nextStep = ctx.currentTime + 0.05
  }

  private playStep(i: number, t: number): void {
    const s = i % 16
    const bar = Math.floor(i / 16) % 8
    const sec = this.section
    const I = this.intensity
    const full = sec === 'drop' || sec === 'final'
    const ch = CHORDS[bar]
    if (s === 0) {
      for (const o of this.bassOsc) o.frequency.setTargetAtTime(mtof(ROOTS[bar] - 12), t, 0.02)
      for (let k = 0; k < this.padOsc.length; k++) this.padOsc[k].frequency.setTargetAtTime(mtof(ch[Math.floor(k / 3)]), t, 0.08)
    }
    if (sec === 'title' || sec === 'outro') {
      // Sparse: a soft kick on one, a ticking hat, the pad.
      if (s === 0 && bar % 2 === 0) this.kick(t, 0.5)
      if (s % 4 === 2) this.hat(t, 0.05, 0.03)
      if (sec === 'outro' && s % 2 === 0) this.pluck(t, mtof(ch[(s / 2) % 4] + 12), 0.04)
      this.bassG.gain.setTargetAtTime(0, t, 0.2)
      return
    }
    if (sec === 'build') {
      // The count-in: a kick on every beat, a snare roll that doubles.
      if (s % 4 === 0) this.kick(t, 0.8)
      const roll = this.sectionT < 1.7 ? 4 : this.sectionT < 2.6 ? 2 : 1
      if (s % roll === 0) this.snare(t, 0.25 + Math.min(0.6, this.sectionT * 0.18))
      this.bassG.gain.setTargetAtTime(0, t, 0.1)
      return
    }
    if (sec === 'break') {
      if (s === 0) this.kick(t, 0.6)
      if (s % 2 === 0) this.hat(t, 0.04, 0.03)
      this.bassG.gain.setTargetAtTime(0.12, t, 0.1)
      if (s % 4 === 0) this.pluck(t, mtof(ch[(s / 4) % 4] + 12), 0.05)
      return
    }
    // The groove. Two-step kick, snare on 2 and 4, ghost notes, shuffled hats, a ride when it's on.
    if (s === 0 || s === 10 || (I > 0.5 && s === 7 && bar % 2 === 1)) this.kick(t, 1)
    if (s === 4 || s === 12) this.snare(t, 1)
    if ((s === 9 || s === 15) && Math.random() < 0.55) this.snare(t, 0.22)
    if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.16 : 0.09, 0.03)
    else if (I > 0.25) this.hat(t, 0.05, 0.02)
    if (sec === 'final' && s % 4 === 2) this.hat(t, 0.07, 0.25)
    if (s === 0 && bar === 0 && full) this.cymbal(t, 0.25)
    const gate = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1][s]
    this.bassG.gain.setTargetAtTime(gate ? 0.3 : 0.1, t, 0.01)
    const order = [0, 1, 2, 3, 2, 1, 3, 2]
    this.pluck(t, mtof(ch[order[s % 8]] + (s >= 8 ? 12 : 0)), 0.06 * Math.min(1, I * 1.4 + 0.2))
    // The lead hook, in the drop and the final stretch.
    if (full) {
      const n = LEAD[(i % 32) >> 1]
      if (n && i % 2 === 0) this.lead(t, mtof(n - (bar >= 6 ? 2 : 0)), sec === 'final' ? 0.07 : 0.05)
    }
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  }

  private kick(t: number, v: number): void {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.setValueAtTime(170, t)
    o.frequency.exponentialRampToValueAtTime(44, t + 0.1)
    this.env(g, t, 0.95 * v, 0.002, 0.34)
    o.connect(g).connect(this.music)
    o.start(t); o.stop(t + 0.4)
    // The click on top.
    this.burst(t, 0.015, 'highpass', 3000, 2000, 0.25 * v, 0.5, this.music)
    this.bassG.gain.setValueAtTime(0.04, t)
    this.bassG.gain.setTargetAtTime(0.28, t + 0.05, 0.06)
  }

  private snare(t: number, v: number): void {
    const ctx = this.ctx!
    const n = ctx.createBufferSource(); n.buffer = this.noise
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 0.6
    const g = ctx.createGain(); this.env(g, t, 0.5 * v, 0.001, 0.18)
    n.connect(f).connect(g); g.connect(this.music); g.connect(this.verbIn)
    n.start(t, Math.random()); n.stop(t + 0.25)
    const o = ctx.createOscillator(); o.type = 'triangle'
    o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(170, t + 0.07)
    const og = ctx.createGain(); this.env(og, t, 0.32 * v, 0.001, 0.09)
    o.connect(og).connect(this.music); o.start(t); o.stop(t + 0.15)
  }

  /** Metallic hats: square partials at inharmonic ratios, highpassed (the 808 recipe). */
  private hat(t: number, v: number, len: number): void {
    const ctx = this.ctx!
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000
    const g = ctx.createGain(); this.env(g, t, v, 0.001, len)
    for (const r of [2, 3, 4.16, 5.43, 6.79, 8.21]) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 40 * r * 4.1
      o.connect(f); o.start(t); o.stop(t + len + 0.05)
    }
    f.connect(g).connect(this.music)
  }

  private cymbal(t: number, v: number): void {
    this.burst(t, 1.8, 'highpass', 5000, 4000, v, 0.4, this.music)
    this.burst(t, 1.6, 'bandpass', 8000, 6000, v * 0.5, 1, this.verbIn)
  }

  private pluck(t: number, hz: number, v: number): void {
    const ctx = this.ctx!
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = hz
    const g = ctx.createGain(); this.env(g, t, v, 0.002, 0.12)
    o.connect(g).connect(this.arpF); o.start(t); o.stop(t + 0.16)
  }

  private lead(t: number, hz: number, v: number): void {
    const ctx = this.ctx!
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6
    f.frequency.setValueAtTime(5500, t); f.frequency.exponentialRampToValueAtTime(900, t + 0.25)
    const g = ctx.createGain(); this.env(g, t, v, 0.004, 0.28)
    for (const d of [-9, 9]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.detune.value = d
      o.connect(f); o.start(t); o.stop(t + 0.35)
    }
    f.connect(g); g.connect(this.music); g.connect(this.verbIn)
  }

  // ───────────────────────── one-shots ─────────────────────────

  private burst(t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, v: number, q = 0.8, dest: AudioNode = this.sfx, attack = 0.004): void {
    const ctx = this.ctx!
    const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = dur > 1.8
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    const g = ctx.createGain(); this.env(g, t, v, attack, dur)
    n.connect(f).connect(g).connect(dest)
    n.start(t, Math.random()); n.stop(t + dur + attack + 0.1)
  }

  private thump(t: number, f0: number, f1: number, dur: number, v: number, dest: AudioNode = this.sfx): void {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur)
    const g = ctx.createGain(); this.env(g, t, v, 0.003, dur)
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05)
  }

  /** A panned bus for one sound (pan −1 … 1). */
  private panned(pan: number): AudioNode {
    if (!pan) return this.sfx
    const p = this.ctx!.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan))
    p.connect(this.sfx)
    return p
  }

  private late(dist: number): number { return this.ctx!.currentTime + Math.min(dist / 343, 1.4) }
  private fall(dist: number): number { return 1 / (1 + dist / 700) }

  explosion(dist: number, size: number, pan = 0): void {
    if (!this.ctx) return
    const t = this.late(dist)
    const v = this.fall(dist) * Math.min(1.4, 0.6 + size * 0.3)
    const out = this.panned(pan)
    this.thump(t, 90, 26, 1 + size * 0.2, 0.9 * v, out)
    this.burst(t, 1.3 + size * 0.3, 'lowpass', 2400, 110, 0.7 * v, 0.8, out)
    this.burst(t + 0.02, 0.45, 'bandpass', 3000, 800, 0.25 * v, 0.5, out)
    this.burst(t, 1.6, 'lowpass', 1500, 200, 0.35 * v, 0.7, this.verbIn)
  }

  /**
   * A wreck: a sub thud, a mid crunch sweeping down, a metal ring (detuned, fast-decaying partials),
   * then debris clattering for a second; a long tail in the reverb.
   */
  wreck(sev: number, dist = 0, pan = 0): void {
    if (!this.ctx) return
    const t = this.late(dist)
    const v = this.fall(dist) * (0.7 + sev * 0.4)
    const out = this.panned(pan)
    this.thump(t, 110, 24, 1.3, 1.2 * v, out)
    this.burst(t, 0.7, 'bandpass', 2600, 300, 1.0 * v, 1.2, out)
    this.burst(t, 1.4, 'lowpass', 5000, 150, 0.8 * v, 0.7, out)
    for (const hz of [287, 431, 683, 1093, 1617]) {
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz * (0.97 + Math.random() * 0.06)
      const g = this.ctx.createGain(); this.env(g, t, 0.07 * v, 0.001, 0.6 + Math.random() * 0.5)
      o.connect(g); g.connect(out); g.connect(this.verbIn)
      o.start(t); o.stop(t + 1.3)
    }
    for (let i = 0; i < 10; i++) {
      const at = t + 0.12 + Math.random() * 1.2
      this.burst(at, 0.05 + Math.random() * 0.06, 'bandpass', 1500 + Math.random() * 3000, 800, 0.18 * v * (1 - i / 12), 3, out)
    }
    this.burst(t, 2.2, 'lowpass', 2000, 120, 0.5 * v, 0.6, this.verbIn)
  }

  /** A wreck hitting the ground again. */
  bounce(level: number, dist = 0, pan = 0): void {
    if (!this.ctx) return
    const t = this.late(dist)
    const v = this.fall(dist) * level
    const out = this.panned(pan)
    this.thump(t, 140, 40, 0.35, 0.8 * v, out)
    this.burst(t, 0.3, 'bandpass', 1800, 500, 0.6 * v, 1.6, out)
    this.burst(t + 0.05, 0.25, 'highpass', 3000, 2000, 0.2 * v, 0.6, out)
  }

  /** A spire or a rival ripping past (pan: side). */
  whoosh(level: number, pan: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const out = this.panned(pan)
    this.burst(t, 0.45, 'bandpass', 3200, 380, 0.5 * level, 2.4, out, 0.06)
    this.thump(t + 0.05, 120, 55, 0.3, 0.3 * level, out)
  }

  missile(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.thump(t, 140, 60, 0.12, 0.4)
    this.burst(t, 0.7, 'bandpass', 3800, 500, 0.45, 1.2)
  }

  locked(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    for (let i = 0; i < 2; i++) {
      const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = 2200
      const g = this.ctx.createGain(); this.env(g, t + i * 0.07, 0.06, 0.002, 0.05)
      o.connect(g).connect(this.sfx); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.08)
    }
  }

  bolt(dist: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'
    o.frequency.setValueAtTime(1800, t); o.frequency.exponentialRampToValueAtTime(300, t + 0.15)
    const g = this.ctx.createGain(); this.env(g, t, 0.08 * this.fall(dist * 0.5), 0.002, 0.15)
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.2)
  }

  hit(heavy: boolean): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.burst(t, heavy ? 0.6 : 0.25, 'bandpass', 2500, 400, heavy ? 0.9 : 0.6, 2)
    this.thump(t, heavy ? 120 : 220, 50, heavy ? 0.5 : 0.18, heavy ? 1 : 0.5)
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = heavy ? 310 : 620
    const o2 = this.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = heavy ? 457 : 913
    const g = this.ctx.createGain(); this.env(g, t, 0.18, 0.001, 0.5)
    o.connect(g); o2.connect(g); g.connect(this.sfx)
    o.start(t); o2.start(t); o.stop(t + 0.6); o2.stop(t + 0.6)
  }

  crash(big: boolean): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    if (big) {
      this.thump(t, 80, 25, 1.0, 1.1)
      this.burst(t, 1.1, 'lowpass', 4000, 200, 0.9)
      this.burst(t, 0.5, 'highpass', 3000, 2000, 0.35)
    } else {
      this.burst(t, 0.22, 'bandpass', 1800, 600, 0.55, 1.5)
      this.thump(t, 160, 60, 0.15, 0.5)
    }
  }

  flyby(v: number): void { this.whoosh(v, 0) }

  /** The afterburner lighting: a hollow thoom and a roar opening. */
  boostKick(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.thump(t, 75, 32, 0.6, 0.9)
    this.burst(t, 0.8, 'lowpass', 400, 3000, 0.5, 0.9, this.sfx, 0.08)
    this.burst(t, 1.2, 'lowpass', 1200, 200, 0.25, 0.6, this.verbIn)
  }

  machCrack(n: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.burst(t, 0.35, 'highpass', 900, 500, 0.3 + n * 0.04, 0.5)
    this.thump(t, 110, 40, 0.3, 0.4)
  }

  barrier(phase: 'silence' | 'boom'): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const d = this.duck.gain
    d.cancelScheduledValues(t)
    if (phase === 'silence') {
      d.setValueAtTime(d.value, t)
      d.linearRampToValueAtTime(0.02, t + 0.07)
      const o = this.ctx.createOscillator(); o.frequency.value = 7040
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.025, t + 0.3); g.gain.linearRampToValueAtTime(0, t + 0.5)
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.55)
    } else {
      d.setValueAtTime(1, t)
      const ctx = this.ctx
      const boom = (at: number, v: number) => {
        const n = ctx.createBufferSource(); n.buffer = this.noise
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(5000, at); f.frequency.exponentialRampToValueAtTime(90, at + 1.4)
        const g = ctx.createGain(); this.env(g, at, v, 0.002, 1.6)
        n.connect(f).connect(g).connect(this.master); n.start(at, Math.random()); n.stop(at + 1.8)
        const o = ctx.createOscillator(); o.frequency.setValueAtTime(70, at); o.frequency.exponentialRampToValueAtTime(22, at + 1.2)
        const og = ctx.createGain(); this.env(og, at, v * 1.1, 0.002, 1.3)
        o.connect(og).connect(this.master); o.start(at); o.stop(at + 1.4)
      }
      boom(t, 0.9)
      boom(t + 0.11, 0.7)
    }
  }

  footfall(dist: number): void {
    if (!this.ctx) return
    const t = this.late(dist)
    const v = 1 / (1 + dist / 2500)
    this.thump(t, 55, 22, 1.1, 1.1 * v)
    this.burst(t, 0.9, 'lowpass', 600, 80, 0.5 * v)
  }

  charge(dist: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'
    o.frequency.setValueAtTime(80, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.8)
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2000
    const g = this.ctx.createGain(); const v = 0.12 / (1 + dist / 5000)
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.75); g.gain.linearRampToValueAtTime(0, t + 0.85)
    o.connect(f).connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.9)
  }

  cannon(dist: number): void {
    if (!this.ctx) return
    const t = this.late(dist * 0.5)
    const v = 1 / (1 + dist / 4000)
    this.thump(t, 60, 25, 1.2, 1.1 * v)
    this.burst(t, 1.0, 'lowpass', 1800, 100, 0.8 * v)
  }

  shockwave(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.thump(t, 50, 18, 2.2, 1.4)
    this.burst(t, 2.4, 'lowpass', 3000, 60, 1.1)
  }

  slowmo(amount: number): void {
    if (!this.ctx) return
    this.lowpass.frequency.setTargetAtTime(20000 - amount * 18800, this.ctx.currentTime, 0.08)
  }

  beep(high: boolean): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = high ? 1320 : 660
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000
    const g = this.ctx.createGain(); this.env(g, t, 0.16, 0.004, high ? 0.7 : 0.28)
    o.connect(f).connect(g); g.connect(this.sfx); g.connect(this.verbIn)
    o.start(t); o.stop(t + 0.8)
  }

  gate(big: boolean): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const notes = big ? [880, 1108.7, 1318.5, 1760] : [1046.5, 1568]
    notes.forEach((hz, i) => {
      const o = this.ctx!.createOscillator(); o.type = 'triangle'; o.frequency.value = hz
      const g = this.ctx!.createGain(); this.env(g, t + i * 0.07, 0.1, 0.003, 0.4)
      o.connect(g); g.connect(this.sfx); g.connect(this.verbIn)
      o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.5)
    })
    this.burst(t, 0.4, 'bandpass', 4000, 700, 0.25, 2, this.sfx, 0.03)
  }

  /** The finish: a brass-ish chord stab and a rising arpeggio, into the reverb. */
  fanfare(win: boolean): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const root = win ? 57 : 52
    const chord = win ? [0, 4, 7, 12, 16] : [0, 3, 7, 12]
    for (const n of chord) for (const d of [-7, 7]) {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(root + n); o.detune.value = d
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(600, t); f.frequency.linearRampToValueAtTime(3500, t + 0.15); f.frequency.exponentialRampToValueAtTime(800, t + 1.6)
      const g = this.ctx.createGain(); this.env(g, t, 0.05, 0.02, 1.8)
      o.connect(f).connect(g); g.connect(this.music); g.connect(this.verbIn)
      o.start(t); o.stop(t + 2)
    }
    chord.forEach((n, i) => this.pluck(t + 0.3 + i * 0.09, mtof(root + 12 + n), 0.09))
    this.cymbal(t, 0.4)
  }

  missed(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'
    o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.4)
    const g = this.ctx.createGain(); this.env(g, t, 0.12, 0.005, 0.4)
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.5)
  }

  pad(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(1800, t + 0.25)
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 1.2
    const g = this.ctx.createGain(); this.env(g, t, 0.22, 0.01, 0.35)
    o.connect(f).connect(g); g.connect(this.sfx); g.connect(this.verbIn)
    o.start(t); o.stop(t + 0.45)
    this.thump(t, 90, 40, 0.35, 0.6)
  }

  launch(v: number): void {
    if (!this.ctx) return
    this.burst(this.ctx.currentTime, 0.8, 'bandpass', 600, 2400, 0.25 + v * 0.3, 0.8)
  }

  land(impact: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const v = Math.min(1.2, impact / 60)
    this.thump(t, 120, 35, 0.4 + v * 0.3, 0.5 + v * 0.6)
    this.burst(t, 0.5 + v * 0.4, 'lowpass', 2500, 150, 0.3 + v * 0.5)
  }

  clang(v: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.burst(t, 0.3, 'bandpass', 2200, 700, 0.5 * v + 0.2, 2.5)
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 410
    const o2 = this.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 647
    const g = this.ctx.createGain(); this.env(g, t, 0.14 * v + 0.05, 0.001, 0.4)
    o.connect(g); o2.connect(g); g.connect(this.sfx); g.connect(this.verbIn)
    o.start(t); o2.start(t); o.stop(t + 0.5); o2.stop(t + 0.5)
  }

  scrape(level: number): void {
    if (!this.ctx) return
    if (!this.scrapeG) {
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 3
      const am = this.ctx.createGain(); am.gain.value = 0.6
      const lfo = this.ctx.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 37
      const lg = this.ctx.createGain(); lg.gain.value = 0.4
      lfo.connect(lg).connect(am.gain); lfo.start()
      this.scrapeG = this.ctx.createGain(); this.scrapeG.gain.value = 0
      const n = this.ctx.createBufferSource(); n.buffer = this.noise; n.loop = true; n.start()
      n.connect(f).connect(am).connect(this.scrapeG).connect(this.sfx)
    }
    this.scrapeG.gain.setTargetAtTime(Math.min(1, level) * 0.45, this.ctx.currentTime, 0.03)
  }

  death(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.explosion(0, 3)
    this.duck.gain.cancelScheduledValues(t)
    this.duck.gain.setTargetAtTime(0.4, t + 0.4, 1.2)
  }

  revive(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.duck.gain.cancelScheduledValues(t)
    this.duck.gain.setTargetAtTime(1, t, 0.2)
    this.lowpass.frequency.setTargetAtTime(20000, t, 0.1)
  }
}
