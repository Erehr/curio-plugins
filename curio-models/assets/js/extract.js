// The extractor page: Curio hands it models one at a time; it loads each as the viewer does and answers its triangles, vertices, objects, size, unit and whether it has textures.
import { THREE, MB, TooLarge, disposeModel, loadModel } from './load.js'

// past this a model is left without facts rather than loaded
const FILE_LIMIT = 512 * MB
// corners past this many aren't welded to count the distinct ones
const WELD_LIMIT = 10_000_000

const curio = Curio.connect()
const MM = { 'µm': 0.001, mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }

/** The distinct corners of `attr`, those at one place counted once, hashed over float bits in a typed table to avoid string-Set heap blowups. */
function distinct(attr) {
  const n = attr.count
  if (!n) return 0
  let f32
  if (attr.array instanceof Float32Array && attr.itemSize === 3 && !attr.isInterleavedBufferAttribute) f32 = attr.array
  else {
    f32 = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      f32[i * 3] = attr.getX(i)
      f32[i * 3 + 1] = attr.getY(i)
      f32[i * 3 + 2] = attr.getZ(i)
    }
  }
  const u32 = new Uint32Array(f32.buffer, f32.byteOffset, n * 3)
  const norm = (b) => (b === 0x80000000 ? 0 : b)
  const hash = (a, b, c) => {
    let h = Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77) ^ Math.imul(c, 0xc2b2ae3d)
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
    return (h ^ (h >>> 15)) >>> 0
  }
  let cap = 16
  while (cap < n / 2 && cap < 1 << 23) cap <<= 1
  let table = new Uint32Array(cap)
  let mask = cap - 1
  let count = 0
  const grow = () => {
    const old = table
    cap <<= 1
    mask = cap - 1
    table = new Uint32Array(cap)
    for (let k = 0; k < old.length; k++) {
      const v = old[k]
      if (!v) continue
      const j = (v - 1) * 3
      let s = hash(norm(u32[j]), norm(u32[j + 1]), norm(u32[j + 2])) & mask
      while (table[s]) s = (s + 1) & mask
      table[s] = v
    }
  }
  for (let i = 0; i < n; i++) {
    const o = i * 3
    const a = norm(u32[o])
    const b = norm(u32[o + 1])
    const c = norm(u32[o + 2])
    let s = hash(a, b, c) & mask
    while (true) {
      const v = table[s]
      if (!v) {
        table[s] = i + 1
        count++
        if (count * 10 >= cap * 7) grow()
        break
      }
      const j = (v - 1) * 3
      if (norm(u32[j]) === a && norm(u32[j + 1]) === b && norm(u32[j + 2]) === c) break
      s = (s + 1) & mask
    }
  }
  return count
}

async function read({ fileUrl, ext }) {
  let model
  try {
    model = await loadModel(fileUrl, ext, { limit: FILE_LIMIT, wait: false })
  } catch (e) {
    if (e instanceof TooLarge) return {}
    throw e
  }
  const { object, triangles, textured, unit } = model
  try {
    let objects = 0
    let corners = 0
    let vertices = 0
    object.traverse((o) => {
      if (!o.isMesh && !o.isPoints) return
      objects++
      const p = o.geometry.getAttribute('position')
      if (!p) return
      corners += p.count
      if (corners <= WELD_LIMIT) vertices += o.geometry.index || o.isPoints ? p.count : distinct(p)
    })
    const values = { model_triangles: triangles, model_objects: Math.max(objects, 1), model_textured: textured }
    if (corners <= WELD_LIMIT) values.model_vertices = vertices
    if (unit) values.model_unit = unit
    const box = new THREE.Box3().setFromObject(object)
    if (!box.isEmpty()) {
      // the model stands with Y up: width along X, depth along Z, height along Y, in millimetres
      const s = box.getSize(new THREE.Vector3()).multiplyScalar(MM[unit || 'mm'])
      const mm = (v) => Math.round(v * 100) / 100
      Object.assign(values, { model_width: mm(s.x), model_depth: mm(s.z), model_height: mm(s.y) })
    }
    return values
  } finally {
    disposeModel(object)
  }
}

curio.on('plugin.extract', async ({ data }) => {
  try {
    curio.extractDone(data.request, await read(data))
  } catch (e) {
    curio.extractDone(data.request, null, e?.message || String(e))
  }
})
