// The viewer page: one model at a time in a three.js scene, turned, moved and zoomed with the mouse, its tools in Curio's toolbar.
import { THREE, MB, TooLarge, disposeModel, loadModel, materialsOf, ownMaterials, plainMesh } from './load.js'
import { OrbitControls } from '../vendor/three/addons/controls/OrbitControls.js'
import { HOME, figure, fitDistance, gridFor, solidOf, upAxis } from './model.js'

const FILE_LIMIT = 512 * MB
// above these, edges aren't offered and the drawing is lighter; the area and volume aren't worked out
const HEAVY = 5_000_000
const MEASURED = 2_000_000
const FOV = 45
// creases sharper than this are drawn as edges; a gentler one would mark every facet of a curved surface
const EDGE_ANGLE = 20
const KEYS = ['fit', 'grid', 'edges', 'textures', 'details', 'shading']
const SHADINGS = ['materials', 'plain', 'normals', 'wireframe']
const MAPS = ['map', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'specularMap', 'alphaMap', 'lightMap', 'displacementMap']
// millimetres in each unit the plugin's fields name
const MM = { 'µm': 0.001, mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }

const curio = Curio.connect()
// self-contained locale loader: reads locales/en.json and the active language from document.documentElement.lang
const LOCALES = new URL('../../locales/', import.meta.url)
let lang = document.documentElement.lang || 'en'
let enMessages = {}
let ownMessages = {}
const langListeners = new Set()
const loadLocale = async (code) => {
  try {
    const r = await fetch(new URL(`${code}.json`, LOCALES))
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}
const loadLang = async (code) => {
  lang = code || 'en'
  const base = lang.includes('-') ? lang.split('-')[0] : null
  ownMessages = lang === 'en' ? {} : (await loadLocale(lang)) || (base ? await loadLocale(base) : null) || {}
}
const lookup = (obj, key) => key.split('.').reduce((c, k) => (c && typeof c === 'object' ? c[k] : undefined), obj)
const t = (key, named) => {
  const raw = lookup(ownMessages, key) ?? lookup(enMessages, key)
  if (typeof raw !== 'string') return key
  return named ? raw.replace(/\{(\w+)\}/g, (_, k) => (named[k] != null ? String(named[k]) : `{${k}}`)) : raw
}
const onLanguage = (fn) => langListeners.add(fn)
window.addEventListener('curio-language', async (e) => {
  const next = e.detail?.language || document.documentElement.lang || 'en'
  if (next === lang) return
  await loadLang(next)
  for (const fn of langListeners) fn(lang)
})
const ready = (async () => {
  enMessages = (await loadLocale('en')) || {}
  await loadLang(document.documentElement.lang || 'en')
})()
const $ = (id) => document.getElementById(id)
const prefs = { grid: true, edges: false, textures: true, details: false, shading: 'materials', light: 1 }
let cur = null
let loading = 0

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
$('stage').append(renderer.domElement)
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 1000)
const ambient = new THREE.AmbientLight(0xffffff, 1.5)
const head = new THREE.DirectionalLight(0xffffff, 1.8)
camera.add(head)
scene.add(camera, ambient)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.12
controls.zoomToCursor = true
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }

const plain = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, side: THREE.DoubleSide })
const plainPoints = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false })
const normals = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide })
const wire = new THREE.MeshBasicMaterial({ wireframe: true })
const edgeLines = new THREE.LineBasicMaterial()

// drawn when something changed, and while the camera still glides
let frame = 0
const draw = () => (frame ||= requestAnimationFrame(tick))
function tick() {
  frame = 0
  if (controls.update()) draw()
  renderer.render(scene, camera)
}

/** A theme colour as three.js takes it: the browser turns whatever CSS holds into rgb. */
const probe = document.createElement('canvas').getContext('2d')
function themeColour(name, fallback) {
  probe.fillStyle = fallback
  probe.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  return new THREE.Color(probe.fillStyle)
}

