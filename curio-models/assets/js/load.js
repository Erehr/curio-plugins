// Reads a model file into a three.js object, for the thumbnail page and the viewer alike, with the limits they share.
import * as THREE from '../vendor/three/three.module.min.js'
import { STLLoader } from '../vendor/three/addons/loaders/STLLoader.js'
import { ThreeMFLoader } from '../vendor/three/addons/loaders/3MFLoader.js'
import { OBJLoader } from '../vendor/three/addons/loaders/OBJLoader.js'
import { MTLLoader } from '../vendor/three/addons/loaders/MTLLoader.js'
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from '../vendor/three/addons/loaders/DRACOLoader.js'
import { PLYLoader } from '../vendor/three/addons/loaders/PLYLoader.js'
import { MeshoptDecoder } from '../vendor/three/addons/libs/meshopt_decoder.module.js'
import { unzipSync } from '../vendor/three/addons/libs/fflate.module.js'
import { upAxis, unzippedSize } from './model.js'

export { THREE }

export const MB = 1 << 20
// a 3MF is a zip: what it unpacks to is read whole, so a small file could otherwise fill the memory
const UNZIPPED_LIMIT = 1024 * MB
const TEXTURE_WAIT_MS = 20000

/** A file over the viewer's limit: its size, or the limit its unpacked contents passed (`unpacked`). */
export class TooLarge extends Error {
  constructor(size, unpacked = false) {
    super(size)
    this.unpacked = unpacked
  }
}

/** The file's bytes, refused without reading them when it is larger than `limit`. */
async function bytesOf(url, limit) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`the file could not be read (${r.status})`)
  const size = Number(r.headers.get('content-length') || 0)
  if (limit && size > limit) {
    r.body?.cancel().catch(() => {})
    throw new TooLarge(`${Math.round(size / MB)} MB`)
  }
  return r.arrayBuffer()
}

/** The folder of the file's address, which the files it refers to are relative to. */
const folderOf = (url) => url.slice(0, url.lastIndexOf('/') + 1)

/**
 * Files a model names are looked for beside it: Windows paths become slashes, and a path that leaves the model's folder (absolute, or from the computer the model was made on) keeps only its file name.
 */
function besideModel(base) {
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => {
    if (/^(data|blob):/.test(url)) return url
    const plain = url.replace(/\\/g, '/')
    if (plain.startsWith(base)) return plain
    const name = plain.split('/').pop()
    return base + name
  })
  return manager
}

/** Follows the pictures the loaders start; `settled(ms)` waits until they are in, or `ms` at most: a missing texture leaves the material's colour. */
function track(manager) {
  let loading = false
  let waiters = []
  manager.onStart = () => (loading = true)
  manager.onLoad = () => {
    loading = false
    waiters.forEach((w) => w())
    waiters = []
  }
  return (ms) => new Promise((resolve) => {
    if (!loading) return resolve()
    waiters.push(resolve)
    setTimeout(resolve, ms)
  })
}

const plainMaterial = (vertexColors = false) => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0, vertexColors, side: THREE.DoubleSide })

function meshOf(geometry, { normals = false } = {}) {
  if (normals || !geometry.getAttribute('normal')) geometry.computeVertexNormals()
  const colours = !!geometry.getAttribute('color')
  const mesh = new THREE.Mesh(geometry, plainMaterial(colours))
  mesh.userData.plain = !colours
  return mesh
}

function pointsOf(geometry) {
  const colours = !!geometry.getAttribute('color')
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: colours }))
  points.userData.plain = !colours
  return points
}

async function readObj(buffer, base, manager) {
  const text = new TextDecoder().decode(buffer)
  const obj = new OBJLoader(manager)
  const names = [...text.matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)].map((m) => m[1])
  for (const name of names) {
    try {
      const mtl = new MTLLoader(manager)
      mtl.setResourcePath(base)
      const materials = mtl.parse(await fetch(manager.resolveURL(base + name)).then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status)))), base)
      materials.preload()
      obj.setMaterials(materials)
      break
    } catch {
      /* a missing .mtl leaves the model in its plain colour */
    }
  }
  return obj.parse(text)
}

async function readGltf(buffer, base, manager) {
  const loader = new GLTFLoader(manager)
  const draco = new DRACOLoader(manager)
  draco.setDecoderPath(new URL('../vendor/three/addons/libs/draco/', import.meta.url).href)
  draco.setDecoderConfig({ type: 'wasm' })
  loader.setDRACOLoader(draco)
  loader.setMeshoptDecoder(MeshoptDecoder)
  try {
    const gltf = await loader.parseAsync(buffer, base)
    const scene = gltf.scene || gltf.scenes?.[0] || new THREE.Group()
    return scene
  } finally {
    draco.dispose()
  }
}

