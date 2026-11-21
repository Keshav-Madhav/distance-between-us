import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
await page.goto('http://localhost:4417/?fixed'); await page.waitForFunction('window.__g && window.__g.ready')
await page.evaluate(() => { const g = window.__g; g.start(); g.skipCountdown(); g.force({ steer: 0, boost: true, brake: false, strafe: 0, dodgeL: false, dodgeR: false }) })
await page.waitForTimeout(2500)
console.log(await page.evaluate(() => {
  const g = window.__g, cam = g.camera, out = []
  const p = g.player.pos
  const v = new cam.position.constructor()
  g.scene.traverseVisible((o) => {
    if (!o.isMesh) return
    const list = []
    if (o.isInstancedMesh) {
      const m = new o.matrixWorld.constructor()
      for (let i = 0; i < Math.min(o.count, 4000); i++) { o.getMatrixAt(i, m); v.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld); list.push(v.clone()) }
    } else { o.getWorldPosition(v); list.push(v.clone()) }
    for (const w of list) {
      const d = w.distanceTo(p)
      if (d > 8 && d < 400) {
        const s = w.clone().project(cam)
        if (Math.abs(s.x) < 0.25 && Math.abs(s.y) < 0.35 && s.z < 1) out.push(`${o.type} ${o.material.type} ${o.name || ''} d=${d.toFixed(0)} scr=(${s.x.toFixed(2)},${s.y.toFixed(2)}) geo=${o.geometry.type} verts=${o.geometry.attributes.position.count}`)
      }
    }
  })
  return out.slice(0, 30).join('\n')
}))
await page.screenshot({ path: 'shots/what.png' })
await browser.close()