function colours() {
  const bg = themeColour('--bg', '#202124')
  const text = themeColour('--text', '#e8e8e8')
  renderer.setClearColor(bg)
  // a little toward the background, so the light still shows the shape on a near-black or near-white model
  plain.color.copy(text).lerp(bg, 0.3)
  plainPoints.color.copy(text)
  wire.color.copy(text)
  edgeLines.color.copy(themeColour('--text-muted', '#9a9a9a'))
  if (cur) floor()
  draw()
}

function lights() {
  ambient.intensity = 1.5 * prefs.light
  head.intensity = 1.8 * prefs.light
  draw()
}

/** The materials a mesh is drawn with, for the shading and textures chosen. */
function look() {
  if (!cur) return
  cur.model.traverse((o) => {
    if (!o.isMesh && !o.isPoints) return
    if (o.userData.own === undefined) o.userData.own = o.material
    const own = o.userData.own
    if (o.isPoints) return void (o.material = prefs.shading === 'materials' && !plainMesh(o) ? own : plainPoints)
    if (prefs.shading === 'normals') o.material = normals
    else if (prefs.shading === 'wireframe') o.material = wire
    else if (prefs.shading === 'plain' || plainMesh(o)) o.material = plain
    else if (!prefs.textures) o.material = (o.userData.bare ||= bare(own))
    else o.material = own
    for (const m of materialsOf(o)) m.side = THREE.DoubleSide
  })
  draw()
}

/** The file's own materials without their pictures. */
function bare(own) {
  const one = (m) => {
    const c = m.clone()
    for (const k of MAPS) if (k in c) c[k] = null
    c.needsUpdate = true
    return c
  }
  return Array.isArray(own) ? own.map(one) : one(own)
}

/** Sets the model down on the floor, centred over it. */
function seat() {
  const { model, holder } = cur
  holder.position.set(0, 0, 0)
  model.rotation.x = upAxis(cur.item.ext, cur.up) === 'z' ? -Math.PI / 2 : 0
  holder.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(holder)
  const c = box.getCenter(new THREE.Vector3())
  holder.position.set(-c.x, -box.min.y, -c.z)
  holder.updateMatrixWorld(true)
  cur.box = new THREE.Box3().setFromObject(holder)
  cur.sphere = cur.box.getBoundingSphere(new THREE.Sphere())
}

function floor() {
  if (cur.grid) {
    scene.remove(cur.grid)
    cur.grid.geometry.dispose()
    cur.grid.material.dispose()
  }
  const size = cur.box.getSize(new THREE.Vector3())
  const g = gridFor(Math.max(size.x, size.z, size.y * 0.5))
  const line = themeColour('--border', '#444444')
  cur.grid = new THREE.GridHelper(g.side, g.cells, line, line)
  cur.grid.visible = prefs.grid
  scene.add(cur.grid)
}

function edges() {
  if (!cur || cur.heavy) return
  if (prefs.edges && !cur.edges) {
    cur.edges = []
    cur.model.traverse((o) => {
      if (!o.isMesh) return
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, EDGE_ANGLE), edgeLines)
      lines.userData.edges = true
      o.add(lines)
      cur.edges.push(lines)
    })
  }
  for (const l of cur.edges || []) l.visible = prefs.edges
  draw()
}

/** The view a model opens with: from above, the front and the left, the whole model in sight. */
function fit() {
  const { center, radius } = cur.sphere
  const half = (FOV * Math.PI) / 360
  const across = camera.aspect < 1 ? (2 * Math.atan(Math.tan(half) * camera.aspect) * 180) / Math.PI : FOV
  const d = fitDistance(radius, across) * 1.15
  camera.position.copy(center).add(new THREE.Vector3(...HOME).normalize().multiplyScalar(d))
  controls.target.copy(center)
  clip()
  controls.update()
  draw()
}

