// Find near-black pixels in the 3D view (HUD hidden) and which system draws them.
import { chromium } from 'playwright-core'
import sharp from 'sharp'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
await page.goto('http://localhost:4417/?fixed'); await page.waitForFunction('window.__g && window.__g.ready')
await page.evaluate(() => { const g = window.__g; g.start(); document.getElementById('hud').style.display = 'none' })
await page.waitForTimeout(1500)
async function count(label) {
  await page.waitForTimeout(250)
  const buf = await page.screenshot()
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  let n = 0; const where = []
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels
    if (data[i] < 22 && data[i + 1] < 22 && data[i + 2] < 22) { n++; if (where.length < 6) where.push(`${x},${y}`) }
  }
  console.log(label.padEnd(28), n, where.join(' '))
  return buf
}
await sharp(await count('baseline')).toFile('shots/bp-base.png')
await page.evaluate(() => { window.__g.post.final.uniforms.uSharpen.value = 0; window.__g.post.__noSharpen = true })
await count('sharpen off (1 frame)')
await page.evaluate(() => { window.__g.fx.group.visible = false })
await count('+ particles off')
await page.evaluate(() => { window.__g.post.bloom.enabled = false })
await count('+ bloom off')
await page.evaluate(() => { for (const c of window.__g.world.group.children) if (c.isInstancedMesh && c.material.uniforms?.uTile) c.visible = false })
await count('+ pebbles off')
await browser.close()
