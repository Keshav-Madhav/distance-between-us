// Keyboard + gamepad, read at the top of every sim step (no extra latency).
import type { Controls } from './player'

const THREE_clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export class Input {
  readonly down = new Set<string>()
  private readonly pressed = new Set<string>()
  readonly c: Controls = { steer: 0, boost: false, burner: false, brake: false, strafe: 0, dodgeL: false, dodgeR: false }
  fire = false
  private steerS = 0
  /** Double-tap Q/E (or a quick tap of a shoulder) dodges. */
  private lastTap: Record<string, number> = {}
  usingPad = false
  /** The cursor (HUNT steers toward it): position in px, and when it last moved (s). */
  mouseX = 0
  mouseY = 0
  mouseAt = -99

  constructor() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return
      this.down.add(e.code)
      this.pressed.add(e.code)
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
    })
    addEventListener('keyup', (e) => this.down.delete(e.code))
    addEventListener('blur', () => this.down.clear())
    addEventListener('mousedown', (e) => { if (e.button === 0) this.down.add('Mouse0'); if (e.button === 2) this.down.add('Mouse2') })
    addEventListener('mouseup', (e) => { if (e.button === 0) this.down.delete('Mouse0'); if (e.button === 2) this.down.delete('Mouse2') })
    addEventListener('contextmenu', (e) => { if ((e.target as HTMLElement)?.id === 'game' || document.body.classList.contains('flying')) e.preventDefault() })
    addEventListener('mousemove', (e) => { this.mouseX = e.clientX; this.mouseY = e.clientY; this.mouseAt = performance.now() / 1000 })
  }

  /** Was this key pressed since the last call to consume()? */
  hit(code: string): boolean { return this.pressed.has(code) }
  consume(): void { this.pressed.clear() }
  isDown(code: string): boolean { return this.down.has(code) }

  read(dt: number, now: number): void {
    const k = (a: string) => this.down.has(a)
    let steer = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0)
    let strafe = (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0)
    let boost = k('KeyW') || k('ArrowUp')
    let burner = k('ShiftLeft') || k('ShiftRight')
    let brake = k('KeyS') || k('ArrowDown')
    let fire = k('Space') || k('Mouse0') || k('KeyJ')
    let dodgeL = false
    let dodgeR = false
    for (const [code, dir] of [['KeyQ', -1], ['KeyE', 1]] as const) {
      if (this.pressed.has(code)) {
        if (now - (this.lastTap[code] ?? -9) < 0.28) { if (dir < 0) dodgeL = true; else dodgeR = true }
        this.lastTap[code] = now
      }
    }
    // Keyboard steering ramps in over ~0.4 s (a tap is part-lock, a hold is full lock) and lets go
    // fast — so steering can be modulated against the grip gauge.
    const rate = steer === 0 || Math.sign(steer) !== Math.sign(this.steerS) ? 9 : 3.6
    this.steerS += THREE_clamp(steer - this.steerS, -rate * dt, rate * dt)
    steer = this.steerS

    const pads = navigator.getGamepads ? navigator.getGamepads() : []
    for (const p of pads) {
      if (!p) continue
      const ax = p.axes[0] ?? 0
      const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88)
      const sx = dz(ax)
      if (sx !== 0) { steer = Math.sign(sx) * sx * sx; this.usingPad = true }
      const rt = p.buttons[7]?.value ?? 0
      const lt = p.buttons[6]?.value ?? 0
      if (rt > 0.3) boost = true
      if (p.buttons[2]?.pressed) burner = true // X: afterburner
      if (lt > 0.3) brake = true
      if (p.buttons[0]?.pressed || p.buttons[5]?.pressed) fire = true
      const rx = dz(p.axes[2] ?? 0)
      if (rx !== 0) strafe = rx
      if (p.buttons[4]?.pressed && !this.lastTap.padLB) dodgeL = true
      if (p.buttons[1]?.pressed && !this.lastTap.padB) dodgeR = true
      this.lastTap.padLB = p.buttons[4]?.pressed ? 1 : 0
      this.lastTap.padB = p.buttons[1]?.pressed ? 1 : 0
    }
    this.c.steer = steer
    this.c.strafe = strafe
    this.c.boost = boost
    this.c.burner = burner
    this.c.brake = brake
    this.c.dodgeL = dodgeL
    this.c.dodgeR = dodgeR
    this.fire = fire
  }

  rumble(strong: number, weak: number, ms: number): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : []
    for (const p of pads) {
      const h = (p as unknown as { vibrationActuator?: { playEffect(t: string, o: object): Promise<unknown> } } | null)?.vibrationActuator
      if (h) void h.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {})
    }
  }
}
