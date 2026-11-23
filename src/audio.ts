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

import { BIOME } from './terrain'
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

/** Recorded music (CC0, OpenGameArt — see CREDITS.md): a race track and its faster 'climax' take. */
export const TRACKS: Record<string, { name: string; file: string; climax?: string }> = {
  'neon-circuit': { name: 'NEON SIGN CIRCUIT', file: 'neon-circuit', climax: 'neon-circuit-climax' },
  'hot-roadway': { name: 'HOT ROADWAY', file: 'hot-roadway', climax: 'hot-roadway-climax' },
  'cool-highway': { name: 'COOL HIGHWAY', file: 'cool-highway', climax: 'cool-highway-climax' },
  drive: { name: 'DRIVE', file: 'drive' },
  hyperflight: { name: 'HYPERFLIGHT', file: 'hyperflight' },
  'sky-blue-street': { name: 'SKY BLUE STREET', file: 'sky-blue-street', climax: 'sky-blue-street-climax' },
  'fever-stadium': { name: 'FEVER STADIUM', file: 'fever-stadium', climax: 'fever-stadium-climax' },
  'darkness-road': { name: 'DARKNESS ROAD', file: 'darkness-road', climax: 'darkness-road-climax' },
  'cool-city': { name: 'COOL CITY', file: 'cool-city' },
  'sky-trance': { name: 'SKY TRANCE', file: 'sky-trance' },
  'space-adventure': { name: 'SPACE ADVENTURE', file: 'space-adventure' },
  'space-battle': { name: 'SPACE BATTLE', file: 'space-battle' },
}
/** Above the air (FREE ROAM) and in ORBIT the score becomes this. */
const SPACE_TRACK = 'space-adventure'
/** Each course's own track (AUTO). */
export const COURSE_TRACK: Record<string, string> = { sprint: 'neon-circuit', 'dry-river': 'hot-roadway', drag: 'cool-highway', circuit: 'drive', oval: 'fever-stadium', canyon: 'hyperflight', frostline: 'drive', icefall: 'sky-blue-street', caldera: 'hot-roadway', faultline: 'darkness-road', greenway: 'cool-city', riverrun: 'sky-blue-street', timberline: 'hyperflight', obsidian: 'fever-stadium', whiteout: 'cool-highway', mistriver: 'darkness-road', understory: 'sky-trance', icecave: 'sky-trance', magma: 'darkness-road', whitewater: 'sky-blue-street', orbit: 'space-adventure' }
const MENU_TRACK = 'empty-stretch'
/** Each world's race playlist: a race starts on its course's track and moves through these by thirds. */
const WORLD_LIST: Record<string, string[]> = {
  desert: ['neon-circuit', 'hot-roadway', 'fever-stadium', 'hyperflight', 'cool-highway', 'drive'],
  ice: ['drive', 'sky-blue-street', 'cool-highway', 'sky-trance', 'hyperflight'],
  lava: ['hot-roadway', 'darkness-road', 'fever-stadium', 'hyperflight', 'neon-circuit'],
  forest: ['cool-city', 'sky-blue-street', 'hyperflight', 'drive', 'cool-highway'],
  jungle: ['darkness-road', 'sky-trance', 'cool-city', 'hyperflight', 'neon-circuit'],
}

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
  private burnRoarF!: BiquadFilterNode
  private crackleG!: GainNode
  private crackle!: AudioBuffer
  private smooth!: AudioBuffer
  // slide (drift / spin): sand under the hull, a rising sizzle with the charge
  private slideG!: GainNode
  private slideF!: BiquadFilterNode
  private sizzleG!: GainNode
  private sizzleF!: BiquadFilterNode
  private toneWob!: GainNode
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
  // Recorded layers (loaded after start): engine roar, wind, one-shots; and the music tracks.
  private bufs = new Map<string, AudioBuffer | null>()
  private engS: { src: AudioBufferSourceNode; g: GainNode } | null = null
  private burnS: { src: AudioBufferSourceNode; g: GainNode } | null = null
  private windS: { src: AudioBufferSourceNode; g: GainNode } | null = null
  private trackBus!: GainNode
  private playing: { id: string; src: AudioBufferSourceNode; g: GainNode } | null = null
  /** 'auto' (the course's track), 'synth' (the old generated score), or a TRACKS id. */
  musicChoice = 'auto'
  private courseTrack = 'neon-circuit'
  private inSpace = false
  /** Out of the air (FREE ROAM, ORBIT): the space score; back down, the world's own. */
  setSpace(on: boolean): void { if (on === this.inSpace) return; this.inSpace = on; this.refreshMusic() }

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
    // Smooth random (−1…1, ~8 new values a second, cosine-eased): turbulence for gains and filters —
    // a steady noise loop is what made everything sound generated.
    this.smooth = ctx.createBuffer(1, sr * 8, sr)
    {
      const d = this.smooth.getChannelData(0), per = sr / 8
      const pts = Array.from({ length: 65 }, () => Math.random() * 2 - 1); pts[64] = pts[0]
      for (let i = 0; i < d.length; i++) {
        const k = Math.floor(i / per), u = (i % per) / per, e = (1 - Math.cos(u * Math.PI)) / 2
        d[i] = pts[k] + (pts[k + 1] - pts[k]) * e
      }
    }
    // Crackle: sparse pops — many small, a few big — each a tiny decaying burst. A real afterburner
    // crackles; a chopped noise only buzzes.
    this.crackle = ctx.createBuffer(2, sr * 3, sr)
    for (let ch = 0; ch < 2; ch++) {
      const d = this.crackle.getChannelData(ch)
      let i = 0
      while (i < d.length) {
        i += Math.floor((-Math.log(1 - Math.random()) / 70) * sr)
        const big = Math.random() < 0.08
        const a = (big ? 0.7 + Math.random() * 0.3 : Math.random() ** 2 * 0.5)
        const len = Math.floor(sr * (big ? 0.01 + Math.random() * 0.02 : 0.001 + Math.random() * 0.006))
        let lp = 0
        for (let j = 0; j < len && i + j < d.length; j++) {
          lp += ((Math.random() * 2 - 1) - lp) * (big ? 0.35 : 0.8)
          d[i + j] += lp * a * Math.exp((-5 * j) / len)
        }
      }
    }
    const loop = (buf: AudioBuffer) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random() * Math.min(1, buf.duration); s.start(); return s }
    /** A slow random modulator (rate: new values per second ≈ 8·rate) scaled to ±depth, into a param. */
    const wob = (param: AudioParam, rate: number, depth: number) => {
      const src = ctx.createBufferSource(); src.buffer = this.smooth; src.loop = true; src.playbackRate.value = rate
      const g = ctx.createGain(); g.gain.value = depth
      src.connect(g).connect(param); src.start(0, Math.random() * 8)
      return g
    }
    const drive = (k: number) => { const w = ctx.createWaveShaper(); const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) c[i] = Math.tanh(((i / 1023) * 2 - 1) * k); w.curve = c; return w }

    // ── engine ──
    this.rumbleF = ctx.createBiquadFilter(); this.rumbleF.type = 'lowpass'; this.rumbleF.frequency.value = 160
    this.rumbleG = ctx.createGain(); this.rumbleG.gain.value = 0
    loop(this.brown).connect(this.rumbleF).connect(this.rumbleG).connect(this.eng)
    this.roarF = ctx.createBiquadFilter(); this.roarF.type = 'bandpass'; this.roarF.Q.value = 0.7
    this.roarG = ctx.createGain(); this.roarG.gain.value = 0
    loop(this.noise).connect(this.roarF).connect(this.roarG).connect(this.eng)
    // Turbulence: the roar's level and colour breathe; the rumble wanders.
    const roarAM = ctx.createGain(); roarAM.gain.value = 1
    this.roarG.disconnect(); this.roarG.connect(roarAM).connect(this.eng)
    wob(roarAM.gain, 1.6, 0.35)
    wob(this.roarF.frequency, 0.7, 180)
    wob(this.rumbleF.frequency, 0.5, 40)
    this.toneA = ctx.createOscillator(); this.toneA.type = 'sawtooth'
    this.toneB = ctx.createOscillator(); this.toneB.type = 'sawtooth'; this.toneB.detune.value = 14
    this.toneF = ctx.createBiquadFilter(); this.toneF.type = 'lowpass'; this.toneF.Q.value = 2.5
    this.toneG = ctx.createGain(); this.toneG.gain.value = 0
    this.toneA.connect(this.toneF); this.toneB.connect(this.toneF)
    this.toneF.connect(drive(3)).connect(this.toneG).connect(this.eng)
    this.toneA.start(); this.toneB.start()
    // A little pitch wander (a machine under load, not an oscillator); the spin-out wobble rides it.
    this.toneWob = wob(this.toneA.detune, 0.9, 9)
    wob(this.toneB.detune, 1.1, 11)
    this.whine = ctx.createOscillator(); this.whine.type = 'sine'
    this.whine2 = ctx.createOscillator(); this.whine2.type = 'triangle'
    this.whineG = ctx.createGain(); this.whineG.gain.value = 0
    // A slow vibrato makes it a turbine, not a test tone.
    const vib = ctx.createOscillator(); vib.frequency.value = 5.3
    const vibG = ctx.createGain(); vibG.gain.value = 12
    vib.connect(vibG); vibG.connect(this.whine.frequency); vibG.connect(this.whine2.frequency); vib.start()
    this.whine.connect(this.whineG); this.whine2.connect(this.whineG); this.whineG.connect(this.eng)
    this.whine.start(); this.whine2.start()
    // Afterburner: a thick turbulent roar (brown noise, saturated, wide), a combustion rumble that
    // surges, real crackle, and a sub — all breathing with random turbulence. (Was: a square sub, a
    // 27 Hz chopped bandpass and a 2.5 kHz hiss: "just noise and bad".)
    this.burnG = ctx.createGain(); this.burnG.gain.value = 0
    const burnAM = ctx.createGain(); burnAM.gain.value = 1
    wob(burnAM.gain, 3, 0.22) // fast flutter: a flame, not a fan
    this.burnG.connect(burnAM).connect(this.eng)
    this.burnRoarF = ctx.createBiquadFilter(); this.burnRoarF.type = 'lowpass'; this.burnRoarF.frequency.value = 900; this.burnRoarF.Q.value = 0.5
    wob(this.burnRoarF.frequency, 1.2, 260)
    const sat = drive(2.4)
    const roarL = ctx.createStereoPanner(); roarL.pan.value = -0.55
    const roarR = ctx.createStereoPanner(); roarR.pan.value = 0.55
    const roarMix = ctx.createGain(); roarMix.gain.value = 0.5
    loop(this.brown).connect(roarL).connect(this.burnRoarF)
    loop(this.brown).connect(roarR).connect(this.burnRoarF)
    this.burnRoarF.connect(sat).connect(roarMix).connect(this.burnG)
    const comb = ctx.createBiquadFilter(); comb.type = 'bandpass'; comb.frequency.value = 95; comb.Q.value = 1.4
    const surge = ctx.createGain(); surge.gain.value = 1.4
    wob(surge.gain, 0.8, 0.9)
    loop(this.brown).connect(comb).connect(surge).connect(this.burnG)
    this.burnSub = ctx.createOscillator(); this.burnSub.type = 'sine'; this.burnSub.frequency.value = 38
    const subG = ctx.createGain(); subG.gain.value = 0.35
    this.burnSub.connect(subG).connect(this.burnG); this.burnSub.start()
    const crHP = ctx.createBiquadFilter(); crHP.type = 'highpass'; crHP.frequency.value = 350
    const crLP = ctx.createBiquadFilter(); crLP.type = 'lowpass'; crLP.frequency.value = 5200
    this.crackleG = ctx.createGain(); this.crackleG.gain.value = 0
    const cr = ctx.createBufferSource(); cr.buffer = this.crackle; cr.loop = true; cr.start(0, Math.random() * 3)
    cr.connect(crHP).connect(crLP).connect(this.crackleG).connect(this.eng)
    this.crackleG.connect(this.verbIn)
    // Slide: the hull scouring sand (low, gritty, surging) and a sizzle that rises with the charge.
    this.slideF = ctx.createBiquadFilter(); this.slideF.type = 'bandpass'; this.slideF.frequency.value = 700; this.slideF.Q.value = 0.9
    this.slideG = ctx.createGain(); this.slideG.gain.value = 0
    const slideAM = ctx.createGain(); slideAM.gain.value = 1
    wob(slideAM.gain, 2.5, 0.45)
    loop(this.brown).connect(this.slideF).connect(slideAM).connect(this.slideG).connect(this.sfx)
    this.sizzleF = ctx.createBiquadFilter(); this.sizzleF.type = 'bandpass'; this.sizzleF.frequency.value = 2000; this.sizzleF.Q.value = 2.2
    this.sizzleG = ctx.createGain(); this.sizzleG.gain.value = 0
    const cr2 = ctx.createBufferSource(); cr2.buffer = this.crackle; cr2.loop = true; cr2.playbackRate.value = 1.7; cr2.start(0, Math.random() * 3)
    cr2.connect(this.sizzleF).connect(this.sizzleG).connect(this.sfx)
    // World.
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 600
    const windH = ctx.createBiquadFilter(); windH.type = 'highpass'; windH.frequency.value = 160
    this.windG = ctx.createGain(); this.windG.gain.value = 0
    const gust = ctx.createGain(); gust.gain.value = 1
    wob(gust.gain, 0.6, 0.4)
    wob(this.windF.frequency, 0.5, 300)
    loop(this.noise).connect(windH).connect(this.windF).connect(gust).connect(this.windG).connect(this.eng)
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
    this.trackBus = ctx.createGain(); this.trackBus.gain.value = 0.9
    this.trackBus.connect(this.music)
    void this.loadLayers()
    this.startAmbience()
  }

  // ── the world's own air ──
  // POLAR SHELF: a cold howl (two narrow bands of wind, slowly wandering) and ice creaking now and
  // then. CINDER: a deep rumble under everything, the fizz of lava, the odd distant bloop. Quiet:
  // a bed under the engine, louder when you slow down.
  private ambG: GainNode | null = null
  private ambT = 0
  private startAmbience(): void {
    if (BIOME === 'desert' || BIOME === 'space' || !this.ctx) return
    const ctx = this.ctx
    const g = ctx.createGain(); g.gain.value = 0
    g.connect(this.sfx); g.connect(this.verbIn)
    this.ambG = g
    const src = (buf: AudioBuffer, rate = 1) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random() * buf.duration); return s }
    const lfo = (param: AudioParam, hz: number, depth: number) => { const o = ctx.createOscillator(); o.frequency.value = hz; const d = ctx.createGain(); d.gain.value = depth; o.connect(d).connect(param); o.start() }
    if (BIOME === 'jungle') {
      // Rain on the leaves: a broad hiss with a softer patter under it, swelling slowly…
      const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 3800; hp.Q.value = 0.35
      const rg = ctx.createGain(); rg.gain.value = 0.55
      lfo(rg.gain, 0.05, 0.15)
      src(this.noise).connect(hp).connect(rg).connect(g)
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700
      const pg = ctx.createGain(); pg.gain.value = 0.5
      src(this.crackle, 0.8).connect(lp).connect(pg).connect(g)
      // …and the insects: a high trill, pulsing.
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 4700
      const ig = ctx.createGain(); ig.gain.value = 0.012
      lfo(ig.gain, 23, 0.012)
      o.connect(ig).connect(g); o.start()
    } else if (BIOME === 'forest') {
      // Leaves in the wind: a soft high rustle, gusting.
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.6
      const vg = ctx.createGain(); vg.gain.value = 0.35
      lfo(vg.gain, 0.12, 0.25)
      src(this.noise).connect(bp).connect(vg).connect(g)
    } else if (BIOME === 'ice') {
      for (const [f, q, v, hz] of [[520, 9, 0.5, 0.07], [880, 12, 0.3, 0.11]] as const) {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q
        const vg = ctx.createGain(); vg.gain.value = v
        lfo(bp.frequency, hz, f * 0.35); lfo(vg.gain, hz * 0.7, v * 0.6)
        src(this.noise).connect(bp).connect(vg).connect(g)
      }
    } else {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 95
      const rg = ctx.createGain(); rg.gain.value = 1.4
      lfo(rg.gain, 0.09, 0.6)
      src(this.brown).connect(lp).connect(rg).connect(g)
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200
      const fz = ctx.createGain(); fz.gain.value = 0.12
      src(this.crackle, 0.6).connect(hp).connect(fz).connect(g)
    }
  }
  /** Ambient events and level: called from update. */
  private ambience(dt: number, s: number): void {
    if (!this.ambG || !this.ctx) return
    const t = this.ctx.currentTime
    this.ambG.gain.setTargetAtTime(0.11 * (1 - 0.6 * Math.min(1, s)), t, 0.5)
    this.ambT -= dt
    if (this.ambT > 0) return
    this.ambT = 1.5 + Math.random() * 3.5
    const pan = this.ctx.createStereoPanner(); pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(this.ambG)
    if (BIOME === 'jungle') {
      if (Math.random() < 0.18) {
        // Thunder, far off: a long low roll.
        this.burst(t, 3.2, 'lowpass', 220, 60, 1.4, 2.6, pan, 0.4)
      } else {
        // A call through the trees: a long falling whistle, sometimes answered.
        const n = Math.random() < 0.4 ? 2 : 1, base = 1300 + Math.random() * 900
        for (let i = 0; i < n; i++) {
          const t0 = t + i * 0.55
          const o = this.ctx.createOscillator(); o.type = 'sine'
          o.frequency.setValueAtTime(base, t0); o.frequency.exponentialRampToValueAtTime(base * 0.55, t0 + 0.4)
          const gg = this.ctx.createGain(); gg.gain.setValueAtTime(0, t0); gg.gain.linearRampToValueAtTime(0.12, t0 + 0.04); gg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45)
          o.connect(gg).connect(pan); o.start(t0); o.stop(t0 + 0.5)
        }
      }
    } else if (BIOME === 'forest') {
      // A bird: a little phrase of 2-5 chirps, each a quick sine sweep.
      const n = 2 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 2200
      for (let i = 0; i < n; i++) {
        const t0 = t + i * (0.09 + Math.random() * 0.05)
        const o = this.ctx.createOscillator(); o.type = 'sine'
        o.frequency.setValueAtTime(base * (1 + Math.random() * 0.2), t0); o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.3), t0 + 0.05)
        const gg = this.ctx.createGain(); gg.gain.setValueAtTime(0, t0); gg.gain.linearRampToValueAtTime(0.18, t0 + 0.01); gg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07)
        o.connect(gg).connect(pan); o.start(t0); o.stop(t0 + 0.08)
      }
    } else if (BIOME === 'ice') {
      // A creak: a low groan sliding down, then a sharp crack.
      this.burst(t, 0.6, 'bandpass', 160 + Math.random() * 80, 70, 0.9, 6, pan, 0.08)
      if (Math.random() < 0.5) this.burst(t + 0.5, 0.12, 'highpass', 2500, 1500, 0.6, 0.7, pan)
    } else {
      // A bloop: a slow low pop of gas through the lava.
      this.burst(t, 0.45, 'lowpass', 260 + Math.random() * 120, 60, 1.1, 3, pan, 0.03)
    }
  }

  // ───────────────────────── recorded audio ─────────────────────────

  /** Fetch + decode (cached; null if it failed — the synth carries on alone). */
  private async load(name: string, dir = 'sfx'): Promise<AudioBuffer | null> {
    const key = dir + '/' + name
    if (this.bufs.has(key)) return this.bufs.get(key)!
    this.bufs.set(key, null)
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}${dir}/${name}.mp3`)
      const b = await this.ctx!.decodeAudioData(await r.arrayBuffer())
      this.bufs.set(key, b)
      return b
    } catch { return null }
  }

  /** Loop points inside the encoder's padding (leading/trailing near-silence): seamless loops. */
  private bounds(b: AudioBuffer): [number, number] {
    const d = b.getChannelData(0), th = 0.002
    let a = 0, e = d.length - 1
    while (a < d.length && Math.abs(d[a]) < th) a++
    while (e > a && Math.abs(d[e]) < th) e--
    return [a / b.sampleRate, (e + 1) / b.sampleRate]
  }

  private loopSrc(b: AudioBuffer, dest: AudioNode, gain: number): { src: AudioBufferSourceNode; g: GainNode } {
    const ctx = this.ctx!
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = true
    const [l0, l1] = this.bounds(b); src.loopStart = l0; src.loopEnd = l1
    const g = ctx.createGain(); g.gain.value = gain
    src.connect(g).connect(dest); src.start(ctx.currentTime, l0)
    return { src, g }
  }

  private async loadLayers(): Promise<void> {
    const ctx = this.ctx!
    const eng = await this.load('engine-loop')
    if (eng) {
      // The recorded roar under the synth engine; a second, slower and darker copy is the burner.
      this.engS = this.loopSrc(eng, this.eng, 0)
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400
      lp.connect(this.eng)
      this.burnS = this.loopSrc(eng, lp, 0)
    }
    const wind = await this.load('wind-loop')
    if (wind) this.windS = this.loopSrc(wind, this.eng, 0)
    void this.load('whoosh'); void this.load('explosion')
    this.refreshMusic()
  }

  /** A recorded one-shot (rate ±, panned). */
  private sample(name: string, t: number, v: number, rate: number, out: AudioNode): void {
    const b = this.bufs.get('sfx/' + name)
    if (!b || !this.ctx) return
    const src = this.ctx.createBufferSource(); src.buffer = b; src.playbackRate.value = rate
    const g = this.ctx.createGain(); g.gain.value = v
    src.connect(g).connect(out); g.connect(this.verbIn)
    src.start(t)
  }

  /** Which course is loaded (its AUTO track). */
  setCourse(id: string, world = 'desert'): void {
    this.courseTrack = COURSE_TRACK[id] ?? 'neon-circuit'
    // The course's own track first, then the world's others (more music per race: it changes by thirds).
    const list = WORLD_LIST[world] ?? WORLD_LIST.desert
    this.playlist = [this.courseTrack, ...list.filter((t) => t !== this.courseTrack)]
    this.plIdx = 0
    this.refreshMusic()
  }
  private playlist: string[] = ['neon-circuit']
  private plIdx = 0
  /** How far through the race (0 … 1): the score moves to the next track at each third. */
  setRaceProgress(f: number): void {
    const i = Math.max(0, Math.min(2, Math.floor(f * 3)))
    if (i === this.plIdx || this.section !== 'drop') return
    this.plIdx = i
    if (this.ctx && this.musicChoice === 'auto') {
      // A riser into the change, so it lands as a moment, not a cut.
      const t = this.ctx.currentTime
      this.burst(t, 1.6, 'highpass', 300, 7000, 0.1, 0.7, this.music, 1.4)
    }
    this.refreshMusic()
  }

  /** The track the current section wants, faded in (1.6 s crossfade from whatever was playing). */
  refreshMusic(): void {
    if (!this.ctx || !this.trackBus) return
    if (this.musicChoice === 'synth') { this.fadeTrack(null); return }
    const id = this.musicChoice === 'auto' ? (this.playlist[this.plIdx % this.playlist.length] ?? this.courseTrack) : this.musicChoice
    const tr = TRACKS[id] ?? TRACKS['neon-circuit']
    const sec = this.section
    const want = this.inSpace && sec !== 'title' && sec !== 'outro' ? SPACE_TRACK : sec === 'title' || sec === 'outro' ? MENU_TRACK : sec === 'build' ? null : sec === 'final' && tr.climax ? tr.climax : tr.file
    void this.playFile(want)
  }

  private wantFile: string | null = null
  private async playFile(file: string | null): Promise<void> {
    this.wantFile = file
    if (file === (this.playing?.id ?? null)) return
    if (!file) { this.fadeTrack(null); return }
    const b = await this.load(file, 'music')
    if (!b || !this.ctx) return
    // (Only if still wanted: a slow load finishing after the section moved on used to win.)
    if (this.wantFile !== file || this.playing?.id === file) return
    this.fadeTrack({ id: file, ...this.loopSrc(b, this.trackBus, 0) })
  }

  private fadeTrack(next: { id: string; src: AudioBufferSourceNode; g: GainNode } | null): void {
    const t = this.ctx!.currentTime
    if (this.playing) {
      const old = this.playing
      old.g.gain.cancelScheduledValues(t); old.g.gain.setValueAtTime(old.g.gain.value, t); old.g.gain.linearRampToValueAtTime(0, t + 1.6)
      old.src.stop(t + 1.7)
    }
    this.playing = next
    if (next) { next.g.gain.setValueAtTime(0, t); next.g.gain.linearRampToValueAtTime(1, t + 1.6) }
  }

  /** Is a recorded track the score (the generated one stays silent)? */
  private get tracksOn(): boolean { return this.musicChoice !== 'synth' }

  setVolumes(master: number, music: number, sfx: number): void {
    this.volume = { master, music, sfx }
    if (!this.ctx) return
    this.master.gain.value = master
    this.music.gain.value = music * 0.5 * (this.section === 'drop' || this.section === 'final' || this.section === 'break' ? 1.6 : 1)
    this.sfx.gain.value = sfx
  }

  /** Everything down to silence over s seconds (an instance handing over to the next). */
  fadeOut(s: number): void {
    if (!this.ctx) return
    const g = this.master.gain, t = this.ctx.currentTime
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + s)
  }

  /** Back from sleep (a world kept loaded behind another): the master level restored, sound running. */
  fadeIn(s: number): void {
    if (!this.ctx) return
    void this.ctx.resume()
    const g = this.master.gain, t = this.ctx.currentTime
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(this.volume.master, t + s)
  }

  suspend(on: boolean): void {
    if (!this.ctx) return
    if (on) void this.ctx.suspend(); else void this.ctx.resume()
  }

  /** The music's section (see the header). */
  setSection(s: Section): void {
    if (s === this.section) return
    if (s === 'build') this.plIdx = 0
    this.section = s
    this.sectionT = 0
    if (!this.ctx) return
    // Racing, the score sits forward (it was under the engine and wind at Mach 6: "music while racing").
    this.music.gain.setTargetAtTime(this.volume.music * 0.5 * (s === 'drop' || s === 'final' || s === 'break' ? 1.6 : 1), this.ctx.currentTime, 0.4)
    this.refreshMusic()
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
  update(dt: number, machIn: number, boost: number, brake: number, lockProg: number, locked: boolean, alive: boolean, heat: number, burning = false, rivals: RivalVoice[] = [], vac = 0): void {
    // (Every pitch and level here was tuned for Mach 1-10: in ORBIT, at Mach 60,000, the burner's sub was
    //  asked for 130 kHz and the wind kept growing — "very weird whooshing". Capped; and in vacuum there
    //  is no air: no wind, the engines a quieter hum through the hull.)
    const mach = Math.min(machIn, 12)
    const air = 1 - vac
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const s = Math.min(mach / 6, 1.2)
    this.ambience(dt, s)
    const k = 0.06
    const live = alive ? 1 : 0
    const burn = burning && alive ? 1 : 0
    this.rumbleG.gain.setTargetAtTime(live * (0.32 + 0.35 * boost + 0.3 * burn), t, k)
    this.rumbleF.frequency.setTargetAtTime(110 + 150 * s + 120 * boost, t, k)
    this.roarG.gain.setTargetAtTime(live * (0.1 + 0.32 * s + 0.25 * boost) * (0.35 + 0.65 * air), t, k)
    this.roarF.frequency.setTargetAtTime(240 + 1400 * s + 500 * boost, t, k)
    const f0 = 36 + 72 * s + 22 * boost
    this.toneA.frequency.setTargetAtTime(f0, t, k)
    this.toneB.frequency.setTargetAtTime(f0 * 1.006, t, k)
    this.toneF.frequency.setTargetAtTime(240 + 900 * s + 800 * boost, t, k)
    this.toneG.gain.setTargetAtTime(live * (0.06 + 0.07 * boost), t, k)
    this.whine.frequency.setTargetAtTime(560 + 2700 * s * s, t, k)
    this.whine2.frequency.setTargetAtTime(1130 + 5200 * s * s, t, k)
    this.whineG.gain.setTargetAtTime(live * (0.004 + 0.042 * Math.min(1, s * s * s)), t, k)
    this.burnG.gain.setTargetAtTime(burn * 0.7, t, burn ? 0.06 : 0.18)
    this.burnSub.frequency.setTargetAtTime(32 + mach * 2, t, 0.1)
    this.burnRoarF.frequency.setTargetAtTime(600 + 140 * Math.min(10, mach), t, 0.2)
    this.crackleG.gain.setTargetAtTime((burn * 3.2 + live * boost * 0.4) * (0.25 + 0.75 * air), t, 0.04)
    // (Quieter: "the wind passing noise is too much" — 2026-11-21.)
    this.windG.gain.setTargetAtTime((0.03 + 0.22 * Math.pow(Math.min(1, s), 1.5)) * air, t, k)
    // Recorded layers: the roar's pitch rides the speed; the burner is the same roar, deeper and fat.
    if (this.engS) {
      this.engS.src.playbackRate.setTargetAtTime(0.62 + 0.09 * Math.min(10, mach) + 0.08 * boost, t, 0.08)
      // (Leads the engine now: at 0.22 it sat 7-10 dB under the synth tone, inaudible.)
      this.engS.g.gain.setTargetAtTime(live * (0.55 + 0.6 * boost + 0.25 * Math.min(1, s)), t, 0.08)
    }
    if (this.burnS) {
      this.burnS.src.playbackRate.setTargetAtTime(0.45 + 0.04 * Math.min(10, mach), t, 0.1)
      this.burnS.g.gain.setTargetAtTime(burn * 1.4, t, burn ? 0.05 : 0.2)
    }
    if (this.windS) {
      this.windS.src.playbackRate.setTargetAtTime(0.75 + 0.5 * Math.min(1, s), t, 0.2)
      this.windS.g.gain.setTargetAtTime(live * 0.16 * Math.pow(Math.min(1.2, s), 1.4) * air, t, 0.15)
    }
    this.windF.frequency.setTargetAtTime(500 + 8500 * Math.min(1, s * s), t, k)
    this.brakeG.gain.setTargetAtTime(live * brake * 0.26, t, 0.03)
    this.breathT += dt * (0.75 + 0.6 * Math.min(1, s))
    const br = Math.max(0, Math.sin(this.breathT * Math.PI)) ** 2
    this.breathG.gain.setTargetAtTime(live * Math.max(0, (mach - 3.7) / 2) * br * 0.08, t, 0.05)
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
    this.padG.gain.setTargetAtTime(this.tracksOn ? 0 : this.section === 'break' || this.section === 'outro' || this.section === 'title' ? 0.07 : 0.035, t, 0.5)
    // The recorded track: quieter in a wreck (the filter does the rest), softer on the menu.
    if (this.trackBus) this.trackBus.gain.setTargetAtTime(this.section === 'break' ? 0.55 : this.section === 'title' || this.section === 'outro' ? 0.7 : 0.9, t, 0.3)
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
    if (this.tracksOn && this.section !== 'build') { this.bassG.gain.setTargetAtTime(0, t, 0.1); return }
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
    this.sample('explosion', t, 0.9 * v, 0.8 + Math.random() * 0.25, out)
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
    this.sample('explosion', t, 0.75 * v, 0.9 + Math.random() * 0.2, out)
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
    // Doppler: the pitch falls as it passes, and it crosses from front-side to behind.
    const p = this.ctx.createStereoPanner()
    p.pan.setValueAtTime(Math.max(-1, Math.min(1, pan * 0.4)), t); p.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, pan)), t + 0.25)
    p.connect(this.sfx)
    this.burst(t, 0.5, 'bandpass', 2600, 300, 0.3 * level, 1.6, p, 0.05)
    this.sample('whoosh', t, 0.22 * level, 1.1 + Math.random() * 0.4, p)
    this.dirty(t, 0.45, 300, 900, 120, 0.25 * level, p)
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

  /** FREE ROAM: a crystal taken — a bell note that climbs with each one in a trail; a chord for all five. */
  chime(n: number, done: boolean): void {
    if (!this.ctx) return
    const ctx = this.ctx, t = ctx.currentTime
    const scale = [0, 2, 4, 7, 9, 12, 14]
    const notes = done ? [0, 4, 7, 12] : [scale[Math.min(scale.length - 1, n - 1)]]
    notes.forEach((st, i) => {
      const f = 660 * 2 ** (st / 12)
      for (const [mul, gain] of [[1, 0.13], [2.01, 0.04]] as const) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * mul
        const g = ctx.createGain(); this.env(g, t + i * 0.07, gain, 0.004, done ? 0.9 : 0.5)
        o.connect(g).connect(this.sfx); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 1)
      }
    })
  }

  /** Your pulse cannon: a short bright tick with a little body (12 a second — kept light). */
  pulse(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.burst(t, 0.06, 'bandpass', 2400, 900, 0.16, 2.2)
    const o = this.ctx.createOscillator(); o.type = 'square'
    o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.05)
    const g = this.ctx.createGain(); this.env(g, t, 0.05, 0.001, 0.05)
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.07)
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
      this.sample('explosion', t, 0.8, 0.85 + Math.random() * 0.2, this.sfx)
      this.thump(t, 80, 25, 1.0, 1.1)
      this.dirty(t, 1.2, 3000, 1200, 150, 0.8)
      this.burst(t, 0.5, 'highpass', 3000, 2000, 0.3)
      this.pops(t + 0.05, 0.8, 18, 0.4)
    } else {
      this.burst(t, 0.22, 'bandpass', 1800, 600, 0.55, 1.5)
      this.thump(t, 160, 60, 0.15, 0.5)
    }
  }

  flyby(v: number): void { this.whoosh(v, 0) }

  /** The afterburner lighting: a suck of air, then a hollow WHOOMP as it catches, a burst of pops. */
  boostKick(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.burst(t, 0.09, 'bandpass', 600, 2400, 0.25, 1.2, this.sfx, 0.06)
    this.thump(t + 0.07, 62, 28, 0.7, 1.0)
    this.dirty(t + 0.07, 0.9, 180, 1600, 260, 0.6)
    this.pops(t + 0.08, 0.5, 14, 0.5)
    this.burst(t + 0.07, 1.4, 'lowpass', 900, 150, 0.35, 0.6, this.verbIn)
  }

  /** Saturated brown noise swept lo → hi → down: fire, body, mass (where plain noise sounds thin). */
  private dirty(t: number, dur: number, f0: number, f1: number, f2: number, v: number, dest: AudioNode = this.sfx): void {
    const ctx = this.ctx!
    const n = ctx.createBufferSource(); n.buffer = this.brown
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.9
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.2); f.frequency.exponentialRampToValueAtTime(f2, t + dur)
    const w = ctx.createWaveShaper(); const c = new Float32Array(512); for (let i = 0; i < 512; i++) c[i] = Math.tanh(((i / 511) * 2 - 1) * 3); w.curve = c
    const g = ctx.createGain(); this.env(g, t, v, 0.01, dur)
    n.connect(f).connect(w).connect(g).connect(dest)
    n.start(t, Math.random()); n.stop(t + dur + 0.1)
  }

  /** A run of crackle pops (n over dur seconds). */
  private pops(t: number, dur: number, n: number, v: number, dest: AudioNode = this.sfx): void {
    const ctx = this.ctx!
    for (let i = 0; i < n; i++) {
      const at = t + Math.random() * dur
      const s = ctx.createBufferSource(); s.buffer = this.crackle
      const g = ctx.createGain(); g.gain.value = v * (1 - (at - t) / dur * 0.6)
      s.connect(g).connect(dest)
      s.start(at, Math.random() * 2.9, 0.04)
    }
  }

  /** Continuous: sand under a sliding hull (level 0…1), the drift charge (0…1), spin yaw rate. */
  slide(level: number, charge: number, spinYaw: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.slideG.gain.setTargetAtTime(level * 1.4, t, 0.05)
    this.slideF.frequency.setTargetAtTime(500 + level * 900, t, 0.08)
    this.sizzleG.gain.setTargetAtTime(level > 0 && charge > 0.1 ? 0.8 + charge * 3 : 0, t, 0.06)
    this.sizzleF.frequency.setTargetAtTime(1400 + charge * 4200, t, 0.1)
    // Spinning: the engine note wows with the rotation (the exhaust swings toward and away from you).
    this.toneWob.gain.setTargetAtTime(spinYaw ? 9 + Math.min(220, Math.abs(spinYaw) * 40) : 9, t, 0.05)
  }

  /** The drift charge reaching a level: a heavy thunk and a bright ring rising with the level. */
  driftLevel(lvl: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.thump(t, 140, 55, 0.22, 0.55)
    const hz = lvl >= 2 ? 1320 : 880
    for (const r of [1, 2.01, 2.76]) {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz * r
      const g = this.ctx.createGain(); this.env(g, t, 0.05 / r, 0.002, 0.35)
      o.connect(g); g.connect(this.sfx); g.connect(this.verbIn); o.start(t); o.stop(t + 0.4)
    }
    this.pops(t, 0.15, lvl >= 2 ? 10 : 5, 0.35)
  }

  /** Letting a charged drift go: the stored energy kicks through the exhaust. */
  driftRelease(lvl: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.thump(t, 90, 36, 0.5, 0.8)
    this.dirty(t, 0.7, 300, 2600, 300, 0.45 + lvl * 0.15)
    this.pops(t, 0.4, 8 + lvl * 6, 0.45)
  }

  /** Grip lets go: a lurch (the hull biting sideways) and the sand roaring up. */
  spinOut(flip: boolean): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.thump(t, flip ? 70 : 110, 30, flip ? 0.9 : 0.5, flip ? 1.1 : 0.7)
    this.dirty(t, flip ? 1.4 : 0.9, 220, 1200, 160, flip ? 0.7 : 0.5)
    this.burst(t, 0.6, 'bandpass', 900, 3200, 0.3, 1.5, this.sfx, 0.08)
  }

  /** A sonic boom is an N-wave: two sharp cracks ~0.1 s apart, a bass push, a long rolling tail. */
  machCrack(n: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const v = 0.4 + n * 0.05
    this.burst(t, 0.06, 'highpass', 1800, 900, v, 0.7, this.sfx, 0.001)
    this.burst(t + 0.1, 0.07, 'highpass', 1500, 700, v * 0.85, 0.7, this.sfx, 0.001)
    this.thump(t, 85, 30, 0.45, 0.55)
    this.dirty(t, 1.6, 900, 400, 60, 0.3, this.verbIn)
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
    // Through the curtain: a field hum you punch through (a phasey rush), then a soft bell pair.
    this.burst(t, 0.35, 'bandpass', 5000, 900, 0.3, 3, this.sfx, 0.01)
    this.thump(t, 70, 45, 0.25, 0.35)
    const notes = big ? [659.3, 987.8, 1318.5] : [783.99, 1174.7]
    notes.forEach((hz, i) => {
      for (const [r, a] of [[1, 1], [2.76, 0.3], [5.4, 0.12]] as const) {
        const o = this.ctx!.createOscillator(); o.type = 'sine'; o.frequency.value = hz * r
        const g = this.ctx!.createGain(); this.env(g, t + 0.05 + i * 0.08, 0.07 * a, 0.002, 0.7 / r + 0.2)
        o.connect(g); g.connect(this.sfx); g.connect(this.verbIn)
        o.start(t + 0.05 + i * 0.08); o.stop(t + 1.2)
      }
    })
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
    this.thump(t, 95, 40, 0.35, 0.6)
    this.dirty(t, 0.6, 400, 3000, 500, 0.35)
    this.burst(t + 0.05, 0.5, 'highpass', 2000, 6000, 0.12, 0.7, this.verbIn)
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
    this.dirty(t, 0.5 + v * 0.5, 1500, 700, 120, 0.25 + v * 0.45)
    this.burst(t + 0.02, 0.3, 'highpass', 2500, 5000, 0.08 * v, 0.6)
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
