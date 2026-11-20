// The generated textures (tools/generate-asset.mjs → tools/process-textures.mjs → public/tex).
import * as THREE from 'three'
import { TEX } from './shaders'

export interface Textures { sand: THREE.Texture; rock: THREE.Texture; clay: THREE.Texture; gravel: THREE.Texture }

export async function loadTextures(renderer: THREE.WebGLRenderer): Promise<Textures> {
  const loader = new THREE.TextureLoader()
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  const load = async (name: string, mirrorV = false) => {
    const t = await loader.loadAsync(`./tex/${name}.jpg`)
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = mirrorV ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping
    t.anisotropy = aniso
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    return t
  }
  const [sand, rock, clay, gravel] = await Promise.all([load('sand'), load('rock', true), load('clay'), load('gravel')])
  TEX.tRock.value = rock
  TEX.tSand.value = sand
  return { sand, rock, clay, gravel }
}
