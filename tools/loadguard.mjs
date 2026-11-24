// Waits until the machine's 1-minute load average is under LOADMAX (default 50) — every heavy bench
// calls it before each run, so a busy machine is never pushed further (the user's limit: under 100).
import os from 'node:os'
export async function calm(label = '') {
  const max = +(process.env.LOADMAX ?? 50)
  let said = false
  while (os.loadavg()[0] > max) {
    if (!said) { console.error(`[loadguard] load ${os.loadavg()[0].toFixed(0)} > ${max}: waiting${label ? ' before ' + label : ''}`); said = true }
    await new Promise((r) => setTimeout(r, 5000))
  }
}
