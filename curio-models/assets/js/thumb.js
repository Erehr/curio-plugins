// The thumbnail page: Curio hands it models one at a time; it draws each from the viewer's first view on a transparent square, the same in every theme.
import { THREE, MB, TooLarge, disposeModel, loadModel, paintPlain } from './load.js'
import { HOME, fitDistance, squareAround } from './model.js'

const FILE_LIMIT = 256 * MB
// above this the model is drawn without supersampling; far above it, not at all
const HEAVY = 5_000_000
const TOO_HEAVY = 20_000_000
const FOV = 45
const MARGIN = 0.06
// a grey that reads on the light and the dark themes' cards alike
const PLAIN = '#a5a8ae'

const curio = Curio.connect()
let renderer = null

function setup(px) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(1)
    renderer.setClearColor(0x000000, 0)
  }
  renderer.setSize(px, px, false)
  return renderer
}

function scene(model) {
  const s = new THREE.Scene()
  s.add(new THREE.AmbientLight(0xffffff, 1.6))
  s.add(model)
  return s
}

async function draw({ fileUrl, ext, size }) {
  const { object, triangles } = await loadModel(fileUrl, ext, { limit: FILE_LIMIT })
  try {
    if (triangles > TOO_HEAVY) return null
    paintPlain(object, PLAIN)
    const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere())
    if (!(sphere.radius > 0) || !Number.isFinite(sphere.radius)) return null
    const px = Math.min(2048, triangles > HEAVY ? size : size * 2)
    const r = setup(px)
    const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 2)
    const d = fitDistance(sphere.radius, FOV)
    camera.position.copy(sphere.center).add(new THREE.Vector3(...HOME).normalize().multiplyScalar(d))
    camera.near = Math.max(d - sphere.radius * 1.5, d / 1000)
    camera.far = d + sphere.radius * 1.5
    camera.lookAt(sphere.center)
    camera.updateProjectionMatrix()
    const light = new THREE.DirectionalLight(0xffffff, 1.9)
    camera.add(light)
    const s = scene(object)
    s.add(camera)
    r.render(s, camera)
    s.remove(object)
    // cut to the model, then scaled into the square Curio keeps
    const read = new OffscreenCanvas(px, px)
    const rc = read.getContext('2d', { willReadFrequently: true })
    rc.drawImage(r.domElement, 0, 0)
    const rgba = rc.getImageData(0, 0, px, px).data
    const alpha = new Uint8Array(px * px)
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]
    const box = squareAround(alpha, px, MARGIN)
    if (!box) return null
    const out = new OffscreenCanvas(size, size)
    const oc = out.getContext('2d')
    oc.imageSmoothingQuality = 'high'
    oc.drawImage(read, box.x, box.y, box.side, box.side, 0, 0, size, size)
    return await out.convertToBlob({ type: 'image/png' })
  } finally {
    disposeModel(object)
  }
}

curio.on('plugin.thumbnail', async ({ data }) => {
  let picture = null
  try {
    picture = await draw(data)
  } catch (e) {
    const why = e instanceof TooLarge ? `too large to draw (${e.message})` : e.message
    curio.plugin.log({ level: 'warn', message: `no thumbnail for ${data.item}: ${why}` }).catch(() => {})
  }
  curio.thumbnailDone(data.request, picture)
})
