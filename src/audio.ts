// All sound is synthesised (Web Audio, no downloads): a rocket engine in four layers, wind that
// becomes white noise, breathing at Mach 4+, a 170 BPM drum & bass score that opens up with speed,
// and every combat cue. Distant explosions arrive late (sound travels 343 m/s; you outrun it).
// The Mach 6 barrier: everything ducks to silence for half a second, then the boom.

const BPM = 170
const STEP = 60 / BPM / 4 // a 16th note
// A minor: Am – F – C – G, then Am – F – Dm – E (two 4-bar phrases).
const ROOTS = [45, 41, 48, 43, 45, 41, 38, 40]
const CHORDS: number[][] = [
  [57, 60, 64, 69], [53, 57, 60, 65], [55, 60, 64, 67], [55, 59, 62, 67],
  [57, 60, 64, 69], [53, 57, 60, 65], [50, 53, 57, 62], [52, 56, 59, 64],
]
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

export class Sound {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private duck!: GainNode
  private lowpass!: BiquadFilterNode
  private music!: GainNode
  private sfx!: GainNode
  private eng!: GainNode
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
  private crackleG!: GainNode
  private windF!: BiquadFilterNode
  private windG!: GainNode
  private breathF!: BiquadFilterNode
  private breathG!: GainNode
  private brakeG!: GainNode
  private brakeF!: BiquadFilterNode
  private lockOsc!: OscillatorNode
  private lockG!: GainNode
  // music
  private nextStep = 0
  private stepI = 0
  private bassG!: GainNode
  private bassF!: BiquadFilterNode
  private bassOsc: OscillatorNode[] = []
  private arpF!: BiquadFilterNode
  private padG!: GainNode
  private padOsc: OscillatorNode[] = []
  private intensity = 0
  private boss = 0
  volume = { master: 0.8, music: 0.7, sfx: 1 }
  started = false
  private breathT = 0
  private lockBeepT = 0