function clip() {
  const r = cur.sphere.radius || 1
  camera.near = r / 1000
  camera.far = r * 200
  controls.maxDistance = r * 50
  camera.updateProjectionMatrix()
}

let saveTimer = 0
function keep() {
  if (!cur) return
  clearTimeout(saveTimer)
  const { item, up } = cur
  saveTimer = setTimeout(() => {
    if (cur?.item.id !== item.id) return
    const value = { up, camera: camera.position.toArray(), target: controls.target.toArray() }
    curio.plugin.itemState.set({ id: item.id, value }).catch(() => {})
  }, 800)
}

function resize() {
  const box = $('stage').getBoundingClientRect()
  if (!box.width || !box.height) return
  renderer.setSize(box.width, box.height, false)
  camera.aspect = box.width / box.height
  camera.updateProjectionMatrix()
  draw()
}

const fmtSize = (dims, unit) => `${dims.map(figure).join(' x ')}${unit ? ` ${unit}` : ''}`

/** The facts shown in Details: counted from the scene, the size from the plugin's fields when they are in. */
function details() {
  const box = $('details')
  box.hidden = !prefs.details || !cur
  if (box.hidden) return
  const { item, fields, triangles } = cur
  let meshes = 0
  const materials = new Set()
  const textures = new Set()
  cur.model.traverse((o) => {
    if (!o.isMesh && !o.isPoints) return
    if (o.userData.edges) return
    meshes++
    for (const m of ownMaterials(o)) {
      materials.add(m)
      for (const k of MAPS) if (m[k]) textures.add(m[k].source || m[k])
    }
  })
  const unit = fields.model_unit || 'mm'
  const toUnit = MM.mm / (MM[unit] || 1)
  let size = ''
  if (Number.isFinite(fields.model_width)) size = fmtSize([fields.model_width, fields.model_depth, fields.model_height].map((v) => v * toUnit), unit)
  else {
    const s = cur.box.getSize(new THREE.Vector3())
    size = fmtSize([s.x, s.z, s.y])
  }
  const solid = cur.solid
  // three.js gives each triangle corners of its own where a file's share them, so the corners are counted where they are
  const rows = [
    { label: t('models.details.triangles'), value: triangles.toLocaleString(), mono: true },
    { label: t('models.details.vertices'), value: solid?.points.toLocaleString(), mono: true },
    { label: t('models.details.size'), value: size, mono: true },
  ]
  if (solid === undefined && triangles <= MEASURED) {
    rows.push({ label: t('models.details.surfaceArea'), value: t('models.details.measuring'), mono: true })
    setTimeout(() => measure(item.id), 30)
  } else if (solid) {
    // in millimetres, cubic and square centimetres read better
    const [aUnit, vUnit, a, v] = unit === 'mm' ? ['cm²', 'cm³', solid.area / 100, solid.volume / 1000] : [`${unit}²`, `${unit}³`, solid.area, solid.volume]
    if (solid.volume != null) rows.push({ label: t('models.details.volume'), value: `${figure(v)} ${vUnit}`, mono: true })
    rows.push({ label: t('models.details.surfaceArea'), value: `${figure(a)} ${aUnit}`, mono: true })
  }
  rows.push({ label: t('models.details.meshes'), value: meshes.toLocaleString(), mono: true }, { label: t('models.details.materials'), value: materials.size ? materials.size.toLocaleString() : '', mono: true }, { label: t('models.details.textures'), value: textures.size ? textures.size.toLocaleString() : '', mono: true })
  if (cur.missing.length) rows.push({ label: t('models.details.missingTextures'), value: cur.missing.join(', ') })
  $('facts').replaceChildren(...rows.filter((r) => r.value).map((r) => {
    const row = document.createElement('div')
    row.className = 'kv'
    const label = Object.assign(document.createElement('span'), { textContent: r.label })
    const val = Object.assign(document.createElement('span'), { textContent: r.value, title: r.value })
    if (r.mono) val.className = 'mono'
    row.append(label, val)
    return row
  }))
}