/**
 * The model at `url` as a three.js object standing with Y up, and what it holds: `{ object, triangles, textured, unit, missing }`, `unit` the one the file declares.
 * `limit` refuses larger files before reading them; `up` is 'auto', 'y' or 'z'; `wait` false doesn't wait for its pictures to load.
 */
export async function loadModel(url, ext, { limit = 0, up = 'auto', wait = true } = {}) {
  ext = ext.toLowerCase()
  const buffer = await bytesOf(url, limit)
  const base = folderOf(url)
  const manager = besideModel(base)
  const missing = new Set()
  manager.onError = (u) => missing.add(decodeURIComponent(u.slice(u.lastIndexOf('/') + 1)))
  const settled = track(manager)
  let object
  let unit = null
  if (ext === 'stl') {
    // many programs write an STL's normals as zeros
    object = meshOf(new STLLoader().parse(buffer), { normals: true })
  } else if (ext === 'ply') {
    const geometry = new PLYLoader().parse(buffer)
    object = geometry.index ? meshOf(geometry) : pointsOf(geometry)
  } else if (ext === '3mf') {
    if (unzippedSize(new Uint8Array(buffer)) > UNZIPPED_LIMIT) throw new TooLarge('1 GB', true)
    object = new ThreeMFLoader(manager).parse(buffer)
    unit = unitOf3mf(buffer)
  } else if (ext === 'obj') {
    object = await readObj(buffer, base, manager)
  } else if (ext === 'glb' || ext === 'gltf') {
    object = await readGltf(buffer, base, manager)
    unit = 'm'
  } else {
    throw new Error(`.${ext} is not a model this plugin reads`)
  }
  if (wait) await settled(TEXTURE_WAIT_MS)
  const holder = new THREE.Group()
  holder.add(object)
  if (upAxis(ext, up) === 'z') object.rotation.x = -Math.PI / 2
  holder.updateMatrixWorld(true)
  return { object: holder, missing: [...missing], unit, ...facts(holder) }
}

const UNITS = { micron: 'µm', millimeter: 'mm', centimeter: 'cm', inch: 'in', foot: 'ft', meter: 'm' }

/** A 3MF's unit, from its root model part: millimetres unless it names another. */
function unitOf3mf(buffer) {
  const parts = unzipSync(new Uint8Array(buffer), { filter: (f) => /3dmodel\.model$/i.test(f.name) })
  const xml = Object.values(parts)[0]
  const name = xml ? /<model\b[^>]*\bunit="([a-z]+)"/i.exec(new TextDecoder().decode(xml.subarray(0, 4096)))?.[1] : null
  return UNITS[name?.toLowerCase()] || 'mm'
}

/** A material that only fills in for one the file doesn't have: drawn in the page's own colour. */
function isPlain(mesh, m) {
  if (mesh.userData.plain) return true
  if (!m || m.map || m.vertexColors) return false
  return m.name === THREE.Loader.DEFAULT_MATERIAL_NAME || (m.color?.getHex() === 0xffffff && !m.emissiveMap)
}

export const materialsOf = (mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean)

/** The materials the file gave a mesh, whatever it is drawn with now. */
export const ownMaterials = (o) => (o.userData.own === undefined ? materialsOf(o) : [o.userData.own].flat().filter(Boolean))

/** Whether the file gives a mesh or points no colours of their own. */
export const plainMesh = (o) => (o.isPoints ? !!o.userData.plain : ownMaterials(o).every((m) => isPlain(o, m)))

function facts(root) {
  let triangles = 0
  let textured = false
  root.traverse((o) => {
    if (!o.isMesh) return
    const g = o.geometry
    triangles += (g.index ? g.index.count : g.getAttribute('position')?.count || 0) / 3
    if (materialsOf(o).some((m) => m.map)) textured = true
  })
  return { triangles: Math.round(triangles), textured }
}

/**
 * Gives the meshes without a material of the file's own `colour`, lit on both sides; with `textures` false, every mesh is drawn so.
 * Answers a function setting the colour again, for a theme that changes.
 */
export function paintPlain(root, colour, { textures = true } = {}) {
  const shared = plainMaterial()
  shared.color.set(colour)
  const points = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, color: shared.color })
  root.traverse((o) => {
    if (!o.isMesh && !o.isPoints) return
    if (o.userData.own === undefined) o.userData.own = o.material
    const own = o.userData.own
    if (plainMesh(o) || !textures) o.material = o.isPoints ? points : shared
    else o.material = own
    for (const m of materialsOf(o)) if (m !== shared && m !== points) m.side = THREE.DoubleSide
  })
  return (c) => shared.color.set(c)
}

/** Frees what the model holds on the graphics card. */
export function disposeModel(root) {
  const seen = new Set()
  root.traverse((o) => {
    o.geometry?.dispose()
    for (const m of [...materialsOf(o), ...(o.userData.own ? [o.userData.own].flat() : [])]) {
      if (seen.has(m)) continue
      seen.add(m)
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose()
      m.dispose()
    }
  })
}