  start(): void {
    if (this.ctx) { void this.ctx.resume(); return }
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx
    this.started = true
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.knee.value = 8
    comp.ratio.value = 5
    comp.attack.value = 0.003
    comp.release.value = 0.2
    this.master = ctx.createGain()
    this.master.gain.value = this.volume.master
    this.duck = ctx.createGain()
    this.lowpass = ctx.createBiquadFilter()
    this.lowpass.type = 'lowpass'
    this.lowpass.frequency.value = 20000
    this.duck.connect(this.lowpass).connect(comp).connect(this.master).connect(ctx.destination)
    this.music = ctx.createGain()
    this.music.gain.value = this.volume.music * 0.55
    this.sfx = ctx.createGain()
    this.sfx.gain.value = this.volume.sfx
    this.eng = ctx.createGain()
    this.eng.gain.value = 0.9
    this.music.connect(this.duck)
    this.sfx.connect(this.duck)
    this.eng.connect(this.duck)

    const sr = ctx.sampleRate
    this.noise = ctx.createBuffer(1, sr * 2, sr)
    const nd = this.noise.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1
    this.brown = ctx.createBuffer(1, sr * 2, sr)
    const bd = this.brown.getChannelData(0)
    let last = 0
    for (let i = 0; i < bd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5 }

    const loop = (buf: AudioBuffer) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random(); s.start(); return s }
    // Rumble: brown noise, low.
    this.rumbleF = ctx.createBiquadFilter(); this.rumbleF.type = 'lowpass'; this.rumbleF.frequency.value = 160
    this.rumbleG = ctx.createGain(); this.rumbleG.gain.value = 0
    loop(this.brown).connect(this.rumbleF).connect(this.rumbleG).connect(this.eng)
    // Roar: white noise through a band that climbs with speed.
    this.roarF = ctx.createBiquadFilter(); this.roarF.type = 'bandpass'; this.roarF.Q.value = 0.7; this.roarF.frequency.value = 300
    this.roarG = ctx.createGain(); this.roarG.gain.value = 0
    loop(this.noise).connect(this.roarF).connect(this.roarG).connect(this.eng)
    // Tone: two detuned saws, driven.
    this.toneA = ctx.createOscillator(); this.toneA.type = 'sawtooth'
    this.toneB = ctx.createOscillator(); this.toneB.type = 'sawtooth'; this.toneB.detune.value = 18
    this.toneF = ctx.createBiquadFilter(); this.toneF.type = 'lowpass'; this.toneF.frequency.value = 400; this.toneF.Q.value = 2
    const drive = ctx.createWaveShaper()
    const curve = new Float32Array(1024)
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 3) }
    drive.curve = curve
    this.toneG = ctx.createGain(); this.toneG.gain.value = 0
    this.toneA.connect(this.toneF); this.toneB.connect(this.toneF)
    this.toneF.connect(drive).connect(this.toneG).connect(this.eng)
    this.toneA.start(); this.toneB.start()
    // Whine: high, thin, painful at Mach 6.
    this.whine = ctx.createOscillator(); this.whine.type = 'sine'
    this.whine2 = ctx.createOscillator(); this.whine2.type = 'triangle'
    this.whineG = ctx.createGain(); this.whineG.gain.value = 0
    this.whine.connect(this.whineG); this.whine2.connect(this.whineG)
    this.whineG.connect(this.eng)
    this.whine.start(); this.whine2.start()
    // Afterburner crackle: noise chopped by a fast square LFO.
    const crF = ctx.createBiquadFilter(); crF.type = 'bandpass'; crF.frequency.value = 900; crF.Q.value = 0.6
    const chop = ctx.createGain(); chop.gain.value = 0
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 23
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.5
    lfo.connect(lfoG).connect(chop.gain); lfo.start()
    this.crackleG = ctx.createGain(); this.crackleG.gain.value = 0
    loop(this.noise).connect(crF).connect(chop).connect(this.crackleG).connect(this.eng)
    // Wind.
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 600
    const windH = ctx.createBiquadFilter(); windH.type = 'highpass'; windH.frequency.value = 180
    this.windG = ctx.createGain(); this.windG.gain.value = 0
    loop(this.noise).connect(windH).connect(this.windF).connect(this.windG).connect(this.eng)
    // Breath (Mach 4+): filtered noise, slow in and out.
    this.breathF = ctx.createBiquadFilter(); this.breathF.type = 'bandpass'; this.breathF.frequency.value = 1300; this.breathF.Q.value = 1.4
    this.breathG = ctx.createGain(); this.breathG.gain.value = 0
    loop(this.noise).connect(this.breathF).connect(this.breathG).connect(this.sfx)
    // Air brake scream.
    this.brakeF = ctx.createBiquadFilter(); this.brakeF.type = 'bandpass'; this.brakeF.frequency.value = 2400; this.brakeF.Q.value = 6
    this.brakeG = ctx.createGain(); this.brakeG.gain.value = 0
    loop(this.noise).connect(this.brakeF).connect(this.brakeG).connect(this.eng)
    // Lock tone.
    this.lockOsc = ctx.createOscillator(); this.lockOsc.type = 'square'; this.lockOsc.frequency.value = 1760
    this.lockG = ctx.createGain(); this.lockG.gain.value = 0
    const lockF = ctx.createBiquadFilter(); lockF.type = 'lowpass'; lockF.frequency.value = 3500
    this.lockOsc.connect(lockF).connect(this.lockG).connect(this.sfx); this.lockOsc.start()

    // Music: a reese bass (detuned saws, filtered), a pad, and the drums/arp scheduled per step.
    this.bassF = ctx.createBiquadFilter(); this.bassF.type = 'lowpass'; this.bassF.frequency.value = 300; this.bassF.Q.value = 3
    this.bassG = ctx.createGain(); this.bassG.gain.value = 0.32
    for (const det of [-14, 0, 13]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = det; o.frequency.value = mtof(ROOTS[0] - 12)
      o.connect(this.bassF); o.start(); this.bassOsc.push(o)
    }
    const bassLfo = ctx.createOscillator(); bassLfo.frequency.value = BPM / 60 / 2
    const bassLfoG = ctx.createGain(); bassLfoG.gain.value = 180
    bassLfo.connect(bassLfoG).connect(this.bassF.frequency); bassLfo.start()
    this.bassF.connect(this.bassG).connect(this.music)
    this.arpF = ctx.createBiquadFilter(); this.arpF.type = 'lowpass'; this.arpF.frequency.value = 1200; this.arpF.Q.value = 4
    const arpDelay = ctx.createDelay(1); arpDelay.delayTime.value = STEP * 3
    const fb = ctx.createGain(); fb.gain.value = 0.32
    this.arpF.connect(this.music)
    this.arpF.connect(arpDelay).connect(fb).connect(arpDelay)
    fb.connect(this.music)
    this.padG = ctx.createGain(); this.padG.gain.value = 0.05
    const padF = ctx.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 1800
    for (let i = 0; i < 4; i++) for (const det of [-9, 9]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = det; o.frequency.value = mtof(CHORDS[0][i])
      o.connect(padF); o.start(); this.padOsc.push(o)
    }
    padF.connect(this.padG).connect(this.music)
    this.nextStep = ctx.currentTime + 0.1
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.volume = { master, music, sfx }
    if (!this.ctx) return
    this.master.gain.value = master
    this.music.gain.value = music * 0.55
    this.sfx.gain.value = sfx
  }

  suspend(on: boolean): void {
    if (!this.ctx) return
    if (on) void this.ctx.suspend(); else void this.ctx.resume()
  }

  /** Per frame: the engine, wind and music follow the craft. */
  update(dt: number, mach: number, boost: number, brake: number, lockProg: number, locked: boolean, alive: boolean, boss: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const s = Math.min(mach / 6, 1.05)
    const k = 0.06
    const live = alive ? 1 : 0
    this.rumbleG.gain.setTargetAtTime(live * (0.35 + 0.4 * boost), t, k)
    this.rumbleF.frequency.setTargetAtTime(120 + 160 * s + 120 * boost, t, k)
    this.roarG.gain.setTargetAtTime(live * (0.12 + 0.35 * s + 0.3 * boost), t, k)
    this.roarF.frequency.setTargetAtTime(260 + 1500 * s + 600 * boost, t, k)
    const f0 = 38 + 75 * s + 25 * boost
    this.toneA.frequency.setTargetAtTime(f0, t, k)
    this.toneB.frequency.setTargetAtTime(f0 * 1.005, t, k)
    this.toneF.frequency.setTargetAtTime(250 + 900 * s + 900 * boost, t, k)
    this.toneG.gain.setTargetAtTime(live * (0.1 + 0.12 * boost), t, k)
    this.whine.frequency.setTargetAtTime(600 + 2900 * s * s, t, k)
    this.whine2.frequency.setTargetAtTime(1210 + 5600 * s * s, t, k)
    this.whineG.gain.setTargetAtTime(live * (0.004 + 0.05 * s * s * s), t, k)
    this.crackleG.gain.setTargetAtTime(live * boost * 0.25, t, 0.03)
    this.windG.gain.setTargetAtTime(0.04 + 0.55 * Math.pow(s, 1.5), t, k)
    this.windF.frequency.setTargetAtTime(500 + 9000 * s * s, t, k)
    this.brakeG.gain.setTargetAtTime(live * brake * 0.3, t, 0.03)
    // Breathing over the engine at Mach 4+.
    this.breathT += dt * (0.75 + 0.6 * s)
    const br = Math.max(0, Math.sin(this.breathT * Math.PI)) ** 2
    this.breathG.gain.setTargetAtTime(live * Math.max(0, (mach - 3.7) / 2) * br * 0.2, t, 0.05)
    this.breathF.frequency.setTargetAtTime(this.breathT % 2 < 1 ? 1400 : 900, t, 0.1)
    // Lock: beeps that quicken and rise; a steady tone once locked.
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
    } else {
      this.lockG.gain.setTargetAtTime(0, t, 0.02)
    }
    this.intensity += (Math.min(1, mach / 5) - this.intensity) * Math.min(1, dt * 0.8)
    this.boss += (boss - this.boss) * Math.min(1, dt * 0.5)
    this.arpF.frequency.setTargetAtTime(500 + 4500 * this.intensity, t, 0.2)
    this.padG.gain.setTargetAtTime(0.035 + 0.03 * this.boss, t, 0.5)
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
    const I = this.intensity
    // Two-step: kick on 1 and the "and" of 3; snare on 2 and 4; ghost kicks as it intensifies.
    if (s === 0 || s === 10 || (I > 0.55 && s === 7 && bar % 2 === 1)) this.kick(t)
    if (s === 4 || s === 12) this.snare(t, 1)
    if (I > 0.35 && (s === 9 || s === 15) && Math.random() < 0.5) this.snare(t, 0.25)
    if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.18 : 0.1, 0.03)
    else if (I > 0.25) this.hat(t, 0.06, 0.02)
    if (this.boss > 0.3 && s % 4 === 0) this.hat(t, 0.08, 0.25) // ride / crash wash
    if (s === 0) {
      const ch = CHORDS[bar]
      const ctx = this.ctx!
      for (const o of this.bassOsc) o.frequency.setTargetAtTime(mtof(ROOTS[bar] - 12), t, 0.02)
      for (let k = 0; k < this.padOsc.length; k++) this.padOsc[k].frequency.setTargetAtTime(mtof(ch[k >> 1]), t, 0.05)
      void ctx
    }
    // Bass gets a 16th-note groove (gated) as speed rises.
    if (I > 0.15) {
      const gate = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1][s]
      this.bassG.gain.setTargetAtTime(gate ? 0.34 : 0.12, t, 0.01)
    }
    // Arp: chord tones in 16ths, up two octaves, the filter opening with speed.
    if (I > 0.2 || this.boss > 0.2) {
      const ch = CHORDS[bar]
      const order = [0, 1, 2, 3, 2, 1, 3, 2]
      const note = ch[order[s % 8]] + (s >= 8 ? 12 : 0)
      this.pluck(t, mtof(note), 0.075 * Math.min(1, I * 1.5 + this.boss))
    }
    // The boss lead: a stab on the offbeats.
    if (this.boss > 0.4 && (s === 6 || s === 14)) this.stab(t, mtof(CHORDS[bar][3] + 12))
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  }

  private kick(t: number): void {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.setValueAtTime(150, t)
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12)
    this.env(g, t, 0.9, 0.002, 0.32)
    o.connect(g).connect(this.music)
    o.start(t); o.stop(t + 0.4)
    // Sidechain: the bass and pad duck under the kick.
    this.bassG.gain.setValueAtTime(0.06, t)
    this.bassG.gain.setTargetAtTime(0.3, t + 0.05, 0.06)
  }

  private snare(t: number, v: number): void {
    const ctx = this.ctx!
    const n = ctx.createBufferSource(); n.buffer = this.noise; n.playbackRate.value = 1
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200
    const g = ctx.createGain()
    this.env(g, t, 0.45 * v, 0.001, 0.16)
    n.connect(f).connect(g).connect(this.music)
    n.start(t, Math.random()); n.stop(t + 0.25)
    const o = ctx.createOscillator(); o.type = 'triangle'
    o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.08)
    const og = ctx.createGain(); this.env(og, t, 0.3 * v, 0.001, 0.08)
    o.connect(og).connect(this.music); o.start(t); o.stop(t + 0.15)
  }

  private hat(t: number, v: number, len: number): void {
    const ctx = this.ctx!
    const n = ctx.createBufferSource(); n.buffer = this.noise
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500
    const g = ctx.createGain(); this.env(g, t, v, 0.001, len)
    n.connect(f).connect(g).connect(this.music)
    n.start(t, Math.random()); n.stop(t + len + 0.05)
  }

  private pluck(t: number, hz: number, v: number): void {
    const ctx = this.ctx!
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = hz
    const g = ctx.createGain(); this.env(g, t, v, 0.002, 0.12)
    o.connect(g).connect(this.arpF); o.start(t); o.stop(t + 0.16)
  }

  private stab(t: number, hz: number): void {
    const ctx = this.ctx!
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6
    f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(400, t + 0.2)
    const g = ctx.createGain(); this.env(g, t, 0.12, 0.003, 0.22)
    for (const d of [-12, 12]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.detune.value = d
      o.connect(f); o.start(t); o.stop(t + 0.3)
    }
    f.connect(g).connect(this.music)
  }

  // ───────────────────────── one-shots ─────────────────────────

  private burst(t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, v: number, q = 0.8, dest: AudioNode = this.sfx): void {
    const ctx = this.ctx!
    const n = ctx.createBufferSource(); n.buffer = this.noise
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    const g = ctx.createGain(); this.env(g, t, v, 0.004, dur)
    n.connect(f).connect(g).connect(dest)
    n.start(t, Math.random()); n.stop(t + dur + 0.1)
  }

  private thump(t: number, f0: number, f1: number, dur: number, v: number): void {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur)
    const g = ctx.createGain(); this.env(g, t, v, 0.003, dur)
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + dur + 0.05)
  }

  /** Delay from distance (sound is slow) — capped so it still lands while it matters. */
  private late(dist: number): number { return this.ctx!.currentTime + Math.min(dist / 343, 1.4) }
  private fall(dist: number): number { return 1 / (1 + dist / 700) }

  explosion(dist: number, size: number): void {
    if (!this.ctx) return
    const t = this.late(dist)
    const v = this.fall(dist) * Math.min(1.4, 0.6 + size * 0.3)
    this.thump(t, 90, 28, 0.9 + size * 0.2, 0.9 * v)
    this.burst(t, 1.2 + size * 0.3, 'lowpass', 2200, 120, 0.7 * v)
    this.burst(t + 0.02, 0.4, 'bandpass', 3000, 800, 0.25 * v, 0.5)
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
    // A metallic ring.
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
      this.thump(t, 80, 25, 1.0, 1.2)
      this.burst(t, 1.1, 'lowpass', 4000, 200, 1.0)
      this.burst(t, 0.5, 'highpass', 3000, 2000, 0.4)
    } else {
      this.burst(t, 0.22, 'bandpass', 1800, 600, 0.55, 1.5)
      this.thump(t, 160, 60, 0.15, 0.5)
    }
  }

  /** Something screams past (Doppler: pitch falls through the pass). */
  flyby(v: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.burst(t, 0.9, 'bandpass', 2600, 300, 0.45 * v, 3)
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'
    o.frequency.setValueAtTime(700, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.8)
    const g = this.ctx.createGain(); this.env(g, t, 0.07 * v, 0.15, 0.7)
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 1)
  }

  boostKick(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.thump(t, 70, 35, 0.5, 0.8)
    this.burst(t, 0.6, 'lowpass', 1600, 300, 0.5)
  }

  /** Mach n crossed: a crack. */
  machCrack(n: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.burst(t, 0.35, 'highpass', 900, 500, 0.35 + n * 0.04, 0.5)
    this.thump(t, 110, 40, 0.3, 0.45)
  }

  /** The barrier: silence (everything ducks), then the boom. */
  barrier(phase: 'silence' | 'boom'): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const d = this.duck.gain
    d.cancelScheduledValues(t)
    if (phase === 'silence') {
      d.setValueAtTime(d.value, t)
      d.linearRampToValueAtTime(0.015, t + 0.07)
      // Only a faint, high ring in the silence.
      const o = this.ctx.createOscillator(); o.frequency.value = 7040
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 0.3); g.gain.linearRampToValueAtTime(0, t + 0.5)
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.55)
    } else {
      d.setValueAtTime(1, t)
      // The boom is routed past the duck so it lands at full weight: an N-wave, two cracks.
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
      boom(t, 1.0)
      boom(t + 0.11, 0.8)
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

  /** Slow motion: everything muffled and low. */
  slowmo(amount: number): void {
    if (!this.ctx) return
    this.lowpass.frequency.setTargetAtTime(20000 - amount * 19300, this.ctx.currentTime, 0.08)
  }

  /** Countdown: three low, one high. */
  beep(high: boolean): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = high ? 1320 : 660
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000
    const g = this.ctx.createGain(); this.env(g, t, 0.16, 0.004, high ? 0.7 : 0.28)
    o.connect(f).connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.8)
  }

  /** Through a gate: a bright two-note chime (a third note on a new lap). */
  gate(lap: boolean): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const notes = lap ? [880, 1108.7, 1318.5] : [1046.5, 1568]
    notes.forEach((hz, i) => {
      const o = this.ctx!.createOscillator(); o.type = 'triangle'; o.frequency.value = hz
      const g = this.ctx!.createGain(); this.env(g, t + i * 0.07, 0.1, 0.003, 0.35)
      o.connect(g).connect(this.sfx); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.45)
    })
  }

  missed(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'
    o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.4)
    const g = this.ctx.createGain(); this.env(g, t, 0.12, 0.005, 0.4)
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.5)
  }

  /** A boost pad: a rising zap and a shove. */
  pad(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(1800, t + 0.25)
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 1.2
    const g = this.ctx.createGain(); this.env(g, t, 0.22, 0.01, 0.35)
    o.connect(f).connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.45)
    this.thump(t, 90, 40, 0.35, 0.6)
  }

  launch(v: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.burst(t, 0.8, 'bandpass', 600, 2400, 0.25 + v * 0.3, 0.8)
  }

  land(impact: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const v = Math.min(1.2, impact / 60)
    this.thump(t, 120, 35, 0.4 + v * 0.3, 0.5 + v * 0.6)
    this.burst(t, 0.5 + v * 0.4, 'lowpass', 2500, 150, 0.3 + v * 0.5)
  }

  /** Racer on racer. */
  clang(v: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.burst(t, 0.3, 'bandpass', 2200, 700, 0.5 * v + 0.2, 2.5)
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 410
    const o2 = this.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 647
    const g = this.ctx.createGain(); this.env(g, t, 0.14 * v + 0.05, 0.001, 0.4)
    o.connect(g); o2.connect(g); g.connect(this.sfx)
    o.start(t); o2.start(t); o.stop(t + 0.5); o2.stop(t + 0.5)
  }

  private scrapeG: GainNode | null = null
  /** A continuous grind while rubbing rock (0 … 1). */
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
    this.scrapeG.gain.setTargetAtTime(Math.min(1, level) * 0.5, this.ctx.currentTime, 0.03)
  }

  death(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.explosion(0, 3)
    this.duck.gain.cancelScheduledValues(t)
    this.duck.gain.setTargetAtTime(0.35, t + 0.4, 1.2)
  }

  revive(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.duck.gain.cancelScheduledValues(t)
    this.duck.gain.setTargetAtTime(1, t, 0.2)
    this.lowpass.frequency.setTargetAtTime(20000, t, 0.1)
  }
}