/** Works out the area, and the volume of a closed model, in the file's units, as the file places its meshes. */
function measure(id) {
  if (!cur || cur.item.id !== id || cur.solid !== undefined) return
  let area = 0
  let volume = 0
  let points = 0
  let closed = true
  const p = new THREE.Vector3()
  cur.model.updateMatrixWorld(true)
  cur.model.traverse((o) => {
    if (!o.isMesh || o.userData.edges) return
    const pos = o.geometry.getAttribute('position')
    const world = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)
      world.set([p.x, p.y, p.z], i * 3)
    }
    // the move to the floor and the turn to stand up change nothing measured; a file's own scale does, and is in matrixWorld too
    const s = solidOf(world, o.geometry.index?.array || null)
    area += s.area
    points += s.points
    if (s.volume == null) closed = false
    else volume += s.volume
  })
  cur.solid = { area, volume: closed ? volume : null, points }
  details()
}

function tools() {
  if (!cur) return void curio.viewer.setTools({}).catch(() => {})
  const buttons = [{ id: 'fit', label: t('models.tools.fit'), icon: 'focus-centered' }, { id: 'grid', label: t('models.tools.grid'), icon: 'grid-4x4', on: prefs.grid }]
  if (!cur.heavy) buttons.push({ id: 'edges', label: t('models.tools.edges'), icon: 'polygon', on: prefs.edges })
  if (cur.textured) buttons.push({ id: 'textures', label: t('models.tools.textures'), icon: 'texture', on: prefs.textures })
  buttons.push(
    { id: 'details', label: t('models.tools.details'), icon: 'info-circle', on: prefs.details },
    {
      id: 'look',
      label: t('models.tools.appearance'),
      icon: 'adjustments-horizontal',
      panel: [
        { type: 'choice', id: 'shading', label: t('models.tools.shading'), value: prefs.shading, options: SHADINGS.map((value) => ({ value, label: t(`models.shadings.${value}`) })) },
        { type: 'slider', id: 'light', label: t('models.tools.light'), min: 0.2, max: 2, step: 0.05, value: prefs.light },
        { type: 'choice', id: 'up', label: t('models.tools.up'), value: cur.up, options: [{ value: 'auto', label: t('models.tools.upAuto') }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }] },
      ],
    },
  )
  const keys = KEYS.filter((k) => k === 'shading' || buttons.some((b) => b.id === k))
  curio.viewer.setTools({ buttons, keys }).catch(() => {})
}

function clear() {
  if (!cur) return
  scene.remove(cur.holder)
  if (cur.grid) {
    scene.remove(cur.grid)
    cur.grid.geometry.dispose()
    cur.grid.material.dispose()
  }
  for (const l of cur.edges || []) l.geometry.dispose()
  cur.model.traverse((o) => {
    if (o.userData.bare) [o.userData.bare].flat().forEach((m) => m.dispose())
  })
  disposeModel(cur.holder)
  cur = null
}

function problem(text) {
  $('problem').textContent = text
  $('problem').hidden = !text
}

