// What the pages work out about a model without three.js.

// formats made by CAD programs and slicers, where Z points up as on a print bed
const Z_UP = new Set(['stl', '3mf', 'ply'])

/** The axis the file stands on: `up` when chosen, else Z for the formats of CAD programs and slicers, Y for the rest. */
export const upAxis = (ext, up = 'auto') => (up === 'y' || up === 'z' ? up : Z_UP.has(ext.toLowerCase()) ? 'z' : 'y')

/** What a zip's entries unpack to, from its central directory; 0 when there is none to read. */
export function unzippedSize(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at--) {
    if (v.getUint32(at, true) !== 0x06054b50) continue
    let entry = v.getUint32(at + 16, true)
    const count = v.getUint16(at + 10, true)
    let total = 0
    for (let i = 0; i < count && entry + 46 <= bytes.length; i++) {
      if (v.getUint32(entry, true) !== 0x02014b50) break
      total += v.getUint32(entry + 24, true)
      entry += 46 + v.getUint16(entry + 28, true) + v.getUint16(entry + 30, true) + v.getUint16(entry + 32, true)
    }
    return total
  }
  return 0
}

/** The camera's direction from the model's centre in its first view: from above, the front and the left. */
export const HOME = [-1.5, 2, 3]

/** How far from the centre the eye sits for a sphere of `radius` to fill a square view of `fov` degrees. */
export const fitDistance = (radius, fov) => radius / Math.sin((fov * Math.PI) / 360)

/**
 * The square a model's drawing is cut to: around its opaque pixels in an `size` x `size` picture's `alpha`, with `margin` of the picture's size on each side; null when nothing was drawn.
 */
export function squareAround(alpha, size, margin) {
  let [x0, y0, x1, y1] = [size, size, -1, -1]
  for (let y = 0; y < size; y++) {
    const row = y * size
    for (let x = 0; x < size; x++) {
      if (alpha[row + x] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  const side = Math.max(x1 - x0 + 1, y1 - y0 + 1) / (1 - 2 * margin)
  return { x: (x0 + x1 + 1) / 2 - side / 2, y: (y0 + y1 + 1) / 2 - side / 2, side }
}

/** A round length near `v`: 1, 2 or 5 times a power of ten. */
export function niceStep(v) {
  if (!(v > 0) || !Number.isFinite(v)) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  const f = v / p
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p
}

/** The floor grid for a model `size` across: its cell and its side, a round number of cells about twice the model. */
export function gridFor(size) {
  const cell = niceStep(size / 8)
  const cells = Math.max(4, 2 * Math.ceil((size * 1.25) / cell))
  return { cell, side: cell * cells, cells }
}

/**
 * The area, volume and distinct corners (`points`) of triangles given as `positions` (x, y, z per corner) and `index` (three corners a triangle, or null for corners in order), and whether they close a solid: every edge shared by two triangles running opposite ways, corners within a millionth of the model's size counted as one, since a seam's two sides seldom land on exactly the same number.
 * The volume is told only of a closed solid, as the sum of the tetrahedra from the origin.
 */
export function solidOf(positions, index) {
  const n = index ? index.length : positions.length / 3
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], positions[i])
    hi[i % 3] = Math.max(hi[i % 3], positions[i])
  }
  const step = Math.max(Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 1e-6, Number.MIN_VALUE)
  const ids = new Map()
  const weld = (i) => {
    const key = `${Math.round(positions[i * 3] / step)},${Math.round(positions[i * 3 + 1] / step)},${Math.round(positions[i * 3 + 2] / step)}`
    let id = ids.get(key)
    if (id === undefined) ids.set(key, (id = ids.size))
    return id
  }
  const edges = new Map()
  let area = 0
  let volume = 0
  for (let t = 0; t + 2 < n; t += 3) {
    const c = [0, 1, 2].map((k) => (index ? index[t + k] : t + k))
    const [a, b, d] = c.map((i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]])
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    area += Math.hypot(...cross) / 2
    volume += (a[0] * (b[1] * d[2] - b[2] * d[1]) - a[1] * (b[0] * d[2] - b[2] * d[0]) + a[2] * (b[0] * d[1] - b[1] * d[0])) / 6
    const w = c.map(weld)
    // a triangle folded to a line or a point, as at a sphere's poles, has no edges to share
    if (w[0] === w[1] || w[1] === w[2] || w[0] === w[2]) continue
    for (let k = 0; k < 3; k++) {
      const key = `${w[k]}>${w[(k + 1) % 3]}`
      edges.set(key, (edges.get(key) || 0) + 1)
    }
  }
  let closed = edges.size > 0
  for (const [key, count] of edges) {
    const [p, q] = key.split('>')
    if (count !== 1 || edges.get(`${q}>${p}`) !== 1) {
      closed = false
      break
    }
  }
  return { area, volume: closed ? Math.abs(volume) : null, closed, points: ids.size }
}

/** A number to three significant figures, as the system writes numbers. */
export function figure(v) {
  if (!Number.isFinite(v)) return ''
  return Number(v.toPrecision(3)).toLocaleString(undefined, { maximumFractionDigits: 6 })
}
