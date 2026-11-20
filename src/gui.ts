// Live tuning (key G): every value in CFG. Loaded on demand; not in the main chunk.
import GUI from 'lil-gui'
import { CFG } from './config'

let gui: GUI | null = null
export function toggleGui(): void {
  if (gui) { gui.destroy(); gui = null; return }
  gui = new GUI({ title: 'feel' })
  for (const [group, obj] of Object.entries(CFG)) {
    const f = gui.addFolder(group)
    for (const k of Object.keys(obj)) {
      const v = (obj as Record<string, unknown>)[k]
      if (typeof v === 'number' || typeof v === 'boolean') f.add(obj as Record<string, number | boolean>, k)
    }
    f.close()
  }
}