async function show(item) {
  const n = ++loading
  problem('')
  $('status').textContent = t('models.loading')
  $('status').hidden = false
  try {
    const [{ url }, kept, got] = await Promise.all([
      curio.item.fileUrl({ id: item.id }),
      curio.plugin.itemState.get({ id: item.id }).then((r) => r?.value || {}, () => ({})),
      curio.item.get({ id: item.id }).catch(() => null),
    ])
    const up = ['y', 'z'].includes(kept.up) ? kept.up : 'auto'
    const loaded = await loadModel(url, item.ext, { limit: FILE_LIMIT, up })
    if (n !== loading) return void disposeModel(loaded.object)
    clear()
    const holder = loaded.object
    cur = { item, holder, model: holder.children[0], up, fields: got?.fields || {}, triangles: loaded.triangles, textured: hasPictures(holder), heavy: loaded.triangles > HEAVY, missing: loaded.missing, solid: undefined }
    renderer.setPixelRatio(cur.heavy ? 1 : Math.min(devicePixelRatio, 2))
    controls.enableDamping = !cur.heavy
    scene.add(holder)
    seat()
    floor()
    look()
    edges()
    resize()
    if (Array.isArray(kept.camera) && Array.isArray(kept.target)) {
      camera.position.fromArray(kept.camera)
      controls.target.fromArray(kept.target)
      clip()
      controls.update()
    } else fit()
    details()
    tools()
    draw()
  } catch (e) {
    if (n !== loading) return
    clear()
    draw()
    tools()
    $('details').hidden = true
    problem(e instanceof TooLarge ? (e.unpacked ? t('models.tooLargeUnpacked', { size: e.message }) : t('models.tooLarge', { size: e.message })) : t('models.problem', { error: e.message }))
  } finally {
    if (n === loading) $('status').hidden = true
  }
}

const hasPictures = (root) => {
  let any = false
  root.traverse((o) => {
    if ((o.isMesh || o.isPoints) && ownMaterials(o).some((m) => MAPS.some((k) => m[k]))) any = true
  })
  return any
}

function setUp(up) {
  if (!cur || !['auto', 'y', 'z'].includes(up)) return
  cur.up = up
  seat()
  floor()
  fit()
  keep()
  tools()
}

function toggle(id) {
  prefs[id] = !prefs[id]
  curio.plugin.settings.set({ values: { [id]: prefs[id] } }).catch(() => {})
  if (id === 'grid' && cur?.grid) cur.grid.visible = prefs.grid
  if (id === 'edges') edges()
  if (id === 'textures') look()
  if (id === 'details') details()
  tools()
  draw()
}

function shading(value) {
  if (!SHADINGS.includes(value)) return
  prefs.shading = value
  curio.plugin.settings.set({ values: { shading: value } }).catch(() => {})
  look()
  tools()
}

curio.on('plugin.item', ({ data }) => ready.then(() => show(data)))
onLanguage(() => {
  if (!cur) return
  details()
  tools()
})

curio.on('plugin.tool', ({ data }) => {
  if (!cur) return
  const { id, value } = data
  if (id === 'fit') {
    fit()
    keep()
  } else if (['grid', 'edges', 'textures', 'details'].includes(id)) toggle(id)
  else if (id === 'shading' && value == null) shading(SHADINGS[(SHADINGS.indexOf(prefs.shading) + 1) % SHADINGS.length])
  else if (id === 'shading') shading(value)
  else if (id === 'light' && Number.isFinite(Number(value))) {
    prefs.light = Math.min(2, Math.max(0.2, Number(value)))
    curio.plugin.settings.set({ values: { light: prefs.light } }).catch(() => {})
    lights()
    tools()
  } else if (id === 'up') setUp(value)
})

controls.addEventListener('change', () => {
  draw()
  keep()
})
renderer.domElement.addEventListener('dblclick', () => {
  if (!cur) return
  fit()
  keep()
})
new ResizeObserver(resize).observe($('stage'))
window.addEventListener('curio-theme', colours)
curio.on('plugin.show', draw)

curio.plugin.settings.get().then((s) => {
  for (const k of ['grid', 'edges', 'textures', 'details']) if (typeof s?.[k] === 'boolean') prefs[k] = s[k]
  if (SHADINGS.includes(s?.shading)) prefs.shading = s.shading
  if (Number.isFinite(s?.light)) prefs.light = Math.min(2, Math.max(0.2, s.light))
  lights()
  if (cur) {
    if (cur.grid) cur.grid.visible = prefs.grid
    look()
    edges()
    details()
    tools()
  }
}).catch(() => {})

colours()
